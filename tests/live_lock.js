"use strict";
// Behaviour lock for the flag collapse (TODO.md "Flag collapse"): every live pack, as shipped (all flags on), booted headless on a fixed set of
// records; Today / Progress / Words text, the 3-session drill traces, the first reveals, the ETA numbers, the level gate and the passage pick go
// into tests/golden/live_lock_<lang>.json. The collapse stages left these byte-equal; the collapse is done, so a pack booted without every
// collapsed key (--strip) must equal them too.
//   node tests/live_lock.js --capture            write the goldens (explained commit only)
//   node tests/live_lock.js --check              compare, first differing path per pack; exit 1 on a difference
//   node tests/live_lock.js --check --strip       boot with every COLLAPSED key removed (tests/lib/pack_flags.js; progressMap keeps its goals): exit 1 on a difference
//   node tests/live_lock.js --check --strip a,b   boot with only the named COLLAPSED keys removed: exit 1 on a difference
//   --lang a,b limits the packs. Sibling packs come from ../<lang>/pack, or LANG_REPOS_DIR, or the nearest parent directory that holds them.
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const S = require("./lib/port_sim.js");
const { COLLAPSED, COLLAPSED_DATA, stripCollapsed, stripFlags } = require("./lib/pack_flags.js");

const ROOT = path.join(__dirname, "..");
const GOLDEN_DIR = path.join(__dirname, "golden");
const VC = require(path.join(ROOT, "engine", "core.js"));
const LANGS = S.SIBLINGS.concat(["chinese"]).sort();

// the worktree this runs from may not sit beside the language repos
if (!process.env.LANG_REPOS_DIR) {
  for (let d = path.join(ROOT, ".."); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "japanese", "pack", "pack.js"))) { process.env.LANG_REPOS_DIR = d; break; }
    if (path.dirname(d) === d) break;
  }
}

const argv = process.argv.slice(2);
const CAPTURE = argv.includes("--capture"), CHECK = argv.includes("--check"), STRIP = argv.includes("--strip");
// --strip a,b (or --strip=a,b): the partial strip of a collapse stage; every name must be a COLLAPSED key
const stripArg = (argv.find(a => a.startsWith("--strip=")) || "").slice(8) || (STRIP && argv[argv.indexOf("--strip") + 1] && !argv[argv.indexOf("--strip") + 1].startsWith("--") ? argv[argv.indexOf("--strip") + 1] : "");
const STRIP_KEYS = stripArg ? stripArg.split(",").filter(Boolean) : null;
if (STRIP_KEYS && STRIP_KEYS.some(k => !COLLAPSED.includes(k))) { console.error("--strip: not COLLAPSED keys: " + STRIP_KEYS.filter(k => !COLLAPSED.includes(k)).join(", ")); process.exit(2); }
const only = (argv.find(a => a.startsWith("--lang=")) || "").slice(7) || (argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1] : "");
if (CAPTURE === CHECK || ((STRIP || STRIP_KEYS) && !CHECK)) { console.error("usage: node tests/live_lock.js --capture | --check [--strip] [--lang a,b]"); process.exit(2); }

const clone = x => JSON.parse(JSON.stringify(x));
const text = html => String(html == null ? "" : html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
// floats to 6 places: a reordered sum must not read as a behaviour change
const round = x => typeof x === "number" ? Math.round(x * 1e6) / 1e6 : Array.isArray(x) ? x.map(round) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)])) : x;
// A record is too big to keep whole (the stored ones run to 150 KB): per top-level key a hash and, for a map, its size, so a diff still names the key.
const sha = o => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const fingerprint = prog => Object.fromEntries(Object.keys(prog).sort().map(k => { const v = prog[k]; return [k, v && typeof v === "object" ? { n: Object.keys(v).length, sha: sha(v) } : v]; }));
function seeded(seed, fn) { const o = Math.random; Math.random = S.mulberry32(seed); try { return fn(); } finally { Math.random = o; } }

