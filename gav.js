// Стан ГАВ / СГАВ за дописами Telegram-каналу Полтаваобленерго.
// Дописи йдуть подіями: «ввести ГАВ (1-5 черга)», «ввести ГАВ в повному обсязі»,
// «скасовано ГАВ 6-10 черги», «скасовано ГАВ в повному обсязі» тощо.
// Проходимо їх по черзі й рахуємо, які черги ГАВ (1–10) діють зараз.
// Черги ГАВ — це окрема нумерація, не те саме, що черги ГПВ (1.1–6.2).
(function (root) {
  "use strict";
  const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const norm = (s) => String(s || "").replace(/[’`ʼ]/g, "'").replace(/\s+/g, " ");
  const MENTION = /(^|[^А-ЯІЇЄҐа-яіїєґ])С?ГАВ([^А-ЯІЇЄҐа-яіїєґ]|$)|аварійн\S*\s+відключ/i;
  const CANCEL = /скасова|скасув|відмін|припин|завершен/i;
  const INTRO = /застосова|ввести|введен|вводит|запровадж|діють|діятим/i;

  function queuesOf(t) {
    if (/повном\S*\s+обсяз/i.test(t)) return ALL.slice();
    const r = t.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(?:черг|\))/i) || t.match(/\(\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})/);
    if (r) { const a = +r[1], b = +r[2]; return ALL.filter((q) => q >= Math.min(a, b) && q <= Math.max(a, b)); }
    const n = t.match(/(?:ГАВ|обсяз\S*)\s*(?:в\s+обсязі\s*)?(\d{1,2})\s*черг/i);
    if (n) return ALL.slice(0, Math.min(10, +n[1]));
    return null; // не вказано — вважаємо, що всі
  }

  // «О 17:28 …» — час події з тексту (київський), інакше час допису
  function kyivAt(posted, h, m) {
    // зсув Києва від UTC на момент допису (працює і на GitHub, де час UTC)
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(posted);
    const g = (t) => +p.find((x) => x.type === t).value;
    const localAsUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    const offset = localAsUTC - Math.floor(posted / 60000) * 60000;
    return new Date(Date.UTC(g("year"), g("month") - 1, g("day"), h, m) - offset);
  }
  function eventTime(t, posted) {
    const m = t.match(/(?:^|[^А-ЯІЇЄҐа-яіїєґA-Za-z])[ОоO]\s*(\d{1,2})[:.](\d{2})/);
    if (!m) return posted;
    const d = kyivAt(posted, +m[1], +m[2]);
    return d > new Date(+posted + 3600e3) || posted - d > 12 * 3600e3 ? posted : d;
  }

  // posts: [{time: ISO, text, link}], будь-який порядок
  function gavState(posts, now = new Date()) {
    const recent = (posts || [])
      .filter((p) => now - new Date(p.time) < 24 * 3600e3 && new Date(p.time) <= now)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    let active = new Set(), type = null, since = null, last = null;
    for (const p of recent) {
      const t = norm(p.text);
      if (!MENTION.test(t)) continue;
      const posted = new Date(p.time);
      const qs = queuesOf(t) || ALL;
      if (CANCEL.test(t)) {
        qs.forEach((q) => active.delete(q));
        if (/повном\S*\s+обсяз/i.test(t) || !queuesOf(t)) active.clear();
        if (!active.size) { since = null; type = null; }
        last = { kind: "cancel", time: eventTime(t, posted).toISOString(), text: p.text, link: p.link };
      } else if (INTRO.test(t)) {
        const wasEmpty = !active.size;
        qs.forEach((q) => active.add(q));
        type = /(^|[^А-ЯІЇЄҐа-яіїєґ])СГАВ|спеціальн/i.test(t) ? "СГАВ" : (type || "ГАВ");
        if (wasEmpty) since = eventTime(t, posted).toISOString();
        last = { kind: "intro", time: eventTime(t, posted).toISOString(), text: p.text, link: p.link };
      }
    }
    const queues = [...active].sort((a, b) => a - b);
    return { active: queues.length > 0, type: queues.length ? type || "ГАВ" : null, queues, since, last };
  }

  // [1,2,3,4,5,9] → «1–5, 9»
  function rangeText(qs) {
    if (!qs || !qs.length) return "";
    if (qs.length === 10) return "усі черги";
    const out = []; let a = qs[0], b = qs[0];
    for (const q of qs.slice(1).concat([null])) {
      if (q === b + 1) { b = q; continue; }
      out.push(a === b ? `${a}` : `${a}–${b}`); a = b = q;
    }
    return (qs.length === 1 ? "черга " : "черги ") + out.join(", ");
  }

  // Розбір сторінки t.me/s/<канал>
  function parseTelegram(html) {
    const decode = (s) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).trim();
    const posts = [];
    for (const b of String(html || "").split('class="tgme_widget_message_wrap').slice(1)) {
      const id = (b.match(/data-post="([^"]+)"/) || [])[1];
      const time = (b.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
      const txt = (b.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      if (id && time && txt) posts.push({ link: "https://t.me/" + id, time: new Date(time).toISOString(), text: decode(txt) });
    }
    return posts;
  }

  root.GAV = { gavState, rangeText, parseTelegram, queuesOf };
})(typeof window !== "undefined" ? window : globalThis);
