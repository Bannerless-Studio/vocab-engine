// pack.progressView "v2" (docs/PACK_SCHEMA.md "progressView"; owner 2026-10-07): [1] core totals, visit
// record pv, deltas, recent misses; [2] the tab on the owner export: anchor, hidden rows, Show all, bars,
// "characters only", hero first visit / after a session / no change, pv written on leaving (tab switch and
// visibilitychange) and never at boot, recent misses; [3] flag off: the Progress HTML byte-identical to
// main 9667a81 on 3 records, nothing written.
// Run: node tests/progress_view_checks.js [owner export path]
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "9667a81"; // main before progressView
const OWNER = process.argv[2] || process.env.PROGRESS_OWNER || "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
// levelGate and levelExam (fb38) came after 9667a81: the flag-off control drops them too (tests/level_gate_checks.js covers them).
const OFF = (p => { const q = Object.assign({}, p); delete q.progressView; delete q.levelGate; delete q.levelExam; return q; })(PACK);
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

const DAY = "2026-10-04";
let NOW = new Date(2026, 9, 4, 20, 0, 0).getTime();
class FakeDate extends Date {
  constructor(...a){ if(a.length) super(...a); else super(NOW); }
  static now(){ return NOW; }
}
// Boots app.html (opts.html) on opts.core with storage st ({ ls, ss }); Math.random seeded.
async function boot(pack, st, seed, opts){
  const o = opts || {};
  Math.random = mulberry32(seed);
  const document = makeFakeDom();
  const voices = [{ lang:"zh-CN", name:"x" }];
  const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(){} };
  const wl = {};
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(t, f){ (wl[t] = wl[t] || []).push(f); } };
  const fnBody = scriptOf(o.html || appHtml) + `
return {
  el: id => document.getElementById(id), panel: () => document.getElementById("panel").innerHTML,
  getProg: () => prog, setProg: p => { prog = p; },
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
  hide: () => { document.visibilityState = "hidden"; (document._listeners.visibilitychange || []).forEach(f => f()); document.visibilityState = "visible"; },
  wordForm: w => wordFormHTML(w, false),
  pagehide: () => (window.__wl.pagehide || []).forEach(f => f()),
};`;
  window.__wl = wl;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"ProgressViewChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, WORDS, SENTENCES, LESSONS, PASSAGES, CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return api;
}
const fresh = () => ({ ls: memStore(), ss: memStore() });
async function bootWith(pack, prog, seed, opts){ const st = fresh(); if(prog) st.ls.setItem(VC.storageKey(pack), JSON.stringify(prog)); return { api: await boot(pack, st, seed || 1, opts), st }; }
const stored = (st, pack) => JSON.parse(st.ls.getItem(VC.storageKey(pack)) || "null");
const stripTags = h => String(h).replace(/<rt[^>]*>[\s\S]*?<\/rt>/g, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/\s+/g, " ");
const totals = p => VC.progressTotals(p, PACK, WORDS, CHARACTERS, PASSAGES);
// pack.levelExam (fb38): Progress counts a characters-level word mastered by the exam rule.
const known = (p, w) => VC.wordKnownX(p.w[w.id], w, PACK, p, VC.knownCtx(PACK, CHARACTERS));

// ------------------------------------------------------------------ records
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
const base = extra => VC.normalizeProg(Object.assign({ placedOnce: true, soundsOpened: true, sessions: 10 }, extra || {}), PACK);
const learn = (p, list, s) => list.forEach((w, i) => { p.w[w.id] = { r: 3, w: i % 3 ? 0 : 1, s: s != null ? s : i % 5 }; });
function midProg(){ const p = base({ sets: { "1": 3 } }); learn(p, byLv["1"].slice(0, 30)); return p; }
const owner = fs.existsSync(OWNER) ? JSON.parse(fs.readFileSync(OWNER, "utf8")) : null;

