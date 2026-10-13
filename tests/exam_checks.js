// Level exam and critical set (docs/PACK_SCHEMA.md "Level exam and critical set"; owner 2026-10-12): [1] core: gate
// availability (examLevels / examReady), the exam plan's item mix and counts, word-kind fallback on a level without
// sentences, examAgo; [2] crit set: add / remove / oldest-first, settle at known on the mark path, export round-trip,
// migration shape; [3] Review reserve: <= CRIT_SLOTS oldest-first in the unified, word-only and pairs planners, typed
// when a typed kind fits; plans without crit byte-equal main; [4] app: Test row + Today line, bare items (no ruby /
// reading / pinyin before the verdict, reveal keeps it), one attempt each, score, crit written on a miss, "Added to
// critical", the Test row's last score, parked exam resumes bare; [5] Words flag toggle; [6] Progress row.
// Run: node tests/exam_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf, withCollapsed } = require("./lib/pack_flags.js");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
const MAIN = "8604b17";
const MAIN_CORE = (() => { for(const d of [path.join(ROOT, "..", "vocab-engine"), path.join(ROOT, "..", "ve-main")]) { const f = path.join(d, "engine", "core.js"); if(fs.existsSync(f) && fs.realpathSync(f) !== fs.realpathSync(path.join(ROOT, "engine", "core.js"))) return require(f); } return null; })();
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
  const voices = o.voices || [{ lang: (pack && pack.tts) || "zh-CN", name:"x" }];
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
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","Date","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS","PATTERNS","SCRIPT"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent: o.ua || "AppViewChecks/1.0" }, undefined, st.ls, st.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, FakeDate, pack, o.words || WORDS, o.sentences || SENTENCES, o.lessons || LESSONS, o.passages || PASSAGES, "characters" in o ? o.characters : CHARACTERS, o.patterns ? PATTERNS : undefined, o.script];
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
const escapeHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const OWNER = (() => { for(const f of [process.env.PAIRS_OWNER, path.join(ROOT, "..", "chinese", ".cache", "owner-progress.json")]) if(f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); return null; })();
const LV = VC.levelIds(PACK), BYLV = VC.wordsByLevel(WORDS, PACK);
const freshRec = () => VC.normalizeProg({}, PACK);
const KNOWN_REC = () => ({ r: 6, w: 0, s: 6, p: { wm: [3, 1], sm: [3, 1], ws: [3, 1] } });
// HSK 1 fully known, the first 30 HSK 2 words learned (streak 1), so Learn is at HSK 2 and HSK 1 is offered.
function hsk1Known(){
  const p = freshRec(); p.sessions = 12; p.sn = 12; p.placedOnce = true;
  BYLV[LV[0]].forEach(w => { p.w[w.id] = KNOWN_REC(); });
  BYLV[LV[1]].slice(0, 30).forEach(w => { p.w[w.id] = { r: 1, w: 0, s: 1 }; });
  p.sets[LV[0]] = Math.ceil(BYLV[LV[0]].length / VC.setSizeOf(PACK)); p.sets[LV[1]] = 3;
  return p;
}
const PINYIN = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
const hasAid = h => /<ruby|<rt|class="pron"|class="op"|class="rp"|class="sp"|class="tpron"/.test(h) || PINYIN.test(stripTags(h));
const stem = api => { const h = api.panel(); const a = h.indexOf("</p>") + 4; const ends = ['<div class="opts', "<input", '<div class="reveal"'].map(x => h.indexOf(x)).filter(i => i >= 0); return h.slice(a, Math.min(...ends)); };
const optsHtml = api => (api.el("o") ? api.el("o").children : []).map(b => b.innerHTML).join("");
const examRow = (api, lv) => api.el("tExam_" + lv);

