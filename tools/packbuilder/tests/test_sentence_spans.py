"""sentences.json `spans` (core.sentences.build_sentences via core.spans.
sentence_spans): [[start, end, wordId]] in UTF-16 code units of the shipped
text, sorted, non-overlapping, one per placed link occurrence; a link the
builder cannot place gets none. Stdlib only.

    python3 -m unittest discover -s tools/packbuilder/tests -t tools     (from vocab-engine/)
"""
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packbuilder.core.sentences import build_sentences  # noqa: E402
from packbuilder.core.spans import move_ranges, sentence_spans  # noqa: E402
from packbuilder.langs import get_spec  # noqa: E402

# (surface, lemma, group) -> word id; lemma/group double as the tagger reading
WORDS = [("comprare", "VERB", "w_comprare"), ("mela", "NOUN", "w_mela"), ("per favore", "PHRASE", "w_perfav"),
         ("mangiare", "VERB", "w_mangiare"), ("pane", "NOUN", "w_pane"), ("grande", "ADJ", "w_grande"),
         ("favore", "NOUN", "w_favore"), ("il", "DET", "w_il"), ("e", "CCONJ", "w_e")]
READ = {"compra": ("comprare", "VERB"), "compro": ("comprare", "VERB"), "mele": ("mela", "NOUN"),
        "mela": ("mela", "NOUN"), "mangio": ("mangiare", "VERB"), "mangia": ("mangiare", "VERB"),
        "pane": ("pane", "NOUN"), "grande": ("grande", "ADJ"), "favore": ("favore", "NOUN"),
        "il": ("il", "DET"), "la": ("il", "DET"), "le": ("il", "DET"), "e": ("e", "CCONJ"),
        "grandi": ("grande", "ADJ"), "pomi": ("mela", "NOUN")}


class Lexicon:
    def __init__(self, spec):
        self.spec = spec

    def resolve_sentence(self, toks, groups=None):
        return [None if t[2] == "PUNCT" else READ.get(t[0].lower()) for t in toks]

    def historic_past(self, s):
        return False


def tokens(words):
    def upos(w):
        return "PUNCT" if w in ".,!?" else "SYM" if not w.isalpha() else (READ.get(w.lower()) or ("", "NOUN"))[1]
    return [[w, (READ.get(w.lower()) or (w, ""))[0], upos(w), ""] for w in words]


def build(rows, fix_links=None):
    """build_sentences over [(text, tokens)]; returns {text: record}."""
    tmp = Path(tempfile.mkdtemp())
    sp = get_spec("it", tmp)
    if fix_links:
        sp.fix_links = fix_links
    words = [{"id": wid, "_key": (lem, g), "lemma": lem, "w": lem, "en": lem, "pos": g.lower(), "lv": "A1",
              "rank": i, "_sidx": i} for i, (lem, g, wid) in enumerate(WORDS)]
    tagged = tmp / "tagged.jsonl.gz"
    by_sid = {}
    with gzip.open(tagged, "wt", encoding="utf-8") as f:
        for i, (text, toks) in enumerate(rows):
            by_sid[i + 1] = [i + 1, text, "u", "en", None, None]
            f.write(json.dumps([i + 1, toks]) + "\n")
    ctx = {"lexicon": Lexicon(sp), "lemma_groups": {}, "tagged": tagged, "rows_by_sid": by_sid}
    sents, _, _ = build_sentences(SimpleNamespace(spec=sp), ctx, words, {w[0] for w in WORDS})
    return {s["t"]: s for s in sents}


def u16(text, a, b):
    return text.encode("utf-16-le")[2 * a:2 * b].decode("utf-16-le")


