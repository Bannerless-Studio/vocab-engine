// Checks for branch engine-listen-mode (docs/PACK_SCHEMA.md "passages.json", Listening
// pass): VC.readPassMode / VC.listenAudioOnly / markPassageDone's l:1 in core.js, and in
// app.html the Today plan row, the listening passage screen (hidden text, play rows, Play
// all, Show text), audio-only questions behind "Show question", the results lines, and a
// no-voice/no-clip control whose markup is byte-identical to the base branch
// (engine-passage-audio, pinned sha BASE). Fake-DOM boot copied from tests/passage_audio_checks.js.
// Run: node tests/listen_mode_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
// typedFrom/glossFocus/helpClose/readAnswerBlock postdate the pinned control shas and change markup;
// this suite is about listening, so it runs the zh pack with them off.
// dayAware (docs/PACK_SCHEMA.md) post-dates the pinned controls and is not what this suite checks.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK_DAY = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), "34c5df3", { strip: [] });
// fb2-write (2026-10-02) split zh's characters stage per level and added characters.bareBy/bareWords/withWords;
// checks written against the earlier zh keep its shape (tests/typed_mastery_checks.js covers the new one).
const preWrite = p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; delete c.withWords; delete c.learn; return Object.assign({}, p, { characters: c }); };
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = packAsOf(preWrite(loadConst(path.join(ZH, "pack.js"), "PACK")), "34c5df3", { strip: ["typedFrom", "optsOneScript", "progressMap"] });
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
// words[].syn / typedSyn / noTypedMeaning / pronInGloss (docs/PACK_SCHEMA.md "Synonyms") are flag-on fields.
const WORDS_OFF = WORDS.map(w => { const c = Object.assign({}, w); delete c.syn; delete c.typedSyn; delete c.noTypedMeaning; delete c.pronInGloss; return c; });
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const CHARACTERS = loadConst(path.join(ZH, "characters.js"), "CHARACTERS");
// [6] control baseline, pinned like pron_aids_checks.js MAIN: engine-passage-audio at
// ea5dcbc (its fix round, merged into this branch), the engine before listen mode.
const BASE = "ea5dcbc";
// [8] with-voice control for the no-voice planner (owner decision 2026-09-30, branch
// engine-w7): main before it.
const BASE_W7 = "4303f59";
// [12] flag-off control for pack.listenQuestions: main before fb12-listen-all.
const BASE_LQ = "7a21ccd";
// [13] flag-off control for pack.rereadPerfectDays (incl. the first listening pass): main before fb14-first-listen.
const BASE_RP = "3790814";
// [14] flag-off control for pack.readRotation: main before fb16-read-rotation.
const BASE_RR = "491d470";
// [15] flag-off control for the listening look-back: main before fb19-listen-lookback.
const BASE_LB = "a8e9c08";