(async () => {
console.log("\n[1] core: gate availability and the exam plan");
{
  const p = freshRec();
  check("fresh record: no level is offered, Today has no exam line", VC.examLevels(WORDS, PACK, p, CHARACTERS).length === 0 && VC.examReady(WORDS, PACK, p, CHARACTERS) === null);
  const k = hsk1Known();
  check("HSK 1 fully known, Learn at HSK 2: HSK 1 offered, HSK 2-4 not, examReady HSK 1", JSON.stringify(VC.examLevels(WORDS, PACK, k, CHARACTERS)) === JSON.stringify([LV[0]]) && VC.examReady(WORDS, PACK, k, CHARACTERS) === LV[0]);
  const u = clone(k); BYLV[LV[0]].forEach((w, i) => { if(i % 2) u.w[w.id] = { r: 1, w: 1, s: 0 }; });
  check("HSK 1 at 50% known (not settled): not offered", VC.examLevels(WORDS, PACK, u, CHARACTERS).length === 0);
  // A level Learn has passed with every learned word known (settled) is offered whatever its share: here the
  // whole level is learned, so the share is 100% too; the clause matters only for a level Learn skipped.
  const st = clone(k); BYLV[LV[0]].forEach((w, i) => { if(i % 10 === 0) st.w[w.id] = { r: 1, w: 1, s: 0 }; });
  check("HSK 1 at 90% known, Learn at HSK 2 (settled): offered", JSON.stringify(VC.examLevels(WORDS, PACK, st, CHARACTERS)) === JSON.stringify([LV[0]]));
  { const two = clone(k); BYLV[LV[1]].forEach(w => { two.w[w.id] = KNOWN_REC(); }); BYLV[LV[2]].slice(0, 10).forEach(w => { two.w[w.id] = { r: 1, w: 0, s: 1 }; });
    check("HSK 1 and 2 known: both offered; examReady is the LOWEST without an exam (HSK 1), then HSK 2 once HSK 1 is taken", JSON.stringify(VC.examLevels(WORDS, PACK, two, CHARACTERS)) === JSON.stringify([LV[0], LV[1]]) && VC.examReady(WORDS, PACK, two, CHARACTERS) === LV[0] && (VC.examRecord(two, LV[0], 10, 20, "2026-10-12"), VC.examReady(WORDS, PACK, two, CHARACTERS) === LV[1]));
    check("noteExamSeen writes prog.exam.seen = level once; examSeen reads it; examResult ignores the key; a later level is not seen", !VC.examSeen(two, LV[1]) && VC.noteExamSeen(two, LV[1]) && !VC.noteExamSeen(two, LV[1]) && two.exam.seen === LV[1] && VC.examSeen(two, LV[1]) && VC.examResult(two, "seen") === null && !VC.examSeen(two, LV[2]));
    // Sentence-miss flags: exam-level words not known, lowest streak first, two per sentence, the exam's cap.
    const s3 = SENTENCES.find(s => String(s.lv) === LV[0] && new Set(s.words).size >= 4), ids = [...new Set(s3.words)].filter(id => String(BY_ID[id].lv) === LV[0]);
    const m = clone(two); ids.forEach((id, i) => { m.w[id] = { r: 1, w: 0, s: 3 - (i % 3), p: { wm: [0, 1] } }; }); // every one unknown (wm 0), streaks 3,2,1,...
    const got = VC.examMissWords(m, s3, LV[0], WORDS, PACK, 6);
    check("examMissWords: two words, the lowest streaks first, none known, none already critical", got.length === 2 && got.every(id => ids.includes(id)) && Math.max(...got.map(id => m.w[id].s)) <= Math.min(...ids.filter(id => !got.includes(id)).map(id => m.w[id].s)) && VC.examMissWords(m, s3, LV[0], WORDS, PACK, 1).length === 1 && VC.examMissWords(m, s3, LV[0], WORDS, PACK, 0).length === 0 && (got.forEach(id => VC.critAdd(m, id, 1)), !VC.examMissWords(m, s3, LV[0], WORDS, PACK, 6).some(id => got.includes(id))));
    ids.forEach(id => { m.w[id] = KNOWN_REC(); });
    check("examMissWords: every word known -> none flagged", VC.examMissWords(m, s3, LV[0], WORDS, PACK, 6).length === 0 && VC.EXAM_SENT_CRIT === 2 && VC.EXAM_CRIT_MAX === 6); }
  VC.examRecord(k, LV[0], 12, 20, "2026-10-09");
  check("an exam taken: examResult { r, n, d }, examReady null, examAgo 3 days ago / yesterday / today", JSON.stringify(VC.examResult(k, LV[0])) === JSON.stringify({ r: 12, n: 20, d: "2026-10-09" }) && VC.examReady(WORDS, PACK, k, CHARACTERS) === null && VC.examAgo(VC.examResult(k, LV[0]), "2026-10-12") === "3 days ago" && VC.examAgo({ d: "2026-10-11" }, "2026-10-12") === "yesterday" && VC.examAgo({ d: "2026-10-12" }, "2026-10-12") === "today");
  check("EXAM_SIZE 20 = the mix 6 hear-sentence + 5 gap + 4 read-sentence + 3 written->meaning + 2 recall; CRIT_SLOTS 3", VC.EXAM_SIZE === 20 && VC.EXAM_MIX.reduce((n, [, c]) => n + c, 0) === 20 && JSON.stringify(VC.EXAM_MIX) === JSON.stringify([["hearS", 6], ["gap", 5], ["readS", 4], ["typeM", 3], ["recall", 2]]) && VC.CRIT_SLOTS === 3);
  const opts = { typedOk: () => true, gapOk: s => VC.gapCandidateIndices(s, BY_ID, PACK).length > 0, canHear: () => true };
  const plan = VC.examPlan(WORDS, SENTENCES, PACK, k, LV[2], VC.seededRng(7), opts);
  const cnt = plan.reduce((m, it) => { m[it.kind] = (m[it.kind] || 0) + 1; return m; }, {});
  check("HSK 3 plan: 20 items, 6 hearS / 5 gap / 4 readS / 3 typeM / 2 recall", plan.length === 20 && cnt.hearS === 6 && cnt.gap === 5 && cnt.readS === 4 && cnt.typeM === 3 && cnt.recall === 2);
  check("every item is of HSK 3; no sentence twice; no word twice among word items; every gap sentence has a blank", plan.every(it => String((it.s || it.word).lv) === LV[2]) && new Set(plan.filter(it => it.s).map(it => it.s.id)).size === 15 && new Set(plan.filter(it => it.word).map(it => it.word.id)).size === 5 && plan.filter(it => it.kind === "gap").every(it => opts.gapOk(it.s)));
  const plan2 = VC.examPlan(WORDS, SENTENCES, PACK, k, LV[2], VC.seededRng(7), opts), plan3 = VC.examPlan(WORDS, SENTENCES, PACK, k, LV[2], VC.seededRng(8), opts);
  const key = pl => pl.map(it => it.kind + ":" + (it.s || it.word).id).join(",");
  check("seeded: the same seed draws the same plan, another seed a different one", key(plan) === key(plan2) && key(plan) !== key(plan3));
  const noTyped = VC.examPlan(WORDS, SENTENCES, PACK, k, LV[2], VC.seededRng(7), Object.assign({}, opts, { typedOk: () => false }));
  check("typedOk false: the 3 written->meaning slots fall to recall (5 recall)", noTyped.filter(it => it.kind === "recall").length === 5 && !noTyped.some(it => it.kind === "typeM"));
  const noSent = VC.examPlan(WORDS, [], PACK, k, LV[2], VC.seededRng(7), opts);
  const c2 = noSent.reduce((m, it) => { m[it.kind] = (m[it.kind] || 0) + 1; return m; }, {});
  check("no sentences for the level: word kinds in the same proportions (6 hear, 9 read, 3 typeM, 2 recall), 20 distinct words", noSent.length === 20 && c2.hear === 6 && c2.read === 9 && c2.typeM === 3 && c2.recall === 2 && new Set(noSent.map(it => it.word.id)).size === 20);
  const noVoice = VC.examPlan(WORDS, [], PACK, k, LV[2], VC.seededRng(7), Object.assign({}, opts, { canHear: () => false }));
  check("no voice: hear fallbacks become read", noVoice.filter(it => it.kind === "read").length === 15 && !noVoice.some(it => it.kind === "hear"));
  const small = VC.examPlan(WORDS.filter(w => w.lv !== LV[2] || BYLV[LV[2]].indexOf(w) < 3), [], PACK, k, LV[2], VC.seededRng(7), opts);
  check("a level with 3 words: 3 items", small.length === 3);
}

console.log("\n[2] crit set");
{
  const p = freshRec();
  check("critAdd writes prog.crit[id] = session; a second add is a no-op; critHas", VC.critAdd(p, "w0001", 4) && !VC.critAdd(p, "w0001", 9) && p.crit.w0001 === 4 && VC.critHas(p, "w0001") && !VC.critHas(p, "w0002"));
  VC.critAdd(p, "w0003", 2); VC.critAdd(p, "w0002", 2);
  check("critWords: oldest session first, then id", VC.critWords(p, WORDS).map(w => w.id).join(",") === "w0002,w0003,w0001");
  check("critRemove drops the id; the key goes with its last word", VC.critRemove(p, "w0001") && VC.critRemove(p, "w0002") && p.crit && VC.critRemove(p, "w0003") && !("crit" in p) && !VC.critRemove(p, "w0003"));
  const q = freshRec(); const w = BYLV[LV[0]][0];
  q.w[w.id] = { r: 1, w: 1, s: 0, p: { wm: [0, 1] } }; VC.critAdd(q, w.id, 1);
  check("critSettle: a miss keeps it; a right answer on a word not yet known keeps it", !VC.critSettle(q, w.id, w, PACK, false) && !VC.critSettle(q, w.id, w, PACK, true) && VC.critHas(q, w.id));
  q.w[w.id] = KNOWN_REC();
  check("critSettle: a right answer on a known word (every pair at its bar) removes it", VC.critSettle(q, w.id, w, PACK, true) && !("crit" in q));
  const e = hsk1Known(); VC.critAdd(e, "w0001", 3); VC.examRecord(e, LV[0], 15, 20, "2026-10-12");
  const imp = VC.applyImport(null, JSON.stringify(e), PACK);
  check("export round-trip: crit and exam survive applyImport; validateProgShape accepts them", imp.ok && JSON.stringify(imp.prog.crit) === JSON.stringify({ w0001: 3 }) && JSON.stringify(imp.prog.exam) === JSON.stringify(e.exam) && VC.validateProgShape(e, LV).ok);
  const bare = freshRec();
  check("migration: a fresh record has neither key; normalizeProg adds none", !("crit" in bare) && !("exam" in bare) && !("crit" in VC.normalizeProg(bare, PACK)));
}

console.log("\n[3] Review reserve");
{
  const rng = () => VC.seededRng(11);
  const learned = () => VC.learnedWords(WORDS, PACK, hsk1Known());
  const k = hsk1Known(); const lw = learned();
  const critIds = lw.slice(0, 5).map(w => w.id);
  critIds.forEach((id, i) => VC.critAdd(k, id, 10 - i)); // w4 oldest (6) ... w0 newest (10)
  const oldest = critIds.slice().reverse().slice(0, 3);
  const O = { canHear: () => true, typedOk: () => true, typedKindFits: (w, kd) => VC.typedKindOk(kd, w, true), sn: 13 };
  // unified (units recorded)
  k.chars.c[CHARACTERS[0].id] = { r: 2, w: 0, s: 2 };
  const uni = VC.buildReviewPlan(lw, k, PACK, Object.assign({ rng: rng(), units: CHARACTERS }, O));
  const critIn = pl => pl.filter(it => it.word && VC.critHas(k, it.word.id));
  check("unified plan: exactly 3 crit items, the 3 oldest-added, all typed (typedOk), 15 items", uni.length === 15 && critIn(uni).length === 3 && JSON.stringify(critIn(uni).map(it => it.word.id).sort()) === JSON.stringify(oldest.slice().sort()) && critIn(uni).every(it => it.kind === "type" && it.crit));
  const uniR = VC.buildReviewPlan(lw, k, PACK, Object.assign({ rng: rng(), units: CHARACTERS }, O, { typedOk: () => false }));
  check("unified plan: no typed kind fits -> recall", critIn(uniR).length === 3 && critIn(uniR).every(it => it.kind === "recall"));
  // word-only
  const k2 = clone(k); delete k2.chars;
  const wo = VC.buildReviewPlan(lw, k2, PACK, Object.assign({ rng: rng() }, O));
  check("word-only plan: 3 crit items, the oldest, typed", wo.length === 15 && critIn(wo).length === 3 && JSON.stringify(critIn(wo).map(it => it.word.id).sort()) === JSON.stringify(oldest.slice().sort()) && critIn(wo).every(it => it.kind === "type"));
  // pairs (day-aware)
  const dy = VC.buildReviewPlan(lw, k, PACK, Object.assign({ rng: rng(), units: CHARACTERS, today: "2026-10-12" }, O));
  check("pairs plan (dayReviewPlan / pairPlan): 3 crit items, the oldest, typed, 15 items", dy.length === 15 && critIn(dy).length === 3 && JSON.stringify(critIn(dy).map(it => it.word.id).sort()) === JSON.stringify(oldest.slice().sort()) && critIn(dy).every(it => it.kind === "type" && it.pair));
  const dyR = VC.buildReviewPlan(lw, k, PACK, Object.assign({ rng: rng(), units: CHARACTERS, today: "2026-10-12" }, O, { typedKindFits: () => false }));
  check("pairs plan: no typed kind fits -> recall on wm", critIn(dyR).length === 3 && critIn(dyR).every(it => it.kind === "recall" && it.pair === "wm"));
  const one = clone(hsk1Known()); VC.critAdd(one, critIds[0], 1);
  check("one crit word: one reserved slot in each planner", [VC.buildReviewPlan(lw, one, PACK, Object.assign({ rng: rng() }, O)), VC.buildReviewPlan(lw, one, PACK, Object.assign({ rng: rng(), today: "2026-10-12" }, O))].every(pl => pl.filter(it => it.word && it.word.id === critIds[0]).length === 1 && pl.length === 15));
  const rc = VC.buildRecallPlan(lw, k, PACK, 8, Object.assign({ rng: rng(), today: "2026-10-12" }, O));
  check("Recall keeps no reserve (the crit words come by their own order)", rc.length === 8);
  if(MAIN_CORE){
    const key = pl => JSON.stringify(pl.map(it => [it.kind, it.word ? it.word.id : it.unit.id, it.pair || null]));
    const base = hsk1Known(); base.chars.c[CHARACTERS[0].id] = { r: 2, w: 0, s: 2 };
    const same = [[{ units: CHARACTERS }], [{}], [{ units: CHARACTERS, today: "2026-10-12" }], [{ today: "2026-10-12" }]].every(([x]) => key(VC.buildReviewPlan(lw, clone(base), PACK, Object.assign({ rng: rng() }, O, x))) === key(MAIN_CORE.buildReviewPlan(lw, clone(base), PACK, Object.assign({ rng: rng() }, O, x))));
    check("no crit: every planner's plan equals main's core (same seed)", same);
  } else skip("no main checkout beside this one: planner control skipped");
}

console.log("\n[4] app: Test row, Today line, the exam drill");
{
  const { api: f } = await bootWith(PACK, freshRec(), 1);
  f.clickTab("test");
  check("fresh record: no exam row on Test", !/Level exam/.test(f.panel()));
  const { api, st } = await bootWith(PACK, hsk1Known(), 2);
  check("Today: one line \"Level exam ready: HSK 1\" linking to Test", /id="examReady"[^>]*>Level exam ready: HSK 1<\/button>/.test(api.panel()) && !/Level exam ready: HSK 2/.test(api.panel()));
  api.el("examReady").click();
  check("the line opens the Test tab; the row \"Level exam: HSK 1\" is there, HSK 2-4 are not, no last score", api.title() === "Test" && examRow(api, LV[0]) && /Level exam: HSK 1<\/button>/.test(api.panel()) && !/Level exam: HSK 2/.test(api.panel()) && !api.el("tExamLast_" + LV[0]));
  check("opening Test notes prog.exam.seen = \"1\" (stored); Today's line is gone before any exam; a reboot keeps it gone", api.getProg().exam.seen === LV[0] && stored(st, PACK).exam.seen === LV[0] && (api.clickTab("today"), !/examReady/.test(api.panel())) && !/examReady/.test((await bootWith(PACK, api.getProg(), 9)).api.panel()));
  api.clickTab("test");
  examRow(api, LV[0]).click();
  const D0 = api.getD();
  check("the exam starts: 20 items, header names it, D.once set", D0 && D0.q.length + 1 === 20 && api.title() === "Level exam: HSK 1" && D0.once === true);
  let n = 0, aids = 0, kinds = {}, revealsWithPron = 0, pronFirstStems = 0, wrong = [];
  const lvIds = new Set(BYLV[LV[0]].map(w => w.id));
  const bareOk = [];
  for(let guard = 0; guard < 40 && api.getD() && api.getCur(); guard++){
    const it = api.getCur(); n++;
    const b = it.rz && it.rz.b; kinds[b] = (kinds[b] || 0) + 1;
    const s = stem(api), o = optsHtml(api);
    if(hasAid(s) || hasAid(o)) aids++;
    if(String(it.key).startsWith("w:") && it.label === "What does it mean?" && !/hear-stage/.test(s)){ const w = BY_ID[it.key.slice(2)]; if(!s.includes(escapeHtml(w.w))) pronFirstStems++; }
    bareOk.push(it.bare === true);
    const miss = n % 3 === 0; if(miss) wrong.push(it.key);
    answer(api, !miss);
    if(PINYIN.test(stripTags(api.el("rv").innerHTML))) revealsWithPron++;
    api.el("nx").click();
  }
  check("20 asks, every item bare, no reading / ruby / pinyin in any stem or option set", n === 20 && aids === 0 && bareOk.every(Boolean) && pronFirstStems === 0);
  check("items are built by the exam builder (resumable recipe) in the planned kinds", kinds.exam === 20 && D0.q.every(it => it.rz && it.rz.b === "exam"));
  check("the reveal after the verdict keeps the reading (as Review does)", revealsWithPron >= 10);
  const fin = api.fin();
  check("one attempt each: no miss requeued; result \"14 of 20\"; Missed rows; \"Added to critical: k words\"", !api.getD() && fin && fin.seen === 20 && fin.miss.length === 6 && /<h2>14 of 20<\/h2>/.test(api.panel()) && /class="pvk">Missed</.test(api.panel()) && /id="examCrit">Added to critical: \d+ words?<\/p>/.test(api.panel()));
  const prog = api.getProg();
  const critN = Object.keys(prog.crit || {}).length, said = +(/Added to critical: (\d+)/.exec(api.panel()) || [])[1];
  check("every missed word (gap: the blanked word; sentence: up to 2 unknown HSK 1 words, 6 per exam) is in prog.crit with the session number; the line counts them", critN > 0 && critN === said && Object.values(prog.crit).every(v => v === VC.daySn(prog)) && Object.keys(prog.crit).every(id => lvIds.has(id)) && fin.cs <= 6 && critN <= wrong.filter(k => k.startsWith("w:")).length + wrong.filter(k => k.startsWith("s:")).length * 2 && Object.keys(prog.crit).every(id => prog.w[id]));
  check("prog.exam[\"1\"] = { r: 14, n: 20, d: today }; the record is stored", JSON.stringify(prog.exam["1"]) === JSON.stringify({ r: 14, n: 20, d: DAY }) && prog.exam.seen === LV[0] && JSON.stringify(stored(st, PACK).exam) === JSON.stringify(prog.exam));
  check("exam answers mark the records: a missed word's pair streak reset to 0 (wm or sm)", wrong.filter(k => k.startsWith("w:")).every(k => { const r = prog.w[k.slice(2)]; return r.w >= 1 && (r.p.wm[0] === 0 || r.p.sm[0] === 0); }));
  api.el("ok").click();
  check("Continue returns to Test; the row shows the last score \"14 of 20, today\"; Today's line is gone", api.title() === "Test" && /id="tExamLast_1"[^>]*>14 of 20, today<\/p>/.test(api.panel()) && (api.clickTab("today"), !/examReady/.test(api.panel())));
  // Same tab, no reload: the Review plan reads the exam's prog.crit writes.
  {
    const cm = Object.keys(api.getProg().crit || {});
    const oldest = VC.critWords(api.getProg(), WORDS).slice(0, 3).map(w => w.id);
    api.clickTab("words"); api.el("rev").click();
    const wi = [api.getCur(), ...api.getD().q].map(it => String(it.key));
    check(`same tab after the exam (${cm.length} flagged): Words-tab Review holds the ${oldest.length} oldest critical words`, oldest.length >= 1 && oldest.every(id => wi.includes("w:" + id)));
  }
  // Retake any time.
  api.clickTab("test"); examRow(api, LV[0]).click();
  check("retake: a new exam starts", api.getD() && api.getD().q.length === 19);
  // Park mid-exam and resume in a new boot: items still bare, once kept.
  await tick();
  api.ev("sessionSave(true)");
  const r2 = await boot(PACK, st, 3);
  r2.clickTab("test");
  const resumed = r2.ev("sessionResume('test')");
  const D2 = r2.getD();
  check("a parked exam resumes: items rebuilt bare by the exam recipe, once kept, results summary the exam's", resumed && D2 && D2.once === true && D2.q.every(it => it.bare === true && it.rz.b === "exam") && D2.rzs && D2.rzs.s === "exam" && !hasAid(stem(r2)) && !hasAid(optsHtml(r2)));
  // Review reserve in the app: Words-tab Review draws the crit words.
  const { api: rv } = await bootWith(PACK, api.getProg(), 4);
  rv.clickTab("words"); rv.el("rev").click();
  const items = [rv.getCur(), ...rv.getD().q], crit = items.filter(it => String(it.key).startsWith("w:") && VC.critHas(rv.getProg(), it.key.slice(2)));
  const oldest3 = VC.critWords(rv.getProg(), WORDS).slice(0, 3).map(w => w.id);
  check(`Words-tab Review: the ${oldest3.length} oldest-added critical words are in the plan (more may come by rank: exam misses are weak)`, oldest3.length >= 1 && crit.length >= oldest3.length && oldest3.every(id => crit.some(it => it.key === "w:" + id)));
}

console.log("\n[5] Words flag toggle");
{
  const { api, st } = await bootWith(PACK, hsk1Known(), 5);
  api.clickTab("words");
  const rows = () => api.ev("$('wl').children.map(r => r.innerHTML).join('')"); // rows are appended elements, not panel html
  const w = BY_ID[(/id="cf_(w\d+)"/.exec(rows()) || [])[1]]; // the first row shown (the Words tab opens on Learn's level)
  const b = w && api.el("cf_" + w.id);
  check("every row has an icon-only flag button, aria-label \"Mark critical\", not pressed; no affordance text", b && b.getAttribute("aria-label") === "Mark critical" && b.getAttribute("aria-pressed") === "false" && (rows().match(/class="cflag/g) || []).length === 10 && !/Mark critical</.test(rows()) && /<svg/.test(rows()));
  b.click();
  const p = api.getProg();
  check("tap: prog.crit gains the word with the session number, the row's flag is filled (on, aria-label \"Unmark\")", p.crit && p.crit[w.id] === VC.daySn(p) && api.el("cf_" + w.id).getAttribute("aria-label") === "Unmark" && api.el("cf_" + w.id).getAttribute("aria-pressed") === "true" && (rows().match(/class="cflag on"/g) || []).length === 1 && stored(st, PACK).crit[w.id] === VC.daySn(p));
  api.el("cf_" + w.id).click();
  check("tap again: removed, the key gone from the record", !("crit" in api.getProg()) && !("crit" in stored(st, PACK)) && api.el("cf_" + w.id).getAttribute("aria-label") === "Mark critical");
}

console.log("\n[6] Progress row");
{
  const rec = hsk1Known();
  const { api: none } = await bootWith(PACK, rec, 6);
  none.clickTab("progress");
  check("no crit words: no row", !/Exam misses/.test(none.panel()));
  const ids = BYLV[LV[0]].slice(0, 4).map(w => w.id); ids.forEach((id, i) => VC.critAdd(rec, id, 3 + i));
  VC.critAdd(rec, BYLV[LV[3]][0].id, 2); // flagged without a record: Review cannot draw it, the row does not count it
  const { api } = await bootWith(PACK, rec, 6);
  api.clickTab("progress");
  check("row \"Exam misses\" / \"4 left\" among the level rows, folded", /id="pvCrit"[^>]*aria-expanded="false"[^>]*><span>Exam misses<\/span><span class="pvn">4 left<\/span>/.test(api.panel()) && !/id="pvCritList"/.test(api.panel()));
  api.el("pvCrit").click();
  const h = api.panel();
  check("tap: the word list opens in Missed-row markup (mrow / mtap per word, oldest first), the row stays", /id="pvCrit"[^>]*aria-expanded="true"/.test(h) && (h.match(/class="mrow"/g) || []).length === 4 && h.indexOf(BY_ID[ids[0]].w) < h.indexOf(BY_ID[ids[3]].w));
  api.el("pvCrit").click();
  check("tap again folds it", !/id="pvCritList"/.test(api.panel()));
  // Mastery on the mark path removes a crit word; the row count follows.
  const w = BY_ID[ids[0]]; api.ev(`markWord(${JSON.stringify(w.id)}, true, "type")`);
  check("a right typed answer on a known word retires it from the set: 3 left", !VC.critHas(api.getProg(), w.id) && (api.clickTab("progress"), /<span class="pvn">3 left<\/span>/.test(api.panel())));
}

console.log("\n[8] bare items on the ja pack (ruby, pronFirst, kana typing) and a Latin pack (italian)");
for(const [name, dir] of [["ja", process.env.JA_PACK || path.join(ROOT, "..", "japanese", "pack")], ["it", process.env.IT_PACK || path.join(ROOT, "..", "italian", "pack")], ["fr", path.join(ROOT, "..", "french", "pack")], ["de", path.join(ROOT, "..", "german", "pack")], ["ru", path.join(ROOT, "..", "russian", "pack")]]){
  if(!fs.existsSync(path.join(dir, "pack.js"))){ console.log(`NOTE  ${name}: no pack at ${dir}, skipped`); continue; }
  const L = (f, v) => fs.existsSync(path.join(dir, f)) ? loadConst(path.join(dir, f), v) : undefined;
  const pk = L("pack.js", "PACK"), ws = L("words.js", "WORDS"), ss = L("sentences.js", "SENTENCES"), us = L("characters.js", "CHARACTERS"), sc = L("script.js", "SCRIPT");
  const lv = VC.levelIds(pk), by = VC.wordsByLevel(ws, pk), byId = Object.fromEntries(ws.map(w => [w.id, w]));
  const p = VC.normalizeProg({}, pk); p.sessions = 12; p.placedOnce = true;
  by[lv[0]].forEach(w => { p.w[w.id] = KNOWN_REC(); }); by[lv[1]].slice(0, 30).forEach(w => { p.w[w.id] = { r: 1, w: 0, s: 1 }; });
  if(sc) VC.answerScriptChoice(p, false);
  const { api } = await bootWith(pk, p, 21, { words: ws, sentences: ss, lessons: [], passages: [], characters: us, script: sc });
  api.clickTab("test");
  if(!examRow(api, lv[0])){ check(`${name}: exam row for ${lv[0]} on Test`, false); continue; }
  examRow(api, lv[0]).click();
  let n = 0, aids = 0, bad = [], wShown = 0, wTotal = 0;
  for(let guard = 0; guard < 40 && api.getD() && api.getCur(); guard++){
    const it = api.getCur(); n++;
    const s = stem(api), o = optsHtml(api), h = s + o;
    if(/<ruby|<rt|class="pron"|class="op"|class="rp"|class="sp"|class="tpron"|class="showw"/.test(h)){ aids++; bad.push(it.rz && it.rz.a[0]); }
    if(String(it.key).startsWith("w:") && it.label === "What does it mean?" && !/hear-stage/.test(s)){ const w = byId[it.key.slice(2)]; wTotal++; if(s.includes(escapeHtml(w.w)) && (!w.pron || !s.includes(escapeHtml(w.pron)))) wShown++; }
    if(!it.bare) bad.push("not bare");
    const w = byId[String(it.key).slice(2)];
    if(it.kind === "type"){ api.el("tin").value = it.label === "Type the meaning" && w ? VC.gloss(w) : "zzz"; api.el("submit").click(); } else answer(api, n % 2 === 0);
    api.el("nx").click();
  }
  check(`${name}: 20 bare asks, no ruby / reading / show-written markup in any stem or option set; read items show the written form without its reading (${wShown} of ${wTotal})${bad.length ? ` [${bad.join(", ")}]` : ""}`, n === 20 && aids === 0 && !bad.length && wShown === wTotal);
  check(`${name}: result screen, crit written, prog.exam.${lv[0]} stored`, !api.getD() && api.fin() && api.fin().seen === 20 && Object.keys(api.getProg().crit || {}).length > 0 && VC.examResult(api.getProg(), lv[0]) !== null);
  {
    const pr = api.getProg(), oldest = VC.critWords(pr, ws).filter(w => pr.w[w.id]).slice(0, 3).map(w => w.id);
    api.clickTab("words"); const rv = api.el("rev");
    if(!rv) check(`${name}: same-tab Review button after the exam`, false);
    else {
      rv.click();
      const keys = [api.getCur(), ...api.getD().q].map(it => String(it.key));
      api.clickTab("today"); api.el("go").click();
      const dd = api.getD(), ti = dd ? [api.getCur(), ...dd.q].map(it => String(it && it.key)) : [];
      check(`${name}: same tab after the exam, Today's Review stage holds the oldest critical words`, oldest.length >= 1 && oldest.every(id => ti.includes("w:" + id)));
      check(`${name}: same tab after the exam, Words-tab Review holds the ${oldest.length} oldest critical words with a record`, oldest.length >= 1 && oldest.every(id => keys.includes("w:" + id)));
    }
  }
  // A Review parked mid-way before the exam: coming back to it after the verdict, same tab, no reload.
  for(const where of ["today", "words"]){
    const { api: a2 } = await bootWith(pk, p, 22, { words: ws, sentences: ss, lessons: [], passages: [], characters: us, script: sc });
    a2.clickTab(where);
    if(where === "today") a2.el("go").click(); else a2.el("rev").click();
    for(let i = 0; i < 2 && a2.getD() && a2.getCur(); i++){ answer(a2, true); a2.el("nx").click(); }
    a2.clickTab("test"); examRow(a2, lv[0]).click();
    for(let g = 0, n2 = 0; g < 40 && a2.getD() && a2.getCur(); g++){ n2++; const it = a2.getCur(), w = byId[String(it.key).slice(2)]; if(it.kind === "type"){ a2.el("tin").value = "zzz"; a2.el("submit").click(); } else answer(a2, n2 % 2 === 0); a2.el("nx").click(); }
    const pr2 = a2.getProg(), old2 = VC.critWords(pr2, ws).filter(w => pr2.w[w.id]).slice(0, 3).map(w => w.id);
    a2.clickTab(where);
    if(where === "today" && a2.el("go")) a2.el("go").click(); else if(where === "words" && !a2.getD() && a2.el("rev")) a2.el("rev").click();
    const d2 = a2.getD(), k2 = d2 ? [a2.getCur(), ...d2.q].map(it => String(it && it.key)) : [];
    check(`${name}: Review parked before the exam, back in ${where} after it: the ${old2.length} oldest critical words are in the plan`, old2.length >= 1 && old2.every(id => k2.includes("w:" + id)));
  }
  // A word flagged on the Words tab while a Review is parked: the reserve reaches the resumed plan, the size stays.
  {
    const { api: a3 } = await bootWith(pk, p, 23, { words: ws, sentences: ss, lessons: [], passages: [], characters: us, script: sc });
    a3.clickTab("words"); a3.el("rev").click();
    for(let i = 0; i < 2 && a3.getD() && a3.getCur(); i++){ answer(a3, true); a3.el("nx").click(); }
    const n0 = a3.getD().q.length + 1, inPlan = new Set([a3.getCur(), ...a3.getD().q].map(it => String(it.key)));
    const pr3 = a3.getProg(), pick = VC.learnedWords(ws, pk, pr3).filter(w => !inPlan.has("w:" + w.id))[0];
    a3.clickTab("test"); a3.ev(`critToggle(${JSON.stringify(pick.id)})`); a3.clickTab("words");
    const k3 = [a3.getCur(), ...a3.getD().q].map(it => String(it.key));
    check(`${name}: word flagged while a Review is parked: it is in the resumed plan, queue length ${n0} kept, no key twice`, k3.includes("w:" + pick.id) && k3.length === n0 && new Set(k3).size === k3.length);
  }
}

if(OWNER){
  console.log("\n[7] owner export (read-only)");
  const o = clone(OWNER);
  const ls = VC.examLevels(WORDS, PACK, o, CHARACTERS);
  console.log(`  levels offered: ${ls.map(l => VC.levelLabel(PACK, l)).join(", ") || "none"}; ready: ${VC.examReady(WORDS, PACK, o, CHARACTERS)}`);
  check("owner export: the exam is offered for HSK 1 and HSK 2 (known past the gate) and not for HSK 4", ls.includes(LV[0]) && ls.includes(LV[1]) && !ls.includes(LV[3]));
}

console.log(`\n${passes} passed, ${fails} failed${skips ? `, ${skips} skipped` : ""}`);
process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
