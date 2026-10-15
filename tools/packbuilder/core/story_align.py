"""Language-independent story alignment: (target, English) sentence pairs from a book and its English twin.

Pure functions, no tagger. A `StoryLang` carries what differs per language (sentence ends, script test,
opener words, meta lines, text normaliser); `story_pairs` runs the shared pipeline and counts every filter in
`Stats`. Used by ur_story.py (Let's Read Asia) and langs/sw.py (African Storybook).

Pipeline per story: page n of the book <-> page n of its English twin (page-number pairing, after the best
page shift), split both into sentences, align inside the page, then drop pairs by the filters in FILTERS
(order = the order they are applied).
"""
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Optional

LATIN_RE = re.compile(r"[A-Za-z0-9]")
ABBREV = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|etc)\.$")
OPEN_Q, CLOSE_Q = "\u201c\u00ab\u2018\u201c", "\u201d\u00bb\u2019\u201d"
EN_DANGLING_OPEN = re.compile(r"^[\"']?(?:he|she|it|they|his|her|its|their|then|and|but|so|this|that|these|those|him|them)\b", re.I)
EN_NAMES_ONLY = re.compile(r"^[\"']?[A-Z][\w'-]*(?:[ ,]+(?:and )?[A-Z][\w'-]*)*[.!?\"']*$")
EN_META = re.compile(r"\b(?:Level \d|Pratham|Let's Read|Creative Commons|licen[cs]e|illustrat|translat|The Asia Foundation)\b", re.I)

FILTERS = ("pair_alignment", "not_terminated", "foreign_chars", "glued_words", "token_count", "onomatopoeia", "opener", "complex_clause", "wrong_sense", "no_agreement",
           "verse_page", "quotation_fragment", "names_only", "story_name", "meta_line", "duplicate")

TAG_RE = re.compile(r"<[^>]{0,40}>")
NOT_NAMES = {"I", "Mum", "Mummy", "Mom", "Mommy", "Dad", "Daddy", "Papa", "Ma", "Baba", "Father", "Mother", "Grandma", "Grandpa",
             "Grandmother", "Grandfather", "Auntie", "Aunty", "Uncle", "Teacher", "Sir", "Madam", "Miss", "Mr", "Mrs", "Ms", "Dr"}
CAP_WORD = re.compile(r"[A-Z][a-z]+")


class Stats(Counter):
    """offered / after each filter / kept, in a plain Counter (key = filter name = rows dropped)."""


@dataclass
class StoryLang:
    code: str
    end: str                                  # sentence-final marks of the target text
    split_re: "re.Pattern"                    # sentence boundary of the target text
    norm: Callable[[str], str]                # target text normaliser
    foreign: Callable[[str, str], bool]       # (target, english) carries characters that are not this pair's scripts
    connective_open: frozenset                # first tokens that lean on the previous sentence
    relative: frozenset                       # relative-clause tokens (a long sentence with one is complex)
    meta_target: "re.Pattern"                 # publisher / credit line in the target language
    abbrev: Optional["re.Pattern"] = None     # target abbreviation that does not end a sentence
    ratio_pad: int = 6                        # +pad on both char lengths before the ratio
    ratio_lo: float = 0.7
    ratio_hi: float = 1.4
    beads: tuple = ((1, 1), (2, 1), (1, 2))   # (target sentences, English sentences) steps of the aligner
    names_kept: bool = False                  # the translation keeps character names; story_name = checks.renamed(target, en): a name the English edition spells differently
    agree_gate: bool = False                  # checks.agree_pair(target, en) must hold: no word's gloss in the English means the pair is another text


def norm_en(s):
    s = TAG_RE.sub(" ", s)
    s = (s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"').replace("\u00a0", " ")
         .replace("\u2013", "-").replace("\u2014", " - ").replace("\u2026", "..."))
    return re.sub(r"\s+", " ", s).strip()


def _balanced(s):
    n_open = sum(s.count(c) for c in OPEN_Q if c != "\u2018")
    n_close = sum(s.count(c) for c in CLOSE_Q if c != "\u2019")
    return n_open == n_close and s.count('"') % 2 == 0 and _straight_alternate(s)


