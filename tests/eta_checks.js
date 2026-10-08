// ETA estimates (docs/PACK_SCHEMA.md "appView" > "ETA model"; owner 2026-10-08; fb42 curves): sessions to the next goal
// and to the next level's gate under pack.appView "v2". [1] core: curve lookup (interpolation, endpoints, null, legacy gain,
// no pack.eta), the fresh zh record, levelOpensIn; [2] owner export numbers; [3] rendering on Today / Progress (done goal,
// open gate, two-digit display, 999+ cap); [4] flag-off byte-identical to base; [5] placed starts (prog.pl selects
// pack.eta.placed) vs the out-of-sample sims.
// Run: node tests/eta_checks.js
//      node tests/eta_checks.js --calibrate [--write] [--sessions N] [--trace-dir DIR]
//      --calibrate: fresh zh record, Today sessions at 85% right, unpaused, 7 a day, passages read, seeds 5/6/7 (curves) and
//      8/9/10 (out-of-sample gate), owner export seeds 5/6/7, placed-at-HSK 2 / HSK 3 starts seeds 5-10 (eta.placed); one process per run; prints each point against the
//      committed tools/zh_eta.json; --write rewrites it (then python3 tools/pack_from_hsk.py).
//      node tests/eta_checks.js --pack <packdir> (--calibrate | --gate) [--sessions N] [--seeds a,b,c] [--write <file>]
//      --pack: any pack directory (a sibling's enriched pack, see packbuilder enrich --emit). --calibrate measures
//      pack.eta {curve, knownCurve} on seeds 5/6/7 and nulls what fails the gate there; --gate checks the pack's own eta
//      (legacy {gain, known} as a straight line) on seeds 8/9/10: at goal positions 0/.25/.5/.75 the estimate vs the
//      sessions still needed within +-30% on at least 2 of 3 seeds, and every completed gate hold from its first held session.
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process"), os = require("os");
const { packAsOf, stripFlags } = require("./lib/pack_flags.js");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const PATTERNS = loadConst(path.join(ZH, "sentences.js"), "PATTERNS");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const OWNER_F = process.env.PROGRESS_OWNER || "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json";
const OWNER = fs.existsSync(OWNER_F) ? JSON.parse(fs.readFileSync(OWNER_F, "utf8")) : null;
const clone = x => JSON.parse(JSON.stringify(x));
const argv = process.argv.slice(2);

let fails = 0, passes = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}

const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
// ------------------------------------------------------------------ fake DOM (copied from session_resume_checks.js)
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

const DAY_N = Date.UTC(2026, 9, 2) / 864e5;
let NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
class FakeDate extends Date {
  constructor(...a){ if(a.length) super(...a); else super(NOW); }
  static now(){ return NOW; }
}
async function boot(pack, st, seed, opts){
  const o = opts || {};
  Math.random = mulberry32(seed);
  const document = makeFakeDom();
  const voices = [{ lang:"zh-CN", name:"x" }];
  const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(){} };
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf(o.html || appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML,
  getProg: () => prog, getD: () => D, getCur: () => __cur, rd: () => RD,
  skipRead: () => { RD = null; todayStep(); },
  // A passage read through: each question right at the sim's accuracy, recorded as the app's results screen does.
  finishRead: ok => { RD.answers = RD.p.questions.map(() => ({ ok: ok() })); markPassageFinished(); RD = null; todayStep(); },
  eta: n => etaText(n), gate: () => gateSentence(),
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","PATTERNS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"EtaChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, o.passages || [], CHARACTERS, o.patterns ? PATTERNS : undefined];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return api;
}
const fresh = () => ({ ls: memStore(), ss: memStore() });
async function bootWith(pack, prog, seed, opts){ const st = fresh(); if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog)); return await boot(pack, st, seed || 1, opts); }

// ------------------------------------------------------------------ simulated sessions (tests/level_gate_checks.js playDay: 7 a day, an hour apart)
const typedAnswer = it => {
  const w = BY_ID[String(it.key).slice(2)];
  if(!w || !String(it.key).startsWith("w:")) return null;
  return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w;
};
function answer(api, right){
  const it = api.getCur();
  if(it.kind === "type"){ api.el("tin").value = (right && typedAnswer(it)) || "zzz not it"; api.el("submit").click(); return; }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}
