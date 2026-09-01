const recordBtn = document.getElementById("recordBtn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const copyBtn = document.getElementById("copyBtn");

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const saveSettings = document.getElementById("saveSettings");
const apiKeyInput = document.getElementById("apiKey");
const baseUrlInput = document.getElementById("baseUrl");
const modelInput = document.getElementById("model");
const languageInput = document.getElementById("language");

let mediaRecorder = null;
let chunks = [];
let isRecording = false;
let currentLanguage = "";

async function openSettings() {
  const config = await window.api.getConfig();
  apiKeyInput.value = config.apiKey || "";
  baseUrlInput.value = config.baseUrl || "https://api.polza.ai/v1";
  modelInput.value = config.model || "whisper-1";
  languageInput.value = currentLanguage;
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
  });
  settingsModal.classList.remove("open");
});

copyBtn.addEventListener("click", async () => {
  if (!resultEl.value) return;
  await navigator.clipboard.writeText(resultEl.value);
  copyBtn.textContent = "Скопировано!";
  setTimeout(() => (copyBtn.textContent = "Копировать"), 1200);
});

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();

    statusEl.textContent = "Отправляю на транскрибацию...";
    try {
      const text = await window.api.transcribe(arrayBuffer, currentLanguage);
      resultEl.value = text;
      statusEl.textContent = "Готово";
    } catch (err) {
      statusEl.textContent = "Ошибка: " + (err.message || err);
    }
  };

  mediaRecorder.start();
  isRecording = true;
  recordBtn.classList.add("recording");
  recordBtn.textContent = "⏹";
  statusEl.textContent = "Идёт запись... нажмите, чтобы остановить";
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.classList.remove("recording");
  recordBtn.textContent = "🎙";
}

recordBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    resultEl.value = "";
    startRecording().catch((err) => {
      statusEl.textContent = "Не удалось получить доступ к микрофону: " + err.message;
    });
  }
});
