"""Persian story rows: Let's Read Asia (CC-BY-4.0) Dari books -> aligned (Persian, English) sentence pairs.

The alignment and filter machinery is language-independent (core/story_align.py); this module holds what is Persian:
sentence ends, script test, quote normaliser, opener and relative words, credit-line patterns.
`langs/fa.py` `story_rows` loads the cache written by tools/story_fetch/lra_fetch.py
(<repo>/.cache/stories/fa-lra/<bookId>.json, Dari language id 5691900216475648) and calls `story_pairs`.
The books are Dari (Afghan Persian); the pack is Iranian Persian (Tatoeba pes). Dari-only vocabulary falls out
at the pack's lemma filter (content lemma outside the pack).
"""
import re

from .core import story_align as A
from .core.story_align import Stats, norm_en, title_key   # noqa: F401

FA_END = ".؟!?۔"
ARABIC_RE = re.compile(r"[؀-ۿ]")
SPLIT_FA = re.compile(rf"(?<=[{FA_END}])[\"'”’»]*\s+")
# a sentence that opens on a connective leans on the previous sentence (pronoun openers are caught by the English dangling rule)
FA_CONNECTIVE_OPEN = frozenset({"و", "اما", "ولی", "پس", "سپس", "بعد", "آنگاه", "زیرا", "چون", "چونکه", "لذا", "یا", "همچنین", "بنابراین",
                                "ولیکن", "لیکن", "بلکه", "همین", "پیش", "هم", "که", "تا", "آنجا", "بعدا", "بعداً"})
FA_RELATIVE = frozenset({"که", "هرچه", "هرکه", "آنچه", "چنانکه", "همانطور"})
FA_META = re.compile(r"(?:نویسنده|تصویرگر|مترجم|ناشر|مجوز|لایسنس|لایسنس|کریتیو|بنیاد آسیا|بیایید بخوانیم)")


