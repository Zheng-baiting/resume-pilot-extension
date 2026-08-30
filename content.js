const FIELD_RULES = [
  { key: "fullName", patterns: [/姓名|名字|name/i] },
  { key: "phone", patterns: [/手机|电话|联系.*方式|mobile|phone|tel/i] },
  { key: "email", patterns: [/邮箱|电子邮件|e-?mail/i] },
  { key: "school", patterns: [/学校|院校|毕业.*学校|university|college|school/i] },
  { key: "major", patterns: [/专业|主修|major/i] },
  { key: "degree", patterns: [/学历|学位|degree|education level/i] },
  { key: "graduationYear", patterns: [/毕业.*年|graduation.*year|graduate.*year/i] },
  { key: "currentCity", patterns: [/当前.*城市|所在.*城市|现居|location|current city/i] },
  { key: "skills", patterns: [/技能|技术栈|专长|skills?/i] },
  { key: "targetRole", patterns: [/求职.*意向|期望.*职位|目标.*岗位|desired.*position|target.*role/i] },
  { key: "targetCity", patterns: [/期望.*城市|意向.*地点|工作.*地点|desired.*location|preferred.*city/i] },
  { key: "resumeText", patterns: [/个人.*总结|自我.*评价|个人.*简介|summary|profile/i] }
];
const CONTENT_SCRIPT_VERSION = "0.10.0";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message?.type === "FILL_APPLICATION") {
    const { knownAnswers = {} } = await chrome.storage.local.get("knownAnswers");
    return fillApplication(message.profile || {}, knownAnswers, message.resumeFile || null);
  }
  if (message?.type === "SCAN_JOB_LIST") return deepScanJobList(message.profile || {});
  if (message?.type === "GET_CONTENT_VERSION") {
    return {
      version: CONTENT_SCRIPT_VERSION,
      mainBridgeVersion: document.documentElement.getAttribute("data-resume-pilot-main-click-version") || ""
    };
  }
  if (message?.type === "INSPECT_RECRUITMENT_FLOW") return inspectRecruitmentFlow(message.profile || {});
  if (message?.type === "PREPARE_JOB_DETAIL") return prepareJobDetail(message.profile || {}, message.job || {});
  if (message?.type === "OPEN_SCANNED_JOB") return openScannedJob(message.clickToken || "", message.searchTerm || "");
  if (message?.type === "OPEN_SCANNED_JOB_MAIN") return requestMainWorldJobClick(message.clickToken || "");
  if (message?.type === "CLICK_JOB_ENTRANCE") return clickJobEntrance(message.index || 0);
  if (message?.type === "OPEN_APPLICATION") return openApplication();
  if (message?.type === "CREATE_RESUME_FROM_PROFILE") {
    const { knownAnswers = {} } = await chrome.storage.local.get("knownAnswers");
    return createResumeFromProfile(message.profile || {}, knownAnswers, message.resumeFile || null);
  }
  if (message?.type === "TRY_AUTO_LOGIN") return tryAutoLogin();
  if (message?.type === "CHECK_APPLICATION_PAGE") {
    return inspectRecruitmentFlow({});
  }
  if (message?.type === "SUBMIT_APPLICATION") return submitApplication();
  if (message?.type === "DETECT_APPLICATION_SUCCESS") return detectApplicationSuccess();
  if (message?.type === "SHOW_AUTOMATION_NOTICE") {
    showAutomationNotice(message.notice || {});
    return {};
  }
  throw new Error("不支持的页面操作");
}

async function deepScanJobList(profile) {
  if (location.hostname === "career.huawei.com" && /campus-recruitment-job-list/i.test(location.pathname)) {
    const officialJobs = await scanHuaweiOfficialJobs(profile).catch(() => []);
    if (officialJobs.length) {
      return {
        results: officialJobs,
        entrances: [],
        recommendedUrl: "",
        officialFilters: {
          positionType: String(profile.positionType || ""),
          keywords: buildOfficialSearchTerms(profile),
          source: "华为官网岗位接口（完整职责与要求）"
        }
      };
    }
  }

  const collected = new Map();
  await selectOfficialPositionType(profile);
  const searchInput = findOfficialSearchInput();
  const searchTerms = searchInput ? buildOfficialSearchTerms(profile).slice(0, 3) : [];
  const verifiedSearchTerms = [];

  if (searchTerms.length) {
    for (const term of searchTerms) {
      if (await runOfficialKeywordSearch(searchInput, term)) verifiedSearchTerms.push(term);
      await collectOfficialJobPages(profile, collected);
      if (collected.size >= 30) break;
    }
    // 无论关键词是否已有结果，都清空关键词并完整翻页一次。这样岗位标题不完全匹配，
    // 但卡片内容命中简历技能的岗位也不会被漏掉。
    await runOfficialKeywordSearch(searchInput, "");
    await collectOfficialJobPages(profile, collected);
  } else {
    if (searchInput && searchInput.value.trim()) await runOfficialKeywordSearch(searchInput, "");
    await collectOfficialJobPages(profile, collected);
  }

  return {
    results: [...collected.values()].sort((a, b) => b.score - a.score).slice(0, 80),
    entrances: discoverJobEntrances(),
    recommendedUrl: getRecommendedJobListUrl(profile),
    officialFilters: {
      positionType: String(profile.positionType || ""),
      keywords: searchTerms,
      verifiedKeywords: verifiedSearchTerms,
      searchVerified: !searchTerms.length || verifiedSearchTerms.length > 0
    }
  };
}

async function scanHuaweiOfficialJobs(profile) {
  const recruitmentTypes = /不限/i.test(profile.positionType || "")
    ? ["INTERN", "FRESH_GRADUATE"]
    : (/校园|校招|应届|graduate|campus/i.test(profile.positionType || "") ? ["FRESH_GRADUATE"] : ["INTERN"]);
  const jobs = await requestHuaweiOfficialJobs(recruitmentTypes);
  const companyEval = ResumePilotScoring.evaluateCompany(document.title, location.href, profile);
  return jobs.map((job) => {
    const rankedIntentions = (job.intentions || []).map((item) => {
      const itemText = stripHtml([item.positionIntention, item.jobResponsibilities, item.jobDemand, item.jobPlaceName].join(" "));
      return { item, evaluation: ResumePilotScoring.evaluateJob(itemText, location.href, profile) };
    }).sort((a, b) => {
      if (a.evaluation.skillEligible !== b.evaluation.skillEligible) return a.evaluation.skillEligible ? -1 : 1;
      return b.evaluation.jobScore - a.evaluation.jobScore;
    });
    const preferred = rankedIntentions[0]?.item || null;
    const desiredCities = splitTerms(`${profile.targetCity || ""} ${profile.currentCity || ""}`);
    const availableCities = String(preferred?.jobPlaceName || job.workPlace || "").split(/[\s/,，、]+/).filter(Boolean);
    const preferredCity = desiredCities.find((city) => availableCities.some((value) => value.includes(city))) || availableCities[0] || "";
    const departments = preferred?.deptAndPlaceList || [];
    const cityDepartments = departments.filter((item) => !preferredCity || String(item.jobPlaceName || "").includes(preferredCity));
    const preferredDepartment = (cityDepartments[0] || departments[0])?.deptName || "";
    const intentionText = (job.intentions || []).map((item) => [
      item.positionIntention,
      item.jobResponsibilities,
      item.jobDemand,
      item.jobPlaceName
    ].join(" ")).join(" ");
    const text = stripHtml([
      job.jobName,
      job.categoryName,
      job.workPlace,
      job.mainBusiness,
      job.jobRequire,
      intentionText,
      recruitmentTypes.includes("INTERN") ? "实习" : "校园招聘"
    ].join(" "));
    const url = `https://career.huawei.com/cn/job-details?advertisementId=${encodeURIComponent(job.advertisementId)}`;
    const jobEval = ResumePilotScoring.evaluateJob(text, url, profile);
    const score = Math.round(companyEval.companyScore * 0.3 + jobEval.jobScore * 0.45 + jobEval.compensationScore * 0.25);
    return {
      title: job.jobName,
      url,
      description: text.slice(0, 520),
      company: "华为",
      resultType: "官网岗位",
      score,
      companyScore: companyEval.companyScore,
      jobScore: jobEval.jobScore,
      matchedSkills: jobEval.matchedSkills,
      skillEligible: jobEval.skillEligible,
      hardBlocked: jobEval.hardBlocked,
      compensationScore: jobEval.compensationScore,
      compensationLabel: jobEval.compensationLabel,
      confidence: Math.max(95, companyEval.confidence || 0),
      reasons: [...new Set(["官网岗位 ID 可直达详情", ...companyEval.reasons, ...jobEval.reasons])].slice(0, 7),
      warnings: [...new Set([...companyEval.warnings, ...jobEval.warnings])].slice(0, 6),
      evidence: companyEval.evidence,
      officialJobId: job.jobId,
      advertisementId: job.advertisementId,
      preferredIntention: preferred?.positionIntention || "",
      preferredCity,
      preferredDepartment
    };
  }).sort((a, b) => {
    if (a.skillEligible !== b.skillEligible) return a.skillEligible ? -1 : 1;
    return b.score - a.score;
  }).slice(0, 100);
}

