"""`python3 -m packbuilder kanji-aids --lang ja --repo <repo> [--tables DIR] [--check] [--emit DIR]`:
the kanji aids post-stage of a built Japanese pack (docs/PACK_SCHEMA.md "hint", "ruby").

Reads the committed tables from DIR (default vocab-engine tools/, written by tools/ja_hints.py and
tools/ja_furigana.py; no network) and writes:

  * characters.json `hint` on every unit, one entry per code point of `t`: a kanji gets its line,
    a kana position null. A one-character unit reads "<parts>: <meaning>" (KRADFILE parts with the
    component's gloss, the kanji's KANJIDIC meaning); a unit of two or more characters gets one
    line per kanji, "<meaning in that word>: <parts>" with the parts only when the pack has no
    one-character unit for that kanji (that unit's card teaches them). A key "<unit>:<kanji>" in
    tools/ja_hints_overrides.json "_meanings" sets the meaning of that kanji in that unit; a bare
    kanji key sets it everywhere; a top-level kanji key with a string sets a one-character
    unit's whole hint.
  * words.json `ruby` on every kanji word: [[start, end, reading]] in UTF-16 units of `w`
    (tools/ja_furigana.json, keyed by word id; the headword must match).
  * attribution.json "kanji_dictionary" and "word_furigana" (EDRDG, CC BY-SA 4.0), and pack.json
    `credits`: the same two sources as a footer line (app.html renderCredits; docs/PACK_SCHEMA.md "credits").

Every kanji of every unit must have a table entry; a missing one fails the run (the table is stale).
Writes the json and js of the three files, like enrich, and nothing when --check finds them current.
"""
import json
import re
import shutil
from pathlib import Path

from ..langs import get_spec
from .enrich import _read, _write_js
from .util import Env, write_json

KANJI_RE = re.compile("[㐀-䶿一-鿿豈-﫿々]")
TABLES = Path(__file__).resolve().parents[2]
CREDITS = [
    {"name": "EDRDG (KANJIDIC2, KRADFILE, JMdict)", "licence": "CC BY-SA 4.0",
     "url": "https://www.edrdg.org/edrdg/licence.html"},
    {"name": "JmdictFurigana (Doublevil)", "licence": "CC BY-SA 4.0",
     "url": "https://github.com/Doublevil/JmdictFurigana"},
]
ATTRIBUTION = {
    "kanji_dictionary": {
        "source": "KANJIDIC2 and KRADFILE, Electronic Dictionary Research and Development Group (EDRDG), edrdg.org; used per the EDRDG licence",
        "licence": "CC-BY-SA-4.0", "url": "https://www.edrdg.org/edrdg/licence.html"},
    "word_furigana": {
        "source": "JmdictFurigana (Doublevil) built on JMdict, EDRDG",
        "licence": "CC-BY-SA-4.0", "url": "https://github.com/Doublevil/JmdictFurigana"},
}


def _breakdown(c, table):
    parts = table[c]["parts"]
    return " + ".join(f"{comp} {g}" if g else comp for comp, g in parts)


def _join(head, tail):
    return f"{head}: {tail}" if head and tail else (head or tail or None)


def attach_hints(units, table, meanings, overrides):
    """Sets each unit's `hint` (see the module docstring). Returns the number of kanji lines written."""
    kanji = {c for u in units for c in u["t"] if KANJI_RE.match(c)}
    missing = sorted(c for c in kanji if c not in table)
    if missing:
        raise SystemExit(f"kanji-aids: kanji missing from tools/ja_hints.json (run tools/ja_hints.py): {''.join(missing)}")
    multi = {u["t"] for u in units if len(u["t"]) > 1}
    stale = sorted(k for k in meanings if ":" in k and k.partition(":")[0] not in multi)
    if stale:
        raise SystemExit(f"kanji-aids: _meanings keys match no unit: {stale[:10]}")
    single = {u["t"] for u in units if len(u["t"]) == 1}
    n = 0
    for u in units:
        t = u["t"]
        if len(t) == 1:
            c = t
            if not KANJI_RE.match(c):
                h = [None]
            elif t in overrides:
                h = [overrides[t]]
            else:
                h = [_join(_breakdown(c, table), table[c]["meaning"])]
        else:
            h = []
            for c in t:
                if not KANJI_RE.match(c):
                    h.append(None)
                    continue
                m = meanings.get(f"{t}:{c}") or table[c]["meaning"]
                b = "" if c in single else _breakdown(c, table)
                h.append(_join(m, b))
        n += sum(1 for x in h if x)
        if any(h):
            u["hint"] = h
        else:
            u.pop("hint", None)
    return n


