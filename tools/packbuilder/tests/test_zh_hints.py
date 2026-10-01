"""Tests for tools/zh_hints.py (character memory hints for packs/zh) and their emission
into packs/zh/characters.json by tools/pack_from_hsk.py. Stdlib only; the source rows
below are verbatim Make Me a Hanzi dictionary.txt lines (matches/radical dropped).

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import json
import sys
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
    "{\"character\": \"文\", \"definition\": \"culture, literature, writing\", \"pinyin\": [\"wén\"], \"decomposition\": \"⿱亠乂\", \"etymology\": {\"type\": \"pictographic\", \"hint\": \"A tattooed chest, representing writing\"}}",
]
DIC = {d["character"]: d for d in map(json.loads, ROWS)}


class ComposeTest(unittest.TestCase):
    def test_ideographic(self):
        self.assertEqual(zh_hints.compose("好", DIC), "女 woman + 子 son: good")
        self.assertEqual(zh_hints.compose("休", DIC), "亻 person + 木 tree: to rest")
        self.assertEqual(zh_hints.compose("你", DIC), "亻 person + 尔 pronoun: you")

    def test_pictophonetic(self):
        self.assertEqual(zh_hints.compose("妈", DIC), "女 (woman) + 马 (sound mǎ)")
        self.assertEqual(zh_hints.compose("有", DIC), "月 (sound yuè)")

    def test_pictographic(self):
        self.assertEqual(zh_hints.compose("木", DIC), "picture of a tree")

    def test_ideographic_without_two_components_quotes_the_source(self):
        self.assertEqual(zh_hints.compose("一", DIC), "represents heaven (天), earth (旦), or the number 1: one")

    def test_no_etymology_lists_components_only(self):
        self.assertEqual(zh_hints.compose("这", DIC), "辶 to walk + 文 culture")

    def test_missing_character_has_no_hint(self):
        self.assertIsNone(zh_hints.compose("我", DIC))

    def test_word_limit(self):
        long = dict(DIC["木"], etymology={"type": "pictographic", "hint": " ".join(["w"] * 20)})
        self.assertEqual(zh_hints.compose("木", {"木": long}), "picture of tree")


class EmittedTest(unittest.TestCase):
    def test_committed_table_and_characters_json(self):
        table = json.loads((ROOT / "tools" / "zh_hints.json").read_text(encoding="utf-8"))
        self.assertEqual(table["好"], "女 woman + 子 son: good")
        self.assertEqual(table["休"], "亻 person + 木 tree: to rest")
        self.assertEqual(table["妈"], "女 (woman) + 马 (sound mǎ)")
        units = {u["t"]: u for u in json.loads((ROOT / "packs" / "zh" / "characters.json").read_text(encoding="utf-8"))}
        self.assertEqual(units["好"]["hint"], [table["好"]])
        self.assertEqual(units["妈妈"]["hint"], [table["妈"], table["妈"]])
        self.assertEqual(units["休息"]["hint"], [table["休"], table["息"]])
        for u in units.values():
            if "hint" in u:
                self.assertEqual(len(u["hint"]), len(u["t"]), u["id"])
                self.assertTrue(any(u["hint"]), u["id"])
                self.assertTrue(all(h is None or len(h.split()) <= zh_hints.MAX_WORDS for h in u["hint"]), u["id"])


if __name__ == "__main__":
    unittest.main()