async function prepareJobDetail(profile, job) {
  if (location.hostname !== "career.huawei.com" || !/job-details/i.test(location.pathname)) return { prepared: false, site: "generic" };
  const selected = {};
  const intentionInput = document.querySelector(".intention-select input");
  if (intentionInput && !intentionInput.value) {
    selected.intention = await selectHuaweiOption(intentionInput, job.preferredIntention || "");
  } else if (intentionInput?.value) selected.intention = intentionInput.value;
  // 岗位意向会触发接口请求并重建地点/部门区域，不能在同一帧立刻判定控件不存在。
  await waitForHuaweiControl(".aui-tag-input input, .parent-department-select input", 2800);

  const cityInput = document.querySelector(".aui-tag-input input");
  if (cityInput && !document.querySelector(".aui-tag-input [class*='tag-item'], .aui-tag-input [class*='tag-label']")) {
    selected.city = await selectHuaweiOption(cityInput, job.preferredCity || profile.targetCity || profile.currentCity || "");
    // 华为地点是多选控件，选择后弹层不会自行关闭；先点到弹层外再打开部门下拉。
    await closeHuaweiPopup();
    cityInput.blur();
    await wait(250);
  }
  await waitForHuaweiControl(".parent-department-select input", 2800);

  const parentDepartmentInput = document.querySelector(".parent-department-select input");
  if (parentDepartmentInput && !parentDepartmentInput.value) {
    selected.departmentGroup = await selectHuaweiDepartmentOption(parentDepartmentInput, profile, job, "parent");
  } else if (parentDepartmentInput?.value) selected.departmentGroup = parentDepartmentInput.value;

  // 华为部分岗位是两级部门：只选 ICT BG 等一级部门仍会保留红色必填提示。
  // 必须等待二级列表根据一级部门刷新后，再按简历技能选择最贴近的产品线/研发部。
  await closeHuaweiPopup();
  await wait(450);
  const subDepartmentInput = document.querySelector(".sub-department-select input");
  if (subDepartmentInput && !subDepartmentInput.value) {
    selected.department = await selectHuaweiDepartmentOption(subDepartmentInput, profile, job, "sub");
  } else if (subDepartmentInput?.value) selected.department = subDepartmentInput.value;

  const intentionReady = !intentionInput || Boolean(intentionInput.value || selected.intention);
  const cityReady = !cityInput || Boolean(selected.city || document.querySelector(".aui-tag-input [class*='tag-item'], .aui-tag-input [class*='tag-label']"));
  const departmentRequired = Boolean(document.querySelector(".select-department-tips, .departments-select-box, .parent-department-select"));
  const parentReady = !departmentRequired || Boolean(parentDepartmentInput?.value || selected.departmentGroup);
  const hasSubDepartment = Boolean(document.querySelector(".departments-select-box.have-sub-dept, .sub-department-select"));
  const subReady = !hasSubDepartment || Boolean(subDepartmentInput?.value);
  const missingDepartment = !parentReady || !subReady || Boolean(document.querySelector(".select-department-tips"));

  return {
    prepared: intentionReady && cityReady && !missingDepartment,
    selected,
    missingDepartment
  };
}

async function waitForHuaweiControl(selector, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const control = document.querySelector(selector);
    if (control) return control;
    await wait(120);
  }
  return null;
}

async function selectHuaweiDepartmentOption(input, profile, job, level) {
  input.scrollIntoView({ block: "center", behavior: "instant" });
  input.click();
  await wait(450);
  const options = await collectHuaweiOptionTexts();
  if (!options.length) return "";
  const ranked = options
    .map((text, index) => ({ text, index, score: scoreHuaweiDepartment(text, profile, job, level) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0]?.text || options[0];
  const selected = await clickHuaweiOptionByText(input, best);
  return selected || "";
}

function scoreHuaweiDepartment(optionText, profile, job, level) {
  const text = String(optionText || "").replace(/\s+/g, "").toLowerCase();
  const context = [
    profile.targetRole, profile.skills, profile.major, profile.targetIndustry,
    profile.projectExperience, job.title, job.description, job.matchedRole,
    job.preferredIntention
  ].filter(Boolean).join(" ").toLowerCase();
  const preferred = String(job.preferredDepartment || "").replace(/\s+/g, "").toLowerCase();
  let score = 1;
  // 接口返回的 deptName 只是该地点可选部门中的第一项，并非官网推荐；只作轻量提示，
  // 避免它压过由简历技能和岗位职责计算出的实际匹配度。
  if (preferred && (text.includes(preferred) || preferred.includes(text))) score += 18;

  const add = (signal, parentTerms, subTerms, weight) => {
    if (!signal.test(context)) return;
    const terms = level === "parent" ? parentTerms : subTerms;
    const hitIndex = terms.findIndex((term) => text.includes(term));
    if (hitIndex >= 0) score += Math.max(4, weight - hitIndex * 5);
  };
  add(/前端|javascript|typescript|react|vue|html|css|小程序|web/, ["终端bg", "云计算bu", "ictbg", "2012实验室"], ["软件", "公共开发", "云软件", "终端", "计算", "应用"], 78);
  add(/后端|服务端|java|python|node|golang|go语言|数据库|mysql|spring/, ["云计算bu", "ictbg", "2012实验室", "终端bg"], ["云软件", "软件研发", "公共开发", "云核心网", "数据存储", "计算"], 76);
  add(/软件|开发|编程|工程师|developer|engineer/, ["云计算bu", "终端bg", "ictbg", "2012实验室"], ["软件", "开发", "计算", "云", "数据"], 52);
  add(/数据|sql|大数据|数据仓库|分析|spark|hadoop/, ["云计算bu", "2012实验室", "ictbg"], ["数据存储", "数据通信", "计算", "云软件", "公共开发"], 76);
  add(/人工智能|ai|算法|机器学习|深度学习|pytorch|tensorflow|大模型/, ["2012实验室", "云计算bu", "智能汽车解决方案bu", "终端bg"], ["计算", "算法", "人工智能", "云", "软件"], 82);
  add(/网络|通信|安全|隐私|tcp|ip|5g|无线/, ["ictbg", "2012实验室", "云计算bu"], ["数据通信", "云核心网", "无线网络", "网络", "安全"], 80);
  add(/嵌入式|c\+\+|c语言|鸿蒙|harmony|驱动|硬件|芯片|器件/, ["终端bg", "芯片与器件bu", "半导体业务部", "智能汽车解决方案bu"], ["芯片", "器件", "终端", "计算", "公共开发"], 82);
  add(/云|cloud|容器|docker|kubernetes|微服务/, ["云计算bu", "ictbg", "2012实验室"], ["云软件", "云核心网", "计算", "数据存储"], 84);
  return score;
}

async function collectHuaweiOptionTexts() {
  const values = [];
  let lastTop = -1;
  for (let round = 0; round < 12; round += 1) {
    for (const option of visibleHuaweiOptions()) {
      const text = String(option.innerText || option.textContent || "").replace(/\s+/g, " ").trim();
      if (text && !values.includes(text)) values.push(text);
    }
    const popup = [...document.querySelectorAll(".aui-popup, .aui-select-popover-popper")].find(isVisible);
    const scroller = popup?.querySelector(".aui-recycle-list, .pc-list, [class*='scroll']");
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight || scroller.scrollTop === lastTop) break;
    lastTop = scroller.scrollTop;
    scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + Math.max(180, scroller.clientHeight * 0.8));
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await wait(120);
  }
  return values;
}

async function clickHuaweiOptionByText(input, desiredText) {
  for (let round = 0; round < 12; round += 1) {
    const option = visibleHuaweiOptions().find((item) => {
      const text = String(item.innerText || item.textContent || "").replace(/\s+/g, " ").trim();
      return text === desiredText;
    });
    if (option) {
      const value = String(option.innerText || option.textContent || "").replace(/\s+/g, " ").trim();
      option.click();
      await wait(550);
      return value;
    }
    const popup = [...document.querySelectorAll(".aui-popup, .aui-select-popover-popper")].find(isVisible);
    const scroller = popup?.querySelector(".aui-recycle-list, .pc-list, [class*='scroll']");
    if (!scroller) break;
    scroller.scrollTop = round === 0 ? 0 : scroller.scrollTop + Math.max(180, scroller.clientHeight * 0.8);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await wait(120);
  }
  return "";
}

async function closeHuaweiPopup() {
  const popup = [...document.querySelectorAll(".aui-popup, .aui-select-popover-popper")].find(isVisible);
  if (!popup) return;
  const outside = document.querySelector("header, .header, .details-item.position-intention .item-title, .job-detail-title, h1") || document.body;
  // AUI/Popper 使用 document 级的 pointer/mouse down 判断“点到外面”，单独调用
  // HTMLElement.click() 不足以关闭多选弹层，因此补齐正常指针事件序列。
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    outside.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  await wait(220);
}

