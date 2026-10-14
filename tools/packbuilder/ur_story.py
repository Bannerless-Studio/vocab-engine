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
EN_DANGLING_OPEN = re.compile(r"^[\"']?(?:he|she|it|they|his|her|its|their|then|and|but|so|this|that|these|those|him|them|"
                              r"also|because|or|soon|later|after|next|yes|no)\b", re.I)
EN_NAMES_ONLY = re.compile(r"^[\"']?[A-Z][\w'-]*(?:[ ,]+(?:and )?[A-Z][\w'-]*)*[.!?\"']*$")
# the gloss of a reading level / publisher line that leaked into a page
EN_META = re.compile(r"\b(?:Level \d|Pratham|Let's Read|Creative Commons|licen[cs]e|illustrat|translat|The Asia Foundation)\b", re.I)
UR_META = re.compile(r"(?:مصنف|مصور|مترجم|اشاعت|لائسنس|پرتھم)")

FILTERS = ("pair_alignment", "not_terminated", "foreign_chars", "glued_words", "token_count", "onomatopoeia", "opener",
           "quotation_fragment", "names_only", "story_name", "meta_line", "duplicate")


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
    return re.sub(r"\s+", " ", s).strip()


def _balanced(s):
    n_open = sum(s.count(c) for c in OPEN_Q if c != "‘")
    n_close = sum(s.count(c) for c in CLOSE_Q if c != "’")
    return n_open == n_close and s.count('"') % 2 == 0


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
    return 0.5 <= _ratio(u, e) <= 2.0


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
    if merges != 1 or any(not 0.7 <= _ratio(u, e) <= 1.4 for u, e in out):
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


def pair_reason(ur, en, toks, min_tokens, max_tokens, glued=None, names=frozenset()):
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
    if first in UR_CONNECTIVE_OPEN or EN_DANGLING_OPEN.search(en):
        return "opener"
    if not _balanced(ur) or not _balanced(en):
        return "quotation_fragment"
    if EN_NAMES_ONLY.match(en):
        return "names_only"
    if names and any(w.split("'")[0] in names for w in re.findall(r"[A-Za-z']+", en)):
        return "story_name"
    if EN_META.search(en) or UR_META.search(ur):
        return "meta_line"
    return None


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=4, max_tokens=14, glued=None, en_lower=frozenset()):
    """Kept [(ur, en, page)] of one cached story. `seen` is the set of norm_key texts already shipped
    or in the pack (dedupe), updated here."""
    up = [p["text"] for p in story["text_pages"] if p["text"]]
    ep = [p["text"] for p in story["twin"]["text_pages"] if p["text"]]
    out = []
    names = story_names(ep, en_lower)
    for n, (u_page, e_page) in enumerate(zip(up, ep), 1):
        us, es = split_ur(u_page), split_en(e_page)
        stats["offered_sentences_ur"] += len(us)
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
            why = pair_reason(u, e, toks, min_tokens, max_tokens, glued, names)
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
