"""Indonesian story row filters (id_story.py) on real Let's Read Asia / Bloom Library sentence pairs. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_story.py     (from vocab-engine/)
"""
import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder import id_story as S  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402

WORD = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]+")


def run(id_page, en_page, checks=None):
    stats, seen = S.A.Stats(), set()
    story = {"text_pages": [{"n": 1, "text": id_page}], "twin": {"text_pages": [{"n": 1, "text": en_page}]}}
    out = S.story_pairs(story, WORD, lambda s: s, seen, stats, checks=checks)
    return out, stats


class StoryPairs(unittest.TestCase):
    def test_equal_counts_pair_as_they_are(self):          # Pratham, "Drake the Magical Dragon"
        out, st = run("Kasihan, si Drake mulai menangis! Apa dia bisa berhasil dan membuat ibunya bangga?",
                      "Poor Drake began to cry! Would he ever succeed and make his mother proud?")
        self.assertEqual([e for _, e, _ in out], ["Poor Drake began to cry!", "Would he ever succeed and make his mother proud?"])
        self.assertEqual(st["kept"], 2)             # names_kept: the Indonesian keeps Drake, so no rename drop

    def test_dangling_opener_dropped(self):                  # "Dan" + English "And"
        out, st = run("Dan itu membuat ibu naga SANGAT bangga.", "And this made mother dragon VERY proud.")
        self.assertEqual(out, [])
        self.assertEqual(st["opener"], 1)

    def test_too_short_dropped(self):
        out, st = run("Singa itu mengaum.", "The lion roars.")     # 3 tokens kept; 2 dropped
        self.assertEqual(len(out), 1)
        out, st = run("Singa mengaum.", "A lion roars.")
        self.assertEqual(out, [])
        self.assertEqual(st["token_count"], 1)

    def test_agreement_gate_drops_another_sentence(self):    # a pair whose words' glosses never show up in the English
        class C:
            noun = staticmethod(lambda t: False)
            wrong_sense = staticmethod(lambda toks, en: False)
            renamed = staticmethod(lambda u, e: False)
            agree_pair = staticmethod(lambda u, e: "elephant" in e.lower())
            story_rate = staticmethod(lambda pairs: 1.0)
        out, st = run("Pak Kepala Sekolah pun duduk di bangku.", "Headmaster Elephant settled down on a bench.", C)
        self.assertEqual(len(out), 1)
        out, st = run("Tempat tidurku naik ke dinding.", "Soil covers the roots.", C)
        self.assertEqual(out, [])
        self.assertEqual(st["no_agreement"], 1)

    def test_split_keeps_abbreviation_and_quote(self):
        self.assertEqual(S.A.split_target(S.ID, 'Gurunya berkata, "Kita harus mengerjakan soal-soal ini dulu." Lalu kami pulang.'),
                         ['Gurunya berkata, "Kita harus mengerjakan soal-soal ini dulu."', "Lalu kami pulang."])
        self.assertEqual(S.A.split_target(S.ID, "Bpk. Budi tiba. Kami senang."), ["Bpk. Budi tiba.", "Kami senang."])


class Helpers(unittest.TestCase):
    def test_bible_series_left_out(self):
        self.assertTrue(S.is_bible({"raw": {"tags": ["topic:Bible", "computedLevel:4"]}}))
        self.assertTrue(S.is_bible({"raw": {}, "credits": 'derivative of "Creative Commons Open Bible Stories" unfoldingWord'}))
        self.assertFalse(S.is_bible({"raw": {"tags": ["topic:Health"]}, "credits": ""}))

    def test_holder_and_names(self):
        self.assertEqual(S.holder("Copyright © 2023, Elisabet Lali Suluh dan Karel No"), "Elisabet Lali Suluh dan Karel No")
        self.assertEqual(S.names_of(["Natasha Sharma & Ruchi Shah"]), ["Natasha Sharma", "Ruchi Shah"])


def story_rec(source="lra", status="ok", licence=None, twin_licence=None, **kw):
    lic = licence or ("CC-BY-4.0" if source == "lra" else "cc-by")
    tlic = twin_licence or lic
    rec = {"id": kw.pop("id", "b1"), "source": source, "status": status, "title": "Jempol Anaya", "licence": lic,
           "url": "https://x/b1", "text_pages": [{"n": 1, "text": "Halo dunia."}],
           "twin": {"id": "t1", "title": "Anaya's Thumb", "licence": tlic, "roles": {"AUTHOR": ["Natasha Sharma"]},
                    "text_pages": [{"n": 1, "text": "Hello world."}]}}
    rec.update(kw)
    return rec


