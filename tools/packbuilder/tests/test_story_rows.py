"""spec.story_rows (docs/PACKBUILDER_HOOKS.md): default hook, story row tagging
in sentence choice, spec.examples_per_word cap (picks past 2 are story
sentences only), the story sort key, and the story attribution check. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_story_rows.py     (from vocab-engine/)
"""
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.pipeline import passage_stories, story_attribution, story_ids  # noqa: E402
from packbuilder.core.sentences import build_sentences  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs.base import STORY_SID_BASE  # noqa: E402
from packbuilder.qa.check import passage_story_errors, story_attribution_errors  # noqa: E402
from packbuilder.tests.test_sentence_spans import READ, WORDS, Lexicon, tokens  # noqa: E402

PANE = ["Compro il pane grande.", "Compra il pane grande.", "Mangio il pane grande.", "Mangia il pane grande.",
        "Compro il pane e la mela.", "Mangio il pane e la mela."]


def toks_of(text):
    return tokens(text.rstrip(".").split() + ["."])


def build(plain, story, epw=2, live=None, wid="w_pane", setup=None, decide=False):
    """plain/story: texts; returns (records by text, spec)."""
    tmp = Path(tempfile.mkdtemp())
    sp = get_spec("it", tmp)
    sp.examples_per_word = epw
    if setup:
        setup(sp)
    words = [{"id": i_wid, "_key": (lem, g), "lemma": lem, "w": lem, "en": lem, "pos": g.lower(), "lv": "A1",
              "rank": i, "_sidx": i} for i, (lem, g, i_wid) in enumerate(WORDS) if i_wid == wid]
    tagged = tmp / "tagged.jsonl.gz"
    rows, srows, stagged = {}, {}, []
    with gzip.open(tagged, "wt", encoding="utf-8") as f:
        for i, t in enumerate(plain):
            rows[i + 1] = [i + 1, t, "u", "en", None, None]
            f.write(json.dumps([i + 1, toks_of(t)]) + "\n")
    for i, t in enumerate(story):
        sid = STORY_SID_BASE + i
        srows[sid] = [sid, t, "", "en", None, f"S{i % 2}"]
        stagged.append([sid, toks_of(t)])
    ctx = {"lexicon": Lexicon(sp), "lemma_groups": {}, "tagged": tagged, "rows_by_sid": rows,
           "story_rows": srows, "story_tagged": stagged}
    sents, _, _ = build_sentences(SimpleNamespace(spec=sp), ctx, words, {w[0] for w in WORDS}, decide_words=decide)
    return {s["t"]: s for s in sents}, sp


class Hook(unittest.TestCase):
    def test_default_is_empty(self):
        self.assertEqual(get_spec("it", None, load=False).story_rows(SimpleNamespace(repo=Path("."))), [])

    def test_default_cap_is_two_and_base_hooks_are_inert(self):
        sp = get_spec("de", None, load=False)
        self.assertEqual(sp.examples_per_word, 2)
        self.assertEqual((sp.story_source(), sp.story_credit(), sp.story_meta(None, "9")), ({}, None, {"id": "9"}))

    def test_sid_base_above_example_base(self):
        from packbuilder.langs.base import EXAMPLE_SID_BASE
        self.assertGreater(STORY_SID_BASE, EXAMPLE_SID_BASE)


class Tagging(unittest.TestCase):
    def test_story_sentence_ships_tagged_with_its_story(self):
        out, _ = build(PANE[:2], ["Compro il pane grande e la mela."])
        story = [s for s in out.values() if s.get("src") == "story"]
        self.assertEqual([(s["t"], s["st"]) for s in story], [("Compro il pane grande e la mela.", "S0")])
        self.assertTrue(all("src" not in s for s in out.values() if s.get("src") != "story"))

    def test_no_story_rows_no_fields(self):
        out, _ = build(PANE, [])
        self.assertTrue(all("src" not in s and "st" not in s for s in out.values()))

    def test_story_row_is_filtered_like_a_corpus_row(self):
        # no terminal punctuation: same drop as any corpus row
        out, _ = build(PANE[:2], ["Compro il pane grande"])
        self.assertFalse(any(s.get("src") == "story" for s in out.values()))


