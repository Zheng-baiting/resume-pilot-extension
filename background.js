importScripts("scoring.js");

const SEARCH_URL = "https://www.bing.com/search?format=rss&q=";

// 这些入口来自企业公开招聘官网；它们只作为搜索种子，不代表对企业的背书或排名。
const VERIFIED_CAREER_SEEDS = ResumePilotScoring.companies.map((entry) => ({
  company: entry.company,
  domain: entry.domains[0],
  url: entry.careerUrl,
  tags: entry.tags
}));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SEARCH_OFFICIAL_CAREERS") return;

  searchOfficialCareers(message.criteria)
    .then((results) => sendResponse({ ok: true, results }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function searchOfficialCareers(criteria = {}) {
  const role = clean(criteria.role) || "校园招聘";
  const city = clean(criteria.city);
  const industry = clean(criteria.industry);
  const positionType = clean(criteria.positionType) || "实习";
  const skills = splitList(criteria.skills).slice(0, 8);
  const preferredCompanies = splitList(criteria.preferredCompanies).slice(0, 8);

  const matchedSeeds = selectSeeds(industry, preferredCompanies);
  const companyQueries = preferredCompanies.map((company) =>
    `${company} ${role} ${city} ${positionType} 职位 官方招聘`
  );
  const seedQueries = matchedSeeds.map((seed) =>
    `site:${seed.domain} ${role} ${city} ${positionType}`
  );
  const discoveryQueries = [
    `${role} ${city} ${industry} ${positionType} 职位 官方招聘 careers`,
    `${role} ${city} ${industry} ${positionType} 行业龙头 上市公司 科技公司 官方招聘`
  ];
  const queries = [...new Set([...companyQueries, ...seedQueries, ...discoveryQueries])].slice(0, 12);

  const batches = await Promise.all(queries.map(fetchRssResults));
  const deduped = new Map();

  for (const item of batches.flat()) {
    if (!isLikelyCareerResult(item)) continue;
    const key = canonicalUrl(item.url);
    const scored = enrichResult(item, { ...criteria, role, city, industry, positionType, skills, preferredCompanies, matchedSeeds });
    if (!deduped.has(key) || deduped.get(key).score < scored.score) {
      deduped.set(key, scored);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function selectSeeds(industry, preferredCompanies) {
  if (preferredCompanies.length) {
    const exact = VERIFIED_CAREER_SEEDS.filter((seed) =>
      preferredCompanies.some((name) => seed.company.includes(name) || name.includes(seed.company))
    );
    if (exact.length) return exact;
  }
  const industryTerms = splitList(industry);
  const relevant = VERIFIED_CAREER_SEEDS.filter((seed) =>
    !industryTerms.length || industryTerms.some((term) => seed.tags.some((tag) => tag.includes(term) || term.includes(tag)))
  );
  return relevant.slice(0, 4);
}

async function fetchRssResults(query) {
  const response = await fetch(SEARCH_URL + encodeURIComponent(query));
  if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

  return items.map((match) => {
    const block = match[1];
    return {
      title: decodeXml(readTag(block, "title")),
      url: decodeXml(readTag(block, "link")),
      description: stripHtml(decodeXml(readTag(block, "description"))),
      query
    };
  });
}

function readTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "") : "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function splitList(value = "") {
  return String(value).split(/[，,、;；\n]/).map(clean).filter(Boolean);
}

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value;
  }
}

function isLikelyCareerResult(item) {
  if (!item.url?.startsWith("http")) return false;
  const haystack = `${item.title} ${item.description} ${item.url}`.toLowerCase();
  const blocked = ["zhihu.com", "baidu.com", "bilibili.com", "douyin.com", "xiaohongshu.com", "tieba", "csdn.net"];
  if (blocked.some((domain) => haystack.includes(domain))) return false;
  return /(招聘|校招|应届|career|career[s]?|job|join|talent)/i.test(haystack);
}

function enrichResult(item, criteria) {
  const text = `${item.title} ${item.description} ${item.url}`.toLowerCase();
  const seed = criteria.matchedSeeds.find((candidate) => item.url.includes(candidate.domain));
  const companyEval = ResumePilotScoring.evaluateCompany(text, item.url, criteria);
  const jobEval = ResumePilotScoring.evaluateJob(text, item.url, {
    ...criteria,
    targetRole: criteria.role,
    targetCity: criteria.city,
    skills: criteria.skills.join(",")
  });
  const isPosition = /(position|jobdetail|job\/|职位|岗位)/i.test(item.url + item.title);
  const score = Math.round(companyEval.companyScore * 0.3 + jobEval.jobScore * 0.45 + jobEval.compensationScore * 0.25);
  return {
    ...item,
    company: companyEval.company || seed?.company || inferCompany(item),
    resultType: isPosition ? "具体岗位" : "招聘入口",
    score,
    companyScore: companyEval.companyScore,
    jobScore: jobEval.jobScore,
    compensationScore: jobEval.compensationScore,
    compensationLabel: jobEval.compensationLabel,
    confidence: companyEval.confidence,
    companyDimensions: companyEval.dimensions,
    reasons: [...new Set([...companyEval.reasons, ...jobEval.reasons])].slice(0, 6),
    warnings: [...new Set([...companyEval.warnings, ...jobEval.warnings])].slice(0, 6),
    evidence: companyEval.evidence
  };
}

function inferCompany(item) {
  const title = clean(item.title).split(/[|｜\-_—]/)[0];
  if (title && title.length <= 20) return title;
  try { return new URL(item.url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return "待核验企业"; }
}
