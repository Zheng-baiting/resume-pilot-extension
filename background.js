importScripts("scoring.js");

const SEARCH_URL = "https://www.bing.com/search?format=rss&q=";
const AUTO_STATE_KEY = "autopilotState";
let autopilotState = null;
let autoStepBusy = false;

// 这些入口来自企业公开招聘官网；它们只作为搜索种子，不代表对企业的背书或排名。
const VERIFIED_CAREER_SEEDS = ResumePilotScoring.companies.map((entry) => ({
  company: entry.company,
  domain: entry.domains[0],
  url: entry.careerUrl,
  jobListUrls: entry.jobListUrls || {},
  tags: entry.tags
}));

chrome.storage.local.get(AUTO_STATE_KEY).then((data) => {
  autopilotState = data[AUTO_STATE_KEY] || null;
  if (autopilotState?.active && autopilotState.status === "running" && autopilotState.tabId) {
    chrome.tabs.get(autopilotState.tabId)
      .then((tab) => scheduleAutoStep(tab.id, tab.status === "complete" ? 800 : 1800))
      .catch(() => moveToNextCompany("浏览器恢复后重新开始当前企业"));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") handlePendingManualScan(tabId).catch(() => {});
  if (changeInfo.status === "complete" && autopilotState?.active && autopilotState.tabId === tabId && autopilotState.status === "running") {
    scheduleAutoStep(tabId, 1400);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (autopilotState?.active && tab.openerTabId === autopilotState.tabId) {
    autopilotState.tabId = tab.id;
    autopilotState.lastMessage = "已在新标签页打开岗位详情";
    persistAutopilot().catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (autopilotState?.active && autopilotState.tabId === tabId) {
    autopilotState.tabId = null;
    moveToNextCompany("自动投递标签页被关闭");
  }
});

async function handleRuntimeMessage(message, sender) {
  if (message?.type === "SEARCH_OFFICIAL_CAREERS") return searchOfficialCareers(message.criteria);
  if (message?.type === "START_AUTOPILOT") return startAutopilot(message.profile || {});
  if (message?.type === "STOP_AUTOPILOT") return stopAutopilot();
  if (message?.type === "RESUME_AUTOPILOT") return resumeAutopilot();
  if (message?.type === "GET_AUTOPILOT_STATUS") return { state: autopilotState };
  if (message?.type === "AUTOPILOT_ANSWERS_SAVED") {
    if (autopilotState?.status === "waiting_info") return resumeAutopilot();
    return { state: autopilotState };
  }
  if (message?.type === "OPEN_MANUAL_JOB") return openManualJob(message.tabId || sender.tab?.id, message.item || {});
  if (message?.type === "NAVIGATE_AND_SCAN") return navigateAndScan(message.tabId || sender.tab?.id, message.url, message.profile || {});
  throw new Error("不支持的扩展操作");
}

async function searchOfficialCareers(criteria = {}) {
  const role = clean(criteria.role) || "校园招聘";
  const city = clean(criteria.city);
  const industry = clean(criteria.industry);
  const positionType = clean(criteria.positionType) || "实习";
  const skills = splitList(criteria.skills).slice(0, 8);
  const preferredCompanies = splitList(criteria.preferredCompanies).slice(0, 8);
  const page = Math.max(0, Number(criteria.page || 0));
  const pageSize = 6;

  const matchedSeeds = selectSeeds(industry, preferredCompanies);
  const pageSeeds = matchedSeeds.slice(page * pageSize, (page + 1) * pageSize);
  const companyQueries = preferredCompanies.map((company) =>
    `${company} ${role} ${city} ${positionType} 职位 官方招聘`
  );
  const seedQueries = pageSeeds.slice(0, 3).map((seed) =>
    `site:${seed.domain} ${role} ${city} ${positionType}`
  );
  const discoveryQueries = [
    `${role} ${city} ${industry} ${positionType} 职位 官方招聘 careers`,
    `${role} ${city} ${industry} ${positionType} 行业龙头 上市公司 科技公司 官方招聘`
  ];
  const queries = [...new Set([...(page === 0 ? companyQueries : []), ...seedQueries, ...(page === 0 ? discoveryQueries : [])])].slice(0, 7);

  const batches = await Promise.all(queries.map((query) => fetchRssResults(query).catch(() => [])));
  const deduped = new Map();

  for (const seed of pageSeeds) {
    const direct = makeSeedResult(seed, { ...criteria, role, city, industry, positionType, skills, preferredCompanies, matchedSeeds });
    deduped.set(canonicalUrl(direct.url), direct);
  }

  for (const item of batches.flat()) {
    if (!isLikelyCareerResult(item)) continue;
    const key = canonicalUrl(item.url);
    const scored = enrichResult(item, { ...criteria, role, city, industry, positionType, skills, preferredCompanies, matchedSeeds });
    if (!deduped.has(key) || deduped.get(key).score < scored.score) {
      deduped.set(key, scored);
    }
  }

  return {
    results: [...deduped.values()].sort((a, b) => b.score - a.score).slice(0, 24),
    page,
    hasMore: (page + 1) * pageSize < matchedSeeds.length,
    totalCompanies: matchedSeeds.length
  };
}

function selectSeeds(industry, preferredCompanies) {
  const industryTerms = splitList(industry);
  const preferred = VERIFIED_CAREER_SEEDS.filter((seed) =>
    preferredCompanies.some((name) => seed.company.includes(name) || name.includes(seed.company))
  );
  const relevant = VERIFIED_CAREER_SEEDS.filter((seed) =>
    !industryTerms.length || industryTerms.some((term) => seed.tags.some((tag) => tag.includes(term) || term.includes(tag)))
  );
  return [...new Map([...preferred, ...relevant, ...VERIFIED_CAREER_SEEDS].map((seed) => [seed.company, seed])).values()];
}

function makeSeedResult(seed, criteria) {
  const useIntern = /实习|intern/i.test(criteria.positionType);
  const url = useIntern ? (seed.jobListUrls.intern || seed.url) : (seed.jobListUrls.campus || seed.url);
  return enrichResult({
    title: `${seed.company}官方${useIntern ? "实习生" : "校园"}岗位`,
    url,
    description: `${seed.company}官方招聘岗位列表。方向：${seed.tags.join("、")}。进入后扩展会继续扫描并筛选具体岗位。`,
    query: "内置官方招聘入口",
    entryKind: "jobList"
  }, criteria);
}

async function fetchRssResults(query) {
  const response = await fetch(SEARCH_URL + encodeURIComponent(query));
  if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

  return items.map((match) => {
    const block = match[1];
    return {
      title: decodeXml(readTag(block, "title")),
      url: decodeXml(readTag(block, "link")),
      description: stripHtml(decodeXml(readTag(block, "description"))),
      query
    };
  });
}

function readTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "") : "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function splitList(value = "") {
  return String(value).split(/[，,、;；\n]/).map(clean).filter(Boolean);
}

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value;
  }
}

