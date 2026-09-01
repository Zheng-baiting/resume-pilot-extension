import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await import("../city-preferences.js");
await import("../scoring.js");

const cities = globalThis.ResumePilotCities;
assert.equal(cities.normalize(" 上海, 杭州；上海 "), "上海、杭州");
assert.equal(cities.toggle("上海", "杭州"), "上海、杭州");
assert.equal(cities.toggle("上海、杭州", "上海"), "杭州");
assert.equal(cities.toggle("上海、杭州", "不限"), "不限");
assert.equal(cities.toggle("不限", "不限"), "");
assert.equal(cities.toggle("不限", "深圳"), "深圳");
assert.equal(cities.forSearch("不限"), "");
assert.deepEqual(cities.match("工作地点：杭州", "上海、杭州").matched, ["杭州"]);
assert.equal(cities.analyze("工作地点：上海", "上海、杭州").status, "matched");
assert.equal(cities.analyze("Location: Shanghai", "上海、杭州").status, "matched");
assert.equal(cities.normalize("Shanghai、杭州市"), "上海、杭州");
assert.equal(cities.analyze("工作地点：北京", "上海、杭州").status, "mismatch");
assert.equal(cities.analyze("支持全国远程办公", "上海、杭州").status, "flexible");
assert.equal(cities.analyze("工作地点将在面试时沟通", "上海、杭州").status, "unknown");

const matching = globalThis.ResumePilotScoring.evaluateJob(
  "软件开发实习生，工作地点杭州，使用 JavaScript",
  "https://careers.example.com/job/1",
  { targetRole: "软件开发", targetCity: "上海、杭州", skills: "JavaScript", positionType: "实习" }
);
assert.equal(matching.cityMatchStatus, "matched");
assert.deepEqual(matching.matchedCities, ["杭州"]);
assert.ok(matching.reasons.some((reason) => reason.includes("地点匹配：杭州")));

const mismatch = globalThis.ResumePilotScoring.evaluateJob(
  "软件开发实习生，工作地点北京，使用 JavaScript",
  "https://careers.example.com/job/3",
  { targetRole: "软件开发", targetCity: "上海、杭州", skills: "JavaScript", positionType: "实习" }
);
assert.equal(mismatch.cityMatchStatus, "mismatch");
assert.equal(mismatch.hardBlocked, true);

const unknown = globalThis.ResumePilotScoring.evaluateJob(
  "软件开发实习生，使用 JavaScript",
  "https://careers.example.com/job/4",
  { targetRole: "软件开发", targetCity: "上海、杭州", skills: "JavaScript", positionType: "实习" }
);
assert.equal(unknown.cityMatchStatus, "unknown");
assert.equal(unknown.hardBlocked, false);
assert.ok(unknown.warnings.some((warning) => warning.includes("进入详情后必须复核")));

const seniorFullTime = globalThis.ResumePilotScoring.evaluateJob(
  "Senior Software Engineer，Full-time，JavaScript",
  "https://jobs.lever.co/example/123",
  { targetRole: "软件开发", targetCity: "不限", skills: "JavaScript", positionType: "实习", maxExperienceYears: "0" }
);
assert.equal(seniorFullTime.hardBlocked, true);
assert.ok(seniorFullTime.warnings.some((warning) => warning.includes("不符合实习目标")));

const unrestricted = globalThis.ResumePilotScoring.evaluateJob(
  "软件开发实习生，使用 JavaScript",
  "https://careers.example.com/job/2",
  { targetRole: "软件开发", targetCity: "不限", skills: "JavaScript", positionType: "实习" }
);
assert.ok(unrestricted.reasons.includes("地点不限"));
assert.ok(!unrestricted.warnings.some((warning) => warning.includes("地点未确认")));

const popup = fs.readFileSync(`${root}/popup.html`, "utf8");
const popupScript = fs.readFileSync(`${root}/popup.js`, "utf8");
const popupStyles = fs.readFileSync(`${root}/popup.css`, "utf8");
assert.match(popup, /id="targetCityOptions"/);
assert.match(popup, /可手动输入/);
assert.match(popup, /id="targetCityToggle"/);
assert.match(popup, /id="targetCityDropdown" class="city-dropdown" hidden/);
assert.match(popupScript, /\["不限", \.\.\.ResumePilotCities\.popularCities\]/);
assert.match(popupScript, /function setCityDropdown\(open\)/);
assert.match(popupScript, /进详情核验/);
assert.match(popup, /id="submissionMode"/);
assert.match(popup, /试运行：填写但不提交/);
assert.match(popup, /id="maxPerCompany"/);
assert.match(popup, /id="exportDiagnostics"/);
assert.match(popupScript, /privacy: "不包含姓名、手机号、邮箱、简历正文、附件或已保存答案"/);
assert.match(popupStyles, /\.city-options[^}]*max-height: 210px[^}]*overflow-y: auto/s);

console.log("city preference tests passed");
