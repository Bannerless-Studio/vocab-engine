"""tools/bad_sentences.txt (docs/PACKBUILDER_HOOKS.md): an optional,
repo-relative, hand-reviewed drop list every LanguageSpec can have
(LanguageSpec.load, base.py), one sentence per line, blank lines and
"#..." comments ignored, matched after LanguageSpec.bad_sentence_norm
(whitespace collapse by default; ur overrides it with its own text_norm,
so its spelling-slip repairs still apply the same way they did before
this was pulled out of langs/ur.py's private _TextDrop). The gate itself
(core/sentences.py build_sentences) is exercised end to end by ur's real
../urdu rebuild (its tools/bad_sentences.txt has 187 real rows); this
file covers the loading contract and the drop predicate in isolation.
Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_bad_sentences.py     (from vocab-engine/)
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402


def repo_with(text):
    d = Path(tempfile.mkdtemp())
    (d / "tools").mkdir()
    if text is not None:
        (d / "tools" / "bad_sentences.txt").write_text(text, encoding="utf-8")
    return d


def drops(sp, text):
    """The exact predicate core/sentences.py's build_sentences applies."""
    return bool(sp.bad_sentences) and sp.bad_sentence_norm(text) in sp.bad_sentences


class Loading(unittest.TestCase):
    def test_blank_lines_and_comments_ignored(self):
        repo = repo_with("Tom hit Mary.\n\n# a policy note\n   \nJohn ate the cat.  # trailing comment\n")
        sp = get_spec("it", repo)
        self.assertEqual(sp.bad_sentences, {"Tom hit Mary.", "John ate the cat."})

    def test_whitespace_collapsed_on_load_and_lookup(self):
        repo = repo_with("Tom   hit  Mary.\n")
        sp = get_spec("it", repo)
        self.assertIn("Tom hit Mary.", sp.bad_sentences)
        self.assertTrue(drops(sp, "Tom  hit   Mary.\n"))

    def test_language_without_the_file_is_unaffected(self):
        repo = repo_with(None)
        sp = get_spec("it", repo)
        self.assertEqual(sp.bad_sentences, set())
        self.assertFalse(drops(sp, "Anything at all."))

    def test_no_repo_is_unaffected(self):
        sp = get_spec("it", None, load=False)
        self.assertEqual(sp.bad_sentences, set())
        self.assertFalse(drops(sp, "Anything at all."))


class DropPredicate(unittest.TestCase):
    def test_listed_sentence_drops_unlisted_survives(self):
        repo = repo_with("Il gatto mangia il pesce.\n")
        sp = get_spec("it", repo)
        self.assertTrue(drops(sp, "Il gatto mangia il pesce."))
        self.assertFalse(drops(sp, "Il cane mangia il pesce."))

    def test_row_disappears_from_a_small_sentence_set(self):
        """Simulates the build_sentences gate over a tiny row set: the listed
        row is the only one filtered out."""
        repo = repo_with("Bad one.\n")
        sp = get_spec("it", repo)
        rows = {1: "Good one.", 2: "Bad one.", 3: "Also good."}
        kept = {sid: t for sid, t in rows.items() if not drops(sp, t)}
        self.assertEqual(kept, {1: "Good one.", 3: "Also good."})


class UrduOverride(unittest.TestCase):
    """ur keeps its own spelling-slip normaliser (text_norm) for both the
    file's lines and the sentence text being matched, same as its private
    _TextDrop did before this moved into the base LanguageSpec."""

    def test_bad_sentence_norm_is_text_norm(self):
        from packbuilder.langs.ur import text_norm
        sp = get_spec("ur", None, load=False)
        self.assertIs(sp.bad_sentence_norm, text_norm)

    def test_listed_line_matches_after_text_norm_repairs(self):
        from packbuilder.langs.ur import text_norm
        raw = "میں جاتا ھوں۔"          # ھ (do-chashmi heh) for ہ: a spelling slip text_norm repairs
        repo = repo_with(text_norm(raw) + "\n")
        sp = get_spec("ur", repo)
        self.assertTrue(drops(sp, raw))

    def test_language_without_the_file_is_unaffected(self):
        repo = repo_with(None)
        sp = get_spec("ur", repo)
        self.assertEqual(sp.bad_sentences, set())
        self.assertFalse(drops(sp, "کوئی بھی جملہ۔"))


if __name__ == "__main__":
    unittest.main()
