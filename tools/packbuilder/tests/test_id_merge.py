"""An id decision never depends on hand gloss text once the id is issued. A second-POS entry folds into the
first (same-sense rule) unless BOTH keys of the pair are marked shipped in the id map (core/words.py
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

    def run_build(self, order, idmap, forced=(), pack_ids=None, to_words=False, word_pos=None):
        if idmap is not None:
            self.map.write_text(json.dumps(idmap))
        if pack_ids is not None:
            self.words.write_text(json.dumps([{"id": i} for i in pack_ids]))
        sp = get_spec("sw", repo=self.tmp, load=False)
        sp.repo = str(self.tmp)
        sp.id_map_file = self.map.name
        sp.forced = list(forced)
        sp.drop_keys, sp.gloss_overrides, sp.fixed_gloss = {}, {}, {}
        if word_pos:
            sp.word_pos = word_pos
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
            if k == "second_pos_entries_in_pool" and not to_words:
                raise Stop

        def sort_by_rank(level_ids, words):
            stats["words"] = words
            raise Stop

        def senses(e, g, df, nsent, closed, *a):
            return [{"g": en[g], "score": 1.0, "defn": False, "demote": False, "idx": 0}]

        patches = mock.patch.multiple(W, sense_candidates=senses, compose_gloss=lambda rows: (rows[0]["g"], rows[0]),
                                      english_bags=lambda *a, **k: {(("jibu", g)): [10, Counter()] for g in order},
                                      stat=stat, **({"sort_by_rank": sort_by_rank} if to_words else {}))
        with patches, mock.patch("wordfreq.top_n_list", lambda *a, **k: []):
            try:
                W.build_words(SimpleNamespace(spec=sp, repo=self.tmp, pack=self.tmp / "pack"), ctx)
            except Stop:
                pass
        if to_words:
            return stats["words"]
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

    def ids_of(self, words):
        ids = W.persisted_idmap(self.map)
        W.assign_ids(words, ids)
        return {(w["lemma"], w["pos"]): w["id"] for w in words}

    def test_both_marked_keeps_pair_both_orders(self):
        # two shipped ids would collapse into one
        for order, second in ((["VERB", "NOUN"], "NOUN"), (["NOUN", "VERB"], "VERB")):
            kept, excl = self.run_build(order, {**self.IDS, "_shipped": ["jibu|verb", "jibu|noun"]})
            self.assertEqual(kept, [f"jibu {second}"], order)
            self.assertEqual(sum(excl.values()), 0)

    def test_dropped_side_marked_merges_and_the_shipped_id_survives(self):
        # ar أمر / عال / كاف: the dropped second holds the shipped id, the survivor key is unissued. The merge
        # is harmless when the merged record still gets that id (here the label follows the dropped key's pos,
        # as ar word_pos does from the dictionary entry) and keeping both would add a same-sense duplicate
        ar_like = lambda rec, pos, keys: "noun"
        kept, excl = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|noun"]})
        self.assertEqual((kept, sum(excl.values())), ([], 1))
        words = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|noun"]}, to_words=True, word_pos=ar_like)
        self.assertEqual(self.ids_of(words), {("jibu", "noun"): "w2"})

    def test_survivor_side_marked_merges(self):
        for order, first_key in ((["VERB", "NOUN"], "jibu|verb"), (["NOUN", "VERB"], "jibu|noun")):
            kept, excl = self.run_build(order, {**self.IDS, "_shipped": [first_key]})
            self.assertEqual((kept, sum(excl.values())), ([], 1), order)
        words = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|verb"]}, to_words=True)
        self.assertEqual(self.ids_of(words), {("jibu", "verb"): "w1"})

    def test_forced_replace_both_ways(self):
        forced = [("jibu", "NOUN")]
        kept, _ = self.run_build(["VERB", "NOUN"], None, forced=forced)
        self.assertEqual(kept, [])                                        # forced noun replaces the verb record
        kept, _ = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|verb", "jibu|noun"]}, forced=forced)
        self.assertEqual(kept, ["jibu NOUN"])                             # both shipped: nothing collapses
        kept, _ = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|verb"]}, forced=forced)
        self.assertEqual(kept, [])                                        # dropped verb marked, survivor not: merge
        words = self.run_build(["VERB", "NOUN"], {**self.IDS, "_shipped": ["jibu|noun"]}, forced=forced, to_words=True)
        self.assertEqual(self.ids_of(words), {("jibu", "noun"): "w2"})    # forced survivor keeps its shipped id

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
