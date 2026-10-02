// Checks for session resume (docs/PACK_SCHEMA.md "Session resume"): [1] core.js sessionKey /
// sessionHash / sessionStale rules, [2] a page reload mid-drill (Today Review on zh, typed and
// choice items) comes back at the same item with the same options in the same order, the same
// queue (keys, kinds, labels) and counts, and the Today session carries on to the next stage,
// [3] an app-tab switch and back resumes; tapping the open tab ends the drill, [4] stale
// records (other build, over 12 h, progress changed) are dropped silently and no answer is
// lost, [5] Test and Words-tab set drills, a typed item's choice counterpart, [6] the Read
// passage flow (Done reading, a question mid-flow, tapped words) and the Today Read stage,
// [7] the progress key is untouched (only vocab_<pack>_session is added, in sessionStorage),
// [8] the build id is known at boot (built page), [9] record size (draws kept as results,
// misses as recipes), [10] a results screen survives voiceschanged and render() ends it,
// [11] a hear item resumed before the language's voice is listed becomes a hear item when it is,
// [12] every way out and back in (fb2-ui): a new browsing context (home-screen relaunch,
// reopened tab: localStorage only), page hidden and shown again, a drill in each tab origin
// parked while another tab runs its own, tab re-tap / Escape / ‹ passages then Resume, the
// progress fingerprint across answer writes and housekeeping saves, a second tab, import.
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
    insertBefore(c){ this._children.unshift(c); return c; }
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
  appHtml = o.html || CUR_HTML;
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
  html: id => { const e = document.getElementById(id); return e ? e.innerHTML : null; },
  el: id => document.getElementById(id),
  getProg: () => prog, getD: () => D, getCur: () => __cur, tab: () => tab, rd: () => RD, tss: () => todayStepState,
  clickTab: t => document.querySelectorAll('#tabs button[data-t="' + t + '"]')[0].click(),
  startPassage: p => { startPassage(p); },
  todayAt: s => { todayStepState = { step: s }; todayStep(); },
  build: () => sessionBuild(), render: () => render(), key: k => (document._listeners.keydown || []).forEach(f => f({ key: k, preventDefault(){}, target: null })),
  hide: () => (document._listeners.visibilitychange || []).forEach(f => { document.visibilityState = "hidden"; f(); }),
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","sessionStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"SessionResumeChecks/1.0" }, undefined, o.ls, o.ss, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ return { play(){ return Promise.resolve(); }, pause(){} }; }, () => true, () => {}, PACK, WORDS, SENTENCES, LESSONS, PASSAGES, CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return { api, spoken, ss, voices, document };
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
// Runs Today to "Session done": every drill answered right, Continue, the Read stage skipped.
function finishTodayAll(api){
  for(let i = 0; i < 40 && !/Session done/.test(api.html("panel")); i++){
    if(api.getD()) finishDrill(api);
    const h = api.html("panel");
    if(/id="ok"/.test(h)) api.el("ok").click();
    else if(/id="rskip"/.test(h)) api.el("rskip").click();
    else if(/id="dr"/.test(h)) api.el("dr").click();
    else if(/id="rcont"/.test(h)) api.el("rcont").click();
  }
}
function finishDrill(api){ for(let i = 0; i < 200 && api.getD(); i++){ answer(api, true); api.el("nx").click(); } }

