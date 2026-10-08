// Progress file version (docs/PACK_SCHEMA.md "Progress file version", fb45): the exported file carries v (core.js
// PROG_VERSION), the stored record carries the same v, import reads no-v and v:1 files, refuses a higher v whole with
// the update message (record and pre_import backup untouched), and the legacy hsk_pinyin import path is unchanged.
// Run: node tests/export_checks.js
"use strict";
const path = require("path");
const sim = require("./lib/sim_app.js");
const { VC, ROOT, clone, tick } = sim;

let passes = 0, fails = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); } else { fails++; console.log(`FAIL  ${name}${extra ? "\n      " + extra : ""}`); }
}
const D = sim.loadPackDir(path.join(ROOT, "packs", "zh")), PACK = D.PACK, S = sim.createSim(D);
const KEY = VC.storageKey(PACK), BAK = KEY + "_pre_import_backup";
const NEWER = v => `This file was exported by a newer version of the app (v${v}). Update the app, then import.`;

(async () => {
  console.log("\n[1] the version constant and the exported file");
  check("PROG_VERSION is 1 (the format version of the file and the record)", VC.PROG_VERSION === 1);
  const st = S.fresh();
  const api = await S.boot(PACK, st, 1);
  api.clickTab("progress");
  const stored = JSON.parse(st.ls.getItem(KEY) || "null"), live = api.getProg();
  const file = JSON.parse(JSON.stringify(live, null, 1));
  check("the app's export (JSON.stringify of the record) carries v: 1", file.v === 1 && Object.keys(file)[0] === "v");
  check("the record in localStorage carries the same v: 1 (the version is the record's own field, one format)", live.v === 1 && (stored === null || stored.v === 1));
  check("defaultProg and normalizeProg write v = PROG_VERSION", VC.defaultProg(PACK).v === 1 && VC.normalizeProg({ v: 1, sets: {} }, PACK).v === 1);

  console.log("\n[2] core: applyImport");
  const base = () => { const p = VC.normalizeProg({ placedOnce: true, sessions: 7, w: { w0001: { r: 3, w: 0, s: 3 } } }, PACK); return p; };
  const noV = (() => { const f = clone(base()); delete f.v; return JSON.stringify(f); })();
  const r0 = VC.applyImport(null, noV, PACK), r1 = VC.applyImport(null, JSON.stringify(base()), PACK);
  check("a file with no v imports, and the imported record gets v 1", r0.ok && r0.prog.v === 1 && r0.prog.sessions === 7);
  check("a file with v: 1 imports", r1.ok && r1.prog.v === 1 && r1.prog.w.w0001.s === 3);
  for(const v of [2, 3, 10]){
    const r = VC.applyImport(base(), JSON.stringify(Object.assign(clone(base()), { v })), PACK);
    check(`a file with v: ${v} is refused whole with the update message`, !r.ok && r.newer === true && r.reason === NEWER(v) && !("prog" in r));
  }
  check("a newer file is refused before its other fields are read (garbage fields give the same message)", VC.applyImport(null, JSON.stringify({ v: 2, w: "nonsense", sets: 5 }), PACK).reason === NEWER(2));
  check("a non-numeric or older v keeps the ordinary shape error, not the update message", ["x", 0, -1, null].every(v => { const r = VC.applyImport(null, JSON.stringify(Object.assign(clone(base()), { v })), PACK); return !r.ok && !r.newer; }));

  console.log("\n[3] the app's Import box");
  const seed = (extra) => Object.assign(clone(base()), extra || {});
  const run = async (text) => {
    const s2 = S.fresh(); const rec = Object.assign(clone(base()), { sessions: 3, theme: "dark" });
    s2.ls.setItem(KEY, JSON.stringify(rec));
    const a = await S.boot(PACK, s2, 2); a.clickTab("progress");
    const before = s2.ls.getItem(KEY);
    a.el("imp").click(); a.el("imptxt").value = text; a.el("doimport").click(); await tick(); await tick();
    return { a, s2, before, after: s2.ls.getItem(KEY), bak: s2.ls.getItem(BAK), err: a.el("impErr"), prog: a.getProg() };
  };
  { const r = await run(JSON.stringify(seed({ v: 2, sessions: 99 })));
    check(`v: 2 file: the error box reads exactly "${NEWER(2)}"`, r.err.style.display === "block" && r.err.textContent === NEWER(2));
    check("v: 2 file: the stored record is untouched and no pre_import backup was written", r.after === r.before && r.bak === null && r.prog.sessions === 3); }
  { const r = await run(JSON.stringify(seed({ v: 1, sessions: 42 })));
    check("v: 1 file imports: record replaced, pre_import backup holds the old record", JSON.parse(r.after).sessions === 42 && JSON.parse(r.bak).sessions === 3 && r.err.style.display !== "block"); }
  { const f = seed({ sessions: 43 }); delete f.v; const r = await run(JSON.stringify(f));
    check("file with no v imports; the stored record carries v 1 afterwards", JSON.parse(r.after).sessions === 43 && JSON.parse(r.after).v === 1 && JSON.parse(r.bak).sessions === 3); }
  { const r = await run("not json");
    check("garbage still gets the ordinary error", /doesn't look like valid exported progress/.test(r.err.textContent) && r.after === r.before); }

  console.log("\n[4] the legacy hsk_pinyin import path is unchanged");
  { const legacy = { v: 2, w: {}, s: {}, sets: { "1": 2 }, c: {}, showChars: true };
    check("an hsk v:2 record on a legacy pack is recognised as legacy, not refused as newer", !!PACK.legacy && VC.isLegacyRecord(PACK, D.LEGACY, legacy) === true);
    const s3 = S.fresh(); s3.ls.setItem(KEY, JSON.stringify(Object.assign(clone(base()), { sessions: 3 })));
    const a = await S.boot(PACK, s3, 3, { }); a.clickTab("progress");
    const before = s3.ls.getItem(KEY);
    a.el("imp").click(); a.el("imptxt").value = JSON.stringify(legacy); a.el("doimport").click(); await tick(); await tick();
    const sum = a.el("impSum");
    check("importing it shows the legacy summary with the Import button, applies nothing yet", /id="impApply"/.test(sum.innerHTML) && s3.ls.getItem(KEY) === before && a.el("impErr").textContent !== NEWER(2));
    a.el("impApply").click(); await tick(); await tick();
    check("applying it replaces the record (pre_import backup written) and the new record is v 1", JSON.parse(s3.ls.getItem(KEY)).v === 1 && s3.ls.getItem(BAK) === before); }

  console.log(`\n${fails ? "FAILED" : "ALL PASSED"}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
