// Node checks for migrateLegacy in engine/core.js (hsk_pinyin -> vocab_zh, docs/HSK_MERGE.md §4)
// and tools/diff_hsk_migration.js. Synthetic hsk records: seeds A-E plus every hsk record
// version shape (v1, v2, v2.1, v2.2, HEAD), idempotence, the unmapped list, rejections.
// Where the hsk checkout sits beside this repo (../chinese, formerly ../hsk), each seed is also checked against
// hsk's own validateProgShape and the tool's derived-view diff; otherwise those are skipped.
// Run: node tests/migration_checks.js     (no dependencies)
"use strict";
const fs = require("fs");
const path = require("path");
const { packAsOf } = require("./lib/pack_flags.js");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const { diffMigration } = require(path.join(ROOT, "tools", "diff_hsk_migration.js"));
const ZH = path.join(ROOT, "packs", "zh");
const HSK = process.env.HSK_DIR || path.join(ROOT, "..", "chinese");
const readJSON = f => JSON.parse(fs.readFileSync(path.join(ZH, f), "utf8"));
// The sections before [lag] check the stage model (withWords, as on main 590af86); zh ships
// characters.learn "lag" since fb3-lag, checked against the same records in [lag].
// levelGate / levelExam (fb38) hold the next level back; these sections walk the Learn order of a record, so they run without them (level_gate_checks covers both).
const LAG_PACK = packAsOf(readJSON("pack.json"), "34c5df3", { strip: ["levelGate", "levelExam"] }), WORDS = readJSON("words.json"), LEGACY = readJSON("legacy.json");
const PACK = (p => { const c = Object.assign({}, p.characters, { withWords: true }); delete c.learn; return Object.assign({}, p, { characters: c }); })(LAG_PACK);
const HSK_CORE = path.join(HSK, "src", "pinyin_core.js");
const PC = fs.existsSync(HSK_CORE) ? require(HSK_CORE) : null;

let fails = 0, passes = 0, skips = 0;
function check(name, cond){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); }
}
const skip = name => { skips++; console.log(`SKIP  ${name}`); };
const clone = x => JSON.parse(JSON.stringify(x));
const eq = util.isDeepStrictEqual;

// hanzi per level, in hsk VOCAB order: id order (the zh pack lists levels by frequency, freqTiers).
const hanziOf = {}; Object.keys(LEGACY.w).forEach(h => { hanziOf[LEGACY.w[h]] = h; });
const byLv = { 1:[], 2:[], 3:[], 4:[] };
WORDS.slice().sort((a, b) => a.id < b.id ? -1 : 1).forEach(w => byLv[w.lv].push(hanziOf[w.id]));
const nsets = lv => Math.ceil(byLv[lv].length / 10);
const SENTS = Object.keys(LEGACY.s);
const rec = (r, w, s, extra) => Object.assign({ r, w, s }, extra || {});
const words = (lv, n, f) => { const o = {}; byLv[lv].slice(0, n).forEach((h, i) => { o[h] = f(i); }); return o; };

// ---- seeds
const HSK_FRESH = { v:2, w:{}, sets:{1:0,2:0,3:0,4:0}, lessons:{}, sessions:0, theme:null, showChars:false, s:{}, c:{}, mixChars:true, charsAfterHsk4:false, charsChoiceSeen:false };
const midW = Object.assign(words(1, byLv[1].length, i => rec(3 + i % 4, i % 3, i % 5)), words(2, 30, i => rec(1 + i % 3, i % 2, i % 4, i % 7 === 0 ? { prov:1 } : null)));
const hsk3done = { 1: nsets(1), 2: nsets(2), 3: nsets(3), 4: 0 };
const allLv = [1,2,3].flatMap(lv => byLv[lv]);
const charsSome = {}; allLv.slice(0, 25).forEach((h, i) => { charsSome[h] = rec(1 + i % 3, i % 2, i % 4); });
const SEEDS = {
  "A empty": {},
  "B fresh": clone(HSK_FRESH),
  "C mid-HSK2": Object.assign(clone(HSK_FRESH), { w: midW, sets:{1:nsets(1),2:3,3:0,4:0}, sessions: 14, theme:"dark", placedOnce:true,
    lessons:{ tones:1, "finals-simple":1 }, s: Object.fromEntries(SENTS.slice(0, 12).map((z, i) => [z, rec(2, i % 2, i % 3)])),
    w_d: undefined }),
  "D1 chars started, card answered: start": Object.assign(clone(HSK_FRESH), { w: midW, sets: hsk3done, sessions: 40, c: charsSome, charsChoiceSeen:true }),
  "D2 chars started, card answered: skip": Object.assign(clone(HSK_FRESH), { w: midW, sets: hsk3done, sessions: 40, c: charsSome, charsChoiceSeen:true, charsAfterHsk4:true }),
  "D3 learning order flipped from Progress": Object.assign(clone(HSK_FRESH), { w: midW, sets:{1:nsets(1),2:nsets(2),3:nsets(3),4:4}, c: charsSome, charsAfterHsk4:true, charsChoiceSeen:true, mixChars:false }),
  "E HSK4 complete": Object.assign(clone(HSK_FRESH), { w: Object.fromEntries(Object.keys(LEGACY.w).map((h, i) => [h, rec(5 + i % 3, i % 2, 3 + i % 4)])),
    sets:{1:nsets(1),2:nsets(2),3:nsets(3),4:nsets(4)}, s: Object.fromEntries(SENTS.map((z, i) => [z, rec(3, i % 2, 2)])),
    c: Object.fromEntries(Object.keys(LEGACY.c).map((h, i) => [h, rec(2 + i % 2, 0, 3)])), charsChoiceSeen:true, sessions: 200, soundsOpened:1, placedOnce:1 }),
  // record version shapes (what each hsk release stored)
  "v1": { v:1, w:{ [byLv[1][0]]: rec(2,1,1), [byLv[1][1]]: rec(1,0,1,{prov:true}) }, sets:{1:3}, lessons:{ tones:1 }, sessions:2, theme:"light" },
  "v2": { v:2, w:{ [byLv[1][0]]: rec(4,0,4) }, sets:{1:2,2:0,3:0,4:0}, lessons:{}, sessions:3, theme:null, showChars:true, dismissedSoundsHint:true },
  "v2.1 sentences": { v:2, w:{ [byLv[1][2]]: rec(1,1,0,{d:1}) }, s:{ [SENTS[0]]: rec(1,0,1) }, sets:{1:1,2:0,3:0,4:0}, lessons:{}, sessions:5, theme:null, showChars:false },
  "v2.2 characters": Object.assign({ v:2, w: midW, s:{}, sets: hsk3done, lessons:{}, sessions:30, theme:null, showChars:true }, { c: charsSome, mixChars:false }),
  "HEAD": Object.assign(clone(HSK_FRESH), { w: midW, sets: hsk3done, c: charsSome, charsChoiceSeen:false, placedOnce:true, soundsOpened:true, dismissedSoundsHint:1 }),
};
delete SEEDS["C mid-HSK2"].w_d;
// hsk records every word below its set counter (drills mark each word, placement seeds prov
// records), and learnedWords now reads records, so seeds carry that prefix like a real export.
// "v2.1 sentences" keeps its d-only level: that is the counter-prefix fallback.
for(const [name, seed] of Object.entries(SEEDS)){
  if(name === "v2.1 sentences" || !seed.sets) continue;
  seed.w = clone(seed.w || {});
  for(const lv of Object.keys(seed.sets)) byLv[lv].slice(0, seed.sets[lv]*10).forEach(h => { if(!seed.w[h]) seed.w[h] = rec(1, 0, 1, { prov:1 }); });
}

const count = m => Object.keys(m || {}).length;
console.log("[1] seeds and version shapes");
for(const [name, old] of Object.entries(SEEDS)){
  if(PC) check(`${name}: hsk's own validateProgShape accepts the seed`, PC.validateProgShape(clone(old)).ok);
  const res = VC.migrateLegacy(PACK, LEGACY, clone(old));
  check(`${name}: ok, not already migrated`, res.ok && res.already === false);
  if(!res.ok) continue;
  const p = res.prog;
  check(`${name}: nothing unmapped`, res.unmapped.length === 0);
  const expDropped = ["showChars","dismissedSoundsHint"].filter(f => old[f] !== undefined);
  check(`${name}: dropped = ${JSON.stringify(expDropped)}`, eq(res.dropped.map(d => d.path), expDropped));
  check(`${name}: validateProgShape accepts the output`, VC.validateProgShape(p, VC.levelIds(PACK)).ok);
  check(`${name}: normalizeProg accepts the output unchanged`, eq(VC.normalizeProg(clone(p), PACK), p));
  const boot = VC.bootProg(JSON.stringify(p), PACK);
  check(`${name}: bootProg keeps it (no backup, nothing dropped)`, eq(boot.prog, p) && boot.backupRaw === null && !boot.dropped.length);
  const imp = VC.applyImport(VC.defaultProg(PACK), JSON.stringify(p), PACK);
  check(`${name}: applyImport accepts it`, imp.ok && eq(imp.prog, p));
  check(`${name}: v and marker`, p.v === VC.PROG_VERSION && eq(p.legacy, { key:"hsk_pinyin", format:"hsk-v2" }));
  check(`${name}: w/s/c record counts carried`, count(p.w) === count(old.w) && count(p.s) === count(old.s) && count(p.chars.c) === count(old.c));
  const wOk = Object.keys(old.w || {}).every(h => eq(p.w[LEGACY.w[h]], old.w[h]));
  const sOk = Object.keys(old.s || {}).every(z => eq(p.s[LEGACY.s[z]], old.s[z]));
  const cOk = Object.keys(old.c || {}).every(h => eq(p.chars.c[LEGACY.c[h]], old.c[h]));
  check(`${name}: every record verbatim under its new id`, wOk && sOk && cOk);
  const sets = { 1:0, 2:0, 3:0, 4:0, ...(old.sets || {}) };
  check(`${name}: sets`, eq(p.sets, Object.fromEntries(Object.entries(sets).map(([k, v]) => [String(k), v]))));
  check(`${name}: lessons, sessions, theme, placedOnce, soundsOpened`, eq(p.lessons, old.lessons || {}) && p.sessions === (old.sessions || 0)
    && p.theme === (old.theme === undefined ? null : old.theme) && p.placedOnce === (old.placedOnce === undefined ? false : old.placedOnce)
    && p.soundsOpened === old.soundsOpened);
  check(`${name}: chars flags (mix, defer, choiceSeen)`, p.chars.mix === (old.mixChars === undefined ? true : old.mixChars)
    && p.chars.defer === !!old.charsAfterHsk4 && p.chars.choiceSeen === !!old.charsChoiceSeen && p.chars.v === VC.CHARS_PROG_VERSION);
  check(`${name}: showPron takes the pack default, hsk-only fields gone`, p.showPron === (PACK.showPron !== false)
    && ["showChars","dismissedSoundsHint","mixChars","charsAfterHsk4","charsChoiceSeen","c"].every(f => p[f] === undefined));
  const again = VC.migrateLegacy(PACK, LEGACY, clone(p));
  check(`${name}: idempotent (second run already=true, same prog)`, again.ok && again.already === true && eq(again.prog, p) && !again.unmapped.length);
  const fromStr = VC.migrateLegacy(PACK, LEGACY, JSON.stringify(old));
  check(`${name}: string input gives the same result`, fromStr.ok && eq(fromStr.prog, p));
  const rep = diffMigration(clone(old), ZH, PC ? HSK : null);
  check(`${name}: tool roundtrip diff empty`, rep.ok && rep.roundtrip.length === 0);
  check(`${name}: tool totals before = after`, rep.ok && rep.totals.every(t => eq(t.before, t.after)));
  if(PC) check(`${name}: tool derived views match hsk (${rep.derived ? rep.derived.filter(d => !d.same).map(d => d.name).join(", ") || "all same" : "none"})`, rep.ok && rep.derived && rep.derived.every(d => d.same) && rep.pass);
  else skip(`${name}: derived views (no hsk checkout at ${HSK})`);
}

