const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Bridge = require("../../shared/bridge-protocol.js");

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

test("native host exchanges framed JSON without writing logs to stdout", async () => {
  const host = path.join(__dirname, "../native-host/host.js");
  const dataDirectory = path.join(__dirname, "../../tmp", `native-host-test-${process.pid}-${Date.now()}`);
  const child = spawn(process.execPath, [host], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, RESUME_PILOT_DATA_DIR: dataDirectory }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const request = Bridge.makeRequest(Bridge.TYPES.HELLO, { client: "native-host-test" });
  const response = await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error(`native host timeout: ${stderr}`)), 5000);
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) return;
      clearTimeout(timer);
      resolve(JSON.parse(buffer.subarray(4, length + 4).toString("utf8")));
    });
    child.stdin.write(encode(request));
  });
  assert.equal(response.ok, true);
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.payload.stats.jobs, 0);
  child.stdin.end();
});
