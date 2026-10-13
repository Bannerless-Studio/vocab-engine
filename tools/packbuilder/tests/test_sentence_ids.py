"""Text-stable sentence ids (core/sentence_ids.py) and the pack_diff_guard sentence id rule.
Ids are opaque keys: learner records key on them, so a rebuild moves none. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_sentence_ids.py     (from vocab-engine/)
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from packbuilder.core import sentence_ids as si  # noqa: E402

GUARD = ROOT / "tools" / "round" / "pack_diff_guard.py"


class Assign(unittest.TestCase):
    def test_same_text_keeps_id_after_reorder(self):
        issued = {"s0001": "a.", "s0002": "b.", "s0003": "c."}
        ids, out, st = si.assign(["c.", "a.", "b."], issued)
        self.assertEqual(ids, ["s0003", "s0001", "s0002"])
        self.assertEqual(out, issued)
        self.assertEqual(st["new"], [])

    def test_new_text_gets_id_above_retired(self):
        issued = {"s0001": "a.", "s0002": "gone.", "s0003": "c."}
        ids, out, st = si.assign(["a.", "c.", "new."], issued)
        self.assertEqual(ids, ["s0001", "s0003", "s0004"])
        self.assertEqual(st["retired"], ["s0002"])
        self.assertIn("s0002", out)

    def test_retired_id_never_reissued_and_text_reclaims(self):
        issued = {"s0001": "a.", "s0002": "b."}
        _, out, _ = si.assign(["a.", "z."], issued)
        self.assertEqual(out["s0003"], "z.")
        ids, _, st = si.assign(["a.", "b."], out)
        self.assertEqual(ids, ["s0001", "s0002"])
        self.assertEqual(st["new"], [])

    def test_duplicate_text_distinct_ids_in_order(self):
        issued = {"s0001": "x.", "s0002": "x."}
        ids, _, _ = si.assign(["x.", "x."], issued)
        self.assertEqual(ids, ["s0001", "s0002"])
        ids, out, _ = si.assign(["x.", "x.", "x."], issued)
        self.assertEqual(ids, ["s0001", "s0002", "s0003"])
        self.assertEqual(len(set(ids)), 3)

    def test_idempotent_through_save_load(self):
        texts = ["é.", "b.", "é."]
        ids, out, _ = si.assign(texts, {})
        self.assertEqual(ids, ["s0001", "s0002", "s0003"])
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.json"
            si.save(p, out)
            first = p.read_text(encoding="utf-8")
            ids2, out2, st = si.assign(texts, si.load(p))
            si.save(p, out2)
            self.assertEqual(ids2, ids)
            self.assertEqual(p.read_text(encoding="utf-8"), first)
            self.assertEqual(st["new"], [])

    def test_changed_text_new_id(self):
        ids, out, st = si.assign(["a!"], {"s0001": "a."})
        self.assertEqual(ids, ["s0002"])
        self.assertEqual(st["retired"], ["s0001"])

    def test_bootstrap_identity_on_live_pack(self):
        live = [{"id": "s0007", "t": "p."}, {"id": "s0003", "t": "q."}]
        issued = si.bootstrap(live)
        ids, _, st = si.assign(["p.", "q."], issued)
        self.assertEqual(ids, ["s0007", "s0003"])
        self.assertEqual(st["new"], [])
        _, _, st2 = si.assign(["r."], issued)
        self.assertEqual(st2["new"], ["s0008"])

    def test_bootstrap_conflict_raises(self):
        with self.assertRaises(ValueError):
            si.bootstrap([{"id": "s0001", "t": "b."}], {"s0001": "a."})

    def test_ids_are_opaque_keys_not_positions(self):
        ids, _, _ = si.assign(["b.", "a."], {"s0042": "a.", "s0009": "b."})
        self.assertEqual(ids, ["s0009", "s0042"])


class Guard(unittest.TestCase):
    def run_guard(self, prev, now):
        with tempfile.TemporaryDirectory() as d:
            def git(*a):
                subprocess.run(["git", "-C", d, *a], check=True, capture_output=True)
            git("init", "-q")
            git("config", "user.email", "t@t")
            git("config", "user.name", "t")
            (Path(d) / "pack").mkdir()
            (Path(d) / "pack" / "sentences.json").write_text(json.dumps(prev))
            git("add", ".")
            git("commit", "-qm", "prev")
            (Path(d) / "pack" / "sentences.json").write_text(json.dumps(now))
            p = subprocess.run([sys.executable, str(GUARD), "--repo", d, "--prev", "HEAD"], capture_output=True, text=True)
            return p.returncode, p.stdout

    def rows(self, *pairs):
        return [{"id": i, "t": t, "en": "x", "words": []} for i, t in pairs]

    def test_text_change_fails(self):
        rc, out = self.run_guard(self.rows(("s1", "a.")), self.rows(("s1", "b.")))
        self.assertEqual(rc, 1)
        self.assertIn("text changed", out)

    def test_disappeared_id_fails(self):
        rc, out = self.run_guard(self.rows(("s1", "a."), ("s2", "b.")), self.rows(("s2", "b."), ("s3", "a.")))
        self.assertEqual(rc, 1)
        self.assertIn("disappeared", out)

    def test_duplicate_id_fails(self):
        rc, out = self.run_guard(self.rows(("s1", "a.")), self.rows(("s1", "a."), ("s1", "a.")))
        self.assertEqual(rc, 1)
        self.assertIn("duplicate", out)

    def test_relink_and_new_text_ok(self):
        prev = self.rows(("s1", "a."))
        now = [{"id": "s1", "t": "a.", "en": "y", "words": ["w1"]}, {"id": "s2", "t": "n.", "en": "z", "words": []}]
        rc, out = self.run_guard(prev, now)
        self.assertEqual(rc, 0, out)

    def test_reorder_ok(self):
        rc, out = self.run_guard(self.rows(("s1", "a."), ("s2", "b.")), self.rows(("s2", "b."), ("s1", "a.")))
        self.assertEqual(rc, 0, out)


class WordIdMap(unittest.TestCase):
    def test_persist_adds_only_missing_and_never_reuses(self):
        from packbuilder.core.words import persist_ids
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "id_map_v1.json"
            p.write_text(json.dumps({"a|noun": "w0001"}))
            words = [{"lemma": "a", "pos": "noun", "id": "w0009"}, {"lemma": "b", "pos": "noun", "id": "w0002"},
                     {"lemma": "c", "pos": "verb", "id": "w0001"}]
            self.assertEqual(persist_ids(p, words), 1)
            self.assertEqual(json.loads(p.read_text()), {"a|noun": "w0001", "b|noun": "w0002"})
            self.assertEqual(persist_ids(p, words), 0)


class PatternsFlags(unittest.TestCase):
    """A rebuild keeps `patterns`/`patternCue` when the site ships pack/patterns.json (the es rebuild dropped them)."""

    def pack_json(self, with_file):
        from types import SimpleNamespace
        from packbuilder.core.pipeline import build_pack_json
        from packbuilder.langs import get_spec
        with tempfile.TemporaryDirectory() as d:
            pack = Path(d) / "pack"
            pack.mkdir()
            if with_file:
                (pack / "patterns.json").write_text("[]")
            return build_pack_json(SimpleNamespace(spec=get_spec("es", None, load=False), pack=pack), [], {})

    def test_flags_follow_patterns_file(self):
        self.assertEqual((self.pack_json(True).get("patterns"), self.pack_json(True).get("patternCue")), (True, "after"))
        self.assertNotIn("patterns", self.pack_json(False))
        self.assertNotIn("patternCue", self.pack_json(False))


if __name__ == "__main__":
    unittest.main()