def _straight_alternate(s):
    """Straight quotes read as opener (after space or at the start, before a word) or closer (after a word);
    they must alternate and end closed: two openers in a row are two speeches glued into one row."""
    state = False
    for i, c in enumerate(s):
        if c != '"':
            continue
        opener = (i == 0 or s[i - 1].isspace() or s[i - 1] in "([") and i + 1 < len(s) and not s[i + 1].isspace()
        if opener == state:
            return False
        state = opener
    return not state


def _merge_unbalanced(pieces):
    out, buf = [], ""
    for p in pieces:
        buf = f"{buf} {p}".strip() if buf else p
        if _balanced(buf):
            out.append(buf)
            buf = ""
    if buf:
        out.append(buf)
    return out


CLOSERS = "\"'\u201d\u2019\u00bb)]"            # quote and bracket marks that close the sentence the stop ended


def _boundary(lang):
    return re.compile(r"(?<=[" + re.escape(lang.end) + r"])[" + re.escape(CLOSERS) + r"]*\s+")


def split_target(lang, page):
    """Sentences of one target page. The boundary is a stop (lang.end), any closing quotes or brackets, then space; the closers
    stay with the sentence they close (re.split would drop them, leaving a quoted sentence unbalanced and merged with the next).
    lang.abbrev, when set, names a ending that does not end a sentence."""
    text = lang.norm(page)
    pieces, start = [], 0
    for m in _boundary(lang).finditer(text):
        if lang.abbrev is not None and lang.abbrev.search(text[start:m.start()]):
            continue
        pieces.append(text[start:m.end()].strip())
        start = m.end()
    tail = text[start:].strip()
    if tail:
        pieces.append(tail)
    return _merge_unbalanced([p for p in pieces if p])


def split_en(page):
    page = norm_en(page)
    pieces, start = [], 0
    for m in re.finditer(r"[.!?]+[\"']*\s+(?=[\"']?[A-Z])", page):
        head = page[start:m.end()].strip()
        if ABBREV.search(page[start:m.start() + 1]):
            continue
        pieces.append(head)
        start = m.end()
    tail = page[start:].strip()
    if tail:
        pieces.append(tail)
    return _merge_unbalanced(pieces)


def _ratio(lang, u, e):
    return (len(u) + lang.ratio_pad) / (len(e) + lang.ratio_pad)


def _ok_ratio(lang, u, e):
    return lang.ratio_lo <= _ratio(lang, u, e) <= lang.ratio_hi


def align_page(lang, us, es):
    """Pairs [(target, en)] for one page, or None when the page cannot be aligned.
    Equal counts: 1:1 as they are, a pair whose length ratio is out of range comes back as None. Otherwise a monotone alignment with beads 1:1, 2:1 and 1:2
    (the merged side is joined with a space) minimising the log char-length ratio; a bead outside
    ratio 0.5-2.0, or any leftover sentence, drops the page."""
    if not us or not es:
        return None
    if len(us) == len(es):
        return [(u, e) if _ok_ratio(lang, u, e) else None for u, e in zip(us, es)]       # None: this pair only
    n, m = len(us), len(es)
    INF = float("inf")
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            if cost[i][j] == INF:
                continue
            for di, dj in lang.beads:
                a, b = i + di, j + dj
                if a > n or b > m:
                    continue
                u, e = " ".join(us[i:a]), " ".join(es[j:b])
                if not _ok_ratio(lang, u, e):
                    continue
                c = cost[i][j] + abs(math.log(_ratio(lang, u, e)))
                if c < cost[a][b]:
                    cost[a][b], back[a][b] = c, (i, j)
    if cost[n][m] == INF:
        return None
    out, i, j, merges = [], n, m, 0
    while (i, j) != (0, 0):
        pi, pj = back[i][j]
        merges += (i - pi, j - pj) != (1, 1)
        out.append((" ".join(us[pi:i]), " ".join(es[pj:j])))
        i, j = pi, pj
    out.reverse()
    # one merge is a split the two languages made differently; two or more is a page the lengths cannot vouch for
    if merges != 1 or any(not _ok_ratio(lang, u, e) for u, e in out):
        return None
    return out


