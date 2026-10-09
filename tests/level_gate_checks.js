// pack.levelGate (docs/PACK_SCHEMA.md "levelGate"; owner 2026-10-07: the next HSK level opens only when 70% (was 80%; w32)
// of the previous one is known): [1] core (validator-shaped reads, levelKnownPct, hold just under / at the gate, note text),
// [2] Today plan row and Learn step (note, characters still taught, pauseNew), [3] Progress note, [4] flag-off /
// gate-open / no-pairs controls byte-identical to main 9667a81, [5] owner export measurement (read-only),
// [6] sessions until the next level opens on a seeded HSK 1-3 learned record at 85% right.
// [7] pack.levelExam (pinyin / characters levels: known needs the unit's meaning pair on characters levels).
// Run: node tests/level_gate_checks.js [--sessions N] [--acc 0.85] [--noexam]
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, stripFlags } = require("./lib/pack_flags.js");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// appView / progressView v2 are engine default since the flag collapse: the gate is a sentence on Today and Progress.
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK"), PACK_V2 = PACK;
const G = VC.LEVEL_GATE; // 0.7, engine default since the flag collapse (owner, w32 brief)
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));

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

// The simulated clock: todayISO() and Date.now() in the app read it.
const DAY = "2026-10-02";
const DAY_N = Date.UTC(2026, 9, 2) / 864e5;
let NOW = new Date(2026, 9, 2, 8, 0, 0).getTime();
class FakeDate extends Date {
  constructor(...a){ if(a.length) super(...a); else super(NOW); }
  static now(){ return NOW; }
}

