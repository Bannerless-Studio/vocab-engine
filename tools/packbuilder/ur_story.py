"""Urdu story rows: Let's Read Asia (CC-BY-4.0) stories -> aligned (Urdu, English) sentence pairs.

Pure functions, no tagger: `langs/ur.py` `story_rows` loads the cache written by
tools/story_fetch/lra_fetch.py (<repo>/.cache/stories/ur-lra/<bookId>.json) and calls
`story_pairs`. Every filter is counted in `Stats` so a build can print the yield table.

Pipeline per story: page i of the Urdu book <-> page i of its English twin (the fetcher
already required equal non-empty page counts), split both into sentences, align inside the
page, then drop pairs by the filters in FILTERS (order = the order they are applied).
"""
import math
import re
from collections import Counter

UR_END = "۔؟!?."
URDU_RE = re.compile(r"[؀-ۿ]")
LATIN_RE = re.compile(r"[A-Za-z0-9]")
SPLIT_UR = re.compile(rf"(?<=[{UR_END}])[\"'”’»]*\s+")
ABBREV = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|etc)\.$")
OPEN_Q, CLOSE_Q = "“«‘“", "”»’”"
# a sentence that opens on a connective or an unresolved pronoun leans on the previous sentence
UR_CONNECTIVE_OPEN = {"اور", "لیکن", "مگر", "پھر", "تو", "کیونکہ", "لہٰذا", "چنانچہ", "جبکہ", "بلکہ", "یا", "اسی", "اس", "اُس", "ان",
                      "انہوں", "انھوں", "وہ", "وہی", "یہ", "یہی", "جب", "سو", "پس"}
EN_DANGLING_OPEN = re.compile(r"^[\"']?(?:he|she|it|they|his|her|its|their|then|and|but|so|this|that|these|those|him|them)\b", re.I)
EN_NAMES_ONLY = re.compile(r"^[\"']?[A-Z][\w'-]*(?:[ ,]+(?:and )?[A-Z][\w'-]*)*[.!?\"']*$")
# the gloss of a reading level / publisher line that leaked into a page
EN_META = re.compile(r"\b(?:Level \d|Pratham|Let's Read|Creative Commons|licen[cs]e|illustrat|translat|The Asia Foundation)\b", re.I)
UR_META = re.compile(r"(?:مصنف|مصور|مترجم|اشاعت|لائسنس|پرتھم)")

UR_RELATIVE = {"جو", "جس", "جن", "جنہیں", "جسے", "جنہوں", "جہاں", "جیسا", "جیسی", "جیسے"}   # a relative clause is not A1 reading, and a sentence's level is its words' level
FILTERS = ("pair_alignment", "not_terminated", "foreign_chars", "glued_words", "token_count", "onomatopoeia", "opener", "complex_clause", "wrong_sense",
           "verse_page", "quotation_fragment", "names_only", "story_name", "meta_line", "duplicate")


class Stats(Counter):
    """offered / after each filter / kept, in a plain Counter (key = filter name = rows dropped)."""


TAG_RE = re.compile(r"<[^>]{0,40}>")


def norm_en(s):
    s = TAG_RE.sub(" ", s)
    s = (s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace(" ", " ")
         .replace("–", "-").replace("—", " - ").replace("…", "..."))
    return re.sub(r"\s+", " ", s).strip()


def norm_ur(s):
    s = TAG_RE.sub(" ", s).replace("\u00a0", " ")
    s = s.replace("\u2019\u2019", '"').replace("\u2018\u2018", '"').replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\"\s*([۔!؟?]+)(?=\s|$)", r'\1"', s)       # stop after the closing quote, as the English has it
    s = re.sub(r"([!؟?])۔", r"\1", s)                         # !۔ is one stop too many
    return re.sub(r"\s+", " ", s).strip()


def _balanced(s):
    n_open = sum(s.count(c) for c in OPEN_Q if c != "‘")
    n_close = sum(s.count(c) for c in CLOSE_Q if c != "’")
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


def split_ur(page):
    return _merge_unbalanced([p.strip() for p in SPLIT_UR.split(norm_ur(page)) if p.strip()])


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


def _ratio(u, e):
    return (len(u) + 6) / (len(e) + 6)      # +6 each: a 3-word sentence is mostly spaces and marks in Urdu


def _ok_ratio(u, e):
    return 0.7 <= _ratio(u, e) <= 1.4


def align_page(us, es):
    """Pairs [(ur, en)] for one page, or None when the page cannot be aligned.
    Equal counts: 1:1 as they are, a pair whose length ratio is out of range comes back as None. Otherwise a monotone alignment with beads 1:1, 2:1 and 1:2
    (the merged side is joined with a space) minimising the log char-length ratio; a bead outside
    ratio 0.5-2.0, or any leftover sentence, drops the page."""
    if not us or not es:
        return None
    if len(us) == len(es):
        return [(u, e) if _ok_ratio(u, e) else None for u, e in zip(us, es)]       # None: this pair only
    n, m = len(us), len(es)
    INF = float("inf")
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            if cost[i][j] == INF:
                continue
            for di, dj in ((1, 1), (2, 1), (1, 2)):
                a, b = i + di, j + dj
                if a > n or b > m:
                    continue
                u, e = " ".join(us[i:a]), " ".join(es[j:b])
                if not _ok_ratio(u, e):
                    continue
                c = cost[i][j] + abs(math.log(_ratio(u, e)))
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
    if merges != 1 or any(not _ok_ratio(u, e) for u, e in out):
        return None
    return out


