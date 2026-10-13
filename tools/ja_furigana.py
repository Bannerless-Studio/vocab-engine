#!/usr/bin/env python3
"""Per-word furigana for the Japanese pack's kanji words, from JmdictFurigana.

Writes tools/ja_furigana.json: {word id: {"w": headword, "ruby": [[start, end, reading], ...]}} for
every kanji word of <ja repo>/pack/words.json (default ../japanese). A ruby range is in UTF-16 code
units of "w" (as sentences.json ruby), the reading in hiragana. tools/packbuilder `kanji-aids` reads
the committed table (no network) and writes each word's `ruby`.

Source: github.com/Doublevil/JmdictFurigana, release 2.3.1+2026-09-25, JmdictFurigana.txt (built on
JMdict, EDRDG, CC BY-SA 4.0). Lines read `text|reading|0:こん;1:にち`, a single kanji index or a span
`0-1:きょう` (one reading over two kanji). A word aligns when some line has its headword and its
pron (katakana to hiragana, leading 〜 stripped). Words with no line, or with more than one, take
tools/ja_furigana_overrides.json {word id: {"w", "ruby", "reason"}}; any other miss fails the run.

Usage: python3 tools/ja_furigana.py [JA_REPO_DIR] [--fetch]   (default ../japanese)
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "ja-src")
RELEASE = "2.3.1+2026-09-25"
SOURCE_FILE = os.path.join(CACHE, "JmdictFurigana.txt")
OUT = os.path.join(ROOT, "tools", "ja_furigana.json")
OVERRIDES = os.path.join(ROOT, "tools", "ja_furigana_overrides.json")
KANJI_RE = re.compile("[㐀-䶿一-鿿豈-﫿々]")
KATA = "ァ-ヶ"


def hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def load_source(path=SOURCE_FILE):
    index = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            parts = line.rstrip("\n").split("|")
            if len(parts) != 3:
                continue
            index.setdefault((parts[0], hira(parts[1])), []).append(hira(parts[2]))
    return index


def ruby_of(w, ranges):
    """JmdictFurigana ranges -> [[start, end, reading]] in UTF-16 units of w. A leading 〜 (a
    suffix or counter headword) is not in JMdict's text, so the ranges are shifted past it."""
    base = w.lstrip("〜")
    lead = len(w[:len(w) - len(base)].encode("utf-16-le")) // 2
    out = []
    for seg in ranges.split(";"):
        span, _, kana = seg.partition(":")
        a, _, b = span.partition("-")
        a = int(a)
        b = int(b) if b else a
        start = lead + len(base[:a].encode("utf-16-le")) // 2
        end = lead + len(base[:b + 1].encode("utf-16-le")) // 2
        out.append([start, end, kana])
    return out


def build(words, index, overrides):
    table, misses, ambiguous = {}, [], []
    for x in words:
        w = x["w"]
        if not KANJI_RE.search(w):
            continue
        rd = hira(x["pron"].strip("〜"))
        hits = sorted({json.dumps(ruby_of(w, r), ensure_ascii=False) for r in index.get((w.lstrip("〜"), rd), [])})
        if len(hits) == 1:
            table[x["id"]] = {"w": w, "ruby": json.loads(hits[0])}
        elif x["id"] in overrides:
            o = overrides[x["id"]]
            if o["w"] != w:
                raise SystemExit(f"ja_furigana: override {x['id']} is for {o['w']!r}, the word is {w!r}")
            table[x["id"]] = {"w": w, "ruby": o["ruby"]}
        elif hits:
            ambiguous.append(f"{x['id']} {w} {len(hits)} readings")
        else:
            misses.append(f"{x['id']} {w} {x['pron']}")
    if misses or ambiguous:
        raise SystemExit("ja_furigana: no single alignment, add an override with a reason: "
                         + "; ".join(misses + ambiguous))
    return table


def load_overrides(path=OVERRIDES):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for k, e in data.items():
        if k.startswith("_"):
            continue
        if not e.get("reason") or not e.get("ruby") or not e.get("w"):
            raise SystemExit(f"ja_furigana: override {k} needs w, ruby and a reason")
        out[k] = e
    return out


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    ja = os.path.abspath(args[0]) if args else os.path.join(os.path.dirname(ROOT), "japanese")
    if not os.path.exists(SOURCE_FILE):
        if "--fetch" not in argv:
            raise SystemExit(f"ja_furigana: {SOURCE_FILE} missing; run with --fetch")
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(["gh", "release", "download", RELEASE, "--repo", "Doublevil/JmdictFurigana",
                        "--pattern", "JmdictFurigana.txt", "--dir", CACHE, "--clobber"], check=True)
    with open(os.path.join(ja, "pack", "words.json"), encoding="utf-8") as f:
        words = json.load(f)
    overrides = load_overrides()
    table = build(words, load_source(), overrides)
    n_kanji = sum(1 for x in words if KANJI_RE.search(x["w"]))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps(dict(sorted(table.items())), ensure_ascii=False, indent=1) + "\n")
    n_ov = sum(1 for k in table if k in overrides)
    print(f"kanji words {n_kanji}: aligned {len(table) - n_ov}, overrides {n_ov}, missing 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
