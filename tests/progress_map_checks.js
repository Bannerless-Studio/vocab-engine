// pack.progressMap (docs/PACK_SCHEMA.md "progressMap"; owner 2026-10-04: the learner feels no progress):
// [1] progressPosition formula (with/without characters and passages), [2] prog.pm history (append,
// replace by sn, cap 14, flag off writes nothing), [3] sessionsToGo (none / 14 / flat / negative / positive),
// [4] Today row text under the flag, [5] a session writes pm (the flag-off control vs a2f2426 went with
// the flag collapse: it predates pairs).
// Run: node tests/progress_map_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
// the pack this suite was written against: as shipped just before pairs (9eb6ecb), the collapsed flags now engine default
const PAIRS_ERA = "9eb6ecb~1";
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "a2f2426"; // main before progressMap
// Progress characters rows are a per-level block since fb6-charrows (lag_checks [5] pins them); the rest of Progress still matches MAIN.
const CHAR_ROWS = /<tr><td><bdi[^>]*>字[^<]*<\/bdi>[^<]*<\/td><td>[^<]*<\/td><\/tr>|<p class="q" style="margin-top:14px">Characters<\/p><table class="stats nw">[\s\S]*?<\/table>/g;
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// fb27: the controls predate characters.start / ramp, so the pack is compared without them.
// glossStyle (fb32) changes every gloss the controls render; tests/gloss_display_checks.js covers it.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), PAIRS_ERA);
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
function clone0(x){ return JSON.parse(JSON.stringify(x)); }
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
// A goal-less progressMap: true (the whole-pack bar) is ignored since the flag collapse (stage 3): no progress map.
const LEG = Object.assign(clone0(PACK), { progressMap: true });
// fb21 changes optsMix picks (and stamps f), which the flag-off controls vs older shas do not measure: they run without it.
const OFF = packAsOf(PACK, MAIN);
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
function makeFakeDom(srcHtml){
  const H = srcHtml || appHtml; // an older sha's app.html registers its own ids
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
  const tabsMatch = H.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/);
  const btnRe = /<button([^>]*)>/g;
  let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
  registerIdsFromHtml(H.slice(H.indexOf("<body>"), H.indexOf("<nav")));
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
  const document = makeFakeDom(o.html);
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
// App v2 (engine default since the flag collapse): a goal-less progressMap keeps the bar line, the eta line only when there is one.
const etaOf = n => { if(!n) return ""; const r = n >= 100 ? Math.round(n / 10) * 10 : n; return r > 999 ? "≈\u00a0999+ sessions" : `≈\u00a0${r} session${r === 1 ? "" : "s"}`; }; // app.html etaText

