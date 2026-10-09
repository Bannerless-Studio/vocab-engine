// Node checks for engine/core.js against the real zh pack plus synthetic packs.
// Run: /opt/homebrew/bin/node tests/engine_checks.js     (no dependencies)
"use strict";
// zh sets pack.helpClose (docs/PACK_SCHEMA.md "helpClose"): popovers end with its close button.
const HELPX = /<button type="button" class="helpx"[^>]*>×<\/button>$/;
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
// the pack this suite was written against: as shipped just before pairs (9eb6ecb), the collapsed flags now engine default
const PAIRS_ERA = "9eb6ecb~1";
const os = require("os");
const cp = require("child_process");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");

function loadConst(file, name){
  return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)();
}
// The zh data as the typing-off baseline pack: the shipped pack's typing "pron" (typed
// reading, brief BP2) is set back to null here; tests/pron_aids_checks.js checks it.
// readRotation (fb16) shuffles questions and picks by session; its checks are listen_mode_checks [14].
// pack.pairs (fb23) has its own suite (tests/pairs_checks.js); the app checks here run the day planner.
// fb37: these checks pin the Progress tab before progressView (tests/progress_view_checks.js covers v2).
const PACK = Object.assign(packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), PAIRS_ERA, { strip: [] }), { typing: null });
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS");
const SENTENCES = loadConst(path.join(ZH, "sentences.js"), "SENTENCES");
const LESSONS = loadConst(path.join(ZH, "lessons.js"), "LESSONS");
const PASSAGES = loadConst(path.join(ZH, "sentences.js"), "PASSAGES");
const BY_ID = {}; WORDS.forEach(w=>{ BY_ID[w.id] = w; });
console.log(`Loaded zh pack: ${WORDS.length} words, ${SENTENCES.length} sentences, ${LESSONS.length} lessons`);

let fails = 0, passes = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}
const sample = (arr, n) => Array.from({length:n}, ()=>arr[Math.floor(Math.random()*arr.length)]);

// ------------------------------------------------------------ [0] stale-build guard
(function(){
  // Every other check runs against source files; this one proves dist/zh.html is what
  // build.sh produces from them right now (rebuild to scratch, byte-compare).
  // Private scratch dir: build.sh also writes sw.js next to its output.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vocab_engine_stalecheck_"));
  const tmp = path.join(tmpDir, "zh.html");
  try{
    cp.execSync(`sh build.sh packs/zh "${tmp}"`, { cwd: ROOT, stdio: "pipe" });
    const built = fs.readFileSync(tmp, "utf8");
    const shipped = fs.existsSync(path.join(ROOT, "dist", "zh.html")) ? fs.readFileSync(path.join(ROOT, "dist", "zh.html"), "utf8") : null;
    console.log(`\n[0] stale-build guard: fresh build ${built.length} chars; dist/zh.html ${shipped===null ? "MISSING" : shipped.length+" chars"}`);
    check("dist/zh.html matches a fresh ./build.sh packs/zh output (not stale)", built === shipped);
    const shippedSw = path.join(ROOT, "dist", "sw.js");
    check("dist/sw.js matches the sw.js a fresh build writes next to the page (not stale)",
      fs.existsSync(shippedSw) && fs.readFileSync(path.join(tmpDir, "sw.js"), "utf8") === fs.readFileSync(shippedSw, "utf8"));
    const srcs = [...built.matchAll(/<script[^>]*\ssrc=/g)].length;
    const links = [...built.matchAll(/<link[^>]*href="([^"]+)"/g)].map(m=>m[1]).filter(h=>!/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(h) && !/^data:/.test(h));
    check("built file is self-contained (no <script src>, only Google Fonts links and the data: favicon)", srcs === 0 && links.length === 0);
    check("built file has no leftover dev pack loader", !built.includes("PACK-BEGIN") && !built.includes("document.write"));
    // Fonts never block first paint: no parser-inserted <link rel="stylesheet">; the
    // IBM Plex CSS is a preload that turns itself into a stylesheet once loaded.
    const linkTags = [...built.matchAll(/<link\b[^>]*>/g)].map(m => m[0]);
    check("built file has no render-blocking stylesheet link", !linkTags.some(t => /\brel\s*=\s*"?stylesheet/i.test(t)));
    check("IBM Plex CSS is preloaded (as=style, display=swap) and swapped to a stylesheet on load",
      linkTags.some(t => /rel="preload"/.test(t) && /as="style"/.test(t) && /family=IBM\+Plex\+Sans[^"]*display=swap/.test(t) && /onload="this\.onload=null;this\.rel='stylesheet'"/.test(t)));
  }catch(e){
    console.log(`\n[0] build.sh failed: ${e.message}`);
    check("build.sh runs cleanly", false);
  }finally{ fs.rmSync(tmpDir, { recursive: true, force: true }); }
})();

(function(){
  console.log("\n[1] validate_pack.py packs/zh");
  const r = cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), ZH], { encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop();
  console.log("    " + last + (r.stderr ? `\n    stderr: ${r.stderr.trim()}` : ""));
  check("validate_pack.py passes on packs/zh", r.status === 0);
  check("zh pack has 1193 words, 882 sentences, 12 lessons", WORDS.length === 1193 && SENTENCES.length === 882 && LESSONS.length === 12);
  const unresolved = SENTENCES.flatMap(s => s.words.filter(id => !BY_ID[id]).map(id => `${s.id}:${id}`));
  check("every sentence word id resolves to a word", unresolved.length === 0);
  const lvIds = new Set(VC.levelIds(PACK));
  check("every word/sentence lv is a pack level", WORDS.every(w=>lvIds.has(w.lv)) && SENTENCES.every(s=>lvIds.has(s.lv)));
  check("lesson items: answer is one of the options", LESSONS.every(l => l.items.every(it => it.opts.includes(it.a))));
  const spanBad = SENTENCES.filter(s => !Array.isArray(s.spans) || !s.spans.every((x, i) =>
    x.length === 3 && x[0] < x[1] && x[1] <= s.t.length && s.words.includes(x[2]) && (i === 0 || s.spans[i-1][1] <= x[0])));
  check("pack_from_hsk: every zh sentence has sorted, non-overlapping spans with ids in words", spanBad.length === 0);
  const compSpan = SENTENCES.flatMap(s => s.spans.filter(x => PACK.compounds.includes(s.t.slice(x[0], x[1]))));
  check("pack_from_hsk: no span covers a pack.compounds token (a lone span would blank 这个 for 这)", compSpan.length === 0);
  const unstripped = SENTENCES.map(s => Object.assign({}, s, { spans: undefined }));
  check("zh spans leave cloze targets unchanged (gapMatch with vs without spans)", SENTENCES.every((s, i) =>
    s.words.every(id => util.isDeepStrictEqual(VC.gapMatch(s, BY_ID[id], BY_ID, PACK), VC.gapMatch(unstripped[i], BY_ID[id], BY_ID, PACK)))));
  // Generator drift: a hand edit to a generated packs/zh file (pauseNew sat in pack.json only,
  // and a republish would have dropped it) must fail here. A fresh pack_from_hsk.py run into a
  // dir holding only the files it does not write (packbuilder passages, gloss_display.json; it
  // then runs jsonify there) has to produce every packs/zh file byte-equal, and nothing else.
  // HSK_DIR: a branch of the chinese repo that changes data/ (fb29 hsk_patterns.js) is checked from its worktree.
  const HSK = process.env.HSK_DIR ? path.resolve(process.env.HSK_DIR) : path.join(ROOT, "..", "chinese");
  if(!fs.existsSync(path.join(HSK, "data", "hsk_vocab.json"))) console.log(`NOTE  ${HSK} absent: generator drift check skipped`);
  else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zhgen-"));
    const NOT_GENERATED = ["passages_src.json", "passages.json", "REPORT_passages.md", "gloss_display.json"];
    NOT_GENERATED.forEach(f => { if(fs.existsSync(path.join(ZH, f))) fs.copyFileSync(path.join(ZH, f), path.join(tmp, f)); });
    const g = cp.spawnSync("python3", [path.join(ROOT, "tools", "pack_from_hsk.py"), HSK, "--out", tmp], { encoding: "utf8", maxBuffer: 1 << 26 });
    const DOCS = ["ZH_GLOSS.md", "ZH_TIERS.md", "ZH_PATTERNS.md"];
    const names = [...new Set([...fs.readdirSync(ZH), ...fs.readdirSync(tmp).filter(f => !DOCS.includes(f))])];
    const drift = names.filter(f => !fs.existsSync(path.join(ZH, f)) || !fs.existsSync(path.join(tmp, f)) || !fs.readFileSync(path.join(ZH, f)).equals(fs.readFileSync(path.join(tmp, f))));
    const docDrift = DOCS.filter(d => !(fs.existsSync(path.join(tmp, d)) && fs.readFileSync(path.join(tmp, d)).equals(fs.readFileSync(path.join(ROOT, "docs", d)))));
    fs.rmSync(tmp, { recursive: true, force: true });
    check(`pack_from_hsk.py ${HSK} reproduces packs/zh from an empty dir (${names.length} files incl. the jsonified .js; ${NOT_GENERATED.length} non-generated seeded) and docs/ZH_GLOSS.md + docs/ZH_TIERS.md + docs/ZH_PATTERNS.md byte for byte (drift: ${[...drift, ...docDrift].join(", ") || "none"}${g.status ? `, exit ${g.status}` : ""})`,
      g.status === 0 && drift.length === 0 && docDrift.length === 0);
  }
})();

(function(){
  console.log("\n[2] wordOpts (recall/gap distractors)");
  let bad = 0; const badEx = [];
  sample(WORDS, 400).forEach(e=>{
    const ds = VC.wordOpts(e, WORDS);
    const ws = [e.w, ...ds.map(d=>d.w)].map(VC.normKey);
    const f2 = VC.firstTwoWords(e.en);
    const ok = ds.length === 3 && new Set(ws).size === 4 && ds.every(d => d.id !== e.id &&
      VC.normKey(d.en) !== VC.normKey(e.en) && !(f2 && VC.firstTwoWords(d.en) === f2));
    if(!ok){ bad++; if(badEx.length<5) badEx.push({w:e.w, en:e.en, ds:ds.map(d=>[d.w,d.en])}); }
  });
  badEx.forEach(b=>console.log("    ", JSON.stringify(b)));
  check("zh: 3 distractors, answer never repeated, no same-gloss / same-first-two-words distractor (400 samples)", bad === 0);

  // synthetic pool: preference order pos+lv > lv > pos > anything
  const mk = (id, w, en, lv, pos) => ({ id, w, en, lv, pos });
  const ans = mk("a", "correre", "to run", "A1", "v");
  const pool = [ans,
    mk("b1","mangiare","to eat","A1","v"), mk("b2","bere","to drink","A1","v"), mk("b3","dormire","to sleep","A1","v"), mk("b4","parlare","to speak","A1","v"),
    mk("c1","casa","house","A1","n"), mk("c2","gatto","cat","A1","n"),
    mk("d1","nuotare","to swim","A2","v"), mk("e1","libro","book","A2","n"),
    mk("x1","correre","to run (fast)","A2","v"), mk("x2","scappare","to run away","A1","v"), mk("x3","fuggire","to run","A2","v")];
  let prefOk = true, neverBad = true;
  for(let i=0;i<200;i++){
    const ds = VC.wordOpts(ans, pool);
    if(!ds.every(d=>d.pos==="v" && d.lv==="A1")) prefOk = false;
    if(ds.some(d=>d.id.startsWith("x"))) neverBad = false;
  }
  check("synthetic: all 3 picks are same pos AND same level when 3+ exist", prefOk);
  check("synthetic: never picks same surface form, same gloss, or same first-two gloss words", neverBad);
  const pool2 = [ans, mk("b1","mangiare","to eat","A1","v"), mk("c1","casa","house","A1","n"), mk("c2","gatto","cat","A1","n"),
    mk("d1","nuotare","to swim","A2","v"), mk("e1","libro","book","A2","n"), mk("e2","rosso","red","A2","adj")];
  let tierOk = true;
  for(let i=0;i<200;i++){
    const ids = VC.wordOpts(ans, pool2).map(d=>d.id).sort();
    if(!util.isDeepStrictEqual(ids, ["b1","c1","c2"])) tierOk = false;
  }
  check("synthetic: falls back to same level (any pos) before other levels", tierOk);
  const tiny = [ans, mk("t1","x","one thing","A1"), mk("t2","y","one thing more","A1")];
  const td = VC.wordOpts(ans, tiny);
  check("synthetic: tiny pool returns what it can without duplicates", td.length === 2 && new Set(td.map(d=>d.w)).size === 2);
})();

(function(){
  console.log("\n[3] typing normaliser");
  const P = { levels:[{id:"A1",label:"A1"},{id:"A2",label:"A2"},{id:"B1",label:"B1"},{id:"B2",label:"B2"}],
    typing:{ caseSensitive:false, accents:"lenient", strictFromLevel:"B1" } };
  const A1 = { id:"1", w:"perché", en:"why", lv:"A1" };
  const B1 = Object.assign({}, A1, { lv:"B1" });
  const B2 = Object.assign({}, A1, { lv:"B2" });
  const tu = { id:"2", w:"tu", en:"you", lv:"A1", alt:["te", "Lei"] };
  const cases = [
    [P, A1, "perche", true, "A1 lenient: accent-less accepted"],
    [P, A1, "PERCHÉ", true, "case-insensitive"],
    [P, A1, "  perché  ", true, "trimmed"],
    [P, A1, "perchè", true, "wrong accent folded when lenient"],
    [P, B1, "perche", false, "B1 (= strictFromLevel): accents required"],
    [P, B2, "perche", false, "B2 (after strictFromLevel): accents required"],
    [P, B1, "Perché", true, "B1: exact accents, case still folded"],
    [P, B1, "perchè", false, "B1: wrong accent rejected"],
    [P, tu, "te", true, "alt form accepted"],
    [P, tu, "lei", true, "alt form case-folded"],
    [P, tu, "voi", false, "wrong word rejected"],
    [P, tu, "   ", false, "blank rejected"],
    [Object.assign({}, P, {typing:{caseSensitive:true, accents:"lenient", strictFromLevel:null}}), A1, "Perche", false, "caseSensitive: capital rejected"],
    [Object.assign({}, P, {typing:{caseSensitive:true, accents:"lenient", strictFromLevel:null}}), B2, "perche", true, "strictFromLevel null: lenient at every level"],
    [Object.assign({}, P, {typing:{caseSensitive:false, accents:"strict", strictFromLevel:null}}), A1, "perche", false, "accents strict: never folded"],
    [P, { id:"3", w:"l’acqua", en:"the water", lv:"A1" }, "l'acqua", true, "typographic apostrophe unified"],
    [P, { id:"4", w:"über", en:"over", lv:"A1" }, "uber", true, "umlaut folded when lenient"],
    [P, { id:"5", w:"niño", en:"child", lv:"B1" }, "nino", false, "tilde kept when strict level"],
  ];
  let ok = true;
  cases.forEach(([pack, entry, input, expect, why])=>{
    const got = VC.acceptTyped(input, entry, pack);
    if(got !== expect) ok = false;
    console.log(`    ${got===expect?"ok ":"BAD"} ${why}: acceptTyped(${JSON.stringify(input)}, ${entry.w}@${entry.lv}) = ${got}`);
  });
  check("typing normaliser: case, accents lenient vs strict per level, alt forms", ok);
  check("cloze typed answer accepts the literal surface form passed as extra", VC.acceptTyped("sono", {id:"e",w:"essere",en:"to be",lv:"A1"}, P, ["sono"]));
  check("typingEnabled false for zh (typing:null)", VC.typingEnabled(PACK) === false);
})();

(function(){
  console.log("\n[4] strata / placementStopIndex");
  const st = VC.strata(WORDS, PACK.placement, PACK.setSize);
  const counts = st.map((b,i)=>VC.placementItemCount(i));
  const total = counts.reduce((a,b)=>a+b, 0);
  console.log(`    ${st.length} buckets, ${total} items; words per bucket: ${st.map(b=>b.words.length).join(",")}`);
  check("zh placement: 16 buckets totalling 56 items", st.length === 16 && total === 56);
  check("every bucket has enough words for its item count", st.every((b,i)=>b.words.length >= counts[i]));
  const byLv = VC.wordsByLevel(WORDS, PACK);
  const lastEnds = PACK.placement.every(([lv])=>{ const bs = st.filter(b=>b.lv===lv); return bs[bs.length-1].s1 === VC.nSets(byLv[lv], PACK.setSize); });
  check("each level's last bucket ends exactly at its set count", lastEnds);
  check("strata honours a non-10 setSize", (()=>{ const s = VC.strata(WORDS, [["1",2]], 5); return s.length===2 && s[1].s1 === Math.ceil(byLv["1"].length/5); })());
  // pack.placementItems: cycled per bucket; the default is 3 then 4 since placement-mix (was 2 then 3), so every bucket asks each kind.
  check("placementItemCount default (no pack arg): 3,4,3,4,...",
    [0,1,2,3,4].every(i => VC.placementItemCount(i) === (i%2===0?3:4)));
  check("placementItemCount with pack.placementItems unset: same as default", [0,1,2,3].every(i => VC.placementItemCount(i, PACK) === (i%2===0?3:4)));
  check("placementItemCount cycles a custom pack.placementItems", [0,1,2,3,4,5].every(i => VC.placementItemCount(i, {placementItems:[4,1,2]}) === [4,1,2][i%3]));
  // placement-mix (TODO.md "placement leniency"): placement asks what Review asks, read-or-hear, recall and typed.
  const TYP = { typing: { accents: "lenient", strictFromLevel: "B1" } }, NOTYP = { typing: null };
  check("placementKinds: bucket b starts at kind b mod 3 and rotates read, recall, type",
    JSON.stringify([0,1,2,3].map(b => VC.placementKinds(b, 4, TYP))) === JSON.stringify([["read","recall","type","read"],["recall","type","read","recall"],["type","read","recall","type"],["read","recall","type","read"]]));
  check("placementKinds: every 3- and 4-item bucket of a typing pack asks each kind at least once",
    [0,1,2,3,4,5].every(b => [3,4].every(n => VC.PLACEMENT_KINDS.every(k => VC.placementKinds(b, n, TYP).includes(k)))));
  check("placementKinds: a pack without typing asks recall in the type slot (Review's substitute), never type",
    [0,1,2].every(b => { const k = VC.placementKinds(b, 4, NOTYP), t = VC.placementKinds(b, 4, TYP); return !k.includes("type") && k.every((x, j) => x === (t[j] === "type" ? "recall" : t[j])); }));
  check("placementKinds: typing \"pron\" counts as typing; no rng (same output twice)", VC.placementKinds(2, 3, { typing: "pron" })[0] === "type" && JSON.stringify(VC.placementKinds(5, 4, TYP)) === JSON.stringify(VC.placementKinds(5, 4, TYP)));
  check("zh placement (this suite's typing:null copy): 56 items, no type, a third or more recall",
    (() => { const ks = st.flatMap((_, i) => VC.placementKinds(i, counts[i], PACK)); return ks.length === 56 && !ks.includes("type") && ks.filter(k => k === "recall").length >= 56 / 3; })());
  {
    let dir = process.env.LANG_REPOS_DIR || null;
    if(!dir) for(let d = path.join(ROOT, ".."); ; d = path.dirname(d)){ if(fs.existsSync(path.join(d, "italian", "pack", "pack.js"))){ dir = d; break; } if(path.dirname(d) === d) break; }
    const sib = lang => { const f = dir && path.join(dir, lang, "pack"); return f && fs.existsSync(path.join(f, "pack.js")) ? { pack: loadConst(path.join(f, "pack.js"), "PACK"), words: loadConst(path.join(f, "words.js"), "WORDS") } : null; };
    const total = (pack, words) => { const s = VC.strata(words, pack.placement, VC.setSizeOf(pack)); const ks = s.flatMap((_, i) => VC.placementKinds(i, VC.placementItemCount(i, pack), pack));
      return { buckets: s.length, n: ks.length, type: ks.filter(k => k === "type").length, recall: ks.filter(k => k === "recall").length, read: ks.filter(k => k === "read").length }; };
    const it = sib("italian"), zh = sib("chinese");
    if(!it || !zh) console.log("    skip: sibling italian/chinese packs not found (LANG_REPOS_DIR)");
    else {
      const ti = total(it.pack, it.words), tz = total(zh.pack, zh.words);
      console.log(`    italian ${JSON.stringify(ti)}; chinese ${JSON.stringify(tz)}`);
      check("italian (typing, strict from B1): 12 buckets, 42 items, 14 of each kind", ti.buckets === 12 && ti.n === 42 && ti.type === 14 && ti.recall === 14 && ti.read === 14);
      check("chinese (typing \"pron\"): 16 buckets, 56 items, typed items asked", tz.buckets === 16 && tz.n === 56 && tz.type >= 18);
      const nt = total(Object.assign({}, it.pack, { typing: null }), it.words);
      check("italian copy without typing: 42 items, none typed, 28 recall", nt.n === 42 && nt.type === 0 && nt.recall === 28);
    }
  }
  const allRight = Array.from({length:6}, ()=>({r:3,n:3}));
  check("all buckets correct -> null", VC.placementStopIndex(allRight) === null);
  check("bucket 3 entirely wrong, right on both sides -> skipped (isolated zero), placement runs to the end", VC.placementStopIndex([{r:3,n:3},{r:3,n:3},{r:3,n:3},{r:0,n:3},{r:3,n:3},{r:3,n:3}]) === null);
  check("a single miss in a big-enough bucket 0 still passes", VC.placementStopIndex([{r:3,n:4},{r:3,n:3},{r:3,n:3},{r:3,n:3}]) === null);
  // pack.placementWhole (fb48, docs/PACK_SCHEMA.md "placementWhole"): the largest passed prefix of the whole result.
  const W = { whole: true }, rn = (r, n) => r.map((x, i) => ({ r: x, n: n[i] }));
  const REPORTED = rn([1,3,2,0,2,2,2,2,2,3,1,2], [2,3,2,3,2,3,2,3,2,3,2,3]);
  check("whole: the reported record (19/25 over buckets 0-9, bucket 3 isolated) -> 10 (the old 3-bucket window rule gave 0)", VC.placementStopIndex(REPORTED, W) === 10 && VC.placementStopIndex(REPORTED) === 10);
  check("whole: the skipped bucket of the reported record is [3]", JSON.stringify(VC.placementSkipped(REPORTED, 10)) === "[3]");
  check("whole: all buckets right -> null", VC.placementStopIndex(allRight, W) === null);
  check("whole: a 0/n first bucket -> 0 (no left neighbour, never skipped)", VC.placementStopIndex(rn([0,3,3,3,3,3], [3,3,3,3,3,3]), W) === 0);
  check("whole: two adjacent zero buckets stop at the first of them", VC.placementStopIndex(rn([3,3,3,0,0,3,3,3], [3,3,3,3,3,3,3,3]), W) === 3);
  check("whole: an isolated zero in the middle is skipped, the run goes on to the end (null)", VC.placementStopIndex(rn([3,3,0,3,3,3], [3,3,3,3,3,3]), W) === null);
  check("whole: a zero last bucket is not isolated (no bucket after it) -> stops there", VC.placementStopIndex(rn([3,3,3,3,0], [3,3,3,3,3]), W) === 4);
  check("whole: a zero bucket followed by a zero is not isolated even when accuracy holds", VC.placementStopIndex(rn([6,6,6,6,0,0], [6,6,6,6,3,3]), W) === 4);
  check("whole: accuracy exactly 0.75 passes (3/4 over one bucket)", VC.placementStopIndex(rn([3], [4]), W) === null);
  check("whole: 0.75 exactly passes, just under stops (3/4+3/4 = 6/8 passes; 3/4+2/4 = 5/8 stops at 1)", VC.placementStopIndex(rn([3,3], [4,4]), W) === null && VC.placementStopIndex(rn([3,2], [4,4]), W) === 1);
  check("whole: the largest k wins over a smaller passing prefix (a later recovery)", VC.placementStopIndex(rn([3,1,1,3,3,3], [3,3,3,3,3,3]), W) === null);
  check("whole: empty result -> null", VC.placementStopIndex([], W) === null);
  check("opts are ignored since the flag collapse (the whole-result rule is the only one)", VC.placementStopIndex(REPORTED, { whole: false }) === 10 && VC.placementStopIndex(rn([3,3,3,0,3,3], [3,3,3,3,3,3])) === null);
  check("whole: applyPlacement at the stop seeds provisional, prog.pl is the landing bucket's level", (() => {
    const st = VC.strata(WORDS, PACK.placement, PACK.setSize), n = st.length;
    const res = st.map((_, i) => ({ r: i === 3 ? 0 : 3, n: 3 })); res[n-1] = { r: 0, n: 3 }; res[n-2] = { r: 0, n: 3 };
    const k = VC.placementStopIndex(res, W), out = VC.applyPlacement(VC.defaultProg(PACK), st, k, WORDS, PACK);
    return k === n - 2 && out.placedOnce === true && out.pl === String(st[k].lv) && Object.values(out.w).every(r => r.prov === 1);
  })());
  check("fb53: a retake landing lower keeps prog.pl and the placed records; a higher one raises pl", (() => {
    const st = VC.strata(WORDS, PACK.placement, PACK.setSize);
    const hi = VC.applyPlacement(VC.defaultProg(PACK), st, 10, WORDS, PACK);
    const lo = VC.applyPlacement(hi, st, 0, WORDS, PACK);
    const up = VC.applyPlacement(VC.applyPlacement(VC.defaultProg(PACK), st, 3, WORDS, PACK), st, 10, WORDS, PACK);
    return hi.pl === String(st[10].lv) && lo.pl === hi.pl && util.isDeepStrictEqual(lo.w, hi.w) && up.pl === hi.pl
      && util.isDeepStrictEqual(lo.sets, hi.sets);
  })());
})();

(function(){
  console.log("\n[5] progress shape (pack-supplied levels)");
  const L = VC.levelIds(PACK);
  const bad = [{w:null}, {sets:null}, {lessons:null}, [1,2], {v:2}, {sets:{"5":1}}, {sets:{"1":"x"}}, {w:{w0001:{r:"1"}}},
    {s:{s0001:null}}, {showPron:"yes"}, {theme:"blue"}, {soundsOpened:"x"}, {w:{w0001:{prov:"x"}}}];
  let allRejected = true;
  bad.forEach(b=>{ const v = VC.validateProgShape(b, L); if(v.ok) allRejected = false; console.log(`    ${v.ok?"BAD":"ok "} rejects ${JSON.stringify(b)}${v.ok?"":" -> "+v.reason}`); });
  check("validateProgShape rejects malformed shapes", allRejected);
  const good = { v:1, w:{w0001:{r:2,w:1,s:1,prov:1}, w0002:{r:0,w:0,s:0,d:1}}, s:{s0001:{r:1,w:0,s:1}}, sets:{"1":3,"2":0},
    lessons:{tones:1}, sessions:4, theme:null, showPron:false, placedOnce:true, soundsOpened:true };
  check("validateProgShape accepts a real export shape", VC.validateProgShape(good, L).ok === true);
  check("sets keys are checked against the pack's own levels", VC.validateProgShape({sets:{"A1":1}}, ["A1","A2"]).ok && !VC.validateProgShape({sets:{"1":1}}, ["A1","A2"]).ok);
  const n = VC.normalizeProg(good, PACK);
  check("normalizeProg keeps data and fills every pack level's sets counter", n.v===1 && n.sets["1"]===3 && n.sets["4"]===0 && n.w.w0001.s===1 && n.showPron===false && n.lessons.tones===1);
  const d = VC.normalizeProg({}, PACK);
  check("normalizeProg({}) gives full defaults", util.isDeepStrictEqual(d, VC.defaultProg(PACK)) && d.showPron === true);
  check("storage key is vocab_<pack.key>", VC.storageKey(PACK) === "vocab_zh");
  const m = {}; VC.markRec(m, "k", true, true); VC.markRec(m, "k", true, true); VC.markRec(m, "k", false, true);
  check("markRec counts right/wrong and resets streak on a miss", m.k.r===2 && m.k.w===1 && m.k.s===0);
  const pv = { k:{r:1,w:0,s:1,prov:1} }; VC.markRec(pv, "k", false, true);
  check("markRec clears provisional on a miss", pv.k.prov === undefined);
})();

(function(){
  console.log("\n[6] cloze gap candidates");
  const fw = new Set(PACK.functionWords);
  let fwHits = 0, offLevel = 0, notLocatable = 0, withGap = 0, repeatHits = 0;
  const LONGER_SURFACES = [...new Set([...WORDS.flatMap(w=>[w.w, ...(w.alt||[])]), ...(PACK.compounds||[])])];
  SENTENCES.forEach(s=>{
    const idxs = VC.gapCandidateIndices(s, BY_ID, PACK);
    if(idxs.length) withGap++;
    idxs.forEach(i=>{
      const id = s.words[i], e = BY_ID[id];
      if(fw.has(id)) fwHits++;
      if(e.lv !== s.lv) offLevel++;
      if(s.words.filter(x=>x===id).length > 1) repeatHits++;
      // Independent re-derivation (not via gapMatch): the blank must cover exactly one
      // surface of the word, the rest of the text must be untouched, the surface must
      // occur once, and (spaced=false) no longer pack word/compound may span it.
      const m = VC.gapMatch(s, e, BY_ID, PACK);
      const forms = [e.w, ...(e.alt||[])];
      const b = m && VC.blankSentence(s, m);
      const exact = !!m && m.end > m.start && forms.includes(m.text) && b.before + m.text + b.after === s.t
        && s.t.split(m.text).length === 2;
      const longer = LONGER_SURFACES.filter(x => x.length > (m ? m.text.length : 0) && m && x.includes(m.text));
      const spanned = !!m && longer.some(x => { let i = s.t.indexOf(x); while(i >= 0){ if(i <= m.start && i + x.length >= m.end) return true; i = s.t.indexOf(x, i+1); } return false; });
      if(!exact || spanned) notLocatable++;
    });
  });
  console.log(`    ${withGap} / ${SENTENCES.length} zh sentences have >=1 legal blank`);
  check("zh: no gap candidate is a pack function word", fwHits === 0);
  check("zh: no gap candidate is off-level or repeated in its sentence", offLevel === 0 && repeatHits === 0);
  check("zh: every gap blank covers exactly one occurrence of the word's surface, rest of text intact, not inside a longer pack word/compound", notLocatable === 0);
  check("zh: a meaningful share of sentences can be gapped (>=50%)", withGap / SENTENCES.length >= 0.5);

  const P = { levels:[{id:"A1",label:"A1"}], functionWords:["io","uno"] };
  const W = { io:{id:"io",w:"io",en:"I",lv:"A1"}, essere:{id:"essere",w:"essere",en:"to be",lv:"A1",alt:["sono"]},
    uno:{id:"uno",w:"uno",en:"a",lv:"A1"}, studente:{id:"studente",w:"studente",en:"student",lv:"A1"},
    casa:{id:"casa",w:"casa",en:"house",lv:"A1"} };
  const s1 = { id:"s1", t:"Io sono uno studente.", en:"I am a student.", lv:"A1", words:["io","essere","uno","studente"] };
  check("spaced: function words excluded; alt surface form locates inflected word", util.isDeepStrictEqual(VC.gapCandidateIndices(s1, W, P), [1,3]));
  const s2 = { id:"s2", t:"La studentessa è qui.", en:"x", lv:"A1", words:["studente"] };
  check("spaced: whole-word match only (studente not found inside studentessa)", VC.gapCandidateIndices(s2, W, P).length === 0);
  const s3 = { id:"s3", t:"Casa mia è la tua casa.", en:"x", lv:"A1", words:["casa","casa"] };
  check("repeated word is never a candidate", VC.gapCandidateIndices(s3, W, P).length === 0);
  const s4 = { id:"s4", t:"Casa!", en:"x", lv:"A1", words:["casa"] };
  const m4 = VC.locateWord(s4, W.casa, P);
  check("spaced: match is case-insensitive and blank keeps surrounding text", m4 && VC.blankSentence(s4, m4).after === "!" && m4.text === "Casa");

  // Reduplication (either side) and a trailing clitic (pack.clitics) extend the blank to
  // the whole token: TODO.md "Gap blank on reduplicated inflections" (Indonesian).
  const IDP = { levels:[{id:"A1",label:"A1"}], functionWords:[], clitics:["nya","lah","kah","ku","mu"] };
  const IDW = { anak:{id:"anak",w:"anak",en:"child",lv:"A1"}, alat:{id:"alat",w:"alat",en:"tool",lv:"A1"},
    rumah:{id:"rumah",w:"rumah",en:"house",lv:"A1"}, ada:{id:"ada",w:"ada",en:"there is",lv:"A1"},
    adalah:{id:"adalah",w:"adalah",en:"is",lv:"A1"}, mobil:{id:"mobil",w:"mobil",en:"car",lv:"A1"} };
  const rs1 = { id:"r1", t:"Anak-anak bermain.", en:"x", lv:"A1", words:["anak"] };
  const rm1 = VC.gapMatch(rs1, IDW.anak, IDW, IDP);
  check("reduplication both sides visible (anak-anak) -> whole token blanked, not null (not \"visible twice\")",
    rm1 && rm1.text === "Anak-anak" && VC.blankSentence(rs1, rm1).after === " bermain.");
  const rs2 = { id:"r2", t:"Kumpulkan alat-alatnya sekarang.", en:"x", lv:"A1", words:["alat"] };
  const rm2 = VC.gapMatch(rs2, IDW.alat, IDW, IDP);
  check("reduplication + trailing clitic (alat-alatnya) -> whole token blanked, including -nya",
    rm2 && rm2.text === "alat-alatnya" && VC.blankSentence(rs2, rm2).before === "Kumpulkan ");
  const rs3 = { id:"r3", t:"Ini rumahnya.", en:"x", lv:"A1", words:["rumah"] };
  const rm3 = VC.gapMatch(rs3, IDW.rumah, IDW, IDP);
  check("trailing clitic alone, no reduplication (rumahnya) -> blank includes -nya",
    rm3 && rm3.text === "rumahnya");
  const rs4 = { id:"r4", t:"Rumah itu besar.", en:"x", lv:"A1", words:["rumah"] };
  const rm4 = VC.gapMatch(rs4, IDW.rumah, IDW, IDP);
  check("plain word, no reduplication or clitic -> blank is just the word (no over-extension)",
    rm4 && rm4.text === "Rumah");
  // A fused clitic that spells a different real pack word (ada+lah = adalah) must never be
  // blanked as if it were entry+clitic: that would blank the wrong word.
  const rs5 = { id:"r5", t:"Ini adalah buku.", en:"x", lv:"A1", words:["ada"] };
  const rm5 = VC.gapMatch(rs5, IDW.ada, IDW, IDP);
  check("fused clitic colliding with a real pack word (ada+lah=adalah) -> no match, not the wrong word blanked",
    rm5 === null);
  // The right-side repeat needs its own boundary: "mobil-mobilan" is one word (a toy car),
  // not "mobil" reduplicated with a dangling "an".
  const rs6 = { id:"r6", t:"Ini mobil-mobilan.", en:"x", lv:"A1", words:["mobil"] };
  const rm6 = VC.gapMatch(rs6, IDW.mobil, IDW, IDP);
  check("right-side repeat boundary (mobil-mobilan) -> blank stops at the first mobil, not mid-word",
    rm6 && rm6.text === "mobil" && VC.blankSentence(rs6, rm6).after === "-mobilan.");
})();

(function(){
  console.log("\n[7] Today item plans");
  const typingPack = Object.assign({}, PACK, { typing:{caseSensitive:false, accents:"lenient", strictFromLevel:null} });
  let shareOk = true, sizeOk = true, dupOk = true, typeSeen = false, noTypeWhenOff = true, minShare = 1;
  [5, 6, 9, 15, 16, 40, 200].forEach(n=>{
    const learned = WORDS.slice(0, n);
    const prog = VC.defaultProg(PACK);
    learned.slice(0, 7).forEach(w=>{ prog.w[w.id] = {r:1,w:0,s:1,prov:1}; });
    [PACK, typingPack].forEach(pk=>{
      for(let rep=0; rep<50; rep++){
        const plan = VC.buildReviewPlan(learned, prog, pk);
        const prod = plan.filter(p=>VC.PRODUCTION_KINDS.includes(p.kind)).length;
        const share = prod / plan.length; minShare = Math.min(minShare, share);
        if(share < VC.REVIEW_PRODUCTION_SHARE) shareOk = false;
        if(plan.length !== Math.min(VC.REVIEW_SIZE, n)) sizeOk = false;
        if(new Set(plan.map(p=>p.word.id)).size !== plan.length) dupOk = false;
        if(plan.some(p=>p.kind==="type")){ if(pk===PACK) noTypeWhenOff = false; else typeSeen = true; }
      }
    });
  });
  console.log(`    min production share observed: ${minShare.toFixed(3)}`);
  check("review step: production (recall/type) share >= 40% for every pool size", shareOk);
  check("review step: size = min(15, learned) with no repeated word", sizeOk && dupOk);
  check("review step: type items only when the pack has typing", typeSeen && noTypeWhenOff);
  const prog = VC.defaultProg(PACK);
  const learned = WORDS.slice(0, 30);
  learned.slice(0, 3).forEach(w=>{ prog.w[w.id] = {r:1,w:0,s:1,prov:1}; });
  const hasProv = VC.buildReviewPlan(learned, prog, PACK).filter(p=>prog.w[p.word.id] && prog.w[p.word.id].prov).length;
  check("review step: provisional (placement-guessed) words are always included", hasProv === 3);
  learned.slice(10, 13).forEach(w=>{ prog.w[w.id] = {r:0,w:5,s:0}; });
  let weakIn = true;
  for(let i=0;i<30;i++){ const ids = new Set(VC.buildReviewPlan(learned, prog, PACK).map(p=>p.word.id)); if(!learned.slice(10,13).every(w=>ids.has(w.id))) weakIn = false; }
  check("review step: weakest words are always included", weakIn);
  const rp = VC.buildRecallPlan(learned, prog, typingPack, 8);
  check("recall step: 8 items, all production, recall+type mixed when typing on", rp.length === 8 && rp.every(p=>VC.PRODUCTION_KINDS.includes(p.kind)) && rp.some(p=>p.kind==="type") && rp.some(p=>p.kind==="recall"));
  check("recall step: recall only when typing off", VC.buildRecallPlan(learned, prog, PACK, 8).every(p=>p.kind==="recall"));
  // typing "pron": each "type" slot is the typed-reading or the typed-characters item,
  // alternating in plan order (VC.typeSlotKind); the plans themselves are untouched.
  const pronPack = Object.assign({}, PACK, { typing: "pron" });
  const tsPlan = ["hear","type","recall","type","read","type","type"].map(kind => ({ kind }));
  check("typeSlotKind: type slots alternate reading, characters, reading... in plan order; other kinds skipped; no index = reading",
    tsPlan.map((p, i) => p.kind === "type" ? VC.typeSlotKind(tsPlan, i) : "-").join(",") === "-,pron,-,written,-,pron,written" && VC.typeSlotKind(tsPlan) === "pron" && VC.typeSlotKind(null, 3) === "pron");
  let altBad = 0, altPron = 0, altWritten = 0;
  for(let i = 0; i < 30; i++){
    [VC.buildReviewPlan(learned, prog, pronPack), VC.buildRecallPlan(learned, prog, pronPack, 8)].forEach(plan => {
      const slots = plan.map((p, j) => p.kind === "type" ? VC.typeSlotKind(plan, j) : null).filter(Boolean);
      const np = slots.filter(k => k === "pron").length, nw = slots.length - np;
      altPron += np; altWritten += nw;
      if(slots.some((k, j) => k !== (j % 2 ? "written" : "pron")) || np - nw < 0 || np - nw > 1) altBad++;
    });
  }
  check(`zh typing "pron" Review/Recall plans: type slots alternate reading/characters, reading first (${altPron} reading, ${altWritten} characters, ${altBad} bad plans)`, altBad === 0 && altPron > 0 && altWritten > 0);
  const rpPron = VC.buildRecallPlan(learned, prog, pronPack, 8);
  check("zh typing \"pron\" recall step: 4 type slots = 2 reading + 2 characters", rpPron.filter(p => p.kind === "type").length === 4
    && rpPron.map((p, j) => p.kind === "type" ? VC.typeSlotKind(rpPron, j) : "").filter(Boolean).sort().join(",") === "pron,pron,written,written");
  const km = VC.kindMix(15, 0.4, false);
  check("kindMix(15): exactly 6 production, hear:read 2:1 over the rest", km.filter(k=>k==="recall").length===6 && km.filter(k=>k==="hear").length===6 && km.filter(k=>k==="read").length===3);
  // Missed kind (k, user decision 2026-09-28): a word-item miss remembers its kind, a pass in that kind clears it.
  { const m = {};
    VC.markRec(m, "a", false, true, "type");
    const set = m.a.k === "type";
    VC.markRec(m, "a", true, true, "hear"); const keptOther = m.a.k === "type";
    VC.markRec(m, "a", true, true, "type"); const cleared = m.a.k === undefined && !("k" in m.a);
    VC.markRec(m, "a", false, true, "hear"); VC.markRec(m, "a", false, true, "read"); const latest = m.a.k === "read";
    VC.markRec(m, "b", false, true); VC.markRec(m, "c", false, false, "recall"); VC.markRec(m, "d", false, true, "gap");
    check("markRec k: miss sets k; pass in another kind keeps it; pass in the same kind deletes it; latest miss wins", set && keptOther && cleared && latest);
    check("markRec k: no kind, a non-word record (chars/script/sentence), or a kind outside MISS_KINDS never sets k", !("k" in m.b) && !("k" in m.c) && !("k" in m.d)); }
  { const ks = (plan, id) => plan.filter(p => p.word && p.word.id === id).map(p => p.kind);
    const pk = VC.defaultProg(PACK); const L = WORDS.slice(0, 15);
    pk.w[L[0].id] = {r:0,w:1,s:0,k:"hear"}; pk.w[L[1].id] = {r:0,w:1,s:0,k:"read"}; pk.w[L[2].id] = {r:0,w:1,s:0,k:"type"}; pk.w[L[3].id] = {r:0,w:1,s:0,k:"recall"};
    let revOk = true, revTypOk = true, recOk = true, recTypOk = true, testOk = true;
    for(let i = 0; i < 20; i++){
      const r0 = VC.buildReviewPlan(L, pk, PACK), r1 = VC.buildReviewPlan(L, pk, typingPack);
      const c0 = VC.buildRecallPlan(L, pk, PACK, 15), c1 = VC.buildRecallPlan(L, pk, typingPack, 15);
      if(ks(r0, L[0].id)[0] !== "hear" || ks(r0, L[1].id)[0] !== "read" || ks(r0, L[2].id)[0] !== "recall" || ks(r0, L[3].id)[0] !== "recall") revOk = false;
      if(ks(r1, L[2].id)[0] !== "type" || ks(r1, L[0].id)[0] !== "hear") revTypOk = false;
      if(![0,1,2,3].every(j => ks(c0, L[j].id)[0] === "recall")) recOk = false;
      if(ks(c1, L[0].id)[0] !== "recall" || ks(c1, L[1].id)[0] !== "recall" || ks(c1, L[2].id)[0] !== "type" || ks(c1, L[3].id)[0] !== "recall") recTypOk = false;
      const t1 = VC.buildRecallPlan(L, pk, typingPack, 15, { missedKinds: false });
      if(!t1.every(p => VC.PRODUCTION_KINDS.includes(p.kind))) testOk = false;
    }
    check("Review plan: a word with k is asked in k (hear, read kept; type -> recall when typing is off)", revOk);
    check("Review plan, typing on: k type stays type", revTypOk);
    check("Recall plan: receptive k -> recall; typing off: every k -> recall", recOk);
    check("Recall plan, typing on: k type -> type, hear/read/recall -> recall", recTypOk);
    // Plans without k are unchanged: the helper draws no rng.
    const seeded = (f) => { const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7); return f(rng); };
    const bare = VC.defaultProg(PACK); L.forEach((w, i) => { bare.w[w.id] = {r:i%3,w:i%2,s:0}; });
    const same = JSON.stringify(seeded(rng => VC.buildReviewPlan(L, bare, typingPack, { rng }))) === JSON.stringify(seeded(rng => VC.buildReviewPlan(L, bare, typingPack, { rng, missedKinds: false })));
    check("applyMissedKinds: progress without k gives the same plan as with it skipped (seeded)", same);
    const aplan = [{ kind:"hear", word:L[2] }, { kind:"charRead", unit:{ id:"c1" } }, { kind:"type", word:L[9] }];
    const out = VC.applyMissedKinds(aplan, pk, typingPack, false);
    check("applyMissedKinds: swaps kinds with a word holding k (L[2] type, partner gets hear); unit items untouched; input not mutated",
      out[1] === aplan[1] && out[0].kind === "type" && out[2].kind === "hear" && aplan[0].kind === "hear" && aplan[2].kind === "type");
    const lone = VC.applyMissedKinds([{ kind:"hear", word:L[2] }], pk, typingPack, false);
    check("applyMissedKinds: no word holds the wanted kind -> kind kept", lone[0].kind === "hear");
    // Guarantee: the plan's kinds stay kindMix's multiset (Review production share intact);
    // at most ceil(n/2) words moved to their k, weakest first.
    const allHear = VC.defaultProg(PACK); L.forEach(w => { allHear.w[w.id] = {r:0,w:1,s:0,k:"hear"}; });
    let shareOk = true, hearMax = 0;
    for(let i = 0; i < 20; i++){
      const pl = VC.buildReviewPlan(L, allHear, PACK), ref = VC.buildReviewPlan(L, VC.defaultProg(PACK), PACK);
      const cnt = p => p.map(x => x.kind).sort().join();
      if(cnt(pl) !== cnt(ref) || pl.filter(x => VC.PRODUCTION_KINDS.includes(x.kind)).length !== 6) shareOk = false;
      hearMax = Math.max(hearMax, pl.filter(x => x.kind === "hear").length);
    }
    check(`cap: 15 words all with k=hear -> Review keeps exactly 6 production (kindMix's), same kind counts; hear items ${hearMax} (= kindMix's 6)`, shareOk && hearMax === 6);
    const cyc = VC.defaultProg(typingPack); const K4 = ["read","recall","type","hear"];
    L.slice(0, 4).forEach((w, i) => { cyc.w[w.id] = {r:0,w:1,s:0,k:K4[i]}; });
    const c4 = VC.applyMissedKinds(["hear","read","recall","type"].map((k, i) => ({ kind:k, word:L[i] })), cyc, typingPack, false);
    check("cap: 4 words in a 4-cycle of wanted kinds -> ceil(4/2)=2 moves: first two honoured, last two not, kinds still one each",
      c4.map(x => x.kind).join() === "read,recall,hear,type" && c4.map(x => x.kind).sort().join() === "hear,read,recall,type");
    const wk = VC.defaultProg(typingPack); L.slice(0, 4).forEach((w, i) => { wk.w[w.id] = {r:0,w:i===3?9:1,s:0,k:K4[i]}; });
    const c4w = VC.applyMissedKinds(["hear","read","recall","type"].map((k, i) => ({ kind:k, word:L[i] })), wk, typingPack, false);
    check("cap: the weakest word moves first (L[3], w 9, gets hear)", c4w[3].kind === "hear");
    check("Test tab (missedKinds: false) keeps kindMix's production kinds", testOk); }
  const counts = {hear:0, read:0, gap:0, gapType:0};
  for(let i=0;i<4000;i++) counts[VC.sentenceKind(PACK)]++;
  check("sentence kinds ~50/25/25 hear/read/gap; no typed gap without typing", Math.abs(counts.hear/4000-0.5)<0.04 && Math.abs(counts.gap/4000-0.25)<0.04 && counts.gapType===0);
})();

(function(){
  console.log("\n[8] meaningOpts / sentenceOpts");
  let bad = 0;
  sample(WORDS, 300).forEach(e=>{
    const ds = VC.meaningOpts(e, WORDS);
    const g = [e, ...ds].map(x=>VC.normKey(x.en));
    const f2 = ds.map(d=>VC.firstTwoWords(d.en)).filter(Boolean);
    const af2 = VC.firstTwoWords(e.en);
    if(!(ds.length===3 && new Set(g).size===4 && ds.every(d=>d.id!==e.id) && !f2.includes(af2 || "\u0000") && new Set(f2).size===f2.length)) bad++;
  });
  check("meaningOpts: 3 distinct glosses, no near-synonym (first two words) distractors (300 samples)", bad === 0);

  // meaningOpts prefers same-pos distractors like wordOpts (TODO.md "meaningOpts could also
  // prefer the same pos"), falling back to any pos when the same-pos pool is short.
  const mpAns = { id:"mp0", w:"correre", en:"to run", lv:"A1", pos:"v" };
  const mpSamePos = ["saltare:to jump","nuotare:to swim","volare:to fly"].map((x,i)=>{ const [w,en]=x.split(":"); return { id:"mv"+i, w, en, lv:"A1", pos:"v" }; });
  const mpOtherPos = ["sedia:chair","tavolo:table","porta:door"].map((x,i)=>{ const [w,en]=x.split(":"); return { id:"mn"+i, w, en, lv:"A1", pos:"n" }; });
  let mpAllSamePos = true;
  for(let i=0;i<50;i++) if(!VC.meaningOpts(mpAns, [...mpSamePos, ...mpOtherPos]).every(d=>d.pos==="v")) mpAllSamePos = false;
  check("meaningOpts: with 3+ same-pos candidates, every distractor shares the answer's pos", mpAllSamePos);
  const mpShort = VC.meaningOpts(mpAns, [mpSamePos[0], ...mpOtherPos]);
  check("meaningOpts: same-pos pool short (1) -> falls back to any pos to still fill 3",
    mpShort.length === 3 && mpShort.some(d=>d.pos==="n") && mpShort.some(d=>d.id===mpSamePos[0].id));
  let sbad = 0;
  sample(SENTENCES, 300).forEach(s=>{
    const ds = VC.sentenceOpts(s, SENTENCES);
    const en = [s, ...ds].map(x=>VC.normKey(x.en));
    if(!(ds.length===3 && new Set(en).size===4 && ds.every(d=>d.id!==s.id))) sbad++;
  });
  check("sentenceOpts: 3 distinct other sentences (300 samples)", sbad === 0);
})();

(function(){
  console.log("\n[9] learned words, set unlock, sentence availability");
  const prog = VC.normalizeProg({ sets:{"1":2} }, PACK);
  const lw = VC.learnedWords(WORDS, PACK, prog);
  check("sets {1:2} -> first 20 level-1 words learned", lw.length === 20 && lw.every(w=>w.lv==="1"));
  const byLv = VC.wordsByLevel(WORDS, PACK);
  const nnOf = p => { const nn = VC.nextNewSet(WORDS, PACK, p); return nn && { lv: nn.lv, set: nn.set, ids: nn.words.map(w => w.id) }; };
  const pre20 = new Set(VC.counterOrder(byLv["1"], PACK).slice(0, 20).map(w => w.id));
  check("nextNewSet -> level 1, set index 2, the next 10 words past the counter prefix (id order)", util.isDeepStrictEqual(nnOf(prog), {lv:"1", set:2, ids: byLv["1"].filter(w => !pre20.has(w.id)).slice(0, 10).map(w => w.id)}));
  const doneL1 = VC.normalizeProg({ sets:{"1": VC.nSets(byLv["1"], 10)} }, PACK);
  check("level 1 complete -> next set is level 2 set 0", util.isDeepStrictEqual(nnOf(doneL1), {lv:"2", set:0, ids: byLv["2"].slice(0, 10).map(w => w.id)}));
  const all = {}; VC.levelIds(PACK).forEach(lv=>{ all[lv] = VC.nSets(byLv[lv], 10); });
  const doneAll = VC.normalizeProg({ sets: all }, PACK);
  check("everything complete -> nextNewSet null, all words learned", VC.nextNewSet(WORDS, PACK, doneAll) === null && VC.learnedWords(WORDS, PACK, doneAll).length === WORDS.length);
  const avail = VC.availableSentences(SENTENCES, WORDS, PACK, doneL1);
  check("past level 1 -> every level-1 sentence available", SENTENCES.filter(s=>s.lv==="1").every(s=>avail.includes(s)));
  const lwSet = new Set(VC.learnedWords(WORDS, PACK, prog).map(w=>w.id));
  check("availability otherwise requires every word learned", VC.availableSentences(SENTENCES, WORDS, PACK, prog).every(s=>s.words.every(id=>lwSet.has(id))));
  const ahead = VC.normalizeProg({ w:{ [byLv["3"][0].id]:{r:1,w:0,s:1,d:1} } }, PACK);
  check("drilled-ahead (d) words count as learned", VC.learnedWords(WORDS, PACK, ahead).some(w=>w.id===byLv["3"][0].id));

  // Set N labels name the set holding the FIRST fresh word by rank position, not the
  // sets counter (TODO.md "Set N" fix): a gap in taught ranks, or a word inserted after a
  // level was counted complete, must not shift the label off the rank the fresh word sits at.
  const gapPack = Object.assign({}, PACK, { setSize: 10 });
  const gapWords = Array.from({length: 40}, (_, i) => ({ id: `g${i+1}`, lv: "1" }));
  const gapRecs = {}; [1,2,3,4,5,6,7,8,11,12].forEach(rank => { gapRecs[`g${rank}`] = { r:1, w:0, s:1 }; });
  const gapProg = VC.normalizeProg({ w: gapRecs }, gapPack);
  const gapNn = VC.nextNewSet(gapWords, gapPack, gapProg);
  check("Set N label: taught ranks 1-8, 11-12 (gap at 9-10) -> fresh starts at rank 9; set = sets learned by count (1, frequency tiers)",
    gapNn && gapNn.words[0].id === "g9" && gapNn.set === 1);

  const insWords = Array.from({length: 29}, (_, i) => ({ id: `i${i+1}`, lv: "1" }));
  insWords.splice(29, 0, { id: "iNew", lv: "1" }); // inserted untaught word at rank 30
  const insRecs = {}; insWords.slice(0, 29).forEach(w => { insRecs[w.id] = { r:1, w:0, s:1 }; });
  const insPack = Object.assign({}, PACK, { setSize: 10 });
  const insProg = VC.normalizeProg({ sets:{"1": VC.nSets(insWords.slice(0,29), 10)}, w: insRecs }, insPack);
  const insNn = VC.nextNewSet(insWords, insPack, insProg);
  check("Set N label: complete counter (29/29 taught) + one inserted untaught word at rank 30 -> set 3, not set 4",
    insNn && insNn.words[0].id === "iNew" && insNn.set === 2);
})();

(function(){
  console.log("\n[10] no pinyin/script-specific logic in engine/");
  // Allowed: the HTML charset declaration only. "tone" is not banned since BP2: tone
  // marks on a Latin reading are a pack-gated feature (pack.tones, core.js "pronunciation
  // aids"; tones are not specific to one language); the names below still are.
  // "char" is not banned: the characters
  // stage (pack.characters, prog.chars) is a pack-generic feature used by zh and ja
  // (docs/HSK_MERGE.md §2); language-specific terms below still are.
  // One exemption: core.js's delimited legacy-migration section (merge plan §4) reads the
  // predecessor hsk app's record, whose field names are fixed by that app. Only lines
  // strictly between its header and the export header are skipped, and the section is
  // capped in size so it cannot quietly absorb other logic.
  const ALLOW = [/<meta charset="utf-8">/];
  const LEGACY_START = "// ------------------------------------------------------------------ legacy migration";
  const LEGACY_END = "// ------------------------------------------------------------------ export";
  const LEGACY_MAX_LINES = 150;
  const hits = [];
  let legacyLines = -1;
  ["core.js", "app.html"].forEach(f=>{
    const lines = fs.readFileSync(path.join(ROOT, "engine", f), "utf8").split("\n");
    let lo = -1, hi = -1;
    if(f === "core.js"){ lo = lines.indexOf(LEGACY_START); hi = lo >= 0 ? lines.indexOf(LEGACY_END, lo) : -1; if(lo >= 0 && hi > lo) legacyLines = hi - lo - 1; else lo = hi = -1; }
    lines.forEach((line, i)=>{
      if(i > lo && i < hi) return;
      if(/pinyin|cjk|hsk|hanzi|kanji/i.test(line) && !ALLOW.some(re=>re.test(line))) hits.push(`${f}:${i+1}: ${line.trim().slice(0,100)}`);
    });
  });
  check(`core.js legacy-migration section is delimited and at most ${LEGACY_MAX_LINES} lines (${legacyLines})`, legacyLines > 0 && legacyLines <= LEGACY_MAX_LINES);
  hits.forEach(h=>console.log("    " + h));
  check("engine/ has no pinyin/CJK/hsk/hanzi/kanji references (besides <meta charset>)", hits.length === 0);
})();

(function(){
  console.log("\n[11] distractor homograph / homophone guards");
  const P = { levels:[{id:"1",label:"L1"},{id:"2",label:"L2"}] };
  const ans = { id:"a1", w:"banco", en:"bench", lv:"1", pron:"BAN-ko", alt:["banchi"] };
  const pool = [ans,
    { id:"a2", w:"banco", en:"bank (money)", lv:"2", pron:"BAN-ko2" },         // homograph, other level
    { id:"a3", w:"panca", en:"pew", lv:"1", alt:["BANCHI"] },                   // shares an alt surface
    { id:"a4", w:"vanco", en:"gap", lv:"1", pron:"ban-ko" },                    // homophone (same pron)
    { id:"b1", w:"casa", en:"house", lv:"1" }, { id:"b2", w:"gatto", en:"cat", lv:"1" },
    { id:"b3", w:"libro", en:"book", lv:"1" }, { id:"b4", w:"rosso", en:"red", lv:"2" } ];
  let meanOk = true, wordOk = true;
  for(let i=0;i<300;i++){
    const m = VC.meaningOpts(ans, pool).map(d=>d.id);
    if(m.some(id=>["a2","a3","a4"].includes(id)) || m.length !== 3) meanOk = false;
    const w = VC.wordOpts(ans, pool).map(d=>d.id);
    if(w.some(id=>["a2","a3"].includes(id)) || w.length !== 3) wordOk = false;
  }
  check("meaningOpts never offers a homograph (same w, any level), alt-sharing word, or same-pron word", meanOk);
  check("wordOpts never offers a word sharing a w/alt surface with the answer", wordOk);
  const zhHomophone = WORDS.filter(w=>w.pron).slice(0, 400).every(e => VC.meaningOpts(e, WORDS).every(d => !VC.samePron(d, e) && !VC.sharesSurface(d, e)));
  check("zh: no meaningOpts distractor shares pron or surface with the answer (400 words)", zhHomophone);
})();

(function(){
  console.log("\n[12] cloze: longer-word spans, compounds, alt leaks, apostrophes");
  const Z = { levels:[{id:"1",label:"1"}], spaced:false, functionWords:[], compounds:["这个"] };
  const ZW = { wei:{id:"wei",w:"为",en:"for",lv:"1"}, weish:{id:"weish",w:"为什么",en:"why",lv:"1"},
    zhe:{id:"zhe",w:"这",en:"this",lv:"1"}, hao:{id:"hao",w:"好",en:"good",lv:"1"} };
  const z1 = { id:"z1", t:"你为什么好？", en:"x", lv:"1", words:["wei","hao"] };
  check("spaced=false: 为 inside 为什么 (a longer pack word) is not blankable; 好 still is", util.isDeepStrictEqual(VC.gapCandidateIndices(z1, ZW, Z), [1]));
  const z2 = { id:"z2", t:"这个好。", en:"x", lv:"1", words:["zhe","hao"] };
  check("spaced=false: 这 inside pack.compounds 这个 is not blankable", util.isDeepStrictEqual(VC.gapCandidateIndices(z2, ZW, Z), [1]));
  const z3 = { id:"z3", t:"为你好。", en:"x", lv:"1", words:["wei","hao"] };
  check("spaced=false: 为 on its own is blankable", util.isDeepStrictEqual(VC.gapCandidateIndices(z3, ZW, Z), [0,1]));

  const I = { levels:[{id:"A1",label:"A1"}], functionWords:[] };
  const IW = { essere:{id:"essere",w:"essere",en:"to be",lv:"A1",alt:["sono","è"]}, lo:{id:"lo",w:"l'",en:"the",lv:"A1",alt:["lo"]},
    acqua:{id:"acqua",w:"acqua",en:"water",lv:"A1"}, per:{id:"per",w:"per",en:"for",lv:"A1"},
    perfav:{id:"perfav",w:"per favore",en:"please",lv:"A1"}, grazie:{id:"grazie",w:"grazie",en:"thanks",lv:"A1"} };
  const i1 = { id:"i1", t:"Sono qui, ed è bello.", en:"x", lv:"A1", words:["essere"] };
  check("alt leak: word visible twice via different forms (sono ... è) is not blankable", VC.gapCandidateIndices(i1, IW, I).length === 0);
  const i2 = { id:"i2", t:"Bevo l’acqua.", en:"x", lv:"A1", words:["lo","acqua"] };
  const m2 = VC.locateWord(i2, IW.lo, I);
  check("apostrophe-final surface l' matches before a letter and across ’/' variants", !!m2 && m2.text === "l’" && util.isDeepStrictEqual(VC.gapCandidateIndices(i2, IW, I), [0,1]));
  const i3 = { id:"i3", t:"Per favore, grazie per tutto.", en:"x", lv:"A1", words:["perfav","grazie","per"] };
  check("spaced: a word occurring once standalone but also inside a multi-word pack entry is rejected (two occurrences)", !VC.gapCandidateIndices(i3, IW, I).includes(2));
  const i4 = { id:"i4", t:"Per favore, grazie.", en:"x", lv:"A1", words:["perfav","per","grazie"] };
  check("spaced: per inside the multi-word entry 'per favore' is not blankable", util.isDeepStrictEqual(VC.gapCandidateIndices(i4, IW, I), [0,2]));
  const m4 = VC.gapMatch(i4, IW.perfav, IW, I);
  const b4 = VC.blankSentence(i4, m4);
  check("blank covers exactly the located surface", b4.before === "" && b4.answer === "Per favore" && b4.after === ", grazie.");
})();

(function(){
  console.log("\n[13] boot / import / placement / gates");
  const L = VC.levelIds(PACK);
  check("validateProgShape rejects non-integer and negative sets values", !VC.validateProgShape({sets:{"1":1.5}}, L).ok && !VC.validateProgShape({sets:{"1":-1}}, L).ok);
  check("parseStored rejects array / string / number / null / invalid JSON", ["[1]", '"x"', "3", "null", "{bad"].every(r => !VC.parseStored(r).ok));
  const b0 = VC.bootProg(null, PACK);
  check("boot: nothing stored -> defaults, no backup", b0.backupRaw === null && util.isDeepStrictEqual(b0.prog, VC.defaultProg(PACK)));
  const b1 = VC.bootProg("{not json", PACK);
  check("boot: unparseable -> defaults + raw string handed back for invalid_backup", b1.backupRaw === "{not json" && b1.prog.sessions === 0);
  const b2 = VC.bootProg("[1,2]", PACK);
  check("boot: non-object JSON -> backup, not Object.assign'ed", b2.backupRaw === "[1,2]" && !Array.isArray(b2.prog));
  const renamed = JSON.stringify({ v:1, w:{w0001:{r:3,w:0,s:3}}, sets:{"1":4,"HSK5":2}, sessions:9, lessons:{tones:1} });
  const b3 = VC.bootProg(renamed, PACK);
  check("boot: unknown sets key (renamed level) dropped, everything else kept, no backup", b3.backupRaw === null && util.isDeepStrictEqual(b3.dropped, ["HSK5"]) && b3.prog.sets["1"] === 4 && b3.prog.sessions === 9 && b3.prog.w.w0001.s === 3 && !("HSK5" in b3.prog.sets));
  const b4 = VC.bootProg(JSON.stringify({ w:{x:{r:"bad"}} }), PACK);
  check("boot: otherwise-invalid shape -> backup + defaults", b4.backupRaw !== null && Object.keys(b4.prog.w).length === 0);
  const prev = Object.assign(VC.defaultProg(PACK), { theme:"dark", showPron:false, sessions:3 });
  const im1 = VC.applyImport(prev, JSON.stringify({ sets:{"1":2}, sessions:7 }), PACK);
  check("import: valid -> normalised, keeps current theme/showPron when absent", im1.ok && im1.prog.sessions === 7 && im1.prog.sets["4"] === 0 && im1.prog.theme === "dark" && im1.prog.showPron === false);
  const im2 = VC.applyImport(prev, JSON.stringify({ sets:{"HSK5":1} }), PACK);
  check("import: stays strict (unknown level rejected)", !im2.ok && /unknown level/.test(im2.reason));
  check("import: non-object rejected", !VC.applyImport(prev, "[]", PACK).ok);

  // applyPlacement
  const st = VC.strata(WORDS, PACK.placement, PACK.setSize);
  const before = VC.normalizeProg({ w:{ w0001:{r:5,w:0,s:4}, w0002:{r:1,w:0,s:1,prov:1}, w0600:{r:0,w:0,s:0,d:1}, w0003:{r:2,w:0,s:2,prov:1} }, sets:{"1":1} }, PACK);
  const snapshot = JSON.stringify(before);
  const after = VC.applyPlacement(before, st, 4, WORDS, PACK);
  check("applyPlacement is pure (input untouched)", JSON.stringify(before) === snapshot);
  check("applyPlacement: sets = max(existing, furthest passed bucket end) per level", after.sets["1"] === st[2].s1 && after.sets["2"] === st[3].s1 && after.sets["3"] === 0 && after.placedOnce === true);
  check("applyPlacement: every existing record kept unchanged (mastered, provisional, drilled-ahead)",
    util.isDeepStrictEqual(after.w.w0001, before.w.w0001) && util.isDeepStrictEqual(after.w.w0002, before.w.w0002) &&
    util.isDeepStrictEqual(after.w.w0600, before.w.w0600) && util.isDeepStrictEqual(after.w.w0003, before.w.w0003));
  check("applyPlacement: every newly covered word without a record seeded provisional (flags only added)",
    VC.learnedWords(WORDS, PACK, after).every(w => after.w[w.id]) &&
    Object.keys(after.w).filter(k => !before.w[k]).every(k => after.w[k].prov === 1));
  // Regression (browser verification): a poor retake wiped session-learned words.
  const advanced = VC.normalizeProg({ sets:{"1":14,"2":3}, w:{ w0141:{r:4,w:1,s:3} } }, PACK);
  const learnedBefore = VC.learnedWords(WORDS, PACK, advanced).map(w=>w.id);
  const poor = VC.applyPlacement(advanced, st, 1, WORDS, PACK);
  check("applyPlacement: a poor retake never lowers any level's sets", VC.levelIds(PACK).every(lv => poor.sets[lv] >= advanced.sets[lv]) && poor.sets["1"] === 14 && poor.sets["2"] === 3);
  check("applyPlacement: a poor retake keeps every learned word and its record", learnedBefore.every(id => VC.learnedWords(WORDS, PACK, poor).some(w=>w.id===id)) && util.isDeepStrictEqual(poor.w.w0141, advanced.w.w0141));
  check("applyPlacement: nothing passed on a fresh learner -> all sets 0, no records", Object.values(VC.applyPlacement(VC.defaultProg(PACK), st, 0, WORDS, PACK).sets).every(n => n === 0));

  // dedupeMisses (Today "Missed" list)
  const miss = [{key:"w:a", reveal:"hearA"}, {key:"w:b", reveal:"readB"}, {key:"w:a", reveal:"readA"}, {key:"s:1", reveal:"s"}, {key:"w:a", reveal:"recallA"}, {reveal:"nokey"}];
  const dm = VC.dedupeMisses(miss);
  check("dedupeMisses: one entry per key (word missed as hear+read+recall shows once), most-missed first",
    dm.length === 4 && dm[0].item.reveal === "hearA" && dm[0].count === 3 && dm.slice(1).map(d=>d.item.reveal).join(",") === "readB,s,nokey");

  // gates
  check("todayGates: review needs 5, listen/recall 4, sentences 8, learn needs a next set",
    util.isDeepStrictEqual(VC.todayGates(4, true, 7), {review:false, learn:true, listen:true, recall:true, sentences:false}) &&
    util.isDeepStrictEqual(VC.todayGates(5, false, 8), {review:true, learn:false, listen:true, recall:true, sentences:true}));
  check("testGates: learn-first notice gates on learned words only (>= TEST_MIN_WORDS), never on sentences",
    VC.TEST_MIN_WORDS === 8 && VC.testGates(8, 0).needPlacement === false && VC.testGates(10, 0).needPlacement === false &&
    VC.testGates(7, 50).needPlacement === true && VC.testGates(10, 0).sentences === false && VC.testGates(10, 8).sentences === true && VC.testGates(10, 0).words === true);

  // The Today plan's Listen line must count the same 12 words hearItem() actually drills
  // as Listen (app.html's canHearWord: hasSpeech, or a per-word recorded clip), not just
  // assume all 12 will be — a word canHearWord rejects becomes a Read item instead.
  {
    const listenPool = WORDS.slice(0, 20);
    check("listenPlanCount: no voice and no pack audio -> none of the 12 weakest resolve to a Listen item",
      VC.listenPlanCount(listenPool, () => false) === 0);
    check("listenPlanCount: speech available -> every one of the 12 weakest can be heard",
      VC.listenPlanCount(listenPool, () => true) === Math.min(12, listenPool.length));
    check("listenPlanCount: per-word recorded clips (no voice) -> only the clipped words count",
      VC.listenPlanCount(listenPool, w => w.audio === "clip.mp3") === 0); // fixture WORDS carry no .audio
    // A small pool (< 12) so weakFirst's jitter can't drop any word: the count is exactly
    // the clipped subset, agreeing with hearItem's per-word canHearWord.
    const smallPool = WORDS.slice(0, 3).map((w, i) => i < 2 ? Object.assign({}, w, { audio: "clip.mp3" }) : w);
    check("listenPlanCount: a pack that ships clips for some weak words counts exactly those clipped",
      VC.listenPlanCount(smallPool, w => !!w.audio) === 2);
  }

  // speech
  const voices = [{lang:"en-US"}, {lang:"zh_TW"}, {lang:"it-IT"}];
  check("pickVoice: exact locale, else same language, else null", VC.pickVoice(voices, "it-IT").lang === "it-IT" && VC.pickVoice(voices, "zh-CN").lang === "zh_TW" && VC.pickVoice(voices, "es-ES") === null);
  check("speechUsable: no API -> false; unknown voice list -> true; list without the language -> false",
    !VC.speechUsable(false, voices, "it-IT") && VC.speechUsable(true, [], "es-ES") && !VC.speechUsable(true, voices, "es-ES") && VC.speechUsable(true, voices, "it-IT"));
  check("escapeHtml escapes single quotes", VC.escapeHtml(`a'b"<`) === "a&#39;b&quot;&lt;");
  check("isSamsungBrowser: matches SamsungBrowser UA case-insensitively, not other Android/Chrome UAs",
    VC.isSamsungBrowser("Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36") &&
    VC.isSamsungBrowser("...samsungbrowser/1.0...") &&
    !VC.isSamsungBrowser("Mozilla/5.0 (Linux; Android 13) Chrome/115.0.0.0 Mobile Safari/537.36") &&
    !VC.isSamsungBrowser(undefined));
})();

(function(){
  console.log("\n[14] validate_pack.py parity and level checks");
  const r = cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), ZH, "--dump-strata"], { encoding:"utf8" });
  const py = JSON.parse(r.stdout || "[]");
  const js = VC.strata(WORDS, PACK.placement, PACK.setSize).map(b=>({lv:b.lv, s0:b.s0, s1:b.s1, n:b.words.length}));
  check("validator strata == core.js strata on zh (bucket bounds and sizes)", util.isDeepStrictEqual(py, js));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vocab_pack_"));
  const run = (pack, words) => {
    fs.writeFileSync(path.join(tmp, "pack.json"), JSON.stringify(pack));
    fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(tmp, "sentences.json"), "[]");
    cp.spawnSync("python3", [path.join(ROOT, "tools", "jsonify_pack.py"), tmp]);
    return cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), tmp], { encoding:"utf8" });
  };
  const base = { key:"t", name:"T", tts:"it-IT", levels:[{id:"A1",label:"A1"},{id:"A2",label:"A2"}], placement:[["A1",2]], typing:null, showPron:false, hasLessons:false, eta:{} };
  const mkw = (n, lv, off) => Array.from({length:n}, (_,i)=>({ id:`${lv}${i+(off||0)}`, w:`w${lv}${i}`, en:`gloss ${lv} ${i}`, lv }));
  const ok = run(base, [...mkw(20,"A1"), ...mkw(12,"A2")]);
  check("synthetic pack (setSize/typing defaults) validates", ok.status === 0);
  const empty = run(base, mkw(20,"A1"));
  check("level with no words is an error", empty.status === 1 && /level 'A2' has no words/.test(empty.stdout));
  const thin = run(base, [...mkw(20,"A1"), ...mkw(4,"A2")]);
  check("level with fewer words than one set is a warning, not an error", thin.status === 0 && /fewer than one set/.test(thin.stdout));
  const small = run(Object.assign({}, base, { setSize:2, placement:[["A1",3]] }), [...mkw(5,"A1"), ...mkw(12,"A2")]);
  check("placement bucket with < 4 words (set-boundary math; default items 3,4) is an error", small.status === 1 && /needs >= 4/.test(small.stdout));
  const small3 = run(Object.assign({}, base, { setSize:3, placement:[["A1",3]], placementItems:[2,3] }), [...mkw(9,"A1"), ...mkw(12,"A2")]);
  check("placementItems [2,3]: 3-word buckets validate (the need follows the pack's largest count)", small3.status === 0);
  const small4 = run(Object.assign({}, base, { setSize:3, placement:[["A1",3]] }), [...mkw(9,"A1"), ...mkw(12,"A2")]);
  check("default items: the same 3-word buckets are an error (needs >= 4)", small4.status === 1 && /needs >= 4/.test(small4.stdout));
  const wordsAB = [...mkw(20,"A1"), ...mkw(12,"A2")];
  const shOk = run(Object.assign({}, base, { soundsHint: "A few short lessons explain how Whistled Turkish sounds." }), wordsAB);
  check("pack.soundsHint: non-empty string validates", shOk.status === 0);
  const shBad = run(Object.assign({}, base, { soundsHint: "" }), wordsAB);
  check("pack.soundsHint: empty string is an error", shBad.status === 1 && /soundsHint must be a non-empty string/.test(shBad.stdout));
  const shType = run(Object.assign({}, base, { soundsHint: 3 }), wordsAB);
  check("pack.soundsHint: non-string is an error", shType.status === 1 && /soundsHint must be a non-empty string/.test(shType.stdout));
  const piOk = run(Object.assign({}, base, { placementItems: [3,2] }), wordsAB);
  check("pack.placementItems: list of positive ints validates", piOk.status === 0);
  const piBad = run(Object.assign({}, base, { placementItems: [2, 0] }), wordsAB);
  check("pack.placementItems: a non-positive entry is an error", piBad.status === 1 && /placementItems must be a list of positive integers/.test(piBad.stdout));
  const piType = run(Object.assign({}, base, { placementItems: "23" }), wordsAB);
  check("pack.placementItems: non-list is an error", piType.status === 1 && /placementItems must be a list of positive integers/.test(piType.stdout));
  fs.rmSync(tmp, { recursive:true, force:true });
})();

