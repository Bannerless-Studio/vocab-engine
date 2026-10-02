// Typed mastery and per-level character stages (docs/PACK_SCHEMA.md "bareBy"; owner feedback
// 2026-10-02: "writing practice should score more than selection practice", "it takes more than
// 3/6 attempts for mastery"): [1] pack config and validation, [2] core credit / hold / miss floor /
// exemption, [3] planner (typed unit items through dayPlanKinds, their share, no duplicates),
// [4] app on zh as shipped: typed credit per kind, retry and choice fallback give none, choice
// items held, the reveal's streak dots, bare words asked without pinyin, [5] stages per level and
// the Today plan for (a) a fresh user, (b) one mid HSK 2, (c) one in the characters stage,
// [6] session resume with typed unit items, [7] control: without the new fields the zh markup
// and progress are byte-identical to main 8023572.
// Run: node tests/typed_mastery_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "8023572"; // main before typed mastery and per-level stages
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const UNIT = Object.fromEntries(CHARACTERS.map(u => [u.id, u]));
const UNIT_OF = new Map(CHARACTERS.map(u => [u.words[0], u]));
// The zh pack before this branch: one stage after HSK 3 for 1-3, one after HSK 4, no bareBy/bareWords.
const preWrite = p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; return Object.assign({}, p, { characters: c }); };
const PACK_OFF = preWrite(PACK);
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
  const voices = [{ lang:"zh-CN", name:"x" }];
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
const stripTags = h => String(h).replace(/<rt[^>]*>[\s\S]*?<\/rt>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
const typedAnswer = it => { const w = BY_ID[String(it.key).slice(2)]; return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w; };
function answer(api, right){
  const it = api.getCur();
  if(it.kind === "type"){ api.el("tin").value = right ? typedAnswer(it) : "zzz not it"; api.el("submit").click(); return; }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}
// Seed: HSK 1-3 words learned, choice answered "start", the first 60 HSK 1 units recorded:
// 20 at streak 4 (between mastered and bare), 10 at 6 (bare), 10 at 1, 20 at 3.
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
function seedC(){
  const p = VC.normalizeProg({ sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": 0 }, placedOnce: true, soundsOpened: true, sessions: 40 }, PACK);
  ["1", "2", "3"].forEach(lv => byLv[lv].forEach(w => { p.w[w.id] = { r: 4, w: 0, s: 4 }; }));
  VC.answerCharChoice(p, true);
  VC.charStageUnits(["1"], CHARACTERS, PACK).slice(0, 60).forEach((u, i) => { const s = i < 20 ? 4 : i < 30 ? 6 : i < 40 ? 1 : 3; p.chars.c[u.id] = { r: s + 1, w: 0, s }; });
  return p;
}
const unitsAt = (p, s) => Object.keys(p.chars.c).filter(id => p.chars.c[id].s === s);
const wordOfUnit = id => BY_ID[UNIT[id].words[0]];
const WRITTEN_LABELS = ["Type the characters", "Type the meaning", "Type the pinyin"];
const writtenSide = it => { const r = it && it.rz; return !!r && (r.b === "typeWrittenSilent" || r.b === "typeWritten" || r.b === "typeWrittenPron" || (r.b === "typeMeaning" && !r.a[1])); };
const qsig = api => { const D = api.getD(); return D ? [D.cur, ...D.q].filter(Boolean).map(it => it.key + "|" + it.label + "|" + (it.rz ? it.rz.b : "")).join() : ""; };

(async function main(){
  const CFG = VC.charsConfig(PACK), M = CFG.mastered, B = CFG.bare;
  const AMB = VC.typedAmbiguity(WORDS);
  const TU = VC.typedUnitWords(CHARACTERS, WORDS, PACK, AMB);

  console.log("\n[1] pack config and validation");
  {
    check("zh ships characters.bareBy \"typed\", bareWords, one stage per level labelled 字1..字4, dayAware",
      CFG.bareBy === "typed" && CFG.bareWords === true && CFG.stages.map(st => st.after + ":" + st.levels.join() + ":" + st.label).join() === "1:1:字1,2:2:字2,3:3:字3,4:4:字4" && PACK.dayAware === true);
    check("charsConfig: bareBy only \"typed\", bareWords only true, a stage label only a non-empty string",
      VC.charsConfig({ characters: { bareBy: "yes", bareWords: 1, stages: [{ after: "1", levels: ["1"], label: "" }] } }).bareBy === null
      && VC.charsConfig({ characters: { bareWords: 1 } }).bareWords === false && !("label" in VC.charsConfig({ characters: { stages: [{ after: "1", levels: ["1"], label: "" }] } }).stages[0]));
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "typedm-")); const dir = path.join(tmp, "zh");
    fs.cpSync(ZH, dir, { recursive: true });
    const run = () => { try { return { code: 0, out: cp.execSync(`python3 tools/validate_pack.py "${dir}"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch(e){ return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
    const ok = run();
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8"));
    pj.characters.bareBy = "choice"; pj.characters.bareWords = "yes"; pj.characters.stages[0].label = "";
    fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(pj));
    cp.execSync(`python3 tools/jsonify_pack.py "${dir}"`, { cwd: ROOT, stdio: "ignore" });
    const bad = run();
    check(`validate_pack: zh passes (exit ${ok.code}); bad bareBy, bareWords and an empty stage label are errors (exit ${bad.code})`,
      ok.code === 0 && bad.code === 1 && /bareBy must be "typed"/.test(bad.out) && /bareWords must be a boolean/.test(bad.out) && /stages\[0\]\.label must be a non-empty string/.test(bad.out));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n[2] core: credit, hold, miss floor, exemption");
  {
    const u = CHARACTERS[0], w = BY_ID[u.words[0]];
    const at = (s, pk) => { const p = VC.normalizeProg({}, pk || PACK); p.chars.c[u.id] = { r: s + 1, w: 0, s }; return p; };
    const after = (s, f, pk) => { const p = at(s, pk); f(p); return p.chars.c[u.id]; };
    check("hold: a held unit at 4 gains no streak from a right choice answer (r +1); below mastered it climbs as before (1 -> 2, 2 -> 3)",
      eq(after(4, p => VC.markChar(p, u.id, true, PACK, true)), { r: 6, w: 0, s: 4 }) && after(1, p => VC.markChar(p, u.id, true, PACK, true)).s === 2 && after(2, p => VC.markChar(p, u.id, true, PACK, true)).s === 3);
    check("exempt (not held): a right choice answer still climbs to bare (5 -> 6)", after(5, p => VC.markChar(p, u.id, true, PACK, false)).s === 6);
    check(`miss floor: from mastered a miss drops to ${M} (5, 7 -> ${M}; held or not), below mastered to 0 (2 -> 0)`,
      eq(after(5, p => VC.markChar(p, u.id, false, PACK, true)), { r: 6, w: 1, s: M }) && after(7, p => VC.markChar(p, u.id, false, PACK, false)).s === M && after(2, p => VC.markChar(p, u.id, false, PACK, true)).s === 0);
    check("flag off (bareBy absent, or no pack): markChar is markRec (5 right -> 6, 5 miss -> 0), held ignored",
      after(5, p => VC.markChar(p, u.id, true, PACK_OFF, true), PACK_OFF).s === 6 && after(5, p => VC.markChar(p, u.id, false, PACK_OFF, true), PACK_OFF).s === 0 && after(5, p => VC.markChar(p, u.id, false)).s === 0);
    check("credit: markUnitTyped +1 on the word's recorded unit (4 -> 5, 5 -> 6), a miss floors (5 -> 3)",
      after(4, p => VC.markUnitTyped(p, CHARACTERS, PACK, w.id, true)).s === 5 && after(5, p => VC.markUnitTyped(p, CHARACTERS, PACK, w.id, true)).s === 6 && after(5, p => VC.markUnitTyped(p, CHARACTERS, PACK, w.id, false)).s === M);
    { const p = VC.normalizeProg({}, PACK); const r = VC.markUnitTyped(p, CHARACTERS, PACK, w.id, true);
      check("credit: no record is created for an untaught unit; flag off credits nothing", r === null && !(u.id in p.chars.c) && VC.markUnitTyped(at(4, PACK_OFF), CHARACTERS, PACK_OFF, w.id, true) === null); }
    const exempt = CHARACTERS.filter(x => !TU.has(x.id));
    check(`exemption on zh: ${TU.size} of ${CHARACTERS.length} units typeable from the written side; ${exempt.length} exempt (meaning -> characters needs only a written form)`, TU.size + exempt.length === CHARACTERS.length && TU.size > 0);
    // A pack whose only written-side kind is writtenMeaning (typing object, typedFrom written):
    // a shared spelling or a missing gloss leaves the unit exempt.
    const syn = { typing: {}, typedFrom: ["written"], characters: { bareBy: "typed", stages: [{ after: "1", levels: ["1"] }], learnKinds: ["charRead"], reviewKinds: ["charRead"] } };
    const ws = [{ id: "a1", w: "行", en: "to walk" }, { id: "a2", w: "行", en: "row" }, { id: "a3", w: "好", en: "" }, { id: "a4", w: "人", en: "person" }];
    const us = ws.map(x => ({ id: "c" + x.id, t: x.w, words: [x.id], lv: "1" }));
    const tu = VC.typedUnitWords(us, ws, syn);
    check("exemption: shared spelling (行 x2) and no gloss (好) are exempt; 人 is typed; no written-side kind at all (typing object, no typedFrom) exempts every unit",
      [...tu.keys()].join() === "ca4" && VC.typedUnitWords(us, ws, Object.assign({}, syn, { typedFrom: undefined })).size === 0 && VC.typedUnitWords(us, ws, PACK_OFF).size === 0);
  }

  console.log("\n[3] planner: typed unit items in Review / Recall");
  {
    const p = seedC(); const lw = VC.learnedWords(WORDS, PACK, p);
    const o = { size: 20, units: CHARACTERS, canHear: () => true, today: DAY, typedUnits: TU };
    let tuN = 0, dup = 0, mcBand = 0, n = 0;
    for(let seed = 1; seed <= 20; seed++){
      const pl = VC.buildReviewPlan(lw, p, PACK, Object.assign({ rng: mulberry32(seed) }, o));
      n += pl.length; tuN += pl.filter(x => x.tu).length;
      const ids = pl.filter(x => x.word).map(x => x.word.id); dup += ids.length - new Set(ids).size;
      mcBand += pl.filter(x => x.unit && TU.has(x.unit.id) && p.chars.c[x.unit.id].s >= M && p.chars.c[x.unit.id].s < B).length;
      if(seed === 1) check(`Review plan: ${pl.length} items, typed unit items { kind: "type", word, tu } (${pl.filter(x => x.tu).map(x => x.tu).join(" ")})`, pl.length === 20 && pl.filter(x => x.tu).every(x => x.kind === "type" && x.word === TU.get(x.tu)));
    }
    check(`20 Review plans: >= ${Math.ceil(20 * VC.DAY_CONSOLIDATE_SHARE)} typed unit items each on average (${tuN / 20}), no word twice (${dup}), no choice item for a unit between mastered and bare (${mcBand})`, tuN >= 20 * Math.ceil(20 * VC.DAY_CONSOLIDATE_SHARE) && dup === 0 && mcBand === 0 && n === 400);
    const rc = VC.buildRecallPlan(lw, p, PACK, 8, Object.assign({ rng: mulberry32(2) }, o, { size: undefined }));
    check(`Recall plan (8): ${rc.filter(x => x.tu).length} typed unit items (>= ${Math.ceil(8 * VC.DAY_CONSOLIDATE_SHARE)})`, rc.length === 8 && rc.filter(x => x.tu).length >= Math.ceil(8 * VC.DAY_CONSOLIDATE_SHARE));
    const noTU = VC.buildReviewPlan(lw, p, PACK, Object.assign({ rng: mulberry32(1) }, o, { typedUnits: undefined }));
    check("without opts.typedUnits the planner asks those units by choice, as before", !noTU.some(x => x.tu) && noTU.some(x => x.unit));
    // A unit typed right today is not asked again while others are due.
    const q = clone(p); VC.dayStart(q, PACK, DAY, true);
    const first = VC.buildReviewPlan(lw, q, PACK, Object.assign({ rng: mulberry32(1) }, o)).filter(x => x.tu).map(x => x.tu);
    first.forEach(id => { VC.markUnitTyped(q, CHARACTERS, PACK, UNIT[id].words[0], true); VC.noteDay(q, PACK, DAY, "c:" + id, "type", true); VC.noteDay(q, PACK, DAY, "w:" + UNIT[id].words[0], "type", true); });
    VC.dayStart(q, PACK, DAY, true);
    const second = VC.buildReviewPlan(lw, q, PACK, Object.assign({ rng: mulberry32(1) }, o)).filter(x => x.tu).map(x => x.tu);
    check(`next session: units typed right are not asked again (${first.join(" ")} | ${second.join(" ")})`, first.length > 0 && second.length > 0 && !second.some(id => first.includes(id)));
    // A floored unit (missed today) comes first, typed.
    const r = clone(p); VC.dayStart(r, PACK, DAY, true); const fl = unitsAt(r, 6)[0];
    VC.markChar(r, fl, false, PACK, true); VC.noteDay(r, PACK, DAY, "c:" + fl, "charRead", false); VC.dayStart(r, PACK, DAY, true);
    const rp = VC.buildReviewPlan(lw, r, PACK, Object.assign({ rng: mulberry32(1) }, o));
    check(`a bare unit missed by choice drops to ${M} and comes back typed next drill (${fl} s=${r.chars.c[fl].s})`, r.chars.c[fl].s === M && rp.some(x => x.tu === fl));
  }

  console.log("\n[4] app (zh as shipped): typed credit, hold, fallback, reveal dots, bare words");
  {
    const { api } = await bootWith(PACK, seedC(), 3);
    const band = unitsAt(api.getProg(), 4), bare = unitsAt(api.getProg(), 6), low = unitsAt(api.getProg(), 1);
    // Typed unit items only take written-side kinds.
    const kinds = band.map(id => api.itemFromPlan({ kind: "type", word: wordOfUnit(id), tu: id }, 0, null)).map(it => it.rz && it.rz.b + (it.rz.b === "typeMeaning" ? (it.rz.a[1] ? ":pron" : ":written") : ""));
    const plans = band.map(id => { const pl = [{ kind: "type", word: wordOfUnit(id), tu: id }]; return api.itemFromPlan(pl[0], 0, pl); });
    check(`typed unit items take written-side kinds only (${[...new Set(plans.map(it => it.rz.b + (it.rz.b === "typeMeaning" ? (it.rz.a[1] ? ":pron" : ":written") : "")))].join(", ")})`, plans.length === 20 && plans.every(writtenSide) && kinds.length === 20);
    const play = (it, ok) => { api.drill1(it); answer(api, ok); };
    const rec = id => Object.assign({}, api.getProg().chars.c[id]);
    // Credit by kind.
    const results = [];
    for(const [label, mk] of [["written (meaning -> characters)", e => api.silentWrittenTypeItem(e)], ["writtenMeaning", e => api.meaningTypeItem(e, false)], ["writtenPron", e => api.writtenPronTypeItem(e)], ["pronMeaning", e => api.meaningTypeItem(e, true)], ["pron", e => api.pronTypeItem(e)]]){
      const id = band[results.length]; const before = rec(id).s; play(mk(wordOfUnit(id)), true);
      results.push([label, before, rec(id).s, api.html("rv")]);
    }
    check(`credit: written, writtenMeaning, writtenPron +1; pronMeaning, pron none (${results.map(r => `${r[0]} ${r[1]}->${r[2]}`).join("; ")})`,
      results.slice(0, 3).every(r => r[2] === r[1] + 1) && results.slice(3).every(r => r[2] === r[1]));
    check("day log: a typed credit logs the unit right in kind \"type\"", (api.getProg().day.a["c:" + band[0]].r || []).includes("type"));
    check(`reveal shows the unit's streak as dots after the answer (${stripTags(results[0][3]).slice(0, 14)})`, results[0][3].includes(`aria-label="字 5/6"`) && stripTags(results[0][3]).startsWith("字 ●●●●●○"));
    // Miss, in-drill retry, second-miss choice fallback.
    { const id = band[5]; const it = api.silentWrittenTypeItem(wordOfUnit(id)); api.drill1(it); answer(api, false);
      const floored = rec(id).s; api.el("nx").click(); answer(api, true);
      check(`typed miss on a unit at 4 floors it to ${M}; the in-drill retry right gives no credit (${floored} -> ${rec(id).s})`, floored === M && rec(id).s === M); }
    { const id = band[6]; const it = api.meaningTypeItem(wordOfUnit(id), false); api.drill1(it); answer(api, false); api.el("nx").click(); answer(api, false); api.el("nx").click();
      const fb = api.getCur(); const s0 = rec(id).s; const w0 = Object.assign({}, api.getProg().w[wordOfUnit(id).id]); answer(api, true);
      check(`second miss: the choice fallback (${fb.kind}, "${fb.label}") gives the unit nothing (${s0} -> ${rec(id).s}); the word record still counts it (r ${w0.r} -> ${api.getProg().w[wordOfUnit(id).id].r})`,
        fb.kind === "mc" && rec(id).s === s0 && api.getProg().w[wordOfUnit(id).id].r === w0.r + 1); }
    // Choice items on held units.
    { const id = band[7]; const s0 = rec(id).s, r0 = rec(id).r; play(api.charDrillItem("charRead", UNIT[id]), true);
      const id2 = band[8]; play(api.charDrillItem("charSound", UNIT[id2]), false);
      const id3 = low[0]; play(api.charDrillItem("charPick", UNIT[id3]), true);
      check(`choice items: right on a held unit at 4 keeps 4 (r ${r0} -> ${rec(id).r}); a miss at 4 floors to ${M}; below mastered right climbs (1 -> ${rec(id3).s})`, rec(id).s === s0 && rec(id).r === r0 + 1 && rec(id2).s === M && rec(id3).s === 2); }
    // Bare words asked without the pinyin beside the characters; reveals keep it.
    const wb = wordOfUnit(bare[0]), wr = wordOfUnit(band[9]);
    const rd = it => stripTags(it.html);
    check(`bare word (${wb.w}): read item shows ${JSON.stringify(rd(api.readItem(wb)))} (no pinyin); a ruby-tier word (${wr.w}) keeps it ${JSON.stringify(rd(api.readItem(wr)))}`,
      !rd(api.readItem(wb)).includes(wb.pron) && rd(api.readItem(wb)).includes(wb.w) && rd(api.readItem(wr)).includes(wr.pron));
    check("bare word: the reveal, the Words row still show its pinyin", stripTags(api.revealBlock(wb)).includes(wb.pron) && stripTags(api.wordRowHTML(wb)).includes(wb.pron));
    const ri = api.recallItem(wb), lab = ri.opts.map(o => ri.optHtml(o));
    check(`recall options: the bare answer has no pinyin beside it (${stripTags(lab[0])})`, !lab[0].includes('class="op"') && lab[0].includes(wb.w));
    // Pinyin hidden for bare only with bareWords; dots only with bareBy.
    const { api: off } = await bootWith(PACK_OFF, seedC(), 3);
    off.drill1(off.silentWrittenTypeItem(wordOfUnit(band[10]))); answer(off, true);
    check("flag off (bareBy/bareWords absent): bare word read item keeps its pinyin, no dots, no unit credit",
      stripTags(off.readItem(wb).html).includes(wb.pron) && !/ucue/.test(off.html("rv")) && off.getProg().chars.c[band[10]].s === 4);
  }

  console.log("\n[5] stages per level: the path strip and the Today plan for (a) fresh, (b) mid HSK 2, (c) in the characters stage");
  {
    const segs = h => [...h.matchAll(/<div class="seg">[\s\S]*?<\/i><\/div>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]));
    const learnLine = h => (stripTags((h.match(/<tr><td>2\. Learn<\/td><td>[\s\S]*?<\/td><\/tr>/) || [""])[0]).replace(/^2\. Learn/, ""));
    const { api: a } = await bootWith(PACK, null, 1);
    let h = a.panel();
    check(`(a) fresh: strip ${segs(h).join(" | ")}; Learn ${learnLine(h)}; Start today`, segs(h).join("|") === "HSK 1|字1|HSK 2|字2|HSK 3|字3|HSK 4|字4" && /^HSK 1, set 1/.test(learnLine(h)) && /id="go"/.test(h));
    const mid = VC.normalizeProg({ sets: { "1": NS("1"), "2": 2 }, placedOnce: true, soundsOpened: true, sessions: 5 }, PACK);
    byLv["1"].forEach(w => { mid.w[w.id] = { r: 3, w: 0, s: 3 }; }); byLv["2"].slice(0, 20).forEach(w => { mid.w[w.id] = { r: 1, w: 0, s: 1 }; });
    const { api: b } = await bootWith(PACK, mid, 1);
    h = b.panel();
    const card = stripTags((h.match(/<div class="stmt" id="charChoice">[\s\S]*?<\/div>/) || [""])[0]);
    check(`(b) mid HSK 2: choice card "${card}", no Start until answered`, /字1 next/.test(card) && /Skip to HSK 2/.test(card) && /do 字1 after HSK 4/.test(card) && !/id="go"/.test(h));
    b.el("choiceSkip").click(); h = b.panel();
    check(`(b) skip: Learn ${learnLine(h)}, strip ${segs(h).join(" | ")}`, /^HSK 2, set 3/.test(learnLine(h)) && segs(h).join("|") === "HSK 1|HSK 2|HSK 3|HSK 4|字");
    const { api: b2 } = await bootWith(PACK, mid, 1); b2.el("choiceStart").click(); h = b2.panel();
    check(`(b) start: Learn ${learnLine(h)}`, /^字1, set 1 of \d+/.test(learnLine(h)) && /id="go"/.test(h));
    const { api: c } = await bootWith(PACK, seedC(), 1); h = c.panel();
    check(`(c) in the characters stage: Learn ${learnLine(h)} (the first set with an unrecorded unit, as before), no card`, /^字1, set 7 of \d+/.test(learnLine(h)) && !/id="charChoice"/.test(h) && /id="go"/.test(h));
  }

  console.log("\n[6] session resume with typed unit items");
  {
    const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(seedC()));
    NOW = new Date(2026, 9, 2, 9, 0, 0).getTime();
    let api = await boot(PACK, st, 5);
    api.el("go").click();
    const D = api.getD(); const items = [D.cur, ...D.q].filter(Boolean);
    const tuItems = items.filter(writtenSide);
    check(`Today Review holds typed written-side items (${tuItems.length} of ${items.length})`, tuItems.length >= Math.ceil(20 * VC.DAY_CONSOLIDATE_SHARE));
    for(let i = 0; i < 4; i++){ answer(api, i !== 1); api.el("nx").click(); }
    const before = { q: qsig(api), c: JSON.stringify(api.getProg().chars.c) };
    api = await boot(PACK, st, 99);
    check("reload: same queue (keys, labels, builders), unit records unchanged", !!api.getD() && qsig(api) === before.q && JSON.stringify(api.getProg().chars.c) === before.c);
    let guard = 0; while(api.getD() && api.getD().cur && guard++ < 60){ answer(api, true); api.el("nx").click(); }
    check("the resumed Review plays to its results screen", !api.getD() && /id="ok"/.test(api.panel()));
  }

  console.log(`\n[7] control: without the new fields the zh markup and progress match main ${MAIN}`);
  {
    let mainHtml = null, mainCore = null;
    try {
      mainHtml = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const src = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const m = { exports: {} }; new Function("module", "exports", "window", "globalThis", src)(m, m.exports, undefined, {}); mainCore = m.exports;
    } catch(e){ console.log("    cannot read main: " + e.message); }
    check(`main ${MAIN} engine loaded from git (a missing sha is a failure)`, !!mainHtml && !!mainCore);
    async function run(html, core){
      NOW = new Date(2026, 9, 2, 9, 0, 0).getTime();
      const st = fresh(); st.ls.setItem(VC.storageKey(PACK_OFF), JSON.stringify(seedC()));
      const api = await boot(PACK_OFF, st, 11, { html, core });
      const out = { today: api.panel() };
      api.el("go").click();
      const ans = mulberry32(7); const seen = [];
      for(let i = 0; i < 400; i++){
        const h = api.panel();
        if(api.getD() && api.getD().cur){ seen.push(h); answer(api, ans() < 0.8); seen.push(api.html("rv")); api.el("nx").click(); continue; }
        if(api.rd()){ api.skipRead(); continue; }
        seen.push(h);
        if(/id="again"/.test(h)) break;
        if(/id="ok"/.test(h)){ api.el("ok").click(); continue; }
        if(/id="dr"/.test(h)){ api.el("dr").click(); continue; }
        break;
      }
      out.walk = seen.join("\n----\n");
      const p = api.getProg(); out.prog = JSON.stringify({ w: p.w, c: p.chars.c, s: p.s, sets: p.sets });
      return out;
    }
    if(mainHtml && mainCore){
      const a = await run(mainHtml, mainCore), b = await run(undefined, undefined);
      for(const k of Object.keys(a)){
        let d = 0; while(d < a[k].length && a[k][d] === b[k][d]) d++;
        check(`${k} byte-identical to main (${a[k].length} chars)${a[k] === b[k] ? "" : ` first diff at ${d}: main ${JSON.stringify(a[k].slice(d, d + 80))} vs ${JSON.stringify(b[k].slice(d, d + 80))}`}`, a[k] === b[k] && a[k].length > 100);
      }
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
