"""Shipped word order (core/words.sort_by_rank, run by build_words and again
at the end of pipeline.finish_words): level, then rank ascending, stable;
Learn sets are cut from this order. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_rank_sort.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import sort_by_rank  # noqa: E402

LV = ["A1", "A2", "B1"]


def ids(ws):
    return [w["id"] for w in ws]


class RankSort(unittest.TestCase):
    def test_level_then_rank(self):
        ws = [{"id": "a", "lv": "A2", "rank": 5}, {"id": "b", "lv": "A1", "rank": 900},
              {"id": "c", "lv": "A1", "rank": 3}, {"id": "d", "lv": "B1", "rank": 1}]
        self.assertEqual(ids(sort_by_rank(LV, ws)), ["c", "b", "a", "d"])

    def test_ties_keep_file_order(self):
        ws = [{"id": "x", "lv": "A1", "rank": 2}, {"id": "y", "lv": "A1", "rank": 2}, {"id": "z", "lv": "A1", "rank": 1}]
        self.assertEqual(ids(sort_by_rank(LV, ws)), ["z", "x", "y"])

    def test_missing_rank_after_ranked_in_file_order(self):
        ws = [{"id": "m1", "lv": "A1"}, {"id": "r", "lv": "A1", "rank": 7}, {"id": "m2", "lv": "A1", "rank": None},
              {"id": "b", "lv": "A2", "rank": 1}]
        self.assertEqual(ids(sort_by_rank(LV, ws)), ["r", "m1", "m2", "b"])

    def test_unranked_pack_keeps_file_order_per_level(self):
        ws = [{"id": "3", "lv": "A1"}, {"id": "1", "lv": "A1"}, {"id": "2", "lv": "A2"}]
        self.assertEqual(ids(sort_by_rank(LV, ws)), ["3", "1", "2"])

    def test_unknown_level_last(self):
        ws = [{"id": "u", "lv": "C1", "rank": 1}, {"id": "a", "lv": "B1", "rank": 9}]
        self.assertEqual(ids(sort_by_rank(LV, ws)), ["a", "u"])

    def test_forced_floor_word_sits_at_its_rank(self):
        # a forced-A1 word keeps its corpus rank, so it lands at the end of A1
        ws = [{"id": "f", "lv": "A1", "rank": 1500}, {"id": "a", "lv": "A1", "rank": 10},
              {"id": "b", "lv": "A2", "rank": 700}]
        self.assertEqual(ids(sort_by_rank(LV, ws)), ["a", "f", "b"])


if __name__ == "__main__":
    unittest.main()
