#!/usr/bin/env python3
"""Kanji data for the Japanese pack: meanings, readings and KRADFILE parts per distinct kanji.

Writes tools/ja_hints.json: {kanji: {"meaning", "on", "kun", "parts"}} for every distinct kanji of
<ja repo>/pack/words.json (default ../japanese). tools/packbuilder `kanji-aids` reads the committed
table (no network) and writes the characters.json `hint` lists (docs/PACK_SCHEMA.md "hint").

Sources (EDRDG, CC BY-SA 4.0; never committed, cached in .cache/ja-src/):
  KANJIDIC2  http://www.edrdg.org/kanjidic/kanjidic2.xml.gz   meanings (English, no m_lang) and readings
  KRADFILE   http://ftp.edrdg.org/pub/Nihongo/kradzip.zip     EUC-JP, component radicals per kanji
  (SKIP codes inside KANJIDIC2 carry a separate licence and are not used.)

meaning   the first two English glosses of KANJIDIC2 that are not radical notes, ", "-joined; tools/ja_hints_overrides.json
          "_meanings" wins for a kanji (the 々 repeat mark has no KANJIDIC entry).
on, kun   readings from KANJIDIC2, okurigana dots removed.
parts     [[component, gloss-or-null]] from KRADFILE in its order, the kanji itself left out (a
          primitive has none) and non-CJK strokes (｜) left out; gloss is the first KANJIDIC2
          gloss of the component when it has one, else null.

Usage: python3 tools/ja_hints.py [JA_REPO_DIR] [--fetch]   (default ../japanese)
"""
import gzip
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "ja-src")
KANJIDIC_URL = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
KRADZIP_URL = "http://ftp.edrdg.org/pub/Nihongo/kradzip.zip"
KANJIDIC_PATH = os.path.join(CACHE, "kanjidic2.xml.gz")
KRADZIP_PATH = os.path.join(CACHE, "kradzip.zip")
OUT = os.path.join(ROOT, "tools", "ja_hints.json")
OVERRIDES = os.path.join(ROOT, "tools", "ja_hints_overrides.json")
KANJI_RE = re.compile("[㐀-䶿一-鿿豈-﫿々]")
KANA_RE = re.compile("[ぁ-ゖァ-ヺー]")
MEANINGS_PER_KANJI = 2
# KANJIDIC2 gives a radical's own entry as "two-branch tree radical (no. 115)", and a kanji that is a
# radical lists "one radical (no.1)" as a gloss; neither is a meaning a learner should read.
RADICAL_NOTE = re.compile(r"\bradical\b.*\(no\.\s*\d+\)|\(no\.\s*\d+\)", re.I)


def fetch(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(url, path)


def load_kanjidic(path=KANJIDIC_PATH):
    root = ET.parse(gzip.open(path)).getroot()
    out = {}
    for ch in root.iter("character"):
        lit = ch.findtext("literal")
        glosses = [m.text.strip() for m in ch.iter("meaning") if m.text and not m.get("m_lang")]
        on = [r.text for r in ch.iter("reading") if r.get("r_type") == "ja_on" and r.text]
        kun = [r.text.replace(".", "") for r in ch.iter("reading") if r.get("r_type") == "ja_kun" and r.text]
        out[lit] = {"glosses": glosses, "on": on, "kun": kun}
    return out


def load_kradfile(path=KRADZIP_PATH):
    with zipfile.ZipFile(path) as z:
        raw = z.read("kradfile")
    out = {}
    for line in raw.decode("euc_jp", errors="replace").splitlines():
        if line.startswith("#") or " : " not in line:
            continue
        k, _, comps = line.partition(" : ")
        out[k.strip()] = comps.split()
    return out


def distinct_kanji(words_path):
    with open(words_path, encoding="utf-8") as f:
        words = json.load(f)
    seen = []
    for w in words:
        for c in w["w"]:
            if KANJI_RE.match(c) and c not in seen:
                seen.append(c)
    return seen


def load_overrides(path=OVERRIDES):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    meanings = data.get("_meanings", {})
    for k in meanings:
        if len(k) != 1 and not (":" in k and len(k.partition(":")[2]) == 1):
            raise SystemExit(f"ja_hints: _meanings key {k!r} must be a kanji or compound:kanji")
    return meanings


def gloss_of(glosses):
    """The learner gloss of a list of KANJIDIC2 glosses: radical notes dropped, "radical" removed."""
    kept = [g for g in glosses if not RADICAL_NOTE.search(g)] or glosses
    if not kept:
        return None
    g = re.sub(r"\s*\(no\.\s*\d+\)", "", kept[0])
    return re.sub(r"\s+radical$", "", g).strip() or None


def build(kanji, kd, kr, meanings):
    table = {}
    for c in kanji:
        e = kd.get(c, {"glosses": [], "on": [], "kun": []})
        kept = [g for g in e["glosses"] if not RADICAL_NOTE.search(g)] or e["glosses"]
        meaning = meanings.get(c) or ", ".join(kept[:MEANINGS_PER_KANJI]) or None
        parts = []
        for comp in kr.get(c, []):
            if comp == c or not (KANJI_RE.match(comp) or KANA_RE.match(comp)):
                continue
            parts.append([comp, gloss_of((kd.get(comp) or {}).get("glosses") or [])])
        table[c] = {"meaning": meaning, "on": e["on"], "kun": e["kun"], "parts": parts}
    return table


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    ja = os.path.abspath(args[0]) if args else os.path.join(os.path.dirname(ROOT), "japanese")
    if "--fetch" in argv:
        fetch(KANJIDIC_URL, KANJIDIC_PATH)
        fetch(KRADZIP_URL, KRADZIP_PATH)
    for p in (KANJIDIC_PATH, KRADZIP_PATH):
        if not os.path.exists(p):
            raise SystemExit(f"ja_hints: {p} missing; run with --fetch")
    kanji = distinct_kanji(os.path.join(ja, "pack", "words.json"))
    table = build(kanji, load_kanjidic(), load_kradfile(), load_overrides())
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps(dict(sorted(table.items())), ensure_ascii=False, indent=1) + "\n")
    no_meaning = [c for c, e in table.items() if not e["meaning"]]
    no_parts = [c for c, e in table.items() if e["meaning"] and not e["parts"]]
    print(f"distinct kanji {len(table)}: meaning {len(table) - len(no_meaning)}, "
          f"with parts {len(table) - len(no_parts) - len(no_meaning)}, meaning only {len(no_parts)} "
          f"{''.join(no_parts)}, no meaning {len(no_meaning)} {''.join(no_meaning)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
