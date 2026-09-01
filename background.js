importScripts("city-preferences.js", "scoring.js");

const SEARCH_URL = "https://www.bing.com/search?format=rss&q=";
const AUTO_STATE_KEY = "autopilotState";
const JOB_WATCH_ALARM = "resume-pilot-job-watch";
const COMPANY_VERIFICATION_KEY = "companyVerification";
const RECRUITMENT_DISCOVERY_SITES = [
  "zhipin.com", "zhaopin.com", "51job.com", "liepin.com", "shixiseng.com",
  "lagou.com", "nowcoder.com", "yingjiesheng.com"
];
let autopilotState = null;
let autoStepBusy = false;

// 这些入口来自企业公开招聘官网；它们只作为搜索种子，不代表对企业的背书或排名。
const VERIFIED_CAREER_SEEDS = ResumePilotScoring.companies.map((entry) => ({
  company: entry.company,
  domain: entry.domains[0],
  url: entry.careerUrl,
  jobListUrls: entry.jobListUrls || {},
  tags: entry.tags,
  segment: entry.segment || "其他企业"
}));

chrome.runtime.onInstalled?.addListener(() => ensureJobWatchAlarm());
chrome.runtime.onStartup?.addListener(() => ensureJobWatchAlarm());
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === JOB_WATCH_ALARM) refreshJobWatch().catch(() => {});
});
ensureJobWatchAlarm();

chrome.storage.local.get(AUTO_STATE_KEY).then((data) => {
  autopilotState = data[AUTO_STATE_KEY] || null;
  const runtimeVersion = chrome.runtime.getManifest().version;
  if (autopilotState && autopilotState.extensionVersion !== runtimeVersion) {
    autopilotState.active = false;
    autopilotState.status = "stopped";
    autopilotState.extensionVersion = runtimeVersion;
    autopilotState.lastMessage = `已升级到 v${runtimeVersion}，旧队列已安全停止；请检查后重新开始`;
    persistAutopilot().catch(() => {});
  }
  if (autopilotState && !autopilotState.rolePlan?.length) {
    autopilotState.rolePlan = inferRolePlan(autopilotState.profile || {});
    autopilotState.roleIndex = 0;
    autopilotState.currentRole = autopilotState.rolePlan[0];
    autopilotState.roleResults = [];
    persistAutopilot().catch(() => {});
  }
  if (autopilotState?.active && autopilotState.status === "running" && autopilotState.tabId) {
    chrome.tabs.get(autopilotState.tabId)
      .then((tab) => scheduleAutoStep(tab.id, tab.status === "complete" ? 800 : 1800))
      .catch(() => moveToNextCompany("浏览器恢复后重新开始当前企业"));
  }
});

async function ensureJobWatchAlarm() {
  if (!chrome.alarms?.create) return;
  const existing = await chrome.alarms.get(JOB_WATCH_ALARM).catch(() => null);
  if (!existing) await chrome.alarms.create(JOB_WATCH_ALARM, { delayInMinutes: 2, periodInMinutes: 30 });
}

async function refreshJobWatch() {
  const { profile = {}, jobWatchState = {}, inactiveCompanies = {} } = await chrome.storage.local.get(["profile", "jobWatchState", "inactiveCompanies"]);
  if (!clean(profile.targetRole) && !clean(profile.skills)) return { checked: false, reason: "profile_incomplete" };
  const page = Math.max(0, Number(jobWatchState.page || 0)) % 50;
  const response = await searchOfficialCareers({
    ...profile,
    role: profile.targetRole,
    city: profile.targetCity,
    industry: profile.targetIndustry,
    page
  });
  const known = new Set(jobWatchState.knownUrls || []);
  const active = (response.results || []).filter((item) => !item.hardBlocked && item.url);
  const newlyFound = active.filter((item) => !known.has(canonicalUrl(item.url)));
  active.forEach((item) => known.add(canonicalUrl(item.url)));
  const previous = jobWatchState.candidates || [];
  const merged = new Map(previous.map((item) => [canonicalUrl(item.url), item]));
  for (const item of newlyFound) merged.set(canonicalUrl(item.url), { ...item, discoveredAt: Date.now() });
  for (const item of newlyFound) {
    const company = item.company || item.companyHint;
    if (company) delete inactiveCompanies[company];
  }
  const candidates = [...merged.values()].sort((a, b) => Number(b.discoveredAt || 0) - Number(a.discoveredAt || 0)).slice(0, 300);
  await chrome.storage.local.set({
    inactiveCompanies,
    jobWatchState: {
      page: (page + 1) % 50,
      knownUrls: [...known].slice(-1200),
      candidates,
      lastCheckedAt: Date.now(),
      lastNewCount: newlyFound.length
    }
  });
  return { checked: true, newCount: newlyFound.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") handlePendingManualScan(tabId).catch(() => {});
  if (changeInfo.status === "complete" && autopilotState?.pendingJobOpen) {
    maybeAdoptPendingJobTab(tabId).catch(() => {});
  }
  if (changeInfo.status === "complete" && autopilotState?.active && autopilotState.tabId === tabId && autopilotState.status === "waiting_login") {
    scheduleLoginRecovery(tabId);
  }
  if (changeInfo.status === "complete" && autopilotState?.active && autopilotState.tabId === tabId && autopilotState.status === "running") {
    scheduleAutoStep(tabId, 1400);
  }
});

function scheduleLoginRecovery(tabId) {
  setTimeout(async () => {
    if (!autopilotState?.active || autopilotState.tabId !== tabId || autopilotState.status !== "waiting_login") return;
    try {
      const page = await sendTabMessage(tabId, { type: "CHECK_APPLICATION_PAGE" });
      if (page.login) return;
      if (page.captcha) return handleCaptcha("登录后页面出现验证码");
      autopilotState.status = "running";
      autopilotState.stage = autopilotState.resumeStage || "job";
      autopilotState.lastMessage = "已检测到登录完成，自动恢复申请流程";
      await persistAutopilot();
      scheduleAutoStep(tabId, 400);
    } catch {}
  }, 1200);
}

