"""Passage builder, two defect classes: the `words` order of a sentence is
deterministic (first span start, then id), and a capitalised token is a name
only when the tagger tags it PROPN, a declared name retags it, or the
dictionary lists it as a proper name (a resolver's PROPN reading alone is not
one: de Taxi, Radfahrer). Stdlib only.

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import passages  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.passages import Linker, order_words  # noqa: E402
from packbuilder.tests.test_passage_de_ru import TMP, FakeLex, T, ids, linker, word  # noqa: E402


class WordsOrder(unittest.TestCase):
    def test_orders_by_first_span_start_then_id(self):
        spans = [[10, 14, "w2"], [0, 4, "w3"], [5, 9, "w1"]]
        self.assertEqual(order_words(["w1", "w2", "w3"], spans), ["w3", "w1", "w2"])

    def test_independent_of_the_input_order(self):
        spans = [[0, 3, "w9"], [4, 8, "w1"], [9, 12, "w5"]]
        want = ["w9", "w1", "w5"]
        for ids_ in (["w1", "w5", "w9"], ["w9", "w5", "w1"], ["w5", "w1", "w9"]):
            self.assertEqual(order_words(ids_, spans), want)

    def test_same_start_ties_by_id(self):
        self.assertEqual(order_words(["w7", "w2"], [[0, 3, "w7"], [0, 3, "w2"]]), ["w2", "w7"])

    def test_word_with_two_spans_uses_the_first(self):
        spans = [[0, 2, "w1"], [5, 8, "w2"], [9, 11, "w1"]]
        self.assertEqual(order_words(["w2", "w1"], spans), ["w1", "w2"])

    def test_unspanned_words_come_last_by_id_and_duplicates_drop(self):
        spans = [[4, 6, "w4"]]
        self.assertEqual(order_words(["w9", "w4", "w1", "w9"], spans), ["w4", "w1", "w9"])

    def test_same_id_set_and_spans_give_equal_lists(self):
        # the defect: two builder versions found the same links in another order
        spans = [[0, 3, "w1"], [4, 8, "w2"]]
        self.assertEqual(order_words(["w2", "w1"], spans), order_words(["w1", "w2"], spans))


WORDS = [word("w_haus", "haus", "NOUN", "noun", 1), word("w_der", "der", "DET", "art", 2),
         word("w_sehen", "sehen", "VERB", "verb", 3), word("w_er", "er", "PRON", "pron", 4),
         word("w_ein", "ein", "DET", "art", 5)]


class CapitalisedNames(unittest.TestCase):
    """classify: who counts as a name."""

    def cl(self, toks, res, lex_entries=None, **attrs):
        sp = get_spec("de", TMP)
        sp.passage_post_resolve = lambda toks, out: out
        for k, v in attrs.items():
            setattr(sp, k, v)
        lk = linker(sp, FakeLex(res, E=lex_entries or {}), WORDS)
        return lk, lk.classify(toks)

    def test_resolver_propn_on_a_noun_tag_is_out_of_pack(self):
        t = [T("Er", "PRON"), T("sieht", "VERB"), T("ein", "DET"), T("Taxi", "NOUN"), T(".", "PUNCT")]
        lk, cl = self.cl(t, {"taxi": ("taxi", "PROPN")})
        self.assertIn("Taxi", ids(cl))
        self.assertIsNone(ids(cl)["Taxi"])
        self.assertEqual(lk.cap_oop, {"taxi"})

    def test_tagger_propn_is_a_name_and_not_counted(self):
        t = [T("Anna", "PROPN"), T("sieht", "VERB")]
        lk, cl = self.cl(t, {"anna": ("anna", "PROPN")})
        self.assertNotIn("Anna", ids(cl))
        self.assertEqual(lk.cap_oop, set())

    def test_dictionary_proper_name_tagged_noun_is_a_name(self):
        t = [T("Lena", "NOUN"), T("sieht", "VERB")]
        lk, cl = self.cl(t, {"lena": ("lena", "PROPN")}, {"lena": [{"p": "name"}]})
        self.assertNotIn("Lena", ids(cl))
        lk, cl = self.cl(t, {"lena": ("lena", "PROPN")}, {"lena": [{"p": "noun"}]})
        self.assertIn("Lena", ids(cl))

    def test_declared_name_is_retagged_propn(self):
        sp = get_spec("de", TMP)
        lk = linker(sp, FakeLex(), WORDS)
        toks = lk.retag([T("Lena", "NOUN"), T("sieht", "VERB"), T("Taxi", "NOUN")], frozenset({"Lena"}))
        self.assertEqual([t[2] for t in toks], ["PROPN", "VERB", "NOUN"])

    def test_pack_noun_capitalised_still_links(self):
        t = [T("Das", "DET", "der"), T("Haus", "NOUN")]
        lk, cl = self.cl(t, {"das": ("der", "DET"), "haus": ("haus", "NOUN")})
        self.assertEqual(ids(cl)["Haus"], "w_haus")
        self.assertEqual(lk.cap_oop, set())

    def test_sentence_initial_common_word_is_not_oop_where_caps_mark_names(self):
        # es/fr/it/ru/id/sw: a capital marks a name mid-sentence only; an initial common word is read normally
        t = [T("Haus", "NOUN"), T("sehen", "VERB")]
        lk, cl = self.cl(t, {"haus": ("haus", "NOUN"), "sehen": ("sehen", "VERB")}, caps_mark_names=True)
        self.assertEqual(lk.cap_oop, set())
        self.assertEqual(ids(cl)["Haus"], "w_haus")

    def test_sentence_initial_resolver_propn_is_out_of_pack_not_a_name(self):
        t = [T("Taxi", "NOUN"), T("fährt", "VERB")]
        lk, cl = self.cl(t, {"taxi": ("taxi", "PROPN")}, caps_mark_names=True)
        self.assertEqual(lk.cap_oop, {"taxi"})


class OopPolicy(unittest.TestCase):
    """run(): an undeclared capitalised oop noun warns in a shipped passage, errors in a new one."""

    def run_pass(self, shipped_ids):
        repo = Path(tempfile.mkdtemp())
        (repo / "tools").mkdir()
        (repo / "pack").mkdir()
        (repo / "pack" / "words.json").write_text(json.dumps(WORDS))
        if shipped_ids is not None:
            (repo / "pack" / "passages.json").write_text(json.dumps([{"id": i} for i in shipped_ids]))
        src = {"passages": [{"id": "p1", "lv": "A1", "title": "t", "sentences": [["Er sieht ein Taxi.", "He sees a taxi."]],
                             "oop": {}, "questions": []}]}
        (repo / "tools" / "passages_src.json").write_text(json.dumps(src, ensure_ascii=False))
        sp = get_spec("de", str(repo))
        sp.passage_post_resolve = lambda toks, out: out
        res = {"er": ("er", "PRON"), "sieht": ("sehen", "VERB"), "ein": ("ein", "DET"), "taxi": ("taxi", "PROPN")}
        ctx = {"lexicon": FakeLex(res), "groups": None, "truecase": (passages.Counter(), passages.Counter()),
               "words": WORDS}
        toks = [T("Er", "PRON"), T("sieht", "VERB"), T("ein", "DET"), T("Taxi", "NOUN"), T(".", "PUNCT")]
        out = io.StringIO()
        with mock.patch.object(passages, "load_context", lambda spec: ctx), \
                mock.patch.object(Linker, "pretag", lambda self, items: None), \
                mock.patch.object(Linker, "tag", lambda self, text, en="", names=frozenset(): toks), \
                mock.patch.object(Linker, "links", lambda self, toks, text, en, where=None: []):
            passages.run(sp, check_only=True, out=out)
        return out.getvalue()

    def test_shipped_passage_warns(self):
        o = self.run_pass(["p1"])
        self.assertIn("warning: p1: out-of-pack lemma without a reason: taxi", o)
        row = [x for x in o.splitlines() if x.startswith("p1 A1")][0]
        self.assertIn("oop={'taxi': 1}", row)      # still counted out of the pack
        self.assertNotIn("out-of-pack lemmas without a reason", row)

    def test_new_passage_is_an_error(self):
        o = self.run_pass(["p9"])
        self.assertIn("out-of-pack lemmas without a reason: ['taxi']", o)
        self.assertNotIn("warning:", o)


if __name__ == "__main__":
    unittest.main()
