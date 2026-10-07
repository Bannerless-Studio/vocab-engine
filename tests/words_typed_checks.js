// pack.wordsBy "typed" (docs/PACK_SCHEMA.md "wordsBy"; owner 2026-10-03: "Does selecting a word count
// the same as writing the meaning?" -> no, the characters rule for words): [1] config and validation,
// [2] core streak table (kind x streak x outcome) with the flag, [3] flag-off control: every word kind,
// both outcomes, records byte-identical to a8e9c08's markRec; cloze untouched, [4] planner: a held word
// (streak 2) is planned typed in Review/Recall, only with a fitting typed kind, not after a typed
// right; flag-off plans equal a8e9c08's, [5] app on zh: held words asked typed, choice answers hold,
// at most one typed ask per word per Today session, [6] no streak credit for the in-drill retry after a
// miss from 2+ (every requeue kind), [7] words no typed kind fits (北京, 元, 人民币) keep the old rule,
// [8] the miss replay asks recall, the typed set survives a reload (session record today.tw);
// flag off a whole session byte-identical to a8e9c08.
// Run: node tests/words_typed_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "a8e9c08"; // main before wordsBy
const PY = process.env.PYTHON3 || "python3";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// fb27: the controls predate characters.start / ramp, so the pack is compared without them.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = (p => { delete p.pairs; delete p.characters.start; delete p.characters.ramp; return p; })((q => { delete q.progressView; return q; })(loadConst(path.join(ZH, "pack.js"), "PACK")));
const PACK_OFF = (p => { const q = Object.assign({}, p); delete q.wordsBy; delete q.progressMap; delete q.optsMix; return q; })(PACK);
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
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
const OLD = mainCoreSrc ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wt-")), `core_${MAIN}.js`); fs.writeFileSync(f, mainCoreSrc); return require(f); })() : null;

