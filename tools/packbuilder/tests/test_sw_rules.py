"""Swahili rule-tagger tests (packbuilder/langs/sw.py): Analyser.noun_lemma
(noun class prefixes) and Analyser.parse_verb (verb morphology) against a
small synthetic index, tag_texts end to end over fixture sentences (the
CLOSED table forcing a fixed reading, and its one context override: kuwa is
the copula unless the previous word is a verb of saying), and the generic
passage_names_never_link fallback (Linker.links_all) for the sw homographs
it exists for (Simba the name vs simba "lion"). Stdlib only.

    python3 -m pytest -q tools/packbuilder/tests/test_sw_rules.py     (from vocab-engine/)
"""
import sys
import unittest
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs.sw import Analyser, Swahili  # noqa: E402
from packbuilder.passages import Linker  # noqa: E402


def analyser():
    """An Analyser over a small hand-picked vocabulary (no kaikki file read)."""
    an = Analyser.__new__(Analyser)
    an.noun = {"mtoto": "m/wa", "kitabu": "ki/vi", "shule": "", "simba": ""}
    an.noun_form = {"watoto": "mtoto", "vitabu": "kitabu"}
    an.plural = {}
    an.verb = {"soma": "soma", "la": "la", "enda": "enda", "kutana": "kutana",
               "ona": "ona", "wa": "wa", "sema": "sema"}
    an.verb_raw = {}
    an.adj_stem = {"zuri", "dogo"}
    an.adj_form = {"mzuri": "zuri", "wazuri": "zuri", "mdogo": "dogo"}
    an.other = defaultdict(set)
    an.intj_form = {}
    an.all_words = set()
    return an


def spec():
    sp = Swahili.__new__(Swahili)
    sp._an = analyser()
    return sp


class NounClassPrefixes(unittest.TestCase):
    """noun_lemma: the plural class prefix and the locative -ni both link
    the singular headword the pack teaches."""

    def setUp(self):
        self.an = analyser()

    def test_bare_singular_is_itself(self):
        self.assertEqual(self.an.noun_lemma("mtoto"), "mtoto")

    def test_wa_plural_links_the_m_wa_singular(self):
        self.assertEqual(self.an.noun_lemma("watoto"), "mtoto")

    def test_vi_plural_links_the_ki_vi_singular(self):
        self.assertEqual(self.an.noun_lemma("vitabu"), "kitabu")

    def test_locative_ni_links_the_noun(self):
        self.assertEqual(self.an.noun_lemma("shuleni"), "shule")

    def test_unknown_surface_is_no_noun(self):
        self.assertIsNone(self.an.noun_lemma("gari"))


class VerbMorphology(unittest.TestCase):
    """parse_verb: SM + TAM (+ka/REL) affirmative and negative finites, the
    infinitive and its negative, the imperative, and the passive/applicative
    derivations that fold into the base verb (verb_stem)."""

    def setUp(self):
        self.an = analyser()

    def lemma(self, w):
        return self.an.parse_verb(w)[0][0]

    def feats(self, w):
        return self.an.parse_verb(w)[0][1]

    def test_present(self):
        self.assertEqual(self.lemma("ninasoma"), "soma")
        self.assertEqual(self.feats("ninasoma"), {"VerbForm": "Fin"})

    def test_future_and_past_and_perfect(self):
        for w in ("atasoma", "alisoma", "amesoma"):
            self.assertEqual(self.lemma(w), "soma", w)

    def test_negative_present_drops_the_final_i(self):
        self.assertEqual(self.lemma("hasomi"), "soma")
        self.assertEqual(self.feats("hasomi"), {"VerbForm": "Fin", "Polarity": "Neg"})

    def test_infinitive_and_negative_infinitive(self):
        self.assertEqual(self.feats("kusoma"), {"VerbForm": "Inf"})
        self.assertEqual(self.feats("kutosoma"), {"VerbForm": "Inf", "Polarity": "Neg"})

    def test_imperative_plural(self):
        self.assertEqual(self.lemma("someni"), "soma")
        self.assertIn("Mood", self.feats("someni"))

    def test_passive_folds_to_the_base_verb(self):
        v, derived = self.an.verb_stem("somwa")
        self.assertEqual(v, "soma")
        self.assertTrue(derived)   # scored below a plain reading in _stems_after

    def test_applicative_folds_to_the_base_verb(self):
        v, derived = self.an.verb_stem("somea")
        self.assertEqual(v, "soma")
        self.assertTrue(derived)

    def test_no_reading_for_an_unknown_stem(self):
        self.assertIsNone(self.an.verb_stem("bembea"))


class ClosedWordForcing(unittest.TestCase):
    """analyse: a CLOSED-table word (pronouns, kuwa) keeps its forced
    reading regardless of context, except the one documented override:
    kuwa is the conjunction "that" right after a verb of saying/thinking."""

    def setUp(self):
        self.sp = spec()

    def tag(self, text):
        return self.sp.tag_texts([text])[0]

    def test_pronoun_forced_pron_whatever_the_slot(self):
        toks = self.tag("Mimi na wewe tunasoma.")
        self.assertEqual(toks[0][1:3], ("mimi", "PRON"))
        self.assertEqual(toks[2][1:3], ("wewe", "PRON"))

    def test_kuwa_is_the_copula_by_default(self):
        toks = self.tag("Yeye alikuwa mzuri.")
        self.assertEqual(toks[1][1:3], ("wa", "VERB"))

    def test_kuwa_after_a_say_verb_is_the_conjunction(self):
        toks = self.tag("Alisema kuwa anasoma.")
        self.assertEqual(toks[0][1:3], ("sema", "VERB"))
        self.assertEqual(toks[1][1:3], ("kuwa", "SCONJ"))


