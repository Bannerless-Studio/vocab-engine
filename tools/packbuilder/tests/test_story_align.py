"""Shared story alignment (core/story_align.py): page pairing, ratio, aligner, generic drop rules for two languages. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_story_align.py     (from vocab-engine/)
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import sw_story, ur_story  # noqa: E402
from packbuilder.core import story_align as A  # noqa: E402

SW_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")


def sw_run(pages_sw, pages_en, checks=None, seen=None):
    stats = A.Stats()
    story = {"text_pages": [{"n": n, "text": t} for n, t in pages_sw.items()],
             "twin": {"text_pages": [{"n": n, "text": t} for n, t in pages_en.items()]}}
    return sw_story.story_pairs(story, SW_WORD, lambda s: s, seen if seen is not None else set(), stats, checks=checks), stats


class Split(unittest.TestCase):
    def test_abbreviation_does_not_end_a_sentence(self):
        self.assertEqual(A.split_target(sw_story.SW, "Alisema Bw. Juma ameondoka. Sawa."), ["Alisema Bw. Juma ameondoka.", "Sawa."])

    def test_ur_split_has_no_abbrev_rule(self):
        self.assertIsNone(ur_story.UR.abbrev)

    def test_balanced_quotes_merge(self):
        self.assertEqual(A.split_en('He said, "Go. Now." Then he left.'), ['He said, "Go. Now."', "Then he left."])


class Align(unittest.TestCase):
    def test_equal_counts_ratio_gate(self):
        out = A.align_page(sw_story.SW, ["Mamba ana meno makali."], ["A crocodile has sharp teeth."])
        self.assertEqual(out, [("Mamba ana meno makali.", "A crocodile has sharp teeth.")])
        self.assertEqual(A.align_page(sw_story.SW, ["Ndiyo."], ["Yes, of course, I would like to come with you."]), [None])

    def test_one_merge_allowed_two_drop_the_page(self):
        us = ["Nyuta zake ni za rangi rangi.", "Ni jumba safi lakini ndani kuna kimya."]
        es = ["The walls are colourful, and it is clean and quiet inside."]
        self.assertEqual(A.align_page(sw_story.SW, us, es), [(" ".join(us), es[0])])
        self.assertIsNone(A.align_page(sw_story.SW, us + us, es))


class PageShift(unittest.TestCase):
    def test_pages_paired_by_number_not_position(self):      # the twin has a text-only cover on page 0
        out, st = sw_run({1: "Mamba ana meno makali.", 2: "Simba pia ana meno makali."},
                         {0: "What type of teeth?", 1: "A crocodile has sharp teeth.", 2: "A lion also has sharp teeth."})
        self.assertEqual([e for _, e, _ in out], ["A crocodile has sharp teeth.", "A lion also has sharp teeth."])


class SwahiliRows(unittest.TestCase):                 # real African Storybook pairs (Meno aina gani?, Ajali mbaya, Aku rafiki ya Jua)
    def test_kept_pair(self):
        out, st = sw_run({1: "Mamba ana meno makali."}, {1: "A crocodile has sharp teeth."})
        self.assertEqual(out, [("Mamba ana meno makali.", "A crocodile has sharp teeth.", 1)])
        self.assertEqual(st["kept"], 1)

    def test_merged_page_pair_kept_as_one_row(self):
        out, _ = sw_run({1: "Watoto walioga na kuvaa tayari kwenda shuleni."}, {1: "Children bathed and dressed, ready to go to school."})
        self.assertEqual(len(out), 1)

    def test_dangling_english_opener_dropped(self):
        out, st = sw_run({1: "Alikuwa mgonjwa sana siku hiyo."}, {1: "He was very sick that day."})
        self.assertEqual(out, [])
        self.assertEqual(st["opener"], 1)

    def test_connective_opener_dropped(self):
        out, st = sw_run({1: "Lakini hakuna mtu aliyemsikia mtoto."}, {1: "Yet nobody listened to the child."})
        self.assertEqual(out, [])
        self.assertEqual(st["opener"], 1)

    def test_name_rename_is_the_specs_call(self):          # Lucia / Lucy: sw.py checks.renamed decides; no checks, no name filter
        class Ck:
            noun = staticmethod(lambda t: False)
            wrong_sense = staticmethod(lambda toks, en: False)
            story_rate = staticmethod(lambda pairs: None)
            agree_pair = staticmethod(lambda u, e: True)
            renamed = staticmethod(lambda u, e: "Lucia" in u and "Lucia" not in e)
        out, st = sw_run({1: "Pamoja na Lucia, watoto walienda kutafuta matunda."}, {1: "Together with Lucy, the children went to pick fruit."}, Ck)
        self.assertEqual((out, st["story_name"]), ([], 1))
        out, st = sw_run({1: "Pamoja na Lucia, watoto walienda kutafuta matunda."}, {1: "Together with Lucy, the children went to pick fruit."})
        self.assertEqual((len(out), st["story_name"]), (1, 0))

    def test_too_short_and_digits_dropped(self):
        out, st = sw_run({1: "Simba anaunguruma."}, {1: "A lion roars."})
        self.assertEqual(st["token_count"], 1)
        out, st = sw_run({1: "Nina miaka 10 sasa hivi."}, {1: "I am 10 years old now."})
        self.assertEqual(st["foreign_chars"], 1)

    def test_agree_gate_drops_another_sentence(self):      # Ajali mbaya p4: the Swahili edition says something else
        class Ck:
            noun = staticmethod(lambda t: False)
            wrong_sense = staticmethod(lambda toks, en: False)
            story_rate = staticmethod(lambda pairs: None)
            agree_pair = staticmethod(lambda u, e: "careful" in e)
        out, st = sw_run({1: "Dereva wa lori hakuwa mwangalifu."}, {1: "The truck driver was talking on his mobile phone."}, Ck)
        self.assertEqual(out, [])
        self.assertEqual(st["no_agreement"], 1)

    def test_duplicate_of_pack_sentence(self):
        out, st = sw_run({1: "Mamba ana meno makali."}, {1: "A crocodile has sharp teeth."}, seen={"Mamba ana meno makali."})
        self.assertEqual(out, [])
        self.assertEqual(st["duplicate"], 1)


class CreditParsing(unittest.TestCase):
    def test_names_and_holder(self):
        self.assertEqual(sw_story.names_of(["Zanele Buthelezi, Thembani Dladla and Clare Verbeek"]),
                         ["Zanele Buthelezi", "Thembani Dladla", "Clare Verbeek"])
        self.assertEqual(sw_story.holder("© School of Education and Development (Ukzn) and African Storybook Initiative 2007\nCreative Commons: Attribution 4.0"),
                         "School of Education and Development (Ukzn) and African Storybook Initiative 2007")

    def test_gloss_stems_share_ur_stemmer(self):
        self.assertEqual(A.gloss_stems("to love; (like) children"), {"love", "child"})


class KeepLive(unittest.TestCase):
    def test_same_text_in_two_corpora_is_added_once(self):     # sw "Je hiyo inamaanisha nini?" lives in Tatoeba and GlobalVoices
        from collections import Counter
        from packbuilder.core import sentences as SE
        info = {1: (4, False, False, "A1", ["w1"]), 2: (4, False, False, "A1", ["w2"]), 3: (4, False, False, "A1", ["w3"])}
        text = {1: "a", 2: "a", 3: "b"}
        primary, st = {}, Counter()
        SE.keep_live(primary, {1, 2, 3}, info, st, text.get)
        self.assertEqual(sorted(primary), [1, 3])
        self.assertEqual(st["live_sentences_duplicate_text_skipped"], 1)
        primary2 = {1: "w1"}
        SE.keep_live(primary2, {1, 2, 3}, info, Counter(), text.get)
        self.assertEqual(sorted(primary2), [1, 3])


if __name__ == "__main__":
    unittest.main()
