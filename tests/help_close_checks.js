// Checks for pack.helpClose (docs/PACK_SCHEMA.md "helpClose") and the Read verdict scroll:
// [1] core.js helpCloseOn, [2] validate_pack.py accepts only true, [3] zh (flag on): the
// passage word popover, the sentence word popover and the audio toast each get a close
// button, close on a tap outside, on Escape and after the timer (held while a pointer or
// finger is on it), one at a time, [4] flag off (zh without the field): popover markup and
// behaviour as before, [5] a Read question answered with the passage open brings the
// verdict and Next (one button, above the passage toggle) into view, never scrolling past the passage.
// Boots engine/app.html in the fake DOM of tests/session_resume_checks.js with a fake clock.
// Run: node tests/help_close_checks.js   (PYTHON3 overrides the interpreter)
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON3 || "python3";
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");

let fails = 0, passes = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); if(extra) console.log("    " + String(extra).slice(0, 1200)); }
}
// Timers the page sets run only when the test advances the clock.
const clock = {
  now: 0, timers: [],
  set(f, ms){ const t = { f, at: clock.now + (ms || 0) }; clock.timers.push(t); return t; },
  clear(t){ const i = clock.timers.indexOf(t); if(i >= 0) clock.timers.splice(i, 1); },
  run(ms){ clock.now += ms; for(;;){ const due = clock.timers.filter(t => t.at <= clock.now).sort((a, b) => a.at - b.at)[0]; if(!due) break; clock.clear(due); due.f(); } }
};

let appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
const CUR_HTML = appHtml;
const scriptOf = html => { const b = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; return b[b.length - 1][1]; };
function extractAttrs(tag){
  const attrs = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  let m; while((m = re.exec(tag))){ if(m[1]) attrs[m[1]] = m[2] !== undefined ? m[2] : ""; }
  return attrs;
}
const scrolled = [];
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
    remove(){}
    focus(){}
    click(){ if(this.onclick) this.onclick({}); (this._listeners.click||[]).forEach(f=>f({})); }
    closest(){ return null; }
    contains(x){ for(let n = x; n; n = n._parent) if(n === this) return true; return false; }
    getBoundingClientRect(){ return this._rect || { top: 100, bottom: 140, height: 40 }; }
    scrollIntoView(){ scrolled.push(this.id || this.tagName); }
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
  new El("nav", { id: "tabs" }); // bringIntoView measures against the tab bar
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
// Boots the zh app on the given storages (a reboot on the same storages is a page reload).
// seed: Math.random for the boot and everything after it, until the next boot; a reload
// uses another seed, so a matching item proves the replay, not the seed.
async function boot(o){
  Math.random = mulberry32(o.seed || 1);
  appHtml = o.html || CUR_HTML; clock.timers.length = 0;
  const document = makeFakeDom();
  if(o.mark) document.lastChild = { nodeType: 8, nodeValue: o.mark, previousSibling: null };
  const spoken = [];
  const voices = o.voices || [{ lang:"zh-CN", name:"x" }];
  const ss = { getVoices: () => voices, onvoiceschanged: null, cancel(){}, speak(u){ spoken.push(u.text); } };
  const window = { VocabCore: VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf(appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  doc: document, helpCur: () => helpCur,
  html: id => { const e = document.getElementById(id); return e ? e.innerHTML : null; },
  el: id => document.getElementById(id),
  hint: m => audioHint(m), getProg: () => prog, getD: () => D, getCur: () => __cur, tab: () => tab, rd: () => RD, tss: () => todayStepState,
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
  startPassage: p => { startPassage(p); },
  todayAt: s => { todayStepState = { step: s }; todayStep(); },
  build: () => sessionBuild(), render: () => render(), key: k => (document._listeners.keydown || []).forEach(f => f({ key: k, preventDefault(){}, target: null })),
  importProg: async t => { const r = VC.applyImport(prog, t, PACK); prog = r.prog; sessStore.clear(); store.save(); }, hide: () => (document._listeners.visibilitychange || []).forEach(f => { document.visibilityState = "hidden"; f(); }),
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","setTimeout","clearTimeout","innerHeight","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"SessionResumeChecks/1.0" }, undefined, o.ls, o.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, clock.set, clock.clear, 800, o.pack || PACK, WORDS, SENTENCES, LESSONS, PASSAGES, CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return { api, spoken, ss, voices, document };
}

const byLv = VC.wordsByLevel(WORDS, PACK);
const seedPF = () => VC.normalizeProg({ sets: { "1": VC.nSets(byLv["1"], VC.setSizeOf(PACK)), "2": 2 }, placedOnce: true, sessions: 5 }, PACK);
function fresh(){ const ls = memStore(), ss = memStore(); ls.setItem(VC.storageKey(PACK), JSON.stringify(seedPF())); return { ls, ss }; }
const P1 = PASSAGES.find(x => x.lv === "1" && x.questions.length >= 2);
async function onPassage(pack){
  const { api } = await boot(Object.assign({ seed: 3, pack }, fresh()));
  clock.run(0);
  api.clickTab("read"); api.startPassage(P1);
  const pbox = api.el("pbox"), gloss = api.el("gloss");
  const docClick = t => (api.doc._listeners.click || []).forEach(f => f({ target: t, preventDefault(){}, stopPropagation(){} }));
  const tapWord = (id = P1.sentences[0].words[0]) => {
    const t = { _parent: pbox, dataset: { pw: id }, classList: { add(){}, remove(){} } }; t.closest = sel => sel === "[data-pw]" || /\[data-pw\]/.test(sel) ? t : null;
    docClick(t); pbox._listeners.click.forEach(f => f({ target: t }));
  };
  const fire = (el, type, e) => (el._listeners[type] || []).forEach(f => f(Object.assign({ pointerType: "touch" }, e)));
  const esc = () => (api.doc._listeners.keydown || []).forEach(f => f({ key: "Escape", target: null, preventDefault(){} }));
  return { api, pbox, gloss, docClick, tapWord, fire, esc };
}

(async function main(){
  console.log("\n[1] core.js helpCloseOn");
  check("helpCloseOn: true only for helpClose === true", VC.helpCloseOn({ helpClose: true }) && !VC.helpCloseOn({}) && !VC.helpCloseOn({ helpClose: "yes" }) && !VC.helpCloseOn(null));
  check("zh ships helpClose: true", PACK.helpClose === true);
  check("readAnswerBlockOn: true only for readAnswerBlock === true; zh ships it", VC.readAnswerBlockOn({ readAnswerBlock: true }) && !VC.readAnswerBlockOn({}) && !VC.readAnswerBlockOn({ readAnswerBlock: 1 }) && PACK.readAnswerBlock === true);

  console.log("\n[2] validate_pack.py");
  {
    const run = extra => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ve_help_"));
      const w = (stem, data) => fs.writeFileSync(path.join(dir, stem + ".json"), JSON.stringify(data));
      w("pack", Object.assign({ key:"t", name:"T", tts:"sw-KE", levels:[{ id:"A1", label:"A1" }], placement:[["A1", 2]], typing:null, showPron:false, hasLessons:false }, extra));
      w("words", Array.from({ length: 20 }, (_, i) => ({ id:`x${i}`, w:`x${i}`, en:`gloss ${i}`, lv:"A1" })));
      w("sentences", [{ id:"s1", t:"x0 x1.", en:"x.", lv:"A1", words:["x0", "x1"] }]);
      cp.spawnSync(PY, [path.join(ROOT, "tools", "jsonify_pack.py"), dir], { cwd: ROOT });
      const r = cp.spawnSync(PY, [path.join(ROOT, "tools", "validate_pack.py"), dir], { cwd: ROOT, encoding: "utf8" });
      fs.rmSync(dir, { recursive: true, force: true });
      return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
    };
    const a = run({}), b = run({ helpClose: true, readAnswerBlock: true }), c = run({ helpClose: false }), d = run({ readAnswerBlock: "yes" });
    check("absent or true: no helpClose error", a.status === 0 && b.status === 0 && !/helpClose/.test(a.out + b.out), a.out + b.out);
    check("false: error 'pack.helpClose must be true when present'", c.status === 1 && /pack\.helpClose must be true when present/.test(c.out), c.out);
    check("readAnswerBlock not true: error", d.status === 1 && /pack\.readAnswerBlock must be true when present/.test(d.out), d.out);
  }

  console.log("\n[3] zh, flag on");
  check("zh pack runs with dayAware on as well", PACK.dayAware === true);
  try {
    const { api, gloss, docClick, tapWord, fire, esc } = await onPassage();
    tapWord();
    check("passage word tap: popover open with a close button", !gloss.hidden && /class="helpx"/.test(gloss.innerHTML) && gloss.classList.contains("hasx") && api.helpCur() && api.helpCur().el === gloss);
    clock.run(19900);
    check("still open at 7.9 s", !gloss.hidden);
    clock.run(200);
    check("closes itself at 20 s", gloss.hidden && !api.helpCur());
    tapWord(); fire(gloss, "pointerenter", { pointerType: "mouse" }); clock.run(60000);
    check("mouse over it: no auto-close (30 s)", !gloss.hidden);
    fire(gloss, "pointerup", { pointerType: "mouse" }); clock.run(60000);
    check("mouse button released while still over it: still open", !gloss.hidden);
    fire(gloss, "pointerleave", { pointerType: "mouse" }); clock.run(19900);
    check("pointer leaves: the timer restarts (open at 7.9 s)", !gloss.hidden);
    clock.run(200);
    check("then closes", gloss.hidden);
    tapWord(); fire(gloss, "pointerdown"); clock.run(60000);
    check("finger on it: no auto-close", !gloss.hidden);
    fire(gloss, "pointerup"); clock.run(20100);
    check("finger lifted: closes 20 s later", gloss.hidden);
    tapWord();
    const x = { _parent: gloss }; docClick({ _parent: gloss, closest: sel => sel === ".helpx" ? x : null });
    check("close button: closes", gloss.hidden && !api.helpCur());
    tapWord(); docClick({ _parent: gloss, closest: () => null });
    check("tap inside the popover: stays open", !gloss.hidden);
    docClick({ closest: () => null });
    check("tap outside: closes", gloss.hidden && !api.helpCur());
    const docEv = (type, t) => (api.doc._listeners[type] || []).forEach(f => f({ target: t, preventDefault(){}, stopPropagation(){} }));
    tapWord(); docEv("pointerdown", { closest: () => null });
    check("pointerdown outside (iOS Safari sends no click on plain areas): closes", gloss.hidden && !api.helpCur());
    tapWord(); docEv("touchstart", { closest: () => null });
    check("touchstart outside: closes", gloss.hidden && !api.helpCur());
    tapWord(); docEv("pointerdown", { _parent: gloss, closest: () => null });
    check("pointerdown inside: stays open", !gloss.hidden);
    const w2 = { dataset: {}, closest: sel => /\[data-pw\]/.test(sel) ? w2 : null };
    docEv("pointerdown", w2);
    check("pointerdown on another word: not swallowed, the popover stays for that word's own tap", !gloss.hidden && !!api.helpCur());
    tapWord(P1.sentences[0].words[1] || P1.sentences[0].words[0]);
    check("then its tap opens it", !gloss.hidden && api.helpCur().el === gloss);
    docClick({ closest: () => null });
    tapWord(); tapWord(P1.sentences[0].words[1] || P1.sentences[0].words[0]);
    check("tap another word: the popover stays open with the new word", !gloss.hidden && api.helpCur().el === gloss);
    esc();
    check("Escape: closes", gloss.hidden && !api.helpCur());
    // Sentence word popover (data-tok) inside a reveal.
    tapWord();
    let g = null; const box = { querySelectorAll: () => [], querySelector: () => g, appendChild(c){ g = c; c._parent = box; return c; } };
    const tok = { dataset: { tok: WORDS[0].id }, classList: { add(){}, remove(){} } };
    tok.closest = sel => sel === "[data-tokbox]" ? box : /\[data-tok\]/.test(sel) ? tok : null;
    docClick(tok); api.el("panel")._listeners.click.forEach(f => f({ target: tok }));
    check("sentence word tap: its popover opens with a close button, the passage popover closes", g && !g.hidden && /class="helpx"/.test(g.innerHTML) && gloss.hidden && api.helpCur().el === g);
    clock.run(20100);
    check("sentence word popover closes itself at 20 s", g.hidden);
    api.hint("This recording couldn't be played.");
    const toast = api.helpCur() && api.helpCur().el;
    check("audio toast: close button, it is the open overlay", toast && toast.id === "audiohint" && /class="helpx"/.test(toast.innerHTML));
    tapWord();
    check("opening a popover closes the toast", api.helpCur().el === gloss);
    esc(); api.hint("x");
    clock.run(3400);
    check("toast keeps its 3.5 s timer (open at 3.4 s)", !!api.helpCur());
    clock.run(200);
    check("toast closes at 3.5 s", !api.helpCur());
    api.hint("x"); esc();
    check("Escape closes the toast", !api.helpCur());
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[4] flag off");
  try {
    const off = Object.assign({}, PACK); delete off.helpClose;
    const { api, gloss, docClick, tapWord } = await onPassage(off);
    tapWord();
    check("passage word tap: no close button, no overlay tracking", !gloss.hidden && !/helpx/.test(gloss.innerHTML) && !gloss.classList.contains("hasx") && !api.helpCur());
    clock.run(60000); docClick({ closest: () => null });
    check("no timer, a tap outside leaves it open (as before)", !gloss.hidden);
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[5] Read question: verdict and Next above the passage toggle");
  try {
    const { api } = await onPassage();
    api.el("rdone").click();
    const h = api.html("panel"), at = id => h.indexOf(`id="${id}"`);
    check("question screen order: options, verdict, Next, passage toggle, passage; one Next", at("o") < at("rv") && at("rv") < at("nx") && at("nx") < at("ptoggle") && at("ptoggle") < at("pbox") && h.split('id="nx"').length === 2);
    api.el("ptoggle").click();
    for(const right of [true, false]){
      scrolled.length = 0;
      const q = P1.questions[api.rd().qi], opts = api.el("o").children;
      (right ? opts.find(b => b.dataset.v === String(q.answer)) : opts.find(b => b.dataset.v !== String(q.answer))).click();
      check(`passage open, answered ${right ? "right" : "wrong"}: verdict and Next brought into view together, no scroll to the bottom (scrolled: ${scrolled.join(", ")})`, scrolled.join() === "qans" && api.el("nx").style.display === "block" && /Right\.|Not quite\./.test(api.html("rv")));
      api.el("nx").click(); if(!api.rd().shown) api.el("ptoggle").click();
    }
    // Flag off: Next in the bottom bar; an open passage brings the verdict into view.
    const off = Object.assign({}, PACK); delete off.readAnswerBlock;
    const o = await onPassage(off);
    o.api.el("rdone").click();
    const h2 = o.api.html("panel"), at2 = id => h2.indexOf(`id="${id}"`);
    check("flag off: Next stays below the passage in the bottom bar", at2("rv") < at2("ptoggle") && at2("pbox") < at2("nx") && /<div class="actions"><button class="next" id="nx"/.test(h2));
    o.api.el("ptoggle").click(); scrolled.length = 0; o.api.el("o").children[0].click();
    check(`flag off, passage open: the verdict is brought into view, not Next (scrolled: ${scrolled.join(", ")})`, scrolled.join() === "rv");
    o.api.el("nx").click(); scrolled.length = 0; o.api.el("o").children[0].click();
    check(`flag off, passage closed: scrolls to Next as before (scrolled: ${scrolled.join(", ")})`, scrolled.join() === "nx");
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
