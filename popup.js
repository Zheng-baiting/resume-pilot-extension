const PROFILE_FIELDS = [
  "resumeText", "fullName", "phone", "email", "school", "major", "degree",
  "graduationYear", "currentCity", "skills", "targetRole", "targetCity",
  "targetIndustry", "positionType", "preferredCompanies", "qualityFocus",
  "availableDays", "internshipMonths", "maxExperienceYears", "minJobFit",
  "minDailySalary", "minMonthlySalary", "avoidJobKeywords", "avoidCompanyKeywords",
  "dailyLimit", "captchaPolicy", "autoSubmitEnabled"
];

let searchPage = 0;
let searchHasMore = false;
let searchLoading = false;
let activeSearchProfile = null;
const renderedUrls = new Set();

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindActions();
  await restoreProfile();
  await restoreResumeFile();
  await restoreLatestScan();
  await refreshAutopilotStatus();
  window.addEventListener("scroll", () => {
    if (searchHasMore && !searchLoading && window.innerHeight + window.scrollY >= document.body.scrollHeight - 90) {
      loadMoreCompanies();
    }
  });
});

function bindTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab, .panel").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });
}

function bindActions() {
  document.getElementById("parseResume").addEventListener("click", parseResumeText);
  document.getElementById("saveProfile").addEventListener("click", saveProfile);
  document.getElementById("searchCompanies").addEventListener("click", () => searchCompanies(true));
  document.getElementById("loadMore").addEventListener("click", loadMoreCompanies);
  document.getElementById("scanJobs").addEventListener("click", scanCurrentJobs);
  document.getElementById("fillPage").addEventListener("click", fillCurrentPage);
  document.getElementById("importResumeFile").addEventListener("change", importResumeFile);
  document.getElementById("resumeFileInput").addEventListener("change", saveResumeFile);
  document.getElementById("startAutopilot").addEventListener("click", startAutopilot);
  document.getElementById("resumeAutopilot").addEventListener("click", resumeAutopilot);
  document.getElementById("stopAutopilot").addEventListener("click", stopAutopilot);
}

async function restoreProfile() {
  const { profile = {} } = await chrome.storage.local.get("profile");
  for (const field of PROFILE_FIELDS) {
    const element = document.getElementById(field);
    if (profile[field] != null) {
      if (element.type === "checkbox") element.checked = Boolean(profile[field]);
      else element.value = profile[field];
    }
  }
}

function collectProfile() {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => {
    const element = document.getElementById(field);
    return [field, element.type === "checkbox" ? element.checked : element.value.trim()];
  }));
}

async function saveProfile() {
  await chrome.storage.local.set({ profile: collectProfile() });
  flash("资料已保存在本机");
}

function flash(message) {
  const target = document.getElementById("saveStatus");
  target.textContent = message;
  const duration = String(message).length > 20 ? 6000 : 2800;
  setTimeout(() => { target.textContent = ""; }, duration);
}

function parseResumeText(options = {}) {
  const text = document.getElementById("resumeText").value.trim();
  if (!text) {
    if (!options.silent) flash("请先粘贴或导入简历");
    return 0;
  }

  const values = ResumePilotImport.parseResumeProfile(text, options.fileName || "");
  let filled = 0;
  Object.entries(values).forEach(([key, value]) => {
    const element = document.getElementById(key);
    if (value && element && (options.overwrite || !element.value)) {
      element.value = String(value);
      filled += 1;
    }
  });
  if (!options.silent) flash("已识别可确认的信息，请检查后保存");
  return filled;
}

