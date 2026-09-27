"""Hindi alt / forms split (langs/hi.py finalize_words + alt_kind through
core.words.split_alt_forms). Alts, the typed answers, are the headword's other
spellings (nukta, chandrabindu, anusvara: बाजार for बाज़ार), a spacing of
कौन-सा and a compound postposition's bare tail (के लिए: लिए, alt[0]). Oblique
and plural nouns, inflected adjectives, verb forms, declined pronouns and
की/के for का are forms: located in text, never typed. Wiktionary info and the
corpus are stubbed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_hi_forms.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # vocab-engine/tools

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs import hi  # noqa: E402

INFO = {"बाजार": [["बाज़ार", "noun", "bāzār", True, "market", "m", ["बाजारों"]]],
        "अच्छा": [["अच्छा", "adj", "acchā", True, "good", None, []]]}
CORPUS = "बाज़ार बाजार बाज़ारों बाजारों अच्छी अच्छे लिए लिये कौनसा कौन सा कौन सी"


def build(words):
    sp = get_spec("hi", None, load=False)
    sp._info = lambda: INFO
    sp._verbs = lambda: (set(), {})
    ctx = {"rows_by_sid": {1: (1, CORPUS)}}
    with mock.patch.dict(hi.POSTP, {"के लिए": "for"}):
        sp.finalize_words(None, ctx, words)
    split_alt_forms(sp, words)
    return {w["w"]: w for w in words}


def word(i, lemma, pos):
    return {"id": f"w{i:04d}", "lemma": lemma, "pos": pos, "en": "x"}


class HiAltKind(unittest.TestCase):
    def setUp(self):
        self.out = build([word(1, "बाजार", "noun"), word(2, "अच्छा", "adj"), word(3, "के लिए", "prep"),
                          word(4, "का", "prep"), word(5, hi.KAUNSA, "det")])

    def test_nukta_spelling_is_alt_and_the_oblique_plurals_are_forms(self):
        w = self.out["बाज़ार"]
        self.assertEqual(w["alt"], ["बाजार"])
        self.assertCountEqual(w["forms"], ["बाजारों", "बाज़ारों"])
        self.assertNotIn("_spell", w)

    def test_inflected_adjective_and_genitive_agreement_are_forms(self):
        self.assertCountEqual(self.out["अच्छा"]["forms"], ["अच्छी", "अच्छे"])
        self.assertNotIn("alt", self.out["अच्छा"])
        self.assertEqual(self.out["का"]["forms"], ["की", "के"])
        self.assertNotIn("alt", self.out["का"])

    def test_postposition_tail_and_its_spellings_stay_alt(self):
        w = self.out["के लिए"]
        self.assertEqual(w["alt"], ["लिए", "लिये"])
        self.assertNotIn("forms", w)

    def test_kaunsa_spacings_are_alt_and_its_gender_forms_are_forms(self):
        w = self.out["कौन-सा"]
        self.assertEqual(w["alt"], ["कौनसा", "कौन सा"])
        self.assertEqual(w["forms"], ["कौन-सी", "कौन-से", "कौनसी", "कौनसे", "कौन सी", "कौन से"])


if __name__ == "__main__":
    unittest.main()
