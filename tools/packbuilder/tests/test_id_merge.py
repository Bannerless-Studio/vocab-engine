"""An id decision never depends on hand gloss text once the id is issued. A second-POS entry folds into the
first (same-sense rule) only when the record it drops has no "lemma|pos" key marked shipped in the id map (core/words.py
second_pos_merges, shipped_markers, persist_ids, build_words). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_merge.py     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from packbuilder.core import words as W  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class SecondPosMerges(unittest.TestCase):
    def test_issued_pair_stays_whatever_the_gloss_says(self):
        self.assertFalse(W.second_pos_merges("jibu", True, True, frozenset(), True))
        self.assertFalse(W.second_pos_merges("jibu", True, False, frozenset(), True))

    def test_record_without_issued_id_still_merges(self):
        self.assertTrue(W.second_pos_merges("jibu", True, False, frozenset(), False))
        self.assertTrue(W.second_pos_merges("x", False, True, frozenset(), False))

    def test_weak_evidence_exemption_unchanged(self):
        self.assertFalse(W.second_pos_merges("jibu", False, True, frozenset({"jibu"}), False))
        self.assertFalse(W.second_pos_merges("x", False, False, frozenset(), False))


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "pack").mkdir()
        self.map = self.tmp / "tools_id_map_v1.json"
        self.words = self.tmp / "pack" / "words.json"


class Markers(Fixture):
    def test_marker_read_as_written(self):
        self.map.write_text(json.dumps({"a|noun": "w1", "b|noun": "w2", "_shipped": ["a|noun"]}))
        self.assertEqual(W.shipped_markers(self.map, self.words), {"a|noun"})
        self.assertEqual(W.persisted_idmap(self.map), {"a|noun": "w1", "b|noun": "w2"})

    def test_empty_marker_is_a_marker(self):
        # a retired key stays unmarked even when the pack still lists its id
        self.map.write_text(json.dumps({"a|noun": "w1", "_shipped": []}))
        self.words.write_text(json.dumps([{"id": "w1"}]))
        self.assertEqual(W.shipped_markers(self.map, self.words), set())

    def test_map_without_marker_seeds_from_pack(self):
        self.map.write_text(json.dumps({"a|noun": "w1", "b|noun": "w2", "c|adj": "w1"}))
        self.words.write_text(json.dumps([{"id": "w1"}]))
        self.assertEqual(W.shipped_markers(self.map, self.words), {"a|noun", "c|adj"})

    def test_no_map_or_no_pack_marks_nothing(self):
        self.assertEqual(W.shipped_markers(self.map, self.words), set())
        self.map.write_text(json.dumps({"a|noun": "w1"}))
        self.assertEqual(W.shipped_markers(self.map, self.words), set())

    def test_persist_ids_moves_only_the_marker(self):
        self.map.write_text(json.dumps({"a|noun": "w1", "b|noun": "w2", "_shipped": ["a|noun", "b|noun"]}))
        W.persist_ids(self.map, [{"id": "w1", "lemma": "a", "pos": "noun"}])
        raw = json.loads(self.map.read_text())
        self.assertEqual(raw["_shipped"], ["a|noun"])
        self.assertEqual({k: v for k, v in raw.items() if k != "_shipped"}, {"a|noun": "w1", "b|noun": "w2"})
        W.persist_ids(self.map, [{"id": "w1", "lemma": "a", "pos": "noun"}, {"id": "w2", "lemma": "b", "pos": "noun"}])
        self.assertEqual(json.loads(self.map.read_text())["_shipped"], ["a|noun", "b|noun"])

    def test_dry_run_writes_nothing(self):
        self.map.write_text(json.dumps({"a|noun": "w1"}))
        before = self.map.read_text()
        W.persist_ids(self.map, [{"id": "w1", "lemma": "a", "pos": "noun"}], write=False)
        self.assertEqual(self.map.read_text(), before)

    def test_assign_ids_ignores_the_marker(self):
        ids = W.persisted_idmap(self._write({"a|noun": "w0003", "_shipped": ["a|noun"]}))
        words = [{"lemma": "a", "pos": "noun"}, {"lemma": "b", "pos": "noun"}]
        W.assign_ids(words, ids)
        self.assertEqual([w["id"] for w in words], ["w0003", "w0004"])

    def _write(self, d):
        self.map.write_text(json.dumps(d))
        return self.map


class BuildWordsSecondPos(Fixture):
    """build_words over a stub lexicon: jibu verb "to answer" and jibu noun "answer, reply" share a stem."""

    def run_build(self, order, idmap, forced=(), pack_ids=None):
        if idmap is not None:
            self.map.write_text(json.dumps(idmap))
        if pack_ids is not None:
            self.words.write_text(json.dumps([{"id": i} for i in pack_ids]))
        sp = get_spec("sw", repo=self.tmp, load=False)
        sp.repo = str(self.tmp)
        sp.id_map_file = self.map.name
        sp.forced = list(forced)
        sp.drop_keys, sp.gloss_overrides, sp.fixed_gloss = {}, {}, {}
        en = {"VERB": "to answer", "NOUN": "answer, reply"}
        pos = {"VERB": "verb", "NOUN": "noun"}
        lex = SimpleNamespace(E={}, usable_entries=lambda lem, kpos: [{"p": p, "s": [], "g": None} for p in (
            ["noun", "verb"] if kpos is None else list(kpos)) if p in ("noun", "verb")])
        blended = [(("jibu", g), 1.0, 1.0, 1.0, 1.0) for g in order]
        ctx = {"lexicon": lex, "raw_upos": {}, "morph": {}, "blended": blended,
               "truecase": (defaultdict(int), defaultdict(int)),
               "lemma_groups": {"jibu": Counter({"NOUN": 10, "VERB": 10})},
               "refl": {"_stative": Counter()}, "initial": Counter(), "en_bg": {}, "en_bgn": {}, "rows_by_sid": {}, "tagged": [], "en_by_sid": {}}
        stats = {}

        class Stop(Exception):
            pass

        def stat(k, v):
            stats[k] = v
            if k == "second_pos_entries_in_pool":
                raise Stop

        def senses(e, g, df, nsent, closed, *a):
            return [{"g": en[g], "score": 1.0, "defn": False, "demote": False, "idx": 0}]

        patches = mock.patch.multiple(W, sense_candidates=senses, compose_gloss=lambda rows: (rows[0]["g"], rows[0]),
                                      english_bags=lambda *a, **k: {(("jibu", g)): [10, Counter()] for g in order},
                                      stat=stat)
        with patches, mock.patch("wordfreq.top_n_list", lambda *a, **k: []):
            try:
                W.build_words(SimpleNamespace(spec=sp, repo=self.tmp, pack=self.tmp / "pack"), ctx)
            except Stop:
                pass
        return stats["second_pos_entries_in_pool"], stats["excluded"]

    IDS = {"jibu|verb": "w1", "jibu|noun": "w2"}

    def test_no_map_merges_by_gloss(self):
        for order in (["VERB", "NOUN"], ["NOUN", "VERB"]):
            kept, excl = self.run_build(order, None)
            self.assertEqual(kept, [])
            self.assertEqual(sum(excl.values()), 1)

    def test_unmarked_keys_merge(self):
        # keys in the map but retired (marker empty): no say in the merge, and no re-admission
        for order in (["VERB", "NOUN"], ["NOUN", "VERB"]):
            kept, _ = self.run_build(order, {**self.IDS, "_shipped": []})
            self.assertEqual(kept, [])

    def test_marked_second_is_kept_both_orders(self):
        # the record the merge would exclude holds an issued id: it stays, with or without the first's marker
        for order, second in ((["VERB", "NOUN"], "NOUN"), (["NOUN", "VERB"], "VERB")):
            for first_marked in (False, True):
                marked = [f"jibu|{second.lower()}"] + ([f"jibu|{'verb' if second == 'NOUN' else 'noun'}"] if first_marked else [])
                kept, excl = self.run_build(order, {**self.IDS, "_shipped": marked})
                self.assertEqual(kept, [f"jibu {second}"], (order, marked))
                self.assertEqual(sum(excl.values()), 0)

    def test_only_first_marked_still_merges_the_unissued_second(self):
        # no issued id is lost: the second never had one, so it folds as before (re-admitting it would add a word)
        for order in (["VERB", "NOUN"], ["NOUN", "VERB"]):
            first = "jibu|verb" if order[0] == "VERB" else "jibu|noun"
            kept, excl = self.run_build(order, {**self.IDS, "_shipped": [first]})
            self.assertEqual(kept, [])
            self.assertEqual(sum(excl.values()), 1)

    def test_forced_replace_skipped_only_when_the_first_is_marked(self):
        forced = [("jibu", "NOUN")]
        kept, _ = self.run_build(["VERB", "NOUN"], None, forced=forced)
        self.assertEqual(kept, [])                       # forced noun replaces the unissued verb record
        kept, _ = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|verb"]}, forced=forced)
        self.assertEqual(kept, ["jibu NOUN"])            # the verb record holds an issued id: it stays
        kept, _ = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|noun"]}, forced=forced)
        self.assertEqual(kept, [])                       # the forced noun is kept anyway; nothing issued is lost

    def test_map_without_marker_seeds_from_pack(self):
        kept, _ = self.run_build(["VERB", "NOUN"], self.IDS, pack_ids=["w1", "w2"])
        self.assertEqual(kept, ["jibu NOUN"])
        kept, _ = self.run_build(["VERB", "NOUN"], self.IDS, pack_ids=["w9"])
        self.assertEqual(kept, [])
        self.words.unlink()
        kept, _ = self.run_build(["VERB", "NOUN"], self.IDS)
        self.assertEqual(kept, [])


if __name__ == "__main__":
    unittest.main()