class SentenceFixtures(unittest.TestCase):
    """tag_texts end to end over ten sentences: every rule above (noun
    prefixes, verb morphology, closed-word forcing, adjective agreement)
    seen together, as sentences.json words are actually tagged."""

    def setUp(self):
        self.sp = spec()

    def tag(self, text):
        return self.sp.tag_texts([text])[0]

    def check(self, text, expected):
        """expected: [(surface, lemma, upos), ...] for the word tokens (skip punctuation)."""
        got = [(s, lem, up) for s, lem, up, _ in self.tag(text) if up != "PUNCT"]
        self.assertEqual(got, expected, text)

    def test_01_pronoun_subject(self):
        self.check("Mimi ninasoma kitabu.",
                    [("Mimi", "mimi", "PRON"), ("ninasoma", "soma", "VERB"), ("kitabu", "kitabu", "NOUN")])

    def test_02_plural_noun_and_adjective_agreement(self):
        self.check("Watoto wanasoma vitabu vizuri.",
                    [("Watoto", "mtoto", "NOUN"), ("wanasoma", "soma", "VERB"),
                     ("vitabu", "kitabu", "NOUN"), ("vizuri", "zuri", "ADJ")])

    def test_03_kuwa_default_copula(self):
        self.check("Yeye alikuwa mzuri.",
                    [("Yeye", "yeye", "PRON"), ("alikuwa", "wa", "VERB"), ("mzuri", "zuri", "ADJ")])

    def test_04_kuwa_as_conjunction(self):
        self.check("Alisema kuwa anasoma.",
                    [("Alisema", "sema", "VERB"), ("kuwa", "kuwa", "SCONJ"), ("anasoma", "soma", "VERB")])

    def test_05_negative_present(self):
        self.check("Sisi hatusomi shuleni.",
                    [("Sisi", "sisi", "PRON"), ("hatusomi", "soma", "VERB"), ("shuleni", "shule", "NOUN")])

    def test_06_imperative_plural(self):
        self.check("Someni vitabu!", [("Someni", "soma", "VERB"), ("vitabu", "kitabu", "NOUN")])

    def test_07_prenominal_adjective_and_locative(self):
        self.check("Mtoto mdogo anaenda shuleni.",
                    [("Mtoto", "mtoto", "NOUN"), ("mdogo", "dogo", "ADJ"),
                     ("anaenda", "enda", "VERB"), ("shuleni", "shule", "NOUN")])

    def test_08_lowercase_homograph_is_the_noun(self):
        self.check("Aliona simba.", [("Aliona", "ona", "VERB"), ("simba", "simba", "NOUN")])

    def test_09_capitalised_homograph_mid_sentence_is_a_name(self):
        self.check("Alikutana na Simba.",
                    [("Alikutana", "kutana", "VERB"), ("na", "na", "CCONJ"), ("Simba", "Simba", "PROPN")])

    def test_10_coordinated_pronouns(self):
        self.check("Mimi na wewe tunasoma.",
                    [("Mimi", "mimi", "PRON"), ("na", "na", "CCONJ"), ("wewe", "wewe", "PRON"),
                     ("tunasoma", "soma", "VERB")])


def word(wid, lemma, group, pos, rank):
    return {"id": wid, "w": lemma, "lemma": lemma, "pos": pos, "lv": "A1", "rank": rank, "_key": [lemma, group]}


def T(text, upos, lemma=None):
    return [text, lemma or text.lower(), upos, ""]


class FakeLex:
    def __init__(self, res=None):
        self.res = res or {}

    def usable_entries(self, w, kpos=None):
        return []

    def resolve_sentence(self, toks, groups=None):
        return [self.res.get(t[0].lower()) for t in toks]

    def readings(self, s):
        return []

    def zipf(self, w):
        return 0.0


class PassageNamesNeverLink(unittest.TestCase):
    """The generic passage_names_never_link fallback (Linker.links_all,
    passages.py), which sw turns on for exactly the reason id does: many
    given names (Simba among them, per langs/sw.py's own list) are also
    taught words."""

    def spec_with_words(self):
        sp = Swahili.__new__(Swahili)
        return sp

    def test_declared_name_is_unlinked_and_uncounted(self):
        sp = self.spec_with_words()
        lex = FakeLex()
        words = [word("w_na", "na", "CCONJ", "conj", 1), word("w_simba", "simba", "NOUN", "noun", 2)]
        lk = Linker(sp, {"lexicon": lex, "groups": None, "truecase": (Counter(), Counter()), "words": words},
                    {w["id"]: w for w in words})
        # the tagger reads the name as PROPN; only the text decides it is the declared name
        toks = [T("na", "CCONJ"), T("Simba", "PROPN", "simba")]
        lk.links = lambda toks, text, en, where: where.extend([("tok", 0, 0, "w_na"), ("tok", 1, 1, "w_simba")]) \
            or ["w_na", "w_simba"]
        ids, cl, _spans, _claimed = lk.links_all(toks, "na Simba", "", frozenset({"Simba"}))
        self.assertEqual(ids, ["w_na"])
        self.assertNotIn(1, [c[4] for c in cl])

    def test_lowercase_homograph_still_links(self):
        sp = self.spec_with_words()
        lex = FakeLex()
        words = [word("w_ona", "ona", "VERB", "verb", 1), word("w_simba", "simba", "NOUN", "noun", 2)]
        lk = Linker(sp, {"lexicon": lex, "groups": None, "truecase": (Counter(), Counter()), "words": words},
                    {w["id"]: w for w in words})
        toks = [T("aliona", "VERB", "ona"), T("simba", "NOUN")]
        lk.links = lambda toks, text, en, where: where.extend([("tok", 0, 0, "w_ona"), ("tok", 1, 1, "w_simba")]) \
            or ["w_ona", "w_simba"]
        ids, _cl, _spans, _claimed = lk.links_all(toks, "aliona simba", "", frozenset({"Simba"}))
        self.assertEqual(ids, ["w_ona", "w_simba"])


def rich_analyser():
    """analyser() plus the vocabulary the homograph context rules read."""
    an = analyser()
    an.noun.update({"duka": "ji/ma", "basi": "ji/ma", "ua": "ji/ma", "mpaka": "m/mi", "jumbe": "ji/ma",
                    "ujumbe": "u", "upepo": "u", "pepo": "", "taratibu": "n/n", "utaratibu": "u",
                    "hazina": "n/n", "nyumba": "n/n", "soko": "ji/ma", "simulizi": "n/n", "suala": "ji/ma",
                    "swala": "n/n", "maji": "ji/ma", "mtu": "m/wa", "barabara": "n/n", "mteja": "m/wa",
                    "kisa": "ki/vi", "mwanga": "m/mi", "kijiji": "ki/vi", "kadi": "n/n", "kalamu": "n/n",
                    "zawadi": "n/n", "mpira": "m/mi", "mwandishi": "m/wa", "siku": "n/n",
                    "mwanamume": "m/wa", "ukimya": "u", "kina": "ki/vi", "picha": "n/n",
                    "mwana": "m/wa", "baba": "n/n"})
    an.noun_form.update({"wana": "mwana", "watu": "mtu", "waandishi": "mwandishi", "jumbe": "ujumbe", "pepo": "upepo",
                         "taratibu": "utaratibu"})
    an.verb.update({"fika": "fika", "simama": "simama", "toa": "toa", "tumia": "tumia", "tuma": "tuma",
                    "tupa": "tupa", "pa": "pa", "fuata": "fuata", "tembea": "tembea", "subiri": "subiri",
                    "zika": "zika", "vuma": "vuma", "dhibiti": "dhibiti", "thibitisha": "thibitisha",
                    "ondoka": "ondoka", "susa": "susa", "pindua": "pindua", "apa": "apa"})
    an.adj_stem |= {"kali", "baya", "kubwa"}
    an.adj_form.update({"kali": "kali", "mbaya": "baya", "wabaya": "baya", "kubwa": "kubwa"})
    return an


