#!/usr/bin/env python3
"""Polyphonic-character TTS carriers for packs/zh (writes tools/zh_say.json + docs/ZH_SAY.md).

A device TTS reads a lone polyphonic character by its own default, which is often not the
pack's reading (还 hái was spoken huán: owner feedback 2026-10-01). For each word this finds
the characters whose pack syllable a TTS may misread and builds a carrier: the same text
with each such character replaced by a monophonic character of the identical syllable and
tone (还 hái -> 孩). pack_from_hsk.py copies the carriers into words.json / characters.json
`say`; the engine speaks `say` and never displays it (docs/PACK_SCHEMA.md words.json `say`).

Needs pypinyin and jieba (not pack dependencies): run from a venv outside the repo, e.g.
  python3 -m venv .cache/venv && .cache/venv/bin/pip install pypinyin jieba
  .cache/venv/bin/python tools/zh_say_scan.py [--write]
Without --write it prints the table and exits 1 when the checked-in files differ.

Candidates: every word and character unit whose pypinyin reading in context differs from
the pack's on some character, plus every single character with another reading in at least
MIN_PHRASES phrases of pypinyin's phrase dictionary (47k phrases; it stands in for what a TTS
has learned). Each gets a carrier when one can be built: every carrier character must be
monophonic (pypinyin heteronym=True gives exactly one reading) with the pack's syllable and
tone, so a carrier is harmless where the TTS was already right. A syllable with no common
monophonic character keeps the written form, listed in docs/ZH_SAY.md.
Confidence (how likely the original was misread) is recorded only:
  high    the pypinyin context reading differs, or the pack reading is not the character's
          most frequent phrase reading (还)
  medium  the other reading has at least MEDIUM_SHARE of the character's phrases
  low     a rarer real alternative
"""
import json
import os
import sys
import unicodedata
from collections import Counter, defaultdict

from pypinyin import Style, pinyin
from pypinyin.phrases_dict import phrases_dict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS = os.path.join(ROOT, "packs", "zh", "words.json")
SENTENCES = os.path.join(ROOT, "packs", "zh", "sentences.json")
UNITS = os.path.join(ROOT, "packs", "zh", "characters.json")
OUT_JSON = os.path.join(ROOT, "tools", "zh_say.json")
OUT_MD = os.path.join(ROOT, "docs", "ZH_SAY.md")
MIN_PHRASES = 3
MEDIUM_SHARE = 0.2
MIN_CARRIER_USE = 700
# Tone sandhi is applied by the TTS itself; erhua 儿 is written "r".
SANDHI = set("一不")

MARKS = {"̄": 1, "́": 2, "̌": 3, "̀": 4}


def norm(s):
    return unicodedata.normalize("NFC", s.lower().replace("'", "").replace(" ", "").replace("-", ""))


def bare(s):
    return "".join(ch for ch in unicodedata.normalize("NFD", s) if ch not in MARKS and ch != "̈") + ("v" if "ü" in s or "̈" in unicodedata.normalize("NFD", s) else "")


def tone(s):
    d = unicodedata.normalize("NFD", s)
    return next((t for m, t in MARKS.items() if m in d), 0)


def same_sound(a, b):
    """Equal, or differing only by a neutral tone (the TTS reads neutral tones from context)."""
    return a == b or (bare(a) == bare(b) and (tone(a) == 0 or tone(b) == 0))


def readings(ch):
    return [norm(r) for r in pinyin(ch, style=Style.TONE, heteronym=True)[0]]


PHRASE = defaultdict(Counter)
for ph, rs in phrases_dict.items():
    if len(ph) == len(rs):
        for c, r in zip(ph, rs):
            PHRASE[c][norm(r[0])] += 1


def align(word, pron):
    """Per-character syllables of the pack pron, or None."""
    p, n, memo = norm(pron), len(word), {}

    def go(i, k):
        if i == n:
            return [] if k == len(p) else None
        if (i, k) in memo:
            return memo[(i, k)]
        cands = set(readings(word[i]))
        if word[i] == "儿":
            cands.add("r")
        res = None
        for r in sorted(cands, key=len, reverse=True):
            seg = p[k:k + len(r)]
            if seg and bare(seg) == bare(r):
                rest = go(i + 1, k + len(r))
                if rest is not None:
                    res = [seg] + rest
                    break
        memo[(i, k)] = res
        return res
    return go(0, 0)


