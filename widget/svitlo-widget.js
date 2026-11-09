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
  // палітра «пастельний трекер»: кремовий, масляно-жовтий, блакитний; чорні акценти
  bg: Color.dynamic(new Color("#F7F1E5"), new Color("#171613")),
  ink: Color.dynamic(new Color("#1D1D1B"), new Color("#F5F0E6")),
  muted: Color.dynamic(new Color("#8C8679"), new Color("#A39C8E")),
  on: new Color("#F2D872"),
  off: new Color("#A9C2EA"),
  maybe: new Color("#F4B6D6"),
  track: new Color("#B8AE98", 0.28),
  warnBg: new Color("#F6BCD9"),
  warnInk: new Color("#3A1328"),
};
const COLOR = { on: C.on, off: C.off, maybe: C.maybe };
const LABEL = { on: "Світло є", off: "Світла немає", maybe: "Перемикання світла" };

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

// ---------- графік напряму з сайту обленерго ----------
const MONTHS = { "січня": 1, "лютого": 2, "березня": 3, "квітня": 4, "травня": 5, "червня": 6,
  "липня": 7, "серпня": 8, "вересня": 9, "жовтня": 10, "листопада": 11, "грудня": 12 };
const pad2 = (n) => String(n).padStart(2, "0");
function parsePoe(html) {
  const days = [];
  for (const chunk of String(html || "").split(/class="gpvinfodetail"/).slice(1)) {
    const text = chunk.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    const m = text.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\s+(\d{4})/);
    if (!m) continue;
    const date = `${m[3]}-${pad2(MONTHS[m[2]])}-${pad2(m[1])}`;
    const ti = chunk.search(/<table[^>]*class="[^"]*\bgpv-table\b/);
    if (ti < 0) continue;
    const table = chunk.slice(ti, chunk.indexOf("</table>", ti));
    const slots = {};
    for (const tr of table.split(/<tr\b/).slice(1)) {
      const q = (tr.match(/class="[^"]*\bgpv-q\b[^"]*"[^>]*>\s*([1-6]\.[12])\s*</) || [])[1];
      if (!q) continue;
      const cells = [...tr.matchAll(/class="gpv-c\b[^"]*\bgpv-s(\d)/g)].map((x) => x[1]);
      if (cells.length !== 48) continue;
      slots[q] = cells.map((c) => (c === "2" ? "0" : c === "3" ? "?" : "1")).join("");
    }
    if (Object.keys(slots).length >= 6 && !days.some((d) => d.date === date)) days.push({ date, status: "scheduled", slots });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
async function getLiveSchedule() {
  try {
    const f = new DateFormatter(); f.dateFormat = "dd-MM-yyyy";
    const r = new Request("https://www.poe.pl.ua/customs/newgpv-info.php");
    r.method = "POST"; r.timeoutInterval = 15;
    r.headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
    r.body = "seldate=" + encodeURIComponent(JSON.stringify({ date_in: f.string(new Date()) }));
    const days = parsePoe(await r.loadString());
    if (!days.length) return null;
    const sched = { checkedAt: new Date().toISOString(), source: "poe.pl.ua", days };
    fm.writeString(cachePath("schedule.json"), JSON.stringify(sched));
    return sched;
  } catch (e) { return null; }
}

