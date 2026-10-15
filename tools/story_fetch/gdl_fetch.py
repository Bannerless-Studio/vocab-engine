#!/usr/bin/env python3
"""Global Digital Library fetcher (digitallibrary.io): books of one language under CC BY + the English book of the same title.
Anonymous WordPress REST + EPUB endpoint on content.digitallibrary.io. No login, no gate.
Usage: python3 tools/story_fetch/gdl_fetch.py --term 1862 --code ko --site ../korean [--out ko-gdl] [--limit N] [--resume]
Catalogue: GET /wp-json/wp/v2/book?language=<termId>&per_page=100&page=N (licence in class_list `license-cc-by-4-0`).
Text: GET /wp-json/epub-generator/v1/book/<postId> -> EPUB, OEBPS/<n>.xhtml = page n (`<title>Page n</title>`, text in <p>), OEBPS/package.opf = title, publisher, contributors with marc roles.
The EPUB arrives with its last 2-4 bytes cut (end-of-central-directory record); open_epub rebuilds the record in memory.
Twin: the English book whose slug is the book's slug without the -N suffix (then -2, -3 ... of that stem), licence cc-by-4.0, equal count of non-empty pages.
Cache: <site>/.cache/stories/<out>/<postId>.json (text_pages [{n,text}], twin{...,text_pages}, same shape as gsb_fetch / asb_fetch) + manifest.json + list.json.
3.5 s between calls per host, 429 => 60 s back off (5 in a row => exit 3)."""
import argparse, html, io, json, os, re, struct, sys, time, zipfile, zlib, urllib.parse, urllib.request, urllib.error

API = 'https://content.digitallibrary.io/wp-json'
GAP = 3.5
EN_TERM = 1523
last = {}
c429 = 0
OK_LICENCES = {'license-cc-by-4-0': ('cc-by', '4.0'), 'license-cc-by-3-0': ('cc-by', '3.0'), 'license-cc-by-sa-4-0': ('cc-by-sa', '4.0'), 'license-cc0': ('cc0', None)}


def http(url):
    global c429
    host = urllib.parse.urlparse(url).netloc
    n429 = nto = 0
    while True:
        w = last.get(host, 0) + GAP - time.time()
        if w > 0:
            time.sleep(w)
        last[host] = time.time()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            return urllib.request.urlopen(req, timeout=120).read()
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


def open_epub(data):
    """The generator cuts the last 2-4 bytes of the archive, inside the end-of-central-directory record. The record's entry count and
    directory size survive, so the record is rebuilt: directory offset = start of the record - directory size, no comment."""
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        i = data.rfind(b'PK\x05\x06')
        if i < 0 or len(data) - i < 16:
            raise
        _, disk, cdisk, n1, n2, size = struct.unpack('<IHHHHI', data[i:i + 16])
        return zipfile.ZipFile(io.BytesIO(data[:i] + struct.pack('<IHHHHIIH', 0x06054b50, disk, cdisk, n1, n2, size, i - size, 0)))


TAG = re.compile(r'<[^>]+>')


def clean(s):
    s = html.unescape(TAG.sub(' ', s))
    return re.sub(r'\s+', ' ', s).strip()


def fetch_epub(book_id, lang=None, title=None):
    """The generator output is sometimes cut short; read every page file once and retry the GET (up to 3) when a member is truncated.
    The generator also returns the WRONG book for some (older English) ids (2412 'Too Many Bananas' -> a Bhojpuri reader), so when `lang` /
    `title` are given the output must match; otherwise the book's stored StoryWeaver epub (customMeta.epub of /wp/v2/book/<id>) is parsed."""
    for attempt in range(3):
        data = http(f'{API}/epub-generator/v1/book/{book_id}')
        try:
            meta, pages = parse_epub(data)
        except (zipfile.BadZipFile, KeyError, zlib.error) as e:
            print(f'epub {book_id} unreadable ({e}), retry', flush=True)
            continue
        if (lang is None or (meta['language'] or '').split('-')[0] == lang) and (title is None or norm_title(meta['title']) == norm_title(title)):
            meta['via'] = 'generator'
            return meta, pages
        break
    rec = get_json(f'{API}/wp/v2/book/{book_id}?_fields=id,customMeta')
    path = (rec.get('customMeta') or {}).get('epub')
    if not path:
        raise RuntimeError(f'epub {book_id}: generator returned another book and no stored epub')
    meta, pages = parse_stored_epub(http('https://content.digitallibrary.io' + path))
    if (lang is not None and (meta['language'] or '').split('-')[0] != lang) or (title is not None and norm_title(meta['title']) != norm_title(title)):
        raise RuntimeError(f'epub {book_id}: stored epub is {meta["language"]} {meta["title"]!r}')
    meta['via'] = 'stored'
    return meta, pages


