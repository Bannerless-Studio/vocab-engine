// Checks for zh competing meanings and untypeable glosses (docs/PACK_SCHEMA.md "Synonyms",
// docs/ZH_GLOSS.md; owner feedback 2026-10-02: 着急 false negatives, 啊's long meaning).
// [1] build: words.json syn / typedSyn / noTypedMeaning / en equal a fresh tools/zh_gloss.js
// run, docs/ZH_GLOSS.md is current, the fields are well formed; [2] 着急 before / after;
// [3] option sets (meaning choice, word choice in both label modes, cloze, character picks)
// never hold a second right answer for any zh word over many seeds, and without syn they
// do (the check bites); [4] typed items with a meaning stimulus accept every typedSyn word
// (pinyin and characters), a characters stimulus never does, flag off accepts none;
// [5] noTypedMeaning words never get a typed-meaning kind; [6] gloss caps and matcher rules
// (copula, overrides); [7] validate_pack.py on the new fields; [8] review round 2: typed
// groups, notTyped, the first-meaning rule, HSK core senses, option and note shortening. Fake DOM from
// tests/typed_from_checks.js. Run: node tests/gloss_overlap_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZG = require(path.join(ROOT, "tools", "zh_gloss.js"));
const ZH = path.join(ROOT, "packs", "zh");
const PY = process.env.PYTHON3 || "python3";
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const BY_W = Object.fromEntries(WORDS.map(w => [w.w, w]));
const strip = w => { const c = Object.assign({}, w); delete c.syn; delete c.typedSyn; delete c.noTypedMeaning; return c; };
const WORDS_OFF = WORDS.map(strip);
const OV = JSON.parse(fs.readFileSync(ZG.OVERRIDES, "utf8"));

let fails = 0, passes = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}
// ------------------------------------------------------------------ fake DOM + boot (copied from typed_from_checks.js)
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
  typeItem, silentWrittenTypeItem: ${hook("silentWrittenTypeItem")}, writtenPronTypeItem: ${hook("writtenPronTypeItem")}, meaningTypeItem: ${hook("meaningTypeItem")}, meaningChoices,
  glossOut: ${hook("glossOut")}, optHtml: o => GLOSS_OPT ? GLOSS_OPT(o) : null, hearItem, typedFromSlotItem: ${hook("typedFromSlotItem")},
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
const AMB = VC.typedAmbiguity(WORDS);
const keysOf = w => VC.glossAltKeys(VC.gloss(w), PACK);
const KEYS = new Map(WORDS.map(w => [w.id, keysOf(w)]));
const REVIEWED = new Set();
(OV.synonyms || []).forEach(g => g.words.forEach(a => g.words.forEach(b => { if(a !== b) REVIEWED.add(BY_W[a].id + "|" + BY_W[b].id); })));
// A second right answer, judged from the glosses themselves (not from words[].syn).
function conflict(a, b){
  if(a.id === b.id) return false;
  if(REVIEWED.has(a.id + "|" + b.id) || (a.typedSyn || []).includes(b.id) || (b.typedSyn || []).includes(a.id)) return true;
  const kb = KEYS.get(b.id); for(const k of KEYS.get(a.id)) if(kb.has(k)) return true;
  return false;
}
const lab = w => `${w.w} ${w.pron}`;
const unitOf = w => CHARACTERS.find(u => (u.words || [])[0] === w.id);
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
const allProg = () => VC.normalizeProg({ sets: { "1": NS("1"), "2": NS("2"), "3": NS("3"), "4": NS("4") }, placedOnce: true, sessions: 5 }, PACK);
const tierProg = ws => { const pm = allProg(); ws.forEach(w => { VC.ensureChars(pm).c[unitOf(w).id] = { r: 5, w: 0, s: 5 }; }); return pm; };