// ---------- ГАВ / СГАВ ----------
// Сайт обленерго показує оголошені ГАВ/СГАВ, але не прибирає їх після скасування,
// тому скасування беремо з Telegram (status.json від GitHub).
async function getUnloading() {
  try {
    const f = new DateFormatter(); f.dateFormat = "dd-MM-yyyy";
    const r = new Request("https://www.poe.pl.ua/customs/unloading-info.php");
    r.method = "POST"; r.timeoutInterval = 15;
    r.headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
    r.body = "seldate=" + encodeURIComponent(JSON.stringify({ date_in: f.string(new Date()) }));
    const t = (await r.loadString()).trim();
    return t ? JSON.parse(t) : [];
  } catch (e) { return null; }
}
const toDateDMY = (dmy, h, m) => { const [d, mo, y] = dmy.split(" ")[0].split("-").map(Number); return new Date(y, mo - 1, d, h || 0, m || 0); };
function emergencyNow(list, tg, now = new Date()) {
  const cur = (list || []).filter((e) => /С?ГАВ/.test(e.unloadingtypename || ""))
    .map((e) => {
      const ct = (e.createddate || "").split(" ")[1] || "0:0";
      return {
        type: /СГАВ/.test(e.unloadingtypename) ? "СГАВ" : "ГАВ",
        from: toDateDMY(e.unloaddata, e.beginhour, e.beginminute),
        to: toDateDMY(e.unloaddata, e.endhour, e.endminute),
        created: e.createddate ? toDateDMY(e.createddate, +ct.split(":")[0], +ct.split(":")[1]) : null,
      };
    })
    .filter((e) => e.from <= now && now <= new Date(+e.to + 60000))
    .sort((a, b) => b.from - a.from)[0];
  const tgTime = tg && tg.postedAt ? new Date(tg.postedAt) : null;
  if (cur) {
    if (tg && !tg.active && tgTime && cur.created && tgTime > cur.created) return null;
    return { active: true, type: cur.type };
  }
  if (tg && tg.active && tgTime && now - tgTime < 18 * 3600e3) return { active: true, type: tg.type };
  return null;
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
  if (!lock) { w.backgroundColor = C.bg; w.setPadding(14, 14, 14, 14); }
  w.url = BASE_URL;

  if (!queue) {
    const t = w.addText("Відкрийте Scriptable і оберіть чергу"); t.font = Font.mediumSystemFont(13); t.textColor = C.ink;
    return w;
  }

  const [live, status, unloading] = await Promise.all([getLiveSchedule(), getJSON("status.json"), getUnloading()]);
  const schedule = live || (await getJSON("schedule.json"));
  const em = emergencyNow(unloading, status && status.emergency);
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

  // Точна ширина віджета для кожного розміру екрана iPhone (у точках),
  // щоб вміст не був ширшим за віджет і iOS його не обрізала
  const sw = Device.screenSize().width, sh = Device.screenSize().height;
  const SIZES = [  // [ширина екрана, малий, середній]
    [430, 170, 364], [428, 170, 364], [414, 169, 360], [393, 158, 338], [390, 158, 338],
    [375, 155, 329], [360, 155, 329], [320, 141, 292],
  ];
  const row = SIZES.find(([x]) => Math.abs(x - Math.min(sw, sh)) < 2) || SIZES.find(([x]) => x <= Math.min(sw, sh)) || SIZES[SIZES.length - 1];
  const PAD = 14;
  const fullW = family === "small" ? row[1] : row[2];
  const innerW = Math.floor(fullW - PAD * 2);
  w.setPadding(PAD, PAD, PAD, PAD);

  const main = w.addStack(); main.layoutVertically(); main.size = new Size(innerW, 0);

  // верхній рядок: значок, стан, черга
  const head = main.addStack(); head.centerAlignContent(); head.size = new Size(innerW, 0);
  const SYM = { on: "lightbulb.fill", off: "bolt.slash.fill", maybe: "arrow.triangle.2.circlepath" };
  const badge = head.addStack(); badge.size = new Size(22, 22); badge.cornerRadius = 11; badge.centerAlignContent();
  badge.backgroundColor = COLOR[cur.v];
  const sym = SFSymbol.named(SYM[cur.v]) || SFSymbol.named("bolt.fill"); sym.applyBoldWeight();
  const si = badge.addImage(sym.image); si.imageSize = new Size(12, 12); si.tintColor = new Color("#1D1D1B");
  head.addSpacer(6);
  const st = head.addText(LABEL[cur.v]); st.font = Font.semiboldSystemFont(13); st.textColor = C.ink; st.lineLimit = 1; st.minimumScaleFactor = 0.8;
  head.addSpacer();
  const q = head.addText(queue); q.font = Font.semiboldSystemFont(12); q.textColor = C.muted;

  main.addSpacer();

  // відлік (таймер у власному рядку, вирівняний ліворуч)
  const tRow = main.addStack(); tRow.size = new Size(innerW, 0);
  if (lastOn) {
    const t = tRow.addText("Без відключень"); t.font = Font.boldRoundedSystemFont(family === "small" ? 20 : 24); t.textColor = C.ink; t.lineLimit = 1; t.minimumScaleFactor = 0.7;
  } else {
    const d = tRow.addDate(cur.end); d.applyTimerStyle(); d.leftAlignText();
    d.font = Font.boldRoundedSystemFont(family === "small" ? 28 : 34); d.textColor = C.ink; d.lineLimit = 1; d.minimumScaleFactor = 0.6;
  }
  tRow.addSpacer();
  const sRow = main.addStack(); sRow.size = new Size(innerW, 0);
  const sub = sRow.addText(lastOn ? "за графіком" : `${what} · о ${hm(cur.end)}`);
  sub.font = Font.systemFont(12); sub.textColor = C.muted; sub.lineLimit = 1; sub.minimumScaleFactor = 0.8;
  sRow.addSpacer();

  main.addSpacer(8);
  const img = main.addImage(barImage(innerW, cur, now, em, false));
  img.imageSize = new Size(innerW, em ? 31 : 12);

  if (family !== "small") {
    main.addSpacer(5);
    const ends = main.addStack(); ends.size = new Size(innerW, 0);
    const a = ends.addText(`з ${hm(cur.start)}`); a.font = Font.systemFont(11); a.textColor = C.muted;
    ends.addSpacer();
    // наступне відключення
    const nextOff = segs.slice(i + 1).find((s) => s.v !== "on");
    const txt = cur.v === "on" ? (nextOff ? `далі без світла ${hm(nextOff.start)}–${hm(nextOff.end)}` : "")
                               : `до ${hm(cur.end)}`;
    const b = ends.addText(txt); b.font = Font.systemFont(11); b.textColor = C.muted; b.lineLimit = 1; b.minimumScaleFactor = 0.8;
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
