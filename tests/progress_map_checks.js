// pack.progressMap (docs/PACK_SCHEMA.md "progressMap"; owner 2026-10-04: the learner feels no progress):
// [1] progressPosition formula (with/without characters and passages), [2] prog.pm history (append,
// replace by sn, cap 14, flag off writes nothing), [3] sessionsToGo (none / 14 / flat / negative / positive),
// [4] Today row text under the flag, [5] a session writes pm; flag off: Today and the progress record
// byte-identical to main a2f2426.
// Run: node tests/progress_map_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "a2f2426"; // main before progressMap
// Progress characters rows are a per-level block since fb6-charrows (lag_checks [5] pins them); the rest of Progress still matches MAIN.
const CHAR_ROWS = /<tr><td><bdi[^>]*>字[^<]*<\/bdi>[^<]*<\/td><td>[^<]*<\/td><\/tr>|<p class="q" style="margin-top:14px">Characters<\/p><table class="stats nw">[\s\S]*?<\/table>/g;
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const OFF = (p => { const q = Object.assign({}, p); delete q.progressMap; return q; })(PACK);
const eq = util.isDeepStrictEqual;
const clone = x => JSON.parse(JSON.stringify(x));

let fails = 0, passes = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}

// ------------------------------------------------------------------ fake DOM (copied from session_resume_checks.js)
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
const __drills = []; const __dr = drill; drill = function(items, ...a){ __drills.push({ step: todayStepState ? todayStepState.at : null, n: items.length }); return __dr(items, ...a); };
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
  step: () => todayStepState && todayStepState.at, drills: __drills, store: () => store, quit: () => quitDrill(),
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"TypedMasteryChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, o.passages || PASSAGES, CHARACTERS];
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

