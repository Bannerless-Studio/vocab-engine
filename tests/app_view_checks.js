// pack.appView "v2" (docs/PACK_SCHEMA.md "appView"; owner 2026-10-07), stage A: [A1] the flag; [A2] Today home
// on the owner export (anchor, paused anchor, step rows without counts, gate sentence, goal line); [A3] header
// title per step and per test; [A4] drill end (Missed rows, No misses.); [A5] Session done (deltas from Start,
// title only after a reload); [A6] Progress (gate sentence, Show pinyin, Dark theme chip writes prog.theme only);
// [A7] (flag-off control vs 8604b17) deleted: appView is engine default since the flag collapse (stage 2).
// Stage B, the drill card: [B1] CSS (--stim-top, flex-start, centred label, option numbers hidden on coarse pointers
// only); [B2] every item kind under v2 (no kind tag, placeholders, copy); [B3] the stimulus, option and reading-aid
// markup equal flag off minus the chrome (plan §14); [B4] options primary sense only + the collision guard, and the
// guard count on the owner export's drills; [B5] reveal by verdict (answer row, inline Replay, unit dots, Examples
// fold); [B6] teach cards; [B7] (flag-off control vs 6c591c9) deleted with the flag collapse.
// Stage C, the tabs: [C1] CSS (page font on passage/lesson rows, segmented level row, muted contrast); [C2] Read list
// (anchor level, unread first, tick vs "4 of 5", finished levels folded + tap opens + refold on leaving, locked line);
// [C3] reader, listening pass, question, verdict, results (missed open, right folded) and storage equal flag off; [C4] Words
// (segmented levels, set nav, Next new rule, Review ghost, Pinyin chip, search); [C5] Test order by placedOnce; [C6] Sounds;
// [C7] notices; [C8] flag off: those screens byte-identical to 9bf0e78 on 4 records.
// appView is engine default since the flag collapse (stage 2): every flag-off control ([A7], [B3], [B7], [C8], the D1 and
// D5 flag-off checks) went with it; the rest checks the v2 render on its own.
// Run: node tests/app_view_checks.js [owner export path]
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, withCollapsed } = require("./lib/pack_flags.js");
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
function makeFakeDom(srcHtml){
  const H = srcHtml || appHtml; // an older sha's app.html registers its own ids
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
    insertAdjacentHTML(pos, html){ (this._ins = this._ins || []).push([pos, String(html)]); }
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
      if(!this._tmp && !/data-(pcue|showw)/.test(sel)) return []; // the panel answers only the hint-link query (dropStimLinks)
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
  const tabsMatch = H.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/);
  const btnRe = /<button([^>]*)>/g;
  let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
  registerIdsFromHtml(H.slice(H.indexOf("<body>"), H.indexOf("<nav")));
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
  if(o.core && o.core !== VC) pack = withCollapsed(pack); // an older engine: the collapsed keys at their live values
  Math.random = mulberry32(seed);
  const document = makeFakeDom(o.html);
  const voices = o.voices || [{ lang:"zh-CN", name:"x" }];
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
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent: o.ua || "AppViewChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
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
check("appView is engine default (flag collapse stage 2): core has no appViewOn, the zh pack no appView key", VC.appViewOn === undefined && !("appView" in PACK));
{
  const { api } = await bootWith(PACK, freshRec(), 1); const b = await bootWith(OFF, freshRec(), 1);
  check("boot sets data-appview=\"v2\" on <html> for every pack (engine default since the flag collapse)", api.docAttr("data-appview") === "v2" && b.api.docAttr("data-appview") === "v2");
  const css = appHtml.slice(0, appHtml.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const v2rules = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(sel => /appview/.test(sel));
  check(`every appView rule is scoped to :root[data-appview="v2"] (${v2rules.length} rules)`, v2rules.length > 5 && v2rules.every(sel => sel.split(",").every(x => x.trim().startsWith(':root[data-appview="v2"]'))));
  check("Words list (fb46): one word column for every row under v2 (#wl grid, fit-content word column capped at 50%, rows on a subgrid, 44px min, long headwords wrap inside it), scoped like the rest",
    /@supports \(grid-template-columns: subgrid\)\{\s*:root\[data-appview="v2"\] #wl\{display:grid;grid-template-columns:fit-content\(50%\) minmax\(0,1fr\)/.test(css) &&
    /:root\[data-appview="v2"\] #wl \.wl\{display:grid;grid-column:1\/-1;grid-template-columns:subgrid;[^}]*min-height:44px/.test(css) &&
    /:root\[data-appview="v2"\] #wl \.wl \.wd\{max-width:none;min-width:0;white-space:normal;overflow-wrap:anywhere\}/.test(css) && !/(^|\})\s*#wl\{/.test(css));
  check("the hdrbar and the header theme button are gone (markup and CSS; the flag collapse)", !/themebtn|hdrbar/.test(appHtml));
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
  // fb41: the sentence ends with the gate estimate (tests/eta_checks.js).
  const eta = VC.levelOpensIn(WORDS, PACK, r2.api.getProg(), CHARACTERS);
  const gs = g ? `HSK ${g.lv} opens at 70% of HSK ${g.prev} known. Now ${g.pct}%, ${(r => r > 999 ? "≈\u00a0999+ sessions" : `≈\u00a0${r} session${r === 1 ? "" : "s"}`)(eta >= 100 ? Math.round(eta / 10) * 10 : eta)}.` : "";
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
  check("Missed row replay: aria-label speaks the written word, never an id (w0518)", !!rv && (() => { const rs = [...rv.html.matchAll(/data-wid="([^"]*)" aria-label="Replay ([^"]*)"/g)]; return rs.length > 0 && rs.every(m => BY_ID[m[1]] && !/^[a-z]\d+$/i.test(m[2]) && m[2] === (BY_ID[m[1]].say || BY_ID[m[1]].w)); })());
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
  check("gate row: the sentence, not the dot string", /<p class="pvs pvgate">HSK \d opens at 70% of HSK \d known\. Now \d+%, ≈\u00a0\d+\+? sessions?\.<\/p>/.test(h) && !/waits ·/.test(h) && !!g);
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
  check("no header theme button, no hdrbar (the flag collapse removed them)", !api.el("themebtn") && !api.el("hdrbar"));
}

// [A7] (flag off: byte-identical to 8604b17) deleted: appView is engine default since the flag collapse (stage 2).

// ------------------------------------------------------------------ stage B: the drill card
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
  r.after = api.panel(); r.head = api.el("rv").innerHTML; r.tail = api.el("rvtail") ? api.el("rvtail").innerHTML : ""; r.rv = r.head + r.tail; r.nx = api.el("nx").style.display; r.score2 = api.el("score").textContent; r.cue = !!it.cueUnit; r.hear = !!(it.onReveal && it.revealHear);
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
  // A radius is allowed only at a value the base CSS already uses (stage C's segmented level row: 12px, as .ghost).
  const baseRadii = new Set([...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => !/appview/.test(m[1])).flatMap(m => [...m[2].matchAll(/border-radius:([^;}]+)/g)].map(r => r[1].trim())));
  check("no new radius, no all-caps, no letter-spacing, no new motion in v2 rules", ![...css.matchAll(/(:root\[data-appview="v2"\][^{]*)\{([^}]*)\}/g)].some(m => /text-transform|letter-spacing|animation|transition/.test(m[2]) || [...m[2].matchAll(/border-radius:([^;}]+)/g)].some(r => !baseRadii.has(r[1].trim()))));
}

