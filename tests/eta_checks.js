// ETA estimates (docs/PACK_SCHEMA.md "appView" > "ETA model"; owner 2026-10-08): sessions to the next goal and to the
// next level's gate under pack.appView "v2". [1] core: model on a fresh record (no measured pace for goals), levelOpensIn;
// [2] rendering on Today / Progress (owner export, done goal, open gate, two-digit display, 999+ cap); [3] flag-off byte-identical to base;
// [4] the session-1 gate estimate vs the seeded 85% sim. --calibrate prints the calibration sims behind ETA_GAIN / ETA_KNOWN.
// Run: node tests/eta_checks.js [--calibrate] [--sessions N]
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
// ------------------------------------------------------------------ seeded HSK 1-3 record (tests/level_gate_checks.js seedProg, fb38 [6])
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
const SIM = stripFlags(PACK, ["appView"]); // appView is UI only: the planner is the same
const LV = VC.levelIds(PACK), BYLV = VC.wordsByLevel(WORDS, PACK), GOALS = VC.progressMapGoals(PACK);
// Per session: every goal's position and every level's known share (passages counted as in the app; the sim skips reading).
async function trace(start, n, seed, acc, opts){
  const rows = [];
  await playSessions(SIM, start, n, seed, acc, (sn, api) => { const q = api.getProg();
    rows.push({ sn: sn + 1, g: VC.goalPositions(q, PACK, WORDS, CHARACTERS, PASSAGES), k: LV.map(lv => VC.levelKnownPct(WORDS, PACK, q, lv, CHARACTERS)), cg: (VC.currentGoal(q, PACK, WORDS, CHARACTERS, PASSAGES) || {}).i, pm: clone(q.pm || []), gate: VC.levelGateHold(WORDS, PACK, q, CHARACTERS), parts: GOALS.map((_, g) => parts(q, g)) }); }, opts);
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
// ------------------------------------------------------------------ calibration (--calibrate): the numbers behind ETA_GAIN / ETA_KNOWN
const geo = xs => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
async function calibrate(){
  const N = argv.includes("--sessions") ? +argv[argv.indexOf("--sessions") + 1] : 240;
  const SZ = LV.map(lv => BYLV[lv].length), gains = GOALS.map(() => []), known = [], fresh0 = [], measured = [];
  for(const seed of [5, 6, 7]) for(const [name, mk] of [["fresh", freshStart], ["owner", ownerStart]]){
    if(name === "owner" && !OWNER) continue;
    const st0 = mk(); delete st0.pm; const t0 = Date.now(), rows = await trace(st0, N, seed, 0.85, { passages: PASSAGES, patterns: true, read: true });
    const cross = GOALS.map((_, g) => { const r = rows.find(r => r.g[g] >= VC.GOAL_DONE); return r ? r.sn : null; });
    const holds = []; let hold = null;
    rows.forEach(r => { if(r.gate && !hold) hold = { lv: r.gate.lv, prev: r.gate.prev, from: r.sn, k: r.k[LV.indexOf(r.gate.prev)] };
      if(!r.gate && hold){ if(hold.k < PACK.levelGate - 0.01) holds.push(Object.assign(hold, { n: r.sn - hold.from, w: (PACK.levelGate - hold.k) * SZ[LV.indexOf(hold.prev)] / (r.sn - hold.from) })); hold = null; } });
    console.log(`${name} seed ${seed} (${Math.round((Date.now() - t0) / 1000)} s): goals at ${rows[0].g.map(x => x.toFixed(3)).join("/")} reach ${VC.GOAL_DONE} after ${cross.map(c => c == null ? `>${N}` : c).join("/")} sessions; holds ${holds.map(h => `HSK ${h.lv} from ${(h.k * 100).toFixed(1)}% open after ${h.n} (${h.w.toFixed(2)} words/session)`).join(", ")}`);
    // The measured pace at the first 14 pm entries of a goal against the sessions that goal actually still needed.
    cross.forEach((c, g) => { if(c == null) return;
      const r = rows.find(r => r.pm.filter(e => e.g === g).length >= VC.PM_KEEP); if(!r || c < r.sn) return;
      const est = VC.sessionsToGo({ pm: r.pm }, g, GOALS.length), act = c - r.sn;
      measured.push({ name, seed, g, est, act, ok: est !== null && act > 0 && Math.abs(est - act) <= 0.5 * act });
      console.log(`  goal ${g + 1} measured at ${VC.PM_KEEP} entries (session ${r.sn}): ${est === null ? "none (flat)" : "≈ " + est} sessions, actual crossing ${act} more (${est === null ? "-" : Math.round((est / Math.max(1, act) - 1) * 100) + "%"})`); });
    if(name === "owner") cross.forEach((c, g) => { if(c) gains[g].push((VC.GOAL_DONE - rows[0].g[g]) / c); });
    else if(cross[0]) fresh0.push(VC.GOAL_DONE / cross[0]);
    holds.forEach(h => known.push(h.w));
  }
  console.log(`ETA_GAIN (owner export, mean per goal): ${gains.map(x => x.length ? (x.reduce((a, b) => a + b, 0) / x.length).toFixed(5) : "-").join(" ")}; core.js ${VC.ETA_GAIN.join(" ")}`);
  console.log(`goal 1 gain on a fresh record: ${fresh0.map(x => x.toFixed(4)).join(" ")}`);
  const mo = measured.filter(m => m.name === "owner");
  console.log(`measured-at-${VC.PM_KEEP} within +-50% of the actual crossing on the owner-export sims: ${mo.filter(m => m.ok).length} of ${mo.length}${mo.length && mo.every(m => m.ok) ? " PASS (measured may take over at PM_KEEP)" : " FAIL (keep the model only: measured never shown)"}`);
  if(mo.length && !mo.every(m => m.ok)) process.exitCode = 1;
  console.log(`ETA_KNOWN: geometric mean of ${known.length} holds ${geo(known).toFixed(2)} (min ${Math.min(...known).toFixed(2)}, max ${Math.max(...known).toFixed(2)}); core.js ${VC.ETA_KNOWN}`);
}

// ------------------------------------------------------------------ flag-off base (main before fb41)
const BASE = "e165cb1";
const git = f => cp.execSync(`git -C "${ROOT}" show ${BASE}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
let BASE_CORE = null, BASE_APP = null;
try { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eta-")), "core_base.js"); fs.writeFileSync(f, git("engine/core.js")); BASE_CORE = require(f); BASE_APP = git("engine/app.html"); } catch(e){ BASE_CORE = null; }

const ctx = { pack: PACK, words: WORDS, units: CHARACTERS, passages: PASSAGES };
const VIEW = { passages: PASSAGES, patterns: true };
const stripTags = h => h.replace(/<[^>]+>/g, "");
const pvn = (h, head) => { const m = h.match(new RegExp(`<span>${head}</span><span class="pvn">([^<]*)</span>`)); return m ? m[1] : null; };
const SIG2 = n => { const r = n >= 100 ? Math.round(n / 10) * 10 : n; return r > 999 ? "≈\u00a0999+ sessions" : `≈\u00a0${r} session${r === 1 ? "" : "s"}`; };
const pmLine = (n, g, p0, step) => Array.from({ length: n }, (_, i) => ({ sn: 10 + i, p: Math.round((p0 + step * i) * 1000) / 1000, g }));

(async () => {
  if(argv.includes("--calibrate")){ await calibrate(); return; }

  console.log(`\n[1] core: the model from the first session (measured pace never shown for goals), levelOpensIn`);
  {
    check("constants: no PM_MIN, PM_KEEP 14; ETA_GAIN one per zh goal, rising with goal size; ETA_KNOWN 5.2", VC.PM_MIN === undefined && VC.PM_KEEP === 14 && VC.ETA_GAIN.length === GOALS.length && VC.ETA_GAIN.every((x, i) => x > 0 && (!i || x > VC.ETA_GAIN[i - 1])) && VC.ETA_KNOWN === 5.2);
    let p1 = null;
    await playSessions(SIM, freshStart(), 1, 5, 0.85, (sn, api) => { if(sn === 0) p1 = clone(api.getProg()); }, VIEW);
    const cg = VC.currentGoal(p1, PACK, WORDS, CHARACTERS, PASSAGES), m1 = VC.sessionsToGoX(p1, cg.i, cg.n, ctx);
    console.log(`INFO  fresh record after session 1: goal ${cg.i + 1} at ${cg.p.toFixed(3)}, pm ${p1.pm.length} entry, model ${m1} sessions (fresh sims reached goal 1 after 97-190)`);
    check(`fresh record, session 1: a finite model estimate (${m1}) at or above the earliest fresh crossing (97): it shows 2 significant digits`, Number.isFinite(m1) && m1 >= 97 && m1 === Math.ceil((VC.GOAL_DONE - cg.p) / VC.ETA_GAIN[0] - 1e-9));
    check("fresh record, session 0 (no pm): the model too; flag-off sessionsToGo says null", VC.sessionsToGoX(freshStart(), 0, 3, ctx) === Math.ceil(VC.GOAL_DONE / VC.ETA_GAIN[0] - 1e-9) && VC.sessionsToGo(freshStart(), 0, 3) === null);
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
    check(`levelOpensIn: one word short of the gate -> model ${((PACK.levelGate - kNear) * lv2 / VC.ETA_KNOWN).toFixed(2)} < 1 shows 1`, VC.levelOpensIn(WORDS, PACK, near, CHARACTERS) === 1);
    check(`levelOpensIn: 10 of ${lv2} known -> ceil((0.7 - pct) x ${lv2} / 5.2) = ${VC.levelOpensIn(WORDS, PACK, far, CHARACTERS)}`, VC.levelOpensIn(WORDS, PACK, far, CHARACTERS) === Math.ceil((PACK.levelGate - VC.levelKnownPct(WORDS, PACK, far, LV[1], CHARACTERS)) * lv2 / VC.ETA_KNOWN - 1e-9));
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
    globalThis.__ownerOpened = opened;
    globalThis.__ownerGoal = gN;
    check(`owner export goal: model ${gN} is within 15% of the sims' 162-184 sessions and shows "${SIG2(gN)}"`, gN >= 162 * 0.85 && gN <= 184 * 1.15 && SIG2(gN) === `≈\u00a0${Math.round(gN / 10) * 10} sessions`);
    check(`owner export gate: every sim opened it (${opened.join("/")})`, opened.every(x => x != null));
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

  console.log(`\n[5] the session-1 gate estimate vs the seeded 85% sim (tests/level_gate_checks.js [6], fb38: opened after 23)`);
  {
    const LGP = stripFlags(PACK, ["appView", "progressView"]);
    const p0 = seedProg(LGP, 595, 595, 11), est = VC.levelOpensIn(WORDS, LGP, p0, CHARACTERS), pct0 = VC.levelKnownPct(WORDS, LGP, p0, LV[2], CHARACTERS);
    let opened = null;
    // level_gate_checks.js [6] boots without passages or patterns, seed 5
    await playSessions(LGP, p0, 30, 5, 0.85, (sn, api) => { if(opened == null && sn >= 0 && !VC.levelGateHold(WORDS, LGP, api.getProg(), CHARACTERS)) opened = sn + 1; });
    const err = opened ? (est - opened) / opened : null;
    console.log(`INFO  seeded HSK 3 at ${(pct0 * 100).toFixed(1)}%: session-1 estimate ${est}, opened after ${opened}; error ${err == null ? "-" : Math.round(err * 100) + "%"}`);
    check(`seeded sim: the gate opened within 30 sessions (${opened}) and the estimate is finite (${est})`, opened != null && Number.isFinite(est));
    check(`seeded sim: estimate within 50% of the actual (${err == null ? "-" : Math.round(err * 100)}%; the seeded record converts slower than the calibration records)`, err != null && Math.abs(err) <= 0.5);
    if(ownerN != null){
      // fb38's conversion on the seeded record, applied to the owner export, is the slow end of the band; the owner sims' openings the fast end.
      const rate = (PACK.levelGate - pct0) * BYLV[LV[2]].length / opened, slow = Math.ceil((PACK.levelGate - VC.levelKnownPct(WORDS, PACK, ownerStart(), LV[2], CHARACTERS)) * BYLV[LV[2]].length / rate);
      const fast = Math.min(...(globalThis.__ownerOpened || [ownerN]));
      check(`owner export gate estimate ${ownerN} in the band [${fast} owner sims, ${slow} at the seeded record's rate]`, ownerN >= fast && ownerN <= slow);
    }
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
