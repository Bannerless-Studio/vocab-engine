"""Arabic alt / forms split (langs/ar.py finalize_words marks, alt_kind through
core.words.split_alt_forms). finalize_words builds a word's alts from two
sources only, both inflections: a noun's broken plural (بلدان for بلد) and a
verb's present (يكون for كان); it marks them in word["_form"], so they ship as
`forms`. An unmarked alt (a hamza spelling variant) stays `alt`. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_forms_ar.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


class ArabicForms(unittest.TestCase):
    def test_marked_plurals_and_presents_are_forms_spellings_stay_alt(self):
        sp = get_spec("ar", None, load=False)
        words = [{"w": "بلد", "alt": ["بلدان", "بلاد"], "_form": ["بلدان", "بلاد"]},
                 {"w": "كان", "alt": ["يكون"], "_form": ["يكون"]},
                 {"w": "أمس", "alt": ["امس"]}]
        split_alt_forms(sp, words)
        self.assertEqual(words[0], {"w": "بلد", "forms": ["بلدان", "بلاد"], "_form": ["بلدان", "بلاد"]})
        self.assertEqual(words[1]["forms"], ["يكون"])
        self.assertEqual(words[2], {"w": "أمس", "alt": ["امس"]})

    def test_finalize_words_marks_every_alt_it_builds(self):
        src = (Path(__file__).resolve().parents[1] / "langs" / "ar.py").read_text()
        self.assertIn('w["alt"] = alt\n                w["_form"] = list(alt)', src)


if __name__ == "__main__":
    unittest.main()
