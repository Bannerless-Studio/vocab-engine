"""German linker classes (langs/de.py _linker_classes, choose_entries): fixed expressions
whose member has another sense, a direction adverb read as its homograph adjective, a
present participle read as its verb, a loan homograph noun against the native noun, the
passage_no_link twin of the build-time unlinks, and the separable umsteigen span. Stdlib only.

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402

TMP = tempfile.mkdtemp()


def T(text, upos="X", lemma=None, tag=""):
    return [text, lemma or text.lower(), upos, "Tag=" + tag if tag else ""]


class Lex:
    F = {}

    def __init__(self, entries=None):
        self.E = entries or {}

    def usable_entries(self, w, poses):
        return [e for e in self.E.get(w, []) if e["p"] in poses]

    def candidates(self, low, poses):
        return [w for w in self.E if w == low and self.usable_entries(w, poses)]

    def best_by_freq(self, c):
        return sorted(c)[0]


def spec(entries=None):
    sp = get_spec("de", TMP)
    sp._lex, sp._vscore = Lex(entries), {}
    return sp


def run(toks, out, entries=None):
    return spec(entries)._linker_classes(toks, list(out))


ADJ_ADV = {"rein": [{"p": "adj"}, {"p": "adv"}]}


class Idioms(unittest.TestCase):
    def test_denn_je_links_no_conjunction_je_stays(self):
        t = [T("Sie", "PRON"), T("sind", "AUX"), T("schöner", "ADJ"), T("denn", "CCONJ"), T("je", "ADV"), T(".", "PUNCT")]
        out = run(t, [None, None, ("schön", "ADJ"), ("denn", "CONJ"), ("je", "ADV"), None])
        self.assertIsNone(out[3])
        self.assertEqual(out[4], ("je", "ADV"))

    def test_denn_as_conjunction_stays(self):
        t = [T("Ich", "PRON"), T("gehe", "VERB"), T("heim", "ADV"), T(",", "PUNCT"), T("denn", "CCONJ"), T("ich", "PRON")]
        out = run(t, [None, None, None, None, ("denn", "CONJ"), None])
        self.assertEqual(out[4], ("denn", "CONJ"))

    def test_recht_und_billig_is_not_cheap(self):
        t = [T("Das", "PRON"), T("klingt", "VERB"), T("recht", "ADV"), T("und", "CCONJ"), T("billig", "ADJ"), T(".", "PUNCT")]
        out = run(t, [None, None, ("recht", "ADV"), ("und", "CONJ"), ("billig", "ADJ"), None])
        self.assertIsNone(out[4])
        self.assertEqual(out[2], ("recht", "ADV"))

    def test_billig_cheap_stays(self):
        t = [T("Es", "PRON"), T("ist", "AUX"), T("billig", "ADJ"), T(".", "PUNCT")]
        self.assertEqual(run(t, [None, None, ("billig", "ADJ"), None])[2], ("billig", "ADJ"))

    def test_vor_allem_is_not_everything_vor_keeps_its_link(self):
        t = [T("Wichtig", "ADJ"), T("ist", "AUX"), T("vor", "ADP"), T("allem", "PRON"), T(".", "PUNCT")]
        out = run(t, [None, None, ("vor", "ADP"), ("alles", "PRON"), None])
        self.assertIsNone(out[3])
        self.assertEqual(out[2], ("vor", "ADP"))

    def test_angst_vor_allem_stays_everything(self):
        t = [T("Er", "PRON"), T("hat", "AUX"), T("Angst", "NOUN", "Angst"), T("vor", "ADP"), T("allem", "PRON"), T(".", "PUNCT")]
        out = run(t, [None, None, ("Angst", "NOUN"), ("vor", "ADP"), ("alles", "PRON"), None])
        self.assertEqual(out[4], ("alles", "PRON"))

    def test_trotz_allem_stays_everything(self):
        t = [T("Trotz", "ADP"), T("allem", "PRON")]
        self.assertEqual(run(t, [("trotz", "ADP"), ("alles", "PRON")])[1], ("alles", "PRON"))


class DirectionAdverb(unittest.TestCase):
    def test_lass_den_hund_nicht_rein_is_the_adverb(self):
        t = [T("Lass", "VERB"), T("den", "DET"), T("Hund", "NOUN"), T("nicht", "PART"), T("rein", "ADJ", tag="ADJD"), T(".", "PUNCT")]
        out = run(t, [None, None, None, None, ("rein", "ADJ"), None], ADJ_ADV)
        self.assertEqual(out[4], ("rein", "ADV"))

    def test_predicative_rein_stays_the_adjective(self):
        for t, k in (([T("Das", "PRON"), T("Wasser", "NOUN"), T("ist", "AUX", "sein"), T("rein", "ADJ", tag="ADJD"), T(".", "PUNCT")], 3),
                     ([T("Wenn", "SCONJ"), T("der", "DET"), T("Geist", "NOUN"), T("rein", "ADJ", tag="ADJD"), T("ist", "AUX", "sein")], 3)):
            out = run(t, [None] * k + [("rein", "ADJ")] + [None] * (len(t) - k - 1), ADJ_ADV)
            self.assertEqual(out[k], ("rein", "ADJ"))

    def test_rein_before_an_adjective_is_purely(self):
        t = [T("Es", "PRON"), T("war", "AUX", "sein"), T("eine", "DET"), T("rein", "ADJ", tag="ADJD"), T("familiäre", "ADJ")]
        out = run(t, [None, None, None, ("rein", "ADJ"), None], ADJ_ADV)
        self.assertEqual(out[3], ("rein", "ADV"))

    def test_perfect_auxiliary_sein_is_not_a_copula(self):
        gegangen = ["gegangen", "gehen", "VERB", "VerbForm=Part|Tag=VVPP"]
        t = [T("Wir", "PRON"), T("sind", "AUX", "sein"), T("rein", "ADJ", tag="ADJD"), gegangen, T(".", "PUNCT")]
        out = run(t, [None, None, ("rein", "ADJ"), None, None], ADJ_ADV)
        self.assertEqual(out[2], ("rein", "ADV"))

    def test_copula_with_a_participle_in_another_clause_still_predicate(self):
        gegangen = ["gegangen", "gehen", "VERB", "VerbForm=Part|Tag=VVPP"]
        t = [T("Das", "PRON"), T("Wasser", "NOUN"), T("ist", "AUX", "sein"), T("rein", "ADJ", tag="ADJD"), T(",", "PUNCT"),
             T("er", "PRON"), T("ist", "AUX", "sein"), gegangen]
        out = run(t, [None, None, None, ("rein", "ADJ"), None, None, None, None], ADJ_ADV)
        self.assertEqual(out[3], ("rein", "ADJ"))

    def test_inflected_adjective_is_not_touched(self):
        t = [T("reine", "ADJ", "rein", tag="ADJA"), T("Luft", "NOUN")]
        self.assertEqual(run(t, [("rein", "ADJ"), None], ADJ_ADV)[0], ("rein", "ADJ"))


class Participle(unittest.TestCase):
    def test_eingehend_adverb_is_not_eingehen(self):
        for upos, tag in (("ADV", "ADJD"), ("VERB", "VVPP")):          # the tagger gives either
            t = [T("betrachtete", "VERB"), T("mich", "PRON"), T("eingehend", upos, "eingehend", tag), T(".", "PUNCT")]
            out = run(t, [None, None, ("eingehen", "VERB"), None], {"eingehen": [{"p": "verb"}]})
            self.assertIsNone(out[2], tag)

    def test_once_the_pack_is_known_only_a_pack_verb_participle_is_unlinked(self):
        sp = spec({"eingehen": [{"p": "verb"}], "überraschen": [{"p": "verb"}]})
        sp.note_words([{"_key": ("eingehen", "VERB")}])
        for lem, kept in (("eingehend", False), ("überraschend", True)):
            t = [T("sehr", "ADV"), T(lem, "ADV", lem, "ADJD")]
            self.assertEqual(sp._linker_classes(t, [None, (lem[:-1], "VERB")])[1] is not None, kept, lem)

    def test_pack_adjective_wins_over_unlinking(self):
        sp = spec({"spannen": [{"p": "verb"}], "spannend": [{"p": "adj"}]})
        sp.note_words([{"_key": ("spannen", "VERB")}, {"_key": ("spannend", "ADJ")}])
        t = [T("Das", "PRON"), T("spannend", "ADJ", "spannend", "ADJD")]
        self.assertEqual(sp._linker_classes(t, [None, ("spannen", "VERB")])[1], ("spannend", "ADJ"))

    def test_dictionary_adjective_outside_the_pack_is_unlinked_not_dropped(self):
        sp = spec({"eingehen": [{"p": "verb"}], "eingehend": [{"p": "adj"}]})
        sp.note_words([{"_key": ("eingehen", "VERB")}])
        t = [T("sehr", "ADV"), T("eingehend", "ADV", "eingehend", "ADJD")]
        self.assertIsNone(sp._linker_classes(t, [None, ("eingehen", "VERB")])[1])

    def test_participle_with_a_dictionary_adjective_links_that(self):
        t = [T("Das", "PRON"), T("ist", "AUX"), T("spannend", "ADJ", "spannen", "ADJD")]
        out = run(t, [None, None, ("spannen", "VERB")], {"spannend": [{"p": "adj"}], "spannen": [{"p": "verb"}]})
        self.assertEqual(out[2], ("spannend", "ADJ"))

    def test_finite_verb_is_untouched(self):
        t = [T("Wir", "PRON"), T("gehen", "VERB", "gehen", "VVFIN")]
        self.assertEqual(run(t, [None, ("gehen", "VERB")])[1], ("gehen", "VERB"))

    def test_attributive_participle_keeps_its_verb(self):
        t = [T("ein", "DET"), T("liebendes", "ADJ", "lieben", "ADJA"), T("Volk", "NOUN")]
        self.assertEqual(run(t, [None, ("lieben", "VERB"), None], {"lieben": [{"p": "verb"}]})[1], ("lieben", "VERB"))

    def test_noun_ending_end_is_not_a_participle(self):
        t = [T("Dutzend", "NOUN", "Dutzend", "NN")]
        self.assertEqual(run(t, [("Dutzend", "NOUN")], {"dutzen": [{"p": "verb"}]})[0], ("Dutzend", "NOUN"))


class LoanHomograph(unittest.TestCase):
    G_LOAN = {"p": "noun", "b": 1, "g": "f|Gangs||"}
    G_NAT = {"p": "noun", "g": "m|Gänge||"}

    def pick(self, ents, counts):
        surf = {s: Counter({("gang", "NOUN"): n}) for s, n in counts.items()}
        return spec().choose_entries(None, "gang", "NOUN", ents, surf)

    def test_native_when_only_native_forms_are_attested(self):
        ents = [self.G_LOAN, self.G_NAT]
        self.assertEqual(self.pick(ents, {"gänge": 5, "gängen": 3}), [self.G_NAT])

    def test_loan_kept_when_its_plural_is_attested(self):
        ents = [self.G_LOAN, self.G_NAT]
        self.assertEqual(self.pick(ents, {"gänge": 5, "gangs": 2}), ents)

    def test_no_evidence_either_way_leaves_the_choice(self):
        ents = [self.G_LOAN, self.G_NAT]
        self.assertEqual(self.pick(ents, {"gänge": 1}), ents)

    def test_shared_plural_is_no_loan_evidence_and_no_native_evidence(self):
        a = {"p": "noun", "b": 1, "g": "f|Bars||"}
        b = {"p": "noun", "g": "n|Bars||"}
        self.assertEqual(self.pick([a, b], {"bars": 9}), [a, b])

    def pick_morph(self, counts, morph, ents=None):
        surf = {s: Counter({("gang", "NOUN"): n}) for s, n in counts.items()}
        return spec().choose_entries(None, "gang", "NOUN", ents or [self.G_LOAN, self.G_NAT], surf, Counter(morph))

    def test_feminine_article_keeps_the_loan(self):
        ents = [self.G_LOAN, self.G_NAT]
        self.assertEqual(self.pick_morph({"gänge": 5, "gängen": 3}, {"Gender=Fem": 6, "Gender=Masc": 2}), ents)

    def test_masculine_or_weak_feminine_evidence_is_der_gang(self):
        for m in ({"Gender=Fem": 2}, {"Gender=Fem": 5, "Gender=Masc": 40}, {"Gender=Masc": 30}, {}):
            self.assertEqual(self.pick_morph({"gänge": 5, "gängen": 3}, m), [self.G_NAT], m)

    def test_other_groups_untouched(self):
        self.assertEqual(spec().choose_entries(None, "x", "VERB", [self.G_LOAN, self.G_NAT], {}), [self.G_LOAN, self.G_NAT])


class VorAllemWindow(unittest.TestCase):
    def test_comma_ends_the_governor_reach(self):
        t = [T("Er", "PRON"), T("ist", "AUX"), T("sicher", "ADJ"), T(",", "PUNCT"), T("vor", "ADP"), T("allem", "PRON"), T("klug", "ADJ")]
        self.assertEqual(spec()._no_link(t), {5})

    def test_governor_without_comma_still_holds(self):
        t = [T("Sie", "PRON"), T("ist", "AUX"), T("sicher", "ADJ"), T("vor", "ADP"), T("allem", "PRON")]
        self.assertEqual(spec()._no_link(t), set())
        t = [T("Er", "PRON"), T("hat", "AUX"), T("Angst", "NOUN"), T("vor", "ADP"), T("allem", "PRON")]
        self.assertEqual(spec()._no_link(t), set())


class PassageNoLink(unittest.TestCase):
    """A passage keeps the reading (the token stays counted) and reports the index through
    passage_no_link; only the corpus build drops the link."""

    def toks_vor_allem(self):
        return [T("Wichtig", "ADJ"), T("ist", "AUX"), T("vor", "ADP"), T("allem", "PRON"), T(".", "PUNCT")]

    def test_build_drops_passage_keeps_and_reports(self):
        t, out = self.toks_vor_allem(), [None, None, ("vor", "ADP"), ("alles", "PRON"), None]
        sp = spec()
        self.assertIsNone(sp._linker_classes(t, list(out))[3])
        sp.passage_mode = True
        self.assertEqual(sp._linker_classes(t, list(out))[3], ("alles", "PRON"))
        self.assertEqual(sp.passage_no_link(t), {3})

    def test_idiom_indices(self):
        sp = spec()
        self.assertEqual(sp.passage_no_link([T("schöner"), T("denn"), T("je")]), {1})
        self.assertEqual(sp.passage_no_link([T("recht"), T("und"), T("billig")]), {2})
        self.assertEqual(sp.passage_no_link([T("Angst", "NOUN", "Angst"), T("vor"), T("allem")]), set())
        self.assertEqual(sp.passage_no_link([T("Ich"), T("habe"), T("Durst"), T(","), T("denn"), T("ich")]), set())

    def test_participle_index_only_without_an_adjective_entry(self):
        t = [T("eingehend", "ADV", "eingehend", "ADJD")]
        self.assertEqual(spec({"eingehen": [{"p": "verb"}]}).passage_no_link(t), {0})
        self.assertEqual(spec({"eingehen": [{"p": "verb"}], "eingehend": [{"p": "adv"}]}).passage_no_link(t), set())


class Umsteigen(unittest.TestCase):
    def test_separated_umsteigen_joins_the_whole_verb(self):
        E = {"umsteigen": [{"p": "verb", "s": [["to change", "", [], ""]]}],
             "steigen": [{"p": "verb", "s": [["to climb", "", [], ""]]}]}

        class L(Lex):
            def readings(self, s):
                return []

            def verbs_only(self, c):
                return c

            def plural_pointer(self, w):
                return None
        sp = get_spec("de", TMP)
        sp._lex, sp._vscore = L(E), {}
        t = [T("Ich", "PRON", tag="PPER"), T("steige", "VERB", "steigen", "VVFIN"), T("in", "ADP"), T("Berlin", "PROPN"),
             T("um", "ADP", tag="PTKVZ"), T(".", "PUNCT")]
        t[1][3] = "VerbForm=Fin|Tag=VVFIN"
        out = sp.post_resolve(t, [None, ("steigen", "VERB"), None, None, ("um", "ADP"), None])
        self.assertEqual(out[1], ("umsteigen", "VERB"))
        self.assertIsNone(out[4])


class KeepLive(unittest.TestCase):
    def test_flag_is_de_only_and_reads_the_committed_pack(self):
        from packbuilder import langs
        from packbuilder.core import sentence_ids
        for code in ("it", "es", "fr", "ja"):
            self.assertFalse(langs.spec_class(code).keep_live_sentences, code)
        self.assertTrue(langs.spec_class("de").keep_live_sentences)
        repo = Path(tempfile.mkdtemp())
        self.assertEqual(sentence_ids.shipped_sentences(repo), [])
        (repo / "pack").mkdir()
        (repo / "pack" / "sentences.json").write_text('[{"id": "s0001", "t": "Hallo."}]', encoding="utf-8")
        self.assertEqual(sentence_ids.shipped_sentences(repo), [{"id": "s0001", "t": "Hallo."}])


class LiveSentences(unittest.TestCase):
    """core/sentences.py live_candidates + keep_live (keep_live_sentences): a live sentence is kept
    while any of its pack words remains; one that stopped being a candidate is dropped."""

    class SP:
        repo = None

        @staticmethod
        def clean_sentence_text(t):
            return t.strip()

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        (self.repo / "pack").mkdir()
        import json
        (self.repo / "pack" / "sentences.json").write_text(json.dumps(
            [{"id": "s1", "t": "Alt eins."}, {"id": "s2", "t": "Alt zwei."}, {"id": "s3", "t": "Alt drei."}]), encoding="utf-8")
        self.sp = self.SP()
        self.sp.repo = self.repo
        self.rows = {10: [0, "Alt eins."], 11: [0, "Alt zwei."], 12: [0, "Neu."]}   # row[1] is the text
        self.info = {10: (3, False, False, "A1", ["w1", "w2"]), 11: (3, False, False, "A1", ["w3"]),
                     12: (3, False, False, "A1", ["w4"])}   # "Alt drei." is no candidate any more

    def test_pinned_kept_and_non_candidate_dropped(self):
        from packbuilder.core import sentences
        live = sentences.live_candidates(self.sp, self.info, self.rows)
        self.assertEqual(live, {10, 11})
        st, primary = Counter(), {12: "w4"}
        sentences.keep_live(primary, live, self.info, st)
        self.assertEqual(sorted(primary), [10, 11, 12])
        self.assertEqual(primary[10], "w1")
        self.assertEqual(primary[11], "w3")

    def test_stat_counts_only_the_unchosen(self):
        from packbuilder.core import sentences
        st, primary = Counter(), {10: "w1"}
        sentences.keep_live(primary, {10, 11}, self.info, st)
        self.assertEqual(st["live_sentences_kept_unchosen"], 1)
        self.assertEqual(primary, {10: "w1", 11: "w3"})

    def test_idempotent_over_its_own_output(self):
        from packbuilder.core import sentences
        import json
        st, primary = Counter(), {12: "w4"}
        sentences.keep_live(primary, sentences.live_candidates(self.sp, self.info, self.rows), self.info, st)
        first = sorted(primary)
        texts = [self.rows[i][1] for i in first]
        (self.repo / "pack" / "sentences.json").write_text(
            json.dumps([{"id": f"s{i}", "t": t} for i, t in enumerate(texts)]), encoding="utf-8")
        st2, primary2 = Counter(), {12: "w4"}
        sentences.keep_live(primary2, sentences.live_candidates(self.sp, self.info, self.rows), self.info, st2)
        self.assertEqual(sorted(primary2), first)


if __name__ == "__main__":
    unittest.main()