function isLikelyCareerResult(item) {
  if (!item.url?.startsWith("http")) return false;
  const haystack = `${item.title} ${item.description} ${item.url}`.toLowerCase();
  const blocked = ["zhihu.com", "bilibili.com", "douyin.com", "xiaohongshu.com", "tieba", "csdn.net"];
  if (blocked.some((domain) => haystack.includes(domain))) return false;
  return /(招聘|校招|应届|career|career[s]?|job|join|talent)/i.test(haystack);
}

function enrichResult(item, criteria) {
  const text = `${item.title} ${item.description} ${item.url}`.toLowerCase();
  const seed = criteria.matchedSeeds.find((candidate) => item.url.includes(candidate.domain));
  const companyEval = ResumePilotScoring.evaluateCompany(text, item.url, criteria);
  const jobEval = ResumePilotScoring.evaluateJob(text, item.url, {
    ...criteria,
    targetRole: criteria.role,
    targetCity: criteria.city,
    skills: criteria.skills.join(",")
  });
  const isPosition = !item.entryKind && /(position|jobdetail|job\/|职位详情|岗位详情)/i.test(item.url + item.title);
  const score = Math.round(companyEval.companyScore * 0.3 + jobEval.jobScore * 0.45 + jobEval.compensationScore * 0.25);
  return {
    ...item,
    company: companyEval.company || seed?.company || inferCompany(item),
    resultType: item.entryKind === "jobList" ? "岗位列表" : (isPosition ? "具体岗位" : "招聘入口"),
    score,
    companyScore: companyEval.companyScore,
    jobScore: jobEval.jobScore,
    compensationScore: jobEval.compensationScore,
    compensationLabel: jobEval.compensationLabel,
    confidence: companyEval.confidence,
    companyDimensions: companyEval.dimensions,
    reasons: [...new Set([...companyEval.reasons, ...jobEval.reasons])].slice(0, 6),
    warnings: [...new Set([...companyEval.warnings, ...jobEval.warnings])].slice(0, 6),
    evidence: companyEval.evidence
  };
}

