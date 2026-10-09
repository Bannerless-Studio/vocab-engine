// pack.patterns (docs/PACK_SCHEMA.md "patterns"; owner 2026-10-06: grammar drills from HSK 3 with a few
// HSK 2 patterns carried in; drills, not lessons): [1] config and validator, [2] openPatterns threshold,
// [3] notePattern streak table (miss, right, retry, done), [4] patternPick (3 of 8, lowest streak, oldest,
// one per session, done refresh at half a known pair's rate), [5] patternOpts, [6] progress shape,
// [7] the app: plan line, Sentences step 3 of 8, note once and on a miss, prog.pt writes, Progress row,
// Sentences test, typed variant, [8] session resume keeps the pattern items (today.pt), [9] flag-off
// control: plans and a two-session app walk byte-identical to 1a762a3 (flag off, and flag on without
// patterns.json), [10] the owner's export opens 19 patterns, [11] patternCue "after": English hidden
// until answered (meaning tap, reveal, Sentences test, reload re-hides), flag-off walk vs 3044601. Migration of prog.pt: tests/migration_checks.js [patterns].
// Run: node tests/patterns_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, withCollapsed } = require("./lib/pack_flags.js");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "1a762a3"; // main before patterns (frequency tiers, character ramp)
const PY = process.env.PYTHON3 || "python3";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn typeof ${name} !== "undefined" ? ${name} : undefined;`)(); }
// glossStyle (fb32) changes every gloss the controls render; tests/gloss_display_checks.js covers it.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
// levelGate and levelExam (fb38) came after these controls; tests/level_gate_checks.js covers them.
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), "34c5df3", { strip: ["levelExam"] });
const PACK_OFF = (p => { const q = Object.assign({}, p); delete q.patterns; return q; })(PACK);
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
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
const OLD = mainCoreSrc ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "patterns-")), `core_${MAIN}.js`); fs.writeFileSync(f, mainCoreSrc); return require(f); })() : null;
// d3632b8: the engine before the flag collapse, whose off-paths (patterns absent, patternCue absent) the controls below pin;
// it boots withCollapsed (the live values of the collapsed keys) and shares one eta with the current side.
const BASE_SHA = "d3632b8";
const baseCoreSrc = git(BASE_SHA, "engine/core.js"), baseHtml = git(BASE_SHA, "engine/app.html");
const BASE = baseCoreSrc ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "patterns-base-")), `core_${BASE_SHA}.js`); fs.writeFileSync(f, baseCoreSrc); return require(f); })() : null;
const ETA = loadConst(path.join(ZH, "pack.js"), "PACK").eta;

// ------------------------------------------------------------------ fake DOM (copied from pairs_checks.js)
// ------------------------------------------------------------------ fake DOM (copied from words_typed_checks.js)
const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
const scriptOf = html => { const b = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; return b[b.length - 1][1]; };
function extractAttrs(tag){ const attrs = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g; let m; while((m = re.exec(tag))){ if(m[1]) attrs[m[1]] = m[2] !== undefined ? m[2] : ""; } return attrs; }
function makeFakeDom(srcHtml){
  const H = srcHtml || appHtml; // an older sha's app.html registers its own ids
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
  const tabsMatch = H.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/); const btnRe = /<button([^>]*)>/g;
  let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
  registerIdsFromHtml(H.slice(H.indexOf("<body>"), H.indexOf("<nav")));
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
  // an engine older than the flag collapse reads the collapsed keys: give it the values every live pack shipped
  if(o.core && o.core !== VC) pack = withCollapsed(pack);
  Math.random = mulberry32(seed);
  const st = o.st || { ls: memStore(), ss: memStore() }; if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog));
  const document = makeFakeDom(o.html);
  const ss = { getVoices: () => [{ lang:"zh-CN", name:"x" }], onvoiceschanged: null, cancel(){}, speak(){} };
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf(o.html || appHtml) + `
let __cur = null; const __log = [];
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; __log.push({ key: it.key, kind: "mc", label: it.label, step: todayStepState && todayStepState.at }); return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; __log.push({ key: it.key, kind: "type", label: it.label, step: todayStepState && todayStepState.at }); return __ty(it); };
return { el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML, getProg: () => prog, getD: () => D, getCur: () => __cur, log: __log,
  rd: () => (typeof RD !== "undefined" ? RD : null), skipRead: () => { RD = null; todayStep(); },
  doc: () => document, tss: () => todayStepState, ps: () => (typeof patternSession !== "undefined" ? [...patternSession] : null), home: () => todayRender(), tab: t => document.querySelector('#tabs button[data-t="' + t + '"]').click(), itemFromPlan: (p, i, plan) => itemFromPlan(p, i, plan), planItem: (p, i, plan) => planItem(p, i, plan), unitTypedFor: id => TYPED_UNITS && TYPED_UNITS.get(id) };`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","PATTERNS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"PairsChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, [], CHARACTERS, o.patterns];
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
      if(x.after) x.after(it, ok, api.panel());
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
// Synthetic progress: every word of levels upTo learned (streak s, last answered session a), session sn.
function synth(upTo, s, a, sn){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 10 }, PACK);
  p.sets = { "1": 0, "2": 0, "3": 0, "4": 0 }; p.sn = sn;
  upTo.forEach(lv => { p.sets[lv] = NS(lv); byLv[lv].forEach(w => { p.w[w.id] = { r: s + 1, w: 0, s, u: a }; }); });
  return p;
}
const patternWordIds = p => [...new Set(p.sentences.flatMap(x => x.words))];
const ids = l => l.map(p => p.id).join(",");
const ptKey = it => String(it.key).startsWith("p:");

(async () => {
  console.log("[1] config: pack.patterns on zh with pairs; patterns.json; validator");
  check("packs/zh sets patterns: true with pairs and dayAware; sentences.js carries PATTERNS", PACK.patterns === true && VC.patternsOn(PACK) && Array.isArray(PATTERNS) && PATTERNS.length === 27);
  check("patternsOn: off with patterns missing or not true (pairs / dayAware are engine default since the flag collapse)", !VC.patternsOn(PACK_OFF) && !VC.patternsOn(Object.assign({}, PACK, { patterns: "yes" })));
  const lvN = { "2": 0, "3": 0, "4": 0 }; PATTERNS.forEach(p => { lvN[p.lv]++; });
  check(`27 patterns: ${lvN["2"]} HSK 2, ${lvN["3"]} HSK 3, ${lvN["4"]} HSK 4; 6-8 sentences each; every sentence <= 14 characters`, lvN["2"] + lvN["3"] === 14 && lvN["4"] === 13 &&
    PATTERNS.every(p => p.sentences.length >= 6 && p.sentences.length <= 8) && PATTERNS.every(p => p.sentences.every(s => s.t.replace(/[，。？！]/g, "").length <= 14)));
  check("no pattern sentence repeats a sentences.json sentence", PATTERNS.every(p => p.sentences.every(s => !SENTENCES.some(x => x.t === s.t))));
  check("every pattern sentence covers its Han characters with ruby (a pron-first blank can be placed)", PATTERNS.every(p => p.sentences.every(s => VC.rubyCovers(s.t, s.ruby.map(k => ({ start: k[0], end: k[1] }))))));
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patterns-val-"));
    const run = (pk, pt, drop) => { const d = path.join(tmp, String(Math.random()).slice(2)); fs.mkdirSync(d); for(const f of fs.readdirSync(ZH)) if(f.endsWith(".json")) fs.copyFileSync(path.join(ZH, f), path.join(d, f));
      const pj = JSON.parse(fs.readFileSync(path.join(d, "pack.json"), "utf8")); if(pk) pk(pj); fs.writeFileSync(path.join(d, "pack.json"), JSON.stringify(pj));
      const tj = JSON.parse(fs.readFileSync(path.join(d, "patterns.json"), "utf8")); if(pt) pt(tj); fs.writeFileSync(path.join(d, "patterns.json"), JSON.stringify(tj));
      if(drop) fs.unlinkSync(path.join(d, "patterns.json"));
      cp.execSync(`${PY} "${path.join(ROOT, "tools", "jsonify_pack.py")}" "${d}"`, { stdio: "ignore" });
      try { const out = cp.execSync(`${PY} "${path.join(ROOT, "tools", "validate_pack.py")}" "${d}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return /WARN {2}patterns/.test(out) ? out : ""; } catch(e){ return String(e.stdout || "") + String(e.stderr || ""); } };
    check("validate_pack: zh as shipped passes", run() === "");
    check("validate_pack: patterns not a boolean is an error", /pack\.patterns must be a boolean/.test(run(p => { p.patterns = 1; })));
    check("validate_pack: patterns on without patterns.json is an error", /patterns\.json is missing/.test(run(null, null, true)));
    check("validate_pack: patterns.json without the flag warns", /patterns\.json present but pack\.patterns is not true/.test(run(p => { delete p.patterns; })));
    check("validate_pack: a key not in the pattern's words is an error", /keys must list word ids/.test(run(null, t => { t[0].keys = ["w9999"]; })));
    check("validate_pack: a sentence id repeated across patterns is an error", /unique across patterns\.json/.test(run(null, t => { t[1].sentences[0].id = t[0].sentences[0].id; })));
    check("validate_pack: a duplicated pattern id is an error", /id p01 duplicated/.test(run(null, t => { t[1].id = "p01"; })));
    check("validate_pack: a mark past the end of t is an error", /marks \[2, 99\]/.test(run(null, t => { t[0].sentences[0].marks = [[2, 99]]; })));
    check("validate_pack: overlapping or unsorted marks are an error", /must be \[start, end\] UTF-16 offsets/.test(run(null, t => { t[3].sentences[0].marks = [[5, 7], [0, 2]]; })));
    check("validate_pack: a mark splitting a ruby token is an error", /splits a ruby token/.test(run(null, t => { t[3].sentences[0].marks = [[0, 1]]; })));
    check("validate_pack: an unknown word id is an error", /words has unknown ids \['w9999'\]/.test(run(null, t => { t[0].sentences[0].words.push("w9999"); })));
    check("validate_pack: a word above the pattern's level is an error", /are above the pattern's level 2/.test(run(null, t => { t[0].sentences[0].words.push(WORDS.find(w => w.lv === "4").id); })));
    check("validate_pack: patterns out of level order is an error", /comes after a higher-level pattern/.test(run(null, t => { const x = t.pop(); t.unshift(x); })));
    check("validate_pack: a note line over 60 characters is an error", /note line over 60/.test(run(null, t => { t[0].note[0] = "x".repeat(61); })));
    check("validate_pack: a three-line note is an error", /note must be a list of one or two/.test(run(null, t => { t[0].note.push("third"); })));
    check("validate_pack: near naming no pattern is an error", /near must list other pattern ids/.test(run(null, t => { t[0].near = ["p99"]; })));
    check("validate_pack: patternCue other than \"after\" is an error", /pack\.patternCue must be "after"/.test(run(p => { p.patternCue = "before"; })));
    check("validate_pack: patternCue without patterns warns", /pack\.patternCue without pack\.patterns/.test(run(p => { delete p.patterns; })));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n[2] openPatterns: open at >= 80% of a pattern's distinct sentence words learned (a record exists)");
  {
    const p = PATTERNS[0], ws = [...new Set(p.sentences.flatMap(s => s.words))], need = Math.ceil(0.8 * ws.length);
    const prog = id => { const q = synth([], 0, 0, 5); ws.slice(0, id).forEach(w => { q.w[w] = { r: 1, w: 0, s: 0 }; }); return q; };
    console.log(`    ${p.id} ${p.label}: ${ws.length} distinct words, opens at ${need}`);
    check(`${p.id} closed at ${need - 1} of ${ws.length} learned, open at ${need}`, !VC.openPatterns(prog(need - 1), PACK, [p], WORDS).length && VC.openPatterns(prog(need), PACK, [p], WORDS).length === 1);
    check("flag off (pack without patterns): nothing opens", !VC.openPatterns(prog(ws.length), PACK_OFF, [p], WORDS).length);
    {
      // keys and level gate: p = first pattern, its own words (keys) and the level reached
      const k = PATTERNS.find(x => (x.keys || []).length), kws = patternWordIds(k);
      const full = () => { const q = synth([], 0, 0, 5); kws.forEach(w => { q.w[w] = { r: 1, w: 0, s: 0 }; }); return q; };
      const noKey = full(); k.keys.forEach(id => { delete noKey.w[id]; });
      check(`${k.id} keys ${k.keys.join(",")} unlearned: closed with every other word learned; opens once learned`, !VC.openPatterns(noKey, PACK, [k], WORDS).length && VC.openPatterns(full(), PACK, [k], WORDS).length === 1);
      const k4 = PATTERNS.filter(x => x.lv === "4")[0], w4 = patternWordIds(k4), l4 = new Set(WORDS.filter(x => x.lv === "4").map(x => x.id));
      const lowOnly = () => { const q = synth(["1", "2", "3"], 2, 4, 5); return q; };
      const q0 = lowOnly(); w4.forEach(id => { if(!l4.has(id)) q0.w[id] = q0.w[id] || { r: 1, w: 0, s: 0 }; });
      const zeroL4 = Object.keys(q0.w).filter(id => l4.has(id)).length === 0 && w4.filter(id => !l4.has(id)).length >= 0.8 * w4.length;
      console.log(`    ${k4.id}: ${w4.filter(id => !l4.has(id)).length} of ${w4.length} words below L4`);
      check(`${k4.id} (HSK 4): >= 80% of words learned, zero L4 words learned: closed`, zeroL4 && !VC.openPatterns(q0, PACK, [k4], WORDS).length);
      const q1 = clone(q0); q1.w[[...l4][0]] = { r: 1, w: 0, s: 0 }; (k4.keys || []).forEach(id => { q1.w[id] = { r: 1, w: 0, s: 0 }; });
      check(`${k4.id} opens after its key words and a first L4 word`, VC.openPatterns(q1, PACK, [k4], WORDS).length === 1);
      const g = PATTERNS.find(x => x.label === "了 vs 过"), g4 = WORDS.find(x => x.w === "过");
      const qg = synth(["1"], 2, 4, 5); patternWordIds(g).forEach(id => { if(id !== g4.id) qg.w[id] = qg.w[id] || { r: 1, w: 0, s: 0 }; });
      check(`${g.id} (HSK ${g.lv}) has the mark word 过 (L${g4.lv}) in no keys; opens with the level reached and the other 80%+ words learned`, g.lv === "2" && g4.lv === "4" && !g.keys.includes(g4.id) && !qg.w[g4.id] && VC.openPatterns(qg, PACK, [g], WORDS).length === 1);
      check("without the words argument nothing opens (level unknown)", !VC.openPatterns(full(), PACK, [k]).length);
    }
    const o12 = VC.openPatterns(synth(["1", "2"], 2, 4, 5), PACK, PATTERNS, WORDS), o4 = VC.openPatterns(synth(["1", "2", "3", "4"], 2, 4, 5), PACK, PATTERNS, WORDS);
    console.log(`    HSK 1-2 learned: ${o12.length} open (${ids(o12)}); everything learned: ${o4.length}`);
    check("HSK 1-2 learned opens every HSK 2 pattern; everything learned opens all 27", PATTERNS.filter(p => p.lv === "2").every(p => o12.includes(p)) && o4.length === 27);
    const st = VC.patternStats(synth(["1", "2"], 2, 4, 5), PACK, PATTERNS, WORDS);
    check("patternStats: done 0, open as openPatterns, total 27", st.done === 0 && st.open === o12.length && st.total === 27);
  }

  console.log("\n[3] notePattern: miss -> 0, right -> +1, a retry in the same session gains nothing, done at 3");
  {
    const T = [];
    const run = (s0, a0, ok, sn) => { const q = { pt: s0 == null ? undefined : { p01: { s: s0, a: a0 } } }; const r = VC.notePattern(q, "p01", ok, sn); return [r.s, r.a]; };
    const rows = [["never answered, right", null, null, true, 7, [1, 7]], ["never answered, miss", null, null, false, 7, [0, 7]], ["s 1 (session 5), right in 7", 1, 5, true, 7, [2, 7]],
      ["s 2, right in 7: done", 2, 5, true, 7, [3, 7]], ["s 3 done, miss", 3, 5, false, 7, [0, 7]], ["s 3 done, right", 3, 5, true, 7, [4, 7]],
      ["retry: answered (miss) in 7, right in 7", 0, 7, true, 7, [0, 7]], ["retry: answered (right) in 7, right again", 2, 7, true, 7, [2, 7]], ["retry, miss", 2, 7, false, 7, [0, 7]]];
    rows.forEach(r => { const got = run(r[1], r[2], r[3], r[4]); T.push(`    ${r[0].padEnd(44)} -> s ${got[0]}, a ${got[1]}`); check(`notePattern: ${r[0]}`, got[0] === r[5][0] && got[1] === r[5][1], JSON.stringify(got)); });
    console.log(T.join("\n"));
    check("PATTERN_DONE is 3 (the known-pair streak)", VC.PATTERN_DONE === 3 && VC.PAIR_KNOWN === 3);
    const q = { pt: "x" }; VC.notePattern(q, "p02", true, 3);
    check("a malformed prog.pt reads as never answered and is replaced on the first answer", VC.patternState({ pt: { p01: { s: "2", a: 1 } } }, "p01").fresh && q.pt.p02.s === 1);
  }

  console.log("\n[4] patternPick: 3 of 8, lowest streak, then oldest (never asked first), one per session, done at half a known pair's rate");
  {
    const P = PATTERNS.slice(0, 8);
    const pr = pt => ({ pt });
    check("patternCount: 3 of 8 (Sentences step), 8 of 20 (Sentences test)", VC.patternCount(8) === 3 && VC.patternCount(20) === 8);
    check("all never asked: pack order", ids(VC.patternPick(P, pr({}), 3, 9)) === "p01,p02,p03");
    const a = pr({ p01: { s: 2, a: 8 }, p02: { s: 0, a: 7 }, p03: { s: 1, a: 3 }, p04: { s: 0, a: 4 } });
    check("lowest streak first, then oldest; at equal streak an asked (missed) one before a never-asked one", ids(VC.patternPick(P, a, 3, 9)) === "p04,p02,p05" && ids(VC.patternPick(P.slice(0, 4), a, 3, 9)) === "p04,p02,p03");
    check("a pattern answered in the plan's session is not asked again in it", ids(VC.patternPick(P.slice(0, 4), a, 3, 7)) === "p04,p03,p01");
    check("ids already planned this session (skip) are left out", ids(VC.patternPick(P.slice(0, 4), a, 3, 9, new Set(["p04"]))) === "p02,p03,p01");
    const d = pr({ p01: { s: 3, a: 2 }, p02: { s: 4, a: 1 }, p03: { s: 0, a: 8 }, p04: { s: 1, a: 8 }, p05: { s: 2, a: 8 }, p06: { s: 0, a: 7 } });
    const P6 = P.slice(0, 6);
    check("done patterns refresh one slot on an even session, oldest first", ids(VC.patternPick(P6, d, 3, 10)) === "p06,p03,p02");
    check("and none on an odd session", ids(VC.patternPick(P6, d, 3, 9)) === "p06,p03,p04");
    check("done patterns fill the slots open ones leave", ids(VC.patternPick(P.slice(0, 3), d, 3, 9)) === "p03,p02,p01");
    let asked = 0; for(let sn = 11; sn <= 30; sn++) asked += VC.patternPick(P6, d, 3, sn).filter(p => ["p01", "p02"].includes(p.id)).length;
    check(`over 20 sessions with 4 open patterns not done, done ones get ${asked} slots (one every second session)`, asked === 10);
    check("patternMarkIndex: several marks take turns by session", VC.patternMarkIndex({ marks: [[0, 2], [5, 7]] }, 8) === 0 && VC.patternMarkIndex({ marks: [[0, 2], [5, 7]] }, 9) === 1 && VC.patternMarkIndex({ marks: [[0, 1]] }, 9) === 0);
  }

  console.log("\n[5] patternOpts: own other marks first, then same length; never the answer or a near pattern's mark");
  {
    const byId = id => PATTERNS.find(p => p.id === id);
    let bad = [];
    PATTERNS.forEach(p => p.sentences.forEach(s => s.marks.forEach((m, mi) => {
      for(let k = 0; k < 4; k++){
        const ans = VC.patternMarkText(s, m), o = VC.patternOpts(p, s, mi, PATTERNS, Math.random);
        const nearT = new Set((p.near || []).flatMap(id => byId(id).sentences.flatMap(x => x.marks.map(mm => VC.patternMarkText(x, mm)))));
        const own = new Set(p.sentences.flatMap(x => x.marks.map(mm => VC.patternMarkText(x, mm))));
        if(o.length !== 3 || new Set(o).size !== 3 || o.includes(ans) || o.some(x => nearT.has(x) && !own.has(x))) bad.push(`${s.id} ${o}`);
      }
    })));
    check("every mark of every sentence: 3 distinct wrong choices, never the answer, never a near pattern's mark", bad.length === 0, bad.slice(0, 5).join("\n"));
    const p14 = PATTERNS.find(x => x.label === "了 vs 过"), s14 = p14.sentences.find(x => x.marks.some(m => VC.patternMarkText(x, m) === "过")), m14 = s14.marks.findIndex(m => VC.patternMarkText(s14, m) === "过");
    check("了 vs 过: the blank 过 always offers 了 (the pattern's own other mark)", Array.from({ length: 10 }, () => VC.patternOpts(p14, s14, m14, PATTERNS, Math.random)).every(o => o.includes("了")));
    const p20 = byId("p20"), o20 = Array.from({ length: 30 }, () => VC.patternOpts(p20, p20.sentences[0], 0, PATTERNS, Math.random)).flat();
    check("即使: never 如果, 虽然, 不管 or 既然 (near)", !o20.some(x => ["如果", "虽然", "不管", "既然"].includes(x)));
  }

  console.log("\n[6] progress shape: prog.pt is additive; validateProgShape accepts it");
  {
    const p = synth(["1"], 1, 2, 3); p.pt = { p01: { s: 2, a: 3 } };
    const raw = JSON.stringify(p), b = VC.bootProg(raw, PACK);
    check("a record with pt boots here unchanged (no backup) and validateProgShape accepts it", b.backupRaw === null && JSON.stringify(b.prog.pt) === JSON.stringify(p.pt) && VC.validateProgShape(p, ["1", "2", "3", "4"]).ok);
    const odd = clone(p); odd.pt = "x";
    const ob = VC.bootProg(JSON.stringify(odd), PACK);
    check("a malformed pt never resets progress (no backup)", ob.backupRaw === null && ob.prog.pt === "x");
    check("defaultProg has no pt (written only on a pattern answer)", !("pt" in VC.defaultProg(PACK)));
  }

  console.log("\n[7] the app with patterns (HSK 1-2 learned)");
  {
    const base = synth(["1", "2"], 2, 4, 5);
    const open = VC.openPatterns(base, PACK, PATTERNS, WORDS);
    let api = await boot(PACK, clone(base), 11, { patterns: PATTERNS });
    check("Today plan row: Sentences · 3 patterns (app v2: no item count)", /<div class="tst"><span>Sentences<\/span><div class="tsd">3 patterns<\/div>/.test(api.panel()), (api.panel().match(/<span>Sentences<\/span><div class="tsd">[^<]*/) || [""])[0]);
    const notes = []; let firstMiss = 0;
    const rows = await session(api, (it, rec, rows, step) => {
      if(ptKey(it)) notes.push({ key: it.key, note: /class="pnote"/.test(api.panel()), step });
      return !(ptKey(it) && notes.filter(n => n.key === it.key).length === 1 && it.key === notes[0].key);
    }, { after: (it, ok, h) => { if(ptKey(it) && !ok && !firstMiss) firstMiss = (api.el("rv").innerHTML.match(/class="pnote"/g) || []).length; } });
    const s4 = rows.filter(r => r.step === 4), pts = s4.filter(r => ptKey(r));
    const firstAsk = [...new Map(pts.map(r => [r.key, r])).values()];
    console.log(`    Sentences step: ${s4.length} answers, pattern asks ${pts.map(r => r.key + (r.ok ? "" : " (miss)")).join(", ")}`);
    check("Sentences step: 8 items, 3 of them patterns (lowest-first: the first open patterns in pack order)", firstAsk.length === 3 && new Set(s4.map(r => r.key)).size === 8 && firstAsk.map(r => r.key.slice(2)).sort().join(",") === ids(open.slice(0, 3)));
    check("no pattern item outside the Sentences step", rows.filter(r => ptKey(r) && r.step !== 4).length === 0);
    check("pattern items are cloze choices on a blank (What's the missing word?)", pts.every(r => r.kind === "mc" && r.label === "What's the missing word?"));
    const pr = api.getProg();
    const miss = notes[0].key.slice(2);
    check("no pattern question carries the note before the answer, first meeting included (fb44: it names the answer)", notes.length === 4 && notes.every(n => !n.note));
    check("a miss at first meeting shows the note once, with the verdict", firstMiss === 1, `${firstMiss} notes on screen after the miss`);
    check("prog.pt written for the 3 asked patterns: the missed one s 0 (retry gains nothing), the others s 1, a = this session", Object.keys(pr.pt).length === 3 && pr.pt[miss].s === 0 && Object.keys(pr.pt).filter(k => k !== miss).every(k => pr.pt[k].s === 1) && Object.values(pr.pt).every(e => e.a === pr.sn));
    check("session record kept the planned ids (today.pt) while the step ran", api.ps().length === 3);
    // Miss verdict shows the note: build the item fresh and answer it wrong.
    api.tab("today"); await tick();
    api.el("go").click(); await tick();
    let sawMissNote = false, sawNoteStim = false, pt2 = [];
    for(let g = 0; g < 400; g++){
      const D = api.getD(), h = api.panel();
      if(D && D.cur){ const it = api.getCur(); const isP = ptKey(it), first = isP && !pt2.includes(it.key); if(isP){ pt2.push(it.key); if(/class="pnote"/.test(h) && pr.pt[it.key.slice(2)]) sawNoteStim = true; }
        answer(api, !first); if(first && /class="pnote"/.test(it.reveal)) sawMissNote = true; api.el("nx").click(); continue; }
      if(api.rd()){ api.skipRead(); continue; }
      if(/id="ok"/.test(h)){ api.el("ok").click(); continue; }
      if(/id="dr"/.test(h)){ api.el("dr").click(); continue; }
      break;
    }
    const pr2 = api.getProg(), uniq2 = [...new Set(pt2)];
    console.log(`    second session pattern asks: ${uniq2.join(", ")}`);
    check("second session: 3 patterns, lowest streak first: the one missed last session (s 0) before never-asked ones; no note on the stimulus of a recorded pattern", uniq2.length === 3 && uniq2.slice().sort().join(",") === ["p:" + miss, "p:p04", "p:p05"].sort().join(",") && !sawNoteStim, uniq2.join(","));
    check("a miss shows the note with the verdict (reveal)", sawMissNote);
    check("misses set s 0", uniq2.every(k => pr2.pt[k.slice(2)].s === 0));
    api.tab("progress"); await tick();
    const st = VC.patternStats(pr2, PACK, PATTERNS, WORDS);
    api.el("pvAll").click(); // app v2: each level row carries "patterns done of open" under Show all
    const pparts = [...api.panel().matchAll(/patterns (\d+) of (\d+)/g)], psum = pparts.reduce((a, m) => [a[0] + +m[1], a[1] + +m[2]], [0, 0]);
    check(`Progress level rows: patterns ${psum[0]} done of ${psum[1]} open over ${pparts.length} levels = patternStats ${st.done} / ${st.open}`, pparts.length > 0 && psum[0] === st.done && psum[1] === st.open);
    // Sentences test: 8 of 20 pattern items.
    api.tab("test"); await tick();
    const tb = api.el("tSentences");
    if(tb){ tb.click(); const D = api.getD(); const all = [D.cur, ...D.q].filter(Boolean);
      check(`Sentences test: ${all.filter(ptKey).length} pattern items of ${all.length}`, all.length === 20 && all.filter(ptKey).length === Math.min(8, open.length)); }
    else skip("Sentences test button absent");
  }
  {
    // Typed variant: a pack typing its sentence blanks (TYPING) gets typed pattern items.
    const P2 = Object.assign({}, PACK, { typing: {} });
    const api = await boot(P2, synth(["1", "2"], 2, 4, 5), 12, { patterns: PATTERNS });
    const kinds = [], checks = [];
    await session(api, it => { if(ptKey(it)){ kinds.push(it.kind); if(it.kind === "type"){ const fb = it.choiceFallback(); checks.push(it.check(fb.a) && !it.check(fb.opts.find(o => o !== fb.a)) && fb.kind === "mc" && fb.opts.length === 4); } } return true; });
    check("a pack typing its sentence blanks gets typed pattern items; the typed answer is the mark text; the choice counterpart has 4 options", kinds.length >= 3 && kinds.every(k => k === "type") && checks.length >= 3 && checks.every(Boolean));
  }

  console.log("\n[8] session resume: a parked Sentences step keeps its pattern items (today.pt)");
  {
    const st = { ls: memStore(), ss: memStore() };
    let api = await boot(PACK, synth(["1", "2"], 2, 4, 5), 21, { patterns: PATTERNS, st });
    let before = null;
    await session(api, () => true, { stop: (rows, it) => { const D = api.getD(); if(api.log[api.log.length - 1].step === 4 && rows.filter(r => r.step === 4).length === 2){ before = [D.cur, ...D.q].map(x => x.key).sort(); return true; } return false; } });
    const ps0 = api.ps();
    const api2 = await boot(PACK, null, 22, { patterns: PATTERNS, st });
    const D2 = api2.getD(); const after = D2 ? [D2.cur, ...D2.q].filter(Boolean).map(x => x.key).sort() : [];
    check("reload mid-step: the same items come back, pattern items included", before && JSON.stringify(after) === JSON.stringify(before) && after.filter(k => k.startsWith("p:")).length >= 2);
    check("today.pt restored (the planned pattern ids)", JSON.stringify(api2.ps().sort()) === JSON.stringify(ps0.sort()) && ps0.length === 3);
    const cur = api2.getCur(); const it = cur && ptKey(cur) ? cur : null;
    const rest = await session(api2, () => true, { cont: true });
    check("the resumed step finishes with 8 distinct items", new Set(rest.filter(r => r.step === 4).map(r => r.key).concat(before ? [] : [])).size >= 6);
  }

  console.log("\n[12] the note rides with the verdict (fb44; owner 2026-10-08: the note named the answer before it was given)");
  {
    const NOTE = /class="pnote"/;
    const base = synth(["1", "2"], 2, 4, 5);
    const open = VC.openPatterns(base, PACK, PATTERNS, WORDS);
    // Every open pattern recorded (s 1): the first pattern asked is answered right (later right), the second wrong (later miss).
    const seeded = clone(base); seeded.pt = {}; open.forEach(pp => { seeded.pt[pp.id] = { s: 1, a: 0 }; });
    const api = await boot(PACK, seeded, 51, { patterns: PATTERNS });
    const got = [], seenKeys = [];
    await session(api, it => { if(!ptKey(it)) return true; if(!seenKeys.includes(it.key)) seenKeys.push(it.key); return seenKeys.indexOf(it.key) !== 1; },
      { after: (it, ok, h) => { if(ptKey(it) && !got.some(g => g.key === it.key)) got.push({ key: it.key, ok, verdictNote: NOTE.test(api.el("rv").innerHTML), stimNote: NOTE.test(it.html) }); } });
    console.log(`    recorded: ${got.map(g => g.key + ":" + (g.ok ? "right" : "miss") + (g.verdictNote ? "+note" : "")).join(" ")}`);
    check("later right (recorded pattern): no note, none on the question", got[0] && got[0].ok && !got[0].verdictNote && !got[0].stimNote);
    check("later miss: the note with the verdict, none on the question", got[1] && !got[1].ok && got[1].verdictNote && !got[1].stimNote);
    const api1 = await boot(PACK, clone(base), 57, { patterns: PATTERNS }); const g1 = [];
    await session(api1, () => true, { after: (it, ok, h) => { if(ptKey(it) && !g1.some(g => g.key === it.key)) g1.push({ key: it.key, ok, verdictNote: NOTE.test(api1.el("rv").innerHTML), stimNote: NOTE.test(it.html) }); } });
    check("first meeting, right: the note with the verdict, none on the question", g1.length >= 3 && g1.every(g => g.ok && g.verdictNote && !g.stimNote));
    // First meeting, wrong, in a fresh run.
    const api2 = await boot(PACK, clone(base), 52, { patterns: PATTERNS }); const g2 = {};
    await session(api2, it => !ptKey(it), { after: (it, ok, h) => { if(ptKey(it) && !g2[it.key]) g2[it.key] = { n: (api2.el("rv").innerHTML.match(/class="pnote"/g) || []).length, stim: NOTE.test(it.html) }; } });
    check("first meeting, wrong: the note once with the verdict, none on the question", Object.keys(g2).length >= 3 && Object.values(g2).every(x => x.n === 1 && !x.stim));
    // The retry of a first-meeting miss in the same drill is no longer a first meeting: a right retry shows no note.
    const api3 = await boot(PACK, clone(base), 53, { patterns: PATTERNS }); const seq = {};
    await session(api3, (it) => { if(!ptKey(it)) return true; const k = it.key; seq[k] = (seq[k] || []); return seq[k].length > 0; }, { after: (it, ok, h) => { if(ptKey(it)) seq[it.key].push({ ok, note: NOTE.test(it.reveal) }); } });
    const retried = Object.values(seq).filter(a => a.length > 1);
    check("miss then right retry in one session: note on the miss, none on the retry", retried.length >= 1 && retried.every(a => !a[0].ok && a[0].note && a[1].ok && !a[1].note), JSON.stringify(retried));
    // fb53: the English cue on the retry. First ask open, retry the tap link only (item html was built once).
    const api5 = await boot(PACK, clone(base), 53, { patterns: PATTERNS }); const cue = {};
    await session(api5, (it) => { if(!ptKey(it)) return true; const k = it.key; cue[k] = cue[k] || []; const h = api5.panel(); cue[k].push({ open: /<div class="q cue">[^<]+<\/div>/.test(h), tap: /data-pcue=/.test(h) }); return cue[k].length > 1; });
    const cr = Object.values(cue).filter(a => a.length > 1);
    check("fb53: first-meeting miss then retry: English open on the first ask, tap link only on the retry", cr.length >= 1 && cr.every(a => a[0].open && !a[0].tap && !a[1].open && a[1].tap), JSON.stringify(cr));
    // Sentences test: same rule.
    const api4 = await boot(PACK, clone(base), 54, { patterns: PATTERNS });
    api4.tab("test"); await tick();
    const tb = api4.el("tSentences");
    if(tb){ tb.click(); const D = api4.getD(); const pts = [D.cur, ...D.q].filter(Boolean).filter(ptKey);
      check(`Sentences test: ${pts.length} pattern questions carry no note`, pts.length >= 3 && pts.every(it => !NOTE.test(it.html)) && !NOTE.test(api4.panel()));
      const cur = api4.getCur(); let first = null;
      if(cur && ptKey(cur)){ first = cur; answer(api4, true); }
      check("Sentences test: a first-meeting right answer shows the note with the verdict", !!first && NOTE.test(api4.el("rv").innerHTML));
    } else skip("Sentences test button absent");
    // Resume mid-cloze: the question still has no note; the first-meeting verdict still has it.
    const st = { ls: memStore(), ss: memStore() };
    const a1 = await boot(PACK, clone(base), 55, { patterns: PATTERNS, st });
    await session(a1, () => true, { stop: (rows, it) => ptKey(it) });
    const a2 = await boot(PACK, null, 56, { patterns: PATTERNS, st }), c2 = a2.getCur();
    check("reload mid-cloze: no note on the question", !!c2 && ptKey(c2) && !NOTE.test(a2.panel()) && !NOTE.test(c2.html));
    if(c2 && ptKey(c2)){ answer(a2, true); check("reload mid-cloze: the first-meeting verdict carries the note", NOTE.test(a2.el("rv").innerHTML)); }
  }

  console.log(`\n[9] flag-off control vs ${BASE_SHA} (the engine before the flag collapse, booted withCollapsed)`);
  if(!BASE || !baseHtml) check(`${BASE_SHA} engine loaded from git (a missing sha is a failure)`, false);
  else {
    const walk = async (pack, html, core, pats) => {
      const api = await boot(Object.assign({}, pack, { eta: ETA }), synth(["1", "2"], 2, 4, 5), 31, { html, core, patterns: pats });
      const out = [api.panel()];
      for(let k = 0; k < 2; k++){ out.push(JSON.stringify(await session(api, (it, rec, rows) => rows.length % 3 !== 1))); out.push(api.panel()); api.tab("today"); await tick(); out.push(api.panel()); }
      api.tab("progress"); await tick(); out.push(api.panel());
      return out;
    };
    const ref = await walk(PACK_OFF, baseHtml, BASE, undefined);
    const off = await walk(PACK_OFF, appHtml, VC, PATTERNS);
    check(`flag off (pack.patterns absent, PATTERNS present): two-session walk byte-identical to ${BASE_SHA}`, JSON.stringify(off) === JSON.stringify(ref), off.findIndex((x, i) => x !== ref[i]));
    const nofile = await walk(PACK, appHtml, VC, undefined);
    const refOn = await walk(PACK, baseHtml, BASE, undefined);
    check(`flag on without patterns.json: byte-identical to ${BASE_SHA}`, JSON.stringify(nofile) === JSON.stringify(refOn), nofile.findIndex((x, i) => x !== refOn[i]));
    const ctl = (core, pack) => { const p = synth(["1", "2", "3"], 2, 4, 9); return JSON.stringify([core.buildReviewPlan(VC.learnedWords(WORDS, pack, p), p, pack, { canHear: () => true, today: "2026-10-05", rng: mulberry32(4), sn: 10 }).map(x => [x.kind, x.word && x.word.id]), core.validateProgShape(p, ["1", "2", "3", "4"]).ok]); };
    check("core plans unchanged (Review plan, validateProgShape)", ctl(VC, PACK) === ctl(BASE, withCollapsed(PACK)));
  }

  console.log("\n[10] the owner's export (a48ee4d3, read-only; $PAIRS_OWNER overrides) under this pack");
  {
    const f = [process.env.PAIRS_OWNER, "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json"].find(x => x && fs.existsSync(x));
    if(!f) skip("owner export missing");
    else {
      const b = VC.bootProg(fs.readFileSync(f, "utf8"), PACK), op = VC.openPatterns(b.prog, PACK, PATTERNS, WORDS);
      console.log(`    open: ${op.map(p => p.id).join(" ")}`);
      check("owner export boots with no backup and opens 19 of the 27 patterns (records only: word order and tiers do not count)", b.backupRaw === null && op.length === 19, op.length);
    }
  }

  console.log("\n[11] pack.patternCue \"after\" (fb31; owner 2026-10-07: the English cue gave the blank away)");
  {
    const esc = VC.escapeHtml; // the app's own escaper (fb33's rewritten sentences carry apostrophes)
    const ENS = new Set(PATTERNS.flatMap(p => p.sentences.map(x => x.en)));
    check("zh pack sets patternCue \"after\"", PACK.patternCue === "after");
    const api = await boot(PACK, synth(["1", "2"], 2, 4, 5), 41, { patterns: PATTERNS });
    const seen = [];
    await session(api, (it, rec, rows) => {
      // App v2 (engine default since the flag collapse): a later meeting hides the English behind "Show meaning" (data-pcue);
      // a first meeting shows it open in the cue block (fb51).
      if(ptKey(it)){ const h = api.panel(), m = h.match(/data-pcue="([^"]*)"/), o = h.match(/<div class="q cue">([^<]+)<\/div>/), en = m ? m[1] : o ? o[1] : null;
        seen.push({ it, en, open: !!o, note: /class="pnote"/.test(h), cueBefore: !!m && h.includes(`>${m[1]}<`), hasBtn: /<button type="button" class="showw"[^>]*data-pcue="[^"]*"[^>]*>Show meaning<\/button>/.test(h) }); }
      return rows.length % 4 !== 2; });
    check(`pattern items (${seen.length}, ${seen.filter(x => x.open).length} first meetings): a later meeting carries a "Show meaning" tap and no English before the answer; a first meeting shows the English open, no tap`, seen.length >= 3 && seen.every(x => x.en && (x.open ? !x.hasBtn : x.hasBtn && !x.cueBefore))); // a first session meets every pattern for the first time; the Sentences test below covers met ones
    check("the tap's English is the item's own sentence", seen.every(x => [...ENS].some(e => esc(e) === x.en)));
    check("the English is in the reveal after the answer (right and wrong)", seen.every(x => String(x.it.reveal).includes(x.en)));
    check("the two-line note is not on the question at first meeting (it rides with the verdict, [12])", seen.length >= 3 && seen.every(x => !x.note));
    // The tap: the panel's capture listener swaps the button for the English; nothing is recorded.
    const ls = (api.el("panel")._listeners.click || []);
    const btn = { dataset: { pcue: "He is taller than me." }, replaceWith(x){ this.by = x; } }, doc = api.doc(), mk = doc.createElement;
    let focused = null; doc.createElement = t => { const e = mk.call(doc, t); e.focus = () => { focused = e; }; return e; }; doc.activeElement = btn;
    const before = JSON.stringify(api.getProg()), ss0 = JSON.stringify(api.st.ss.keys().map(k => api.st.ss.getItem(k)));
    let prevented = 0;
    ls.forEach(f => f({ target: { closest: sel => sel === "[data-pcue]" ? btn : null }, preventDefault(){ prevented++; }, stopPropagation(){} }));
    doc.createElement = mk;
    check("tapping \"meaning\" shows the English in place, keyboard focus on it (tabindex -1, as show written); no progress or session write", btn.by && btn.by.innerHTML === "He is taller than me." && btn.by.getAttribute("tabindex") === "-1" && focused === btn.by && prevented === 1 && JSON.stringify(api.getProg()) === before && JSON.stringify(api.st.ss.keys().map(k => api.st.ss.getItem(k))) === ss0);
    check("announce() leaves the meaning button out of the live-region text", /querySelectorAll\("\[data-showw\],\[data-pcue\]"\)/.test(appHtml));
    api.tab("test"); await tick();
    const tb = api.el("tSentences");
    if(tb){ tb.click(); const D = api.getD(); const pts = [D.cur, ...D.q].filter(Boolean).filter(ptKey);
      const ptRec = api.getProg().pt || {}, hid = it => /data-pcue=/.test(it.html), opn = it => /<div class="q cue">[^<]/.test(it.html);
      check(`Sentences test: pattern items (${pts.length}): met ones hide the English behind the tap (${pts.filter(hid).length}), first meetings show it open`, pts.length >= 3 && pts.some(hid) && pts.every(it => ptRec[it.key.slice(2)] ? hid(it) && !opn(it) : opn(it) && !hid(it))); }
    else skip("Sentences test button absent");
    // Reload mid-cloze: the item comes back with the English hidden again (the tap is not kept).
    const st = { ls: memStore(), ss: memStore() };
    const a1 = await boot(PACK, synth(["1", "2"], 2, 4, 5), 42, { patterns: PATTERNS, st });
    await session(a1, () => true, { stop: (rows, it) => ptKey(it) });
    const a2 = await boot(PACK, null, 43, { patterns: PATTERNS, st }), c2 = a2.getCur();
    { const met = !!((a2.getProg().pt || {})[c2 && c2.key.slice(2)]), h2 = a2.panel();
      check(`reload mid-cloze: the pattern item resumes as it was (${met ? "met: English hidden behind the tap" : "first meeting: English open"})`, !!c2 && ptKey(c2) && (met ? /data-pcue=/.test(h2) && !/<div class="q cue">[^<]/.test(h2) : /<div class="q cue">[^<]/.test(h2) && !/data-pcue=/.test(h2))); }
    // Without the field: the English shows above the options, as before.
    const P0 = Object.assign({}, PACK); delete P0.patternCue;
    const b = await boot(P0, synth(["1", "2"], 2, 4, 5), 41, { patterns: PATTERNS }); const off = [];
    await session(b, (it, rec, rows) => { if(ptKey(it)) off.push(b.panel()); return rows.length % 4 !== 2; });
    check("patternCue absent: no meaning tap; the English cue shows before the answer", off.length >= 3 && off.every(h => !/data-pcue/.test(h) && /<div class="q cue">[^<]/.test(h)));
  }
  if(!BASE || !baseHtml) check(`${BASE_SHA} engine loaded from git (a missing sha is a failure)`, false);
  else {
    // patternCue absent (and the rest of the pack as the suite boots it): two-session walk + Sentences test against the pre-collapse engine.
    const walk = async (html, core) => {
      const api = await boot(Object.assign({}, packAsOf(PACK, "3044601"), { eta: ETA }), synth(["1", "2"], 2, 4, 5), 31, { html, core, patterns: PATTERNS }); // 3044601: patternCue and characters.bareByPair stripped
      const out = [api.panel()];
      for(let k = 0; k < 2; k++){ out.push(JSON.stringify(await session(api, (it, rec, rows) => rows.length % 3 !== 1))); out.push(api.panel()); api.tab("today"); await tick(); out.push(api.panel()); }
      api.tab("test"); await tick(); const tb = api.el("tSentences"); if(tb){ tb.click(); const D = api.getD(); out.push([D.cur, ...D.q].filter(Boolean).map(x => x.html).join("\n")); }
      api.tab("progress"); await tick(); out.push(api.panel());
      return out;
    };
    const ref = await walk(baseHtml, BASE), cur = await walk(appHtml, VC);
    check(`patternCue absent: two-session walk + Sentences test byte-identical to ${BASE_SHA} (patterns on)`, JSON.stringify(ref) === JSON.stringify(cur) && ref.length >= 7, cur.findIndex((x, i) => x !== ref[i]));
  }

  console.log("\n[13] alphabetic packs (fb47): marks compare case-folded, options in the answer's case, per-sentence near, validator rules");
  {
    const sent = (id, t, a, b, near) => Object.assign({ id, t, en: "x", lv: "A1", words: ["w1"], marks: [[a, b]] }, near ? { near } : {});
    const pat = (id, ss, near) => Object.assign({ id, lv: "A1", label: id, en: id, note: ["a", "b"], sentences: ss.map((x, i) => sent(`${id}.${i}`, ...x)) }, near ? { near } : {});
    // ayer/antes: three sentences, the first sentence-initial
    const B = pat("pb", [["Ayer llovió.", 0, 4], ["Antes vivía allí.", 0, 5], ["No lo vi antes.", 9, 14]]);
    const A = pat("pa", [["Ya he visto esto.", 0, 2], ["Ella ya llegó.", 5, 7], ["Todavía no he comido.", 0, 7]]);
    const C = pat("pc", [["Mientras tanto, canto.", 0, 8], ["Entonces vendrá.", 0, 8]]);
    const D = pat("pd", [["Cuando llegues, avisa.", 0, 6], ["Avisa cuando llegues.", 6, 12]]);
    const ALL = [B, A, C, D], draws = (pp, si, mi, n) => Array.from({ length: n }, () => VC.patternOpts(pp, pp.sentences[si], mi, ALL, mulberry32(Math.floor(Math.random() * 1e9)))).flat();
    const cap = x => x[0] === x[0].toUpperCase() && x[0] !== x[0].toLowerCase(), fold2 = o => new Set(o.map(x => x.toLowerCase())).size === o.length;
    const o1 = Array.from({ length: 80 }, (_, k) => VC.patternOpts(B, B.sentences[0], 0, ALL, mulberry32(k)));
    check("sentence-initial blank \"Ayer\": every option capitalised, Antes offered (own other mark), never ayer/Ayer/antes", o1.every(o => o.length === 3 && o.every(cap)) && o1.some(o => o.includes("Antes")) && o1.flat().every(x => x !== "Ayer" && x !== "antes" && x !== "ayer"));
    const o2 = Array.from({ length: 80 }, (_, k) => VC.patternOpts(B, B.sentences[2], 0, ALL, mulberry32(k)));
    check("mid-sentence blank \"antes\": options lowercase (a capitalised source mark is re-cased), \"ayer\" offered, never Antes/Ayer", o2.every(o => o.length === 3 && o.every(x => x === x.toLowerCase())) && o2.some(o => o.includes("ayer")) && o2.flat().every(x => x !== "Antes" && x !== "Ayer"));
    const oA = Array.from({ length: 80 }, (_, k) => VC.patternOpts(A, A.sentences[2], 0, ALL, mulberry32(k)));
    check("\"Ya\" and \"ya\" are one word: a pattern with both offers it once, in the answer's case", oA.every(o => o.length === 3 && fold2(o) && o.every(cap)) && oA.some(o => o.includes("Ya")) && oA.flat().every(x => x !== "ya"));
    check("distractor identity is by word, not surface string: no two options equal after case folding (other patterns' Ya/ya included)", [B, A, C, D].every(pp => pp.sentences.every((sn, si) => Array.from({ length: 40 }, (_, k) => VC.patternOpts(pp, sn, 0, ALL, mulberry32(k))).every(fold2))));
    const base = draws(C, 1, 0, 200), withNear = (() => { const sn = Object.assign({}, C.sentences[1], { near: ["pd"] }); return Array.from({ length: 200 }, (_, k) => VC.patternOpts(C, sn, 0, ALL, mulberry32(k))).flat(); })();
    check("per-sentence near: without it the other pattern's marks are offered", base.some(x => ["Cuando", "cuando"].includes(x)) || base.some(x => ["cuando"].includes(x)));
    check("per-sentence near: with near [pd] on this sentence its marks (cuando) are never offered", withNear.length > 0 && withNear.every(x => x.toLowerCase() !== "cuando"));
    const sibling = Array.from({ length: 200 }, (_, k) => VC.patternOpts(C, C.sentences[0], 0, ALL, mulberry32(k))).flat();
    check("per-sentence near affects that sentence only (the pattern's other sentence still offers cuando)", sibling.some(x => x.toLowerCase() === "cuando"));
    const both = Object.assign({}, C, { near: ["pa"] }), sn2 = Object.assign({}, C.sentences[1], { near: ["pd"] });
    const merged = Array.from({ length: 300 }, (_, k) => VC.patternOpts(both, sn2, 0, ALL, mulberry32(k))).flat().map(x => x.toLowerCase());
    check("pattern near and sentence near merge", merged.length > 0 && !merged.includes("cuando") && !merged.includes("ya") && !merged.includes("todavía"));
    // M3: only the first letter of an option follows the answer; Sie, a noun and USA keep their own case
    {
      const mk = (id, t, w, near) => { const i = t.indexOf(w); return Object.assign({ id, t, en: "x", lv: "A1", words: ["w1"], marks: [[i, i + w.length]] }, near ? { near } : {}); };
      const G = { id: "pg", lv: "A1", label: "g", en: "g", note: ["a", "b"], sentences: [mk("g.0", "Wir sehen Sie dort.", "Sie"), mk("g.1", "Das Haus ist alt.", "Haus"), mk("g.2", "Die USA sind groß.", "USA"), mk("g.3", "Und dann ging er.", "Und"), mk("g.4", "Er kam und ging.", "und")] };
      const H = { id: "ph", lv: "A1", label: "h", en: "h", note: ["a", "b"], sentences: [mk("h.0", "Ich weiß, dass er schläft.", "dass"), mk("h.1", "Dass er schläft, weiß ich.", "Dass")] };
      const GH = [G, H], ask = (pp, i) => Array.from({ length: 120 }, (_, k) => VC.patternOpts(pp, pp.sentences[i], 0, GH, mulberry32(k)));
      const mid = ask(G, 4).flat(), start = ask(G, 3).flat(), sie = ask(G, 0).flat(), hd = ask(H, 0).flat(), hs = ask(H, 1).flat();
      check("de lowercase blank \"und\": Sie, Haus, USA keep their case (no sie / haus / Usa / uSA)", mid.length > 0 && mid.every(x => ["Sie", "Haus", "USA", "dass"].includes(x)) && mid.includes("Sie") && mid.includes("USA") && mid.includes("Haus"));
      check("de sentence-initial blank \"Dass\": a lowercase-mid option takes a capital (Und, not und), Sie / Haus / USA unchanged", hs.length > 0 && hs.every(x => ["Sie", "Haus", "USA", "Und"].includes(x)) && hs.includes("Und"));
      check("de mid-sentence blank \"dass\": options keep running-text case (und lowercase; Sie, Haus, USA as written)", hd.length > 0 && hd.every(x => ["Sie", "Haus", "USA", "und"].includes(x)) && hd.includes("und") && hd.includes("Sie"));
      check("de mid-sentence blank \"Sie\": a lowercase option stays lowercase (und), no Und", sie.length > 0 && sie.every(x => ["Haus", "USA", "und"].includes(x)) && sie.includes("und"));
      check("de sentence-initial blank \"Und\" keeps own-pattern Sie / Haus / USA as written", start.length > 0 && start.every(x => ["Sie", "Haus", "USA"].includes(x)));
      check("de fold identity: Und / und and Dass / dass are one word each, never offered twice", [...ask(G, 0), ...ask(G, 3), ...ask(H, 0)].every(o => new Set(o.map(x => x.toLowerCase())).size === o.length));
    }
    // zh: the same options, in the same order, from the same rng, as main before this branch
    const B47 = "d1601cd", b47core = git(B47, "engine/core.js");
    if(!b47core) skip(`${B47} not in this checkout's history`);
    else {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "patterns-b47-")), `core_${B47}.js`); fs.writeFileSync(f, b47core); const C47 = require(f);
      let same = 0, bad = [];
      PATTERNS.forEach(pp => pp.sentences.forEach(sn => sn.marks.forEach((m, mi) => { for(let k = 0; k < 6; k++){
        const a = JSON.stringify(C47.patternOpts(pp, sn, mi, PATTERNS, mulberry32(k))), b = JSON.stringify(VC.patternOpts(pp, sn, mi, PATTERNS, mulberry32(k))); if(a === b) same++; else bad.push(sn.id); } })));
      check(`zh patternOpts identical to ${B47} for every mark of every sentence (${same} draws, same seeds)`, bad.length === 0 && same > 1000, bad.slice(0, 5).join(" "));
      // The two-session walk byte-identical to d1601cd compared the appView-off render (the suite pack predates appView);
      // deleted with the flag collapse (stage 2): appView v2 changed after d1601cd, so the walk has no v2 control.
    }
    // validator
    const val = (patterns, pk) => JSON.parse(cp.execFileSync(PY, ["-I", "-c", `import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "tools"))})
import validate_pack as v
d = json.load(sys.stdin); r = v.Report()
d, pk = d
v.check_patterns(dict({"patterns": True, "levels": [{"id": "A1"}]}, **pk), d, {"A1"}, {"w1": {"id": "w1", "lv": "A1", "w": "x"}}, r)
print(json.dumps([r.errors, r.warnings]))`], { input: JSON.stringify([patterns, pk || {}]), encoding: "utf8" }));
    const [e0, w0] = val([B, A, C, D]);
    check("validator: a clean alphabetic file has no errors and no warnings", e0.length === 0 && w0.length === 0, JSON.stringify([e0, w0]));
    const withS = (pp, si, extra) => Object.assign({}, pp, { sentences: pp.sentences.map((x, i) => i === si ? Object.assign({}, x, extra) : x) });
    check("validator: a sentence near with real ids passes", val([withS(B, 0, { near: ["pa", "pc"] }), A, C, D])[0].length === 0);
    check("validator: a sentence near naming no pattern is an error", /near must list other pattern ids/.test(val([withS(B, 0, { near: ["p99"] }), A, C, D])[0].join("\n")));
    check("validator: a sentence near naming its own pattern is an error", /near must list other pattern ids/.test(val([withS(B, 0, { near: ["pb"] }), A, C, D])[0].join("\n")));
    check("validator: a sentence near that is not a list is an error", /near must list other pattern ids/.test(val([withS(B, 0, { near: "pa" }), A, C, D])[0].join("\n")));
    const A2 = pat("pa2", [["Esto ya pasó.", 5, 7], ["Ya lo vi.", 0, 2]]);
    const sh = (a, b) => val([a, b]).flat().join("\n");
    check("validator: two patterns sharing a mark word (ya, Ya) with no near is an error", /patterns pa and pa2 share the mark word 'ya'/.test(sh(A, A2)));
    check("validator: one-way near is still an error", /share the mark word/.test(sh(A, Object.assign({}, A2, { near: ["pa"] }))));
    check("validator: each listing the other in near passes", !/share the mark word/.test(sh(Object.assign({}, A, { near: ["pa2"] }), Object.assign({}, A2, { near: ["pa"] }))));
    check("validator: patterns with distinct mark words are not flagged", !/share the mark word/.test(sh(A, B)));
    const amb = pat("pe", [["Ya lo vi, ya.", 0, 2], ["Ella ya vio la playa.", 5, 7], ["Ya llegó.", 0, 2]]);
    const [, wa] = val([amb]);
    check("validator: a mark word twice in t (whole words) warns, once or inside a longer word does not", wa.length === 1 && /sentences\[0\]: mark word 'ya' occurs more than once/.test(wa[0]), JSON.stringify(wa));
    const ZHP = { spaced: false };
    const [ez, wz] = val([pat("pz", [["我喜欢就是你就好", 5, 6]])], ZHP);
    check("validator: pack.spaced false exempts both rules (zh 就 in two patterns)", ez.length === 0 && wz.length === 0 && !/share/.test(val([pat("pz1", [["我就是", 1, 2]]), pat("pz2", [["他就来", 1, 2]])], ZHP).flat().join("")));
    const edge = [pat("pz1", [["虽然，我来。", 0, 2], ["虽然，他来。", 0, 2]]), pat("pz2", [["所以，我来。", 0, 2], ["虽然，好。", 0, 2]])];
    check("validator: a zh mark between punctuation / at a sentence edge is no word under pack.spaced false, a word when the pack is spaced", val(edge, ZHP).flat().length === 0 && /share the mark word/.test(val(edge).flat().join("\n")));
    // L4: the shared word is resolved by pattern near OR by near on every sentence carrying it
    const sn = (pp, ids) => Object.assign({}, pp, { sentences: pp.sentences.map(x => Object.assign({}, x, { near: ids })) });
    check("validator L4: sentence near on every carrying sentence of both patterns resolves a shared mark word", !/share the mark word/.test(sh(sn(A, ["pa2"]), sn(A2, ["pa"]))));
    check("validator L4: sentence near on only some carrying sentences does not; pattern near on one side + sentence near on the other does", /share the mark word/.test(sh(withS(A, 0, { near: ["pa2"] }), sn(A2, ["pa"]))) && !/share the mark word/.test(sh(Object.assign({}, A, { near: ["pa2"] }), sn(A2, ["pa"]))));
  }

  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})();
