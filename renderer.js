const recordBtn = document.getElementById("recordBtn");
const appendBtn = document.getElementById("appendBtn");
const pauseBtn = document.getElementById("pauseBtn");
const timerEl = document.getElementById("timer");
const cancelSendBtn = document.getElementById("cancelSendBtn");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText");
const spinnerEl = document.getElementById("spinner");
const resultEl = document.getElementById("result");
const copyBtn = document.getElementById("copyBtn");
const checkErrorsBtn = document.getElementById("checkErrorsBtn");
const lastTokensEl = document.getElementById("lastTokens");
const sessionTokensEl = document.getElementById("sessionTokens");

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const saveSettings = document.getElementById("saveSettings");
const apiKeyInput = document.getElementById("apiKey");
const baseUrlInput = document.getElementById("baseUrl");
const modelInput = document.getElementById("model");
const languageInput = document.getElementById("language");
const textModelInput = document.getElementById("textModel");
const correctionPromptInput = document.getElementById("correctionPrompt");

const checkUpdateBtn = document.getElementById("checkUpdateBtn");
const updateStatusEl = document.getElementById("updateStatus");
const updateAvailableEl = document.getElementById("updateAvailable");
const updateAvailableTextEl = document.getElementById("updateAvailableText");
const installUpdateBtn = document.getElementById("installUpdateBtn");
const dismissUpdateBtn = document.getElementById("dismissUpdateBtn");
const updateProgressWrap = document.getElementById("updateProgressWrap");
const updateProgressFill = document.getElementById("updateProgressFill");
const updateProgressLabel = document.getElementById("updateProgressLabel");

const themeToggleBtn = document.getElementById("themeToggle");
const historyBtn = document.getElementById("historyBtn");
const historyModal = document.getElementById("historyModal");
const historyListEl = document.getElementById("historyList");
const closeHistory = document.getElementById("closeHistory");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const CANCEL_WINDOW_MS = 1500;

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
  themeToggleBtn.title = theme === "dark" ? "Светлая тема" : "Тёмная тема";
}

function initTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem("theme");
  } catch {}
  if (theme !== "dark" && theme !== "light") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  applyTheme(theme);
}

themeToggleBtn.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  try {
    localStorage.setItem("theme", next);
  } catch {}
  applyTheme(next);
});

initTheme();

let mediaRecorder = null;
let chunks = [];
let isRecording = false;
let isPaused = false;
let recordMode = null; // "replace" | "append"
let currentLanguage = "";
let sessionTokenTotal = 0;
let timerInterval = null;
let recordingStartedAt = 0;
let elapsedBeforePause = 0;

function setStatus(text, busy = false) {
  statusTextEl.textContent = text;
  spinnerEl.hidden = !busy;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startTimer() {
  recordingStartedAt = Date.now();
  elapsedBeforePause = 0;
  timerEl.textContent = "00:00";
  timerEl.classList.remove("paused");
  timerEl.classList.add("active");
  timerInterval = setInterval(() => {
    timerEl.textContent = formatDuration(elapsedBeforePause + (Date.now() - recordingStartedAt));
  }, 250);
}

function pauseTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  elapsedBeforePause += Date.now() - recordingStartedAt;
  timerEl.classList.remove("active");
  timerEl.classList.add("paused");
}