(function(){
  console.log("\n[15] lesson keys, lesson no-speech mode, wordOpts alt dedupe, read-error boot");
  // N1: distinct lesson items never merge in the Missed list, even with the same q.
  const keys = LESSONS.flatMap(l => l.items.map((it, i) => VC.lessonItemKey(l.id, i)));
  check("lesson item keys are unique across all zh lessons", new Set(keys).size === keys.length);
  const sameQ = LESSONS[0].items.filter(it => it.q === LESSONS[0].items[0].q).length;
  const miss = LESSONS[0].items.map((it, i) => ({ key: VC.lessonItemKey(LESSONS[0].id, i), reveal: it.rv || "" }));
  check(`distinct lesson items with the same question (${sameQ} share "${LESSONS[0].items[0].q}") are not merged`, sameQ > 1 && VC.dedupeMisses(miss).length === miss.length);
  // N2
  const it = (q, say, a) => ({ t:"mc", q, say, a, opts:[a, "x"] });
  check("lessonSayMode: speech ok -> audio; no say -> audio",
    VC.lessonSayMode(it("Which tone?", "妈", "1"), true) === "audio" && VC.lessonSayMode(it("Which tone?", undefined, "1"), false) === "audio");
  check("lessonSayMode: no speech + q contains say -> inq", VC.lessonSayMode(it("In 你好吗, what tone is 吗?", "你好吗", "neutral"), false) === "inq");
  check("lessonSayMode: no speech + say contains answer -> skip", VC.lessonSayMode(it("Which syllable?", "mā", "mā"), false) === "skip" && VC.lessonSayMode(it("Final?", "Wǒ", "wǒ"), false) === "skip");
  check("lessonSayMode: no speech + neither -> show text", VC.lessonSayMode(it("Which tone do you hear?", "妈", "1"), false) === "text");
  // N3
  const ans = { id:"a", w:"andare", en:"to go", lv:"A1", pos:"v" };
  const pool = [ans, ...["mangiare:to eat","bere:to drink","dormire:to sleep","parlare:to speak"].map((x,i)=>{ const [w,en] = x.split(":"); return { id:"d"+i, w, en, lv:"A1", pos:"v", alt:["shared-alt"] }; })];
  let three = true; for(let i=0;i<100;i++) if(VC.wordOpts(ans, pool).length !== 3) three = false;
  check("wordOpts: distractors sharing an alt with each other are fine (returns 3)", three);
  const ansAlt = Object.assign({}, ans, { alt:["shared-alt"] });
  check("wordOpts: a distractor sharing an alt with the ANSWER is still excluded", VC.wordOpts(ansAlt, [ansAlt, ...pool.slice(1)]).length === 0);
  // N4
  const ro = VC.bootProg(null, PACK, true);
  check("bootProg: storage read error -> read-only defaults, no backup write", ro.readOnly === true && ro.backupRaw === null && util.isDeepStrictEqual(ro.prog, VC.defaultProg(PACK)));
  check("bootProg: normal read is not read-only", VC.bootProg(null, PACK).readOnly === false && VC.bootProg('{"sessions":2}', PACK).readOnly === false);
})();

