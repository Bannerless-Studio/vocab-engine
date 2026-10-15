#!/usr/bin/env python3
"""Let's Read Asia fetcher: CC-BY-4.0 books of one language + English master twin, anonymous public JSON API.
Usage: python3 tools/story_fetch/lra_fetch.py --lid <langId> --code ur --site ../urdu [--limit N] [--resume]
Urdu langId 5732871486570496, English 4846240843956224. 3.5 s between calls, 429 => 60 s back off. No login.
Cache: <site>/.cache/stories/<code>-lra/<bookId>.json + manifest.json + list.json (same page schema as fetch.js)."""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error

API = 'https://letsreadasia.org/api'
# the site sends the literal "undefined" as the language path part; the book id decides
GAP = 3.5
last = 0.0
calls = 0
c429 = 0


def get(path):
    global last, calls, c429
    n429 = 0
    while True:
        w = last + GAP - time.time()
        if w > 0:
            time.sleep(w)
        last = time.time()
        calls += 1
        try:
            req = urllib.request.Request(API + path, headers={'User-Agent': 'Mozilla/5.0'})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                c429 += 1; n429 += 1
                print('429, backoff 60s', flush=True)
                if n429 >= 5:
                    sys.exit(3)
                time.sleep(60); last = time.time(); continue
            raise


def pages(d):
    out, seen = [], set()
    for p in sorted(d.get('pages') or [], key=lambda p: p.get('pageNum', 0)):
        if p.get('pageNum') in seen:  # the API repeats each page record (3x observed); keep the first
            continue
        seen.add(p.get('pageNum'))
        out.append({'n': p.get('pageNum'), 'text': (p.get('extractedLongContentValue') or '').strip()})
    return out


