"""Swahili story rows: African Storybook (CC BY 4.0) Kiswahili books -> aligned (Swahili, English) sentence pairs.

The alignment machinery is core/story_align.py; this module holds what is Swahili: sentence ends, script test,
quote normaliser, opener and relative words, credit-line patterns, and the credit parser for the cache written by
tools/story_fetch/asb_fetch.py (<repo>/.cache/stories/sw-asb/<bookId>.json).
Swahili differs from Urdu in five rules. No pronoun openers (the subject sits in the verb, so only the English
dangling-pronoun rule and the Swahili connectives decide). No glued-words check (the ASb text keeps its spaces).
A character name present on both sides is a faithful pair, not a rename (names_kept). No 1:2 bead (one Swahili sentence
against two English ones): hand-read 2026-10-15, those rows mostly carried an English sentence the Swahili
edition does not have, the 1:1 rows almost never did (StoryLang.beads drops it). A per-sentence gloss
agreement gate (agree_gate), because ASb translations are often free: a pair whose words' glosses never show up
in the English is another sentence.
"""
import re

from .core import story_align as A

SW_END = ".?!"
SPLIT_SW = re.compile(r"(?<=[.?!])[\"'”’»]*\s+")
SW_CONNECTIVE_OPEN = frozenset({"na", "lakini", "kisha", "halafu", "basi", "hivyo", "ila", "au", "pia", "ndipo", "kwani", "ingawa",
                                "ambapo", "tena", "huku", "hata", "maana", "ama"})
SW_RELATIVE = frozenset({"ambaye", "ambao", "ambayo", "ambacho", "ambalo", "ambazo", "ambavyo", "ambapo", "ambako", "ambamo", "ambalo"})
SW_META = re.compile(r"\b(?:mwandishi|mchoraji|mfasiri|tafsiri|leseni|hakimiliki|African Storybook|Creative Commons)\b", re.I)
SW_ABBREV = re.compile(r"\b(?:Bw|Bi|Dkt|Mh|Mt|Prof)\.$")
NON_LATIN = re.compile(r"[^\x00-\x7f’‘“”«»…–— ]")


def norm_sw(s):
    s = A.TAG_RE.sub(" ", s).replace(" ", " ")
    s = re.sub(r"(?<=[A-Za-z])[’‘](?=[A-Za-z])", "'", s)      # ng’ombe -> ng'ombe
    s = s.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'").replace("…", "...")
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool(NON_LATIN.search(u) or not re.search(r"[A-Za-z]", u) or re.search(r"\d", u) or re.search(r"\d", e))


SW = A.StoryLang(code="sw", end=SW_END, split_re=SPLIT_SW, norm=norm_sw, foreign=_foreign, connective_open=SW_CONNECTIVE_OPEN,
                 relative=SW_RELATIVE, meta_target=SW_META, abbrev=SW_ABBREV, names_kept=True, agree_gate=True, beads=((1, 1), (2, 1)))


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=3, max_tokens=14, en_lower=frozenset(), checks=None):
    return A.story_pairs(SW, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, None, en_lower, checks)


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
