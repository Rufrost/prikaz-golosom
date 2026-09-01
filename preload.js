const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  transcribe: (buffer, language) => ipcRenderer.invoke("transcribe", { buffer, language }),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  correctText: (text) => ipcRenderer.invoke("correct-text", { text }),
});
