const recordBtn = document.getElementById("recordBtn");
const appendBtn = document.getElementById("appendBtn");
const timerEl = document.getElementById("timer");
const cancelSendBtn = document.getElementById("cancelSendBtn");
const statusEl = document.getElementById("status");
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

const CANCEL_WINDOW_MS = 1500;

let mediaRecorder = null;
let chunks = [];
let isRecording = false;
let recordMode = null; // "replace" | "append"
let currentLanguage = "";
let sessionTokenTotal = 0;
let timerInterval = null;
let recordingStartedAt = 0;

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startTimer() {
  recordingStartedAt = Date.now();
  timerEl.textContent = "00:00";
  timerEl.classList.add("active");
  timerInterval = setInterval(() => {
    timerEl.textContent = formatDuration(Date.now() - recordingStartedAt);
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerEl.classList.remove("active");
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

async function openSettings() {
  const config = await window.api.getConfig();
  apiKeyInput.value = config.apiKey || "";
  baseUrlInput.value = config.baseUrl || "https://api.polza.ai/v1";
  modelInput.value = config.model || "whisper-1";
  languageInput.value = currentLanguage;
  textModelInput.value = config.textModel || "gpt-4o-mini";
  correctionPromptInput.value = config.correctionPrompt || "";
  settingsModal.classList.add("open");
}

settingsBtn.addEventListener("click", openSettings);
closeSettings.addEventListener("click", () => settingsModal.classList.remove("open"));

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

copyBtn.addEventListener("click", async () => {
  if (!resultEl.value) return;
  await window.api.copyText(resultEl.value);
  copyBtn.textContent = "Скопировано!";
  setTimeout(() => (copyBtn.textContent = "Копировать"), 1200);
});

checkErrorsBtn.addEventListener("click", async () => {
  if (!resultEl.value.trim()) return;
  checkErrorsBtn.disabled = true;
  statusEl.textContent = "Проверяю текст на ошибки...";
  try {
    const { text, usage } = await window.api.correctText(resultEl.value);
    resultEl.value = text;
    statusEl.textContent = "Ошибки исправлены";
    updateTokenStats(usage);
  } catch (err) {
    statusEl.textContent = "Ошибка: " + (err.message || err);
  } finally {
    checkErrorsBtn.disabled = false;
  }
});

async function startRecording(mode) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  recordMode = mode;
  if (mode === "replace") resultEl.value = "";

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

  const activeBtn = mode === "replace" ? recordBtn : appendBtn;
  const otherBtn = mode === "replace" ? appendBtn : recordBtn;
  activeBtn.classList.add("recording");
  activeBtn.textContent = "⏹";
  otherBtn.disabled = true;

  statusEl.textContent =
    mode === "replace"
      ? "Идёт запись... нажмите, чтобы остановить"
      : "Идёт дозапись... нажмите, чтобы остановить";
  startTimer();
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.classList.remove("recording");
  recordBtn.textContent = "🎙";
  appendBtn.classList.remove("recording");
  appendBtn.textContent = "➕";
  recordBtn.disabled = false;
  appendBtn.disabled = false;
  stopTimer();
}

function schedulePendingSend(buffer) {
  let remaining = Math.ceil(CANCEL_WINDOW_MS / 1000);
  cancelSendBtn.hidden = false;
  cancelSendBtn.textContent = `Отменить отправку (${remaining})`;
  statusEl.textContent = "Можно отменить отправку...";
  recordBtn.disabled = true;
  appendBtn.disabled = true;

  const countdown = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) cancelSendBtn.textContent = `Отменить отправку (${remaining})`;
  }, 1000);

  const cleanup = () => {
    clearInterval(countdown);
    cancelSendBtn.hidden = true;
    cancelSendBtn.onclick = null;
    recordBtn.disabled = false;
    appendBtn.disabled = false;
  };

  cancelSendBtn.onclick = () => {
    clearTimeout(sendTimer);
    cleanup();
    statusEl.textContent = "Отправка отменена";
  };

  const sendTimer = setTimeout(() => {
    cleanup();
    sendForTranscription(buffer);
  }, CANCEL_WINDOW_MS);
}

async function sendForTranscription(buffer) {
  const mode = recordMode;
  statusEl.textContent = "Отправляю на транскрибацию...";
  try {
    const { text, usage } = await window.api.transcribe(buffer, currentLanguage);
    if (mode === "append" && resultEl.value.trim()) {
      resultEl.value = `${resultEl.value}\n${text}`;
    } else {
      resultEl.value = text;
    }
    statusEl.textContent = "Готово";
    updateTokenStats(usage);
  } catch (err) {
    statusEl.textContent = "Ошибка: " + (err.message || err);
  }
}

recordBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording("replace").catch((err) => {
      statusEl.textContent = "Не удалось получить доступ к микрофону: " + err.message;
    });
  }
});

appendBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording("append").catch((err) => {
      statusEl.textContent = "Не удалось получить доступ к микрофону: " + err.message;
    });
  }
});
