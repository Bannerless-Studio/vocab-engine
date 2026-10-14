"""pack_diff_guard words.json rows matched by id, with exact removed/added id lists. Stdlib only."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GUARD = Path(__file__).resolve().parents[2] / "round" / "pack_diff_guard.py"


def W(*ids, **over):
    return [{"id": i, "lemma": i, "rank": over.get(i, n), "ft": 0} for n, i in enumerate(ids, 1)]


class WordRows(unittest.TestCase):
    def run_guard(self, prev, now, *extra):
        with tempfile.TemporaryDirectory() as d:
            def git(*a):
                subprocess.run(["git", "-C", d, *a], check=True, capture_output=True)
            git("init", "-q")
            git("config", "user.email", "t@t")
            git("config", "user.name", "t")
            (Path(d) / "pack").mkdir()
            (Path(d) / "pack" / "words.json").write_text(json.dumps(prev))
            git("add", ".")
            git("commit", "-qm", "prev")
            (Path(d) / "pack" / "words.json").write_text(json.dumps(now))
            p = subprocess.run([sys.executable, str(GUARD), "--repo", d, "--prev", "HEAD", "--word-fields", "ft,rank", *extra],
                               capture_output=True, text=True)
            return p.returncode, p.stdout

    def test_swap_without_lists_fails_once_not_per_row(self):
        rc, out = self.run_guard(W("a", "b", "c", "d"), W("a", "c", "d", "e"))
        self.assertEqual(rc, 1)
        self.assertIn("ids removed ['b']", out)
        self.assertIn("ids added ['e']", out)
        self.assertNotIn("id 'c' ->", out)

    def test_swap_with_exact_lists_ok(self):
        rc, out = self.run_guard(W("a", "b", "c", "d"), W("a", "c", "d", "e"),
                                 "--word-ids-removed", "b", "--word-ids-added", "e")
        self.assertEqual(rc, 0, out)

    def test_unlisted_extra_id_fails(self):
        rc, out = self.run_guard(W("a", "b", "c"), W("a", "d", "e"), "--word-ids-removed", "b", "--word-ids-added", "d")
        self.assertEqual(rc, 1)
        self.assertIn("unexpected ['c']", out)

    def test_listed_but_absent_fails(self):
        rc, out = self.run_guard(W("a", "b"), W("a", "b", b=9), "--word-ids-removed", "b")
        self.assertEqual(rc, 1)
        self.assertIn("missing ['b']", out)

    def test_field_change_on_kept_id_still_fails(self):
        prev, now = W("a", "b"), W("a", "b")
        now[0]["lemma"] = "z"
        rc, out = self.run_guard(prev, now)
        self.assertEqual(rc, 1)
        self.assertIn("field 'lemma'", out)

    def test_rank_only_ok_when_allowed(self):
        rc, out = self.run_guard(W("a", "b"), W("a", "b", b=9))
        self.assertEqual(rc, 0, out)

    def test_order_change_fails(self):
        rc, out = self.run_guard(W("a", "b"), [W("a", "b")[1], W("a", "b")[0]], "--word-fields", "ft")
        self.assertEqual(rc, 1)
        self.assertIn("order", out)

    def test_rank_allowed_reorders_ok(self):
        rc, out = self.run_guard(W("a", "b"), [W("a", "b")[1], W("a", "b")[0]])
        self.assertEqual(rc, 0, out)


if __name__ == "__main__":
    unittest.main()
