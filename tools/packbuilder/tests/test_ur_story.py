"""Urdu story row filters (langs/ur_story.py) on real Let's Read Asia sentence pairs. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_ur_story.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import ur_story as S  # noqa: E402

WORD = re.compile("[؀-ۿ‌]+")


def run(ur_page, en_page, glued=None):
    stats, seen = S.Stats(), set()
    story = {"text_pages": [{"text": ur_page}], "twin": {"text_pages": [{"text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats, glued=glued)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_equal_counts_pair_as_they_are(self):          # Naughty Dog (Pratham), page 2
        out, st = run("میں چینکو کی دیکھ بھال کرتا ہوں۔ آپ نے دیکھا نا کہ میں اُس سے بڑا ہوں۔",
                      "I have to look after Chinku. You see, I am older than him.")
        self.assertEqual([e for _, e, _ in out], ["You see, I am older than him."])    # Chinku is a character name
        self.assertEqual(st["story_name"], 1)

    def test_dangling_opener_dropped(self):                  # "He shouted ..." leans on the previous sentence
        out, st = run("وہ بچوں پر چلاتا ہے اگر وہ اونچی آواز میں بات کریں۔", "He shouted at the children if they talked loudly.")
        self.assertEqual(out, [])
        self.assertEqual(st["opener"], 1)

    def test_too_short_dropped(self):
        out, st = run("شیر دھاڑتا ہے۔", "A lion roars.")
        self.assertEqual(out, [])
        self.assertEqual(st["token_count"], 1)

    def test_markup_is_not_text(self):                       # <br/> between lines of one page
        out, st = run("ہم سب کچھ ساتھ کرتے ہیں۔<br/> ہم ہر کام ساتھ کرتے ہیں۔", "We do everything together.<br/> We work together.")
        self.assertEqual([u for u, _, _ in out], ["ہم سب کچھ ساتھ کرتے ہیں۔", "ہم ہر کام ساتھ کرتے ہیں۔"])

    def test_unaligned_page_drops_all(self):                 # 5 Urdu sentences vs 4 English that do not fit
        us = "دانت؟ ہا ہا! کیا آپ نے اپنے دانت دیکھے؟ تم چبا سکتے ہو۔ ہی۔"
        es = "Teeth? Ha! Ha! Have you seen our teeth? You can chew. But WE CAN BITE!"
        out, st = run(us, es)
        self.assertEqual(out, [])
        self.assertGreater(st["pair_alignment"], 0)

    def test_unbalanced_quote_is_a_fragment(self):
        out, st = run('"باہر دیکھو! ٹونی اور روبی ایک ساتھ چیخے۔', '"Look out!" Tito and Rika shouted together.')
        self.assertEqual(out, [])
        self.assertEqual(st["quotation_fragment"], 1)

    def test_glued_words_dropped(self):                      # the book lost its spaces: کےبازو
        out, st = run("آئیں اس کےبازو صاف کرتے ہیں۔", "Let's clean his arms.", glued=lambda t: t == "کےبازو")
        self.assertEqual(out, [])
        self.assertEqual(st["glued_words"], 1)

    def test_renamed_character_dropped(self):                # Urdu edition says وقاص, the English twin says Vinay
        out, st = run("سبز دروازہ وقاص کا پسندیدہ ہے۔ ہمارا دروازہ بالکل نیا ہے۔",
                      "The green gate is Vinay's favourite. Our gate is quite new.")
        self.assertEqual([e for _, e, _ in out], ["Our gate is quite new."])
        self.assertEqual(st["story_name"], 1)

    def test_duplicate_text_dropped(self):
        stats, seen = S.Stats(), set()
        story = {"text_pages": [{"text": "ہم ہر کام ساتھ کرتے ہیں۔"}] * 2, "twin": {"text_pages": [{"text": "We work together."}] * 2}}
        out = S.story_pairs(story, WORD, lambda s: s, seen, stats)
        self.assertEqual(len(out), 1)
        self.assertEqual(stats["duplicate"], 1)


if __name__ == "__main__":
    unittest.main()


class Rotated(unittest.TestCase):
    """The twin of one book can be another text (or the same text one page out): the story-level gates."""

    UR = ["کھانا کون لائے گا؟", "تحفہ کون دے گا؟", "زائرین کو کون سلام کرے گا؟", "ہمارے چہروں پر کون رنگ کرے گا؟"]
    EN = ["Who will bring food?", "Who will make a gift?", "Who will greet the visitors?", "Who will paint our faces?"]

    @staticmethod
    def story(ur, en, ur_first=1, en_first=1):
        return {"text_pages": [{"n": ur_first + i, "text": t} for i, t in enumerate(ur)],
                "twin": {"text_pages": [{"n": en_first + i, "text": t} for i, t in enumerate(en)]}}

    def test_title_page_on_one_side_only_rotates_the_pages(self):            # Visitors (Pratham): ur title page, same numbers
        ur = ["زائرین بلم کتب", "کل زائرین ہمارے اسکول آئیں گے۔ کلاس روم کون صاف کرے گا؟"] + self.UR
        en = ["Tomorrow visitors will come to our school. Who will clean the classroom?"] + self.EN
        self.assertEqual(S.page_shift(dict(enumerate(ur, 1)), dict(enumerate(en, 1))), -1)     # ur page n answers en page n-1

    def test_constant_page_offset_is_the_natural_pairing(self):             # twin pages start at 2: no cover text
        pages = {n: "x" * (40 + 9 * n) for n in range(1, 8)}
        twin = {n + 1: "y" * (50 + 9 * n) for n in range(1, 8)}
        self.assertEqual(S.page_shift(pages, twin), 1)

    def test_disagreeing_story_is_rejected_whole(self):
        story = self.story(self.UR, self.EN[1:] + self.EN[:1])             # same pages, rotated by one
        stats = S.Stats()

        class Checks:                       # glosses agree with nothing: the dictionary-backed gate says 0.1
            noun = staticmethod(lambda t: True)
            agree = staticmethod(lambda toks, en: True)
            wrong_sense = staticmethod(lambda toks, en: False)
            story_rate = staticmethod(lambda pairs: 0.1)
        out = S.story_pairs(story, WORD, lambda s: s, set(), stats, checks=Checks)
        self.assertEqual(out, [])
        self.assertEqual(stats["stories_rejected"], 1)

    def test_verse_pages_are_skipped(self):                                  # lines re-break across a rhymed translation
        verse = "<br/>".join(["a b c"] * 6)
        self.assertTrue(S.verse_page("جملہ ایک۔", verse))
        self.assertFalse(S.verse_page("میں پڑھ سکتی ہوں۔", "I can read."))

    def test_glued_speeches_are_a_fragment(self):                            # two openers in a row
        self.assertFalse(S._balanced('"دیکھیں امی۔ "میری بیٹی!'))
        self.assertTrue(S._balanced('"دیکھیں امی۔" اس نے کہا۔'))


class NounOpener(unittest.TestCase):
    def test_pronoun_opener_kept_when_a_noun_subject_follows(self):
        out, st = run("وہ بچے اسکول میں کھیلتے ہیں اور ہنستے ہیں۔", "They play at school and laugh.")
        self.assertEqual(st["opener"], 1)            # no noun check without a dictionary: dropped, as before
        stats = S.Stats()
        checks = type("C", (), {"noun": staticmethod(lambda t: t == "بچے"), "agree": staticmethod(lambda a, b: True),
                                "wrong_sense": staticmethod(lambda a, b: False), "story_rate": staticmethod(lambda p: None)})
        story = {"text_pages": [{"n": 1, "text": "وہ بچے اسکول میں کھیلتے ہیں اور ہنستے ہیں۔"}],
                 "twin": {"text_pages": [{"n": 1, "text": "They play at school and laugh."}]}}
        kept = S.story_pairs(story, WORD, lambda s: s, set(), stats, checks=checks)
        self.assertEqual(len(kept), 1)


class StrayPunctuation(unittest.TestCase):
    def test_quote_then_stop_moves_inside(self):
        self.assertEqual(S.norm_ur('اس نے کہا "آؤ" ۔'), 'اس نے کہا "آؤ۔"')

    def test_double_stop_collapses(self):
        self.assertEqual(S.norm_ur("تم کون ہو؟۔"), "تم کون ہو؟")


if __name__ == "__main__":
    unittest.main()
