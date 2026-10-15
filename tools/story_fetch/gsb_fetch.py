#!/usr/bin/env python3
"""Global Storybooks family fetcher (global-asp.github.io/storybooks-<x>/): one language's stories + the English text of the same page.
Static Jekyll sites, plain HTTP, no session, no login. Every story is an African Storybook story with a per-story Creative Commons licence.
Usage: python3 tools/story_fetch/gsb_fetch.py --site-slug storybooks-korea --lang ko --site ../korean [--code ko] [--out ko-gsb] [--limit N] [--resume]
Per story two GETs: /stories/<lang>/<id>/ (target text in .l1, licence, credits incl. translator, source link) and
/stories/en/<id>/ (English text in .def, target text again in .l1). The English page's l1 must equal the target page's l1 (fail closed).
Licence rule: link rel=license on both pages must be creativecommons.org/licenses/by/<3.0|4.0>/ exactly (BY-NC, -SA, -ND rejected).
Cache: <site>/.cache/stories/<out>/<id>.json (same shape as asb_fetch: text_pages [{n,text}], twin {..., text_pages}) + manifest.json + list.json.
3.5 s between calls per host, 429 => 60 s back off (5 in a row => exit 3)."""
import argparse, html, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error

GAP = 3.5
BASE = 'https://global-asp.github.io'
last = {}
c429 = 0


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
            return urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
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


TAG = re.compile(r'<[^>]+>')


def clean(s):
    s = html.unescape(TAG.sub(' ', re.sub(r'<br\s*/?>', '\n', s)))
    return '\n'.join(re.sub(r'[ \t ]+', ' ', ln).strip() for ln in s.split('\n') if ln.strip())


def flat(s):
    """Page text on one line: the pages keep the source layout's hard line breaks inside sentences (65 of the 258 Korean-site English pages), which are not verse."""
    return ' '.join(clean(s).split('\n'))


def parse_page(h):
    """-> dict(title_l1, title_def, pages{n:{l1,def}}, credits{role:[names]}, level, source{url,title}, licence_url)."""
    out = {'pages': {}}
    m = re.search(r'<h1>\s*<span class="def">(.*?)</span>\s*<span class="l1">(.*?)</span>', h, re.S)
    out['title_def'], out['title_l1'] = (clean(m.group(1)), clean(m.group(2))) if m else (None, None)
    for m in re.finditer(r'<div id="text(\d+)" class="columns">(.*?)(?=<div id="(?:text\d+|colophon)")', h, re.S):
        n, body = int(m.group(1)), m.group(2)
        d = re.search(r'class="[^"]*\bdef"[^>]*>(.*?)</div>', body, re.S)
        l = re.search(r'class="[^"]*\bl1"[^>]*>(.*?)</div>', body, re.S)
        if n >= 2 and d and l:
            out['pages'][n] = {'def': flat(d.group(1)), 'l1': flat(l.group(1))}
    col = h[h.find('id="colophon"'):]
    cred = {}
    for m in re.finditer(r'<span class="colophon-heading">([^<]*?):?</span>\s*(.*?)</h5>', col, re.S):
        role, val = m.group(1).strip().rstrip(':'), clean(m.group(2))
        if role in ('Written by', 'Illustrated by', 'Translated by', 'Read by', 'Adapted by'):
            cred[role] = [x.strip() for x in re.split(r'\s*(?:,|&|\band\b)\s*', val) if x.strip()]
    out['credits'] = cred
    lv = re.search(r'colophon-heading">Level:</span>\s*<a[^>]*>(?:Level )?(\d+)', col)
    out['level'] = lv.group(1) if lv else None
    src = re.search(r'colophon-heading">Source:</span>\s*<a href="([^"]*)"[^>]*>(.*?)</a>', col, re.S)
    out['source'] = {'url': src.group(1), 'title': clean(src.group(2))} if src else None
    lic = re.findall(r'rel="license" href="([^"]+)"', col)
    out['licence_url'] = lic[0] if lic else None
    return out


def licence_of(url):
    m = re.fullmatch(r'https?://creativecommons\.org/licenses/(by)/(3\.0|4\.0)/?', url or '')
    return ('cc-by', m.group(2)) if m else (None, None)


