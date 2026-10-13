"""Noun gender `g` by word id (core/gender.py, applied by core/enrich.py): added to nouns only, in builder key
order before `ft`, no id change, idempotent, a disagreeing `g` is an error, only for specs that emit g.
Synthetic repos; the live packs are covered by the per-site run in the round report."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TOOLS))

from packbuilder.core import enrich, gender  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


def words():
    return [
        {"id": "w0007", "w": "il libro", "lemma": "libro", "pos": "noun", "en": "book", "lv": "A1", "rank": 1, "alt": ["libro"]},
        {"id": "w0009", "w": "l'amica", "lemma": "amica", "pos": "noun", "en": "friend (f)", "lv": "A1", "rank": 2, "alt": ["amica"]},
        {"id": "w0011", "w": "mangiare", "lemma": "mangiare", "pos": "verb", "en": "to eat", "lv": "A1", "rank": 3},
        {"id": "w0012", "w": "la forbice", "lemma": "forbice", "pos": "noun", "en": "scissors", "lv": "A1", "rank": 4, "alt": ["forbice"]},
    ]


GMAP = {"w0007": "m", "w0009": "f"}      # "w0012": the lexicon gave no gender (corpus or default only), so it has none


class Apply(unittest.TestCase):
    def test_adds_g_to_nouns_in_the_file_only(self):
        out, info = gender.apply_gender(words(), GMAP)
        self.assertEqual([w.get("g") for w in out], ["m", "f", None, None])
        self.assertEqual((info["added"], info["conflicts"], info["unused"]), (2, [], 0))
        self.assertEqual([w["id"] for w in out], ["w0007", "w0009", "w0011", "w0012"])
        self.assertNotIn("g", words()[0])                                      # input untouched

    def test_key_order_matches_the_builder(self):
        ws = [dict(w, ft=1) for w in words()]
        out, _ = gender.apply_gender(ws, GMAP)
        self.assertEqual(list(out[0]), ["id", "w", "lemma", "pos", "en", "lv", "rank", "alt", "g", "ft"])

    def test_conflicts_and_unused(self):
        ws = words()
        ws[0]["g"] = "f"
        _, info = gender.apply_gender(ws, {**GMAP, "w0099": "m"})
        self.assertEqual(info["conflicts"], [("w0007", "libro", "f", "m")])
        self.assertEqual(info["unused"], 1)
        _, info = gender.apply_gender(words(), {"w0011": "m"})                       # a verb never takes g
        self.assertEqual(len(info["conflicts"]), 1)

    def test_sidecar_round_trip(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / gender.SIDECAR).write_text(gender.dump_map({"w0012": "p", "w0007": "m", "w0100": "f"}))
            self.assertEqual(gender.load_map(t), {"w0007": "m", "w0012": "p", "w0100": "f"})
            self.assertIsNone(gender.load_map(Path(t) / "none"))


class Enrich(unittest.TestCase):
    def test_enrich_data_applies_for_gapgender_specs_only(self):
        it = get_spec("it")
        self.assertTrue(it.port_flags().get("gapGender"))
        _, w, _ = enrich.enrich_data(it, {"key": "it"}, words(), None, None, None, GMAP)
        self.assertEqual([x.get("g") for x in w], ["m", "f", None, None])
        self.assertTrue(all("ft" in x for x in w))
        ja = get_spec("ja")
        self.assertFalse(ja.port_flags().get("gapGender"))
        _, w, _ = enrich.enrich_data(ja, {"key": "ja"}, words(), None, None, None, GMAP)
        self.assertFalse(any("g" in x for x in w))

    def test_idempotent_and_ids_unchanged(self):
        it = get_spec("it")
        p1, w1, _ = enrich.enrich_data(it, {"key": "it"}, words(), None, None, None, GMAP)
        p2, w2, _ = enrich.enrich_data(it, p1, w1, None, None, None, GMAP)
        self.assertEqual((p1, w1), (p2, w2))
        self.assertEqual([x["id"] for x in w1], ["w0007", "w0009", "w0011", "w0012"])

    def test_disagreement_stops_enrich(self):
        ws = words()
        ws[0]["g"] = "f"
        with self.assertRaises(SystemExit):
            enrich.enrich_data(get_spec("it"), {"key": "it"}, ws, None, None, None, GMAP)

    def test_cli_check_write_check(self):
        with tempfile.TemporaryDirectory() as t:
            r = Path(t)
            (r / "pack").mkdir()
            (r / "tools").mkdir()
            (r / "pack" / "words.json").write_text(json.dumps(words()))
            (r / "pack" / "pack.json").write_text(json.dumps({"key": "it", "levels": [{"id": "A1"}]}))
            (r / "tools" / gender.SIDECAR).write_text(gender.dump_map(GMAP))
            self.assertEqual(enrich.main("it", r, check=True), 1)
            self.assertEqual(enrich.main("it", r), 0)
            self.assertEqual(enrich.main("it", r, check=True), 0)
            got = {w["id"]: w.get("g") for w in json.loads((r / "pack" / "words.json").read_text())}
            self.assertEqual(got, {"w0007": "m", "w0009": "f", "w0011": None, "w0012": None})


if __name__ == "__main__":
    unittest.main()
