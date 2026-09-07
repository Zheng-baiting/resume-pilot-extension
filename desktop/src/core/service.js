const { JsonStore } = require("./store.js");
const { normalizeJob, rankJobs, buildQueue, normalizeQueueOptions, fingerprintJob } = require("./job-engine.js");
const { DomainRateLimiter } = require("./rate-limiter.js");
const Bridge = require("../../../shared/bridge-protocol.js");

function publicProfile(input = {}) {
  const allowed = [
    "targetRole", "targetCity", "targetIndustry", "positionType", "skills",
    "minJobFit", "minDailySalary", "minMonthlySalary", "avoidJobKeywords",
    "avoidCompanyKeywords", "maxExperienceYears", "availableDays", "internshipMonths"
  ];
  return Object.fromEntries(allowed.map((key) => [key, typeof input[key] === "boolean" ? input[key] : String(input[key] ?? "")]).filter(([, value]) => value !== ""));
}

class ResumePilotService {
  constructor(dataDirectory, options = {}) {
    this.store = new JsonStore(dataDirectory);
    this.limiter = new DomainRateLimiter(options.rateLimiter);
  }

  async init() {
    await this.store.init();
    // Missing collections already have read fallbacks. Starting another host
    // must not rewrite a snapshot over changes made by the desktop process.
    return this.snapshot();
  }

