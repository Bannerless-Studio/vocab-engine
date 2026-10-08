"use strict";
// Port-site simulation helpers (tests/migration_checks.js [port]): load a sibling language pack beside this repo,
// apply the generic end-state flag set G in memory (the packs do not carry the flags yet), and play seeded Today
// sessions in the fake DOM at a fixed accuracy, as tests/day_sim_checks.js does for zh. Test infrastructure only.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
const scriptOf = html => { const b = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; return b[b.length - 1][1]; };
const clone = x => JSON.parse(JSON.stringify(x));
const SIBLINGS = ["arabic", "french", "german", "hindi", "indonesian", "italian", "japanese", "korean", "persian", "russian", "spanish", "swahili", "urdu"];

function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + "\nreturn " + name + ";")(); }
function tryConst(file, name){ try { return loadConst(file, name); } catch(e){ return undefined; } }
// null when the sibling checkout (or its generated pack/*.js) is not beside this repo
function loadSibling(lang){
  const dir = path.join(process.env.LANG_REPOS_DIR || path.join(ROOT, ".."), lang, "pack");
  if(!["pack.js", "words.js", "sentences.js"].every(f => fs.existsSync(path.join(dir, f)))) return null;
  return { lang, dir, pack: loadConst(path.join(dir, "pack.js"), "PACK"), words: loadConst(path.join(dir, "words.js"), "WORDS"),
    sentences: loadConst(path.join(dir, "sentences.js"), "SENTENCES"), passages: tryConst(path.join(dir, "sentences.js"), "PASSAGES") || [],
    lessons: tryConst(path.join(dir, "lessons.js"), "LESSONS") || [], script: tryConst(path.join(dir, "script.js"), "SCRIPT"),
    characters: tryConst(path.join(dir, "characters.js"), "CHARACTERS") };
}

// Flags every ported site ends with (.cache/briefs/port-plan.md section 1, G). ja types the reading too.
// ja adds the characters set + levelExam on top (wave 4); eta is not in G here (tests/port_sites_checks.js covers it).
const PERIPHERAL_SHARE = [0.10, 0.25, 0.40];   // per level index A1 A2 B1: the least frequent share of the level
const AMBIENT_RANK = 100;
function genericFlags(pack, lang){
  const ids = pack.levels.map(l => String(l.id));
  const lbl = { A1: "survive a trip: greet, order, count, buy", A2: "daily life: directions, simple chat, short notices", B1: "follow a slow drama with subtitles" };
  const f = {
    dayAware: true, typedFrom: lang === "japanese" ? ["written", "pron"] : ["written"], glossFocus: true, glossStyle: "primary",
    helpClose: true, readAnswerBlock: true, optsMix: true, pauseNew: true, listenQuestions: "all", readRotation: true, wordsBy: "typed",
    progressMap: { goals: ids.map(id => ({ upTo: id, label: lbl[id] || id })) },
    pairs: true, freqTiers: true, progressView: "v2", appView: "v2", levelGate: 0.7,
  };
  if(lang === "japanese"){
    f.characters = Object.assign({}, pack.characters, { learn: "lag", start: 60, ramp: [3, 5, 8], bareBy: "typed", bareWords: true, bareByPair: true });
    f.levelExam = { [ids[0]]: "pinyin", [ids[1]]: "characters", [ids[2]]: "characters" };
  }
  return f;
}
// ft from the word's frequency rank: ambient rank <= 100, peripheral the least frequent share of each level, else core
function withTiers(pack, words){
  const ids = pack.levels.map(l => String(l.id)), out = clone(words);
  ids.forEach((lv, i) => {
    const list = out.filter(w => String(w.lv) === lv).sort((a, b) => a.rank - b.rank);
    const nPer = Math.round(list.length * (PERIPHERAL_SHARE[i] !== undefined ? PERIPHERAL_SHARE[i] : 0.4));
    list.forEach((w, k) => { w.ft = w.rank <= AMBIENT_RANK ? 0 : k >= list.length - nPer ? 2 : 1; });
  });
  return out;
}
// a unit's ft is the lowest of its words (core/enrich.py)
function withUnitTiers(units, words){
  const ft = Object.fromEntries(words.map(w => [w.id, w.ft]));
  return units && clone(units).map(u => { const t = u.words.filter(i => i in ft).map(i => ft[i]); return Object.assign(u, { ft: t.length ? Math.min(...t) : 1 }); });
}
function withG(site){
  const words = withTiers(site.pack, site.words);
  return { pack: Object.assign(clone(site.pack), genericFlags(site.pack, site.lang)), words, characters: withUnitTiers(site.characters, words) };
}

function mulberry32(seed){
  let a = seed >>> 0;
  return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function memStore(){
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()] };
}
const tick = () => new Promise(r => setTimeout(r, 0));

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

// A pre-port record: what a sibling on engine ef44c6e stores (legacy streaks r/w/s, no t, no p), `nWords` words in
// frequency order across the levels, set counters to match, some placement-provisional words.
function legacySeed(core, site, nWords, seed){
  const r = mulberry32(seed), pack = site.pack;
  const p = core.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 30 }, pack);
  const byLv = core.wordsByLevel(site.words, pack), size = core.setSizeOf(pack);
  let left = nWords;
  for(const lv of core.levelIds(pack)){
    const list = byLv[lv] || [], take = Math.min(left, list.length);
    p.sets[lv] = Math.floor(take / size);
    list.slice(0, take).forEach(w => {
      const s = Math.floor(r() * 9), rec = { r: s + 1 + Math.floor(r() * 4), w: r() < 0.5 ? 0 : 1 + Math.floor(r() * 3), s };
      if(s < 3 && r() < 0.25) rec.prov = 1;
      p.w[w.id] = rec;
    });
    left -= take;
    if(!left) break;
  }
    // placement leaves provisional records on words far past the set counter, the least frequent ones among them
  for(const lv of core.levelIds(pack)) (byLv[lv] || []).slice(-40).forEach(w => { if(!p.w[w.id]){ const s = Math.floor(r() * 5); p.w[w.id] = Object.assign({ r: s + 1, w: s < 2 ? 1 : 0, s }, s < 3 ? { prov: 1 } : {}); } });
  return p;
}

