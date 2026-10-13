"""Id maps are read and written through one key function each, so a rebuild from the committed map gives
every unchanged word and sentence its own id back (core/words.py id_key, ids_for_keys, persist_ids;
core/sentence_ids.py assign, verify). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_roundtrip.py     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from packbuilder.core import sentence_ids as si  # noqa: E402
from packbuilder.core.words import assign_ids, persist_ids  # noqa: E402

NUKTA = "़"


def build_words(spec_rows, idmap):
    """One build: (build lemma, build pos) -> assign_ids -> finishing pass -> the shipped list and its lookup keys."""
    words = [{"lemma": lem, "pos": pos, "final": (fl, fp)} for lem, pos, fl, fp in spec_rows]
    assign_ids(words, idmap)
    shipped = [{"id": w["id"], "lemma": w["final"][0], "pos": w["final"][1]} for w in words]
    return shipped, [w["_idkey"] for w in words]


class WordFixtures(unittest.TestCase):
    def rebuild(self, rows, mapfile):
        idmap = json.loads(mapfile.read_text()) if mapfile.exists() else {}
        shipped, keys = build_words(rows, idmap)
        persist_ids(mapfile, shipped, keys)
        return {s["lemma"] + "|" + s["pos"]: s["id"] for s in shipped}

    def test_folding_language_fresh_word_keeps_its_id(self):
        # hi: the build folds the nukta (तारीफ), the finishing pass ships it (तारीफ़); the id map used to be read
        # folded and written unfolded, so every rebuild minted another id for the word
        rows = [("बात", "noun", "बात", "noun"), ("तारीफ", "noun", "तारीफ" + NUKTA, "noun")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "id_map_v1.json"
            p.write_text(json.dumps({"बात|noun": "w0001"}))
            first = self.rebuild(rows, p)
            self.assertEqual(first, {"बात|noun": "w0001", "तारीफ" + NUKTA + "|noun": "w0002"})
            for _ in range(2):
                self.assertEqual(self.rebuild(rows, p), first)
            saved = json.loads(p.read_text())
            self.assertEqual(saved["तारीफ" + NUKTA + "|noun"], "w0002")    # keyed by the shipped text
            self.assertEqual(saved["तारीफ|noun"], "w0002")                 # and by the key the build looks up

    def test_pos_changed_by_a_finishing_pass(self):
        rows = [("た", "verb", "た", "aux"), ("見る", "verb", "見る", "verb")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "id_map_v1.json"
            first = self.rebuild(rows, p)
            self.assertEqual(first, {"た|aux": "w0001", "見る|verb": "w0002"})
            self.assertEqual(self.rebuild(rows, p), first)
            self.assertEqual(self.rebuild(list(reversed(rows)), p), first)

    def test_old_map_keyed_by_build_lemma_still_matches(self):
        rows = [("jahr", "noun", "Jahr", "noun")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "id_map_v1.json"
            p.write_text(json.dumps({"jahr|noun": "w0079"}))
            self.assertEqual(self.rebuild(rows, p), {"Jahr|noun": "w0079"})
            self.assertEqual(json.loads(p.read_text()), {"Jahr|noun": "w0079", "jahr|noun": "w0079"})

    def test_two_words_with_one_build_key_fail_loudly(self):
        rows = [("a", "noun", "a", "noun"), ("a", "noun", "A", "noun")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "id_map_v1.json"
            shipped, keys = build_words(rows, {})
            with self.assertRaises(ValueError):
                persist_ids(p, shipped, keys)
            self.assertFalse(p.exists())


class SentenceFixtures(unittest.TestCase):
    def test_finishing_pass_text_is_the_key(self):
        from packbuilder.langs.fa import display_sentence
        built = ["كتاب مي روم .", "سلام"]                      # Arabic kaf / yeh, a detached می
        final = [display_sentence(t) for t in built]
        self.assertNotEqual(built, final)
        ids, issued, st = si.assign(final, {}, legacy=built)
        self.assertEqual(si.verify(final, ids, issued, built), [])
        ids2, issued2, st2 = si.assign(final, issued, legacy=built)
        self.assertEqual((ids2, st2["new"]), (ids, []))
        self.assertEqual(issued2, issued)
        self.assertEqual(list(issued.values()), final)

    def test_map_written_with_build_text_is_kept_and_rekeyed(self):
        final, built = ["a\u200c.", "b."], ["a.", "b."]
        legacy_map = {"s0001": "a.", "s0002": "b."}
        ids, issued, st = si.assign(final, legacy_map, legacy=built)
        self.assertEqual(ids, ["s0001", "s0002"])
        self.assertEqual((st["new"], st["rekeyed"]), ([], 1))
        self.assertEqual(issued, {"s0001": "a\u200c.", "s0002": "b."})
        ids2, _, st2 = si.assign(final, issued, legacy=built)
        self.assertEqual((ids2, st2["rekeyed"]), (ids, 0))

    def test_rekey_skipped_when_shipped_text_already_held(self):
        final, built = ["a\u200c."], ["a."]
        stale = {"s0001": "a.", "s0002": "a\u200c."}
        ids, issued, st = si.assign(final, stale, legacy=built)
        self.assertEqual((ids, st["rekeyed"]), (["s0001"], 0))
        self.assertEqual(issued, stale)
        self.assertEqual(si.verify(final, ids, issued, built), [])

    def test_ids_order_numerically_past_four_digits(self):
        ids, issued, _ = si.assign(["x"], {"s9999": "y", "s10000": "x"})
        self.assertEqual(ids, ["s10000"])
        with tempfile.TemporaryDirectory() as d:
            si.save(Path(d) / "m.json", {"s10000": "x", "s9999": "y"})
            self.assertEqual(list(si.load(Path(d) / "m.json")), ["s9999", "s10000"])

    def test_map_of_shipped_texts_needs_no_legacy(self):
        # the bootstrap from a live pack: shipped texts only
        ids, issued, st = si.assign(["a\u200c.", "b."], {"s0001": "a\u200c.", "s0002": "b."}, legacy=["a.", "b."])
        self.assertEqual((ids, st["new"], st["rekeyed"]), (["s0001", "s0002"], [], 0))

    def test_two_sentences_finishing_to_one_text_keep_their_own_ids(self):
        # persian s0203 / s0523: Arabic-yeh and Persian-yeh sources of one shipped text, the later one listed first
        final, built = ["T", "T"], ["T", "T1"]
        hand_fixed = {"s0203": "T1", "s0523": "T"}
        ids, issued, st = si.assign(final, hand_fixed, legacy=built)
        self.assertEqual((ids, st["new"]), (["s0523", "s0203"], []))
        self.assertEqual(issued, hand_fixed)         # kept: the earlier text is what tells the pair apart
        self.assertEqual(si.assign(final, issued, legacy=built)[0], ids)
        self.assertEqual(si.verify(final, ids, issued, built), [])

    def test_exact_text_still_claims_without_legacy(self):
        ids, issued, st = si.assign(["x", "y"], {"s0001": "y", "s0002": "x"}, legacy=["x", "y"])
        self.assertEqual((ids, st["rekeyed"]), (["s0002", "s0001"], 0))

    def test_verify_catches_text_changed_after_assign(self):
        ids, issued, _ = si.assign(["a", "b"], {})
        self.assertEqual(si.verify(["a", "b!"], ids, issued), [ids[1]])

    def test_verify_with_repeated_text(self):
        ids, issued, _ = si.assign(["a", "a"], {})
        self.assertEqual(si.verify(["a", "a"], ids, issued), [])


if __name__ == "__main__":
    unittest.main()
