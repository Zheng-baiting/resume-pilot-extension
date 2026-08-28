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

  global.ResumePilotImport = { MAX_FILE_SIZE, getExtension, validateFile, read };
})(globalThis);
