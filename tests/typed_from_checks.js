// Checks for typed items from the target side and focused gloss display (pack.typedFrom,
// pack.glossFocus; docs/PACK_SCHEMA.md "typedFrom and glossFocus"): [1] config and kind
// rotation (core.js typedKinds/typedSlotKind/typedKindOk), [2] typed-meaning matcher
// (checkGlossTyped) and gloss formatter (glossParts), [3] app items on the zh pack: fallback
// when characters are not displayed, stimulus leaks (audio, taps, ruby, readings, tags), the
// renderer, choice fallback, miss kind, [4] glossFocus render sites ([5], the control vs main
// ef44c6e, went with the flag collapse: it predates pairs). The fix round adds reading notes kept off stimuli, the truncated / lone-letter /
// "A or B" matcher rules, qualifier placement and the characters -> pinyin choice fallback
// ([2], [3]). Boots engine/app.html in the fake DOM of tests/pron_aids_checks.js.
// Run: node tests/typed_from_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
// the pack this suite was written against: as shipped just before pairs (9eb6ecb), the collapsed flags now engine default
const PAIRS_ERA = "9eb6ecb~1";
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
// glossStyle (fb32) changes every gloss the controls render; tests/gloss_display_checks.js covers it.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), PAIRS_ERA);
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
// dayAware post-dates main ef44c6e: the control strips it with the fields under test.
// fb2-write (2026-10-02) split zh's characters stage per level and added characters.bareBy/bareWords/withWords;
// checks written against the earlier zh keep its shape (tests/typed_mastery_checks.js covers the new one).
const preWrite = p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; delete c.withWords; delete c.learn; return Object.assign({}, p, { characters: c }); };
const PACK_BASE = packAsOf(preWrite(PACK), "34c5df3", { strip: ["typedFrom", "glossFocus", "helpClose", "readAnswerBlock", "optsOneScript", "optsMix", "progressMap"] });
// words[].syn / typedSyn / noTypedMeaning / pronInGloss (docs/PACK_SCHEMA.md "Synonyms") are flag-on fields too.
const WORDS_OFF = WORDS.map(w => { const c = Object.assign({}, w); delete c.syn; delete c.typedSyn; delete c.noTypedMeaning; delete c.pronInGloss; return c; });

let fails = 0, passes = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}

