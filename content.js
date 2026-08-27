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
  try {
    if (message?.type === "FILL_APPLICATION") {
      const result = fillApplication(message.profile || {});
      sendResponse({ ok: true, ...result });
    } else if (message?.type === "SCAN_JOB_LIST") {
      const results = scanJobList(message.profile || {});
      sendResponse({ ok: true, results });
    } else {
      return;
    }
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
});

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

  return candidates.sort((a, b) => b.score - a.score).slice(0, 30);
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

function fillApplication(profile) {
  document.getElementById("resume-pilot-assistant")?.remove();
  const fields = getCandidateFields();
  const unknown = [];
  let filled = 0;

  for (const field of fields) {
    field.classList.remove("resume-pilot-filled", "resume-pilot-unknown");
    if (!isEmpty(field)) continue;
    const descriptor = describeField(field);
    const rule = FIELD_RULES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(descriptor)));
    const value = rule ? profile[rule.key] : "";

    if (value && setFieldValue(field, value)) {
      field.classList.add("resume-pilot-filled");
      filled += 1;
    } else if (field.required || field.getAttribute("aria-required") === "true") {
      field.classList.add("resume-pilot-unknown");
      unknown.push({ field, label: humanLabel(field, descriptor) });
    }
  }

  showAssistant({ filled, unknown });
  return { filled, unknown: unknown.length };
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

function showAssistant({ filled, unknown }) {
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
  summary.textContent = `已填写 ${filled} 项，${unknown.length ? `还有 ${unknown.length} 个必填项需要你确认。` : "没有发现未知必填项。"}`;
  body.append(summary);

  for (const [index, item] of unknown.entries()) {
    const wrapper = document.createElement("div");
    wrapper.className = "rp-item";
    const label = document.createElement("label");
    label.htmlFor = `rp-answer-${index}`;
    label.textContent = item.label;
    const input = document.createElement("input");
    input.id = `rp-answer-${index}`;
    input.placeholder = "请填写后应用到原表单";
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
  apply.addEventListener("click", () => {
    if (unknown.length) {
      panel.querySelectorAll("input[data-index]").forEach((input) => {
        const item = unknown[Number(input.dataset.index)];
        if (input.value.trim() && setFieldValue(item.field, input.value.trim())) {
          item.field.classList.remove("resume-pilot-unknown");
          item.field.classList.add("resume-pilot-filled");
        }
      });
      summary.textContent = "回答已写入原表单。请逐项检查，确认无误后由你点击最终提交。";
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
  warning.textContent = "请确认企业域名、岗位和所有字段。扩展不会替你绕过验证码，也不会自动点击最终提交。";
  body.append(warning);
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
