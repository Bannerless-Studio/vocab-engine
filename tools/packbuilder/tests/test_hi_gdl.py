"""Hindi Global Digital Library rows: gdl_fetch.recover (off-count twins), Hindi _stories filter, story_meta. Stdlib only, no network.

    python3 -m pytest -q tools/packbuilder/tests/test_hi_gdl.py     (from vocab-engine/)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(TOOLS / "story_fetch"))

import gdl_fetch as G  # noqa: E402
from packbuilder import hi_story as S  # noqa: E402
from packbuilder.langs.hi import Hindi  # noqa: E402
from packbuilder.core.util import Env  # noqa: E402

CREDIT = ("This book was made possible by Pratham Books' StoryWeaver platform. Story Attribution: This story: खोया पाया is translated by Poonam S. Kudesia . "
          "Released under CC BY 4.0 license. Other Credits: published on StoryWeaver by Pratham Books.")
HI_PAGES = [{"n": i, "text": "कुत्ते ने एक चिड़िया को देखा।"} for i in range(1, 5)]
EN_PAGES = [{"n": i, "text": "The dog sees a bird."} for i in range(1, 4)]


def hi_rec(bid, status="twin_null", rejected="textpages_4_vs_3", title="खोया पाया"):
    return {"id": bid, "source": "gdl", "lang": "hi", "slug": "x-" + bid, "title": title, "url": "https://content.digitallibrary.io/book/x/",
            "publisher": "Pratham books", "authors": ["A"], "translators": ["B"], "illustrators": ["C"], "credit_text": CREDIT,
            "source_name": "Global Digital Library / StoryWeaver (Pratham Books)", "licence_read": "CC-BY-4.0", "text_pages": HI_PAGES, "pages": 4,
            "twin": None, "twin_tried": [{"id": "900" + bid, "slug": "lost", "title": "Lost and Found", "url": "https://content.digitallibrary.io/book/lost/",
                                          "lang": "English", "rejected": rejected}], "status": status}


class Recover(unittest.TestCase):
    def run_recover(self, rec, class_list=("license-cc-by-4-0",), credit=CREDIT, pages=3):
        d = tempfile.mkdtemp()
        json.dump([{"id": int(rec["twin_tried"][0]["id"]), "slug": "lost", "title": {"rendered": "Lost and Found"}, "class_list": list(class_list), "link": "u"}],
                  open(f"{d}/list-en.json", "w"))
        json.dump(rec, open(f"{d}/{rec['id']}.json", "w"))
        json.dump({rec["id"]: {"status": rec["status"]}}, open(f"{d}/manifest.json", "w"))
        orig = (G.fetch_epub, G.text_pages, G.credit_text)
        G.fetch_epub = lambda *a, **k: ({"publisher": "Pratham", "roles": {"Author": ["Z"]}}, {})
        G.text_pages = lambda p: EN_PAGES[:pages]
        G.credit_text = lambda p: credit
        try:
            G.recover(d, None)
        finally:
            G.fetch_epub, G.text_pages, G.credit_text = orig
        return json.load(open(f"{d}/{rec['id']}.json")), json.load(open(f"{d}/manifest.json"))

    def test_accept(self):
        rec, mf = self.run_recover(hi_rec("1"))
        self.assertEqual(rec["status"], "ok_off")
        self.assertEqual(rec["twin"]["page_diff"], 1)
        self.assertEqual((rec["twin"]["licence"], rec["twin"]["licence_version"]), ("cc-by", "4.0"))
        self.assertEqual(mf["1"]["status"], "ok_off")

    def test_reject_big_gap_or_other_reason_or_licence(self):
        self.assertEqual(self.run_recover(hi_rec("2", rejected="textpages_20_vs_3"))[0]["status"], "twin_null")      # gap over 6
        self.assertEqual(self.run_recover(hi_rec("3", rejected="licence: book states CC-BY-NC-4.0"))[0]["status"], "twin_null")
        self.assertEqual(self.run_recover(hi_rec("4"), class_list=("license-cc-by-nc-4-0",))[0]["status"], "twin_null")   # GDL tag not allowed
        self.assertEqual(self.run_recover(hi_rec("5"), credit="Released under CC BY-NC 4.0 license.")[0]["status"], "twin_null")  # credit page not BY


class Filter(unittest.TestCase):
    def spec(self, recs):
        d = Path(tempfile.mkdtemp())
        g = d / ".cache" / "stories" / "hi-gdl"
        g.mkdir(parents=True)
        for r in recs:
            json.dump(r, open(g / f"{r['id']}.json", "w"), ensure_ascii=False)
        return Hindi(d), Env(Hindi(d))

    def story(self, bid, status="ok", lic="CC-BY-4.0", tlic=("cc-by", "4.0"), title="खोया पाया", etitle="Lost and Found"):
        r = hi_rec(bid, status=status, title=title)
        r["licence_read"] = lic
        r["twin"] = {"id": "900" + bid, "title": etitle, "url": "https://content.digitallibrary.io/book/lost/", "licence": tlic[0], "licence_version": tlic[1],
                     "text_pages": EN_PAGES, "authors": ["Z"], "page_diff": 1}
        return r

    def test_filter(self):
        recs = [self.story("1"), self.story("2", status="ok_off", title="दूसरी", etitle="Other"), self.story("3", status="twin_null", title="तीसरी", etitle="T3"),
                self.story("4", lic="CC-BY-NC-4.0", title="चौथी", etitle="T4"), self.story("5", tlic=("cc-by-nc", "4.0"), title="पाँचवीं", etitle="T5"),
                self.story("6", title="यीशु का जन्म", etitle="T6"), self.story("7", title="सातवीं", etitle="Lost and Found")]
        spec, env = self.spec(recs)
        got = spec._stories(env)
        self.assertEqual(sorted(got), ["1", "2"])           # twin_null, NC book, NC twin, scripture, duplicate English title all out
        self.assertEqual(got["1"]["_licence"], "CC-BY-4.0")

    def test_story_meta(self):
        spec, env = self.spec([self.story("1")])
        m = spec.story_meta(env, "1")
        self.assertEqual((m["id"], m["source"], m["licence"]), ("1", "Global Digital Library / StoryWeaver (Pratham Books)", "CC-BY-4.0"))
        self.assertEqual((m["authors"], m["translators"], m["illustrators"]), (["A"], ["B"], ["C"]))
        self.assertEqual((m["title"], m["english_title"], m["publisher"]), ("खोया पाया", "Lost and Found", "Pratham books"))
        self.assertTrue(m["credits"].startswith("This story: खोया पाया is translated by Poonam S. Kudesia"))
        self.assertEqual(m["english_authors"], ["Z"])
        self.assertTrue(m["english_url"].startswith("https://content.digitallibrary.io/"))


class ShiftGate(unittest.TestCase):
    def test_nonzero_page_shift_rejected(self):
        """An off-count twin whose best page shift is not 0 is dropped whole, even when its pages agree."""
        class Checks:
            story_rate = staticmethod(lambda pairs: 0.9)
            noun = staticmethod(lambda t: False)
            renamed = staticmethod(lambda u, e: False)
            agree_pair = staticmethod(lambda u, e: True)
            wrong_sense = staticmethod(lambda t, e: False)
        import re
        word = re.compile("[ऀ-ॣॱ-ॿ]+")
        us = ["कुत्ते ने एक चिड़िया को देखा।", "राजा भी कुत्ते के पीछे दौड़ा।", "बच्चा आज स्कूल जाता है।", "माँ घर में खाना बनाती है।"]
        es = ["The dog sees a bird.", "The king runs after the dog.", "The child goes to school today.", "Mother cooks food at home."]
        # twin numbered one page later (a cover page on its side): the page-length fit picks shift +1
        story = {"text_pages": [{"n": i + 1, "text": u} for i, u in enumerate(us)],
                 "twin": {"page_diff": 1, "text_pages": [{"n": i + 2, "text": e} for i, e in enumerate(es)]}}
        stats = S.A.Stats()
        out = S.story_pairs(story, word, lambda s: s, set(), stats, checks=Checks)
        self.assertEqual(S.A.page_shift(S.A._pages(story["text_pages"]), S.A._pages(story["twin"]["text_pages"])), 1)
        self.assertEqual(out, [])
        self.assertEqual(stats["stories_rejected"], 1)
        # shift 0 and a clear agreement: the pairs are read
        story0 = {"text_pages": story["text_pages"], "twin": {"page_diff": 1, "text_pages": [{"n": i + 1, "text": e} for i, e in enumerate(es)]}}
        self.assertTrue(S.story_pairs(story0, word, lambda s: s, set(), S.A.Stats(), checks=Checks))


if __name__ == "__main__":
    unittest.main()