def parse_stored_epub(data):
    z = open_epub(data)
    opf = z.read('content/book.opf').decode('utf-8')
    g1 = lambda tag: html.unescape((re.search(rf'<dc:{tag}[^>]*>(.*?)</dc:{tag}>', opf, re.S) or [0, ''])[1]).strip()
    meta = {'language': g1('language') or None, 'title': g1('title'), 'publisher': g1('publisher'), 'rights': g1('rights') or None, 'roles': {}}
    for m in re.finditer(r'<dc:(?:creator|contributor) id="(\w+)">(.*?)</dc:(?:creator|contributor)>\s*<meta refines="#\1" property="role"[^>]*>(.*?)</meta>', opf, re.S):
        meta['roles'].setdefault({'aut': 'Author', 'ill': 'Illustrator', 'trl': 'Translator'}.get(m.group(3).strip(), m.group(3).strip()), []).append(html.unescape(m.group(2)).strip())
    pages = {}
    for n in z.namelist():
        m = re.fullmatch(r'content/chapter-(\d+)\.xhtml', n)
        if m:
            body = z.read(n).decode('utf-8')
            body = body[body.find('<body'):]
            pages[int(m.group(1))] = [p for p in (clean(x) for x in re.findall(r'<p[^>]*>(.*?)</p>', body, re.S)) if p]
    return meta, pages


def parse_epub(data):
    z = open_epub(data)
    opf = z.read('OEBPS/package.opf').decode('utf-8')
    meta = {'language': (re.search(r'<dc:language>(.*?)</dc:language>', opf) or [0, None])[1],
            'title': html.unescape((re.search(r'<dc:title>(.*?)</dc:title>', opf, re.S) or [0, ''])[1]).strip(),
            'publisher': html.unescape((re.search(r'<dc:publisher>(.*?)</dc:publisher>', opf, re.S) or [0, ''])[1]).strip()}
    roles = {}
    for m in re.finditer(r'<dc:contributor id="(\w+)">(.*?)</dc:contributor>\s*<meta refines="#\1" property="role"[^>]*>(.*?)</meta>', opf, re.S):
        roles.setdefault(m.group(3).strip(), []).append(html.unescape(m.group(2)).strip())
    meta['roles'] = roles
    rights = re.search(r'<dc:rights>(.*?)</dc:rights>', opf, re.S)
    meta['rights'] = html.unescape(rights.group(1)).strip() if rights else None
    pages = {}
    for n in z.namelist():
        m = re.fullmatch(r'OEBPS/(\d+)\.xhtml', n)
        if not m:
            continue
        body = z.read(n).decode('utf-8')
        body = body[body.find('<body'):]
        ps = [clean(p) for p in re.findall(r'<p[^>]*>(.*?)</p>', body, re.S)]
        pages[int(m.group(1))] = [p for p in ps if p]
    return meta, pages


SW_BOILER = ('This book was made possible by', 'Pratham Books goes digital')


def is_credit(ps):
    return bool(ps) and (ps[0].startswith('Brought to you by') or any('letsreadasia.org' in p for p in ps)
                         or ps[0].startswith('This book was made possible by'))


def is_boiler(n, ps):
    """Let's Read closing credit; StoryWeaver credit pages (two), the 'title (Language) synopsis' about page with the Pratham boilerplate, and the cover page 1 ('title Author: .. Illustrator: ..')."""
    if is_credit(ps) or any(p.startswith('Pratham Books goes digital') or re.match(r'This is a Level \d', p) for p in ps):
        return True
    return n == 1 and any(re.search(r'\bAuthor:|\bIllustrator:|\bTranslator:', p) for p in ps)


def text_pages(pages):
    """Page n -> one text block (paragraphs joined by newline); drops pages with no text, cover/credit/about boilerplate."""
    out = []
    for n in sorted(pages):
        ps = pages[n]
        if not ps or is_boiler(n, ps):
            continue
        out.append({'n': n, 'text': '\n'.join(ps)})
    return out


def credit_text(pages):
    """The credit page: Let's Read ("Brought to you by ... Released under CC-BY-4.0") or StoryWeaver ("This book was made possible by ... Story Attribution ... Released under CC BY 4.0 license"). All credit pages joined."""
    got = [' '.join(pages[n]) for n in sorted(pages) if is_credit(pages[n])]
    return ' '.join(got) if got else None


LIC = re.compile(r'\bCC[ \-]?(0|BY(?:[ \-](?:SA|NC|ND))*)(?:[ \-]?(\d\.\d))?', re.I)
ALLOWED = {('BY', '4.0'), ('BY-SA', '4.0'), ('0', None), ('0', '1.0')}


