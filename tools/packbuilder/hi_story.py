"""Hindi story rows: Bloom Library (cc-by, cc-by-sa, cc0) Hindi books -> aligned (Hindi, English) sentence pairs.

The alignment machinery is core/story_align.py; this module holds what is Hindi: sentence ends (danda), script test,
quote normaliser, opener and relative words, credit-line patterns, the Devanagari-to-Latin name check and the credit
helpers for the caches written by tools/story_fetch/bloom_fetch.py (<repo>/.cache/stories/hi-bloom/<bookId>.json).
Rules like Arabic and Indonesian: no 1:2 bead (the extra English sentence is usually not in the edition), a character
name present on both sides is a faithful pair (names_kept, consonant-skeleton match), a per-sentence gloss agreement
gate (agree_gate) because the Bloom translations are often free. Scripture books (Bible-story series, Nativity books,
Open Bible Stories credits) are left out whole.
"""
import re
import unicodedata

from .core import story_align as A

HI_END = "।॥?!."
DEV = "ऀ-ॣॱ-ॿ"
DEVANAGARI_RE = re.compile(f"[{DEV}]")
SPLIT_HI = re.compile(rf"(?<=[{HI_END}])[\"'”’»]*\s+")
ZW = re.compile("[​‌‍﻿‎‏]")
HI_CONNECTIVE_OPEN = frozenset({"और", "लेकिन", "मगर", "पर", "परंतु", "किंतु", "फिर", "तब", "तो", "क्योंकि", "इसलिए", "जब", "कि", "या", "बल्कि",
                                "अगर", "यदि", "जबकि", "तभी", "इसी", "उसी", "वह", "वो", "वे", "यह", "ये", "उसने", "उन्होंने", "इसने",
                                "उसे", "उन्हें", "इन्हें", "उसके", "उसकी", "उसका", "उनके", "उनकी", "उनका", "इसके", "इसकी", "इसका",
                                "इन", "उन", "उस", "इस", "अब", "अचानक", "फ़िर", "सो", "ताकि", "जैसे", "जैसा", "जहाँ", "जहां", "कभी", "वहाँ",
                                "वहां", "यहाँ", "यहां", "पहले", "बाद", "आखिर", "आख़िर", "इसीलिए", "इसीलिये", "अतः", "साथ"})
HI_RELATIVE = frozenset({"जो", "जिस", "जिसे", "जिसने", "जिसका", "जिसकी", "जिसके", "जिन", "जिन्हें", "जिन्होंने", "जिनका", "जिनकी", "जिनके",
                         "जहाँ", "जहां", "जैसा", "जैसी", "जैसे", "जितना", "जितनी", "जितने", "जब"})
HI_ABBREV = re.compile(r"(?:डॉ|श्री|मि|प्रो)\.$")      # a title does not end a sentence; also routes the splitter through the path that keeps a closing quote
HI_META = re.compile(r"(?:लेखक|चित्रकार|अनुवादक|अनुवाद|प्रकाशक|लाइसेंस|कॉपीराइट|क्रिएटिव कॉमन्स|प्रथम बुक्स|ब्लूम|चित्रांकन|रूपांतर)")


def norm_hi(s):
    s = A.TAG_RE.sub(" ", s).replace(" ", " ")
    s = ZW.sub("", unicodedata.normalize("NFC", s))
    s = s.replace("“", '"').replace("”", '"').replace("’’", '"').replace("‘‘", '"').replace("…", "...")
    s = re.sub(r"\s+([।॥?!,;])", r"\1", s)                                        # "खाया ।" -> "खाया।"
    s = re.sub(r"\"\s*([।?!]+)(?=\s|$)", r'\1"', s)                                # stop after the closing quote, as the English has it
    s = re.sub(r"([।?!.,])\s+\"(?=\s|$)", r'\1"', s)                                 # a closing quote typed after a space: "है। " अप्पू
    s = re.sub(rf"(?<=[{DEV}])\s*\.(?=[\"'”’)]*\s*$)", "।", s)                     # a sentence-final full stop is the danda
    s = re.sub(r"([?!])।", r"\1", s)
    s = re.sub(rf"(?<=[{DEV}])(?<!डॉ)(?<!श्री)(?<!मि)(?<!प्रो)\.(?=[\"'”’)]*\s)", "।", s)     # a full stop after Devanagari mid-text too (not after a title)
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool(A.LATIN_RE.search(u) or re.search(r"[०-९0-9]", u) or not DEVANAGARI_RE.search(u) or DEVANAGARI_RE.search(e) or re.search(r"\d", e))


