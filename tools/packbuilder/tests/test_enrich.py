"""`packbuilder enrich` (core/enrich.py): frequency tiers from rank, the port flag block, ja unit tiers,
eta copy, --check and --emit. Synthetic repos only; the shipped sibling packs are covered by
tests/port_sites_checks.js."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TOOLS))

from packbuilder.core import enrich  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


def words(n_a1=20, n_a2=8, n_b1=10):
    out, rank = [], 0
    for lv, n in (("A1", n_a1), ("A2", n_a2), ("B1", n_b1)):
        for i in range(n):
            rank += 1
            out.append({"id": f"w{rank:04d}", "w": f"{lv.lower()}x{i}", "lv": lv, "rank": rank})
    return out


def repo(tmp, ws, pack=None, units=None, overrides=None, eta=None):
    r = Path(tmp)
    (r / "pack").mkdir()
    (r / "tools").mkdir()
    (r / "pack" / "words.json").write_text(json.dumps(ws))
    (r / "pack" / "pack.json").write_text(json.dumps(pack or {"key": "it", "levels": [{"id": "A1"}, {"id": "A2"}, {"id": "B1"}]}))
    if units is not None:
        (r / "pack" / "characters.json").write_text(json.dumps(units))
    if overrides is not None:
        (r / "tools" / "tiers_overrides.json").write_text(json.dumps(overrides))
    if eta is not None:
        (r / "tools" / "eta.json").write_text(json.dumps(eta))
    return r


class Tiers(unittest.TestCase):
    def test_ambient_peripheral_core(self):
        ws = words(30, 20, 20)
        enrich.assign_tiers(ws, ambient_rank=10)
        ft = {w["id"]: w["ft"] for w in ws}
        self.assertEqual([i for i in ft if ft[i] == 0], [f"w{i:04d}" for i in range(1, 11)])
        # A1: 30 words, 10% = 3 peripheral = the three highest ranks of the level
        self.assertEqual([i for i, w in zip(ft, ws) if w["lv"] == "A1" and ft[i] == 2], ["w0028", "w0029", "w0030"])
        self.assertEqual(sum(1 for w in ws if w["lv"] == "A2" and w["ft"] == 2), 5)    # 25% of 20
        self.assertEqual(sum(1 for w in ws if w["lv"] == "B1" and w["ft"] == 2), 8)    # 40% of 20
        self.assertTrue(all(w["ft"] in (0, 1, 2) for w in ws))

    def test_order_untouched_and_no_rank_is_core(self):
        ws = words(10, 5, 5)
        del ws[3]["rank"]
        before = [w["id"] for w in ws]
        enrich.assign_tiers(ws, ambient_rank=2)
        self.assertEqual([w["id"] for w in ws], before)
        self.assertEqual(ws[3]["ft"], 1)

    def test_override_wins_without_backfill(self):
        ws = words(30, 20, 20)
        enrich.assign_tiers(ws, {"w0030": 1, "w0001": 2}, ambient_rank=10)
        by = {w["id"]: w["ft"] for w in ws}
        self.assertEqual((by["w0030"], by["w0001"]), (1, 2))
        self.assertEqual(sum(1 for w in ws if w["lv"] == "A1" and w["ft"] == 2), 3)     # w0030 lost its tier, w0001 gained: 2 + 1

    def test_load_overrides_by_surface_or_id_and_rejects_unknown(self):
        ws = words()
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "o.json"
            p.write_text(json.dumps({"a1x3": "peripheral", "w0002": "ambient"}))
            self.assertEqual(enrich.load_overrides(p, ws), {"w0004": 2, "w0002": 0})
            p.write_text(json.dumps({"nope": "core"}))
            with self.assertRaises(SystemExit):
                enrich.load_overrides(p, ws)
            p.write_text(json.dumps({"a1x3": "rare"}))
            with self.assertRaises(SystemExit):
                enrich.load_overrides(p, ws)
            self.assertEqual(enrich.load_overrides(Path(t) / "absent.json", ws), {})


class Flags(unittest.TestCase):
    def test_generic_set(self):
        f = get_spec("it").port_flags()
        self.assertEqual(f["typedFrom"], ["written"])
        self.assertEqual([g["upTo"] for g in f["progressMap"]["goals"]], ["A1", "A2", "B1"])
        for k in ("dayAware", "pairs", "freqTiers", "glossFocus", "readRotation", "optsMix", "pauseNew"):
            self.assertIs(f[k], True)
        self.assertEqual((f["glossStyle"], f["progressView"], f["appView"], f["levelGate"], f["wordsBy"], f["listenQuestions"]),
                         ("primary", "v2", "v2", 0.7, "typed", "all"))
        self.assertNotIn("characters", f)
        self.assertNotIn("levelExam", f)

    def test_ja_typed_from_and_characters_set(self):
        ja = get_spec("ja")
        f = ja.port_flags()
        self.assertEqual(f["typedFrom"], ["written", "pron"])
        self.assertEqual(f["characters"], {"learn": "lag", "start": 60, "ramp": [3, 5, 8], "bareBy": "typed", "bareWords": True, "bareByPair": True})
        ja.port_characters = False
        self.assertNotIn("characters", ja.port_flags())
        self.assertNotIn("levelExam", ja.port_flags())
        ja.port_characters = True
        f = ja.port_flags()
        self.assertEqual(f["levelExam"], {"A1": "pinyin", "A2": "characters", "B1": "characters"})

    def test_characters_set_merges_into_existing_block(self):
        ja = get_spec("ja")
        ja.port_characters = True
        pack = {"key": "ja", "characters": {"label": "x", "bare": 6}}
        p, _, _ = enrich.enrich_data(ja, pack, words(), [])
        self.assertEqual((p["characters"]["bare"], p["characters"]["start"], p["characters"]["label"]), (6, 60, "x"))
        self.assertEqual(pack["characters"], {"label": "x", "bare": 6})                  # input untouched


class Pure(unittest.TestCase):
    def test_unit_ft_is_min_of_words_and_inputs_untouched(self):
        ws = words(10, 5, 5)
        units = [{"id": "c1", "words": ["w0001", "w0009"]}, {"id": "c2", "words": ["w0009"]}, {"id": "c3", "words": []}]
        spec = get_spec("ja")
        spec.port_characters = False
        import copy
        w0, u0 = copy.deepcopy(ws), copy.deepcopy(units)
        p, w, u = enrich.enrich_data(spec, {"key": "ja"}, ws, units)
        self.assertEqual((ws, units), (w0, u0))
        ft = {x["id"]: x["ft"] for x in w}
        self.assertEqual([x["ft"] for x in u], [min(ft["w0001"], ft["w0009"]), ft["w0009"], 1])

    def test_eta_copied_and_removed_when_absent(self):
        spec = get_spec("it")
        p, _, _ = enrich.enrich_data(spec, {"key": "it", "eta": {"gain": [1]}}, words(), None, None, {"gain": [0.01, None, 0.02], "known": None})
        self.assertEqual(p["eta"], {"gain": [0.01, None, 0.02], "known": None})
        p, _, _ = enrich.enrich_data(spec, {"key": "it", "eta": {"gain": [1]}}, words(), None, None, None)
        self.assertEqual(p["eta"], {"gain": [None, None, None], "known": None})      # flag block has goals + appView v2: no estimate, not zh's pace
        p, _, _ = enrich.enrich_data(spec, {"key": "it"}, words(), None, None, None)
        self.assertEqual(p["eta"], {"gain": [None] * len(p["progressMap"]["goals"]), "known": None})
        self.assertEqual(p["appView"], "v2")

    def test_eta_curve_copied_from_file(self):
        crv = [[0, 90.0], [0.5, 30.5], [0.9, 0]]
        eta = {"curve": [crv, None, crv], "knownCurve": {"A1": [[0, 19.3], [0.7, 0]]}, "placed": {"A2": {"bySessions": [[[0, 50.0], [50.0, 0]], None, None]}}, "extra": 1}
        with tempfile.TemporaryDirectory() as t:
            r = repo(t, words(), eta=eta)
            emit = Path(t) / "out"
            self.assertEqual(enrich.main("it", r, emit=emit), 0)
            self.assertEqual(json.loads((emit / "pack.json").read_text())["eta"], {"curve": [crv, None, crv], "knownCurve": {"A1": [[0, 19.3], [0.7, 0]]}, "placed": {"A2": {"bySessions": [[[0, 50.0], [50.0, 0]], None, None]}}})

    def test_eta_dropped_without_appview_goals(self):
        class Bare:
            def port_flags(self):
                return {"dayAware": True}
        p, _, _ = enrich.enrich_data(Bare(), {"key": "x", "eta": {"gain": [1]}}, words(), None, None, None)
        self.assertNotIn("eta", p)

    def test_validator_eta_gain_length(self):
        import validate_pack
        spec = get_spec("it")
        p, _, _ = enrich.enrich_data(spec, {"key": "it"}, words(), None)
        def errs(pk):
            rep = validate_pack.Report()
            validate_pack.check_pack(pk, rep)
            return [e for e in rep.errors if "eta" in e]
        self.assertEqual(errs(p), [])
        p["eta"] = {"gain": [0.01, 0.02], "known": 5}
        self.assertTrue(any("2 entries" in e for e in errs(p)))
        p["eta"] = {"gain": [0.01, 0.02, 0], "known": 5}
        self.assertTrue(errs(p))

    def test_idempotent(self):
        spec = get_spec("it")
        p1, w1, _ = enrich.enrich_data(spec, {"key": "it"}, words(), None)
        p2, w2, _ = enrich.enrich_data(spec, p1, w1, None)
        self.assertEqual((p1, w1), (p2, w2))


class Cli(unittest.TestCase):
    def test_check_write_check_and_emit(self):
        with tempfile.TemporaryDirectory() as t:
            r = repo(t, words(), overrides={"a1x2": "peripheral"}, eta={"gain": [0.01, 0.02, 0.03], "known": 5.0})
            self.assertEqual(enrich.main("it", r, check=True), 1)                         # fresh build: not enriched
            emit = Path(t) / "out"
            before = (r / "pack" / "words.json").read_text()
            self.assertEqual(enrich.main("it", r, emit=emit), 0)
            self.assertEqual((r / "pack" / "words.json").read_text(), before)             # --emit leaves the repo alone
            self.assertTrue((emit / "words.js").read_text().startswith("// generated by"))
            self.assertEqual(json.loads((emit / "pack.json").read_text())["eta"]["known"], 5.0)
            for bad in (r / "pack", r / "pack" / "sub", Path(r) / "pack" / ".." / "pack"):
                with self.assertRaises(SystemExit):
                    enrich.main("it", r, emit=bad)                                         # would rmtree the source
            self.assertTrue((r / "pack" / "words.json").exists())
            self.assertEqual(enrich.main("it", r), 0)
            self.assertEqual(enrich.main("it", r, check=True), 0)
            self.assertEqual({w["id"]: w["ft"] for w in json.loads((r / "pack" / "words.json").read_text())}["w0003"], 2)
            (r / "tools" / "eta.json").write_text(json.dumps({"gain": [0.5], "known": 1.0}))
            self.assertEqual(enrich.main("it", r, check=True), 1)                         # eta changed: stale
            ws = json.loads((r / "pack" / "words.json").read_text())
            ws[0]["rank"] = 5000
            (r / "pack" / "words.json").write_text(json.dumps(ws))
            self.assertEqual(enrich.main("it", r, check=True), 1)                         # rank changed: stale


if __name__ == "__main__":
    unittest.main()
