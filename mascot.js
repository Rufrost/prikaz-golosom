// Маскот: персонаж в окне записи, который смотрит на пользователя и «слушает».
// Подключается в index.html до renderer.js, наружу отдаёт window.Mascot.
(() => {
  // ---------- Общие помощники ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Плавное приближение к цели, не зависящее от частоты кадров.
  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  let uid = 0;

  // Глаз: белок, «look»-группа со зрачком (сдвигается взглядом), верхнее и нижнее веко,
  // обрезанные по форме глаза. Веки рисуются цветом кожи персонажа.
  // Детерминированный ГСЧ: у каждого глаза свой постоянный рисунок венок.
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Венки усталости: всегда одни и те же 7 тонких извилистых жилок на глаз (как у Towelie).
  // Число не меняется — с усталостью они все вместе проявляются из прозрачности.
  function veins(cx, cy, rx, ry, seed) {
    const r = seeded(seed);
    const P = (a, k, off) => {
      // Точка на «радиусе» под углом a, сдвинутая поперёк него на off — даёт волну.
      const x = cx + rx * (k * Math.cos(a) - off * Math.sin(a));
      const y = cy + ry * (k * Math.sin(a) + off * Math.cos(a));
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    };
    const w = Math.max(0.3, rx * 0.025).toFixed(2);
    // Больше у уголков (слева/справа), меньше сверху и снизу; по кругу, без пересечений.
    const bases = [0.1, -0.6, 0.75, 1.5, Math.PI - 0.15, Math.PI + 0.65, Math.PI - 0.85].map((a) => a + (r() - 0.5) * 0.3);
    let out = "";
    for (const a of bases) {
      const amp = 0.04 + r() * 0.03;
      const sgn = r() < 0.5 ? -1 : 1;
      // Жилки живут на внешней части белка и не доходят до радужки.
      const end = 0.6 + r() * 0.12;
      const k = [1.05, 0.93, 0.82, end + 0.05, end];
      // Волнистая линия: Q + цепочка T, контрольные точки поочерёдно по разные стороны.
      let d = `M${P(a, k[0], 0)} Q${P(a, (k[0] + k[1]) / 2, amp * sgn)} ${P(a, k[1], 0)}`;
      d += ` T${P(a, k[2], 0)} T${P(a, k[3], 0)}`;
      // Короткая веточка из середины.
      const bs = r() < 0.5 ? -1 : 1;
      const branch = `M${P(a, 0.9, 0)} Q${P(a, 0.84, bs * 0.08)} ${P(a, 0.76, bs * 0.14)}`;
      out += `<path d="${d}" stroke-width="${w}"/><path d="${branch}" stroke-width="${(w * 0.75).toFixed(2)}"/>`;
    }
    return `<g class="veins" opacity="0" stroke="#e0605a" fill="none" stroke-linecap="round" stroke-linejoin="round">${out}</g>`;
  }

  function eye({ cx, cy, rx, ry, white, ink, iris, irisR, prx, pry, lid, stroke, happyInk }) {
    const n = uid++;
    const id = `clip${n}`;
    const rg = `strain${n}`;
    return `
    <g class="eye" data-cx="${cx}" data-cy="${cy}" data-rx="${rx}" data-ry="${ry}">
      <g class="open">
      <clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
      <radialGradient id="${rg}">
        <stop offset="0" stop-color="#f6bfca"/>
        <stop offset="0.75" stop-color="#f2adbb"/>
        <stop offset="1" stop-color="#e48d9f"/>
      </radialGradient>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${white}"/>
      <g clip-path="url(#${id})">
        <ellipse class="strain-tint" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${rg})" opacity="0"/>
        ${veins(cx, cy, rx, ry, n * 7919 + 13)}
        <g class="look">
          ${iris ? `<circle cx="${cx}" cy="${cy}" r="${irisR}" fill="${iris}"/>` : ""}
          <ellipse class="pupil" cx="${cx}" cy="${cy}" rx="${prx}" ry="${pry}" fill="${ink}"/>
          <circle cx="${cx + prx * 0.45}" cy="${cy - pry * 0.45}" r="${Math.max(1.3, prx * 0.32)}" fill="#fff" opacity=".9"/>
        </g>
        <rect class="lid-top" x="${cx - rx - 1}" y="${cy - ry - 1}" width="${2 * rx + 2}" height="0" fill="${lid}"/>
        <rect class="lid-bot" x="${cx - rx - 1}" y="${cy + ry + 1}" width="${2 * rx + 2}" height="0" fill="${lid}"/>
      </g>
      ${stroke ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${stroke}" stroke-width="1.5"/>` : ""}
      </g>
      <path class="happy" d="M${cx - rx * 0.8} ${cy + ry * 0.25} Q${cx} ${cy - ry * 0.9} ${cx + rx * 0.8} ${cy + ry * 0.25}"
        stroke="${happyInk || ink}" stroke-width="${Math.max(2.6, rx * 0.26)}" fill="none" stroke-linecap="round" opacity="0"/>
    </g>`;
  }

  // Вертикальный градиент «свет сверху» — как у капли, даёт мягкий объём.
  function vgrad(id, top, bottom) {
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  }
  // Зеркалим контур левого уха в правое: x → 120 − x (во всех парах «x y»).
  const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(120 - x).toFixed(2)} ${y}`);

  // ---------- Персонажи ----------
  const CHARACTERS = [
    {
      key: "owl",
      name: "Сова",
      ack: ["nod", "nod", "tilt"],
      svg: () => {
        const n = uid++;
        // Кисточки: плавный контур со скруглённым кончиком, а не треугольник.
        const tuft = "M24 46 C23 34 26 22 31 15 C32.5 12.8 35.2 12.6 36.6 14.6 C40 20 44.5 25.5 50 31 Z";
        return `
        <defs>
          ${vgrad(`owlBody${n}`, "var(--owl-body-hi)", "var(--owl-body)")}
          ${vgrad(`owlFace${n}`, "var(--owl-face-hi)", "var(--owl-face)")}
          ${vgrad(`owlBelly${n}`, "var(--owl-face)", "var(--owl-body)")}
          ${vgrad(`owlBeak${n}`, "var(--owl-beak-hi)", "var(--owl-beak)")}
        </defs>
        <g class="head">
          <g class="ear-l"><path d="${tuft}" fill="url(#owlBody${n})"/></g>
          <g class="ear-r"><path d="${mirror(tuft)}" fill="url(#owlBody${n})"/></g>
          <ellipse cx="60" cy="64" rx="40" ry="40" fill="url(#owlBody${n})"/>
          <ellipse cx="60" cy="89" rx="22" ry="13.5" fill="url(#owlBelly${n})" opacity=".55"/>
          <circle cx="43" cy="56" r="17.5" fill="url(#owlFace${n})"/>
          <circle cx="77" cy="56" r="17.5" fill="url(#owlFace${n})"/>
          ${eye({ cx: 43, cy: 56, rx: 12, ry: 12, white: "var(--eye-white)", ink: "var(--eye-ink)", prx: 6, pry: 6, lid: "var(--owl-lid)", happyInk: "#4a3527" })}
          ${eye({ cx: 77, cy: 56, rx: 12, ry: 12, white: "var(--eye-white)", ink: "var(--eye-ink)", prx: 6, pry: 6, lid: "var(--owl-lid)", happyInk: "#4a3527" })}
          <circle class="blush" cx="30" cy="72" r="5" fill="var(--blush)" opacity="0"/>
          <circle class="blush" cx="90" cy="72" r="5" fill="var(--blush)" opacity="0"/>
          <path d="M55.2 70.2 Q60 68.6 64.8 70.2 Q63.2 75.5 60.9 78.4 Q60 79.4 59.1 78.4 Q56.8 75.5 55.2 70.2 Z" fill="url(#owlBeak${n})"/>
        </g>`;
      },
    },
    {
      key: "blob",
      name: "Капля",
      ack: ["squish", "nod"],
      svg: () => {
        const g = `grad${uid++}`;
        return `
        <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--blob-b)"/><stop offset="1" stop-color="var(--blob-a)"/>
        </linearGradient></defs>
        <g class="head">
          <path d="M60 20 C88 20 102 40 102 67 C102 92 85 104 60 104 C35 104 18 92 18 67 C18 40 32 20 60 20 Z" fill="url(#${g})"/>
          ${eye({ cx: 46, cy: 60, rx: 8.5, ry: 10.5, white: "#fff", ink: "#1c1f26", prx: 4.6, pry: 5.6, lid: "var(--blob-a)", happyInk: "#fff" })}
          ${eye({ cx: 74, cy: 60, rx: 8.5, ry: 10.5, white: "#fff", ink: "#1c1f26", prx: 4.6, pry: 5.6, lid: "var(--blob-a)", happyInk: "#fff" })}
          <circle class="blush" cx="35" cy="76" r="5.5" fill="var(--blush)" opacity="0"/>
          <circle class="blush" cx="85" cy="76" r="5.5" fill="var(--blush)" opacity="0"/>
          <path class="mouth" d="M52 80 Q60 80 68 80" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        </g>`;
      },
    },
    {
      key: "eyes",
      name: "Глаза",
      ack: ["brows", "brows", "nod"],
      svg: () => `
        <g class="head">
          <path class="brow brow-l" d="M27 30 Q41 23 54 30" stroke="var(--muted)" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path class="brow brow-r" d="M66 30 Q79 23 93 30" stroke="var(--muted)" stroke-width="3" fill="none" stroke-linecap="round"/>
          ${eye({ cx: 41, cy: 62, rx: 17, ry: 21, white: "var(--eye-white)", ink: "var(--eye-ink)", iris: "var(--accent)", irisR: 10, prx: 5, pry: 5, lid: "var(--eyelid)", stroke: "var(--border)", happyInk: "var(--text)" })}
          ${eye({ cx: 79, cy: 62, rx: 17, ry: 21, white: "var(--eye-white)", ink: "var(--eye-ink)", iris: "var(--accent)", irisR: 10, prx: 5, pry: 5, lid: "var(--eyelid)", stroke: "var(--border)", happyInk: "var(--text)" })}
        </g>`,
    },
    {
      key: "cat",
      name: "Кот",
      ack: ["slowblink", "slowblink", "nod"],
      dilateX: true,
      svg: () => {
        const n = uid++;
        // Ухо с выпуклыми сторонами и закруглённой верхушкой; внутреннее — повторяет форму.
        const ear = "M21 58 C19.5 42 22.5 27 28 17.5 C29.6 14.8 32.6 14.3 34.8 16 C42.5 22 49.5 28.5 56 35.5 Z";
        const inner = "M29.5 47 C29.5 38 31.5 30 34 25 C35 23.2 36.8 23 38.2 24.2 C41.8 27.5 45 31 48 35 Z";
        return `
        <defs>
          ${vgrad(`catBody${n}`, "var(--cat-body-hi)", "var(--cat-body)")}
          ${vgrad(`catEar${n}`, "var(--cat-ear)", "var(--cat-ear-lo)")}
          ${vgrad(`catMuzzle${n}`, "var(--cat-muzzle-hi)", "var(--cat-muzzle)")}
        </defs>
        <g class="head">
          <g class="ear-l"><path d="${ear}" fill="url(#catBody${n})"/><path d="${inner}" fill="url(#catEar${n})"/></g>
          <g class="ear-r"><path d="${mirror(ear)}" fill="url(#catBody${n})"/><path d="${mirror(inner)}" fill="url(#catEar${n})"/></g>
          <ellipse cx="60" cy="67" rx="41" ry="35" fill="url(#catBody${n})"/>
          <ellipse cx="60" cy="82" rx="15" ry="10" fill="url(#catMuzzle${n})"/>
          ${eye({ cx: 44, cy: 61, rx: 10, ry: 9, white: "var(--cat-eye)", ink: "#1c1f26", prx: 2.4, pry: 7.5, lid: "var(--cat-lid)", happyInk: "#2f333d" })}
          ${eye({ cx: 76, cy: 61, rx: 10, ry: 9, white: "var(--cat-eye)", ink: "#1c1f26", prx: 2.4, pry: 7.5, lid: "var(--cat-lid)", happyInk: "#2f333d" })}
          <circle class="blush" cx="32" cy="76" r="4.5" fill="var(--blush)" opacity="0"/>
          <circle class="blush" cx="88" cy="76" r="4.5" fill="var(--blush)" opacity="0"/>
          <path d="M56.6 76.1 Q60 74.9 63.4 76.1 Q62 79.2 60 79.6 Q58 79.2 56.6 76.1 Z" fill="var(--cat-ear-lo)"/>
          <path d="M54 83 Q57 86 60 83 Q63 86 66 83" stroke="#4b5060" stroke-width="1.6" fill="none" stroke-linecap="round"/>
          <g stroke="var(--muted)" stroke-width="1" opacity=".55" stroke-linecap="round">
            <path d="M42 80 Q32 77.5 22 77.5"/><path d="M42 84 Q32 85 23 87"/><path d="M78 80 Q88 77.5 98 77.5"/><path d="M78 84 Q88 85 97 87"/>
          </g>
        </g>`;
      },
    },
  ];

  // ---------- Персонаж ----------
  class Listener {
    constructor(def, svg) {
      this.def = def;
      this.svg = svg;
      this.head = svg.querySelector(".head");
      this.eyes = [...svg.querySelectorAll(".eye")].map((el) => ({
        cx: +el.dataset.cx, cy: +el.dataset.cy, rx: +el.dataset.rx, ry: +el.dataset.ry,
        look: el.querySelector(".look"),
        open: el.querySelector(".open"),
        tint: el.querySelector(".strain-tint"),
        veins: el.querySelector(".veins"),
        happy: el.querySelector(".happy"),
        pupil: el.querySelector(".pupil"),
        lidT: el.querySelector(".lid-top"),
        lidB: el.querySelector(".lid-bot"),
      }));
      this.earL = svg.querySelector(".ear-l");
      this.earR = svg.querySelector(".ear-r");
      this.browL = svg.querySelector(".brow-l");
      this.browR = svg.querySelector(".brow-r");
      this.mouth = svg.querySelector(".mouth");
      this.blush = [...svg.querySelectorAll(".blush")];

      this.s = { lean: 0, closure: 0.12, squint: 0, gx: 0, gy: 0, dil: 1, tilt: 0, smile: 0.15, blush: 0, perk: 0, brow: 0, browR: 0, happy: 0 };
      const now = performance.now();
      this.nextBlink = now + rand(600, 2500);
      this.blink = null;
      this.sacc = { x: 0, y: 0, next: now };
      this.tiltTarget = 0;
      this.nextTilt = now + rand(3000, 6000);
      this.ack = null;
    }

    acknowledge() {
      const types = this.def.ack;
      const type = types[Math.floor(Math.random() * types.length)];
      const dur = { nod: 700, squish: 650, brows: 900, slowblink: 1500, tilt: 1600 }[type];
      this.ack = { type, start: performance.now(), dur, dir: Math.random() < 0.5 ? -1 : 1 };
    }

    update(now, dt) {
      const k = G.k;
      const mode = G.mode;
      const s = this.s;
      const L = G.level;
      const sinceMode = now - G.modeSince;

      // --- Цели по состоянию ---
      let t = { happy: 0, lean: 0, closure: 0.12, squint: 0, dil: 1, smile: 0.15, blush: 0, perk: 0.2, brow: 0, browR: 0, sacc: 0.22, gaze: [0, 0] };
      if (mode === "listening") {
        t = { ...t, lean: 1, closure: 0, dil: 1 + 0.28 * L, smile: 0.08, perk: 0.65 + 0.35 * L, brow: 0.35 + 0.4 * L, sacc: 0.07 };
      } else if (mode === "paused") {
        t = { ...t, lean: 0.35, closure: 0.28, smile: 0.25, perk: 0.4, sacc: 0.05 };
      } else if (mode === "processing") {
        const drift = Math.sin(now / 900) * 0.25;
        t = { ...t, closure: 0.18, perk: 0.3, brow: 0.2, browR: 0.6, sacc: 0.04, gaze: [0.45 + drift, -0.55] };
      } else if (mode === "done") {
        t = { ...t, happy: 1, smile: 1, blush: 0.75, perk: 0.5, brow: 0.3 };
      }

      // Уставшие глаза: веки тяжелее (кроме довольного «^ ^»).
      if (!t.happy) t.closure += 0.3 * G.strain;

      // В ожидании лениво следим за курсором.
      if (mode === "idle" && G.cursor) {
        const r = this.svg.getBoundingClientRect();
        const dx = (G.cursor.x - (r.left + r.width / 2)) / 260;
        const dy = (G.cursor.y - (r.top + r.height / 2)) / 260;
        t.gaze = [clamp(dx, -1, 1) * 0.7, clamp(dy, -1, 1) * 0.6];
      }

      // Микродвижения глаз: живой взгляд даже при «смотрю прямо на тебя».
      if (now > this.sacc.next) {
        this.sacc.x = rand(-1, 1) * t.sacc;
        this.sacc.y = rand(-1, 1) * t.sacc * 0.7;
        this.sacc.next = now + rand(600, 2200);
      }

      // Наклон головы «прислушиваюсь» — изредка, только во время записи.
      if (mode === "listening" && now > this.nextTilt) {
        this.tiltTarget = this.tiltTarget === 0 ? (Math.random() < 0.5 ? -1 : 1) * rand(3, 6) : 0;
        this.nextTilt = now + (this.tiltTarget === 0 ? rand(4000, 8000) : rand(2000, 3500));
      } else if (mode !== "listening") {
        this.tiltTarget = 0;
      }

      // --- Сглаживание ---
      s.lean = approach(s.lean, t.lean, 4, dt);
      s.closure = approach(s.closure, t.closure, 6, dt);
      s.squint = approach(s.squint, t.squint, 7, dt);
      s.happy = approach(s.happy, t.happy, 9, dt);
      s.dil = approach(s.dil, t.dil, 5, dt);
      s.smile = approach(s.smile, t.smile, 5, dt);
      s.blush = approach(s.blush, t.blush, 3, dt);
      s.perk = approach(s.perk, t.perk, 5, dt);
      s.brow = approach(s.brow, t.brow, 4, dt);
      s.browR = approach(s.browR, t.browR, 4, dt);
      s.tilt = approach(s.tilt, this.tiltTarget, 2.2, dt);
      // Перевод взгляда — быстрый, как настоящий саккадический.
      s.gx = approach(s.gx, t.gaze[0] + this.sacc.x, 18, dt);
      s.gy = approach(s.gy, t.gaze[1] + this.sacc.y, 18, dt);

      // --- Знак внимания (кивок и т.п.) ---
      let nodY = 0, nodRot = 0, squishY = 1, ackClose = 0, ackBrow = 0, ackSmile = 0, earTwitch = 0;
      if (this.ack) {
        const p = (now - this.ack.start) / this.ack.dur;
        if (p >= 1) this.ack = null;
        else {
          const bell = Math.sin(Math.PI * p);
          switch (this.ack.type) {
            case "nod":
              // Один неглубокий кивок вниз-вверх.
              nodY = 4.5 * Math.sin(Math.PI * Math.min(1, p * 1.25)) * k;
              nodRot = 0;
              ackSmile = 0.35 * bell;
              ackClose = 0.12 * bell;
              earTwitch = 8 * Math.sin(Math.PI * clamp(p * 3, 0, 1));
              break;
            case "squish":
              squishY = 1 - 0.06 * Math.sin(Math.PI * Math.min(1, p * 1.6)) * k + 0.025 * Math.sin(Math.PI * clamp(p * 1.6 - 0.6, 0, 1)) * k;
              ackSmile = 0.6 * bell;
              break;
            case "brows":
              ackBrow = 1 * bell;
              ackClose = p > 0.35 && p < 0.55 ? Math.sin(Math.PI * (p - 0.35) / 0.2) : 0;
              break;
            case "slowblink": {
              // Закрыть медленно, задержать, открыть медленно.
              const c = p < 0.38 ? p / 0.38 : p < 0.58 ? 1 : 1 - (p - 0.58) / 0.42;
              ackClose = 0.82 * Math.sin((Math.PI / 2) * c);
              ackSmile = 0.3 * bell;
              break;
            }
            case "tilt":
              nodRot = this.ack.dir * 7 * bell * k;
              ackSmile = 0.2 * bell;
              break;
          }
        }
      }

      // --- Моргание ---
      let blinkClose = 0;
      if (!this.blink && now > this.nextBlink && !(this.ack && this.ack.type === "slowblink")) {
        this.blink = { start: now, dur: rand(130, 170) };
        const base = mode === "listening" ? [2600, 5500] : mode === "processing" ? [3000, 6000] : [2000, 4500];
        this.nextBlink = now + rand(...base) * (1 - 0.45 * G.strain);
        if (Math.random() < 0.18) this.nextBlink = now + 260; // двойное моргание
      }
      if (this.blink) {
        const p = (now - this.blink.start) / this.blink.dur;
        if (p >= 1) this.blink = null;
        else blinkClose = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
      }

      // --- Отрисовка ---
      const breath = 1 + 0.012 * Math.sin(now / 1700) * k;
      const lean = s.lean * k;
      const sc = 1 + 0.04 * lean;
      this.head.style.transform =
        `translateY(${(-2.5 * lean + nodY).toFixed(2)}px) rotate(${(s.tilt * k + nodRot).toFixed(2)}deg) ` +
        `scale(${sc.toFixed(4)}, ${(sc * breath * squishY).toFixed(4)})`;

      const top = clamp(Math.max(s.closure + ackClose * (1 - s.closure), blinkClose), 0, 1);
      for (const e of this.eyes) {
        const gx = s.gx * e.rx * 0.38;
        const gy = s.gy * e.ry * 0.32;
        e.look.setAttribute("transform", `translate(${gx.toFixed(2)} ${gy.toFixed(2)})`);
        const sx = this.def.dilateX ? 1 + (s.dil - 1) * 2.4 : s.dil;
        const sy = this.def.dilateX ? 1 : s.dil;
        e.pupil.setAttribute("transform",
          `translate(${e.cx} ${e.cy}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-e.cx} ${-e.cy})`);
        const h = 2 * e.ry + 2;
        e.lidT.setAttribute("height", (h * top).toFixed(2));
        const hb = h * s.squint * (1 - blinkClose);
        e.lidB.setAttribute("height", hb.toFixed(2));
        e.lidB.setAttribute("y", (e.cy + e.ry + 1 - hb).toFixed(2));
        // Усталость: белок равномерно розовеет, венки (всегда те же) проявляются вместе с ним.
        e.tint.setAttribute("opacity", G.strain.toFixed(3));
        e.veins.setAttribute("opacity", (G.strain * 0.95).toFixed(3));
        // «Готово»: открытый глаз сменяется дугой ^ — довольный прищур.
        e.open.setAttribute("opacity", (1 - s.happy).toFixed(2));
        e.happy.setAttribute("opacity", s.happy.toFixed(2));
      }

      if (this.earL) {
        // Сова: кисточки чуть поднимаются. Кот: уши разворачиваются вперёд, в покое расходятся в стороны.
        const relax = this.def.key === "cat" ? (1 - s.perk) * 14 : (1 - s.perk) * 6;
        this.earL.style.transform = `rotate(${(-relax - earTwitch * 0.5) * k}deg)`;
        this.earR.style.transform = `rotate(${(relax + earTwitch * 0.5) * k}deg)`;
      }
      if (this.browL) {
        const b = (s.brow + ackBrow) * k;
        this.browL.style.transform = `translateY(${(-4 * b).toFixed(2)}px)`;
        this.browR.style.transform = `translateY(${(-4 * (b + s.browR * k)).toFixed(2)}px)`;
      }
      if (this.mouth) {
        const sm = clamp(s.smile + ackSmile, 0, 1.2);
        this.mouth.setAttribute("d", `M52 80 Q60 ${(80 + sm * 7).toFixed(2)} 68 80`);
      }
      for (const b of this.blush) b.setAttribute("opacity", (s.blush * 0.7).toFixed(2));
    }
  }


  // ---------- Общее состояние ----------
  const G = {
    mode: "idle", // idle | listening | paused | processing | done
    modeSince: performance.now(),
    level: 0, // сглаженная громкость 0..1
    k: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.3 : 1,
    cursor: null,
    strain: 0, // усталость глаз 0..1
  };

  // Усталость: до 1:00 записи — ноль, дальше линейно до максимума к 4:00.
  const STRAIN_START_SEC = 60;
  const STRAIN_MAX_SEC = 240;

  let host = null;
  let current = null; // Listener
  let currentKey = "off";
  let rafId = null;
  let doneTimer = null;
  let getElapsedMs = () => 0;

  // ---------- Громкость с микрофона ----------
  // Тот же поток, что пишет MediaRecorder: анализатор только читает его, запись не трогает.
  let audioCtx = null;
  let source = null;
  let analyser = null;
  let buf = null;
  // Поток помним, даже пока маскот выключен: включили его посреди записи — сразу слышит.
  let stream = null;

  function setStream(next) {
    stream = next;
    attachStream();
  }

  function attachStream() {
    if (source) {
      source.disconnect();
      source = null;
    }
    if (!stream || currentKey === "off") return;
    try {
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === "suspended") audioCtx.resume();
      analyser = analyser || audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      buf = buf || new Float32Array(analyser.fftSize);
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      source = null; // без громкости маскот всё равно смотрит и моргает
    }
  }

  function micLevel() {
    if (!source) return 0;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    return clamp((db + 55) / 38, 0, 1);
  }

  // ---------- Пауза в речи → знак внимания ----------
  // Договорил фразу (≥0.9 с) и замолчал на ~0.5 с — маскот подаёт знак, не чаще раза в 3 с.
  const speech = { talking: false, runStart: 0, runLen: 0, lastLoud: 0, acked: true, lastAck: 0 };
  function trackSpeech(now, level) {
    if (level > 0.14) {
      if (!speech.talking) {
        speech.talking = true;
        speech.runStart = now;
      }
      speech.lastLoud = now;
      speech.acked = false;
    } else if (speech.talking && now - speech.lastLoud > 250) {
      speech.talking = false;
      speech.runLen = speech.lastLoud - speech.runStart;
    }
    if (G.mode === "listening" && !speech.talking && !speech.acked &&
        now - speech.lastLoud > 480 && speech.runLen > 900 && now - speech.lastAck > 3000) {
      speech.acked = true;
      speech.lastAck = now;
      if (current && Math.random() < 0.8) setTimeout(() => current && current.acknowledge(), rand(0, 260));
    }
  }

  // ---------- Главный цикл ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const raw = G.mode === "listening" ? micLevel() : 0;
    G.level = approach(G.level, raw, raw > G.level ? 22 : 6, dt);
    trackSpeech(now, G.level);

    const recording = G.mode === "listening" || G.mode === "paused";
    const recSec = recording ? getElapsedMs() / 1000 : 0;
    const strainTarget = clamp((recSec - STRAIN_START_SEC) / (STRAIN_MAX_SEC - STRAIN_START_SEC), 0, 1);
    // Краснеют медленно, после записи отходят за несколько секунд.
    G.strain = approach(G.strain, strainTarget, strainTarget > G.strain ? 2 : 0.6, dt);

    if (current) current.update(now, dt);
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId === null) {
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }
  function stopLoop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  window.addEventListener("mousemove", (e) => (G.cursor = { x: e.clientX, y: e.clientY }));

  const byKey = (key) => CHARACTERS.find((c) => c.key === key) || null;

  window.Mascot = {
    characters: () => CHARACTERS.map(({ key, name }) => ({ key, name })),

    mount(el) {
      host = el;
    },

    // "off" — маскот скрыт, анимация и анализ звука не крутятся.
    setCharacter(key) {
      const def = byKey(key);
      currentKey = def ? key : "off";
      if (!host) return;
      host.innerHTML = "";
      current = null;
      if (!def) {
        host.hidden = true;
        attachStream();
        stopLoop();
        return;
      }
      host.hidden = false;
      host.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">${def.svg()}</svg>`;
      current = new Listener(def, host.querySelector("svg"));
      attachStream();
      startLoop();
    },

    setMode(mode) {
      clearTimeout(doneTimer);
      G.mode = mode;
      G.modeSince = performance.now();
      speech.acked = true;
      if (mode === "done") doneTimer = setTimeout(() => window.Mascot.setMode("idle"), 1800);
    },

    setStream,

    // Длительность текущей записи без пауз — от неё зависит усталость глаз.
    setElapsedSource(fn) {
      getElapsedMs = fn;
    },

    // Статичная картинка для настроек: нейтральное лицо, без анимации и реакций.
    preview(key) {
      const def = byKey(key);
      return def ? `<svg viewBox="0 0 120 120" aria-hidden="true">${def.svg()}</svg>` : "";
    },
  };
})();
