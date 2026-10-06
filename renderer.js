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
const lastCostEl = document.getElementById("lastCost");
const sessionCostEl = document.getElementById("sessionCost");
const sessionCostPartialEl = document.getElementById("sessionCostPartial");

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
const resetPromptBtn = document.getElementById("resetPromptBtn");
const autoCorrectInput = document.getElementById("autoCorrect");

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

const stallBox = document.getElementById("stallBox");
const stallTextEl = document.getElementById("stallText");
const stallChangeBtn = document.getElementById("stallChangeBtn");
const stallModelRow = document.getElementById("stallModelRow");
const stallModelInput = document.getElementById("stallModelInput");
const stallSendBtn = document.getElementById("stallSendBtn");

const unfinishedBtn = document.getElementById("unfinishedBtn");
const unfinishedBadge = document.getElementById("unfinishedBadge");
const unfinishedBanner = document.getElementById("unfinishedBanner");
const unfinishedBannerText = document.getElementById("unfinishedBannerText");
const unfinishedBannerOpen = document.getElementById("unfinishedBannerOpen");
const unfinishedModal = document.getElementById("unfinishedModal");
const unfinishedListEl = document.getElementById("unfinishedList");
const closeUnfinished = document.getElementById("closeUnfinished");

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
let autoCorrectEnabled = true;
let defaultPrompt = "";
let sessionCostTotal = 0;
let sessionCostHasUnknown = false;
let timerInterval = null;
let recordingStartedAt = 0;
let elapsedBeforePause = 0;
let lastRecordingDurationMs = 0;

// Незавершённые записи: состояние приходит из main-процесса целиком.
let unfinishedState = { items: [], flights: [] };
let countdownId = null; // запись в окне «Отменить отправку»
let savingRecording = false; // свежая запись пишется на диск, id ещё не известен
let currentSendId = null; // запись, отправку которой ждёт главный экран

async function initLanguage() {
  const config = await window.api.getConfig();
  currentLanguage = config.language || "";
  autoCorrectEnabled = config.autoCorrect !== false;
  defaultPrompt = await window.api.getDefaultPrompt();
}
initLanguage();

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

// cost — число рублей из usage.cost_rub ответа API, либо null, если провайдер
// его не прислал (например, асинхронные aiesa/*-модели). Оценок не делаем —
// в этом случае честно показываем «—», а не выдуманную цифру.
function formatRub(amount) {
  if (amount === 0) return "0 ₽";
  const decimals = Math.abs(amount) < 0.01 ? 4 : 2;
  return `${amount.toFixed(decimals)} ₽`;
}

