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
        out, st = run("میں سائیکل چلانا پسند کرتا ہوں۔<br/> میں اوپر چڑھنا پسند کرتا ہوں۔", "I like cycling.<br/> I like climbing.")
        self.assertEqual([u for u, _, _ in out], ["میں سائیکل چلانا پسند کرتا ہوں۔", "میں اوپر چڑھنا پسند کرتا ہوں۔"])

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