(async function main(){
  console.log("\n[1] progressPosition");
  {
    check("packs/zh ships 3 goals (upTo 2, 3, 4); progressMap: true (no goals) is off since the flag collapse", eq(PACK.progressMap.goals.map(g => g.upTo), ["2", "3", "4"]) && VC.progressMapOn(PACK) && !VC.progressMapOn(LEG) && !VC.progressMapOn(OFF) && VC.progressMapGoals(LEG).length === 0);
    // "progressMapOn needs dayAware" deleted: dayAware is engine default since the flag collapse.
    const p = base(); const pos = (pr, pk, u, ps) => VC.progressPosition(pr, pk || LEG, WORDS, u === undefined ? CHARACTERS : u, ps === undefined ? PASSAGES : ps);
    check("nothing known: 0", pos(p) === 0);
    const half = base(); WORDS.slice(0, WORDS.length / 2 | 0).forEach(w => { half.w[w.id] = { r: 3, w: 0, s: 3 }; });
    const hk = (WORDS.length / 2 | 0) / WORDS.length;
    check(`half the words known, no units/passages: 0.5 x ${hk.toFixed(3)}`, Math.abs(pos(half) - 0.5 * hk) < 1e-12);
    // freqTiers (engine default since the flag collapse): a peripheral word (ft 2) is known at streak 2, a peripheral unit past the pron tier.
    const NONPERI = WORDS.filter(w => w.ft !== 2);
    check("words at streak 2 (held, core / ambient tiers) are not known", pos(Object.assign(base(), { w: Object.fromEntries(NONPERI.map(w => [w.id, { r: 3, w: 0, s: 2 }])) })) === 0);
    const all = allProg(); all.read = { done: Object.fromEntries(PASSAGES.map(x => [x.id, { sc: 4, n: 4, d: "2026-10-01", x: 1, l: 1 }])) };
    WORDS.forEach(w => { all.w[w.id] = { r: 5, w: 0, s: 4 }; }); CHARACTERS.forEach(u => { all.chars.c[u.id] = { r: 9, w: 0, s: VC.charsConfig(LEG).bare }; });
    check("everything known, bare and listened: 1", pos(all) === 1);
    const w = base(); WORDS.forEach(x => { w.w[x.id] = { r: 5, w: 0, s: 4 }; });
    check("all words only (units and passages present): 0.5", Math.abs(pos(w) - 0.5) < 1e-12);
    const u = base(); CHARACTERS.forEach(x => { u.chars.c[x.id] = { r: 9, w: 0, s: VC.charsConfig(LEG).bare }; }); CHARACTERS.forEach(x => { u.chars.c[x.id].s = VC.charsConfig(LEG).bare - 1; }); CHARACTERS.filter(x => x.ft === 2).forEach(x => { delete u.chars.c[x.id]; });
    check("units at the ruby tier are not bare (core / ambient tiers): 0", pos(u) === 0);
    const r = base(); r.read = { done: Object.fromEntries(PASSAGES.map((x, i) => [x.id, i % 2 ? { sc: 4, n: 4, d: "2026-10-01", x: 1, l: 1 } : { sc: 4, n: 4, d: "2026-10-01", x: 1 }])) };
    const lis = PASSAGES.filter((x, i) => i % 2).length / PASSAGES.length;
    check(`passages count only when listened (${(lis * 100).toFixed(1)}%): 0.25 x share`, Math.abs(pos(r) - 0.25 * lis) < 1e-12);
    check("no characters: the units weight goes to words (all words known = 0.75 with passages, 1 without)", Math.abs(pos(w, NOCH, []) - 0.75) < 1e-12 && pos(w, NOCH, [], []) === 1);
    check("no passages: the passages weight goes to words (all words known = 0.75)", Math.abs(pos(w, LEG, CHARACTERS, []) - 0.75) < 1e-12);
    check("no words: 0, never NaN", VC.progressPosition(base(), LEG, [], [], []) === 0);
    check("pure: the record is not touched", (() => { const q = clone(all); VC.progressPosition(q, LEG, WORDS, CHARACTERS, PASSAGES); return eq(q, all); })());
  }

  console.log("\n[2] history prog.pm");
  {
    const p = allProg(); p.sn = 5;
    check("flag off: nothing written", VC.recordProgressMap(p, OFF, WORDS, CHARACTERS, PASSAGES) === false && !("pm" in p));
    check("progressMap: true (no goals): nothing written", VC.recordProgressMap(p, LEG, WORDS, CHARACTERS, PASSAGES) === false && !("pm" in p));
    check("goals: one { sn, p, g } entry, p to 3 decimals", VC.recordProgressMap(p, PACK, WORDS, CHARACTERS, PASSAGES) && p.pm.length === 1 && eq(Object.keys(p.pm[0]), ["sn", "p", "g"]) && p.pm[0].sn === 5 && p.pm[0].p === Math.round(p.pm[0].p * 1000) / 1000);
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

  // [4] (the whole-pack Today bar of a goal-less progressMap: true) went with the flag collapse (stage 3); [10] covers the goal row.
  console.log("\n[4] Today row: none without goals");
  {
    const leg = await bootWith(LEG, midProg(), 1), off = await bootWith(OFF, midProg(), 1);
    check("progressMap: true (no goals) and no progressMap: no row on Today", !/id="pmap"|You ▸/.test(leg.api.panel()) && !/id="pmap"|You ▸/.test(off.api.panel()));
  }

  console.log("\n[5] a session writes pm");
  {
    const { api, st } = await bootWith(PACK, midProg(), 1);
    const sn0 = api.getProg().sn || 0; playSession(api);
    const pr = JSON.parse(st.ls.getItem(VC.storageKey(PACK))), cg = VC.currentGoal(pr, PACK, WORDS, CHARACTERS, PASSAGES);
    check(`Session done appends { sn ${sn0 + 1}, p, g } (${JSON.stringify(pr.pm)})`, Array.isArray(pr.pm) && pr.pm.length === 1 && pr.pm[0].sn === sn0 + 1 && pr.pm[0].g === cg.i && pr.pm[0].p === Math.round(cg.p * 1000) / 1000);
    playSession(api); const p2 = JSON.parse(st.ls.getItem(VC.storageKey(PACK)));
    check("a second session appends a second entry", p2.pm.length === 2 && p2.pm[1].sn === sn0 + 2);
    check("a stored pm survives reload and a re-save", (() => { const q = JSON.parse(st.ls.getItem(VC.storageKey(PACK))); const b = VC.bootProg(JSON.stringify(q), PACK); return b.backupRaw === null && eq(b.prog.pm, q.pm); })());
  }
  // flag-off control vs a2f2426 deleted: it predates pairs, engine default since the flag collapse.

  console.log("\n[6] goalPosition: 0.6 words + 0.2 mastered units + 0.2 listened passages, scoped to levels <= upTo");
  {
    const G = PACK.progressMap.goals, gp = (pr, i, u, ps, ws) => VC.goalPosition(pr, PACK, G[i], ws || WORDS, u === undefined ? CHARACTERS : u, ps === undefined ? PASSAGES : ps);
    const rng = (a, b) => k => { const x = VC.levelIds(PACK).indexOf(String(k)); return x >= a && x <= b; };
    const wIn = (a, b) => WORDS.filter(w => rng(a, b)(w.lv)), uIn = (a, b) => CHARACTERS.filter(u => rng(a, b)(u.lv)), pIn = (a, b) => PASSAGES.filter(x => rng(a, b)(x.lv));
    check("fresh: 0 for every goal", [0, 1, 2].every(i => gp(base(), i) === 0));
    const w12 = base(); wIn(0, 1).forEach(w => { w12.w[w.id] = { r: 3, w: 0, s: 3 }; });
    check("all HSK 1-2 words known: goal 1 = 0.6", Math.abs(gp(w12, 0) - 0.6) < 1e-12);
    check("same record: goal 2 = 0.6 x HSK 1-2 share of HSK 1-3, goal 3 likewise of all", Math.abs(gp(w12, 1) - 0.6 * wIn(0, 1).length / wIn(0, 2).length) < 1e-12 && Math.abs(gp(w12, 2) - 0.6 * wIn(0, 1).length / WORDS.length) < 1e-12);
    const w4 = base(); wIn(3, 3).forEach(w => { w4.w[w.id] = { r: 3, w: 0, s: 3 }; });
    check("HSK 4 words do not count toward goal 1 or 2", gp(w4, 0) === 0 && gp(w4, 1) === 0 && gp(w4, 2) > 0);
    const held = base(); wIn(0, 1).filter(w => w.ft !== 2).forEach(w => { held.w[w.id] = { r: 3, w: 0, s: 2 }; });
    check("words at streak 2 are not known (core / ambient tiers; a peripheral word is known at 2)", gp(held, 0) === 0);
    const cfg = VC.charsConfig(PACK), u12 = base(); uIn(0, 1).forEach(u => { u12.chars.c[u.id] = { r: 5, w: 0, s: cfg.mastered }; });
    check(`units at the mastered tier (streak ${cfg.mastered}, ruby, not bare) count: goal 1 = 0.2`, Math.abs(gp(u12, 0) - 0.2) < 1e-12);
    const ub = base(); uIn(0, 1).forEach(u => { ub.chars.c[u.id] = { r: 9, w: 0, s: cfg.bare }; });
    const up = base(); uIn(0, 1).forEach(u => { up.chars.c[u.id] = { r: 2, w: 0, s: cfg.mastered - 1 }; });
    check("bare units count too; pron-tier units do not", Math.abs(gp(ub, 0) - 0.2) < 1e-12 && gp(up, 0) === 0);
    const nolv = CHARACTERS.map(u => { const q = Object.assign({}, u); delete q.lv; return q; });
    check("a unit without lv takes the level of its first word (same position as with lv)", Math.abs(gp(u12, 0, nolv) - gp(u12, 0)) < 1e-12 && Math.abs(gp(u12, 1, nolv) - gp(u12, 1)) < 1e-12);
    const p12 = base(); p12.read = { done: Object.fromEntries(pIn(0, 1).map(x => [x.id, { sc: 4, n: 4, d: "2026-10-01", x: 1, l: 1 }])) };
    const pr = base(); pr.read = { done: Object.fromEntries(pIn(0, 1).map(x => [x.id, { sc: 4, n: 4, d: "2026-10-01", x: 1 }])) };
    check("listened HSK 1-2 passages: goal 1 = 0.2; read-only passages count 0", Math.abs(gp(p12, 0) - 0.2) < 1e-12 && gp(pr, 0) === 0);
    const full = base(); wIn(0, 1).forEach(w => { full.w[w.id] = { r: 3, w: 0, s: 3 }; }); uIn(0, 1).forEach(u => { full.chars.c[u.id] = { r: 5, w: 0, s: cfg.mastered }; }); full.read = p12.read;
    check("all three parts for HSK 1-2: goal 1 = 1", Math.abs(gp(full, 0) - 1) < 1e-12);
    check("absent parts redistribute to words: no units/passages gives words weight 1; no passages 0.8", Math.abs(gp(w12, 0, [], []) - 1) < 1e-12 && Math.abs(gp(w12, 0, CHARACTERS, []) - 0.8) < 1e-12);
    check("no words, an unknown upTo: 0 and never NaN", gp(base(), 0, [], [], []) === 0 && VC.goalPosition(base(), PACK, { upTo: "9", label: "x" }, WORDS, CHARACTERS, PASSAGES) === 0);
    check("goalPositions = one per goal; pure", (() => { const q = clone(full); const r = VC.goalPositions(q, PACK, WORDS, CHARACTERS, PASSAGES); return r.length === 3 && eq(q, full) && r[0] === gp(full, 0); })());
  }

  console.log("\n[7] currentGoal: first goal under 90%, else the last");
  {
    const lv12 = WORDS.filter(w => ["1", "2"].includes(w.lv)), n12 = lv12.length, need = Math.ceil(0.9 * n12);
    const setK = k => { const p = base(); lv12.slice(0, k).forEach(w => { p.w[w.id] = { r: 3, w: 0, s: 3 }; }); return p; };
    const cg = (p, ws) => VC.currentGoal(p, PACK, WORDS, ws === undefined ? [] : ws, ws === undefined ? [] : PASSAGES);
    check("fresh: goal 1 of 3, p 0", (c => c.i === 0 && c.n === 3 && c.p === 0 && !c.all)(cg(base())));
    check(`${need - 1} of ${n12} HSK 1-2 words (below 90%): still goal 1`, cg(setK(need - 1)).i === 0);
    check(`${need} of ${n12} (90%): goal 2`, (c => c.i === 1 && c.goal.upTo === "3" && !c.all)(cg(setK(need))));
    const both = setK(n12); WORDS.filter(w => w.lv === "3").forEach(w => { both.w[w.id] = { r: 3, w: 0, s: 3 }; });
    check("HSK 1-3 words all known (units/passages absent): goal 3, not all", (c => c.i === 2 && !c.all && c.p < 0.9)(cg(both)));
    const every = base(); WORDS.forEach(w => { every.w[w.id] = { r: 3, w: 0, s: 3 }; });
    check("everything known: clamps on the last goal, all = true, p = 1", (c => c.i === 2 && c.all && c.p === 1)(cg(every)));
    const skip = base(); WORDS.filter(w => ["3", "4"].includes(w.lv)).forEach(w => { skip.w[w.id] = { r: 3, w: 0, s: 3 }; });
    check("a later goal at 90% does not skip an earlier unfinished one", cg(skip).i === 0);
    check("a legacy pack (progressMap true) or none has no current goal", VC.currentGoal(base(), LEG, WORDS, [], []) === null && VC.currentGoal(base(), OFF, WORDS, [], []) === null);
    check("the whole-pack bar of an owner-shaped record would read about 0.25; goal 1 reads higher", (() => { const o = ownerProg(); const old = VC.progressPosition(o, LEG, WORDS, CHARACTERS, PASSAGES); const c = VC.currentGoal(o, PACK, WORDS, CHARACTERS, PASSAGES); return c.p > old; })());
  }

  console.log("\n[8] prog.pm g: goal index, per-goal window");
  {
    const p = base(); p.sn = 7; WORDS.filter(w => ["1", "2"].includes(w.lv)).forEach(w => { p.w[w.id] = { r: 3, w: 0, s: 3 }; });
    VC.recordProgressMap(p, PACK, WORDS, [], []);
    check("goal pack writes { sn, p, g } with g = the current goal index (HSK 1-2 words all known, no units: goal 2)", eq(Object.keys(p.pm[0]), ["sn", "p", "g"]) && p.pm[0].g === 1);
    const q = allProg(); q.sn = 3;
    check("progressMap: true (no goals) writes nothing since the flag collapse", VC.recordProgressMap(q, LEG, WORDS, CHARACTERS, PASSAGES) === false && !("pm" in q));
    const mk = (n, g, p0) => Array.from({ length: n }, (_, i) => Object.assign({ sn: 20 + i, p: Math.round((p0 + 0.01 * i) * 1000) / 1000 }, g === undefined ? {} : { g }));
    const s2g = (pm, g, n) => VC.sessionsToGo({ pm }, g, n);
    check("14 entries of goal 0: goal 0 has a pace (ceil((0.9 - 0.23)/0.01) = 67); goal 1 restarts (null)", s2g(mk(14, 0, 0.1), 0, 3) === 67 && s2g(mk(14, 0, 0.1), 1, 3) === null);
    check("7 of goal 0 then 7 of goal 1: neither has 14 -> null (a switch restarts the window)", (() => { const pm = mk(7, 0, 0.5).concat(mk(7, 1, 0.1).map(e => Object.assign(e, { sn: e.sn + 7 }))); return s2g(pm, 0, 3) === null && s2g(pm, 1, 3) === null; })());
    check("old entries without g are ignored for a 3-goal pack", s2g(mk(14, undefined, 0.1), 0, 3) === null && s2g(mk(14, undefined, 0.1), 1, 3) === null);
    check("old entries without g count for goal 0 when the pack has <= 1 goal", s2g(mk(14, undefined, 0.1), 0, 1) === 67 && s2g(mk(14, undefined, 0.1), 1, 1) === null);
    check("goal pace targets 0.9, not 1: rising 0.01/session to p 0.23 -> ceil(0.67/0.01) = 67; whole-pack bar (no g) -> 77", s2g(mk(14, 0, 0.1), 0, 3) === 67 && VC.sessionsToGo({ pm: mk(14, 0, 0.1) }) === 77);
    check("a goal already at 0.9 with a rising history: 0, never negative", s2g(mk(14, 2, 0.8), 2, 3) === 0);
    check("sessionsToGo(prog) without g is the old behaviour (all entries)", VC.sessionsToGo({ pm: mk(14, 0, 0.1) }) === 77 && VC.sessionsToGo({ pm: mk(14, undefined, 0.1) }) === 77);
    check("a mixed list: 4 entries without g + 10 of goal 1 -> null; 14 of goal 1 -> pace 57", s2g(mk(4, undefined, 0.2).concat(mk(10, 1, 0.2).map(e => Object.assign(e, { sn: e.sn + 4 }))), 1, 3) === null && s2g(mk(14, 1, 0.2), 1, 3) === 57);
    const ks = Object.keys(p.sets);
    check("validateProgShape: g number accepted, g string rejected, no g accepted", VC.validateProgShape(p, ks).ok && VC.validateProgShape(Object.assign(clone(p), { pm: [{ sn: 1, p: 0, g: "0" }] }), ks).ok === false && VC.validateProgShape(Object.assign(clone(p), { pm: [{ sn: 1, p: 0 }] }), ks).ok);
    const r = allProg(); r.sn = 1; for(let i = 1; i <= 20; i++){ r.sn = i; VC.recordProgressMap(r, PACK, WORDS, CHARACTERS, PASSAGES); }
    check("capped at 14 with g", r.pm.length === 14 && r.pm.every(e => typeof e.g === "number"));
  }

  console.log("\n[9] Today row and Progress Goals block");
  {
    // App v2 (engine default since the flag collapse): Today shows the current goal as Progress's goal section
    // (head, eta or percent, bar, label) inside the tappable #pmap.pmv.
    const goalText = h => { const m = String(h).match(/<div class="pmv" id="pmap"[^>]*><section class="pvg">([\s\S]*?)<\/section><\/div>/); return m && { head: stripTags((m[1].match(/<div class="pvt"><span>([^<]*)<\/span>/) || [])[1] || ""), value: stripTags((m[1].match(/<span class="pvn">([^<]*)<\/span>/) || [])[1] || ""), label: stripTags((m[1].match(/<p class="pvs">([\s\S]*?)<\/p>/) || [])[1] || ""), html: m[0] }; };
    const G = PACK.progressMap.goals;
    const hsk12 = (extra) => { const p = base({ sets: { "1": NS("1"), "2": NS("2") } }); WORDS.filter(w => ["1", "2"].includes(w.lv)).forEach(w => { p.w[w.id] = { r: 3, w: 0, s: 3 }; }); CHARACTERS.filter(u => ["1", "2"].includes(u.lv)).forEach(u => { p.chars.c[u.id] = { r: 5, w: 0, s: 3 }; }); return Object.assign(p, extra || {}); };
    for(const [label, mkp, pm] of [["mid HSK 1 (goal 1)", midProg, null], ["HSK 1-2 done (goal 2)", hsk12, null], ["goal 2 with 14 g=1 entries", hsk12, Array.from({ length: 14 }, (_, i) => ({ sn: 20 + i, p: 0.1 + 0.01 * i, g: 1 }))], ["goal 2, 14 entries without g", hsk12, pm14(0.1, 0.01)]]){
      const pr = mkp(); if(pm) pr.pm = pm;
      const { api } = await bootWith(PACK, pr, 1);
      const h = api.panel(), t = goalText(h), cg = VC.currentGoal(api.getProg(), PACK, WORDS, CHARACTERS, PASSAGES), pc = Math.round(cg.p * 100);
      const eta = etaOf(VC.sessionsToGoX(api.getProg(), cg.i, cg.n, { pack: PACK, words: WORDS, units: CHARACTERS, passages: PASSAGES }));
      check(`${label}: "${t && t.head}" "${t && t.value}" "${t && t.label}"`, !!t && t.head === `Goal ${cg.i + 1} of 3` && t.value === (eta || `${pc}%`) && t.label === G[cg.i].label);
      check(`${label}: above the plan rows; aria carries the percent`, h.indexOf('id="pmap"') < h.indexOf('<section class="tsts">') && new RegExp(`aria-label="${pc}% of goal ${cg.i + 1} of 3"`).test(h));
    }
    check("goal 2 of an HSK 1-2 record, pace from the g=1 entries: a number", (() => { const pr = hsk12(); pr.pm = Array.from({ length: 14 }, (_, i) => ({ sn: 20 + i, p: 0.1 + 0.01 * i, g: 1 })); return VC.sessionsToGo(pr, 1, 3) === 67; })());
    const done = base({ sets: Object.fromEntries(VC.levelIds(PACK).map(lv => [lv, NS(lv)])) }); WORDS.forEach(w => { done.w[w.id] = { r: 3, w: 0, s: 3 }; }); CHARACTERS.forEach(u => { done.chars.c[u.id] = { r: 5, w: 0, s: 3 }; }); done.read = { done: Object.fromEntries(PASSAGES.map(x => [x.id, { sc: 4, n: 4, d: "2026-10-01", x: 1, l: 1 }])) };
    { const { api } = await bootWith(PACK, done, 1), t = goalText(api.panel());
      check(`all goals passed: "${t && t.head}" "${t && t.value}" "${t && t.label}", no eta`, !!t && t.head === "All goals" && t.value === "100%" && t.label === G[2].label && /aria-label="100% of all goals"/.test(t.html)); }
    { const d2 = clone(done); d2.pm = Array.from({ length: 14 }, (_, i) => ({ sn: 20 + i, p: 0.9 + 0.005 * i, g: 2 })); const { api } = await bootWith(PACK, d2, 1), t = goalText(api.panel());
      check("all goals passed with a rising history: still no eta", !!t && t.value === "100%"); }
    const { api } = await bootWith(PACK, hsk12(), 1);
    api.el("pmap").click(); api.el("pvAll").click(); // app v2: the Goals list sits under Show all
    const gb = (api.panel().match(/<section class="pvls" id="pvGoals">([\s\S]*?)<\/section>/) || [])[1] || "", gr = [...gb.matchAll(/<span>(Goal \d)<\/span><span class="pvn">(\d+)%<\/span><\/div><p class="pvs">([^<]*)<\/p>/g)];
    const ps = VC.goalPositions(api.getProg(), PACK, WORDS, CHARACTERS, PASSAGES);
    check(`tap opens Progress; Show all lists the goals, one row per goal (${gr.map(m => m[1] + " " + m[2] + "%").join(", ")})`, !/id="pmap"/.test(api.panel()) && gr.length === 3 && gr.every((m, i) => +m[2] === Math.round(ps[i] * 100) && m[3] === G[i].label));
    const lg = await bootWith(LEG, hsk12(), 1); lg.api.goto("progress"); lg.api.el("pvAll").click();
    check("progressMap: true: no goal section, no Goals list on Progress", !/id="pvGoals"|class="pvg"/.test(lg.api.panel()));
    const off = await bootWith(OFF, hsk12(), 1); off.api.goto("progress"); off.api.el("pvAll").click();
    check("flag off: no row, no goal section, no Goals list", !/pmap|id="pvGoals"|class="pvg"/.test(off.api.panel()));
    off.api.today();
    check("flag off: no row on Today", !/id="pmap"/.test(off.api.panel()));
  }

  console.log("\n[10] a session writes pm with g; old pm entries");
  {
    const { api, st } = await bootWith(PACK, midProg(), 1);
    const sn0 = api.getProg().sn || 0; playSession(api);
    const pr = JSON.parse(st.ls.getItem(VC.storageKey(PACK)));
    check(`Session done appends { sn ${sn0 + 1}, p, g 0 } (${JSON.stringify(pr.pm)})`, Array.isArray(pr.pm) && pr.pm.length === 1 && pr.pm[0].g === 0 && pr.pm[0].sn === sn0 + 1 && pr.pm[0].p === Math.round(VC.goalPosition(pr, PACK, PACK.progressMap.goals[0], WORDS, CHARACTERS, PASSAGES) * 1000) / 1000);
    const old = midProg(); old.pm = pm14(0.05, 0.01);
    const o = await bootWith(PACK, old, 1); const sn1 = o.api.getProg().sn || 0; playSession(o.api);
    const po = JSON.parse(o.st.ls.getItem(VC.storageKey(PACK)));
    check("an fb20 record (pm entries without g) boots, keeps its entries, appends one with g; its pace is ignored", po.pm.length === 14 && po.pm.slice(0, 13).every(e => e.g === undefined) && po.pm[13].g === 0 && VC.sessionsToGo(po, 0, 3) === null);
    const bt = VC.bootProg(JSON.stringify(po), PACK);
    check("a stored pm with g survives boot with no backup, byte-equal", bt.backupRaw === null && eq(bt.prog.pm, po.pm));
    // progressMap: true control vs 2412992 deleted: it predates pairs, engine default since the flag collapse.
  }

  console.log("\n[l kept] a reading pass after a listening pass keeps the goal position's passage share (fb41)");
  {
    const g = VC.progressMapGoals(PACK)[0] || null, ps = PASSAGES.filter(x => x.lv === "1").slice(0, 2);
    const p = VC.normalizeProg({}, PACK); p.sn = 4;
    ps.forEach(x => VC.markPassageDone(p, x.id, 1, 4, "2026-09-01", true, PACK));
    const before = VC.progressPosition(p, PACK, WORDS, CHARACTERS, PASSAGES), gb = g ? VC.goalPosition(p, PACK, g, WORDS, CHARACTERS, PASSAGES) : null;
    VC.markPassageDone(p, ps[0].id, 1, 4, "2026-09-02", false, PACK);
    const after = VC.progressPosition(p, PACK, WORDS, CHARACTERS, PASSAGES), ga = g ? VC.goalPosition(p, PACK, g, WORDS, CHARACTERS, PASSAGES) : null;
    check(`readRotation pack: position ${before.toFixed(4)} -> ${after.toFixed(4)} and goal ${gb} -> ${ga} unchanged by a reading pass; l kept`, after === before && ga === gb && p.read.done[ps[0].id].l === 1);
  }

  console.log("\n[11] owner export (read-only copy)");
  {
    const f = "/Users/ishmum/Programming/Voluntary/chinese/.cache/owner-progress.json";
    if(!fs.existsSync(f)) console.log("NOTE  owner export not found: skipped");
    else {
      const b = VC.bootProg(fs.readFileSync(f, "utf8"), PACK), pr = b.prog;
      const c = VC.currentGoal(pr, PACK, WORDS, CHARACTERS, PASSAGES), ps = VC.goalPositions(pr, PACK, WORDS, CHARACTERS, PASSAGES), old = VC.progressPosition(pr, LEG, WORDS, CHARACTERS, PASSAGES);
      console.log(`INFO  owner export: goals ${ps.map(x => (x * 100).toFixed(1) + "%").join(" / ")}; current goal ${c.i + 1} of ${c.n} at ${(c.p * 100).toFixed(1)}%, cells ${Math.round(10 * c.p)}; the old whole-pack bar ${(old * 100).toFixed(1)}% (${Math.round(10 * old)} cells)`);
      check("owner export: a goal under 90% is current, its position is above the old whole-pack bar", !c.all && c.p < 0.9 && c.p > old);
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
