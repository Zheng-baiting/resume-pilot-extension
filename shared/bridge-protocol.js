(function initResumePilotBridge(global) {
  const VERSION = "1.0";
  const HOST_NAME = "com.resume_pilot.desktop";
  const TYPES = Object.freeze({
    HELLO: "HELLO",
    GET_SNAPSHOT: "GET_SNAPSHOT",
    SYNC_PROFILE: "SYNC_PROFILE",
    IMPORT_JOBS: "IMPORT_JOBS",
    BUILD_QUEUE: "BUILD_QUEUE",
    NEXT_JOB: "NEXT_JOB",
    REPORT_RESULT: "REPORT_RESULT"
  });

  function makeRequest(type, payload = {}) {
    if (!Object.values(TYPES).includes(type)) throw new Error(`未知桌面通信类型：${type}`);
    return {
      protocolVersion: VERSION,
      requestId: global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      payload
    };
  }

  function makeResponse(request, payload = {}, error = "") {
    return {
      protocolVersion: VERSION,
      requestId: request?.requestId || "",
      ok: !error,
      payload: error ? undefined : payload,
      error: error || undefined
    };
  }

  function validateRequest(message) {
    if (!message || message.protocolVersion !== VERSION) throw new Error("桌面通信协议版本不兼容");
    if (!message.requestId || !Object.values(TYPES).includes(message.type)) throw new Error("桌面通信消息无效");
    return message;
  }

  const api = { VERSION, HOST_NAME, TYPES, makeRequest, makeResponse, validateRequest };
  global.ResumePilotBridge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
