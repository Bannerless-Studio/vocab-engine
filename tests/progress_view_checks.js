// pack.progressView "v2" (docs/PACK_SCHEMA.md "progressView"; owner 2026-10-07): [1] core totals, visit
// record pv, deltas, recent misses; [2] the tab on the owner export: anchor, hidden rows, Show all, bars,
// "characters only", hero first visit / after a session / no change, pv written on leaving (tab switch and
// visibilitychange) and never at boot, recent misses; [4] reading speed. progressView is engine default since the
// flag collapse (stage 2): its flag-off checks and the [3] control vs main 9667a81 went with it.
// Run: node tests/progress_view_checks.js [owner export path]
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const OWNER = process.argv[2] || process.env.PROGRESS_OWNER || "/Users/ishmum/.claude/uploads/9e41e879-e4d7-4530-b040-c9be1286edd7/a48ee4d3-vocab_zh_progress_8.json";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
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
  const tabsMatch = H.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/);
  const btnRe = /<button([^>]*)>/g;
  let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
  registerIdsFromHtml(H.slice(H.indexOf("<body>"), H.indexOf("<nav")));
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
  const document = makeFakeDom(o.html);
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
  vis: s => { document.visibilityState = s; (document._listeners.visibilitychange || []).forEach(f => f()); },
  startPassage: id => startPassage(PASSAGE_LIST.find(p => p.id === id)),
  finishPassage: () => { RD.resultsDone = true; markPassageFinished(); },
  rd: () => RD,
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
  check("progressView is engine default (flag collapse stage 2): core has no progressViewOn, the zh pack no progressView key", VC.progressViewOn === undefined && !("progressView" in PACK));
  const p = midProg(); p.sessions = 12;
  const t = totals(p);
  check("progressTotals: sessions, mastered (wordKnownX, the exam rule), units at target, passages", t.sn === 12 && t.m === VC.learnedWords(WORDS, PACK, p).filter(w => known(p, w)).length && t.co === 0 && t.p === 0);
  check("no pv: no deltas (first visit)", VC.progressVisit(p) === null && VC.progressDeltas(p, t) === null);
  check("noteProgressVisit writes pv = totals, and reports no change on a second call", VC.noteProgressVisit(p, PACK, t) && JSON.stringify(p.pv) === JSON.stringify({ sn: 12, m: t.m, co: 0, p: 0 }) && !VC.noteProgressVisit(p, PACK, t));
  const q = clone(p); q.sessions = 15; q.read = { done: { [PASSAGES[0].id]: { sc: 4, n: 4, d: DAY, x: 1 } } };
  const d = VC.progressDeltas(q, totals(q));
  check("deltas = current - pv", d.sn === 3 && d.p === 1 && d.m === 0 && d.co === 0);
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
  // fb53: a level row's bar is the level's position (wordKnownP share, units share on a characters level), one layer.
  const bars = [...h.matchAll(/<span>(HSK \d)<\/span>[\s\S]*?<i class="pvm" style="width:([\d.]+)%"><\/i>/g)];
  const okBars = bars.length === 4 && bars.every(([, L, w]) => Math.abs(+w - VC.levelPosition(P, PACK, L.slice(4), WORDS, CHARACTERS) * 100) < 0.06);
  check("bars: one position layer per level row (VC.levelPosition), 4 levels", okBars && !/pvlr/.test(h));
  console.log("INFO  bars " + bars.map(([, L, w]) => `${L} ${w}`).join(", "));
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
  const missLine = (h.match(/Still shaky<\/p><p class="pvw">([\s\S]*?)<\/p>/) || [])[1] || "";
  check("a word missed this session leads the Still shaky line, max 12 words", VC.recentMisses(api.getProg(), VC.learnedWords(WORDS, PACK, api.getProg()))[0].id === missW.id && (missLine.match(/<span data-tl/g) || []).length <= 12 && stripTags(missLine.split("</span> <span")[0]).trim() === stripTags(api.wordForm(missW)).trim());
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

// [3] (flag off: Progress HTML byte-identical to 9667a81) deleted: progressView is engine default since the flag collapse.

