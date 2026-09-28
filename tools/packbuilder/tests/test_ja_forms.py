"""Japanese alt / forms split (langs/ja.py _plain_spelling, _conj_spelling,
alt_kind through core.words.split_alt_forms, the
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

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.pipeline import WORD_FIELDS  # noqa: E402
from packbuilder.core.util import STATS  # noqa: E402
from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs.base import LanguageSpec  # noqa: E402


def spec(repo="/nonexistent-ja-repo"):
    return get_spec("ja", repo, load=False)


def feats(dict_, norm, read, pos=""):
    return {"Dict": dict_, "Norm": norm, "Read": read, "Pos": pos}


class PlainSpelling(unittest.TestCase):
    """A surface the sentences use: spelling or form (_plain_spelling)."""
    def setUp(self):
        self.ps = type(spec())._plain_spelling

    def test_same_reading_swap_is_a_spelling(self):
        self.assertTrue(self.ps("無い", feats("無い", "無い", "ナイ"), "ない", {"無い", "ない"}, ["ナイ"]))
        self.assertTrue(self.ps("ごみ", feats("ごみ", "ごみ", "ゴミ"), "ゴミ", {"ゴミ"}, ["ゴミ"]))
        self.assertTrue(self.ps("ガン", feats("ガン", "ガン", "ガン"), "がん", {"癌"}, ["ガン"]))
        self.assertTrue(self.ps("ふれる", feats("ふれる", "触れる", "フレル"), "ふれる", {"触れる"}, ["フレル"]))
        # the imperative 下さい for the inflected headword ください: same reading
        self.assertTrue(self.ps("下さい", feats("下さる", "下さる", "クダサイ"), "ください", {"下さる"}, [], False))
        # linked and read as the word, whatever Sudachi normalises the kana to (いえ for 家)
        self.assertTrue(self.ps("いえ", feats("いえ", "いえ", "イエ"), "いえ", {"家"}, ["イエ"]))

    def test_normal_form_reading_counts_for_an_uninflected_headword(self):
        for u in ("よい", "良い"):
            self.assertTrue(self.ps(u, feats(u, "良い", "ヨイ"), "いい", {"良い", "いい"}, ["ヨイ"], True))
            self.assertFalse(self.ps(u, feats(u, "良い", "ヨイ"), "いい", {"良い", "いい"}, ["ヨイ"], False))

    def test_conjugation_potential_classical_colloquial_are_forms(self):
        self.assertFalse(self.ps("言える", feats("言える", "言う", "イエル"), "いう", {"言う"}, ["イウ"]))
        self.assertFalse(self.ps("長し", feats("長し", "長い", "ナガシ"), "ながい", {"長い"}, ["ナガイ"]))
        self.assertFalse(self.ps("おっきい", feats("おっきい", "大きい", "オッキイ"), "おおきい", {"大きい"}, ["オオキイ"]))
        self.assertFalse(self.ps("づよい", feats("づよい", "強い", "ヅヨイ"), "つよい", {"強い"}, ["ツヨイ"]))
        self.assertFalse(self.ps("食べ", feats("食べる", "食べる", "タベ"), "たべる", {"食べる"}, ["タベル"]))
        self.assertFalse(self.ps("食べた", None, "たべる", {"食べる"}, ["タベル"]))       # several tokens
        self.assertFalse(self.ps("123", feats("123", "123", ""), "", {"123"}, []))


class ConjSpelling(unittest.TestCase):
    """A spelling _same_word_spelling listed: a form only if it reads like a conjugation."""
    def setUp(self):
        self.cs = type(spec())._conj_spelling

    def test_potential_other_dictionary_form_classical_are_conjugations(self):
        self.assertTrue(self.cs("もらえる", feats("もらえる", "貰える", "モラエル", "動詞-一般"), "もらう", ["モラウ"]))
        self.assertTrue(self.cs("いただける", feats("いただける", "頂ける", "イタダケル", "動詞-一般"), "いただく", ["イタダク"]))
        self.assertTrue(self.cs("行ふ", feats("行ふ", "行う", "オコナフ", "動詞-一般"), "おこなう", ["オコナウ"]))
        self.assertTrue(self.cs("くださる", feats("くださる", "下さる", "クダサル", "動詞-非自立可能"), "ください", [], False))

    def test_variants_and_same_reading_spellings_are_not(self):
        self.assertFalse(self.cs("こっち", feats("こっち", "此方", "コッチ", "代名詞"), "こちら", ["コチラ"]))
        self.assertFalse(self.cs("プレイ", feats("プレイ", "プレー", "プレイ", "名詞-普通名詞-一般"), "プレー", ["プレー"]))
        self.assertFalse(self.cs("観る", feats("観る", "見る", "ミル", "動詞-一般"), "みる", ["ミル"]))
        self.assertFalse(self.cs("良い", feats("良い", "良い", "ヨイ", "形容詞-非自立可能"), "いい", ["ヨイ"]))
        self.assertFalse(self.cs("観る", None, "みる", ["ミル"]))


class SplitHook(unittest.TestCase):
    """core.words.split_alt_forms through LanguageSpec.alt_kind."""
    def test_base_spec_keeps_every_alt_and_emits_no_forms(self):
        sp = LanguageSpec()      # the base hook: no language overrides it here
        words = [{"w": "tidak", "alt": ["tidaklah", "tak"]}, {"w": "aku", "_spell": {"x"}}]
        split_alt_forms(sp, words)
        self.assertEqual(words, [{"w": "tidak", "alt": ["tidaklah", "tak"]}, {"w": "aku"}])
        self.assertEqual(STATS["alt_split"], {"alt (spellings)": 2, "forms (inflected/used surfaces)": 0})

    def test_ja_override_splits_by_marked_spellings_keeping_order(self):
        sp = spec()
        words = [{"w": "いい", "alt": ["よい", "良いです", "良い", "良ければ"], "_spell": {"よい", "良い"}},
                 {"w": "する", "alt": ["して", "した"], "_spell": set()},
                 {"w": "私", "alt": ["わたし"], "_spell": {"わたし"}},
                 {"w": "本", "_spell": set()}]
        split_alt_forms(sp, words)
        self.assertEqual(words[0], {"w": "いい", "alt": ["よい", "良い"], "forms": ["良いです", "良ければ"]})
        self.assertEqual(words[1], {"w": "する", "forms": ["して", "した"]})
        self.assertEqual(words[2], {"w": "私", "alt": ["わたし"]})
        self.assertEqual(words[3], {"w": "本"})
        self.assertEqual(STATS["alt_split"], {"alt (spellings)": 3, "forms (inflected/used surfaces)": 4})

    def test_ja_does_not_split_on_its_own_and_pipeline_calls_the_hook(self):
        self.assertFalse(hasattr(type(spec()), "_split_forms"))
        src = (Path(__file__).resolve().parents[1] / "core" / "pipeline.py").read_text()
        self.assertIn("sp.finalize_words(env, ctx, words)\n    split_alt_forms(sp, words)", src)

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
