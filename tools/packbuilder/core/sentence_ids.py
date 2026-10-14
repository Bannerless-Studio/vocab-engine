"""Text-stable sentence ids. tools/sentence_ids_v1.json = {"issued": {"s0001": "<exact emitted text>"}}.
Ids are opaque keys to the engine (learner records key on them), so a rebuild must not move one:
a sentence claims the first unclaimed issued id with the same text, new text gets an id above
the highest ever issued, and issued ids are never removed (a retired id is never reissued)."""
import json
from collections import Counter, defaultdict
from pathlib import Path


def load(path):
    p = Path(path) if path else None
    if p is None or not p.exists():
        return {}
    issued = json.loads(p.read_text(encoding="utf-8")).get("issued", {})
    return dict(issued)


def shipped_sentences(repo):
    """The committed pack's sentence records ([] before the first build)."""
    p = Path(repo) / "pack" / "sentences.json" if repo else None
    return json.loads(p.read_text(encoding="utf-8")) if p is not None and p.exists() else []


def save(path, issued):
    ordered = {k: issued[k] for k in sorted(issued, key=lambda k: int(k[1:]))}
    Path(path).write_text(json.dumps({"issued": ordered}, ensure_ascii=False, indent=0, separators=(",", ":")) + "\n",
                          encoding="utf-8")


def next_number(issued):
    return max([int(k[1:]) for k in issued] + [0]) + 1


def assign(texts, issued, legacy=None):
    """Ids for texts (in output order). Returns (ids, new_issued, stats). issued is not mutated.
    texts are the exact shipped texts. legacy (optional, same length) are the earlier-stage texts a map
    written before ids moved after the finishing passes may hold: a sentence whose legacy text differs claims
    the id issued for that text, and the id is rewritten to the shipped text (stats "rekeyed"), so the map
    converges on shipped texts and the next build matches directly."""
    by_text = defaultdict(list)
    for sid in sorted(issued, key=lambda k: int(k[1:])):
        by_text[issued[sid]].append(sid)
    ids = [None] * len(texts)
    claimed = set()

    def claim(i, t):
        for sid in by_text.get(t, ()):
            if sid not in claimed:
                ids[i] = sid
                claimed.add(sid)
                return True
        return False

    out = dict(issued)
    rekeyed = 0
    shipped = Counter(texts)
    # a map written before ids moved after the finishing passes holds the earlier text, and two sentences
    # can finish to one text (fa: Arabic and Persian yeh): the earlier text is the exact one, so it goes first.
    # Finishing passes are idempotent, so a map of shipped texts never holds a different sentence's earlier text.
    if legacy:
        for i, t in enumerate(texts):
            if legacy[i] != t and claim(i, legacy[i]):
                # a text two sentences ship keeps the earlier text as the key, which tells the two apart
                # a map that already holds the shipped text under another id keeps the earlier key: rekeying
                # would put one text under two ids and the next build would claim the lower one
                if shipped[t] == 1 and not by_text.get(t):
                    out[ids[i]] = t
                    rekeyed += 1
    for i, t in enumerate(texts):
        if ids[i] is None:
            claim(i, t)
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
    return ids, out, {"kept": len(claimed), "new": fresh, "retired": retired, "rekeyed": rekeyed}


def verify(texts, ids, issued, legacy=None):
    """Round trip: replay assign over the map about to be saved. Returns the ids that a rebuild with the
    same texts would not give back (a text changed after assign, a key that does not claim its own id);
    empty when sound."""
    again, _, _ = assign(texts, issued, legacy)
    return [a for a, b in zip(ids, again) if a != b]


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
    import sys
    dup = sorted(t for t, n in Counter(r["t"] for r in live).items() if n > 1)
    if dup:
        print(f"WARNING {len(dup)} repeated sentence texts: bootstrap pairs their ids in id order, a builder "
              f"run pairs them in corpus order, so check the pairs once: {dup[:5]}", file=sys.stderr)
    save(path, issued)
    print(f"{path}: {len(issued)} issued ids ({len(live)} live)")
    return 0
