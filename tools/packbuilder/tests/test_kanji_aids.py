"""Tests for the Japanese kanji aids: tools/ja_hints.py (meanings, KRADFILE parts), tools/ja_furigana.py
(JmdictFurigana alignment) and packbuilder core/kanji_aids.py (characters.json `hint`, words.json `ruby`).
Fixtures only, no network. Stdlib unittest, so it runs under pytest or:

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools" / "packbuilder"))

import ja_furigana  # noqa: E402
import ja_hints  # noqa: E402
from packbuilder.core import kanji_aids  # noqa: E402

KD = {
    "好": {"glosses": ["good", "fine", "favorable"], "on": ["コウ"], "kun": ["この", "よい"]},
    "子": {"glosses": ["child", "offspring"], "on": ["シ"], "kun": ["こ"]},
    "女": {"glosses": ["woman", "female"], "on": ["ジョ"], "kun": ["おんな"]},
    "一": {"glosses": ["one", "one radical (no.1)"], "on": ["イチ"], "kun": ["ひと"]},
    "禾": {"glosses": ["two-branch tree radical (no. 115)"], "on": [], "kun": ["のぎ"]},
    "厶": {"glosses": ["private; self"], "on": [], "kun": []},
    "見": {"glosses": ["see", "look", "hopes"], "on": ["ケン"], "kun": ["み.る"]},
    "目": {"glosses": ["eye"], "on": ["モク"], "kun": ["め"]},
    "儿": {"glosses": ["legs radical (no. 10)"], "on": [], "kun": []},
}
KR = {"好": ["女", "子", "｜"], "子": ["子"], "女": ["女"], "一": ["一"], "禾": ["禾"], "厶": ["厶"],
      "見": ["目", "儿"], "私": ["禾", "厶"], "人": ["人"], "々": []}


class Hints(unittest.TestCase):
    def test_gloss_drops_radical_notes(self):
        self.assertEqual(ja_hints.gloss_of(["two-branch tree radical (no. 115)"]), "two-branch tree")
        self.assertEqual(ja_hints.gloss_of(["legs radical (no. 10)"]), "legs")
        self.assertEqual(ja_hints.gloss_of(["one", "one radical (no.1)"]), "one")
        self.assertIsNone(ja_hints.gloss_of([]))

    def test_build_meaning_parts_and_overrides(self):
        t = ja_hints.build(["好", "子", "一", "見", "々"], KD, KR, {"々": "repeats the kanji before it"})
        self.assertEqual(t["好"]["meaning"], "good, fine")
        self.assertEqual(t["好"]["parts"], [["女", "woman"], ["子", "child"]], "non-CJK stroke ｜ is left out")
        self.assertEqual(t["一"]["meaning"], "one", "a radical note is never a meaning")
        self.assertEqual(t["一"]["parts"], [], "a primitive lists only itself and has no parts")
        self.assertEqual(t["見"]["parts"], [["目", "eye"], ["儿", "legs"]])
        self.assertEqual(t["々"], {"meaning": "repeats the kanji before it", "glosses": [], "on": [], "kun": [], "parts": [],
                                   "fixed": True})
        self.assertEqual(t["見"]["glosses"], ["see", "look", "hopes"])
        self.assertNotIn("fixed", t["見"])

    def test_load_kanjidic_reads_gloss_readings_and_drops_okurigana_dots(self):
        import gzip
        import tempfile
        xml = ("<?xml version=\"1.0\"?><kanjidic2><character><literal>見</literal><reading_meaning><rmgroup>"
               "<reading r_type=\"ja_on\">ケン</reading><reading r_type=\"ja_kun\">み.る</reading>"
               "<meaning>see</meaning><meaning m_lang=\"fr\">voir</meaning></rmgroup></reading_meaning></character>"
               "</kanjidic2>")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "kanjidic2.xml.gz"
            with gzip.open(path, "wt", encoding="utf-8") as f:
                f.write(xml)
            e = ja_hints.load_kanjidic(str(path))["見"]
        self.assertEqual(e, {"glosses": ["see"], "on": ["ケン"], "kun": ["みる"]})

    def test_build_without_kanjidic_entry_has_no_meaning(self):
        t = ja_hints.build(["軈"], {}, {}, {})
        self.assertIsNone(t["軈"]["meaning"])


class Furigana(unittest.TestCase):
    def test_hira_maps_katakana_only(self):
        self.assertEqual(ja_furigana.hira("フランスご・ー"), "ふらんすご・ー")

    def test_ruby_offsets_are_utf16_and_shifted_past_the_counter_mark(self):
        self.assertEqual(ja_furigana.ruby_of("私", "0:わたし"), [[0, 1, "わたし"]])
        self.assertEqual(ja_furigana.ruby_of("〜年", "0:ねん"), [[1, 2, "ねん"]])
        self.assertEqual(ja_furigana.ruby_of("明白", "0-1:あからさま"), [[0, 2, "あからさま"]])
        self.assertEqual(ja_furigana.ruby_of("フランス語", "4:ご"), [[4, 5, "ご"]])
        self.assertEqual(ja_furigana.ruby_of("𠮷田", "0:よし"), [[0, 2, "よし"]], "a non-BMP kanji is two UTF-16 units")

    def test_build_aligns_once_and_dedupes_equal_readings(self):
        index = {}
        for line in ["私|わたし|0:わたし", "私|ワタシ|0:ワタシ", "来る|くる|0:く", "来る|クる|0:ク"]:
            text, rd, rng = line.split("|")
            index.setdefault((text, ja_furigana.hira(rd)), []).append(ja_furigana.hira(rng))
        words = [{"id": "w1", "w": "私", "pron": "わたし"}, {"id": "w2", "w": "来る", "pron": "くる"}]
        t = ja_furigana.build(words, index, {})
        self.assertEqual(t["w1"], {"w": "私", "ruby": [[0, 1, "わたし"]]})
        self.assertEqual(t["w2"]["ruby"], [[0, 1, "く"]])

    def test_build_refuses_a_miss_and_a_mismatched_override(self):
        words = [{"id": "w1", "w": "前に", "pron": "まえに"}]
        with self.assertRaises(SystemExit):
            ja_furigana.build(words, {}, {})
        ov = {"w1": {"w": "後に", "ruby": [[0, 1, "まえ"]], "reason": "x"}}
        with self.assertRaises(SystemExit):
            ja_furigana.build(words, {}, ov)
        ok = {"w1": {"w": "前に", "ruby": [[0, 1, "まえ"]], "reason": "JMdict has no 前に entry"}}
        self.assertEqual(ja_furigana.build(words, {}, ok)["w1"]["ruby"], [[0, 1, "まえ"]])


def table():
    return {
        "好": {"meaning": "good, fine", "on": [], "kun": [], "parts": [["女", "woman"], ["子", "child"]]},
        "子": {"meaning": "child", "on": [], "kun": [], "parts": []},
        "学": {"meaning": "study", "on": [], "kun": [], "parts": [["子", "child"]]},
        "生": {"meaning": "life", "on": [], "kun": [], "parts": []},
    }


class Aids(unittest.TestCase):
    def test_one_character_unit_reads_parts_then_meaning(self):
        units = [{"id": "c1", "t": "好", "words": ["w1"], "lv": "A1", "reading": "よい"}]
        kanji_aids.attach_hints(units, table(), {}, {})
        self.assertEqual(units[0]["hint"], ["女 woman + 子 child: good, fine"])

    def test_compound_line_is_meaning_plus_parts_only_without_a_unit(self):
        units = [{"id": "c1", "t": "学生", "words": ["w1"], "lv": "A1", "reading": "がくせい"},
                 {"id": "c2", "t": "子", "words": ["w2"], "lv": "A1", "reading": "こ"}]
        kanji_aids.attach_hints(units, table(), {"学生:学": "learn"}, {})
        self.assertEqual(units[0]["hint"], ["learn: 子 child", "life"])

    def test_compound_with_own_unit_shows_meaning_only(self):
        units = [{"id": "c1", "t": "好子", "words": ["w1"], "lv": "A1", "reading": "こうし"},
                 {"id": "c2", "t": "子", "words": ["w2"], "lv": "A1", "reading": "こ"}]
        kanji_aids.attach_hints(units, table(), {}, {})
        self.assertEqual(units[0]["hint"], ["good: 女 woman + 子 child", "child"])

    def test_kana_positions_are_null_and_all_null_drops_the_field(self):
        units = [{"id": "c1", "t": "学ぶ", "words": ["w1"], "lv": "A1", "reading": "まなぶ", "hint": ["stale"]},
                 {"id": "c2", "t": "ぶ", "words": ["w2"], "lv": "A1", "reading": "ぶ", "hint": [None]}]
        kanji_aids.attach_hints(units, table(), {}, {})
        self.assertEqual(units[0]["hint"][1], None)
        self.assertNotIn("hint", units[1])

    def test_stale_tables_fail(self):
        with self.assertRaises(SystemExit):
            kanji_aids.attach_hints([{"id": "c1", "t": "猫", "words": ["w1"], "lv": "A1", "reading": "ねこ"}], table(), {}, {})
        with self.assertRaises(SystemExit):
            kanji_aids.attach_hints([{"id": "c1", "t": "子", "words": ["w1"], "lv": "A1", "reading": "こ"}], table(), {"学生:学": "x"}, {})

    def test_ruby_attaches_to_kanji_words_only(self):
        words = [{"id": "w1", "w": "私", "pron": "わたし"}, {"id": "w2", "w": "はい", "pron": "はい", "ruby": [[0, 1, "x"]]}]
        furi = {"w1": {"w": "私", "ruby": [[0, 1, "わたし"]]}}
        self.assertEqual(kanji_aids.attach_ruby(words, furi), 1)
        self.assertEqual(words[0]["ruby"], [[0, 1, "わたし"]])
        self.assertNotIn("ruby", words[1])

    def test_ruby_refuses_missing_or_mismatched_entries(self):
        with self.assertRaises(SystemExit):
            kanji_aids.attach_ruby([{"id": "w1", "w": "私", "pron": "わたし"}], {})
        with self.assertRaises(SystemExit):
            kanji_aids.attach_ruby([{"id": "w1", "w": "私", "pron": "わたし"}], {"w1": {"w": "子", "ruby": []}})


def unit(t, w="w1", lv="A1"):
    return {"id": "c" + w, "t": t, "words": [w], "lv": lv, "reading": "x"}


def words(**en):
    return [{"id": k, "w": "x", "en": v} for k, v in en.items()]


def table2():
    t = table()
    t["経"] = {"meaning": "sutra, longitude", "glosses": ["sutra", "longitude", "pass through", "manage"], "on": [], "kun": [],
               "parts": []}
    t["験"] = {"meaning": "verification, effect", "glosses": ["verification", "effect", "testing"], "on": [], "kun": [], "parts": []}
    t["新"] = {"meaning": "new", "glosses": ["new"], "on": [], "kun": [], "parts": [["立", "stand"], ["木", "tree"], ["斤", "axe"]]}
    t["行"] = {"meaning": "going, journey", "glosses": ["going", "journey"], "on": [], "kun": [], "parts": []}
    t["年"] = {"meaning": "year, counter for years", "glosses": ["year", "counter for years"], "on": [], "kun": [], "parts": []}
    t["何"] = {"meaning": "what", "glosses": ["what"], "on": [], "kun": [],
               "parts": [["化", "change"], ["口", "mouth"], ["亅", None], ["一", "one"]]}
    t["時"] = {"meaning": "time, hour", "glosses": ["time", "hour"], "on": [], "kun": [], "parts": [["寸", "measurement"], ["日", "day"]]}
    t["花"] = {"meaning": "flower", "glosses": ["flower"], "on": [], "kun": [], "parts": [["艹", "plants"], ["化", "change"]]}
    t["学"] = dict(t["学"], glosses=["study"])
    t["子"] = dict(t["子"], glosses=["child", "offspring"])
    return t


class Rules(unittest.TestCase):
    def test_compound_prefers_the_gloss_found_in_the_unit_english(self):
        t = table2()
        t["意"] = {"meaning": "idea, mind", "glosses": ["idea", "mind", "heart"], "on": [], "kun": [], "parts": []}
        t["見"] = {"meaning": "see, look", "glosses": ["see", "look", "hopes"], "on": [], "kun": [], "parts": []}
        u = [unit("意見", "w1"), unit("経験", "w2"), unit("見学", "w3")]
        kanji_aids.attach_hints(u, t, {}, {}, words(w1="opinion; the view of what one hears", w2="experience", w3="a Look around"))
        self.assertEqual(u[0]["hint"], ["idea", "see"], "the first gloss found as whole words in the English, so no two-gloss join")
        self.assertEqual(u[1]["hint"], ["sutra", "verification"], "no gloss in the English: the first gloss alone, never two")
        self.assertEqual(u[2]["hint"], ["look", "study: 子 child"])

    def test_override_beats_the_gloss_rule_and_a_bare_beats_it_too(self):
        t = table2()
        t["経"]["meaning"], t["経"]["fixed"] = "to pass through", True
        u = [unit("経験", "w2")]
        kanji_aids.attach_hints(u, t, {"経験:験": "test"}, {}, words(w2="experience, effect"))
        self.assertEqual(u[0]["hint"], ["to pass through", "test"])

    def test_okurigana_unit_reads_as_its_english_and_a_hook_gives_the_story(self):
        t = table2()
        u = [unit("行く", "w1"), unit("新しい", "w2"), unit("新しい", "w3")]
        w = words(w1="to go", w2="new, novel", w3="new, novel")
        kanji_aids.attach_hints(u[:1], t, {}, {}, w)
        kanji_aids.attach_hints(u[1:2], t, {}, {"新": "立 stand + 木 tree + 斤 axe: new"}, w)
        kanji_aids.attach_hints(u[2:], t, {"新しい:新": "fresh"}, {"新": "立 stand + 木 tree + 斤 axe: new"}, w)
        self.assertEqual(u[0]["hint"], ["to go", None], "not the KANJIDIC noun gloss going")
        self.assertEqual(u[1]["hint"], ["立 stand + 木 tree + 斤 axe: new, novel", None, None])
        self.assertEqual(u[2]["hint"][0], "立 stand + 木 tree + 斤 axe: fresh", "a per-word meaning wins over the English")

    def test_okurigana_english_is_clipped_at_a_separator(self):
        t = table2()
        u = [unit("行く", "w1")]
        kanji_aids.attach_hints(u, t, {}, {}, words(w1="to carry out, to put into effect, to conduct"))
        self.assertEqual(u[0]["hint"][0], "to carry out, to put into effect")

    def test_leading_tilde_unit_is_labelled_suffix_unless_overridden(self):
        t = table2()
        u = [unit("〜年", "w1"), unit("〜年", "w2")]
        kanji_aids.attach_hints(u[:1], t, {}, {}, words(w1="year(s)"))
        kanji_aids.attach_hints(u[1:], t, {"〜年:年": "year (counter)"}, {}, words(w2="year(s)"))
        self.assertEqual(u[0]["hint"], [None, "year (suffix)"])
        self.assertEqual(u[1]["hint"], [None, "year (counter)"])

    def test_parts_line_only_for_semantic_radicals(self):
        t = table2()
        u = [unit("新", "w1"), unit("何", "w2"), unit("時", "w3"), unit("花", "w4"), unit("好", "w5")]
        kanji_aids.attach_hints(u, t, {}, {}, words(w1="new", w2="what", w3="time", w4="flower", w5="good"))
        self.assertEqual(u[0]["hint"], ["立 stand + 木 tree + 斤 axe: new"])
        self.assertEqual(u[1]["hint"], ["what"], "a part without a KANJIDIC gloss or a known search piece (化) drops the whole line")
        self.assertEqual(u[2]["hint"], ["寸 measurement + 日 day: time, hour"], "every part has a one-word gloss")
        self.assertEqual(u[3]["hint"], ["flower"], "化 is a known search piece")

    def test_compound_breakdown_follows_the_same_filter_and_a_hook_story_replaces_it(self):
        t = table2()
        u = [unit("何時", "w1"), unit("花束", "w2")]
        t["束"] = {"meaning": "bundle", "glosses": ["bundle"], "on": [], "kun": [], "parts": []}
        kanji_aids.attach_hints(u, t, {}, {"花": "艹 grass over 化 change: flower"}, words(w1="what time", w2="bouquet"))
        self.assertEqual(u[0]["hint"], ["what", "time: 寸 measurement + 日 day"])
        self.assertEqual(u[1]["hint"], ["flower: 艹 grass over 化 change", "bundle"])

    def test_one_character_unit_meaning_override_and_hook_collisions(self):
        t = table2()
        u = [unit("子", "w1"), unit("学", "w2")]
        kanji_aids.attach_hints(u, t, {"子:子": "child (suffix)", "学:学": "school"}, {"学": "子 child under a roof: study"}, words(w1="x", w2="x"))
        self.assertEqual(u[0]["hint"], ["child (suffix)"])
        self.assertEqual(u[1]["hint"], ["子 child under a roof: school"], "the story of the hook, the meaning of the unit override")

    def test_unused_hook_fails(self):
        with self.assertRaises(SystemExit):
            kanji_aids.attach_hints([unit("子")], table2(), {}, {"学": "a: b"}, words(w1="child"))


class CommittedTables(unittest.TestCase):
    def test_overrides_shape(self):
        import json
        data = json.loads((ROOT / "tools" / "ja_hints_overrides.json").read_text(encoding="utf-8"))
        for k, v in data.items():
            if k != "_meanings":
                self.assertEqual(v.count(": "), 1, f"hook {k}: exactly one ': ' (story: meaning)")
                self.assertLessEqual(len(v), 60, f"hook {k}")
        for k, v in data["_meanings"].items():
            self.assertLessEqual(len(v), 60, f"meaning {k}")
            self.assertTrue(len(k) == 1 or (len(k.partition(":")[2]) == 1 and k.partition(":")[0] != ""), k)

    def test_table_has_glosses_for_every_kanji_with_a_meaning(self):
        import json
        t = json.loads((ROOT / "tools" / "ja_hints.json").read_text(encoding="utf-8"))
        for c, e in t.items():
            self.assertTrue(e["glosses"] or e.get("fixed"), c)


if __name__ == "__main__":
    unittest.main()