const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
const ORDER = VC.charStageUnits(VC.levelIds(PACK), CHARACTERS, PACK);
const LEARN_KINDS = VC.charsConfig(PACK).learnKinds.length;
const base = extra => VC.normalizeProg(Object.assign({ placedOnce: true, soundsOpened: true, sessions: 10 }, extra || {}), PACK);
const learn = (p, list, s) => list.forEach((w, i) => { p.w[w.id] = { r: 3, w: i % 3 ? 0 : 1, s: s != null ? s : i % 5 }; });
const teach = (p, units) => units.forEach((u, i) => { p.chars.c[u.id] = { r: 3, w: i % 4 ? 0 : 1, s: i % 7 }; });
// Learned words, taught units: the 30 first HSK 1 words, 25 units (lag 5: Learn teaches words).
function midProg(){ const p = base({ sets: { "1": 3 } }); learn(p, byLv["1"].slice(0, 30)); teach(p, ORDER.slice(0, 25)); return p; }
// HSK 1-3 learned, HSK 4 not, 250 units taught (lag 345: Learn teaches characters), two HSK 1
// passages read long ago with misses (due re-reads).
function ownerProg(){
  const p = base({ sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": 0 }, sessions: 60 });
  ["1", "2", "3"].forEach(lv => learn(p, byLv[lv]));
  teach(p, ORDER.slice(0, 250));
  p.read = { done: {} }; PASSAGES.filter(x => x.lv === "1").slice(0, 2).forEach(x => { p.read.done[x.id] = { sc: 1, n: 4, d: "2026-09-01", x: 1 }; });
  return p;
}
function allProg(){
  const p = base({ sets: Object.fromEntries(VC.levelIds(PACK).map(lv => [lv, NS(lv)])) });
  VC.levelIds(PACK).forEach(lv => learn(p, byLv[lv])); teach(p, ORDER); return p;
}
const SCEN = [["fresh", () => base()], ["mid HSK 1", midProg], ["owner shape", ownerProg], ["all learned", allProg]];
// What the Learn step would drill (core only): a words set (hear + read with a voice) or a characters set.
function learnItems(p){
  const st = VC.nextStage(PACK, WORDS, CHARACTERS, p); if(!st) return 0;
  return st.kind === "chars" ? VC.lagCharSet(PACK, WORDS, CHARACTERS, p).units.length * LEARN_KINDS : VC.levelNewSet(WORDS, PACK, p, st.lv).words.length * 2;
}
function nextLearn(p){ const st = VC.nextStage(PACK, WORDS, CHARACTERS, p); return !st ? null : st.kind === "chars" ? "c:" + VC.lagCharSet(PACK, WORDS, CHARACTERS, p).ids.join(",") : "w:" + VC.levelNewSet(WORDS, PACK, p, st.lv).words.map(w => w.id).join(","); }
const rows = h => [...String(h).matchAll(/<tr><td>(\d+)\. (\w+)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map(m => [m[2], stripTags(m[3])]);
const reviewN = h => { const r = rows(h).find(x => x[0] === "Review"); const m = r && r[1].match(/^(\d+) items/); return m ? +m[1] : null; };
const keysOf = p => ({ w: new Set(Object.keys(p.w)), c: new Set(Object.keys((p.chars || {}).c || {})) });
// Plays the Today session on screen to its end (every answer right; passages skipped).
// The Read stage is played for real: every question answered with the first option, opts.tap word
// ids added to the tapped list, then Continue (weak words as ticked by default).
function playRead(api, tap){
  const rd = api.rd(); (tap || []).forEach(id => rd.tapped.push(id));
  if(/id="rdone"/.test(api.panel())) api.el("rdone").click();
  for(let i = 0; i < 40 && api.rd() && !/id="rcont"/.test(api.panel()); i++){ api.el("o").children[0].click(); api.el("nx").click(); }
  const weak = (api.panel().match(/<label class="wk"[\s\S]*?<\/label>/g) || []), html = api.panel();
  api.el("rcont").click();
  return { weak, html };
}
function playSession(api, tap){
  if(!/id="go"/.test(api.panel())) return null;
  const k0 = keysOf(api.getProg()), done0 = new Set(Object.keys((api.getProg().read || {}).done || {})), d0 = api.drills.length;
  const out = { items: 0, firstReads: 0, rereads: 0 };
  api.el("go").click();
  for(let guard = 0; guard < 3000; guard++){
    const D = api.getD(), h = api.panel();
    if(D && api.getCur() && D.cur){ out.items++; answer(api, true); api.el("nx").click(); continue; }
    if(/id="again"/.test(h)){ api.el("again").click(); break; }
    const rd = api.rd(); if(rd){ if(done0.has(rd.p.id)) out.rereads++; else out.firstReads++; out.read = playRead(api, tap && tap(rd.p)); continue; }
    const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; }
    throw new Error("stuck: " + h.slice(0, 200));
  }
  const k1 = keysOf(api.getProg()), dr = api.drills.slice(d0);
  out.newW = [...k1.w].filter(k => !k0.w.has(k)).length; out.newC = [...k1.c].filter(k => !k0.c.has(k)).length;
  out.review = (dr.find(d => d.step === 0) || {}).n || 0; out.learn = dr.filter(d => d.step === 1).length;
  return out;
}

const NOCH = (p => { const q = clone(p); delete q.characters; return q; })(PACK);
const bareOf = lvUnits => lvUnits.forEach(u => { u.s = VC.charsConfig(PACK).bare; });
const pm14 = (p0, step, sn0) => Array.from({ length: 14 }, (_, i) => ({ sn: (sn0 || 20) + i, p: Math.round((p0 + step * i) * 1000) / 1000 }));
const pmRow = h => { const m = String(h).match(/<div class="pmap"[\s\S]*?<\/div><div class="pm2">[\s\S]*?<\/div><\/div>/); return m ? m[0] : null; };

(async function main(){
  console.log("\n[1] progressPosition");
  {
    check("packs/zh sets progressMap: true", PACK.progressMap === true && VC.progressMapOn(PACK) && !VC.progressMapOn(OFF));
    const nd = Object.assign(clone(PACK), { dayAware: false });
    check("progressMapOn needs dayAware", !VC.progressMapOn(nd));
    const p = base(); const pos = (pr, pk, u, ps) => VC.progressPosition(pr, pk || PACK, WORDS, u === undefined ? CHARACTERS : u, ps === undefined ? PASSAGES : ps);
    check("nothing known: 0", pos(p) === 0);
    const half = base(); WORDS.slice(0, WORDS.length / 2 | 0).forEach(w => { half.w[w.id] = { r: 3, w: 0, s: 3 }; });
    const hk = (WORDS.length / 2 | 0) / WORDS.length;
    check(`half the words known, no units/passages: 0.5 x ${hk.toFixed(3)}`, Math.abs(pos(half) - 0.5 * hk) < 1e-12);
    check("words at streak 2 (held) are not known", pos(Object.assign(base(), { w: Object.fromEntries(WORDS.map(w => [w.id, { r: 3, w: 0, s: 2 }])) })) === 0);
    const all = allProg(); all.read = { done: Object.fromEntries(PASSAGES.map(x => [x.id, { sc: 4, n: 4, d: "2026-10-01", x: 1, l: 1 }])) };
    WORDS.forEach(w => { all.w[w.id] = { r: 5, w: 0, s: 4 }; }); CHARACTERS.forEach(u => { all.chars.c[u.id] = { r: 9, w: 0, s: VC.charsConfig(PACK).bare }; });
    check("everything known, bare and listened: 1", pos(all) === 1);
    const w = base(); WORDS.forEach(x => { w.w[x.id] = { r: 5, w: 0, s: 4 }; });
    check("all words only (units and passages present): 0.5", Math.abs(pos(w) - 0.5) < 1e-12);
    const u = base(); CHARACTERS.forEach(x => { u.chars.c[x.id] = { r: 9, w: 0, s: VC.charsConfig(PACK).bare }; }); CHARACTERS.forEach(x => { u.chars.c[x.id].s = VC.charsConfig(PACK).bare - 1; });
    check("units at the ruby tier are not bare: 0", pos(u) === 0);
    const r = base(); r.read = { done: Object.fromEntries(PASSAGES.map((x, i) => [x.id, i % 2 ? { sc: 4, n: 4, d: "2026-10-01", x: 1, l: 1 } : { sc: 4, n: 4, d: "2026-10-01", x: 1 }])) };
    const lis = PASSAGES.filter((x, i) => i % 2).length / PASSAGES.length;
    check(`passages count only when listened (${(lis * 100).toFixed(1)}%): 0.25 x share`, Math.abs(pos(r) - 0.25 * lis) < 1e-12);
    check("no characters: the units weight goes to words (all words known = 0.75 with passages, 1 without)", Math.abs(pos(w, NOCH, []) - 0.75) < 1e-12 && pos(w, NOCH, [], []) === 1);
    check("no passages: the passages weight goes to words (all words known = 0.75)", Math.abs(pos(w, PACK, CHARACTERS, []) - 0.75) < 1e-12);
    check("no words: 0, never NaN", VC.progressPosition(base(), PACK, [], [], []) === 0);
    check("pure: the record is not touched", (() => { const q = clone(all); VC.progressPosition(q, PACK, WORDS, CHARACTERS, PASSAGES); return eq(q, all); })());
  }

  console.log("\n[2] history prog.pm");
  {
    const p = allProg(); p.sn = 5;
    check("flag off: nothing written", VC.recordProgressMap(p, OFF, WORDS, CHARACTERS, PASSAGES) === false && !("pm" in p));
    check("flag on: one { sn, p } entry, p to 3 decimals", VC.recordProgressMap(p, PACK, WORDS, CHARACTERS, PASSAGES) && p.pm.length === 1 && eq(Object.keys(p.pm[0]), ["sn", "p"]) && p.pm[0].sn === 5 && p.pm[0].p === Math.round(p.pm[0].p * 1000) / 1000);
    VC.recordProgressMap(p, PACK, WORDS, CHARACTERS, PASSAGES);
    check("same sn replaces, no duplicate", p.pm.length === 1);
    for(let i = 6; i <= 25; i++){ p.sn = i; VC.recordProgressMap(p, PACK, WORDS, CHARACTERS, PASSAGES); }
    check(`capped at 14 (sn ${p.pm[0].sn}..${p.pm[13].sn})`, p.pm.length === 14 && p.pm[0].sn === 12 && p.pm[13].sn === 25);
    check("validateProgShape accepts pm; a malformed pm is rejected", VC.validateProgShape(p, Object.keys(p.sets)).ok && !VC.validateProgShape(Object.assign(clone(p), { pm: [{ sn: "1", p: 0 }] }), Object.keys(p.sets)).ok && !VC.validateProgShape(Object.assign(clone(p), { pm: {} }), Object.keys(p.sets)).ok);
  }

  console.log("\n[3] sessionsToGo");
  {
    const g = pm => VC.sessionsToGo({ pm });
    check("no pm / fewer than 14 entries: null", g(undefined) === null && g([]) === null && g(pm14(0.1, 0.01).slice(0, 13)) === null);
    check("14 entries, positive pace (0.01 per session from 0.1): ceil(0.77 / 0.01) = 77", g(pm14(0.1, 0.01)) === 77);
    check("flat: null", g(pm14(0.3, 0)) === null);
    check("negative: null", g(pm14(0.3, -0.01)) === null);
    check("pace is per session number, not per entry: gaps of 2 sessions halve the rate", g(pm14(0.1, 0.01).map((e, i) => ({ sn: 20 + 2 * i, p: e.p }))) === 154);
    check("a faster pace gives fewer sessions", g(pm14(0.1, 0.02)) < g(pm14(0.1, 0.01)));
    check("same sn on both ends: null, not Infinity", g(pm14(0.1, 0.01).map(e => ({ sn: 5, p: e.p }))) === null);
    check("p 1 at positive pace: 0", g(pm14(0.87, 0.01)) === 0);
  }

  console.log("\n[4] Today row");
  {
    const mk = pm => { const p = midProg(); if(pm) p.pm = pm; return p; };
    for(const [label, pm] of [["no history", null], ["14 sessions", pm14(0.05, 0.01)], ["flat", pm14(0.2, 0)]]){
      const { api } = await bootWith(PACK, mk(pm), 1);
      const h = api.panel(), row = pmRow(h), pos = VC.progressPosition(api.getProg(), PACK, WORDS, CHARACTERS, PASSAGES), f = Math.round(10 * pos);
      const l1 = stripTags((row.match(/<div class="pm1">([\s\S]*?)<\/div>/) || [])[1] || ""), l2 = stripTags((row.match(/<div class="pm2">([\s\S]*?)<\/div>/) || [])[1] || "");
      const n = VC.sessionsToGo(api.getProg());
      check(`${label}: "${l1}" / "${l2}"`, l1 === `You ▸ [${"■".repeat(f)}${"□".repeat(10 - f)}] ▸ follow a drama without pausing` && l2 === (n == null ? "pace: — (after 14 sessions)" : `≈ ${n} sessions to go`));
      check(`${label}: above the plan rows, two lines, no wrap (${l1.length} chars), aria with percent`, h.indexOf('class="pmap"') < h.indexOf('<table class="stats steps">') && l1.length <= 52 && !/<br/.test(row) && new RegExp(`aria-label="${Math.round(pos * 100)}% of the way`).test(row));
    }
    const { api } = await bootWith(PACK, mk(null), 1);
    api.el("pmap").click();
    check("tap opens Progress", !/id="pmap"/.test(api.panel()) && /learned · \d+ mastered/.test(stripTags(api.panel())) && !/id="go"/.test(api.panel()));
    const off = await bootWith(OFF, mk(null), 1);
    check("flag off: no row", !/pmap|You ▸/.test(off.api.panel()));
  }

  console.log(`\n[5] a session writes pm; flag off: as on main ${MAIN}`);
  {
    const { api, st } = await bootWith(PACK, midProg(), 1);
    const sn0 = api.getProg().sn || 0; playSession(api);
    const pr = JSON.parse(st.ls.getItem(VC.storageKey(PACK)));
    check(`Session done appends { sn ${sn0 + 1}, p } (${JSON.stringify(pr.pm)})`, Array.isArray(pr.pm) && pr.pm.length === 1 && pr.pm[0].sn === sn0 + 1 && pr.pm[0].p === Math.round(VC.progressPosition(pr, PACK, WORDS, CHARACTERS, PASSAGES) * 1000) / 1000);
    playSession(api); const p2 = JSON.parse(st.ls.getItem(VC.storageKey(PACK)));
    check("a second session appends a second entry", p2.pm.length === 2 && p2.pm[1].sn === sn0 + 2);
    check("a stored pm survives reload and a re-save", (() => { const q = JSON.parse(st.ls.getItem(VC.storageKey(PACK))); const b = VC.bootProg(JSON.stringify(q), PACK); return b.backupRaw === null && eq(b.prog.pm, q.pm); })());
  }
  let OLD = null, MAIN_HTML = null;
  try {
    const os = require("os");
    MAIN_HTML = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-")), `core_${MAIN}.js`);
    fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); OLD = require(f);
  } catch(e){ OLD = null; }
  if(!OLD) console.log(`NOTE  engine ${MAIN} not in this checkout's history: control skipped`);
  else for(const [name, mk] of [["fresh", () => base()], ["mid HSK 1", midProg], ["owner shape", ownerProg]]){
    const out = [];
    for(const [core, html] of [[VC, appHtml], [OLD, MAIN_HTML]]){
      const stt = fresh(); stt.ls.setItem(VC.storageKey(OFF), JSON.stringify(mk()));
      NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
      const a = await boot(OFF, stt, 1, { core, html }); const t = a.panel(); a.goto("progress"); const g = a.html("panel");
      a.today(); const s = playSession(a);
      out.push({ t, g, s, prog: stt.ls.getItem(VC.storageKey(OFF)), after: a.panel() });
    }
    check(`${name}, flag off: Today, Progress, a whole session's progress record and the screen after it byte-identical to ${MAIN} (${out[0].t.length} chars, ${out[0].s ? out[0].s.items : 0} items)`,
      out[0].t === out[1].t && out[0].g === out[1].g && out[0].prog === out[1].prog && out[0].after === out[1].after && !/"pm"/.test(out[0].prog));
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