// hsk PINYIN_SPEC seed E (deferred, mid-HSK 4): sentence availability differs only by the
// accepted s0823 (分之 merged by pack_from_hsk; docs/HSK_MERGE.md §8), and the tool passes.
{
  const E = Object.assign(clone(HSK_FRESH), { sets:{1:nsets(1),2:nsets(2),3:nsets(3),4:7}, theme:"light", sessions:3, placedOnce:true, soundsOpened:true, charsAfterHsk4:true, charsChoiceSeen:true });
  if(PC){
    const rep = diffMigration(clone(E), ZH, HSK), v = rep.derived && rep.derived.find(d => /^available sentences/.test(d.name));
    check(`walk seed E: sentence availability compared, only s0823 differs (${v ? v.name : "missing"}), tool passes`,
      !!v && eq(v.hsk, ["s0823"]) && eq(v.engine, []) && v.same && rep.pass);
  } else skip("walk seed E: sentence availability (no hsk checkout)");
}

console.log("\n[2] seed-specific derived state on the engine side");
const W = WORDS, U = readJSON("characters.json");
const mig = n => VC.migrateLegacy(PACK, LEGACY, clone(SEEDS[n])).prog;
check("A empty: equals defaultProg plus the marker", eq(mig("A empty"), Object.assign(VC.defaultProg(PACK), { legacy: { key:"hsk_pinyin", format:"hsk-v2" } })));
// One character stage per level with characters.withWords (fb2-write): no choice card; an
// unlocked 字 stage and the next word level take turns by prog.sessions parity; a stored
// "after" (chars.defer) is "later": HSK 2 set 3, the stage before the split.
const par = (p, n) => Object.assign(p, { sessions: n });
const isChars1 = s => s && s.kind === "chars" && eq(s.levels, ["1"]);
check("C mid-HSK2: no card; even sessions HSK 2 set 3, odd 字1; skipped (later), HSK 2 set 3 both",
  !VC.showCharChoice(PACK, W, U, mig("C mid-HSK2"))
  && (s => s && s.kind === "words" && s.lv === "2" && s.set === 3)(VC.nextStage(PACK, W, U, par(mig("C mid-HSK2"), 2))) && isChars1(VC.nextStage(PACK, W, U, par(mig("C mid-HSK2"), 3)))
  && [2, 3].every(n => (s => s && s.kind === "words" && s.lv === "2" && s.set === 3)(VC.nextStage(PACK, W, U, par(VC.answerCharChoice(mig("C mid-HSK2"), false), n)))));
// R5 (owner 2026-10-02): a learner with character records (the old single stage, taught every
// session) loads as chars.order "first": 字1 every session until done; "with" restores the turns.
const withO = p => VC.setCharMode(p, "with");
check("HEAD (HSK 1-3 done, card unanswered, records): no card, order first, 字1 every session; set to with words, 字1 and HSK 4 take turns", VC.showCharChoice(PACK, W, U, mig("HEAD")) === false
  && mig("HEAD").chars.order === "first" && [1, 2].every(n => isChars1(VC.nextStage(PACK, W, U, par(mig("HEAD"), n))))
  && isChars1(VC.nextStage(PACK, W, U, par(withO(mig("HEAD")), 1))) && VC.nextStage(PACK, W, U, par(withO(mig("HEAD")), 2)).lv === "4");
check("D1 (answered start, records): no card, order first, 字1 every session; set to with words, 字1 and HSK 4 take turns", !VC.showCharChoice(PACK, W, U, mig("D1 chars started, card answered: start"))
  && mig("D1 chars started, card answered: start").chars.order === "first" && [0, 1].every(n => isChars1(VC.nextStage(PACK, W, U, par(mig("D1 chars started, card answered: start"), n))))
  && isChars1(VC.nextStage(PACK, W, U, par(withO(mig("D1 chars started, card answered: start")), 1))) && VC.nextStage(PACK, W, U, par(withO(mig("D1 chars started, card answered: start")), 0)).lv === "4");
check("D2 (answered skip): no card, next stage is HSK 4", !VC.showCharChoice(PACK, W, U, mig("D2 chars started, card answered: skip"))
  && (s => s && s.kind === "words" && s.lv === "4")(VC.nextStage(PACK, W, U, mig("D2 chars started, card answered: skip"))));
check("D3 (order flipped): one deferred characters stage 1-4 after HSK 4", (p => { const cs = VC.stagePath(PACK, W, U, p).filter(s => s.kind === "chars"); return cs.length === 1 && eq(cs[0].levels, ["1","2","3","4"]); })(mig("D3 learning order flipped from Progress")));
check("E HSK4 complete: every stage done, characters started", VC.nextStage(PACK, W, U, mig("E HSK4 complete")) === null && VC.charsStarted(PACK, W, U, mig("E HSK4 complete")));
check("E HSK4 complete: all 1193 words learned", VC.learnedWords(W, PACK, mig("E HSK4 complete")).length === W.length);

console.log("\n[3] unmapped list");
{
  const [h1, h2] = byLv[1];
  const bad = { v:2, w:{ [h1]: { r:2, w:"1", s:1, x:9 }, "不存在的词": rec(1,0,1), [h2]: 5 },
    s:{ [SENTS[0]]: rec(1,0,1), "不存在的句子。": rec(1,0,1) }, c:{ [h1]: rec(1,0,1), "龘": rec(1,0,1) },
    sets:{ 1:2.5, 2:1, 5:1 }, theme:"blue", sessions:"7", mixChars:"yes", placedOnce:true, foo:{ bar:1 }, showChars:true };
  const res = VC.migrateLegacy(PACK, LEGACY, clone(bad));
  const paths = res.ok ? res.unmapped.map(u => u.path).sort() : [];
  const expect = [`w.${h1}.w`, `w.${h1}.x`, "w.不存在的词", `w.${h2}`, "s.不存在的句子。", "c.龘", "sets.1", "sets.5", "theme", "sessions", "mixChars", "foo"].sort();
  check(`unmapped lists exactly the bad parts (${paths.length})`, eq(paths, expect));
  check("each unmapped entry carries its original value and a reason", res.ok && res.unmapped.every(u => typeof u.reason === "string" && u.reason && eq(u.value, u.path.split(".").reduce((x, k) => x[k], bad))));
  check("valid parts of a partly bad record survive", res.ok && eq(res.prog.w[LEGACY.w[h1]], { r:2, s:1 }) && res.prog.sets["2"] === 1 && res.prog.sets["1"] === 0);
  check("the rest still maps (s, c, placedOnce) and output validates", res.ok && count(res.prog.s) === 1 && count(res.prog.chars.c) === 1 && res.prog.placedOnce === true && VC.validateProgShape(res.prog, VC.levelIds(PACK)).ok);
  check("defaults fill the unmapped scalars", res.ok && res.prog.theme === null && res.prog.sessions === 0 && res.prog.chars.mix === true);
  check("dropped is separate from unmapped", res.ok && eq(res.dropped, [{ path:"showChars", value:true }]));
  const notObj = VC.migrateLegacy(PACK, LEGACY, { w: [], s: "x", lessons: 3 });
  check("non-object buckets are reported whole", notObj.ok && eq(notObj.unmapped.map(u => u.path).sort(), ["lessons","s","w"]));
  const proto = VC.migrateLegacy(PACK, LEGACY, JSON.parse('{"w":{"__proto__":{"r":1}},"__proto__":{"x":1}}'));
  check("__proto__ keys are unmapped, never merged", proto.ok && eq(proto.unmapped.map(u => u.path).sort(), ["__proto__","w.__proto__"]) && ({}).r === undefined);
  const dupMap = { w: { a:"w0001", b:"w0001" }, s:{}, c:{} };
  const dup = VC.migrateLegacy(PACK, dupMap, { w:{ a: rec(1,0,1), b: rec(2,0,2) } });
  check("two keys on one id: the second is unmapped, the first kept", dup.ok && eq(dup.prog.w.w0001, rec(1,0,1)) && eq(dup.unmapped.map(u => u.path), ["w.b"]));
  const noChars = Object.assign(clone(PACK)); delete noChars.characters;
  const nc = VC.migrateLegacy(noChars, LEGACY, clone(SEEDS["D1 chars started, card answered: start"]));
  check("pack without characters: c and the three flags unmapped, no chars key", nc.ok && nc.prog.chars === undefined
    && eq(nc.unmapped.map(u => u.path).sort(), ["c","charsAfterHsk4","charsChoiceSeen","mixChars"]) && nc.unmapped.every(u => /characters/.test(u.reason)));
  const failRep = diffMigration(clone(bad), ZH, null);
  check("tool FAILs when anything is unmapped", failRep.ok && failRep.pass === false && failRep.unmapped.length === expect.length);
}

console.log("\n[4] rejections and helpers");
check("unknown legacy version rejected", (r => !r.ok && /version 3/.test(r.reason))(VC.migrateLegacy(PACK, LEGACY, { v:3 })));
check("array, null, number, bad JSON rejected", [[], null, 4, "{nope"].every(x => !VC.migrateLegacy(PACK, LEGACY, x).ok));
const noLegacy = clone(PACK); delete noLegacy.legacy;
check("pack without legacy rejected", !VC.migrateLegacy(noLegacy, LEGACY, {}).ok);
check("marked record that fails validation rejected, not re-migrated", !VC.migrateLegacy(PACK, LEGACY, { legacy:{ key:"hsk_pinyin" }, sets:{ 9:1 } }).ok);
check("legacyBackupKey is hsk_pinyin.bak", VC.legacyBackupKey(PACK) === "hsk_pinyin.bak");
check("storage keys differ (vocab_zh vs hsk_pinyin vs backup)", new Set([VC.storageKey(PACK), PACK.legacy.key, VC.legacyBackupKey(PACK)]).size === 3);
check("isLegacyRecord: every seed but A empty is legacy", Object.entries(SEEDS).filter(([n]) => n !== "A empty").every(([, s]) => VC.isLegacyRecord(PACK, LEGACY, s)));
check("isLegacyRecord: native and migrated progress are not", !VC.isLegacyRecord(PACK, LEGACY, VC.defaultProg(PACK)) && !VC.isLegacyRecord(PACK, LEGACY, mig("C mid-HSK2"))
  && !VC.isLegacyRecord(PACK, LEGACY, { v:1, w:{ w0001: rec(1,0,1) }, sets:{ 1:1 } }));
check("isLegacyRecord: false for a pack without legacy", !VC.isLegacyRecord(noLegacy, LEGACY, SEEDS["C mid-HSK2"]));
check("input record is not mutated", (() => { const o = clone(SEEDS["HEAD"]); VC.migrateLegacy(PACK, LEGACY, o); return eq(o, SEEDS["HEAD"]); })());

// prog.read.done[id].l (engine-listen-mode): an optional l:1 marks a listening pass. The
// only stored-shape change: records without it load unchanged; with it they round-trip.
console.log("\n[read.done.l] listening-pass marker");
{
  const readOld = { unlocked: { HSK1: 1 }, done: { p0001: { sc: 3, n: 5, d: "2026-09-01", x: 1 }, p0002: { sc: 5, n: 5, d: "2026-09-02", x: 2 } } };
  const oldRaw = JSON.stringify({ v: VC.PROG_VERSION, w: {}, sets: {}, read: readOld });
  const bo = VC.bootProg(oldRaw, PACK);
  check("stored progress with pre-listen read.done records boots unchanged (no backup, no l added)", bo.backupRaw === null && eq(bo.prog.read, readOld) && Object.values(bo.prog.read.done).every(r => !("l" in r)));
  const im = VC.applyImport(null, oldRaw, PACK);
  check("import of pre-listen read.done records: unchanged", im.ok && eq(im.prog.read, readOld));
  const p = clone(bo.prog);
  VC.markPassageDone(p, "p0001", 4, 5, "2026-09-27", true);
  check("a listening pass writes l:1 on that record only", eq(p.read.done.p0001, { sc: 4, n: 5, d: "2026-09-27", x: 2, l: 1 }) && eq(p.read.done.p0002, readOld.done.p0002));
  const raw2 = JSON.stringify(p);
  const ps = VC.parseStored(raw2), v = VC.validateProgShape(ps.data, PACK.levels.map(l => l.id));
  check("parseStored + validateProgShape accept a record with l", ps.ok && v.ok);
  const b2 = VC.bootProg(raw2, PACK);
  check("record with l survives a save/boot round trip", b2.backupRaw === null && eq(b2.prog.read, p.read));
  const i2 = VC.applyImport(null, raw2, PACK);
  check("record with l survives export/import", i2.ok && eq(i2.prog.read, p.read));
  VC.markPassageDone(p, "p0001", 5, 5, "2026-10-05");
  check("a later reading pass replaces the record without l (no readRotation: l marks the latest pass, readPassMode alternates on it)", eq(p.read.done.p0001, { sc: 5, n: 5, d: "2026-10-05", x: 3 }));
  const bad = JSON.stringify({ read: { done: { p0001: { sc: 1, n: 5, d: "2026-09-27", x: 1, l: "yes" } } } });
  check("a non-number l is rejected by validation (boot keeps a backup)", !VC.validateProgShape(JSON.parse(bad), []).ok && VC.bootProg(bad, PACK).backupRaw === bad);
  check("progress carrying read (with l) is native, not legacy", !VC.isLegacyRecord(PACK, LEGACY, p));
}