async function selectHuaweiOption(input, preferredText) {
  input.scrollIntoView({ block: "center", behavior: "instant" });
  input.click();
  await wait(350);
  let options = visibleHuaweiOptions();
  if (!options.length) return "";
  const desiredTerms = splitTerms(preferredText);
  const findPreferred = () => options.find((option) => {
    const text = String(option.innerText || option.textContent || "").replace(/\s+/g, " ").trim();
    return preferredText && (text === preferredText || text.includes(preferredText) || desiredTerms.some((term) => text.includes(term)));
  });
  let chosen = findPreferred();
  // 部门列表使用虚拟滚动，目标部门不一定首屏渲染；逐屏寻找后才使用首项兜底。
  for (let round = 0; !chosen && preferredText && round < 10; round += 1) {
    const popup = [...document.querySelectorAll(".aui-popup")].find(isVisible);
    const scroller = popup?.querySelector(".aui-recycle-list, .pc-list");
    if (!scroller) break;
    scroller.scrollTop += Math.max(180, scroller.clientHeight * 0.8);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await wait(120);
    options = visibleHuaweiOptions();
    chosen = findPreferred();
  }
  chosen ||= options[0];
  const value = String(chosen.innerText || chosen.textContent || "").replace(/\s+/g, " ").trim();
  chosen.click();
  await wait(450);
  return value;
}

function visibleHuaweiOptions() {
  return [...document.querySelectorAll(".aui-popup .option, .aui-select-popover-popper .option")]
    .filter(isVisible)
    .filter((option) => String(option.innerText || option.textContent || "").trim());
}

