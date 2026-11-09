// Графік погодинних відключень напряму з сайту Полтаваобленерго.
// Сайт віддає HTML-таблиці (на сьогодні і, якщо вже є, на завтра) і дозволяє
// запити з будь-яких сайтів (Access-Control-Allow-Origin: *).
// Клітинки: gpv-s1 — світло є, gpv-s2 — немає, gpv-s3 — перемикання/можливо; 48 клітинок по 30 хв.
(function (root) {
  "use strict";
  const URL = "https://www.poe.pl.ua/customs/newgpv-info.php";
  const MONTHS = { "січня": 1, "лютого": 2, "березня": 3, "квітня": 4, "травня": 5, "червня": 6,
    "липня": 7, "серпня": 8, "вересня": 9, "жовтня": 10, "листопада": 11, "грудня": 12 };
  const pad = (n) => String(n).padStart(2, "0");

  function parse(html) {
    const days = [];
    for (const chunk of String(html || "").split(/class="gpvinfodetail"/).slice(1)) {
      const text = chunk.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
      const m = text.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\s+(\d{4})/);
      if (!m) continue;
      const date = `${m[3]}-${pad(MONTHS[m[2]])}-${pad(m[1])}`;
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

  // дата у форматі сайту: ДД-ММ-РРРР (за київським часом)
  function kyivDate(d = new Date()) {
    const p = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g("day")}-${g("month")}-${g("year")}`;
  }

  async function fetchDays(timeoutMs = 12000) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "seldate=" + encodeURIComponent(JSON.stringify({ date_in: kyivDate() })),
        signal: ctrl?.signal,
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return parse(await r.text());
    } finally { if (timer) clearTimeout(timer); }
  }

  // Розвантаження (ГАВ, СГАВ, ГОП…) на сьогодні й завтра
  const UNLOAD_URL = "https://www.poe.pl.ua/customs/unloading-info.php";
  async function fetchUnloading(timeoutMs = 12000) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(UNLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "seldate=" + encodeURIComponent(JSON.stringify({ date_in: kyivDate() })),
        signal: ctrl?.signal,
      });
      const t = (await r.text()).trim();
      return t ? JSON.parse(t) : [];
    } finally { if (timer) clearTimeout(timer); }
  }

  // "09-11-2026" + 9:44 → Date (київський час; телефон теж у Києві)
  const toDate = (dmy, h, m) => { const [d, mo, y] = dmy.split(" ")[0].split("-").map(Number); return new Date(y, mo - 1, d, h || 0, m || 0); };

  // Чи діють зараз ГАВ / СГАВ.
  // list — розвантаження з сайту; tg — статус із Telegram (через GitHub): {active, type, postedAt, link, text}
  // Сайт не прибирає ГАВ після скасування, тому скасування беремо з Telegram.
  function emergencyNow(list, tg, now = new Date()) {
    const cur = (list || []).filter((e) => /С?ГАВ/.test(e.unloadingtypename || ""))
      .map((e) => ({
        type: /СГАВ/.test(e.unloadingtypename) ? "СГАВ" : "ГАВ",
        from: toDate(e.unloaddata, e.beginhour, e.beginminute),
        to: toDate(e.unloaddata, e.endhour, e.endminute === 59 ? 59 : e.endminute),
        created: e.createddate ? toDate(e.createddate, +e.createddate.split(" ")[1]?.split(":")[0], +e.createddate.split(" ")[1]?.split(":")[1]) : null,
        note: e.note || "",
      }))
      .filter((e) => e.from <= now && now <= new Date(+e.to + 60000))
      .sort((a, b) => b.from - a.from)[0];
    const tgTime = tg?.postedAt ? new Date(tg.postedAt) : null;
    if (cur) {
      // у Telegram після оголошення написали «скасовано» — не показуємо
      if (tg && !tg.active && tgTime && cur.created && tgTime > cur.created) return null;
      return { active: true, type: cur.type, from: cur.from, note: cur.note, link: tg?.link || "https://t.me/poltavaOE", source: "poe.pl.ua" };
    }
    // на сайті нічого немає, але Telegram свіжий і каже «діють»
    if (tg?.active && tgTime && now - tgTime < 18 * 3600e3) return { active: true, type: tg.type, from: tgTime, link: tg.link, source: "telegram" };
    return null;
  }

  root.POE = { parse, fetchDays, fetchUnloading, emergencyNow, kyivDate, URL };
})(typeof window !== "undefined" ? window : globalThis);
