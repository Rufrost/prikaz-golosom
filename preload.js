const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  getDefaultPrompt: () => ipcRenderer.invoke("get-default-prompt"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  saveRecording: (buffer, durationMs, mode, language) =>
    ipcRenderer.invoke("save-recording", { buffer, durationMs, mode, language }),
  discardRecording: (id) => ipcRenderer.invoke("discard-recording", id),
  sendRecording: (id, model) => ipcRenderer.invoke("send-recording", { id, model }),
  listUnfinished: () => ipcRenderer.invoke("list-unfinished"),
  deleteUnfinished: (id) => ipcRenderer.invoke("delete-unfinished", id),
  getUnfinishedAudio: (id) => ipcRenderer.invoke("get-unfinished-audio", id),
  onUnfinishedChanged: (callback) =>
    ipcRenderer.on("unfinished-changed", (_event, state) => callback(state)),
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