class Stories(unittest.TestCase):
    """spec._stories filtering (licence rule again at row time, ok_off kept, Bible books out) and story_meta."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.sp = get_spec("id", self.tmp, load=False)
        self.env = SimpleNamespace(repo=self.tmp)

    def put(self, d, rec):
        p = self.tmp / ".cache" / "stories" / d
        p.mkdir(parents=True, exist_ok=True)
        (p / (rec["id"] + ".json")).write_text(json.dumps(rec), encoding="utf-8")

    def test_filtering(self):
        self.put("id-lra", story_rec(id="ok"))
        self.put("id-lra", story_rec(id="off", status="ok_off"))
        self.put("id-lra", story_rec(id="null", status="twin_null", twin=None))
        self.put("id-lra", story_rec(id="nc", twin_licence="CC-BY-NC-4.0"))
        self.put("id-bloom", story_rec("bloom", id="bl", raw={"tags": ["topic:Health"]}))
        self.put("id-bloom", story_rec("bloom", id="bible", raw={"tags": ["topic:Bible"]}))
        self.put("id-bloom", story_rec("bloom", id="xmas", credits="A Little Zebra Book for Christmas", raw={}))
        self.put("id-bloom", story_rec("bloom", id="nc2", licence="cc-by-nc"))
        self.put("id-bloom", story_rec("bloom", id="sa", licence="cc-by-sa", raw={}))
        (self.tmp / ".cache/stories/id-lra/list.json").write_text("[]")            # the list file is no book
        self.assertEqual(sorted(self.sp._stories(self.env)), ["bl", "off", "ok", "sa"])

    def test_story_meta(self):
        self.put("id-lra", story_rec(id="l", roles={"AUTHOR": ["Natasha Sharma & Ruchi Shah"], "ILLUSTRATOR": ["Ruchi Shah"],
                                                      "PUBLISHER": ["Pratham Books"]}, original_url="https://sw/9263", origin_lang="Khmer"))
        self.put("id-bloom", story_rec("bloom", id="b", licence="cc-by-sa", copyright="Copyright © 2023, Yayasan X", credits="  Made\n with  help ",
                                       illustrators=["Gavin Thomson"], raw={}))
        m = self.sp.story_meta(self.env, "l")
        self.assertEqual((m["source"], m["authors"], m["publisher"], m["licence"], m["origin_language"]),
                         ("Let's Read Asia", ["Natasha Sharma", "Ruchi Shah"], ["Pratham Books"], "CC-BY-4.0", "Khmer"))
        self.assertEqual(m["english_url"], "https://www.letsreadasia.org/book/t1")
        m = self.sp.story_meta(self.env, "b")
        self.assertEqual((m["source"], m["licence"], m["copyright_holder"], m["credits"], m["illustrators"]),
                         ("Bloom Library", "CC-BY-SA-4.0", "Yayasan X", "Made with help", ["Gavin Thomson"]))


class Checks(unittest.TestCase):
    """spec._story_checks on a tiny words.json (Sastrawi stubbed: root = the token)."""

    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "pack").mkdir()
        words = [{"id": "w1", "w": "anak", "lemma": "anak", "pos": "noun", "en": "child", "forms": ["anak-anak", "anaknya"]},
                 {"id": "w2", "w": "membaca", "lemma": "baca", "pos": "verb", "en": "to read", "forms": ["baca", "dibaca"]},
                 {"id": "w3", "w": "adalah", "lemma": "adalah", "pos": "verb", "en": "to be", "forms": []}]
        (tmp / "pack" / "words.json").write_text(json.dumps(words), encoding="utf-8")
        self.sp = get_spec("id", tmp, load=False)
        self.sp._stem = lambda t: t
        self.c = self.sp._story_checks(SimpleNamespace(repo=tmp))

    def test_noun_and_agree(self):
        self.assertTrue(self.c.noun("anaknya"))
        self.assertFalse(self.c.noun("baca"))
        self.assertTrue(self.c.agree_pair("Anak itu membaca buku.", "The child reads a book."))
        self.assertFalse(self.c.agree_pair("Anak itu membaca buku.", "Soil covers the roots."))
        self.assertTrue(self.c.agree_pair("Dia adalah dia.", "Whatever."))             # copula carries no gloss: nothing to check

    def test_renamed(self):
        self.assertTrue(self.c.renamed("Kemarin Santi membaca buku.", "Yesterday Sokha read a book."))
        self.assertFalse(self.c.renamed("Kemarin Ani membaca buku.", "Yesterday Ani read a book."))
        self.assertFalse(self.c.renamed("Santi membaca buku.", "Sokha read a book."))      # sentence-initial: never flagged

    def test_story_rate(self):
        good = ("Anak itu membaca.", "The child reads.")
        bad = ("Anak itu membaca.", "Soil covers the roots.")
        self.assertEqual(self.c.story_rate([good, good, bad]), 2 / 3)
        self.assertIsNone(self.c.story_rate([good, bad]))                                   # under 3 comparable pages


class OffCount(unittest.TestCase):
    def pages(self, n):
        return [{"n": i, "text": "Anak membaca buku di rumah."} for i in range(1, n + 1)]

    def run_story(self, rate, page_diff, first=1):
        class C:
            noun = staticmethod(lambda t: False)
            wrong_sense = staticmethod(lambda toks, en: False)
            renamed = staticmethod(lambda u, e: False)
            agree_pair = staticmethod(lambda u, e: True)
            story_rate = staticmethod(lambda pairs: rate)
        twin = {"text_pages": [{"n": i, "text": "The child reads a book at home."} for i in range(first, first + 4)]}
        if page_diff:
            twin["page_diff"] = page_diff
        story = {"text_pages": self.pages(4), "twin": twin}
        stats = S.A.Stats()
        out = S.story_pairs(story, WORD, lambda s: s, set(), stats, checks=C)
        return out, stats

    def test_recovered_twin_needs_a_higher_rate(self):
        out, st = self.run_story(0.6, 1)
        self.assertEqual((out, st["off_count_rejected"], st["stories_rejected"]), ([], 4, 1))
        out, st = self.run_story(0.6, 0)                     # an exact twin passes at 0.6
        self.assertEqual(len(out), 1)
        out, st = self.run_story(0.75, -2)
        self.assertEqual(len(out), 1)

    def test_recovered_twin_needs_page_shift_zero(self):
        out, st = self.run_story(1.0, -1, first=2)           # page numbers offset by one: shifted pairs were 17% bad in the re-read
        self.assertEqual((out, st["stories_rejected"]), ([], 1))
        out, st = self.run_story(1.0, 0, first=2)            # an exact twin keeps the shift
        self.assertEqual(len(out), 1)


def load_lra():
    spec = importlib.util.spec_from_file_location("lra_fetch", Path(__file__).resolve().parents[2] / "story_fetch" / "lra_fetch.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)           # main() is guarded: importing fetches nothing
    return m


class Recover(unittest.TestCase):
    """lra_fetch.recover: re-fetch the twin of twin_null books whose only reject is a page count off by 1-2."""

    def write(self, d, name, rejected, status="twin_null", twin_id="tw1"):
        rec = {"id": name, "status": status, "twin": None, "twin_tried": [{"id": twin_id, "rejected": rejected}], "text_pages": []}
        (d / (name + ".json")).write_text(json.dumps(rec), encoding="utf-8")

    def test_recover(self):
        m = load_lra()
        d = Path(tempfile.mkdtemp())
        n = lambda c: c * 36
        self.write(d, n("a"), ["textpages_9_vs_10"])                       # off by 1: recovered
        self.write(d, n("b"), ["textpages_12_vs_9"])                       # off by 3: no
        self.write(d, n("c"), ["textpages_9_vs_10", "licence_CC-BY-NC-4.0"])    # two rejects: no
        self.write(d, n("d"), ["textpages_9_vs_10"], status="ok")           # already fine: no
        self.write(d, n("e"), ["textpages_11_vs_9"], twin_id="nc")          # off by 2 but the twin is NC: no
        (d / "manifest.json").write_text("{}")
        fetched = []

        def fake_get(path):
            fetched.append(path)
            return {"name": "Twin", "license": "CC-BY-NC-4.0" if path.endswith("nc") else "CC-BY-4.0",
                    "pages": [{"pageNum": 1, "extractedLongContentValue": "Hello."}], "collaboratorsByRole": {}}
        m.get = fake_get
        m.recover(str(d))
        self.assertEqual(len(fetched), 2)                                  # a and e only
        a = json.loads((d / (n("a") + ".json")).read_text())
        self.assertEqual((a["status"], a["twin"]["page_diff"], a["twin"]["licence"]), ("ok_off", -1, "CC-BY-4.0"))
        self.assertEqual(json.loads((d / (n("e") + ".json")).read_text())["status"], "twin_null")
        self.assertEqual(json.loads((d / (n("b") + ".json")).read_text())["status"], "twin_null")


if __name__ == "__main__":
    unittest.main()
