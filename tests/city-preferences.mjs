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

const matching = globalThis.ResumePilotScoring.evaluateJob(
  "软件开发实习生，工作地点杭州，使用 JavaScript",
  "https://careers.example.com/job/1",
  { targetRole: "软件开发", targetCity: "上海、杭州", skills: "JavaScript", positionType: "实习" }
);
assert.ok(matching.reasons.some((reason) => reason.includes("地点：杭州")));
assert.ok(!matching.warnings.some((warning) => warning.includes("地点未确认")));

const unrestricted = globalThis.ResumePilotScoring.evaluateJob(
  "软件开发实习生，使用 JavaScript",
  "https://careers.example.com/job/2",
  { targetRole: "软件开发", targetCity: "不限", skills: "JavaScript", positionType: "实习" }
);
assert.ok(unrestricted.reasons.includes("地点不限"));
assert.ok(!unrestricted.warnings.some((warning) => warning.includes("地点未确认")));

const popup = fs.readFileSync(`${root}/popup.html`, "utf8");
assert.match(popup, /id="targetCityOptions"/);
assert.match(popup, /可手动输入/);

console.log("city preference tests passed");
