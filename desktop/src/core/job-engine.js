const crypto = require("node:crypto");
// Keep these as static requires so Electron ASAR and the Node SEA native host
// can bundle the shared scoring data instead of resolving a machine-specific path.
require("../../../city-preferences.js");
require("../../../scoring.js");

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function canonicalUrl(value = "") {
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    ["utm_source", "utm_medium", "utm_campaign", "from", "source"].forEach((key) => parsed.searchParams.delete(key));
    return parsed.href.replace(/\/$/, "");
  } catch { return ""; }
}

function fingerprintJob(job = {}) {
  const seed = [clean(job.company).toLowerCase(), clean(job.title).toLowerCase(), canonicalUrl(job.url)].join("|");
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

function normalizeJob(input = {}) {
  const now = Date.now();
  const job = {
    id: clean(input.id),
    company: clean(input.company) || "待核验企业",
    title: clean(input.title || input.job),
    url: canonicalUrl(input.url),
    location: clean(input.location || input.city || input.jobLocation),
    description: clean(input.description || input.summary || input.text),
    skills: clean(Array.isArray(input.skills) ? input.skills.join("、") : input.skills),
    positionType: clean(input.positionType || input.type),
    salary: clean(input.salary || input.compensation),
    source: clean(input.source || input.platform || "browser-extension"),
    publishedAt: input.publishedAt || input.publishDate || "",
    expiresAt: input.expiresAt || input.deadline || "",
    active: input.active !== false,
    verificationStatus: clean(input.verificationStatus || "candidate"),
    importedAt: Number(input.importedAt || now),
    updatedAt: now
  };
  if (!job.id) job.id = fingerprintJob(job);
  return job;
}

function isExpired(job, now = Date.now()) {
  if (!job.active) return true;
  const expires = Date.parse(job.expiresAt || "");
  return Number.isFinite(expires) && expires < now;
}

function rankJob(job, profile = {}) {
  const evidence = [job.title, job.location, job.description, job.skills, job.positionType, job.salary].join(" ");
  const evaluation = globalThis.ResumePilotScoring.evaluateJob(evidence, job.url, profile);
  return {
    ...job,
    score: evaluation.jobScore,
    hardBlocked: Boolean(evaluation.hardBlocked || isExpired(job)),
    skillEligible: Boolean(evaluation.skillEligible),
    cityMatchStatus: evaluation.cityMatchStatus,
    matchedCities: evaluation.matchedCities || [],
    reasons: evaluation.reasons || [],
    warnings: [...(evaluation.warnings || []), ...(isExpired(job) ? ["岗位已结束或超过截止日期"] : [])]
  };
}

function rankJobs(jobs = [], profile = {}) {
  return jobs.map((job) => rankJob(job, profile)).sort((a, b) => {
    if (a.hardBlocked !== b.hardBlocked) return a.hardBlocked ? 1 : -1;
    if (a.skillEligible !== b.skillEligible) return a.skillEligible ? -1 : 1;
    return b.score - a.score;
  });
}

function buildQueue(rankedJobs = [], options = {}, previous = []) {
  const { limit, perCompany, minimumScore } = normalizeQueueOptions(options);
  const counts = new Map();
  for (const item of previous) {
    const key = clean(item.company).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seen = new Set();
  const queue = [];
  for (const job of rankedJobs) {
    if (job.hardBlocked || (!job.skillEligible && job.score < minimumScore)) continue;
    const fingerprint = fingerprintJob(job);
    if (seen.has(fingerprint)) continue;
    const companyKey = clean(job.company).toLowerCase();
    if ((counts.get(companyKey) || 0) >= perCompany) continue;
    seen.add(fingerprint);
    counts.set(companyKey, (counts.get(companyKey) || 0) + 1);
    queue.push({
      id: fingerprint,
      jobId: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
      score: job.score,
      status: "queued",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    if (queue.length >= limit) break;
  }
  return queue;
}

function normalizeQueueOptions(options = {}) {
  const number = (value, fallback, min, max) => {
    const parsed = value === "" || value == null ? fallback : Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
  };
  const limit = number(options.limit ?? options.queueLimit, 20, 1, 200);
  return { limit, queueLimit: limit, perCompany: number(options.perCompany, 3, 1, 20), minimumScore: number(options.minimumScore, 40, 0, 100) };
}

module.exports = { canonicalUrl, fingerprintJob, normalizeJob, isExpired, rankJob, rankJobs, buildQueue, normalizeQueueOptions };
