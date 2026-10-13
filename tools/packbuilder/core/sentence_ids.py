"""Text-stable sentence ids. tools/sentence_ids_v1.json = {"issued": {"s0001": "<exact emitted text>"}}.
Ids are opaque keys to the engine (learner records key on them), so a rebuild must not move one:
a sentence claims the first unclaimed issued id with the same text, new text gets an id above
the highest ever issued, and issued ids are never removed (a retired id is never reissued)."""
import json
from collections import defaultdict
from pathlib import Path


def load(path):
    p = Path(path) if path else None
    if p is None or not p.exists():
        return {}
    issued = json.loads(p.read_text(encoding="utf-8")).get("issued", {})
    return dict(issued)


def save(path, issued):
    ordered = {k: issued[k] for k in sorted(issued)}
    Path(path).write_text(json.dumps({"issued": ordered}, ensure_ascii=False, indent=0, separators=(",", ":")) + "\n",
                          encoding="utf-8")


def next_number(issued):
    return max([int(k[1:]) for k in issued] + [0]) + 1


def assign(texts, issued):
    """Ids for texts (in output order). Returns (ids, new_issued, stats). issued is not mutated."""
    by_text = defaultdict(list)
    for sid in sorted(issued):
        by_text[issued[sid]].append(sid)
    ids = [None] * len(texts)
    claimed = set()
    for i, t in enumerate(texts):
        for sid in by_text.get(t, ()):
            if sid not in claimed:
                ids[i] = sid
                claimed.add(sid)
                break
    out = dict(issued)
    nxt = next_number(issued)
    fresh = []
    for i, t in enumerate(texts):
        if ids[i] is None:
            ids[i] = f"s{nxt:04d}"
            out[ids[i]] = t
            fresh.append(ids[i])
            nxt += 1
    assert len(set(ids)) == len(ids), "sentence id claimed twice"
    retired = sorted(set(issued) - claimed)
    return ids, out, {"kept": len(claimed), "new": fresh, "retired": retired}


def bootstrap(pack_sentences, issued=None):
    """issued map from a shipped sentences.json (ids as live), unioned with any existing map.
    Raises ValueError when an id would change text."""
    out = dict(issued or {})
    for r in pack_sentences:
        if out.setdefault(r["id"], r["t"]) != r["t"]:
            raise ValueError(f"{r['id']}: map has {out[r['id']]!r}, pack has {r['t']!r}")
    return out


def main(lang, repo, do_bootstrap):
    from ..langs import get_spec
    sp = get_spec(lang, repo, load=False)
    path = Path(repo) / sp.sentence_id_map_file
    if not do_bootstrap:
        print(f"{path}: {len(load(path))} issued ids")
        return 0
    live = json.loads((Path(repo) / "pack" / "sentences.json").read_text(encoding="utf-8"))
    issued = bootstrap(live, load(path))
    save(path, issued)
    print(f"{path}: {len(issued)} issued ids ({len(live)} live)")
    return 0