// ------------------------------------------------------------------ item answering
// A typed item is answered right with the first candidate its own check() accepts (check has no side effects).
function candidates(it, byId){
  const k = String(it.key || ""), w = k.startsWith("w:") ? byId[k.slice(2)] : null, out = [];
  if(w){
    [w.w, w.pron, w.lemma, VC.gloss(w)].forEach(x => { if(x) out.push(String(x)); });
    String(w.en || "").split(/[;,]/).forEach(x => { x = x.replace(/\(.*?\)/g, "").trim(); if(x) out.push(x); });
  }
  return out;
}
function answer(api, right, byId){
  const it = api.getCur();
  if(it.kind === "type"){
    let v = null;
    if(right) v = candidates(it, byId).find(c => { try { return it.check(c); } catch(e){ return false; } }) || null;
    api.el("tin").value = v || "zzz not it"; api.el("submit").click(); return;
  }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}

// Play `sessions` Today sessions on one simulated day (1 h apart) from `seedProg` under pack `pack` (flags applied by the caller).
// Between sessions: two Progress visits (prog.pv) and, from session 2, passage marks (read.done s / ls). Returns the stored record.
async function playSessions(site, pack, words, seedProg, opts){
  const o = Object.assign({ sessions: 8, acc: 0.85, seed: 1, voice: true }, opts || {});
  const DAY = Date.UTC(2026, 9, 2) / 864e5;
  let NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
  class FakeDate extends Date { constructor(...a){ if(a.length) super(...a); else super(NOW); } static now(){ return NOW; } }
  const real = Math.random; Math.random = mulberry32(o.seed);
  try {
    const st = { ls: memStore(), ss: memStore() }, key = VC.storageKey(pack);
    st.ls.setItem(key, JSON.stringify(seedProg));
    const document = makeFakeDom();
    const ss = { getVoices: () => o.voice ? [{ lang: pack.tts, name: "x" }] : [], onvoiceschanged: null, cancel(){}, speak(){} };
    const window = { VocabCore: VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
    const fnBody = scriptOf(appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML,
  getProg: () => prog, getD: () => D, getCur: () => __cur, rd: () => RD, skipRead: () => { RD = null; todayStep(); },
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(), save: () => store.save(),
};`;
    const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","SCRIPT"];
    const args = [window.SpeechSynthesisUtterance, document, window, { userAgent: "PortSim/1.0" }, undefined, st.ls, st.ss, () => ({ matches: false }), fn => setTimeout(fn, 0),
      function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, words, site.sentences, site.lessons, site.passages, o.characters || site.characters, site.script];
    const api = new Function(...names, fnBody)(...args);
    await tick(); await tick();
    const byId = Object.fromEntries(words.map(w => [w.id, w]));
    const ans = mulberry32(o.seed * 7919 + 1), stat = { items: 0, right: 0 };
    for(let sn = 0; sn < o.sessions; sn++){
      NOW += 60 * 60 * 1000;
      // the script primer's one-time choice: skipped by default (a learner who reads the script), learned with opts.script "learn"
      if(/id="scriptSkip"/.test(api.panel())) api.el(o.script === "learn" ? "scriptLearn" : "scriptSkip").click();
      if(!/id="go"/.test(api.panel())) throw new Error(site.lang + " session " + (sn + 1) + ": no Start button: " + api.panel().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500));
      api.el("go").click();
      for(let guard = 0; guard < 3000; guard++){
        const html = api.panel(), D = api.getD();
        if(D && api.getCur() && D.cur){ const ok = ans() < o.acc; stat.items++; if(ok) stat.right++; answer(api, ok, byId); api.el("nx").click(); continue; }
        if(/id="again"/.test(html)){ api.el("again").click(); break; }
        if(/id="ok"/.test(html) && !D){ api.el("ok").click(); continue; }
        if(/id="dr"/.test(html)){ api.el("dr").click(); continue; }
        if(api.rd()){ api.skipRead(); continue; }
        throw new Error(site.lang + " session " + (sn + 1) + ": stuck on " + html.slice(0, 200));
      }
      const prog = api.getProg(), ps = site.passages;
      if(sn === 1 && ps[0]) VC.markPassageDone(prog, ps[0].id, 2, 3, "2026-10-02", false, pack);
      if(sn === 3 && ps[0] && ps[1]){ VC.markPassageDone(prog, ps[0].id, 3, 3, "2026-10-02", true, pack); VC.markPassageDone(prog, ps[1].id, 2, 3, "2026-10-02", false, pack); }
      if(sn === 2 || sn === 5){ api.clickTab("progress"); api.clickTab("today"); }
      await api.save();
    }
    return { raw: st.ls.getItem(key), stat, keys: st.ls.keys() };
  } finally { Math.random = real; }
}

module.exports = { SIBLINGS, loadSibling, genericFlags, withTiers, withG, legacySeed, playSessions, mulberry32, clone };