chrome.tabs.onCreated.addListener((tab) => {
  if (autopilotState?.active && tab.openerTabId === autopilotState.tabId) {
    autopilotState.sourceListTabId = autopilotState.tabId;
    autopilotState.tabId = tab.id;
    autopilotState.pendingJobOpen = null;
    autopilotState.lastMessage = "已在新标签页打开岗位详情";
    persistAutopilot().catch(() => {});
    // 极快页面可能在状态更新前就完成加载；额外调度一次，避免新标签页无人继续处理。
    scheduleAutoStep(tab.id, tab.status === "complete" ? 900 : 1800);
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
  if (message?.type === "NAVIGATE_AND_SCAN") return navigateAndScan(message.tabId || sender.tab?.id, message.url, message.profile || {}, message.company || "");
  throw new Error("不支持的扩展操作");
}

async function searchOfficialCareers(criteria = {}) {
  const role = clean(criteria.role) || "校园招聘";
  const roleTerms = splitList(role);
  const city = ResumePilotCities.forSearch(criteria.city);
  const cityTerms = ResumePilotCities.split(city);
  const industry = clean(criteria.industry);
  const positionType = clean(criteria.positionType) || "实习";
  const skills = splitList(criteria.skills).slice(0, 8);
  const preferredCompanies = splitList(criteria.preferredCompanies).slice(0, 8);
  const page = Math.max(0, Number(criteria.page || 0));
  const pageSize = 10;
  const roleForQuery = (index = 0) => roleTerms.length ? roleTerms[(page + index) % roleTerms.length] : "校园招聘";
  const cityForQuery = (index = 0) => cityTerms.length ? cityTerms[(page + index) % cityTerms.length] : "";

  const matchedSeeds = selectSeeds(industry, preferredCompanies);
  const pageSeeds = matchedSeeds.slice(page * pageSize, (page + 1) * pageSize);
  const companyQueries = preferredCompanies.map((company, index) =>
    `${company} ${roleForQuery(index)} ${cityForQuery(index)} ${positionType} 职位 官方招聘`
  );
  const seedQueries = pageSeeds.slice(0, 5).map((seed, index) =>
    `site:${seed.domain} ${roleForQuery(index)} ${cityForQuery(index)} ${positionType}`
  );
  const discoveryQueries = [
    `${roleForQuery(0)} ${cityForQuery(0)} ${industry} ${positionType} 职位 官方招聘 careers`,
    `${roleForQuery(1)} ${cityForQuery(1)} ${industry} ${positionType} 科技有限公司 官方招聘`,
    `${roleForQuery(2)} ${cityForQuery(2)} ${positionType} 成长型企业 初创公司 招聘官网`,
    `${roleForQuery(3)} ${cityForQuery(3)} ${industry} ${positionType} 中小企业 校园招聘 实习`
  ];
  const queries = [...new Set([...(page === 0 ? companyQueries : []), ...seedQueries, ...discoveryQueries])].slice(0, 10);

  const offset = page * 10;
  const batches = await Promise.all(queries.map((query) => fetchRssResults(query, offset).catch(() => [])));
  const liveDiscovery = await discoverLiveCareerResults({ role: roleForQuery(2), city: cityForQuery(2), industry, positionType }, page).catch(() => ({ results: [], companyNames: [] }));
  const { jobWatchState = {}, companyVerification = {} } = await chrome.storage.local.get(["jobWatchState", COMPANY_VERIFICATION_KEY]);
  const watched = (jobWatchState.candidates || []).slice(page * 8, page * 8 + 8);
  const deduped = new Map();

  for (const seed of pageSeeds) {
    const direct = makeSeedResult(seed, { ...criteria, role, city, industry, positionType, skills, preferredCompanies, matchedSeeds });
    deduped.set(canonicalUrl(direct.url), direct);
  }

  for (const item of [...batches.flat(), ...liveDiscovery.results, ...watched]) {
    if (!isLikelyCareerResult(item)) continue;
    if (isRecruitmentDiscoveryUrl(item.url)) continue;
    const key = canonicalUrl(item.url);
    const scored = enrichResult(item, { ...criteria, role, city, industry, positionType, skills, preferredCompanies, matchedSeeds });
    if (!deduped.has(key) || deduped.get(key).score < scored.score) {
      deduped.set(key, scored);
    }
  }

  const cityPriority = { matched: 4, flexible: 3, unrestricted: 2, unknown: 1, mismatch: 0 };
  const ranked = [...deduped.values()].sort((a, b) =>
    Number(cityPriority[b.cityMatchStatus] || 0) - Number(cityPriority[a.cityMatchStatus] || 0)
      || b.score - a.score
  );
  const preferredNames = new Set(preferredCompanies);
  const preferredResults = ranked.filter((item) => [...preferredNames].some((name) => item.company?.includes(name) || name.includes(item.company || "")));
  const diversifiedResults = interleaveBySegment(ranked.filter((item) => !preferredResults.includes(item)));
  const results = [...new Map([...preferredResults, ...diversifiedResults].map((item) => [canonicalUrl(item.url), item])).values()]
    .slice(0, 36)
    .map((item) => applyCompanyVerification(item, companyVerification));
  await chrome.storage.local.set({
    latestCompanyCandidates: {
      results,
      createdAt: Date.now(),
      criteria: { role, city, industry, positionType }
    }
  });
  return {
    results,
    page,
    hasMore: (page + 1) * pageSize < matchedSeeds.length
      || (page + 1) * 8 < (jobWatchState.candidates || []).length
      || (page < 49 && liveDiscovery.results.length > 0),
    totalCompanies: matchedSeeds.length + (jobWatchState.candidates || []).length + liveDiscovery.companyNames.length,
    newlyDiscoveredCompanies: liveDiscovery.companyNames
  };
}

async function discoverLiveCareerResults(criteria, page = 0) {
  const sites = RECRUITMENT_DISCOVERY_SITES
    .map((_, index, all) => all[(index + page) % all.length])
    .slice(0, 4);
  const listingQueries = sites.map((site, index) =>
    `site:${site} ${criteria.role} ${criteria.city} ${criteria.industry} ${criteria.positionType} ${index % 2 ? "科技有限公司" : "初创 成长型 中小企业"}`
  );
  const listingBatches = await Promise.all(listingQueries.map((query) => fetchRssResults(query, page * 10).catch(() => [])));
  const companyNames = [...new Set(listingBatches.flat().map(extractCompanyNameFromListing).filter(Boolean))].slice(0, 10);
  const verifiedBatches = await Promise.all(companyNames.map(async (company) => {
    const query = `${company} ${criteria.role} ${criteria.city} 官方招聘 校园招聘 实习 careers`;
    const results = await fetchRssResults(query).catch(() => []);
    return results
      .filter((item) => isOfficialCareerForCompany(item, company))
      .slice(0, 2)
      .map((item) => ({ ...item, companyHint: company, companySegmentHint: "中小企业", entryKind: "discoveredCareer" }));
  }));
  return { results: verifiedBatches.flat(), companyNames };
}

function extractCompanyNameFromListing(item = {}) {
  const text = clean(`${item.title || ""} ${item.description || ""}`)
    .replace(/BOSS直聘|智联招聘|前程无忧|猎聘|实习僧|拉勾|牛客|应届生求职/gi, " ");
  const legalNames = [...text.matchAll(/([\u4e00-\u9fa5A-Za-z0-9·（）()]{2,36}(?:股份有限公司|有限责任公司|有限公司|集团公司|集团|科技公司|网络公司|通信公司|软件公司))/g)]
    .map((match) => clean(match[1]).replace(/^(?:职位|岗位|招聘|诚聘|急聘)[:：\s-]*/, ""))
    .filter((name) => name.length >= 3 && name.length <= 36 && !/(招聘平台|人力资源|劳务派遣)/.test(name));
  return legalNames.sort((a, b) => b.length - a.length)[0] || "";
}

function isRecruitmentDiscoveryUrl(value = "") {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return RECRUITMENT_DISCOVERY_SITES.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function isOfficialCareerForCompany(item = {}, company = "") {
  if (!item.url?.startsWith("http") || isRecruitmentDiscoveryUrl(item.url)) return false;
  const core = clean(company)
    .replace(/^(?:北京|上海|深圳|广州|杭州|南京|苏州|成都|武汉|厦门|福州)市?/, "")
    .replace(/(?:股份有限公司|有限责任公司|有限公司|集团公司|集团|科技公司|网络公司|通信公司|软件公司)$/g, "")
    .trim();
  if (core.length < 2) return false;
  const haystack = `${item.title || ""} ${item.description || ""} ${item.url}`.toLowerCase();
  const careerSignal = /(招聘|校招|实习|应届|职位|career|jobs?|join|talent|recruit)/i.test(haystack);
  return careerSignal && haystack.includes(core.toLowerCase());
}

function selectSeeds(industry, preferredCompanies) {
  const industryTerms = splitList(industry);
  const preferred = preferredCompanies
    .map((name) => VERIFIED_CAREER_SEEDS.find((seed) => seed.company.includes(name) || name.includes(seed.company)))
    .filter(Boolean);
  const relevant = VERIFIED_CAREER_SEEDS.filter((seed) =>
    !industryTerms.length || industryTerms.some((term) => seed.tags.some((tag) => tag.includes(term) || term.includes(tag)))
  );
  const diversified = [...interleaveBySegment(relevant), ...interleaveBySegment(VERIFIED_CAREER_SEEDS)];
  return [...new Map([...preferred, ...diversified].map((seed) => [seed.company, seed])).values()];
}

function interleaveBySegment(items) {
  const order = ["中小企业", "新发现企业", "成长型企业", "外企", "行业企业", "大型民企", "大型企业", "金融企业", "其他企业", "待分类"];
  const groups = new Map();
  for (const item of items) {
    const key = item.segment || item.companySegment || "其他企业";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...new Set([...order, ...groups.keys()])].filter((key) => groups.get(key)?.length);
  const output = [];
  for (let index = 0; output.length < items.length; index += 1) {
    let added = false;
    for (const key of keys) {
      const item = groups.get(key)?.[index];
      if (item) {
        output.push(item);
        added = true;
      }
    }
    if (!added) break;
  }
  return output;
}

function makeSeedResult(seed, criteria) {
  const useIntern = /实习|intern/i.test(criteria.positionType);
  const url = useIntern ? (seed.jobListUrls.intern || seed.url) : (seed.jobListUrls.campus || seed.url);
  return enrichResult({
    title: `${seed.company}官方招聘入口`,
    url,
    description: `${seed.company}企业候选。已确认官方招聘入口；尚未把它当作具体岗位，进入官网读取真实岗位、地点和招聘状态后才会加入投递队列。`,
    query: "内置官方招聘入口",
    entryKind: "companyCandidate"
  }, criteria);
}

async function fetchRssResults(query, offset = 0) {
  const first = Math.max(1, Number(offset || 0) + 1);
  const response = await fetch(`${SEARCH_URL}${encodeURIComponent(query)}&first=${first}`);
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
  return String(value).split(/[，,、;；/\n]/).map(clean).filter(Boolean);
}

const ROLE_TAXONOMY = [
  { role: "前端开发工程师", explicit: /前端|web\s*前端|frontend/i, signals: [/react/i, /vue/i, /javascript/i, /typescript/i, /html/i, /css/i, /前端/i] },
  { role: "软件开发工程师", explicit: /软件开发|开发工程师|software\s*(developer|engineer)/i, signals: [/python/i, /java(?!script)/i, /c\+\+/i, /javascript/i, /node\.?(js)?/i, /git/i, /编程/i] },
  { role: "后端开发工程师", explicit: /后端|服务端|backend/i, signals: [/node\.?(js)?/i, /java/i, /python/i, /golang|\bgo\b/i, /spring/i, /django|flask/i, /mysql|redis/i, /后端/i] },
  { role: "AI与算法工程师", explicit: /人工智能|\bai\b|算法|机器学习|深度学习|大模型/i, signals: [/pytorch/i, /tensorflow/i, /机器学习|深度学习/i, /模型|算法/i, /opencv/i, /numpy/i] },
  { role: "数据工程师", explicit: /数据工程|数据开发|数据分析|数据科学|商业分析/i, signals: [/sql/i, /pandas/i, /numpy/i, /power\s*bi/i, /excel/i, /数据分析|数据处理/i, /python/i] },
  { role: "测试开发工程师", explicit: /测试开发|测试工程师|自动化测试|qa/i, signals: [/selenium/i, /pytest/i, /junit/i, /postman/i, /测试/i] },
  { role: "网络安全工程师", explicit: /网络安全|信息安全|安全工程|隐私保护/i, signals: [/网络安全|信息安全|漏洞|渗透|隐私/i, /linux/i, /wireshark/i] },
  { role: "嵌入式开发工程师", explicit: /嵌入式|单片机|硬件开发|驱动开发/i, signals: [/stm32/i, /嵌入式|单片机/i, /c\+\+/i, /电路|硬件/i] },
  { role: "产品经理", explicit: /产品经理|产品实习|产品策划/i, signals: [/需求分析|用户研究|原型|axure/i, /产品/i, /数据分析/i] },
  { role: "UI与用户体验设计师", explicit: /ui|ux|用户体验|交互设计|视觉设计/i, signals: [/figma/i, /photoshop|illustrator/i, /交互|用户体验|视觉设计/i] }
];

function inferRolePlan(profile = {}) {
  const explicitText = clean(profile.targetRole).toLowerCase();
  const resumeText = [profile.resumeText, profile.skills, profile.major, profile.targetIndustry]
    .filter(Boolean).join(" ").toLowerCase();
  const technicalMajor = /(计算机|软件|人工智能|数据|电子|通信|自动化)/i.test(profile.major || "");
  const plan = ROLE_TAXONOMY.map((entry) => {
    let fit = 0;
    const reasons = [];
    if (entry.explicit.test(explicitText)) {
      fit += 55;
      reasons.push("目标岗位中明确提到");
    }
    const matched = entry.signals.filter((pattern) => pattern.test(resumeText));
    if (matched.length) {
      fit += Math.min(35, matched.length * 7);
      reasons.push(`简历命中 ${matched.length} 个技能/项目线索`);
    }
    if (technicalMajor && !/产品经理|设计师/.test(entry.role)) fit += 8;
    return { role: entry.role, fit: Math.min(100, fit), reasons };
  }).filter((entry) => entry.fit >= 15).sort((a, b) => b.fit - a.fit);

  if (!plan.length) {
    const fallback = clean(profile.targetRole) || "软件开发工程师";
    return [{ role: fallback, fit: 40, reasons: [profile.targetRole ? "使用已填写的目标岗位" : "根据计算机类学生默认方向"] }];
  }
  return plan.slice(0, 6);
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

function selectRecruitmentEntrance(entrances = [], profile = {}, currentUrl = "") {
  const positionType = clean(profile.positionType).toLowerCase();
  const wantsIntern = /实习|intern/.test(positionType);
  const wantsCampus = /校园|校招|应届|graduate|campus/.test(positionType);
  const wantsSocial = /社会|社招|全职|experienced|social/.test(positionType);
  const ranked = (entrances || []).map((entry, order) => {
    let score = Number(entry.priority || 0);
    const audience = entry.audience || "general";
    if (wantsIntern) score += audience === "intern" ? 100 : (audience === "campus" ? 70 : (audience === "social" ? -80 : 20));
    else if (wantsCampus) score += audience === "campus" ? 100 : (audience === "social" ? -80 : 20);
    else if (wantsSocial) score += audience === "social" ? 100 : (audience === "campus" || audience === "intern" ? -60 : 20);
    if (entry.cityMatchStatus === "matched") score += 70;
    else if (entry.cityMatchStatus === "flexible" || entry.cityMatchStatus === "unrestricted") score += 15;
    else if (entry.cityMatchStatus === "mismatch") score -= 120;
    if (entry.platform) score += 25;
    if (entry.url && canonicalUrl(entry.url) !== canonicalUrl(currentUrl)) score += 15;
    if (!entry.url) score -= 5;
    return { entry, order, score };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked[0]?.entry || null;
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
  const knownProfile = ResumePilotScoring.findCompany(text, item.url);
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
    company: seed?.company || item.companyHint || companyEval.company || inferCompany(item),
    companySegment: seed?.segment || knownProfile?.segment || item.companySegmentHint || (item.companyHint ? "新发现企业" : "待分类"),
    resultType: item.entryKind === "companyCandidate" ? "企业候选" : (item.entryKind === "jobList" ? "岗位列表" : (isPosition ? "岗位线索" : "招聘入口")),
    verificationStatus: isPosition ? "job_lead" : "candidate",
    liveJobVerified: false,
    score,
    companyScore: companyEval.companyScore,
    jobScore: jobEval.jobScore,
    matchedSkills: jobEval.matchedSkills,
    skillEligible: jobEval.skillEligible,
    hardBlocked: jobEval.hardBlocked,
    cityMatchStatus: jobEval.cityMatchStatus,
    targetCities: jobEval.targetCities,
    matchedCities: jobEval.matchedCities,
    foundCities: jobEval.foundCities,
    compensationScore: jobEval.compensationScore,
    compensationLabel: jobEval.compensationLabel,
    confidence: companyEval.confidence,
    companyDimensions: companyEval.dimensions,
    reasons: [...new Set([...companyEval.reasons, ...jobEval.reasons])].slice(0, 6),
    warnings: [...new Set([...companyEval.warnings, ...jobEval.warnings])].slice(0, 6),
    evidence: companyEval.evidence
  };
}

function companyVerificationKey(company = "") {
  return clean(company).toLowerCase().replace(/[\s·（）()_-]/g, "");
}

function applyCompanyVerification(item, records = {}) {
  const record = records[companyVerificationKey(item.company)];
  if (!record) return item;
  return {
    ...item,
    verificationStatus: record.status || item.verificationStatus,
    liveJobVerified: ["verified_match", "no_match"].includes(record.status),
    liveJobCount: Number(record.liveJobCount || 0),
    matchedJobCount: Number(record.matchedJobCount || 0),
    verificationCheckedAt: record.checkedAt || 0,
    verificationFlow: record.flowSummary || "",
    verificationReason: record.reason || ""
  };
}

async function recordCompanyVerification(company, data = {}) {
  const key = companyVerificationKey(company);
  if (!key) return;
  const stored = await chrome.storage.local.get(COMPANY_VERIFICATION_KEY);
  const records = stored[COMPANY_VERIFICATION_KEY] || {};
  records[key] = {
    company,
    status: data.status || "candidate",
    liveJobCount: Math.max(0, Number(data.liveJobCount || 0)),
    matchedJobCount: Math.max(0, Number(data.matchedJobCount || 0)),
    flowSummary: clean(data.flowSummary),
    reason: clean(data.reason),
    url: data.url || "",
    checkedAt: Date.now()
  };
  const trimmed = Object.fromEntries(Object.entries(records)
    .sort(([, a], [, b]) => Number(b.checkedAt || 0) - Number(a.checkedAt || 0))
    .slice(0, 500));
  await chrome.storage.local.set({ [COMPANY_VERIFICATION_KEY]: trimmed });
}

function applicationFingerprint(company = "", job = "", url = "") {
  let host = "";
  let jobId = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const segments = parsed.pathname.split("/").filter(Boolean).filter((segment) => !/^apply$/i.test(segment));
    jobId = decodeURIComponent(segments.at(-1) || parsed.searchParams.get("jobId") || parsed.searchParams.get("positionId") || "");
  } catch {}
  const companyPart = companyVerificationKey(company);
  const jobPart = clean(job).toLowerCase().replace(/[\s·（）()【】\[\]_-]/g, "").slice(0, 90);
  return [companyPart, jobPart, host, jobId.toLowerCase()].filter(Boolean).join("|");
}

function isPreviouslySubmitted(item, company, applicationHistory = []) {
  const fingerprint = applicationFingerprint(company, item.title || item.job, item.url);
  return applicationHistory.some((history) => {
    if (!["submitted", "submitted_unverified"].includes(history.status)) return false;
    if (canonicalUrl(history.url) === canonicalUrl(item.url)) return true;
    const historyFingerprint = history.fingerprint || applicationFingerprint(history.company, history.job, history.url);
    return Boolean(fingerprint && historyFingerprint === fingerprint);
  });
}

function inferCompany(item) {
  const title = clean(item.title).split(/[|｜\-_—]/)[0];
  if (title && title.length <= 20) return title;
  try { return new URL(item.url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return "待核验企业"; }
}

async function startAutopilot(profile) {
  const submissionMode = ["dry_run", "review", "auto"].includes(profile.submissionMode) ? profile.submissionMode : "dry_run";
  if (submissionMode === "auto" && !profile.autoSubmitEnabled) throw new Error("全自动模式需要先勾选最终提交授权");
  const { inactiveCompanies = {}, jobWatchState = {}, latestCompanyCandidates = {} } = await chrome.storage.local.get(["inactiveCompanies", "jobWatchState", "latestCompanyCandidates"]);
  const latestIsFresh = Date.now() - Number(latestCompanyCandidates.createdAt || 0) < 24 * 60 * 60 * 1000;
  const searchedCompanies = (latestIsFresh ? latestCompanyCandidates.results || [] : [])
    .filter((item) => !item.hardBlocked && item.url && ["企业候选", "招聘入口", "岗位列表"].includes(item.resultType))
    .map((item) => watchedResultToSeed(item, profile))
    .filter(Boolean);
  const watchedCompanies = (jobWatchState.candidates || [])
    .filter((item) => !item.hardBlocked && item.url && ["企业候选", "招聘入口", "岗位列表"].includes(item.resultType))
    .map((item) => watchedResultToSeed(item, profile))
    .filter(Boolean);
  const baseCompanies = selectSeeds(profile.targetIndustry || "", splitList(profile.preferredCompanies));
  const companies = [...new Map([...searchedCompanies, ...watchedCompanies, ...baseCompanies]
    .filter((company) => Number(inactiveCompanies[company.company]?.retryAfter || 0) <= Date.now())
    .map((company) => [company.company, company])).values()];
  if (!companies.length) throw new Error("没有可用的企业入口");
  const rolePlan = inferRolePlan(profile);
  autopilotState = {
    id: Date.now(),
    extensionVersion: chrome.runtime.getManifest().version,
    active: true,
    status: "running",
    stage: "company",
    resumeStage: "company",
    profile,
    rolePlan,
    roleIndex: 0,
    currentRole: rolePlan[0],
    roleResults: [],
    companies,
    companyIndex: -1,
    applied: 0,
    processed: 0,
    skipped: 0,
    dailyLimit: Math.max(1, Math.min(30, Number(profile.dailyLimit || 5))),
    maxPerCompany: Math.max(1, Math.min(10, Number(profile.maxPerCompany || 3))),
    submissionMode,
    currentCompany: null,
    currentJob: null,
    jobQueue: [],
    jobQueueIndex: -1,
    sourceListTabId: null,
    pendingJobOpen: null,
    siteFlow: null,
    tabId: null,
    navigationDepth: 0,
    startedAt: new Date().toISOString(),
    lastMessage: "自动投递已启动"
  };
  await persistAutopilot();
  await moveToNextCompany();
  return { state: autopilotState };
}

function watchedResultToSeed(item, profile = {}) {
  if (isRecruitmentDiscoveryUrl(item.url)) return null;
  try {
    const domain = new URL(item.url).hostname.replace(/^www\./, "");
    return {
      company: item.company || item.companyHint || inferCompany(item),
      domain,
      url: item.url,
      jobListUrls: { campus: item.url, intern: item.url },
      tags: [...new Set([...splitList(profile.targetIndustry), ...splitList(profile.skills).slice(0, 5)])],
      segment: item.companySegment || "新发现企业",
      discovered: true
    };
  } catch {
    return null;
  }
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
  if (!autopilotState.rolePlan?.length) {
    autopilotState.rolePlan = inferRolePlan(autopilotState.profile || {});
    autopilotState.roleIndex = 0;
    autopilotState.currentRole = autopilotState.rolePlan[0];
    autopilotState.roleResults = [];
  }
  autopilotState.jobQueue ||= [];
  if (!Number.isInteger(autopilotState.jobQueueIndex)) autopilotState.jobQueueIndex = -1;
  if (!Number.isFinite(Number(autopilotState.processed))) autopilotState.processed = Number(autopilotState.applied || 0);
  autopilotState.submissionMode ||= "dry_run";
  autopilotState.maxPerCompany ||= 3;
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
  if (autopilotState.processed >= autopilotState.dailyLimit || autopilotState.companyIndex + 1 >= autopilotState.companies.length) {
    autopilotState.active = false;
    autopilotState.status = "completed";
    autopilotState.lastMessage = autopilotState.processed >= autopilotState.dailyLimit
      ? `已达到本次处理上限：${autopilotState.dailyLimit} 个岗位`
      : "所有候选企业已处理完成";
    await persistAutopilot();
    await notifyAutoTab(autopilotState.lastMessage, `成功/已尝试 ${autopilotState.applied}，跳过 ${autopilotState.skipped}`);
    return;
  }

  autopilotState.companyIndex += 1;
  autopilotState.currentCompany = autopilotState.companies[autopilotState.companyIndex];
  autopilotState.currentJob = null;
  autopilotState.jobQueue = [];
  autopilotState.jobQueueIndex = -1;
  autopilotState.sourceListTabId = null;
  autopilotState.pendingJobOpen = null;
  autopilotState.siteFlow = null;
  autopilotState.roleIndex = 0;
  autopilotState.currentRole = autopilotState.rolePlan?.[0] || { role: clean(autopilotState.profile.targetRole) || "目标岗位", fit: 40, reasons: [] };
  autopilotState.roleResults = [];
  autopilotState.stage = "scan";
  autopilotState.resumeStage = "scan";
  autopilotState.navigationDepth = 0;
  autopilotState.lastMessage = `${reason ? `${reason}；` : ""}正在 ${autopilotState.currentCompany.company} 搜索：${autopilotState.currentRole.role}`;
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
    else if (autopilotState.stage === "resume_create") await autoResumeCreateStage(tabId);
    else if (autopilotState.stage === "verify") await autoVerifyStage(tabId);
  } finally {
    autoStepBusy = false;
  }
}

async function autoScanStage(tabId) {
  if (!(await ensureCurrentPageScripts(tabId))) return;
  const role = autopilotState.currentRole || autopilotState.rolePlan?.[autopilotState.roleIndex] || { role: autopilotState.profile.targetRole, fit: 40 };
  const roleProfile = { ...autopilotState.profile, targetRole: role.role };
  // 每个公司、每次进入新的招聘页面都先识别流程，再开始找岗位。
  // 这样后续动作依据页面能力选择，而不是假设所有官网都和某一家相同。
  let flow = await sendTabMessage(tabId, { type: "INSPECT_RECRUITMENT_FLOW", profile: roleProfile });
  autopilotState.siteFlow = flow;
  autopilotState.lastMessage = `已识别 ${autopilotState.currentCompany.company} 流程：${flow.summary || "使用通用探测"}；正在搜索 ${role.role}`;
  await persistAutopilot();
  if (flow.pageType === "embedded" && flow.embeddedUrl && autopilotState.navigationDepth < 2) {
    autopilotState.navigationDepth += 1;
    autopilotState.siteFlow = null;
    autopilotState.lastMessage = "检测到嵌入式招聘系统，正在打开可操作的独立岗位页面";
    await persistAutopilot();
    await chrome.tabs.update(tabId, { url: flow.embeddedUrl, active: true });
    return;
  }
  const response = await sendTabMessage(tabId, { type: "SCAN_JOB_LIST", profile: roleProfile });
  // SPA 招聘页经常在 document_idle 之后才异步渲染岗位。初次探测可能只看到
  // 搜索框；完成官网筛选和翻页后必须重新取证，不能用加载早期的结果判死刑。
  const postScanFlow = await sendTabMessage(tabId, { type: "INSPECT_RECRUITMENT_FLOW", profile: roleProfile });
  if (postScanFlow) {
    flow = postScanFlow;
    autopilotState.siteFlow = postScanFlow;
    await persistAutopilot();
  }
  const { applicationHistory = [] } = await chrome.storage.local.get("applicationHistory");
  const alreadySubmitted = (item) => isPreviouslySubmitted(item, autopilotState.currentCompany?.company || item.company, applicationHistory);

  if (response.recommendedUrl && autopilotState.navigationDepth < 2) {
    autopilotState.navigationDepth += 1;
    autopilotState.siteFlow = null;
    await persistAutopilot();
    await chrome.tabs.update(tabId, { url: response.recommendedUrl, active: true });
    return;
  }

  const entrance = selectRecruitmentEntrance(response.entrances, roleProfile, response.sourceUrl || flow.url || "");
  if (!(response.results || []).length && entrance && autopilotState.navigationDepth < 2) {
    autopilotState.navigationDepth += 1;
    autopilotState.siteFlow = null;
    await persistAutopilot();
    if (entrance.url) await chrome.tabs.update(tabId, { url: entrance.url, active: true });
    else {
      await sendTabMessage(tabId, { type: "CLICK_JOB_ENTRANCE", index: entrance.index });
      scheduleAutoStep(tabId, 1800);
    }
    return;
  }

  const minimum = Number(autopilotState.profile.minJobFit || 0);
  const evaluated = (response.results || [])
    .filter((item) => !alreadySubmitted(item))
    .map((item) => ({
      ...item,
      verificationStatus: "live_job",
      liveJobVerified: true,
      verificationCheckedAt: Date.now(),
      matchedRole: role.role,
      rolePlanFit: role.fit,
      rankingScore: Math.round((item.score || 0) + Number(role.fit || 0) * 0.08)
    }));
  const resultMap = new Map((autopilotState.roleResults || []).map((item) => [item.url, item]));
  for (const item of evaluated) {
    if (!resultMap.has(item.url) || resultMap.get(item.url).rankingScore < item.rankingScore) resultMap.set(item.url, item);
  }
  autopilotState.roleResults = [...resultMap.values()].sort((a, b) => b.rankingScore - a.rankingScore).slice(0, 100);

  if (autopilotState.roleIndex + 1 < (autopilotState.rolePlan || []).length) {
    autopilotState.roleIndex += 1;
    autopilotState.currentRole = autopilotState.rolePlan[autopilotState.roleIndex];
    const eligibleCount = (autopilotState.roleResults || []).filter((item) => !item.hardBlocked && (item.skillEligible || item.jobScore >= minimum)).length;
    const verified = response.officialFilters?.verifiedKeywords || [];
    const searchStatus = verified.length ? `官网已实际筛选“${verified.join("、")}”` : "已扫描官网岗位列表";
    autopilotState.lastMessage = `${autopilotState.currentCompany.company}${searchStatus}，已收集 ${eligibleCount} 个技能匹配岗位；继续搜索：${autopilotState.currentRole.role}`;
    await persistAutopilot();
    scheduleAutoStep(tabId, 350);
    return;
  }

  const relaxedMinimum = Math.max(30, minimum - 10);
  let queue = (autopilotState.roleResults || [])
    .filter((item) => !item.hardBlocked && (item.skillEligible || item.jobScore >= minimum) && !alreadySubmitted(item))
    .sort((a, b) => b.rankingScore - a.rankingScore);
  if (!queue.length) {
    queue = (autopilotState.roleResults || [])
      .filter((item) => !item.hardBlocked && (item.skillEligible || item.jobScore >= relaxedMinimum) && !alreadySubmitted(item))
      .sort((a, b) => b.rankingScore - a.rankingScore);
  }
  queue = [...new Map(queue.map((item) => [applicationFingerprint(autopilotState.currentCompany?.company || item.company, item.title, item.url), item])).values()];
  queue = queue.map((item) => ({ ...item, verificationStatus: "verified_match", liveJobVerified: true }));
  if (queue.length) {
    const remaining = Math.max(1, autopilotState.dailyLimit - autopilotState.processed);
    autopilotState.jobQueue = queue.slice(0, Math.min(remaining, autopilotState.maxPerCompany));
    autopilotState.jobQueueIndex = 0;
    const first = autopilotState.jobQueue[0];
    const verifiedSearch = first.officialSearchTerm ? `官网已实际搜索“${first.officialSearchTerm}”；` : "";
    await recordCompanyVerification(autopilotState.currentCompany.company, {
      status: "verified_match",
      liveJobCount: (autopilotState.roleResults || []).length,
      matchedJobCount: autopilotState.jobQueue.length,
      flowSummary: flow.summary,
      url: autopilotState.currentCompany.url
    });
    return openAutoCandidate(tabId, first, `全部方向搜索完成；${verifiedSearch}${autopilotState.currentCompany.company} 共找到 ${autopilotState.jobQueue.length} 个匹配岗位，先投：${first.title}`);
  }

  const attemptedKeywords = response.officialFilters?.keywords || [];
  const searchUnverified = attemptedKeywords.length > 0 && response.officialFilters?.searchVerified === false;
  const entryUnverified = !["direct_link", "click_card"].includes(flow.openMethod);
  if (searchUnverified || flow.pageType !== "list" || entryUnverified) {
    const missing = [
      searchUnverified ? "官网搜索没有确认生效" : "",
      flow.pageType !== "list" ? "尚未确认岗位列表" : "",
      entryUnverified ? "尚未确认岗位卡进入详情的方式" : ""
    ].filter(Boolean).join("、");
    await recordCompanyVerification(autopilotState.currentCompany.company, {
      status: "flow_incomplete",
      liveJobCount: (autopilotState.roleResults || []).length,
      matchedJobCount: 0,
      flowSummary: flow.summary,
      reason: missing,
      url: autopilotState.currentCompany.url
    });
    autopilotState.resumeStage = "scan";
    return pauseAutopilot("waiting_site_flow", `${autopilotState.currentCompany.company} 的投递流程尚未验证完整（${missing}），已暂停而不是跳过；请检查页面后点击“处理后继续”`);
  }

  autopilotState.skipped += 1;
  await recordCompanyVerification(autopilotState.currentCompany.company, {
    status: "no_match",
    liveJobCount: (autopilotState.roleResults || []).length,
    matchedJobCount: 0,
    flowSummary: flow.summary,
    reason: "官网存在可验证岗位流程，但当前没有符合城市、类型、技能和最低匹配分的岗位",
    url: autopilotState.currentCompany.url
  });
  await addHistory("no_matching_job", `已逐个搜索 ${(autopilotState.rolePlan || []).map((item) => item.role).join("、")}，未找到达标岗位`);
  await markCompanyTemporarilyInactive(autopilotState.currentCompany?.company, "当前官网没有活跃的匹配岗位");
  await moveToNextCompany("全部候选方向均无匹配岗位");
}

async function markCompanyTemporarilyInactive(company, reason = "") {
  if (!company) return;
  const { inactiveCompanies = {} } = await chrome.storage.local.get("inactiveCompanies");
  inactiveCompanies[company] = {
    checkedAt: Date.now(),
    retryAfter: Date.now() + 24 * 60 * 60 * 1000,
    reason
  };
  await chrome.storage.local.set({ inactiveCompanies });
}

async function openAutoCandidate(tabId, candidate, message = "") {
  autopilotState.currentJob = candidate;
  autopilotState.currentRole = autopilotState.rolePlan?.find((item) => item.role === candidate.matchedRole) || autopilotState.currentRole;
  autopilotState.stage = "job";
  autopilotState.resumeStage = "job";
  autopilotState.jobOpenChecks = 0;
  autopilotState.locationChecks = 0;
  autopilotState.verifyChecks = 0;
  autopilotState.loginAttempts = 0;
  autopilotState.resumeCreateSteps = 0;
  autopilotState.resumeCreateIdleChecks = 0;
  autopilotState.resumeSavePending = false;
  autopilotState.resumeCreationUrl = "";
  autopilotState.lastMessage = message || `已选择：${candidate.title}（方向：${candidate.matchedRole || "简历匹配"}）`;
  if (candidate.clickToken) {
    const sourceUrl = candidate.sourceUrl || "";
    const rememberedListTab = autopilotState.sourceListTabId
      ? await chrome.tabs.get(autopilotState.sourceListTabId).catch(() => null)
      : null;
    if (rememberedListTab && sourceUrl && canonicalTabUrl(rememberedListTab.url) === canonicalTabUrl(sourceUrl)) {
      tabId = rememberedListTab.id;
      autopilotState.tabId = tabId;
      await chrome.tabs.update(tabId, { active: true });
    } else {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null);
      if (sourceUrl && canonicalTabUrl(currentTab?.url) !== canonicalTabUrl(sourceUrl)) {
        autopilotState.sourceListTabId = tabId;
        autopilotState.lastMessage = `${autopilotState.lastMessage}；正在返回该企业岗位列表定位此岗位`;
        await persistAutopilot();
        await chrome.tabs.update(tabId, { url: sourceUrl, active: true });
        return;
      }
      autopilotState.sourceListTabId = tabId;
    }
    const beforeTabs = await chrome.tabs.query({});
    autopilotState.pendingJobOpen = {
      sourceTabId: tabId,
      sourceUrl,
      beforeTabIds: beforeTabs.map((item) => item.id),
      expectedUrl: "",
      startedAt: Date.now()
    };
    await persistAutopilot();
    const opened = await sendTabMessage(tabId, {
      type: "OPEN_SCANNED_JOB",
      clickToken: candidate.clickToken,
      searchTerm: candidate.officialSearchTerm || ""
    });
    if (!opened.clicked) throw new Error("无法打开动态岗位卡片");
    if (opened.targetUrl && autopilotState.pendingJobOpen) autopilotState.pendingJobOpen.expectedUrl = opened.targetUrl;
    if (opened.sameTabNavigation) autopilotState.pendingJobOpen = null;
    await persistAutopilot();
    scheduleAutoStep(tabId, 1800);
  } else {
    autopilotState.pendingJobOpen = null;
    await persistAutopilot();
    await chrome.tabs.update(tabId, { url: candidate.url, active: true });
  }
}

async function maybeAdoptPendingJobTab(tabId) {
  const pending = autopilotState?.pendingJobOpen;
  if (!pending || Date.now() - pending.startedAt > 12000 || pending.beforeTabIds.includes(tabId)) return false;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !/^https?:/i.test(tab.url)) return false;
  let sameHost = false;
  try { sameHost = new URL(tab.url).hostname === new URL(pending.sourceUrl).hostname; } catch {}
  const exactExpected = pending.expectedUrl && canonicalTabUrl(tab.url) === canonicalTabUrl(pending.expectedUrl);
  const looksLikeDetail = /(post_detail|job[-_/]?detail|position[-_/]?detail|jobdesc|\/jobs?\/[^/?#]+)/i.test(tab.url)
    && !/(job-list|position-list|\/post\.html)/i.test(tab.url);
  if (!exactExpected && !(sameHost && looksLikeDetail)) return false;
  autopilotState.sourceListTabId = pending.sourceTabId;
  autopilotState.tabId = tabId;
  autopilotState.pendingJobOpen = null;
  autopilotState.lastMessage = "已确认官网在新标签页打开岗位详情，自动接管并继续投递";
  await persistAutopilot();
  scheduleAutoStep(tabId, 500);
  return true;
}

async function moveToNextJobInCompany(reason = "") {
  if (!autopilotState?.active) return;
  if (autopilotState.processed >= autopilotState.dailyLimit) return moveToNextCompany(reason);
  const queue = autopilotState.jobQueue || [];
  const nextIndex = Number(autopilotState.jobQueueIndex ?? -1) + 1;
  if (nextIndex < queue.length) {
    autopilotState.jobQueueIndex = nextIndex;
    autopilotState.currentJob = null;
    autopilotState.siteFlow = null;
    const next = queue[nextIndex];
    return openAutoCandidate(
      autopilotState.tabId,
      next,
      `${reason ? `${reason}；` : ""}同一企业继续投递第 ${nextIndex + 1}/${queue.length} 个匹配岗位：${next.title}`
    );
  }
  return moveToNextCompany(`${reason ? `${reason}；` : ""}该企业的匹配岗位已处理完`);
}

async function autoJobStage(tabId) {
  if (!(await ensureCurrentPageScripts(tabId))) return;
  const pageState = await sendTabMessage(tabId, { type: "CHECK_APPLICATION_PAGE" });
  if (pageState.captcha) return handleCaptcha("岗位详情页出现验证码");
  if (pageState.login) return attemptAutoLogin(tabId, "岗位详情页需要登录");
  if (pageState.applicationConflict) {
    autopilotState.resumeStage = "job";
    return pauseAutopilot("waiting_application_conflict", "官网提示当前账号已有其他岗位申请；更换岗位可能覆盖原申请，必须由你确认后再继续");
  }
  if (pageState.resumeCreationPage) return startResumeCreation(tabId, "官网已进入站内简历创建页面");
  if (pageState.resumeCreationRequired) {
    const opened = await sendTabMessage(tabId, { type: "OPEN_APPLICATION" });
    if (!opened.clicked) return pauseAutopilot("waiting_resume_creation", "官网要求先创建站内简历，但未能可靠进入创建页面");
    return startResumeCreation(tabId, "官网要求先创建站内简历，正在进入创建页面");
  }
  const detailUrlSignal = /(?:\/campus\/position\/[^/?#]+\/detail|post_detail|job[-_/]?detail|position[-_/]?detail|\/jobs?\/[^/?#]+|\/positions?\/[^/?#]+)/i.test(pageState.url || "")
    && !/(job-list|position-list|\/campus\/position\/?(?:\?|$)|\/jobs?\/?(?:\?|$)|\/positions?\/?(?:\?|$))/i.test(pageState.url || "");
  if (pageState.pageType === "unknown" && detailUrlSignal) {
    const checks = Number(autopilotState.jobOpenChecks || 0);
    if (checks < 7) {
      autopilotState.jobOpenChecks = checks + 1;
      autopilotState.lastMessage = `已进入岗位详情地址，等待官网异步加载职责和投递入口（${autopilotState.jobOpenChecks}/7）`;
      await persistAutopilot();
      scheduleAutoStep(tabId, 900);
      return;
    }
  }
  // 动态卡片打开详情可能跨标签或由 SPA 延迟渲染。仍停留在岗位列表时先等待，
  // 不要立刻把列表页误判成“详情页缺少申请按钮”。
  const stillOnList = (pageState.pageType === "list" || /job-list|position-list|jobs(?:\?|$)|positions(?:\?|$)/i.test(pageState.url || "")) && !pageState.formPresent;
  if (stillOnList) {
    const checks = Number(autopilotState.jobOpenChecks || 0);
    if (checks >= 4) {
      return pauseAutopilot("waiting_job_open", "官网仍停留在岗位列表：岗位卡片未能打开，需要人工确认");
    }
    autopilotState.jobOpenChecks = checks + 1;
    autopilotState.lastMessage = `岗位卡片尚未打开，正在兼容重试（${autopilotState.jobOpenChecks}/4）`;
    await persistAutopilot();
    await retryOpenCurrentCandidate(tabId, autopilotState.jobOpenChecks);
    scheduleAutoStep(autopilotState.tabId || tabId, 1200);
    return;
  }
  autopilotState.jobOpenChecks = 0;
  autopilotState.pendingJobOpen = null;
  const locationCheck = await sendTabMessage(tabId, {
    type: "VERIFY_JOB_LOCATION",
    profile: autopilotState.profile,
    job: autopilotState.currentJob || {}
  });
  if (locationCheck.status === "unknown") {
    const checks = Number(autopilotState.locationChecks || 0);
    if (checks < 2) {
      autopilotState.locationChecks = checks + 1;
      autopilotState.lastMessage = `正在读取岗位详情中的工作地点（${autopilotState.locationChecks}/2），确认符合后才会投递`;
      await persistAutopilot();
      scheduleAutoStep(tabId, 850);
      return;
    }
    autopilotState.skipped += 1;
    await addHistory("city_unconfirmed", `岗位详情未能确认工作地点；期望：${(locationCheck.targetCities || []).join("、")}`);
    return moveToNextJobInCompany(`无法确认工作地点是否符合 ${(locationCheck.targetCities || []).join("、")}，已安全跳过`);
  }
  if (locationCheck.status === "mismatch") {
    autopilotState.skipped += 1;
    await addHistory("city_mismatch", `工作地点不匹配；发现：${(locationCheck.foundCities || []).join("、")}；期望：${(locationCheck.targetCities || []).join("、")}`);
    return moveToNextJobInCompany(`工作地点为 ${(locationCheck.foundCities || []).join("、") || "其他城市"}，不符合 ${(locationCheck.targetCities || []).join("、")}，已跳过`);
  }
  autopilotState.locationChecks = 0;
  autopilotState.currentJob = {
    ...(autopilotState.currentJob || {}),
    cityMatchStatus: locationCheck.status,
    matchedCities: locationCheck.matchedCities || [],
    locationEvidence: locationCheck.evidence || []
  };
  autopilotState.lastMessage = locationCheck.status === "matched"
    ? `已确认工作地点符合：${(locationCheck.matchedCities || []).join("、")}`
    : (locationCheck.status === "flexible" ? "已确认该岗位支持全国/远程地点" : "目标城市不限，继续投递");
  await persistAutopilot();
  const detailPreparation = await sendTabMessage(tabId, {
    type: "PREPARE_JOB_DETAIL",
    profile: autopilotState.profile,
    job: autopilotState.currentJob || {}
  });
  if (detailPreparation.site !== "generic" && (!detailPreparation.prepared || detailPreparation.missingDepartment)) {
    return pauseAutopilot("waiting_job_choice", "已进入岗位详情，但官网仍要求选择岗位意向、地点或部门；请完成选择后点击继续");
  }
  const response = await sendTabMessage(tabId, { type: "OPEN_APPLICATION" });
  if (response.captcha) return handleCaptcha("岗位详情页出现验证码");
  if (response.login) return attemptAutoLogin(tabId, "打开投递入口后需要登录");
  if (response.applicationConflict) {
    autopilotState.resumeStage = "job";
    return pauseAutopilot("waiting_application_conflict", "官网提示当前账号已有其他岗位申请；更换岗位可能覆盖原申请，必须由你确认后再继续");
  }
  if (response.resumeCreationRequired || response.creatingResume) {
    return startResumeCreation(tabId, "官网要求先创建站内简历，正在用已导入资料创建");
  }
  if (!response.clicked && !response.formPresent) {
    return pauseAutopilot("application_entry_missing", "已进入职位详情，但未找到可靠的“申请/投递”入口，需要人工确认");
  }
  autopilotState.stage = "apply";
  autopilotState.resumeStage = "apply";
  autopilotState.lastMessage = response.formPresent ? "申请表已打开，准备填写" : "已点击申请，等待申请表加载";
  await persistAutopilot();
  scheduleAutoStep(tabId, response.clicked ? 2200 : 300);
}

async function ensureCurrentPageScripts(tabId) {
  const expectedVersion = chrome.runtime.getManifest().version;
  const versionInfo = await chrome.tabs.sendMessage(tabId, { type: "GET_CONTENT_VERSION" }).catch(() => null);
  if (versionInfo?.ok && versionInfo.version === expectedVersion && versionInfo.mainBridgeVersion === expectedVersion) {
    if (autopilotState.contentRefreshes) {
      autopilotState.contentRefreshes = 0;
      await persistAutopilot();
    }
    return true;
  }
  const refreshes = Number(autopilotState.contentRefreshes || 0);
  if (refreshes >= 2) {
    await pauseAutopilot("waiting_script_refresh", "岗位页未加载当前版本的点击组件；请手动刷新该页面后点击“处理后继续”");
    return false;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  autopilotState.contentRefreshes = refreshes + 1;
  if (/job-list|position-list|campus-recruitment-job-list/i.test(tab?.url || "")) {
    autopilotState.stage = "scan";
    autopilotState.resumeStage = "scan";
    autopilotState.jobOpenChecks = 0;
  }
  autopilotState.lastMessage = `检测到岗位页仍是旧脚本，正在自动刷新并恢复（${autopilotState.contentRefreshes}/2）`;
  await persistAutopilot();
  await chrome.tabs.reload(tabId);
  return false;
}

async function retryOpenCurrentCandidate(tabId, attempt) {
  const candidate = autopilotState.currentJob || {};
  if (!candidate.clickToken) return false;
  const beforeTabs = await chrome.tabs.query({}).catch(() => []);
  autopilotState.pendingJobOpen = {
    sourceTabId: tabId,
    sourceUrl: candidate.sourceUrl || "",
    beforeTabIds: beforeTabs.map((item) => item.id),
    expectedUrl: "",
    startedAt: Date.now()
  };
  await persistAutopilot();
  // 每次重试都先让隔离脚本恢复候选岗位对应的官网关键词；否则腾讯处于 0 条结果
  // 时，直接在主世界点击只会再次得到 card_missing。
  let response = await sendTabMessage(tabId, {
    type: "OPEN_SCANNED_JOB",
    clickToken: candidate.clickToken,
    searchTerm: candidate.officialSearchTerm || ""
  }).catch(() => null);
  if (!response?.clicked && attempt > 1) {
    response = await sendTabMessage(tabId, {
      type: "OPEN_SCANNED_JOB_MAIN",
      clickToken: candidate.clickToken
    }).catch(() => null);
  }
  if (response?.targetUrl && autopilotState.pendingJobOpen) autopilotState.pendingJobOpen.expectedUrl = response.targetUrl;
  if (response?.sameTabNavigation) autopilotState.pendingJobOpen = null;
  await persistAutopilot();
  return Boolean(response?.clicked);
}

async function autoApplyStage(tabId) {
  const { resumeFile = null } = await chrome.storage.local.get("resumeFile");
  const response = await sendTabMessage(tabId, {
    type: "FILL_APPLICATION",
    profile: autopilotState.profile,
    resumeFile
  });
  if (response.login) return attemptAutoLogin(tabId, "填写申请前需要登录");
  if (response.captcha) return handleCaptcha("申请表出现验证码");
  if (!response.formPresent) {
    const pageState = await sendTabMessage(tabId, { type: "CHECK_APPLICATION_PAGE" });
    if (pageState.applicationConflict) {
      autopilotState.resumeStage = "apply";
      return pauseAutopilot("waiting_application_conflict", "官网提示当前账号已有其他岗位申请；更换岗位可能覆盖原申请，必须由你确认后再继续");
    }
    if (pageState.resumeCreationRequired || pageState.resumeCreationPage) {
      return startResumeCreation(tabId, "检测到申请前置的站内简历创建流程");
    }
    autopilotState.stage = "job";
    autopilotState.resumeStage = "job";
    autopilotState.lastMessage = "当前还不是申请表，正在重新进入申请流程";
    await persistAutopilot();
    scheduleAutoStep(tabId, 400);
    return;
  }
  if (response.unknown > 0) {
    autopilotState.resumeStage = "apply";
    return pauseAutopilot("waiting_info", `有 ${response.unknown} 个新必填项需要回答；回答会被记住`);
  }
  if (autopilotState.submissionMode === "dry_run") {
    autopilotState.processed += 1;
    await addHistory("dry_run_ready", "试运行已完成：岗位、地点和表单均已核验，未点击最终提交");
    return moveToNextJobInCompany("试运行完成，未提交");
  }
  if (autopilotState.submissionMode === "review") {
    autopilotState.resumeStage = "verify";
    if (!autopilotState.currentJob?.reviewReadyRecorded) {
      autopilotState.currentJob = { ...(autopilotState.currentJob || {}), reviewReadyRecorded: true };
      await addHistory("ready_for_review", "资料已填写完成，等待用户检查并手动提交");
    }
    await persistAutopilot();
    return pauseAutopilot("ready_to_submit", "资料已填完；请检查后手动提交，再点击“处理后继续”确认结果");
  }
  if (!autopilotState.profile.autoSubmitEnabled) return pauseAutopilot("ready_to_submit", "全自动模式缺少最终提交授权，已安全暂停");
  const submitted = await sendTabMessage(tabId, { type: "SUBMIT_APPLICATION" });
  if (submitted.captcha) return handleCaptcha("最终提交前出现验证码");
  if (!submitted.submitted) return pauseAutopilot("ready_to_submit", "未能可靠识别最终提交按钮，需要人工确认");
  autopilotState.stage = "verify";
  autopilotState.resumeStage = "verify";
  autopilotState.verifyChecks = 0;
  autopilotState.lastMessage = "已点击最终提交，正在确认结果";
  await persistAutopilot();
  scheduleAutoStep(tabId, 2500);
}

async function startResumeCreation(tabId, message) {
  autopilotState.stage = "resume_create";
  autopilotState.resumeStage = "resume_create";
  autopilotState.resumeCreateSteps = Number(autopilotState.resumeCreateSteps || 0);
  autopilotState.resumeCreateIdleChecks = 0;
  autopilotState.resumeCreationUrl ||= (await chrome.tabs.get(tabId).catch(() => null))?.url || "";
  autopilotState.lastMessage = message;
  await persistAutopilot();
  scheduleAutoStep(tabId, 1500);
}

async function autoResumeCreateStage(tabId) {
  if (!(await ensureCurrentPageScripts(tabId))) return;
  const { resumeFile = null } = await chrome.storage.local.get("resumeFile");
  const response = await sendTabMessage(tabId, {
    type: "CREATE_RESUME_FROM_PROFILE",
    profile: autopilotState.profile,
    resumeFile
  });
  if (response.login) return attemptAutoLogin(tabId, "创建站内简历前需要登录");
  if (response.captcha) return handleCaptcha("创建站内简历时出现验证码");
  if (response.unknown > 0) {
    autopilotState.resumeStage = "resume_create";
    return pauseAutopilot("waiting_info", `创建站内简历时有 ${response.unknown} 个新必填项需要回答；回答会被记住`);
  }
  if (response.resumeCreationRequired && !response.navigating) {
    return pauseAutopilot("waiting_resume_creation", "官网要求创建站内简历，但创建入口无法可靠点击");
  }
  if (response.navigating || response.advanced) {
    autopilotState.resumeCreateSteps = Number(autopilotState.resumeCreateSteps || 0) + 1;
    autopilotState.resumeCreateIdleChecks = 0;
    if (autopilotState.resumeCreateSteps > 15) {
      return pauseAutopilot("waiting_resume_creation", "站内简历创建步骤超过安全上限，请检查页面后继续");
    }
    autopilotState.lastMessage = response.navigating
      ? "正在打开站内简历创建页面"
      : `站内简历已填写并进入下一步${response.actionLabel ? `：${response.actionLabel}` : ""}`;
    await persistAutopilot();
    scheduleAutoStep(tabId, 1500);
    return;
  }
  if (response.saved) {
    autopilotState.resumeSavePending = true;
    autopilotState.resumeCreateIdleChecks = 0;
    autopilotState.lastMessage = "已填写站内简历并点击保存，正在确认创建结果";
    await persistAutopilot();
    scheduleAutoStep(tabId, 1800);
    return;
  }
  if (response.complete || (autopilotState.resumeSavePending && !response.resumeCreationPage)) {
    return returnToJobAfterResumeCreation(tabId);
  }
  if (autopilotState.resumeSavePending && response.action === "saving") {
    autopilotState.resumeCreateIdleChecks = Number(autopilotState.resumeCreateIdleChecks || 0) + 1;
    if (autopilotState.resumeCreateIdleChecks <= 4) {
      autopilotState.lastMessage = "官网正在保存站内简历，等待结果";
      await persistAutopilot();
      scheduleAutoStep(tabId, 1200);
      return;
    }
    return pauseAutopilot("waiting_resume_creation", "已点击保存站内简历，但官网没有返回明确成功结果；请确认后点击继续");
  }
  autopilotState.resumeCreateIdleChecks = Number(autopilotState.resumeCreateIdleChecks || 0) + 1;
  if (autopilotState.resumeCreateIdleChecks <= 3) {
    autopilotState.lastMessage = "正在识别站内简历的下一步";
    await persistAutopilot();
    scheduleAutoStep(tabId, 900);
    return;
  }
  return pauseAutopilot("waiting_resume_creation", "已进入站内简历流程，但未找到可靠的下一步或保存按钮；请检查页面后点击继续");
}

async function returnToJobAfterResumeCreation(tabId) {
  const jobUrl = autopilotState.currentJob?.url;
  autopilotState.resumeSavePending = false;
  autopilotState.resumeCreateIdleChecks = 0;
  autopilotState.stage = "job";
  autopilotState.resumeStage = "job";
  autopilotState.lastMessage = "站内简历已创建，正在返回原岗位继续申请";
  await persistAutopilot();
  if (jobUrl) await chrome.tabs.update(tabId, { url: jobUrl, active: true });
  else scheduleAutoStep(tabId, 600);
}

async function autoVerifyStage(tabId) {
  const response = await sendTabMessage(tabId, { type: "DETECT_APPLICATION_SUCCESS" });
  if (!response.success && Number(autopilotState.verifyChecks || 0) < 2) {
    autopilotState.verifyChecks = Number(autopilotState.verifyChecks || 0) + 1;
    autopilotState.lastMessage = `正在确认官网提交结果（${autopilotState.verifyChecks}/2）`;
    await persistAutopilot();
    scheduleAutoStep(tabId, 1800);
    return;
  }
  if (!response.success && autopilotState.submissionMode === "review") {
    autopilotState.resumeStage = "verify";
    return pauseAutopilot("ready_to_submit", "尚未检测到官网提交成功；请确认是否已手动提交，然后再继续");
  }
  autopilotState.applied += 1;
  autopilotState.processed += 1;
  autopilotState.verifyChecks = 0;
  await addHistory(response.success ? "submitted" : "submitted_unverified", response.success ? "页面确认投递成功" : "已提交但页面未返回明确成功文字");
  await moveToNextJobInCompany(response.success ? "投递成功" : "已提交，结果待核验");
}

async function handleCaptcha(message) {
  if ((autopilotState.profile.captchaPolicy || "ask") === "skip") {
    autopilotState.skipped += 1;
    await addHistory("skipped_captcha", message);
    return moveToNextJobInCompany("遇到验证码，已按设置跳过当前岗位");
  }
  autopilotState.resumeStage = autopilotState.stage;
  return pauseAutopilot("waiting_captcha", `${message}；完成验证码后点击继续`);
}

async function attemptAutoLogin(tabId, reason) {
  const attempts = Number(autopilotState.loginAttempts || 0);
  const response = await sendTabMessage(tabId, { type: "TRY_AUTO_LOGIN" });
  if (["account_selected", "submitted_saved_credentials"].includes(response.status)) {
    autopilotState.loginAttempts = attempts + 1;
    autopilotState.lastMessage = response.status === "account_selected"
      ? `${reason}；已选择唯一的已保存账号，正在继续登录`
      : `${reason}；浏览器已填好账号信息，正在自动登录`;
    await persistAutopilot();
    scheduleAutoStep(tabId, 1600);
    return;
  }
  if (response.status === "multiple_accounts") {
    autopilotState.resumeStage = autopilotState.stage;
    return pauseAutopilot("waiting_account_choice", `检测到 ${response.accountCount} 个可用账号；请在官网选择要登录的账号，然后点击“处理后继续”`);
  }
  // 浏览器密码管理器可能比登录页晚一拍完成自动填充，先短暂重试一次。
  if (response.status === "credentials_needed" && attempts < 1) {
    autopilotState.loginAttempts = attempts + 1;
    autopilotState.lastMessage = `${reason}；正在等待浏览器填入已保存账号`;
    await persistAutopilot();
    scheduleAutoStep(tabId, 1000);
    return;
  }
  autopilotState.resumeStage = autopilotState.stage;
  return pauseAutopilot("waiting_login", `${reason}；没有可自动使用的单一账号，请手动登录后点击“处理后继续”`);
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
  const company = autopilotState.currentCompany?.company || "未知企业";
  const job = autopilotState.currentJob?.title || "未选择岗位";
  const url = autopilotState.currentJob?.url || autopilotState.currentCompany?.url || "";
  applicationHistory.push({
    time: new Date().toISOString(),
    company,
    job,
    url,
    fingerprint: applicationFingerprint(company, job, url),
    status,
    note,
    matchedCities: autopilotState.currentJob?.matchedCities || [],
    locationEvidence: autopilotState.currentJob?.locationEvidence || []
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

async function navigateAndScan(tabId, url, profile, company = "") {
  if (!tabId || !url) throw new Error("缺少岗位页面信息");
  await chrome.storage.local.set({ pendingManualScan: { tabId, profile, company, createdAt: Date.now(), depth: 0 } });
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
  const flow = await sendTabMessage(tabId, { type: "INSPECT_RECRUITMENT_FLOW", profile: pendingManualScan.profile }).catch(() => null);
  if (!response.results?.length && response.recommendedUrl && pendingManualScan.depth < 2) {
    pendingManualScan.depth += 1;
    await chrome.storage.local.set({ pendingManualScan });
    await chrome.tabs.update(tabId, { url: response.recommendedUrl, active: true });
    return;
  }
  if (!response.results?.length && response.entrances?.length && pendingManualScan.depth < 3) {
    const entrance = selectRecruitmentEntrance(response.entrances, pendingManualScan.profile, response.sourceUrl || flow?.url || "");
    pendingManualScan.depth += 1;
    await chrome.storage.local.set({ pendingManualScan });
    if (entrance.url) {
      await chrome.tabs.update(tabId, { url: entrance.url, active: true });
    } else {
      await sendTabMessage(tabId, { type: "CLICK_JOB_ENTRANCE", index: entrance.index });
      setTimeout(() => handlePendingManualScan(tabId).catch(() => {}), 1600);
    }
    return;
  }
  const minimum = Number(pendingManualScan.profile?.minJobFit || 0);
  const isMatched = (item) => !item.hardBlocked && (item.skillEligible || Number(item.jobScore ?? item.score ?? 0) >= minimum);
  const verifiedResults = (response.results || []).map((item) => ({
    ...item,
    verificationStatus: isMatched(item) ? "verified_match" : "live_job",
    liveJobVerified: true,
    verificationCheckedAt: Date.now()
  }));
  const matchedJobCount = verifiedResults.filter(isMatched).length;
  for (const item of verifiedResults) {
    item.liveJobCount = verifiedResults.length;
    item.matchedJobCount = matchedJobCount;
  }
  if (pendingManualScan.company) {
    await recordCompanyVerification(pendingManualScan.company, {
      status: matchedJobCount ? "verified_match" : "no_match",
      liveJobCount: verifiedResults.length,
      matchedJobCount,
      flowSummary: flow?.summary || "",
      reason: verifiedResults.length ? "已读取官网真实岗位并按当前资料筛选" : "官网当前未识别到活跃岗位",
      url: (await chrome.tabs.get(tabId)).url
    });
  }
  await chrome.storage.local.set({
    latestManualScan: { ...response, flow, results: verifiedResults, company: pendingManualScan.company, matchedJobCount, createdAt: Date.now(), url: (await chrome.tabs.get(tabId)).url },
    pendingManualScan: null
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "SHOW_AUTOMATION_NOTICE",
    notice: {
      title: verifiedResults.length ? `官网读取到 ${verifiedResults.length} 个真实岗位` : "仍未识别到具体岗位",
      message: verifiedResults.length ? `其中 ${matchedJobCount} 个符合当前条件；打开扩展即可查看。` : "该网站可能需要登录、选择招聘项目，或暂时没有公开岗位。"
    }
  }).catch(() => {});
}
