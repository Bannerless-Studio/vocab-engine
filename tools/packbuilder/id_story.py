"""Indonesian story rows: Let's Read Asia (CC BY 4.0) and Bloom Library (cc-by / cc-by-sa) Indonesian books -> aligned
(Indonesian, English) sentence pairs.

The alignment machinery is core/story_align.py; this module holds what is Indonesian: sentence ends, script test, quote
normaliser, opener and relative words, credit-line patterns, and the credit helpers for the caches written by
tools/story_fetch/lra_fetch.py (<repo>/.cache/stories/id-lra/<bookId>.json) and bloom_fetch.py (id-bloom/<bookId>.json).
Rules like Swahili: no pronoun openers (the English dangling-pronoun rule decides), a character name present on both sides is a
faithful pair (names_kept), no 1:2 bead, and a per-sentence gloss agreement gate (agree_gate) because the translations are
often free. Differences: the Let's Read Asia twin of a book may have 1-2 text pages more or less than the Indonesian
(status ok_off, kept: the best page shift, the page-level story_rate and the agreement gate vouch for each pair); Bloom
Bible-story derivatives (topic:Bible, Open Bible Stories) are left out.
"""
import re

from .core import story_align as A

ID_END = ".?!"
SPLIT_ID = re.compile(r"(?<=[.?!])[\"'”’»]*\s+")
ID_CONNECTIVE_OPEN = frozenset({"dan", "tetapi", "tapi", "lalu", "kemudian", "maka", "atau", "namun", "sebab", "karena", "lantas",
                                "sedangkan", "sehingga", "jadi", "serta", "juga", "padahal", "walaupun", "meskipun", "sementara",
                                "akhirnya", "setelah", "sesudah", "sebelum", "ketika", "saat", "hingga", "sampai", "agar", "supaya",
                                "bahkan", "sambil", "lagi", "sekarang", "ternyata"})
ID_RELATIVE = frozenset({"yang", "dimana", "di mana"})
ID_META = re.compile(r"\b(?:penulis|pengarang|ilustrator|penerjemah|diterjemahkan|lisensi|hak cipta|Let's Read|StoryWeaver|Creative Commons|"
                     r"Pratham|Bloom Library|penerbit)\b", re.I)
ID_ABBREV = re.compile(r"\b(?:Bpk|Dr|Prof|Tn|Ny|Sdr|Hj|dll|dsb|dst|yg|dg|No|Jl|Ir|Drs|Mr|Mrs)\.$")
NON_LATIN = re.compile(r"[^\x00-\x7f’‘“”«»…–— ]")


def norm_id(s):
    s = A.TAG_RE.sub(" ", s).replace(" ", " ")
    s = s.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'").replace("…", "...")
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool(NON_LATIN.search(u) or not re.search(r"[A-Za-z]", u) or re.search(r"\d", u) or re.search(r"\d", e))


ID = A.StoryLang(code="id", end=ID_END, split_re=SPLIT_ID, norm=norm_id, foreign=_foreign, connective_open=ID_CONNECTIVE_OPEN,
                 relative=ID_RELATIVE, meta_target=ID_META, abbrev=ID_ABBREV, names_kept=True, agree_gate=True, beads=((1, 1), (2, 1)))


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=3, max_tokens=14, en_lower=frozenset(), checks=None):
    return A.story_pairs(ID, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, None, en_lower, checks)


BIBLE_RE = re.compile(r"Open Bible Stories|unfoldingWord|Sweet Publishing|Wycliffe|Door43", re.I)


def is_bible(rec):
    """A Bloom book of the Bible-story series (topic:Bible tag or an Open Bible Stories credit): scripture, left out."""
    tags = (rec.get("raw") or {}).get("tags") or []
    return "topic:Bible" in tags or bool(BIBLE_RE.search((rec.get("credits") or "") + " " + " ".join(rec.get("illustrators") or [])))


def names_of(v):
    out = []
    for chunk in v if isinstance(v, list) else [v]:
        for n in re.split(r"\s*(?:,|&|;|\band\b|\bdan\b)\s*", chunk or ""):
            n = n.strip()
            if n and n not in out:
                out.append(n)
    return out


def holder(copyright_line):
    """'Copyright © 2023, X' -> 'X'."""
    s = re.sub(r"^\s*(?:Copyright|©|\(c\))\s*(?:©)?\s*", "", copyright_line or "", flags=re.I)
    return re.sub(r"^[\d,\s\-–]+", "", s).strip()
