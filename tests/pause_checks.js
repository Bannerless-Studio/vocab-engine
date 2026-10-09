// pack.pauseNew (docs/PACK_SCHEMA.md "pauseNew"; owner 2026-10-02: "stop progression. When this is
// on, the user is not taught anything new in sessions"): [1] core helpers, [2] flag off and
// flag on but not paused: Today, Progress and a session byte-identical to main 36aee02, [3] the
// Progress chip, reload, import, [4] paused x {fresh, mid HSK 1, owner shape, all learned}: 6
// Today sessions teach nothing new, Review keeps its size (day-aware plans), unpausing restores
// the same Learn, [5] toggling mid-session (park, toggle in Progress, resume).
// Run: node tests/pause_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, stripFlags } = require("./lib/pack_flags.js");
// the pack this suite was written against: as shipped just before pairs (9eb6ecb), the collapsed flags now engine default
const PAIRS_ERA = "9eb6ecb~1";
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const withDayRules = require("./day_rules_patch.js"); // fb10-weak-floor planner rules on old cores
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "36aee02"; // main before pauseNew
// Progress characters rows are a per-level block since fb6-charrows (lag_checks [5] pins them); the rest of Progress still matches MAIN.
const CHAR_ROWS = /<tr><td><bdi[^>]*>字[^<]*<\/bdi>[^<]*<\/td><td>[^<]*<\/td><\/tr>|<p class="q" style="margin-top:14px">Characters<\/p><table class="stats nw">[\s\S]*?<\/table>/g;
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// glossStyle (fb32) changes every gloss the controls render; tests/gloss_display_checks.js covers it.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), PAIRS_ERA);
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
// The lag Learn row's set label changed after 36aee02 (per-level, fb9): both sides compared with it masked.
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
const pressPause = api => { api.clickTab("progress"); api.el("togglePause").click(); };

