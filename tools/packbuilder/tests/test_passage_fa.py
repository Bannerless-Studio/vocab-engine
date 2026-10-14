"""Tests for the Persian passage-only rules (langs/fa.py): passage_retag
(نه nine/not, در + آن/این + را as the noun, infinitive + clitic as a verb),
passage_post_resolve (a whole pack noun X+ی kept only when the English names
it, marked by fix_sentence on passage rows; a noun+noun compound links its
head). The dictionary, verbs and pack are stubbed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_passage_fa.py     (from vocab-engine/)
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402

TMP = tempfile.mkdtemp()
PACK = {"ماه": {"noun"}, "ماهی": {"noun"}, "گوش": {"noun"}, "گوشی": {"noun"}, "دوست": {"noun"},
        "دوستی": {"noun"}, "ثبت": {"noun"}, "نام": {"noun"}, "در": {"prep", "noun"}, "کردن": {"verb"},
        "هفته": {"noun"}, "سال": {"noun"}, "نفر": {"noun"}, "بیمار": {"noun"}, "بیماری": {"noun"},
        "تاریک": {"noun"}, "تاریکی": {"noun"}, "پیش": {"prep"}, "پیشی": {"noun"}, "کی": {"pron"}}
GLOSS = {"ماهی": "fish", "گوشی": "mobile phone, smartphone", "دوستی": "friendship", "ماه": "month; moon",
         "گوش": "ear", "دوست": "friend", "بیماری": "illness, disease", "بیمار": "patient, sick person",
         "تاریکی": "darkness", "تاریک": "dark"}


def fa_spec():
    sp = get_spec("fa", TMP)
    sp._info_cache = {}
    sp._verb_cache = ({"کردن", "خوردن"}, {})
    sp._p_pack = PACK
    sp._p_gloss = GLOSS
    return sp


def T(text, upos, lemma=None, morph=""):
    return [text, lemma or text, upos, morph]


def row(en):
    return ["passage", "", None, en, None, None]


class Nine(unittest.TestCase):
    def upos(self, toks):
        return [t[2] for t in fa_spec().passage_retag([list(t) for t in toks])]

    def test_not_before_a_unit_with_ezafe_ye(self):
        toks = [T("،", "PUNCT"), T("نه", "NUM"), T("هفتهای", "NOUN", "هفته"), T("یک", "NUM"), T("بار", "NOUN")]
        self.assertEqual(self.upos(toks)[1], "ADV")

    def test_nine_before_a_bare_unit(self):
        for unit in ("سال", "نفر"):
            toks = [T("او", "PRON"), T("نه", "NUM"), T(unit, "NOUN"), T("دارد", "VERB", "داشتن")]
            self.assertEqual(self.upos(toks)[1], "NUM", unit)

    def test_nine_as_a_time_or_range(self):
        self.assertEqual(self.upos([T("ساعت", "NOUN"), T("نه", "NUM")])[1], "NUM")
        toks = [T("از", "ADP"), T("نه", "NUM"), T("تا", "ADP"), T("پنج", "NUM")]
        self.assertEqual(self.upos(toks)[1], "NUM")


class DoorBeforeObject(unittest.TestCase):
    def test_dar_an_ra_is_the_noun(self):
        toks = [T("و", "CCONJ"), T("در", "ADP"), T("آن", "PRON"), T("را", "ADP"), T("ببندید", "VERB", "بستن")]
        out = fa_spec().passage_retag(toks)
        self.assertEqual(out[1][1:3], ["در", "NOUN"])

    def test_dar_as_preposition_stays(self):
        toks = [T("در", "ADP"), T("آن", "PRON"), T("خانه", "NOUN")]
        self.assertEqual(fa_spec().passage_retag(toks)[0][2], "ADP")


class InfinitiveClitic(unittest.TestCase):
    def test_kardanash_is_a_verb(self):
        toks = [T("درست", "ADJ"), T("کردنش", "NOUN", "کردن")]
        self.assertEqual(fa_spec().passage_retag(toks)[1][2], "VERB")

    def test_bare_infinitive_noun_untouched(self):
        toks = [T("کردن", "NOUN", "کردن")]
        self.assertEqual(fa_spec().passage_retag(toks)[0][2], "NOUN")


class WholePackNoun(unittest.TestCase):
    def resolve(self, words, stems, en):
        sp = fa_spec()
        toks = sp.fix_sentence([T(w, "NUM" if w == "یک" else "NOUN") for w in words], row(en), None)
        out = [(s, "NOUN") if s else None for s in stems]
        return sp.passage_post_resolve(toks, out)

    def test_fish_kept_when_the_english_says_fish(self):
        self.assertEqual(self.resolve(["یک", "ماهی"], [None, "ماه"], "Buy a large fish.")[1], ("ماهی", "NOUN"))

    def test_phone_kept_when_the_english_says_phone(self):
        self.assertEqual(self.resolve(["یک", "گوشی"], [None, "گوش"], "How much is a new phone?")[1],
                         ("گوشی", "NOUN"))

    def test_indefinite_friend_is_the_stem(self):
        self.assertEqual(self.resolve(["یک", "دوستی"], [None, "دوست"], "I have a friend there.")[1],
                         ("دوست", "NOUN"))

    def test_mahi_once_a_month_is_the_stem(self):
        self.assertEqual(self.resolve(["ماهی", "یک"], ["ماه", None], "Once a month.")[0], ("ماه", "NOUN"))

    def test_corpus_rows_are_never_marked(self):
        sp = fa_spec()
        toks = sp.fix_sentence([T("ماهی", "NOUN")], ["s1", "", None, "a fish", None, None], None)
        self.assertNotIn("EnGloss", toks[0][3])


class CompoundHead(unittest.TestCase):
    def test_noun_noun_compound_links_its_head(self):
        sp = fa_spec()
        out = sp.passage_post_resolve([T("ثبتنام", "NOUN")], [None])
        self.assertEqual(out[0], ("ثبت", "NOUN"))

    def test_a_pack_word_is_never_split(self):
        sp = fa_spec()
        out = sp.passage_post_resolve([T("دوستی", "NOUN")], [("دوستی", "NOUN")])
        self.assertEqual(out[0], ("دوستی", "NOUN"))


class DeclaredName(unittest.TestCase):
    """A declared passage name wins over any dictionary reading of its spelling
    (Persian has no capitals): کیان is not کی + ان, نوری not نور + ی."""

    def retag(self, toks, names):
        return fa_spec().passage_retag([list(t) for t in toks], frozenset(names))

    def test_a_noun_tagged_name_is_propn(self):
        out = self.retag([T("کیان", "NOUN"), T("آمد", "VERB", "آمدن")], {"کیان"})
        self.assertEqual(out[0][1:3], ["کیان", "PROPN"])

    def test_a_verb_tagged_name_is_propn(self):
        self.assertEqual(self.retag([T("کیان", "VERB", "کیدن")], {"کیان"})[0][1:3], ["کیان", "PROPN"])

    def test_name_with_ezafe_or_clitic_is_the_name(self):
        for surface in ("کیانی", "کیانش", "کیانها"):
            self.assertEqual(self.retag([T(surface, "NOUN")], {"کیان"})[0][1:3], ["کیان", "PROPN"], surface)

    def test_without_the_declaration_the_noun_stays(self):
        self.assertEqual(self.retag([T("کیان", "NOUN")], set())[0][2], "NOUN")
        self.assertEqual(self.retag([T("کیان", "NOUN")], {"سارا"})[0][2], "NOUN")

    def test_a_pack_word_with_a_name_prefix_stays(self):
        # the name پیش + ی would swallow the pack noun پیشی
        self.assertEqual(self.retag([T("پیشی", "NOUN")], {"پیش"})[0][2], "NOUN")

    def test_the_exact_name_beats_a_pack_word(self):
        self.assertEqual(self.retag([T("پیشی", "NOUN")], {"پیشی"})[0][1:3], ["پیشی", "PROPN"])


class BareIndefiniteStem(unittest.TestCase):
    """A pack noun X+ی the tagger kept whole is the stem when the English names
    only the stem (بیماری "a patient"), with or without یک."""

    def resolve(self, words, en):
        sp = fa_spec()
        toks = sp.fix_sentence([T(w, "NUM" if w == "یک" else "NOUN") for w in words], row(en), None)
        out = [None if w == "یک" else (w, "NOUN") for w in words]
        return toks, sp.passage_post_resolve(toks, out)

    def test_a_patient_is_the_stem(self):
        for words in (["بیماری"], ["یک", "بیماری"]):
            toks, out = self.resolve(words, "A patient went to the doctor.")
            self.assertEqual(out[-1], ("بیمار", "NOUN"), words)

    def test_illness_stays_the_whole_word(self):
        toks, out = self.resolve(["بیماری"], "His illness got better.")
        self.assertEqual(out[0], ("بیماری", "NOUN"))
        self.assertIn("EnGloss=Yes", toks[0][3])

    def test_a_stem_gloss_that_abbreviates_the_whole_says_nothing(self):
        toks, out = self.resolve(["تاریکی"], "People stayed in the dark.")
        self.assertEqual(out[0], ("تاریکی", "NOUN"))
        self.assertNotIn("EnStem", toks[0][3])

    def test_english_naming_neither_keeps_the_resolver_reading(self):
        toks, out = self.resolve(["بیماری"], "It was a quiet evening.")
        self.assertEqual(out[0], ("بیماری", "NOUN"))

    def test_corpus_rows_are_never_marked(self):
        sp = fa_spec()
        toks = sp.fix_sentence([T("بیماری", "NOUN")], ["s1", "", None, "a patient", None, None], None)
        self.assertNotIn("EnStem", toks[0][3])


if __name__ == "__main__":
    unittest.main()
