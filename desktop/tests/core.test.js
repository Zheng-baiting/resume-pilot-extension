const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Bridge = require("../../shared/bridge-protocol.js");
const { ResumePilotService } = require("../src/core/service.js");
const { DomainRateLimiter } = require("../src/core/rate-limiter.js");

function testDataDir(name) {
  return path.join(__dirname, "../../tmp", `desktop-test-${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("desktop service ranks, deduplicates and queues only eligible jobs", async () => {
  const service = new ResumePilotService(testDataDir("queue"), { rateLimiter: { minimumIntervalMs: 1000 } });
  await service.init();
  await service.saveProfile({
    targetRole: "软件开发实习生",
    targetCity: "上海",
    targetIndustry: "互联网",
    positionType: "实习",
    skills: "JavaScript React",
    minJobFit: "35"
  });
  await service.importJobs([
    { company: "示例科技", title: "软件开发实习生", url: "https://careers.example.com/jobs/1", location: "上海", description: "JavaScript React 实习" },
    { company: "示例科技", title: "软件开发实习生", url: "https://careers.example.com/jobs/1", location: "上海", description: "JavaScript React 实习" },
    { company: "示例科技", title: "高级研发经理", url: "https://careers.example.com/jobs/2", location: "北京", description: "全职 Senior 8年经验" },
    { company: "过期公司", title: "前端实习生", url: "https://old.example.com/jobs/3", location: "上海", description: "JavaScript 实习", expiresAt: "2020-01-01" }
  ]);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.stats.jobs, 3);
  assert.equal(snapshot.jobs[0].title, "软件开发实习生");
  const queue = await service.rebuildQueue({ minimumScore: 35, queueLimit: 10, perCompany: 3 });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].title, "软件开发实习生");
});

test("429 result pauses the affected domain instead of rapid retry", async () => {
  const service = new ResumePilotService(testDataDir("rate-limit"), { rateLimiter: { minimumIntervalMs: 1000, maximumBackoffMs: 60000 } });
  await service.init();
  await service.saveProfile({ targetRole: "前端", targetCity: "不限", positionType: "实习", skills: "JavaScript" });
  await service.importJobs([{ company: "示例公司", title: "前端实习生", url: "https://careers.example.com/jobs/1", description: "JavaScript 实习" }]);
  await service.rebuildQueue({ minimumScore: 20, queueLimit: 1, perCompany: 1 });
  const claimed = await service.claimNextJob();
  assert.ok(claimed.job);
  const result = await service.reportResult({ queueId: claimed.job.id, status: "rate_limited", httpStatus: 429, retryAfterMs: 5000 });
  assert.equal(result.item.status, "retry");
  assert.ok(result.item.retryAt > Date.now());
  const immediate = await service.claimNextJob();
  assert.equal(immediate.job, null);
  assert.ok(immediate.waitMs > 0);
});

test("native bridge validates protocol and returns a local snapshot", async () => {
  const service = new ResumePilotService(testDataDir("bridge"));
  await service.init();
  const request = Bridge.makeRequest(Bridge.TYPES.HELLO, { client: "test" });
  const response = await service.handleBridgeMessage(request);
  assert.equal(response.ok, true);
  assert.equal(response.protocolVersion, Bridge.VERSION);
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.payload.stats.jobs, 0);
});

test("domain limiter allows only one active task per recruitment host", () => {
  const limiter = new DomainRateLimiter({ minimumIntervalMs: 1000 });
  assert.equal(limiter.claim("https://jobs.example.com/1", 1000).allowed, true);
  assert.equal(limiter.claim("https://jobs.example.com/2", 1000).allowed, false);
  limiter.complete("https://jobs.example.com/1", { status: "submitted" }, 1000);
  assert.equal(limiter.availability("https://jobs.example.com/2", 1500).allowed, false);
  assert.equal(limiter.availability("https://jobs.example.com/2", 2000).allowed, true);
});