(function(){
  console.log("\n[16] gap option bare forms, example-sentence chooser, audio slot");
  const I = { levels:[{id:"A1",label:"A1"}], functionWords:[], spaced:true };
  const nouns = [["gioco","game"],["padre","father"],["libro","book"],["treno","train"],["cane","dog"],["mare","sea"]]
    .map(([b,en],i)=>({ id:"n"+i, w:(i%2?"la ":"il ")+b, en, lv:"A1", pos:"n", alt:[b, b+"s"] }));
  const anno = { id:"anno", w:"l'anno", en:"year", lv:"A1", pos:"n", alt:["anno"] };
  const acqua = { id:"acqua", w:"acqua", en:"water", lv:"A1", pos:"n", alt:["l'acqua"] };
  const art = { id:"il", w:"il", en:"the", lv:"A1", pos:"art", alt:["lo","la"] };
  const bello = { id:"bello", w:"bello", en:"beautiful", lv:"A1", pos:"adj", alt:["bella"] };
  const W = [...nouns, anno, acqua, art, bello];
  const BY = {}; W.forEach(w=>{ BY[w.id] = w; });
  check("bareForm: alt[0] when it is a whole trailing token of w (il gioco -> gioco, l'anno -> anno)",
    VC.bareForm(nouns[0]) === "gioco" && VC.bareForm(anno) === "anno" && VC.bareForm({w:"l’anno",alt:["anno"]}) === "anno");
  check("bareForm: w otherwise (acqua/l'acqua, il/lo, bello/bella, no alt)",
    VC.bareForm(acqua) === "acqua" && VC.bareForm(art) === "il" && VC.bareForm(bello) === "bello" && VC.bareForm({w:"casa"}) === "casa");
  // Blank = alt (bare): "È un ____ di parole." must not offer "il padre".
  const s1 = { id:"s1", t:"È un gioco di parole.", en:"x", lv:"A1", words:["n0"] };
  const m1 = VC.gapMatch(s1, nouns[0], BY, I);
  let bareOk = !!m1 && m1.text === "gioco";
  for(let i=0;i<50;i++){
    const gc = VC.gapChoices(nouns[0], m1, W, I);
    const bad = gc.opts.some(o => /^(il|la|l') ?/.test(o) && o !== "il" && o !== "la") || gc.a !== "gioco" || gc.opts[0] !== gc.a ||
      new Set(gc.opts).size !== gc.opts.length || gc.opts.some(o => !gc.byLabel[o]) || gc.byLabel[gc.a] !== nouns[0];
    if(bad){ bareOk = false; console.log("    BAD", JSON.stringify(gc.opts)); break; }
  }
  check("gapChoices: blank matched an alt -> answer and every distractor shown bare, distinct, mapped back", bareOk);
  // Inflected alt also triggers bare mode (answer shown by lemma).
  const s1b = { id:"s1b", t:"Due giocos qui.", en:"x", lv:"A1", words:["n0"] };
  const gcb = VC.gapChoices(nouns[0], VC.gapMatch(s1b, nouns[0], BY, I), W, I);
  check("gapChoices: inflected alt blank -> bare labels too", gcb.a === "gioco" && gcb.opts.every(o => !/^(il|la) /.test(o)));
  // Blank found via w ("Il gioco"): the article stays visible, blank + options are bare
  // (rule changed in [19]; before, options showed w here).
  const s2 = { id:"s2", t:"Il gioco è bello.", en:"x", lv:"A1", words:["n0"] };
  const m2 = VC.gapMatch(s2, nouns[0], BY, I);
  const gc2 = VC.gapChoices(nouns[0], m2, W, I);
  check("gapChoices: blank found via w -> article outside blank, every option bare", !!m2 && m2.text === "gioco" && gc2.a === "gioco" && gc2.opts.every(o => !/^(il|la) /.test(o)));
  // Elided alt (acqua -> blank l'acqua): answer stays bare w, distractors bare.
  const s3 = { id:"s3", t:"Bevo l'acqua.", en:"x", lv:"A1", words:["acqua"] };
  const gc3 = VC.gapChoices(acqua, VC.gapMatch(s3, acqua, BY, I), W, I);
  check("gapChoices: elided alt blank (l'acqua) -> answer 'acqua', distractors bare", gc3.a === "acqua" && gc3.opts.every(o => !/^(il|la) /.test(o)));
  // zh: no alts -> unchanged behaviour (labels are w).
  const zs = SENTENCES.find(s => VC.gapCandidateIndices(s, BY_ID, PACK).length);
  const ze = BY_ID[zs.words[VC.gapCandidateIndices(zs, BY_ID, PACK)[0]]];
  const zgc = VC.gapChoices(ze, VC.gapMatch(zs, ze, BY_ID, PACK), WORDS, PACK);
  check("gapChoices on zh: labels are w, answer is w", zgc.a === ze.w && zgc.opts.every(o => BY_ID[zgc.byLabel[o].id].w === o));

  // exampleSentences: only sentences listing the id; visible-w first, then visible-alt, then rest; pack order within tiers.
  const S = [
    { id:"e1", t:"Giochi sempre.", en:"x", lv:"A1", words:["n0"] },          // headword not visible
    { id:"e2", t:"Un gioco nuovo.", en:"x", lv:"A1", words:["n0"] },         // alt visible
    { id:"e3", t:"Il padre dorme.", en:"x", lv:"A1", words:["n1"] },         // other word
    { id:"e4", t:"La gioco? Il gioco!", en:"x", lv:"A1", words:["n0"] },     // w visible
    { id:"e5", t:"Il gioco è qui.", en:"x", lv:"A1", words:["n0"] }          // w visible
  ];
  const ex = VC.exampleSentences(nouns[0], S, I, 2).map(s=>s.id);
  const exAll = VC.exampleSentences(nouns[0], S, I, 10).map(s=>s.id);
  check("exampleSentences: prefers sentences showing w, then an alt, then the rest; never other words' sentences",
    util.isDeepStrictEqual(ex, ["e4","e5"]) && util.isDeepStrictEqual(exAll, ["e4","e5","e2","e1"]));
  const zex = VC.exampleSentences(ze, SENTENCES, PACK, 2);
  check("exampleSentences on zh: every example lists the word id and shows its w",
    zex.length > 0 && zex.every(s => s.words.includes(ze.id) && s.t.includes(ze.w)));

  // audioSlot: one audio object for any number of plays; previous paused before each new play.
  let made = 0, pauses = 0;
  const slot = VC.audioSlot(() => { made++; return { src:"", pause(){ pauses++; } }; });
  const a1 = slot.play("x.mp3"); slot.play("y.mp3"); slot.play("y.mp3"); slot.stop();
  const a4 = slot.play("z.mp3");
  check("audioSlot: 4 plays -> 1 audio object, previous paused each time, src updated", made === 1 && a1 === a4 && pauses === 4 && a4.src === "z.mp3");
  const fresh = VC.audioSlot(() => { made++; return { pause(){} }; }); fresh.stop();
  check("audioSlot: stop() before any play creates nothing", made === 1);
})();

(function(){
  console.log("\n[17] script display, RTL / no-space synthetic packs, highlight, search, folding");
  const join = parts => parts.map(x=>x.text).join("");
  const hitsOf = parts => parts.filter(x=>x.hit).map(x=>x.text);

  // --- script display props
  const zd = VC.scriptDisplay(PACK);
  check("zh script display: lang from tts ('zh'), LTR, no font/lineHeight overrides, no font link",
    zd.lang === "zh" && zd.rtl === false && zd.fontFamily === null && zd.lineHeight === null && VC.fontsHref(PACK).href === null);
  check("langTag overrides tts; invalid langTag falls back to tts language part",
    VC.targetLang({tts:"ur-PK", langTag:"ur-Arab"}) === "ur-Arab" && VC.targetLang({tts:"fa-IR", langTag:'"><x'}) === "fa" && VC.targetLang({}) === "und");
  check("rtl only when pack.rtl === true", VC.scriptDisplay({tts:"fa-IR", rtl:true}).rtl === true && VC.scriptDisplay({tts:"fa-IR", rtl:"yes"}).rtl === false);
  check("fontFamily: CSS family list accepted; declaration-escaping values refused",
    VC.fontFamilyOf({fontFamily:'"Noto Nastaliq Urdu", serif'}) === '"Noto Nastaliq Urdu", serif' &&
    ["x; color:red", "a}b", "url(http://e/x)", "a<b", "a\\b", "a/*b"].every(f => VC.fontFamilyOf({fontFamily:f}) === null));
  check("lineHeight: number in 1..4 only", VC.lineHeightOf({lineHeight:2.2}) === 2.2 && [0.5, 9, "2", NaN, null].every(n => VC.lineHeightOf({lineHeight:n}) === null));
  const fh = VC.fontsHref({fonts:["Noto Nastaliq Urdu", "Noto Naskh Arabic:wght@400;700", "x&family=y", '"><script>', "a/b", 7]});
  check("fontsHref: only fonts.googleapis.com css2, names +-joined, axis spec kept, unsafe entries rejected and absent from URL",
    fh.href === "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu&family=Noto+Naskh+Arabic:wght@400;700&display=swap" &&
    fh.rejected.length === 4 && !/script|&family=y|a\/b/.test(fh.href));

  // --- synthetic RTL (Persian-like) pack, typing:null, spaced
  const FA = { key:"fa_t", name:"fa", tts:"fa-IR", rtl:true, levels:[{id:"A1",label:"A1"}], setSize:10, placement:[["A1",1]],
    functionWords:["man"], typing:null, showPron:true, hasLessons:false };
  const FW = [
    { id:"man", w:"من", en:"I", lv:"A1", pron:"man" },
    { id:"ketab", w:"کتاب", en:"book", lv:"A1", pron:"ketâb" },
    { id:"khan", w:"خواندن", en:"to read", lv:"A1", pron:"xândan", alt:["می‌خوانم"] },
    { id:"ab", w:"آب", en:"water", lv:"A1", pron:"âb" },
    { id:"abi", w:"آبی", en:"blue", lv:"A1", pron:"âbi" },
    { id:"mi", w:"می", en:"(continuous prefix)", lv:"A1" },
    { id:"khub", w:"خوب", en:"good", lv:"A1" }
  ];
  const FB = {}; FW.forEach(w=>{ FB[w.id] = w; });
  const f1 = { id:"f1", t:"من کتاب را می‌خوانم.", en:"I read the book.", lv:"A1", words:["man","ketab","khan"] };
  const f2 = { id:"f2", t:"آب آبی است.", en:"The water is blue.", lv:"A1", words:["ab","abi"] };
  const f3 = { id:"f3", t:"من می‌خوانم.", en:"I am reading.", lv:"A1", words:["man","mi"] };
  check("RTL: gap candidates skip function word; alt with ZWNJ (می‌خوانم) locates the verb", util.isDeepStrictEqual(VC.gapCandidateIndices(f1, FB, FA), [1,2]));
  const fm = VC.gapMatch(f1, FB.ketab, FB, FA), fb = VC.blankSentence(f1, fm);
  check("RTL: blank splits logical text exactly (before + answer + after = t)", fb.before === "من " && fb.answer === "کتاب" && fb.before + fb.answer + fb.after === f1.t);
  check("RTL: whole-word match (آب not inside آبی)", util.isDeepStrictEqual(VC.gapCandidateIndices(f2, FB, FA), [0,1]) && VC.gapMatch(f2, FB.ab, FB, FA).start === 0);
  check("RTL: ZWNJ is word-internal (می never matches inside می‌خوانم)", VC.findSurface(f3.t, "می", true).length === 0 && VC.gapCandidateIndices(f3, FB, FA).length === 0);
  let noType = true; for(let i=0;i<50;i++){
    const learned = FW.slice();
    if(VC.buildReviewPlan(learned, {w:{}}, FA).some(p=>p.kind==="type") || VC.buildRecallPlan(learned, {w:{}}, FA, 8).some(p=>p.kind!=="recall")) noType = false;
  }
  const kinds = new Set(); for(let i=0;i<2000;i++) kinds.add(VC.sentenceKind(FA));
  const rp = VC.buildReviewPlan(FW, {w:{}}, FA);
  check("RTL typing:null: no type items (review/recall use recall), >=40% production, no typed gap",
    noType && !kinds.has("gapType") && kinds.has("gap") && rp.filter(p=>p.kind==="recall").length / rp.length >= 0.4);
  check("RTL highlight: taught verb bolded via its ZWNJ alt; text round-trips",
    util.isDeepStrictEqual(hitsOf(VC.highlightParts(f1, FB.khan, FB, FA)), ["می‌خوانم"]) && join(VC.highlightParts(f1, FB.khan, FB, FA)) === f1.t);
  // typed answers for an RTL pack with typing on (keyboard variants, harakat, ZWNJ)
  const FAT = Object.assign({}, FA, { typing:{ accents:"lenient" } }), FAS = Object.assign({}, FA, { typing:{ accents:"strict" } });
  check("Arabic-script typing: Arabic kaf/yeh = Persian forms (always); harakat and ZWNJ forgiven only when lenient",
    VC.acceptTyped("كتاب", FB.ketab, FAS) && VC.acceptTyped("کِتاب", FB.ketab, FAT) && !VC.acceptTyped("کِتاب", FB.ketab, FAS) &&
    VC.acceptTyped("میخوانم", FB.khan, FAT) && !VC.acceptTyped("میخوانم", FB.khan, FAS) && !VC.acceptTyped("کتب", FB.ketab, FAT));

  // --- synthetic Japanese-like pack: spaced:false, compounds, kana readings
  const JA = { key:"ja_t", name:"ja", tts:"ja-JP", levels:[{id:"N5",label:"N5"}], setSize:10, placement:[["N5",1]],
    functionWords:["watashi"], typing:null, showPron:true, hasLessons:false, spaced:false, compounds:["日本語"] };
  const JW = [
    { id:"watashi", w:"私", en:"I", lv:"N5", pron:"わたし" },
    { id:"nihon", w:"日本", en:"Japan", lv:"N5", pron:"にほん" },
    { id:"hon", w:"本", en:"book", lv:"N5", pron:"ほん" },
    { id:"gakusei", w:"学生", en:"student", lv:"N5", pron:"がくせい" },
    { id:"yomu", w:"読む", en:"to read", lv:"N5", pron:"よむ", alt:["読みます"] },
    { id:"daigaku", w:"大学", en:"university", lv:"N5", pron:"だいがく" }
  ];
  const JB = {}; JW.forEach(w=>{ JB[w.id] = w; });
  const j1 = { id:"j1", t:"私は日本の学生です。", en:"I am a Japanese student.", lv:"N5", words:["watashi","nihon","gakusei"], pron:"わたしはにほんのがくせいです。" };
  const j2 = { id:"j2", t:"日本語の本を読みます。", en:"I read a Japanese book.", lv:"N5", words:["nihon","hon","yomu"] };
  const j3 = { id:"j3", t:"本を読む。", en:"Read a book.", lv:"N5", words:["hon","yomu"] };
  check("no-space: substring cloze; function word skipped", util.isDeepStrictEqual(VC.gapCandidateIndices(j1, JB, JA), [1,2]));
  check("no-space: 日本 inside compound 日本語 never blanked; 本 visible twice never blanked; alt 読みます blanks",
    util.isDeepStrictEqual(VC.gapCandidateIndices(j2, JB, JA), [2]) && VC.gapMatch(j2, JB.yomu, JB, JA).text === "読みます");
  check("no-space: single visible 本 is blankable", util.isDeepStrictEqual(VC.gapCandidateIndices(j3, JB, JA), [0,1]));
  const hj = VC.highlightParts(j2, JB.hon, JB, JA);
  check("no-space highlight: only the standalone 本 (not the one inside 日本語), at the right offset",
    util.isDeepStrictEqual(hitsOf(hj), ["本"]) && hj[0].text === "日本語の" && join(hj) === j2.t);
  check("no-space highlight: word visible only inside a compound -> no highlight",
    hitsOf(VC.highlightParts(j2, JB.nihon, JB, JA)).length === 0 && join(VC.highlightParts(j2, JB.nihon, JB, JA)) === j2.t);
  check("no-space typing:null: recall only, no typed gap",
    VC.buildRecallPlan(JW, {w:{}}, JA, 6).every(p=>p.kind==="recall") && (()=>{ for(let i=0;i<500;i++) if(VC.sentenceKind(JA)==="gapType") return false; return true; })());

  // --- highlight: spaced Latin, and zh sweep
  const IT = { spaced:true }, gioco = { id:"g", w:"il gioco", alt:["gioco"] };
  check("highlight (spaced): every occurrence, widest form, case-insensitive; absent -> one plain segment",
    util.isDeepStrictEqual(hitsOf(VC.highlightParts({t:"Il gioco è qui, il gioco!"}, gioco, {}, IT)), ["Il gioco","il gioco"]) &&
    util.isDeepStrictEqual(VC.highlightParts({t:"Giochi sempre."}, gioco, {}, IT), [{text:"Giochi sempre.", hit:false}]));
  let zRound = 0, zCut = 0, zHit = 0, zN = 0;
  WORDS.slice(0, 300).forEach(w => VC.exampleSentences(w, SENTENCES, PACK, 2).forEach(s => {
    zN++;
    const parts = VC.highlightParts(s, w, BY_ID, PACK);
    if(join(parts) !== s.t) zRound++;
    let at = 0; parts.forEach(x => { if(x.hit){ zHit++; if(x.text !== w.w || VC.spannedByLonger(s, {start:at, end:at+x.text.length, text:x.text}, BY_ID, PACK)) zCut++; } at += x.text.length; });
  }));
  check(`zh highlight sweep (${zN} examples): text round-trips, hits are the word and never inside a longer word/compound, most examples highlighted`,
    zRound === 0 && zCut === 0 && zHit >= zN * 0.8);

  // --- Words search
  const SW = [
    { id:"a", w:"молоко́", en:"milk", pron:"malakó" },
    { id:"b", w:"کتاب", en:"Book", pron:"ketâb" },
    { id:"c", w:"خواندن", en:"to read", alt:["می‌خوانم"] },
    { id:"d", w:"你好", en:"hello", pron:"nǐ hǎo" },
    { id:"e", w:"perché", en:"why; because" }
  ];
  const sIds = q => VC.searchWords(SW, q).map(v=>v.id).join(",");
  check("search: target text (stress-folded, Arabic kaf variant, ZWNJ-folded), pron (accent/space-folded), gloss (case), alt",
    sIds("молоко") === "a" && sIds("كتاب") === "b" && sIds("میخوانم") === "c" && sIds("nihao") === "d" && sIds("ni hao") === "d" &&
    sIds("BOOK") === "b" && sIds("perche") === "e" && sIds("malako") === "a" && sIds("   ") === "" && sIds("zzz") === "");
  const zw = WORDS.find(w => w.pron && VC.foldAccents(w.pron) !== w.pron);
  check("search on zh: toneless pron finds the word; hanzi finds it", !!zw && VC.searchWords(WORDS, VC.foldAccents(zw.pron)).includes(zw) && VC.searchWords(WORDS, zw.w).includes(zw));
  check("search limit caps results", VC.searchWords(WORDS, "a", 5).length === 5);

  // --- folding keeps letters that marks distinguish
  check("foldAccents: stress/ё folded; й, Devanagari vowel signs, nukta and kana voicing kept (nukta rule changed in [20])",
    VC.foldAccents("молоко́") === "молоко" && VC.foldAccents("ёж") === "еж" && VC.foldAccents("мой") === "мой" &&
    VC.foldAccents("कि") === "कि" && VC.foldAccents("ज़रा") === "ज़रा" && VC.foldAccents("が") === "が" && VC.foldAccents("perché") === "perche");

  // --- showPron default comes from the pack
  check("showPron default comes from pack.showPron", VC.defaultProg({levels:[], showPron:false}).showPron === false && VC.defaultProg({levels:[], showPron:true}).showPron === true);

  // --- word popover (.gloss) is a floating card clear of the top edge (owner report 2026-09-30)
  {
    const g = (fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8").match(/\n  \.gloss\{([^}]*)\}/) || [])[1] || "";
    check("popover .gloss: sticky below the top edge + safe-area inset, 2px --mute border (1.5px computes to 1px at DPR 1), shadow",
      /position:sticky/.test(g) && /top:calc\(env\(safe-area-inset-top, 0px\) \+ \d+px\)/.test(g) && /border:2px solid var\(--mute\)/.test(g) && /box-shadow:/.test(g));
  }
  // --- app.html render-site guard: every target-text element carries ${TA} (lang/dir/font)
  const app = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
  const bare = [...app.matchAll(/class="(big wd|med wd|wd|st|rw)"(?!\$\{TA\})/g)].map(m=>m[0]);
  const optsW = [...app.matchAll(/optHtml: wordOptHtml\([^)]*\)(, optsT: true)?/g)];
  check("app.html: every target-text element (big/med/wd/st/rw) carries ${TA}; every word-option item sets optsT",
    bare.length === 0 && optsW.length >= 2 && optsW.every(m=>!!m[1]) && /id="tin"[^>]*\$\{it\.inputTA !== undefined \? it\.inputTA : TA\}/.test(app)
    // the only overrides are the typed-reading item, the typed-meaning item (English) and the
    // script primer's symType (both type a Latin reading or romanisation, not the target script)
    && [...app.matchAll(/inputTA: /g)].length === 3 && /function pronTypeItem[\s\S]*?inputTA: ""/.test(app)
    && /function meaningTypeItem[^\n]*\n(?:[^\n]*\n){0,3}[^\n]*inputTA: ' lang="en"'/.test(app)
    && /if\(k === "symType"\)\{[^\n]*\n[^\n]*\n\s*return \{ kind:"type", key: it\.key, label:"Type how it sounds", html: big\(it\.show\), inputTA: ""/.test(app));

  // Favicon: a data: URI icon link so GitHub Pages stops 404ing /favicon.ico on every load.
  const iconLink = /<link rel="icon" href="(data:[^"]+)">/.exec(app);
  check("app.html: <link rel=\"icon\"> exists and is a data: URI", !!iconLink);

  // pack.soundsHint (TODO.md "the Sounds hint text on Today is generic"): overrides the
  // generic Today lesson hint when set, default text unchanged when absent.
  check("app.html: Today lesson hint uses PACK.soundsHint when set, else the generic text",
    /\$\{PACK\.soundsHint \? ui\(PACK\.soundsHint\) : `A few short lessons explain how \$\{ui\(PACK\.name\)\} sounds and is written\.`\}/.test(app));
})();

(function(){
  console.log("\n[18] validate_pack.py script-display fields; word-option distractors keep the answer's word class");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vocab_pack_"));
  const run = pack => {
    const words = Array.from({length:20}, (_,i)=>({ id:`a${i}`, w:`w${i}`, en:`gloss ${i}`, lv:"A1" }));
    fs.writeFileSync(path.join(tmp, "pack.json"), JSON.stringify(pack));
    fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(tmp, "sentences.json"), "[]");
    cp.spawnSync("python3", [path.join(ROOT, "tools", "jsonify_pack.py"), tmp]);
    return cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), tmp], { encoding:"utf8" });
  };
  const base = { key:"t", name:"T", tts:"fa-IR", levels:[{id:"A1",label:"A1"}], placement:[["A1",2]], typing:null, showPron:false, hasLessons:false, eta:{} };
  const good = run(Object.assign({}, base, { rtl:true, langTag:"fa", fontFamily:'"Noto Naskh Arabic", serif', fonts:["Noto Naskh Arabic:wght@400;700"], lineHeight:2 }));
  check("validator: valid rtl/langTag/fontFamily/fonts/lineHeight -> 0 errors, no rtl-font warning", good.status === 0 && !/rtl is true/.test(good.stdout));
  const bad = run(Object.assign({}, base, { rtl:"yes", langTag:'"><x', fontFamily:"x; color:red", fonts:["x&family=y"], lineHeight:9 }));
  const need = [/pack\.rtl must be a boolean/, /pack\.langTag must be/, /pack\.fontFamily must not contain/, /pack\.fonts\[0\]/, /pack\.lineHeight must be/];
  check("validator: each invalid script field is its own error", bad.status === 1 && need.every(re => re.test(bad.stdout)));
  const warn = run(Object.assign({}, base, { rtl:true }));
  check("validator: rtl without fontFamily/fonts is a warning, not an error", warn.status === 0 && /rtl is true but neither fontFamily nor fonts/.test(warn.stdout));
  fs.rmSync(tmp, { recursive:true, force:true });

  // Distractor word class (recall and gap share wordOpts).
  const P = { functionWords:["f0","f1","f2","f3"] };
  const W = [
    ...[["il","the"],["di","of"],["e","and"],["che","that"]].map(([w,en],i)=>({ id:`f${i}`, w, en, lv:"A1", pos:"x" })),
    ...[["casa","house"],["cane","dog"],["gatto","cat"],["libro","book"],["sole","sun"]].map(([w,en],i)=>({ id:`c${i}`, w, en, lv:"A1", pos:"n" }))
  ];
  let contentOk = true, fnOk = true;
  for(let i=0;i<200;i++){
    if(VC.wordOpts(W[4], W, null, P).some(d => P.functionWords.includes(d.id))) contentOk = false;
    if(!VC.wordOpts(W[0], W, null, P).every(d => P.functionWords.includes(d.id))) fnOk = false;
  }
  check("wordOpts: content-word answer never gets a function-word distractor; function-word answer gets function words first", contentOk && fnOk);
  const tinyFn = [W[0], W[1], ...W.slice(4)];
  check("wordOpts: function-word answer falls back to content words when too few function words", VC.wordOpts(W[0], tinyFn, null, P).length === 3);
  const s = { id:"s", t:"Il cane e il gatto.", en:"x", lv:"A1", words:["f0","c1","f2","c2"] };
  const BY = {}; W.forEach(w=>{ BY[w.id] = w; });
  let gapOk = true;
  for(let i=0;i<100;i++){ const gc = VC.gapChoices(BY.c1, VC.gapMatch(s, BY.c1, BY, P), W, P); if(gc.opts.some(o => ["il","di","e","che"].includes(o)) || gc.opts.length !== 4) gapOk = false; }
  check("gapChoices: 4 options, none a function word, for a content-word blank", gapOk);
  let zhFw = 0; const zfw = new Set(PACK.functionWords);
  SENTENCES.slice(0, 300).forEach(zs => VC.gapCandidateIndices(zs, BY_ID, PACK).forEach(ix => {
    const e = BY_ID[zs.words[ix]]; const gc = VC.gapChoices(e, VC.gapMatch(zs, e, BY_ID, PACK), WORDS, PACK);
    if(Object.values(gc.byLabel).some(v => v.id !== e.id && zfw.has(v.id))) zhFw++;
  }));
  check("zh gap sweep (300 sentences): no function-word distractor in any cloze", zhFw === 0);
})();

(function(){
  console.log("\n[19] gap article rule (fr/es browser-verify)");
  const F = { levels:[{id:"A1",label:"A1"}], functionWords:["le","un"], spaced:true, typing:{ enabled:true, accents:"lenient" } };
  const W = [
    { id:"le", w:"le", en:"the", lv:"A1", pos:"art", alt:["la","l'","les"] },
    { id:"un", w:"un", en:"a", lv:"A1", pos:"art", alt:["une"] },
    { id:"eg", w:"l'église", en:"church", lv:"A1", pos:"noun", alt:["église","églises"] },
    { id:"fr", w:"le fruit", en:"fruit", lv:"A1", pos:"noun", alt:["fruit","fruits"] },
    { id:"lo", w:"la loi", en:"law", lv:"A1", pos:"noun", alt:["loi","lois"] },
    { id:"oe", w:"l'œuf", en:"egg", lv:"A1", pos:"noun", alt:["œuf","œufs"] },
    { id:"se", w:"le/la secrétaire", en:"secretary", lv:"A1", pos:"noun", alt:["secrétaire","secrétaires"] },
    { id:"me", w:"le/la médecin", en:"doctor", lv:"A1", pos:"noun" },                 // no alt: article list strips it
    { id:"di", w:"dimanche", en:"Sunday", lv:"A1", pos:"noun" },
    { id:"ga", w:"la gare", en:"station", lv:"A1", pos:"noun" },                        // no alt
  ];
  const BY = {}; W.forEach(w => { BY[w.id] = w; });
  const ARTED = /^(le|la|les|l'|l’|un|une)(\/(le|la))?( |(?<='))/i;
  const sweep = (entry, sent, n) => { const out = []; for(let i=0;i<(n||60);i++) out.push(VC.gapChoices(entry, VC.gapMatch(sent, entry, BY, F), W, F)); return out; };
  // Class 1: sentence form carries the article -> article stays visible, blank bare.
  const s1 = { id:"s1", t:"Ce soir nous allons à l'église.", en:"x", lv:"A1", words:["le","eg"] };
  const m1 = VC.gapMatch(s1, BY.eg, BY, F), b1 = VC.blankSentence(s1, m1);
  check("articled blank (l'église): elided article stays before the blank, blank = église", !!m1 && m1.text === "église" && b1.before === "Ce soir nous allons à l'");
  const s1b = { id:"s1b", t:"La gare est loin.", en:"x", lv:"A1", words:["le","ga"] };
  const m1b = VC.gapMatch(s1b, BY.ga, BY, F), b1b = VC.blankSentence(s1b, m1b);
  check("articled blank, word without alt (La gare): 'La ' visible, blank = gare", !!m1b && m1b.text === "gare" && b1b.before === "La ");
  check("articled blank: still a gap candidate (article outside blank does not count as a longer surface)", VC.gapCandidateIndices(s1, BY, F).length === 1);
  check("articled blank: every option bare, answer église",
    sweep(BY.eg, s1).every(gc => gc.a === "église" && gc.opts.length === 4 && gc.opts.every(o => !ARTED.test(o)) && gc.byLabel["église"] === BY.eg));
  // Class 2: bare blank ("le ____" for dimanche) never mixes in articled distractors.
  const s2 = { id:"s2", t:"Je travaille même le dimanche.", en:"x", lv:"A1", words:["le","di"] };
  const m2 = VC.gapMatch(s2, BY.di, BY, F);
  check("mixed options: bare blank -> no articled distractor (le fruit / la loi / l'œuf shown bare)",
    !!m2 && m2.text === "dimanche" && sweep(BY.di, s2, 100).every(gc => gc.opts.length === 4 && gc.opts.every(o => !ARTED.test(o))));
  // Class 3: double-article words are shown bare, with or without alt[0].
  check("double article: bareForm(le/la secrétaire) = secrétaire; without alt, le/la médecin -> médecin via pack articles",
    VC.bareForm(BY.se) === "secrétaire" && VC.bareForm(BY.me, VC.packArticles(W)) === "médecin" && VC.bareForm(BY.me) === "le/la médecin");
  let dbl = true; for(let i=0;i<100;i++){ const gc = VC.gapChoices(BY.di, m2, W, F); if(gc.opts.some(o => o.includes("/"))) dbl = false; }
  check("double article: never shown verbatim as a gap option", dbl);
  const s3 = { id:"s3", t:"Le médecin arrive.", en:"x", lv:"A1", words:["le","me"] };
  const m3 = VC.gapMatch(s3, BY.me, BY, F);
  check("double-article word blanked in a sentence: 'Le ' visible, blank médecin, answer médecin",
    !!m3 && m3.text === "médecin" && VC.gapChoices(BY.me, m3, W, F).a === "médecin");
  // articleCut only strips pack articles, never an ordinary apostrophe word.
  const A = VC.packArticles(W);
  check("articleCut: le/l'/les/le-la strip; aujourd'hui, 'lecture', bare 'le' untouched",
    VC.articleCut("le fruit", A) === 3 && VC.articleCut("l’œuf", A) === 2 && VC.articleCut("le/la secrétaire", A) === 6 &&
    VC.articleCut("aujourd'hui", A) === 0 && VC.articleCut("lecture", A) === 0 && VC.articleCut("le", A) === 0 && VC.articleCut("le fruit", new Set()) === 0);
  // Typed gap: the bare blank, alt forms and w are all accepted.
  const extra = [m1.text];
  check("gap-type: accepts bare blank, alt forms, w; rejects a distractor",
    VC.acceptTyped("église", BY.eg, F, extra) && VC.acceptTyped("eglise", BY.eg, F, extra) && VC.acceptTyped("églises", BY.eg, F, extra) &&
    VC.acceptTyped("l'église", BY.eg, F, extra) && !VC.acceptTyped("gare", BY.eg, F, extra));
  // zh (no articles): gap matches unchanged.
  let zhSame = true;
  SENTENCES.slice(0, 200).forEach(zs => VC.gapCandidateIndices(zs, BY_ID, PACK).forEach(ix => {
    const e = BY_ID[zs.words[ix]], m = VC.gapMatch(zs, e, BY_ID, PACK), l = VC.locateWord(zs, e, PACK);
    if(!l || m.start !== l.start || m.end !== l.end || VC.gapChoices(e, m, WORDS, PACK).a !== e.w) zhSame = false;
  }));
  check("zh (no articles): gap span = located span, answer label = w", zhSame);
})();

(function(){
  console.log("\n[20] script-aware fold, pron display, search ranking");
  const F = VC.foldAccents, same = (a, b) => F(a) === F(b);
  // A. Marks that make a distinct letter never fold, in any script; accents/stress/pointing do.
  check("fold keeps distinct letters: й≠и, ї≠і, ў≠у (also after NFD input, re-composed)",
    !same("й","и") && !same("ї","і") && !same("ў","у") && !same("Й","И") && F("мои\u0306") === "мой");
  check("lenient typing: твои/мои rejected for твой/мой; stress-less делать and е-for-ё accepted", (() => {
    const P = { typing:{ accents:"lenient" } };
    return !VC.acceptTyped("твои", { w:"твой" }, P) && !VC.acceptTyped("мои", { w:"мой" }, P) &&
      VC.acceptTyped("делать", { w:"де́лать" }, P) && VC.acceptTyped("еж", { w:"ёж" }, P) && VC.acceptTyped("твой", { w:"твой" }, P);
  })());
  check("fold: Arabic hamza letters stay distinct (أ إ آ ؤ ئ ۀ vs base); harakat and tatweel fold",
    !same("أ","ا") && !same("إ","ا") && !same("آ","ا") && !same("ؤ","و") && !same("ئ","ي") && !same("ۀ","ه") &&
    F("كَتَبَ") === "كتب" && F("كـتاب") === "كتاب" && F("سؤال") === "سؤال");
  check("fold: Devanagari nukta/virama and kana (han)dakuten stay distinct",
    !same("ज़","ज") && !same("ड़","ड") && !same("क्","क") && !same("が","か") && !same("ぱ","は") && !same("ば","は"));
  check("fold: Latin accents, Cyrillic stress/ё, Hebrew niqqud, ZWNJ still fold",
    F("perché") === "perche" && F("ñ") === "n" && F("моло́ко") === "молоко" && F("ё") === "е" && F("שָׁלוֹם") === "שלום" && F("می\u200cروم") === "میروم");
  check("lenient typing: ещё/еще both ways; fully vocalised Arabic = unvocalised; か rejected for が; bare ا accepted for أ (LENIENT_LETTERS), strict rejects it", (() => {
    const P = { typing:{ accents:"lenient" } };
    return VC.acceptTyped("еще", { w:"ещё" }, P) && VC.acceptTyped("ещё", { w:"еще" }, P) &&
      VC.acceptTyped("مدرسة", { w:"مَدْرَسَةٌ" }, P) && VC.acceptTyped("مَدْرَسَةٌ", { w:"مدرسة" }, P) &&
      !VC.acceptTyped("か", { w:"が" }, P) && VC.acceptTyped("امس", { w:"أمس" }, P) && !VC.acceptTyped("امس", { w:"أمس" }, { typing:{ accents:"strict" } }) && VC.acceptTyped("أَمْس", { w:"أمس" }, P);
  })());
  // C. pron hidden when it only repeats the text.
  check("pronShown: hidden when pron = w (в/в, case/NFC-insensitive) or = sentence text; stress-marked pron kept",
    VC.pronShown({ w:"в", pron:"в" }) === "" && VC.pronShown({ w:"Я", pron:"я" }) === "" && VC.pronShown({ t:"да", pron:"да" }) === "" &&
    VC.pronShown({ w:"делать", pron:"де́лать" }) === "де́лать" && VC.pronShown({ w:"你好", pron:"nǐ hǎo" }) === "nǐ hǎo" && VC.pronShown({ w:"x" }) === "");
  // D. exact match ranks first, then whole gloss sense, then prefix, then the rest (pack order within tiers).
  const SW = [
    { id:"sd", w:"сделать", pron:"сде́лать", en:"to do (pf.)" },
    { id:"pd", w:"переделать", en:"to redo" },
    { id:"dl", w:"делать", pron:"де́лать", en:"to do (impf.)" },
    { id:"dv", w:"дело", en:"matter, deal" },
    { id:"bk", w:"книжка", en:"booklet" },
    { id:"bo", w:"книга", en:"book, volume" },
  ];
  const ids = q => VC.searchWords(SW, q).map(v => v.id).join(",");
  check("search ranking: exact lemma first (делать before сделать), stress-folded pron counts as exact",
    ids("делать") === "dl,sd,pd" && ids("де́лать") === "dl,sd,pd" && ids("book") === "bo,bk" && ids("дел") === "dl,dv,sd,pd");
  // Pack-sized synthetic fixture (not the live ../russian pack): exact lemma beats the
  // many words that contain it, whatever their pack order.
  const RW = [...Array.from({ length: 300 }, (_, i) => ({ id:"f"+i, w:"пере"+"делать".slice(0, 1 + i % 6)+i, en:"filler "+i })),
    { id:"sd2", w:"сделать", pron:"сде́лать", en:"to do (pf.)" }, { id:"dl2", w:"делать", pron:"де́лать", en:"to do (impf.)" }];
  check("search ranking on a 302-word fixture: exact делать first although last in pack order; сделать still listed", (() => { const r = VC.searchWords(RW, "делать"); return r[0].id === "dl2" && r.some(v => v.id === "sd2"); })());
  // Folded fields are cached per word but refreshed when the word's text changes.
  const mut = [{ id:"m", w:"кот", en:"cat" }];
  const firstHit = VC.searchWords(mut, "кот").length; mut[0].w = "пёс";
  check("search cache: a changed word is re-folded (old text no longer matches, new does)", firstHit === 1 && VC.searchWords(mut, "кот").length === 0 && VC.searchWords(mut, "пес").length === 1);
  // E. Arabic-script search folding (searchFold): hamza/madda carriers, alef wasla, teh
  // marbuta, alef maksura, harakat/tatweel, optional leading ال; Persian ي/ك and ZWNJ.
  const AW = [
    { id:"kitab", w:"كِتَاب", en:"book" }, { id:"alkitab", w:"الكتاب", en:"the book" },
    { id:"ana", w:"أنا", en:"I" }, { id:"madrasa", w:"مدرسة", en:"school" }, { id:"fi", w:"في", en:"in" },
    { id:"ala", w:"على", en:"on" }, { id:"imam", w:"إمام", en:"imam" }, { id:"quran", w:"القرآن", en:"Quran" },
    { id:"ibn", w:"ٱبن", en:"son" }, { id:"suel", w:"سؤال", en:"question" },
    { id:"sael", w:"سائل", en:"liquid" }, { id:"masul", w:"مسئول", en:"responsible" }, { id:"moamen", w:"مؤمن", en:"believer" },
    { id:"miravam", w:"می‌روم", en:"I go" }, { id:"ketab", w:"کتاب", en:"book (fa)" }, { id:"khane", w:"خانهٔ", en:"house of" },
  ];
  const aids = q => VC.searchWords(AW, q).map(v => v.id);
  check("ar search: كتاب finds الكتاب and كِتَاب (harakat folded), exact first; الكتاب finds كتاب too (article optional)",
    aids("كتاب").includes("alkitab") && aids("كتاب").includes("kitab") && aids("كتاب")[0] === "kitab" && aids("الكتاب").includes("kitab") && aids("الكتاب").includes("alkitab"));
  check("ar search: hamza/madda/wasla carriers fold to bare alef (انا → أنا, امام → إمام, قران → القرآن, ابن → ٱبن), سوال → سؤال",
    aids("انا").includes("ana") && aids("امام").includes("imam") && aids("قران").includes("quran") && aids("ابن").includes("ibn") && aids("سوال").includes("suel"));
  check("ar search: teh marbuta and alef maksura fold (مدرسه → مدرسة, فى → في, علي → على)",
    aids("مدرسه").includes("madrasa") && aids("فى").includes("fi") && aids("علي").includes("ala"));
  check("fa search: Arabic ي/ك typed (مي‌روم, كتاب) find Persian ی/ک; ZWNJ-insensitive (میروم, می روم); خانه finds خانهٔ",
    aids("مي‌روم").includes("miravam") && aids("میروم").includes("miravam") && aids("می روم").includes("miravam") && aids("كتاب").includes("ketab") && aids("خانه").includes("khane"));
  check("ar/fa search: a hamza carrier folds to the same canonical letter the typed side uses (سايل/سایل → سائل, مسيول/مسیول → مسئول, مومن → مؤمن)",
    aids("سايل").includes("sael") && aids("سایل").includes("sael") && aids("مسيول").includes("masul") && aids("مسیول").includes("masul") && aids("مومن").includes("moamen")
    && aids("سائل").includes("sael") && aids("مسئول").includes("masul"));
  check("searchFold leaves non-Arabic text exactly as normalizeTyped folds it; strict typing keeps ة and ى distinct, lenient folds them",
    VC.searchFold("Café  Été") === VC.normalizeTyped("Café  Été", { foldAccents: true }) && VC.normalizeTyped("مدرسة", {}) !== VC.normalizeTyped("مدرسه", {}) &&
    VC.normalizeTyped("مدرسة", { foldAccents: true }) === VC.normalizeTyped("مدرسه", { foldAccents: true }));
})();

