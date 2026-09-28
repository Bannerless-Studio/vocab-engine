"""German alt / forms split (langs/de.py alt_kind through
core.words.split_alt_forms): the declensions of an article (die/das/den/dem/des
of der, eine/einen/... of ein) are `forms` (core.js packArticles reads forms of
article words); a noun's bare form and the ae/oe/ue/ss spellings stay `alt`.
Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_forms_de.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class GermanForms(unittest.TestCase):
    def test_article_declensions_are_forms_other_alts_stay(self):
        sp = get_spec("de", None, load=False)
        words = [
            {"w": "der", "pos": "art", "alt": ["die", "das", "den", "dem", "des"]},
            {"w": "ein", "pos": "art", "alt": ["eine", "einen", "einem", "einer", "eines"]},
            {"w": "der Hund", "pos": "noun", "alt": ["Hund"]},
            {"w": "müde", "pos": "adj", "alt": ["muede"]},
        ]
        split_alt_forms(sp, words)
        self.assertEqual((words[0].get("alt"), words[0]["forms"]), (None, ["die", "das", "den", "dem", "des"]))
        self.assertEqual((words[1].get("alt"), words[1]["forms"]), (None, ["eine", "einen", "einem", "einer", "eines"]))
        self.assertEqual((words[2]["alt"], words[2].get("forms")), (["Hund"], None))
        self.assertEqual((words[3]["alt"], words[3].get("forms")), (["muede"], None))


if __name__ == "__main__":
    unittest.main()
