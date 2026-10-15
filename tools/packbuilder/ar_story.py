"""Arabic story rows: African Storybook (CC BY 4.0) and Bloom Library (cc-by, cc-by-sa, cc0) Arabic books -> aligned (Arabic, English) sentence pairs.

The alignment machinery is core/story_align.py; this module holds what is Arabic: sentence ends, script test, quote
normaliser, opener and relative words, credit-line patterns, the stop repair (the ASb pages often leave the last sentence
of a page without its stop; the English page has one, so the matching stop is added), the dialect table (the pack is
Modern Standard Arabic), and the credit parser for the caches written by tools/story_fetch/asb_fetch.py
(<repo>/.cache/stories/ar-asb/<bookId>.json) and bloom_fetch.py (<repo>/.cache/stories/ar-bloom/<id>.json).
"""
import re

from .core import story_align as A

AR_END = ".؟!?"
ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿ]")
SPLIT_AR = re.compile(rf"(?<=[{AR_END}])[\"'”’»]*\s+")
# a sentence that opens on one of these leans on the previous sentence (glued و / ف openers are caught by the English dangling rule)
AR_CONNECTIVE_OPEN = frozenset({"ثم", "لكن", "لكنه", "لكنها", "لكني", "لكنني", "لذلك", "لذا", "لأن", "لأنه", "لأنها", "بل", "أو", "أم", "كما", "أيضا",
                                "أيضاً", "حتى", "عندها", "عندئذ", "بعدها", "حينها", "هكذا", "بينما", "إذن", "إذا", "فقط", "كذلك", "وهكذا",
                                "إلا", "غير", "رغم", "مع", "ولكن", "فلما", "لما", "حين", "عندما", "بعد", "قبل", "ولذلك"})
AR_RELATIVE = frozenset({"الذي", "التي", "الذين", "اللذان", "اللتان", "اللواتي", "اللاتي", "اللائي", "حيث", "الذى", "التى"})
AR_META = re.compile(r"(?:المؤلف|مؤلف|الرسام|رسام|المترجم|مترجم|ترجمة|الترجمة|رخصة|ترخيص|حقوق الطبع|الناشر|ناشر|African Storybook|المساهمون|"
                     r"كريتيف|المشاع الإبداعي)")
EN_STRIP = re.compile("[\u200e\u200f\ufeff\u202a-\u202e\u2066-\u2069\u200b]")      # direction marks, BOM, zero-width space
TATWEEL = "ـ"
LEADING_MARK = re.compile(r"([!؟])\s*([^!؟?.]+?)\s*\.?")
HARAKAT = re.compile("[\u064b-\u0652\u0670]")      # fathatan .. sukun, dagger alef; the pack text carries no vowel marks


def norm_ar(s):
    s = A.TAG_RE.sub(" ", s).replace("\u00a0", " ")
    s = EN_STRIP.sub("", s).replace(TATWEEL, "")
    s = s.replace("“", '"').replace("”", '"').replace("«", '"').replace("»", '"').replace("’’", '"').replace("‘‘", '"').replace("…", "...")
    s = HARAKAT.sub("", s).replace("ک", "ك").replace("ی", "ي")           # vowel marks off, Persian keyboard letters to Arabic
    s = re.sub(r"\"\s*([.؟!?]+)(?=\s|$)", r'\1"', s)                   # stop after the closing quote, as the English has it
    s = re.sub(r"([!؟?])\.", r"\1", s)
    s = s.replace("؟?", "؟").replace("?", "؟")                           # the Latin question mark is the Arabic one
    m = LEADING_MARK.fullmatch(s)
    if m:                                                                # typed right to left: the mark sits first, a stop last
        s = m.group(2) + m.group(1)
    s = re.sub(r"\s+([،؛])", r"\1", s)
    s = re.sub(r"([،؛])(?=[^\s\d])", r"\1 ", s)
    s = re.sub(r"(?<![\u0621-\u064a])([وف]) (?=[\u0621-\u064a]{2})", r"\1", s)       # "و استمعوا": the conjunction is one word with its verb
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool("\ufffd" in u or A.LATIN_RE.search(u) or re.search(r"[٠-٩۰-۹]", u) or not ARABIC_RE.search(u) or ARABIC_RE.search(e) or re.search(r"\d", e))


