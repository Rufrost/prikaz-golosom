const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");

// Через сколько без ответа запрос считается зависшим (появляется «Сменить модель»).
const STALL_AFTER_MS = 5_000;

// Потолок на запрос транскрибации: минута всегда, плюс секунда на каждые 2 секунды
// аудио сверх первой минуты, но не больше 5 минут. Плоский лимит гарантированно
// убивал бы длинные диктовки, которые сервер честно расшифровывает дольше минуты.
function transcriptionTimeoutMs(durationMs) {
  const seconds = Math.floor((durationMs || 0) / 1000);
  const extra = Math.floor(Math.max(0, seconds - 60) / 2);
  return Math.min(60 + extra, 300) * 1000;
}

/**
 * Очередь незавершённых записей на диске: аудиофайлы в <userData>/recordings,
 * метаданные — в <userData>/unfinished.json.
 *
 * Запись попадает сюда сразу после остановки (ещё до окна «Отменить отправку»)
 * и удаляется только в двух случаях: успешная расшифровка или ручное удаление
 * (в т.ч. «Отменить отправку»). Неудача, таймаут, закрытие приложения — файл цел.
 */
class UnfinishedQueue {
  constructor(baseDir, onChange) {
    this.dir = path.join(baseDir, "recordings");
    this.indexPath = path.join(baseDir, "unfinished.json");
    this.onChange = onChange;
    fs.mkdirSync(this.dir, { recursive: true });
    this.items = this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  // Через временный файл + rename: если процесс умрёт посреди записи, старый
  // unfinished.json останется целым, а не обрезанным.
  _save() {
    const tmp = `${this.indexPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2), "utf-8");
    fs.renameSync(tmp, this.indexPath);
    this.onChange?.();
  }

  filePath(item) {
    return path.join(this.dir, item.file);
  }

  get(id) {
    return this.items.find((it) => it.id === id) ?? null;
  }

  /** Незавершённые записи с живым файлом, новые сверху. */
  list() {
    return this.items
      .filter((it) => fs.existsSync(this.filePath(it)))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  add({ buffer, durationMs, mode, language }) {
    const createdAt = Date.now();
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    const file = `rec-${id}.webm`;
    fs.writeFileSync(path.join(this.dir, file), Buffer.from(buffer));
    this.items.push({
      id,
      createdAt,
      file,
      durationMs: durationMs || 0,
      mode: mode === "append" ? "append" : "replace",
      language: language || "",
      status: "pending",
      attempts: 0,
      triedModels: [],
      lastError: null,
    });
    this._save();
    return id;
  }

  update(id, fn) {
    const index = this.items.findIndex((it) => it.id === id);
    if (index === -1) return null;
    this.items[index] = fn(this.items[index]);
    this._save();
    return this.items[index];
  }

  remove(id) {
    const item = this.get(id);
    if (!item) return;
    try {
      fs.unlinkSync(this.filePath(item));
    } catch {}
    this.items = this.items.filter((it) => it.id !== id);
    this._save();
  }

  /**
   * Приведение в честное состояние при старте, до любых отправок:
   *  - «pending» в только что запущенном процессе — заведомо мёртвая отправка
   *    (приложение закрыли или компьютер выключили посреди запроса);
   *  - файлы без записи в индексе (индекс повреждён или потерян) — в очередь;
   *  - записи, чей файл пропал, — выбрасываем, спасать там нечего.
   */
  recover() {
    let changed = false;
    for (const item of this.items) {
      if (item.status === "pending") {
        item.status = "failed";
        item.lastError = "Отправка прервана: приложение было закрыто до получения ответа.";
        changed = true;
      }
    }

    const before = this.items.length;
    this.items = this.items.filter((it) => fs.existsSync(this.filePath(it)));
    if (this.items.length !== before) changed = true;

    const known = new Set(this.items.map((it) => it.file.toLowerCase()));
    for (const name of fs.readdirSync(this.dir)) {
      if (known.has(name.toLowerCase())) continue;
      const full = path.join(this.dir, name);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (stat.size === 0) {
        fs.unlinkSync(full);
        continue;
      }
      const match = /^rec-(\d+)/.exec(name);
      this.items.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: match ? Number(match[1]) : stat.mtimeMs,
        file: name,
        durationMs: 0,
        mode: "replace",
        language: "",
        status: "failed",
        attempts: 0,
        triedModels: [],
        lastError: "Файл записи найден при запуске, сведений о его отправке нет.",
      });
      changed = true;
    }

    if (changed) this._save();
  }
}

/**
 * Единственное место, где запись уходит на расшифровку: и свежая, и повторная
 * из списка незавершённых.
 *
 * Гарантии:
 *  - у каждой отправки ровно один финал (успех / ошибка / отмена), промис send()
 *    всегда резолвится — индикатор в окне не может «залипнуть»;
 *  - повторная отправка той же записи (смена модели) по-настоящему обрывает
 *    висящий запрос, а все, кто ждал первый, получат итог нового;
 *  - при неудаче файл остаётся в очереди с текстом ошибки.
 */
class TranscriptSender {
  constructor({ queue, loadConfig, defaultBaseUrl, extractCostRub, onSuccess, onChange }) {
    this.queue = queue;
    this.loadConfig = loadConfig;
    this.defaultBaseUrl = defaultBaseUrl;
    this.extractCostRub = extractCostRub;
    this.onSuccess = onSuccess;
    this.onChange = onChange;
    this.flights = new Map();
  }

  /** Отправки в полёте — для окна: какая модель, с какого времени, зависла ли. */
  info() {
    return [...this.flights.values()].map((f) => ({
      id: f.id,
      model: f.model,
      startedAt: f.startedAt,
      stalled: f.stalled,
    }));
  }

  send(id, model) {
    const previous = this.flights.get(id);
    return new Promise((resolve) => {
      const waiters = previous ? previous.waiters : [];
      waiters.push(resolve);
      if (previous) this._abort(previous);

      const flight = {
        id,
        model: String(model || "").trim(),
        startedAt: Date.now(),
        stalled: false,
        controller: new AbortController(),
        waiters,
        timers: [],
      };
      this.flights.set(id, flight);
      this.onChange?.();
      this._run(flight);
    });
  }

  /** Отмена без записи ошибки — перед ручным удалением записи. */
  cancel(id) {
    const flight = this.flights.get(id);
    if (!flight) return;
    this.flights.delete(id);
    this._abort(flight);
    this.onChange?.();
    for (const resolve of flight.waiters) resolve({ ok: false, cancelled: true, id });
  }

  _abort(flight) {
    flight.timers.forEach(clearTimeout);
    flight.controller.abort();
  }

  _isCurrent(flight) {
    return this.flights.get(flight.id) === flight;
  }

  async _run(flight) {
    const item = this.queue.get(flight.id);
    if (!item || !fs.existsSync(this.queue.filePath(item))) {
      this._finish(flight, { ok: false, error: "Файл записи не найден — отправлять нечего." });
      return;
    }

    const config = this.loadConfig();
    if (!flight.model) flight.model = config.model;

    this.queue.update(item.id, (it) => ({
      ...it,
      status: "pending",
      lastError: null,
      attempts: (it.attempts || 0) + 1,
      triedModels: [...new Set([...(it.triedModels || []), flight.model])],
    }));

    if (!config.apiKey) {
      this._finish(flight, {
        ok: false,
        error: "Не задан API-ключ polza.ai. Откройте настройки и укажите ключ.",
      });
      return;
    }

    const timeoutMs = transcriptionTimeoutMs(item.durationMs);
    let timedOut = false;
    flight.timers.push(
      setTimeout(() => {
        if (!this._isCurrent(flight)) return;
        flight.stalled = true;
        this.onChange?.();
      }, STALL_AFTER_MS),
      setTimeout(() => {
        timedOut = true;
        flight.controller.abort();
      }, timeoutMs)
    );

    let outcome;
    try {
      // maxRetries: 0 — таймаут должен быть потолком на всю отправку, а не на
      // одну из трёх попыток SDK; повторять пользователь теперь может сам.
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || this.defaultBaseUrl,
        maxRetries: 0,
        timeout: timeoutMs + 5_000,
      });
      const transcription = await client.audio.transcriptions.create(
        {
          file: fs.createReadStream(this.queue.filePath(item)),
          model: flight.model,
          ...(item.language ? { language: item.language } : {}),
        },
        { signal: flight.controller.signal }
      );
      outcome = {
        ok: true,
        text: transcription.text,
        cost: this.extractCostRub(transcription.usage),
      };
    } catch (e) {
      if (timedOut) {
        outcome = {
          ok: false,
          error: `Сервер не ответил за ${Math.round(timeoutMs / 1000)} с (таймаут).`,
        };
      } else {
        outcome = { ok: false, error: e?.message || String(e) };
      }
    } finally {
      flight.timers.forEach(clearTimeout);
    }
    this._finish(flight, outcome);
  }

  _finish(flight, outcome) {
    // Запрос успели заменить (смена модели) или отменить (удаление) — итог
    // устаревшего запроса выбрасываем, его ждущие уже переданы новому.
    if (!this._isCurrent(flight)) return;
    this.flights.delete(flight.id);

    const item = this.queue.get(flight.id);
    if (outcome.ok) {
      try {
        this.onSuccess?.(item, outcome);
      } catch {}
      this.queue.remove(flight.id);
    } else {
      this.queue.update(flight.id, (it) => ({ ...it, status: "failed", lastError: outcome.error }));
    }
    this.onChange?.();
    for (const resolve of flight.waiters) {
      resolve({ ...outcome, id: flight.id, mode: item?.mode ?? "replace" });
    }
  }
}

module.exports = { UnfinishedQueue, TranscriptSender, transcriptionTimeoutMs, STALL_AFTER_MS };
