import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let createdAlarm = null;
const context = {
  chrome: {
    runtime: {
      getManifest: () => ({ version: "0.14.0" }),
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    },
    alarms: {
      onAlarm: { addListener() {} },
      async get() { return null; },
      async create(name, options) { createdAlarm = { name, options }; }
    },
    storage: { local: { async get() { return {}; }, async set() {} } },
    tabs: {
      onCreated: { addListener() {} }, onUpdated: { addListener() {} }, onRemoved: { addListener() {} }
    }
  },
  importScripts() {},
  fetch: async () => ({ ok: true, text: async () => "<rss><channel></channel></rss>" }),
  URL,
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${root}/scoring.js`, "utf8"), context);
vm.runInContext(fs.readFileSync(`${root}/background.js`, "utf8"), context);
await new Promise((resolve) => setTimeout(resolve, 0));

const firstPage = vm.runInContext("selectSeeds('通信、人工智能', []).slice(0, 8).map(({ company, segment }) => ({ company, segment }))", context);
assert.ok(new Set(firstPage.map((item) => item.segment)).size >= 4, JSON.stringify(firstPage));
assert.ok(firstPage.some((item) => item.segment === "外企"));
assert.ok(firstPage.some((item) => item.segment === "行业企业"));
assert.ok(firstPage.some((item) => item.segment === "成长型企业"));
const discoveredName = vm.runInContext(`extractCompanyNameFromListing({
  title: "网络工程师招聘_示例网络科技有限公司招聘-BOSS直聘",
  description: "示例网络科技有限公司正在招聘网络实习生"
})`, context);
assert.equal(discoveredName, "示例网络科技有限公司");
assert.equal(vm.runInContext("isRecruitmentDiscoveryUrl('https://www.zhipin.com/job_detail/123')", context), true);
assert.equal(createdAlarm?.name, "resume-pilot-job-watch");
assert.equal(createdAlarm?.options?.delayInMinutes, 2);
assert.equal(createdAlarm?.options?.periodInMinutes, 30);

console.log("company diversity and watch tests passed");
