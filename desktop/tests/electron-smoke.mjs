import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { _electron } = await import(playwrightModule);
const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const executablePath = path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const dataDirectory = path.join(projectRoot, "tmp", `electron-smoke-${process.pid}-${Date.now()}`);
const screenshotPath = path.join(projectRoot, "tmp", "electron-smoke.png");

const electronApp = await _electron.launch({
  executablePath,
  args: [path.join(projectRoot, "desktop")],
  cwd: projectRoot,
  env: { ...process.env, RESUME_PILOT_DATA_DIR: dataDirectory }
});

try {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  assert.equal(await window.title(), "Resume Pilot 桌面控制中心");
  await window.getByRole("heading", { name: "岗位发现与投递控制中心" }).waitFor();
  await window.getByRole("button", { name: "载入示例" }).click();
  await window.getByRole("button", { name: "导入岗位" }).click();
  await window.getByText(/本地岗位库现有 2 条/).waitFor();
  assert.equal(await window.locator("#statJobs").textContent(), "2");
  await window.screenshot({ path: screenshotPath, fullPage: true });
  console.log("electron desktop smoke test passed");
} finally {
  await electronApp.close();
}
