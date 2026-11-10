// Збирає дані для застосунку «Світло» (Полтавська обл.).
// Запускається GitHub Actions кожні ~10 хв. Без залежностей (Node 20+).
//
// 1) Графік погодинних відключень (ГПВ) — відкритий набір даних,
//    який автоматично збирається з офіційного сайту poe.pl.ua:
//    https://github.com/findme88/poltava-outage-data
// 2) ГАВ / СГАВ — останні дописи офіційного Telegram-каналу
//    «Полтаваобленерго» (https://t.me/poltavaOE).
//
// Результат: data/schedule.json і data/status.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "../gav.js";   // globalThis.GAV — спільний розбір ГАВ для застосунку, віджета і GitHub

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");

const SCHEDULE_URL =
  "https://raw.githubusercontent.com/findme88/poltava-outage-data/main/data/Poltavaoblenergo.json";
const TELEGRAM_URL = "https://t.me/s/poltavaOE";
const TZ = "Europe/Kyiv";
const QUEUES = ["1.1","1.2","2.1","2.2","3.1","3.2","4.1","4.2","5.1","5.2","6.1","6.2"];

// Кожна година у джерелі — пара півгодин. 1 = світло є, 0 = нема, ? = можливе/перемикання
const HALVES = {
  yes: "11", no: "00", first: "01", second: "10", mfirst: "?1", msecond: "0?",
};

const kyivDate = (ms) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms)); // "YYYY-MM-DD"

async function getText(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": "Mozilla/5.0 (svitlo personal app)", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// ---------- 1. Графік ----------
export function convertSchedule(src) {
  const days = [];
  const data = src?.fact?.data || {};
  const meta = src?.metadata?.days || {};
  for (const key of Object.keys(data).sort((a, b) => Number(a) - Number(b))) {
    const date = kyivDate(Number(key) * 1000 + 3 * 3600 * 1000); // +3 год, щоб точно потрапити в ту саму добу
    const slots = {};
    for (const q of QUEUES) {
      const hours = data[key]["GPV" + q];
      if (!hours) continue;
      let s = "";
      for (let h = 1; h <= 24; h++) s += HALVES[hours[String(h)]] ?? "11";
      slots[q] = s; // 48 символів, по 30 хв
    }
    if (Object.keys(slots).length) days.push({ date, status: meta[date]?.status || "scheduled", slots });
  }
  return { source: "poe.pl.ua через findme88/poltava-outage-data", sourceUpdated: src?.lastUpdated || null, days };
}

// ---------- 2. ГАВ / СГАВ ----------
const decode = (s) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/[ \t]+/g, " ").trim();

export function parseTelegram(html) {
  const posts = [];
  const blocks = html.split('class="tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const id = (b.match(/data-post="([^"]+)"/) || [])[1];
    const time = (b.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    const textHtml = (b.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    if (!id || !time || !textHtml) continue;
    posts.push({ id, link: "https://t.me/" + id, time: new Date(time).toISOString(), text: decode(textHtml) });
  }
  return posts.sort((a, b) => a.time.localeCompare(b.time));
}

const L = "А-ЯІЇЄҐа-яіїєґ'’";
const word = (w) => new RegExp(`(^|[^${L}])${w}([^${L}]|$)`);
const RE_SGAV = /(^|[^А-ЯІЇЄҐа-яіїєґ])СГАВ|спеціальн\S*\s+графік\S*\s+аварійн/i;
const RE_GAV = new RegExp(word("ГАВ").source + "|графік\\S*\\s+аварійн\\S*\\s+відключ|аварійн\\S*\\s+відключ", "i");
// «скасування» має стосуватися саме ГАВ/аварійних, а не, наприклад, «ГПВ не застосовуються»
const STOP = "скасов|скасув|відмін|не застосов|не діют|припин|завершен|знят";
const EM = "С?ГАВ|аварійн";
const RE_RETURN = /поверта\S+\s+до\s+(ГПВ|графік\S*\s+погодинн)/i;
const isCancel = (text) =>
  RE_RETURN.test(text) ||
  text.split(/[.,;:!\n]/).some((c) => new RegExp(EM, "i").test(c) && new RegExp(STOP, "i").test(c));

export function detectEmergency(posts, nowMs = Date.now()) {
  const recent = posts.filter((p) => nowMs - Date.parse(p.time) < 24 * 3600 * 1000);
  const relevant = recent.filter((p) => RE_SGAV.test(p.text) || RE_GAV.test(p.text));
  const last = relevant.at(-1);
  if (!last) return { active: false, type: null, text: null, postedAt: null, link: null };
  const type = RE_SGAV.test(last.text) ? "СГАВ" : "ГАВ";
  const cancelled = isCancel(last.text);
  const fresh = nowMs - Date.parse(last.time) < 18 * 3600 * 1000;
  return {
    active: !cancelled && fresh,
    type,
    text: last.text.slice(0, 400),
    postedAt: last.time,
    link: last.link,
  };
}

// ---------- запис лише при змінах ----------
async function writeIfChanged(file, payload, stampKey) {
  const full = path.join(DATA_DIR, file);
  let old = null;
  try { old = JSON.parse(await readFile(full, "utf8")); } catch {}
  const strip = (o) => { if (!o) return o; const c = { ...o }; delete c[stampKey]; return JSON.stringify(c); };
  const same = old && strip(old) === strip(payload);
  const oldAge = old?.[stampKey] ? Date.now() - Date.parse(old[stampKey]) : Infinity;
  if (same && oldAge < 60 * 60 * 1000) return false; // нічого нового — не комітимо частіше ніж раз на годину
  await writeFile(full, JSON.stringify(payload, null, 1) + "\n");
  return true;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const checkedAt = new Date().toISOString();

  try {
    const src = JSON.parse(await getText(SCHEDULE_URL));
    const sched = { checkedAt, ...convertSchedule(src) };
    if (!sched.days.length) throw new Error("порожній графік");
    console.log("schedule:", (await writeIfChanged("schedule.json", sched, "checkedAt")) ? "оновлено" : "без змін",
      sched.days.map((d) => d.date).join(", "));
  } catch (e) {
    console.error("Графік не отримано, лишаю попередній:", e.message);
  }

  try {
    const posts = parseTelegram(await getText(TELEGRAM_URL));
    if (!posts.length) throw new Error("не знайдено дописів");
    const g = globalThis.GAV.gavState(posts);
    const status = { checkedAt, emergency: {
      active: g.active, type: g.type, queues: g.queues, since: g.since,
      text: g.last ? g.last.text.slice(0, 400) : null,
      postedAt: g.last ? g.last.time : null, link: g.last ? g.last.link : "https://t.me/poltavaOE",
      lastKind: g.last ? g.last.kind : null,
    } };
    console.log("status:", (await writeIfChanged("status.json", status, "checkedAt")) ? "оновлено" : "без змін",
      JSON.stringify(status.emergency).slice(0, 160));
  } catch (e) {
    console.error("Telegram недоступний, лишаю попередній статус:", e.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
