const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ResumePilotService, publicProfile } = require("../src/core/service.js");
const { JsonStore } = require("../src/core/store.js");
const { canonicalUrl, fingerprintJob, normalizeQueueOptions, buildQueue } = require("../src/core/job-engine.js");
const Bridge = require("../../shared/bridge-protocol.js");

async function directory() {
  const root = path.resolve(__dirname, "../../tmp");
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, "reliability-"));
}

const job = (id, company = "示例科技") => ({ company, title: "前端实习生", url: `https://careers.example.com/#/details?id=${id}`, location: "上海", description: "JavaScript React 实习" });

test("job URLs retain hash routes and reject executable/credential URLs", () => {
  assert.equal(canonicalUrl("https://careers.example.com/?utm_source=test#/details?id=1"), job(1).url);
  assert.notEqual(fingerprintJob(job(1)), fingerprintJob(job(2)));
  for (const url of ["javascript:alert(1)", "file:///resume.pdf", "https://user:secret@example.com/job", "invalid"]) assert.equal(canonicalUrl(url), "");
});

test("zero values and bounded numeric options are respected", () => {
  assert.equal(publicProfile({ minMonthlySalary: 0 }).minMonthlySalary, "0");
  assert.deepEqual(normalizeQueueOptions({ limit: NaN, perCompany: Infinity, minimumScore: "bad" }), { limit: 20, queueLimit: 20, perCompany: 3, minimumScore: 40 });
  assert.equal(buildQueue([{ ...job(1), score: 0, skillEligible: false }], { minimumScore: 0 }).length, 1);
  assert.equal(normalizeQueueOptions({ limit: 2.8, perCompany: -10 }).limit, 2);
});

test("rebuilding keeps submission history, company caps and the updated queue limit", async () => {
  const service = new ResumePilotService(await directory());
  await service.init();
  await service.saveProfile({ targetRole: "前端", targetCity: "上海", positionType: "实习", skills: "JavaScript", minMonthlySalary: 5000 });
  await service.saveProfile({ targetCity: "不限" });
  assert.equal((await service.snapshot()).profile.minMonthlySalary, "5000");
  await service.saveProfile({ minMonthlySalary: "" });
  assert.equal((await service.snapshot()).profile.minMonthlySalary, undefined);
  await service.importJobs([job(1), job(2), job(3, "另一公司")]);
  await service.rebuildQueue({ queueLimit: 20, perCompany: 1, minimumScore: 0 });
  const first = (await service.claimNextJob()).job;
  await service.reportResult({ queueId: first.id, status: "submitted" });
  const queue = await service.rebuildQueue({ queueLimit: 1 });
  assert.equal((await service.snapshot()).settings.queueLimit, 1);
  assert.equal(queue.find((item) => item.id === first.id).status, "submitted");
  assert.equal(queue.filter((item) => item.company === first.company).length, 1);
  await assert.rejects(service.reportResult({ queueId: first.id, status: "failed" }), /不在处理中/);
});

test("a new host respects persistent domain cooldown and active claims", async () => {
  const dir = await directory();
  const service = new ResumePilotService(dir);
  await service.init();
  await service.importJobs([job(1), job(2)]);
  await service.rebuildQueue({ minimumScore: 0 });
  const first = (await service.claimNextJob()).job;
  const reconnected = new ResumePilotService(dir);
  await reconnected.init();
  assert.equal((await reconnected.claimNextJob()).job, null);
  await service.reportResult({ queueId: first.id, httpStatus: 429, retryAfterMs: 60000 });
  await reconnected.rebuildQueue({ minimumScore: 0 });
  const next = await reconnected.claimNextJob();
  assert.equal(next.job, null);
  assert.ok(next.waitMs > 0);
});

test("queued jobs are checked against changed city conditions before claiming", async () => {
  const service = new ResumePilotService(await directory());
  await service.init();
  await service.saveProfile({ targetCity: "上海", skills: "JavaScript", positionType: "实习" });
  await service.importJobs([job(1)]);
  await service.rebuildQueue({ minimumScore: 0 });
  await service.saveProfile({ targetCity: "北京" });
  assert.equal((await service.claimNextJob()).job, null);
});

test("failed replacement preserves existing JSON and later writes recover", async (t) => {
  const store = new JsonStore(await directory());
  await store.write("profile", { targetCity: "上海" });
  const rename = t.mock.method(fs, "rename", async () => { throw new Error("simulated replacement failure"); });
  await assert.rejects(store.write("profile", { targetCity: "北京" }), /simulated/);
  assert.equal((await store.read("profile", {})).targetCity, "上海");
  rename.mock.restore();
  await store.write("profile", { targetCity: "杭州" });
  assert.equal((await store.read("profile", {})).targetCity, "杭州");
});

test("native host handles fragmented consecutive imports in order", async () => {
  const child = spawn(process.execPath, [path.resolve(__dirname, "../native-host/host.js")], {
    env: { ...process.env, RESUME_PILOT_DATA_DIR: await directory() }, stdio: ["pipe", "pipe", "pipe"]
  });
  const responses = [];
  let buffer = Buffer.alloc(0), errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const length = buffer.readUInt32LE(0);
      responses.push(JSON.parse(buffer.subarray(4, length + 4)));
      buffer = buffer.subarray(length + 4);
    }
  });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`host timed out: ${errors}`)); }, 10000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(errors)); });
  });
  for (let index = 0; index < 12; index++) {
    const body = Buffer.from(JSON.stringify(Bridge.makeRequest("IMPORT_JOBS", { jobs: [job(index)] })));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(header.subarray(0, 2));
    child.stdin.write(Buffer.concat([header.subarray(2), body]));
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  child.stdin.end();
  await done;
  assert.equal(responses.length, 12);
  assert.ok(responses.every((response) => response.ok));
  assert.deepEqual(responses.map((response) => response.payload.stored), Array.from({ length: 12 }, (_, index) => index + 1));
});
