"""Spanish alt / forms split (langs/es.py mark_alt_forms, alt_kind through
core.words.split_alt_forms). A gender pair (perra for el perro) and the base of
a pronominal verb (sentir for sentirse) go to `forms`; the article paradigm
(la/los/las of el) and a noun's bare form alt[0] (perro for el perro) stay
`alt`, because core.js packArticles and bareForm read them there. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_forms_es.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs.es import _trailing_token  # noqa: E402


class Lex:
    def __init__(self, E):
        self.E = E


def fem_entry(gloss, p="noun"):
    return {"p": p, "s": [[gloss, "", "", "form"]]}


def build(words, lex_e):
    sp = get_spec("es", None, load=False)
    sp.finalize_words(None, {"lexicon": Lex(lex_e)}, words)
    split_alt_forms(sp, words)
    return words


class SpanishForms(unittest.TestCase):
    def test_gender_and_reflexive_pairs_are_forms(self):
        words = build([
            {"w": "el perro", "lemma": "perro", "pos": "noun", "_key": ("perro", "NOUN"), "alt": ["perro", "perra"]},
            {"w": "sentirse", "lemma": "sentirse", "pos": "verb", "_key": ("sentirse", "VERB"),
             "_base": ("sentir", "to feel"), "alt": ["sentir"]},
        ], {"perra": [fem_entry("female equivalent of perro")]})
        self.assertEqual(words[0]["alt"], ["perro"])
        self.assertEqual(words[0]["forms"], ["perra"])
        self.assertNotIn("alt", words[1])
        self.assertEqual(words[1]["forms"], ["sentir"])

    def test_articles_bare_forms_and_spellings_stay_alt(self):
        words = build([
            {"w": "el", "lemma": "el", "pos": "art", "_key": ("el", "DET"), "alt": ["la", "los", "las"]},
            {"w": "el agua", "lemma": "agua", "pos": "noun", "_key": ("agua", "NOUN"), "alt": ["agua"]},
            {"w": "la foto", "lemma": "foto", "pos": "noun", "_key": ("foto", "NOUN"), "alt": ["foto", "fotografía"]},
            # a reflexive whose base is reverted (lemma back to the base) keeps nothing as a form
            {"w": "casar", "lemma": "casar", "pos": "verb", "_key": ("casarse", "VERB"),
             "_base": ("casar", "to marry"), "alt": ["casar"]},
        ], {"la": [fem_entry("feminine singular of el", "art")]})
        self.assertEqual(words[0], {"w": "el", "lemma": "el", "pos": "art", "_key": ("el", "DET"),
                                    "alt": ["la", "los", "las"]})
        self.assertEqual(words[1]["alt"], ["agua"])
        self.assertEqual(words[2]["alt"], ["foto", "fotografía"])      # a plain spelling variant stays alt
        self.assertEqual(words[3]["alt"], ["casar"])
        self.assertFalse(any("forms" in w for w in words))

    def test_bare_form_wins_over_a_feminine_reading(self):
        # alt[0] trailing token of w is the engine's bare form even if the lexicon calls it a feminine
        words = build([{"w": "la hermana", "lemma": "hermana", "pos": "noun", "_key": ("hermana", "NOUN"),
                        "alt": ["hermana"]}], {"hermana": [fem_entry("female equivalent of hermano")]})
        self.assertEqual(words[0]["alt"], ["hermana"])
        self.assertNotIn("forms", words[0])

    def test_trailing_token_mirrors_core_js_trailing_cut(self):
        self.assertTrue(_trailing_token("el perro", "perro"))
        self.assertTrue(_trailing_token("l'amico", "amico"))
        self.assertTrue(_trailing_token("l’amico", "Amico"))
        self.assertFalse(_trailing_token("sentirse", "sentir"))
        self.assertFalse(_trailing_token("perro", "perro"))
        self.assertFalse(_trailing_token("el perro", "erro"))


if __name__ == "__main__":
    unittest.main()