(async function main(){
  console.log("\n[1] core");
  {
    check("pause is engine default (flag collapse): zh carries no pauseNew key", !("pauseNew" in PACK));
    const p = base();
    check("pauseOn: needs prog.pause 1", !VC.pauseOn(PACK, p) && VC.pauseOn(PACK, VC.setPause(clone(p), true)) && !VC.pauseOn(PACK, Object.assign(clone(p), { pause: true })));
    const q = VC.setPause(clone(p), true);
    check("setPause: on writes pause 1; off deletes the field (the record is as before)", q.pause === 1 && eq(VC.setPause(q, false), p) && !("pause" in q));
    const o = ownerProg();
    const fresh = VC.nextReadItem(PASSAGES, WORDS, PACK, o, "2026-10-02"), rv = VC.nextReadItem(PASSAGES, WORDS, PACK, o, "2026-10-02", true);
    check(`nextReadItem reviewOnly: a due re-read (${rv && rv.p.id}) instead of the first read (${fresh && fresh.p.id})`, fresh.reason === "new" && rv.reason === "reread" && o.read.done[rv.p.id]);
    const m = midProg(), lw = new Set(VC.learnedWords(WORDS, PACK, m).map(w => w.id));
    const all = VC.availableSentences(SENTENCES, WORDS, PACK, o), known = VC.availableSentences(SENTENCES, WORDS, PACK, o, true), lwo = new Set(VC.learnedWords(WORDS, PACK, o).map(w => w.id));
    check(`availableSentences known: only sentences of learned words (owner shape ${known.length} of ${all.length}; mid ${VC.availableSentences(SENTENCES, WORDS, PACK, m, true).length})`, known.every(s => s.words.every(id => lwo.has(id))) && VC.availableSentences(SENTENCES, WORDS, PACK, m, true).every(s => s.words.every(id => lw.has(id))) && known.length > 8);
  }

  let MAIN_HTML = null, OLD = null;
  try {
    const os = require("os");
    MAIN_HTML = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pause-")), `core_${MAIN}.js`);
    fs.writeFileSync(f, withDayRules(cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }), MAIN)); OLD = require(f);
  } catch(e){ OLD = null; }

  // [2] (flag off / not paused vs main 36aee02) deleted: pauseNew is engine default since the flag collapse.

  console.log("\n[3] the chip: toggle, reload, import");
  {
    const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(midProg()));
    let api = await boot(PACK, st, 1); api.goto("progress");
    const chip = () => stripTags((api.html("panel").match(/<button class="chip[^"]*" id="togglePause"[^>]*>[^<]*<\/button>/) || [""])[0]);
    const c0 = chip(); api.el("togglePause").click(); const c1 = chip();
    check(`Progress chip "${c0}" -> "${c1}"; stored pause 1`, c0 === "New material: on" && c1 === "New material: paused" && JSON.parse(st.ls.getItem(VC.storageKey(PACK))).pause === 1);
    api = await boot(PACK, st, 2); api.goto("progress");
    check(`reload: still "${chip()}"`, chip() === "New material: paused");
    api.el("togglePause").click();
    check(`toggled back: "${chip()}", no pause field stored (record as before pausing)`, chip() === "New material: on" && !("pause" in JSON.parse(st.ls.getItem(VC.storageKey(PACK)))) && st.ls.getItem(VC.storageKey(PACK)) === JSON.stringify(api.getProg()));
    const pz = Object.assign(midProg(), { pause: 1 });
    check("applyImport: an export with pause 1 imports paused; one without imports on (it is progress, not a device setting)", VC.applyImport(base(), JSON.stringify(pz), PACK).prog.pause === 1 && !("pause" in VC.applyImport(pz, JSON.stringify(midProg()), PACK).prog));
    api.el("imp").click(); api.el("imptxt").value = JSON.stringify(pz); api.el("doimport").click(); await tick(); await tick();
    check(`app import of a paused export: chip "${chip()}", stored pause 1`, chip() === "New material: paused" && JSON.parse(st.ls.getItem(VC.storageKey(PACK))).pause === 1);
  }

  console.log("\n[4] paused: 6 Today sessions");
  for(const [name, mk] of SCEN){
    const p0 = mk(), st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(p0));
    NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
    const api = await boot(PACK, st, 3);
    const on = api.panel(), onRows = rows(on).map(r => r[0]), learnBefore = nextLearn(api.getProg());
    pressPause(api); api.today();
    const h = api.panel(), extra = learnItems(p0);
    if(name === "fresh"){
      check(`fresh, paused: "${stripTags((h.match(/<p class="q">Nothing[^<]*<\/p>/) || [""])[0])}", one button "${stripTags((h.match(/id="unpause">[^<]*/) || [""])[0].replace(/^id="unpause">/, ""))}", no Start, no steps`, /<p class="q">Nothing to review yet\.<\/p>/.test(h) && /id="unpause">Turn new material on</.test(h) && !/id="go"/.test(h) && !rows(h).length);
      api.el("unpause").click(); const h2 = api.panel();
      check(`fresh: the button turns new material on; Today as before pausing (Learn ${rows(h2).find(r => r[0] === "Learn")[1]})`, h2 === on && !("pause" in api.getProg()));
      continue;
    }
    // Day-aware plans (engine default since the flag collapse) take no extra Review items: Review keeps its size when paused.
    const pr = rows(h), grow = 0;
    check(`${name}, paused: steps ${pr.map(r => r[0]).join(", ")} (on: ${onRows.join(", ")}); "Review only · new material paused"; Review ${reviewN(on)} -> ${reviewN(h)} items (unchanged; Learn step's drill items ${extra})`,
      !pr.some(r => r[0] === "Learn") && onRows.includes("Learn") && /Review only · new material paused\./.test(h) && reviewN(h) === reviewN(on) + grow && !/1 passage: /.test(stripTags(h)));
    if(name === "owner shape") check(`owner shape: unpaused Today plans a first read (${(rows(on).find(r => r[0] === "Read") || [])[1]}); paused a due re-read (${(pr.find(r => r[0] === "Read" || r[0] === "Listen" && /passage/.test(r[1])) || [])[1]})`, /1 passage: /.test(stripTags(on)) && /passage to (re-read|listen to)/.test(stripTags(h)));
    const res = [];
    for(let d = 0; d < 6; d++){ NOW = new Date(2026, 9, 2 + d, 8, 0, 0).getTime(); api.today(); res.push(playSession(api)); }
    const sum = k => res.reduce((n, r) => n + (r ? r[k] : 0), 0);
    check(`${name}, 6 paused sessions: ${sum("newW")} new words, ${sum("newC")} new units, ${sum("firstReads")} first reads (${sum("rereads")} re-reads), no Learn drill (${sum("learn")}); items per session ${res.map(r => r && r.items).join(",")}; Review drills ${res.map(r => r && r.review).join(",")}`,
      res.every(Boolean) && sum("newW") === 0 && sum("newC") === 0 && sum("firstReads") === 0 && sum("learn") === 0 && res[0].items > 0 && res[0].review === reviewN(h) && (name !== "owner shape" || sum("rereads") > 0));
    const pAfter = api.getProg();
    check(`${name}: set counters and unit records' keys as before (${JSON.stringify(pAfter.sets)})`, eq(pAfter.sets, p0.sets) && eq(Object.keys(pAfter.chars.c).sort(), Object.keys(p0.chars.c).sort()) && eq(Object.keys(pAfter.w).sort(), Object.keys(p0.w).sort()));
    pressPause(api); api.today();
    const learnAfter = nextLearn(api.getProg()), ln = (rows(api.panel()).find(r => r[0] === "Learn") || [])[1];
    // the level gate line's "% known" moves with the paused Review sessions (the gate is engine default)
    const gateless = x => String(x).replace(/ · \S+ \d+ waits · \S+ \d+ at \d+% known$/, "");
    check(`${name}, unpaused: Learn exactly as before pausing (${ln}; ${learnAfter ? learnAfter.slice(0, 40) : "none"}...)`, learnAfter === learnBefore && !("pause" in api.getProg()) && (extra > 0 ? gateless(ln) === gateless((rows(on).find(r => r[0] === "Learn") || [])[1]) : true));
    const s = playSession(api);
    check(`${name}, the next session teaches it (${s.newW} words, ${s.newC} units)`, extra === 0 ? s.newW + s.newC === 0 : (learnBefore[0] === "c" ? s.newC === 10 : s.newW === 10));
  }

  console.log("\n[4b] paused Today Read stage: weak words never give an unlearned word a record");
  {
    const p0 = ownerProg(), rr = VC.nextReadItem(PASSAGES, WORDS, PACK, p0, "2026-10-02", true).p;
    const un = [...new Set(rr.sentences.flatMap(x => x.words || []))].filter(id => p0.w[id]).slice(-3);
    un.forEach(id => { delete p0.w[id]; });
    const lw0 = VC.learnedWords(WORDS, PACK, p0).length;
    {
      const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(Object.assign(clone(p0), { pause: 1 })));
      NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
      const api = await boot(PACK, st, 9);
      const s1 = playSession(api, p => p.id === rr.id ? un : []);
      const pr = api.getProg(), got = un.filter(id => pr.w[id]);
      const listed = s1 && s1.read ? s1.read.weak.length : 0, boxes = s1 && s1.read ? s1.read.weak.filter(l => /type="checkbox"/.test(l)).length : -1;
      // Without the gate a tapped word has weight 2 and is ticked: Continue would give it a `d` record.
      check(`paused: re-read ${rr.id} with ${un.length} unlearned words tapped and every question answered with option 1 (${s1 && s1.read ? stripTags(s1.read.html.match(/<h2>[^<]*<\/h2>/)[0]) : "no read"}): ${got.length} records created, learned ${VC.learnedWords(WORDS, PACK, pr).length} (was ${lw0}), weak list ${listed} words, ${boxes} with a checkbox (learned ones), the unlearned shown without`, s1 && s1.read && got.length === 0 && VC.learnedWords(WORDS, PACK, pr).length === lw0 && listed - boxes >= un.length);
    }
  }

  console.log("\n[5] toggling mid-session");
  {
    const runTo = (api, stop) => { for(let guard = 0; guard < 3000 && !stop(); guard++){ const D = api.getD(), h = api.panel();
      if(D && api.getCur() && D.cur){ answer(api, true); api.el("nx").click(); continue; }
      const rd = api.rd(); if(rd){ api.skipRead(); continue; }
      const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; } return false; } return stop(); };
    // Coming back to Today resumes its parked session (a "Resume today" button when it does not).
    const resume = api => { api.clickTab("today"); if(/id="go">Resume today</.test(api.panel())) api.el("go").click(); return api.step() != null; };
    const finish = api => runTo(api, () => /id="again"/.test(api.panel()));
    for(const [name, mk] of [["mid HSK 1 (words)", midProg], ["owner shape (characters)", ownerProg]]){
      // a. Paused during Review: the Learn step not started is not started.
      let st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(mk())); NOW = new Date(2026, 9, 10, 8, 0, 0).getTime();
      let api = await boot(PACK, st, 4); let k0 = keysOf(api.getProg());
      api.el("go").click(); runTo(api, () => api.step() === 0 && !!api.getD() && api.getD().seen >= 3);
      pressPause(api); let rs = resume(api);
      const midReview = api.step() === 0 && !!api.getD();
      finish(api); let k1 = keysOf(api.getProg());
      check(`${name}: paused during Review, resumed (Review continues: ${midReview}): 0 new (${k1.w.size - k0.w.size} words, ${k1.c.size - k0.c.size} units)`, rs && midReview && k1.w.size === k0.w.size && k1.c.size === k0.c.size);
      // a'. The same across a reload.
      st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(mk()));
      api = await boot(PACK, st, 4); k0 = keysOf(api.getProg());
      api.el("go").click(); runTo(api, () => api.step() === 0 && !!api.getD() && api.getD().seen >= 3);
      pressPause(api); NOW += 60e3; api = await boot(PACK, st, 5); if(/id="go"/.test(api.panel())) api.el("go").click();
      finish(api); k1 = keysOf(api.getProg());
      check(`${name}: paused during Review, reload: 0 new (${k1.w.size - k0.w.size} words, ${k1.c.size - k0.c.size} units)`, k1.w.size === k0.w.size && k1.c.size === k0.c.size);
      // b. Paused during the Learn drill: it finishes, nothing after it teaches.
      st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(mk()));
      api = await boot(PACK, st, 6); k0 = keysOf(api.getProg());
      api.el("go").click(); runTo(api, () => api.step() === 1 && !!api.getD() && api.getD().seen >= 2);
      pressPause(api); rs = resume(api); const inLearn = api.step() === 1 && !!api.getD();
      finish(api); k1 = keysOf(api.getProg());
      check(`${name}: paused during the Learn drill: it finishes (${k1.w.size - k0.w.size} words, ${k1.c.size - k0.c.size} units: the set it started)`, rs && inLearn && (k1.w.size - k0.w.size) + (k1.c.size - k0.c.size) === 10);
      // c. Unpaused during a paused session's Review: the next Learn decision teaches.
      st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(Object.assign(mk(), { pause: 1 })));
      api = await boot(PACK, st, 7); k0 = keysOf(api.getProg()); const lb = nextLearn(api.getProg());
      api.el("go").click(); runTo(api, () => api.step() === 0 && !!api.getD() && api.getD().seen >= 3);
      pressPause(api); rs = resume(api); finish(api); k1 = keysOf(api.getProg());
      const got = lb[0] === "c" ? [...k1.c].filter(k => !k0.c.has(k)) : [...k1.w].filter(k => !k0.w.has(k));
      check(`${name}: unpaused during a paused session: its Learn step runs (${got.length} new, the set it would have taught)`, rs && eq(got.sort(), lb.slice(2).split(",").sort()));
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