// prog.w[id].k (engine-miss-kind): optional last missed kind. Old records round-trip
// byte-for-byte; a k outside MISS_KINDS is dropped on load, the record kept.
console.log("\n[w.k] missed-kind marker");
{
  const W = WORDS.slice(0, 3).map(w => w.id);
  const wOld = { [W[0]]: { r: 3, w: 1, s: 2 }, [W[1]]: { r: 0, w: 0, s: 0, prov: 1 }, [W[2]]: { r: 1, w: 2, s: 0, d: 1 } };
  const oldRaw = JSON.stringify({ w: wOld, sessions: 4 });
  const bo = VC.bootProg(oldRaw, PACK);
  check("stored word records without k boot unchanged (no backup, no k added)", bo.backupRaw === null && eq(bo.prog.w, wOld) && Object.values(bo.prog.w).every(r => !("k" in r)));
  check("... and save back byte-for-byte", JSON.stringify(bo.prog.w) === JSON.stringify(wOld));
  const im = VC.applyImport(null, oldRaw, PACK);
  check("import of word records without k: unchanged", im.ok && JSON.stringify(im.prog.w) === JSON.stringify(wOld));
  const p = clone(bo.prog);
  VC.markRec(p.w, W[0], false, true, "type");
  check("a typed miss writes k:\"type\" on that record only", eq(p.w[W[0]], { r: 3, w: 2, s: 0, k: "type" }) && eq(p.w[W[1]], wOld[W[1]]));
  const raw2 = JSON.stringify(p);
  const ps = VC.parseStored(raw2), v = VC.validateProgShape(ps.data, PACK.levels.map(l => l.id));
  check("parseStored + validateProgShape accept a record with k", ps.ok && v.ok);
  const b2 = VC.bootProg(raw2, PACK);
  check("record with k survives a save/boot round trip", b2.backupRaw === null && eq(b2.prog.w, p.w) && JSON.stringify(b2.prog.w) === JSON.stringify(p.w));
  const i2 = VC.applyImport(null, raw2, PACK);
  check("record with k survives export/import", i2.ok && eq(i2.prog.w, p.w));
  VC.markRec(p.w, W[0], true, true, "type");
  check("a pass in the missed kind removes k", eq(p.w[W[0]], { r: 4, w: 2, s: 1 }));
  for(const [label, bad] of [["unknown string", "gap"], ["number", 3], ["null", null], ["object", {}]]){
    const raw = JSON.stringify({ w: { [W[0]]: { r: 1, w: 1, s: 0, k: bad }, [W[1]]: { r: 2, w: 0, s: 2, k: "hear" } } });
    const b = VC.bootProg(raw, PACK), i = VC.applyImport(null, raw, PACK);
    check(`bad k (${label}) dropped on boot and import; record and a valid k on another word kept`,
      b.backupRaw === null && eq(b.prog.w[W[0]], { r: 1, w: 1, s: 0 }) && eq(b.prog.w[W[1]], { r: 2, w: 0, s: 2, k: "hear" })
      && i.ok && eq(i.prog.w[W[0]], { r: 1, w: 1, s: 0 }) && eq(i.prog.w[W[1]], { r: 2, w: 0, s: 2, k: "hear" }));
  }
  check("progress carrying w.k is native, not legacy", !VC.isLegacyRecord(PACK, LEGACY, p));
}

console.log("\n[session] session resume key (docs/PACK_SCHEMA.md \"Session resume\")");
{
  // A new key, never a new progress field: the record lives in localStorage (sessionStorage
  // before fb2-ui) beside the progress key and is never read by boot, migration, import or
  // export. Its value is the latest record with other app tabs' records under `park`.
  const SK = VC.sessionKey(PACK);
  check(`session key ${SK} differs from the progress, legacy, legacy-backup and progress-backup keys`,
    SK === "vocab_zh_session" && new Set([SK, VC.storageKey(PACK), PACK.legacy.key, VC.legacyBackupKey(PACK), ...["invalid_backup", "pre_import_backup", "reset_backup"].map(x => `${VC.storageKey(PACK)}_${x}`)]).size === 7);
  const p = mig("C mid-HSK2"), raw = JSON.stringify(p);
  const b = VC.bootProg(raw, PACK);
  check("migrated progress boots unchanged with no session field (the session record is never part of it)", b.backupRaw === null && eq(b.prog, VC.normalizeProg(p, PACK)) && !Object.keys(b.prog).some(k => /^session(?!s$)/.test(k)));
  check("a session record is not a legacy record", !VC.isLegacyRecord(PACK, LEGACY, { v: VC.SESSION_VERSION, build: "x", t: 0, fp: "0", tab: "today" }));
  const parked = { v: VC.SESSION_VERSION, build: "x", t: 0, fp: "0", tab: "today", park: { test: { v: VC.SESSION_VERSION, build: "x", t: 0, fp: "0", tab: "test" } } };
  check("a session value with parked records is not a legacy record", !VC.isLegacyRecord(PACK, LEGACY, parked));
}

console.log("\n[day] dayAware: prog.day log and record t (docs/PACK_SCHEMA.md \"dayAware\")");
{
  const p = mig("C mid-HSK2");
  const hasDayFields = x => "day" in x || [x.w, x.s, (x.chars || {}).c].some(m => Object.values(m || {}).some(r => "t" in r));
  check("migrated legacy progress carries no day log and no t (both are written by drills only)", !hasDayFields(p));
  if(!Object.keys(p.chars.c).length) p.chars.c[U[0].id] = { r: 1, w: 0, s: 1 };
  if(!Object.keys(p.s).length) p.s.x1 = { r: 1, w: 0, s: 1 };
  const W0 = Object.keys(p.w)[0], S0 = Object.keys(p.s)[0], C0 = Object.keys(p.chars.c)[0];
  const today = "2026-10-02";
  check("pack.dayAware is on for zh", VC.dayAwareOn(PACK) === true);
  VC.dayStart(p, PACK, today);
  VC.noteDay(p, PACK, today, "w:" + W0, "hear", true);
  VC.noteDay(p, PACK, today, "s:" + S0, "gap", false);
  VC.noteDay(p, PACK, today, "c:" + C0, "charRead", true);
  const dn = Date.UTC(2026, 9, 2) / 864e5;
  check("noteDay: additive only (day log + t on the answered records; r/w/s untouched by it)",
    eq(p.day, { d: today, n: 1, a: { ["w:" + W0]: { r: ["hear"], c: 1 }, ["s:" + S0]: { m: 1, mk: ["gap"] }, ["c:" + C0]: { r: ["charRead"], c: 1 } } })
    && p.w[W0].t === dn && p.s[S0].t === dn && p.chars.c[C0].t === dn);
  const raw = JSON.stringify(p);
  const b = VC.bootProg(raw, PACK);
  check("progress with day + t survives a save/boot round trip", b.backupRaw === null && eq(b.prog.day, p.day) && eq(b.prog.w, p.w) && eq(b.prog.s, p.s) && eq(b.prog.chars.c, p.chars.c));
  const i = VC.applyImport(null, raw, PACK);
  check("progress with day + t survives export/import", i.ok && eq(i.prog.day, p.day) && eq(i.prog.w, p.w));
  check("progress with day + t is native, not legacy", !VC.isLegacyRecord(PACK, LEGACY, p));
  for(const [label, bad] of [["array", []], ["string", "x"], ["null", null], ["no a", { d: today, n: 1 }], ["n not an integer", { d: today, n: "1", a: {} }]]){
    const r2 = JSON.stringify(Object.assign({}, p, { day: bad }));
    const b2 = VC.bootProg(r2, PACK);
    check(`malformed day (${label}) never invalidates progress; it reads as a fresh day`, b2.backupRaw === null && eq(b2.prog.w, p.w) && eq(VC.dayLog(b2.prog, today), { d: today, n: 0, a: {} }));
  }
  VC.dayStart(p, PACK, today);
  VC.noteDay(p, PACK, today, "s:" + S0, "read", true);
  check("a miss stays pending (mk) after a right answer in an easier kind", eq(p.day.a["s:" + S0].mk, ["gap"]) && VC.dayPending(p.day.a["s:" + S0]) !== null);
  VC.noteDay(p, PACK, today, "s:" + S0, "gap", true);
  check("a right answer in the missed kind settles it (mk removed)", !("mk" in p.day.a["s:" + S0]) && VC.dayPending(p.day.a["s:" + S0]) === null);
  check("a day log from another date reads as a fresh day", eq(VC.dayLog(p, "2026-10-03"), { d: "2026-10-03", n: 0, a: {} }));
  const off = Object.assign({}, PACK); delete off.dayAware;
  const q = mig("C mid-HSK2"), before = JSON.stringify(q);
  VC.dayStart(q, off, today); VC.noteDay(q, off, today, "w:" + Object.keys(q.w)[0], "hear", true);
  check("without pack.dayAware, dayStart/noteDay write nothing", JSON.stringify(q) === before);
  VC.daySessionStart(q, off); VC.dayStart(q, off, today, true);
  check("without pack.dayAware, no session ordinal (prog.sn) is written", JSON.stringify(q) === before);

  // Session clock: prog.sn, u on records and log entries, misses carried over midnight.
  const z = mig("C mid-HSK2"); const ZW = Object.keys(z.w);
  check("migrated legacy progress has no prog.sn and no u", !("sn" in z) && !Object.values(z.w).some(r => "u" in r));
  for(const [label, bad] of [["string", "3"], ["negative", -2], ["fraction", 1.5]]){
    const y = Object.assign(clone(z), { sn: bad }); VC.daySessionStart(y, PACK);
    check(`malformed prog.sn (${label}) restarts at 1, progress untouched`, y.sn === 1 && eq(y.w, z.w));
  }
  VC.dayStart(z, PACK, today, true);
  check("dayStart(newSession) counts one session; a Today step's drill (no newSession) does not", z.sn === 1 && (VC.dayStart(z, PACK, today), z.sn === 1) && z.day.n === 2);
  VC.noteDay(z, PACK, today, "w:" + ZW[0], "recall", false);
  VC.noteDay(z, PACK, today, "w:" + ZW[1], "hear", true);
  VC.noteDay(z, PACK, today, "w:" + ZW[2], "gap", true);
  check("noteDay: u (session ordinal) on the answered record and on the log entry of a right answer; a cloze leaves the word's t/u",
    z.w[ZW[0]].u === 1 && z.w[ZW[1]].u === 1 && z.day.a["w:" + ZW[1]].u === 1 && !("u" in z.day.a["w:" + ZW[0]]) && !("u" in z.w[ZW[2]]) && !("t" in z.w[ZW[2]]));
  const next = "2026-10-03";
  check("next day: the unsettled miss and the last sessions' right kinds carry over; nothing else",
    eq(VC.dayLog(z, next), { d: next, n: 0, a: { ["w:" + ZW[0]]: { mk: ["recall"], ms: 1 }, ["w:" + ZW[1]]: { r: ["hear"], u: 1 } } }));
  z.sn = 1 + VC.DAY_RECENT_SESSIONS + 1;
  check(`after ${VC.DAY_RECENT_SESSIONS} more sessions only the miss carries`, eq(VC.dayLog(z, next).a, { ["w:" + ZW[0]]: { mk: ["recall"], ms: 1 } }));
  check("a miss carried for days stays tier 0 until settled", VC.dayTier({ key: "w:" + ZW[0], kinds: ["recall"] }, VC.dayLog(z, "2026-10-09"), z.sn) === 0);
  VC.dayStart(z, PACK, "2026-10-09", true); VC.noteDay(z, PACK, "2026-10-09", "w:" + ZW[0], "hear", true);
  check("an easier kind days later still does not settle it", eq(z.day.a["w:" + ZW[0]].mk, ["recall"]));
  VC.noteDay(z, PACK, "2026-10-09", "w:" + ZW[0], "type", true);
  check("a production kind settles a production miss days later", !("mk" in z.day.a["w:" + ZW[0]]));
  // A miss in a kind this device cannot show (hear with no voice) settles in the nearest kind it can.
  const D9 = "2026-10-09", noVoice = VC.dayWordKinds(PACK).filter(k => k !== "hear");
  VC.noteDay(z, PACK, D9, "w:" + ZW[3], "hear", false);
  check("a miss stores ms, the session of its first miss", eq(z.day.a["w:" + ZW[3]].mk, ["hear"]) && z.day.a["w:" + ZW[3]].ms === z.sn && !("ma" in z.day.a["w:" + ZW[3]]));
  VC.dayStart(z, PACK, D9, true);
  const y = clone(z);
  VC.noteDay(y, PACK, D9, "w:" + ZW[3], "read", true);
  check("with a voice, read does not settle a hear miss (ma marks the attempt)", eq(y.day.a["w:" + ZW[3]].mk, ["hear"]) && y.day.a["w:" + ZW[3]].ma === 1);
  VC.noteDay(z, PACK, D9, "w:" + ZW[3], "read", true, noVoice);
  check("without a voice, read settles it (mk, ms, ma removed)", !("mk" in z.day.a["w:" + ZW[3]]) && !("ms" in z.day.a["w:" + ZW[3]]) && !("ma" in z.day.a["w:" + ZW[3]]));
  check("dayMissKinds: hear -> read (same partition), gap -> the first renderable kind when no production kind is left", eq(VC.dayMissKinds(["hear"], noVoice), ["read"]) && eq(VC.dayMissKinds(["gap"], ["hear", "read"]), ["hear"]) && eq(VC.dayMissKinds(["hear"]), ["hear"]));
  // Age-out: asked again (ma) and still pending DAY_MISS_MAX_SESSIONS sessions after ms.
  VC.noteDay(y, PACK, D9, "w:" + ZW[4], "recall", false); VC.noteDay(y, PACK, D9, "w:" + ZW[5], "recall", false);
  VC.dayStart(y, PACK, D9, true); VC.noteDay(y, PACK, D9, "w:" + ZW[4], "read", true);
  y.sn += VC.DAY_MISS_MAX_SESSIONS;
  const yd = VC.dayLog(y, "2026-10-10");
  check(`a miss asked again and pending ${VC.DAY_MISS_MAX_SESSIONS} sessions on is dropped (tier, carry); one never asked again stays`,
    VC.dayTier({ key: "w:" + ZW[4], kinds: ["recall"] }, y.day, y.sn) !== 0 && !yd.a["w:" + ZW[4]] && VC.dayTier({ key: "w:" + ZW[5], kinds: ["recall"] }, yd, y.sn) === 0 && yd.a["w:" + ZW[5]].ms === y.sn - VC.DAY_MISS_MAX_SESSIONS - 1 && !("ma" in yd.a["w:" + ZW[5]]));
  const zraw = JSON.stringify(z), zb = VC.bootProg(zraw, PACK);
  check("progress with sn + u survives a save/boot round trip and export/import", zb.backupRaw === null && zb.prog.sn === z.sn && eq(zb.prog.w, z.w) && eq(zb.prog.day, z.day) && (i2 => i2.ok && i2.prog.sn === z.sn)(VC.applyImport(null, zraw, PACK)));
  // Rollback safety: the engine before dayAware (3d66aea, the live Chinese site) boots this
  // progress with no backup and keeps day, sn and u untouched.
  let old = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show 3d66aea:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_3d66aea.js"); fs.writeFileSync(f, src); old = require(f);
  } catch(e){ old = null; }
  if(!old) skip("previous engine 3d66aea not in this checkout's history");
  else {
    const ob = old.bootProg(zraw, PACK);
    check("previous engine 3d66aea boots day + sn + u progress with no backup, fields kept", ob.backupRaw === null && ob.prog.sn === z.sn && eq(ob.prog.day, z.day) && eq(ob.prog.w, z.w));
  }
}

