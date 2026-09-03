const { app, BrowserWindow, ipcMain, session, clipboard } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const OpenAI = require("openai");
const updater = require("./updater");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const HISTORY_PATH = path.join(app.getPath("userData"), "history.json");
const HISTORY_LIMIT = 50;

// Прежний дефолт — если у пользователя в конфиге сохранён именно он (т.е. он его не
// редактировал), тихо переносим на новый вариант при загрузке, см. loadConfig().
const OLD_DEFAULT_CORRECTION_PROMPT =
  "Исправь орфографические, пунктуационные и грамматические ошибки в этом тексте, " +
  "сохрани исходный язык, стиль и разбивку на абзацы. " +
  "Верни только исправленный текст без пояснений, кавычек и комментариев.";

const DEFAULT_CORRECTION_PROMPT =
  "Исправь орфографические, пунктуационные и грамматические ошибки в этом тексте. " +
  "Убери слова-паразиты, звуки-заполнители и мычание (э, м, ну, вот, типа, как бы и т.п.), " +
  "а также повторы слов из-за запинок при надиктовке. " +
  "Сохрани исходный язык, смысл, стиль и разбивку на абзацы. " +
  "Верни только очищенный текст без пояснений, кавычек и комментариев.";

const DEFAULT_CONFIG = {
  apiKey: "",
  baseUrl: "https://api.polza.ai/v1",
  model: "whisper-1",
  textModel: "gpt-4o-mini",
  correctionPrompt: DEFAULT_CORRECTION_PROMPT,
};

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    if (saved.correctionPrompt === OLD_DEFAULT_CORRECTION_PROMPT) {
      saved.correctionPrompt = DEFAULT_CORRECTION_PROMPT;
    }
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

function addHistoryEntry(type, text) {
  const entries = loadHistory();
  entries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    type,
    text,
  });
  const trimmed = entries.slice(0, HISTORY_LIMIT);
  saveHistory(trimmed);
  return trimmed;
}

// Грубая оценка на случай, если провайдер/модель не возвращает точный usage
// (whisper-подобные модели тарифицируются по длительности аудио, а не по токенам).
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 700,
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

ipcMain.handle("copy-text", (_event, text) => {
  clipboard.writeText(text ?? "");
  return true;
});

ipcMain.handle("get-history", () => loadHistory());

ipcMain.handle("clear-history", () => {
  saveHistory([]);
  return [];
});

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-for-updates", async () => {
  try {
    return await updater.checkForUpdate(app.getVersion());
  } catch (e) {
    return { hasUpdate: false, error: e.message };
  }
});

ipcMain.handle("install-update", async (event, asset) => {
  // Portable-сборка электрон-билдера при запуске распаковывает себя во временную
  // папку — process.execPath там указывает на временную копию, а не на файл,
  // который реально запустил пользователь. Настоящий путь NSIS-обёртка кладёт
  // в PORTABLE_EXECUTABLE_FILE перед запуском распакованного приложения.
  const targetPath = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!targetPath) {
    return {
      ok: false,
      error: "Автообновление работает только в portable-версии приложения.",
    };
  }
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const destPath = await updater.downloadAndVerify(asset, (fraction) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("update-download-progress", fraction);
      }
    });
    await updater.scheduleSelfReplace(destPath, targetPath);
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("transcribe", async (_event, { buffer, language, mode }) => {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error("Не задан API-ключ polza.ai. Откройте настройки и укажите ключ.");
  }

  const tmpFile = path.join(os.tmpdir(), `prikaz-golosom-${Date.now()}.webm`);
  fs.writeFileSync(tmpFile, Buffer.from(buffer));

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || DEFAULT_CONFIG.baseUrl,
    });

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: config.model || DEFAULT_CONFIG.model,
      ...(language ? { language } : {}),
    });

    const text = transcription.text;
    // Часть провайдеров/моделей (напр. whisper-1) не возвращает usage вовсе —
    // тогда считаем это приблизительно по длине текста и помечаем как оценку.
    const rawUsage = transcription.usage;
    const usage = rawUsage && typeof rawUsage.total_tokens === "number"
      ? { total: rawUsage.total_tokens, estimated: false }
      : { total: estimateTokens(text), estimated: true };

    addHistoryEntry(mode === "append" ? "дозапись" : "запись", text);

    return { text, usage };
  } finally {
    fs.unlink(tmpFile, () => {});
  }
});

ipcMain.handle("correct-text", async (_event, { text }) => {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error("Не задан API-ключ polza.ai. Откройте настройки и укажите ключ.");
  }
  if (!text || !text.trim()) {
    throw new Error("Нет текста для проверки.");
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || DEFAULT_CONFIG.baseUrl,
  });

  const completion = await client.chat.completions.create({
    model: config.textModel || DEFAULT_CONFIG.textModel,
    temperature: 0,
    messages: [
      { role: "system", content: config.correctionPrompt || DEFAULT_CORRECTION_PROMPT },
      { role: "user", content: text },
    ],
  });

  const corrected = completion.choices[0]?.message?.content?.trim() || text;
  const rawUsage = completion.usage;
  const usage = rawUsage && typeof rawUsage.total_tokens === "number"
    ? { total: rawUsage.total_tokens, estimated: false }
    : { total: estimateTokens(text) + estimateTokens(corrected), estimated: true };

  addHistoryEntry("исправление", corrected);

  return { text: corrected, usage };
});