(async function main(){
  // ---------------------------------------------------------------- [1] core rules
  console.log("\n[1] core.js: key, fingerprint, staleness");
  // Every app check below runs with the day-aware planner on (its drills write prog.day / sn / u).
  check("zh pack runs with dayAware on", PACK.dayAware === true);
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
    const rec = sess(st.ls);
    check(`session recorded in localStorage under ${SKEY}, not in sessionStorage (items: ${rec && rec.drill.q.length}; kinds in drill: ${[...kinds].join(", ")})`, !!rec && rec.tab === "today" && !!rec.drill && st.ss.getItem(SKEY) === null);
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
    const c = snapOf(api);
    api.clickTab("today");
    check("tapping the open tab leaves the drill: Today start screen, its button resumes, the record is kept", !api.getD() && /id="go"/.test(api.html("panel")) && api.el("go").textContent === "Resume today" && !!st.ls.getItem(SKEY));
    api.el("go").click();
    check(`"Resume today" returns to the same item (${same(c, snapOf(api)).join(", ") || "all equal"})`, same(c, snapOf(api)).length === 0);
    api.clickTab("today"); api.clickTab("words"); api.clickTab("today");
    check("and a later switch back resumes it too", same(c, snapOf(api)).length === 0);
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
      const r = sess(st.ls); if(edit){ edit(r); st.ls.setItem(SKEY, JSON.stringify(r)); }
      if(editLs) editLs(st.ls);
      ({ api } = await boot(Object.assign({ seed: 6 }, st)));
      const kept = JSON.parse(editLs ? st.ls.getItem(KEY) : stored);
      check(`${name}: reload shows the Today start screen, the record is removed, the two answers stay recorded`,
        !api.getD() && /id="go"/.test(api.html("panel")) && !st.ls.getItem(SKEY) && JSON.stringify(api.getProg().w) === JSON.stringify(VC.normalizeProg(kept, PACK).w) && Object.keys(api.getProg().w).length > 0);
    }
    {
      const st = fresh();
      const { api } = await boot(Object.assign({ seed: 5 }, st));
      api.el("go").click(); play(api, [true]);
      api.clickTab("progress");
      api.getProg().sessions += 1;
      api.clickTab("today");
      check("in the open page: progress this page changed while away keeps the record (its own work)", !!api.getD() && !!st.ls.getItem(SKEY));
    }
    {
      const st = fresh(); st.ls.setItem(SKEY, "{not json");
      const { api } = await boot(Object.assign({ seed: 5 }, st));
      check("an unreadable record: normal boot, record removed", /id="go"/.test(api.html("panel")) && !st.ls.getItem(SKEY));
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
      check("Test Recall: Continue after the reload returns to the Test screen", /Placement finds where to start/.test(api.html("panel")) && !st.ls.getItem(SKEY));
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
      check("reload after leaving for Today: the Today home (what was on screen)", api.tab() === "today" && !api.rd() && /id="go"/.test(api.html("panel")));
      api.clickTab("read");
      check(`then the Read tab: Read tab, question 2 unanswered, same option order (${order2}), answers and tapped words kept`,
        api.tab() === "read" && api.rd().qi === 1 && readOpts(api) === order2 && JSON.stringify(api.rd().answers) === ans && api.rd().tapped.includes(p.sentences[0].words[0]) && o1.length > 0);
      for(let i = 1; i < p.questions.length; i++){ api.el("o").children[0].click(); api.el("nx").click(); }
      const res = api.html("panel");
      ({ api } = await boot(Object.assign({ seed: 21 }, st)));
      check("reload on the results screen: the same results, passage recorded once", api.html("panel") === res && api.getProg().read.done[p.id] && /id="rlist"/.test(res));
      api.el("rlist").click();
      check("Back to passages ends the session", !st.ls.getItem(SKEY) && !api.rd());
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
      check("Today Read stage: Continue after the reload finishes the Today session", /Session done/.test(api.html("panel")) && !st.ls.getItem(SKEY));
    }
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [7] storage shape
  console.log("\n[7] storage: progress key untouched, the session key in localStorage");
  try {
    const st = fresh();
    const { api } = await boot(Object.assign({ seed: 24 }, st));
    api.el("go").click(); play(api, [true, false, true]);
    const p = JSON.parse(st.ls.getItem(KEY));
    check(`localStorage holds only the progress key and ${SKEY} (${st.ls.keys().join(", ")}); sessionStorage nothing (${st.ss.keys().join(", ")})`,
      st.ls.keys().sort().join() === [KEY, SKEY].sort().join() && st.ss.keys().length === 0);
    const base = Object.keys(VC.normalizeProg(seedPF(), PACK));
    check(`progress keeps its top-level shape, no session fields (${Object.keys(p).sort().join(", ")}; read comes from the Read unlocks as before, day and sn from dayAware)`, Object.keys(p).every(k => base.includes(k) || k === "read" || k === "day" || k === "sn"));
    const r = sess(st.ls);
    check("record shape: v, build, t, fp, tab, today, drill (o, cur, ord, q, right, seen, miss), plus the stored value's view { tab, live }", JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["build", "drill", "fp", "t", "tab", "today", "v", "view"]) && JSON.stringify(r.view) === '{"tab":"today","live":true}' && JSON.stringify(Object.keys(r.drill).sort()) === JSON.stringify(["cur", "miss", "o", "ord", "q", "right", "seen"]));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [8] build id
  console.log("\n[8] build id: known while the page parses");
  try {
    const dist = fs.readFileSync(path.join(ROOT, "dist", "zh.html"), "utf8");
    const id = (dist.match(/const VE_BUILD = "([^"]*)"/) || [])[1];
    const tail = (dist.match(/<!--ve-build:([^>]*)-->\s*$/) || [])[1];
    check(`dist/zh.html carries a real VE_BUILD (${id}) and its trailing marker`, !!id && !/^__VE_/.test(id) && !!tail);
    const st = fresh();
    let { api } = await boot(Object.assign({ seed: 30, html: dist }, st));
    check(`built page, no DOM marker yet (boot-time resume): sessionBuild() is "${id}:<pack fp>" (got ${api.build()})`, api.build().startsWith(id + ":") && !api.build().startsWith("dev:"));
    api.el("go").click(); play(api, [true]);
    const a = snapOf(api);
    check("built page: the saved record carries that id", sess(st.ls).build === api.build());
    ({ api } = await boot(Object.assign({ seed: 31, html: dist }, st)));
    check(`built page: a reload resumes the session (${same(a, snapOf(api)).join(", ") || "all equal"})`, same(a, snapOf(api)).length === 0);
    const other = dist.replace(`const VE_BUILD = "${id}"`, 'const VE_BUILD = "1-2"');
    ({ api } = await boot(Object.assign({ seed: 32, html: other }, st)));
    check("an engine-only rebuild (another VE_BUILD, same pack) drops the old session", !api.getD() && !st.ls.getItem(SKEY));
    const dev = await boot(Object.assign({ seed: 33 }, fresh()));
    check(`dev mode (no VE_BUILD, no marker): "dev:<pack fp>" (got ${dev.api.build()})`, /^dev:/.test(dev.api.build()));
    const marked = await boot(Object.assign({ seed: 34, mark: "ve-build:123-456" }, fresh()));
    check(`no VE_BUILD but the trailing marker: read lazily (got ${marked.api.build()})`, /^123-456:/.test(marked.api.build()));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [9] record size
  console.log("\n[9] record size: draws kept as results, misses as recipes");
  try {
    for(const [btn, name] of [["tListen", "Listen"], ["tRecall", "Recall"], ["tSentences", "Sentences"]]){
      const st = fresh();
      const { api } = await boot(Object.assign({ seed: 40 }, st));
      api.clickTab("test"); api.el(btn).click();
      let max = 0, n = 0; const missed = new Set();
      for(let i = 0; i < 300 && api.getD(); i++){
        const v = st.ls.getItem(SKEY); if(v) max = Math.max(max, v.length);
        const it = api.getCur(), first = !missed.has(it.key); missed.add(it.key);
        answer(api, !first && it.kind !== "type" ? true : false); api.el("nx").click(); n++;
        if(i === 5){
          const b = snapOf(api), re = await boot(Object.assign({ seed: 41 }, st));
          check(`Test ${name}: reload mid-way with misses and replayed items (${same(b, snapOf(re.api)).join(", ") || "all equal"})`, same(b, snapOf(re.api)).length === 0);
          Object.assign(api, re.api);
        }
      }
      check(`Test ${name}: largest record over ${n} answers (every item missed once) is under 20 KB (${(max / 1024).toFixed(1)} KB)`, max > 0 && max < 20 * 1024);
    }
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [10] results screen
  console.log("\n[10] results screen: voiceschanged leaves it, render() ends it");
  try {
    const st = fresh();
    const b = await boot(Object.assign({ seed: 50 }, st));
    const api = b.api;
    api.clickTab("test"); api.el("tRecall").click(); finishDrill(api);
    check("finished drill: results screen, its record saved", /id="ok"/.test(api.html("panel")) && !!sess(st.ls));
    b.voices.splice(0, 1, { lang: "en-US", name: "e" }); b.ss.onvoiceschanged(); b.voices.splice(0, 1, { lang: "zh-CN", name: "x" }); b.ss.onvoiceschanged();
    check("voiceschanged twice on the results screen: the results stay", /id="ok"/.test(api.html("panel")));
    api.render(); api.hide();
    check("render() over a results screen drops the finished drill's record (pagehide saves nothing)", !st.ls.getItem(SKEY));
    const re = await boot(Object.assign({ seed: 51 }, st));
    check("a reload then shows the Test screen, not the old results", !re.api.getD() && !/id="ok"/.test(re.api.html("panel")));
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [11] voices after boot
  console.log("\n[11] a hear item resumed before the voices load");
  try {
    const st = fresh();
    let { api } = await boot(Object.assign({ seed: 60 }, st));
    api.clickTab("test"); api.el("tListen").click(); play(api, [true, false]);
    const a = snapOf(api), cur = api.getCur();
    check("Test Listen: a hear item on screen", cur.html.includes("hear-stage") && !cur.needsNotice);
    // Chrome can list other voices first and the pack's language later (an empty list counts
    // as usable, so the case is a list without the language).
    const b = await boot(Object.assign({ seed: 61, voices: [{ lang: "en-US", name: "e" }] }, st));
    api = b.api;
    const c0 = api.getCur();
    check("reload before Chrome lists the language's voice: the item comes back as read with the no-voice notice, same options", c0.needsNotice === true && c0.key === cur.key && optsShown(api) === a.opts);
    b.voices.push({ lang: "zh-CN", name: "x" }); b.spoken.length = 0; b.ss.onvoiceschanged();
    const c1 = api.getCur(), D = api.getD();
    check(`voices arrive: the item on screen is a hear item again, same key and option order, and it plays (${b.spoken.length} spoken)`, c1 !== c0 && c1.key === cur.key && c1.html.includes("hear-stage") && !c1.needsNotice && optsShown(api) === a.opts && b.spoken.length > 0);
    check("voices arrive: no queued item keeps the notice; queue keys and counts unchanged", D.q.every(it => !it.needsNotice) && queueSig(api) === a.queue && D.seen === a.seen);
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  // ---------------------------------------------------------------- [12] every exit/return path
  console.log("\n[12] every way out and back in");
  try {
    const rzRow = api => { const r = api.el("panel").children[0]; const m = r && /id="rzgo"[^>]*>([^<]*)</.exec(r.innerHTML); return m ? m[1] : null; };
    const fpOk = st => { const v = st.ls.getItem(SKEY); if(!v) return true; const top = JSON.parse(v), h = VC.sessionHash(st.ls.getItem(KEY));
      return [top, ...Object.values(top.park || {})].every(r => r.fp === h); };
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 40 }, st));
      api.el("go").click(); play(api, [true, false]);
      const a = snapOf(api);
      ({ api } = await boot({ seed: 41, ls: st.ls, ss: memStore() }));
      check(`new browsing context (home-screen relaunch, reopened tab: empty sessionStorage): same item (${same(a, snapOf(api)).join(", ") || "all equal"})`, same(a, snapOf(api)).length === 0);
      ({ api } = await boot({ seed: 42, ls: st.ls, ss: undefined }));
      check("no sessionStorage at all: still resumes", same(a, snapOf(api)).length === 0);
      api.hide();
      check("page hidden then shown again (app switch, bfcache restore): page state untouched, record saved", same(a, snapOf(api)).length === 0 && sess(st.ls).tab === "today");
    }
    {
      const st = fresh();
      const { api } = await boot(Object.assign({ seed: 43 }, st));
      api.el("go").click(); play(api, [true]);
      const today = snapOf(api);
      api.clickTab("test"); api.el("tRecall").click(); play(api, [true, false]);
      const test = snapOf(api);
      api.clickTab("words"); api.el("nx").click(); api.el("dr").click(); play(api, [true]);
      const words = snapOf(api);
      api.clickTab("read"); api.startPassage(PASSAGES.find(x => x.lv === "1")); api.el("rdone").click();
      const read = api.html("panel");
      check("four sessions parked at once, one record per tab", (() => { const t = sess(st.ls); return ["today", "test", "words", "read"].every(k => t.tab === k || (t.park && t.park[k])); })());
      check("every record's fingerprint is the stored progress after the answer writes", fpOk(st));
      api.clickTab("today");
      check(`Today drill resumes after Test, Words and Read drills ran in between (${same(today, snapOf(api)).join(", ") || "all equal"})`, same(today, snapOf(api)).length === 0);
      api.clickTab("test");
      check(`Test drill resumes (${same(test, snapOf(api)).join(", ") || "all equal"})`, same(test, snapOf(api)).length === 0);
      api.clickTab("words");
      check(`Words set drill resumes (${same(words, snapOf(api)).join(", ") || "all equal"})`, same(words, snapOf(api)).length === 0);
      api.clickTab("read");
      check("Read passage resumes at question 1", api.html("panel") === read);
      api.clickTab("progress"); api.clickTab("today"); answer(api, true); api.el("nx").click();
      check("an answer in Today keeps the parked records valid", fpOk(st));
      const t2 = snapOf(api);
      let b = await boot({ seed: 44, ls: st.ls, ss: memStore() });
      check("reload: the latest session (Today) comes back", same(t2, snapOf(b.api)).length === 0);
      b.api.clickTab("test");
      check(`reload, then the Test tab: its parked drill resumes (${same(test, snapOf(b.api)).join(", ") || "all equal"})`, same(test, snapOf(b.api)).length === 0);
    }
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 45 }, st));
      api.clickTab("test"); api.el("tRecall").click(); play(api, [true]);
      const a = snapOf(api);
      api.clickTab("test");
      check("Test tab re-tapped mid-drill: Test home with Resume drill", !api.getD() && /Placement finds where to start/.test(api.html("panel")) && rzRow(api) === "Resume drill");
      api.el("rzgo").click();
      check(`Resume drill: same item (${same(a, snapOf(api)).join(", ") || "all equal"})`, same(a, snapOf(api)).length === 0);
      api.key("Escape");
      check("Escape mid-drill: Test home, record kept", !api.getD() && !!st.ls.getItem(SKEY));
      api.el("rzgo").click();
      check("Resume after Escape: same item", same(a, snapOf(api)).length === 0);
      api.clickTab("today"); api.el("go").click(); play(api, [true]);
      api.clickTab("today");
      check("Today re-tapped: Start reads Resume today", api.el("go").textContent === "Resume today");
      api.clickTab("read"); api.startPassage(PASSAGES.find(x => x.lv === "1"));
      const reading = api.html("panel");
      api.el("rback").click();
      check("‹ passages mid-passage: passage list with Resume passage", !api.rd() && rzRow(api) === "Resume passage");
      api.el("rzgo").click();
      check("Resume passage: the same passage screen", api.html("panel") === reading);
    }
    {
      // Housekeeping at load: the stored string differs from its normalized form (boot fixes
      // it up, e.g. after a day rollover), and a render-time save (Read unlocks) follows.
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 50 }, st));
      api.el("go").click(); play(api, [true, false]); api.clickTab("words");
      const a = (api.clickTab("today"), snapOf(api));
      const raw = JSON.stringify(Object.assign({}, JSON.parse(st.ls.getItem(KEY)), { read: undefined }), null, 1);
      st.ls.setItem(KEY, raw);
      const top = sess(st.ls); [top, ...Object.values(top.park || {})].forEach(r => { r.fp = VC.sessionHash(raw); }); st.ls.setItem(SKEY, JSON.stringify(top));
      ({ api } = await boot({ seed: 51, ls: st.ls, ss: memStore() }));
      check(`stored progress normalized at boot (fingerprint of the raw string): resumes (${same(a, snapOf(api)).join(", ") || "all equal"})`, same(a, snapOf(api)).length === 0);
      api.clickTab("read"); api.clickTab("today");
      check("a housekeeping save while away (Read unlocks): back on Today resumes, fingerprints follow the stored progress", same(a, snapOf(api)).length === 0 && fpOk(st));
      ({ api } = await boot({ seed: 52, ls: st.ls, ss: memStore() }));
      check("and a reload after it resumes too", same(a, snapOf(api)).length === 0);
    }
    {
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 46 }, st));
      api.el("go").click(); play(api, [true]);
      const a = snapOf(api);
      const two = await boot({ seed: 47, ls: st.ls, ss: memStore() });
      check("a second tab opens on the same item", same(a, snapOf(two.api)).length === 0);
      answer(two.api, true); two.api.el("nx").click();
      const b2 = snapOf(two.api);
      answer(api, true); api.el("nx").click(); answer(api, false); api.el("nx").click();
      const b1 = snapOf(api);
      ({ api } = await boot({ seed: 48, ls: st.ls, ss: memStore() }));
      check("two tabs answering: no crash, the last writer's item comes back on reload", same(b1, snapOf(api)).length === 0 && b2.seen > 0);
    }
    {
      // Boot restores what was on screen: a session the learner left stays parked.
      const st = fresh();
      let { api } = await boot(Object.assign({ seed: 60 }, st));
      api.clickTab("test"); api.el("tRecall").click(); play(api, [true]);
      const t = snapOf(api);
      api.clickTab("test"); api.clickTab("today");
      ({ api } = await boot({ seed: 61, ls: st.ls, ss: memStore() }));
      check("Test drill left by a re-tap, then the Today home, reload: the Today home, not the Test drill", api.tab() === "today" && !api.getD() && /id="go"/.test(api.html("panel")));
      api.clickTab("test");
      check(`and the Test tab still resumes it (${same(t, snapOf(api)).join(", ") || "all equal"})`, same(t, snapOf(api)).length === 0);
      api.clickTab("test"); api.clickTab("words");
      ({ api } = await boot({ seed: 62, ls: st.ls, ss: memStore() }));
      check("left for the Words home, reload: the Words home", api.tab() === "words" && !api.getD() && /Drill this set/.test(api.html("wbody")));
      api.clickTab("today"); api.el("go").click(); finishTodayAll(api);
      check("Today run to the end (Session done) with the Test drill parked", /Session done/.test(api.html("panel")));
      ({ api } = await boot({ seed: 63, ls: st.ls, ss: memStore() }));
      check("relaunch after Today is done: the Today home, not the parked Test drill", api.tab() === "today" && !api.getD() && /id="go"/.test(api.html("panel")));
      api.clickTab("test"); api.key("Escape");
      ({ api } = await boot({ seed: 64, ls: st.ls, ss: memStore() }));
      check("Escape out of the drill, reload: the Test home with Resume drill", api.tab() === "test" && !api.getD() && rzRow(api) === "Resume drill");
      api.clickTab("read"); api.startPassage(PASSAGES.find(x => x.lv === "1")); api.el("rback").click();
      ({ api } = await boot({ seed: 65, ls: st.ls, ss: memStore() }));
      check("‹ passages, reload: the passage list with Resume passage", api.tab() === "read" && !api.rd() && rzRow(api) === "Resume passage");
      api.clickTab("test"); api.el("rzgo").click(); play(api, [true]);
      const t2 = snapOf(api);
      ({ api } = await boot({ seed: 66, ls: st.ls, ss: memStore() }));
      check(`drill on screen, reload: the same item (${same(t2, snapOf(api)).join(", ") || "all equal"})`, same(t2, snapOf(api)).length === 0);
    }
    {
      // A finished drill or passage ends on a re-tap of its tab.
      const st = fresh();
      const { api } = await boot(Object.assign({ seed: 67 }, st));
      api.clickTab("test"); api.el("tRecall").click(); finishDrill(api);
      check("Test drill finished: results screen", /id="ok"/.test(api.html("panel")));
      api.clickTab("test");
      check("re-tap on the results: Test home, no Resume drill, record gone", !rzRow(api) && !(sess(st.ls) && (sess(st.ls).tab === "test" || (sess(st.ls).park || {}).test)));
      const p = PASSAGES.find(x => x.lv === "1");
      api.clickTab("read"); api.startPassage(p); api.el("rdone").click();
      for(let i = 0; i < p.questions.length; i++){ api.el("o").children[0].click(); api.el("nx").click(); }
      check("Read passage finished: results screen", /id="rlist"/.test(api.html("panel")));
      api.clickTab("read");
      check("re-tap on the Read results: passage list, no Resume passage, record gone", !api.rd() && !rzRow(api) && !st.ls.getItem(SKEY));
      api.clickTab("today"); api.el("go").click(); finishDrill(api);
      api.clickTab("today");
      check("re-tap on a Today drill's results: Today keeps its session (Resume today)", api.el("go").textContent === "Resume today");
    }
    {
      const st = fresh();
      const { api } = await boot(Object.assign({ seed: 49 }, st));
      api.el("go").click(); play(api, [true]);
      api.clickTab("progress");
      api.el("imptxt").value = JSON.stringify(seedPF()); api.el("doimport").click(); await tick(); await tick();
      check("import ran through the Progress tab's own path (pre-import backup written)", !!st.ls.getItem(KEY + "_pre_import_backup"));
      api.clickTab("today");
      check("import: every parked session is dropped", !api.getD() && !st.ls.getItem(SKEY) && /id="go"/.test(api.html("panel")) && api.el("go").textContent !== "Resume today");
    }
  } catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