console.log("\n[4] reading speed row (fb46): t stored at completion, guards, median after 3 passages");
{
  const rp = (done) => { const p = base({ sets: { "1": 1 } }); p.read = { done }; return p; };
  const mk = (pack, listen, t, prev) => { const p = rp(prev || {}); VC.markPassageDone(p, "p0001", 3, 4, "2026-10-04", listen, pack, t); return p.read.done.p0001; };
  check("core: t stored on a reading pass under v2, rounded", mk(PACK, false, 41.6).t === 42);
  check("core: no t for a listening pass, undefined or 0", mk(PACK, true, 40).t === undefined && mk(PACK, false, undefined).t === undefined && mk(PACK, false, 0).t === undefined);
  const prevT = { p0001: { sc: 1, n: 4, d: "x", x: 1, t: 50 } };
  check("core: a listening pass keeps the previous t, so the Reading row survives alternating read/listen passes", mk(PACK, true, 40, prevT).t === 50);
  check("core: a reading pass with its timing dropped keeps the previous t; a timed reading pass replaces it", mk(PACK, false, undefined, prevT).t === 50 && mk(PACK, false, 0, prevT).t === 50 && mk(PACK, false, 30, prevT).t === 30);
  {
    const pk = Object.assign({}, PACK), ps = PASSAGES.slice(0, 3), prog3 = rp(Object.fromEntries(ps.map(p => [p.id, { sc: 1, n: 1, d: "x", x: 1, t: 60 }])));
    ps.forEach(p => VC.markPassageDone(prog3, p.id, 1, 1, "2026-10-05", true, pk));
    check("speed: the Reading row survives a listening pass on every timed passage", VC.readingSpeed(ps, pk, prog3) !== null);
  }
  const pkSp = Object.assign({}, PACK, { spaced: false }), pkWd = Object.assign({}, PACK, { spaced: true });
  check("units: keyed on pack.spaced like passageLength (an unspaced pack counts letters, a spaced one words, whatever the whitespace ratio)", VC.passageUnits({ text: "ab cd ef" }, pkSp).unit === "characters" && VC.passageUnits({ text: "ab cd ef" }, pkSp).n === 6 && VC.passageUnits({ text: "abcdef ghij" }, pkWd).unit === "words" && VC.passageUnits({ text: "abcdef ghij" }, pkWd).n === 2);
  check("core: readTimeKeep: 1200 s kept, 1201 s dropped, hidden 120 s kept, 121 s dropped, 0 s dropped", VC.readTimeKeep(1200, 0) && !VC.readTimeKeep(1201, 0) && VC.readTimeKeep(60, 120000) && !VC.readTimeKeep(60, 120001) && !VC.readTimeKeep(0, 0));
  check("core: validateProgShape accepts numeric read.done.t, rejects a string", VC.validateProgShape(rp({ p0001: { sc: 1, n: 1, d: "x", x: 1, t: 9 } }), VC.levelIds(PACK)).ok && VC.validateProgShape(rp({ p0001: { sc: 1, n: 1, d: "x", x: 1, t: "9" } }), VC.levelIds(PACK)).reason === "read.done.p0001.t must be a number");
  const en = [1, 2, 3, 4].map(i => ({ id: "e" + i, text: Array(100).fill("word").join(" ") }));
  const dn = (ts) => rp(Object.fromEntries(ts.map((t, i) => ["e" + (i + 1), { sc: 1, n: 1, d: "x", x: 1, t }])));
  const PACKW = Object.assign({}, PACK, { spaced: true });
  check("speed: under 3 passages with t is no row", VC.readingSpeed(en, PACKW, dn([60, 60])) === null && VC.readingSpeed(en, PACKW, dn([60, 60, undefined])) === null);
  const s3 = VC.readingSpeed(en, PACKW, dn([30, 60, 120]));
  check("speed: median of 200, 100, 50 words a minute is 100 in words", s3 && s3.rate === 100 && s3.unit === "words" && s3.n === 3);
  check("speed: even count averages the middle two", VC.readingSpeed(en, PACKW, dn([30, 60, 120, 240])).rate === 75);
  const zhp = PASSAGES.slice(0, 3);
  const zs = VC.readingSpeed(zhp, PACK, rp(Object.fromEntries(zhp.map(p => [p.id, { sc: 1, n: 1, d: "x", x: 1, t: 60 }]))));
  check("speed: zh counts characters", zs && zs.unit === "characters" && zs.rate === Math.round(([...zhp.map(p => VC.passageUnits(p, PACK).n)].sort((a, b) => a - b))[1]) && zs.rate > 20);

  // The app: a pass opened, read, finished.
  const { api, st } = await bootWith(PACK, midProg(), 5);
  const pid = PASSAGES[0].id;
  const pass = async (secs, hid) => { api.startPassage(pid); if(hid){ api.vis("hidden"); NOW += hid * 1000; api.vis("visible"); } NOW += (secs - (hid || 0)) * 1000; api.finishPassage(); return (api.getProg().read.done[pid] || {}).t; };
  const t0 = NOW;
  check("app: finishing a pass stores whole seconds open to results", await pass(95) === 95);
  check("app: hidden 60 s of the pass keeps t", await pass(200, 60) === 200);
  check("app: hidden 150 s drops this timing and keeps the previous t (200)", await pass(300, 150) === 200);
  check("app: a pass over 20 minutes drops this timing and keeps the previous t (200)", await pass(1300) === 200);
  check("app: the stored record carries the last kept t after a dropped pass (200)", stored(st, PACK).read.done[pid].t === 200);
  api.startPassage(pid); NOW += 50000;
  const rec = JSON.parse(JSON.stringify(api.rd()));
  check("app: t0 is on the pass in progress", typeof api.rd().t0 === "number" && api.rd().hid === 0);
  api.finishPassage();
  check("app: t stored once, at completion", api.getProg().read.done[pid].t === 50);
  NOW = t0;
  const ids = PASSAGES.slice(0, 3).map(p => p.id);
  for(const id of ids){ api.startPassage(id); NOW += 60000; api.finishPassage(); }
  api.clickTab("progress");
  const h4 = stripTags(api.panel());
  const u = ids.map(id => VC.passageUnits(PASSAGES.find(p => p.id === id), PACK).n);
  const med = Math.round(u.slice().sort((a, b) => a - b)[1]);
  check("app: Progress shows Reading: N characters a minute after 3 passages", h4.includes(`Reading ${med} characters a minute`));
  const fewer = await bootWith(PACK, (() => { const p = midProg(); p.read = { done: { [ids[0]]: { sc: 1, n: 1, d: "x", x: 1, t: 60 }, [ids[1]]: { sc: 1, n: 1, d: "x", x: 1, t: 60 } } }; return p; })(), 5);
  fewer.api.clickTab("progress");
  check("app: two timed passages show no Reading row", !/Reading \d/.test(stripTags(fewer.api.panel())));
}

