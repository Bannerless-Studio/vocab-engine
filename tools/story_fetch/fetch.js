#!/usr/bin/env node
// StoryWeaver story fetcher: CC BY 4.0 stories + English twin, in-page fetch on the site's own anonymous session.
// Usage: node tools/story_fetch/fetch.js --lang Urdu --levels 1,2 --site ../urdu [--code ur] [--limit N] [--resume]
// See tools/story_fetch/README.md. No login. One global queue, >= 3.5 s between calls, 429 => 60 s back off.
'use strict';
const fs = require('fs');
const path = require('path');
const PW = process.env.PLAYWRIGHT_PATH || '/Users/ishmum/Programming/Freelance/china-harbour-deploy/node_modules/playwright';
const { chromium } = require(PW);

const BASE = 'https://storyweaver.org.in';
const GAP_MS = 3500;
const BACKOFF_MS = 60000;
const CODES = { Urdu: 'ur', Korean: 'ko', Farsi: 'fa', Dari: 'prs', Hindi: 'hi', 'Bahasa Indonesia': 'id', Arabic: 'ar', Kiswahili: 'sw' };

function args(argv) {
  const a = { resume: false, limit: 0, levels: '1,2', perPage: 50 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--resume') a.resume = true;
    else if (k.startsWith('--')) a[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  a.limit = +a.limit || 0;
  a.levels = String(a.levels).split(',').map(s => s.trim()).filter(Boolean);
  if (!a.lang || !a.site) { console.error('need --lang <Name> --site <dir>'); process.exit(2); }
  a.code = a.code || CODES[a.lang];
  if (!a.code) { console.error('unknown --lang, pass --code'); process.exit(2); }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString(), ...m);

// ---- html helpers ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}
function htmlText(h) {
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(h).replace(/­/g, '').split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}
// text block of a StoryPage: the div whose class has "content", up to the page-number label
function pageContent(html) {
  let m = html.match(/<div class=['"][^'"]*\bcontent\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<div class=['"]page_number/);
  if (!m) m = html.match(/<div class=['"][^'"]*\bcontent\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/);
  return m ? m[1] : null;
}
function coverCredits(html) {
  const out = {};
  const re = /<p class="cover_attribution[^"]*">\s*([A-Za-z ]+?):\s*([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    const names = htmlText(m[2]).split(/\n|,|&/).map(s => s.trim()).filter(Boolean);
    out[label] = (out[label] || []).concat(names);
  }
  return out;
}
// licences: book-level statement + story-attribution lines (text only; image lines ignored)
function parseLicence(pages) {
  const back = pages.filter(p => p.pageType === 'BackInnerCoverPage').map(p => htmlText(p.html));
  const all = back.join('\n');
  const mBook = all.match(/This book is\s+(CC[ -]?BY[A-Z -]*?[ -]?\d(?:\.\d)?)\s+licensed/i);
  const book = mBook ? mBook[1].replace(/\s+/g, '-').replace(/-+/g, '-').toUpperCase() : null;
  const attrBlock = (all.split(/Images Attributions:/i)[0].split(/Story Attribution:/i)[1] || '');
  const lines = [...attrBlock.matchAll(/Released under\s+(CC[A-Za-z0-9 .-]*?)\s+license/gi)].map(m => m[1].replace(/\s+/g, ' ').toUpperCase());
  const ok = book === 'CC-BY-4.0' && lines.length > 0 && lines.every(l => l === 'CC BY 4.0');
  return { book, story_lines: lines, ok, attribution_text: attrBlock.trim().slice(0, 1500) };
}

function normStory(read) {
  const pages = read.pages || [];
  const sp = pages.filter(p => p.pageType === 'StoryPage');
  const out = [];
  let parseFail = 0;
  sp.forEach((p, i) => {
    const c = pageContent(p.html);
    if (c == null) parseFail++;
    out.push({ n: i + 1, pageId: p.pageId, html: c == null ? '' : c.trim(), text: c == null ? '' : htmlText(c) });
  });
  const front = pages.find(p => p.pageType === 'FrontCoverPage');
  return { pages: out, parseFail, front: front ? front.html : '' };
}

async function main() {
  const A = args(process.argv);
  const cacheDir = path.resolve(A.site, '.cache/stories', A.code);
  fs.mkdirSync(cacheDir, { recursive: true });
  const manPath = path.join(cacheDir, 'manifest.json');
  let manifest = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
  const stats = { calls: 0, c429: 0, c401: 0, ok: 0, twin_null: 0, licence_rejected: 0, error: 0, twin_empty: 0, twin_title: 0, twin_pages: 0, twin_licence: 0, twin_ok: 0, page_equal: 0 };
  const saveMan = () => { fs.writeFileSync(manPath + '.tmp', JSON.stringify(manifest, null, 1)); fs.renameSync(manPath + '.tmp', manPath); };
  const saveStats = () => fs.writeFileSync(path.join(cacheDir, 'run-stats.json'), JSON.stringify({ ...stats, at: new Date().toISOString() }, null, 1));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  let last = 0;
  const gap = async () => { const w = last + GAP_MS - Date.now(); if (w > 0) await sleep(w); last = Date.now(); };
  const openSession = async (url) => { await gap(); await page.goto(url || BASE + '/en', { waitUntil: 'networkidle', timeout: 90000 }); last = Date.now(); };

  // one throttled in-page GET; 429 => 60 s back off + retry (give up after 5 in a row); 401 => reopen session once
  async function api(u, { allow404 = false, reopen = null } = {}) {
    let n429 = 0, reopened = false;
    for (;;) {
      await gap();
      stats.calls++;
      const r = await page.evaluate(async (u) => {
        try { const r = await fetch(u, { credentials: 'include' }); return { s: r.status, t: await r.text() }; }
        catch (e) { return { s: 0, t: String(e) }; }
      }, u);
      last = Date.now();
      if (r.s === 429) {
        stats.c429++; n429++; log('429', u.slice(0, 80), 'backoff 60s');
        if (n429 >= 5) { saveStats(); throw Object.assign(new Error('too many 429'), { fatal: true }); }
        await sleep(BACKOFF_MS); last = Date.now(); continue;
      }
      if (r.s === 401 && !reopened) { stats.c401++; reopened = true; log('401, reopening', reopen || 'base'); await openSession(reopen ? BASE + '/en/stories/' + reopen : undefined); continue; }
      if (r.s === 401 && reopened && /not authorized to read/i.test(r.t)) {
        // anonymous read quota / login wall ("Join StoryWeaver to keep the story going"): stop, never work around it
        saveStats(); throw Object.assign(new Error('read gate: anonymous reads refused (401 after reopening the story page); resume later'), { fatal: true });
      }
      if (r.s === 404 && allow404) return null;
      if (r.s !== 200) throw new Error('HTTP ' + r.s + ' ' + u + ' ' + r.t.slice(0, 120));
      let j; try { j = JSON.parse(r.t); } catch (e) { throw new Error('bad json ' + u); }
      if (j.ok === false) throw new Error('api not ok ' + u + ' ' + r.t.slice(0, 120));
      return j;
    }
  }

  await openSession();
  log('session open; cookies:', (await ctx.cookies()).map(c => c.name).join(','));

  // ---- list (cached per level) ----
  const lists = {};
  for (const lv of A.levels) {
    const lp = path.join(cacheDir, `list-L${lv}.json`);
    if (fs.existsSync(lp)) { lists[lv] = JSON.parse(fs.readFileSync(lp, 'utf8')); continue; }
    const items = []; let tp = 1;
    for (let pg = 1; pg <= tp; pg++) {
      const j = await api(`/node/api/v1/books-search?languages[]=${encodeURIComponent(A.lang)}&levels[]=${lv}&page=${pg}&per_page=${A.perPage}`);
      tp = j.metadata.totalPages;
      for (const it of j.data) { delete it.coverImage; items.push(it); }
    }
    lists[lv] = items;
    fs.writeFileSync(lp, JSON.stringify(items));
    log('list L' + lv, items.length);
  }
  // selection: all, or evenly spaced sample per level when --limit
  let queue = [];
  for (const lv of A.levels) {
    const items = lists[lv];
    let pick = items;
    if (A.limit) {
      const k = Math.min(items.length, Math.ceil(A.limit / A.levels.length));
      pick = Array.from({ length: k }, (_, i) => items[Math.floor((i * items.length) / k)]);
    }
    queue = queue.concat(pick);
  }
  if (A.limit) queue = queue.slice(0, A.limit);
  log('queue', queue.length);

  const isTerminal = s => ['ok', 'twin_null', 'licence_rejected'].includes(s);
  // the read API only authorises a story whose own page was opened in this session (401 otherwise)
  const opened = new Set();
  async function readStory(slug, preOpen) {
    if (preOpen) { await openSession(BASE + '/en/stories/' + slug); opened.add(slug); }
    const j = await api(`/api/v1/stories/${slug}/read?ignore_count=false&source=`, { reopen: opened.has(slug) ? null : slug });
    const d = j.data;
    return { d, ...normStory(d), lic: parseLicence(d.pages || []) };
  }

  for (const it of queue) {
    const id = it.id;
    if (A.resume && manifest[id] && isTerminal(manifest[id].status)) continue;
    const t0 = Date.now();
    try {
      const rec = {
        id, slug: it.slug, level: it.level, title: it.title, lang: A.lang, code: A.code,
        url: `${BASE}/en/stories/${it.slug}`, authors: [], illustrators: [], translators: [], publisher: null,
        licence: null, origin: null, origin_story: null, pages: 0, text_pages: [], twin: null, twin_tried: [], raw: { list_item: it },
      };
      const rd = await readStory(it.slug, true);
      rec.raw.read_meta = Object.fromEntries(Object.entries(rd.d).filter(([k]) => k !== 'pages'));
      rec.raw.cover_credits = coverCredits(rd.front);
      rec.raw.licence = { book: rd.lic.book, story_lines: rd.lic.story_lines, attribution_text: rd.lic.attribution_text };
      rec.licence = rd.lic.ok ? 'CC-BY-4.0' : null;
      rec.authors = (rd.d.authors || it.authors || []).map(a => a.name);
      rec.illustrators = (it.illustrators || []).map(a => a.name);
      rec.translators = (rec.raw.cover_credits.Translator || []).slice();
      rec.publisher = it.publisher ? it.publisher.name : null;
      if (!rd.lic.ok) {
        rec.status = 'licence_rejected';
        stats.licence_rejected++;
        fs.writeFileSync(path.join(cacheDir, id + '.json'), JSON.stringify(rec, null, 1));
        manifest[id] = { status: rec.status, licence_book: rd.lic.book, fetched_at: new Date().toISOString() };
        saveMan(); log(id, 'licence_rejected', rd.lic.book);
        continue;
      }
      rec.pages = rd.pages.length;
      rec.text_pages = rd.pages;
      rec.parse_fail = rd.parseFail;
      // detail: original story + credits (translations only)
      if (it.isTranslation) {
        const det = await api(`/node/api/v1/stories/${it.slug}`);
        rec.raw.detail = det.data;
        const os = det.data.originalStory;
        if (os) rec.origin_story = { id: os.id, name: os.name, slug: os.slug, authors: (os.authors || []).map(a => a.name), publisher: os.originalPublisher ? os.originalPublisher.name : null };
        if (det.data.illustrators) rec.illustrators = det.data.illustrators.map(a => a.name);
      }
      // twin
      const tr = await api(`/node/api/v1/stories/${id}/translations_and_videos`);
      const list = tr.data.translations || [];
      rec.raw.translations_count = list.length;
      rec.origin = it.isTranslation && rec.origin_story ? ((list.find(x => x.id === rec.origin_story.id) || {}).language || null) : (it.isTranslation ? null : A.lang);
      if (it.isTranslation && !rec.origin_story) rec.origin = null;
      const en = list.filter(x => x.language === 'English');
      const lvNum = +it.level;
      en.sort((x, y) => {
        const o = c => (rec.origin_story && c.id === rec.origin_story.id ? 0 : 1);
        return o(x) - o(y) || Math.abs(+x.level - lvNum) - Math.abs(+y.level - lvNum) || x.id - y.id;
      });
      let chosen = null;
      for (const c of en.slice(0, 4)) {
        const why = [];
        const tw = await readStory(c.slug);
        const txt = tw.pages.map(p => p.text).join('');
        if (!txt.trim()) { why.push('empty'); stats.twin_empty++; }
        if (!/[A-Za-z]/.test(c.title || '')) { why.push('title_not_latin'); stats.twin_title++; }
        if (tw.pages.length !== rd.pages.length) { why.push('pages_' + tw.pages.length + '_vs_' + rd.pages.length); stats.twin_pages++; }
        else stats.page_equal++;
        if (!tw.lic.ok) { why.push('licence_' + tw.lic.book); stats.twin_licence++; }
        rec.twin_tried.push({ id: c.id, title: c.title, level: c.level, rejected: why });
        if (!why.length) {
          chosen = { id: c.id, slug: c.slug, title: c.title, level: c.level, lang: 'English', pages: tw.pages.length, licence: 'CC-BY-4.0', authors: (tw.d.authors || []).map(a => a.name), text_pages: tw.pages, raw: { cover_credits: coverCredits(tw.front), licence: { book: tw.lic.book, story_lines: tw.lic.story_lines } } };
          break;
        }
      }
      rec.twin = chosen;
      rec.status = chosen ? 'ok' : 'twin_null';
      rec.fetched_at = new Date().toISOString();
      fs.writeFileSync(path.join(cacheDir, id + '.json'), JSON.stringify(rec, null, 1));
      manifest[id] = { status: rec.status, level: it.level, pages: rec.pages, twin: chosen ? chosen.id : null, fetched_at: rec.fetched_at };
      if (chosen) { stats.ok++; stats.twin_ok++; } else stats.twin_null++;
      saveMan(); saveStats();
      log(id, rec.status, 'pages', rec.pages, 'twin', chosen ? chosen.id : '-', ((Date.now() - t0) / 1000).toFixed(0) + 's');
    } catch (e) {
      if (e.fatal) { saveMan(); saveStats(); log('FATAL', e.message, '(resumable with --resume)'); await browser.close(); process.exit(3); }
      stats.error++;
      manifest[id] = { status: 'error', error: String(e.message).slice(0, 200), fetched_at: new Date().toISOString() };
      saveMan(); saveStats(); log(id, 'error', e.message);
    }
  }
  saveMan(); saveStats();
  log('DONE', JSON.stringify(stats));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