def rich_spec():
    sp = Swahili.__new__(Swahili)
    sp._an = rich_analyser()
    return sp


class HomographContextRules(unittest.TestCase):
    """Analyser.analyse context rules for surfaces two pack words share
    (QA 2026-09-29): each rule has a sentence that takes it and one that
    does not."""

    def setUp(self):
        self.sp = rich_spec()

    def reading(self, text, surface):
        for s, lem, up, _ in self.sp.tag_texts([text])[0]:
            if s.lower() == surface:
                return lem, up
        raise AssertionError(f"{surface} not in {text}")

    def test_karibu_greeting_opens_a_clause_alone_or_before_a_name(self):
        self.assertEqual(self.reading("Karibu sana!", "karibu"), ("karibu", "INTJ"))
        self.assertEqual(self.reading("Karibu, wageni.", "karibu"), ("karibu", "INTJ"))
        self.assertEqual(self.reading("Karibuni Tanzania.", "karibuni"), ("karibu", "INTJ"))

    def test_karibu_elsewhere_is_near_almost(self):
        self.assertEqual(self.reading("Duka la karibu zaidi liko wapi?", "karibu"), ("karibu", "ADV"))
        self.assertEqual(self.reading("Karibu kila siku.", "karibu"), ("karibu", "ADV"))
        self.assertEqual(self.reading("Nyumba iko hapa karibu.", "karibu"), ("karibu", "ADV"))

    def test_karibuni_recently_is_not_karibu(self):
        self.assertEqual(self.reading("Atafika hivi karibuni.", "karibuni")[1], "X")
        self.assertEqual(self.reading("Atafika karibuni.", "karibuni"), ("karibuni", "ADV"))

    def test_basi_bus_before_li_agreement_or_after_by(self):
        self.assertEqual(self.reading("Basi limefika.", "basi"), ("basi", "NOUN"))
        self.assertEqual(self.reading("Keti hadi basi lisimame.", "basi"), ("basi", "NOUN"))
        self.assertEqual(self.reading("Nilifika kwa basi.", "basi"), ("basi", "NOUN"))

    def test_basi_well_so_otherwise(self):
        self.assertEqual(self.reading("Basi, tuondoke.", "basi"), ("basi", "CCONJ"))

    def test_huenda_goes_before_a_destination(self):
        self.assertEqual(self.reading("Yeye huenda sokoni.", "huenda"), ("enda", "VERB"))
        self.assertEqual(self.reading("Mara nyingi huenda nje ya nchi.", "huenda"), ("enda", "VERB"))

    def test_huenda_maybe_before_a_clause(self):
        self.assertEqual(self.reading("Kisa cha Yang huenda kikatoa mwanga.", "huenda"), ("huenda", "ADV"))

    def test_mpaka_border_as_a_noun_phrase_head(self):
        self.assertEqual(self.reading("Kuna mpaka kati ya nchi.", "mpaka"), ("mpaka", "NOUN"))
        self.assertEqual(self.reading("Dunia hauna mpaka.", "mpaka"), ("mpaka", "NOUN"))

    def test_mpaka_until_before_time_clause_or_place(self):
        self.assertEqual(self.reading("Nitasubiri mpaka kesho.", "mpaka"), ("mpaka", "ADP"))
        self.assertEqual(self.reading("Tulitembea mpaka sokoni.", "mpaka"), ("mpaka", "ADP"))

    def test_ua_yard_is_not_flower(self):
        self.assertEqual(self.reading("Ua wa nyumba ni mkubwa.", "ua")[1], "X")
        self.assertEqual(self.reading("Usitoke nje ya ua.", "ua")[1], "X")
        self.assertEqual(self.reading("Watoto wako uani.", "uani")[1], "X")

    def test_ua_flower_with_li_agreement(self):
        self.assertEqual(self.reading("Ua hili ni zuri.", "ua"), ("ua", "NOUN"))

    def test_jumbe_messages_is_ujumbe(self):
        self.assertEqual(self.reading("Mgongano wa jumbe hizo.", "jumbe"), ("ujumbe", "NOUN"))

    def test_jumbe_chief_with_class_1_agreement(self):
        self.assertEqual(self.reading("Jumbe wa kijiji alifika.", "jumbe"), ("jumbe", "NOUN"))

    def test_pepo_winds_is_upepo(self):
        self.assertEqual(self.reading("Pepo kali zilivuma.", "pepo"), ("upepo", "NOUN"))

    def test_pepo_spirit_otherwise(self):
        self.assertEqual(self.reading("Pepo mbaya alitoka.", "pepo"), ("pepo", "NOUN"))

    def test_wako_located_copula(self):
        self.assertEqual(self.reading("Wako wapi waandishi?", "wako"), ("wa", "VERB"))

    def test_yako_after_an_adjective_is_the_copula(self):
        self.assertEqual(self.reading("Nyumba kubwa yako katika mji.", "yako"), ("wa", "VERB"))

    def test_negative_perfect_jawa_is_kuwa(self):
        self.assertEqual(self.reading("Sababu bado haijawa wazi.", "haijawa"), ("wa", "VERB"))
        self.assertEqual(self.reading("Mimi sijawa tayari.", "sijawa"), ("wa", "VERB"))
        self.assertNotEqual(self.reading("Alijawa na huzuni.", "alijawa")[0], "wa")

    def test_wako_closing_a_letter_is_yours(self):
        self.assertEqual(self.reading("Wako, Jamila.", "wako"), ("ako", "DET"))
        self.assertEqual(self.reading("Wako tayari kusaidia.", "wako"), ("wa", "VERB"))

    def test_wako_possessive_after_a_noun(self):
        self.assertEqual(self.reading("Mteja wako amefika.", "wako"), ("ako", "DET"))

    def test_taratibu_slowly_after_a_verb_or_clause_initial(self):
        self.assertEqual(self.reading("Alitembea taratibu.", "taratibu"), ("taratibu", "ADV"))
        self.assertEqual(self.reading("Taratibu upepo ulivuma.", "taratibu"), ("taratibu", "ADV"))

    def test_taratibu_before_a_non_n_class_verb_is_slowly(self):
        self.assertEqual(self.reading("Mtoto huyu taratibu alisimama.", "taratibu"), ("taratibu", "ADV"))
        self.assertEqual(self.reading("Kanuni hizo taratibu zinafuatwa.", "taratibu")[1], "NOUN")

    def test_taratibu_procedures_with_n_agreement_or_after_follow(self):
        self.assertEqual(self.reading("Tufuate taratibu hizi.", "taratibu")[1], "NOUN")
        self.assertEqual(self.reading("Tufuate taratibu.", "taratibu")[1], "NOUN")

    def test_hazina_treasure_after_a_verb_or_associative(self):
        self.assertEqual(self.reading("Walizika hazina yao.", "hazina"), ("hazina", "NOUN"))

    def test_hazina_they_have_not_after_a_subject(self):
        self.assertEqual(self.reading("Nyumba hazina maji.", "hazina"), ("na", "VERB"))

    def test_have_form_noun_after_a_preposition(self):
        self.assertEqual(self.reading("Angalia kwa kina.", "kina"), ("kina", "NOUN"))

    def test_have_form_after_its_subject_is_have(self):
        self.assertEqual(self.reading("Kitabu kina picha.", "kina"), ("na", "VERB"))

    def test_pana_wide_after_a_noun_or_copula(self):
        self.assertEqual(self.reading("Barabara ni pana.", "pana"), ("pana", "ADJ"))
        self.assertEqual(self.reading("Simulizi pana sana.", "pana"), ("pana", "ADJ"))

    def test_pana_there_is_before_its_subject(self):
        self.assertEqual(self.reading("Sokoni pana watu.", "pana"), ("kuna", "VERB"))

    def test_swala_issue_with_li_agreement(self):
        self.assertEqual(self.reading("Swala hili ni gumu.", "swala"), ("suala", "NOUN"))

    def test_au_la_or_not_is_not_the_associative(self):
        self.assertEqual(self.reading("Utakuja au la?", "la")[1], "X")
        self.assertEqual(self.reading("Duka la soko.", "la"), ("a", "ADP"))

    def test_swala_prayer_otherwise(self):
        self.assertEqual(self.reading("Swala ya asubuhi.", "swala"), ("swala", "NOUN"))


