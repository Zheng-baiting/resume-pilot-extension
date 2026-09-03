import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Bridge from "../../shared/bridge-protocol.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const executable = process.env.RESUME_PILOT_HOST_EXE
  || path.join(projectRoot, "desktop", "build", "resume-pilot-native-host.exe");
const dataDirectory = path.join(projectRoot, "tmp", `packaged-host-${process.pid}-${Date.now()}`);
const child = spawn(executable, ["chrome-extension://elpkjefgjcpichlgiecacdkgcohdpehf/"], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, RESUME_PILOT_DATA_DIR: dataDirectory }
});

const request = Bridge.makeRequest(Bridge.TYPES.HELLO, { client: "packaged-host-test" });
const body = Buffer.from(JSON.stringify(request), "utf8");
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length, 0);
child.stdin.write(Buffer.concat([header, body]));

const response = await new Promise((resolve, reject) => {
  let output = Buffer.alloc(0);
  let stderr = "";
  const timer = setTimeout(() => reject(new Error(`packaged native host timed out; stderr=${stderr}; stdout=${output.toString("hex")}`)), 10000);
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.stdout.on("data", (chunk) => {
    output = Buffer.concat([output, chunk]);
    if (output.length < 4) return;
    const length = output.readUInt32LE(0);
    if (output.length < length + 4) return;
    clearTimeout(timer);
    resolve(JSON.parse(output.subarray(4, length + 4).toString("utf8")));
  });
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("exit", (code) => {
    if (output.length < 4) {
      clearTimeout(timer);
      reject(new Error(`packaged native host exited ${code}; stderr=${stderr}`));
    }
  });
});

assert.equal(response.ok, true);
assert.equal(response.requestId, request.requestId);
assert.equal(typeof response.payload?.stats?.jobs, "number");
child.kill();
console.log("packaged native host smoke test passed");
