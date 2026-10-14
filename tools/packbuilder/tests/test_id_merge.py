"""An id decision never depends on hand gloss text once the id is issued (core/words.py second_pos_merges,
shipped_issued_keys). The same-sense / weak-evidence merge of a second POS entry applies only to records that
do not ship under an issued id. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_merge.py     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from packbuilder.core.words import second_pos_merges, shipped_issued_keys  # noqa: E402


class SecondPosMerge(unittest.TestCase):
    def test_issued_pair_stays_whatever_the_gloss_says(self):
        # sw jibu: noun "answer, reply" shares a stem with verb "to answer" (same_sense), yet both ship
        self.assertFalse(second_pos_merges("jibu", True, True, frozenset(), True))
        self.assertFalse(second_pos_merges("jibu", True, False, frozenset(), True))

    def test_record_without_issued_id_still_merges(self):
        self.assertTrue(second_pos_merges("jibu", True, False, frozenset(), False))
        self.assertTrue(second_pos_merges("x", False, True, frozenset(), False))

    def test_weak_evidence_exemption_unchanged(self):
        self.assertFalse(second_pos_merges("jibu", False, True, frozenset({"jibu"}), False))
        self.assertFalse(second_pos_merges("x", False, False, frozenset(), False))


class IssuedKeys(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.map = self.tmp / "id_map_v1.json"
        self.words = self.tmp / "words.json"

    def test_keys_whose_id_ships(self):
        self.map.write_text(json.dumps({"jibu|verb": "w1", "jibu|noun": "w2", "uchi|adj": "w3"}))
        self.words.write_text(json.dumps([{"id": "w1"}, {"id": "w2"}]))
        self.assertEqual(shipped_issued_keys(self.map, self.words), {"jibu|verb", "jibu|noun"})

    def test_retired_key_is_not_issued(self):
        # a key an earlier build shipped and a later one dropped has no live id to protect
        self.map.write_text(json.dumps({"uchi|adj": "w3", "uchi|noun": "w4"}))
        self.words.write_text(json.dumps([{"id": "w4"}]))
        self.assertEqual(shipped_issued_keys(self.map, self.words), {"uchi|noun"})

    def test_fresh_build_without_map_or_pack_protects_nothing(self):
        self.assertEqual(shipped_issued_keys(self.map, self.words), set())
        self.map.write_text(json.dumps({"a|noun": "w1"}))
        self.assertEqual(shipped_issued_keys(self.map, self.words), set())


if __name__ == "__main__":
    unittest.main()
