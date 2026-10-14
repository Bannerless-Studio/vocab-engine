#!/usr/bin/env python3
"""Bloom Library fetcher: books of one language under CC licences + English twin. Public Parse API + public S3 book HTML.
Usage: python3 tools/story_fetch/bloom_fetch.py --lang ko --licences cc-by,cc-by-sa,cc0 --site ../korean [--limit N] [--resume]
API: https://server.bloomlibrary.org/parse/classes/books with the PUBLIC application id the bloomlibrary.org JS sends to every browser
(no master key, no session, no login). Text: <baseUrl><folder>.htm on s3.amazonaws.com/BloomLibraryBooks (public).
3.5 s between calls per host, 429 => 60 s back off. Cache: <site>/.cache/stories/<lang>-bloom/<objectId>.json + manifest.json + list.json."""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error
from html.parser import HTMLParser

API = 'https://server.bloomlibrary.org/parse/classes'
APP_ID = 'R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5'  # public; found in https://bloomlibrary.org/static/index-*.js
GAP = 3.5
last, calls, c429 = {}, {}, 0
KNOWN = {'cc-by': 'by', 'cc-by-sa': 'by-sa', 'cc0': 'zero'}  # API value -> family in the book's own licenseUrl
ALIAS = {'sw': ['sw', 'swh'], 'ar': ['ar', 'arb'], 'fa': ['fa', 'pes'], 'ur': ['ur'], 'ko': ['ko'], 'en': ['en']}
NOISE = ('ACL', 'harvestLog', 'search', 'keywordStems', 'phashOfFirstContentImage', 'bookHashFromImages', 'uploader', 'rebrand', 'updateSource')