class MisreadStems(unittest.TestCase):
    """Spellings the verb morphology read as a pack word: blocked by a
    CLOSED entry or a stem spelling map; the ordinary parse still works."""

    def setUp(self):
        self.sp = rich_spec()

    def reading(self, text, surface):
        for s, lem, up, _ in self.sp.tag_texts([text])[0]:
            if s.lower() == surface:
                return lem, up
        raise AssertionError(surface)

    def test_mnamo_is_not_kuwa_na(self):
        self.assertEqual(self.reading("Alifika mnamo 1840.", "mnamo"), ("mnamo", "ADP"))
        self.assertEqual(self.reading("Mna maji?", "mna"), ("na", "VERB"))

    def test_hususani_is_not_susa(self):
        self.assertEqual(self.reading("Masuala, hususani siasa.", "hususani"), ("hususani", "ADV"))
        self.assertEqual(self.reading("Yeye husoma.", "husoma"), ("soma", "VERB"))

    def test_om_pe_is_give_not_swear(self):
        self.assertEqual(self.reading("Wape chakula.", "wape"), ("pa", "VERB"))
        self.assertEqual(self.reading("Nipe maji.", "nipe"), ("pa", "VERB"))
        self.assertEqual(self.reading("Waliapa mahakamani.", "waliapa"), ("apa", "VERB"))

    def test_miongoni_is_not_mwongo(self):
        self.assertEqual(self.reading("Yeye ni miongoni mwa watu.", "miongoni"), ("miongoni", "ADP"))
        self.sp._an.noun.update({"mwongo": "m/mi"})
        self.assertEqual(self.reading("Mwongo huu ulikuwa mgumu.", "mwongo"), ("mwongo", "NOUN"))

    def test_undani_is_not_unda(self):
        self.assertEqual(self.reading("Aliongea kwa undani.", "undani"), ("undani", "NOUN"))
        self.sp._an.verb.update({"unda": "unda"})
        self.assertEqual(self.reading("Wataunda kamati.", "wataunda"), ("unda", "VERB"))

    def test_sentence_initial_uganda_is_a_place(self):
        self.sp._an.verb.update({"ganda": "ganda"})
        self.assertEqual(self.reading("Uganda imepitisha sheria.", "uganda"), ("uganda", "PROPN"))
        self.assertEqual(self.reading("Maji yanaganda.", "yanaganda"), ("ganda", "VERB"))

    def test_bare_ripoti_is_the_noun(self):
        self.sp._an.verb.update({"ripoti": "ripoti"})
        self.assertEqual(self.reading("Ripoti inaonyesha hali.", "ripoti"), ("ripoti", "NOUN"))
        self.assertEqual(self.reading("Wameripoti jana.", "wameripoti"), ("ripoti", "VERB"))

    def test_kupindukia_is_not_pindua(self):
        self.assertEqual(self.reading("Ni wabaya kupindukia.", "kupindukia"), ("kupindukia", "ADV"))
        self.assertEqual(self.reading("Alitaka kupindua meza.", "kupindua"), ("pindua", "VERB"))

    def test_dhibitisha_is_thibitisha(self):
        self.assertEqual(self.reading("Bonyeza ili kudhibitisha.", "kudhibitisha"), ("thibitisha", "VERB"))
        self.assertEqual(self.reading("Alitaka kudhibiti bei.", "kudhibiti"), ("dhibiti", "VERB"))

    def test_time_words_are_closed(self):
        self.assertEqual(self.reading("Alifika juzi.", "juzi"), ("juzi", "ADV"))
        self.assertEqual(self.reading("Atafika keshokutwa.", "keshokutwa"), ("keshokutwa", "ADV"))
        self.assertIn(("keshokutwa", "ADV"), Swahili.forced_closed)
        self.assertIn(("basi", "NOUN"), Swahili.forced_closed)