def save(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site-slug', required=True, help='storybooks-korea')
    ap.add_argument('--lang', required=True, help='site language code in the URL, e.g. ko')
    ap.add_argument('--code', help='pack language code (default = --lang)')
    ap.add_argument('--site', required=True)
    ap.add_argument('--out', help='cache dir name (default <code>-gsb)')
    ap.add_argument('--limit', type=int)
    ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    code = a.code or a.lang
    d = os.path.join(a.site, '.cache', 'stories', a.out or f'{code}-gsb')
    os.makedirs(d, exist_ok=True)
    root = f'{BASE}/{a.site_slug}'
    mf_path = os.path.join(d, 'manifest.json')
    mf = json.load(open(mf_path)) if a.resume and os.path.exists(mf_path) else {}
    lp = os.path.join(d, 'list.json')
    if a.resume and os.path.exists(lp):
        ids = json.load(open(lp))
    else:
        idx = http(f'{root}/')
        ids = sorted(set(re.findall(rf'/{a.site_slug}/stories/{a.lang}/(\d{{4}})/', idx)))
        save(lp, ids)
    print(f'{len(ids)} stories listed', flush=True)
    if a.limit:
        ids = ids[:a.limit]
    for sid in ids:
        if mf.get(sid, {}).get('status') in ('ok', 'licence_rejected'):
            continue
        try:
            tp = parse_page(http(f'{root}/stories/{a.lang}/{sid}/'))
            ep = parse_page(http(f'{root}/stories/en/{sid}/'))
        except urllib.error.HTTPError as e:
            mf[sid] = {'status': 'error', 'why': f'http {e.code}'}; save(mf_path, mf); continue
        lic, ver = licence_of(tp['licence_url'])
        lic_en, ver_en = licence_of(ep['licence_url'])
        rec = {'id': sid, 'source': 'gsb', 'site': a.site_slug, 'lang': code, 'title': tp['title_l1'], 'level': tp['level'],
               'url': f'{root}/stories/{a.lang}/{sid}/', 'licence_url': tp['licence_url'], 'licence': lic, 'licence_version': ver,
               'authors': tp['credits'].get('Written by', []), 'illustrators': tp['credits'].get('Illustrated by', []),
               'translators': tp['credits'].get('Translated by', []), 'adapters': tp['credits'].get('Adapted by', []),
               'readers': tp['credits'].get('Read by', []), 'source_story': tp['source'],
               'publisher': 'Storybooks Korea / Global Storybooks (global-asp.github.io)'}
        if not lic or (lic, ver) != (lic_en, ver_en):
            rec['status'] = 'licence_rejected'; rec['why'] = f"{tp['licence_url']} vs {ep['licence_url']}"
        else:
            ns = sorted(set(tp['pages']) | set(ep['pages']))
            bad = [n for n in ns if n not in tp['pages'] or n not in ep['pages'] or tp['pages'][n]['l1'] != ep['pages'][n]['l1']]
            if not ns or bad:
                rec['status'] = 'error'; rec['why'] = f'pages differ between the two views: {bad[:5]}'
            else:
                rec['text_pages'] = [{'n': n, 'text': tp['pages'][n]['l1']} for n in ns]
                rec['pages'] = len(ns)
                rec['twin'] = {'id': 'en-' + sid, 'title': ep['title_def'], 'lang': 'English', 'pages': len(ns), 'licence': lic, 'licence_version': ver,
                               'url': f'{root}/stories/en/{sid}/', 'authors': ep['credits'].get('Written by', []),
                               'illustrators': ep['credits'].get('Illustrated by', []), 'translators': ep['credits'].get('Translated by', []),
                               'text_pages': [{'n': n, 'text': ep['pages'][n]['def']} for n in ns]}
                rec['status'] = 'ok'
        save(os.path.join(d, f'{sid}.json'), rec)
        mf[sid] = {'status': rec['status'], 'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%S'), **({'why': rec['why']} if 'why' in rec else {})}
        save(mf_path, mf)
        print(sid, rec['status'], rec.get('licence'), rec.get('licence_version'), rec.get('pages'), flush=True)
    from collections import Counter
    c = Counter(v['status'] for v in mf.values())
    save(os.path.join(d, 'run-stats.json'), {'statuses': dict(c), 'calls': c429 and {'429': c429} or {}})
    print('done', dict(c), flush=True)


if __name__ == '__main__':
    main()
