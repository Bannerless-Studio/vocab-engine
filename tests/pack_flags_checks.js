"use strict";
// tests/lib/pack_flags.js: the FLAG_SINCE table stays complete and true for the kept flags, and packAsOf reproduces the
// flag set the committed zh pack had at the commit before each flag landed. The flag collapse (COLLAPSED: engine default,
// key ignored) holds across the tooling: no generator emits a collapsed key, tools/pack_collapsed.py mirrors the list, and
// tools/validate_pack.py warns on a stale one.
// Run: node tests/pack_flags_checks.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const os = require("os");
const { spawnSync } = require("child_process");
const { FLAG_SINCE, COLLAPSED, COLLAPSED_DATA, packAsOf, packBefore, stripFlags, isAncestor } = require("./lib/pack_flags.js");

const ROOT = path.join(__dirname, "..");
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, "packs", "zh", "pack.json"), "utf8"));
const git = args => execFileSync("git", ["-C", ROOT].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });

let passes = 0, fails = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}`); if (extra) console.log("    " + String(extra).replace(/\n/g, "\n    ")); }
}

// pack.json fields that are not flags: identity, tuning and layout every pack carries
const BASE_KEYS = ["key", "name", "tts", "ttsRate", "levels", "setSize", "placement", "functionWords", "typing", "showPron", "hasLessons", "spaced", "compounds", "legacy"];
const flagKeys = new Set(FLAG_SINCE.map(f => f.key));
const topFlags = new Set(FLAG_SINCE.map(f => f.path[0]));

check("table: keys unique", flagKeys.size === FLAG_SINCE.length);
check("table: nested entries sit under a top-level flag that is also listed", FLAG_SINCE.filter(f => f.path.length > 1).every(f => flagKeys.has(f.path[0])));
check("table: key equals path joined by a dot", FLAG_SINCE.every(f => f.key === f.path.join(".")));

const unknown = Object.keys(PACK).filter(k => !BASE_KEYS.includes(k) && !topFlags.has(k));
check("packs/zh/pack.json: every top-level key is a base field or in FLAG_SINCE (a new flag needs a row)", unknown.length === 0, "not in FLAG_SINCE: " + unknown.join(", "));
const unknownChars = Object.keys(PACK.characters || {}).filter(k => ["label", "stages", "setSize", "mastered", "bare", "learnKinds", "reviewKinds", "testKinds", "compose", "withWords"].indexOf(k) < 0 && !flagKeys.has("characters." + k));
check("packs/zh/pack.json: every characters.* key is a base field or in FLAG_SINCE", unknownChars.length === 0, "not in FLAG_SINCE: " + unknownChars.join(", "));

const bad = FLAG_SINCE.filter(f => { try { return !isAncestor(f.sha, "HEAD"); } catch (e) { return true; } });
check("every FLAG_SINCE sha is an ancestor of HEAD", bad.length === 0, bad.map(f => f.key + "@" + f.sha).join(", "));

// every flag a suite names (strip / keep lists, stripFlags, packBefore) is a table key
const named = new Set();
fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && f !== "pack_flags_checks.js").forEach(f => {
  const src = fs.readFileSync(path.join(__dirname, f), "utf8");
  (src.match(/\b(?:strip|keep): \[[^\]]*\]/g) || []).forEach(m => (m.match(/"[^"]+"/g) || []).forEach(q => named.add(q.slice(1, -1))));
  (src.match(/stripFlags\([^,]+, \[[^\]]*\]/g) || []).forEach(m => (m.match(/"[^"]+"/g) || []).forEach(q => named.add(q.slice(1, -1))));
  (src.match(/packBefore\([^;]*/g) || []).forEach(m => (m.match(/"[^"]+"/g) || []).forEach(q => { const k = q.slice(1, -1); if (!/\.js$|^PACK$/.test(k)) named.add(k); }));
});
const stray = [...named].filter(k => !flagKeys.has(k));
check("every flag a suite strips, keeps or packs before is in FLAG_SINCE", stray.length === 0, "not in FLAG_SINCE: " + stray.join(", "));

// the committed zh pack is the generator's output at that commit: the flag keys it carries must be the ones packAsOf leaves
const flagPresent = (p, f) => { let o = p; for (const k of f.path) { if (!o || typeof o !== "object" || !(k in o)) return false; o = o[k]; } return true; };
const shas = [...new Set(FLAG_SINCE.map(f => f.sha))];
const mismatches = [];
let probed = 0;
shas.forEach(sha => {
  ["~1", ""].forEach(suffix => {
    let old;
    try { old = JSON.parse(git(["show", sha + suffix + ":packs/zh/pack.json"])); } catch (e) { return; }
    probed++;
    const mine = packAsOf(PACK, sha + suffix);
    const want = FLAG_SINCE.filter(f => flagPresent(old, f)).map(f => f.key).sort().join(" ");
    const got = FLAG_SINCE.filter(f => flagPresent(mine, f)).map(f => f.key).sort().join(" ");
    // a flag the current pack no longer carries cannot be compared; only flags present now are judged
    const cur = f => flagPresent(PACK, f);
    const wantNow = FLAG_SINCE.filter(f => flagPresent(old, f) && cur(f)).map(f => f.key).sort().join(" ");
    if (wantNow !== got) mismatches.push(`${sha}${suffix}: committed pack has [${want}], packAsOf gives [${got}]`);
  });
});
check(`packAsOf(pack, sha) carries the flag keys the committed zh pack had at ${probed} probed commits (each flag sha and its parent)`, probed > 0 && mismatches.length === 0, mismatches.join("\n"));

// Sibling drift: a language repo's pack.json may not grow a top-level key (against its own committed pack) unless the key is
// a FLAG_SINCE flag or on this allow list; otherwise the pack_drift goldens' strip list (tests/flagoff_snapshot.js) would miss
// it and hash a new field.
const SIBLINGS = ["arabic", "french", "german", "hindi", "indonesian", "italian", "japanese", "korean", "persian", "russian", "spanish", "swahili", "urdu"];
const SIBLING_ALLOW = [];
const unlistedNewKeys = (work, committed) => Object.keys(work).filter(k => !(k in committed) && !topFlags.has(k) && !SIBLING_ALLOW.includes(k));
check("sibling drift rule: a new unlisted key is caught, a FLAG_SINCE key and an allow-listed one pass", (() => {
  const u = unlistedNewKeys({ key: "x", levelExam: {}, bogusNew: 1 }, { key: "x" });
  return u.length === 1 && u[0] === "bogusNew";
})());
SIBLINGS.forEach(lang => {
  const dir = path.join(ROOT, "..", lang);
  if (!fs.existsSync(path.join(dir, "pack", "pack.json"))) { console.log(`SKIP  ../${lang}/pack/pack.json not present`); return; }
  let committed;
  try { committed = JSON.parse(execFileSync("git", ["-C", dir, "show", "HEAD:pack/pack.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 })); }
  catch (e) { console.log(`SKIP  ../${lang}: no committed pack/pack.json at HEAD`); return; }
  const work = JSON.parse(fs.readFileSync(path.join(dir, "pack", "pack.json"), "utf8"));
  const u = unlistedNewKeys(work, committed);
  check(`../${lang}/pack/pack.json: every key added since its committed pack is in FLAG_SINCE or SIBLING_ALLOW`, u.length === 0, "not listed: " + u.join(", "));
});

const first = packBefore(PACK, "characters");
check("packBefore(first flag): no flag key left", FLAG_SINCE.every(f => !flagPresent(first, f)));
check("packAsOf(pack, HEAD) is the pack unchanged", JSON.stringify(packAsOf(PACK, "HEAD")) === JSON.stringify(PACK));
check("packAsOf never mutates its input", (() => { const c = JSON.stringify(PACK); packAsOf(PACK, "3044601"); stripFlags(PACK, ["pairs"]); return JSON.stringify(PACK) === c; })());
check("keep leaves a newer flag on; strip drops an older one", (() => {
  const p = packAsOf(PACK, "3044601", { keep: ["levelExam"], strip: ["typedFrom"] });
  return "levelExam" in p && !("typedFrom" in p) && !("eta" in p);
})());
check("stripFlags removes a nested flag and keeps its siblings", (() => {
  const p = stripFlags(PACK, ["characters.start"]);
  return !("start" in p.characters) && "ramp" in p.characters && "learn" in p.characters;
})());
check("stripFlags with a parent and a child removes both", (() => { const p = stripFlags(PACK, ["characters", "characters.start"]); return !("characters" in p); })());
check("an unknown sha throws a message naming it", (() => { try { packAsOf(PACK, "deadbeef0000000"); return false; } catch (e) { return /deadbeef0000000/.test(e.message) && /history/.test(e.message); } })());
check("an unknown flag in packBefore throws", (() => { try { packBefore(PACK, "noSuchFlag"); return false; } catch (e) { return /noSuchFlag/.test(e.message); } })());

// ---- the flag collapse: FLAG_SINCE holds kept flags only; the collapsed keys are gone from every generator
const FLAG_ONLY = COLLAPSED.filter(k => !COLLAPSED_DATA.includes(k));
check("FLAG_SINCE lists kept flags only (a collapsed key has no row; progressMap stays as goals data)", FLAG_SINCE.every(f => !FLAG_ONLY.includes(f.key)) && COLLAPSED_DATA.every(k => flagKeys.has(k)), FLAG_SINCE.filter(f => FLAG_ONLY.includes(f.key)).map(f => f.key).join(", "));
check("packs/zh/pack.json (tools/pack_from_hsk.py output) carries no collapsed key", FLAG_ONLY.every(k => !(k in PACK)), FLAG_ONLY.filter(k => k in PACK).join(", "));
const TOOLS = path.join(ROOT, "tools");
const py = (code, args) => spawnSync("python3", ["-c", code].concat(args || []), { cwd: TOOLS, encoding: "utf8", maxBuffer: 1 << 26 });
const LANG_CODES = fs.readdirSync(path.join(TOOLS, "packbuilder", "langs")).filter(f => /^[a-z]{2}\.py$/.test(f)).map(f => f.slice(0, 2));
const probe = py(`
import json, sys
sys.path.insert(0, ".")
from pack_collapsed import COLLAPSED
from packbuilder.core import enrich
from packbuilder.langs import get_spec
codes = sys.argv[1].split(",")
print(json.dumps({"collapsed": list(COLLAPSED), "port_keys": list(enrich.PORT_KEYS), "flags": {c: sorted(get_spec(c, load=False).port_flags()) for c in codes}}))
`, [LANG_CODES.join(",")]);
let tool = null; try { tool = JSON.parse(probe.stdout); } catch (e) { tool = null; }
check(`python probe of tools/ ran (${LANG_CODES.length} language specs)`, !!tool && LANG_CODES.length >= 13, (probe.stderr || "").slice(-600));
if (tool) {
  check("tools/pack_collapsed.py COLLAPSED = tests/lib/pack_flags.js COLLAPSED less COLLAPSED_DATA (as sets)", JSON.stringify(tool.collapsed.slice().sort()) === JSON.stringify(FLAG_ONLY.slice().sort()), JSON.stringify(tool.collapsed));
  check("enrich PORT_KEYS names no collapsed key", tool.port_keys.every(k => !COLLAPSED.includes(k) || COLLAPSED_DATA.includes(k)), tool.port_keys.join(", "));
  const emitted = Object.entries(tool.flags).map(([c, ks]) => [c, ks.filter(k => FLAG_ONLY.includes(k))]).filter(([, ks]) => ks.length);
  check(`no LanguageSpec.port_flags() emits a collapsed key (${Object.keys(tool.flags).join(" ")})`, emitted.length === 0, emitted.map(([c, ks]) => c + ": " + ks.join(",")).join("; "));
}
// validate_pack.py: a stale collapsed key warns (exit 0), a goal-less progressMap: true warns, a pack without eta errors
{
  const ZH = path.join(ROOT, "packs", "zh");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-stale-"));
  const run = pack => {
    const d = path.join(tmp, "pack"); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d);
    fs.readdirSync(ZH).forEach(f => fs.copyFileSync(path.join(ZH, f), path.join(d, f)));
    fs.writeFileSync(path.join(d, "pack.json"), JSON.stringify(pack, null, 1));
    // the generated pack.js must match pack.json, or the validator reports it stale
    execFileSync("python3", [path.join(TOOLS, "jsonify_pack.py"), d], { stdio: ["ignore", "pipe", "pipe"] });
    const r = spawnSync("python3", [path.join(TOOLS, "validate_pack.py"), d], { encoding: "utf8", maxBuffer: 1 << 26 });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  try {
    const stale = Object.assign(JSON.parse(JSON.stringify(PACK)), Object.fromEntries(FLAG_ONLY.map(k => [k, true])));
    const a = run(stale), line = (a.out.match(/WARN\s+pack\.json keys the engine no longer reads[^\n]*/) || [""])[0];
    check(`validate_pack: every stale collapsed key warns in one line, exit 0 (exit ${a.code})`, a.code === 0 && FLAG_ONLY.every(k => new RegExp("\\b" + k + "\\b").test(line)), a.out.split("\n").filter(l => /ERR|no longer reads/.test(l)).join("\n"));
    const b = run(Object.assign(JSON.parse(JSON.stringify(PACK)), { progressMap: true }));
    check(`validate_pack: progressMap: true (no goals) warns, exit 0 (exit ${b.code})`, b.code === 0 && /WARN\s+pack\.progressMap: true is ignored/.test(b.out), b.out.split("\n").filter(l => /ERR|progressMap/.test(l)).join("\n"));
    const noEta = JSON.parse(JSON.stringify(PACK)); delete noEta.eta;
    const c = run(noEta);
    check(`validate_pack: a pack without eta is an error (exit ${c.code})`, c.code !== 0 && /pack\.eta is required/.test(c.out), c.out.split("\n").filter(l => /ERR/.test(l)).join("\n"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
