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

let VOICES = [{ lang:"zh-CN", name:"x" }], ACC = 0.85;
async function boot(pack, st, seed){
  Math.random = mulberry32(seed);
  const document = makeFakeDom();
  const voices = VOICES;
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
    if(onSession) onSession(sn, api);
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
  // Strict: a production miss must come back in a production kind (core.js DAY_PRODUCTION),
  // not merely be seen again by ear or by sight.
  const prodMiss = drilled.filter(d => !d.ok && d.sess < N_SESSIONS - 1 && VC.DAY_PRODUCTION.includes(d.kind));
  const prodKeys = [...new Set(prodMiss.map(d => d.key))];
  const prodLost = prodKeys.filter(k => { const last = Math.max(...prodMiss.filter(d => d.key === k).map(pos)); return !drilled.some(d => d.key === k && pos(d) > last && VC.DAY_PRODUCTION.includes(d.kind)); });
  const lostDetail = lostMiss.map(k => drilled.filter(d => d.key === k).map(d => `${k} s${d.sess + 1}/${d.step} ${d.kind} ${d.ok ? "ok" : "MISS"}`).join(", "));
  return { prodKeys, prodLost, lostDetail, why, per, overlap, missKeys, lostMiss, weakStarved: weak.filter(k => !touched.has(k)), staleStarved: stale.filter(k => !touched.has(k)),
    touched: touched.size, avail, total: drilled.length,
    sameKindAll: per.slice(1).reduce((a, p) => a + p.sameKind, 0), itemsAfter1: per.slice(1).reduce((a, p) => a + p.n, 0) };
}
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : "-";
function report(label, m, learnNew){
  console.log(`  ${label}: ${m.total} items, ${m.touched} units touched of ${m.avail} available`);
  if(!QUIET) m.per.forEach((p, i) => console.log(`    s${i + 1}: ${p.n} items, already right today: same kind ${pct(p.sameKind, p.n)}, any kind ${pct(p.anyKind, p.n)}; units ${p.units.size}, shared with s1 ${pct(m.overlap[i] * p.units.size, p.units.size)}; new ${learnNew[i]}`));
  if(WHY) console.log("    same-kind repeats by stage:", JSON.stringify(m.why), "misses never back:", JSON.stringify(m.lostDetail));
  console.log(`    production misses (s1..s${N_SESSIONS - 1}): ${m.prodKeys.length} units, not back in production: ${m.prodLost.length}${WHY && m.prodLost.length ? " " + m.prodLost.join(",") : ""}`);
  console.log(`    missed today (s1..s${N_SESSIONS - 1}): ${m.missKeys.length} units, never back: ${m.lostMiss.length}; due weak never drilled: ${m.weakStarved.length}/${K_DUE}; mastered-stale never drilled: ${m.staleStarved.length}/${K_DUE}`);
}
const K_DUE = 30, ROT_DAYS = 14, ROT_K = 60;
// Session clock (core.js DAY_RECENT_SESSIONS): a drilled item repeats a kind already answered
// right (not the in-drill retry) earlier the same day, or in one of the previous
// DAY_RECENT_SESSIONS sessions, in another drill. dayOf: session index -> day index.
function windowRepeats(drilled, dayOf){
  const right = new Map(), missedIn = new Set(); const ex = [];
  drilled.forEach(d => {
    const did = d.sess + ":" + d.step, k = d.key + "|" + d.kind;
    const prev = right.get(k) || [];
    if(prev.some(p => p.did !== did && (d.sess - p.sess <= VC.DAY_RECENT_SESSIONS || dayOf(p.sess) === dayOf(d.sess)))) ex.push(`${k} s${d.sess + 1}`);
    if(!d.ok) missedIn.add(d.key + "@" + did); else if(!missedIn.has(d.key + "@" + did)) right.set(k, prev.concat({ sess: d.sess, did }));
  });
  return ex;
}
// Every miss before the last session comes back in a later drill, any day, in a kind that settles
// it (core.js daySettles: its own kind, or production for a production miss).
function missesCarried(drilled){
  const lastSess = Math.max(...drilled.map(d => d.sess));
  const pos = d => d.sess * 100 + (d.step || 0);
  const seen = new Map();
  drilled.filter(d => !d.ok && d.sess < lastSess).forEach(d => seen.set(d.key + "|" + d.kind, d));
  const lost = [...seen.values()].filter(m => !drilled.some(d => pos(d) > pos(m) && d.key === m.key && VC.daySettles([m.kind], d.kind)));
  const prod = [...seen.values()].filter(m => VC.DAY_PRODUCTION.includes(m.kind));
  return { n: seen.size, lost: lost.map(m => `${m.key} ${m.kind} s${m.sess + 1}`), prodN: prod.length, prodLost: prod.filter(m => lost.includes(m)).length, sentN: [...seen.values()].filter(m => m.key[0] === "s").length };
}

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
    const before = { q: qsig(api), day: JSON.stringify(api.getProg().day), sn: api.getProg().sn };
    api = await boot(PACK_ON, st, 99);
    check(`reload: same queue, day log unchanged (drill ordinal ${api.getProg().day.n}, not counted again)`, !!api.getD() && qsig(api) === before.q && JSON.stringify(api.getProg().day) === before.day);
    check(`reload: session ordinal prog.sn unchanged (${before.sn} -> ${api.getProg().sn})`, before.sn === 1 && api.getProg().sn === 1);
    // Another tab and back resumes; re-tapping Today parks it behind "Resume today".
    const mid = { q: qsig(api), n: api.getProg().day.n };
    api.clickTab("test"); api.clickTab("today");
    check(`tab away and back: same queue, prog.sn and day.n not counted again (${api.getProg().sn}, ${api.getProg().day.n})`, !!api.getD() && qsig(api) === mid.q && api.getProg().sn === 1 && api.getProg().day.n === mid.n);
    api.clickTab("today");
    const label = api.el("go") ? api.el("go").textContent : "(no button)";
    if(!api.getD() && api.el("go")) api.el("go").click();
    check(`"${label}" button: same queue, prog.sn and day.n not counted again (${api.getProg().sn}, ${api.getProg().day.n})`, label === "Resume today" && !!api.getD() && qsig(api) === mid.q && api.getProg().sn === 1 && api.getProg().day.n === mid.n);
    // A Test drill counts one session; its Resume drill button does not count another.
    api.quit(); api.clickTab("test"); api.el("tRecall").click();
    const t0 = { sn: api.getProg().sn, n: api.getProg().day.n };
    answer(api, true); api.el("nx").click();
    const tq = qsig(api);
    api.clickTab("test");
    const rz = /id="rzgo"/.test(api.panel()) || !!api.el("rzgo");
    if(rz) api.el("rzgo").click();
    check(`Test drill: +1 session (${t0.sn}); Resume drill restores it without counting again (${api.getProg().sn}, day.n ${api.getProg().day.n})`, t0.sn === 2 && rz && !!api.getD() && qsig(api) === tq && api.getProg().sn === 2 && api.getProg().day.n === t0.n);
    // A drill that touches no unit (a Sounds lesson) is no session.
    api.quit(); api.lesson(0); const snL = api.getProg().sn; api.el("dr").click();
    check(`Sounds lesson drill: prog.sn unchanged (${snL} -> ${api.getProg().sn}), drill running`, !!api.getD() && api.getProg().sn === snL && /^l:/.test(String(api.getCur().key)));
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
      if(WHY && tag === "on") m.lostMiss.forEach(k => console.log("    lost", k, JSON.stringify(VC.dayLog(day.prog, DAY).a[k]), JSON.stringify(day.prog.w[k.slice(2)] || day.prog.s[k.slice(2)] || day.prog.chars.c[k.slice(2)]), "n", VC.dayLog(day.prog, DAY).n));
      report(tag === "off" ? "dayAware off (control)" : "dayAware on", m, day.learnNew);
      res[tag] = { m, day, seed: seedP };
    }
    const on = res.on.m, onDay = res.on.day;
    check(`dayAware: same-kind repeats of items answered right earlier today <= 2% of sessions 2..${N_SESSIONS} (${on.sameKindAll}/${on.itemsAfter1})`, on.sameKindAll <= 0.02 * on.itemsAfter1);
    check(`dayAware: every unit missed in sessions 1..${N_SESSIONS - 1} comes back the same day (${on.missKeys.length - on.lostMiss.length}/${on.missKeys.length})`, on.lostMiss.length === 0);
    check(`dayAware: every production miss of sessions 1..${N_SESSIONS - 1} comes back in a production kind the same day (${on.prodKeys.length - on.prodLost.length}/${on.prodKeys.length}; control ${res.off.m.prodKeys.length - res.off.m.prodLost.length}/${res.off.m.prodKeys.length})`, on.prodKeys.length > 0 && on.prodLost.length === 0);
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
    // Lead finding 2026-10-02: weakScore ranking gave character units at streak 3-6 (pinyin
    // hidden .. bare) probability 0 of a Review/Recall slot. They are mastered: tier 2's share.
    const midUnits = Object.entries(res.on.seed.chars.c).filter(([, r]) => r.s >= 3 && r.s <= 5).map(([id]) => "c:" + id);
    const midHit = tag => midUnits.filter(k => res[tag].day.drilled.some(d => d.key === k)).length;
    check(`dayAware: character units at streak 3-5 reach Review/Recall within the day (${midHit("on")}/${midUnits.length}; control ${midHit("off")})`, midUnits.length > 0 && midHit("on") > 0);
  }
  console.log(`\n[rollover] scenario A, sessions 1-4 on one evening, 5-8 the next morning`);
  {
    const t0 = new Date(2026, 9, 2, 18, 0, 0).getTime(), t1 = new Date(2026, 9, 3, 7, 0, 0).getTime();
    const at = sn => sn < 4 ? t0 + sn * 3600e3 : t1 + (sn - 4) * 3600e3;
    for(const [tag, pack] of [["off", PACK_OFF], ["on", PACK_ON]]){
      NOW = t0 - 3600e3;
      const seedP = seedProg(pack, 150, 60, 11);
      const run = await playDay(pack, seedP, N_SESSIONS, 5, at);
      const rep = windowRepeats(run.drilled, s => s < 4 ? 0 : 1), mc = missesCarried(run.drilled);
      const cross = rep.filter(x => +x.split(" s")[1] === 5).length;
      const s5 = run.drilled.filter(d => d.sess === 4).length;
      console.log(`  ${tag}: same-kind repeats in the window ${rep.length}/${run.drilled.length} (session 5, first after midnight: ${cross}/${s5}); misses carried back in a settling kind ${mc.n - mc.lost.length}/${mc.n}; prog.sn ${run.prog.sn}`);
      if(WHY && tag === "on") console.log("    repeats:", rep.slice(0, 10).join("; "), "lost:", mc.lost.join("; "));
      if(tag === "on"){
        check(`rollover: prog.sn counts one per Today session (${run.prog.sn})`, run.prog.sn === N_SESSIONS);
        check(`rollover: every miss of sessions 1-${N_SESSIONS - 1} comes back in a settling kind across midnight (${mc.n - mc.lost.length}/${mc.n}, sentences ${mc.sentN}; production misses back in production ${mc.prodN - mc.prodLost}/${mc.prodN})`, mc.n > 0 && mc.prodN > 0 && mc.sentN > 0 && mc.lost.length === 0);
        check(`rollover: no same-kind repeat of an item right earlier that day or in the previous ${VC.DAY_RECENT_SESSIONS} sessions (${rep.length}/${run.drilled.length}; session 5 ${cross}/${s5})`, rep.length === 0);
      }
    }
  }
  // Carried misses seeded as yesterday's day log (core.js dayCarry): keys -> missed kind.
  const seedCarried = (p, misses) => { p.sn = 3; p.day = { d: "2026-10-01", n: 3, a: {} }; Object.entries(misses).forEach(([k, kind]) => { p.day.a[k] = { mk: [kind], ms: 2 }; }); return p; };
  const pendingOf = (api, keys) => { const pr = api.getProg(), d = pr.day; return keys.filter(k => d.a[k] && Array.isArray(d.a[k].mk) && d.a[k].mk.length); };
  console.log(`\n[voiceless] scenario A with no zh voice: 6 word + 4 sentence hear misses carried, 10 days x 1 session, every answer right (a stuck miss cannot hide behind a new one)`);
  {
    VOICES = [{ lang: "en-US", name: "e" }]; ACC = 1;
    NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
    const seedP = seedProg(PACK_ON, 150, 60, 11);
    const ws = Object.keys(seedP.w).slice(0, 6).map(id => "w:" + id);
    const ss = VC.availableSentences(SENTENCES, WORDS, PACK_ON, seedP).slice(0, 4).map(x => "s:" + x.id);
    const keys = [...ws, ...ss];
    seedCarried(seedP, Object.fromEntries(keys.map(k => [k, "hear"])));
    const pend = [];
    const run = await playDay(PACK_ON, seedP, 10, 5, 24 * 60 * 60 * 1000, (sn, api) => { const p = pendingOf(api, keys); pend.push(p.length); if(WHY) p.forEach(k => console.log("    s" + (sn + 1), k, JSON.stringify(api.getProg().day.a[k]))); });
    VOICES = [{ lang:"zh-CN", name:"x" }]; ACC = 0.85;
    const perSess = keys.map(k => Math.max(...[...Array(10).keys()].map(sn => new Set(run.drilled.filter(d => d.sess === sn && d.key === k).map(d => d.step)).size)));
    const heard = run.drilled.filter(d => d.kind === "hear").length;
    console.log(`  pending carried misses after each session: ${pend.join(",")}; most stages one carried item appears in within a session: ${Math.max(...perSess)}; hear items shown: ${heard}`);
    check(`voiceless: carried hear misses (words and sentences) settle within 2 sessions (${pend.slice(0, 2).join(",")})`, pend[1] === 0 && pend.every((n, i) => i < 2 || n === 0));
    check(`voiceless: no carried item is asked in more than one stage of a session (max ${Math.max(...perSess)}) and no hear item is shown (${heard})`, Math.max(...perSess) <= 1 && heard === 0);
  }
  console.log(`\n[backlog] scenario A with 60 carried misses (40 word, 12 character, 8 sentence)`);
  {
    NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
    const seedP = seedProg(PACK_ON, 150, 60, 11);
    const wk = ["recall", "type", "hear", "read"];
    const misses = {};
    Object.keys(seedP.w).slice(0, 40).forEach((id, i) => { misses["w:" + id] = wk[i % 4]; });
    Object.keys(seedP.chars.c).slice(0, 12).forEach((id, i) => { misses["c:" + id] = i % 2 ? "charRecall" : "charRead"; });
    VC.availableSentences(SENTENCES, WORDS, PACK_ON, seedP).slice(0, 8).forEach((x, i) => { misses["s:" + x.id] = i % 2 ? "read" : "hear"; });
    seedCarried(seedP, misses);
    const keys = Object.keys(misses);
    const run = await playDay(PACK_ON, seedP, 4, 5, 24 * 60 * 60 * 1000);
    const s1 = run.drilled.filter(d => d.sess === 0);
    const steps = [...new Set(s1.map(d => d.step))];
    const share = steps.map(st => { const ks = [...new Set(s1.filter(d => d.step === st).map(d => d.key))]; return { st, n: ks.length, miss: ks.filter(k => k in misses).length }; }).filter(x => x.n >= 5);
    const back = keys.filter(k => run.drilled.some(d => d.key === k && VC.daySettles([misses[k]], d.kind)));
    console.log(`  session 1 per stage (carried misses / items): ${share.map(x => `step ${x.st} ${x.miss}/${x.n}`).join(", ")}; carried misses asked in a settling kind within 4 sessions: ${back.length}/${keys.length}`);
    check(`backlog: every session-1 stage has >= 40% items that are not carried misses (${share.map(x => `${x.n - x.miss}/${x.n}`).join(", ")})`, share.length > 0 && share.every(x => x.n - x.miss >= 0.4 * x.n));
    check(`backlog: every carried miss is asked in a settling kind within 4 sessions (${back.length}/${keys.length})`, back.length === keys.length);
  }
  console.log(`\n[rotation] scenario B, one Today session a day for ${ROT_DAYS} days: nothing eligible stays unseen without bound`);
  for(const [tag, pack] of [["off", PACK_OFF], ["on", PACK_ON]]){
    NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
    const seedP = seedProg(pack, 595, 60, 11);
    const run = await playDay(pack, seedP, ROT_DAYS, 5, 24 * 60 * 60 * 1000);
    const touched = new Set(run.drilled.map(d => d.key));
    const recs = [...Object.entries(seedP.w).map(([id, r]) => ["w:" + id, r]), ...Object.entries(seedP.chars.c).map(([id, r]) => ["c:" + id, r])];
    const mast = recs.filter(x => x[1].s >= 3).sort((a, b) => (a[1].t - b[1].t) || (a[0] < b[0] ? -1 : 1));
    const mid = recs.filter(x => x[0][0] === "c" && x[1].s >= 3 && x[1].s <= 5);
    const oldest = mast.slice(0, ROT_K).filter(x => !touched.has(x[0])).length;
    if(WHY) mast.slice(0, ROT_K).filter(x => !touched.has(x[0])).forEach(x => { const id = x[0].slice(2), fp = run.prog; console.log("    unseen", x[0], JSON.stringify(x[1]), JSON.stringify(x[0][0] === "w" ? fp.w[id] : fp.chars.c[id]), "sn", fp.sn, "rank", mast.indexOf(x)); });
    const midSeen = mid.filter(x => touched.has(x[0])).length;
    const mastSeen = mast.filter(x => touched.has(x[0])).length;
    console.log(`  ${tag}: mastered units drilled ${mastSeen}/${mast.length}; ${ROT_K} longest unseen at start never drilled: ${oldest}; character units at streak 3-5 drilled ${midSeen}/${mid.length}`);
    const rrep = windowRepeats(run.drilled, s => s);
    console.log(`    same-kind repeats of an item right in the previous ${VC.DAY_RECENT_SESSIONS} sessions: ${rrep.length}/${run.drilled.length}`);
    if(tag === "on"){
      check(`rotation: no same-kind repeat of an item right in the previous ${VC.DAY_RECENT_SESSIONS} sessions (${rrep.length}/${run.drilled.length})`, rrep.length === 0);
      check(`rotation: the ${ROT_K} mastered units unseen longest at the start are all drilled within ${ROT_DAYS} days`, oldest === 0);
      check(`rotation: every character unit at streak 3-5 is drilled within ${ROT_DAYS} days (${midSeen}/${mid.length})`, mid.length > 0 && midSeen === mid.length);
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
