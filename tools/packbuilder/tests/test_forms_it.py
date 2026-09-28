"""Italian alt / forms split (es.mark_alt_forms via langs/it.py finalize_words,
alt_kind through core.words.split_alt_forms). Gender pairs (amica for l'amico,
unica for unico) and the base of a pronominal verb (lavare for lavarsi) go to
`forms`, and so does the article paradigm (lo/la/l'/i/gli/le of il: core.js
packArticles reads forms of article words); a noun's bare form alt[0] (amico
for l'amico) stays `alt`. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_forms_it.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class Lex:
    def __init__(self, E):
        self.E = E


def fem_entry(gloss, p="noun"):
    return {"p": p, "s": [[gloss, "", "", "form"]]}


def build(words, lex_e):
    sp = get_spec("it", None, load=False)
    sp.finalize_words(None, {"lexicon": Lex(lex_e)}, words)
    split_alt_forms(sp, words)
    return words


class ItalianForms(unittest.TestCase):
    def test_gender_and_reflexive_pairs_are_forms(self):
        words = build([
            {"w": "l'amico", "lemma": "amico", "pos": "noun", "_key": ("amico", "NOUN"), "alt": ["amico", "amica"]},
            {"w": "unico", "lemma": "unico", "pos": "adj", "_key": ("unico", "ADJ"), "alt": ["unica"]},
            {"w": "lavarsi", "lemma": "lavarsi", "pos": "verb", "_key": ("lavarsi", "VERB"),
             "_base": ("lavare", "to wash"), "alt": ["lavare"]},
        ], {"amica": [fem_entry("female equivalent of amico")],
            "unica": [fem_entry("feminine singular of unico", "adj")]})
        self.assertEqual((words[0]["alt"], words[0]["forms"]), (["amico"], ["amica"]))
        self.assertEqual((words[1].get("alt"), words[1]["forms"]), (None, ["unica"]))
        self.assertEqual((words[2].get("alt"), words[2]["forms"]), (None, ["lavare"]))

    def test_article_paradigm_is_forms_bare_forms_and_spellings_stay_alt(self):
        words = build([
            {"w": "il", "lemma": "il", "pos": "art", "_key": ("il", "DET"), "alt": ["lo", "la", "l'", "i", "gli", "le"]},
            {"w": "un", "lemma": "un", "pos": "art", "_key": ("un", "DET"), "alt": ["uno", "una", "un'"]},
            {"w": "il santo", "lemma": "santo", "pos": "noun", "_key": ("santo", "NOUN"), "alt": ["santo"]},
            {"w": "la radio", "lemma": "radio", "pos": "noun", "_key": ("radio", "NOUN"), "alt": ["radio", "radiofonia"]},
        ], {"una": [fem_entry("feminine singular of un", "adj")]})
        self.assertEqual((words[0].get("alt"), words[0]["forms"]), (None, ["lo", "la", "l'", "i", "gli", "le"]))
        self.assertEqual((words[1].get("alt"), words[1]["forms"]), (None, ["uno", "una", "un'"]))
        self.assertEqual(words[2]["alt"], ["santo"])
        self.assertEqual(words[3]["alt"], ["radio", "radiofonia"])    # a plain spelling variant stays alt
        self.assertFalse(any("forms" in w for w in words[2:]))


if __name__ == "__main__":
    unittest.main()
