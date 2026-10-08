// Shared fake-DOM app harness for suites that boot engine/app.html against ANY pack directory (tests/eta_checks.js --pack,
// tests/port_sites_checks.js): the fake DOM, a seeded RNG, a clock, booting, and simulated Today sessions (7 a day, an hour
// apart; each answer right with probability `acc`). A script site's first-run card is skipped, or learned with opts.script "learn". Copied from tests/eta_checks.js; that suite keeps its own zh-only copy.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
const clone = x => JSON.parse(JSON.stringify(x));
const scriptOf = html => { const b = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; return b[b.length - 1][1]; };
function extractAttrs(tag){
  const attrs = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  let m; while((m = re.exec(tag))){ if(m[1]) attrs[m[1]] = m[2] !== undefined ? m[2] : ""; }
  return attrs;
}
function makeFakeDom(){
  const registry = new Map(); const tabButtons = [];
  class El {
    constructor(tag, attrs){
      this.tagName = (tag||"div").toUpperCase();
      this._attrs = Object.assign({}, attrs);
      this._classes = new Set((this._attrs.class||"").split(/\s+/).filter(Boolean));
      this._html = ""; this._text = "";
      this.style = { setProperty(k,v){ this[k]=v; } };
      this.hidden = false; this.disabled = false; this.value = "";
      this.onclick = null; this.oninput = null; this.onchange = null;
      this._listeners = {}; this._children = [];
      if(this._attrs.id) registry.set(this._attrs.id, this);
    }
    get id(){ return this._attrs.id || ""; }
    set id(v){ this._attrs.id = v; registry.set(v, this); }
    get classList(){
      const s = this._classes;
      return { add:(...c)=>c.forEach(x=>s.add(x)), remove:(...c)=>c.forEach(x=>s.delete(x)),
        toggle:(c,f)=>{ if(f===undefined){ s.has(c)?s.delete(c):s.add(c); } else { f?s.add(c):s.delete(c); } },
        contains:c=>s.has(c) };
    }
    get dataset(){
      const attrs = this._attrs; const toKebab = k => k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
      return new Proxy({}, { get(_, k){ return attrs["data-" + toKebab(String(k))]; }, set(_, k, v){ attrs["data-" + toKebab(String(k))] = String(v); return true; } });
    }
    get children(){ return this._children; }
    get innerHTML(){ return this._html; }
    set innerHTML(h){ this._html = h; this._children = []; registerIdsFromHtml(h); }
    get textContent(){ return this._text; }
    set textContent(t){ this._text = String(t); this._html = String(t); }
    setAttribute(k,v){ this._attrs[k]=String(v); if(k==="id") registry.set(v,this); }
    getAttribute(k){ return this._attrs[k]; }
    addEventListener(t,f){ (this._listeners[t]=this._listeners[t]||[]).push(f); }
    removeEventListener(){}
    appendChild(c){ this._children.push(c); return c; }
    insertBefore(c){ this._children.unshift(c); return c; }
    get firstChild(){ return this._children[0] || null; }
    remove(){}
    focus(){}
    click(){ if(this.onclick) this.onclick({}); (this._listeners.click||[]).forEach(f=>f({})); }
    closest(){ return null; }
    querySelector(){ return null; }
    querySelectorAll(){ return []; }
  }
  function registerIdsFromHtml(html){
    const re = /<([a-zA-Z0-9]+)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;
    let m; while((m = re.exec(html))){ const attrs = extractAttrs(m[2]); if(attrs.id) new El(m[1], attrs); }
  }
  const tabsMatch = appHtml.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/);
  const btnRe = /<button([^>]*)>/g;
  let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
  registerIdsFromHtml(appHtml.slice(appHtml.indexOf("<body>"), appHtml.indexOf("<nav")));
  return {
    title: "", head: { appended: [], appendChild(c){ this.appended.push(c); return c; } }, body: new El("body", {}), documentElement: new El("html", {}),
    write(){}, createElement(tag){ return new El(tag, {}); },
    getElementById(id){ return registry.get(id) || null; },
    querySelector(sel){ return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel){
      const m = sel.match(/^#tabs\s+button(?:\[data-t="([^"]+)"\])?$/);
      if(m) return m[1] ? tabButtons.filter(b=>b.dataset.t===m[1]) : tabButtons.slice();
      return [];
    },
    _listeners: {},
    addEventListener(t,f){ (this._listeners[t]=this._listeners[t]||[]).push(f); },
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function memStore(){
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()] };
}

const PY = process.env.PYTHON || "python3"; // enrich needs the standard library only
function readJson(f){ return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : undefined; }
// A pack directory's JSON files as the page's constants (what jsonify_pack.py and build.sh inline).
function loadPackDir(dir){
  const j = n => readJson(path.join(dir, n + ".json"));
  return { PACK: j("pack"), WORDS: j("words"), SENTENCES: j("sentences"), LESSONS: j("lessons"), PASSAGES: j("passages") || [],
    CHARACTERS: j("characters"), PATTERNS: j("patterns"), SCRIPT: j("script"), LEGACY: j("legacy") };
}
// `packbuilder enrich --emit` of a language repo into a fresh scratch dir (the repo is read only); returns { dir, out }.
function enrichedDir(lang, repo){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `enrich-${lang}-`));
  const out = cp.execFileSync(PY, ["-m", "packbuilder", "enrich", "--lang", lang, "--repo", repo, "--emit", path.join(dir, "pack")],
    { cwd: path.join(ROOT, "tools"), env: Object.assign({}, process.env, { PYTHONPATH: path.join(ROOT, "tools") }), encoding: "utf8" });
  return { dir: path.join(dir, "pack"), out };
}

