"""live_ranks_first, the refill probe, decide_words and the story-aware dead-entry check
(docs/PACKBUILDER_HOOKS.md "story_rows"). Stdlib only.

    python3 -m unittest packbuilder.tests.test_story_live     (from tools/)
"""
import json
import sys
import unittest
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core import pipeline  # noqa: E402
from packbuilder.core import sentences as SE  # noqa: E402
from packbuilder.langs.base import LanguageSpec  # noqa: E402
from packbuilder.qa import check  # noqa: E402
from packbuilder.tests.test_story_rows import PANE, build  # noqa: E402


def with_live(live_texts, ranks_first):
    def setup(sp):
        sp.keep_live_sentences = True
        sp.live_ranks_first = ranks_first
        (Path(sp.repo) / "pack").mkdir(exist_ok=True)
        (Path(sp.repo) / "pack" / "sentences.json").write_text(
            json.dumps([{"id": f"s{i + 1}", "t": t} for i, t in enumerate(live_texts)]), encoding="utf-8")
    return setup


def pane_count(out):
    return sum(1 for s in out.values() if "w_pane" in s["words"])


class LiveRanksFirst(unittest.TestCase):
    def setUp(self):
        self.base, _ = build(PANE, [])
        self.live = next(t for t in PANE if t not in self.base)      # a shipped sentence a fresh build would not pick

    def test_default_is_true_and_sw_is_false(self):
        from packbuilder.langs import get_spec
        self.assertTrue(LanguageSpec.live_ranks_first)
        self.assertFalse(get_spec("sw", None, load=False).live_ranks_first)

    def test_true_live_sentence_takes_a_slot(self):
        out, _ = build(PANE, [], setup=with_live([self.live], True))
        self.assertIn(self.live, out)
        self.assertEqual(pane_count(out), 2)
        self.assertNotEqual(set(out), set(self.base))

    def test_false_fresh_candidates_keep_their_slots_and_live_returns_via_keep_live(self):
        out, _ = build(PANE, [], setup=with_live([self.live], False))
        self.assertEqual(set(out), set(self.base) | {self.live})      # same picks as a build without live, plus the live one
        self.assertEqual(pane_count(out), 3)

    def test_false_never_loses_a_live_sentence(self):
        for live in PANE:
            out, _ = build(PANE, [], setup=with_live([live], False))
            self.assertIn(live, out)

    def test_decide_words_ignores_live_even_when_ranking_first(self):
        for first in (True, False):
            out, _ = build(PANE, [], setup=with_live([self.live], first), decide=True)
            self.assertEqual(set(out), set(self.base))


class RefillProbe(unittest.TestCase):
    def run_finish(self, ranks_first, story_rows, refill=True):
        calls = []

        def fake(env, ctx, words, top3000, decide_words=False):
            calls.append((decide_words, bool(ctx.get("story_rows")), bool(ctx.get("story_tagged"))))
            return [], [], {}
        sp = SimpleNamespace(refill_unexampled=refill, live_ranks_first=ranks_first, level_ids=["A1"], gloss_overrides={},
                             finalize_words=lambda *a: None, drop_keys={})
        ctx = {"story_rows": story_rows, "story_tagged": [1] if story_rows else []}
        with mock.patch.object(pipeline, "build_sentences", fake), mock.patch.object(pipeline, "split_alt_forms"):
            pipeline.finish_words(SimpleNamespace(spec=sp), ctx, [], {}, set())
        return calls

    def test_probe_fires_without_story_rows_when_live_does_not_rank_first(self):
        self.assertEqual(self.run_finish(False, {}), [(False, False, False), (True, False, False)])

    def test_probe_fires_with_story_rows_and_is_stripped_of_them(self):
        self.assertEqual(self.run_finish(True, {1: []}), [(False, True, True), (True, False, False)])

    def test_no_probe_for_a_plain_language(self):
        self.assertEqual(self.run_finish(True, {}), [(False, False, False)])

    def test_no_probe_without_refill(self):
        self.assertEqual(self.run_finish(False, {1: []}, refill=False), [(False, True, True)])


class DeadEntries(unittest.TestCase):
    def dead(self, listed, corpus, story):
        spec = SimpleNamespace(bad_sentences=set(listed), bad_sentence_norm=lambda t: " ".join(t.split()),
                               story_rows=lambda env: [[1, t, "", "en", None, "S"] for t in story])
        with mock.patch("packbuilder.core.sources.corpus_path", lambda env: Path(__file__)), \
                mock.patch("packbuilder.core.sources.stage_corpus", lambda env: {"rows": [[1, t] for t in corpus]}), \
                mock.patch("packbuilder.core.util.Env", lambda s: SimpleNamespace(spec=s)):
            return check.bad_sentences_dead(spec)

    def test_entry_matching_only_a_story_row_is_not_dead(self):
        self.assertEqual(self.dead({"Story only."}, ["Corpus row."], ["Story only."]), [])

    def test_entry_matching_nothing_is_dead(self):
        self.assertEqual(self.dead({"Story only.", "Typo."}, ["Corpus row."], ["Story only."]), ["Typo."])

    def test_corpus_match_still_counts(self):
        self.assertEqual(self.dead({"Corpus row."}, ["Corpus row."], []), [])


if __name__ == "__main__":
    unittest.main()