def http(url, headers=None):
    global c429
    host = urllib.parse.urlparse(url).netloc
    n429 = nto = 0
    while True:
        w = last.get(host, 0) + GAP - time.time()
        if w > 0:
            time.sleep(w)
        last[host] = time.time(); calls[host] = calls.get(host, 0) + 1
        try:
            req = urllib.request.Request(url, headers=dict({'User-Agent': 'Mozilla/5.0'}, **(headers or {})))
            return urllib.request.urlopen(req, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            c429 += 1; n429 += 1; print('429, backoff 60s', flush=True)
            if n429 >= 5:
                sys.exit(3)
            time.sleep(60); last[host] = time.time()
        except (TimeoutError, urllib.error.URLError):
            nto += 1
            if nto > 2:
                raise
            print('timeout, retry', flush=True)


def parse(cls, where, limit=100, skip=0, count=False, order='createdAt'):
    q = {'where': json.dumps(where, separators=(',', ':')), 'limit': limit, 'skip': skip, 'order': order}
    if count:
        q['count'] = 1
    return json.loads(http(f'{API}/{cls}?' + urllib.parse.urlencode(q), {'X-Parse-Application-Id': APP_ID}))


def lang_where(isos):
    return {'langPointers': {'$inQuery': {'where': {'isoCode': {'$in': isos}}, 'className': 'language'}}}


# ---- minimal DOM
class Node:
    def __init__(s, tag, attrs, parent):
        s.tag, s.attrs, s.parent, s.kids = tag, dict(attrs), parent, []

    def cls(s): return (s.attrs.get('class') or '').split()

    def text(s):
        return ''.join(k if isinstance(k, str) else k.text() for k in s.kids)

    def walk(s):
        for k in s.kids:
            if isinstance(k, Node):
                yield k; yield from k.walk()


class P(HTMLParser):
    VOID = {'img', 'br', 'meta', 'link', 'input', 'hr', 'source'}

    def __init__(s):
        super().__init__(convert_charrefs=True); s.root = Node('root', [], None); s.cur = s.root

    def handle_starttag(s, tag, attrs):
        n = Node(tag, attrs, s.cur); s.cur.kids.append(n)
        if tag == 'br': s.cur.kids.append('\n')
        if tag not in s.VOID: s.cur = n

    def handle_startendtag(s, tag, attrs):
        s.cur.kids.append(Node(tag, attrs, s.cur))

    def handle_endtag(s, tag):
        n = s.cur
        while n is not s.root and n.tag != tag: n = n.parent
        if n is not s.root: s.cur = n.parent

    def handle_data(s, d): s.cur.kids.append(d)


def clean(t): return re.sub(r'[ \t\r\f\v]+', ' ', re.sub(r'\s*\n\s*', '\n', t)).strip()


def para_text(div):
    ps = [clean(p.text()) for p in div.walk() if p.tag == 'p']
    ps = [p for p in ps if p]
    return '\n'.join(ps) if ps else clean(div.text())


def parse_book_html(h):
    root = P(); root.feed(h); root = root.root
    pages, books = [], {}
    for n in root.walk():
        if n.tag == 'div' and 'bloom-page' in n.cls():
            pages.append(n)
        if n.tag == 'div' and n.attrs.get('data-book'):
            books.setdefault(n.attrs['data-book'], {}).setdefault(n.attrs.get('lang', ''), para_text(n))
    out, creators = [], []
    for pg in pages:
        num = pg.attrs.get('data-page-number', '')
        for im in pg.walk():
            if im.tag == 'img' and im.attrs.get('data-creator'):
                creators.append(im.attrs['data-creator'].strip())
        if not (num.strip() or 'numberedPage' in pg.cls()) or 'bloom-frontMatter' in pg.cls() or 'bloom-backMatter' in pg.cls():  # old books carry no data-page-number
            continue
        langs = {}
        for d in pg.walk():
            if d.tag == 'div' and 'bloom-editable' in d.cls() and d.attrs.get('lang') not in (None, '', '*', 'z') and not d.attrs.get('data-book'):
                if any('bloom-imageDescription' in a.cls() for a in _anc(d)):
                    continue
                t = para_text(d)
                if t:
                    langs.setdefault(d.attrs['lang'], []).append(t)
        out.append({'n': int(num) if num.strip().isdigit() else len(out) + 1, 'langs': {k: '\n'.join(v) for k, v in langs.items()}})
    return out, books, sorted(set(creators))


def _anc(n):
    while n.parent is not None:
        n = n.parent; yield n


def lic_from_html(books):
    u = (books.get('licenseUrl') or {}).get('*') or next(iter((books.get('licenseUrl') or {'': ''}).values()), '')
    m = re.search(r'creativecommons\.org/(licenses/([a-z\-]+)/([\d.]+)|publicdomain/zero/([\d.]+))', u or '')
    if not m: return None, None, u
    return (m.group(2) or 'zero'), (m.group(3) or m.group(4)), u


def fetch_html(b):
    base = b['baseUrl']
    key = urllib.parse.unquote_plus(base.split('BloomLibraryBooks/', 1)[1])  # baseUrl has %2f inside one path segment: decoded key = <uploader>/<instanceId>/<folder>/
    folder = key.rstrip('/').split('/')[-1]
    try:
        return http(base + urllib.parse.quote(folder) + '.htm').decode('utf-8-sig'), base + urllib.parse.quote(folder) + '.htm'
    except urllib.error.HTTPError as e:
        if e.code not in (403, 404): raise
    # fallback: public bucket listing for the .htm name
    x = http('https://s3.amazonaws.com/BloomLibraryBooks?' + urllib.parse.urlencode({'prefix': key})).decode('utf8')
    keys = [urllib.parse.unquote_plus(k) if '%' in k else k for k in re.findall(r'<Key>([^<]+)</Key>', x)]
    keys = [k for k in keys if k.endswith('.htm') and k.count('/') == key.count('/')]
    if not keys: raise RuntimeError('no htm')
    url = 'https://s3.amazonaws.com/BloomLibraryBooks/' + urllib.parse.quote(keys[0], safe='/')
    return http(url).decode('utf-8-sig'), url


def lang_pages(pages, isos):
    """pick the html language (among aliases) with most text; return (lang, [{'n','text'}])"""
    cnt = {}
    for p in pages:
        for l, t in p['langs'].items():
            if l.split('-')[0] in isos: cnt[l] = cnt.get(l, 0) + len(t)
    if not cnt: return None, []
    l = max(cnt, key=cnt.get)
    return l, [{'n': p['n'], 'text': p['langs'].get(l, '')} for p in pages]


def ne(tp): return sum(1 for p in tp if p['text'])


def credits(b, books, creators):
    g = lambda k: {l: t for l, t in (books.get(k) or {}).items() if t}
    fields = {k: g(k) for k in ('originalContributions', 'originalAcknowledgments', 'versionAcknowledgments', 'funding', 'smallCoverCredits', 'copyright', 'author', 'illustrator', 'translator') if g(k)}
    return {'copyright': b.get('copyright'), 'credits': b.get('credits'), 'original_publisher': b.get('originalPublisher'), 'publisher': b.get('publisher'),
            'illustrators': creators,  # img data-creator values; Bloom has no author/translator field of its own, they live in the free-text credits
            'authors': [x for v in g('author').values() for x in [v]], 'translators': [x for v in g('translator').values() for x in [v]], 'html_fields': fields}


def usable(b, allowed):
    """fail closed: API licence in allowed AND the book's own licenseUrl agrees; returns (ok, why)"""
    lic = b.get('license')
    if lic not in allowed or lic not in KNOWN: return False, 'licence_' + str(lic)
    if (b.get('licenseNotes') or '').strip(): return False, 'licence_notes'
    return True, ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', required=True); ap.add_argument('--licences', default='cc-by,cc-by-sa,cc0'); ap.add_argument('--site', required=True)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    allowed = [x.strip() for x in a.licences.split(',') if x.strip()]
    bad = [x for x in allowed if x not in KNOWN]
    if bad: sys.exit(f'unknown licence value(s) {bad}; known {sorted(KNOWN)}')
    isos = ALIAS.get(a.lang, [a.lang]); en = ALIAS['en']
    cd = os.path.join(a.site, '.cache/stories', a.lang + '-bloom'); os.makedirs(cd, exist_ok=True)
    lp = os.path.join(cd, 'list.json')
    if os.path.exists(lp):
        books = json.load(open(lp))
    else:
        books, skip = [], 0
        w = dict(lang_where(isos), inCirculation={'$in': [True, None]}, draft={'$ne': True})
        while True:
            d = parse('books', w, 100, skip)
            books += d['results']; skip += 100
            if len(d['results']) < 100: break
        for b in books:
            for k in NOISE: b.pop(k, None)
            b['langPointers'] = [x.get('objectId') for x in b.get('langPointers', [])]
        json.dump(books, open(lp, 'w'), ensure_ascii=False)
    lic_counts = {}
    for b in books: lic_counts[b.get('license')] = lic_counts.get(b.get('license'), 0) + 1
    ok = [b for b in books if usable(b, allowed)[0]]
    print('tag topic:Bible among licence-usable:', sum(1 for b in ok if 'topic:Bible' in (b.get('tags') or [])), flush=True)
    print(f'listed {len(books)}, licences {lic_counts}, licence-usable {len(ok)}', flush=True)
    if a.limit:
        k = min(a.limit, len(ok)); ok = [ok[i * len(ok) // k] for i in range(k)]
    mp = os.path.join(cd, 'manifest.json')
    man = json.load(open(mp)) if os.path.exists(mp) else {}
    for b in ok:
        oid = b['objectId']
        if a.resume and man.get(oid, {}).get('status') in ('ok', 'twin_null'):
            continue
        try:
            h, url = fetch_html(b)
            pages, bk, creators = parse_book_html(h)
            fam, ver, lurl = lic_from_html(bk)
            if fam != KNOWN[b['license']]:
                man[oid] = {'status': 'licence_rejected', 'api': b['license'], 'html': lurl}; json.dump(man, open(mp, 'w'), indent=1); print(oid, 'licence_rejected', lurl, flush=True); continue
            lang, tp = lang_pages(pages, isos)
            if not ne(tp):
                man[oid] = {'status': 'no_text'}; json.dump(man, open(mp, 'w'), indent=1); print(oid, 'no_text', flush=True); continue
            try: alt = json.loads(b.get('allTitles') or '{}')
            except Exception: alt = {}
            rec = {'id': oid, 'source': 'bloom', 'title': next((alt[i] for i in isos if alt.get(i)), b.get('title')), 'title_api': b.get('title'), 'all_titles': alt, 'licence': b['license'], 'licence_version': ver, 'licence_url': lurl.strip(), 'url': 'https://bloomlibrary.org/book/' + oid,
                   'html_url': url, 'lang': a.lang, 'html_lang': lang, 'book_instance_id': b.get('bookInstanceId'), 'lineage': b.get('bookLineageArray'),
                   'original_title': b.get('originalTitle'), 'level': next((t.split(':', 1)[1] for t in b.get('tags', []) if t.startswith('computedLevel:')), None),
                   'page_count_api': b.get('pageCount'), 'text_pages': tp, 'pages': len(tp), 'twin': None, 'twin_tried': []}
            rec.update(credits(b, bk, creators))
            rec['raw'] = {k: v for k, v in b.items() if k not in ('baseUrl',)}
            # twin 1: English text inside the same book
            _, ep = lang_pages(pages, en)
            if ne(ep) and ne(ep) == ne(tp):
                rec['twin'] = {'id': oid, 'same_book': True, 'title': b.get('title'), 'lang': 'English', 'pages': len(ep), 'licence': b['license'], 'text_pages': ep}
            elif ne(ep):
                rec['twin_tried'].append({'id': oid, 'same_book': True, 'rejected': [f'textpages_{ne(ep)}_vs_{ne(tp)}']})
            # twin 2: English source book / sibling by lineage
            if not rec['twin'] and b.get('bookLineageArray'):
                lin = b['bookLineageArray']
                cands = parse('books', dict(lang_where(en), bookInstanceId={'$in': lin}, inCirculation={'$in': [True, None]}), 10)['results']
                sib = parse('books', dict(lang_where(en), bookLineageArray=lin[-1], inCirculation={'$in': [True, None]}), 20)['results']
                if len(sib) < 20: cands += [x for x in sib if x['objectId'] != oid]  # >= 20 hits = shared template, not an edition
                seen = set()
                for c in cands:
                    if c['objectId'] in seen or c['objectId'] == oid: continue
                    seen.add(c['objectId'])
                    if len(rec['twin_tried']) >= 4: break
                    why = []
                    okc, w1 = usable(c, allowed)
                    if not okc: why.append(w1)
                    else:
                        ch, curl = fetch_html(c); cp, cbk, _ = parse_book_html(ch)
                        if lic_from_html(cbk)[0] != KNOWN[c['license']]: why.append('licence_html')
                        _, ctp = lang_pages(cp, en)
                        if not ne(ctp): why.append('empty')
                        elif ne(ctp) != ne(tp): why.append(f'textpages_{ne(ctp)}_vs_{ne(tp)}')
                        if not why:
                            rec['twin'] = {'id': c['objectId'], 'same_book': False, 'title': c.get('title'), 'lang': 'English', 'pages': len(ctp), 'licence': c['license'],
                                           'licence_url': lic_from_html(cbk)[2].strip(), 'html_url': curl, 'text_pages': ctp, **credits(c, cbk, parse_book_html(ch)[2])}
                    rec['twin_tried'].append({'id': c['objectId'], 'rejected': why})
                    if rec['twin']: break
            rec['twin_source'] = None if not rec['twin'] else ('same_book' if rec['twin']['same_book'] else 'lineage')
            rec['status'] = 'ok' if rec['twin'] else 'twin_null'
            json.dump(rec, open(os.path.join(cd, oid + '.json'), 'w'), ensure_ascii=False, indent=1)
            man[oid] = {'status': rec['status'], 'pages': rec['pages'], 'twin_source': rec['twin_source']}
            print(oid, rec['status'], rec['pages'], rec['twin_source'], flush=True)
        except Exception as e:
            man[oid] = {'status': 'error', 'error': str(e)[:200]}; print(oid, 'error', e, flush=True)
        json.dump(man, open(mp, 'w'), indent=1)
    print('DONE calls', calls, '429', c429, flush=True)


main()
