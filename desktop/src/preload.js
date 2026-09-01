const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resumePilot", {
  snapshot: () => ipcRenderer.invoke("resume-pilot:snapshot"),
  saveProfile: (profile) => ipcRenderer.invoke("resume-pilot:save-profile", profile),
  importJobs: (jobs) => ipcRenderer.invoke("resume-pilot:import-jobs", jobs),
  buildQueue: (options) => ipcRenderer.invoke("resume-pilot:build-queue", options),
  nextJob: () => ipcRenderer.invoke("resume-pilot:next-job"),
  reportResult: (result) => ipcRenderer.invoke("resume-pilot:report-result", result)
});
