"""Urdu story rows: Let's Read Asia (CC-BY-4.0) stories -> aligned (Urdu, English) sentence pairs.

The alignment and filter machinery is language-independent and lives in core/story_align.py; this module holds
what is Urdu: sentence ends, script test, quote normaliser, opener and relative words, credit-line patterns.
`langs/ur.py` `story_rows` loads the cache written by tools/story_fetch/lra_fetch.py
(<repo>/.cache/stories/ur-lra/<bookId>.json) and calls `story_pairs`. Names below keep their old spelling so callers and tests are unchanged.
"""
import re

from .core import story_align as A
from .core.story_align import (ABBREV, CLOSE_Q, EN_DANGLING_OPEN, EN_META, EN_NAMES_ONLY, FILTERS, LATIN_RE, NOT_NAMES,  # noqa: F401
                               OPEN_Q, Stats, TAG_RE, _balanced, _merge_unbalanced, _onomatopoeia, _pages, _straight_alternate,
                               norm_en, page_shift, split_en, story_names, title_key, verse_page)

UR_END = "۔؟!?."
URDU_RE = re.compile(r"[؀-ۿ]")
SPLIT_UR = re.compile(rf"(?<=[{UR_END}])[\"'”’»]*\s+")
# a sentence that opens on a connective or an unresolved pronoun leans on the previous sentence
UR_CONNECTIVE_OPEN = {"اور", "لیکن", "مگر", "پھر", "تو", "کیونکہ", "لہٰذا", "چنانچہ", "جبکہ", "بلکہ", "یا", "اسی", "اس", "اُس", "ان",
                      "انہوں", "انھوں", "وہ", "وہی", "یہ", "یہی", "جب", "سو", "پس"}
UR_META = re.compile(r"(?:مصنف|مصور|مترجم|اشاعت|لائسنس|پرتھم)")
UR_RELATIVE = {"جو", "جس", "جن", "جنہیں", "جسے", "جنہوں", "جہاں", "جیسا", "جیسی", "جیسے"}   # a relative clause is not A1 reading, and a sentence's level is its words' level


def norm_ur(s):
    s = TAG_RE.sub(" ", s).replace("\u00a0", " ")
    s = s.replace("\u2019\u2019", '"').replace("\u2018\u2018", '"').replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\"\s*([۔!؟?]+)(?=\s|$)", r'\1"', s)       # stop after the closing quote, as the English has it
    s = re.sub(r"([!؟?])۔", r"\1", s)                         # !۔ is one stop too many
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool(LATIN_RE.search(u) or not URDU_RE.search(u) or URDU_RE.search(e) or re.search(r"\d", e))


UR = A.StoryLang(code="ur", end=UR_END, split_re=SPLIT_UR, norm=norm_ur, foreign=_foreign,
                 connective_open=frozenset(UR_CONNECTIVE_OPEN), relative=frozenset(UR_RELATIVE), meta_target=UR_META)


def split_ur(page):
    return A.split_target(UR, page)


def align_page(us, es):
    return A.align_page(UR, us, es)


def pair_reason(ur, en, toks, min_tokens, max_tokens, glued=None, names=frozenset(), checks=None):
    return A.pair_reason(UR, ur, en, toks, min_tokens, max_tokens, glued, names, checks)


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=4, max_tokens=14, glued=None, en_lower=frozenset(), checks=None):
    return A.story_pairs(UR, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, glued, en_lower, checks)
