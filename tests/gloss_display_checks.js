// Checks for pack.glossStyle "primary" (docs/PACK_SCHEMA.md "glossStyle"): [1] glossSenses /
// typedSynWords, [2] render helpers on 别 and 帮助 at every word-gloss site, [3] matching keeps the
// raw en, [4] control: glossStyle absent -> HTML byte-identical to main 3044601's engine.
// Boots engine/app.html in the fake DOM of tests/typed_from_checks.js.
// Run: node tests/gloss_display_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const MAIN = "3044601"; // main before glossStyle
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// pack.pairs (fb23) replaces the day planner this suite checks; tests/pairs_checks.js covers it.
const PACK = (p => { delete p.pairs; return p; })(loadConst(path.join(ZH, "pack.js"), "PACK"));
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));
const PACK_OFF = (p => { delete p.glossStyle; return p; })(JSON.parse(JSON.stringify(PACK)));
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
  glossOut: ${hook("glossOut")}, glossBrief: ${hook("glossBrief")}, synAlsoHTML: ${hook("synAlsoHTML")}, hearItem, typedFromSlotItem: ${hook("typedFromSlotItem")},
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


const W = ch => WORDS.find(x => x.w === ch);
const esc = VC.escapeHtml;
const WORDS_OFF = WORDS;
(async () => {
  console.log("\n[1] core helpers");
  const bie = W("别"), bang = W("帮助"), bangmang = W("帮忙");
  const sn = VC.glossSenses(bie.en);
  check("glossSenses(别): first sense + 4 others", sn.first === "don't ...!" && sn.rest.join("|") === "other|another|to leave|to part");
  check("glossSenses: one sense -> no rest; reading note is not a sense; empty is safe",
    VC.glossSenses("to study").rest.length === 0 && VC.glossSenses("who; also pr. [shuí]").rest.length === 0 && VC.glossSenses("").first === "");
  check("glossSenses: a ';' inside (...) does not split", VC.glossSenses("to be (a; b) here; to stay").rest.join("|") === "to stay");
  check("glossStyleOn: zh ships it; absent, other value, or no glossFocus is off",
    VC.glossStyleOn(PACK) && !VC.glossStyleOn(PACK_OFF) && !VC.glossStyleOn(Object.assign({}, PACK, { glossStyle: "yes" })) && !VC.glossStyleOn(Object.assign({}, PACK, { glossFocus: false })));
  check("typedSynWords(帮助) = [帮忙]; a word without typedSyn has none", VC.typedSynWords(bang, BY_ID).map(x => x.w).join() === "帮忙" && VC.typedSynWords(bie, BY_ID).length === 0);
  const synOnly = WORDS.filter(x => x.syn && !x.typedSyn);
  check(`syn-only words (${synOnly.length}) list no partners (false friends stay out)`, synOnly.length > 0 && synOnly.every(x => VC.typedSynWords(x, BY_ID).length === 0));

  console.log("\n[2] render sites on 别 and 帮助");
  try {
    const { api } = await boot({ seed: 9 });
    api.setProg(atTierProg([bie, bang, bangmang].filter(unitOf)));
    const want = esc("don't ...!") + ' <span class="gx">(other; another; to leave; to part)</span>';
    check(`glossOut(别) = ${want}`, api.glossOut(bie.en) === want);
    check("glossOut: one-sense gloss unchanged; qualifier stays dimmed inside a sense",
      api.glossOut("to study") === "to study" && api.glossOut("who; also pr. [shuí]", true) === 'who <span class="dim">also pr. [shuí]</span>'
      && api.glossOut("(of x) to spread; to propagate") === 'to spread <span class="dim">(of x)</span> <span class="gx">(to propagate)</span>');
    check("glossOut with notes puts the note after the bracket", api.glossOut("who; whom; also pr. [shuí]", true) === 'who <span class="gx">(whom)</span> <span class="dim">also pr. [shuí]</span>');
    const sites = { reveal: api.revealBlock(bie), wordsRow: api.wordRowHTML(bie, "wl"), popover: api.glossHTML(bie.id, "", null),
      recall: api.recallItem(bie).html, charRecall: unitOf(bie) ? api.charDrillItem("charRecall", unitOf(bie)).html : want };
    const bad = Object.entries(sites).filter(([, h]) => !h.includes(want)).map(x => x[0]);
    check(`bracketed gloss at every site (bad: ${bad.join(", ") || "none"})`, bad.length === 0);
    const opt = api.readItem(bie).optHtml(bie.en);
    check(`option button (bracket muted): ${opt}`, opt === want);
    check("also-right note and option use the same helper", api.glossBrief("to help; to lend a hand", 1, 0) === 'to help <span class="gx">(to lend a hand)</span>');
    const de = W("的");
    check(`qualifier-only senses stay dimmed as on main (的 ${JSON.stringify(de.en)})`,
      api.glossOut("(used after an attribute); structural particle") === '<span class="dim">(used after an attribute)</span> <span class="gx">(structural particle)</span>'
      && api.glossOut(de.en).endsWith('<span class="dim">(used after an attribute)</span>)</span>'));
    check("qualifier-only rest sense is dimmed inside the muted bracket", api.glossOut("to be; (in progress: -ing)") === 'to be <span class="gx">(<span class="dim">(in progress: -ing)</span>)</span>');
    check("a one-sense gloss and a flag-off gloss carry no gx", !/gx/.test(api.glossOut("to study")));
    const rv = api.revealBlock(bang), row = api.wordRowHTML(bang, "wl");
    check("reveal of 帮助 has the also: line with 帮忙 only", /also: <bdi[^>]*>[^<]*帮忙[^<]*<\/bdi>/.test(rv) && !/also: [^<]*,/.test(rv));
    check("word row (teach, Words, weak lists) of 帮助 has it too", /also: <bdi[^>]*>[^<]*帮忙/.test(row) && /to help <span class="gx">\(help; assistance; to assist\)/.test(row));
    check("a word without typedSyn: no also: line at reveal or row", !/also:/.test(api.revealBlock(bie)) && !/also:/.test(api.wordRowHTML(bie, "wl")));
    api.wordsPage("1", 0);
    const wl = api.el("wl").children.map(c => c.innerHTML).join("|");
    check("Words tab: every typedSyn word of the page carries its also: line", WORDS.some(x => x.lv === "1" && x.typedSyn) && /also:/.test(wl));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[3] matching keeps the raw en");
  try {
    const { api } = await boot({ seed: 9 });
    api.setProg(atTierProg([bie]));
    const it = api.readItem(bie);
    check("option set compares raw glosses: answer is the raw en, opts hold it", it.a === VC.gloss(bie) && it.opts.includes(VC.gloss(bie)));
    check("checkGlossTyped: any sense or the whole raw gloss is right, unchanged", ["other", "to leave", "don't", VC.gloss(bie)].every(v => VC.checkGlossTyped(v, bie.en, PACK)));
    check("typedSyn matching still finds 帮忙 for 帮助 typed", VC.typedSynHit(bang, BY_ID, s => s.w === "帮忙").w === "帮忙");
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n[4] control: glossStyle absent -> HTML byte-identical to main ${MAIN}`);
  {
    let mainHtml = null, mainCore = null;
    try{
      mainHtml = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/app.html`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const src = cp.execSync(`git -C "${ROOT}" show ${MAIN}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const m = { exports: {} }; new Function("module", "exports", "window", "globalThis", src)(m, m.exports, undefined, {}); mainCore = m.exports;
    }catch(e){ console.log("    cannot read main: " + e.message); }
    check(`main ${MAIN} engine loaded from git (a missing sha is a failure)`, !!mainHtml && !!mainCore);
    async function screens(html, core, pack, seed){
      const { api } = await boot({ html, core, pack, seed, words: WORDS_OFF });
      const out = {};
      api.setProg(seedPF()); api.today(); out.today = api.html("panel");
      api.el("go").click();
      let walked = []; try{ walked = walk(api, /id="again"/); }catch(e){ walked = [{ where: "ERR", html: e.message }]; }
      out.walk = walked.map(x => x.where + "\n" + x.html).join("\n----\n");
      const ws = WORDS_OFF.filter(x => x.lv === "1").slice(0, 60).concat([bie, bang, bangmang]);
      api.setProg(atTierProg(ws.slice(0, 20).filter(unitOf)));
      out.reveals = ws.map(x => api.revealBlock(x) + api.wordRowHTML(x, "wl") + api.glossHTML(x.id, "", null)).join("\n");
      out.items = ws.map(x => api.readItem(x)).map(it => it.opts.map(o => it.optHtml ? it.optHtml(o) : o).join("|")).join("\n");
      api.wordsPage("1", 0); out.words = api.html("panel") + api.el("wl").children.map(c => c.innerHTML).join("|");
      return out;
    }
    if(mainHtml && mainCore){
      const a = await screens(mainHtml, mainCore, PACK_OFF, 11), b = await screens(CUR_HTML, VC, PACK_OFF, 11);
      for(const k of Object.keys(a)){
        let d = 0; while(d < a[k].length && a[k][d] === b[k][d]) d++;
        check(`zh without glossStyle: ${k} byte-identical to main (${a[k].length} chars)${a[k] === b[k] ? "" : ` first diff at ${d}: main ${JSON.stringify(a[k].slice(d, d + 80))} vs ${JSON.stringify(b[k].slice(d, d + 80))}`}`, a[k] === b[k] && a[k].length > 100);
      }
      const on = await screens(CUR_HTML, VC, PACK, 11);
      check("zh with glossStyle differs from flag off (the flag does something)", on.reveals !== b.reveals && /also: /.test(on.reveals) && !/also: /.test(b.reveals));
    }
  }
  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
