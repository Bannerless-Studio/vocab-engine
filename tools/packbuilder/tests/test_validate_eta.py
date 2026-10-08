"""tools/validate_pack.py pack.eta rules (docs/PACK_SCHEMA.md "eta"): the fb42 curve shape and the legacy {gain, known}."""
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TOOLS))

import validate_pack  # noqa: E402

GOALS = {"goals": [{"upTo": "1"}, {"upTo": "2"}, {"upTo": "3"}]}
C = [[0, 96.3], [0.5, 40.0], [0.9, 0]]


def eta_errors(eta, pm=GOALS):
    rep = validate_pack.Report()
    validate_pack.check_pack({"key": "x", "levels": [{"id": "1"}, {"id": "2"}, {"id": "3"}], "progressMap": pm, "eta": eta}, rep)
    return [e for e in rep.errors if "eta" in e]


class EtaRules(unittest.TestCase):
    def test_curve_shape_ok(self):
        self.assertEqual(eta_errors({"curve": [C, C, None], "knownCurve": {"1": [[0, 19.0], [0.7, 0]], "2": None}}), [])
        self.assertEqual(eta_errors({"curve": [None, None, None], "knownCurve": None}), [])

    def test_legacy_gain_ok(self):
        self.assertEqual(eta_errors({"gain": [0.01, None, 0.02], "known": 5.2}), [])
        self.assertEqual(eta_errors({"gain": [None, None, None], "known": None}), [])

    def test_one_curve_per_goal(self):
        self.assertTrue(any("3 goals" in e for e in eta_errors({"curve": [C, C]})))

    def test_monotone_and_positions(self):
        self.assertTrue(any("non-increasing" in e for e in eta_errors({"curve": [[[0, 10], [0.5, 12], [0.9, 0]], None, None]})))
        self.assertTrue(any("strictly increasing" in e for e in eta_errors({"curve": [[[0, 10], [0, 5], [0.9, 0]], None, None]})))
        self.assertTrue(any("last point" in e for e in eta_errors({"curve": [[[0, 10], [0.9, 2]], None, None]})))
        self.assertTrue(any("at least 2" in e for e in eta_errors({"curve": [[[0, 0]], None, None]})))
        self.assertTrue(any("knownCurve['1']" in e for e in eta_errors({"curve": [C, C, C], "knownCurve": {"1": [[0, -1], [0.7, 0]]}})))
        self.assertTrue(any("not a level id" in e for e in eta_errors({"curve": [C, C, C], "knownCurve": {"9": [[0, 3], [0.7, 0]]}})))
        self.assertTrue(any("level id: curve" in e for e in eta_errors({"curve": [C, C, C], "knownCurve": [[0, 3], [0.7, 0]]})))

    def test_placed(self):
        ok = {"curve": [C, C, C], "knownCurve": {"1": [[0, 19.0], [0.7, 0]]}, "placed": {"curve": [C, None, None], "knownCurve": {"1": [[0, 40.0], [0.7, 0]], "2": [[0, 70.0], [0.7, 0]]}}}
        self.assertEqual(eta_errors(ok), [])
        self.assertTrue(any("placed.curve has 1" in e for e in eta_errors({"curve": [C, C, C], "placed": {"curve": [C]}})))
        self.assertTrue(any("pack.eta.placed must be" in e for e in eta_errors({"curve": [C, C, C], "placed": {"gain": [1]}})))
        self.assertTrue(any("placed.knownCurve key" in e for e in eta_errors({"curve": [C, C, C], "placed": {"knownCurve": {"7": C}}})))

    def test_unknown_key(self):
        self.assertTrue(eta_errors({"curve": [C, C, C], "slope": 1}))


if __name__ == "__main__":
    unittest.main()
