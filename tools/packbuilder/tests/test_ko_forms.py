"""Korean alt / forms split (langs/ko.py finalize_words + alt_kind through
core.words.split_alt_forms). Every corpus eojeol finalize_words keeps as an alt
is the word inflected (noun + particles 학교에서, conjugated verb 하던): a form,
located in text, never typed. Only the hand-listed spellings (KO_SPELLINGS:
아뇨 for 아니요) stay alt. The corpus and the analyser are stubbed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_ko_forms.py     (from vocab-engine/)
"""
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # vocab-engine/tools

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs.ko import KO_SPELLINGS  # noqa: E402


def build(seen):
    """finalize_words then split_alt_forms over one word per key in seen
    ({(lemma, group): Counter(eojeol)}), every eojeol accepted by alt_ok."""
    sp = get_spec("ko", None, load=False)
    sp.eojeol_forms = lambda ctx, words: seen
    sp.alt_ok = lambda w, f: True
    words = [{"lemma": k[0], "w": k[0], "_key": k} for k in seen]
    sp.finalize_words(None, {}, words)
    split_alt_forms(sp, words)
    return {w["w"]: w for w in words}


class KoAltKind(unittest.TestCase):
    def test_inflected_eojeols_are_forms_in_frequency_order(self):
        out = build({("학교", "NOUN"): Counter({"학교에서": 5, "학교에": 3}),
                     ("하다", "VERB"): Counter({"하던": 2, "하도록": 1})})
        self.assertEqual(out["학교"], {"lemma": "학교", "w": "학교", "_key": ("학교", "NOUN"),
                                       "forms": ["학교에서", "학교에"]})
        self.assertNotIn("alt", out["하다"])
        self.assertEqual(out["하다"]["forms"], ["하던", "하도록"])

    def test_listed_spelling_stays_alt_once_and_its_inflections_are_forms(self):
        # 아뇨 also comes up as a corpus eojeol: one alt, not two
        out = build({("아니요", "INTJ"): Counter({"아뇨": 4, "아니요요": 1})})
        self.assertEqual(out["아니요"]["alt"], ["아뇨"])
        self.assertEqual(out["아니요"]["forms"], ["아니요요"])
        self.assertNotIn("_spell", out["아니요"])

    def test_alt_kind_reads_only_the_marked_spellings(self):
        sp = get_spec("ko", None, load=False)
        self.assertEqual(sp.alt_kind({"w": "아니요", "_spell": {"아뇨"}}, "아뇨"), "alt")
        self.assertEqual(sp.alt_kind({"w": "학교"}, "학교에서"), "form")
        self.assertEqual(KO_SPELLINGS[("아니요", "INTJ")], ("아뇨",))


if __name__ == "__main__":
    unittest.main()
