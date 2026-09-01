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
    notice("求职条件已保存在本机。浏览器插件接通后会同步使用这些条件。");
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
    notice(`已按城市、技能、求职类型和每家上限生成 ${queue.length} 个待核验岗位。`);
    await refresh();
  } catch (error) { notice(error.message, true); }
});

byId("claimNext").addEventListener("click", async () => {
  try {
    const result = await window.resumePilot.nextJob();
    notice(result.job ? `下一岗位：${result.job.company} · ${result.job.title}。等待浏览器执行器接管。` : (result.waitMs ? `官网正在限速退避，约 ${Math.ceil(result.waitMs / 1000)} 秒后再试。` : "当前没有可领取的岗位。"));
    await refresh();
  } catch (error) { notice(error.message, true); }
});

byId("refresh").addEventListener("click", refresh);
refresh().catch((error) => notice(error.message, true));
