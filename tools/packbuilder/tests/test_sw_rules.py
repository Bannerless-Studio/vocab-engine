"""Swahili rule-tagger tests (packbuilder/langs/sw.py): Analyser.noun_lemma
(noun class prefixes) and Analyser.parse_verb (verb morphology) against a
small synthetic index, tag_texts end to end over fixture sentences (the
CLOSED table forcing a fixed reading, and its one context override: kuwa is
the copula unless the previous word is a verb of saying), and the generic
passage_names_never_link fallback (Linker.links_all) for the sw homographs
it exists for (Simba the name vs simba "lion"). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_sw_rules.py     (from vocab-engine/)
"""
import sys
import unittest
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs.sw import Analyser, Swahili  # noqa: E402
from packbuilder.passages import Linker  # noqa: E402


def analyser():
    """An Analyser over a small hand-picked vocabulary (no kaikki file read)."""
    an = Analyser.__new__(Analyser)
    an.noun = {"mtoto": "m/wa", "kitabu": "ki/vi", "shule": "", "simba": ""}
    an.noun_form = {"watoto": "mtoto", "vitabu": "kitabu"}
    an.plural = {}
    an.verb = {"soma": "soma", "la": "la", "enda": "enda", "kutana": "kutana",
               "ona": "ona", "wa": "wa", "sema": "sema"}
    an.verb_raw = {}
    an.adj_stem = {"zuri", "dogo"}
    an.adj_form = {"mzuri": "zuri", "wazuri": "zuri", "mdogo": "dogo"}
    an.other = defaultdict(set)
    an.intj_form = {}
    an.all_words = set()
    return an


def spec():
    sp = Swahili.__new__(Swahili)
    sp._an = analyser()
    return sp


class NounClassPrefixes(unittest.TestCase):
    """noun_lemma: the plural class prefix and the locative -ni both link
    the singular headword the pack teaches."""

    def setUp(self):
        self.an = analyser()

    def test_bare_singular_is_itself(self):
        self.assertEqual(self.an.noun_lemma("mtoto"), "mtoto")

    def test_wa_plural_links_the_m_wa_singular(self):
        self.assertEqual(self.an.noun_lemma("watoto"), "mtoto")

    def test_vi_plural_links_the_ki_vi_singular(self):
        self.assertEqual(self.an.noun_lemma("vitabu"), "kitabu")

    def test_locative_ni_links_the_noun(self):
        self.assertEqual(self.an.noun_lemma("shuleni"), "shule")

    def test_unknown_surface_is_no_noun(self):
        self.assertIsNone(self.an.noun_lemma("gari"))


class VerbMorphology(unittest.TestCase):
    """parse_verb: SM + TAM (+ka/REL) affirmative and negative finites, the
    infinitive and its negative, the imperative, and the passive/applicative
    derivations that fold into the base verb (verb_stem)."""

    def setUp(self):
        self.an = analyser()

    def lemma(self, w):
        return self.an.parse_verb(w)[0][0]

    def feats(self, w):
        return self.an.parse_verb(w)[0][1]

    def test_present(self):
        self.assertEqual(self.lemma("ninasoma"), "soma")
        self.assertEqual(self.feats("ninasoma"), {"VerbForm": "Fin"})

    def test_future_and_past_and_perfect(self):
        for w in ("atasoma", "alisoma", "amesoma"):
            self.assertEqual(self.lemma(w), "soma", w)

    def test_negative_present_drops_the_final_i(self):
        self.assertEqual(self.lemma("hasomi"), "soma")
        self.assertEqual(self.feats("hasomi"), {"VerbForm": "Fin", "Polarity": "Neg"})

    def test_infinitive_and_negative_infinitive(self):
        self.assertEqual(self.feats("kusoma"), {"VerbForm": "Inf"})
        self.assertEqual(self.feats("kutosoma"), {"VerbForm": "Inf", "Polarity": "Neg"})

    def test_imperative_plural(self):
        self.assertEqual(self.lemma("someni"), "soma")
        self.assertIn("Mood", self.feats("someni"))

    def test_passive_folds_to_the_base_verb(self):
        v, derived = self.an.verb_stem("somwa")
        self.assertEqual(v, "soma")
        self.assertTrue(derived)   # scored below a plain reading in _stems_after

    def test_applicative_folds_to_the_base_verb(self):
        v, derived = self.an.verb_stem("somea")
        self.assertEqual(v, "soma")
        self.assertTrue(derived)

    def test_no_reading_for_an_unknown_stem(self):
        self.assertIsNone(self.an.verb_stem("bembea"))


