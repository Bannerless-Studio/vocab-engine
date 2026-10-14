"""keep_live_sentences hooks: live_text matches a raw row to the shipped (text_norm) text, and a live story
row is kept but not ranked ahead of fresh candidates (a rebuild of a shipped pack is a fixed point). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_live_rank.py     (from vocab-engine/)
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.sentences import live_priority  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class LiveText(unittest.TestCase):
    def test_ur_live_text_applies_text_norm(self):
        with tempfile.TemporaryDirectory() as d:
            sp = get_spec("ur", Path(d))
            raw = "یہ میرے لئے ہے۔"                        # a raw لئے row; the live pack stores the text_norm spelling لیے
            self.assertEqual(sp.live_text(raw), "یہ میرے لیے ہے۔")
            self.assertNotEqual(sp.live_text(raw), raw)

    def test_default_live_text_is_clean_sentence_text(self):
        with tempfile.TemporaryDirectory() as d:
            sp = get_spec("de", Path(d))
            self.assertEqual(sp.live_text("  Das  ist gut. "), sp.clean_sentence_text("  Das  ist gut. "))


class LiveRank(unittest.TestCase):
    def test_live_story_rows_do_not_rank_as_live(self):
        live = {1, 2, 3}
        story = {2: "x", 9: "y"}
        self.assertEqual(live_priority(live, story), {1, 3})         # 2 is live and story: kept, unranked

    def test_without_story_rows_every_live_row_ranks(self):
        self.assertEqual(live_priority({1, 2}, {}), {1, 2})


if __name__ == "__main__":
    unittest.main()
