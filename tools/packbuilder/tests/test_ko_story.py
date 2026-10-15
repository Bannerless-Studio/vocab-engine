"""Korean story row filters (ko_story.py) on real Storybooks Korea / Global Digital Library sentence pairs, and the spec's
cache reader (licence rule, credits). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_ko_story.py     (from vocab-engine/)
"""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import ko_story as S  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402

WORD = re.compile(r"[가-힣A-Za-z]+")


def run(ko_page, en_page, checks=None):
    stats, seen = S.A.Stats(), set()
    story = {"text_pages": [{"n": 1, "text": ko_page}], "twin": {"text_pages": [{"n": 1, "text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats, checks=checks)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_equal_counts_pair_as_they_are(self):          # Storybooks Korea 0302, "Fire" (African Storybook)
        out, st = run("불은 요리도 해요. 불은 따뜻하게 해줘요.", "Fire cooks. Fire gives warmth.")
        self.assertEqual([e for _, e, _ in out], ["Fire cooks.", "Fire gives warmth."])
        self.assertEqual(st["kept"], 2)

    def test_dangling_opener_dropped(self):                # "그리고" + English "And"
        out, st = run("그리고 강하지요.", "And it is powerful.")
        self.assertEqual(out, [])
        self.assertEqual(st["opener"], 1)

    def test_glued_bound_noun_dropped(self):               # 탈때: 때 run into the verb
        out, st = run("그 나무는 탈때 특히 연기를 많이 내기로 알려져 있었어요.", "This wood was especially known to make lots of smoke while it burned.")
        self.assertEqual(out, [])
        self.assertEqual(st["glued_words"], 1)

    def test_glued_classifier_and_misspelling_dropped(self):   # 남자두명, 됬고
        out, st = run("그는 다른 남자두명과 방을 쓰게 되었습니다.", "He shared the room with two other boys.")
        self.assertEqual(st["glued_words"], 1)
        out, st = run("읽을 때마다 새로운 걸 배우게 됬고 지식은 커져갔답니다!", "She learned something new each day and her knowledge grew!")
        self.assertEqual(st["glued_words"], 1)

    def test_glued_whitelist(self):
        self.assertFalse(S.glued_ko("한때"))
        self.assertFalse(S.glued_ko("갈수록"))
        self.assertFalse(S.glued_ko("읽어주지"))             # a spaced or attached -어 auxiliary are both standard
        self.assertTrue(S.glued_ko("먹고있었어요"))
        self.assertTrue(S.glued_ko("하는것은"))

    def test_latin_in_korean_dropped(self):                # bilingual Let's Read page: an English line inside the Korean
        out, st = run("Cat and Dog play soccer.", "Cat and Dog play soccer.")
        self.assertEqual(out, [])
        self.assertEqual(st["foreign_chars"], 1)

    def test_agreement_gate_drops_another_sentence(self):
        class C:
            noun = staticmethod(lambda t: False)
            wrong_sense = staticmethod(lambda toks, en: False)
            renamed = staticmethod(lambda u, e: False)
            agree_pair = staticmethod(lambda u, e: "lion" in e.lower())
            story_rate = staticmethod(lambda pairs: 1.0)
        out, st = run("사자도 물을 마시고 싶어한다.", "The lion wants to drink too.", C)
        self.assertEqual(len(out), 1)
        out, st = run("여자는 바나나를 사요.", "The woman is reading a book.", C)
        self.assertEqual(out, [])
        self.assertEqual(st["no_agreement"], 1)

    def test_one_token_too_short(self):
        out, st = run("안녕하세요!", "Hello!")
        self.assertEqual(out, [])
        self.assertEqual(st["token_count"], 1)

    def test_split_keeps_quote_with_sentence(self):
        us = S.A.split_target(S.KO, '엄마가 "너는 내 아침 별이야," 라고 말해요. 나는 대단해요!')
        self.assertEqual(us, ['엄마가 "너는 내 아침 별이야," 라고 말해요.', "나는 대단해요!"])


class Spec(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        for d, recs in {"ko-gsb": [self.rec("gsb", "0001", "cc-by", "3.0"), self.rec("gsb", "0002", "cc-by-nc", "3.0")],
                        "ko-gdl": [self.rec("gdl", "42416", "cc-by", "4.0", mismatch=True)]}.items():
            (self.repo / ".cache" / "stories" / d).mkdir(parents=True)
            for r in recs:
                (self.repo / ".cache" / "stories" / d / f"{r['id']}.json").write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
        self.sp = get_spec("ko")
        self.sp._story_cache = None
        self.env = SimpleNamespace(repo=self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def rec(source, sid, lic, ver, mismatch=False):
        tw = {"id": "en-" + sid, "title": "A very tall man", "licence": lic if not mismatch else "cc-by", "licence_version": ver if not mismatch else "3.0",
              "url": "https://example.org/en", "text_pages": [{"n": 2, "text": "His hoe was too short."}]}
        return {"id": sid, "source": source, "status": "ok", "title": "아주 키가 큰 아저씨", "licence": lic, "licence_version": ver,
                "url": "https://example.org/ko", "authors": ["Cornelius Gulere"], "illustrators": ["Catherine Groenewald"],
                "translators": ["Michelle Kim"], "source_story": {"title": "A very tall man", "url": "https://africanstorybook.org/reader.php?id=918"},
                "publisher": "National Library Board, Singapore", "credit_text": "Original Story Three Gifts. Contributing translators: Sonya Sondakh and Neysa Putri Ardianti",
                "text_pages": [{"n": 2, "text": "아저씨의 괭이는 너무 짧았어요."}], "twin": tw}

    def test_licence_rule_fails_closed(self):
        self.sp._story_cache = None
        got = self.sp._stories(self.env)
        self.assertEqual(sorted(got), ["gsb-0001"])         # BY-NC rejected; a book whose twin states another licence version rejected

    def test_story_meta_carries_credits_and_licence(self):
        self.sp._story_cache = None
        m = self.sp.story_meta(self.env, "gsb-0001")
        self.assertEqual((m["licence"], m["translators"], m["original_url"]), ("CC-BY-3.0", ["Michelle Kim"], "https://africanstorybook.org/reader.php?id=918"))

    def test_gdl_translators_from_credit_page(self):
        self.assertEqual(S.contributing_translators("... Contributing translators: Sonya Sondakh and Neysa Putri Ardianti"),
                         ["Sonya Sondakh", "Neysa Putri Ardianti"])


if __name__ == "__main__":
    unittest.main()
