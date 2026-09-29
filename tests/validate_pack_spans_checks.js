// Node checks for tools/validate_pack.py on sentences.json `spans` (docs/PACK_SCHEMA.md
// "sentences.json"): the shared check_spans rules, no gloss element on plain sentences, and
// the one pack-level coverage warning. Each case writes a small synthetic pack to a temp dir.
// Run: node tests/validate_pack_spans_checks.js   (PYTHON3 overrides the interpreter)
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON3 || "python3";

let fails = 0, passes = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); if(extra) console.log("    " + String(extra).replace(/\n/g, "\n    ").slice(0, 1200)); }
}
const tmpDirs = [];
const T = "Yeye anatumia simu.";
function fixture(){
  const words = [
    { id:"sw-tumia", w:"kutumia", en:"to use", lv:"A1", pos:"verb" },
    { id:"sw-simu", w:"simu", en:"phone", lv:"A1", pos:"noun" },
    { id:"sw-yeye", w:"yeye", en:"he, she", lv:"A1", pos:"pron" },
    ...Array.from({ length: 17 }, (_, i) => ({ id:`sw-x${i}`, w:`x${i}`, en:`gloss ${i}`, lv:"A1" })),
  ];
  const sentences = [
    { id:"s1", t:T, en:"She uses a phone.", lv:"A1", words:["sw-yeye", "sw-tumia", "sw-simu"], spans:[[0, 4, "sw-yeye"], [5, 13, "sw-tumia"], [14, 18, "sw-simu"]] },
    { id:"s2", t:"Simu.", en:"Phone.", lv:"A1", words:["sw-simu"] },
  ];
  const pack = { key:"t", name:"T", tts:"sw-KE", levels:[{ id:"A1", label:"A1" }], placement:[["A1", 2]], typing:null, showPron:false, hasLessons:false };
  return { pack, words, sentences };
}
function run(fx){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ve_svpack_")); tmpDirs.push(dir);
  const w = (stem, data) => fs.writeFileSync(path.join(dir, stem + ".json"), JSON.stringify(data));
  w("pack", fx.pack); w("words", fx.words); w("sentences", fx.sentences);
  cp.spawnSync(PY, [path.join(ROOT, "tools", "jsonify_pack.py"), dir], { cwd: ROOT });
  const r = cp.spawnSync(PY, [path.join(ROOT, "tools", "validate_pack.py"), dir], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function expectError(name, mutate, re){
  const fx = fixture(); mutate(fx.sentences[0]);
  const r = run(fx);
  check(`${name}: error`, r.status === 1 && re.test(r.out), r.out);
}

console.log("Checking tools/validate_pack.py sentence spans (Node harness, spawns python3)\n");
{
  const r = run(fixture());
  check("full spans: 0 errors, no coverage warning, summary counts 1 sentence with spans",
    r.status === 0 && / 0 errors/.test(r.out) && !/sentence spans:/.test(r.out) && /, 1 sentences with spans;/.test(r.out), r.out);
}
{
  const fx = fixture(); fx.sentences.forEach(s => { delete s.spans; });
  const r = run(fx);
  check("no spans anywhere: no spans warning, no spans note (existing packs' output unchanged)", r.status === 0 && !/span/i.test(r.out), r.out);
}
{
  const fx = fixture(); fx.sentences[0].spans = [[5, 13, "sw-tumia"]];
  fx.sentences.push({ id:"s3", t:"Yeye simu.", en:"x", lv:"A1", words:["sw-yeye", "sw-simu"], spans:[[5, 9, "sw-simu"]] });
  const r = run(fx);
  const warns = r.out.split("\n").filter(l => /^WARN  sentence spans:/.test(l));
  check("coverage: one pack-level WARN line counting unspanned linked words (3 of 5 in 2 sentences; 1 without spans)",
    r.status === 0 && warns.length === 1 && /3 of 5 linked words in 2 sentences with spans have no span/.test(warns[0]) && /1 sentences have no spans/.test(warns[0]), r.out);
}
expectError("unsorted / overlapping", s => { s.spans = [[5, 13, "sw-tumia"], [0, 4, "sw-yeye"]]; }, /ERROR sentence s1\.spans\[1\] starts at 0, before the previous span's end 13/);
expectError("out of bounds", s => { s.spans = [[14, 40, "sw-simu"]]; }, /ERROR sentence s1\.spans\[0\] \[14, 40\] out of bounds/);
expectError("word not in words", s => { s.spans = [[0, 4, "sw-x0"]]; }, /ERROR sentence s1\.spans\[0\] word 'sw-x0' is not in the sentence's words/);
expectError("gloss element", s => { s.spans = [[5, 13, "sw-tumia", "uses"]]; }, /ERROR sentence s1\.spans\[0\] must be \[start, end, wordId\]: sentences\.json spans take no gloss/);
expectError("whitespace only", s => { s.spans = [[4, 5, "sw-tumia"]]; }, /ERROR sentence s1\.spans\[0\] \[4, 5\] covers only whitespace/);
expectError("not a list", s => { s.spans = "0,4"; }, /ERROR sentence s1\.spans must be a list/);
expectError("split surrogate pair", s => { s.t = "😀 simu"; s.words = ["sw-simu"]; s.spans = [[1, 7, "sw-simu"]]; }, /ERROR sentence s1\.spans\[0\] \[1, 7\] splits a surrogate pair/);

tmpDirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
