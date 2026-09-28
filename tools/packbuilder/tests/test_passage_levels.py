"""Passage level budget re-applied to a shipped passages.json (qa check).
A words rebuild can move a linked word above its passage's level; the pack
check must fail then, not only `passages --check`. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_passage_levels.py     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.passages import DEFAULT_RULES, budget_errors, shipped_level_errors  # noqa: E402

LEVELS = ["A1", "A2", "B1"]


def word(wid, lemma, lv):
    return {"id": wid, "w": lemma, "lemma": lemma, "lv": lv}


def passage(pid, lv, sent_ids, q_ids=()):
    return {"id": pid, "lv": lv, "sentences": [{"t": "x", "en": "x", "words": list(sent_ids)}],
            "questions": [{"words": list(q_ids)}] if q_ids else []}


class BudgetRule(unittest.TestCase):
    def test_one_level_up_within_cap(self):
        self.assertEqual(budget_errors("A1", {"A2": {"a", "b", "c"}}, DEFAULT_RULES["budget"]), [])

    def test_over_cap(self):
        e = budget_errors("A1", {"A2": {"a", "b", "c", "d"}}, DEFAULT_RULES["budget"])
        self.assertEqual(e, ["4 A2 words > 3: ['a', 'b', 'c', 'd']"])

    def test_two_levels_up(self):
        e = budget_errors("A1", {"B1": {"x"}}, DEFAULT_RULES["budget"])
        self.assertEqual(e, ["B1 words not allowed at A1: ['x']"])

    def test_top_level_nothing_above(self):
        self.assertEqual(budget_errors("B1", {}, DEFAULT_RULES["budget"]), [])


class ShippedPassages(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        (self.repo / "pack").mkdir()
        (self.repo / "tools").mkdir()
        self.words = [word("w1", "a", "A1"), word("w2", "b", "A2"), word("w3", "c", "B1")]

    def tearDown(self):
        self.tmp.cleanup()

    def test_level_drift_fails(self):
        # hi p0016: सुनाना was A2 when the passage was written, B1 after a words rebuild
        ps = [passage("p1", "A1", ["w1", "w3"])]
        self.assertEqual(shipped_level_errors(self.repo, LEVELS, self.words, ps),
                         ["passage p1 (A1): B1 words not allowed at A1: ['c']"])

    def test_question_words_count(self):
        ps = [passage("p1", "A1", ["w1"], ["w3"])]
        self.assertEqual(len(shipped_level_errors(self.repo, LEVELS, self.words, ps)), 1)

    def test_in_budget_passes(self):
        ps = [passage("p1", "A1", ["w1", "w2"]), passage("p2", "A2", ["w3"]), passage("p3", "B1", ["w3"])]
        self.assertEqual(shipped_level_errors(self.repo, LEVELS, self.words, ps), [])

    def test_repo_rules_override_budget(self):
        (self.repo / "tools" / "passages_src.json").write_text(json.dumps(
            {"rules": {"budget": {"A1": ["A2", 0], "A2": ["B1", 3], "B1": [None, 0]}}, "passages": []}))
        ps = [passage("p1", "A1", ["w2"])]
        self.assertEqual(shipped_level_errors(self.repo, LEVELS, self.words, ps),
                         ["passage p1 (A1): 1 A2 words > 0: ['b']"])

    def test_unknown_id_fails(self):
        ps = [passage("p1", "A1", ["w9"])]
        self.assertEqual(shipped_level_errors(self.repo, LEVELS, self.words, ps),
                         ["passage p1: unknown word id w9"])


if __name__ == "__main__":
    unittest.main()