function updateCostStats(cost) {
  const known = typeof cost === "number" && Number.isFinite(cost);
  lastCostEl.textContent = known ? formatRub(cost) : "—";
  if (known) {
    sessionCostTotal += cost;
  } else {
    sessionCostHasUnknown = true;
  }
  sessionCostEl.textContent = formatRub(sessionCostTotal);
  sessionCostPartialEl.hidden = !sessionCostHasUnknown;
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
  languageInput.value = config.language || "";
  textModelInput.value = config.textModel || "gpt-4o-mini";
  // Пустое значение в конфиге означает «использовать дефолт» — показываем именно его,
  // иначе поле выглядит пустым и кажется, что промпт потерялся.
  if (!defaultPrompt) {
    defaultPrompt = await window.api.getDefaultPrompt();
  }
  correctionPromptInput.value = config.correctionPrompt || defaultPrompt;
  autoCorrectInput.checked = config.autoCorrect !== false;
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
      updateAvailableTextEl.textContent = result.asset.manual
        ? `Доступна версия ${latest}. Загрузка .dmg откроется в браузере — перетащите новую версию в «Программы» с заменой.`
        : `Доступна версия ${latest}. Файл будет скачан, проверен и приложение перезапустится с обновлением.`;
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
  if (pendingUpdateAsset.manual) {
    const result = await window.api.installUpdate(pendingUpdateAsset);
    updateAvailableTextEl.textContent = result.ok
      ? "Загрузка открыта в браузере. Закройте приложение, откройте .dmg и перетащите Prikaz golosom в «Программы» с заменой."
      : `Не удалось открыть загрузку: ${result.error}`;
    installUpdateBtn.disabled = false;
    dismissUpdateBtn.disabled = false;
    return;
  }
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

resetPromptBtn.addEventListener("click", async () => {
  if (!defaultPrompt) {
    defaultPrompt = await window.api.getDefaultPrompt();
  }
  correctionPromptInput.value = defaultPrompt;
  resetPromptBtn.textContent = "Восстановлен";
  setTimeout(() => (resetPromptBtn.textContent = "Восстановить"), 1200);
});

saveSettings.addEventListener("click", async () => {
  currentLanguage = languageInput.value.trim();
  autoCorrectEnabled = autoCorrectInput.checked;
  await window.api.saveConfig({
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim() || "https://api.polza.ai/v1",
    model: modelInput.value.trim() || "whisper-1",
    textModel: textModelInput.value.trim() || "gpt-4o-mini",
    correctionPrompt: correctionPromptInput.value.trim(),
    autoCorrect: autoCorrectEnabled,
    language: currentLanguage,
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
    const { text, cost } = await window.api.correctText(resultEl.value);
    resultEl.value = text;
    setStatus("Ошибки исправлены", false);
    updateCostStats(cost);
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

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: "audio/webm" });
    try {
      // Сначала на диск, потом всё остальное: с этого момента запись не
      // теряется ни при ошибке, ни при закрытии приложения.
      const buf = await blob.arrayBuffer();
      savingRecording = true;
      const id = await window.api.saveRecording(buf, lastRecordingDurationMs, mode, currentLanguage);
      savingRecording = false;
      schedulePendingSend(id);
    } catch (err) {
      savingRecording = false;
      setStatus("Не удалось сохранить запись: " + (err.message || err), false);
      recordBtn.disabled = false;
      appendBtn.disabled = false;
    }
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
  lastRecordingDurationMs =
    elapsedBeforePause + (isPaused ? 0 : Date.now() - recordingStartedAt);
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

function schedulePendingSend(id) {
  countdownId = id;
  renderUnfinished();
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
    countdownId = null;
    window.api.discardRecording(id);
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
    countdownId = null;
    sendForTranscription(id);
  }, CANCEL_WINDOW_MS);
}

// Правим только что расшифрованный фрагмент, а не всё поле: иначе уже исправленный
// текст уходил бы на модель повторно — лишние деньги и риск, что его перепишут заново.
// Сырой текст к этому моменту уже в поле, поэтому ошибка автоправки его не теряет.
async function autoCorrectFragment(fragment) {
  if (!autoCorrectEnabled || !fragment || !fragment.trim()) return;
  checkErrorsBtn.disabled = true;
  setStatus("Исправляю ошибки...", true);
  try {
    const { text, cost } = await window.api.correctText(fragment);
    const at = resultEl.value.lastIndexOf(fragment);
    if (at === -1) {
      // Пользователь успел поправить текст руками — не трогаем, он главнее.
      setStatus("Готово (текст изменён вручную, автоправка пропущена)", false);
      return;
    }
    resultEl.value =
      resultEl.value.slice(0, at) + text + resultEl.value.slice(at + fragment.length);
    setStatus("Готово, ошибки исправлены", false);
    updateCostStats(cost);
  } catch (err) {
    setStatus(
      "Текст получен, но автоисправление не удалось: " + (err.message || err),
      false
    );
  } finally {
    checkErrorsBtn.disabled = false;
  }
}

function insertTranscript(text, mode) {
  if (mode === "append" && resultEl.value.trim()) {
    resultEl.value = `${resultEl.value}\n${text}`;
  } else {
    resultEl.value = text;
  }
}

async function sendForTranscription(id) {
  currentSendId = id;
  setStatus("Отправляю на транскрибацию...", true);
  const ticker = setInterval(refreshSendingStatus, 1000);
  try {
    // Резолвится всегда, даже если модель меняли посреди отправки: main
    // передаёт сюда итог последнего запроса по этой записи.
    const outcome = await window.api.sendRecording(id);
    if (outcome.ok) {
      insertTranscript(outcome.text, outcome.mode);
      setStatus("Готово", false);
      updateCostStats(outcome.cost);
      await autoCorrectFragment(outcome.text);
    } else if (outcome.cancelled) {
      setStatus("Отправка отменена: запись удалена", false);
    } else {
      setStatus(`Ошибка: ${outcome.error} Запись сохранена в «Незавершённых» 📥`, false);
    }
  } catch (err) {
    setStatus("Ошибка: " + (err.message || err), false);
  } finally {
    clearInterval(ticker);
    currentSendId = null;
    hideStallBox();
    recordBtn.disabled = false;
    appendBtn.disabled = false;
    renderUnfinished();
  }
}

// ---- Зависшая отправка: «Сменить модель» ----

function flightOf(id) {
  return unfinishedState.flights.find((f) => f.id === id) || null;
}

function secondsSince(ts) {
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function hideStallBox() {
  stallBox.hidden = true;
  stallModelRow.hidden = true;
  stallChangeBtn.hidden = false;
}

function refreshSendingStatus() {
  if (!currentSendId) return;
  const flight = flightOf(currentSendId);
  if (!flight) return;
  const elapsed = secondsSince(flight.startedAt);
  setStatus(`Отправляю на транскрибацию (модель «${flight.model}»)... ${elapsed} с`, true);
  if (flight.stalled) {
    stallTextEl.textContent = `Ответа нет уже ${elapsed} с. Можно отправить эту же запись другой моделью.`;
    stallBox.hidden = false;
  } else {
    hideStallBox();
  }
}

stallChangeBtn.addEventListener("click", () => {
  const flight = currentSendId && flightOf(currentSendId);
  stallModelInput.value = flight ? flight.model : "";
  stallChangeBtn.hidden = true;
  stallModelRow.hidden = false;
  stallModelInput.focus();
  stallModelInput.select();
});

function resendCurrentWithModel() {
  const model = stallModelInput.value.trim();
  if (!currentSendId || !model) return;
  // Итог придёт в уже ожидающий sendForTranscription — старый запрос main обрывает.
  window.api.sendRecording(currentSendId, model);
  hideStallBox();
}

stallSendBtn.addEventListener("click", resendCurrentWithModel);
stallModelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") resendCurrentWithModel();
});

