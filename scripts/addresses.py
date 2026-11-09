"""PDF «Графік погодинного відключення» Полтаваобленерго → data/addresses.json

Документ — це експорт з Excel: по чергах/підчергах і філіях йдуть пронумеровані
рядки з вільним текстом адрес. Зберігаємо кожен рядок як запис {q, b, t}:
q — підчерга ("1.1"), b — філія, t — текст адрес. Пошук робить сам застосунок.

Використання: python3 scripts/addresses.py шлях/до/файлу.pdf [data/addresses.json]
Потрібна утиліта pdftotext (poppler-utils).
"""
import json, re, subprocess, sys, datetime, pathlib

ORD = {"Перша": 1, "Друга": 2, "Третя": 3, "Четверта": 4, "П'ята": 5, "П’ята": 5, "Шоста": 6}
RE_Q = re.compile(r"^\s*(Перша|Друга|Третя|Четверта|П['’]ята|Шоста)\s+черга\s+(І{1,2})\s+підчерга", re.I)
RE_QTOP = re.compile(r"^\s*(Перша|Друга|Третя|Четверта|П['’]ята|Шоста)\s+черга\s*$")
RE_BRANCH = re.compile(r"^\s*(\S+)\s+(об'єднана|об’єднана)\s+філія|^\s*(Полтавська дільниця РЕМ)")
RE_TITLE = re.compile(r"Графік погодинного відключення")
RE_PAGE = re.compile(r"^\s*\d{1,3}\s*$")
RE_NUM = re.compile(r"^\s{0,6}(\d{1,4})\s+(\S.*)$")


def parse(text):
    q, branch, rows = None, None, []
    period = None
    block = []

    def flush():
        nonlocal block
        lines = [l for l in block if l.strip()]
        block = []
        if not lines or not q:
            return
        numbered = [RE_NUM.match(l) for l in lines]
        if all(numbered) and len(lines) > 1:
            parts = [m.group(2) for m in numbered]       # кілька однорядкових записів
        else:
            parts = [" ".join(RE_NUM.sub(r"\2", l).strip() for l in lines)]
        for p in parts:
            t = re.sub(r"\s+", " ", p).strip(" ;,")
            if len(t) > 2:
                rows.append({"q": q, "b": branch, "t": t})

    for line in text.splitlines():
        line = line.replace("\f", "")
        if RE_TITLE.search(line):
            flush()
            m = re.search(r"з\s+([\d.]+)р?\.?\s+по\s+([\d.]+)", line)
            if m: period = f"{m.group(1).rstrip('.')}–{m.group(2).rstrip('.')}"
            continue
        m = RE_Q.match(line)
        if m:
            flush(); q = f"{ORD[m.group(1).replace('’', chr(39))]}.{len(m.group(2))}"; continue
        if RE_QTOP.match(line):
            flush(); continue
        m = RE_BRANCH.match(line)
        if m and len(line.strip()) < 90:
            flush(); branch = (m.group(1) or "Полтавська").replace("Полтавська дільниця", "Полтавська")
            if m.group(3): branch = "Полтавська (РЕМ)"
            continue
        if RE_PAGE.match(line) or not line.strip():
            flush(); continue
        block.append(line)
    flush()
    # прибираємо повтори (рядок, перенесений на нову сторінку)
    seen, out = set(), []
    for r in rows:
        k = (r["q"], r["t"])
        if k not in seen:
            seen.add(k); out.append(r)
    return period, out


def main():
    pdf = pathlib.Path(sys.argv[1])
    dst = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "data/addresses.json")
    text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    period, rows = parse(text)
    if len(rows) < 100:
        sys.exit(f"Підозріло мало записів ({len(rows)}) — формат PDF міг змінитися, файл не перезаписую")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps({
        "source": pdf.name, "period": period,
        "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "rows": rows,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    from collections import Counter
    print(f"{dst}: {len(rows)} записів, період {period}", dict(sorted(Counter(r['q'] for r in rows).items())))


if __name__ == "__main__":
    main()