async function importResumeFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    flash(`正在读取 ${file.name}…`);
    const result = await ResumePilotImport.read(file);
    if (result.kind === "profile") {
      const data = result.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON 顶层必须是资料对象");
      for (const field of PROFILE_FIELDS) {
        if (data[field] != null) {
          const element = document.getElementById(field);
          if (element.type === "checkbox") element.checked = data[field] === true;
          else element.value = String(data[field]);
        }
      }
      await saveProfile();
      flash("JSON 资料已导入并保存在本机，请检查内容");
      return;
    }

    document.getElementById("resumeText").value = result.text;
    const recognized = parseResumeText({ silent: true, fileName: file.name, overwrite: true });
    if (result.saveAsAttachment) await storeResumeAttachment(file);
    await saveProfile();
    flash(`已读取 ${file.name}，识别 ${recognized} 项并保存在本机`);
  } catch (error) {
    const isJson = ResumePilotImport.getExtension(file.name) === "json";
    const message = isJson && !String(error?.message || "").includes("顶层")
      ? "JSON 文件格式不正确"
      : error?.message;
    flash(message || "简历文件读取失败");
  } finally {
    event.target.value = "";
  }
}

async function saveResumeFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const extension = ResumePilotImport.getExtension(file.name);
  if (file.size > ResumePilotImport.MAX_FILE_SIZE) {
    flash("简历附件不能超过 5MB");
    event.target.value = "";
    return;
  }
  if (!["pdf", "docx"].includes(extension)) {
    flash("投递附件请使用 PDF 或 DOCX 文件");
    event.target.value = "";
    return;
  }
  try {
    await storeResumeAttachment(file);
    flash("投递附件已保存在本机");
  } catch {
    flash("投递附件保存失败，请重试");
  }
  event.target.value = "";
}

