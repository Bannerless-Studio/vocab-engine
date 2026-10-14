#!/usr/bin/env python3
"""African Storybook fetcher: CC BY 4.0 books of one language + English twin. Anonymous public pages, no login, no maker/admin endpoints.
Usage: python3 tools/story_fetch/asb_fetch.py --lang sw --site ../swahili [--limit N] [--resume]   (sw=Kiswahili 1079, ar=Arabic 8737, en=English 1133)
Calls: GET /booklistjs.php (one 5.7 MB JS list of every book: id,title,summary,author,people,lang id,level,approved), POST /menubook.6.php (the reader's
'Translations and adaptations' list: title + language + Original/Translation), GET /newviewer/index.php?id=<id> (reader HTML: cover credits, page text, back
cover with licence line). 3.5 s between calls, 429 => 60 s back off. Cache: <site>/.cache/stories/<lang>-asb/<id>.json + manifest.json + list.json."""
import argparse, html, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request, urllib.error

BASE = 'https://www.africanstorybook.org'
LANGS = {'sw': ('1079', 'Kiswahili'), 'ar': ('8737', 'Arabic'), 'en': ('1133', 'English'), 'ur': ('16643', 'Urdu')}
GAP = 3.5
last, calls, c429 = 0.0, 0, 0
LIC_OK = {'Attribution 4.0': ('cc-by', '4.0')}  # fail closed: exact string of the back-cover line only


def http(path, data=None):
    global last, calls, c429
    n429 = nto = 0
    while True:
        w = last + GAP - time.time()
        if w > 0:
            time.sleep(w)
        last = time.time(); calls += 1
        try:
            req = urllib.request.Request(BASE + path, data=urllib.parse.urlencode(data).encode() if data else None, headers={'User-Agent': 'Mozilla/5.0'})
            return urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            c429 += 1; n429 += 1; print('429, backoff 60s', flush=True)
            if n429 >= 5:
                sys.exit(3)
            time.sleep(60); last = time.time()
        except (TimeoutError, urllib.error.URLError):
            nto += 1
            if nto > 2:
                raise
            print('timeout, retry', flush=True)


def loose(t): return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', norm(t)).casefold())


def norm(t): return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', html.unescape(t or ''))).strip()


def untag(s):
    return '\n'.join(x for x in (norm(l) for l in re.sub(r'<[^>]+>', '', re.sub(r'<br\s*/?>', '\n', s)).split('\n')) if x)


def parse_list(js):
    """every bookItems.push({...}) record; values are JS string literals (\\' and \\" escapes) with HTML entities"""
    out = []
    for m in re.finditer(r'bookItems\.push\(\{(.*?)\}\);', js):
        it = {k: re.sub(r'\\(.)', r'\1', v) for k, v in re.findall(r'(\w+):"((?:[^"\\]|\\.)*)"', m.group(1))}
        it['title'] = norm(it.get('title')); it['summary'] = norm(it.get('summary'))
        out.append(it)
    return out


def parse_viewer(h):
    s = h[h.find('<div class="flipbook"'):]
    s = s[:s.find('id="previous-page"')] if 'id="previous-page"' in s else s
    parts = re.split(r'<div class="page">', s)[1:]
    cover = untag(re.search(r'<div class="cover-title[^"]*">(.*?)</div>', parts[0], re.S).group(1)) if parts and 'cover-title' in parts[0] else None
    ca = re.search(r'<div class="cover-author">(.*?)</div>', parts[0], re.S) if parts else None
    cr = re.search(r'<div class="cover-artist">(.*?)</div>', parts[0], re.S) if parts else None
    pages, back = [], ''
    for p in parts[1:]:
        if 'backcover_disclaimer' in p:
            back = p; continue
        pn = re.search(r'<div class="page-number">(\d+)</div>', p)
        if not pn:
            continue
        txt = '\n'.join(untag(x) for x in re.findall(r'<p class="[^"]*text[^"]*">(.*?)</p>', p, re.S))
        pages.append({'n': int(pn.group(1)), 'text': txt})
    roles = {}
    ba = re.search(r'<div class="bookcover_author">(.*?)</div>', back, re.S)
    if ba:
        for chunk in re.split(r'<br\s*/?>', ba.group(1)):
            m = re.match(r'\s*<span class="backcover_bold">(.*?)\s*-\s*</span>(.*)', chunk, re.S)
            if m: roles.setdefault(norm(m.group(1)), []).append(norm(re.sub('<[^>]+>', '', m.group(2))))
    bc = re.search(r'<div class="backcover_copyright">(.*?)</div>', back, re.S)
    cp = untag(bc.group(1)) if bc else ''
    lm = re.search(r'Creative Commons:\s*(.+)', cp)
    return {'title': cover, 'cover_author': norm(ca.group(1)) if ca else None, 'cover_artist': norm(cr.group(1)) if cr else None, 'pages': pages,
            'roles': roles, 'copyright_block': cp, 'licence_line': norm(lm.group(1)) if lm else None,
            'language': untag(re.search(r'<div id="lang"[^>]*>(.*?)</div>', parts[0], re.S).group(1)) if parts and re.search(r'<div id="lang"', parts[0]) else None}


def related(mh):
    out = []
    for m in re.finditer(r'<li class="item-content"><a[^>]*onclick="loadRelatedBook\((\d*),[^)]*\)">.*?<div class="item-title[^>]*>(.*?)<br><span[^>]*>(.*?)</span>', mh, re.S):
        role = re.match(r'(.*?)\s*\((\w+)\)\s*$', norm(m.group(3)))
        out.append({'id': m.group(1) or None, 'title': norm(re.sub('<[^>]+>', '', m.group(2))), 'lang': role.group(1) if role else norm(m.group(3)), 'kind': role.group(2) if role else None})
    return out