let ON = null;
if(owner){
  ON = (await runKinds(PACK, unpaused(), 21)).out;
  console.log(`INFO  word / unit picked: ${ON.pick}`);
}
console.log("\n[B2] every item kind under v2: no kind tag, placeholders, copy");
if(!ON) skip("owner export not found");
else {
  const all = KINDS.map(([n]) => ON[n]).filter(x => x && x.right);
  check(`${all.length} of ${KINDS.length} kinds rendered`, all.length === KINDS.length);
  check("no kind tag on any item (question and reveal)", all.every(x => !/class="ktag"/.test(x.right.q) && !/class="ktag"/.test(x.wrong.q)));
  check("the label is the first line of the drill body", all.every(x => /^<div class="drill-body( sent)?"><p class="q">/.test(x.right.q) && !/<p class="q">/.test(x.right.q.slice(34))));
  const ph = n => (ON[n].right.q.match(/placeholder="([^"]*)"/) || [])[1];
  check(`placeholders: pinyin "${ph("typed pinyin")}", meaning "${ph("typed meaning")}", characters "${ph("typed characters")}"`, ph("typed pinyin") === "tones optional" && ph("typed pinyin from characters") === "tones optional" && ph("typed meaning") === "any one meaning" && ph("typed meaning from pinyin") === "any one meaning" && ph("typed characters") === "characters" && ph("typed characters, listen") === "characters");
  const typed = KINDS.map(([n]) => n).filter(n => ON[n].right.kind === "type");
  check(`every typed miss: "You typed zzz" (${typed.length} typed kinds)`, typed.every(n => ON[n].wrong.rv.includes('<div class="diff">You typed zzz</div>') && !/you typed:/.test(ON[n].wrong.rv)));
  check('hear items: "You heard" (no colon)', ["hear word", "hear sentence"].every(n => ON[n].right.rv.startsWith('<div class="q">You heard</div>') && !/You heard:/.test(ON[n].right.rv)));
  check('pattern cue on a later meeting: "Show meaning" button, aria-label kept', /<button type="button" class="showw" style="margin:0" data-pcue="[^"]+" aria-label="Show meaning">Show meaning<\/button>/.test(ON["pattern, met before"].right.q));
  { const q = ON["pattern, first meeting"].right.q;
    check("pattern cue on the first meeting: the English open in the cue block, no link", /<div class="q cue">[^<]+<\/div>/.test(q) && !/data-pcue/.test(q) && !/Show meaning/.test(q)); }
}