console.log("\n[write] characters per level, bareBy typed, bareWords (fb2-write): stored progress keeps its meaning");
{
  // The zh pack before fb2-write: one stage after HSK 3 for levels 1-3, no bareBy/bareWords.
  const OLD = (p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; delete c.withWords; delete c.learn; return Object.assign({}, p, { characters: c }); })(clone(PACK));
  const labels = p => VC.stagePath(PACK, W, U, p).map(s => s.label).join(" ");
  const nextOf = (pk, p) => { const st = VC.nextStage(pk, W, U, p); const cs = st && st.kind === "chars" ? VC.nextCharSet(st.levels, U, pk, p) : null; return st ? `${st.kind}:${st.kind === "words" ? st.lv + "/" + st.set : st.levels.join("+")}${cs ? " " + cs.units[0].id : ""}` : "done"; };
  check("pack: one characters stage per level, labels 字1..字4, bareBy typed, bareWords", eq(VC.charsConfig(PACK).stages.map(st => st.levels.join()), ["1", "2", "3", "4"]) && VC.typedBareOn(PACK) && VC.charsConfig(PACK).bareWords === true && !VC.typedBareOn(OLD));
  // (a) fresh
  const a = VC.defaultProg(PACK);
  check(`(a) fresh: path ${labels(a)}; next HSK 1 set 0 (old pack the same)`, labels(a) === "HSK 1 字1 HSK 2 字2 HSK 3 字3 HSK 4 字4" && nextOf(PACK, a) === "words:1/0" && nextOf(OLD, a) === "words:1/0");
  // (b) mid HSK 2
  const b = mig("C mid-HSK2"), braw = JSON.stringify(b);
  // The first HSK 1 unit in pack order (c0001 before fb26 put each level in frequency order).
  const C1 = "chars:1 " + VC.charStageUnits(["1"], U, PACK)[0].id;
  const bs = n => Object.assign(clone(b), { sessions: n });
  check(`(b) mid HSK 2: old pack ${nextOf(OLD, b)}; now no card, sessions alternate ${nextOf(PACK, bs(4))} / ${nextOf(PACK, bs(5))}`, nextOf(OLD, b) === "words:2/3" && nextOf(PACK, bs(4)) === "words:2/3" && nextOf(PACK, bs(5)) === C1 && !VC.showCharChoice(PACK, W, U, b));
  // Stored choice mapping: chars.defer true ("after") is "later"; anything else is "with words".
  // The alternation reads prog.sessions only: no new field.
  check("(b) stored choice: defer true -> later (HSK 2 set 3 every session, one 字 stage last); seen + defer false or unseen -> with words",
    [4, 5].every(n => (p => nextOf(PACK, p) === "words:2/3" && VC.stagePath(PACK, W, U, p).filter(s => s.kind === "chars").length === 1)(VC.setCharOrder(bs(n), true)))
    && nextOf(PACK, VC.answerCharChoice(bs(5), true)) === C1 && nextOf(PACK, bs(5)) === C1
    && !VC.charsWithWords(PACK, VC.setCharOrder(bs(5), true)) && VC.charsWithWords(PACK, bs(5)) && !VC.charsWithWords(OLD, bs(5)));
  // (c) in the characters stage
  const c = mig("D1 chars started, card answered: start"), craw = JSON.stringify(c);
  const recsBefore = JSON.stringify(c.chars.c);
  const cs1 = Object.assign(clone(c), { sessions: 1 });
  check(`(c) in the characters stage: same next unit on a character session (${nextOf(OLD, cs1)} -> ${nextOf(PACK, cs1)}), no card`, nextOf(OLD, cs1).split(" ")[1] === nextOf(PACK, cs1).split(" ")[1] && !VC.showCharChoice(PACK, W, U, c));
  // Storage: no new field or key; boot under the new pack reads exactly what the old pack read.
  for(const [label, raw] of [["(a)", JSON.stringify(a)], ["(b)", braw], ["(c)", craw]]){
    const nb = VC.bootProg(raw, PACK), ob = VC.bootProg(raw, OLD);
    check(`${label} boot: no backup, progress identical under the old and new pack, nothing rewritten`, nb.backupRaw === null && ob.backupRaw === null && eq(nb.prog, ob.prog) && JSON.stringify(nb.prog.chars.c) === JSON.stringify(JSON.parse(raw).chars.c));
  }
  check(`(c) unit records untouched by boot (streaks 3-${PACK.characters.bare - 1} stay, at or above bare ${PACK.characters.bare} stay bare)`, JSON.stringify(VC.bootProg(craw, PACK).prog.chars.c) === recsBefore);
  // Typed credit, hold and floor write only r/w/s of an existing unit record and the day log
  // (kind "type" on a c: key, a value w: keys already carry): the engine before (main 8023572)
  // boots it with no backup.
  const p = VC.bootProg(craw, PACK).prog, U0 = Object.keys(p.chars.c)[0], u0 = U.find(u => u.id === U0);
  p.chars.c[U0] = { r: 6, w: 0, s: 4 };
  VC.dayStart(p, PACK, "2026-10-02", true);
  VC.markUnitTyped(p, U, PACK, u0.words[0], true); VC.noteDay(p, PACK, "2026-10-02", "c:" + U0, "type", true);
  check("typed credit: +1 on the existing record, day log c: entry right in \"type\"", p.chars.c[U0].s === 5 && p.chars.c[U0].r === 7 && eq(p.day.a["c:" + U0].r, ["type"]));
  // Day log: a character unit whose miss aged out keeps { ag: 1 } over midnight (dayCarry).
  const U1 = Object.keys(p.chars.c)[1]; p.day.a["c:" + U1] = { ag: 1 };
  const nd = VC.dayLog(p, "2026-10-03");
  check("day log: an aged-out mark { ag: 1 } is carried over midnight and nothing else changes", eq(nd.a["c:" + U1], { ag: 1 }) && eq(VC.bootProg(JSON.stringify(p), PACK).prog.day, p.day));
  let prev = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show 8023572:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_8023572.js"); fs.writeFileSync(f, src); prev = require(f);
  } catch(e){ prev = null; }
  if(!prev) skip("previous engine 8023572 not in this checkout's history");
  else {
    const pb = prev.bootProg(JSON.stringify(p), PACK);
    check("previous engine 8023572 boots it (new pack fields present, day log ag mark) with no backup, unit records and day log kept", pb.backupRaw === null && eq(pb.prog.chars.c, p.chars.c) && eq(pb.prog.day, p.day));
  }
}