class ObjectPrefixHomographs(unittest.TestCase):
    """Swahili.fix_links: an object-prefixed verb whose stem spells another
    verb (-ni-tumia "send me" / tumia "use"; -tu-pa "give us" / tupa
    "throw") follows the English; no object prefix or an English that
    keeps the analysed verb leaves the link alone."""

    K = {("tumia", "VERB"): "w_tumia", ("tuma", "VERB"): "w_tuma", ("tupa", "VERB"): "w_tupa",
         ("pa", "VERB"): "w_pa", ("kadi", "NOUN"): "w_kadi"}

    def fix(self, text, en, links):
        sp = rich_spec()
        toks = sp.tag_texts([text])[0]
        return sp.fix_links([1, text, 0, en], toks, links, self.K)

    def test_om_tumia_with_send_is_tuma(self):
        self.assertEqual(self.fix("Walinitumia kadi.", "They sent me a card.", ["w_tumia", "w_kadi"]),
                         ["w_tuma", "w_kadi"])
        self.assertEqual(self.fix("Asante kwa kunitumia kadi.", "Thanks for sending me a card.",
                                  ["w_tumia", "w_kadi"]), ["w_tuma", "w_kadi"])

    def test_tumia_without_object_prefix_or_with_use_stays(self):
        self.assertEqual(self.fix("Walitumia kadi.", "They sent a card.", ["w_tumia", "w_kadi"]),
                         ["w_tumia", "w_kadi"])
        self.assertEqual(self.fix("Alinitumia vibaya.", "He used me badly.", ["w_tumia"]), ["w_tumia"])

    def test_om_tupa_give_us_is_pa_or_unlinked(self):
        self.assertEqual(self.fix("Kumetupa zawadi.", "It has given us a gift.", ["w_tupa"]), ["w_pa"])
        self.assertEqual(self.fix("Kumetupa simulizi.", "It tells a story.", ["w_tupa"]), [])
        self.assertEqual(self.fix("Kinachotupa wasiwasi ni hiki.", "What worries us is this.", ["w_tupa"]), [])

    def test_yako_without_you_in_english_is_the_copula(self):
        K = {**self.K, ("ako", "DET"): "w_ako", ("wa", "VERB"): "w_wa", ("jina", "NOUN"): "w_jina"}
        sp = rich_spec()
        sp._an.noun.update({"jina": "ji/ma"})
        sp._an.noun_form.update({"majina": "jina"})
        toks = sp.tag_texts(["Majina yako katika orodha."])[0]
        self.assertEqual(sp.fix_links([1, "", 0, "The names are in the list."], toks, ["w_jina", "w_ako"], K),
                         ["w_jina", "w_wa"])
        self.assertEqual(sp.fix_links([1, "", 0, "Your names are in the list."], toks, ["w_jina", "w_ako"], K),
                         ["w_jina", "w_ako"])

    def test_relative_om_tupa_without_throw_unlinked(self):
        self.assertEqual(self.fix("Ni sherehe itupayo fahari.", "A celebration that makes us proud.",
                                  ["w_tupa"]), [])
        self.assertEqual(self.fix("Ni mtu atupaye taka.", "He is a person who throws rubbish.", ["w_tupa"]),
                         ["w_tupa"])

    def test_yako_copula_with_your_in_english_is_the_possessive(self):
        K = {**self.K, ("ako", "DET"): "w_ako", ("wa", "VERB"): "w_wa"}
        sp = rich_spec()
        toks = [("faragha", "faragha", "NOUN", ""), ("yako", "wa", "VERB", ""), ("mtandaoni", "mtandao", "NOUN", "")]
        self.assertEqual(sp.fix_links([1, "", 0, "What about your privacy online?"], toks, ["w_wa"], K), ["w_ako"])
        self.assertEqual(sp.fix_links([1, "", 0, "The privacy is online."], toks, ["w_wa"], K), ["w_wa"])

    def test_tupa_throw_stays(self):
        self.assertEqual(self.fix("Alitupa mpira.", "He threw the ball.", ["w_tupa"]), ["w_tupa"])
        self.assertEqual(self.fix("Aliyetupa mpira ni yeye.", "He is the one who threw the ball.", ["w_tupa"]),
                         ["w_tupa"])


class MergedHeadwords(unittest.TestCase):
    """drop_keys merges (mwanaume into mwanamume, kimya NOUN into ukimya):
    finalize_words adds the merged-away lemma to the kept word's alt unless
    it is another word's headword."""

    def run_finalize(self, words):
        sp = rich_spec()
        sp.corpus_counts = lambda: (Counter(), None)
        sp.finalize_words(None, None, words)
        return words

    def test_merged_lemma_becomes_an_alt(self):
        w = self.run_finalize([{"_key": ("mwanamume", "NOUN"), "w": "mwanamume", "lemma": "mwanamume",
                                "en": "man"}])[0]
        self.assertIn("mwanaume", w["alt"])

    def test_merged_lemma_that_is_another_headword_is_not_an_alt(self):
        ws = self.run_finalize([{"_key": ("ukimya", "NOUN"), "w": "ukimya", "lemma": "ukimya", "en": "silence"},
                                {"_key": ("kimya", "ADJ"), "w": "kimya", "lemma": "kimya", "en": "quiet"}])
        self.assertNotIn("kimya", ws[0].get("alt") or [])


if __name__ == "__main__":
    unittest.main()


class CreditCaptions(unittest.TestCase):
    """Swahili.bad_text_re skips media-credit captions, not ordinary
    sentences that mention a photo."""

    def test_captions_skipped(self):
        for t in ("Picha kwa hisani ya familia.", "Imechapishwa kwa ruhusa ya PRI.",
                  "Picha kupitia mtandao wa Facebook.", "Picha kutoka blogu ya Zelalem.",
                  "Imetumiwa kwa ruhusa ya PRI.", "Picha imepigwa na Yang.",
                  "Picha iliyopigwa wakati wa tamasha la bendi ya Detroit."):
            self.assertTrue(Swahili.bad_text_re.search(t), t)

    def test_ordinary_photo_sentences_kept(self):
        for t in ("Picha hii ni nzuri sana.", "Video ifuatayo inaonesha muhtasari wa kazi.",
                  "Nilipiga picha kutoka dirishani."):
            self.assertIsNone(Swahili.bad_text_re.search(t), t)


class ZimaAndMkubwa(unittest.TestCase):
    """Zima the imperative vs -zima "whole"; mkubwa the coordinated
    adjective vs mkubwa "elder"."""

    def setUp(self):
        self.sp = rich_spec()
        self.sp._an.adj_stem |= {"zima", "pana"}
        self.sp._an.adj_form.update({"mzima": "zima", "zima": "zima", "mpana": "pana"})
        self.sp._an.noun.update({"mkubwa": "m/wa", "mlango": "m/mi", "mshumaa": "m/mi", "kundi": "ji/ma"})

    def reading(self, text, surface):
        for s, lem, up, _ in self.sp.tag_texts([text])[0]:
            if s.lower() == surface:
                return lem, up
        raise AssertionError(surface)

    def test_clause_initial_zima_is_the_verb(self):
        self.assertEqual(self.reading("Zima taa sasa.", "zima"), ("zima", "VERB"))
        self.assertEqual(self.reading("Anataka kuzima taa.", "kuzima"), ("zima", "VERB"))

    def test_zima_after_a_noun_stays_the_adjective(self):
        self.assertEqual(self.reading("Kondoo huharibu kundi zima.", "zima")[1], "ADJ")

    def test_mkubwa_after_adjective_na_is_the_adjective(self):
        self.assertEqual(self.reading("Mlango mpana na mkubwa ni huu.", "mkubwa"), ("kubwa", "ADJ"))

    def test_mkubwa_elder_stays_a_noun(self):
        self.assertEqual(self.reading("Mkubwa wetu amefika.", "mkubwa")[1], "NOUN")