// [B3] (stimulus, options and reading aids equal flag off minus the chrome) deleted: appView is engine default since the flag collapse.
console.log("\n[B3] reveal gloss");
if(ON){
  check("reveal text keeps the full gloss with brackets on a right answer", /class="gx"/.test(ON["meaning MC"].right.rv));
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
  check("right answer (fb45): the examples open under the row, as on a miss, no Examples button, nothing hidden", words.every(n => /<div class="rvx"><div class="sent/.test(ON[n].right.rv) && !/rvxb|\shidden[\s>=]|Examples/.test(ON[n].right.rv)));
  check("reveal order after any answer (fb51, reverses fb45): answer row then the open examples, both in #rv; no tail slot", words.every(n => ["right", "wrong"].every(v => { const x = ON[n][v]; return /class="rvrow"/.test(x.head) && x.head.indexOf('class="rvrow"') < x.head.indexOf('<div class="rvx"><div class="sent') && x.tail === ""; })));
  { const { api } = await bootWith(PACK, unpaused(), 21, { patterns: true }); api.ev(PICK); runItem(api, "recallItem(__W)", true);
    const h = api.panel(), pos = id => h.indexOf(`id="${id}"`);
    check("DOM order: answer row and examples (#rv), then Next (#nx) last, no #rvtail", pos("rv") > 0 && pos("rv") < pos("nx") && !/rvtail/.test(h) && api.el("rv").innerHTML.includes('class="rvx"') && h.indexOf('id="nx"') > h.indexOf('id="rv"'));
    check("a missed item's reveal (typed, wrong) keeps the same order", (() => { const r = runItem(api, "typeItem(__W)", false); const g = api.panel(); return !!r && g.indexOf('id="rv"') < g.indexOf('id="nx"') && api.el("rv").innerHTML.includes('class="rvx"') && !/rvtail/.test(g); })()); }
  {
    check("no dead .rvtail rules: the examples sit in .reveal, which carries the font size and the data-tlrtl right-align rule", !/rvtail/.test(appHtml) && /\.reveal\{[^}]*font-size:15px/.test(appHtml) && /:root\[data-tlrtl\] \.reveal,:root\[data-tlrtl\] \.rvb\{text-align:right\}/.test(appHtml));
  }
  check("wrong answer (and every You typed): the examples open", words.every(n => /<div class="rvx"><div class="sent/.test(ON[n].wrong.rv) && !/Examples?:/.test(ON[n].wrong.rv) && !/rvxb/.test(ON[n].wrong.rv)));
  const cued = KINDS.map(([n]) => n).filter(n => ON[n].right.cue || ON[n].wrong.cue);
  const cueOk = v => !v.cue || /<\/div><div class="ucue" aria-label="字 \d\/5"><span data-tl lang="zh">字<\/span> [●○]{5}<\/div>/.test(v.rv) && !/letter-spacing/.test(v.rv) && v.rv.indexOf("ucue") > v.rv.indexOf("rvrow");
  check(`unit dots on the row's second line when the streak could move (${cued.join(", ") || "none"})`, cued.length >= 2 && cued.every(n => cueOk(ON[n].right) && cueOk(ON[n].wrong)));
  check("dots absent when nothing moved (recall)", !ON["recall"].right.cue && !/ucue/.test(ON["recall"].right.rv));
  check("sentence reveals keep the centred Replay (no answer row)", /<div class="rvsay">/.test(ON["gap"].right.rv) && !/rvrow/.test(ON["gap"].right.rv));
  check("character reveals: the row, hints open, no Examples", /class="rvrow"/.test(ON["charRead"].right.rv) && !/rvxb/.test(ON["charRead"].right.rv));
  // The live region reads the answer and now the examples (fb45): no "Examples" label, the example text included.
  { const { api: lv } = await bootWith(PACK, unpaused(), 21, { patterns: true }); lv.ev(PICK);
    for(const [what, expr] of [["recall", "recallItem(__W)"], ["meaning MC", "readItem(__W)"]]){
      const r = runItem(lv, expr, true), live = lv.el("live") ? lv.el("live").textContent : null;
      const rvh = lv.el("rv").innerHTML, ex = (rvh.slice(rvh.indexOf('<div class="rvx">')).match(/<ruby>([^<]+)/) || [])[1] || "";
      check(`${what}: the live region on a right answer has the example text and no "Examples" label (${live === null ? "no live node" : live.length + " chars"})`, !!r && live !== null && live.length > 0 && !/Examples/.test(live) && !!ex && live.includes(ex)); }
  }
}

console.log("\n[B6] teach cards");
if(ON){
  check('words: anchor "HSK 3, set 12", no instruction line, Drill this set', ON.teachWords.startsWith('<p class="pva">HSK 3, set 12</p>') && !/Tap a word/.test(ON.teachWords) && /id="dr">Drill this set</.test(ON.teachWords));
  check('characters: anchor "HSK 3 characters, set 20 of 30", Drill this set', ON.teachChars.startsWith('<p class="pva">HSK 3 characters, set 20 of 30</p>') && !/Tap one|the written form/.test(ON.teachChars) && /id="dr">Drill this set</.test(ON.teachChars));
}

// [B7] (flag off: every item kind byte-identical to 6c591c9) deleted: appView is engine default since the flag collapse.
const LV_LABEL = lv => `HSK ${lv}`;
const pidsIn = h => [...h.matchAll(/<button data-pid="([^"]+)"/g)].map(m => m[1]);
// Answers every question of the passage on screen: wrongAt(i) answers question i wrong. Returns the results html.
function answerPassage(api, wrongAt){
  const p = api.rd().p;
  for(let i = 0; i < p.questions.length; i++){
    const q = p.questions[i], btns = api.el("o").children;
    (wrongAt(i) ? btns.find(b => b.dataset.v !== String(q.answer)) : btns.find(b => b.dataset.v === String(q.answer))).click();
    api.el("nx").click();
  }
  return api.panel();
}
// One walk over every stage C surface; returns [name, html] pairs (flag-off control and flag-on probes share it).
async function walkTabs(pack, rec, seed, o){
  const { api, st } = await bootWith(pack, rec, seed, o); const tr = [];
  const put = (n, h) => tr.push([n, h === undefined ? api.panel() + (/id="wbody"/.test(api.panel()) ? api.el("wbody").innerHTML : "") : h, api.title()]);
  api.clickTab("read"); put("read list");
  if(api.el("rfold")){ api.el("rfold").click(); put("read list opened"); }
  const pid = api.ev(`(() => { const p = PASSAGE_LIST.find(x => !passageDone(x) && readLevelsNow().some(l => l.lv === x.lv && l.unlocked)) || PASSAGE_LIST[0]; startPassage(p); return p.id; })()`);
  put("reader " + pid);
  api.el("rdone").click(); put("question 1");
  const q0 = api.rd().p.questions[0];
  api.el("o").children.find(b => b.dataset.v !== String(q0.answer)).click(); put("verdict wrong", api.el("rv").innerHTML); api.el("nx").click();
  const q1 = api.rd().p.questions[1];
  api.el("o").children.find(b => b.dataset.v === String(q1.answer)).click(); put("verdict right", api.el("rv").innerHTML); api.el("nx").click();
  const n = api.rd().p.questions.length;
  for(let i = 2; i < n; i++){ const q = api.rd().p.questions[i]; api.el("o").children.find(b => b.dataset.v === String(q.answer)).click(); api.el("nx").click(); }
  put("results one miss");
  api.el("rlist").click(); put("read list after");
  api.ev(`startPassage(PASSAGE_LIST.find(x => passageDone(x)) || PASSAGE_LIST[0], false, "listen")`); put("listening pass");
  api.el("rdone").click(); put("listening question");
  api.clickTab("words"); put("words default");
  api.el("pv").click(); put("words previous set");
  const lv2 = LEVELS_ZH[1]; (api.el("wl_" + lv2) && pack.appView ? api.el("wl_" + lv2) : null) ? api.el("wl_" + lv2).click() : api.ev(`wordsLv = ${JSON.stringify(lv2)}; wordsSet = null; renderWordBody()`); put("words level 2");
  api.el("wsearch").value = "tea"; api.el("wsearch").oninput(); await new Promise(r => setTimeout(r, 150)); put("words search");
  api.clickTab("test"); put("test home");
  api.ev(`testSel = "placement"; testRender()`); put("placement screen");
  api.clickTab("sounds"); put("sounds list");
  api.ev(`soundsSel = 0; soundsRender()`); put("lesson");
  put("speech notice", api.ev(`(() => { const h = hasSpeech; hasSpeech = false; noticeShown = false; const r = speechNotice(); hasSpeech = h; return r; })()`));
  put("samsung notice", api.ev("samsungNoticeHTML"));
  return { tr, api, st };
}
const LEVELS_ZH = VC.levelIds(PACK);

console.log("\n[C1] stage C CSS");
{
  const css = appHtml.slice(0, appHtml.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  check("passage and lesson rows in the page font under v2 only (.plist button font-family var(--font))", css.includes(':root[data-appview="v2"] .plist button{font-family:var(--font)}') && !/(^|\})\s*\.plist button\{[^}]*font-family/.test(css));
  check("segmented level row: one bordered row, equal 44px segments, the pressed one inked", css.includes(':root[data-appview="v2"] .wseg button{flex:1 1 0;min-width:0;min-height:44px') && css.includes(':root[data-appview="v2"] .wseg button.on{background:var(--ink);color:var(--bg)}'));
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const tok = (name, dark) => { const m = [...appHtml.matchAll(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`, "g"))].map(x => x[1]); return dark ? m[m.length - 1] : m[0]; };
  const rs = [["light", false], ["dark", true]].map(([n, d]) => [n, ratio(tok("mute", d), tok("bg", d)), ratio(tok("mute", d), tok("card", d))]);
  check(`muted text (score "4 of 5", locked line, fold line, Next new count) meets 4.5:1 on bg and card (${rs.map(([n, a, b]) => `${n} ${a.toFixed(2)}/${b.toFixed(2)}`).join(", ")})`, rs.every(([, a, b]) => a >= 4.5 && b >= 4.5));
}

console.log("\n[C2] Read list, owner export");
if(owner){
  const rec = clone(owner);
  const pdone = Object.keys(rec.read.done);
  const imperfect = pdone.find(id => rec.read.done[id].sc < rec.read.done[id].n);
  const { api } = await bootWith(PACK, rec, 51);
  api.clickTab("read");
  const h = api.panel(), t = stripTags(h), prog = api.getProg();
  const lvls = VC.readingLevels(PASSAGES, WORDS, PACK, prog).filter(l => l.count > 0);
  const open = lvls.filter(l => l.unlocked), anchor = open[open.length - 1];
  const psOf = lv => PASSAGES.filter(p => p.lv === lv), isDone = p => !!prog.read.done[p.id];
  const fin = open.filter(l => l !== anchor && psOf(l.lv).every(isDone));
  console.log(`INFO  anchor ${LV_LABEL(anchor.lv)}; folded ${fin.map(l => l.lv).join(",")}; locked ${lvls.filter(l => !l.unlocked).map(l => l.lv).join(",")}`);
  const firstHead = (h.match(/<div class="rlv"><div class="pvt"><span>([^<]+)<\/span><span class="pvn">(\d+) of (\d+) read<\/span><\/div>/) || []);
  check(`anchor: the highest open level first, "${LV_LABEL(anchor.lv)}  N of M read"`, firstHead[1] === LV_LABEL(anchor.lv) && +firstHead[2] === psOf(anchor.lv).filter(isDone).length && +firstHead[3] === psOf(anchor.lv).length);
  const ap = psOf(anchor.lv), want = ap.filter(p => !isDone(p)).concat(ap.filter(isDone)).map(p => p.id);
  check(`anchor rows: unread first in pack order, then read (${want.length} rows)`, JSON.stringify(pidsIn(h).slice(0, want.length)) === JSON.stringify(want));
  const tNoLk = stripTags(h.replace(/<p class="pvs rlk"[^>]*>[^<]*<\/p>/g, ""));
  check("no intro once a passage is done; no word counts on rows; no middle-dot strings (locked lines aside)", !/Short passages built/.test(h) && !/\d+ words/.test(tNoLk) && !/ · /.test(t));
  const finIds = fin.flatMap(l => psOf(l.lv).map(p => p.id));
  const finN = finIds.length;
  check(`finished levels fold into one line "${fin.length > 1 ? `HSK ${fin[0].lv}–${fin[fin.length - 1].lv}` : ""}" (${finN} passages, all read), their rows absent`, fin.length >= 2 && h.includes(`<button class="pvc" id="rfold" aria-expanded="false" aria-label="HSK ${fin[0].lv}–${fin[fin.length - 1].lv}, all read"><span>HSK ${fin[0].lv}–${fin[fin.length - 1].lv}</span></button>`) && finIds.every(id => !pidsIn(h).includes(id)));
  const marks = [...h.matchAll(/<button data-pid="([^"]+)"><span>[\s\S]*?<\/span>(<span class="(tick|rsc)"[^>]*>([^<]*)<\/span>)?<\/button>/g)];
  const markOk = marks.length === pidsIn(h).length && marks.every(m => { const d = prog.read.done[m[1]]; if(!d) return !m[2]; return d.sc >= d.n ? m[3] === "tick" && m[4] === "✓" && m[2].includes(`aria-label="${d.sc} of ${d.n}"`) : m[3] === "rsc" && m[4] === `${d.sc} of ${d.n}`; });
  const shownImperfect = marks.filter(m => m[3] === "rsc").length;
  check(`perfect score: a tick alone; imperfect: "4 of 5"; unread: nothing (${marks.length} rows, ${shownImperfect} imperfect shown)`, markOk && marks.some(m => m[3] === "tick"));
  const lk = lvls.filter(l => !l.unlocked);
  const hold = VC.levelGateHold(WORDS, PACK, prog, CHARACTERS);
  const lkOk = lk.every(l => { const s = `HSK ${l.lv} passages open at 70% of its words learned. Now ${l.learned} of ${l.total}.${hold && String(hold.lv) === String(l.lv) ? ` New HSK ${l.lv} words wait on HSK ${hold.prev}.` : ""}`; return h.includes(`<p class="pvs rlk" data-locked="${l.lv}">${s}</p>`); });
  check(`locked level: one quiet line, no box (${lk.map(l => stripTags((h.match(new RegExp(`data-locked="${l.lv}">[^<]*`)) || [""])[0].replace(/^[^>]*>/, ""))).join(" | ")})`, lk.length > 0 && lkOk && !/class="stmt" data-locked/.test(h));
  api.el("rfold").click();
  const h2 = api.panel();
  check("fold tap: the finished levels open in place with their rows, the line goes", !/id="rfold"/.test(h2) && finIds.every(id => pidsIn(h2).includes(id)) && fin.every(l => h2.includes(`<span>${LV_LABEL(l.lv)}</span><span class="pvn">${psOf(l.lv).length} of ${psOf(l.lv).length} read</span>`)));
  if(imperfect && finIds.includes(imperfect)) check("an opened finished level shows its imperfect score", h2.includes(`data-pid="${imperfect}"`) && new RegExp(`data-pid="${imperfect}"[\\s\\S]*?<span class="rsc">${rec.read.done[imperfect].sc} of ${rec.read.done[imperfect].n}</span>`).test(h2));
  api.clickTab("read");
  check("re-tapped Read: stays open (same tab)", !/id="rfold"/.test(api.panel()));
  api.clickTab("today"); api.clickTab("read");
  check("leaving the tab folds again", /id="rfold"/.test(api.panel()));
  const f = await bootWith(PACK, freshRec(), 51); f.api.clickTab("read");
  const fh = f.api.panel();
  check("fresh record: the intro shows (no passage done yet), no fold line", /Short passages built from this course's words/.test(fh) && !/id="rfold"/.test(fh));
}

console.log("\n[C3] reader, listening pass, question, verdict, results");
if(owner){
  const { tr, api } = await walkTabs(PACK, clone(owner), 52);
  const get = n => (tr.find(x => x[0].startsWith(n)) || [])[1] || "";
  const rd = get("reader ");
  check('reader: ghost "Passages" back button, title, no level/word-count line once a passage is done', /^<button class="ghost rback" id="rback">Passages<\/button>/.test(rd) && /class="ptitle"/.test(rd) && !/words\. Tap a word|Tap a word to see/.test(rd) && !/‹/.test(rd));
  const f = await bootWith(PACK, freshRec(), 52);
  f.api.ev(`startPassage(PASSAGE_LIST[0])`);
  check('first passage ever: "Tap a word to see its meaning." with no level or count', f.api.panel().includes('<p class="q">Tap a word to see its meaning.</p>') && !/ · /.test(f.api.panel()));
  const q = get("question 1");
  check('question screen: no "Question 1 / N" line (the header counts)', !/Question \d+ \//.test(q) && /<div class="drill-body top">\s*<div class="med wd"/.test(q));
  const vw = get("verdict wrong"), vr = get("verdict right");
  check('verdict: "Right." / "Not quite." then the highlighted sentence, no "The answer is in this sentence:"', /^<div class="q" style="margin:0 0 6px">Not quite\.<\/div><div class="stmt hi"/.test(vw) && /^<div class="q" style="margin:0 0 6px">Right\.<\/div><div class="stmt hi"/.test(vr) && !/answer is in this sentence/.test(vw + vr));
  const res = get("results one miss"), n = (res.match(/<h2>(\d+) of (\d+)<\/h2>/) || []);
  check(`results: "${n[1]} of ${n[2]}", Missed with the one missed question open`, +n[2] - +n[1] === 1 && /<p class="pvk">Missed<\/p><div class="stmt"/.test(res) && (res.slice(res.indexOf("Missed"), res.indexOf('id="rright"')).match(/<div class="stmt"/g) || []).length === 1);
  check(`results: the right answers fold into one line "${+n[1]} right", hidden until tapped`, res.includes(`<button class="pvc" id="rright" aria-expanded="false" aria-controls="rrbox"><span>${n[1]} right</span></button><div id="rrbox" hidden>`) && (res.slice(res.indexOf('id="rrbox"')).match(/<div class="stmt"/g) || []).length === +n[1]);
  check("results: no ✓/✗ Question N markers", !/[✓✗] Question \d/.test(res));
  // The fold opens on a tap.
  const r2 = await bootWith(PACK, clone(owner), 53);
  r2.api.ev(`startPassage(PASSAGE_LIST.find(x => passageDone(x)))`); r2.api.el("rdone").click();
  answerPassage(r2.api, i => i === 0);
  const box = r2.api.el("rrbox"), btn = r2.api.el("rright");
  check("right-answers line: tap opens the block, aria-expanded true; tap again folds", box.hidden === true && (btn.click(), box.hidden === false && btn.getAttribute("aria-expanded") === "true") && (btn.click(), box.hidden === true));
  // A clean pass with no taps: no weak words, so nothing (was "No weak words from this passage.").
  const r3 = await bootWith(PACK, clone(owner), 54);
  r3.api.ev(`startPassage(PASSAGE_LIST.find(x => passageDone(x)))`); r3.api.el("rdone").click();
  const clean = answerPassage(r3.api, () => false);
  check('clean pass: no Missed section, "N right" line, "No weak words" becomes whitespace', !/Missed/.test(clean) && /id="rright"/.test(clean) && !/No weak words/.test(clean) && /id="rlist"[^>]*>Back to passages</.test(clean));
  const lp = get("listening pass");
  check('listening pass: "Listening pass" alone (no level, no sentence count)', lp.includes('<p class="q">Listening pass</p>') && !/sentences?\. Listen/.test(lp) && /id="rback">Passages</.test(lp));
  check("Read back button returns to the list", (() => { const { api: a } = { api: r2.api }; a.ev(`startPassage(PASSAGE_LIST[0])`); a.el("rback").click(); return /data-pid=/.test(a.panel()) && !a.rd(); })());
}

if(owner){
  const noAv = Object.assign({}, PACK); delete noAv.appView;
  const a = await walkTabs(PACK, clone(owner), 62), b = await walkTabs(noAv, clone(owner), 62);
  check("storage: the same walk (Read list fold, a passage with one miss, a listening pass, Words, Test, Sounds) stores the same record with and without appView", a.st.ls.getItem(VC.storageKey(PACK)) === b.st.ls.getItem(VC.storageKey(PACK)) && JSON.stringify(a.st.ls.keys().sort()) === JSON.stringify(b.st.ls.keys().sort()));
}

console.log("\n[C4] Words tab");
if(owner){
  const { tr, api } = await walkTabs(PACK, clone(owner), 55);
  const get = n => (tr.find(x => x[0] === n) || [])[1] || "";
  const d = get("words default");
  check("one segmented level row, the shown level pressed", new RegExp(`<div class="wseg" role="group" aria-label="Level">${LEVELS_ZH.map(lv => `<button data-l="${lv}" id="wl_${lv}" class="(on)?" aria-pressed="(true|false)">HSK ${lv}</button>`).join("")}</div>`).test(d) && (d.match(/aria-pressed="true">HSK/g) || []).length === 1);
  const sn = d.match(/<span class="pvn">Set (\d+) of (\d+)( ✓)?<\/span>/);
  check(`set nav on one line: "‹ Set ${sn && sn[1]} of ${sn && sn[2]} ›"`, !!sn && /<div class="row wnav"><button id="pv" aria-label="Previous set">‹<\/button><span class="pvn">Set \d+ of \d+( ✓)?<\/span><button id="nx" aria-label="Next set">›<\/button>/.test(d));
  check('"Next new" hidden on the next set (the default)', !/id="jump"/.test(d));
  const pv = get("words previous set");
  check('"Next new" shows once the shown set is not the next set; tap returns to it', /<button id="jump">Next new<\/button>/.test(pv) && (api.clickTab("words"), api.el("pv").click(), api.el("jump").click(), !/id="jump"/.test(api.panel())));
  check('"Review" as a ghost under "Drill this set"', /<div class="actions"><button class="next" id="dr">Drill this set<\/button><button class="ghost" id="rev">Review<\/button><\/div>/.test(d) && !/>review</.test(d));
  check('chip "Pinyin" (PRON_NOUN), labelled "Show pinyin"', /id="wsearch"[\s\S]*<button class="chip (on)?" id="wPron" aria-label="Show pinyin" aria-pressed="(true|false)">Pinyin<\/button>/.test(d) && !/>Pron</.test(d));
  const l2 = get("words level 2");
  check(`level switch: HSK ${LEVELS_ZH[1]} pressed, its set shown`, l2.includes(`id="wl_${LEVELS_ZH[1]}" class="on" aria-pressed="true"`) && /Set \d+ of \d+/.test(l2));
  const s = get("words search");
  const sb = await bootWith(PACK, clone(owner), 55); sb.api.clickTab("words");
  sb.api.el("wsearch").value = "tea"; sb.api.el("wsearch").oninput(); await new Promise(r => setTimeout(r, 150));
  const hits = VC.searchWords(WORDS, "tea").length;
  check(`search: the matches listed (${hits}), level row and set nav gone`, hits > 0 && sb.api.el("wbody").innerHTML === '<div id="wl"></div>' && sb.api.el("wl").children.length === Math.min(150, hits) && s.endsWith('<div id="wl"></div>'));
}

console.log("\n[C5] Test tab");
if(owner){
  const { tr } = await walkTabs(PACK, clone(owner), 56);
  const h = (tr.find(x => x[0] === "test home") || [])[1] || "";
  const ids = [...h.matchAll(/<button class="(ghost|next)" id="([^"]+)">([^<]*)<\/button>/g)].map(m => [m[1], m[2], m[3]]);
  console.log("INFO  placed: " + ids.map(x => x.join(":")).join(" | "));
  check("placed learner: full-width ghost rows Listen, Recall, Sentences, Characters, nothing else", JSON.stringify(ids.map(x => x[2])) === JSON.stringify(["Listen", "Recall", "Sentences", "Characters"]) && ids.every(x => x[0] === "ghost"));
  check('placed learner (owner 2026-10-08): no placement at all on the Test tab (no "lacement" text)', !/lacement/.test(h));
  check('placed learner: no intro, no "20", no "Take Placement"', !/Placement finds where to start/.test(h) && !/ 20</.test(h) && !/Take Placement/.test(h) && !/style="flex:1"/.test(h));
  const pl = (tr.find(x => x[0] === "placement screen") || [])[1] || "";
  check('placement screen: ghost "Test" back, "Start"', /^<button class="ghost rback" id="back">Test<\/button>/.test(pl) && /id="go">Start<\/button>/.test(pl) && !/Start placement|‹ test/.test(pl));
  const un = clone(owner); delete un.placedOnce;
  const u = await walkTabs(PACK, un, 56);
  const uh = (u.tr.find(x => x[0] === "test home") || [])[1] || "";
  const uids = [...uh.matchAll(/<button class="(ghost|next)" id="([^"]+)">([^<]*)<\/button>/g)].map(m => m[3]);
  check("unplaced learner: the intro, then the primary \"Take the placement test\" first, the four tests after", /^<p class="q">Placement finds where to start\./.test(uh) && /<button class="next" id="pl">Take the placement test<\/button>/.test(uh) && JSON.stringify(uids) === JSON.stringify(["Take the placement test", "Listen", "Recall", "Sentences", "Characters"]));
  const small = clone(owner); // a characters plan under 20 shows its count
  const { api } = await bootWith(PACK, small, 57);
  api.ev(`VC.__charTestPlan = VC.charTestPlan; VC.charTestPlan = (...a) => VC.__charTestPlan(...a).slice(0, 12)`);
  api.clickTab("test");
  const sh = api.panel(); api.ev(`VC.charTestPlan = VC.__charTestPlan`);
  check('a test under 20 shows its count ("Characters 12")', /id="tChars">Characters 12<\/button>/.test(sh));
  const lockRec = freshRec(); lockRec.placedOnce = true;
  const lr = await bootWith(PACK, lockRec, 58); lr.api.clickTab("test");
  check("placed, under the word minimum: the lock note without a placement offer", /Free tests unlock at \d+ learned words \(\d+ so far\)\.<\/div>/.test(lr.api.panel()) && !/lacement/.test(lr.api.panel()));
  const fr = await bootWith(PACK, freshRec(), 58); fr.api.clickTab("test");
  check('fresh record: the Test tab offers placement ("Take the placement test")', /lacement/.test(fr.api.panel()) && /id="needPlace"[^>]*>Take the placement test</.test(fr.api.panel()));
}

console.log("\n[C6] Sounds tab");
if(owner){
  const rec = clone(owner); rec.lessons = rec.lessons || {}; rec.lessons[LESSONS[0].id] = 1;
  const { tr } = await walkTabs(PACK, rec, 59);
  const h = (tr.find(x => x[0] === "sounds list") || [])[1] || "";
  check(`intro "${LESSONS.length} short lessons on how Mandarin sounds and is written." (pack.name without its range)`, h.startsWith(`<p class="q">${LESSONS.length} short lessons on how Mandarin sounds and is written.</p>`) && !/Optional:|lessons, \d+ done/.test(h));
  check("a done lesson shows a tick, the rest nothing", (h.match(/<span class="tick">✓<\/span>/g) || []).length === 1 && h.includes(`<button data-i="0"><span>${LESSONS[0].title}</span><span class="tick">✓</span></button>`));
  const l = (tr.find(x => x[0] === "lesson") || [])[1] || "";
  check('lesson: ghost "Lessons" back button, cards and Drill unchanged', /^<button class="ghost rback" id="back">Lessons<\/button><p class="q">/.test(l) && /id="dr">Drill<\/button>/.test(l) && !/‹ lessons/.test(l));
}

console.log("\n[C7] notices");
{
  const { tr } = await walkTabs(PACK, freshRec(), 60, { ua: "Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36" });
  const sp = (tr.find(x => x[0] === "speech notice") || [])[1], sm = (tr.find(x => x[0] === "samsung notice") || [])[1];
  check(`voice notice: "${stripTags(sp).trim()}"`, sp === '<div class="warn">No voice for this language in this browser. Listening items show the word instead.</div>');
  check(`Samsung notice: "${stripTags(sm).trim()}"`, sm === `<div class="warn">Audio doesn't play in Samsung Internet. Open this page in Chrome or Firefox to hear words.</div>`);
  check("storeWarn texts verbatim (no v2 branch in storageWarn or the read-only notice)", !/APP_V2/.test((appHtml.match(/function storageWarn[\s\S]*?\n\}/) || [""])[0]));
}

console.log("\n[C9] review fixes: Read rule line, Placement in Progress Settings, no-voice copy");
{
  const noV = { voices: [{ lang: "en-US", name: "y" }] }; // a voice list with none for the pack language: hasSpeech false
  // Read rule line: always the Read rule (own words), never the level-gate sentence; the clause only when the gate holds that level.
  if(owner){
    const { api } = await bootWith(PACK, clone(owner), 71); api.clickTab("read");
    const h = api.panel();
    check("Read locked line never shows the level-gate sentence (no \"known\")", !/opens at 70% of HSK \d known/.test(h) && /data-locked="\d"/.test(h));
    const hold = VC.levelGateHold(WORDS, PACK, api.getProg(), CHARACTERS);
    if(hold) check(`level gate holds HSK ${hold.lv}: one clause "New HSK ${hold.lv} words wait on HSK ${hold.prev}." appended, no second number`, h.includes(`New HSK ${hold.lv} words wait on HSK ${hold.prev}.</p>`));
    const g = await bootWith(PACK, (r => { r.w = {}; return r; })(clone(owner)), 71); g.api.clickTab("read");
    check("a level the gate does not hold carries no clause", (g.api.panel().match(/New HSK \d words wait on/g) || []).length <= 1);
  }
  // Placement hatch: owner (placed) Progress Settings carries the row before Reset; Test tab still has none; the row starts the flow and returns.
  if(owner){
    const { api } = await bootWith(PACK, clone(owner), 72); api.clickTab("progress");
    const h = api.panel();
    const iP = h.indexOf('id="placeRow"'), iR = h.indexOf('id="reset"'), iI = h.indexOf('id="imp"');
    check('owner export: Progress Settings has the "Placement test" ghost row after Import and before Reset', iI > 0 && iP > iI && iR > iP && /<button class="ghost" id="placeRow"[^>]*>Placement test<\/button>/.test(h));
    api.clickTab("test"); check('owner export: Test tab still has no "lacement"', !/lacement/.test(api.panel()));
    api.clickTab("progress"); api.el("placeRow").click();
    check("row opens the placement intro under the Test tab title, back button reads Progress", api.title() === "Test" && /id="back">Progress<\/button>/.test(api.panel()) && /id="go">Start<\/button>/.test(api.panel()));
    api.el("back").click();
    check("back returns to Progress (settings row visible again)", api.ev("tab") === "progress" && /id="placeRow"/.test(api.panel()));
    api.clickTab("test"); check('after the round trip the Test tab is still placement-free and a later entry is not sent to Progress', !/lacement/.test(api.panel()) && api.ev("placeFrom") === null);
    api.clickTab("progress"); api.el("placeRow").click(); api.el("go").click();
    check("flow starts from the row (placement run in progress)", api.ev("!!PL"));
  }
  const fr = await bootWith(PACK, freshRec(), 73); fr.api.clickTab("progress");
  check("fresh record: the row is present too (one Placement test, nothing else added)", (fr.api.panel().match(/id="placeRow"/g) || []).length === 1);
  // No voice under v2 (the harness otherwise always has one).
  const nv = await bootWith(PACK, freshRec(), 74, noV); nv.api.clickTab("progress");
  const ph = nv.api.panel();
  check('no voice, Progress: the trimmed notice copy once, at the top', ph.startsWith('<div class="warn">No voice for this language in this browser. Listening items show the word instead.</div>') && !/text-to-speech/.test(ph));
  nv.api.clickTab("sounds"); nv.api.ev(`soundsSel = 0; soundsRender()`);
  const lh = nv.api.panel() + JSON.stringify(nv.api.ev(`document.getElementById("cards")._ins || []`));
  console.log("INFO  lesson no voice: " + stripTags(lh).slice(0, 160).replace(/\s+/g, " "));
  check('no voice, lesson: the trimmed notice copy "No voice for this language in this browser. Listening items show the text instead."', lh.includes("No voice for this language in this browser. Listening items show the text instead.") && !/This browser has no voice/.test(lh));
  // (flag-off equality with 9bf0e78 on the no-voice render deleted: appView is engine default since the flag collapse.)
}

// [C8] (flag off: tabs byte-identical to 9bf0e78) deleted: appView is engine default since the flag collapse.

console.log("\n[D1] fb45: Still shaky, right-first-time score, sentence alignment, Read row title");
{
  if(!owner) skip("owner export not found");
  else {
    // 1. the Progress heading
    { const { api } = await bootWith(PACK, unpaused(), 13); api.el("go").click();
      await play(api, { wrong: (it, n) => n % 4 === 1 }); api.clickTab("progress");
      const h = api.panel();
      check("Progress under v2: the recent-misses block is headed Still shaky, never Missed in your last", /<p class="pvk">Still shaky<\/p><p class="pvw">/.test(h) && !/Missed in your last/.test(h));
    }
    // 2. the drill-end score: right first time over distinct items
    for(const [what, wrongTimes, want] of [["one miss re-asked", 1, "2 of 3"], ["the same item missed twice", 2, "2 of 3"], ["no miss", 0, "3 of 3"]]){
      const run = async pack => { const { api } = await bootWith(pack, unpaused(), 13); const first = api.ev("WORDS.slice(0, 3).map(w => w.id)")[0]; let k = 0;
        api.ev("drill(WORDS.slice(0, 3).map(w => readItem(w)), () => {}, missSummary)");
        await play(api, { wrong: it => it.key === "w:" + first && ++k <= wrongTimes, until: a => /id="ok"/.test(a.panel()) && !a.getD() });
        return api.panel(); };
      const on = await run(PACK);
      check(`drill end, ${what}: v2 "${want}" over distinct items`, on.includes(`<h2>${want}</h2>`));
      if(wrongTimes) check(`drill end, ${what}: the Missed rows list the one missed item`, (on.match(/data-mopen=/g) || []).length === 1); }
    // 3. sentence and pattern items left-align label + stimulus; word and character items stay centred
    { const ONk = ON || {}, sentK = ["hear sentence", "gap", "gap typed", "pattern, first meeting", "pattern, met before"].filter(n => ONk[n] && ONk[n].right);
      const wordK = ["meaning MC", "recall", "hear word", "typed pinyin", "typed characters", "charPick", "charRead", "charSound"].filter(n => ONk[n] && ONk[n].right);
      check(`sentence and pattern items carry the sent class on the drill body (${sentK.join(", ")})`, sentK.length >= 4 && sentK.every(n => ONk[n].right.q.startsWith('<div class="drill-body sent">') && ONk[n].wrong.q.startsWith('<div class="drill-body sent">')));
      check(`word, character and unit items keep the centred label (${wordK.length} kinds)`, wordK.length >= 7 && wordK.every(n => ONk[n].right.q.startsWith('<div class="drill-body"><p class="q">')));
      check("the CSS left-aligns the label and the hear stage under .sent, scoped to v2, after the centred rule", /:root\[data-appview="v2"\] \.drill-body\.sent>\.q:first-child\{text-align:start\}/.test(appHtml) && /:root\[data-appview="v2"\] \.drill-body\.sent \.hear-stage\{justify-content:flex-start\}/.test(appHtml)
        && appHtml.indexOf(".drill-body.sent>.q:first-child") > appHtml.indexOf(".drill-body:not(.top)>.q:first-child{text-align:center"));
    }
    // 4. the Today Read row shows the title in characters only under v2 (the v2 plan block, todayPlanV2)
    { const row = async pack => { const { api } = await bootWith(pack, unpaused(), 13); const h = api.panel(); const i = h.search(/>Read</); return i < 0 ? null : h.slice(i, i + 700); };
      const a = await row(PACK);
      check(`Today Read row under v2 has no ruby / pinyin on the title (${a && a.replace(/<[^>]+>/g, "").slice(0, 30)})`, !!a && !/<ruby|<rt|class="t\d"/.test(a.slice(0, a.indexOf("Start") > 0 ? a.indexOf("Start") : 700)));
      const ph = (await bootWith(PACK, unpaused(), 13)).api.panel();
      check("Today under v2: no ruby tags anywhere in the plan's Read step", !/<ruby/.test(ph.slice(ph.search(/>Read</), ph.search(/>Read</) + 400))); }
    // 8. the tab title drops a trailing parenthetical (the level range)
    { for(const [nm, pack] of [["zh pack", PACK], ["a French-named pack", Object.assign({}, PACK, { name: "French (A1–B1)" })]]){
        const { api } = await bootWith(pack, unpaused(), 13); const t = api.ev("document.title");
        check(`document.title for the ${nm} has no "(" and no level range ("${t}")`, !/\(/.test(t) && t.length > 0 && !/HSK 1|A1/.test(t)); }
      const t2 = (await bootWith(Object.assign({}, PACK, { name: "Mandarin (HSK 1–4)" }), unpaused(), 13)).api.ev("document.title");
      check(`"Mandarin (HSK 1–4)" shows as "Mandarin"`, t2 === "Mandarin"); }
    // 6. (flag off byte-identical to 0d542de deleted: appView is engine default since the flag collapse.)
  }
}

console.log("\n[D2] fb48: placement reads the whole result (pack.placementWhole)");
{
  const st0 = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK)), N = st0.map((_, i) => VC.placementItemCount(i, PACK));
  // right answers per bucket (zh asks 2,3,2,3,...); the first 12 are the owner-reported record
  const RECS = {
    "reported record": [1, 3, 2, 0, 2, 2, 2, 2, 2, 3, 1, 2, 0, 0, 0, 0],
    "all right": N.slice(),
    "first bucket 0": N.map((n, i) => i === 0 ? 0 : n),
    "poor": N.map((n, i) => i < 2 ? n : 0),
  };
  const place = async (pack, rec, r, o) => { const { api, st } = await bootWith(pack, rec, 13, o);
    api.ev(`PL = { vocab:{items:[], i:0}, st: VC.strata(WORDS, PACK.placement, SIZE), res: ${JSON.stringify(r.map((x, i) => ({ r: x, n: N[i] })))} }; placeResult();`);
    return { html: api.panel(), rec: st.ls.getItem(VC.storageKey(pack)), prog: api.getProg() }; };
  const owner2 = owner ? () => clone(owner) : null;
  const sources = [["fresh record", () => null]].concat(owner2 ? [["owner export", owner2]] : []);
  for(const [sn, mk] of sources){
    // flag on
    const rep = await place(PACK, mk(), RECS["reported record"]);
    check(`${sn}, flag on, reported record: placement lands past the skipped bucket (${rep.html.match(/Start at ([^<]*)/)[1]})`, rep.prog.placedOnce === true && /<h2>Start at HSK 4, set 1\b/.test(rep.html));
    check(`${sn}, flag on, reported record: 9 ok cells, the zero bucket muted, 6 bad cells`, (rep.html.match(/color:var\(--ok\)/g) || []).length === 9 && (rep.html.match(/color:var\(--mute\)/g) || []).length === 1 && (rep.html.match(/color:var\(--bad\)/g) || []).length === 6);
    const poor = await place(PACK, mk(), RECS["poor"]);
    check(`${sn}, flag on, poor record: no muted cell`, !/var\(--mute\)/.test(poor.html));
    const first0 = await place(PACK, mk(), RECS["first bucket 0"]);
    check(`${sn}, flag on, first bucket 0: every cell bad (stop 0, nothing skipped)`, (first0.html.match(/color:var\(--bad\)/g) || []).length === 16 && !/var\(--mute\)/.test(first0.html));
    // flag-off control vs f6481b8 deleted: placementWhole is engine default since the flag collapse (the window rule is gone).
  }
}

const BASE_F = "143a674"; // main before fb50: the flag-off control for placementChars
console.log("\n[D3] fb50: placement places the characters layer (pack.placementChars) + Today's Sounds hint");
{
  const oldOf = f => cp.execSync(`git -C "${ROOT}" show ${BASE_F}:${f}`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  let oldCore = null, oldHtml = null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avd-")); const f = path.join(dir, `core_${BASE_F}.js`);
    fs.writeFileSync(f, oldOf("engine/core.js")); oldCore = require(f); oldHtml = oldOf("engine/app.html");
    fs.rmSync(dir, { recursive: true, force: true });
  } catch(e){ oldCore = null; }
  const OFFC = packAsOf(PACK, BASE_F, { strip: ["placementChars"] });
  check("pack.placementChars: on in the shipped pack, off in the control", PACK.placementChars === true && OFFC.placementChars === undefined && VC.placementCharsOn(PACK) && !VC.placementCharsOn(OFFC));
  const st0 = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK)), N = st0.map((_, i) => VC.placementItemCount(i, PACK));
  const RECS = {
    "reported record": [1, 3, 2, 0, 2, 2, 2, 2, 2, 3, 1, 2, 0, 0, 0, 0],
    "all right": N.slice(),
    "first bucket 0": N.map((n, i) => i === 0 ? 0 : n),
    "first bucket only": N.map((n, i) => i === 0 ? n : 0),
    "poor": N.map((n, i) => i < 2 ? n : 0),
  };
  const place = async (pack, rec, r, o) => { const { api, st } = await bootWith(pack, rec, 13, o);
    api.ev(`PL = { vocab:{items:[], i:0}, st: VC.strata(WORDS, PACK.placement, SIZE), res: ${JSON.stringify(r.map((x, i) => ({ r: x, n: N[i] })))} }; placeResult();`);
    const html = api.panel(), prog = api.getProg(), rec2 = st.ls.getItem(VC.storageKey(pack));
    api.clickTab("today");
    return { html, rec: rec2, prog, today: api.panel() }; };
  const owner2 = owner ? () => clone(owner) : null;
  const sources = [["fresh record", () => null]].concat(owner2 ? [["owner export", owner2]] : []);
  for(const [sn, mk] of sources){
    const rep = await place(PACK, mk(), RECS["reported record"]);
    const line = (rep.html.match(/<p class="q" id="plChars">([^<]*)<\/p>/) || [])[1];
    const n = VC.placedCharsThrough(PACK, CHARACTERS, rep.prog);
    check(`${sn}, flag on, reported record: one line under the table "${line}"`, /^Characters: placed through HSK \d, set \d+$/.test(line || "") && n && line === `Characters: placed through HSK ${n.lv}, set ${n.set}` && rep.html.indexOf("</table>") < rep.html.indexOf('id="plChars"') && (rep.html.match(/id="plChars"/g) || []).length === 1);
    check(`${sn}, flag on, reported record: unit records written provisional (${Object.keys(VC.charRecs(rep.prog)).length}), Learn teaches no placed unit`, Object.keys(VC.charRecs(rep.prog)).length > 0 && Object.values(VC.charRecs(rep.prog)).some(r => r.prov === 1));
    const none = await place(PACK, mk(), RECS["first bucket 0"]);
    check(`${sn}, flag on, first bucket 0: no line (nothing placed)`, !/plChars/.test(none.html));
    const one = await place(PACK, mk(), RECS["first bucket only"]);
    check(`${sn}, flag on, first bucket only: ${/plChars/.test(one.html) ? "line present: " + one.html.match(/id="plChars">([^<]*)/)[1] : "no line (first set not whole)"}`, true);
    // Today's Sounds hint
    check(`${sn}, flag on, reported record: Today has no "Start the first lesson" hint`, !/id="hintSounds"/.test(rep.today) && /id="go"/.test(rep.today));
    check(`${sn}, flag on, reported record: Sounds stays unmarked (prog.soundsOpened ${rep.prog.soundsOpened}, lessons done ${Object.keys(rep.prog.lessons || {}).length}) and its tab is reachable`, rep.prog.soundsOpened === (mk() || {}).soundsOpened && Object.keys(rep.prog.lessons || {}).length === Object.keys((mk() || { lessons: {} }).lessons || {}).length);
    if(!owner2 || sn !== "owner export") {
      const f = await bootWith(PACK, null, 3); check("flag on, fresh record, no placement: the hint is shown", /id="hintSounds"/.test(f.api.panel()));
      const o1 = await place(PACK, null, RECS["first bucket only"]);
      check("flag on, placement passing only the first bucket: the hint is still shown", /id="hintSounds"/.test(o1.today));
    }
    if(!oldCore) { skip(`${BASE_F} not in this checkout's history`); continue; }
    // fresh-record control deleted: its placement reaches placedKnown / placedRead, engine default since the flag collapse, which 143a674 predates.
    if(sn === "fresh record") continue;
    for(const [rn, r] of Object.entries(RECS)){
      const a = await place(OFFC, mk(), r), b = await place(OFFC, mk(), r, { core: oldCore, html: oldHtml });
      check(`${sn}, flag off, ${rn}: result screen, stored record and Today byte-identical to ${BASE_F} (hint ${/id="hintSounds"/.test(a.today) ? "shown" : "hidden"})`, a.html === b.html && a.rec === b.rec && a.today === b.today && !/plChars/.test(a.html));
    }
  }
}

console.log("\n[D4] fb51: placement stops asking after three empty buckets (pack.placementEarlyStop)");
{
  check("placementEarlyStop is engine default (flag collapse): zh carries no key", !("placementEarlyStop" in PACK));
  const st0 = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK)), N = st0.map((_, i) => VC.placementItemCount(i, PACK));
  const TOT = N.reduce((a, b) => a + b, 0);
  // right = how many items of bucket b to get right
  const walk = async (pack, rec, rightOf, o) => {
    const { api, st } = await bootWith(pack, rec, 13, o);
    api.ev("placeFrom = null; placeRender()"); const screens = [api.panel()];
    api.el("go").click();
    const seen = {}; let asked = 0;
    for(let g = 0; g < 100 && api.el("o"); g++){
      if(!/Words \d+ \/ \d+/.test(api.panel())) break;
      const b = api.ev("PL.vocab.items[PL.vocab.i - 1].b"), want = api.ev("glossOut(VC.gloss(PL.vocab.items[PL.vocab.i - 1].w))");
      seen[b] = (seen[b] || 0) + 1; asked++;
      const ok = seen[b] <= rightOf(b), btns = api.el("o").children;
      screens.push(api.panel());
      (ok ? btns.find(x => x.innerHTML === want) : btns.find(x => x.innerHTML !== want)).click();
    }
    screens.push(api.panel());
    return { asked, html: api.panel(), screens, rec: st.ls.getItem(VC.storageKey(pack)), prog: api.getProg() };
  };
  const RECS = {
    "beginner (all wrong)": () => 0,
    "advanced (all right)": b => N[b],
    "two empty buckets then right": b => (b === 1 || b === 2) ? 0 : N[b],
    "right to bucket 5, then empty": b => b < 6 ? N[b] : 0,
  };
  const lvLabel = lv => api0.ev(`levelLabel(${JSON.stringify(lv)})`);
  var api0 = (await bootWith(PACK, null, 13)).api;
  const owner2 = owner ? () => clone(owner) : null;
  const sources = [["fresh record", () => null]].concat(owner2 ? [["owner export", owner2]] : []);
  for(const [sn, mk] of sources){
    const beg = await walk(PACK, mk(), RECS["beginner (all wrong)"]);
    check(`${sn}, flag on, beginner: stops after bucket 3 with ${N[0] + N[1] + N[2]} items asked (asked ${beg.asked})`, beg.asked === N[0] + N[1] + N[2] && N[0] + N[1] + N[2] >= 7 && N[0] + N[1] + N[2] <= 8);
    const lineOf = (html, nAsked) => { const na = VC.placementNotAsked(st0, st0.map((_, i) => i < nAsked ? { r:0, n:N[i] } : { r:0, n:0, skipped:true }));
      return { na, line: (html.match(/<tr id="plNotAsked"><td colspan="2" style="color:var\(--mute\)">([^<]*)<\/td><\/tr>/) || [])[1],
        want: "Not asked: " + na.map(e => e.whole ? lvLabel(e.lv) : `${lvLabel(e.lv)} ${e.s1 - e.s0 > 1 ? `sets ${e.s0 + 1}–${e.s1}` : `set ${e.s1}`}`).join(", ") }; };
    const lb = lineOf(beg.html, 3);
    check(`${sn}, flag on, beginner: one muted line "${lb.line}" (whole levels by label)`, lb.line === lb.want && /^Not asked: HSK 2, HSK 3, HSK 4$/.test(lb.line || "") && lb.na.every(e => e.whole));
    check(`${sn}, flag on, beginner: 3 table rows for asked buckets (bad), the unasked buckets not listed`, (beg.html.match(/<tr><td>HSK/g) || []).length === 3 && (beg.html.match(/color:var\(--bad\)/g) || []).length === 3);
    check(`${sn}, flag on, beginner: nothing stored for the unasked buckets (placed once, no word beyond the first level placed)`, beg.prog.placedOnce === true && !/skipped/.test(beg.rec || ""));
    const adv = await walk(PACK, mk(), RECS["advanced (all right)"]);
    check(`${sn}, flag on, advanced: all ${TOT} items asked, no "Not asked" line (asked ${adv.asked})`, adv.asked === TOT && !/plNotAsked/.test(adv.html));
    const two = await walk(PACK, mk(), RECS["two empty buckets then right"]);
    check(`${sn}, flag on, two empty buckets then right: all asked (asked ${two.asked})`, two.asked === TOT && !/plNotAsked/.test(two.html));
    const mid = await walk(PACK, mk(), RECS["right to bucket 5, then empty"]);
    const lm = lineOf(mid.html, 9);
    check(`${sn}, flag on, right to bucket 5 then empty: stops after bucket 9 (asked ${mid.asked} of ${TOT}); partial level by set range: "${lm.line}"`, mid.asked === N.slice(0, 9).reduce((a, b) => a + b, 0) && lm.line === lm.want && lm.na.some(e => !e.whole) && /^Not asked: HSK 3 sets? \d+(–\d+)?, HSK 4$/.test(lm.line || ""));
    // flag-off controls vs 8564258 deleted: placementEarlyStop is engine default since the flag collapse.
  }
  // the stop rules treat the unasked buckets as failed: whole and window
  const res = N.map((n, i) => i < 3 ? { r:0, n } : { r:0, n:0, skipped:true });
  check("placementStopIndex reads unasked buckets as failed (window rule 0, whole rule 0)", VC.placementStopIndex(res) === 0 && VC.placementStopIndex(res, { whole: true }) === 0);
  const res2 = N.map((n, i) => i < 5 ? { r:n, n } : i < 8 ? { r:0, n } : { r:0, n:0, skipped:true });
  check("right to bucket 4, three empty, rest unasked: both rules stop at 5", VC.placementStopIndex(res2) === 5 && VC.placementStopIndex(res2, { whole: true }) === 5);
  check("placementEarlyStopAfter: needs three asked buckets, all zero", !VC.placementEarlyStopAfter([{r:0},{r:0}], 1) && VC.placementEarlyStopAfter([{r:0},{r:0},{r:0}], 2) && !VC.placementEarlyStopAfter([{r:0},{r:1},{r:0},{r:0}], 3) && VC.placementEarlyStopAfter([{r:2},{r:0},{r:0},{r:0}], 3));
}

console.log("\n[D5] fb51: the reveal drops the stimulus hint links it makes redundant (appView v2)");
{
  const LINK = /data-(?:showw|pcue)/g, n = h => (String(h).match(LINK) || []).length;
  const K5 = KINDS.concat([["read sentence", "readSentence(__S)"]]);
  const probe = async (pack, rec, seed, o) => {
    const { api } = await bootWith(pack, rec, seed, Object.assign({ patterns: true }, o));
    api.ev(PICK); const out = {};
    for(const [name, expr] of K5) out[name] = { right: runItem(api, expr, true), wrong: runItem(api, expr, false) };
    return out;
  };
  const sources = owner ? [["owner export", unpaused], ["fresh record", freshRec]] : [["fresh record", freshRec]];
  const table = {};
  for(const [sn, mk] of sources){
    const on = await probe(PACK, mk(), 21);
    for(const [name] of K5){
      const a = on[name];
      if(!a.right || !a.wrong) continue;
      const row = (table[name] = table[name] || {});
      const pre = n(a.right.q), postR = n(a.right.after), postW = n(a.wrong.after), rvLinks = n(a.right.rv), rvRow = /class="rw[ "]/.test(a.right.rv);
      row[sn] = { pre, postR, postW, rvLinks, rvRow };
      // a link the reveal makes redundant is gone after a right and a wrong answer; one it does not is kept
      check(`${sn}, ${name}: stimulus links ${pre} -> ${postR} (right) / ${postW} (wrong); the reveal ${rvRow ? "shows the form row (the characters or its own link)" : "has no form row, links stay"}`, rvRow ? postR === 0 && postW === 0 : postR === pre && postW === pre);
    }
  }
  const kinds = Object.keys(table);
  console.log("INFO  kind | links before | after right / wrong | reveal form row | reveal links  (" + sources.map(x => x[0]).join(" / ") + ")");
  kinds.forEach(k => console.log("INFO  " + k.padEnd(30) + sources.map(([sn]) => { const r = table[k][sn]; return r ? `${r.pre} | ${r.postR}/${r.postW} | ${r.rvRow ? "row" : "-"} | ${r.rvLinks}` : "n/a"; }).join("   ")));
  // dropped on cloze and pattern items where the stimulus had a link
  const dropped = kinds.filter(k => sources.some(([sn]) => table[k][sn] && table[k][sn].pre > 0 && table[k][sn].postR < table[k][sn].pre && table[k][sn].rvRow));
  const withLinks = kinds.filter(k => sources.some(([sn]) => table[k][sn] && table[k][sn].pre > 0));
  check(`links present before answering and gone after, on every kind that carries one (${withLinks.join(", ")})`, ["meaning MC", "gap", "gap typed", "pattern, met before", "read sentence"].every(k => withLinks.includes(k)) && withLinks.every(k => sources.every(([sn]) => !table[k][sn] || (table[k][sn].postR === 0 && table[k][sn].postW === 0))));
  check("the hear sentence, recall, typed and unit kinds carry no stimulus link (nothing to drop)", ["hear sentence", "recall", "hear word", "typed pinyin", "typed meaning", "typed characters", "typed word", "charPick", "charRead", "charSound"].every(k => sources.every(([sn]) => !table[k][sn] || table[k][sn].pre === 0)));
}