async function storeResumeAttachment(file) {
  const base64 = await fileToBase64(file);
  await chrome.storage.local.set({ resumeFile: { name: file.name, type: file.type, base64 } });
  document.getElementById("resumeFileName").textContent = `已保存：${file.name}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function restoreResumeFile() {
  const { resumeFile } = await chrome.storage.local.get("resumeFile");
  if (resumeFile?.name) document.getElementById("resumeFileName").textContent = `已保存：${resumeFile.name}`;
}

async function restoreLatestScan() {
  const { latestManualScan } = await chrome.storage.local.get("latestManualScan");
  if (!latestManualScan?.results?.length || Date.now() - latestManualScan.createdAt > 10 * 60 * 1000) return;
  const profile = collectProfile();
  renderedUrls.clear();
  document.getElementById("results").replaceChildren();
  const display = displayScannedResults(latestManualScan.results, profile);
  renderResults(display.items);
  document.getElementById("searchStatus").className = "status success";
  document.getElementById("searchStatus").textContent = display.usedFallback
    ? `官网找到 ${latestManualScan.results.length} 个岗位，但没有达到当前最低匹配分；已显示最接近的候选。`
    : `自动进入岗位页后找到 ${latestManualScan.results.length} 个岗位。`;
}

async function startAutopilot() {
  await saveProfile();
  const profile = collectProfile();
  const status = document.getElementById("autopilotStatus");
  if (!profile.autoSubmitEnabled) {
    status.className = "status error";
    status.textContent = "请先勾选自动提交授权。";
    return;
  }
  status.className = "status";
  status.textContent = "正在启动自动投递队列…";
  const response = await chrome.runtime.sendMessage({ type: "START_AUTOPILOT", profile });
  if (!response?.ok) {
    status.className = "status error";
    status.textContent = response?.error || "启动失败";
    return;
  }
  renderAutopilotState(response.state);
}

async function resumeAutopilot() {
  const response = await chrome.runtime.sendMessage({ type: "RESUME_AUTOPILOT" });
  if (!response?.ok) return renderAutopilotError(response?.error || "无法继续");
  renderAutopilotState(response.state);
}

async function stopAutopilot() {
  const response = await chrome.runtime.sendMessage({ type: "STOP_AUTOPILOT" });
  if (!response?.ok) return renderAutopilotError(response?.error || "无法停止");
  renderAutopilotState(response.state);
}

async function refreshAutopilotStatus() {
  const response = await chrome.runtime.sendMessage({ type: "GET_AUTOPILOT_STATUS" });
  if (response?.ok) renderAutopilotState(response.state);
  const { applicationHistory = [] } = await chrome.storage.local.get("applicationHistory");
  const container = document.getElementById("autopilotHistory");
  container.replaceChildren();
  for (const item of applicationHistory.slice(-8).reverse()) {
    const row = document.createElement("div");
    row.className = "history-item";
    row.textContent = `${item.company} · ${item.job} · ${historyStatus(item.status)}`;
    container.append(row);
  }
}

function renderAutopilotState(state) {
  const status = document.getElementById("autopilotStatus");
  const roles = document.getElementById("autopilotRoles");
  if (!state) {
    status.className = "status";
    status.textContent = "尚未启动";
    roles.textContent = "";
    return;
  }
  status.className = state.status.startsWith("waiting") || state.status === "error" ? "status error" : "status success";
  status.textContent = `${state.lastMessage || state.status}｜已投/尝试 ${state.applied || 0}，跳过 ${state.skipped || 0}`;
  const plan = state.rolePlan || [];
  const roleText = plan.length
    ? `简历岗位计划：${plan.map((item, index) => `${index === state.roleIndex ? "▶ " : ""}${item.role} ${item.fit}分`).join(" · ")}`
    : "";
  const flowText = state.siteFlow?.summary ? `官网流程：${state.siteFlow.summary}` : "";
  const queueText = state.jobQueue?.length
    ? `同企业岗位队列：${Math.max(1, Number(state.jobQueueIndex || 0) + 1)}/${state.jobQueue.length}`
    : "";
  roles.textContent = [flowText, queueText, roleText].filter(Boolean).join("\n");
}

function renderAutopilotError(message) {
  const status = document.getElementById("autopilotStatus");
  status.className = "status error";
  status.textContent = message;
}

function historyStatus(status) {
  const labels = {
    submitted: "投递成功",
    submitted_unverified: "已提交待核验",
    no_matching_job: "无匹配岗位",
    skipped_captcha: "验证码跳过"
  };
  return labels[status] || status;
}

async function searchCompanies(reset = true) {
  if (searchLoading) return;
  await saveProfile();
  const status = document.getElementById("searchStatus");
  const results = document.getElementById("results");
  const profile = reset ? collectProfile() : (activeSearchProfile || collectProfile());
  activeSearchProfile = profile;
  if (reset) {
    searchPage = 0;
    searchHasMore = false;
    renderedUrls.clear();
    results.replaceChildren();
  }
  searchLoading = true;
  status.className = "status";
  status.textContent = searchPage ? `正在加载第 ${searchPage + 1} 批企业…` : "正在搜索并筛选官网招聘入口…";
  document.getElementById("loadMore").hidden = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SEARCH_OFFICIAL_CAREERS",
      criteria: { ...buildSearchCriteria(profile), page: searchPage }
    });
    if (!response?.ok) throw new Error(response?.error || "搜索失败");
    renderResults(filterResults(response.results, profile));
    searchHasMore = Boolean(response.hasMore);
    status.className = "status success";
    const discovered = response.newlyDiscoveredCompanies?.length
      ? ` 本轮从公开招聘信息发现 ${response.newlyDiscoveredCompanies.length} 家新企业并已回查官网。`
      : "";
    status.textContent = response.results.length
      ? `已显示 ${renderedUrls.size} 个企业/岗位候选；${searchHasMore ? "向下滑动继续加载。" : "已加载当前活跃候选。"}${discovered}`
      : "没有找到合适结果，请换一组条件。";
    document.getElementById("loadMore").hidden = !searchHasMore;
    if (searchHasMore && document.body.scrollHeight <= window.innerHeight + 80) setTimeout(loadMoreCompanies, 250);
  } catch (error) {
    status.className = "status error";
    status.textContent = `${error.message}。可以稍后重试或填写优先企业名称。`;
  } finally {
    searchLoading = false;
  }
}

function buildSearchCriteria(profile) {
  return {
    role: profile.targetRole,
    city: profile.targetCity,
    industry: profile.targetIndustry,
    positionType: profile.positionType,
    skills: profile.skills,
    preferredCompanies: profile.preferredCompanies,
    qualityFocus: profile.qualityFocus,
    graduationYear: profile.graduationYear,
    degree: profile.degree,
    availableDays: profile.availableDays,
    internshipMonths: profile.internshipMonths,
    maxExperienceYears: profile.maxExperienceYears,
    minDailySalary: profile.minDailySalary,
    minMonthlySalary: profile.minMonthlySalary,
    avoidJobKeywords: profile.avoidJobKeywords,
    avoidCompanyKeywords: profile.avoidCompanyKeywords
  };
}

function loadMoreCompanies() {
  if (!searchHasMore || searchLoading) return;
  searchPage += 1;
  searchCompanies(false);
}

function renderResults(items) {
  const container = document.getElementById("results");
  for (const item of items) {
    const key = item.url.replace(/\/$/, "");
    if (renderedUrls.has(key)) continue;
    renderedUrls.add(key);
    const card = document.createElement("article");
    card.className = "result-card";
    const titleRow = document.createElement("div");
    titleRow.className = "result-title-row";
    const link = document.createElement(item.clickToken ? "button" : "a");
    if (item.clickToken) {
      link.type = "button";
      link.className = "dynamic-job-link";
      link.addEventListener("click", () => openDynamicJob(item));
    } else {
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    link.textContent = item.title || item.url;
    const badges = document.createElement("div");
    badges.className = "result-badges";
    const companyBadge = makeBadge(`企业 ${item.companyScore ?? "?"}`);
    const jobBadge = makeBadge(`匹配 ${item.jobScore ?? item.score ?? "?"}`);
    const payBadge = makeBadge(`待遇 ${item.compensationScore ?? "?"}`, "pay");
    badges.append(companyBadge, jobBadge, payBadge);
    titleRow.append(link, badges);
    const description = document.createElement("p");
    description.textContent = item.description;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `${item.company || "待核验企业"} · ${item.companySegment || "待分类"} · ${safeHost(item.url)}`;
    const reasons = document.createElement("div");
    reasons.className = "result-reasons";
    const pay = document.createElement("div");
    pay.className = "result-reasons";
    pay.textContent = `待遇判断：${item.compensationLabel || "未获取"}`;
    reasons.textContent = item.reasons?.length ? `推荐依据：${item.reasons.join(" · ")}` : "推荐依据不足，请人工核验";
    card.append(titleRow, description, pay, reasons, meta);
    if (item.warnings?.length) {
      const warning = document.createElement("div");
      warning.className = "result-warning";
      warning.textContent = `需核验：${item.warnings.join(" · ")}`;
      card.append(warning);
    }
    if (item.evidence?.length) {
      const evidence = document.createElement("div");
      evidence.className = "result-evidence";
      evidence.append("企业证据：");
      for (const source of item.evidence) {
        const sourceLink = document.createElement("a");
        sourceLink.href = source.url;
        sourceLink.target = "_blank";
        sourceLink.rel = "noreferrer";
        sourceLink.textContent = source.label;
        evidence.append(sourceLink);
      }
      card.append(evidence);
    }
    container.append(card);
  }
}

async function openDynamicJob(item) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.runtime.sendMessage({ type: "OPEN_MANUAL_JOB", tabId: tab?.id, item });
  if (!response?.ok) {
    const status = document.getElementById("searchStatus");
    status.className = "status error";
    status.textContent = response?.error || "无法打开这个动态岗位";
    return;
  }
  window.close();
}

function makeBadge(text, extraClass = "") {
  const badge = document.createElement("span");
  badge.className = `result-badge ${extraClass}`.trim();
  badge.textContent = text;
  return badge;
}

function filterResults(items, profile) {
  const minimum = Number(profile.minJobFit || 0);
  return items.filter((item) => ["招聘入口", "岗位列表"].includes(item.resultType) || (!item.hardBlocked && (item.skillEligible || (item.jobScore ?? item.score ?? 0) >= minimum)));
}

function displayScannedResults(items, profile) {
  const matched = filterResults(items, profile);
  if (matched.length || !items.length) return { items: matched, usedFallback: false };
  return { items: [...items].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 12), usedFallback: true };
}

async function scanCurrentJobs() {
  await saveProfile();
  const status = document.getElementById("searchStatus");
  const results = document.getElementById("results");
  status.className = "status";
  status.textContent = "正在分析当前官网页面中的岗位…";
  results.replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("请先打开企业官网的岗位列表页");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_JOB_LIST", profile: collectProfile() });
    if (!response?.ok) throw new Error(response?.error || "岗位分析失败");
    if (!response.results.length && response.recommendedUrl) {
      await chrome.runtime.sendMessage({ type: "NAVIGATE_AND_SCAN", tabId: tab.id, url: response.recommendedUrl, profile: collectProfile() });
      status.className = "status success";
      status.textContent = "当前是招聘介绍页，已自动进入具体岗位列表；加载完成后结果会被保存。";
      return;
    }
    if (!response.results.length && response.entrances?.length) {
      const entrance = response.entrances.find((item) => item.url);
      if (entrance) {
        await chrome.runtime.sendMessage({ type: "NAVIGATE_AND_SCAN", tabId: tab.id, url: entrance.url, profile: collectProfile() });
      } else {
        await chrome.storage.local.set({ pendingManualScan: { tabId: tab.id, profile: collectProfile(), createdAt: Date.now(), depth: 0 } });
        await chrome.tabs.sendMessage(tab.id, { type: "CLICK_JOB_ENTRANCE", index: response.entrances[0].index });
      }
      status.className = "status success";
      status.textContent = "已识别职位入口并自动进入，岗位加载完成后会继续扫描。";
      return;
    }
    const profile = collectProfile();
    const display = displayScannedResults(response.results, profile);
    renderResults(display.items);
    status.className = "status success";
    status.textContent = response.results.length
      ? (display.usedFallback
        ? `官网共找到 ${response.results.length} 个岗位，但没有达到最低匹配分；已显示最接近的 ${display.items.length} 个，不再留空。`
        : `官网筛选并翻页后找到 ${response.results.length} 个候选岗位，已按匹配度排序。`)
      : "当前页面没有识别到岗位链接；可调整官网筛选条件或向下滚动加载更多岗位后再试。";
  } catch (error) {
    status.className = "status error";
    status.textContent = `${error.message}。若页面刚打开，请刷新后再试。`;
  }
}

function safeHost(value) {
  try { return new URL(value).hostname; } catch { return "未知域名"; }
}

async function fillCurrentPage() {
  await saveProfile();
  const status = document.getElementById("fillStatus");
  status.className = "status";
  status.textContent = "正在扫描当前页面…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("请先打开企业招聘申请页面");
    const { resumeFile = null } = await chrome.storage.local.get("resumeFile");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FILL_APPLICATION", profile: collectProfile(), resumeFile });
    if (!response?.ok) throw new Error(response?.error || "页面无法填写");
    if (!response.formPresent) throw new Error(response.login ? "当前是登录页面，请先完成登录" : "当前还不是申请表，请先从具体岗位详情点击申请");
    status.className = "status success";
    status.textContent = `已填写 ${response.filled} 项；发现 ${response.unknown} 个需要确认的必填项。`;
  } catch (error) {
    status.className = "status error";
    status.textContent = `${error.message}。若页面刚打开，请刷新页面后再试。`;
  }
}