let VOICES = [{ lang:"zh-CN", name:"x" }], ACC = 0.85, NO_EXTRA = false; // NO_EXTRA: paused Review at base size (control)
async function boot(pack, st, seed, env){
  Math.random = mulberry32(seed);
  const document = makeFakeDom();
  const voices = VOICES;
  const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(){} };
  const window = { VocabCore: (env && env.core) || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf((env && env.app) || appHtml) + `
let __cur = null; const __log = [];
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; __log.push({ it, step: todayStepState && todayStepState.at }); return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; __log.push({ it, step: todayStepState && todayStepState.at }); return __ty(it); };
${NO_EXTRA ? "learnDrillCount = () => 0;" : ""}
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML,
  getProg: () => prog, getD: () => D, gs: () => gateSentence(), getCur: () => __cur, log: __log, rd: () => RD,
  skipRead: () => { RD = null; todayStep(); },
  lesson: i => { switchToTab("sounds", "Sounds"); soundsSel = i; soundsRender(); },
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(), quit: () => quitDrill(),
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"DaySimChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, [], CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return api;
}

// ------------------------------------------------------------------ item identity
// The drill kind of a shown item, from its resume recipe (it.rz): builder name and arguments.
function kindOf(it){
  const r = it.rz; if(!r) return "?";
  if(r.from) return kindOf(r.from);
  if(r.b === "char") return r.a[0];
  if(r.b === "sGap") return r.a[1] ? "gapType" : "gap";
  if(r.b === "sHear") return "hear";
  if(r.b === "sRead") return "read";
  if(/^type/.test(r.b)) return "type";
  return r.b;
}
// characters.bareBy "typed": a written-side typed word item (meaning -> characters, characters ->
// meaning or pinyin) also answers the word's recorded character unit (core.js markUnitTyped), so
// unit metrics count it under the unit's key too (drilled entry `also`).
const writtenSide = r => !!r && (r.b === "typeWrittenSilent" || r.b === "typeWritten" || r.b === "typeWrittenPron" || (r.b === "typeMeaning" && !r.a[1]));
const UNIT_OF_WORD = new Map(CHARACTERS.map(u => [u.words[0], u]));
// The in-drill retry after a typed miss (typedMisses) gives the unit nothing (app markUnitTyped).
function unitAlso(it, prog, pack){
  if(!VC.typedBareOn(pack) || !writtenSide(it.rz) || !String(it.key).startsWith("w:") || (it.typedMisses || 0) > 0) return undefined;
  const u = UNIT_OF_WORD.get(it.key.slice(2));
  return u && prog.chars && prog.chars.c[u.id] ? "c:" + u.id : undefined;
}
// Each drilled entry, plus one under its unit's key for an entry that also answered a unit.
const withAlso = drilled => drilled.flatMap(d => d.also ? [d, Object.assign({}, d, { key: d.also, kind: "type" })] : [d]);
// Harder kinds after easier ones: an item is "harder" than what was done when its rank is higher.
const typedAnswer = it => {
  const w = BY_ID[String(it.key).slice(2)];
  if(!w || !String(it.key).startsWith("w:")) return null;
  return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w;
};
function answer(api, right){
  const it = api.getCur();
  if(it.kind === "type"){
    const v = right ? typedAnswer(it) : null;
    api.el("tin").value = v || "zzz not it"; api.el("submit").click(); return;
  }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}

// ------------------------------------------------------------------ seeded mid-course progress
// Words: the first `nWords` in rank order (sets counters to match) with mixed streaks/misses and a
// last-seen day `t` 0..20 days back; character units of the first `nUnits` learned words; sentence
// records on part of what is available.
function seedProg(pack, nWords, nUnits, seed){
  const r = mulberry32(seed);
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 30 }, pack);
  const byLv = VC.wordsByLevel(WORDS, pack); const size = VC.setSizeOf(pack);
  let left = nWords;
  for(const lv of VC.levelIds(pack)){
    const list = byLv[lv]; const take = Math.min(left, list.length);
    p.sets[lv] = Math.floor(take / size);
    list.slice(0, take).forEach(w => {
      const s = Math.floor(r() * 9), wr = r() < 0.5 ? 0 : 1 + Math.floor(r() * 3);
      p.w[w.id] = { r: s + 1 + Math.floor(r() * 4), w: wr, s, t: DAY_N - 1 - Math.floor(r() * 20) };
    });
    left -= take; if(!left) break;
  }
  p.chars.choiceSeen = true;
  const learned = new Set(Object.keys(p.w));
  const units = CHARACTERS.filter(u => learned.has(u.words[0])).slice(0, nUnits);
  units.forEach(u => { const s = Math.floor(r() * 7); p.chars.c[u.id] = { r: s + 1, w: r() < 0.6 ? 0 : 1 + Math.floor(r() * 2), s, t: DAY_N - 1 - Math.floor(r() * 20) }; });
  const avail = VC.availableSentences(SENTENCES, WORDS, pack, p);
  avail.forEach(s => { if(r() < 0.5){ const st = Math.floor(r() * 4); p.s[s.id] = { r: st + 1, w: r() < 0.6 ? 0 : 1, s: st, t: DAY_N - 1 - Math.floor(r() * 20) }; } });
  return p;
}

// ------------------------------------------------------------------ one simulated day
async function playDay(pack, seedP, sessions, seed, gapMs, onSession){
  const st = { ls: memStore(), ss: memStore() };
  st.ls.setItem(VC.storageKey(pack), JSON.stringify(seedP));
  const api = await boot(pack, st, seed);
  const ans = mulberry32(seed * 7919 + 1);
  const drilled = [];   // { sess, step, key, kind, ok }
  const learnNew = [];  // per session: new words/units first recorded
  for(let sn = 0; sn < sessions; sn++){
    NOW = typeof gapMs === "function" ? gapMs(sn) : NOW + (gapMs || 60 * 60 * 1000);
    const before = api.getProg();
    const had = new Set([...Object.keys(before.w).map(k => "w:" + k), ...Object.keys((before.chars || {}).c || {}).map(k => "c:" + k)]);
    if(!/id="go"/.test(api.panel())) throw new Error(`session ${sn + 1}: no Start today button`);
    api.el("go").click();
    for(let guard = 0; guard < 2000; guard++){
      const html = api.panel();
      const D = api.getD();
      if(D && api.getCur() && D.cur){
        const it = api.getCur(); const ok = ans() < ACC;
        drilled.push({ sess: sn, step: api.log[api.log.length - 1].step, key: it.key, kind: kindOf(it), ok, also: unitAlso(it, api.getProg(), pack), gw: gapWord(it) });
        answer(api, ok); api.el("nx").click(); continue;
      }
      if(/id="again"/.test(html)){ api.el("again").click(); break; }
      if(/id="ok"/.test(html) && !D){ api.el("ok").click(); continue; }
      if(/id="dr"/.test(html)){ api.el("dr").click(); continue; }
      if(api.rd()){ api.skipRead(); continue; }
      throw new Error(`session ${sn + 1}: stuck on ${html.slice(0, 200)}`);
    }
    const after = api.getProg();
    const now = [...Object.keys(after.w).map(k => "w:" + k), ...Object.keys((after.chars || {}).c || {}).map(k => "c:" + k)];
    learnNew.push(now.filter(k => !had.has(k)).length);
    if(onSession) onSession(sn, api);
  }
  return { drilled, learnNew, prog: api.getProg(), api };
}

const argv = process.argv.slice(2);
const N_SESSIONS = argv.includes("--sessions") ? +argv[argv.indexOf("--sessions") + 1] : 30;
if(argv.includes("--acc")) ACC = +argv[argv.indexOf("--acc") + 1];
const cp = require("child_process"), os = require("os");
const MAIN = "9667a81"; // main before levelGate
const git = f => cp.execSync(`git -C "${ROOT}" show ${MAIN}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
let OLD = null, OLD_APP = null;
try { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lg-")), "core_old.js"); fs.writeFileSync(f, git("engine/core.js")); OLD = require(f); OLD_APP = git("engine/app.html"); } catch(e){ OLD = null; }
const OWNER = (() => { for(const f of [process.env.PAIRS_OWNER, "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json", path.join(ROOT, "..", "chinese", ".cache", "owner-progress.json")]) if(f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); return null; })();
const gapWord = () => undefined;
const clone = x => JSON.parse(JSON.stringify(x));
const LV = VC.levelIds(PACK), BYLV = VC.wordsByLevel(WORDS, PACK), SIZE = VC.setSizeOf(PACK);
const todayHtml = async (pack, prog, env) => { const st = { ls: memStore(), ss: memStore() }; st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog)); NOW = new Date(2026, 9, 2, 9, 0, 0).getTime(); const api = await boot(pack, st, 3, env); return { api, html: api.panel() }; };
// appView v2 Today: the Learn step is the set line plus the gate sentence as one quiet line under it.
const learnRow = html => { const m = html.match(/<div class="tst"><span>Learn<\/span><div class="tsd">([^<]*)(?:<div class="pvs pvgate">([^<]*)<\/div>)?<\/div><\/div>/); return m ? { line: m[1], gate: m[2] || "" } : null; };
const gateWords = (lv, prev, pct) => `${VC.levelLabel(PACK, lv)} opens at ${G * 100}% of ${VC.levelLabel(PACK, prev)} known. Now ${pct}%`;
const strip = h => h.replace(/<!--[\s\S]*?-->/g, "");