# names_kept: the Arabic edition transliterates character names (Lucy -> لوسي); checks.renamed compares the English
# names of a sentence with its Arabic tokens by consonant skeleton (ar.py _translit_ok) and with pack glosses.
AR = A.StoryLang(code="ar", end=AR_END, split_re=SPLIT_AR, norm=norm_ar, foreign=_foreign, connective_open=AR_CONNECTIVE_OPEN,
                 relative=AR_RELATIVE, meta_target=AR_META, names_kept=True, agree_gate=True)


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


def with_stops(story):
    """ASb pages often leave the last sentence of a page without its stop ("أختي نائمة"); the English page ends with one, so the
    matching stop is added to the page (recorded in the build stats as `stop_added`, README names the change)."""
    ea = A._pages(story["twin"]["text_pages"])
    pages, added = [], 0
    for p in story["text_pages"]:
        t, e = p["text"], ea.get(p.get("n"))
        t = EN_STRIP.sub("", t)
        plain = A.TAG_RE.sub(" ", t).rstrip()
        if e and plain and plain[-1] not in AR_END + "\"”»'" and ARABIC_RE.search(plain[-1:]) and end_mark(A.norm_en(e)):
            t, added = plain + end_mark(A.norm_en(e)), added + 1
        pages.append(dict(p, text=t))
    twin = dict(story["twin"], text_pages=[dict(p, text=EN_STRIP.sub("", p["text"])) for p in story["twin"]["text_pages"]])
    return dict(story, text_pages=pages, twin=twin), added


# Dialect-only forms: the pack is Modern Standard Arabic (the Tatoeba side is filtered by langs/ar.py is_dialect on the same lists).
# A story sentence carrying one drops (stats `dialect_form`). Exact tokens, harakat already off. Homographs that are MSA words
# (هما, دول, بدو, شي, هاي, أوي, إيه "verse", بكرة, كمان, هادي, هون) stay out. No fetched ASb or Bloom Arabic sentence has needed it
# (hand audit 2026-10-15: the translations are MSA); the table is the guard for the next books.
DIALECT_FORMS = frozenset(
    # Levantine
    "شو هيك كتير منيح منيحة بدي بدك بدها بدنا مو ليش وين هلق هلأ مشان هيدا هيدي هاد هاذا هاذي رح".split()
    # Egyptian
    + "ده دي كده كدة دلوقتي إزاي ازاي عايز عاوز عايزة فين إمتى امتى بتاع بتاعي لسه لسا كويس كويسة علشان مفيش معلش ايوه أيوه إحنا احنا انتو إنتو".split()
    # Gulf, Iraqi
    + "شلون شنو ماكو مافي وايد جدام تبغى ابغى أبغى يبغى وش ايش إيش شكون".split()
    # Maghrebi
    + "برشا بزاف واش كيفاش دابا راني هادا فماش بالزاف".split()
    # colloquial relative and demonstratives
    + "اللي إللي هذول".split())
# colloquial progressive عم + imperfect (عم يلعب), Egyptian ب- present (بيلعب) is too ambiguous to list
DIALECT_PHRASE = re.compile(r"(?:^| )عم [يتنأ][\u0621-\u064a]{2,}(?= |$)")


def dialect_sentence(u, word_re):
    return any(t in DIALECT_FORMS for t in word_re.findall(u)) or bool(DIALECT_PHRASE.search(u))


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=3, max_tokens=14, glued=None, en_lower=frozenset(), checks=None):
    story, added = with_stops(story)
    stats["stop_added"] += added
    out = []
    for u, e, page in A.story_pairs(AR, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, glued, en_lower, checks):
        if dialect_sentence(u, word_re):
            stats["dialect_form"] += 1
            stats["kept"] -= 1
            continue
        out.append((u, e, page))
    return out


def names_of(s):
    """['A, B and C'] -> ['A', 'B', 'C']; the ASb back cover joins people with commas and "and"."""
    out = []
    for chunk in s if isinstance(s, list) else [s]:
        for n in re.split(r"\s*(?:,|&|;|\band\b)\s*", chunk or ""):
            n = n.strip()
            if n and n not in out:
                out.append(n)
    return out


def holder(copyright_block):
    """The copyright holder line of the back cover: the first line, minus the (c) sign."""
    first = (copyright_block or "").split("\n")[0]
    return re.sub(r"^\s*(?:©|\(c\))\s*", "", first).strip()
