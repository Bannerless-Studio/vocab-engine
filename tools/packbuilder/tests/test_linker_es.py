"""es linker classes from the 2026-10-14 passage QA: neuter lo, solo before a noun,
se + lo/la as le, hace + time. Passage rule (passage_post_resolve) and sentences.json
rule (fix_links) share one classifier. Stdlib only."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.langs import get_spec  # noqa: E402

SP = get_spec("es", None, load=False)
K2I = {("lo", "PRON"): "lo", ("se", "PRON"): "se", ("le", "PRON"): "le", ("solo", "ADJ"): "solo_adj",
       ("solo", "ADV"): "solo_adv", ("hacer", "VERB"): "hacer", ("que", "SCONJ"): "que", ("ver", "VERB"): "ver"}


def T(text, upos="X", lemma=None, morph=""):
    return [text, lemma or text.lower(), upos, morph]


def passage(toks, res):
    """Link per token as the passage Linker sees it: None when the token is unlinked."""
    out = SP.passage_post_resolve(toks, [res.get(t[0].lower()) for t in toks])
    skip = SP.passage_no_link(toks)
    return [None if i in skip else r for i, r in enumerate(out)]


class NeuterLo(unittest.TestCase):
    def test_lo_que_unlinked_que_kept(self):
        toks = [T("Lo", "PRON"), T("que", "PRON"), T("dices", "VERB", "decir"), T("es", "AUX", "ser"), T("cierto", "ADJ")]
        out = passage(toks, {"lo": ("lo", "PRON"), "que": ("que", "SCONJ")})
        self.assertIsNone(out[0])
        self.assertEqual(out[1], ("que", "SCONJ"))
        self.assertEqual(SP.fix_links(None, toks, ["lo", "que"], K2I), ["que"])

    def test_lo_adjective_and_adverb(self):
        for nxt in (T("más", "ADV"), T("único", "ADJ"), T("mismo", "ADJ"), T("importante", "ADJ")):
            toks = [T("Lo", "PRON"), nxt, T("es", "AUX", "ser")]
            self.assertIsNone(passage(toks, {"lo": ("lo", "PRON")})[0], nxt[0])

    def test_object_lo_keeps_link(self):
        toks = [T("Lo", "PRON"), T("vi", "VERB", "ver"), T("venir", "VERB")]
        self.assertEqual(passage(toks, {"lo": ("lo", "PRON")})[0], ("lo", "PRON"))
        self.assertEqual(SP.fix_links(None, toks, ["lo", "ver"], K2I), ["lo", "ver"])

    def test_one_neuter_one_object_keeps_id(self):
        toks = [T("Lo", "PRON"), T("que", "PRON"), T("lo", "PRON"), T("hizo", "VERB", "hacer")]
        self.assertEqual(SP.fix_links(None, toks, ["lo", "que"], K2I), ["lo", "que"])


class AdjTaggedVerb(unittest.TestCase):
    class Lex:
        def candidates(self, s, kpos):
            return {s} if s in ("importante", "único") else set()

    def test_verb_tagged_adj_keeps_lo(self):
        sp = get_spec("es", None, load=False)
        sp._lex = self.Lex()
        toks = [T("que", "SCONJ"), T("lo", "PRON"), T("preguntes", "ADJ"), T("tú", "PRON")]
        self.assertEqual(sp.fix_links(None, toks, ["lo"], K2I), ["lo"])
        self.assertEqual(sp.passage_no_link(toks), set())

    def test_real_adjective_and_participle_drop_lo(self):
        sp = get_spec("es", None, load=False)
        sp._lex = self.Lex()
        for adj in ("importante", "sucedido"):
            toks = [T("de", "ADP"), T("lo", "PRON"), T(adj, "ADJ")]
            self.assertEqual(sp.passage_no_link(toks), {1}, adj)


class SoloSingle(unittest.TestCase):
    def test_un_solo_noun_is_only(self):
        toks = [T("un", "DET"), T("solo", "ADJ"), T("capítulo", "NOUN")]
        self.assertEqual(passage(toks, {"solo": ("solo", "ADJ")})[1], ("solo", "ADV"))
        self.assertEqual(SP.fix_links(None, toks, ["solo_adj"], K2I), ["solo_adv"])

    def test_alone_after_noun_keeps_adj(self):
        toks = [T("Un", "DET"), T("hombre", "NOUN"), T("solo", "ADJ"), T("vino", "VERB")]
        self.assertEqual(passage(toks, {"solo": ("solo", "ADJ")})[2], ("solo", "ADJ"))
        self.assertEqual(SP.fix_links(None, toks, ["solo_adj"], K2I), ["solo_adj"])


class SeForLe(unittest.TestCase):
    def test_se_lo_dijimos_is_le(self):
        toks = [T("Se", "PRON"), T("lo", "PRON"), T("dijimos", "VERB", "decir"), T("a", "ADP"), T("él", "PRON")]
        out = passage(toks, {"se": ("se", "PRON"), "lo": ("lo", "PRON")})
        self.assertEqual(out[0], ("le", "PRON"))
        self.assertEqual(out[1], ("lo", "PRON"))
        self.assertEqual(SP.fix_links(None, toks, ["se", "lo"], K2I), ["lo"])

    def test_periphrasis_reaches_the_infinitive(self):
        toks = [T("se", "PRON"), T("lo", "PRON"), T("ibas", "VERB", "ir"), T("a", "ADP"), T("vender", "VERB")]
        self.assertEqual(passage(toks, {"se": ("se", "PRON")})[0], ("le", "PRON"))

    def test_reflexive_se_lo_keeps_se(self):
        toks = [T("Se", "PRON"), T("lo", "PRON"), T("puso", "VERB", "poner"), T("rápido", "ADV")]
        self.assertEqual(passage(toks, {"se": ("se", "PRON")})[0], ("se", "PRON"))
        self.assertEqual(SP.fix_links(None, toks, ["se", "lo"], K2I), ["se", "lo"])


class HaceAgo(unittest.TestCase):
    def test_hace_un_mes_que(self):
        toks = [T("Hace", "VERB", "hacer"), T("un", "DET"), T("mes", "NOUN"), T("que", "SCONJ"), T("estás", "VERB")]
        self.assertIsNone(passage(toks, {"hace": ("hacer", "VERB")})[0])
        self.assertEqual(SP.fix_links(None, toks, ["hacer", "que"], K2I), ["que"])

    def test_relative_que_tagged_pron_still_closes(self):
        toks = [T("Hace", "VERB", "hacer"), T("un", "DET"), T("mes", "NOUN"), T("que", "PRON"), T("estás", "VERB")]
        self.assertIsNone(passage(toks, {"hace": ("hacer", "VERB")})[0])

    def test_hace_poco_and_hace_dos_anos(self):
        for rest in ([T("poco", "ADV"), T("recibió", "VERB")], [T("dos", "NUM"), T("años", "NOUN")]):
            toks = [T("Hace", "VERB", "hacer")] + rest
            self.assertIsNone(passage(toks, {"hace": ("hacer", "VERB")})[0], rest[0][0])

    def test_weather_and_making_keep_hacer(self):
        for rest in ([T("mucho", "ADV"), T("frío", "NOUN")], [T("una", "DET"), T("prueba", "NOUN")]):
            toks = [T("Hace", "VERB", "hacer")] + rest
            self.assertEqual(passage(toks, {"hace": ("hacer", "VERB")})[0], ("hacer", "VERB"))
            self.assertEqual(SP.fix_links(None, toks, ["hacer"], K2I), ["hacer"])

    def test_subject_before_hace_keeps_hacer(self):
        toks = [T("Ella", "PRON"), T("hace", "VERB", "hacer"), T("horas", "NOUN"), T("extras", "ADJ")]
        self.assertEqual(passage(toks, {"hace": ("hacer", "VERB")})[1], ("hacer", "VERB"))
        self.assertEqual(SP.fix_links(None, toks, ["hacer"], K2I), ["hacer"])

    def test_hace_tiempo_para_keeps_hacer(self):
        toks = [T("Siempre", "ADV"), T("hace", "VERB", "hacer"), T("tiempo", "NOUN"), T("para", "ADP"), T("sus", "DET"),
                T("hijos", "NOUN")]
        self.assertEqual(passage(toks, {"hace": ("hacer", "VERB")})[1], ("hacer", "VERB"))

    def test_past_verb_and_desde_close_the_phrase(self):
        past = [T("Hace", "VERB", "hacer"), T("dos", "NUM"), T("años", "NOUN"), T("dejé", "VERB", "dejar", "Tense=Past")]
        self.assertIsNone(passage(past, {"hace": ("hacer", "VERB")})[0])
        desde = [T("Desde", "ADP"), T("hace", "VERB", "hacer"), T("tres", "NUM"), T("días", "NOUN"), T("me", "PRON"),
                 T("duele", "VERB", "doler", "Tense=Pres")]
        self.assertIsNone(passage(desde, {"hace": ("hacer", "VERB")})[1])

    def test_other_hacer_token_keeps_id(self):
        toks = [T("Hace", "VERB", "hacer"), T("un", "DET"), T("año", "NOUN"), T("hizo", "VERB", "hacer"), T("eso", "PRON")]
        self.assertEqual(SP.fix_links(None, toks, ["hacer"], K2I), ["hacer"])


if __name__ == "__main__":
    unittest.main()