(function(){
  console.log("\n[21] gap article agreement, articleCut on fixed expressions, reflexive clitics");
  const mk = (id, w, en, pos, alt) => ({ id, w, en, lv:"A1", pos: pos || "noun", alt: alt || [String(w).replace(/^(il\/la|il|lo|la|l') ?/, "")] });
  const IT = { tts:"it-IT", levels:[{id:"A1",label:"A1"}], functionWords:["il","un"], spaced:true };
  const W = [
    { id:"il", w:"il", en:"the", lv:"A1", pos:"art", alt:["lo","la","l'","i","gli","le"] },
    { id:"un", w:"un", en:"a", lv:"A1", pos:"art", alt:["uno","una","un'"] },
    mk("mela","la mela","apple"), mk("casa","la casa","house"), mk("sedia","la sedia","chair"), mk("porta","la porta","door"), mk("strada","la strada","road"),
    mk("conto","il conto","bill"), mk("gior","il giornale","newspaper"), mk("libro","il libro","book"), mk("treno","il treno","train"), mk("cane","il cane","dog"),
    mk("amico","l'amico","friend"), mk("acqua","l'acqua","water"), mk("isola","l'isola","island"), mk("uovo","l'uovo","egg"),
    mk("zaino","lo zaino","backpack"), mk("coll","il/la collega","colleague"),
    mk("peu","un po'","a bit","adv", []), mk("luno","l'uno","the one","pron", []),
    { id:"alz", w:"alzarsi", en:"to get up", lv:"A1", pos:"verb" },
  ];
  const BY = {}; W.forEach(w => { BY[w.id] = w; });
  const A = VC.packArticles(W);
  const run = (entry, t, n) => { const s = { id:"x", t, en:"x", lv:"A1", words:[entry.id] }; const m = VC.gapMatch(s, entry, BY, IT);
    const out = []; for(let i=0;i<(n||80);i++){ const gc = VC.gapChoices(entry, m, W, IT); out.push(gc.opts.slice(1).map(o => gc.byLabel[o])); } return { m, out }; };
  const agrees = (ds, ok) => ds.every(v => VC.citationArticles(v, A).some(a => ok.includes(a)));
  const la = run(BY.mela, "Mangio la mela.");
  check("agreement: 'la ____' -> every distractor a la-noun (or le/la), over 80 draws", la.m && la.m.article === "la" && la.out.every(ds => ds.length === 3 && agrees(ds, ["la"])));
  const el = run(BY.amico, "Vedo l'amico.");
  check("agreement: elided 'l'____' -> every distractor an l'-noun (either gender)", el.m && el.m.article === "l'" && el.out.every(ds => ds.length === 3 && agrees(ds, ["l'"])));
  const il = run(BY.conto, "Pago il conto.");
  check("agreement: 'il ____' -> il-nouns (il/la collega counts)", il.out.every(ds => agrees(ds, ["il"])));
  const lo = run(BY.zaino, "Porto lo zaino.");
  check("agreement fallback: 'lo ____' with no other lo-noun still gets 3 distractors", lo.m.article === "lo" && lo.out.every(ds => ds.length === 3));
  const none = run(BY.mela, "Mela!");
  check("no visible article -> article '' and 3 distractors", none.m && none.m.article === "" && none.out.every(ds => ds.length === 3));
  // pack.gapGender: same-gender distractors for an answer with `g` (fallback below GAP_GENDER_MIN same-gender candidates).
  {
    const gmap = { mela:"f", casa:"f", sedia:"f", porta:"f", strada:"f", conto:"m", gior:"m", libro:"m", treno:"m", cane:"m", amico:"m", acqua:"f", isola:"f", uovo:"m", zaino:"m" };
    const withG = list => list.map(w => gmap[w.id] ? Object.assign({}, w, { g: gmap[w.id] }) : w);
    const extra = [mk("info", "l'informazione", "information"), mk("ora", "l'ora", "hour")];
    const WG = withG([...W, ...extra]).map(w => w.id === "info" || w.id === "ora" ? Object.assign({}, w, { g: "f" }) : w);
    const BG = {}; WG.forEach(w => { BG[w.id] = w; }); const AG = VC.packArticles(WG);
    const ON = Object.assign({}, IT, { gapGender: true });
    const draw = (pool, by, entry, text, pack, n) => { const s = { id: "x", t: text, en: "x", lv: "A1", words: [entry.id] }; const m = VC.gapMatch(s, entry, by, pack);
      const out = []; for(let i = 0; i < (n || 80); i++){ const gc = VC.gapChoices(entry, m, pool, pack); out.push(gc.opts.slice(1).map(o => gc.byLabel[o])); } return { m, out }; };
    const fOn = draw(WG, BG, BG.info, "Ho un'informazione.", ON), fOff = draw(WG, BG, BG.info, "Ho un'informazione.", IT);
    check("gapGender: 'un'____' answer l'informazione (f) -> every distractor feminine (acqua, isola, ora), 80 draws", fOn.m && fOn.m.article === "un'" && fOn.out.every(ds => ds.length === 3 && ds.every(v => v.g === "f" && VC.citationArticles(v, AG).includes("l'"))));
    check("gapGender: flag off, the same gap still offers masculine l'-nouns (the defect)", fOff.out.some(ds => ds.some(v => v.g === "m")));
    const mOn = draw(WG, BG, BG.libro, "Ho un libro.", ON);
    check("gapGender: 'un ____' answer libro (m) -> masculine il/lo/l'-nouns only", mOn.m.article === "un" && mOn.out.every(ds => ds.length === 3 && ds.every(v => v.g === "m")));
    const noOra = WG.filter(w => w.id !== "ora"), BN = {}; noOra.forEach(w => { BN[w.id] = w; });
    const fb = draw(noOra, BN, BN.info, "Ho un'informazione.", ON);
    check("gapGender fallback: only 2 other feminine l'-nouns (< 3) -> 3 article-agreeing distractors as without the flag, masculine ones included", fb.out.every(ds => ds.length === 3 && ds.every(v => VC.citationArticles(v, VC.packArticles(noOra)).includes("l'"))) && fb.out.some(ds => ds.some(v => v.g === "m")));
    const fitW = Object.assign(mk("ora2", "l'ora2", "hour two"), { g: "f", alt: ["informazione"] });
    const withFit = [...noOra, fitW], BF = {}; withFit.forEach(w => { BF[w.id] = w; });
    const fitDraw = draw(withFit, BF, BF.info, "Ho un'informazione.", ON);
    check("gapGender L3: a same-gender word whose surface is the blank does not count toward the 3 minimum (2 usable -> fallback, masculine l'-nouns allowed)", fitDraw.out.every(ds => ds.length === 3 && ds.every(v => v.id !== "ora2")) && fitDraw.out.some(ds => ds.some(v => v.g === "m")));
    const seeded = f => { const r = Math.random; let a = 12345; Math.random = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; try { return f(); } finally { Math.random = r; } };
    const sig = (pack, pool, by, entry, text) => seeded(() => JSON.stringify(draw(pool, by, entry, text, pack, 40).out.map(ds => ds.map(v => v.id))));
    const W0 = [...W, ...extra].map(w => Object.assign({}, w)); const B0 = {}; W0.forEach(w => { B0[w.id] = w; });
    check("gapGender: words without g (no field) draw byte-identically with the flag on and off", sig(ON, W0, B0, B0.info, "Ho un'informazione.") === sig(IT, W0, B0, B0.info, "Ho un'informazione.") && sig(ON, W0, B0, B0.libro, "Ho un libro.") === sig(IT, W0, B0, B0.libro, "Ho un libro."));
    check("gapGender: answer with g but the flag off -> byte-identical to words without g", sig(IT, WG, BG, BG.info, "Ho un'informazione.") === sig(IT, W0, B0, B0.info, "Ho un'informazione.") && sig(IT, WG, BG, BG.libro, "Ho un libro.") === sig(IT, W0, B0, B0.libro, "Ho un libro."));
    check("gapGender: pack.gapGender must be exactly true (\"yes\" is off)", !VC.gapGenderOn(Object.assign({}, IT, { gapGender: "yes" })) && VC.gapGenderOn(ON) && !VC.gapGenderOn(IT));
  }
  // German case forms via the default table (de): den -> masculine citation (der).
  const DE = { tts:"de-DE", levels:[{id:"A1",label:"A1"}], functionWords:["der"], spaced:true };
  const G = [{ id:"der", w:"der", en:"the", lv:"A1", pos:"art", alt:["die","das","den","dem","des"] },
    ...[["hund","der Hund"],["tisch","der Tisch"],["baum","der Baum"],["stuhl","der Stuhl"],["katze","die Katze"],["tür","die Tür"],["haus","das Haus"],["buch","das Buch"]]
      .map(([id,w]) => ({ id, w, en:id, lv:"A1", pos:"noun", alt:[w.split(" ")[1]] }))];
  const GB = {}; G.forEach(w => { GB[w.id] = w; }); const GA = VC.packArticles(G);
  const gm = VC.gapMatch({ id:"g", t:"Ich sehe den Hund.", en:"x", lv:"A1", words:["hund"] }, GB.hund, GB, DE);
  let deOk = gm && gm.article === "den" && gm.text === "Hund";
  for(let i=0;i<60 && deOk;i++){ const gc = VC.gapChoices(GB.hund, gm, G, DE); deOk = gc.opts.slice(1).every(o => VC.citationArticles(gc.byLabel[o], GA).includes("der")); }
  check("agreement (de): 'den ____' -> der-nouns only (Tisch, Baum, Stuhl)", deOk);
  check("pack.articleAgreement overrides the default table", (() => { const P2 = Object.assign({}, IT, { articleAgreement:{ la:["il"] } });
    const m = VC.gapMatch({ id:"y", t:"Mangio la mela.", en:"x", lv:"A1", words:["mela"] }, BY.mela, BY, P2);
    const gc = VC.gapChoices(BY.mela, m, W, P2); return gc.opts.slice(1).every(o => VC.citationArticles(gc.byLabel[o], A).includes("il")); })());
  // Fixed expressions: never cut.
  const FA = new Set(["le","la","l'","les","un","une"]);
  check("articleCut: 'un peu', 'l'un', 'les uns les autres', 'tout le monde' unchanged for their entries",
    VC.articleCut("un peu", FA, { w:"un peu", pos:"adv" }) === 0 && VC.articleCut("l'un", FA) === 0 && VC.articleCut("l'un", FA, { w:"l'un", pos:"pron" }) === 0 &&
    VC.articleCut("les uns les autres", FA, { w:"les uns les autres", pos:"pron" }) === 0 && VC.articleCut("tout le monde", FA) === 0 &&
    VC.bareForm({ w:"un peu", pos:"adv" }, FA) === "un peu" && VC.bareForm({ w:"les uns les autres", pos:"pron" }, FA) === "les uns les autres" &&
    VC.articleCut("le fruit", FA, { w:"le fruit", pos:"noun" }) === 3 && VC.articleCut("la plupart", FA, { w:"la plupart", pos:"adv", alt:["plupart"] }) === 3);
  check("gap: 'un po'' (adv) is blanked whole, never 'un ____'", (() => { const m = VC.gapMatch({ id:"p", t:"Aspetta un po'.", en:"x", lv:"A1", words:["peu"] }, BY.peu, BY, IT); return !!m && m.text === "un po'"; })());
  // Reflexive clitics are never cut: a span that keeps a clitic its label would drop is no blank.
  const F = { tts:"fr-FR", levels:[{id:"A1",label:"A1"}], functionWords:["le"], spaced:true };
  const FW = [{ id:"le", w:"le", en:"the", lv:"A1", pos:"art", alt:["la","l'","les"] },
    { id:"lev", w:"se lever", en:"to get up", lv:"A1", pos:"verb", alt:["lever","lève"] },
    { id:"ass", w:"s'asseoir", en:"to sit down", lv:"A1", pos:"verb", alt:["asseoir"] }, mk("gare","la gare","station")];
  const FB = {}; FW.forEach(w => { FB[w.id] = w; });
  check("clitic: 'se lever' / 's'asseoir' found verbatim -> no blank (never 'se ____' or 's'____')",
    VC.gapMatch({ id:"c1", t:"Il faut se lever tôt.", en:"x", lv:"A1", words:["lev"] }, FB.lev, FB, F) === null &&
    VC.gapMatch({ id:"c2", t:"Tu vas s'asseoir ici.", en:"x", lv:"A1", words:["ass"] }, FB.ass, FB, F) === null);
  check("clitic: bare form in the sentence is still a blank ('Je me lève' -> blank lève, label lever)", (() => {
    const m = VC.gapMatch({ id:"c3", t:"Je me lève tôt.", en:"x", lv:"A1", words:["lev"] }, FB.lev, FB, F);
    return !!m && m.text === "lève" && m.article === "" && VC.gapChoices(FB.lev, m, FW, F).a === "lever"; })());
  // Article declensions and se-verb bases in `forms` (not typed answers): packArticles reads
  // forms of pos "art" words, and the optional `bare` field marks the gap label.
  const FW2 = [{ id:"le", w:"le", en:"the", lv:"A1", pos:"art", forms:["la","l'","les"] },
    { id:"lev", w:"se lever", en:"to get up", lv:"A1", pos:"verb", bare:"lever", forms:["lever","lève"] },
    { id:"ass", w:"s'asseoir", en:"to sit down", lv:"A1", pos:"verb", bare:"asseoir", forms:["asseoir"] }, mk("gare","la gare","station"), mk("loi","la loi","law")];
  const FB2 = {}; FW2.forEach(w => { FB2[w.id] = w; });
  check("packArticles reads forms of pos-art words (le + forms la, l', les)", ["le","la","l'","les"].every(a => VC.packArticles(FW2).has(a)) && VC.packArticles(FW2).size === 4);
  check("bare field: bareForm('se lever', bare lever, lever only in forms) = lever; s'asseoir -> asseoir", VC.bareForm(FB2.lev, VC.packArticles(FW2)) === "lever" && VC.bareForm(FB2.ass, VC.packArticles(FW2)) === "asseoir");
  check("bare field: gap item for 'se lever' still labelled 'lever' ('Je me lève' -> blank lève)", (() => {
    const m = VC.gapMatch({ id:"c3", t:"Je me lève tôt.", en:"x", lv:"A1", words:["lev"] }, FB2.lev, FB2, F);
    return !!m && m.text === "lève" && VC.gapChoices(FB2.lev, m, FW2, F).a === "lever"; })());
  check("bare field: 'se lever' / 's'asseoir' verbatim still no blank", VC.gapMatch({ id:"c1", t:"Il faut se lever tôt.", en:"x", lv:"A1", words:["lev"] }, FB2.lev, FB2, F) === null &&
    VC.gapMatch({ id:"c2", t:"Tu vas s'asseoir ici.", en:"x", lv:"A1", words:["ass"] }, FB2.ass, FB2, F) === null);
  check("article in forms: 'la ____' visible article from a forms-only article", (() => {
    const m = VC.gapMatch({ id:"c4", t:"Je vais à la gare.", en:"x", lv:"A1", words:["gare"] }, FB2.gare, FB2, F); return !!m && m.text === "gare" && m.article === "la"; })());
  check("bare field ignored unless a trailing token of w (falls back to alt[0] rule / w)", VC.bareForm({ w:"se lever", pos:"verb", bare:"lev", alt:["lever"] }, new Set()) === "se lever" &&
    VC.bareForm({ w:"se lever", pos:"verb", alt:["lever"] }, new Set()) === "lever");
  const DEF = [{ id:"der", w:"der", en:"the", lv:"A1", pos:"art", forms:["die","das","den","dem","des"] },
    ...[["hund","der Hund"],["tisch","der Tisch"],["katze","die Katze"],["haus","das Haus"]].map(([id,w]) => ({ id, w, en:id, lv:"A1", pos:"noun", alt:[w.split(" ")[1]] }))];
  const DB = {}; DEF.forEach(w => { DB[w.id] = w; });
  check("de: der declensions in forms -> 'den ____' visible, citation der", (() => {
    const m = VC.gapMatch({ id:"g2", t:"Ich sehe den Hund.", en:"x", lv:"A1", words:["hund"] }, DB.hund, DB, { tts:"de-DE", levels:[{id:"A1",label:"A1"}], spaced:true });
    return !!m && m.article === "den" && m.text === "Hund" && VC.citationArticles(DB.katze, VC.packArticles(DEF)).join() === "die"; })());
})();

(function(){
  console.log("\n[22] reading passages: unlock, grading, weak words, progress, validator");
  const RP = { key:"rp", name:"RP", tts:"it-IT", levels:[{id:"A1",label:"A1"},{id:"A2",label:"A2"}], placement:[["A1",2]], typing:null, showPron:false, hasLessons:false, eta:{} };
  const RW = [...Array.from({length:20}, (_,i)=>({ id:`a${i}`, w:`parola${i}`, en:`word a ${i}`, lv:"A1" })),
              ...Array.from({length:10}, (_,i)=>({ id:`b${i}`, w:`voce${i}`, en:`word b ${i}`, lv:"A2" }))];
  RW[0].w = "casa"; RW[1].w = "andare"; RW[1].alt = ["vado"]; RW[2].w = "il gatto"; RW[2].alt = ["gatto"]; RW[3].w = "correre";
  const RB = {}; RW.forEach(w => { RB[w.id] = w; });
  const q = (type, answer, words, sentence) => ({ q:"Domanda?", type, options: type === "mc" ? ["uno","due","tre","quattro"] : null, answer, words, sentence });
  const P1 = { id:"p0001", lv:"A1", title:"La casa", text:"Vado a casa. Il gatto dorme.", src:"gen",
    sentences:[{ t:"Vado a casa.", en:"I go home.", words:["a1","a0","a3"] }, { t:"Il gatto dorme.", en:"The cat sleeps.", words:["a2"] }],
    questions:[q("mc", 1, ["a0"], 0), q("tf", true, ["a2"], 1), q("mc", 3, ["a1"], 0)] };
  const P2 = { id:"p0002", lv:"A1", title:"Il gatto", text:"Il gatto dorme.", sentences:[{ t:"Il gatto dorme.", en:"The cat sleeps.", words:["a2"] }], questions:[q("tf", false, ["a2"], 0)] };
  const P3 = { id:"p0003", lv:"A2", title:"Voce", text:"voce0 voce1.", sentences:[{ t:"voce0 voce1.", en:"x", words:["b0","b1"] }], questions:[q("tf", true, ["b0"], 0)] };
  const PS = [P1, P2, P3];

  // unlock thresholds
  const prog = VC.normalizeProg({}, RP);
  const lv0 = VC.readingLevels(PS, RW, RP, prog);
  check("fresh learner: no level unlocked; A1 needs ceil(0.7*20)=14", lv0.every(l => !l.unlocked) && lv0[0].need === 14 && lv0[0].count === 2 && lv0[1].need === 7);
  // ten taught records (a counter prefix would be read in id order, a0 a1 a10..., since the frequency tiers)
  for(let i = 0; i < 10; i++) prog.w["a" + i] = { r:1, w:0, s:1 };
  prog.sets.A1 = 1;
  check("10/20 learned (50%) -> A1 still locked, suggestion null", !VC.readingLevels(PS, RW, RP, prog)[0].unlocked && VC.suggestPassage(PS, RW, RP, prog) === null);
  prog.w.a10 = { r:1, w:0, s:1, d:1 }; prog.w.a11 = { r:1, w:0, s:1, d:1 }; prog.w.a12 = { r:1, w:0, s:1, d:1 };
  check("13/20 (65%) -> locked", !VC.readingLevels(PS, RW, RP, prog)[0].met);
  prog.w.a13 = { r:1, w:0, s:1, d:1 };
  check("14/20 (70%) -> A1 unlocked", VC.readingLevels(PS, RW, RP, prog)[0].met);
  check("updateReadUnlocks records A1 once (sticky in prog.read.unlocked)", util.isDeepStrictEqual(VC.updateReadUnlocks(PS, RW, RP, prog), ["A1"]) && prog.read.unlocked.A1 === 1 && VC.updateReadUnlocks(PS, RW, RP, prog).length === 0);
  const dropped = JSON.parse(JSON.stringify(prog)); dropped.sets.A1 = 0; for(let i = 0; i < 10; i++) delete dropped.w["a" + i];
  check("stored unlock survives a drop below the threshold", VC.readingLevels(PS, RW, RP, dropped)[0].unlocked && !VC.readingLevels(PS, RW, RP, dropped)[0].met);
  check("A2 stays locked (0 learned)", !VC.readingLevels(PS, RW, RP, prog)[1].unlocked);
  check("suggestPassage -> first not-done passage at an unlocked level", VC.suggestPassage(PS, RW, RP, prog) === P1);

  // grading
  check("gradeQuestion mc: right index true, wrong index / string / bool false",
    VC.gradeQuestion(P1.questions[0], 1) && !VC.gradeQuestion(P1.questions[0], 0) && !VC.gradeQuestion(P1.questions[0], "1") && !VC.gradeQuestion(P1.questions[0], true));
  check("gradeQuestion tf: bool compare, non-bool false",
    VC.gradeQuestion(P1.questions[1], true) && !VC.gradeQuestion(P1.questions[1], false) && !VC.gradeQuestion(P1.questions[1], 1) && VC.gradeQuestion(P2.questions[0], false));

  // weak words: tapped a3 + a0; q0 wrong (a0: tapped and wrong -> 2, not 4); q1 right (a2 not weak; a stale `reopened` flag from an older session record is ignored);
  // q2 right (a1 not weak). Unknown ids dropped.
  const log = { tapped:["a3","a0","zz"], answers:[{ ok:false, reopened:false }, { ok:true, reopened:true }, { ok:true, reopened:false }] };
  const weak = VC.passageWeakWords(P1, log, RB);
  const W = {}; weak.forEach(e => { W[e.id] = e; });
  check("weak words = tapped ∪ wrong-question words (a stale reopened flag adds nothing)", util.isDeepStrictEqual(weak.map(e => e.id), ["a3","a0"]));
  check("weights: tapped 2, tapped+wrong 2 (max, not sum); READ_WEIGHT has no reopened", W.a3.weight === 2 && W.a0.weight === 2 && !W.a2 && !("reopened" in VC.READ_WEIGHT) && util.isDeepStrictEqual(W.a0.why, ["tapped","wrong"]));
  check("a wrong answer is a miss whether or not the learner looked back -> 2", [true, false].every(r => VC.passageWeakWords(P1, { tapped:[], answers:[{ ok:false, reopened:r }] }, RB)[0].weight === 2));
  check("all right, nothing tapped or reopened -> no weak words", VC.passageWeakWords(P1, { tapped:[], answers:[{ok:true},{ok:true},{ok:true}] }, RB).length === 0);

  // apply to progress: learned word (a0) and unlearned words (a2 is in set 1: learned; a3 learned) — use a19 (unlearned) too.
  const before = JSON.parse(JSON.stringify(prog));
  prog.w.a0 = { r:3, w:0, s:3, prov:1 };
  VC.applyWeakWords(prog, [...weak, { id:"a19", weight:2 }, { id:"a18", weight:0 }], RW, RP);
  check("applyWeakWords: misses += weight, streak reset, prov cleared", prog.w.a0.w === 2 && prog.w.a0.s === 0 && !prog.w.a0.prov && prog.w.a3.w === 2);
  check("applyWeakWords: a word that was not weak leaves its record untouched", util.isDeepStrictEqual(prog.w.a2, before.w.a2));
  { const p0 = JSON.parse(JSON.stringify(before)); const ro = VC.passageWeakWords(P1, { tapped:[], answers:[{ ok:true }, { ok:true, reopened:true }] }, RB);
    VC.applyWeakWords(p0, ro, RW, RP);
    check("looked back but all right, nothing tapped: no weak words, prog unchanged", ro.length === 0 && util.isDeepStrictEqual(p0, before)); }
  check("applyWeakWords: unlearned word flagged d (joins review pool); learned word not flagged; weight 0 ignored",
    prog.w.a19.d === 1 && prog.w.a19.w === 2 && !prog.w.a0.d && !prog.w.a18 && before.w.a19 === undefined);
  check("weakScore ranks applied words above untouched ones", VC.weakScore(prog.w.a0) > 0 && VC.weakScore(prog.w.a3) > 0 && VC.weakScore(prog.w.a5) <= 0);
  const lw = VC.learnedWords(RW, RP, prog);
  let inReview = true;
  for(let i=0;i<30;i++){ const ids = new Set(VC.buildReviewPlan(lw, prog, RP).map(p => p.word.id)); if(!["a0","a3","a19"].every(id => ids.has(id))) inReview = false; }
  check("Today's review plan includes every applied weak word (30 draws)", inReview);

  // passage done + stats
  VC.markPassageDone(prog, "p0001", 2, 3, "2026-09-24");
  check("markPassageDone stores {sc,n,d,x} and the read rotation's s (session of the pass)", util.isDeepStrictEqual(prog.read.done.p0001, { sc:2, n:3, d:"2026-09-24", x:1, s: VC.daySn(prog) }));
  check("suggestPassage moves to the next not-done passage", VC.suggestPassage(PS, RW, RP, prog) === P2);
  VC.markPassageDone(prog, "p0002", 1, 1, "2026-09-25");
  check("all unlocked passages done -> no suggestion", VC.suggestPassage(PS, RW, RP, prog) === null);
  VC.markPassageDone(prog, "p0001", 3, 3, "2026-09-26");
  const st = VC.readingStats(PS, RP, prog);
  check("readingStats: A1 2/2 done, avg of latest scores (100%, 100%); A2 0/1, avg null", st.length === 2 && st[0].done === 2 && st[0].total === 2 && st[0].avg === 100 && st[1].done === 0 && st[1].avg === null && prog.read.done.p0001.x === 2);

  // progress shape and round trip
  const L = VC.levelIds(RP);
  check("validateProgShape accepts prog with read state", VC.validateProgShape(JSON.parse(JSON.stringify(prog)), L).ok);
  check("validateProgShape accepts old progress without read", VC.validateProgShape({ w:{}, sets:{A1:1} }, L).ok);
  const badRead = [{ read:[] }, { read:{ done:[] } }, { read:{ unlocked:{ A1:"yes" } } }, { read:{ done:{ p:{ sc:"2" } } } }, { read:{ done:{ p:{ d:20260924 } } } }, { read:{ done:{ p:1 } } }];
  check("validateProgShape rejects malformed read shapes", badRead.every(b => !VC.validateProgShape(b, L).ok));
  const imp = VC.applyImport(VC.normalizeProg({}, RP), JSON.stringify(prog), RP);
  check("export -> import round trip keeps read state and word records", imp.ok && util.isDeepStrictEqual(imp.prog.read, prog.read) && util.isDeepStrictEqual(imp.prog.w, prog.w));
  const boot = VC.bootProg(JSON.stringify(prog), RP);
  check("boot from stored progress keeps read state", boot.backupRaw === null && util.isDeepStrictEqual(boot.prog.read, prog.read));
  const oldBoot = VC.bootProg(JSON.stringify({ v:1, w:{ a0:{r:1,w:0,s:1} }, sets:{ A1:1 } }), RP);
  check("boot from old progress (no read keys) is fine; read state created lazily", oldBoot.backupRaw === null && oldBoot.prog.read === undefined &&
    VC.readingLevels(PS, RW, RP, oldBoot.prog).length === 2 && VC.suggestPassage(PS, RW, RP, oldBoot.prog) === null);

  // segments + length
  const seg = VC.passageSegments(P1.sentences[0], RB, RP);
  check("passageSegments: alt 'vado' and w 'casa' tappable; invisible 'correre' listed as unplaced; text rejoins",
    seg.parts.map(p => p.text).join("") === P1.sentences[0].t && util.isDeepStrictEqual(seg.parts.filter(p => p.id).map(p => [p.text, p.id]), [["Vado","a1"],["casa","a0"]]) && util.isDeepStrictEqual(seg.unplaced, ["a3"]));
  const seg2 = VC.passageSegments(P1.sentences[1], RB, RP);
  check("passageSegments: articled w 'il gatto' spans the article (longest hit)", util.isDeepStrictEqual(seg2.parts.filter(p => p.id).map(p => p.text), ["Il gatto"]));
  const ZP = { spaced:false }, ZB = { x:{ id:"x", w:"为", en:"for" }, y:{ id:"y", w:"为什么", en:"why" }, z:{ id:"z", w:"你", en:"you" } };
  const zs = VC.passageSegments({ t:"你为什么来？", words:["z","x","y"] }, ZB, ZP);
  check("passageSegments unspaced: 为什么 wins over the 为 inside it; 为 then listed as unplaced (not visible on its own)",
    util.isDeepStrictEqual(zs.parts.filter(p => p.id).map(p => p.id), ["z","y"]) && util.isDeepStrictEqual(zs.unplaced, ["x"]));
  // builder spans: [[start, end, wordId]] UTF-16 offsets; ids without a span fall back to surface matching
  const SB = { g:{ id:"g", w:"il gatto", alt:["gatto"], en:"cat" }, c:{ id:"c", w:"comprare", en:"buy" }, m:{ id:"m", w:"la mela", alt:["mela"], en:"apple" },
               v:{ id:"v", w:"andare", en:"go" }, x:{ id:"x", w:"casa", en:"home" } };
  const ST = "Il gatto compra le mele e va a casa.";
  const ids = seg => seg.parts.filter(p => p.id).map(p => [p.text, p.id]);
  const rejoins = (seg, t) => seg.parts.map(p => p.text).join("") === t;
  const s1 = VC.passageSegments({ t:ST, words:["g","c","m","v","x"], spans:[[3,8,"g"],[9,15,"c"],[19,23,"m"],[26,28,"v"]] }, SB, RP);
  check("passageSegments spans: inflected compra/mele/va tappable in place; span 'gatto' beats the longer surface 'Il gatto'; casa (no span) by surface; no chips",
    rejoins(s1, ST) && util.isDeepStrictEqual(ids(s1), [["gatto","g"],["compra","c"],["mele","m"],["va","v"],["casa","x"]]) && util.isDeepStrictEqual(s1.unplaced, []));
  const s2 = VC.passageSegments({ t:ST, words:["g","c","m","v"], spans:[[9,15,"c"]] }, SB, RP);
  check("passageSegments mixed: span for compra; g by surface ('Il gatto'); m ('mele' matches no form) and v listed as unplaced",
    rejoins(s2, ST) && util.isDeepStrictEqual(ids(s2), [["Il gatto","g"],["compra","c"]]) && util.isDeepStrictEqual(s2.unplaced, ["m","v"]));
  const s3 = VC.passageSegments({ t:ST, words:["g","c"], spans:[[3,15,"c"]] }, SB, RP);
  check("passageSegments: a surface hit overlapping a span is dropped (g listed as unplaced), pieces never overlap",
    rejoins(s3, ST) && util.isDeepStrictEqual(ids(s3), [["gatto compra","c"]]) && util.isDeepStrictEqual(s3.unplaced, ["g"]));
  const s4 = VC.passageSegments({ t:ST, words:["c","m","x","q"], spans:[[9,15,"c"],[12,18,"m"],[31,99,"x"],[0,2,"zz"],[16,18,"q"],"bad",[5,5,"c"]] }, SB, RP);
  check("passageSegments ignores invalid spans (overlapping, out of bounds, id not in words, unknown id, malformed, empty) and falls back per id",
    rejoins(s4, ST) && util.isDeepStrictEqual(ids(s4), [["compra","c"],["casa","x"]]) && util.isDeepStrictEqual(s4.unplaced, ["m"]));
  // optional 4th span element: a display-only gloss string carried on the piece (zh phrase units)
  const sg = VC.passageSegments({ t:ST, words:["c","m","v"], spans:[[9,15,"c","to buy (display)"],[19,23,"m",""],[26,28,"v",7]] }, SB, RP);
  check("passageSegments span gloss: a string 4th element becomes the piece's gloss; empty or non-string ones add nothing; pieces without one are unchanged",
    rejoins(sg, ST) && util.isDeepStrictEqual(sg.parts.filter(p => p.id), [{ text:"compra", id:"c", gloss:"to buy (display)" }, { text:"mele", id:"m" }, { text:"va", id:"v" }]));
  const s6 = VC.passageSegments({ t:ST, words:["x"], spans:[[30,31,"x"]] }, SB, RP);
  check("passageSegments ignores a whitespace-only span (casa then found by surface)", rejoins(s6, ST) && util.isDeepStrictEqual(ids(s6), [["casa","x"]]));
  const s7 = VC.passageSegments({ t:"\u{1F642} va!", words:["v"], spans:[[1,5,"v"]] }, SB, RP);
  check("passageSegments ignores a span splitting a surrogate pair (andare then unplaced: va matches no form)", rejoins(s7, "\u{1F642} va!") && util.isDeepStrictEqual(ids(s7), []) && util.isDeepStrictEqual(s7.unplaced, ["v"]));
  const old = { t:ST, words:["g","c","m","v","x"] };
  check("passageSegments: no spans and spans:[] behave exactly as the surface-only path",
    util.isDeepStrictEqual(VC.passageSegments(old, SB, RP), VC.passageSegments({ ...old, spans:[] }, SB, RP)) &&
    util.isDeepStrictEqual(ids(VC.passageSegments(old, SB, RP)), [["Il gatto","g"],["casa","x"]]) && util.isDeepStrictEqual(VC.passageSegments(old, SB, RP).unplaced, ["c","m","v"]));
  const s5 = VC.passageSegments({ t:"\u{1F642} va!", words:["v"], spans:[[3,5,"v"]] }, SB, RP);
  check("passageSegments: span offsets are UTF-16 code units (an emoji before counts 2)", rejoins(s5, "\u{1F642} va!") && util.isDeepStrictEqual(ids(s5), [["va","v"]]));
  check("passageLength: spaced = whitespace tokens; unspaced = linked words", VC.passageLength(P1, RP) === 6 && VC.passageLength({ sentences:[{ words:["a","b"] },{ words:["c"] }] }, ZP) === 3);

  // validate_pack.py + jsonify on a temp pack with passages
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vocab_passages_"));
  fs.writeFileSync(path.join(tmp, "pack.json"), JSON.stringify(RP));
  fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify(RW));
  fs.writeFileSync(path.join(tmp, "sentences.json"), "[]");
  const runP = passages => {
    const pf = path.join(tmp, "passages.json");
    if(passages === null){ if(fs.existsSync(pf)) fs.unlinkSync(pf); } else fs.writeFileSync(pf, JSON.stringify(passages));
    cp.spawnSync("python3", [path.join(ROOT, "tools", "jsonify_pack.py"), tmp]);
    return cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), tmp], { encoding:"utf8" });
  };
  const none = runP(null);
  const sjsNone = fs.readFileSync(path.join(tmp, "sentences.js"), "utf8");
  check("pack without passages.json validates; sentences.js has no PASSAGES", none.status === 0 && !/PASSAGES/.test(sjsNone) && !/\d+ passages/.test(none.stdout));
  const good = runP(PS);
  const sjs = fs.readFileSync(path.join(tmp, "sentences.js"), "utf8");
  check("valid passages.json validates (3 passages) and is appended to sentences.js as PASSAGES", good.status === 0 && /3 passages/.test(good.stdout) &&
    util.isDeepStrictEqual(new Function(sjs + "\nreturn PASSAGES;")(), PS) && util.isDeepStrictEqual(new Function(sjs + "\nreturn SENTENCES;")(), []));
  const mut = f => { const c = JSON.parse(JSON.stringify(PS)); f(c); return c; };
  const bad = [
    ["duplicate passage id", c => { c[1].id = "p0001"; }, /duplicated/],
    ["unknown level", c => { c[0].lv = "C2"; }, /not in pack\.levels/],
    ["unknown sentence word id", c => { c[0].sentences[0].words.push("nope"); }, /unknown ids \['nope'\]/],
    ["unknown question word id", c => { c[0].questions[0].words = ["nope"]; }, /questions\[0\]\.words has unknown ids/],
    ["sentence index out of range", c => { c[0].questions[0].sentence = 2; }, /sentence must be an index/],
    ["mc with 3 options", c => { c[0].questions[0].options.pop(); }, /4 distinct/],
    ["mc with duplicate options", c => { c[0].questions[0].options[3] = "uno"; }, /4 distinct/],
    ["mc answer out of range", c => { c[0].questions[0].answer = 4; }, /index 0\.\.3/],
    ["mc answer bool", c => { c[0].questions[0].answer = true; }, /index 0\.\.3/],
    ["tf answer not bool", c => { c[0].questions[1].answer = 1; }, /true or false/],
    ["tf with options", c => { c[0].questions[1].options = ["a","b","c","d"]; }, /null or absent/],
    ["unknown question type", c => { c[0].questions[0].type = "open"; }, /"mc" or "tf"/],
    ["no questions", c => { c[0].questions = []; }, /questions must be a non-empty list/],
    ["no sentences", c => { c[0].sentences = []; }, /sentences must be a non-empty list/],
    ["spans not a list", c => { c[0].sentences[0].spans = {}; }, /spans must be a list/],
    ["span malformed", c => { c[0].sentences[0].spans = [[0,"4","a1"]]; }, /integer offsets/],
    ["span out of bounds", c => { c[0].sentences[0].spans = [[7,99,"a0"]]; }, /out of bounds/],
    ["spans overlapping", c => { c[0].sentences[0].spans = [[0,4,"a1"],[2,6,"a0"]]; }, /sorted and not overlap/],
    ["spans unsorted", c => { c[0].sentences[0].spans = [[7,11,"a0"],[0,4,"a1"]]; }, /sorted and not overlap/],
    ["span word not in the sentence's words", c => { c[0].sentences[0].spans = [[0,4,"b0"]]; }, /not in the sentence's words/],
    ["span over whitespace", c => { c[0].sentences[0].spans = [[4,5,"a1"]]; }, /only whitespace/],
    ["span splitting a surrogate pair", c => { c[0].sentences[0].t = "\u{1F642} vado."; c[0].sentences[0].spans = [[1,2,"a1"]]; }, /surrogate pair/],
  ];
  bad.forEach(([name, f, re]) => { const r = runP(mut(f)); check(`validate_pack rejects passages: ${name}`, r.status === 1 && re.test(r.stdout)); });
  const spanned = runP(mut(c => { c[0].sentences[0].spans = [[0,4,"a1"],[7,11,"a0"]]; c[0].sentences[1].spans = []; }));
  check("passages with valid spans (and an empty spans list) validate", spanned.status === 0 && !/spans/.test(spanned.stdout));
  const warnOnly = runP(mut(c => { c[0].sentences[0].t = "Non nel testo."; c[0].questions[0].words = []; }));
  check("sentence not in text / empty question words are warnings only", warnOnly.status === 0 && /does not appear in the passage text/.test(warnOnly.stdout) && /words is empty/.test(warnOnly.stdout));
  runP(PS);
  fs.unlinkSync(path.join(tmp, "passages.json"));
  const stale = cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), tmp], { encoding:"utf8" });
  check("removing passages.json without regenerating -> stale sentences.js error", stale.status === 1 && /out of sync/.test(stale.stdout));
  fs.rmSync(tmp, { recursive:true, force:true });
})();

