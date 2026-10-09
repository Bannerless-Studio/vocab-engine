// pack.pairs (docs/PACK_SCHEMA.md "pairs"; owner 2026-10-05: missed characters did not come back enough,
// long-past ones did; "treat every pair equally"): [1] config and validator, [2] kind -> pair table,
// [3] pair streak table (answer x streak x outcome x retry), [4] bootstrapping records without p,
// [5] scheduler order on synthetic records (a miss comes back next session and keeps coming until
// known, refresh share, one pair per item, no pair twice in a session, Listen, characters Test, a unit
// typed as its word), [6] flag-off control: plans and a two-session app walk byte-identical to 3901e2e,
// [7] the app with pairs on the owner export (records gain p only for answered pairs, no same-pair
// repeat in a session, typed items of their planned pair), [8] pairs with script (port E3): Review keeps the
// script units the non-pairs dayPick takes, zh and pairs-off script plans byte-identical to d5952d9. The before/after measurement on the owner
// export (7 days x 3 sessions x 3 seeds) is in the fb23 commit message and docs/PACK_SCHEMA.md "pairs".
// Run: node tests/pairs_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, withCollapsed } = require("./lib/pack_flags.js");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "3901e2e"; // main before pairs
const PY = process.env.PYTHON3 || "python3";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// freqTiers (fb26) layers tier rules on the pair streaks; these checks pin the pairs rule itself, so the
// zh pack runs without it (tests/freq_tiers_checks.js covers the tiers).
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), "34c5df3", { strip: ["progressView"] });
const PACK_OFF = packAsOf(PACK, MAIN);
// Frequency tiers are engine default since the flag collapse (tests/freq_tiers_checks.js covers them): this suite's
// words drop their ft, so every word reads core and the pair checks keep their pre-tier numbers.
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS").map(w => { const c = Object.assign({}, w); delete c.ft; return c; });
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const clone = x => JSON.parse(JSON.stringify(x));
let passes = 0, fails = 0, skips = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); if(extra) console.log("    " + String(extra).replace(/\n/g, "\n    ")); }
}
function skip(name){ skips++; console.log(`SKIP  ${name}`); }
const git = (sha, f) => { try { return cp.execSync(`git -C "${ROOT}" show ${sha}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch(e){ return null; } };
const mainCoreSrc = git(MAIN, "engine/core.js"), mainHtml = git(MAIN, "engine/app.html");
const OLD = mainCoreSrc ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pairs-")), `core_${MAIN}.js`); fs.writeFileSync(f, mainCoreSrc); return require(f); })() : null;

// ------------------------------------------------------------------ fake DOM (copied from words_typed_checks.js)
const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
const scriptOf = html => { const b = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; return b[b.length - 1][1]; };
function extractAttrs(tag){ const attrs = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g; let m; while((m = re.exec(tag))){ if(m[1]) attrs[m[1]] = m[2] !== undefined ? m[2] : ""; } return attrs; }
function makeFakeDom(){
  const registry = new Map(); const tabButtons = [];
  class El {
    constructor(tag, attrs){ this.tagName = (tag||"div").toUpperCase(); this._attrs = Object.assign({}, attrs); this._classes = new Set((this._attrs.class||"").split(/\s+/).filter(Boolean));
      this._html = ""; this._text = ""; this.style = { setProperty(k,v){ this[k]=v; } }; this.hidden = false; this.disabled = false; this.value = "";
      this.onclick = null; this.oninput = null; this.onchange = null; this._listeners = {}; this._children = []; if(this._attrs.id) registry.set(this._attrs.id, this); }
    get id(){ return this._attrs.id || ""; } set id(v){ this._attrs.id = v; registry.set(v, this); }
    get classList(){ const s = this._classes; return { add:(...c)=>c.forEach(x=>s.add(x)), remove:(...c)=>c.forEach(x=>s.delete(x)), toggle:(c,f)=>{ if(f===undefined){ s.has(c)?s.delete(c):s.add(c); } else { f?s.add(c):s.delete(c); } }, contains:c=>s.has(c) }; }
    get dataset(){ const attrs = this._attrs; const toKebab = k => k.replace(/[A-Z]/g, m => "-" + m.toLowerCase()); return new Proxy({}, { get(_, k){ return attrs["data-" + toKebab(String(k))]; }, set(_, k, v){ attrs["data-" + toKebab(String(k))] = String(v); return true; } }); }
    get children(){ return this._children; } get innerHTML(){ return this._html; } set innerHTML(h){ this._html = h; this._children = []; registerIdsFromHtml(h); }
    get textContent(){ return this._text; } set textContent(t){ this._text = String(t); this._html = String(t); }
    setAttribute(k,v){ this._attrs[k]=String(v); if(k==="id") registry.set(v,this); } getAttribute(k){ return this._attrs[k]; }
    addEventListener(t,f){ (this._listeners[t]=this._listeners[t]||[]).push(f); } removeEventListener(){}
    appendChild(c){ this._children.push(c); return c; } insertBefore(c){ this._children.unshift(c); return c; } get firstChild(){ return this._children[0] || null; }
    remove(){} focus(){} click(){ if(this.onclick) this.onclick({}); (this._listeners.click||[]).forEach(f=>f({})); } closest(){ return null; } querySelector(){ return null; } querySelectorAll(){ return []; }
  }
  function registerIdsFromHtml(html){ const re = /<([a-zA-Z0-9]+)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g; let m; while((m = re.exec(html))){ const attrs = extractAttrs(m[2]); if(attrs.id) new El(m[1], attrs); } }
  const tabsMatch = appHtml.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/); const btnRe = /<button([^>]*)>/g;
  let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
  registerIdsFromHtml(appHtml.slice(appHtml.indexOf("<body>"), appHtml.indexOf("<nav")));
  return { title: "", head: { appended: [], appendChild(c){ this.appended.push(c); return c; } }, body: new El("body", {}), documentElement: new El("html", {}),
    write(){}, createElement(tag){ return new El(tag, {}); }, getElementById(id){ return registry.get(id) || null; },
    querySelector(sel){ return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel){ const m = sel.match(/^#tabs\s+button(?:\[data-t="([^"]+)"\])?$/); if(m) return m[1] ? tabButtons.filter(b=>b.dataset.t===m[1]) : tabButtons.slice(); return []; },
    _listeners: {}, addEventListener(t,f){ (this._listeners[t]=this._listeners[t]||[]).push(f); } };
}
const tick = () => new Promise(r => setTimeout(r, 0));
function mulberry32(seed){ let a = seed >>> 0; return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function memStore(){ const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()] }; }
let NOW = new Date(2026, 9, 4, 8, 0, 0).getTime();
class FakeDate extends Date { constructor(...a){ if(a.length) super(...a); else super(NOW); } static now(){ return NOW; } }
async function boot(pack, prog, seed, opts){
  const o = opts || {};
  Math.random = mulberry32(seed);
  const st = o.st || { ls: memStore(), ss: memStore() }; if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog));
  const document = makeFakeDom();
  const ss = { getVoices: () => [{ lang:"zh-CN", name:"x" }], onvoiceschanged: null, cancel(){}, speak(){} };
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf(o.html || appHtml) + `
let __cur = null; const __log = [];
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; __log.push({ key: it.key, kind: "mc", label: it.label, step: todayStepState && todayStepState.at }); return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; __log.push({ key: it.key, kind: "type", label: it.label, step: todayStepState && todayStepState.at }); return __ty(it); };
return { el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML, getProg: () => prog, getD: () => D, getCur: () => __cur, log: __log,
  rd: () => (typeof RD !== "undefined" ? RD : null), skipRead: () => { RD = null; todayStep(); },
  tss: () => todayStepState, itemFromPlan: (p, i, plan) => itemFromPlan(p, i, plan), planItem: (p, i, plan) => planItem(p, i, plan), unitTypedFor: id => TYPED_UNITS && TYPED_UNITS.get(id) };`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"PairsChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, [], CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  api.st = st;
  return api;
}
function typedRight(it){
  const w = BY_ID[String(it.key).slice(2)];
  if(typeof it.check === "function" && w){
    const cands = [w.w, w.pron, VC.gloss(w), ...(w.alt || []), ...String(VC.gloss(w)).split(/[;,/]| or /).map(s => s.trim())].filter(Boolean);
    for(const c of cands){ try { if(it.check(c)) return c; } catch(e){} }
  }
  return w ? w.w : "";
}
function answer(api, right){
  const it = api.getCur();
  if(it.kind === "type"){ api.el("tin").value = right ? typedRight(it) : "zzz not it"; api.el("submit").click(); return; }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}
// One Today session; okFn(item, rec before) decides each answer. Returns per-item rows.
// o.cont: carry on a resumed session (no Go); o.stop(rows, item): leave before answering item.
async function session(api, okFn, o){
  const rows = [], x = o || {};
  if(!x.cont) api.el("go").click();
  for(let guard = 0; guard < 600; guard++){
    const h = api.panel(), D = api.getD();
    if(D && D.cur){ const it = api.getCur(), key = String(it.key); const p = api.getProg();
      if(x.stop && x.stop(rows, it)) break;
      const rec = key[0] === "w" ? p.w[key.slice(2)] : null; const s0 = rec ? rec.s || 0 : null; const r0 = rec ? rec.r : null;
      const lg = api.log[api.log.length - 1]; const ok = okFn(it, rec, rows, lg.step);
      answer(api, ok); const r1 = key[0] === "w" ? api.getProg().w[key.slice(2)] : null;
      rows.push({ key, kind: it.kind, label: it.label, step: lg.step, ok, s0, s1: r1 ? r1.s : null, r0, r1: r1 ? r1.r : null });
      api.el("nx").click(); continue; }
    if(api.rd()){ api.skipRead(); continue; }
    if(/id="again"/.test(h)) break;
    if(/id="ok"/.test(h)){ api.el("ok").click(); continue; }
    if(/id="dr"/.test(h)){ api.el("dr").click(); continue; }
    break;
  }
  return rows;
}
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));

// One Today session that also records, per answer, the pairs noted (core notePair via a wrapped core)
// and whether the answer is the in-drill retry of an item missed earlier in the same drill.
async function sessionP(api, okFn, notes){
  const rows = []; let lastD = null, drill = 0;
  api.el("go").click();
  for(let guard = 0; guard < 800; guard++){
    const h = api.panel(), D = api.getD();
    if(D && D.cur){ if(D !== lastD){ lastD = D; drill++; }
      const it = api.getCur(), key = String(it.key), lg = api.log[api.log.length - 1];
      const retry = rows.some(r => r.drill === drill && r.key === key && !r.ok);
      const ok = okFn(it, rows); const n0 = notes.length;
      answer(api, ok);
      rows.push({ key, kind: it.kind, label: it.label, step: lg.step, drill, ok, retry, pairs: notes.slice(n0) });
      api.el("nx").click(); continue; }
    if(api.rd()){ api.skipRead(); continue; }
    if(/id="again"/.test(h)) break;
    if(/id="ok"/.test(h)){ api.el("ok").click(); continue; }
    if(/id="dr"/.test(h)){ api.el("dr").click(); continue; }
    break;
  }
  return rows;
}
const coreWith = notes => Object.assign({}, VC, { notePair(rec, pair, ok, prod, sn, s0, held){ notes.push({ pair, ok, prod, sn }); return VC.notePair(rec, pair, ok, prod, sn, s0, held); } });
// The owner's export (private, never committed): $PAIRS_OWNER, else the 2026-10-04 upload, else the copy
// in ../chinese/.cache; without one the app sections run on a synthetic record.
const OWNER = (() => { for(const f of [process.env.PAIRS_OWNER, "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json", path.join(ROOT, "..", "chinese", ".cache", "owner-progress.json")]) if(f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); return null; })();
const sigPlan = pl => pl.map(x => [x.kind, x.word ? "w" + x.word.id : "", x.unit ? "u" + x.unit.id : "", x.tu || x.tuUnit && x.tuUnit.id || "", x.reqKind || ""].join(":")).join(",");
// Synthetic progress: the first n words learned at streak s, every pair answered at session a (p).
function synth(n, s, a, sn){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 10 }, PACK);
  p.sets = { "1": NS("1"), "2": 0, "3": 0, "4": 0 }; p.sn = sn;
  byLv["1"].slice(0, n).forEach(w => { p.w[w.id] = { r: s + 1, w: 0, s, u: a, p: { wm: [s, a], sm: [s, a] } }; });
  return p;
}
const lwOf = p => VC.learnedWords(WORDS, PACK, p);
const TODAY = "2026-10-05";
const planOpts = (rng, extra) => Object.assign({ canHear: () => true, today: TODAY, rng: mulberry32(rng), typedKindFits: (w, k) => VC.typedKindOk(k, w, false) }, extra || {});
const pairOfItem = it => it.word ? (it.kind === "type" ? it.pair : VC.PAIR_OF_KIND[it.kind]) : VC.PAIR_OF_KIND[it.kind];

(async () => {
  console.log("[1] config: pack.pairs on zh, needs dayAware; validator");
  check("pairs are engine default (flag collapse): zh carries no pairs / dayAware key", !("pairs" in PACK) && !("dayAware" in PACK));
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pairs-val-"));
    const run = pk => { const d = path.join(tmp, String(Math.random()).slice(2)); fs.mkdirSync(d); for(const f of fs.readdirSync(ZH)) if(f.endsWith(".json")) fs.copyFileSync(path.join(ZH, f), path.join(d, f));
      const pj = JSON.parse(fs.readFileSync(path.join(d, "pack.json"), "utf8")); pk(pj); fs.writeFileSync(path.join(d, "pack.json"), JSON.stringify(pj));
      cp.execSync(`${PY} "${path.join(ROOT, "tools", "jsonify_pack.py")}" "${d}"`, { stdio: "ignore" });
      try { cp.execSync(`${PY} "${path.join(ROOT, "tools", "validate_pack.py")}" "${d}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return ""; } catch(e){ return String(e.stdout || "") + String(e.stderr || ""); } };
    check("validate_pack: zh as shipped passes", run(() => {}) === "");
    // Port E3: pairs with a script primer is valid (a real script pack, ../russian, with the flags on).
    const ruPack = path.join(ROOT, "..", "russian", "pack");
    if(fs.existsSync(path.join(ruPack, "script.json"))){
      const d = path.join(tmp, "ru"); fs.mkdirSync(d); for(const f of fs.readdirSync(ruPack)) if(f.endsWith(".json")) fs.copyFileSync(path.join(ruPack, f), path.join(d, f));
      const pj = JSON.parse(fs.readFileSync(path.join(d, "pack.json"), "utf8")); Object.assign(pj, { dayAware: true, pairs: true }); fs.writeFileSync(path.join(d, "pack.json"), JSON.stringify(pj));
      cp.execSync(`${PY} "${path.join(ROOT, "tools", "jsonify_pack.py")}" "${d}"`, { stdio: "ignore" });
      let out = "", code = 0; try { out = cp.execSync(`${PY} "${path.join(ROOT, "tools", "validate_pack.py")}" "${d}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch(e){ code = e.status; out = String(e.stdout || "") + String(e.stderr || ""); }
      check(`validate_pack: pairs with script is valid (../russian/pack + dayAware + pairs: exit ${code}, ${(out.match(/(\d+) errors/) || [])[1]} errors)`, code === 0 && !/pack\.pairs/.test(out) && / 0 errors/.test(out));
    } else skip("validate_pack pairs + script: ../russian/pack absent");
  }

  console.log("\n[2] kind -> pair table");
  const KT = { read: "wm W->M choice", recall: "wm M->W choice (hard)", hear: "sm S->M choice (hard)", gap: "wm M->W cloze (miss only)", gapType: "wm M->W cloze (miss only)",
    charRead: "wm W->M choice", charRecall: "wm M->W choice (hard)", charSound: "ws W->S choice", charPick: "ws S->W choice (hard)",
    "type:written": "wm M->W typed", "type:writtenMeaning": "wm W->M typed", "type:pron": "sm M->S typed", "type:pronMeaning": "sm S->M typed", "type:writtenPron": "ws W->S typed" };
  const got = k => k.startsWith("type:") ? VC.PAIR_OF_TYPED[k.slice(5)] : VC.PAIR_OF_KIND[k];
  Object.keys(KT).forEach(k => console.log(`    ${k.padEnd(20)} ${KT[k]}`));
  check("every drill kind maps to the pair in the table", Object.keys(KT).every(k => got(k) === KT[k].slice(0, 2)));
  check("hard choice kinds: recall, hear, charRecall, charPick", JSON.stringify(VC.PAIR_HARD.slice().sort()) === JSON.stringify(["charPick", "charRecall", "hear", "recall"]));
  check("typed kinds of each pair on zh: wm written/writtenMeaning, sm pron/pronMeaning, ws writtenPron",
    JSON.stringify(VC.pairTypedKinds(PACK, "wm")) === JSON.stringify(["writtenMeaning", "written"]) && JSON.stringify(VC.pairTypedKinds(PACK, "sm")) === JSON.stringify(["pron", "pronMeaning"]) && JSON.stringify(VC.pairTypedKinds(PACK, "ws")) === JSON.stringify(["writtenPron"]));

  console.log("\n[3] pair streak table (answer x pair streak x outcome x first ask / again this session)");
  {
    const want = (s, ok, prod, again) => !ok ? 0 : again ? s : prod || s < VC.PAIR_HOLD ? s + 1 : s;
    let n = 0; const bad = [];
    for(const [kind, prod] of [["read", false], ["recall", false], ["recall (no typed form)", true], ["type", true]]) for(let s = 0; s <= 4; s++) for(const ok of [true, false]) for(const again of [false, true]){
      const rec = { r: 1, w: 0, s: 1, p: { wm: [s, again ? 7 : 6] } };
      VC.notePair(rec, "wm", ok, prod, 7, 1); n++;
      const w = want(s, ok, prod, again);
      if(rec.p.wm[0] !== w || rec.p.wm[1] !== 7 || rec.s !== 1) bad.push(`${kind} s${s} ${ok} again=${again}: ${JSON.stringify(rec.p.wm)} want ${w}`);
    }
    check(`${n} cases: a miss -> 0; a right first ask +1 (choice only below PAIR_HOLD ${VC.PAIR_HOLD}); the retry in the same session adds nothing; a = the session; the record's s untouched`, bad.length === 0, bad.slice(0, 5).join("\n"));
    const rows = [["choice", 0, 1], ["choice", 1, 2], ["choice", 2, 2], ["production", 2, 3], ["production", 3, 4]];
    check("2 -> 3 (PAIR_KNOWN) only by a production answer", rows.every(([k, s, w]) => { const r = { p: { sm: [s, 1] } }; VC.notePair(r, "sm", true, k === "production", 2); return r.p.sm[0] === w; }));
    const r2 = { r: 3, w: 0, s: 3, u: 4 }; VC.notePair(r2, "ws", true, false, 9, 3);
    check("a pair never answered starts from the record's streak (3 -> pair 3) and only it is written", JSON.stringify(r2.p) === JSON.stringify({ ws: [3, 9] }));
    const r3 = { r: 1, w: 0, s: 1 }; check("a record with no session clock (sn 0) still moves", VC.notePair(r3, "wm", true, false, 0, 1) && JSON.stringify(r3.p) === JSON.stringify({ wm: [2, 0] }));
    check("an unknown pair or a non-record is refused", !VC.notePair({}, "xx", true, true, 1) && !VC.notePair(null, "wm", true, true, 1));
  }

  console.log("\n[4] bootstrapping records without p (the owner's learned words)");
  {
    const held = VC.pairUnitHeld(PACK);
    const words = [0, 1, 2, 3, 4, 5, 9].map(s => VC.pairBoot(s)), units = [0, 1, 2, 3, 4, 5, 9].map(s => VC.pairBoot(s, held));
    console.log(`    word streak 0 1 2 3 4 5 9 -> pairs ${words.join(" ")}; unit streak (bare ${PACK.characters.bare}) -> ${units.join(" ")}`);
    check("words: min(s, 2) below 3, known (3) from WORD_MASTERED", JSON.stringify(words) === JSON.stringify([0, 1, 2, 3, 3, 3, 3]));
    check(`units: as words, but one answer short of bare (${held}) starts at PAIR_HOLD`, held === PACK.characters.bare - 1 && JSON.stringify(units) === JSON.stringify([0, 1, 2, 3, 2, 3, 3]));
    const st = VC.pairState({ r: 4, w: 0, s: 2, u: 11 }, "sm"), st2 = VC.pairState({ r: 4, w: 0, s: 2 }, "sm");
    check("a = the record's u, else 0; boot marks the derived state", st.s === 2 && st.a === 11 && st.boot && st2.a === 0);
    check("a stored pair wins; a malformed one is ignored (derived instead)", VC.pairState({ s: 4, p: { sm: [1, 3] } }, "sm").s === 1 && VC.pairState({ s: 4, u: 2, p: { sm: ["1", 3] } }, "sm").s === 3 && VC.pairState({ s: 4, p: "x" }, "wm").boot);
  }

  console.log("\n[5] scheduler order (synthetic records)");
  {
    // 40 HSK 1 words; pairs at 2, asked in session 4; one word's wm missed in session 5.
    const mk = () => { const p = synth(40, 2, 4, 6); return p; };
    const ids = byLv["1"].slice(0, 40).map(w => w.id), X = ids[7], Y = ids[8];
    let p = mk(); p.w[X].p.wm = [0, 5];
    const plan = VC.buildReviewPlan(lwOf(p), p, PACK, Object.assign(planOpts(1), { size: 10 }));
    const x = plan.find(it => it.word && it.word.id === X);
    check(`a pair missed in session 5 is asked in session 6, first, in its pair (${x && x.kind}/${x && x.pair})`, !!x && x.pair === "wm" && ["type", "recall"].includes(x.kind));
    check("in the session it was missed it is not asked again", !VC.buildReviewPlan(lwOf(p), p, PACK, Object.assign(planOpts(1), { size: 10, sn: 5 })).some(it => it.word && it.word.id === X && it.pair === "wm"));
    // Keeps coming while below PAIR_KNOWN: answer every planned item right, session after session.
    p = mk(); p.w[X].p.wm = [0, 5]; const seen = [];
    for(let sn = 6; sn <= 16; sn++){
      p.sn = sn; const pl = VC.buildReviewPlan(lwOf(p), p, PACK, Object.assign(planOpts(sn), { size: 10, typedKindFits: () => true }));
      const it = pl.find(q => q.word && q.word.id === X && q.pair === "wm"); seen.push(it ? `${it.kind}:${p.w[X].p.wm[0]}` : "-");
      pl.forEach(q => { const pr = q.pair; VC.notePair(p.w[q.word.id], pr, true, q.kind === "type" || VC.PAIR_HARD.includes(q.kind), sn, p.w[q.word.id].s); p.w[q.word.id].u = sn; });
    }
    console.log(`    missed wm pair of ${X}, sessions 6..16: ${seen.join(" ")}`);
    check("the missed pair comes back in the next two sessions (0 -> 1 -> 2), lowest first; at 2 it takes its turn by age with the other pairs at 2 and reaches known", seen[0] !== "-" && seen[1] !== "-" && p.w[X].p.wm[0] >= VC.PAIR_KNOWN);
    check("at 0 (no missed kind logged) and from 1 up the production direction, typed when a typed kind fits, never an easier kind", seen[0] === "type:0" && seen[1] === "type:1" && seen.filter(v => v !== "-").slice(2).every(v => v === "type:2"));
    // A miss whose in-drill retry cleared the day log's mk still comes back in the hard direction.
    const hardOk = k => k === "type" || VC.PAIR_HARD.includes(k);
    const unitPo = { typed: [], choice: ["charRead", "charRecall", "charPick"] }, wordPo = { typed: ["type"], choice: ["read", "recall"] };
    check("a unit pair at 0 with its missed kind cleared is asked charRecall or charPick, never charRead", hardOk(VC.pairKind(unitPo, 0, [])) && hardOk(VC.pairKind(unitPo, 0, undefined)) && VC.pairKind(unitPo, 0, ["charRecall"]) === "charRecall");
    check("a word pair at 0 with its missed kind cleared is asked type or recall, never read", hardOk(VC.pairKind(wordPo, 0, [])) && VC.pairKind({ typed: [], choice: ["read", "recall"] }, 0, []) === "recall");
    p = mk(); p.w[X].p.wm = [1, 5]; p.sn = 6;
    const nt = VC.buildReviewPlan(lwOf(p), p, PACK, Object.assign(planOpts(6), { size: 10 })).find(q => q.word && q.word.id === X);
    check(`no typed kind fits the pair (characters hidden): its harder choice is the production ask (${nt && nt.kind})`, !!nt && nt.kind === "recall");
    // Refresh share.
    const q = synth(40, 2, 4, 9); ids.slice(20).forEach((id, i) => { q.w[id].s = 4; q.w[id].p = { wm: [3, 1 + (i % 5)], sm: [3, 1 + (i % 5)] }; });
    const rp = VC.buildReviewPlan(lwOf(q), q, PACK, Object.assign(planOpts(3), { size: 20 }));
    const known = rp.filter(it => q.w[it.word.id].p[it.pair] && q.w[it.word.id].p[it.pair][0] >= VC.PAIR_KNOWN);
    check(`refresh share: ${known.length} of 20 known pairs (ceil(20 x ${VC.PAIR_REFRESH})), oldest first (a = ${known.map(it => q.w[it.word.id].p[it.pair][1]).join(",")}), asked in the production direction`,
      known.length === Math.ceil(20 * VC.PAIR_REFRESH) && known.every(it => q.w[it.word.id].p[it.pair][1] === 1) && known.every(it => it.kind === "type" || VC.PAIR_HARD.includes(it.kind)));
    const lowFirst = rp.filter(it => !known.includes(it));
    check("the rest lowest pair streak first: all 18 from the pairs at 2, none known", lowFirst.length === 18 && lowFirst.every(it => q.w[it.word.id].p[it.pair][0] === 2));
    // One pair per item per plan; no pair twice in a session across Review and Recall.
    const r = synth(40, 1, 4, 6); const rev = VC.buildReviewPlan(lwOf(r), r, PACK, Object.assign(planOpts(5), { size: 20 }));
    check("one item per plan (no word twice)", new Set(rev.map(it => it.word.id)).size === rev.length);
    rev.forEach(it => VC.notePair(r.w[it.word.id], it.pair, true, false, 6, 1));
    const rec = VC.buildRecallPlan(lwOf(r), r, PACK, 12, planOpts(6));
    const again = rec.filter(it => (r.w[it.word.id].p[it.pair] || [])[1] === 6);
    check(`Recall in the same session asks no pair Review asked (${again.length} of ${rec.length})`, again.length === 0 && rec.length === 12);
    check("Recall asks production kinds only (recall, type)", rec.every(it => it.kind === "recall" || it.kind === "type"));
    // Listen and the characters Test.
    const L = synth(30, 3, 4, 8); ids.slice(0, 5).forEach(id => { L.w[id].p.sm = [1, 7]; });
    const li = VC.dayPickList(lwOf(L), 10, L, PACK, TODAY, "w:", ["hear"], mulberry32(1));
    check("Listen picks the weakest sound <-> meaning pairs first, then a refresh share", li.length === 10 && ids.slice(0, 5).every(id => li.slice(0, 9).some(w => w.id === id)));
    const C = synth(20, 4, 4, 8); C.chars.c = {}; const units = CHARACTERS.filter(u => C.w[u.words[0]]).slice(0, 12);
    units.forEach((u, i) => { C.chars.c[u.id] = { r: 5, w: 0, s: 5, u: 4, p: { wm: [3, 4], ws: [i < 3 ? 0 : 3, 4] } }; });
    const ct = VC.charTestPlan(CHARACTERS, lwOf(C), C, PACK, 10, mulberry32(2), TODAY);
    check(`characters Test: the 3 units with ws at 0 first, asked in the ws production kind (${ct.slice(0, 3).map(x => x.kind).join(",")})`, ct.length === 10 && ct.slice(0, 3).every(x => units.slice(0, 3).includes(x.unit) && VC.PAIR_HARD.includes(x.kind)));
    // A unit one answer short of bare is asked typed as its word; its word is not asked as well.
    const T = synth(20, 4, 4, 8); T.chars.c = {}; const tu = CHARACTERS.filter(u => T.w[u.words[0]]).slice(0, 8);
    tu.forEach(u => { T.chars.c[u.id] = { r: 5, w: 0, s: 4, u: 2 }; });
    const TU = VC.typedUnitWords(CHARACTERS, WORDS, PACK);
    const tp = VC.buildReviewPlan(lwOf(T), T, PACK, Object.assign(planOpts(4), { size: 20, units: CHARACTERS, typedUnits: TU, typedKindFits: (w, k) => VC.typedKindOk(k, w, true) }));
    const typedU = tp.filter(it => it.tu);
    check(`units held one short of bare are asked typed as their word (${typedU.length} of ${tu.filter(u => TU.has(u.id)).length}), each word once`, typedU.length > 0 && typedU.every(it => it.kind === "type" && it.word === TU.get(it.tu) && VC.TYPED_WRITTEN_KINDS.length) && new Set(tp.filter(it => it.word).map(it => it.word.id)).size === tp.filter(it => it.word).length);
    const T2 = JSON.parse(JSON.stringify(T)); typedU.forEach(it => { T2.w[it.word.id].p = Object.assign({}, T2.w[it.word.id].p, { [it.pair]: [3, 8] }); });
    const tp2 = VC.buildReviewPlan(lwOf(T2), T2, PACK, Object.assign(planOpts(4), { size: 20, units: CHARACTERS, typedUnits: TU, typedKindFits: (w, k) => VC.typedKindOk(k, w, true) }));
    check("a unit is not typed as its word when that word's pair was answered this session", !tp2.some(it => it.tu && typedU.some(u => u.tu === it.tu && u.pair === it.pair)));
    check("typedSeen: a word typed this Today session gets no typed ask", !VC.buildReviewPlan(lwOf(r), r, PACK, Object.assign(planOpts(5), { size: 20, sn: 7, typedSeen: () => true })).some(it => it.kind === "type"));
    { // fb25: owner 2026-10-06, a paused session's Review stays at 20 under pairs (engine default since the flag collapse)
      const big = synth(220, 2, 4, 6), po = x => Object.assign(planOpts(3), { size: 20, units: CHARACTERS, sn: 7 }, x);
      const on = VC.buildReviewPlan(lwOf(big), JSON.parse(JSON.stringify(big)), PACK, po({ extra: 20 }));
      check(`pairs: a paused Review (extra 20) stays at 20 items (${on.length})`, on.length === 20);
    }
  }

  // [6] (flag-off control vs main) deleted: pairs is engine default since the flag collapse.

  console.log("\n[7] app on zh with pairs: three Today sessions on " + (OWNER ? "the owner export" : "a synthetic record"));
  {
    NOW = new Date(2026, 9, 5, 8, 0, 0).getTime();
    const notes = [], p0 = OWNER ? JSON.parse(JSON.stringify(OWNER)) : synth(40, 2, 4, 6);
    const api = await boot(PACK, p0, 5, { core: coreWith(notes) });
    check("Today's Review and Recall lines say \"weakest pairs first\"; Sentences keeps its order", /items, weakest pairs first/.test(api.panel()) && /Recall<\/td><td>\d+ items, weakest pairs first/.test(api.panel()) && /Sentences<\/td><td>8 items, misses and due first/.test(api.panel()));
    const ans = mulberry32(9); const all = [];
    for(const h of [8, 13, 20]){ NOW = new Date(2026, 9, 5, h, 0, 0).getTime(); const sn = (api.getProg().sn || 0) + 1; (await sessionP(api, () => ans() < 0.85, notes)).forEach(r => all.push(Object.assign(r, { sn }))); }
    const p = api.getProg();
    const answered = all.filter(r => r.pairs.length);
    check(`every word and unit answer notes its pair (${answered.length} of ${all.filter(r => !r.key.startsWith("s:")).length} word/unit answers; cloze misses too)`, all.filter(r => !r.key.startsWith("s:")).every(r => r.pairs.length >= 1));
    const recs = [...Object.values(p.w), ...Object.values(p.chars.c)].filter(r => r.p);
    check(`records gain p only for answered pairs, each [s, session] (${recs.length} records)`, recs.length > 0 && recs.every(r => Object.keys(r.p).every(k => VC.PAIRS.includes(k) && Array.isArray(r.p[k]) && r.p[k].length === 2 && Number.isInteger(r.p[k][0]) && r.p[k][1] >= 1)));
    // A cloze miss notes the blanked word's pair, so such a word gains p (one entry per cloze answer at most) and nothing else; every other unanswered word is byte-identical.
    const untouched = Object.keys(p0.w).filter(id => !all.some(r => r.key === "w:" + id));
    const gained = untouched.filter(id => JSON.stringify(p.w[id]) !== JSON.stringify(p0.w[id]));
    check(`an unanswered word keeps its record byte-identical, but for the pair a cloze miss noted (${gained.length} gained p, ${all.filter(r => r.key.startsWith("s:") && r.pairs.length).length} cloze answers noted a pair)`, untouched.length > 0 && gained.length <= all.filter(r => r.key.startsWith("s:") && r.pairs.length).length && gained.every(id => JSON.stringify(Object.assign({}, p.w[id], { p: p0.w[id].p })) === JSON.stringify(p0.w[id])));
    // Same (item, pair) twice in one session, the in-drill retry excepted.
    const seen = new Map(); let rep = 0; const repl = [];
    all.filter(r => !r.retry && !r.key.startsWith("s:")).forEach(r => r.pairs.forEach(x => { const k = `${r.sn}|${r.key}|${x.pair}|${x === r.pairs[0] ? "" : "unit"}`; if(seen.has(k)){ rep++; repl.push(k + " " + seen.get(k) + " / " + r.label); } else seen.set(k, r.label); }));
    check(`no item asked twice in one pair in a session, in-drill retries aside (${rep})`, rep === 0, repl.slice(0, 5).join("\n"));
    const typed = all.filter(r => r.kind === "type" && !r.retry);
    check(`typed asks: at most one per word per Today session (${typed.length} typed)`, (() => { const m = new Set(); return typed.every(r => { const k = r.sn + r.key; if(m.has(k)) return false; m.add(k); return true; }); })());
    const missN = all.filter(r => !r.ok && !r.retry && r.key.startsWith("c:"));
    console.log(`    ${all.length} answers in 3 sessions; unit misses ${missN.length}`);
    // A plan's typed item asks a typed kind of its planned pair.
    const w = WORDS.find(x => p.w[x.id] && p.w[x.id].s >= 2 && x.pron && !x.pronInGloss);
    const sm = api.itemFromPlan({ kind: "type", word: w, pair: "sm" }, 0, [{ kind: "type", word: w, pair: "sm" }]);
    check(`a typed item planned in sound <-> meaning asks the pinyin or the meaning from the pinyin (${sm.label})`, /pinyin|meaning/.test(sm.label) && sm.rz && (sm.rz.b === "typePron" || (sm.rz.b === "typeMeaning" && sm.rz.a[1] === true)));
    const uw = CHARACTERS.find(u => p.chars.c[u.id] && api.unitTypedFor(u.id));
    if(uw){ const ww = api.unitTypedFor(uw.id); const ws = api.itemFromPlan({ kind: "type", word: ww, tu: uw.id, pair: "ws" }, 0, [{ kind: "type", word: ww, tu: uw.id, pair: "ws" }]);
      check(`a unit typed as its word in written <-> sound asks the pinyin from the characters (${ws.rz && ws.rz.b})`, !!ws.rz && (ws.rz.b === "typeWrittenPron" || ws.rz.b === "recall")); }
    else skip("no typed unit in this record");
  }

  console.log("\n[8] pairs with script (port E3): Review keeps the script units dayPick gives it without pairs");
  {
    const FX = require("./fixtures/script_packs.js");
    const E3 = "d5952d9"; // main before pairs + script
    const e3Src = git(E3, "engine/core.js");
    const OLD3 = e3Src ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pairs-e3-")), `core_${E3}.js`); fs.writeFileSync(f, e3Src); return require(f); })() : null;
    const sib = lang => { const d = path.join(ROOT, "..", lang, "pack"), f = n => path.join(d, n + ".js");
      if(![f("pack"), f("words"), f("script")].every(x => fs.existsSync(x))) return null;
      return { pack: loadConst(f("pack"), "PACK"), words: loadConst(f("words"), "WORDS"), script: loadConst(f("script"), "SCRIPT"), lang }; };
    const on = pk => Object.assign({}, pk, { dayAware: true, pairs: true });
    const offPairs = pk => { const p = Object.assign({}, pk); delete p.pairs; return p; };
    // A seeded record: every script unit recorded (streak 0-4, last answered in an earlier session), the
    // first nw words learned likewise, sn 10; one script unit and one word with a pending miss from this session.
    const seedRec = (fx, seed, nw) => {
      const r = mulberry32(seed), pk = on(fx.pack), sn = 10, p = VC.defaultProg(pk);
      p.script.skipped = false; p.script.choiceSeen = true; p.sn = sn;
      const rec = () => { const s = Math.floor(r() * 5); return { r: s + 1, w: Math.floor(r() * 2), s, u: 1 + Math.floor(r() * (sn - 1)), t: 20000 }; };
      fx.script.units.forEach(u => { p.script.u[u.id] = rec(); });
      const learned = fx.words.slice(0, nw); learned.forEach(w => { p.w[w.id] = rec(); });
      const mu = fx.script.units[Math.floor(r() * fx.script.units.length)];
      const kind = VC.scriptConfig(pk).reviewKinds.find(k => VC.scriptKindFits(k, mu, { units: fx.script.units, words: fx.words, tts: VC.scriptConfig(pk).tts }));
      p.day = { d: TODAY, n: 1, a: { ["x:" + mu.id]: { m: 1, mk: [kind], ms: sn } } };
      if(learned.length) p.day.a["w:" + learned[0].id] = { m: 1, mk: ["recall"], ms: sn };
      return { fx, pk, p, learned, mu };
    };
    const RU = sib("russian"), JA = sib("japanese");
    const recs = [seedRec(FX.ko(), 11, 20), RU ? seedRec(RU, 12, 120) : null, JA ? seedRec(JA, 13, 150) : seedRec(FX.ja(), 13, 20)].filter(Boolean);
    if(!RU) skip("../russian/pack absent: the real-pack record is ja (or fixtures only)");
    const opts = (x, seed, extra) => Object.assign(planOpts(seed), { script: x.fx.script.units, scriptCtx: { words: x.fx.words, tts: VC.scriptConfig(x.pk).tts } }, extra || {});
    const xs = plan => plan.filter(it => it.unit && VC.SCRIPT_KINDS.includes(it.kind));
    const ids = plan => xs(plan).map(it => it.unit.id).sort().join(",");
    for(const x of recs){
      const name = x.fx.lang || x.pk.key, units = x.fx.script.units, kctx = { units, words: x.fx.words, tts: VC.scriptConfig(x.pk).tts };
      check(`${name}: script primer configured (scriptConfig)`, !!VC.scriptConfig(x.pk));
      let same = 0, shares = [], fit = true, noPair = true, wordsPaired = true, miss = 0, full = 0;
      for(const seed of [1, 2, 3]){
        const n = 20;
        const pon = VC.buildReviewPlan(x.learned, x.p, x.pk, opts(x, seed, { size: n }));
        const poff = VC.buildReviewPlan(x.learned, x.p, offPairs(x.pk), opts(x, seed, { size: n }));
        if(ids(pon) === ids(poff)) same++;
        const k = xs(pon).length; shares.push(`${k}/${n}`);
        if(pon.length === n) full++;
        if(!xs(pon).every(it => x.pk.script.reviewKinds.includes(it.kind) && VC.scriptKindFits(it.kind, it.unit, kctx))) fit = false;
        if(xs(pon).some(it => "pair" in it)) noPair = false;
        if(!pon.filter(it => it.word).every(it => VC.PAIRS.includes(it.pair))) wordsPaired = false;
        if(xs(pon).some(it => it.unit.id === x.mu.id)) miss++;
      }
      check(`${name}: the script units asked are exactly the ones dayPick takes without pairs, same draw (3 seeds; shares ${shares.join(" ")})`, same === 3 && shares.every(s => +s.split("/")[0] > 0));
      check(`${name}: the plan is full (n items) with words filling the slots the script units leave (${full}/3)`, full === 3);
      check(`${name}: script items keep their review kinds (drawn from reviewKinds, kind fits the unit), no pair`, fit && noPair);
      check(`${name}: word items carry their pair`, wordsPaired);
      check(`${name}: a script unit with a pending miss is asked (3 of 3 seeds, got ${miss})`, miss === 3);
      const rc = VC.buildRecallPlan(x.learned, x.p, x.pk, 8, opts(x, 4));
      check(`${name}: Recall asks no script unit (as without pairs)`, xs(rc).length === 0 && rc.length > 0);
      // (the pairs-off / dayAware-off script controls vs d5952d9 went with those flags in the flag collapse)
    }
    {
      // In the primer (no learned words yet): Review is the 12 script items it was without pairs.
      const x = seedRec(FX.ko(), 21, 0);
      const pon = VC.buildReviewPlan([], x.p, x.pk, opts(x, 5, { size: 12 })), poff = VC.buildReviewPlan([], x.p, offPairs(x.pk), opts(x, 5, { size: 12 }));
      check(`primer, no words: 12 script items, the same units as without pairs (${pon.length})`, pon.length === 12 && xs(pon).length === 12 && ids(pon) === ids(poff));
      x.p.script.skipped = true;
      check("primer skipped: no script items under pairs", VC.buildReviewPlan([], x.p, x.pk, opts(x, 5, { size: 12 })).length === 0);
    }
    // zh (no pack.script): Review and Recall byte-identical to d5952d9 on 3 seeded records, script option passed or not.
    if(OLD3){
      const zrec = (seed, nw) => { const r = mulberry32(seed), p = VC.defaultProg(PACK); p.sn = 12;
        WORDS.slice(0, nw).forEach(w => { const s = Math.floor(r() * 5); p.w[w.id] = { r: s + 1, w: Math.floor(r() * 3), s, u: 1 + Math.floor(r() * 11), t: 20000 }; if(r() < 0.3) p.w[w.id].p = { wm: [Math.floor(r() * 4), 1 + Math.floor(r() * 11)] }; });
        p.day = { d: TODAY, n: 1, a: { ["w:" + WORDS[0].id]: { m: 1, mk: ["hear"], ms: 12 } } }; return { p, lw: WORDS.slice(0, nw) }; };
      let same = 0, tot = 0;
      for(const [seed, nw] of [[31, 60], [32, 250], [33, 600]]){
        const z = zrec(seed, nw);
        for(const o of [planOpts(seed), planOpts(seed, { script: [], size: 20 })]){
          tot += 2;
          if(JSON.stringify(VC.buildReviewPlan(z.lw, z.p, PACK, Object.assign({}, o, { rng: mulberry32(seed) }))) === JSON.stringify(OLD3.buildReviewPlan(z.lw, z.p, withCollapsed(PACK), Object.assign({}, o, { rng: mulberry32(seed) })))) same++;
          if(JSON.stringify(VC.buildRecallPlan(z.lw, z.p, PACK, 8, Object.assign({}, o, { rng: mulberry32(seed) }))) === JSON.stringify(OLD3.buildRecallPlan(z.lw, z.p, withCollapsed(PACK), 8, Object.assign({}, o, { rng: mulberry32(seed) })))) same++;
        }
      }
      check(`zh (pairs on, no script): Review + Recall plans byte-identical to ${E3} on 3 seeded records (${same}/${tot})`, same === tot);
    } else skip(`zh control: no git ${E3}`);
  }

  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL  threw: " + (e && e.stack || e)); process.exit(1); });
