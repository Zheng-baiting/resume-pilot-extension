import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);
const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const extensionDirectory = process.env.RESUME_PILOT_EXTENSION_DIR
  || path.join(process.env.LOCALAPPDATA || "", "Programs", "resume-pilot", "resources", "extension");
const userDataDirectory = path.join(projectRoot, "tmp", `edge-native-${process.pid}-${Date.now()}`);
const extensionId = "elpkjefgjcpichlgiecacdkgcohdpehf";

assert.equal(fs.existsSync(path.join(extensionDirectory, "manifest.json")), true, "installed extension is missing");

const context = await chromium.launchPersistentContext(userDataDirectory, {
  channel: "msedge",
  headless: false,
  args: [
    `--disable-extensions-except=${extensionDirectory}`,
    `--load-extension=${extensionDirectory}`,
    "--no-first-run",
    "--no-default-browser-check"
  ]
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  assert.equal(new URL(worker.url()).host, extensionId);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("button", { name: "3. 填当前页" }).click();
  await popup.getByRole("button", { name: "连接桌面端" }).click();
  await popup.waitForTimeout(1200);
  const connectionStatus = await popup.locator("#desktopStatus").textContent();
  if (connectionStatus !== "桌面控制中心已连接") {
    const permissions = await worker.evaluate(() => chrome.permissions.getAll());
    throw new Error(`native messaging did not connect: ${connectionStatus}; permissions=${JSON.stringify(permissions)}`);
  }
  await popup.screenshot({ path: path.join(projectRoot, "tmp", "edge-native-messaging.png"), fullPage: true });
  console.log("Edge native messaging end-to-end test passed");
} finally {
  await context.close();
}
