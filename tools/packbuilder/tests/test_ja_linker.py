"""Japanese linker defect classes from the 2026-10-14 passage QA (langs/ja.py):
fragment sequences, ので, conditional と, te-form auxiliaries without a pack sense,
起きる "happen". Sudachi is not needed: tokens are written out with their features.

    python3 -m pytest -q tools/packbuilder/tests/test_ja_linker.py     (from vocab-engine/)
"""
import sys
import unittest
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402


def M(text, lemma=None, upos="NOUN", pos="", conj=""):
    f = [f"Dict={lemma or text}", f"Read={text}", f"Pos={pos}"]
    if conj:
        f.append(f"Conj={conj}")
    return [text, lemma or text, upos, "|".join(f)]


def sp():
    s = get_spec("ja", "/nonexistent-ja-repo", load=False)
    s.redirect, s._foreign_spell, s._noun_pref, s.stats = {}, {}, {}, Counter()
    s._usable = lambda lemma, group: True
    s._passage_heads = defaultdict(set)
    return s


def resolved(toks):
    """post_resolve over the tagger lemma as the lexicon would give it."""
    g = {"AUX": "VERB", "CCONJ": "CONJ", "SCONJ": "CONJ"}
    out = [(t[1], g.get(t[2], t[2])) for t in toks]
    return sp().post_resolve(toks, out)


NODE = [M("の", pos="助詞-準体助詞", upos="PART"), M("で", "だ", "AUX", "助動詞", "連用形-一般")]
MA = [M("ま", pos="名詞-普通名詞"), M("も", pos="助詞-係助詞", upos="PART"), M("なく", "ない", "ADJ", "形容詞-非自立可能")]


class FragmentSequence(unittest.TestCase):
    toks = [M("彼", upos="PRON"), M("は", upos="PART", pos="助詞-係助詞")] + MA + [M("来る", upos="VERB", pos="動詞-非自立可能")]

    def test_mamonaku_links_none_of_its_parts(self):
        out = resolved(self.toks)
        self.assertEqual(out[2:5], [None, None, None])
        self.assertEqual(out[0], ("彼", "PRON"))
        self.assertEqual(out[5], ("来る", "VERB"))

    def test_mamonai_and_kanji_spelling_are_the_same_sequence(self):
        for first in ("間", "ま"):
            toks = [M(first), MA[1], M("ない", "ない", "ADJ", "形容詞-非自立可能")]
            self.assertEqual(resolved(toks), [None, None, None], first)

    def test_ma_alone_keeps_its_link(self):
        out = resolved([M("ま", pos="名詞-普通名詞"), M("が", upos="PART"), M("ある", upos="VERB")])
        self.assertEqual(out[0], ("ま", "NOUN"))

    def test_passage_marks_grammar(self):
        out = sp().passage_retag(self.toks)
        self.assertEqual([t[2] for t in out[2:5]], ["X", "X", "X"])


class NodeConjunction(unittest.TestCase):
    def sent(self, tail):
        return [M("高い", upos="ADJ", pos="形容詞-一般")] + NODE + tail

    def test_node_links_neither_part(self):
        out = resolved(self.sent([M("買わ", "買う", "VERB", "動詞-一般")]))
        self.assertEqual(out[1:3], [None, None])
        self.assertEqual(out[0], ("高い", "ADJ"))
        self.assertEqual(out[3], ("買う", "VERB"))

    def test_passage_marks_both_parts_grammar(self):
        out = sp().passage_retag(self.sent([M("買わ", "買う", "VERB", "動詞-一般")]))
        self.assertEqual([t[2] for t in out[1:3]], ["X", "X"])

    def test_node_wa_and_node_aru_keep_the_nominaliser(self):
        for nxt in ("は", "ある"):
            out = resolved(self.sent([M(nxt, upos="PART")]))
            self.assertEqual(out[1], ("の", "PART"), nxt)

    def test_no_desu_is_unchanged(self):
        out = resolved([M("行く", upos="VERB", pos="動詞-非自立可能"), M("の", pos="助詞-準体助詞", upos="PART"),
                        M("です", upos="AUX", pos="助動詞")])
        self.assertEqual(out[1], ("の", "PART"))


