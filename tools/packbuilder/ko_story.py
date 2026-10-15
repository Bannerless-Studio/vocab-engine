"""Korean story rows: Storybooks Korea (Global Storybooks, African Storybook stories, CC BY 3.0 / 4.0) and Global Digital Library
(Let's Read mirror, books whose own credit page states CC BY) -> aligned (Korean, English) sentence pairs.

The alignment machinery is core/story_align.py; this module holds what is Korean: sentence ends, script test, quote normaliser,
opener and pronoun-subject words, credit-line patterns, and the credit helpers for the caches written by
tools/story_fetch/gsb_fetch.py (<repo>/.cache/stories/ko-gsb/<storyId>.json) and gdl_fetch.py (ko-gdl/<postId>.json).
Rules: Hangul transliterates character names, so a sentence whose English holds a character name is dropped (names_kept with
the spec's renamed check: a capitalised word that is a common noun elsewhere in the twin texts, Cow, Hare, is no name); no 1:2 bead (the extra English sentence is usually not in the Korean edition); a
per-sentence gloss agreement gate (agree_gate) because the Let's Read edition in particular is free; sentence ends are
. ? ! after 다 / 요 / 까 / 죠 endings, polite and plain register are both fine. The length ratio is wide (Korean text is
about 0.6 of the English characters, median over 737 equal-count pairs; 2% quantile 0.43, 98% 0.94).
"""
import re

from .core import story_align as A

KO_END = ".?!"
SPLIT_KO = re.compile(r"(?<=[.?!])[\"'”’»]*\s+")
KO_CONNECTIVE_OPEN = frozenset({
    "그리고", "그래서", "하지만", "그러나", "그런데", "그러자", "그러면", "그러고", "그렇지만", "그래도", "게다가", "또", "또한", "그러므로",
    "그리하여", "그러니까", "그렇다면", "그때", "그날", "그럼", "그러다", "그러던", "그러자마자", "하여", "또는", "혹은", "아니면", "왜냐하면",
    # pronoun subjects lean on the previous sentence (the English side is judged by the shared dangling-pronoun rule)
    "그는", "그가", "그녀는", "그녀가", "그들은", "그들이", "그것은", "그것이", "그의", "그녀의", "그들의", "그것의", "그를", "그녀를", "그들을", "그에게",
    "그녀에게", "그들에게", "그와", "그녀와", "그가", "이것은", "저것은", "이것이", "그건", "그게", "그걸"})
KO_RELATIVE = frozenset()          # Korean has no relative pronoun; a long clause is cut by the token ceiling
KO_META = re.compile(r"(?:작가|글쓴이|그림|삽화|번역|옮긴이|읽은 ?사람|라이선스|저작권|크리에이티브 ?커먼즈|African Storybook|Storybooks|Let'?s Read|Creative Commons)", re.I)
HANGUL = re.compile(r"[가-힣]")
NOT_KO = re.compile(r"[A-Za-z0-9㐀-鿿]")


def norm_ko(s):
    s = A.TAG_RE.sub(" ", s).replace(" ", " ")
    s = s.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'").replace("…", "...").replace("。", ".")
    s = re.sub(r"\s+([.?!])", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def _foreign(u, e):
    return bool(NOT_KO.search(u) or not HANGUL.search(u) or re.search(r"\d", e))


KO = A.StoryLang(code="ko", end=KO_END, split_re=SPLIT_KO, norm=norm_ko, foreign=_foreign, connective_open=KO_CONNECTIVE_OPEN,
                 relative=KO_RELATIVE, meta_target=KO_META, abbrev=None, ratio_lo=0.34, ratio_hi=1.1, names_kept=True, agree_gate=True,
                 beads=((1, 1), (2, 1)))


def _jong(c):
    return (ord(c) - 0xAC00) % 28 if "가" <= c <= "힣" else -1


# amateur editions run bound nouns and -고 auxiliaries into the verb ("갈때", "하는것", "먹고있었어요", "남자두명") and misspell a few endings; the
# pack would show them as the right spelling, so a token with one of these is a glued_words drop (a category, not the sentences that showed it)
MISSPELT = re.compile(r"됬|됀|바랬|거에요|게에요|거에$|꺼에요|할께|갈께|볼께|줄께|몇일|어떻해|않되|역활|금새|왠만|(?:\s|^)되요|웬지|고있|고싶")
CLASSIFIED = re.compile(r"[가-힣]{2,}(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)(?:명|마리|개|살|분|번)|"
                        r"(?:^|(?<=[가-힣]))(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)(?:명|마리|살|분)(?=[을를이가의은는도와과에로께서,.?!]|$)")


def glued_ko(tok):
    if MISSPELT.search(tok) or CLASSIFIED.search(tok):
        return True
    for i, c in enumerate(tok[1:], 1):
        if (c == "수" and tok[i + 1:i + 2] == "록") or (c == "때" and tok[:i + 1] == "한때"):      # 갈수록 (the more ...), 한때 (once)
            continue
        if c in "때것수" and (_jong(tok[i - 1]) in (4, 8) or tok[i - 1] == "는") and not (c == "수" and tok[i - 1] not in "할갈알올볼줄있"):
            return True
    return False


def story_pairs(story, word_re, norm_key, seen, stats, min_tokens=2, max_tokens=14, en_lower=frozenset(), checks=None):
    return A.story_pairs(KO, story, word_re, norm_key, seen, stats, min_tokens, max_tokens, glued_ko, en_lower, checks)


def names_of(v):
    out = []
    for chunk in v if isinstance(v, list) else [v]:
        for n in re.split(r"\s*(?:,|&|;|\band\b)\s*", chunk or ""):
            n = n.strip()
            if n and n not in out:
                out.append(n)
    return out


def contributing_translators(credit_text):
    """'... Contributing translators: A and B' on a Let's Read credit page -> ['A', 'B']."""
    m = re.search(r"Contributing translators?:\s*(.+?)\s*$", credit_text or "")
    return names_of(m.group(1)) if m else []
