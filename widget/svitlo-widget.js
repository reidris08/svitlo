// Variables used by Scriptable.
// icon-color: deep-gray; icon-glyph: lightbulb;
//
// «Світло» — віджет графіка відключень (Полтаваобленерго) для Scriptable.
// Розміри: малий, середній, а також віджет на екрані блокування (прямокутний).
//
// 1) Вкажіть адресу свого сайту на GitHub Pages нижче (BASE_URL).
// 2) Запустіть скрипт у Scriptable і оберіть свою чергу — вона збережеться.
//    Або впишіть чергу в поле «Parameter» віджета, напр. 3.2

const BASE_URL = "https://reidris08.github.io/svitlo/";

// ---------- кольори (спокійні, однакові з застосунком) ----------
const C = {
  bg: Color.dynamic(new Color("#F4F1EC"), new Color("#17191C")),
  ink: Color.dynamic(new Color("#2B3035"), new Color("#EDEAE5")),
  muted: Color.dynamic(new Color("#848A90"), new Color("#979DA4")),
  on: new Color("#8FB894"),
  off: new Color("#6A7DA0"),
  maybe: new Color("#D7B676"),
  track: new Color("#8A93A0", 0.2),
  warn: new Color("#C9785B"),
  warnBg: new Color("#FBEAE2"),
  warnInk: new Color("#8E4831"),
};
const COLOR = { on: C.on, off: C.off, maybe: C.maybe };
const LABEL = { on: "Світло є", off: "Світла немає", maybe: "Можливе вимкнення" };

// ---------- черга ----------
const QUEUES = ["1.1","1.2","2.1","2.2","3.1","3.2","4.1","4.2","5.1","5.2","6.1","6.2"];
const KEY = "svitlo.queue";
function getQueue() {
  const p = (args.widgetParameter || "").trim().replace(",", ".");
  if (QUEUES.includes(p)) return p;
  return Keychain.contains(KEY) ? Keychain.get(KEY) : null;
}

// ---------- дані з кешем ----------
const fm = FileManager.local();
const cachePath = (n) => fm.joinPath(fm.documentsDirectory(), "svitlo-" + n);
async function getJSON(name) {
  try {
    const r = new Request(BASE_URL + "data/" + name + "?t=" + Date.now());
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    fm.writeString(cachePath(name), JSON.stringify(j));
    return j;
  } catch (e) {
    return fm.fileExists(cachePath(name)) ? JSON.parse(fm.readString(cachePath(name))) : null;
  }
}

// ---------- розрахунок ----------
const slotStart = (date, i) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d, 0, 30 * i); };
function segments(schedule, queue) {
  const segs = [];
  for (const day of (schedule && schedule.days) || []) {
    const s = day.slots[queue]; if (!s) continue;
    for (let i = 0; i < 48; i++) {
      const v = s[i] === "0" ? "off" : s[i] === "?" ? "maybe" : "on";
      const start = slotStart(day.date, i), end = slotStart(day.date, i + 1);
      const last = segs[segs.length - 1];
      if (last && last.v === v && +last.end === +start) last.end = end;
      else segs.push({ v, start, end });
    }
  }
  return segs;
}
const hm = (d) => { const f = new DateFormatter(); f.dateFormat = "HH:mm"; return f.string(d); };

// ---------- горизонтальна смуга (+ плашка ГАВ поверх неї) ----------
function barImage(w, cur, now, emergency, mono) {
  const alertH = emergency ? 24 : 0, barH = mono ? 8 : 12, overlap = emergency ? 5 : 0;
  const h = alertH + barH - overlap;
  const dc = new DrawContext(); dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true;
  const y = h - barH;
  const pill = (x, yy, ww, hh, color) => {
    const p = new Path(); p.addRoundedRect(new Rect(x, yy, ww, hh), hh / 2, hh / 2);
    dc.addPath(p); dc.setFillColor(color); dc.fillPath();
  };
  const p = cur ? Math.min(1, Math.max(0, (now - cur.start) / (cur.end - cur.start))) : 0;
  pill(0, y, w, barH, mono ? new Color("#FFFFFF", 0.3) : C.track);
  if (p > 0) pill(0, y, Math.max(barH, w * p), barH, mono ? Color.white() : COLOR[cur.v]);
  if (emergency) {
    const bw = w;
    const r = new Path(); r.addRoundedRect(new Rect(0, 0, bw, alertH), 9, 9); dc.addPath(r);
    dc.setFillColor(mono ? Color.white() : C.warnBg); dc.fillPath();
    dc.setFont(Font.boldSystemFont(11)); dc.setTextColor(mono ? Color.black() : C.warnInk);
    dc.drawTextInRect(w < 200 ? `⚠︎  Діють ${emergency.type}` : `⚠︎  Діють ${emergency.type} · ГПВ може не діяти`, new Rect(8, 5, bw - 12, alertH - 6));
  }
  return dc.getImage();
}