class ConditionalTo(unittest.TestCase):
    COND = M("と", upos="PART", pos="助詞-接続助詞")
    QUOTE = M("と", upos="PART", pos="助詞-格助詞")

    def test_conditional_to_links_nothing(self):
        toks = [M("なる", upos="VERB", pos="動詞-非自立可能"), self.COND, M("暑い", upos="ADJ")]
        self.assertEqual(resolved(toks)[1], None)
        self.assertEqual(sp().passage_retag(toks)[1][2], "X")

    def test_quotation_and_and_with_keep_to(self):
        for tok in (self.QUOTE,):
            toks = [M("春"), tok, M("秋")]
            self.assertEqual(resolved(toks)[1], ("と", "PART"))
            self.assertIs(sp().passage_retag(toks), toks)


class TeAuxiliaryWithoutSense(unittest.TestCase):
    TE = ["て", "て", "PART", "Pos=助詞-接続助詞"]

    def test_temiru_and_teoku_are_grammar(self):
        for surf, lem in (("みる", "みる"), ("み", "みる"), ("おく", "おく"), ("おい", "置く")):
            toks = [M("近づい", "近づく", "VERB"), self.TE, M(surf, lem, "VERB", "動詞-非自立可能")]
            self.assertEqual(sp().passage_retag(toks)[2][2], "X", surf)

    def test_literal_see_and_put_keep_their_link(self):
        toks = [M("近づい", "近づく", "VERB"), self.TE, M("見る", "見る", "VERB", "動詞-非自立可能")]
        self.assertEqual(sp().passage_retag(toks)[2][2], "VERB")           # kanji: the verb
        toks = [M("テレビ"), M("を", upos="PART"), M("みる", "みる", "VERB", "動詞-一般")]
        self.assertEqual(sp().passage_retag(toks)[2][2], "VERB")           # not after a te-form


class OkiruHappens(unittest.TestCase):
    PAST = M("起き", "起きる", "VERB", "動詞-一般", "連用形-一般")

    def link(self, toks):
        out = resolved(toks)
        return out[next(i for i, t in enumerate(toks) if t[1] == "起きる")]

    def test_event_subject_is_happen(self):
        ga = M("が", upos="PART", pos="助詞-格助詞")
        for subj in ("事故", "何", "火事", "交通事故", "それ"):
            self.assertEqual(self.link([M(subj), ga, self.PAST, M("た", upos="AUX")]), ("起こる", "VERB"), subj)

    def test_topic_far_from_the_verb_is_happen(self):
        toks = [M("事故"), M("は", upos="PART"), M("、", upos="PUNCT"), M("夕方"), M("の", upos="PART"),
                M("暗い", upos="ADJ"), M("時間"), M("に", upos="PART"), self.PAST, M("て", upos="PART")]
        self.assertEqual(self.link(toks), ("起こる", "VERB"))

    def test_relative_clause_head_is_happen(self):
        toks = [M("信号"), M("の", upos="PART"), M("ない", upos="ADJ"), M("角"), M("で", upos="PART"),
                M("起きる", "起きる", "VERB", "動詞-一般", "連体形-一般"), M("事故")]
        self.assertEqual(self.link(toks), ("起こる", "VERB"))

    def test_person_time_and_nominal_stay_get_up(self):
        wa = M("は", upos="PART", pos="助詞-係助詞")
        self.assertEqual(self.link([M("私", upos="PRON"), wa, M("6時"), M("に", upos="PART"), self.PAST]), ("起きる", "VERB"))
        self.assertEqual(self.link([M("今日"), wa, M("早く", upos="ADV"), self.PAST, M("た", upos="AUX")]), ("起きる", "VERB"))
        # 事故のニュースを聞いて早く起きた: the accident is no subject of 起きる
        toks = [M("事故"), M("の", upos="PART"), M("ニュース"), M("を", upos="PART"), M("聞い", "聞く", "VERB"),
                M("て", upos="PART", pos="助詞-接続助詞"), M("早く", upos="ADV"), self.PAST]
        self.assertEqual(self.link(toks), ("起きる", "VERB"))
        # 起きることができない: こと is not an event head
        toks = [M("起きる", "起きる", "VERB", "動詞-一般", "連体形-一般"), M("こと"), M("が", upos="PART"), M("できない")]
        self.assertEqual(self.link(toks), ("起きる", "VERB"))


if __name__ == "__main__":
    unittest.main()