def norm_fa(s):
    s = A.TAG_RE.sub(" ", s).replace(" ", " ")
    s = s.replace("“", '"').replace("”", '"').replace("’’", '"').replace("‘‘", '"')
    s = s.replace("ي", "ی").replace("ك", "ک").replace("…", "...")
    s = re.sub(r"\"\s*([.؟!?]+)(?=\s|$)", r'\1"', s)       # stop after the closing quote, as the English has it
    s = re.sub(r"([!؟?])\.", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool(A.LATIN_RE.search(u) or re.search(r"[۰-۹]", u) or not ARABIC_RE.search(u) or ARABIC_RE.search(e) or re.search(r"\d", e))


# names_kept: the Dari edition transliterates character names (Bo -> بو, Rinky -> رینکی); `checks.renamed` compares the
# English names of a sentence with its Persian tokens by consonant skeleton (below), so a renamed character still drops.
FA = A.StoryLang(code="fa", end=FA_END, split_re=SPLIT_FA, norm=norm_fa, foreign=_foreign, connective_open=FA_CONNECTIVE_OPEN,
                 relative=FA_RELATIVE, meta_target=FA_META, names_kept=True)

_PERSIAN_SKEL = {"ب": "b", "پ": "p", "ت": "t", "ط": "t", "ث": "s", "س": "s", "ص": "s", "ج": "j", "چ": "c", "ح": "h", "خ": "k",
                 "د": "d", "ذ": "z", "ز": "z", "ض": "z", "ظ": "z", "ر": "r", "ژ": "j", "ش": "s", "غ": "g", "ق": "g", "ف": "f",
                 "ک": "k", "گ": "g", "ګ": "g", "ل": "l", "م": "m", "ن": "n", "ڼ": "n", "ټ": "t"}
_EN_SKEL = [("ph", "f"), ("th", "t"), ("sh", "s"), ("ch", "c"), ("kh", "k"), ("gh", "g"), ("ck", "k"), ("qu", "k"), ("x", "ks"),
            ("q", "k"), ("w", "v"), ("z", "z"), ("c", "k")]


def skeleton_fa(tok):
    """Consonant skeleton of a Persian token in the Latin letters of skeleton_en (vowel letters, hamza and final ه dropped)."""
    out = [_PERSIAN_SKEL[c] for c in tok if c in _PERSIAN_SKEL]
    return re.sub(r"(.)\1+", r"\1", "".join(out))


def skeleton_en(name):
    s = name.lower().split("'")[0]
    for a, b in _EN_SKEL:
        s = s.replace(a, b)
    s = re.sub(r"[aeiouyh]", "", s).replace("v", "")      # v / w / vowels may be written with و or not at all
    return re.sub(r"(.)\1+", r"\1", s)


def name_matches(name, tok, floor=0.6):
    """The Persian token spells the English name (transliteration), judged on consonant skeletons."""
    import difflib
    a, b = skeleton_en(name), skeleton_fa(tok)
    if not a or not b:
        return False
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= floor


def english_names(en, en_lower=frozenset()):
    """Character names of one English sentence: capitalised words after the first, and a capitalised first word that
    never appears lowercase in the story texts (en_lower)."""
    words = re.findall(r"[A-Za-z']+", en)
    out = []
    for i, w in enumerate(words):
        w = w.split("'")[0]
        if not A.CAP_WORD.fullmatch(w) or w in A.NOT_NAMES:
            continue
        if i == 0 and (not en_lower or w.lower() in en_lower):
            continue
        out.append(w)
    return out


def end_mark(en):
    m = re.search(r"([.!?])[\"')\]]*$", en.strip())
    return {"?": "؟", "!": "!", ".": "."}[m.group(1)] if m else None


_INVISIBLE = re.compile("[\u200e\u200f\ufeff\u202a-\u202e\u2066-\u2069\u200b\u200d]")      # direction marks, BOM, zero-width space and joiner (ZWNJ stays)


def with_stops(story):
    """The Dari books often leave the last sentence of a page without its stop. The English page ends with one, so the
    matching stop is added to the page (recorded in the build stats as `stop_added`, README names the change)."""
    ea = A._pages(story["twin"]["text_pages"])
    pages, added = [], 0
    for p in story["text_pages"]:
        t, e = p["text"], ea.get(p.get("n"))
        t = _INVISIBLE.sub("", t)
        plain = A.TAG_RE.sub(" ", t).rstrip()
        if e and plain and plain[-1] not in FA_END + "\"”»'" and ARABIC_RE.search(plain[-1:]) and end_mark(A.norm_en(e)):
            t, added = plain + end_mark(A.norm_en(e)), added + 1
        pages.append(dict(p, text=t))
    twin = dict(story["twin"], text_pages=[dict(p, text=_INVISIBLE.sub("", p["text"])) for p in story["twin"]["text_pages"]])
    return dict(story, text_pages=pages, twin=twin), added


# Dari forms the Iranian pack does not use (hand audit 2026-10-15): the copula استم/استی/استیم/استید/استند (Iranian هستم, هستی ...),
# مه "I", and school/car/shop/class words that mean something else or are rare in Iranian Persian. A sentence carrying one drops.
DARI_FORMS = frozenset({"استم", "استی", "استیم", "استید", "استند", "مه", "مکتب", "موتر", "دوکان", "صنف", "افتید"})


# Dari potential: participle + می‌تواند (Iranian: ببیند، پیدا شود). Review 2026-10-15: بوده می‌تواند, پیدا شده می‌تواند.
DARI_POTENTIAL = re.compile("(?:شده|بوده|کرده|رفته|آمده|داده|گفته|دیده|خورده|گرفته|یافته|زده|نموده)\\s+ن?می[\u200c ]?توان")
_DARI_SUFFIX = re.compile("(?:ها|های|ان|ات|ی|ش|م|ت|مان|تان|شان)?$")
_DARI_FIXED = frozenset({"استم", "استی", "استیم", "استید", "استند", "مه"})       # exact only: مه "fog" takes no suffix here


def dari_token(tok):
    """A DARI_FORMS token, bare or with a plural / clitic suffix (مکتبش, موترها)."""
    t = tok.replace("\u200c", "")
    if t in DARI_FORMS:
        return True
    if t in _DARI_FIXED:
        return False
    return any(t.startswith(f) and _DARI_SUFFIX.fullmatch(t[len(f):]) for f in DARI_FORMS - _DARI_FIXED)


def dari_sentence(u, word_re):
    return any(dari_token(t) for t in word_re.findall(u)) or bool(DARI_POTENTIAL.search(u))


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=3, max_tokens=14, glued=None, en_lower=frozenset(), checks=None):
    story, added = with_stops(story)
    stats["stop_added"] += added
    out = []
    for u, e, page in A.story_pairs(FA, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, glued, en_lower, checks):
        if dari_sentence(u, word_re):
            stats["dari_form"] += 1
            stats["kept"] -= 1
            continue
        out.append((u, e, page))
    return out