// ------------------------------------------------------------------ fake DOM (copied from typed_mastery_checks.js)
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
  tss: () => todayStepState, fits: e => typedWordFits(e), mark: (id, ok, kind) => markWord(id, ok, kind), setD: d => { D = d; }, miss: (id, kind) => { D.miss.push({ key: "w:" + id }); markWord(id, false, kind); }, render: () => render() };`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"WordsTypedChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
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
// HSK 1-3 learned; HSK 1 words at streak 2 (held), the next 6 at 1, the rest at 4; 60 units recorded.
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
function seedW(){
  const p = VC.normalizeProg({ sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": 0 }, placedOnce: true, soundsOpened: true, sessions: 40 }, PACK);
  let i = 0; ["1", "2", "3"].forEach(lv => byLv[lv].forEach(w => { const s = lv === "1" ? 2 : i++ < 6 ? 1 : 4; p.w[w.id] = { r: s + 2, w: 1, s, t: 20000, u: 1 }; }));
  VC.answerCharChoice(p, true);
  VC.charStageUnits(["1"], CHARACTERS, PACK).slice(0, 60).forEach((u, j) => { const s = j < 20 ? 4 : 6; p.chars.c[u.id] = { r: s + 1, w: 0, s }; });
  return p;
}

(async function main(){
  console.log("[1] config and validation");
  check(`zh ships wordsBy "typed"; WORD_HOLD ${VC.WORD_HOLD}, WORD_MASTERED ${VC.WORD_MASTERED}`, PACK.wordsBy === "typed" && VC.wordsTypedOn(PACK) && VC.WORD_HOLD === 2 && VC.WORD_MASTERED === 3);
  check("off without the field or with another value", !VC.wordsTypedOn(PACK_OFF) && !VC.wordsTypedOn(Object.assign({}, PACK, { wordsBy: "choice" })) && !VC.wordsTypedOn(null));
  {
    const base = { key: "synthwb", name: "Synth", tts: "en-US", levels: [{ id: "1", label: "One" }], placement: [["1", 1]], showPron: false, hasLessons: false, typing: {}, dayAware: true };
    const words = Array.from({ length: 12 }, (_, i) => ({ id: `w${i + 1}`, w: `word${i + 1}`, en: `gloss${i + 1}`, lv: "1" }));
    const run = pack => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ve_wordsby_"));
      fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(pack)); fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(words)); fs.writeFileSync(path.join(dir, "sentences.json"), "[]");
      cp.spawnSync(PY, [path.join(ROOT, "tools", "jsonify_pack.py"), dir], { cwd: ROOT });
      const r = cp.spawnSync(PY, [path.join(ROOT, "tools", "validate_pack.py"), dir], { cwd: ROOT, encoding: "utf8" }); return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
    const ok = run(Object.assign({}, base, { wordsBy: "typed" }));
    check("validator: wordsBy \"typed\" with typing and dayAware passes", ok.status === 0 && !/wordsBy/.test(ok.out), ok.out);
    const bad = run(Object.assign({}, base, { wordsBy: "choice" }));
    check("validator: another wordsBy value is an error", bad.status !== 0 && /pack\.wordsBy must be "typed"/.test(bad.out), bad.out);
    const nt = Object.assign({}, base, { wordsBy: "typed" }); delete nt.typing;
    const r2 = run(nt);
    check("validator: wordsBy without typing is an error (a held word could never move up)", r2.status !== 0 && /wordsBy needs pack\.typing/.test(r2.out), r2.out);
    const nd = Object.assign({}, base, { wordsBy: "typed" }); delete nd.dayAware;
    const r3 = run(nd);
    check("validator: wordsBy without dayAware warns", r3.status === 0 && /wordsBy without pack\.dayAware/.test(r3.out), r3.out);
  }

  console.log("\n[2] streak table with the flag (kind x streak -> new streak; r/w counts; prov)");
  {
    const KINDS = ["recall", "read", "hear", "type"];
    const rows = [], bad = [];
    for(const kind of KINDS) for(let s = 0; s <= 5; s++) for(const ok of [true, false]){
      const m = { x: { r: 5, w: 1, s } }; VC.markWordRec(m, "x", ok, kind, undefined, PACK);
      const want = s < VC.WORD_HOLD ? (ok ? s + 1 : 0) : ok ? (kind === "type" ? s + 1 : s) : s - 1;
      rows.push(`${kind} s${s} ${ok ? "right" : "miss"} -> ${m.x.s}`);
      if(m.x.s !== want || m.x.r !== 5 + (ok ? 1 : 0) || m.x.w !== 1 + (ok ? 0 : 1)) bad.push(rows[rows.length - 1] + ` (want ${want})`);
    }
    check(`${rows.length} cases: below 2 +1 / miss 0; from 2 typed +1, choice/ear hold, miss -1 (3 -> 2, 2 -> 1); r/w count every answer`, bad.length === 0, bad.join("\n"));
    console.log("    " + ["recall", "type"].map(k => [0, 1, 2, 3, 4].map(s => `${k} ${s}: ${[true, false].map(ok => { const m = { x: { r: 1, w: 0, s } }; VC.markWordRec(m, "x", ok, k, undefined, PACK); return m.x.s; }).join("/")}`).join(", ")).join("\n    "));
    const kOf = (rec, ok, kind, req) => { const a = { x: clone(rec) }, b = { x: clone(rec) }; VC.markWordRec(a, "x", ok, kind, req, PACK); VC.markRec(b, "x", ok, true, kind, req); return [a.x.k, b.x.k]; };
    const kCases = [[{ r: 3, w: 1, s: 2 }, false, "hear"], [{ r: 3, w: 1, s: 2, k: "hear" }, true, "hear"], [{ r: 3, w: 1, s: 3, k: "recall" }, true, "read", "recall"], [{ r: 3, w: 1, s: 4, k: "type" }, true, "recall"], [{ r: 3, w: 1, s: 2, k: "read" }, false, "type"]];
    check("missed kind k is set and cleared as markRec does", kCases.every(([rec, ok, kind, req]) => { const [a, b] = kOf(rec, ok, kind, req); return a === b; }));
    const pv = (s, ok, kind) => { const m = { x: { r: 2, w: 0, s, prov: 1 } }; VC.markWordRec(m, "x", ok, kind, undefined, PACK); return "prov" in m.x; };
    check("prov: kept on a hold at 2, cleared at 3 (typed right) and on any miss", pv(2, true, "recall") && !pv(2, true, "type") && !pv(2, false, "recall") && !pv(1, false, "type") && pv(1, true, "read"));
    check("a known word (3+) stays known after a choice answer and after one miss from 4+", (() => { const m = { a: { r: 9, w: 0, s: 3 }, b: { r: 9, w: 0, s: 7 } }; VC.markWordRec(m, "a", true, "hear", undefined, PACK); VC.markWordRec(m, "b", false, "read", undefined, PACK); return m.a.s === 3 && m.b.s === 6; })());
    check("a word without a record yet is created as markRec does", (() => { const a = {}, b = {}; VC.markWordRec(a, "x", true, "recall", undefined, PACK); VC.markRec(b, "x", true, true, "recall"); return JSON.stringify(a) === JSON.stringify(b); })());
  }

  console.log(`\n[3] flag-off control: markWordRec vs ${MAIN} markRec, every word kind, both outcomes`);
  if(!OLD) skip(`${MAIN} not in this checkout's history`);
  else {
    const KINDS = ["recall", "read", "hear", "type", "gap", "gapType", undefined];
    let n = 0; const diff = [];
    for(const kind of KINDS) for(let s = 0; s <= 5; s++) for(const ok of [true, false]) for(const extra of [{}, { prov: 1 }, { k: "recall" }, { k: "type", t: 20001, u: 3 }]) for(const req of [undefined, "type", "recall"]){
      const rec = Object.assign({ r: 4, w: 2, s }, extra);
      const a = { x: clone(rec) }, b = { x: clone(rec) }, c = { x: clone(rec) };
      OLD.markRec(a, "x", ok, true, kind, req); VC.markWordRec(b, "x", ok, kind, req, PACK_OFF); VC.markRec(c, "x", ok, true, kind, req); n++;
      if(JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(c)) diff.push(`${kind} s${s} ${ok} ${JSON.stringify(extra)} ${req}: ${JSON.stringify(a.x)} vs ${JSON.stringify(b.x)}`);
    }
    check(`${n} cases byte-identical (flag off, and markRec itself)`, diff.length === 0, diff.slice(0, 5).join("\n"));
    let n2 = 0; const d2 = [];
    for(const kind of KINDS) for(let s = 0; s < VC.WORD_HOLD; s++) for(const ok of [true, false]){ const a = { x: { r: 1, w: 0, s } }, b = { x: { r: 1, w: 0, s } }; OLD.markRec(a, "x", ok, true, kind); VC.markWordRec(b, "x", ok, kind, undefined, PACK); n2++; if(JSON.stringify(a) !== JSON.stringify(b)) d2.push(`${kind} s${s} ${ok}`); }
    check(`flag on, below WORD_HOLD: ${n2} cases byte-identical to ${MAIN}`, d2.length === 0, d2.join("\n"));
    const gapLine = h => (h.match(/^function markGapWord\(.*$/m) || [""])[0];
    // pack.pairs (fb23) adds a pair note for a cloze miss; the streak line is otherwise main's.
    const noPairs = l => l.replace(' if(PAIRS_ON && !ok && prog.w[id]) VC.notePair(prog.w[id], "wm", false, false, VC.daySn(prog));', "");
    check("cloze (markGapWord) unchanged: a blanked word's streak never moves, flag on or off", !!mainHtml && noPairs(gapLine(appHtml)) === gapLine(mainHtml) && !/markRec|markWordRec/.test(gapLine(appHtml)));
  }

  console.log("\n[4] planner: held words planned typed");
  {
    const p = seedW(); const TODAY = "2026-10-04";
    VC.dayStart(p, PACK, TODAY, true);
    const lw = VC.learnedWords(WORDS, PACK, p);
    const held = new Set(lw.filter(w => p.w[w.id].s === 2).map(w => w.id));
    const plan = (pack, o, core) => (core || VC).buildReviewPlan(lw, clone(p), pack, Object.assign({ today: TODAY, rng: mulberry32(5), size: 20 }, o || {}));
    const on = plan(PACK), off = plan(PACK_OFF);
    const onW = on.filter(it => it.word), offW = off.filter(it => it.word);
    const heldOn = onW.filter(it => held.has(it.word.id));
    // A held word no typed kind fits (北京, pronInGloss, while shown by its reading) keeps the old rule; fb26's
    // frequency order put it in this seed's plan.
    const typable = w => VC.typedKinds(PACK).some(k => VC.typedKindOk(k, w, false));
    check(`Review: as many items as flag off (${on.length}); every typable held word is asked typed (${heldOn.length} held of ${onW.length} words)`, on.length === off.length && heldOn.length > 0 && heldOn.filter(it => typable(it.word)).every(it => it.kind === "type"));
    // Many words below 2: the weak floor (lowest streak first) alone leaves held words out.
    const pS = clone(p); lw.filter(w => pS.w[w.id].s === 4).slice(0, 30).forEach(w => { pS.w[w.id].s = 1; });
    const planS = (pack, o) => VC.buildReviewPlan(lw, clone(pS), pack, Object.assign({ today: TODAY, rng: mulberry32(5), size: 20 }, o || {}));
    const hc = pl => pl.filter(it => it.word && held.has(it.word.id)), rf = pl => pl.filter(it => it.word && pS.w[it.word.id].s >= 3);
    const sOn = planS(PACK), sOff = planS(PACK_OFF), want = Math.round(20 * VC.DAY_HELD_SHARE_REVIEW);
    check(`Review, 30 more words at 1: held words still get ${want} slots (DAY_HELD_SHARE_REVIEW ${VC.DAY_HELD_SHARE_REVIEW}), all typed (${hc(sOn).length}; flag off ${hc(sOff).length}), and the refresh share keeps its ${Math.ceil(20 * VC.DAY_REFRESH_SHARE)} (${rf(sOn).length})`,
      hc(sOn).length >= want && hc(sOn).length > hc(sOff).length && hc(sOn).every(it => it.kind === "type") && rf(sOn).length >= Math.ceil(20 * VC.DAY_REFRESH_SHARE));
    const pR = clone(p); Object.values(pR.w).forEach(r => { if(r.s === 1) r.s = 4; });
    const rc = VC.buildRecallPlan(lw, pR, PACK, 8, { today: TODAY, rng: mulberry32(9) }).filter(it => it.word && held.has(it.word.id));
    const rk = Math.ceil(8 * VC.DAY_REFRESH_SHARE);
    check(`Recall (DAY_HELD_SHARE_RECALL ${VC.DAY_HELD_SHARE_RECALL}): held words fill all but the ${rk} refresh slots, asked typed (${rc.length} of 8)`, rc.length >= 8 - rk && rc.every(it => it.kind === "type"));
    const none = plan(PACK, { typedOk: () => false });
    check(`typedOk false (no typed kind fits): no held word is pulled forward or forced typed (${hc(none).length} held; flag off ${hc(off).length})`, hc(none).length <= hc(off).length && lw.filter(w => held.has(w.id)).every(w => !VC.typedWordDue(w, p, PACK, TODAY, ["type", "recall"], () => false)));
    // LOW 3: the type -> recall downgrade is for words typed this session only.
    {
      const wk = VC.dayWordKinds(PACK), ck = VC.dayCharKinds(PACK);
      const hw = lw.filter(w => held.has(w.id) && !w.pronInGloss), s1 = lw.find(w => p.w[w.id].s === 1), s4 = lw.find(w => p.w[w.id].s === 4);
      const pl = [{ word: hw[0], kind: "type" }, { word: hw[1], kind: "type" }, { word: s1, kind: "type" }, { word: s4, kind: "type" }, { word: hw[2], kind: "read" }];
      const seenIds = new Set([hw[0].id, hw[2].id]);
      const k1 = VC.dayPlanKinds(pl, p, PACK, TODAY, wk, ck, undefined, undefined, () => true, w => seenIds.has(w.id)).map(it => it.kind);
      const k0 = VC.dayPlanKinds(pl, p, PACK, TODAY, wk, ck, undefined, undefined, () => true, () => false).map(it => it.kind);
      check(`typedSeen: a held word typed this session -> recall; words not typed this session are never downgraded (${k1.join(" ")} vs ${k0.join(" ")})`,
        k1[0] === "recall" && k1[1] === "type" && k1[2] === k0[2] && k1[3] === k0[3] && k1[4] !== "type" && k0[0] === "type" && k0[1] === "type");
      const SU = VC.charStageUnits(["1"], CHARACTERS, PACK), TU = VC.typedUnitWords(SU, WORDS, PACK);
      const u = SU.find(x => TU.has(x.id) && VC.typedUnitDue(x, p, PACK, TU)), tw = u && TU.get(u.id);
      const pk = seen => VC.dayPlanKinds([{ unit: u, kind: "charRecall" }], p, PACK, TODAY, wk, ck, undefined, TU, () => true, seen)[0];
      const a = u ? pk(() => false) : null, b = u ? pk(w => w.id === tw.id) : null;
      check(`a unit's typed item (tu) is not planned for a word typed this session (${u ? u.id + " -> " + tw.w : "none"}: ${a && a.kind}${a && a.tu ? "/tu" : ""}, then ${b && b.kind}${b && b.tu ? "/tu" : ""})`, !!u && a.tu === u.id && a.kind === "type" && !b.tu && b.kind !== "type");
    }
    const pig = WORDS.find(w => w.pronInGloss && held.has(w.id));
    check(`default typedOk: a held pronInGloss word shown by its reading (${pig ? pig.w : "none"}) is not planned typed`, !!pig && !VC.typedWordDue(pig, p, PACK, TODAY, ["recall", "type"]) && VC.typedWordDue(BY_ID[[...held].find(id => !BY_ID[id].pronInGloss)], p, PACK, TODAY, ["recall", "type"]));
    const w0 = heldOn[0].word; const q = clone(p); VC.noteDay(q, PACK, TODAY, "w:" + w0.id, "type", true);
    check("a word right typed recently (reached 2 by it) keeps the day rule: no same-kind repeat", VC.typedWordDue(w0, p, PACK, TODAY, ["type"]) && !VC.typedWordDue(w0, q, PACK, TODAY, ["type"]));
    check("streak 1 and streak 3 words, a planner without \"type\" (Listen), and dayAware off are never forced",
      !VC.typedWordDue(BY_ID[Object.keys(p.w).find(id => p.w[id].s === 1)], p, PACK, TODAY, ["type"]) && !VC.typedWordDue(BY_ID[Object.keys(p.w).find(id => p.w[id].s === 4)], p, PACK, TODAY, ["type"])
      && !VC.typedWordDue(w0, p, PACK, TODAY, ["hear"]) && !VC.typedWordDue(w0, p, Object.assign({}, PACK, { dayAware: false }), TODAY, ["type"]));
    if(!OLD) skip(`${MAIN} plan control`);
    else {
      const o1 = plan(PACK_OFF, {}, OLD), o2 = VC.buildRecallPlan(lw, clone(p), PACK_OFF, 8, { today: TODAY, rng: mulberry32(9) }), o3 = OLD.buildRecallPlan(lw, clone(p), PACK_OFF, 8, { today: TODAY, rng: mulberry32(9) });
      const sig = pl => JSON.stringify(pl.map(it => [it.word && it.word.id, it.unit && it.unit.id, it.kind, it.tu]));
      check(`flag off: Review and Recall plans identical to ${MAIN}`, sig(o1) === sig(off) && sig(o2) === sig(o3));
    }
  }

  console.log("\n[5] app on zh: one Today session");
  {
    NOW = new Date(2026, 9, 4, 8, 0, 0).getTime();
    const p0 = seedW();
    const api = await boot(PACK, p0, 3);
    check(`Today plan: Recall ${VC.RECALL_SIZE_HELD} items under wordsBy (${VC.RECALL_SIZE} without; the typed rule's extra production slots)`, VC.recallSize(PACK) === 12 && VC.recallSize(PACK_OFF) === 8 && new RegExp(`${VC.RECALL_SIZE_HELD} items`).test(api.panel()));
    check("Recall stays 8 for wordsBy without dayAware (held routing needs dayAware)", VC.recallSize(Object.assign({}, PACK, { dayAware: false })) === 8);
    // Held words: typed answers wrong, choice answers right; everything else right.
    const rows = await session(api, (it, rec) => !(rec && rec.s === 2 && it.kind === "type"));
    { const rq = rows.filter(r => r.step === 3), firsts = rq.filter((r, i) => rq.findIndex(x => x.key === r.key) === i).length; check(`Recall drill asks ${firsts} items (${VC.RECALL_SIZE_HELD} planned)`, firsts === VC.RECALL_SIZE_HELD); }
    const W = rows.filter(r => r.key[0] === "w");
    const heldRv = W.filter(r => r.step === 0 && r.s0 === 2 && p0.w[r.key.slice(2)].s === 2);
    check(`Review: held words are asked typed first (${heldRv.filter(r => r.kind === "type").length} of ${new Set(heldRv.map(r => r.key)).size} held words)`, heldRv.length > 0 && heldRv.filter((r, i) => heldRv.findIndex(x => x.key === r.key) === i).every(r => r.kind === "type"));
    const choiceHeld = W.filter(r => r.s0 >= 2 && r.kind !== "type" && r.ok);
    check(`right choice/ear answers at 2+ hold the streak, r +1 (${choiceHeld.length})`, choiceHeld.length > 0 && choiceHeld.every(r => r.s1 === r.s0 && r.r1 === r.r0 + 1));
    const missHeld = W.filter(r => r.s0 >= 2 && !r.ok);
    check(`misses at 2+ step down one (${missHeld.length})`, missHeld.length > 0 && missHeld.every(r => r.s1 === r.s0 - 1));
    const typedBy = {}; W.filter(r => r.kind === "type").forEach(r => { (typedBy[r.key] = typedBy[r.key] || new Set()).add(r.step); });
    const twice = Object.entries(typedBy).filter(([k, st]) => st.size > 1 && p0.w[k.slice(2)].s === 2);
    check(`at most one typed drill per held word in the session (${Object.keys(typedBy).length} words typed; ${twice.length} twice)`, twice.length === 0, twice.slice(0, 5).map(([k, st]) => k + " steps " + [...st]).join("\n"));
    const back = W.filter(r => r.s0 === 1 && r.s1 === 2 && p0.w[r.key.slice(2)].s === 2).map(r => r.key);
    check(`held words missed typed and taken back to 2 by a choice in the session (${new Set(back).size}) get no second typed drill`, back.length > 0 && back.every(k => !typedBy[k] || typedBy[k].size === 1));
    // Second session: typed answers right take held words to known.
    NOW = new Date(2026, 9, 4, 13, 0, 0).getTime();
    api.el("go") || null;
    const pre = clone(api.getProg().w);
    const rows2 = await session(api, () => true);
    const t2 = rows2.filter(r => r.key[0] === "w" && r.kind === "type" && r.s0 === 2);
    check(`right typed answers at 2 make a word known (${t2.length})`, t2.length > 0 && t2.every(r => r.s1 === 3));
    check("no word at 3+ before the sessions lost known status by a right answer", Object.keys(pre).every(id => (pre[id].s || 0) < 3 || (api.getProg().w[id].s || 0) >= 3 || rows2.some(r => r.key === "w:" + id && !r.ok)));
  }

  console.log("\n[6] in-drill retry after a miss: no streak credit from 2+ (review HIGH 1, as markUnitTyped)");
  {
    NOW = new Date(2026, 9, 4, 8, 0, 0).getTime();
    const p0 = seedW();
    const api = await boot(PACK, p0, 5);
    // First ask of a word in Review: typed from 2+ misses once (even id) or twice (odd id: the typed
    // fallback), any other word once; in later stages only a choice first ask from 2+ misses once.
    const misses = (it, s) => s >= 2 && it.kind === "type" ? 1 + (parseInt(String(it.key).slice(-1), 10) % 2) : 1;
    const first = {};
    const rows = await session(api, (it, rec, rs, step) => { const key = String(it.key); if(key[0] !== "w") return true;
      const fk = step + "|" + key; if(!first[fk]) first[fk] = { s: rec ? rec.s || 0 : 0, kind: it.kind };
      if(step !== 0 && !(first[fk].kind !== "type" && first[fk].s >= 2)) return true;
      const n = rs.filter(r => r.key === key && r.step === step).length;
      return n >= misses({ key, kind: first[fk].kind }, first[fk].s); });
    const W = rows.filter(r => r.key[0] === "w");
    const retries = W.filter(r => r.ok && W.some(m => m.key === r.key && m.step === r.step && !m.ok && W.indexOf(m) < W.indexOf(r))).map(r => Object.assign({ f: first[r.step + "|" + r.key] }, r));
    const site = { typed: retries.filter(r => r.f.kind === "type" && r.kind === "type"), fallback: retries.filter(r => r.f.kind === "type" && r.kind !== "type"), choice: retries.filter(r => r.f.kind !== "type") };
    const noCredit = rs => rs.filter(r => r.f.s >= 2).every(r => r.s1 === r.s0 && r.r1 === r.r0 + 1);
    check(`typed requeue: a word missed typed from 2+ and retyped right in the drill stays stepped down (${site.typed.filter(r => r.f.s >= 2).length})`, site.typed.filter(r => r.f.s >= 2).length > 0 && noCredit(site.typed));
    check(`typed fallback (typedRecallFallback, logged recall): right after two typed misses from 2+, no credit (${site.fallback.filter(r => r.f.s >= 2).length}; ${[...new Set(site.fallback.map(r => r.label))]})`, site.fallback.filter(r => r.f.s >= 2).length > 0 && noCredit(site.fallback));
    const ck = [...new Set(site.choice.filter(r => r.f.s >= 2).map(r => r.label))];
    check(`choice requeue (${ck.join(" / ")}): right on the retry after a miss from 2+, no credit (${site.choice.filter(r => r.f.s >= 2).length})`, site.choice.filter(r => r.f.s >= 2).length > 0 && noCredit(site.choice));
    const low = retries.filter(r => r.f.s < 2);
    check(`below 2 the retry still counts as before (miss -> 0, retry right -> 1) (${low.length})`, low.length > 0 && low.every(r => r.s1 === r.s0 + 1));
    const later = W.filter(r => r.ok && r.step > 0 && W.some(m => m.key === r.key && m.step === 0 && !m.ok) && r.s0 < 2);
    // Every requeue kind directly: a miss in this drill steps the word 2 -> 1, then right on the retry;
    // control: a fresh drill, the word at 1, right.
    const w = byLv["2"].find(x => !x.pronInGloss), per = {};
    for(const kind of ["recall", "read", "hear", "type"]){
      api.getProg().w[w.id] = { r: 3, w: 1, s: 2 }; api.setD({ miss: [] }); api.miss(w.id, kind); api.mark(w.id, true, kind); per[kind] = api.getProg().w[w.id].s;
      api.getProg().w[w.id] = { r: 3, w: 1, s: 1 }; api.setD({ miss: [] }); api.mark(w.id, true, kind); per[kind + " (no miss)"] = api.getProg().w[w.id].s; }
    api.getProg().w[w.id] = { r: 3, w: 1, s: 2 }; api.setD({ miss: [] }); api.miss(w.id, "type"); api.mark(w.id, true, "type");
    const kr = api.getProg().w[w.id];
    api.getProg().w[w.id] = { r: 3, w: 1, s: 3 }; api.setD({ miss: [] }); api.miss(w.id, "type"); api.miss(w.id, "recall");
    const k2 = api.getProg().w[w.id];
    api.setD(null);
    check(`a missed retry after a step-down from 2+ adds w only (3 -> 2 -> 2: ${JSON.stringify(k2)})`, k2.s === 2 && k2.w === 3);
    check(`the typed retry right settles the missed kind k as before, streak held (${JSON.stringify(kr)})`, !("k" in kr) && kr.s === 1 && kr.r === 4 && kr.w === 2);
    check(`retry right by recall / read / hear / type after a miss in the drill: no credit (${JSON.stringify(per)})`, ["recall", "read", "hear", "type"].every(k => per[k] === 1 && per[k + " (no miss)"] === 2));
    // Review 2 M1: a Learn pair (hear + read per word): a new word missed once, then right twice, ends at 2 as without the flag.
    const nw = byLv["4"].find(x => !x.pronInGloss), pair = [];
    for(const pk of [PACK, PACK_OFF]){ const a2 = await boot(pk, seedW(), 5); a2.setD({ miss: [] }); delete a2.getProg().w[nw.id];
      a2.miss(nw.id, "hear"); a2.mark(nw.id, true, "read"); a2.mark(nw.id, true, "hear"); pair.push(a2.getProg().w[nw.id].s); }
    check(`Learn pair, a new word: miss, read right, retry right -> ${pair[0]} (flag off ${pair[1]})`, pair[0] === 2 && pair[1] === 2);
    check(`a right answer in a later drill of the session counts as usual (below 2: +1) (${later.length})`, later.length > 0 && later.every(r => r.s1 === r.s0 + 1));
  }

  console.log("\n[7] words no typed kind fits while the written form is hidden: the old rule (choice right advances)");
  {
    NOW = new Date(2026, 9, 4, 8, 0, 0).getTime();
    const p0 = seedW(); const ids = ["北京", "元", "人民币"].map(w => WORDS.find(x => x.w === w).id);
    // Their characters not yet mastered: the words show by their reading.
    CHARACTERS.filter(c => /[北京元人民币]/.test(c.t)).forEach(c => { delete p0.chars.c[c.id]; });
    const ctl = byLv["1"].find(w => !w.pronInGloss);
    [...ids, ctl.id].forEach(id => { p0.w[id] = { r: 4, w: 1, s: 2, t: 20000, u: 1 }; });
    const api = await boot(PACK, p0, 7);
    const fits = ids.map(id => api.fits(BY_ID[id]));
    check(`no typed kind fits ${["北京", "元", "人民币"].join(", ")} now (${fits}); the control ${ctl.w} fits`, fits.every(f => !f) && api.fits(ctl));
    ids.forEach(id => api.mark(id, true, "recall")); api.mark(ctl.id, true, "recall");
    check(`a right choice at 2 advances them to known (${ids.map(id => api.getProg().w[id].s)}); the control holds at ${api.getProg().w[ctl.id].s}`, ids.every(id => api.getProg().w[id].s === 3) && api.getProg().w[ctl.id].s === 2);
    ids.forEach(id => api.mark(id, false, "read"));
    check(`a miss at 3 goes to 0 as before (${ids.map(id => api.getProg().w[id].s)})`, ids.every(id => api.getProg().w[id].s === 0));
    const m = { a: { r: 1, w: 0, s: 2 } }; VC.markWordRec(m, "a", true, "hear", undefined, PACK, { typable: false });
    check("core: markWordRec typable false = markRec", m.a.s === 3);
  }

  console.log("\n[8] one typed ask per word per session: the miss replay asks recall; a reload keeps the typed set");
  {
    NOW = new Date(2026, 9, 4, 8, 0, 0).getTime();
    const p0 = seedW(); const SK = VC.sessionKey(PACK);
    const api = await boot(PACK, p0, 3);
    const pol = (it, rec, rs) => !(rec && rec.s === 2 && it.kind === "type" && !rs.some(r => r.key === String(it.key)));
    let tw0 = null;
    const rowsA = await session(api, pol, { stop: (rs, it) => { const ty = rs.filter(r => r.kind === "type" && !r.ok); if(ty.length >= 3 && api.tss() && api.tss().at === 0 && !tw0){ tw0 = ty.map(r => r.key.slice(2)); return true; } return false; } });
    const rec = JSON.parse(api.st.ss.getItem(SK) || api.st.ls.getItem(SK) || "null");
    const tw = rec && rec.today && rec.today.tw;
    check(`session record ${SK} carries today.tw, the words asked typed (${tw ? tw.length : "none"}; ${(tw0 || []).length} missed)`, Array.isArray(tw) && (tw0 || []).length >= 3 && tw0.every(id => tw.includes(id)));
    check(`progress ${VC.storageKey(PACK)} gains no field (no "tw")`, !/"tw"/.test(api.st.ls.getItem(VC.storageKey(PACK))));
    const api2 = await boot(PACK, null, 9, { st: api.st });
    if(!api2.getCur() && api2.getD()) api2.render();
    const resumed = !!(api2.getD() && api2.getD().cur && api2.tss() && api2.tss().at === 0);
    check("reload mid-Review resumes the drill", resumed);
    const rowsB = await session(api2, pol, { cont: true });
    const tyB = rowsB.filter(r => r.kind === "type" && tw0.includes(r.key.slice(2)));
    const rt = tyB.filter(r => r.step === 0 && r.ok);
    check(`a reload between a typed miss from 2 and its in-drill retry: the retry right still gets no credit (${rt.map(r => r.s0 + "->" + r.s1)})`, rt.length > 0 && rt.every(r => r.s0 === 1 && r.s1 === 1));
    const again = tyB.filter(r => r.step > 0);
    check(`after the reload, no word typed before it is asked typed again in a later stage (${again.length}; in-drill typed retries ${tyB.length - again.length})`, again.length === 0, again.map(r => r.key + "@" + r.step).join(" "));
    const all = [...rowsA, ...rowsB].filter(r => r.key[0] === "w");
    const missedT = new Set(all.filter(r => r.kind === "type" && !r.ok && r.step === 0).map(r => r.key));
    const replay = all.filter(r => r.step > 0 && missedT.has(r.key));
    check(`the miss replay of words missed typed asks recall, never type (${replay.length}: ${[...new Set(replay.map(r => r.label))]})`, replay.length > 0 && replay.every(r => r.kind !== "type" && r.label === "Which word is this?"));
  }
  if(!OLD || !mainHtml) skip(`flag-off app control vs ${MAIN}`);
  else {
    const run = async (html, core) => {
      NOW = new Date(2026, 9, 4, 8, 0, 0).getTime();
      const api = await boot(PACK_OFF, seedW(), 11, { html, core });
      const out = { today: api.panel() }; const ans = mulberry32(7);
      const rows = await session(api, () => ans() < 0.75);
      out.walk = JSON.stringify(rows.map(r => [r.key, r.kind, r.label, r.ok]));
      NOW = new Date(2026, 9, 4, 13, 0, 0).getTime();
      const rows2 = await session(api, () => ans() < 0.75);
      out.walk2 = JSON.stringify(rows2.map(r => [r.key, r.kind, r.label, r.ok]));
      const p = api.getProg(); out.prog = JSON.stringify({ w: p.w, c: p.chars.c, s: p.s, day: p.day });
      return out;
    };
    const a = await run(mainHtml, OLD), b = await run(undefined, undefined);
    for(const k of Object.keys(a)){ let d = 0; while(d < a[k].length && a[k][d] === b[k][d]) d++;
      check(`flag off, two sessions: ${k} byte-identical to ${MAIN} (${a[k].length} chars)${a[k] === b[k] ? "" : ` first diff at ${d}`}`, a[k] === b[k] && a[k].length > 100); }
  }

  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