class BuildSentencesSpans(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = build([
            ("Compra le mele, per favore.", tokens(["Compra", "le", "mele", ",", "per", "favore", "."])),
            ("Mangio il pane e mangia la mela.", tokens(["Mangio", "il", "pane", "e", "mangia", "la", "mela", "."])),
            ("Compro \U0001F34E il pane grande.", tokens(["Compro", "\U0001F34E", "il", "pane", "grande", "."])),
            # the tagger rewrote the surface: mele is not in the text, so no span for mela
            ("Compra le mele grandi e il pane.", tokens(["Compra", "le", "pomi", "grandi", "e", "il", "pane", "."])),
            # it clean_sentence_text drops the space before ?: offsets move with it
            ("Compra il pane e la mela ?", tokens(["Compra", "il", "pane", "e", "la", "mela", "?"])),
        ])

    def check_shape(self, s):
        prev = 0
        for a, b, wid in s["spans"]:
            self.assertLess(a, b)
            self.assertGreaterEqual(a, prev)       # sorted, no overlap
            self.assertLessEqual(b, len(s["t"].encode("utf-16-le")) // 2)
            self.assertIn(wid, s["words"])
            prev = b

    def test_every_record_has_spans_and_the_shape_holds(self):
        self.assertEqual(len(self.out), 5)
        for s in self.out.values():
            self.assertIn("spans", s)
            self.check_shape(s)

    def test_multiword_is_one_span_owning_its_parts(self):
        t = "Compra le mele, per favore."
        s = self.out[t]
        self.assertEqual([(u16(t, a, b), w) for a, b, w in s["spans"]],
                         [("Compra", "w_comprare"), ("le", "w_il"), ("mele", "w_mela"), ("per favore", "w_perfav")])
        self.assertNotIn("w_favore", {x[2] for x in s["spans"]})

    def test_repeated_word_two_spans(self):
        t = "Mangio il pane e mangia la mela."
        spans = self.out[t]["spans"]
        self.assertEqual([u16(t, a, b) for a, b, w in spans if w == "w_mangiare"], ["Mangio", "mangia"])
        self.assertEqual([u16(t, a, b) for a, b, w in spans if w == "w_il"], ["il", "la"])

    def test_astral_char_offsets_are_utf16(self):
        t = "Compro \U0001F34E il pane grande."
        spans = self.out[t]["spans"]
        self.assertEqual(spans[1], [10, 12, "w_il"])       # Python index 8: the apple is 2 code units
        self.assertEqual([u16(t, a, b) for a, b, _ in spans], ["Compro", "il", "pane", "grande"])

    def test_unplaceable_link_gets_no_span(self):
        t = "Compra le mele grandi e il pane."
        s = self.out[t]
        self.assertIn("w_mela", s["words"])
        self.assertNotIn("w_mela", {x[2] for x in s["spans"]})
        self.assertEqual([u16(t, a, b) for a, b, _ in s["spans"]], ["Compra", "le", "grandi", "e", "il", "pane"])

    def test_offsets_follow_clean_sentence_text(self):
        t = "Compra il pane e la mela?"
        self.assertIn(t, self.out)
        self.assertEqual([u16(t, a, b) for a, b, _ in self.out[t]["spans"]],
                         ["Compra", "il", "pane", "e", "la", "mela"])


class FixLinksId(unittest.TestCase):
    def test_an_id_fix_links_puts_in_has_no_span(self):
        # spec.fix_links relinks pane -> grande: no where record places grande
        def fix(row, toks, links, key_to_id):
            return ["w_grande" if x == "w_pane" else x for x in links]
        t = "Mangio il pane e la mela."
        s = build([(t, tokens(["Mangio", "il", "pane", "e", "la", "mela", "."]))], fix)[t]
        self.assertIn("w_grande", s["words"])
        self.assertEqual([u16(t, a, b) for a, b, _ in s["spans"]], ["Mangio", "il", "e", "la", "mela"])


class MoveRanges(unittest.TestCase):
    def test_dropped_mark_inside_a_word(self):
        # ru: stress marks are display noise; the word keeps its span
        raw, clean = "Он чита́ет кни́гу.", "Он читает книгу."
        out, dropped = move_ranges(raw, clean, [(3, 10, "r"), (11, 17, "b")], lambda s: s.replace("́", ""))
        self.assertEqual(([clean[a:b] for a, b, _ in out], dropped), (["читает", "книгу"], 0))

    def test_rewritten_range_is_dropped(self):
        out, dropped = move_ranges("ab cd", "ab xyz", [(0, 2, "a"), (3, 5, "c")], lambda s: s)
        self.assertEqual((out, dropped), ([(0, 2, "a")], 1))

    def test_same_text_is_unchanged(self):
        self.assertEqual(move_ranges("ab", "ab", [(0, 2, "a")], None), ([(0, 2, "a")], 0))


class UnspacedAndRtl(unittest.TestCase):
    class Spec:
        span_fold = None
        span_joiners = ""

        @staticmethod
        def clean_sentence_text(t):
            return t

    def test_unspaced_tokens(self):
        t = "私は本を読みます。"
        toks = [[x, x, "X", ""] for x in ["私", "は", "本", "を", "読み", "ます", "。"]]
        where = [("tok", 0, 0, "i"), ("tok", 2, 2, "book"), ("tok", 4, 5, "read")]
        spans, _ = sentence_spans(self.Spec, t, t, toks, where, ["i", "book", "read"])
        self.assertEqual([(u16(t, a, b), w) for a, b, w in spans], [("私", "i"), ("本", "book"), ("読みます", "read")])

    def test_rtl_text(self):
        t = "من کتاب می‌خوانم."
        toks = [[x, x, "X", ""] for x in ["من", "کتاب", "می‌خوانم", "."]]
        spans, _ = sentence_spans(self.Spec, t, t, toks, [("tok", 1, 1, "k"), ("tok", 2, 2, "x")], ["k", "x"])
        self.assertEqual([u16(t, a, b) for a, b, _ in spans], ["کتاب", "می‌خوانم"])


if __name__ == "__main__":
    unittest.main()