function requestHuaweiOfficialJobs(recruitmentTypes) {
  return new Promise((resolve, reject) => {
    const requestId = `huawei-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("读取华为官网岗位超时"));
    }, 30000);
    function onMessage(event) {
      const response = event.data;
      if (event.source !== window || response?.source !== "resume-pilot-huawei-official-response" || response.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (!response.ok) reject(new Error(response.error || "华为官网岗位读取失败"));
      else resolve(Array.isArray(response.jobs) ? response.jobs : []);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({
      source: "resume-pilot-huawei-official-request",
      requestId,
      recruitmentTypes
    }, location.origin);
  });
}

function stripHtml(value) {
  const box = document.createElement("div");
  box.innerHTML = String(value || "");
  return String(box.textContent || "").replace(/\s+/g, " ").trim();
}

async function collectOfficialJobPages(profile, collected) {
  if (pagerItems().length > 1 && currentJobPageNumber() !== 1) await clickJobPageNumber(1);
  // 同时支持无限滚动和传统分页。最多读取 8 页/80 个岗位，避免异常页面无限循环。
  for (let pageRound = 0; pageRound < 8; pageRound += 1) {
    let unchangedRounds = 0;
    let lastHeight = 0;
    for (let scrollRound = 0; scrollRound < 6; scrollRound += 1) {
      for (const item of scanJobList(profile)) collected.set(item.url, item);
      const height = document.documentElement.scrollHeight;
      if (height === lastHeight) unchangedRounds += 1;
      else unchangedRounds = 0;
      lastHeight = height;
      if (collected.size >= 80 || unchangedRounds >= 2) break;
      window.scrollTo({ top: Math.min(height, window.scrollY + Math.max(window.innerHeight * 0.85, 650)), behavior: "instant" });
      await wait(500);
    }
    if (collected.size >= 80 || !(await moveToNextJobPage())) break;
  }
}

async function selectOfficialPositionType(profile) {
  const desired = /实习|intern/i.test(profile.positionType || "")
    ? /^(实习生|实习|interns?)$/i
    : (/校园|校招|应届|graduate|campus/i.test(profile.positionType || "") ? /^(应届生|校园招聘|校招|graduate|campus)$/i : null);
  if (!desired) return false;
  if (location.hostname === "join.qq.com") {
    const labels = [...document.querySelectorAll("label")].filter(isVisible);
    const wanted = /实习|intern/i.test(profile.positionType || "") ? ["应届实习", "日常实习"] : ["2027校园招聘"];
    let changed = false;
    for (const text of wanted) {
      const label = labels.find((item) => String(item.innerText || item.textContent || "").replace(/\s+/g, " ").trim() === text);
      const checkbox = label?.querySelector("input[type='checkbox']");
      if (label && !checkbox?.checked && !label.classList.contains("is-checked")) {
        const before = jobPageSignature();
        label.click();
        await waitForJobListChange(before);
        changed = true;
      }
    }
    return changed;
  }
  const control = [...document.querySelectorAll("label[role='radio'], [role='radio'], button, label")]
    .find((element) => isVisible(element) && desired.test(String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()));
  if (!control || control.getAttribute("aria-checked") === "true" || control.classList.contains("is-active")) return false;
  const before = jobPageSignature();
  control.click();
  await waitForJobListChange(before);
  return true;
}

function findOfficialSearchInput() {
  return [...document.querySelectorAll("input:not([type]), input[type='text'], input[type='search']")]
    .find((input) => {
      if (!isVisible(input)) return false;
      const descriptor = `${input.placeholder || ""} ${input.getAttribute("aria-label") || ""} ${input.name || ""}`;
      return /(搜索|关键字|关键词|职位|岗位|search|keyword|job|position)/i.test(descriptor);
    }) || null;
}

function findOfficialSearchButton(input = null) {
  const scopes = input ? [
    input.closest("form"),
    input.parentElement?.parentElement,
    input.closest("[class*='search'], [class*='filter']")?.parentElement,
    document
  ].filter(Boolean) : [document];
  for (const scope of scopes) {
    const button = [...scope.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
      .find((element) => isVisible(element) && /^(搜索|查询|查找|search)$/i.test(String(element.innerText || element.value || element.textContent || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()));
    if (button) return button;
  }
  return null;
}

function detectResumeCreationPrompt() {
  const promptPattern = /(未创建.{0,20}简历|尚未创建.{0,20}简历|先创建.{0,12}简历|需要创建.{0,12}简历|创建对应的简历|完善.{0,12}(?:在线)?简历|create.{0,20}resume|complete.{0,20}(?:resume|profile))/i;
  const containers = [...document.querySelectorAll("[role='dialog'], dialog, .jump-resume-modal, [class*='modal'], [class*='dialog']")]
    .filter(isVisible)
    .filter((element) => promptPattern.test(String(element.innerText || element.textContent || "").replace(/\s+/g, " ")));
  const container = containers[0];
  if (!container) return null;
  const confirm = [...container.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
    .filter(isVisible)
    .find((element) => /^(确认|确定|继续|去创建|创建简历|立即创建|完善简历|confirm|continue|create)$/i.test(String(element.innerText || element.value || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()))
    || container.querySelector(".aui-modal-button-confirm");
  return {
    container,
    confirm,
    text: String(container.innerText || container.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180)
  };
}

function detectApplicationContinuationPrompt() {
  const container = [...document.querySelectorAll(".jump-resume-modal, [role='dialog'], dialog")]
    .filter(isVisible)
    .find((element) => {
      const text = String(element.innerText || element.textContent || "");
      return /(简历|申请|投递|resume|application)/i.test(text)
        && !/(只可投递\s*1\s*个岗位|已经投递过|是否更换成|更换岗位|替换.*(?:岗位|申请)|replace.*application)/i.test(text);
    });
  if (!container) return null;
  const confirm = [...container.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
    .filter(isVisible)
    .find((element) => /^(确认|确定|继续|去预览|去完善|立即申请|confirm|continue)$/i.test(buttonText(element)))
    || container.querySelector(".aui-modal-button-confirm");
  return confirm ? { container, confirm } : null;
}

function detectApplicationConflict() {
  const pattern = /(只可投递\s*1\s*个岗位|已经投递过|已投递(?:其他|过).*岗位|是否更换成|更换(?:为|成)?.*岗位|替换.*(?:岗位|申请)|replace.*(?:job|application))/i;
  const container = [...document.querySelectorAll("[role='dialog'], dialog, [class*='modal'], [class*='dialog'], .model")]
    .filter(isVisible)
    .find((element) => pattern.test(String(element.innerText || element.textContent || "").replace(/\s+/g, " ")));
  return container ? {
    container,
    text: String(container.innerText || container.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240)
  } : null;
}

function getRecruitmentSiteAdapter() {
  if (location.hostname === "career.huawei.com") {
    return {
      id: "huawei-campus",
      name: "华为校园招聘",
      verified: true,
      filterMethod: "官网公开岗位接口 + 招聘类型",
      listMethod: "advertisementId 直达详情",
      detailPattern: "job-details?advertisementId=",
      applicationMethod: "岗位意向/地点/部门 → 申请 → 站内简历"
    };
  }
  if (location.hostname === "join.qq.com") {
    return {
      id: "tencent-campus",
      name: "腾讯校园招聘",
      verified: true,
      filterMethod: "应届实习/日常实习复选框 + 官网关键词查看",
      listMethod: ".post_box → 官网生成 post_detail.html?postid=… → 同标签进入",
      detailPattern: "post_detail.html?postid=",
      applicationMethod: "投递简历 → 登录/检查既有申请 → resumeedit.html",
      limitation: "官网同一阶段可能只允许保留一个岗位；更换既有申请必须暂停确认"
    };
  }
  return {
    id: "generic-discovery",
    name: location.hostname,
    verified: false,
    filterMethod: "先探测官网搜索框、筛选控件和结果变化",
    listMethod: "验证真实链接或岗位卡点击后再进入详情",
    detailPattern: "由页面实测确认",
    applicationMethod: "详情页识别登录、验证码、申请入口和表单"
  };
}

function isResumeCreationPage() {
  if (detectResumeCreationPrompt()) return false;
  const text = (document.body?.innerText || "").slice(0, 20000);
  const urlSignal = /(?:resume|cv|profile)(?:[-_/]|$|\?)/i.test(`${location.pathname}${location.search}`);
  const explicitHeading = /(创建(?:在线)?简历|新建(?:在线)?简历|填写简历|完善(?:在线)?简历|我的简历|create resume|build (?:your )?resume|candidate profile)/i.test(text);
  const sectionHeading = /(基本信息|教育经历|求职意向|工作经历|项目经历|personal information|education|work experience)/i.test(text);
  const formSignal = [...document.querySelectorAll("input, textarea, select")].filter(isVisible).length >= 1;
  return Boolean(formSignal && (explicitHeading || (urlSignal && sectionHeading)));
}

function inspectRecruitmentFlow(profile = {}) {
  const login = detectLoginRequired();
  const captcha = detectCaptcha();
  const resumePrompt = detectResumeCreationPrompt();
  const resumeCreationPage = isResumeCreationPage();
  const applicationConflict = detectApplicationConflict();
  const siteAdapter = getRecruitmentSiteAdapter();
  const formPresent = hasApplicationForm();
  const searchInput = findOfficialSearchInput();
  const searchButton = findOfficialSearchButton(searchInput);
  const scannedCandidates = scanJobList(profile);
  const directJobLinks = scannedCandidates.filter((item) => !item.clickToken).length;
  // 流程识别应判断官网是否存在可点击岗位卡，而不是要求卡片先通过本轮岗位关键词评分。
  // 否则“有岗位列表但当前词未命中”会被错误识别成没有详情入口。
  const clickCards = Math.max(scannedCandidates.filter((item) => item.clickToken).length, findClickableJobCards().length);
  const embeddedFrame = [...document.querySelectorAll("iframe[src]")]
    .find((frame) => isVisible(frame) && /(job|career|recruit|position|vacanc|apply|ats|workday|greenhouse|lever)/i.test(frame.src || ""));
  const applicationEntries = [...document.querySelectorAll("a[href], button, [role='button'], input[type='button']")]
    .filter(isVisible)
    .filter((node) => /^(申请|投递|立即申请|立即投递|申请职位|投递简历|投递该职位|开始申请|apply|apply now|apply for|apply this job)$/i.test(String(node.innerText || node.value || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()));
  const entrances = discoverJobEntrances();
  let pageType = "unknown";
  if (login) pageType = "login";
  else if (captcha) pageType = "captcha";
  else if (applicationConflict) pageType = "application_conflict";
  else if (resumePrompt) pageType = "resume_create_prompt";
  else if (resumeCreationPage) pageType = "resume_create";
  else if (formPresent) pageType = "application";
  else if (applicationEntries.length) pageType = "detail";
  else if (searchInput || directJobLinks || clickCards || pagerItems().length) pageType = "list";
  else if (embeddedFrame) pageType = "embedded";
  else if (entrances.length) pageType = "landing";
  const openMethod = directJobLinks ? "direct_link" : (clickCards ? "click_card" : "unknown");
  const pagination = pagerItems().length > 1 ? "numbered" : (document.documentElement.scrollHeight > innerHeight * 1.8 ? "scroll_or_single" : "single");
  const searchMethod = searchInput ? (searchButton ? "button" : "enter_or_live") : "none";
  const summaryMap = {
    landing: "介绍页→职位入口",
    list: `岗位列表→${searchMethod === "button" ? "按钮筛选" : searchMethod === "enter_or_live" ? "回车/即时筛选" : "扩展评分"}→${openMethod === "direct_link" ? "岗位链接" : openMethod === "click_card" ? "点击岗位卡" : "待验证入口"}`,
    detail: "岗位详情→申请入口",
    login: "登录页→登录后返回申请",
    application: "申请表→填写→提交前校验",
    application_conflict: "官网检测到既有申请→暂停确认是否更换岗位",
    resume_create_prompt: "岗位申请→官网要求先创建站内简历",
    resume_create: "站内简历→按导入资料逐步创建→返回岗位",
    captcha: "验证码→按用户策略处理",
    embedded: "嵌入式招聘系统→打开独立岗位页面",
    unknown: "尚未识别，使用通用探测"
  };
  return {
    url: location.href,
    host: location.hostname,
    pageType,
    login,
    captcha,
    formPresent,
    resumeCreationRequired: Boolean(resumePrompt),
    resumeCreationPage,
    searchMethod,
    openMethod,
    pagination,
    directJobLinks,
    clickCards,
    applicationEntries: applicationEntries.length,
    embeddedUrl: embeddedFrame?.src || "",
    entrances: entrances.length,
    applicationConflict: Boolean(applicationConflict),
    applicationConflictText: applicationConflict?.text || "",
    siteAdapter,
    summary: siteAdapter.verified
      ? `${siteAdapter.name}：${siteAdapter.filterMethod}→${siteAdapter.listMethod}→${siteAdapter.applicationMethod}`
      : summaryMap[pageType]
  };
}

function buildOfficialSearchTerms(profile) {
  const raw = String(profile.targetRole || "").replace(/(实习生?|校园招聘|校招|应届生?)/gi, " ").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const terms = splitTerms(raw).slice(0, 3);
  if (/前端/i.test(raw)) terms.push("前端");
  if (/后端|后台|服务端/i.test(raw)) terms.push("后台");
  if (/全栈/i.test(raw)) terms.push("全栈");
  if (/客户端/i.test(raw)) terms.push("客户端");
  if (/前端|后端|后台|全栈|客户端|java|javascript|软件/i.test(raw)) terms.push("软件开发工程师");
  if (/算法|机器学习|深度学习|ai|人工智能|大模型/i.test(raw)) terms.push("AI模型工程师", "算法工程师");
  if (/数据|分析/i.test(raw)) terms.push("数据工程师");
  return [...new Set([raw, ...terms].map((term) => term.trim()).filter((term) => term.length > 1))];
}

async function runOfficialKeywordSearch(input, term) {
  if (!input) return false;
  const before = jobPageSignature();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter ? setter.call(input, term) : (input.value = term);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  // 很多官网（包括华为）把按钮放在输入框组件的兄弟节点，不能只在最近的
  // `.search-*` 容器里找。按“表单 → 上层区域 → 全页面”逐级扩大范围。
  const tencentSearchButton = location.hostname === "join.qq.com" ? input.closest(".search_box")?.querySelector(".search_text") : null;
  const searchButton = tencentSearchButton || findOfficialSearchButton(input);
  if (searchButton) searchButton.click();
  else {
    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
  }
  let changed = await waitForJobListChange(before);
  // 某些 Vue/React 页面第一次只同步输入值；若没有任何列表变化，再用全页按钮重试一次。
  if (!changed) {
    const fallbackButton = findOfficialSearchButton();
    if (fallbackButton && fallbackButton !== searchButton) {
      fallbackButton.click();
      changed = await waitForJobListChange(before);
    }
  }
  return changed;
}

async function waitForJobListChange(before) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await wait(250);
    const after = jobPageSignature();
    if (after !== before) return true;
  }
  return false;
}

function findPagerContainer() {
  const specific = document.querySelector(".aui-pager, .pagination, [class*='pagination']");
  if (specific) return specific;
  return [...document.querySelectorAll("[class*='pager']")].find((element) =>
    [...element.querySelectorAll("li, button, a, [role='button']")]
      .filter((item) => /^\d+$/.test(String(item.innerText || item.textContent || "").trim())).length >= 2
  ) || null;
}

function pagerItems() {
  const container = findPagerContainer();
  if (!container) return [];
  return [...container.querySelectorAll("li, button, a, [role='button']")]
    .filter(isVisible)
    .map((element) => ({ element, text: String(element.innerText || element.textContent || "").trim() }))
    .filter((item) => /^\d+$/.test(item.text));
}

function currentJobPageNumber() {
  const items = pagerItems();
  const current = items.find(({ element }) =>
    element.getAttribute("aria-current") === "page" || /(^|\s)is-active(\s|$)|(^|[-_])current($|[-_])|(^|[-_])selected($|[-_])/i.test(String(element.className || ""))
  );
  return Number(current?.text || items[0]?.text || 1);
}

function jobPageSignature() {
  const countText = (document.body?.innerText || "").match(/共\s*\d+\s*(?:个岗位|条)/)?.[0] || "";
  const cards = findClickableJobCards().slice(0, 3).map(cardClickSignature).join("|");
  const links = [...document.querySelectorAll("a[href]")].filter(isVisible).slice(0, 8).map((link) => `${link.href}|${link.innerText}`).join("|");
  return `${location.search}|${countText}|${cards || links}`;
}

async function clickJobPageNumber(number) {
  const target = pagerItems().find((item) => Number(item.text) === number)?.element;
  if (!target) return false;
  const before = jobPageSignature();
  target.click();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(250);
    const after = jobPageSignature();
    if (after && after !== before) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return true;
    }
  }
  return false;
}

async function moveToNextJobPage() {
  const items = pagerItems();
  if (items.length < 2) return false;
  const current = currentJobPageNumber();
  const next = items.map((item) => Number(item.text)).filter((number) => number > current).sort((a, b) => a - b)[0];
  return next ? clickJobPageNumber(next) : false;
}

function getRecommendedJobListUrl(profile) {
  const company = ResumePilotScoring.findCompany(`${document.title} ${document.body?.innerText?.slice(0, 500) || ""}`, location.href);
  if (!company?.jobListUrls) return "";
  const useIntern = /实习|intern/i.test(profile.positionType || "");
  const target = useIntern ? company.jobListUrls.intern : company.jobListUrls.campus;
  if (!target || canonicalPageUrl(target) === canonicalPageUrl(location.href)) return "";
  return target;
}

function discoverJobEntrances() {
  const pattern = /(查看职位|搜索职位|职位搜索|浏览职位|全部职位|在招职位|热招职位|立即投递|开始申请|加入我们|view jobs|search jobs|open positions|apply now)/i;
  return [...document.querySelectorAll("a[href], button, [role='button']")]
    .filter((element) => isVisible(element) && pattern.test(element.innerText || element.textContent || element.getAttribute("aria-label") || ""))
    .slice(0, 12)
    .map((element, index) => ({
      index,
      label: String(element.innerText || element.textContent || element.getAttribute("aria-label") || "职位入口").replace(/\s+/g, " ").trim().slice(0, 60),
      url: element.tagName === "A" ? element.href : ""
    }));
}

function clickJobEntrance(index) {
  const entrances = discoverJobEntrances();
  const selected = entrances[index];
  if (!selected) throw new Error("职位入口已变化，请重新扫描");
  if (selected.url) {
    location.href = selected.url;
  } else {
    const pattern = new RegExp(selected.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const element = [...document.querySelectorAll("button, [role='button']")].find((node) => pattern.test(node.innerText || node.textContent || ""));
    if (!element) throw new Error("无法定位职位入口按钮");
    element.click();
  }
  return { navigating: true };
}

async function openApplication() {
  const login = detectLoginRequired();
  const captcha = detectCaptcha();
  const formPresent = hasApplicationForm();
  if (login || captcha || formPresent) return { clicked: false, login, captcha, formPresent };
  const existingConflict = detectApplicationConflict();
  if (existingConflict) {
    return { clicked: false, login: false, captcha: false, formPresent: false, applicationConflict: true, conflictText: existingConflict.text };
  }
  const existingPrompt = detectResumeCreationPrompt();
  if (existingPrompt) {
    if (!existingPrompt.confirm) {
      return { clicked: false, login: false, captcha: false, formPresent: false, resumeCreationRequired: true, creatingResume: false };
    }
    setTimeout(() => existingPrompt.confirm.click(), 40);
    return { clicked: true, login: false, captcha: false, formPresent: false, resumeCreationRequired: true, creatingResume: true };
  }
  const existingContinuation = detectApplicationContinuationPrompt();
  if (existingContinuation) {
    setTimeout(() => existingContinuation.confirm.click(), 40);
    return { clicked: true, login: false, captcha: false, formPresent: false, continuingApplication: true };
  }
  const candidates = [...document.querySelectorAll("a[href], button, [role='button'], input[type='button']")]
    .filter(isVisible)
    .filter((node) => /^(申请|投递|立即申请|立即投递|申请职位|投递简历|投递该职位|开始申请|apply|apply now|apply for|apply this job)$/i.test(String(node.innerText || node.value || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()));
  const target = candidates[0];
  if (!target) return { clicked: false, login: false, captcha: false, formPresent: false };
  target.click();
  await wait(550);
  const conflict = detectApplicationConflict();
  if (conflict) {
    return { clicked: true, login: false, captcha: false, formPresent: false, applicationConflict: true, conflictText: conflict.text };
  }
  const prompt = detectResumeCreationPrompt();
  if (prompt?.confirm) {
    setTimeout(() => prompt.confirm.click(), 40);
    return { clicked: true, login: false, captcha: false, formPresent: false, resumeCreationRequired: true, creatingResume: true };
  }
  const continuation = detectApplicationContinuationPrompt();
  if (continuation) {
    setTimeout(() => continuation.confirm.click(), 40);
    return { clicked: true, login: false, captcha: false, formPresent: false, continuingApplication: true };
  }
  return { clicked: true, login: false, captcha: false, formPresent: hasApplicationForm(), resumeCreationRequired: Boolean(prompt), creatingResume: false };
}

async function createResumeFromProfile(profile, knownAnswers = {}, resumeFile = null) {
  const login = detectLoginRequired();
  const captcha = detectCaptcha();
  const prompt = detectResumeCreationPrompt();
  if (login || captcha) {
    return { resumeCreationPage: false, login, captcha, filled: 0, unknown: 0, unknownFields: [] };
  }
  if (prompt) {
    if (!prompt.confirm) {
      return { resumeCreationPage: false, resumeCreationRequired: true, navigating: false, filled: 0, unknown: 0, unknownFields: [] };
    }
    setTimeout(() => prompt.confirm.click(), 40);
    return { resumeCreationPage: false, resumeCreationRequired: true, navigating: true, filled: 0, unknown: 0, unknownFields: [] };
  }

  const resumeCreationPage = isResumeCreationPage();
  const text = (document.body?.innerText || "").slice(0, 20000);
  const completed = /(简历创建成功|简历保存成功|已成功创建简历|resume (?:created|saved) successfully)/i.test(text);
  if (completed) {
    return { resumeCreationPage, complete: true, filled: 0, unknown: 0, unknownFields: [] };
  }
  if (!resumeCreationPage) {
    return { resumeCreationPage: false, complete: false, filled: 0, unknown: 0, unknownFields: [] };
  }

  const fillResult = fillApplication(profile, knownAnswers, resumeFile, { allowResumeCreationPage: true });
  if (fillResult.unknown > 0 || fillResult.captcha || fillResult.login) {
    return { ...fillResult, resumeCreationPage: true, action: "waiting_fields" };
  }

  const action = findResumeCreationAction();
  if (!action) {
    return { ...fillResult, resumeCreationPage: true, action: "none", advanced: false, saved: false };
  }
  if (action.disabled || action.getAttribute("aria-disabled") === "true") {
    return { ...fillResult, resumeCreationPage: true, action: "disabled", advanced: false, saved: false };
  }
  const finalAction = /^(完成|创建简历|立即创建|保存简历|确认创建|保存并完成|保存并返回|保存|提交|finish|create resume|save resume|save|submit)$/i.test(buttonText(action));
  if (finalAction && document.documentElement.getAttribute("data-resume-pilot-resume-final-clicked") === "true") {
    return { ...fillResult, resumeCreationPage: true, action: "saving", advanced: false, saved: false };
  }
  if (finalAction) document.documentElement.setAttribute("data-resume-pilot-resume-final-clicked", "true");
  setTimeout(() => action.click(), 40);
  return {
    ...fillResult,
    resumeCreationPage: true,
    action: finalAction ? "save" : "advance",
    actionLabel: buttonText(action),
    advanced: !finalAction,
    saved: finalAction
  };
}

function buttonText(element) {
  return String(element?.innerText || element?.value || element?.textContent || element?.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim();
}

function findResumeCreationAction() {
  const buttons = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
    .filter(isVisible)
    .filter((element) => !/^(返回|上一步|取消|关闭|back|previous|cancel|close)$/i.test(buttonText(element)));
  const next = buttons.find((element) => /^(下一步|保存并下一步|继续|下一页|next|save and continue|continue)$/i.test(buttonText(element)));
  if (next) return next;
  const final = buttons.find((element) => /^(完成|创建简历|立即创建|保存简历|确认创建|保存并完成|finish|create resume|save resume)$/i.test(buttonText(element)));
  if (final) return final;
  return buttons.find((element) => /^(保存并返回|保存|提交|save|submit)$/i.test(buttonText(element))) || null;
}

function hasApplicationForm() {
  const fields = [...document.querySelectorAll("input, textarea, select")].filter((field) => {
    const type = String(field.type || "").toLowerCase();
    return isVisible(field) && !field.disabled && !["hidden", "search", "button", "submit", "reset", "radio", "checkbox", "password"].includes(type);
  });
  if (fields.length < 2) return false;
  const text = (document.body?.innerText || "").slice(0, 12000);
  const personalPattern = /(姓名|名字|手机号|联系电话|邮箱|电子邮件|学校|院校|专业|学历|教育经历|毕业年份|name|phone|mobile|e-?mail|university|college|major|degree|education)/i;
  const personalFields = fields.filter((field) => personalPattern.test(describeField(field)));
  if (personalFields.length >= 2) return true;
  // 只有“上传简历”推荐组件、搜索框、跳页输入框不构成申请表。
  const applicationContext = /(填写简历|个人信息|基本信息|教育经历|工作经历|申请表|application form|personal information|candidate profile)/i.test(text)
    || /\/(?:apply|application|resume)(?:\/|\?|$)/i.test(location.pathname);
  return applicationContext && personalFields.length >= 1 && fields.length >= 3;
}

function submitApplication() {
  if (detectCaptcha()) return { submitted: false, captcha: true };
  const candidates = [...document.querySelectorAll("button, [role='button'], input[type='submit']")]
    .filter(isVisible)
    .filter((node) => /^(提交申请|确认投递|提交简历|投递该职位|确认提交|submit application|submit)$/i.test(String(node.innerText || node.value || "").replace(/\s+/g, " ").trim()));
  const target = candidates[0];
  if (!target || target.disabled) return { submitted: false, captcha: false };
  target.click();
  return { submitted: true, captcha: false };
}

function detectApplicationSuccess() {
  const text = (document.body?.innerText || "").slice(0, 20000);
  const success = /(投递成功|申请成功|提交成功|已成功申请|application submitted|application received|thank you for applying)/i.test(text);
  return { success, url: location.href };
}

function detectLoginRequired() {
  const text = (document.body?.innerText || "").slice(0, 8000);
  const password = document.querySelector("input[type='password']");
  const accounts = loginAccountCandidates();
  return Boolean((password && /(登录|注册|验证码登录|sign in|log in)/i.test(text)) || (accounts.length && /(选择账号|账号登录|使用.*账号|choose.*account)/i.test(text)));
}

function loginAccountCandidates() {
  const selector = "[data-account-id], [class*='account-item'], [class*='account_item'], [class*='user-card'], [class*='user_item']";
  return [...document.querySelectorAll(selector)]
    .filter(isVisible)
    .filter((item) => {
      const text = String(item.innerText || item.textContent || "").replace(/\s+/g, " ").trim();
      return text && !/(添加账号|其他账号|使用其他|add account|other account)/i.test(text);
    });
}

async function tryAutoLogin() {
  const accounts = loginAccountCandidates();
  if (accounts.length > 1) return { status: "multiple_accounts", accountCount: accounts.length };
  if (accounts.length === 1) {
    accounts[0].click();
    return { status: "account_selected" };
  }
  const passwordFields = [...document.querySelectorAll("input[type='password']")].filter(isVisible);
  const hasAutofilledPassword = passwordFields.some((field) => Boolean(field.value));
  const loginButton = [...document.querySelectorAll("button, [role='button'], input[type='submit']")]
    .filter(isVisible)
    .find((node) => /^(登录|立即登录|登录并继续|sign in|log in|continue)$/i.test(String(node.innerText || node.value || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()));
  if (hasAutofilledPassword && loginButton && !loginButton.disabled) {
    loginButton.click();
    return { status: "submitted_saved_credentials" };
  }
  return { status: passwordFields.length ? "credentials_needed" : "not_ready" };
}

function canonicalPageUrl(value) {
  try {
    const url = new URL(value, location.href);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch { return String(value); }
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function scanJobList(profile) {
  const roleTerms = splitTerms(profile.targetRole);
  const skillTerms = splitTerms(profile.skills);
  const positionType = String(profile.positionType || "").trim();
  const company = inferPageCompany();
  const seen = new Set();
  const candidates = [];

  for (const link of document.querySelectorAll("a[href]")) {
    if (!isVisible(link)) continue;
    const url = new URL(link.href, location.href).href;
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const card = link.closest("li, article, tr, [class*='job'], [class*='position'], [class*='card'], [class*='item']");
    const text = String(card?.innerText || link.innerText || link.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    if (text.length < 4 || text.length > 1000 || !looksLikeJob(text, url, roleTerms, positionType, skillTerms)) continue;

    const companyEval = ResumePilotScoring.evaluateCompany(`${document.title} ${text}`, url, profile);
    const jobEval = ResumePilotScoring.evaluateJob(text, url, profile);
    const score = Math.round(companyEval.companyScore * 0.3 + jobEval.jobScore * 0.45 + jobEval.compensationScore * 0.25);

    seen.add(url);
    candidates.push({
      title: extractJobTitle(link, card, text),
      url,
      description: text.slice(0, 260),
      company: companyEval.company || company,
      resultType: "页面岗位",
      score,
      companyScore: companyEval.companyScore,
      jobScore: jobEval.jobScore,
      matchedSkills: jobEval.matchedSkills,
      skillEligible: jobEval.skillEligible,
      hardBlocked: jobEval.hardBlocked,
      compensationScore: jobEval.compensationScore,
      compensationLabel: jobEval.compensationLabel,
      confidence: companyEval.confidence,
      reasons: [...new Set([...companyEval.reasons, ...jobEval.reasons])].slice(0, 6),
      warnings: [...new Set([...companyEval.warnings, ...jobEval.warnings])].slice(0, 6),
      evidence: companyEval.evidence
    });
  }

  // 部分招聘站把整张岗位卡做成 SPA 点击区域，不提供 a[href]。
  // 为它们生成可重复定位的点击令牌，由后台在当前列表页中打开详情。
  const clickCards = findClickableJobCards();
  for (const [index, card] of clickCards.entries()) {
    const text = String(card.innerText || card.textContent || "").replace(/\s+/g, " ").trim();
    const title = extractCardJobTitle(card, text);
    const signature = cardClickSignature(card);
    if (!signature || text.length < 4 || text.length > 1000 || !looksLikeJob(text, location.href, roleTerms, positionType, skillTerms)) continue;
    if (candidates.some((item) => item.clickToken === signature)) continue;

    const companyEval = ResumePilotScoring.evaluateCompany(`${document.title} ${text}`, location.href, profile);
    const jobEval = ResumePilotScoring.evaluateJob(text, location.href, profile);
    const score = Math.round(companyEval.companyScore * 0.3 + jobEval.jobScore * 0.45 + jobEval.compensationScore * 0.25);
    const syntheticUrl = `${canonicalPageUrl(location.href)}#resume-pilot-job=${encodeURIComponent(signature)}`;

    candidates.push({
      title,
      url: syntheticUrl,
      sourceUrl: canonicalPageUrl(location.href),
      clickToken: signature,
      clickIndex: index,
      officialSearchTerm: findOfficialSearchInput()?.value || "",
      description: text.slice(0, 260),
      company: companyEval.company || company,
      resultType: "点击式岗位",
      score,
      companyScore: companyEval.companyScore,
      jobScore: jobEval.jobScore,
      matchedSkills: jobEval.matchedSkills,
      skillEligible: jobEval.skillEligible,
      hardBlocked: jobEval.hardBlocked,
      compensationScore: jobEval.compensationScore,
      compensationLabel: jobEval.compensationLabel,
      confidence: companyEval.confidence,
      reasons: [...new Set([...companyEval.reasons, ...jobEval.reasons])].slice(0, 6),
      warnings: [...new Set([...companyEval.warnings, ...jobEval.warnings])].slice(0, 6),
      evidence: companyEval.evidence
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 30);
}

function findClickableJobCards() {
  const selectors = [
    ".job-item", ".position-item", ".job-card", ".position-card", ".post_box",
    "[class*='job-list'] > li", "[class*='position-list'] > li",
    "[class*='vacancy']", "[class*='opening']", "[class*='recruit'] [class*='item']",
    "[data-job-id]", "[data-position-id]", "[data-jobid]", "[data-positionid]"
  ];
  const cards = [...document.querySelectorAll(selectors.join(","))]
    .filter(isVisible)
    .filter((card) => !card.querySelector("a[href*='job' i], a[href*='position' i], a[href*='career' i]"));
  return [...new Set(cards)].filter((card) => !cards.some((other) => other !== card && card.contains(other)));
}

function extractCardJobTitle(card, fallback) {
  const heading = card.querySelector(".job-name, .position-name, .post_title, [class*='job-name'], [class*='position-name'], h1, h2, h3, h4, [class*='title']")?.innerText;
  return String(heading || fallback).replace(/\s+/g, " ").trim().slice(0, 120);
}

function cardClickSignature(card) {
  const value = card.matches?.(".post_box") ? (card.innerText || card.textContent || "") : extractCardJobTitle(card, card.innerText || "");
  return normalizeClickSignature(value);
}

function normalizeClickSignature(value) {
  return String(value || "").toLowerCase().replace(/[\s|｜·—_\-（）()【】\[\]，,。.:：;/\\]/g, "").slice(0, 80);
}

function requestMainWorldJobClick(clickToken) {
  const root = document.documentElement;
  root.setAttribute("data-resume-pilot-click-token", clickToken);
  root.removeAttribute("data-resume-pilot-click-result");
  root.removeAttribute("data-resume-pilot-click-target-url");
  document.dispatchEvent(new Event("resume-pilot-open-job-main"));
  const result = root.getAttribute("data-resume-pilot-click-result") || "listener_missing";
  const targetUrl = root.getAttribute("data-resume-pilot-click-target-url") || "";
  root.removeAttribute("data-resume-pilot-click-token");
  root.removeAttribute("data-resume-pilot-click-result");
  root.removeAttribute("data-resume-pilot-click-target-url");
  return { clicked: result === "clicked", result, targetUrl, sameTabNavigation: Boolean(targetUrl) };
}

async function openScannedJob(clickToken, searchTerm = "") {
  const searchInput = findOfficialSearchInput();
  if (searchInput && searchInput.value !== searchTerm) await runOfficialKeywordSearch(searchInput, searchTerm);
  let cards = findClickableJobCards();
  let target = cards.find((card) => cardClickSignature(card) === clickToken);
  // 输入框可能已经显示关键词，但官网状态仍是旧列表。找不到目标时强制再次触发官网搜索。
  if (!target && searchInput && searchTerm) {
    await runOfficialKeywordSearch(searchInput, searchTerm);
    cards = findClickableJobCards();
    target = cards.find((card) => cardClickSignature(card) === clickToken);
  }
  if (!target && pagerItems().length > 1) {
    if (currentJobPageNumber() !== 1) await clickJobPageNumber(1);
    for (let attempt = 0; attempt < 8 && !target; attempt += 1) {
      cards = findClickableJobCards();
      target = cards.find((card) => cardClickSignature(card) === clickToken);
      if (!target && !(await moveToNextJobPage())) break;
    }
  }
  if (!target) throw new Error("岗位列表已变化，请重新扫描");
  const beforeUrl = location.href;
  target.scrollIntoView({ block: "center", behavior: "instant" });
  if (location.hostname === "join.qq.com" && target.matches?.(".post_box")) {
    const mainResult = requestMainWorldJobClick(clickToken);
    if (mainResult.clicked) {
      return { ...mainResult, beforeUrl, currentUrl: location.href, opening: true, adapter: "tencent-campus" };
    }
  }
  // 常见站点把事件绑定在岗位名称容器或整张卡片上；避开“收藏/分享”。
  const clickTarget = target.querySelector(".job-name, .position-name, .job-name-box, .position-name-box, [class*='job-title'], [class*='position-title']") || target;
  // 先回复后台，再执行点击。否则同标签页立即导航时消息端口会随旧页面销毁，
  // 后台会把“其实已经打开详情”误判成失败。
  setTimeout(() => clickTarget.click(), 40);
  return { clicked: true, beforeUrl, currentUrl: location.href, opening: true };
}

function looksLikeJob(text, url, roleTerms, positionType, skillTerms = []) {
  const haystack = `${text} ${url}`;
  const jobSignal = /(职位|岗位|招聘|实习|校招|应届|工程师|开发|产品|运营|设计|算法|测试|job|position|career|intern|engineer|developer)/i.test(haystack);
  const roleSignal = roleTerms.some((term) => haystack.toLowerCase().includes(term.toLowerCase()));
  const skillSignal = skillTerms.some((term) => haystack.toLowerCase().includes(term.toLowerCase()));
  const typeSignal = positionType && positionType !== "不限" && haystack.toLowerCase().includes(positionType.toLowerCase());
  return jobSignal && (roleSignal || skillSignal || typeSignal || /(position|job\/|jobdetail|职位详情)/i.test(url));
}

function splitTerms(value = "") {
  return String(value).split(/[\s，,、;；/|·()（）\-]+/).map((item) => item.trim()).filter((item) => item.length > 1);
}

function extractJobTitle(link, card, fallback) {
  const heading = card?.querySelector("h1, h2, h3, h4, [class*='title'], [class*='name']")?.innerText;
  const text = heading || link.innerText || link.getAttribute("aria-label") || fallback;
  return String(text).replace(/\s+/g, " ").trim().slice(0, 120);
}

function inferPageCompany() {
  const siteName = document.querySelector("meta[property='og:site_name']")?.content;
  if (siteName) return siteName.trim();
  const titlePart = document.title.split(/[|｜\-_—]/).map((part) => part.trim()).filter(Boolean).at(-1);
  return titlePart?.slice(0, 40) || location.hostname.replace(/^www\./, "");
}

function fillApplication(profile, knownAnswers = {}, resumeFile = null, options = {}) {
  document.getElementById("resume-pilot-assistant")?.remove();
  const formPresent = Boolean(hasApplicationForm() || (options.allowResumeCreationPage && isResumeCreationPage()
    && document.querySelector("input, textarea, select, input[type='file']")));
  if (!formPresent) {
    return {
      filled: 0,
      unknown: 0,
      unknownFields: [],
      captcha: detectCaptcha(),
      login: detectLoginRequired(),
      formPresent: false
    };
  }
  const fields = getCandidateFields();
  const unknown = [];
  let filled = 0;

  for (const field of fields) {
    field.classList.remove("resume-pilot-filled", "resume-pilot-unknown");
    if (!isEmpty(field)) continue;
    const descriptor = describeField(field);
    const label = humanLabel(field, descriptor);
    const answerKey = normalizeQuestion(label);
    const rule = FIELD_RULES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(descriptor)));
    const value = knownAnswers[answerKey] || (rule ? profile[rule.key] : "");

    if (value && setFieldValue(field, value)) {
      field.classList.add("resume-pilot-filled");
      filled += 1;
    } else if (isRequiredField(field)) {
      field.classList.add("resume-pilot-unknown");
      unknown.push({ field, label, key: answerKey, kind: "text" });
    }
  }

  for (const group of getRequiredChoiceGroups()) {
    const label = requiredChoiceLabel(group);
    const key = normalizeQuestion(label);
    const savedAnswer = knownAnswers[key];
    if (savedAnswer && setChoiceGroupValue(group, savedAnswer)) {
      group.classList.add("resume-pilot-filled");
      filled += 1;
    } else {
      group.classList.add("resume-pilot-unknown");
      unknown.push({ field: group, label, key, kind: "choice" });
    }
  }

  const resumeResult = attachStoredResume(resumeFile);
  filled += resumeResult.filled;
  unknown.push(...resumeResult.unknown);
  const captcha = detectCaptcha();
  showAssistant({ filled, unknown, captcha });
  return {
    filled,
    unknown: unknown.length,
    unknownFields: unknown.map((item) => ({ label: item.label, key: item.key, kind: item.kind })),
    captcha,
    login: detectLoginRequired(),
    formPresent: true
  };
}

function getCandidateFields() {
  return [...document.querySelectorAll("input, textarea, select")].filter((field) => {
    if (field.disabled || field.readOnly || !isVisible(field)) return false;
    const type = (field.type || "").toLowerCase();
    return !["hidden", "submit", "button", "reset", "file", "image", "password", "checkbox", "radio"].includes(type);
  });
}

function isRequiredField(field) {
  if (field.required || field.getAttribute("aria-required") === "true") return true;
  const wrapper = field.closest(".form-item, .form-group, .aui-form-item, [class*='form-item'], [class*='form_item']");
  if (!wrapper) return false;
  const label = wrapper.querySelector("label, .label, [class*='label']");
  const labelText = String(label?.innerText || label?.textContent || "").trim();
  return /(^|\s|：|:)\*|\*(\s|$)/.test(labelText) || Boolean(wrapper.querySelector("[class*='required'], .is-required"));
}

function getRequiredChoiceGroups() {
  const groups = new Set();
  for (const control of document.querySelectorAll("input[type='radio'], input[type='checkbox']")) {
    if (control.disabled) continue;
    const group = control.closest("fieldset, [role='radiogroup'], [role='group'], .form-item, .form-group, .aui-form-item, [class*='form-item'], [class*='form_item']");
    if (!group || !isVisible(group)) continue;
    const controls = [...group.querySelectorAll("input[type='radio'], input[type='checkbox']")].filter((item) => !item.disabled);
    if (!controls.length || controls.some((item) => item.checked)) continue;
    const required = controls.some((item) => item.required || item.getAttribute("aria-required") === "true")
      || Boolean(group.querySelector("[class*='required'], .is-required"))
      || /(^|\s|：|:)\*|\*(\s|$)/.test(String(group.querySelector("legend, label, .label, [class*='label']")?.textContent || ""));
    if (required) groups.add(group);
  }
  return [...groups];
}

function requiredChoiceLabel(group) {
  const heading = group.querySelector("legend, .form-label, .aui-form-item-label, [class*='form-label'], [class*='item-label']");
  const raw = String(heading?.innerText || heading?.textContent || group.getAttribute("aria-label") || group.innerText || "必选项")
    .replace(/\s+/g, " ").trim();
  return raw.replace(/^\*\s*/, "").split(/(?:是|否|同意|不同意|男|女)\s*$/)[0].slice(0, 60) || "必选项";
}

function setChoiceGroupValue(group, value) {
  const normalized = normalize(value);
  const choices = [...group.querySelectorAll("label, [role='radio'], [role='checkbox'], input[type='radio'], input[type='checkbox']")]
    .filter((item) => !item.disabled);
  const target = choices.find((item) => {
    const control = item.matches("input") ? item : item.querySelector("input[type='radio'], input[type='checkbox']");
    const label = String(item.innerText || item.textContent || control?.value || item.getAttribute("aria-label") || "");
    const candidate = normalize(label);
    return candidate && (candidate.includes(normalized) || normalized.includes(candidate));
  });
  if (!target) return false;
  const control = target.matches("input") ? target : target.querySelector("input[type='radio'], input[type='checkbox']");
  (control || target).click();
  return true;
}

function applyUnknownAnswer(item, value) {
  if (item.kind === "choice") return setChoiceGroupValue(item.field, value);
  return setFieldValue(item.field, value);
}

function isVisible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function isEmpty(field) {
  if (field.tagName === "SELECT") return !field.value;
  return !String(field.value || "").trim();
}

function describeField(field) {
  const label = field.labels ? [...field.labels].map((item) => item.innerText).join(" ") : "";
  const ariaLabelledBy = field.getAttribute("aria-labelledby");
  const ariaText = ariaLabelledBy
    ? ariaLabelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ")
    : "";
  const nearby = field.closest("label, .form-item, .form-group, [class*='field'], [class*='form']")?.innerText || "";
  return [label, ariaText, field.getAttribute("aria-label"), field.name, field.id, field.placeholder, nearby.slice(0, 120)]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function humanLabel(field, descriptor) {
  return (field.labels?.[0]?.innerText || field.getAttribute("aria-label") || field.placeholder || descriptor || "未命名字段")
    .replace(/[*：:]\s*$/, "").trim().slice(0, 60);
}

function setFieldValue(field, value) {
  if (field.tagName === "SELECT") {
    const normalized = normalize(value);
    const option = [...field.options].find((item) => normalize(item.textContent).includes(normalized) || normalized.includes(normalize(item.textContent)));
    if (!option) return false;
    field.value = option.value;
  } else {
    const prototype = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter ? setter.call(field, value) : (field.value = value);
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[\s_-]/g, "");
}

function normalizeQuestion(value) {
  return String(value).toLowerCase().replace(/[\s*：:？?（）()【】\[\]_-]/g, "").slice(0, 80);
}

function attachStoredResume(resumeFile) {
  const unknown = [];
  let filled = 0;
  for (const field of document.querySelectorAll("input[type='file']")) {
    if (field.disabled || field.files?.length) continue;
    const descriptor = describeField(field);
    if (!isVisible(field) && !/(简历|附件|上传|resume|curriculum|cv)/i.test(descriptor)) continue;
    const label = humanLabel(field, descriptor) || "上传简历附件";
    if (!resumeFile?.base64) {
      if (isRequiredField(field)) {
        unknown.push({ field, label, key: normalizeQuestion(label), kind: "file" });
      }
      continue;
    }
    try {
      const bytes = Uint8Array.from(atob(resumeFile.base64), (character) => character.charCodeAt(0));
      const file = new File([bytes], resumeFile.name || "resume.pdf", { type: resumeFile.type || "application/pdf" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      field.files = transfer.files;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.classList.add("resume-pilot-filled");
      filled += 1;
    } catch {
      unknown.push({ field, label, key: normalizeQuestion(label), kind: "file" });
    }
  }
  return { filled, unknown };
}

function detectCaptcha() {
  const selectors = [
    "iframe[src*='captcha' i]", "iframe[src*='recaptcha' i]", "iframe[src*='hcaptcha' i]",
    "[class*='captcha' i]", "[id*='captcha' i]", "[class*='geetest' i]", "[id*='geetest' i]"
  ];
  if (document.querySelector(selectors.join(","))) return true;
  return /(验证码|滑块验证|人机验证|安全验证|captcha|verify you are human)/i.test((document.body?.innerText || "").slice(0, 12000));
}

function showAssistant({ filled, unknown, captcha = false }) {
  const panel = document.createElement("aside");
  panel.id = "resume-pilot-assistant";

  const head = document.createElement("div");
  head.className = "rp-head";
  const title = document.createElement("strong");
  title.textContent = "简历领航 · 填写结果";
  const close = document.createElement("button");
  close.className = "rp-close";
  close.type = "button";
  close.textContent = "×";
  close.addEventListener("click", () => panel.remove());
  head.append(title, close);

  const body = document.createElement("div");
  body.className = "rp-body";
  const summary = document.createElement("p");
  summary.className = "rp-summary";
  summary.textContent = `已填写 ${filled} 项，${unknown.length ? `还有 ${unknown.length} 个必填项需要你确认。` : "没有发现未知必填项。"}${captcha ? " 页面还出现了验证码。" : ""}`;
  body.append(summary);

  for (const [index, item] of unknown.entries()) {
    const wrapper = document.createElement("div");
    wrapper.className = "rp-item";
    const label = document.createElement("label");
    label.htmlFor = `rp-answer-${index}`;
    label.textContent = item.label;
    const input = document.createElement("input");
    input.id = `rp-answer-${index}`;
    input.placeholder = item.kind === "file" ? "请先在扩展中保存简历附件" : "请填写；以后遇到同类字段会自动复用";
    input.disabled = item.kind === "file";
    input.dataset.index = String(index);
    wrapper.append(label, input);
    body.append(wrapper);
  }

  const actions = document.createElement("div");
  actions.className = "rp-actions";
  const apply = document.createElement("button");
  apply.className = "rp-primary";
  apply.type = "button";
  apply.textContent = unknown.length ? "应用我的回答" : "定位第一个提交按钮";
  apply.addEventListener("click", async () => {
    if (unknown.length) {
      const { knownAnswers = {} } = await chrome.storage.local.get("knownAnswers");
      panel.querySelectorAll("input[data-index]").forEach((input) => {
        const item = unknown[Number(input.dataset.index)];
        if (input.value.trim() && applyUnknownAnswer(item, input.value.trim())) {
          item.field.classList.remove("resume-pilot-unknown");
          item.field.classList.add("resume-pilot-filled");
          knownAnswers[item.key] = input.value.trim();
        }
      });
      await chrome.storage.local.set({ knownAnswers });
      summary.textContent = "回答已写入并记住。以后遇到同类字段会自动填写。";
      chrome.runtime.sendMessage({ type: "AUTOPILOT_ANSWERS_SAVED" }).catch(() => {});
    } else {
      locateSubmit();
    }
  });
  const inspect = document.createElement("button");
  inspect.className = "rp-secondary";
  inspect.type = "button";
  inspect.textContent = "从第一项开始检查";
  inspect.addEventListener("click", () => (document.querySelector(".resume-pilot-filled, .resume-pilot-unknown")?.scrollIntoView({ behavior: "smooth", block: "center" })));
  actions.append(apply, inspect);
  body.append(actions);

  const warning = document.createElement("div");
  warning.className = "rp-warning";
  warning.textContent = captcha
    ? "检测到验证码。自动投递会根据你的设置暂停等待或跳过当前岗位。"
    : "自动投递只会在资料完整且符合你设置的条件时继续。";
  body.append(warning);
  panel.append(head, body);
  document.documentElement.append(panel);
}

function showAutomationNotice(notice) {
  document.getElementById("resume-pilot-assistant")?.remove();
  const panel = document.createElement("aside");
  panel.id = "resume-pilot-assistant";
  const head = document.createElement("div");
  head.className = "rp-head";
  const title = document.createElement("strong");
  title.textContent = "简历领航 · 自动投递";
  head.append(title);
  const body = document.createElement("div");
  body.className = "rp-body";
  const summary = document.createElement("p");
  summary.className = "rp-summary";
  summary.textContent = notice.title || "自动投递状态更新";
  const detail = document.createElement("div");
  detail.className = "rp-warning";
  detail.textContent = notice.message || "请打开扩展查看详情。";
  body.append(summary, detail);
  panel.append(head, body);
  document.documentElement.append(panel);
}

function locateSubmit() {
  const candidates = [...document.querySelectorAll("button, input[type='submit']")];
  const submit = candidates.find((node) => /(提交|申请|投递|submit|apply)/i.test(node.innerText || node.value || ""));
  if (!submit) return;
  submit.scrollIntoView({ behavior: "smooth", block: "center" });
  submit.style.outline = "3px solid #2563eb";
  submit.style.outlineOffset = "3px";
}