// ---- Незавершённые записи ----

// Требуют внимания: всё, кроме записей, которые прямо сейчас нормально
// отправляются или ждут окончания «Отменить отправку». Здоровая отправка
// длится секунды — баннер не должен мигать на каждую диктовку.
function needsAttention() {
  return unfinishedState.items.filter((item) => {
    const flight = flightOf(item.id);
    if (flight) return flight.stalled;
    if (savingRecording && item.status === "pending" && !item.attempts) return false;
    return item.id !== countdownId;
  });
}

function pluralRecords(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "незавершённая запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "незавершённые записи";
  return "незавершённых записей";
}

function renderBanner() {
  const count = needsAttention().length;
  unfinishedBadge.hidden = count === 0;
  unfinishedBadge.textContent = String(count);
  unfinishedBanner.hidden = count === 0;
  unfinishedBannerText.textContent =
    `⚠ У вас ${count} ${pluralRecords(count)}. Аудио сохранено — их можно прослушать и отправить заново.`;
}

// Раскрытые поля ввода модели переживают перерисовку списка.
const modelDrafts = new Map();
let playing = null; // { id, audio, url }
let defaultModel = "whisper-1";

function stopPlayback() {
  if (!playing) return;
  playing.audio.pause();
  URL.revokeObjectURL(playing.url);
  playing = null;
}

async function togglePlayback(id) {
  const wasSame = playing && playing.id === id;
  stopPlayback();
  if (!wasSame) {
    try {
      const data = await window.api.getUnfinishedAudio(id);
      const url = URL.createObjectURL(new Blob([data], { type: "audio/webm" }));
      const audio = new Audio(url);
      playing = { id, audio, url };
      audio.onended = () => {
        stopPlayback();
        renderUnfinished();
      };
      await audio.play();
    } catch (err) {
      stopPlayback();
      alert("Не удалось воспроизвести запись: " + (err.message || err));
    }
  }
  renderUnfinished();
}

function sinceSpan(ts) {
  const span = document.createElement("span");
  span.dataset.since = String(ts);
  span.textContent = String(secondsSince(ts));
  return span;
}

function buildItemStatus(item) {
  const el = document.createElement("div");
  el.className = "unfinished-status";
  const flight = flightOf(item.id);
  if (flight) {
    el.classList.add(flight.stalled ? "stalled" : "busy");
    el.append(
      flight.stalled ? "Нет ответа " : "Отправляется ",
      sinceSpan(flight.startedAt),
      ` с — модель «${flight.model}»`
    );
  } else if (item.id === countdownId) {
    el.classList.add("busy");
    el.textContent = "Ожидает отправки";
  } else {
    el.classList.add("error");
    el.textContent = item.lastError ? `Ошибка: ${item.lastError}` : "Не отправлена";
  }
  return el;
}

async function resendFromList(item, model) {
  modelDrafts.delete(item.id);
  const promise = window.api.sendRecording(item.id, model);
  renderUnfinished();
  const outcome = await promise;
  // Свежую запись главного экрана обрабатывает её собственный sendForTranscription.
  if (item.id === currentSendId) return;
  if (outcome.ok) {
    // Дописываем, а не заменяем: пользователь мог уже работать с текстом в поле.
    insertTranscript(outcome.text, "append");
    updateCostStats(outcome.cost);
    setStatus("Незавершённая запись расшифрована — текст добавлен в поле и в историю", false);
    await autoCorrectFragment(outcome.text);
  }
}

