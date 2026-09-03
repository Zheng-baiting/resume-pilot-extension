const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { ResumePilotService } = require("./core/service.js");
const { defaultDataDirectory } = require("./native-host-runtime.js");

let service;

function showStartupError(error) {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(message);
  try {
    const logPath = path.join(app.getPath("userData"), "startup-error.log");
    fs.writeFileSync(logPath, `${new Date().toISOString()}\n${message}\n`, "utf8");
  } catch {}
  const window = new BrowserWindow({ width: 760, height: 520, title: "Resume Pilot 启动错误" });
  const html = `<meta charset="utf-8"><title>Resume Pilot 启动错误</title><style>body{font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:28px;background:#f6f8fb;color:#172033}h1{font-size:22px}pre{white-space:pre-wrap;background:#fff3f3;border:1px solid #e4b6b6;border-radius:8px;padding:16px;color:#8c2222;line-height:1.5}</style><h1>Resume Pilot 暂时无法启动</h1><p>请查看下方错误信息；修复后可重新打开应用。</p><pre>${message.replace(/[&<>]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[char]))}</pre>`;
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function extensionDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.resolve(__dirname, "../..");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f4f7fb",
    title: "Resume Pilot 桌面控制中心",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function startDesktopApp() {
  app.setAppUserModelId("io.github.zheng-baiting.resume-pilot");
  app.whenReady().then(async () => {
    try {
      service = new ResumePilotService(defaultDataDirectory());
      await service.init();

      ipcMain.handle("resume-pilot:snapshot", () => service.snapshot());
      ipcMain.handle("resume-pilot:save-profile", (_event, profile) => service.saveProfile(profile));
      ipcMain.handle("resume-pilot:import-jobs", (_event, jobs) => service.importJobs(jobs));
      ipcMain.handle("resume-pilot:build-queue", (_event, options) => service.rebuildQueue(options));
      ipcMain.handle("resume-pilot:next-job", () => service.claimNextJob());
      ipcMain.handle("resume-pilot:report-result", (_event, result) => service.reportResult(result));
      ipcMain.handle("resume-pilot:install-info", () => ({
        extensionId: "elpkjefgjcpichlgiecacdkgcohdpehf",
        extensionDirectory: extensionDirectory(),
        packaged: app.isPackaged
      }));
      ipcMain.handle("resume-pilot:open-extension-folder", () => shell.openPath(extensionDirectory()));

      createWindow();
      app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    } catch (error) {
      showStartupError(error);
    }
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

startDesktopApp();