def _onomatopoeia(toks, en):
    if len(toks) >= 2 and len(set(toks)) <= max(1, len(toks) // 3):      # a repeated syllable
        return True
    ew = re.findall(r"[A-Za-z']+", en.lower())
    return len(ew) >= 3 and len(set(ew)) == 1                           # Woof woof woof


def story_names(es_pages, en_lower=frozenset()):
    """Capitalised words that occur inside a sentence of the story's English text: its character names.
    A translated edition often renames them, so a sentence naming one is not a faithful pair.
    A capitalised first word whose lowercase form occurs nowhere in en_lower (the lowercase words of every
    twin text) is a name too (Navy, Chaxong opening a sentence)."""
    names = set()
    for page in es_pages:
        for sent in split_en(page):
            words = re.findall(r"[A-Za-z']+", sent)
            first = words[0].split("'")[0] if words else ""
            if en_lower and CAP_WORD.fullmatch(first) and first not in NOT_NAMES and first.lower() not in en_lower:
                names.add(first)
            for w in words[1:]:
                w = w.split("'")[0]
                if CAP_WORD.fullmatch(w) and w not in NOT_NAMES:
                    names.add(w)
    return names


def pair_reason(lang, u, en, toks, min_tokens, max_tokens, glued=None, names=frozenset(), checks=None):
    """Name of the first filter that drops this pair, or None."""
    if u[-1] not in lang.end + "\"\u201d\u00bb'" or not re.search(r"[.!?][\"']*$", en):
        return "not_terminated"
    if lang.foreign(u, en):
        return "foreign_chars"
    if glued and any(glued(t) for t in toks):          # the book text lost spaces
        return "glued_words"
    if not (min_tokens <= len(toks) <= max_tokens) or len(en.split()) > 3 * max_tokens:
        return "token_count"
    if _onomatopoeia(toks, en):
        return "onomatopoeia"
    first = toks[0] if toks else ""
    if (first.lower() in lang.connective_open or EN_DANGLING_OPEN.search(en)) and \
            not (checks and any(checks.noun(t) for t in toks[1:])):       # an opener leans on the last sentence unless a noun names its subject
        return "opener"
    if len(toks) > 10 and any(t.lower() in lang.relative for t in toks):
        return "complex_clause"
    if not _balanced(u) or not _balanced(en):
        return "quotation_fragment"
    if EN_NAMES_ONLY.match(en):
        return "names_only"
    if checks and checks.wrong_sense(toks, en):
        return "wrong_sense"
    if lang.agree_gate and checks and not checks.agree_pair(u, en):
        return "no_agreement"
    if lang.names_kept:
        if checks and checks.renamed(u, en):
            return "story_name"
    elif names and any(w.split("'")[0] in names for w in re.findall(r"[A-Za-z']+", en)):
        return "story_name"
    if EN_META.search(en) or lang.meta_target.search(u):
        return "meta_line"
    return None


def _pages(pages):
    """{page number: text}; a fixture without numbers is numbered by position."""
    return {p.get("n", k): p["text"] for k, p in enumerate(pages, 1)}


def verse_page(u, e):
    """A verse page (five or more short lines) on either side: a rhymed translation is free and re-breaks its
    lines, so sentences of the two pages only sit near each other."""
    def verse(t):
        lines = [x for x in re.split(r"<br\s*/?>|\n", t) if x.strip()]
        return len(lines) >= 5 and sum(map(len, lines)) / len(lines) < 40
    return verse(u) or verse(e)


def page_shift(ua, ea):
    """The page offset d (twin page n+d answers page n) of one story. Twin and original usually number their
    pages alike, or differ by a constant (a cover page with no text on one side): that natural offset stays.
    Another offset wins only when the page lengths fit it clearly better: a translation's page lengths keep a
    near-constant ratio, so the spread of the log ratio over pages is the misfit (a title page on one side
    only rotates every page after it while the page numbers still agree)."""
    import math
    a, b = [n for n in sorted(ua) if ua[n]], [n for n in sorted(ea) if ea[n]]
    natural = 0
    if a and len(a) == len(b) and len({y - x for x, y in zip(a, b)}) == 1:
        natural = b[0] - a[0]

    def misfit(d):
        r = [math.log((len(ua[n]) + 12) / (len(ea[n + d]) + 12)) for n in a if ea.get(n + d)]
        if len(r) < 3:
            return None
        m = sum(r) / len(r)
        return (sum((x - m) ** 2 for x in r) / len(r)) ** 0.5
    fit = {d: misfit(d) for d in {natural, 0, 1, -1, 2, -2, 3, -3}}
    fit = {d: v for d, v in fit.items() if v is not None}
    if natural not in fit:
        return natural
    best = min(fit, key=lambda d: (fit[d], d != natural))
    return best if fit[best] < 0.6 * fit[natural] and fit[natural] > 0.2 else natural


def story_pairs(lang, story, word_re, norm_key, seen, stats, min_tokens=4, max_tokens=14, glued=None, en_lower=frozenset(),
                checks=None):
    """Kept [(target, en, page)] of one cached story. `seen` is the set of norm_key texts already shipped
    or in the pack (dedupe), updated here.

    Pages are paired by page number, never by position among the non-empty ones: a cover or credit page with
    text on one side only would shift every page after it. A page missing text on either side is skipped.
    `checks` (optional; the language spec builds it from the dictionary): noun(tok), wrong_sense(toks, en), agree(toks, en),
    and story_rate(page pairs): the share of pages whose words' glosses show up in the English; a story whose best page shift scores under 0.5 is a different text, rejected whole."""
    ua, ea = _pages(story["text_pages"]), _pages(story["twin"]["text_pages"])
    stats[f"offered_sentences_{lang.code}"] += sum(len(split_target(lang, ua[n])) for n in ua if ua[n])
    shift, both = 0, [n for n in sorted(ua) if ua[n] and ea.get(n)]
    if checks:
        shift = page_shift(ua, ea)
        ps = [(ua[n], ea[n + shift]) for n in sorted(ua) if ua[n] and ea.get(n + shift)]
        r = checks.story_rate(ps)
        if r is not None and r < 0.5:
            stats["story_disagrees"] += sum(len(split_target(lang, ua[n])) for n in both)
            stats["stories_rejected"] += 1
            return []
        if shift:
            stats["stories_shifted"] += 1
        ea = {n - shift: t for n, t in ea.items()}
        both = [n for n in sorted(ua) if ua[n] and ea.get(n)]
    out = []
    names = story_names([ea[n] for n in both], en_lower)
    for n in both:
        if verse_page(ua[n], ea[n]):
            stats["verse_page"] += len(split_target(lang, ua[n]))
            continue
        us, es = split_target(lang, ua[n]), split_en(ea[n])
        pairs = align_page(lang, us, es)
        if pairs is None:
            stats["pair_alignment"] += len(us)
            continue
        stats["offered_pairs"] += len(pairs)
        for pr in pairs:
            if pr is None:
                stats["pair_alignment"] += 1
                continue
            u, e = pr
            toks = word_re.findall(norm_key(u))
            why = pair_reason(lang, u, e, toks, min_tokens, max_tokens, glued, names, checks)
            if why is None:
                k = norm_key(u)
                if k in seen:
                    why = "duplicate"
                else:
                    seen.add(k)
            if why:
                stats[why] += 1
            else:
                stats["kept"] += 1
                out.append((u, e, n))
    return out


def title_key(t):
    return re.sub(r"\s+", " ", (t or "").strip().lower())


GLOSS_STOP = set("the an of to in on at and or is are was were be been it its he she they we you my your our his her their this that "
                 "these those with for from by as not no do does did have has had will would can could what who how when where there "
                 "here then than so but if one form used".split())


def _estem(w):
    w = w.lower()
    if w.endswith("ves"):
        w = w[:-3] + "f"
    elif w.endswith("ies"):
        w = w[:-3] + "y"
    elif w.endswith("es") and len(w) > 4:
        w = w[:-2]
    elif w.endswith("s") and len(w) > 3:
        w = w[:-1]
    if w.endswith("ing") and len(w) > 5:
        w = w[:-3]
    elif w.endswith("ed") and len(w) > 4:
        w = w[:-2]
    return w[:5]


def gloss_stems(text):
    """Five-letter stems of the content words of an English gloss or sentence, parentheses dropped (same stemmer ur.py uses)."""
    return {_estem(w) for w in re.findall(r"[A-Za-z]{3,}", re.sub(r"\([^)]*\)", " ", text)) if w.lower() not in GLOSS_STOP}
