// characters.learn "lag" (docs/PACK_SCHEMA.md "learn"; owner 2026-10-02: "if character is lagging
// behind teach character, if not teach words"): [1] the rule in core (fresh, the owner's shape,
// stored order / turn / defer ignored, all words learned + the last partial set, holes oldest
// first), before (main 590af86) vs after for the owner's shape, [2] app: fresh learner over 8
// sessions (W C W C ...), the Progress line and the strip, no chips, no card, [3] closing after
// Learn and reloading mid-Learn (the same units resume), [5] Progress rows per level.
// Run: node tests/lag_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, withCollapsed } = require("./lib/pack_flags.js");
// the pack this suite was written against: as shipped just before pairs (9eb6ecb), the collapsed flags now engine default
const PAIRS_ERA = "9eb6ecb~1";
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const withDayRules = require("./day_rules_patch.js"); // fb10-weak-floor planner rules on old cores
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "590af86"; // main before characters.learn (stage model: withWords, order chips, turn)
const clone0 = x => JSON.parse(JSON.stringify(x));
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// fb27: PACK is zh without characters.start / ramp (the rule of sections 1-4 and the control); PACKR is zh as shipped.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACKR = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), PAIRS_ERA, { keep: ["characters.start", "characters.ramp"] });
const PACK = (p => { delete p.characters.start; delete p.characters.ramp; return p; })(clone0(PACKR));
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
// The zh pack on main 590af86: characters.withWords, no learn (and no pauseNew / optsMix / wordsBy, added after it).
const WITH = (p => { const q = packAsOf(p, "590af86"); q.characters = Object.assign({}, q.characters, { withWords: true }); return q; })(PACK);
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
// App v2 (engine default since the flag collapse): Progress shows a lag pack's characters inside each level row
// ("characters only X of Y": units at target of the level's units) once Show all is open; "HSK n | X of Y" per row.
const charRows = h => h.split('<div class="pvl').slice(1).map(c => { const l = c.match(/<div class="pvt"><span>([^<]*)<\/span>/), m = c.match(/characters only (\d+) of (\d+)/); return l && m ? `${stripTags(l[1])} | ${m[1]} of ${m[2]}` : null; }).filter(Boolean);
// Owner export shape: HSK 1 taught and mastered, its 10 peripheral units at target (v1 said "10 done").
const OWNER_ROWS = ["HSK 1 | 10 of 150", "HSK 2 | 0 of 147", "HSK 3 | 0 of 298", "HSK 4 | 0 of 598"];
const MID1 = () => (() => { const p = VC.normalizeProg({ sets: { "1": 3 }, placedOnce: true, soundsOpened: true, sessions: 5 }, PACK); byLv["1"].slice(0, 30).forEach(w => { p.w[w.id] = { r: 3, w: 0, s: 3 }; }); ORDER.slice(0, 20).forEach((u, i) => { p.chars.c[u.id] = { r: 4, w: 0, s: i < 5 ? 6 : i < 12 ? 3 : 1 }; }); Object.assign(p.chars, { choiceSeen: true, turn: "w" }); return p; })();
function progressAll(api){ api.goto("progress"); if(!/id="pvAll" aria-expanded="true"/.test(api.html("panel"))) api.el("pvAll").click(); return api.html("panel"); }
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
const SIZE = VC.charsConfig(PACK).setSize;
const UNIT_OF = new Map(CHARACTERS.map(u => [u.words[0], u]));
const ORDER = VC.charStageUnits(VC.levelIds(PACK), CHARACTERS, PACK);
// HSK 1-3 learned, HSK 4 not; the first nUnits units in pack order taught (the old 字1, 字2
// set counters), stored fields of the stage model as the owner's progress may hold them.
function ownerProg(nUnits, extra){
  const p = VC.normalizeProg({ sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": 0 }, placedOnce: true, soundsOpened: true, sessions: 60 }, PACK);
  ["1", "2", "3"].forEach(lv => byLv[lv].forEach(w => { p.w[w.id] = { r: 5, w: 0, s: 5 }; }));
  ORDER.slice(0, nUnits).forEach(u => { p.chars.c[u.id] = { r: 4, w: 1, s: 3 }; });
  Object.assign(p.chars, { choiceSeen: true, order: "first", turn: "w" }, extra || {});
  return p;
}
const rle = seq => { const out = []; seq.forEach(k => { const l = out[out.length - 1]; if(l && l[0] === k) l[1]++; else out.push([k, 1]); }); return out.map(([k, n]) => n > 1 ? `${k}x${n}` : k).join(" "); };
// Plays n Learn steps in core: a words step records its set, a characters step its units (all
// right). Returns the kinds, units re-taught, units taught before their word, lag after each step.
function simulate(V, pack, prog, n, lagRule){
  const p = clone(prog), seq = [], lags = []; let retaught = 0, early = 0, lowered = 0;
  for(let i = 0; i < n; i++){
    const st = V.nextStage(pack, WORDS, CHARACTERS, p);
    if(!st){ seq.push("-"); break; }
    if(st.kind === "words"){
      const nn = V.levelNewSet(WORDS, pack, p, st.lv);
      nn.words.forEach(w => { p.w[w.id] = { r: 1, w: 0, s: 1 }; }); V.settleSetCounter(p, WORDS, pack, st.lv);
      if(V.learnTurnDone) V.learnTurnDone(p, pack, "words");
      seq.push("W");
    } else {
      const cs = lagRule ? V.lagCharSet(pack, WORDS, CHARACTERS, p) : V.nextCharSet(st.levels, CHARACTERS, pack, p);
      const learned = new Set(V.learnedWords(WORDS, pack, p).map(w => w.id));
      cs.units.forEach(u => { if(p.chars.c[u.id]) retaught++; if(!learned.has(u.words[0])) early++; const before = p.chars.c[u.id]; p.chars.c[u.id] = before ? Object.assign({}, before, { r: before.r + 1 }) : { r: 1, w: 0, s: 1 }; if(before && p.chars.c[u.id].s < before.s) lowered++; });
      if(V.learnTurnDone) V.learnTurnDone(p, pack, "chars");
      seq.push("C");
    }
    p.sessions = (p.sessions || 0) + 1;
    lags.push(VC.lagUnits(PACK, WORDS, CHARACTERS, p).length);
  }
  return { seq, retaught, early, lowered, lags, prog: p };
}
let OLD = null;
try {
  const os = require("os");
  const src = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lag-")), `core_${MAIN}.js`); fs.writeFileSync(f, withDayRules(src, MAIN)); OLD = require(f);
} catch(e){ OLD = null; }

(async function main(){
  console.log("\n[1] the rule in core");
  {
    const cfg = VC.charsConfig(PACK);
    check(`zh ships characters.learn "lag" (withWords off under it); set size ${SIZE}`, cfg.learn === "lag" && cfg.withWords === false && SIZE === 10 && VC.lagOn(PACK) && !VC.lagOn(WITH));
    // Fresh learner: words set 1, its characters, words set 2, ... (characters one set behind).
    const f = simulate(VC, PACK, VC.defaultProg(PACK), 12, true);
    check(`fresh, 12 Learn steps: ${f.seq.join("")}; 0 re-taught (${f.retaught}), 0 before their word (${f.early}), lag after each ${f.lags.join(",")}`, f.seq.join("") === "WCWCWCWCWCWC" && f.retaught === 0 && f.early === 0 && f.lags.every((n, i) => n === (i % 2 ? 0 : 10)));
    const units = Object.keys(f.prog.chars.c);
    check(`fresh: the units taught are the first ${units.length} in pack order, each with its word learned`, eq(units, ORDER.slice(0, units.length).map(u => u.id)) && units.every(id => f.prog.w[CHARACTERS.find(u => u.id === id).words[0]]));
    // Owner's shape: HSK 1-3 learned, 250 units taught (字1 and most of 字2), HSK 4 not started.
    const own = ownerProg(250), lag0 = VC.lagUnits(PACK, WORDS, CHARACTERS, own).length;
    const after = simulate(VC, PACK, own, 120, true), first = after.seq.indexOf("W");
    const tail = after.seq.slice(first);
    check(`owner shape (595 words, 250 units, HSK 4 unlearned; lag ${lag0}): characters every session until lag < 10 (${first} sessions, lag then ${after.lags[first - 1]}: 345 = 34 sets + 5), then interleaved (${rle(tail.slice(0, 12))} ...); 0 re-taught, 0 lowered, 0 before their word`,
      lag0 === 345 && first === 34 && after.lags.slice(first).every(n => n === 5 || n === 15) && after.seq.slice(0, first).every(k => k === "C") && after.lags[first - 1] < 10 && /^(WC)+W?$/.test(tail.join("")) && after.retaught === 0 && after.lowered === 0 && after.early === 0);
    if(OLD){
      const ob = OLD.bootProg(JSON.stringify(ownerProg(250)), WITH).prog;
      const bf = simulate(OLD, WITH, ob, 120, false), bw = simulate(OLD, WITH, OLD.setCharMode(clone(ob), "with"), 120, false);
      console.log(`  owner shape, first 120 Learn steps: before (${MAIN}, stored order "first"): ${rle(bf.seq)}; before, "with words": ${rle(bw.seq)}; after: ${rle(after.seq)}`);
      check(`before vs after: characters first (${bf.seq.indexOf("W")} vs ${first} sessions: the last 5 units now wait for the next words); before then HSK 4 words only (字4 waits for all of HSK 4), after HSK 4 words and their characters take turns`,
        bf.seq.indexOf("W") === 35 && bf.seq.slice(35, 95).every(k => k === "W") && /^(WC)+$/.test(after.seq.slice(first, first + 60).join("")));
    } else console.log(`NOTE  engine ${MAIN} not in this checkout's history: no before numbers`);
    // Stored fields of the stage model change nothing.
    const variants = [{}, { order: "with" }, { order: "first", turn: "c" }, { defer: true }, { defer: true, order: "with", turn: "w" }, { choiceSeen: false }];
    const seqs = variants.map(v => simulate(VC, PACK, ownerProg(250, v), 50, true).seq.join(""));
    check(`stored order "with" / "first", turn, defer true ("later"), choiceSeen: the same 50 Learn steps (${new Set(seqs).size} distinct)`, new Set(seqs).size === 1);
    // All words learned: everything left is taught, the last partial set included.
    const all = ownerProg(0); all.sets["4"] = NS("4"); byLv["4"].forEach(w => { all.w[w.id] = { r: 1, w: 0, s: 1 }; });
    ORDER.slice(0, ORDER.length - 3).forEach(u => { all.chars.c[u.id] = { r: 1, w: 0, s: 1 }; });
    const end = simulate(VC, PACK, all, 3, true), last = VC.lagCharSet(PACK, WORDS, CHARACTERS, all);
    check(`all words learned, 3 units left: Learn teaches them (${last.units.map(u => u.id).join(",")}, set ${last.index + 1} of ${last.total}), then everything covered (${end.seq.join("")})`, last.units.length === 3 && end.seq.join("") === "C-" && VC.nextStage(PACK, WORDS, CHARACTERS, end.prog) === null);
    const few = ownerProg(0); ORDER.slice(0, 595 - 4).forEach(u => { few.chars.c[u.id] = { r: 1, w: 0, s: 1 }; });
    check("4 untaught units with new words left: words (lag below a set)", VC.nextStage(PACK, WORDS, CHARACTERS, few).kind === "words");
    // Holes: taught units that are not a prefix of pack order are filled oldest first.
    const h = ownerProg(0); ORDER.slice(0, 200).forEach((u, i) => { if(![3, 4, 17, 60, 61, 62, 150, 199].includes(i)) h.chars.c[u.id] = { r: 1, w: 0, s: 1 }; });
    const hs = VC.lagCharSet(PACK, WORDS, CHARACTERS, h);
    check(`holes (8 untaught among the first 200): the next set is the holes then the next units in order (${hs.units.map(u => u.id).join(",")})`, eq(hs.units.map(u => u.id), [3, 4, 17, 60, 61, 62, 150, 199, 200, 201].map(i => ORDER[i].id)));
    const p1 = VC.normalizeProg({ sets: { "1": 0 }, placedOnce: true }, PACK); byLv["1"].slice(0, 9).forEach(w => { p1.w[w.id] = { r: 1, w: 0, s: 1 }; });
    check("9 words learned, no unit: words (a set needs 10); characters not started", VC.nextStage(PACK, WORDS, CHARACTERS, p1).kind === "words" && !VC.charsStarted(PACK, WORDS, CHARACTERS, p1));
    byLv["1"].slice(9, 10).forEach(w => { p1.w[w.id] = { r: 1, w: 0, s: 1 }; });
    check("10 words learned, no unit: characters; started (Review keeps the characters size)", VC.nextStage(PACK, WORDS, CHARACTERS, p1).kind === "chars" && VC.charsStarted(PACK, WORDS, CHARACTERS, p1));
    check("lagResume: the recorded unit ids win; unknown ids fall back to the fresh snapshot", (s => s.stage.lag && eq(s.cset.units.map(u => u.id), [ORDER[5].id, ORDER[2].id]))(VC.lagResume(VC.todaySnapshot(PACK, WORDS, CHARACTERS, p1), PACK, WORDS, CHARACTERS, p1, [ORDER[5].id, ORDER[2].id]))
      && (s => eq(s.cset.ids, ORDER.slice(0, 10).map(u => u.id)))(VC.lagResume(VC.todaySnapshot(PACK, WORDS, CHARACTERS, p1), PACK, WORDS, CHARACTERS, p1, ["nope"])) && VC.lagResume(VC.todaySnapshot(WITH, WORDS, CHARACTERS, p1), WITH, WORDS, CHARACTERS, p1, [ORDER[5].id]).stage.lag !== true);
  }

  const segs = h => [...h.matchAll(/<div class="seg">[\s\S]*?<\/i><\/div>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]));
  const learnLine = h => stripTags((h.match(/<div class="tst"><span>Learn<\/span><div class="tsd">([\s\S]*?)<\/div><\/div>/) || ["", ""])[1]); // app v2 Today row
  const kind = l => /^字/.test(l) ? "C" : /^HSK/.test(l) ? "W" : "?";
  // Plays Today until stop(prog, panel) holds or the session ends.
  const play = (api, stop) => { if(!api.getD() && /id="go"/.test(api.panel())) api.el("go").click(); let guard = 0;
    while(guard++ < 900 && !(stop && stop(api.getProg(), api.panel()))){ const D = api.getD(); const h = api.panel();
      if(D && api.getCur() && D.cur){ answer(api, true); api.el("nx").click(); continue; }
      if(/id="again"/.test(h)){ api.el("again").click(); return true; }
      if(api.rd()){ api.skipRead(); continue; }
      const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; }
      const g = (h.match(/<button class="ghost" id="(\w+)"/) || [])[1]; if(g){ api.el(g).click(); continue; } return false; }
    return !!(stop && stop(api.getProg(), api.panel())); };
  const nRec = p => Object.keys((p.chars || {}).c || {}).length;

  console.log("\n[2] app: fresh learner over 8 sessions, Progress, strip");
  {
    const st = fresh(); const lines = []; let early = 0, card = 0;
    for(let d = 0; d < 8; d++){
      NOW = new Date(2026, 9, 3 + d, 8, 0, 0).getTime();
      const api = await boot(PACK, st, 1 + d); const h = api.panel();
      lines.push(learnLine(h)); if(/id="charChoice"/.test(h)) card++;
      play(api);
      const p = api.getProg(), lw = new Set(VC.learnedWords(WORDS, PACK, p).map(w => w.id));
      early += Object.keys(p.chars.c).filter(id => !lw.has(CHARACTERS.find(u => u.id === id).words[0])).length;
    }
    const pf = JSON.parse(st.ls.getItem(VC.storageKey(PACK)));
    check(`8 sessions: Learn ${lines.map(kind).join("")} (${lines.slice(0, 4).join(" | ")} ...); no card; ${nRec(pf)} units, none before its word`, lines.map(kind).join("") === "WCWCWCWC" && card === 0 && early === 0 && nRec(pf) === 40);
    check(`stored chars keys ${Object.keys(pf.chars).join(",")}: no order, no turn written`, !("order" in pf.chars) && !("turn" in pf.chars));
    const { api } = await bootWith(PACK, ownerProg(250), 1); const h = api.panel();
    const ph = progressAll(api); // app v2: the path strip is on Progress (Show all)
    check(`owner shape, Today: strip ${segs(ph).join(" | ")}; Learn ${learnLine(h)}; no card`, segs(ph).join("|") === "HSK 1|HSK 2|HSK 3|HSK 4" && /^字 HSK 2, set 11 of 15$/.test(learnLine(h)) && !/id="charChoice"/.test(h) && /id="go"/.test(h));
    const rows = charRows(ph), row = rows.join("; ");
    // freqTiers (engine default since the flag collapse): HSK 1's 10 peripheral units, mastered, are at target.
    check(`owner shape, Progress: "${row}"; no order chips; mix chip kept`, eq(rows, OWNER_ROWS) && !/id="ord(First|Before|After)"/.test(ph) && /id="toggleMix"/.test(ph));
    { // per-level label: the Today row agrees with lagCharSet's per-level position (app v2 Progress has no taught counts)
      const cs = VC.lagCharSet(PACK, WORDS, CHARACTERS, ownerProg(250));
      check(`owner shape: Today "${learnLine(h)}" = lagCharSet HSK ${cs.lv}: set ${cs.lvIndex + 1} of ${cs.lvTotal}`, learnLine(h) === `字 HSK ${cs.lv}, set ${cs.lvIndex + 1} of ${cs.lvTotal}`);
      check("owner shape: lagCharSet keeps index/total (whole-pack counts) and adds lv/lvIndex/lvTotal", cs.index === 25 && cs.total === 120 && cs.lv === "2" && cs.lvIndex === 10 && cs.lvTotal === 15);
      const lf = VC.lagCharSet(PACK, WORDS, CHARACTERS, (() => { const q = VC.normalizeProg({ sets: { "1": 0 }, placedOnce: true }, PACK); byLv["1"].slice(0, 10).forEach(w => { q.w[w.id] = { r: 1, w: 0, s: 1 }; }); return q; })());
      check(`fresh learner first lag set: level ${lf.lv}, set ${lf.lvIndex + 1} of ${lf.lvTotal}`, lf.lv === "1" && lf.lvIndex === 0 && lf.lvTotal === 15);
      const sp = ownerProg(145), sc = VC.lagCharSet(PACK, WORDS, CHARACTERS, sp);
      check(`set straddling HSK 1/2 (145 taught of 150): shows the lower level (${sc.lv}, set ${sc.lvIndex + 1} of ${sc.lvTotal})`, sc.units.some(u => String(u.lv) === "2") && sc.lv === "1" && sc.lvIndex === 14);
      const { api: sa } = await bootWith(PACK, sp, 1); const lh = learnLine(sa.panel());
      check(`straddling set, Today: "${lh}"`, lh === "字 HSK 1, set 15 of 15");
    }
    if(OLD){
      const { api: ob } = await bootWith(WITH, ownerProg(250), 1, { core: OLD, html: cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26 }) });
      const bh = ob.panel(); ob.goto("progress"); const bp = ob.html("panel"); // (an older sha: v1 Today strip)
      const brows = [...bp.matchAll(/<tr><td><bdi[^>]*>(字\d)<\/bdi><\/td><td>([^<]*)<\/td><\/tr>/g)].map(m => m[1] + " " + m[2]);
      console.log(`  owner shape before (${MAIN}): strip ${segs(bh).join(" | ")}; Learn ${learnLine(bh)}; Progress ${brows.join("; ")}; chips ${[...bp.matchAll(/id="ord\w+"[^>]*>([^<]*)</g)].map(m => m[1]).join(" / ")}`);
      console.log(`  owner shape after: strip ${segs(ph).join(" | ")}; Learn ${learnLine(h)}; Progress ${row}; no chips`);
    }
  }

  console.log("\n[3] closing after Learn, reload mid-Learn");
  {
    // Closed right after each Learn step (the rest of Today never played): the rule still alternates.
    const st = fresh(); const lines = [];
    for(let d = 0; d < 6; d++){
      NOW = new Date(2026, 10, 1 + d, 8, 0, 0).getTime();
      const api = await boot(PACK, st, 3); const l = learnLine(api.panel()); lines.push(l);
      const w0 = Object.keys(api.getProg().w).length, c0 = nRec(api.getProg());
      // Stop on the Learn drill's results screen, press Continue (the step completes), close.
      play(api, (p, h) => (Object.keys(p.w).length >= w0 + 10 || nRec(p) >= c0 + 10) && !api.getD() && /id="ok"/.test(h));
      api.el("ok").click();
    }
    check(`closed after Learn each day: ${lines.map(kind).join("")} (${lines.slice(0, 3).join(" | ")} ...)`, lines.map(kind).join("") === "WCWCWC");
    // Reload on the characters teach screen: the same units come back (session record today.cu).
    const p = VC.normalizeProg({ sets: { "1": 1 }, placedOnce: true, soundsOpened: true, sessions: 1 }, PACK);
    byLv["1"].slice(0, 10).forEach(w => { p.w[w.id] = { r: 1, w: 0, s: 1 }; });
    const st2 = fresh(); st2.ls.setItem(VC.storageKey(PACK), JSON.stringify(p));
    NOW = new Date(2026, 10, 20, 8, 0, 0).getTime();
    let api = await boot(PACK, st2, 1);
    const teachUnits = h => [...String(h).matchAll(/<span class="cform"[^>]*>([^<]*)<\/span>/g)].map(m => m[1]);
    play(api, (_, h) => /id="ctl"/.test(h));
    const shown = teachUnits(api.panel());
    const cu = (() => { for(const s of [st2.ls, st2.ss]) for(const k of s.keys()){ const m = String(s.getItem(k)).match(/"cu":(\[[^\]]*\])/); if(m) return JSON.parse(m[1]); } return null; })();
    check(`teach screen: ${shown.join("")}; session record today.cu holds their ids (${(cu || []).join(",")})`, shown.length === 10 && !!cu && eq(cu.map(id => CHARACTERS.find(u => u.id === id).t), shown));
    const head = h => stripTags((String(h).match(/<p class="pva">([\s\S]*?)<\/p>/) || [])[1] || ""); // app v2 teach header
    check(`teach card header: "${head(api.panel())}"`, head(api.panel()) === "HSK 1 characters, set 1 of 15");
    NOW += 60 * 1000; api = await boot(PACK, st2, 2);
    const again = teachUnits(api.panel());
    check(`after reload (cset rebuilt from today.cu): header "${head(api.panel())}"`, head(api.panel()) === "HSK 1 characters, set 1 of 15");
    check(`reload on the teach screen: the same set (${again.join("")})`, eq(again, shown));
    play(api, (_, h) => !!api.getD() && !!api.getCur() && /c:/.test(String(api.getCur().key)));
    NOW += 60 * 1000; api = await boot(PACK, st2, 3);
    const D = api.getD(); const keys = D ? [D.cur, ...D.q].filter(Boolean).map(it => String(it.key)) : [];
    check(`reload mid-drill: the drill resumes on the same units (${new Set(keys.filter(k => k.startsWith("c:"))).size} unit keys)`, !!D && keys.filter(k => k.startsWith("c:")).every(k => cu.includes(k.slice(2))));
    play(api);
    const fin = api.getProg();
    check(`resumed session records exactly those units (${Object.keys(fin.chars.c).join(",")})`, eq(Object.keys(fin.chars.c).sort(), cu.slice().sort()));
  }

  const BASE_SHA = "d3632b8"; // engine before the flag collapse: carries the flag-off stage model, with the collapsed keys live
  console.log("\n[4] flag off: the stage model as on " + BASE_SHA + " (booted withCollapsed)");
  {
    const g = f => { try { return cp.execSync(`git -C "${ROOT}" show ${BASE_SHA}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch(e){ return null; } };
    const baseHtml = g("engine/app.html"), baseSrc = g("engine/core.js");
    check(`${BASE_SHA} engine loaded from git (a missing sha is a failure)`, !!baseHtml && !!baseSrc);
    if(baseHtml && baseSrc){
      const f = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "lag-base-")), `core_${BASE_SHA}.js`); fs.writeFileSync(f, baseSrc); const BASE = require(f);
      const ETA = loadConst(path.join(ZH, "pack.js"), "PACK").eta; // eta is required pack data now; both sides read the same curves
      const cur = Object.assign({}, WITH, { eta: ETA }), old = withCollapsed(cur);
      const mid = VC.normalizeProg({ sets: { "1": NS("1"), "2": 2 }, placedOnce: true, soundsOpened: true, sessions: 7 }, WITH);
      byLv["1"].forEach(w => { mid.w[w.id] = { r: 3, w: 0, s: 3 }; }); byLv["2"].slice(0, 20).forEach(w => { mid.w[w.id] = { r: 1, w: 0, s: 1 }; });
      for(const [name, p] of [["fresh", null], ["mid HSK 2", mid], ["owner shape", ownerProg(250)], ["owner, later", ownerProg(250, { defer: true })]]){
        const out = [];
        for(const [core, html, pk] of [[VC, appHtml, cur], [BASE, baseHtml, old]]){
          const st = fresh(); if(p) st.ls.setItem(VC.storageKey(pk), JSON.stringify(p));
          NOW = new Date(2026, 11, 1, 8, 0, 0).getTime();
          const api = await boot(pk, st, 1, { core, html }); const t = api.panel(); api.goto("progress"); const gp = api.html("panel");
          api.today(); play(api);
          out.push({ t, g: gp, prog: st.ls.getItem(VC.storageKey(pk)) });
        }
        check(`withWords pack (no learn), ${name}: Today, Progress and a whole session's progress byte-identical to ${BASE_SHA} (${out[0].t.length} + ${out[0].g.length} chars)`, out[0].t === out[1].t && out[0].g === out[1].g && out[0].prog === out[1].prog);
      }
    }
  }

  console.log("\n[5] Progress: characters per level row (app v2)");
  {
    // App v2 (engine default since the flag collapse): the v1 "Characters" table (taught / mastered / done per level) is gone;
    // each level row carries "characters only X of Y" under Show all: X units at target (VC.unitAtTarget) of the level's Y.
    const lvOk = CHARACTERS.every(u => String(u.lv) === String(BY_ID[u.words[0]].lv));
    check("every unit's level equals its word's level", lvOk);
    const want = p => ["1","2","3","4"].map(lv => { const us = CHARACTERS.filter(u => String(u.lv) === lv); return `HSK ${lv} | ${us.filter(u => VC.unitAtTarget((p.chars.c || {})[u.id], u, p, PACK)).length} of ${us.length}`; });
    const mid1 = MID1();
    const allP = ownerProg(ORDER.length); byLv["4"].forEach(w => { allP.w[w.id] = { r: 5, w: 0, s: 5 }; });
    const every = ownerProg(ORDER.length); byLv["4"].forEach(x => { every.w[x.id] = { r: 5, w: 0, s: 5 }; }); ORDER.forEach(u => { every.chars.c[u.id] = { r: 8, w: 0, s: 8 }; });
    for(const [name, p] of [["mid HSK 1", mid1], ["owner", ownerProg(250)], ["all taught", allP], ["every unit bare", every]]){
      const { api } = await bootWith(PACK, p, 1); const rows = charRows(progressAll(api));
      check(`${name}: ${rows.join("; ")}`, eq(rows, want(api.getProg())) && rows.every(r => !/^HSK \d \| 0 of 0$/.test(r)));
    }
    { const { api } = await bootWith(PACK, every, 1); const rows = charRows(progressAll(api));
      check(`every unit bare: all at target (${rows.join("; ")})`, rows.length === 4 && rows.every(r => { const m = r.match(/(\d+) of (\d+)$/); return m[1] === m[2]; })); }
    const fo = await bootWith(PACK, ownerProg(250), 1); progressAll(fo.api);
    const fresh0 = await bootWith(PACK, null, 1);
    check("fresh learner: no characters parts (not started)", charRows(progressAll(fresh0.api)).length === 0);
    check("boot + Progress write nothing new: stored chars keys unchanged", Object.keys(JSON.parse(fo.st.ls.getItem(VC.storageKey(PACK))).chars).sort().join() === Object.keys(ownerProg(250).chars).sort().join());
  }

  console.log("\n[6] characters.start / ramp (fb27)");
  {
    const cfg = VC.charsConfig(PACKR);
    check(`zh ships start ${cfg.start}, ramp ${cfg.ramp}; the stripped pack has neither`, cfg.start === 60 && eq(cfg.ramp, [3, 5, 8]) && VC.charsConfig(PACK).start === undefined && VC.charsConfig(PACK).ramp === undefined);
    const bad = (k, v) => { const q = clone0(PACKR); q.characters[k] = v; return VC.charsConfig(q); };
    check("invalid start / ramp are ignored (descending, > setSize, empty, non-integer)", bad("ramp", [5, 3]).ramp === undefined && bad("ramp", [3, 11]).ramp === undefined && bad("ramp", []).ramp === undefined && bad("start", 2.5).start === undefined);
    check("without learn lag neither is read", (q => { delete q.characters.learn; const c = VC.charsConfig(q); return c.start === undefined && c.ramp === undefined; })(clone0(PACKR)));
    // Fresh learner: words until 60 learned, then sets of 3, 5, 8, 10, 10 (the lag rule: one current-size set of untaught units).
    const f = simulate(VC, PACKR, VC.defaultProg(PACKR), 24, true), seq = f.seq;
    check(`fresh, 24 Learn steps: ${rle(seq)}`, /^W{6}/.test(seq.join("")) && seq[6] === "C");
    const units = Object.keys(f.prog.chars.c);
    check(`fresh: chars taught after the sixth words set, ${units.length} units after 24 steps, first in pack order`, eq(units, ORDER.slice(0, units.length).map(u => u.id)));
    // Set sizes in order, from the simulated records' f is not stored: replay and read each characters step.
    const q = clone0(VC.defaultProg(PACKR)), got = [];
    for(let i = 0; i < 24; i++){
      const st = VC.nextStage(PACKR, WORDS, CHARACTERS, q);
      if(st.kind === "chars"){ const cs = VC.lagCharSet(PACKR, WORDS, CHARACTERS, q); got.push(cs.units.length); cs.units.forEach(u => { q.chars.c[u.id] = { r: 4, w: 0, s: 3 }; }); }
      else { const ns = VC.levelNewSet(WORDS, PACKR, q, st.lv); ns.words.forEach(w => { q.w[w.id] = { r: 1, w: 0, s: 1 }; }); VC.settleSetCounter(q, WORDS, PACKR, st.lv); }
    }
    check(`character set sizes in order: ${got.join(",")}`, got.slice(0, 4).join() === "3,5,8,10" && got.slice(4).every(n => n === 10 || n > 0));
    // Mid-ramp learner: 4 taught units continue at a set of 5.
    const mid = clone0(VC.defaultProg(PACKR)); ["1"].forEach(lv => byLv[lv].slice(0, 70).forEach(w => { mid.w[w.id] = { r: 5, w: 0, s: 5 }; })); mid.sets["1"] = 7;
    ORDER.slice(0, 4).forEach(u => { mid.chars.c[u.id] = { r: 4, w: 0, s: 3 }; });
    const ms = VC.lagCharSet(PACKR, WORDS, CHARACTERS, mid);
    check(`mid-ramp (4 taught): next set has 5 units, labelled set ${ms.index + 1} of ${ms.total}`, ms.units.length === 5 && ms.index === 1);
    // Below start: words even with a full untaught set.
    const lo = clone0(VC.defaultProg(PACKR)); byLv["1"].slice(0, 50).forEach(w => { lo.w[w.id] = { r: 5, w: 0, s: 5 }; }); lo.sets["1"] = 5;
    check("50 words learned, 50 untaught units: Learn teaches words (start 60)", VC.nextStage(PACKR, WORDS, CHARACTERS, lo).kind === "words");
    // Owner export: first Learn decision identical with and without the ramp.
    const EXP = "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json";
    if(fs.existsSync(EXP)){
      const raw = JSON.parse(fs.readFileSync(EXP, "utf8")), pr = VC.normalizeProg(raw, PACKR), pr0 = VC.normalizeProg(raw, PACK);
      const a = VC.nextStage(PACKR, WORDS, CHARACTERS, pr), b = VC.nextStage(PACK, WORDS, CHARACTERS, pr0);
      const ca = a.kind === "chars" ? VC.lagCharSet(PACKR, WORDS, CHARACTERS, pr) : null, cb = b.kind === "chars" ? VC.lagCharSet(PACK, WORDS, CHARACTERS, pr0) : null;
      check(`owner export (${Object.keys(pr.w).length} word records, ${Object.keys(pr.chars.c).length} units): first Learn ${a.kind}, same units with and without the ramp (label: set ${ca && cb ? `${cb.lvIndex + 1} of ${cb.lvTotal} -> ${ca.lvIndex + 1} of ${ca.lvTotal}` : "-"})`,
        a.kind === b.kind && (!ca || eq(ca.ids, cb.ids)));
    } else console.log("  skip: owner export not found");
    // Set label under the ramp: sets never straddle a level, so the whole-pack total is the sum of the per-level counts.
    const perLv = VC.levelIds(PACKR).map(lv => CHARACTERS.filter(u => String(u.lv) === lv).length);
    const gotT = VC.lagCharSet(PACKR, WORDS, CHARACTERS, mid).total;
    check(`label total: ${gotT} sets (HSK 1 ramp 3,5,8 then tens; later levels tens; per level ${perLv.join("/")})`, gotT === (3 + Math.ceil((perLv[0] - 16) / 10)) + perLv.slice(1).reduce((a, n) => a + Math.ceil(n / 10), 0));
    // Level boundary (owner export shape): 297 units below HSK 3, 298 in it; a set never straddles.
    const bnd = n => { const q = ownerProg(n); byLv["4"].slice(0, 40).forEach(w => { q.w[w.id] = { r: 5, w: 0, s: 5 }; }); q.sets["4"] = 4; return q; };
    const lvOf = cs => [...new Set(cs.units.map(u => String(u.lv)))].join();
    const b1 = VC.lagCharSet(PACKR, WORDS, CHARACTERS, bnd(587)), b2 = VC.lagCharSet(PACKR, WORDS, CHARACTERS, bnd(595));
    check(`boundary: HSK 3 ends "set ${b1.lvIndex + 1} of ${b1.lvTotal}" with ${b1.units.length} units, all HSK ${lvOf(b1)}`, b1.lv === "3" && b1.lvIndex === 29 && b1.lvTotal === 30 && b1.units.length === 8 && lvOf(b1) === "3");
    check(`boundary: next is HSK ${b2.lv} set ${b2.lvIndex + 1} of ${b2.lvTotal} with ${b2.units.length} units, all HSK ${lvOf(b2)}`, b2.lv === "4" && b2.lvIndex === 0 && b2.lvTotal === 60 && b2.units.length === 10 && lvOf(b2) === "4");
    { const { api } = await bootWith(PACKR, bnd(587), 1); const l = learnLine(api.panel());
      check(`boundary, Today: "${l}"`, l === "字 HSK 3, set 30 of 30"); }
    // Every level of a fresh learner walks the sets of its own units: sizes sum to the level, never straddle, ramp only in HSK 1.
    { const cfgR = VC.charsConfig(PACKR), perLvSizes = []; let below = 0;
      perLv.forEach(n => { perLvSizes.push(VC.levelChunks(cfgR, below, n)); below += n; });
      check(`ramp walk: HSK 1 ${perLvSizes[0].slice(0, 5)}..., later levels tens; sums = level units`, eq(perLvSizes[0].slice(0, 4), [3, 5, 8, 10]) && perLvSizes.every((z, i) => z.reduce((a, b) => a + b, 0) === perLv[i]) && perLvSizes.slice(1).every(z => z.slice(0, -1).every(x => x === 10)));
      check(`short last set: ${perLv.map((n, i) => `HSK ${i + 1}: ${perLvSizes[i][perLvSizes[i].length - 1]}`).join(", ")}`, perLvSizes[0].slice(-1)[0] === 4 && perLvSizes[2].slice(-1)[0] === 8 && perLvSizes[1].slice(-1)[0] === 7);
      const mc = VC.levelChunks({ ramp: [3, 5, 8], setSize: 10 }, 0, 47);
      check(`a level of 47 units (not a multiple of 10): ${mc} ends short`, eq(mc, [3, 5, 8, 10, 10, 10, 1]));
      check("a level starting inside the ramp is cut at the ramp walk: ramp 3,5,8 below 4 -> 4, 8, then tens", eq(VC.levelChunks({ ramp: [3, 5, 8], setSize: 10 }, 4, 30), [4, 8, 10, 8]));
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
