"""Indonesian me- verb roots (langs/id.py me_roots, nasal_ok, bind_lexicon
step 2b). A root the nasal rule cannot produce is never generated
(memutuskan is putus, not utus), and a stripped root becomes a surface of
the me- verb (voice_alt, a form located in text) only when attested as it:
a shared sense, or a verb with no other part of speech. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_roots.py     (from vocab-engine/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402
from packbuilder.langs.id import me_roots  # noqa: E402


class NasalRule(unittest.TestCase):
    def test_vowel_after_mem_men_restores_the_consonant(self):
        self.assertNotIn("utuskan", me_roots("memutuskan"))
        self.assertIn("putuskan", me_roots("memutuskan"))
        self.assertNotIn("urunkan", me_roots("menurunkan"))
        self.assertIn("turunkan", me_roots("menurunkan"))
        self.assertNotIn("unjukkan", me_roots("menunjukkan"))
        self.assertIn("tunjukkan", me_roots("menunjukkan"))
        self.assertIn("tawarkan", me_roots("menawarkan"))

    def test_consonant_roots_stay(self):
        self.assertIn("tulis", me_roots("menulis"))           # men + t- lost
        self.assertIn("beli", me_roots("membeli"))            # mem + b-
        self.assertIn("pakai", me_roots("memakai"))
        self.assertIn("dengar", me_roots("mendengar"))        # men + d-
        self.assertIn("lakukan", me_roots("melakukan"))       # me + l-
        self.assertIn("sapu", me_roots("menyapu"))
        self.assertIn("punyai", me_roots("mempunyai"))        # p kept (loan pattern)

    def test_meng_takes_vowels_and_g_h(self):
        self.assertIn("ambil", me_roots("mengambil"))
        self.assertIn("kambil", me_roots("mengambil"))
        self.assertIn("gunakan", me_roots("menggunakan"))
        self.assertIn("hasilkan", me_roots("menghasilkan"))
        self.assertNotIn("kgunakan", me_roots("menggunakan"))

    def test_di_is_unaffected(self):
        self.assertIn("tulis", me_roots("ditulis"))


def ent(pos, *glosses):
    return {"p": pos, "s": [[g, "", [], ""] for g in glosses]}


class Lx:
    def __init__(self, E, zipf):
        self.E, self.F, self._z = E, {}, zipf

    def zipf(self, w):
        return self._z.get(w, 0.0)

    def entry_usable(self, e):
        return any(sn[3] == "" for sn in e["s"])

    def usable_entries(self, w, kpos):
        return [e for e in self.E.get(w, []) if (kpos is None or e["p"] in kpos) and self.entry_usable(e)]


def bind(E, zipf):
    sp = get_spec("id", None, load=False)
    lx = Lx(E, zipf)
    sp.bind_lexicon(lx)
    return sp, lx


class StrippedRootAttestation(unittest.TestCase):
    def test_root_with_other_pos_and_no_shared_sense_is_not_a_surface(self):
        # menawarkan "to offer" / tawar "to bargain" + adj "bland"
        sp, lx = bind({"menawarkan": [ent("verb", "to offer")],
                       "tawar": [ent("verb", "to bargain"), ent("adj", "bland")]},
                      {"menawarkan": 4.9, "tawar": 4.3})
        self.assertNotIn("tawar", sp.voice_alt.get("menawarkan", set()))
        self.assertEqual(sp.voice_root_dropped[("menawarkan", "tawar")], 1)
        # its verb-tagged tokens still count toward the me- verb
        self.assertIn(["menawarkan", "verb", "form"], [list(f) for f in lx.F.get("tawar", [])])

    def test_root_sharing_a_sense_is_a_surface(self):
        sp, _ = bind({"menawarkan": [ent("verb", "to offer")],
                      "tawar": [ent("verb", "to offer"), ent("adj", "bland")]},
                     {"menawarkan": 4.9, "tawar": 4.3})
        self.assertIn("tawar", sp.voice_alt.get("menawarkan", set()))

    def test_verb_only_root_is_a_surface(self):
        # menghindari "to avoid" / hindar "to evade": no shared word, verb only
        sp, _ = bind({"menghindari": [ent("verb", "to avoid")], "hindar": [ent("verb", "to evade")]},
                     {"menghindari": 4.8, "hindar": 0.0})
        self.assertIn("hindar", sp.voice_alt.get("menghindari", set()))

    def test_raw_form_of_line_attests_root(self):
        # terap "alternative form of menerapkan" (kaikki), though also a noun
        sp, _ = bind({"menerapkan": [ent("verb", "to apply")],
                      "terap": [ent("verb", "to carve"), {"p": "verb", "s": [["alternative form of menerapkan", "", [], "form"]]},
                                ent("noun", "Artocarpus blumei")]},
                     {"menerapkan": 4.5, "terap": 0.0})
        self.assertIn("terap", sp.voice_alt.get("menerapkan", set()))

    def test_raw_active_of_line_attests_root(self):
        # mengabaikan "active of abaikan": step 1 rewrites that sense, the raw line counts
        sp, _ = bind({"mengabaikan": [ent("verb", "to ignore", "active of abaikan")],
                      "abai": [ent("verb", "not to care"), ent("adj", "careless")]},
                     {"mengabaikan": 4.5, "abai": 3.1})
        self.assertIn("abai", sp.voice_alt.get("mengabaikan", set()))

    def test_form_of_another_verb_does_not_attest(self):
        sp, _ = bind({"menawarkan": [ent("verb", "to offer")],
                      "tawar": [{"p": "verb", "s": [["form of menawar", "", [], "form"]]}, ent("verb", "to bargain"),
                                ent("adj", "bland")]},
                     {"menawarkan": 4.9, "tawar": 4.3})
        self.assertNotIn("tawar", sp.voice_alt.get("menawarkan", set()))

    def test_impossible_root_is_never_tried(self):
        # unjuk "to show" shares the sense but men- + vowel is not Indonesian
        sp, lx = bind({"menunjukkan": [ent("verb", "to show")], "unjuk": [ent("verb", "to show")],
                       "tunjuk": [ent("verb", "to show")]},
                      {"menunjukkan": 5.5, "unjuk": 1.0, "tunjuk": 4.1})
        self.assertNotIn("unjuk", sp.voice_alt.get("menunjukkan", set()))
        self.assertIn("tunjuk", sp.voice_alt.get("menunjukkan", set()))
        self.assertNotIn("unjuk", lx.F)


if __name__ == "__main__":
    unittest.main()
