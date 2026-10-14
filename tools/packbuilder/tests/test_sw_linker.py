"""Swahili linker defect classes (2026-10-14 passage QA): the tense-bearing relative of "have"
(alizonazo), the passive -ewa of an -ea stem (imechochewa), and sense homographs whose second sense
has no pack word (sare "draw", lango "goal", hifadhi "park", mwongozo "guide"). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_sw_linker.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs.sw import Swahili  # noqa: E402
from packbuilder.tests.test_sw_rules import rich_analyser  # noqa: E402


def spec():
    an = rich_analyser()
    an.noun.update({"sare": "n/n", "lango": "ji/ma", "hifadhi": "n/n", "mwongozo": "m/mi", "mpira": "m/mi",
                    "taifa": "ji/ma", "kipa": "m/wa", "picha": "n/n", "mchezo": "m/mi", "wiki": "n/n"})
    an.verb.update({"na": "na", "zoa": "zoa", "chocha": "chocha", "chochea": "chochea", "chochewa": "chocha",
                    "elea": "elea", "elewa": "elewa", "hifadhi": "hifadhi", "piga": "piga", "onyesha": "onyesha",
                    "vaa": "vaa", "isha": "isha", "angalia": "angalia"})
    an.verb_raw["chochewa"] = ("to be provoked", "passive", "chocha")
    an.verb_raw["elewa"] = ("to understand", "passive", "ela")
    sp = Swahili.__new__(Swahili)
    sp._an = an
    return sp


class Base(unittest.TestCase):
    def setUp(self):
        self.sp = spec()

    def reading(self, text, surface):
        for s, lem, up, _ in self.sp.tag_texts([text])[0]:
            if s.lower() == surface:
                return lem, up
        raise AssertionError(f"{surface} not in {text}")


class RelativeOfHave(Base):
    """SM + tense + REL + na + REL is kuwa na, not a reciprocal -na of the tail."""

    def test_alizonazo_is_na_not_zoa(self):
        self.assertEqual(self.reading("Picha alizonazo ni nzuri.", "alizonazo"), ("na", "VERB"))

    def test_present_and_other_concords(self):
        self.assertEqual(self.reading("Mtu anayenaye kitabu.", "anayenaye"), ("na", "VERB"))
        self.assertEqual(self.reading("Kitu alichonacho.", "alichonacho"), ("na", "VERB"))
        self.assertEqual(self.reading("Pesa atakazonazo.", "atakazonazo"), ("na", "VERB"))

    def test_the_stem_zoa_keeps_its_forms(self):
        self.assertEqual(self.reading("Anazoa takataka.", "anazoa"), ("zoa", "VERB"))
        self.assertEqual(self.reading("Walizoa takataka.", "walizoa"), ("zoa", "VERB"))


class PassiveEwa(Base):
    def stem(self, s):
        return self.sp._an.verb_stem(s)

    def test_chochewa_is_the_passive_of_chochea(self):
        self.assertEqual(self.stem("chochewa"), ("chochea", False))
        self.assertEqual(self.reading("Hasira imechochewa na siasa.", "imechochewa"), ("chochea", "VERB"))
        self.assertEqual(self.reading("Ushawishi unaochochewa na siasa.", "unaochochewa"), ("chochea", "VERB"))

    def test_a_verb_of_its_own_keeps_ewa(self):
        self.assertEqual(self.stem("elewa"), ("elewa", False))

    def test_ordinary_passives_unchanged(self):
        self.assertEqual(self.stem("chochwa")[0], "chocha")
        self.assertEqual(self.stem("chocha"), ("chocha", False))


class SenseHomographs(Base):
    """The analyser reads the sense the pack has no word for as X; the taught sense links."""

    def test_sare_draw_vs_uniform(self):
        self.assertEqual(self.reading("Mchezo uliisha kwa sare.", "sare"), ("sare", "X"))
        self.assertEqual(self.reading("Mechi iliisha sare tasa.", "sare"), ("sare", "X"))
        self.assertEqual(self.reading("Wanafunzi walivaa sare ya shule.", "sare"), ("sare", "NOUN"))
        self.assertEqual(self.reading("Wanafunzi walivaa kwa sare za shule.", "sare"), ("sare", "NOUN"))
        self.assertEqual(self.reading("Wanafunzi walivaa kwa sare.", "sare"), ("sare", "NOUN"))
        self.assertEqual(self.reading("Timu walivaa sare nzuri.", "sare"), ("sare", "NOUN"))

    def test_lango_goal_vs_gate(self):
        self.assertEqual(self.reading("Mashabiki walimwangalia akipiga mpira kwenye lango.", "lango"), ("lango", "X"))
        self.assertEqual(self.reading("Kipa alilinda lango.", "lango"), ("lango", "X"))
        self.assertEqual(self.reading("Lango la shule limefungwa.", "lango"), ("lango", "NOUN"))
        self.assertEqual(self.reading("Aliondoka kwenye lango la uwanja.", "lango"), ("lango", "NOUN"))

    def test_hifadhi_park_vs_preserve(self):
        self.assertEqual(self.reading("Aliishi katika hifadhi ya taifa.", "hifadhi"), ("hifadhi", "X"))
        self.assertEqual(self.reading("Hifadhi ya taifa ni kubwa.", "hifadhi"), ("hifadhi", "X"))
        self.assertEqual(self.reading("Hifadhi picha zako.", "hifadhi")[1], "NOUN")

    def test_mwongozo_person_vs_guideline(self):
        self.assertEqual(self.reading("Mwongozo wetu alituonyesha njia.", "mwongozo"), ("mwongozo", "X"))
        self.assertEqual(self.reading("Unaweza kunipa mwongozo wako?", "mwongozo"), ("mwongozo", "NOUN"))
        self.assertEqual(self.reading("Mwongozo wetu ni mzuri.", "mwongozo"), ("mwongozo", "NOUN"))

    K = {("sare", "NOUN"): "w_sare", ("lango", "NOUN"): "w_lango", ("hifadhi", "VERB"): "w_hifadhi",
         ("mwongozo", "NOUN"): "w_mw", ("picha", "NOUN"): "w_picha"}

    def fix(self, text, en, links):
        toks = self.sp.tag_texts([text])[0]
        return self.sp.fix_links([1, text, 0, en], toks, links, self.K)

    def test_english_unlinks_the_missing_sense(self):
        self.assertEqual(self.fix("Mchezo ulikwisha sare.", "The game ended in a draw.", ["w_sare"]), [])
        self.assertEqual(self.fix("Alipiga lango.", "He hit the goal.", ["w_lango"]), [])
        self.assertEqual(self.fix("Alienda hifadhi.", "He went to the nature reserve.", ["w_hifadhi"]), [])
        self.assertEqual(self.fix("Mwongozo alikuja.", "The guide came.", ["w_mw"]), [])

    def test_english_of_the_taught_sense_keeps_the_link(self):
        self.assertEqual(self.fix("Sare ni nzuri.", "The uniform is nice.", ["w_sare"]), ["w_sare"])
        self.assertEqual(self.fix("Lango limefungwa.", "The gate is closed.", ["w_lango"]), ["w_lango"])
        self.assertEqual(self.fix("Hifadhi picha.", "Save the picture.", ["w_hifadhi", "w_picha"]),
                         ["w_hifadhi", "w_picha"])
        self.assertEqual(self.fix("Mwongozo wako.", "Your guide to baking.", ["w_mw"]), ["w_mw"])
        self.assertEqual(self.fix("Mwongozo wako.", "Your guidelines.", ["w_mw"]), ["w_mw"])


if __name__ == "__main__":
    unittest.main()
