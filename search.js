// Пошук черги за адресою у файлі data/addresses.json (з PDF Полтаваобленерго).
// У PDF адреси записані вільним текстом: «вул. Злагоди-14, 15, 15б, 19а…»,
// «Калантаївська 106-120 (парні)», «с.Деревки повністю» тощо.
// Тому шукаємо так: місто → вулиця (за основою слова) → номери будинків, що стоять одразу після неї.
(function (root) {
  "use strict";
  const L = "а-яіїєґa-z'";
  const SETTLE = /(?:^|[^а-яіїєґa-z'])(?:м|с|смт|сщ|село|селище|місто|мисто)\.?\s*([а-яіїєґ'][а-яіїєґ'-]{2,})/g;
  const N = (s) => s.toLowerCase().replace(/[’`ʼ]/g, "'").replace(/ё/g, "е").replace(/і/g, "и").replace(/є/g, "е");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const STOP = new Set(("м місто с село смт селище сщ вул вулиця пров провулок просп проспект бульв бульвар пл площа " +
    "буд будинок б кв квартира корп обл область район р-н полтавська полтавський україна тупик туп шосе узвіз майдан").split(" "));
  const HOUSE = /^\d+[а-яіїє]?(\/\d+[а-яіїє]?)?$/;
  const CITY = {
    "полтав": "Полтавська", "карлівк": "Полтавська", "решетил": "Полтавська", "диканьк": "Полтавська",
    "кременч": "Кременчуцька", "горішн": "Кременчуцька", "глобин": "Кременчуцька", "козельщ": "Кременчуцька",
    "кобеляк": "Кременчуцька", "семенів": "Кременчуцька", "градизьк": "Кременчуцька",
    "лубн": "Лубенська", "хорол": "Лубенська", "пирятин": "Лубенська", "гребінк": "Лубенська", "оржиц": "Лубенська", "чорнух": "Лубенська",
    "миргород": "Миргородська", "гадяч": "Миргородська", "лохвиц": "Миргородська", "зіньків": "Миргородська", "шишак": "Миргородська", "ромодан": "Миргородська",
  };
  const stem = (w) => (w.length >= 7 ? w.slice(0, -2) : w.length >= 4 ? w.slice(0, -1) : w);
  const words = (s) => N(s).split(/[^0-9а-яіїєґa-z'\/-]+/).flatMap((w) => w.split(/(?<=[а-яіїєґ'])-|-(?=[а-яіїєґ])/)).filter(Boolean);

  function parseQuery(q) {
    const segs = q.split(",").map((s) => s.trim()).filter(Boolean);
    const all = words(q);
    const house = [...all].reverse().find((w) => HOUSE.test(w)) || null;
    let place = [], street = [];
    const clean = (s) => words(s).filter((w) => !STOP.has(w) && !HOUSE.test(w) && w.length > 1);
    if (segs.length >= 2 && !segs[0].match(/\d/)) {
      place = clean(segs[0]); street = segs.slice(1).flatMap(clean);
    } else {
      const ws = clean(q);
      if (ws.length > 1 && Object.keys(CITY).some((c) => ws[0].startsWith(c))) { place = [ws[0]]; street = ws.slice(1); }
      else street = ws;
    }
    if (!street.length && place.length) { street = place; place = []; } // лише населений пункт («с. Деревки»)
    return { house, place: place.length ? stem(place[place.length - 1]) : null, street };
  }

  // номери будинків, перелічені одразу після назви вулиці
  function housesAfter(n, pos) {
    let s = n.slice(pos, pos + 400).replace(new RegExp(`^[${L}]*`), "");
    const list = []; let whole = false;
    for (let t of s.split(/[\s,;]+/)) {
      t = t.replace(/^[-–:.]+/, "").replace(/^(буд|б|корп|№)\.?/, "").replace(/[()]+/g, "").replace(/[.]+$/, "");
      if (!t) continue;
      if (/^(не)?парн/.test(t)) { const last = list[list.length - 1]; if (last && last.to) last.parity = t.startsWith("не") ? 1 : 0; continue; }
      if (/^(і|та|до|з|по|сторона|буд|б|кв|корп|№|д\/с|школа)$/.test(t)) continue;
      if (/^повніст/.test(t)) { whole = true; break; }
      const m = t.match(/^(\d+[а-яіїє]?(?:\/\d+[а-яіїє]?)?)(?:[-–](\d+)[а-яіїє]?)?$/);
      if (m) {
        const a = parseInt(m[1]), b = m[2] ? parseInt(m[2]) : null;
        if (b && b > a) list.push({ from: a, to: b });   // діапазон «106-120»
        else list.push({ v: m[1] });                    // «9-1» — це корпус, лишаємо «9»
        continue;
      }
      if (/^\d/.test(t)) continue;
      break; // далі почалася інша вулиця або населений пункт
    }
    return { list, whole };
  }

  function houseScore(list, h) {
    const hi = parseInt(h), hNum = String(hi);
    let best = 0;
    for (const e of list) {
      if (e.v) {
        if (e.v === h) return 3;
        if (e.v.split("/")[0] === h) best = Math.max(best, 2.8);
        if (e.v === hNum || e.v.split("/")[0] === hNum) best = Math.max(best, 2.2); // «25» для «25а»
      } else if (hi >= e.from && hi <= e.to && (e.parity === undefined || hi % 2 === e.parity)) best = Math.max(best, 2.6);
    }
    return best;
  }

  // найближчий населений пункт, згаданий перед позицією
  function settlementBefore(n, idx) {
    SETTLE.lastIndex = 0; let m, last = null;
    while ((m = SETTLE.exec(n)) && m.index < idx) last = m[1];
    return last;
  }

  function search(rows, query, limit = 12, ignoreHouse = false) {
    const q = parseQuery(query);
    if (ignoreHouse) q.house = null;
    if (!q.street.length) return { query: q, results: [] };
    const sw = q.street.map((w) => N(w));
    const key = [...sw].filter((w) => !/^\d/.test(w)).sort((a, b) => b.length - a.length)[0] || sw[0];
    const st = stem(key);
    if (st.length < 3) return { query: q, results: [] };
    const extra = sw.filter((w) => w !== key).map(stem).filter((w) => w.length >= 2);
    const place = q.place && N(q.place);
    const branch = place && Object.entries(CITY).find(([c]) => place.startsWith(N(c)) || N(c).startsWith(place))?.[1];
    const re = new RegExp(`(^|[^${L}])${esc(st)}`, "g");
    // кінець назви вулиці разом з іншими її словами («героїв ато-10» → позиція перед «10»)
    const endRe = new RegExp(`^${esc(st)}[${L}]*` + (extra.length ? `(?:[\\s.\\-]+(?:${extra.map(esc).join("|")})[${L}]*)*` : ""));
    const out = [];
    for (const r of rows) {
      const n = r.n || (r.n = N(r.t));
      re.lastIndex = 0; let m, best = null;
      while ((m = re.exec(n))) {
        const idx = m.index + m[1].length;
        const nameLen = n.slice(idx).match(endRe)[0].length;
        const { list, whole } = housesAfter(n, idx + nameLen);
        let score, kind;
        if (whole || !list.length) { score = 2; kind = "whole"; }          // уся вулиця / населений пункт
        else if (!q.house) { score = 1.6; kind = "street"; }               // будинок не вказали
        else { score = houseScore(list, q.house); kind = "house"; }
        if (!score) continue;
        // інші слова назви («Героїв АТО», «Павла Скоропадського») мають стояти поруч
        if (extra.length) {
          const near = n.slice(Math.max(0, idx - 25), idx + key.length + 25);
          const hit = extra.filter((e) => new RegExp(`(^|[^${L}])${esc(e)}`).test(near)).length;
          score += hit === extra.length ? 0.3 : -1.5;
        }
        if (place) {
          const sp = settlementBefore(n, idx);
          if (sp) score += sp.startsWith(place) ? 1.5 : -1.2;
          else if (branch && r.b) score += r.b.startsWith(branch) ? 0.4 : -0.6;
        }
        if (!best || score > best.score) best = { score, idx, kind, len: nameLen };
      }
      if (!best || best.score <= 0) continue;
      out.push({ q: r.q, b: r.b, score: +best.score.toFixed(2), kind: best.kind, t: r.t, at: best.idx, len: best.len });
    }
    out.sort((a, b) => b.score - a.score);
    // номер будинку ніде не знайдено — покажемо хоча б вулицю
    if (!out.length && q.house && !ignoreHouse) {
      const res = search(rows, query, limit, true);
      res.results.forEach((r) => (r.approx = true));
      res.query.house = q.house;
      return res;
    }
    return { query: q, results: out.slice(0, limit) };
  }

  // Однозначна відповідь: усі найкращі збіги вказують на одну підчергу
  function decide(results) {
    if (!results.length || results[0].approx) return null;
    const top = results[0];
    const other = results.find((r) => r.q !== top.q);
    return top.score >= 2 && (!other || top.score - other.score >= 0.5) ? top.q : null;
  }

  function snippet(r, before = 70, after = 150) {
    const a = Math.max(0, r.at - before), b = Math.min(r.t.length, r.at + after);
    return { pre: (a ? "…" : "") + r.t.slice(a, r.at), hit: r.t.slice(r.at, r.at + r.len), post: r.t.slice(r.at + r.len, b) + (b < r.t.length ? "…" : "") };
  }

  root.AddrSearch = { search, decide, snippet, parseQuery };
})(typeof window !== "undefined" ? window : globalThis);
