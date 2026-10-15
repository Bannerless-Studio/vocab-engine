#!/usr/bin/env python3
"""tools/packbuilder/core/kanji_aids.attach_hints merge of tools/ja_hint_compounds.json (hooks, bare and
unit:kanji parts, levels) and tools/ja_hints.load_compounds validation. Run: python3 tests/ja_hooks_checks.py"""
import json, os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from packbuilder.core import kanji_aids as K  # noqa: E402
import ja_hints as J  # noqa: E402


def entry(meaning, parts=()):
    return {"meaning": meaning, "glosses": [meaning], "on": [], "kun": [], "parts": [list(p) for p in parts]}


TABLE = {"学": entry("study", [("子", "child"), ("冖", "roof")]), "校": entry("school", [("木", "tree"), ("亠", "lid")]),
         "人": entry("person"), "間": entry("interval", [("日", "day"), ("門", "gate")])}


def units():
    return [{"id": "c1", "t": "人", "lv": "A1", "words": []}, {"id": "c2", "t": "学校", "lv": "A1", "words": []},
            {"id": "c3", "t": "人間", "lv": "A1", "words": []}, {"id": "c4", "t": "学校", "lv": "B1", "words": []},
            {"id": "c5", "t": "学", "lv": "A2", "words": []}]


def run(comp):
    us = units()
    K.attach_hints(us, TABLE, {}, {}, None, comp)
    return us


class Merge(unittest.TestCase):
    def test_no_compounds_no_hook(self):
        for u in run(None):
            self.assertNotIn("hook", u)

    def test_hook_on_multi_char_units_of_levels_only(self):
        us = run({"levels": ["A1"], "hooks": {"学校": "learn + school = school"}})
        self.assertEqual(us[1]["hook"], "learn + school = school")
        self.assertNotIn("hook", us[3])  # same text, level B1
        self.assertNotIn("hook", us[0])

    def test_bare_part_forced_unless_own_unit_earlier(self):
        # 学 has its unit after 学校: forced breakdown; 人 has its unit before 人間: a bare key for it matches no line
        us = run({"levels": ["A1"], "parts": {"学": "think: a child 子 under a roof"}})
        self.assertEqual(us[1]["hint"][0], "study: think: a child 子 under a roof")
        self.assertEqual(us[2]["hint"][0], "person")
        self.assertEqual(us[3]["hint"][0], "study")  # B1: not in levels, 学 has a (later) unit -> meaning only

    def test_unit_kanji_key_and_true(self):
        us = run({"levels": ["A1"], "parts": {"人間:間": True, "学校:学": "x y"}})
        self.assertEqual(us[2]["hint"][1], "interval: 日 day + 門 gate")
        self.assertEqual(us[1]["hint"][0], "study: x y")

    def test_stale_and_unusable_keys_fail(self):
        for comp in ({"hooks": {"学人": "x"}}, {"parts": {"学人:学": "x"}}, {"levels": ["A1"], "parts": {"校:校": "x"}},
                     {"levels": ["A1"], "parts": {"人": "x"}}, {"hooks": {"学校": ""}}, {"parts": {"学": "x"}},
                     {"levels": ["A1"], "parts": {"校": True, "木": "x"}}):
            with self.assertRaises(SystemExit, msg=str(comp)):
                run(comp)

    def test_true_without_table_breakdown_fails(self):
        with self.assertRaises(SystemExit):
            run({"levels": ["A1"], "parts": {"人間:人": True}})  # 人 has no breakdown in the table


class Validate(unittest.TestCase):
    def test_load_compounds_checks(self):
        us = units()
        path = os.path.join(os.path.dirname(__file__), "_ja_comp_tmp.json")
        try:
            def chk(d):
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(d, f, ensure_ascii=False)
                return J.load_compounds(us, {"学", "校", "人", "間"}, path)
            self.assertEqual(chk({"levels": ["A1"], "hooks": {"学校": "a b c"}, "parts": {"学": True, "学校:校": "x"}})["hooks"], {"学校": "a b c"})
            for bad in ({"hooks": {"学": "x"}}, {"hooks": {"学校": " ".join(["w"] * 13)}}, {"parts": {"木": "x"}},
                        {"parts": {"人間:学": "x"}}, {"parts": {"学": ""}}):
                with self.assertRaises(SystemExit, msg=str(bad)):
                    chk(bad)
        finally:
            if os.path.exists(path):
                os.remove(path)


if __name__ == "__main__":
    unittest.main()
