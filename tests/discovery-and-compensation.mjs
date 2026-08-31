import assert from "node:assert/strict";

await import("../scoring.js");

const scoring = globalThis.ResumePilotScoring;
assert.ok(scoring.companies.length >= 30, `expected a diversified catalog, got ${scoring.companies.length}`);
const segments = new Set(scoring.companies.map((item) => item.segment));
for (const segment of ["外企", "行业企业", "成长型企业", "大型民企"]) {
  assert.ok(segments.has(segment), `missing company segment: ${segment}`);
}

const profile = {
  targetRole: "网络工程师",
  skills: "H3C, OSPF, VLAN, Linux",
  positionType: "实习",
  graduationYear: "2027",
  degree: "本科",
  minDailySalary: "200"
};
const undisclosed = scoring.evaluateJob("网络工程师实习生，负责 H3C、OSPF、VLAN 网络配置", "https://careers.example.com/job/1", profile);
assert.equal(undisclosed.compensationScore, 50);
assert.equal(undisclosed.compensationLabel, "薪资面议/官网未公开");
assert.ok(!undisclosed.warnings.some((item) => item.includes("未公开薪资")));

const closed = scoring.evaluateJob("网络工程师实习生，职位已下线，不再接受申请", "https://careers.example.com/job/2", profile);
assert.equal(closed.hardBlocked, true);
assert.ok(closed.warnings.some((item) => item.includes("停止招聘或下线")));

const expired = scoring.evaluateJob("网络工程师实习生，申请截止：2025-01-01", "https://careers.example.com/job/3", profile);
assert.equal(expired.hardBlocked, true);
assert.ok(expired.warnings.some((item) => item.includes("截止日期已过")));

console.log("discovery and compensation tests passed");
