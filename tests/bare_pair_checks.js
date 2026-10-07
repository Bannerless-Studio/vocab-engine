// characters.bareByPair (docs/PACK_SCHEMA.md "bareByPair"; owner 2026-10-07: "Can/should we let go of the
// pinyins a bit earlier? ... a lot of words I can read without pinyin comfortably but it still shows them"):
// [1] config and validator, [2] the rule (ruby unit + wm pair at 2, the unit's or its word's, the one answered
// last deciding; answered pairs only; a miss on either brings the reading back; flag off never), [3] sites: rubyTiers tokens, bareWord, Progress
// rows without freqTiers, [4] the app: a drill question and a passage token lose their reading, a miss
// brings it back, records byte-equal with the flag on and off, [5] flag-off control: a two-session app walk,
// Read and Progress byte-identical to 3044601, [6] measurement on the owner export (read-only): units bare
// and passage sentence tokens bare, before / after, as exported and after simulated Today sessions.
// Run: node tests/bare_pair_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "3044601"; // main before bareByPair
const PY = process.env.PYTHON3 || "python3";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn typeof ${name} !== "undefined" ? ${name} : undefined;`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const noBBP = p => Object.assign({}, p, { characters: (c => { const q = Object.assign({}, c); delete q.bareByPair; return q; })(p.characters) });
const PACK_OFF = noBBP(PACK);
// The 3044601 control strips every field that postdates it (fb31 patternCue, fb32 glossStyle); each has its own control.
const PACK_OFF_ALL = (p => { delete p.patternCue; delete p.glossStyle; return p; })(Object.assign({}, PACK_OFF));
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const PATTERNS = loadConst(path.join(ZH, "sentences.js"), "PATTERNS");
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
const OLD = mainCoreSrc ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "barepair-")), `core_${MAIN}.js`); fs.writeFileSync(f, mainCoreSrc); return require(f); })() : null;

// ------------------------------------------------------------------ fake DOM (copied from patterns_checks.js)
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
let NOW = new Date(2026, 9, 7, 8, 0, 0).getTime();
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
  tab: t => document.querySelector('#tabs button[data-t="' + t + '"]').click(), pronAsked: e => pronAsked(e), sentenceRuby: s => sentenceRuby(s),
  startPassage: p => { tab = "read"; startPassage(p, false); } };`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","PATTERNS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"BarePairChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, o.passages || PASSAGES, CHARACTERS, PATTERNS];
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

// The owner's export (private, never committed): $PAIRS_OWNER, else the 2026-10-04 upload; without one the
// app sections run on a synthetic record and [6] is skipped.
const OWNER_FILE = [process.env.PAIRS_OWNER, "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json"].find(f => f && fs.existsSync(f));
const OWNER = OWNER_FILE ? JSON.parse(fs.readFileSync(OWNER_FILE, "utf8")) : null;
// HSK 1 learned (streak 4) and its first 40 units taught: 20 at ruby (3, 4), 20 below (2).
function synth(){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 12 }, PACK);
  p.sets = { "1": NS("1"), "2": 0, "3": 0, "4": 0 }; p.sn = 12;
  byLv["1"].forEach(w => { p.w[w.id] = { r: 5, w: 0, s: 4, u: 10 }; });
  const us = CHARACTERS.filter(u => u.lv === "1").slice(0, 40);
  p.chars = Object.assign(p.chars || {}, { choiceSeen: true, c: {} });
  us.forEach((u, i) => { p.chars.c[u.id] = { r: 4, w: 0, s: i < 20 ? 3 + (i % 2) : 2, u: 10 }; });
  return p;
}
const U0 = CHARACTERS.find(u => u.id === "c0125"), W0 = BY_ID[U0.words[0]];
const withRec = (rec, wrec) => { const p = synth(); p.chars.c[U0.id] = rec; if(wrec) p.w[W0.id] = wrec; return p; };
const tiersOf = (s, prog, pack) => (VC.rubyTiers(s, CHARACTERS, prog, pack, VC.charsStarted(pack, WORDS, CHARACTERS, prog, SENTENCES)) || []).map(t => t.tier);
const passageSents = () => PASSAGES.flatMap(p => p.sentences);

