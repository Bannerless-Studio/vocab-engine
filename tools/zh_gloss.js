#!/usr/bin/env node
// zh gloss build step, run by tools/pack_from_hsk.py (docs/PACK_SCHEMA.md "Synonyms" and
// "noTypedMeaning"; report docs/ZH_GLOSS.md). Reads the words pack_from_hsk.py built from the
// hsk vocabulary as JSON on stdin and writes JSON to stdout:
//   { en: {id: gloss}, syn: {id: [ids]}, typedSyn: {id: [ids]}, noTypedMeaning: [ids] }
//   en              tools/zh_gloss_overrides.json "en" (each must still match its "was")
//   syn             words sharing an accepted typed meaning: a glossAltKeys key (the key
//                   checkGlossTyped matches with, so a gloss the learner may type for one word
//                   is never a wrong option for the other) or a reviewed "synonyms" group.
//                   Explanatory alternatives ("...right?", "classifier for ...") give no key.
//   typedSyn        words the word's whole gloss also fits, or a reviewed group: a typed answer
//                   naming one of them for this word's meaning stimulus is right. Fits: every
//                   alternative is one of the other word's, qualifiers and a leading "to" kept
//                   ("key" never fits "key (project etc)", "to face" never fits "face"). A shared homonym ("lamp; light" vs
//                   "light; easy") is a syn but not a typedSyn: the rest of the gloss tells.
//   noTypedMeaning  words whose every alternative is an explanation (particle, classifier,
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
  return a.length > 0 && (a.every(explanatory) || VC.glossAltKeys(en).size === 0);
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

// One key set per non-explanatory alternative.
const altKeySets = en => alts(en).filter(a => !explanatory(a)).map(a => VC.glossAltKeys(a)).filter(k => k.size);
const strictKey = s => { const k = VC.glossKey(s); return k && (/^\s*to\s/i.test(s) ? "to " + k : k); };
const fullAlt = a => a.replace(/[()]/g, " ");
const strictFull = en => alts(en).filter(a => !explanatory(a)).map(a => strictKey(fullAlt(a))).filter(Boolean);
function build(words, ov){
  const errs = [];
  const byW = new Map(words.map(w => [w.w, w]));
  const en = {};
  Object.entries(ov.en || {}).forEach(([w, o]) => {
    const e = byW.get(w);
    if(!e){ errs.push(`en override ${w}: no such word`); return; }
    if(e.en !== o.was){ errs.push(`en override ${w}: hsk gloss is now ${JSON.stringify(e.en)}, override was written for ${JSON.stringify(o.was)}`); return; }
    if(!o.src) errs.push(`en override ${w}: no src`);
    en[e.id] = o.en;
  });
  const gl = w => en[w.id] !== undefined ? en[w.id] : w.en;
  const sets = new Map(words.map(w => [w.id, altKeySets(gl(w))]));
  const keys = new Map(words.map(w => [w.id, new Set(sets.get(w.id).flatMap(k => [...k]))]));
  const byKey = new Map();
  words.forEach(w => keys.get(w.id).forEach(k => { if(!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(w); }));
  const syn = new Map(words.map(w => [w.id, new Set()])), tsyn = new Map(words.map(w => [w.id, new Set()]));
  const link = (a, b) => { if(a.id !== b.id){ syn.get(a.id).add(b.id); syn.get(b.id).add(a.id); } };
  const fits = (a, b) => { const f = strictFull(gl(a)), all = new Set(strictFull(gl(b))); return a.id !== b.id && f.length > 0 && f.every(k => all.has(k)); };
  const groups = [...byKey].filter(([, ws]) => ws.length > 1).map(([k, ws]) => ({ key: k, words: ws }));
  groups.forEach(g => g.words.forEach(a => g.words.forEach(b => { link(a, b); if(fits(a, b)) tsyn.get(a.id).add(b.id); })));
  (ov.synonyms || []).forEach(g => {
    const ws = (g.words || []).map(w => byW.get(w));
    if(ws.some(x => !x) || ws.length < 2){ errs.push(`synonyms ${JSON.stringify(g.words)}: unknown word or fewer than two`); return; }
    if(!g.why) errs.push(`synonyms ${JSON.stringify(g.words)}: no why`);
    ws.forEach(a => ws.forEach(b => { link(a, b); if(a.id !== b.id) tsyn.get(a.id).add(b.id); }));
  });
  const nt = new Set(words.filter(w => noTypedRule(gl(w))).map(w => w.id));
  const adj = ov.noTypedMeaning || {};
  Object.keys(adj.add || {}).forEach(w => { const e = byW.get(w); if(!e) errs.push(`noTypedMeaning add ${w}: no such word`); else nt.add(e.id); });
  Object.keys(adj.remove || {}).forEach(w => { const e = byW.get(w); if(!e) errs.push(`noTypedMeaning remove ${w}: no such word`); else nt.delete(e.id); });
  const out = m => { const o = {}; words.forEach(w => { const s = [...m.get(w.id)].sort(); if(s.length) o[w.id] = s; }); return o; };
  return { errs, en, gl, syn: out(syn), typedSyn: out(tsyn), noTypedMeaning: words.filter(w => nt.has(w.id)).map(w => w.id), groups };
}

function report(words, ov, r){
  const byId = new Map(words.map(w => [w.id, w]));
  const row = cells => `| ${cells.map(c => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;
  const lab = w => `${w.w} ${w.pron}`;
  const L = [];
  L.push("# zh glosses: synonyms, typed-meaning marks, overrides", "");
  L.push("Generated by `tools/pack_from_hsk.py` (step `tools/zh_gloss.js`); do not edit by hand. Overrides live in",
    "`tools/zh_gloss_overrides.json`. Rules: docs/PACK_SCHEMA.md \"Synonyms\" and \"noTypedMeaning\".", "");
  const nSyn = Object.keys(r.syn).length;
  const sorted = [...r.groups].sort((a, b) => b.words.length - a.words.length || (a.key < b.key ? -1 : 1));
  L.push(`Words ${words.length}. Shared-meaning key groups ${r.groups.length}; reviewed synonym groups ${(ov.synonyms || []).length}; words with \`syn\` ${nSyn}, with \`typedSyn\` ${Object.keys(r.typedSyn).length}. ` +
    `Marked \`noTypedMeaning\` ${r.noTypedMeaning.length}. Gloss overrides ${Object.keys(r.en).length}.`, "");
  const buckets = gl => { const n = {}; words.forEach(w => audit(gl(w)).forEach(f => { n[f] = (n[f] || 0) + 1; })); return n; };
  const b0 = buckets(w => w.en), b1 = buckets(r.gl);
  L.push("## Gloss audit buckets", "", row(["bucket", "hsk gloss", "after overrides"]), row(["---", "---", "---"]));
  ["truncated", "explanatory", "bracket-only", "long", "5+ alternatives"].forEach(k => L.push(row([k, b0[k] || 0, b1[k] || 0])));
  L.push("", "long: the shortest typed key is over 14 letters. explanatory: an alternative names a particle, classifier, marker, prefix or use.", "");
  L.push("## 20 largest shared-meaning groups", "", row(["key", "words"]), row(["---", "---"]));
  sorted.slice(0, 20).forEach(g => L.push(row([g.key, g.words.map(lab).join(", ")])));
  L.push("", "## Reviewed synonym groups", "", row(["words", "why"]), row(["---", "---"]));
  (ov.synonyms || []).forEach(g => L.push(row([g.words.join(", "), g.why])));
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
module.exports = { build, report, noTypedRule, explanatory, altKeySets, audit, OVERRIDES };
