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
        self.assertTrue(any("3 goals" in e for e in eta_errors({"curve": [C, C], "known": 5})))

    def test_monotone_and_positions(self):
        self.assertTrue(any("non-increasing" in e for e in eta_errors({"curve": [[[0, 10], [0.5, 12], [0.9, 0]], None, None], "known": 5})))
        self.assertTrue(any("strictly increasing" in e for e in eta_errors({"curve": [[[0, 10], [0, 5], [0.9, 0]], None, None], "known": 5})))
        self.assertTrue(any("last point" in e for e in eta_errors({"curve": [[[0, 10], [0.9, 2]], None, None], "known": 5})))
        self.assertTrue(any("at least 2" in e for e in eta_errors({"curve": [[[0, 0]], None, None], "known": 5})))
        self.assertTrue(any("knownCurve['1']" in e for e in eta_errors({"curve": [C, C, C], "knownCurve": {"1": [[0, -1], [0.7, 0]]}})))
        self.assertTrue(any("not a level id" in e for e in eta_errors({"curve": [C, C, C], "knownCurve": {"9": [[0, 3], [0.7, 0]]}})))
        self.assertTrue(any("level id: curve" in e for e in eta_errors({"curve": [C, C, C], "knownCurve": [[0, 3], [0.7, 0]]})))

    def test_placed(self):
        S = [[0, 155.3], [155.3, 0]]
        ok = {"curve": [C, C, C], "knownCurve": {"1": [[0, 19.0], [0.7, 0]]},
              "placed": {"2": {"bySessions": [None, None, None], "knownCurve": {"1": [[0, 38.0], [0.7, 0]]}},
                         "3": {"bySessions": [S, None, None], "knownCurve": {"2": [[0, 70.0], [0.7, 0]]}}}}
        self.assertEqual(eta_errors(ok), [])
        self.assertTrue(any("bySessions has 1" in e for e in eta_errors({"curve": [C, C, C], "known": 5, "placed": {"3": {"bySessions": [S]}}})))
        self.assertTrue(any("placed['3'] must be" in e for e in eta_errors({"curve": [C, C, C], "known": 5, "placed": {"3": {"gain": [1]}}})))
        self.assertTrue(any("placed key '7'" in e for e in eta_errors({"curve": [C, C, C], "known": 5, "placed": {"7": {"bySessions": [S, None, None]}}})))
        self.assertTrue(any("placed['3'].knownCurve key" in e for e in eta_errors({"curve": [C, C, C], "known": 5, "placed": {"3": {"knownCurve": {"7": C}}}})))
        self.assertTrue(any("placed needs pack.eta.curve" in e for e in eta_errors({"gain": [1, 1, 1], "known": 5, "placed": {"3": {"bySessions": [S, None, None]}}})))

    def test_shape_mixing(self):                         # M3: one shape; a curve needs a gate estimate source
        self.assertTrue(any("curve and gain" in e for e in eta_errors({"curve": [C, C, C], "gain": [1, 1, 1], "known": 5})))
        self.assertTrue(any("needs knownCurve" in e for e in eta_errors({"curve": [C, C, C]})))
        self.assertEqual(eta_errors({"curve": [C, C, C], "known": 5.2}), [])

    def test_last_x(self):                               # L6: goal curve ends at >= 0.9; knownCurve at >= levelGate
        self.assertTrue(any("x >= 0.9" in e for e in eta_errors({"curve": [[[0, 10], [0.8, 0]], None, None], "known": 5})))
        rep = validate_pack.Report()
        validate_pack.check_pack({"key": "x", "levelGate": 0.7, "levels": [{"id": "1"}], "progressMap": GOALS,
                                  "eta": {"curve": [C, C, C], "knownCurve": {"1": [[0, 9], [0.6, 0]]}}}, rep)
        self.assertTrue(any("x >= 0.7" in e for e in rep.errors))

    def test_unknown_key(self):
        self.assertTrue(eta_errors({"curve": [C, C, C], "slope": 1}))


if __name__ == "__main__":
    unittest.main()
