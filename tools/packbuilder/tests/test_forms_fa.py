"""Persian alt / forms split (langs/fa.py finalize_words marks, alt_kind through
core.words.split_alt_forms). A verb's present stem (خواه for خواستن, marked in
word["_form"]) ships as a form; the joined and spaced spellings of a ZWNJ
headword (آنها, آن ها for آن‌ها) stay `alt`. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_forms_fa.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class PersianForms(unittest.TestCase):
    def test_present_stem_is_a_form_zwnj_spellings_stay_alt(self):
        sp = get_spec("fa", None, load=False)
        words = [{"w": "خواستن", "alt": ["خواه"], "_form": ["خواه"]},
                 {"w": "برداشتن", "alt": ["بردار"], "_form": ["بردار"]},
                 {"w": "آن‌ها", "alt": ["آنها", "آن ها"]}]
        split_alt_forms(sp, words)
        self.assertEqual((words[0].get("alt"), words[0]["forms"]), (None, ["خواه"]))
        self.assertEqual(words[1]["forms"], ["بردار"])
        self.assertEqual(words[2], {"w": "آن‌ها", "alt": ["آنها", "آن ها"]})

    def test_finalize_words_marks_only_the_stem(self):
        src = (Path(__file__).resolve().parents[1] / "langs" / "fa.py").read_text()
        self.assertEqual(src.count('w["_form"]'), 1)
        self.assertIn('w["alt"] = [stem]\n                    w["_form"] = [stem]', src)


if __name__ == "__main__":
    unittest.main()
