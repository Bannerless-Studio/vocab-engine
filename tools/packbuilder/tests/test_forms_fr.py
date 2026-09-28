"""French alt / forms split (es.mark_alt_forms with fr._fr_inflected_alt, the
last step of langs/fr.py finalize_words; alt_kind through
core.words.split_alt_forms). Gender pairs (amie for l'ami), determiner and
pronoun paradigms (cette/ces of ce, la/les of le) and the singular of a
plural-display noun (vacance of les vacances) go to `forms`, and so do the
article paradigm (la/l'/les of le, une of un: core.js packArticles reads forms
of article words) and the base of a pronominal display (lever for se lever),
which the word's `bare` field keeps as the gap label (core.js bareForm). A
noun's bare form alt[0] (ami for l'ami) stays `alt`. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_forms_fr.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs.es import mark_alt_forms  # noqa: E402
from packbuilder.langs.fr import _fr_inflected_alt, _fr_pronominal_base  # noqa: E402


class Lex:
    def __init__(self, E):
        self.E = E


def build(words, lex_e=None):
    sp = get_spec("fr", None, load=False)
    mark_alt_forms(sp, {"lexicon": Lex(lex_e or {})}, words, extra=_fr_inflected_alt, bare_form=_fr_pronominal_base)
    split_alt_forms(sp, words)
    return words


class FrenchForms(unittest.TestCase):
    def test_inflected_sources_are_forms(self):
        words = build([
            {"w": "l'ami", "lemma": "ami", "pos": "noun", "_key": ("ami", "NOUN"), "alt": ["ami", "amie"]},
            {"w": "ce", "lemma": "ce", "pos": "det", "_key": ("cet", "DET"), "alt": ["cet", "cette", "ces"]},
            {"w": "mon", "lemma": "mon", "pos": "det", "_key": ("mon", "DET"), "alt": ["ma", "mes"]},
            {"w": "le", "lemma": "le", "pos": "pron", "_key": ("le", "PRON"), "alt": ["la", "les"]},
            {"w": "les vacances", "lemma": "vacances", "pos": "noun", "_key": ("vacance", "NOUN"),
             "alt": ["vacances", "vacance"]},
        ], {"amie": [{"p": "noun", "s": [["female equivalent of ami", "", "", "form"]]}]})
        self.assertEqual((words[0]["alt"], words[0]["forms"]), (["ami"], ["amie"]))
        self.assertEqual((words[1].get("alt"), words[1]["forms"]), (None, ["cet", "cette", "ces"]))
        self.assertEqual((words[2].get("alt"), words[2]["forms"]), (None, ["ma", "mes"]))
        self.assertEqual((words[3].get("alt"), words[3]["forms"]), (None, ["la", "les"]))
        self.assertEqual((words[4]["alt"], words[4]["forms"]), (["vacances"], ["vacance"]))

    def test_articles_and_pronominal_bases_are_forms_noun_bare_stays_alt(self):
        words = build([
            {"w": "le", "lemma": "le", "pos": "art", "_key": ("le", "DET"), "alt": ["la", "l'", "les"]},
            {"w": "un", "lemma": "un", "pos": "art", "_key": ("un", "DET"), "alt": ["une"]},
            {"w": "se lever", "lemma": "se lever", "pos": "verb", "_key": ("se lever", "VERB"),
             "_base": ("lever", "to lift"), "alt": ["lever"]},
            {"w": "s'asseoir", "lemma": "s'asseoir", "pos": "verb", "_key": ("asseoir", "VERB"), "alt": ["asseoir"]},
            {"w": "le/la médecin", "lemma": "médecin", "pos": "noun", "_key": ("médecin", "NOUN"),
             "alt": ["médecin", "medecin"]},
        ])
        self.assertEqual((words[0].get("alt"), words[0]["forms"]), (None, ["la", "l'", "les"]))
        self.assertEqual((words[1].get("alt"), words[1]["forms"]), (None, ["une"]))
        self.assertEqual((words[2].get("alt"), words[2]["forms"], words[2]["bare"]), (None, ["lever"], "lever"))
        self.assertEqual((words[3].get("alt"), words[3]["forms"], words[3]["bare"]), (None, ["asseoir"], "asseoir"))
        self.assertEqual(words[4]["alt"], ["médecin", "medecin"])     # a noun's bare form and a spelling stay alt
        self.assertNotIn("forms", words[4])
        self.assertFalse(any("bare" in w for w in (words[0], words[1], words[4])))

    def test_finalize_words_ends_with_the_mark(self):
        src = (Path(__file__).resolve().parents[1] / "langs" / "fr.py").read_text()
        body = src.split("    def finalize_words(self, env, ctx, words):", 1)[1].split("\n    def ", 1)[0]
        self.assertTrue(body.rstrip().endswith("mark_alt_forms(self, ctx, words, extra=_fr_inflected_alt, bare_form=_fr_pronominal_base)"))


if __name__ == "__main__":
    unittest.main()
