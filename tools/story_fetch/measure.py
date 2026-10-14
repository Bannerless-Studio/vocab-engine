#!/usr/bin/env python3
"""Stage-0 measure of fetched story caches against a pack (Urdu defaults).
Usage: python3 tools/story_fetch/measure.py --pack ../urdu --dirs ../urdu/.cache/stories/ur ../urdu/.cache/stories/ur-lra [--population 292]
Reads <id>.json records (status ok = twin found; twin_null stories count for text-only numbers).
Proxy rules, stricter or looser than the builder where noted: a sentence 'passes' when 4..14 tokens and every token
is a pack surface (word, lemma, generated forms, pronoun forms); the builder's real filter is on content lemmas
(content_lemma_outside_pack_top3000), so 'passes' is a LOWER bound for sentence yield."""
import argparse, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from packbuilder.langs import ur  # noqa: E402

TOK = re.compile(r'[؀-ۿ]+')
END = re.compile(r'(?<=[۔؟!?])\s+|\n+')
RULES = {'coverage': {'A1': 0.95, 'A2': 0.95, 'B1': 0.93}, 'words': {'A1': (60, 90), 'A2': (100, 140), 'B1': (150, 200)}}


def surfaces(pack):
    words = json.load(open(os.path.join(pack, 'pack/words.json')))
    s = set()
    for w in words:
        s.add(ur.fold(w['w'])); s.add(ur.fold(w['lemma']))
        if w['pos'] == 'verb':
            s |= {ur.fold(x) for x in ur.verb_forms(w['lemma'])}
        elif w['pos'] in ('noun', 'n'):
            s |= {ur.fold(x) for x in ur.noun_forms(w['lemma'], 'm') | ur.noun_forms(w['lemma'], 'f')}
    s |= {ur.fold(k) for k in ur.PRON_FORMS}
    # inflection closure the builder gets from its linker: ا-final adjectives/postpositions agree (کا کی کے), copula forms
    s |= {ur.fold(x[:-1] + e) for x in list(s) if x.endswith('ا') and len(x) > 1 for e in 'یے'}
    s |= {ur.fold(x) for x in 'ہے ہیں ہوں ہو تھا تھی تھے تھیں ہوا ہوئی ہوئے ہوئیں گیا گئی گئے گئیں'.split()}
    return s


def toks(t):
    return TOK.findall(ur.fold(ur.text_norm(t)))


def sents(t):
    return [x.strip() for x in END.split(ur.text_norm(t)) if x.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pack', required=True); ap.add_argument('--dirs', nargs='+', required=True)
    ap.add_argument('--population', type=int, default=0, help='number of CC BY stories the sample stands for (extrapolation)')
    a = ap.parse_args()
    S = surfaces(a.pack)
    recs = []
    for d in a.dirs:
        for f in sorted(glob.glob(os.path.join(d, '*.json'))):
            if os.path.basename(f) in ('manifest.json', 'list.json', 'run-stats.json') or os.path.basename(f).startswith('list-'):
                continue
            r = json.load(open(f))
            if r.get('status') in ('ok', 'twin_null') and r.get('text_pages'):
                recs.append(r)
    n = len(recs)
    tot = {'stories': n, 'twin_ok': sum(1 for r in recs if r['status'] == 'ok'), 'pages': 0, 'sents': 0, 'le14': 0, 'in4_14': 0,
           'pass': 0, 'pass_oov1': 0, 'tokens': 0, 'in_pack': 0, 'aligned_pages': 0, 'twin_pages': 0}
    story_cov, excerpts = [], {'A1': 0, 'A2': 0, 'B1': 0}
    pass_per_story = []
    for r in recs:
        st = [p['text'] for p in r['text_pages']]
        tw = [p['text'] for p in r['twin']['text_pages']] if r.get('twin') else None
        tk_all = [toks(t) for t in st]
        flat = [x for t in tk_all for x in t]
        cov = sum(1 for x in flat if x in S) / max(1, len(flat))
        story_cov.append(cov)
        tot['tokens'] += len(flat); tot['in_pack'] += sum(1 for x in flat if x in S)
        ps = 0
        for i, t in enumerate(st):
            tot['pages'] += 1
            ss = sents(t)
            if tw is not None and i < len(tw):
                tot['twin_pages'] += 1
                if len(sents(tw[i])) == len(ss):
                    tot['aligned_pages'] += 1
            for s in ss:
                k = toks(s); tot['sents'] += 1
                if len(k) <= 14: tot['le14'] += 1
                if 4 <= len(k) <= 14:
                    tot['in4_14'] += 1
                    oov = sum(1 for x in k if x not in S)
                    if oov <= 1: tot['pass_oov1'] += 1
                    if oov == 0:
                        tot['pass'] += 1; ps += 1
        pass_per_story.append(ps)
        # page-run excerpts: any contiguous page run inside the level's word range and coverage rule
        for lv, (lo, hi) in RULES['words'].items():
            ok = False
            for i in range(len(tk_all)):
                run = []
                for j in range(i, len(tk_all)):
                    run += tk_all[j]
                    if len(run) > hi: break
                    if len(run) >= lo and sum(1 for x in run if x in S) / len(run) >= RULES['coverage'][lv]:
                        ok = True; break
                if ok: break
            excerpts[lv] += ok
    pct = lambda x, y: round(100 * x / y, 1) if y else None
    out = {
        'stories': n, 'with_english_twin': tot['twin_ok'], 'pages': tot['pages'], 'sentences': tot['sents'],
        'sentences_per_story': round(tot['sents'] / n, 1) if n else None,
        'share_le14_tokens_pct': pct(tot['le14'], tot['sents']),
        'sentences_4_14_pct': pct(tot['in4_14'], tot['sents']),
        'pack_token_coverage_pct': pct(tot['in_pack'], tot['tokens']),
        'story_coverage_median_pct': round(100 * sorted(story_cov)[n // 2], 1) if n else None,
        'stories_cov_ge_95': sum(1 for c in story_cov if c >= .95), 'stories_cov_ge_93': sum(1 for c in story_cov if c >= .93),
        'sentences_passing_all_tokens_in_pack': tot['pass'], 'pass_pct_of_4_14': pct(tot['pass'], tot['in4_14']),
        'sentences_4_14_with_le1_token_outside_pack': tot['pass_oov1'],
        'pass_sentences_per_story': round(tot['pass'] / n, 2) if n else None,
        'stories_with_ge1_pass_sentence': sum(1 for x in pass_per_story if x),
        'page_sentence_count_equal_pct': pct(tot['aligned_pages'], tot['twin_pages']),
        'stories_with_passage_excerpt_by_level': excerpts,
    }
    if a.population and n:
        out['extrapolated_pass_sentences'] = round(tot['pass'] / n * a.population)
        out['extrapolated_basis'] = f'{tot["pass"]}/{n} stories x {a.population}'
    print(json.dumps(out, indent=1, ensure_ascii=False))


main()
