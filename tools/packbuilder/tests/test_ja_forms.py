"""Japanese alt / forms split (langs/ja.py _plain_spelling, _split_forms, the
pack/words.json readers passage_lemma_alias and _pack_readings) and the shared
WORD_FIELDS order. Spellings (私/わたし, 無い, いい/よい/良い) stay `alt`, the
only surfaces a typed answer accepts; conjugations (食べた, 言える) go to
`forms`, located in text but never typed (docs/PACK_SCHEMA.md). Sudachi is not
needed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_ja_forms.py     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # vocab-engine/tools

from packbuilder.core.pipeline import WORD_FIELDS  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


def spec(repo="/nonexistent-ja-repo"):
    return get_spec("ja", repo, load=False)


def feats(dict_, norm, read):
    return {"Dict": dict_, "Norm": norm, "Read": read}


class PlainSpelling(unittest.TestCase):
    def setUp(self):
        self.ps = type(spec())._plain_spelling

    def test_kanji_kana_swap_is_a_spelling(self):
        self.assertTrue(self.ps("無い", feats("無い", "無い", "ナイ"), "ない", {"無い", "ない"}, ["ナイ"]))
        self.assertTrue(self.ps("有る", feats("有る", "有る", "アル"), "ある", {"有る", "ある"}, ["アル"]))

    def test_normal_form_reading_counts(self):
        # いい: normal form 良い, which the corpus reads よい
        for u in ("よい", "良い"):
            self.assertTrue(self.ps(u, feats(u, "良い", "ヨイ"), "いい", {"良い", "いい"}, ["ヨイ"]))

    def test_conjugation_potential_classical_colloquial_are_forms(self):
        own = {"言う"}
        self.assertFalse(self.ps("言える", feats("言える", "言う", "イエル"), "いう", own, ["イウ"]))   # potential
        self.assertFalse(self.ps("長し", feats("長し", "長い", "ナガシ"), "ながい", {"長い"}, ["ナガイ"]))  # classical
        self.assertFalse(self.ps("おっきい", feats("おっきい", "大きい", "オッキイ"), "おおきい", {"大きい"}, ["オオキイ"]))
        self.assertFalse(self.ps("づよい", feats("づよい", "強い", "ヅヨイ"), "つよい", {"強い"}, ["ツヨイ"]))

    def test_inflected_or_multi_token_or_foreign_norm_is_never_a_spelling(self):
        self.assertFalse(self.ps("食べた", None, "たべる", {"食べる"}, ["タベル"]))                   # several tokens
        self.assertFalse(self.ps("食べ", feats("食べる", "食べる", "タベ"), "たべる", {"食べる"}, ["タベル"]))  # surface != Dict
        self.assertFalse(self.ps("入れる", feats("入れる", "入れる", "イレル"), "はいる", {"入る"}, ["ハイル"]))
        self.assertFalse(self.ps("123", feats("123", "123", ""), "", {"123"}, []))                  # no Japanese letter


class SplitForms(unittest.TestCase):
    def test_split_keeps_order_and_drops_empty_lists(self):
        sp = spec()
        sp.stats = Counter()
        words = [{"w": "いい", "alt": ["よい", "良い", "良いです", "良ければ"], "_spell": {"よい", "良い"}},
                 {"w": "する", "alt": ["して", "した"], "_spell": set()},
                 {"w": "私", "alt": ["わたし"], "_spell": {"わたし"}},
                 {"w": "本", "_spell": set()}]
        sp._split_forms(words)
        self.assertEqual(words[0], {"w": "いい", "alt": ["よい", "良い"], "forms": ["良いです", "良ければ"]})
        self.assertEqual(words[1], {"w": "する", "forms": ["して", "した"]})
        self.assertEqual(words[2], {"w": "私", "alt": ["わたし"]})
        self.assertEqual(words[3], {"w": "本"})
        self.assertEqual(sp.stats["alt split: spellings (alt)"], 3)
        self.assertEqual(sp.stats["alt split: inflected/used surfaces (forms)"], 4)

    def test_word_fields_ship_forms_after_alt(self):
        self.assertEqual(WORD_FIELDS[WORD_FIELDS.index("alt") + 1], "forms")


class WordsJsonReaders(unittest.TestCase):
    def _repo(self, d, words):
        (Path(d) / "pack").mkdir()
        (Path(d) / "pack" / "words.json").write_text(json.dumps(words, ensure_ascii=False))

    def test_passage_lemma_alias_reads_forms(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d, [{"id": "w1", "w": "食べる", "lemma": "食べる", "alt": ["たべる"], "forms": ["食べた"]},
                           {"id": "w2", "w": "する", "lemma": "する", "forms": ["した"]},
                           {"id": "w3", "w": "下", "lemma": "下", "alt": ["した"]}])
            sp = spec(d)
            sp.passage_text("テキスト", frozenset(), None)
            a = sp.passage_lemma_alias
            self.assertEqual(a["たべる"], "食べる")
            self.assertEqual(a["食べた"], "食べる")          # a form, exactly as when it was an alt
            self.assertNotIn("した", a)                      # an alt of one word and a form of another: ambiguous

    def test_pack_readings_read_forms(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d, [{"id": "w1", "w": "食べる", "pron": "たべる", "alt": ["たべる"], "forms": ["食べた"]}])
            rd = spec(d)._pack_readings()
            self.assertEqual(rd["食べた"], ["たべる"])
            self.assertEqual(rd["食べる"], ["たべる"])


if __name__ == "__main__":
    unittest.main()
