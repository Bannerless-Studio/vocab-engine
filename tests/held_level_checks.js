// Near-done level (TODO row "near-done levels"; ja A1 known share 445 -> 416 -> 509 -> 456 between s200 and s500): a word of the level
// being completed whose pair sits at PAIR_HOLD moves on only by a typed ask, and by streak order alone it starved behind newer words'
// lower pairs (about 150 held, 1 typed ask a session). [1] completingLevel: the lowest level with a recorded unknown word, once a later
// level has records; [2] pairPick: up to PAIR_HELD.share of the plan goes to held typed asks of that level (oldest asked first) before
// the streak order, the plan keeps its size, other words / peripheral words / non-typed asks are not promoted; [3] the Recall plan on
// zh records: with level 2 recorded, level-1 words held at 2 get at least the reserved typed asks in every plan.
// Run: node tests/held_level_checks.js
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const ZH = path.join(ROOT, "packs", "zh");
function loadConst(file, name){ return new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)(); }
const PACK = packAsOf(loadConst(path.join(ZH, "pack.js"), "PACK"), "34c5df3", { strip: [] });
const WORDS = loadConst(path.join(ZH, "words.js"), "WORDS").map(w => { const c = Object.assign({}, w); delete c.ft; return c; });
function mulberry32(seed){ let a = seed >>> 0; return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let passes = 0, fails = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); } else { fails++; console.log(`FAIL  ${name}${extra ? "  " + extra : ""}`); }
}

const byLv = lv => WORDS.filter(w => String(w.lv) === lv);
const pairs = (s, a) => ({ wm: [s, a], sm: [s, a], ws: [s, a] });
const rec = (s, a) => ({ s, u: a, p: pairs(s, a) });

console.log("[1] completingLevel");
{
  const l1 = byLv("1").slice(0, 12), l2 = byLv("2").slice(0, 12), l3 = byLv("3").slice(0, 12);
  const lw = [...l1, ...l2, ...l3];
  const mk = (r1, r2, r3) => { const w = {}; l1.forEach((x, i) => { if(r1) w[x.id] = r1(i); }); l2.forEach((x, i) => { if(r2) w[x.id] = r2(i); }); l3.forEach((x, i) => { if(r3) w[x.id] = r3(i); }); return { w }; };
  const known = () => rec(3, 5), held = () => rec(2, 5), hold1 = i => (i === 0 ? held() : known());
  check("only level 1 recorded: teaching has not moved past it, null", VC.completingLevel(l1, mk(held), PACK) === null);
  check("level 1 has an unknown word and level 2 has records: level 1", VC.completingLevel(lw, mk(hold1, known), PACK) === "1");
  check("level 1 all known, level 2 has an unknown word and level 3 has records: level 2", VC.completingLevel(lw, mk(known, hold1, known), PACK) === "2");
  check("every recorded word known: null", VC.completingLevel(lw, mk(known, known, known), PACK) === null);
  check("the lowest unknown level wins over a higher one", VC.completingLevel(lw, mk(hold1, hold1, known), PACK) === "1");
  check("a learned word without a record does not open a level", VC.completingLevel(lw, mk(known, null, null), PACK) === null);
}

console.log("[2] pairPick priority");
{
  const fits = { typedKindFits: (w, k) => k === "written" || k === "word" };
  const ws = byLv("1").slice(0, 40);
  const cand = (i, s, a, extra) => Object.assign({ t: "w", x: ws[i], key: "w:" + ws[i].id, rec: rec(s, a), kinds: ["read", "recall", "type"], tier: 1, tw: ws[i], cl: false }, extra || {});
  // 14 words at streak 0 and 1 (newer), 8 held at 2 in the completing level, ages 10..17
  const fresh = Array.from({ length: 14 }, (_, i) => cand(i, i % 2, 30 + i));
  const heldC = flag => Array.from({ length: 8 }, (_, i) => cand(14 + i, 2, 10 + i, { cl: flag }));
  const run = (cs, n) => VC.pairPick(cs, n, { a: {} }, mulberry32(1), 60, PACK, fits);
  const nHeld = out => out.filter(e => e.s === 2).length;
  const n = 8, k = Math.ceil(n * VC.PAIR_HELD.share);
  const on = run([...fresh, ...heldC(true)], n), off = run([...fresh, ...heldC(false)], n);
  check(`without the level flag the streak order starves held words (0 of ${n})`, nHeld(off) === 0, JSON.stringify(off.map(e => e.s)));
  check(`with the flag ceil(n x share) = ${k} held typed asks come in, the plan stays ${n} items`, nHeld(on) === k && on.length === n, JSON.stringify(on.map(e => e.s)));
  check("the held asks are typed and the oldest asked first", on.filter(e => e.s === 2).every(e => e.kind === "type") && on.filter(e => e.s === 2).map(e => e.a).join() === Array.from({ length: k }, (_, i) => 10 + i).join(), JSON.stringify(on.filter(e => e.s === 2).map(e => e.a)));
  check("the other slots are the streak order as before: the first n - k picks of the unflagged plan", on.filter(e => e.s !== 2).map(e => e.c.key).join() === off.slice(0, n - k).map(e => e.c.key).join());
  const peri = run([...fresh, ...heldC(true).map(c => Object.assign(c, { tier: 2 }))], n);
  check("a peripheral word's pair at 2 is known already: not promoted", nHeld(peri) === 0);
  const noType = run([...fresh, ...heldC(true).map(c => Object.assign(c, { tw: undefined, kinds: ["read", "recall"] }))], n);
  check("a held pair with no typed ask (choice only) is not promoted", nHeld(noType) === 0);
  const s1 = run([...fresh, ...Array.from({ length: 8 }, (_, i) => cand(14 + i, 1, 10 + i, { cl: true }))], n);
  check("a pair below the hold (streak 1) of the level keeps the streak order", s1.every(e => e.s <= 1));
  const few = run([...fresh.slice(0, 2), ...heldC(true).slice(0, 1)], n);
  check("fewer candidates than slots: all taken once, no repeat", few.length === 3 && new Set(few.map(e => e.c.key)).size === 3);
  const small = run([...fresh, ...heldC(true)], 3);
  check("a 3-item plan reserves ceil(3 x share) = 1 held ask", nHeld(small) === 1 && small.length === 3, JSON.stringify(small.map(e => e.s)));
}

console.log("[3] Recall plan on records");
{
  const l1 = byLv("1").slice(0, 40), l2 = byLv("2").slice(0, 40);
  const mkProg = withL2 => { const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true }, PACK); p.w = {};
    l1.forEach((w, i) => { p.w[w.id] = rec(2, 5 + (i % 7)); });
    if(withL2) l2.forEach(w => { p.w[w.id] = rec(0, 30); });
    return p; };
  const typedL1 = withL2 => { let tot = 0;
    for(let seed = 1; seed <= 6; seed++){
      const p = mkProg(withL2), lw = [...l1, ...(withL2 ? l2 : [])];
      const plan = VC.buildRecallPlan(lw, p, PACK, 12, { today: 20300, typedOk: () => true, typedKindFits: (w, k) => k === "written" || k === "word", sn: 40, rng: mulberry32(seed) });
      tot += plan.filter(it => it.word && it.kind === "type" && l1.includes(it.word)).length;
    }
    return tot; };
  const past = typedL1(true);
  check(`level 2 has records: level-1 held words get at least ${Math.ceil(12 * VC.PAIR_HELD.share)} typed asks in every plan (${past} over 6 plans)`, past >= 6 * Math.ceil(12 * VC.PAIR_HELD.share));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
