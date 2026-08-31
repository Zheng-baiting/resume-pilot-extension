(function initResumeImport(global) {
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const SUPPORTED_EXTENSIONS = new Set(["json", "pdf", "docx", "txt", "md"]);

  function getExtension(fileName = "") {
    return fileName.toLowerCase().split(".").pop() || "";
  }

  function validateFile(file) {
    const extension = getExtension(file?.name);
    if (!file) throw new Error("请先选择简历文件");
    if (file.size > MAX_FILE_SIZE) throw new Error("简历文件不能超过 5MB");
    if (extension === "doc") throw new Error("旧版 .doc 暂不能直接解析，请用 Word 或 WPS 另存为 .docx 后再导入");
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error("暂支持 JSON、PDF、DOCX、TXT 和 MD 文件");
    }
    return extension;
  }

  const SKILL_RULES = [
    ["Python", /\bPython\b/i],
    ["Java", /\bJava\b(?!Script)/i],
    ["C++", /\bC\+\+/i],
    ["JavaScript", /\bJavaScript\b/i],
    ["TypeScript", /\bTypeScript\b/i],
    ["React", /\bReact(?:\.js)?\b/i],
    ["Vue", /\bVue(?:\.js)?\b/i],
    ["Node.js", /\bNode(?:\.js|JS)?\b/i],
    ["SQL", /\bSQL\b/i],
    ["MySQL", /\bMySQL\b/i],
    ["Redis", /\bRedis\b/i],
    ["Git", /\bGit\b/i],
    ["Docker", /\bDocker\b/i],
    ["Kubernetes", /\bKubernetes\b|\bK8s\b/i],
    ["PyTorch", /\bPyTorch\b/i],
    ["TensorFlow", /\bTensorFlow\b/i],
    ["Pandas", /\bPandas\b/i],
    ["NumPy", /\bNumPy\b/i],
    ["Figma", /\bFigma\b/i],
    ["STM32", /\bSTM32\b/i],
    ["H3C", /\bH3C\b/i],
    ["路由交换", /路由交换|交换机|路由器/i],
    ["OSPF", /\bOSPF\b/i],
    ["VLAN", /\bVLAN\b/i],
    ["STP", /\bSTP\b/i],
    ["ACL", /\bACL\b/i],
    ["NAT", /\bNAT\b/i],
    ["WLAN", /\bWLAN\b/i],
    ["网络排错", /网络排错|故障排查|问题排查/i],
    ["网络拓扑规划", /网络拓扑|拓扑规划|组网/i],
    ["Linux", /\bLinux\b/i],
    ["网络安全", /网络安全|信息安全|防火墙/i],
    ["RAG", /\bRAG\b/i],
    ["LangChain", /\bLangChain\b/i],
    ["LCEL", /\bLCEL\b/i],
    ["Gradio", /\bGradio\b/i],
    ["CNN", /\bCNN\b/i],
    ["ResNet", /\bResNet(?:18)?\b/i],
    ["深度学习", /深度学习/i],
    ["数据预处理", /数据预处理|数据集处理/i],
    ["模型训练", /模型训练|模型调优|超参数/i],
    ["CAD", /\bCAD\b/i]
  ];

  const ROLE_RECOMMENDATION_RULES = [
    { role: "前端开发工程师", major: /计算机|软件|数字媒体/, strong: /前端|frontend/i, signals: [/React/i, /Vue/i, /JavaScript/i, /TypeScript/i, /HTML/i, /CSS/i, /小程序/i] },
    { role: "后端开发工程师", major: /计算机|软件|信息管理/, strong: /后端|服务端|backend/i, signals: [/Spring/i, /Node(?:\.js|JS)?/i, /Django|Flask/i, /MySQL/i, /Redis/i, /Java\b/i, /Golang|\bGo\b/i] },
    { role: "软件开发工程师", major: /计算机|软件|人工智能|信息工程|通信工程|自动化/, strong: /软件开发|开发工程师|程序设计/i, signals: [/Python/i, /Java\b/i, /C\+\+/i, /JavaScript/i, /Git/i, /数据结构|算法设计/i] },
    { role: "AI与算法工程师", major: /人工智能|智能科学|计算机|数据科学|数学/, strong: /人工智能|机器学习|深度学习|大模型|算法/i, signals: [/PyTorch/i, /TensorFlow/i, /CNN/i, /ResNet/i, /RAG/i, /LangChain/i, /模型训练|模型调优/i] },
    { role: "数据分析与数据工程师", major: /数据科学|统计|数学|计算机|信息管理|经济/, strong: /数据分析|数据工程|数据开发|商业分析/i, signals: [/SQL/i, /Pandas/i, /NumPy/i, /Power\s*BI/i, /Tableau/i, /Excel/i, /数据清洗|数据预处理/i] },
    { role: "测试开发工程师", major: /计算机|软件|自动化/, strong: /测试开发|自动化测试|测试工程|QA/i, signals: [/Selenium/i, /Pytest/i, /JUnit/i, /Postman/i, /接口测试|性能测试/i] },
    { role: "网络工程师", major: /网络工程|通信工程|信息工程|计算机/, strong: /网络工程|数通|路由交换|组网/i, signals: [/H3C/i, /OSPF/i, /VLAN/i, /STP/i, /WLAN/i, /网络排错/i] },
    { role: "网络安全工程师", major: /网络安全|信息安全|网络工程|计算机/, strong: /网络安全|信息安全|安全工程|渗透测试/i, signals: [/防火墙/i, /ACL/i, /漏洞/i, /Wireshark/i, /Linux/i] },
    { role: "通信工程师", major: /通信工程|电子信息|信息工程/, strong: /通信网络|通信系统|无线通信|5G|基站/i, signals: [/信号处理/i, /射频/i, /光通信/i, /网络规划/i] },
    { role: "嵌入式开发工程师", major: /电子|自动化|通信|计算机|物联网/, strong: /嵌入式|单片机|驱动开发/i, signals: [/STM32/i, /FreeRTOS/i, /Arduino/i, /C\+\+/i, /PCB/i, /传感器/i] },
    { role: "云计算与运维工程师", major: /计算机|软件|网络|云计算/, strong: /云计算|运维|SRE|DevOps/i, signals: [/Docker/i, /Kubernetes|K8s/i, /Linux/i, /CI\/CD/i, /Shell/i, /云平台/i] },
    { role: "产品经理", major: /信息管理|工业设计|计算机|工商管理/, strong: /产品经理|产品设计|产品策划/i, signals: [/需求分析/i, /用户研究/i, /Axure/i, /原型设计/i, /竞品分析/i] },
    { role: "UI与用户体验设计师", major: /设计|数字媒体|艺术/, strong: /UI|UX|交互设计|用户体验|视觉设计/i, signals: [/Figma/i, /Photoshop/i, /Illustrator/i, /原型设计/i] }
  ];

  function cleanInline(value = "") {
    return String(value)
      .replace(/[\u00a0\t]+/g, " ")
      .replace(/\s*\n\s*/g, " ")
      .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^[|｜,，、;；:\s]+|[|｜,，、;；:\s]+$/g, "");
  }

  function inferName(text, fileName = "") {
    const baseName = String(fileName).replace(/\.[^.]+$/, "").trim();
    const fromFile = baseName.match(/^([\u4e00-\u9fa5·]{2,6})(?=(?:--?|[_—–\s]|\d))/)?.[1];
    if (fromFile) return fromFile;
    const ignored = /^(?:简历|个人简历|求职简历|关于我|联系方式|教育背景|项目经历|优势特长)$/;
    return text.split(/\r?\n/).map((line) => line.trim())
      .find((line) => /^[\u4e00-\u9fa5·]{2,6}$/.test(line) && !ignored.test(line)) || "";
  }

  function inferGraduationYear(text) {
    const explicit = text.match(/(?:毕业(?:时间|年份)?|预计毕业)\s*[:：]?\s*(20[2-4]\d)/)?.[1];
    if (explicit) return explicit;
    const rangeEnds = [...text.matchAll(/20[0-4]\d(?:[.\/-]\d{1,2})?\s*(?:-|–|—|~|～|至)\s*(20[2-4]\d)(?:[.\/-]\d{1,2})?/g)]
      .map((match) => Number(match[1]));
    return rangeEnds.length ? String(Math.max(...rangeEnds)) : "";
  }

  function inferMajor(text) {
    const educationRow = text.match(/20[0-4]\d(?:[.\/-]\d{1,2})?\s*(?:-|–|—|~|～|至)\s*20[2-4]\d(?:[.\/-]\d{1,2})?\s*[|｜]\s*[^|｜\n]{2,30}(?:大学|学院)\s*[|｜]\s*([^|｜\n]{2,24})\s*[|｜]\s*(?:本科|硕士|博士|大专)/)?.[1];
    if (educationRow) return cleanInline(educationRow);
    const explicit = text.match(/(?:所学专业|主修专业|专业方向|专业)\s*[:：]\s*([^\n，,；;|｜]{2,24})/)?.[1];
    if (explicit) return cleanInline(explicit);
    const inSchool = text.match(/([\u4e00-\u9fa5]{2,20})专业(?:在读|学生|本科|硕士|毕业)/)?.[1];
    return cleanInline(inSchool || "");
  }

  function recommendTargetRoles(text) {
    const normalized = String(text || "");
    const candidates = ROLE_RECOMMENDATION_RULES.map((rule) => {
      let score = 0;
      const reasons = [];
      const majorMatched = rule.major.test(normalized);
      const strongMatched = rule.strong.test(normalized);
      if (majorMatched) {
        score += 18;
        reasons.push("专业相关");
      }
      if (strongMatched) {
        score += 32;
        reasons.push("经历中有明确岗位线索");
      }
      const matchedSignals = rule.signals.filter((pattern) => pattern.test(normalized));
      if (matchedSignals.length) {
        score += Math.min(42, matchedSignals.length * 8);
        reasons.push(`命中 ${matchedSignals.length} 项技能/项目线索`);
      }
      return { role: rule.role, score: Math.min(100, score), reasons, majorMatched, evidenceMatched: strongMatched || matchedSignals.length > 0 };
    });
    const evidenceBased = candidates.filter((item) => item.evidenceMatched);
    const selected = evidenceBased.length ? evidenceBased : candidates.filter((item) => item.majorMatched).slice(0, 3);
    return selected.sort((a, b) => b.score - a.score || a.role.localeCompare(b.role, "zh-CN"))
      .slice(0, 6)
      .map(({ role, score, reasons }) => ({ role, score, reasons }));
  }

  function inferTargetRole(text) {
    const explicit = text.match(/(?:意向岗位|求职意向|目标岗位|期望职位)\s*[:：]\s*([\s\S]{2,140}?)(?=(?:[，,。；;]\s*)?(?:期望|希望|教育背景|项目经历|联系方式|联系我|优势特长)|$)/)?.[1];
    if (explicit) {
      const roles = cleanInline(explicit).split(/[、,，;；/]/).map(cleanInline).filter(Boolean);
      return [...new Set(roles)].join("、");
    }
    return recommendTargetRoles(text).map((item) => item.role).join("、");
  }

  function inferTargetIndustry(text, targetRole = "") {
    const haystack = `${text} ${targetRole}`;
    const industries = [];
    if (/通信|数通|5G|基站/i.test(haystack)) industries.push("通信");
    if (/计算机网络|路由|交换|H3C|OSPF|VLAN|网络运维/i.test(haystack)) industries.push("计算机网络");
    if (/网络安全|信息安全|防火墙|WLAN|ACL/i.test(haystack)) industries.push("信息安全");
    if (/人工智能|\bAI\b|RAG|大模型|CNN|ResNet|深度学习|机器学习/i.test(haystack)) industries.push("人工智能");
    if (/前端|后端|软件开发|JavaScript|Java|Python/i.test(haystack)) industries.push("互联网软件");
    return [...new Set(industries)].join("、");
  }

  function inferLocation(text, type) {
    const patterns = type === "target"
      ? [/(?:目标|期望|意向)(?:工作)?(?:城市|地点)\s*[:：]\s*([^\n，,；;]{2,16})/]
      : [/(?:现居|所在|当前)(?:城市|地点)?\s*[:：]\s*([^\n，,；;]{2,16})/];
    return cleanInline(patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean) || "");
  }

  function parseResumeProfile(text, fileName = "") {
    const normalized = String(text || "").replace(/\r/g, "").trim();
    if (!normalized) return {};
    const email = normalized.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i)?.[0] || "";
    const phone = normalized.match(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/)?.[0]?.replace(/\D/g, "").replace(/^86(?=1)/, "") || "";
    const school = normalized.match(/([\u4e00-\u9fa5·]{2,30}(?:大学|学院))/)?.[1] || "";
    const degree = ["博士", "硕士", "本科", "大专"].find((item) => normalized.includes(item)) || "";
    const targetRole = inferTargetRole(normalized);
    return {
      fullName: inferName(normalized, fileName),
      phone,
      email,
      school: cleanInline(school),
      major: inferMajor(normalized),
      degree,
      graduationYear: inferGraduationYear(normalized),
      currentCity: inferLocation(normalized, "current"),
      skills: SKILL_RULES.filter(([, pattern]) => pattern.test(normalized)).map(([skill]) => skill).join(", "),
      targetRole,
      targetCity: inferLocation(normalized, "target"),
      targetIndustry: inferTargetIndustry(normalized, targetRole),
      positionType: /实习|intern/i.test(normalized) ? "实习" : ""
    };
  }

  async function extractPdfText(file) {
    const pdfjs = await import(chrome.runtime.getURL("vendor/pdf.min.mjs"));
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await loadingTask.promise;
    const pages = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        let line = "";
        const lines = [];
        for (const item of content.items) {
          if (typeof item.str !== "string") continue;
          line += `${line && !/^\s/.test(item.str) ? " " : ""}${item.str}`;
          if (item.hasEOL) {
            if (line.trim()) lines.push(line.trim());
            line = "";
          }
        }
        if (line.trim()) lines.push(line.trim());
        pages.push(lines.join("\n"));
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
    const text = pages.filter(Boolean).join("\n\n").trim();
    if (!text) {
      throw new Error("没有从 PDF 读到文字；它可能是扫描件，请先用 OCR 转成可搜索 PDF 或 DOCX");
    }
    return text;
  }

  async function extractDocxText(file) {
    if (!global.mammoth?.extractRawText) throw new Error("DOCX 解析组件没有加载，请重新打开扩展后再试");
    const result = await global.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = String(result.value || "").trim();
    if (!text) throw new Error("没有从 DOCX 读到文字，请确认文档内含可复制的正文");
    return text;
  }

  async function read(file) {
    const extension = validateFile(file);
    if (extension === "json") return { kind: "profile", data: JSON.parse(await file.text()), extension };
    if (extension === "pdf") return { kind: "resume", text: await extractPdfText(file), extension, saveAsAttachment: true };
    if (extension === "docx") return { kind: "resume", text: await extractDocxText(file), extension, saveAsAttachment: true };
    const text = (await file.text()).trim();
    if (!text) throw new Error("文件中没有可识别的文字");
    return { kind: "resume", text, extension, saveAsAttachment: false };
  }

  global.ResumePilotImport = { MAX_FILE_SIZE, getExtension, validateFile, parseResumeProfile, recommendTargetRoles, read };
})(globalThis);
