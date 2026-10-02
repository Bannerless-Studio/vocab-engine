#!/usr/bin/env node
// zh gloss build step, run by tools/pack_from_hsk.py (docs/PACK_SCHEMA.md "Synonyms" and
// "noTypedMeaning"; report docs/ZH_GLOSS.md). Reads the words pack_from_hsk.py built from the
// hsk vocabulary as JSON on stdin and writes JSON to stdout:
//   { en: {id: gloss}, syn: {id: [ids]}, typedSyn: {id: [ids]}, noTypedMeaning: [ids] }
//   en              tools/zh_gloss_overrides.json "en" (each must still match its "was")
//   syn             words sharing an accepted typed meaning: a glossAltKeys key (the key
//                   checkGlossTyped matches with, so a gloss the learner may type for one word
//                   is never a wrong option for the other) or a reviewed "synonyms" group.
//   typedSyn        typed answers also right on this word's meaning stimulus: words whose gloss
//                   has this word's first meaning (register labels ignored), minus the reviewed
//                   "notTyped" pairs, plus "synonyms" groups marked "typed": true. A group without
//                   "typed" is syn only.
//   noTypedMeaning  words whose first alternative is an explanation (particle, classifier,
//                   marker, bracket-only, "...right?"), adjusted by "noTypedMeaning" add/remove
// The keys come from engine/core.js itself, so the build and the matcher cannot disagree.
// Usage: node tools/zh_gloss.js [--report docs/ZH_GLOSS.md] < words.json
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const VC = require(path.join(ROOT, "engine", "core.js"));
const OVERRIDES = path.join(__dirname, "zh_gloss_overrides.json");

const GRAMMAR = /\b(?:particle|classifier|measure word|marker|prefix|suffix)\b|^used\b|\bindicating\b/i;
const alts = en => VC.splitTopLevel(String(en || ""), [";", ","]).map(a => a.trim()).filter(Boolean);
function explanatory(alt){
  if(VC.isPronNote(alt)) return true;
  const rest = VC.parenGroups(alt).rest.trim();
  return !rest || /^(?:\.\.\.|…)/.test(rest) || GRAMMAR.test(rest);
}
function noTypedRule(en){
  const a = alts(en);
  // Glosses lead with the core sense, so a leading explanation ("(classifier for books); this")
  // means the word's main use has no English to type.
  return a.length > 0 && (explanatory(a[0]) || keysOf(en).size === 0);
}
function audit(en){
  const keys = [...VC.glossAltKeys(en)], a = alts(en);
  const f = [];
  if(/…|\.\.\.\s*$/.test(en)) f.push("truncated");
  if(a.some(x => GRAMMAR.test(VC.parenGroups(x).rest))) f.push("explanatory");
  if(a.length && a.every(x => !VC.parenGroups(x).rest.trim())) f.push("bracket-only");
  if(keys.length && Math.min(...keys.map(k => k.length)) > 14) f.push("long");
  if(a.length >= 5) f.push("5+ alternatives");
  return f;
}

