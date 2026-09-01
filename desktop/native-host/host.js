const path = require("node:path");
const Bridge = require("../../shared/bridge-protocol.js");
const { ResumePilotService } = require("../src/core/service.js");

const dataDirectory = process.env.RESUME_PILOT_DATA_DIR
  ? path.resolve(process.env.RESUME_PILOT_DATA_DIR)
  : path.join(process.env.LOCALAPPDATA || process.cwd(), "ResumePilot", "data");
const service = new ResumePilotService(dataDirectory);
let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function consume() {
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > 64 * 1024 * 1024) throw new Error("本地通信消息超过安全上限");
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
