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
        sp = get_spec("es", tempfile.mkdtemp())
        self.assertEqual(function_word_link("que", "PRON", k2i, sp), "w_conj")      # only reached when (que, PRON) is missing
        toks = [tok("que", "que", "PRON"), tok(".", ".", "PUNCT")]
        self.assertEqual(sentence_links(toks, Lex(sp, TABLE), k2i, set(), "que."), ["w_pron"])

    def test_two_candidates_link_nothing(self):
        sp = get_spec("es", tempfile.mkdtemp())
        self.assertIsNone(function_word_link("que", "ADP", {("que", "CONJ"): "a", ("que", "PRON"): "b"}, sp))

    def test_content_groups_never_cross(self):
        sp = get_spec("es", tempfile.mkdtemp())
        k2i = {("que", "CONJ"): "w_que"}
        self.assertIsNone(function_word_link("que", "NOUN", k2i, sp))
        self.assertIsNone(function_word_link("que", "ADV", k2i, sp))
        self.assertIsNone(function_word_link("otro", "PRON", k2i, sp))

    def test_de_das_pron_stays_off_the_article(self):
        sp = get_spec("de", tempfile.mkdtemp())
        self.assertIn(("der", "DET"), sp.fixed_word)
        k2i = {("der", "DET"): "w_art", ("das", "PRON"): "w_das_pron"}
        # lemma "der" PRON (relative das): the surface's own PRON entry wins, article is never reached
        self.assertEqual(function_word_link("der", "PRON", k2i, sp, "Das"), "w_das_pron")
        self.assertIsNone(function_word_link("der", "PRON", {("der", "DET"): "w_art"}, sp, "die"))
        toks = [tok("Das", "der", "PRON"), tok("ist", "sein", "VERB"), tok(".", ".", "PUNCT")]
        k2 = {**k2i, ("sein", "VERB"): "w_sein"}
        tbl = {"das": ("der", "PRON"), "ist": ("sein", "VERB")}
        self.assertEqual(sentence_links(toks, Lex(sp, tbl), k2, {"sein"}, "Das ist."), ["w_das_pron", "w_sein"])
        k3 = {("der", "DET"): "w_art", ("sein", "VERB"): "w_sein"}
        self.assertEqual(sentence_links(toks, Lex(sp, tbl), k3, {"sein"}, "Das ist."), ["w_sein"])

    def test_it_object_pronouns_keep_their_own_entries_and_se_stays_unlinked(self):
        sp = get_spec("it", tempfile.mkdtemp())
        self.assertIn(("il", "DET"), sp.fixed_word)
        k2i = {("il", "DET"): "w_il", ("la", "PRON"): "w_la_pron", ("lo", "PRON"): "w_lo_pron", ("se", "CONJ"): "w_se_conj"}
        self.assertEqual(function_word_link("il", "PRON", k2i, sp, "la"), "w_la_pron")
        self.assertEqual(function_word_link("il", "PRON", k2i, sp, "lo"), "w_lo_pron")
        self.assertIsNone(function_word_link("il", "PRON", {("il", "DET"): "w_il"}, sp, "le"))
        self.assertIsNone(function_word_link("se", "PRON", k2i, sp, "se"))     # reflexive se is not conj "if"
        toks = [tok("Se", "se", "PRON"), tok("ne", "ne", "PRON"), tok(".", ".", "PUNCT")]
        tbl = {"se": ("se", "PRON"), "ne": ("ne", "PRON")}
        self.assertEqual(sentence_links(toks, Lex(sp, tbl), {("se", "CONJ"): "w_se_conj", ("ne", "PRON"): "w_ne"}, set(), "Se ne."), ["w_ne"])

    def test_pron_conj_only_for_the_specs_allow_list(self):
        for code, ok in (("es", True), ("fr", True), ("it", False), ("de", False)):
            sp = get_spec(code, tempfile.mkdtemp())
            self.assertEqual(function_word_link("que", "PRON", {("que", "CONJ"): "w"}, sp), "w" if ok else None, code)
            self.assertEqual(function_word_link("que", "CONJ", {("que", "PRON"): "w"}, sp), "w" if ok else None, code)
        self.assertIsNone(function_word_link("que", "PRON", {("que", "CONJ"): "w"}))            # no spec: nothing allowed

    def test_other_function_pairs_still_cross(self):
        sp = get_spec("de", tempfile.mkdtemp())
        self.assertEqual(function_word_link("wie", "CONJ", {("wie", "ADP"): "w_adp"}, sp), "w_adp")
        self.assertEqual(function_word_link("este", "PRON", {("este", "DET"): "w_det"}, get_spec("es", tempfile.mkdtemp())), "w_det")

    def test_language_hook_runs_first(self):
        sp = get_spec("hi", tempfile.mkdtemp())
        k2i = {("x", "CONJ"): "w_conj"}
        sp.cross_pos_link = lambda lexicon, lem, group, key_to_id: "w_hook"
        toks = [tok("x", "x", "PRON"), tok(".", ".", "PUNCT")]
        self.assertEqual(sentence_links(toks, Lex(sp, {"x": ("x", "PRON")}), k2i, set(), "x."), ["w_hook"])


if __name__ == "__main__":
    unittest.main()
