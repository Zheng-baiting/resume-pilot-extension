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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") handlePendingManualScan(tabId).catch(() => {});
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
    autopilotState.tabId = tab.id;
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
  const preferred = preferredCompanies
    .map((name) => VERIFIED_CAREER_SEEDS.find((seed) => seed.company.includes(name) || name.includes(seed.company)))
    .filter(Boolean);
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
    skipped: 0,
    dailyLimit: Math.max(1, Math.min(30, Number(profile.dailyLimit || 5))),
    currentCompany: null,
    currentJob: null,
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
    else if (autopilotState.stage === "verify") await autoVerifyStage(tabId);
  } finally {
    autoStepBusy = false;
  }
}

async function autoScanStage(tabId) {
  const role = autopilotState.currentRole || autopilotState.rolePlan?.[autopilotState.roleIndex] || { role: autopilotState.profile.targetRole, fit: 40 };
  const roleProfile = { ...autopilotState.profile, targetRole: role.role };
  // 每个公司、每次进入新的招聘页面都先识别流程，再开始找岗位。
  // 这样后续动作依据页面能力选择，而不是假设所有官网都和某一家相同。
  const flow = await sendTabMessage(tabId, { type: "INSPECT_RECRUITMENT_FLOW", profile: roleProfile });
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
  const { applicationHistory = [] } = await chrome.storage.local.get("applicationHistory");
  const appliedUrls = new Set(applicationHistory.map((item) => item.url));

  if (response.recommendedUrl && autopilotState.navigationDepth < 2) {
    autopilotState.navigationDepth += 1;
    autopilotState.siteFlow = null;
    await persistAutopilot();
    await chrome.tabs.update(tabId, { url: response.recommendedUrl, active: true });
    return;
  }

  const entrance = (response.entrances || []).find((item) => item.url) || response.entrances?.[0];
  if (entrance && autopilotState.navigationDepth < 2) {
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
    .filter((item) => !appliedUrls.has(item.url))
    .map((item) => ({
      ...item,
      matchedRole: role.role,
      rolePlanFit: role.fit,
      rankingScore: Math.round((item.score || 0) + Number(role.fit || 0) * 0.08)
    }));
  const resultMap = new Map((autopilotState.roleResults || []).map((item) => [item.url, item]));
  for (const item of evaluated) {
    if (!resultMap.has(item.url) || resultMap.get(item.url).rankingScore < item.rankingScore) resultMap.set(item.url, item);
  }
  autopilotState.roleResults = [...resultMap.values()].sort((a, b) => b.rankingScore - a.rankingScore).slice(0, 100);

  const candidates = evaluated
    .filter((item) => item.jobScore >= minimum)
    .sort((a, b) => b.rankingScore - a.rankingScore);
  if (candidates.length) return openAutoCandidate(tabId, candidates[0]);

  if (autopilotState.roleIndex + 1 < (autopilotState.rolePlan || []).length) {
    autopilotState.roleIndex += 1;
    autopilotState.currentRole = autopilotState.rolePlan[autopilotState.roleIndex];
    autopilotState.lastMessage = `${autopilotState.currentCompany.company} 暂无“${role.role}”达标岗位，继续搜索：${autopilotState.currentRole.role}`;
    await persistAutopilot();
    scheduleAutoStep(tabId, 350);
    return;
  }

  const relaxedMinimum = Math.max(30, minimum - 10);
  const fallback = (autopilotState.roleResults || [])
    .filter((item) => item.jobScore >= relaxedMinimum && !appliedUrls.has(item.url))
    .sort((a, b) => b.rankingScore - a.rankingScore)[0];
  if (fallback) return openAutoCandidate(tabId, fallback, `全部方向搜索完成，选择最接近岗位：${fallback.title}`);

  autopilotState.skipped += 1;
  await addHistory("no_matching_job", `已逐个搜索 ${(autopilotState.rolePlan || []).map((item) => item.role).join("、")}，未找到达标岗位`);
  await moveToNextCompany("全部候选方向均无匹配岗位");
}

async function openAutoCandidate(tabId, candidate, message = "") {
  autopilotState.currentJob = candidate;
  autopilotState.currentRole = autopilotState.rolePlan?.find((item) => item.role === candidate.matchedRole) || autopilotState.currentRole;
  autopilotState.stage = "job";
  autopilotState.resumeStage = "job";
  autopilotState.jobOpenChecks = 0;
  autopilotState.lastMessage = message || `已选择：${candidate.title}（方向：${candidate.matchedRole || "简历匹配"}）`;
  await persistAutopilot();
  if (candidate.clickToken) {
    const opened = await sendTabMessage(tabId, {
      type: "OPEN_SCANNED_JOB",
      clickToken: candidate.clickToken,
      searchTerm: candidate.officialSearchTerm || ""
    });
    if (!opened.clicked) throw new Error("无法打开动态岗位卡片");
    scheduleAutoStep(tabId, 1800);
  } else {
    await chrome.tabs.update(tabId, { url: candidate.url, active: true });
  }
}

async function autoJobStage(tabId) {
  const pageState = await sendTabMessage(tabId, { type: "CHECK_APPLICATION_PAGE" });
  if (pageState.captcha) return handleCaptcha("岗位详情页出现验证码");
  if (pageState.login) return pauseAutopilot("waiting_login", "需要登录招聘网站；登录后点击继续");
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
  const response = await sendTabMessage(tabId, { type: "OPEN_APPLICATION" });
  if (response.captcha) return handleCaptcha("岗位详情页出现验证码");
  if (response.login) return pauseAutopilot("waiting_login", "需要登录招聘网站；登录后点击继续");
  if (!response.clicked && !response.formPresent) {
    return pauseAutopilot("application_entry_missing", "已进入职位详情，但未找到可靠的“申请/投递”入口，需要人工确认");
  }
  autopilotState.stage = "apply";
  autopilotState.resumeStage = "apply";
  autopilotState.lastMessage = response.formPresent ? "申请表已打开，准备填写" : "已点击申请，等待申请表加载";
  await persistAutopilot();
  scheduleAutoStep(tabId, response.clicked ? 2200 : 300);
}

async function retryOpenCurrentCandidate(tabId, attempt) {
  const candidate = autopilotState.currentJob || {};
  if (!candidate.clickToken) return false;
  // 第一次沿用隔离脚本；后续在网页主世界重新定位真实卡片，兼容 Vue/React
  // 把事件处理器挂在主页面对象上的招聘官网。
  if (attempt === 1) {
    const response = await sendTabMessage(tabId, {
      type: "OPEN_SCANNED_JOB",
      clickToken: candidate.clickToken,
      searchTerm: candidate.officialSearchTerm || ""
    }).catch(() => null);
    return Boolean(response?.clicked);
  }
  const response = await sendTabMessage(tabId, {
    type: "OPEN_SCANNED_JOB_MAIN",
    clickToken: candidate.clickToken
  }).catch(() => null);
  return Boolean(response?.clicked);
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
  if (!response.formPresent) {
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