(async function main(){
  // ---------------------------------------------------------------- [1] build
  console.log("\n[1] build: words.json fields equal a fresh tools/zh_gloss.js run");
  {
    const pre = WORDS.map(w => { const c = strip(w); const o = OV.en[w.w]; if(o && w.en === o.en) c.en = o.was; return c; });
    const r = ZG.build(pre, OV);
    check(`zh_gloss.js build: no errors (${r.errs.join("; ")})`, r.errs.length === 0);
    const bad = WORDS.filter(w => {
      const id = w.id, en = r.en[id] !== undefined ? r.en[id] : pre.find(x => x.id === id).en;
      return en !== w.en || JSON.stringify(r.syn[id]) !== JSON.stringify(w.syn) || JSON.stringify(r.typedSyn[id]) !== JSON.stringify(w.typedSyn)
        || r.noTypedMeaning.includes(id) !== (w.noTypedMeaning === true);
    }).map(w => w.w);
    check(`words.json en / syn / typedSyn / noTypedMeaning match the build (stale: ${bad.slice(0, 10).join(" ")})`, bad.length === 0);
    const doc = fs.readFileSync(path.join(ROOT, "docs", "ZH_GLOSS.md"), "utf8");
    check("docs/ZH_GLOSS.md is current (rerun tools/pack_from_hsk.py)", doc === ZG.report(pre, OV, r));
    check(`every gloss override applied (${Object.keys(OV.en).length}), each with a source`, Object.entries(OV.en).every(([w, o]) => BY_W[w] && BY_W[w].en === o.en && !!o.src));
    const asym = WORDS.filter(w => (w.syn || []).some(x => !(BY_ID[x].syn || []).includes(w.id))).length;
    const outside = WORDS.filter(w => (w.typedSyn || []).some(x => !(w.syn || []).includes(x))).length;
    check(`syn symmetric (${asym} not), typedSyn within syn (${outside} not)`, asym === 0 && outside === 0);
    const nSyn = WORDS.filter(w => w.syn).length, nT = WORDS.filter(w => w.typedSyn).length;
    console.log(`    words with syn ${nSyn}, with typedSyn ${nT}, noTypedMeaning ${WORDS.filter(w => w.noTypedMeaning).length}`);
    check("syn agrees with the independent conflict test on every pair", WORDS.every(a => WORDS.every(b => a === b || conflict(a, b) === VC.isSyn(a, b))));
  }

  // ---------------------------------------------------------------- [2] 着急
  console.log("\n[2] 着急 zháojí before / after");
  const zj = BY_W["着急"], dx = BY_W["担心"], fn = BY_W["烦恼"];
  {
    console.log(`    着急 "${zj.en}"; 担心 "${dx.en}"; 烦恼 "${fn.en}"`);
    const off = id => WORDS_OFF.find(w => w.id === id);
    const count = (words, f) => { let n = 0; for(let s = 1; s <= 300; s++){ Math.random = mulberry32(s); if(f(words).some(v => v.id === dx.id || v.id === fn.id)) n++; } Math.random = REAL_RANDOM; return n; };
    const mo0 = count(WORDS_OFF, ws => VC.meaningOpts(off(zj.id), ws)), mo1 = count(WORDS, ws => VC.meaningOpts(zj, ws));
    const wo0 = count(WORDS_OFF, ws => VC.wordOpts(off(zj.id), ws, e => e.pron, PACK)), wo1 = count(WORDS, ws => VC.wordOpts(zj, ws, e => e.pron, PACK));
    console.log(`    before: 担心/烦恼 among 着急's meaning options in ${mo0}/300 seeds, word options in ${wo0}/300; after: ${mo1}, ${wo1}`);
    check("before (syn absent) 担心 or 烦恼 is a 着急 distractor; after, never (300 seeds, meaning and word options)", mo0 > 0 && wo0 > 0 && mo1 === 0 && wo1 === 0);
    check("着急 syn / typedSyn hold 担心 and 烦恼", [dx.id, fn.id].every(x => zj.syn.includes(x) && zj.typedSyn.includes(x)));
    check("typed meaning for 着急: worry, to worry, feel anxious, anxious (copula), any one", ["worry", "to worry", "feel anxious", "anxious", "to worry; anxious"].every(v => VC.checkGlossTyped(v, zj.en, PACK)) && !VC.checkGlossTyped("worried", zj.en, PACK));
  }

  // ---------------------------------------------------------------- [3] option sets
  console.log("\n[3] option sets never hold a second right answer (every zh word, 8 seeds each)");
  {
    const SEEDS = 8;
    function sweep(words){
      const by = Object.fromEntries(words.map(w => [w.id, w]));
      const v = { meaning: 0, word: 0, wordPron: 0, charRecall: 0, charRead: 0, gap: 0 }, sets = { meaning: 0, word: 0, wordPron: 0, charRecall: 0, charRead: 0, gap: 0 };
      const bad = (k, e, opts) => { sets[k]++; if(opts.some(o => conflict(e, o))) v[k]++; };
      words.forEach(e => {
        const u = unitOf(e);
        for(let s = 1; s <= SEEDS; s++){
          Math.random = mulberry32(s * 7919 + e.id.length);
          bad("meaning", e, VC.meaningOpts(e, words));
          bad("word", e, VC.wordOpts(e, words, null, PACK));
          bad("wordPron", e, VC.wordOpts(e, words, x => x.pron, PACK));
          bad("charRecall", e, VC.charOpts(u, CHARACTERS, by).map(x => by[x.words[0]]));
          bad("charRead", e, VC.charReadOpts(u, words, by));
        }
      });
      SENTENCES.forEach((sn, si) => VC.gapCandidateIndices(sn, by, PACK).forEach(i => {
        const e = by[sn.words[i]], m = VC.gapMatch(sn, e, by, PACK);
        for(let s = 1; s <= 2; s++){ Math.random = mulberry32(si * 31 + s); const gc = VC.gapChoices(e, m, words, PACK); bad("gap", e, gc.opts.slice(1).map(l => gc.byLabel[l])); }
      }));
      Math.random = REAL_RANDOM;
      return { v, sets };
    }
    const on = sweep(WORDS), off = sweep(WORDS_OFF);
    Object.keys(on.v).forEach(k => check(`${k}: ${on.sets[k]} option sets, ${on.v[k]} with a second right answer (syn absent: ${off.v[k]})`, on.v[k] === 0 && on.sets[k] > 1000));
    check("the check bites: without syn, meaning / word / character / cloze options do hold second right answers", off.v.meaning > 0 && off.v.word > 0 && off.v.charRecall > 0 && off.v.charRead > 0 && off.v.gap > 0);
  }

  // ---------------------------------------------------------------- [4] typed, meaning stimulus
  console.log("\n[4] typed items with a meaning stimulus accept every typedSyn word");
  {
    const { api } = await boot({ seed: 3 });
    const withT = WORDS.filter(w => w.typedSyn);
    const miss = [];
    withT.forEach(w => w.typedSyn.forEach(id => {
      const s = BY_ID[id];
      const p = api.pronTypeItem(w), wr = api.writtenTypeItem(w), sw = api.silentWrittenTypeItem(w), ty = api.typeItem(w);
      if(!p.check(s.pron) || !/also right/.test(p.feedback(s.pron))) miss.push(`${w.w}:pinyin ${s.pron}`);
      if(!wr.check(s.w) || !sw.check(s.w) || !/also right/.test(wr.feedback(s.w)) || !ty.check(s.w)) miss.push(`${w.w}:chars ${s.w}`);
    }));
    const pairs = withT.reduce((n, w) => n + w.typedSyn.length, 0);
    check(`${withT.length} words, ${pairs} typedSyn pairs: pinyin, characters (listen and silent cards) and word items accept each, the feedback names it (missed: ${miss.slice(0, 6).join(", ")})`, miss.length === 0 && pairs > 50);
    const own = WORDS.every(w => api.pronTypeItem(w).check(w.pron) && !api.pronTypeItem(w).feedback(w.pron).includes("also right") && api.writtenTypeItem(w).check(w.w));
    check("every word's own pinyin / characters stay right, with no synonym note", own);
    const wpLeak = withT.filter(w => w.typedSyn.some(id => VC.pronKey(BY_ID[id].pron) !== VC.pronKey(w.pron) && api.writtenPronTypeItem(w).check(BY_ID[id].pron))).map(w => w.w);
    check(`characters -> pinyin never takes a synonym's pinyin (the stimulus is the word itself): ${wpLeak.join(" ")}`, wpLeak.length === 0);
    const dg = BY_W["灯"], qg = BY_W["轻"];
    check(`a shared homonym is no typed synonym: 灯 "${dg.en}" rejects 轻 qīng, 轻 rejects dēng (both syn: ${VC.isSyn(dg, qg)})`, VC.isSyn(dg, qg) && !api.pronTypeItem(dg).check(qg.pron) && !api.pronTypeItem(qg).check(dg.pron));
    check("着急's pinyin card takes dānxīn and dānxin (tones optional), the characters card 担心", api.pronTypeItem(zj).check("dānxīn") && api.pronTypeItem(zj).check("danxin") && api.writtenTypeItem(zj).check("担心"));
    const { api: offApi } = await boot({ seed: 3, words: WORDS_OFF });
    const z0 = WORDS_OFF.find(w => w.id === zj.id);
    check("syn fields absent: the same cards reject 担心 (flag off)", !offApi.pronTypeItem(z0).check("dānxīn") && !offApi.writtenTypeItem(z0).check("担心") && offApi.pronTypeItem(z0).check(z0.pron));
  }

  // ---------------------------------------------------------------- [5] noTypedMeaning
  console.log("\n[5] noTypedMeaning words never get a typed-meaning kind");
  {
    const marked = WORDS.filter(w => w.noTypedMeaning);
    console.log(`    marked: ${marked.map(lab).join(", ")}`);
    check("marked: first alternative an explanation (particles, classifiers, markers, 把 被) plus 地 -ly and 场",
      marked.map(w => w.w).join(" ") === "个 了 吗 呢 本 件 吧 张 得 着 位 地 把 条 被 辆 之 分之 台 场 座 棵 篇 顿");
    const MK = new Set(["writtenMeaning", "pronMeaning"]);
    let slots = 0, leaks = 0, none = 0;
    marked.forEach(w => [true, false].forEach(shown => {
      for(let seen = 0; seen < 9; seen++){
        const prog = VC.normalizeProg({ w: { [w.id]: { r: seen, w: 0, s: 0 } } }, PACK), plan = Array.from({ length: 9 }, () => ({ kind: "type", word: w }));
        plan.forEach((_, i) => { slots++; const k = VC.typedSlotKind(plan, i, prog, PACK, k2 => VC.typedKindOk(k2, w, shown, AMB)); if(!k) none++; else if(MK.has(k)) leaks++; });
      }
    }));
    check(`core: ${slots} rotation slots (every start, characters shown or not): ${leaks} typed-meaning kinds, ${none} with no kind`, leaks === 0 && none === 0 && slots > 1000);
    const { api } = await boot({ seed: 5 });
    api.setProg(tierProg(marked));
    const labels = new Set();
    marked.forEach(w => { const plan = Array.from({ length: 9 }, () => ({ kind: "type", word: w })); plan.forEach((_, i) => labels.add(api.typedFromSlotItem(plan, i).label)); });
    check(`app: marked words' typed slots (characters mastered) never "Type the meaning" (${[...labels].join(" / ")})`, !labels.has("Type the meaning") && labels.size >= 2);
    const a = BY_W["啊"];
    check(`啊 is typeable now ("${a.en}"): "ah", "oh" right; not marked; writtenMeaning allowed`, VC.checkGlossTyped("ah", a.en) && VC.checkGlossTyped("oh", a.en) && !a.noTypedMeaning && VC.typedKindOk("writtenMeaning", a, true, AMB));
    const unmarked = WORDS.filter(w => !w.noTypedMeaning && VC.typedKindOk("writtenMeaning", w, true, AMB)).length;
    check(`unmarked words keep the typed-meaning kinds (${unmarked})`, unmarked > 1100);
    check("meaning choice stays for marked words (4 distinct options)", marked.every(w => new Set(api.meaningChoices(w)).size === 4));
  }

  // ---------------------------------------------------------------- [6] glosses + matcher
  console.log("\n[6] gloss caps and matcher rules");
  {
    check("no zh gloss is truncated (no …)", WORDS.every(w => !/…/.test(w.en)));
    const han = WORDS.filter(w => /\p{Script=Han}/u.test(w.en)).map(w => w.w);
    check(`no zh gloss holds characters (a meaning -> characters card would show the answer): ${han.join(" ")}`, han.length === 0);
    const long = WORDS.filter(w => w.en.length > 75 || VC.glossParts(w.en).primary.length > 64).map(w => w.w);
    check(`every zh gloss at most 75 characters, its primary at most 64 (${long.join(" ")})`, long.length === 0);
    const hard = WORDS.filter(w => !w.noTypedMeaning && Math.min(...[...VC.glossAltKeys(w.en)].map(k => k.length)) > 16).map(w => w.w);
    check(`every typed-meaning word has an answer of at most 16 letters (${hard.join(" ")})`, hard.length === 0);
    const unreach = [];
    WORDS.filter(w => !w.noTypedMeaning).forEach(w => VC.splitTopLevel(w.en, [";", ","]).map(x => x.trim()).filter(x => x && !ZG.explanatory(x)).forEach(alt => {
      const t = VC.parenGroups(alt).rest.replace(/\s+/g, " ").trim(); if(t && !VC.checkGlossTyped(t, w.en)) unreach.push(`${w.w} "${t}"`); }));
    console.log(`    alternatives unreachable by their own text: ${unreach.join(", ") || "none"}`);
    check("every typed-meaning alternative is reachable by typing its text (bar the documented 的 ~'s)", unreach.join() === `的 "~'s"`);
    const T = [["careful", "to be careful; to take care", true], ["anxious", "to worry; to feel anxious", true], ["alive", "to be alive", true],
      ["that", "to think that ...; to feel that ...", false], ["", "to be (followed by substantives only)", false], ["on summer vacation", "(to be on) summer vacation", false],
      ["summer vacation", "(to be on) summer vacation", true], ["chang jiang", "Yangtze River; Chang Jiang", true], ["chinese", "Chinese (language)", true],
      ["injection", "(to have) an injection; to give an injection", true], ["too late", "too late (to do sth); not enough time (to do sth)", true],
      ["business trip", "business trip; to go on a business trip (or official trip)", true]];
    T.push(["like", "to resemble; to be like", false], ["apart from", "to be apart from", false], ["able", "to be able to", false], ["away from", "to be away from", false],
      ["followed by substantives only", "to be (followed by substantives only)", false], ["over", "to be over", false], ["left", "to be left", false], ["born", "to be born", true], ["sad", "to feel sad", true]);
    const tb = T.filter(([v, g, ok]) => VC.checkGlossTyped(v, g, PACK) !== ok);
    check(`matcher: copula and override cases (${T.length}; wrong: ${JSON.stringify(tb)})`, tb.length === 0);
    check("copula keys only with content after be/feel", VC.glossAltKeys("to be", PACK).size === 1 && !VC.glossAltKeys("to feel that ...", PACK).has("that"));
    const other = { typing: "word" };
    check("copula rule gated: a pack without typedFrom keeps its keys (no \"careful\" for \"to be careful\")", !VC.checkGlossTyped("careful", "to be careful") && !VC.checkGlossTyped("careful", "to be careful", other) && VC.checkGlossTyped("careful", "to be careful", PACK));
  }

  // ---------------------------------------------------------------- [7] validate_pack.py
  console.log("\n[7] validate_pack.py on syn / typedSyn / noTypedMeaning");
  {
    const tmp = [];
    const fixture = () => ({
      pack: { key: "t", name: "T", tts: "en-GB", levels: [{ id: "A1", label: "A1" }], placement: [["A1", 2]], typing: null, showPron: false, hasLessons: false },
      words: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, w: `w${i}`, en: `gloss ${i}`, lv: "A1" })),
      sentences: [{ id: "s1", t: "w0 w1", en: "x", lv: "A1", words: ["x0", "x1"] }],
    });
    const run = fx => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ve_synpack_")); tmp.push(dir);
      const wr = (stem, data) => fs.writeFileSync(path.join(dir, stem + ".json"), JSON.stringify(data));
      wr("pack", fx.pack); wr("words", fx.words); wr("sentences", fx.sentences);
      cp.spawnSync(PY, [path.join(ROOT, "tools", "jsonify_pack.py"), dir], { cwd: ROOT });
      const r = cp.spawnSync(PY, [path.join(ROOT, "tools", "validate_pack.py"), dir], { cwd: ROOT, encoding: "utf8" });
      return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
    };
    const ok = fixture(); ok.words[0].syn = ["x1"]; ok.words[1].syn = ["x0"]; ok.words[0].typedSyn = ["x1"]; ok.words[2].noTypedMeaning = true;
    check("valid syn / typedSyn / noTypedMeaning: 0 errors", run(ok).status === 0);
    const cases = [
      ["one-sided syn", fx => { fx.words[0].syn = ["x1"]; }, /syn lists x1 but x1\.syn does not list x0/],
      ["unknown and self ids", fx => { fx.words[0].syn = ["x0", "nope"]; }, /unknown or self ids \['nope', 'x0'\]/],
      ["typedSyn outside syn", fx => { fx.words[0].typedSyn = ["x1"]; }, /typedSyn \['x1'\] not in its syn/],
      ["empty syn", fx => { fx.words[0].syn = []; }, /syn must be a non-empty list/],
      ["noTypedMeaning false", fx => { fx.words[0].noTypedMeaning = false; }, /noTypedMeaning must be true/],
    ];
    cases.forEach(([name, mut, re]) => { const fx = fixture(); mut(fx); const r = run(fx); check(`${name}: error`, r.status === 1 && re.test(r.out)); });
    const z = cp.spawnSync(PY, [path.join(ROOT, "tools", "validate_pack.py"), ZH], { cwd: ROOT, encoding: "utf8" });
    check("packs/zh validates (0 errors)", z.status === 0 && / 0 errors/.test(z.stdout));
    tmp.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  }

  // ---------------------------------------------------------------- [8] review round 2
  console.log("\n[8] typed groups, notTyped, first-meaning rule, HSK core senses, shortened glosses");
  {
    const has = (a, b) => (BY_W[a].typedSyn || []).includes(BY_W[b].id);
    const groupPairs = (typed) => (OV.synonyms || []).filter(g => (g.typed === true) === typed).flatMap(g => g.words.flatMap(a => g.words.filter(b => b !== a).map(b => [a, b])));
    const typedOk = groupPairs(true).every(([a, b]) => has(a, b));
    check("typed groups: every pair accepted both ways (着急/担心/烦恼, 突然/忽然, 一定/肯定, 可能/也许 …)", typedOk && has("可能", "也许") && has("也许", "可能") && has("突然", "忽然"));
    const synOnly = [["可能", "大概"], ["大概", "也许"], ["容易", "简单"], ["其他", "别人"], ["为", "因为"], ["以前", "原来"], ["情况", "环境"], ["印象", "回忆"], ["最后", "到底"], ["旁边", "一边"]];
    check(`syn-only groups are no typed answers (${synOnly.map(p => p.join("/")).join(" ")}) but stay syn`, synOnly.every(([a, b]) => !has(a, b) && !has(b, a) && VC.isSyn(BY_W[a], BY_W[b])));
    const reviewBad = [["真", "是"], ["朋友", "友好"], ["其他", "别人"], ["简单", "容易"], ["情况", "环境"], ["印象", "回忆"], ["最后", "到底"], ["以前", "原来"], ["因为", "为"], ["旁边", "一边"],
      ["写", "做"], ["医生", "博士"], ["意思", "意见"], ["意见", "意思"], ["不但", "而且"], ["河", "水"], ["梦", "理想"], ["减肥", "瘦"], ["走", "行"], ["行", "走"], ["老师", "先生"],
      ["晴", "明白"], ["灯", "轻"], ["时间", "次"], ["杯子", "碗"], ["课", "班"], ["喜欢", "一样"], ["赢", "在"]];
    const acc = reviewBad.filter(([a, b]) => has(a, b));
    check(`review false merges never typed answers (${reviewBad.length}; accepted: ${acc.map(p => p.join("<-")).join(" ")})`, acc.length === 0);
    const blocked = (OV.notTyped || []).filter(n => has(n.pair[0], n.pair[1]));
    check(`every notTyped pair (${(OV.notTyped || []).length}) stays rejected (${blocked.map(n => n.pair.join("<-")).join(" ")})`, blocked.length === 0 && OV.notTyped.every(n => n.why));
    // Every pair the first-meaning rule proposes was reviewed: accepted (typedSyn) or rejected (notTyped).
    const first = w => { const a = VC.splitTopLevel(VC.gloss(w), [";", ","]).map(x => x.trim()).filter(Boolean)[0]; return a && !ZG.explanatory(a) ? VC.glossAltKeys(a, PACK) : new Set(); };
    const NT = new Set((OV.notTyped || []).map(n => n.pair.join("<-")));
    let proposed = 0; const unreviewed = [], outside = [];
    WORDS.forEach(t => { const f = first(t); if(!f.size) return; WORDS.forEach(x => {
      if(x.id === t.id || ![...f].some(k => KEYS.get(x.id).has(k))) return;
      proposed++; if(!has(t.w, x.w) && !NT.has(t.w + "<-" + x.w)) unreviewed.push(t.w + "<-" + x.w); }); });
    const inGroup = new Set(groupPairs(true).map(p => p.join("<-")));
    WORDS.forEach(t => (t.typedSyn || []).forEach(id => { const x = BY_ID[id]; if(!inGroup.has(t.w + "<-" + x.w) && ![...first(t)].some(k => KEYS.get(x.id).has(k))) outside.push(t.w + "<-" + x.w); }));
    check(`first-meaning rule: ${proposed} proposed pairs, each accepted or on notTyped (unreviewed: ${unreviewed.slice(0, 8).join(" ")})`, unreviewed.length === 0 && proposed > 400);
    check(`every typedSyn pair is a typed group or covers the stimulus's first meaning (outside: ${outside.slice(0, 8).join(" ")})`, outside.length === 0);
    const sym = ["但是", "可是", "却", "不过"].flatMap(a => ["但是", "可是", "却", "不过"].filter(b => b !== a).map(b => [a, b])).filter(([a, b]) => !has(a, b));
    check(`symmetric where the relation is: 但是/可是/却/不过 all accept each other (missing: ${sym.map(p => p.join("<-")).join(" ")})`, sym.length === 0);
    const wrongOpt = [["吧", "右边"], ["不过", "却"], ["不过", "可是"], ["却", "可是"]].filter(([a, b]) => !VC.isSyn(BY_W[a], BY_W[b]));
    check(`review option offenders are syn, never co-options (吧/右边, 不过/却/可是): ${wrongOpt.map(p => p.join("/")).join(" ")}`, wrongOpt.length === 0);
    // HSK core sense first: the first alternative (typed key) of the words the review named.
    const core = { 给: "to give", 才: "only then", 种: "kind", 次: "time", 遍: "time", 叫: "to be called", 意思: "meaning", 明白: "to understand", 不过: "but", 行: "OK",
      双: "pair", 点: "o'clock", 让: "to let", 别: "don't", 过: "to cross", 上: "up", 下: "down", 在: "at", 想: "to think", 看: "to look at", 等: "to wait", 做: "to do", 会: "can", 就: "then", 还是: "or" };
    const cbad = Object.entries(core).filter(([w, k]) => { const a = VC.splitTopLevel(BY_W[w].en, [";"])[0]; return !VC.glossAltKeys(a, PACK).has(VC.glossKey(k)); }).map(([w]) => `${w} "${BY_W[w].en}"`);
    check(`HSK core sense first (${Object.keys(core).length} words: 给 才 种 次 遍 叫 意思 明白 不过 行 …) ${cbad.join("; ")}`, cbad.length === 0);
    const clf = ["本", "张", "位", "把", "被", "件", "条"].filter(w => !BY_W[w].noTypedMeaning || !/classifier|marker/.test(VC.splitTopLevel(BY_W[w].en, [";"])[0]));
    check(`classifier / marker core sense first and marked noTypedMeaning (本 张 位 把 被 件 条): ${clf.join(" ")}`, clf.length === 0);
    const typedOkCases = [["dictionary", "字典"], ["grandfather", "爷爷"], ["call", "打电话"], ["to treat", "请客"], ["messy", "乱"], ["in advance", "提前"], ["regardless", "无论"], ["no matter what", "无论"]];
    const tf = typedOkCases.filter(([v, w]) => !VC.checkGlossTyped(v, BY_W[w].en, PACK));
    check(`gloss fixes accept the common answer (${typedOkCases.map(([v, w]) => w + " " + v).join(", ")}): ${JSON.stringify(tf)}`, tf.length === 0 && has("词典", "字典") && has("字典", "词典"));
    const { api } = await boot({ seed: 3 });
    const ry = api.optHtml(BY_W["容易"].en), yx = api.optHtml("impression (sth that stays in one's mind); a memory");
    check(`option buttons: first alternatives only (容易 -> ${ry}), a long (...) explanation as (…) (${yx})`,
      ry === "easy; straightforward" && /impression <span class="dim">\(…\)<\/span>/.test(yx) && !/stays/.test(yx) && api.optHtml("(classifier for flat objects, sheets); to open").startsWith("(classifier for flat objects, sheets)"));
    const note = api.pronTypeItem(zj).feedback(dx.pron);
    check(`"also right" note: the synonym's first meaning only (${note.replace(/<[^>]+>/g, "")})`, /also right/.test(note) && /anxious/.test(note) && !/worried/.test(note));
  }

  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