function resumeTimer() {
  recordingStartedAt = Date.now();
  timerEl.classList.remove("paused");
  timerEl.classList.add("active");
  timerInterval = setInterval(() => {
    timerEl.textContent = formatDuration(elapsedBeforePause + (Date.now() - recordingStartedAt));
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerEl.classList.remove("active");
  timerEl.classList.remove("paused");
}

function formatTokens(usage) {
  if (!usage) return "—";
  return usage.estimated ? `≈${usage.total}` : `${usage.total}`;
}

function updateTokenStats(usage) {
  lastTokensEl.textContent = formatTokens(usage);
  sessionTokenTotal += usage?.total || 0;
  sessionTokensEl.textContent = String(sessionTokenTotal);
}

let appVersion = null;
let pendingUpdateAsset = null;

async function refreshVersionLabel() {
  if (!appVersion) {
    appVersion = await window.api.getAppVersion();
  }
  updateStatusEl.textContent = `Текущая версия: ${appVersion}`;
}

async function openSettings() {
  const config = await window.api.getConfig();
  apiKeyInput.value = config.apiKey || "";
  baseUrlInput.value = config.baseUrl || "https://api.polza.ai/v1";
  modelInput.value = config.model || "whisper-1";
  languageInput.value = currentLanguage;
  textModelInput.value = config.textModel || "gpt-4o-mini";
  correctionPromptInput.value = config.correctionPrompt || "";
  updateAvailableEl.hidden = true;
  updateProgressWrap.hidden = true;
  pendingUpdateAsset = null;
  await refreshVersionLabel();
  settingsModal.classList.add("open");
}

settingsBtn.addEventListener("click", openSettings);
closeSettings.addEventListener("click", () => settingsModal.classList.remove("open"));

checkUpdateBtn.addEventListener("click", async () => {
  checkUpdateBtn.disabled = true;
  updateAvailableEl.hidden = true;
  pendingUpdateAsset = null;
  updateStatusEl.textContent = "Проверяем обновления...";
  try {
    const result = await window.api.checkForUpdates();
    if (result.error) {
      updateStatusEl.textContent = `Текущая версия: ${appVersion}. Ошибка проверки: ${result.error}`;
    } else if (result.hasUpdate) {
      updateStatusEl.textContent = `Текущая версия: ${appVersion}`;
      pendingUpdateAsset = result.asset;
      const latest = String(result.latestVersion).replace(/^v/i, "");
      updateAvailableTextEl.textContent = `Доступна версия ${latest}. Файл будет скачан, проверен и приложение перезапустится с обновлением.`;
      updateAvailableEl.hidden = false;
    } else {
      updateStatusEl.textContent = `У вас последняя версия (${appVersion}).`;
    }
  } catch (e) {
    updateStatusEl.textContent = `Текущая версия: ${appVersion}. Ошибка проверки: ${e.message}`;
  } finally {
    checkUpdateBtn.disabled = false;
  }
});

dismissUpdateBtn.addEventListener("click", () => {
  updateAvailableEl.hidden = true;
  pendingUpdateAsset = null;
});

installUpdateBtn.addEventListener("click", async () => {
  if (!pendingUpdateAsset) return;
  installUpdateBtn.disabled = true;
  dismissUpdateBtn.disabled = true;
  updateProgressWrap.hidden = false;
  updateProgressFill.style.width = "0%";
  updateProgressLabel.textContent = "0%";
  updateAvailableTextEl.textContent = "Скачивание обновления...";
  try {
    const result = await window.api.installUpdate(pendingUpdateAsset);
    if (result.ok) {
      updateAvailableTextEl.textContent = "Обновление скачано и проверено. Приложение сейчас перезапустится...";
    } else {
      updateAvailableTextEl.textContent = `Не удалось обновить: ${result.error}`;
      installUpdateBtn.disabled = false;
      dismissUpdateBtn.disabled = false;
    }
  } catch (e) {
    updateAvailableTextEl.textContent = `Не удалось обновить: ${e.message}`;
    installUpdateBtn.disabled = false;
    dismissUpdateBtn.disabled = false;
  }
});

window.api.onUpdateProgress((fraction) => {
  const pct = Math.round(fraction * 100);
  updateProgressFill.style.width = `${pct}%`;
  updateProgressLabel.textContent = `${pct}%`;
});

saveSettings.addEventListener("click", async () => {
  currentLanguage = languageInput.value.trim();
  await window.api.saveConfig({
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim() || "https://api.polza.ai/v1",
    model: modelInput.value.trim() || "whisper-1",
    textModel: textModelInput.value.trim() || "gpt-4o-mini",
    correctionPrompt: correctionPromptInput.value.trim(),
  });
  settingsModal.classList.remove("open");
});

function renderHistory(entries) {
  historyListEl.innerHTML = "";
  if (!entries.length) {
    historyListEl.innerHTML = '<div class="history-empty">Пока пусто</div>';
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "history-item";

    const header = document.createElement("div");
    header.className = "history-item-header";

    const label = document.createElement("span");
    const typeSpan = document.createElement("span");
    typeSpan.className = "history-item-type";
    typeSpan.textContent = entry.type;
    label.appendChild(typeSpan);
    label.appendChild(document.createTextNode(" · " + new Date(entry.timestamp).toLocaleString("ru-RU")));

    const copyEntryBtn = document.createElement("button");
    copyEntryBtn.className = "mini-btn";
    copyEntryBtn.textContent = "Копировать";
    copyEntryBtn.addEventListener("click", () => window.api.copyText(entry.text));

    header.appendChild(label);
    header.appendChild(copyEntryBtn);

    const textDiv = document.createElement("div");
    textDiv.className = "history-item-text";
    textDiv.textContent = entry.text;

    item.appendChild(header);
    item.appendChild(textDiv);
    historyListEl.appendChild(item);
  }
}

historyBtn.addEventListener("click", async () => {
  const entries = await window.api.getHistory();
  renderHistory(entries);
  historyModal.classList.add("open");
});

closeHistory.addEventListener("click", () => historyModal.classList.remove("open"));

clearHistoryBtn.addEventListener("click", async () => {
  const entries = await window.api.clearHistory();
  renderHistory(entries);
});

copyBtn.addEventListener("click", async () => {
  if (!resultEl.value) return;
  await window.api.copyText(resultEl.value);
  copyBtn.textContent = "Скопировано!";
  setTimeout(() => (copyBtn.textContent = "Копировать"), 1200);
});

checkErrorsBtn.addEventListener("click", async () => {
  if (!resultEl.value.trim()) return;
  checkErrorsBtn.disabled = true;
  setStatus("Проверяю текст на ошибки...", true);
  try {
    const { text, usage } = await window.api.correctText(resultEl.value);
    resultEl.value = text;
    setStatus("Ошибки исправлены", false);
    updateTokenStats(usage);
  } catch (err) {
    setStatus("Ошибка: " + (err.message || err), false);
  } finally {
    checkErrorsBtn.disabled = false;
  }
});

async function startRecording(mode) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  recordMode = mode;

  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: "audio/webm" });
    blob.arrayBuffer().then((buf) => schedulePendingSend(buf));
  };

  mediaRecorder.start();
  isRecording = true;
  isPaused = false;

  const activeBtn = mode === "replace" ? recordBtn : appendBtn;
  const otherBtn = mode === "replace" ? appendBtn : recordBtn;
  activeBtn.classList.add("recording");
  activeBtn.textContent = "⏹";
  otherBtn.disabled = true;

  pauseBtn.hidden = false;
  pauseBtn.textContent = "⏸";
  pauseBtn.classList.remove("paused");

  setStatus(
    mode === "replace"
      ? "Идёт запись... нажмите, чтобы остановить"
      : "Идёт дозапись... нажмите, чтобы остановить",
    false
  );
  startTimer();
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
  isRecording = false;
  isPaused = false;
  recordBtn.classList.remove("recording");
  recordBtn.textContent = "🎙";
  appendBtn.classList.remove("recording");
  appendBtn.textContent = "➕";
  recordBtn.disabled = false;
  appendBtn.disabled = false;
  pauseBtn.hidden = true;
  pauseBtn.classList.remove("paused");
  pauseBtn.textContent = "⏸";
  stopTimer();
}

