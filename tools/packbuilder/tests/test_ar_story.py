"""Arabic story row filters (ar_story.py) on real African Storybook Arabic sentence pairs. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_ar_story.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import ar_story as S  # noqa: E402

WORD = re.compile("[ء-يٱ-ۓ]+")


def run(ar_page, en_page):
    stats, seen = S.A.Stats(), set()
    story = {"text_pages": [{"n": 1, "text": ar_page}], "twin": {"text_pages": [{"n": 1, "text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_plain_pair_kept(self):                         # ASb 21813, "My village had many problems"
        out, st = run("كان لقريتي العديد من المشاكل.", "My village had many problems.")
        self.assertEqual([(u, e) for u, e, _ in out], [("كان لقريتي العديد من المشاكل.", "My village had many problems.")])
        self.assertEqual(st["kept"], 1)

    def test_missing_page_stop_added_from_the_english(self):  # ASb 18190 pages carry no stop
        out, st = run("النار تزودنا بالضوء", "Fire gives light.")
        self.assertEqual([u for u, _, _ in out], ["النار تزودنا بالضوء."])
        self.assertEqual(st["stop_added"], 1)

    def test_leading_mark_moved_to_the_end(self):           # ASb 18190 page 1 is typed "!انظر إلى النار."
        out, _ = run("!انظر إلى النار.", "Look, fire!")
        self.assertEqual([u for u, _, _ in out], ["انظر إلى النار!"])

    def test_comma_and_conjunction_spacing(self):           # ASb 21823 "زيادة ،لأنه", 21813 "و استمعوا"
        self.assertEqual(S.norm_ar("دفع الكلب زيادة ،لأنه لم يكن يعرف المبلغ المطلوب."), "دفع الكلب زيادة، لأنه لم يكن يعرف المبلغ المطلوب.")
        self.assertEqual(S.norm_ar("اجتمع الناس تحت الشجرة الكبيرة و استمعوا."), "اجتمع الناس تحت الشجرة الكبيرة واستمعوا.")

    def test_harakat_and_tatweel_removed(self):             # Bloom books carry vowel marks
        self.assertEqual(S.norm_ar("كَانَ جَدُّ سَليم يَقُولُ دَائِمَاً"), "كان جد سليم يقول دائما")

    def test_two_english_sentences_one_arabic(self):        # ASb 21829 page 5: the Arabic edition joins the two
        out, st = run("وفجأة انتبهن إلى أن الوقت قد تأخر بهن فأسرعن بالعودة إلى القرية.",
                      "Suddenly, they realised that it was late. They hurried back to the village.")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0][1], "Suddenly, they realised that it was late. They hurried back to the village.")

    def test_broken_character_dropped(self):                # ASb 18190 page 2 "النار تحر�"
        out, st = run("النار تحر�.", "Fire burns.")
        self.assertEqual(out, [])
        self.assertEqual(st["foreign_chars"], 1)


class DialectTable(unittest.TestCase):
    def test_every_form_drops_a_sentence(self):
        self.assertGreaterEqual(len(S.DIALECT_FORMS), 50)
        for f in sorted(S.DIALECT_FORMS):
            self.assertTrue(S.dialect_sentence(f"ذهب الولد مع {f} إلى المدرسة الكبيرة.", WORD), f)

    def test_dialect_pair_counted_and_not_kept(self):
        out, st = run("ذهب الولد كده إلى المدرسة الكبيرة.", "The boy went like this to the big school.")
        self.assertEqual(out, [])
        self.assertEqual(st["dialect_form"], 1)
        self.assertEqual(st["kept"], 0)

    def test_progressive_ayn_phrase(self):
        self.assertTrue(S.dialect_sentence("الولد عم يلعب في الحديقة الكبيرة.", WORD))
        self.assertFalse(S.dialect_sentence("ذهب عم الولد إلى الحديقة الكبيرة.", WORD))      # عم "paternal uncle"

    def test_msa_homographs_stay(self):                     # هما "they two", بكرة, كمان "violin" are MSA words
        for w in ("هما", "بكرة", "كمان", "هون"):
            self.assertFalse(S.dialect_sentence(f"ذهب {w} إلى المدرسة الكبيرة.", WORD), w)


if __name__ == "__main__":
    unittest.main()
