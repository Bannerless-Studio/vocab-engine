"""Noun gender `g` for a pack built before the builders emitted it (it es fr de, pack.gapGender).

`g` is decided in the words stage (core/words.py gender_code) from the lexicon entry the build picked for the
word, and that pick depends on the corpus, so a shipped pack cannot re-derive it. This module keeps the
result by word id in <repo>/tools/word_gender.json ({"<id>": "m"|"f"|"n"|"p"}, ids are append-only so the file
never goes stale for a word that exists):

  `packbuilder gender --lang x --repo r`   run the build up to the shipped word list (nothing under pack/ is
                                           written) and write the file from the words that carry `g`;
                                           --check compares instead; --out FILE writes elsewhere
  core/enrich.py apply_gender              copies the file's `g` onto the pack's nouns by id, no re-pick,
                                           no id change; a word whose own `g` differs is an error
"""
import json
from pathlib import Path

from .util import Env
from ..langs import get_spec

SIDECAR = "word_gender.json"
G_VALUES = ("m", "f", "n", "p")
# keys the builders emit in this order (core/pipeline.py WORD_FIELDS); `g` goes before any later key such as ft
BUILDER_KEYS = ("id", "w", "lemma", "pos", "en", "lv", "rank", "pron", "alt", "forms", "bare", "g")


def load_map(tools):
    p = Path(tools) / SIDECAR
    if not p.exists():
        return None
    raw = json.loads(p.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def dump_map(gmap):
    body = ",\n".join(f' "{i}": "{gmap[i]}"' for i in sorted(gmap))
    return "{\n" + body + "\n}\n"


def _with_g(word, g):
    """The word with `g` placed where the builder puts it."""
    items = list(word.items())
    at = next((n for n, (k, _) in enumerate(items) if k not in BUILDER_KEYS), len(items))
    items.insert(at, ("g", g))
    return dict(items)


def apply_gender(words, gmap):
    """(new words, counts). Copies; a noun gets the file's g, a word that already has another g is a conflict.
    Returns conflicts as [(id, lemma, have, want)] and the number of file ids with no word."""
    out, added, conflicts = [], 0, []
    ids = set()
    for w in words:
        ids.add(w["id"])
        want = gmap.get(w["id"]) if gmap else None
        if want is None:
            out.append(w)
        elif "g" in w:
            if w["g"] != want:
                conflicts.append((w["id"], w["lemma"], w["g"], want))
            out.append(w)
        elif w.get("pos") != "noun":
            conflicts.append((w["id"], w["lemma"], f"pos {w.get('pos')}", want))
            out.append(w)
        else:
            added += 1
            out.append(_with_g(w, want))
    unused = len([i for i in (gmap or {}) if i not in ids])
    return out, {"added": added, "conflicts": conflicts, "unused": unused}


def build_map(env):
    """{id: g} from the words the build ships: prepare, build_words, finish_words, the same calls as
    pipeline.run before it writes. Needs the repo's .cache (sources and derived)."""
    from .pipeline import prepare, finish_words
    from .words import build_words
    ctx = {}
    prepare(env, ctx)
    words, records, top3000 = build_words(env, ctx)
    words = finish_words(env, ctx, words, records, top3000)[0]
    return {w["id"]: w["g"] for w in words if w.get("g")}


def main(lang, repo, check=False, out=None):
    spec = get_spec(lang, repo, load=True)
    if not spec.emit_gender:
        raise SystemExit(f"gender: {lang} does not emit g (emit_gender is false)")
    env = Env(spec)
    gmap = build_map(env)
    bad = {i: g for i, g in gmap.items() if g not in G_VALUES}
    if bad:
        raise SystemExit(f"gender: values outside {G_VALUES}: {bad}")
    text = dump_map(gmap)
    dst = Path(out) if out else env.tools / SIDECAR
    print(f"{lang} gender: {len(gmap)} nouns with g " + " ".join(f"{k}={sum(1 for v in gmap.values() if v == k)}" for k in G_VALUES))
    if check:
        have = dst.read_text(encoding="utf-8") if dst.exists() else None
        if have != text:
            print(f"gender --check: {dst} differs from the build (run: python3 -m packbuilder gender --lang {lang} --repo .)")
            return 1
        print("gender --check: ok")
        return 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(text, encoding="utf-8")
    print(f"wrote {dst}")
    return 0