{
  console.log("\n[5] fb53: level row bars show position, placed words counted (spanish, owner shape)");
  const sim = require("./lib/sim_app.js"), repo = path.join(ROOT, "..", "spanish");
  if(!fs.existsSync(path.join(repo, "pack", "words.json"))){ skips++; console.log("SKIP  ../spanish/pack not found"); }
  else {
    const E = sim.enrichedDir("es", repo), D = sim.loadPackDir(E.dir), SP = D.PACK, S = sim.createSim(D);
    const LV = VC.levelIds(SP), BY = VC.wordsByLevel(D.WORDS, SP), size = VC.setSizeOf(SP);
    const mk = (through) => { const p = VC.normalizeProg({}, SP); p.placedOnce = true; p.pl = LV[LV.length - 1];
      LV.forEach((lv, i) => { const n = i < LV.length - 1 ? BY[lv].length : through * size; BY[lv].slice(0, n).forEach(w => { p.w[w.id] = { r: 1, w: 0, s: 1, prov: 1 }; }); });
      LV.forEach(lv => VC.settleSetCounter(p, D.WORDS, SP, lv)); return p; };
    const rows = html => [...html.matchAll(/<span>([^<]+)<\/span><span class="pvn">([^<]*)<\/span>[\s\S]*?<i class="pvm" style="width:([\d.]+)%"/g)].map(m => ({ L: m[1], txt: m[2], w: +m[3] }));
    const { api } = { api: await S.bootWith(SP, mk(35), 3) }; api.clickTab("progress");
    const r = rows(api.panel()).filter(x => LV.includes(x.L));
    console.log("INFO  " + JSON.stringify(r));
    const by = Object.fromEntries(r.map(x => [x.L, x]));
    check(`${LV[0]} and ${LV[1]} bars full, ${LV[2]} about half (35 of ${Math.ceil(BY[LV[2]].length / size)} sets)`, by[LV[0]] && by[LV[1]] && by[LV[2]] && by[LV[0]].w === 100 && by[LV[1]].w === 100 && Math.abs(by[LV[2]].w - 100 * 35 * size / BY[LV[2]].length) < 0.6, JSON.stringify(r));
    check("row texts stay literal (mastered counts on open levels, learned on a level not open for reading), not position", r.every(x => /^\d+ of \d+ mastered$|^\d+ learned$/.test(x.txt)) && by[LV[0]].txt === "0 of 600 mastered" && by[LV[1]].txt === "0 of 700 mastered", JSON.stringify(r));
    check("aria label carries the position", /aria-label="[^"]*: 100% known/.test(api.panel()));
    { const p35 = mk(35), li = VC.levelIndexMap(SP), goals = VC.progressMapGoals(SP);
      const exp = goals.map(g => { const lvs = LV.filter(lv => li[lv] <= li[String(g.upTo)]); const tot = lvs.reduce((a, lv) => a + BY[lv].length, 0); return lvs.reduce((a, lv) => a + VC.levelPosition(p35, SP, lv, D.WORDS, []) * BY[lv].length, 0) / tot; });
      const got = VC.goalPositions(p35, SP, D.WORDS, [], []);
      check("goal bar equals the size-weighted level bars (one shared predicate), spanish placed through " + LV[2] + " set 35: " + got.map(x => x.toFixed(3)).join("/"), goals.length >= 1 && got.every((x, i) => Math.abs(x - exp[i]) < 1e-9), JSON.stringify({ got, exp })); }
    const f = await S.bootWith(SP, null, 4); f.clickTab("progress");
    const fr = rows(f.panel()).filter(x => LV.includes(x.L));
    check("fresh record: the first level row draws a 0% bar", fr.length >= 1 && fr[0].w === 0, JSON.stringify(fr));
  }
}

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
})();