console.log("\n[turn] characters.withWords Learn turn (chars.turn, fb2-write2): additive, kept by older engines");
{
  const b = mig("C mid-HSK2"); const at = (p, n, t) => Object.assign(clone(p), { sessions: n }, { chars: Object.assign({}, p.chars, t === undefined ? {} : { turn: t }) });
  const nx = p => (s => s ? s.kind : "done")(VC.nextStage(PACK, W, U, p));
  check("absent: session parity (even words, odd characters); turn \"c\" / \"w\" overrides parity both ways; any other value is parity",
    nx(at(b, 4)) === "words" && nx(at(b, 5)) === "chars" && nx(at(b, 4, "c")) === "chars" && nx(at(b, 5, "w")) === "words" && nx(at(b, 5, 7)) === "chars");
  const q = at(b, 4);
  check("learnTurnDone: words taught -> \"c\", characters taught -> \"w\"; not under \"later\" or without withWords",
    VC.learnTurnDone(q, PACK, "words") && q.chars.turn === "c" && VC.learnTurnDone(q, PACK, "chars") && q.chars.turn === "w"
    && !VC.learnTurnDone(VC.setCharOrder(at(b, 4), true), PACK, "words") && !VC.learnTurnDone(at(b, 4), (p => { const c = Object.assign({}, p.characters); delete c.withWords; return Object.assign({}, p, { characters: c }); })(PACK), "words"));
  const raw = JSON.stringify(at(b, 4, "c"));
  const nb = VC.bootProg(raw, PACK);
  check("boot keeps chars.turn, no backup, nothing rewritten", nb.backupRaw === null && nb.prog.chars.turn === "c" && JSON.stringify(nb.prog.chars) === JSON.stringify(JSON.parse(raw).chars));
  for(const sha of ["cc05012", "3d66aea"]){
    let eng = null;
    try {
      const cp = require("child_process"), os = require("os");
      const src = cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`); fs.writeFileSync(f, src); eng = require(f);
    } catch(e){ eng = null; }
    if(!eng){ skip(`engine ${sha} not in this checkout's history`); continue; }
    const ob = eng.bootProg(raw, PACK);
    check(`engine ${sha} boots progress with chars.turn: no backup, turn and unit records kept`, ob.backupRaw === null && ob.prog.chars.turn === "c" && eq(ob.prog.chars.c, JSON.parse(raw).chars.c));
  }
}

console.log("\n[order] characters order chars.order (R5, fb2-write2): first / with words / later; default fixed at load");
{
  const OFF = (p => { const c = Object.assign({}, p.characters); delete c.withWords; return Object.assign({}, p, { characters: c }); })(PACK);
  const recs = { [U[0].id]: { r: 1, w: 0, s: 1 } };
  const raw = o => JSON.stringify(Object.assign({ v: 1, w: {}, s: {}, sets: {} }, o));
  const ord = (o, pk) => VC.bootProg(raw(o), pk || PACK).prog.chars;
  check("default: fresh (defaultProg) and no chars field -> \"with\"", VC.defaultProg(PACK).chars.order === "with" && ord({}).order === "with" && ord({ chars: { c: {} } }).order === "with");
  check("default: unit records from before (old single stage) -> \"first\"", ord({ chars: { c: recs } }).order === "first" && mig("HEAD").chars.order === "first" && mig("C mid-HSK2").chars.order === "with");
  check("stored \"with\" / \"first\" kept whatever the records; any other value re-derived", ord({ chars: { c: recs, order: "with" } }).order === "with" && ord({ chars: { c: {}, order: "first" } }).order === "first" && ord({ chars: { c: recs, order: 3 } }).order === "first");
  check("defer: true stays \"later\" (wins over order); charOrder maps first / with / later", VC.charOrder(PACK, { chars: ord({ chars: { c: recs, defer: true } }) }) === "later"
    && VC.charOrder(PACK, { chars: { order: "first" } }) === "first" && VC.charOrder(PACK, { chars: {} }) === "with");
  const m = VC.setCharMode(VC.defaultProg(PACK), "later"); const m1 = m.chars.defer === true && m.chars.order === "with";
  VC.setCharMode(m, "first"); const m2 = m.chars.defer === false && m.chars.order === "first"; VC.setCharMode(m, "with");
  check("setCharMode: later sets defer only; first / with clear defer and set order", m1 && m2 && m.chars.order === "with" && m.chars.defer === false);
  check("without withWords no order field (flag-off shape)", !("order" in VC.defaultProg(OFF).chars) && !("order" in ord({ chars: { c: recs } }, OFF)));
  const nb = VC.bootProg(raw({ chars: { v: 1, c: recs, order: "first", turn: "w" } }), PACK);
  check("boot: no backup", nb.backupRaw === null);
  for(const sha of ["ea62a45", "3d66aea"]){
    let eng = null;
    try {
      const cp = require("child_process"), os = require("os");
      const src = cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`); fs.writeFileSync(f, src); eng = require(f);
    } catch(e){ eng = null; }
    if(!eng){ skip(`engine ${sha} not in this checkout's history`); continue; }
    for(const o of ["first", "with"]){
      const r = raw({ chars: { v: 1, c: recs, order: o, turn: "c" } }), ob = eng.bootProg(r, PACK);
      check(`engine ${sha} boots chars.order "${o}": no backup, order, turn and records kept`, ob.backupRaw === null && ob.prog.chars.order === o && ob.prog.chars.turn === "c" && eq(ob.prog.chars.c, recs));
    }
  }
}

console.log("\n[lag] characters.learn \"lag\" (fb3-lag): no stored field read or written; old order/turn/defer kept; older engines boot it");
{
  const LAG = LAG_PACK, OLDP = (p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; delete c.withWords; delete c.learn; return Object.assign({}, p, { characters: c }); })(clone(LAG_PACK));
  const cfg = VC.charsConfig(LAG);
  check("pack: zh ships characters.learn \"lag\"; withWords off under it; the stage-model pack has no learn", cfg.learn === "lag" && cfg.withWords === false && !("learn" in VC.charsConfig(PACK)) && LAG.characters.withWords === undefined);
  check("defaultProg: chars keys v,c,defer,choiceSeen,mix (no order, no turn: the flag-off shape)", eq(Object.keys(VC.defaultProg(LAG).chars), ["v", "c", "defer", "choiceSeen", "mix"]) && eq(VC.defaultProg(LAG).chars, VC.defaultProg(OLDP).chars));
  const sig = p => { const st = VC.nextStage(LAG, W, U, p); const cs = st && st.kind === "chars" ? VC.lagCharSet(LAG, W, U, p) : null; return st ? st.kind + ":" + (st.kind === "words" ? st.lv + "/" + st.set : cs.units.map(u => u.id).join(",")) : "done"; };
  // Stored fields of the stage model: every combination plans the same Learn, and boot keeps them.
  for(const seed of ["C mid-HSK2", "HEAD", "D1 chars started, card answered: start", "D2 chars started, card answered: skip"]){
    const base = mig(seed), want = sig(base);
    const vars = [{ order: "with" }, { order: "first" }, { order: "first", turn: "c" }, { order: "with", turn: "w" }, { defer: true }, { defer: true, choiceSeen: true, order: "first" }, { choiceSeen: false, defer: false }];
    const sigs = vars.map(v => sig(Object.assign(clone(base), { chars: Object.assign({}, base.chars, v) })));
    const kept = vars.every(v => { const raw = JSON.stringify(Object.assign(clone(base), { chars: Object.assign({}, base.chars, v) })), b = VC.bootProg(raw, LAG); return b.backupRaw === null && JSON.stringify(b.prog.chars) === JSON.stringify(JSON.parse(raw).chars); });
    check(`${seed}: Learn ${want.slice(0, 40)} whatever chars.order / turn / defer / choiceSeen (${vars.length} variants); boot keeps them byte-identical, no backup`, sigs.every(x => x === want) && kept);
  }
  const lt = VC.defaultProg(LAG);
  check("learnTurnDone writes nothing under lag; showCharChoice / charsUnlocked false; no 字 stage in the path", !VC.learnTurnDone(lt, LAG, "words") && !("turn" in lt.chars) && !VC.showCharChoice(LAG, W, U, mig("C mid-HSK2")) && !VC.charsUnlocked(LAG, W, mig("HEAD")) && !VC.stagePath(LAG, W, U, mig("HEAD")).some(s => s.kind === "chars"));
  // Progress this branch writes (records with holes, old fields kept) on older engines, and theirs here.
  const mine = mig("HEAD"); mine.chars.order = "first"; mine.chars.turn = "c";
  const ids = U.map(u => u.id); [3, 4, 5, 40, 41, 300].forEach(i => { delete mine.chars.c[ids[i]]; });
  for(let s = 0; s < 3; s++){ const st = VC.nextStage(LAG, W, U, mine); if(st.kind !== "chars") break; VC.lagCharSet(LAG, W, U, mine).units.forEach(u => { mine.chars.c[u.id] = { r: 1, w: 0, s: 1 }; }); }
  const mraw = JSON.stringify(mine);
  for(const [sha, pk] of [["590af86", PACK], ["ea62a45", PACK], ["3d66aea", OLDP]]){
    let eng = null;
    try {
      const cp = require("child_process"), os = require("os");
      const src = cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`); fs.writeFileSync(f, src); eng = require(f);
    } catch(e){ eng = null; }
    if(!eng){ skip(`engine ${sha} not in this checkout's history`); continue; }
    const ob = eng.bootProg(mraw, pk), st = eng.nextStage(pk, W, U, ob.prog), cs = st && st.kind === "chars" ? eng.nextCharSet(st.levels, U, pk, ob.prog) : null;
    // 3d66aea predates the recorded-unit filter in nextCharSet: a set with holes is taught whole there.
    const re = cs ? cs.units.filter(u => mine.chars.c[u.id]).length : 0;
    check(`engine ${sha} boots lag progress: no backup, records kept, next ${st ? st.kind : "done"}${cs ? `: ${cs.units.length - re} holes${re ? `, ${re} recorded (old set rule)` : ""}` : ""}`, ob.backupRaw === null && eq(ob.prog.chars.c, mine.chars.c) && !!st && (!cs || (cs.units.length > re && (re === 0 || sha === "3d66aea"))));
    const theirs = eng.bootProg(JSON.stringify(mig("D1 chars started, card answered: start")), pk).prog;
    if(eng.setCharMode) eng.setCharMode(theirs, "later");
    const back = VC.bootProg(JSON.stringify(theirs), LAG), cs2 = VC.lagCharSet(LAG, W, U, back.prog);
    check(`progress written by ${sha} boots here: no backup, records and fields kept; Learn ${sig(back.prog).slice(0, 30)}, nothing re-taught`, back.backupRaw === null && JSON.stringify(back.prog.chars) === JSON.stringify(theirs.chars) && (!cs2 || cs2.units.every(u => !theirs.chars.c[u.id])));
  }
}

console.log("\n[pause] pack.pauseNew (fb4-pause): one additive field prog.pause 1; older engines keep it; theirs boots here unpaused");
{
  const LAG = LAG_PACK, OLDP = (p => { const c = Object.assign({}, p.characters, { stages: [{ after: "3", levels: ["1", "2", "3"] }, { after: "4", levels: ["4"] }] }); delete c.bareBy; delete c.bareWords; delete c.withWords; delete c.learn; return Object.assign({}, p, { characters: c }); })(clone(LAG_PACK));
  const mine = VC.setPause(mig("HEAD"), true), raw = JSON.stringify(mine);
  const here = VC.bootProg(raw, LAG);
  check("this engine: paused progress boots with no backup, pause 1 kept, byte-identical", LAG.pauseNew === true && here.backupRaw === null && VC.pauseOn(LAG, here.prog) && JSON.stringify(here.prog) === raw);
  check("defaultProg has no pause field (absent = new material on)", !("pause" in VC.defaultProg(LAG)) && !VC.pauseOn(LAG, VC.defaultProg(LAG)));
  // 36aee02: main before pauseNew (the lag rule, live next); the rest as in [lag].
  for(const [sha, pk] of [["36aee02", LAG], ["590af86", PACK], ["ea62a45", PACK], ["3d66aea", OLDP]]){
    let eng = null;
    try {
      const cp = require("child_process"), os = require("os");
      const src = cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`); fs.writeFileSync(f, src); eng = require(f);
    } catch(e){ eng = null; }
    if(!eng){ skip(`engine ${sha} not in this checkout's history`); continue; }
    const ob = eng.bootProg(raw, pk), ref = eng.bootProg(JSON.stringify(mig("HEAD")), pk);
    const minus = p => { const q = clone(p); delete q.pause; return JSON.stringify(q); };
    check(`engine ${sha} boots paused progress: no backup, pause 1 kept (ignored), the rest as it boots the same progress unpaused`, ob.backupRaw === null && ob.prog.pause === 1 && minus(ob.prog) === JSON.stringify(ref.prog));
    const theirs = JSON.stringify(eng.bootProg(JSON.stringify(mig("D1 chars started, card answered: start")), pk).prog);
    const back = VC.bootProg(theirs, LAG);
    check(`progress written by ${sha} boots here unpaused, no backup, byte-equal (${theirs.length} chars)`, back.backupRaw === null && !VC.pauseOn(LAG, back.prog) && JSON.stringify(back.prog) === theirs);
  }
}

console.log("\n[bare5] zh characters.bare 6 -> 5 (fb10-weak-floor; owner 2026-10-03: pinyin removed too slowly): no field change, units at streak 5 read as bare");
{
  let eng = null, oldPack = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show 68930bd:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_68930bd.js"); fs.writeFileSync(f, src); eng = require(f);
    oldPack = JSON.parse(cp.execSync(`git -C "${ROOT}" show 68930bd:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  } catch(e){ eng = null; }
  if(!eng) skip("engine 68930bd not in this checkout's history");
  else {
    const seed = mig("HEAD"); const ids = Object.keys(seed.chars.c).slice(0, 30);
    ids.forEach((id, i) => { seed.chars.c[id] = { r: 7, w: 1, s: i < 14 ? 5 : 4 }; });
    const theirs = JSON.stringify(eng.bootProg(JSON.stringify(seed), oldPack).prog);
    const back = VC.bootProg(theirs, LAG_PACK);
    const at5 = ids.slice(0, 14), at4 = ids.slice(14);
    check(`pack bare ${LAG_PACK.characters.bare} here, ${oldPack.characters.bare} on 68930bd's pack`, LAG_PACK.characters.bare === 5 && oldPack.characters.bare === 6);
    check(`progress written by 68930bd boots here: no backup, unit records byte-equal (${Object.keys(back.prog.chars.c).length} units)`, back.backupRaw === null && JSON.stringify(back.prog.chars.c) === JSON.stringify(JSON.parse(theirs).chars.c));
    check("its 14 units at streak 5 are bare here (ruby on 68930bd); streak 4 stays ruby",
      at5.every(id => VC.charTier(back.prog.chars.c[id].s, LAG_PACK) === "bare" && eng.charTier(5, oldPack) === "ruby") && at4.every(id => VC.charTier(back.prog.chars.c[id].s, LAG_PACK) === "ruby"));
  }
}

console.log("\n[rotation-s] pack.readRotation (fb16): optional read.done s / ls (session of the latest pass / listening pass); older engines keep them; old records load");
{
  const RR = LAG_PACK;
  const old = { unlocked: { "1": 1 }, done: { p0001: { sc: 3, n: 5, d: "2026-09-01", x: 1 }, p0002: { sc: 5, n: 5, d: "2026-09-02", x: 2, l: 1 } } };
  const base = Object.assign(mig("HEAD"), { read: clone(old), sn: 6 });
  const bo = VC.bootProg(JSON.stringify(base), RR);
  check("records without s/ls boot unchanged here (no backup, nothing added)", RR.readRotation === true && bo.backupRaw === null && eq(bo.prog.read, old));
  const p = clone(bo.prog);
  VC.markPassageDone(p, "p0001", 4, 5, "2026-10-03", true, RR);
  VC.markPassageDone(p, "p0002", 5, 5, "2026-10-03", false, RR);
  check("this build writes s (and ls on a listening pass)", eq(p.read.done.p0001, { sc: 4, n: 5, d: "2026-10-03", x: 2, l: 1, s: 6, ls: 6 }) && eq(p.read.done.p0002, { sc: 5, n: 5, d: "2026-10-03", x: 3, l: 1, s: 6 }));
  { const q = clone(bo.prog); VC.markPassageDone(q, "p0002", 5, 5, "2026-10-03", false, RR); VC.markPassageDone(q, "p0001", 4, 5, "2026-10-03", false, RR); check("[l kept] readRotation: a reading pass keeps l of an earlier listening pass (p0002) and adds none to a never-listened record (p0001)", q.read.done.p0002.l === 1 && q.read.done.p0002.s === 6 && q.read.done.p0002.x === 3 && !("l" in q.read.done.p0001) && eq(q.read.done.p0001, { sc: 4, n: 5, d: "2026-10-03", x: 2, s: 6 })); }
  const raw = JSON.stringify(p);
  const here = VC.bootProg(raw, RR), im = VC.applyImport(null, raw, RR);
  check("s/ls survive boot and export/import byte-identical", here.backupRaw === null && JSON.stringify(here.prog) === raw && im.ok && eq(im.prog.read, p.read));
  const bad = JSON.stringify(Object.assign(clone(p), { read: { done: { p0001: { sc: 1, n: 5, d: "2026-09-27", x: 1, ls: "6" } } } }));
  check("a non-number ls is rejected by validation (boot keeps a backup)", VC.bootProg(bad, RR).backupRaw === bad);
  let eng = null, oldPack = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show 491d470:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_491d470.js"); fs.writeFileSync(f, src); eng = require(f);
    oldPack = JSON.parse(cp.execSync(`git -C "${ROOT}" show 491d470:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  } catch(e){ eng = null; }
  if(!eng) skip("engine 491d470 not in this checkout's history");
  else {
    const ob = eng.bootProg(raw, oldPack);
    check("engine 491d470 (its zh pack) boots progress with s/ls: no backup, read records byte-equal", ob.backupRaw === null && JSON.stringify(ob.prog.read) === JSON.stringify(p.read));
    const q = clone(ob.prog); eng.markPassageDone(q, "p0001", 5, 5, "2026-10-04", false);
    const back = VC.bootProg(JSON.stringify(q), RR);
    check("a pass on 491d470 drops s/ls from that record only; it boots here (no backup)", back.backupRaw === null && !("s" in back.prog.read.done.p0001) && !("ls" in back.prog.read.done.p0001) && back.prog.read.done.p0002.s === 6);
  }
}

console.log("\n[wordsBy] pack.wordsBy \"typed\" (fb18): word streak semantics only, no field added; records read on a8e9c08 unchanged; words at 3+ stay known");
{
  check(`zh ships wordsBy "typed" (${LAG_PACK.wordsBy})`, LAG_PACK.wordsBy === "typed" && VC.wordsTypedOn(LAG_PACK));
  const seed = mig("HEAD"); const ids = Object.keys(seed.w);
  const known0 = ids.filter(id => (seed.w[id].s || 0) >= VC.WORD_MASTERED);
  const ownerBoot = VC.bootProg(JSON.stringify(seed), LAG_PACK);
  check(`old progress boots here unchanged (no backup); its ${known0.length} words at streak 3+ stay known`, ownerBoot.backupRaw === null && JSON.stringify(ownerBoot.prog.w) === JSON.stringify(seed.w)
    && known0.every(id => ownerBoot.prog.w[id].s >= VC.WORD_MASTERED));
  const p = clone(ownerBoot.prog); const before = clone(p.w);
  const KINDS = ["recall", "read", "hear", "type"];
  ids.slice(0, 40).forEach((id, i) => { p.w[id].s = i % 6; if(i % 5 === 0) p.w[id].prov = 1; VC.markWordRec(p.w, id, i % 3 !== 0, KINDS[i % 4], undefined, LAG_PACK); VC.markWordRec(p.w, id, i % 4 !== 1, KINDS[(i + 1) % 4], undefined, LAG_PACK); });
  const keysOk = ids.every(id => Object.keys(p.w[id]).every(k => k in before[id] || k === "k" || k === "prov"));
  check("records written by this build keep the old fields and value ranges (r, w, s >= 0 integers; no new key)", keysOk && ids.every(id => ["r", "w", "s"].every(k => Number.isInteger(p.w[id][k]) && p.w[id][k] >= 0)) && VC.validateProgShape(p, Object.keys(p.sets)).ok);
  let eng = null, oldPack = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show a8e9c08:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_a8e9c08.js"); fs.writeFileSync(f, src); eng = require(f);
    oldPack = JSON.parse(cp.execSync(`git -C "${ROOT}" show a8e9c08:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  } catch(e){ eng = null; }
  if(!eng) skip("engine a8e9c08 not in this checkout's history");
  else {
    const raw = JSON.stringify(p), ob = eng.bootProg(raw, oldPack);
    check("engine a8e9c08 (its zh pack, no wordsBy) boots it: no backup, word records byte-equal", !("wordsBy" in oldPack) && ob.backupRaw === null && JSON.stringify(ob.prog.w) === JSON.stringify(p.w));
    const back = VC.bootProg(JSON.stringify(ob.prog), LAG_PACK);
    check("and back here: no backup, word records byte-equal", back.backupRaw === null && JSON.stringify(back.prog.w) === JSON.stringify(p.w));
  }
}

console.log("\n[progressMap] pack.progressMap (fb20): one optional top-level prog.pm [{sn, p}] (last 14 sessions); main a2f2426 keeps it on boot, no backup");
{
  const seed = mig("HEAD"); const pm = Array.from({ length: 14 }, (_, i) => ({ sn: 30 + i, p: Math.round((0.1 + 0.01 * i) * 1000) / 1000 }));
  check(`zh ships a progressMap goals ladder (${VC.progressMapGoals(LAG_PACK).length} goals)`, VC.progressMapGoals(LAG_PACK).length === 3 && VC.progressMapOn(LAG_PACK));
  const ob = VC.bootProg(JSON.stringify(seed), LAG_PACK);
  check("old progress (no pm) boots here unchanged: no backup, no pm added", ob.backupRaw === null && !("pm" in ob.prog));
  const p = clone(ob.prog); p.sn = 44; VC.recordProgressMap(p, LAG_PACK, [], [], []); p.pm = pm.slice();
  const raw = JSON.stringify(p), here = VC.bootProg(raw, LAG_PACK), im = VC.applyImport(null, raw, LAG_PACK);
  check("pm survives boot and export/import byte-identical", here.backupRaw === null && JSON.stringify(here.prog) === raw && im.ok && eq(im.prog.pm, pm));
  let eng = null, oldPack = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show a2f2426:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_a2f2426.js"); fs.writeFileSync(f, src); eng = require(f);
    oldPack = JSON.parse(cp.execSync(`git -C "${ROOT}" show a2f2426:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  } catch(e){ eng = null; }
  if(!eng) skip("engine a2f2426 not in this checkout's history");
  else {
    const o = eng.bootProg(raw, oldPack);
    check("engine a2f2426 (its zh pack, no progressMap) boots a record carrying pm: no backup, pm kept byte-equal", !("progressMap" in oldPack) && o.backupRaw === null && JSON.stringify(o.prog.pm) === JSON.stringify(pm) && JSON.stringify(o.prog) === raw);
    const back = VC.bootProg(JSON.stringify(o.prog), LAG_PACK);
    check("and back here: no backup, pm byte-equal", back.backupRaw === null && JSON.stringify(back.prog.pm) === JSON.stringify(pm));
  }
  // fb22: entries gain an optional g (goal index).
  const pmg = pm.map((e, i) => Object.assign({}, e, { g: i < 7 ? 0 : 1 })), pg = clone(p); pg.pm = pmg;
  const rawg = JSON.stringify(pg), hg = VC.bootProg(rawg, LAG_PACK), img = VC.applyImport(null, rawg, LAG_PACK);
  check("fb22: pm entries with g survive boot and export/import byte-identical", hg.backupRaw === null && JSON.stringify(hg.prog) === rawg && img.ok && eq(img.prog.pm, pmg));
  check("fb22: an fb20 record (pm without g) boots here with no backup, entries unchanged", (b => b.backupRaw === null && eq(b.prog.pm, pm))(VC.bootProg(raw, LAG_PACK)));
  for(const sha of ["a2f2426", "2412992"]){
    let e2 = null, op2 = null;
    try {
      const cp = require("child_process"), os = require("os");
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`);
      fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); e2 = require(f);
      op2 = JSON.parse(cp.execSync(`git -C "${ROOT}" show ${sha}:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
    } catch(e){ e2 = null; }
    if(!e2) { skip(`engine ${sha} not in this checkout's history`); continue; }
    const o = e2.bootProg(rawg, op2);
    check(`fb22: engine ${sha} boots a record whose pm entries carry g: no backup, record byte-equal`, o.backupRaw === null && JSON.stringify(o.prog) === rawg);
    const back = VC.bootProg(JSON.stringify(o.prog), LAG_PACK);
    check(`fb22: and back here from ${sha}: no backup, pm byte-equal`, back.backupRaw === null && JSON.stringify(back.prog.pm) === JSON.stringify(pmg));
  }
}

console.log("\n[optsF] pack.optsMix (fb21): optional record field f = session ordinal on word and unit records; main 2412992 keeps it on boot and on a mark, no backup");
{
  const seed = mig("HEAD"); const ob0 = VC.bootProg(JSON.stringify(seed), LAG_PACK);
  check("old progress (no f) boots here unchanged: no backup, no f added", ob0.backupRaw === null && Object.values(ob0.prog.w).every(r => !("f" in r)) && Object.values((ob0.prog.chars || {}).c || {}).every(r => !("f" in r)));
  const p = clone(ob0.prog); p.sn = 41; const wid = Object.keys(p.w)[0];
  p.w.w9998 = { r: 1, w: 0, s: 1, f: 40 }; p.w.w9999 = { r: 2, w: 1, s: 0, f: 41, k: "read" }; p.chars = p.chars || {}; p.chars.c = p.chars.c || {}; p.chars.c.c9998 = { r: 1, w: 0, s: 1, f: 40 }; p.chars.c.c9999 = { r: 0, w: 1, s: 0, f: 41 };
  const raw = JSON.stringify(p), here = VC.bootProg(raw, LAG_PACK), im = VC.applyImport(null, raw, LAG_PACK);
  check("records with f survive boot and export/import byte-identical", here.backupRaw === null && JSON.stringify(here.prog.w.w9998) === JSON.stringify(p.w.w9998) && JSON.stringify(here.prog.chars.c.c9999) === JSON.stringify(p.chars.c.c9999) && im.ok && eq(im.prog.w, p.w) && eq(im.prog.chars.c, p.chars.c));
  const badW = clone(p); badW.w.w9998.f = "40"; const badC = clone(p); badC.chars.c.c9998.f = null;
  check("validation: f must be a number on word and unit records", !VC.validateProgShape(badW, Object.keys(p.sets)).ok && !VC.validateProgShape(badC, Object.keys(p.sets)).ok && VC.validateProgShape(p, Object.keys(p.sets)).ok);
  let eng = null, oldPack = null;
  try {
    const cp = require("child_process"), os = require("os");
    const src = cp.execSync(`git -C "${ROOT}" show 2412992:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_2412992.js"); fs.writeFileSync(f, src); eng = require(f);
    oldPack = JSON.parse(cp.execSync(`git -C "${ROOT}" show 2412992:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  } catch(e){ eng = null; }
  if(!eng) skip("engine 2412992 not in this checkout's history");
  else {
    const o = eng.bootProg(raw, oldPack);
    check("engine 2412992 (its zh pack) boots records carrying f: no backup, progress byte-equal", o.backupRaw === null && JSON.stringify(o.prog) === raw);
    const q = clone(o.prog); eng.markRec(q.w, "w9998", true, true); eng.markChar(q, "c9998", false, oldPack, false);
    check("a mark on 2412992 keeps f on the record", q.w.w9998.f === 40 && q.w.w9998.r === 2 && q.chars.c.c9998.f === 40 && q.chars.c.c9998.w === 1);
    const back = VC.bootProg(JSON.stringify(q), LAG_PACK);
    check("and back here: no backup, f byte-equal", back.backupRaw === null && back.prog.w.w9998.f === 40 && back.prog.chars.c.c9998.f === 40);
  }
}

console.log("\n[pairs] pack.pairs (fb23): optional record field p = {wm|sm|ws: [pair streak, session]} on word and unit records; 2412992 and 3901e2e keep it on boot and on a mark, no backup");
{
  const seed = mig("HEAD"); const ob0 = VC.bootProg(JSON.stringify(seed), LAG_PACK);
  check("[pairs] old progress (no p) boots here unchanged: no backup, no p added", ob0.backupRaw === null && Object.values(ob0.prog.w).every(r => !("p" in r)) && Object.values((ob0.prog.chars || {}).c || {}).every(r => !("p" in r)));
  const p = clone(ob0.prog); p.sn = 41;
  p.w.w9998 = { r: 3, w: 1, s: 2, u: 40, p: { wm: [0, 41], sm: [2, 39] } }; p.w.w9999 = { r: 2, w: 0, s: 2, f: 30, p: { ws: [3, 40] } };
  p.chars = p.chars || {}; p.chars.c = p.chars.c || {}; p.chars.c.c9998 = { r: 4, w: 0, s: 4, u: 41, p: { wm: [2, 41], ws: [1, 40] } };
  const raw = JSON.stringify(p), here = VC.bootProg(raw, LAG_PACK), im = VC.applyImport(null, raw, LAG_PACK);
  check("[pairs] records with p survive boot and export/import byte-identical; validateProgShape accepts p", here.backupRaw === null && eq(here.prog.w, p.w) && eq(here.prog.chars.c, p.chars.c) && im.ok && eq(im.prog.w, p.w) && VC.validateProgShape(p, Object.keys(p.sets)).ok);
  const odd = clone(p); odd.w.w9998.p = "x"; odd.chars.c.c9998.p = { wm: ["2", 1], zz: 4 };
  const ob = VC.bootProg(JSON.stringify(odd), LAG_PACK);
  check("[pairs] a malformed p never resets progress (no backup) and reads as no pair", ob.backupRaw === null && ob.prog.w.w9998.p === "x" && VC.pairState(ob.prog.w.w9998, "wm").boot && VC.pairState(ob.prog.chars.c.c9998, "wm").boot);
  for(const sha of ["2412992", "3901e2e"]){
    let eng = null, op = null;
    try {
      const cp = require("child_process"), os = require("os");
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`);
      fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); eng = require(f);
      op = JSON.parse(cp.execSync(`git -C "${ROOT}" show ${sha}:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
    } catch(e){ eng = null; }
    if(!eng){ skip(`[pairs] engine ${sha} not in this checkout's history`); continue; }
    const o = eng.bootProg(raw, op);
    check(`[pairs] engine ${sha} (its zh pack) boots records carrying p: no backup, progress byte-equal`, o.backupRaw === null && JSON.stringify(o.prog) === raw);
    const q = clone(o.prog); eng.markRec(q.w, "w9998", true, true); eng.markChar(q, "c9998", false, op, false);
    check(`[pairs] a mark on ${sha} keeps p on the record`, eq(q.w.w9998.p, p.w.w9998.p) && q.w.w9998.r === 4 && eq(q.chars.c.c9998.p, p.chars.c.c9998.p) && q.chars.c.c9998.w === 1);
    const back = VC.bootProg(JSON.stringify(q), LAG_PACK);
    check(`[pairs] and back here from ${sha}: no backup, p byte-equal`, back.backupRaw === null && eq(back.prog.w.w9998.p, p.w.w9998.p) && eq(back.prog.chars.c.c9998.p, p.chars.c.c9998.p));
  }
}

console.log("\n[freqTiers] pack.freqTiers (fb26): no new stored field; records written under the flag (peripheral pair at 2 by choice, settled prov, counter by learned count) boot on b21ee93 and 2412992 byte-equal, and back");
{
  const TW = WORDS.filter(w => w.ft === 2).slice(0, 2).concat(WORDS.filter(w => w.ft === 0).slice(0, 1));
  const p = VC.bootProg(JSON.stringify(mig("C mid-HSK2")), LAG_PACK).prog; p.sn = 42;
  TW.forEach((w, i) => {
    const r = VC.ensureWordRec(p, WORDS, LAG_PACK, w.id);
    VC.markRec(p.w, w.id, true, true);
    VC.notePair(r, "wm", true, false, 42, r.s, false, VC.wordTier(w, LAG_PACK));
    VC.notePair(r, "wm", true, false, 42, r.s, false, VC.wordTier(w, LAG_PACK));
    if(i === 0) r.prov = 1;
    VC.settleProv(r, w, LAG_PACK);
  });
  VC.levelIds(LAG_PACK).forEach(lv => VC.settleSetCounter(p, WORDS, LAG_PACK, lv));
  const KNOWN = new Set(["r", "w", "s", "u", "f", "p", "prov", "d"]);
  check(`[freqTiers] records written under the flag carry no new field (${TW.map(w => w.w + " ft" + w.ft).join(", ")}: ${TW.map(w => Object.keys(p.w[w.id]).join("/")).join(", ")})`,
    TW.every(w => Object.keys(p.w[w.id]).every(k => KNOWN.has(k))) && Object.keys(p).every(k => k in mig("C mid-HSK2") || k in VC.defaultProg(LAG_PACK) || ["sn", "chars"].includes(k)));
  const raw = JSON.stringify(p);
  for(const sha of ["b21ee93", "2412992"]){
    let eng = null, op = null;
    try {
      const cp = require("child_process"), os = require("os");
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`);
      fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); eng = require(f);
      op = JSON.parse(cp.execSync(`git -C "${ROOT}" show ${sha}:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
    } catch(e){ eng = null; }
    if(!eng){ skip(`[freqTiers] engine ${sha} not in this checkout's history`); continue; }
    const o = eng.bootProg(raw, op);
    check(`[freqTiers] engine ${sha} (its zh pack) boots a record written under the flag: no backup, progress byte-equal`, o.backupRaw === null && JSON.stringify(o.prog) === raw);
    const back = VC.bootProg(JSON.stringify(o.prog), LAG_PACK);
    check(`[freqTiers] and back here from ${sha}: no backup, progress byte-equal`, back.backupRaw === null && JSON.stringify(back.prog) === raw);
  }
}

console.log("\n[patterns] pack.patterns (fb29): optional top-level prog.pt = {patternId: {s, a}}; b21ee93 and 2412992 keep it on boot and on a mark, no backup");
{
  const seed = mig("HEAD"); const ob0 = VC.bootProg(JSON.stringify(seed), LAG_PACK);
  check("[patterns] old progress (no pt) boots here unchanged: no backup, no pt added", ob0.backupRaw === null && !("pt" in ob0.prog));
  const p = clone(ob0.prog); p.sn = 41; p.pt = { p01: { s: 2, a: 40 }, p14: { s: 0, a: 41 } };
  const raw = JSON.stringify(p), here = VC.bootProg(raw, LAG_PACK), im = VC.applyImport(null, raw, LAG_PACK);
  check("[patterns] a record with pt survives boot and export/import byte-identical; validateProgShape accepts pt", here.backupRaw === null && eq(here.prog.pt, p.pt) && im.ok && eq(im.prog.pt, p.pt) && VC.validateProgShape(p, Object.keys(p.sets)).ok);
  const odd = clone(p); odd.pt = { p01: "x", p02: { s: -1, a: "b" } };
  const ob = VC.bootProg(JSON.stringify(odd), LAG_PACK);
  check("[patterns] a malformed pt never resets progress (no backup) and reads as never answered", ob.backupRaw === null && eq(ob.prog.pt, odd.pt) && VC.patternState(ob.prog, "p01").fresh && VC.patternState(ob.prog, "p02").fresh);
  for(const sha of ["b21ee93", "2412992"]){
    let eng = null, op = null;
    try {
      const cp = require("child_process"), os = require("os");
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`);
      fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); eng = require(f);
      op = JSON.parse(cp.execSync(`git -C "${ROOT}" show ${sha}:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
    } catch(e){ eng = null; }
    if(!eng){ skip(`[patterns] engine ${sha} not in this checkout's history`); continue; }
    const o = eng.bootProg(raw, op);
    check(`[patterns] engine ${sha} (its zh pack) boots a record carrying pt: no backup, progress byte-equal`, o.backupRaw === null && JSON.stringify(o.prog) === raw);
    const q = clone(o.prog); eng.markRec(q.w, Object.keys(q.w)[0], true, true);
    check(`[patterns] a mark on ${sha} keeps pt`, eq(q.pt, p.pt));
    const back = VC.bootProg(JSON.stringify(q), LAG_PACK);
    check(`[patterns] and back here from ${sha}: no backup, pt byte-equal`, back.backupRaw === null && eq(back.prog.pt, p.pt));
  }
}

console.log("\n[bareByPair] characters.bareByPair (fb31): no stored field; it reads the pair streaks pairs writes. Records a pair-bare unit (wm and ws at 2, fb35) carries boot here and on 3044601 byte-equal, and back");
{
  const p = VC.bootProg(JSON.stringify(mig("C mid-HSK2")), LAG_PACK).prog; p.sn = 43;
  const uid = Object.keys(p.chars.c)[0];
  const U = { id: uid, words: [Object.keys(p.w)[0]] };
  p.chars.c[uid] = { r: 5, w: 1, s: 3, u: 43, p: { wm: [2, 43], ws: [2, 43] } };
  const raw = JSON.stringify(p), here = VC.bootProg(raw, LAG_PACK);
  check("[bareByPair] zh pack sets characters.bareByPair; a ruby unit with wm 2 and ws 2 reads bare; boot here: no backup, progress byte-equal, no field added", LAG_PACK.characters.bareByPair === true && VC.pairBare(here.prog.chars.c[uid], U, here.prog, LAG_PACK) && here.backupRaw === null && JSON.stringify(here.prog) === raw);
  let eng = null, op = null;
  try {
    const cp = require("child_process"), os = require("os");
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), "core_3044601.js");
    fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show 3044601:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); eng = require(f);
    op = JSON.parse(cp.execSync(`git -C "${ROOT}" show 3044601:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  } catch(e){ eng = null; }
  if(!eng) skip("[bareByPair] engine 3044601 not in this checkout's history");
  else {
    const o = eng.bootProg(raw, op), o2 = eng.bootProg(raw, LAG_PACK);
    check("[bareByPair] engine 3044601 boots them (its zh pack, and this pack with the new fields): no backup, progress byte-equal", o.backupRaw === null && JSON.stringify(o.prog) === raw && o2.backupRaw === null && JSON.stringify(o2.prog) === raw);
    const back = VC.bootProg(JSON.stringify(o.prog), LAG_PACK);
    check("[bareByPair] and back here: no backup, byte-equal", back.backupRaw === null && JSON.stringify(back.prog) === raw);
  }
}

console.log("\n[pv] pack.progressView (fb37): optional top-level prog.pv = {sn, m, co, p}; 806ad57 and 3044601 boot it unchanged, no backup, and back");
{
  const p = VC.bootProg(JSON.stringify(mig("C mid-HSK2")), LAG_PACK).prog; p.pv = { sn: 12, m: 40, co: 3, p: 1 };
  const raw = JSON.stringify(p), here = VC.bootProg(raw, LAG_PACK), im = VC.applyImport(null, raw, LAG_PACK);
  check("[pv] boot here keeps pv byte-equal, no backup; export/import keeps it; validateProgShape accepts it", here.backupRaw === null && JSON.stringify(here.prog) === raw && im.ok && eq(im.prog.pv, p.pv) && VC.validateProgShape(p, Object.keys(p.sets)).ok);
  const odd = clone(p); odd.pv = "x"; const ob = VC.bootProg(JSON.stringify(odd), LAG_PACK);
  check("[pv] a malformed pv never resets progress (no backup) and reads as no visit", ob.backupRaw === null && ob.prog.pv === "x" && VC.progressVisit(ob.prog) === null);
  for(const sha of ["806ad57", "3044601"]){
    let eng = null, op = null;
    try {
      const cp = require("child_process"), os = require("os");
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`);
      fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })); eng = require(f);
      op = JSON.parse(cp.execSync(`git -C "${ROOT}" show ${sha}:packs/zh/pack.json`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
    } catch(e){ eng = null; }
    if(!eng){ skip(`[pv] engine ${sha} not in this checkout's history`); continue; }
    const o = eng.bootProg(raw, op), o2 = eng.bootProg(raw, LAG_PACK);
    check(`[pv] engine ${sha} boots a record carrying pv (its zh pack, and this pack with progressView): no backup, progress byte-equal`, o.backupRaw === null && JSON.stringify(o.prog) === raw && o2.backupRaw === null && JSON.stringify(o2.prog) === raw);
    const q = clone(o.prog); eng.markRec(q.w, Object.keys(q.w)[0], true, true);
    check(`[pv] a mark on ${sha} keeps pv`, eq(q.pv, p.pv));
    const back = VC.bootProg(JSON.stringify(q), LAG_PACK);
    check(`[pv] and back here from ${sha}: no backup, pv byte-equal`, back.backupRaw === null && eq(back.prog.pv, p.pv));
  }
}


(async () => {
console.log("\n[port] the generic flag set G on the 13 sibling packs (.cache/briefs/port-plan.md sections 1 and 3): no field is new beyond the pairs / dayAware / progress-map family; sibling engines ef44c6e and aa00571 boot it unchanged");
{
  const PS = require("./lib/port_sim.js"), cp = require("child_process"), os = require("os");
  const OLD = ["ef44c6e", "aa00571"].map(sha => {
    try {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mig-")), `core_${sha}.js`);
      fs.writeFileSync(f, cp.execSync(`git -C "${ROOT}" show ${sha}:engine/core.js`, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
      return { sha, eng: require(f) };
    } catch(e){ return { sha, eng: null }; }
  });
  const SANS = new Set(["r", "w", "s", "t", "u", "prov", "d"]);
  const sans = rec => { const o = {}; Object.keys(rec || {}).forEach(k => { if(!SANS.has(k)) o[k] = rec[k]; }); return o; };
  const legacyBoot = s => (s >= 3 ? 3 : Math.min(s, 2));
  for(const lang of PS.SIBLINGS){
    const site = PS.loadSibling(lang);
    if(!site){ skip(`[port] ${lang}: ../${lang}/pack/*.js not present`); continue; }
    const G = PS.withG(site), L = `[port] ${lang}`;
    const seed = PS.legacySeed(VC, site, 150, 7);
    // old engines boot a record written under G byte-equal, a mark keeps every new field, and back on main
    const boots = (raw, prog, L) => {
        for(const { sha, eng } of OLD){
          if(!eng){ skip(`${L}: engine ${sha} not in this checkout's history`); continue; }
          const o = eng.bootProg(raw, site.pack);
          check(`${L}: engine ${sha} boots a record written under G: no _invalid/_reset backup, progress byte-equal after its own save`, o.backupRaw === null && JSON.stringify(o.prog) === raw);
          const q = clone(o.prog), id = Object.keys(q.w).find(k => q.w[k].p);
          eng.markRec(q.w, id, true, true);
          const others = Object.keys(q).filter(k => k !== "w").every(k => eq(q[k], prog[k])) && Object.keys(q.w).filter(k => k !== id).every(k => eq(q.w[k], prog.w[k]));
          check(`${L}: a mark on ${sha} keeps every new field (p, f, day, pm, pv, read.done s / ls) and every other record`, others && eq(sans(q.w[id]), sans(prog.w[id])) && eq(q.w[id].p, prog.w[id].p));
          const back = VC.bootProg(JSON.stringify(q), G.pack);
          check(`${L}: and back on main from ${sha}: no backup, progress byte-equal`, back.backupRaw === null && JSON.stringify(back.prog) === JSON.stringify(q));
        }
    };
    let sim = null, err = null;
    const run = () => PS.playSessions(site, G.pack, G.words, seed, { sessions: 8, acc: 0.85, seed: 11 });
    await run().then(r => { sim = r; }, e => { err = e; }).then(() => {
      if(err || !sim){ check(`${L}: 8 seeded sessions at 85% under G play to the end (${err ? err.message.slice(0, 160) : "no result"})`, false); return; }
      const raw = sim.raw, prog = JSON.parse(raw), recs = Object.values(prog.w);
      const done = Object.values((prog.read || {}).done || {});
      check(`${L}: 8 sessions at 85% under G (${sim.stat.items} items, ${Math.round(100 * sim.stat.right / sim.stat.items)}% right) write p on ${recs.filter(r => r.p).length} words, day/sn/pm/pv, read.done s and ls, session key only`,
        recs.some(r => r.p) && prog.day !== undefined && typeof prog.sn === "number" && Array.isArray(prog.pm) && prog.pv && done.some(d => typeof d.s === "number") && done.some(d => typeof d.ls === "number") && sim.keys.length === 1);
      boots(raw, prog, L);
      // pre-port record (legacy streaks, no p)
      const lraw = JSON.stringify(seed), lm = VC.bootProg(lraw, G.pack), lo = OLD[0].eng ? OLD[0].eng.bootProg(lraw, site.pack) : null;
      const bad = [];
      G.words.forEach(w => { const r = lm.prog.w[w.id]; if(!r) return; VC.wordPairs(w, G.pack).forEach(pr => { const st = VC.pairState(r, pr); if(!st.boot || st.s !== legacyBoot(r.s || 0)) bad.push(w.id + ":" + pr); }); });
      check(`${L}: a pre-port record (legacy streaks, no p) boots here unchanged and every word pair bootstraps from its streak (3 from 3, else min(s, 2)), none written`, lm.backupRaw === null && JSON.stringify(lm.prog) === lraw && bad.length === 0 && Object.values(lm.prog.w).every(r => !("p" in r)));
      if(!lo){ skip(`${L}: known count needs engine ef44c6e`); return; }
      const oldKnown = G.words.filter(w => (lo.prog.w[w.id] || {}).s >= OLD[0].eng.WORD_MASTERED).length;
      const noTiers = Object.assign(clone(G.pack), { freqTiers: false }), mainPairs = G.words.filter(w => VC.wordKnown(lm.prog.w[w.id], w, noTiers)).length;
      const mainTiers = G.words.filter(w => VC.wordKnown(lm.prog.w[w.id], w, G.pack)).length;
      const surplus = G.words.filter(w => w.ft === 2 && lm.prog.w[w.id] && lm.prog.w[w.id].s === 2).length;
      check(`${L}: known count on the pre-port record: old engine ${oldKnown} = main with pairs ${mainPairs}; with freqTiers ${mainTiers} = ${oldKnown} + ${surplus} peripheral words at streak 2`, oldKnown === mainPairs && mainTiers === oldKnown + surplus);
    });
    // script primer sites: a run that learns the primer writes prog.script.u records (t/u) beside the word records
    if(site.script){
      let ss = null, serr = null;
      await PS.playSessions(site, G.pack, G.words, seed, { sessions: 8, acc: 0.85, seed: 11, script: "learn" }).then(r => { ss = r; }, e => { serr = e; });
      const LS = `${L} (primer learned)`;
      if(serr || !ss){ check(`${LS}: 8 seeded sessions at 85% under G play to the end (${serr ? serr.message.slice(0, 160) : "no result"})`, false); }
      else {
        const sraw = ss.raw, sprog = JSON.parse(sraw), su = (sprog.script || {}).u || {}, sids = Object.keys(su);
        check(`${LS}: ${sids.length} script records written (t on ${sids.filter(i => typeof su[i].t === "number").length}, u on ${sids.filter(i => typeof su[i].u === "number").length}), session key only`,
          sids.length > 0 && sids.some(i => typeof su[i].t === "number") && sids.some(i => typeof su[i].u === "number") && ss.keys.length === 1);
        boots(sraw, sprog, LS);
        for(const { sha, eng } of OLD){
          if(!eng) continue;
          const q = clone(eng.bootProg(sraw, site.pack).prog), id = sids.find(i => su[i].u !== undefined) || sids[0];
          eng.markRec(q.script.u, id, true, true);
          const keep = Object.keys(q).filter(k => k !== "script").every(k => eq(q[k], sprog[k])) && Object.keys(q.script.u).filter(k => k !== id).every(k => eq(q.script.u[k], su[k]));
          check(`${LS}: a mark on script unit ${id} on ${sha} keeps every other record and the unit's own non-streak fields, and back on main it is byte-equal`,
            keep && eq(sans(q.script.u[id]), sans(su[id])) && JSON.stringify(VC.bootProg(JSON.stringify(q), G.pack).prog) === JSON.stringify(q));
        }
      }
    }
  }
}
})().then(() => {
console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
}, e => { console.log(e.stack); process.exit(1); });