pauseBtn.addEventListener("click", () => {
  if (!mediaRecorder || !isRecording) return;
  if (!isPaused) {
    mediaRecorder.pause();
    pauseTimer();
    isPaused = true;
    pauseBtn.textContent = "▶";
    pauseBtn.classList.add("paused");
    setStatus("Запись на паузе", false);
  } else {
    mediaRecorder.resume();
    resumeTimer();
    isPaused = false;
    pauseBtn.textContent = "⏸";
    pauseBtn.classList.remove("paused");
    setStatus(
      recordMode === "replace"
        ? "Идёт запись... нажмите, чтобы остановить"
        : "Идёт дозапись... нажмите, чтобы остановить",
      false
    );
  }
});

function schedulePendingSend(buffer) {
  let remaining = Math.ceil(CANCEL_WINDOW_MS / 1000);
  cancelSendBtn.hidden = false;
  cancelSendBtn.textContent = `Отменить отправку (${remaining})`;
  setStatus("Можно отменить отправку...", false);
  recordBtn.disabled = true;
  appendBtn.disabled = true;

  const countdown = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) cancelSendBtn.textContent = `Отменить отправку (${remaining})`;
  }, 1000);

  cancelSendBtn.onclick = () => {
    clearTimeout(sendTimer);
    clearInterval(countdown);
    cancelSendBtn.hidden = true;
    cancelSendBtn.onclick = null;
    recordBtn.disabled = false;
    appendBtn.disabled = false;
    setStatus("Отправка отменена", false);
  };

  const sendTimer = setTimeout(() => {
    clearInterval(countdown);
    cancelSendBtn.hidden = true;
    cancelSendBtn.onclick = null;
    sendForTranscription(buffer);
  }, CANCEL_WINDOW_MS);
}

async function sendForTranscription(buffer) {
  const mode = recordMode;
  setStatus("Отправляю на транскрибацию...", true);
  try {
    const { text, usage } = await window.api.transcribe(buffer, currentLanguage, mode);
    if (mode === "append" && resultEl.value.trim()) {
      resultEl.value = `${resultEl.value}\n${text}`;
    } else {
      resultEl.value = text;
    }
    setStatus("Готово", false);
    updateTokenStats(usage);
  } catch (err) {
    setStatus("Ошибка: " + (err.message || err), false);
  } finally {
    recordBtn.disabled = false;
    appendBtn.disabled = false;
  }
}

recordBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording("replace").catch((err) => {
      setStatus("Не удалось получить доступ к микрофону: " + err.message, false);
    });
  }
});

appendBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording("append").catch((err) => {
      setStatus("Не удалось получить доступ к микрофону: " + err.message, false);
    });
  }
});