(async () => {
console.log("\n[1] core: totals, pv, deltas, recent misses");
{
  check("progressViewOn: zh pack sets v2; absent / other values are off", VC.progressViewOn(PACK) && !VC.progressViewOn(OFF) && !VC.progressViewOn(Object.assign({}, PACK, { progressView: "v3" })));
  const p = midProg(); p.sessions = 12;
  const t = totals(p);
  check("progressTotals: sessions, mastered (wordKnownX, the exam rule), units at target, passages", t.sn === 12 && t.m === VC.learnedWords(WORDS, PACK, p).filter(w => known(p, w)).length && t.co === 0 && t.p === 0);
  check("no pv: no deltas (first visit)", VC.progressVisit(p) === null && VC.progressDeltas(p, t) === null);
  check("noteProgressVisit writes pv = totals, and reports no change on a second call", VC.noteProgressVisit(p, PACK, t) && JSON.stringify(p.pv) === JSON.stringify({ sn: 12, m: t.m, co: 0, p: 0 }) && !VC.noteProgressVisit(p, PACK, t));
  const q = clone(p); q.sessions = 15; q.read = { done: { [PASSAGES[0].id]: { sc: 4, n: 4, d: DAY, x: 1 } } };
  const d = VC.progressDeltas(q, totals(q));
  check("deltas = current - pv", d.sn === 3 && d.p === 1 && d.m === 0 && d.co === 0);
  check("flag off: noteProgressVisit writes nothing", (() => { const r = midProg(); return !VC.noteProgressVisit(r, OFF, totals(r)) && !("pv" in r); })());
  check("a malformed pv reads as no visit", [{ sn: "1", m: 0, co: 0, p: 0 }, { sn: 1, m: 0, co: 0 }, [1, 2], null, 4].every(v => VC.progressVisit(Object.assign({}, p, { pv: v })) === null));
  const r = midProg(); r.sn = 20; const L = VC.learnedWords(WORDS, PACK, r);
  const [a, b, c, e, f] = L;
  r.w[a.id].p = { wm: [0, 20], sm: [3, 18] };   // pair miss this session
  r.w[b.id].p = { sm: [0, 14] };                // in the window (14 >= 20 - 7 + 1)
  r.w[c.id].p = { ws: [0, 13] };                // just outside
  r.w[e.id].p = { wm: [2, 19] };                // no reset
  r.day = { d: DAY, n: 1, a: { ["w:" + f.id]: { mk: ["hear"], ms: 17, m: 1 } } };   // pending miss in the day log
  const m = VC.recentMisses(r, L).map(w => w.id);
  check("recentMisses: pair reset in the last 7 sessions + pending day-log miss, most recent first", JSON.stringify(m) === JSON.stringify([a.id, f.id, b.id]));
  const s = midProg(); s.sn = 9; const L2 = VC.learnedWords(WORDS, PACK, s);
  s.w[L2[0].id] = { r: 3, w: 2, s: 0, u: 8 }; s.w[L2[1].id] = { r: 3, w: 0, s: 0, u: 8 };
  check("recentMisses without pairs: streak 0 with misses, answered in the window", JSON.stringify(VC.recentMisses(s, L2).map(w => w.id)) === JSON.stringify([L2[0].id]));
  check("recentMisses: no session ordinal, nothing", VC.recentMisses(midProg(), L).length === 0);
}

console.log("\n[2] Progress tab under the flag, owner export");
if(!owner) skip(`owner export not found at ${OWNER}`);
else {
  const { api, st } = await bootWith(PACK, owner, 3);
  check("boot writes no pv", !("pv" in api.getProg()) && !(stored(st, PACK) || {}).pv);
  api.clickTab("progress");
  let h = api.panel(), t = stripTags(h);
  const P = api.getProg(), cur = totals(P);
  console.log(`INFO  owner totals: sessions ${cur.sn}, mastered ${cur.m}, characters only ${cur.co}, passages ${cur.p}; sn ${P.sn}`);
  check("anchor: sessions and the highest open level", /<p class="pva">78 sessions, HSK 3<\/p>/.test(h));
  check("first visit: the hero shows the totals under So far", /So far/.test(t) && t.includes(`${cur.m} mastered`) && t.includes(`${cur.co} characters only`) && t.includes(`${cur.p} passages`) && /class="pvh pvin"/.test(h));
  check("goal line: current goal, one bar, its label", /Goal \d of 3/.test(t) && /<section class="pvg">/.test(h));
  const hidden = h => ({ sounds: />Sounds</.test(h), weakest: /Weakest words/.test(h), path: /class="path"/.test(h), goals: /id="pvGoals"/.test(h) && (h.match(/<span>Goal \d<\/span>/g) || []).length === 3, hsk4parts: rowOf(h, "HSK 4").includes('<p class="pvs">') });
  const rowOf = (h, L) => { const i = h.indexOf(`<span>${L}</span>`); if(i < 0) return ""; const j = h.slice(i).search(/<div class="pvl|<\/section>/); return h.slice(i, i + j); };
  const hd = hidden(h);
  check("default view hides: Sounds (0 lessons), Weakest words list, path strip, other goals, HSK 4 parts (locked)", !hd.sounds && !hd.weakest && !hd.path && !hd.goals && !hd.hsk4parts);
  check("HSK 4 (locked, paused) reads paused with its learned count, dimmed", /<div class="pvl pvo"><div class="pvt"><span>HSK 4<\/span><span class="pvn">paused, 9 learned<\/span>/.test(h));
  {
    // The waiting-level note and the paused value are text: no opacity on a row that holds them, muted colour meets 4.5:1 in both themes.
    const css = appHtml.slice(0, appHtml.indexOf("</style>"));
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
    const dimmed = rules.filter(([sel, body]) => /\bopacity\s*:/.test(body) && /\.pv(o|l|gate|s|t|n)\b/.test(sel) && !/\.pvb\b/.test(sel));
    check("gate line and paused value: no reduced opacity on .pvo/.pvl/.pvgate/.pvs/.pvt/.pvn", dimmed.length === 0);
    const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    const lum = c => { const [r, g, b] = hex(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const vars = body => Object.fromEntries([...body.matchAll(/--(\w+):(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
    const light = vars(css.slice(css.indexOf(":root{"), css.indexOf("@media (prefers-color-scheme: dark)"))), dark = vars(css.slice(css.indexOf('":root[data-theme="dark"]'.slice(1)), css.indexOf(":root[data-theme=\"dark\"]") + 400));
    check(`muted text on the page background is >= 4.5:1 (light ${ratio(light.mute, light.bg).toFixed(2)}, dark ${ratio(dark.mute, dark.bg).toFixed(2)})`, ratio(light.mute, light.bg) >= 4.5 && ratio(dark.mute, dark.bg) >= 4.5);
    check("a locked or paused level row text is the muted colour, not dimmed", /\.pvo \.pvt[^{]*\{[^}]*color:var\(--mute\)/.test(css));
  }
  // Bars: learned and mastered widths are the shares of the level size.
  const learned = VC.learnedWords(WORDS, PACK, P);
  const lowSum = ["1", "2"].reduce((o, lv) => { const l0 = learned.filter(w => w.lv === lv); o.l += l0.length; o.m += l0.filter(w => known(P, w)).length; return o; }, { l: 0, m: 0 });
  check(`collapse: current level HSK 4 and HSK 3 (unsettled) keep rows; HSK 1–2 fold into one line, ${lowSum.m} of ${lowSum.l} mastered`, /<span>HSK 3<\/span>/.test(h) && /<span>HSK 4<\/span>/.test(h) && !/<span>HSK [12]<\/span>/.test(h) && new RegExp(`id="pvLow"[^>]*><span>HSK 1–2</span><span class="pvn">${lowSum.m} of ${lowSum.l} mastered</span>`).test(h));
  api.el("pvLow").click();
  const hx = api.panel();
  check("collapse: tapping the line expands HSK 1 and HSK 2 rows", /<span>HSK 1<\/span>/.test(hx) && /<span>HSK 2<\/span>/.test(hx) && !/id="pvLow"/.test(hx));
  h = hx;
  const bars = [...h.matchAll(/<span>(HSK \d)<\/span>[\s\S]*?<i class="pvlr" style="width:([\d.]+)%"><\/i><i class="pvm" style="width:([\d.]+)%"><\/i>/g)];
  const okBars = bars.length === 4 && bars.every(([, L, lw, mw]) => {
    const lv = L.slice(4), size = byLv[lv].length, lw0 = learned.filter(w => w.lv === lv), m0 = lw0.filter(w => known(P, w)).length;
    return Math.abs(+lw - lw0.length / size * 100) < 0.06 && Math.abs(+mw - m0 / size * 100) < 0.06;
  });
  check("bars: learned and mastered widths proportional to the level size, 4 levels", okBars);
  console.log("INFO  bars " + bars.map(([, L, lw, mw]) => `${L} ${lw}/${mw}`).join(", "));
  check("wording: \"characters only\", never done / bare", /characters only \d+ of \d+/.test(t) && !/\b(done|bare)\b/.test(t));
  api.el("pvAll").click();
  h = api.panel(); t = stripTags(h);
  const ha = hidden(h);
  check("Show all reveals: Sounds, Weakest words, path strip, every goal, HSK 4 parts; the button reads Show less", ha.sounds && ha.weakest && ha.path && ha.goals && ha.hsk4parts && /id="pvAll" aria-expanded="true">Show less</.test(h));
  check("Show all keeps characters only wording", !/\b(done|bare)\b/.test(t.replace(/Weakest words[\s\S]*$/, "")));
  check("Show all re-render does not replay the hero reveal", /class="pvh"/.test(h) && !/pvin/.test(h));
  api.el("pvAll").click();
  check("Show less hides them again", !hidden(api.panel()).sounds);
  check("settings: pronunciation, new material, mix, export, import, reset present", ["togglePron", "togglePause", "toggleMix", "exp", "imp", "reset"].every(id => new RegExp(`id="${id}"`).test(api.panel())));
  check("still no pv while the tab is open", !("pv" in api.getProg()));
  api.clickTab("today");
  api.clickTab("progress"); check("leaving the tab folds the lower levels again", /id="pvLow"/.test(api.panel())); api.clickTab("today");
  const pv1 = (stored(st, PACK) || {}).pv;
  check("leaving the tab writes pv = the totals, and saves it", JSON.stringify(pv1) === JSON.stringify(cur));
  // A simulated session: 3 sessions, words reaching known, one more passage.
  const p2 = api.getProg(); p2.sessions += 3; p2.sn += 3;
  const notKnown = VC.learnedWords(WORDS, PACK, p2).filter(w => !known(p2, w)).slice(0, 6);
  notKnown.forEach(w => { p2.w[w.id].p = { wm: [3, p2.sn], sm: [3, p2.sn], ws: [3, p2.sn] }; p2.w[w.id].s = 6; });
  const pid = PASSAGES.find(x => !(p2.read.done || {})[x.id] && x.lv === "3").id; p2.read.done[pid] = { sc: 5, n: 5, d: DAY, x: 1 };
  // A word not known, outside the six, missed in its wm pair this session.
  const missW = VC.learnedWords(WORDS, PACK, p2).find(w => !notKnown.includes(w) && !known(p2, w));
  p2.w[missW.id].p = Object.assign({}, p2.w[missW.id].p, { wm: [0, p2.sn] });
  const cur2 = totals(p2), d = { m: cur2.m - cur.m, co: cur2.co - cur.co, p: cur2.p - cur.p };
  api.clickTab("progress");
  h = api.panel(); t = stripTags(h);
  check(`after a session: hero "In 3 sessions since your last visit" with +${d.m} mastered and +1 passage`, t.includes("In 3 sessions since your last visit") && d.m >= 6 && t.includes(`+${d.m} mastered`) && t.includes("+1 passage ") && !/So far/.test(t));
  check("after a session: the anchor counts the sessions", /<p class="pva">81 sessions, HSK 3<\/p>/.test(h));
  // A phone lock (visibilitychange hidden / pagehide) while Progress stays on screen writes the visit only.
  api.el("pvAll").click(); api.hide(); api.pagehide();
  check("hide + pagehide on Progress keep the expanded view and the hero on screen", /id="pvAll" aria-expanded="true">Show less</.test(api.panel()) && /id="pvh"/.test(api.panel()));
  api.el("pvAll").click(); h = api.panel();
  check("after a hide, Show less still collapses and the hero (since the visit on entry) stays", /id="pvAll" aria-expanded="false">Show all</.test(h) && /In 3 sessions since your last visit/.test(stripTags(h)));
  const missLine = (h.match(/Missed in your last 7 sessions<\/p><p class="pvw">([\s\S]*?)<\/p>/) || [])[1] || "";
  check("a word missed this session leads the Missed in your last 7 sessions line, max 12 words", VC.recentMisses(api.getProg(), VC.learnedWords(WORDS, PACK, api.getProg()))[0].id === missW.id && (missLine.match(/<span data-tl/g) || []).length <= 12 && stripTags(missLine.split("</span> <span")[0]).trim() === stripTags(api.wordForm(missW)).trim());
  api.clickTab("today"); api.clickTab("progress");
  h = api.panel();
  check("a visit with no change: no hero, the anchor and goal stay", !/id="pvh"/.test(h) && /class="pva"/.test(h) && /class="pvg"/.test(h));
  // Closing the app on Progress (visibilitychange hidden) ends the visit too.
  const p3 = api.getProg(); p3.sessions += 1; const pid2 = PASSAGES.find(x => !p3.read.done[x.id] && x.lv === "3").id; p3.read.done[pid2] = { sc: 4, n: 5, d: DAY, x: 1 };
  api.hide();
  check("visibilitychange hidden on Progress writes pv", (stored(st, PACK) || {}).pv.p === cur2.p + 1 && (stored(st, PACK) || {}).pv.sn === cur2.sn + 1);
  api.clickTab("words"); const before = st.ls.getItem(VC.storageKey(PACK)); api.hide();
  check("visibilitychange on another tab writes nothing", st.ls.getItem(VC.storageKey(PACK)) === before);
  // A fresh boot of the stored record: pv survives, boot leaves it as it was.
  const st2 = { ls: memStore(), ss: memStore() }; st2.ls.setItem(VC.storageKey(PACK), st.ls.getItem(VC.storageKey(PACK)));
  const api2 = await boot(PACK, st2, 4);
  check("a reboot keeps pv unchanged", JSON.stringify(api2.getProg().pv) === JSON.stringify((stored(st, PACK) || {}).pv));
}
{
  // Fresh learner: hero shows nothing (all totals 0), level rows beyond HSK 1 hidden.
  const { api } = await bootWith(PACK, base(), 5);
  api.clickTab("progress"); const h = api.panel();
  check("fresh record: no hero (nothing to report), only HSK 1 shown, no collapsed line, no misses line at all", !/id="pvh"/.test(h) && /<span>HSK 1<\/span>/.test(h) && !/<span>HSK 2<\/span>/.test(h) && !/id="pvLow"/.test(h) && !/pvx|No misses/.test(h));
  api.el("pvAll").click();
  check("fresh record, Show all: every level row", ["1", "2", "3", "4"].every(lv => new RegExp(`<span>HSK ${lv}</span>`).test(api.panel())));
}

{
  // An HSK 2 learner: HSK 1 keeps its row until settled (mastered >= SETTLED of learned), then folds.
  const known = (p, list) => list.forEach(w => { p.w[w.id] = { r: 6, w: 0, s: 6, u: 5, p: { wm: [3, 5], sm: [3, 5], ws: [3, 5] } }; });
  const hsk2 = k => { const p = base({ sets: { "1": NS("1"), "2": 3 }, sn: 5 }); learn(p, byLv["1"], 1); learn(p, byLv["2"].slice(0, 30), 1); known(p, byLv["1"].slice(0, k)); return p; };
  check("SETTLED is 0.9; levelSettled at 138 / 150 and not at 128 / 150", VC.SETTLED === 0.9 && VC.levelSettled(150, 138) && !VC.levelSettled(150, 128) && !VC.levelSettled(0, 0));
  const r85 = await bootWith(PACK, hsk2(128), 6); r85.api.clickTab("progress"); const h85 = r85.api.panel();
  check("HSK 2 learner, HSK 1 at 85% mastered: HSK 1 row shown, no collapsed line", VC.nextNewSet(WORDS, PACK, r85.api.getProg()).lv === "2" && /<span>HSK 1<\/span><span class="pvn">128 of 150 mastered/.test(h85) && !/id="pvLow"/.test(h85));
  const r92 = await bootWith(PACK, hsk2(138), 6); r92.api.clickTab("progress"); const h92 = r92.api.panel();
  check("HSK 2 learner, HSK 1 at 92% mastered: collapsed line HSK 1, 138 of 150 mastered; HSK 2 row kept", /id="pvLow"[^>]*><span>HSK 1<\/span><span class="pvn">138 of 150 mastered<\/span>/.test(h92) && /<span>HSK 2<\/span>/.test(h92) && !/<span>HSK 1<\/span><span class="pvn">138 of 150 mastered<\/span><\/div>/.test(h92));
}

console.log(`\n[3] flag off: Progress HTML byte-identical to ${MAIN}, nothing written`);
{
  let oldCore = null, oldHtml = null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-"));
    const f = path.join(dir, `core_${MAIN}.js`);
    fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); oldCore = require(f);
    oldHtml = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  } catch(e){ oldCore = null; }
  if(!oldCore) skip(`${MAIN} not in this checkout's history`);
  else for(const [name, mk] of [["fresh", () => base()], ["mid HSK 1", midProg], ["owner export", () => owner && clone(owner)]]){
    const rec = mk(); if(!rec){ skip(`${name}: owner export not found`); continue; }
    // One app at a time: Math.random is reseeded per boot and the Weakest words list draws from it.
    const a = await bootWith(OFF, clone(rec), 7); a.api.clickTab("progress"); const ha = a.api.panel();
    const b = await bootWith(OFF, clone(rec), 7, { core: oldCore, html: oldHtml }); b.api.clickTab("progress");
    const same = ha === b.api.panel();
    a.api.clickTab("today"); b.api.clickTab("today"); a.api.clickTab("progress"); a.api.hide();
    check(`${name}: Progress HTML byte-identical to ${MAIN}; leaving the tab writes no pv; stored records equal`, same && !("pv" in a.api.getProg()) && a.st.ls.getItem(VC.storageKey(OFF)) === b.st.ls.getItem(VC.storageKey(OFF)));
  }
}

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
})();
