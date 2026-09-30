"""gloss_overrides.json reaches every record kind through
core.words.overridden_gloss, and core.words.check_gloss_overrides turns any key
the build could not apply (dead key, FORM record, a record built around it)
into a build error instead of a silent skip; a key a spec hook consumed
without its text landing in a gloss is registered (spec.use_override) and
passes. Stdlib only."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.words import check_gloss_overrides, overridden_gloss  # noqa: E402


def spec(**ov):
    return SimpleNamespace(gloss_overrides=ov)


class OverriddenGloss(unittest.TestCase):
    def test_phrase_key_replaces_the_phrase_gloss(self):
        applied = []
        sp = spec(**{"per favore|phrase": "please (polite)"})
        self.assertEqual(overridden_gloss(sp, ("per favore", "PHRASE"), "please", applied), "please (polite)")
        self.assertEqual(applied, ["per favore|phrase"])

    def test_word_key_uses_the_pack_pos_label(self):
        applied = []
        sp = spec(**{"stare|verb": "to stay", "me|pron": "me, myself"})
        self.assertEqual(overridden_gloss(sp, ("stare", "VERB"), "to be", applied), "to stay")
        self.assertEqual(overridden_gloss(sp, ("me", "PRON"), "me", applied), "me, myself")
        self.assertEqual(applied, ["stare|verb", "me|pron"])

    def test_no_key_keeps_the_gloss(self):
        applied = []
        self.assertEqual(overridden_gloss(spec(), ("casa", "NOUN"), "house", applied), "house")
        self.assertEqual(applied, [])


def rec(lem, g, en):
    return {"lemma": lem, "group": g, "en": en}


class CheckGlossOverrides(unittest.TestCase):
    records = {("è", "FORM"): rec("è", "FORM", "is (from essere)"),
               ("per favore", "PHRASE"): rec("per favore", "PHRASE", "please (polite)"),
               ("stare", "VERB"): rec("stare", "VERB", "to stay"),
               ("आ जाना", "VERB"): rec("आ जाना", "VERB", "to come"),
               ("casa", "NOUN"): rec("casa", "NOUN", "house")}
    words = [{"w": "è", "lemma": "è", "pos": "verb", "en": "is (from essere)", "_key": ("è", "FORM")},
             {"w": "la casa", "lemma": "casa", "pos": "noun", "en": "house", "_key": ("casa", "NOUN")}]

    def check(self, ov, applied=()):
        return check_gloss_overrides(ov, set(applied), self.records, self.words)

    def test_applied_and_hook_applied_keys_pass(self):
        ov = {"per favore|phrase": "please (polite)", "stare|verb": "to stay", "आ जाना|verb": "to come"}
        self.assertEqual(self.check(ov, ["per favore|phrase", "stare|verb"]), [])

    def test_dead_key_is_an_error(self):
        self.assertEqual(self.check({"cassa|noun": "till"}), [("cassa|noun", "matches no record")])

    def test_form_record_key_is_an_error_under_either_label(self):
        bad = self.check({"è|form": "is", "è|verb": "is"})
        self.assertEqual([k for k, _ in bad], ["è|form", "è|verb"])
        self.assertTrue(all("FORM" in why for _, why in bad))

    def test_record_built_without_the_override_is_an_error(self):
        self.assertEqual(self.check({"casa|noun": "home"}),
                         [("casa|noun", "record kind NOUN was built without applying it")])

    def test_every_bad_key_is_listed(self):
        bad = self.check({"a|noun": "x", "b|verb": "y", "stare|verb": "to stay"}, ["stare|verb"])
        self.assertEqual([k for k, _ in bad], ["a|noun", "b|verb"])


class SpecHookConsumers(unittest.TestCase):
    """The class of key a hook consumes without its text reaching a record
    gloss (ja 無し|noun merges 無し into なし; id meledak|verb makes meledak its
    own lexicon entry): registered keys pass, unregistered ones still fail."""

    def test_override_registers_hits_only(self):
        from packbuilder.langs.base import LanguageSpec
        sp = LanguageSpec()
        sp.gloss_overrides = {"無し|noun": "without, none"}
        self.assertEqual(sp.override("無し|noun"), "without, none")
        self.assertIsNone(sp.override("なし|noun"))
        self.assertEqual(sp.overrides_used, {"無し|noun"})

    def test_registered_key_with_no_record_passes_and_dead_key_still_fails(self):
        ov = {"無し|noun": "without, none", "cassa|noun": "till"}
        bad = check_gloss_overrides(ov, {"無し|noun"}, CheckGlossOverrides.records, CheckGlossOverrides.words)
        self.assertEqual(bad, [("cassa|noun", "matches no record")])

    def ko_lexicon(self, entries):
        return SimpleNamespace(E=entries, usable_entries=lambda w, kp: [e for e in entries.get(w, []) if e["p"] in kp])

    def test_ko_entry_hook_registers_the_key_it_builds_an_entry_from(self):
        from packbuilder.langs.ko import Korean
        sp = Korean()
        sp.gloss_overrides = {"지치다|verb": "to get tired", "먹다|verb": "to eat", "없다|noun": "x"}
        lx = self.ko_lexicon({"지치다": [{"p": "adj", "s": [["tired"]]}], "먹다": [{"p": "verb", "s": [["to eat"]]}]})
        sp._override_entries(lx)
        # 먹다 already has a verb entry and 없다 has none at all: neither key built anything
        self.assertEqual(sp.overrides_used, {"지치다|verb"})
        self.assertEqual(lx.E["지치다"][-1]["s"][0][0], "to get tired")

    def test_tag_cache_keeps_registrations_made_while_tagging(self):
        from packbuilder.core import tag as coretag
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "tagged_x.jsonl.gz"

            def fix_sentence(toks, row, doc):
                fake.overrides_used.add("ガン|noun")
                return toks
            fake = SimpleNamespace(word_re=__import__("re").compile(r"\w+"), sentence_openers="",
                                   tag_text=lambda t: t, fix_token=lambda t: t, fix_sentence=fix_sentence,
                                   morph_keep=None, tagger="custom", spacy_model=None, overrides_used=set())
            fake.tag_texts = lambda texts: [[("a", "a", "X", {})] for _ in texts]
            env = SimpleNamespace(spec=fake)
            with mock.patch.object(coretag, "tagged_path", lambda env, c: (out, "fake")), \
                    mock.patch.object(coretag, "corpus_path", lambda env: Path(d) / "corpus.json.gz"):
                coretag.stage_tag(env, {"rows": [[1, "a", "", "", None, ""]]})
                self.assertEqual(json.loads(out.with_suffix(".meta.json").read_text())["overrides_used"], ["ガン|noun"])
                fake.overrides_used = set()
                coretag.stage_tag(env, {"rows": []})          # cached: fix_sentence does not run
                self.assertEqual(fake.overrides_used, {"ガン|noun"})


if __name__ == "__main__":
    unittest.main()