class HaveFormNounBeforeVerbOrPossessive(unittest.TestCase):
    """wana "sons" before a possessive or a finite verb; wana "they have"
    before its object."""

    def setUp(self):
        self.sp = rich_spec()

    def reading(self, text, surface):
        for s, lem, up, _ in self.sp.tag_texts([text])[0]:
            if s.lower() == surface:
                return lem, up
        raise AssertionError(surface)

    def test_wana_before_possessive_or_verb_is_sons(self):
        self.assertEqual(self.reading("Baba huzika wana wao.", "wana"), ("mwana", "NOUN"))
        self.assertEqual(self.reading("Kwa amani, wana huzika baba.", "wana"), ("mwana", "NOUN"))

    def test_wana_before_object_is_have(self):
        self.assertEqual(self.reading("Watu wana maji.", "wana")[1], "VERB")

    def test_pana_after_siyo_is_the_adjective(self):
        self.assertEqual(self.reading("Uwanja siyo pana.", "pana"), ("pana", "ADJ"))


class ClauseFinalLaKiamshaHuenda(unittest.TestCase):
    """la ending a clause is "no"; kiamsha kinywa is one word "breakfast";
    huenda before a new subject noun is "maybe"."""

    def setUp(self):
        self.sp = rich_spec()
        self.sp._an.noun.update({"kinywa": "ki/vi", "akili": "n/n", "ukweli": "u"})
        self.sp._an.verb.update({"amsha": "amsha", "sema": "sema", "nufaika": "nufaika"})

    def reading(self, text, surface):
        for s, lem, up, _ in self.sp.tag_texts([text])[0]:
            if s.lower() == surface:
                return lem, up
        raise AssertionError(surface)

    def test_clause_final_la_is_no(self):
        self.assertEqual(self.reading("Akili inasema la.", "la")[1], "X")

    def test_la_after_a_full_stop_is_no(self):
        self.assertEqual(self.reading("Wacha niisome. La, ni sawa.", "la")[1], "X")

    def test_la_before_its_noun_is_the_associative(self):
        self.assertNotEqual(self.reading("Swali la mtoto.", "la")[1], "X")

    def test_kiamsha_kinywa_is_breakfast(self):
        self.assertEqual(self.reading("Kiamsha kinywa kiko tayari.", "kinywa")[1], "X")
        self.assertEqual(self.reading("Kiamsha kinywa kiko tayari.", "kiamsha")[1], "X")

    def test_kinywa_alone_is_mouth(self):
        self.assertEqual(self.reading("Funga kinywa chako.", "kinywa"), ("kinywa", "NOUN"))

    def test_huenda_before_a_subject_noun_is_maybe(self):
        self.assertEqual(self.reading("Kusema ukweli huenda watu watanufaika.", "huenda"), ("huenda", "ADV"))


class StandaloneIntjOnlyWithoutContextRule(unittest.TestCase):
    """sentence_links links a clause-final token to the interjection spelled
    like it ("Grazie!"); sw vetoes that for a word its context rules read
    (hapa karibu. is "near"), not for other interjections."""

    def links(self, toks, res, words):
        sp = Swahili.__new__(Swahili)
        lex = FakeLex(res)
        lex.spec = sp
        lk = Linker(sp, {"lexicon": lex, "groups": None, "truecase": (Counter(), Counter()), "words": words},
                    {w["id"]: w for w in words})
        return lk.links(toks, " ".join(t[0] for t in toks), "", [])

    def test_clause_final_karibu_read_as_adverb_links_near(self):
        words = [word("w_near", "karibu", "ADV", "adv", 1), word("w_welcome", "karibu", "INTJ", "intj", 2),
                 word("w_hapa", "hapa", "ADV", "adv", 3)]
        toks = [T("hapa", "ADV"), T("karibu", "ADV"), T(".", "PUNCT")]
        ids = self.links(toks, {"hapa": ("hapa", "ADV"), "karibu": ("karibu", "ADV")}, words)
        self.assertIn("w_near", ids)
        self.assertNotIn("w_welcome", ids)

    def test_other_interjection_before_punctuation_still_links(self):
        words = [word("w_asante", "asante", "INTJ", "intj", 1), word("w_asante_n", "asante", "NOUN", "noun", 2)]
        toks = [T("asante", "NOUN"), T("!", "PUNCT")]
        ids = self.links(toks, {"asante": ("asante", "NOUN")}, words)
        self.assertEqual(ids, ["w_asante"])


class SharedSurfaceAuditRules(unittest.TestCase):
    """Rules from the shared-surface audit (fix wave 2026-09-29): mpaka after
    a locative preposition, the infinitive kutoka, kina "has" before its
    object, a noun/adjective homograph after a predicate adjective."""

    def setUp(self):
        self.sp = rich_spec()
        an = self.sp._an
        an.noun.update({"mgeni": "m/wa", "idhini": "n/n", "mlango": "m/mi", "jengo": "ji/ma", "kizazi": "ki/vi",
                        "maoni": "ji/ma", "mtoto": "m/wa", "barua": "n/n"})
        an.noun_form.update({"wageni": "mgeni", "watoto": "mtoto", "milango": "mlango"})
        an.verb.update({"toka": "toka", "ibuka": "ibuka", "pata": "pata", "funga": "funga", "lala": "lala", "gundua": "gundua"})
        an.adj_stem |= {"geni", "bora"}
        an.adj_form.update({"wageni": "geni", "bora": "bora"})
        an.other.setdefault("kutoka", set()).add("prep")
        an._memo = {}

    def reading(self, text, surface):
        return HomographContextRules.reading(self, text, surface)

    def test_mpaka_after_locative_preposition_is_border(self):
        self.assertEqual(self.reading("Wanajeshi wako kwenye mpaka sasa.", "mpaka"), ("mpaka", "NOUN"))
        self.assertEqual(self.reading("Wanajeshi wanasubiri mpaka sasa.", "mpaka"), ("mpaka", "ADP"))

    def test_kutoka_infinitive_after_associative_or_clause_final(self):
        self.assertEqual(self.reading("Mwalimu alitoa idhini ya kutoka.", "kutoka"), ("toka", "VERB"))
        self.assertEqual(self.reading("Funga milango ya kutoka ya jengo.", "kutoka"), ("toka", "VERB"))
        self.assertEqual(self.reading("Alipata barua kutoka kwa mama.", "kutoka")[1], "ADP")

    def test_kutoka_after_an_exit_head_is_the_infinitive(self):
        self.assertEqual(self.reading("Tutafute njia ya kutoka kwenye pango.", "kutoka"), ("toka", "VERB"))
        self.assertEqual(self.reading("Wageni wa kutoka Kenya walifika.", "kutoka")[1], "ADP")

    def test_kina_before_its_object_is_has(self):
        self.assertNotEqual(self.reading("Kizazi kinachoibuka kina maoni.", "kina")[1], "NOUN")
        self.assertEqual(self.reading("Waligundua kina cha maji.", "kina"), ("kina", "NOUN"))

    def test_noun_adjective_homograph_after_predicate_adjective_is_noun(self):
        self.assertEqual(self.reading("Ni bora wageni walale hapa.", "wageni"), ("mgeni", "NOUN"))
        self.assertEqual(self.reading("Watoto wageni walale hapa.", "wageni"), ("geni", "ADJ"))