function inferCompany(item) {
  const title = clean(item.title).split(/[|｜\-_—]/)[0];
  if (title && title.length <= 20) return title;
  try { return new URL(item.url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return "待核验企业"; }
}

async function startAutopilot(profile) {
  if (!profile.autoSubmitEnabled) throw new Error("请先勾选自动提交授权");
  const companies = selectSeeds(profile.targetIndustry || "", splitList(profile.preferredCompanies));
  if (!companies.length) throw new Error("没有可用的企业入口");
  autopilotState = {
    id: Date.now(),
    active: true,
    status: "running",
    stage: "company",
    resumeStage: "company",
    profile,
    companies,
    companyIndex: -1,
    applied: 0,
    skipped: 0,
    dailyLimit: Math.max(1, Math.min(30, Number(profile.dailyLimit || 5))),
    currentCompany: null,
    currentJob: null,
    tabId: null,
    navigationDepth: 0,
    startedAt: new Date().toISOString(),
    lastMessage: "自动投递已启动"
  };
  await persistAutopilot();
  await moveToNextCompany();
  return { state: autopilotState };
}

async function stopAutopilot() {
  if (autopilotState) {
    autopilotState.active = false;
    autopilotState.status = "stopped";
    autopilotState.lastMessage = "已手动停止";
    await persistAutopilot();
  }
  return { state: autopilotState };
}

async function resumeAutopilot() {
  if (!autopilotState) throw new Error("没有可继续的自动投递任务");
  autopilotState.active = true;
  autopilotState.status = "running";
  autopilotState.stage = autopilotState.resumeStage || autopilotState.stage || "scan";
  autopilotState.lastMessage = "已继续自动投递";
  await persistAutopilot();
  if (autopilotState.tabId) scheduleAutoStep(autopilotState.tabId, 500);
  else await moveToNextCompany();
  return { state: autopilotState };
}

async function moveToNextCompany(reason = "") {
  if (!autopilotState?.active) return;
  if (autopilotState.applied >= autopilotState.dailyLimit || autopilotState.companyIndex + 1 >= autopilotState.companies.length) {
    autopilotState.active = false;
    autopilotState.status = "completed";
    autopilotState.lastMessage = autopilotState.applied >= autopilotState.dailyLimit
      ? `已达到本次上限：${autopilotState.dailyLimit} 个岗位`
      : "所有候选企业已处理完成";
    await persistAutopilot();
    await notifyAutoTab(autopilotState.lastMessage, `成功/已尝试 ${autopilotState.applied}，跳过 ${autopilotState.skipped}`);
    return;
  }

  autopilotState.companyIndex += 1;
  autopilotState.currentCompany = autopilotState.companies[autopilotState.companyIndex];
  autopilotState.currentJob = null;
  autopilotState.stage = "scan";
  autopilotState.resumeStage = "scan";
  autopilotState.navigationDepth = 0;
  autopilotState.lastMessage = `${reason ? `${reason}；` : ""}正在查找 ${autopilotState.currentCompany.company} 的岗位`;
  const useIntern = /实习|intern/i.test(autopilotState.profile.positionType || "");
  const targetUrl = useIntern
    ? (autopilotState.currentCompany.jobListUrls?.intern || autopilotState.currentCompany.url)
    : (autopilotState.currentCompany.jobListUrls?.campus || autopilotState.currentCompany.url);
  await persistAutopilot();
  if (autopilotState.tabId) {
    try { await chrome.tabs.update(autopilotState.tabId, { url: targetUrl, active: true }); return; } catch {}
  }
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  autopilotState.tabId = tab.id;
  await persistAutopilot();
}

function scheduleAutoStep(tabId, delay = 1000) {
  setTimeout(() => runAutoStep(tabId).catch((error) => pauseAutopilot("error", error.message)), delay);
}

async function runAutoStep(tabId) {
  if (autoStepBusy || !autopilotState?.active || autopilotState.status !== "running" || autopilotState.tabId !== tabId) return;
  autoStepBusy = true;
  try {
    if (autopilotState.stage === "scan") await autoScanStage(tabId);
    else if (autopilotState.stage === "job") await autoJobStage(tabId);
    else if (autopilotState.stage === "apply") await autoApplyStage(tabId);
    else if (autopilotState.stage === "verify") await autoVerifyStage(tabId);
  } finally {
    autoStepBusy = false;
  }
}

async function autoScanStage(tabId) {
  const response = await sendTabMessage(tabId, { type: "SCAN_JOB_LIST", profile: autopilotState.profile });
  const { applicationHistory = [] } = await chrome.storage.local.get("applicationHistory");
  const appliedUrls = new Set(applicationHistory.map((item) => item.url));
  const minimum = Number(autopilotState.profile.minJobFit || 0);
  const candidates = (response.results || [])
    .filter((item) => item.jobScore >= minimum && !appliedUrls.has(item.url))
    .sort((a, b) => b.score - a.score);

  if (candidates.length) {
    autopilotState.currentJob = candidates[0];
    autopilotState.stage = "job";
    autopilotState.resumeStage = "job";
    autopilotState.lastMessage = `已选择：${candidates[0].title}`;
    await persistAutopilot();
    if (candidates[0].clickToken) {
      const opened = await sendTabMessage(tabId, {
        type: "OPEN_SCANNED_JOB",
        clickToken: candidates[0].clickToken,
        searchTerm: candidates[0].officialSearchTerm || ""
      });
      if (!opened.clicked) throw new Error("无法打开动态岗位卡片");
      scheduleAutoStep(tabId, 1800);
    } else {
      await chrome.tabs.update(tabId, { url: candidates[0].url, active: true });
    }
    return;
  }

  if (response.recommendedUrl && autopilotState.navigationDepth < 2) {
    autopilotState.navigationDepth += 1;
    await persistAutopilot();
    await chrome.tabs.update(tabId, { url: response.recommendedUrl, active: true });
    return;
  }

  const entrance = (response.entrances || []).find((item) => item.url) || response.entrances?.[0];
  if (entrance && autopilotState.navigationDepth < 2) {
    autopilotState.navigationDepth += 1;
    await persistAutopilot();
    if (entrance.url) await chrome.tabs.update(tabId, { url: entrance.url, active: true });
    else {
      await sendTabMessage(tabId, { type: "CLICK_JOB_ENTRANCE", index: entrance.index });
      scheduleAutoStep(tabId, 1800);
    }
    return;
  }

  autopilotState.skipped += 1;
  await addHistory("no_matching_job", "未找到达到最低匹配分的岗位");
  await moveToNextCompany("未找到匹配岗位");
}

async function autoJobStage(tabId) {
  const response = await sendTabMessage(tabId, { type: "OPEN_APPLICATION" });
  if (response.captcha) return handleCaptcha("岗位详情页出现验证码");
  if (response.login) return pauseAutopilot("waiting_login", "需要登录招聘网站；登录后点击继续");
  autopilotState.stage = "apply";
  autopilotState.resumeStage = "apply";
  await persistAutopilot();
  scheduleAutoStep(tabId, response.clicked ? 1800 : 300);
}

async function autoApplyStage(tabId) {
  const { resumeFile = null } = await chrome.storage.local.get("resumeFile");
  const response = await sendTabMessage(tabId, {
    type: "FILL_APPLICATION",
    profile: autopilotState.profile,
    resumeFile
  });
  if (response.login) return pauseAutopilot("waiting_login", "需要登录招聘网站；登录后点击继续");
  if (response.captcha) return handleCaptcha("申请表出现验证码");
  if (response.unknown > 0) {
    autopilotState.resumeStage = "apply";
    return pauseAutopilot("waiting_info", `有 ${response.unknown} 个新必填项需要回答；回答会被记住`);
  }
  if (!autopilotState.profile.autoSubmitEnabled) return pauseAutopilot("ready_to_submit", "资料已填完，等待手动提交");
  const submitted = await sendTabMessage(tabId, { type: "SUBMIT_APPLICATION" });
  if (submitted.captcha) return handleCaptcha("最终提交前出现验证码");
  if (!submitted.submitted) return pauseAutopilot("ready_to_submit", "未能可靠识别最终提交按钮，需要人工确认");
  autopilotState.stage = "verify";
  autopilotState.resumeStage = "verify";
  autopilotState.lastMessage = "已点击最终提交，正在确认结果";
  await persistAutopilot();
  scheduleAutoStep(tabId, 2500);
}

async function autoVerifyStage(tabId) {
  const response = await sendTabMessage(tabId, { type: "DETECT_APPLICATION_SUCCESS" });
  autopilotState.applied += 1;
  await addHistory(response.success ? "submitted" : "submitted_unverified", response.success ? "页面确认投递成功" : "已提交但页面未返回明确成功文字");
  await moveToNextCompany(response.success ? "投递成功" : "已提交，结果待核验");
}

async function handleCaptcha(message) {
  if ((autopilotState.profile.captchaPolicy || "ask") === "skip") {
    autopilotState.skipped += 1;
    await addHistory("skipped_captcha", message);
    return moveToNextCompany("遇到验证码，已按设置跳过");
  }
  autopilotState.resumeStage = autopilotState.stage;
  return pauseAutopilot("waiting_captcha", `${message}；完成验证码后点击继续`);
}

async function pauseAutopilot(status, message) {
  if (!autopilotState) return { state: null };
  autopilotState.status = status;
  autopilotState.lastMessage = message;
  await persistAutopilot();
  if (autopilotState.tabId) {
    await chrome.tabs.update(autopilotState.tabId, { active: true }).catch(() => {});
    await notifyAutoTab("自动投递已暂停", message);
  }
  return { state: autopilotState };
}

async function notifyAutoTab(title, message) {
  if (!autopilotState?.tabId) return;
  await chrome.tabs.sendMessage(autopilotState.tabId, { type: "SHOW_AUTOMATION_NOTICE", notice: { title, message } }).catch(() => {});
}

async function addHistory(status, note) {
  const { applicationHistory = [] } = await chrome.storage.local.get("applicationHistory");
  applicationHistory.push({
    time: new Date().toISOString(),
    company: autopilotState.currentCompany?.company || "未知企业",
    job: autopilotState.currentJob?.title || "未选择岗位",
    url: autopilotState.currentJob?.url || autopilotState.currentCompany?.url || "",
    status,
    note
  });
  await chrome.storage.local.set({ applicationHistory: applicationHistory.slice(-500) });
}

async function persistAutopilot() {
  await chrome.storage.local.set({ [AUTO_STATE_KEY]: autopilotState });
}

async function sendTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await waitForTabReady(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function waitForTabReady(tabId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === "complete") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function navigateAndScan(tabId, url, profile) {
  if (!tabId || !url) throw new Error("缺少岗位页面信息");
  await chrome.storage.local.set({ pendingManualScan: { tabId, profile, createdAt: Date.now(), depth: 0 } });
  await chrome.tabs.update(tabId, { url, active: true });
  return { navigating: true };
}

async function openManualJob(tabId, item) {
  if (!tabId || !item?.clickToken) throw new Error("缺少动态岗位定位信息");
  const tab = await chrome.tabs.get(tabId);
  if (item.sourceUrl && canonicalTabUrl(tab.url) !== canonicalTabUrl(item.sourceUrl)) {
    throw new Error("请回到刚才扫描的岗位列表页后再打开此岗位");
  }
  return sendTabMessage(tabId, {
    type: "OPEN_SCANNED_JOB",
    clickToken: item.clickToken,
    searchTerm: item.officialSearchTerm || ""
  });
}

function canonicalTabUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch { return String(value || ""); }
}

async function handlePendingManualScan(tabId) {
  const { pendingManualScan } = await chrome.storage.local.get("pendingManualScan");
  if (!pendingManualScan || pendingManualScan.tabId !== tabId || Date.now() - pendingManualScan.createdAt > 10 * 60 * 1000) return;
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const response = await sendTabMessage(tabId, { type: "SCAN_JOB_LIST", profile: pendingManualScan.profile });
  if (!response.results?.length && response.recommendedUrl && pendingManualScan.depth < 2) {
    pendingManualScan.depth += 1;
    await chrome.storage.local.set({ pendingManualScan });
    await chrome.tabs.update(tabId, { url: response.recommendedUrl, active: true });
    return;
  }
  await chrome.storage.local.set({
    latestManualScan: { ...response, createdAt: Date.now(), url: (await chrome.tabs.get(tabId)).url },
    pendingManualScan: null
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_AUTOMATION_NOTICE",
    notice: {
      title: response.results?.length ? `已找到 ${response.results.length} 个岗位` : "仍未识别到具体岗位",
      message: response.results?.length ? "打开扩展即可查看排序结果。" : "该网站可能需要登录或先选择招聘项目。"
    }
  }).catch(() => {});
}