// A record with levels 1..upTo fully taught; the last of them has exactly `known` words at streak 5 (known), the rest at 0.
function seed(upTo, known, pack, extra){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 30 }, pack);
  LV.slice(0, upTo).forEach((lv, i) => {
    BYLV[lv].forEach((w, j) => { const k = i < upTo - 1 || j < known; p.w[w.id] = { r: k ? 6 : 1, w: 0, s: k ? 5 : 0, t: DAY_N - 1 - (j % 9) }; });
    p.sets[lv] = VC.nSets(BYLV[lv], SIZE);
  });
  p.chars.choiceSeen = true;
  if(extra) extra(p);
  return p;
}
// Characters of every learned word recorded, so the lag rule has nothing to teach.
const charsAll = p => { const l = new Set(Object.keys(p.w)); CHARACTERS.filter(u => l.has(u.words[0])).forEach(u => { p.chars.c[u.id] = { r: 6, w: 0, s: 6, t: DAY_N - 1 }; }); };

(async () => {
  const L2 = BYLV[LV[1]].length, need = Math.ceil(G * L2 - 1e-9);
  console.log(`\n[1] core: LEVEL_GATE, levelKnownPct, hold just under / at ${G * 100}%`);
  check("level gate is engine default at 0.7 (flag collapse): VC.LEVEL_GATE, zh carries no levelGate key", VC.LEVEL_GATE === 0.7 && !("levelGate" in PACK));
  const hold = seed(2, need - 1, PACK), open = seed(2, need, PACK);
  const pctHold = Math.floor(VC.levelKnownPct(WORDS, PACK, hold, LV[1]) * 100);
  check(`levelKnownPct: ${need - 1} of ${L2} known = ${(VC.levelKnownPct(WORDS, PACK, hold, LV[1]) * 100).toFixed(1)}%, ${need} = ${(VC.levelKnownPct(WORDS, PACK, open, LV[1]) * 100).toFixed(1)}%`, VC.levelKnownPct(WORDS, PACK, hold, LV[1]) < G && VC.levelKnownPct(WORDS, PACK, open, LV[1]) >= G);
  const h = VC.levelGateHold(WORDS, PACK, hold);
  check(`gate holds at ${pctHold}% (${need - 1}/${L2}): lv ${h && h.lv}, prev ${h && h.prev}`, !!h && h.lv === LV[2] && h.prev === LV[1] && h.pct === pctHold);
  check(`gate opens at ${need}/${L2} known`, VC.levelGateHold(WORDS, PACK, open) === null);
  check("note text: next level waits · level at pct% known", VC.levelGateNote(WORDS, PACK, hold) === `${VC.levelLabel(PACK, LV[2])} waits · ${VC.levelLabel(PACK, LV[1])} at ${pctHold}% known`);
  check("nextNewSetOpen: null while held, the level's set when open; nextNewSet unchanged", VC.nextNewSetOpen(WORDS, PACK, hold) === null && VC.nextNewSetOpen(WORDS, PACK, open).lv === LV[2] && VC.nextNewSet(WORDS, PACK, hold).lv === LV[2]);
  check("the first level is never gated (fresh record)", VC.levelGateHold(WORDS, PACK, VC.normalizeProg({}, PACK)) === null && VC.nextNewSetOpen(WORDS, PACK, VC.normalizeProg({}, PACK)).lv === LV[0]);
  const mid = seed(1, 10, PACK);
  mid.sets[LV[0]] = 3; BYLV[LV[0]].slice(30).forEach(w => delete mid.w[w.id]);
  check("within a level nothing changes: a part-taught first level keeps teaching its words", VC.nextNewSetOpen(WORDS, PACK, mid).lv === LV[0] && VC.levelGateHold(WORDS, PACK, mid) === null);
  const sh = VC.todaySnapshot(PACK, WORDS, CHARACTERS, (q => { charsAll(q); return q; })(seed(2, need - 1, PACK)), []);
  check("held and no character due: the Learn stage is null (nothing from words)", sh.stage === null);
  const path_ = VC.stagePath(PACK, WORDS, CHARACTERS, hold, []);
  check("stagePath marks the held level and later word stages gated; earlier stages untouched", path_.filter(s => s.kind === "words").every(s => !!s.gated === (LV.indexOf(s.lv) >= 2 && !s.done)) && !VC.stagePath(PACK, WORDS, CHARACTERS, open, []).some(s => s.gated));

  console.log(`\n[2] Today: plan row, Learn step, characters, pauseNew`);
  const T1 = await todayHtml(PACK, charsAll(hold) || hold, null);
  const note = VC.levelGateNote(WORDS, PACK, hold);
  const r1 = learnRow(T1.html) || {};
  check(`Learn row says why: "${r1.gate}"`, r1.line === "" && r1.gate === T1.api.gs() && r1.gate.startsWith(gateWords(LV[2], LV[1], pctHold)));
  const T0 = await todayHtml(PACK, (q => { charsAll(q); return q; })(seed(2, need, PACK)), null);
  const r0 = learnRow(T0.html) || {};
  check(`gate open: the Learn row names the level set ("${r0.line}")`, /^HSK 3, set 1/.test(r0.line || "") && !r0.gate && !/pvgate/.test(T0.html));
  // characters: the lag rule still teaches a set of characters while the words wait
  const cp_ = seed(2, need - 1, PACK);
  const T2 = await todayHtml(PACK, cp_, null);
  const sc = VC.todaySnapshot(PACK, WORDS, CHARACTERS, cp_, []);
  check(`characters still taught: stage ${sc.stage && sc.stage.kind}, ${sc.cset ? sc.cset.units.length : 0} units; row "${(learnRow(T2.html) || {}).line}"`, !!sc.stage && sc.stage.kind === "chars" && !!sc.cset && sc.cset.units.length > 0 && !!(learnRow(T2.html) || {}).line && (learnRow(T2.html) || {}).gate === T2.api.gs() && !!T2.api.gs());
  T2.api.el("go").click();
  await tick();
  const before = Object.keys(T2.api.getProg().w).length;
  for(let g = 0; g < 400 && !/id="again"/.test(T2.api.panel()); g++){
    const html = T2.api.panel(), D = T2.api.getD();
    if(D && T2.api.getCur() && D.cur){ answer(T2.api, true); T2.api.el("nx").click(); continue; }
    if(/id="ok"/.test(html) && !D){ T2.api.el("ok").click(); continue; }
    if(/id="dr"/.test(html)){ T2.api.el("dr").click(); continue; }
    if(T2.api.rd()){ T2.api.skipRead(); continue; }
    break;
  }
  const after = T2.api.getProg();
  const newW = Object.keys(after.w).filter(id => !hold.w[id]).length, newC = Object.keys(after.chars.c).length;
  check(`a held session teaches 0 words and some characters (words +${newW}, characters ${newC})`, newW === 0 && newC > 0);
  // pauseNew: paused drops the Learn row (and the note); the pause chip still toggles it back
  const pz = clone(hold); charsAll(pz); pz.pause = 1;
  const TP = await todayHtml(PACK, pz, null);
  check("paused + held: no Learn row, no note on Today", learnRow(TP.html) === null && !/pvgate/.test(TP.html));
  const pu = clone(pz); delete pu.pause;
  check("unpaused: the note is back", ((learnRow((await todayHtml(PACK, pu, null)).html) || {}).gate || "").startsWith(gateWords(LV[2], LV[1], pctHold)));
  // (paused vs gate-off control deleted: pack.levelGate went in the flag collapse, there is no gate off)

  console.log(`\n[3] Progress note`);
  const PR = await todayHtml(PACK, hold, null); PR.api.clickTab("progress");
  const ph = PR.api.panel();
  // (the v1 Progress table row check went with progressView v1 in the flag collapse; v2 below)
  {
    // progressView v2: one quiet line inside the waiting level's block, nothing from the old rows.
    const V = await todayHtml(PACK_V2, hold, null); V.api.clickTab("progress"); const vh = V.api.panel();
    const at = vh.indexOf(`<span>${VC.levelLabel(PACK, LV[2])}</span>`), gi = vh.indexOf(`<p class="pvs pvgate">${V.api.gs()}</p>`);
    check("v2: the note is one quiet line inside the waiting level's block, after its bar", at >= 0 && gi > at && vh.slice(at, gi).indexOf("<div class=\"pvl") < 0 && (vh.match(/pvgate/g) || []).length === 1 && V.api.gs().startsWith(gateWords(LV[2], LV[1], pctHold)) && !/<table class="stats"><tr><td>HSK/.test(vh));
  }
  const PO = await todayHtml(PACK, open, null); PO.api.clickTab("progress");
  check("gate open: no note", !/waits/.test(PO.api.panel()));

  // [4] (flag-off controls vs main) deleted: the level gate is engine default since the flag collapse.

  console.log(`\n[5] owner export (read-only)`);
  if(!OWNER) console.log("  (no owner export: skipped)");
  else {
    const o = clone(OWNER); const rows = LV.map(lv => `${VC.levelLabel(PACK, lv)} ${(VC.levelKnownPct(WORDS, PACK, o, lv, CHARACTERS) * 100).toFixed(1)}%`);
    const hd = VC.levelGateHold(WORDS, PACK, o, CHARACTERS);
    console.log(`  known per level: ${rows.join(", ")}; gate on the next level: ${hd ? `HELD at ${hd.pct}%` : "open"}; next level ${(VC.nextNewSet(WORDS, PACK, o) || {}).lv}`);
    const known3 = (() => { const ub = new Map(CHARACTERS.map(u => [u.words[0], u])); return BYLV[LV[2]].filter(w => { const r = o.w[w.id]; if(!VC.wordKnown(r, w, PACK)) return false; const u = ub.get(w.id); if(!u) return true; const ur = o.chars && o.chars.c && o.chars.c[u.id]; const e = ur && ur.p && ur.p.wm; return (e ? e[0] : ur ? VC.pairState(ur, "wm").s : 0) >= VC.BARE_PAIR; }).length; })();
    check("owner export: HSK 3 known share equals an independent count of known words over the level", Math.abs(VC.levelKnownPct(WORDS, PACK, o, LV[2], CHARACTERS) - known3 / BYLV[LV[2]].length) < 1e-9 && LV.every(lv => { const v = VC.levelKnownPct(WORDS, PACK, o, lv, CHARACTERS); return v >= 0 && v <= 1; }) && (known3 / BYLV[LV[2]].length >= G) === (hd === null));
    const ou = clone(o); delete ou.pause; // the export is paused: unpaused, as the learner would see the plan
    const T = await todayHtml(PACK, ou, null);
    check("owner export Today: the Learn row matches the gate decision", hd ? (learnRow(T.html) || {}).gate === T.api.gs() && T.api.gs().startsWith(gateWords(hd.lv, hd.prev, hd.pct)) : !/pvgate/.test(T.html));
  }

  console.log(`\n[6] seeded HSK 1-3 learned record (595 words + 595 units, streak 0-8), ${N_SESSIONS} Today sessions at ${Math.round(ACC * 100)}% right, 7 a day`);
  {
    const P6 = argv.includes("--noexam") ? (p => { delete p.levelExam; return p; })(Object.assign({}, PACK)) : PACK;
    const p0 = seedProg(P6, 595, 595, 11);
    const lvl4 = VC.nextNewSet(WORDS, P6, p0).lv;
    const pct0 = VC.levelKnownPct(WORDS, P6, p0, LV[2], CHARACTERS);
    NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
    let openedAt = -1, taught4 = -1; const pcts = [];
    const day = await playDay(P6, p0, N_SESSIONS, 5, sn => sn % 7 === 0 ? new Date(2026, 9, 2 + sn / 7, 7, 0, 0).getTime() : NOW + 60 * 60 * 1000, (sn, api) => {
      const q = api.getProg(); const v = VC.levelKnownPct(WORDS, P6, q, LV[2], CHARACTERS); pcts.push(Math.floor(v * 100));
      if(openedAt < 0 && !VC.levelGateHold(WORDS, P6, q, CHARACTERS)) openedAt = sn + 1;
      if(taught4 < 0 && BYLV[LV[3]].some(w => q.w[w.id])) taught4 = sn + 1;
    });
    console.log(`  HSK 3 known at start ${(pct0 * 100).toFixed(1)}% (next level ${lvl4}); after each session ${pcts.join(", ")}%; gate open after session ${openedAt < 0 ? "never within " + N_SESSIONS : openedAt}; first HSK 4 word taught in session ${taught4 < 0 ? "never" : taught4}`);
    check(`the gate held at the start and the sim ran ${N_SESSIONS} sessions`, pct0 < G && day.learnNew.length === N_SESSIONS);
    check(`no HSK 4 word is taught before the gate opens (opened ${openedAt}, first taught ${taught4})`, openedAt > 0 && taught4 >= 0 && taught4 >= openedAt);
  }
  console.log(`\n[7] levelExam: pinyin vs characters levels`);
  const NOEXAM = (p => { delete p.levelExam; return p; })(Object.assign({}, PACK));
  check("levelExamOn: zh ships it and reads on; off without characters, without a characters level, absent", PACK.levelExam && VC.levelExamOn(PACK) && !VC.levelExamOn((p => { delete p.characters; return p; })(Object.assign({}, PACK))) && !VC.levelExamOn(Object.assign({}, PACK, { levelExam: { "1": "pinyin", "3": "pinyin" } })) && !VC.levelExamOn(NOEXAM));
  // HSK 1-3 taught, every word known; unit records vary
  const exam = unitRec => { const p = seed(3, BYLV[LV[2]].length, PACK); LV.slice(0, 3).forEach(lv => BYLV[lv].forEach(w => { const u = CHARACTERS.find(c => c.words[0] === w.id); if(u && unitRec) p.chars.c[u.id] = clone(unitRec); })); return p; };
  const W3 = BYLV[LV[2]], W1 = BYLV[LV[0]], UBW = new Map(CHARACTERS.map(u => [u.words[0], u]));
  const k = (p, w) => VC.wordKnownX(p.w[w.id], w, PACK, p, VC.knownCtx(PACK, CHARACTERS));
  const w3 = W3.find(w => UBW.has(w.id)), w1 = W1.find(w => UBW.has(w.id));
  const unanswered = exam({ r: 1, w: 0, s: 1, t: DAY_N - 1 });
  check("characters level: word pairs known but the unit never answered and a low legacy streak: not known; pinyin level: known", !k(unanswered, w3) && k(unanswered, w1));
  const booted = exam({ r: 4, w: 0, s: 4, t: DAY_N - 1 });
  check("characters level: an old unit record (streak 4, no pair data) boots the meaning pair at known", k(booted, w3));
  const ans = (s0, pair) => exam({ r: 4, w: 0, s: 0, t: DAY_N - 1, p: { wm: pair } });
  check("characters level: unit wm answered at 2 is known, at 1 is not (the boot never overrides an answered pair)", k(ans(0, [2, 5]), w3) && !k(ans(0, [1, 5]), w3));
  // Word-side pair answers happen with the reading shown (pronFirst / lag): they never judge the hanzi.
  const withWord = (p, w, wm) => { p.w[w.id].p = { wm }; return p; };
  check("characters level: unit unrecorded + word wm [3, 5] answered: not known (word stream ignored)", !k(withWord(exam(null), w3, [3, 5]), w3));
  check("characters level: unit wm [0, 3] older than word wm [3, 6]: not known", !k(withWord(exam({ r: 4, w: 0, s: 0, t: DAY_N - 1, p: { wm: [0, 3] } }), w3, [3, 6]), w3));
  // (a word's own wm miss already fails the word rule, wordKnown, whatever the unit holds)
  check("characters level: unit wm [2, 3] + a newer word wm [3, 6]: known; unit wm [2, 3] + word wm miss [0, 6]: not known (word rule)", k(withWord(exam({ r: 4, w: 0, s: 0, t: DAY_N - 1, p: { wm: [2, 3] } }), w3, [3, 6]), w3) && !k(withWord(exam({ r: 4, w: 0, s: 0, t: DAY_N - 1, p: { wm: [2, 3] } }), w3, [0, 6]), w3));
  check("characters level: unit with a legacy streak 4 + word wm [3, 6]: boots known; legacy streak 1 + word wm [3, 6]: not known", k(withWord(exam({ r: 4, w: 0, s: 4, t: DAY_N - 1 }), w3, [3, 6]), w3) && !k(withWord(exam({ r: 1, w: 0, s: 1, t: DAY_N - 1 }), w3, [3, 6]), w3));
  const pctNo = VC.levelKnownPct(WORDS, NOEXAM, unanswered, LV[2], CHARACTERS), pctYes = VC.levelKnownPct(WORDS, PACK, unanswered, LV[2], CHARACTERS);
  check(`levelKnownPct on the characters level drops (${(pctNo * 100).toFixed(1)}% -> ${(pctYes * 100).toFixed(1)}%), the pinyin level is unchanged`, pctYes < pctNo && VC.levelKnownPct(WORDS, NOEXAM, unanswered, LV[0], CHARACTERS) === VC.levelKnownPct(WORDS, PACK, unanswered, LV[0], CHARACTERS));
  const g3 = (PACK.progressMap.goals || []).find(g => String(g.upTo) === LV[2]);
  check("goalPosition and progressPosition drop on a characters level", VC.goalPosition(unanswered, PACK, g3, WORDS, CHARACTERS, []) < VC.goalPosition(unanswered, NOEXAM, g3, WORDS, CHARACTERS, []) && VC.progressPosition(unanswered, PACK, WORDS, CHARACTERS, []) < VC.progressPosition(unanswered, NOEXAM, WORDS, CHARACTERS, []));
  const gatedP = (() => { const p = exam({ r: 1, w: 0, s: 1, t: DAY_N - 1 }); return p; })(), openP = exam({ r: 4, w: 0, s: 4, t: DAY_N - 1 });
  const gh = VC.levelGateHold(WORDS, PACK, gatedP, CHARACTERS);
  check(`levelGate on HSK 4 holds while HSK 3's hanzi are unread (${gh && gh.pct}% known), opens once they are`, !!gh && gh.lv === LV[3] && VC.levelGateHold(WORDS, NOEXAM, gatedP, CHARACTERS) === null && VC.levelGateHold(WORDS, PACK, openP, CHARACTERS) === null);
  // Progress rows count known on the characters level
  const PRx = await todayHtml(PACK, gatedP, null); PRx.api.clickTab("progress"); PRx.api.el("pvAll").click();
  const PRn = await todayHtml(NOEXAM, gatedP, null); PRn.api.clickTab("progress"); PRn.api.el("pvAll").click();
  // v2 level bars (Show all): aria-label "HSK n: L of S learned, M mastered"
  const mrow = (html, lv) => +(html.match(new RegExp(`aria-label="${VC.levelLabel(PACK, lv)}: \\d+ of \\d+ learned, (\\d+) mastered"`)) || [])[1];
  check(`Progress rows: HSK 3 mastered count drops (${mrow(PRn.api.panel(), LV[2])} -> ${mrow(PRx.api.panel(), LV[2])}), HSK 1 unchanged`, mrow(PRx.api.panel(), LV[2]) < mrow(PRn.api.panel(), LV[2]) && mrow(PRx.api.panel(), LV[0]) === mrow(PRn.api.panel(), LV[0]));
  {
    // progressView v2 rows and folded line count mastered by the exam rule too; the gate note sits in HSK 4's block.
    const V = await todayHtml(PACK_V2, gatedP, null); V.api.clickTab("progress"); const vh = V.api.panel();
    const lw = VC.learnedWords(WORDS, PACK, gatedP), size = lv => BYLV[lv].length;
    const kn = lv => lw.filter(w => w.lv === lv && k(gatedP, w)).length, kw = lv => lw.filter(w => w.lv === lv && VC.wordKnown(gatedP.w[w.id], w, PACK)).length;
    const bar = lv => { const m = vh.match(new RegExp(`<span>${VC.levelLabel(PACK, lv)}</span>[\\s\\S]*?<i class="pvm" style="width:([\\d.]+)%"></i>`)); return m ? +m[1] : NaN; };
    const pct = (n, d) => Math.round(Math.min(1, n / d) * 1000) / 10;
    check(`v2: HSK 3 bar is the exam count (${kn(LV[2])} of ${size(LV[2])}, word rule ${kw(LV[2])})`, kn(LV[2]) < kw(LV[2]) && bar(LV[2]) === pct(kn(LV[2]), size(LV[2])));
    const low = (vh.match(/id="pvLow"[^>]*><span>[^<]*<\/span><span class="pvn">(\d+) of (\d+) mastered/) || []).slice(1).map(Number);
    check(`v2: folded line counts by the exam rule (${low.join(" of ")})`, low.length === 2 && low[0] === kn(LV[0]) + kn(LV[1]) && low[1] === lw.filter(w => w.lv === LV[0] || w.lv === LV[1]).length);
    const n4 = V.api.gs(), a4 = vh.indexOf(`<span>${VC.levelLabel(PACK, LV[3])}</span>`), g4 = vh.indexOf(`<p class="pvs pvgate">${n4}</p>`);
    check(`v2: "${n4}" inside the HSK 4 block`, !!n4 && a4 >= 0 && g4 > a4 && vh.slice(a4, g4).indexOf("<div class=\"pvl") < 0);
    const tot = VC.progressTotals(gatedP, PACK_V2, WORDS, CHARACTERS, []).m;
    check(`v2 hero mastered total is the exam count (${tot})`, tot === lw.filter(w => k(gatedP, w)).length);
  }
  if(OLD){
    const own = [["fresh", VC.normalizeProg({}, PACK)], ["unanswered", unanswered], ["open-shaped", open]];
    for(const [name, p] of own){
      const sg = C => JSON.stringify([(PACK.progressMap.goals || []).map(g => C.goalPosition(clone(p), NOEXAM, g, WORDS, CHARACTERS, [])), C.progressPosition(clone(p), NOEXAM, WORDS, CHARACTERS, [])]);
      check(`flag off (no levelExam): goal and progress positions identical to main on ${name}`, sg(VC) === sg(OLD));
    }
    // (the flag-off Progress control vs main went with pack.levelGate in the flag collapse)
    check("levelGate alone (no levelExam) is the word rule: levelKnownPct equals the pre-exam value", VC.levelKnownPct(WORDS, NOEXAM, unanswered, LV[2], CHARACTERS) === VC.levelKnownPct(WORDS, NOEXAM, unanswered, LV[2]));
  }
  if(OWNER){
    const o = clone(OWNER), pc = (P, lv) => (VC.levelKnownPct(WORDS, P, o, lv, CHARACTERS) * 100).toFixed(1);
    console.log(`  owner export known %, levelExam off -> on: ${LV.map(lv => `${VC.levelLabel(PACK, lv)} ${pc(NOEXAM, lv)} -> ${pc(PACK, lv)}`).join(", ")}; HSK 4 gate ${VC.levelGateHold(WORDS, NOEXAM, o, CHARACTERS) ? "held" : "open"} -> ${VC.levelGateNote(WORDS, PACK, o, CHARACTERS) || "open"}`);
    check("owner export: HSK 1-2 unchanged, HSK 3 drops", pc(NOEXAM, LV[0]) === pc(PACK, LV[0]) && pc(NOEXAM, LV[1]) === pc(PACK, LV[1]) && +pc(PACK, LV[2]) < +pc(NOEXAM, LV[2]));
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