def monophonic(ch, syl):
    return readings(ch) == [syl] and set(PHRASE[ch]) <= {syl}


def char_use():
    """Commonness proxy: summed jieba dictionary frequency of the words containing a character."""
    import jieba
    use = Counter()
    with open(os.path.join(os.path.dirname(jieba.__file__), "dict.txt"), encoding="utf-8") as f:
        for line in f:
            w, n = line.split()[:2]
            for ch in set(w):
                use[ch] += int(n)
    return use


def carrier_pool(words, sentences, pack_syl):
    """Monophonic characters by syllable: characters of the pack first, then others used at
    least MIN_CARRIER_USE times in jieba's dictionary; each group most common first. A
    character the pack itself reads differently (喂 wéi, which pypinyin lists only as wèi)
    is never a carrier."""
    use = char_use()
    inpack = set("".join(w["w"] for w in words) + "".join(s["t"] for s in sentences))
    common = lambda ch: (-use[ch], ch)
    ranked = sorted(inpack, key=common) + sorted((ch for ch in use if ch not in inpack and use[ch] >= MIN_CARRIER_USE), key=common)
    by_syl = defaultdict(list)
    for ch in ranked:
        if "\u4e00" <= ch <= "\u9fff":
            for r in set(readings(ch)):
                if monophonic(ch, r) and pack_syl.get(ch, {r}) <= {r}:
                    by_syl[r].append(ch)
    return by_syl


def strictly_monophonic(ch, syl):
    """The hard rule for every carrier character: pypinyin heteronym=True gives exactly one
    reading, and it is syl."""
    return [norm(r) for r in pinyin(ch, style=Style.TONE, heteronym=True)[0]] == [syl]


def make_carrier(text, syl, pool):
    """Every character of the carrier is strictly monophonic with the pack syllable at its
    position: a kept character must already be, any other is replaced. None (with the
    reasons) when some position has no such character."""
    out, missing = [], []
    for ch, a in zip(text, syl):
        if strictly_monophonic(ch, a):
            out.append(ch)
            continue
        cands = [c for c in pool.get(a, []) if c != ch]
        if cands:
            out.append(cands[0])
        else:
            missing.append(f"no common monophonic {a} character for {ch}")
    if missing:
        return None, missing
    say = "".join(out)
    if say == text or not all(strictly_monophonic(c, x) for c, x in zip(say, syl)):
        return None, ["carrier check failed"]
    return say, []


def scan_items(items, pool):
    """items: [(id, text, pron)]. A row for every item where pypinyin's reading in context
    differs from the pack's on some character (neutral tone and 一/不 sandhi aside), or where
    a single character has another reading in at least MIN_PHRASES phrases (a TTS reads a
    lone character by its own default: 还 is hái in context-free pypinyin but huán in 103 of
    118 phrases, and the device said huán). Every row gets a carrier when one can be built."""
    rows = []
    for iid, text, pron in items:
        syl = align(text, pron)
        if syl is None:
            rows.append(dict(id=iid, t=text, pron=pron, conf="check", why="pron does not align with pypinyin readings", say=None, missing=["unaligned"]))
            continue
        ctx = [norm(x[0]) for x in pinyin(text, style=Style.TONE)]
        why, conf = [], None
        for ch, a, b in zip(text, syl, ctx):
            if ch in SANDHI or a == "r":
                continue
            if len(text) > 1:
                if not same_sound(a, b):
                    why.append(f"{ch}: pack {a}, pypinyin in context {b}")
                    conf = "high"
                continue
            ph = PHRASE[ch]
            alts = {r: n for r, n in ph.items() if not same_sound(r, a) and n >= MIN_PHRASES}
            if not same_sound(a, b) and not alts:
                alts = {b: ph.get(b, 0)}
            if not alts:
                continue
            total = sum(ph.values()) or 1
            top = max(ph, key=ph.get) if ph else b
            mine = sum(n for r, n in ph.items() if same_sound(r, a))
            if not same_sound(a, b) or not same_sound(top, a) or mine < max(alts.values()):
                conf = "high"
            elif max(alts.values()) / total >= MEDIUM_SHARE:
                conf = "medium"
            else:
                conf = "low"
            why.append(f"{ch}: pack {a}; phrases " + ", ".join(f"{r} {n}" for r, n in sorted(ph.items(), key=lambda x: -x[1])))
        if conf is None:
            continue
        say, missing = make_carrier(text, syl, pool)
        rows.append(dict(id=iid, t=text, pron=pron, conf=conf, why="; ".join(why), say=say, missing=missing))
    return rows


