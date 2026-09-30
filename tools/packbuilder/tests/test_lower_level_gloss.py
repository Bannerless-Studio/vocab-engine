"""spec.lower_level_gloss_re for ar, es, fa, hi, ru, ur (langs/base.py
make_lower_level_gloss_re): a below-top-level gloss segment that matches is
dropped, a word with no clean segment moves to the top level
(core/words.py). Whole words only; neutral stems and senses stay clean.
Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_lower_level_gloss.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402

CODES = ("ar", "es")
SHARED_HITS = ["to kill", "murder", "killer, murderer", "to shoot, to fire", "bomb, grenade", "explosion, blast",
               "poison", "blood", "sex", "sexual", "sexy", "naked, nude", "corpse", "dead body", "weapon, arm",
               "gun, rifle", "pistol, handgun", "firearm", "suicide", "to rape", "pornography", "prostitute",
               "to stab", "to strangle", "gender; sex organ"]
NEUTRAL = ["stable", "stability", "to execute a plan", "class", "gender, sex", "sex, gender", "paternal blood uncle",
           "blood relative", "to explode, to burst", "to die", "dead", "death", "to beat, to hit", "medicine, drug",
           "gunpowder", "bloom", "stab" + "ilize", "Sussex", "arms and legs", "gender", "shot"]
DRUGS = ["cocaine", "heroin", "opium", "marijuana", "narcotic", "hashish", "cannabis"]
ALCOHOL = ["alcohol", "wine", "beer", "liquor", "whisky", "drunk", "alcoholic"]


def rx(code):
    return get_spec(code, None, load=False).lower_level_gloss_re


def clean(code, gloss):
    """The below-top-level gloss core/words.py keeps (None: the word moves)."""
    segs = [s for s in re.split(r"\s*;\s*", gloss) if not rx(code).search(s)]
    return "; ".join(segs) or None


class LowerLevelGloss(unittest.TestCase):
    def test_every_spec_has_the_shared_list(self):
        for code in CODES:
            for g in SHARED_HITS:
                with self.subTest(code=code, gloss=g):
                    self.assertTrue(rx(code).search(g))

    def test_neutral_stems_and_senses_stay_clean(self):
        for code in CODES:
            for g in NEUTRAL:
                with self.subTest(code=code, gloss=g):
                    self.assertIsNone(rx(code).search(g))

    def test_drugs_where_the_content_policy_names_them(self):
        for code in CODES:
            for g in DRUGS:
                with self.subTest(code=code, gloss=g):
                    self.assertEqual(bool(rx(code).search(g)), code in ("ar", "fa", "hi", "ur"))

    def test_alcohol_only_in_urdu(self):
        for code in CODES:
            for g in ALCOHOL:
                with self.subTest(code=code, gloss=g):
                    self.assertEqual(bool(rx(code).search(g)), code == "ur")

    def test_mixed_gloss_keeps_its_clean_senses(self):
        self.assertEqual(clean("ur", "to hit, to beat; to kill"), "to hit, to beat")
        self.assertEqual(clean("es", "to violate; to rape"), "to violate")
        self.assertEqual(clean("hi", "gender; sex organ"), "gender")
        self.assertEqual(clean("ru", "sexy; sexual"), None)
        self.assertEqual(clean("hi", "blood; murder"), None)

    def test_gender_sex_segment_is_kept_so_the_word_ceiling_decides(self):
        # ar جنس: dropping "gender, sex" would ship the word at A2 as "kind, type"
        self.assertEqual(clean("ar", "gender, sex; kind, type"), "gender, sex; kind, type")


    def test_word_ceiling_skips_kinship_and_medical_blood(self):
        # the shared ceiling (every spec) shares BLOOD: ar عم stays a core word
        for code in CODES + ("fr", "sw"):
            ceil = get_spec(code, None, load=False).word_ceiling_re
            with self.subTest(code=code):
                self.assertTrue(ceil.search("blood"))
                self.assertTrue(ceil.search("bloody"))
                self.assertIsNone(ceil.search("paternal blood uncle"))
                self.assertIsNone(ceil.search("tension; blood pressure"))


if __name__ == "__main__":
    unittest.main()