  async appendEvent(type, detail = {}) {
    const events = await this.store.read("events", []);
    events.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, detail, time: new Date().toISOString() });
    await this.store.write("events", events.slice(-1000));
  }

  async saveProfile(profile) {
    const sanitized = publicProfile({ ...(await this.store.read("profile", {})), ...profile });
    await this.store.write("profile", sanitized);
    await this.appendEvent("profile_updated", { fields: Object.keys(sanitized) });
    return sanitized;
  }

  async importJobs(items = []) {
    if (!Array.isArray(items)) throw new Error("岗位数据必须是数组");
    const existing = await this.store.read("jobs", []);
    const merged = new Map(existing.map((job) => [job.id, job]));
    for (const raw of items.slice(0, 5000)) {
      const job = normalizeJob(raw);
      if (!job.title || !job.url) continue;
      merged.set(job.id, { ...(merged.get(job.id) || {}), ...job });
    }
    const jobs = [...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, 20000);
    await this.store.write("jobs", jobs);
    await this.appendEvent("jobs_imported", { received: items.length, stored: jobs.length });
    return { received: items.length, stored: jobs.length };
  }

  async rankedJobs() {
    const [jobs, profile] = await Promise.all([this.store.read("jobs", []), this.store.read("profile", {})]);
    return rankJobs(jobs, profile);
  }

  async rebuildQueue(options = {}) {
    const previousSettings = await this.store.read("settings", {});
    const settings = normalizeQueueOptions({ ...previousSettings, ...options, limit: options.limit ?? options.queueLimit ?? previousSettings.queueLimit });
    await this.store.write("settings", settings);
    const previous = await this.store.read("queue", []);
    // Keep submitted, uncertain, active and retry states. Rebuilding is not
    // permission to replay an application or forget a site's cooldown.
    const retained = previous.filter((item) => item.status !== "queued");
    const retainedIds = new Set(retained.map((item) => item.id));
    const queue = [...retained, ...buildQueue((await this.rankedJobs()).filter((job) => !retainedIds.has(fingerprintJob(job))), settings, retained)];
    await this.store.write("queue", queue);
    await this.appendEvent("queue_rebuilt", { queued: queue.length, settings });
    return queue;
  }

  async claimNextJob() {
    const queue = await this.store.read("queue", []);
    const ranked = new Map((await this.rankedJobs()).map((job) => [job.id, job]));
    let shortestWait = Number.POSITIVE_INFINITY;
    for (const item of queue) {
      if (item.status !== "queued" && item.status !== "retry") continue;
      const job = ranked.get(item.jobId);
      if (!job || job.hardBlocked) continue;
      const host = this.limiter.hostFor(item.url);
      const siblings = queue.filter((entry) => this.limiter.hostFor(entry.url) === host);
      if (siblings.some((entry) => entry.status === "processing")) continue;
      const retryAt = Math.max(0, ...siblings.map((entry) => Number(entry.retryAt) || 0));
      if (retryAt > Date.now()) {
        shortestWait = Math.min(shortestWait, retryAt - Date.now());
        continue;
      }
      const availability = this.limiter.claim(item.url);
      if (!availability.allowed) {
        shortestWait = Math.min(shortestWait, availability.waitMs);
        continue;
      }
      item.status = "processing";
      item.attempts = Number(item.attempts || 0) + 1;
      item.updatedAt = Date.now();
      await this.store.write("queue", queue);
      await this.appendEvent("job_claimed", { queueId: item.id, company: item.company, title: item.title, host: availability.host });
      return { job: item, waitMs: 0 };
    }
    return { job: null, waitMs: Number.isFinite(shortestWait) ? shortestWait : 0 };
  }

  async reportResult(result = {}) {
    const queue = await this.store.read("queue", []);
    const item = queue.find((entry) => entry.id === result.queueId);
    if (!item) throw new Error("找不到对应的投递队列项");
    if (item.status !== "processing") throw new Error("岗位不在处理中，请刷新状态后重试");
    const rate = this.limiter.complete(item.url, result);
    item.retryAt = rate.retryAt;
    if (rate.rateLimited) {
      item.status = "retry";
      item.lastError = "HTTP 429：官网限流，已自动退避";
    } else {
      const allowed = new Set(["dry_run_ready", "ready_for_review", "submitted", "submitted_unverified", "skipped", "failed"]);
      item.status = allowed.has(result.status) ? result.status : "failed";
      item.lastError = String(result.error || "");
    }
    item.updatedAt = Date.now();
    await this.store.write("queue", queue);
    await this.appendEvent("job_result", { queueId: item.id, status: item.status, retryAt: item.retryAt || 0 });
    return { item, rate };
  }

  async snapshot() {
    const [profile, jobs, queue, events, settings] = await Promise.all([
      this.store.read("profile", {}), this.store.read("jobs", []), this.store.read("queue", []),
      this.store.read("events", []), this.store.read("settings", {})
    ]);
    const activeJobs = jobs.filter((job) => job.active !== false && !(Date.parse(job.expiresAt || "") < Date.now())).length;
    return {
      profile,
      settings,
      stats: {
        jobs: jobs.length,
        activeJobs,
        queued: queue.filter((item) => ["queued", "retry", "processing"].includes(item.status)).length,
        completed: queue.filter((item) => ["dry_run_ready", "ready_for_review", "submitted", "submitted_unverified"].includes(item.status)).length
      },
      jobs: (await this.rankedJobs()).slice(0, 200),
      queue,
      events: events.slice(-100).reverse()
    };
  }

  async bridgeSnapshot() {
    const snapshot = await this.snapshot();
    return {
      profile: snapshot.profile,
      settings: snapshot.settings,
      stats: snapshot.stats,
      queue: snapshot.queue.slice(0, 20).map(({ id, jobId, company, title, url, status, attempts, retryAt }) => ({
        id, jobId, company, title, url, status, attempts, retryAt
      }))
    };
  }

  async handleBridgeMessage(message) {
    const request = Bridge.validateRequest(message);
    try {
      let payload;
      if (request.type === Bridge.TYPES.HELLO) payload = await this.bridgeSnapshot();
      else if (request.type === Bridge.TYPES.GET_SNAPSHOT) payload = await this.snapshot();
      else if (request.type === Bridge.TYPES.SYNC_PROFILE) payload = await this.saveProfile(request.payload?.profile || {});
      else if (request.type === Bridge.TYPES.IMPORT_JOBS) payload = await this.importJobs(request.payload?.jobs || []);
      else if (request.type === Bridge.TYPES.BUILD_QUEUE) payload = await this.rebuildQueue(request.payload || {});
      else if (request.type === Bridge.TYPES.NEXT_JOB) payload = await this.claimNextJob();
      else if (request.type === Bridge.TYPES.REPORT_RESULT) payload = await this.reportResult(request.payload || {});
      return Bridge.makeResponse(request, payload);
    } catch (error) {
      return Bridge.makeResponse(request, {}, error.message);
    }
  }
}

module.exports = { ResumePilotService, publicProfile };