def ne(tp): return sum(1 for p in tp if p['text'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', required=True, choices=sorted(LANGS)); ap.add_argument('--site', required=True)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    lid, lname = LANGS[a.lang]
    cd = os.path.join(a.site, '.cache/stories', a.lang + '-asb'); os.makedirs(cd, exist_ok=True)
    lp, ep = os.path.join(cd, 'list.json'), os.path.join(cd, 'list-en.json')
    if os.path.exists(lp) and os.path.exists(ep):
        books, en = json.load(open(lp)), json.load(open(ep))
    else:
        allb = parse_list(http('/booklistjs.php'))
        books = [x for x in allb if x.get('lang') == lid]
        en = [{'id': x['id'], 'title': x['title'], 'level': x.get('level')} for x in allb if x.get('lang') == LANGS['en'][0]]
        json.dump(books, open(lp, 'w'), ensure_ascii=False); json.dump(en, open(ep, 'w'), ensure_ascii=False)
    print(f'listed {len(books)} {lname} books ({len(en)} English); licence is only on each book\'s back cover, read per fetched book', flush=True)
    by_title = {}
    for e in en: by_title.setdefault(loose(e['title']), []).append(e)
    sel = books
    if a.limit:
        k = min(a.limit, len(sel)); sel = [sel[i * len(sel) // k] for i in range(k)]
    mp = os.path.join(cd, 'manifest.json')
    man = json.load(open(mp)) if os.path.exists(mp) else {}
    for b in sel:
        bid = b['id']
        if a.resume and man.get(bid, {}).get('status') in ('ok', 'twin_null'):
            continue
        try:
            v = parse_viewer(http(f'/newviewer/index.php?id={bid}'))
            lic = LIC_OK.get(v['licence_line'] or '')
            if not lic or not ne(v['pages']):
                st = 'licence_rejected' if not lic else 'no_text'
                man[bid] = {'status': st, 'licence_line': v['licence_line'], 'copyright': v['copyright_block'][:120]}; print(bid, st, v['licence_line'], flush=True)
                json.dump(man, open(mp, 'w'), indent=1); continue
            rec = {'id': bid, 'source': 'asb', 'title': v['title'] or b['title'], 'lang': a.lang, 'lang_name': lname, 'licence': lic[0], 'licence_version': lic[1], 'licence_line': v['licence_line'],
                   'url': f'{BASE}/newviewer/index.php?id={bid}', 'level': b.get('level'), 'approved': b.get('approved'),
                   'authors': v['roles'].get('Author', []), 'translators': v['roles'].get('Translation', []), 'illustrators': v['roles'].get('Illustration', []),
                   'adapters': v['roles'].get('Adaptation', []), 'publisher': v['copyright_block'].split('\n')[0], 'roles': v['roles'], 'copyright_block': v['copyright_block'],
                   'text_pages': v['pages'], 'pages': len(v['pages']), 'twin': None, 'twin_tried': []}
            rel = related(http('/menubook.6.php', {'id': bid, 'bt': '1'}))
            rec['related'] = rel
            cands = []  # English original first, then English translations; ids when the menu gives them, else title lookup in the English list
            for r in sorted((r for r in rel if r['lang'] == 'English' and r['kind'] in ('Original', 'Translation')), key=lambda r: r['kind'] != 'Original'):
                for e in ([{'id': r['id'], 'level': None}] if r['id'] else by_title.get(loose(r['title']), [])):
                    cands.append((e['id'], r, e.get('level')))
            cands.sort(key=lambda c: c[2] != b.get('level'))  # same reading level first: other levels of one title are re-written texts
            for cid, r, clev in cands[:6]:  # Adaptations are never twins (text differs by design)
                t = parse_viewer(http(f'/newviewer/index.php?id={cid}'))
                why = []
                if clev is not None and clev != b.get('level'): why.append(f'level_{clev}_vs_{b.get("level")}')
                if LIC_OK.get(t['licence_line'] or '') is None: why.append('licence_' + str(t['licence_line']))
                if not ne(t['pages']): why.append('empty')
                elif ne(t['pages']) != ne(v['pages']): why.append(f'textpages_{ne(t["pages"])}_vs_{ne(v["pages"])}')
                rec['twin_tried'].append({'id': cid, 'kind': r['kind'], 'level': clev, 'rejected': why})
                if not why:
                    rec['twin'] = {'id': cid, 'title': t['title'], 'lang': 'English', 'kind': r['kind'], 'pages': len(t['pages']), 'licence': 'cc-by', 'licence_line': t['licence_line'],
                                   'level': clev, 'url': f'{BASE}/newviewer/index.php?id={cid}', 'authors': t['roles'].get('Author', []), 'illustrators': t['roles'].get('Illustration', []),
                                   'translators': t['roles'].get('Translation', []), 'roles': t['roles'], 'copyright_block': t['copyright_block'], 'text_pages': t['pages']}
                    break
            rec['status'] = 'ok' if rec['twin'] else 'twin_null'
            rec['raw'] = {'list_item': b}
            json.dump(rec, open(os.path.join(cd, bid + '.json'), 'w'), ensure_ascii=False, indent=1)
            man[bid] = {'status': rec['status'], 'pages': rec['pages'], 'twin_kind': rec['twin']['kind'] if rec['twin'] else None}
            print(bid, rec['status'], rec['pages'], man[bid]['twin_kind'], flush=True)
        except Exception as e:
            man[bid] = {'status': 'error', 'error': str(e)[:200]}; print(bid, 'error', e, flush=True)
        json.dump(man, open(mp, 'w'), indent=1)
    print('DONE calls', calls, '429', c429, flush=True)


main()
