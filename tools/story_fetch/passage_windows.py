#!/usr/bin/env python3
"""Passage candidates from cached stories (Let's Read Asia ur, African Storybook sw): lemma-level coverage per contiguous page window.

Usage (site venv, from vocab-engine/): PYTHONPATH=tools <site>/.venv/bin/python tools/story_fetch/passage_windows.py \
        --repo ../urdu [--lang ur|sw|fa|ar|id|hi] [--top 30] [--out windows.json]

Uses the passages Linker (the same tagger and link rules as `packbuilder passages`), so coverage is over
lemmas and counts exactly what a shipped passage's coverage counts: names and numerals are skipped, a token
with no pack word is out of pack. A window is a run of consecutive pages of one story (target text only; the
English twin is not read). It passes a level when the words-per-passage band, the coverage and the level
budget of <repo>/tools/passages_src.json "rules" all hold; the level is the lowest that passes.
Nothing is written to the site. Content review (sensitive themes) is a separate step."""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from packbuilder import passages as P  # noqa: E402
from packbuilder.core.util import Env  # noqa: E402
from packbuilder import ar_story, fa_story, hi_story, id_story, sw_story, ur_story  # noqa: E402
from packbuilder.core import story_align as A  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--lang", default="ur", choices=["ur", "sw", "fa", "ar", "id", "hi"], help="story language (ur, fa: Let's Read Asia cache; sw, ar: African Storybook cache; id: Let's Read Asia + Bloom caches; hi: Bloom cache)")
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--out")
    a = ap.parse_args()
    repo = Path(a.repo).resolve()
    spec = get_spec(a.lang, str(repo))
    lang = {"ur": ur_story.UR, "sw": sw_story.SW, "fa": fa_story.FA, "ar": ar_story.AR, "id": id_story.ID, "hi": hi_story.HI}[a.lang]
    env = Env(spec)
    src = json.loads((repo / "tools" / "passages_src.json").read_text())
    rules = {**P.DEFAULT_RULES, **src.get("rules", {})}
    shipped = {w["id"]: w for w in json.loads((repo / "pack" / "words.json").read_text())}
    for w in shipped.values():
        w.setdefault("lemma", w["w"])
    lk = P.Linker(spec, P.load_context(spec), shipped)
    lv_rank = {lv: i for i, lv in enumerate(spec.level_ids)}
    lv_of = {wid: w["lv"] for wid, w in shipped.items()}
    stories = spec._stories(env)
    if a.lang == "hi":
        stories = {k: v for k, v in stories.items() if not hi_story.garbled_story(v)}      # font-mapped PDF text is no passage

    pages = {}      # story id -> [[sentences]] per non-empty page
    for sid, st in stories.items():
        pages[sid] = [A.split_target(lang, p["text"]) for p in st["text_pages"] if p["text"]]
    lk.pretag([(t, "", frozenset()) for ps in pages.values() for pg in ps for t in pg])

    nopen = frozenset()
    data = {}       # story id -> per page dict
    for sid, ps in pages.items():
        rows = []
        for pg in ps:
            counted = linked = 0
            oop = Counter()
            used = {}
            for t in pg:
                toks = lk.tag(t, "", nopen)
                for surf, lem, wid, _ok, _i in lk.classify(toks, "", ()):
                    counted += 1
                    if wid is None:
                        oop[lem] += 1
                    else:
                        linked += 1
                        used[wid] = shipped[wid]["lemma"]
            rows.append({"counted": counted, "linked": linked, "oop": oop, "used": used,
                         "words": P.n_words(" ".join(pg))})
        data[sid] = rows

    out = []
    stats = Counter()
    band_best, band_n = {}, Counter()
    for sid, rows in data.items():
        n = len(rows)
        for i in range(n):
            for j in range(i, min(n, i + 20)):
                win = rows[i:j + 1]
                words = sum(r["words"] for r in win)
                counted = sum(r["counted"] for r in win)
                if not counted:
                    continue
                linked = sum(r["linked"] for r in win)
                cov = linked / counted
                used = {}
                oop = Counter()
                for r in win:
                    used.update(r["used"])
                    oop.update(r["oop"])
                for lv in spec.level_ids:
                    lo, hi = rules["words_per_passage"][lv]
                    if lo <= words <= hi:
                        band_best[lv] = max(band_best.get(lv, 0), cov)
                        band_n[lv] += 1
                    if not lo <= words <= hi or cov < rules["coverage"][lv]:
                        continue
                    above = {}
                    for wid, lem in used.items():
                        if lv_rank[lv_of[wid]] > lv_rank[lv]:
                            above.setdefault(lv_of[wid], set()).add(lem)
                    if P.budget_errors(lv, above, rules["budget"]):
                        continue
                    out.append({"story": sid, "title": stories[sid]["title"], "pages": [i + 1, j + 1], "level": lv,
                                "words": words, "coverage": round(cov, 3), "oop": [f"{k}:{v}" for k, v in oop.most_common()],
                                "above": {k: sorted(v) for k, v in above.items()}})
                    stats[lv] += 1
                    break
    best = {}
    for w in out:
        k = (w["story"], w["level"])
        if k not in best or (w["coverage"], w["words"]) > (best[k]["coverage"], best[k]["words"]):
            best[k] = w
    ranked = sorted(best.values(), key=lambda w: (-w["coverage"], -w["words"]))
    summary = {"stories": len(stories), "windows_passing_by_level": dict(stats),
               "stories_with_a_passing_window": len({w["story"] for w in out}),
               "best_window_per_story_and_level": len(ranked),
               "whole_story_coverage_median": sorted(sum(r["linked"] for r in rows) / max(1, sum(r["counted"] for r in rows))
                                                     for rows in data.values())[len(data) // 2],
               "windows_in_word_band_by_level": dict(band_n),
               "best_coverage_of_a_band_sized_window": {k: round(v, 3) for k, v in band_best.items()}}
    print(json.dumps(summary, ensure_ascii=False))
    for w in ranked[:a.top]:
        print(f"{w['level']} cov {w['coverage']} words {w['words']} pages {w['pages'][0]}-{w['pages'][1]} "
              f"{w['story'][:8]} {w['title']} oop {' '.join(w['oop'][:8])} above {w['above']}")
    if a.out:
        Path(a.out).write_text(json.dumps({"summary": summary, "windows": ranked}, ensure_ascii=False, indent=1))


main()