def attach_ruby(words, furigana):
    """Sets each kanji word's `ruby` from the table; a word without kanji has none."""
    for w in words:
        kanji = bool(KANJI_RE.search(w["w"]))
        entry = furigana.get(w["id"])
        if kanji and entry is None:
            raise SystemExit(f"kanji-aids: {w['id']} {w['w']} has no entry in tools/ja_furigana.json (run tools/ja_furigana.py)")
        if not kanji:
            w.pop("ruby", None)
            continue
        if entry["w"] != w["w"]:
            raise SystemExit(f"kanji-aids: tools/ja_furigana.json {w['id']} is for {entry['w']!r}, the word is {w['w']!r}")
        w["ruby"] = entry["ruby"]
    return sum(1 for w in words if "ruby" in w)


def _overrides(data):
    meanings = data.get("_meanings", {})
    hints = {k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, str)}
    return meanings, hints


def enrich_data(pack, units, words, pack_attr, table, furigana, meanings, hints):
    n_hint = attach_hints(units, table, meanings, hints)
    n_ruby = attach_ruby(words, furigana)
    attr = dict(pack_attr)
    attr.update(ATTRIBUTION)
    new_pack = dict(pack)
    new_pack["credits"] = CREDITS
    return new_pack, units, words, attr, n_hint, n_ruby


def main(lang, repo, tables=None, check=False, emit=None):
    if lang != "ja":
        raise SystemExit("kanji-aids: the kanji aids are for the ja pack only")
    tables = Path(tables) if tables else TABLES
    spec = get_spec(lang, repo, load=False)
    env = Env(spec)
    pack_dir = env.pack
    pack, words, units, attr = (_read(pack_dir / f) for f in ("pack.json", "words.json", "characters.json", "attribution.json"))
    if pack is None or words is None or units is None or attr is None:
        raise SystemExit(f"kanji-aids: {pack_dir} has no pack.json / words.json / characters.json / attribution.json (run build first)")
    table = json.loads((tables / "ja_hints.json").read_text(encoding="utf-8"))
    furigana = json.loads((tables / "ja_furigana.json").read_text(encoding="utf-8"))
    meanings, hints = _overrides(json.loads((tables / "ja_hints_overrides.json").read_text(encoding="utf-8")))
    new_pack, new_units, new_words, new_attr, n_hint, n_ruby = enrich_data(
        pack, json.loads(json.dumps(units)), json.loads(json.dumps(words)), attr, table, furigana, meanings, hints)
    print(f"kanji-aids: {n_hint} hint lines on {len(new_units)} units, {n_ruby} words with ruby")
    parts = [("pack", "PACK", pack, new_pack), ("words", "WORDS", words, new_words), ("characters", "CHARACTERS", units, new_units)]
    stale = [stem for stem, _, old, new in parts if old != new] + (["attribution"] if attr != new_attr else [])
    if check:
        if stale:
            print("kanji-aids --check: shipped " + ", ".join(s + ".json" for s in stale)
                  + " differs from the kanji-aids output (run: python3 -m packbuilder kanji-aids --lang ja --repo .)")
            return 1
        print("kanji-aids --check: ok")
        return 0
    out = pack_dir
    if emit:
        out = Path(emit)
        src, dst = pack_dir.resolve(), out.resolve()
        if dst == src or src in dst.parents:
            raise SystemExit(f"kanji-aids: --emit {emit} is the source pack dir or inside it")
        if out.exists():
            shutil.rmtree(out)
        shutil.copytree(pack_dir, out)
    for stem, const, old, new in parts:
        if emit or old != new:
            write_json(out / f"{stem}.json", new, compact=(stem != "pack"))
            _write_js(out, stem, const, new)
            print(f"wrote {out / (stem + '.json')} (+ .js)")
    if emit or attr != new_attr:
        write_json(out / "attribution.json", new_attr, compact=False)
        print(f"wrote {out / 'attribution.json'}")
    return 0
