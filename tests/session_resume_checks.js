// Checks for session resume (docs/PACK_SCHEMA.md "Session resume"): [1] core.js sessionKey /
// sessionHash / sessionStale rules, [2] a page reload mid-drill (Today Review on zh, typed and
// choice items) comes back at the same item with the same options in the same order, the same
// queue (keys, kinds, labels) and counts, and the Today session carries on to the next stage,
// [3] an app-tab switch and back resumes; tapping the open tab ends the drill, [4] stale
// records (other build, over 12 h, progress changed) are dropped silently and no answer is
// lost, [5] Test and Words-tab set drills, a typed item's choice counterpart, [6] the Read
// passage flow (Done reading, a question mid-flow, tapped words) and the Today Read stage,
// [7] the progress key is untouched (only vocab_<pack>_session is added, in sessionStorage).
// Boots engine/app.html in the fake DOM of tests/typed_from_checks.js with storages that
// survive a reboot (the reload).
// Run: node tests/session_resume_checks.js
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = loadConst(path.join(ZH, "pack.js"), "PACK");
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
const BY_ID = Object.fromEntries(WORDS.map(w => [w.id, w]));

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
function memStore(){
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()] };
}
// Boots the zh app on the given storages (a reboot on the same storages is a page reload).
// seed: Math.random for the boot and everything after it, until the next boot; a reload
// uses another seed, so a matching item proves the replay, not the seed.
async function boot(o){
  Math.random = mulberry32(o.seed || 1);
  appHtml = CUR_HTML;
  const document = makeFakeDom();
  const spoken = [];
  const ss = { getVoices: () => [{ lang:"zh-CN", name:"x" }], onvoiceschanged: null, cancel(){}, speak(u){ spoken.push(u.text); } };
  const window = { VocabCore: VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const fnBody = scriptOf(appHtml) + `
let __cur = null;
const __mc = renderMcItem; renderMcItem = function(it){ __cur = it; return __mc(it); };
const __ty = renderTypeItem; renderTypeItem = function(it){ __cur = it; return __ty(it); };
return {
  html: id => { const e = document.getElementById(id); return e ? e.innerHTML : null; },
  el: id => document.getElementById(id),
  getProg: () => prog, getD: () => D, getCur: () => __cur, tab: () => tab, rd: () => RD, tss: () => todayStepState,
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
  startPassage: p => { startPassage(p); },
  todayAt: s => { todayStepState = { step: s }; todayStep(); },
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"SessionResumeChecks/1.0" }, undefined, o.ls, o.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, PACK, WORDS, SENTENCES, LESSONS, PASSAGES, CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return { api, spoken };
}

// ------------------------------------------------------------------ helpers
const byLv = VC.wordsByLevel(WORDS, PACK);
const NS = lv => VC.nSets(byLv[lv], VC.setSizeOf(PACK));
const seedPF = () => VC.normalizeProg({ sets: { "1": NS("1"), "2": 2 }, placedOnce: true, sessions: 5 }, PACK);
const KEY = VC.storageKey(PACK), SKEY = VC.sessionKey(PACK);
function fresh(){ const ls = memStore(), ss = memStore(); ls.setItem(KEY, JSON.stringify(seedPF())); return { ls, ss }; }
function typedAnswer(it){
  const w = BY_ID[String(it.key).slice(2)];
  if(!w || !String(it.key).startsWith("w:")) return null;
  return it.label === "Type the pinyin" ? w.pron : it.label === "Type the meaning" ? VC.gloss(w) : w.w;
}
// Answers the item on screen, right or wrong.
function answer(api, right){
  const it = api.getCur();
  if(it.kind === "type"){
    const v = right ? typedAnswer(it) : null;
    api.el("tin").value = v || "zzz not it"; api.el("submit").click(); return;
  }
  const btns = api.el("o").children;
  (right ? btns.find(b => b.dataset.v === String(it.a)) : btns.find(b => b.dataset.v !== String(it.a))).click();
}
const sig = it => `${it.key}|${it.kind}|${it.label}|${it.reqKind || ""}`;
const queueSig = api => { const D = api.getD(); return D ? [D.cur, ...D.q].filter(Boolean).map(sig).join("\n") : ""; };
// The fake DOM keeps every id it has seen, so #o is read only while a choice item is on screen.
const optsShown = api => { const o = api.el("o"), it = api.getCur(); return o && api.getD() && it && it.kind === "mc" ? o.children.map(b => b.dataset.v).join("|") : ""; };
const readOpts = api => api.el("o").children.map(b => b.dataset.v).join("|");
const snapOf = api => ({ tab: api.tab(), cur: api.getCur() && api.getD() ? sig(api.getCur()) : null, opts: optsShown(api), queue: queueSig(api),
  seen: api.getD() && api.getD().seen, right: api.getD() && api.getD().right, miss: api.getD() && api.getD().miss.map(m => m.key).join(), panel: api.html("panel") });
const same = (a, b) => ["tab", "cur", "opts", "queue", "seen", "right", "miss", "panel"].filter(k => a[k] !== b[k]);
const sess = ss => { const v = ss.getItem(SKEY); return v ? JSON.parse(v) : null; };
// Walks the drill on screen: answers by plan (true/false per step) and presses Next.
function play(api, plan){ plan.forEach(ok => { answer(api, ok); api.el("nx").click(); }); }
function finishDrill(api){ for(let i = 0; i < 200 && api.getD(); i++){ answer(api, true); api.el("nx").click(); } }

(async function main(){
  // ---------------------------------------------------------------- [1] core rules
  console.log("\n[1] core.js: key, fingerprint, staleness");
  {
    check("sessionKey: vocab_<pack>_session beside the progress key", VC.sessionKey(PACK) === "vocab_zh_session" && VC.sessionKey({ key: "it" }) === "vocab_it_session");
    check("sessionHash: deterministic 8-hex fingerprint, differs on a one-char change", VC.sessionHash("abc") === VC.sessionHash("abc") && /^[0-9a-f]{8}$/.test(VC.sessionHash("abc")) && VC.sessionHash("abc") !== VC.sessionHash("abd") && VC.sessionHash(null) === VC.sessionHash(""));
    const now = 1e12, rec = { v: VC.SESSION_VERSION, build: "b1", t: now - 1000, fp: "f1" }, o = { build: "b1", fp: ["f0", "f1"], now };
    const H = 3600 * 1000;
    check("sessionStale: fresh record (same build, progress fingerprint among the current ones, 1 s old) -> resumable", VC.sessionStale(rec, o) === "");
    check("sessionStale: other build -> 'build'", VC.sessionStale(Object.assign({}, rec, { build: "b2" }), o) === "build");
    check("sessionStale: progress changed since the save -> 'progress'", VC.sessionStale(Object.assign({}, rec, { fp: "f9" }), o) === "progress");
    check("sessionStale: 12 h is the limit (11.9 h resumes, 12.1 h -> 'age'); a save from the future beyond a minute -> 'age'",
      VC.sessionStale(Object.assign({}, rec, { t: now - 11.9 * H }), o) === "" && VC.sessionStale(Object.assign({}, rec, { t: now - 12.1 * H }), o) === "age"
      && VC.sessionStale(Object.assign({}, rec, { t: now + 30000 }), o) === "" && VC.sessionStale(Object.assign({}, rec, { t: now + 120000 }), o) === "age" && VC.SESSION_MAX_AGE_MS === 12 * H);
    check("sessionStale: no record, another version, no time -> not resumable", VC.sessionStale(null, o) === "version" && VC.sessionStale(Object.assign({}, rec, { v: 99 }), o) === "version" && VC.sessionStale(Object.assign({}, rec, { t: undefined }), o) === "age");
  }

  // ---------------------------------------------------------------- [2] reload mid-drill
  console.log("\n[2] reload mid-drill (Today Review, zh)");
  try {
    const st = fresh();
    let { api } = await boot(Object.assign({ seed: 3 }, st));
    api.el("go").click();
    check("Today Review drill started", !!api.getD() && api.tab() === "today");
    const kinds = new Set([api.getCur(), ...api.getD().q].map(x => x.label));
    play(api, [true, false, true]);
    // Move on to a choice item so its option order is checked, typed items are covered below.
    for(let i = 0; i < 20 && api.getCur().kind !== "mc"; i++) play(api, [true]);
    const before = snapOf(api);
    const rec = sess(st.ss);
    check(`session recorded in sessionStorage under ${SKEY}, not in localStorage (items: ${rec && rec.drill.q.length}; kinds in drill: ${[...kinds].join(", ")})`, !!rec && rec.tab === "today" && !!rec.drill && st.ls.getItem(SKEY) === null);
    ({ api } = await boot(Object.assign({ seed: 99 }, st)));
    const after = snapOf(api);
    const diff = same(before, after);
    check(`reload on a choice item: same tab, item, option order, queue (keys, kinds, labels), counts, misses and panel markup (${diff.join(", ") || "all equal"}; item ${before.cur})`, diff.length === 0 && before.opts.length > 0);
    // Typed item on screen.
    for(let i = 0; i < 20 && api.getCur().kind !== "type"; i++) play(api, [true]);
    const t0 = snapOf(api);
    check(`a typed item is on screen (${t0.cur})`, api.getCur().kind === "type");
    ({ api } = await boot(Object.assign({ seed: 7 }, st)));
    const t1 = snapOf(api);
    check(`reload on a typed item: same item, kind tag, queue and counts (${same(t0, t1).join(", ") || "all equal"})`, same(t0, t1).length === 0);
    // Answered, reload before Next: the next item, the answer counted once.
    const nBefore = api.getD().q.length, seenBefore = api.getD().seen, nextSig = sig(api.getD().q[0]);
    const progBefore = JSON.stringify(api.getProg());
    answer(api, true);
    const progAfter = JSON.stringify(api.getProg());
    ({ api } = await boot(Object.assign({ seed: 8 }, st)));
    check(`reload after answering, before Next: the next item (${nextSig}), seen +1, the answer recorded once`,
      sig(api.getCur()) === nextSig && api.getD().seen === seenBefore + 1 && api.getD().q.length === nBefore - 1 && JSON.stringify(api.getProg()) === progAfter && progAfter !== progBefore);
    // Finish after the reload, then the results screen survives a reload too, and Today carries on.
    finishDrill(api);
    const doneHtml = api.html("panel");
    check("drill finished after reloads: results screen", /class="done"/.test(doneHtml) && /id="ok"/.test(doneHtml));
    ({ api } = await boot(Object.assign({ seed: 9 }, st)));
    check("reload on the results screen: same results and Continue", api.html("panel") === doneHtml && api.tab() === "today");
    api.el("ok").click();
    check(`Continue after the reloads goes on to the next Today stage (stage ${api.tss() && api.tss().at}: Learn)`, !!api.tss() && api.tss().at === 1);
    const teach = api.html("panel");
    if(/id="dr"/.test(teach) && !api.getD()){
      ({ api } = await boot(Object.assign({ seed: 10 }, st)));
      check("reload on the Learn teach screen shows it again (stage 1 re-run)", api.tss() && api.tss().at === 1 && api.html("panel") === teach);
    } else check("Learn stage has a teach screen to reload on", false);
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [3] tab switch
  console.log("\n[3] app-tab switch");
  try {
    const st = fresh();
    const { api } = await boot(Object.assign({ seed: 4 }, st));
    api.el("go").click();
    play(api, [true, true]);
    for(let i = 0; i < 20 && api.getCur().kind !== "mc"; i++) play(api, [true]);
    const a = snapOf(api);
    api.clickTab("words");
    check("switched to Words: the Words tab renders, no drill", api.tab() === "words" && !api.getD() && /Drill this set/.test(api.html("wbody")));
    api.clickTab("test");
    api.clickTab("today");
    const b = snapOf(api);
    check(`back on Today: the same item, options and queue (${same(a, b).join(", ") || "all equal"})`, same(a, b).length === 0);
    answer(api, false);
    api.clickTab("progress"); api.clickTab("today");
    check("answered, switched away before Next: back on the next item with the miss kept", api.getD() && api.getD().miss.length === a.miss.split(",").filter(Boolean).length + 1 && api.getD().seen === a.seen + 1);
    api.clickTab("today");
    check("tapping the open tab ends the drill: Today start screen, session dropped", !api.getD() && /id="go"/.test(api.html("panel")) && !st.ss.getItem(SKEY));
    api.clickTab("words"); api.clickTab("today");
    check("and it stays ended after a later switch", !api.getD() && /id="go"/.test(api.html("panel")));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [4] stale records
  console.log("\n[4] stale records are dropped silently");
  try {
    const H = 3600 * 1000;
    const variants = [["over 12 h old", r => { r.t -= 13 * H; }, null], ["another build", r => { r.build = "x:" + r.build; }, null],
      ["progress changed underneath", null, ls => { const p = JSON.parse(ls.getItem(KEY)); p.sessions = (p.sessions || 0) + 1; ls.setItem(KEY, JSON.stringify(p)); }]];
    for(const [name, edit, editLs] of variants){
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 5 }, st));
      api.el("go").click(); play(api, [true, false]);
      const stored = st.ls.getItem(KEY);
      const r = sess(st.ss); if(edit){ edit(r); st.ss.setItem(SKEY, JSON.stringify(r)); }
      if(editLs) editLs(st.ls);
      ({ api } = await boot(Object.assign({ seed: 6 }, st)));
      const kept = JSON.parse(editLs ? st.ls.getItem(KEY) : stored);
      check(`${name}: reload shows the Today start screen, the record is removed, the two answers stay recorded`,
        !api.getD() && /id="go"/.test(api.html("panel")) && !st.ss.getItem(SKEY) && JSON.stringify(api.getProg().w) === JSON.stringify(VC.normalizeProg(kept, PACK).w) && Object.keys(api.getProg().w).length > 0);
    }
    {
      const st = fresh();
      const { api } = await boot(Object.assign({ seed: 5 }, st));
      api.el("go").click(); play(api, [true]);
      api.clickTab("progress");
      api.getProg().sessions += 1;
      api.clickTab("today");
      check("in the open page: progress changed while away (another tab's work) -> Today start screen, record dropped", !api.getD() && /id="go"/.test(api.html("panel")) && !st.ss.getItem(SKEY));
    }
    {
      const st = fresh(); st.ss.setItem(SKEY, "{not json");
      const { api } = await boot(Object.assign({ seed: 5 }, st));
      check("an unreadable record: normal boot, record removed", /id="go"/.test(api.html("panel")) && !st.ss.getItem(SKEY));
    }
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [5] other drills
  console.log("\n[5] Test, Words set drill, a typed item's choice counterpart");
  try {
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 11 }, st));
      api.clickTab("test"); api.el("tRecall").click();
      play(api, [true, false]);
      const a = snapOf(api);
      ({ api } = await boot(Object.assign({ seed: 12 }, st)));
      check(`Test Recall: reload resumes on the Test tab at the same item (${same(a, snapOf(api)).join(", ") || "all equal"})`, same(a, snapOf(api)).length === 0 && api.tab() === "test");
      finishDrill(api); api.el("ok").click();
      check("Test Recall: Continue after the reload returns to the Test screen", /Placement finds where to start/.test(api.html("panel")) && !st.ss.getItem(SKEY));
    }
    {
      const st = fresh();
      const ctl = await boot(Object.assign({ seed: 13 }, fresh()));
      let { api } = await boot(Object.assign({ seed: 13 }, st));
      [ctl.api, api].forEach(x => { x.clickTab("words"); x.el("nx").click(); x.el("dr").click(); });
      play(api, [true]);
      const a = snapOf(api);
      ({ api } = await boot(Object.assign({ seed: 14 }, st)));
      check(`Words set drill (level 1, set 2): reload resumes on the Words tab at the same item (${same(a, snapOf(api)).join(", ") || "all equal"})`, same(a, snapOf(api)).length === 0 && api.tab() === "words");
      finishDrill(api); api.el("ok").click(); finishDrill(ctl.api); ctl.api.el("ok").click();
      check("Words set drill: Continue after the reload settles the set as without one (same sets, same d marks) and shows the Words page",
        JSON.stringify(api.getProg().sets) === JSON.stringify(ctl.api.getProg().sets) && JSON.stringify(Object.keys(api.getProg().w).filter(k => api.getProg().w[k].d)) === JSON.stringify(Object.keys(ctl.api.getProg().w).filter(k => ctl.api.getProg().w[k].d)) && /Drill this set/.test(api.html("wbody")));
    }
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 15 }, st));
      api.clickTab("test"); api.el("tRecall").click();
      let found = false;
      for(let i = 0; i < 80 && api.getD(); i++){
        const it = api.getCur();
        if(it.kind === "mc" && it.rz && it.rz.from){ found = true; break; }
        answer(api, it.kind !== "type"); api.el("nx").click();
      }
      check("a typed item missed twice came back as its choice counterpart", found);
      if(found){
        const a = snapOf(api);
        ({ api } = await boot(Object.assign({ seed: 16 }, st)));
        check(`reload on the choice counterpart: same item, same options in the same order (${same(a, snapOf(api)).join(", ") || "all equal"}; ${a.cur})`, same(a, snapOf(api)).length === 0);
      }
    }
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [6] Read flow
  console.log("\n[6] Read passage flow and the Today Read stage");
  try {
    const p = PASSAGES.find(x => x.lv === "1" && x.questions.length >= 2);
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 17 }, st));
      api.clickTab("read"); api.startPassage(p);
      const reading = api.html("panel");
      ({ api } = await boot(Object.assign({ seed: 18 }, st)));
      check(`reload while reading "${p.id}": the passage screen with Done reading`, api.tab() === "read" && api.html("panel") === reading && /id="rdone"/.test(reading));
      api.el("rdone").click();
      ({ api } = await boot(Object.assign({ seed: 19 }, st)));
      check("reload right after Done reading: question 1", api.rd() && api.rd().qi === 0 && /Question 1 \//.test(api.html("panel")));
      const o1 = readOpts(api);
      api.el("o").children[0].click(); api.el("nx").click();
      const order2 = readOpts(api), ans = JSON.stringify(api.rd().answers);
      api.rd().tapped.push(p.sentences[0].words[0]);
      api.clickTab("today");
      check("leaving Read mid-question keeps the passage (Today renders)", /id="go"/.test(api.html("panel")));
      ({ api } = await boot(Object.assign({ seed: 20 }, st)));
      check(`reload mid-question: Read tab, question 2 unanswered, same option order (${order2}), answers and tapped words kept`,
        api.tab() === "read" && api.rd().qi === 1 && readOpts(api) === order2 && JSON.stringify(api.rd().answers) === ans && api.rd().tapped.includes(p.sentences[0].words[0]) && o1.length > 0);
      for(let i = 1; i < p.questions.length; i++){ api.el("o").children[0].click(); api.el("nx").click(); }
      const res = api.html("panel");
      ({ api } = await boot(Object.assign({ seed: 21 }, st)));
      check("reload on the results screen: the same results, passage recorded once", api.html("panel") === res && api.getProg().read.done[p.id] && /id="rlist"/.test(res));
      api.el("rlist").click();
      check("Back to passages ends the session", !st.ss.getItem(SKEY) && !api.rd());
    }
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 22 }, st));
      api.todayAt(5);
      check("Today Read stage started (stage 5)", api.rd() && api.rd().today && api.tss().at === 5);
      api.el("rdone").click();
      const q1 = api.html("panel");
      api.clickTab("words"); api.clickTab("today");
      check("Today Read stage: a tab switch and back returns to question 1 of the same passage", api.rd() && api.rd().today && api.rd().p.id && api.html("panel") === q1 && api.tss().step === 6);
      ({ api } = await boot(Object.assign({ seed: 23 }, st)));
      check("Today Read stage: reload returns to question 1", api.rd() && api.rd().today && api.html("panel") === q1);
      for(let i = 0; i < api.rd().p.questions.length; i++){ api.el("o").children[0].click(); api.el("nx").click(); }
      api.el("rcont").click();
      check("Today Read stage: Continue after the reload finishes the Today session", /Session done/.test(api.html("panel")) && !st.ss.getItem(SKEY));
    }
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [7] storage shape
  console.log("\n[7] storage: progress key untouched, one new sessionStorage key");
  try {
    const st = fresh();
    const { api } = await boot(Object.assign({ seed: 24 }, st));
    api.el("go").click(); play(api, [true, false, true]);
    const p = JSON.parse(st.ls.getItem(KEY));
    check(`localStorage holds only the progress key (${st.ls.keys().join(", ")}); sessionStorage only ${SKEY} (${st.ss.keys().join(", ")})`,
      st.ls.keys().join() === KEY && st.ss.keys().join() === SKEY);
    const base = Object.keys(VC.normalizeProg(seedPF(), PACK));
    check(`progress keeps its top-level shape, no session fields (${Object.keys(p).sort().join(", ")}; read comes from the Read unlocks as before)`, Object.keys(p).every(k => base.includes(k) || k === "read"));
    const r = sess(st.ss);
    check("record shape: v, build, t, fp, tab, today, drill (o, cur, ord, q, right, seen, miss)", JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["build", "drill", "fp", "t", "tab", "today", "v"]) && JSON.stringify(Object.keys(r.drill).sort()) === JSON.stringify(["cur", "miss", "o", "ord", "q", "right", "seen"]));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
