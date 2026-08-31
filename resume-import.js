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

  function inferTargetRole(text) {
    const explicit = text.match(/(?:意向岗位|求职意向|目标岗位|期望职位)\s*[:：]\s*([\s\S]{2,140}?)(?=(?:[，,。；;]\s*)?(?:期望|希望|教育背景|项目经历|联系方式|联系我|优势特长)|$)/)?.[1];
    if (explicit) {
      const roles = cleanInline(explicit).split(/[、,，;；/]/).map(cleanInline).filter(Boolean);
      return [...new Set(roles)].join("、");
    }
    const roles = [];
    if (/H3C|路由交换|OSPF|VLAN|网络排错|组网/i.test(text)) roles.push("网络工程师", "数通工程师", "网络运维工程师");
    if (/通信工程|通信网络|通信信号/i.test(text)) roles.push("通信工程师");
    if (/RAG|LangChain|大模型|人工智能/i.test(text)) roles.push("AI应用工程师");
    if (/CNN|ResNet|深度学习|机器学习/i.test(text)) roles.push("通信算法工程师", "机器学习实习生");
    return [...new Set(roles)].slice(0, 6).join("、");
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

  global.ResumePilotImport = { MAX_FILE_SIZE, getExtension, validateFile, parseResumeProfile, read };
})(globalThis);
