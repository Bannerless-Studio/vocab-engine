#!/usr/bin/env python3
"""Republish pack diff guard: the pack in the working tree may differ from the one committed at --prev only in the
allowed places. Exit 1 and print every offending key otherwise.

  pack_diff_guard.py --repo SITE --prev REV [--pack-dir pack] [--lang CODE --engine-tools DIR]
        [--pack-keys a,b] [--word-fields ft] [--unit-fields ft] [--free-files x.json,y.json]
        [--word-ids-removed w1,w2 --word-ids-added w3,w4]

Allowed: pack.json top-level keys = spec.port_flags() keys (needs --lang/--engine-tools) + eta + --pack-keys, and the removal
of a collapsed flag (tools/pack_collapsed.py: the engine ignores it, enrich drops it);
words.json per-word fields = --word-fields (rows match by id; an id only in old or only in new must be listed in
--word-ids-removed / --word-ids-added, exact sets); characters.json per-unit fields = --unit-fields; any other *.json
byte-equal after parsing, unless listed in --free-files; sentences.json is held to the sentence id rule
(sentence_ids_rule: every live id keeps its text and stays, new texts take new ids, other fields free) unless listed in --free-files. Same ids, same order, same length everywhere else (characters.json too)."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pack_collapsed import COLLAPSED  # noqa: E402  (tools/)


def git_show(repo, rev, rel):
    p = subprocess.run(["git", "-C", repo, "show", f"{rev}:{rel}"], capture_output=True)
    return json.loads(p.stdout) if p.returncode == 0 else None


def git_files(repo, rev, d):
    out = subprocess.run(["git", "-C", repo, "ls-tree", "--name-only", f"{rev}", f"{d}/"], capture_output=True, text=True, check=True).stdout
    return sorted(Path(x).name for x in out.split() if x.endswith(".json"))


def rows(name, old, new, fields, bad, stats, removed=frozenset(), added=frozenset()):
    """Rows match by id, not by position: a removed or added row never shifts the rows after it. An id only in
    old / only in new must be listed in removed / added (exact set equality)."""
    if not all(isinstance(r, dict) and "id" in r for r in old + new):
        if len(old) != len(new):
            bad.append(f"{name}: length {len(old)} -> {len(new)}")
            return
        pairs = list(enumerate(zip(old, new)))
    else:
        oi, ni = {r["id"]: r for r in old}, {r["id"]: r for r in new}
        gone, fresh = set(oi) - set(ni), set(ni) - set(oi)
        for label, got, want in (("removed", gone, set(removed)), ("added", fresh, set(added))):
            if got != want:
                bad.append(f"{name}: ids {label} {sorted(got)} but the allowed list is {sorted(want)}"
                           f" (unexpected {sorted(got - want)}, missing {sorted(want - got)})")
        if len(new) - len(old) != len(fresh) - len(gone):
            bad.append(f"{name}: length {len(old)} -> {len(new)} is not the removed/added ids")
        if [r["id"] for r in old if r["id"] in ni] != [r["id"] for r in new if r["id"] in oi]:
            bad.append(f"{name}: order of the kept ids changed")
        if gone or fresh:
            stats["ids removed"] = len(gone)
            stats["ids added"] = len(fresh)
        pairs = [(i, (oi[r["id"]], r)) for i, r in enumerate(new) if r["id"] in oi]
    for i, (a, b) in pairs:
        if isinstance(a, dict) and isinstance(b, dict):
            keys = set(a) | set(b)
            diff = sorted(k for k in keys if a.get(k, "<absent>") != b.get(k, "<absent>"))
            for k in diff:
                if k in fields:
                    stats[k] = stats.get(k, 0) + 1
                elif len(bad) < 40:
                    bad.append(f"{name}[{i}] ({a.get('id', a.get('w', i))}): field {k!r} changed")
        elif a != b:
            bad.append(f"{name}[{i}]: changed")


def sentence_ids_rule(old, new, bad, notes):
    """Learner records key on sentence ids (opaque to the engine): a live id never changes text and never disappears."""
    new_ids = [r["id"] for r in new]
    dup = sorted({i for i in new_ids if new_ids.count(i) > 1})
    bad += [f"sentences.json: duplicate id {i}" for i in dup[:40]]
    now = {r["id"]: r["t"] for r in new}
    for r in old:
        if r["id"] not in now:
            bad.append(f"sentences.json: live id {r['id']} disappeared ({r['t'][:40]!r})")
        elif now[r["id"]] != r["t"]:
            bad.append(f"sentences.json: live id {r['id']} text changed {r['t'][:40]!r} -> {now[r['id']][:40]!r}")
    fresh = len(set(now) - {r["id"] for r in old})
    notes.append(f"sentences.json: {len(old)} live ids kept, {fresh} new ids")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--prev", required=True)
    ap.add_argument("--pack-dir", default="pack")
    ap.add_argument("--lang")
    ap.add_argument("--engine-tools")
    ap.add_argument("--pack-keys", default="")
    ap.add_argument("--word-fields", default="ft")
    ap.add_argument("--unit-fields", default="ft")
    ap.add_argument("--free-files", default="")
    ap.add_argument("--word-ids-removed", default="")
    ap.add_argument("--word-ids-added", default="")
    a = ap.parse_args()
    split = lambda s: {x for x in s.split(",") if x}
    allow_keys = split(a.pack_keys) | {"eta"}
    if a.lang and a.engine_tools:
        sys.path.insert(0, a.engine_tools)
        from packbuilder.langs import get_spec  # noqa: E402
        allow_keys |= set(get_spec(a.lang, a.repo, load=False).port_flags())
    wf, uf, free = split(a.word_fields), split(a.unit_fields), split(a.free_files)
    cur = Path(a.repo) / a.pack_dir
    prev_names = git_files(a.repo, a.prev, a.pack_dir)
    now_names = sorted(p.name for p in cur.glob("*.json"))
    bad, stats, notes = [], {}, []
    for n in sorted(set(now_names) - set(prev_names)):
        (notes if n in free else bad).append(f"{n}: new file")
    for n in sorted(set(prev_names) - set(now_names)):
        (notes if n in free else bad).append(f"{n}: removed")
    for n in sorted(set(prev_names) & set(now_names)):
        old, new = git_show(a.repo, a.prev, f"{a.pack_dir}/{n}"), json.loads((cur / n).read_text(encoding="utf-8"))
        if old == new:
            continue
        if n in free:
            notes.append(f"{n}: changed (free)")
        elif n == "pack.json":
            keys = sorted(k for k in set(old) | set(new) if old.get(k, "<absent>") != new.get(k, "<absent>"))
            off = [k for k in keys if k not in allow_keys and not (k in COLLAPSED and k not in new)]
            bad += [f"pack.json: key {k!r} changed and is not an allowed key" for k in off]
            notes.append("pack.json keys changed: " + ", ".join(keys))
        elif n == "sentences.json":
            sentence_ids_rule(old, new, bad, notes)
        elif n == "words.json":
            rows(n, old, new, wf, bad, stats, split(a.word_ids_removed), split(a.word_ids_added))
        elif n == "characters.json":
            rows(n, old, new, uf, bad, stats)
        else:
            bad.append(f"{n}: changed (not an allowed file)")
    for line in notes:
        print("  " + line)
    for k, c in sorted(stats.items()):
        print(f"  rows with {k!r} changed: {c}")
    if bad:
        print("PACK DIFF GUARD FAIL:")
        for line in bad[:40]:
            print("  " + line)
        if len(bad) > 40:
            print(f"  ... {len(bad) - 40} more")
        return 1
    print("pack diff guard: ok")
    return 0


sys.exit(main())
