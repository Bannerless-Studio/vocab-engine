"""Hindi linker classes (langs/hi.py post_resolve, passage_uncounted): the
auxiliary रहना links nothing while the main verb "live, stay" keeps its link;
conjunction पर "but" links nothing while the postposition keeps its link; a
bare ā-form before रहना is the causative's stem only in the progressive
(लगा रहा हूँ) and the intransitive's perfective participle otherwise (जाम लगा
रहता था); a negation between the stem and its auxiliary does not hide the frame
(आग जला नहीं सकता). The tagger's own tokens are stubbed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_hi_linker.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402

PAIRS = {"लगा": ["लगना", "लगाना"], "जला": ["जलना", "जलाना"], "बना": ["बनना", "बनाना"]}
INFS = {"लगना", "लगाना", "रहना", "जलना", "जलाना", "बनना", "बनाना", "खाना", "आना", "पढ़ना", "सकना"}


def spec():
    sp = get_spec("hi", None, load=False)
    sp._verbs = lambda: (INFS, PAIRS)
    return sp


def links(rows):
    """rows: (surface, tagger lemma, upos, resolved link or None) -> links after post_resolve."""
    toks = [[s, lem, up, ""] for s, lem, up, _ in rows]
    return spec().post_resolve(toks, [r for *_, r in rows])


def V(x):
    return (x, "VERB")


class AuxRahna(unittest.TestCase):
    def test_progressive_aux_after_a_stem_links_nothing_and_the_main_verb_stays(self):
        out = links([("मैं", "मैं", "PRON", ("मैं", "PRON")), ("खा", "खाना", "VERB", V("खाना")),
                     ("रहा", "रहना", "AUX", V("रहना")), ("हूँ", "होना", "AUX", ("होना", "AUX"))])
        self.assertEqual([x and x[0] for x in out], ["मैं", "खाना", None, "होना"])

    def test_aux_after_an_imperfective_participle_the_tagger_calls_a_verb(self):
        out = links([("वह", "वह", "PRON", ("वह", "PRON")), ("खाता", "खाना", "VERB", V("खाना")),
                     ("नहीं", "नहीं", "PART", ("नहीं", "PART")), ("रहा", "रहना", "VERB", V("रहना"))])
        self.assertIsNone(out[3])

    def test_participle_the_tagger_calls_a_noun_still_frames_the_aux(self):
        out = links([("वे", "वे", "PRON", ("वे", "PRON")), ("खाते", "खाते", "NOUN", V("खाना")),
                     ("रहे", "रहना", "VERB", V("रहना"))])
        self.assertIsNone(out[2])
        out = links([("वह", "वह", "PRON", ("वह", "PRON")), ("रास्ता", "रास्ता", "NOUN", ("रास्ता", "NOUN")),
                     ("रहा", "रहना", "VERB", V("रहना"))])
        self.assertEqual(out[2], V("रहना"))

    def test_stay_after_a_place_or_an_adjective_keeps_its_link(self):
        self.assertEqual(links([("जयपुर", "जयपुर", "NOUN", ("जयपुर", "NOUN")), ("में", "में", "ADP", ("में", "ADP")),
                                ("रहता", "रहना", "VERB", V("रहना")), ("हूँ", "होना", "AUX", ("होना", "AUX"))])[2],
                         V("रहना"))
        self.assertEqual(links([("व्यस्त", "व्यस्त", "ADJ", ("व्यस्त", "ADJ")),
                                ("रहा", "रहना", "VERB", V("रहना"))])[1], V("रहना"))


class ConjunctionPar(unittest.TestCase):
    def test_tagged_conjunction_links_nothing(self):
        out = links([("वह", "वह", "PRON", ("वह", "PRON")), ("है", "होना", "AUX", ("होना", "AUX")), (",", ",", "PUNCT", None),
                     ("पर", "पर", "CCONJ", ("पर", "ADP")), ("खुश", "खुश", "ADJ", ("खुश", "ADJ"))])
        self.assertIsNone(out[3])
        self.assertEqual(out[4], ("खुश", "ADJ"))

    def test_after_a_comma_or_a_finite_copula_even_when_tagged_adp(self):
        for prev, up in ((",", "PUNCT"), ("है", "AUX")):
            out = links([("तुम", "तुम", "PRON", ("तुम", "PRON")), (prev, prev, up, ("होना", "AUX") if up == "AUX" else None),
                         ("पर", "पर", "ADP", ("पर", "ADP"))])
            self.assertIsNone(out[2], prev)

    def test_postposition_after_a_noun_or_a_non_finite_verb_keeps_its_link(self):
        out = links([("बेंच", "बेंच", "NOUN", ("बेंच", "NOUN")), ("पर", "पर", "ADP", ("पर", "ADP"))])
        self.assertEqual(out[1], ("पर", "ADP"))
        out = links([("आने", "आना", "VERB", V("आना")), ("पर", "पर", "ADP", ("पर", "ADP"))])
        self.assertEqual(out[1], ("पर", "ADP"))

    def test_passages_keep_the_conjunction_counted_and_never_link_it(self):
        toks = [["वह", "वह", "PRON", ""], [",", ",", "PUNCT", ""], ["पर", "पर", "CCONJ", ""], ["घर", "घर", "NOUN", ""],
                ["पर", "पर", "ADP", ""]]
        self.assertEqual(spec().passage_no_link(toks), {2})


class PassageBand(unittest.TestCase):
    def test_aux_rahna_is_uncounted_and_credited_to_the_length_band(self):
        sp = spec()
        toks = [["वह", "वह", "PRON", ""], ["खा", "खाना", "VERB", ""], ["रहा", "रहना", "AUX", ""], ["है", "होना", "AUX", ""]]
        resolved = [("वह", "PRON"), ("खाना", "VERB"), None, ("होना", "AUX")]
        self.assertIn(2, sp.passage_uncounted(toks, resolved))
        self.assertEqual(sp.passage_band_credit(toks, resolved), {2})

    def test_a_main_verb_stay_is_neither(self):
        sp = spec()
        toks = [["जयपुर", "जयपुर", "NOUN", ""], ["में", "में", "ADP", ""], ["रहता", "रहना", "VERB", ""]]
        resolved = [("जयपुर", "NOUN"), ("में", "ADP"), ("रहना", "VERB")]
        self.assertEqual(sp.passage_uncounted(toks, resolved), set())
        self.assertEqual(sp.passage_band_credit(toks, resolved), set())


class StemBeforeRahna(unittest.TestCase):
    def frame(self, noun, stem, aux_form, tail):
        rows = [(noun, noun, "NOUN", (noun, "NOUN")), (stem, stem + "ना", "VERB", V(PAIRS[stem][1])),
                (aux_form, "रहना", "AUX", V("रहना"))]
        rows += [(x, "होना", "AUX", ("होना", "AUX")) for x in tail]
        return links(rows)[1]

    def test_habitual_after_the_perfective_is_the_intransitive(self):
        self.assertEqual(self.frame("जाम", "लगा", "रहता", ["था"]), V("लगना"))

    def test_progressive_stays_the_causative(self):
        self.assertEqual(self.frame("पट्टी", "लगा", "रहा", ["हूँ"]), V("लगाना"))
        self.assertEqual(self.frame("दाढ़ी", "बना", "रहे", ["हैं"]), V("बनाना"))

    def test_plural_without_a_copula_is_the_continuative(self):
        self.assertEqual(self.frame("भरोसा", "बना", "रहे", []), V("बनना"))

    def test_negation_between_the_stem_and_its_auxiliary_keeps_the_frame(self):
        rows = [("आग", "आग", "NOUN", ("आग", "NOUN")), ("जला", "जलाना", "VERB", V("जलना")),
                ("नहीं", "नहीं", "PART", ("नहीं", "PART")), ("सकता", "सकना", "AUX", V("सकना"))]
        self.assertEqual(links(rows)[1], V("जलाना"))

    def test_passive_jana_across_a_particle_stays_the_base_verb(self):
        rows = [("चोर", "चोर", "NOUN", ("चोर", "NOUN")), ("पकड़ा", "पकड़ाना", "VERB", V("पकड़ाना")),
                ("ही", "ही", "PART", ("ही", "PART")), ("जाएगा", "जाना", "AUX", V("जाना"))]
        sp = spec()
        sp._verbs = lambda: (INFS | {"पकड़ना", "पकड़ाना", "जाना"}, {**PAIRS, "पकड़ा": ["पकड़ना", "पकड़ाना"]})
        out = sp.post_resolve([[s, lem, up, ""] for s, lem, up, _ in rows], [r for *_, r in rows])
        self.assertEqual(out[1], V("पकड़ना"))

    def test_no_frame_stays_the_intransitive(self):
        rows = [("आग", "आग", "NOUN", ("आग", "NOUN")), ("जला", "जलाना", "VERB", V("जलाना")),
                ("।", "।", "PUNCT", None)]
        self.assertEqual(links(rows)[1], V("जलना"))


if __name__ == "__main__":
    unittest.main()
