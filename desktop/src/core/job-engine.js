require("../../../city-preferences.js");
require("../../../scoring.js");
const crypto = require("node:crypto");

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function canonicalUrl(value = "") {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "from", "source"].forEach((key) => parsed.searchParams.delete(key));
    return parsed.href.replace(/\/$/, "");
  } catch { return clean(value); }
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

function buildQueue(rankedJobs = [], options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 20)));
  const perCompany = Math.max(1, Math.min(20, Number(options.perCompany || 3)));
  const minimumScore = Number(options.minimumScore || 40);
  const counts = new Map();
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

module.exports = { canonicalUrl, fingerprintJob, normalizeJob, isExpired, rankJob, rankJobs, buildQueue };
