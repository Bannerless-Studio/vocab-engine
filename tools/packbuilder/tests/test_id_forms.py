"""Indonesian alt / forms split (langs/id.py finalize_words + alt_kind through
core.words.split_alt_forms). Alts, the typed answers, are only the
hand-listed spellings (ID_SPELLINGS: gak/enggak/ngga for nggak, tapi for
tetapi, nonton for menonton). Corpus inflections (affixed dibaca, enclitic
bukunya/pergilah, reduplicated anak-anak), voice_alt spellings (object-voice
lakukan, a rarer root) and the root a me- headword was swapped from (periksa
for memeriksa) are forms: located in text, never typed. The corpus is stubbed. Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_id_forms.py     (from vocab-engine/)
"""
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # vocab-engine/tools

from packbuilder.core.words import split_alt_forms  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402


def build(seen, voice=None):
    """finalize_words then split_alt_forms over one word per key in seen
    ({(lemma, group): Counter(corpus form)})."""
    sp = get_spec("id", None, load=False)
    sp._classifiers = lambda: {}
    sp.classifier_uses = lambda ctx: Counter()
    sp.inflection_forms = lambda ctx, words: seen
    sp.voice_alt = voice or {}
    words = [{"lemma": k[0], "w": k[0], "_key": k, "en": "x", "pos": k[1].lower()} for k in seen]
    sp.finalize_words(None, {}, words)
    split_alt_forms(sp, words)
    return {w["lemma"]: w for w in words}


class IdAltKind(unittest.TestCase):
    def test_clitic_affixed_and_reduplicated_uses_are_forms(self):
        out = build({("anak", "NOUN"): Counter({"anak-anak": 4, "anaknya": 3, "anakku": 1}),
                     ("pergi", "VERB"): Counter({"pergilah": 2}),
                     ("benar", "ADJ"): Counter({"benarkah": 1})})
        self.assertEqual(out["anak"]["forms"], ["anak-anak", "anaknya", "anakku"])
        self.assertEqual(out["pergi"]["forms"], ["pergilah"])
        self.assertEqual(out["benar"]["forms"], ["benarkah"])
        self.assertFalse(any("alt" in w for w in out.values()))

    def test_voice_alt_spellings_are_forms(self):
        out = build({("melakukan", "VERB"): Counter({"dilakukan": 2})}, voice={"melakukan": {"lakukan"}})
        self.assertNotIn("alt", out["melakukan"])
        self.assertEqual(sorted(out["melakukan"]["forms"]), ["dilakukan", "lakukan"])

    def test_swapped_root_is_a_form_like_every_bare_root(self):
        # periksa is seen bare in under 20% of its uses: shown as memeriksa; the
        # root is a stem, a form, as tulis is for menulis (voice_alt)
        out = build({("periksa", "VERB"): Counter({"memeriksa": 6, "diperiksa": 3, "periksa": 1}),
                     ("menulis", "VERB"): Counter()}, voice={"menulis": {"tulis"}})
        w = out["periksa"]
        self.assertEqual(w["w"], "memeriksa")
        self.assertNotIn("alt", w)
        self.assertEqual(w["forms"], ["periksa", "diperiksa"])
        self.assertEqual(out["menulis"]["forms"], ["tulis"])
        self.assertNotIn("alt", out["menulis"])

    def test_listed_spelling_variants_stay_alt(self):
        out = build({("nggak", "PART"): Counter(), ("tetapi", "CONJ"): Counter(),
                     ("menonton", "VERB"): Counter({"ditonton": 2})}, voice={"menonton": {"tonton", "nonton"}})
        self.assertEqual(out["nggak"]["alt"], ["gak", "enggak", "ngga"])
        self.assertNotIn("forms", out["nggak"])
        # the colloquial spelling is typed; the object-voice root and passive are forms
        self.assertEqual(out["menonton"]["alt"], ["nonton"])
        self.assertEqual(out["menonton"]["forms"], ["tonton", "ditonton"])
        self.assertEqual(out["tetapi"], {"lemma": "tetapi", "w": "tetapi", "_key": ("tetapi", "CONJ"), "en": "x",
                                         "pos": "conj", "alt": ["tapi"]})


if __name__ == "__main__":
    unittest.main()
