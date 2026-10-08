"""A closed-class token the tagger reads as another closed-class group links the lemma's one pack
entry (es relative "que" is tagged PRON, the pack word is the conjunction), so it gets a span.
Stdlib only.

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.sentences import function_word_link, sentence_links  # noqa: E402
from packbuilder.core.spans import make_spans, token_offsets  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class Lex:
    def __init__(self, spec, table):
        self.spec, self.table = spec, table

    def resolve_sentence(self, toks, groups=None):
        return [self.table.get(t[0].lower()) for t in toks]


def tok(w, lemma, upos):
    return [w, lemma, upos, ""]


TABLE = {"algo": ("algo", "PRON"), "que": ("que", "PRON"), "pueda": ("poder", "VERB"), "creo": ("creer", "VERB"),
         "hacer": ("hacer", "VERB")}


class FunctionWordLink(unittest.TestCase):
    def test_pron_tagged_que_links_the_conjunction_entry(self):
        sp = get_spec("es", tempfile.mkdtemp())
        k2i = {("que", "CONJ"): "w_que", ("algo", "PRON"): "w_algo", ("poder", "VERB"): "w_poder"}
        text = "Algo que pueda."
        toks = [tok("Algo", "algo", "PRON"), tok("que", "que", "PRON"), tok("pueda", "poder", "VERB"), tok(".", ".", "PUNCT")]
        where = []
        links = sentence_links(toks, Lex(sp, TABLE), k2i, {"poder"}, text, where=where)
        self.assertEqual(links, ["w_algo", "w_que", "w_poder"])
        spans = make_spans(text, token_offsets(text, toks), where, links)
        self.assertEqual([(text[a:b], w) for a, b, w in spans], [("Algo", "w_algo"), ("que", "w_que"), ("pueda", "w_poder")])

    def test_own_group_entry_wins(self):
        k2i = {("que", "CONJ"): "w_conj", ("que", "PRON"): "w_pron"}
        self.assertEqual(function_word_link("que", "PRON", k2i), "w_conj")      # only reached when (que, PRON) is missing
        sp = get_spec("es", tempfile.mkdtemp())
        toks = [tok("que", "que", "PRON"), tok(".", ".", "PUNCT")]
        self.assertEqual(sentence_links(toks, Lex(sp, TABLE), k2i, set(), "que."), ["w_pron"])

    def test_two_candidates_link_nothing(self):
        self.assertIsNone(function_word_link("que", "ADP", {("que", "CONJ"): "a", ("que", "PRON"): "b"}))

    def test_content_groups_never_cross(self):
        k2i = {("que", "CONJ"): "w_que"}
        self.assertIsNone(function_word_link("que", "NOUN", k2i))
        self.assertIsNone(function_word_link("que", "ADV", k2i))
        self.assertIsNone(function_word_link("otro", "PRON", k2i))

    def test_language_hook_runs_first(self):
        sp = get_spec("hi", tempfile.mkdtemp())
        k2i = {("x", "CONJ"): "w_conj"}
        sp.cross_pos_link = lambda lexicon, lem, group, key_to_id: "w_hook"
        toks = [tok("x", "x", "PRON"), tok(".", ".", "PUNCT")]
        self.assertEqual(sentence_links(toks, Lex(sp, {"x": ("x", "PRON")}), k2i, set(), "x."), ["w_hook"])


if __name__ == "__main__":
    unittest.main()
