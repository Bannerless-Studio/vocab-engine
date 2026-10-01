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

pypinyin's phrase dictionary (47k phrases) stands in for what a TTS has learned: a reading
counts as a real alternative when it occurs in at least MIN_PHRASES phrases. Confidence:
  high    a multi-character word whose pypinyin context reading differs from the pack, or a
          single character whose pack reading is not its most frequent phrase reading (还)
  medium  a single character whose other reading has at least MEDIUM_SHARE of its phrases
  low     a single character with a rarer real alternative (listed, no carrier)
High and medium get a carrier; a carrier costs nothing when the TTS was already right,
because the substitute sounds the same.
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
    rs = set(readings(ch))
    return rs == {syl} and set(PHRASE[ch]) <= {syl}


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


def scan(words, sentences):
    aligned = {w["id"]: align(w["w"], w["pron"]) for w in words}
    pack_syl = defaultdict(set)
    for w in words:
        for ch, a in zip(w["w"], aligned[w["id"]] or ()):
            if a != "r" and tone(a):
                pack_syl[ch].add(a)
    pool = carrier_pool(words, sentences, pack_syl)
    rows = []
    for w in words:
        word = w["w"]
        syl = aligned[w["id"]]
        if syl is None:
            rows.append(dict(w=w, conf="check", why="pron does not align with pypinyin readings", fix=[]))
            continue
        ctx = [norm(x[0]) for x in pinyin(word, style=Style.TONE)]
        fix, why, conf = [], [], None
        for i, (ch, a, b) in enumerate(zip(word, syl, ctx)):
            if ch in SANDHI or a == "r":
                continue
            if len(word) > 1:
                if not same_sound(a, b):
                    fix.append(i)
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
                c = "high"
            elif max(alts.values()) / total >= MEDIUM_SHARE:
                c = "medium"
            else:
                c = "low"
            conf = c
            fix.append(i)
            why.append(f"{ch}: pack {a}; phrases " + ", ".join(f"{r} {n}" for r, n in sorted(ph.items(), key=lambda x: -x[1])))
        if conf is None:
            continue
        subs, missing = list(word), []
        for i in fix:
            cands = [c for c in pool.get(syl[i], []) if c != word[i]]
            if cands:
                subs[i] = cands[0]
            else:
                missing.append(f"no common monophonic {syl[i]} character for {word[i]}")
        say = "".join(subs) if not missing else None
        if say:
            got = [norm(x[0]) for x in pinyin(say, style=Style.TONE)]
            bad = [i for i in fix if not same_sound(got[i], syl[i])]
            if bad:
                missing.append("carrier reads " + " ".join(got[i] for i in bad))
                say = None
        rows.append(dict(w=w, conf=conf, why="; ".join(why), say=say, missing=missing))
    return rows


def render(rows):
    emit = {r["w"]["w"]: r["say"] for r in rows if r.get("say") and r["conf"] in ("high", "medium")}
    order = {"high": 0, "medium": 1, "low": 2, "check": 3}
    lines = [
        "# zh TTS carriers (polyphonic characters)",
        "",
        "Generated by `tools/zh_say_scan.py --write`; do not edit by hand. The engine speaks a word's `say` in place of",
        "its written form (docs/PACK_SCHEMA.md words.json). Each carrier swaps a polyphonic character for a monophonic one",
        "with the same syllable and tone, so it sounds the same when the TTS was already right.",
        "",
        "**Owner ear-check:** on the phone, tap each word below in the Words list and confirm the pinyin is what you hear.",
        "Rows marked \"no carrier\" keep the written form; confirm those too. Confidence comes from pypinyin's phrase",
        "dictionary, not from the device voice, which cannot be checked here.",
        "",
        f"Carriers emitted: {len(emit)}. Candidates: {len(rows)}.",
        "",
        "| id | word | pack pron | carrier | confidence | evidence |",
        "|---|---|---|---|---|---|",
    ]
    for r in sorted(rows, key=lambda r: (order[r["conf"]], r["w"]["id"])):
        c = r.get("say") if r["conf"] in ("high", "medium") else None
        cell = c or ("none (low confidence)" if r["conf"] == "low" else "none: " + "; ".join(r.get("missing") or []))
        lines.append(f"| {r['w']['id']} | {r['w']['w']} | {r['w']['pron']} | {cell} | {r['conf']} | {r['why']} |")
    return emit, "\n".join(lines) + "\n"


def main(argv):
    words = json.load(open(WORDS, encoding="utf-8"))
    sentences = json.load(open(SENTENCES, encoding="utf-8"))
    rows = scan(words, sentences)
    emit, md = render(rows)
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
