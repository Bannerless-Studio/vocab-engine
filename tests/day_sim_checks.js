// Many Today sessions in one day (docs/PACK_SCHEMA.md "dayAware"): boots engine/app.html on zh in
// the fake DOM of tests/session_resume_checks.js, seeds a mid-course progress, then plays
// N consecutive Today sessions on one simulated date with a seeded answer model (85% right),
// logging every drilled item (unit key, kind). Reports, per session, the share of items whose
// unit was already answered right earlier that day (same kind / any kind), units touched vs
// available, units missed that day that never came back, "due" units (weakest-oldest and
// mastered-longest-unseen at the day's start) never drilled, new material per session.
// Runs each scenario twice: pack.dayAware removed (control, numbers only) and as shipped
// (thresholds). Passages are left out: the Read stage drills no units.
// Run: node tests/day_sim_checks.js [--sessions N] [--quiet]
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK_ON = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const argv = process.argv.slice(2);
const N_SESSIONS = argv.includes("--sessions") ? +argv[argv.indexOf("--sessions") + 1] : 8;
const QUIET = argv.includes("--quiet"), WHY = argv.includes("--why");

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

async function boot(pack, st, seed){
  Math.random = mulberry32(seed);
  const document = makeFakeDom();
  const voices = [{ lang:"zh-CN", name:"x" }];
  const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(){} };
  const window = { VocabCore: VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf(appHtml) + `
let __cur = null; const __log = [];
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; __log.push({ it, step: todayStepState && todayStepState.at }); return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; __log.push({ it, step: todayStepState && todayStepState.at }); return __ty(it); };
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML,
  getProg: () => prog, getD: () => D, getCur: () => __cur, log: __log, rd: () => RD,
  skipRead: () => { RD = null; todayStep(); },
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
async function playDay(pack, seedP, sessions, seed){
  const st = { ls: memStore(), ss: memStore() };
  st.ls.setItem(VC.storageKey(pack), JSON.stringify(seedP));
  const api = await boot(pack, st, seed);
  const ans = mulberry32(seed * 7919 + 1);
  const drilled = [];   // { sess, step, key, kind, ok }
  const learnNew = [];  // per session: new words/units first recorded
  for(let sn = 0; sn < sessions; sn++){
    NOW += 60 * 60 * 1000;
    const before = api.getProg();
    const had = new Set([...Object.keys(before.w).map(k => "w:" + k), ...Object.keys((before.chars || {}).c || {}).map(k => "c:" + k)]);
    if(!/id="go"/.test(api.panel())) throw new Error(`session ${sn + 1}: no Start today button`);
    api.el("go").click();
    for(let guard = 0; guard < 2000; guard++){
      const html = api.panel();
      const D = api.getD();
      if(D && api.getCur() && D.cur){
        const it = api.getCur(); const ok = ans() < 0.85;
        drilled.push({ sess: sn, step: api.log[api.log.length - 1].step, key: it.key, kind: kindOf(it), ok });
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
  }
  return { drilled, learnNew, prog: api.getProg(), api };
}

// ------------------------------------------------------------------ metrics
const unitOf = key => key;   // a word, a character unit and a sentence are each one unit
function metrics(seedP, pack, day, K){
  const { drilled } = day;
  const sessions = [...new Set(drilled.map(d => d.sess))].sort((a, b) => a - b);
  const okKind = new Set(), okAny = new Set();
  const per = sessions.map(() => ({ n: 0, sameKind: 0, anyKind: 0, units: new Set() }));
  const why = {}, missedIn = new Set();
  drilled.forEach(d => {
    const p = per[d.sess]; p.n++; p.units.add(d.key);
    if(okKind.has(d.key + "|" + d.kind)){ p.sameKind++; const w = `step ${d.step} ${d.key[0]}:${d.kind}`; why[w] = (why[w] || 0) + 1; }
    if(okAny.has(d.key)) p.anyKind++;
    // The in-drill retry right after a miss is not "answered right" (core.js noteDay).
    const drillId = d.sess + ":" + d.step;
    if(!d.ok) missedIn.add(d.key + "@" + drillId);
    else if(!missedIn.has(d.key + "@" + drillId)){ okKind.add(d.key + "|" + d.kind); okAny.add(d.key); }
  });
  // A miss "comes back" when the unit is drilled again in a later session or later step.
  const pos = d => d.sess * 10 + (d.step || 0);
  const misses = drilled.filter(d => !d.ok && d.sess < N_SESSIONS - 1);
  const missKeys = [...new Set(misses.map(d => d.key))];
  const lostMiss = missKeys.filter(k => { const last = Math.max(...misses.filter(d => d.key === k).map(pos)); return !drilled.some(d => d.key === k && pos(d) > last); });
  // Due at the day's start: weakest-oldest unmastered words/units, mastered longest unseen.
  const recs = [...Object.entries(seedP.w).map(([id, r]) => ["w:" + id, r, VC.WORD_MASTERED]),
    ...Object.entries(seedP.chars.c).map(([id, r]) => ["c:" + id, r, 3])];
  const weak = recs.filter(x => (x[1].s || 0) < x[2]).sort((a, b) => (a[1].s - b[1].s) || (a[1].t - b[1].t) || (a[0] < b[0] ? -1 : 1)).slice(0, K).map(x => x[0]);
  const stale = recs.filter(x => (x[1].s || 0) >= x[2]).sort((a, b) => (a[1].t - b[1].t) || (a[0] < b[0] ? -1 : 1)).slice(0, K).map(x => x[0]);
  const touched = new Set(drilled.map(d => d.key));
  const avail = recs.length + VC.availableSentences(SENTENCES, WORDS, pack, seedP).length;
  const s1 = per[0] ? per[0].units : new Set();
  const overlap = per.map(p => { let i = 0; p.units.forEach(u => { if(s1.has(u)) i++; }); return p.units.size ? i / p.units.size : 0; });
  return { why, per, overlap, missKeys, lostMiss, weakStarved: weak.filter(k => !touched.has(k)), staleStarved: stale.filter(k => !touched.has(k)),
    touched: touched.size, avail, total: drilled.length,
    sameKindAll: per.slice(1).reduce((a, p) => a + p.sameKind, 0), itemsAfter1: per.slice(1).reduce((a, p) => a + p.n, 0) };
}
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "-";
function report(label, m, learnNew){
  console.log(`  ${label}: ${m.total} items, ${m.touched} units touched of ${m.avail} available`);
  if(!QUIET) m.per.forEach((p, i) => console.log(`    s${i + 1}: ${p.n} items, already right today: same kind ${pct(p.sameKind, p.n)}, any kind ${pct(p.anyKind, p.n)}; units ${p.units.size}, shared with s1 ${pct(m.overlap[i] * p.units.size, p.units.size)}; new ${learnNew[i]}`));
  if(WHY) console.log("    same-kind repeats by stage:", JSON.stringify(m.why));
  console.log(`    missed today (s1..s${N_SESSIONS - 1}): ${m.missKeys.length} units, never back: ${m.lostMiss.length}; due weak never drilled: ${m.weakStarved.length}/${K_DUE}; mastered-stale never drilled: ${m.staleStarved.length}/${K_DUE}`);
}
const K_DUE = 30;

(async function main(){
  const PACK_OFF = Object.assign({}, PACK_ON); delete PACK_OFF.dayAware;
  check("packs/zh sets dayAware: true", PACK_ON.dayAware === true);
  console.log("\n[core] day log, tiers, kinds, determinism");
  {
    const P = seedProg(PACK_ON, 150, 60, 11); const ids = Object.keys(P.w);
    const lw = VC.learnedWords(WORDS, PACK_ON, P);
    VC.dayStart(P, PACK_ON, DAY);
    VC.noteDay(P, PACK_ON, DAY, "w:" + ids[0], "hear", true);
    VC.noteDay(P, PACK_ON, DAY, "w:" + ids[1], "recall", false);
    VC.noteDay(P, PACK_ON, DAY, "w:" + ids[1], "recall", true);
    const d = VC.dayLog(P, DAY);
    check("an in-drill retry right after a miss leaves the kind open and the miss pending", !d.a["w:" + ids[1]].r && VC.dayTier({ key: "w:" + ids[1], kinds: ["recall"] }, d) === 0);
    VC.dayStart(P, PACK_ON, DAY);
    VC.noteDay(P, PACK_ON, DAY, "w:" + ids[1], "recall", true);
    check("a right answer in a later drill clears the miss (tier 3/4 by open kinds)", VC.dayTier({ key: "w:" + ids[1], kinds: ["recall", "hear"] }, VC.dayLog(P, DAY)) === 3 && VC.dayTier({ key: "w:" + ids[1], kinds: ["recall"] }, VC.dayLog(P, DAY)) === 4);
    check("dayItemKind: a unit right today in hear is asked in production (recall), never hear again",
      VC.dayItemKind(P, PACK_ON, DAY, "w:" + ids[0], "hear", VC.dayWordKinds(PACK_ON)) === "recall" && VC.dayItemKind(P, PACK_ON, DAY, "w:" + ids[0], "type", VC.dayWordKinds(PACK_ON)) === "type");
    check("dayItemKind: a unit not met today keeps its planned kind; flag off is identity",
      VC.dayItemKind(P, PACK_ON, DAY, "w:" + ids[5], "hear", VC.dayWordKinds(PACK_ON)) === "hear" && VC.dayItemKind(P, PACK_OFF, DAY, "w:" + ids[0], "hear", VC.dayWordKinds(PACK_ON)) === "hear");
    const o = { size: 20, units: CHARACTERS, canHear: () => true, today: DAY };
    const a = VC.buildReviewPlan(lw, P, PACK_ON, Object.assign({ rng: mulberry32(3) }, o)), b = VC.buildReviewPlan(lw, P, PACK_ON, Object.assign({ rng: mulberry32(3) }, o));
    const sig = pl => pl.map(x => x.kind + ":" + (x.word ? x.word.id : x.unit.id)).join();
    check(`deterministic given (progress, date, rng seed): Review plan rebuilt identically (${a.length} items)`, a.length === 20 && sig(a) === sig(b));
    check("Review plan without opts.today takes the unchanged path", sig(VC.buildReviewPlan(lw, P, PACK_ON, Object.assign({ rng: mulberry32(3) }, o, { today: undefined }))) === sig(VC.buildReviewPlan(lw, P, PACK_OFF, Object.assign({ rng: mulberry32(3) }, o, { today: DAY }))));
    // Small pool: everything already right today in every kind still fills the plan.
    const S = seedProg(PACK_ON, 20, 0, 4); const slw = VC.learnedWords(WORDS, PACK_ON, S);
    VC.dayStart(S, PACK_ON, DAY);
    slw.forEach(w => ["recall", "type", "hear", "read"].forEach(k => VC.noteDay(S, PACK_ON, DAY, "w:" + w.id, k, true)));
    VC.dayStart(S, PACK_ON, DAY);
    check("nothing else eligible: a 20-word pool all right today still fills Review (15) and Recall (8)",
      VC.buildReviewPlan(slw, S, PACK_ON, { today: DAY, rng: mulberry32(1) }).length === 15 && VC.buildRecallPlan(slw, S, PACK_ON, 8, { today: DAY, rng: mulberry32(1) }).length === 8);
  }
  console.log("\n[validate] tools/validate_pack.py");
  {
    const os = require("os"), cp = require("child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daysim-")); const dir = path.join(tmp, "zh");
    fs.cpSync(ZH, dir, { recursive: true });
    const run = () => { try { return { code: 0, out: cp.execSync(`python3 tools/validate_pack.py "${dir}"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch(e){ return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
    const ok = run();
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8")); pj.dayAware = "yes";
    fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(pj));
    cp.execSync(`python3 tools/jsonify_pack.py "${dir}"`, { cwd: ROOT, stdio: "ignore" });
    const bad = run();
    check(`validate_pack: zh with dayAware true passes; a non-boolean dayAware is an error (exit ${ok.code} / ${bad.code})`, ok.code === 0 && bad.code === 1 && /pack\.dayAware must be a boolean/.test(bad.out));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log("\n[resume] a reload mid-drill on a day-aware session");
  {
    NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
    const st = { ls: memStore(), ss: memStore() };
    st.ls.setItem(VC.storageKey(PACK_ON), JSON.stringify(seedProg(PACK_ON, 150, 60, 11)));
    let api = await boot(PACK_ON, st, 3);
    api.el("go").click();
    for(let i = 0; i < 3; i++){ answer(api, i !== 1); api.el("nx").click(); }
    const qsig = a => { const D = a.getD(); return [D.cur, ...D.q].filter(Boolean).map(it => it.key + "|" + kindOf(it)).join(); };
    const before = { q: qsig(api), day: JSON.stringify(api.getProg().day) };
    api = await boot(PACK_ON, st, 99);
    check(`reload: same queue, day log unchanged (drill ordinal ${api.getProg().day.n}, not counted again)`, !!api.getD() && qsig(api) === before.q && JSON.stringify(api.getProg().day) === before.day);
  }
  const scenarios = [
    { name: "A: 150 words (HSK 1) + 60 character units, learning HSK 2 words", words: 150, units: 60 },
    { name: "B: HSK 1-3 learned (595 words) + 60 character units, learning characters", words: 595, units: 60 },
  ];
  for(const sc of scenarios){
    console.log(`\n[${sc.name}] ${N_SESSIONS} Today sessions in one day`);
    const res = {};
    for(const [tag, pack] of [["off", PACK_OFF], ["on", PACK_ON]]){
      NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
      const seedP = seedProg(pack, sc.words, sc.units, 11);
      const day = await playDay(pack, seedP, N_SESSIONS, 5);
      const m = metrics(seedP, pack, day, K_DUE);
      report(tag === "off" ? "dayAware off (control)" : "dayAware on", m, day.learnNew);
      res[tag] = { m, day };
    }
    const on = res.on.m, onDay = res.on.day;
    check(`dayAware: same-kind repeats of items answered right earlier today <= 2% of sessions 2..${N_SESSIONS} (${on.sameKindAll}/${on.itemsAfter1})`, on.sameKindAll <= 0.02 * on.itemsAfter1);
    check(`dayAware: every unit missed in sessions 1..${N_SESSIONS - 1} comes back the same day (${on.missKeys.length - on.lostMiss.length}/${on.missKeys.length})`, on.lostMiss.length === 0);
    check(`dayAware: the ${K_DUE} weakest-oldest due units are all drilled (${K_DUE - on.weakStarved.length}/${K_DUE})`, on.weakStarved.length === 0);
    check(`dayAware: the ${K_DUE} mastered longest-unseen units are all drilled (${K_DUE - on.staleStarved.length}/${K_DUE})`, on.staleStarved.length === 0);
    // The other planners after the day: Test (Listen, Recall, Sentences, Characters), Words-tab Review.
    const api = onDay.api, dl = VC.dayLog(api.getProg(), DAY);
    const rightToday = it => { const e = dl.a[it.key]; return !!(e && Array.isArray(e.r) && e.r.includes(kindOf(it))); };
    for(const [tab, id] of [["test", "tListen"], ["test", "tRecall"], ["test", "tSentences"], ["test", "tChars"], ["words", "rev"]]){
      api.clickTab(tab);
      const shown = api.panel() + ((api.el("wbody") || {}).innerHTML || "");
      if(!shown.includes(`id="${id}"`)){ check(`${tab} ${id} offered`, false); continue; }
      api.el(id).click();
      const D = api.getD(); const items = D ? [D.cur, ...D.q].filter(Boolean) : [];
      const rep = items.filter(rightToday);
      if(WHY && rep.length) console.log("   ", id, rep.map(it => `${it.key} ${kindOf(it)} ${JSON.stringify(dl.a[it.key])}`).join("; "), "pool tiers:", JSON.stringify(VC.learnedWords(WORDS, PACK_ON, api.getProg()).reduce((m, w) => { const t = VC.dayTier({ key: "w:" + w.id, rec: api.getProg().w[w.id], mastered: 3, kinds: VC.dayWordKinds(PACK_ON) }, dl); m[t] = (m[t] || 0) + 1; return m; }, {})));
      check(`after the day, ${tab} ${id}: no item in a kind already right today (${rep.length}/${items.length})`, items.length > 0 && rep.length === 0);
      api.quit();
    }
    check(`dayAware: same number of items as the control (${on.total} vs ${res.off.m.total})`, on.total === res.off.m.total);
    check(`dayAware: units touched >= control (${on.touched} vs ${res.off.m.touched})`, on.touched >= res.off.m.touched);
    check(`dayAware: new material every session at the control's pace (${onDay.learnNew.join(",")} vs ${res.off.day.learnNew.join(",")})`, onDay.learnNew.every((n, i) => n >= Math.min(res.off.day.learnNew[i], 10)));
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