// ------------------------------------------------------------------ fake DOM + boot (copied from pron_aids_checks.js)
let appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
const CUR_HTML = appHtml;
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
// Boots an app. opts: html (app.html text, default this tree's), core (VocabCore, default
// this tree's), pack, words, sentences, passages, units (false: no CHARACTERS), seed
// (Math.random is replaced by a seeded generator for the boot and everything after it,
// until the next boot). spoken: every text passed to speechSynthesis.speak.
const REAL_RANDOM = Math.random;
async function boot(opts){
  const o = opts || {};
  Math.random = o.seed ? mulberry32(o.seed) : REAL_RANDOM;
  appHtml = o.html || CUR_HTML;
  const document = makeFakeDom();
  const spoken = [];
  // neverSpeaking: a boolean-reporting engine that never confirms speaking (ttsDriver's
  // watchdog retry path, docs/AUDIO.md "Playback reliability"; the default mock below has
  // no speaking/pending at all, which ttsDriver treats as "no watchdog", so it can never
  // exercise this). Default: unchanged, for every other check in this file.
  const ss = o.neverSpeaking ? {
    speaking: false, pending: false,
    getVoices: () => o.voices || [{ lang:"zh-CN", name:"x" }], onvoiceschanged: null,
    cancel(){ ss.speaking = false; ss.pending = false; },
    speak(u){ spoken.push(u.text); },
  } : { getVoices: () => o.voices || [{ lang:"zh-CN", name:"x" }], onvoiceschanged: null, cancel(){}, speak(u){ spoken.push(u.text); } };
  const window = { VocabCore: o.core || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const localStorage = { getItem(){ return null; }, setItem(){} };
  const hook = n => `typeof ${n} === "function" ? ${n} : null`;
  const fnBody = scriptOf(appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  html: id => { const e = document.getElementById(id); return e ? e.innerHTML : null; },
  el: id => document.getElementById(id),
  getProg: () => prog, setProg: p => { prog = p; },
  today: () => { tab = "today"; render(); }, goto: t => { tab = t; testSel = null; RD = null; soundsSel = null; render(); },
  getD: () => D, getCur: () => __cur, panelListeners: t => document.getElementById("panel")._listeners[t || "click"] || [],
  startPassage: p => { tab = "read"; startPassage(p); }, rd: () => RD,
  sentenceRowHTML, sentenceRevealBlock, readSentence, gapSentence, passageSentenceHTML, passagePlainHTML, glossHTML, revealBlock, recallItem, readItem, wordRowHTML, charTeach, charDrillItem,
  pronTypeItem: ${hook("pronTypeItem")}, writtenTypeItem: ${hook("writtenTypeItem")},
  glossOut: ${hook("glossOut")}, hearItem, typedFromSlotItem: ${hook("typedFromSlotItem")},
  itemFromPlan: ${hook("itemFromPlan")}, tokTap: ${hook("tokTap")}, onTok: ${hook("onTok")}, tokOwns: ${hook("tokOwns")}, docListeners: t => document._listeners[t] || [], soundsRefGroups: ${hook("soundsRefGroups")},
  drill1: it => drill([it], () => {}, null),
  wordsPage: (lv, set) => { tab = "words"; wordsQuery = ""; wordsLv = lv; wordsSet = set; render(); },
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","PACK","WORDS","SENTENCES","LESSONS","PASSAGES"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"PronAidsChecks/1.0" }, undefined, localStorage, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, o.pack || PACK, o.words || WORDS, o.sentences || SENTENCES, LESSONS, o.passages || PASSAGES];
  if(o.units !== false){ names.push("CHARACTERS"); args.push(o.units || CHARACTERS); }
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return { api, document, spoken };
}


// ------------------------------------------------------------------ helpers
const stripTags = h => String(h).replace(/<rt[^>]*>[\s\S]*?<\/rt>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
const MARKED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
const HAN = /\p{Script=Han}/u;
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
const seedPF = () => VC.normalizeProg({ sets: { "1": NS("1"), "2": 2 }, placedOnce: true, sessions: 5 }, PACK);
const unitOf = w => CHARACTERS.find(u => (u.words || [])[0] === w.id);
const atTierProg = ws => { const pm = seedPF(); ws.forEach(w => { VC.ensureChars(pm).c[unitOf(w).id] = { r: 5, w: 0, s: 5 }; }); return pm; };
const typePlan = (w, n) => Array.from({ length: n }, () => ({ kind: "type", word: w }));
// Plays the active flow: answers every item right (mc: the answer option; type: the
// word's pron), presses Continue / Drill / Next; records every screen, option and reveal.
function walk(api, stopAt){
  const seen = [];
  for(let i = 0; i < 600; i++){
    const P = api.html("panel");
    if(api.getD()){
      const it = api.getCur();
      if(it.kind === "type"){
        seen.push({ where: it.key, kind: "type", it, html: P });
        const w = BY_ID[it.key.slice(2)];
        // A typed cloze (s:, typing object packs) is answered wrong: the walk only compares screens.
        api.el("tin").value = !w ? "" : it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w; api.el("submit").click();
        seen.push({ where: it.key + " reveal", html: api.html("rv") }); api.el("nx").click(); continue;
      }
      const btns = api.el("o").children;
      seen.push({ where: it.key, kind: "mc", it, html: P + btns.map(b => b.innerHTML).join("|"), opts: btns.map(b => b.innerHTML) });
      const btn = btns.find(b => b.dataset.v === it.a); if(!btn) throw new Error("no answer option " + it.key);
      btn.click(); seen.push({ where: it.key + " reveal", html: api.html("rv") }); api.el("nx").click(); continue;
    }
    if(/id="rskip"/.test(P)){ api.el("rskip").click(); continue; } // Today Read stage: skipped (engine_checks covers it)
    seen.push({ where: "screen", html: P });
    if(stopAt && stopAt.test(P)) return seen;
    if(/id="ok"/.test(P)){ api.el("ok").click(); continue; }
    if(/id="dr"/.test(P)){ const tl = api.el("tl"); if(tl) seen.push({ where: "teach", html: tl.children.map(c => c.innerHTML).join("|") }); api.el("dr").click(); continue; }
    return seen;
  }
  throw new Error("walk did not finish");
}


(async function main(){
  const AMB = VC.typedAmbiguity(WORDS);
  // ---------------------------------------------------------------- [1] config + rotation
  console.log("\n[1] config and kind rotation");
  {
    check("zh ships typedFrom [written, pron] + glossFocus on top of typing pron", JSON.stringify(PACK.typedFrom) === '["written","pron"]' && PACK.glossFocus === true && PACK.typing === "pron");
    check("typedFromOn: off without the field, off without typing, invalid sides ignored",
      !VC.typedFromOn(PACK_BASE) && !VC.typedFromOn(Object.assign({}, PACK, { typing: null })) && !VC.typedFromOn({ typing: "pron", typedFrom: "written" })
      && JSON.stringify(VC.typedFromSides({ typing: "pron", typedFrom: ["pron", "x", "written"] })) === '["written","pron"]' && VC.typedFromOn(PACK));
    check("glossFocusOn: only true turns it on", VC.glossFocusOn(PACK) && !VC.glossFocusOn(PACK_BASE) && !VC.glossFocusOn({ glossFocus: "yes" }));
    check("typedKinds zh: 9-slot cycle writtenMeaning, written, pron, writtenMeaning, written, pronMeaning, writtenMeaning, written, writtenPron (characters <-> meaning 6:3 against the pinyin kinds)",
      VC.typedKinds(PACK).join() === "writtenMeaning,written,pron,writtenMeaning,written,pronMeaning,writtenMeaning,written,writtenPron");
    check("typedKinds 2x share: writtenMeaning and written three times per cycle, pron, pronMeaning, writtenPron once", (() => {
      const n = {}; VC.typedKinds(PACK).forEach(k => { n[k] = (n[k] || 0) + 1; });
      return n.writtenMeaning === 3 && n.written === 3 && n.pron === 1 && n.pronMeaning === 1 && n.writtenPron === 1; })());
    check("rotation over 90 consecutive typed slots (words taking every kind): 30/30 writtenMeaning/written, 10 each pron/pronMeaning/writtenPron", (() => {
      const wd = { id: "x1", w: "学", pron: "xué", en: "to study" }, pl = Array.from({ length: 90 }, () => ({ kind: "type", word: wd }));
      const n = {}; pl.forEach((_, i) => { const k = VC.typedSlotKind(pl, i, VC.normalizeProg({}, PACK), PACK, k2 => VC.typedKindOk(k2, wd, true, AMB)); n[k] = (n[k] || 0) + 1; });
      return n.writtenMeaning === 30 && n.written === 30 && n.pron === 10 && n.pronMeaning === 10 && n.writtenPron === 10; })());
    check("typedKinds: pron side only -> pron, written, pronMeaning; written side only -> writtenMeaning, written, pron, writtenMeaning, written, writtenMeaning, written, writtenPron",
      VC.typedKinds({ typing: "pron", typedFrom: ["pron"] }).join() === "pron,written,pronMeaning" && VC.typedKinds({ typing: "pron", typedFrom: ["written"] }).join() === "writtenMeaning,written,pron,writtenMeaning,written,writtenMeaning,written,writtenPron");
    check("typedKinds, a plain typing pack (for later): word, writtenMeaning, pronMeaning",
      VC.typedKinds({ typing: {}, typedFrom: ["written", "pron"] }).join() === "word,writtenMeaning,pronMeaning");
    const w = { id: "x1", w: "学", pron: "xué", en: "to study" };
    const fresh = VC.normalizeProg({}, PACK);
    const plan = [{ kind: "type", word: w }, { kind: "recall", word: w }, { kind: "type", word: w }, { kind: "type", word: w }, { kind: "hear", word: w }, { kind: "type", word: w }, { kind: "type", word: w }, { kind: "type", word: w }];
    const tIdx = plan.map((p, i) => p.kind === "type" ? i : -1).filter(i => i >= 0);
    const seq = tIdx.map(i => VC.typedSlotKind(plan, i, fresh, PACK));
    check(`rotation: type slots walk the kinds in order, other slots do not advance (${seq.join(",")})`, seq.join() === "writtenMeaning,written,pron,writtenMeaning,written,pronMeaning");
    const seen2 = VC.normalizeProg({ w: { x1: { r: 1, w: 1, s: 0 } } }, PACK);
    check("rotation: the word's recorded answers (r+w) shift the start", VC.typedSlotKind(plan, 0, seen2, PACK) === "pron" && VC.typedSlotKind(plan, 2, seen2, PACK) === "writtenMeaning");
    check("rotation is deterministic (same plan + progress -> same kinds, no Math.random)", (() => {
      const r = Math.random; let drawn = 0; Math.random = () => { drawn++; return r(); };
      const a = tIdx.map(i => VC.typedSlotKind(plan, i, seen2, PACK)).join(), b = tIdx.map(i => VC.typedSlotKind(plan, i, seen2, PACK)).join();
      Math.random = r; return a === b && drawn === 0; })());
    const below = k => VC.typedKindOk(k, w, false, AMB);
    const bseq = tIdx.map(i => VC.typedSlotKind(plan, i, fresh, PACK, below));
    check(`fallback, characters not displayed: only kinds without characters, next in rotation (${bseq.join(",")})`, bseq.join() === "pron,pron,pron,pronMeaning,pronMeaning,pronMeaning");
    check("typedKindOk, characters displayed: every kind fits", VC.typedKinds(PACK).every(k => VC.typedKindOk(k, w, true, AMB)));
    check("typedKindOk: no pron -> no pron/writtenPron/pronMeaning; no gloss -> no meaning kinds; nothing fits -> null",
      !VC.typedKindOk("pron", { id: "n", w: "学", en: "x" }, true) && !VC.typedKindOk("writtenPron", { id: "n", w: "学", en: "x" }, true) && !VC.typedKindOk("pronMeaning", { id: "n", w: "学", en: "x" }, true)
      && !VC.typedKindOk("writtenMeaning", { id: "n", w: "学", pron: "xué", en: "" }, true) && VC.typedSlotKind([{ kind: "type", word: w }], 0, fresh, PACK, () => false) === null);
    const ta = BY_ID[WORDS.find(x => x.w === "他").id], she = WORDS.find(x => x.w === "她");
    check(`homophones (他/她 tā): no pinyin->meaning; ${AMB.pron.size} zh words share a reading, ${AMB.written.size} a written form`,
      AMB.pron.has(ta.id) && AMB.pron.has(she.id) && !VC.typedKindOk("pronMeaning", ta, true, AMB) && VC.typedKindOk("writtenMeaning", ta, true, AMB) && AMB.pron.size === 73 && AMB.written.size === 0);
    const hg = VC.typedAmbiguity([{ id: "a", w: "长", pron: "cháng", en: "long" }, { id: "b", w: "长", pron: "zhǎng", en: "to grow" }]);
    check("homographs (长 cháng/zhǎng): no characters-stimulus kind", hg.written.has("a") && !VC.typedKindOk("writtenMeaning", { id: "a", w: "长", pron: "cháng", en: "long" }, true, hg) && !VC.typedKindOk("writtenPron", { id: "a", w: "长", pron: "cháng", en: "long" }, true, hg) && VC.typedKindOk("pronMeaning", { id: "a", w: "长", pron: "cháng", en: "long" }, true, hg));
    // Plans do not depend on the new fields.
    const pr = seedPF(); const lw = VC.learnedWords(WORDS, PACK, pr);
    // Math.random seeded too: buildRecallPlan's weakFirst draws from it.
    const mk = (pk, seed) => { const rng = mulberry32(seed); Math.random = mulberry32(seed + 100); return JSON.stringify([VC.buildReviewPlan(lw, pr, pk, { rng }), VC.buildRecallPlan(lw, pr, pk, 8, { rng })].map(p => p.map(x => [x.kind, x.word && x.word.id]))); };
    check("Review/Recall plans identical with and without typedFrom/glossFocus (3 seeds)", [1, 2, 3].every(s => mk(PACK, s) === mk(PACK_BASE, s)));
    Math.random = REAL_RANDOM;
  }

  // ---------------------------------------------------------------- [2] matcher + formatter
  console.log("\n[2] typed-meaning matcher and gloss formatter");
  {
    const G1 = "to kick; to play (e.g. soccer)", G2 = "(of a contagious disease etc) to spread; to propagate", G3 = "no matter what or how; regardless of whether...";
    const T = [
      ["kick", G1, true], ["to kick", G1, true], ["Kick!", G1, true], ["play", G1, true], ["to play soccer", G1, true], ["to play (e.g. soccer)", G1, true], ["play e.g. soccer", G1, true],
      ["to kick; to play", G1, true], ["kick, play", G1, true], ["soccer", G1, false], ["kick ball", G1, false], ["kick; run", G1, false],
      ["spread", G2, true], ["to propagate", G2, true], ["  PROPAGATE ", G2, true], ["of a contagious disease etc to spread", G2, true], ["contagious disease", G2, false],
      ["regardless of whether", G3, true], ["regardless of whether...", G3, true], ["regardless of whether …", G3, true], ["no matter what or how", G3, true], ["no matter", G3, false], ["regardless", G3, false],
      ["introduce", "to introduce (sb to sb); to give a presentation", true], ["introduce someone to someone", "to introduce (sb to sb); to give a presentation", true],
      ["introduce sb", "to introduce (sb to sb); to give a presentation", true],
      ["wish bon voyage, happy birthday", "to pray for; to wish (sb bon voyage, happy birthday etc)", true],
      ["happy birthday", "to pray for; to wish (sb bon voyage, happy birthday etc)", false],
      ["be at", "to exist; to be alive; (of sb or sth) to be (located) at", true], ["to be located at", "to exist; to be alive; (of sb or sth) to be (located) at", true],
      ["do of one's own accord", "to take the initiative; to do sth of one's own accord", true], ["do something of ones own accord", "to take the initiative; to do sth of one's own accord", true],
      ["teacher", "the teacher", true], ["an apple", "apple", true], ["apples", "apple", false],
      ["oclock", "o'clock; a little", true], ["o’clock", "o'clock; a little", true], ["a little", "o'clock; a little", true],
      ["on", "on, in (N上)", true], ["in", "on, in (N上)", true], ["cafe", "café", true], ["mister", "teacher; gentleman; sir; mister (Mr.)", true], ["mister mr", "teacher; gentleman; sir; mister (Mr.)", true],
      ["to", "to", true], ["the", "the", true], ["completed action marker", "(completed action marker)", true], ["", G1, false], ["   ", G1, false], ["to", G1, false],
      ["him", "he; him…", true], ["rental car", "taxi; (Tw) rental car", true],
    ];
    const bad = T.filter(([v, g, want]) => VC.checkGlossTyped(v, g) !== want);
    check(`checkGlossTyped table (${T.length} cases${bad.length ? `; wrong: ${JSON.stringify(bad.slice(0, 4))}` : ""})`, T.length >= 25 && bad.length === 0);
    const P = [
      [G2, "to spread; to propagate", ["(of a contagious disease etc)"]],
      [G1, "to kick; to play", ["(e.g. soccer)"]],
      [G3, G3, []],
      ["(completed action marker)", "(completed action marker)", []],
      ["of; ~'s (possessive particle); (used after an attribute)", "of; ~'s", ["(possessive particle)", "(used after an attribute)"]],
      ["to wish (sb bon voyage, happy birthday etc)", "to wish", ["(sb bon voyage, happy birthday etc)"]],
      ["to eat at (a cafeteria (or canteen))", "to eat at", ["(a cafeteria (or canteen))"]],
      ["on, in (N上)", "on, in", ["(N上)"]],
      ["big; (broken", "big; (broken", []],
      ["  to  kick ;  to play  ", "to kick ; to play", []],
    ];
    const pb = P.filter(([g, p, q]) => { const r = VC.glossParts(g); return r.primary !== p || JSON.stringify(r.qualifiers) !== JSON.stringify(q); });
    check(`glossParts table (${P.length} cases${pb.length ? `; wrong: ${JSON.stringify(pb.map(x => [x[0], VC.glossParts(x[0])]))}` : ""})`, pb.length === 0);
    check("every zh gloss accepts itself typed in full (reading notes and fragments included)", WORDS.every(w => VC.checkGlossTyped(VC.gloss(w), VC.gloss(w))));
    const noSelf = WORDS.filter(w => { const g = VC.gloss(w); return !VC.checkGlossTyped(VC.glossParts(g).primary, g); }).map(w => w.w);
    check(`every zh gloss accepts its own primary, except a primary that differs from the gloss and holds a dropped alternative (的 "~'s"; 相信 "to…" fixed by tools/zh_gloss_overrides.json): ${noSelf.join(" ")}`, noSelf.join(" ") === "的");
    // Fix round (docs/PACK_SCHEMA.md "Typed meaning" rules 1-5).
    const G = Object.fromEntries(WORDS.map(w => [w.w, VC.gloss(w)]));
    const NOTE_WORDS = ["知道", "母亲", "父亲", "谁", "那", "血"];
    const noteBad = NOTE_WORDS.filter(x => { const p = VC.glossParts(G[x]); const shown = p.pieces.map(y => y.t).join(""); return !p.notes.length || /\[|\]|pr\./.test(shown) || /\[|pr\./.test(p.primary); });
    check(`rule 1: reading notes of ${NOTE_WORDS.join(" ")} go to notes, never into the display pieces or primary (bad: ${noteBad.join(" ") || "none"})`, noteBad.length === 0);
    const auditBad = WORDS.filter(w => { const p = VC.glossParts(VC.gloss(w)); return /\[|\bpr\./.test(p.pieces.map(y => y.t).join("")); }).map(w => w.w);
    check(`rule 1 audit: none of the ${WORDS.length} zh glosses shows "[" or "pr." in its display pieces (${auditBad.join(" ") || "clean"})`, WORDS.length === 1193 && auditBad.length === 0);
    const R = [
      ["also pr shui", G["谁"], false], ["also pr. [shuí]", G["谁"], false], ["shui", G["谁"], false], ["who", G["谁"], true],
      ["colloquial pr nei", G["那"], false], ["those", G["那"], true], ["colloquial pr xie", G["血"], false], ["blood", G["血"], true], ["also pr zhi dao", G["知道"], false],
      ["to", G["相信"], false], ["to…", G["相信"], false], ["believe", G["相信"], true], ["be", G["只好"], false], ["to be", G["只好"], false], ["to have to", G["只好"], true],
      ["with", G["和"], true], ["him", G["他"], true],
      ["s", G["的"], false], ["'s", G["的"], false], ["of", G["的"], true], ["i", G["我"], true], ["I", G["我"], true], ["be", G["是"], true], ["the", "the", true], ["one", "one", true],
      ["no matter what", G["无论"], true], ["how", G["无论"], false], ["we", "we or us…", true], ["us", "we or us…", false], ["in confusion", G["乱"], true], ["disorder", G["乱"], false],
      ["hot", G["汤"], false], ["give", G["打针"], false], ["go on official", G["出差"], false], ["hang", G["挂"], true], ["deep", G["厚"], true], ["actor", G["演员"], true],
    ];
    const rb = R.filter(([v, g, want]) => VC.checkGlossTyped(v, g) !== want);
    check(`rules 1-4 matcher table (rule 4 only with a one-word right side) (${R.length} cases${rb.length ? `; wrong: ${JSON.stringify(rb.slice(0, 4))}` : ""})`, rb.length === 0);
    // Browser-run edge case: a gloss that is only a (...) group (吗, 了, 分之, 呀) keeps it as its
    // primary and display, and the text inside the brackets is a right answer; an alternative
    // that is only a group (很, 来, 吧, 之) is accepted without its brackets too.
    const groupOnly = a => { const p = VC.parenPieces(a.trim()); return p.length > 0 && p.every(x => x.g || !x.t.trim()); };
    const gAll = WORDS.filter(w => VC.splitTopLevel(VC.gloss(w), [";", ","]).every(groupOnly));
    const gSome = WORDS.filter(w => { const a = VC.splitTopLevel(VC.gloss(w), [";", ","]); return a.some(groupOnly) && !a.every(groupOnly); });
    const gBad = [...gAll, ...gSome].filter(w => { const g = VC.gloss(w), p = VC.glossParts(g);
      const inner = VC.splitTopLevel(g, [";", ","]).filter(groupOnly).map(a => a.trim().slice(1, -1));
      return !p.primary.trim() || !p.pieces.map(x => x.t).join("").trim() || (gAll.includes(w) && (p.primary !== g || p.pieces.length !== 1 || p.pieces[0].dim)) || !inner.every(t => VC.checkGlossTyped(t, g)); }).map(w => w.w);
    check(`group-only glosses (${gAll.map(w => w.w).join(" ")}) keep the gloss as primary, undimmed; group-only alternatives (${gSome.map(w => w.w).join(" ")}) never empty the primary; bracket text accepted (bad: ${gBad.join(" ") || "none"})`,
      gAll.length >= 4 && gAll.some(w => w.w === "吗") && gBad.length === 0);
    const disp = g => VC.glossParts(g).pieces.map(y => y.dim ? `<${y.t}>` : y.t).join("");
    const D5 = [
      ["might; possible (happen)", "might; possible <(happen)>"],
      ["just at; right in (that time) (that place)", "just at; right in <(that time)> <(that place)>"],
      ["(of a contagious disease etc) to spread; to propagate", "to spread <(of a contagious disease etc)>; to propagate"],
      ["to exist; to be alive; (of sb or sth) to be (located) at", "to exist; to be alive; to be <(located)> at <(of sb or sth)>"],
      ["(joining two nouns) and; together with; with…", "and <(joining two nouns)>; together with; with…"],
      ["of; ~'s (possessive particle); (used after an attribute)", "of; ~'s <(possessive particle)>; <(used after an attribute)>"],
      ["(specifier) that; the; those (colloquial pr. [nèi])", "that <(specifier)>; the; those"],
      ["(completed action marker)", "(completed action marker)"],
    ];
    const db = D5.filter(([g, want]) => disp(g) !== want);
    check(`rule 5 display: a leading group moves to the end of its own alternative, others stay in place, dimmed${db.length ? `; wrong: ${JSON.stringify(db.map(([g]) => disp(g)))}` : ""}`, db.length === 0);
    const cross = WORDS.filter(w => { const g = VC.gloss(w); const p = VC.glossParts(g); const d = p.pieces.map(y => y.t).join("");
      const altsIn = VC.splitTopLevel(g, [";", ","]).filter(a => !VC.isPronNote(a)).length, altsOut = VC.splitTopLevel(d, [";", ","]).length;
      return p.qualifiers.length && altsIn !== altsOut; }).map(w => w.w);
    check(`rule 5 sweep: no zh gloss changes its number of alternatives in display (${cross.join(" ") || "none"})`, cross.length === 0);
  }

  // ---------------------------------------------------------------- [3] app items (zh)
  console.log("\n[3] app: typed items from the target side (zh)");
  try {
    const { api, spoken } = await boot({ seed: 5 });
    // A level-1 word with a unique reading and a (...) qualifier in its gloss.
    const w = WORDS.find(x => x.lv === "1" && !AMB.pron.has(x.id) && /\(/.test(x.en) && VC.glossParts(x.en).qualifiers.length && unitOf(x));
    const below = seedPF();
    api.setProg(below);
    check(`test word ${w.w} ${w.pron} "${w.en}" is shown by its reading below tier`, VC.displayForm(w, CHARACTERS, below, PACK).isPron);
    const bItems = typePlan(w, 5).map(api.itemFromPlan);
    check(`below tier: only kinds without characters (${bItems.map(x => x.label).join("|")}); the meaning stimulus is the reading, no Han`,
      bItems.every(x => x.label === "Type the pinyin" || x.label === "Type the meaning") && bItems.some(x => x.label === "Type the meaning")
      && bItems.filter(x => x.label === "Type the meaning").every(x => !HAN.test(stripTags(x.html)) && x.html.includes(VC.toneHTML(w.pron))));
    const at = atTierProg([w]); api.setProg(at);
    const items = typePlan(w, 9).map(api.itemFromPlan);
    const tagOf = x => (x.html.match(/class="ktag"[^>]*><b>([^<]*)<\/b>/) || [])[1];
    const byStim = x => HAN.test(stripTags(x.html)) ? "chars" : x.html.includes(VC.toneHTML(w.pron)) ? "pinyin" : "gloss";
    const sig = items.map(x => `${x.label}/${byStim(x)}`);
    check(`at tier: the nine slots in rotation order (${sig.join(", ")})`,
      sig.join() === "Type the meaning/chars,Type the characters/gloss,Type the pinyin/gloss,Type the meaning/chars,Type the characters/gloss,Type the meaning/pinyin,Type the meaning/chars,Type the characters/gloss,Type the pinyin/chars");
    const [wMean, wChars, , , , pMean, , , wPron] = items;
    const NEW = [["characters -> meaning", wMean], ["pinyin -> meaning", pMean], ["characters -> pinyin", wPron], ["meaning -> characters", wChars]];
    for(const [name, it] of NEW){
      const h = it.html;
      const leaks = [];
      if(it.mount) leaks.push("mount");
      if(/id="(?:rp2|rpa|sp)"|class="(?:replay|speaker)/.test(h)) leaks.push("audio button");
      if(/data-(?:wid|tok|showw|sent|xw)=|class="(?:tk|pw)\b/.test(h)) leaks.push("tap target");
      if(/<ruby|<rt/.test(h)) leaks.push("ruby");
      if(byStim(it) === "chars" && (MARKED.test(stripTags(h)) || /class="t[1-5]"/.test(h) || /class="pron"/.test(h))) leaks.push("reading on characters");
      if(byStim(it) === "pinyin" && HAN.test(stripTags(h))) leaks.push("characters under pinyin");
      const answerBits = it === wChars ? [w.w, VC.stripMarks(w.pron)] : it.label === "Type the meaning" ? VC.glossParts(w.en).primary.split(/[;,]/).map(s => s.trim().replace(/^to /, "")).filter(s => s.length > 2) : [VC.stripMarks(w.pron)];
      const meta = [it.label, it.placeholder || "", tagOf(it) || "", stripTags(h.replace(/<div class="big wd"[\s\S]*$/, ""))].join(" ").toLowerCase();
      answerBits.forEach(b => { if(meta.includes(b.toLowerCase())) leaks.push("answer in label/tag/placeholder: " + b); });
      if(it.label === "Type the meaning" && stripTags(h).includes(VC.glossParts(w.en).primary)) leaks.push("gloss on card");
      check(`${name}: no audio, no taps, no ruby, no reading/characters leak, answer not in label/tag/placeholder (${leaks.join("; ") || "clean"})`, leaks.length === 0);
    }
    check("tags and placeholders: meaning items 'meaning · any one' + 'meaning…' + Latin input; characters->pinyin 'pinyin · tones optional'",
      [wMean, pMean].every(x => /class="ktag"[^>]*><b>meaning<\/b> · any one</.test(x.html) && x.placeholder === "meaning…" && x.inputTA === ' lang="en"')
      && /class="ktag"[^>]*><b>pinyin<\/b> · tones optional</.test(wPron.html) && wPron.placeholder === "pinyin, tones optional…" && wPron.inputTA === ' lang="en"');
    // Renderer: nothing spoken before the answer; reveal plays the word and has Replay.
    const primary1 = VC.glossParts(w.en).primary.split(";")[0].trim();
    const run = (slot, value, prog) => {
      api.setProg(prog || atTierProg([w]));
      const plan = typePlan(w, 9); const k0 = spoken.length;
      api.drill1(api.itemFromPlan(plan[slot], slot, plan));
      const html = api.html("panel"); const before = spoken.length - k0;
      api.el("tin").value = value; api.el("submit").click();
      return { html, before, after: spoken.length - k0 - before, rv: api.html("rv"), wrong: api.getD().miss.length > 0, prog: api.getProg() };
    };
    const r1 = run(0, primary1);
    check(`renderer, characters -> meaning: silent before the answer, "${primary1}" right, reveal speaks + Replay`, r1.before === 0 && !r1.wrong && r1.after > 0 && /id="rvp"/.test(r1.rv) && /id="tin"[^>]*lang="en"/.test(r1.html) && /placeholder="meaning…"/.test(r1.html));
    const r2 = run(5, primary1.toUpperCase() + "!");
    check("renderer, pinyin -> meaning: silent before the answer, case/punctuation-insensitive right", r2.before === 0 && !r2.wrong && r2.after > 0);
    const r3 = run(8, VC.stripMarks(w.pron));
    check("renderer, characters -> pinyin: silent before the answer, toneless right with the tones note", r3.before === 0 && !r3.wrong && /tones: /.test(r3.rv));
    const r5 = run(1, w.w);
    check(`meaning -> characters (typedFrom): kind tag "characters" without "listen", no Replay before the answer, nothing spoken on mount; right; the reveal speaks + Replay (tag ${JSON.stringify(stripTags((wChars.html.match(/<div class="ktag"[\s\S]*?<\/div>/) || [""])[0]))})`,
      tagOf(wChars) === "characters" && !/listen/.test(wChars.html) && !/id="rp2"/.test(r5.html) && !wChars.mount && r5.before === 0 && !r5.wrong && r5.after > 0 && /id="rvp"/.test(r5.rv));
    {
      const pr = atTierProg([w]); api.setProg(pr);
      const ctl = api.writtenTypeItem(w);
      check("control: without typedFrom the characters item (writtenTypeItem) keeps its listen tag, Replay and mount", /<b>characters<\/b> · listen/.test(ctl.html) && /id="rp2"/.test(ctl.html) && typeof ctl.mount === "function");
    }
    const r4 = run(0, "zzz not it");
    const rec = r4.prog.w[w.id];
    check(`renderer, a wrong meaning: 'you typed' shown, the miss is k="type" and the record keeps its shape (${JSON.stringify(rec)})`,
      r4.wrong && /you typed: zzz not it/.test(r4.rv) && rec.k === "type" && Object.keys(rec).every(k => ["r", "w", "s", "k", "prov", "t", "u", "f", "p"].includes(k))); // p: pair streaks (pairs, engine default since the flag collapse)
    // Second miss: the silent choice counterpart with the same stimulus.
    api.setProg(atTierProg([w]));
    const plan = typePlan(w, 7); const mi = api.itemFromPlan(plan[0], 0, plan);
    const fb = mi.choiceFallback();
    check("meaning item's choice fallback: 'What does it mean?', same characters stimulus, no mount, answer among glosses",
      fb.kind === "mc" && fb.label === "What does it mean?" && !fb.mount && HAN.test(stripTags(fb.html)) && !/data-wid|class="replay/.test(fb.html) && fb.opts.includes(VC.gloss(w)) && fb.a === VC.gloss(w));
    const k1 = spoken.length; api.drill1(fb); const fbBefore = spoken.length - k1;
    check("choice fallback renders silent", fbBefore === 0);
    // Fix round rule 6: characters -> pinyin comes back as a silent pinyin choice.
    {
      const pr = atTierProg([w]); api.setProg(pr);
      const pl = typePlan(w, 9); const it = api.itemFromPlan(pl[8], 8, pl);
      const fb = it.choiceFallback(), fb2 = it.choiceFallback();
      const learned = new Set(VC.learnedWords(WORDS, PACK, pr).map(x => x.pron));
      const syl = x => VC.splitReading(x).filter(y => y.tone !== undefined).length;
      const keys = new Set(fb.opts.map(VC.pronKey));
      check(`rule 6: characters -> pinyin choice fallback "${fb.label}": characters stimulus, no reading on it, 4 distinct readings incl. the answer (${fb.opts.join(", ")})`,
        fb.kind === "mc" && fb.label === "How is it said?" && !fb.mount && HAN.test(stripTags(fb.html)) && !MARKED.test(stripTags(fb.html)) && !/data-wid|class="replay|<ruby/.test(fb.html)
        && fb.opts.length === 4 && keys.size === 4 && fb.a === w.pron && fb.opts[0] === w.pron && fb.opts.every(o => !HAN.test(o)));
      // pack.optsMix (docs/PACK_SCHEMA.md "optsMix"): the answer's stage first (it is learned), drawn per set.
      if(VC.optsMixOn(PACK)) check(`rule 6 (optsMix): distractors are learned words' readings with the answer's syllable count (${syl(w.pron)}) on two builds (${fb.opts.slice(1).join(", ")} | ${fb2.opts.slice(1).join(", ")})`,
        [fb, fb2].every(f => f.opts.slice(1).every(o => learned.has(o) && syl(o) === syl(w.pron))));
      else check(`rule 6: distractors are learned words' readings with the answer's syllable count (${syl(w.pron)}), chosen without rng (same on a second build)`,
        fb.opts.slice(1).every(o => learned.has(o) && syl(o) === syl(w.pron)) && JSON.stringify(fb.opts) === JSON.stringify(fb2.opts));
      const k0 = spoken.length; api.drill1(fb); const before = spoken.length - k0;
      const btn = api.el("o").children.find(b => b.dataset.v === w.pron); btn.click();
      check("rule 6: renders silent before the answer; the reveal speaks; a pass records as the other fallbacks do", before === 0 && spoken.length - k0 > 0 && api.getD().miss.length === 0);
    }
    // Fix round rule 1: reading notes never reach a stimulus, an option or a Words row.
    {
      const bad = [];
      ["知道", "母亲", "父亲", "谁", "那", "血"].forEach(x => {
        const e = WORDS.find(y => y.w === x); const note = (VC.gloss(e).match(/\[([^\]]*)\]/) || [])[1];
        api.setProg(atTierProg([e]));
        const pl = typePlan(e, 7); const typed = pl.map((p, i) => api.itemFromPlan(p, i, pl));
        const read = api.readItem(e);
        const sites = { pronType: api.pronTypeItem(e).html, recall: api.recallItem(e).html, wordsRow: api.wordRowHTML(e, "wl"), readOpts: read.opts.map(o => read.optHtml(o)).join("|"),
          typed: typed.map(t => t.html).join("|") };
        Object.entries(sites).forEach(([k, h]) => { const t = stripTags(h); if(/\[|\]|\bpr\./.test(t) || (note && t.includes(note))) bad.push(`${x}:${k}`); });
        if(!stripTags(api.revealBlock(e)).includes("[" + note + "]")) bad.push(`${x}:reveal lacks the note`);
      });
      check(`rule 1: no stimulus/option/Words row of 知道 母亲 父亲 谁 那 血 has "[", "pr." or the note's reading; the reveal keeps the note (${bad.join(" ") || "clean"})`, bad.length === 0);
      const leak = WORDS.filter(e => /\[|\bpr\./.test(stripTags(api.glossOut(VC.gloss(e))))).map(e => e.w);
      check(`rule 1 audit: glossOut (every stimulus/option/row) of all ${WORDS.length} zh glosses has no "[" or "pr." (${leak.join(" ") || "clean"})`, leak.length === 0);
    }
    // Words without a pron or with a shared reading.
    const ta = WORDS.find(x => x.w === "他");
    api.setProg(atTierProg([ta]));
    const taKinds = typePlan(ta, 7).map(api.itemFromPlan).map(x => `${x.label}/${byStim(x)}`);
    check(`homophone 他 tā: never pinyin -> meaning (${taKinds.join(", ")})`, !taKinds.some(s => s === "Type the meaning/pinyin" || (s.startsWith("Type the meaning") && !s.endsWith("chars"))));
    // The walk: Today with typedFrom on still plays through, typed items only on word keys.
    api.setProg(seedPF()); api.today(); api.el("go").click();
    let seen = [], err = null; try{ seen = walk(api, /id="again"/); }catch(e){ err = e; }
    const typed = seen.filter(x => x.kind === "type");
    check(`Today walk plays through (${typed.length} typed items: ${[...new Set(typed.map(x => x.it.label))].join(", ")})${err ? " ERROR " + err.message : ""}`, !err && typed.length > 0 && typed.some(x => x.it.label === "Type the meaning"));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [4] glossFocus sites
  console.log("\n[4] glossFocus: every word-gloss render site");
  try {
    const { api } = await boot({ seed: 9 });
    const w = WORDS.find(x => x.lv === "1" && /^\(/.test(x.en) && VC.glossParts(x.en).qualifiers.length && unitOf(x));
    const g = VC.gloss(w), gp = VC.glossParts(g);
    const want = gp.pieces.map(x => x.dim ? `<span class="dim">${VC.escapeHtml(x.t)}</span>` : VC.escapeHtml(x.t)).join("");
    check(`glossOut("${g}") -> the leading qualifier dimmed at the end of its alternative (${want})`, api.glossOut(g) === want && (g !== "(joining two nouns) and; together with; with…" || want === 'and <span class="dim">(joining two nouns)</span>; together with; with…'));
    check("glossOut with notes (reveal, popover) appends the reading note dimmed; without, it is gone",
      api.glossOut("who; also pr. [shuí]") === "who" && api.glossOut("who; also pr. [shuí]", true) === 'who <span class="dim">also pr. [shuí]</span>');
    check("glossOut: a gloss with no qualifier is plain escaped text", api.glossOut("to study") === "to study" && api.glossOut("(completed action marker)") === "(completed action marker)");
    api.setProg(atTierProg([w]));
    const raw = VC.escapeHtml(g);
    const sites = {
      reveal: api.revealBlock(w), wordsRow: api.wordRowHTML(w, "wl"), popover: api.glossHTML(w.id, "", null),
      recall: api.recallItem(w).html, readOpts: (it => it.opts.map(o => it.optHtml(o)).join("|"))(api.readItem(w)),
      hearOpts: (it => it.opts.map(o => it.optHtml ? it.optHtml(o) : o).join("|"))(api.hearItem(w)),
      charRead: (it => it.opts.map(o => it.optHtml(o)).join("|") + it.reveal)(api.charDrillItem("charRead", unitOf(w))),
      charRecall: api.charDrillItem("charRecall", unitOf(w)).html,
    };
    // Option buttons (readOpts, hearOpts) show the first alternatives only (app.html glossShort), each focused the same way.
    const wantOpt = api.readItem(w).optHtml(g), OPT = new Set(["readOpts", "hearOpts"]);
    check(`option buttons: a focused prefix of the gloss (${wantOpt})`, !!wantOpt && want.startsWith(wantOpt));
    const badSites = Object.entries(sites).filter(([k, h]) => !h.includes(OPT.has(k) ? wantOpt : want) || h.includes(raw));
    check(`focused gloss at every site (${Object.keys(sites).join(", ")}; bad: ${badSites.map(x => x[0]).join(", ") || "none"})`, badSites.length === 0);
    api.wordsPage(w.lv, 0);
    const wl = api.el("wl").children.map(c => c.innerHTML).join("|");
    check("Words tab rows carry the dimmed qualifiers, never a raw (...)-first gloss", /class="dim"/.test(wl) && !WORDS.filter(x => /^\(/.test(x.en) && VC.glossParts(x.en).qualifiers.length).some(x => wl.includes(`>${VC.escapeHtml(VC.gloss(x))}<`)));
    // Sweep: tabs, a Today walk and a Test recall drill; no raw gloss whose qualifiers move.
    const moved = WORDS.map(x => VC.gloss(x)).filter(x => VC.glossParts(x).primary !== x && VC.glossParts(x).qualifiers.length).map(x => ">" + VC.escapeHtml(x) + "<");
    const sweep = [];
    const pr = seedPF(); WORDS.filter(x => x.lv === "1").slice(0, 30).forEach((x, i) => { pr.w[x.id] = { r: 1, w: 2 + (i % 3), s: 0 }; });
    for(const t of ["words", "read", "sounds", "test", "progress"]){ api.setProg(pr); api.goto(t); sweep.push([t, api.html("panel")]); }
    api.setProg(pr); api.goto("test"); const tr = api.el("tRecall");
    if(tr){ tr.onclick(); try{ walk(api, /id="ok"|class="done"/).forEach(x => sweep.push(["test recall " + x.where, x.html])); }catch(e){ sweep.push(["test recall ERR", e.message]); } }
    api.setProg(pr); api.today(); api.el("go").click();
    try{ walk(api, /id="again"/).forEach(x => sweep.push(["today " + x.where, x.html])); }catch(e){ sweep.push(["today ERR", e.message]); }
    const hits = sweep.filter(([, h]) => moved.some(m => h.includes(m)));
    check(`sweep of ${sweep.length} screens (tabs, Test recall, Today): no raw gloss with qualifiers left${hits.length ? ` (${hits.slice(0, 3).map(x => x[0]).join(", ")})` : ""}; dim spans seen`,
      sweep.length > 20 && hits.length === 0 && sweep.some(([, h]) => /class="dim"/.test(h)) && !sweep.some(([k]) => /ERR/.test(k)));
    const { api: off } = await boot({ seed: 9, pack: PACK_BASE });
    off.setProg(atTierProg([w]));
    check("glossFocus off: raw gloss everywhere, no dim span", off.glossOut(g) === raw && off.revealBlock(w).includes(raw) && !/class="dim"/.test(off.revealBlock(w) + off.wordRowHTML(w, "wl")) && off.readItem(w).optHtml === undefined);
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // [5] control vs main ef44c6e deleted: it predates pairs and dayAware, engine default since the flag collapse.

  console.log("\n[6] typedFrom with the day-aware planner (engine default): two Today sessions in one day");
  try {
    const { api } = await boot({ seed: 9 });
    // Mid HSK 2 with characters put after the words: with one stage per level (fb2-write) 字1
    // would otherwise come first, behind the choice card.
    api.setProg(VC.normalizeProg(Object.assign(seedPF(), { chars: { choiceSeen: true, defer: true } }), PACK)); api.today(); api.el("go").click();
    const s1 = walk(api, /id="again"/); api.el("again").click(); api.el("go").click();
    const s2 = walk(api, /id="again"/);
    const typed = ss => ss.filter(x => x.kind === "type");
    const done1 = new Set(typed(s1).map(x => x.where + "|" + x.it.label));
    const rep = typed(s2).filter(x => done1.has(x.where + "|" + x.it.label));
    const labels = new Set(typed(s2).map(x => x.it.label));
    check(`session 2 still asks typed items from the target side (${[...labels].join(", ")}; ${typed(s1).length} / ${typed(s2).length} typed), none a word typed right in the same way in session 1 (${rep.length})`,
      typed(s1).length > 0 && typed(s2).length > 0 && rep.length === 0 && [...labels].some(l => l !== "Type the pinyin"));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
