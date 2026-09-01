const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const OpenAI = require("openai");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { apiKey: "", baseUrl: "https://api.polza.ai/v1", model: "whisper-1" };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 620,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("save-config", (_event, config) => {
  saveConfig(config);
  return true;
});

ipcMain.handle("transcribe", async (_event, { buffer, language }) => {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error("Не задан API-ключ polza.ai. Откройте настройки и укажите ключ.");
  }

  const tmpFile = path.join(os.tmpdir(), `prikaz-golosom-${Date.now()}.webm`);
  fs.writeFileSync(tmpFile, Buffer.from(buffer));

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || "https://api.polza.ai/v1",
    });

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: config.model || "whisper-1",
      ...(language ? { language } : {}),
    });

    return transcription.text;
  } finally {
    fs.unlink(tmpFile, () => {});
  }
});
