import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const storage = {};
let nextTabId = 10;
const context = {
  chrome: {
    runtime: {
      getManifest: () => ({ version: "2.0.0" }),
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      connectNative() { throw new Error("native host not installed in unit test"); }
    },
    alarms: {
      onAlarm: { addListener() {} },
      async get() { return { name: "resume-pilot-job-watch" }; },
      async create() {}
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: storage[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          return { ...storage };
        },
        async set(values) { Object.assign(storage, values); }
      }
    },
    tabs: {
      onCreated: { addListener() {} },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      async create({ url }) { return { id: nextTabId++, url, status: "complete" }; },
      async update(id, values) { return { id, ...values }; },
      async get(id) { return { id, status: "complete" }; },
      async sendMessage() { return {}; }
    }
  },
  importScripts() {},
  fetch: async () => ({ ok: true, text: async () => "<rss><channel></channel></rss>" }),
  URL,
  console,
  setTimeout() { return 1; },
  clearTimeout() {}
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(`${root}/city-preferences.js`, "utf8"), context);
vm.runInContext(fs.readFileSync(`${root}/scoring.js`, "utf8"), context);
vm.runInContext(fs.readFileSync(`${root}/background.js`, "utf8"), context);
await new Promise((resolve) => setTimeout(resolve, 0));

const baseProfile = {
  targetRole: "软件开发实习生",
  targetIndustry: "互联网",
  targetCity: "上海",
  positionType: "实习",
  skills: "JavaScript",
  dailyLimit: "2",
  maxPerCompany: "2"
};

await assert.rejects(
  vm.runInContext(`startAutopilot(${JSON.stringify({ ...baseProfile, submissionMode: "auto", autoSubmitEnabled: false })})`, context),
  /最终提交授权/
);

const dryRun = await vm.runInContext(`startAutopilot(${JSON.stringify({ ...baseProfile, submissionMode: "dry_run", autoSubmitEnabled: false })})`, context);
assert.equal(dryRun.state.submissionMode, "dry_run");
assert.equal(dryRun.state.maxPerCompany, 2);
assert.equal(dryRun.state.dailyLimit, 2);
assert.equal(dryRun.state.processed, 0);
assert.ok(dryRun.state.companies.length > 0);

const fingerprints = vm.runInContext(`[
  applicationFingerprint("示例公司", "软件工程师", "https://jobs.lever.co/example/abc-123"),
  applicationFingerprint("示例公司", "软件工程师", "https://jobs.lever.co/example/abc-123/apply")
]`, context);
assert.equal(fingerprints[0], fingerprints[1]);
const duplicate = vm.runInContext(`isPreviouslySubmitted(
  { title: "软件工程师", url: "https://jobs.lever.co/example/abc-123/apply" },
  "示例公司",
  [{ company: "示例公司", job: "软件工程师", url: "https://jobs.lever.co/example/abc-123", status: "submitted" }]
)`, context);
assert.equal(duplicate, true);

const selectedEntrance = vm.runInContext(`selectRecruitmentEntrance([
  { label: "社会招聘", url: "https://example.zhiye.com/social", audience: "social", priority: 75, platform: "北森招聘", cityMatchStatus: "matched" },
  { label: "校园招聘", url: "https://example.zhiye.com/campus", audience: "campus", priority: 90, platform: "北森招聘", cityMatchStatus: "unknown" },
  { label: "深圳校招职位", url: "https://example.zhiye.com/campus/jobs?city=shenzhen", audience: "campus", priority: 80, platform: "北森招聘", cityMatchStatus: "mismatch" }
], { positionType: "实习", targetCity: "上海" }, "https://www.example.com/join")`, context);
assert.equal(selectedEntrance.label, "校园招聘");

console.log("operating mode and deduplication tests passed");
