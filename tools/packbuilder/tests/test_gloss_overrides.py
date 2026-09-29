"""gloss_overrides.json reaches every record kind through
core.words.overridden_gloss, and core.words.check_gloss_overrides turns any key
the build could not apply (dead key, FORM record, a record built around it)
into a build error instead of a silent skip. Stdlib only."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import check_gloss_overrides, overridden_gloss  # noqa: E402


def spec(**ov):
    return SimpleNamespace(gloss_overrides=ov)


class OverriddenGloss(unittest.TestCase):
    def test_phrase_key_replaces_the_phrase_gloss(self):
        applied = []
        sp = spec(**{"per favore|phrase": "please (polite)"})
        self.assertEqual(overridden_gloss(sp, ("per favore", "PHRASE"), "please", applied), "please (polite)")
        self.assertEqual(applied, ["per favore|phrase"])

    def test_word_key_uses_the_pack_pos_label(self):
        applied = []
        sp = spec(**{"stare|verb": "to stay", "me|pron": "me, myself"})
        self.assertEqual(overridden_gloss(sp, ("stare", "VERB"), "to be", applied), "to stay")
        self.assertEqual(overridden_gloss(sp, ("me", "PRON"), "me", applied), "me, myself")
        self.assertEqual(applied, ["stare|verb", "me|pron"])

    def test_no_key_keeps_the_gloss(self):
        applied = []
        self.assertEqual(overridden_gloss(spec(), ("casa", "NOUN"), "house", applied), "house")
        self.assertEqual(applied, [])


def rec(lem, g, en):
    return {"lemma": lem, "group": g, "en": en}


class CheckGlossOverrides(unittest.TestCase):
    records = {("è", "FORM"): rec("è", "FORM", "is (from essere)"),
               ("per favore", "PHRASE"): rec("per favore", "PHRASE", "please (polite)"),
               ("stare", "VERB"): rec("stare", "VERB", "to stay"),
               ("आ जाना", "VERB"): rec("आ जाना", "VERB", "to come"),
               ("casa", "NOUN"): rec("casa", "NOUN", "house")}
    words = [{"w": "è", "lemma": "è", "pos": "verb", "en": "is (from essere)", "_key": ("è", "FORM")},
             {"w": "la casa", "lemma": "casa", "pos": "noun", "en": "house", "_key": ("casa", "NOUN")}]

    def check(self, ov, applied=()):
        return check_gloss_overrides(ov, set(applied), self.records, self.words)

    def test_applied_and_hook_applied_keys_pass(self):
        ov = {"per favore|phrase": "please (polite)", "stare|verb": "to stay", "आ जाना|verb": "to come"}
        self.assertEqual(self.check(ov, ["per favore|phrase", "stare|verb"]), [])

    def test_dead_key_is_an_error(self):
        self.assertEqual(self.check({"cassa|noun": "till"}), [("cassa|noun", "matches no record")])

    def test_form_record_key_is_an_error_under_either_label(self):
        bad = self.check({"è|form": "is", "è|verb": "is"})
        self.assertEqual([k for k, _ in bad], ["è|form", "è|verb"])
        self.assertTrue(all("FORM" in why for _, why in bad))

    def test_record_built_without_the_override_is_an_error(self):
        self.assertEqual(self.check({"casa|noun": "home"}),
                         [("casa|noun", "record kind NOUN was built without applying it")])

    def test_every_bad_key_is_listed(self):
        bad = self.check({"a|noun": "x", "b|verb": "y", "stare|verb": "to stay"}, ["stare|verb"])
        self.assertEqual([k for k, _ in bad], ["a|noun", "b|verb"])


if __name__ == "__main__":
    unittest.main()
