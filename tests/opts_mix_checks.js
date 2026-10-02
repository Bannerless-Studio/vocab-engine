// pack.optsMix (docs/PACK_SCHEMA.md "optsMix"; owner 2026-10-02: "multiple choice comes from the
// same hsk level ... near the end of an hsk level i can guess new words by deducting which words
// must not be it"; review 2026-10-02: a learned/unlearned mix lets the other class be ruled out,
// so wrong choices come from the answer's stage). [1] every changed option builder in core over
// progress shapes x answer new / known: guess success of a learner who rules out never-taught
// options and options of another stage than the answer, before (flag off, level tiers) vs after;
// the owner's leak (new answer, every wrong choice known); sentence length outliers; every old
// guard; progress untouched. [2] app: each site, a Learn drill's options, one script per set,
// placement as flag off, nothing written, answer position uniform. [3] flag off: core results and
// a whole app session byte-identical to main 68930bd. Seeded throughout (mulberry32).
// Run: node tests/opts_mix_checks.js [--table]
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const BASE = "68930bd"; // main before optsMix: level-tier options everywhere
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const PACK_OFF = (p => { const q = Object.assign({}, p); delete q.optsMix; return q; })(PACK);
const eq = util.isDeepStrictEqual;
const clone = x => JSON.parse(JSON.stringify(x));
const TABLE = process.argv.includes("--table");

let fails = 0, passes = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}


// ------------------------------------------------------------------ fake DOM (copied from lag_checks.js)
const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
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