// ------------------------------------------------------------ [23] app.html boot: voice-probe TDZ, notice timing, ko word-break
// engine/app.html's inline script is booted for real (no jsdom — this file has no
// dependencies): a minimal DOM stub gives it just enough `document`/`window` to run
// its top-level code and the boot IIFE. The stub is an id-registry + regex scan of
// each innerHTML assignment (not a real parser/tree), which is enough to reach the
// Today tab and one rendered drill item without needing the rest of the DOM surface.
// Level 1 with 3 counted sets whose records cover the original first 3 sets, then a republish:
// a level-2 word enters level 1 at rank 2 and ranks 5 and 35 swap.
function reorderedLevel(pack, words){
  const size = VC.setSizeOf(pack), l1 = words.filter(w => w.lv === "1"), l2 = words.filter(w => w.lv === "2");
  const prog = VC.normalizeProg({ sets:{ "1": 3 } }, pack);
  l1.slice(0, 3*size).forEach((w, i) => { prog.w[w.id] = { r: 1 + i % 3, w: i % 2, s: i % 4 }; });
  const moved = Object.assign({}, l2[0], { lv: "1" });
  const nl1 = l1.slice(); [nl1[5], nl1[35]] = [nl1[35], nl1[5]]; nl1.splice(2, 0, moved);
  const rest = words.filter(w => w.lv !== "1" && w.id !== moved.id);
  return { size, prog, words: [...nl1, ...rest], inserted: moved.id, swappedIn: l1[35].id,
    learnedIds: new Set(l1.slice(0, 3*size).map(w => w.id)), before: VC.learnedWords(words, pack, prog).map(w => w.id).sort() };
}

(function(){
  console.log("\n[29] learnedWords from word records: republish reorder, removal, legacy prefix fallback, d, placement seeding");
  const ids = p => p.map(w => w.id).sort();
  const R = reorderedLevel(PACK, WORDS);
  const after = VC.learnedWords(R.words, PACK, R.prog);
  check("reorder: insert at rank 2 + swap ranks 5/35 -> learnedWords identical to before", util.isDeepStrictEqual(ids(after), R.before));
  const nn = VC.nextNewSet(R.words, PACK, R.prog);
  check("reorder: nextNewSet holds the inserted word and the swapped-in unlearned word, no learned word, set is the count of sets learned (3, frequency tiers)",
    nn && nn.lv === "1" && nn.set === 3 && nn.words.length === R.size && nn.words.some(w => w.id === R.inserted)
    && nn.words.some(w => w.id === R.swappedIn) && nn.words.every(w => !R.learnedIds.has(w.id)));
  const l1n = R.words.filter(w => w.lv === "1");
  check("reorder: nextNewSet is the next unlearned words in rank order", util.isDeepStrictEqual(nn.words.map(w => w.id), l1n.filter(w => !R.learnedIds.has(w.id)).slice(0, R.size).map(w => w.id)));

  const gone = R.words.find(w => R.learnedIds.has(w.id));
  const less = WORDS.filter(w => w.id !== gone.id);
  let lr = null, thrown = null;
  try{ lr = VC.learnedWords(less, PACK, R.prog); }catch(e){ thrown = e; }
  check("removed learned word: learnedWords drops it, no throw, count one less", !thrown && lr.length === R.before.length - 1 && !lr.some(w => w.id === gone.id));
  const nnLess = VC.nextNewSet(less, PACK, R.prog);
  check("removed learned word: nextNewSet still starts after every learned word", nnLess && nnLess.words.every(w => !R.learnedIds.has(w.id)));

  const size = VC.setSizeOf(PACK), l1 = WORDS.filter(w => w.lv === "1");
  // a counter prefix is read in id order (VC.counterOrder; the counters were written before the frequency order)
  const co = VC.counterOrder(l1, PACK), pre2 = co.slice(0, 2*size);
  const legacy = VC.normalizeProg({ sets:{ "1": 2 } }, PACK);
  check("legacy sets {1:2}, no records -> learnedWords is the counter prefix (id order)", util.isDeepStrictEqual(VC.learnedWords(WORDS, PACK, legacy).map(w => w.id), pre2.map(w => w.id)));
  const raw = JSON.parse(JSON.stringify(legacy));
  l1.slice(2*size, 3*size).forEach(w => { raw.w[w.id] = { r:1, w:0, s:1 }; });
  check("legacy + one set's records written directly -> the records rule applies (just those words)", util.isDeepStrictEqual(ids(VC.learnedWords(WORDS, PACK, raw)), ids(l1.slice(2*size, 3*size))));
  const viaApp = JSON.parse(JSON.stringify(legacy));
  l1.slice(2*size, 3*size).forEach(w => { VC.ensureWordRec(viaApp, WORDS, PACK, w.id); VC.markRec(viaApp.w, w.id, true, true, "hear"); });
  viaApp.sets["1"] = 3;
  const unionIds = [...new Set([...pre2, ...l1.slice(2*size, 3*size)].map(w => w.id))];
  check("legacy + one set drilled via ensureWordRec -> prefix pinned as prov records, records rule (prefix + drilled set)",
    util.isDeepStrictEqual(ids(VC.learnedWords(WORDS, PACK, viaApp)), unionIds.slice().sort()) && pre2.every(w => viaApp.w[w.id].prov === 1)
    && util.isDeepStrictEqual(VC.nextNewSet(WORDS, PACK, viaApp).words.map(w => w.id), l1.filter(w => !unionIds.includes(w.id)).slice(0, size).map(w => w.id)));

  const dp = JSON.parse(JSON.stringify(R.prog)); const ahead = l1[6*size];
  dp.w[ahead.id] = { r:0, w:0, s:0, d:1 };
  check("drilled-ahead d word counts under the records rule", VC.learnedWords(WORDS, PACK, dp).some(w => w.id === ahead.id) && !VC.nextNewSet(WORDS, PACK, dp).words.some(w => w.id === ahead.id));
  const donly = JSON.parse(JSON.stringify(legacy)); donly.w[ahead.id] = { r:0, w:0, s:0, d:1 };
  check("d-only level: counter prefix plus the d word (d says nothing about the prefix)", util.isDeepStrictEqual(VC.learnedWords(WORDS, PACK, donly).map(w => w.id), [...pre2.map(w => w.id), ahead.id]));

  const st = VC.strata(WORDS, PACK.placement, size);
  const placed = VC.applyPlacement(VC.defaultProg(PACK), st, 2, WORDS, PACK);
  const seeded = {}; for(let i=0;i<2;i++) seeded[st[i].lv] = Math.max(seeded[st[i].lv]||0, st[i].s1);
  const expect = Object.keys(seeded).flatMap(lv => WORDS.filter(w => w.lv === lv).slice(0, seeded[lv]*size).map(w => w.id)).sort();
  check("placement seeds prov records for exactly the placed prefix", util.isDeepStrictEqual(Object.keys(placed.w).sort(), expect) && expect.every(id => placed.w[id].prov === 1));
  const repl = VC.applyPlacement(R.prog, st, 1, R.words, PACK);
  const newRecs = Object.keys(repl.w).filter(id => !R.prog.w[id]);
  const bucket = R.words.filter(w => w.lv === st[0].lv).slice(0, st[0].s1*size).map(w => w.id);
  check("placement after a reorder seeds only the placed bucket's prefix, never the counter prefix", newRecs.every(id => bucket.includes(id)) && newRecs.every(id => repl.w[id].prov === 1));
  const legPl = VC.applyPlacement(VC.normalizeProg({ sets:{ "1": 5 } }, PACK), st, 1, WORDS, PACK);
  check("placement on a legacy level keeps its old counter prefix learned (pinned first)", l1.slice(0, 5*size).every(w => legPl.w[w.id]));

  const full = VC.normalizeProg({ sets:{ "1": VC.nSets(l1, size) } }, PACK);
  l1.forEach(w => { full.w[w.id] = { r:1, w:0, s:1 }; });
  const grown = [...l1, Object.assign({}, WORDS.find(w => w.lv === "2"), { lv: "1" }), ...WORDS.filter(w => w.lv !== "1" && w.id !== WORDS.find(x => x.lv === "2").id)];
  const g = VC.nextNewSet(grown, PACK, full), gp = VC.stagePath(PACK, grown, [], full).find(s => s.lv === "1");
  check("counted-complete level gains a word: taught once, set index capped to the level's last set, stage not done",
    g && g.lv === "1" && g.words.length === 1 && g.set === VC.nSets(grown.filter(w => w.lv === "1"), size) - 1 && gp && !gp.done && gp.frac < 1);
})();