def roles(d):
    cb = d.get('collaboratorsByRole') or {}
    return {k: [x.get('name') or x.get('displayName') or str(x) for x in v] for k, v in cb.items() if v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lid', required=True); ap.add_argument('--code', required=True); ap.add_argument('--site', required=True)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--resume', action='store_true')
    ap.add_argument('--recover-offcount', action='store_true', help='re-fetch the English twin of twin_null books whose only reject is a text page count off by 1-2; stored with status ok_off and twin.page_diff (the aligner must vouch for the pairs)')
    a = ap.parse_args()
    cd = os.path.join(a.site, '.cache/stories', a.code + '-lra'); os.makedirs(cd, exist_ok=True)
    if a.recover_offcount:
        return recover(cd)
    lp = os.path.join(cd, 'list.json')
    if os.path.exists(lp):
        books = json.load(open(lp))
    else:
        books = {}; cur = ''
        while True:
            d = get(f'/v5/book/search?cardName=&limit=100&fLimit=100&lId={a.lid}&cursor={urllib.parse.quote(cur)}')
            for b in (d.get('other') or []):
                books[b['id']] = b
            cur = d.get('cursorWebSafeString') or ''
            if not cur or not d.get('other'):
                break
        books = list(books.values()); json.dump(books, open(lp, 'w'), ensure_ascii=False)
    ok = [b for b in books if b.get('license') == 'CC-BY-4.0']  # fail closed: exact value only
    print(f'listed {len(books)}, CC-BY-4.0 {len(ok)}', flush=True)
    if a.limit:
        k = min(a.limit, len(ok)); ok = [ok[i * len(ok) // k] for i in range(k)]
    mp = os.path.join(cd, 'manifest.json')
    man = json.load(open(mp)) if os.path.exists(mp) else {}
    for b in ok:
        bid = b['id']
        if a.resume and man.get(bid, {}).get('status') in ('ok', 'twin_null'):
            continue
        try:
            d = get(f'/v5/book/preview/language/undefined/book/{bid}')
            if d.get('license') != 'CC-BY-4.0':
                man[bid] = {'status': 'licence_rejected', 'licence': d.get('license')}; continue
            mm = d.get('masterBookMetaData') or {}
            rec = {'id': bid, 'source': 'lra', 'title': d['name'], 'level': d.get('readingLevel'), 'licence': 'CC-BY-4.0',
                   'url': f'https://www.letsreadasia.org/book/{bid}', 'lang_id': a.lid, 'roles': roles(d), 'publisher': d.get('publisher'),
                   'original_url': d.get('originalUrl'), 'master_book_id': d.get('masterBookId'), 'origin_lang': mm.get('languageName'),
                   'master_title': mm.get('title'), 'master_licence': mm.get('license'), 'master_roles': mm.get('collaboratorsByRole'),
                   'country_of_origin': d.get('countryOfOrigin'), 'text_pages': pages(d), 'twin': None,
                   'raw': {k: v for k, v in d.items() if k not in ('pages', 'availableLanguages', 'availableAudioLanguages', 'nonMasterMetaDatas', 'tags')}}
            rec['pages'] = len(rec['text_pages'])
            mid = d.get('masterBookId') if (mm.get('languageName') == 'English' and d.get('masterBookId') != bid) else None
            if not mid:  # master is another language (Khmer/Lao originals): use the English sibling if the book lists one
                mid = next((x['id'] for x in d.get('nonMasterMetaDatas') or [] if str(x.get('languageId')) == '4846240843956224'), None)
            rec['twin_source'] = 'master' if mid and mid == d.get('masterBookId') else ('sibling' if mid else None)
            if mid:
                t = get(f'/v5/book/preview/language/undefined/book/{mid}')
                tp = pages(t)
                why = []
                if not any(p['text'] for p in tp): why.append('empty')
                ne = lambda x: sum(1 for p in x if p['text'])  # cover / credit pages carry no text and differ by one
                if ne(tp) != ne(rec['text_pages']): why.append(f'textpages_{ne(tp)}_vs_{ne(rec["text_pages"])}')
                if t.get('license') != 'CC-BY-4.0': why.append('licence_' + str(t.get('license')))
                rec['twin_tried'] = [{'id': mid, 'rejected': why}]
                if not why:
                    rec['twin'] = {'id': mid, 'title': t.get('name'), 'lang': 'English', 'pages': len(tp), 'licence': 'CC-BY-4.0',
                                   'roles': roles(t), 'text_pages': tp}
            rec['status'] = 'ok' if rec['twin'] else 'twin_null'
            json.dump(rec, open(os.path.join(cd, bid + '.json'), 'w'), ensure_ascii=False, indent=1)
            man[bid] = {'status': rec['status'], 'pages': rec['pages']}
            print(bid[:8], rec['status'], rec['pages'], flush=True)
        except Exception as e:
            man[bid] = {'status': 'error', 'error': str(e)[:200]}; print(bid[:8], 'error', e, flush=True)
        json.dump(man, open(mp, 'w'), indent=1)
    print('DONE calls', calls, '429', c429, flush=True)


def recover(cd):
    n = 0
    for fn in sorted(os.listdir(cd)):
        if not re.fullmatch(r'[0-9a-f-]{36}\.json', fn):
            continue
        rec = json.load(open(os.path.join(cd, fn)))
        tried = rec.get('twin_tried') or [{}]
        why = tried[0].get('rejected') or []
        m = re.fullmatch(r'textpages_(\d+)_vs_(\d+)', why[0]) if len(why) == 1 else None
        if rec.get('status') != 'twin_null' or not m or not (1 <= abs(int(m[1]) - int(m[2])) <= 2):
            continue
        t = get('/v5/book/preview/language/undefined/book/' + tried[0]['id'])
        if t.get('license') != 'CC-BY-4.0':
            continue
        tp = pages(t)
        rec['twin'] = {'id': tried[0]['id'], 'title': t.get('name'), 'lang': 'English', 'pages': len(tp), 'licence': 'CC-BY-4.0',
                       'roles': roles(t), 'text_pages': tp, 'page_diff': int(m[1]) - int(m[2])}
        rec['status'] = 'ok_off'
        json.dump(rec, open(os.path.join(cd, fn), 'w'), ensure_ascii=False, indent=1)
        n += 1
        print(fn[:8], 'ok_off', rec['twin']['page_diff'], flush=True)
    print('RECOVERED', n, 'calls', calls, '429', c429, flush=True)


if __name__ == '__main__':
    main()
