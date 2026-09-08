const fields = ["targetRole", "targetCity", "targetIndustry", "positionType", "skills"];
let snapshot = null;

function byId(id) { return document.getElementById(id); }
function notice(text, error = false) { byId("notice").textContent = text; byId("notice").className = `notice${error ? " error" : ""}`; }

async function refresh() {
  snapshot = await window.resumePilot.snapshot();
  byId("statJobs").textContent = snapshot.stats.jobs;
  byId("statActive").textContent = snapshot.stats.activeJobs;
  byId("statQueued").textContent = snapshot.stats.queued;
  byId("statCompleted").textContent = snapshot.stats.completed;
  for (const field of fields) if (document.activeElement !== byId(field)) byId(field).value = snapshot.profile[field] || (field === "positionType" ? "实习" : "");
  byId("minimumScore").value = snapshot.settings.minimumScore ?? 40;
  byId("queueLimit").value = snapshot.settings.queueLimit ?? 20;
  byId("perCompany").value = snapshot.settings.perCompany ?? 3;
  renderRows(snapshot.jobs, snapshot.queue);
}

function renderRows(jobs, queue) {
  const queueByJob = new Map(queue.map((item) => [item.jobId, item]));
  byId("queueRows").replaceChildren(...jobs.slice(0, 100).map((job) => {
    const row = document.createElement("tr");
    const queueItem = queueByJob.get(job.id);
    const status = job.hardBlocked ? "不符合硬条件" : (job.verificationStatus || "待官网核验");
    const cells = [
      `<strong>${escapeHtml(job.company)}</strong><small>${escapeHtml(job.title)}</small>`,
      escapeHtml(job.location || "待核验"),
      `<span class="score">${Number(job.score || 0)}分</span>`,
      `<span class="status${job.hardBlocked ? " blocked" : ""}">${escapeHtml(status)}</span>`,
      `<span class="status">${escapeHtml(queueItem?.status || "未入队")}</span>`
    ];
    for (const html of cells) { const cell = document.createElement("td"); cell.innerHTML = html; row.append(cell); }
    return row;
  }));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

byId("saveProfile").addEventListener("click", async () => {
  try {
    await window.resumePilot.saveProfile(Object.fromEntries(fields.map((field) => [field, byId(field).value])));
    notice("条件已保存在桌面端。官网投递使用扩展中的资料，请保持两端条件一致；扩展同步会覆盖同名桌面条件。");
    await refresh();
  } catch (error) { notice(error.message, true); }
});

byId("loadSample").addEventListener("click", () => {
  byId("jobJson").value = JSON.stringify([
    { company: "示例科技", title: "软件开发实习生", url: "https://careers.example.com/jobs/123", location: "上海", description: "使用 JavaScript 和 React 开发产品，面向在校生实习" },
    { company: "示例科技", title: "高级开发经理", url: "https://careers.example.com/jobs/456", location: "北京", description: "要求 8 年经验，负责研发团队管理", positionType: "社会招聘" }
  ], null, 2);
});

byId("importJobs").addEventListener("click", async () => {
  try {
    const result = await window.resumePilot.importJobs(JSON.parse(byId("jobJson").value || "[]"));
    notice(`已接收 ${result.received} 条岗位线索，本地岗位库现有 ${result.stored} 条。`);
    await refresh();
  } catch (error) { notice(`导入失败：${error.message}`, true); }
});

byId("buildQueue").addEventListener("click", async () => {
  try {
    const queue = await window.resumePilot.buildQueue({
      minimumScore: Number(byId("minimumScore").value),
      limit: Number(byId("queueLimit").value),
      queueLimit: Number(byId("queueLimit").value),
      perCompany: Number(byId("perCompany").value)
    });
    notice(`队列中有 ${queue.filter((item) => item.status === "queued").length} 个待核验岗位；已处理记录、处理中任务和限流等待均已保留。`);
    await refresh();
  } catch (error) { notice(error.message, true); }
});

byId("claimNext").addEventListener("click", async () => {
  try {
    await refresh();
    const job = snapshot.queue.find((item) => ["queued", "retry"].includes(item.status));
    notice(job ? `待核验：${job.company} · ${job.title}。这是队列预览，不会启动投递；请在扩展中选择官网并试运行。` : "当前没有待核验的岗位。");
  } catch (error) { notice(error.message, true); }
});

byId("refresh").addEventListener("click", () => refresh().catch((error) => notice(error.message, true)));
byId("openExtensionFolder").addEventListener("click", async () => {
  const error = await window.resumePilot.openExtensionFolder();
  if (error) notice(`无法打开扩展目录：${error}`, true);
});

Promise.all([refresh(), window.resumePilot.installInfo()]).then(([, info]) => {
  byId("desktopVersion").textContent = `RESUME PILOT ${info.version}`;
  byId("extensionDirectory").textContent = info.extensionDirectory;
  byId("extensionId").textContent = info.extensionId;
}).catch((error) => notice(error.message, true));
