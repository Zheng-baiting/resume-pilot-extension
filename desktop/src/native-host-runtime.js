const path = require("node:path");
const Bridge = require("../../shared/bridge-protocol.js");
const { ResumePilotService } = require("./core/service.js");

const MAX_INCOMING_BYTES = 64 * 1024 * 1024;
const MAX_OUTGOING_BYTES = 1024 * 1024;

function defaultDataDirectory() {
  if (process.env.RESUME_PILOT_DATA_DIR) return path.resolve(process.env.RESUME_PILOT_DATA_DIR);
  const appData = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
  return path.join(appData, "Resume Pilot", "data");
}

function startNativeHost(dataDirectory = defaultDataDirectory()) {
  const service = new ResumePilotService(dataDirectory);
  let buffer = Buffer.alloc(0);

  function send(message) {
    let body = Buffer.from(JSON.stringify(message), "utf8");
    if (body.length > MAX_OUTGOING_BYTES) {
      body = Buffer.from(JSON.stringify({
        protocolVersion: Bridge.VERSION,
        requestId: message?.requestId || "",
        ok: false,
        error: "桌面端响应超过浏览器 1MB 安全上限"
      }), "utf8");
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([header, body]));
  }

  async function consume() {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > MAX_INCOMING_BYTES) throw new Error("本地通信消息超过安全上限");
      if (buffer.length < length + 4) return;
      const body = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      let request;
      try {
        request = JSON.parse(body.toString("utf8"));
        send(await service.handleBridgeMessage(request));
      } catch (error) {
        send(Bridge.makeResponse(request, {}, error.message));
      }
    }
  }

  service.init().then(() => {
    process.stdin.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      consume().catch((error) => process.stderr.write(`${error.stack || error}\n`));
    });
    process.stdin.resume();
  }).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { startNativeHost, defaultDataDirectory, MAX_INCOMING_BYTES, MAX_OUTGOING_BYTES };