function openModelInput(item) {
  if (!modelDrafts.has(item.id)) {
    const flight = flightOf(item.id);
    const last = item.triedModels && item.triedModels[item.triedModels.length - 1];
    modelDrafts.set(item.id, (flight && flight.model) || last || defaultModel);
  }
  renderUnfinished();
  const input = unfinishedListEl.querySelector(`input[data-model-for="${item.id}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

function buildModelRow(item) {
  const row = document.createElement("div");
  row.className = "model-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Название модели";
  input.value = modelDrafts.get(item.id);
  input.dataset.modelFor = item.id;
  input.addEventListener("input", () => modelDrafts.set(item.id, input.value));
  const go = document.createElement("button");
  go.className = "mini-btn";
  go.textContent = "Отправить";
  const submit = () => {
    const model = input.value.trim();
    if (model) resendFromList(item, model);
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      modelDrafts.delete(item.id);
      renderUnfinished();
    }
  });
  row.append(input, go);
  return row;
}

function renderUnfinished() {
  renderBanner();
  if (!unfinishedModal.classList.contains("open")) return;

  const focusedId = document.activeElement?.dataset?.modelFor ?? null;
  unfinishedListEl.innerHTML = "";
  if (!unfinishedState.items.length) {
    unfinishedListEl.innerHTML = '<div class="history-empty">Незавершённых записей нет</div>';
    return;
  }

  for (const item of unfinishedState.items) {
    const flight = flightOf(item.id);
    const inCountdown = item.id === countdownId;
    const el = document.createElement("div");
    el.className = "unfinished-item";

    const meta = document.createElement("div");
    meta.className = "unfinished-meta";
    const when = document.createElement("b");
    when.textContent = new Date(item.createdAt).toLocaleString("ru-RU");
    const models = item.triedModels && item.triedModels.length ? item.triedModels.join(", ") : "—";
    meta.append(
      when,
      ` · длительность ${item.durationMs ? formatDuration(item.durationMs) : "—"}` +
        ` · попыток: ${item.attempts || 0} · модели: ${models}`
    );

    const actions = document.createElement("div");
    actions.className = "unfinished-actions";

    const playBtn = document.createElement("button");
    playBtn.className = "mini-btn";
    playBtn.textContent = playing && playing.id === item.id ? "⏹ Стоп" : "▶ Прослушать";
    playBtn.addEventListener("click", () => togglePlayback(item.id));

    const sendBtn = document.createElement("button");
    sendBtn.className = "mini-btn";
    sendBtn.textContent = flight ? "Сменить модель…" : "Отправить заново…";
    sendBtn.disabled = inCountdown;
    sendBtn.addEventListener("click", () => openModelInput(item));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "mini-btn danger";
    deleteBtn.textContent = "Удалить";
    deleteBtn.disabled = inCountdown;
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Удалить запись вместе с аудио? Восстановить её будет нельзя.")) return;
      if (playing && playing.id === item.id) stopPlayback();
      modelDrafts.delete(item.id);
      unfinishedState = await window.api.deleteUnfinished(item.id);
      renderUnfinished();
    });

    actions.append(playBtn, sendBtn, deleteBtn);
    el.append(meta, buildItemStatus(item), actions);
    if (modelDrafts.has(item.id)) el.append(buildModelRow(item));
    unfinishedListEl.appendChild(el);
  }

  if (focusedId) {
    unfinishedListEl.querySelector(`input[data-model-for="${focusedId}"]`)?.focus();
  }
}

// Секунды «отправляется / нет ответа» тикают без перерисовки списка,
// чтобы не сбивать ввод названия модели.
setInterval(() => {
  for (const span of unfinishedListEl.querySelectorAll("span[data-since]")) {
    span.textContent = String(secondsSince(Number(span.dataset.since)));
  }
}, 1000);

async function openUnfinished() {
  try {
    defaultModel = (await window.api.getConfig()).model || defaultModel;
  } catch {}
  unfinishedState = await window.api.listUnfinished();
  unfinishedModal.classList.add("open");
  renderUnfinished();
}

unfinishedBtn.addEventListener("click", openUnfinished);
unfinishedBannerOpen.addEventListener("click", openUnfinished);
closeUnfinished.addEventListener("click", () => {
  unfinishedModal.classList.remove("open");
  modelDrafts.clear();
  stopPlayback();
});

window.api.onUnfinishedChanged((state) => {
  unfinishedState = state;
  refreshSendingStatus();
  renderUnfinished();
});

window.api.listUnfinished().then((state) => {
  unfinishedState = state;
  renderUnfinished();
});

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
