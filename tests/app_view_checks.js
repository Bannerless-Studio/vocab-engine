// pack.appView "v2" (docs/PACK_SCHEMA.md "appView"; owner 2026-10-07), stage A: [A1] the flag; [A2] Today home
// on the owner export (anchor, paused anchor, step rows without counts, gate sentence, goal line); [A3] header
// title per step and per test; [A4] drill end (Missed rows, No misses.); [A5] Session done (deltas from Start,
// title only after a reload); [A6] Progress (gate sentence, Show pinyin, Dark theme chip writes prog.theme only);
// [A7] flag off: Today, drill end, session done, Progress and header byte-identical to main 8604b17 on 3 records.
// Stage B, the drill card: [B1] CSS (--stim-top, flex-start, centred label, option numbers hidden on coarse pointers
// only); [B2] every item kind under v2 (no kind tag, placeholders, copy); [B3] the stimulus, option and reading-aid
// markup equal flag off minus the chrome (plan §14); [B4] options primary sense only + the collision guard, and the
// guard count on the owner export's drills; [B5] reveal by verdict (answer row, inline Replay, unit dots, Examples
// fold); [B6] teach cards; [B7] flag off: every item kind (question, options, typed field, reveal right and wrong),
// teach cards and the drill items of a whole session byte-identical to 6c591c9 on 3 records.
// Run: node tests/app_view_checks.js [owner export path]
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
const cp = require("child_process");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "8604b17"; // main before appView
const OWNER = process.argv[2] || process.env.PROGRESS_OWNER || "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const PATTERNS = loadConst(path.join(ZH, "sentences.js"), "PATTERNS");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const OFF = packAsOf(PACK, MAIN);
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const clone = x => JSON.parse(JSON.stringify(x));

let fails = 0, passes = 0, skips = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}
function skip(name){ skips++; console.log(`SKIP  ${name}`); }

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
      this.hidden = "hidden" in this._attrs; this.disabled = false; this.value = "";
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
    get textContent(){ return this._tmp ? this._html.replace(/<[^>]+>/g, "") : this._text; }
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
    // Only a createElement scratch node (announce) parses: the elements its selectors name are cut from its html, textContent is the tags stripped.
    querySelectorAll(sel){
      if(!this._tmp) return [];
      const self = this, out = [];
      for(const part of sel.split(",")){
        const m = /^(?:\.([\w-]+))?\[([\w-]+)\]$/.exec(part.trim()); if(!m) continue;
        const re = new RegExp(`<(\\w+)\\b[^>]*${m[1] ? `class="[^"]*\\b${m[1]}\\b[^"]*"[^>]*` : ""}\\b${m[2]}\\b[^>]*>`, "g");
        out.push({ remove(){
          let r; re.lastIndex = 0;
          while((r = re.exec(self._html))){
            const tag = r[1], open = new RegExp(`<${tag}\\b`, "g"), close = new RegExp(`</${tag}>`, "g");
            let depth = 1, i = r.index + r[0].length;
            while(depth > 0){ open.lastIndex = close.lastIndex = i; const o = open.exec(self._html), c = close.exec(self._html); if(!c) break;
              if(o && o.index < c.index){ depth++; i = o.index + 1; } else { depth--; i = c.index + c[0].length; } }
            self._html = self._html.slice(0, r.index) + self._html.slice(i); re.lastIndex = 0;
          } } });
      }
      return out;
    }
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
    write(){}, createElement(tag){ const e = new El(tag, {}); e._tmp = true; return e; },
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
const DAY = "2026-10-07";
let NOW = new Date(2026, 9, 7, 20, 0, 0).getTime();
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
  const wl = {};
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(t, f){ (wl[t] = wl[t] || []).push(f); } };
  const fnBody = scriptOf(o.html || appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML,
  title: () => document.getElementById("htitle").textContent, docAttr: k => document.documentElement.getAttribute(k),
  getProg: () => prog, getD: () => D, getCur: () => __cur, fin: () => rzFin, rd: () => RD, at: () => todayStepState && todayStepState.at,
  skipRead: () => { RD = null; todayStep(); }, ev: s => eval(s),
  gate: () => gateSentence(), learned: () => learnedWords().length,
  // A click on a Missed row's tap target: the panel listeners see a stub whose closest() finds only [data-mopen].
  mopen: i => { const b = { dataset: { mopen: String(i) }, attrs: {}, setAttribute(k, v){ this.attrs[k] = v; } }; const e = { target: { closest: sel => sel === "[data-mopen]" ? b : null } }; (document.getElementById("panel")._listeners.click || []).forEach(f => f(e)); return b; },
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","PATTERNS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"AppViewChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, PASSAGES, CHARACTERS, o.patterns ? PATTERNS : undefined];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return api;
}
const fresh = () => ({ ls: memStore(), ss: memStore() });
async function bootWith(pack, prog, seed, opts){ const st = fresh(); if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog)); return { api: await boot(pack, st, seed || 1, opts), st }; }
const stored = (st, pack) => JSON.parse(st.ls.getItem(VC.storageKey(pack)) || "null");
const stripTags = h => String(h).replace(/<rt[^>]*>[\s\S]*?<\/rt>/g, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/\s+/g, " ");

const typedAnswer = it => {
  const w = BY_ID[String(it.key).slice(2)];
  if(!w || !String(it.key).startsWith("w:")) return null;
  return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w;
};
function answer(api, right){
  const it = api.getCur();
  if(it.kind === "type"){ const v = right ? typedAnswer(it) : null; api.el("tin").value = v || "zzz not it"; api.el("submit").click(); return; }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}