class Cap(unittest.TestCase):
    STORY = [f"{v} il pane {a}." for v in ("Compro", "Mangio", "Compra", "Mangia", "Compro")
             for a in ("grande",)] + ["Mangio il pane e la mela.", "Compra il pane e la mela."]

    def count(self, out, wid):
        return sum(1 for s in out.values() if wid in s["words"])

    def test_cap_two_without_story_headroom(self):
        out, _ = build(PANE, list(dict.fromkeys(self.STORY)), epw=2)
        self.assertEqual(self.count(out, "w_pane"), 2)
        self.assertTrue(all(s.get("src") == "story" for s in out.values()))

    def test_word_without_story_rows_stays_at_two(self):
        out, sp = build(PANE, [], epw=4)
        owners = [s for s in out.values() if "w_pane" in s["words"]]
        self.assertEqual(len(owners), 2)

    def test_story_sentences_raise_the_cap(self):
        story = list(dict.fromkeys(self.STORY))
        out2, _ = build(PANE, story, epw=2)
        out4, _ = build(PANE, story, epw=4)
        n2 = len([s for s in out2.values() if "w_pane" in s["words"]])
        n4 = len([s for s in out4.values() if "w_pane" in s["words"]])
        self.assertEqual(n2, 2)
        self.assertEqual(n4, 4)
        extra = {t for t in out4 if t not in out2}
        self.assertTrue(extra and all(out4[t].get("src") == "story" for t in extra))

    def test_cap_never_above_n(self):
        story = list(dict.fromkeys(self.STORY))
        out, _ = build(PANE, story, epw=3)
        self.assertEqual(len([s for s in out.values() if "w_pane" in s["words"]]), 3)


class Sorting(unittest.TestCase):
    def test_story_beats_corpus_sentence_at_equal_fit(self):
        out, _ = build(["Compro il pane grande.", "Compra il pane grande."],
                       ["Mangio il pane grande.", "Mangia il pane grande."], epw=2)
        self.assertEqual(sorted(out), ["Mangia il pane grande.", "Mangio il pane grande."])

    def test_without_story_rows_corpus_picks_are_the_same_two_as_before(self):
        out, _ = build(PANE, [], epw=2)
        self.assertEqual(len(out), 2)


class EqualFit(Sorting):
    MELA = dict(wid="w_mela", epw=2)

    def prefer_hw(self, sp):
        sp.prefer_headword_sentence = True

    def test_story_with_worse_headword_tier_loses_to_clean_corpus_sentence(self):
        # mele is not the headword mela: tier 2 vs tier 0
        out, _ = build(["Compro la mela grande."], ["Compro le mele grandi."], setup=self.prefer_hw, **self.MELA)
        self.assertEqual(sorted(out), ["Compro la mela grande.", "Compro le mele grandi."])
        out, _ = build(["Compro la mela grande.", "Mangio la mela grande."], ["Compro le mele grandi."],
                       setup=self.prefer_hw, **self.MELA)
        self.assertEqual(sorted(out), ["Compro la mela grande.", "Mangio la mela grande."])

    def test_story_with_worse_rank_penalty_loses(self):
        def pen(sp):
            sp.sentence_rank = lambda toks, lv: 3 if any(t[0] == "grandi" for t in toks) else 0
        out, _ = build(["Compro la mela grande.", "Mangio la mela grande."], ["Compro le mele grandi."],
                       setup=pen, **self.MELA)
        self.assertNotIn("Compro le mele grandi.", out)

    def test_exact_tie_goes_to_story(self):
        out, _ = build(["Compro la mela grande.", "Mangio la mela grande."], ["Compra la mela grande."],
                       setup=self.prefer_hw, **self.MELA)
        self.assertIn("Compra la mela grande.", out)
        self.assertEqual(len(out), 2)


class CheckIntegration(unittest.TestCase):
    def run_check(self, attribution):
        import contextlib
        import io
        from packbuilder.qa.check import check
        tmp = Path(tempfile.mkdtemp())
        (tmp / "pack").mkdir()
        (tmp / "pack" / "pack.json").write_text("{}")
        (tmp / "pack" / "words.json").write_text("[]")
        (tmp / "pack" / "sentences.json").write_text(json.dumps(
            [{"id": "s1", "t": "x.", "en": "x", "lv": "A1", "words": [], "src": "story", "st": "7"}]))
        (tmp / "pack" / "attribution.json").write_text(json.dumps(attribution))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            check(get_spec("it", tmp))
        return buf.getvalue()

    def test_missing_attribution_entry_fails(self):
        out = self.run_check({"story_sentences": {"count": 1, "stories": []}})
        self.assertIn("story 7: sentence ships but story is not in attribution", out)

    def test_attribution_without_shipped_sentence_fails(self):
        out = self.run_check({"story_sentences": {"count": 1, "stories": [{"id": "7"}, {"id": "8"}]}})
        self.assertIn("story 8: in attribution", out)

    def test_consistent_attribution_adds_no_story_failure(self):
        out = self.run_check({"story_sentences": {"count": 1, "stories": [{"id": "7"}]}})
        self.assertNotIn("story", out.replace("story_sentences", ""))


class Overrides(unittest.TestCase):
    def test_extra_attribution_cannot_replace_story_sentences(self):
        from packbuilder.core.pipeline import attribution
        sp = get_spec("it", None, load=False)
        sp.extra_attribution = lambda env, sents: {"story_sentences": {"count": 99}}
        env = SimpleNamespace(spec=sp)
        sp.sources = {sp.subtitles_file: "", sp.kaikki_file: "", sp.sentences_file: ""}
        sp.story_source = lambda: {"source": "X"}
        from unittest import mock
        with mock.patch("packbuilder.core.pipeline.audio_recorders", lambda e, s: {}):
            attr = attribution(env, {}, [], [{"id": "a", "src": "story", "st": "7"}])
        self.assertEqual(attr["story_sentences"]["count"], 1)

    def test_sid_collision_asserts(self):
        with self.assertRaises(AssertionError):
            self._collide()

    def _collide(self):
        import packbuilder.tests.test_story_rows as m
        orig = m.STORY_SID_BASE
        m.STORY_SID_BASE = 1
        try:
            build(["Compro il pane grande."], ["Mangio il pane grande."])
        finally:
            m.STORY_SID_BASE = orig