def book_licence(credit, allowed=ALLOWED):
    """Licence the book states on its own credit page, fail closed. Every licence mention (soft hyphens removed) must be allowed:
    CC BY 4.0, CC BY-SA 4.0 or CC0. GDL's class_list disagrees with the book's credit page for some mirrors, so metadata alone is not trusted;
    no statement is unconfirmed, not BY."""
    c = (credit or '').replace('\xad', '')
    c = re.sub(r'creativecommons\.org/licenses/[\w\-/.]+|creativecommons\.org/publicdomain/[\w\-/.]+', ' ', c)
    found = [(re.sub(r'[ ]+', '-', m.group(1).upper()), m.group(2)) for m in LIC.finditer(c)
             if re.search(r'Released under|licensed|license', c[m.start() - 40:m.end() + 40], re.I)]
    if not found:
        return None, 'no licence statement in the book'
    bad = [f for f in found if f not in allowed]
    if bad:
        return None, 'book states ' + ', '.join(sorted({'CC-%s-%s' % (a, b) if b else 'CC-' + a for a, b in bad}))
    return 'CC-%s-%s' % found[0] if found[0][1] else 'CC0', None


SCRIPTURE = re.compile(r'\b(bible|biblical|gospel|scripture|jesus|christ|nativity|psalm|testament|genesis|exodus|wycliffe|godly|prophet|sermon)\b|बाइबिल|यीशु|ईसा मसीह|पवित्र शास्त्र|भजन संहिता', re.I)


def is_scripture(rec):
    pub = (rec.get('publisher') or '')
    blob = ' '.join([rec.get('title') or '', rec.get('epub_title') or '', pub, rec.get('credit_text') or ''])
    return bool(re.search(r'bible|wycliffe|scripture|gideons|\bsil\b|faith comes|christian|missions|ministr', pub, re.I)) or bool(SCRIPTURE.search(' '.join([rec.get('title') or '', rec.get('epub_title') or '']))) \
        or bool(re.search(r'\b(bible|nativity|jesus)\b', blob, re.I))


def norm_title(t):
    t = html.unescape(t or '').replace('\xad', '').lower()
    return re.sub(r'[^a-z0-9\u0900-\u097f]+', '', t)


def original_title(credit):
    """StoryWeaver: "Based on Original story: ' How Do Aeroplanes Fly? ' , by X" (translations); None for originals."""
    m = re.search(r"Based on Original story:\s*['\u2018\u2019]?\s*(.*?)\s*['\u2018\u2019]?\s*,\s*by\b", (credit or '').replace('\xad', ''), re.S)
    return m.group(1).strip() if m else None


def get_json(url):
    return json.loads(http(url).decode('utf-8'))