const appBootChecks = (async function(){
  console.log("\n[23] app.html boot: voice-probe TDZ guard, notice-on-first-shown, ko word-break");
  const appHtml = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
  const scriptBlocks = [...appHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(scriptBlocks.length < 2){ check("app.html has the inline app script (2 plain <script> tags)", false); return; }
  const appSrc = scriptBlocks[scriptBlocks.length - 1][1];

  // Attribute value is optional: a bare attribute (e.g. `data-tl`, no `="..."`) is
  // valid HTML (TA emits ` data-tl lang="..."`) and must still be picked up, or the
  // whole-tag scan below fails to close at `>` and the element never registers.
  function extractAttrs(tag){
    const attrs = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
    let m; while((m = re.exec(tag))){ if(m[1]) attrs[m[1]] = m[2] !== undefined ? m[2] : ""; }
    return attrs;
  }
  function makeFakeDom(){
    const registry = new Map();
    const tabButtons = [];
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
        return new Proxy({}, {
          get(_, k){ return attrs["data-" + toKebab(String(k))]; },
          set(_, k, v){ attrs["data-" + toKebab(String(k))] = String(v); return true; },
        });
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
      let m;
      while((m = re.exec(html))){
        const attrs = extractAttrs(m[2]);
        if(attrs.id) new El(m[1], attrs);
      }
    }
    // Seed the static ids/tab buttons from the real markup, so document.getElementById
    // and the two top-level document.querySelector(All) calls (tab wiring) resolve.
    const tabsMatch = appHtml.match(/<nav[^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/);
    const btnRe = /<button([^>]*)>/g;
    let bm; while((bm = btnRe.exec(tabsMatch[1]))){ tabButtons.push(new El("button", extractAttrs(bm[1]))); }
    const bodySection = appHtml.slice(appHtml.indexOf("<body>"), appHtml.indexOf("<nav"));
    registerIdsFromHtml(bodySection);
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
      _l: {}, addEventListener(t, f){ (this._l[t] = this._l[t] || []).push(f); },
    };
  }
  const tick = () => new Promise(r=>setTimeout(r,0));
  // Runs app.html's inline script (synchronously) against the real zh pack with a fake
  // speechSynthesis whose getVoices() returns synchronously (the Firefox/Windows case
  // that crashed). Returns before the async boot IIFE's continuation (after its first
  // await) has run, so callers can inspect pre-boot state; call tick() twice (one for
  // store.load()'s await, one for the microtask it schedules) to let boot finish.
  // getRenderCalls/ss/setItemCalls/setQueueAndNext/hearItem/hearSentence/dnext/
  // getHasSpeech are test-only hooks added by appending to the script text below, not
  // present in app.html itself.
  // env (optional): { navigator, location } overrides for the service-worker checks.
  function bootAppSync(getVoicesResult, env){
    const document = makeFakeDom();
    const ss = { getVoices: () => getVoicesResult, onvoiceschanged: null };
    const window = {
      VocabCore: VC,
      speechSynthesis: ss,
      SpeechSynthesisUtterance: function(){},
      _l: {}, addEventListener(t, f){ (this._l[t] = this._l[t] || []).push(f); },
      fire(t){ (this._l[t] || []).forEach(f => f({})); },
    };
    const navigator = (env && env.navigator) || { userAgent: "EngineChecks/1.0" };
    const location = env ? env.location : undefined;
    const pack = (env && env.pack) || PACK;
    const words = (env && env.words) || WORDS;
    const setItemCalls = [];
    const localStorage = { getItem(){ return null; }, setItem(k,v){ setItemCalls.push([k,v]); } };
    const matchMedia = () => ({ matches:false });
    const requestAnimationFrame = fn => setTimeout(fn, 0);
    const fnBody = ((env && env.appSrc) || appSrc) + `
let __renderCalls = 0;
const __wrappedRender = render;
render = function(){ __renderCalls++; return __wrappedRender.apply(this, arguments); };
let __taught = null;
const __wrappedTeach = vocabTeach;
vocabTeach = function(list){ __taught = list; return __wrappedTeach.apply(this, arguments); };
let __announced = "";
const __wrappedAnnounce = announce;
announce = function(h){ __announced = h; return __wrappedAnnounce.apply(this, arguments); };
return {
  getAnnounced:()=>__announced,
  glossHTML, glossBox, startPassage, readResults, readRender, getProg:()=>prog, readQuestion: qi => { RD.qi = qi; readQuestionScreen(); },
  optsMarkup: () => { const o = document.getElementById("o"); return o ? o.children.map(b => \`<button\${b.dir ? \` dir="\${b.dir}"\` : ""}>\${b.innerHTML}</button>\`).join("") : ""; }, passageSentenceHTML, getRD:()=>RD, getHasSpeech:()=>hasSpeech, getRenderCalls:()=>__renderCalls, hearItem, hearSentence, readItem, typeItem, recallItem, pronTypeItem, writtenTypeItem, itemFromPlan, gapSentence, dnext,
  setHasSpeech: v => { hasSpeech = v; },
  setQueueAndNext:(items, onDone) => { D = { q: items.slice(), right:0, seen:0, miss:[], onDone: onDone||(()=>{}), summary:null }; dnext(); },
  today: () => { tab = "today"; render(); },
  enterTodayStep: (step, read) => { todayStepState = read === undefined ? { step } : { step, read }; todayStep(); },
  testTab: () => { tab = "test"; testSel = null; render(); }, setProgT: p => { prog = p; },
  enterPlacement: () => { tab = "test"; testSel = "placement"; startPlacement(); }, getPL: () => PL, placeNext: () => placeVocabNext(), getTodayStepState: () => todayStepState,
  getHtml: id => { const e = document.getElementById(id); return e ? e.innerHTML : ""; },
  wordsTab: () => { tab = "words"; wordsSet = null; wordsQuery = ""; render(); }, getTaught: () => __taught,
  progressTab: () => { tab = "progress"; render(); },
  setWordsSet: n => { wordsSet = n; renderWordBody(); }, finishDrill: () => D.onDone(), clickId: id => document.getElementById(id).onclick({}),
};`;
    // PASSAGES only when env.passages is given (undefined -> no Read tab, as before).
    const fn = new Function("document","window","navigator","location","localStorage","matchMedia","requestAnimationFrame","PACK","WORDS","SENTENCES","LESSONS","PASSAGES", fnBody);
    const api = fn(document, window, navigator, location, localStorage, matchMedia, requestAnimationFrame, pack, words, (env && env.sentences) || SENTENCES, (env && env.lessons) || LESSONS, env && env.passages);
    return { api, document, ss, setItemCalls, window };
  }
  async function bootApp(getVoicesResult, env){
    const boot = bootAppSync(getVoicesResult, env);
    await tick();
    await tick();
    return boot;
  }

  // (a) non-empty voice list, no voice for the pack's language (zh-CN): the Firefox/
  // Windows repro that crashed with "Cannot access 'D' before initialization".
  try{
    const { api, document } = await bootApp([{ lang:"en-US", name:"x" }]);
    check("voice probe: non-empty voice list, no match -> no throw, page renders Today", document.getElementById("htitle").textContent === "Today");
    check("voice probe: non-empty voice list, no match -> hasSpeech false", api.getHasSpeech() === false);
  }catch(e){ check(`voice probe (non-empty, no match) does not throw (got: ${e.message})`, false); }

  // (b) a matching voice present.
  try{
    const { api, document } = await bootApp([{ lang:"zh-CN", name:"x" }]);
    check("voice probe: matching voice -> no throw, page renders Today", document.getElementById("htitle").textContent === "Today");
    check("voice probe: matching voice -> hasSpeech true", api.getHasSpeech() === true);
  }catch(e){ check(`voice probe (matching voice) does not throw (got: ${e.message})`, false); }

  // (c) empty voice list (not yet loaded / never populated): speechUsable is optimistic.
  try{
    const { api, document } = await bootApp([]);
    check("voice probe: empty voice list -> no throw, page renders Today", document.getElementById("htitle").textContent === "Today");
    check("voice probe: empty voice list -> hasSpeech true", api.getHasSpeech() === true);
  }catch(e){ check(`voice probe (empty voice list) does not throw (got: ${e.message})`, false); }

  // (d) late voice list (fb46): an empty list reads as "a voice is there", so a hear item built before the
  // list arrives asks for audio. voiceschanged re-runs the probe: a list without the pack's language turns the
  // unanswered hear items, the one on screen included, into read items with the no-voice notice; a list with
  // the voice leaves them hear items (nothing re-rendered, nothing restarted).
  try{
    const NOTICE = "No voice for this language in this browser";
    const b = await bootApp([]); const r0 = b.api.getRenderCalls();
    check("late voices: empty list at boot -> optimistic (hasSpeech true), no notice on Today", b.api.getHasSpeech() === true && !b.api.getHtml("panel").includes(NOTICE));
    const hearA = b.api.hearItem(WORDS[5]), hearB = b.api.hearItem(WORDS[6]);
    check("late voices: hear items built on the empty list are hear items (not flagged needsNotice)", !hearA.needsNotice && !hearB.needsNotice);
    b.api.setQueueAndNext([hearA, hearB], () => {});
    const hearHtml = b.api.getHtml("panel");
    check("late voices: the hear item on screen shows no notice", !hearHtml.includes(NOTICE));
    b.ss.getVoices = () => [{ lang: "en-US", name: "x" }]; b.ss.onvoiceschanged();
    const afterHtml = b.api.getHtml("panel");
    check("late voices: the list arrives without the pack's language -> hasSpeech false", b.api.getHasSpeech() === false);
    check("late voices: the item on screen is now the read item with the no-voice notice (same drill, not Today)", afterHtml.includes(NOTICE) && afterHtml !== hearHtml && /id="o"/.test(afterHtml) && b.api.getRenderCalls() === r0);
    b.document.getElementById("o").children[0].click(); b.document.getElementById("nx").click();
    const nextHtml = b.api.getHtml("panel");
    check("late voices: the queued hear item was turned into a read item too (no second notice, an item shown)", /id="o"/.test(nextHtml) && !nextHtml.includes(NOTICE) && nextHtml !== afterHtml);
    const c = await bootApp([]);
    c.api.today(); const cr = c.api.getRenderCalls();
    c.ss.getVoices = () => [{ lang: "en-US", name: "x" }]; c.ss.onvoiceschanged();
    check("late voices: Today re-renders when the list arrives without the pack's language", c.api.getHasSpeech() === false && c.api.getRenderCalls() === cr + 1);
    c.ss.getVoices = () => [{ lang: "en-US", name: "x" }, { lang: "zh-CN", name: "z" }]; c.ss.onvoiceschanged();
    check("late voices: a later list with the voice flips hasSpeech back to true", c.api.getHasSpeech() === true);
    const d = await bootApp([]); const hearC = d.api.hearItem(WORDS[7]); d.api.setQueueAndNext([hearC], () => {}); const h0 = d.api.getHtml("panel"), dr = d.api.getRenderCalls();
    d.ss.getVoices = () => [{ lang: "zh-CN", name: "z" }]; d.ss.onvoiceschanged();
    check("late voices: the list arrives with the voice -> the hear item on screen is left as it is", d.api.getHasSpeech() === true && d.api.getHtml("panel") === h0 && d.api.getRenderCalls() === dr);
    const e = await bootApp([]); e.ss.getVoices = () => []; e.ss.onvoiceschanged();
    check("late voices: an event that still lists nothing keeps the optimistic read (hasSpeech true)", e.api.getHasSpeech() === true);
  }catch(e){ check(`late voice list scenario does not throw (got: ${e.stack})`, false); }

  // Boot gating: a voice-probe re-render must not run before boot has rendered once
  // (prog isn't loaded yet — a pre-boot render could refreshReadUnlocks() -> store.save()
  // the not-yet-loaded default prog, clobbering real saved progress before store.load()
  // ever reads it back), and a voice change after boot must still re-render.
  try{
    const boot = bootAppSync([{ lang:"en-US", name:"x" }]); // probe fires sync, pre-boot
    check("pre-boot voice probe does not render", boot.api.getRenderCalls() === 0);
    check("pre-boot voice probe does not save progress", boot.setItemCalls.length === 0);
    await tick(); await tick(); // let the boot IIFE's own render() run
    check("boot renders exactly once", boot.api.getRenderCalls() === 1);
    check("after boot, page has rendered Today", boot.document.getElementById("htitle").textContent === "Today");
    boot.ss.getVoices = () => [{ lang:"zh-CN", name:"y" }]; // now matches -> hasSpeech flips false->true
    boot.ss.onvoiceschanged();
    check("a voice change after boot flips hasSpeech", boot.api.getHasSpeech() === true);
    check("a voice change after boot re-renders", boot.api.getRenderCalls() === 2);
  }catch(e){ check(`boot-gating scenario does not throw (got: ${e.message})`, false); }

  // Screen re-entry restores, never restarts (TODO.md "readRender re-mount"): a voice
  // change mid-placement or on a Today teach screen between steps leaves the screen as it
  // is; render() would restart placement from its intro or drop the session to the plan.
  try{
    let voices = [{ lang:"en-US", name:"x" }];
    const b = await bootApp(voices);
    b.ss.getVoices = () => voices;
    b.api.enterPlacement();
    const pl = b.api.getPL(), h0 = b.document.getElementById("panel").innerHTML, r0 = b.api.getRenderCalls();
    voices = [{ lang:"zh-CN", name:"y" }]; b.ss.onvoiceschanged();
    check("voice change mid-placement: no re-render, same placement run and item on screen",
      b.api.getHasSpeech() === true && b.api.getRenderCalls() === r0 && b.api.getPL() === pl && b.document.getElementById("panel").innerHTML === h0);
    const b2 = await bootApp([{ lang:"en-US", name:"x" }]);
    b2.api.today();
    b2.api.enterTodayStep(1); // Learn: the teach screen (D not set yet)
    const t0 = b2.document.getElementById("panel").innerHTML, r2 = b2.api.getRenderCalls();
    b2.ss.getVoices = () => [{ lang:"zh-CN", name:"y" }]; b2.ss.onvoiceschanged();
    check("voice change on a Today teach screen: no re-render, session kept", /id="dr"/.test(t0) && b2.api.getRenderCalls() === r2 && b2.api.getTodayStepState() && b2.document.getElementById("panel").innerHTML === t0);
  }catch(e){ check(`re-mount guard scenario does not throw (got: ${e.stack})`, false); }

  // placement-mix (TODO.md "placement leniency"): Italian placement asks Review's kinds end to end. The typed item is Review's
  // checker (B1 strict accents, A1 lenient), one attempt, no requeue; no word record is written before the result.
  try{
    let dir = process.env.LANG_REPOS_DIR || null;
    if(!dir) for(let d = path.join(ROOT, ".."); ; d = path.dirname(d)){ if(fs.existsSync(path.join(d, "italian", "pack", "pack.js"))){ dir = d; break; } if(path.dirname(d) === d) break; }
    const f = dir && path.join(dir, "italian", "pack");
    if(!f || !fs.existsSync(path.join(f, "pack.js"))) console.log("    skip: italian pack not found (LANG_REPOS_DIR)");
    else {
      const IT = { pack: loadConst(path.join(f, "pack.js"), "PACK"), words: loadConst(path.join(f, "words.js"), "WORDS"), sentences: loadConst(path.join(f, "sentences.js"), "SENTENCES"), lessons: [] };
      const panel = b => b.document.getElementById("panel").innerHTML, el = (b, id) => b.document.getElementById(id);
      const fold = x => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const walk = async (pack, answer) => {
        const b = await bootApp([{ lang: "it-IT", name: "x" }], Object.assign({}, IT, { pack }));
        const orig = Math.random; Math.random = require("./lib/port_sim.js").mulberry32(11);
        try {
          b.api.enterPlacement();
          const pl = b.api.getPL(), seen = []; let recBefore = -1;
          for(let g = 0; g < 200 && pl.cur; g++){
            const q = pl.cur, it = pl.vocab.items[pl.vocab.i - 1], h = panel(b), last = pl.vocab.i === pl.vocab.items.length;
            if(last) recBefore = Object.keys(b.api.getProg().w || {}).length;
            const typed = !!el(b, "tin") && /id="tin"/.test(h);
            seen.push({ kind: it.kind, typed, label: q.label || "", lv: it.w.lv, b: it.b });
            if(typed){ el(b, "tin").value = answer(it, q) ? (q.label === "Type the meaning" ? VC.gloss(it.w) : it.w.w) : "zzz"; el(b, "submit").click(); seen[seen.length - 1].reveal = panel(b) + (el(b, "rv") ? el(b, "rv").innerHTML : ""); if(!el(b, "nx")) break; el(b, "nx").click(); }
            else { const btns = el(b, "o").children; (answer(it, q) ? btns.find(x => x.dataset.v === String(q.a)) : btns.find(x => x.dataset.v !== String(q.a))).click(); }
            if(/Start at/.test(panel(b))) break;
          }
          return { b, pl, seen, recBefore, html: panel(b) };
        } finally { Math.random = orig; }
      };
      const all = await walk(IT.pack, () => true);
      const n = all.seen.length, kinds = k => all.seen.filter(x => x.kind === k).length;
      check(`italian placement walk, all right: ${n} items (read ${kinds("read")}, recall ${kinds("recall")}, type ${kinds("type")}), every bucket full marks`,
        n === 42 && kinds("read") === 14 && kinds("recall") === 14 && kinds("type") === 14 && all.pl.res.every((r, i) => r.n === VC.placementItemCount(i, IT.pack) && r.r === r.n));
      const tl = all.seen.filter(x => x.kind === "type").map(x => x.label);
      check(`italian placement: recall is Review's card (Which word is this?), type is Review's typed card with its typedFrom rotation (${tl.filter(l => l === "Type the word").length} word, ${tl.filter(l => l === "Type the meaning").length} meaning)`,
        all.seen.filter(x => x.kind === "recall").every(x => x.label === "Which word is this?" && !x.typed) && all.seen.filter(x => x.kind === "type").every(x => x.typed) && tl.every((l, i) => l === (i % 2 ? "Type the meaning" : "Type the word")));
      check("italian placement: a typed answer shows the word (Review's reveal), no word record written before the result screen",
        all.seen.filter(x => x.typed).every(x => /class="rw/.test(x.reveal)) && all.recBefore === 0 && /Start at/.test(all.html));
      // a typed miss counts once: same item count, the bucket's n up and r not, no re-ask
      const miss = await walk(IT.pack, it => it.kind !== "type" || it.b !== 0);
      const t0 = miss.seen.filter(x => x.b === 0 && x.typed);
      check(`italian placement: a typed miss in bucket 0 is one miss (${miss.pl.res[0].r}/${miss.pl.res[0].n}), shows "You typed", is not re-asked (${miss.seen.length} items)`,
        t0.length === 1 && miss.pl.res[0].n === 3 && miss.pl.res[0].r === 2 && /You typed zzz/.test(t0[0].reveal) && miss.seen.length === 42);
      // Review's checker per level: B1 strict, A1 lenient (typing.strictFromLevel "B1")
      const acc = lv => IT.words.find(w => w.lv === lv && fold(w.w) !== w.w && !IT.words.some(v => v !== w && fold(v.w) === fold(w.w)));
      const a1 = acc("A1"), b1 = acc("B1");
      const st = await bootApp([{ lang: "it-IT", name: "x" }], IT);
      st.api.enterPlacement(); const pl = st.api.getPL();
      // one typed item per run, each the first type slot (typed the word, as the rotation starts)
      pl.vocab.items = [{ b: 0, w: a1, kind: "type" }, { b: 11, w: b1, kind: "type" }]; pl.vocab.i = 0; pl.res.forEach(r => { r.r = 0; r.n = 0; });
      st.api.placeNext(); el(st, "tin").value = fold(a1.w); el(st, "submit").click(); pl.plan = []; el(st, "nx").click();
      el(st, "tin").value = fold(b1.w); el(st, "submit").click();
      check(`italian placement typed: "${fold(a1.w)}" for A1 ${a1.w} right (lenient), "${fold(b1.w)}" for B1 ${b1.w} a miss (strict)`, pl.res[0].r === 1 && pl.res[0].n === 1 && pl.res[11].r === 0 && pl.res[11].n === 1);
      const off = await walk(Object.assign({}, IT.pack, { typing: null }), () => true);
      check(`italian copy without typing: ${off.seen.length} items, none typed, type slots asked as recall (${off.seen.filter(x => x.label === "Which word is this?").length} recall cards)`,
        off.seen.length === 42 && off.seen.every(x => !x.typed && x.kind !== "type") && off.seen.filter(x => x.kind === "recall").length === 28);
    }
  }catch(e){ check(`italian placement walk does not throw (got: ${e.stack})`, false); }

  // Test tab: a free test held back by a threshold shows an unlock note in its place.
  try{
    const b = await bootApp([{ lang:"zh-CN", name:"x" }]);
    const fresh = VC.normalizeProg({ sets: {}, placedOnce: true, sessions: 1 }, PACK);
    b.api.setProgT(fresh); b.api.testTab();
    const h0 = b.api.getHtml("panel");
    check("Test tab, nothing learned (placed): the learn-first line only (it covers every free test)", /Free tests unlock at/.test(h0) && !/id="tSentLock"/.test(h0) && !/id="tSentences"/.test(h0));
    const lv = PACK.levels[0].id, pr = VC.normalizeProg({ sets: {}, placedOnce: true, sessions: 1 }, PACK);
    let k = 0; for(const w of WORDS){ if(w.lv !== lv) continue; pr.w[w.id] = { r: 3, w: 0, s: 3, d: 1 }; if(++k >= 8) break; }
    pr.sets[lv] = 1;
    b.api.setProgT(pr); b.api.testTab();
    const h1 = b.api.getHtml("panel"), m = h1.match(/id="tSentLock"[^>]*>([^<]*)</);
    const learned = WORDS.filter(w => pr.w[w.id]).length;
    check(`Test tab, ${learned} learned words, few sentences: word tests + "Sentences test: unlocks at 8 sentences (N so far)" note`, /id="tListen"/.test(h1) && !/id="tSentences"/.test(h1) && !!m && /^Sentences test: unlocks at 8 sentences \(\d+ so far\)\.$/.test(m[1]), m ? m[1] : h1.slice(0, 300));
  }catch(e){ check(`Test tab unlock notes do not throw (got: ${e.stack})`, false); }

  // Notice timing: the item built first must not be the one that gets the one-time
  // no-voice notice if a later-built item is the one actually shown first (shuffle),
  // an item that never needs it (type / plain read) never shows it, and the notice is
  // skipped even for a flagged item if hasSpeech has since flipped true.
  try{
    const { api, document } = await bootApp([{ lang:"en-US", name:"x" }]); // hasSpeech=false
    const builtFirst = api.hearItem(WORDS[5]);
    const builtSecond = api.hearItem(WORDS[6]);
    check("hear items without speech are flagged needsNotice at build time (not shown yet)",
      builtFirst.needsNotice === true && builtSecond.needsNotice === true);
    const typeItem = api.typeItem(WORDS[7]); // never a hear item; needsNotice must be unset
    check("a plain type item is never flagged needsNotice", !typeItem.needsNotice);
    api.setQueueAndNext([typeItem, builtSecond, builtFirst], () => {});
    const typeHtml = document.getElementById("panel").innerHTML;
    check("no notice on a type item shown first", !typeHtml.includes("No voice for this language in this browser"));
    api.dnext(); // advance past the type item straight to the queue's next entry (bypassing its input UI)
    const shownFirstHtml = document.getElementById("panel").innerHTML;
    check("notice appears on the first hear item actually shown (built second, after the type item)", shownFirstHtml.includes("No voice for this language in this browser"));
    document.getElementById("o").children[0].click();
    document.getElementById("nx").click();
    const shownSecondHtml = document.getElementById("panel").innerHTML;
    check("notice does not repeat on the item shown second (built first)", !shownSecondHtml.includes("No voice for this language in this browser"));
  }catch(e){ check(`notice-timing scenario does not throw (got: ${e.message})`, false); }

  try{
    const { api, document } = await bootApp([{ lang:"en-US", name:"x" }]); // hasSpeech=false
    const flagged = api.hearItem(WORDS[8]);
    api.setHasSpeech(true); // voice arrives between build and display
    api.setQueueAndNext([flagged], () => {});
    const html = document.getElementById("panel").innerHTML;
    check("a needsNotice item shows no notice if hasSpeech flips true before it's shown", !html.includes("No voice for this language in this browser"));
  }catch(e){ check(`hasSpeech-flips-before-show scenario does not throw (got: ${e.message})`, false); }

  // Every word item passes its own kind to markWord, so a miss is remembered as prog.w[id].k.
  try{
    const { api } = await bootApp([{ lang:"zh-CN", name:"x" }]);
    const pr = api.getProg();
    const sites = [["hearItem","hear"],["readItem","read"],["recallItem","recall"],["typeItem","type"],["pronTypeItem","type"],["writtenTypeItem","type"]];
    const got = sites.map(([f, k], i) => { const w = WORDS[40 + i]; api[f](w).onAnswer(false); return (pr.w[w.id] || {}).k === k; });
    check(`word items: a miss records its kind as k (${sites.map(([f, k], i) => `${f}:${got[i] ? k : "?"}`).join(" ")})`, got.every(Boolean));
    const w = WORDS[40]; api.readItem(w).onAnswer(true); const kept = pr.w[w.id].k === "hear";
    api.hearItem(w).onAnswer(true);
    check("word items: a pass in another kind keeps k, a pass in the same kind clears it", kept && !("k" in pr.w[w.id]));
    const { api: api2 } = await bootApp([{ lang:"en-US", name:"x" }]); const pr2 = api2.getProg();
    api2.hearItem(WORDS[50]).onAnswer(false);
    check("unhearable hear item (degraded to read) records the kind shown: read", pr2.w[WORDS[50].id].k === "read");
    pr2.w[WORDS[51].id] = { r:1, w:1, s:0, k:"hear" };
    const fb = api2.itemFromPlan({ kind:"hear", word: WORDS[51] }, 0, []);
    fb.onAnswer(true);
    check("sticky k: k=hear on a no-voice device clears after a pass on the read fallback", fb.reqKind === "hear" && !("k" in pr2.w[WORDS[51].id]));
    const { api: api3 } = await bootApp([{ lang:"zh-CN", name:"x" }], { pack: Object.assign({}, PACK, { typing: undefined }) }); const pr3 = api3.getProg();
    pr3.w[WORDS[52].id] = { r:1, w:1, s:0, k:"type" };
    const tf = api3.itemFromPlan({ kind:"type", word: WORDS[52] }, 0, []);
    tf.onAnswer(true);
    check("sticky k: k=type with typing off clears after a pass on the recall fallback", tf.reqKind === "type" && tf.kind === "mc" && !("k" in pr3.w[WORDS[52].id]));
    pr3.w[WORDS[53].id] = { r:1, w:0, s:1, k:"hear" }; api3.itemFromPlan({ kind:"recall", word: WORDS[53] }, 0, []).onAnswer(true);
    check("sticky k: a pass in an unrelated kind still keeps k", pr3.w[WORDS[53].id].k === "hear");
    // Cloze: a gap/gapType answer sets or clears the blanked word's k only; its r/w/s are the sentence's.
    const one = SENTENCES.find(s => VC.gapCandidateIndices(s, Object.fromEntries(WORDS.map(w => [w.id, w])), PACK).length === 1);
    const bid = one.words[VC.gapCandidateIndices(one, Object.fromEntries(WORDS.map(w => [w.id, w])), PACK)[0]];
    pr.w[bid] = { r:4, w:1, s:2 };
    const g1 = api.gapSentence(one, false); g1.onAnswer(false);
    const afterMiss = JSON.stringify(pr.w[bid]);
    api.gapSentence(one, false).onAnswer(true);
    // t / u: the day and session of the last answer (day log); p: the word's pairs (a cloze miss is a written<->meaning miss).
    const noT = j => { const r = Object.assign({}, typeof j === "string" ? JSON.parse(j) : j); delete r.t; delete r.u; delete r.p; return JSON.stringify(r); };
    check(`cloze (choice) miss sets k=recall on the blank word ${bid}, r/w/s untouched; a gap pass clears it`,
      noT(afterMiss) === JSON.stringify({ r:4, w:1, s:2, k:"recall" }) && noT(pr.w[bid]) === JSON.stringify({ r:4, w:1, s:2 }) && pr.s[one.id] && pr.s[one.id].w === 1);
    const saved = pr.w[bid]; delete pr.w[bid]; api.gapSentence(one, false).onAnswer(false);
    check("cloze: a blank word with no record is not given one", !(bid in pr.w)); pr.w[bid] = saved;
    const typPack = Object.assign({}, PACK, { typing:{ caseSensitive:false, accents:"lenient", strictFromLevel:null }, typedFrom: undefined });
    const { api: api4 } = await bootApp([{ lang:"zh-CN", name:"x" }], { pack: typPack }); const pr4 = api4.getProg();
    pr4.w[bid] = { r:4, w:1, s:2, k:"recall" };
    const gt = api4.gapSentence(one, true); gt.onAnswer(false);
    const tMiss = pr4.w[bid].k;
    api4.gapSentence(one, false).onAnswer(true); const keptType = pr4.w[bid].k === "type";
    api4.gapSentence(one, true).onAnswer(true);
    check("cloze gapType: miss sets k=type (r/w/s untouched); a choice-gap pass keeps k=type; a gapType pass clears it",
      gt.kind === "type" && tMiss === "type" && keptType && !("k" in pr4.w[bid]) && pr4.w[bid].r === 4 && pr4.w[bid].w === 1);
  }catch(e){ check(`missed-kind item scenario does not throw (got: ${e.message})`, false); }

  // A missed typed item comes back until typed right; from its second miss in the drill it
  // comes back as its choice counterpart (word -> recall, typed gap -> choice gap), which
  // keeps k at "type" (a pass there leaves it, a miss records type).
  try{
    const typPack = Object.assign({}, PACK, { typing:{ caseSensitive:false, accents:"lenient", strictFromLevel:null }, typedFrom: undefined });
    const b = await bootApp([{ lang:"zh-CN", name:"x" }], { pack: typPack }); const pr = b.api.getProg(), el = id => b.document.getElementById(id);
    const w = WORDS[60]; pr.w[w.id] = { r:2, w:0, s:2 };
    const typeOnce = v => { el("tin").value = v; el("submit").click(); };
    const label = () => (el("panel").innerHTML.match(/<p class="q">([^<]*)<\/p>/) || [])[1];
    b.api.setQueueAndNext([b.api.itemFromPlan({ kind:"type", word: w }, 0, [])], () => {});
    check("setup: a typed word item", label() === "Type the word");
    typeOnce("zzz"); const k1 = pr.w[w.id].k; el("nx").click();
    check("first miss: requeued as the same typed item, k=type", label() === "Type the word" && k1 === "type");
    typeOnce("zzz"); el("nx").click();
    const opts = el("o") ? el("o").children : [];
    check("second miss: comes back as a recall item (answer among the options), k still type", label() === "Which word is this?" && opts.some(o => o.dataset.v === w.id) && pr.w[w.id].k === "type" && pr.w[w.id].w === 2);
    opts.find(o => o.dataset.v !== w.id).click();
    check("a miss on the recall fallback records k=type (not recall)", pr.w[w.id].k === "type" && pr.w[w.id].w === 3);
    el("nx").click();
    check("missed recall fallback: requeued as recall", label() === "Which word is this?");
    el("o").children.find(o => o.dataset.v === w.id).click();
    check("a pass on the recall fallback keeps k=type (production still owed)", pr.w[w.id].k === "type" && pr.w[w.id].r === 3);
    el("nx").click();
    check("drill ends after the pass (first-time score: 0 of 1, the word was missed)", /<h2>0 of 1<\/h2>/.test(el("panel").innerHTML));
    // A pass on the first retry never reaches the fallback.
    const w2 = WORDS[61]; pr.w[w2.id] = { r:2, w:0, s:2 };
    b.api.setQueueAndNext([b.api.itemFromPlan({ kind:"type", word: w2 }, 0, [])], () => {});
    typeOnce("zzz"); el("nx").click(); typeOnce(w2.w); el("nx").click();
    check("miss then typed right: done (0 of 1), k cleared", /<h2>0 of 1<\/h2>/.test(el("panel").innerHTML) && !("k" in pr.w[w2.id]));
    // Typed gap -> choice gap on the second miss, same blank.
    const WB = Object.fromEntries(WORDS.map(x => [x.id, x]));
    const one = SENTENCES.find(x => VC.gapCandidateIndices(x, WB, typPack).length === 1);
    const bid = one.words[VC.gapCandidateIndices(one, WB, typPack)[0]]; pr.w[bid] = { r:4, w:1, s:2 };
    const gt = b.api.gapSentence(one, true);
    b.api.setQueueAndNext([gt], () => {});
    const gapHtml = (el("panel").innerHTML.match(/<div class="med wd"[^>]*>[\s\S]*?<\/div>/) || [])[0];
    typeOnce("zzz"); el("nx").click(); typeOnce("zzz"); el("nx").click();
    const gOpts = el("o") ? el("o").children : [];
    const gapHtml2 = (el("panel").innerHTML.match(/<div class="med wd"[^>]*>[\s\S]*?<\/div>/) || [])[0];
    check("typed gap, second miss: the choice gap on the same blank, k=type", label() === "What&#39;s the missing word?" && !!gapHtml && gapHtml2 === gapHtml && gOpts.length >= 2 && pr.w[bid].k === "type");
    gOpts.find(o => o.dataset.v === gt.choiceFallback().a).click();
    check("a pass on the choice gap keeps k=type; the sentence record counts it", pr.w[bid].k === "type" && pr.s[one.id].r >= 1 && pr.w[bid].r === 4);
  }catch(e){ check(`typed requeue scenario does not throw (got: ${e.stack})`, false); }

  try{
    const { api, document } = await bootApp([{ lang:"en-US", name:"x" }]); // hasSpeech=false
    const plainRead = api.readItem(WORDS[9]);
    api.setQueueAndNext([plainRead], () => {});
    const html = document.getElementById("panel").innerHTML;
    check("a plain read item (not hearItem's no-speech fallback) never shows the notice", !html.includes("No voice for this language in this browser"));
  }catch(e){ check(`plain read item scenario does not throw (got: ${e.message})`, false); }

  // The notice explains a replaced listening item; a drill with none replaced never shows it,
  // while Progress keeps its standing line whenever nothing can be heard.
  try{
    const { api, document } = await bootApp([{ lang:"en-US", name:"x" }]); // hasSpeech=false
    const htmls = [];
    const q = [api.readItem(WORDS[10]), api.readItem(WORDS[11]), api.readItem(WORDS[12])];
    api.setQueueAndNext(q, () => {});
    for(let i = 0; i < q.length; i++){
      htmls.push(document.getElementById("panel").innerHTML);
      document.getElementById("o").children[0].click();
      document.getElementById("nx").click();
    }
    check("no-voice drill with zero converted items: no notice on any item", htmls.length === 3 && htmls.every(h => !h.includes("No voice for this language in this browser")));
    api.progressTab();
    check("Progress shows the no-voice line when hasSpeech is false and the pack has no clips", /No voice for this language in this browser/.test(document.getElementById("panel").innerHTML));
    api.setHasSpeech(true); api.progressTab();
    check("Progress drops the line once a voice is usable", !/No voice for this language in this browser/.test(document.getElementById("panel").innerHTML));
  }catch(e){ check(`zero-converted drill / Progress line scenario does not throw (got: ${e.message})`, false); }

  // A remembered hear miss (k) on a word the planner turned into read must still clear on a pass.
  try{
    const { api, document } = await bootApp([{ lang:"en-US", name:"x" }]); // hasSpeech=false
    const w = WORDS[13];
    api.getProg().w[w.id] = { r:1, w:1, s:0, k:"hear" };
    const p = VC.hearableKinds([{ kind:"hear", word:w }], api.canHearWord || (() => false))[0];
    const it = api.itemFromPlan(p, 0, [p]);
    check("no voice, k:hear word: planned as read, item keeps reqKind hear, no notice flag", p.kind === "read" && it.reqKind === "hear" && !it.needsNotice);
    api.setQueueAndNext([it], () => {});
    const opt = document.getElementById("o").children.find(o => o.dataset.v === it.a);
    opt.click();
    check("a pass on that read item clears k", api.getProg().w[w.id].k === undefined && api.getProg().w[w.id].r === 2);
  }catch(e){ check(`k:hear read stand-in scenario does not throw (got: ${e.stack})`, false); }

  // ko word-break:keep-all: scoped to the lang attribute TA sets from pack.langTag, not
  // a blanket [data-tl] rule (which would also wrap ja/zh, which have no spaces, mid-word).
  // [lang|="ko"] semantics: matches exactly "ko" or "ko-*", not other ko-prefixed codes
  // (kok, kos) that ^= would wrongly match.
  const matchesLangDash = lang => lang === "ko" || lang.startsWith("ko-");
  const koLang = VC.scriptDisplay({ langTag: "ko-KR" }).lang;
  const jaLang = VC.scriptDisplay({ langTag: "ja" }).lang;
  const zhLang = VC.scriptDisplay({ tts: "zh-CN" }).lang;
  const kokLang = VC.scriptDisplay({ langTag: "kok" }).lang; // Konkani: ^= would false-match, |= must not
  check('langTag ko-KR resolves to a lang [lang|="ko"] matches', matchesLangDash(koLang));
  check('ja, zh and kok (Konkani) do not match [lang|="ko"]', !matchesLangDash(jaLang) && !matchesLangDash(zhLang) && !matchesLangDash(kokLang));
  check('app.html: word-break:keep-all is scoped to [data-tl][lang|="ko"], not a blanket [data-tl] rule',
    /\[data-tl\]\[lang\|="ko"\]\s*\{[^}]*word-break\s*:\s*keep-all/.test(appHtml) &&
    !/\[data-tl\]\s*\{[^}]*word-break/.test(appHtml));

  // pack.fonts: the runtime-added Google Fonts link uses the media swap (print -> all on
  // load), so it never blocks rendering either; no link at all for a pack without fonts.
  try{
    const plain = bootAppSync([{ lang:"zh-CN", name:"x" }]);
    const withFonts = bootAppSync([{ lang:"zh-CN", name:"x" }], { pack: Object.assign({}, PACK, { fonts: ["Noto Sans JP", "Vazirmatn"] }) });
    const links = withFonts.document.head.appended.filter(e => e.tagName === "LINK");
    const l = links[0];
    const mediaBefore = l && l.media;
    if(l && l.onload) l.onload();
    check("pack.fonts: one Google Fonts link for both families, media print until loaded, then all",
      plain.document.head.appended.length === 0 && links.length === 1 && l.rel === "stylesheet" &&
      /^https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Sans\+JP&family=Vazirmatn&display=swap$/.test(l.href) &&
      mediaBefore === "print" && l.media === "all");
    await tick(); await tick();
  }catch(e){ check(`pack.fonts link scenario does not throw (got: ${e.message})`, false); }

  // RTL gloss popover: for pack.rtl the #gloss container is an LTR line (dir=ltr, even
  // inside an RTL block) holding the word as an isolated dir=rtl span, then pron and the
  // English gloss as LTR runs, so a wrapping gloss never interleaves with the word
  // (docs/PACK_SCHEMA.md "RTL rendering"); ltr packs get exactly the old markup.
  try{
    const wid = WORDS.find(w => w.pron).id;
    const ltr = bootAppSync([{ lang:"zh-CN", name:"x" }]).api;
    const rtl = bootAppSync([{ lang:"zh-CN", name:"x" }], { pack: Object.assign({}, PACK, { rtl: true }) }).api;
    const rg = rtl.glossHTML(wid), lg = ltr.glossHTML(wid);
    check("rtl pack: #gloss container is dir=ltr", /^<div class="gloss" id="gloss" dir="ltr" hidden><\/div>$/.test(rtl.glossBox()));
    check("rtl pack: gloss word is rtl, English gloss and pron spans are dir=ltr",
      /<span class="gw" data-tl lang="[^"]+" dir="rtl">/.test(rg) && /<span class="ge" dir="ltr">/.test(rg) && /<span class="gp" dir="ltr">/.test(rg));
    check("ltr pack: #gloss container and gloss spans carry no dir (unchanged)",
      ltr.glossBox() === '<div class="gloss" id="gloss" hidden></div>' && !/dir=/.test(lg) && /<span class="ge">/.test(lg));
    check("app.html: .gloss aligns text-align:start", /\.gloss\{[^}]*text-align:start/.test(appHtml));
    check("app.html: both passage screens use glossBox() (no hard-coded #gloss markup left)",
      (appHtml.match(/\$\{glossBox\(\)\}/g) || []).length === 3 && !/<div class="gloss" id="gloss" hidden>/.test(appHtml));
    await tick(); await tick();
  }catch(e){ check(`rtl gloss scenario does not throw (got: ${e.message})`, false); }

  // RTL rendering rules on the Read screens (docs/PACK_SCHEMA.md "RTL rendering"): with
  // pack.rtl no Latin text node sits with dir=rtl as its nearest dir ancestor (the
  // Read-list meta "79 words" rendered "words 79" inside the dir=rtl title button); UI
  // lines inside such a block carry dir=ltr + data-ui. LTR packs: no data-ui at all.
  try{
    const { rtlAudit } = require("./fixtures/rtl_audit.js");
    // A copy of the first passage whose question translation embeds an RTL phrase.
    const P0 = JSON.parse(JSON.stringify(PASSAGES[0])); P0.questions.forEach(q => { q.en = "Where did he go? (از ... متنفرم)"; }); // every question: the pass asks them in its own order (passageForPass)
    const RPS = [P0, ...PASSAGES.slice(1)];
    const rtlB = await bootApp([{ lang:"zh-CN", name:"x" }], { passages: RPS, pack: Object.assign({}, PACK, { rtl: true }) });
    const ltrB = await bootApp([{ lang:"zh-CN", name:"x" }], { passages: PASSAGES });
    const panelOf = b => b.document.getElementById("panel").innerHTML;
    const screens = b => { const out = {}; const pr = b.api.getProg(); pr.read = Object.assign({ done: {} }, pr.read, { unlocked: Object.fromEntries(PACK.levels.map(l => [l.id, 1])) }); pr.read.done = { [PASSAGES[0].id]: { sc: 3, n: 4, date: "2026-09-26" } }; b.api.readRender(); out.readList = panelOf(b); b.api.startPassage(RPS[0]); out.passage = panelOf(b); b.api.readQuestion(0); { const qtr = b.document.getElementById("qtr"); if(qtr) qtr.click(); } out.question = panelOf(b) + b.api.optsMarkup() + (b.document.getElementById("qtrwrap") ? b.document.getElementById("qtrwrap").innerHTML : ""); b.api.getRD().tapped = WORDS.filter(w => JSON.stringify(RPS[0]).includes(`"${w.id}"`)).slice(0, 2).map(w => w.id); b.api.readResults(); out.results = panelOf(b); return out; };
    const rs = screens(rtlB), ls = screens(ltrB);
    // (The v1 Read-list meta line went with the app v2 collapse: v2 rows carry the title and the score only.)
    check("rtl pack: Read-list title buttons are dir=rtl", /<button data-pid="[^"]+" dir="rtl"><span>/.test(rs.readList));
    Object.keys(rs).forEach(k => { const bad = rtlAudit(rs[k]); check(`rtl pack: ${k} has no UI text (Latin or digits) whose nearest dir is rtl, no RTL text outside data-tl (${bad.length})`, bad.length === 0, bad.slice(0, 3).join(" | ")); });
    check("rtl pack: results weak-word rows render (RTL flex rows, why label dir=ltr data-ui)", /<label class="wk" dir="rtl">/.test(rs.results) && /<span class="q" dir="ltr" data-ui style="margin:0;font-size:13px">/.test(rs.results));
    check("rtl pack: Read-list score (3 of 4) is dir=ltr data-ui inside the dir=rtl button", /<span class="rsc" dir="ltr" data-ui>3 of 4<\/span>/.test(rs.readList));
    check("rtl pack: read question translation isolates its RTL phrase as one run", /\(<bdi data-tl lang="zh" dir="rtl" class="tlf">از \.\.\. متنفرم<\/bdi>\)/.test(rs.question));
    check("ltr pack: Read screens carry no data-ui / tlf markup (unchanged)", Object.values(ls).every(h => !/data-ui|class="tlf"/.test(h)));
    await tick(); await tick();
  }catch(e){ check(`rtl read screens scenario does not throw (got: ${e.message})`, false); }

  // Today Read stage (README "Today"): the plan's Read row, the stage's run (same passage
  // screens as the Read tab, "Skip today" in place of the list link), scoring, weak words
  // into prog.w, prog.read.done, skip semantics, RTL plan line, no-passages byte identity.
  try{
    const { rtlAudit } = require("./fixtures/rtl_audit.js");
    const unlockAll = pr => { pr.read = { unlocked: Object.fromEntries(PACK.levels.map(l => [l.id, 1])) }; };
    // Today plan rows (app v2): <div class="tst"><span>Step</span><div class="tsd">detail</div></div>; the passage row is the last, named by its title.
    const stepRow = (h, name) => { const m = [...h.matchAll(/<div class="tst"><span>([^<]*)<\/span><div class="tsd">([\s\S]*?)<\/div><\/div>/g)].filter(x => x[1] === name && x[2]); return m.length ? m[m.length - 1][2] : undefined; };
    const readRow = h => stepRow(h, "Read");
    const b = await bootApp([{ lang:"zh-CN", name:"x" }], { passages: PASSAGES });
    const pr = b.api.getProg();
    b.api.today();
    const lockedToday = b.api.getHtml("panel");
    check("Today, no passage unlocked: no Read row, 5 plan rows, no old hint box", !readRow(lockedToday) && (lockedToday.match(/class="tst"/g) || []).length === 5 && !/readHintBox|hintRead/.test(lockedToday));
    unlockAll(pr); b.api.today();
    const p0 = VC.suggestPassage(PASSAGES, WORDS, PACK, pr), row = readRow(b.api.getHtml("panel"));
    check(`Today, passage available: plan row "Read" = the passage title (${row && row.replace(/<[^>]+>/g, "")})`,
      !!row && row.replace(/<[^>]+>/g, "") === VC.escapeHtml(p0.title));
    // Run the stage (step 5, as Start today reaches it after Sentences).
    b.api.enterTodayStep(5);
    const stageH = b.api.getHtml("panel");
    check("stage opens the suggested passage with Skip today (no passage-list link)", b.api.getRD() && b.api.getRD().p.id === p0.id && b.api.getRD().today === true && /<button id="rskip">Skip today<\/button>/.test(stageH) && !/id="rback"/.test(stageH));
    b.api.startPassage(p0); const tabH = b.api.getHtml("panel");
    check("stage passage screen is the Read tab's screen apart from that one button", stageH.replace('<div class="row"><button id="rskip">Skip today</button></div>', "") === tabH.replace('<button class="ghost rback" id="rback">Passages</button>', "") && !b.api.getRD().today);
    // Answer: question 0 wrong, the rest right.
    b.api.enterTodayStep(5);
    const doc = b.document, qs = b.api.getRD().p.questions, s0 = pr.sessions || 0; // the pass's question order (passageForPass)
    const wrongIds = qs[0].words || [], before = Object.fromEntries(wrongIds.map(id => [id, (pr.w[id] && pr.w[id].w) || 0]));
    doc.getElementById("rdone").click();
    qs.forEach((q, i) => {
      const opts = doc.getElementById("o").children;
      const btn = i === 0 ? opts.find(x => x.dataset.v !== String(q.answer)) : opts.find(x => x.dataset.v === String(q.answer));
      btn.click(); doc.getElementById("nx").click();
    });
    const res = b.api.getHtml("panel");
    check(`results count the passage's questions (${qs.length - 1} / ${qs.length}), Continue instead of Add to review / Back to passages`,
      res.includes(`<h2>${qs.length - 1} of ${qs.length}</h2>`) && /id="rcont"/.test(res) && !/id="addrev"|id="rlist"/.test(res) && (!wrongIds.length || /Ticked ones go to your next review/.test(res)));
    const rec = pr.read.done[p0.id];
    check("passage recorded in prog.read.done as a Read-tab completion ({sc, n, d, x:1})", rec && rec.sc === qs.length - 1 && rec.n === qs.length && rec.x === 1 && /^\d{4}-\d{2}-\d{2}$/.test(rec.d));
    doc.getElementById("rcont").click();
    check(`Continue: the missed question's words gain READ_WEIGHT.wrong misses in prog.w (${wrongIds.join(",")})`, wrongIds.length > 0 && wrongIds.every(id => pr.w[id].w === before[id] + VC.READ_WEIGHT.wrong && pr.w[id].s === 0));
    check("Continue ends the session as usual (Session done, sessions + 1)", /Session \d+ done/.test(b.api.getHtml("panel")) && pr.sessions === s0 + 1 && b.api.getRD() === null);
    b.api.today();
    // Read rotation (default since the flag collapse): a reading pass is followed by a listening pass of it.
    const listenRow = h => stepRow(h, "Listen");
    const p1 = p0, lr1 = listenRow(b.api.getHtml("panel"));
    check("next Today plan: the passage just read comes back as a listening pass (read rotation)", !!lr1 && lr1.includes(VC.escapeHtml(p1.title)));
    // Skip: nothing recorded, session counts as usual, same passage next time.
    const doneBefore = JSON.stringify(pr.read.done), s1 = pr.sessions;
    b.api.enterTodayStep(5); doc.getElementById("rskip").click();
    check("Skip today: session finishes (sessions + 1 as without the stage), passage not marked done", /Session \d+ done/.test(b.api.getHtml("panel")) && pr.sessions === s1 + 1 && JSON.stringify(pr.read.done) === doneBefore && b.api.getRD() === null);
    b.api.today();
    check("Skip today: the same passage is offered next session", (listenRow(b.api.getHtml("panel")) || "").includes(VC.escapeHtml(p1.title)));
    // Start today carries the plan's pick: the stage runs the passage the plan named.
    b.api.enterTodayStep(5, { p: PASSAGES[3], reason: "new" });
    check("stage runs the passage picked at Start today (todayStepState.read)", b.api.getRD().p.id === PASSAGES[3].id);
    b.api.enterTodayStep(5, null);
    check("Start today with no passage: step 5 goes straight to Session done", /Session \d+ done/.test(b.api.getHtml("panel")) && !/id="rskip"/.test(b.api.getHtml("panel")));
    // (The legacy 7-day spaced re-read checks went with the readRotation flag: the rotation's picks are covered above and in tests/listen_mode_checks.js.)
    await tick(); await tick();
    // RTL: the plan line passes the shared RTL audit; UI parts isolated, title in pack font.
    const RP0 = JSON.parse(JSON.stringify(PASSAGES[0])); RP0.title = "خانه (آزمون)";
    const rb = await bootApp([{ lang:"zh-CN", name:"x" }], { passages: [RP0, ...PASSAGES.slice(1)], pack: Object.assign({}, PACK, { rtl: true }) });
    unlockAll(rb.api.getProg()); rb.api.today();
    const rtlToday = rb.api.getHtml("panel"), rrw = readRow(rtlToday), bad = rtlAudit(rtlToday);
    check(`rtl pack: Today plan with the Read row passes the RTL audit (${bad.length})`, !!rrw && bad.length === 0, bad.slice(0, 3).join(" | "));
    check("rtl pack: Read row title is an isolated RTL run (tlf)", /<bdi data-tl lang="zh" dir="rtl" class="tlf">خانه \(آزمون/.test(rrw));
    check("ltr pack: Read row carries no data-ui / tlf markup", !/data-ui|class="tlf"/.test(row));
    await tick(); await tick();
    // (The no-passages byte-identity control against main 93f77a2 ran with dayAware off; dayAware is default since the flag collapse.)
  }catch(e){ check(`today read stage scenario does not throw (got: ${e.stack})`, false); }

  // Span display glosses (spans[i][3]) reach the tap-to-gloss popover, the screen-reader
  // announcement and the results weak-word list; a span without one, and a pack without
  // any, fall back to the word's gloss. Taps are simulated on the real rendered markup:
  // the tap span's attributes (entity-decoded, as a browser's dataset would be) become the
  // click target dispatched to #pbox's listener, exactly the path a real tap takes.
  try{
    const { api, document } = await bootApp([{ lang:"zh-CN", name:"x" }], { passages: PASSAGES });
    const unesc = v => String(v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const text = h => unesc(String(h).replace(/<[^>]*>/g, ""));
    // Renders passage pid, taps the span of wordId in sentence si; returns popover + live text.
    const tapIn = (pid, si, wordId) => {
      api.startPassage(PASSAGES.find(p => p.id === pid));
      const panel = document.getElementById("panel").innerHTML;
      const sent = (panel.match(new RegExp(`<div class="psent[^"]*" data-si="${si}">[\\s\\S]*?</div>`)) || [""])[0];
      const tag = (sent.match(new RegExp(`<span class="pw" data-pw="${wordId}"[^>]*>`)) || [""])[0];
      const attrs = {}; tag.replace(/([-a-z]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = unesc(v); });
      const cls = new Set();
      const target = { dataset: { pw: attrs["data-pw"], pg: attrs["data-pg"] }, classList: { add: c => cls.add(c), remove: c => cls.delete(c) } };
      target.closest = sel => sel === "[data-pw]" ? target : null;
      (document.getElementById("pbox")._listeners.click || []).forEach(f => f({ target }));
      return { tag, pop: document.getElementById("gloss").innerHTML.replace(HELPX, ""), live: api.getAnnounced(), on: cls.has("on") };
    };
    const t1 = tapIn("p0003", 4, "w0115");
    check("span gloss: p0003 你下午几点回家？ 点 span carries data-pg", /data-pg="o&#39;clock; a little/.test(t1.tag) || /data-pg="o'clock; a little/.test(t1.tag));
    check("span gloss: tapping 点 in p0003 shows the span gloss (o'clock ...) in the popover, not the word gloss alone",
      t1.on && /o'clock/.test(text(t1.pop)) && text(t1.pop).trim() !== "点 diǎn point; dot" && !/<span class="ge">point; dot<\/span>/.test(t1.pop));
    check("span gloss: the screen-reader announcement uses the span gloss too", /o'clock/.test(text(t1.live)) && text(t1.live) === text(t1.pop));
    const t2 = tapIn("p0023", 9, "w0563");
    check("span gloss: phrase unit 越来越 (p0023) shows 'more and more', not 越's own gloss", /more and more/.test(text(t2.pop)) && !/to exceed/.test(text(t2.pop)));
    const t3 = tapIn("p0024", 1, "w0006");
    check("span gloss: phrase unit 一下 (p0024) shows '(V+一下) briefly, a bit', not 下's own gloss", /briefly, a bit/.test(text(t3.pop)) && !/downwards/.test(text(t3.pop)));
    const t4 = tapIn("p0003", 4, "w0028");
    check("span gloss: a span without a gloss (你 in p0003) has no data-pg and falls back to the word gloss",
      !/data-pg/.test(t4.tag) && /<span class="ge">/.test(t4.pop) && text(t4.pop).includes(VC.gloss(BY_ID.w0028)));
    // Escape closes the open Read-tab gloss box and stays on the passage (same RD, no
    // re-render); a second Escape with nothing open changes nothing.
    {
      const gEl = document.getElementById("gloss"), rd0 = api.getRD(), rc0 = api.getRenderCalls(), panel0 = document.getElementById("panel").innerHTML;
      const kds = document._l.keydown || [];
      const fire = () => { const ev = { key: "Escape", target: {}, dp: false, preventDefault(){ this.dp = true; } }; kds.forEach(f => f(ev)); return ev; };
      const open0 = gEl && gEl.hidden === false;
      const e1 = fire();
      check("Read tab: Escape closes the open gloss box (consumed) and stays on the same passage view",
        kds.length === 1 && open0 && gEl.hidden === true && e1.dp && api.getRD() === rd0 && api.getRenderCalls() === rc0 && document.getElementById("panel").innerHTML === panel0);
      const e2 = fire();
      check("... a second Escape (nothing open) is not consumed and still leaves the view alone", !e2.dp && api.getRD() === rd0 && api.getRenderCalls() === rc0);
    }
    // Results weak-word list: a word tapped at a glossed span lists the sense that was seen.
    tapIn("p0003", 4, "w0115");
    const rd = api.getRD(); rd.answers = rd.p.questions.map(() => ({ ok: true, given: null })); rd.resultsDone = true;
    api.readResults();
    const weak = (document.getElementById("panel").innerHTML.match(/<div id="weak">[\s\S]*?<\/div>/) || [""])[0];
    check("span gloss: results weak-word list shows the tapped span's gloss for 点 (o'clock), not 'point; dot'",
      /点/.test(weak) && /o'clock/.test(text(weak)) && !/<span class="ge">point; dot<\/span>/.test(weak));
    // Looking back is not tracked: a stale `reopened` on an answer (older session record) changes nothing on the results.
    { const qi = rd.p.questions.findIndex(q => (q.words || []).length && !(q.words || []).includes("w0115"));
      const roIds = rd.p.questions[qi].words;
      rd.answers = rd.p.questions.map((q, i) => ({ ok: true, reopened: i === qi, given: null }));
      const tapped0 = rd.tapped; rd.tapped = [];
      api.readResults(); const h1 = document.getElementById("panel").innerHTML;
      check("results, stale reopened flag only: no weak-word list, heading or Add to review; no look-back marker anywhere (owner 2026-10-03)",
        !/id="weak"|Weak words from this passage|id="addrev"|data-wi=/.test(h1) && !/looked back/.test(h1));
      rd.tapped = tapped0; api.readResults(); const h2 = document.getElementById("panel").innerHTML;
      const wk = (h2.match(/<div id="weak">[\s\S]*?<\/div>/) || [""])[0];
      const boxes = (wk.match(/data-wi="\d+"/g) || []).length, rows = (wk.match(/<label class="wk"/g) || []).length;
      check(`results, tapped + stale reopened flag: those question words (${roIds.join(",")}) not listed, no marker`, !/looked back/.test(h2) && rows === boxes && boxes >= 1 && /id="addrev"/.test(h2)); }
    // A pack without span glosses renders exactly as the markup minus data-pg (no other change).
    let diff = 0, withPg = 0;
    PASSAGES.forEach(p => p.sentences.forEach((s, i) => {
      const bare = Object.assign({}, s, { spans: (s.spans || []).map(x => x.slice(0, 3)) });
      const a = api.passageSentenceHTML(s, i, false), b = api.passageSentenceHTML(bare, i, false);
      if(/data-pg=/.test(a)) withPg++;
      if(a.replace(/ data-pg="[^"]*"/g, "") !== b || /data-pg=/.test(b)) diff++;
    }));
    check(`span gloss: spans without a 4th element render identically apart from data-pg (${withPg} glossed sentences, ${diff} differing)`, withPg > 0 && diff === 0);
  }catch(e){ check(`span gloss scenario does not throw (got: ${e.message})`, false); }

  // Service-worker registration: guarded (no navigator.serviceWorker / file:// -> no-op),
  // registers the sibling sw.js over http(s), and shows the update toast only when a
  // controller was already in charge at load (an update), never on a first install.
  function fakeSw(controller){
    const l = {}; const calls = [];
    return { calls, fire: t => (l[t]||[]).forEach(f => f({})), controller,
      addEventListener: (t, f) => { (l[t] = l[t] || []).push(f); },
      register: u => { calls.push(u); return Promise.reject(new Error("no sw.js (dev mode)")); } };
  }
  try{
    const { document } = await bootApp([{ lang:"zh-CN", name:"x" }], { navigator: { userAgent:"x" }, location: { protocol:"https:" } });
    check("sw: no navigator.serviceWorker (old browser / Node) -> boot does not throw", document.getElementById("htitle").textContent === "Today");
    const swFile = fakeSw(null);
    const fileBoot = await bootApp([{ lang:"zh-CN", name:"x" }], { navigator: { userAgent:"x", serviceWorker: swFile }, location: { protocol:"file:" } });
    fileBoot.window.fire("load");
    check("sw: file:// -> sw.js is not registered", swFile.calls.length === 0);
    const swFirst = fakeSw(null);
    const first = await bootApp([{ lang:"zh-CN", name:"x" }], { navigator: { userAgent:"x", serviceWorker: swFirst }, location: { protocol:"https:" } });
    check("sw: not registered during parse/boot (waits for window load)", swFirst.calls.length === 0);
    first.window.fire("load");
    await tick();
    check("sw: https, after load -> registers the sibling sw.js (relative URL); a failed registration is swallowed", swFirst.calls.length === 1 && swFirst.calls[0] === "sw.js");
    swFirst.fire("controllerchange");
    check("sw: first install taking control shows no update toast", first.document.getElementById("swtoast") === null);
    const swUpd = fakeSw({});
    const upd = await bootApp([{ lang:"zh-CN", name:"x" }], { navigator: { userAgent:"x", serviceWorker: swUpd }, location: { protocol:"https:" } });
    swUpd.fire("controllerchange"); swUpd.fire("controllerchange");
    const toast = upd.document.getElementById("swtoast");
    check("sw: controller change after a controlled load shows one reload toast", !!toast && /reload for the new version/.test(toast.textContent) && upd.document.body.children.length === 1);
  }catch(e){ check(`sw registration scenarios do not throw (got: ${e.message})`, false); }

  // Today plan's Listen line (VC.listenPlanCount, above): must agree with what
  // hearItem() will actually serve. Seed 4+ learned words via the "drilled ahead" flag
  // (prog.w[id].d), which counts as learned regardless of completed sets.
  const seedLearned = (prog, n) => WORDS.slice(0, n).forEach(w => { prog.w[w.id] = { d: true }; });
  try{
    const { api } = await bootApp([{ lang:"en-US", name:"x" }]); // no zh-CN voice -> hasSpeech false
    seedLearned(api.getProg(), 6);
    api.today();
    const html = api.getHtml("panel");
    // (app v2 plan rows carry no item counts; the count the v1 Listen line showed is VC.listenPlanCount with the session's canHear.)
    check("Today plan: no voice and no pack audio (WORDS carry no .audio) -> Listen plans no item", /<span>Listen<\/span>/.test(html) && VC.listenPlanCount(WORDS.slice(0, 6), w => !!w.audio) === 0);
  }catch(e){ check(`Today plan Listen-line (no voice, no audio) scenario does not throw (got: ${e.message})`, false); }
  try{
    const clipPack = Object.assign({}, PACK, { audio: { voice: "rec", version: 1 } });
    const clipWords = WORDS.map((w, i) => i < 4 ? Object.assign({}, w, { audio: "clip.mp3" }) : w);
    const { api } = await bootApp([{ lang:"en-US", name:"x" }], { pack: clipPack, words: clipWords }); // still no zh-CN voice
    seedLearned(api.getProg(), 6);
    api.today();
    const html = api.getHtml("panel");
    check("Today plan: no voice but the pack ships recorded clips for some weak words -> Listen plans those", /<span>Listen<\/span>/.test(html) && VC.listenPlanCount(clipWords.slice(0, 6), w => !!w.audio) > 0);
  }catch(e){ check(`Today plan Listen-line (clips, no voice) scenario does not throw (got: ${e.message})`, false); }

  // Republish that reorders level 1 (learnedWords from records, TODO.md 2026-09-28): Today's
  // Learn and the Words tab follow records, not the counter prefix.
  try{
    const R = reorderedLevel(PACK, WORDS);
    const { api } = await bootApp([{ lang:"zh-CN", name:"x" }], { words: R.words });
    api.setProgT(R.prog);
    api.enterTodayStep(1);
    const taught = (api.getTaught() || []).map(w => w.id);
    check("app, reordered level: Today Learn teaches the inserted word and the swapped-in unlearned word, no learned word",
      taught.includes(R.inserted) && taught.includes(R.swappedIn) && taught.every(id => !R.learnedIds.has(id)) && taught.length === R.size);
    api.wordsTab();
    const wb = api.getHtml("wbody");
    // frequency tiers: the learned sets come first (3 here), then the unlearned words in rank order
    check("app, reordered level: Words tab opens the slice holding the first unlearned word (after the 3 learned sets), not marked done",
      /Set 4 of \d+/.test(wb));
  }catch(e){ check(`app reordered-level scenario does not throw (got: ${e.message})`, false); }

  // A leftover teach can be the level's last unlearned set (nothing fresh remains after it)
  // while its rank-position label (nn.set) still sits below the level's last bucket, when the
  // unlearned words are scattered rather than a single trailing run: the legacy "sets done"
  // summary reads the counter, so it must land on the true total, not one short (TODO.md).
  try{
    const size = VC.setSizeOf(PACK), l1 = WORDS.filter(w => w.lv === "1"), nSetsL1 = VC.nSets(l1, size);
    const scatter = [...new Set([5, Math.floor(l1.length/3), Math.floor(2*l1.length/3), l1.length-1])].filter(v => v >= 0 && v < l1.length);
    const pr = VC.normalizeProg({}, PACK);
    l1.forEach((w,i) => { if(!scatter.includes(i)) pr.w[w.id] = { r:1, w:0, s:1 }; });
    const { api } = await bootApp([{ lang:"zh-CN", name:"x" }]);
    api.setProgT(pr);
    api.enterTodayStep(1);
    api.clickId("dr");
    // finishDrill() (test-only) calls onDone directly, bypassing per-item scoring; mark the
    // taught words learned first, as real correct answers would during the drill.
    (api.getTaught() || []).forEach(w => { api.getProg().w[w.id] = { r:1, w:0, s:1 }; });
    api.finishDrill();
    check("app Learn teach exhausting a level's scattered leftover -> sets[lv] lands on the true total, not one short",
      api.getProg().sets["1"] === nSetsL1);
  }catch(e){ check(`app leftover-teach-exhausts-level scenario does not throw (got: ${e.message})`, false); }

  // chinese proof dbbf541: a leftover teach of set 1's last two words plus eight of set 2 (whose
  // first two were already recorded) closes both sets; the counter must move by two.
  try{
    const size = VC.setSizeOf(PACK), l1 = WORDS.filter(w => w.lv === "1");
    const pr = VC.normalizeProg({ sets:{ "1": 0 } }, PACK);
    [...l1.slice(0, size - 2), ...l1.slice(size, size + 2)].forEach(w => { pr.w[w.id] = { r:1, w:0, s:1 }; });
    const { api } = await bootApp([{ lang:"zh-CN", name:"x" }]);
    api.setProgT(pr);
    api.enterTodayStep(1);
    api.clickId("dr");
    (api.getTaught() || []).forEach(w => { api.getProg().w[w.id] = { r:1, w:0, s:1 }; });
    api.finishDrill();
    check("app Learn teach spanning two sets -> sets[lv] advances by two (was nn.set+1 = 1)", api.getProg().sets["1"] === 2);
  }catch(e){ check(`app two-set leftover teach scenario does not throw (got: ${e.message})`, false); }

  // Re-drilling a taught slice away from the counter must not add d: an all-d level would fall
  // back to the counter prefix.
  try{
    const size = VC.setSizeOf(PACK), l1 = WORDS.filter(w => w.lv === "1");
    const { api } = await bootApp([{ lang:"zh-CN", name:"x" }]);
    const pr = VC.normalizeProg({ sets:{ "1": 1 } }, PACK);
    l1.slice(0, 2*size).forEach(w => { pr.w[w.id] = { r:1, w:0, s:1 }; });
    api.setProgT(pr);
    const before = VC.learnedWords(WORDS, PACK, pr).map(w => w.id);
    api.wordsTab(); api.setWordsSet(0); api.clickId("dr"); api.finishDrill();
    const p1 = api.getProg();
    // The stored counter (1) lags the records (2 full sets); any drill settles it to 2.
    check("app Words tab: re-drilling a taught slice off the counter adds no d, learned set unchanged, lagging counter settles to the records",
      l1.slice(0, size).every(w => !p1.w[w.id].d) && p1.sets["1"] === 2 && util.isDeepStrictEqual(VC.learnedWords(WORDS, PACK, p1).map(w => w.id), before));
    api.setWordsSet(4); api.clickId("dr"); api.finishDrill();
    const p2 = api.getProg();
    check("app Words tab: drilling an untaught slice ahead flags exactly its words d; the counter counts learned words (frequency tiers: 30 -> 3)",
      l1.slice(4*size, 5*size).every(w => p2.w[w.id] && p2.w[w.id].d === 1) && l1.slice(0, 2*size).every(w => !p2.w[w.id].d) && p2.sets["1"] === 3);
  }catch(e){ check(`app Words-tab re-drill scenario does not throw (got: ${e.message})`, false); }
})();

// ------------------------------------------------------------ [24] service worker
// Runs the sw.js build.sh writes (and engine/sw.disable.js) against a simulated worker
// global: a Map-backed CacheStorage and a scriptable fetch. Responses are Node's real
// Response; Request is a stub (Node's rejects cache:"reload").
function swSim(src, scope){
  const store = new Map();
  const cacheFor = n => { if(!store.has(n)) store.set(n, new Map()); const m = store.get(n);
    return { match: async k => { const r = m.get(typeof k === "string" ? k : k.url); return r ? r.clone() : undefined; },
             put: async (k, r) => { m.set(typeof k === "string" ? k : k.url, r); } }; };
  const sim = { store, fetched: [], net: null, unregistered: false, cacheFails: false, L: {} };
  sim.caches = { open: async n => { if(sim.cacheFails) throw new Error("cache broken"); return cacheFor(n); },
    keys: async () => [...store.keys()], delete: async n => store.delete(n) };
  const fetch = async req => { const u = typeof req === "string" ? req : req.url; sim.fetched.push({ u, cache: req.cache });
    if(!sim.net) throw new TypeError("Failed to fetch"); return sim.net(u); };
  class Req { constructor(u, init){ this.url = u; this.cache = init && init.cache; this.method = "GET"; this.mode = "cors"; } }
  const self = { location: new URL(scope + "sw.js"), registration: { scope, unregister: async () => { sim.unregistered = true; return true; } },
    addEventListener: (t, f) => { sim.L[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  new Function("self", "caches", "fetch", "Request", "Response", "URL", src)(self, sim.caches, fetch, Req, Response, URL);
  sim.until = async t => { let w; sim.L[t]({ waitUntil: p => { w = p; } }); await w; };
  sim.go = async (u, mode, method) => { let r = null;
    sim.L.fetch({ request: { url: u, method: method || "GET", mode: mode || "no-cors" }, respondWith: p => { r = p; } });
    return r ? await r : undefined; };
  return sim;
}
async function swChecks(){
  console.log("\n[24] service worker: build.sh sw.js emission, build marker, cache naming, fetch strategy, kill switch, check_site.sh");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vocab_engine_sw_"));
  try{
    const page = path.join(dir, "index.html");
    cp.execSync(`sh build.sh packs/zh "${page}"`, { cwd: ROOT, stdio: "pipe" });
    const src = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
    const html = fs.readFileSync(page, "utf8");
    const lines = html.split("\n"); // ends "...</html>\n<!--ve-build:ID-->\n"
    const body = lines.slice(0, -2).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, "body.html"), body);
    const ck = cp.execSync(`cksum < "${path.join(dir, "body.html")}"`).toString().trim().split(/\s+/);
    const build = `${ck[0]}-${ck[1]}`;
    check("build.sh writes sw.js next to the page with every placeholder filled", !/__VE_/.test(src));
    check("sw.js build id is the POSIX cksum (crc-size) of the page before its marker; page name is the output file name",
      src.includes(`const BUILD = "${build}";`) && src.includes(`const PAGE = "index.html";`));
    check("the built page ends with its build marker line", lines[lines.length - 2] === `<!--ve-build:${build}-->` && lines[lines.length - 1] === "");
    let parses = true; try{ new Function(src); }catch(e){ parses = false; }
    check("sw.js parses", parses);
    check("sw.js has no pack/*.js route (packs are inlined into the page)", !/pack\//.test(src.replace(/^\/\/.*$/gm, "")));

    // Any change to the page changes the build id: one extra comment line in pack.js.
    const pk = path.join(dir, "pack"); fs.cpSync(ZH, pk, { recursive: true });
    fs.appendFileSync(path.join(pk, "pack.js"), "\n// changed\n");
    const d2 = path.join(dir, "b2"); fs.mkdirSync(d2);
    cp.execSync(`sh build.sh "${pk}" "${path.join(d2, "index.html")}"`, { cwd: ROOT, stdio: "pipe" });
    const b2 = (fs.readFileSync(path.join(d2, "sw.js"), "utf8").match(/const BUILD = "([^"]+)"/) || [])[1];
    check("changing index.html changes the sw.js cache id", !!b2 && b2 !== build);
    const bad = cp.spawnSync("sh", ["build.sh", "packs/zh", path.join(dir, 'a"b.html')], { cwd: ROOT, encoding: "utf8" });
    check("build.sh refuses an output name that is unsafe to embed in sw.js, before writing anything",
      bad.status !== 0 && !fs.existsSync(path.join(dir, 'a"b.html')));

    const ORIGIN = "https://bannerless-studio.github.io", SCOPE = ORIGIN + "/german/", PAGE_URL = SCOPE + "index.html";
    const MARK = `<!--ve-build:${build}-->`;
    const CACHE = `ve:/german/:${build}`;
    const pageNet = (bodyText, opts) => u => { const r = new Response(u === PAGE_URL || u === SCOPE ? bodyText : "net:" + u, { status: (opts && opts.status) || 200 });
      if(opts && opts.redirected) Object.defineProperty(r, "redirected", { value: true }); return r; };
    const good = "page " + MARK, stale = "page <!--ve-build:0-1-->";

    // Stale CDN edge: install must reject and store nothing, so it retries later.
    const s0 = swSim(src, SCOPE); s0.net = pageNet(stale);
    let rejected = false; try{ await s0.until("install"); }catch(e){ rejected = true; }
    check("install: a page without this build's marker (stale edge) rejects and caches nothing",
      rejected && (!s0.store.has(CACHE) || s0.store.get(CACHE).size === 0));
    const s0b = swSim(src, SCOPE); s0b.net = pageNet(good, { status: 404 });
    let rej404 = false; try{ await s0b.until("install"); }catch(e){ rej404 = true; }
    check("install: a non-200 page rejects and caches nothing", rej404 && (!s0b.store.has(CACHE) || s0b.store.get(CACHE).size === 0));

    const sim = swSim(src, SCOPE); sim.net = pageNet(good);
    sim.store.set("ve:/german:old", new Map()); // not this site's prefix (no trailing slash)
    sim.store.set("ve:/german/:old", new Map()); sim.store.set("ve:/french/:old", new Map()); sim.store.set("unrelated", new Map());
    await sim.until("install");
    check("install: page with this build's marker is precached into ve:<scope path>:<build id>, bypassing the HTTP cache",
      sim.store.has(CACHE) && sim.store.get(CACHE).has(PAGE_URL) && sim.fetched.some(f => f.u === PAGE_URL && f.cache === "reload"));
    await sim.until("activate");
    check("activate deletes only this site's caches with another build id (other language sites' caches kept)",
      !sim.store.has("ve:/german/:old") && sim.store.has("ve:/french/:old") && sim.store.has("ve:/german:old") && sim.store.has("unrelated") && sim.store.has(CACHE));
    sim.net = null; // offline
    const nav = await sim.go(SCOPE, "navigate");
    const navIdx = await sim.go(SCOPE + "index.html?x=1", "navigate");
    check("offline: navigating to the site root and to index.html (with a query) serves the cached page",
      !!nav && (await nav.text()) === good && !!navIdx && (await navIdx.text()) === good);
    const other = await sim.go(SCOPE + "missing/page", "navigate");
    check("offline: any other in-scope navigation falls back to the cached page", !!other && (await other.text()) === good);
    check("cross-origin (Google Fonts, tatoeba.org audio) is never intercepted",
      (await sim.go("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans")) === undefined &&
      (await sim.go("https://fonts.gstatic.com/s/x.woff2")) === undefined &&
      (await sim.go("https://audio.tatoeba.org/sentences/eng/1.mp3")) === undefined);
    check("same origin outside this site's scope, and non-GET, are not intercepted",
      (await sim.go(ORIGIN + "/french/index.html", "navigate")) === undefined && (await sim.go(PAGE_URL, "navigate", "POST")) === undefined);
    check("pack/*.js and other same-origin non-navigation requests pass through untouched",
      (await sim.go(SCOPE + "pack/words.js")) === undefined && (await sim.go(SCOPE + "LICENSE")) === undefined);
    sim.net = pageNet(good); sim.fetched.length = 0;
    await sim.go(SCOPE, "navigate");
    check("online: the page is still served from cache (no network hit)", sim.fetched.length === 0);

    // Cache-miss path (cache evicted): network response served; stored only if it is this build.
    const miss = async (net) => { const m = swSim(src, SCOPE); m.net = net;
      const r = await m.go(SCOPE, "navigate"); return { text: r ? await r.text() : null, stored: m.store.has(CACHE) && m.store.get(CACHE).has(PAGE_URL) }; };
    const mGood = await miss(pageNet(good)), mStale = await miss(pageNet(stale)), mRedir = await miss(pageNet(good, { redirected: true }));
    check("cache miss: this build's page is served and stored", mGood.text === good && mGood.stored);
    check("cache miss: a stale-edge page is served but never stored", mStale.text === stale && !mStale.stored);
    check("cache miss: a redirected response is served but never stored", mRedir.text === good && !mRedir.stored);
    const broken = swSim(src, SCOPE); broken.net = pageNet(good); broken.cacheFails = true;
    const br = await broken.go(SCOPE, "navigate");
    check("a failing Cache API (caches.open rejects) falls back to the network for the page", !!br && (await br.text()) === good);

    // Kill switch: engine/sw.disable.js deletes only this site's caches and unregisters.
    const dsrc = fs.readFileSync(path.join(ROOT, "engine", "sw.disable.js"), "utf8");
    const ks = swSim(dsrc, SCOPE);
    ["ve:/german/:" + build, "ve:/german/:old", "ve:/french/:x", "unrelated"].forEach(k => ks.store.set(k, new Map()));
    ks.L.install({});
    await ks.until("activate");
    check("sw.disable.js: deletes every ve:<this scope>: cache, keeps other sites' caches, unregisters, has no fetch handler",
      !ks.store.has("ve:/german/:" + build) && !ks.store.has("ve:/german/:old") && ks.store.has("ve:/french/:x") && ks.store.has("unrelated") &&
      ks.unregistered && !ks.L.fetch);

    // tools/check_site.sh against a throwaway language repo.
    const repo = path.join(dir, "repo"); fs.mkdirSync(repo);
    fs.cpSync(ZH, path.join(repo, "pack"), { recursive: true });
    const gitc = (args) => cp.execSync(`git -c user.email=t@t -c user.name=t ${args}`, { cwd: repo, stdio: "pipe" });
    const site = () => cp.spawnSync("sh", [path.join(ROOT, "tools", "check_site.sh"), "pack"], { cwd: repo, encoding: "utf8" });
    cp.execSync(`sh "${path.join(ROOT, "build.sh")}" pack index.html`, { cwd: repo, stdio: "pipe" });
    gitc("init -q"); gitc("add pack index.html");
    gitc("commit -q -m a");
    const untracked = site();
    gitc("add sw.js"); gitc("commit -q -m b");
    const okRun = site();
    check("check_site.sh: fails when sw.js is not tracked, passes once page + sw.js are fresh and committed",
      untracked.status !== 0 && /sw\.js is not tracked/.test(untracked.stderr) && okRun.status === 0 && /^OK /.test(okRun.stdout));
    fs.writeFileSync(path.join(repo, "sw.js"), fs.readFileSync(path.join(repo, "sw.js"), "utf8").replace(/const BUILD = "[^"]+"/, 'const BUILD = "0-0"'));
    gitc("commit -q -am c");
    const staleSw = site();
    check("check_site.sh: fails on a committed but stale sw.js", staleSw.status !== 0 && /sw\.js is stale/.test(staleSw.stderr));
    gitc("checkout -q HEAD~1 -- sw.js");
    const dirty = site();
    check("check_site.sh: fails on uncommitted page/sw.js changes even when they match a fresh build",
      dirty.status !== 0 && /uncommitted/.test(dirty.stderr) && !/stale/.test(dirty.stderr));
    check("check_site.sh builds in a private temp dir (no sw.js left next to the repo or in TMPDIR root)",
      fs.readdirSync(repo).sort().join(",") === ".git,index.html,pack,sw.js");
  }catch(e){ check(`service worker checks do not throw (got: ${e.stack})`, false); }
  finally{ fs.rmSync(dir, { recursive: true, force: true }); }
}

(function(){
  console.log("\n[25] Devanagari + Urdu search fold, roman nasal tilde, script head dedupe");
  const HW = [
    { id:"zaroor", w:"ज़रूर", en:"surely" },
    { id:"ladka", w:"लड़का", en:"boy" },
    { id:"hain", w:"हैं", en:"are" },
    { id:"dhire", w:"धीरे-धीरे", en:"slowly (redup.)" },
  ];
  const hids = q => VC.searchWords(HW, q).map(v => v.id);
  check("hi search: nukta folds both ways (जरूर finds ज़रूर, लडका finds लड़का)",
    hids("जरूर").includes("zaroor") && hids("लडका").includes("ladka"));
  check("hi search: chandrabindu folds to anusvara (हैँ finds हैं)", hids("हैँ").includes("hain"));
  check("hi search: hyphen/space-insensitive reduplication (धीरे धीरे finds धीरे-धीरे, and धीरे alone still finds it)",
    hids("धीरे धीरे").includes("dhire") && hids("धीरे").includes("dhire"));
  // Class: reduplicated/doubled-token query <-> index fold, both directions, every script
  // (hindi/TODO.md live check). foldReduplication collapses consecutive identical
  // whitespace tokens on both the query side and the stored-field side of searchFold, so a
  // reduplicated spelling, its hyphenated form and the bare word are all one search phrase.
  check("reduplication fold is symmetric: a doubled query finds a bare-stored entry, and a bare query still finds a doubled/hyphenated entry",
    VC.searchFold("धीरे धीरे") === VC.searchFold("धीरे") && VC.searchFold("धीरे-धीरे") === VC.searchFold("धीरे") &&
    VC.searchWords([{ id:"bare", w:"धीरे", en:"slowly" }], "धीरे धीरे").map(v=>v.id).includes("bare"));
  const HW2 = [
    { id:"kabhi_bare", w:"कभी", en:"sometimes" },
    { id:"kabhi_dup", w:"कभी कभी", en:"sometimes (redup.)" },
  ];
  const hids2 = q => VC.searchWords(HW2, q).map(v => v.id);
  check("hi reduplication: a doubled query (kabhī kabhī / कभी-कभी) finds the bare-stored entry too",
    hids2("कभी कभी").includes("kabhi_bare") && hids2("कभी-कभी").includes("kabhi_bare"));
  check("Latin roman reduplication (pron field): dhire dhire <-> dhire fold to the same phrase",
    VC.searchFold("dhire dhire") === VC.searchFold("dhire") &&
    VC.searchWords([{ id:"r", w:"धीरे", pron:"dhīre", en:"slowly" }], "dhire dhire").map(v=>v.id).includes("r") &&
    VC.searchWords([{ id:"r2", w:"धीरे धीरे", pron:"dhīre dhīre", en:"slowly (redup.)" }], "dhire").map(v=>v.id).includes("r2"));
  check("Cyrillic reduplication: repeated identical token folds to one (е́ле-е́ле-style doubling), distinct adjacent words are untouched",
    VC.searchFold("едва едва") === VC.searchFold("едва") && VC.searchFold("темно и тихо") === "темно и тихо");
  check("Arabic-script reduplication: کبھی کبھی folds like Devanagari, distinct words stay distinct",
    VC.searchFold("کبھی کبھی") === VC.searchFold("کبھی") && VC.searchFold("کتاب اچھا") === "کتاب اچھا");
  check("no-space scripts (zh/ja) are untouched by reduplication fold: no whitespace to split on, doubled hanzi (高高) is one atomic string either way",
    VC.searchFold("高高") === "高高" && VC.searchFold("私私") === "私私");
  const KW = [{ id:"annyeong", w:"안녕", en:"hi" }, { id:"annyeong_dup", w:"안녕 안녕", en:"hi (redup.)" }];
  const kids = q => VC.searchWords(KW, q).map(v => v.id);
  check("hangul reduplication (space-separated syllable blocks, like the roman/Devanagari case): 안녕 안녕 folds to 안녕, matching either stored form",
    VC.searchFold("안녕 안녕") === VC.searchFold("안녕") && kids("안녕 안녕").includes("annyeong") && kids("안녕").includes("annyeong_dup"));
  check("typed answers: strict keeps nukta distinct; lenient folds it (LENIENT_LETTERS, same as search)",
    VC.normalizeTyped("जरूर", {}) !== VC.normalizeTyped("ज़रूर", {}) && VC.normalizeTyped("जरूर", { foldAccents: true }) === VC.normalizeTyped("ज़रूर", { foldAccents: true }));

  const UW = [
    { id:"madrasa", w:"مدرسہ", en:"school" },
    { id:"bade", w:"بڑے", en:"big (m.)" },
    { id:"badi", w:"بڑی", en:"big (f.)" },
    { id:"phool", w:"پھول", en:"flower (aspirated do-chashmi)" },
    { id:"pahool", w:"پہول", en:"synthetic control (plain heh, not aspirated)" },
  ];
  const uids = q => VC.searchWords(UW, q).map(v => v.id);
  check("ur search: teh marbuta goal folds to heh goal (مدرسۃ finds مدرسہ)", uids("مدرسۃ").includes("madrasa"));
  check("ur search: roman nasal tilde (kahan-style typing finds kahā̃)",
    VC.searchWords([{ id:"kahan", w:"کہاں", pron:"kahā̃", en:"where" }], "kahan").map(v => v.id).includes("kahan"));
  check("ur search: bari ye/ye fold together at word end (known tradeoff: بڑے and بڑی search as one word, documented in core.js)",
    VC.searchFold("بڑے") === VC.searchFold("بڑی") && uids("بڑے").includes("badi") && uids("بڑی").includes("bade"));
  check("ur search: the ے→ی fold only applies at a word boundary, so it does not wrongly fold a non-final occurrence",
    VC.searchFold("بڑےگا") === "بڑےگا");
  check("ur search: do-chashmi ھ stays distinct from ہ (پھول does not fold to پہول)",
    VC.searchFold("پھول") !== VC.searchFold("پہول") && !uids("پہول").includes("phool"));

  // Script primer head dedupe (class 4): a unit whose name repeats its roman shows no
  // head name, in both the teach card and the reveal, via the shared helper.
  check("scriptUnitHeadName: suppressed when name==roman (ka | ka, kṣa | kṣa), kept when they differ",
    VC.scriptUnitHeadName({ name:"ka", roman:"ka" }) === "" && VC.scriptUnitHeadName({ name:"kṣa", roman:"kṣa" }) === "" &&
    VC.scriptUnitHeadName({ name:"alef", roman:"a" }) === "alef");
  check("scriptItem reveal.name is deduped the same way as reveal.note",
    (() => {
      const unit = { id:"u1", t:"क", roman:"ka", name:"ka", say:null, kind:"symSound" };
      const ctx = { units:[unit, { id:"u2", t:"ख", roman:"kha", name:"kha", kind:"symSound" }, { id:"u3", t:"ग", roman:"ga", name:"ga", kind:"symSound" }, { id:"u4", t:"घ", roman:"gha", name:"gha", kind:"symSound" }], words:[], tts:false };
      const it = VC.scriptItem("symSound", unit, ctx);
      return it.reveal.name === "";
    })());
})();

// [26] Lenient typing letter folds (LENIENT_LETTERS) + collision guard.
(() => {
  console.log("\n[26] lenient typing letter folds (hamza, ة, ى, ھ, nukta, chandrabindu) + collision guard (all lenient folds)");
  const LEN = { typing:{ accents:"lenient" } }, STR = { typing:{ accents:"strict" } };
  const ok = (typed, w, P) => VC.acceptTyped(typed, { id:"t", w }, P || LEN);
  // Each fold accepts both ways in lenient mode, and strict rejects the same input.
  const FOLDS = [["أمس","امس"],["إسلام","اسلام"],["آخر","اخر"],["سؤال","سوال"],["مسئول","مسیول"],["شيء","شی"],["مدرسة","مدرسه"],["مستشفى","مستشفی"],
    ["بھائی","بہائی"],["خانۀ","خانه"],["خانهٔ","خانه"],["ٱبن","ابن"],["ज़रूर","जरूर"],["फ़िल्म","फिल्म"],["माँ","मां"],["हँसना","हंसना"]];
  FOLDS.forEach(([a, b]) => check(`lenient fold ${a} = ${b} both ways; strict rejects both ways`,
    ok(b, a) && ok(a, b) && !ok(b, a, STR) && !ok(a, b, STR)));
  check("precomposed nukta letter ज़ (U+095B) = ज + ़ = ज in lenient mode",
    ok("\u091c", "\u095b") && ok("\u095b", "\u091c\u093c") && !ok("\u091c", "\u095b", STR));
  check("a leading ال is not folded: كتاب ≠ الكتاب in lenient typing",
    !ok("كتاب", "الكتاب") && !ok("الكتاب", "كتاب"));
  check("strict mode: normalizeTyped without foldAccents applies no letter fold",
    VC.normalizeTyped("أمس ماء بھائی माँ ज़", {}) === "أمس ماء بھائی माँ ज़");
  check("Words search unchanged by the letter layer: ھ and ء kept, ال optional",
    VC.searchFold("بھائی") !== VC.searchFold("بہائی") && VC.searchFold("ماء") !== VC.searchFold("ما") &&
    VC.searchWords([{ id:"k", w:"الكتاب", en:"the book" }], "كتاب").length === 1);
  check("non-Arabic/Devanagari text: foldLenientLetters is the identity (Latin, Cyrillic, Hebrew, CJK, kana)",
    ["perché", "ёж", "שָׁלוֹם", "你好", "が", "안녕"].every(x => VC.foldLenientLetters(x) === x));
  // Collision guard: real colliding pairs from every lenient typing pack (words.json at
  // the time of writing): [pack, idX, wX, typedX, idY, wY, typedY]. typedY is another word's exact
  // spelling, so it is rejected for X (and vice versa) though it folds to the same key.
  const PAIRS = [["italian", "w0001", "il", "la", "w0559", "là", "là"], ["italian", "w2021", "la", "la", "w0559", "là", "là"], ["italian", "w0011", "si", "si", "w2029", "sì", "sì"], ["italian", "w2005", "e", "e", "w2138", "è", "è"], ["italian", "w0022", "se", "se", "w1237", "sé", "sé"], ["italian", "w0050", "ne", "ne", "w0621", "né", "né"], ["italian", "w0056", "te", "te", "w2050", "il tè", "tè"], ["italian", "w2028", "li", "li", "w0291", "lì", "lì"], ["spanish", "w0001", "el", "el", "w0024", "él", "él"], ["spanish", "w0009", "que", "que", "w0023", "qué", "qué"], ["spanish", "w0027", "te", "te", "w0444", "el té", "té"], ["spanish", "w0028", "mi", "mi", "w0144", "mí", "mí"], ["spanish", "w0029", "si", "si", "w0078", "sí", "sí"], ["spanish", "w0029", "si", "si", "w0133", "sí", "sí"], ["spanish", "w0033", "como", "como", "w0048", "cómo", "cómo"], ["spanish", "w0040", "tu", "tu", "w0088", "tú", "tú"], ["spanish", "w0053", "cuando", "cuando", "w0171", "cuándo", "cuándo"], ["spanish", "w0063", "porque", "porque", "w1324", "el porqué", "porqué"], ["spanish", "w0077", "dónde", "dónde", "w0229", "donde", "donde"], ["spanish", "w0092", "quién", "quién", "w0220", "quien", "quien"], ["spanish", "w0170", "aún", "aún", "w1775", "aun", "aun"], ["spanish", "w0612", "cuánto", "cuánto", "w1276", "cuanto", "cuanto"], ["spanish", "w0709", "sonar", "sonar", "w1462", "soñar", "soñar"], ["french", "w0002", "le", "la", "w0067", "là", "là"], ["french", "w0024", "le", "la", "w0067", "là", "là"], ["french", "w0035", "sur", "sur", "w0212", "sûr", "sûr"], ["french", "w0050", "où", "où", "w0068", "ou", "ou"], ["french", "w0224", "le côté", "côté", "w1288", "la côte", "côte"], ["french", "w0477", "le marché", "marché", "w0824", "la marche", "marche"], ["french", "w0517", "l'élève", "élève", "w1082", "élevé", "élevé"], ["french", "w0639", "l'âge", "âge", "w1807", "âgé", "âgé"], ["german", "w0054", "schon", "schon", "w0109", "schön", "schön"], ["german", "w0671", "zahlen", "zahlen", "w0706", "zählen", "zählen"], ["arabic", "w0001", "أن", "أن", "w0010", "إن", "إن"], ["arabic", "w0005", "كان", "كان", "w0362", "كأن", "كأن"], ["arabic", "w0008", "إلى", "إلى", "w1707", "آلي", "آلي"], ["arabic", "w0009", "ما", "ما", "w0206", "ماء", "ماء"], ["arabic", "w0053", "رأى", "رأى", "w0381", "رأي", "رأي"], ["arabic", "w0053", "رأى", "يرى", "w1858", "أرى", "يري"], ["arabic", "w0112", "بدأ", "بدأ", "w0128", "بدا", "بدا"], ["arabic", "w0135", "إلا", "إلا", "w0170", "ألا", "ألا"], ["arabic", "w0411", "أمن", "أمن", "w0802", "آمن", "آمن"], ["arabic", "w0411", "أمن", "أمن", "w1073", "آمن", "آمن"], ["arabic", "w0420", "رجا", "رجا", "w0813", "رجاء", "رجاء"], ["arabic", "w0425", "إله", "إله", "w0856", "آلة", "آلة"], ["arabic", "w0448", "آسف", "آسف", "w0992", "أسف", "أسف"], ["arabic", "w0453", "غدا", "غدا", "w0550", "غداء", "غداء"], ["arabic", "w0466", "موسيقى", "موسيقى", "w1743", "موسيقي", "موسيقي"], ["arabic", "w0543", "بني", "بني", "w0779", "بنى", "بنى"], ["arabic", "w0589", "أذن", "أذن", "w0659", "إذن", "إذن"], ["arabic", "w0589", "أذن", "أذن", "w0828", "إذن", "إذن"], ["arabic", "w0644", "خطأ", "أخطاء", "w1985", "أخطأ", "أخطأ"], ["arabic", "w0650", "كرة", "كرة", "w0861", "كره", "كره"], ["arabic", "w0717", "أثر", "آثار", "w1100", "أثار", "أثار"], ["arabic", "w0724", "أما", "أما", "w0786", "إما", "إما"], ["arabic", "w0775", "سوى", "سوى", "w1546", "سوي", "سوي"], ["arabic", "w1454", "غني", "غني", "w1548", "غنى", "غنى"], ["arabic", "w1551", "بري", "بري", "w1823", "بريء", "بريء"], ["persian", "w0686", "جز", "جز", "w1496", "جزء", "جزء"], ["urdu", "w0067", "پھر", "پھر", "w1964", "پہر", "پہر"], ["urdu", "w2016", "کھلانا", "کھلانا", "w1743", "کہلانا", "کہلانا"]];
  const byPack = {};
  PAIRS.forEach(([p, ix, wx, fx, iy, wy, fy]) => {
    const W = byPack[p] || (byPack[p] = []);
    [[ix, wx, fx], [iy, wy, fy]].forEach(([id, w, f]) => {
      let e = W.find(v => v.id === id);
      if(!e){ e = { id, w, en:id, lv:"A1" }; W.push(e); }
      if(f !== w){ e.alt = e.alt || []; if(!e.alt.includes(f)) e.alt.push(f); }
    });
  });
  PAIRS.forEach(([p, ix, wx, fx, iy, wy, fy]) => {
    const W = byPack[p], X = W.find(v => v.id === ix), Y = W.find(v => v.id === iy);
    check(`guard ${p}: ${fy} (${iy}) rejected for ${fx} (${ix}) and vice versa; each exact form accepted; without words list the fold accepts`,
      !VC.acceptTyped(fy, X, LEN, null, W) && !VC.acceptTyped(fx, Y, LEN, null, W) &&
      VC.acceptTyped(fx, X, LEN, null, W) && VC.acceptTyped(fy, Y, LEN, null, W) && VC.acceptTyped(fy, X, LEN));
  });
  const PACKS = ["italian", "spanish", "french", "german", "russian", "korean", "arabic", "persian", "urdu", "hindi"];
  check("guard: collision pairs covered per pack (it 8, es 15, fr 8, de 2, ru 0, ko 0, ar 25, fa 1, ur 2, hi 0)",
    PACKS.map(p => PAIRS.filter(x => x[0] === p).length).join() === "8,15,8,2,0,0,25,1,2,0");
  // Hamza-less typings that are not another pack word stay accepted with the guard on.
  const AR = [{ id:"w0017", w:"أنا", en:"I" }, { id:"w0025", w:"أنت", en:"you" }, { id:"w0008", w:"إلى", en:"to" }, { id:"w0009", w:"ما", en:"what" }];
  check("guard: non-colliding hamza-less انا/انت/الى accepted for أنا/أنت/إلى",
    VC.acceptTyped("انا", AR[0], LEN, null, AR) && VC.acceptTyped("انت", AR[1], LEN, null, AR) && VC.acceptTyped("الى", AR[2], LEN, null, AR));
  check("guard covers plain accent folds: si/sí, el/él, tu/tú rejected for each other; exact and capitalised accepted; perche for perché still accepted",
    (() => { const ES = [{ id:"si", w:"si" }, { id:"si2", w:"sí" }, { id:"el", w:"el" }, { id:"el2", w:"él" }, { id:"tu", w:"tu" }, { id:"tu2", w:"tú" }, { id:"pq", w:"perché" }];
      return !VC.acceptTyped("si", ES[1], LEN, null, ES) && !VC.acceptTyped("sí", ES[0], LEN, null, ES) &&
        !VC.acceptTyped("el", ES[3], LEN, null, ES) && !VC.acceptTyped("él", ES[2], LEN, null, ES) &&
        !VC.acceptTyped("tu", ES[5], LEN, null, ES) && !VC.acceptTyped("tú", ES[4], LEN, null, ES) &&
        VC.acceptTyped("sí", ES[1], LEN, null, ES) && VC.acceptTyped("Sí", ES[1], LEN, null, ES) && VC.acceptTyped("el", ES[2], LEN, null, ES) &&
        VC.acceptTyped("perche", ES[6], LEN, null, ES) && VC.acceptTyped("si", ES[1], LEN); })());
  check("guard covers Cyrillic ё/stress (synthetic: the ru pack has no colliding pair): все rejected for всё and back; еж for ёж and stress-less делать still accepted",
    (() => { const RU = [{ id:"vse", w:"все" }, { id:"vsyo", w:"всё" }, { id:"ezh", w:"ёж" }, { id:"del", w:"де́лать" }, { id:"zamok1", w:"за́мок" }, { id:"zamok2", w:"замо́к" }];
      return !VC.acceptTyped("все", RU[1], LEN, null, RU) && !VC.acceptTyped("всё", RU[0], LEN, null, RU) &&
        VC.acceptTyped("еж", RU[2], LEN, null, RU) && VC.acceptTyped("делать", RU[3], LEN, null, RU) &&
        !VC.acceptTyped("замо́к", RU[4], LEN, null, RU) && VC.acceptTyped("замок", RU[4], LEN, null, RU); })());
  check("guard key ignores non-distinguishing marks: مَا / مـا rejected for ماء, مَاءٌ for ما; مَا for ما and مَاءٌ for ماء accepted",
    (() => { const W = [{ id:"ma", w:"ما" }, { id:"mae", w:"ماء" }];
      return !VC.acceptTyped("مَا", W[1], LEN, null, W) && !VC.acceptTyped("مـا", W[1], LEN, null, W) && !VC.acceptTyped("مَاءٌ", W[0], LEN, null, W) &&
        VC.acceptTyped("مَا", W[0], LEN, null, W) && VC.acceptTyped("مَاءٌ", W[1], LEN, null, W); })());
  check("guard key ignores joiners: s+ZWJ+i and s+ZWNJ+i rejected for sí; s+ZWJ+í accepted",
    (() => { const ES = [{ id:"si", w:"si" }, { id:"si2", w:"sí" }];
      return !VC.acceptTyped("s\u200di", ES[1], LEN, null, ES) && !VC.acceptTyped("s\u200ci", ES[1], LEN, null, ES) && VC.acceptTyped("s\u200dí", ES[1], LEN, null, ES); })());
  check("guard key ignores Cyrillic stress only: stress-less замок accepted for за́мок though замо́к is a pack word; Latin á kept (pointingKey)",
    (() => { const RU = [{ id:"a", w:"за́мок" }, { id:"b", w:"замо́к" }];
      return VC.acceptTyped("замок", RU[0], LEN, null, RU) && !VC.acceptTyped("замо́к", RU[0], LEN, null, RU) &&
        VC.pointingKey("за́мок") === "замок" && VC.pointingKey("está") === "está" && VC.pointingKey("مَـا") === "ما" && VC.pointingKey("أ") === "أ"; })());
  check("guard: strict mode unchanged (exact accepted, folded rejected, with and without words)",
    VC.acceptTyped("ما", AR[3], STR, null, AR) && !VC.acceptTyped("انا", AR[0], STR, null, AR) && !VC.acceptTyped("انا", AR[0], STR));
  // German-only ASCII substitutions (ä/ö/ü/ß -> ae/oe/ue/ss), gated to pack.key === "de".
  // Each target is folded BOTH ways: the digraph (ä -> ae) and the plain accent strip
  // (ä -> a, the fold every other Latin-script pack already gets) are both compared
  // against the typed text, so a learner who drops the umlaut entirely ("mude") and one
  // who substitutes the digraph ("muede") are both accepted. The typed text itself is
  // never digraph-folded, so a genuine "ae"/"oe" (Aerobic) is never mistaken for ä/ö.
  const LEVELS3 = [{ id:"A1" }, { id:"A2" }, { id:"B1" }];
  const LEN_DE = { key:"de", typing:{ accents:"lenient" }, levels:LEVELS3 };
  const STR_DE = { key:"de", typing:{ accents:"strict" }, levels:LEVELS3 };
  const LEN_DE_B1 = { key:"de", typing:{ accents:"lenient", strictFromLevel:"B1" }, levels:LEVELS3 };
  check("German ASCII fold: both mude (plain accent strip) and muede (digraph) typed for müde accepted (lenient, A1)",
    VC.acceptTyped("mude", { id:"m", w:"müde", lv:"A1" }, LEN_DE) && VC.acceptTyped("Muede", { id:"m", w:"müde", lv:"A1" }, LEN_DE));
  check("German ASCII fold: Strasse (digraph) and Straße (exact) typed for Straße accepted; strase (neither fold) is not",
    VC.acceptTyped("Strasse", { id:"s", w:"Straße", lv:"A1" }, LEN_DE) && VC.acceptTyped("Straße", { id:"s", w:"Straße", lv:"A1" }, LEN_DE) &&
    !VC.acceptTyped("strase", { id:"s", w:"Straße", lv:"A1" }, LEN_DE));
  check("German ASCII fold: strict mode never folds ae/oe/ue/ss, and not the plain accent strip either",
    !VC.acceptTyped("Muede", { id:"m", w:"müde", lv:"A1" }, STR_DE) && !VC.acceptTyped("mude", { id:"m", w:"müde", lv:"A1" }, STR_DE) &&
    VC.acceptTyped("müde", { id:"m", w:"müde", lv:"A1" }, STR_DE));
  check("German ASCII fold: muede/mude rejected for a B1 müde word once typing.strictFromLevel is B1 (lenient window closed)",
    !VC.acceptTyped("muede", { id:"m", w:"müde", lv:"B1" }, LEN_DE_B1) && !VC.acceptTyped("mude", { id:"m", w:"müde", lv:"B1" }, LEN_DE_B1) &&
    VC.acceptTyped("müde", { id:"m", w:"müde", lv:"B1" }, LEN_DE_B1) && VC.acceptTyped("muede", { id:"m2", w:"müde", lv:"A1" }, LEN_DE_B1));
  check("German ASCII fold (the digraph half) is German-only: muede rejected for müde on a non-de pack (fixture lang it); mude (plain strip) still works everywhere",
    !VC.acceptTyped("muede", { id:"m", w:"müde", lv:"A1" }, { key:"it", typing:{ accents:"lenient" }, levels:LEVELS3 }) &&
    VC.acceptTyped("mude", { id:"m", w:"müde", lv:"A1" }, { key:"it", typing:{ accents:"lenient" }, levels:LEVELS3 }));
  check("normalizeTyped without germanAscii leaves ä/ö/ü/ß to the plain accent strip (ü -> u, not ue)",
    VC.normalizeTyped("müde", { foldAccents:true }) === "mude");
  check("foldGermanAscii is the identity without German letters, and maps ä/ö/ü/ß/Ä/Ö/Ü on their own",
    VC.foldGermanAscii("perché") === "perché" && VC.foldGermanAscii("müde Straße") === "muede Strasse" &&
    VC.foldGermanAscii("Übung") === "Uebung");
  check("German ASCII fold never runs on the typed text: Aerobic (a real word with ae) is accepted exactly, and Ärobic (typed with ä) does not match it",
    VC.acceptTyped("Aerobic", { id:"a", w:"Aerobic", lv:"A1" }, LEN_DE) && !VC.acceptTyped("Ärobic", { id:"a", w:"Aerobic", lv:"A1" }, LEN_DE));
  // Collision guard: the digraph fold is additive, so every collision the plain accent
  // strip already created for German (docs/PACK_SCHEMA.md's collision table) still
  // exists and is still caught by the same generic guard.
  const DE_SCHON = { id:"w0054", w:"schon", lv:"A1" }, DE_SCHOEN = { id:"w0109", w:"schön", lv:"A1" };
  const DE_ZAHLEN = { id:"w0671", w:"zahlen", lv:"A2" }, DE_ZAEHLEN = { id:"w0706", w:"zählen", lv:"A2" };
  const DE_W1 = [DE_SCHON, DE_SCHOEN], DE_W2 = [DE_ZAHLEN, DE_ZAEHLEN];
  check("guard de: schon rejected for schön and vice versa (still collide via the plain accent strip); each exact form accepted; without words list the fold accepts",
    !VC.acceptTyped("schön", DE_SCHON, LEN_DE, null, DE_W1) && !VC.acceptTyped("schon", DE_SCHOEN, LEN_DE, null, DE_W1) &&
    VC.acceptTyped("schon", DE_SCHON, LEN_DE, null, DE_W1) && VC.acceptTyped("schön", DE_SCHOEN, LEN_DE, null, DE_W1) &&
    VC.acceptTyped("schön", DE_SCHON, LEN_DE));
  check("guard de: zahlen rejected for zählen and vice versa; each exact form accepted",
    !VC.acceptTyped("zählen", DE_ZAHLEN, LEN_DE, null, DE_W2) && !VC.acceptTyped("zahlen", DE_ZAEHLEN, LEN_DE, null, DE_W2) &&
    VC.acceptTyped("zahlen", DE_ZAHLEN, LEN_DE, null, DE_W2) && VC.acceptTyped("zählen", DE_ZAEHLEN, LEN_DE, null, DE_W2));
  check("guard de: a real 'ss' word (Masse) folds into a real ß word (Maße) via the digraph and is still guarded; the reverse spelling (typed ß for a real ss word) never matches at all",
    (() => { const MASSE = { id:"masse", w:"Masse", lv:"A1" }, MASSE2 = { id:"maße", w:"Maße", lv:"A1" }, W = [MASSE, MASSE2];
      return !VC.acceptTyped("Masse", MASSE2, LEN_DE, null, W) && VC.acceptTyped("Masse", MASSE, LEN_DE, null, W) &&
        VC.acceptTyped("Maße", MASSE2, LEN_DE, null, W) && !VC.acceptTyped("Maße", MASSE, LEN_DE); })());
})();

(function(){
  console.log("\n[27] playback reliability: ttsDriver (cancel race, paused, no-start retry, utterance kept), liveVoice, clipStartWatch");
  // Fake timers: advance(ms) runs every due timer in time order.
  function clock(){
    let now = 0, id = 0; const q = [];
    return { setTimeout(f, ms){ const t = { id: ++id, at: now + (ms || 0), f }; q.push(t); return t.id; },
      clearTimeout(i){ const k = q.findIndex(t => t.id === i); if(k >= 0) q.splice(k, 1); },
      advance(ms){ const end = now + ms; for(;;){ q.sort((a, b) => a.at - b.at || a.id - b.id); const t = q[0]; if(!t || t.at > end) break; q.shift(); now = t.at; t.f(); } now = end; },
      pending: () => q.length };
  }
  // Stub engine. speaking/pending/paused are booleans (a real browser); o.noBool drops them
  // (the old test stubs). o.start: fire onstart+onend on speak (a working engine).
  function engine(o){
    o = o || {};
    const e = { spoken: [], cancels: 0, resumes: 0, log: [], speaking: !!o.speaking, pending: !!o.pending, paused: !!o.paused,
      cancel(){ e.cancels++; e.log.push("cancel"); if(o.cancelClears !== false){ e.speaking = false; e.pending = false; } },
      resume(){ e.resumes++; e.log.push("resume"); e.paused = false; },
      speak(u){ e.spoken.push(u.text); e.log.push("speak:" + u.text); if(o.start){ if(u.onstart) u.onstart({}); if(u.onend) u.onend({}); } } };
    if(o.noBool){ delete e.speaking; delete e.pending; delete e.paused; }
    return e;
  }
  const utt = t => () => ({ text: t });
  const T = VC.TTS_TIMING;
  check("TTS_TIMING: defer 60-100 ms, watchdog above the defer", T.deferMs >= 60 && T.deferMs <= 100 && T.watchMs > T.deferMs && T.pollMs > 0);
  { // idle: happy path, no cancel, spoken synchronously
    const c = clock(), e = engine({ start: true }), d = VC.ttsDriver(e, c);
    d.say(utt("a"));
    check("idle engine: no cancel(), speak() synchronously (happy path unchanged)", e.cancels === 0 && e.spoken.join() === "a");
    c.advance(5000);
    check("idle engine, utterance started: no retry", e.spoken.join() === "a");
  }
  { // busy: cancel then deferred speak exactly once
    const c = clock(), e = engine({ speaking: true, start: true }), d = VC.ttsDriver(e, c);
    d.say(utt("b"));
    check("speaking engine: cancel() once, speak deferred (nothing spoken in the same tick)", e.cancels === 1 && e.spoken.length === 0);
    c.advance(T.deferMs - 1);
    check("speaking engine: not spoken before deferMs", e.spoken.length === 0);
    c.advance(1);
    c.advance(5000);
    check("speaking engine: spoken exactly once after deferMs", e.spoken.join() === "b" && e.log.join() === "cancel,speak:b");
  }
  { // the app's order: stop() (cancels a busy engine) then say(): still deferred
    const c = clock(), e = engine({ speaking: true, start: true }), d = VC.ttsDriver(e, c);
    d.stop(); d.say(utt("z"));
    check("stop() cancelled a busy engine, then say(): speak still deferred (not in the cancel's tick)", e.cancels === 1 && e.spoken.length === 0);
    c.advance(T.deferMs); c.advance(5000);
    check("stop() then say(): spoken exactly once after deferMs", e.spoken.join() === "z");
    d.say(utt("z2"));
    check("after that deferred speak ran: an idle say() is synchronous again", e.spoken.join() === "z,z2");
  }
  { // two quick says while busy: the newer wins
    const c = clock(), e = engine({ pending: true, cancelClears: false, start: true }), d = VC.ttsDriver(e, c);
    d.say(utt("old")); d.say(utt("new")); e.pending = false;
    c.advance(5000);
    check("a newer say() replaces a deferred one (generation guard): only the newer is spoken", e.spoken.join() === "new");
  }
  { // stop() drops a deferred say
    const c = clock(), e = engine({ speaking: true }), d = VC.ttsDriver(e, c);
    d.say(utt("x")); d.stop(); c.advance(5000);
    check("stop() drops a deferred say (nothing spoken, no timers left)", e.spoken.length === 0 && c.pending() === 0);
    const e2 = engine({}), d2 = VC.ttsDriver(e2, clock());
    check("stop() on an idle engine: no cancel()", d2.stop() === false && e2.cancels === 0);
  }
  { // cancelled flag self-expires (a stop() with no follow-up say() ever clears it): a much
    // later say() on an idle engine must not be deferred for a stale cancel.
    const c = clock(), e = engine({ speaking: true }), d = VC.ttsDriver(e, c);
    d.stop(); // busy -> cancel(); nothing ever calls say() to run go() and clear "cancelled"
    check("stop() on a busy engine: cancelled once", e.cancels === 1);
    c.advance(T.cancelTtlMs + 10);
    d.say(utt("late"));
    check("say() long after an old cancel (past cancelTtlMs, engine now idle): synchronous, not deferred for a stale flag", e.spoken.join() === "late" && e.cancels === 1);
  }
  { // the same staleness, via the generation path the finding describes: a second stop()
    // (e.g. leaving the screen right after) bumps gen before the first stop()'s deferred
    // go() would ever have run, so only the self-expiring timer -- not go() -- clears it.
    const c = clock(), e = engine({ speaking: true }), d = VC.ttsDriver(e, c);
    d.stop(); e.speaking = false; d.stop(); // second stop(): idle, so no second cancel()
    check("a second stop() on an already-idle engine: no extra cancel()", e.cancels === 1);
    c.advance(T.cancelTtlMs + 10);
    d.say(utt("late2"));
    check("say() well after both stop()s: synchronous (the stale cancelled flag expired on its own)", e.spoken.join() === "late2");
  }
  { // paused engine: resume before speak
    const c = clock(), e = engine({ paused: true, start: true }), d = VC.ttsDriver(e, c);
    d.say(utt("p"));
    check("paused engine: resume() before speak()", e.log.join() === "resume,speak:p");
    const e2 = engine({ start: true }); VC.ttsDriver(e2, clock()).say(utt("q"));
    check("not paused: no resume()", e2.resumes === 0);
  }
  { // no onstart and never speaking: exactly one retry
    const c = clock(), e = engine({}), d = VC.ttsDriver(e, c);
    d.say(utt("s"));
    c.advance(T.watchMs - T.pollMs);
    check("silent failure: no retry before watchMs", e.spoken.length === 1);
    c.advance(T.pollMs + 1);
    check("silent failure: cancel() at the watchdog, the retry deferred (not in the cancel's tick)", e.spoken.length === 1 && e.cancels === 1);
    c.advance(T.deferMs);
    check("silent failure (no onstart, !speaking && !pending after watchMs): retried once", e.spoken.join() === "s,s" && e.cancels === 1);
    c.advance(60000);
    check("silent failure: never a second retry", e.spoken.length === 2 && c.pending() === 0);
  }
  { // engine reports speaking without events (remote voice): no retry
    const c = clock(), e = engine({}), d = VC.ttsDriver(e, c);
    d.say(utt("r")); e.speaking = true; c.advance(T.pollMs); e.speaking = false; c.advance(60000);
    check("speaking seen true (no events fired): not retried", e.spoken.length === 1);
    const e2 = engine({}), c2 = clock(), d2 = VC.ttsDriver(e2, c2);
    d2.say(utt("r2")); e2.pending = true; c2.advance(60000);
    check("still pending at the watchdog: not retried", e2.spoken.length === 1);
  }
  { // utterance referenced until onend / onerror; user handlers still run
    const c = clock(), e = engine({}), d = VC.ttsDriver(e, c);
    let ended = 0, started = 0, u0 = null;
    d.say(() => { u0 = { text: "k", onstart(){ started++; }, onend(){ ended++; } }; return u0; });
    check("current utterance kept referenced while speaking", d.current() === u0);
    u0.onstart({});
    check("onstart: still referenced, the item's handler ran", d.current() === u0 && started === 1);
    u0.onend({});
    check("onend: reference released, the item's handler ran", d.current() === null && ended === 1);
    let err = 0; d.say(() => ({ text: "e", onerror(){ err++; } })); d.current().onerror({});
    check("onerror: reference released, the item's handler ran", d.current() === null && err === 1);
  }
  { // old stubs (no boolean speaking): exact old behaviour, no timers
    const c = clock(), e = engine({ noBool: true }), d = VC.ttsDriver(e, c);
    d.say(utt("o"));
    check("stub without speaking/pending booleans: spoken synchronously, no cancel, no watchdog timer", e.spoken.join() === "o" && e.cancels === 0 && c.pending() === 0);
  }
  { // liveVoice
    const zh = { lang: "zh-CN", name: "zhA", voiceURI: "u-zhA" }, zh2 = { lang: "zh-CN", name: "zhB", voiceURI: "u-zhB" }, en = { lang: "en-US", name: "en", voiceURI: "u-en" };
    check("liveVoice: chosen voice still listed -> that voice", VC.liveVoice(zh, [en, zh2, zh], "zh-CN") === zh);
    const fresh = Object.assign({}, zh);
    check("liveVoice: listed as a fresh object (same voiceURI) -> the list's object", VC.liveVoice(zh, [en, fresh], "zh-CN") === fresh);
    check("liveVoice: chosen voice vanished -> a fresh pick for the language", VC.liveVoice(zh, [en, zh2], "zh-CN") === zh2);
    check("liveVoice: vanished and no voice for the language -> null (utterance keeps only lang)", VC.liveVoice(zh, [en], "zh-CN") === null && VC.liveVoice(zh, [], "zh-CN") === null);
    check("liveVoice: nothing chosen yet (voices arrived late) -> pickVoice", VC.liveVoice(null, [en, zh2], "zh-CN") === zh2);
  }
  { // clipStartWatch
    const c = clock(); let fails = 0;
    const plain = {}; const dis0 = VC.clipStartWatch(plain, 1000, () => fails++, c);
    check("clipStartWatch: a media object without onplaying (test fakes) arms nothing", typeof dis0 === "function" && c.pending() === 0 && !("onplaying" in plain));
    let prevRan = 0; const a = { onplaying(){ prevRan++; } };
    VC.clipStartWatch(a, 1000, () => fails++, c); a.onplaying({}); c.advance(5000);
    check("clipStartWatch: 'playing' before the deadline -> no fallback, prior handler kept", fails === 0 && prevRan === 1);
    const b = { onplaying: null }; VC.clipStartWatch(b, 1000, () => fails++, c); c.advance(999);
    check("clipStartWatch: nothing before the deadline", fails === 0);
    c.advance(1); c.advance(60000);
    check("clipStartWatch: no 'playing' within ms -> onFail exactly once", fails === 1);
    const d = { onplaying: null }; const dis = VC.clipStartWatch(d, 1000, () => fails++, c); dis(); c.advance(5000);
    check("clipStartWatch: disarm() (end/error/blocked/replaced) -> no fallback", fails === 1 && c.pending() === 0);
  }
})();

(function(){
  console.log("\n[28] word `forms`: inflected surfaces locate the word in text but are never typed answers");
  const hits = parts => parts.filter(p => p.hit).map(p => p.text);
  const JP = { key:"ja_f", spaced:false, typing:{ accents:"lenient" } };
  const taberu = { id:"taberu", w:"食べる", en:"to eat", lv:"N5", pron:"たべる", alt:["たべる"], forms:["食べない","食べた","食べます"] };
  const shoku = { id:"shoku", w:"食", en:"food", lv:"N5" };
  const suru = { id:"suru", w:"する", en:"to do", lv:"N5", forms:["した","して"] };
  const shita = { id:"shita", w:"した", en:"below", lv:"N5" };
  const JWF = [taberu, shoku, suru, shita];
  const JBF = {}; JWF.forEach(w => { JBF[w.id] = w; });
  check("forms: typed 食べる and alt たべる accepted",
    VC.acceptTyped("食べる", taberu, JP, [], JWF) && VC.acceptTyped("たべる", taberu, JP, [], JWF));
  check("forms: typed 食べない / 食べた / 食べます rejected for 食べる (forms are not typed targets)",
    !VC.acceptTyped("食べない", taberu, JP, [], JWF) && !VC.acceptTyped("食べた", taberu, JP, [], JWF) && !VC.acceptTyped("食べます", taberu, JP, [], JWF));
  check("forms: cloze extra (the literal blanked surface) still accepts the inflected form",
    VC.acceptTyped("食べた", taberu, JP, ["食べた"], JWF));
  const s1 = { id:"f1", t:"昨日パンを食べた。", words:["taberu"] };
  check("forms: highlight bolds 食べた for 食べる", util.isDeepStrictEqual(hits(VC.highlightParts(s1, taberu, JBF, JP)), ["食べた"]));
  const gm = VC.gapMatch(s1, taberu, JBF, JP);
  check("forms: cloze locates 食べる at its form 食べた", !!gm && gm.text === "食べた" && gm.start === 5);
  const s2 = { id:"f2", t:"パンを食べた。", words:["shoku","taberu"] };
  const noForms = Object.assign({}, JBF, { taberu: Object.assign({}, taberu, { forms: undefined }) });
  check("forms: cloze never cuts 食 out of 食べた (a form of 食べる); without the form it would",
    VC.gapMatch(s2, shoku, JBF, JP) === null && !!VC.gapMatch(s2, shoku, noForms, JP));
  check("forms: highlight of 食 inside the form 食べた is dropped", hits(VC.highlightParts(s2, shoku, JBF, JP)).length === 0);
  const s3 = { id:"f3", t:"食べるのが好き。", words:["taberu"] }, s4 = { id:"f4", t:"何もない。", words:["taberu"] };
  check("forms: example sentences rank w, then a form, then not visible",
    util.isDeepStrictEqual(VC.exampleSentences(taberu, [s4, s1, s3], JP, 3).map(s => s.id), ["f3","f1","f4"]));
  // Words-tab/teach-card picker (TODO.md line 18): a repeat of an already-shown surface is
  // skipped in favour of a not-yet-shown inflected form, in rank order.
  const g1 = { id:"g1", t:"食べるのが好き。", words:["taberu"] };       // headword
  const g2 = { id:"g2", t:"また食べる。", words:["taberu"] };          // headword again (repeat, skipped)
  const g3 = { id:"g3", t:"昨日パンを食べた。", words:["taberu"] };    // form: 食べた
  const g4 = { id:"g4", t:"肉を食べない。", words:["taberu"] };        // form: 食べない
  check("forms: Words-tab picker covers distinct surfaces (headword, then each new form), skips a repeat",
    util.isDeepStrictEqual(VC.exampleSentences(taberu, [g1, g2, g3, g4], JP, 3).map(s => s.id), ["g1","g3","g4"]));
  // Padding must still prefer a sentence where the word is visible/locatable (even a repeat
  // of a form already shown) over one where it's only linked by id and not locatable at all
  // (regressed real packs: it l'amico, ja 早い/行う/降る, id orang/tahu/mana).
  const h1 = { id:"h1", t:"食べるのが好き。", words:["taberu"] };       // headword
  const h2 = { id:"h2", t:"何もない。", words:["taberu"] };            // id-linked, not locatable
  const h3 = { id:"h3", t:"また食べる。", words:["taberu"] };          // headword again (locatable repeat)
  check("forms: padding prefers a locatable repeat over an unlocatable id-only sentence",
    util.isDeepStrictEqual(VC.exampleSentences(taberu, [h1, h2, h3], JP, 2).map(s => s.id), ["h1","h3"]));
  const seg = VC.passageSegments({ t:s1.t, words:["taberu"] }, JBF, JP);
  check("forms: passage fallback matching taps 食べた as 食べる",
    seg.parts.some(p => p.text === "食べた" && p.id === "taberu") && seg.unplaced.length === 0);
  const found = VC.searchWords(JWF, "食べた");
  check("forms: Words search 食べた finds 食べる", found.length > 0 && found[0].id === "taberu");
  check("forms: textForms = w, alts, forms; forms never a homograph surface",
    util.isDeepStrictEqual(VC.textForms(taberu), ["食べる","たべる","食べない","食べた","食べます"]) &&
    util.isDeepStrictEqual(VC.meaningOpts(shita, [suru, shita]).map(v => v.id), ["suru"]));
  // Collision guard: only lenient-fold matches consult it. sí typed as "si": the guard
  // must not see another word's `forms` "si" (not a typed target), but must see an alt.
  const LP = { key:"es_f", typing:{ accents:"lenient" } };
  const si = { id:"si", w:"sí", en:"yes", lv:"A1" };
  const viaForm = { id:"x", w:"xx", en:"other", lv:"A1", forms:["si"] };
  const viaAlt = { id:"x", w:"xx", en:"other", lv:"A1", alt:["si"] };
  check("forms: collision guard ignores another word's forms (si for sí accepted), still honours an alt",
    VC.acceptTyped("si", si, LP, [], [si, viaForm]) && !VC.acceptTyped("si", si, LP, [], [si, viaAlt]));
  // gap MC: する blanked at its form した must never offer the word whose w is した
  const s5 = { id:"f5", t:"宿題をした。", words:["suru"] };
  const gm5 = VC.gapMatch(s5, suru, JBF, JP);
  const gcOk = (() => { for(let i = 0; i < 50; i++){ const gc = VC.gapChoices(suru, gm5, JWF, JP); if(gc.opts.includes("した") || gc.opts[0] !== "する") return false; } return true; })();
  check("forms: gap choices for する blanked at した never offer 下/した (a distractor whose w fits the blank)",
    !!gm5 && gm5.text === "した" && gcOk && VC.gapChoices(suru, gm5, JWF, JP).opts.length === 3);
  check("forms: typed した for the word した (another word's form) accepted; for する rejected",
    VC.acceptTyped("した", shita, JP, [], JWF) && !VC.acceptTyped("した", suru, JP, [], JWF));

  // validator
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vocab_pack_forms_"));
  const run = extra => {
    const words = Array.from({length:20}, (_,i)=>Object.assign({ id:`a${i}`, w:`w${i}`, en:`gloss ${i}`, lv:"A1" }, i === 0 ? extra : {}));
    fs.writeFileSync(path.join(tmp, "pack.json"), JSON.stringify({ key:"t", name:"T", tts:"ja-JP", levels:[{id:"A1",label:"A1"}], placement:[["A1",2]], typing:null, showPron:false, hasLessons:false, eta:{} }));
    fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(tmp, "sentences.json"), "[]");
    cp.spawnSync("python3", [path.join(ROOT, "tools", "jsonify_pack.py"), tmp]);
    return cp.spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), tmp], { encoding:"utf8" });
  };
  const ok = run({ alt:["x0"], forms:["w0s","w0d"] });
  check("validator: forms list of strings -> 0 errors, no forms warning", ok.status === 0 && !/\.forms/.test(ok.stdout));
  const bad = run({ forms:"w0s" }), bad2 = run({ forms:["ok", ""] });
  check("validator: forms not a list of non-empty strings -> error",
    bad.status === 1 && /word a0\.forms must be a list of non-empty strings/.test(bad.stdout) && bad2.status === 1);
  const dup = run({ alt:["x0"], forms:["x0", "w0"] });
  check("validator: a form equal to w or an alt -> warning (both), not an error",
    dup.status === 0 && /forms entry 'x0' equals/.test(dup.stdout) && /forms entry 'w0' equals/.test(dup.stdout));
  const bOk = run({ w:"se w0", bare:"w0", forms:["w0"] });
  check("validator: bare a trailing token of w -> 0 errors, no bare warning", bOk.status === 0 && !/\.bare/.test(bOk.stdout));
  const bBad = run({ bare:["w0"] }), bSame = run({ bare:"w0" }), bOff = run({ w:"se w0", bare:"zz" });
  check("validator: bare not a string -> error; equal to w -> warning; not a trailing token -> warning",
    bBad.status === 1 && /word a0\.bare must be a non-empty string/.test(bBad.stdout) && bSame.status === 0 && /word a0\.bare equals its w/.test(bSame.stdout) &&
    bOff.status === 0 && /bare 'zz' is not a trailing token/.test(bOff.stdout));
  fs.rmSync(tmp, { recursive:true, force:true });
})();

(function(){
  console.log("\n[30] sentence `spans`: builder spans locate inflected surfaces; absent -> byte-identical");
  const hits = parts => parts.filter(p => p.hit).map(p => p.text);
  const at = (t, x, from) => { const i = t.indexOf(x, from || 0); return [i, i + x.length]; };
  const SW = { key:"sw_s", spaced:true, typing:{ accents:"lenient" } };
  const tumia = { id:"sw-tumia", w:"kutumia", en:"to use", lv:"A1", pos:"verb" };
  const simu = { id:"sw-simu", w:"simu", en:"phone", lv:"A1", pos:"noun" };
  const kuwana = { id:"sw-kuwana", w:"kuwa na", en:"to have", lv:"A1", pos:"verb" };
  const SWB = {}; [tumia, simu, kuwana].forEach(w => { SWB[w.id] = w; });
  const t1 = "Yeye anatumia simu.";
  const s1 = { id:"s1", t:t1, lv:"A1", words:[tumia.id, simu.id], spans:[[...at(t1, "anatumia"), tumia.id], [...at(t1, "simu"), simu.id]] };
  const s1off = Object.assign({}, s1); delete s1off.spans;
  const l1 = VC.locateWord(s1, tumia, SW, SWB);
  check("spans: locateWord finds sw anatumia for kutumia (surface in no w/alt/forms)", !!l1 && l1.text === "anatumia" && l1.start === 5 && l1.end === 13);
  check("spans: same sentence without spans -> locateWord null (regex path unchanged)", VC.locateWord(s1off, tumia, SW, SWB) === null);
  const g1 = VC.gapMatch(s1, tumia, SWB, SW);
  check("spans: gapMatch blanks anatumia", !!g1 && g1.text === "anatumia" && g1.start === 5 && g1.end === 13);
  check("spans: gapCandidateIndices gains the verb only with spans", util.isDeepStrictEqual(VC.gapCandidateIndices(s1, SWB, SW), [0, 1]) && util.isDeepStrictEqual(VC.gapCandidateIndices(s1off, SWB, SW), [1]));
  check("spans: highlightParts bolds anatumia", util.isDeepStrictEqual(hits(VC.highlightParts(s1, tumia, SWB, SW)), ["anatumia"]));
  check("spans: highlightParts parts rejoin to t", VC.highlightParts(s1, tumia, SWB, SW).map(p => p.text).join("") === t1);
  // ru inflected noun (accusative книгу for книга)
  const RU = { key:"ru_s", spaced:true, typing:{ accents:"lenient" } };
  const kniga = { id:"ru-kniga", w:"книга", en:"book", lv:"A1", pos:"noun" };
  const RUB = { [kniga.id]: kniga };
  const t2 = "Я читаю книгу.";
  const s2 = { id:"s2", t:t2, lv:"A1", words:[kniga.id], spans:[[...at(t2, "книгу"), kniga.id]] };
  const l2 = VC.locateWord(s2, kniga, RU, RUB), g2 = VC.gapMatch(s2, kniga, RUB, RU);
  check("spans: ru книгу located for книга (locateWord + gapMatch)", !!l2 && l2.text === "книгу" && !!g2 && g2.text === "книгу" && g2.start === 8);
  check("spans: ru без spans -> null", VC.locateWord(Object.assign({}, s2, { spans: undefined }), kniga, RU, RUB) === null);
  // two spans for one id -> regex fallback
  const t3 = "Kutumia: anatumia, anatumia.";
  const s3 = { id:"s3", t:t3, lv:"A1", words:[tumia.id, tumia.id], spans:[[...at(t3, "anatumia"), tumia.id], [...at(t3, "anatumia", 12), tumia.id]] };
  const l3 = VC.locateWord(s3, tumia, SW, SWB);
  check("spans: two spans for the id -> null, no regex fallback (Kutumia is not blanked)", l3 === null && VC.gapMatch(s3, tumia, SWB, SW) === null);
  check("spans: two spans -> highlightParts bolds both spans", util.isDeepStrictEqual(hits(VC.highlightParts(s3, tumia, SWB, SW)), ["anatumia", "anatumia"]));
  const t3b = "simu na simu";
  const s3b = { id:"s3b", t:t3b, lv:"A1", words:[simu.id, simu.id], spans:[[0, 4, simu.id], [8, 12, simu.id]] };
  check("spans: two spans over a twice-visible word -> null (as without spans)", VC.locateWord(s3b, simu, SW, SWB) === null && VC.gapMatch(s3b, simu, SWB, SW) === null);
  // one span, but the word's surface is also visible outside it -> null
  const t3c = "Simu yangu, anatumia simu.";
  const s3c = { id:"s3c", t:t3c, lv:"A1", words:[simu.id, tumia.id], spans:[[...at(t3c, "anatumia"), tumia.id], [...at(t3c, "simu"), simu.id]] };
  check("spans: one span + an unspanned visible surface elsewhere -> locateWord/gapMatch null (Simu would stay visible)",
    VC.locateWord(s3c, simu, SW, SWB) === null && VC.gapMatch(s3c, simu, SWB, SW) === null && !!VC.gapMatch(s3c, tumia, SWB, SW));
  // invalid spans ignored
  const bad = (name, sp, extra) => {
    const s = Object.assign({ id:"sb", t:t1, lv:"A1", words:[tumia.id, simu.id], spans:sp }, extra || {});
    const off = Object.assign({}, s); delete off.spans;
    check(`spans: invalid span ignored (${name}) -> same as no spans`,
      util.isDeepStrictEqual(VC.locateWord(s, tumia, SW, SWB), VC.locateWord(off, tumia, SW, SWB)) &&
      util.isDeepStrictEqual(VC.highlightParts(s, tumia, SWB, SW), VC.highlightParts(off, tumia, SWB, SW)));
  };
  bad("out of bounds", [[5, 99, tumia.id]]);
  bad("start >= end", [[13, 5, tumia.id]]);
  bad("id not in words", [[5, 13, "sw-other"]], { words:[simu.id] });
  bad("whitespace only", [[4, 5, tumia.id]]);
  bad("not an array", "5,13");
  {
    const te = "Yeye 😀anatumia simu.";
    const s = { id:"se", t:te, lv:"A1", words:[tumia.id], spans:[[6, 15, tumia.id]] };
    check("spans: a span splitting a surrogate pair is ignored", VC.locateWord(s, tumia, SW, SWB) === null);
  }
  // multiword unit is one span
  const t4 = "Nilikuwa na simu.";
  const s4 = { id:"s4", t:t4, lv:"A1", words:[kuwana.id, simu.id], spans:[[0, 11, kuwana.id], [12, 16, simu.id]] };
  const l4 = VC.locateWord(s4, kuwana, SW, SWB), g4 = VC.gapMatch(s4, kuwana, SWB, SW);
  check("spans: multiword span Nilikuwa na -> one locate/gap span", !!l4 && l4.text === "Nilikuwa na" && !!g4 && g4.text === "Nilikuwa na" && g4.start === 0);
  check("spans: multiword highlight", util.isDeepStrictEqual(hits(VC.highlightParts(s4, kuwana, SWB, SW)), ["Nilikuwa na"]));
  // gapMatch articleCut over a span (fr plural les chevaux for le cheval)
  const FR = { key:"fr_s", spaced:true, typing:{ accents:"lenient" } };
  const le = { id:"fr-le", w:"le", en:"the", lv:"A1", pos:"art", alt:["la","l'","les"] };
  const cheval = { id:"fr-cheval", w:"le cheval", en:"horse", lv:"A1", pos:"noun" };
  const FRB = { [le.id]: le, [cheval.id]: cheval };
  const t5 = "J'aime les chevaux.";
  const s5 = { id:"s5", t:t5, lv:"A1", words:[cheval.id], spans:[[...at(t5, "les chevaux"), cheval.id]] };
  const g5 = VC.gapMatch(s5, cheval, FRB, FR);
  check("spans: gapMatch cuts the article off a span (les chevaux -> blank chevaux, article les)", !!g5 && g5.text === "chevaux" && g5.start === t5.indexOf("chevaux") && g5.article === "les");
  // an extension still runs after a span (pack.clitics)
  const ID = { key:"id_s", spaced:true, clitics:["nya"], typing:{ accents:"lenient" } };
  const rumah = { id:"id-rumah", w:"rumah", en:"house", lv:"A1", pos:"noun" };
  const t6 = "Itu rumah-rumahnya.";
  const s6 = { id:"s6", t:t6, lv:"A1", words:[rumah.id], spans:[[10, 15, rumah.id]] };
  const l6 = VC.locateWord(s6, rumah, ID, { [rumah.id]: rumah });
  check("spans: extendRedupClitic still runs after a span (second-half rumah span -> rumah-rumahnya)", !!l6 && l6.text === "rumah-rumahnya" && l6.start === 4);
  // exampleSentences formOf reads the span text
  const verb = { id:"sw-tumia", w:"kutumia", en:"to use", lv:"A1", forms:["alitumia"] };
  const ex = [
    { id:"e1", t:"Alitumia simu.", lv:"A1", words:[verb.id] },
    { id:"e2", t:"Alitumia kalamu.", lv:"A1", words:[verb.id] },
    { id:"e3", t:"Anatumia simu.", lv:"A1", words:[verb.id], spans:[[0, 8, verb.id]] },
  ];
  check("spans: exampleSentences counts a span-only form as a new form (e3 before the e2 repeat)",
    util.isDeepStrictEqual(VC.exampleSentences(verb, ex, SW, 2).map(s => s.id), ["e1", "e3"]));
  const libro = { id:"it-libro", w:"il libro", en:"book", lv:"A1", pos:"noun", alt:["libro","libri"], forms:["libretto"] };
  const exIt = [
    { id:"i1", t:"Leggo i libri.", lv:"A1", words:[libro.id] },
    { id:"i2", t:"Ho letto il libro.", lv:"A1", words:[libro.id], spans:[[12, 17, libro.id]] },
  ];
  check("spans: exampleSentences maps span libro to the headword il libro (headword slot first)",
    util.isDeepStrictEqual(VC.exampleSentences(libro, exIt, SW, 2).map(s => s.id), ["i2", "i1"]));
  check("spans: exampleSentences without spans keeps old order", util.isDeepStrictEqual(VC.exampleSentences(verb, ex.map(s => { const c = Object.assign({}, s); delete c.spans; return c; }), SW, 2).map(s => s.id), ["e1", "e2"]));

  // Flag-off control against a pinned sha: tests/sentence_spans_checks.js (too slow for this suite).
})();

(function(){
  console.log("\n[31] set counter follows the records after any teach (settleSetCounter)");
  const APP_SRC_W7 = fs.readFileSync(path.join(ROOT, "engine", "app.html"), "utf8");
  const size = VC.setSizeOf(PACK), l1 = WORDS.filter(w => w.lv === "1"), n1 = VC.nSets(l1, size);
  const rec = (prog, ws) => ws.forEach(w => { prog.w[w.id] = { r:1, w:0, s:1 }; });
  const teach = (prog, lv) => { const nn = VC.levelNewSet(WORDS, PACK, prog, lv); rec(prog, nn.words); return nn; };
  const span = VC.normalizeProg({ sets:{ "1": 0 } }, PACK);
  rec(span, l1.slice(0, size - 2)); rec(span, l1.slice(size, size + 2));
  const nnSpan = teach(span, "1");
  check("teach spanning two sets (2 leftovers of set 1 + 8 of set 2) -> counter advances by two (set = sets learned by count: 1)",
    nnSpan.set === 1 && VC.settleSetCounter(span, WORDS, PACK, "1") === 2 && span.sets["1"] === 2);
  const within = VC.normalizeProg({ sets:{ "1": 1 } }, PACK);
  rec(within, l1.slice(0, size));
  const nnWithin = teach(within, "1");
  check("teach within one set -> counter lands on nn.set+1 as before", VC.settleSetCounter(within, WORDS, PACK, "1") === nnWithin.set + 1 && within.sets["1"] === 2);
  const partial = VC.normalizeProg({ sets:{ "1": 1 } }, PACK);
  rec(partial, l1.slice(0, size + 5));
  check("partial set recorded -> counter unchanged", VC.settleSetCounter(partial, WORDS, PACK, "1") === 1);
  const ahead = VC.normalizeProg({ sets:{ "1": 1 } }, PACK);
  rec(ahead, l1.slice(0, size)); rec(ahead, l1.slice(2*size, 3*size));
  check("a drilled-ahead set past a gap counts by learned words (frequency tiers: 20 learned -> 2)", VC.settleSetCounter(ahead, WORDS, PACK, "1") === 2);
  const kept = VC.normalizeProg({ sets:{ "1": 5 } }, PACK);
  rec(kept, l1.slice(0, size));
  check("never lowers a stored counter within the level's set count", VC.settleSetCounter(kept, WORDS, PACK, "1") === 5);
  const over = VC.normalizeProg({ sets:{ "1": n1 + 4 } }, PACK);
  rec(over, l1.slice(0, size));
  check("a stored counter above nSets (level shrank) is clamped to nSets", VC.settleSetCounter(over, WORDS, PACK, "1") === n1);
  const exhausted = VC.normalizeProg({ sets:{ "1": 3 } }, PACK);
  rec(exhausted, l1);
  check("level exhausted -> nSets", VC.settleSetCounter(exhausted, WORDS, PACK, "1") === n1);
  const legacy = VC.normalizeProg({ sets:{ "1": n1 } }, PACK);
  check("records-less level whose counter prefix covers it -> nSets, no records written", VC.settleSetCounter(legacy, WORDS, PACK, "1") === n1 && Object.keys(legacy.w).length === 0);
  const lagged = VC.normalizeProg({ sets:{ "1": 1 } }, PACK);
  rec(lagged, l1.slice(0, 3*size));
  check("placement settles a lagged counter from the records", VC.applyPlacement(lagged, [], 0, WORDS, PACK).sets["1"] === 3 && lagged.sets["1"] === 1);
  check("app.html: no teach site writes prog.sets directly; Today Learn and the Words-tab drill settle",
    !/prog\.sets\[[^\]]+\]\s*=(?!=)/.test(APP_SRC_W7) && (APP_SRC_W7.match(/VC\.settleSetCounter\(prog, WORDS, PACK, /g) || []).length === 2);
})();

(function(){
  console.log("\n[32] no-voice planner: a word that cannot be heard is never planned as a hear item");
  const mk = seed => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const pr = VC.normalizeProg({ sets:{ "1": 6 } }, PACK);
  const lw = VC.learnedWords(WORDS, PACK, pr);
  pr.w[lw[0].id] = { r:1, w:2, s:0, k:"hear" };
  const plain = VC.buildReviewPlan(lw, pr, PACK, { rng: mk(3) });
  const voiced = VC.buildReviewPlan(lw, pr, PACK, { rng: mk(3), canHear: () => true });
  check("Review with every word playable: plan identical to one built without canHear", util.isDeepStrictEqual(plain, voiced) && plain.some(x => x.kind === "hear"));
  const mute = VC.buildReviewPlan(lw, pr, PACK, { rng: mk(3), canHear: () => false });
  check("Review with nothing playable: zero hear kinds; each hear slot became read, same words, same order",
    mute.every(x => x.kind !== "hear") && mute.length === plain.length && mute.every((x, i) => x.word.id === plain[i].word.id && x.kind === (plain[i].kind === "hear" ? "read" : plain[i].kind)));
  const some = VC.buildReviewPlan(lw, pr, PACK, { rng: mk(3), canHear: w => w.id !== plain.find(x => x.kind === "hear").word.id });
  check("Review: only the unplayable word loses its hear slot", some.filter(x => x.kind === "hear").length === plain.filter(x => x.kind === "hear").length - 1);
  check("hearableKinds leaves unit (character/script) items alone", util.isDeepStrictEqual(VC.hearableKinds([{ kind:"hear", unit:{ id:"u" } }], () => false), [{ kind:"hear", unit:{ id:"u" } }]));
  const r1 = VC.buildRecallPlan(lw, pr, PACK, 8, { canHear: () => false });
  check("Recall with nothing playable: zero hear kinds", r1.every(x => x.kind !== "hear"));
})();

(function(){
  console.log("\n[33] pack.placedRead: the new-passage pick starts from the placed level (fb51)");
  const ids = VC.levelIds(PACK), top = ids[ids.length - 1];
  // placedRead is engine default since the flag collapse (ON / OFFR are the same behaviour; kept as names).
  const OFFR = PACK, ON = Object.assign({}, PACK, { placedRead: true }), SHIPPED = loadConst(path.join(ZH, "pack.js"), "PACK");
  const st0 = VC.strata(WORDS, PACK.placement, VC.setSizeOf(PACK));
  const placedTop = VC.applyPlacement(VC.normalizeProg({}, PACK), st0, st0.length, WORDS, PACK, undefined);
  check(`placed record: pl is the top level "${placedTop.pl}"`, placedTop.pl === top);
  const sTop = VC.suggestPassage(PASSAGES, WORDS, ON, placedTop);
  check(`placed at the top: the first unread passage of the top level (${sTop && sTop.id})`, sTop === PASSAGES.find(p => p.lv === top) && sTop.lv === top);
  // reading down: finish the top level, the next pick is the level below
  const pr = JSON.parse(JSON.stringify(placedTop)); VC.readState(pr);
  const seq = []; for(let g = 0; g < 100; g++){ const p = VC.suggestPassage(PASSAGES, WORDS, ON, pr); if(!p) break; seq.push(p.lv); pr.read.done[p.id] = { sc: 3, n: 3, d: "2026-10-07", x: 1 }; }
  const want = ids.slice().reverse().flatMap(lv => PASSAGES.filter(p => p.lv === lv).map(() => lv));
  check(`placed at the top: all ${seq.length} unread passages come top level down, in pack order inside a level`, seq.length === PASSAGES.length && seq.join() === want.join());
  // placed in the middle: levels above pl keep pack order after the lower levels
  const mid = ids[1], prm = JSON.parse(JSON.stringify(placedTop)); prm.pl = mid; VC.readState(prm);
  const seqm = []; for(let g = 0; g < 100; g++){ const p = VC.suggestPassage(PASSAGES, WORDS, ON, prm); if(!p) break; seqm.push(p.lv); prm.read.done[p.id] = { sc: 3, n: 3, d: "2026-10-07", x: 1 }; }
  const orderM = [mid].concat(ids.slice(0, ids.indexOf(mid)).reverse(), ids.slice(ids.indexOf(mid) + 1));
  check(`pl = ${mid}: ${mid} first, then the levels below descending, then the levels above in pack order`, seqm.join() === orderM.flatMap(lv => PASSAGES.filter(p => p.lv === lv).map(() => lv)).join());
  // a locked level above pl is not suggested; a locked level below is not either
  const prl = VC.normalizeProg({ pl: ids[2], sets: { [ids[0]]: 99, [ids[1]]: 99 } }, PACK);
  const sl = VC.suggestPassage(PASSAGES, WORDS, ON, prl);
  check(`open levels only: with levels ${ids[0]}-${ids[1]} learned and ${ids[2]} locked, pl = ${ids[2]} picks ${sl && sl.lv}`, sl && sl.lv === ids[1]);
  // fresh record and a record without pl: unchanged
  const frs = VC.normalizeProg({}, PACK);
  check("fresh record: nothing unlocked, null on and off", VC.suggestPassage(PASSAGES, WORDS, ON, frs) === VC.suggestPassage(PASSAGES, WORDS, OFFR, frs));
  const noPl = JSON.parse(JSON.stringify(placedTop)); delete noPl.pl;
  check("placed words but no pl: pack order, equal to the flag-off pick", VC.suggestPassage(PASSAGES, WORDS, ON, noPl) === VC.suggestPassage(PASSAGES, WORDS, OFFR, noPl) && VC.suggestPassage(PASSAGES, WORDS, ON, noPl).lv === ids[0]);
  const unk = JSON.parse(JSON.stringify(placedTop)); unk.pl = "zz";
  check("unknown pl: pack order", VC.suggestPassage(PASSAGES, WORDS, ON, unk) === VC.suggestPassage(PASSAGES, WORDS, OFFR, unk));
  function seededOnce(){ let a = 7; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // rotation: the new pick under the flag is the placed-level passage; re-read picks are the done ones (unchanged)
  const rotOn = Object.assign({}, ON, { dayAware: true, readRotation: true });
  const nr = VC.nextReadItem(PASSAGES, WORDS, rotOn, placedTop, "2026-10-08", false, 5, seededOnce());
  check("readRotation on a placed record: the new pick is the top-level passage", nr && nr.reason === "new" && nr.p.lv === top);
})();

appBootChecks.catch(e => { console.error("app boot checks crashed:", e); fails++; })
  .then(() => swChecks().catch(e => { console.error("service worker checks crashed:", e); fails++; })).then(() => {
  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
});