class Attribution(unittest.TestCase):
    S = [{"id": "a", "src": "story", "st": "7"}, {"id": "b", "src": "story", "st": "8"}, {"id": "c"}]
    OK = {"story_sentences": {"count": 2, "stories": [{"id": "7"}, {"id": "8"}]}}

    def test_pass(self):
        self.assertEqual(story_attribution_errors(self.S, self.OK), [])
        self.assertEqual(story_attribution_errors([{"id": "c"}], {}), [])

    def test_story_missing_from_attribution(self):
        bad = {"story_sentences": {"count": 2, "stories": [{"id": "7"}]}}
        self.assertTrue(any("story 8" in e for e in story_attribution_errors(self.S, bad)))

    def test_attribution_lists_story_without_sentence(self):
        bad = {"story_sentences": {"count": 2, "stories": [{"id": "7"}, {"id": "8"}, {"id": "9"}]}}
        self.assertTrue(any("story 9" in e for e in story_attribution_errors(self.S, bad)))

    def test_count_mismatch_and_missing_block_and_missing_st(self):
        bad = {"story_sentences": {"count": 5, "stories": [{"id": "7"}, {"id": "8"}]}}
        self.assertTrue(any("count" in e for e in story_attribution_errors(self.S, bad)))
        self.assertTrue(story_attribution_errors(self.S, {}))
        self.assertTrue(any("without st" in e for e in story_attribution_errors([{"id": "x", "src": "story"}], self.OK)))

    def test_build_block_from_shipped_sentences(self):
        env = SimpleNamespace(spec=get_spec("it", None, load=False))
        env.spec.story_source = lambda: {"source": "X", "licence": "CC-BY-4.0"}
        blk = story_attribution(env, self.S)["story_sentences"]
        self.assertEqual((blk["count"], [s["id"] for s in blk["stories"]], blk["source"]), (2, ["7", "8"], "X"))
        self.assertEqual(story_attribution(env, [{"id": "c"}]), {})
        self.assertEqual(story_ids(self.S), ["7", "8"])
        self.assertEqual(story_attribution_errors(self.S, {"story_sentences": blk}), [])


class PassageStories(unittest.TestCase):
    P = [{"id": "p1", "src": "story", "st": "7"}, {"id": "p2", "src": "story", "st": "7"}, {"id": "p3", "src": "gen"}]
    OK = {"story_passages": {"count": 2, "stories": [{"id": "7"}]}}

    def test_check(self):
        self.assertEqual(passage_story_errors(self.P, self.OK), [])
        self.assertEqual(passage_story_errors([{"id": "p3", "src": "gen"}], {}), [])
        self.assertTrue(passage_story_errors(self.P, {}))
        self.assertTrue(any("story 7" in e for e in passage_story_errors(self.P, {"story_passages": {"count": 2, "stories": []}})))
        self.assertTrue(any("story 9" in e for e in passage_story_errors(self.P, {"story_passages": {"count": 2, "stories": [{"id": "7"}, {"id": "9"}]}})))
        self.assertTrue(any("count" in e for e in passage_story_errors(self.P, {"story_passages": {"count": 1, "stories": [{"id": "7"}]}})))
        self.assertTrue(any("without st" in e for e in passage_story_errors([{"id": "x", "src": "story"}], self.OK)))

    def test_build_block_from_passages_src(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "tools").mkdir()
            src = {"passages": [{"id": "p1", "story": {"id": "9", "title": "B"}},
                                {"id": "p2", "story": {"id": "7", "title": "A"}},
                                {"id": "p3", "story": {"id": "7", "title": "A"}}, {"id": "p4"}]}
            (Path(d) / "tools" / "passages_src.json").write_text(json.dumps(src))
            env = SimpleNamespace(spec=SimpleNamespace(repo=d, story_source=lambda: {}))
            blk = story_attribution(env, [])["story_passages"]
            self.assertEqual((blk["count"], [s["id"] for s in blk["stories"]]), (3, ["7", "9"]))
            self.assertNotIn("story_sentences", story_attribution(env, []))
            self.assertEqual(list(passage_stories(env)), ["7", "9"])
            self.assertEqual(passage_story_errors([{"id": "p", "src": "story", "st": "7"}] * 3 + [{"id": "q", "src": "story", "st": "9"}],
                                                  {"story_passages": {**blk, "count": 4}}), [])


if __name__ == "__main__":
    unittest.main()