class ClosedWordForcing(unittest.TestCase):
    """analyse: a CLOSED-table word (pronouns, kuwa) keeps its forced
    reading regardless of context, except the one documented override:
    kuwa is the conjunction "that" right after a verb of saying/thinking."""

    def setUp(self):
        self.sp = spec()

    def tag(self, text):
        return self.sp.tag_texts([text])[0]

    def test_pronoun_forced_pron_whatever_the_slot(self):
        toks = self.tag("Mimi na wewe tunasoma.")
        self.assertEqual(toks[0][1:3], ("mimi", "PRON"))
        self.assertEqual(toks[2][1:3], ("wewe", "PRON"))

    def test_kuwa_is_the_copula_by_default(self):
        toks = self.tag("Yeye alikuwa mzuri.")
        self.assertEqual(toks[1][1:3], ("wa", "VERB"))

    def test_kuwa_after_a_say_verb_is_the_conjunction(self):
        toks = self.tag("Alisema kuwa anasoma.")
        self.assertEqual(toks[0][1:3], ("sema", "VERB"))
        self.assertEqual(toks[1][1:3], ("kuwa", "SCONJ"))


class SentenceFixtures(unittest.TestCase):
    """tag_texts end to end over ten sentences: every rule above (noun
    prefixes, verb morphology, closed-word forcing, adjective agreement)
    seen together, as sentences.json words are actually tagged."""

    def setUp(self):
        self.sp = spec()

    def tag(self, text):
        return self.sp.tag_texts([text])[0]

    def check(self, text, expected):
        """expected: [(surface, lemma, upos), ...] for the word tokens (skip punctuation)."""
        got = [(s, lem, up) for s, lem, up, _ in self.tag(text) if up != "PUNCT"]
        self.assertEqual(got, expected, text)

    def test_01_pronoun_subject(self):
        self.check("Mimi ninasoma kitabu.",
                    [("Mimi", "mimi", "PRON"), ("ninasoma", "soma", "VERB"), ("kitabu", "kitabu", "NOUN")])

    def test_02_plural_noun_and_adjective_agreement(self):
        self.check("Watoto wanasoma vitabu vizuri.",
                    [("Watoto", "mtoto", "NOUN"), ("wanasoma", "soma", "VERB"),
                     ("vitabu", "kitabu", "NOUN"), ("vizuri", "zuri", "ADJ")])

    def test_03_kuwa_default_copula(self):
        self.check("Yeye alikuwa mzuri.",
                    [("Yeye", "yeye", "PRON"), ("alikuwa", "wa", "VERB"), ("mzuri", "zuri", "ADJ")])

    def test_04_kuwa_as_conjunction(self):
        self.check("Alisema kuwa anasoma.",
                    [("Alisema", "sema", "VERB"), ("kuwa", "kuwa", "SCONJ"), ("anasoma", "soma", "VERB")])

    def test_05_negative_present(self):
        self.check("Sisi hatusomi shuleni.",
                    [("Sisi", "sisi", "PRON"), ("hatusomi", "soma", "VERB"), ("shuleni", "shule", "NOUN")])

    def test_06_imperative_plural(self):
        self.check("Someni vitabu!", [("Someni", "soma", "VERB"), ("vitabu", "kitabu", "NOUN")])

    def test_07_prenominal_adjective_and_locative(self):
        self.check("Mtoto mdogo anaenda shuleni.",
                    [("Mtoto", "mtoto", "NOUN"), ("mdogo", "dogo", "ADJ"),
                     ("anaenda", "enda", "VERB"), ("shuleni", "shule", "NOUN")])

    def test_08_lowercase_homograph_is_the_noun(self):
        self.check("Aliona simba.", [("Aliona", "ona", "VERB"), ("simba", "simba", "NOUN")])

    def test_09_capitalised_homograph_mid_sentence_is_a_name(self):
        self.check("Alikutana na Simba.",
                    [("Alikutana", "kutana", "VERB"), ("na", "na", "CCONJ"), ("Simba", "Simba", "PROPN")])

    def test_10_coordinated_pronouns(self):
        self.check("Mimi na wewe tunasoma.",
                    [("Mimi", "mimi", "PRON"), ("na", "na", "CCONJ"), ("wewe", "wewe", "PRON"),
                     ("tunasoma", "soma", "VERB")])


