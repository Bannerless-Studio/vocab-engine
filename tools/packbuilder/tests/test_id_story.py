"""Indonesian story row filters (id_story.py) on real Let's Read Asia / Bloom Library sentence pairs. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_story.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import id_story as S  # noqa: E402

WORD = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]+")


def run(id_page, en_page, checks=None):
    stats, seen = S.A.Stats(), set()
    story = {"text_pages": [{"n": 1, "text": id_page}], "twin": {"text_pages": [{"n": 1, "text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats, checks=checks)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_equal_counts_pair_as_they_are(self):          # Pratham, "Drake the Magical Dragon"
        out, st = run("Kasihan, si Drake mulai menangis! Apa dia bisa berhasil dan membuat ibunya bangga?",
                      "Poor Drake began to cry! Would he ever succeed and make his mother proud?")
        self.assertEqual([e for _, e, _ in out], ["Poor Drake began to cry!", "Would he ever succeed and make his mother proud?"])
        self.assertEqual(st["kept"], 2)             # names_kept: the Indonesian keeps Drake, so no rename drop

    def test_dangling_opener_dropped(self):                  # "Dan" + English "And"
        out, st = run("Dan itu membuat ibu naga SANGAT bangga.", "And this made mother dragon VERY proud.")
        self.assertEqual(out, [])
        self.assertEqual(st["opener"], 1)

    def test_too_short_dropped(self):
        out, st = run("Singa itu mengaum.", "The lion roars.")     # 3 tokens kept; 2 dropped
        self.assertEqual(len(out), 1)
        out, st = run("Singa mengaum.", "A lion roars.")
        self.assertEqual(out, [])
        self.assertEqual(st["token_count"], 1)

    def test_agreement_gate_drops_another_sentence(self):    # a pair whose words' glosses never show up in the English
        class C:
            noun = staticmethod(lambda t: False)
            wrong_sense = staticmethod(lambda toks, en: False)
            renamed = staticmethod(lambda u, e: False)
            agree_pair = staticmethod(lambda u, e: "elephant" in e.lower())
            story_rate = staticmethod(lambda pairs: 1.0)
        out, st = run("Pak Kepala Sekolah pun duduk di bangku.", "Headmaster Elephant settled down on a bench.", C)
        self.assertEqual(len(out), 1)
        out, st = run("Tempat tidurku naik ke dinding.", "Soil covers the roots.", C)
        self.assertEqual(out, [])
        self.assertEqual(st["no_agreement"], 1)

    def test_split_keeps_abbreviation_and_quote(self):
        self.assertEqual(S.A.split_target(S.ID, 'Gurunya berkata, "Kita harus mengerjakan soal-soal ini dulu." Lalu kami pulang.'),
                         ['Gurunya berkata, "Kita harus mengerjakan soal-soal ini dulu."', "Lalu kami pulang."])
        self.assertEqual(S.A.split_target(S.ID, "Bpk. Budi tiba. Kami senang."), ["Bpk. Budi tiba.", "Kami senang."])


class Helpers(unittest.TestCase):
    def test_bible_series_left_out(self):
        self.assertTrue(S.is_bible({"raw": {"tags": ["topic:Bible", "computedLevel:4"]}}))
        self.assertTrue(S.is_bible({"raw": {}, "credits": 'derivative of "Creative Commons Open Bible Stories" unfoldingWord'}))
        self.assertFalse(S.is_bible({"raw": {"tags": ["topic:Health"]}, "credits": ""}))

    def test_holder_and_names(self):
        self.assertEqual(S.holder("Copyright © 2023, Elisabet Lali Suluh dan Karel No"), "Elisabet Lali Suluh dan Karel No")
        self.assertEqual(S.names_of(["Natasha Sharma & Ruchi Shah"]), ["Natasha Sharma", "Ruchi Shah"])


if __name__ == "__main__":
    unittest.main()