class ClauseEndIsNotANumeralOrQuote(unittest.TestCase):
    """The rules that read nxt None as a clause end (la, mpaka, karibu) see
    a numeral or an opening quote as the clause going on."""

    def setUp(self):
        self.sp = rich_spec()

    def reading(self, text, surface):
        return HomographContextRules.reading(self, text, surface)

    def test_la_before_a_numeral_or_quote_is_the_associative(self):
        self.assertEqual(self.reading("Ni jimbo la 31.", "la"), ("a", "ADP"))
        self.assertEqual(self.reading('Aliandika neno la "amani".', "la"), ("a", "ADP"))
        self.assertEqual(self.reading("Utakuja au la?", "la")[1], "X")
        self.assertEqual(self.reading("Akili inasema la.", "la")[1], "X")

    def test_mpaka_before_a_numeral_is_until(self):
        self.assertEqual(self.reading("Nitakaa hapa mpaka 2030.", "mpaka"), ("mpaka", "ADP"))
        self.assertEqual(self.reading("Dunia hauna mpaka.", "mpaka"), ("mpaka", "NOUN"))

    def test_karibu_before_a_numeral_is_about(self):
        self.assertEqual(self.reading("Karibu 30 walikuja.", "karibu"), ("karibu", "ADV"))
        self.assertEqual(self.reading('"Karibu," alisema.', "karibu"), ("karibu", "INTJ"))


class NdiyoFocusCopulaVersusYes(unittest.TestCase):
    def setUp(self):
        self.sp = rich_spec()

    def reading(self, text, surface):
        return HomographContextRules.reading(self, text, surface)

    def test_mid_clause_ndiyo_is_the_focus_copula(self):
        self.assertEqual(self.reading("Hiyo ndiyo picha.", "ndiyo")[1], "X")

    def test_clause_final_or_initial_ndiyo_is_yes(self):
        self.assertEqual(self.reading("Akili inasema ndiyo, lakini moyo unasema la.", "ndiyo"), ("ndiyo", "INTJ"))
        self.assertEqual(self.reading("Ndiyo, kuna sababu.", "ndiyo"), ("ndiyo", "INTJ"))

    def test_clause_initial_ndio_idiom_is_the_focus_copula(self):
        self.assertEqual(self.reading("Ndio maana alikuja.", "ndio")[1], "X")
        self.assertEqual(self.reading("Ndio kwanza nimeamka.", "ndio")[1], "X")

    def test_ndio_opening_a_clause_before_a_noun_is_the_focus_copula(self):
        # after a comma the clause restarts: ", ndio utamaduni wao" is "that is their culture"
        self.assertEqual(self.reading("Wanaimba hivi, ndio utamaduni wao.", "ndio")[1], "X")
        self.assertEqual(self.reading("Hiyo ni picha, ndiyo picha yangu.", "ndiyo")[1], "X")

    def test_ndiyo_opening_a_finite_clause_is_yes(self):
        self.assertEqual(self.reading("Ndiyo nitafika kesho.", "ndiyo"), ("ndiyo", "INTJ"))
        self.assertEqual(self.reading("Ndiyo ni kweli.", "ndiyo"), ("ndiyo", "INTJ"))


class SurfaceFallbackSkipsContextWords(unittest.TestCase):
    """sw.surface_link_ok: a context-rule word the rules left unresolved
    (mid-sentence ndiyo, the focus copula) never links the interjection by
    surface; another interjection still does."""

    def links(self, toks, res, words):
        return StandaloneIntjOnlyWithoutContextRule.links(self, toks, res, words)

    def test_focus_ndiyo_does_not_link_yes(self):
        words = [word("w_yes", "ndiyo", "INTJ", "intj", 1), word("w_picha", "picha", "NOUN", "noun", 2)]
        toks = [T("hiyo", "DET"), T("ndiyo", "X"), T("picha", "NOUN"), T(".", "PUNCT")]
        ids = self.links(toks, {"ndiyo": ("ndiyo", "X"), "picha": ("picha", "NOUN")}, words)
        self.assertEqual(ids, ["w_picha"])

    def test_other_unresolved_interjection_links_by_surface(self):
        words = [word("w_asante", "asante", "INTJ", "intj", 1), word("w_sana", "sana", "ADV", "adv", 2)]
        toks = [T("asante", "X"), T("sana", "ADV"), T(".", "PUNCT")]
        ids = self.links(toks, {"asante": ("asante", "X"), "sana": ("sana", "ADV")}, words)
        self.assertEqual(ids, ["w_asante", "w_sana"])


def kuwa_spec():
    """rich_spec plus the vocabulary the kuwa, imperative, kutoka and -enye tests read."""
    sp = rich_spec()
    an = sp._an
    an.noun.update({"habari": "n/n", "adui": "n/n", "rais": "n/n", "ahadi": "n/n", "kiongozi": "ki/vi",
                    "mwalimu": "m/wa", "hatia": "n/n", "ukweli": "u", "lengo": "ji/ma", "furaha": "n/n",
                    "nchi": "n/n", "kazi": "n/n", "fahari": "n/n", "mvuto": "m/mi", "shahada": "n/n",
                    "jibu": "ji/ma", "sauti": "n/n", "utulivu": "u", "safari": "n/n", "nje": "",
                    "shambulio": "ji/ma", "kaburi": "ji/ma"})
    an.noun_form.update({"majibu": "jibu"})
    an.other["kutoka"] = {"prep"}
    an.verb.update({"dhani": "dhani", "weza": "weza", "onekana": "onekana", "timiza": "timiza", "subiri": "subiri",
                    "amua": "amua", "kana": "kana", "jua": "jua", "choka": "choka", "julikana": "julikana",
                    "chukulia": "chukulia", "maliza": "maliza", "saidia": "saidia", "omba": "omba", "jibu": "jibu",
                    "taka": "taka", "anza": "anza", "toka": "toka", "tuma": "tuma", "pata": "pata"})
    an.adj_stem |= {"huru", "tulivu", "pya"}
    an.adj_form.update({"huru": "huru", "utulivu": "tulivu", "mtulivu": "tulivu", "mpya": "pya"})
    return sp


