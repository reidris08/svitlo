"""Шукає на сайті Полтаваобленерго свіжий PDF «Графік погодинного відключення»
(перелік адрес по чергах) і, якщо він новий, завантажує його.

Вихід: шлях до завантаженого файлу у stdout (або порожньо, якщо нового немає).
Код 0 — усе гаразд (навіть якщо змін немає), 2 — сайт недоступний для GitHub.
"""
import json, pathlib, re, sys, urllib.request, urllib.parse

PAGE = "https://www.poe.pl.ua/disconnection/hrafik-pohodynnoho-vidkliuchennia-elektroenerhii/"
CURRENT = pathlib.Path("data/addresses.json")
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"}


def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main():
    try:
        html = get(PAGE).decode("utf-8", "replace")
    except Exception as e:
        print(f"::warning::Сайт poe.pl.ua недоступний з GitHub ({e}). "
              f"Завантажте новий PDF у папку pdf/ репозиторію — список адрес оновиться автоматично.", file=sys.stderr)
        sys.exit(2)

    links = re.findall(r'href="([^"]+\.pdf)"', html, re.I)
    links = [urllib.parse.urljoin(PAGE, l) for l in links]
    # перелік адрес ГПВ: у назві зазвичай HPV / GPV / hrafik
    cands = [l for l in links if re.search(r"hpv|gpv|hrafik|grafik", l, re.I)] or links
    if not cands:
        print("::warning::На сторінці не знайдено PDF — можливо, змінилася структура сайту", file=sys.stderr)
        return
    # найновіший: за шляхом /uploads/РРРР/ММ/ і порядком на сторінці
    def key(u):
        m = re.search(r"/uploads/(\d{4})/(\d{2})/", u)
        return (m.group(1) + m.group(2)) if m else "000000"
    latest = max(enumerate(cands), key=lambda x: (key(x[1]), -x[0]))[1]
    name = urllib.parse.unquote(latest.rsplit("/", 1)[-1])

    if CURRENT.exists():
        try:
            if json.loads(CURRENT.read_text(encoding="utf-8")).get("source") == name:
                print(f"Перелік адрес актуальний: {name}", file=sys.stderr)
                return
        except Exception:
            pass

    data = get(latest, timeout=120)
    if not data.startswith(b"%PDF"):
        print("::warning::Отримано не PDF (можливо, захист сайту)", file=sys.stderr)
        sys.exit(2)
    out = pathlib.Path("/tmp") / name
    out.write_bytes(data)
    print(f"Новий перелік адрес: {name}", file=sys.stderr)
    print(out)


if __name__ == "__main__":
    main()