const DAY = "2026-10-02";
let NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
class FakeDate extends Date {
  constructor(...a){ if(a.length) super(...a); else super(NOW); }
  static now(){ return NOW; }
}
// Boots app.html (opts.html, default this tree's) on opts.core (default this tree's VocabCore)
// with storage st ({ ls, ss }); Math.random seeded.
async function boot(pack, st, seed, opts){
  const o = opts || {};
  Math.random = mulberry32(seed);
  const document = makeFakeDom();
  const voices = o.voices || [{ lang:"zh-CN", name:"x" }];
  const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(){} };
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const hook = n => `typeof ${n} === "function" ? ${n} : null`;
  const fnBody = scriptOf(o.html || appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  el: id => document.getElementById(id), html: id => { const e = document.getElementById(id); return e ? e.innerHTML : null; }, panel: () => document.getElementById("panel").innerHTML,
  getProg: () => prog, setProg: p => { prog = p; }, getD: () => D, getCur: () => __cur,
  today: () => { tab = "today"; render(); }, goto: t => { tab = t; testSel = null; RD = null; soundsSel = null; render(); },
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
  readItem, recallItem, revealBlock, charDrillItem, wordRowHTML, itemFromPlan,
  hearItem: ${hook("hearItem")}, learnPair: ${hook("learnPair")}, gapSentence: ${hook("gapSentence")}, readStimHTML: ${hook("readStimHTML")}, optScript: ${hook("optScript")}, wordOptHtml, placeSrc: String(${hook("placeVocabNext")}), dayWordCan: ${hook("dayWordCan")},
  meaningTypeItem: ${hook("meaningTypeItem")}, writtenPronTypeItem: ${hook("writtenPronTypeItem")}, silentWrittenTypeItem: ${hook("silentWrittenTypeItem")}, pronTypeItem: ${hook("pronTypeItem")},
  drill1: it => drill([it], () => {}, null), skipRead: () => { RD = null; todayStep(); }, rd: () => RD,
  readSentence: ${hook("readSentence")}, withLearn: ${hook("withLearn")}, startPlacement: ${hook("startPlacement")},
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"TypedMasteryChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, o.passages || [], CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return api;
}
const fresh = () => ({ ls: memStore(), ss: memStore() });
async function bootWith(pack, prog, seed, opts){ const st = fresh(); if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog)); return { api: await boot(pack, st, seed || 1, opts), st }; }
const stripTags = h => String(h).replace(/<rt[^>]*>[\s\S]*?<\/rt>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
const typedAnswer = it => { const w = BY_ID[String(it.key).slice(2)]; return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w; };
function answer(api, right, typed){
  const it = api.getCur();
  if(it.kind === "type"){ api.el("tin").value = typed != null ? typed : right ? typedAnswer(it) : "zzz not it"; api.el("submit").click(); return; }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}

let OLD = null, OLD_HTML = null;
try {
  const os = require("os");
  const src = cp.execSync(`git -C "${ROOT}" show ${BASE}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "optsmix-")), `core_${BASE}.js`); fs.writeFileSync(f, src); OLD = require(f);
  OLD_HTML = cp.execSync(`git -C "${ROOT}" show ${BASE}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
} catch(e){ OLD = null; OLD_HTML = null; }

const byLv = VC.wordsByLevel(WORDS, PACK);
const ORDER_W = VC.levelIds(PACK).flatMap(lv => byLv[lv]);
const UNIT_OF = new Map(CHARACTERS.map(u => [u.words[0], u]));
const FW = new Set(PACK.functionWords || []);
const CM = VC.charsConfig(PACK).mastered;
const nk = VC.normKey, f2 = VC.firstTwoWords;
const groupBy = (list, key) => { const m = new Map(); list.forEach(x => { const k = key(x); if(!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
const BY_GLOSS = groupBy(WORDS, w => VC.gloss(w)), BY_W = groupBy(WORDS, w => w.w), BY_PRON = groupBy(WORDS.filter(w => w.pron), w => w.pron);
const BY_T = groupBy(CHARACTERS, u => String(u.t)), BY_READ = groupBy(CHARACTERS, u => nk(VC.unitReading(u, BY_ID)));
const BY_EN = groupBy(SENTENCES, s => s.en);

// The first n words in level order learned (streak 5, known; the last 10 streak 0, weak); the
// units of the first share of them taught (streak CM, known; the last 10 streak 0, weak); 70% of
// the sentences open to them seen.
function shape(n, unitShare, unitStreak){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 30 }, PACK);
  const L = ORDER_W.slice(0, n);
  L.forEach((w, i) => { p.w[w.id] = i >= n - 10 ? { r: 1, w: 0, s: 0 } : { r: 5, w: 0, s: 5 }; });
  VC.levelIds(PACK).forEach(lv => VC.settleSetCounter(p, WORDS, PACK, lv));
  const tu = L.slice(0, Math.floor(n * (unitShare == null ? 0.7 : unitShare))).map(w => UNIT_OF.get(w.id)).filter(Boolean);
  tu.forEach((u, i) => { p.chars.c[u.id] = i >= tu.length - 10 ? { r: 1, w: 0, s: 0 } : { r: 4, w: 0, s: unitStreak ? unitStreak() : CM }; });
  const avail = VC.availableSentences(SENTENCES, WORDS, PACK, p);
  avail.slice(0, Math.floor(avail.length * 0.7)).forEach(s => { p.s[s.id] = { r: 2, w: 0, s: 2 }; });
  return p;
}
// The app's stage functions (app.html wordMix / sentMix / charCtx): 0 new/weak, 1 known, 2 never taught.
function stages(p, learnW, learnU){
  const ids = new Set(VC.learnedWords(WORDS, PACK, p).map(w => w.id)), recs = VC.charRecs(p), open = new Set(VC.availableSentences(SENTENCES, WORDS, PACK, p).map(s => s.id));
  const lw = learnW || new Set(), lu = learnU || new Set();
  return {
    lw: VC.learnedWords(WORDS, PACK, p),
    word: v => lw.has(v.id) ? 0 : !ids.has(v.id) ? 2 : ((p.w[v.id].s || 0) >= VC.WORD_MASTERED ? 1 : 0),
    unit: u => lu.has(u.id) ? 0 : !recs[u.id] ? 2 : ((recs[u.id].s || 0) >= CM ? 1 : 0),
    sent: s => p.s[s.id] ? 1 : open.has(s.id) ? 0 : 2,
  };
}
// Answers. "new": the Learn set (next 10 untaught words / units; they join stage 0), else streak-0
// records; sentences: open, not yet seen. "known": mastered words / units, seen sentences.
function answersFor(kind, which, p){
  if(kind === "word"){
    if(which === "new"){ const st = stages(p); const u = ORDER_W.filter(w => st.word(w) === 2).slice(0, 10); return u.length ? { as: u, learnW: new Set(u.map(w => w.id)) } : { as: ORDER_W.filter(w => p.w[w.id] && p.w[w.id].s === 0) }; }
    return { as: ORDER_W.filter(w => p.w[w.id] && p.w[w.id].s >= VC.WORD_MASTERED) };
  }
  if(kind === "learnedWord"){ // typed items ("How is it said?") and charRead: the answer word is always learned
    return which === "new" ? { as: ORDER_W.filter(w => p.w[w.id] && p.w[w.id].s === 0) } : { as: ORDER_W.filter(w => p.w[w.id] && p.w[w.id].s >= VC.WORD_MASTERED) };
  }
  if(kind === "unit"){
    const recs = p.chars.c, st = stages(p);
    if(which === "new"){ const u = ORDER_W.filter(w => st.word(w) !== 2).map(w => UNIT_OF.get(w.id)).filter(u => u && !recs[u.id]).slice(0, 10); return u.length ? { as: u, learnU: new Set(u.map(x => x.id)) } : { as: CHARACTERS.filter(u => recs[u.id] && recs[u.id].s === 0) }; }
    return { as: CHARACTERS.filter(u => recs[u.id] && recs[u.id].s >= CM) };
  }
  const st = stages(p);
  return { as: SENTENCES.filter(s => st.sent(s) === (which === "new" ? 0 : 1)) };
}
// A label stands for every item that shows it: ruled out only when all of them are.
const labelItems = (b, o) => b.strings === "read" ? (BY_READ.get(nk(o)) || []) : b.strings === "pron" ? (BY_PRON.get(o) || []) : [o];
const gapMatchOf = a => { const s = SENTENCES.find(x => (x.words || []).includes(a.id)); return s ? VC.gapMatch(s, a, BY_ID, PACK) : null; };

const wordGuard = show => (a, os) => {
  const labels = [a, ...os].map(e => nk(show(e)));
  return os.every(v => v.id !== a.id && !VC.sharesSurface(v, a) && nk(v.en) !== nk(a.en) && !(f2(a.en) && f2(v.en) === f2(a.en)) &&
    (FW.has(a.id) || !FW.has(v.id)) && !VC.pronClash(v, a) && !VC.isSyn(v, a)) && new Set(labels).size === labels.length &&
    os.every((v, i) => os.every((x, j) => i === j || !VC.pronClash(v, x)));
};
const meaningGuard = (a, os) => os.every(v => v.id !== a.id && nk(v.en) !== nk(a.en) && !VC.sharesSurface(v, a) && !VC.samePron(v, a) && !VC.isSyn(v, a)) &&
  new Set(os.map(v => nk(v.en))).size === os.length;
// Each builder: answer kind, stage family of its options, run(answer, prog, stage fns, mix, pool filter), guard.
const BUILDERS = [
  { name: "meaningOpts", kind: "word", fam: "word", run: (a, p, P, mix, keep) => VC.meaningOpts(a, WORDS.filter(keep), mix), guard: () => meaningGuard },
  { name: "wordOpts", kind: "word", fam: "word", run: (a, p, P, mix, keep) => VC.wordOpts(a, WORDS.filter(keep), e => VC.displayForm(e, CHARACTERS, p, PACK).text, PACK, null, mix),
    guard: p => wordGuard(e => VC.displayForm(e, CHARACTERS, p, PACK).text) },
  { name: "gapChoices", kind: "word", fam: "word", run: (a, p, P, mix, keep) => { const gc = VC.gapChoices(a, gapMatchOf(a), WORDS.filter(keep), PACK, null, mix); return gc.opts.slice(1).map(l => gc.byLabel[l]); },
    guard: () => wordGuard(e => e.w) },
  { name: "sentenceOpts", kind: "sent", fam: "sent", run: (a, p, P, mix, keep) => VC.sentenceOpts(a, SENTENCES.filter(keep), mix),
    guard: () => (a, os) => os.every(s => s.id !== a.id && nk(s.en) !== nk(a.en)) && new Set(os.map(s => nk(s.en))).size === os.length },
  { name: "charOpts", kind: "unit", fam: "unit", run: (a, p, P, mix, keep) => VC.charOpts(a, CHARACTERS.filter(keep), BY_ID, mix),
    guard: () => (u, os) => { const aw = VC.unitWord(u, BY_ID); return os.every(v => { const vw = VC.unitWord(v, BY_ID); return v.id !== u.id && nk(v.t) !== nk(u.t) && nk(VC.unitGloss(v, BY_ID)) !== nk(VC.unitGloss(u, BY_ID)) &&
      nk(VC.unitReading(v, BY_ID)) !== nk(VC.unitReading(u, BY_ID)) && !(aw && vw && (VC.samePron(aw, vw) || VC.isSyn(aw, vw))); }) && new Set(os.map(v => nk(v.t))).size === os.length && new Set(os.map(v => nk(VC.unitGloss(v, BY_ID)))).size === os.length; } },
  { name: "charSoundOpts", kind: "unit", fam: "unit", strings: "read", run: (a, p, P, mix, keep) => VC.charSoundOpts(a, CHARACTERS.filter(keep), BY_ID, mix),
    guard: () => (u, rs) => rs.every(r => nk(r) && nk(r) !== nk(VC.unitReading(u, BY_ID))) && new Set(rs.map(nk)).size === rs.length },
  { name: "charReadOpts", kind: "unit", fam: "word", wordOfUnit: true, run: (a, p, P, mix, keep) => VC.charReadOpts(a, WORDS.filter(keep), BY_ID, mix), guard: () => (u, os) => meaningGuard(VC.unitWord(u, BY_ID), os) },
  { name: "pronChoiceOpts", kind: "learnedWord", fam: "word", strings: "pron", memo: true, run: (a, p, P, mix, keep) => VC.pronChoiceOpts(a, P.lw.filter(keep), WORDS.filter(keep), mix),
    guard: () => (a, rs) => rs.every(r => VC.pronKey(r) && VC.pronKey(r) !== VC.pronKey(a.pron)) && new Set(rs.map(VC.pronKey)).size === rs.length },
];
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "-";
const mean = (s, n) => n ? (s / n).toFixed(3) : "-";
const lenOutlier = (a, os) => { const L = String(a.en).length || 1; return os.length === 3 && os.every(s => { const q = String(s.en).length / L; return q >= 1.8 || q <= 1 / 1.8; }); };

(async function main(){
  // fresh: nothing learned, the first set being taught; reported, not held to the bound.
  const SHAPES = [["fresh, first set", 0, false], ["30 learned", 30, false], ["140/150 of HSK 1", 140, true], ["HSK 1-3 (owner)", 595, true], ["all learned", WORDS.length, true]];
  const N = 2000;
  console.log("\n[1] core builders: guess success of a learner ruling out never-taught options and options of another stage, before (level tiers) vs after (optsMix)");
  check(`zh ships optsMix; the flag reads true only (PACK_OFF: off)`, VC.optsMixOn(PACK) && !VC.optsMixOn(PACK_OFF) && !VC.optsMixOn({ optsMix: 1 }));
  const agg = new Map(BUILDERS.map(b => [b.name, { cells: 0, held: 0, bad: [], guardBad: 0, short: 0, leak: 0, leakN: 0 }]));
  const rows = [];
  let sentOut = { b: 0, a: 0, n: 0 }, ownerLeak = null;
  for(const [sname, n, held] of SHAPES){
    const p = shape(n), snap = JSON.stringify(p);
    for(const which of ["new", "known"]){
      for(const b of BUILDERS){
        if(n === 0 && b.kind !== "word") continue;
        const { as, learnW, learnU } = answersFor(b.kind, which, p);
        const A = agg.get(b.name);
        if(!as.length){ rows.push(`${sname} | ${which} | ${b.name} | no answers`); continue; }
        A.cells++;
        const P = stages(p, learnW, learnU), fam = P[b.fam], guard = b.guard(p);
        const ansStage = a => { const s = b.wordOfUnit ? P.word(VC.unitWord(a, BY_ID)) : b.fam === "unit" ? P.unit(a) : b.fam === "sent" ? P.sent(a) : P.word(a); return s === 1 ? 1 : 0; };
        // Options of the answer's stage only (the answer kept): can that stage supply 3 after guards?
        const sup = new Map(), supply = a => { if(!sup.has(a)){ const s = ansStage(a), keep = x => x === a || (b.wordOfUnit ? x === VC.unitWord(a, BY_ID) : false) || fam(x) === s; sup.set(a, b.run(a, p, P, { stage: fam }, keep).length); } return sup.get(a); };
        const memoM = new Map(), memo = (a, f) => { if(!memoM.has(a)) memoM.set(a, f()); return memoM.get(a); };
        // Guess: 1 / (answer + options the learner cannot rule out).
        const guess = (a, os) => { const s = ansStage(a); return 1 / (1 + os.filter(o => labelItems(b, o).some(x => fam(x) === s)).length); };
        Math.random = mulberry32(n * 31 + (which === "new" ? 1 : 2) * 7 + BUILDERS.indexOf(b));
        const st = { cards: 0, el: 0, bG: 0, aG: 0, nel: 0, bGn: 0, aGn: 0, leak: 0, leakB: 0, leakN: 0 };
        for(let i = 0; i < N; i++){
          const a = as[i % as.length], all = () => true;
          const before = b.memo ? memo(a, () => b.run(a, p, P, undefined, all)) : b.run(a, p, P, undefined, all);
          const after = b.run(a, p, P, { stage: fam }, all);
          st.cards++;
          if(!guard(a, after)) A.guardBad++;
          if(before.length === 3 && after.length < 3) A.short++;
          if(b.name === "sentenceOpts" && n === 595){ sentOut.n++; if(lenOutlier(a, before)) sentOut.b++; if(lenOutlier(a, after)) sentOut.a++; }
          const gb = guess(a, before), ga = guess(a, after);
          if(supply(a) >= 3){ st.el++; st.bG += gb; st.aG += ga;
            // The owner's leak: a new answer whose wrong choices are all known.
            if(ansStage(a) === 0 && !b.strings){ const allKnown = os => os.length === 3 && os.every(o => fam(o) === 1); A.leakN++; st.leakN++; if(allKnown(after)) { A.leak++; st.leak++; } if(allKnown(before)) st.leakB++; }
          } else { st.nel++; st.bGn += gb; st.aGn += ga; }
        }
        if(held && st.el && st.aG / st.el > 0.27) A.bad.push(`${sname}/${which}: ${mean(st.aG, st.el)}`);
        if(held) A.held++;
        if(sname.startsWith("140") && which === "new" && b.name === "meaningOpts") ownerLeak = st;
        rows.push(`${sname} | ${which} (${as.length}) | ${b.name} | ${st.cards} | ${st.el} | ${mean(st.bG, st.el)} -> ${mean(st.aG, st.el)} | ${st.nel ? `${st.nel}: ${mean(st.bGn, st.nel)} -> ${mean(st.aGn, st.nel)}` : "-"} | ${st.leakN ? `${pct(st.leakB, st.leakN)} -> ${pct(st.leak, st.leakN)}` : "-"}`);
      }
    }
    check(`${sname}: building option sets leaves the progress untouched`, JSON.stringify(p) === snap);
  }
  if(TABLE){
    console.log("TABLE shape | answer (pool) | builder | cards | cards whose stage supplies 3 | guess before -> after there | other cards: n: guess before -> after | new answer, all wrong choices known: before -> after");
    rows.forEach(r => console.log(`TABLE ${r}`));
  }
  check(`the owner's leak: 140/150 of HSK 1, a new word's meaning options all known in ${ownerLeak ? pct(ownerLeak.leakB, ownerLeak.leakN) : "-"} of cards before, ${ownerLeak ? pct(ownerLeak.leak, ownerLeak.leakN) : "-"} after`,
    !!ownerLeak && ownerLeak.leakB / ownerLeak.leakN > 0.5 && ownerLeak.leak === 0);
  for(const b of BUILDERS){
    const A = agg.get(b.name);
    check(`${b.name}: guess success <= 0.27 wherever the answer's stage supplies 3 (140 of HSK 1, owner, all learned x new / known: ${A.held} cells${A.bad.length ? "; over: " + A.bad.join(", ") : ""})`, A.held >= 4 && A.bad.length === 0);
    check(`${b.name}: every old guard holds on every set (${A.guardBad} bad); never fewer than 3 options where the tiers had 3 (${A.short})${b.strings ? "" : `; new/weak answer with all wrong choices known: ${A.leak} of ${A.leakN} cards where 3 new/weak exist`}`,
      A.guardBad === 0 && A.short === 0 && A.leak === 0);
  }
  check(`sentenceOpts length outliers (every other option >= 1.8x longer or shorter), owner shape: ${pct(sentOut.b, sentOut.n)} before, ${pct(sentOut.a, sentOut.n)} after (not above)`, sentOut.n > 0 && sentOut.a <= sentOut.b);

  console.log("\n[2] app: every site by stage, a Learn drill, one script per set, placement as flag off, nothing written, answer position uniform");
  {
    const r = mulberry32(99);
    const p0 = shape(595, 0.7, () => Math.floor(r() * 7)); // mixed unit tiers: pron / ruby / bare
    const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(p0));
    const api = await boot(PACK, st, 5);
    const prog = api.getProg();
    const lsSnap = () => JSON.stringify(st.ls.keys().sort().map(k => [k, st.ls.getItem(k)])) + JSON.stringify(st.ss.keys().sort().map(k => [k, st.ss.getItem(k)]));
    const snap0 = lsSnap(), prog0 = JSON.stringify(prog);
    Math.random = mulberry32(17);
    const pick = (list, k) => { const out = []; for(let i = 0; i < k; i++) out.push(list[Math.floor(Math.random() * list.length)]); return out; };
    const P0 = stages(prog);
    const nextSet = ORDER_W.filter(w => P0.word(w) === 2).slice(0, 10), learnW = new Set(nextSet.map(w => w.id));
    const learnU = new Set(ORDER_W.filter(w => P0.word(w) !== 2).map(w => UNIT_OF.get(w.id)).filter(u => u && !VC.charRecs(prog)[u.id]).slice(0, 10).map(u => u.id));
    const P = stages(prog, learnW, learnU);
    const known = ORDER_W.filter(w => P.word(w) === 1), weak = ORDER_W.filter(w => P.word(w) === 0 && !learnW.has(w.id));
    const site = () => ({ sets: 0, g: 0, amb: 0 });
    const S = {};
    const tally = (k, aStage, labels, items, fam) => { const s = S[k] = S[k] || site(); s.sets++; s.g += 1 / (1 + labels.filter(l => items(l).some(x => fam(x) === aStage)).length); };
    const one = x => [x];
    let sets1 = 0, odd = 0, opMixed = 0; const oddEx = [];
    const scriptCheck = (it, ws) => {
      sets1++;
      const kinds = it.opts.map((o, i) => { const h = String(it.optHtml(o)), lab = stripTags(h.split('<span class="op"')[0]), e = ws[i]; return lab === e.pron ? "P" : lab === e.w ? "W" : "?"; });
      if(new Set(kinds).size !== 1 || kinds[0] === "?"){ odd++; if(oddEx.length < 3) oddEx.push(kinds.join("")); }
      if(ws.some(e => P.word(e) === 2) && it.opts.some(o => /class="op"/.test(String(it.optHtml(o))))) opMixed++;
    };
    const ws4 = it => it.opts.map(id => BY_ID[id]);
    const wordSites = (w, inLearn) => {
      const aS = inLearn ? 0 : P.word(w) === 1 ? 1 : 0, tag = inLearn ? "new" : aS ? "known" : "weak";
      const rd = api.readItem(w); tally(`read ${tag}`, aS, rd.opts.slice(1), g => BY_GLOSS.get(g) || [], P.word);
      const rc = api.recallItem(w);
      if(rc.label === "Which word is this?"){ tally(`recall ${tag}`, aS, rc.opts.slice(1), id => [BY_ID[id]], P.word); scriptCheck(rc, ws4(rc)); }
      if(!inLearn){
        const ht = api.writtenPronTypeItem(w).choiceFallback();
        if(ht.label === "How is it said?") tally(`howSaid ${tag}`, aS, ht.opts.slice(1), x => BY_PRON.get(x) || [], P.word);
        const mt = api.meaningTypeItem(w).choiceFallback(); tally(`meaningTyped ${tag}`, aS, mt.opts.slice(1), g => BY_GLOSS.get(g) || [], P.word);
      }
    };
    api.withLearn([...learnW], () => nextSet.forEach(w => { for(let i = 0; i < 20; i++) wordSites(w, true); }));
    pick(known, 200).forEach(w => wordSites(w, false));
    pick(weak, 100).forEach(w => wordSites(w, false));
    const sents = SENTENCES.filter(s => P.sent(s) !== 2);
    for(const s of pick(sents, 400)){
      const aS = P.sent(s);
      const rs = api.readSentence(s); tally(`sentence ${aS ? "seen" : "unseen"}`, aS, rs.opts.slice(1), en => BY_EN.get(en) || [], P.sent);
      const g = api.gapSentence(s);
      if(g && g.kind === "mc"){ const ws = g.opts.map(l => (BY_W.get(l) || [])[0]); const a = ws[0]; if(ws.every(Boolean)){ tally(`gap ${P.word(a) === 1 ? "known" : "weak"}`, P.word(a) === 1 ? 1 : 0, ws.slice(1), one, P.word); scriptCheck(g, ws); } }
    }
    const taught = CHARACTERS.filter(u => P.unit(u) !== 2 && !learnU.has(u.id));
    const charSites = (u, inLearn) => {
      const aS = inLearn ? 0 : P.unit(u) === 1 ? 1 : 0, tag = inLearn ? "new" : aS ? "known" : "weak", wS = P.word(VC.unitWord(u, BY_ID)) === 1 ? 1 : 0;
      for(const kind of ["charRead", "charSound", "charPick", "charRecall"]){
        const it = api.charDrillItem(kind, u), others = it.opts.filter(o => o !== it.a);
        if(kind === "charRead") tally(`charRead ${wS ? "known" : "weak"} word`, wS, others, g => BY_GLOSS.get(g) || [], P.word);
        else if(kind === "charSound") tally(`charSound ${tag}`, aS, others, x => BY_READ.get(nk(x)) || [], P.unit);
        else tally(`${kind} ${tag}`, aS, others, t => BY_T.get(t) || [], P.unit);
      }
    };
    api.withLearn([...learnU], () => CHARACTERS.filter(u => learnU.has(u.id)).forEach(u => { for(let i = 0; i < 20; i++) charSites(u, true); }));
    pick(taught, 300).forEach(u => charSites(u, false));
    const lines = Object.keys(S).sort().map(k => `${k} ${mean(S[k].g, S[k].sets)} (${S[k].sets})`);
    console.log("NOTE  guess success per site and answer stage: " + lines.join(", "));
    // Recall and cloze included: pack.optsOneScript ranks ahead of the stage, and the stage still holds.
    const over = Object.keys(S).filter(k => S[k].g / S[k].sets > 0.27);
    check(`every site and answer stage on the owner's shape (mixed unit tiers, Learn sets named): guess success <= 0.27 (${Object.keys(S).length} site x stage cells${over.length ? "; over: " + over.join(", ") : ""})`, over.length === 0);
    check(`one script per option set over ${sets1} recall + gap sets on a mixed-tier seed (${odd} odd${oddEx.length ? ": " + oddEx.join(", ") : ""}); no reading beside any option in a set holding a never-taught word (${opMixed})`, sets1 >= 300 && odd === 0 && opMixed === 0);
    check(`building ${sets1 + 2000} items' options wrote nothing: storage and progress (day log included) unchanged`, lsSnap() === snap0 && JSON.stringify(api.getProg()) === prog0);
    const pos = [0, 0, 0, 0]; let shown = 0;
    for(const w of pick(ORDER_W, 1200)){
      const it = api.recallItem(w); if(it.opts.length !== 4) continue;
      api.drill1(it); const kids = api.el("o").children; const i = kids.findIndex(b => b.dataset.v === String(it.a)); if(i >= 0){ pos[i]++; shown++; }
    }
    check(`answer position uniform over ${shown} rendered sets: ${pos.map(x => pct(x, shown)).join(" ")}`, shown >= 1000 && pos.every(x => Math.abs(x / shown - 0.25) < 0.04));
  }
  {
    // A real Today Learn drill (units of the learned words all taught, so Learn teaches words).
    const p0 = shape(140, 1);
    const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(p0));
    NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
    const api = await boot(PACK, st, 3);
    const before = new Set(Object.keys(api.getProg().w)); const sets = [];
    api.today();
    play(api, (pr, h) => { const it = api.getCur(); if(it && it.kind === "mc" && api.getD() && !sets.includes(it)) sets.push(it); return false; });
    const after = api.getProg(), learnSet = new Set(Object.keys(after.w).filter(id => !before.has(id)));
    let n = 0, never = 0, known = 0;
    for(const it of sets){
      const id = String(it.key).slice(2); if(!String(it.key).startsWith("w:") || !learnSet.has(id)) continue;
      const others = it.opts.filter(o => o !== it.a).map(o => BY_ID[o] || (BY_GLOSS.get(o) || [])[0]).filter(Boolean);
      n++; if(others.some(v => !before.has(v.id) && !learnSet.has(v.id))) never++; if(others.length === 3 && others.every(v => before.has(v.id) && (p0.w[v.id].s || 0) >= VC.WORD_MASTERED)) known++;
    }
    check(`Today Learn drill (140 of HSK 1, ${learnSet.size} words taught): ${n} sets on Learn words, ${never} with a never-taught option, ${known} with every option known`, learnSet.size === 10 && n >= 10 && never === 0 && known === 0);
  }
  {
    const shots = [];
    for(const pack of [PACK, PACK_OFF]){
      const st = fresh(); st.ls.setItem(VC.storageKey(pack), JSON.stringify(shape(140)));
      const api = await boot(pack, st, 21); api.goto("test"); api.startPlacement(); const seen = [];
      for(let i = 0; i < 30 && api.el("o"); i++){ seen.push(api.panel()); const b = api.el("o").children[0]; if(!b) break; b.click(); }
      shots.push(seen.join("\n"));
    }
    check(`placement options exactly as with the flag off (same seed, 30 screens, ${shots[0].length} chars)`, shots[0].length > 1000 && shots[0] === shots[1]);
  }

  console.log(`\n[3] flag off: byte-identical to ${BASE}`);
  if(!OLD || !OLD_HTML) console.log(`NOTE  ${BASE} not in this checkout's history: control skipped`);
  else {
    for(const [sname, n] of [["30 learned", 30], ["HSK 1-3", 595]]){
      const p = shape(n), P = stages(p), outs = [];
      for(const V of [VC, OLD]){
        Math.random = mulberry32(n + 3); const o = [];
        for(const w of ORDER_W.slice(0, 300)){
          o.push(V.meaningOpts(w, WORDS).map(v => v.id), V.wordOpts(w, WORDS, e => V.displayForm(e, CHARACTERS, p, PACK_OFF).text, PACK_OFF, null).map(v => v.id),
            V.gapChoices(w, gapMatchOf(w), WORDS, PACK_OFF, null).opts, V.pronChoiceOpts(w, P.lw, WORDS));
          const u = UNIT_OF.get(w.id); if(u) ["charRead", "charSound", "charPick", "charRecall"].forEach(k => o.push(V.charItem(k, u, { units: CHARACTERS, words: WORDS, byId: BY_ID }).options));
        }
        SENTENCES.slice(0, 300).forEach(s => o.push(V.sentenceOpts(s, SENTENCES).map(x => x.id)));
        o.push(Math.random());
        outs.push(JSON.stringify(o));
      }
      check(`core, ${sname}: 300 words x 8 builders + 300 sentences without mix, results and the draw after them identical to ${BASE}`, outs[0] === outs[1]);
    }
    for(const [name, p] of [["fresh", null], ["HSK 1-3", shape(595)]]){
      const out = [];
      for(const [core, html] of [[VC, appHtml], [OLD, OLD_HTML]]){
        const st = fresh(); if(p) st.ls.setItem(VC.storageKey(PACK_OFF), JSON.stringify(p));
        NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
        const api = await boot(PACK_OFF, st, 11, { core, html });
        const items = ORDER_W.slice(0, 120).flatMap(w => [api.readItem(w).opts, api.recallItem(w).opts, api.writtenPronTypeItem(w).choiceFallback().opts]);
        SENTENCES.slice(0, 60).forEach(s => { items.push(api.readSentence(s).opts); const g = api.gapSentence(s); if(g) items.push(g.opts); });
        CHARACTERS.slice(0, 60).forEach(u => ["charRead", "charSound", "charPick", "charRecall"].forEach(k => items.push(api.charDrillItem(k, u).opts)));
        api.today(); const t = api.panel(); play(api);
        out.push({ items: JSON.stringify(items), t, end: api.panel(), prog: st.ls.getItem(VC.storageKey(PACK_OFF)) });
      }
      check(`app on PACK minus optsMix, ${name}: ${out[0].items.length} chars of options, Today, a whole session and its progress byte-identical to ${BASE}`,
        out[0].items === out[1].items && out[0].t === out[1].t && out[0].end === out[1].end && out[0].prog === out[1].prog);
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

function play(api, stop){
  if(!api.getD() && /id="go"/.test(api.panel())) api.el("go").click(); let guard = 0;
  while(guard++ < 900 && !(stop && stop(api.getProg(), api.panel()))){ const D = api.getD(); const h = api.panel();
    if(D && api.getCur() && D.cur){ answer(api, true); api.el("nx").click(); continue; }
    if(/id="again"/.test(h)){ api.el("again").click(); return true; }
    if(api.rd()){ api.skipRead(); continue; }
    const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; }
    const g = (h.match(/<button class="ghost" id="(\w+)"/) || [])[1]; if(g){ api.el(g).click(); continue; } return false; }
  return false;
}
