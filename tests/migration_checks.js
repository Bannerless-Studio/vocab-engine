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
// The sections before [lag] check the stage model (withWords, as on main 590af86); zh ships
// characters.learn "lag" since fb3-lag, checked against the same records in [lag].
const LAG_PACK = readJSON("pack.json"), WORDS = readJSON("words.json"), LEGACY = readJSON("legacy.json");
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
  const bs = n => Object.assign(clone(b), { sessions: n });
  check(`(b) mid HSK 2: old pack ${nextOf(OLD, b)}; now no card, sessions alternate ${nextOf(PACK, bs(4))} / ${nextOf(PACK, bs(5))}`, nextOf(OLD, b) === "words:2/3" && nextOf(PACK, bs(4)) === "words:2/3" && nextOf(PACK, bs(5)) === "chars:1 c0001" && !VC.showCharChoice(PACK, W, U, b));
  // Stored choice mapping: chars.defer true ("after") is "later"; anything else is "with words".
  // The alternation reads prog.sessions only: no new field.
  check("(b) stored choice: defer true -> later (HSK 2 set 3 every session, one 字 stage last); seen + defer false or unseen -> with words",
    [4, 5].every(n => (p => nextOf(PACK, p) === "words:2/3" && VC.stagePath(PACK, W, U, p).filter(s => s.kind === "chars").length === 1)(VC.setCharOrder(bs(n), true)))
    && nextOf(PACK, VC.answerCharChoice(bs(5), true)) === "chars:1 c0001" && nextOf(PACK, bs(5)) === "chars:1 c0001"
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
  check("(c) unit records untouched by boot (streaks 3-5 stay, 6+ stay bare)", JSON.stringify(VC.bootProg(craw, PACK).prog.chars.c) === recsBefore);
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
  for(const [sha, pk] of [["590af86", PACK], ["ea62a45", PACK], ["3d66aea", OLDP]]){
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

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
