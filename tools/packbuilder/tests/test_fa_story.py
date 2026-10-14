"""Persian story row filters (fa_story.py) on real Let's Read Asia Dari sentence pairs. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_fa_story.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import fa_story as S  # noqa: E402

WORD = re.compile("[؀-ۿ‌]+")


def run(fa_page, en_page):
    stats, seen = S.Stats(), set()
    story = {"text_pages": [{"n": 1, "text": fa_page}], "twin": {"text_pages": [{"n": 1, "text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_plain_pair_kept(self):                          # "Let's Count Legs"-style reader, page 2
        out, st = run("من یک دختر بزرگ هستم.", "I'm a big girl.")
        self.assertEqual([(u, e) for u, e, _ in out], [("من یک دختر بزرگ هستم.", "I'm a big girl.")])
        self.assertEqual(st["kept"], 1)

    def test_missing_page_stop_added_from_the_english(self):  # the Dari text of "Fish Face" has no final stop; the English has "?"
        out, st = run("آیا آنها با نوک پا برای یافتن خوردنی دور خانه می‌گردند", "Do they tiptoe around the house looking for a treat?")
        self.assertEqual([u for u, _, _ in out], ["آیا آنها با نوک پا برای یافتن خوردنی دور خانه می‌گردند؟"])
        self.assertEqual(st["stop_added"], 1)

    def test_direction_marks_removed(self):                  # a page that starts with U+200E
        out, _ = run("‎شما دوباره خوب میشوید!", "You will be well⁠ again!".replace("⁠", ""))
        self.assertEqual([u for u, _, _ in out], ["شما دوباره خوب میشوید!"])

    def test_dari_copula_dropped(self):                      # استی is Dari, Iranian هستی
        out, st = run("تو به اندازه کافی بزرگ استی تا با من صبح قدم بزنی.", "You are just big enough to take me for my morning walks.")
        self.assertEqual(out, [])
        self.assertEqual(st["dari_form"], 1)

    def test_names_transliterate_or_rename(self):
        self.assertTrue(S.name_matches("Bo", "بو"))             # Bo ran outside / بو بطرف بیرون دوید
        self.assertTrue(S.name_matches("Rinky", "رینکی"))
        self.assertFalse(S.name_matches("Rajani", "رویا"))      # the Dari edition renamed Rajani to Roya
        self.assertEqual(S.english_names("Bo ran outside.", {"ran"}), ["Bo"])
        self.assertEqual(S.english_names("The cow walks.", {"the", "cow"}), [])


class DariClasses(unittest.TestCase):
    FORMS = "استم استی استیم استید استند مه موتر دوکان صنف مکتب افتید".split()

    def test_all_eleven_forms(self):
        self.assertEqual(len(self.FORMS), len(S.DARI_FORMS))
        for f in self.FORMS:
            self.assertTrue(S.dari_token(f), f)
            self.assertTrue(S.dari_sentence(f"گاو با {f} خوب در خانه بزرگ بود.", WORD), f)
        out, st = run("گاو با مکتب خوب در خانه بزرگ بود.", "The cow was good at home with school.")
        self.assertEqual((out, st["dari_form"]), ([], 1))

    def test_clitic_forms_and_homographs(self):
        for t in ("مکتبش", "موترها", "دوکان\u200cش", "صنفی"):
            self.assertTrue(S.dari_token(t), t)
        self.assertFalse(S.dari_token("مهمان"))             # starts with مه, is Iranian
        self.assertFalse(S.dari_token("مهی"))               # copula/pronoun forms take no suffix

    def test_participle_potential(self):                   # s3089, s3126 of the first build
        for u, e in (("او چطور در یک زمان هم بسیار بزرگ و هم بسیار کوچک بوده می\u200cتواند؟", "How can she be too big and too small all at once?"),
                     ("اما پر هایش رنگ روشن دارد و به زودی پیدا شده می\u200cتواند.", "But his feathers are so bright that spotting him is easy.")):
            self.assertTrue(S.dari_sentence(u, WORD), u)
        self.assertFalse(S.dari_sentence("او می\u200cتواند کتاب بخواند.", WORD))


class SpecHooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import json
        import tempfile
        from packbuilder.langs.fa import Persian
        cls.tmp = tempfile.TemporaryDirectory()
        repo = Path(cls.tmp.name)
        (repo / "pack").mkdir()
        (repo / "pack" / "words.json").write_text(json.dumps([{"w": "کرگدن", "pos": "noun", "en": "rhinoceros"}]), encoding="utf-8")
        cls.sp = Persian()

        class Env:
            pass
        cls.env = Env()
        cls.env.repo = repo

    def test_zwnj_matching(self):                         # a list line copied from the pack matches the raw story row
        raw, shown = "او می روم خانه", "او می\u200cروم خانه"
        self.assertEqual(self.sp.bad_sentence_norm(raw), self.sp.bad_sentence_norm(shown))
        self.assertEqual(self.sp.live_text(raw), shown)

    def test_renamed(self):
        ck = self.sp._story_checks(self.env)
        self.sp._story_en_lower = frozenset({"ran"})
        self.assertFalse(ck.renamed("بو بیرون دوید.", "Bo ran outside."))            # transliterated
        self.assertTrue(ck.renamed("رویا دوید.", "Rajani ran."))        # renamed by the edition
        self.assertFalse(ck.renamed("کرگدن نشست.", "Rhino sat down."))                # translated through a pack gloss


if __name__ == "__main__":
    unittest.main()