// Plays screens until Session done (or `until` returns true). wrong(it, n): answer this item wrong (n = items so far).
// trace(kind, api) is called on each drill end, teach screen and the Session done screen.
async function play(api, o){
  const opt = o || {};
  let n = 0;
  for(let guard = 0; guard < 3000; guard++){
    const html = api.panel(), D = api.getD();
    if(opt.until && opt.until(api, n)) return n;
    if(D && api.getCur() && D.cur){
      const it = api.getCur();
      if(opt.onItem) opt.onItem(api, it);
      answer(api, !(opt.wrong && opt.wrong(it, n))); n++; if(opt.afterAnswer) opt.afterAnswer(api, it); api.el("nx").click(); continue;
    }
    if(/id="again"/.test(html)){ if(opt.trace) opt.trace("done", api); return n; }
    if(/id="ok"/.test(html) && !D){ if(opt.trace) opt.trace("end", api); if(opt.onEnd) opt.onEnd(api); api.el("ok").click(); continue; }
    if(/id="dr"/.test(html)){ if(opt.trace) opt.trace("teach", api); api.el("dr").click(); continue; }
    if(api.rd()){ api.skipRead(); continue; }
    throw new Error(`stuck on ${html.slice(0, 300)}`);
  }
  throw new Error("guard");
}

const owner = fs.existsSync(OWNER) ? JSON.parse(fs.readFileSync(OWNER, "utf8")) : null;
const unpaused = () => { const p = clone(owner); VC.setPause(p, false); return p; };
const freshRec = () => VC.normalizeProg({}, PACK);