function createSim(DATA){
  const { WORDS, SENTENCES } = DATA;
  const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
  const S_BY_ID = Object.fromEntries(SENTENCES.map(s => [s.id, s]));
  const DAY_N = Date.UTC(2026, 9, 2) / 864e5;
  const clock = { now: new Date(2026, 9, 2, 7, 0, 0).getTime() };
  class FakeDate extends Date {
    constructor(...a){ if(a.length) super(...a); else super(clock.now); }
    static now(){ return clock.now; }
  }
  const stats = { typedAsked: 0, typedRight: 0, typedMatched: 0 };
  async function boot(pack, st, seed, opts){
    const o = opts || {};
    Math.random = mulberry32(seed);
    const document = makeFakeDom();
    const voices = o.voices || [{ lang: pack.tts || "en-US", name: "x" }];
    const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(){} };
    const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
    const fnBody = scriptOf(o.html || appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML, html: () => document.documentElement,
  getProg: () => prog, getD: () => D, getCur: () => __cur, rd: () => RD,
  skipRead: () => { RD = null; todayStep(); },
  finishRead: ok => { RD.answers = RD.p.questions.map(() => ({ ok: ok() })); markPassageFinished(); RD = null; todayStep(); },
  eta: n => etaText(n), gate: () => gateSentence(),
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
};`;
    const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","PATTERNS","SCRIPT","LEGACY"];
    const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"SimChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
      function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, DATA.LESSONS, o.passages !== undefined ? o.passages : DATA.PASSAGES, DATA.CHARACTERS, o.patterns ? DATA.PATTERNS : undefined, DATA.SCRIPT, DATA.LEGACY];
    const api = new Function(...names, fnBody)(...args);
    await tick(); await tick();
    api.doc = document;
    return api;
  }
  const fresh = () => ({ ls: memStore(), ss: memStore() });
  async function bootWith(pack, prog, seed, opts){ const st = fresh(); if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog)); return await boot(pack, st, seed || 1, opts); }

  // The typed answer the app would accept for this item, found by asking the item's own check() (pure) about the
  // candidates its word / sentence offers; null when none passes (the sim then answers wrong, counted in stats).
  function typedAnswer(it){
    const key = String(it.key || ""), c = [];
    if(key.startsWith("w:")){
      const w = BY_ID[key.slice(2)];
      if(w){ c.push(w.w, ...(w.alt || []), w.pron, VC.gloss(w)); String(VC.gloss(w)).split(/[;,]/).forEach(x => c.push(x.replace(/\(.*?\)/g, "").trim())); }
    } else if(key.startsWith("s:")){
      const s = S_BY_ID[key.slice(2)];
      if(s){ (s.words || []).forEach(i => { const w = BY_ID[i]; if(w) c.push(w.w, ...(w.alt || []), ...(w.forms || [])); }); String(s.t).split(/[\s.,!?;:¿¡"«»()]+/).forEach(x => c.push(x)); }
    }
    return c.filter(Boolean).find(x => { try { return it.check(x); } catch(e){ return false; } }) || null;
  }
  function answer(api, right){
    const it = api.getCur();
    if(it.kind === "type"){
      stats.typedAsked++;
      const t = right ? typedAnswer(it) : null;
      if(right) stats.typedRight++;
      if(t) stats.typedMatched++;
      api.el("tin").value = t || "zzz not it"; api.el("submit").click(); return;
    }
    const btns = api.el("o").children;
    (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
  }
  const daySched = sn => sn % 7 === 0 ? new Date(2026, 9, 2 + sn / 7, 7, 0, 0).getTime() : clock.now + 60 * 60 * 1000;
  // sessions Today sessions on a record at accuracy acc; onSession(sn, api) after each (sn -1 = after boot). opts.read: read passages.
  async function playSessions(pack, seedP, sessions, seed, acc, onSession, opts){
    const st = fresh();
    if(seedP) st.ls.setItem(VC.storageKey(pack), JSON.stringify(seedP));
    clock.now = new Date(2026, 9, 2, 7, 0, 0).getTime();
    const api = await boot(pack, st, seed, opts);
    const ans = mulberry32(seed * 7919 + 1);
    if(onSession) onSession(-1, api);
    for(let sn = 0; sn < sessions; sn++){
      clock.now = daySched(sn);
      if(/id="choiceStart"/.test(api.panel())) api.el("choiceStart").click();
      if(/id="scriptChoice"/.test(api.panel())) api.el(opts && opts.script === "learn" ? "scriptLearn" : "scriptSkip").click();
      if(!/id="go"/.test(api.panel())) throw new Error(`session ${sn + 1}: no Start button: ${api.panel().slice(0, 200)}`);
      api.el("go").click();
      for(let guard = 0; ; guard++){
        if(guard > 3000) throw new Error(`session ${sn + 1}: no end`);
        const html = api.panel(), D = api.getD();
        if(D && api.getCur() && D.cur){ answer(api, ans() < acc); api.el("nx").click(); continue; }
        if(/id="again"/.test(html)){ api.el("again").click(); break; }
        if(/id="ok"/.test(html) && !D){ api.el("ok").click(); continue; }
        if(/id="dr"/.test(html)){ api.el("dr").click(); continue; }
        if(api.rd()){ if(opts && opts.read) api.finishRead(() => ans() < acc); else api.skipRead(); continue; }
        throw new Error(`session ${sn + 1}: stuck on ${html.slice(0, 200)}`);
      }
      if(onSession) onSession(sn, api);
    }
    return api;
  }
  return { boot, bootWith, fresh, playSessions, answer, stats, clock, DAY_N, BY_ID };
}

module.exports = { VC, ROOT, clone, mulberry32, memStore, tick, loadPackDir, enrichedDir, createSim };