class KuwaVerbVersusConjunction(unittest.TestCase):
    """Analyser.kuwa_reading (re-QA 2026-09-29: 44 of 153 kuwa sites
    mislinked): the conjunction "that" before a finite clause, the verb
    "to be" before na, a predicate or after a modal. Each sub-case has a
    sentence that takes it and one that does not."""

    def setUp(self):
        self.sp = kuwa_spec()

    def reading(self, text, surface="kuwa"):
        return HomographContextRules.reading(self, text, surface)

    def conj(self, text):
        self.assertEqual(self.reading(text), ("kuwa", "SCONJ"), text)

    def verb(self, text):
        self.assertEqual(self.reading(text), ("wa", "VERB"), text)

    def test_say_verb_before_a_finite_verb_is_that(self):
        self.conj("Alisema kuwa anasoma.")

    def test_say_verb_before_a_predicate_noun_is_to_be(self):
        self.verb("Aliamua kuwa mwalimu.")
        self.verb("Inaonekana kuwa kiongozi mpya.")

    def test_kuwa_na_is_to_have_even_after_a_say_verb(self):
        self.verb("Alikana kuwa na hatia.")
        self.conj("Alikana kuwa ana hatia.")

    def test_noun_before_kuwa_and_a_clause_is_that(self):
        self.conj("Tulipata habari kuwa adui anasubiri.")
        self.verb("Nataka nchi kuwa huru.")

    def test_subject_then_finite_verb_is_that(self):
        self.conj("Inaonekana kuwa rais ametimiza ahadi.")

    def test_ni_kuwa_before_a_clause_is_that(self):
        self.conj("Ukweli ni kuwa, rais amefika.")
        self.verb("Lengo ni kuwa na furaha.")

    def test_copula_after_kuwa_is_that(self):
        self.conj("Tunachukulia kuwa ni ukweli.")

    def test_kwa_kuwa_before_a_clause_is_since(self):
        self.conj("Aliondoka kwa kuwa alichoka.")
        self.verb("Mji unajulikana kwa kuwa na soko.")

    def test_after_a_modal_kuwa_is_the_verb_before_a_finite_verb(self):
        self.verb("Anaweza kuwa hajui.")
        self.conj("Anasema kuwa hajui.")

    def test_when_relative_ends_the_subject_scan(self):
        self.verb("Aliamua kuwa mwalimu alipokuwa amemaliza shule.")
        self.conj("Alidhani kuwa kazi aliyoomba ingemsaidia.")

    def test_after_an_associative_the_clause_verb_comes_first(self):
        self.verb("Mvuto wa kuwa mwalimu mwenye shahada unaanza.")
        self.conj("Tuna fahari ya kuwa tumefika.")

    def test_clause_initial_kuwa_is_the_verb(self):
        self.verb("Kuwa mwalimu mzuri.")


class NounVerbStemImperative(unittest.TestCase):
    """A noun that spells a verb stem (jibu "answer" / jibu! "reply") is the
    imperative after tafadhali or before a manner adverb; the noun elsewhere."""

    def setUp(self):
        self.sp = kuwa_spec()

    def reading(self, text, surface="jibu"):
        return HomographContextRules.reading(self, text, surface)

    def test_imperative_after_please_or_before_an_adverb(self):
        self.assertEqual(self.reading("Kwa hivyo tafadhali jibu haraka."), ("jibu", "VERB"))
        self.assertEqual(self.reading("Jibu haraka!"), ("jibu", "VERB"))
        self.assertEqual(self.reading("Jibu badala ya kunyamaza!"), ("jibu", "VERB"))

    def test_noun_with_agreement_or_as_object(self):
        self.assertEqual(self.reading("Jibu lake ni nini?"), ("jibu", "NOUN"))
        self.assertEqual(self.reading("Alituma jibu haraka."), ("jibu", "NOUN"))
        self.assertEqual(self.reading("Tafadhali jibu lake ni nini?"), ("jibu", "NOUN"))


class KutokaAfterAnInfinitiveTaker(unittest.TestCase):
    def setUp(self):
        self.sp = kuwa_spec()

    def reading(self, text, surface="kutoka"):
        return HomographContextRules.reading(self, text, surface)

    def test_after_taka_it_is_the_infinitive(self):
        self.assertEqual(self.reading("Alitaka kutoka nje."), ("toka", "VERB"))

    def test_after_anza_it_stays_from(self):
        self.assertNotEqual(self.reading("Safari ilianza kutoka Nairobi.")[1], "VERB")


class EnyeTakesANoun(unittest.TestCase):
    """-enye "having" takes a noun: utulivu after yenye is the noun "calm",
    not the adjective -tulivu in u- agreement."""

    def setUp(self):
        self.sp = kuwa_spec()

    def test_after_yenye_the_noun(self):
        self.assertEqual(HomographContextRules.reading(self, "Alisema kwa sauti yenye utulivu.", "utulivu"),
                         ("utulivu", "NOUN"))

    def test_after_a_noun_the_adjective(self):
        self.assertEqual(HomographContextRules.reading(self, "Ana sauti mtulivu.", "mtulivu"), ("tulivu", "ADJ"))


class MergedAttackAndGraveHeadwords(unittest.TestCase):
    """Fix wave 2: shambulizi merges into shambulio and makaburi (graves,
    cemetery) into kaburi, as mwanaume into mwanamume."""

    def test_merged_lemmas_become_alts(self):
        ws = MergedHeadwords.run_finalize(self, [
            {"_key": ("shambulio", "NOUN"), "w": "shambulio", "lemma": "shambulio", "en": "attack"},
            {"_key": ("kaburi", "NOUN"), "w": "kaburi", "lemma": "kaburi", "en": "grave"}])
        self.assertIn("shambulizi", ws[0]["alt"])
        self.assertIn("makaburi", ws[1]["alt"])
        self.assertEqual(Swahili.drop_keys[("shambulizi", "NOUN")], ("shambulio", "NOUN"))
