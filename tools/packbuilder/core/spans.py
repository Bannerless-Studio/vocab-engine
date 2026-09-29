"""Link spans: where a linked word sits in a sentence's text.

Shared by the sentence stage (core.sentences: sentences.json `spans`) and the
reading passages (passages.py: passages.json sentences[].spans). A span is
[start, end, wordId] in UTF-16 code units (JavaScript string indices) of the
text; spans are sorted and never overlap (docs/PACK_SCHEMA.md).
"""
import re
import unicodedata


def token_offsets(text, toks, fold=None, joiners=""):
    """Per token, its (start, end) in `text` (Python str offsets), or None.
    Tokens are found in order, case-insensitively (the tagger saw truecased
    text). Between two located tokens only non-alphanumeric text may be
    skipped; a token not found that way is None, and the next token may then
    skip at most the unlocated tokens' text (a tokenizer or fix_token rewrite
    of a surface resynchronises instead of drifting). A word token found after
    skipped text never starts inside a word, and while resynchronising an
    alphanumeric token must also end at a word end.

    fold (spec.span_fold): string normaliser applied to text and surfaces
    before matching, to the text one alphanumeric run (a word) or one other
    character at a time, so multi-character rules inside a word apply (fa:
    پائین = پایین, ابتداء = ابتدا). Offsets map back to `text`; a match
    ending where a folded word ends ends where the original word ends.
    joiners (spec.span_joiners): characters of the text that may sit between
    two characters of a surface (the tagger input rewrite removed them: fa
    "می روم" -> token میروم); at most one per token."""
    if fold is None:
        ftext, fmap, fend = text, None, None
    else:
        ftext, fmap, fend = _fold_map(text, fold)
    out, at, pending = [], 0, 0
    for tok in toks:
        surf = tok[0] or ""
        if fold is not None:
            surf = fold(surf)
        m = None
        if surf:
            if joiners:
                j = "[" + re.escape(joiners) + "]?"
                pat = j.join(re.escape(ch) for ch in surf)
            else:
                pat = re.escape(surf)
            for c in re.compile(pat, re.IGNORECASE).finditer(ftext, at):
                if sum(ch.isalnum() for ch in ftext[at:c.start()]) > pending:
                    break
                if joiners and sum(ch in joiners for ch in c.group(0)) > 1:
                    continue
                if c.start() != at and surf[:1].isalnum() and ftext[c.start() - 1:c.start()].isalnum():
                    continue    # not after a skip: never start inside a word ("e" in mercato)
                if pending and surf[-1:].isalnum() and ftext[c.end():c.end() + 1].isalnum():
                    continue    # resyncing: the token must end where a word ends
                m = c
                break
        if m is None:
            out.append(None)
            pending += len(surf)
            continue
        at, pending = m.end(), 0
        if fmap is None:
            out.append((m.start(), m.end()))
        else:
            out.append((fmap[m.start()], fend.get(m.end(), fmap[m.end() - 1] + 1)))
    return out


def _fold_map(text, fold):
    """fold applied per alphanumeric run and per other character. Returns
    (folded text, folded index -> text index, {folded end of a run: text end
    of the run})."""
    ftext, fmap, fend = [], [], {}
    i = 0
    while i < len(text):
        j = i + 1
        if text[i].isalnum():
            while j < len(text) and text[j].isalnum():
                j += 1
        run = text[i:j]
        fr = fold(run)
        if j - i == 1:
            fmap += [i] * len(fr)
        else:
            done = 0            # folded chars of the run mapped so far
            for k in range(1, len(run) + 1):
                n = min(len(fold(run[:k])), len(fr)) if k < len(run) else len(fr)
                fmap += [i + k - 1] * max(0, n - done)
                done = max(done, n)
        ftext.append(fr)
        if fr and j - i > 1:
            fend[len(fmap)] = j
        i = j
    return "".join(ftext), fmap, fend


def utf16_index(text, i):
    """Python str index -> UTF-16 code-unit index (a JavaScript string index)."""
    return i + sum(1 for ch in text[:i] if ord(ch) > 0xFFFF)


def _is_mark(ch):
    return unicodedata.category(ch) in ("Mn", "Mc")


