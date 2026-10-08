"""`python -m packbuilder enrich --lang <x> --repo <repo> [--check] [--emit DIR]`: the post-stage of the
port (vocab-engine .cache/briefs/port-plan.md §1, §2, §4): a pure function of a built pack that adds

  * `ft` on every word of pack/words.json (0 ambient, 1 core, 2 peripheral; docs/PACK_SCHEMA.md "freqTiers")
    from its `rank` and the optional <repo>/tools/tiers_overrides.json, and on every unit of
    pack/characters.json (the lowest `ft` of its words);
  * the pack.json flag block `LanguageSpec.port_flags()`;
  * pack.json `eta` copied from the optional <repo>/tools/eta.json (tests/eta_checks.js --pack ... --write).

Run it after `build` / `passages` / `script` / `audio`, then the site's build. `--check` writes nothing and
exits 1 when the shipped pack differs from the function's output (a site's check.sh runs it). `--emit DIR`
writes the enriched pack (json + js) into a copy of pack/ at DIR and leaves the repo untouched."""
import json
import shutil
import sys
from pathlib import Path

from ..langs import get_spec
from .util import Env, write_json

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from jsonify_pack import render  # noqa: E402

TIER_NAMES = {"ambient": 0, "core": 1, "peripheral": 2}
AMBIENT_RANK = 100
# Share of a level's words that are peripheral: the least frequent (highest rank) words that are not ambient.
PERIPHERAL_SHARE = {"A1": 0.10, "A2": 0.25, "B1": 0.40}


def load_overrides(path, words):
    """tools/tiers_overrides.json: {word-or-id: "ambient"|"core"|"peripheral"} -> {id: tier}."""
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    by_key = {}
    for w in words:
        by_key.setdefault(w["id"], []).append(w["id"])
        by_key.setdefault(w["w"], []).append(w["id"])
    bad = [f"{k}: {v}" for k, v in raw.items() if k not in by_key or v not in TIER_NAMES]
    if bad:
        raise SystemExit(f"enrich: {path}: unknown word or tier {bad[:10]}")
    return {i: TIER_NAMES[v] for k, v in raw.items() for i in by_key[k]}


def assign_tiers(words, overrides=None, shares=None, ambient_rank=AMBIENT_RANK):
    """Sets words[i]["ft"] in place. Ambient: rank <= ambient_rank. Per level, the highest-rank
    `share` of the level's words that are not ambient are peripheral; the rest core. A word without
    a rank is core. An override wins over the rule and the shares do not move for it (no backfill)."""
    shares = PERIPHERAL_SHARE if shares is None else shares
    ranked = lambda w: isinstance(w.get("rank"), int) and not isinstance(w.get("rank"), bool)
    for w in words:
        w["ft"] = 0 if ranked(w) and w["rank"] <= ambient_rank else 1
    for lv in sorted({w["lv"] for w in words}):
        lw = [w for w in words if w["lv"] == lv]
        k = int(shares.get(lv, 0) * len(lw) + 0.5)
        cand = sorted((w for w in lw if w["ft"] == 1 and ranked(w)), key=lambda w: (-w["rank"], w["id"]))
        for w in cand[:k]:
            w["ft"] = 2
    for w in words:
        if w["id"] in (overrides or {}):
            w["ft"] = overrides[w["id"]]


def tier_counts(words):
    levels = sorted({w["lv"] for w in words})
    return {lv: [sum(1 for w in words if w["lv"] == lv and w["ft"] == t) for t in (0, 1, 2)] for lv in levels}


def enrich_data(spec, pack, words, units=None, overrides=None, eta=None):
    """The pure function: copies of (pack, words, units) with ft, the flag block and eta. Inputs untouched."""
    pack, words = json.loads(json.dumps(pack)), json.loads(json.dumps(words))
    units = json.loads(json.dumps(units)) if units is not None else None
    assign_tiers(words, overrides)
    for k, v in spec.port_flags().items():
        if isinstance(v, dict) and isinstance(pack.get(k), dict):
            pack[k].update(v)
        else:
            pack[k] = v
    pack.pop("eta", None)
    if eta is not None:
        pack["eta"] = eta
    if units is not None:
        ft = {w["id"]: w["ft"] for w in words}
        for u in units:
            u["ft"] = min((ft[i] for i in u["words"] if i in ft), default=1)
    return pack, words, units


def _read(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _write_js(dirp, stem, const, data):
    dst = dirp / f"{stem}.js"
    text = render(const, data)
    if not dst.exists() or dst.read_text(encoding="utf-8") != text:
        dst.write_text(text, encoding="utf-8")


def main(lang, repo, check=False, emit=None):
    spec = get_spec(lang, repo, load=False)
    env = Env(spec)
    pack_dir = env.pack
    pack, words, units = (_read(pack_dir / f) for f in ("pack.json", "words.json", "characters.json"))
    if pack is None or words is None:
        raise SystemExit(f"enrich: {pack_dir} has no pack.json / words.json (run build first)")
    tools = Path(repo) / "tools"
    eta = _read(tools / "eta.json")
    if eta is not None:
        eta = {k: eta[k] for k in ("gain", "known") if k in eta}
    new_pack, new_words, new_units = enrich_data(spec, pack, words, units, load_overrides(tools / "tiers_overrides.json", words), eta)
    counts = tier_counts(new_words)
    print(f"{lang} tiers [ambient core peripheral]: " + "  ".join(f"{lv} {c}" for lv, c in counts.items()))
    parts = [("pack", "PACK", pack, new_pack), ("words", "WORDS", words, new_words)]
    if units is not None:
        parts.append(("characters", "CHARACTERS", units, new_units))
    stale = [stem for stem, _, old, new in parts if old != new]
    if check:
        if stale:
            print("enrich --check: shipped " + ", ".join(s + ".json" for s in stale) + " differs from the enrich output (run: python3 -m packbuilder enrich --lang %s --repo .)" % lang)
            return 1
        print("enrich --check: ok")
        return 0
    out = pack_dir
    if emit:
        out = Path(emit)
        if out.exists():
            shutil.rmtree(out)
        shutil.copytree(pack_dir, out)
    for stem, const, old, new in parts:
        if emit or old != new:
            write_json(out / f"{stem}.json", new, compact=(stem != "pack"))
            _write_js(out, stem, const, new)
            print(f"wrote {out / (stem + '.json')} (+ .js)")
    return 0
