"""Tests for tools/zh_hints.py (character memory hints for packs/zh) and their emission
into packs/zh/characters.json by tools/pack_from_hsk.py. Stdlib only; the source rows
below are verbatim Make Me a Hanzi dictionary.txt lines (matches/radical dropped).

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

import zh_hints  # noqa: E402

ROWS = [
    "{\"character\": \"好\", \"definition\": \"good, excellent, fine; proper, suitable; well\", \"pinyin\": [\"hǎo\"], \"decomposition\": \"⿰女子\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"A woman 女 with a son 子\"}}",
    "{\"character\": \"休\", \"definition\": \"to rest; to stop; to retire\", \"pinyin\": [\"xiū\"], \"decomposition\": \"⿰亻木\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"A person 亻 leaning against a tree 木\"}}",
    "{\"character\": \"妈\", \"definition\": \"mother, mama\", \"pinyin\": [\"mā\"], \"decomposition\": \"⿰女马\", \"etymology\": {\"type\": \"pictophonetic\", \"phonetic\": \"马\", \"semantic\": \"女\", \"hint\": \"woman\"}}",
    "{\"character\": \"女\", \"definition\": \"woman, girl; female\", \"pinyin\": [\"nǚ\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A woman turned to the side\"}}",
    "{\"character\": \"子\", \"definition\": \"son, child; seed, egg; fruit; small thing\", \"pinyin\": [\"zi\"], \"decomposition\": \"⿻了一\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A child in a wrap, with outstretched arms but bundled legs\"}}",
    "{\"character\": \"亻\", \"definition\": \"man, person; people\", \"pinyin\": [\"rén\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"Visual abbreviation of 人\"}}",
    "{\"character\": \"木\", \"definition\": \"tree; wood, lumber; wooden\", \"pinyin\": [\"mù\"], \"decomposition\": \"⿻十八\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A tree\"}}",
    "{\"character\": \"马\", \"definition\": \"horse; surname\", \"pinyin\": [\"mǎ\"], \"decomposition\": \"⿹？一\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"Simplified form of 馬, a horse galloping to the left\"}}",
    "{\"character\": \"你\", \"definition\": \"you, second person pronoun\", \"pinyin\": [\"nǐ\"], \"decomposition\": \"⿰亻尔\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"Pronoun 尔 for a person 亻\"}}",
    "{\"character\": \"尔\", \"definition\": \"you; that, those; final particle\", \"pinyin\": [\"ěr\"], \"decomposition\": \"⿱⺈小\"}",
    "{\"character\": \"一\", \"definition\": \"one; a, an; alone\", \"pinyin\": [\"yī\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"Represents heaven (天), earth (旦), or the number 1\"}}",
    "{\"character\": \"有\", \"definition\": \"to have, to own, to possess; to exist\", \"pinyin\": [\"yǒu\"], \"decomposition\": \"⿸？月\", \"etymology\": {\"type\": \"pictophonetic\", \"phonetic\": \"月\"}}",
    "{\"character\": \"月\", \"definition\": \"moon; month\", \"pinyin\": [\"yuè\"], \"decomposition\": \"⿵冂二\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A crescent moon\"}}",
    "{\"character\": \"这\", \"definition\": \"this, these; such; here\", \"pinyin\": [\"zhè\"], \"decomposition\": \"⿺辶文\"}",
    "{\"character\": \"辶\", \"definition\": \"to walk; walking\", \"pinyin\": [\"chuò\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A foot stepping\"}}",
    "{\"character\": \"是\", \"definition\": \"to be; indeed, right, yes; okay\", \"pinyin\": [\"shì\"], \"decomposition\": \"⿱日疋\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"To speak 日 directly 疋\"}}",
    "{\"character\": \"日\", \"definition\": \"sun; day; daytime\", \"pinyin\": [\"rì\"], \"decomposition\": \"⿴口一\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"The sun\"}}",
    "{\"character\": \"疋\", \"definition\": \"roll, bolt of cloth; foot\", \"pinyin\": [\"pǐ\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A foot 止 with a leg on top\"}}",
    "{\"character\": \"能\", \"definition\": \"can, may; capable, full of energy\", \"pinyin\": [\"néng\"], \"decomposition\": \"⿰⿱厶⺼⿱匕匕\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A bear's head 厶, body ⺼, and claws 匕\"}}",
    "{\"character\": \"厶\", \"definition\": \"private, secret\", \"pinyin\": [\"sī\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A silk cocoon\"}}",
    "{\"character\": \"⺼\", \"definition\": \"meat, flesh; organic compound\", \"pinyin\": [], \"decomposition\": \"？\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"Meat on the ribs of an animal; compare 肉\"}}",
    "{\"character\": \"匕\", \"definition\": \"spoon, ladle; knife, dirk\", \"pinyin\": [\"bǐ\"], \"decomposition\": \"⿺乚丿\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A spoon\"}}",
    "{\"character\": \"她\", \"definition\": \"she, her\", \"pinyin\": [\"tā\"], \"decomposition\": \"⿰女也\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"A woman 女 beside you 也\"}}",
    "{\"character\": \"也\", \"definition\": \"also, too\", \"pinyin\": [\"yě\"], \"decomposition\": \"⿻？乚\"}",
    "{\"character\": \"了\", \"definition\": \"clear; to finish; particle of completed action\", \"pinyin\": [\"le\", \"liǎo\"], \"decomposition\": \"⿱乛亅\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A child swaddled in blanklets; compare 子\"}}",
    "{\"character\": \"亅\", \"definition\": \"hook\", \"pinyin\": [\"jué\"], \"decomposition\": \"？\"}",
    "{\"character\": \"乛\", \"definition\": \"kwukyel\", \"pinyin\": [\"ya\"], \"decomposition\": \"？\"}",
    "{\"character\": \"气\", \"definition\": \"air, gas; steam, vapor; anger\", \"pinyin\": [\"qì\"], \"decomposition\": \"⿱亻？\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"A person 亻 breathing air\"}}",
    "{\"character\": \"时\", \"definition\": \"time, season; period, era, age\", \"pinyin\": [\"shí\"], \"decomposition\": \"⿰日寸\", \"etymology\": {\"type\": \"pictophonetic\", \"semantic\": \"日\", \"hint\": \"day\"}}",
    "{\"character\": \"寸\", \"definition\": \"inch; small, tiny\", \"pinyin\": [\"cùn\"], \"decomposition\": \"？\", \"etymology\": {\"type\": \"ideographic\", \"hint\": \"A hand with a dot indicating where the pulse can be felt, about an inch up the wrist\"}}",
    "{\"character\": \"户\", \"definition\": \"door; family\", \"pinyin\": [\"hù\"], \"decomposition\": \"⿱丶尸\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"Simplified form of 戶; a door swinging on its hinge\"}}",
    "{\"character\": \"东\", \"definition\": \"east, eastern, eastward\", \"pinyin\": [\"dōng\"], \"decomposition\": \"⿻七小\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"Simplified form of 東, the sun 日 rising behind a tree 木\"}}",
    "{\"character\": \"文\", \"definition\": \"culture, literature, writing\", \"pinyin\": [\"wén\"], \"decomposition\": \"⿱亠乂\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A tattooed chest, representing writing\"}}",
]
DIC = {d["character"]: d for d in map(json.loads, ROWS)}


class ComposeTest(unittest.TestCase):
    def test_ideographic_quotes_the_source_hint(self):
        self.assertEqual(zh_hints.compose("好", DIC), "a woman 女 with a son 子: good")
        self.assertEqual(zh_hints.compose("休", DIC), "a person 亻 leaning against a tree 木: to rest")
        self.assertEqual(zh_hints.compose("你", DIC), "pronoun 尔 for a person 亻: you")
        self.assertEqual(zh_hints.compose("是", DIC), "to speak 日 directly 疋: to be")
        self.assertEqual(zh_hints.compose("她", DIC), "a woman 女 beside you 也: she")
        self.assertEqual(zh_hints.compose("气", DIC), "a person 亻 breathing air: air")

    def test_ideographic_drops_parts_the_glyph_does_not_show(self):
        # 一's decomposition shows neither 天 nor 旦; the empty parentheses go with them.
        self.assertEqual(zh_hints.compose("一", DIC), "represents heaven, earth, or the number 1: one")

    def test_meaning_is_the_hsk_gloss_first_alternative(self):
        self.assertEqual(zh_hints.compose("是", DIC, "to be (followed by substantives only); correct; right"),
                         "to speak 日 directly 疋: to be")
        self.assertEqual(zh_hints.compose("她", DIC, "she"), "a woman 女 beside you 也: she")
        self.assertEqual(zh_hints.first_alt("(colloquial pr. [nèi]); that, those"), "that")
        self.assertEqual(zh_hints.first_alt("(completed action marker)"), "")

    def test_meaning_dropped_over_the_word_limit(self):
        long = dict(DIC["是"], etymology={"type": "ideographic", "hint": " ".join(["w"] * 13)})
        self.assertEqual(zh_hints.compose("是", {"是": long}, "to be"), " ".join(["w"] * 13))

    def test_pictophonetic(self):
        self.assertEqual(zh_hints.compose("妈", DIC), "女 (woman) + 马 (sound mǎ)")

    def test_pictophonetic_one_side_fills_the_other_from_the_decomposition(self):
        self.assertEqual(zh_hints.compose("时", DIC), "日 (day) + 寸")
        # 有's other part is unknown (？): no one-sided hint.
        self.assertIsNone(zh_hints.compose("有", DIC))

    def test_pictographic(self):
        self.assertEqual(zh_hints.compose("木", DIC), "picture of a tree")
        self.assertEqual(zh_hints.compose("能", DIC), "picture of a bear's head, body, and claws")
        self.assertEqual(zh_hints.compose("了", DIC), "picture of a child swaddled in blanklets")
        self.assertEqual(zh_hints.compose("东", DIC), "picture of the sun rising behind a tree")
        self.assertEqual(zh_hints.compose("户", DIC), "picture of a door swinging on its hinge")

    def test_pictographic_without_a_picture_has_no_hint(self):
        bare = dict(DIC["东"], etymology={"type": "pictographic", "hint": "Simplified form of 東"})
        self.assertIsNone(zh_hints.compose("东", {"东": bare}))
        self.assertIsNone(zh_hints.compose("东", {"东": dict(DIC["东"], etymology={"type": "pictographic"})}))

    def test_no_etymology_lists_two_components_only(self):
        self.assertEqual(zh_hints.compose("这", DIC), "辶 to walk + 文 culture")
        three = dict(DIC["这"], decomposition="⿲辶文木")
        self.assertIsNone(zh_hints.compose("这", dict(DIC, 这=three)))

    def test_missing_character_has_no_hint(self):
        self.assertIsNone(zh_hints.compose("我", DIC))

    def test_word_limit(self):
        long = dict(DIC["木"], etymology={"type": "pictographic", "hint": " ".join(["w"] * 20)})
        self.assertIsNone(zh_hints.compose("木", {"木": long}))


class BuildTest(unittest.TestCase):
    def test_overrides_win_and_meaning_comes_from_single_character_words(self):
        words = [{"w": "是", "en": "to be (followed by substantives only); correct"}, {"w": "她们", "en": "they (females)"}]
        table = zh_hints.build(words, DIC, {"们": "an override"})
        self.assertEqual(table, {"是": "to speak 日 directly 疋: to be", "她": "a woman 女 beside you 也: she", "们": "an override"})

    def test_committed_overrides_are_sourced(self):
        ov = zh_hints.load_overrides()
        self.assertGreater(len(ov), 15)
        table = json.loads((ROOT / "tools" / "zh_hints.json").read_text(encoding="utf-8"))
        for c, h in ov.items():
            self.assertEqual(table[c], h, c)

    def test_new_hsk_character_enters_the_table_and_a_stale_table_fails_the_pack(self):
        import pack_from_hsk
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "data").mkdir()
            vocab = [{"w": "好", "py": "hǎo", "n": "hao3", "en": "good", "lv": 1}]
            (Path(d) / "data" / "hsk_vocab.json").write_text(json.dumps(vocab), encoding="utf-8")
            stale = zh_hints.build(zh_hints.hsk_words(d), DIC, {})
            stale_m = zh_hints.build_meanings(zh_hints.hsk_words(d), DIC, {})
            vocab.append({"w": "休", "py": "xiū", "n": "xiu1", "en": "to rest", "lv": 1})
            (Path(d) / "data" / "hsk_vocab.json").write_text(json.dumps(vocab), encoding="utf-8")
            fresh = zh_hints.build(zh_hints.hsk_words(d), DIC, {})
            fresh_m = zh_hints.build_meanings(zh_hints.hsk_words(d), DIC, {})
        self.assertNotIn("休", stale)
        self.assertEqual(fresh["休"], "a person 亻 leaning against a tree 木: to rest")
        units = [{"t": "好"}, {"t": "休息"}]
        with self.assertRaises(SystemExit) as e:
            pack_from_hsk.attach_hints([dict(u) for u in units], stale, stale_m, dict.fromkeys(stale_m, ""))
        self.assertIn("休", str(e.exception))
        ok = [dict(u) for u in units]
        pack_from_hsk.attach_hints(ok, dict(fresh, 息=None), dict(fresh_m, 息=None), dict.fromkeys([*fresh_m, "息"], ""))
        self.assertEqual(ok, [{"t": "好", "hint": [fresh["好"]]}, {"t": "休息", "hint": ["to rest", None]}])

    def test_meaning_is_the_pack_gloss_first_alternative_else_the_source_sense_unless_overridden(self):
        words = [{"w": "我", "en": "I; me; my"}, {"w": "我们", "en": "we; us"}]
        m = zh_hints.build_meanings(words, DIC, {"们": "(plural)", "我们:我": "we"})
        self.assertEqual(m["我"], "I")
        self.assertEqual(m["们"], "(plural)")
        self.assertEqual(m["我们:我"], "we")

    def test_compound_key_wins_for_that_compound_only_and_a_stale_one_fails(self):
        import pack_from_hsk
        meanings = {"衣": "clothes", "服": "clothes", "务": "duty", "员": "member", "服务员:服": "to serve"}
        units = [{"t": "衣服"}, {"t": "服务员"}]
        hints = {c: "x" for c in "衣服务员"}
        parts = dict.fromkeys(hints, "")
        pack_from_hsk.attach_hints(units, hints, meanings, parts)
        self.assertEqual(units[0]["hint"], ["clothes", "clothes"])
        self.assertEqual(units[1]["hint"], ["to serve", "duty", "member"])
        with self.assertRaises(SystemExit) as e:
            pack_from_hsk.attach_hints([{"t": "衣服"}], hints, dict(meanings, **{"制服:服": "uniform"}), parts)
        self.assertIn("制服:服", str(e.exception))

    def test_meaning_override_keys_are_validated(self):
        for key in ("服务员:我", "服:服", "服务员:服务"):
            with tempfile.TemporaryDirectory() as d:
                p = Path(d) / "o.json"
                p.write_text(json.dumps({"_meanings": {key: {"meaning": "m", "reason": "r", "source": "s"}}}), encoding="utf-8")
                with self.assertRaises(SystemExit, msg=key):
                    zh_hints.load_meaning_overrides(str(p))


class EmittedTest(unittest.TestCase):
    def test_committed_table_and_characters_json(self):
        table = json.loads((ROOT / "tools" / "zh_hints.json").read_text(encoding="utf-8"))
        self.assertEqual(table["好"], "a woman 女 with a son 子: good")
        self.assertEqual(table["是"], "to speak 日 directly 疋: to be")
        self.assertEqual(table["妈"], "女 (woman) + 马 (sound mǎ)")
        units = {u["t"]: u for u in json.loads((ROOT / "packs" / "zh" / "characters.json").read_text(encoding="utf-8"))}
        meanings = json.loads((ROOT / "tools" / "zh_hint_meanings.json").read_text(encoding="utf-8"))
        self.assertEqual(units["好"]["hint"], [table["好"]])
        m = "mother: 女 (woman) + 马 (sound mǎ)"
        self.assertEqual(units["妈妈"]["hint"], [m, m])
        self.assertEqual(units["休息"]["hint"][0], meanings["休"] + ": a person 亻 leaning against a tree 木")
        self.assertEqual(units["我们"]["hint"], ["I", "(plural): 亻 (people) + 门 (sound mén)"])
        self.assertEqual(units["衣服"]["hint"], ["clothes: picture of a woman's dress", "clothes: a person 卩 putting on 又 a coat 月"])
        self.assertEqual(units["服务员"]["hint"], ["to serve: a person 卩 putting on 又 a coat 月", "duty: 夂 to go + 力 strength", "staff: 贝 (money) + 口"])
        self.assertEqual(units["一会儿"]["hint"], ["one", "moment", "(suffix): picture of a child"])
        self.assertEqual(len(units), 1193)
        for u in units.values():
            self.assertIn("hint", u, u["id"])
            self.assertEqual(len(u["hint"]), len(u["t"]), u["id"])
            self.assertTrue(all(h for h in u["hint"]), u["id"])
            # the cap bounds the breakdown; fb43 puts the word-specific meaning in front of it
            self.assertTrue(all(len((h.partition(": ")[2] or h).split()) <= zh_hints.MAX_WORDS for h in u["hint"]), u["id"])


if __name__ == "__main__":
    unittest.main()