const daySched = sn => sn % 7 === 0 ? new Date(2026, 9, 2 + sn / 7, 7, 0, 0).getTime() : NOW + 60 * 60 * 1000;
async function playSessions(pack, seedP, sessions, seed, acc, onSession, opts){
  const st = fresh();
  st.ls.setItem(VC.storageKey(pack), JSON.stringify(seedP));
  NOW = new Date(2026, 9, 2, 7, 0, 0).getTime();
  const api = await boot(pack, st, seed, opts);
  const ans = mulberry32(seed * 7919 + 1);
  if(onSession) onSession(-1, api);
  for(let sn = 0; sn < sessions; sn++){
    NOW = daySched(sn);
    if(/id="choiceStart"/.test(api.panel())) api.el("choiceStart").click();
    if(!/id="go"/.test(api.panel())) throw new Error(`session ${sn + 1}: no Start button`);
    api.el("go").click();
    for(let guard = 0; ; guard++){
      if(guard > 3000) throw new Error(`session ${sn + 1}: no end`);
      const html = api.panel(), D = api.getD();
      if(D && api.getCur() && D.cur){ answer(api, ans() < acc); api.el("nx").click(); continue; }
      if(/id="again"/.test(html)){ api.el("again").click(); break; }
      if(/id="ok"/.test(html) && !D){ api.el("ok").click(); continue; }
      if(/id="dr"/.test(html)){ api.el("dr").click(); continue; }
      if(api.rd()){ if(opts && opts.read) api.finishRead(() => ans() < acc); else api.skipRead(); continue; }
      throw new Error(`session ${sn + 1}: stuck on ${html.slice(0, 200)}`);
    }
    if(onSession) onSession(sn, api);
  }
  return api;
}
const SIM = stripFlags(PACK, ["appView"]); // appView is UI only: the planner is the same
const LV = VC.levelIds(PACK), BYLV = VC.wordsByLevel(WORDS, PACK), GOALS = VC.progressMapGoals(PACK);
// Per session: every goal's position and every level's known share (passages counted as in the app; the sim skips reading).
async function trace(start, n, seed, acc, opts){
  const rows = [];
  await playSessions(SIM, start, n, seed, acc, (sn, api) => { const q = api.getProg();
    rows.push({ sn: sn + 1, prov: Object.fromEntries(LV.map(lv => [lv, BYLV[lv].filter(w => q.w[w.id] && q.w[w.id].prov).length])), g: VC.goalPositions(q, PACK, WORDS, CHARACTERS, PASSAGES), k: LV.map(lv => VC.levelKnownPct(WORDS, PACK, q, lv, CHARACTERS)), cg: (VC.currentGoal(q, PACK, WORDS, CHARACTERS, PASSAGES) || {}).i, pm: clone(q.pm || []), gate: VC.levelGateHold(WORDS, PACK, q, CHARACTERS), parts: GOALS.map((_, g) => parts(q, g)) }); }, opts);
  return rows;
}
// Goal g's three parts (core.js goalPosition): known words, units past pron, passages with a listening pass.
function parts(q, g){
  const idx = VC.levelIndexMap(PACK), top = idx[String(GOALS[g].upTo)], inR = lv => idx[String(lv)] !== undefined && idx[String(lv)] <= top;
  const ws = WORDS.filter(w => inR(w.lv)), us = CHARACTERS.filter(u => inR(u.lv !== undefined ? u.lv : (BY_ID[u.words[0]] || {}).lv)), ps = PASSAGES.filter(p => inR(p.lv));
  const bw = VC.knownCtx(PACK, CHARACTERS), cr = VC.charRecs(q), dn = (q.read && q.read.done) || {};
  return [ws.filter(w => VC.wordKnownX(q.w[w.id], w, PACK, q, bw)).length / ws.length, us.filter(u => cr[u.id] && VC.charTier(cr[u.id].s, PACK) !== "pron").length / us.length, ps.filter(p => dn[p.id] && dn[p.id].l).length / ps.length];
}
const ownerStart = () => { const o = clone(OWNER); delete o.pause; return o; };
const freshStart = () => VC.normalizeProg({ placedOnce: true, soundsOpened: true }, PACK);
// Levels 1..upTo fully taught; the last of them has exactly `known` words at streak 5 with their units read, the rest at 0;
// every earlier level known. Units of known words recorded at streak 6 (pair wm booted at known).
function seedLevel(upTo, known){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 30 }, PACK);
  LV.slice(0, upTo).forEach((lv, i) => {
    BYLV[lv].forEach((w, j) => { const k = i < upTo - 1 || j < known; p.w[w.id] = { r: k ? 6 : 1, w: 0, s: k ? 5 : 0, t: DAY_N - 1 - (j % 9) }; });
    p.sets[lv] = VC.nSets(BYLV[lv], VC.setSizeOf(PACK));
  });
  const kn = new Set(Object.keys(p.w).filter(id => p.w[id].s >= 5));
  CHARACTERS.filter(u => kn.has(u.words[0])).forEach(u => { p.chars.c[u.id] = { r: 6, w: 0, s: 6, t: DAY_N - 1 }; });
  p.chars.choiceSeen = true;
  return p;
}
// Levels 1..upTo all known, every passage of them with a listening pass: the goals up to upTo are done.
function seedKnown(upTo){
  const p = seedLevel(upTo, Infinity);
  const top = LV.slice(0, upTo).map(String);
  p.read = p.read || {}; p.read.done = p.read.done || {};
  PASSAGES.filter(x => top.includes(String(x.lv))).forEach(x => { p.read.done[x.id] = { sc: 3, n: 3, d: "2026-10-01", x: 2, l: 1, s: 1, ls: 1 }; });
  return p;
}
// ------------------------------------------------------------------ calibration (--calibrate): tools/zh_eta.json (pack.eta curve + knownCurve)
const EC = require("./lib/eta_curve.js");
const ZH_ETA = path.join(ROOT, "tools", "zh_eta.json");
// A fresh record that passed the placement test up to level `lv` (lands there): every bucket of the levels before it
// passed, as the Test tab's walk ends (app.html applies VC.applyPlacement with the buckets passed).
function placedStart(lv){
  const st = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK)), passed = st.findIndex(b => String(b.lv) === String(lv));
  return VC.applyPlacement(freshStart(), st, passed, WORDS, PACK);
}
// One sim run in its own process (--trace fresh|owner seed N out): rows[0] = before session 1.
async function traceMode(){
  const i = argv.indexOf("--trace"), [who, seed, N, out] = argv.slice(i + 1, i + 5);
  const st0 = who === "owner" ? ownerStart() : who.startsWith("placed") ? placedStart(+who.slice(6)) : freshStart(); delete st0.pm;
  const rows = await trace(st0, +N, +seed, 0.85, { passages: PASSAGES, patterns: true, read: true });
  fs.writeFileSync(out, JSON.stringify(rows.map(r => ({ sn: r.sn, g: r.g, k: Object.fromEntries(LV.map((lv, j) => [lv, r.k[j]])), gate: r.gate ? { lv: r.gate.lv, prev: r.gate.prev } : null, prov: r.prov }))));
}
// --trace-dir <dir> keeps each run's rows there and reuses a run already saved (same record, seed and session count).
function runTraces(jobs){
  const keep = argv.includes("--trace-dir") ? argv[argv.indexOf("--trace-dir") + 1] : null;
  const dir = keep || fs.mkdtempSync(path.join(os.tmpdir(), "eta-trace-"));
  if(keep) fs.mkdirSync(keep, { recursive: true });
  return Promise.all(jobs.map(([who, seed, N]) => new Promise((res, rej) => {
    const out = path.join(dir, `${who}-${seed}-${N}.json`), t0 = Date.now();
    if(keep && fs.existsSync(out)) return res({ who, seed, N, rows: JSON.parse(fs.readFileSync(out, "utf8")), secs: 0 });
    const c = cp.spawn(process.execPath, [__filename, "--trace", who, String(seed), String(N), out], { stdio: ["ignore", "ignore", "inherit"] });
    c.on("exit", code => code ? rej(new Error(`trace ${who} ${seed} exit ${code}`)) : res({ who, seed, N, rows: JSON.parse(fs.readFileSync(out, "utf8")), secs: Math.round((Date.now() - t0) / 1000) }));
  })));
}
const fmtCurve = c => c ? c.map(([x, y]) => `${x}:${y}`).join(" ") : "null";
async function calibrate(){
  const N = argv.includes("--sessions") ? +argv[argv.indexOf("--sessions") + 1] : 400, NO = 220;
  const t00 = Date.now();
  const jobs = [5, 6, 7, 8, 9, 10].map(s => ["fresh", s, N]).concat(OWNER ? [5, 6, 7].map(s => ["owner", s, NO]) : [], [2, 3].flatMap(lv => [5, 6, 7, 8, 9, 10].map(s => ["placed" + lv, s, NO + 40])));
  const runs = await runTraces(jobs);
  const pos = (r, g) => r.rows.map(x => x.g[g]);
  runs.forEach(r => console.log(`${r.who} seed ${r.seed} (${r.secs} s): goals from ${r.rows[0].g.map(x => x.toFixed(3)).join("/")} reach ${VC.GOAL_DONE} after ${GOALS.map((_, g) => { const c = EC.crossOf(pos(r, g)); return c === null ? `>${r.N}` : c; }).join("/")} sessions; holds ${EC.holdsOf(r.rows, PACK.levelGate).map(h => `${(h[0] * 100).toFixed(1)}% open after ${h.length - 1}`).join(", ") || "none"}`));
  const placed = runs.filter(r => r.who.startsWith("placed"));
  const fit = runs.filter(r => r.who === "fresh" && r.seed <= 7), oos = runs.filter(r => r.who === "fresh" && r.seed > 7), own = runs.filter(r => r.who === "owner");
  const eta = { curve: GOALS.map((_, g) => EC.goalCurve(fit.map(r => pos(r, g)))), knownCurve: EC.knownCurve(fit.flatMap(r => EC.holdsOf(r.rows, PACK.levelGate)), PACK.levelGate) };
  // knownCurve vs a linear hold: each hold's rate in its first and last third against its mean
  fit.forEach(r => EC.holdsOf(r.rows, PACK.levelGate).forEach(h => { const n = h.length - 1, t = Math.max(1, Math.floor(n / 3)), m = (h[n] - h[0]) / n;
    console.log(`  hold seed ${r.seed} from ${(h[0] * 100).toFixed(1)}%: first third ${((h[t] - h[0]) / t / m).toFixed(2)}x, last third ${((h[n] - h[n - t]) / t / m).toFixed(2)}x the mean rate`); }));
  GOALS.forEach((_, g) => console.log(`curve goal ${g + 1}: ${fmtCurve(eta.curve[g])}`));
  console.log(`knownCurve: ${eta.knownCurve ? Object.entries(eta.knownCurve).map(([lv, c]) => `${lv}: ${fmtCurve(c)}`).join("; ") : "null"}`);
  const verdict = (what, v) => { console.log(`GATE  ${what}: ${v.ok === null ? "no curve" : v.ok ? (v.tail ? "PASS (tail rule)" : "PASS") : "FAIL"}`); (v.probes || []).forEach(p => console.log(`        at ${p.q}: ${p.ok ? "pass" : p.tail ? "tail" : "fail"} ${p.per.map(x => x.note).join(" | ")}`)); (v.per || []).forEach(x => console.log(`        ${x.note}`)); return v.ok; };
  const gates = GOALS.map((_, g) => verdict(`goal ${g + 1} out of sample (seeds 8/9/10)`, EC.goalGate(eta.curve[g], oos.map(r => pos(r, g)))));
  gates.push(verdict("gate out of sample (seeds 8/9/10)", EC.knownGate(eta.knownCurve, oos.map(r => EC.holdsOf(r.rows, PACK.levelGate)))));
  // Placed starts (a fresh record the Test tab placed into HSK 2 / HSK 3: prog.pl, core.js etaPlaced). Seeds 5/6/7 fit a
  // placed curve set only where the fresh curves fail them in sample (the start's current goal; the placed levels' own gate
  // holds); seeds 8/9/10 check the set as the app reads it: the goal every 25 sessions up to the crossing plus the first
  // session the placed levels hold no provisional record, and the placed level's hold the same way, +-30% on 2 of 3.
  const provZero = (r, lv) => r.rows.findIndex(x => x.prov && LV.slice(0, LV.indexOf(String(lv))).every(l => !x.prov[l]));
  const pfit = placed.filter(r => r.seed <= 7), poos = placed.filter(r => r.seed > 7);
  const placedSets = {};
  const goalProbe = (rs, g, estOf) => { const minC = Math.min(...rs.map(r => EC.crossOf(pos(r, g)) ?? Infinity));
    const offs = []; for(let o = 0; o < minC; o += 25) offs.push(o);
    const z = rs.map(r => provZero(r, r.who.slice(6))).filter(i => i > 0 && i < minC); if(z.length) offs.push(Math.min(...z));
    return EC.tailRule([...new Set(offs)].sort((x, y) => x - y).map(off => ({ q: `+${off}`, at: Math.min(...rs.map(r => pos(r, g)[off])),
      per: rs.map(r => { const t = pos(r, g), c = EC.crossOf(t);
        return c === null ? { ok: false, near: false, stall: false, note: "no crossing" } : EC.probeRun(estOf(r, g, off), c - off, `p ${t[off].toFixed(3)}: `); }) }))); };
  const placedHolds = r => { const pl = r.who.slice(6), below = LV.slice(0, LV.indexOf(pl)); return EC.holdsOf(r.rows, PACK.levelGate).filter(h => below.includes(String(h.prev)) && h.from === 0); };
  const holdProbe = (rs, kcOf) => { const per = rs.map(r => { const hs = placedHolds(r); if(!hs.length) return { ok: false, note: "no placed hold" };
      const h = hs[0], n = h.length - 1, offs = []; for(let o = 0; o < n; o += 25) offs.push(o);
      const z = provZero(r, r.who.slice(6)); if(z > 0 && z < n) offs.push(z);
      const e = [...new Set(offs)].map(o => { const v = EC.est(kcOf(r, h.prev), h[o]), a = n - o; return { o, v, a, err: (v - a) / a }; });
      return { ok: e.every(x => Math.abs(x.err) <= EC.TOL), note: `${h.prev}: ` + e.map(x => `+${x.o} ${x.v} vs ${x.a} (${Math.round(x.err * 100)}%)`).join(", ") }; });
    return { ok: per.filter(x => x.ok).length >= 2, per }; };
  const freshGoal = (r, g, off) => EC.est(eta.curve[g], pos(r, g)[off]), freshKc = (r, lv) => (eta.knownCurve || {})[lv];
  for(const lv of [2, 3]){
    const pl = String(lv), rs = pfit.filter(r => r.who === "placed" + lv); if(!rs.length) continue;
    const g0 = VC.currentGoal(placedStart(lv), PACK, WORDS, CHARACTERS, PASSAGES).i, set = { bySessions: GOALS.map(() => null), knownCurve: {} };
    const fg = goalProbe(rs, g0, freshGoal), fk = holdProbe(rs, freshKc);
    verdict(`placed at HSK ${lv}, fresh curves in sample (5/6/7): goal ${g0 + 1}`, fg); verdict(`placed at HSK ${lv}, fresh curves in sample (5/6/7): placed level's hold`, fk);
    // by sessions since placement: a placed start's position sits on a plateau (.80-.89) for ~70 sessions before it crosses,
    // where no position curve can place it; its crossing itself varies by a few sessions (153-159)
    if(!fg.ok){ const cs = rs.map(r => EC.crossOf(pos(r, g0))).filter(c => c !== null); if(cs.length >= 2){ const m = Math.round(cs.reduce((a, b) => a + b, 0) / cs.length * 10) / 10; set.bySessions[g0] = [[0, m], [m, 0]]; } }
    if(!fk.ok){ const kc = EC.knownCurve(rs.flatMap(placedHolds), PACK.levelGate) || {}; Object.keys(kc).forEach(k => { if(kc[k]) set.knownCurve[k] = kc[k]; }); }
    if(set.bySessions.some(Boolean) || Object.keys(set.knownCurve).length) placedSets[pl] = set;
    if(placedSets[pl]){ GOALS.forEach((_, g) => { if(set.bySessions[g]) console.log(`placed ${pl} goal ${g + 1} by sessions since placement: ${fmtCurve(set.bySessions[g])}`); });
      Object.entries(set.knownCurve).forEach(([k, c]) => console.log(`placed ${pl} knownCurve ${k}: ${fmtCurve(c)}`)); }
    else console.log(`placed ${pl}: the fresh curves fit, no placed set`);
  }
  const full = Object.assign({}, eta, Object.keys(placedSets).length ? { placed: placedSets } : {});
  const setOf = r => placedSets[r.who.slice(6)] || null;
  const goalAt = (r, g, off) => { const ps = setOf(r); return ps && Array.isArray(ps.bySessions[g]) ? EC.est(ps.bySessions[g], off) : EC.est(eta.curve[g], pos(r, g)[off]); };
  const kcAt = (r, lv) => { const ps = setOf(r); return ps && ps.knownCurve[lv] ? ps.knownCurve[lv] : (eta.knownCurve || {})[lv]; };
  for(const [what, set] of [["in sample (5/6/7)", pfit], ["out of sample (8/9/10)", poos]]) for(const lv of [2, 3]){
    const rs = set.filter(r => r.who === "placed" + lv); if(!rs.length) continue;
    const g = VC.currentGoal(placedStart(lv), PACK, WORDS, CHARACTERS, PASSAGES).i;
    const gate = v => { if(what.startsWith("out")) gates.push(v); };   // in sample = the fit data: report only, as for the fresh curves
    gate(verdict(`placed at HSK ${lv} ${what}, goal ${g + 1} every 25 sessions + first session without provisional records (crossed ${rs.map(r => EC.crossOf(pos(r, g))).join("/")})`, goalProbe(rs, g, goalAt)));
    gate(verdict(`placed at HSK ${lv} ${what}, the placed level's hold every 25 sessions + first session without provisional records`, holdProbe(rs, kcAt)));
    verdict(`placed at HSK ${lv} ${what}, every gate hold from its first session (report)`, EC.knownGate(h => EC.est(kcAt(h.run, h.prev), h[0]), rs.map(r => EC.holdsOf(r.rows, PACK.levelGate).map(h => Object.assign(h, { run: r })))));
  }
  if(own.length){
    const o = ownerStart(), cg = VC.currentGoal(o, PACK, WORDS, CHARACTERS, PASSAGES), p = VC.goalPositions(o, PACK, WORDS, CHARACTERS, PASSAGES);
    const xs = own.map(r => EC.crossOf(pos(r, cg.i))), e = EC.est(eta.curve[cg.i], p[cg.i]);
    console.log(`owner export goal ${cg.i + 1} at ${p[cg.i].toFixed(3)}: curve ${e} vs sim crossings ${xs.join("/")} (${xs.map(x => x == null ? "-" : Math.round((e - x) / x * 100) + "%").join(" ")})`);
    const h = VC.levelGateHold(WORDS, PACK, o, CHARACTERS), ke = h && eta.knownCurve ? EC.est(eta.knownCurve[h.prev], VC.levelKnownPct(WORDS, PACK, o, h.prev, CHARACTERS)) : null;
    console.log(`owner export gate ${h ? `HSK ${h.lv} at ${h.pct}%` : "open"}: knownCurve ${ke} vs sims opened after ${own.map(r => { const i = r.rows.findIndex(x => !x.gate); return i < 0 ? "-" : i; }).join("/")}`);
  }
  if(fs.existsSync(ZH_ETA)){
    const old = JSON.parse(fs.readFileSync(ZH_ETA, "utf8")), dev = [];
    const cmp = (a, b, what) => { if(!a && !b) return; if(!a || !b) { dev.push(`${what}: ${a ? "curve" : "null"} vs ${b ? "curve" : "null"}`); return; }
      a.forEach(([x, y], i) => { const yb = b[i] && b[i][0] === x ? b[i][1] : null; if(yb === null || Math.abs(y - yb) > Math.max(0.05 * Math.max(y, yb), 1)) dev.push(`${what} at ${x}: ${yb} committed vs ${y}`); }); };
    GOALS.forEach((_, g) => cmp(eta.curve[g], old.curve && old.curve[g], `goal ${g + 1}`));
    Object.keys(Object.assign({}, eta.knownCurve, old.knownCurve)).forEach(lv => cmp((eta.knownCurve || {})[lv], (old.knownCurve || {})[lv], `knownCurve ${lv}`));
    const op = old.placed || {};
    Object.keys(Object.assign({}, placedSets, op)).forEach(pl => { const a = placedSets[pl] || { bySessions: [], knownCurve: {} }, b = op[pl] || { bySessions: [], knownCurve: {} };
      GOALS.forEach((_, g) => cmp((a.bySessions || [])[g], (b.bySessions || [])[g], `placed ${pl} goal ${g + 1}`));
      Object.keys(Object.assign({}, a.knownCurve, b.knownCurve)).forEach(lv => cmp(a.knownCurve[lv], b.knownCurve[lv], `placed ${pl} knownCurve ${lv}`)); });
    console.log(`committed tools/zh_eta.json vs this run (each point within 5% or 1 session): ${dev.length ? dev.length + " off: " + dev.join("; ") : "all within"}`);
  }
  if(argv.includes("--write")){ fs.writeFileSync(ZH_ETA, JSON.stringify(full) + "\n"); console.log(`wrote ${ZH_ETA}`); }
  console.log(`wall ${Math.round((Date.now() - t00) / 1000)} s`);
  if(gates.some(v => v === false)) process.exitCode = 1;
}