// ETA, gate and reading numbers of a record, read off core with the same arguments app.html passes
function derived(site, pack, prog) {
  const p = VC.normalizeProg(clone(prog), pack), units = site.characters || [], passages = site.passages || [];
  const ctx = { pack, words: site.words, units, passages };
  return seeded(7, () => {
    const cg = VC.currentGoal(p, pack, site.words, units, passages);
    const hold = VC.levelGateHold(site.words, pack, p, units), sg = VC.suggestPassage(passages, site.words, pack, p);
    return round({
      goals: VC.progressMapGoals(pack).map(g => g.upTo),
      positions: VC.goalPositions(p, pack, site.words, units, passages),
      toGo: VC.progressMapGoals(pack).map((g, i) => VC.sessionsToGoX(p, i, undefined, ctx)),
      toGoTotal: VC.sessionsToGoX(p),
      currentGoal: cg && { i: cg.i, n: cg.n, p: cg.p, all: cg.all },
      eta: VC.sessionsToGoX(p, cg ? cg.i : undefined, cg ? cg.n : undefined, ctx),
      gateHold: hold, gateNote: VC.levelGateNote(site.words, pack, p, units), gateOpensIn: VC.levelOpensIn(site.words, pack, p, units),
      suggestPassage: sg && { id: sg.id, lv: sg.lv },
      position: VC.progressPosition(p, pack, site.words, units, passages),
    });
  });
}

function placed(site, pack, mode, withUnits) {
  const st = VC.strata(site.words, pack.placement, VC.setSizeOf(pack)), half = Math.ceil(st.length / 2);
  const res = st.map((b, i) => { const n = VC.placementItemCount(i, pack); return { r: mode === "full" || i < half ? n : 0, n }; });
  const stop = VC.placementStopIndex(res, pack.placementWhole === true ? { whole: true } : undefined);
  return VC.applyPlacement(VC.defaultProg(pack), st, stop == null ? st.length : stop, site.words, pack, withUnits ? (site.characters || []) : []);
}

// first level fully taught but 25% known: the level gate holds the next level
function gated(site, pack) {
  const p = VC.defaultProg(pack), lv0 = VC.levelIds(pack)[0], list = VC.wordsByLevel(site.words, pack)[lv0];
  p.placedOnce = true; p.sessions = 20; p.sets[lv0] = VC.nSets(list, VC.setSizeOf(pack));
  list.forEach((w, i) => { p.w[w.id] = { r: 1, w: i % 3 ? 0 : 1, s: i % 4 === 0 ? 3 : 1 }; });
  return p;
}

// Words tab: the level buttons, the set label and the rows of the set each shows (the segmentation freqTiers and the set counter decide)
function wordsCapture(api) {
  api.clickTab("words");
  const html = api.el("wbody").innerHTML, out = { text: text(html), levels: [] };
  const ids = [...html.matchAll(/id="wl_([^"]+)"/g)].map(m => m[1]);
  ids.forEach(lv => {
    api.el("wl_" + lv).click();
    const h = api.el("wbody").innerHTML, rows = api.el("wl") ? api.el("wl").children : [];
    out.levels.push({ lv, set: (text(h).match(/Set \d+ of \d+( ✓)?/) || [null])[0], rows: rows.length, first: rows.slice(0, 10).map(r => text(r.innerHTML)) });
  });
  api.clickTab("today");
  return out;
}

async function captureRecord(site, pack, name, seedProg, seed) {
  const rec = { record: name, seed: fingerprint(VC.normalizeProg(clone(seedProg), pack)), derivedBefore: derived(site, pack, seedProg), todayFirst: null, today: [], progress: {}, words: {}, trace: [[], [], []], reveals: [] };
  try {
    const hook = (ev, api, i) => {
      if (ev === "pre" && i.sn === 0) rec.todayFirst = text(api.panel());
      else if (ev === "today") {
        rec.today[i.sn] = text(api.panel());
        if (i.sn === 0) { api.clickTab("progress"); rec.progress.start = text(api.panel()); api.clickTab("today"); rec.words.start = wordsCapture(api); }
      } else if (ev === "answered") {
        const it = api.getCur(); rec.trace[i.sn].push(String(it.kind) + ":" + String(it.key));
        if (i.sn === 0 && rec.reveals.length < 5) rec.reveals.push({ key: String(it.key), kind: it.kind, html: api.el("rv") ? api.el("rv").innerHTML : null });
      } else if (ev === "end" && i.sn === 2) {
        api.clickTab("progress"); rec.progress.end = text(api.panel()); api.clickTab("today"); rec.words.end = wordsCapture(api);
      }
    };
    const r = await S.playSessions(site, pack, site.words, seedProg, { sessions: 3, seed, hook });
    const fin = JSON.parse(r.raw); rec.final = fingerprint(fin); rec.derivedAfter = derived(site, pack, fin);
    rec.items = r.stat;
  } catch (e) { rec.error = String(e && e.message || e).slice(0, 400); }
  return rec;
}

