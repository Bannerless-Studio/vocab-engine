// fb10-weak-floor changed the dayAware planner on purpose (owner 2026-10-03: weak words were not
// practised in production; docs/PACK_SCHEMA.md "dayAware" Kinds / Planning): a production answer
// settles any miss, a weak-word floor right after the misses, misses pending longest first, a kind
// that settles every pending kind first. Byte-identical controls against an older main (pause,
// lag, optsMix, typed mastery) run that main's core.js with these rules applied, so they still
// prove everything else unchanged. Each rule must match exactly once, or this throws.
"use strict";
const path = require("path");
const VC = require(path.join(__dirname, "..", "engine", "core.js"));

const MS = `(x => { const e = d.a[x.key]; return isObj(e) && typeof e.ms === "number" ? e.ms : Infinity; })`;
const RULES = [
  ["return !m.length || m.includes(kind) || (dayProd(kind) && m.some(dayProd)); }",
   "return !m.length || m.includes(kind) || dayProd(kind); }"],
  ["  take(T[0], Math.max(1, Math.floor(n * DAY_MISS_SHARE))); take(C,",
   `  const isW = c => String(c.key).startsWith("w:");\n  take(T[0], Math.max(1, Math.floor(n * DAY_MISS_SHARE))); take(T[1].filter(isW), Math.round(n * ${VC.DAY_WEAK_FLOOR}) - out.filter(isW).length); take(C,`],
  ["\n    (a, b) => weakScore(b.rec) - weakScore(a.rec),\n",
   `\n    (a, b) => (${MS}(a) - ${MS}(b)) || weakScore(b.rec) - weakScore(a.rec),\n`],
  ["    return fit.find(k => !r.includes(k)) || fit[0] || planned;",
   "    const all = fit.filter(k => mk.every(m => SETTLES));\n    return all.find(k => !r.includes(k)) || all[0] || fit.find(k => !r.includes(k)) || fit[0] || planned;"],
];
// Mains before typed mastery (7fe35f7) have daySettles only.
const settles = src => src.includes("const daySettlesAt") ? "daySettlesAt(key, [m], k, can)" : "daySettles([m], k, can)";
module.exports = function withDayRules(src, sha){
  return RULES.reduce((s, [a, b]) => {
    const n = s.split(a).length - 1;
    if(n !== 1) throw new Error(`day_rules_patch: ${n} matches in ${sha || "core.js"} for ${JSON.stringify(a.slice(0, 60))}`);
    return s.replace(a, () => b.replace("SETTLES", settles(src)));
  }, src);
};