let fails = 0, passes = 0;
function check(name, cond, detail){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

// ------------------------------------------------------------------ fake DOM (copied from pron_aids_checks.js)
let appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEFER = VC.TTS_TIMING.deferMs + 30;
function mulberry32(a){ return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// opts: voices (default a zh-CN voice), passages, html (app.html source, default the
// working tree's). utts: every utterance
// handed to speechSynthesis.speak; audio: the one shared Audio element (clips), plays: srcs.
async function boot(opts){
  const o = opts || {};
  const src = o.html || appHtml;
  const document = makeFakeDom(o.html);
  const spoken = [], utts = [], plays = [];
  let audio = null;
  const ss = {
    speaking: false, pending: false,
    getVoices: () => o.voices !== undefined ? o.voices : [{ lang: "zh-CN", name: "x" }],
    onvoiceschanged: null,
    cancels: 0,
    cancel(){ ss.cancels++; ss.speaking = false; ss.pending = false; },
    speak(u){ spoken.push(u.text); utts.push(u); ss.speaking = true; },
  };
  if(o.ssHook) o.ssHook(ss, spoken, utts);
  const window = { VocabCore: o.vc || VC, speechSynthesis: ss, SpeechSynthesisUtterance: function(t){ this.text = t; }, addEventListener(){} };
  const localStorage = { getItem(){ return null; }, setItem(){} };
  const fnBody = scriptOf(src) + `
return {
  html: id => { const e = document.getElementById(id); return e ? e.innerHTML : null; },
  el: id => document.getElementById(id),
  setProg: p => { prog = p; }, getProg: () => prog,
  startPassage: (p, today, mode) => { tab = today ? "today" : "read"; startPassage(p, today, mode); },
  today: () => { tab = "today"; render(); },
  enterTodayStep: (step, read) => { tab = "today"; todayStepState = read === undefined ? { step } : { step, read }; todayStep(); },
  rd: () => RD,
  rerender: () => render(),
  dq: () => D ? D.q.map(it => [it.key, it.kind, it.label, !!it.needsNotice, /id="sp"/.test(it.html || "")]) : null,
  testTab: () => { tab = "test"; testSel = null; render(); },
  cur: () => D && D.cur ? D.cur : null,
};`;
  const names = ["SpeechSynthesisUtterance","document","window","navigator","location","localStorage","matchMedia","requestAnimationFrame","Audio","confirm","alert","PACK","WORDS","SENTENCES","LESSONS","PASSAGES","CHARACTERS"];
  const args = [window.SpeechSynthesisUtterance, document, window, { userAgent:"ListenModeChecks/1.0" }, undefined, localStorage, () => ({ matches:false }), fn => setTimeout(fn, 0),
    function(){ audio = { onended: null, onerror: null, play(){ plays.push(this.src); return Promise.resolve(); }, pause(){} }; return audio; }, () => true, () => {}, o.pack || PACK, o.words || WORDS, SENTENCES, LESSONS, o.passages || PASSAGES, CHARACTERS];
  const api = new Function(...names, fnBody)(...args);
  await tick(); await tick();
  return { api, document, spoken, utts, plays, ss, audio: () => audio };
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const daysAgo = n => { const t = new Date(); return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n)); };
// Every passage done 8 days ago with full marks except passage `missed` (a spaced re-read).
function rereadProg(passages, missed, extra){
  const pr = VC.normalizeProg({ sets: {}, placedOnce: true, sessions: 5 }, PACK);
  pr.read = { unlocked: Object.fromEntries(PACK.levels.map(l => [l.id, 1])),
    done: Object.fromEntries(passages.map(p => [p.id, { sc: p.questions.length, n: p.questions.length, d: daysAgo(8), x: 1 }])) };
  pr.read.done[missed.id].sc = 0;
  // read rotation (default since the flag collapse): every passage read and listened to in session 3, the missed one read
  // again in session 4, so session 6 (sn 5 + 1) owes it a listening pass; extra.l = that listening pass already made
  pr.sn = 5;
  passages.forEach(p => Object.assign(pr.read.done[p.id], { s: 3, ls: 3 }));
  Object.assign(pr.read.done[missed.id], { s: 4 }, extra || {});
  delete pr.read.done[missed.id].ls; // never listened to: the rotation's first listening pick
  if(pr.read.done[missed.id].l) pr.read.done[missed.id].ls = 4;
  return pr;
}
// App v2 Today: the passage row follows Sentences, <div class="tst"><span>Read|Listen</span><div class="tsd">title</div></div>.
const planRow0 = (h, label) => (h.match(new RegExp(`<div class="tst"><span>${label}<\\/span><div class="tsd">([\\s\\S]*?)<\\/div><\\/div>`)) || [])[1];
const planRow = (h, label) => { const rows = [...h.matchAll(/<div class="tst"><span>([^<]*)<\/span><div class="tsd">([\s\S]*?)<\/div><\/div>/g)], i = rows.findIndex(r => r[1] === "Sentences"), r = i >= 0 ? rows[i + 1] : null; return r && r[1] === label ? r[2] : undefined; };
const answerAll = (api, p, wrong) => {
  for(let qi = api.rd().qi; qi < p.questions.length; qi++){
    const q = api.rd().p.questions[qi], os = api.el("o").children; // the pass's question order (passageForPass)
    (wrong ? os.find(b => b.dataset.v !== String(q.answer)) : os.find(b => b.dataset.v === String(q.answer))).click();
    api.el("nx").click();
  }
};
const fire = (ss, u) => { ss.speaking = false; u.onend({}); };

(async function main(){
  const P = PASSAGES[5];
  console.log("\n[1] core: readPassMode, listenAudioOnly, markPassageDone l:1, progress shape");
  {
    const pr = rereadProg(PASSAGES, P);
    const rr = { p: P, reason: "reread", mode: "listen" }, nw = { p: P, reason: "new", mode: "read" };
    check("a reading pick (reason new) is a reading pass even when listening is possible", VC.readPassMode(nw, pr, true) === "read");
    check("the rotation's listening pick + canListen -> listen", VC.readPassMode(rr, pr, true) === "listen");
    check("the rotation's listening pick without canListen -> read", VC.readPassMode(rr, pr, false) === "read");
    check("null item -> read", VC.readPassMode(null, pr, true) === "read");
    const it = VC.nextReadItem(PASSAGES, WORDS, PACK, pr, daysAgo(0), false, undefined, undefined, () => true) || {};
    check("nextReadItem: after a reading pass the rotation owes a listening pass of it (reason reread, mode listen)", it.p === P && it.reason === "reread" && it.mode === "listen");
    check("listenAudioOnly: every question audio-only (listenQuestions all, default): n=5 -> 0..4, n=1 -> [0], n=0 -> []",
      JSON.stringify(VC.listenAudioOnly("p0006", 1, 5)) === "[0,1,2,3,4]" && JSON.stringify(VC.listenAudioOnly("x", 0, 1)) === "[0]" && VC.listenAudioOnly("x", 0, 0).length === 0);
    const q = VC.normalizeProg({}, PACK); q.sn = 7;
    const r1 = VC.markPassageDone(q, "p1", 2, 5, "2026-09-27", true);
    check("markPassageDone listen -> {sc,n,d,x,l:1,s,ls}", JSON.stringify(r1) === JSON.stringify({ sc:2, n:5, d:"2026-09-27", x:1, l:1, s:7, ls:7 }));
    q.sn = 8;
    const r2 = VC.markPassageDone(q, "p1", 3, 5, "2026-10-05");
    check("markPassageDone read after a listen -> l and ls kept, s moves on, x counts on", JSON.stringify(r2) === JSON.stringify({ sc:3, n:5, d:"2026-10-05", x:2, l:1, s:8, ls:7 }));
    check("validateProgShape accepts done.l:1 and a record without l", VC.validateProgShape({ read: { done: { a: { sc:1, n:2, d:"2026-01-01", x:1, l:1 }, b: { sc:1, n:2, d:"2026-01-01", x:1 } } } }, []).ok);
    check("validateProgShape rejects a non-number l", !VC.validateProgShape({ read: { done: { a: { sc:1, n:2, l:"yes" } } } }, []).ok);
  }

  console.log("\n[2] Today: Listen row for a listenable re-read, Read row otherwise");
  try{
    const b = await boot();
    b.api.setProg(rereadProg(PASSAGES, P)); b.api.today();
    const lrow = planRow(b.api.html("panel"), "Listen");
    check(`voice usable: the passage row "Listen" names the passage (${lrow && lrow.replace(/<[^>]+>/g, "")})`, !!lrow && lrow.includes(VC.escapeHtml(P.title)) && !planRow(b.api.html("panel"), "Read"));
    b.api.enterTodayStep(5);
    check("step 5 runs it as a listening pass (RD.mode listen, Skip today present)", b.api.rd() && b.api.rd().mode === "listen" && b.api.rd().p.id === P.id && /id="rskip"/.test(b.api.html("panel")));
    const nv = await boot({ voices: [{ lang: "en-US", name: "en" }] });
    nv.api.setProg(rereadProg(PASSAGES, P)); nv.api.today();
    const rrow = planRow(nv.api.html("panel"), "Read");
    check("no voice, no clips: plain Read row", !!rrow && rrow.includes(VC.escapeHtml(P.title)) && !planRow(nv.api.html("panel"), "Listen"));
    nv.api.enterTodayStep(5);
    check("no voice, no clips: step 5 is a reading pass (no RD.mode)", nv.api.rd() && nv.api.rd().mode === undefined && /id="rdone">Done reading/.test(nv.api.html("panel")));
    const b2 = await boot();
    b2.api.setProg(rereadProg(PASSAGES, P, { l: 1 })); b2.api.today();
    check("voice usable but the last attempt was a listening pass: Read row", !!planRow(b2.api.html("panel"), "Read") && !planRow(b2.api.html("panel"), "Listen"));
    // The voice goes between the plan and step 5: re-checked, runs as a reading pass.
    const b3 = await boot({ voices: [{ lang: "en-US", name: "en" }] });
    b3.api.setProg(rereadProg(PASSAGES, P));
    b3.api.enterTodayStep(5, { p: P, reason: "reread", mode: "listen" });
    check("planned listen but no voice at step 5 (no clips): reading pass", b3.api.rd() && b3.api.rd().mode === undefined);
    // Clips on every sentence, no voice: listenable.
    const CP = JSON.parse(JSON.stringify(P)); CP.sentences.forEach((s, i) => { s.audio = `audio/p/${i}.mp3`; });
    const ps = PASSAGES.map(p => p.id === P.id ? CP : p);
    const c = await boot({ voices: [{ lang: "en-US", name: "en" }], passages: ps });
    c.api.setProg(rereadProg(ps, CP)); c.api.today();
    check("no voice but every sentence has a clip: Listen row", !!planRow(c.api.html("panel"), "Listen"));
    const HP = JSON.parse(JSON.stringify(CP)); delete HP.sentences[1].audio;
    const ps2 = PASSAGES.map(p => p.id === P.id ? HP : p);
    const c2 = await boot({ voices: [{ lang: "en-US", name: "en" }], passages: ps2 });
    c2.api.setProg(rereadProg(ps2, HP)); c2.api.today();
    check("no voice, one sentence without a clip: Read row", !!planRow(c2.api.html("panel"), "Read") && !planRow(c2.api.html("panel"), "Listen"));
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[3] listening passage screen: text hidden, n play rows, Show text logged");
  try{
    const b = await boot();
    b.api.setProg(rereadProg(PASSAGES, P));
    b.api.startPassage(P, true, "listen");
    // The fake DOM keeps markup on #panel only (ids are registered, children empty).
    const pbox = b.api.html("panel").split('id="pbox">')[1].split('<div class="actions">')[0], n = P.sentences.length;
    const rows = pbox.match(/<button type="button" class="ghost lsay" id="ls\d+" aria-label="Play sentence \d+">▶ Sentence \d+<\/button>/g) || [];
    check(`${n} play rows, numbered in order`, rows.length === n && rows.every((r, i) => r.includes(`id="ls${i}"`) && r.includes(`▶ Sentence ${i+1}<`)));
    check("no sentence text, no word taps, no translation in the listening rows", !/data-pw|class="ptxt"/.test(pbox) && P.sentences.every(s => !pbox.includes(VC.escapeHtml(s.t)) && !pbox.includes(VC.escapeHtml(s.en))));
    check("Play all, Show text, Done listening present", /id="lplay">Play all</.test(b.api.html("panel")) && /id="ltext" aria-expanded="false">Show text</.test(b.api.html("panel")) && /id="rdone">Done listening</.test(b.api.html("panel")));
    const k = b.spoken.length;
    b.api.el("ls2").click();
    check("a play row speaks its sentence", b.spoken.slice(k).join() === P.sentences[2].t);
    b.api.el("ltext").click();
    const shown = b.api.html("pbox");
    check("Show text: the ordinary passage rows (tap-to-gloss) replace the play rows",
      /data-pw/.test(shown) && !/class="ghost lsay"/.test(shown) && (shown.match(/class="psent/g) || []).length === n && b.api.el("ltext").textContent === "Hide text");
    b.api.el("ltext").click();
    check("Hide text: play rows back", /class="ghost lsay"/.test(b.api.html("pbox")));
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[4] Play all: n sentences in order, each after the last ends; stops on Done listening");
  try{
    const b = await boot();
    b.api.setProg(rereadProg(PASSAGES, P));
    b.api.startPassage(P, true, "listen");
    const n = P.sentences.length;
    b.api.el("lplay").click();
    check("Play all starts sentence 1 and becomes Stop", b.spoken.length === 1 && b.spoken[0] === P.sentences[0].t && b.api.el("lplay").textContent === "Stop");
    for(let i = 1; i < n; i++){ fire(b.ss, b.utts[b.utts.length - 1]); await sleep(5); }
    check(`${n} speak calls, in sentence order`, b.spoken.length === n && b.spoken.every((t, i) => t === P.sentences[i].t), JSON.stringify(b.spoken.slice(0, 3)));
    fire(b.ss, b.utts[b.utts.length - 1]); await sleep(5);
    check("after the last sentence: nothing more, button back to Play all", b.spoken.length === n && b.api.el("lplay").textContent === "Play all");
    // A cancelled utterance (error "canceled") is not an end: the chain waits.
    b.api.el("lplay").click();
    const k0 = b.spoken.length;
    b.ss.speaking = false; b.utts[b.utts.length - 1].onerror({ error: "canceled" }); await sleep(5);
    check("a canceled utterance does not advance Play all", b.spoken.length === k0);
    fire(b.ss, b.utts[b.utts.length - 1]); await sleep(5);
    const k1 = b.spoken.length;
    check("its real end does (sentence 2 follows)", k1 === k0 + 1 && b.spoken[k1 - 1] === P.sentences[1].t);
    b.api.el("rdone").click(); await sleep(DEFER);
    const k2 = b.spoken.length; // the first question speaks on mount
    fire(b.ss, b.utts.find(u => u.text === P.sentences[1].t && b.utts.indexOf(u) === k1 - 1)); await sleep(DEFER);
    check("Done listening stops the chain: sentence 2's late end plays nothing more", b.spoken.length === k2 && b.spoken.slice(k1).every(t => !P.sentences.some(s => s.t === t)));
    // Stop button, and a row tap, end the chain.
    const c = await boot();
    c.api.setProg(rereadProg(PASSAGES, P)); c.api.startPassage(P, true, "listen");
    c.api.el("lplay").click(); c.api.el("lplay").click();
    const j = c.spoken.length; fire(c.ss, c.utts[c.utts.length - 1]); await sleep(5);
    check("Stop: nothing further plays", c.spoken.length === j && c.api.el("lplay").textContent === "Play all");
    c.api.el("lplay").click(); c.api.el("ls3").click(); await sleep(DEFER);
    const j2 = c.spoken.length; fire(c.ss, c.utts[c.utts.length - 1]); await sleep(DEFER);
    check("a row tap during Play all plays that row and ends the chain", c.spoken[j2 - 1] === P.sentences[3].t && c.spoken.length === j2);
    // A tab switch (render() calls stopSpeaking) ends the chain and the current sentence at once.
    const t = await boot();
    t.api.setProg(rereadProg(PASSAGES, P)); t.api.startPassage(P, false, "listen");
    t.api.el("lplay").click();
    const cur = t.utts[t.utts.length - 1], c0 = t.ss.cancels, t0 = t.spoken.length;
    t.document.querySelectorAll('#tabs button[data-t="words"]')[0].click();
    check("tab switch: the playing sentence is cancelled at once (the Read-tab passage is kept for the return)", t.ss.cancels === c0 + 1 && t.api.rd() && t.api.rd().p.id === P.id);
    fire(t.ss, cur); await sleep(DEFER);
    check("tab switch: the cancelled sentence's late end starts nothing", t.spoken.length === t0);
    // A re-render of the listening screen (readRender stops speech) resets Play all.
    const r = await boot();
    r.api.setProg(rereadProg(PASSAGES, P)); r.api.startPassage(P, false, "listen");
    r.api.el("lplay").click(); const rc = r.utts[r.utts.length - 1];
    r.api.rerender();
    check("re-render mid Play all: speech stopped, button back to Play all, RD.playing false", r.api.el("lplay").textContent !== "Stop" && /id="lplay">Play all</.test(r.api.html("panel")) && r.api.rd().playing === false);
    const r0 = r.spoken.length; fire(r.ss, rc); await sleep(DEFER);
    check("re-render: the stopped sentence's late end starts nothing", r.spoken.length === r0);
    // Engine that fires onend (not an error) on cancel(), and never starts sentence 2's
    // first utterance: ttsDriver cancels it and retries. The cancel's stale onend must not
    // advance Play all, or sentence 2 would be skipped.
    {
      const P3 = JSON.parse(JSON.stringify(P)); P3.sentences = P3.sentences.slice(0, 3);
      let stalled = false;
      const hook = (ss, spoken, utts) => {
        ss.speak = u => {
          spoken.push(u.text); utts.push(u);
          if(u.text === P3.sentences[1].t && !stalled){ stalled = true; ss.stalledU = u; return; } // never starts
          ss.speaking = true;
          setTimeout(() => { if(u.done) return; u.done = true; ss.speaking = false; if(u.onend) u.onend({}); }, 15);
        };
        ss.cancel = () => { ss.cancels++; ss.speaking = false; ss.pending = false; utts.forEach(u => { if(!u.done){ u.done = true; if(u.onend) u.onend({}); } }); };
      };
      const e = await boot({ ssHook: hook });
      e.api.setProg(rereadProg(PASSAGES, P)); e.api.startPassage(P3, false, "listen");
      e.api.el("lplay").click();
      await sleep(VC.TTS_TIMING.watchMs + VC.TTS_TIMING.pollMs * 2 + VC.TTS_TIMING.deferMs + 400);
      const want = [P3.sentences[0].t, P3.sentences[1].t, P3.sentences[1].t, P3.sentences[2].t];
      check("onend-on-cancel engine + one retry: all 3 sentences in order, the stalled one retried, each once after its end", JSON.stringify(e.spoken) === JSON.stringify(want) && e.api.el("lplay").textContent === "Play all", JSON.stringify(e.spoken.map(t => P3.sentences.findIndex(x => x.t === t))));
    }
    // Clips, no voice: the chain runs on the shared Audio element's onended.
    const CP = JSON.parse(JSON.stringify(P)); CP.sentences.forEach((s, i) => { s.audio = `audio/p/${i}.mp3`; });
    const d = await boot({ voices: [{ lang: "en-US", name: "en" }], passages: PASSAGES.map(p => p.id === P.id ? CP : p) });
    d.api.setProg(rereadProg(PASSAGES, P)); d.api.startPassage(CP, true, "listen");
    d.api.el("lplay").click();
    for(let i = 1; i < n; i++){ d.audio().onended(); await sleep(5); }
    check(`clips: ${n} plays in order, no TTS`, d.plays.length === n && d.plays.every((s, i) => s === `audio/p/${i}.mp3`) && d.spoken.length === 0);
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[5] questions: every one audio-only behind Show question; results lines; done record l:1");
  try{
    const b = await boot();
    const pr = rereadProg(PASSAGES, P); b.api.setProg(pr);
    b.api.startPassage(P, true, "listen");
    const ao = b.api.rd().audioOnly, n = P.questions.length;
    check(`audioOnly = VC.listenAudioOnly(id, previous attempts=1, ${n}) (${ao.join(",")})`, JSON.stringify(ao) === JSON.stringify(VC.listenAudioOnly(P.id, 1, n)) && ao.length === n); // listenQuestions "all", default since the flag collapse
    b.api.el("ltext").click();
    b.api.el("rdone").click();
    const tapIdx = ao[0], lateIdx = ao.length > 1 ? ao[1] : null;
    let hiddenOk = true, shownOk = true, spokeOk = true, tapOk = false, lateOk = lateIdx === null;
    for(let qi = 0; qi < n; qi++){
      const q = b.api.rd().p.questions[qi], h = b.api.html("panel"); // the pass's question order (passageForPass)
      spokeOk = spokeOk && b.spoken[b.spoken.length - 1] === q.q;
      if(ao.indexOf(qi) >= 0){
        hiddenOk = hiddenOk && /id="qsh"[^>]*>Show question</.test(h) && !/class="med wd"/.test(h) && !/id="qtr"/.test(h) && /id="rpa"/.test(h) && !(q.en && h.includes(VC.escapeHtml(q.en)));
        if(qi === tapIdx){
          b.api.el("qsh").click();
          const w = b.api.html("qshwrap");
          tapOk = b.api.rd().answers[qi].qh === true && /class="med wd"/.test(w) && (!q.en || /id="qtr"/.test(w));
          if(q.en){ b.api.el("qtr").click(); tapOk = tapOk && b.api.rd().answers[qi].tr === true; }
        }
      } else shownOk = shownOk && /class="med wd"/.test(h) && !/id="qsh"/.test(h);
      const os = b.api.el("o").children;
      os.find(x => x.dataset.v === String(q.answer)).click();
      if(qi === lateIdx){ const w = b.api.html("qshwrap"); lateOk = !b.api.rd().answers[qi].qh && /class="med wd"/.test(w) && !/id="qsh"/.test(w) && (!q.en || /id="qtr"/.test(w)); }
      b.api.el("nx").click(); await sleep(DEFER);
    }
    check("audio-only questions: text, translation button hidden behind #qsh; Replay present", hiddenOk);
    check("other questions show their text as in a reading pass", shownOk);
    check("every question is spoken on mount (both kinds)", spokeOk);
    check("Show question before answering: reveals text + translation button, logs qh", tapOk);
    check("answering an audio-only question reveals its text + translation button (#qsh gone), qh not logged", lateOk);
    const res = b.api.html("panel");
    // App v2 results: one block per question in order (Missed first, then the folded right ones); "Question shown" heads a block.
    const lines = res.split('<div class="stmt"').slice(1);
    check("results: 'Listening pass' alone even after Show text", /id="lmode"[^>]*>Listening pass<\/p>/.test(res) && !/Text shown while listening|looked back/.test(res) && !("peekText" in b.api.rd()));
    check("results: 'Question shown' heads exactly one block, the tapped question's", lines.length === n && lines.filter(l => />Question( and translation)? shown</.test(l)).length === 1 && lines.findIndex(l => />Question( and translation)? shown</.test(l)) === tapIdx); // all answered right: blocks in question order
    const rec = pr.read.done[P.id];
    check("done record: l:1, x counts on, full score", rec.l === 1 && rec.x === 2 && rec.sc === n && rec.n === n);
    // A listen pass without Show text: header line only.
    const c = await boot(); c.api.setProg(rereadProg(PASSAGES, P)); c.api.startPassage(P, true, "listen");
    c.api.el("rdone").click(); answerAll(c.api, P, false);
    check("results without Show text: 'Listening pass' alone", /id="lmode"[^>]*>Listening pass<\/p>/.test(c.api.html("panel")));
    // A reading pass: no l, no listen lines.
    const r = await boot(); const pr2 = rereadProg(PASSAGES, P); r.api.setProg(pr2);
    r.api.startPassage(P, false); r.api.el("rdone").click(); answerAll(r.api, P, true);
    check("reading pass: done record has no l, no listening lines", !("l" in pr2.read.done[P.id]) && !/Listening pass|question shown/.test(r.api.html("panel")));
    // No voice + clips: audio-only needs the question spoken, so none are hidden.
    const CP = JSON.parse(JSON.stringify(P)); CP.sentences.forEach((s, i) => { s.audio = `audio/p/${i}.mp3`; });
    const d = await boot({ voices: [{ lang: "en-US", name: "en" }], passages: PASSAGES.map(p => p.id === P.id ? CP : p) });
    d.api.setProg(rereadProg(PASSAGES, P)); d.api.startPassage(CP, true, "listen");
    d.api.el("rdone").click();
    let noneHidden = true;
    for(let qi = 0; qi < n; qi++){ noneHidden = noneHidden && !/id="qsh"/.test(d.api.html("panel")) && /class="med wd"/.test(d.api.html("panel")); const os = d.api.el("o").children; os[0].click(); d.api.el("nx").click(); }
    check("clips but no voice: the questions cannot be spoken, so none is audio-only", noneHidden);
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  // [6] (control vs ea5dcbc, flags off) deleted: dayAware, listenQuestions and readRotation are engine default since the flag collapse.

  console.log("\n[7] re-mount: a voiceschanged during the Today Read stage restores it; a tab switch ends it");
  try{
    const voices = [{ lang: "zh-CN", name: "x" }];
    const b = await boot({ voices });
    b.api.setProg(rereadProg(PASSAGES, P));
    b.api.today();
    b.api.enterTodayStep(5, { p: P, reason: "reread", mode: "listen" });
    const rd = b.api.rd();
    b.api.el("ltext").click();
    const flip = () => { voices[0] = { lang: "en-US", name: "en" }; b.ss.onvoiceschanged(); voices[0] = { lang: "zh-CN", name: "x" }; b.ss.onvoiceschanged(); };
    flip();
    check("listening screen: voiceschanged keeps the Today passage (same RD, text still shown, no Today plan)", b.api.rd() === rd && /id="ltext"[^>]*>Hide text/.test(b.api.html("panel")) && /Done listening/.test(b.api.html("panel")) && !/id="go"/.test(b.api.html("panel")));
    b.api.el("rdone").click(); await sleep(DEFER);
    const k = b.spoken.length, q0 = P.questions[0];
    if(rd.audioOnly.indexOf(0) >= 0) b.api.el("qsh").click();
    flip(); await sleep(DEFER);
    check("question: voiceschanged keeps it (same question, nothing spoken again)", b.api.rd() === rd && rd.qi === 0 && b.spoken.length === k && /id="o"/.test(b.api.html("panel"))); // app v2: no "Question 1 / N" line (the header counts)
    check("question: an opened audio-only question stays open", rd.audioOnly.indexOf(0) < 0 || (/class="med wd"/.test(b.api.html("panel")) && !/id="qsh"/.test(b.api.html("panel"))));
    b.api.el("o").children.find(x => x.dataset.v === String(q0.answer)).click();
    b.document.querySelectorAll('#tabs button[data-t="words"]')[0].click();
    check("tab switch from the Today Read stage ends it (RD dropped with the session)", b.api.rd() === null);
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  // A learner with 100 level-1 words, a set to learn next and sentences available.
  const sessionProg = () => {
    const pr = VC.normalizeProg({ sets: { "1": 10 }, placedOnce: true, sessions: 3 }, PACK);
    WORDS.filter(w => w.lv === "1").slice(0, 100).forEach((w, i) => { pr.w[w.id] = { r: 1 + i % 3, w: i % 2, s: i % 3 }; });
    return pr;
  };
  // Every Today step's plan and first screen, then the Test tab and its three word/sentence tests.
  const walk = async (opts) => {
    const b = await boot(opts);
    const pr = sessionProg(); b.api.setProg(pr);
    const out = [];
    b.api.today(); out.push(b.api.html("panel"));
    for(const st of [0, 1, 2, 3, 4]){
      b.api.enterTodayStep(st);
      out.push(b.api.html("panel"));
      if(st === 1 && b.api.el("dr")) b.api.el("dr").onclick({});
      out.push(JSON.stringify(b.api.dq()), b.api.html("panel"));
    }
    b.api.testTab(); out.push(b.api.html("panel"));
    for(const id of ["tListen", "tRecall", "tSentences"]){
      b.api.testTab();
      const e = b.api.el(id);
      if(e){ e.onclick({}); out.push(JSON.stringify(b.api.dq())); } else out.push(`${id} absent`);
    }
    return out;
  };
  const real = Math.random;
  const seededWalk = async opts => { Math.random = mulberry32(7); try{ return await walk(opts); } finally { Math.random = real; } };

  // [8] (control vs 4303f59, flags off) deleted: engine default since the flag collapse.

  console.log("\n[9] no voice, no clips: no hear item is planned, so no drill shows the notice");
  try{
    const NV = [{ lang: "en-US", name: "en" }];
    const b = await boot({ voices: NV });
    const pr = sessionProg(); b.api.setProg(pr);
    b.api.today();
    const planHtml = b.api.html("panel");
    b.api.enterTodayStep(0);
    const review = b.api.dq() || [];
    const reviewScreen = b.api.html("panel");
    check("Review: zero hear kinds and no item flagged for the notice", review.length > 0 && review.every(x => !x[3]) && !/No voice for this language in this browser/.test(reviewScreen));
    const lw = VC.learnedWords(WORDS, PACK, pr);
    const plan = VC.buildReviewPlan(lw, pr, PACK, { canHear: () => false });
    check("buildReviewPlan with canHear false: zero hear kinds, production share kept", plan.every(x => x.kind !== "hear") && plan.filter(x => x.kind === "recall" || x.kind === "type").length === Math.ceil(plan.length * 0.4 - 1e-9));
    b.api.enterTodayStep(1);
    b.api.el("dr").onclick({});
    const learn = b.api.dq() || [];
    const keys = learn.map(x => x[0]);
    check("Learn drill asks each word's meaning once (one item per word, none flagged)", learn.length + 1 === 10 && new Set(keys).size === keys.length && learn.every(x => !x[3]));
    b.api.enterTodayStep(2);
    const afterListen = b.api.dq() || [];
    check(`Today Listen step is skipped: the next drill is Recall (${VC.recallSize(PACK)} production items), nothing heard or flagged`,
      planRow0(planHtml, "Listen") === "" && // app v2: the plan lists Listen bare; the step skips when entered
       afterListen.length + 1 === VC.recallSize(PACK) && afterListen.every(x => !x[3] && !x[4]));
    b.api.enterTodayStep(4);
    const sents = b.api.dq() || [];
    check("Sentences step: no hear sentence planned, none flagged", sents.every(x => !x[3]) && !/No voice for this language in this browser/.test(b.api.html("panel")));
    b.api.testTab();
    const th = b.api.html("panel");
    check("Test tab: Listen button replaced by its no-items note; Recall stays", !b.api.el("tListen") && /Listen test: no items until a voice or recording is available/.test(th) && !!b.api.el("tRecall"));
    b.api.el("tSentences").onclick({});
    check("Test Sentences: no item flagged for the notice", (b.api.dq() || []).every(x => !x[3]));
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log("\n[10] clips on some words, no voice (persian-style): clipped words keep their hear items, unclipped do not");
  try{
    const l1 = WORDS.filter(w => w.lv === "1");
    const clipped = new Set(l1.slice(0, 110).filter((_, i) => i % 4 < 2).map(w => w.id));
    const words = WORDS.map(w => clipped.has(w.id) ? Object.assign({}, w, { audio: `audio/w/${w.id}.opus` }) : w);
    const pack = Object.assign({}, PACK, { audio: { voice: "test", version: 1 } });
    const idOf = key => key.slice(2);
    Math.random = mulberry32(5);
    let b;
    try{ b = await boot({ voices: [{ lang: "en-US", name: "en" }], pack, words }); }
    finally{ Math.random = real; }
    b.api.setProg(sessionProg());
    b.api.today();
    const heard = q => q.filter(x => x[4]);
    b.api.enterTodayStep(0);
    const review = b.api.dq() || [];
    // pairs (default since the flag collapse): Review asks the sm pair typed (Type the pinyin) when a typed kind fits, so a
    // Review may plan no hear item; the at-least-one hear check lives on Today Listen below.
    check("Review: hear items only on clipped words, unclipped words present, none flagged",
      review.length > 0 && review.some(x => !clipped.has(idOf(x[0]))) && heard(review).every(x => clipped.has(idOf(x[0]))) && review.every(x => !x[3]));
    b.api.enterTodayStep(1); b.api.el("dr").onclick({});
    const learn = b.api.dq() || [];
    const perWord = {}; learn.forEach(x => { perWord[x[0]] = (perWord[x[0]] || 0) + 1; });
    const taughtIds = l1.slice(100, 110).map(w => w.id);
    const count = id => (perWord["w:" + id] || 0);
    // The drill already showed its first item, so one clipped word's pair is one short in the queue.
    const shown = taughtIds.map(id => ({ id, n: count(id), want: clipped.has(id) ? 2 : 1 }));
    check("Learn pair: clipped words asked by ear and by sight, unclipped once (first item already shown)",
      shown.filter(x => x.n !== x.want).length === 1 && shown.every(x => x.n === x.want || x.n === x.want - 1) && learn.every(x => !x[3]));
    b.api.enterTodayStep(2);
    const listen = b.api.dq() || [];
    check("Today Listen: only clipped words, each with the speaker", listen.length > 0 && listen.every(x => x[4] && clipped.has(idOf(x[0]))));
    b.api.testTab();
    const nClipped = VC.learnedWords(words, pack, sessionProg()).filter(w => clipped.has(w.id)).length;
    check(`Test Listen: button counts only clipped learned words (${Math.min(20, nClipped)})`, !!b.api.el("tListen") && new RegExp(`Listen${Math.min(20, nClipped) === 20 ? "" : " " + nClipped}<`).test(b.api.html("panel"))); // app v2: a test of 20 drops its count
    b.api.el("tListen").onclick({});
    const tl = b.api.dq() || [];
    check("Test Listen: every item a clipped word with the speaker", tl.length + 1 === Math.min(20, nClipped) && tl.every(x => x[4] && clipped.has(idOf(x[0]))));
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  // [11] (dayAware without readRotation), [12] (listenQuestions flag-off) and [13] (rereadPerfectDays, removed) deleted in the flag collapse.

  console.log(`\n[14] pack.readRotation: reading and listening passes alternate by session, random picks, shuffled questions; flag off = ${BASE_RR}`);
  try{
    const RON = PACK_DAY;
    const A = PASSAGES[0], B = PASSAGES[1], C = PASSAGES[2], D4 = PASSAGES[3];
    const full = p => p.questions.length;
    const blank = () => { const pr = VC.normalizeProg({ sets: {}, placedOnce: true, sessions: 5 }, RON);
      pr.read = { unlocked: Object.fromEntries(RON.levels.map(l => [l.id, 1])), done: {} }; return pr; };
    // All passages done; spec [passage, sc, x, s, ls] overrides; sn is the latest session.
    const allDone = (sn, spec) => { const pr = blank(); pr.sn = sn;
      PASSAGES.forEach(p => { pr.read.done[p.id] = { sc: full(p), n: full(p), d: daysAgo(1), x: 2, s: 1, ls: 1 }; });
      (spec || []).forEach(([p, sc, x, s, ls]) => { const r = { sc: sc === "full" ? full(p) : sc, n: full(p), d: daysAgo(1), x }; if(s != null) r.s = s; if(ls != null) r.ls = ls; pr.read.done[p.id] = r; });
      return pr; };
    const yes = () => true, no = () => false;
    // sn (session being planned) defaults to daySn + 1: the Today plan is made before Go.
    const nx = (pr, o) => VC.nextReadItem(PASSAGES, WORDS, (o && o.pack) || RON, pr, daysAgo(0), !!(o && o.paused), o && o.sn, o && o.rng, o && o.listen === false ? no : yes);
    const tag = r => r ? (r.reason === "new" ? "new" : r.mode === "listen" ? "listen" : "reread") : "none";
    // One Today session: plan (before Go), Go (sn + 1), the pass, all answers right.
    const session = (pr, o) => { const r = nx(pr, o); VC.daySessionStart(pr, RON);
      if(r) VC.markPassageDone(pr, r.p.id, full(r.p), full(r.p), daysAgo(0), VC.readPassMode(r, pr, !(o && o.listen === false), RON) === "listen", RON);
      return r; };
    const run = (pr, k, o) => Array.from({ length: k }, () => session(pr, o));
    const pr8 = blank(), seq = run(pr8, 8, { rng: mulberry32(1) });
    check(`8 sessions: new, listen, new, listen ... (${seq.map(tag).join(",")})`, seq.map(tag).join(",") === "new,listen,new,listen,new,listen,new,listen");
    check("session 2 listens to the passage read in session 1", seq[1].p.id === seq[0].p.id);
    check("a listening turn picks the never-listened passage (session 4: the one read in session 3)", seq[3].p.id === seq[2].p.id);
    const ra = pr8.read.done[seq[0].p.id];
    check(`s/ls written: first passage s 2, ls 2 after its listening pass (${JSON.stringify(ra)})`, ra.s === 2 && ra.ls === 2 && ra.l === 1 && ra.x === 2);
    const rd = pr8.read.done[seq[6].p.id];
    check(`session 7's new passage is session 8's listening pass (${JSON.stringify(rd)})`, seq[7].p.id === seq[6].p.id && rd.s === 8 && rd.ls === 8);
    check("reading pass record before listening: no ls", (() => { const pr = blank(); session(pr, { rng: mulberry32(2) }); const r = Object.values(pr.read.done)[0]; return r.s === 1 && !("ls" in r) && !("l" in r); })());
    check("ls is kept across a later reading pass", (() => { const pr = allDone(4, [[A, 0, 2, 3, 2]]); VC.daySessionStart(pr, RON); VC.markPassageDone(pr, A.id, 1, full(A), daysAgo(0), false, RON); const r = pr.read.done[A.id]; return r.s === 5 && r.ls === 2 && !r.l; })());
    check("[l kept] readRotation: a listen then a reading pass keeps l and ls; readPassMode follows the item mode, not l", (() => { const pr = blank(); VC.markPassageDone(pr, A.id, 2, 2, daysAgo(0), true, RON); VC.markPassageDone(pr, A.id, 2, 2, daysAgo(0), false, RON); const r = pr.read.done[A.id]; return r.l === 1 && r.ls === r.s - 0 && VC.readPassMode({ p: A, reason: "reread", mode: "read" }, pr, true, RON) === "read" && VC.readPassMode({ p: A, reason: "reread", mode: "listen" }, pr, true, RON) === "listen"; })());
    // Listening turn picks: latest pass a reading pass (s 5 > every ls).
    const lt = spec => allDone(5, [[D4, "full", 2, 5, 4]].concat(spec));
    const picks = (pr, o) => new Set(Array.from({ length: 40 }, (_, i) => (nx(pr, Object.assign({ rng: mulberry32(i + 1) }, o)) || { p: { id: "-" } }).p.id));
    const nev = picks(lt([[A, "full", 1, 2], [B, "full", 1, 3]]));
    check(`never-listened first: only A and B lack ls (${[...nev].join(",")})`, nev.size === 2 && nev.has(A.id) && nev.has(B.id));
    const old = picks((() => { const pr = lt([]); pr.read.done[B.id].ls = 0; pr.read.done[C.id].ls = 0; return pr; })());
    check(`then the smallest ls, ties random (${[...old].join(",")})`, old.size === 2 && old.has(B.id) && old.has(C.id));
    check("listening turn result: reason reread, mode listen", (() => { const r = nx(lt([[A, "full", 1, 2]])); return r && r.reason === "reread" && r.mode === "listen" && VC.readPassMode(r, lt([]), true, RON) === "listen"; })());
    check("plan before Go (sn 6) may pick the previous session's passage", (() => { const pr = lt([]); Object.values(pr.read.done).forEach(r => { r.s = 5; delete r.ls; }); return picks(pr).size > 1; })());
    check("replan inside session 5 (sn 5) never picks a passage passed in it", (() => { const pr = lt([]); Object.values(pr.read.done).forEach(r => { r.s = 5; delete r.ls; }); pr.read.done[A.id].s = 2; return [...picks(pr, { sn: 5 })].join() === A.id; })());
    check("replan inside the session with everything passed in it: no Read stage", (() => { const pr = lt([]); Object.values(pr.read.done).forEach(r => { r.s = 5; }); return nx(pr, { sn: 5 }) === null; })());
    check("canListen false: listening turn becomes a reading turn", tag(nx(lt([[A, "full", 1, 2]]), { listen: false })) !== "listen" && VC.readPassMode(nx(lt([[A, "full", 1, 2]])), lt([]), false, RON) === "read");
    check("canListen false over 6 sessions: never a listening pass", run(blank(), 6, { listen: false, rng: mulberry32(3) }).every(r => r.mode === "read" && r.reason === "new"));
    // Reading turn with nothing new: imperfect first, fewest x, ties random; no day gate.
    const rt = spec => { const pr = allDone(5, spec); Object.values(pr.read.done).forEach(r => { r.ls = 5; }); return pr; };
    const imp = picks(rt([[A, 0, 3, 2, 5], [B, 1, 2, 2, 5], [C, 0, 2, 2, 5]]));
    check(`out of new passages: imperfect first, fewest x, ties random (${[...imp].join(",")})`, imp.size === 2 && imp.has(B.id) && imp.has(C.id));
    check("re-read offered with every passage done today (no day gate)", (() => { const pr = rt([]); Object.values(pr.read.done).forEach(r => { r.d = daysAgo(0); }); const r = nx(pr); return r && r.reason === "reread" && r.mode === "read"; })());
    check("perfect re-reads: fewest x among all", (() => { const pr = rt([]); pr.read.done[C.id].x = 1; return [...picks(pr)].join() === C.id; })());
    check("a new passage wins the reading turn", (() => { const pr = rt([[A, 0, 1, 2, 5]]); delete pr.read.done[B.id]; const r = nx(pr); return tag(r) === "new" && r.p.id === B.id && r.mode === "read"; })());
    // Paused: no new passage, the rest unchanged.
    const pz = (() => { const pr = rt([[A, 0, 1, 2, 5]]); delete pr.read.done[B.id]; return pr; })();
    check("paused, reading turn: a re-read, never the new passage", (() => { const r = nx(pz, { paused: true }); return r && r.reason === "reread" && r.p.id === A.id; })());
    check("paused, listening turn: a listening pass", tag(nx(lt([[A, "full", 1, 2]]), { paused: true })) === "listen");
    check("paused, nothing read: no Read stage", nx(blank(), { paused: true }) === null);
    check("no rng given: the pick is stable across calls (plan re-renders)", (() => { const pr = lt([]); pr.read.done[A.id].ls = 0; pr.read.done[B.id].ls = 0; pr.read.done[C.id].ls = 0; const a = nx(pr), b = nx(pr); return a && b && a.p.id === b.p.id; })());
    // Question order.
    const P4 = PASSAGES.find(p => p.questions.length >= 4);
    const ord = x => VC.passageForPass(P4, x, RON).questions.map(q => P4.questions.indexOf(q)).join();
    check(`question order: a permutation, stable for the same attempt count (${ord(0)})`, ord(0) === ord(0) && ord(0).split(",").map(Number).sort((a, b) => a - b).join() === P4.questions.map((_, i) => i).join());
    check(`question order changes between attempts (${[0, 1, 2, 3].map(ord).join(" | ")})`, new Set([0, 1, 2, 3].map(ord)).size > 1);
    // App: the pass runs in the shuffled order; answers, weak words, done record follow it.
    {
      const b = await boot({ pack: RON });
      const pr = allDone(5, [[P4, "full", 2, 4, 4]]); b.api.setProg(pr);
      b.api.startPassage(P4, true, "read");
      const RP = b.api.rd().p, want = VC.passageForPass(P4, 2, RON);
      check("app: RD.p carries the shuffled questions, qx the attempt count", RP.questions.map(q => q.q).join("|") === want.questions.map(q => q.q).join("|") && b.api.rd().qx === 2 && RP !== P4);
      b.api.el("rdone") ? b.api.el("rdone").click() : b.api.el("rgo").click();
      const shown = [];
      for(let qi = 0; qi < RP.questions.length; qi++){
        const q = RP.questions[qi]; shown.push(b.api.html("panel").includes(VC.escapeHtml(q.q)));
        const os = b.api.el("o").children; (qi === 0 ? os.find(x => x.dataset.v !== String(q.answer)) : os.find(x => x.dataset.v === String(q.answer))).click();
        b.api.el("nx").click(); await sleep(DEFER);
      }
      check("app: question i shows RD.p.questions[i]", shown.every(Boolean));
      const rec = pr.read.done[P4.id];
      check(`app: done record sc n-1 (first shown question missed), s 5 (${JSON.stringify(rec)})`, rec.sc === full(P4) - 1 && rec.n === full(P4) && rec.x === 3 && rec.s === 5 && rec.ls === 4 && !rec.l);
      const ww = VC.passageWeakWords(RP, { tapped: [], answers: b.api.rd().answers }, Object.fromEntries(WORDS.map(w => [w.id, w])));
      const wantW = (RP.questions[0].words || []).filter(id => WORDS.some(w => w.id === id));
      check("app: weak words are the missed question's words", JSON.stringify(ww.map(e => e.id).sort()) === JSON.stringify([...new Set(wantW)].sort()));
    }
    {
      const b = await boot({ pack: RON });
      b.api.setProg(lt([[A, "full", 1, 2]])); b.api.today();
      const lrow = planRow(b.api.html("panel"), "Listen");
      b.api.today();
      check("app: Today plan shows the listening turn, same row after a re-render", !!lrow && lrow === planRow(b.api.html("panel"), "Listen"));
    }
    // flag-off controls vs 491d470 deleted: readRotation is engine default since the flag collapse.
    check("validateProgShape: numeric s/ls accepted, a string rejected", VC.validateProgShape({ v: VC.PROG_VERSION, sets: {}, read: { done: { a: { sc: 1, n: 2, d: "2026-10-03", x: 1, s: 3, ls: 2 } } } }, VC.levelIds(RON)).ok
      && !VC.validateProgShape({ v: VC.PROG_VERSION, sets: {}, read: { done: { a: { sc: 1, n: 2, d: "2026-10-03", x: 1, s: "3" } } } }, VC.levelIds(RON)).ok);
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n[15] listenQuestions "all": a listening pass's look-back replays audio (text behind Show text); flag off = ${BASE_LB}`);
  try{
    const n = P.questions.length;
    const textRe = h => /data-pw/.test(h) && /class="ptxt/.test(h);
    const b = await boot({ pack: PACK_DAY });
    const flip = () => { b.ss.getVoices = () => [{ lang: "en-US", name: "en" }]; b.ss.onvoiceschanged(); b.ss.getVoices = () => [{ lang: "zh-CN", name: "x" }]; b.ss.onvoiceschanged(); };
    const pr = rereadProg(PASSAGES, P); b.api.setProg(pr);
    b.api.startPassage(P, true, "listen"); b.api.el("rdone").click();
    let h = b.api.html("panel");
    check("listening pass question: button reads 'Replay passage', replay bar and passage hidden", />Replay passage</.test(h) && !/Show passage/.test(h) && /id="lkbar" hidden/.test(h) && /id="pbox" hidden/.test(h));
    b.api.el("ptoggle").click(); h = b.api.html("panel");
    check("opening it: bar and list shown, button 'Hide passage', nothing logged", b.api.el("lkbar").hidden === false && b.api.el("pbox").hidden === false && b.api.el("ptoggle").textContent === "Hide passage" && !("reopened" in b.api.rd().answers[0]));
    check("list: one play row per sentence, no written text, no tappable words", (h.match(/class="ghost lsay"/g) || []).length === P.sentences.length && !textRe(h) && !/data-pw/.test(h));
    const k = b.spoken.length; b.api.el("ls2").click(); await sleep(DEFER);
    check("a play row speaks its sentence", b.spoken.length === k + 1 && b.spoken[k] === P.sentences[2].t);
    fire(b.ss, b.utts[b.utts.length - 1]); await sleep(DEFER);
    const k2 = b.spoken.length; b.api.el("lplay").click(); await sleep(DEFER);
    check("Play all starts sentence 1 and becomes Stop", b.spoken.length === k2 + 1 && b.spoken[k2] === P.sentences[0].t && b.api.el("lplay").textContent === "Stop");
    b.api.el("lplay").click();
    check("Stop ends it", b.api.el("lplay").textContent === "Play all" && b.api.rd().playing === false);
    b.api.el("ltext").click(); h = b.api.html("pbox");
    check("Show text: written rows with tap-to-gloss, label Hide text, nothing logged", /data-pw/.test(h) && textRe(h) && !("peekText" in b.api.rd()) && b.api.el("ltext").textContent === "Hide text");
    const rdSaved = JSON.parse(JSON.stringify(Object.assign({}, b.api.rd(), { p: undefined })));
    check("resume record carries the UI state only (shown, qv[0].lkText)", rdSaved.shown === true && rdSaved.qv[0].lkText === true);
    flip(); await sleep(DEFER);
    check("re-render restores the open text list", !/id="pbox" hidden/.test(b.api.html("panel")) && /data-pw/.test(b.api.html("panel")) && !/id="lkbar" hidden/.test(b.api.html("panel")) && />Hide text</.test(b.api.html("panel")));
    b.api.el("ltext").click(); h = b.api.html("pbox");
    check("Hide text returns to play rows", !textRe(h) && (h.match(/class="ghost lsay"/g) || []).length === P.sentences.length);
    flip(); await sleep(DEFER);
    check("re-render restores the open play-row list", !/id="pbox" hidden/.test(b.api.html("panel")) && !textRe(b.api.html("panel")) && />Show text</.test(b.api.html("panel")));
    const k3 = b.spoken.length, c3 = b.ss.cancels;
    b.api.el("lplay").click(); await sleep(DEFER); b.api.el("ptoggle").click();
    check("closing the look-back stops playing", b.api.rd().playing === false && b.ss.cancels > c3 && b.api.el("pbox").hidden === true && b.api.el("lkbar").hidden === true);
    const k4 = b.spoken.length; fire(b.ss, b.utts[b.utts.length - 1]); await sleep(DEFER);
    check("the stopped sentence's late end starts nothing", b.spoken.length === k4);
    b.api.el("o").children.find(x => x.dataset.v === String(P.questions[0].answer)).click();
    b.api.el("nx").click(); await sleep(DEFER);
    // Looking back is not tracked: Show text after answering is a plain toggle.
    { const t = await boot({ pack: PACK_DAY }); t.api.setProg(rereadProg(PASSAGES, P)); t.api.startPassage(P, true, "listen"); t.api.el("rdone").click();
      t.api.el("o").children.find(x => x.dataset.v === String(P.questions[0].answer)).click(); t.api.el("ptoggle").click(); t.api.el("ltext").click();
      check("Show text after answering: a plain toggle, nothing logged", /data-pw/.test(t.api.html("pbox")) && !("peekText" in t.api.rd()) && !("reopened" in t.api.rd().answers[0]));
      const t2 = await boot({ pack: PACK_DAY }); t2.api.setProg(rereadProg(PASSAGES, P)); t2.api.startPassage(P, true, "listen"); t2.api.el("rdone").click();
      t2.api.el("ptoggle").click(); t2.api.el("lplay").click(); t2.api.el("o").children.find(x => x.dataset.v === String(P.questions[0].answer)).click();
      check("answering during Play all clears Stop", t2.api.el("lplay").textContent === "Play all" && t2.api.rd().playing === false); }
    check("next question: look-back closed again", n < 2 || (b.api.rd().shown === false && /id="pbox" hidden/.test(b.api.html("panel")) && />Replay passage</.test(b.api.html("panel"))));
    answerAll(b.api, P, false);
    const res = b.api.html("panel");
    check("results: no 'looked back' and no 'Text shown while listening' though the look-back was opened and text shown; no look-back flag in the record", !/looked back|Text shown while listening/.test(res) && /Listening pass<\/p>/.test(res) && b.api.rd().answers.every(a => !("reopened" in a)) && !("peekText" in b.api.rd()));
    const rd1 = await boot({ pack: PACK_DAY }); rd1.api.setProg(rereadProg(PASSAGES, P));
    rd1.api.startPassage(P, true, "read"); rd1.api.el("rdone").click();
    const hr = rd1.api.html("panel");
    check("reading pass unchanged: 'Show passage', no replay bar, passage is written text", />Show passage</.test(hr) && !/lkbar|Replay passage/.test(hr) && /data-pw/.test(hr));
    // look-back walks vs a8e9c08 with the flags off deleted: listenQuestions / readRotation are engine default since the flag collapse.
  }catch(e){ check(`section threw: ${e.stack}`, false); }

  console.log(`\n${fails === 0 ? "ALL PASSED" : "FAILED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
