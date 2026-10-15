#!/usr/bin/env python3
"""tools/pack_from_hsk.attach_hints merge of tools/zh_hint_compounds.json (hooks + forced parts)
and tools/zh_hints.load_compounds validation. Run: python3 tests/zh_hooks_checks.py"""
import json, os, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import pack_from_hsk as P  # noqa: E402
import zh_hints as Z  # noqa: E402

HINTS = {c: f"h{c}" for c in "学习好人"}
MEANINGS = {"学": "to study", "习": "to study", "好": "good", "人": "person"}
PARTS = {"学": "a building 冖 where children 子 study", "习": None, "好": "a woman 女 with a son 子", "人": "picture of a person"}


def units():
    return [{"t": "学习"}, {"t": "好人"}, {"t": "人"}]


def run(comp):
    us = units()
    P.attach_hints(us, HINTS, MEANINGS, PARTS, comp)
    return {u["t"]: u for u in us}


class Merge(unittest.TestCase):
    def test_without_compounds_unchanged_and_no_hook(self):
        u = run(None)
        self.assertNotIn("hook", u["学习"])
        self.assertEqual(u["学习"]["hint"], ["to study: a building 冖 where children 子 study", "to study"])
        self.assertEqual(u["好人"]["hint"], ["good: a woman 女 with a son 子", "person"])

    def test_hook_set_on_multi_char_unit_only(self):
        u = run({"hooks": {"学习": "learn + practise = study"}})
        self.assertEqual(u["学习"]["hook"], "learn + practise = study")
        self.assertNotIn("hook", u["好人"])
        self.assertNotIn("hook", u["人"])

    def test_forced_parts_string_and_true(self):
        u = run({"parts": {"学习:习": "think: wings 羽 flapping", "好人:人": True}})
        self.assertEqual(u["学习"]["hint"][1], "to study: think: wings 羽 flapping")
        self.assertEqual(u["好人"]["hint"][1], "person: picture of a person")
        self.assertEqual(u["好人"]["hint"][0], "good: a woman 女 with a son 子")

    def test_stale_keys_fail(self):
        for comp in ({"hooks": {"学生": "x"}}, {"hooks": {"人": "x"}}, {"parts": {"学生:学": "x"}},
                     {"parts": {"学习:人": "x"}}, {"hooks": {"学习": " "}}, {"parts": {"学习:习": True}}):
            with self.assertRaises(SystemExit, msg=str(comp)):
                run(comp)

    def test_shipped_file_is_valid_for_the_vocabulary(self):
        path = os.path.join(ROOT, "tools", "zh_hint_compounds.json")
        data = json.load(open(path, encoding="utf-8"))
        words = [{"w": k} for k in data["hooks"]] + [{"w": k.partition(":")[0]} for k in data["parts"]]
        self.assertEqual(Z.load_compounds(words, path), data)
        for k, v in data["hooks"].items():
            self.assertLessEqual(len(v.split()), Z.MAX_WORDS, k)


class Validate(unittest.TestCase):
    def check(self, data, words):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "c.json")
            json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False)
            return Z.load_compounds(words, p)

    def test_rejects(self):
        words = [{"w": "学习"}, {"w": "好"}]
        self.check({"hooks": {"学习": "a + b = c"}}, words)
        for bad in ({"hooks": {"好": "x"}}, {"hooks": {"学习": "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"}},
                    {"parts": {"学习:好": True}}, {"parts": {"学习:习": ""}}):
            with self.assertRaises(SystemExit, msg=str(bad)):
                self.check(bad, words)


if __name__ == "__main__":
    unittest.main()
