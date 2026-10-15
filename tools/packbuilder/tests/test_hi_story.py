"""Hindi story row filters (hi_story.py) on real Bloom Library sentence pairs. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_hi_story.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import hi_story as S  # noqa: E402

WORD = re.compile("[ऀ-ॣॱ-ॿ]+")


def run(hi_page, en_page, checks=None, en_lower=frozenset()):
    stats, seen = S.A.Stats(), set()
    story = {"text_pages": [{"n": 1, "text": hi_page}], "twin": {"text_pages": [{"n": 1, "text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats, en_lower=en_lower, checks=checks)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_equal_counts_pair_as_they_are(self):          # "I can help" (Pratham), page 2
        out, st = run("स्कूल के बाद मुझे भाई को खाना खिलाना अच्छा लगता है। उसे भी अच्छा लगता है।",
                      "After school I like to feed my brother. He likes it too.")
        self.assertEqual([u for u, _, _ in out], ["स्कूल के बाद मुझे भाई को खाना खिलाना अच्छा लगता है।"])
        self.assertEqual(st["opener"], 1)                   # "उसे भी ..." leans on the previous sentence

    def test_short_sentence_dropped(self):                  # two tokens
        out, st = run("चूड़ियाँ गोल हैं।", "Bangles are round.")
        self.assertEqual(len(out), 1)
        out, st = run("मीठा है।", "It is sweet.")
        self.assertEqual(out, [])
        self.assertEqual(st["token_count"], 1)

    def test_full_stop_becomes_danda(self):
        self.assertEqual(S.norm_hi("मैं अब बड़ी हो गयी हूँ ."), "मैं अब बड़ी हो गयी हूँ।")
        self.assertEqual(S.norm_hi("“आप कहाँ हैं?” वह बोली."), '"आप कहाँ हैं?" वह बोली।')

    def test_latin_or_digits_dropped(self):
        out, st = run("मैं 5 आम खाता हूँ।", "I eat five mangoes.")
        self.assertEqual(out, [])
        self.assertEqual(st["foreign_chars"], 1)

    def test_unbalanced_quotes_merge_into_one_long_row(self):   # Appu, page 3: an opening quote typed for a closing one
        out, st = run("“बहुत, बहुत दूर से, अमेरिका से। अधिक सटीक रूप से, मेक्सिको से, “अजार उचू ने उत्तर दिया।",
                      "“From very, very far, from the Americas. More precisely, from Mexico,” Ajar Uchu answered.")
        self.assertEqual(out, [])
        self.assertEqual(st["token_count"], 1)


class Names(unittest.TestCase):
    def test_translit(self):
        from packbuilder.langs.hi import translit
        self.assertTrue(S.translit_ok(translit("अप्पू"), "Appu"))
        self.assertTrue(S.translit_ok(translit("मेक्सिको"), "Mexico"))
        self.assertFalse(S.translit_ok(translit("गैंडा"), "Appu"))

    def test_english_names(self):
        self.assertEqual(S.english_names("Appu ran to Ma and Mexico."), ["Mexico"])
        self.assertEqual(S.english_names("Then Appu ran.", frozenset({"then"})), ["Appu"])

    def test_bible_tag(self):
        self.assertTrue(S.is_bible({"raw": {"tags": ["topic:Bible"]}}))
        self.assertTrue(S.is_bible({"credits": "Open Bible Stories"}))
        self.assertFalse(S.is_bible({"credits": "Pratham Books", "all_titles": {"en": "I can help"}}))


if __name__ == "__main__":
    unittest.main()