async function captureLang(lang) {
  const site = S.loadSibling(lang);
  if (!site) return null;
  const pack = STRIP_KEYS ? stripFlags(site.pack, STRIP_KEYS.filter(k => !COLLAPSED_DATA.includes(k))) : STRIP ? stripCollapsed(site.pack) : clone(site.pack);
  const start = Object.assign(VC.defaultProg(pack), { placedOnce: true });
  const recs = [["fresh", VC.defaultProg(pack), 1]];
  // mid-course: 12 sessions played by the engine itself on one simulated day each, 85% right
  let midErr = null, mid = null;
  try { mid = JSON.parse((await S.playSessions(site, pack, site.words, start, { sessions: 12, seed: 12 })).raw); } catch (e) { midErr = String(e.message).slice(0, 300); }
  if (mid) recs.push(["mid12", mid, 2]); else recs.push(["mid12", start, 2]);
  recs.push(["placedMid", placed(site, pack, "mid", false), 3], ["placedFull", placed(site, pack, "full", false), 4]);
  recs.push(["gated", gated(site, pack), 6]);
  if (site.characters) recs.push(["placedChars", placed(site, pack, "mid", true), 5]);
  const out = { lang, packKey: pack.key, words: site.words.length, midError: midErr, records: [] };
  for (const [name, prog, seed] of recs) out.records.push(await captureRecord(site, pack, name, prog, seed));
  return out;
}

const dump = o => JSON.stringify(o, null, 1) + "\n";
function firstDiff(a, b, p) {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return { path: p, golden: a, now: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path: p, golden: "array/object", now: "object/array" };
  const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))];
  for (const k of keys) { const d = k in a && k in b ? firstDiff(a[k], b[k], p + "/" + k) : { path: p + "/" + k, golden: k in a ? "present" : "absent", now: k in b ? "present" : "absent" }; if (d) return d; }
  return null;
}
const short = v => { const s = typeof v === "string" ? v : JSON.stringify(v); return s === undefined ? "undefined" : s.length > 160 ? s.slice(0, 160) + "..." : s; };

(async () => {
  // collapsed keys are top-level pack keys (stripFlags drops an unlisted top-level key by name)
  const bad = COLLAPSED.filter(k => k.includes("."));
  if (bad.length) { console.log("FAIL  COLLAPSED keys must be top-level: " + bad.join(", ")); process.exit(1); }
  const t0 = Date.now(), langs = LANGS.filter(l => !only || only.split(",").includes(l));
  let equal = 0, differ = 0, missing = 0, total = 0;
  for (const lang of langs) {
    const t1 = Date.now(), cap = await captureLang(lang);
    if (!cap) { console.log(`SKIP  ${lang}: no ../${lang}/pack`); missing++; continue; }
    total++;
    const file = path.join(GOLDEN_DIR, "live_lock_" + lang + ".json"), cur = dump(cap), sec = ((Date.now() - t1) / 1000).toFixed(1);
    if (CAPTURE) { fs.mkdirSync(GOLDEN_DIR, { recursive: true }); fs.writeFileSync(file, cur); console.log(`WROTE ${lang}  ${(cur.length / 1024).toFixed(0)} KB  ${sec}s${cap.records.some(r => r.error) ? "  ERRORS: " + cap.records.filter(r => r.error).map(r => r.record + ": " + r.error).join(" | ") : ""}`); continue; }
    if (!fs.existsSync(file)) { console.log(`FAIL  ${lang}: no golden ${path.relative(ROOT, file)}`); differ++; continue; }
    const gold = fs.readFileSync(file, "utf8");
    if (gold === cur) { equal++; console.log(`EQUAL ${lang}  ${sec}s`); continue; }
    differ++;
    const d = firstDiff(JSON.parse(gold), JSON.parse(cur), "");
    console.log(`DIFF  ${lang}  ${d ? d.path : "(bytes only)"}\n        golden: ${d ? short(d.golden) : ""}\n        now:    ${d ? short(d.now) : ""}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0) + "s";
  if (CAPTURE) console.log(`\ncaptured ${total} packs, ${secs}`);
  else if (STRIP_KEYS) console.log(`\nstrip ${STRIP_KEYS.length} keys: ${equal} passed, ${differ + missing} failed (${equal}/${total} packs equal, ${secs})`);
  else if (STRIP) console.log(`\nstrip all ${COLLAPSED.length} collapsed keys: ${equal} passed, ${differ + missing} failed (${equal}/${total} packs equal, ${secs})`);
  else console.log(`\n${equal} passed, ${differ + missing} failed (${equal}/${total} packs equal, ${secs})`);
  process.exit(CAPTURE || (!differ && !missing) ? 0 : 1);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