// ---------- віджет ----------
async function build() {
  const family = config.widgetFamily || "medium";
  const queue = getQueue();
  const w = new ListWidget();
  const lock = family.startsWith("accessory");
  if (!lock) { w.backgroundColor = C.bg; w.setPadding(14, 16, 14, 16); }
  w.url = BASE_URL;

  if (!queue) {
    const t = w.addText("Відкрийте Scriptable і оберіть чергу"); t.font = Font.mediumSystemFont(13); t.textColor = C.ink;
    return w;
  }

  const [schedule, status] = await Promise.all([getJSON("schedule.json"), getJSON("status.json")]);
  const em = status && status.emergency && status.emergency.active ? status.emergency : null;
  const now = new Date();
  const segs = segments(schedule, queue);
  const i = segs.findIndex((s) => s.start <= now && now < s.end);
  const cur = segs[i], next = segs[i + 1];

  // оновлення: на момент зміни стану або через 15 хв
  const soon = new Date(now.getTime() + 15 * 60000);
  w.refreshAfterDate = cur && cur.end < soon ? new Date(cur.end.getTime() + 30000) : soon;

  if (!cur) {
    const t = w.addText(lock ? "Графіка немає" : `Черга ${queue}\nГрафік ще не опубліковано`);
    t.font = Font.mediumSystemFont(13); t.textColor = lock ? Color.white() : C.ink;
    return w;
  }

  const lastOn = cur.v === "on" && !next;
  const what = cur.v === "off" ? "до ввімкнення" : cur.v === "on" ? "до вимкнення" : (next && next.v === "on" ? "до ввімкнення" : "до вимкнення");

  if (lock) {
    const top = w.addText(`${LABEL[cur.v]}${lastOn ? "" : " · " + hm(cur.end)}`);
    top.font = Font.semiboldSystemFont(12);
    if (em) { const a = w.addText(`⚠︎ ${em.type}`); a.font = Font.boldSystemFont(11); }
    if (!lastOn) { const d = w.addDate(cur.end); d.applyTimerStyle(); d.font = Font.boldRoundedSystemFont(20); }
    else { const d = w.addText("без відключень"); d.font = Font.boldRoundedSystemFont(16); }
    w.addSpacer(3);
    w.addImage(barImage(150, cur, now, null, true)).imageSize = new Size(150, 8);
    return w;
  }

  // верхній рядок
  const head = w.addStack(); head.centerAlignContent();
  const dot = head.addText("● "); dot.font = Font.systemFont(10); dot.textColor = COLOR[cur.v];
  const st = head.addText(LABEL[cur.v]); st.font = Font.semiboldSystemFont(13); st.textColor = C.ink; st.lineLimit = 1;
  head.addSpacer();
  const q = head.addText(queue); q.font = Font.mediumSystemFont(12); q.textColor = C.muted;

  w.addSpacer();

  // відлік
  if (lastOn) {
    const t = w.addText("Без відключень"); t.font = Font.boldRoundedSystemFont(family === "small" ? 20 : 24); t.textColor = C.ink;
  } else {
    const d = w.addDate(cur.end); d.applyTimerStyle();
    d.font = Font.boldRoundedSystemFont(family === "small" ? 28 : 36); d.textColor = C.ink; d.minimumScaleFactor = 0.6;
  }
  const sub = w.addText(lastOn ? "за графіком" : `${what} · о ${hm(cur.end)}`);
  sub.font = Font.systemFont(12); sub.textColor = C.muted; sub.lineLimit = 1;

  w.addSpacer(8);
  const bw = family === "small" ? 130 : 300;
  const img = w.addImage(barImage(bw, cur, now, em, false));
  img.imageSize = new Size(bw, em ? 31 : 12);
  img.resizable = false;

  if (family !== "small") {
    w.addSpacer(5);
    const ends = w.addStack();
    const a = ends.addText(`з ${hm(cur.start)}`); a.font = Font.systemFont(11); a.textColor = C.muted;
    ends.addSpacer();
    // наступне відключення
    const nextOff = segs.slice(i + 1).find((s) => s.v !== "on");
    const txt = cur.v === "on" ? (nextOff ? `далі без світла ${hm(nextOff.start)}–${hm(nextOff.end)}` : "")
                               : `до ${hm(cur.end)}`;
    const b = ends.addText(txt); b.font = Font.systemFont(11); b.textColor = C.muted;
  }
  return w;
}

// ---------- запуск ----------
if (config.runsInApp && !config.runsInWidget) {
  const a = new Alert();
  a.title = "Світло";
  a.message = `Черга: ${getQueue() || "не обрано"}`;
  a.addAction("Обрати чергу");
  a.addAction("Переглянути віджет");
  a.addCancelAction("Закрити");
  const r = await a.presentSheet();
  if (r === 0) {
    const qa = new Alert(); qa.title = "Ваша черга";
    QUEUES.forEach((x) => qa.addAction(x)); qa.addCancelAction("Скасувати");
    const k = await qa.presentSheet();
    if (k >= 0) Keychain.set(KEY, QUEUES[k]);
  }
  if (r === 0 || r === 1) (await build()).presentMedium();
} else {
  Script.setWidget(await build());
}
Script.complete();