def _mark_bounds(text, a, b):
    """A span owns the combining marks (Unicode Mn/Mc) that follow its last
    character (fa لطفاً: the tanwin the folded surface lacks) and never starts
    on one. Text without combining marks (NFC Latin, Cyrillic) is unchanged."""
    while b < len(text) and _is_mark(text[b]):
        b += 1
    while a < b and _is_mark(text[a]):
        a += 1
    return a, b


def span_ranges(text, offsets, recs, ids):
    """make_spans before the UTF-16 conversion: sorted, non-overlapping
    (start, end, wordId) in Python str offsets of `text`."""
    idset = set(ids)
    cand = []
    for kind, a, b, wid in recs:
        if wid not in idset:
            continue
        if kind == "chars":
            se = (a, b)
        elif offsets[a] is not None and offsets[b] is not None:
            se = (offsets[a][0], offsets[b][1])
        else:
            continue
        se = _mark_bounds(text, *se)
        if se[1] > se[0] and text[se[0]:se[1]].strip():
            cand.append((se[0], se[1], wid))
    cand.sort(key=lambda c: (-(c[1] - c[0]), c[0]))
    keep = []
    for c in cand:
        if not any(c[0] < k[1] and k[0] < c[1] for k in keep):
            keep.append(c)
    keep.sort()
    return keep


def make_spans(text, offsets, recs, ids):
    """Link records (sentence_links `where` entries) -> sorted, non-overlapping
    [[start, end, wordId], ...] in UTF-16 code units. Only ids in `ids` get
    spans; a record whose token has no offset is skipped. Overlaps keep the
    longer span (per start, earliest first), so "per favore" beats favore.
    Each span's bounds pass _mark_bounds first (trailing combining marks join
    the span; none starts on one)."""
    return [[utf16_index(text, a), utf16_index(text, b), wid] for a, b, wid in span_ranges(text, offsets, recs, ids)]


def _index_map(raw, clean):
    """raw index -> clean index for every character the two texts share
    (difflib equal blocks and same-length replacements, one to one); a
    character the cleaning dropped or rewrote to another length has none."""
    from difflib import SequenceMatcher
    out = {}
    for op, a0, a1, b0, b1 in SequenceMatcher(None, raw, clean, autojunk=False).get_opcodes():
        if op == "equal" or (op == "replace" and a1 - a0 == b1 - b0):
            out.update(zip(range(a0, a1), range(b0, b1)))
    return out


def move_ranges(raw, clean, ranges, clean_fn):
    """span_ranges on `raw` -> the same words' ranges in `clean` (spec.
    clean_sentence_text(raw)), dropping any range that does not survive: its
    first and last mapped characters bound the new range, and the cleaned
    range must read exactly clean_fn(raw range) (ru: a stress mark dropped
    inside the word; hi: a ZWJ). Returns (ranges, number dropped)."""
    if raw == clean:
        return list(ranges), 0
    imap = _index_map(raw, clean)
    out, dropped = [], 0
    for a, b, wid in ranges:
        hit = [imap[i] for i in range(a, b) if i in imap]
        if hit and clean[hit[0]:hit[-1] + 1] == clean_fn(raw[a:b]) and \
                (not out or out[-1][1] <= hit[0]):
            out.append((hit[0], hit[-1] + 1, wid))
        else:
            dropped += 1
    return out, dropped


def sentence_spans(spec, raw, clean, toks, where, ids):
    """sentences.json `spans` for one shipped sentence: its sentence_links
    `where` records placed on the tagged text `raw` (token_offsets with
    spec.span_fold / span_joiners, span_ranges: longer wins an overlap) and
    moved onto the shipped text `clean`, in UTF-16 code units. A link with no
    placeable record gets no span (the engine locates it by surface).
    Returns (spans, ranges dropped by the move)."""
    offsets = token_offsets(raw, toks, spec.span_fold, spec.span_joiners)
    ranges, dropped = move_ranges(raw, clean, span_ranges(raw, offsets, where, ids), spec.clean_sentence_text)
    return [[utf16_index(clean, a), utf16_index(clean, b), wid] for a, b, wid in ranges], dropped