(async () => {
console.log("\n[A1] the flag");
check("appViewOn: zh pack sets v2; absent / other values are off", VC.appViewOn(PACK) && !VC.appViewOn(OFF) && !VC.appViewOn(Object.assign({}, PACK, { appView: "v3" })) && !VC.appViewOn(null));
{
  const { api } = await bootWith(PACK, freshRec(), 1); const b = await bootWith(OFF, freshRec(), 1);
  check("boot sets data-appview=\"v2\" on <html> only when the flag is on", api.docAttr("data-appview") === "v2" && b.api.docAttr("data-appview") === undefined);
  const css = appHtml.slice(0, appHtml.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const v2rules = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(sel => /appview/.test(sel));
  check(`every appView rule is scoped to :root[data-appview="v2"] (${v2rules.length} rules)`, v2rules.length > 5 && v2rules.every(sel => sel.split(",").every(x => x.trim().startsWith(':root[data-appview="v2"]'))));
  check("the hdrbar and the theme button are hidden under v2 (CSS)", /:root\[data-appview="v2"\] \.themebtn,:root\[data-appview="v2"\] \.hdrbar\{display:none\}/.test(css));
  check("new tokens: --sect and --stim-top only (no new colour)", /:root\[data-appview="v2"\]\{--sect:22px;--stim-top:clamp\(12px, 8vh, 64px\)\}/.test(css) && !/data-appview[^{]*\{[^}]*#[0-9A-Fa-f]{3,6}/.test(css));
  const fresh0 = api.panel();
  check("fresh record under v2: first-run hints stay (placement), Start, anchor Session 1", /id="hintPlace"/.test(fresh0) && /<p class="pva">Session 1<\/p>/.test(fresh0) && />Start<\/button>/.test(fresh0));
}

console.log("\n[A2] Today home, owner export");
if(!owner) skip(`owner export not found at ${OWNER}`);
else {
  const n = (owner.sessions || 0) + 1;
  const { api } = await bootWith(PACK, clone(owner), 3);
  let h = api.panel(), t = stripTags(h);
  check(`paused owner: anchor "Session ${n}, review only"`, h.includes(`<p class="pva">Session ${n}, review only</p>`));
  check("paused: no Learn row, no separate paused line", !/<span>Learn<\/span>/.test(h) && !/new material paused/.test(t));
  const noCounts = h => !/\d+ items/.test(stripTags(h)) && !/weakest pairs first/.test(h) && !/<td>\d\. /.test(h) && !/words learned so far/.test(h) && !/about 15 minutes/.test(h) && !/class="path"/.test(h);
  check("rows without counts: no item counts, no numbered markers, no path strip, no learned total, no minutes", noCounts(h));
  check("goal line: the Progress v2 goal component, the tap target to Progress", /<div class="pmv" id="pmap" role="button" tabindex="0" aria-label="Open Progress"><section class="pvg">/.test(h) && /Goal \d of 3/.test(t) && !/■|□|▸/.test(h));
  console.log("INFO  read row: " + (h.match(/<div class="tst"><span>(Read|Listen)<\/span>(?![\s\S]*<span>Read<\/span>)[\s\S]{0,200}/) || [""])[0]);
  check("steps: Review, Listen, Recall, Sentences, Read, one row each", ["Review", "Listen", "Recall", "Sentences"].every(s => h.includes(`<div class="tst"><span>${s}</span>`)) && /<div class="tst"><span>(Read|Listen)<\/span><div class="tsd"><(bdi|ruby|span)/.test(h));
  check("button Start, header Today", /id="go">Start<\/button>/.test(h) && api.title() === "Today");
  const r2 = await bootWith(PACK, unpaused(), 3); h = r2.api.panel(); t = stripTags(h);
  const g = VC.levelGateHold(WORDS, PACK, r2.api.getProg(), CHARACTERS);
  const gs = g ? `HSK ${g.lv} opens at 70% of HSK ${g.prev} known. Now ${g.pct}%.` : "";
  console.log(`INFO  unpaused gate: ${gs || "none"}`);
  check(`unpaused: anchor "Session ${n}"`, h.includes(`<p class="pva">Session ${n}</p>`));
  check("unpaused: Learn row names the set and carries the gate sentence", !!g && /<div class="tst"><span>Learn<\/span><div class="tsd">[^<]*set \d+ of \d+<div class="pvs pvgate">/.test(h) && h.includes(gs) && !/waits ·/.test(h));
  check("unpaused: rows without counts", noCounts(h));
  // Resume: a parked session turns Start into Resume.
  r2.api.el("go").click(); await play(r2.api, { until: (a, n) => n >= 2 }); r2.api.clickTab("words"); r2.api.clickTab("today");
  const h2 = r2.api.panel();
  check("a resumed Today drill keeps the step title (tab re-entry)", r2.api.title() === "Review" && !!r2.api.getD());
  r2.api.clickTab("today");
  check("re-tapped Today: Start reads Resume", r2.api.el("go").textContent === "Resume");
}

console.log("\n[A3] header title per step and per test; [A4] drill end");
if(owner){
  const { api } = await bootWith(PACK, unpaused(), 5);
  const titles = [], ends = [];
  const NAME = ["Review", "Learn", "Listen", "Recall", "Sentences", "Read"];
  let bad = 0, firstMiss = new Set();
  api.el("go").click();
  await play(api, {
    onItem: (a, it) => { titles.push(a.title()); if(a.title() !== NAME[a.at()]) bad++; },
    // Review: the first 3 distinct items wrong, everything else right.
    wrong: (it, k) => { if(api.at() !== 0) return false; if(firstMiss.has(it.key)) return false; if(firstMiss.size < 3 && !it.__seen){ it.__seen = 1; firstMiss.add(it.key); return true; } return false; },
    trace: (kind, a) => { if(kind === "end") ends.push({ at: a.at(), title: a.title(), html: a.panel(), miss: VC.dedupeMisses(a.fin().miss).length }); if(kind === "teach") titles.push("teach:" + a.title()); },
  });
  check(`every drill item: the header names the step (${titles.length} items; ${[...new Set(titles)].join(", ")})`, bad === 0 && titles.length > 20 && titles.includes("Review") && titles.includes("Recall"));
  check("Learn teach screen: header Learn", titles.includes("teach:Learn"));
  const rv = ends.find(e => e.at === 0);
  const rows = rv ? (rv.html.match(/<div class="mrow">/g) || []).length : 0;
  console.log(`INFO  Review end: ${rv ? stripTags(rv.html).slice(0, 160) : "none"}`);
  check(`Review drill end: header Review, "R of N", Missed + one row per missed word (${rows} rows, ${rv && rv.miss} misses)`, !!rv && rv.title === "Review" && /<h2>\d+ of \d+<\/h2>/.test(rv.html) && /<p class="pvk">Missed<\/p>/.test(rv.html) && rows === rv.miss && rows >= 3);
  const rowOk = rv && [...rv.html.matchAll(/<div class="mrow"><button class="mtap" data-mopen="(\d+)" aria-expanded="false" aria-controls="mf\1">([\s\S]*?)<\/button>([\s\S]*?)<\/div><div class="stmt rvb mfull" id="mf\1" hidden>/g)];
  check("each row: the form, a reading, a primary sense (no brackets), a replay; its full reveal hidden in place", rowOk && rowOk.length === rows && rowOk.every(m => /class="mw"/.test(m[2]) && /class="mg"/.test(m[2]) && !/class="gx"/.test(m[2]) && /class="replay" data-wid=/.test(m[3])));
  check("Missed full reveal and wrong-answer rows carry no empty cue/play slot markers", !!rv && !/class="rvk"|class="rvr"/.test(rv.html) && /class="rvrow"/.test(rv.html));
  const mb = api.mopen(0), mf = api.el("mf0");
  check("Missed row tap: the full reveal un-hides in place, aria-expanded true; a second tap folds it", !!rv && mf.hidden === false && mb.attrs["aria-expanded"] === "true" && (api.mopen(0), mf.hidden === true));
  check("Missed row replay: aria-label names the word, not bare Play/Replay", rv && [...rv.html.matchAll(/<button class="replay" data-wid="[^"]*" aria-label="([^"]*)">/g)].length === rows && [...rv.html.matchAll(/<button class="replay" data-wid="[^"]*" aria-label="([^"]*)">/g)].every(m => /^Replay \S/.test(m[1])));
  check("no old drill-end strings: Missed:, Clean., N / M", !/Missed:|Clean\.|<h2>\d+ \/ \d+/.test(rv ? rv.html : "Missed:"));
  const clean = ends.filter(e => e.miss === 0);
  check(`a clean drill: "No misses." (${clean.length} clean drills)`, clean.length > 0 && clean.every(e => /<p class="pvk">No misses\.<\/p>/.test(e.html) && !/mrow/.test(e.html)));
  // Session done after a full session: deltas, motion class, header back to Today.
  const h = api.panel();
  check(`Session done: "Session ${owner.sessions + 1} done", header Today, button Back to Today`, h.includes(`<h2>Session ${owner.sessions + 1} done</h2>`) && api.title() === "Today" && /id="again">Back to Today</.test(h));
  console.log(`INFO  session done: ${stripTags(h)}`);
  api.el("again").click();
  check("Back to Today: the next session's anchor", api.panel().includes(`<p class="pva">Session ${owner.sessions + 2}</p>`) && api.title() === "Today");
  // Tests: the header names the test while it runs, Test on its home.
  api.clickTab("test");
  check("Test home: header Test", api.title() === "Test");
  const tt = [];
  api.el("tRecall").click();
  await play(api, { until: (a, n) => n >= 2 });
  api.clickTab("words"); api.clickTab("test");
  check("a test drill re-entered from another tab keeps its title (Recall, not Test)", !!api.getD() && api.title() === "Recall");
  await play(api, { onItem: a => tt.push(a.title()), until: a => /id="ok"/.test(a.panel()) && !a.getD() });
  check(`Recall test items: header Recall (${tt.length} items)`, tt.length > 0 && tt.every(x => x === "Recall"));
  api.el("ok").click();
  check("after the test: header Test", api.title() === "Test");
}

console.log("\n[A5] Session done: deltas from Start; title only after a reload");
if(owner){
  const { api, st } = await bootWith(PACK, clone(owner), 7);
  api.el("go").click();
  // One passage finished mid-session (a Read step the harness skips): the delta line names it.
  const p = api.getProg(); const pid = PASSAGES.find(x => !(p.read.done || {})[x.id]).id;
  p.read.done[pid] = { sc: 5, n: 5, d: DAY, x: 1 };
  await play(api, {});
  const h = api.panel(), t = stripTags(h);
  check("deltas: one line in the Progress hero style with the reveal motion, +1 passage", /<div class="pvds pvh pvin" id="sdd"><span class="pvd"><b>[+−]\d+<\/b>/.test(h) && /\+1 passage\b/.test(t) && !/words learned so far/.test(t));
  const neg = await bootWith(PACK, clone(owner), 12);
  neg.api.el("go").click();
  Object.keys(neg.api.getProg().w).slice(0, 80).forEach(id => { delete neg.api.getProg().w[id]; });
  await play(neg.api, {});
  check("Session done after words lost mid-session: a negative delta, −N mastered", /<b>−\d+<\/b> mastered/.test(neg.api.panel()));
  // Reload mid-session: the baseline was in memory only.
  const r = await bootWith(PACK, clone(owner), 8);
  r.api.el("go").click();
  let k = 0; await play(r.api, { until: (a, n) => n >= 3 });
  const st2 = { ls: memStore(), ss: memStore() };
  r.st.ls.keys().forEach(key => st2.ls.setItem(key, r.st.ls.getItem(key)));
  const api2 = await boot(PACK, st2, 9);
  check("reload mid-session: the Today drill resumes with the step title", !!api2.getD() && api2.title() === "Review");
  await play(api2, {});
  const h2 = api2.panel();
  check("after the reload: Session done shows its title alone", /<h2>Session \d+ done<\/h2><button class="next" id="again">/.test(h2) && !/id="sdd"/.test(h2));
  // No progress field: a flag-on session stores the same top-level keys as the same session flag off.
  const on = await bootWith(PACK, clone(owner), 10), off = await bootWith(OFF, clone(owner), 10);
  for(const x of [on, off]){ x.api.el("go").click(); await play(x.api, {}); }
  const keys = x => Object.keys(stored(x.st, x === on ? PACK : OFF)).sort().join();
  check("no progress field: a v2 session stores the same top-level keys as flag off", keys(on) === keys(off));
}

console.log("\n[A6] Progress under v2");
if(owner){
  const { api, st } = await bootWith(PACK, unpaused(), 11);
  api.clickTab("progress");
  let h = api.panel();
  const g = VC.levelGateHold(WORDS, PACK, api.getProg(), CHARACTERS);
  check("gate row: the sentence, not the dot string", /<p class="pvs pvgate">HSK \d opens at 70% of HSK \d known\. Now \d+%\.<\/p>/.test(h) && !/waits ·/.test(h) && !!g);
  const gsent = api.gate();
  check("gate row: the very sentence Today shows (gateSentence)", !!gsent && h.includes(`<p class="pvs pvgate">${gsent}</p>`));
  check("Learned total: absent by default", !/id="pvLearned"/.test(h));
  api.el("pvAll").click();
  const ha = api.panel(), lc = api.learned();
  check(`Show all: Learned row appears with the learned count (${lc} of ${WORDS.length})`, lc > 0 && ha.includes(`<div class="pvl" id="pvLearned"><div class="pvt"><span>Learned</span><span class="pvn">${lc} of ${WORDS.length}</span></div></div>`));
  api.el("pvAll").click();
  check("Show less: Learned row gone again", !/id="pvLearned"/.test(api.panel()));
  check("chip: Show pinyin (was Show pronunciation)", /id="togglePron" aria-pressed="(true|false)">Show pinyin<\/button>/.test(h) && !/Show pronunciation/.test(h));
  const th0 = api.getProg().theme;
  check("Settings: Dark theme chip, pressed when the theme is dark", new RegExp(`id="toggleTheme" aria-pressed="${api.docAttr("data-theme") === "dark"}">Dark theme</button>`).test(h));
  const before = stored(st, PACK);
  api.el("toggleTheme").click();
  const after = stored(st, PACK);
  const flip = th0 === "dark" ? "light" : "dark";
  check(`Dark theme chip: prog.theme ${th0} -> ${flip}, the page attribute follows, nothing else in the record changes`, after.theme === flip && api.docAttr("data-theme") === flip && JSON.stringify(Object.assign({}, before, { theme: flip })) === JSON.stringify(after));
  api.el("toggleTheme").click();
  check("Dark theme chip again: back", stored(st, PACK).theme === th0 && api.docAttr("data-theme") === th0);
  check("the header theme button is still in the page (hidden by CSS), the hdrbar too", !!api.el("themebtn") && !!api.el("hdrbar"));
}

console.log(`\n[A7] flag off: byte-identical to ${MAIN} on 3 records (Today, drill ends, Session done, Progress, header)`);
{
  let oldCore = null, oldHtml = null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "av-"));
    const f = path.join(dir, `core_${MAIN}.js`);
    fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); oldCore = require(f);
    oldHtml = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  } catch(e){ oldCore = null; }
  if(!oldCore) skip(`${MAIN} not in this checkout's history`);
  else {
    const hdr = h => h.slice(h.indexOf("<body>"), h.indexOf("<nav"));
    check("static header markup identical", hdr(appHtml) === hdr(oldHtml));
    for(const [name, mk] of [["fresh", freshRec], ["owner export (paused)", () => owner && clone(owner)], ["owner, unpaused copy", () => owner && unpaused()]]){
      const rec = mk(); if(!rec){ skip(`${name}: owner export not found`); continue; }
      const run = async (o) => {
        const { api, st } = await bootWith(OFF, clone(rec), 13, o);
        const tr = [["home", api.title(), api.panel(), api.docAttr("data-appview")]];
        api.el("go").click();
        let k = 0;
        await play(api, { wrong: (it, n) => n % 4 === 1, onItem: a => { if(k++ % 7 === 0) tr.push(["item", a.title()]); }, trace: (kind, a) => tr.push([kind, a.title(), a.panel()]) });
        api.clickTab("progress"); tr.push(["progress", api.title(), api.panel()]);
        api.clickTab("test"); tr.push(["test", api.title(), api.panel()]);
        return { tr, rec: st.ls.getItem(VC.storageKey(OFF)) };
      };
      const a = await run(), b = await run({ core: oldCore, html: oldHtml });
      const diff = a.tr.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(b.tr[i]));
      if(diff >= 0) console.log(`INFO  first difference at ${diff}: ${JSON.stringify(a.tr[diff]).slice(0, 300)} vs ${JSON.stringify(b.tr[diff]).slice(0, 300)}`);
      check(`${name}: ${a.tr.length} screens byte-identical (home, ${a.tr.filter(x => x[0] === "end").length} drill ends, Session done, Progress, Test, header titles); stored records equal`, diff < 0 && a.tr.length === b.tr.length && a.rec === b.rec);
    }
  }
}

// ------------------------------------------------------------------ stage B: the drill card
const BASE_B = "6c591c9"; // stage A head: the flag-off control for the drill card
const PICK = `(() => {
  const ub = VC.unitByWord(CHAR_LIST), cr = VC.charRecs(prog);
  const ok = w => w.w && w.pron && VC.glossSenses(VC.gloss(w)).rest.length > 0 && wordExampleSentences(w, 2).length > 0 && canHearWord(w);
  globalThis.__W = WORDS.find(w => ok(w) && ub.get(w.id) && cr[ub.get(w.id).id]) || WORDS.find(ok);
  globalThis.__U = ub.get(__W.id) || CHAR_LIST[0];
  globalThis.__S = SENTENCES.find(s => canHearSentence(s) && gapIdxs(s).length > 0);
  globalThis.__P = PATTERN_LIST.length ? PATTERN_LIST[0].id : null;
  return __W.id + " " + __U.t;
})()`;
const KINDS = [
  ["meaning MC", "readItem(__W)"], ["recall", "recallItem(__W)"], ["hear word", "hearItem(__W)"],
  ["typed pinyin", "pronTypeItem(__W)"], ["typed meaning", "meaningTypeItem(__W, false)"], ["typed meaning from pinyin", "meaningTypeItem(__W, true)"],
  ["typed characters", "silentWrittenTypeItem(__W)"], ["typed characters, listen", "writtenTypeItem(__W)"], ["typed pinyin from characters", "writtenPronTypeItem(__W)"],
  ["typed word", "typeItem(__W)"], ["hear sentence", "hearSentence(__S)"], ["gap", "gapSentence(__S, false)"], ["gap typed", "gapSentence(__S, true)"],
  ["pattern, first meeting", "__P && patternItem(__P, 0, 0)"], ["pattern, met before", "__P && (VC.notePattern(prog, __P, true, VC.daySn(prog)), patternItem(__P, 1, 0))"],
  ["charPick", 'charDrillItem("charPick", __U)'], ["charRead", 'charDrillItem("charRead", __U)'], ["charSound", 'charDrillItem("charSound", __U)'],
];
// One item on its own drill: the question screen, then answered right or wrong (a typed right answer is the sentinel RIGHT).
function runItem(api, expr, right){
  const made = api.ev(`(() => { const it = ${expr}; if(!it) return false; drill([it], () => {}, missSummary); return true; })()`);
  if(!made) return null;
  const it = api.getCur();
  const r = { label: it.label, kind: it.kind, q: api.panel(), score: api.el("score").textContent, opts: it.kind === "mc" ? api.el("o").children.map(b => b.innerHTML) : [] };
  if(it.kind === "type"){
    if(right){ const c = it.check; it.check = function(v){ return v === "RIGHT" || c.call(this, v); }; }
    api.el("tin").value = right ? "RIGHT" : "zzz"; api.el("submit").click();
  } else {
    const bs = api.el("o").children; (right ? bs.find(b => b.dataset.v === String(it.a)) : bs.find(b => b.dataset.v !== String(it.a))).click();
    r.marks = bs.map(b => [...b._classes].join(" "));
  }
  r.rv = api.el("rv").innerHTML; r.nx = api.el("nx").style.display; r.score2 = api.el("score").textContent; r.cue = !!it.cueUnit; r.hear = !!(it.onReveal && it.revealHear);
  return r;
}
async function runKinds(pack, rec, seed, o){
  const { api } = await bootWith(pack, rec, seed, Object.assign({ patterns: true }, o));
  const pick = api.ev(PICK);
  const out = { pick, rawReveal: api.ev("revealBlock(__W)") };
  for(const [name, expr] of KINDS) out[name] = { right: runItem(api, expr, true), wrong: runItem(api, expr, false) };
  api.ev(`vocabTeach(WORDS.filter(w => String(w.lv) === "3").slice(0, 10), "3", () => {}, 11)`); out.teachWords = api.panel();
  api.ev(`charTeach({ units: CHAR_LIST.slice(40, 43), lv: "3", lvIndex: 19, lvTotal: 30 }, { label: CHAR_CFG.label }, () => {})`); out.teachChars = api.panel();
  return { out, api };
}
const stimOf = (h, label) => { const a = h.indexOf("</p>") + 4; const ends = ['<div class="opts', "<input", '<div class="reveal"'].map(x => h.indexOf(x)).filter(i => i >= 0); return h.slice(a, Math.min(...ends)); };
const noKtag = h => h.replace(/<div class="ktag"[^>]*>[\s\S]*?<\/div>/, "");
const GX = ' <span class="gx">';
const primOf = h => { const i = h.lastIndexOf(GX); return i >= 0 && h.endsWith("</span>") ? h.slice(0, i) : h; };
const aids = h => [...String(h).matchAll(/<ruby>[\s\S]*?<\/ruby>|<span class="t\d">[^<]*<\/span>|<rt>[\s\S]*?<\/rt>/g)].map(m => m[0]);

console.log("\n[B1] drill card CSS");
{
  const css = appHtml.slice(0, appHtml.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  check("--stim-top: clamp(12px, 8vh, 64px), under v2 only", /:root\[data-appview="v2"\]\{[^}]*--stim-top:clamp\(12px, 8vh, 64px\)/.test(css) && (css.match(/--stim-top/g) || []).length === 2);
  check("drill body flex-start at --stim-top under v2 (Today's .top body untouched)", css.includes(':root[data-appview="v2"] .drill-body:not(.top){justify-content:flex-start;padding-top:max(0px, calc(var(--stim-top) - 18px))}'));
  check("label centred above the stimulus", css.includes(':root[data-appview="v2"] .drill-body:not(.top)>.q:first-child{text-align:center;margin-bottom:6px}'));
  check("option numbers hidden only under (hover: none) and (pointer: coarse)", /@media \(hover: none\) and \(pointer: coarse\)\{ :root\[data-appview="v2"\] \.opts button b\.num\{display:none\} \}/.test(css) && (css.match(/b\.num\{display:none\}/g) || []).length === 1);
  check("no new radius, no all-caps, no letter-spacing, no new motion in v2 rules", ![...css.matchAll(/(:root\[data-appview="v2"\][^{]*)\{([^}]*)\}/g)].some(m => /border-radius|text-transform|letter-spacing|animation|transition/.test(m[2])));
}

let ON = null, OFFK = null;
if(owner){
  ON = (await runKinds(PACK, unpaused(), 21)).out; OFFK = (await runKinds(OFF, unpaused(), 21)).out;
  console.log(`INFO  word / unit picked: ${ON.pick}`);
}
console.log("\n[B2] every item kind under v2: no kind tag, placeholders, copy");
if(!ON) skip("owner export not found");
else {
  const all = KINDS.map(([n]) => ON[n]).filter(x => x && x.right);
  check(`${all.length} of ${KINDS.length} kinds rendered`, all.length === KINDS.length);
  check("no kind tag on any item (question and reveal)", all.every(x => !/class="ktag"/.test(x.right.q) && !/class="ktag"/.test(x.wrong.q)));
  check("the label is the first line of the drill body", all.every(x => x.right.q.startsWith('<div class="drill-body"><p class="q">') && !/<p class="q">/.test(x.right.q.slice(30))));
  const ph = n => (ON[n].right.q.match(/placeholder="([^"]*)"/) || [])[1];
  check(`placeholders: pinyin "${ph("typed pinyin")}", meaning "${ph("typed meaning")}", characters "${ph("typed characters")}"`, ph("typed pinyin") === "tones optional" && ph("typed pinyin from characters") === "tones optional" && ph("typed meaning") === "any one meaning" && ph("typed meaning from pinyin") === "any one meaning" && ph("typed characters") === "characters" && ph("typed characters, listen") === "characters");
  check("flag off keeps the old placeholders and tags", /placeholder="pinyin, tones optional…"/.test(OFFK["typed pinyin"].right.q) && /<div class="ktag"/.test(OFFK["typed meaning"].right.q) && /placeholder="characters…"/.test(OFFK["typed characters"].right.q));
  const typed = KINDS.map(([n]) => n).filter(n => ON[n].right.kind === "type");
  check(`every typed miss: "You typed zzz" (${typed.length} typed kinds)`, typed.every(n => ON[n].wrong.rv.includes('<div class="diff">You typed zzz</div>') && !/you typed:/.test(ON[n].wrong.rv)));
  check('hear items: "You heard" (no colon)', ["hear word", "hear sentence"].every(n => ON[n].right.rv.startsWith('<div class="q">You heard</div>') && !/You heard:/.test(ON[n].right.rv)));
  check('pattern cue: "Show meaning" button, aria-label kept', /<button type="button" class="showw" style="margin:0" data-pcue="[^"]+" aria-label="Show meaning">Show meaning<\/button>/.test(ON["pattern, first meeting"].right.q) && />meaning<\/button>/.test(OFFK["pattern, first meeting"].right.q));
}

console.log("\n[B3] stimulus, options and reading aids equal flag off minus the chrome (plan §14)");
if(ON){
  const bad = [];
  let primN = 0, keptN = 0;
  for(const [n] of KINDS) for(const v of ["right", "wrong"]){
    const a = ON[n][v], b = OFFK[n][v];
    if(a.label !== b.label) bad.push(`${n} label`);
    if(stimOf(a.q).replace(">Show meaning</button>", ">meaning</button>") !== noKtag(stimOf(b.q))) bad.push(`${n} stimulus`);
    if(a.opts.length !== b.opts.length || a.opts.some((o, i) => { if(o === b.opts[i]){ if(o.includes(GX)) keptN++; return false; } if(o === primOf(b.opts[i])){ primN++; return false; } return true; })) bad.push(`${n} options`);
    if(JSON.stringify(aids(a.q)) !== JSON.stringify(aids(b.q)) || JSON.stringify(aids(a.rv)) !== JSON.stringify(aids(b.rv))) bad.push(`${n} reading aids`);
    if(JSON.stringify(a.marks) !== JSON.stringify(b.marks) || a.score !== b.score || a.score2 !== b.score2 || a.nx !== b.nx) bad.push(`${n} marks/score/Next`);
  }
  if(bad.length) console.log("INFO  " + bad.join("; "));
  check(`${KINDS.length} kinds x right/wrong: label, stimulus (minus the kind tag), options (bracket-free primary or equal), ruby/tone markup in stimulus and reveal, option marks, score, Next equal (${primN} options lost brackets)`, !bad.length && primN > 0);
  check("reveal text keeps the full gloss with brackets on a right answer", /class="gx"/.test(ON["meaning MC"].right.rv) && /class="gx"/.test(OFFK["meaning MC"].right.rv));
}

console.log("\n[B4] options: primary sense, the collision guard");
if(owner){
  const { api } = await bootWith(PACK, unpaused(), 22, { patterns: true });
  const g = JSON.parse(api.ev(`JSON.stringify((() => { const os = ["to walk; to go", "to walk; to leave", "road; path", "body"]; const f = optsPrimary(os, o => GLOSS_OPT(o)); return os.map(f); })())`));
  check("two options sharing a primary sense keep their brackets; the others show the primary only", g[0] === 'to walk <span class="gx">(to go)</span>' && g[1] === 'to walk <span class="gx">(to leave)</span>' && g[2] === "road" && g[3] === "body");
  const g2 = JSON.parse(api.ev(`JSON.stringify((() => { const os = ["To Walk; to go", "to  walk", "x; y"]; const f = optsPrimary(os, o => GLOSS_OPT(o)); return os.map(f); })())`));
  check("the guard compares the shown text, case and spacing folded (an option without brackets counts)", g2[0] === 'To Walk <span class="gx">(to go)</span>' && g2[2] === "x");
  const g3 = JSON.parse(api.ev(`JSON.stringify((() => { const os = ["to walk; to go", "to go", "body"]; const f = optsPrimary(os, o => GLOSS_OPT(o)); return os.map(f); })())`));
  check("an option whose hidden sense is another option's primary keeps its brackets; the rest show the primary only", g3[0] === 'to walk <span class="gx">(to go)</span>' && g3[1] === "to go" && g3[2] === "body");
  const g4 = JSON.parse(api.ev(`JSON.stringify((() => { const os = ["to walk; to go", "to go; to leave", "body; trunk"]; const f = optsPrimary(os, o => GLOSS_OPT(o)); return os.map(f); })())`));
  check("both options of a primary / hidden-sense clash keep brackets, an unrelated option does not", g4[0].includes('class="gx"') && g4[1].includes('class="gx"') && g4[2] === "body");
  // The guard on the owner export: 7 Today sessions paused, 7 unpaused.
  const count = { mc: 0, br: 0, fired: 0, items: 0, opts: 0, newOpts: 0, newItems: 0 };
  const oldKeep = (hs) => { const key = h => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase(), i = h => h.lastIndexOf(GX), pr = h => i(h) >= 0 && h.endsWith("</span>") ? h.slice(0, i(h)) : h;
    const n = new Map(); hs.forEach(h => n.set(key(pr(h)), (n.get(key(pr(h))) || 0) + 1)); return hs.map(h => n.get(key(pr(h))) > 1); };
  for(const [name, mk] of [["paused", () => clone(owner)], ["unpaused", unpaused]]){
    const { api: a } = await bootWith(PACK, mk(), 31, { patterns: true });
    for(let s = 0; s < 7; s++){
      if(!a.el("go")) break;
      a.el("go").click();
      await play(a, { onItem: (x, it) => { count.items++; if(it.kind !== "mc") return; count.mc++;
        if(it.optHtml && it.opts.some(o => String(it.optHtml(o)).includes(GX))) count.br++;
        if(x.el("o").children.some(b => b.innerHTML.includes(GX))) count.fired++;
        if(it.optHtml){ const full = it.opts.map(o => String(it.optHtml(o))), was = oldKeep(full), bs = x.el("o").children;
          const now = bs.filter(b => b.innerHTML.includes(GX)).length, before = full.filter((h, k) => h.includes(GX) && was[k]).length;
          count.opts += full.length; count.newOpts += now - before; if(now > before) count.newItems++; } }, wrong: (it, n) => n % 7 === 3 });
      a.el("again").click(); NOW += 3600e3;
    }
  }
  console.log(`INFO  owner export, 14 sessions: ${count.items} items, ${count.mc} choice items, ${count.br} with bracketed options, collision guard kept brackets on ${count.fired}; hidden-sense rule newly keeps brackets on ${count.newOpts} of ${count.opts} options in ${count.newItems} items`);
  check(`collision count measured on the owner export's drills: guard fired on ${count.fired} of ${count.br} choice items with bracketed options`, count.mc > 100 && count.br > 0);
  NOW = new Date(2026, 9, 7, 20, 0, 0).getTime();
}

console.log("\n[B5] reveal by verdict");
if(ON){
  const words = ["meaning MC", "recall", "hear word", "typed pinyin", "typed meaning", "typed characters", "typed pinyin from characters", "typed word"];
  const row = x => /<div class="rvrow"><div class="rvm"/.test(x.rv);
  check("word reveals: one answer row (form, reading, gloss with brackets)", words.every(n => row(ON[n].right) && row(ON[n].wrong) && (ON[n].right.rv.match(/class="rvrow"/g) || []).length === 1) && /<span class="rg">[^]*class="gx"/.test(ON["recall"].right.rv));
  const hears = words.filter(n => ON[n].right.hear);
  check(`Replay at the row's end, the same button and id, once, no centred Replay row, no second speaker icon (${hears.length} kinds)`, hears.length >= 5 && hears.every(n => ["right", "wrong"].every(v => { const h = ON[n][v].rv; return (h.match(/id="rvp"/g) || []).length === 1 && /<\/div><button type="button" class="replay" id="rvp" aria-label="Replay">[\s\S]*?<\/button><\/div>/.test(h) && !/rvsay/.test(h) && !/class="rvi"/.test(h); })));
  check("hear word: no Replay and no row icon in the reveal (the card has its speaker); the row still plays on tap", !ON["hear word"].right.hear && !/class="rvi"|id="rvp"/.test(ON["hear word"].right.rv) && /<div class="rvm" data-wid=/.test(ON["hear word"].right.rv));
  check("a word reveal outside the drill (the drill-end Missed box) keeps the row's speaker icon", /<span class="rvi">/.test(ON.rawReveal));
  check("flag off: the centred Replay row as before", /<div class="rvsay"><button type="button" class="replay" id="rvp"/.test(OFFK["recall"].right.rv));
  check("right answer: Examples folded behind a text button", words.every(n => ON[n].right.rv.includes('<button type="button" class="pvc rvxb" id="rvxb" data-rvxb aria-expanded="false" aria-controls="rvx">Examples</button><div class="rvx" id="rvx" hidden>')));
  check("wrong answer (and every You typed): the examples open, no Examples button", words.every(n => /<div class="rvx"><div class="sent/.test(ON[n].wrong.rv) && !/Examples?:/.test(ON[n].wrong.rv) && !/rvxb/.test(ON[n].wrong.rv)));
  const cued = KINDS.map(([n]) => n).filter(n => ON[n].right.cue || ON[n].wrong.cue);
  const cueOk = v => !v.cue || /<\/div><div class="ucue" aria-label="字 \d\/5"><span data-tl lang="zh">字<\/span> [●○]{5}<\/div>/.test(v.rv) && !/letter-spacing/.test(v.rv) && v.rv.indexOf("ucue") > v.rv.indexOf("rvrow");
  check(`unit dots on the row's second line when the streak could move (${cued.join(", ") || "none"})`, cued.length >= 2 && cued.every(n => cueOk(ON[n].right) && cueOk(ON[n].wrong)));
  check("dots absent when nothing moved (recall)", !ON["recall"].right.cue && !/ucue/.test(ON["recall"].right.rv));
  check("sentence reveals keep the centred Replay (no answer row)", /<div class="rvsay">/.test(ON["gap"].right.rv) && !/rvrow/.test(ON["gap"].right.rv));
  check("character reveals: the row, hints open, no Examples", /class="rvrow"/.test(ON["charRead"].right.rv) && !/rvxb/.test(ON["charRead"].right.rv));
  // The Examples tap opens the block in place.
  const { api } = await bootWith(PACK, unpaused(), 21, { patterns: true }); api.ev(PICK);
  runItem(api, "recallItem(__W)", true);
  const box = api.el("rvx"); const b = api.el("rvxb");
  if(box) box.hidden = true; // the fake DOM does not parse the attribute
  check("Examples tap: the block opens in place", !!box && !!b && typeof b.onclick === "function" && (b.click(), box.hidden === false));
  // The live region reads the answer, not the fold: no "Examples" label, none of the hidden example text.
  { const { api: lv } = await bootWith(PACK, unpaused(), 21, { patterns: true }); lv.ev(PICK);
    for(const [what, expr] of [["recall", "recallItem(__W)"], ["meaning MC", "readItem(__W)"]]){
      const r = runItem(lv, expr, true), live = lv.el("live") ? lv.el("live").textContent : null;
      const ex = lv.ev(`(() => { const e = exampleSentencesHTML(__W).replace(/<[^>]+>/g, "").trim(); return e.slice(0, 12); })()`);
      check(`${what}: the live region on a right answer omits "Examples" and the hidden example text (${live === null ? "no live node" : live.length + " chars"})`, !!r && live !== null && live.length > 0 && !/Examples/.test(live) && !!ex && !live.includes(ex)); }
  }
}

console.log("\n[B6] teach cards");
if(ON){
  check('words: anchor "HSK 3, set 12", no instruction line, Drill this set', ON.teachWords.startsWith('<p class="pva">HSK 3, set 12</p>') && !/Tap a word/.test(ON.teachWords) && /id="dr">Drill this set</.test(ON.teachWords));
  check('characters: anchor "HSK 3 characters, set 20 of 30", Drill this set', ON.teachChars.startsWith('<p class="pva">HSK 3 characters, set 20 of 30</p>') && !/Tap one|the written form/.test(ON.teachChars) && /id="dr">Drill this set</.test(ON.teachChars));
  check("teach cards keep the example English and the card body (flag off minus the intro and button)", ON.teachChars.replace(/^<p class="pva">[^<]*<\/p>/, "").replace("Drill this set", "Drill these") === OFFK.teachChars.replace(/^<p class="q">[\s\S]*?<\/p>/, ""));
}

console.log(`\n[B7] flag off: every item kind, teach cards and a session's drill items byte-identical to ${BASE_B} on 3 records`);
{
  let oldCore = null, oldHtml = null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avb-"));
    const f = path.join(dir, `core_${BASE_B}.js`);
    fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${BASE_B}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); oldCore = require(f);
    oldHtml = cp.execSync(`git -C "${ROOT}" show ${BASE_B}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  } catch(e){ oldCore = null; }
  if(!oldCore) skip(`${BASE_B} not in this checkout's history`);
  else for(const [name, mk] of [["fresh", freshRec], ["owner export (paused)", () => owner && clone(owner)], ["owner, unpaused copy", () => owner && unpaused()]]){
    const rec = mk(); if(!rec){ skip(`${name}: owner export not found`); continue; }
    const a = (await runKinds(OFF, clone(rec), 41)).out, b = (await runKinds(OFF, clone(rec), 41, { core: oldCore, html: oldHtml })).out;
    const walk = async o => {
      const { api } = await bootWith(OFF, clone(rec), 43, Object.assign({ patterns: true }, o)); const tr = [];
      api.el("go").click();
      await play(api, { wrong: (it, n) => n % 4 === 1, onItem: x => tr.push(["q", x.panel(), x.el("score").textContent, x.el("o") ? x.el("o").children.map(c => c.innerHTML) : []]),
        afterAnswer: x => tr.push(["a", x.el("rv").innerHTML, x.el("nx").style.display]), trace: (k, x) => tr.push([k, x.panel()]) });
      return tr;
    };
    const w1 = await walk(), w2 = await walk({ core: oldCore, html: oldHtml });
    const kindsSame = KINDS.every(([n]) => JSON.stringify(a[n]) === JSON.stringify(b[n]));
    const diff = w1.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(w2[i]));
    if(!kindsSame) console.log("INFO  differs: " + KINDS.map(([n]) => n).filter(n => JSON.stringify(a[n]) !== JSON.stringify(b[n])).join(", "));
    if(diff >= 0) console.log(`INFO  walk first difference at ${diff}: ${JSON.stringify(w1[diff]).slice(0, 300)} vs ${JSON.stringify(w2[diff]).slice(0, 300)}`);
    check(`${name}: ${KINDS.length} kinds (question, options, typed field, reveal right + wrong), word + character teach cards, and a Today session's ${w1.filter(x => x[0] === "q").length} items + ${w1.filter(x => x[0] === "teach").length} teach screens byte-identical`, kindsSame && a.teachWords === b.teachWords && a.teachChars === b.teachChars && diff < 0 && w1.length === w2.length);
  }
}

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
})();
