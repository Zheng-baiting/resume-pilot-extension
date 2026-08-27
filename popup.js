const PROFILE_FIELDS = [
  "resumeText", "fullName", "phone", "email", "school", "major", "degree",
  "graduationYear", "currentCity", "skills", "targetRole", "targetCity",
  "targetIndustry", "positionType", "preferredCompanies"
];

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindActions();
  await restoreProfile();
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
  document.getElementById("searchCompanies").addEventListener("click", searchCompanies);
  document.getElementById("scanJobs").addEventListener("click", scanCurrentJobs);
  document.getElementById("fillPage").addEventListener("click", fillCurrentPage);
  document.getElementById("importJson").addEventListener("change", importJson);
}

async function restoreProfile() {
  const { profile = {} } = await chrome.storage.local.get("profile");
  for (const field of PROFILE_FIELDS) {
    if (profile[field] != null) document.getElementById(field).value = profile[field];
  }
}

function collectProfile() {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, document.getElementById(field).value.trim()]));
}

async function saveProfile() {
  await chrome.storage.local.set({ profile: collectProfile() });
  flash("资料已保存在本机");
}

function flash(message) {
  const target = document.getElementById("saveStatus");
  target.textContent = message;
  setTimeout(() => { target.textContent = ""; }, 2200);
}

function parseResumeText() {
  const text = document.getElementById("resumeText").value.trim();
  if (!text) return flash("请先粘贴简历文本");

  const email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i)?.[0];
  const phone = text.match(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/)?.[0]?.replace(/\D/g, "").replace(/^86(?=1)/, "");
  const year = text.match(/(?:毕业(?:时间|年份)?[:：\s]*)?(20[2-4]\d)(?:年)?/)?.[1];
  const degree = ["博士", "硕士", "本科", "大专"].find((item) => text.includes(item));
  const school = text.match(/([\u4e00-\u9fa5·]{2,20}(?:大学|学院))/)?.[1];
  const major = text.match(/(?:专业|主修)[:：\s]*([^\n，,；;]{2,24})/)?.[1]?.trim();
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const fullName = firstLine && /^[\u4e00-\u9fa5·]{2,6}$/.test(firstLine) ? firstLine : "";

  const values = { email, phone, graduationYear: year, degree, school, major, fullName };
  Object.entries(values).forEach(([key, value]) => {
    if (value && !document.getElementById(key).value) document.getElementById(key).value = value;
  });
  flash("已识别可确认的信息，请检查后保存");
}

async function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    for (const field of PROFILE_FIELDS) {
      if (data[field] != null) document.getElementById(field).value = String(data[field]);
    }
    flash("JSON 已导入，请检查后保存");
  } catch {
    flash("JSON 文件格式不正确");
  } finally {
    event.target.value = "";
  }
}

async function searchCompanies() {
  await saveProfile();
  const status = document.getElementById("searchStatus");
  const results = document.getElementById("results");
  const profile = collectProfile();
  status.className = "status";
  status.textContent = "正在搜索并筛选官网招聘入口…";
  results.replaceChildren();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SEARCH_OFFICIAL_CAREERS",
      criteria: {
        role: profile.targetRole,
        city: profile.targetCity,
        industry: profile.targetIndustry,
        positionType: profile.positionType,
        skills: profile.skills,
        preferredCompanies: profile.preferredCompanies
      }
    });
    if (!response?.ok) throw new Error(response?.error || "搜索失败");
    renderResults(response.results);
    status.className = "status success";
    status.textContent = response.results.length
      ? `找到 ${response.results.length} 个候选入口，请核对域名后打开。`
      : "没有找到合适结果，请换一组条件。";
  } catch (error) {
    status.className = "status error";
    status.textContent = `${error.message}。可以稍后重试或填写优先企业名称。`;
  }
}

function renderResults(items) {
  const container = document.getElementById("results");
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "result-card";
    const titleRow = document.createElement("div");
    titleRow.className = "result-title-row";
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title || item.url;
    const badge = document.createElement("span");
    badge.className = "result-badge";
    badge.textContent = `${item.resultType || "候选"} · ${item.score}%`;
    titleRow.append(link, badge);
    const description = document.createElement("p");
    description.textContent = item.description;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `${item.company || "待核验企业"} · ${safeHost(item.url)}`;
    const reasons = document.createElement("div");
    reasons.className = "result-reasons";
    reasons.textContent = item.reasons?.length ? `推荐依据：${item.reasons.join(" · ")}` : "推荐依据不足，请人工核验";
    card.append(titleRow, description, reasons, meta);
    container.append(card);
  }
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
    renderResults(response.results);
    status.className = "status success";
    status.textContent = response.results.length
      ? `在当前页面找到 ${response.results.length} 个候选岗位，已按匹配度排序。`
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
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FILL_APPLICATION", profile: collectProfile() });
    if (!response?.ok) throw new Error(response?.error || "页面无法填写");
    status.className = "status success";
    status.textContent = `已填写 ${response.filled} 项；发现 ${response.unknown} 个需要确认的必填项。`;
  } catch (error) {
    status.className = "status error";
    status.textContent = `${error.message}。若页面刚打开，请刷新页面后再试。`;
  }
}
