import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requests = [];
const messageListeners = [];
const storage = {
  profile: {
    fullName: "不应同步",
    phone: "13800000000",
    email: "private@example.com",
    resumeText: "不应同步的简历正文",
    targetRole: "软件开发实习生",
    targetCity: "上海",
    targetIndustry: "互联网",
    positionType: "实习",
    skills: "JavaScript"
  },
  latestManualScan: {
    results: [{ company: "示例公司", title: "前端实习生", url: "https://careers.example.com/jobs/1", location: "上海", description: "JavaScript React" }]
  }
};

const port = {
  onMessage: { addListener(listener) { messageListeners.push(listener); } },
  onDisconnect: { addListener() {} },
  postMessage(request) {
    requests.push(request);
    queueMicrotask(() => messageListeners.forEach((listener) => listener({
      protocolVersion: "1.0",
      requestId: request.requestId,
      ok: true,
      payload: request.type === "IMPORT_JOBS" ? { received: request.payload.jobs.length, stored: request.payload.jobs.length } : {}
    })));
  }
};

const context = {
  chrome: {
    runtime: {
      getManifest: () => ({ version: "2.0.0" }),
      onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      connectNative: () => port
    },
    alarms: { onAlarm: { addListener() {} }, async get() { return {}; }, async create() {} },
    storage: { local: { async get(keys) { if (typeof keys === "string") return { [keys]: storage[keys] }; return Object.fromEntries(keys.map((key) => [key, storage[key]])); }, async set(values) { Object.assign(storage, values); } } },
    tabs: { onUpdated: { addListener() {} }, onCreated: { addListener() {} }, onRemoved: { addListener() {} } }
  },
  importScripts() {}, fetch: async () => ({ ok: true, text: async () => "" }), URL, console, setTimeout, clearTimeout, queueMicrotask
};
vm.createContext(context);
for (const file of ["shared/bridge-protocol.js", "city-preferences.js", "scoring.js", "background.js"]) {
  vm.runInContext(fs.readFileSync(`${root}/${file}`, "utf8"), context);
}
await vm.runInContext("syncBrowserStateToDesktop()", context);

const profileRequest = requests.find((request) => request.type === "SYNC_PROFILE");
const jobsRequest = requests.find((request) => request.type === "IMPORT_JOBS");
assert.ok(profileRequest);
assert.ok(jobsRequest);
assert.equal(profileRequest.payload.profile.targetRole, "软件开发实习生");
assert.equal("fullName" in profileRequest.payload.profile, false);
assert.equal("phone" in profileRequest.payload.profile, false);
assert.equal("email" in profileRequest.payload.profile, false);
assert.equal("resumeText" in profileRequest.payload.profile, false);
assert.equal(jobsRequest.payload.jobs.length, 1);
assert.equal(jobsRequest.payload.jobs[0].company, "示例公司");
console.log("desktop bridge privacy and sync tests passed");
