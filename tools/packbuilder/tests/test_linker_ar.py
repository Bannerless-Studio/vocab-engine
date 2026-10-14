"""Arabic linker classes (langs/ar.py): unvocalized homographs that pick the wrong lemma.
Each class has the representative sentence's rule and a counter-example that keeps the other sense.
The dictionary and the corpus verb counts are stubbed, so no CAMeL data is needed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_linker_ar.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402


def row(pos, gloss="", lemma=True):
    return [pos, "", [], "", "", lemma, gloss, ""]


def spec(info, verbs=None):
    sp = get_spec("ar", None, load=False)
    sp._info = lambda: info
    sp._verb_counts = lambda: verbs or {}
    sp._lfold_index = lambda: {}
    return sp


class HamzaSeat(unittest.TestCase):
    """للأذن "for the ear": CAMeL's spelling-variant analysis reads إذن "permission"."""

    def test_written_seat_decides(self):
        sp = spec({"أذن": [row("noun", "ear")], "إذن": [row("noun", "permission")]})
        m = {"Src": "spvar", "Prc0": "Al_det", "Prc1": "li_prep"}
        self.assertEqual(sp._exact_stem("للأذن", "إذن", "NOUN", m), ("أذن", "NOUN"))

    def test_plural_spelling_and_non_spvar_stay_camel(self):
        info = {"أخوة": [row("noun", "brotherhood"), row("noun", "plural of أخ", lemma=False)],
                "إخوة": [row("noun", "brothers")]}
        sp = spec(info)
        self.assertIsNone(sp._exact_stem("الأخوة", "إخوة", "NOUN", {"Src": "spvar", "Prc0": "Al_det"}))
        self.assertIsNone(sp._exact_stem("للأذن", "إذن", "NOUN", {"Prc0": "Al_det"}))


class ElativePlural(unittest.TestCase):
    """الأقارب "the relatives" read as the elative أقرب "nearer"."""

    def test_plural_is_its_own_headword(self):
        sp = spec({"أقرب": [row("adj", "nearer")], "أقارب": [row("noun", "relatives")]})
        got = sp._exact_stem("الأقارب", "أقرب", "ADJ", {"Number": "Plur", "Prc0": "Al_det"})
        self.assertEqual(got, ("أقارب", "NOUN"))

    def test_singular_elative_stays(self):
        sp = spec({"أقرب": [row("adj", "nearer")], "أقارب": [row("noun", "relatives")]})
        self.assertIsNone(sp._exact_stem("الأقرب", "أقرب", "ADJ", {"Number": "Sing", "Prc0": "Al_det"}))


class HollowJussive(unittest.TestCase):
    """تخف "(do not) fear": the jussive of خاف, read as the form IV verb أخفى."""

    info = {"خاف": [row("verb", "to fear")], "أخفى": [row("verb", "to hide")]}
    m = {"Aspect": "Imp"}

    def test_commoner_hollow_verb_wins(self):
        sp = spec(self.info, {"خاف": 90, "أخفى": 65})
        self.assertEqual(sp._hollow_jussive("تخف", "أخفى", "VERB", self.m), ("خاف", "VERB"))

    def test_rarer_hollow_verb_keeps_camel(self):
        sp = spec(self.info, {"خاف": 2, "أخفى": 65})
        self.assertIsNone(sp._hollow_jussive("تخف", "أخفى", "VERB", self.m))

    def test_full_imperfect_untouched(self):
        sp = spec(self.info, {"خاف": 90, "أخفى": 65})
        self.assertIsNone(sp._hollow_jussive("يخفي", "أخفى", "VERB", self.m))


class AdverbVersusNoun(unittest.TestCase):
    """يوما "a day" before an agreeing adjective or after كم is the noun; a bare يوما is the adverb."""

    info = {"يوم": [row("noun", "day")], "كامل": [row("adj", "whole")]}

    def tok(self, s, lem, upos, extra=""):
        return [s, lem, upos, "Raw=noun" + extra]

    def test_modified_is_noun(self):
        sp = spec(self.info)
        toks = [["أمضت", "أمضى", "VERB", ""], self.tok("يوما", "يوما", "ADV"), ["كاملا", "كامل", "ADJ", ""]]
        sp._modified_noun(toks, 1, toks[1])
        self.assertEqual((toks[1][1], toks[1][2]), ("يوم", "NOUN"))

    def test_bare_adverb_stays(self):
        sp = spec(self.info)
        toks = [["قال", "قال", "VERB", ""], self.tok("يوما", "يوما", "ADV"), ["ما", "ما", "PRON", ""]]
        sp._modified_noun(toks, 1, toks[1])
        self.assertEqual((toks[1][1], toks[1][2]), ("يوما", "ADV"))


class CrossPosLink(unittest.TestCase):
    """A link between a verb and a noun/adjective needs a verbal noun and its verb, or English support:
    وعم الصمت read the verb عمّ, the pack has only the noun عم "uncle"."""

    def word(self, lemma, pos, en):
        return {"lemma": lemma, "pos": pos, "en": en}

    def test_unrelated_lexeme_is_unlinked(self):
        sp = spec({"عم": [row("noun", "paternal uncle")]})
        w = self.word("عم", "noun", "uncle")
        self.assertTrue(sp._cross_pos_unsupported("VERB", w, "Silence prevailed in the forest."))
        self.assertTrue(sp._cross_pos_unsupported("ADJ", self.word("أحسن", "verb", "to do well"),
                                                  "This is the best hour in the forest."))

    def test_verbal_noun_and_english_support_keep_the_link(self):
        sp = spec({"سكن": [row("noun", "verbal noun of سكن: living")], "ذهب": [row("noun", "gold")]})
        self.assertFalse(sp._cross_pos_unsupported("VERB", self.word("سكن", "noun", "living"), "He likes living here."))
        self.assertFalse(sp._cross_pos_unsupported("NOUN", self.word("ذهب", "verb", "to go"), "She went home."))

    def test_same_class_and_no_english_untouched(self):
        sp = spec({})
        self.assertFalse(sp._cross_pos_unsupported("VERB", self.word("ذهب", "verb", "to go"), "Nothing here."))
        self.assertFalse(sp._cross_pos_unsupported("NOUN", self.word("عم", "noun", "uncle"), ""))
        self.assertTrue(sp.passage_fallback_ok(None, ("عم", "NOUN"), self.word("عم", "noun", "uncle"), "My uncle."))
        self.assertFalse(sp.passage_fallback_ok(None, ("عم", "VERB"), self.word("عم", "noun", "uncle"), "It spread."))


if __name__ == "__main__":
    unittest.main()
