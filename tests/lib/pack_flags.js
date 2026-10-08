"use strict";
// One table of every pack-gated flag and the engine sha that introduced it. Flag-off control tests
// build the pack an old engine shipped with packAsOf(pack, PINNED_SHA) instead of keeping their own
// delete lists: a new pack flag is appended here once and every pinned control strips it.
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// sha = first commit on main's history carrying the flag in packs/zh/pack.json (or the schema doc for
// flags the zh pack does not use). Order = time order; append new flags at the end.
const FLAG_SINCE = [
  { key: "characters", sha: "1753d44", path: ["characters"] },
  { key: "pronFirst", sha: "6e8fec5", path: ["pronFirst"] },
  { key: "script", sha: "c394f7b", path: ["script"] },
  { key: "tones", sha: "3343dcb", path: ["tones"] },
  { key: "soundsReference", sha: "3343dcb", path: ["soundsReference"] },
  { key: "audio", sha: "e5ebb11", path: ["audio"] },
  { key: "typedFrom", sha: "5f5fd1f", path: ["typedFrom"] },
  { key: "glossFocus", sha: "5f5fd1f", path: ["glossFocus"] },
  { key: "dayAware", sha: "eac9960", path: ["dayAware"] },
  { key: "pauseNew", sha: "173c0e7", path: ["pauseNew"] },
  { key: "helpClose", sha: "266adae", path: ["helpClose"] },
  { key: "readAnswerBlock", sha: "2562b98", path: ["readAnswerBlock"] },
  { key: "optsOneScript", sha: "e957fe7", path: ["optsOneScript"] },
  { key: "optsMix", sha: "8bba19e", path: ["optsMix"] },
  { key: "characters.learn", sha: "f004799", path: ["characters", "learn"] },
  { key: "characters.bareBy", sha: "a2159fa", path: ["characters", "bareBy"] },
  { key: "characters.bareWords", sha: "a2159fa", path: ["characters", "bareWords"] },
  { key: "listenQuestions", sha: "6c067b4", path: ["listenQuestions"] },
  { key: "rereadPerfectDays", sha: "812511a", path: ["rereadPerfectDays"] },
  { key: "readRotation", sha: "82fb371", path: ["readRotation"] },
  { key: "wordsBy", sha: "240f127", path: ["wordsBy"] },
  { key: "progressMap", sha: "8dc8fd6", path: ["progressMap"] },
  { key: "pairs", sha: "9eb6ecb", path: ["pairs"] },
  { key: "characters.start", sha: "a20398c", path: ["characters", "start"] },
  { key: "characters.ramp", sha: "a20398c", path: ["characters", "ramp"] },
  { key: "freqTiers", sha: "4fa1f38", path: ["freqTiers"] },
  { key: "progressView", sha: "633820d", path: ["progressView"] },
  { key: "levelGate", sha: "a2dd814", path: ["levelGate"] },
  { key: "levelExam", sha: "a2dd814", path: ["levelExam"] },
  { key: "patterns", sha: "b41a85b", path: ["patterns"] },
  { key: "glossStyle", sha: "34c5df3", path: ["glossStyle"] },
  { key: "patternCue", sha: "34c5df3", path: ["patternCue"] },
  { key: "characters.bareByPair", sha: "34c5df3", path: ["characters", "bareByPair"] },
  { key: "appView", sha: "d39eda2", path: ["appView"] },
  { key: "eta", sha: "77e046a", path: ["eta"] },
  { key: "pronUntilPrimer", sha: "a6f2cc5", path: ["pronUntilPrimer"] },
  { key: "placementWhole", sha: "c44a6c8", path: ["placementWhole"] },
  { key: "gapGender", sha: "cd94707", path: ["gapGender"] },
];

const byKey = new Map(FLAG_SINCE.map(f => [f.key, f]));
const ancestorCache = new Map();

function git(args) { return execFileSync("git", ["-C", ROOT].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }

function requireInHistory(sha) {
  try { git(["cat-file", "-e", sha + "^{commit}"]); }
  catch (e) { throw new Error("pack_flags: sha " + sha + " is not in this repo's history (fetch it or fix the pin)"); }
}

// true when `ancestor` is an ancestor of (or equal to) `sha`; one git call per pair
function isAncestor(ancestor, sha) {
  const k = ancestor + ">" + sha;
  if (ancestorCache.has(k)) return ancestorCache.get(k);
  requireInHistory(sha); requireInHistory(ancestor);
  let r;
  try { git(["merge-base", "--is-ancestor", ancestor, sha]); r = true; }
  catch (e) { if (e.status === 1) r = false; else throw e; }
  ancestorCache.set(k, r);
  return r;
}

function removePath(obj, p) {
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) { o = o && o[p[i]]; if (!o || typeof o !== "object") return; }
  if (o) delete o[p[p.length - 1]];
}

// deep copy of `pack` without the named flags (keys of FLAG_SINCE; a top-level pack key not in the table
// is accepted too, for fields older than any flag that a test drops on purpose)
function stripFlags(pack, keys) {
  const out = JSON.parse(JSON.stringify(pack));
  // sub-keys first: a parent removed earlier would hide them
  keys.slice().sort((a, b) => b.split(".").length - a.split(".").length).forEach(k => {
    const f = byKey.get(k);
    removePath(out, f ? f.path : k.split("."));
  });
  return out;
}

// deep copy of `pack` as it shipped at `sha`: every flag introduced after `sha` removed.
// opts.keep: newer flags to leave on; opts.strip: extra keys to drop (isolation, not age).
function packAsOf(pack, sha, opts) {
  const o = opts || {};
  const keep = new Set(o.keep || []);
  const drop = FLAG_SINCE.filter(f => !keep.has(f.key) && !isAncestor(f.sha, sha)).map(f => f.key);
  return stripFlags(pack, drop.concat(o.strip || []));
}

// pack as it was just before flag `key` landed (the suite's feature-era pack); same opts as packAsOf
function packBefore(pack, key, opts) {
  const f = byKey.get(key);
  if (!f) throw new Error("pack_flags: unknown flag " + key);
  return packAsOf(pack, f.sha + "~1", opts);
}

module.exports = { FLAG_SINCE, packAsOf, packBefore, stripFlags, isAncestor };