const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, "packs", "zh", "pack.json"), "utf8"));
// The matcher's keys for this pack (copula rule included), so build and matcher agree.
const keysOf = en => VC.glossAltKeys(en, PACK);
// One key set per non-explanatory alternative.
const altKeySets = en => alts(en).filter(a => !explanatory(a)).map(a => keysOf(a)).filter(k => k.size);
// A register label on the other word ("(coll.)", "(informal)") does not change what it means.
const REGISTER = /\((?:coll|informal|formal|polite|slang|literary|courteous)\.?\)/gi;
const candKeys = en => keysOf(String(en || "").replace(REGISTER, " "));
const pairKey = (a, b) => a + ">" + b;
function build(words, ov){
  const errs = [];
  const byW = new Map(words.map(w => [w.w, w]));
  const en = {};
  Object.entries(ov.en || {}).forEach(([w, o]) => {
    const e = byW.get(w);
    if(!e){ errs.push(`en override ${w}: no such word`); return; }
    if(e.en !== o.was){ errs.push(`en override ${w}: hsk gloss is now ${JSON.stringify(e.en)}, override was written for ${JSON.stringify(o.was)}`); return; }
    if(!o.src) errs.push(`en override ${w}: no src`);
    // Characters in a gloss would show the answer on a meaning -> characters card.
    if(/\p{Script=Han}/u.test(o.en)) errs.push(`en override ${w}: Han characters in the gloss`);
    en[e.id] = o.en;
  });
  const gl = w => en[w.id] !== undefined ? en[w.id] : w.en;
  // syn: every key the matcher accepts, explanatory alternatives included ("...right?" is a key).
  const keys = new Map(words.map(w => [w.id, keysOf(gl(w))]));
  const byKey = new Map();
  words.forEach(w => keys.get(w.id).forEach(k => { if(!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(w); }));
  const syn = new Map(words.map(w => [w.id, new Set()])), tsyn = new Map(words.map(w => [w.id, new Set()]));
  const link = (a, b) => { if(a.id !== b.id){ syn.get(a.id).add(b.id); syn.get(b.id).add(a.id); } };
  const groups = [...byKey].filter(([, ws]) => ws.length > 1).map(([k, ws]) => ({ key: k, words: ws }));
  groups.forEach(g => g.words.forEach(a => g.words.forEach(b => link(a, b))));
  // notTyped: reviewed [stimulus word, typed word] pairs that stay wrong answers.
  const blocked = new Set();
  (ov.notTyped || []).forEach(n => {
    const ws = (n.pair || []).map(w => byW.get(w));
    if(ws.length !== 2 || ws.some(x => !x)){ errs.push(`notTyped ${JSON.stringify(n.pair)}: needs two known words`); return; }
    if(!n.why) errs.push(`notTyped ${JSON.stringify(n.pair)}: no why`);
    blocked.add(pairKey(ws[0].id, ws[1].id));
  });
  // typedSyn, generated: the other word's gloss covers this word's first meaning (the one a
  // learner names first for the stimulus).
  // A first alternative that only explains ("(classifier for books)") names no meaning to swap.
  const first = new Map(words.map(w => { const a = alts(gl(w))[0]; return [w.id, a && !explanatory(a) ? keysOf(a) : new Set()]; }));
  const cand = new Map(words.map(w => [w.id, candKeys(gl(w))]));
  const generated = [], used = new Set();
  words.forEach(t => {
    const f = first.get(t.id); if(!f.size) return;
    words.forEach(x => {
      if(x.id === t.id || ![...f].some(k => cand.get(x.id).has(k))) return;
      if(blocked.has(pairKey(t.id, x.id))){ used.add(pairKey(t.id, x.id)); return; }
      tsyn.get(t.id).add(x.id); generated.push([t, x]);
    });
  });
  (ov.synonyms || []).forEach(g => {
    const ws = (g.words || []).map(w => byW.get(w));
    if(ws.some(x => !x) || ws.length < 2){ errs.push(`synonyms ${JSON.stringify(g.words)}: unknown word or fewer than two`); return; }
    if(!g.why) errs.push(`synonyms ${JSON.stringify(g.words)}: no why`);
    ws.forEach(a => ws.forEach(b => { link(a, b); if(g.typed === true && a.id !== b.id) tsyn.get(a.id).add(b.id); }));
  });
  [...blocked].forEach(k => { const [a, b] = k.split(">"); tsyn.get(a).delete(b); });
  // typedSyn stays inside syn (validate_pack checks it).
  words.forEach(t => tsyn.get(t.id).forEach(x => link(t, byIdOf(words, x))));
  const nt = new Set(words.filter(w => noTypedRule(gl(w))).map(w => w.id));
  const adj = ov.noTypedMeaning || {};
  Object.keys(adj.add || {}).forEach(w => { const e = byW.get(w); if(!e) errs.push(`noTypedMeaning add ${w}: no such word`); else nt.add(e.id); });
  Object.keys(adj.remove || {}).forEach(w => { const e = byW.get(w); if(!e) errs.push(`noTypedMeaning remove ${w}: no such word`); else nt.delete(e.id); });
  const out = m => { const o = {}; words.forEach(w => { const s = [...m.get(w.id)].sort(); if(s.length) o[w.id] = s; }); return o; };
  const unusedBlocks = (ov.notTyped || []).filter(n => { const ws = (n.pair || []).map(w => byW.get(w)); return ws.every(Boolean) && !used.has(pairKey(ws[0].id, ws[1].id)) && !(ov.synonyms || []).some(g => g.typed === true && n.pair.every(w => g.words.includes(w))); });
  return { errs, en, gl, syn: out(syn), typedSyn: out(tsyn), noTypedMeaning: words.filter(w => nt.has(w.id)).map(w => w.id), groups, generated, rejected: used.size, unusedBlocks };
}
const byIdOf = (words, id) => (words._byId || (words._byId = new Map(words.map(w => [w.id, w])))).get(id);

function report(words, ov, r){
  const byId = new Map(words.map(w => [w.id, w]));
  const row = cells => `| ${cells.map(c => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;
  const lab = w => `${w.w} ${w.pron}`;
  const L = [];
  L.push("# zh glosses: synonyms, typed-meaning marks, overrides", "");
  L.push("Generated by `tools/pack_from_hsk.py` (step `tools/zh_gloss.js`); do not edit by hand. Overrides live in",
    "`tools/zh_gloss_overrides.json`. Rules: docs/PACK_SCHEMA.md \"Synonyms\" and \"noTypedMeaning\".", "");
  const nSyn = Object.keys(r.syn).length, nPairs = Object.values(r.typedSyn).reduce((n, l) => n + l.length, 0);
  const sorted = [...r.groups].sort((a, b) => b.words.length - a.words.length || (a.key < b.key ? -1 : 1));
  const reviewed = ov.synonyms || [], typedGroups = reviewed.filter(g => g.typed === true);
  L.push(`Words ${words.length}. Gloss overrides ${Object.keys(r.en).length} (words whose hsk gloss is replaced; table below).`,
    `Shared-key groups ${r.groups.length} (one per typed-meaning key that two or more words accept) plus reviewed synonym groups ${reviewed.length} (${typedGroups.length} typed); words with \`syn\` ${nSyn}.`,
    `\`typedSyn\`: ${nPairs} accepted [stimulus, typed] pairs on ${Object.keys(r.typedSyn).length} words (the gloss rule proposes ${r.generated.length + r.rejected}: ${r.rejected} rejected on review (\`notTyped\`, ${(ov.notTyped || []).length} entries incl. guards), ${r.generated.length} kept; the rest from typed groups). Marked \`noTypedMeaning\` ${r.noTypedMeaning.length}.`, "");
  const buckets = gl => { const n = {}; words.forEach(w => audit(gl(w)).forEach(f => { n[f] = (n[f] || 0) + 1; })); return n; };
  const b0 = buckets(w => w.en), b1 = buckets(r.gl);
  L.push("## Gloss audit buckets", "", row(["bucket", "hsk gloss", "after overrides"]), row(["---", "---", "---"]));
  ["truncated", "explanatory", "bracket-only", "long", "5+ alternatives"].forEach(k => L.push(row([k, b0[k] || 0, b1[k] || 0])));
  L.push("", "long: the shortest typed key is over 14 letters. explanatory: an alternative names a particle, classifier, marker, prefix or use.", "");
  L.push("## 20 largest shared-meaning groups", "", row(["key", "words"]), row(["---", "---"]));
  sorted.slice(0, 20).forEach(g => L.push(row([g.key, g.words.map(lab).join(", ")])));
  L.push("", "## Reviewed synonym groups", "", row(["words", "typed", "why"]), row(["---", "---", "---"]));
  reviewed.forEach(g => L.push(row([g.words.join(", "), g.typed === true ? "yes" : "no", g.why])));
  L.push("", "## Accepted typed answers (typedSyn)", "",
    "On a meaning stimulus for the first word (meaning -> characters, meaning -> pinyin), typing one of the listed words is also right; the reveal says \"also right\". " +
    "Generated: the listed word's gloss has the stimulus word's first meaning; every generated pair was reviewed, rejects are in the next table.", "",
    row(["stimulus", "first meaning", "also accepted"]), row(["---", "---", "---"]));
  words.filter(w => r.typedSyn[w.id]).forEach(w => L.push(row([lab(w), alts(r.gl(w))[0] || "", r.typedSyn[w.id].map(id => byId.get(id).w).join(" ")])));
  L.push("", "## Rejected typed answers (notTyped)", "", "Reviewed: the gloss rule would accept the typed word for the stimulus, but it is a different sense, part of speech or use.", "",
    row(["stimulus", "typed", "why"]), row(["---", "---", "---"]));
  (ov.notTyped || []).forEach(n => L.push(row([n.pair[0], n.pair[1], n.why + (r.unusedBlocks.includes(n) ? " (guard: not proposed by the current glosses)" : "")])));
  L.push("", "## Marked noTypedMeaning", "", "Never asked as a typed meaning (characters -> meaning, pinyin -> meaning); the meaning choice and meaning -> word items stay.", "",
    row(["id", "word", "gloss"]), row(["---", "---", "---"]));
  r.noTypedMeaning.forEach(id => { const w = byId.get(id); L.push(row([id, lab(w), r.gl(w)])); });
  L.push("", "## Gloss overrides", "", row(["id", "word", "hsk gloss", "pack gloss", "source"]), row(["---", "---", "---", "---", "---"]));
  Object.entries(ov.en || {}).forEach(([w, o]) => { const e = words.find(x => x.w === w); L.push(row([e ? e.id : "?", w, o.was, o.en, o.src])); });
  L.push("", "## All shared-meaning groups", "", row(["key", "words"]), row(["---", "---"]));
  sorted.forEach(g => L.push(row([g.key, g.words.map(lab).join(", ")])));
  return L.join("\n") + "\n";
}

if(require.main === module){
  const words = JSON.parse(fs.readFileSync(0, "utf8"));
  const ov = JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  const r = build(words, ov);
  if(r.errs.length){ process.stderr.write(r.errs.map(e => "zh_gloss: " + e).join("\n") + "\n"); process.exit(1); }
  const i = process.argv.indexOf("--report");
  if(i > 0){
    const p = path.resolve(process.argv[i + 1]), text = report(words, ov, r);
    if(!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== text){ fs.writeFileSync(p, text); process.stderr.write(`wrote ${path.relative(ROOT, p)}\n`); }
  }
  process.stdout.write(JSON.stringify({ en: r.en, syn: r.syn, typedSyn: r.typedSyn, noTypedMeaning: r.noTypedMeaning }));
}
module.exports = { build, report, noTypedRule, explanatory, altKeySets, audit, keysOf, OVERRIDES, PACK };
