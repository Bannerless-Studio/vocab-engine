#!/usr/bin/env python3
"""Republish pack diff guard: the pack in the working tree may differ from the one committed at --prev only in the
allowed places. Exit 1 and print every offending key otherwise.

  pack_diff_guard.py --repo SITE --prev REV [--pack-dir pack] [--lang CODE --engine-tools DIR]
        [--pack-keys a,b] [--word-fields ft] [--unit-fields ft] [--free-files x.json,y.json]

Allowed: pack.json top-level keys = spec.port_flags() keys (needs --lang/--engine-tools) + eta + --pack-keys, and the removal
of a collapsed flag (tools/pack_collapsed.py: the engine ignores it, enrich drops it);
words.json per-word fields = --word-fields; characters.json per-unit fields = --unit-fields; any other *.json
byte-equal after parsing, unless listed in --free-files. Same ids, same order, same length everywhere else."""
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


def rows(name, old, new, fields, bad, stats):
    if len(old) != len(new):
        bad.append(f"{name}: length {len(old)} -> {len(new)}")
        return
    for i, (a, b) in enumerate(zip(old, new)):
        if isinstance(a, dict) and isinstance(b, dict):
            keys = set(a) | set(b)
            diff = sorted(k for k in keys if a.get(k, "<absent>") != b.get(k, "<absent>"))
            if a.get("id") != b.get("id"):
                bad.append(f"{name}[{i}]: id {a.get('id')!r} -> {b.get('id')!r}")
            for k in diff:
                if k in fields:
                    stats[k] = stats.get(k, 0) + 1
                elif len(bad) < 40:
                    bad.append(f"{name}[{i}] ({a.get('id', a.get('w', i))}): field {k!r} changed")
        elif a != b:
            bad.append(f"{name}[{i}]: changed")


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
        elif n == "words.json":
            rows(n, old, new, wf, bad, stats)
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
