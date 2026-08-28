const FIELD_RULES = [
  { key: "fullName", patterns: [/姓名|名字|name/i] },
  { key: "phone", patterns: [/手机|电话|联系.*方式|mobile|phone|tel/i] },
  { key: "email", patterns: [/邮箱|电子邮件|e-?mail/i] },
  { key: "school", patterns: [/学校|院校|毕业.*学校|university|college|school/i] },
  { key: "major", patterns: [/专业|主修|major/i] },
  { key: "degree", patterns: [/学历|学位|degree|education level/i] },
  { key: "graduationYear", patterns: [/毕业.*年|graduation.*year|graduate.*year/i] },
  { key: "currentCity", patterns: [/当前.*城市|所在.*城市|现居|location|current city/i] },
  { key: "skills", patterns: [/技能|技术栈|专长|skills?/i] }
];

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
  if (message?.type === "OPEN_SCANNED_JOB") return openScannedJob(message.clickToken || "");
  if (message?.type === "CLICK_JOB_ENTRANCE") return clickJobEntrance(message.index || 0);
  if (message?.type === "OPEN_APPLICATION") return openApplication();
  if (message?.type === "SUBMIT_APPLICATION") return submitApplication();
  if (message?.type === "DETECT_APPLICATION_SUCCESS") return detectApplicationSuccess();
  if (message?.type === "SHOW_AUTOMATION_NOTICE") {
    showAutomationNotice(message.notice || {});
    return {};
  }
  throw new Error("不支持的页面操作");
}

async function deepScanJobList(profile) {
  const collected = new Map();
  let unchangedRounds = 0;
  let lastHeight = 0;

  for (let round = 0; round < 6; round += 1) {
    for (const item of scanJobList(profile)) collected.set(item.url, item);
    const height = document.documentElement.scrollHeight;
    if (height === lastHeight) unchangedRounds += 1;
    else unchangedRounds = 0;
    lastHeight = height;
    if (collected.size >= 60 || unchangedRounds >= 2) break;
    window.scrollTo({ top: Math.min(height, window.scrollY + Math.max(window.innerHeight * 0.85, 650)), behavior: "instant" });
    await wait(650);
  }

  return {
    results: [...collected.values()].sort((a, b) => b.score - a.score).slice(0, 60),
    entrances: discoverJobEntrances(),
    recommendedUrl: getRecommendedJobListUrl(profile)
  };
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

function openApplication() {
  const login = detectLoginRequired();
  const captcha = detectCaptcha();
  if (login || captcha) return { clicked: false, login, captcha };
  const candidates = [...document.querySelectorAll("a[href], button, [role='button'], input[type='button']")]
    .filter(isVisible)
    .filter((node) => /(立即投递|申请职位|投递简历|投递该职位|开始申请|apply now|apply for|apply this job)/i.test(node.innerText || node.value || node.getAttribute("aria-label") || ""));
  const target = candidates[0];
  if (!target) return { clicked: false, login: false, captcha: false };
  target.click();
  return { clicked: true, login: false, captcha: false };
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
  return Boolean(password && /(登录|注册|验证码登录|sign in|log in)/i.test(text));
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
    if (text.length < 4 || text.length > 1000 || !looksLikeJob(text, url, roleTerms, positionType)) continue;

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
    const signature = normalizeClickSignature(title);
    if (!signature || text.length < 4 || text.length > 1000 || !looksLikeJob(text, location.href, roleTerms, positionType)) continue;
    if (candidates.some((item) => normalizeClickSignature(item.title) === signature)) continue;

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
      description: text.slice(0, 260),
      company: companyEval.company || company,
      resultType: "点击式岗位",
      score,
      companyScore: companyEval.companyScore,
      jobScore: jobEval.jobScore,
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
    ".job-item", ".position-item", ".job-card", ".position-card",
    "[class*='job-list'] > li", "[class*='position-list'] > li",
    "[data-job-id]", "[data-position-id]", "[data-jobid]", "[data-positionid]"
  ];
  const cards = [...document.querySelectorAll(selectors.join(","))]
    .filter(isVisible)
    .filter((card) => !card.querySelector("a[href*='job' i], a[href*='position' i], a[href*='career' i]"));
  return [...new Set(cards)].filter((card) => !cards.some((other) => other !== card && card.contains(other)));
}

function extractCardJobTitle(card, fallback) {
  const heading = card.querySelector(".job-name, .position-name, [class*='job-name'], [class*='position-name'], h1, h2, h3, h4, [class*='title']")?.innerText;
  return String(heading || fallback).replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeClickSignature(value) {
  return String(value || "").toLowerCase().replace(/[\s|｜·—_\-（）()【】\[\]，,。.:：;/\\]/g, "").slice(0, 80);
}

async function openScannedJob(clickToken) {
  const cards = findClickableJobCards();
  const target = cards.find((card) => normalizeClickSignature(extractCardJobTitle(card, card.innerText || "")) === clickToken);
  if (!target) throw new Error("岗位列表已变化，请重新扫描");
  const beforeUrl = location.href;
  target.scrollIntoView({ block: "center", behavior: "instant" });
  // 常见站点把事件绑定在岗位名称容器或整张卡片上；避开“收藏/分享”。
  const clickTarget = target.querySelector(".job-name-box, .position-name-box, [class*='job-title'], [class*='position-title']") || target;
  clickTarget.click();
  await wait(250);
  return { clicked: true, beforeUrl, currentUrl: location.href };
}

function looksLikeJob(text, url, roleTerms, positionType) {
  const haystack = `${text} ${url}`;
  const jobSignal = /(职位|岗位|招聘|实习|校招|应届|工程师|开发|产品|运营|设计|算法|测试|job|position|career|intern|engineer|developer)/i.test(haystack);
  const roleSignal = roleTerms.some((term) => haystack.toLowerCase().includes(term.toLowerCase()));
  const typeSignal = positionType && positionType !== "不限" && haystack.toLowerCase().includes(positionType.toLowerCase());
  return jobSignal && (roleSignal || typeSignal || /(position|job\/|jobdetail|职位详情)/i.test(url));
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

function fillApplication(profile, knownAnswers = {}, resumeFile = null) {
  document.getElementById("resume-pilot-assistant")?.remove();
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
    } else if (field.required || field.getAttribute("aria-required") === "true") {
      field.classList.add("resume-pilot-unknown");
      unknown.push({ field, label, key: answerKey, kind: "text" });
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
    login: detectLoginRequired()
  };
}

function getCandidateFields() {
  return [...document.querySelectorAll("input, textarea, select")].filter((field) => {
    if (field.disabled || field.readOnly || !isVisible(field)) return false;
    const type = (field.type || "").toLowerCase();
    return !["hidden", "submit", "button", "reset", "file", "image", "password", "checkbox", "radio"].includes(type);
  });
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
    if (!isVisible(field) || field.files?.length) continue;
    const label = humanLabel(field, describeField(field)) || "上传简历附件";
    if (!resumeFile?.base64) {
      if (field.required || field.getAttribute("aria-required") === "true") {
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
        if (input.value.trim() && setFieldValue(item.field, input.value.trim())) {
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
