const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { ResumePilotService } = require("./core/service.js");

let service;

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

app.whenReady().then(async () => {
  const dataDirectory = process.env.RESUME_PILOT_DATA_DIR
    ? path.resolve(process.env.RESUME_PILOT_DATA_DIR)
    : path.join(app.getPath("userData"), "data");
  service = new ResumePilotService(dataDirectory);
  await service.init();

  ipcMain.handle("resume-pilot:snapshot", () => service.snapshot());
  ipcMain.handle("resume-pilot:save-profile", (_event, profile) => service.saveProfile(profile));
  ipcMain.handle("resume-pilot:import-jobs", (_event, jobs) => service.importJobs(jobs));
  ipcMain.handle("resume-pilot:build-queue", (_event, options) => service.rebuildQueue(options));
  ipcMain.handle("resume-pilot:next-job", () => service.claimNextJob());
  ipcMain.handle("resume-pilot:report-result", (_event, result) => service.reportResult(result));

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