def save(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def licence_class(item):
    for c in item.get('class_list', []):
        if c in OK_LICENCES:
            return c
    return None


def list_books(term, cache=None):
    if cache and os.path.exists(cache):
        return json.load(open(cache))
    books, pg = [], 1
    while True:
        try:
            part = get_json(f'{API}/wp/v2/book?language={term}&per_page=100&page={pg}&_fields=id,slug,link,title,class_list,language')
        except urllib.error.HTTPError as e:
            if e.code == 400:
                break
            raise
        books += part
        if len(part) < 100:
            break
        pg += 1
    if cache:
        save(cache, books)
    return books


def twin_candidates(b, rec, a, en_by_title):
    """slug mode: the book's slug stem (ko). title mode: StoryWeaver original title from the credit page, else the book's own epub title,
    matched on normalised title against the GDL English list."""
    if a.twin == 'slug':
        stem = re.sub(r'-\d+$', '', b['slug'])
        out = []
        for slug in [stem] + [f'{stem}-{i}' for i in (2, 3)]:
            out += [c for c in get_json(f'{API}/wp/v2/book?slug={slug}&_fields=id,slug,link,title,class_list,language') if EN_TERM in c.get('language', [])][:1]
        return out, None
    names = [x for x in (original_title(rec.get('credit_text')), rec.get('epub_title'), rec.get('title')) if x]
    for nm in names:
        c = en_by_title.get(norm_title(nm))
        if c:
            return c, nm
    return [], names[0] if names else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--term', type=int, required=True, help='GDL language term id (ko 1862, hi 1719)')
    ap.add_argument('--code', required=True)
    ap.add_argument('--site', required=True)
    ap.add_argument('--out')
    ap.add_argument('--limit', type=int)
    ap.add_argument('--resume', action='store_true')
    ap.add_argument('--twin', choices=['slug', 'title'], default='slug')
    ap.add_argument('--max-twins', type=int, default=4)
    a = ap.parse_args()
    d = os.path.join(a.site, '.cache', 'stories', a.out or f'{a.code}-gdl')
    os.makedirs(d, exist_ok=True)
    mf_path = os.path.join(d, 'manifest.json')
    mf = json.load(open(mf_path)) if a.resume and os.path.exists(mf_path) else {}
    books = list_books(a.term)
    save(os.path.join(d, 'list.json'), books)
    print(f'{len(books)} books listed', flush=True)
    en_by_title = {}
    if a.twin == 'title':
        for c in list_books(EN_TERM, os.path.join(d, 'list-en.json')):
            en_by_title.setdefault(norm_title(html.unescape(c['title']['rendered'])), []).append(c)
        print(f'{sum(len(v) for v in en_by_title.values())} English books listed', flush=True)
    if a.limit:
        books = books[:a.limit]

    def done(bid, rec, why=None):
        if why:
            rec['why'] = why
        save(os.path.join(d, f'{bid}.json'), rec)
        mf[bid] = {'status': rec['status'], 'why': rec.get('why'), 'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%S')}
        save(mf_path, mf)
        print(bid, rec['slug'][:30], rec['status'], rec.get('pages'), rec.get('why') or '', flush=True)

    for b in books:
        bid = str(b['id'])
        if mf.get(bid, {}).get('status') in ('ok', 'licence_rejected', 'twin_null', 'scripture', 'no_text'):
            continue
        lc = licence_class(b)
        rec = {'id': bid, 'source': 'gdl', 'lang': a.code, 'slug': b['slug'], 'title': html.unescape(b['title']['rendered']).strip(), 'url': b['link'],
               'licence_class': [c for c in b['class_list'] if c.startswith('license-')],
               'level': next((c.split('-')[-1] for c in b['class_list'] if c.startswith('topic-level-')), None)}
        if not lc:
            rec['status'] = 'licence_rejected'
            done(bid, rec, 'GDL licence tag ' + ','.join(rec['licence_class']))
            continue
        meta, pages = fetch_epub(bid, a.code if a.twin == 'title' else None)
        rec.update(publisher=meta['publisher'], roles=meta['roles'], rights=meta['rights'], epub_title=meta['title'], epub_language=meta['language'],
                   authors=meta['roles'].get('Author', []), illustrators=meta['roles'].get('Illustrator', []), translators=meta['roles'].get('Translator', []))
        tps = text_pages(pages)
        rec['text_pages'], rec['pages'], rec['credit_text'] = tps, len(tps), credit_text(pages)
        rec['source_name'] = 'Global Digital Library / StoryWeaver (Pratham Books)' if 'storyweaver' in (rec['credit_text'] or '').lower() else 'Global Digital Library'
        stated, why = book_licence(rec['credit_text'])
        if why:
            rec['status'] = 'licence_rejected'
            done(bid, rec, why)
            continue
        rec['licence_read'] = stated
        if is_scripture(rec):
            rec['status'] = 'scripture'
            done(bid, rec, 'scripture/religious publisher or title')
            continue
        if not tps:
            rec['status'] = 'no_text'
            done(bid, rec)
            continue
        cands, via = twin_candidates(b, rec, a, en_by_title)
        rec['twin_via'] = via
        tried, twin = [], None
        for c in cands[:a.max_twins]:
            t = {'id': str(c['id']), 'slug': c['slug'], 'title': html.unescape(c['title']['rendered']).strip(), 'url': c['link'], 'lang': 'English'}
            lq = licence_class(c)
            if not lq:
                t['rejected'] = 'licence tag'; tried.append(t); continue
            m2, p2 = fetch_epub(c['id'], 'en' if a.twin == 'title' else None, html.unescape(c['title']['rendered']) if a.twin == 'title' else None)
            t2 = text_pages(p2)
            cr2 = credit_text(p2)
            _, why2 = book_licence(cr2)
            if why2:
                t['rejected'] = 'licence: ' + why2; tried.append(t); continue
            if len(t2) != len(tps):
                t['rejected'] = f'textpages_{len(tps)}_vs_{len(t2)}'; tried.append(t); continue
            t['licence'], t['licence_version'] = OK_LICENCES[lq]
            t.update(pages=len(t2), publisher=m2['publisher'], roles=m2['roles'], authors=m2['roles'].get('Author', []),
                     illustrators=m2['roles'].get('Illustrator', []), translators=m2['roles'].get('Translator', []), text_pages=t2, credit_text=cr2)
            twin = t
            break
        rec['twin'], rec['twin_tried'] = twin, tried
        rec['status'] = 'ok' if twin else 'twin_null'
        done(bid, rec, None if twin else ('no English title match' if not cands else 'tried: ' + '; '.join(x.get('rejected', '') for x in tried)))
    from collections import Counter
    c = Counter(v['status'] for v in mf.values())
    save(os.path.join(d, 'run-stats.json'), {'statuses': dict(c), '429': c429})
    print('done', dict(c), flush=True)


if __name__ == '__main__':
    main()
