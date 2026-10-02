// Node checks for migrateLegacy in engine/core.js (hsk_pinyin -> vocab_zh, docs/HSK_MERGE.md §4)
// and tools/diff_hsk_migration.js. Synthetic hsk records: seeds A-E plus every hsk record
// version shape (v1, v2, v2.1, v2.2, HEAD), idempotence, the unmapped list, rejections.
// Where the hsk checkout sits beside this repo (../chinese, formerly ../hsk), each seed is also checked against
// hsk's own validateProgShape and the tool's derived-view diff; otherwise those are skipped.
// Run: node tests/migration_checks.js     (no dependencies)
"use strict";
const fs = require("fs");
const path = require("path");
const util = require("util");

const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const { diffMigration } = require(path.join(ROOT, "tools", "diff_hsk_migration.js"));
const ZH = path.join(ROOT, "packs", "zh");
const HSK = process.env.HSK_DIR || path.join(ROOT, "..", "chinese");
const readJSON = f => JSON.parse(fs.readFileSync(path.join(ZH, f), "utf8"));
const PACK = readJSON("pack.json"), WORDS = readJSON("words.json"), LEGACY = readJSON("legacy.json");
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

// hanzi per level, in pack (= hsk VOCAB) order.
const hanziOf = {}; Object.keys(LEGACY.w).forEach(h => { hanziOf[LEGACY.w[h]] = h; });
const byLv = { 1:[], 2:[], 3:[], 4:[] };
WORDS.forEach(w => byLv[w.lv].push(hanziOf[w.id]));
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
check("C mid-HSK2: next stage is HSK 2 set 3", (s => s && s.kind === "words" && s.lv === "2" && s.set === 3)(VC.nextStage(PACK, W, U, mig("C mid-HSK2"))));
check("HEAD (HSK 1-3 done, card unanswered): choice card shows", VC.showCharChoice(PACK, W, U, mig("HEAD")) === true);
check("D1 (answered start): no card, next stage is characters 1-3", !VC.showCharChoice(PACK, W, U, mig("D1 chars started, card answered: start"))
  && (s => s && s.kind === "chars" && eq(s.levels, ["1","2","3"]))(VC.nextStage(PACK, W, U, mig("D1 chars started, card answered: start"))));
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
  check("a later reading pass replaces the record without l", eq(p.read.done.p0001, { sc: 5, n: 5, d: "2026-10-05", x: 3 }));
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
  // A new key, never a new progress field: the record lives in sessionStorage beside the
  // progress key and is never read by boot, migration, import or export.
  const SK = VC.sessionKey(PACK);
  check(`session key ${SK} differs from the progress, legacy, legacy-backup and progress-backup keys`,
    SK === "vocab_zh_session" && new Set([SK, VC.storageKey(PACK), PACK.legacy.key, VC.legacyBackupKey(PACK), ...["invalid_backup", "pre_import_backup", "reset_backup"].map(x => `${VC.storageKey(PACK)}_${x}`)]).size === 7);
  const p = mig("C mid-HSK2"), raw = JSON.stringify(p);
  const b = VC.bootProg(raw, PACK);
  check("migrated progress boots unchanged with no session field (the session record is never part of it)", b.backupRaw === null && eq(b.prog, VC.normalizeProg(p, PACK)) && !Object.keys(b.prog).some(k => /^session(?!s$)/.test(k)));
  check("a session record is not a legacy record", !VC.isLegacyRecord(PACK, LEGACY, { v: VC.SESSION_VERSION, build: "x", t: 0, fp: "0", tab: "today" }));
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
    eq(VC.dayLog(z, next), { d: next, n: 0, a: { ["w:" + ZW[0]]: { mk: ["recall"] }, ["w:" + ZW[1]]: { r: ["hear"], u: 1 } } }));
  z.sn = 1 + VC.DAY_RECENT_SESSIONS + 1;
  check(`after ${VC.DAY_RECENT_SESSIONS} more sessions only the miss carries`, eq(VC.dayLog(z, next).a, { ["w:" + ZW[0]]: { mk: ["recall"] } }));
  check("a miss carried for days stays tier 0 until settled", VC.dayTier({ key: "w:" + ZW[0], kinds: ["recall"] }, VC.dayLog(z, "2026-10-09"), z.sn) === 0);
  VC.dayStart(z, PACK, "2026-10-09", true); VC.noteDay(z, PACK, "2026-10-09", "w:" + ZW[0], "hear", true);
  check("an easier kind days later still does not settle it", eq(z.day.a["w:" + ZW[0]].mk, ["recall"]));
  VC.noteDay(z, PACK, "2026-10-09", "w:" + ZW[0], "type", true);
  check("a production kind settles a production miss days later", !("mk" in z.day.a["w:" + ZW[0]]));
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

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
