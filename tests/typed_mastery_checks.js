// Typed mastery and per-level character stages (docs/PACK_SCHEMA.md "bareBy"; owner feedback
// 2026-10-02: "writing practice should score more than selection practice", "it takes more than
// 3/6 attempts for mastery"): [1] pack config and validation, [2] core credit / hold / miss floor /
// exemption, [3] planner (typed unit items through dayPlanKinds, their share, no duplicates),
// [4] app on zh as shipped: typed credit per kind, retry and choice fallback give none, choice
// items held, the reveal's streak dots, bare words asked without pinyin, [5] stages per level and
// characters.withWords: Today for fresh, mid HSK 1, mid HSK 2, all words learned mid the old 字
// stage, finished; the Progress chips,
// [6] session resume with typed unit items, [7] control: without the new fields the zh markup
// and progress are byte-identical to main 7fe35f7, [8] gloss fields in typed unit items, [9] the
// withWords Learn turn, [10] answer giveaways (browser check 2026-10-02): a pronInGloss word's
// reading and meaning are never stimulus and answer for each other; pack.optsOneScript option
// sets never have one option in another script.
// Run: node tests/typed_mastery_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const withDayRules = require("./day_rules_patch.js"); // fb10-weak-floor planner rules on old cores
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "7fe35f7"; // main before typed mastery and per-level stages (fb2-gloss merged)
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// glossStyle (fb32) changes every gloss the controls render; tests/gloss_display_checks.js covers it.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = (p => { delete p.pairs; delete p.glossStyle; return p; })((q => { delete q.progressView; return q; })(loadConst(path.join(ZH, "pack.js"), "PACK")));
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const UNIT = Object.fromEntries(CHARACTERS.map(u => [u.id, u]));
const UNIT_OF = new Map(CHARACTERS.map(u => [u.words[0], u]));
// The zh pack before this branch: one stage after HSK 3 for 1-3, one after HSK 4, no bareBy/bareWords.
const preWrite = p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; delete c.withWords; delete c.learn; const o = Object.assign({}, p, { characters: c }); delete o.optsOneScript; delete o.optsMix; delete o.wordsBy; delete o.progressMap; return o; };
const PACK_OFF = preWrite(PACK);
const WITH = (p => { const c = Object.assign({}, p.characters, { withWords: true }); delete c.learn; return Object.assign({}, p, { characters: c }); })(PACK);
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
const stripTags = h => String(h).replace(/<rt[^>]*>[\s\S]*?<\/rt>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
const typedAnswer = it => { const w = BY_ID[String(it.key).slice(2)]; return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w; };
function answer(api, right, typed){
  const it = api.getCur();
  if(it.kind === "type"){ api.el("tin").value = typed != null ? typed : right ? typedAnswer(it) : "zzz not it"; api.el("submit").click(); return; }
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
      CFG.bareBy === "typed" && CFG.bareWords === true && CFG.learn === "lag" && CFG.withWords === false && CFG.stages.map(st => st.after + ":" + st.levels.join() + ":" + st.label).join() === "1:1:字1,2:2:字2,3:3:字3,4:4:字4" && PACK.dayAware === true);
    check("charsConfig: bareBy only \"typed\", bareWords only true, a stage label only a non-empty string",
      VC.charsConfig({ characters: { bareBy: "yes", bareWords: 1, stages: [{ after: "1", levels: ["1"], label: "" }] } }).bareBy === null
      && VC.charsConfig({ characters: { bareWords: 1 } }).bareWords === false && !("label" in VC.charsConfig({ characters: { stages: [{ after: "1", levels: ["1"], label: "" }] } }).stages[0]));
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "typedm-")); const dir = path.join(tmp, "zh");
    fs.cpSync(ZH, dir, { recursive: true });
    const run = () => { try { return { code: 0, out: cp.execSync(`python3 tools/validate_pack.py "${dir}"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch(e){ return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
    const ok = run();
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8"));
    pj.characters.bareBy = "choice"; pj.characters.bareWords = "yes"; pj.characters.withWords = 1; pj.characters.learn = "first"; pj.characters.stages[0].label = "";
    fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(pj));
    cp.execSync(`python3 tools/jsonify_pack.py "${dir}"`, { cwd: ROOT, stdio: "ignore" });
    const bad = run();
    check(`validate_pack: zh passes (exit ${ok.code}); bad bareBy, bareWords, withWords, learn and an empty stage label are errors (exit ${bad.code})`,
      ok.code === 0 && bad.code === 1 && /bareBy must be "typed"/.test(bad.out) && /bareWords must be a boolean/.test(bad.out) && /withWords must be a boolean/.test(bad.out) && /learn must be "lag"/.test(bad.out) && /stages\[0\]\.label must be a non-empty string/.test(bad.out));
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
    check(`miss step: from mastered a miss steps the streak down by one, never below ${M} (5 -> ${B - 1}, ${B - 1} -> ${M}, ${M} -> ${M}, 7 -> 6; held or not), below mastered to 0 (2 -> 0)`,
      eq(after(5, p => VC.markChar(p, u.id, false, PACK, true)), { r: 6, w: 1, s: 4 }) && after(4, p => VC.markChar(p, u.id, false, PACK, false)).s === M && after(M, p => VC.markChar(p, u.id, false, PACK, true)).s === M
      && after(7, p => VC.markChar(p, u.id, false, PACK, false)).s === 6 && after(2, p => VC.markChar(p, u.id, false, PACK, true)).s === 0);
    { const wb = BY_ID[u.words[0]]; const tok = s0 => { const p = at(s0); return [VC.charTier(p.chars.c[u.id].s, PACK), VC.bareWord(wb, CHARACTERS, p, PACK)]; };
      const p5 = at(B); VC.markUnitTyped(p5, CHARACTERS, PACK, wb.id, false); const t5 = [VC.charTier(p5.chars.c[u.id].s, PACK), VC.bareWord(wb, CHARACTERS, p5, PACK)];
      check(`miss at bare ${B} -> ${B - 1}: the token renders ruby (tier ${t5[0]}), not bare, not reading; the word is no longer bare (${t5[1]}); control: at ${B} it was bare (${tok(B)})`,
        p5.chars.c[u.id].s === B - 1 && t5[0] === "ruby" && t5[1] === false && tok(B)[0] === "bare" && tok(B)[1] === true); }
    { const lad = []; let p = at(B); for(let i = 0; i < 4; i++){ VC.markUnitTyped(p, CHARACTERS, PACK, w.id, false); lad.push(p.chars.c[u.id].s); }
      check(`repeated typed misses from ${B}: ${lad.join(" -> ")} (floor ${M}); a flag-off pack resets to 0 at every streak (${[3, 4, 5, 6].map(x => after(x, q => VC.markChar(q, u.id, false, PACK_OFF), PACK_OFF).s).join(",")})`,
        lad.join() === [B - 1, M, M, M].join() && [3, 4, 5, 6].every(x => after(x, q => VC.markChar(q, u.id, false, PACK_OFF), PACK_OFF).s === 0)); }
    check("flag off (bareBy absent, or no pack): markChar is markRec (5 right -> 6, 5 miss -> 0), held ignored",
      after(5, p => VC.markChar(p, u.id, true, PACK_OFF, true), PACK_OFF).s === 6 && after(5, p => VC.markChar(p, u.id, false, PACK_OFF, true), PACK_OFF).s === 0 && after(5, p => VC.markChar(p, u.id, false)).s === 0);
    check("credit: markUnitTyped +1 on the word's recorded unit (4 -> 5, 5 -> 6), a miss steps down (5 -> 4)",
      after(4, p => VC.markUnitTyped(p, CHARACTERS, PACK, w.id, true)).s === 5 && after(5, p => VC.markUnitTyped(p, CHARACTERS, PACK, w.id, true)).s === 6 && after(5, p => VC.markUnitTyped(p, CHARACTERS, PACK, w.id, false)).s === B - 1);
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
    const SH = VC.DAY_TYPED_CONSOLIDATE_SHARE;
    check(`20 Review plans: >= ${Math.ceil(20 * SH)} typed unit items each (share ${SH}; ${tuN / 20} on average), no word twice (${dup}), no choice item for a unit between mastered and bare (${mcBand})`, tuN >= 20 * Math.ceil(20 * SH) && dup === 0 && mcBand === 0 && n === 400);
    const rc = VC.buildRecallPlan(lw, p, PACK, 8, Object.assign({ rng: mulberry32(2) }, o, { size: undefined }));
    check(`Recall plan (8): ${rc.filter(x => x.tu).length} typed unit items (>= ${Math.ceil(8 * SH)})`, rc.length === 8 && rc.filter(x => x.tu).length >= Math.ceil(8 * SH));
    // Typing a word's pinyin logs "type" under w: only: its unit's typed written item stays due.
    { const q = clone(p); VC.dayStart(q, PACK, DAY, true);
      const due = VC.buildReviewPlan(lw, q, PACK, Object.assign({ rng: mulberry32(1) }, o)).filter(x => x.tu).map(x => x.tu);
      due.forEach(id => VC.noteDay(q, PACK, DAY, "w:" + UNIT[id].words[0], "type", true)); VC.dayStart(q, PACK, DAY, true);
      const again = VC.buildReviewPlan(lw, q, PACK, Object.assign({ rng: mulberry32(1) }, o)).filter(x => x.tu).map(x => x.tu);
      const z = clone(p); VC.dayStart(z, PACK, DAY, true); VC.dayStart(z, PACK, DAY, true);
      const ctl = VC.buildReviewPlan(lw, z, PACK, Object.assign({ rng: mulberry32(1) }, o)).filter(x => x.tu).map(x => x.tu);
      const kept = due.filter(id => again.includes(id)).length, kc = due.filter(id => ctl.includes(id)).length;
      check(`pinyin typed right today on the words of ${due.length} due units: ${kept} still planned typed (${kc} with nothing answered; the consolidating share is ${Math.ceil(20 * SH)}), records unchanged`, due.length > 0 && kept >= Math.min(kc, Math.ceil(20 * SH)) && JSON.stringify(q.chars.c) === JSON.stringify(p.chars.c)); }
    // A word with a pending hear/read miss is asked in a kind that settles it: its own item, or the
    // unit's typed item (since fb10-weak-floor a typed answer settles any miss).
    { const q = clone(p); VC.dayStart(q, PACK, DAY, true);
      const ids = unitsAt(q, 4).slice(0, 8);
      ids.forEach(id => VC.noteDay(q, PACK, DAY, "w:" + UNIT[id].words[0], "hear", false)); VC.dayStart(q, PACK, DAY, true);
      const pl = VC.buildReviewPlan(lw, q, PACK, Object.assign({ rng: mulberry32(3) }, o));
      const words = ids.map(id => UNIT[id].words[0]);
      const asTu = pl.filter(x => x.tu && words.includes(x.word.id)).length, own = pl.filter(x => x.word && !x.tu && words.includes(x.word.id));
      check(`8 band units whose words have a pending hear miss: all asked (${own.length} word items, kinds ${[...new Set(own.map(x => x.kind))].join(",")}; ${asTu} as the unit's typed item), each in a kind that settles it`, own.length + asTu === 8 && own.every(x => VC.daySettles(["hear"], x.kind))); }
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
    const r = clone(p); VC.dayStart(r, PACK, DAY, true); const fl = unitsAt(r, 6)[0]; r.chars.c[fl].s = B;
    VC.markChar(r, fl, false, PACK, true); VC.noteDay(r, PACK, DAY, "c:" + fl, "charRead", false); VC.dayStart(r, PACK, DAY, true);
    const rp = VC.buildReviewPlan(lw, r, PACK, Object.assign({ rng: mulberry32(1) }, o));
    check(`a bare unit (${B}) missed by choice steps down to ${B - 1} and comes back typed next drill (${fl} s=${r.chars.c[fl].s})`, r.chars.c[fl].s === B - 1 && rp.some(x => x.tu === fl));
    // Miss floor: a floored unit never reaches the weak tier, so its pending miss must be settleable
    // by the typed item, and after the miss ages out it must still get its consolidating share.
    const cand = VC.dayLog(r, DAY).a["c:" + fl]; const cc = { key: "c:" + fl, rec: r.chars.c[fl], mastered: M, bare: B, kinds: ["type"], alias: "w:" + wordOfUnit(fl).id };
    check(`floored unit with a pending charRead miss: tier 0 for its typed item (${VC.dayTier(cc, VC.dayLog(r, DAY), VC.daySn(r))})`, VC.dayTier(cc, VC.dayLog(r, DAY), VC.daySn(r)) === 0);
    const ag = clone(r); const ae = ag.day.a["c:" + fl]; ae.ma = 1; ae.ms = VC.daySn(ag) - VC.DAY_MISS_MAX_SESSIONS;
    const agTier = VC.dayTier(cc, VC.dayLog(ag, DAY), VC.daySn(ag)); let at = 0;
    for(let k = 1; k <= 30 && !at; k++){
      const pl = VC.buildReviewPlan(lw, ag, PACK, Object.assign({ rng: mulberry32(k) }, o)).filter(x => x.tu);
      if(pl.some(x => x.tu === fl)) at = k;
      pl.forEach(x => { VC.noteDay(ag, PACK, DAY, "c:" + x.tu, "type", true); VC.noteDay(ag, PACK, DAY, "w:" + x.word.id, "type", true); });
      VC.dayStart(ag, PACK, DAY, true);
    }
    check(`after the miss ages out (${VC.DAY_MISS_MAX_SESSIONS} sessions): tier ${agTier} (consolidating), asked typed again in session ${at} (41 units in the band; aged-out first in the consolidating share)`, agTier === 2 && at > 0 && at <= 4);
    // The aged-out mark survives midnight (dayCarry "ag") until a right answer.
    { const z = clone(r); const ze = z.day.a["c:" + fl]; ze.ma = 1; ze.ms = VC.daySn(z) - VC.DAY_MISS_MAX_SESSIONS;
      const nd = VC.dayLog(z, "2026-10-03"); const ne = nd.a["c:" + fl];
      VC.dayStart(z, PACK, "2026-10-03", true);
      const zp = VC.buildReviewPlan(lw, z, PACK, Object.assign({ rng: mulberry32(1) }, o, { today: "2026-10-03" }));
      VC.noteDay(z, PACK, "2026-10-03", "c:" + fl, "type", true);
      check(`after midnight: entry ${JSON.stringify(ne)} (mk dropped, ag kept), first in the consolidating share, cleared by a right answer`, ne && ne.ag === 1 && !ne.mk && zp.some(x => x.tu === fl) && !("ag" in z.day.a["c:" + fl])); }
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
    // "type" under a c: key means typed from the written side only: a typed reading never logs it,
    // so it cannot settle the unit's charRecall miss (scheduler review 2026-10-02).
    check("day log: typed reading answers (pronMeaning, pron) log nothing under the unit", [band[3], band[4]].every(id => !((api.getProg().day.a["c:" + id] || {}).r || []).includes("type")));
    { const B = VC.charsConfig(PACK).bare, s = results[0][2];
      check(`reveal shows the unit's streak as dots after the answer (${stripTags(results[0][3]).slice(0, 14)}; bare ${B} from the pack)`, results[0][3].includes(`aria-label="字 ${s}/${B}"`) && stripTags(results[0][3]).startsWith("字 " + "●".repeat(s) + "○".repeat(B - s))); }
    // Miss, in-drill retry, second-miss choice fallback.
    { const id = band[5]; const it = api.silentWrittenTypeItem(wordOfUnit(id)); api.drill1(it); answer(api, false);
      const floored = rec(id).s; api.el("nx").click(); answer(api, true);
      check(`typed miss on a unit at 4 floors it to ${M}; the in-drill retry right gives no credit (${floored} -> ${rec(id).s})`, floored === M && rec(id).s === M); }
    // Each miss steps down one: bare B -> B-1 (ruby again, pinyin back beside the word), B-1 -> M; the reveal shows the dots.
    { const id = bare[1], wd = wordOfUnit(id); api.getProg().chars.c[id].s = B; const seen = [];
      for(let i = 0; i < 3; i++){ api.drill1(api.silentWrittenTypeItem(wd)); answer(api, false); seen.push([rec(id).s, api.html("rv").includes(`aria-label="字 ${rec(id).s}/${B}"`)]); }
      check(`typed misses from bare ${B}: streak ${seen.map(x => x[0]).join(" -> ")}, reveal dots match (${seen.map(x => x[1]).join(",")}); the word shows its pinyin again once ruby (${stripTags(api.readItem(wd).html).includes(wd.pron)})`,
        seen.map(x => x[0]).join() === [B - 1, M, M].join() && seen.every(x => x[1]) && stripTags(api.readItem(wd).html).includes(wd.pron)); }
    { const id = band[6]; const it = api.meaningTypeItem(wordOfUnit(id), false); api.drill1(it); answer(api, false); api.el("nx").click(); answer(api, false); api.el("nx").click();
      const fb = api.getCur(); const s0 = rec(id).s; const w0 = Object.assign({}, api.getProg().w[wordOfUnit(id).id]); answer(api, true);
      check(`second miss: the choice fallback (${fb.kind}, "${fb.label}") gives the unit nothing (${s0} -> ${rec(id).s}); the word record still counts it (r ${w0.r} -> ${api.getProg().w[wordOfUnit(id).id].r})`,
        fb.kind === "mc" && rec(id).s === s0 && api.getProg().w[wordOfUnit(id).id].r === w0.r + 1); }
    // Choice items on held units.
    { const id = band[7]; const s0 = rec(id).s, r0 = rec(id).r; play(api.charDrillItem("charRead", UNIT[id]), true); const rvHeld = api.html("rv");
      const id2 = band[8]; play(api.charDrillItem("charSound", UNIT[id2]), false);
      const id3 = low[0]; play(api.charDrillItem("charPick", UNIT[id3]), true); const rvLow = api.html("rv");
      check(`choice items: right on a held unit at 4 keeps 4 (r ${r0} -> ${rec(id).r}); a miss at 4 floors to ${M}; below mastered right climbs (1 -> ${rec(id3).s})`, rec(id).s === s0 && rec(id).r === r0 + 1 && rec(id2).s === M && rec(id3).s === 2);
      play(api.readItem(wordOfUnit(band[11])), true); const rvWord = api.html("rv");
      // Dots only where the answer can move the streak (review 2026-10-02).
      check(`dots: on written-side typed and choice below ${M} (${/ucue/.test(results[0][3])}, ${/ucue/.test(rvLow)}); none on pinyin typed (${/ucue/.test(results[3][3]) || /ucue/.test(results[4][3])}), a held unit's choice (${/ucue/.test(rvHeld)}) or a word choice (${/ucue/.test(rvWord)})`,
        /ucue/.test(results[0][3]) && /ucue/.test(rvLow) && !/ucue/.test(results[3][3]) && !/ucue/.test(results[4][3]) && !/ucue/.test(rvHeld) && !/ucue/.test(rvWord)); }
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

  console.log("\n[5] stages per level, characters.withWords: Today for fresh, mid HSK 1, mid HSK 2, all words learned mid the old 字 stage, finished");
  { const PACK = WITH; // the stage model (main 590af86); zh ships characters.learn "lag" (lag_checks.js)
    const segs = h => [...h.matchAll(/<div class="seg">[\s\S]*?<\/i><\/div>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]));
    const learnLine = h => (stripTags((h.match(/<tr><td>2\. Learn<\/td><td>[\s\S]*?<\/td><\/tr>/) || [""])[0]).replace(/^2\. Learn/, ""));
    const withS = (p, n) => Object.assign(clone(p), { sessions: n });
    const today = async p => { const { api } = await bootWith(PACK, p, 1); const h = api.panel(); return { api, h, learn: learnLine(h), card: /id="charChoice"/.test(h), go: /id="go"/.test(h) }; };
    const RESULTS = [];
    // fresh
    let t = await today(null);
    RESULTS.push(["fresh", t.learn]);
    check(`fresh: strip ${segs(t.h).join(" | ")}; Learn ${t.learn}; Start today`, segs(t.h).join("|") === "HSK 1|字1|HSK 2|字2|HSK 3|字3|HSK 4|字4" && /^HSK 1, set 1/.test(t.learn) && t.go && !t.card);
    // mid HSK 1: no 字 stage pending, words every session
    const m1 = VC.normalizeProg({ sets: { "1": 4 }, placedOnce: true, soundsOpened: true }, PACK);
    byLv["1"].slice(0, 40).forEach(w => { m1.w[w.id] = { r: 3, w: 0, s: 3 }; });
    const m1a = await today(withS(m1, 4)), m1b = await today(withS(m1, 5));
    RESULTS.push(["mid HSK 1", m1a.learn + " / " + m1b.learn]);
    check(`mid HSK 1: words every session (${m1a.learn} | ${m1b.learn})`, /^HSK 1, set 5/.test(m1a.learn) && m1a.learn === m1b.learn && m1a.go && m1b.go);
    // mid HSK 2: 字1 unlocked; alternates by session, no card
    const mid = VC.normalizeProg({ sets: { "1": NS("1"), "2": 2 }, placedOnce: true, soundsOpened: true }, PACK);
    byLv["1"].forEach(w => { mid.w[w.id] = { r: 3, w: 0, s: 3 }; }); byLv["2"].slice(0, 20).forEach(w => { mid.w[w.id] = { r: 1, w: 0, s: 1 }; });
    const ev = await today(withS(mid, 6)), od = await today(withS(mid, 7));
    RESULTS.push(["mid HSK 2", ev.learn + " / " + od.learn]);
    check(`mid HSK 2: no card, Start today; sessions alternate (${ev.learn} | ${od.learn})`, !ev.card && !od.card && ev.go && od.go && /^HSK 2, set 3/.test(ev.learn) && /^字1, set 1 of \d+/.test(od.learn));
    check(`mid HSK 2: strip ${segs(ev.h).join(" | ")}`, segs(ev.h).join("|") === "HSK 1|字1|HSK 2|字2|HSK 3|字3|HSK 4|字4");
    // A whole character session, then the next session teaches words.
    { const { api } = await bootWith(PACK, withS(mid, 7), 1); api.el("go").click();
      let guard = 0; while(guard++ < 400){ const D = api.getD(); const h = api.panel();
        if(D && api.getCur() && D.cur){ answer(api, true); api.el("nx").click(); continue; }
        if(/id="again"/.test(h)){ api.el("again").click(); break; }
        const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; }
        const g = (h.match(/<button class="ghost" id="(\w+)"/) || [])[1]; if(g){ api.el(g).click(); continue; } break; }
      const p = api.getProg(); const after = learnLine(api.panel());
      check(`mid HSK 2: a 字1 session records 10 units (${Object.keys(p.chars.c).length}), the next session's Learn is ${after}`, Object.keys(p.chars.c).length === 10 && p.sessions === 8 && /^HSK 2, set 3/.test(after)); }
    // Progress chips: "first" / "with words" / "later" ([11]); later = characters after every word level, reversible.
    { const { api } = await bootWith(PACK, withS(mid, 7), 1); api.goto("progress");
      const ph = api.html("panel");
      const chips = [...String(ph).matchAll(/id="ord(First|Before|After)"[^>]*>([^<]*)</g)].map(m => m[2]);
      check(`Progress chips: ${chips.join(" / ") || "(not rendered)"}`, chips.join("|") === "Characters: first|Characters: with words|Characters: later");
      const later = VC.setCharOrder(withS(mid, 7), true);
      const lt = await today(later);
      check(`"later": Learn ${lt.learn} every session, strip ${segs(lt.h).join(" | ")}`, /^HSK 2, set 3/.test(lt.learn) && segs(lt.h).join("|") === "HSK 1|HSK 2|HSK 3|HSK 4|字" && VC.nextStage(PACK, WORDS, CHARACTERS, withS(later, 8)).kind === "words");
      const back = await today(VC.setCharOrder(clone(later), false));
      check(`"with words" again: Learn ${back.learn}`, /^字1, set 1 of \d+/.test(back.learn)); }
    // all words learned, mid the old single 字 stage (levels 1-3 in one list): characters every
    // session, the first 字3 set teaches only units not yet recorded.
    const all = VC.normalizeProg({ sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": NS("4") }, placedOnce: true, soundsOpened: true }, PACK);
    WORDS.forEach(w => { all.w[w.id] = { r: 4, w: 0, s: 4 }; }); VC.answerCharChoice(all, true);
    const old = VC.charStageUnits(["1", "2", "3"], CHARACTERS, PACK); old.slice(0, 333).forEach(u => { all.chars.c[u.id] = { r: 2, w: 0, s: 6 }; });
    const al0 = await today(withS(all, 10)), al1 = await today(withS(all, 11));
    const cs = VC.nextCharSet(["3"], CHARACTERS, PACK, all), full = VC.charSets(["3"], CHARACTERS, PACK)[cs.index];
    RESULTS.push(["all words, mid old 字", al0.learn + " / " + al1.learn]);
    check(`all words learned mid old 字 stage: characters every session (${al0.learn} | ${al1.learn})`, /^字3, set \d+ of \d+/.test(al0.learn) && al0.learn === al1.learn && al0.go);
    check(`first 字3 set: ${full.length - cs.units.length} recorded units left out, ${cs.units.length} taught, none recorded`, cs.units.length > 0 && cs.units.every(u => !all.chars.c[u.id]) && full.length - cs.units.length > 0);
    // finished
    const fin = clone(all); CHARACTERS.forEach(u => { fin.chars.c[u.id] = { r: 6, w: 0, s: 6 }; });
    const fi = await today(withS(fin, 3));
    RESULTS.push(["finished", fi.learn]);
    check(`finished: Learn ${fi.learn}`, /everything covered/.test(fi.learn) && fi.go);
    console.log("  Today Learn: " + RESULTS.map(r => `${r[0]}: ${r[1]}`).join("; "));
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

  console.log("\n[8] words.noTypedMeaning / pronInGloss / typedSyn (fb2-gloss) in typed unit items");
  {
    const UOW = new Map(CHARACTERS.map(u => [u.words[0], u]));
    const p = seedC(); const ntm = WORDS.filter(w => w.noTypedMeaning && UOW.has(w.id)), pig = WORDS.filter(w => w.pronInGloss && UOW.has(w.id));
    [...ntm, ...pig].forEach(w => { p.chars.c[UOW.get(w.id).id] = { r: 5, w: 0, s: 4 }; });
    const { api } = await bootWith(PACK, p, 4);
    const kindOf = it => it.rz.b + (it.rz.b === "typeMeaning" ? (it.rz.a[1] ? ":pron" : ":written") : "");
    // Each word asked as its unit's typed item over several slot positions and recorded answers.
    const unitKinds = w => { const out = new Set(); for(let i = 0; i < 6; i++){ const pl = Array.from({ length: 6 }, (_, j) => ({ kind: "type", word: w, tu: UOW.get(w.id).id })); out.add(kindOf(api.itemFromPlan(pl[i], i, pl))); } return [...out]; };
    const nk = ntm.map(w => [w.w, unitKinds(w)]);
    check(`noTypedMeaning (${ntm.length} words with a unit): typed unit items never ask a typed meaning (${[...new Set(nk.flatMap(x => x[1]))].join(", ")}), all still typed units`, ntm.length > 0 && nk.every(x => !x[1].includes("typeMeaning:written") && !x[1].includes("typeMeaning:pron") && x[1].every(k => writtenSide({ rz: { b: k.split(":")[0], a: [null, k.endsWith(":pron")] } }))) && ntm.every(w => TU.has(UOW.get(w.id).id)));
    const wordKinds = w => { const out = new Set(); for(let i = 0; i < 6; i++){ const pl = Array.from({ length: 6 }, () => ({ kind: "type", word: w })); out.add(kindOf(api.itemFromPlan(pl[i], i, pl))); } return [...out]; };
    const pk = pig.map(w => [w.w, wordKinds(w), unitKinds(w)]);
    check(`pronInGloss (${pig.map(w => w.w).join(" ")}): never meaning -> pinyin, as a word or a unit item (${[...new Set(pk.flatMap(x => x[1].concat(x[2])))].join(", ")})`, pig.length > 0 && pk.every(x => !x[1].includes("typePron") && !x[2].includes("typePron")));
    // typedSyn: the meaning stimulus accepts the synonym's characters for the word record, but the
    // learner wrote other characters: no unit moves, no c: answer, no dots (review 2026-10-02).
    const sw = WORDS.find(w => (w.typedSyn || []).length && UOW.has(w.id) && UOW.has(w.typedSyn[0]));
    const syw = BY_ID[sw.typedSyn[0]], us = UOW.get(sw.id).id, uy = UOW.get(syw.id).id;
    const q = api.getProg(); q.chars.c[us] = { r: 5, w: 0, s: 4 }; q.chars.c[uy] = { r: 5, w: 0, s: 4 };
    const wr0 = (q.w[sw.id] || {}).r || 0;
    api.drill1(api.silentWrittenTypeItem(sw)); answer(api, true, syw.w);
    let pg = api.getProg(), rv = api.html("rv");
    const cEntry = pg.day && pg.day.a["c:" + us];
    check(`typedSyn: "${syw.w}" typed for ${sw.w}'s meaning is right for the word (r ${wr0} -> ${pg.w[sw.id].r}); units stay ${pg.chars.c[us].s} / ${pg.chars.c[uy].s}, no c: answer (${JSON.stringify(cEntry || null)}), no dots`,
      pg.w[sw.id].r === wr0 + 1 && pg.chars.c[us].s === 4 && pg.chars.c[uy].s === 4 && !(cEntry && (cEntry.r || []).includes("type")) && !/ucue/.test(rv) && /also right/.test(rv));
    const cand = { key: "c:" + us, rec: pg.chars.c[us], mastered: M, bare: B, kinds: ["type"], alias: "w:" + sw.id };
    check(`typedSyn: the unit's typed item stays open (tier ${VC.dayTier(cand, VC.dayLog(pg, DAY), VC.daySn(pg))}, not right today)`, VC.dayTier(cand, VC.dayLog(pg, DAY), VC.daySn(pg)) < 3);
    api.drill1(api.silentWrittenTypeItem(sw)); answer(api, true);
    check(`typedSyn control: ${sw.w} typed itself moves its unit 4 -> ${api.getProg().chars.c[us].s}`, api.getProg().chars.c[us].s === 5);
    // Pinyin side: the synonym's reading typed for the meaning is never unit credit either.
    const q2 = api.getProg(); q2.chars.c[us] = { r: 5, w: 0, s: 4 };
    const pit = api.pronTypeItem(sw); const pok = pit.check(syw.pron);
    api.drill1(api.pronTypeItem(sw)); answer(api, true, syw.pron);
    check(`typedSyn, pinyin side: "${syw.pron}" for ${sw.w} is ${pok ? "right" : "wrong"}; units stay ${api.getProg().chars.c[us].s} / ${api.getProg().chars.c[uy].s}`, api.getProg().chars.c[us].s === 4 && api.getProg().chars.c[uy].s === 4);
  }

  console.log("\n[9] withWords Learn turn (chars.turn): Today closed after Learn still alternates");
  { const PACK = WITH; // the stage model (main 590af86); zh ships characters.learn "lag" (lag_checks.js)
    const learnLine = h => (stripTags((h.match(/<tr><td>2\. Learn<\/td><td>[\s\S]*?<\/td><\/tr>/) || [""])[0]).replace(/^2\. Learn/, ""));
    const reviewLine = h => (stripTags((h.match(/<tr><td>1\. Review<\/td><td>[\s\S]*?<\/td><\/tr>/) || [""])[0]).replace(/^1\. Review/, ""));
    const mid = VC.normalizeProg({ sets: { "1": NS("1"), "2": 2 }, placedOnce: true, soundsOpened: true, sessions: 40 }, PACK);
    byLv["1"].forEach(w => { mid.w[w.id] = { r: 3, w: 0, s: 3 }; }); byLv["2"].slice(0, 20).forEach(w => { mid.w[w.id] = { r: 1, w: 0, s: 1 }; });
    // Plays Today until stop(prog) holds; the app is then closed without finishing.
    const play = (api, stop) => { if(!api.getD()) api.el("go").click(); let guard = 0;
      while(guard++ < 600 && !stop(api.getProg())){ const D = api.getD(); const h = api.panel();
        if(D && api.getCur() && D.cur){ answer(api, true); api.el("nx").click(); continue; }
        const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; }
        const g = (h.match(/<button class="ghost" id="(\w+)"/) || [])[1]; if(g){ api.el(g).click(); continue; } break; }
      return stop(api.getProg()); };
    const kind = l => /^字/.test(l) ? "c" : /^HSK/.test(l) ? "w" : "?";
    const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(mid));
    const seq = [], rev = new Set(); let stopped = true;
    for(let d = 0; d < 10; d++){
      NOW = new Date(2026, 9, 3 + d, 8, 0, 0).getTime();
      const api = await boot(PACK, st, 1); const h = api.panel();
      seq.push(learnLine(h)); rev.add(reviewLine(h));
      const t0 = (api.getProg().chars || {}).turn;
      stopped = play(api, p => (p.chars || {}).turn !== t0 && p.chars.turn !== undefined) && stopped;
    }
    const ks = seq.map(kind);
    check(`10 days, Today closed right after Learn each day: Learn alternates (${ks.join("")}; ${seq.slice(0, 4).join(" | ")} …), sessions unchanged`, stopped && ks.every((k, i) => k !== "?" && (i === 0 || k !== ks[i - 1])) && JSON.parse(st.ls.getItem(VC.storageKey(PACK))).sessions === 40);
    const sizes = new Set([...rev].map(l => l.split(",")[0]));
    check(`Review size the same whatever the turn (${[...sizes].join(" / ")})`, sizes.size === 1 && [...sizes][0] === "20 items");
    // Abandoned before Learn completes: the next Today teaches the same kind.
    NOW = new Date(2026, 9, 20, 8, 0, 0).getTime();
    let api = await boot(PACK, st, 1); const l1 = learnLine(api.panel()); const t1 = api.getProg().chars.turn;
    let n = 0; play(api, () => ++n > 3);
    NOW = new Date(2026, 9, 21, 8, 0, 0).getTime();
    api = await boot(PACK, st, 1); const l2 = learnLine(api.panel());
    check(`closed during Review (before Learn): turn kept (${t1}), next Learn the same (${l1} | ${l2})`, api.getProg().chars.turn === t1 && kind(l1) === kind(l2) && l1 === l2);
    // Reload mid-session (same day): the resumed session teaches the kind it was planned with, and
    // completing that Learn flips the turn.
    NOW = new Date(2026, 9, 22, 8, 0, 0).getTime();
    api = await boot(PACK, st, 1); const l3 = learnLine(api.panel()), t3 = api.getProg().chars.turn;
    n = 0; play(api, () => ++n > 3);
    NOW += 60 * 1000; api = await boot(PACK, st, 2);
    check(`reload mid-session: the drill resumes, turn still ${t3} (${api.getProg().chars.turn})`, !!api.getD() && api.getProg().chars.turn === t3);
    play(api, p => p.chars.turn !== t3);
    check(`resumed session completes its Learn (${l3}) and flips the turn (${t3} -> ${api.getProg().chars.turn})`, api.getProg().chars.turn === (kind(l3) === "w" ? "c" : "w"));
  }

  console.log("\n[10] giveaways: pronInGloss reading <-> meaning, option sets in one script (pack.optsOneScript)");
  {
    const fold = x => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const HAN = /\p{Script=Han}/u, LATIN = /[A-Za-zÀ-ɏ]/;
    const pig = WORDS.filter(w => w.pronInGloss);
    const stimOf = it => stripTags(it.html || "");
    const labelsOf = it => (it.opts || []).map(o => stripTags(it.optHtml ? it.optHtml(o) : o));
    const isMeaningAns = it => it.kind === "mc" ? (it.opts || []).includes(VC.gloss(BY_ID[String(it.key).slice(2)])) && it.a === VC.gloss(BY_ID[String(it.key).slice(2)]) : it.label === "Type the meaning";
    // A leak: meaning answer with the reading in the stimulus, or a gloss stimulus (recall, gap)
    // with readings on the options or a typed reading answer.
    const leak = (it, w) => {
      if(!it) return null;
      if(isMeaningAns(it) && fold(stimOf(it)).includes(fold(w.pron))) return "reading -> meaning: " + it.label + " / " + stimOf(it).replace(/\s+/g, " ").trim().slice(0, 40);
      if(it.label === "Type the pinyin" && !HAN.test(stimOf(it))) return "meaning -> reading typed";
      if(it.kind === "mc" && !isMeaningAns(it) && it.label !== "How is it said?" && labelsOf(it).some(l => LATIN.test(l.replace(/show written/g, "")))) return "meaning -> reading options: " + labelsOf(it).join(" | ");
      return null;
    };
    const tiers = [["pron", 1], ["ruby", 4], ["bare", 6]];
    const sentOf = w => SENTENCES.filter(x => (x.words || []).includes(w.id));
    for(const voiced of [true, false]){
      const { api } = await bootWith(PACK, seedC(), 21, voiced ? {} : { voices: [] });
      const bad = [], kinds = new Set(); let n = 0;
      for(const w of pig){
        const u = UNIT_OF.get(w.id);
        for(const [tn, st] of tiers){
          if(u) api.getProg().chars.c[u.id] = { r: st + 1, w: 0, s: st };
          for(let seed = 1; seed <= 200; seed++){
            Math.random = mulberry32(seed * 7919 + st);
            const items = [api.readItem(w), api.recallItem(w), api.hearItem(w), ...api.learnPair(w)];
            for(const k of ["hear", "read", "recall", "type"]){
              const pl = Array.from({ length: 6 }, () => ({ kind: k, word: w }));
              items.push(api.itemFromPlan(pl[seed % 6], seed % 6, pl));
              if(k === "type" && u){ const pu = Array.from({ length: 6 }, () => ({ kind: k, word: w, tu: u.id })); items.push(api.itemFromPlan(pu[seed % 6], seed % 6, pu)); }
            }
            const ss = sentOf(w); if(ss.length){ const g = api.gapSentence(ss[seed % ss.length]); if(g && g.kind === "mc" && g.a === w.w) items.push(Object.assign({}, g, { key: "w:" + w.id, gap: true })); }
            items.slice().forEach(it => { if(it && typeof it.choiceFallback === "function") items.push(Object.assign(it.choiceFallback(), { fb: true })); });
            for(const it of items){
              n++; kinds.add((it.gap ? "gap:" : it.fb ? "fallback:" : "") + it.label + (it.rz ? "/" + it.rz.b + (it.rz.b === "typeMeaning" ? (it.rz.a[1] ? ":pron" : ":written") : "") : ""));
              if(it.rz && it.rz.b === "typeMeaning" && it.rz.a[1]) bad.push(`${w.w} ${tn}: typed pinyin -> meaning`);
              if(it.rz && it.rz.b === "typePron") bad.push(`${w.w} ${tn}: typed meaning -> pinyin`);
              const l = leak(it, w); if(l) bad.push(`${w.w} ${tn}: ${l}`);
            }
          }
        }
      }
      check(`${voiced ? "voice" : "no voice"}: ${pig.map(w => w.w).join(" ")} x ${tiers.length} tiers x 200 seeds, ${n} items over every kind (${[...kinds].sort().join("; ")}): no reading <-> meaning giveaway${bad.length ? ` (${bad.length}: ${[...new Set(bad)].slice(0, 4).join(" || ")})` : ""}`, n > 0 && bad.length === 0);
    }
    {
      // No voice, word still shown by its reading: the day plan still offers a kind, and its card leaks nothing.
      const { api } = await bootWith(PACK, seedC(), 25, { voices: [] }); const got = [], bad = [];
      for(const w of pig){
        const u = UNIT_OF.get(w.id); if(u) api.getProg().chars.c[u.id] = { r: 2, w: 0, s: 1 };
        const ks = api.dayWordCan ? api.dayWordCan(w) : [];
        for(const k of ks){ const pl = [{ kind: k, word: w }]; Math.random = mulberry32(3); const it = api.itemFromPlan(pl[0], 0, pl); got.push(`${w.w}:${k}=${it ? it.label : "none"}`); if(!it || leak(it, w)) bad.push(`${w.w} ${k}`); }
        if(!ks.length) bad.push(`${w.w}: no kind`);
      }
      check(`no voice, pron tier: every pronInGloss word gets a day card that leaks nothing (${got.join("; ")})${bad.length ? " BAD " + bad.join(", ") : ""}`, got.length > 0 && !bad.length);
    }
    {
      const { api } = await bootWith(PACK, seedC(), 22);
      const w = BY_ID["w0041"]; const u = UNIT_OF.get(w.id); api.getProg().chars.c[u.id] = { r: 2, w: 0, s: 1 };
      check(`placement shows a word through readStimHTML: ${w.w} shown by reading reads ${JSON.stringify(stripTags(api.readStimHTML(w)))}`, /readStimHTML\(w\)/.test(api.placeSrc) && !/bigWordHTML/.test(api.placeSrc) && stripTags(api.readStimHTML(w)) === w.w);
    }
    // Option sets in one script. Labelling layer (what recall and gap call: optScript, then
    // wordOptHtml): every zh word as the answer at both tiers x 200 seeds, three distractors drawn
    // at random from the whole pack (no same-script preference, the worst case) with every unit's
    // streak random per seed. Builders: recall for every word at both tiers and gap for every
    // sentence, one seed each (wordOpts scans the whole pack per set: ~16 ms).
    const oddOne = labels => { const k = labels.filter(l => HAN.test(l)).length; return labels.length > 2 && (k === 1 || k === labels.length - 1); };
    const labelSweep = async (pack, seeds) => {
      const { api } = await bootWith(pack, seedC(), 23);
      const c = api.getProg().chars.c; let sets = 0, odd = 0; const ex = [];
      for(let seed = 1; seed <= seeds; seed++){
        const r = mulberry32(seed * 104729); CHARACTERS.forEach(u => { const s = Math.floor(r() * 7); c[u.id] = { r: s + 1, w: 0, s }; });
        for(const w of WORDS){
          const u = UNIT_OF.get(w.id);
          for(const st of [1, 6]){
            if(u) c[u.id] = { r: st + 1, w: 0, s: st };
            const ds = []; while(ds.length < 3){ const d = WORDS[Math.floor(r() * WORDS.length)]; if(d !== w && !ds.includes(d)) ds.push(d); }
            const byId = {}; [w, ...ds].forEach(e => { byId[e.id] = e; });
            const m = api.optScript ? api.optScript(w, ds) : null;
            const h = m === undefined ? api.wordOptHtml(byId, o => byId[o].w, !!w.pronInGloss) : api.wordOptHtml(byId, o => byId[o].w, !!w.pronInGloss, m);
            const ls = [w, ...ds].map(e => stripTags(h(e.id))); sets++;
            if(oddOne(ls)){ odd++; if(ex.length < 2) ex.push(ls.join(" | ")); }
          }
        }
      }
      return { sets, odd, ex };
    };
    const on = await labelSweep(PACK, 200), off = await labelSweep(PACK_OFF, 3);
    check(`optsOneScript labelling: ${on.sets} option sets (${WORDS.length} words x 2 tiers x 200 seeds, random distractors and unit streaks), none with exactly one option in another script${on.odd ? ` (${on.odd}: ${on.ex.join(" || ")})` : ""}`, on.sets === WORDS.length * 400 && on.odd === 0);
    check(`detector: flag off, the same sets have odd-one-out labels (${off.odd} of ${off.sets}, e.g. ${off.ex[0] || "-"})`, off.odd > 0);
    {
      const { api } = await bootWith(PACK, seedC(), 24);
      const c = api.getProg().chars.c; const r = mulberry32(99); CHARACTERS.forEach(u => { const s = Math.floor(r() * 7); c[u.id] = { r: s + 1, w: 0, s }; });
      let sets = 0, odd = 0, gaps = 0, fb = 0; const ex = [];
      for(const w of WORDS){
        const u = UNIT_OF.get(w.id);
        for(const st of [1, 6]){
          if(u) c[u.id] = { r: st + 1, w: 0, s: st };
          Math.random = mulberry32(w.id.length * 31 + st + sets);
          const it = api.recallItem(w); if(it.label !== "Which word is this?") continue;
          const ls = labelsOf(it); sets++; if(oddOne(ls)){ odd++; if(ex.length < 3) ex.push(`${w.w}: ${ls.join(" | ")}`); }
          if(st === 6 && ls.every(l => !HAN.test(l))) fb++;
        }
        if(u) c[u.id] = { r: 1, w: 0, s: Math.floor(r() * 7) };
      }
      for(const x of SENTENCES){ Math.random = mulberry32(gaps + 5); const g = api.gapSentence(x); if(!g || g.kind !== "mc") continue; gaps++; const ls = labelsOf(g); if(oddOne(ls)){ odd++; if(ex.length < 6) ex.push(`gap ${x.id}: ${ls.join(" | ")}`); } }
      check(`builders: ${sets} recall sets (every word, both tiers) + ${gaps} gap sets (every sentence): none odd-one-out${odd ? ` (${odd}: ${ex.join(" || ")})` : ""}; ${fb} written-tier recall sets fell back to readings`, sets > 2000 && gaps > 500 && odd === 0);
    }
  }

  console.log("\n[11] characters order (chars.order, R5): first / with words / later");
  { const PACK = WITH; // the stage model (main 590af86); zh ships characters.learn "lag" (lag_checks.js)
    const learnLine = h => (stripTags((h.match(/<tr><td>2\. Learn<\/td><td>[\s\S]*?<\/td><\/tr>/) || [""])[0]).replace(/^2\. Learn/, ""));
    const playSession = api => { const s0 = api.getProg().sessions; if(!api.getD()) api.el("go").click(); let guard = 0;
      while(guard++ < 800 && api.getProg().sessions === s0){ const D = api.getD(); const h = api.panel();
        if(D && api.getCur() && D.cur){ answer(api, true); api.el("nx").click(); continue; }
        if(/id="again"/.test(h)) break;
        const b = (h.match(/<button class="next" id="(\w+)"/) || [])[1]; if(b){ api.el(b).click(); continue; }
        const g = (h.match(/<button class="ghost" id="(\w+)"/) || [])[1]; if(g){ api.el(g).click(); continue; } break; }
      return api.getProg().sessions > s0; };
    // Live-engine (3d66aea) shape: HSK 1-3 learned, mid the old single 字 stage (levels 1-3 in one
    // list), 20 字3 units left, HSK 4 not started; no chars.order.
    const old = { v: 1, w: {}, s: {}, sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": 0 }, lessons: {}, sessions: 40, placedOnce: true, soundsOpened: true,
      chars: { v: 1, c: {}, defer: false, choiceSeen: true, mix: true } };
    ["1", "2", "3"].forEach(lv => byLv[lv].forEach(w => { old.w[w.id] = { r: 3, w: 0, s: 3 }; }));
    const list = VC.charStageUnits(["1", "2", "3"], CHARACTERS, PACK); list.slice(0, list.length - 20).forEach(u => { old.chars.c[u.id] = { r: 2, w: 0, s: 3 }; });
    const left3 = VC.charSets(["3"], CHARACTERS, PACK).filter(set => !VC.charSetTaught(set, old)).length;
    const st = fresh(); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(old));
    const seq = []; let ok = true, order0 = null;
    for(let d = 0; d < left3 + 2; d++){
      NOW = new Date(2026, 10, 1 + d, 8, 0, 0).getTime();
      const api = await boot(PACK, st, 1); if(d === 0) order0 = api.getProg().chars.order;
      seq.push(learnLine(api.panel())); ok = playSession(api) && ok;
    }
    const want = [...Array(left3).fill("字3"), "HSK 4", "HSK 4"];
    check(`old single-stage learner mid 字3 (${left3} sets left), HSK 4 unlearned: loads as "${order0}"; Learn ${seq.map(l => l.split(",")[0]).join(" | ")}`,
      ok && order0 === "first" && left3 >= 2 && seq.every((l, i) => l.startsWith(want[i])));
    const fin = JSON.parse(st.ls.getItem(VC.storageKey(PACK)));
    check(`stored after those sessions: chars.order "first", 字3 fully recorded`, fin.chars.order === "first" && VC.charSets(["3"], CHARACTERS, PACK).every(set => VC.charSetTaught(set, fin)));
    fin.sets["4"] = NS("4"); byLv["4"].forEach(w => { fin.w[w.id] = { r: 3, w: 0, s: 3 }; }); st.ls.setItem(VC.storageKey(PACK), JSON.stringify(fin));
    const seq4 = [];
    for(let d = 0; d < 2; d++){ NOW = new Date(2026, 10, 20 + d, 8, 0, 0).getTime(); const api = await boot(PACK, st, 1); seq4.push(learnLine(api.panel())); playSession(api); }
    check(`HSK 4 learned: 字4 unlocked, Learn ${seq4.join(" | ")}`, seq4.every(l => /^字4/.test(l)));
    // Fresh / mid-HSK 2 learner with no unit records: "with words", alternation ([9]).
    const mid = { v: 1, w: {}, s: {}, sets: { "1": NS("1"), "2": 2 }, lessons: {}, sessions: 40, placedOnce: true, soundsOpened: true };
    byLv["1"].forEach(w => { mid.w[w.id] = { r: 3, w: 0, s: 3 }; }); byLv["2"].slice(0, 20).forEach(w => { mid.w[w.id] = { r: 1, w: 0, s: 1 }; });
    const sm = fresh(); sm.ls.setItem(VC.storageKey(PACK), JSON.stringify(mid)); const ms = [];
    let api;
    for(let d = 0; d < 4; d++){ NOW = new Date(2026, 11, 1 + d, 8, 0, 0).getTime(); api = await boot(PACK, sm, 1); ms.push(learnLine(api.panel())); playSession(api); }
    const mk = ms.map(l => /^字/.test(l) ? "c" : "w");
    check(`mid HSK 2, no unit records: "${api.getProg().chars.order}", Learn alternates (${ms.join(" | ")})`, api.getProg().chars.order === "with" && mk.every((k, i) => i === 0 || k !== mk[i - 1]));
    // Chips: three, one on; each switch takes effect at the next Learn and is reversible.
    NOW = new Date(2026, 11, 10, 8, 0, 0).getTime(); api = await boot(PACK, sm, 1); api.goto("progress");
    const chips = h => [...String(h).matchAll(/class="chip ?( on|on)?" id="ord(First|Before|After)"[^>]*>([^<]*)</g)].map(m => (m[1] ? "*" : "") + m[3]);
    const c0 = chips(api.html("panel"));
    check(`Progress chips: ${c0.join(" / ")}`, c0.join("|") === "Characters: first|*Characters: with words|Characters: later");
    const res = [];
    for(const [id, m] of [["ordFirst", "first"], ["ordAfter", "later"], ["ordBefore", "with"], ["ordFirst", "first"]]){
      api.goto("progress"); api.el(id).click(); const p = api.getProg(); const on = chips(api.html("panel")).filter(c => c[0] === "*").join("");
      const nx = [0, 1].map(n => VC.nextStage(PACK, WORDS, CHARACTERS, Object.assign(clone(p), { sessions: n }, { chars: Object.assign({}, p.chars, { turn: n ? "c" : "w" }) })).kind);
      const stored = JSON.parse(sm.ls.getItem(VC.storageKey(PACK))).chars;
      api.today(); const ll = learnLine(api.panel());
      res.push(`${id}: ${on} -> ${nx.join("/")} (${ll.split(",")[0]})`);
      const want = m === "first" ? "chars/chars" : m === "later" ? "words/words" : "words/chars";
      if(!(VC.charOrder(PACK, p) === m && stored.order === p.chars.order && stored.defer === (m === "later") && nx.join("/") === want && (m === "later" ? /^HSK 2/.test(ll) : m === "first" ? /^字1/.test(ll) : true))) res.push("BAD");
    }
    check(`chip switches, stored and applied at the next Learn: ${res.join("; ")}`, !res.includes("BAD"));
  }

  console.log(`\n[7] control: without the new fields the zh markup and progress match main ${MAIN} (with the fb10 day rules, tests/day_rules_patch.js)`);
  {
    let mainHtml = null, mainCore = null;
    try {
      mainHtml = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const src = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const m = { exports: {} }; new Function("module", "exports", "window", "globalThis", withDayRules(src, MAIN))(m, m.exports, undefined, {}); mainCore = m.exports;
    } catch(e){ console.log("    cannot read main: " + e.message); }
    check(`main ${MAIN} engine loaded from git (a missing sha is a failure)`, !!mainHtml && !!mainCore);
    // fb11 control: markChar on a non-typed pack, and on the zh pack below mastered or on a right answer, is unchanged from 7a21ccd.
    { let c11 = null; try { const src = cp.execSync(`git -C "${ROOT}" show 7a21ccd:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26 }); const m = { exports: {} }; new Function("module", "exports", "window", "globalThis", src)(m, m.exports, undefined, {}); c11 = m.exports; } catch(e){ console.log("    cannot read 7a21ccd: " + e.message); }
      const u0 = CHARACTERS[0], run = (core, pk, s0, ok, held) => { const p = core.normalizeProg({}, pk); p.chars.c[u0.id] = { r: s0 + 1, w: 0, s: s0 }; core.markChar(p, u0.id, ok, pk, held); return JSON.stringify(p.chars.c[u0.id]); };
      let same = 0, n = 0, diff = [];
      for(const [pk, name] of [[PACK_OFF, "off"], [PACK, "zh"]]) for(let s0 = 0; s0 <= 8; s0++) for(const ok of [true, false]) for(const held of [false, true]){
        n++; if(run(c11, pk, s0, ok, held) === run(VC, pk, s0, ok, held)) same++; else diff.push(`${name} s${s0} ${ok ? "right" : "miss"}`); }
      check(`markChar vs 7a21ccd over ${n} cases (2 packs x streak 0-8 x right/miss x held): only zh misses at streak >= ${M + 2} differ (at ${M + 1} the step lands on ${M} as before) (${diff.length}: ${[...new Set(diff.map(d => d.replace(/ s\d+/, "")))].join(", ")})`,
        !!c11 && diff.every(d => d.startsWith("zh s") && d.endsWith("miss") && +d.match(/s(\d+)/)[1] > M + 1) && diff.length === 2 * (8 - M - 1)); }
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
      // fb21 (d): the unit hint's pinyin takes the tone colours; main plain-escapes it. Strip the tone spans inside every hint block, nothing else.
      const flatHints = s => { let out = "", i = 0; for(;;){ const j = s.indexOf('<span class="chint">', i); if(j < 0) return out + s.slice(i); let d = 0, k = j; for(const m of s.slice(j).matchAll(/<(\/?)span\b/g)){ d += m[1] ? -1 : 1; if(!d){ k = j + m.index + 7; break; } } out += s.slice(i, j) + s.slice(j, k).replace(/<span class="t\d">([^<]*)<\/span>/g, "$1"); i = k; } };
      a.walk = flatHints(a.walk); b.walk = flatHints(b.walk);
      for(const k of Object.keys(a)){
        let d = 0; while(d < a[k].length && a[k][d] === b[k][d]) d++;
        check(`${k} byte-identical to main (${a[k].length} chars)${a[k] === b[k] ? "" : ` first diff at ${d}: main ${JSON.stringify(a[k].slice(d, d + 80))} vs ${JSON.stringify(b[k].slice(d, d + 80))}`}`, a[k] === b[k] && a[k].length > 100);
      }
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