def word(wid, lemma, group, pos, rank):
    return {"id": wid, "w": lemma, "lemma": lemma, "pos": pos, "lv": "A1", "rank": rank, "_key": [lemma, group]}


def T(text, upos, lemma=None):
    return [text, lemma or text.lower(), upos, ""]


class FakeLex:
    def __init__(self, res=None):
        self.res = res or {}

    def usable_entries(self, w, kpos=None):
        return []

    def resolve_sentence(self, toks, groups=None):
        return [self.res.get(t[0].lower()) for t in toks]

    def readings(self, s):
        return []

    def zipf(self, w):
        return 0.0


class PassageNamesNeverLink(unittest.TestCase):
    """The generic passage_names_never_link fallback (Linker.links_all,
    passages.py), which sw turns on for exactly the reason id does: many
    given names (Simba among them, per langs/sw.py's own list) are also
    taught words."""

    def spec_with_words(self):
        sp = Swahili.__new__(Swahili)
        return sp

    def test_declared_name_is_unlinked_and_uncounted(self):
        sp = self.spec_with_words()
        lex = FakeLex()
        words = [word("w_na", "na", "CCONJ", "conj", 1), word("w_simba", "simba", "NOUN", "noun", 2)]
        lk = Linker(sp, {"lexicon": lex, "groups": None, "truecase": (Counter(), Counter()), "words": words},
                    {w["id"]: w for w in words})
        # the tagger reads the name as PROPN; only the text decides it is the declared name
        toks = [T("na", "CCONJ"), T("Simba", "PROPN", "simba")]
        lk.links = lambda toks, text, en, where: where.extend([("tok", 0, 0, "w_na"), ("tok", 1, 1, "w_simba")]) \
            or ["w_na", "w_simba"]
        ids, cl, _spans, _claimed = lk.links_all(toks, "na Simba", "", frozenset({"Simba"}))
        self.assertEqual(ids, ["w_na"])
        self.assertNotIn(1, [c[4] for c in cl])

    def test_lowercase_homograph_still_links(self):
        sp = self.spec_with_words()
        lex = FakeLex()
        words = [word("w_ona", "ona", "VERB", "verb", 1), word("w_simba", "simba", "NOUN", "noun", 2)]
        lk = Linker(sp, {"lexicon": lex, "groups": None, "truecase": (Counter(), Counter()), "words": words},
                    {w["id"]: w for w in words})
        toks = [T("aliona", "VERB", "ona"), T("simba", "NOUN")]
        lk.links = lambda toks, text, en, where: where.extend([("tok", 0, 0, "w_ona"), ("tok", 1, 1, "w_simba")]) \
            or ["w_ona", "w_simba"]
        ids, _cl, _spans, _claimed = lk.links_all(toks, "aliona simba", "", frozenset({"Simba"}))
        self.assertEqual(ids, ["w_ona", "w_simba"])


if __name__ == "__main__":
    unittest.main()
