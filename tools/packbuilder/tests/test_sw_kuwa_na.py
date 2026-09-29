"""spec.multiword_units (sentence_links, so sentences and passages): a pack
word spread over several tokens owns them. sw: kuwa + na is kuwa na "to
have" (kuna "there is" with a locative subject), linked once with one span,
never kuwa + na "and, with". Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_sw_kuwa_na.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.sentences import sentence_links  # noqa: E402
from packbuilder.core.spans import make_spans, token_offsets  # noqa: E402
from packbuilder.langs.base import LanguageSpec  # noqa: E402
from packbuilder.tests.test_sw_rules import spec  # noqa: E402

K2I = {("wa", "VERB"): "kuwa", ("na", "VERB"): "kuwa_na", ("na", "CONJ"): "na", ("kuna", "VERB"): "kuna",
       ("kitabu", "NOUN"): "kitabu", ("mtoto", "NOUN"): "mtoto", ("mimi", "PRON"): "mimi",
       ("wewe", "PRON"): "wewe", ("soma", "VERB"): "soma", ("yeye", "PRON"): "yeye", ("zuri", "ADJ"): "zuri"}


class Lex:
    def __init__(self, sp):
        self.spec = sp

    def resolve_sentence(self, toks, groups=None):
        return self.spec.post_resolve(toks, [None] * len(toks))


class KuwaNa(unittest.TestCase):
    def setUp(self):
        self.sp = spec()

    def link(self, text):
        toks = [list(t) for t in self.sp.tag_texts([text])[0]]
        where = []
        links = sentence_links(toks, Lex(self.sp), K2I, {k[0] for k in K2I}, text, where=where)
        spans = make_spans(text, token_offsets(text, toks), where, links)
        return links, [(text[a:b], w) for a, b, w in spans]

    def test_past_kuwa_na_is_one_word_one_span(self):
        links, spans = self.link("Alikuwa na kitabu.")
        self.assertEqual(links, ["kuwa_na", "kitabu"])
        self.assertEqual(spans, [("Alikuwa na", "kuwa_na"), ("kitabu", "kitabu")])

    def test_infinitive_kuwa_na(self):
        links, spans = self.link("Kuwa na kitabu.")
        self.assertIn(("Kuwa na", "kuwa_na"), spans)
        self.assertNotIn("kuwa", links)
        self.assertNotIn("na", links)

    def test_locative_subject_is_kuna(self):
        for text, surf in (("Kulikuwa na watoto.", "Kulikuwa na"), ("Hakukuwa na kitabu.", "Hakukuwa na"),
                           ("Kuwe na kitabu.", "Kuwe na"), ("Kukawa na kitabu.", "Kukawa na"),
                           ("Hakujakuwa na kitabu.", "Hakujakuwa na"), ("Kusingekuwa na mtoto.", "Kusingekuwa na")):
            links, spans = self.link(text)
            self.assertEqual(spans[0], (surf, "kuna"), text)
            self.assertNotIn("kuwa_na", links)

    def test_other_na_keeps_and_with(self):
        links, spans = self.link("Alikuwa na kitabu na mtoto.")
        self.assertEqual([s for s in spans if s[1] in ("kuwa_na", "na")], [("Alikuwa na", "kuwa_na"), ("na", "na")])
        links, spans = self.link("Mimi na wewe tunasoma.")
        self.assertIn(("na", "na"), spans)
        self.assertNotIn("kuwa_na", links)

    def test_kuwa_without_na_stays_kuwa(self):
        links, spans = self.link("Yeye alikuwa mzuri.")
        self.assertEqual(spans[1], ("alikuwa", "kuwa"))

    def test_default_spec_has_no_units(self):
        self.assertEqual(LanguageSpec.multiword_units(None, [], []), [])


if __name__ == "__main__":
    unittest.main()
