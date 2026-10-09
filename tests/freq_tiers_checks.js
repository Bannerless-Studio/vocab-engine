// pack.freqTiers (docs/PACK_SCHEMA.md "freqTiers"; owner 2026-10-06: "give more priority to words that
// come up more in real life and the exam ... not just word order, mastery requirements as well"):
// [1] config and validator, [2] the generated tiers and order (shares per level within 5 points of the
// guide, ambient list, examples, ids / sentences / passages unchanged, units in word order), [3] pair
// streak per tier, [4] typed planning per tier (words and units), [5] refresh: ambient excluded,
// peripheral age halved, [6] known per tier (wordKnown) and the goal / progress positions, [7] unit
// tier from mixed words and the unit target, [8] Learn order on the owner export: nothing re-taught,
// the next set, [9] flag-off control: plans, positions and a two-session app walk byte-identical to
// ff760d8, [10] the app with freqTiers: three Today sessions on the owner export. The 7-day measure
// is in the fb26 commit message and docs/PACK_SCHEMA.md "freqTiers".
// Run: node tests/freq_tiers_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "ff760d8"; // main before freqTiers
const PY = process.env.PYTHON3 || "python3";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// glossStyle (fb32) changes every gloss the controls render; tests/gloss_display_checks.js covers it.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), "34c5df3", { strip: [] });
// levelGate and levelExam (fb38) came after ff760d8: the flag-off controls drop them too (tests/level_gate_checks.js covers it).
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const BY_W = Object.fromEntries(WORDS.map(w => [w.w, w]));
const clone = x => JSON.parse(JSON.stringify(x));
let passes = 0, fails = 0, skips = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); if(extra) console.log("    " + String(extra).replace(/\n/g, "\n    ")); }
}
function skip(name){ skips++; console.log(`SKIP  ${name}`); }
const git = (sha, f) => { try { return cp.execSync(`git -C "${ROOT}" show ${sha}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch(e){ return null; } };
const mainCoreSrc = git(MAIN, "engine/core.js"), mainHtml = git(MAIN, "engine/app.html");
const OLD = mainCoreSrc ? (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ft-")), `core_${MAIN}.js`); fs.writeFileSync(f, mainCoreSrc); return require(f); })() : null;
const constOf = (src, name) => src ? new Function(src + `\nreturn ${name};`)() : null;
const OLD_WORDS = constOf(git(MAIN, "packs/zh/words.js"), "WORDS");


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
  goto: t => { tab = t; testSel = null; RD = null; soundsSel = null; render(); },
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
// The owner's export (private, never committed): $PAIRS_OWNER, else the 2026-10-04 upload, else the copy
// in ../chinese/.cache; without one the owner sections are skipped (synthetic records cover the rules).
const OWNER = (() => { for(const f of [process.env.PAIRS_OWNER, "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json", path.join(ROOT, "..", "chinese", ".cache", "owner-progress.json")]) if(f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); return null; })();
const sigPlan = pl => pl.map(x => [x.kind, x.word ? "w" + x.word.id : "", x.unit ? "u" + x.unit.id : "", x.tu || x.tuUnit && x.tuUnit.id || "", x.reqKind || "", x.pair || ""].join(":")).join(",");
const TODAY = "2026-10-06";
const tierOf = w => VC.wordTier(w, PACK);
// Synthetic progress: HSK 1 learned, every word at legacy streak s with wm/sm/ws answered at session a.
function synth(s, a, sn, f){
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 10 }, PACK);
  p.sets = { "1": NS("1"), "2": 0, "3": 0, "4": 0 }; p.sn = sn;
  byLv["1"].forEach((w, i) => { p.w[w.id] = { r: s + 1, w: 0, s, u: typeof a === "function" ? a(w, i) : a, p: {} }; ["wm", "sm", "ws"].forEach(k => { p.w[w.id].p[k] = [s, p.w[w.id].u]; }); if(f) f(p.w[w.id], w, i); });
  return p;
}
const lwOf = (p, pk) => VC.learnedWords(WORDS, pk || PACK, p);
const planOpts = (rng, extra) => Object.assign({ canHear: () => true, today: TODAY, rng: mulberry32(rng), typedKindFits: (w, k) => VC.typedKindOk(k, w, true), typedOk: () => true }, extra || {});
const pairOfItem = it => it.word ? (it.kind === "type" ? it.pair : VC.PAIR_OF_KIND[it.kind]) : VC.PAIR_OF_KIND[it.kind];

(async () => {
  console.log("[1] config: pack.freqTiers on zh, needs pairs; validator");
  check("frequency tiers are engine default (flag collapse): zh carries no freqTiers key, its words read their ft", !("freqTiers" in PACK) && WORDS.some(w => VC.wordTier(w, PACK) !== VC.FT_CORE));
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ft-val-"));
    const run = (pk, wk, ck) => { const d = path.join(tmp, String(Math.random()).slice(2)); fs.mkdirSync(d); for(const f of fs.readdirSync(ZH)) if(f.endsWith(".json")) fs.copyFileSync(path.join(ZH, f), path.join(d, f));
      const ed = (f, fn) => { if(!fn) return; const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); fn(j); fs.writeFileSync(path.join(d, f), JSON.stringify(j)); };
      ed("pack.json", pk); ed("words.json", wk); ed("characters.json", ck);
      cp.execSync(`${PY} "${path.join(ROOT, "tools", "jsonify_pack.py")}" "${d}"`, { stdio: "ignore" });
      try { cp.execSync(`${PY} "${path.join(ROOT, "tools", "validate_pack.py")}" "${d}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return ""; } catch(e){ return String(e.stdout || "") + String(e.stderr || ""); } };
    check("validate_pack: zh as shipped passes", run() === "");
    check("validate_pack: a word ft outside 0/1/2 is an error", /word w\d+\.ft must be 0, 1 or 2/.test(run(null, w => { w[0].ft = 3; })));
    check("validate_pack: a unit ft other than its words' lowest is an error", /\.ft 2 is not the lowest ft of its words/.test(run(null, null, c => { const u = c.find(x => x.ft === 1); u.ft = 2; })));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n[2] generated tiers and order (tools/pack_from_hsk.py, tools/zh_freq.json)");
  const ZIPF = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "zh_freq.json"), "utf8"));
  const GUIDE = { "1": 10, "2": 20, "3": 35, "4": 45 };
  const shares = VC.levelIds(PACK).map(lv => { const l = byLv[lv]; return [lv, 100 * l.filter(w => tierOf(w) === 2).length / l.length, l.filter(w => tierOf(w) === 0).length]; });
  console.log("    peripheral share by level: " + shares.map(([lv, s, a]) => `HSK ${lv} ${s.toFixed(1)}% (ambient ${a})`).join(", "));
  check("peripheral share per level within 5 points of the guide (10 / 20 / 35 / 45 %)", shares.every(([lv, s]) => Math.abs(s - GUIDE[lv]) <= 5));
  const amb = WORDS.filter(w => tierOf(w) === 0);
  check(`ambient: ${amb.length} words, the highest-zipf words of the pack`, amb.length >= 90 && amb.length <= 110 && Math.min(...amb.map(w => ZIPF[w.w])) >= Math.max(...WORDS.filter(w => tierOf(w) !== 0).map(w => ZIPF[w.w])));
  check("我 你 他 是 的 了 不 are ambient", ["我", "你", "他", "是", "的", "了", "不"].every(x => BY_W[x] && tierOf(BY_W[x]) === 0));
  check("爬山 is peripheral, 虽然 core", tierOf(BY_W["爬山"]) === 2 && tierOf(BY_W["虽然"]) === 1);
  check("every word has ft 0/1/2 and its zipf in tools/zh_freq.json", WORDS.every(w => [0, 1, 2].includes(w.ft) && typeof ZIPF[w.w] === "number"));
  check("each level in zipf order, descending", VC.levelIds(PACK).every(lv => byLv[lv].every((w, i, l) => !i || ZIPF[l[i - 1].w] >= ZIPF[w.w])));
  const OVR = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "zh_tiers_overrides.json"), "utf8")).tiers || {}, TN = { ambient: 0, core: 1, peripheral: 2 };
  check(`overrides applied (${Object.entries(OVR).map(([w, t]) => w + " " + t).join(", ")})`, Object.entries(OVR).every(([w, t]) => BY_W[w] && tierOf(BY_W[w]) === TN[t]));
  check("peripheral words are the lowest-zipf non-ambient words of their level (overridden words aside)", VC.levelIds(PACK).every(lv => { const l = byLv[lv].filter(w => !(w.w in OVR)); const p = l.filter(w => tierOf(w) === 2), c = l.filter(w => tierOf(w) === 1); return !p.length || !c.length || Math.max(...p.map(w => ZIPF[w.w])) <= Math.min(...c.map(w => ZIPF[w.w])); }));
  if(!OLD_WORDS) skip(`packs/zh/words.js at ${MAIN} not in this checkout's history`);
  else {
    const ow = Object.fromEntries(OLD_WORDS.map(w => [w.id, w]));
    // fb33 (owner 2026-10-07): 上午 dropped "a.m." (its key am folded onto 是's "am"), so 是 / 上午 lost that syn; the old
    // records are compared with the fb33 gloss fix applied, every other word as it stood.
    const FB33 = { w0099: w => { const v = Object.assign({}, w); delete v.syn; return v; }, w0005: w => Object.assign({}, w, { en: "morning (before noon)", syn: ["w0227"] }) };
    Object.keys(FB33).forEach(id => { if(ow[id]) ow[id] = FB33[id](ow[id]); });
    check(`same word ids, written forms and levels as ${MAIN} (only the order within a level and ft changed)`, OLD_WORDS.length === WORDS.length && WORDS.every(w => ow[w.id] && ow[w.id].w === w.w && ow[w.id].lv === w.lv && JSON.stringify(Object.assign({}, w, { ft: undefined })) === JSON.stringify(Object.assign({}, ow[w.id], { ft: undefined }))));
    check(`level order kept (every HSK 1 word before HSK 2, ...)`, WORDS.every((w, i) => !i || VC.levelIds(PACK).indexOf(WORDS[i - 1].lv) <= VC.levelIds(PACK).indexOf(w.lv)));
    const same = f => { const a = git(MAIN, `packs/zh/${f}`); return a !== null && a === fs.readFileSync(path.join(ZH, f), "utf8"); };
    // passages authored after ff760d8 (fb34: p0061-p0075) are new content; every passage that existed then stays byte-identical
    const oldPass = (() => { const a = git(MAIN, "packs/zh/passages.json"); return a === null ? null : JSON.parse(a); })();
    const curPass = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ZH, "passages.json"), "utf8")).map(p => [p.id, JSON.stringify(p)]));
    const samePass = !!oldPass && oldPass.every(p => curPass[p.id] === JSON.stringify(p));
    check(`sentences.json, lessons.json byte-identical to ${MAIN}, and each of its ${oldPass ? oldPass.length : "?"} passages unchanged (sentence word ids unchanged)`, same("sentences.json") && samePass && same("lessons.json"));
    const idMap = cp.spawnSync("git", ["-C", ROOT, "diff", "--quiet", MAIN, "--", "tools/id_map_v1.json", "tools/id_map"], { encoding: "utf8" });
    check(`tools/id_map untouched since ${MAIN}`, idMap.status === 0);
  }
  check("characters.json in word order (unit order follows word rank), each unit's ft its words' lowest", CHARACTERS.length === WORDS.length && CHARACTERS.every((u, i) => u.words[0] === WORDS[i].id && u.ft === Math.min(...u.words.map(id => BY_ID[id].ft))));

  console.log("\n[3] pair streak: the same in every tier (core.js notePair)");
  {
    const rows = [];
    for(const tier of [0, 1, 2]) for(const s of [0, 1, 2, 3]) for(const prod of [false, true]) for(const ok of [true, false]){
      const r = { s: 0, p: { wm: [s, 1] } }; VC.notePair(r, "wm", ok, prod, 5, s, undefined, tier); rows.push([tier, s, prod, ok, r.p.wm[0]]);
    }
    const at = (t, s, prod, ok) => rows.find(x => x[0] === t && x[1] === s && x[2] === prod && x[3] === ok)[4];
    check("every tier: a choice answer stops at 2, only production (typed, or the hard choice where nothing can be typed) takes 2 -> 3", [0, 1, 2].every(t => at(t, 1, false, true) === 2 && at(t, 2, false, true) === 2 && at(t, 2, true, true) === 3 && at(t, 3, false, true) === 3));
    check("every tier: a miss sets 0", rows.filter(x => !x[3]).every(x => x[4] === 0));
    const H = VC.pairUnitHeld(PACK), bootOf = tier => { const r = { r: 6, w: 0, s: H }; VC.notePair(r, "wm", true, false, 5, H, H, tier); return r.p.wm[0]; };
    check(`a unit held at ${H} (bare - 1): core boots at 2 (asked typed first), peripheral at 3 (no held priority; refresh)`, bootOf(1) === 2 && bootOf(2) === 3);
    check("word known bar: core / ambient 3, peripheral 2", VC.knownBarAt(0) === 3 && VC.knownBarAt(1) === 3 && VC.knownBarAt(2) === 2 && VC.knownBarAt(undefined) === 3);
  }

  console.log("\n[4] typed planning per tier: peripheral typed asks happen, never prioritised");
  {
    // Synthetic candidates at equal streak 1: core typed asks go first; a peripheral pair is asked typed
    // when drawn, after the core typed asks even when older.
    const cand = (t, a, id) => { const w = Object.assign({}, BY_W[id]); return { t: "w", x: w, key: "w:" + w.id, rec: { s: 1, u: a, p: { wm: [1, a] } }, kinds: ["read", "recall", "type"], tier: t, tw: w }; };
    const fits = { typedKindFits: (w, k) => k === "written" || k === "word" };
    const pick = (cs, n, pk) => VC.pairPick(cs, n, { a: {} }, mulberry32(1), 40, pk || PACK, fits).filter(e => e.pair === "wm").map(e => [e.c.tier, e.kind]);
    const two = [cand(1, 30, "虽然"), cand(2, 5, "爬山")];
    const r1 = pick(two, 1), r2 = pick(two, 2);
    check(`equal streak: the core typed ask before the older peripheral one (${JSON.stringify(r1)}); the peripheral one, when drawn, is typed (${JSON.stringify(r2)})`, r1.length === 1 && r1[0][0] === 1 && r1[0][1] === "type" && r2.length === 2 && r2[1][0] === 2 && r2[1][1] === "type");
    const cOff = [cand(undefined, 30, "虽然"), cand(undefined, 5, "爬山")];
    // A peripheral pair below its streak still comes before a core one higher up: streak first.
    const lowP = [cand(1, 30, "虽然"), Object.assign(cand(2, 5, "爬山"), { rec: { s: 0, u: 5, p: { wm: [0, 5] } } })];
    check("streak first: a peripheral pair at 0 before a core pair at 1", VC.pairPick(lowP, 1, { a: {} }, mulberry32(1), 40, PACK, fits)[0].c.tier === 2);
    // Plans on HSK 1 at pair streak 1: peripheral words are typed when planned; the typed share is below core's.
    const p = synth(2, 3, 6, (r) => { Object.keys(r.p).forEach(k => { r.p[k] = [1, 3]; }); });
    const lw = lwOf(p); let tP = 0, nP = 0, tC = 0, nC = 0;
    for(const sd of [1, 2, 3, 4, 5]){
      VC.buildReviewPlan(lw, clone(p), PACK, Object.assign(planOpts(sd), { size: 20, sn: 7 })).forEach(it => { if(!it.word) return; if(tierOf(it.word) === 2){ nP++; if(it.kind === "type") tP++; } else { nC++; if(it.kind === "type") tC++; } });
    }
    console.log(`    Review plans, HSK 1 at pair streak 1 (5 seeds x 20): core/ambient ${tC} typed of ${nC}; peripheral ${tP} typed of ${nP} (HSK 1 has ${byLv["1"].filter(w => tierOf(w) === 2).length} peripheral of 150)`);
    check("a size-20 Review at equal streak fills with core typed asks before any peripheral one", nP === 0 || tC >= 20 * 5 - nP);
    const w2 = byLv["1"].find(w => tierOf(w) === 2), w1 = byLv["1"].find(w => tierOf(w) === 1);
    check(`typedWordDue: a held peripheral word (${w2.w}) and a held core word (${w1.w}) are both due typed (same mechanics)`, VC.typedWordDue(w2, p, PACK, TODAY, ["recall", "type"], () => true) && VC.typedWordDue(w1, p, PACK, TODAY, ["recall", "type"], () => true));
    // Units: HSK 1 units at 4 (mastered..bare-1, held for a typed ask); every word pair known.
    const pu = synth(3, 3, 6); VC.answerCharChoice(pu, true); VC.ensureChars(pu);
    byLv["1"].forEach(w => { const u = CHARACTERS.find(x => x.words[0] === w.id); pu.chars.c[u.id] = { r: 5, w: 0, s: 4 }; });
    const TU = VC.typedUnitWords(CHARACTERS, WORDS, PACK);
    const uP = CHARACTERS.find(u => u.lv === "1" && u.ft === 2 && TU.has(u.id)), uC = CHARACTERS.find(u => u.lv === "1" && u.ft === 1 && TU.has(u.id));
    check(`typedUnitDue: a peripheral unit at 4 (${uP.t}) and a core one (${uC.t}) are both due typed`, VC.typedUnitDue(uP, pu, PACK, TU) && VC.typedUnitDue(uC, pu, PACK, TU));
    let tuPer = 0, tuCore = 0;
    for(const sd of [1, 2, 3]){
      const pl = VC.buildReviewPlan(lwOf(pu), clone(pu), PACK, Object.assign(planOpts(sd), { size: 40, sn: 7, units: CHARACTERS, typedUnits: TU }));
      pl.forEach(it => { if(it.tu){ if(CHARACTERS.find(u => u.id === it.tu).ft === 2) tuPer++; else tuCore++; } });
    }
    console.log(`    Review plans, HSK 1 units at 4 (3 seeds x 40): unit typed asks core ${tuCore}, peripheral ${tuPer} (refresh share only)`);
    check("unit typed asks: core units held at 4 first; peripheral ones only through the refresh share (fewer)", tuCore > 0 && tuPer < tuCore && tuPer <= 3 * Math.ceil(40 * VC.PAIR_REFRESH));
    const held = { r: 6, w: 0, s: 4 }, before = clone(held);
    VC.markChar({ chars: { c: { x: held } } }, "x", true, PACK, true);
    check("a unit held at 4: a right choice answer does not move it to bare (every tier)", held.s === before.s);
    const pt = clone(pu), wid = uP.words[0]; const tu = VC.markUnitTyped(pt, CHARACTERS, PACK, BY_ID[wid] ? TU.get(uP.id).id : wid, true);
    check(`a peripheral unit at 4 (${uP.t}) reaches bare (${PACK.characters.bare}) by a right typed answer: ${pt.chars.c[uP.id].s}`, !!tu && pt.chars.c[uP.id].s === PACK.characters.bare && VC.charTier(pt.chars.c[uP.id].s, PACK) === "bare");
  }

  console.log("\n[5] refresh: ambient excluded, peripheral age halved");
  {
    // Every HSK 1 pair known (streak 3), last answered at session i % 30: the plan is all refresh.
    const p = synth(3, (w, i) => i % 30, 40);
    const lw = lwOf(p); let amb = 0, n = 0;
    for(const sd of [1, 2, 3, 4, 5]){
      const pl = VC.buildReviewPlan(lw, clone(p), PACK, Object.assign(planOpts(sd), { size: 20, sn: 41 }));
      pl.forEach(it => { n++; if(it.word && tierOf(it.word) === 0) amb++; });
      const li = VC.dayPickList(lw, 12, clone(p), PACK, TODAY, "w:", ["hear"], mulberry32(sd), undefined, { sn: 41 });
      li.forEach(w => { n++; if(tierOf(w) === 0) amb++; });
    }
    check(`refresh asks on ambient words: 0 (${amb} of ${n} planned items; HSK 1 has ${byLv["1"].filter(w => tierOf(w) === 0).length} ambient)`, n > 0 && amb === 0);
    // A known ambient pair is never a candidate; one below mastery is (a miss brings it back).
    const wa = byLv["1"].find(w => tierOf(w) === 0); const pm = clone(p); pm.w[wa.id].p.wm = [0, 39];
    const pl = VC.buildReviewPlan(lw, pm, PACK, Object.assign(planOpts(1), { size: 20, sn: 41 }));
    check(`an ambient word missed (${wa.w} wm at 0) comes back like any other`, pl.some(it => it.word && it.word.id === wa.id));
    const cand = (t, a, id) => ({ t: "w", x: { id }, key: "w:" + id, rec: { s: 3, p: { wm: [3, a] } }, kinds: ["read"], tier: t, tw: { id } });
    const pick = cs => VC.pairPick(cs, 10, { a: {} }, mulberry32(1), 40, PACK, {}).map(e => e.c.key);
    // Pairs below 3 fill the plan except its refresh share (n = 20: 2 slots; n = 10: 1).
    const low = k => Array.from({ length: k }, (_, i) => ({ t: "w", x: { id: "l" + i }, key: "w:l" + i, rec: { s: 1, p: { wm: [1, 30] } }, kinds: ["read"], tier: 1, tw: { id: "l" + i } }));
    const ref = (cs, n, pk, sn) => VC.pairPick(cs, n, { a: {} }, mulberry32(1), sn || 41, pk || PACK, {}).map(e => e.c.key).filter(k => !k.startsWith("w:l"));
    // Second slot by halved age: peripheral 10 ago ranks at 25, so core 20 ago comes first, core 26 ago after it.
    const r1 = ref([...low(18), cand(2, 0, "pa"), cand(2, 10, "pb"), cand(1, 20, "c")], 20), r2 = ref([...low(18), cand(2, 0, "pa"), cand(2, 10, "pb"), cand(1, 26, "c")], 20);
    check(`peripheral age counts half: after the reserved slot (pa), core 20 ago before peripheral 10 ago (${r1.join(" ")}); core 26 ago after it (${r2.join(" ")})`,
      r1.join() === "w:pa,w:c" && r2.join() === "w:pa,w:pb");
    {
      // Odd session ordinal: one refresh slot for the oldest known peripheral pair, though ten core known pairs are older.
      const cs = [...low(9), ...Array.from({ length: 10 }, (_, i) => cand(1, i, "c" + i)), cand(2, 30, "p1"), cand(2, 25, "p2")];
      const got = ref(cs, 10);
      check(`peripheral refresh, odd plan (sn 41): the slot goes to the oldest known peripheral pair (${got.join(" ")})`, got.join() === "w:p2");
      const ev = ref(cs, 10, PACK, 40), ev2 = ref(cs, 10, PACK, 42), od = ref(cs, 10, PACK, 43);
      check(`peripheral refresh, even plans (sn 40, 42): no reserved slot, oldest by age (${ev.join(" ")} / ${ev2.join(" ")}); sn 43 reserves again (${od.join(" ")})`, ev.join() === "w:c0" && ev2.join() === "w:c0" && od.join() === "w:p2");
      const n20 = ref([...low(18), ...cs.slice(9)], 20);
      check(`two refresh slots: the peripheral pair, then the oldest core (${n20.join(" ")})`, n20.join() === "w:p2,w:c0");
      const none = ref([...low(9), ...Array.from({ length: 10 }, (_, i) => cand(1, i, "c" + i))], 10);
      check(`no known peripheral pair: the share fills as before (${none.join(" ")})`, none.join() === "w:c0");
    }
  }

  console.log("\n[6] known per tier (core.js wordKnown)");
  {
    const wp = byLv["1"].find(w => tierOf(w) === 2), wc = byLv["1"].find(w => tierOf(w) === 1), wa = byLv["1"].find(w => tierOf(w) === 0);
    const K = (rec, w, pk) => VC.wordKnown(rec, w, pk || PACK);
    check(`pairs a word's known reads: core ${VC.wordPairs(wc, PACK).join("/")}, peripheral ${VC.wordPairs(wp, PACK).join("/")}`, VC.wordPairs(wc, PACK).join() === "wm,sm,ws" && VC.wordPairs(wp, PACK).join() === "wm,sm,ws");
    check("legacy 2, no pairs answered: peripheral known, core and ambient not", K({ r: 3, w: 0, s: 2 }, wp) && !K({ r: 3, w: 0, s: 2 }, wc) && !K({ r: 3, w: 0, s: 2 }, wa));
    check("legacy 3+, no pairs answered: known in every tier (boot follows the legacy streak)", [wp, wc, wa].every(w => K({ r: 4, w: 0, s: 3 }, w)));
    check("core: wm 3 and sm 3 but ws at boot 2 (legacy 2): not known; ws 3: known", !K({ r: 4, w: 0, s: 2, p: { wm: [3, 1], sm: [4, 2] } }, wc) && K({ r: 4, w: 0, s: 2, p: { wm: [3, 1], sm: [4, 2], ws: [3, 2] } }, wc));
    check("a missed pair (0) takes a word out of known in every tier", [wp, wc, wa].every(w => !K({ r: 4, w: 1, s: 5, p: { sm: [0, 3] } }, w)));
    check("peripheral: every pair at 2 (choice answers): known; core at 2 not", K({ r: 4, w: 0, s: 1, p: { wm: [2, 3], sm: [2, 4], ws: [2, 4] } }, wp) && !K({ r: 4, w: 0, s: 1, p: { wm: [2, 3], sm: [2, 4], ws: [2, 4] } }, wc));
    const pr = { r: 3, w: 0, s: 2, prov: 1, p: { wm: [2, 3], sm: [2, 3], ws: [2, 3] } };
    check("settleProv: a peripheral placement word known by pairs drops prov", (() => { const a = clone(pr); return VC.settleProv(a, wp, PACK) && !a.prov; })());
    // Goal / progress positions read the same rule.
    const p = synth(2, 3, 6), lv1 = byLv["1"];
    const g = VC.progressMapGoals(PACK)[0], gp = VC.goalPosition(p, PACK, g, WORDS, [], []);
    const nP = lv1.filter(w => tierOf(w) === 2).length, inG = WORDS.filter(w => +w.lv <= 2).length;
    check(`goalPosition: HSK 1 at legacy 2 counts its ${nP} peripheral words known (${gp.toFixed(3)} = ${nP}/${inG} words)`, Math.abs(gp - nP / inG) < 1e-9);
  }

  console.log("\n[7] unit tier from mixed words; unit target");
  {
    const wa = WORDS.find(w => w.ft === 0), wc = WORDS.find(w => w.ft === 1), wp = WORDS.find(w => w.ft === 2);
    const U = (ids, ft) => Object.assign({ id: "cx", t: "x", words: ids, lv: "1" }, ft === undefined ? {} : { ft });
    check("unitTier: the lowest ft of its words (core + peripheral -> core; ambient + peripheral -> ambient; peripheral alone -> peripheral)",
      VC.unitTier(U([wp.id, wc.id]), BY_ID, PACK) === 1 && VC.unitTier(U([wp.id, wa.id]), new Map(Object.entries(BY_ID)), PACK) === 0 && VC.unitTier(U([wp.id]), WORDS, PACK) === 2);
    check("unitTier without words reads the unit's own ft (the generator's minimum), else core", VC.unitTier(U([wp.id], 2), null, PACK) === 2 && VC.unitTier(U([wp.id]), null, PACK) === 1);
    const cfg = PACK.characters, at = s => ({ r: s + 1, w: 0, s });
    check(`unitDone: core needs bare (${cfg.bare}), peripheral mastered (${cfg.mastered}); a mixed unit is core`,
      !VC.unitDone(at(cfg.mastered), U([wc.id]), PACK, BY_ID) && VC.unitDone(at(cfg.bare), U([wc.id]), PACK, BY_ID) && VC.unitDone(at(cfg.mastered), U([wp.id]), PACK, BY_ID) && !VC.unitDone(at(cfg.mastered - 1), U([wp.id]), PACK, BY_ID) && !VC.unitDone(at(cfg.mastered), U([wp.id, wc.id]), PACK, BY_ID));
  }

  console.log("\n[8] Learn order on the owner export: nothing re-taught");
  if(!OWNER || !OLD_WORDS) skip("owner export or the old words.js missing");
  else {
    const oldPack = constOf(git(MAIN, "packs/zh/pack.js"), "PACK");
    const lwOld = OLD.learnedWords(OLD_WORDS, oldPack, clone(OWNER)).map(w => w.id).sort(), lwNew = VC.learnedWords(WORDS, PACK, clone(OWNER)).map(w => w.id).sort();
    check(`learned words identical before / after the reorder (${lwNew.length})`, JSON.stringify(lwOld) === JSON.stringify(lwNew));
    const nOld = OLD.nextNewSet(OLD_WORDS, oldPack, clone(OWNER)), nNew = VC.nextNewSet(WORDS, PACK, clone(OWNER));
    const names = nn => nn ? `HSK ${nn.lv} set ${nn.set + 1}: ${nn.words.map(w => w.w).join(" ")}` : "none";
    console.log(`    next Learn set before (${MAIN}): ${names(nOld)}\n    next Learn set after:  ${names(nNew)}`);
    // A word with any record (also d, drilled ahead or flagged in Read) counts as learned and is not taught again.
    const rec = OWNER.w || {}, untaught = byLv[nNew.lv].filter(w => !rec[w.id]);
    check("the next set is the next words without a record in frequency order (no learned word in it)", nNew && nNew.words.every(w => !rec[w.id]) && nNew.words.map(w => w.id).join() === untaught.slice(0, nNew.words.length).map(w => w.id).join());
    const cnt = clone(OWNER), before = JSON.stringify(cnt.sets); VC.levelIds(PACK).forEach(lv => VC.settleSetCounter(cnt, WORDS, PACK, lv));
    check(`settleSetCounter keeps the stored counters (${before} -> ${JSON.stringify(cnt.sets)})`, VC.levelIds(PACK).every(lv => (cnt.sets[lv] || 0) >= (OWNER.sets[lv] || 0)));
    // Ten Learn sets in a row from the export: every taught word new.
    const p = clone(OWNER); let reteach = 0, taught = 0;
    for(let k = 0; k < 10; k++){ const nn = VC.nextNewSet(WORDS, PACK, p); if(!nn) break; nn.words.forEach(w => { if(p.w[w.id] && !p.w[w.id].d) reteach++; taught++; p.w[w.id] = { r: 1, w: 0, s: 1 }; }); VC.settleSetCounter(p, WORDS, PACK, nn.lv); }
    check(`ten Learn sets from the export: ${taught} words taught, ${reteach} re-taught`, taught > 0 && reteach === 0);
  }
  {
    // Stored counters were written in id order (the order before the reorder): a records-less
    // level's counter prefix and placement's pinning read it in that order (core.js counterOrder).
    const L2 = byLv["2"], idOrd = L2.slice().sort((a, b) => a.id < b.id ? -1 : 1), oldP = { sets: { "1": 0, "2": 3 }, w: {} };
    const lw = VC.learnedWords(WORDS, PACK, oldP).map(w => w.id), want = idOrd.slice(0, 30).map(w => w.id);
    check(`records-less HSK 2 at counter 3: learned = the first 30 in id order (${lw.length}), not the first 30 by frequency`, lw.join() === want.join() && want.join() !== L2.slice(0, 30).map(w => w.id).join());
    const pin = VC.pinPrefixRecords(clone(oldP), WORDS, PACK);
    check("pinPrefixRecords pins the same 30 (id order)", Object.keys(pin.w).sort().join() === want.slice().sort().join());
    const nn = VC.levelNewSet(WORDS, PACK, VC.pinPrefixRecords(clone(oldP), WORDS, PACK), "2"), settled = VC.pinPrefixRecords(clone(oldP), WORDS, PACK);
    VC.settleSetCounter(settled, WORDS, PACK, "2");
    check(`set label and counter count learned words: next HSK 2 set ${nn && nn.set + 1} (4), counter ${settled.sets["2"]} (3); its words are the first 10 unrecorded by frequency`,
      nn && nn.lv === "2" && nn.set === 3 && settled.sets["2"] === 3 && nn.words.map(w => w.id).join() === L2.filter(w => !want.includes(w.id)).slice(0, 10).map(w => w.id).join());
  }

  // [9] (flag-off control vs ff760d8) deleted: freqTiers is engine default since the flag collapse.

  console.log("\n[10] the app with freqTiers: three Today sessions on " + (OWNER ? "the owner export" : "a synthetic record"));
  {
    NOW = new Date(2026, 9, 6, 8, 0, 0).getTime();
    const p0 = OWNER ? clone(OWNER) : synth(2, 3, 6); delete p0.pause;
    const api = await boot(PACK, p0, 5);
    const lw = VC.learnedWords(WORDS, PACK, p0);
    const k0 = lw.filter(w => VC.wordKnown(p0.w[w.id], w, PACK)).length;
    const perAt2 = lw.filter(w => tierOf(w) === 2 && (p0.w[w.id].s || 0) === 2).length;
    const ans = mulberry32(9); const all = [];
    for(const h of [8, 13, 20]){ NOW = new Date(2026, 9, 6, h, 0, 0).getTime();
      const sn = (api.getProg().sn || 0) + 1;
      (await session(api, (it, rec, rows) => { const key = String(it.key), p = api.getProg();
        const r = key[0] === "w" ? p.w[key.slice(2)] : key[0] === "c" ? p.chars.c[key.slice(2)] : null;
        all.push({ key, kind: it.kind, sn, tu: it.tu || null, tier: key[0] === "w" ? tierOf(BY_ID[key.slice(2)]) : key[0] === "c" ? VC.unitTier(CHARACTERS.find(u => u.id === key.slice(2)), null, PACK) : null,
          ws: r ? ["wm", "sm", "ws"].map(k => VC.pairState(r, k).s) : null,
          us: (() => { if(key[0] !== "w") return null; const u = CHARACTERS.find(x => x.words[0] === key.slice(2)), ur = u && (p.chars || {}).c ? p.chars.c[u.id] : null; return ur ? ["wm", "ws"].map(k => VC.pairState(ur, k, VC.pairUnitHeld(PACK)).s).concat([ur.s || 0]) : null; })(), retry: rows.some(x => x.key === key && !x.ok) });
        return ans() < 0.88; })); }
    const tyBy = t => all.filter(r => r.kind === "type" && r.tier === t).length, asksBy = t => all.filter(r => r.tier === t).length;
    console.log(`    typed asks in three sessions by tier: ambient ${tyBy(0)} of ${asksBy(0)}, core ${tyBy(1)} of ${asksBy(1)}, peripheral ${tyBy(2)} of ${asksBy(2)}`);
    check("typed asks happen for core words; peripheral typed asks fewer than core's", tyBy(1) > 0 && tyBy(2) < tyBy(1));
    // a written-side typed ask also answers the word's unit (bareBy typed): with the unit's pairs below 3 it is
    // the unit's ask, not a refresh of the word
    const ambKnown = all.filter(r => r.tier === 0 && !r.retry && !r.tu && !(r.kind === "type" && r.us && r.us.slice(0, 2).some(x => x < 3)) && r.ws && r.ws.every(s => s >= 3) && r.key[0] === "w");
    check(`no ask of an ambient word whose every pair is known (refresh) (${ambKnown.length}; ${all.filter(r => r.tier === 0).length} ambient asks)`, ambKnown.length === 0);
    api.goto("progress"); const ph = api.panel(), prog = api.getProg();
    const rows = [...(ph.match(/>Characters<\/p><table class="stats nw">([\s\S]*?)<\/table>/) || ["", ""])[1].matchAll(/<td>([^<]*)<\/td><\/tr>/g)].map(m => m[1]);
    const doneOf = lv => { const us = CHARACTERS.filter(u => u.lv === lv && prog.chars.c[u.id]); return us.filter(u => VC.unitDone(prog.chars.c[u.id], u, PACK)).length; };
    console.log("    Progress characters rows: " + rows.join(" | "));
    check("Progress characters rows count units at their target as done (a peripheral unit at mastered)", rows.length === 4 && rows.every((r, i) => { const n = doneOf(String(i + 1)); return n ? r.endsWith(` · ${n} done`) : !/done|bare/.test(r); }) && rows.every(r => r.length <= 32));
    const lvRows = VC.levelIds(PACK).map(lv => (ph.match(new RegExp(`HSK ${lv}</td><td>(\\d+) / \\d+ learned · (\\d+) mastered`)) || [])[2]);
    check(`Progress level rows count known by the tier rule (${lvRows.join(" / ")})`, VC.levelIds(PACK).every((lv, i) => +lvRows[i] === VC.learnedWords(WORDS, PACK, prog).filter(w => w.lv === lv && VC.wordKnownX(prog.w[w.id], w, PACK, prog, VC.knownCtx(PACK, CHARACTERS))).length)); check("nothing new stored: records carry only fields older engines know (r w s k t u f d prov p)", Object.values(prog.w).every(r => Object.keys(r).every(k => ["r", "w", "s", "k", "t", "u", "f", "d", "prov", "p"].includes(k))));
  }

  console.log("\n[11] Words tab numbers sets by count (as Today) for a learner taught in the earlier order");
  {
    NOW = new Date(2026, 9, 6, 8, 0, 0).getTime();
    const idOrd = byLv["1"].slice().sort((a, b) => a.id < b.id ? -1 : 1).slice(0, 35);
    const mk = () => { const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 10 }, PACK); p.sets = { "1": 3, "2": 0, "3": 0, "4": 0 }; p.sn = 6;
      idOrd.forEach(w => { p.w[w.id] = { r: 1, w: 0, s: 1 }; }); return p; };
    for(const [label, pk] of [["frequency tiers", PACK]]){
      const p0 = mk(), api = await boot(pk, clone(p0), 7); api.goto("words");
      const nn = VC.nextNewSet(WORDS, pk, p0), btn = (api.el("wbody").innerHTML.match(/<button class="on">Set (\d+) \/ (\d+)/) || []);
      const rows = (api.el("wl") ? api.el("wl").children : []).map(c => c.innerHTML), learned = new Set(idOrd.map(w => w.id));
      if(pk === PACK){
        check(`${label}: Words tab opens on Today's set number (${btn[1]} vs ${nn.set + 1})`, +btn[1] === nn.set + 1 && nn.set === 3);
        check(`${label}: the shown set is the next Learn set, so Drill this set marks no learned word`, rows.length === nn.words.length && nn.words.every((w, i) => rows[i].includes(w.w)) && nn.words.every(w => !learned.has(w.id)));
        api.el("nx").click(); api.el("jump").click();
        check(`${label}: "next new" returns to the same set`, +(api.el("wbody").innerHTML.match(/<button class="on">Set (\d+)/) || [])[1] === nn.set + 1);
      }
    }
  }

  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL  threw: " + (e && e.stack || e)); process.exit(1); });