console.log("\n[D6] fb51: a pattern below the placed level is not a first meeting (pack.placedRead)");
{
  const st0 = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK));
  const placedRec = () => VC.applyPlacement(VC.normalizeProg({}, PACK), st0, st0.length, WORDS, PACK, CHARACTERS);
  const lvOf = lv => PATTERNS.find(p => String(p.lv) === lv).id;
  const lowId = lvOf("2"), topId = lvOf("4");
  const ask = async (pack, rec, pid, right) => {
    const { api } = await bootWith(pack, rec, 21, { patterns: true });
    const r = runItem(api, `patternItem(${JSON.stringify(pid)}, 0, 0)`, right);
    return { q: r.q, rv: r.rv, first: VC.patternFirstMeeting(rec || VC.normalizeProg({}, pack), PATTERNS.find(p => p.id === pid), pack), pt: api.getProg().pt };
  };
  const tap = h => /data-pcue/.test(h), note = h => /class="pnote"/.test(h);
  const pr = placedRec();
  check(`placed record: pl = ${pr.pl}`, pr.pl === "4");
  const a = await ask(PACK, pr, lowId, true);
  check("placed zh record, an HSK 2 pattern's first ask: tap link, no meaning open, no note, not a first meeting", a.first === false && tap(a.q) && !note(a.rv) && !!a.pt && !!a.pt[lowId]);
  const aw = await ask(PACK, placedRec(), lowId, false);
  check("... and after a wrong first ask: still no note (a miss any time is a later-meeting miss: note shown)", tap(aw.q) && note(aw.rv));
  const t = await ask(PACK, placedRec(), topId, true);
  check("placed record, a pattern at the placed level: first meeting, English open, the note rides the verdict", t.first === true && !tap(t.q) && note(t.rv));
  const f = await ask(PACK, VC.normalizeProg({}, PACK), lowId, true);
  check("fresh record: an HSK 2 pattern is a first meeting (English open, note)", f.first === true && !tap(f.q) && note(f.rv));
  // flag-off control (placedRead absent) deleted: placedRead is engine default since the flag collapse.
  check("patternFirstMeeting: a recorded pattern is never a first meeting; unknown pl or level counts as first", VC.patternFirstMeeting({ pt: { x: { s: 1, a: 1 } }, pl: "4" }, { id: "x", lv: "4" }, PACK) === false && VC.patternFirstMeeting({ pl: "zz" }, { id: "y", lv: "2" }, PACK) === true && VC.patternFirstMeeting({ pl: "4" }, { id: "y", lv: "9" }, PACK) === true);
  // the pattern is still drilled until known: it stays in the open list for a placed record
  check("placed record: the HSK 2 pattern still opens and is picked (drilled until known)", VC.openPatterns(placedRec(), PACK, PATTERNS, WORDS).some(p => p.id === lowId));
}

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
})();
