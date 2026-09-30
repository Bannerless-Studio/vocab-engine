"""Korean spoken 것 spelled 거/꺼 with particles after a modifier form
(langs/ko.py geo_after_modifier): 않다는 거는 is 것 + 는, not 걸다's modifier
"hanging". Without a modifier before it the analyser's reading stands (벽에
거는 그림 = 걸다), and 걸어 keeps its 걷다/걸다 homograph routing. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_ko_geo.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs.ko import geo_after_modifier  # noqa: E402


def V(text, lemma, g="VERB"):
    return [text, lemma, g, f"Ko=verb|G={g}|X=pvg"]


def N(text, lemma=None):
    return [text, lemma or text, "NOUN", "Ko=noun+p|G=NOUN|X=ncn"]


def P(text, key):
    return [text, key, "X", "Ko=noun+p|G=PART|X=ncn"]


def links(out):
    return [(t[0], t[1]) for t in out]


class GeoAfterModifier(unittest.TestCase):
    def test_geo_plus_topic_after_quotative_modifier(self):
        out = geo_after_modifier([V("않다는", "않다"), V("거는", "걸다"), ["저", "저", "PRON", "Ko=closed|G=PRON|X=npp"],
                                  P("도", "-도")])
        self.assertEqual(links(out)[:3], [("않다는", "않다"), ("거", "것"), ("는", "-은/는")])
        self.assertEqual(out[1][2], "NOUN")
        self.assertEqual(out[2][2], "X")

    def test_every_particle_and_modifier_ending(self):
        for mod, geo, parts in (("하는", "거를", [("를", "-을/를")]), ("할", "거도", [("도", "-도")]),
                                ("먹던", "거만", [("만", "-만")]), ("예쁜", "거는", [("는", "-은/는")]),
                                ("본", "꺼는", [("는", "-은/는")])):
            with self.subTest(geo=geo):
                g = "ADJ" if mod == "예쁜" else "VERB"
                out = geo_after_modifier([V(mod, "x다", g), V(geo, "걸다")])
                self.assertEqual(links(out)[1:], [(geo[0], "것")] + parts)

    def test_no_modifier_before_keeps_the_verb(self):
        toks = [N("벽"), P("에", "-에"), V("거는", "걸다"), N("그림")]
        self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)

    def test_sentence_start_and_after_punctuation_keep_the_verb(self):
        toks = [V("거는", "걸다"), N("사람")]
        self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)
        toks = [V("하는", "하다"), [",", ",", "PUNCT", ""], V("거는", "걸다")]
        self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)

    def test_walk_and_hang_homographs_untouched(self):
        for lem in ("걷다", "걸다"):
            toks = [N("학교"), P("에", "-에"), V("걸어", lem)]
            self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)
        # 걸어 after a modifier is no 거 + particle chain: never rewritten
        toks = [V("할", "하다"), V("걸어", "걷다")]
        self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)

    def test_dictionary_words_spelled_geo_stay(self):
        # 여긴 거의 눈이 안 와: 거의 "almost" is the adverb whatever precedes it
        toks = [V("여긴", "여기다"), ["거의", "거의", "ADV", "Ko=exact|G=ADV|X=mag"], N("눈")]
        self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)

    def test_connective_before_is_not_a_modifier(self):
        toks = [V("하고", "하다"), V("거는", "걸다")]
        self.assertEqual(geo_after_modifier([list(t) for t in toks]), toks)


if __name__ == "__main__":
    unittest.main()