(async () => {
  console.log("[1] config: characters.bareByPair on zh, needs pairs; validator");
  check("packs/zh sets characters.bareByPair with pairs", PACK.characters.bareByPair === true && VC.bareByPairOn(PACK));
  check("bareByPairOn: off without the field, without pairs, without dayAware, or not true", !VC.bareByPairOn(PACK_OFF) && !VC.bareByPairOn(Object.assign({}, PACK, { pairs: false })) && !VC.bareByPairOn(Object.assign({}, PACK, { dayAware: false })) &&
    !VC.bareByPairOn(Object.assign({}, PACK, { characters: Object.assign({}, PACK.characters, { bareByPair: "yes" }) })));
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "barepair-val-"));
    const run = pk => { const d = path.join(tmp, String(Math.random()).slice(2)); fs.mkdirSync(d); for(const f of fs.readdirSync(ZH)) if(f.endsWith(".json")) fs.copyFileSync(path.join(ZH, f), path.join(d, f));
      const pj = JSON.parse(fs.readFileSync(path.join(d, "pack.json"), "utf8")); pk(pj); fs.writeFileSync(path.join(d, "pack.json"), JSON.stringify(pj));
      cp.execSync(`${PY} "${path.join(ROOT, "tools", "jsonify_pack.py")}" "${d}"`, { stdio: "ignore" });
      try { cp.execSync(`${PY} "${path.join(ROOT, "tools", "validate_pack.py")}" "${d}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return ""; } catch(e){ return String(e.stdout || "") + String(e.stderr || ""); } };
    check("validate_pack: zh as shipped passes", run(() => {}) === "");
    check("validate_pack: bareByPair not a boolean is an error", /pack\.characters\.bareByPair must be a boolean/.test(run(p => { p.characters.bareByPair = 1; })));
    check("validate_pack: bareByPair without pairs is an error", /pack\.characters\.bareByPair needs pack\.pairs/.test(run(p => { delete p.pairs; })));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n[2] the rule: a ruby unit is bare once its wm pair, or its word's, is at 2 (answered pairs only)");
  const pb = (rec, wrec, pack) => { const p = withRec(rec, wrec); return VC.pairBare(p.chars.c[U0.id], U0, p, pack || PACK); };
  const T = [
    ["ruby (3), no pair answered", { r: 3, w: 0, s: 3 }, null, false],
    ["ruby (3), wm 1", { r: 4, w: 0, s: 3, p: { wm: [1, 9] } }, null, false],
    ["ruby (3), wm 2", { r: 5, w: 0, s: 3, p: { wm: [2, 9] } }, null, true],
    ["ruby (4), wm 3", { r: 5, w: 0, s: 4, p: { wm: [3, 9] } }, null, true],
    ["ruby (4), ws 5 only (another pair)", { r: 5, w: 0, s: 4, p: { ws: [5, 9] } }, null, false],
    ["ruby (3), its word's wm 2", { r: 3, w: 0, s: 3 }, { r: 6, w: 0, s: 4, p: { wm: [2, 9] } }, true],
    ["ruby (3), its word's wm 1, sm 4", { r: 3, w: 0, s: 3 }, { r: 6, w: 0, s: 4, p: { wm: [1, 9], sm: [4, 9] } }, false],
    ["ruby (3), its word at streak 6 with no pair answered (boot not counted)", { r: 3, w: 0, s: 3 }, { r: 6, w: 0, s: 6 }, false],
    ["pron (2), wm 3 (below mastered stays pron)", { r: 5, w: 0, s: 2, p: { wm: [3, 9] } }, null, false],
    ["malformed wm", { r: 5, w: 0, s: 3, p: { wm: ["2", 9] } }, null, false],
    ["ruby (3), unit wm 2 (sn 4), word wm 2 (sn 5)", { r: 5, w: 0, s: 3, p: { wm: [2, 4] } }, { r: 6, w: 0, s: 4, p: { wm: [2, 5] } }, true],
    ["ruby (3), unit wm 2 (sn 4), word missed later (0, sn 6)", { r: 5, w: 0, s: 3, p: { wm: [2, 4] } }, { r: 6, w: 1, s: 0, p: { wm: [0, 6] } }, false],
    ["ruby (3), unit missed later (0, sn 6), word wm 2 (sn 5)", { r: 5, w: 1, s: 3, p: { wm: [0, 6] } }, { r: 6, w: 0, s: 4, p: { wm: [2, 5] } }, false],
    ["ruby (3), unit wm 3 (sn 8) after a word miss (0, sn 6)", { r: 6, w: 1, s: 3, p: { wm: [3, 8] } }, { r: 6, w: 1, s: 0, p: { wm: [0, 6] } }, true],
    ["ruby (3), same session: unit 2, word 0", { r: 5, w: 0, s: 3, p: { wm: [2, 7] } }, { r: 6, w: 1, s: 0, p: { wm: [0, 7] } }, false],
  ];
  T.forEach(([name, rec, wrec, want]) => console.log(`    ${name.padEnd(72)} ${want ? "bare" : "-"}`));
  check(`${T.length} rule cases`, T.every(([, rec, wrec, want]) => pb(rec, wrec) === want), T.filter(([, rec, wrec, want]) => pb(rec, wrec) !== want).map(x => x[0]).join("\n"));
  check("bare (5) stays bare by its streak; pairBare adds nothing there", pb({ r: 5, w: 0, s: 5 }) === false && VC.charTier(5, PACK) === "bare");
  check("flag off (bareByPair stripped, or pairs off): never", T.every(([, rec, wrec]) => !pb(rec, wrec, PACK_OFF) && !pb(rec, wrec, Object.assign({}, PACK, { pairs: false }))));
  {
    const p = withRec({ r: 5, w: 0, s: 3, p: { wm: [2, 9] } }), r = p.chars.c[U0.id];
    const was = VC.pairBare(r, U0, p, PACK);
    VC.notePair(r, "wm", false, false, 10, r.s, VC.pairUnitHeld(PACK));
    const after = VC.pairBare(r, U0, p, PACK);
    VC.notePair(r, "wm", true, true, 11, r.s, VC.pairUnitHeld(PACK)); const one = VC.pairBare(r, U0, p, PACK);
    VC.notePair(r, "wm", true, true, 12, r.s, VC.pairUnitHeld(PACK)); const two = VC.pairBare(r, U0, p, PACK);
    check("a miss on the pair resets it to 0: the reading returns; two right production answers make it bare again", was && !after && r.p.wm[0] === 2 && !one && two);
  }
  {
    // Two streams (review fb31 F1): the unit's and the word's wm pairs; the most recent answer decides.
    const p = withRec({ r: 5, w: 0, s: 3, p: { wm: [2, 4] } }, { r: 6, w: 0, s: 4, p: { wm: [2, 5] } }), r = p.chars.c[U0.id], w = p.w[W0.id];
    const bare = () => VC.pairBare(r, U0, p, PACK), held = VC.pairUnitHeld(PACK);
    const s0 = bare();
    VC.notePair(w, "wm", false, false, 6, w.s); const wMiss = bare();
    VC.notePair(w, "wm", true, true, 7, w.s); const wOne = bare();
    VC.notePair(w, "wm", true, true, 8, w.s); const wTwo = bare();
    check("both streams at 2, a miss on the word: reading back; the word right twice later: bare again", s0 && !wMiss && !wOne && wTwo, JSON.stringify([s0, wMiss, wOne, wTwo]));
    VC.notePair(r, "wm", false, false, 9, r.s, held); const uMiss = bare();
    VC.notePair(r, "wm", true, true, 10, r.s, held); const uOne = bare();
    VC.notePair(r, "wm", true, true, 11, r.s, held); const uTwo = bare();
    check("both streams at 2, a miss on the unit: reading back; the unit right twice later: bare again", !uMiss && !uOne && uTwo, JSON.stringify([uMiss, uOne, uTwo]));
  }

  console.log("\n[3] sites: sentence tokens (rubyTiers), drill words (bareWord), Progress rows without freqTiers");
  {
    const s = SENTENCES.find(x => (x.ruby || []).some(k => k[3] === W0.id) && x.ruby.length >= 3);
    const p = withRec({ r: 5, w: 0, s: 3, p: { wm: [2, 9] } });
    const on = tiersOf(s, p, PACK), off = tiersOf(s, p, PACK_OFF), i0 = s.ruby.findIndex(k => k[3] === W0.id);
    check(`rubyTiers ("${s.t}"): the pair-bare unit's token bare (off: ruby), every other token unchanged`, on[i0] === "bare" && off[i0] === "ruby" && on.every((t, i) => i === i0 || t === off[i]), JSON.stringify([on, off]));
    const pass = PASSAGES.find(x => (x.titleRuby || []).some(k => k[3] === W0.id) || x.questions.some(q => (q.ruby || []).some(k => k[3] === W0.id)));
    const q = pass && pass.questions.find(q => (q.ruby || []).some(k => k[3] === W0.id));
    check("passage questions take the same tier (rubyTiers on a question)", !!q && tiersOf({ ruby: q.ruby }, p, PACK)[q.ruby.findIndex(k => k[3] === W0.id)] === "bare" && tiersOf({ ruby: q.ruby }, p, PACK_OFF)[q.ruby.findIndex(k => k[3] === W0.id)] === "ruby");
    check("bareWord: the pair-bare unit's word is asked without its reading; off, with it", VC.bareWord(W0, CHARACTERS, p, PACK) && !VC.bareWord(W0, CHARACTERS, p, PACK_OFF));
    const pm = withRec({ r: 5, w: 1, s: 3, p: { wm: [0, 9] } });
    check("bareWord after a miss on the pair: reading back", !VC.bareWord(W0, CHARACTERS, pm, PACK));
    const NF = (pk => { const q = Object.assign({}, pk); delete q.freqTiers; return q; });
    const prow = async pk => { const api = await boot(pk, p, 3); api.tab("progress"); await tick(); const h = api.panel(), i = h.indexOf(">Characters</p>"), m = i < 0 ? null : h.slice(i).match(/<tr><td>HSK 1<\/td><td>([^<]*)<\/td><\/tr>/); return m ? m[1] : ""; };
    const a = await prow(NF(PACK)), b = await prow(NF(PACK_OFF)), c = await prow(PACK);
    console.log(`    Progress characters row, no freqTiers: on "${a}" | off "${b}" | zh (freqTiers) "${c}"`);
    check("Progress characters row without freqTiers counts the pair-bare unit as bare; with freqTiers (zh) it counts done, unchanged", /· 1 bare/.test(a) && !/bare/.test(b) && !/bare/.test(c) && a !== b);
  }

  console.log("\n[4] the app with the flag: drill word and passage token lose the reading; a miss brings it back; records unchanged");
  {
    const p = withRec({ r: 5, w: 0, s: 3, p: { wm: [2, 9] } });
    const api = await boot(PACK, p, 5), apiOff = await boot(PACK_OFF, p, 5);
    check("drill question (pronAsked): no reading beside the word; off, the reading", api.pronAsked(W0) === "" && apiOff.pronAsked(W0) !== "");
    const s = SENTENCES.find(x => (x.ruby || []).some(k => k[3] === W0.id));
    const t = (a) => { const r = a.sentenceRuby(s); return r && r.find(k => k.wordId === W0.id).tier; };
    check("sentence token in the app (sentenceRuby): bare; off, ruby", t(api) === "bare" && t(apiOff) === "ruby");
    const pass = PASSAGES.find(x => x.sentences.some(y => (y.ruby || []).some(k => k[3] === W0.id) && y.ruby.length >= 4));
    api.startPassage(pass); apiOff.startPassage(pass);
    const hOn = api.panel(), hOff = apiOff.panel();
    check(`Read tab passage ${pass.id}: more bare ruby tokens with the flag (one unit flipped)`, (hOn.match(/<ruby class="bare">/g) || []).length > (hOff.match(/<ruby class="bare">/g) || []).length);
    const r = api.getProg().chars.c[U0.id]; VC.notePair(r, "wm", false, false, 13, r.s, VC.pairUnitHeld(PACK));
    check("after a miss on the pair: the reading is back in the app", api.pronAsked(W0) !== "" && t(api) === "ruby");
    // Display only: two Today sessions with the same answers write byte-equal records with the flag on and off.
    const run = async pk => { NOW = new Date(2026, 9, 7, 8, 0, 0).getTime(); const a = await boot(pk, OWNER || synth(), 21); const rng = mulberry32(9);
      const rows = []; for(let k = 0; k < 2; k++){ NOW += 4 * 3600e3; rows.push(...(await session(a, () => rng() < 0.85)).map(x => [x.key, x.kind, x.ok])); } return { rows: JSON.stringify(rows), prog: JSON.stringify(a.getProg()) }; };
    const on = await run(PACK), off = await run(PACK_OFF);
    check(`two Today sessions on ${OWNER ? "the owner export" : "a synthetic record"} (${JSON.parse(on.rows).length} answers): same items and records byte-equal with the flag on and off`, on.rows === off.rows && on.prog === off.prog);
  }

  console.log(`\n[5] flag-off control vs ${MAIN}`);
  if(!OLD || !mainHtml) skip(`${MAIN} not in this checkout's history`);
  else {
    const walk = async (html, core) => {
      NOW = new Date(2026, 9, 7, 8, 0, 0).getTime();
      const pr = OWNER ? clone(OWNER) : synth();
      const api = await boot(PACK_OFF_ALL, pr, 31, { html, core: Object.assign({}, core) }); const rng = mulberry32(3);
      const out = [api.panel()];
      for(let k = 0; k < 2; k++){ NOW += 4 * 3600e3; out.push(JSON.stringify(await session(api, () => rng() < 0.8))); api.tab("today"); await tick(); out.push(api.panel()); }
      for(const id of ["p0001", "p0017", "p0040"]){ api.startPassage(PASSAGES.find(x => x.id === id)); out.push(api.panel()); }
      api.tab("progress"); await tick(); out.push(api.panel()); out.push(JSON.stringify(api.getProg()));
      return out;
    };
    const ref = await walk(mainHtml, OLD), cur = await walk(appHtml, VC);
    check(`flag off (bareByPair stripped): Today, two sessions, three Read passages, Progress and records byte-identical to ${MAIN} (${ref.join("").length} chars)`, JSON.stringify(ref) === JSON.stringify(cur), cur.findIndex((x, i) => x !== ref[i]));
    const p = OWNER ? clone(OWNER) : synth();
    const ctl = core => JSON.stringify(passageSents().map(s => core.rubyTiers(s, CHARACTERS, p, PACK_OFF, true)).concat(WORDS.slice(0, 400).map(w => core.bareWord(w, CHARACTERS, p, PACK_OFF))));
    check("core rubyTiers on every passage sentence + bareWord on 400 words byte-identical (flag off)", ctl(VC) === ctl(OLD));
  }

  console.log("\n[6] measurement on the owner export (read-only)");
  if(!OWNER) skip("owner export missing ($PAIRS_OWNER)");
  else {
    const count = (prog) => {
      const recs = VC.charRecs(prog); const us = CHARACTERS.filter(u => recs[u.id]);
      const before = us.filter(u => VC.charTier(recs[u.id].s, PACK) === "bare").length;
      const after = before + us.filter(u => VC.pairBare(recs[u.id], u, prog, PACK)).length;
      const ruby = us.filter(u => VC.charTier(recs[u.id].s, PACK) === "ruby").length;
      const st = VC.charsStarted(PACK, WORDS, CHARACTERS, prog, SENTENCES);
      let toks = 0, bOff = 0, bOn = 0;
      passageSents().forEach(s => { const a = VC.rubyTiers(s, CHARACTERS, prog, PACK_OFF, st) || [], b = VC.rubyTiers(s, CHARACTERS, prog, PACK, st) || [];
        toks += a.length; bOff += a.filter(t => t.tier === "bare").length; bOn += b.filter(t => t.tier === "bare").length; });
      return { taught: us.length, ruby, before, after, toks, bOff, bOn };
    };
    const line = (name, c) => console.log(`    ${name.padEnd(46)} units ${c.taught} taught, ${c.ruby} ruby: bare ${c.before} -> ${c.after}; passage tokens ${c.toks}: bare ${c.bOff} -> ${c.bOn} (+${c.bOn - c.bOff})`);
    const boot0 = VC.bootProg(JSON.stringify(OWNER), PACK).prog, c0 = count(boot0);
    line("as exported (no pair answered yet)", c0);
    check("as exported: no unit flips (the export predates pairs: no p on any record)", c0.after === c0.before && c0.bOn === c0.bOff);
    // Were the boot (legacy streak) counted, every ruby unit would be bare at once: the reason it is not.
    const bootFlip = CHARACTERS.filter(u => { const r = VC.charRecs(boot0)[u.id]; return r && VC.charTier(r.s, PACK) === "ruby" && VC.pairState(r, "wm", VC.pairUnitHeld(PACK)).s >= VC.BARE_PAIR; }).length;
    console.log(`    (counting the pair boot instead: ${bootFlip} of ${c0.ruby} ruby units would show bare at once)`);
    const api = await boot(PACK, clone(OWNER), 61); const rng = mulberry32(17); let n = 0;
    const res = [];
    for(let d = 0; d < 3; d++){
      for(const h of [8, 13, 20]){ NOW = new Date(2026, 9, 7 + d, h, 0, 0).getTime(); n += (await session(api, () => rng() < 0.85)).length; }
      const c = count(api.getProg()); res.push(c); line(`after day ${d + 1} (3 Today sessions a day, 85% right)`, c);
    }
    check(`simulated ${n} answers over 3 days: more units and passage tokens bare under the rule, every flip a ruby unit`, res.every(c => c.after >= c.before && c.bOn >= c.bOff) && res[res.length - 1].after > res[res.length - 1].before && res[res.length - 1].bOn > res[res.length - 1].bOff);
  }

  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})();
