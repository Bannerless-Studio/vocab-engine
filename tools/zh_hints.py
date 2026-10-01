#!/usr/bin/env python3
"""Character memory hints for packs/zh, from Make Me a Hanzi dictionary.txt.

Writes tools/zh_hints.json: {character: hint or null} for every distinct character of
the hsk vocabulary (<hsk>/data/hsk_vocab.json, the input tools/pack_from_hsk.py reads),
so a new word's characters enter the table before packs/zh is rebuilt.
tools/pack_from_hsk.py reads the committed table (no network) and emits
characters.json `hint` lists (docs/PACK_SCHEMA.md); it fails when the table is stale.

Source: github.com/skishore/makemeahanzi dictionary.txt at SOURCE_SHA (sha256 below),
LGPL-3.0-or-later, itself derived from Unihan and CJKlib. Downloaded once into
.cache/makemeahanzi/ (gitignored); `--fetch` downloads it when missing.

Hints are templates over the source's own fields, never free text (owner rule: short,
factual, no invented folk etymology):
  ideographic    the source hint as written ("to speak 日 directly 疋") + ": <meaning>";
                 without a source hint "A gloss + B gloss: <meaning>"
  pictographic   "picture of <source hint>" with its Han characters taken out; null when
                 no content word remains
  pictophonetic  "A (meaning) + B (sound pinyin)"; a side the source omits is the other
                 top-level part of the decomposition, shown bare, else null
  no etymology   "A gloss + B gloss" for exactly two parts (no claim how they combine)
<meaning> is the first alternative of the character's own HSK gloss when it is a word
(engine/core.js glossParts), else the first sense of the source definition; it is
dropped when the hint would run over MAX_WORDS words. Component gloss: the word before
the component in the source hint ("A woman 女 with a son 子" -> woman, son), else the
first sense of its own entry. tools/zh_hints_overrides.json (each with a reason and a
source) wins over the rules. A character the source lacks, or whose hint has no usable
parts or runs over MAX_WORDS words, gets null.

Usage: python3 tools/zh_hints.py [HSK_REPO_DIR] [--fetch]   (default ../chinese, as pack_from_hsk.py)
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
OVERRIDES = os.path.join(ROOT, "tools", "zh_hints_overrides.json")
MAX_WORDS = 14
IDS = set(chr(c) for c in range(0x2FF0, 0x2FFC))
BINARY_IDS = IDS - {"⿲", "⿳"}
# Words before a component that name no meaning ("compare 子", "of 人").
STOP = {"a", "an", "the", "of", "compare", "and", "or", "to", "with", "in", "on", "by",
        "from", "for", "as", "is", "at", "into", "under", "over", "within", "between"}
# Words that describe the glyph's history, not its picture ("simplified form of 東").
META = STOP | {"simplified", "traditional", "form", "variant", "abbreviation", "visual",
               "radical", "character", "phonetic", "loan", "same", "also", "old", "ancient",
               "provides", "pronunciation", "see", "that", "etymology", "cursive", "version"}
# Single strokes have dictionary senses unrelated to their role as a part (丨 "number one",
# 乚 "secret"), and 丷/乛's sense is a romanized Korean term: these show bare.
BARE = set("丿丶丨乛亅乚乙⺈丷乀乁𠃌𠃊")
HAN = re.compile(r"[⺀-⿟㐀-䶿一-鿿豈-﫿\U00020000-\U0002FFFF]")
PR_NOTE = re.compile(r"^\(?\s*(?:also|colloquial)\s+pr\.\s*\[[^\]]*\]\s*\)?$", re.I)


def load(path=CACHE):
    with open(path, "rb") as f:
        raw = f.read()
    got = hashlib.sha256(raw).hexdigest()
    if got != SOURCE_SHA256:
        raise SystemExit(f"zh_hints: {path} sha256 {got} != pinned {SOURCE_SHA256}")
    return {d["character"]: d for d in (json.loads(l) for l in raw.decode("utf-8").splitlines() if l.strip())}


def words_of(n):
    return len(n.split())


def first_sense(definition):
    s = re.sub(r"\([^)]*\)", "", str(definition or "")).split(";")[0].split(",")[0].strip()
    return s if HAN.search(s) is None else ""


def split_top(s, seps=";,"):
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]" and depth > 0:
            depth -= 1
        if depth == 0 and ch in seps:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    return out + [cur]


def first_alt(en):
    """The first alternative of an HSK gloss, as engine/core.js glossParts reads it: top-level
    ";"/"," parts, reading notes dropped, (...) groups taken out."""
    g = re.sub(r"\s+", " ", str(en or "")).strip()
    for part in split_top(g):
        a = part.strip()
        if not a or PR_NOTE.match(a) or re.fullmatch(r"\[[^\]]*\]", a):
            continue
        text = re.sub(r"\s+", " ", re.sub(r"\([^()]*\)", "", a)).strip()
        if text:
            return text
    return ""


def parse_ids(s):
    """Decomposition string -> nested (op, [children]) tree, a leaf character, or None."""
    pos = 0

    def node():
        nonlocal pos
        if pos >= len(s):
            return None
        ch = s[pos]
        pos += 1
        if ch in IDS:
            kids = [node() for _ in range(2 if ch in BINARY_IDS else 3)]
            return (ch, kids)
        return ch

    return node() if s else None


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


FORM_NOTE = re.compile(r"^(?:(?:simplified|traditional|modern|ancient|old|variant|abbreviated)\s+form|variant|"
                       r"visual abbreviation|cursive version)\s+of\s*(?:[⺀-⿟㐀-䶿一-鿿豈-﫿\U00020000-\U0002FFFF]+)?\s*,?\s*", re.I)


def clean_src(src, c="", decomp=""):
    """The source hint as written, or "" when nothing but glyph history remains. Whitespace
    (incl. no-break space) collapsed; per ";" clause, a "compare X" cross-reference, a
    "simplified form of X" note and a "see that character" pointer dropped; Han characters
    the decomposition does not show (parts of the traditional form: 生's 屮) taken out, and a
    pronunciation note about such a character dropped; sentence-initial capital lowered."""
    absent = {h for h in HAN.findall(src or "") if h != c and h not in str(decomp or "")}
    kept = []
    for clause in re.sub(r"\s+", " ", src or "").split(";"):
        cl = FORM_NOTE.sub("", clause.strip())
        if re.match(r"(?i)compare\b|see that character", cl):
            continue
        if "pronunciation" in cl and any(h in absent for h in HAN.findall(cl)):
            continue
        cl = re.sub(r"\s*\(\s*\)", "", "".join(ch for ch in cl if ch not in absent))
        cl = re.sub(r"\s*\(altered\)", "", cl)
        cl = re.sub(r"\s+([,.)])", r"\1", re.sub(r"\s+", " ", cl)).strip(" ,.")
        if [w for w in re.findall(r"[A-Za-z][A-Za-z'\-]*", cl) if w.lower() not in META]:
            kept.append(cl)
    return lower_article("; ".join(kept))


def picture(src):
    """The source's picture description (its first ";" clause that has one) with Han
    characters taken out, or "" when nothing but glyph history remains
    ("Simplified form of 東, the sun 日 rising" -> "the sun rising")."""
    for clause in re.sub(r"\s+", " ", src or "").split(";"):
        s = FORM_NOTE.sub("", clause.strip())
        if re.match(r"(?i)compare\b", s):
            continue
        s = HAN.sub("", s)
        s = re.sub(r"\(\s*\)", "", s)
        s = re.sub(r"^\s*(?:an?\s+)?picture of\s+", "", s, flags=re.I)
        s = re.sub(r"\s+([,.])", r"\1", s)
        s = re.sub(r",\s*,+", ",", s)
        s = re.sub(r"\s+", " ", s).strip(" ,.")
        if [w for w in re.findall(r"[A-Za-z][A-Za-z'\-]*", s) if w.lower() not in META]:
            return lower_article(s)
    return ""


def with_meaning(base, meaning):
    if meaning and words_of(f"{base}: {meaning}") <= MAX_WORDS:
        return f"{base}: {meaning}"
    return base


def other_side(decomp, known):
    """The top-level part of decomp beside `known` when it is one character, else None."""
    t = parse_ids(str(decomp or ""))
    if not isinstance(t, tuple):
        return None
    kids = t[1]
    if known not in kids or len(kids) != 2:
        return None
    o = kids[1 - kids.index(known)]
    return o if isinstance(o, str) and o != "？" else None


def compose(c, dic, gloss=None):
    """The hint for character c, or None. gloss: the HSK gloss of c when c is itself a word."""
    d = dic.get(c)
    if not d:
        return None
    ety = d.get("etymology") or {}
    kind, raw = ety.get("type"), ety.get("hint") or ""
    src = re.sub(r"\s+", " ", raw).strip()
    meaning = first_alt(gloss) if gloss else ""
    meaning = meaning or first_sense(d.get("definition"))
    if kind == "pictographic":
        pic = picture(src)
        out = f"picture of {pic}" if pic else ""
    elif kind == "pictophonetic":
        sem, ph = ety.get("semantic"), ety.get("phonetic")
        if sem and not ph:
            ph_part = other_side(d.get("decomposition"), sem)
            if ph_part is None:
                return None
        elif ph and not sem:
            sem_part = other_side(d.get("decomposition"), ph)
            if sem_part is None:
                return None
        elif not (sem or ph):
            return None
        parts = []
        if sem:
            g = (src or comp_gloss(sem, "", dic)).strip()
            parts.append(f"{sem} ({g})" if g else sem)
        else:
            parts.append(sem_part)
        if ph:
            py = ((dic.get(ph) or {}).get("pinyin") or [""])[0]
            parts.append(f"{ph} (sound {py})" if py else f"{ph} (sound)")
        else:
            parts.append(ph_part)
        out = " + ".join(parts)
    elif kind == "ideographic" and src:
        base = clean_src(src, c, d.get("decomposition"))
        if not base:
            return None
        out = with_meaning(base, meaning)
    else:
        parts = [f"{x} {comp_gloss(x, src, dic)}".strip() for x in leaves(d.get("decomposition"))]
        if kind == "ideographic" and len(parts) >= 2:
            out = with_meaning(" + ".join(parts), meaning)
        elif kind is None and len(parts) == 2:
            out = " + ".join(parts)
        else:
            return None
    if not out or words_of(out) > MAX_WORDS:
        return None
    return out


def hsk_words(hsk):
    with open(os.path.join(hsk, "data", "hsk_vocab.json"), encoding="utf-8") as f:
        return json.load(f)


def table_chars(words):
    seen, out = set(), []
    for w in words:
        for c in w["w"]:
            if c not in seen:
                seen.add(c)
                out.append(c)
    return out


def load_overrides(path=OVERRIDES):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for c, e in data.items():
        if c.startswith("_"):
            continue
        if not (e.get("reason") and e.get("source")) or words_of(e["hint"]) > MAX_WORDS:
            raise SystemExit(f"zh_hints: override {c} needs a reason, a source and at most {MAX_WORDS} words")
        out[c] = e["hint"]
    return out


def build(words, dic, overrides):
    gloss = {w["w"]: w["en"] for w in words if len(w["w"]) == 1}
    table = {}
    for c in table_chars(words):
        table[c] = overrides[c] if c in overrides else (compose(c, dic, gloss.get(c)) if HAN.match(c) else None)
    return table


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    hsk = os.path.abspath(args[0]) if args else os.path.join(os.path.dirname(ROOT), "chinese")
    if not os.path.exists(CACHE):
        if "--fetch" not in argv:
            raise SystemExit(f"zh_hints: {CACHE} missing; run with --fetch")
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        urllib.request.urlretrieve(SOURCE_URL, CACHE)
    dic = load()
    words = hsk_words(hsk)
    table = build(words, dic, load_overrides())
    text = json.dumps(table, ensure_ascii=False, indent=0, sort_keys=True) + "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    han = [c for c in table if HAN.match(c)]
    missing = [c for c in han if c not in dic]
    hinted = sum(1 for v in table.values() if v)
    print(f"distinct characters {len(table)} (han {len(han)}): hint {hinted}, "
          f"not in source {len(missing)} {''.join(missing)}, no usable template {len(han) - len(missing) - hinted}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
