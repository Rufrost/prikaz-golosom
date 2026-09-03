const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  transcribe: (buffer, language, mode) => ipcRenderer.invoke("transcribe", { buffer, language, mode }),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  correctText: (text) => ipcRenderer.invoke("correct-text", { text }),
  getHistory: () => ipcRenderer.invoke("get-history"),
  clearHistory: () => ipcRenderer.invoke("clear-history"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: (asset) => ipcRenderer.invoke("install-update", asset),
  onUpdateProgress: (callback) =>
    ipcRenderer.on("update-download-progress", (_event, fraction) => callback(fraction)),
});