// ------------------------------------------------------------------ --pack: per-site calibration and gate (docs/PACK_SCHEMA.md "ETA model" > "Per-pack constants")
async function packMode(){
  const sim = require("./lib/sim_app.js"), EC = require("./lib/eta_curve.js");
  const arg = n => argv.includes(n) ? argv[argv.indexOf(n) + 1] : null;
  const dir = arg("--pack"), N = +(arg("--sessions") || 240), ACC = 0.85;
  const calibrateMode = argv.includes("--calibrate");
  // the gate runs out of sample: --calibrate measures on 5/6/7, a bare --gate checks the pack's eta on 8/9/10
  const seeds = (arg("--seeds") || (calibrateMode ? "5,6,7" : "8,9,10")).split(",").map(Number);
  if(!calibrateMode && !argv.includes("--gate")){ console.error("--pack needs --calibrate or --gate"); process.exit(2); }
  const D = sim.loadPackDir(dir), P = D.PACK, S = sim.createSim(D), units = D.CHARACTERS || [], pass = D.PASSAGES || [];
  const LVS = VC.levelIds(P), BYL = VC.wordsByLevel(D.WORDS, P), goals = VC.progressMapGoals(P), cl = sim.clone;
  if(!goals.length || !VC.levelGateHold) throw new Error(`${dir}: pack has no progressMap goals`);
  const start = () => VC.normalizeProg({ placedOnce: true, soundsOpened: true }, P);
  const t00 = Date.now(), runs = [];
  for(const seed of seeds){
    const t0 = Date.now(), rows = [];
    await S.playSessions(P, start(), N, seed, ACC, (sn, api) => { const q = api.getProg();
      rows.push({ sn: sn + 1, g: VC.goalPositions(q, P, D.WORDS, units, pass), k: Object.fromEntries(LVS.map(lv => [lv, VC.levelKnownPct(D.WORDS, P, q, lv, units)])), gate: VC.levelGateHold(D.WORDS, P, q, units) }); }, { read: true, patterns: false });
    const tr = goals.map((_, g) => rows.map(r => r.g[g])), holds = EC.holdsOf(rows, P.levelGate);
    runs.push({ seed, tr, holds, secs: Math.round((Date.now() - t0) / 1000) });
    console.log(`seed ${seed} (${runs[runs.length - 1].secs} s): goals from ${rows[0].g.map(x => x.toFixed(3)).join("/")} reach ${VC.GOAL_DONE} after ${tr.map(t => { const c = EC.crossOf(t); return c === null ? `>${N}` : c; }).join("/")} sessions; holds ${holds.map(h => `from ${(h[0] * 100).toFixed(1)}% open after ${h.length - 1}`).join(", ") || "none"}; typed asks answered right as intended ${S.stats.typedMatched}/${S.stats.typedRight}`);
  }
  // --calibrate measures the curves on its seeds; --gate checks the pack's own eta (a legacy {gain, known} as a straight line)
  const legacyCurve = (g, p0) => { const v = VC.etaGain(P, g); return v == null ? null : [[p0, (VC.GOAL_DONE - p0) / v], [VC.GOAL_DONE, 0]]; };
  const pe = P.eta || {};
  const eta = calibrateMode
    ? { curve: goals.map((_, g) => EC.goalCurve(runs.map(r => r.tr[g]))), knownCurve: EC.knownCurve(runs.flatMap(r => r.holds), P.levelGate) }
    : { curve: Array.isArray(pe.curve) ? pe.curve : goals.map((_, g) => legacyCurve(g, 0)), knownCurve: "knownCurve" in pe ? pe.knownCurve : null, legacyKnown: "knownCurve" in pe ? null : VC.etaKnown(P) };
  const out = { curve: eta.curve.slice(), knownCurve: eta.knownCurve };
  const verdicts = goals.map((_, g) => {
    const v = EC.goalGate(eta.curve[g], runs.map(r => r.tr[g]));
    if(v.ok === false) out.curve[g] = null;
    return Object.assign({ what: `goal ${g + 1}`, curve: eta.curve[g] }, v);
  });
  const kc = eta.knownCurve || (eta.legacyKnown ? h => Math.max(1, Math.ceil((P.levelGate - h[0]) * BYL[h.prev].length / eta.legacyKnown - 1e-9)) : null);
  const kv = EC.knownGate(kc, runs.map(r => r.holds));
  if(kv.ok === false) out.knownCurve = null;
  verdicts.push(Object.assign({ what: "gate", curve: typeof kc === "function" ? [[0, "legacy known " + eta.legacyKnown]] : kc }, kv));
  const fmtA = c => c.map(([x, y]) => `${x}:${typeof y === "number" ? +y.toFixed(1) : y}`).join(" ");
  // the gate verdict carries knownCurve, an object by level; goal verdicts carry one array
  const fmtC = c => !c ? "null" : Array.isArray(c) ? fmtA(c) : Object.keys(c).map(k => `${k} ${c[k] ? fmtA(c[k]) : "null"}`).join("; ");
  console.log(`${calibrateMode ? "measured" : "pack.eta"}: sessions ${N}, accuracy ${ACC}, seeds ${seeds.join("/")}`);
  verdicts.forEach(v => { console.log(v.ok === null ? `GATE  ${v.what}: no estimate (${calibrateMode ? "fewer than 2 seeds reached it / no hold" : "pack.eta null"})` : `GATE  ${v.what}: ${v.ok ? (v.tail ? "PASS (tail rule)" : "PASS") : calibrateMode ? "FAIL (written null: no estimate shown)" : "FAIL"} within +-${EC.TOL * 100}%; curve ${fmtC(v.curve)}`);
    (v.probes || []).forEach(p => console.log(`        at ${p.q}: ${p.ok ? "pass" : p.tail ? "tail" : "fail"} ${p.per.map(x => x.note).join(" | ")}`)); (v.per || []).forEach(x => console.log(`        ${x.note}`)); });
  console.log(`result: ${JSON.stringify(out)}; wall ${Math.round((Date.now() - t00) / 1000)} s`);
  if(arg("--write")){ fs.writeFileSync(arg("--write"), JSON.stringify(out) + "\n"); console.log(`wrote ${arg("--write")}`); }
  if(!calibrateMode && verdicts.some(v => v.ok === false)) process.exitCode = 1;
}