def scan(words, sentences, units):
    aligned = {w["id"]: align(w["w"], w["pron"]) for w in words}
    pack_syl = defaultdict(set)
    for w in words:
        for ch, a in zip(w["w"], aligned[w["id"]] or ()):
            if a != "r" and tone(a):
                pack_syl[ch].add(a)
    pool = carrier_pool(words, sentences, pack_syl)
    by_id = {w["id"]: w for w in words}
    wrows = scan_items([(w["id"], w["w"], w["pron"]) for w in words], pool)
    urows = scan_items([(u["id"], u["t"], u.get("reading") or by_id[u["words"][0]]["pron"]) for u in units], pool)
    return wrows, urows


def render(wrows, urows):
    emit = {}
    for r in wrows + urows:
        if r["say"]:
            if emit.get(r["t"], r["say"]) != r["say"]:
                raise SystemExit(f"zh_say_scan: {r['t']} gets two carriers (two readings); key tools/zh_say.json by reading first")
            emit[r["t"]] = r["say"]
    order = {"high": 0, "medium": 1, "low": 2, "check": 3}
    nw = sum(1 for r in wrows if r["say"])
    nu = sum(1 for r in urows if r["say"])
    lines = [
        "# zh TTS carriers (polyphonic characters)",
        "",
        "Generated by `tools/zh_say_scan.py --write`; do not edit by hand. A record of which zh words and character",
        "units get a `say` carrier, the text the TTS speaks in place of the written form (docs/PACK_SCHEMA.md",
        "words.json). Safe by construction: every carrier character is monophonic in pypinyin (exactly one reading)",
        "with the pack's syllable and tone at its position, so the carrier sounds as the pack's pinyin whatever the",
        "TTS's default for the original character. A row whose syllable has no common monophonic character keeps the",
        "written form. Confidence says how likely a TTS was to misread the original (pypinyin phrase dictionary).",
        "",
        f"Words: {len(wrows)} mismatched, {nw} carriers, {len(wrows) - nw} without. "
        f"Character units: {len(urows)} mismatched, {nu} carriers, {len(urows) - nu} without.",
        "",
        "| id | text | pack pron | carrier | confidence | evidence |",
        "|---|---|---|---|---|---|",
    ]
    for r in sorted(wrows, key=lambda r: (order[r["conf"]], r["id"])) + sorted(urows, key=lambda r: (order[r["conf"]], r["id"])):
        cell = r["say"] or "none: " + "; ".join(r["missing"])
        lines.append(f"| {r['id']} | {r['t']} | {r['pron']} | {cell} | {r['conf']} | {r['why']} |")
    return emit, "\n".join(lines) + "\n"


def main(argv):
    words = json.load(open(WORDS, encoding="utf-8"))
    sentences = json.load(open(SENTENCES, encoding="utf-8"))
    units = json.load(open(UNITS, encoding="utf-8"))
    emit, md = render(*scan(words, sentences, units))
    js = json.dumps(dict(sorted(emit.items(), key=lambda kv: kv[0])), ensure_ascii=False, indent=1) + "\n"
    sys.stdout.write(md)
    if "--write" in argv:
        open(OUT_JSON, "w", encoding="utf-8").write(js)
        open(OUT_MD, "w", encoding="utf-8").write(md)
        return 0
    same = all(os.path.exists(p) and open(p, encoding="utf-8").read() == t for p, t in ((OUT_JSON, js), (OUT_MD, md)))
    if not same:
        print("zh_say_scan: tools/zh_say.json or docs/ZH_SAY.md is stale (run with --write)", file=sys.stderr)
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