def _tokens(word_re, ur):
    return word_re.findall(ur)


def _onomatopoeia(toks, en):
    if len(toks) >= 2 and len(set(toks)) <= max(1, len(toks) // 3):      # ٹپ ٹپ ٹپ ٹپ
        return True
    ew = re.findall(r"[A-Za-z']+", en.lower())
    return len(ew) >= 3 and len(set(ew)) == 1                           # Woof woof woof


NOT_NAMES = {"I", "Mum", "Mummy", "Mom", "Mommy", "Dad", "Daddy", "Papa", "Ma", "Baba", "Father", "Mother", "Grandma", "Grandpa",
             "Grandmother", "Grandfather", "Auntie", "Aunty", "Uncle", "Teacher", "Sir", "Madam", "Miss", "Mr", "Mrs", "Ms", "Dr"}
CAP_WORD = re.compile(r"[A-Z][a-z]+")


def story_names(es_pages, en_lower=frozenset()):
    """Capitalised words that occur inside a sentence of the story's English text: its character names.
    The Urdu edition often renames them (Vinay -> وقاص), so a sentence naming one is not a faithful pair.
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


def pair_reason(ur, en, toks, min_tokens, max_tokens, glued=None, names=frozenset(), checks=None):
    """Name of the first filter that drops this pair, or None."""
    if ur[-1] not in UR_END + "\"”»'" or not re.search(r"[.!?][\"']*$", en):
        return "not_terminated"
    if LATIN_RE.search(ur) or not URDU_RE.search(ur) or URDU_RE.search(en) or re.search(r"\d", en):
        return "foreign_chars"
    if glued and any(glued(t) for t in toks):          # the book text lost spaces: کےبازوصاف
        return "glued_words"
    if not (min_tokens <= len(toks) <= max_tokens) or len(en.split()) > 3 * max_tokens:
        return "token_count"
    if _onomatopoeia(toks, en):
        return "onomatopoeia"
    first = toks[0] if toks else ""
    if (first in UR_CONNECTIVE_OPEN or EN_DANGLING_OPEN.search(en)) and \
            not (checks and any(checks.noun(t) for t in toks[1:])):       # an opener leans on the last sentence unless a noun names its subject
        return "opener"
    if len(toks) > 10 and any(t in UR_RELATIVE for t in toks):
        return "complex_clause"
    if not _balanced(ur) or not _balanced(en):
        return "quotation_fragment"
    if EN_NAMES_ONLY.match(en):
        return "names_only"
    if checks and checks.wrong_sense(toks, en):
        return "wrong_sense"
    if names and any(w.split("'")[0] in names for w in re.findall(r"[A-Za-z']+", en)):
        return "story_name"
    if EN_META.search(en) or UR_META.search(ur):
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


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=4, max_tokens=14, glued=None, en_lower=frozenset(),
                checks=None):
    """Kept [(ur, en, page)] of one cached story. `seen` is the set of norm_key texts already shipped
    or in the pack (dedupe), updated here.

    Pages are paired by page number, never by position among the non-empty ones: a cover or credit page with
    text on one side only would shift every page after it. A page missing text on either side is skipped.
    `checks` (optional; ur.py builds it from the dictionary): noun(tok), wrong_sense(toks, en), agree(toks, en),
    and story_rate(page pairs): the share of pages whose words' glosses show up in the English; a story whose best page shift scores under 0.5 is a different text, rejected whole."""
    ua, ea = _pages(story["text_pages"]), _pages(story["twin"]["text_pages"])
    stats["offered_sentences_ur"] += sum(len(split_ur(ua[n])) for n in ua if ua[n])
    shift, both = 0, [n for n in sorted(ua) if ua[n] and ea.get(n)]
    if checks:
        shift = page_shift(ua, ea)
        ps = [(ua[n], ea[n + shift]) for n in sorted(ua) if ua[n] and ea.get(n + shift)]
        r = checks.story_rate(ps)
        if r is not None and r < 0.5:
            stats["story_disagrees"] += sum(len(split_ur(ua[n])) for n in both)
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
            stats["verse_page"] += len(split_ur(ua[n]))
            continue
        us, es = split_ur(ua[n]), split_en(ea[n])
        pairs = align_page(us, es)
        if pairs is None:
            stats["pair_alignment"] += len(us)
            continue
        stats["offered_pairs"] += len(pairs)
        for pr in pairs:
            if pr is None:
                stats["pair_alignment"] += 1
                continue
            u, e = pr
            toks = _tokens(word_re, norm_key(u))
            why = pair_reason(u, e, toks, min_tokens, max_tokens, glued, names, checks)
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