// ------------------------------------------------------------------ flag-off base (main before fb41)
const BASE = "e165cb1";
const git = f => cp.execSync(`git -C "${ROOT}" show ${BASE}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
let BASE_CORE = null, BASE_APP = null;
// [6] pack.placedKnown flag-off control: fb51 head, the engine before the flag.
const PK_BASE = process.env.PLACED_KNOWN_BASE || "92a1aed";
let PK_CORE = null, PK_APP = null;
try { const gs = f => cp.execSync(`git -C "${ROOT}" show ${PK_BASE}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eta-pk-")), "core_pk.js"); fs.writeFileSync(f, gs("engine/core.js")); PK_CORE = require(f); PK_APP = gs("engine/app.html"); } catch(e){ PK_CORE = null; }
try { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eta-")), "core_base.js"); fs.writeFileSync(f, git("engine/core.js")); BASE_CORE = require(f); BASE_APP = git("engine/app.html"); } catch(e){ BASE_CORE = null; }

const ctx = { pack: PACK, words: WORDS, units: CHARACTERS, passages: PASSAGES };
const VIEW = { passages: PASSAGES, patterns: true };
const stripTags = h => h.replace(/<[^>]+>/g, "");
const pvn = (h, head) => { const m = h.match(new RegExp(`<span>${head}</span><span class="pvn">([^<]*)</span>`)); return m ? m[1] : null; };
const SIG2 = n => { const r = n >= 100 ? Math.round(n / 10) * 10 : n; return r > 999 ? "≈\u00a0999+ sessions" : `≈\u00a0${r} session${r === 1 ? "" : "s"}`; };
const pmLine = (n, g, p0, step) => Array.from({ length: n }, (_, i) => ({ sn: 10 + i, p: Math.round((p0 + step * i) * 1000) / 1000, g }));

(async () => {
  if(argv.includes("--pack")){ await packMode(); return; }
  if(argv.includes("--trace")){ await traceMode(); return; }
  if(argv.includes("--calibrate")){ await calibrate(); return; }

  console.log(`\n[1] core: the model from the first session (measured pace never shown for goals), levelOpensIn`);
  {
    const ZE = JSON.parse(fs.readFileSync(ZH_ETA, "utf8"));
    check("constants: no PM_MIN, PM_KEEP 14; legacy fallback ETA_GAIN one per zh goal, ETA_KNOWN 5.2", VC.PM_MIN === undefined && VC.PM_KEEP === 14 && VC.ETA_GAIN.length === GOALS.length && VC.ETA_KNOWN === 5.2);
    check("zh pack.eta = tools/zh_eta.json: a curve per goal + a knownCurve per gated level, no legacy keys", JSON.stringify(PACK.eta) === JSON.stringify(ZE) && PACK.eta.curve.length === GOALS.length && LV.slice(0, -1).every(lv => Array.isArray(PACK.eta.knownCurve[lv])) && !("gain" in PACK.eta) && !("known" in PACK.eta));
    // etaCurveAt: interpolation, endpoints, null
    const C = [[0, 100], [0.5, 30], [0.9, 0]];
    check("etaCurveAt: 0 -> 100, 0.25 -> 65, 0.5 -> 30, 0.7 -> 15, 0.9 -> 0, past the last -> 0, below the first -> its value, null / [] -> null",
      VC.etaCurveAt(C, 0) === 100 && VC.etaCurveAt(C, 0.25) === 65 && VC.etaCurveAt(C, 0.5) === 30 && Math.abs(VC.etaCurveAt(C, 0.7) - 15) < 1e-9 && VC.etaCurveAt(C, 0.9) === 0
      && VC.etaCurveAt(C, 0.95) === 0 && VC.etaCurveAt([[0.2, 50], [0.9, 0]], 0.1) === 50 && VC.etaCurveAt(null, 0.3) === null && VC.etaCurveAt([], 0.3) === null);
    const withEta = eta => Object.assign(clone(PACK), { eta }), cx = pk => Object.assign({}, ctx, { pack: pk }), f0 = freshStart();
    check("sessionsToGoX on a curve: position 0 = ceil(first point); null curve -> null; legacy {gain} -> (0.9 - p) / gain; no pack.eta -> the zh constants",
      VC.sessionsToGoX(f0, 0, 3, cx(withEta({ curve: [C, null, C] }))) === 100 && VC.sessionsToGoX(f0, 1, 3, cx(withEta({ curve: [C, null, C] }))) === null
      && VC.sessionsToGoX(f0, 0, 3, cx(withEta({ gain: [0.01, 0.02, 0.03], known: 5 }))) === 90 && VC.sessionsToGoX(f0, 1, 3, cx(withEta({ gain: [0.01, null, 0.03], known: 5 }))) === null
      && VC.sessionsToGoX(f0, 0, 3, cx(stripFlags(PACK, ["eta"]))) === Math.ceil(VC.GOAL_DONE / VC.ETA_GAIN[0] - 1e-9));
    check("an eta object missing the needed key -> null, never the zh constants: {known} has no goal estimate, {curve} without knownCurve/known no gate estimate",
      VC.sessionsToGoX(f0, 0, 3, cx(withEta({ known: 5 }))) === null && VC.levelOpensIn(WORDS, withEta({ curve: [C, C, C] }), seedLevel(2, 10), CHARACTERS) === null
      && VC.levelOpensIn(WORDS, withEta({ curve: [C, C, C], known: 5 }), seedLevel(2, 10), CHARACTERS) !== null);
    let p1 = null;
    await playSessions(SIM, freshStart(), 1, 5, 0.85, (sn, api) => { if(sn === 0) p1 = clone(api.getProg()); }, VIEW);
    const cg = VC.currentGoal(p1, PACK, WORDS, CHARACTERS, PASSAGES), m1 = VC.sessionsToGoX(p1, cg.i, cg.n, ctx), m0 = VC.sessionsToGoX(f0, 0, 3, ctx);
    console.log(`INFO  fresh record: session 0 ${m0}; after session 1 goal ${cg.i + 1} at ${cg.p.toFixed(3)}, model ${m1} sessions (fresh sims reached goal 1 after 96/94/99)`);
    check(`fresh zh record: session 0 reads ${m0}, session 1 ${m1}: both 94-100 ("≈ ${m0} sessions"; was ≈ 830 on the fb41 constant)`, m0 >= 94 && m0 <= 100 && m1 >= 94 && m1 <= 100 && m1 <= m0);
    const base = { pm: [] }, at = x => Object.assign(clone(p1), { pm: x });
    const two = pmLine(2, 0, 0.1, 0.01), three = pmLine(3, 0, 0.1, 0.01), fourteen = pmLine(14, 0, 0.1, 0.01);
    const thirteen = pmLine(13, 0, 0.1, 0.01);
    check("2, 3, 13 and 14 entries of the goal: the model (measured at 14 missed the crossing on 3 of 4 owner sims: --calibrate)", [two, three, thirteen, fourteen].every(pm => VC.sessionsToGoX(at(pm), 0, 3, ctx) === m1));
    check("14 entries: sessionsToGo (flag-off pace) is 67 while sessionsToGoX stays the model", VC.sessionsToGo(at(fourteen), 0, 3) === 67 && VC.sessionsToGoX(at(fourteen), 0, 3, ctx) === m1);
    const pms = [pmLine(3, 0, 0.1, 0.02), pmLine(5, 1, 0.3, 0.004), pmLine(9, 0, 0.5, 0.013), pmLine(14, 2, 0.2, 0.001), pmLine(4, 0, 0.5, 0)];
    check("any entries of any goal (3 to 14, rising): the model, never the measured pace", pms.slice(0, 4).every(pm => VC.sessionsToGoX(at(pm), pm[0].g, 3, ctx) === VC.sessionsToGoX(at([]), pm[0].g, 3, ctx)));
    check("a flat or falling measured pace: the model answers", VC.sessionsToGoX(at(pms[4]), 0, 3, ctx) === m1 && VC.sessionsToGoX(at(pmLine(5, 0, 0.5, -0.01)), 0, 3, ctx) === m1);
    check("entries of another goal do not count for this one", VC.sessionsToGoX(at(pmLine(5, 1, 0.3, 0.01)), 0, 3, ctx) === m1);
    check("whole-pack bar (no goal): sessionsToGo's pace at PM_KEEP, else null (no model without a goal)", VC.sessionsToGoX({ pm: pmLine(14, undefined, 0.1, 0.01) }) === 77 && VC.sessionsToGoX({ pm: pmLine(13, undefined, 0.1, 0.01) }) === null);
    const done = clone(p1); const g0 = GOALS[0]; // a goal at or past GOAL_DONE: 0
    const doneProg = (() => { const p = seedKnown(2); return p; })();
    check(`a goal at ${VC.GOAL_DONE}+: 0 (renders nothing)`, VC.goalPosition(doneProg, PACK, g0, WORDS, CHARACTERS, PASSAGES) >= VC.GOAL_DONE && VC.sessionsToGoX(doneProg, 0, 3, ctx) === 0);
    if(BASE_CORE){
      const recs = [{}, at(two), at(three), at(fourteen), at(pms[3]), { pm: pmLine(14, undefined, 0.1, 0.01) }, OWNER ? clone(OWNER) : {}];
      check("sessionsToGo untouched: equal to base on 7 pm shapes x goals", recs.every(r => [[], [0, 3], [1, 3], [2, 3]].every(a => BASE_CORE.sessionsToGo(r, ...a) === VC.sessionsToGo(r, ...a))));
    } else console.log("SKIP  base core unavailable");
    // levelOpensIn
    const lv2 = BYLV[LV[1]].length, near = seedLevel(2, Math.ceil(PACK.levelGate * lv2) - 1), far = seedLevel(2, 10), open = seedLevel(2, Math.ceil(PACK.levelGate * lv2));
    const kNear = VC.levelKnownPct(WORDS, PACK, near, LV[1], CHARACTERS);
    const kcAt = p => Math.max(1, Math.ceil(VC.etaCurveAt(PACK.eta.knownCurve[LV[1]], VC.levelKnownPct(WORDS, PACK, p, LV[1], CHARACTERS)) - 1e-9));
    check(`levelOpensIn on knownCurve: one word short of the gate -> 1; 10 of ${lv2} known -> ceil(knownCurve at ${(VC.levelKnownPct(WORDS, PACK, far, LV[1], CHARACTERS) * 100).toFixed(1)}%) = ${VC.levelOpensIn(WORDS, PACK, far, CHARACTERS)}`,
      VC.levelOpensIn(WORDS, PACK, near, CHARACTERS) === 1 && VC.levelOpensIn(WORDS, PACK, far, CHARACTERS) === kcAt(far));
    const leg = Object.assign(clone(PACK), { eta: { gain: [0.01, 0.01, 0.01], known: 5.2 } }), noE = stripFlags(PACK, ["eta"]), nullK = Object.assign(clone(PACK), { eta: { curve: PACK.eta.curve, knownCurve: null } });
    const lin = Math.ceil((PACK.levelGate - VC.levelKnownPct(WORDS, PACK, far, LV[1], CHARACTERS)) * lv2 / 5.2 - 1e-9);
    check(`levelOpensIn: legacy known 5.2 and no pack.eta -> words / 5.2 = ${lin}; knownCurve null -> null`, VC.levelOpensIn(WORDS, leg, far, CHARACTERS) === lin && VC.levelOpensIn(WORDS, noE, far, CHARACTERS) === lin && VC.levelOpensIn(WORDS, nullK, far, CHARACTERS) === null);
    check("levelOpensIn: open gate -> null; pack without levelGate -> null", VC.levelOpensIn(WORDS, PACK, open, CHARACTERS) === null && VC.levelOpensIn(WORDS, stripFlags(PACK, ["levelGate"]), far, CHARACTERS) === null);
  }

  console.log(`\n[2] owner export: the numbers shown, and the sims they come from`);
  let ownerN = null;
  if(!OWNER) console.log("SKIP  owner export not found");
  else {
    const o = ownerStart(), h = VC.levelGateHold(WORDS, PACK, o, CHARACTERS);
    ownerN = VC.levelOpensIn(WORDS, PACK, o, CHARACTERS);
    const cg = VC.currentGoal(o, PACK, WORDS, CHARACTERS, PASSAGES), gN = VC.sessionsToGoX(o, cg.i, cg.n, ctx);
    // The actual opening on the owner export: 3 seeds of the calibration sim.
    const opened = [];
    for(const seed of [5, 6, 7]){ let at = null; await playSessions(SIM, ownerStart(), 16, seed, 0.85, (sn, api) => { if(at == null && sn >= 0 && !VC.levelGateHold(WORDS, PACK, api.getProg(), CHARACTERS)) at = sn + 1; }, VIEW); opened.push(at); }
    console.log(`INFO  owner export: goal ${cg.i + 1} at ${cg.p.toFixed(3)} -> model ${gN} sessions (sims: 162-184); HSK ${h && h.lv} gate at ${h && h.pct}% -> ${ownerN} sessions (sims opened after ${opened.join("/")})`);
    globalThis.__ownerGoal = gN;
    // Owner sims (--calibrate, seeds 5/6/7) crossed after 183/162/184 from this position; the fresh curve reads the
    // position only, and this record's word share stalls while HSK 3 is taught (PACK_SCHEMA "ETA model" > "Known miss").
    const errs = [183, 162, 184].map(x => (gN - x) / x);
    console.log(`INFO  owner export goal estimate ${gN} vs sim crossings 183/162/184: ${errs.map(e => Math.round(e * 100) + "%").join(" ")}`);
    check(`owner export goal: the fresh curve at ${cg.p.toFixed(3)} = ${gN}, below the full fresh crossing`, gN === Math.max(1, Math.ceil(VC.etaCurveAt(PACK.eta.curve[cg.i], cg.p) - 1e-9)) && gN < PACK.eta.curve[cg.i][0][1]);
    check(`owner export gate: knownCurve ${ownerN} within 30% of 2 of the sims (opened after ${opened.join("/")})`, opened.filter(x => x != null && Math.abs(ownerN - x) / x <= 0.3).length >= 2);
  }

  console.log(`\n[3] rendering (appView v2): Today, Progress, held row, done goal, open gate, two-digit display and 999+ cap`);
  {
    const tb = await bootWith(PACK, null, 1, VIEW);
    check(`etaText: 0/null -> "", 1 -> "≈\u00a01 session", 12 -> exact, 99 -> exact, 100 -> 100, 176 -> 180, 198 -> 200, 830 -> 830, 994 -> 990, 995+ and 5000 -> "999+"`, tb.eta(0) === "" && tb.eta(null) === "" && tb.eta(1) === "≈\u00a01 session" && tb.eta(12) === "≈\u00a012 sessions" && tb.eta(99) === "≈\u00a099 sessions" && tb.eta(100) === "≈\u00a0100 sessions" && tb.eta(176) === "≈\u00a0180 sessions" && tb.eta(198) === "≈\u00a0200 sessions" && tb.eta(830) === "≈\u00a0830 sessions" && tb.eta(994) === "≈\u00a0990 sessions" && tb.eta(995) === "≈\u00a0999+ sessions" && tb.eta(5000) === "≈\u00a0999+ sessions");
    if(OWNER){
      const gOwner = globalThis.__ownerGoal, T = await bootWith(PACK, ownerStart(), 1, VIEW), th = T.panel();
      const sent = `HSK 4 opens at 70% of HSK 3 known. Now ${VC.levelGateHold(WORDS, PACK, ownerStart(), CHARACTERS).pct}%, ≈\u00a0${ownerN} sessions.`;
      console.log(`INFO  owner Today: goal "${pvn(th, "Goal 1 of 3")}"; gate "${T.gate()}"`);
      check(`owner Today: the Learn row carries "${sent}"`, th.includes(`<div class="pvs pvgate">${sent}</div>`) && T.gate() === sent);
      check(`owner Today: goal line "${SIG2(gOwner)}" (model ${gOwner}), no pace placeholder`, pvn(th, "Goal 1 of 3") === SIG2(gOwner) && !/pace: —/.test(th));
      T.clickTab("progress"); const ph = T.panel();
      check("owner Progress: the same goal number and gate sentence", pvn(ph, "Goal 1 of 3") === pvn(th, "Goal 1 of 3") && ph.includes(`<p class="pvs pvgate">${sent}</p>`));
      check(`owner Progress: the held HSK 4 row carries no estimate in its detail line (the gate sentence under it is the one place, once)`, !/<p class="pvs">≈/.test(ph) && (ph.match(new RegExp(`≈\\u00a0${ownerN} session`, "g")) || []).length === 1);
      const P = await bootWith(PACK, clone(OWNER), 1, VIEW), pth = P.panel(); // the export as exported: paused, no Learn row
      check("owner export paused: Today has no Learn row, the goal line still shows the estimate", !/<span>Learn<\/span>/.test(pth) && pvn(pth, "Goal 1 of 3") === SIG2(gOwner));
    }
    // a full pm window still shows the model
    const mp = ownerStart(); mp.pm = pmLine(14, 0, 0.5, 0.01).map((e, i) => Object.assign(e, { sn: (mp.sn || 0) - 13 + i }));
    const M = await bootWith(PACK, mp, 1, VIEW), mh = M.panel(), mN = VC.sessionsToGoX(mp, 0, 3, ctx);
    check(`14 pm entries rising 0.01: still the model (${mN}, not the measured 27) on Today and Progress`, mN === VC.sessionsToGoX(ownerStart(), 0, 3, ctx) && mN !== 27 && pvn(mh, "Goal 1 of 3") === SIG2(mN) && (M.clickTab("progress"), pvn(M.panel(), "Goal 1 of 3") === SIG2(mN)));
    // open gate: no sentence, no estimate on level rows
    const og = seedLevel(2, Math.ceil(PACK.levelGate * BYLV[LV[1]].length) + 5); og.chars.choiceSeen = true;
    const O = await bootWith(PACK, og, 1, VIEW); const oh = O.panel(); O.clickTab("progress"); const oph = O.panel();
    check("open gate: no gate sentence on Today or Progress, no level-row estimate", !VC.levelGateHold(WORDS, PACK, og, CHARACTERS) && !/opens at/.test(oh + oph) && !/<p class="pvs">≈/.test(oph));
    // every goal done: no estimate anywhere
    const all = seedKnown(4); const A = await bootWith(PACK, all, 1, VIEW); const ah = A.panel(); A.clickTab("progress"); const aph = A.panel();
    check(`all goals done: "All goals" shows its percent, no "≈" on Today or Progress`, (VC.currentGoal(all, PACK, WORDS, CHARACTERS, PASSAGES) || {}).all === true && /<span>All goals<\/span><span class="pvn">\d+%/.test(ah) && !/≈/.test(ah + aph));
    // A whole-pack bar (progressMap true, no goals) under appView: sessionsToGo from PM_KEEP entries, else no second line (no model without a goal).
    const WP = Object.assign(clone(PACK), { progressMap: true }), wp = ownerStart();
    const F = await bootWith(WP, wp, 1, VIEW), fh = F.panel();
    wp.pm = pmLine(14, undefined, 0.3, 0.01).map((e, i) => Object.assign(e, { sn: (wp.sn || 0) - 13 + i }));
    const F3 = await bootWith(WP, wp, 1, VIEW), f3 = F3.panel();
    check("whole-pack bar under appView: no pm -> no second line, no placeholder; 14 entries -> sessionsToGo", /<div class="pmap" id="pmap"/.test(fh) && !/class="pm2"/.test(fh) && !/pace: —/.test(fh) && f3.includes(`<div class="pm2">≈\u00a0${VC.sessionsToGoX(wp)} sessions</div>`));
  }

  console.log(`\n[4] flag-off: Today and Progress byte-identical to ${BASE} on 3 records (appView off; appView + progressView off)`);
  if(!BASE_CORE) console.log("SKIP  base unavailable");
  else {
    const recs = [["fresh", freshStart()], ["owner", OWNER ? ownerStart() : seedKnown(2)], ["mid + 5 pm", (() => { const p = seedLevel(2, 30); p.pm = pmLine(5, 0, 0.3, 0.01); return p; })()]];
    for(const [pk, pack] of [["appView off", stripFlags(PACK, ["appView"])], ["appView + progressView off", stripFlags(PACK, ["appView", "progressView"])]]){
      for(const [name, rec] of recs){
        // one app at a time: boot reseeds the shared Math.random
        const run = async env => { const x = await bootWith(pack, clone(rec), 3, Object.assign({}, env, VIEW)); const t = x.panel(); x.clickTab("progress"); return [t, x.panel()]; };
        const [t1, p1] = await run({}), [t2, p2] = await run({ core: BASE_CORE, html: BASE_APP });
        check(`${pk}, ${name}: Today + Progress equal base`, t1 === t2 && p1 === p2);
      }
    }
  }

  console.log(`\n[5] placed starts (Test tab placement at HSK 2 / HSK 3): prog.pl selects pack.eta.placed for the whole record (pack.placedKnown off: [6] has it on)`);
  const PK0 = stripFlags(PACK, ["placedKnown"]), ctx0 = Object.assign({}, ctx, { pack: PK0 });
  {
    const PACK = PK0, ctx = ctx0;
    // Replaces fb41's seeded-record gate check (owner 2026-10-08: new learners, with or without the placement test).
    // Crossings of `--calibrate`'s placed runs, seeds 8/9/10 (85% right, 7 a day, passages read); --calibrate probes every
    // 25 sessions up to the crossing plus the first session without provisional records.
    const SIMS = { 2: { goal: [95, 89, 91], gate: [35, 38, 38] }, 3: { goal: [146, 155, 155], gate: [65, 68, 75] } };
    const within = (e, xs) => xs.filter(x => Math.abs(e - x) / x <= 0.3).length >= 2, up = v => Math.max(1, Math.ceil(v - 1e-9));
    const PL = PACK.eta.placed;
    check("zh pack.eta.placed: HSK 2 and HSK 3 each a goal-1 bySessions curve (goals 2/3 null) + a hold curve for the level below",
      ["2", "3"].every(l => Array.isArray(PL[l].bySessions[0]) && PL[l].bySessions[1] === null && PL[l].bySessions[2] === null && Array.isArray(PL[l].knownCurve[String(+l - 1)])));
    for(const lv of [2, 3]){
      const p = placedStart(lv), cg = VC.currentGoal(p, PACK, WORDS, CHARACTERS, PASSAGES), h = VC.levelGateHold(WORDS, PACK, p, CHARACTERS);
      const ge = VC.sessionsToGoX(p, cg.i, cg.n, ctx), gt = VC.levelOpensIn(WORDS, PACK, p, CHARACTERS), by = PL[lv].bySessions[cg.i];
      const wantG = up(by ? VC.etaCurveAt(by, 0) : VC.etaCurveAt(PACK.eta.curve[cg.i], cg.p)), wantK = up(VC.etaCurveAt(PL[lv].knownCurve[h.prev], 0));
      console.log(`INFO  placed at HSK ${lv}: pl ${p.pl}; goal ${cg.i + 1} at ${cg.p.toFixed(3)} -> ${ge} (${by ? "placed bySessions" : "fresh"} curve; sims ${SIMS[lv].goal.join("/")}); HSK ${h.lv} waits on HSK ${h.prev} at ${h.pct}% -> ${gt} (placed knownCurve; sims ${SIMS[lv].gate.join("/")})`);
      check(`placed at HSK ${lv}: applyPlacement stores pl "${lv}" with placedOnce`, p.pl === String(lv) && p.placedOnce === true);
      check(`placed at HSK ${lv}: goal ${cg.i + 1} reads the ${by ? "placed bySessions" : "fresh"} curve (${ge}), within 30% of 2 of the sims ${SIMS[lv].goal.join("/")}`, ge === wantG && within(ge, SIMS[lv].goal) && !!by);
      check(`placed at HSK ${lv}: the placed level's hold reads the placed knownCurve (${gt}), within 30% of 2 of the sims ${SIMS[lv].gate.join("/")}`, gt === wantK && within(gt, SIMS[lv].gate));
      // Whole record: provisional records cleared (sessions 73-95 in the sims) do not switch the set; 50 sessions in, the
      // goal reads bySessions at 50.
      const cleared = clone(p); Object.values(cleared.w).forEach(r => { delete r.prov; }); cleared.sessions = 50;
      check(`placed at HSK ${lv}: 50 sessions in with no provisional records, still the placed set (goal ${VC.sessionsToGoX(cleared, cg.i, cg.n, ctx)})`,
        VC.sessionsToGoX(cleared, cg.i, cg.n, ctx) === (by ? up(VC.etaCurveAt(by, 50)) : up(VC.etaCurveAt(PACK.eta.curve[cg.i], VC.goalPositions(cleared, PACK, WORDS, CHARACTERS, PASSAGES)[cg.i])))
        && VC.levelOpensIn(WORDS, PACK, cleared, CHARACTERS) === up(VC.etaCurveAt(PL[lv].knownCurve[h.prev], VC.levelKnownPct(WORDS, PACK, cleared, h.prev, CHARACTERS))));
      const noPl = clone(p); delete noPl.pl;
      const unset = Object.assign(clone(PACK), { eta: { curve: PACK.eta.curve, knownCurve: PACK.eta.knownCurve } });
      const fG = up(VC.etaCurveAt(PACK.eta.curve[cg.i], cg.p)), fK = up(VC.etaCurveAt(PACK.eta.knownCurve[h.prev], 0));
      check(`placed at HSK ${lv}: no pl, or a pack without eta.placed, -> the fresh curves (${fG}, ${fK})`,
        VC.sessionsToGoX(noPl, cg.i, cg.n, ctx) === fG && VC.levelOpensIn(WORDS, PACK, noPl, CHARACTERS) === fK
        && VC.sessionsToGoX(p, cg.i, cg.n, Object.assign({}, ctx, { pack: unset })) === fG && VC.levelOpensIn(WORDS, unset, p, CHARACTERS) === fK);
    }
    // An uncalibrated placed level (pl "4": no sim, no set) -> fresh curves.
    const p4 = placedStart(3); p4.pl = "4";
    check(`pl without a calibrated set ("4") -> the fresh curves`, VC.sessionsToGoX(p4, 0, 3, ctx) === up(VC.etaCurveAt(PACK.eta.curve[0], VC.goalPositions(p4, PACK, WORDS, CHARACTERS, PASSAGES)[0])));
    // pl is written only by a placement taken before any session (a retake later leaves the record without pl).
    const later = freshStart(); later.sessions = 3;
    const st3 = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK)), re = VC.applyPlacement(later, st3, st3.findIndex(b => String(b.lv) === "3"), WORDS, PACK);
    check("applyPlacement after sessions: placedOnce set, no pl (the fresh curves answer)", re.placedOnce === true && !("pl" in re));
    const T = await bootWith(PACK, placedStart(3), 1, VIEW), th = T.panel(), n3 = VC.sessionsToGoX(placedStart(3), 0, 3, ctx);
    console.log(`INFO  placed HSK 3 Today: goal "${pvn(th, "Goal 1 of 3")}"; gate "${T.gate()}"`);
    check(`placed at HSK 3, Today: goal line "${SIG2(n3)}" and the gate sentence ends "≈ ${VC.levelOpensIn(WORDS, PACK, placedStart(3), CHARACTERS)} sessions."`, pvn(th, "Goal 1 of 3") === SIG2(n3) && T.gate().endsWith(`≈\u00a0${VC.levelOpensIn(WORDS, PACK, placedStart(3), CHARACTERS)} sessions.`));
  }

  console.log(`\n[6] pack.placedKnown (fb52): placed provisional records count as known for the gate, goals, map and ETA position; flag off byte-identical to ${PK_BASE}`);
  {
    const PK0 = stripFlags(PACK, ["placedKnown"]), c0 = Object.assign({}, ctx, { pack: PK0 });
    const st = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK));
    // The owner's placement (docs/PACK_SCHEMA.md "placementWhole"): every bucket answered, one isolated zero, k = 10 -> lands in HSK 4.
    const k = VC.placementStopIndex(st.map((_, i) => i < 10 ? { r: i === 3 ? 0 : 3, n: 3 } : { r: 0, n: 3 }), { whole: true });
    const placedOwner = () => VC.applyPlacement(freshStart(), st, k, WORDS, PACK, CHARACTERS);
    const placedA2 = () => VC.applyPlacement(freshStart(), st, st.findIndex(b => String(b.lv) === "3"), WORDS, PACK, CHARACTERS);
    check(`zh ships placedKnown; the owner fixture gives k = ${k} (lands ${st[k] && st[k].lv})`, PACK.placedKnown === true && VC.placedKnownOn(PACK) && !VC.placedKnownOn(PK0) && k === 10 && String(st[k].lv) === "4");
    const freshEta = VC.sessionsToGoX(freshStart(), 0, 3, ctx);
    for(const [name, mk] of [["owner k=10 (HSK 4)", placedOwner], ["A2-equivalent (HSK 3)", placedA2]]){
      const p = mk(), land = st[name.startsWith("owner") ? k : st.findIndex(b => String(b.lv) === "3")];
      const nn = VC.nextNewSetOpen(WORDS, PACK, p, CHARACTERS), cg = VC.currentGoal(p, PACK, WORDS, CHARACTERS, PASSAGES), eta = VC.sessionsToGoX(p, cg.i, cg.n, ctx);
      const cg0 = VC.currentGoal(p, PK0, WORDS, CHARACTERS, PASSAGES), eta0 = VC.sessionsToGoX(p, cg0.i, cg0.n, c0), hold0 = VC.levelGateHold(WORDS, PK0, p, CHARACTERS);
      console.log(`INFO  ${name}: pl ${p.pl}; next ${nn && nn.lv}/${nn && nn.set + 1}; goal ${cg.i + 1} at ${cg.p.toFixed(3)} -> ${eta} (flag off: goal ${cg0.i + 1} at ${cg0.p.toFixed(3)} -> ${eta0}, gate ${hold0 ? hold0.pct + "%" : "open"}); map ${VC.progressPosition(p, PACK, WORDS, CHARACTERS, PASSAGES).toFixed(3)}`);
      check(`${name}: flag off reproduces the defect (gate holds at 0%, goal 1 at 0)`, !!hold0 && hold0.pct === 0 && cg0.i === 0 && cg0.p === 0);
      check(`${name}: Learn's next set is the placed one (${land.lv} set ${land.s0 + 1})`, !!nn && nn.lv === String(land.lv) && nn.set === land.s0);
      check(`${name}: no gate hold, no gate estimate`, VC.levelGateHold(WORDS, PACK, p, CHARACTERS) === null && VC.levelOpensIn(WORDS, PACK, p, CHARACTERS) === null);
      // Owner 2026-10-09: a goal placement covered is full and carries no estimate; the next unmet goal carries it.
      const gps = VC.goalPositions(p, PACK, WORDS, CHARACTERS, PASSAGES), covered = VC.progressMapGoals(PACK).map(g => VC.levelIndexMap(PACK)[g.upTo] < VC.levelIndexMap(PACK)[String(land.lv)]);
      check(`${name}: goals placement covered are full (${gps.map(x => x.toFixed(2)).join(", ")}), the current goal is the first unmet one (${cg.i + 1}) and carries no estimate for a covered goal`, covered.every((c, g) => !c || gps[g] === 1) && cg.i === covered.indexOf(false) && covered.every((c, g) => !c || VC.sessionsToGoX(p, g, 3, ctx) === 0));
      const freshG = VC.sessionsToGoX(freshStart(), cg.i, 3, ctx);
      check(`${name}: ETA of goal ${cg.i + 1} finite and below the fresh value for that goal (${eta} < ${freshG}) (flag off: goal ${cg0.i + 1} ${eta0})`, Number.isFinite(eta) && eta > 0 && eta < freshG && (cg0.i !== cg.i || eta < eta0));
      check(`${name}: mastered counts unchanged by the flag (progressTotals m, wordKnownX)`, VC.progressTotals(p, PACK, WORDS, CHARACTERS, PASSAGES).m === VC.progressTotals(p, PK0, WORDS, CHARACTERS, PASSAGES).m);
      const T = await bootWith(PACK, p, 1, VIEW), th = T.panel(); T.clickTab("progress"); const ph = T.panel();
      check(`${name}: Today + Progress carry no gate sentence; Today goal line "${SIG2(eta)}"`, !T.gate() && !/opens at/.test(th + ph) && pvn(th, `Goal ${cg.i + 1} of 3`) === SIG2(eta));
    }
    // levelExam "characters" (HSK 3): a placed word whose prov settled at known keeps counting while its unit is still placed.
    {
      const p = placedOwner(), bw = VC.knownCtx(PACK, CHARACTERS), w = WORDS.find(x => x.lv === "3" && bw.get(x.id) && p.w[x.id] && p.w[x.id].prov && VC.charRecs(p)[bw.get(x.id).id] && VC.charRecs(p)[bw.get(x.id).id].prov);
      const pct0 = VC.levelKnownPct(WORDS, PACK, p, "3", CHARACTERS), n = BYLV["3"].length;
      const r = p.w[w.id]; delete r.prov; r.p = { wm: [3, 1], sm: [3, 1], ws: [3, 1] };
      const known = VC.wordKnown(r, w, PACK), exam = VC.wordKnownX(r, w, PACK, p, bw), pct1 = VC.levelKnownPct(WORDS, PACK, p, "3", CHARACTERS);
      const u = VC.charRecs(p)[bw.get(w.id).id]; delete u.prov; const pct2 = VC.levelKnownPct(WORDS, PACK, p, "3", CHARACTERS);
      check(`levelExam characters: ${w.w} known by the word rule, not by the exam (unit at streak 1): counts while its unit is placed (${pct0} -> ${pct1}), not once the unit's prov is gone (${pct2})`, known && !exam && pct1 === pct0 && Math.abs(pct2 - (pct0 - 1 / n)) < 1e-9);
    }
    // Fully placed (every bucket passed, k = null; owner 2026-10-09 es screenshot "everything covered", "Goal 1 of 3 ≈ 180 sessions"):
    // every goal full, the finished learner's "All goals" line without an estimate, mastered rows stay literal (0).
    {
      const all = VC.applyPlacement(freshStart(), st, st.length, WORDS, PACK, CHARACTERS), cg = VC.currentGoal(all, PACK, WORDS, CHARACTERS, PASSAGES);
      const T = await bootWith(PACK, all, 1, VIEW), th = T.panel(); T.clickTab("progress"); const ph = T.panel();
      console.log("INFO  fully placed Today goal: " + ((th.match(/<div class="pmap[\s\S]*?<\/div><\/div>/) || [])[0] || th.slice(0, 600)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") + " | gate: " + T.gate() + " | ≈ " + /≈/.test(th) + "/" + /≈/.test(ph));
      check(`fully placed: every goal 1 (${VC.goalPositions(all, PACK, WORDS, CHARACTERS, PASSAGES).join(", ")}), currentGoal all`, cg.all === true && VC.goalPositions(all, PACK, WORDS, CHARACTERS, PASSAGES).every(x => x === 1) && [0, 1, 2].every(g => VC.sessionsToGoX(all, g, 3, ctx) === 0));
      check("fully placed: Today reads \"All goals\" 100% (the finished learner's line), Today and Progress carry no \"≈\" and no gate sentence", /<span>All goals<\/span><span class="pvn">100%/.test(th) && !/≈/.test(th + ph) && !T.gate());
      check(`fully placed: mastered counts stay literal (progressTotals m ${VC.progressTotals(all, PACK, WORDS, CHARACTERS, PASSAGES).m}; flag off equal), Progress shows "0 of"`, VC.progressTotals(all, PACK, WORDS, CHARACTERS, PASSAGES).m === 0 && VC.progressTotals(all, PK0, WORDS, CHARACTERS, PASSAGES).m === 0 && / 0 of \d+ mastered|>0 of \d+ mastered/.test(ph));
    }
    // A pl without a placed set reads the nearest lower level's set (zh: "4" -> "3"); its knownCurve answers a gate hold.
    const near = placedOwner(); delete near.pl; near.pl = "4";
    check(`etaPlaced: pl "4" -> the "3" set under the flag, null without it`, VC.etaPlaced(near, PACK) === PACK.eta.placed["3"] && VC.etaPlaced(near, PK0) === null && VC.etaPlaced(Object.assign({}, near, { pl: "1" }), PACK) === null);
    // After placement + one session (the owner's screenshot state): still open, goal still near, ETA finite.
    const api = await playSessions(PACK, placedOwner(), 1, 3, 0.85, null, VIEW), q = api.getProg(), cq = VC.currentGoal(q, PACK, WORDS, CHARACTERS, PASSAGES), eq = VC.sessionsToGoX(q, cq.i, cq.n, ctx);
    const freshG3 = VC.sessionsToGoX(freshStart(), 2, 3, ctx);
    check(`owner k=10 + 1 session (fb52 review H1): gate open, goals 1-2 full, current goal ${cq.i + 1} at ${cq.p.toFixed(3)}, ETA ${eq} finite below the fresh goal-3 value ${freshG3}`, VC.levelGateHold(WORDS, PACK, q, CHARACTERS) === null && VC.goalPositions(q, PACK, WORDS, CHARACTERS, PASSAGES).slice(0, 2).every(x => x >= VC.GOAL_DONE) && cq.i === 2 && cq.p >= 0.4 && Number.isFinite(eq) && eq < freshG3);
    // fb52 review H1: a goal placement covered stays full after a session, a miss, or its provisional records settling; the estimate stays on goal 3.
    {
      const pg = (q, tag) => { const cg2 = VC.currentGoal(q, PACK, WORDS, CHARACTERS, PASSAGES); return { gps: VC.goalPositions(q, PACK, WORDS, CHARACTERS, PASSAGES), cg: cg2, eta: [0, 1, 2].map(g => VC.sessionsToGoX(q, g, 3, ctx)) }; };
      const missOne = q => { const w = WORDS.find(x => x.lv === "1" && q.w[x.id] && q.w[x.id].prov); q.w[w.id] = { r: 0, w: 1, s: 0 }; return w; };
      const owner = placedOwner(); owner.sessions = 1; missOne(owner);
      const a = pg(owner);
      console.log(`INFO  owner k=10 + 1 session + 1 HSK 1 miss: goals ${a.gps.map(x => x.toFixed(3)).join(", ")}, current ${a.cg.i + 1}, ETA ${a.eta.join("/")}`);
      check("H1 owner k=10 + 1 session + a miss on a placed HSK 1 word: goals 1-2 stay full (>= GOAL_DONE), currentGoal 3, estimate on goal 3 only", a.gps[0] >= VC.GOAL_DONE && a.gps[1] >= VC.GOAL_DONE && a.cg.i === 2 && a.eta[0] === 0 && a.eta[1] === 0 && a.eta[2] > 0);
      const t0 = pg(placedOwner());
      check("H1 the miss moves the covered goal by about one word, not to 0.8", t0.gps[0] - a.gps[0] > 0 && t0.gps[0] - a.gps[0] < 0.01);
      const settled = placedOwner(); settled.sessions = 1;
      for(const w of WORDS) if(w.lv <= "2" && settled.w[w.id] && settled.w[w.id].prov){ const r = settled.w[w.id]; delete r.prov; r.p = { wm: [3, 1], sm: [3, 1], ws: [3, 1] }; }
      const sg = pg(settled);
      check(`H1 every goal 1-2 provisional record settled known (no prov left): goals ${sg.gps.slice(0, 2).map(x => x.toFixed(2)).join(", ")} stay full, currentGoal 3`, sg.gps[0] >= VC.GOAL_DONE && sg.gps[1] >= VC.GOAL_DONE && sg.cg.i === 2);
      const all = VC.applyPlacement(freshStart(), st, st.length, WORDS, PACK, CHARACTERS); all.sessions = 1; missOne(all);
      const al = pg(all), T = await bootWith(PACK, all, 1, VIEW), th = T.panel(); T.clickTab("progress"); const ph = T.panel();
      check(`H1 fully placed + 1 session + a miss: goals ${al.gps.map(x => x.toFixed(3)).join(", ")} full, currentGoal all, "All goals" 100% with no estimate`, al.gps.every(x => x >= VC.GOAL_DONE) && al.cg.all === true && /<span>All goals<\/span><span class="pvn">100%/.test(th) && !/≈/.test(th + ph));
      const gp = { w: owner.w, sessions: 1 };
      const noPl = clone(owner); delete noPl.pl;
      check("H1 without prog.pl (no placement on record) the normal formula applies", VC.goalPosition(noPl, PACK, PACK.progressMap.goals[0], WORDS, CHARACTERS, PASSAGES) < a.gps[0]);
      const off = clone(owner), PKo = stripFlags(PACK, ["placedKnown"]);
      check("H1 flag off ignores prog.pl (positions equal the same record read without pl)", JSON.stringify(VC.goalPositions(off, PKo, WORDS, CHARACTERS, PASSAGES)) === JSON.stringify(VC.goalPositions(Object.assign(clone(off), { pl: undefined }), PKo, WORDS, CHARACTERS, PASSAGES)));
    }
    // A fresh record and the owner export (no provisional records) are unchanged by the flag.
    const same = [["fresh", freshStart()]].concat(OWNER ? [["owner export", ownerStart()]] : []);
    for(const [name, r] of same){
      const run = async pk => { const x = await bootWith(pk, clone(r), 3, VIEW); const t = x.panel(); x.clickTab("progress"); return t + "\u0000" + x.panel(); };
      check(`${name}: Today + Progress equal with the flag on and off`, (await run(PACK)) === (await run(PK0)));
    }
    // Flag off: Today, Progress and the ETA numbers byte-identical to the engine before placedKnown.
    if(!PK_CORE) console.log("SKIP  base unavailable");
    else {
      const recs = [["fresh", freshStart()], ["owner k=10", placedOwner()], ["A2-equivalent", placedA2()]].concat(OWNER ? [["owner export", ownerStart()]] : []);
      for(const [name, r] of recs){
        const run = async env => { const x = await bootWith(PK0, clone(r), 3, Object.assign({}, env, VIEW)); const t = x.panel(); x.clickTab("progress"); return [t, x.panel()]; };
        const [t1, p1] = await run({}), [t2, p2] = await run({ core: PK_CORE, html: PK_APP });
        const nums = C => { const cg = C.currentGoal(r, PK0, WORDS, CHARACTERS, PASSAGES); return JSON.stringify([C.goalPositions(r, PK0, WORDS, CHARACTERS, PASSAGES), C.progressPosition(r, PK0, WORDS, CHARACTERS, PASSAGES), [0, 1, 2].map(g => C.sessionsToGoX(r, g, 3, c0)), C.levelOpensIn(WORDS, PK0, r, CHARACTERS), C.levelGateHold(WORDS, PK0, r, CHARACTERS), C.etaPlaced(r, PK0), cg && cg.i]); };
        check(`flag off, ${name}: Today + Progress + ETA equal ${PK_BASE}`, t1 === t2 && p1 === p2 && nums(VC) === nums(PK_CORE));
        check(`flag off, ${name}: applyPlacement output equal ${PK_BASE}`, JSON.stringify(VC.applyPlacement(clone(r), st, k, WORDS, PK0, CHARACTERS)) === JSON.stringify(PK_CORE.applyPlacement(clone(r), st, k, WORDS, PK0, CHARACTERS)));
      }
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
