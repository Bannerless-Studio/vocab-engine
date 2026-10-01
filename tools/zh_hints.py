#!/usr/bin/env python3
"""Character memory hints for packs/zh, from Make Me a Hanzi dictionary.txt.

Writes tools/zh_hints.json: {character: hint or null} for every distinct character
of packs/zh/characters.json units. tools/pack_from_hsk.py reads that committed table
(no network) and emits characters.json `hint` lists (docs/PACK_SCHEMA.md).

Source: github.com/skishore/makemeahanzi dictionary.txt at SOURCE_SHA (sha256 below),
LGPL-3.0-or-later, itself derived from Unihan and CJKlib. Downloaded once into
.cache/makemeahanzi/ (gitignored); `--fetch` downloads it when missing.

Hints are templates over the source's own fields, never free text (owner rule: short,
factual, no invented folk etymology):
  pictographic   "picture of <source hint>", or "picture of <meaning>" when too long
  ideographic    "A gloss + B gloss: <meaning>" over the decomposition's components;
                 with fewer than two known components, "<source hint>: <meaning>"
  pictophonetic  "A (meaning) + B (sound pinyin)"
  no etymology   "A gloss + B gloss" (components only, no claim how they combine)
Component gloss: the word before the component in the source's etymology hint
("A woman 女 with a son 子" -> woman, son), else the first sense of its own entry.
A character the source lacks, or whose template has no usable parts or runs over
MAX_WORDS words, gets null.

Usage: python3 tools/zh_hints.py [--fetch]
"""
import hashlib
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_SHA = "bddc96d41bef78427ed0e034e9f7e31d71fd1b92"
SOURCE_URL = f"https://raw.githubusercontent.com/skishore/makemeahanzi/{SOURCE_SHA}/dictionary.txt"
SOURCE_SHA256 = "744bb05d5b0742e9ee35c37791f94d56a173349b3367569e7ca11e510364d203"
CACHE = os.path.join(ROOT, ".cache", "makemeahanzi", "dictionary.txt")
OUT = os.path.join(ROOT, "tools", "zh_hints.json")
MAX_WORDS = 14
IDS = set(chr(c) for c in range(0x2FF0, 0x2FFC))
# Words before a component that name no meaning ("compare 子", "of 人").
STOP = {"a", "an", "the", "of", "compare", "and", "or", "to", "with", "in", "on", "by",
        "from", "for", "as", "is", "at", "into", "under", "over", "within", "between"}
# Single strokes have dictionary senses unrelated to their role as a part (丨 "number one",
# 乚 "secret"), and 丷/乛's sense is a romanized Korean term: these show bare.
BARE = set("丿丶丨乛亅乚乙⺈丷乀乁𠃌𠃊")
HAN = re.compile(r"[⺀-⿟㐀-䶿一-鿿豈-﫿\U00020000-\U0002FFFF]")


def load(path=CACHE):
    with open(path, "rb") as f:
        raw = f.read()
    got = hashlib.sha256(raw).hexdigest()
    if got != SOURCE_SHA256:
        raise SystemExit(f"zh_hints: {path} sha256 {got} != pinned {SOURCE_SHA256}")
    return {d["character"]: d for d in (json.loads(l) for l in raw.decode("utf-8").splitlines() if l.strip())}


def first_sense(definition):
    s = re.sub(r"\([^)]*\)", "", str(definition or "")).split(";")[0].split(",")[0].strip()
    return s if HAN.search(s) is None else ""


def leaves(decomp):
    return [c for c in str(decomp or "") if c not in IDS and c != "？"]


def comp_gloss(c, src_hint, dic):
    """A short gloss for component c (at most two words), or "" to show it bare."""
    if c in BARE:
        return ""
    if src_hint:
        m = re.search(r"([A-Za-z][A-Za-z'\-\"]*)[\"'\s]*\s" + re.escape(c), src_hint)
        if m:
            w = m.group(1).strip("\"'").lower()
            if w and w not in STOP:
                return w
    e = dic.get(c)
    g = first_sense(e.get("definition")) if e else ""
    return g if len(g.split()) <= 2 and not re.search(r"\d", g) else ""


def lower_article(s):
    """Lower-cases a sentence-initial capital ("A tree" -> "a tree"), not an acronym."""
    return s[0].lower() + s[1:] if len(s) > 1 and s[0].isupper() and not s[1].isupper() else s


def compose(c, dic):
    """The hint for character c, or None."""
    d = dic.get(c)
    if not d:
        return None
    ety = d.get("etymology") or {}
    kind, src = ety.get("type"), re.sub(r"\s+", " ", ety.get("hint") or "").strip()
    meaning = first_sense(d.get("definition"))
    parts_of = lambda: [p for p in (f"{x} {comp_gloss(x, src, dic)}".strip() for x in leaves(d.get("decomposition")))]
    if kind == "pictographic":
        pic = lower_article(src.split(";")[0].strip().rstrip("."))
        out = f"picture of {pic}" if pic and not HAN.search(pic) else ""
        if not out or len(out.split()) > MAX_WORDS:
            out = f"picture of {meaning}" if meaning else ""
    elif kind == "pictophonetic":
        parts = []
        sem, ph = ety.get("semantic"), ety.get("phonetic")
        if sem:
            g = (src or comp_gloss(sem, "", dic)).strip()
            parts.append(f"{sem} ({g})" if g else sem)
        if ph:
            py = ((dic.get(ph) or {}).get("pinyin") or [""])[0]
            parts.append(f"{ph} (sound {py})" if py else f"{ph} (sound)")
        out = " + ".join(parts) if parts else ""
    else:
        parts = parts_of()
        if len(parts) >= 2:
            out = " + ".join(parts)
            if kind == "ideographic" and meaning:
                out += f": {meaning}"
        elif kind == "ideographic" and src:
            # The source names fewer than two components (一, 母, 不): its own hint,
            # quoted as written, stands in for "A + B".
            out = lower_article(src) + (f": {meaning}" if meaning else "")
        else:
            return None
    if not out or len(out.split()) > MAX_WORDS:
        return None
    return out


def pack_chars():
    units = json.load(open(os.path.join(ROOT, "packs", "zh", "characters.json"), encoding="utf-8"))
    seen = []
    for u in units:
        for c in u["t"]:
            if c not in seen:
                seen.append(c)
    return seen


def main(argv):
    if not os.path.exists(CACHE):
        if "--fetch" not in argv:
            raise SystemExit(f"zh_hints: {CACHE} missing; run with --fetch")
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        urllib.request.urlretrieve(SOURCE_URL, CACHE)
    dic = load()
    chars = pack_chars()
    table = {c: (compose(c, dic) if HAN.match(c) else None) for c in chars}
    text = json.dumps(table, ensure_ascii=False, indent=0, sort_keys=True) + "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    han = [c for c in chars if HAN.match(c)]
    missing = [c for c in han if c not in dic]
    print(f"distinct characters {len(chars)} (han {len(han)}): hint {sum(1 for v in table.values() if v)}, "
          f"not in source {len(missing)} {''.join(missing)}, no usable template {len(han) - len(missing) - sum(1 for v in table.values() if v)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