HI = A.StoryLang(code="hi", end=HI_END, split_re=SPLIT_HI, norm=norm_hi, foreign=_foreign, connective_open=HI_CONNECTIVE_OPEN,
                 relative=HI_RELATIVE, meta_target=HI_META, abbrev=HI_ABBREV, names_kept=True, agree_gate=True, beads=((1, 1), (2, 1)))


# Some Bloom Hindi books are PDF text with a broken font map: vowel signs and viramas stand alone or open a word
# (्बेचारी, िुछ, ह द ै). A token that opens on a dependent sign is never Hindi.
SIGN_START = re.compile(r"(?:^|(?<=\s))[\u0900-\u0903\u093a\u093b\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963]")


def garbled(text):
    return bool(SIGN_START.search(norm_hi(text)))


def garbled_story(story, rate=0.01):
    """True when 1% or more of the book's tokens open on a vowel sign or virama (a font-mapped PDF): the whole book is left out."""
    toks = [t for p in story["text_pages"] for t in norm_hi(p["text"]).split()]
    return bool(toks) and sum(1 for t in toks if SIGN_START.match(t)) >= max(2, rate * len(toks))


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=3, max_tokens=14, glued=None, en_lower=frozenset(), checks=None):
    if garbled_story(story):
        stats["garbled_story"] += sum(len(A.split_target(HI, p["text"])) for p in story["text_pages"])
        stats["stories_rejected"] += 1
        return []
    story = dict(story, twin=dict(story["twin"], text_pages=[dict(p, text=ZW.sub(" ", p["text"])) for p in story["twin"]["text_pages"]]))   # a zero-width space in the English glues a heading to the next sentence
    out = []
    for u, e, page in A.story_pairs(HI, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, glued, en_lower, checks):
        if garbled(u):
            stats["garbled_text"] += 1
            stats["kept"] -= 1
            continue
        out.append((u, e, page))
    return out


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


_EN_SKEL = (("ph", "f"), ("ck", "k"), ("ch", "c"), ("sh", "s"), ("th", "t"), ("kh", "k"), ("gh", "g"), ("x", "ks"), ("q", "k"), ("w", "v"),
            ("z", "j"), ("y", "i"))


def _skel(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    for a, b in _EN_SKEL:
        s = s.replace(a, b)
    s = s[:1] + re.sub("[aeiouh]", "", s[1:]) if s[:1] not in "aeiou" else re.sub("[aeiouh]", "", s[1:])
    s = s.replace("c", "k").replace("g", "j").replace("d", "t").replace("b", "p")
    return re.sub(r"(.)\1+", r"\1", s)


def translit_ok(roman, en, ratio=0.66):
    """A crude consonant-skeleton match of a romanised Devanagari token (hi.translit) and a Latin name (राम Ram, मीना Meena)."""
    import difflib
    a, e = _skel(roman), _skel(en)
    return bool(a) and bool(e) and difflib.SequenceMatcher(None, a, e).ratio() >= ratio


BIBLE_RE = re.compile(r"Open Bible Stories|unfoldingWord|Sweet Publishing|Wycliffe|Door43|Book for Christmas|Nativity|Bible|Scripture|Gospel", re.I)


def is_bible(rec):
    """A Bloom book of the Bible-story series (topic:Bible tag, an Open Bible Stories credit, or a Christmas / Nativity story book): scripture, left out."""
    tags = (rec.get("raw") or {}).get("tags") or []
    return "topic:Bible" in tags or bool(BIBLE_RE.search((rec.get("credits") or "") + " " + " ".join(rec.get("illustrators") or [])
                                                          + " " + " ".join((rec.get("all_titles") or {}).values())))


def names_of(v):
    out = []
    for chunk in v if isinstance(v, list) else [v]:
        for n in re.split(r"\s*(?:,|&|;|\band\b)\s*", chunk or ""):
            n = n.strip()
            if n and n not in out:
                out.append(n)
    return out
