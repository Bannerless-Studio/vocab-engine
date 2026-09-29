// Flag-off control for sentence `spans` (docs/PACK_SCHEMA.md "sentences.json"): with no
// plain-sentence spans, locateWord, gapMatch, gapCandidateIndices, highlightParts,
// exampleSentences and passageSegments (whose span filter was shared out) return exactly what
// the engine at pinned sha BASE returns, on packs/zh and every sibling ../<lang>/pack.
// zh runs in full. Siblings take SAMPLE sentences spread evenly over the pack, and
// exampleSentences runs over that sample: highlightParts' longer-word guard makes a full
// sibling run take minutes (Korean ~0.5 s per sentence).
// Unit checks of the spans path itself live in tests/engine_checks.js [30].
// Run: node tests/sentence_spans_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
// main at the branch point: the engine before sentence spans.
const BASE = "8ad46d6";
const SAMPLE = 40;
const SIBLINGS = ["swahili", "italian", "russian", "french", "german", "spanish", "indonesian", "japanese", "korean", "persian", "urdu", "hindi", "arabic"];
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }

let fails = 0, passes = 0;
function check(name, cond, detail){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

let base = null;
try{
  const src = cp.execSync(`git -C "${ROOT}" show ${BASE}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  const m = { exports: {} }; new Function("module", "exports", "window", "globalThis", src)(m, m.exports, undefined, {}); base = m.exports;
}catch(e){ console.log("    cannot read base: " + e.message); }
check(`base ${BASE} core.js loaded from git (a missing sha is a failure)`, !!base && typeof base.locateWord === "function");

if(base){
  const packs = [["zh", path.join(ROOT, "packs", "zh"), 0]];
  SIBLINGS.forEach(n => {
    const d = path.join(ROOT, "..", n, "pack");
    if(fs.existsSync(path.join(d, "sentences.js"))) packs.push([n, d, SAMPLE]);
    else console.log(`NOTE  ../${n}/pack missing, skipped`);
  });
  for(const [name, dir, sample] of packs){
    const P0 = loadConst(path.join(dir, "pack.js"), "PACK"), Ws = loadConst(path.join(dir, "words.js"), "WORDS");
    const Ss = loadConst(path.join(dir, "sentences.js"), "SENTENCES");
    let Ps = []; try{ Ps = loadConst(path.join(dir, "sentences.js"), "PASSAGES") || []; }catch(e){}
    // A republished pack may already carry spans; the control is about packs without them.
    const B = {}; Ws.forEach(w => { B[w.id] = w; });
    const had = Ss.filter(s => s.spans).length;
    const plain = Ss.map(s => { if(!s.spans) return s; const c = Object.assign({}, s); delete c.spans; return c; });
    const step = sample ? Math.max(1, Math.floor(plain.length / sample)) : 1;
    const sub = plain.filter((_, i) => i % step === 0).slice(0, sample || undefined);
    const exWords = sample ? [...new Set(sub.flatMap(s => s.words || []))].map(id => B[id]).filter(Boolean) : Ws;
    const run = X => {
      const out = [];
      sub.forEach(s => {
        out.push(X.gapCandidateIndices(s, B, P0));
        [...new Set(s.words || [])].forEach(id => { const e = B[id]; if(!e) return;
          out.push(X.locateWord(s, e, P0), X.locateWord(s, e, P0, B), X.gapMatch(s, e, B, P0), X.highlightParts(s, e, B, P0)); });
      });
      exWords.forEach(w => out.push(X.exampleSentences(w, sample ? sub : plain, P0, 5).map(s => s.id)));
      Ps.forEach(p => (p.sentences || []).forEach(s => out.push(X.passageSegments(s, B, P0), X.passageSegments(s, undefined, P0))));
      return JSON.stringify(out);
    };
    const a = run(VC), b = run(base);
    const pspans = Ps.reduce((n, p) => n + (p.sentences || []).filter(s => Array.isArray(s.spans) && s.spans.length).length, 0);
    let diff = -1; if(a !== b){ diff = 0; while(a[diff] === b[diff]) diff++; }
    check(`${name}: ${sub.length}/${plain.length} sentences, ${exWords.length} words' examples, ${pspans} passage sentences with spans${had ? ` (${had} plain spans stripped)` : ""}: identical to ${BASE} (${a.length} bytes)`,
      a === b, diff >= 0 ? `first diff at byte ${diff}: ${a.slice(diff, diff + 80)} vs ${b.slice(diff, diff + 80)}` : "");
  }
}

console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
