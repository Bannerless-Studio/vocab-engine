#!/usr/bin/env python3
"""One-off, reproducible converter: hsk repo data -> packs/zh.

Reads (never writes) the hsk repo:
  data/hsk_vocab.json       [{w,py,n,en,lv}]
  data/hsk_sentences.js     const SENTENCE_EXTRA={token:{py,base}}; const SENTENCES=[{zh,py,en,lv,words}]
  data/pinyin_lessons.js    const LESSONS=[...]   (JS literal, evaluated with node)
  src/pinyin_core.js        SENTENCE_FUNCTION_WORDS -> pack.functionWords

Writes packs/zh/{pack,words,sentences,lessons,characters,legacy}.json, then
regenerates the .js consts via jsonify_pack.py. Output is deterministic
(running twice is a no-op).

Sentence `words` are resolved to word ids here, at build time:
  1. longest match first: adjacent hsk tokens that are contiguous in the sentence text
     and whose concatenation is itself a VOCAB word (为+什么 -> 为什么) resolve to
     that longer word;
  2. a VOCAB word maps to its own id;
  3. a SENTENCE_EXTRA compound (e.g. 这个) maps to its `base` word's id (这).
Any token that resolves none of these ways is listed and the script exits 1.
SENTENCE_EXTRA keys also become pack.compounds, so the engine never blanks 这
out of 这个 in a cloze.

Each resolved sentence token also gets a `sentences[].ruby` tuple
[start, end, reading, wordId] at its literal UTF-16 offset in the sentence
text (docs/HSK_MERGE.md §2.3): reading is the SENTENCE_EXTRA compound's own
`py` when resolved that way, else the resolved word's own `pron`.
The same offsets give `sentences[].spans` [start, end, wordId] (docs/PACK_SCHEMA.md),
except for tokens resolved via a SENTENCE_EXTRA base (see the loop).

Words listed in tools/zh_say.json (written by tools/zh_say_scan.py) get a `say` TTS carrier
(还 hái -> 孩: a lone polyphonic character is read by the TTS's own default), copied to the
word's characters.json unit; docs/ZH_SAY.md has the table.

`characters.json` mirrors words.json one-to-one (hsk teaches whole words, not
glyphs: docs/HSK_MERGE.md §2.1), and `legacy.json`/`pack.legacy` carry the
hsk_pinyin -> vocab_zh progress-migration id maps (docs/HSK_MERGE.md §4).
tools/zh_gloss.js applies tools/zh_gloss_overrides.json to `en` and adds words.json `syn`
(words sharing an accepted meaning), `typedSyn` (words the whole gloss also fits) and
`noTypedMeaning` (docs/ZH_GLOSS.md).

Each unit gets a `hint` list (one per character of `t`, null where none) from the
committed tools/zh_hints.json (tools/zh_hints.py; Make Me a Hanzi, LGPL-3.0-or-later),
credited in attribution.json.

Usage: python3 tools/pack_from_hsk.py [HSK_REPO_DIR] [--out DIR]   (default: ../chinese beside this repo, formerly ../hsk;
--out writes the pack and the gloss report to DIR instead of packs/zh and docs/)
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from packbuilder.core.spans import make_spans  # noqa: E402

# English for hsk sentences whose upstream `en` is unusable (the hsk repo is read-only):
# sentence text -> English. The build fails if any PLACEHOLDER_ string survives.
EN_OVERRIDES = {
    "我们应该看自己的优点，也要改变缺点。": "We should look at our own strengths, and also change our weaknesses.",
}
OUT = os.path.join(ROOT, "packs", "zh")
GLOSS_REPORT = os.path.join(ROOT, "docs", "ZH_GLOSS.md")
HINTS = os.path.join(ROOT, "tools", "zh_hints.json")
ATTRIBUTION = {
    "vocabulary": {
        "source": "complete-hsk-vocabulary via the chinese repo (data/hsk_vocab.json, tools/build_vocab.py)",
        "licence": "MIT",
        "url": "https://github.com/drkameleon/complete-hsk-vocabulary",
        "glosses": "the English `en` senses originate from CC-CEDICT (complete-hsk-vocabulary README, Sources: "
                   "\"Dictionary definitions: mdbg.net (CC-CEDICT)\"), licensed CC-BY-SA-4.0: https://cc-cedict.org/wiki/",
    },
    "gloss_overrides": {
        "source": "tools/zh_gloss_overrides.json: zh glosses rewritten from the untruncated CC-CEDICT senses in "
                  "complete-hsk-vocabulary complete.json (each entry cites its CC-CEDICT text); report docs/ZH_GLOSS.md",
        "licence": "CC-BY-SA-4.0 (CC-CEDICT)",
    },
    "sentences": {"source": "hand-authored for this pack (chinese repo data/hsk_sentences.js)", "licence": "CC-BY-SA-4.0"},
    "character_hints": {
        "source": "Make Me a Hanzi dictionary.txt (decomposition, etymology, definition, pinyin), "
                  "itself derived from Unihan and CJKlib; composed into characters.json `hint` by tools/zh_hints.py",
        "licence": "LGPL-3.0-or-later",
        "url": "https://github.com/skishore/makemeahanzi/blob/bddc96d41bef78427ed0e034e9f7e31d71fd1b92/dictionary.txt",
        "copyright": "Shaunak Kishore and contributors",
        "licence_text": "LICENSES/LGPL-3.0.txt, with LICENSES/GPL-3.0.txt (LGPL-3.0 is a set of additional permissions on GPL-3.0)",
    },
    "character_hint_overrides": {
        "source": "tools/zh_hints_overrides.json: 13 hand-written hints restating Make Me a Hanzi entries; "
                  "气 and 来 also restate English Wiktionary's glyph origin for 气 (pictogram of vapour) and 來 "
                  "(wheat, phonetic loan for 'come')",
        "licence": "CC-BY-SA-4.0 (Wiktionary text); the rest as character_hints",
        "url": "https://en.wiktionary.org/wiki/气 https://en.wiktionary.org/wiki/來",
    },
    # LICENSE names these share-alike sources for pack data in general; neither feeds packs/zh
    # (pack_from_hsk.py reads only the chinese repo's data/ and src/pinyin_core.js; passages are
    # hand-written in passages_src.json; langs/zh.py loads no kaikki or frequency data).
    "not_used": {
        "Wiktionary via kaikki.org": "no zh input reads kaikki; zh glosses come from CC-CEDICT via complete-hsk-vocabulary "
                                     "(Wiktionary itself is cited only by two hint overrides, see character_hint_overrides)",
        "hermitdave/FrequencyWords": "zh word order and levels come from the HSK lists, not a frequency list",
    },
}
SAY = os.path.join(ROOT, "tools", "zh_say.json")


def js_const_json(path, name):
    """Extract `const NAME=<json>;` (single line, JSON-valid) from a generated hsk data file."""
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\s*const\s+" + name + r"\s*=\s*(.*);\s*$", line)
            if m:
                return json.loads(m.group(1))
    raise SystemExit(f"pack_from_hsk: const {name} not found in {path}")


# The repo's pinned node (CLAUDE.md "Commands"); a bare `node` on PATH can be an nvm shim that hangs.
NODE = os.environ.get("VE_NODE") or "/Users/ishmum/.nvm/versions/node/v22.22.2/bin/node"


def js_literal_via_node(path, name):
    node = NODE
    code = ("const fs=require('fs');const src=fs.readFileSync(process.argv[1],'utf8');"
            f"process.stdout.write(JSON.stringify(new Function(src+';return {name};')()));")
    out = subprocess.run([node, "-e", code, path], check=True, capture_output=True)
    return json.loads(out.stdout.decode("utf-8"))


def apply_gloss(words):
    """Gloss overrides, `syn`, `typedSyn`, `noTypedMeaning` and `pronInGloss` from tools/zh_gloss.js (it reuses the
    engine's typed-meaning keys; docs/ZH_GLOSS.md is its report)."""
    out = subprocess.run([NODE, os.path.join(ROOT, "tools", "zh_gloss.js"), "--report", GLOSS_REPORT],
                         input=json.dumps(words, ensure_ascii=False).encode("utf-8"), capture_output=True)
    sys.stderr.write(out.stderr.decode("utf-8"))
    if out.returncode:
        raise SystemExit("pack_from_hsk: tools/zh_gloss.js failed")
    g = json.loads(out.stdout.decode("utf-8"))
    nt, pig = set(g["noTypedMeaning"]), set(g["pronInGloss"])
    for w in words:
        w["en"] = g["en"].get(w["id"], w["en"])
        if w["id"] in g["syn"]:
            w["syn"] = g["syn"][w["id"]]
        if w["id"] in g["typedSyn"]:
            w["typedSyn"] = g["typedSyn"][w["id"]]
        if w["id"] in nt:
            w["noTypedMeaning"] = True
        if w["id"] in pig:
            w["pronInGloss"] = True
    print(f"gloss overrides {len(g['en'])}  words with syn {len(g['syn'])}  typedSyn {len(g['typedSyn'])}  noTypedMeaning {len(nt)}  pronInGloss {len(pig)}")


def dump(path, data):
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    cur = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cur = f.read()
    if cur != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {os.path.relpath(path, ROOT)}")


def attach_hints(units, hints):
    """Sets each unit's `hint` (one per character of `t`, null where none; omitted when all
    are null) from the zh_hints.py table. A character the table lacks means the table is
    stale: tools/zh_hints.py reads the same hsk input, so rerun it."""
    missing = sorted({c for u in units for c in u["t"] if c not in hints})
    if missing:
        raise SystemExit(f"pack_from_hsk: characters missing from tools/zh_hints.json (run tools/zh_hints.py): {''.join(missing)}")
    for u in units:
        h = [hints[c] for c in u["t"]]
        if any(h):
            u["hint"] = h
        else:
            u.pop("hint", None)


def main(argv):
    # --out DIR: write the pack and the gloss report there instead (tests/engine_checks.js drift
    # check: a fresh run must reproduce packs/zh byte for byte).
    global OUT, GLOSS_REPORT
    if "--out" in argv:
        i = argv.index("--out")
        OUT = os.path.abspath(argv[i + 1])
        GLOSS_REPORT = os.path.join(OUT, "ZH_GLOSS.md")
        argv = argv[:i] + argv[i + 2:]
    hsk = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(ROOT), "chinese")
    vocab = json.load(open(os.path.join(hsk, "data", "hsk_vocab.json"), encoding="utf-8"))
    sent_path = os.path.join(hsk, "data", "hsk_sentences.js")
    extra = js_const_json(sent_path, "SENTENCE_EXTRA")
    sentences = js_const_json(sent_path, "SENTENCES")
    lessons = js_literal_via_node(os.path.join(hsk, "data", "pinyin_lessons.js"), "LESSONS")
    core_src = open(os.path.join(hsk, "src", "pinyin_core.js"), encoding="utf-8").read()
    m = re.search(r"const SENTENCE_FUNCTION_WORDS\s*=\s*(\[[^\]]*\]);", core_src)
    if not m:
        raise SystemExit("pack_from_hsk: SENTENCE_FUNCTION_WORDS not found in hsk src/pinyin_core.js")
    fw_strings = json.loads(m.group(1))

    # ids in hsk file order (which is also set order within a level)
    words, id_of = [], {}
    for i, v in enumerate(vocab):
        wid = f"w{i + 1:04d}"
        if v["w"] in id_of:
            raise SystemExit(f"pack_from_hsk: duplicate hsk word {v['w']}")
        id_of[v["w"]] = wid
        words.append({"id": wid, "w": v["w"], "en": v["en"], "lv": str(v["lv"]), "pron": v["py"]})
    pron_of = {w["id"]: w["pron"] for w in words}
    say = json.load(open(SAY, encoding="utf-8"))
    for k, v in say.items():
        if k not in id_of or not isinstance(v, str) or len(v) != len(k) or v == k:
            raise SystemExit(f"pack_from_hsk: bad tools/zh_say.json entry {k!r}: {v!r}")
    for w in words:
        if w["w"] in say:
            w["say"] = say[w["w"]]
    apply_gloss(words)

    def resolve(token):
        if token in id_of:
            return id_of[token], None
        e = extra.get(token)
        if e and e.get("base") in id_of:
            return id_of[e["base"]], token
        return None, None

    out_sent, fallback, unresolved, merged, unplaced = [], {}, [], {}, []
    for i, s in enumerate(sentences):
        sid = f"s{i + 1:04d}"
        ids = []
        toks, j = s["words"], 0
        # Each token's start offset in the sentence text (sequential search; None when a
        # token isn't found literally). Tokens merge only when they are contiguous at
        # these positions, so a concatenation that happens to occur elsewhere in the
        # sentence can't trigger a merge.
        pos, cur = [], 0
        for tok in toks:
            at = s["zh"].find(tok, cur)
            pos.append(at if at >= 0 else None)
            if at >= 0:
                cur = at + len(tok)

        def contiguous(a, b):
            return all(pos[x] is not None for x in range(a, b)) and all(
                pos[x] + len(toks[x]) == pos[x + 1] for x in range(a, b - 1))

        segs = []  # (text, start) pairs; start is None if the token wasn't found literally
        while j < len(toks):
            for k in (4, 3, 2):
                cat = "".join(toks[j:j + k])
                if j + k <= len(toks) and cat in id_of and contiguous(j, j + k):
                    merged[cat] = merged.get(cat, 0) + 1
                    segs.append((cat, pos[j]))
                    j += k
                    break
            else:
                segs.append((toks[j], pos[j]))
                j += 1
        ruby, recs = [], []
        for tok, start in segs:
            wid, via = resolve(tok)
            if wid is None:
                unresolved.append((sid, s["zh"], tok))
                continue
            if via:
                fallback[via] = fallback.get(via, 0) + 1
            ids.append(wid)
            if start is not None:
                reading = extra[via]["py"] if via else pron_of[wid]
                ruby.append([start, start + len(tok), reading, wid])
                # No span for a compound resolved to its base (这个 -> 这): a lone span is the
                # cloze target, so it would blank 这个 for the answer 这, which pack.compounds
                # exists to prevent (136 such blanks when tried).
                if not via:
                    recs.append(("chars", start, start + len(tok), wid))
            else:
                unplaced.append((sid, s["zh"], tok))
        ruby.sort(key=lambda r: r[0])
        rec = {"id": sid, "t": s["zh"], "en": EN_OVERRIDES.get(s["zh"], s["en"]), "lv": str(s["lv"]), "words": ids, "pron": s["py"]}
        if ruby:
            rec["ruby"] = ruby
        spans = make_spans(s["zh"], None, recs, ids)
        if spans:
            rec["spans"] = spans
        out_sent.append(rec)

    # compounds collapse onto their base word
    fw, fw_notes = [], []
    for tok in fw_strings:
        wid, via = resolve(tok)
        if wid is None:
            fw_notes.append(f"function word {tok} unresolved (dropped)")
            continue
        if via:
            fw_notes.append(f"function word {tok} -> base {extra[tok]['base']} ({wid})")
        if wid not in fw:
            fw.append(wid)

    levels = sorted({w["lv"] for w in words}, key=int)
    pack = {
        "key": "zh",
        "name": "Mandarin (HSK 1–4)",
        "tts": "zh-CN",
        "ttsRate": 0.85,
        "levels": [{"id": lv, "label": f"HSK {lv}"} for lv in levels],
        "setSize": 10,
        "placement": [["1", 3], ["2", 3], ["3", 4], ["4", 6]],
        "functionWords": fw,
        # Typing Chinese needs an IME, so the typed production step types the pinyin
        # instead (hsk's typed drill; docs/PACK_SCHEMA.md "Pronunciation aids"): the same
        # word slot recall uses, never a stand-alone pinyin drill.
        "typing": "pron",
        # Typed items from the target side too (characters -> pinyin, characters -> meaning,
        # pinyin -> meaning) and focused gloss display; zh only until it is perfected
        # (docs/PACK_SCHEMA.md "typedFrom and glossFocus", TODO.md).
        "typedFrom": ["written", "pron"],
        "glossFocus": True,
        # Help overlays (word popovers, audio toast) get a close button, tap-outside, Escape
        # and an 8 s timer (docs/PACK_SCHEMA.md "helpClose"; owner feedback 2026-10-02).
        "helpClose": True,
        # Read questions: verdict and Next above the passage toggle (docs/PACK_SCHEMA.md
        # "readAnswerBlock"; owner feedback 2026-10-02).
        "readAnswerBlock": True,
        # Word option sets labelled in one mode (all readings or all characters): one option
        # in characters among readings gave the answer away (docs/PACK_SCHEMA.md "optsOneScript";
        # owner browser check 2026-10-02).
        "optsOneScript": True,
        # Wrong choices mix learned and not-yet-learned words, no level tiers: same-level ones
        # near the end of a level let a new word be found by elimination (docs/PACK_SCHEMA.md
        # "optsMix"; owner feedback 2026-10-02).
        "optsMix": True,
        "showPron": True,
        "hasLessons": True,
        "spaced": False,
        "compounds": sorted(extra.keys()),
        # hsk teaches whole words, not glyphs, so a character unit is one known word
        # (docs/HSK_MERGE.md §2.1): one-to-one with words.json, same order.
        "characters": {
            "label": "字",
            # One stage per HSK level, unlocked once that level's words are learned (owner
            # feedback 2026-10-02; was one stage after HSK 3 for levels 1-3).
            "stages": [{"after": lv, "levels": [lv], "label": "字" + lv} for lv in ("1", "2", "3", "4")],
            "setSize": 10,
            "mastered": 3,
            "bare": 6,
            "learnKinds": ["charPick", "charRead"],
            "reviewKinds": ["charRead", "charSound"],
            "testKinds": {"charRead": 40, "charSound": 30, "charPick": 30},
            # A hanzi's unit has one reading, so a passage span longer than its word may
            # read its other characters per character (docs/PACK_SCHEMA.md "characters").
            "compose": True,
            # Writing scores more than choosing (owner feedback 2026-10-02): from mastered,
            # only typed written-side answers take a unit to bare; bare words are asked
            # without pinyin (docs/PACK_SCHEMA.md "bareBy").
            "bareBy": "typed",
            "bareWords": True,
            # Learn teaches characters when a full set of learned words' units is untaught,
            # else new words (owner 2026-10-02, docs/PACK_SCHEMA.md "learn"); stages unused.
            "learn": "lag",
        },
        "legacy": {"key": "hsk_pinyin", "format": "hsk-v2"},
        # Pronunciation first (docs/HSK_MERGE.md §8, 2026-09-25): a word is shown by its
        # pinyin until its character unit reaches the mastered tier, as hsk does.
        "pronFirst": True,
        # Pronunciation aids (docs/PACK_SCHEMA.md, brief BP2): pinyin syllables coloured
        # by tone as hsk did, and a Reference card of every lesson sound in the Sounds tab.
        "tones": "pinyin",
        "soundsReference": True,
        # Plans know what was drilled today (docs/PACK_SCHEMA.md "dayAware"; owner feedback 2026-10-02).
        "dayAware": True,
        # New material can be paused from Progress (docs/PACK_SCHEMA.md "pauseNew").
        "pauseNew": True,
    }

    # one unit per word, same order as words.json (docs/HSK_MERGE.md §2.1).
    # Unit id = "c" + the word id's digits (w0416 -> c0416): ids follow word ids and are
    # never renumbered (they are progress keys).
    hints = json.load(open(HINTS, encoding="utf-8"))
    characters = []
    for w in words:
        if not re.fullmatch(r"w\d+", w["id"]):
            raise SystemExit(f"pack_from_hsk: word id {w['id']!r} is not w<digits>; unit ids derive from it")
        unit = {
            "id": "c" + w["id"][1:],
            "t": w["w"],
            "words": [w["id"]],
            "lv": w["lv"],
            "reading": w["pron"],
            **({"say": w["say"]} if "say" in w else {}),
        }
        characters.append(unit)
    attach_hints(characters, hints)
    # legacy map for the hsk_pinyin -> vocab_zh progress migration (docs/HSK_MERGE.md §4)
    legacy = {
        "w": {w["w"]: w["id"] for w in words},
        "s": {s["t"]: s["id"] for s in out_sent},
        "c": {c["t"]: c["id"] for c in characters},
    }

    unused = set(EN_OVERRIDES) - {x["t"] for x in out_sent}
    if unused:
        raise SystemExit(f"pack_from_hsk: EN_OVERRIDES keys match no sentence: {sorted(unused)}")
    ph = sorted({m for part in (words, out_sent, lessons) for m in re.findall(r"PLACEHOLDER_\w+", json.dumps(part, ensure_ascii=False))})
    if ph:
        raise SystemExit(f"pack_from_hsk: placeholder text in the output (add EN_OVERRIDES): {ph}")

    os.makedirs(OUT, exist_ok=True)
    dump(os.path.join(OUT, "pack.json"), pack)
    dump(os.path.join(OUT, "words.json"), words)
    dump(os.path.join(OUT, "sentences.json"), out_sent)
    dump(os.path.join(OUT, "lessons.json"), lessons)
    dump(os.path.join(OUT, "characters.json"), characters)
    dump(os.path.join(OUT, "legacy.json"), legacy)
    dump(os.path.join(OUT, "attribution.json"), ATTRIBUTION)

    total_tokens = sum(len(s["words"]) for s in sentences)  # hsk tokens, before merging
    ruby_tokens = sum(len(s.get("ruby", ())) for s in out_sent)
    print(f"words {len(words)}  sentences {len(out_sent)}  lessons {len(lessons)}  functionWords {len(fw)}")
    hinted = {c for u in characters for c, h in zip(u["t"], u.get("hint", ())) if h}
    print(f"character hints: {len(hinted)} of {len({c for u in characters for c in u['t']})} distinct characters; units with hint {sum(1 for u in characters if 'hint' in u)}")
    print(f"say carriers {len(say)}")
    print(f"characters {len(characters)}  legacy w={len(legacy['w'])} s={len(legacy['s'])} c={len(legacy['c'])}")
    print(f"sentence tokens {total_tokens}: {sum(fallback.values())} resolved via SENTENCE_EXTRA base, {len(unresolved)} unresolved, ruby tokens {ruby_tokens}, unplaced (no ruby) {len(unplaced)}")
    print(f"longest-match merges of adjacent hsk tokens: {sum(merged.values())}")
    for tok in sorted(merged, key=lambda t: (-merged[t], t)):
        print(f"  MERGE {tok} x{merged[tok]}")
    for tok in sorted(fallback, key=lambda t: (-fallback[t], t)):
        print(f"  EXTRA {tok} -> {extra[tok]['base']} x{fallback[tok]}")
    for n in fw_notes:
        print("  " + n)
    for sid, zh, tok in unresolved:
        print(f"  UNRESOLVED {sid} {zh} token {tok}")
    for sid, zh, tok in unplaced:
        print(f"  UNPLACED (no literal offset, no ruby) {sid} {zh} token {tok}")

    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "jsonify_pack.py"), OUT], check=True)
    return 1 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
