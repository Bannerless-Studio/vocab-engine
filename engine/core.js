// core.js has no DOM dependency so the Node checks can run it. Everything
// language-specific comes from the pack (docs/PACK_SCHEMA.md).
(function(root){
"use strict";

function shuffle(a, rng){
  const r = rng || Math.random;
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
const normKey = s => String(s == null ? "" : s).trim().toLowerCase();

// Every render site that shows a word's meaning goes through gloss(), so a future
// pack-level display rule has exactly one place to live.
function gloss(entry){ return String((entry && entry.en) || "").replace(/\s+/g, " ").trim(); }

// Rejects near-synonym distractors (two "to eat"-ish glosses). "" means no signal.
function firstTwoWords(en){
  return String(en).toLowerCase().replace(/[^a-z\s]/g,"").trim().split(/\s+/).slice(0,2).join(" ");
}

function levelIds(pack){ return (pack.levels||[]).map(l=>String(l.id)); }
function levelIndexMap(pack){ const m = {}; levelIds(pack).forEach((id,i)=>{ m[id] = i; }); return m; }
function levelLabel(pack, id){ const l = (pack.levels||[]).find(x=>String(x.id)===String(id)); return l ? l.label : String(id); }
function setSizeOf(pack){ return pack.setSize || 10; }
function wordsByLevel(words, pack){
  const out = {}; levelIds(pack).forEach(id=>{ out[id] = []; });
  (words||[]).forEach(w=>{ if(out[w.lv]) out[w.lv].push(w); });
  return out;
}
function nSets(list, setSize){ return Math.ceil(list.length / (setSize||10)); }

// Two words sharing any w/alt surface are homographs to the learner. `forms` are never
// shown or typed, so they never count.
function surfaces(e){ return [e.w, ...((e && e.alt) || [])].map(normKey).filter(Boolean); }
// The one surface list every locate-in-text site uses. `forms` are never typed answers or
// distractor surfaces: acceptTyped and the homograph guards read w + alt only.
// docs/PACK_SCHEMA.md words table.
function textForms(e){
  if(!e) return [];
  return [e.w, ...(Array.isArray(e.alt) ? e.alt : []), ...(Array.isArray(e.forms) ? e.forms : [])];
}
function sharesSurface(a, b){ const s = new Set(surfaces(a)); return surfaces(b).some(x=>s.has(x)); }
// Same pronunciation (when both carry pron): indistinguishable in a hear item.
function samePron(a, b){ return !!(a && b && a.pron && b.pron) && normKey(a.pron) === normKey(b.pron); }
// words[].syn / typedSyn (docs/PACK_SCHEMA.md "Synonyms"), generated at pack build. syn: the
// words share an accepted meaning, so neither is ever a wrong option for the other (either side
// listing the other is enough). typedSyn: words this word's whole gloss also fits, so a typed
// answer naming one is right on its meaning stimulus.
function synIds(e){ return Array.isArray(e && e.syn) ? e.syn : []; }
function isSyn(a, b){ return !!(a && b) && (synIds(a).includes(b.id) || synIds(b).includes(a.id)); }
// The first typedSyn word the typed answer fits (test(word) -> bool), else null.
function typedSynHit(entry, byId, test){
  for(const id of (Array.isArray(entry && entry.typedSyn) ? entry.typedSyn : [])){ const s = byId && byId[id]; if(s && test(s)) return s; }
  return null;
}
// Option mix (docs/PACK_SCHEMA.md "optsMix", engine default since the flag collapse; owner 2026-10-02): same-level-first wrong
// choices near the end of a level are all known words, so a new answer is found by
// elimination; a learned/unlearned mix let the learner rule out the other familiarity class
// (review 2026-10-02: guess success 0.40). Wrong choices come from the answer's own stage
// instead. mix = { stage(x), rng? }: 0 new/weak (learned below mastered, or in the Learn set
// being taught), 1 known (mastered), 2 never taught. The answer's stage first (a never-taught
// answer is being taught: 0), then the other learned stage, then never taught; no level tiers.
// A new/weak answer ranks its stage by mix.bucket(answer, v): 0 its own set (the Learn set
// while one is drilled), 1 the adjacent sets, 2 the rest; weak words learned days ago beside
// a word met today were told apart by when they were met (review round 2: guess 0.54).
// rank(v) orders hard preferences ahead of the stage (one script, article agreement); near(v)
// orders the class preference inside a stage (lower first). accept(strict) returns a fresh
// guard that records what it lets through.
// The idx-th k-combination of 0..m-1 in lexicographic order.
function nthCombination(m, k, idx){
  const out = []; let x = 0;
  for(let left = k; left > 0; left--){ for(;; x++){ let c = 1; for(let i = 1; i <= left - 1; i++) c = c * (m - x - 1 - (i - 1)) / i; if(idx < c){ out.push(x++); break; } idx -= c; } }
  return out;
}
const comboCount = (m, k) => { let c = 1; for(let i = 1; i <= k; i++) c = c * (m - k + i) / i; return Math.round(c); };
// t-th pick of a walk with a stride coprime to the number of combinations, so consecutive sessions differ in most members.
function comboStep(t, m, k){
  const n = comboCount(m, k), gcd = (a, b) => b ? gcd(b, a % b) : a, st = [7, 11, 13, 17, 5, 3, 1].find(p => gcd(p, n) === 1) || 1;
  return (t * st) % n;
}
function mixPick(ans, cands, mix, rank, near, accept, n, nearFirst){
  const r = mix.rng || Math.random, want = n || 3, as = mix.stage(ans) === 1 ? 1 : 0;
  const bucket = as === 0 && mix.bucket ? v => mix.bucket(ans, v) : () => 0;
  // nearFirst: near is a length the learner can see (charPick/charRecall/charSound/pronChoice), so it outranks the learn-order bucket.
  const key = nearFirst ? v => { const st = mix.stage(v); return rank(v) * 10000 + (st === as ? 0 : st === 2 ? 2 : 1) * 1000 + near(v) * 100 + (st === as ? bucket(v) : 0); }
    : v => { const st = mix.stage(v); return rank(v) * 1000 + (st === as ? bucket(v) : st === 2 ? 4 : 3) * 100 + near(v); };
  const keyed = cands.map(v => [key(v), v]);
  // mix.rot (session ordinal, new/weak answers): the group that fills the last slots supplies a different subset each session
  // (a stepped walk over its combinations) instead of a random draw, so a small closed set does not show the same three again.
  const rot = as === 0 && mix.bucket && mix.rot > 0 ? mix.rot : 0;
  const groups = [...new Set(keyed.map(x => x[0]))].sort((x, y) => x - y).map(k => keyed.filter(x => x[0] === k).map(x => x[1]));
  let before = 0;
  const ordered = groups.flatMap(g => {
    const need = want - before; before += g.length;
    if(!rot || need <= 0 || need >= g.length) return shuffle(g, r);
    const q = g.slice().sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)), pick = nthCombination(q.length, need, comboStep(rot + [...String(ans.id)].reduce((h, c) => h + c.charCodeAt(0), 0), q.length, need));
    return [...pick.map(i => q[i]), ...shuffle(q.filter((x, i) => !pick.includes(i)), r)];
  });
  function run(strict){
    const ok = accept(strict), chosen = [];
    for(const v of ordered){ if(chosen.length >= want) break; if(ok(v)) chosen.push(v); }
    return chosen;
  }
  const chosen = run(true);
  return chosen.length < want ? run(false) : chosen;
}
// Never a homograph of the answer (the read stimulus would fit both), a homophone (the hear
// stimulus would fit both) or a gloss sharing its first two words (a near-synonym). Prefers
// same-part-of-speech distractors like wordOpts, falling back to any pos when the same-pos
// pool is smaller than needed (a verb answer never runs short of options just because the
// level has only two other verbs).
function meaningOpts(entry, pool, mix){
  const ansKey = normKey(entry.en);
  const ansFirst2 = firstTwoWords(entry.en);
  const hasPos = !!entry.pos;
  const samePos = v => hasPos && v.pos === entry.pos;
  const candidates = (pool||[]).filter(v=>v.id!==entry.id && normKey(v.en)!==ansKey && !sharesSurface(v, entry) && !samePron(v, entry) && !isSyn(v, entry));
  if(mix) return mixPick(entry, candidates, mix, () => 0, v => samePos(v) ? 0 : 1, strict => {
    const usedFirst2 = new Set(ansFirst2 ? [ansFirst2] : []), usedGloss = new Set([ansKey]);
    return v => { const f2 = firstTwoWords(v.en), g = normKey(v.en);
      if(usedGloss.has(g) || (strict && f2 && usedFirst2.has(f2))) return false;
      usedGloss.add(g); if(f2) usedFirst2.add(f2); return true; };
  });
  const t1 = candidates.filter(v=>v.lv===entry.lv && samePos(v));
  const t2 = candidates.filter(v=>v.lv===entry.lv && !samePos(v));
  const t3 = candidates.filter(v=>v.lv!==entry.lv && samePos(v));
  const t4 = candidates.filter(v=>v.lv!==entry.lv && !samePos(v));
  const ordered = [...shuffle(t1), ...shuffle(t2), ...shuffle(t3), ...shuffle(t4)];
  function pass(strict){
    const chosen = []; const usedFirst2 = new Set(ansFirst2 ? [ansFirst2] : []); const usedGloss = new Set([ansKey]);
    ordered.forEach(v=>{
      if(chosen.length>=3) return;
      const f2 = firstTwoWords(v.en), g = normKey(v.en);
      if(usedGloss.has(g)) return; // two identical option labels would make the answer ambiguous
      if(strict && f2 && usedFirst2.has(f2)) return;
      chosen.push(v); usedGloss.add(g); if(f2) usedFirst2.add(f2);
    });
    return chosen;
  }
  let chosen = pass(true);
  if(chosen.length<3) chosen = pass(false); // small-pool fallback: keep "not the answer" only
  return chosen.slice(0,3);
}

// A distractor must never be a second right answer: never an answer surface, never a gloss
// or first-two-gloss-words match. A content-word answer never gets a pack.functionWords
// distractor: a learner rules those out on sight, and in a cloze one may even fit the blank.
// prefer ranks matching candidates first (gapChoices article agreement).
function wordOpts(entry, pool, showOf, pack, prefer, mix){
  const show = showOf || (e => e.w);
  const ansGloss = normKey(entry.en), ansF2 = firstTwoWords(entry.en);
  const hasPos = !!entry.pos;
  const fw = new Set((pack && pack.functionWords) || []);
  const ansFw = fw.has(entry.id);
  const pf = pronFirstOn(pack); // pron display: no option may sound like another (pronClash)
  const cands = (pool||[]).filter(v =>
    v.id!==entry.id && !sharesSurface(v, entry) && normKey(v.en)!==ansGloss && !(ansF2 && firstTwoWords(v.en)===ansF2) &&
    (ansFw || !fw.has(v.id)) && !(pf && pronClash(v, entry)) && !isSyn(v, entry));
  const samePos = v => hasPos && v.pos===entry.pos;
  if(mix) return mixPick(entry, cands, mix, v => prefer && !prefer(v) ? 1 : 0, v => (ansFw && !fw.has(v.id) ? 2 : 0) + (samePos(v) ? 0 : 1), strict => {
    const usedW = new Set([...surfaces(entry), normKey(show(entry))]), usedF2 = new Set(), chosen = [];
    return v => { const k = normKey(show(v)), f2 = firstTwoWords(v.en);
      if(usedW.has(k) || (showOf && surfaces(v).some(x => usedW.has(x))) || (pf && chosen.some(c => pronClash(c, v))) || (strict && f2 && usedF2.has(f2))) return false;
      chosen.push(v); usedW.add(k); if(showOf) surfaces(v).forEach(x => usedW.add(x)); if(f2) usedF2.add(f2); return true; };
  });
  const t1 = cands.filter(v=>v.lv===entry.lv && samePos(v));
  const t2 = cands.filter(v=>v.lv===entry.lv && !samePos(v));
  const t3 = cands.filter(v=>v.lv!==entry.lv && samePos(v));
  const t4 = cands.filter(v=>v.lv!==entry.lv && !samePos(v));
  const tiered = [...shuffle(t1), ...shuffle(t2), ...shuffle(t3), ...shuffle(t4)];
  const byClass = ansFw ? [...tiered.filter(v=>fw.has(v.id)), ...tiered.filter(v=>!fw.has(v.id))] : tiered;
  const ordered = prefer ? [...byClass.filter(v => prefer(v)), ...byClass.filter(v => !prefer(v))] : byClass;
  function pass(strict){
    // Only the displayed w must differ (alts are never shown). With a label fn, written forms
    // must differ too: same-w homographs with different labels would read as one written word.
    const chosen = []; const usedW = new Set([...surfaces(entry), normKey(show(entry))]); const usedF2 = new Set();
    for(const v of ordered){
      if(chosen.length>=3) break;
      const k = normKey(show(v)), f2 = firstTwoWords(v.en);
      if(usedW.has(k)) continue;
      if(showOf && surfaces(v).some(x => usedW.has(x))) continue;
      if(pf && chosen.some(c => pronClash(c, v))) continue;
      if(strict && f2 && usedF2.has(f2)) continue;
      chosen.push(v); usedW.add(k); if(showOf) surfaces(v).forEach(x => usedW.add(x)); if(f2) usedF2.add(f2);
    }
    return chosen;
  }
  let chosen = pass(true);
  if(chosen.length<3) chosen = pass(false);
  return chosen;
}
// Cloze distractors use the same rules as recall: plausible words, never a second right answer.
const gapOpts = wordOpts;

// Sentences sharing a word id with the answer come first: a plausible near-miss.
function sentenceOpts(sentence, pool, mix){
  const ansKey = normKey(sentence.en);
  const wordSet = new Set(sentence.words || []);
  const shares = s => (s.words||[]).some(w=>wordSet.has(w));
  // optsMix: a translation far longer or shorter than the others stands out (review m1).
  const ansLen = String(sentence.en || "").length || 1, lenNear = s => { const q = String(s.en || "").length / ansLen; return q >= 0.67 && q <= 1.5; };
  if(mix) return mixPick(sentence, (pool || []).filter(s => s.id !== sentence.id && normKey(s.en) !== ansKey), mix, () => 0, s => (lenNear(s) ? 0 : 2) + (shares(s) ? 0 : 1), () => {
    const seenEn = new Set([ansKey]);
    return s => { const k = normKey(s.en); if(seenEn.has(k)) return false; seenEn.add(k); return true; };
  });
  const candidates = (pool || []).filter(s => s.id !== sentence.id && s.lv === sentence.lv && normKey(s.en) !== ansKey);
  const chosen = []; const seenEn = new Set([ansKey]);
  function addFrom(list){
    list.forEach(s=>{
      if(chosen.length>=3) return;
      const key = normKey(s.en);
      if(seenEn.has(key)) return;
      seenEn.add(key); chosen.push(s);
    });
  }
  addFrom(shuffle(candidates.filter(shares))); addFrom(shuffle(candidates.filter(s=>!shares(s))));
  if(chosen.length<3) addFrom(shuffle((pool||[]).filter(s=>s.id!==sentence.id)));
  return chosen.slice(0,3);
}

// Accent folding (lenient typing, Words search). Rule: drop only marks that are optional
// accents, stress or vowel pointing for their script. A mark that makes a different
// letter is never dropped. Each precomposed code point is decomposed (NFD), its
// foldable marks removed, then recomposed (NFC), so a kept mark re-forms its letter.
// Per script (FOLD_SCRIPTS):
//  - Latin/Greek/Cyrillic combining diacritics: folded (é -> e, ñ -> n, stress о́ -> о,
//    ё -> е). Kept as letters: Cyrillic й, ї, ў (FOLD_KEEP).
//  - Arabic script: harakat, Quranic marks, superscript alef and tatweel folded. The
//    hamza marks U+0653-0655 are kept here, so أ إ آ ؤ ئ ۀ keep their carrier in
//    foldAccents itself; lenient typing drops them afterwards (LENIENT_LETTERS).
//  - Hebrew: niqqud and cantillation folded.
//  - Devanagari/Bengali etc.: nothing folded here. Virama and vowel signs make distinct
//    syllables. (Nukta and chandrabindu are lenient-typing letter folds, LENIENT_LETTERS.)
//  - Kana voicing marks (が vs か, ぱ vs は): never folded.
//  - ZWNJ/ZWJ: dropped (Persian می‌روم = میروم).
const FOLD_SCRIPTS = {
  latinGreekCyrillic: "\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f",
  hebrew: "\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7",
  arabic: "\u0610-\u061a\u064b-\u0652\u0656-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0640",
  joiners: "\u200c\u200d",
};
const FOLD_MARKS = new RegExp("[" + Object.values(FOLD_SCRIPTS).join("") + "]", "g");
const FOLD_KEEP = new Set(["\u0439","\u0419","\u0457","\u0407","\u045e","\u040e"]); // й Й ї Ї ў Ў
function foldAccents(s){
  return String(s).normalize("NFC").replace(/[^\u0000-\u007f]/gu, c => FOLD_KEEP.has(c) ? c : c.normalize("NFD").replace(FOLD_MARKS, "").normalize("NFC"));
}
// Arabic-script keyboard variants that look alike and are typed interchangeably:
// Arabic kaf/yeh vs their Persian/Urdu forms. Always unified (both sides, strict too),
// like apostrophes. ة/ه and ى/ی are not keyboard variants; strict typing keeps them
// apart (على "on" vs علي "Ali"). Lenient typing folds them (LENIENT_LETTERS).
const ARABIC_VARIANTS = { "\u0643":"\u06a9", "\u064a":"\u06cc" };
// Lenient typing only (opts.foldAccents; never strict): optional spelling variants a
// literate writer commonly omits or swaps, folded on both sides after foldAccents.
//  - Arabic script: hamza/madda on a carrier dropped (أ إ آ -> ا, ؤ -> و, ئ ۓ -> ی/ے,
//    ۂ -> ہ, ۀ -> ه) by removing U+0653-0655 after NFD, which also drops a loose hamza
//    above/below (خانهٔ); alef wasla and the rare hamza/wavy-hamza letters (ٱ ٲ ٳ ٵ ٶ ٷ ٸ)
//    map to ا/و/ی; standalone hamza ء dropped; teh marbuta ة -> ه and Urdu ۃ -> ہ; alef
//    maksura ى -> ی; do-chashmi heh ھ -> heh goal ہ (Urdu بھائی = بہائی). ARABIC_VARIANTS
//    runs again last, so a carrier-stripped ئ (Arabic ي + hamza) lands on ی.
//    Not folded: a leading ال (it changes the word), ه vs ہ (each pack uses one).
//  - Devanagari: nukta dropped (ज़ -> ज, incl. precomposed क़..य़ U+0958-095F via NFD);
//    chandrabindu ँ -> anusvara ं (माँ = मां).
// Folding can make distinct words one key (ماء "water" = ما "what", si = sí); acceptTyped's
// collision guard rejects an exact other pack word. Per-pack lists: docs/PACK_SCHEMA.md.
// Words search does not use this layer (searchFold passes lenientLetters:false): it has
// its own, different folds (ال optional, ھ kept, ء kept).
const LENIENT_LETTERS = { "\u0671":"\u0627", "\u0672":"\u0627", "\u0673":"\u0627", "\u0675":"\u0627",
  "\u0676":"\u0648", "\u0677":"\u0648", "\u0678":"\u06cc", "\u0621":"", "\u0629":"\u0647", "\u06c3":"\u06c1",
  "\u0649":"\u06cc", "\u06be":"\u06c1", "\u06d5":"\u0647", "\u0901":"\u0902", "\u093c":"" };
const LENIENT_RE = new RegExp("[" + Object.keys(LENIENT_LETTERS).join("") + "]", "g");
function foldLenientLetters(s){
  if(!/[\u0600-\u06ff\u0900-\u097f]/.test(s)) return s;
  return s.normalize("NFD").replace(/[\u0653-\u0655]/g, "").replace(LENIENT_RE, c => LENIENT_LETTERS[c])
    .replace(/[\u0643\u064a]/g, c => ARABIC_VARIANTS[c]).normalize("NFC");
}
// German only (pack.key === "de", the documented exception): a learner on a non-German
// keyboard types ae/oe/ue/ss for ä/ö/ü/ß. Applied to each target only, before foldAccents
// (which would already have made ä "a"). The typed text is never digraph-folded, so a real
// "ae" (Aerobic) never becomes ä.
const GERMAN_ASCII = { "\u00e4":"ae", "\u00f6":"oe", "\u00fc":"ue", "\u00df":"ss",
  "\u00c4":"Ae", "\u00d6":"Oe", "\u00dc":"Ue" };
const GERMAN_ASCII_RE = /[\u00e4\u00f6\u00fc\u00df\u00c4\u00d6\u00dc]/g;
function foldGermanAscii(s){
  return String(s).replace(GERMAN_ASCII_RE, c => GERMAN_ASCII[c]);
}
// germanAscii runs before the accent strip so ä/ö/ü/ß are not lost to it first.
function normalizeTyped(s, opts){
  const o = opts || {};
  let out = String(s == null ? "" : s).normalize("NFC").replace(/[\u2018\u2019\u02bc`]/g, "'").replace(/[\u0643\u064a]/g, c => ARABIC_VARIANTS[c]).replace(/\s+/g, " ").trim();
  if(!o.caseSensitive) out = out.toLowerCase();
  if(o.foldAccents){
    if(o.germanAscii) out = foldGermanAscii(out);
    out = foldAccents(out);
    if(o.lenientLetters !== false) out = foldLenientLetters(out).replace(/\s+/g, " ").trim();
  }
  return out;
}
function typingEnabled(pack){ return !!(pack && pack.typing); }
function typingLenientFor(entry, pack){
  const t = (pack && pack.typing) || {};
  if((t.accents || "lenient") !== "lenient") return false;
  if(t.strictFromLevel == null) return true;
  const idx = levelIndexMap(pack);
  const strictAt = idx[String(t.strictFromLevel)];
  if(strictAt === undefined) return true;
  const at = idx[String(entry.lv)];
  return at === undefined ? true : at < strictAt;
}
// Collision guard keys. The pointing key drops marks that never tell two written words
// apart (harakat, tatweel, niqqud, ZWJ/ZWNJ, Cyrillic stress), so typing them cannot turn
// one pack word into another. Latin accents, hamza marks and LENIENT_LETTERS are kept: si/sí, ما/ماء.
const POINTING_MARKS = new RegExp("[" + FOLD_SCRIPTS.arabic + FOLD_SCRIPTS.hebrew + FOLD_SCRIPTS.joiners + "]", "g");
function pointingKey(strictForm){
  return strictForm.normalize("NFD").replace(POINTING_MARKS, "")
    .replace(/(?<=[\u0400-\u04ff][\u0300-\u036f]*)\u0301/g, "").normalize("NFC");
}
// w and alt only: `forms` are not typed targets.
const GUARD_INDEX = new WeakMap();
function guardIndex(words, caseSensitive){
  let byCase = GUARD_INDEX.get(words);
  if(!byCase){ byCase = {}; GUARD_INDEX.set(words, byCase); }
  const k = caseSensitive ? "cs" : "ci";
  if(byCase[k]) return byCase[k];
  const strict = new Map(), pointing = new Map();
  const add = (m, f, e) => { if(!f) return; if(!m.has(f)) m.set(f, []); m.get(f).push(e); };
  words.forEach(e => [e.w, ...(e.alt||[])].forEach(x => {
    const f = normalizeTyped(x, { caseSensitive });
    add(strict, f, e); add(pointing, pointingKey(f), e);
  }));
  return (byCase[k] = { strict, pointing });
}
// `forms` are never accepted: "Type the word" wants the word itself. An answer that matches
// only after lenient folding is rejected when it spells another pack entry (مَا or ما for ماء,
// si for sí); a pointing key the target shares stays accepted (замок for за́мок).
function acceptTyped(input, entry, pack, extra, words){
  const t = (pack && pack.typing) || {};
  const cs = !!t.caseSensitive, lenient = typingLenientFor(entry, pack);
  const targets = [entry.w, ...(entry.alt||[]), ...(extra||[])];
  const strict = { caseSensitive: cs };
  const got = normalizeTyped(input, strict);
  if(!got) return false;
  const targetStrict = targets.map(x => normalizeTyped(x, strict));
  if(targetStrict.includes(got)) return true;
  if(!lenient) return false;
  const isDe = !!(pack && pack.key === "de");
  const full = { caseSensitive: cs, foldAccents: true };
  const fullDe = { caseSensitive: cs, foldAccents: true, germanAscii: true };
  const gotL = normalizeTyped(input, full);
  if(!gotL || !targets.some(x => normalizeTyped(x, full) === gotL || (isDe && normalizeTyped(x, fullDe) === gotL))) return false;
  if(!Array.isArray(words)) return true;
  const other = e => e !== entry && !(e.id != null && e.id === entry.id);
  const idx = guardIndex(words, cs);
  if((idx.strict.get(got) || []).some(other)) return false;
  const pk = pointingKey(got);
  if(targetStrict.some(x => pointingKey(x) === pk)) return true;
  return !(idx.pointing.get(pk) || []).some(other);
}

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// ASCII ', right single quote and modifier letter apostrophe are one symbol in sentence text.
const APOS = String.fromCodePoint(39, 0x2019, 0x02bc);
const isApos = c => APOS.indexOf(c) >= 0;
// Compiled findSurface regex per (surface, clitics): the same few thousand surfaces recur
// every item/session, and compiling a unicode lookbehind RegExp per call made the
// simulation crawl. Key joins on \u0001 (never in a surface); bounded, cleared when full.
// The cached regex is global: lastIndex is reset before each use and every caller finishes
// its exec loop before the next call (no re-entrancy inside the loop).
const SURFACE_RE_CACHE = new Map(), SURFACE_RE_MAX = 5000;
function surfaceRe(s, clitics){
  const key = s + "\u0001" + (clitics && clitics.length ? clitics.join("\u0001") : "");
  let re = SURFACE_RE_CACHE.get(key);
  if(re) return re;
  const cps = [...s];
  const body = cps.map(c => isApos(c) ? `[${APOS}]` : escapeRe(c)).join("");
  const lb = isApos(cps[0]) ? "" : "(?<![\\p{L}\\p{M}\\p{N}\\u200c\\u200d])";
  const cliticGroup = (clitics && clitics.length) ? `(?:${clitics.map(escapeRe).join("|")})?` : "";
  const la = isApos(cps[cps.length-1]) ? "" : "(?![\\p{L}\\p{M}\\p{N}\\u200c\\u200d])";
  re = new RegExp(lb + body + cliticGroup + la, "giu");
  if(SURFACE_RE_CACHE.size >= SURFACE_RE_MAX) SURFACE_RE_CACHE.clear();
  SURFACE_RE_CACHE.set(key, re);
  return re;
}
// An apostrophe-final surface ("l'") may run into the next word. ZWNJ/ZWJ are word-internal
// (Persian می‌روم is one word). spaced=false is for scripts written without spaces.
// The clitic group sits inside this regex rather than as a post-hoc extension because a
// clitic-only case with no reduplication ("rumahnya") never reaches a post-hoc step: the
// base regex's own right boundary fails first, before any hit exists to extend. `blockKeys`
// exists because a fused hit can coincide with a different real pack word's own surface
// (Indonesian ada+lah = adalah, apa+kah = apakah, bu+ku = buku) — that word, not entry+clitic.
// Cheap exact reject before the regex: true only when `surface` provably cannot match `t`
// under the "iu" regex. Caseless-script surfaces (no case folding exists) match by identity,
// so indexOf decides. Plain ASCII surfaces fold only with ASCII case and the two non-ASCII
// letters that fold into it (U+212A Kelvin sign, U+017F long s), so a lowercase includes
// decides unless t holds one of those. Anything else (apostrophes, accents, cased non-ASCII)
// goes to the regex, so results never change.
const CASELESS_SURFACE = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;
const ASCII_SURFACE = /^[A-Za-z0-9 \-]+$/;
function surfaceAbsent(t, s){
  if(CASELESS_SURFACE.test(s)) return t.indexOf(s) < 0;
  if(ASCII_SURFACE.test(s)) return t.toLowerCase().indexOf(s.toLowerCase()) < 0 && !/[\u212a\u017f]/.test(t);
  return false;
}
function findSurface(text, surface, spaced, clitics, blockKeys){
  const out = []; const t = String(text), s = String(surface||"");
  if(!s) return out;
  if(spaced === false){
    let i = t.indexOf(s);
    while(i >= 0){ out.push({ start:i, end:i+s.length, text:s }); i = t.indexOf(s, i + s.length); }
    return out;
  }
  if(surfaceAbsent(t, s)) return out;
  const re = surfaceRe(s, clitics), cpsLen = [...s].length;
  re.lastIndex = 0;
  let m; while((m = re.exec(t))){
    if([...m[0]].length > cpsLen && blockKeys && blockKeys.has(normKey(m[0]))) continue;
    out.push({ start:m.index, end:m.index+m[0].length, text:m[0] });
  }
  return out;
}
// null when visible more than once: blanking one occurrence would leave the answer, or an
// alt form of it, in plain sight elsewhere. A hyphen-joined repeat of the same form
// (Indonesian anak-anak) is the same token, not a second occurrence, so it merges into one
// span instead of nulling out. `wordsById`, when given, feeds the fused-clitic collision
// guard (findSurface, extendRedupClitic); gapMatch is the only caller with it in scope.
// Builder spans (sentence.spans) replace surface matching whenever the word has any: they
// carry inflected surfaces no w/alt/forms entry lists. One span is the target unless a
// w/alt/forms surface is also visible outside it; two spans mean the word is visible twice.
// Either way blanking would leave the answer in sight, so null, never a regex fallback that
// could blank an unrelated surface (docs/PACK_SCHEMA.md "sentences.json").
function locateWord(sentence, entry, pack, wordsById){
  const spaced = !pack || pack.spaced !== false;
  const clitics = (pack && Array.isArray(pack.clitics)) ? pack.clitics : [];
  const blockKeys = (clitics.length && wordsById) ? packSurfaceKeys(wordsById, pack) : null;
  const t = String(sentence.t || "");
  const own = entrySpans(sentence, entry, wordsById);
  const hits = surfaceHits(sentence.t, entry, spaced, clitics, blockKeys);
  if(own.length > 1) return null;
  if(own.length === 1){
    const m = extendRedupClitic(t, own[0], pack, blockKeys);
    return hits.some(h => h.end <= m.start || h.start >= m.end) ? null : m;
  }
  if(!hits.length) return null;
  const clusterStart = hits[0].start;
  let best = hits[0], end = hits[0].end, merged = false;
  for(const h of hits.slice(1)){
    if(h.start >= end){
      // Compare the matched form, not the matched text: the second half may carry a
      // fused clitic the first half doesn't (alat-alatnya), and they're still one token.
      if(t.slice(end, h.start) === "-" && normKey(h.form) === normKey(best.form)){ end = h.end; merged = true; continue; }
      return null;
    }
    end = Math.max(end, h.end);
    if(h.end - h.start > best.end - best.start) best = h;
  }
  const m = merged ? { start: clusterStart, end, text: t.slice(clusterStart, end) } : best;
  return extendRedupClitic(t, m, pack, blockKeys);
}
function surfaceHits(text, entry, spaced, clitics, blockKeys){
  const hits = [];
  [...new Set(textForms(entry).filter(Boolean))].forEach(f => findSurface(text, f, spaced, clitics, blockKeys).forEach(m => hits.push(Object.assign({ form: f }, m))));
  return hits.sort((a,b)=>a.start-b.start || b.end-a.end);
}
function entrySpans(sentence, entry, wordsById){
  if(!sentence || !Array.isArray(sentence.spans)) return [];
  const t = String(sentence.t || "");
  return keptSpans(sentence, wordsById).filter(h => h.id === entry.id).map(h => ({ start: h.start, end: h.end, text: t.slice(h.start, h.end) }));
}
// The other reduplication side (alat-alatnya: only the half before the hyphen has a clean
// word boundary, since a trailing clitic letter blocks the regex boundary on the second
// half) and a trailing clitic (pack.clitics, docs/PACK_SCHEMA.md) both belong in the blank.
// The right-side repeat needs its own right-boundary check ("mobil-mobilan" is one word,
// not "mobil" reduplicated plus a dangling "an": without the check the blank would stop
// mid-word). blockKeys guards a fused clitic the same way findSurface does.
function extendRedupClitic(t, m, pack, blockKeys){
  let start = m.start, end = m.end; const text = m.text;
  const notWordChar = c => !c || !/[\p{L}\p{M}\p{N}‌‍]/u.test(c);
  if(start - 1 - text.length >= 0 && t.slice(start - 1 - text.length, start) === text + "-") start -= 1 + text.length;
  if(t.slice(end, end + 1 + text.length) === "-" + text && notWordChar(t[end + 1 + text.length])) end += 1 + text.length;
  ((pack && Array.isArray(pack.clitics)) ? pack.clitics : []).forEach(c => {
    if(!c || t.slice(end, end + c.length) !== c) return;
    const after = t[end + c.length] || "";
    if(!notWordChar(after)) return;
    if(blockKeys && blockKeys.has(normKey(t.slice(start, end + c.length)))) return;
    end += c.length;
  });
  return (start === m.start && end === m.end) ? m : { start, end, text: t.slice(start, end) };
}
// pack.compounds: units that aren't drillable words (zh 这个) but must not be cut into.
const SURFACE_CACHE = new WeakMap();
function packSurfaces(wordsById, pack){
  let c = SURFACE_CACHE.get(wordsById);
  if(!c || c.pack !== pack){
    const set = new Set();
    Object.values(wordsById).forEach(w => textForms(w).forEach(x => { if(x) set.add(String(x)); }));
    ((pack && pack.compounds) || []).forEach(x => { if(x) set.add(String(x)); });
    c = { pack, list: [...set], keys: new Set([...set].map(normKey)) };
    SURFACE_CACHE.set(wordsById, c);
  }
  return c.list;
}
function packSurfaceKeys(wordsById, pack){
  packSurfaces(wordsById, pack); // fills/refreshes the cache entry, including .keys
  return SURFACE_CACHE.get(wordsById).keys;
}
// Pack surfaces whose normKey contains `inner`, in packSurfaces order. spannedByLonger asks
// this per gap candidate; scanning + normKey-ing every surface each time dominated the
// simulation (korean: ~100 s/session late). Memoised on the SURFACE_CACHE entry, so it
// dies with the pack's cache; bounded, cleared when full.
function surfacesContaining(wordsById, pack, inner){
  const list = packSurfaces(wordsById, pack), c = SURFACE_CACHE.get(wordsById);
  if(!c.containing) c.containing = new Map();
  let r = c.containing.get(inner);
  if(!r){
    r = list.filter(x => normKey(x).indexOf(inner) >= 0);
    if(c.containing.size >= 5000) c.containing.clear();
    c.containing.set(inner, r);
  }
  return r;
}
// 为 inside 为什么, per inside "per favore": blanking it would cut a longer unit.
function spannedByLonger(sentence, match, wordsById, pack){
  const spaced = !pack || pack.spaced !== false;
  const inner = normKey(match.text);
  for(const s of surfacesContaining(wordsById, pack, inner)){
    if(s.length <= match.text.length) continue;
    for(const m of findSurface(sentence.t, s, spaced)){
      if(m.start <= match.start && m.end >= match.end) return true;
    }
  }
  return false;
}
// The one place gap-candidate selection and the app's gap item share, so they never disagree.
// Design rule: the blank never includes an article. It stays visible ("allons à l'____") and
// the blank covers the bare rest. A span still starting with something its option label
// drops (a reflexive clitic, an elided article the pack does not list) is not a legal blank.
function gapMatch(sentence, entry, wordsById, pack){
  const arts = packArticles(wordsById), bare = bareForm(entry, arts);
  const m = locateWord(sentence, textForms(entry).includes(bare) ? entry : Object.assign({}, entry, { alt: [...(entry.alt||[]), bare] }), pack, wordsById);
  if(!m || spannedByLonger(sentence, m, wordsById, pack)) return null;
  const cut = articleCut(m.text, arts, entry), text = m.text.slice(cut);
  if(trailingCut(text, bare)) return null;
  const start = m.start + cut;
  return { start, end: m.end, text, article: visibleArticle(String(sentence.t).slice(0, start), arts, pack) };
}
function visibleArticle(before, arts, pack){
  const m = before.match(/(\p{L}+['\u2019\u02bc])$/u) || before.match(/(\p{L}+)\s+$/u);
  if(!m) return "";
  const k = surfKey(m[1]);
  return (arts.has(k) || Object.prototype.hasOwnProperty.call(articleAgreement(pack), k)) ? k : "";
}
// Some letter or digit must stay outside the blank: "不客气。" blanked whole is no cloze.
function gapCandidateIndices(sentence, wordsById, pack){
  const fw = new Set((pack && pack.functionWords) || []);
  const words = sentence.words || [];
  const counts = {}; words.forEach(w=>{ counts[w] = (counts[w]||0) + 1; });
  const out = [];
  words.forEach((id,i)=>{
    if(fw.has(id) || counts[id] > 1) return;
    const entry = wordsById[id];
    if(!entry || entry.lv !== sentence.lv) return;
    const m = gapMatch(sentence, entry, wordsById, pack);
    if(!m) return;
    const t = String(sentence.t || "");
    if(!/[\p{L}\p{N}]/u.test(t.slice(0, m.start) + t.slice(m.end))) return;
    out.push(i);
  });
  return out;
}
function blankSentence(sentence, match){
  const t = String(sentence.t);
  return { before: t.slice(0, match.start), after: t.slice(match.end), answer: match.text };
}
const surfKey = s => normKey(s).replace(/[\u2019\u02bc]/g, "'");
// Empty for packs without articles (zh), which disables every article rule below.
const ART_CACHE = new WeakMap();
function packArticles(words){
  if(!words || typeof words !== "object") return new Set();
  let set = ART_CACHE.get(words);
  if(!set){
    set = new Set();
    (Array.isArray(words) ? words : Object.values(words)).forEach(v => {
      if(v && v.pos === "art") textForms(v).forEach(a => { if(a) set.add(surfKey(a)); });
    });
    ART_CACHE.set(words, set);
  }
  return set;
}
// Fixed expressions starting with an article-like word ("un peu", "tout le monde") are
// never cut: only a noun, or a word whose marked bare form is the rest.
const NOUN_POS = /^(noun|n|propn)$/i;
function articleCut(text, arts, entry){
  if(!arts || !arts.size) return 0;
  const t = String(text);
  const m = t.match(/^(\S+?)(\s+|(?<=['\u2019\u02bc]))(?=\S)/u);
  if(!m || !m[1].split("/").every(a => a && arts.has(surfKey(a)))) return 0;
  const rest = t.slice(m[0].length);
  if(arts.has(surfKey(rest))) return 0;
  if(entry){
    const a0 = markedBare(entry);
    if(!NOUN_POS.test(entry.pos || "") && !(a0 && surfKey(a0) === surfKey(rest))) return 0;
  }
  return m[0].length;
}
function trailingCut(text, tail){
  const t = String(text), b = String(tail || "");
  if(!b || b.length >= t.length) return 0;
  const cut = t.length - b.length, sep = t[cut - 1] || "";
  return (surfKey(t.slice(cut)) === surfKey(b) && (/\s/.test(sep) || isApos(sep))) ? cut : 0;
}
// `bare` exists for bare forms that are not typed answers (so they live in `forms`).
// docs/PACK_SCHEMA.md words `bare`.
function markedBare(e){
  if(!e) return undefined;
  if(typeof e.bare === "string" && e.bare) return e.bare;
  return e.alt && e.alt[0];
}
// The marked bare form counts only as a whole trailing token of `w`, so alts that are other
// forms (il -> lo, bello -> bella) or longer elided forms (acqua -> l'acqua) never replace `w`.
function bareForm(e, arts){
  const w = String((e && e.w) || ""), a0 = markedBare(e);
  if(a0 && trailingCut(w, a0)) return String(a0);
  const k = articleCut(w, arts, e);
  return k ? w.slice(k) : w;
}
const CIT_CACHE = new WeakMap();
function citationArticles(v, arts){
  if(!v || typeof v !== "object") return [];
  const hit = CIT_CACHE.get(v);
  if(hit && hit.arts === arts) return hit.list;
  const w = String(v.w || ""), k = articleCut(w, arts, v);
  const list = k ? w.slice(0, k).trim().split("/").map(surfKey) : [];
  CIT_CACHE.set(v, { arts, list });
  return list;
}
// A visible article before a blank tells gender, elision or case. Distractors cited with an
// agreeing article come first so the article never gives the answer away.
// pack.articleAgreement replaces this default.
const ARTICLE_AGREEMENT = {
  fr: { le:["le"], la:["la"], "l'":["l'"], les:["le","la","l'"], un:["le","l'"], une:["la","l'"], du:["le"], au:["le"],
        des:["le","la","l'"], aux:["le","la","l'"] },
  es: { el:["el"], la:["la"], los:["el"], las:["la"], un:["el"], una:["la"], del:["el"], al:["el"] },
  it: { il:["il"], lo:["lo"], la:["la"], "l'":["l'"], i:["il"], gli:["lo","l'"], le:["la","l'"], un:["il","lo","l'"], uno:["lo"],
        una:["la"], "un'":["l'"],
        del:["il"], al:["il"], dal:["il"], nel:["il"], sul:["il"], dello:["lo"], allo:["lo"], dallo:["lo"], nello:["lo"], sullo:["lo"],
        della:["la"], alla:["la"], dalla:["la"], nella:["la"], sulla:["la"], "dell'":["l'"], "all'":["l'"], "dall'":["l'"], "nell'":["l'"], "sull'":["l'"],
        dei:["il"], ai:["il"], dai:["il"], nei:["il"], sui:["il"], degli:["lo","l'"], agli:["lo","l'"], dagli:["lo","l'"], negli:["lo","l'"], sugli:["lo","l'"],
        delle:["la","l'"], alle:["la","l'"], dalle:["la","l'"], nelle:["la","l'"], sulle:["la","l'"] },
  de: { der:["der","die"], die:["die"], das:["das"], den:["der"], dem:["der","das"], des:["der","das"], ein:["der","das"], eine:["die"],
        einen:["der"], einem:["der","das"], einer:["die"], eines:["der","das"], im:["der","das"], am:["der","das"], zum:["der","das"],
        zur:["die"], vom:["der","das"], beim:["der","das"], ins:["das"] },
};
function articleAgreement(pack){
  const own = pack && pack.articleAgreement;
  return (own && typeof own === "object") ? own : (ARTICLE_AGREEMENT[targetLang(pack)] || {});
}
// Options are bare forms: an articled option would clash with the sentence ("le ____"
// offering "la loi") and a bare/articled mix would give the answer away. A word whose own
// surface is the blanked text is never a distractor, since it fits literally: する blanked at
// its form した must not offer 下 (w した).
// like: an optional preference (pack.optsOneScript); with an article preference both must hold.
// pack.gapGender (it es fr de; docs/PACK_SCHEMA.md): a gap whose answer word has `g` prefers distractors of
// the same gender, so "un ____" never offers l'informazione next to un libro. Words without `g`, and a pool
// with fewer than GAP_GENDER_MIN same-gender candidates, behave as without the flag.
const GAP_GENDER_MIN = 3;
function gapGenderOn(pack){ return !!(pack && pack.gapGender === true); }
function gapChoices(entry, match, pool, pack, like, mix){
  const arts = packArticles(pool);
  const show = e => bareForm(e, arts);
  const vis = match && match.article;
  let prefer = null;
  if(vis){
    const ok = new Set(articleAgreement(pack)[vis] || [vis]);
    prefer = v => citationArticles(v, arts).some(a => ok.has(a));
  }
  const blank = match && match.text ? normKey(match.text) : "";
  const fits = v => !!blank && v !== entry && !(v.id != null && v.id === entry.id) && surfaces(v).includes(blank);
  if(gapGenderOn(pack) && entry && typeof entry.g === "string" && entry.g){
    const base = prefer, same = base ? v => base(v) && v.g === entry.g : v => v.g === entry.g;
    if((pool || []).filter(v => v.id !== entry.id && !fits(v) && same(v) && (!like || like(v))).length >= GAP_GENDER_MIN) prefer = same;
  }
  if(like) prefer = prefer ? (p => v => p(v) && like(v))(prefer) : like;
  const ds = wordOpts(entry, blank ? (pool || []).filter(v => !fits(v)) : pool, show, pack, prefer, mix);
  const byLabel = {}; [entry, ...ds].forEach(e => { byLabel[show(e)] = e; });
  return { opts: [show(entry), ...ds.map(show)], a: show(entry), byLabel };
}
function exampleSentences(entry, sentences, pack, n){
  const spaced = !pack || pack.spaced !== false;
  const cands = (sentences||[]).filter(s => (s.words||[]).indexOf(entry.id) >= 0);
  if(!Array.isArray(entry.forms) || !entry.forms.length){
    const seen = s => findSurface(s.t, entry.w, spaced).length ? 0
      : textForms(entry).slice(1).some(a => a && findSurface(s.t, a, spaced).length) ? 1 : 2;
    const tiers = [[], [], []];
    cands.forEach(s => tiers[seen(s)].push(s));
    return [...tiers[0], ...tiers[1], ...tiers[2]].slice(0, n);
  }
  // A word with `forms` (inflected surfaces) can show the same bare headword 5 times running
  // while its inflections go unseen. Cover distinct surface forms instead: the headword's
  // own example first, then rank order picking the first sentence with a not-yet-shown
  // form, then rank order again to pad out to n regardless of form (TODO.md line 18).
  const forms = textForms(entry).filter(Boolean);
  // A span's text maps back to the first form (w first) it equals or shares a trailing token
  // with, so "libro" under w "il libro" keeps the headword slot.
  const spanForm = x => {
    const k = normKey(x);
    const f = forms.find(f => normKey(f) === k || trailingCut(f, x) || trailingCut(x, f));
    return f ? normKey(f) : k;
  };
  const formOf = s => {
    const sp = entrySpans(s, entry);
    if(sp.length) return spanForm(sp[0].text);
    for(const f of forms){ if(findSurface(s.t, f, spaced).length) return normKey(f); } return null; };
  const headKey = normKey(entry.w || "");
  const out = [], used = new Set(), seenForms = new Set();
  const hi = cands.findIndex(s => formOf(s) === headKey);
  if(hi >= 0){ out.push(cands[hi]); used.add(hi); seenForms.add(headKey); }
  for(let i = 0; i < cands.length && out.length < n; i++){
    if(used.has(i)) continue;
    const k = formOf(cands[i]);
    if(k === null || seenForms.has(k)) continue;
    out.push(cands[i]); used.add(i); seenForms.add(k);
  }
  // Padding keeps the old rule: a sentence where the word is actually visible/locatable
  // (even if its form repeats one already shown) still outranks one where it isn't (a
  // compound-absorbed or otherwise unlocatable id-only listing) — plain rank order over
  // both together let an unlocatable sentence jump ahead of a visible repeat.
  for(let i = 0; i < cands.length && out.length < n; i++){
    if(used.has(i) || formOf(cands[i]) === null) continue;
    out.push(cands[i]); used.add(i);
  }
  for(let i = 0; i < cands.length && out.length < n; i++){
    if(used.has(i)) continue;
    out.push(cands[i]); used.add(i);
  }
  return out.slice(0, n);
}
// A hit inside a longer pack word or compound (本 inside 日本) is dropped, as for cloze.
// Builder spans, when the word has any, replace surface matching: every span is bolded.
function highlightParts(sentence, entry, wordsById, pack){
  const t = String((sentence && sentence.t) || "");
  const spaced = !pack || pack.spaced !== false;
  const own = entrySpans(sentence, entry, wordsById);
  const hits = own.length ? own : surfaceHits(t, entry, spaced);
  const clusters = [];
  for(const h of hits){
    const c = clusters[clusters.length-1];
    if(c && h.start < c.end){ c.end = Math.max(c.end, h.end); if(h.end-h.start > c.best.end-c.best.start) c.best = h; }
    else clusters.push({ end: h.end, best: h });
  }
  const keep = clusters.map(c=>c.best).filter(m => !spannedByLonger({ t }, m, wordsById || {}, pack));
  const out = []; let at = 0;
  keep.forEach(m => { if(m.start > at) out.push({ text: t.slice(at, m.start), hit: false }); out.push({ text: t.slice(m.start, m.end), hit: true }); at = m.end; });
  if(at < t.length || !out.length) out.push({ text: t.slice(at), hit: false });
  return out;
}

// A pron differing only by stress marks (де́лать for делать) is kept: the stress is the point.
function pronShown(x){
  const p = x && x.pron; if(!p) return "";
  const k = s => String(s == null ? "" : s).normalize("NFC").trim().toLowerCase();
  return k(p) === k(x.w != null ? x.w : x.t) ? "" : String(p);
}

// Arabic-script search has its own folds, independent of lenient typing (searchFold turns
// LENIENT_LETTERS off). Do-chashmi heh ھ is a distinct phoneme, so it is never folded into ہ.
// Bari ye ے folds to ی at a word boundary so ے/ی gender pairs (بڑے/بڑی) search as one: an
// accepted tradeoff, since the reveal still shows the pack's own spelling.
// ARABIC_VARIANTS runs again last: stripping a carrier's hamza can expose ي (ئ = ي + hamza).
// ٲ ٳ ٵ ٶ ٷ ٸ have no canonical decomposition, so they are mapped directly.
const AR_SEARCH_MAP = { "ٱ":"ا", "ٲ":"ا", "ٳ":"ا", "ٵ":"ا", "ٶ":"و", "ٷ":"و", "ٸ":"ی",
  "ة":"ہ", "ى":"ی", "ۀ":"ہ", "ۃ":"ہ", "ه":"ہ" };
// Search always folds nukta and chandrabindu (strict typing keeps both). NFD first so a
// precomposed nukta letter (U+0958-095F) is caught too.
function foldDevanagari(f){
  return f.normalize("NFD").replace(/़/g, "").replace(/ँ/g, "ं").normalize("NFC");
}
// A doubled word ("धीरे धीरे") folds to one token so doubled, hyphenated and bare spellings
// match either way. Runs after every script fold so equal tokens compare equal.
function foldReduplication(f){
  const parts = f.split(" ");
  const out = [];
  parts.forEach(p => { if(!out.length || out[out.length - 1] !== p) out.push(p); });
  return out.join(" ");
}
function searchFold(s){
  // This pack's roman pron marks nasalisation with a tilde (kahā̃); ASCII typing spells it with
  // a trailing n (kahan), and foldAccents would otherwise discard it. Hyphen to space so
  // धीरे-धीरे and धीरे धीरे search as one phrase.
  const pre = String(s == null ? "" : s).normalize("NFD").replace(/̃/g, "n").normalize("NFC").replace(/-/g, " ");
  let f = normalizeTyped(pre, { foldAccents: true, lenientLetters: false });
  if(/[ऀ-ॿ]/.test(f)) f = foldDevanagari(f);
  if(/[؀-ۿ]/.test(f)){
    f = f.replace(/[ٱ-ٳٵ-ٸةىۀۃه]/g, c => AR_SEARCH_MAP[c]).normalize("NFD").replace(/[ٓ-ٕ]/g, "")
      .replace(/[كي]/g, c => ARABIC_VARIANTS[c]).replace(/ے(?=\s|$)/g, "ی").normalize("NFC");
  }
  return foldReduplication(f);
}
// A leading ال is optional in search: كتاب finds الكتاب, and back.
const stripArabicArticle = f => f.replace(/(^|\s)ال(?=\S{2,})/g, "$1");
// Folded fields are cached per word (SEARCH_CACHE) so a keystroke only compares strings.
function searchForms(x){
  const f = x ? searchFold(x) : "";
  return [...new Set([f, stripArabicArticle(f)])].map(v => ({ f: v, ns: v.replace(/\s/g, "") }));
}
const SEARCH_CACHE = new WeakMap();
function searchFields(v){
  const src = [v.w, v.pron, v.en, ...textForms(v).slice(1)].join("\u0001");
  let r = SEARCH_CACHE.get(v);
  if(r && r.src === src) return r;
  const target = [v.pron, ...textForms(v)].filter(Boolean).flatMap(searchForms);
  const g = gloss(v);
  const senses = g.split(/[,;]/).flatMap(x => [x, x.replace(/^\s*to\s+/i, "")]).flatMap(searchForms);
  r = { src, target, gloss: searchForms(g), senses };
  SEARCH_CACHE.set(v, r);
  return r;
}
function searchWords(words, query, limit){
  const qv = searchForms(query).filter(x => x.f).map(x => ({ q: x.f, qs: x.ns }));
  if(!qv.length) return [];
  const hit = x => qv.some(({ q, qs }) => x.f.includes(q) || (!!qs && x.ns.includes(qs)));
  const same = x => qv.some(({ q, qs }) => x.f === q || (!!qs && x.ns === qs));
  const starts = x => qv.some(({ q }) => x.f.startsWith(q));
  const tiers = [[], [], [], []];
  (words||[]).forEach(v => {
    const r = searchFields(v);
    if(!(r.target.some(hit) || r.gloss.some(hit))) return;
    const t = r.target.some(same) ? 0 : r.senses.some(same) ? 1 : r.target.some(starts) ? 2 : 3;
    tiers[t].push(v);
  });
  const out = [...tiers[0], ...tiers[1], ...tiers[2], ...tiers[3]];
  return limit ? out.slice(0, limit) : out;
}

// docs/PACK_SCHEMA.md "Script display".
function targetLang(pack){
  const tag = pack && typeof pack.langTag === "string" && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(pack.langTag) ? pack.langTag : "";
  return tag || (String((pack && pack.tts) || "").split(/[-_]/)[0].toLowerCase() || "und");
}
// Refuses anything that could leave the CSS declaration (; { } < > \ or a url()).
function fontFamilyOf(pack){
  const f = pack && typeof pack.fontFamily === "string" ? pack.fontFamily.trim() : "";
  if(!f || /[;{}<>\\]|url\s*\(|\/\*/i.test(f)) return null;
  return f;
}
function lineHeightOf(pack){
  const n = pack && pack.lineHeight;
  return (typeof n === "number" && isFinite(n) && n >= 1 && n <= 4) ? n : null;
}
// Google Fonts is the only external resource a page may load.
const FONT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,60}(:[a-z,]+@[0-9.,;]+)?$/;
function fontsHref(pack){
  const list = (pack && Array.isArray(pack.fonts)) ? pack.fonts : [];
  const ok = [], rejected = [];
  list.forEach(f => { (typeof f === "string" && FONT_NAME_RE.test(f.trim()) ? ok : rejected).push(f); });
  if(!ok.length) return { href: null, rejected };
  const fam = ok.map(f => "family=" + f.trim().replace(/ +/g, "+")).join("&");
  return { href: `https://fonts.googleapis.com/css2?${fam}&display=swap`, rejected };
}
// Generic keywords are dropped so a Latin run inside target text (pron, a number) falls
// through to the UI font instead of a generic serif. Split on commas outside quotes: a
// quoted family name may hold a comma.
const GENERIC_FAMILY_RE = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/i;
function fontStackOf(pack){
  const f = fontFamilyOf(pack); if(!f) return null;
  const parts = []; let cur = "", q = "";
  for(const ch of f){
    if(q){ cur += ch; if(ch === q) q = ""; }
    else if(ch === '"' || ch === "'"){ cur += ch; q = ch; }
    else if(ch === ","){ parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  const named = parts.map(x => x.trim()).filter(x => x && !GENERIC_FAMILY_RE.test(x));
  return named.length ? named.join(", ") : null;
}
function scriptDisplay(pack){
  return { lang: targetLang(pack), rtl: !!(pack && pack.rtl === true), fontFamily: fontFamilyOf(pack), fontStack: fontStackOf(pack), lineHeight: lineHeightOf(pack) };
}
// RTL packs (docs/PACK_SCHEMA.md "RTL rendering"): each RTL run gets its own <bdi> so the
// English around it keeps its order. Neutrals between RTL letters take the RTL direction, as
// in the Unicode bidi algorithm, so "از ... متنفرم" stays one run.
const RTL_CH = "\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF";
const RTL_RUN_RE = new RegExp(`[${RTL_CH}](?:(?:[${RTL_CH}]|[^\\p{L}\\p{M}])*[${RTL_CH}])?`, "gu");
function rtlRuns(s){
  const str = s == null ? "" : String(s), out = [];
  let i = 0, m; RTL_RUN_RE.lastIndex = 0;
  while((m = RTL_RUN_RE.exec(str))){
    if(m.index > i) out.push({ t: str.slice(i, m.index), rtl: false });
    out.push({ t: m[0], rtl: true }); i = m.index + m[0].length;
  }
  if(i < str.length) out.push({ t: str.slice(i), rtl: false });
  return out;
}

function strata(pool, bucketSpec, setSize){
  const size = setSize || 10;
  const out = [];
  (bucketSpec||[]).forEach(([lv,nb])=>{
    const list = pool.filter(v=>v.lv===lv);
    const nsets = Math.ceil(list.length/size);
    const per = nsets/nb;
    for(let b=0;b<nb;b++){
      const s0 = Math.floor(b*per), s1 = Math.max(s0+1, Math.floor((b+1)*per));
      out.push({lv, s0, s1, words: list.slice(s0*size, s1*size)});
    }
  });
  return out;
}
// Default matches the fixed 2/3 alternation shipped before this field existed, so a pack
// without it renders byte-identically (flag-off proof).
const DEFAULT_PLACEMENT_ITEMS = [2, 3];
function placementItemCount(bucketIndex, pack){
  const items = (pack && Array.isArray(pack.placementItems) && pack.placementItems.length) ? pack.placementItems : DEFAULT_PLACEMENT_ITEMS;
  return items[bucketIndex % items.length];
}

// The placement stop (owner 2026-10-08: a 1/2 opening bucket zeroed a 22/30 test; the earlier 3-bucket window rule judged the
// first buckets on 2-5 items, so one early miss stopped placement at 0 while the later buckets were asked and discarded; pack
// key placementWhole, default since the flag collapse). The largest passed prefix k wins: accuracy over buckets 0..k-1 >= 0.75 (integers, so exactly 0.75 passes) and
// every bucket in it has a right answer, except an isolated zero (right answers on both sides, the bucket k itself for
// the last one) which is skipped: counted in the accuracy, its words provisional like the rest.
function placementSkipped(res, k){
  const out = [];
  for(let j=0;j<k;j++){
    if(res[j].r >= 1) continue;
    if(j > 0 && res[j-1].r >= 1 && j+1 < res.length && res[j+1].r >= 1) out.push(j);
    else return null;
  }
  return out;
}
function placementStopIndex(res){
  for(let k=res.length;k>=0;k--){
    let r = 0, n = 0;
    for(let j=0;j<k;j++){ r += res[j].r; n += res[j].n; }
    if(r*4 < n*3 || placementSkipped(res, k) == null) continue;
    return k === res.length ? null : k;
  }
  return 0;
}

// Early stop (fb51; owner 2026-10-08: a beginner answered 35 words to learn they know none; pack key placementEarlyStop, default
// since the flag collapse): the items are asked bucket by bucket, and the asking stops once three consecutive asked buckets have
// no right answer. The buckets not asked are in-memory entries {r:0, n:0, skipped:true} (never stored) that the stop rule reads as failed.
// res[0..k] are all asked; true when the last three of them are all zero (so at least three buckets were asked).
function placementEarlyStopAfter(res, k){
  return k >= 2 && res[k].r === 0 && res[k - 1].r === 0 && res[k - 2].r === 0;
}
// The unasked buckets of a result as one entry per level: whole when every bucket of that level was skipped, else the set range.
function placementNotAsked(st, res){
  const out = [];
  st.forEach((b, i) => {
    if(!res[i] || !res[i].skipped) return;
    const last = out[out.length - 1];
    if(last && last.lv === b.lv){ last.s1 = b.s1; last.n++; }
    else out.push({ lv: b.lv, s0: b.s0, s1: b.s1, n: 1 });
  });
  out.forEach(e => { e.whole = e.n === st.filter(b => b.lv === e.lv).length; delete e.n; });
  return out;
}

// Placement only ever moves a learner forward: no word record is removed or downgraded, so
// learned and drilled-ahead state survive a poor retake.
function applyPlacement(prog, st, passed, words, pack, units){
  const out = Object.assign({}, prog, { w: {} });
  Object.keys(prog.w||{}).forEach(k => { out.w[k] = Object.assign({}, prog.w[k]); });
  out.sets = Object.assign({}, defaultProg(pack).sets, prog.sets||{});
  for(let i=0;i<passed;i++){ const b = st[i]; out.sets[b.lv] = Math.max(out.sets[b.lv]||0, b.s1); }
  const ids = levelIds(pack), byLv = wordsByLevel(words, pack), size = setSizeOf(pack);
  const firstIdx = ids.indexOf(String(((pack.placement||[])[0]||[])[0]));
  if(passed > 0 && firstIdx > 0) ids.slice(0, firstIdx).forEach(lv => { out.sets[lv] = Math.max(out.sets[lv]||0, nSets(byLv[lv], size)); });
  // Legacy levels are pinned at their old counters first; then only the prefix this attempt
  // asserted is seeded, never a counter prefix a republish may have shifted.
  pinPrefixRecords(out, words, pack, undefined, prog.sets);
  const seed = {};
  for(let i=0;i<passed;i++){ const b = st[i]; seed[b.lv] = Math.max(seed[b.lv]||0, b.s1); }
  if(passed > 0 && firstIdx > 0) ids.slice(0, firstIdx).forEach(lv => { seed[lv] = nSets(byLv[lv], size); });
  const covered = new Set();
  Object.keys(seed).forEach(lv => (byLv[lv]||[]).slice(0, seed[lv]*size).forEach(w => { covered.add(w.id); if(!out.w[w.id]) out.w[w.id] = {r:1,w:0,s:1,prov:1}; }));
  ids.forEach(lv => settleSetCounter(out, words, pack, lv));
  placeCharUnits(out, pack, units, covered);
  // A placement past the first bucket reads the script (fb52, pack key placedKnown), so the primer is skipped exactly as the learner's
  // own skip writes it (answerScriptChoice); pronUntilPrimer then turns the reading aid off by its own rule.
  if(passed >= 1 && scriptConfig(pack)){
    out.script = isObj(prog.script) ? Object.assign({}, prog.script) : defaultScriptProg();
    if(out.script.choiceSeen !== true) answerScriptChoice(out, false);
  }
  out.placedOnce = true;
  // prog.pl: the level this placement landed in, for pack.eta.placed (docs/PACK_SCHEMA.md "ETA model"); only when no
  // session came before it, since a record with sessions is not a placed start.
  if(!(prog.sessions > 0)){ const land = st[passed] || st[st.length - 1]; if(land) out.pl = String(land.lv); }
  return out;
}

// Placement places the characters layer (fb50; owner 2026-10-08: placed at the top level, then taught the first level's characters
// from set 1; pack.placementChars until the flag collapse, now every characters.learn "lag" pack): under "lag" the units
// are taught separately from the words and the set position is the count of unit records, so a placement
// that seeds 1650 word records leaves the characters layer at 0. The unit sets of the lag plan (ramp chunks per level, else
// setSize chunks of the pack order) whose units all have a unit record or all their words in the prefix this placement
// asserts (placed now, or learned before inside it; a word learned beyond the prefix never counts, so a retake that
// places nothing leaves a learner whose characters lag behind their words alone) are seeded the way a placed word is: {r:1,w:0,s:1,prov:1}, kept in review until known (markChar / unifiedReviewPlan). Only the
// contiguous run of such sets from the start is seeded, so the next ramp chunk stays aligned; a set with one unplaced unit and
// everything after it stay unplaced. Adds records only: a retake never removes or lowers one.
const placementCharsOn = pack => lagOn(pack);
function charPlanSets(pack, units){
  const cfg = charsConfig(pack), list = charStageUnits(levelIds(pack), units, pack), out = [];
  if(cfg.ramp){
    rampPlan(cfg, pack, units).plan.forEach(lp => {
      const lu = list.filter(u => String(u.lv) === lp.lv); let pos = 0;
      lp.sizes.forEach((sz, k) => { out.push({ lv: lp.lv, k, units: lu.slice(pos, pos + sz) }); pos += sz; });
    });
    return out;
  }
  const seen = {};
  for(let i = 0; i < list.length; i += cfg.setSize){
    const chunk = list.slice(i, i + cfg.setSize), lv = String(chunk[0].lv);
    out.push({ lv, k: Math.floor((seen[lv] || 0) / cfg.setSize), units: chunk });
    chunk.forEach(u => { seen[String(u.lv)] = (seen[String(u.lv)] || 0) + 1; });
  }
  return out;
}
// The run of sets from the start that are fully recorded or whose units' words all lie in `covered` (a Set of word ids).
function placedCharSets(pack, units, covered, recs){
  const run = [];
  for(const s of charPlanSets(pack, units)){
    if(!s.units.length || !s.units.every(u => hasCharRec(recs, u.id) || ((u.words || []).length > 0 && !!covered && u.words.every(id => covered.has(id))))) break;
    run.push(s);
  }
  return run;
}
function placeCharUnits(out, pack, units, covered){
  if(!placementCharsOn(pack) || !Array.isArray(units) || !units.length) return 0;
  const recs = charRecs(out), add = [];
  placedCharSets(pack, units, covered, recs).forEach(s => s.units.forEach(u => { if(!hasCharRec(recs, u.id)) add.push(u.id); }));
  if(!add.length) return 0;
  // out.chars is the input's object until cloned (applyPlacement is pure).
  out.chars = Object.assign({}, ensureChars(Object.assign({}, out)), { c: Object.assign({}, recs) });
  add.forEach(id => { out.chars.c[id] = { r:1, w:0, s:1, prov:1 }; });
  return add.length;
}
// "Characters: placed through <level>, set N" on the result screen: the last set of the recorded run, level-local number.
function placedCharsThrough(pack, units, prog){
  if(!placementCharsOn(pack) || !Array.isArray(units) || !units.length) return null;
  const run = placedCharSets(pack, units, null, charRecs(prog));
  const last = run[run.length - 1];
  return last ? { lv: last.lv, set: last.k + 1 } : null;
}
// Today's Sounds hint when placement places the characters layer (fb50; owner 2026-10-08: placed at the top level, Today still said "Start the first lesson"):
// derived from the counters, nothing stored. A placement that passed at least two buckets has raised the second bucket's level to
// its end; the first bucket alone (or none) leaves the learner at the start, where the hint still helps.
function placedPastFirstBucket(prog, words, pack){
  if(!placementCharsOn(pack) || !prog || !prog.placedOnce) return false;
  const b = strata(words, pack.placement, setSizeOf(pack))[1];
  return !!b && ((prog.sets || {})[b.lv] || 0) >= b.s1;
}

// One entry per word or sentence, whatever question type it was missed as.
function dedupeMisses(miss){
  const by = new Map();
  (miss||[]).forEach((m, i) => {
    const k = m.key != null ? m.key : `#${i}`;
    const e = by.get(k);
    if(e) e.count++; else by.set(k, { item: m, count: 1, order: by.size });
  });
  return [...by.values()].sort((a,b)=>b.count-a.count || a.order-b.order).map(({item, count})=>({item, count}));
}

const PROG_VERSION = 1;
const WORD_MASTERED = 3;
const SENTENCE_MASTERED = 2;  // sentences draw on several known words at once: lower bar
function storageKey(pack){ return `vocab_${pack.key}`; }
function defaultProg(pack){
  const sets = {}; levelIds(pack).forEach(id=>{ sets[id] = 0; });
  const p = { v:PROG_VERSION, w:{}, s:{}, sets, lessons:{}, sessions:0, theme:null, showPron: pack.showPron !== false, placedOnce:false };
  // A script pack (pronUntilPrimerOn): no stored showPron means the learner never chose, so showPronOn derives the default.
  if(pronUntilPrimerOn(pack)) delete p.showPron;
  if(charsConfig(pack)) p.chars = seedCharOrder(defaultCharsProg(), pack); // absent without pack.characters: flag-off shape unchanged
  if(scriptConfig(pack)) p.script = defaultScriptProg(); // absent without pack.script: likewise
  return p;
}
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
function validateRecMap(m, name, allowWordFlags){
  if(!isObj(m)) return `${name} must be an object`;
  for(const k of Object.keys(m)){
    const p = m[k];
    if(!isObj(p)) return `${name}.${k} must be an object`;
    for(const f of ["r","w","s","f"]) if(p[f] !== undefined && typeof p[f] !== "number") return `${name}.${k}.${f} must be a number`;
    if(allowWordFlags){
      for(const f of ["prov","d"]) if(p[f] !== undefined && typeof p[f] !== "number" && typeof p[f] !== "boolean") return `${name}.${k}.${f} must be a number or boolean`;
    }
  }
  return null;
}
function validateProgShape(data, levelIdList){
  if(!isObj(data)) return {ok:false, reason:"not a JSON object"};
  if(data.v !== undefined && data.v !== PROG_VERSION) return {ok:false, reason:`unknown progress version ${data.v}`};
  for(const b of ["w","s"]){
    if(data[b] === undefined) continue;
    const e = validateRecMap(data[b], b, b === "w"); if(e) return {ok:false, reason:e};
  }
  if(data.sets !== undefined){
    if(!isObj(data.sets)) return {ok:false, reason:"sets must be an object"};
    const allowed = new Set((levelIdList||[]).map(String));
    for(const k of Object.keys(data.sets)){
      if(!allowed.has(k)) return {ok:false, reason:`sets has unknown level "${k}"`};
      if(!Number.isInteger(data.sets[k]) || data.sets[k] < 0) return {ok:false, reason:`sets.${k} must be a non-negative integer`};
    }
  }
  if(data.lessons !== undefined && !isObj(data.lessons)) return {ok:false, reason:"lessons must be an object"};
  if(data.sessions !== undefined && typeof data.sessions !== "number") return {ok:false, reason:"sessions must be a number"};
  if(data.showPron !== undefined && typeof data.showPron !== "boolean") return {ok:false, reason:"showPron must be a boolean"};
  if(data.placedOnce !== undefined && typeof data.placedOnce !== "boolean" && typeof data.placedOnce !== "number") return {ok:false, reason:"placedOnce must be a boolean or number"};
  if(data.soundsOpened !== undefined && typeof data.soundsOpened !== "boolean" && typeof data.soundsOpened !== "number") return {ok:false, reason:"soundsOpened must be a boolean or number"};
  if(data.theme !== undefined && data.theme !== null && data.theme !== "light" && data.theme !== "dark") return {ok:false, reason:"theme must be null, \"light\" or \"dark\""};
  if(data.read !== undefined){ const e = validateReadShape(data.read); if(e) return {ok:false, reason:e}; }
  if(data.pm !== undefined && !(Array.isArray(data.pm) && data.pm.every(e => isObj(e) && typeof e.sn === "number" && typeof e.p === "number" && (e.g === undefined || typeof e.g === "number")))) return {ok:false, reason:"pm must be a list of {sn, p, g?}"};
  if(data.chars !== undefined){ const e = validateCharsShape(data.chars); if(e) return {ok:false, reason:e}; }
  if(data.script !== undefined){ const e = validateScriptShape(data.script); if(e) return {ok:false, reason:e}; }
  return {ok:true, data};
}
function normalizeProg(data, pack){
  const base = defaultProg(pack);
  const merged = Object.assign({}, base, data||{}, {v:PROG_VERSION});
  merged.sets = Object.assign({}, base.sets, (data && data.sets) || {});
  for(const k of ["w","s","lessons"]) if(!isObj(merged[k])) merged[k] = {};
  if(charsConfig(pack)) merged.chars = seedCharOrder(normalizeCharsProg(data && data.chars), pack);
  if(scriptConfig(pack)) merged.script = normalizeScriptProg(data && data.script, data);
  merged.w = dropBadMissKinds(merged.w);
  return merged;
}
// Records without k, or with a valid one, stay the same objects so they round-trip unchanged.
function dropBadMissKinds(w){
  let out = w;
  Object.keys(w).forEach(id => {
    const p = w[id];
    if(!isObj(p) || p.k === undefined || MISS_KINDS.includes(p.k)) return;
    if(out === w) out = Object.assign({}, w);
    const q = Object.assign({}, p); delete q.k; out[id] = q;
  });
  return out;
}
// Only a JSON object is progress: arrays, strings, numbers and null are never Object.assign'ed.
function parseStored(raw){
  let data;
  try{ data = JSON.parse(raw); }catch(e){ return {ok:false, reason:"not valid JSON"}; }
  if(!isObj(data)) return {ok:false, reason:"not a JSON object"};
  return {ok:true, data};
}
// Boot-time leniency: a pack that renamed or removed a level must not wipe everything else.
// Manual import stays strict.
function dropUnknownSets(data, levelIdList){
  const allowed = new Set((levelIdList||[]).map(String));
  if(!isObj(data) || !isObj(data.sets)) return { data, dropped: [] };
  const dropped = Object.keys(data.sets).filter(k=>!allowed.has(k));
  if(!dropped.length) return { data, dropped };
  const sets = {}; Object.keys(data.sets).forEach(k=>{ if(allowed.has(k)) sets[k] = data.sets[k]; });
  return { data: Object.assign({}, data, { sets }), dropped };
}
// An unusable stored value is returned as backupRaw so it is preserved before the defaults
// replace it. readError: nothing is known about what is stored, so the session runs
// read-only rather than risk a save clobbering real progress that merely failed to load.
function bootProg(raw, pack, readError){
  const out = { prog: defaultProg(pack), backupRaw: null, dropped: [], reason: null, readOnly: false };
  if(readError){ out.readOnly = true; out.reason = "storage read failed"; return out; }
  if(raw == null || raw === "") return out;
  const p = parseStored(raw);
  if(!p.ok){ out.backupRaw = String(raw); out.reason = p.reason; return out; }
  const d = dropUnknownSets(p.data, levelIds(pack));
  const v = validateProgShape(d.data, levelIds(pack));
  if(!v.ok){ out.backupRaw = String(raw); out.reason = v.reason; return out; }
  out.dropped = d.dropped;
  out.prog = normalizeProg(d.data, pack);
  return out;
}
// theme and showPron survive an import that doesn't carry them.
function applyImport(prev, text, pack){
  const p = parseStored(text);
  if(!p.ok) return p;
  // The file's v is its format version (PROG_VERSION); a newer file is refused whole, before any read.
  if(typeof p.data.v === "number" && p.data.v > PROG_VERSION) return {ok:false, newer:true, reason:`This file was exported by a newer version of the app (v${p.data.v}). Update the app, then import.`};
  const v = validateProgShape(p.data, levelIds(pack));
  if(!v.ok) return v;
  const prog = normalizeProg(v.data, pack);
  if(v.data.theme === undefined) prog.theme = prev ? prev.theme : null;
  if(v.data.showPron === undefined && prev && prev.showPron !== undefined) prog.showPron = prev.showPron;
  // The characters mix preference survives an import that doesn't carry it, like theme.
  if(prog.chars && !(isObj(v.data.chars) && v.data.chars.mix !== undefined) && prev && isObj(prev.chars) && typeof prev.chars.mix === "boolean") prog.chars.mix = prev.chars.mix;
  return {ok:true, prog};
}
// A miss remembers the shown kind as p.k so the next review asks the word the same way; a
// pass in that kind clears it (user decision 2026-09-28). reqKind also clears, or a
// fallback kind (hear shown as read) would leave k stuck.
function markRec(map, key, ok, isWord, kind, reqKind){
  const p = map[key] || {r:0,w:0,s:0};
  if(ok){ p.r++; p.s++; } else { p.w++; p.s=0; }
  if(isWord && p.prov && (p.s>=WORD_MASTERED || !ok)) delete p.prov;
  if(isWord) setMissKind(p, ok, kind, reqKind);
  map[key] = p; return p;
}
// Words by typed (docs/PACK_SCHEMA.md "wordsBy", default since the flag collapse; owner 2026-10-03: selecting a word does not
// count the same as writing it). From WORD_HOLD a word moves up only by a typed answer (kind "type":
// characters, reading or meaning typed); a right choice or ear answer holds it and a miss steps it
// down one, the characters.bareBy rule for words. Below WORD_HOLD, markRec.
// o.typable false (no typed kind fits the word as shown: 北京 while shown by its reading): markRec,
// as typedUnitWords exempts such units. o.retry (a miss earlier in this drill stepped the word down
// from WORD_HOLD+; app.html wordRetry): no streak credit, as markUnitTyped gives the in-drill retry none
// (review fb18 HIGH 1), but it settles the missed kind k as markRec does (engine_checks typed-fallback drill).
const WORD_HOLD = 2;
function markWordRec(map, key, ok, kind, reqKind, pack, o){
  const p = map[key], x = o || {};
  if(!isObj(p) || x.typable === false) return markRec(map, key, ok, true, kind, reqKind);
  if(x.retry){ if(ok) p.r++; else p.w++; setMissKind(p, ok, kind, reqKind); return p; }
  if((p.s || 0) < WORD_HOLD) return markRec(map, key, ok, true, kind, reqKind);
  if(ok){ p.r++; if(kind === "type") p.s++; } else { p.w++; p.s--; }
  if(p.prov && (p.s>=WORD_MASTERED || !ok)) delete p.prov;
  setMissKind(p, ok, kind, reqKind);
  return p;
}
function setMissKind(p, ok, kind, reqKind){
  if(!MISS_KINDS.includes(kind)) return false;
  if(!ok){ if(p.k === kind) return false; p.k = kind; return true; }
  if(p.k !== undefined && (p.k === kind || p.k === reqKind)){ delete p.k; return true; }
  return false;
}
// Only the blanked word's k changes: the sentence record carries the answer.
function markMissKind(map, key, ok, kind){
  const p = map[key];
  return isObj(p) ? setMissKind(p, ok, kind) : false;
}
const weakScore = rec => { const p = rec || {r:0,w:0,s:0}; return (p.w||0)*3 - (p.s||0); };
// Weakest first with jitter (ties and near-ties shuffle so reviews don't repeat).
function weakFirst(list, n, recs, keyOf, rng){
  const r = rng || Math.random; const key = keyOf || (x=>x.id);
  return list.map(x=>({x, k: weakScore((recs||{})[key(x)]) + (r()-0.5)})).sort((a,b)=>b.k-a.k).slice(0,n).map(o=>o.x);
}
function provPick(list, n, wrecs){
  return shuffle(list.filter(x=>{ const p = (wrecs||{})[x.id]; return p && p.prov && (p.s||0) < WORD_MASTERED; })).slice(0,n);
}

// A word is learned once it has a word record: every path that creates one teaches or
// drills the word (Learn, Words-tab drill, review), asserts it (placement) or flags it `d`
// (a passage weak word). The set counter only feeds progress bars, because a republish that
// reorders or edits a level would shift a counter-derived prefix (TODO.md, 2026-09-28).
// A level without a taught record falls back to its counter prefix plus `d` words: legacy
// exports and seeds carry sets without word records, and `d` (drilled ahead of the counter)
// says nothing about the counter's own prefix.
const taughtRec = (r, w) => !!(r[w.id] && !r[w.id].d);
// Frequency tiers reorder each level by frequency, but every stored counter was written against
// the earlier order, which is id order (ids are append-only and were assigned in it), so a
// counter prefix is read in id order (docs/PACK_SCHEMA.md "freqTiers").
function counterOrder(list, pack){
  return list.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function levelLearned(list, sets, size, recs, pack){
  const r = recs || {};
  if(list.some(w => taughtRec(r, w))) return list.filter(w => r[w.id]);
  const pre = counterOrder(list, pack).slice(0, (sets||0)*size); const seen = new Set(pre.map(w => w.id));
  return pre.concat(list.filter(w => !seen.has(w.id) && r[w.id]));
}
function learnedWords(words, pack, prog){
  const size = setSizeOf(pack); const byLv = wordsByLevel(words, pack);
  const out = [];
  levelIds(pack).forEach(lv=>{ out.push(...levelLearned(byLv[lv], (prog.sets||{})[lv], size, prog.w, pack)); });
  return out;
}
// `set` names the set that holds fresh[0] by its position in the level's list (rank order),
// not the counter: a records-less prefix or an inserted untaught word can put fresh[0] in a
// different set than the counter says, and the label must match what is actually taught.
function levelNewSet(words, pack, prog, lv){
  const size = setSizeOf(pack); const list = wordsByLevel(words, pack)[lv] || [];
  const done = (prog.sets||{})[lv]||0;
  const got = new Set(levelLearned(list, done, size, prog.w, pack).map(w => w.id));
  const fresh = list.filter(w => !got.has(w.id)).slice(0, size);
  if(!fresh.length) return null;
  // Learned words sit anywhere in the frequency order (taught under the earlier order), so the
  // set is the count of sets already learned.
  return { lv, set: Math.min(Math.floor(got.size / size), nSets(list, size) - 1), words: fresh };
}
// The counter only feeds bars and labels, so it follows the records: a teach that finishes one
// set's leftovers and then most of the next must move it past both (TODO.md, set counter lag).
// The stored value stays a floor, except when a republish shrank the level below it.
function settleSetCounter(prog, words, pack, lv){
  const size = setSizeOf(pack), list = wordsByLevel(words, pack)[lv] || [], n = nSets(list, size);
  if(!isObj(prog.sets)) prog.sets = {};
  if(!levelNewSet(words, pack, prog, lv)) return (prog.sets[lv] = n);
  const r = prog.w || {};
  const lead = Math.min(n, Math.floor(list.filter(w => r[w.id]).length / size));
  return (prog.sets[lv] = Math.max(Math.min(prog.sets[lv] || 0, n), lead));
}
function nextNewSet(words, pack, prog){
  for(const lv of levelIds(pack)){
    const nn = levelNewSet(words, pack, prog, lv);
    if(nn) return nn;
  }
  return null;
}
// Level gate (docs/PACK_SCHEMA.md "levelGate", a constant since the flag collapse; owner 2026-10-07): the first level with untaught
// words opens only when the level before it is known to LEVEL_GATE. Evaluated where Today plans;
// nothing is stored, and the word level keeps its own order inside.
const LEVEL_GATE = 0.7;
function levelKnownPct(words, pack, prog, lv, units){
  const list = wordsByLevel(words, pack)[lv] || [], r = (prog && prog.w) || {}, bw = knownCtx(pack, units);
  return list.length ? list.filter(w => wordKnownP(r[w.id], w, pack, prog, bw)).length / list.length : 1;
}
// pack.levelExam (docs/PACK_SCHEMA.md "levelExam"; owner 2026-10-07): per level, what the exam asks. On a
// "characters" level a word is known (level counts, goals, levelGate) only when its character unit's wm pair
// is also at BARE_PAIR in the unit's OWN wm stream (never the word record: word-side answers run under pronFirst/lag with the reading shown, so they do not test reading): the written form is read for meaning.
// Neither stream answered yet (a record from before pairs): the unit's legacy streak boots the pair as
// pairState does for words, else every existing learner would drop to 0 and, the booted pair being
// "known", never be asked again. Any other level, or a word with no unit, keeps the word rule.
// wordKnown itself (prov, mastered) is untouched.
const levelExamOn = pack => !!(pack && isObj(pack.levelExam) && Object.values(pack.levelExam).includes("characters") && charsConfig(pack));
const knownCtx = (pack, units) => levelExamOn(pack) ? unitByWord(units) : null;
function wordKnownX(rec, word, pack, prog, byWord){
  if(!wordKnown(rec, word, pack)) return false;
  if(!byWord || !word || pack.levelExam[String(word.lv)] !== "characters") return true;
  const u = byWord.get(word.id); if(!u) return true;
  const ur = charRecs(prog)[u.id], own = isObj(ur) && isObj(ur.p) ? pairEntry(ur.p.wm) : null;
  return (own ? own[0] : isObj(ur) ? pairState(ur, "wm").s : 0) >= BARE_PAIR;
}
// Placed known (docs/PACK_SCHEMA.md "placedKnown", default since the flag collapse; fb52, owner 2026-10-08: placed at the top level, Today read
// "Goal 1 of 3 ≈ 96 sessions" on an empty bar and the gate "Now 0%"): a record placement seeded provisional (prov, from
// applyPlacement / pinPrefixRecords / placeCharUnits; dropped by the first miss and at mastered / known) counts as known for
// position only: the level gate and its sentence, the goal bars, the progress map and the ETA position. Review picks,
// mastered counts (Progress rows, totals), typed tiers, Still shaky, Test pools and wordKnownX (levelExam) keep it provisional.
const placedProv = rec => isObj(rec) && !!rec.prov;
const posKnown = (pack, rec) => placedProv(rec);
// On a levelExam "characters" level a word whose prov settled at known (settleProv) still waits on its unit's exam; while that
// unit is itself placed-provisional the word keeps counting, so the gate does not close again between the two.
function wordKnownP(rec, word, pack, prog, byWord){
  if(posKnown(pack, rec) || wordKnownX(rec, word, pack, prog, byWord)) return true;
  const u = byWord && word ? byWord.get(word.id) : null;
  return !!u && posKnown(pack, charRecs(prog)[u.id]) && wordKnown(rec, word, pack);
}
// { lv, prev, pct } while the first level with untaught words waits; else null.
function levelGateHold(words, pack, prog, units){
  const nn = nextNewSet(words, pack, prog), ids = levelIds(pack);
  const i = nn ? ids.indexOf(nn.lv) : -1;
  if(i < 1) return null;
  const pct = levelKnownPct(words, pack, prog, ids[i - 1], units);
  return pct + 1e-9 >= LEVEL_GATE ? null : { lv: nn.lv, prev: ids[i - 1], pct: Math.floor(pct * 100) };
}
const levelGateNote = (words, pack, prog, units) => { const h = levelGateHold(words, pack, prog, units); return h ? `${levelLabel(pack, h.lv)} waits · ${levelLabel(pack, h.prev)} at ${h.pct}% known` : null; };
// What Today teaches: nextNewSet unless the gate holds.
const nextNewSetOpen = (words, pack, prog, units) => levelGateHold(words, pack, prog, units) ? null : nextNewSet(words, pack, prog);
// Before the first record lands in a records-less level, its counter prefix gets placement's
// provisional records, so switching the level to the records rule loses nothing.
function pinPrefixRecords(prog, words, pack, lv, counters){
  const size = setSizeOf(pack); const byLv = wordsByLevel(words, pack); const sets = counters || prog.sets || {};
  if(!isObj(prog.w)) prog.w = {};
  (lv === undefined ? levelIds(pack) : [String(lv)]).forEach(id => {
    const list = byLv[id] || [];
    if(list.some(w => taughtRec(prog.w, w))) return;
    counterOrder(list, pack).slice(0, (sets[id]||0)*size).forEach(w => { if(!prog.w[w.id]) prog.w[w.id] = {r:1,w:0,s:1,prov:1}; });
  });
  return prog;
}
// Record creation goes through here so a records-less level is pinned before it changes rule.
function ensureWordRec(prog, words, pack, id){
  if(prog.w && prog.w[id]) return prog.w[id];
  const w = (words||[]).find(x => x.id === id);
  if(w) pinPrefixRecords(prog, words, pack, w.lv);
  if(!isObj(prog.w)) prog.w = {};
  return prog.w[id] || (prog.w[id] = {r:0,w:0,s:0});
}
function currentLevelIndex(words, pack, prog){
  const nn = nextNewSet(words, pack, prog);
  return nn ? levelIndexMap(pack)[nn.lv] : levelIds(pack).length;
}
// known (pauseNew paused): only sentences of learned words, so no unlearned word is shown.
function availableSentences(sentences, words, pack, prog, known){
  const lw = new Set(learnedWords(words, pack, prog).map(w=>w.id));
  const cur = currentLevelIndex(words, pack, prog); const idx = levelIndexMap(pack);
  return (sentences||[]).filter(s => (!known && cur > idx[s.lv]) || (s.words||[]).every(id=>lw.has(id)));
}
// Pause new material (docs/PACK_SCHEMA.md "pauseNew", default since the flag collapse; owner 2026-10-02: "stop progression"): with
// prog.pause 1, Today teaches nothing new. Unpausing deletes the field, so the record is as before.
const pauseOn = (pack, prog) => !!(prog && prog.pause === 1);
function setPause(prog, on){ if(on) prog.pause = 1; else delete prog.pause; return prog; }

// Plans live here, DOM-free, so composition rules are testable under Node.
const PRODUCTION_KINDS = ["recall","type"];
const MISS_KINDS = ["recall","type","hear","read"];
const REVIEW_SIZE = 15, REVIEW_PROV = 5, REVIEW_PRODUCTION_SHARE = 0.4;
function kindMix(n, share, typing, rng){
  const nProd = Math.ceil(n*share - 1e-9);
  const kinds = [];
  for(let i=0;i<nProd;i++) kinds.push(typing && i%2===1 ? "type" : "recall");
  for(let i=0;i<n-nProd;i++) kinds.push(i%3===2 ? "read" : "hear");
  return shuffle(kinds, rng);
}
// Character and script units join one ranking only when some are recorded. With none the
// word-only code runs unchanged, so the output is identical to a word-only plan.
function buildReviewPlan(learned, prog, pack, opts){
  // o.extra (pauseNew): more items; day-aware plans take them only where no same-day repeat results.
  const o = opts || {}; const day = o.today; const n = (o.size || REVIEW_SIZE) + (day ? 0 : o.extra || 0);
  if(day) return dayReviewPlan(learned, prog, pack, n, o);
  const ru = recordedUnits(o.units, prog, pack);
  const rs = recordedScriptUnits(o.script, prog, pack);
  if(ru.length || rs.length) return hearableKinds(unifiedReviewPlan(learned, ru, prog, pack, n, o.rng, rs, Object.assign({ units: o.script }, o.scriptCtx || {}), o), o.canHear);
  const pv = provPick(learned, Math.min(REVIEW_PROV, n), prog.w);
  const pvSet = new Set(pv.map(w=>w.id));
  const rest = weakFirst(learned.filter(x=>!pvSet.has(x.id)), n - pv.length, prog.w, null, o.rng);
  const pool = shuffle([...rest, ...pv], o.rng);
  const kinds = kindMix(pool.length, REVIEW_PRODUCTION_SHARE, typingEnabled(pack), o.rng);
  return hearableKinds(applyMissedKinds(pool.map((word,i)=>({ kind: kinds[i], word })), prog, pack, false, o), o.canHear);
}
function buildRecallPlan(learned, prog, pack, n, opts){
  const o = opts || {};
  if(o.today) return dayRecallPlan(learned, prog, pack, n, o);
  const ru = recordedUnits(o.units, prog, pack);
  if(ru.length) return hearableKinds(unifiedRecallPlan(learned, ru, prog, pack, n, o.rng, o), o.canHear);
  const pool = weakFirst(learned, n, prog.w);
  const kinds = kindMix(pool.length, 1, typingEnabled(pack));
  return hearableKinds(applyMissedKinds(pool.map((word,i)=>({ kind: kinds[i], word })), prog, pack, true, o), o.canHear);
}
// A word this device cannot play is never planned as a listening item: hear becomes read
// after the mix, so no rng is drawn and a plan whose words are all playable is unchanged
// (owner decision 2026-09-30: the no-voice notice is for a voice lost mid-session only).
function hearableKinds(plan, canHear){
  if(typeof canHear !== "function") return plan;
  // reqKind "hear": a pass on the read stand-in still clears a remembered hear miss (k).
  return plan.map(it => it.kind === "hear" && it.word && !canHear(it.word) ? Object.assign({}, it, { kind: "read", reqKind: "hear" }) : it);
}
// Swapping kinds with a partner keeps the plan's kinds exactly kindMix's, so Review keeps its
// production share. At most ceil(n/2) words move, so a plan full of k never becomes all
// repeats of one kind. No rng is drawn: progress without k gives the plan unchanged.
function applyMissedKinds(plan, prog, pack, production, opts){
  if(opts && opts.missedKinds === false) return plan;
  const recs = (prog && prog.w) || {}; const typing = typingEnabled(pack);
  const want = it => {
    const k = it.word && recs[it.word.id] && recs[it.word.id].k;
    if(!MISS_KINDS.includes(k)) return null;
    const kind = production && !PRODUCTION_KINDS.includes(k) ? "recall" : k;
    return kind === "type" && !typing ? "recall" : kind;
  };
  const wordIdx = plan.map((it, i) => it.word ? i : -1).filter(i => i >= 0);
  const wanted = wordIdx.map(i => ({ i, k: want(plan[i]) })).filter(x => x.k);
  if(!wanted.length) return plan;
  const out = plan.slice(); const kindAt = i => out[i].kind;
  const settled = new Set(wanted.filter(x => kindAt(x.i) === x.k).map(x => x.i));
  const cap = Math.ceil(wordIdx.length / 2); let moved = 0;
  const order = wanted.filter(x => !settled.has(x.i))
    .map((x, n) => ({ x, n, w: weakScore(recs[out[x.i].word.id]) }))
    .sort((a, b) => b.w - a.w || a.n - b.n).map(o => o.x);
  const wantOf = new Map(wanted.map(x => [x.i, x.k]));
  for(const x of order){
    if(moved >= cap) break;
    const cands = wordIdx.filter(j => j !== x.i && !settled.has(j) && kindAt(j) === x.k);
    const free = cands.filter(c => !wantOf.has(c)); const j = free.length ? free[0] : cands[0];
    if(j === undefined) continue;
    const mine = kindAt(x.i);
    out[x.i] = Object.assign({}, out[x.i], { kind: x.k });
    out[j] = Object.assign({}, out[j], { kind: mine });
    settled.add(x.i); moved++;
    if(wantOf.get(j) === mine) settled.add(j);
  }
  return out;
}
// Day-aware planning (docs/PACK_SCHEMA.md "dayAware", default since the flag collapse; owner feedback 2026-10-02: with many
// sessions a day the same items came back while important recalls never did). weakScore has
// no notion of today or of time: every session ranked the same lifetime-weak units first and a
// mastered unit was never refreshed. prog.day logs today's answers per item key ("w:", "c:",
// "s:", "x:"): r the kinds answered right, c / m the drill ordinal of the last right answer /
// miss. Records gain t, the day number of the last answer.
// The planner's clock is the session ordinal prog.sn (owner 2026-10-02: "count by sessions rather
// than days?"): records and log entries keep u, the session of the last answer, so "longest
// unseen" means something within one day of many sessions; the date is the tie-break.
const DAY_REFRESH_SHARE = 0.2, DAY_AGAIN_SHARE = 0.25, DAY_CONSOLIDATE_SHARE = 0.15;
// characters.bareBy "typed": units between mastered and bare move only by typed answers, so they
// get a larger share (review 2026-10-02: at 0.15 they reached bare slower than by choice credit;
// owner 2026-10-03, readings not removed fast enough: 0.25 -> 0.35, with zh characters.bare 6 -> 5, took
// 347 of 353 held units to bare in 4 weeks on the owner export against 12, fb8 reading-pace runs).
const DAY_TYPED_CONSOLIDATE_SHARE = 0.35;
// "Already right, ask another kind" covers today and the last DAY_RECENT_SESSIONS sessions, so the
// first session after midnight does not replay the evening's items.
const DAY_RECENT_SESSIONS = 2;
// At most this share of a plan is pending misses (review 2026-10-02: 60 carried misses made a whole
// Review old misses); the rest stay pending for the next session.
const DAY_MISS_SHARE = 0.6;
// Safety net for a miss no planner can settle: once asked again at least once and still pending
// DAY_MISS_MAX_SESSIONS sessions after it, it is dropped (the broken streak keeps the unit weak).
const DAY_MISS_MAX_SESSIONS = 6;
// A log from another day, or one an older engine or an import mangled, is a fresh day: the log
// is never validated at boot, so it can never reset the progress record.
// A new day carries over every unsettled miss (it stays first however many days pass) and the
// right kinds of the last sessions; nothing else.
function dayLog(prog, today){
  const d = prog && prog.day;
  return isObj(d) && d.d === today && isObj(d.a) && Number.isInteger(d.n) ? d : { d: today, n: 0, a: dayCarry(d, daySn(prog)) };
}
function dayCarry(d, sn){
  const out = {};
  if(!isObj(d) || !isObj(d.a)) return out;
  Object.keys(d.a).forEach(k => {
    const e = d.a[k]; if(!isObj(e)) return;
    const mk = Array.isArray(e.mk) && !dayAged(e, sn) ? e.mk.filter(x => typeof x === "string") : [];
    const r = dayRecentU(e, sn) && Array.isArray(e.r) ? e.r.filter(x => typeof x === "string") : [];
    const ag = String(k)[0] === "c" && dayAgedOut(e, sn);
    if(!mk.length && !r.length && !ag) return;
    const c = {}; if(mk.length){ c.mk = mk; if(typeof e.ms === "number") c.ms = e.ms; if(e.ma) c.ma = 1; } if(r.length){ c.r = r; c.u = e.u; } if(ag) c.ag = 1;
    out[k] = c;
  });
  return out;
}
function daySn(prog){ return prog && Number.isInteger(prog.sn) && prog.sn > 0 ? prog.sn : 0; }
// A Today session counts once (app.html Start today), any other drill once; Today's own steps and
// a resumed session never do.
function daySessionStart(prog, pack){
  if(!prog) return false;
  prog.sn = daySn(prog) + 1;
  return true;
}
function dayStart(prog, pack, today, newSession){
  if(!prog) return false;
  const d = prog.day = dayLog(prog, today); d.n++;
  if(newSession) daySessionStart(prog, pack);
  return true;
}
const dayRecentU = (e, sn) => typeof e.u === "number" && sn > 0 && e.u >= sn - DAY_RECENT_SESSIONS;
// Right today (c), or right in the last sessions (u, carried over midnight).
const dayRecent = (e, sn) => isObj(e) && (typeof e.c === "number" || dayRecentU(e, sn));
const dayRight = (e, sn) => dayRecent(e, sn) && Array.isArray(e.r) ? e.r : [];
function dayRecOf(prog, key){
  const k = String(key), id = k.slice(2), p = prog || {};
  const map = k[0] === "w" ? p.w : k[0] === "s" ? p.s : k[0] === "c" ? charRecs(p) : k[0] === "x" ? scriptRecs(p) : null;
  return isObj(map) && isObj(map[id]) ? map[id] : null;
}
// can: the kinds this unit can be shown in on this device (dayWordCan, daySentenceCan); a miss in
// a kind outside it is settled as daySettles says.
function noteDay(prog, pack, today, key, kind, ok, can){
  if(!prog) return false;
  const d = prog.day = dayLog(prog, today); const sn = daySn(prog);
  const e = isObj(d.a[key]) ? d.a[key] : (d.a[key] = {});
  if(Array.isArray(e.mk) && e.mk.length && e.m !== d.n) e.ma = 1;
  // The in-drill retry right after a miss is not evidence the kind is known: it stays open and
  // settles nothing. A right cloze on a blanked word ("gap") is logged but is no word drill: it
  // neither counts as the word answered right today nor settles the word's miss. A miss keeps
  // its kind in mk until a right answer that settles it (daySettles: an easier kind never does).
  if(ok){
    if(kind && e.m !== d.n){ if(!Array.isArray(e.r)) e.r = []; if(!e.r.includes(kind)) e.r.push(kind); }
    if(!(kind === "gap" && String(key)[0] === "w")){
      e.c = d.n; if(daySn(prog)) e.u = daySn(prog); delete e.ag;
      if(e.m !== d.n && Array.isArray(e.mk)){ e.mk = e.mk.filter(m => !daySettlesAt(key, [m], kind, can)); if(!e.mk.length){ delete e.mk; delete e.ms; delete e.ma; } }
    }
  } else {
    e.m = d.n;
    if(kind){
      if(!Array.isArray(e.mk) || !e.mk.length || dayAged(e, sn)){ e.mk = []; delete e.ma; if(sn) e.ms = sn; else delete e.ms; }
      if(!e.mk.includes(kind)) e.mk.push(kind);
    }
  }
  // A cloze is no word drill: the blanked word keeps its last-seen place in the refresh order.
  const rec = kind === "gap" && String(key)[0] === "w" ? null : dayRecOf(prog, key); const t = isoDayNumber(today);
  if(rec && isFinite(t)) rec.t = t;
  if(rec && daySn(prog)) rec.u = daySn(prog);
  return true;
}
// One partition for words, sentences and character units: production asks for the form
// (recall, typed, cloze, written-form choice), recognition shows it (hear, read, charRead,
// charSound). Typed variants are all logged as "type".
const DAY_PRODUCTION = ["recall", "type", "charRecall", "charPick", "gap", "gapType"];
const dayProd = k => DAY_PRODUCTION.includes(k);
// A miss is settled by a right answer in its own kind or in any production kind: never by an
// easier kind (review 2026-10-02: recall misses settled by ear). A production answer settles a
// recognition miss too (owner 2026-10-03: a word missed by ear went back to ear only and got no
// production ask for the rest of the week in 89% of cases, fb8-weak-analysis).
// can (optional): the kinds the unit can be shown in here. A missed kind it cannot be shown in (no
// voice for hear, no blank for gap) counts as the nearest kind it can: the first of `can` in the
// same partition, else the first of `can` (review 2026-10-02: hear misses on a voiceless device
// were logged as read forever and never settled).
function dayMissKinds(mk, can){
  if(!Array.isArray(can) || !can.length) return mk;
  return mk.map(m => can.includes(m) ? m : (can.find(k => dayProd(k) === dayProd(m)) || can[0]));
}
function daySettles(mk, kind, can){ const m = dayMissKinds(mk, can); return !m.length || m.includes(kind) || dayProd(kind); }
// characters.bareBy "typed": the word typed from its characters is the hardest ask a unit gets, so it
// settles any miss of that unit. Units are logged in kind "type" only under that flag.
const daySettlesAt = (key, mk, kind, can) => (kind === "type" && String(key)[0] === "c") || daySettles(mk, kind, can);
// Asked again after the miss (ma) and still pending DAY_MISS_MAX_SESSIONS sessions after it (ms).
const dayAged = (e, sn) => !!e.ma && typeof e.ms === "number" && sn > 0 && sn - e.ms >= DAY_MISS_MAX_SESSIONS;
// A unit whose miss aged out and that has not been answered right since: today's entry, or the
// ag mark dayCarry leaves on a character unit's entry after midnight.
const dayAgedOut = (e, sn) => isObj(e) && (e.ag === 1 || (Array.isArray(e.mk) && e.mk.length > 0 && dayAged(e, sn)));
// The missed kinds still pending, [] for a pending miss logged without a kind, or null.
function dayPending(e, sn){
  if(!isObj(e)) return null;
  if(Array.isArray(e.mk)) return e.mk.length && !dayAged(e, sn) ? e.mk : null;
  return typeof e.m === "number" && !(typeof e.c === "number" && e.c > e.m) ? [] : null;
}
// 0 missed (today or earlier) and not yet settled, and this planner can ask a kind that settles it;
// 1 due (unmastered, not right recently); 2 mastered, not right recently; 3 right recently (today
// or the last DAY_RECENT_SESSIONS sessions), some kind this planner asks still open; 4 right
// recently in every kind it asks, or a miss it cannot settle (a recall miss in Listen waits for a
// planner that asks production). sn: the current session ordinal (prog.sn).
function dayTier(c, d, sn){
  const e = d.a[c.key];
  const r = dayRight(e, sn);
  const open = (c.kinds || []).some(k => !r.includes(k));
  const mk = dayPending(e, sn);
  if(mk) return (c.kinds || []).some(k => daySettlesAt(c.key, mk, k, c.can)) ? 0 : 4;
  if(!dayRecent(e, sn)) return ((c.rec && c.rec.s) || 0) >= c.mastered ? 2 : 1;
  return open ? 3 : 4;
}
const dayT = rec => rec && typeof rec.t === "number" && isFinite(rec.t) ? rec.t : -Infinity;
const dayU = rec => rec && typeof rec.u === "number" && isFinite(rec.u) ? rec.u : -Infinity;
// Longest unseen first: sessions since the last answer, then days.
const dayAge = (a, b) => (dayU(a) - dayU(b)) || (dayT(a) - dayT(b));
const dayS = rec => (rec && rec.s) || 0;
const dayC = (c, d) => { const e = d.a[c.key]; return isObj(e) && typeof e.c === "number" ? e.c : 0; };
// Priority: today's misses (pending longest first), a weak-word floor, a reserved share of character units between mastered and bare
// (consolidating: weakScore gave them no Review/Recall slot at all, lead finding 2026-10-02), a
// reserved share of mastered units unseen longest (refresh would otherwise wait until every
// weak unit had its turn), weak units by lowest streak then oldest last answer, a capped share
// of harder kinds for units already right today, the rest of the consolidating and refresh
// units, and only then what was right today. Jitter (below 1) only breaks exact ties.
// cshare (optional): the consolidating share, DAY_CONSOLIDATE_SHARE by default. A consolidating
// unit whose miss aged out (dayAgedOut) comes first in it.
// t4max (optional): tier 4 fills the plan only up to this many items.
// Right after the misses, words (keys "w:") below mastered fill the plan up to DAY_WEAK_FLOOR of
// it, word misses already taken counting (owner 2026-10-03: weak words lost their slots to unit
// misses, consolidation and refresh; Recall gave them 0.5 of 8, fb8-weak-analysis). The floor leaves
// consolidating units at least ⌈DAY_CONSOLIDATE_SHARE n⌉ slots: on a day of many unit misses it took
// them all (fb10 review M1).
// Words by typed: held words that can be asked typed now (c.held, dayHeldMark) come right after
// the misses, up to hshare of the plan: a held word moves only by one typed ask per session, and by the
// weak floor alone (lowest streak first) the words at 2 piled up (fb18 review: 129 and rising). They
// reserve only the consolidating units min(⌈DAY_HELD_UNIT_SHARE n⌉, units there) (the fb10 M1 cap; at
// cshare 0.35 the words at 2 still rose, owner export; units may still fall to the floor cap on days
// of many unit misses, as flag off); the floor then counts them with the word misses, as it counts misses
// without the flag, and refresh is taken once after the units (fb18 review 2 M2, M3).
const DAY_WEAK_FLOOR = 0.4, DAY_HELD_SHARE_REVIEW = 0.3, DAY_HELD_SHARE_RECALL = 1, DAY_HELD_UNIT_SHARE = 0.25;
// Today's Recall size. Under wordsBy a held word moves only by a typed ask, and after the misses and
// the units' share Recall left it ~1 slot: the pile at 2 rose all week (fb18 review 2; the extra
// production slots are what the typed rule costs, team decision 2026-10-04).
const RECALL_SIZE = 8, RECALL_SIZE_HELD = 12;
const recallSize = pack => RECALL_SIZE_HELD;
function dayPick(cands, n, d, rng, sn, cshare, t4max, hshare){
  const r = rng || Math.random; const T = [[], [], [], [], []], C = [];
  (cands || []).forEach(c => { const t = dayTier(c, d, sn); (t === 2 && c.bare && dayS(c.rec) < c.bare ? C : T[t]).push(Object.assign({ j: r() }, c)); });
  const ag = c => dayAgedOut(d.a[c.key], sn) ? 0 : 1;
  C.sort((a, b) => ag(a) - ag(b) || dayAge(a.rec, b.rec) || dayS(a.rec) - dayS(b.rec) || a.j - b.j);
  // Misses pending longest come first: by weakScore alone a strong word's miss waited behind every
  // newer miss and could go unasked for days (fb10 day_sim backlog).
  const ms = c => { const e = d.a[c.key]; return isObj(e) && typeof e.ms === "number" ? e.ms : Infinity; };
  const cmp = [
    (a, b) => (ms(a) - ms(b)) || weakScore(b.rec) - weakScore(a.rec),
    (a, b) => dayS(a.rec) - dayS(b.rec) || dayAge(a.rec, b.rec),
    (a, b) => dayAge(a.rec, b.rec) || dayS(a.rec) - dayS(b.rec),
    (a, b) => dayC(a, d) - dayC(b, d) || dayS(a.rec) - dayS(b.rec),
    (a, b) => dayC(a, d) - dayC(b, d),
  ];
  T.forEach((list, i) => list.sort((a, b) => cmp[i](a, b) || a.j - b.j));
  const out = [], seen = new Set();
  // A candidate with an alias (a typed character unit asked as its word) and that word's own
  // candidate are one item: the second one taken is passed over, and a word taken first is asked
  // as the unit's typed item (tu). A word with a pending miss a typed answer cannot settle (none
  // while every production answer settles any miss) is never converted, and still gets its own
  // item when its unit was taken first and a slot is left (review 2026-10-02).
  const owns = c => { const mk = dayPending(d.a[c.key], sn); return !!(mk && mk.length && !daySettles(mk, "type", c.can)); };
  const take = (list, k) => { for(let i = 0; i < k && list.length && out.length < n;){ const c = list.shift();
    if(c.alias && seen.has(c.alias)){ const w = out.find(o => o.key === c.alias); if(w && !w.tu && !owns(w)) w.tu = c.x; continue; }
    if(seen.has(c.key) && !(owns(c) && out.some(o => o.alias === c.key) && !out.some(o => o.key === c.key))) continue;
    seen.add(c.key); if(c.alias) seen.add(c.alias); out.push(c); i++; } };
  const isW = c => String(c.key).startsWith("w:");
  take(T[0], Math.max(1, Math.floor(n * DAY_MISS_SHARE)));
  if(hshare) take([...T[1], ...T[3]].filter(c => c.held).sort((a, b) => dayAge(a.rec, b.rec) || a.j - b.j), Math.min(Math.round(n * hshare), n - out.length - Math.min(Math.ceil(n * DAY_HELD_UNIT_SHARE), C.length)));
  take(T[1].filter(isW), Math.min(Math.round(n * DAY_WEAK_FLOOR) - out.filter(isW).length, n - out.length - Math.min(Math.ceil(n * DAY_CONSOLIDATE_SHARE), C.length))); take(C, Math.ceil(n * (cshare || DAY_CONSOLIDATE_SHARE))); take(T[2], Math.ceil(n * DAY_REFRESH_SHARE)); take(T[1], n);
  take(T[3], Math.ceil(n * DAY_AGAIN_SHARE)); take(C, n); take(T[2], n); take(T[3], n); take(T[0], n); take(T[4], t4max != null ? t4max - out.length : n);
  return out;
}
// The kinds a planner may ask a unit, production first (owner rule: a unit already met today
// comes back in a harder kind, recall/typed over recognition).
function dayWordKinds(pack){ return typingEnabled(pack) ? ["recall", "type", "hear", "read"] : ["recall", "hear", "read"]; }
function dayCharKinds(pack){ const cfg = charsConfig(pack); return ["charRecall", "charPick", ...((cfg && cfg.reviewKinds) || []).filter(k => k !== "charRecall" && k !== "charPick")]; }
function daySentenceKinds(pack){ return [typingEnabled(pack) && !pronTypingOn(pack) ? "gapType" : "gap", "hear", "read"]; }
// A unit already right today keeps its planned kind only when that kind is still open today
// and production; otherwise the first open kind of `kinds` (production first). A pending miss
// goes to a kind that settles it: the planned kind if it does, else its missed kind, else the
// nearest production kind, preferring one that settles every pending kind (a hear and a recall
// miss: recall, fb10 day_sim) and then one not right today. Units not met today, and units with
// every kind done, keep the planned kind. The one place a unit's kind is decided per day.
// can (optional): the kinds the unit can be shown in here (daySettles).
function dayItemKind(prog, pack, today, key, planned, kinds, can){
  const e = dayLog(prog, today).a[key];
  if(!isObj(e)) return planned;
  const r = dayRight(e, daySn(prog)), ks = kinds || [];
  const mk = dayPending(e, daySn(prog));
  if(mk){
    const fit = [planned, ...dayMissKinds(mk, can), ...ks.filter(dayProd), ...ks].filter(k => ks.includes(k) && daySettlesAt(key, mk, k, can));
    const all = fit.filter(k => mk.every(m => daySettlesAt(key, [m], k, can)));
    return all.find(k => !r.includes(k)) || all[0] || fit.find(k => !r.includes(k)) || fit[0] || planned;
  }
  if(!r.length) return planned;
  const open = ks.filter(k => !r.includes(k));
  if(!open.length) return planned;
  if(open.includes(planned) && dayProd(planned)) return planned;
  return open.find(dayProd) || (open.includes(planned) ? planned : open[0]);
}
// wordCan (optional): word -> the kinds it can be shown in here (dayWordCan).
// typedOk (optional): word -> a typed kind fits it on this device (app: typedKindOk with the word's
// shown side); default: one fits with the written form hidden. typedSeen (optional):
// word -> already asked typed in the running Today session (app.html typedSession).
function dayPlanKinds(plan, prog, pack, today, wordKinds, charKinds, wordCan, typedUnits, typedOk, typedSeen){
  const seen = w => !!w && typeof typedSeen === "function" && !!typedSeen(w);
  return plan.map(it => {
    const tu = it.unit && CHAR_KINDS.includes(it.kind) ? it.unit : it.tuUnit;
    // wordsBy: a unit's typed item types its word, so a word typed this session is not its unit's typed item again (browser fb18 check 4).
    if(tu && typedUnitDue(tu, prog, pack, typedUnits) && !seen(typedUnits.get(tu.id))) return { kind: "type", word: typedUnits.get(tu.id), tu: tu.id };
    if(it.word){ const can = wordCan ? wordCan(it.word) : undefined; const ks = can ? wordKinds.filter(x => can.includes(x)) : wordKinds;
      let k = typedWordDue(it.word, prog, pack, today, ks, typedOk, typedSeen) ? "type" : dayItemKind(prog, pack, today, "w:" + it.word.id, it.kind, ks, can);
      // wordsBy: one typed ask per word per Today session, the miss replay included: recall settles the miss and holds the streak.
      if(k === "type" && seen(it.word) && ks.includes("recall")) k = "recall";
      return k === it.kind ? it : Object.assign({}, it, { kind: k }); }
    // Script units ("x:") are routed in dayScriptItems / scriptTestPlan, where their renderable kinds are known.
    if(it.unit && CHAR_KINDS.includes(it.kind)){ const k = dayItemKind(prog, pack, today, "c:" + it.unit.id, it.kind, charKinds); return k === it.kind ? it : Object.assign({}, it, { kind: k }); }
    return it;
  });
}
// characters.bareBy "typed" (docs/PACK_SCHEMA.md "bareBy"): a unit between mastered and bare that
// can be typed is asked as its word, typed from the written side (plan item { kind: "type", word,
// tu: unit id }); the app picks a written-side kind for it. typedUnits: typedUnitWords().
function typedUnitDue(unit, prog, pack, typedUnits){
  if(!(typedUnits instanceof Map) || !typedUnits.has(unit.id) || !typedBareOn(pack)) return false;
  const cfg = charsConfig(pack), s = dayS(charRecs(prog)[unit.id]);
  return s >= cfg.mastered && s < cfg.bare;
}
// Words by typed: a held word (WORD_HOLD <= s < WORD_MASTERED) moves on only by a typed answer,
// so a planner that may ask "type" asks it typed, as typedUnitDue does for units. A word right typed
// recently (it reached 2 by that answer) keeps the day rule: no same-kind repeat; a word asked typed
// in the running Today session (typedSeen) waits for the next one.
function typedWordDue(word, prog, pack, today, kinds, typedOk, typedSeen){
  if(!(kinds || []).includes("type") || (typeof typedSeen === "function" && typedSeen(word))) return false;
  const s = dayS((prog.w || {})[word.id]);
  if(s < WORD_HOLD || s >= WORD_MASTERED || dayRight(dayLog(prog, today).a["w:" + word.id], daySn(prog)).includes("type")) return false;
  return typeof typedOk === "function" ? !!typedOk(word) : typedKinds(pack).some(k => typedKindOk(k, word, false));
}

// A candidate's kinds are only those it can be shown in here (can), so a miss in a kind this
// device cannot show is never routed back to it.
const dayCanKinds = (kinds, can) => can ? kinds.filter(k => can.includes(k)) : kinds;
const dayWordCand = (prog, kinds, wordCan) => w => { const can = wordCan ? wordCan(w) : undefined; return { t: "w", x: w, key: "w:" + w.id, rec: (prog.w || {})[w.id], mastered: WORD_MASTERED, kinds: dayCanKinds(kinds, can), can }; };
// Renderable kinds: hear needs a voice or recorded audio (canHear), a cloze needs a blankable word.
const dayWordCan = (pack, canHear) => w => typeof canHear === "function" && !canHear(w) ? dayWordKinds(pack).filter(k => k !== "hear") : dayWordKinds(pack);
const daySentenceCan = (pack, canHear, wordsById) => s => daySentenceKinds(pack).filter(k => k === "hear" ? typeof canHear !== "function" || canHear(s) : k === "read" || gapCandidateIndices(s, wordsById, pack).length > 0);
const dayCharCand = (prog, pack, kinds, typedUnits) => { const cfg = charsConfig(pack), recs = charRecs(prog);
  return u => Object.assign({ t: "c", x: u, key: "c:" + u.id, rec: recs[u.id], mastered: cfg ? cfg.mastered : CHAR_MASTERED, bare: cfg ? cfg.bare : CHAR_BARE, kinds },
    typedUnitDue(u, prog, pack, typedUnits) ? { kinds: ["type"], alias: "w:" + typedUnits.get(u.id).id } : {}); };
// For the app's own pickers (Listen, Sentences, Test): the n list entries to drill, by dayPick.
// keyPrefix "w:" or "s:"; kinds: what the picker asks (or a function of the entry).
// can (optional): entry -> the kinds it can be shown in here (dayWordCan / daySentenceCan).
// o (optional): pairPick's options (sn).
function dayPickList(list, n, prog, pack, today, keyPrefix, kinds, rng, can, o){
  const d = dayLog(prog, today); const sent = keyPrefix === "s:";
  // Words by their pairs (Listen: sound <-> meaning); sentences keep dayPick.
  if(keyPrefix === "w:") return pairPick((list || []).map(x => pairWordCand(prog, typeof kinds === "function" ? kinds(x) : kinds, can, pack)(x)), n, d, rng, daySn(prog), pack, o || {}).map(e => e.c.x);
  const recs = (sent ? prog.s : prog.w) || {};
  const cands = (list || []).map(x => { const c = can ? can(x) : undefined; return { x, key: keyPrefix + x.id, rec: recs[x.id], mastered: sent ? SENTENCE_MASTERED : WORD_MASTERED, kinds: dayCanKinds(typeof kinds === "function" ? kinds(x) : kinds, c), can: c }; });
  return dayPick(cands, n, d, rng, daySn(prog)).map(c => c.x);
}
const dayHeldMark = (cands, prog, pack, o) => { cands.forEach(c => { if(c.t === "w" && typedWordDue(c.x, prog, pack, o.today, c.kinds, o.typedOk, o.typedSeen)) c.held = true; }); return cands; };
// Today's Review candidates for the script pre-pick (pairScriptPre): words, recorded character units, recorded script units.
function dayReviewCands(learned, prog, pack, o, rs){
  const scfg = scriptConfig(pack), wk = dayWordKinds(pack), ck = dayCharKinds(pack), srecs = scriptRecs(prog);
  const ru = recordedUnits(o.units, prog, pack), wc = dayWordCan(pack, o.canHear);
  return [...(learned || []).map(dayWordCand(prog, wk, wc)), ...ru.map(dayCharCand(prog, pack, ck, o.typedUnits)),
    ...rs.map(u => ({ t: "x", x: u, key: "x:" + u.id, rec: srecs[u.id], mastered: scfg ? scfg.mastered : SCRIPT_MASTERED, kinds: scfg ? scfg.reviewKinds : [] }))];
}
// The script items of a Review (script units have no pairs), then routed by dayScriptKind.
function dayScriptItems(pool, pack, o, r, prog){
  const scfg = scriptConfig(pack), ctx = Object.assign({ units: o.script }, o.scriptCtx || {});
  return pool.filter(c => c.t === "x").map(c => { const fit = scriptFitKinds(scfg.reviewKinds, c.x, scfg, ctx);
    return { c, kind: dayScriptKind(prog, pack, o.today, c.x, pickScriptKind(scfg.reviewKinds, c.x, scfg, r, ctx, fit), fit, scfg, ctx) }; });
}
// dayItemKind for a script unit ("x:"), the one place its kind is decided per day (fb46): its kinds are
// the ones it can be shown in here, plus a pending miss's own kind (a Test miss in a kind the Review
// does not draw). No script kind is a production kind, so a miss settles only in its own kind: a random
// draw left 3 of 5 asks of a pending unit unable to settle it on the live script packs (tests/lib/script_day_sim.js).
// fit: the kinds that fit the unit here (scriptFitKinds).
function dayScriptKind(prog, pack, today, unit, planned, fit, cfg, ctx){
  if(!today || !planned || !isObj(unit)) return planned;
  const e = dayLog(prog, today).a["x:" + unit.id];
  if(!isObj(e)) return planned;
  const ks = fit.slice(), mk = dayPending(e, daySn(prog)) || [];
  mk.forEach(k => { if(!ks.includes(k) && SCRIPT_KINDS.includes(k) && scriptKindFor(k, unit, cfg, ctx) === k) ks.push(k); });
  return ks.length ? dayItemKind(prog, pack, today, "x:" + unit.id, planned, ks) : planned;
}
function dayReviewPlan(learned, prog, pack, n, o){
  return pairPlan(learned, prog, pack, n, o, dayWordKinds(pack), dayCharKinds(pack), true, pairScriptPre(learned, prog, pack, n, o));
}
function dayRecallPlan(learned, prog, pack, n, o){
  return pairPlan(learned, prog, pack, n, o, typingEnabled(pack) ? ["recall", "type"] : ["recall"], ["charRecall", "charPick"]);
}

// ------------------------------------------------------------------ pairs
// Pairs (docs/PACK_SCHEMA.md "pairs", default since the flag collapse; owner 2026-10-05: missed characters did not come back
// enough while long-past ones did, and "why not treat every pair equally"). An item is asked in
// pairs: wm written<->meaning, sm sound<->meaning, ws written<->sound. Each pair keeps its own
// streak and last session in the record (p: {wm: [s, a], ...}); Review, Recall, Listen and the
// characters Test pick the lowest pair streak first, then the pair asked longest ago. The pair data
// drives scheduling only: the record's streak s and everything that reads it are unchanged.
const PAIRS = ["wm", "sm", "ws"];
// PAIR_HOLD: a choice answer takes a pair to 2 at most; PAIR_KNOWN only a production answer reaches
// (owner-confirmed 2026-10-05). PAIR_REFRESH: the plan's share for known pairs, oldest first; 0.1, not
// the 0.2 first planned: at 0.2 words reaching known per week fell below main (fb23 measure, owner export).
const PAIR_KNOWN = 3, PAIR_HOLD = 2, PAIR_REFRESH = 0.1;
// Frequency tiers (docs/PACK_SCHEMA.md "freqTiers", default since the flag collapse; owner 2026-10-06: "give more priority to words that
// come up more in real life and the exam ... mastery requirements as well", then "why not typed asks
// but much less frequent?"): words.json ft sets how often a word is practised and its known bar; pair
// and unit mechanics are the same for every tier. Ambient (0, the pack's ~100 commonest words): every
// sentence and passage rehearses them, so a known pair gets no refresh ask. Core (1): the pairs rules.
// Peripheral (2): no typed-first priority at equal streak, no held boot, refresh age counts half (one
// refresh slot every other plan, odd session ordinal, for the oldest known peripheral pair), known
// at PAIR_HOLD, its unit done for Progress at mastered (it still reaches bare by typed credit).
const FT_AMBIENT = 0, FT_CORE = 1, FT_PERIPHERAL = 2;
const ftOf = v => v === FT_AMBIENT || v === FT_CORE || v === FT_PERIPHERAL ? v : FT_CORE;
function wordTier(word, pack){ return word ? ftOf(word.ft) : FT_CORE; }
// A unit shared by words of different tiers takes the highest-demand one (lowest ft). words: a Map,
// an array or an object by id; without it the unit's own ft (the generator writes that minimum, so
// planners need no word lookup).
function unitTier(unit, words, pack){
  if(!unit) return FT_CORE;
  const look = id => words instanceof Map ? words.get(id) : Array.isArray(words) ? words.find(w => w && w.id === id) : words ? words[id] : undefined;
  const ts = words ? (unit.words || []).map(look).filter(Boolean).map(w => wordTier(w, pack)) : [];
  return ts.length ? Math.min(...ts) : ftOf(unit.ft);
}
const knownBarAt = tier => tier === FT_PERIPHERAL ? PAIR_HOLD : PAIR_KNOWN;
// A cloze ("gap", "gapType") asks its blanked word meaning -> written.
const PAIR_OF_KIND = { read: "wm", recall: "wm", hear: "sm", gap: "wm", gapType: "wm", charRead: "wm", charRecall: "wm", charSound: "ws", charPick: "ws" };
const PAIR_OF_TYPED = { word: "wm", written: "wm", writtenMeaning: "wm", pron: "sm", pronMeaning: "sm", writtenPron: "ws" };
// The harder choice direction of a pair: the production answer of a pair no typed kind fits.
const PAIR_HARD = ["recall", "hear", "charRecall", "charPick"];
function pairTypedKinds(pack, pair){ return [...new Set(typedKinds(pack))].filter(k => PAIR_OF_TYPED[k] === pair); }
const pairEntry = v => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && v[0] >= 0 && typeof v[1] === "number" && isFinite(v[1]) ? v : null;
// A pair never answered under the flag starts from the record's streak and its last answer (u, else
// 0); boot marks it. Nothing is written until the pair is answered. A streak from PAIR_KNOWN starts
// known, except held: a character unit one answer short of bare (characters.bare - 1, pairUnitHeld)
// starts at PAIR_HOLD, so the production ask that takes it to bare comes in the lowest-first order
// instead of the refresh share (fb23 measure, owner export: with every unit from mastered started
// known, units reaching bare per week fell 274 -> 125; with every unit below bare held, words
// reaching known fell 168 -> 107).
const pairUnitHeld = pack => { const c = charsConfig(pack); return c && c.bare - 1 >= PAIR_KNOWN ? c.bare - 1 : undefined; };
const pairBoot = (s, held) => { const x = Math.max(0, Math.floor(s || 0)); return x === held ? PAIR_HOLD : x >= PAIR_KNOWN ? PAIR_KNOWN : Math.min(x, PAIR_HOLD); };
function pairState(rec, pair, held){
  const e = rec && isObj(rec.p) ? pairEntry(rec.p[pair]) : null;
  if(e) return { s: e[0], a: e[1] };
  return { s: pairBoot(dayS(rec), held), a: rec && typeof rec.u === "number" && isFinite(rec.u) ? rec.u : 0, boot: true };
}
// One answer in a pair. s0: the record's streak before this answer, held as pairState (the start of
// a pair never answered). A miss sets the pair to 0; a right answer adds one, a choice answer only up
// to PAIR_HOLD; a pair already answered this session (sn) gains nothing more (the in-drill retry).
// tier (freqTiers): a peripheral unit boots without the held exception, as pairCharCand plans it.
function notePair(rec, pair, ok, prod, sn, s0, held, tier){
  if(tier === FT_PERIPHERAL) held = undefined;
  if(!isObj(rec) || !PAIRS.includes(pair)) return false;
  const e = isObj(rec.p) ? pairEntry(rec.p[pair]) : null;
  const s = e ? e[0] : pairBoot(typeof s0 === "number" ? s0 : 0, held);
  const again = !!e && sn > 0 && e[1] === sn;
  const ns = !ok ? 0 : !again && (prod || s < PAIR_HOLD) ? s + 1 : s;
  if(!isObj(rec.p)) rec.p = {};
  rec.p[pair] = [ns, sn > 0 ? sn : 0];
  return true;
}
// freqTiers: the pairs a word's "known" reads, device-independent: wm always; sm when the pack can
// voice the word (TTS or a clip); ws when a typed kind of ws fits the written word (a typed written ->
// reading kind; a word has no ws choice kind). A pair never answered reads its boot (the
// legacy streak), as the scheduler does, so a word at legacy WORD_MASTERED+ stays known until a miss.
function wordPairs(word, pack){
  const out = ["wm"];
  if(word && (pack.tts || pack.audio || word.audio)) out.push("sm");
  if(word && pairTypedKinds(pack, "ws").some(k => typedKindOk(k, word, true))) out.push("ws");
  return out;
}
// "Known" (Progress, goals, progress map, prov): without freqTiers the legacy streak; with it every
// pair of wordPairs at its tier's bar (knownBarAt: peripheral 2, else PAIR_KNOWN). wordsBy holds and optsMix stages keep the
// legacy streak.
function wordKnown(rec, word, pack){
  if(!isObj(rec)) return false;
  const k = knownBarAt(wordTier(word, pack));
  return wordPairs(word, pack).every(p => pairState(rec, p).s >= k);
}
// A placement word stays provisional (kept in review) until known; markRec drops prov at the legacy
// streak, this drops it at known under freqTiers (app.html markWord, after the pair is noted).
function settleProv(rec, word, pack){
  if(!isObj(rec) || !rec.prov || !wordKnown(rec, word, pack)) return false;
  delete rec.prov; return true;
}
// A unit counts as done at bare; under freqTiers a peripheral unit at mastered (it still reaches bare
// by the same typed credit, only less often asked).
function unitDone(rec, unit, pack, words){
  if(!isObj(rec)) return false;
  const t = charTier(rec.s || 0, pack);
  return unitTier(unit, words, pack) === FT_PERIPHERAL ? t !== "pron" : t === "bare";
}
// The pairs a candidate can be asked in here: its planner kinds (c.kinds, cut to what the device can
// show) grouped by pair; "type" joins every pair one of its typed kinds fits (c.tw: the word typed;
// o.typedKindFits(word, kind), else the written form taken as hidden). A word typed this Today session
// (o.typedSeen) gets no typed kind. A unit typed as its word answers the word's pair too: not when
// the word's pair was answered in the plan's session (psn). Script units have no pairs: Review
// gives them the slots dayPick gives them without pairs (pairScriptPre).
function pairOpts(c, pack, o, psn){
  const out = {}, ks = c.kinds || [];
  const add = (p, k, typed) => { const e = out[p] || (out[p] = { choice: [], typed: [] }); (typed ? e.typed : e.choice).push(k); };
  ks.forEach(k => { if(k !== "type" && PAIR_OF_KIND[k]) add(PAIR_OF_KIND[k], k, false); });
  if(ks.includes("type") && c.tw && !(typeof o.typedSeen === "function" && o.typedSeen(c.tw))){
    const fits = typeof o.typedKindFits === "function" ? k => !!o.typedKindFits(c.tw, k) : k => typedKindOk(k, c.tw, false);
    [...new Set(typedKinds(pack))].forEach(k => { const p = PAIR_OF_TYPED[k]; if(p && (!c.typedOnly || c.typedOnly.includes(k)) && !(c.twRec && psn > 0 && (pairEntry(isObj(c.twRec.p) ? c.twRec.p[p] : null) || [])[1] === psn) && fits(k)) add(p, k, true); });
  }
  return out;
}
// The kind a pair is asked in: from 1 up the production direction (typed when a typed kind fits, else
// the harder choice); at 0 the missed kind when it is this pair's (pending in the day log), else
// the production direction too: a retry that answered right clears the log's mk, and an easier kind
// would let a miss come back as a recognition ask; the hard direction subsumes the missed one.
function pairKind(po, s, mk){
  const prod = po.typed.length ? "type" : po.choice.find(k => PAIR_HARD.includes(k));
  if(s >= 1) return prod || po.choice[0];
  const m = (mk || []).find(k => po.choice.includes(k) || (k === "type" && po.typed.length));
  return m || prod || po.choice[0];
}
// cands: as dayPick's, plus t ("w" word, "c" unit) and tw (the word a typed ask
// types). One pair per item per plan; a unit typed as its word takes the word too. A pair answered
// in the session the plan runs in (o.sn; default sn, the running session: a plan built before its
// session starts, as Today's shown plan or a Words-tab Review, passes sn + 1) is not asked again in
// it. Order: lowest pair streak; at equal streak typed asks first, then words before character units
// (a typed answer on a unit's word moves both records, and is the only way a held word or unit moves
// on; by streak and age alone words reaching known per week fell 168 -> 107, fb23 measure); then
// asked longest ago, then jitter. A PAIR_REFRESH share goes to known pairs (s >= PAIR_KNOWN),
// oldest first. Returns [{ c, pair, kind }].
function pairPick(cands, n, d, rng, sn, pack, o, pre){
  const r = rng || Math.random, opt = o || {}, lo = [], hi = [], psn = Number.isInteger(opt.sn) ? opt.sn : sn;
  (cands || []).forEach(c => {
    const po = pairOpts(c, pack, opt, psn), mk = dayPending(d.a[c.key], sn) || [];
    Object.keys(po).forEach(pair => {
      const st = pairState(c.rec, pair, c.held);
      if(!st.boot && psn > 0 && st.a === psn) return;
      const kind = pairKind(po[pair], st.s, mk); if(!kind) return;
      // freqTiers: a known pair of an ambient item gets no refresh ask; a peripheral one's age counts half.
      const known = st.s >= PAIR_KNOWN; if(known && c.tier === FT_AMBIENT) return;
      (known ? hi : lo).push({ c, pair, kind, s: st.s, a: st.a, ra: c.tier === FT_PERIPHERAL ? (st.a + sn) / 2 : st.a, j: r() });
    });
  });
  // freqTiers: a peripheral typed ask gets no typed-first priority (asked typed only when drawn anyway).
  const tf = e => e.kind === "type" && e.c.tier !== FT_PERIPHERAL;
  lo.sort((x, y) => x.s - y.s || tf(y) - tf(x) || (x.c.t === "c") - (y.c.t === "c") || x.a - y.a || x.j - y.j);
  hi.sort((x, y) => x.ra - y.ra || x.j - y.j);
  const out = [], seen = new Set();
  const alias = e => e.kind === "type" && e.c.t === "c" && e.c.tw ? "w:" + e.c.tw.id : null;
  (pre || []).forEach(e => { out.push(e); seen.add(e.c.key); if(alias(e)) seen.add(alias(e)); });
  const take = (list, upto) => { for(let i = 0; i < list.length && out.length < upto; i++){ const e = list[i]; if(!e) continue;
    const al = alias(e); if(seen.has(e.c.key) || (al && seen.has(al))) continue;
    seen.add(e.c.key); if(al) seen.add(al); out.push(e); list[i] = null; } };
  const rk = Math.min(Math.ceil(n * PAIR_REFRESH), new Set(hi.map(e => e.c.key)).size);
  take(lo, n - rk);
  // freqTiers (owner 2026-10-06/07): on every other plan (odd session ordinal; no storage) one refresh
  // slot goes to the oldest known peripheral pair (halved age), so peripheral items keep a trickle while
  // older core pairs fill the rest of the share; on even plans the share fills by age alone.
  if(rk >= 1 && psn % 2 === 1){ const i = hi.findIndex(e => e && e.c.tier === FT_PERIPHERAL && !seen.has(e.c.key) && !(alias(e) && seen.has(alias(e))));
    if(i > 0) hi.unshift(hi.splice(i, 1)[0]); }
  take(hi, n); take(lo, n);
  return out;
}
const pairWordCand = (prog, kinds, wordCan, pack) => w => { const can = wordCan ? wordCan(w) : undefined; return { t: "w", x: w, key: "w:" + w.id, rec: (prog.w || {})[w.id], kinds: dayCanKinds(kinds, can), can, tw: w, tier: wordTier(w, pack) }; };
// A unit is typed (as its word, written-side kinds) only while typedUnitDue: from mastered to bare.
const pairCharCand = (prog, pack, kinds, typedUnits) => { const recs = charRecs(prog);
  const hd = pairUnitHeld(pack);
  return u => { const tw = typedUnitDue(u, prog, pack, typedUnits) ? typedUnits.get(u.id) : null, tier = unitTier(u, null, pack);
    return Object.assign({ t: "c", x: u, key: "c:" + u.id, rec: recs[u.id], kinds, held: tier === FT_PERIPHERAL ? undefined : hd, tier }, tw ? { kinds: [...kinds, "type"], tw, twRec: (prog.w || {})[tw.id], typedOnly: TYPED_WRITTEN_KINDS } : {}); }; };
// A unit's typed ask types its word (tu); pair tells the app which typed kinds belong to the item.
const pairPlanItem = e => e.c.t === "w" ? { kind: e.kind, word: e.c.x, pair: e.pair } : e.c.t === "x" ? { kind: e.kind, unit: e.c.x }
  : e.kind === "type" ? { kind: "type", word: e.c.tw, tu: e.c.x.id, pair: e.pair } : { kind: e.kind, unit: e.c.x, pair: e.pair };
// characters.bareByPair (owner 2026-10-07; the ws pair was rarely answered, so units stayed ruby): the Review
// plan reserves up to BARE_BOOST slots for bare candidates, ruby units whose wm pair is at BARE_PAIR+ and whose
// ws pair is below it or never answered (pairJudge, as pairBare), asked in the ws direction (pairOpts / pairKind
// as pairPick: a pair answered this session, or no ws kind on the device, leaves it out; a pending ws miss
// keeps its kind). Lowest ws streak first, then asked longest ago. The slots left follow pairPick's order.
const BARE_BOOST = 3;
function bareBoost(cands, prog, pack, sn, d, o){
  if(!bareByPairOn(pack)) return undefined;
  const psn = Number.isInteger(o.sn) ? o.sn : sn, out = [];
  cands.forEach(c => {
    if(c.t !== "c" || !isObj(c.rec) || charTier(c.rec.s || 0, pack) !== "ruby") return;
    const wm = pairJudge(c.rec, c.x, prog, "wm"); if(!wm || wm.s < BARE_PAIR) return;
    const ws = pairJudge(c.rec, c.x, prog, "ws"); if(ws && ws.s >= BARE_PAIR) return;
    if(ws && psn > 0 && ws.a === psn) return;
    const po = pairOpts(c, pack, o, psn).ws; if(!po) return;
    const kind = pairKind(po, ws ? ws.s : 0, dayPending(d.a[c.key], sn) || []); if(!kind) return;
    out.push({ c, pair: "ws", kind, s: ws ? ws.s : 0, a: ws ? ws.a : 0 });
  });
  out.sort((x, y) => x.s - y.s || x.a - y.a);
  return out.slice(0, BARE_BOOST);
}
// Pairs with pack.script (port plan E3; script units have no pairs, docs/PACK_SCHEMA.md "pairs"):
// Review keeps the script units the Review without pairs would ask. dayPick runs over that plan's
// candidates (dayReviewCands: words, units and script units, its shares and held mark) and the k script
// units it takes keep k slots, kinds drawn as there; pairPick fills the other n - k. So the reserved
// share is k / n of the non-pairs scheduler, per plan: ceil(n x share) = k. No recorded script unit
// (every pack without pack.script): [] and no draw, so the plan is the pairs plan as before.
function pairScriptPre(learned, prog, pack, n, o){
  const rs = recordedScriptUnits(o.script, prog, pack); if(!rs.length) return [];
  const cands = dayHeldMark(dayReviewCands(learned, prog, pack, o, rs), prog, pack, o);
  const pool = dayPick(cands, n, dayLog(prog, o.today), o.rng, daySn(prog), typedBareOn(pack) ? DAY_TYPED_CONSOLIDATE_SHARE : undefined, undefined, DAY_HELD_SHARE_REVIEW);
  return dayScriptItems(pool, pack, o, o.rng || Math.random, prog).filter(e => e.kind);
}
// Review and Recall by pairs. o.extra (paused) is ignored: a paused Review stays at n items.
// sx: pairScriptPre's script items, taken first.
function pairPlan(learned, prog, pack, n, o, wk, ck, boost, sx){
  const d = dayLog(prog, o.today), sn = daySn(prog), wc = dayWordCan(pack, o.canHear);
  const cands = [...(learned || []).map(pairWordCand(prog, wk, wc, pack)), ...recordedUnits(o.units, prog, pack).map(pairCharCand(prog, pack, ck, o.typedUnits))];
  // Owner 2026-10-06: a paused session's 40-item Review is too long to keep focus and remember mistakes,
  // so the paused growth (o.extra) is ignored and Review keeps its normal size.
  const bb = boost ? bareBoost(cands, prog, pack, sn, d, o) : undefined;
  const pre = sx && sx.length ? [...sx, ...(bb || []).slice(0, Math.max(0, n - sx.length))] : bb;
  const pool = shuffle(pairPick(cands, n, d, o.rng, sn, pack, o, pre), o.rng);
  return hearableKinds(pool.map(pairPlanItem), o.canHear);
}

// ------------------------------------------------------------------ patterns
// pack.patterns (docs/PACK_SCHEMA.md "patterns"; owner 2026-10-06: grammar drills from level 3, a few
// level-2 patterns carried in; drills, not lessons). patterns.json lists patterns, each with 6-8
// sentences and marks (the UTF-16 ranges of its words); open patterns take a share of the Sentences
// step as cloze items on a mark. prog.pt[id] = { s: streak, a: session last answered }, written only
// on an answer under the flag. validateProgShape never looks at pt: a malformed entry reads as a
// pattern never answered instead of resetting the progress. Needs pairs (and so dayAware): asks are
// counted by session.
// PATTERN_OPEN: share of a pattern's distinct sentence words that must be learned before it opens.
// PATTERN_SHARE: 3 of the step's 8 items. PATTERN_DONE: the streak a pattern is done at (as PAIR_KNOWN).
const PATTERN_DONE = 3, PATTERN_OPEN = 0.8, PATTERN_SHARE = 3 / 8;
function patternsOn(pack){ return !!(pack && pack.patterns === true); }
const patternCount = n => Math.round(n * PATTERN_SHARE);
const patternWords = p => [...new Set(((p && p.sentences) || []).flatMap(s => s.words || []))];
const patternEntry = v => isObj(v) && Number.isInteger(v.s) && v.s >= 0 && typeof v.a === "number" && isFinite(v.a) ? v : null;
// A pattern never answered has no record: streak 0, asked never (a -1).
function patternState(prog, id){
  const e = patternEntry(prog && isObj(prog.pt) ? prog.pt[id] : null);
  return e ? { s: e.s, a: e.a } : { s: 0, a: -1, fresh: true };
}
// A pattern's first meeting: the opening meaning and the verdict note ride with it (fb44, fb51). A pattern
// of a level strictly below the placed level (prog.pl) is not one: the placement vouched for it, so its first ask is a later
// meeting, still drilled until known (owner 2026-10-09).
function patternFirstMeeting(prog, pattern, pack){
  if(!pattern || !patternState(prog, pattern.id).fresh) return false;
  if(prog && prog.pl != null){
    const ids = levelIds(pack), pi = ids.indexOf(String(prog.pl)), li = ids.indexOf(String(pattern.lv));
    if(pi >= 0 && li >= 0 && li < pi) return false;
  }
  return true;
}
// A pattern opens when all hold: its `keys` (sentence word ids that are its own words, emitted by
// the pack generator) have records; the learner has reached its level (a word of that level has a
// record: patterns are placed by level on purpose); and PATTERN_OPEN of its sentence words have one.
// `words`: the pack's words (their lv); without it no level counts as reached and nothing opens.
function openPatterns(prog, pack, patterns, words){
  if(!patternsOn(pack)) return [];
  const w = (prog && prog.w) || {}, reached = new Set();
  (words || []).forEach(x => { if(x && isObj(w[x.id])) reached.add(String(x.lv)); });
  return (patterns || []).filter(p => {
    if(!reached.has(String(p.lv)) || !(p.keys || []).every(id => isObj(w[id]))) return false;
    const ids = patternWords(p);
    return ids.length > 0 && ids.filter(id => isObj(w[id])).length >= PATTERN_OPEN * ids.length;
  });
}
// A miss sets the streak to 0, a right answer adds one; a pattern already answered this session (sn)
// gains nothing more (the in-drill retry after a miss), as notePair.
function notePattern(prog, id, ok, sn){
  if(!prog || typeof id !== "string") return null;
  const e = patternEntry(isObj(prog.pt) ? prog.pt[id] : null);
  const s = e ? e.s : 0, again = !!e && sn > 0 && e.a === sn;
  if(!isObj(prog.pt)) prog.pt = {};
  return prog.pt[id] = { s: !ok ? 0 : again ? s : s + 1, a: sn > 0 ? sn : 0 };
}
// The n patterns to ask in the session psn: open ones not answered in it nor in skip (ids already
// planned this session). Lowest streak first, then asked longest ago, then pack order; at equal streak
// a pattern asked before comes ahead of one never asked, so a miss (s 0) comes back next session
// instead of after every newly opened pattern. Done ones (s >= PATTERN_DONE) refresh like a known pair at half its rate: a known pair's 0.1
// share of an 8-item step is one item a session, so a done pattern gets one slot every second session
// (even psn), oldest first; done ones also fill the slots the others leave (as pairPick).
function patternPick(open, prog, n, psn, skip){
  const lo = [], hi = [];
  (open || []).forEach((p, i) => {
    if(skip && skip.has(p.id)) return;
    const st = patternState(prog, p.id);
    if(!st.fresh && psn > 0 && st.a === psn) return;
    (st.s >= PATTERN_DONE ? hi : lo).push({ p, s: st.s, a: st.a, i });
  });
  lo.sort((x, y) => x.s - y.s || (x.a < 0) - (y.a < 0) || x.a - y.a || x.i - y.i);
  hi.sort((x, y) => x.a - y.a || x.i - y.i);
  const rk = hi.length && psn % 2 === 0 ? Math.min(1, n) : 0;
  const out = [...lo.slice(0, n - rk), ...hi.slice(0, rk)];
  hi.slice(rk).forEach(e => { if(out.length < n) out.push(e); });
  lo.slice(n - rk).forEach(e => { if(out.length < n) out.push(e); });
  return out.map(e => e.p);
}
const patternMarkText = (s, m) => String((s && s.t) || "").slice(m[0], m[1]);
const patternMarkTexts = p => [...new Set(((p && p.sentences) || []).flatMap(s => (s.marks || []).map(m => patternMarkText(s, m))))];
// The mark asked in session sn: several marks (虽然 and 但是) take turns by session.
const patternMarkIndex = (s, sn) => { const n = ((s && s.marks) || []).length; return n ? Math.max(0, sn) % n : 0; };
// Marks are words: "Ya" opening a sentence and "ya" inside one are the same word, and an option shows
// in the answer's case (a lowercase option beside a capitalised blank would give the answer away).
// Only the FIRST LETTER of an option follows the answer; a word that is capitalised mid-sentence
// (de Sie, any noun) or that spells capitals past its first letter (USA) keeps its own case.
// Scripts without case are untouched.
const patternFold = t => String(t).toLowerCase();
const patternFirst = t => { const c = String(t).codePointAt(0); return c === undefined ? "" : String.fromCodePoint(c); };
const patternSentenceStart = (t, i) => { const pre = String(t).slice(0, i).replace(/\s+$/, ""); return pre === "" || /[.!?\u2026\u00bf\u00a1\u00ab\u201c\u201e"(]$/.test(pre); };
// fold -> { text: the form seen mid-sentence when there is one, else the first seen; mid }
function patternForms(patterns){
  const m = new Map();
  (patterns || []).forEach(p => ((p && p.sentences) || []).forEach(s => (s.marks || []).forEach(k => {
    const tx = patternMarkText(s, k), f = patternFold(tx), mid = !patternSentenceStart(s.t, k[0]), e = m.get(f);
    if(!e || (mid && !e.mid)) m.set(f, { text: tx, mid });
  })));
  return m;
}
function patternCased(form, ans, ansStart){
  const t = String(form.text), h = patternFirst(t), a = patternFirst(ans);
  if(!h || !a || h.toLowerCase() === h.toUpperCase()) return t;
  const rest = t.slice(h.length);
  if(rest !== rest.toLowerCase()) return t;
  if(form.mid && h !== h.toLowerCase()) return t;
  const up = a !== a.toLowerCase(), want = up && !ansStart ? h : (up ? h.toUpperCase() : h.toLowerCase());
  return want + rest;
}
// Wrong choices: the pattern's own other mark texts first (了 vs 过, 才 vs 就), then other patterns'
// marks of the answer's length, then any. Never the answer, never a mark of a pattern in p.near or in the
// sentence's own near (an author-listed pattern whose word could also fit the blank, 如果 for 即使).
function patternOpts(p, s, mi, patterns, rng){
  const r = rng || Math.random, ans = patternMarkText(s, s.marks[mi]), af = patternFold(ans), near = new Set([...(p.near || []), ...(s.near || [])]);
  const uniq = ts => { const seen = new Set(); return ts.filter(t => { const f = patternFold(t); if(seen.has(f)) return false; seen.add(f); return true; }); };
  const own = uniq(patternMarkTexts(p)).filter(t => patternFold(t) !== af);
  const ownF = new Set(own.map(patternFold));
  const others = uniq((patterns || []).filter(q => q.id !== p.id && !near.has(q.id)).flatMap(patternMarkTexts)).filter(t => patternFold(t) !== af && !ownF.has(patternFold(t)));
  const len = cpLen(ans), out = [], outF = new Set(), forms = patternForms([p, ...(patterns || [])]);
  const ansStart = patternSentenceStart(s.t, s.marks[mi][0]);
  [own, others.filter(t => cpLen(t) === len), others.filter(t => cpLen(t) !== len)].forEach(t => shuffle(t.slice(), r).forEach(x => { if(out.length < 3 && !outF.has(patternFold(x))){ outF.add(patternFold(x)); out.push(patternCased(forms.get(patternFold(x)) || { text: x, mid: false }, ans, ansStart)); } }));
  return out;
}
// The sentence to ask: one whose words are all learned when there is one, else any.
function patternSentenceIndex(p, prog, rng){
  const w = (prog && prog.w) || {}, ss = (p && p.sentences) || [];
  const all = ss.map((s, i) => i), ok = all.filter(i => (ss[i].words || []).every(id => isObj(w[id])));
  const pool = ok.length ? ok : all;
  return pool[Math.floor((rng || Math.random)() * pool.length)];
}
function patternStats(prog, pack, patterns, words){
  const list = patterns || [];
  return { done: list.filter(p => patternState(prog, p.id).s >= PATTERN_DONE).length, open: openPatterns(prog, pack, list, words).length, total: list.length };
}

// A pack that types the reading (pronTypingOn) never gets gapType: the blank is written.
function sentenceKind(pack, rng){
  const r = (rng || Math.random)();
  if(r < 0.5) return "hear";
  if(r < 0.75) return "read";
  return typingEnabled(pack) && !pronTypingOn(pack) && (rng || Math.random)() < 0.5 ? "gapType" : "gap";
}

// Question text is reused across lesson items, so it can't be the miss-dedupe key.
const lessonItemKey = (lessonId, index) => `l:${lessonId}#${index}`;
// "skip": with no speech, showing the say text would give the answer away.
function lessonSayMode(item, speechOK){
  if(!item || !item.say || speechOK) return "audio";
  const say = normKey(item.say), q = normKey(item.q), a = normKey(item.a);
  if(q.indexOf(say) >= 0) return "inq";
  if(a && say.indexOf(a) >= 0) return "skip";
  return "text";
}

// Shared by the Today plan table and the runner. Any script record opens Review: a learner
// in the primer has no learned words yet.
function todayGates(learnedCount, hasNextSet, availSentCount, scriptCount){
  return { review: learnedCount >= 5 || (scriptCount || 0) > 0, learn: !!hasNextSet, listen: learnedCount >= 4, recall: learnedCount >= 4, sentences: availSentCount >= 8 };
}
// Mirrors app.html hearItem's Read fallback so the plan line agrees with the session.
// Deliberately not weakFirst(learned, 12): it draws from the global Math.random, so calling
// it just to render a plan line would shift every later shuffle in the session (and the
// seeded-RNG test goldens). A plain slice is as representative of the unweighted pool.
function listenPlanCount(learned, canHear){
  return (learned || []).slice(0, 12).filter(canHear).length;
}
// The "learn first" notice depends on learned words only: placement needs no sentences.
const TEST_MIN_WORDS = 8, TEST_MIN_SENTENCES = 8;
function testGates(learnedCount, availSentCount){
  const words = learnedCount >= TEST_MIN_WORDS, sentences = availSentCount >= TEST_MIN_SENTENCES;
  return { words, sentences, needPlacement: !words };
}

const normLang = s => String(s||"").replace(/_/g,"-").toLowerCase();
function pickVoice(voices, lang){
  const want = normLang(lang), base = want.split("-")[0];
  const vs = voices || [];
  return vs.find(v=>normLang(v.lang)===want) || vs.find(v=>normLang(v.lang).split("-")[0]===base) || null;
}
// Matched by voiceURI, else name: some browsers hand out fresh voice objects per getVoices call.
function liveVoice(chosen, voices, lang){
  const vs = voices || [];
  if(chosen){
    const key = v => (v && (v.voiceURI || v.name)) || "";
    const k = key(chosen);
    const same = vs.find(v => v === chosen) || (k ? vs.find(v => key(v) === k) : null);
    if(same) return same;
  }
  return pickVoice(vs, lang);
}
// TTS sequencing (docs/AUDIO.md "Playback reliability"): works around three Chrome/Android
// failure modes:
//  1. cancel() followed at once by speak() can drop the new utterance: cancel only when
//     something is speaking/pending, and then speak after o.deferMs; a newer say()/stop()
//     (generation counter) wins over a deferred one.
//  2. the engine left paused after backgrounding: resume() first when ss.paused. And an
//     utterance that never starts (no onstart/onend/onerror, ss.speaking never seen true,
//     then !speaking && !pending after o.watchMs) is retried once. The watchdog is armed
//     only when ss.speaking is a boolean (every real browser; the test stubs that lack it
//     keep the exact old synchronous behaviour).
//  3. an utterance garbage-collected mid-speech (onend never fires): the driver keeps the
//     current utterance referenced until its onend/onerror.
const TTS_TIMING = { deferMs: 80, watchMs: 1200, pollMs: 200, cancelTtlMs: 500 };
function ttsDriver(ss, o){
  const opt = Object.assign({}, TTS_TIMING, o || {});
  const setT = opt.setTimeout, clrT = opt.clearTimeout;
  // cancelled makes the next say() defer. A stop() with no follow-up say(), or a later stop()
  // bumping gen before a deferred go() runs, would leave it stuck true and defer an unrelated
  // say() much later, so it self-clears after cancelTtlMs on its own timer.
  let gen = 0, cur = null, timers = [], cancelled = false, cancelledTimer = null;
  // Utterances the driver itself cancelled to retry (never started): an engine that fires
  // onend (not an error) on cancel makes that look like a finished utterance, so callers
  // that chain on the end (app.html speakTTS onEnd) ask dropped(u) first.
  const droppedSet = typeof WeakSet === "function" ? new WeakSet() : null;
  const clear = () => { timers.forEach(t => { try{ clrT(t); }catch(e){} }); timers = []; };
  const busy = () => !!(ss.speaking || ss.pending);
  const markCancelled = () => {
    cancelled = true;
    if(cancelledTimer) try{ clrT(cancelledTimer); }catch(e){}
    cancelledTimer = setT(() => { cancelled = false; cancelledTimer = null; }, opt.cancelTtlMs);
  };
  const clearCancelled = () => { cancelled = false; if(cancelledTimer){ try{ clrT(cancelledTimer); }catch(e){} cancelledTimer = null; } };
  // cancel() only when the engine reports something to cancel (failure mode 1).
  function stop(){
    gen++; clear(); cur = null;
    if(busy()){ markCancelled(); try{ ss.cancel(); }catch(e){} return true; }
    return false;
  }
  function say(make){
    const g = ++gen; clear();
    const hadWork = busy() || cancelled;
    if(busy()){ try{ ss.cancel(); }catch(e){} }
    if(hadWork) markCancelled(); else clearCancelled();
    const go = retry => {
      if(g !== gen) return;
      clearCancelled();
      if(ss.paused){ try{ ss.resume(); }catch(e){} }
      const u = make(); if(!u) return;
      let alive = false;
      const on = (k, flag) => { const f = u[k]; u[k] = e => { if(flag) alive = true; if(k !== "onstart" && cur === u) cur = null; if(f) f.call(u, e); }; };
      on("onstart", true); on("onend", true); on("onerror", true);
      cur = u;
      try{ ss.speak(u); }catch(e){ cur = null; return; }
      if(retry || typeof ss.speaking !== "boolean") return;
      let waited = 0;
      const poll = () => {
        if(g !== gen || alive) return;
        if(ss.speaking){ alive = true; return; }
        waited += opt.pollMs;
        if(waited < opt.watchMs){ timers.push(setT(poll, opt.pollMs)); return; }
        if(!ss.speaking && !ss.pending){ cur = null; if(droppedSet) droppedSet.add(u); markCancelled(); try{ ss.cancel(); }catch(e){} timers.push(setT(() => go(true), opt.deferMs)); }
      };
      timers.push(setT(poll, opt.pollMs));
    };
    if(hadWork) timers.push(setT(() => go(false), opt.deferMs)); else go(false);
  }
  return { say, stop, current: () => cur, dropped: u => !!(droppedSet && droppedSet.has(u)) };
}
// Recorded clip start watchdog (docs/AUDIO.md). Armed only on an element with onplaying
// (a real HTMLAudioElement), so the test fakes keep the old behaviour.
const CLIP_START_MS = 4000;
function clipStartWatch(a, ms, onFail, timers){
  if(!a || !("onplaying" in a)) return () => {};
  let done = false, t = null;
  const disarm = () => { if(done) return; done = true; if(t !== null){ try{ timers.clearTimeout(t); }catch(e){} } };
  const prev = a.onplaying;
  a.onplaying = e => { disarm(); if(prev) prev.call(a, e); };
  t = timers.setTimeout(() => { if(done) return; done = true; onFail(); }, ms);
  return disarm;
}
// Whether listening items can play: needs the API, and — once the browser has
// reported its voice list — a voice for the pack's language (a zh word read by an
// English voice is worse than showing it). An empty list means "not loaded yet /
// unknown": optimistic, since some browsers never populate it but still speak.
// Only getVoices() counts as evidence: an utterance with just a lang tag and no
// installed voice still fires onstart/onend on Android Chrome, silently.
function speechUsable(apiPresent, voices, lang){
  if(!apiPresent) return false;
  if(!voices || !voices.length) return true;
  return !!pickVoice(voices, lang);
}
// Samsung Internet on Android reports a voice via speechSynthesis for most
// languages but never actually plays audio through it, so speechUsable()
// (which only checks voice availability) misses it. Pure UA check, no pack
// involvement: shown regardless of hasSpeech, every visit, no dismiss —
// unlike the no-voice notice, the problem persists until the browser changes.
function isSamsungBrowser(ua){
  return /SamsungBrowser/i.test(String(ua||""));
}

// Recorded clips (docs/AUDIO.md). Both are false/undefined for packs without the new
// fields, which is what keeps those packs byte-identical.
function wordAudio(w){
  return isObj(w) && typeof w.audio === "string" && w.audio ? w.audio : undefined;
}
// A word's TTS text: its `say` carrier when set (zh 还 hái -> 孩, docs/PACK_SCHEMA.md words.json),
// else the written form. Spoken only, never displayed.
function wordSay(w){
  return isObj(w) && typeof w.say === "string" && w.say ? w.say : (isObj(w) ? w.w : undefined);
}
function packAudio(pack){
  return isObj(pack) && isObj(pack.audio) && typeof pack.audio.voice === "string" && !!pack.audio.voice;
}
// One shared slot so repeated or duplicated taps never stack parallel players or requests.
function audioSlot(make){
  let a = null;
  return {
    play(url){
      if(!a) a = make(); else { try{ a.pause(); }catch(e){} }
      a.src = url;
      return a;
    },
    stop(){ if(a){ try{ a.pause(); }catch(e){} } }
  };
}

// Optional pack data (docs/PACK_SCHEMA.md "passages.json"). The unlock is stored in
// prog.read.unlocked so it survives later changes. prog.read is absent until the learner
// first meets a passage, so older stored progress needs no migration.
const READ_UNLOCK = 0.7;
// Looking back is not tracked (owner 2026-10-03).
const READ_WEIGHT = { tapped: 2, wrong: 2 };
function readState(prog){
  if(!isObj(prog.read)) prog.read = {};
  if(!isObj(prog.read.unlocked)) prog.read.unlocked = {};
  if(!isObj(prog.read.done)) prog.read.done = {};
  return prog.read;
}
function readingLevels(passages, words, pack, prog){
  const learned = learnedWords(words, pack, prog);
  const byLv = wordsByLevel(words, pack);
  const stored = (isObj(prog.read) && isObj(prog.read.unlocked)) ? prog.read.unlocked : {};
  return levelIds(pack).map(lv => {
    const total = byLv[lv].length, got = learned.filter(w => w.lv === lv).length;
    const need = Math.ceil(total * READ_UNLOCK - 1e-9);
    const met = total > 0 && got >= need;
    return { lv, total, learned: got, need, frac: total ? got/total : 0, met, unlocked: met || !!stored[lv],
      count: (passages||[]).filter(p => p.lv === lv).length };
  });
}
function updateReadUnlocks(passages, words, pack, prog){
  const fresh = readingLevels(passages, words, pack, prog).filter(l => l.met && l.count > 0 && !(isObj(prog.read) && isObj(prog.read.unlocked) && prog.read.unlocked[l.lv]));
  if(fresh.length){ const st = readState(prog); fresh.forEach(l => { st.unlocked[l.lv] = 1; }); }
  return fresh.map(l => l.lv);
}
// Placed read (fb51, pack key placedRead, default since the flag collapse; owner 2026-10-08: placed at the top level, Read still began at the first level): with prog.pl
// the unread passages of the placed level come first, then the levels below it from the top down, then the levels above
// in pack order. Rotation, listening and re-read logic only ever call this for the new-passage pick.
function suggestPassage(passages, words, pack, prog){
  const open = new Set(readingLevels(passages, words, pack, prog).filter(l => l.unlocked).map(l => l.lv));
  const done = (isObj(prog.read) && isObj(prog.read.done)) ? prog.read.done : {};
  const list = passages || [];
  const ids = levelIds(pack), pi = prog.pl != null ? ids.indexOf(String(prog.pl)) : -1;
  if(pi < 0) return list.find(p => open.has(p.lv) && !done[p.id]) || null;
  const rank = p => { const i = ids.indexOf(String(p.lv)); return i <= pi ? pi - i : i; };
  let best = null;
  list.forEach(p => { if(open.has(p.lv) && !done[p.id] && (!best || rank(p) < rank(best))) best = p; });
  return best;
}
// Today's Read stage (README "Today"). Skipping the stage writes nothing, so the same
// passage comes back next session.
const READ_REREAD_DAYS = 7;
function isoDayNumber(d){
  if(d instanceof Date) return isNaN(d) ? NaN : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d == null ? "" : d));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
}
// reviewOnly (paused): a spaced re-read only, never a first read. now: unused since the read rotation became the only rule.
function nextReadItem(passages, words, pack, prog, now, reviewOnly, sn, rng, canListen){
  return nextReadRotation(passages, words, pack, prog, reviewOnly, sn, rng, canListen);
}
// Read rotation (pack key readRotation, default since the flag collapse; owner 2026-10-03): day gates say little when 60 passages can fit in one
// day, so stages alternate by pass instead: after a reading pass a listening pass, after a
// listening pass a reading one. sn is the session being planned: the Today plan is made before
// Go starts it (daySn + 1), a replan inside the session uses daySn. A passage passed in that
// session (a Read-tab pass before the stage) is not picked; the previous session's is.
function randomMin(list, key, rng){
  if(!list.length) return null;
  const k = Math.min(...list.map(key));
  const tied = list.filter(x => key(x) === k);
  return tied[Math.floor((rng || Math.random)() * tied.length)] || tied[0];
}
function nextReadRotation(passages, words, pack, prog, reviewOnly, sn, rng, canListen){
  const now = Number.isInteger(sn) ? sn : daySn(prog) + 1;
  const done = (isObj(prog.read) && isObj(prog.read.done)) ? prog.read.done : {};
  const open = new Set(readingLevels(passages, words, pack, prog).filter(l => l.unlocked).map(l => l.lv));
  const cands = (passages||[]).filter(p => { const r = done[p.id];
    return open.has(p.lv) && isObj(r) && typeof r.sc === "number" && typeof r.n === "number" && r.s !== now; });
  // Seeded by the session and the pass count when the caller gives no rng: the Today plan
  // re-renders, and its pick must not change until a pass is made.
  if(typeof rng !== "function") rng = seededRng(hashSeed("read:" + now + ":" + Object.keys(done).reduce((a, k) => a + ((isObj(done[k]) && done[k].x) || 0), 0)));
  let lastS = -Infinity, lastLs = -Infinity;
  Object.keys(done).forEach(k => { const r = done[k]; if(!isObj(r)) return;
    if(typeof r.s === "number" && r.s > lastS) lastS = r.s;
    if(typeof r.ls === "number" && r.ls > lastLs) lastLs = r.ls; });
  if(lastS > -Infinity && lastLs < lastS){
    const hear = cands.filter(p => typeof canListen === "function" && canListen(p));
    const never = hear.filter(p => typeof done[p.id].ls !== "number");
    const p = never.length ? randomMin(never, () => 0, rng) : randomMin(hear, q => done[q.id].ls, rng);
    if(p) return { p, reason: "reread", mode: "listen" };
  }
  const fresh = reviewOnly ? null : suggestPassage(passages, words, pack, prog);
  if(fresh) return { p: fresh, reason: "new", mode: "read" };
  const weak = cands.filter(p => done[p.id].sc < done[p.id].n);
  const p = randomMin(weak.length ? weak : cands, q => done[q.id].x || 0, rng);
  return p ? { p, reason: "reread", mode: "read" } : null;
}
// Listen mode (docs/PACK_SCHEMA.md "passages.json", Listening pass): the rotation's pick says the mode.
function readPassMode(r, prog, canListen, pack){
  return r && r.mode === "listen" && canListen ? "listen" : "read";
}
// Seeded by the passage id and rotated by attempt count: stable across re-renders, and
// consecutive attempts never hide the same question set.
function hashSeed(str){
  let h = 2166136261 >>> 0;
  for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function seededRng(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function listenAudioOnly(pid, attempts, n, pack){
  const k = Math.ceil((n || 0) / 2);
  if(!(k > 0)) return [];
  // every question audio-only (pack key listenQuestions "all", default since the flag collapse)
  return Array.from({ length: n }, (_, i) => i);
}
// Each pass asks the questions in a new order, stable within the pass
// (seeded by the passage id and the attempt count, as listenAudioOnly).
function passageForPass(p, attempts, pack){
  if(!p || !Array.isArray(p.questions) || p.questions.length < 2) return p;
  const qs = shuffle(p.questions.slice(), seededRng(hashSeed(String(p.id) + ":" + (attempts || 0))));
  return Object.assign({}, p, { questions: qs });
}
function passageLength(p, pack){
  if(!pack || pack.spaced !== false) return String((p && p.text) || "").trim().split(/\s+/).filter(Boolean).length;
  return ((p && p.sentences) || []).reduce((n, s) => n + ((s.words || []).length), 0);
}
// Builder spans (s.spans, [start, end, wordId, gloss?]) come first: they carry the token each
// word was read from, so inflected forms like mele or va are tappable. Ids with no span fall
// back to surface matching and never cover a span. Unplaced ids are returned so the UI can
// list them and every linked word stays tappable.
function splitsPair(t, i){ return i > 0 && i < t.length && t.codePointAt(i - 1) > 0xFFFF; }
// Shared by passage and plain-sentence spans. Without wordsById (exampleSentences has none)
// the known-word check is skipped; the id must still be in the sentence's words.
function keptSpans(s, wordsById){
  const t = String((s && s.t) || "");
  const idSet = new Set((s && s.words) || []);
  const keep = [];
  ((s && Array.isArray(s.spans)) ? s.spans : [])
    .filter(x => Array.isArray(x) && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] >= 0 && x[0] < x[1] && x[1] <= t.length && idSet.has(x[2]) && (!wordsById || wordsById[x[2]])
      && t.slice(x[0], x[1]).trim() && !splitsPair(t, x[0]) && !splitsPair(t, x[1]))
    .map(x => (typeof x[3] === "string" && x[3].trim() ? { start: x[0], end: x[1], id: x[2], gloss: x[3] } : { start: x[0], end: x[1], id: x[2] }))
    .sort((a,b) => a.start - b.start)
    .forEach(h => { if(!keep.some(k => h.start < k.end && k.start < h.end)) keep.push(h); });
  return keep;
}
function passageSegments(s, wordsById, pack){
  const t = String((s && s.t) || "");
  const spaced = !pack || pack.spaced !== false;
  const by = wordsById || {};
  const arts = packArticles(by);
  const ids = [...new Set((s && s.words) || [])];
  const keep = keptSpans(s, by), spanned = new Set(keep.map(h => h.id));
  const hits = [];
  ids.forEach(id => {
    const e = by[id]; if(!e || spanned.has(id)) return;
    const forms = [...new Set([...textForms(e), bareForm(e, arts)].filter(Boolean))];
    forms.forEach(f => findSurface(t, f, spaced).forEach(m => hits.push({ start: m.start, end: m.end, id })));
  });
  hits.sort((a,b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  hits.forEach(h => { if(!keep.some(k => h.start < k.end && k.start < h.end)) keep.push(h); });
  keep.sort((a,b) => a.start - b.start);
  const parts = []; let at = 0;
  keep.forEach(h => { if(h.start > at) parts.push({ text: t.slice(at, h.start), id: null }); parts.push(h.gloss ? { text: t.slice(h.start, h.end), id: h.id, gloss: h.gloss } : { text: t.slice(h.start, h.end), id: h.id }); at = h.end; });
  if(at < t.length || !parts.length) parts.push({ text: t.slice(at), id: null });
  const placed = new Set(keep.map(h => h.id));
  return { parts, unplaced: ids.filter(id => !placed.has(id) && by[id]) };
}
function gradeQuestion(q, answer){
  if(!q) return false;
  if(q.type === "tf") return typeof answer === "boolean" && answer === q.answer;
  return Number.isInteger(answer) && answer === q.answer;
}
// A word with several reasons takes the largest weight, never the sum. Looking back
// is not a reason.
function passageWeakWords(passage, log, wordsById){
  const out = new Map();
  const add = (id, why) => {
    if(wordsById && !wordsById[id]) return;
    const e = out.get(id) || { id, weight: 0, why: [] };
    if(e.why.indexOf(why) < 0) e.why.push(why);
    e.weight = Math.max(e.weight, READ_WEIGHT[why]);
    out.set(id, e);
  };
  ((log && log.tapped) || []).forEach(id => add(id, "tapped"));
  const qs = (passage && passage.questions) || [];
  ((log && log.answers) || []).forEach((a, i) => {
    if(!a || !qs[i]) return;
    if(!a.ok) (qs[i].words || []).forEach(id => add(id, "wrong"));
  });
  return [...out.values()];
}
// A not-yet-learned word is flagged `d` so Today's review includes it. Accepted side effect:
// it then counts as learned everywhere, including the READ_UNLOCK threshold.
function applyWeakWords(prog, entries, words, pack){
  const learned = new Set(learnedWords(words, pack, prog).map(w => w.id));
  (entries || []).forEach(e => {
    if(!e || !(e.weight > 0)) return;
    const p = ensureWordRec(prog, words, pack, e.id);
    p.w = (p.w || 0) + e.weight; p.s = 0;
    if(p.prov) delete p.prov;
    if(!learned.has(e.id)) p.d = 1;
  });
  return prog;
}
// l is absent for a reading pass, so reading-only records are unchanged. l is credit only (the read rotation's
// alternation reads r.mode) and stays once earned: a later reading pass must not take back what a listening pass
// earned (the goal position's passage share fell .87 -> .57, fb41).
// s: session of the latest pass; ls: of the latest listening pass.
// t (fb46): whole seconds from opening the passage to its results, the LATEST reading pass only
// (a listen pass, or a reading pass that ran over READ_MAX_S or was hidden over READ_HIDE_MAX_MS, keeps the previous t:
// all ported packs alternate read/listen, so dropping it would make the Reading row vanish as listen passes land).
function markPassageDone(prog, pid, sc, n, d, listen, pack, t){
  const st = readState(prog); const prev = st.done[pid];
  st.done[pid] = { sc, n, d: String(d), x: ((prev && prev.x) || 0) + 1 };
  if(!listen && typeof t === "number" && t > 0) st.done[pid].t = Math.round(t);
  else if(prev && typeof prev.t === "number") st.done[pid].t = prev.t;
  if(listen || (prev && prev.l)) st.done[pid].l = 1;
  const sn = daySn(prog);
  st.done[pid].s = sn;
  if(listen) st.done[pid].ls = sn;
  else if(prev && typeof prev.ls === "number") st.done[pid].ls = prev.ls;
  return st.done[pid];
}
// pack.progressMap.goals (owner 2026-10-04: the learner feels no progress): one 0..1 position per goal. A pack without goals
// has no progress map (the goal-less `progressMap: true` bar went with the flag collapse). An absent part's weight goes to words.
const PM_KEEP = 14;
function progressMapGoals(pack){ const m = pack && pack.progressMap; return (m && typeof m === "object" && Array.isArray(m.goals)) ? m.goals : []; }
function progressMapOn(pack){ return progressMapGoals(pack).length > 0; }
function progressPosition(prog, pack, words, units, passages){
  const ws = words || [], us = units || [], ps = passages || [];
  const recs = (prog && isObj(prog.w)) ? prog.w : {}, bw = knownCtx(pack, us);
  const known = ws.filter(w => wordKnownP(recs[w.id], w, pack, prog, bw)).length;
  let wu = us.length ? 0.25 : 0, wp = ps.length ? 0.25 : 0;
  const ww = 1 - wu - wp;
  let x = ws.length ? ww * known / ws.length : 0;
  if(us.length){ const cr = charRecs(prog); x += wu * us.filter(u => cr[u.id] && (posKnown(pack, cr[u.id]) || unitDone(cr[u.id], u, pack))).length / us.length; }
  if(ps.length){ const dn = (prog && isObj(prog.read) && isObj(prog.read.done)) ? prog.read.done : {}; x += wp * ps.filter(p => dn[p.id] && dn[p.id].l).length / ps.length; }
  return Math.max(0, Math.min(1, x));
}
// Goal ladder (owner 2026-10-04: the whole-pack bar read 2/10): one goal scoped to levels <= goal.upTo.
// A unit's level is its own lv, else the level of its first word.
function goalPosition(prog, pack, goal, words, units, passages){
  const idx = levelIndexMap(pack), top = idx[String(goal && goal.upTo)];
  if(top === undefined) return 0;
  const inR = lv => idx[String(lv)] !== undefined && idx[String(lv)] <= top;
  const ws = (words || []).filter(w => inR(w.lv));
  const byId = {}; for(const w of (words || [])) byId[w.id] = w;
  const us = (units || []).filter(u => inR(u.lv !== undefined ? u.lv : (byId[(u.words || [])[0]] || {}).lv));
  const ps = (passages || []).filter(p => inR(p.lv));
  const recs = (prog && isObj(prog.w)) ? prog.w : {}, bw = knownCtx(pack, units);
  const known = ws.filter(w => wordKnownP(recs[w.id], w, pack, prog, bw)).length;
  // Placed known (owner 2026-10-09): a goal whose levels all lie at or below the placed level (prog.pl) is positioned from
  // its words and units only, never its passages and with no "still placed" condition, so one miss moves the bar by one word
  // and a covered goal stays full (no estimate, currentGoal on the next unmet goal) after its provisional records settle or drop.
  const plIdx = prog && typeof prog.pl === "string" ? idx[prog.pl] : undefined;
  const placedGoal = plIdx !== undefined && top <= plIdx;
  const wu = us.length ? 0.2 : 0, wp = ps.length && !placedGoal ? 0.2 : 0;
  let x = ws.length ? (1 - wu - wp) * known / ws.length : 0;
  if(us.length){ const cr = charRecs(prog); x += wu * us.filter(u => cr[u.id] && (posKnown(pack, cr[u.id]) || charTier(cr[u.id].s, pack) !== "pron")).length / us.length; }
  if(wp){ const dn = (prog && isObj(prog.read) && isObj(prog.read.done)) ? prog.read.done : {}; x += wp * ps.filter(p => dn[p.id] && dn[p.id].l).length / ps.length; }
  return Math.max(0, Math.min(1, x));
}
const GOAL_DONE = 0.9;
function currentGoal(prog, pack, words, units, passages){
  const gs = progressMapGoals(pack); if(!gs.length) return null;
  let last = null;
  for(let i = 0; i < gs.length; i++){
    last = { i, n: gs.length, goal: gs[i], p: goalPosition(prog, pack, gs[i], words, units, passages) };
    if(last.p < GOAL_DONE) return Object.assign(last, { all: false });
  }
  return Object.assign(last, { all: true });
}
function goalPositions(prog, pack, words, units, passages){
  return progressMapGoals(pack).map(g => goalPosition(prog, pack, g, words, units, passages));
}
// Optional prog.pm: older engines keep it on boot (validateProgShape ignores unknown top-level fields).
// Entries are {sn, p, g} (g = the current goal index); an older record's {sn, p} entries (the goal-less bar, gone with the
// flag collapse) stay valid.
function recordProgressMap(prog, pack, words, units, passages){
  const cg = prog ? currentGoal(prog, pack, words, units, passages) : null;
  if(!cg) return false;
  const e = { sn: daySn(prog), p: Math.round(cg.p * 1000) / 1000, g: cg.i };
  const pm = Array.isArray(prog.pm) ? prog.pm.filter(x => isObj(x) && x.sn !== e.sn) : [];
  pm.push(e);
  prog.pm = pm.slice(-PM_KEEP);
  return true;
}
// Progress v2 (docs/PACK_SCHEMA.md "progressView", engine default since the flag collapse; owner 2026-10-07): the Progress tab leads
// with what moved since the learner last left it. prog.pv = {sn, m, co, p} (sessions, mastered words,
// character units at their target, passages done) is written when the tab is left (app.html), never at
// boot; older engines keep it (validateProgShape ignores unknown top-level fields).
// The Progress "done" count: unitDone (frequency tiers).
function unitAtTarget(rec, unit, prog, pack){
  if(!isObj(rec)) return false;
  return unitDone(rec, unit, pack);
}
function progressTotals(prog, pack, words, units, passages){
  const w = (prog && prog.w) || {}, recs = charRecs(prog), bw = knownCtx(pack, units);
  const done = prog && isObj(prog.read) && isObj(prog.read.done) ? prog.read.done : {};
  return {
    sn: prog && typeof prog.sessions === "number" ? prog.sessions : 0,
    // pack.levelExam: the same mastered count as the level rows (wordKnownX).
    m: learnedWords(words, pack, prog).filter(x => wordKnownX(w[x.id], x, pack, prog, bw)).length,
    co: (units || []).filter(u => unitAtTarget(recs[u.id], u, prog, pack)).length,
    p: (passages || []).filter(x => done[x.id]).length,
  };
}
// A level below the current one is settled (collapses into one Progress line) once 90% of its learned words are mastered (owner 2026-10-07).
const SETTLED = 0.9;
const levelSettled = (learned, mastered) => learned > 0 && mastered >= SETTLED * learned - 1e-9;
const PV_KEYS = ["sn", "m", "co", "p"];
// A pv an older engine, an import or a hand edit mangled reads as no visit yet.
function progressVisit(prog){
  const v = prog && prog.pv;
  return isObj(v) && PV_KEYS.every(k => typeof v[k] === "number" && isFinite(v[k])) ? v : null;
}
function progressDeltas(prog, cur){
  const v = progressVisit(prog);
  return v ? Object.fromEntries(PV_KEYS.map(k => [k, cur[k] - v[k]])) : null;
}
// Returns whether pv changed (the caller saves only then).
function noteProgressVisit(prog, pack, cur){
  if(!prog) return false;
  const v = progressVisit(prog);
  if(v && PV_KEYS.every(k => v[k] === cur[k])) return false;
  prog.pv = { sn: cur.sn, m: cur.m, co: cur.co, p: cur.p };
  return true;
}
// Words missed in the last n sessions (session ordinal prog.sn). Records keep no miss ordinal: a pair
// streak reset to 0 by an answer in the window stands for the miss (a later right answer in that pair
// hides it), plus a miss still pending in the day log (ms); without pairs a record at streak 0 with
// misses, last answered in the window. Most recent first.
const WEEK_SESSIONS = 7;
function recentMisses(prog, list, n){
  const sn = daySn(prog); if(!sn) return [];
  const lo = sn - (n || WEEK_SESSIONS) + 1, w = (prog && prog.w) || {};
  const log = isObj(prog.day) && isObj(prog.day.a) ? prog.day.a : {};
  const out = [];
  (list || []).forEach(x => {
    const r = w[x.id]; if(!isObj(r)) return;
    let a = -1;
    if(isObj(r.p)) PAIRS.forEach(k => { const e = pairEntry(r.p[k]); if(e && e[0] === 0 && e[1] >= lo && e[1] > a) a = e[1]; });
    else if((r.s || 0) === 0 && (r.w || 0) > 0 && typeof r.u === "number" && r.u >= lo) a = r.u;
    const e = log["w:" + x.id];
    if(isObj(e) && Array.isArray(e.mk) && e.mk.length && typeof e.ms === "number" && e.ms >= lo && e.ms > a) a = e.ms;
    if(a >= 0) out.push({ w: x, a });
  });
  return out.sort((x, y) => y.a - x.a || (x.w.id < y.w.id ? -1 : x.w.id > y.w.id ? 1 : 0)).map(o => o.w);
}
// g/n (goal packs): only entries of goal g count; entries without g count for goal 0 when the pack has <= 1 goal.
// Goal packs pace to GOAL_DONE (where the goal switches); the whole-pack bar paces to 1.
function sessionsToGo(prog, g, n){
  let pm = prog && Array.isArray(prog.pm) ? prog.pm : [];
  if(g !== undefined) pm = pm.filter(e => e.g === g || (e.g === undefined && g === 0 && n <= 1));
  if(pm.length < PM_KEEP) return null;
  const a = pm[0], z = pm[pm.length - 1];
  const rate = (z.p - a.p) / (z.sn - a.sn);
  if(!(rate > 0) || !isFinite(rate)) return null;
  return Math.max(0, Math.ceil(((g !== undefined ? GOAL_DONE : 1) - z.p) / rate - 1e-9));
}
// App v2 ETA (docs/PACK_SCHEMA.md "appView" > "ETA model"; owner 2026-10-08: an estimate from the first
// session). Goal packs: a calibrated curve, never the measured pace (pm.p rounds to 0.001 and the pace at PM_KEEP entries
// missed the actual crossing by -57% to +195% on owner-export sims). A whole-pack bar has no model: sessionsToGo or nothing.
// pack.eta.curve[g] = [[position, sessions remaining until the goal first reaches GOAL_DONE], ...] sampled from fresh-record
// sims (tests/eta_checks.js --calibrate): a goal gains ~9x faster early (new words count at once) than late (mastery
// streaks), so one constant slope cannot fit both ends (fb42; the fb41 constant read "≈ 830" on a fresh zh record).
// pack.eta.knownCurve = {<level id>: [[known share of that level, sessions until the next level's gate opens], ...]}: the
// share rises 0.3x a hold's mean rate in its first third and up to 2x in its last (fresh sims), past +-30% of linear, and
// one curve pooled over levels missed the zh level with twice the words of the two before it by -38%.
// Legacy shape {gain: [g...], known: k} (sites published before fb42): a constant slope, kept until the site republishes.
// pack.eta is required pack data (tools/validate_pack.py; the zh-constant fallback for a pack without it went with the flag
// collapse): a pack.eta without the sub-key a call needs gives no estimate (a site never inherits another's pace by omission).
function etaCurveAt(curve, x){
  if(!Array.isArray(curve) || !curve.length) return null;
  if(x <= curve[0][0]) return curve[0][1];
  for(let i = 1; i < curve.length; i++){
    const [x1, y1] = curve[i];
    if(x <= x1){ const [x0, y0] = curve[i - 1]; return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1; }
  }
  return 0;
}
function etaGain(pack, g){
  const e = pack && pack.eta;
  if(!isObj(e) || !Array.isArray(e.gain) || !e.gain.length) return null;
  const v = e.gain[Math.min(g, e.gain.length - 1)];
  return typeof v === "number" && v > 0 ? v : null;
}
function etaKnown(pack){
  const e = pack && pack.eta;
  return isObj(e) && typeof e.known === "number" && e.known > 0 ? e.known : null;
}
const etaRound = r => r === null ? null : Math.max(1, Math.ceil(r - 1e-9));
// pack.eta.placed {<level id>: {bySessions, knownCurve}}: curves for a record the Test tab placed into that level (prog.pl,
// written by applyPlacement when no session came before it). A placed level's words start provisional and the scheduler
// brings them to mastery while new levels are taught: a zh start placed into the third level took ~155 sessions to its first
// goal against ~90 fresh, and the placed level's gate hold 2-4x a fresh one. bySessions[g] reads prog.sessions (sessions
// since placement), since such a start's goal position sits on a plateau for ~70 sessions before it crosses. The set
// applies for the whole record (its provisional records clear 50-80 sessions before the crossing); an entry it lacks, a
// level without a set, or no prog.pl: the fresh curves.
// Placed known: a prog.pl without a set reads the nearest lower level's set (zh has sets for the second and third level
// only, so a top-level landing read the fresh curves at a position of 0).
function etaPlaced(prog, pack){
  const e = pack && pack.eta, pl = prog && prog.pl;
  if(!(isObj(e) && isObj(e.placed) && typeof pl === "string")) return null;
  if(isObj(e.placed[pl])) return e.placed[pl];
  const ids = levelIds(pack);
  for(let i = ids.indexOf(pl) - 1; i >= 0; i--) if(isObj(e.placed[ids[i]])) return e.placed[ids[i]];
  return null;
}
function sessionsToGoX(prog, g, n, ctx){
  const goal = g !== undefined && ctx ? progressMapGoals(ctx.pack)[g] : null;
  if(!goal) return g === undefined ? sessionsToGo(prog) : null;
  const p = goalPosition(prog, ctx.pack, goal, ctx.words, ctx.units, ctx.passages);
  if(p >= GOAL_DONE) return 0;
  const e = ctx.pack && ctx.pack.eta, ps = etaPlaced(prog, ctx.pack);
  // A placed start's provisional records count as known at once (placed known), so a goal reads the fresh curve at its
  // position; eta.placed bySessions (the plateau such a start sat on before) is no longer read.
  if(isObj(e) && Array.isArray(e.curve)) return etaRound(etaCurveAt(e.curve[g], p));
  const gain = etaGain(ctx.pack, g);
  return gain === null ? null : Math.ceil((GOAL_DONE - p) / gain - 1e-9);
}
// Sessions until the waiting level opens (levelGate); null when no level waits.
function levelOpensIn(words, pack, prog, units){
  const h = levelGateHold(words, pack, prog, units);
  if(!h) return null;
  const e = pack.eta, pct = levelKnownPct(words, pack, prog, h.prev, units), ps = etaPlaced(prog, pack);
  if(ps && isObj(ps.knownCurve) && Array.isArray(ps.knownCurve[h.prev])) return etaRound(etaCurveAt(ps.knownCurve[h.prev], pct));
  if(isObj(e) && "knownCurve" in e) return etaRound(isObj(e.knownCurve) ? etaCurveAt(e.knownCurve[h.prev], pct) : null);
  const k = etaKnown(pack);
  if(k === null) return null;
  const n = (wordsByLevel(words, pack)[h.prev] || []).length;
  return Math.max(1, Math.ceil((LEVEL_GATE - pct) * n / k - 1e-9));
}
function readingStats(passages, pack, prog){
  const done = (isObj(prog.read) && isObj(prog.read.done)) ? prog.read.done : {};
  return levelIds(pack).map(lv => {
    const ps = (passages||[]).filter(p => p.lv === lv);
    const d = ps.filter(p => done[p.id]).map(p => done[p.id]);
    const pct = d.filter(r => r.n > 0).map(r => r.sc / r.n * 100);
    return { lv, total: ps.length, done: d.length, avg: pct.length ? Math.round(pct.reduce((a,b)=>a+b,0) / pct.length) : null };
  }).filter(r => r.total > 0);
}
// Reading speed (fb46): median over the passages with a stored t, shown after READ_ROW_MIN of them. A passage with no spaces
// to speak of (zh, ja) counts letters, so the row says characters; others count whitespace-separated words.
const READ_MAX_S = 1200, READ_HIDE_MAX_MS = 120000, READ_ROW_MIN = 3;
function readTimeKeep(secs, hiddenMs){ return secs > 0 && secs <= READ_MAX_S && !(hiddenMs > READ_HIDE_MAX_MS); }
function passageUnits(p, pack){
  const text = String((p && p.text) || "");
  if(pack && pack.spaced === false) return { n: [...text].filter(ch => /[\p{L}\p{N}]/u.test(ch)).length, unit: "characters" };
  return { n: text.split(/\s+/).filter(Boolean).length, unit: "words" };
}
function readingSpeed(passages, pack, prog){
  if(!isObj(prog) || !isObj(prog.read) || !isObj(prog.read.done)) return null;
  const rates = []; let unit = "words";
  for(const p of passages || []){
    const r = prog.read.done[p.id];
    if(!r || typeof r.t !== "number" || !(r.t > 0)) continue;
    const u = passageUnits(p, pack); if(!(u.n > 0)) continue;
    unit = u.unit; rates.push(u.n * 60 / r.t);
  }
  if(rates.length < READ_ROW_MIN) return null;
  rates.sort((a, b) => a - b);
  const m = rates.length >> 1, med = rates.length % 2 ? rates[m] : (rates[m - 1] + rates[m]) / 2;
  return { n: rates.length, rate: Math.max(1, Math.round(med)), unit };
}
function validateReadShape(r){
  if(!isObj(r)) return "read must be an object";
  if(r.unlocked !== undefined){
    if(!isObj(r.unlocked)) return "read.unlocked must be an object";
    for(const k of Object.keys(r.unlocked)) if(typeof r.unlocked[k] !== "number" && typeof r.unlocked[k] !== "boolean") return `read.unlocked.${k} must be a number or boolean`;
  }
  if(r.done !== undefined){
    if(!isObj(r.done)) return "read.done must be an object";
    for(const k of Object.keys(r.done)){
      const p = r.done[k];
      if(!isObj(p)) return `read.done.${k} must be an object`;
      for(const f of ["sc","n","x","l","s","ls","t"]) if(p[f] !== undefined && typeof p[f] !== "number") return `read.done.${k}.${f} must be a number`;
      if(p.d !== undefined && typeof p.d !== "string") return `read.done.${k}.d must be a string`;
    }
  }
  return null;
}

// Optional characters stage (the merge plan in docs/, §2-3). Nothing here runs for a pack
// without a `characters` block. Language-agnostic: the pack decides what a unit is (zh:
// every word, read by its pron; ja: words written with non-kana glyphs).
const CHARS_PROG_VERSION = 1;
const CHAR_SET_SIZE = 10, CHAR_MASTERED = 3, CHAR_BARE = 6;
const REVIEW_SIZE_CHARS = 20; // Review once characters have started (15 before)
const CHAR_KINDS = ["charRead","charSound","charPick","charRecall"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const cpLen = s => [...String(s == null ? "" : s)].length;
function charsConfig(pack){
  const c = pack && pack.characters;
  if(!isObj(c)) return null;
  const kinds = (k, d) => { const f = Array.isArray(k) ? k.filter(x => CHAR_KINDS.includes(x)) : []; return f.length ? f : d; };
  return Object.assign({
    label: c.label != null ? String(c.label) : "",
    stages: (Array.isArray(c.stages) ? c.stages : []).filter(isObj)
      .map(st => Object.assign({ after: String(st.after), levels: (Array.isArray(st.levels) ? st.levels : []).map(String) }, typeof st.label === "string" && st.label ? { label: st.label } : {})),
    setSize: Number.isInteger(c.setSize) && c.setSize > 0 ? c.setSize : CHAR_SET_SIZE,
    mastered: typeof c.mastered === "number" ? c.mastered : CHAR_MASTERED,
    bare: typeof c.bare === "number" ? c.bare : CHAR_BARE,
    learnKinds: kinds(c.learnKinds, ["charPick","charRead"]),
    reviewKinds: kinds(c.reviewKinds, ["charRead","charSound"]),
    testKinds: testKinds(c.testKinds),
    compose: c.compose === true,
    bareBy: c.bareBy === "typed" ? "typed" : null,
    bareWords: c.bareWords === true,
    // characters.learn "lag" supersedes withWords: no turn, no order chips.
    withWords: c.withWords === true && c.learn !== "lag",
  }, c.learn === "lag" ? Object.assign({ learn: "lag" }, lagRamp(c, Number.isInteger(c.setSize) && c.setSize > 0 ? c.setSize : CHAR_SET_SIZE)) : {},
  c.bareByPair === true ? { bareByPair: true } : {});
}
// characters.start / ramp (fb27): only under learn "lag"; invalid values are ignored like the other fields.
function lagRamp(c, size){
  const o = {};
  if(Number.isInteger(c.start) && c.start > 0) o.start = c.start;
  if(Array.isArray(c.ramp) && c.ramp.length && c.ramp.every((x, i) => Number.isInteger(x) && x >= 1 && x <= size && (!i || x >= c.ramp[i - 1]))) o.ramp = c.ramp.slice();
  return o;
}
// Ramp (fb27). Sets never straddle a level: the ramp walks the learner's global unit count only until
// it is finished (rampSetOf / rampEnd); inside a level, sets are chunks of the level's units in pack
// order, the last one possibly short. A level that starts at or after the ramp end is plain setSize chunks.
function rampSetOf(cfg, taught){
  if(!cfg.ramp) return Math.floor(taught / cfg.setSize);
  let sum = 0;
  for(let k = 0; k < cfg.ramp.length; k++){ sum += cfg.ramp[k]; if(taught < sum) return k; }
  return cfg.ramp.length + Math.floor((taught - sum) / cfg.setSize);
}
const rampEnd = cfg => cfg.ramp.reduce((a, b) => a + b, 0);
// Chunk sizes of one level with `below` units before it and `n` of its own; they sum to n.
function levelChunks(cfg, below, n){
  const sizes = []; let pos = 0, g = below, end = 0;
  for(let k = 0; k < cfg.ramp.length && pos < n; k++){
    end += cfg.ramp[k];
    if(end > g){ const sz = Math.min(end - g, n - pos); sizes.push(sz); pos += sz; g += sz; }
  }
  while(pos < n){ const sz = Math.min(cfg.setSize, n - pos); sizes.push(sz); pos += sz; }
  return sizes;
}
// Per level (pack order) { lv, below, n, sizes }, plus the number of sets before each.
function rampPlan(cfg, pack, units){
  const idx = levelIndexMap(pack), by = new Map();
  (units || []).forEach(u => by.set(String(u.lv), (by.get(String(u.lv)) || 0) + 1));
  const lvs = [...by.keys()].sort((x, y) => (idx[x] !== undefined ? idx[x] : Infinity) - (idx[y] !== undefined ? idx[y] : Infinity));
  let below = 0, sets = 0;
  const plan = lvs.map(lv => { const n = by.get(lv), sizes = levelChunks(cfg, below, n), o = { lv, below, n, sizes, setsBefore: sets }; below += n; sets += sizes.length; return o; });
  return { plan, total: sets };
}
// Set containing local position `taught` of a level: { k, size } (size capped by what is left), or null when the level is done.
function chunkAt(sizes, taught){
  let c = 0;
  for(let k = 0; k < sizes.length; k++){ c += sizes[k]; if(taught < c) return { k, size: sizes[k] }; }
  return null;
}
// Default mix is the predecessor app's.
const CHAR_TEST_KINDS = { charRead:40, charSound:30, charPick:30 };
function testKinds(tk, kinds, def){
  const out = {};
  if(isObj(tk)) for(const k of (kinds || CHAR_KINDS)) if(typeof tk[k] === "number" && isFinite(tk[k]) && tk[k] > 0) out[k] = tk[k];
  return Object.keys(out).length ? out : Object.assign({}, def || CHAR_TEST_KINDS);
}
function pickWeighted(weights, rng){
  const ks = Object.keys(weights); const total = ks.reduce((a, k) => a + weights[k], 0);
  let x = (rng || Math.random)() * total;
  for(const k of ks){ x -= weights[k]; if(x < 0) return k; }
  return ks[ks.length - 1];
}

function defaultCharsProg(){ return { v:CHARS_PROG_VERSION, c:{}, defer:false, choiceSeen:false, mix:true }; }
// chars.v is its own version: any positive integer is kept, so a newer chars shape never
// invalidates (and so resets) the whole progress record.
function validateCharsShape(ch){
  if(!isObj(ch)) return "chars must be an object";
  if(ch.v !== undefined && !(Number.isInteger(ch.v) && ch.v >= 1)) return "chars.v must be a positive integer";
  if(ch.c !== undefined){ const e = validateRecMap(ch.c, "chars.c", false); if(e) return e; }
  for(const f of ["defer","choiceSeen","mix"]) if(ch[f] !== undefined && typeof ch[f] !== "boolean") return `chars.${f} must be a boolean`;
  return null;
}
function normalizeCharsProg(ch){
  const out = Object.assign(defaultCharsProg(), isObj(ch) ? ch : {});
  if(!isObj(out.c)) out.c = {};
  return out;
}
function ensureChars(prog){
  if(!isObj(prog.chars)) prog.chars = defaultCharsProg();
  if(!isObj(prog.chars.c)) prog.chars.c = {};
  return prog.chars;
}
function charRecs(prog){ return (prog && isObj(prog.chars) && isObj(prog.chars.c)) ? prog.chars.c : {}; }
const hasCharRec = (recs, id) => hasOwn(recs, id) && !!recs[id];
// characters.bareBy "typed" (docs/PACK_SCHEMA.md "bareBy"; owner feedback 2026-10-02: writing
// should score more than selection). From mastered, a miss steps the streak down by one (never below mastered,
// not to 0), so its characters stay shown; a held unit (typedUnitWords) gains no streak from a right choice
// answer: only typed answers (markUnitTyped) take it to bare.
function markChar(prog, unitId, ok, pack, held){
  const recs = ensureChars(prog).c, p = recs[unitId], m = typedBareOn(pack) ? charsConfig(pack).mastered : Infinity;
  if(!isObj(p) || (p.s || 0) < m) return settleUnitProv(markRec(recs, unitId, ok, false), ok, pack);
  if(ok){ p.r++; if(!held) p.s++; } else { p.w++; p.s = Math.max(m, p.s - 1); }
  return settleUnitProv(p, ok, pack);
}
// A placed unit (placeCharUnits) stays provisional until mastered or missed, as markRec does for a word.
function settleUnitProv(p, ok, pack){
  if(p.prov && (p.s >= (charsConfig(pack) || {}).mastered || !ok)) delete p.prov;
  return p;
}
function typedBareOn(pack){ const c = charsConfig(pack); return !!(c && c.bareBy === "typed"); }
const TYPED_WRITTEN_KINDS = ["written", "writtenMeaning", "writtenPron"];
// Units whose word can be typed from the written side (some written-side kind of typedKinds passes
// typedKindOk once the word is shown written), as unit id -> word. A unit outside it (a word no
// written-side kind fits: shared spelling, no gloss) keeps choice crediting all the way to bare.
function typedUnitWords(units, words, pack, amb){
  const out = new Map(); if(!typedBareOn(pack)) return out;
  const ks = typedKinds(pack).filter(k => TYPED_WRITTEN_KINDS.includes(k)); if(!ks.length) return out;
  const a = amb || typedAmbiguity(words), byId = new Map((words || []).map(w => [w.id, w]));
  (units || []).forEach(u => { const w = byId.get((u.words || [])[0]); if(w && ks.some(k => typedKindOk(k, w, true, a))) out.set(u.id, w); });
  return out;
}
// A typed written-side answer (written, writtenMeaning, writtenPron) on a word is an answer for
// its unit (words[0]); only a unit already recorded (taught) moves. Returns the unit, or null.
function markUnitTyped(prog, units, pack, wordId, ok){
  if(!typedBareOn(pack)) return null;
  const u = unitByWord(units).get(wordId);
  if(!u || !hasCharRec(charRecs(prog), u.id)) return null;
  markChar(prog, u.id, ok, pack, false);
  return u;
}
// characters.bareWords: a word whose unit is at the bare tier is asked without its reading
// beside it (drill stimuli and options); reveals, rows and popovers keep it.
function bareWord(word, units, prog, pack){
  const c = charsConfig(pack); if(!c || !c.bareWords || !word) return false;
  const u = unitByWord(units).get(word.id); const recs = charRecs(prog);
  return !!u && hasCharRec(recs, u.id) && (charTier(recs[u.id].s, pack) === "bare" || pairBare(recs[u.id], u, prog, pack));
}
// characters.bareByPair (docs/PACK_SCHEMA.md "bareByPair"; owner 2026-10-07: readings stayed on words
// the learner could already read; then "sound too"): a unit at the ruby tier shows bare once BOTH its
// written <-> meaning pair (wm) AND its written <-> sound pair (ws) have BARE_PAIR right answers in a row.
// Each pair is judged by the most recent answered entry among the unit's own and its word's records; a miss
// on any of the four streams resets it and the reading returns. Only an answered pair counts (no boot from
// the legacy streak, which would make every mastered unit bare at once). Display only: unitDone, goals and
// the typed credit keep rec.s.
const BARE_PAIR = 2;
function bareByPairOn(pack){ const c = charsConfig(pack); return !!(c && c.bareByPair); }
function pairBare(rec, unit, prog, pack){
  if(!bareByPairOn(pack) || !isObj(rec) || charTier(rec.s || 0, pack) !== "ruby") return false;
  return (pairJudge(rec, unit, prog, "wm") || { s: 0 }).s >= BARE_PAIR && (pairJudge(rec, unit, prog, "ws") || { s: 0 }).s >= BARE_PAIR;
}
// A unit pair's judged state: the unit's and the word's records are separate streams per pair; the most
// recent answer decides (higher session ordinal [1]; in the same session the lower streak), so a miss on
// either brings the reading back. null: the pair was never answered. { s: streak, a: ordinal }.
function pairJudge(rec, unit, prog, pair){
  const wid = unit && (unit.words || [])[0], w = wid != null && prog && isObj(prog.w) ? prog.w[wid] : null;
  const en = r => isObj(r) && isObj(r.p) ? pairEntry(r.p[pair]) : null;
  const es = [en(rec), en(w)].filter(Boolean);
  if(!es.length) return null;
  const last = Math.max(...es.map(e => e[1]));
  return { s: Math.min(...es.filter(e => e[1] === last).map(e => e[0])), a: last };
}
function answerCharChoice(prog, start){
  const ch = ensureChars(prog); ch.choiceSeen = true; if(!start) ch.defer = true; return prog;
}
// Flips the flag only: the path is re-derived from it, no record or set state is touched.
function setCharOrder(prog, defer){ ensureChars(prog).defer = !!defer; return prog; }
// characters.withWords order (docs/PACK_SCHEMA.md "withWords"; owner 2026-10-02: the next word
// level came before the pending character stage was finished). chars.order "first" | "with"; chars.defer true ("later") wins.
// Fixed when progress loads: a learner with character records from before (the old single
// stage, taught every session) keeps characters first, so nothing changes silently.
const CHAR_ORDERS = ["first", "with"];
function seedCharOrder(ch, pack){
  const c = charsConfig(pack); if(!c || !c.withWords || CHAR_ORDERS.includes(ch.order)) return ch;
  ch.order = Object.keys(isObj(ch.c) ? ch.c : {}).length ? "first" : "with"; return ch;
}
function charOrder(pack, prog){
  const ch = prog && isObj(prog.chars) ? prog.chars : {};
  return ch.defer === true ? "later" : ch.order === "first" ? "first" : "with";
}
// Re-derives the path from the flags only, like setCharOrder.
function setCharMode(prog, mode){ const ch = ensureChars(prog); ch.defer = mode === "later"; if(CHAR_ORDERS.includes(mode)) ch.order = mode; return prog; }

function unitWord(unit, byId){ return (byId || {})[((unit && unit.words) || [])[0]] || null; }
function unitReading(unit, byId){
  if(unit && unit.reading != null && unit.reading !== "") return String(unit.reading);
  const w = unitWord(unit, byId); return w && w.pron ? String(w.pron) : "";
}
function unitGloss(unit, byId){ return gloss(unitWord(unit, byId)); }
// characters.json `hint` is aligned with the code points of `t`; a character repeated in
// `t` with the same hint (妈妈) or without a hint is listed once or not at all (docs/PACK_SCHEMA.md).
// The dedupe key is character + hint text (hintKey), so one character in two senses lists twice.
function hintKey(x){ return x.c + "\u0001" + x.hint; }
function unitHints(unit){
  const h = unit && unit.hint;
  if(!Array.isArray(h)) return [];
  const out = [], seen = new Set();
  [...String(unit.t || "")].forEach((c, i) => { const x = h[i]; if(typeof x === "string" && x && !seen.has(hintKey({ c, hint: x }))){ seen.add(hintKey({ c, hint: x })); out.push({ c, hint: x }); } });
  return out;
}
const UNIT_BY_WORD = new WeakMap();
function unitByWord(units){
  if(!Array.isArray(units)) return new Map();
  let m = UNIT_BY_WORD.get(units);
  if(!m){ m = new Map(); units.forEach(u => { const w = (u.words || [])[0]; if(w != null && !m.has(w)) m.set(w, u); }); UNIT_BY_WORD.set(units, m); }
  return m;
}
function recordedUnits(units, prog, pack){
  if(!charsConfig(pack) || !Array.isArray(units) || !units.length) return [];
  const recs = charRecs(prog);
  return units.filter(u => hasCharRec(recs, u.id));
}

function charStageUnits(levels, units, pack){
  const want = new Set((levels || []).map(String)); const idx = levelIndexMap(pack);
  const at = lv => idx[lv] !== undefined ? idx[lv] : Infinity;
  return (units || []).map((u, i) => ({u, i})).filter(x => want.has(String(x.u.lv)))
    .sort((a, b) => (at(String(a.u.lv)) - at(String(b.u.lv))) || (a.i - b.i)).map(x => x.u);
}
function charSets(levels, units, pack){
  const cfg = charsConfig(pack); const size = cfg ? cfg.setSize : CHAR_SET_SIZE;
  const list = charStageUnits(levels, units, pack); const out = [];
  for(let i=0; i<list.length; i+=size) out.push(list.slice(i, i+size));
  return out;
}
// No separate set counter: a set is taught once every unit in it has a record.
function charSetTaught(set, prog){ const r = charRecs(prog); return (set || []).every(u => hasCharRec(r, u.id)); }
function nextCharSet(levels, units, pack, prog){
  const sets = charSets(levels, units, pack);
  // A set straddling an old stage boundary may hold recorded units: never teach those again.
  const r = charRecs(prog);
  for(let i=0; i<sets.length; i++) if(!charSetTaught(sets[i], prog)) return { index:i, units:sets[i].filter(u => !hasCharRec(r, u.id)), total:sets.length };
  return null;
}
function charStages(pack, prog){
  const cfg = charsConfig(pack); if(!cfg || !cfg.stages.length || cfg.learn === "lag") return [];
  const ids = levelIds(pack), idx = levelIndexMap(pack);
  if(!ids.length) return [];
  const pos = a => idx[a] !== undefined ? idx[a] : ids.length - 1;
  if(prog && isObj(prog.chars) && prog.chars.defer === true){
    const lv = new Set(); cfg.stages.forEach(st => st.levels.forEach(l => lv.add(l)));
    const levels = [...ids.filter(l => lv.has(l)), ...[...lv].filter(l => idx[l] === undefined)];
    return [{ after: ids[Math.max(...cfg.stages.map(st => pos(st.after)))], levels, label: cfg.label }];
  }
  return cfg.stages.map((st, i) => ({ after: ids[pos(st.after)], levels: st.levels,
    label: st.label || (i === 0 ? cfg.label : cfg.label + (st.levels.length ? st.levels[st.levels.length-1] : "")) }));
}
// Without pack.characters this is exactly the level strip: one word stage per level.
function stagePath(pack, words, units, prog, sunits){
  const p = prog || {}; const sets = p.sets || {};
  const size = setSizeOf(pack), byLv = wordsByLevel(words, pack), recs = charRecs(p);
  const cfg = charsConfig(pack); const cs = charStages(pack, p);
  const out = [], ids = levelIds(pack), gate = levelGateHold(words, pack, p, units);
  ids.forEach(lv => {
    const n = nSets(byLv[lv], size), k = sets[lv] || 0, nn = levelNewSet(words, pack, p, lv);
    out.push(Object.assign({ kind:"words", lv, label: levelLabel(pack, lv), set: nn ? nn.set : k, nsets: n, frac: nn ? Math.min(k, n-1)/n : 1, done: !nn }, gate && nn && ids.indexOf(lv) >= ids.indexOf(gate.lv) ? { gated: true } : {}));
    cs.filter(st => st.after === lv).forEach(st => {
      const list = charStageUnits(st.levels, units, pack);
      const rec = list.filter(u => hasCharRec(recs, u.id)).length;
      out.push(Object.assign({ kind:"chars", key: st.levels.join("+"), levels: st.levels, label: st.label, after: st.after, recorded: rec,
        nunits: list.length, nsets: Math.ceil(list.length / cfg.setSize), frac: list.length ? rec/list.length : 1, done: rec >= list.length },
        gate && ids.indexOf(lv) >= ids.indexOf(gate.lv) ? { gated: true } : {}));
    });
  });
  const sc = scriptStages(pack, sunits, p);
  return sc.length ? [...sc, ...out] : out;
}
function nextStage(pack, words, units, prog, sunits){
  const path = stagePath(pack, words, units, prog, sunits), first = path.find(s => !s.done && !s.gated) || null;
  if(lagOn(pack) && !(first && first.kind === "script")) return lagStage(pack, words, units, prog, path);
  if(!charsWithWords(pack, prog) || !first || first.kind === "script") return first;
  // characters.withWords (docs/PACK_SCHEMA.md): an unlocked character stage (its level's words
  // learned) and the next word level take turns; oldest stage first. The turn flips when a Learn
  // step completes (chars.turn, learnTurnDone), so a Today closed after Learn still alternates
  // (review 2026-10-02); without it, session parity.
  const w = path.find(s => s.kind === "words" && !s.done && !s.gated), c = pendingCharStage(path);
  if(!w || !c) return c || w || first;
  if(charOrder(pack, prog) === "first") return c;
  const t = prog && isObj(prog.chars) ? prog.chars.turn : undefined;
  return (t === "c" || t === "w" ? t === "c" : (prog && prog.sessions || 0) % 2) ? c : w;
}
// characters.learn "lag" (docs/PACK_SCHEMA.md "learn"; owner 2026-10-02: "if character is lagging
// behind teach character, if not teach words"). Units whose word is learned and that have no
// record, oldest first; a full set of them (or any, once no new words remain) is what Learn
// teaches. Nothing stored decides it, so chars.order / turn / defer / choiceSeen are never read.
const lagOn = pack => { const c = charsConfig(pack); return !!(c && c.learn === "lag"); };
function lagUnits(pack, words, units, prog){ return newCharUnits(units, learnedWords(words, pack, prog || {}), prog, pack, Infinity); }
function lagStage(pack, words, units, prog, path){
  const cfg = charsConfig(pack), el = lagUnits(pack, words, units, prog);
  const w = (path || stagePath(pack, words, units, prog)).find(s => s.kind === "words" && !s.done && !s.gated) || null;
  if(cfg.start && w && learnedWords(words, pack, prog || {}).length < cfg.start) return w;
  const n = cfg.ramp ? lagLevelUnits(pack, el).length : el.length;
  return n >= lagSize(cfg, units, prog, pack, el) || (n && !w) ? lagCharStage(pack) : w;
}
const lagCharStage = pack => ({ kind:"chars", key:"lag", lag:true, levels: levelIds(pack), label: charsConfig(pack).label, done:false });
// Indexed by records taught so far: sets are dynamic, so "set k of n" counts tens of units.
const lagTaught = (units, prog) => { const r = charRecs(prog); return (units || []).filter(u => hasCharRec(r, u.id)).length; };
// Under a ramp the eligible units of the lowest level only (a set never straddles a level).
function lagLevelUnits(pack, el){
  if(!el.length) return el;
  const idx = levelIndexMap(pack), at = u => idx[String(u.lv)] !== undefined ? idx[String(u.lv)] : Infinity;
  const lv = el.reduce((m, u) => at(u) < at(m) ? u : m, el[0]).lv;
  return el.filter(u => String(u.lv) === String(lv));
}
// Where the next ramp set sits: its level, level-local set number, size, and the plan.
function lagRampPos(cfg, pack, units, prog, el){
  const first = lagLevelUnits(pack, el);
  if(!first.length) return null;
  const lv = String(first[0].lv), rp = rampPlan(cfg, pack, units), lp = rp.plan.find(x => x.lv === lv), recs = charRecs(prog);
  const tIn = (units || []).filter(u => String(u.lv) === lv && hasCharRec(recs, u.id)).length;
  const c = chunkAt(lp.sizes, tIn);
  return c ? { lv, lp, rp, k: c.k, size: Math.min(c.size, lp.n - tIn) } : { lv, lp, rp, k: lp.sizes.length - 1, size: 0 };
}
function lagSize(cfg, units, prog, pack, el){
  if(!cfg.ramp) return cfg.setSize;
  const pos = lagRampPos(cfg, pack, units, prog, el);
  return pos ? pos.size : cfg.setSize;
}
function lagCharSet(pack, words, units, prog, ids){
  const cfg = charsConfig(pack), all = units || [], recs = charRecs(prog);
  const el = lagUnits(pack, words, all, prog);
  let list = cfg.ramp ? lagLevelUnits(pack, el).slice(0, lagSize(cfg, all, prog, pack, el)) : el.slice(0, lagSize(cfg, all, prog));
  if(ids){ const by = new Map(all.map(u => [u.id, u])); list = Array.isArray(ids) ? ids.map(id => by.get(id)) : []; if(!list.every(Boolean)) return null; }
  if(!list.length) return null;
  // lv/lvIndex/lvTotal: the same position counted inside the set's lowest level (owner 2026-10-03: "48 of 120" said nothing about where in the characters).
  const idx = levelIndexMap(pack), at = u => idx[String(u.lv)] !== undefined ? idx[String(u.lv)] : Infinity;
  const lv = list.reduce((m, u) => at(u) < at(m) ? u : m, list[0]).lv, inLv = all.filter(u => String(u.lv) === String(lv));
  if(cfg.ramp){
    // Sets never straddle a level; the ramp applies to the global count only while it runs (levelChunks).
    const rp = rampPlan(cfg, pack, all), lp = rp.plan.find(x => x.lv === String(lv)), tIn = inLv.filter(u => hasCharRec(recs, u.id)).length;
    const c = chunkAt(lp.sizes, tIn), k = c ? c.k : lp.sizes.length - 1;
    return { index: lp.setsBefore + k, units: list, total: rp.total, ids: list.map(u => u.id), lv, lvIndex: k, lvTotal: lp.sizes.length };
  }
  return { index: Math.floor(all.filter(u => hasCharRec(recs, u.id)).length / cfg.setSize), units: list, total: Math.ceil(all.length / cfg.setSize), ids: list.map(u => u.id),
    lv, lvIndex: Math.floor(inLv.filter(u => hasCharRec(recs, u.id)).length / cfg.setSize), lvTotal: Math.ceil(inLv.length / cfg.setSize) };
}
// Session resume: a Learn step planned on a lag set teaches the same units (sessionRecord today.cu).
function lagResume(snap, pack, words, units, prog, ids){
  const cset = snap && lagOn(pack) ? lagCharSet(pack, words, units, prog, ids) : null;
  return cset ? Object.assign(snap, { stage: lagCharStage(pack), cset }) : snap;
}
const pendingCharStage = path => path.find(s => s.kind === "chars" && !s.done && path.some(x => x.kind === "words" && x.lv === s.after && x.done)) || null;
// A Learn step taught kind ("words" or "chars"): the next Learn teaches the other one.
function learnTurnDone(prog, pack, kind){
  if(!charsWithWords(pack, prog)) return false;
  ensureChars(prog).turn = kind === "chars" ? "w" : "c"; return true;
}
// "Characters: with words" unless the learner chose "later" (chars.defer: after every word level).
const charsWithWords = (pack, prog) => { const c = charsConfig(pack); return !!(c && c.withWords) && !(prog && isObj(prog.chars) && prog.chars.defer === true); };
// The point the learning-order switch becomes available.
function charsUnlocked(pack, words, prog){
  const cfg = charsConfig(pack); if(!cfg || !cfg.stages.length) return false;
  const path = stagePath(pack, words, [], Object.assign({}, prog, { chars: Object.assign({}, (prog && prog.chars) || {}, { defer:false }) }));
  const first = path.findIndex(s => s.kind === "chars");
  return first > 0 && path.slice(0, first).every(s => s.done);
}
// Gates every character surface outside the path strip.
function charsStarted(pack, words, units, prog, sunits){
  if(!charsConfig(pack)) return false;
  if(Object.keys(charRecs(prog)).length) return true;
  // withWords: started once a stage is pending, whichever kind this session's Learn teaches, so
  // Review keeps one size (review 2026-10-02).
  if(charsWithWords(pack, prog) && pendingCharStage(stagePath(pack, words, units, prog, sunits))) return true;
  const st = nextStage(pack, words, units, prog, sunits);
  return !!(st && st.kind === "chars");
}
// Shown only when deferring would actually put an incomplete later word level first;
// otherwise the choice changes nothing.
function showCharChoice(pack, words, units, prog, sunits){
  const cfg = charsConfig(pack); if(!cfg || !cfg.stages.length || cfg.withWords) return false;
  const ch = (prog && isObj(prog.chars)) ? prog.chars : {};
  if(ch.choiceSeen === true || ch.defer === true) return false;
  const path = stagePath(pack, words, units, prog, sunits);
  const first = path.findIndex(s => s.kind === "chars");
  if(first < 0 || path[first].done || !path.slice(0, first).every(s => s.done)) return false;
  const idx = levelIndexMap(pack), ids = levelIds(pack);
  const last = Math.max(...cfg.stages.map(st => idx[st.after] !== undefined ? idx[st.after] : ids.length - 1));
  return path.slice(first + 1).some(s => s.kind === "words" && idx[s.lv] <= last && !s.done);
}

function charTier(streak, pack){
  const cfg = charsConfig(pack); const s = +streak || 0;
  if(s >= (cfg ? cfg.bare : CHAR_BARE)) return "bare";
  if(s >= (cfg ? cfg.mastered : CHAR_MASTERED)) return "ruby";
  return "pron";
}
// Word-first packs show the written form from day one, so "pron" only exists for pronFirst.
function sentenceTokenTier(streak, started, mix, pack){
  if(!started || !mix) return null;
  const t = charTier(streak, pack);
  return t === "pron" && !(pack && pack.pronFirst === true) ? "ruby" : t;
}
// pronFirst: tokens are "pron" before characters start or with mix off, as in the
// predecessor app's reading-only sentences.
function rubyTiers(sentence, units, prog, pack, started){
  const mix = !!(prog && isObj(prog.chars) && prog.chars.mix !== false);
  const pf = pronFirstOn(pack);
  if(!charsConfig(pack) || !sentence || !Array.isArray(sentence.ruby)) return null;
  if(!pf && (!started || !mix)) return null;
  const byWord = unitByWord(units), recs = charRecs(prog);
  return sentence.ruby.map(([start, end, reading, wordId]) => {
    const u = byWord.get(wordId) || null; const rec = u && hasCharRec(recs, u.id) ? recs[u.id] : null;
    const tier = pf && !(started && mix) ? "pron" : rec && pairBare(rec, u, prog, pack) ? "bare" : sentenceTokenTier(rec ? rec.s : 0, true, true, pack);
    return { start, end, reading, wordId, unitId: u ? u.id : null, tier };
  });
}

// pronFirst (docs/PACK_SCHEMA.md "pronFirst"): a word below the mastered tier is shown by its
// reading outside the characters stage, which is where the written form is learned.
function pronFirstOn(pack){ return !!(pack && pack.pronFirst === true && charsConfig(pack)); }
function displayForm(word, units, prog, pack){
  const written = String((word && word.w) || "");
  const out = { text: written, isPron: false, written };
  if(!word || !pronFirstOn(pack) || !word.pron) return out;
  const u = unitByWord(units).get(word.id);
  if(!u) return out;
  const recs = charRecs(prog); const rec = hasCharRec(recs, u.id) ? recs[u.id] : null;
  if(charTier(rec ? rec.s : 0, pack) !== "pron") return out;
  return { text: String(word.pron), isPron: true, written };
}
const sayKey = e => normKey((e && (e.pron || e.w)) || "");
// Two words shown by their reading are indistinguishable when they sound the same.
function pronClash(a, b){ return !!(a && b) && sayKey(a) !== "" && sayKey(a) === sayKey(b); }

const LATIN_RE = /\p{Script=Latin}/u;
const HAN_RE = /\p{Script=Han}/u;
const ASCII_PUNCT = { "\uff0c":", ", "\u3001":", ", "\u3002":". ", "\uff01":"! ", "\uff1f":"? ", "\uff1a":": ", "\uff1b":"; ", "\uff08":" (", "\uff09":") ",
  "\u201c":" \u201c", "\u201d":"\u201d ", "\u2018":" \u2018", "\u2019":"\u2019 ", "\u300a":" \u201c", "\u300b":"\u201d ", "\u2026":"\u2026 ", "\u2014":" \u2014 " };
// A Latin-script reading needs spacing and ASCII punctuation around it; a reading in a
// script written without spaces needs neither.
function sentencePieces(sentence, toks, blank, cuts){
  const t = String((sentence && sentence.t) || "");
  const valid = []; let pos = 0;
  (toks || []).forEach(k => { if(k && k.start >= pos && k.end > k.start && k.end <= t.length){ valid.push(k); pos = k.end; } });
  let b = null;
  if(blank && blank.end > blank.start){
    b = { start: blank.start, end: blank.end };
    valid.forEach(k => { if(k.start < b.end && k.end > b.start){ b.start = Math.min(b.start, k.start); b.end = Math.max(b.end, k.end); } });
  }
  const cutSet = [...new Set(cuts || [])].sort((x, y) => x - y);
  const out = [];
  const text = (a, z) => {
    if(z <= a) return;
    const cs = [a, ...cutSet.filter(c => c > a && c < z), z];
    for(let i = 0; i < cs.length - 1; i++) out.push({ kind:"text", start: cs[i], end: cs[i+1], text: t.slice(cs[i], cs[i+1]), pre:"" });
  };
  const putBlank = () => { out.push({ kind:"blank", start: b.start, end: b.end, text:"____", pre:"" }); };
  pos = 0; let blankDone = !b;
  valid.forEach(k => {
    if(b && k.start < b.end && k.end > b.start) return;
    if(!blankDone && b.end <= k.start){ text(pos, b.start); putBlank(); pos = b.end; blankDone = true; }
    text(pos, k.start);
    const pr = k.tier === "pron";
    const piece = { kind:"tok", start: k.start, end: k.end, text: pr ? String(k.reading == null ? "" : k.reading) : t.slice(k.start, k.end), pre:"", tier: k.tier, reading: k.reading };
    if(k.wordId !== undefined) piece.wordId = k.wordId;
    if(k.unitId !== undefined) piece.unitId = k.unitId;
    out.push(piece); pos = k.end;
  });
  if(!blankDone){ text(pos, b.start); putBlank(); pos = b.end; }
  text(pos, t.length);
  const shown = p => (p.kind === "tok" && p.tier === "pron") || p.kind === "blank";
  if(!out.some(p => p.kind === "tok" && p.tier === "pron" && LATIN_RE.test(p.text))) return out;
  const edgeL = p => p.kind !== "text" || /^[\p{L}\p{N}]/u.test(p.text);
  const edgeR = p => p.kind !== "text" || /[\p{L}\p{N}]$/u.test(p.text);
  out.forEach(p => { if(p.kind === "text") p.text = p.text.replace(/[\uff0c\u3001\u3002\uff01\uff1f\uff1a\uff1b\uff08\uff09\u201c\u201d\u2018\u2019\u300a\u300b\u2026\u2014]/g, c => ASCII_PUNCT[c]).replace(/\s+(?=[\u201d\u2019)\u2026,.!?:;])/g, ""); });
  let atStart = true;
  out.forEach(p => {
    if(p.kind === "tok" && p.tier === "pron"){ if(atStart) p.text = p.text.charAt(0).toUpperCase() + p.text.slice(1); atStart = false; }
    else if(p.kind !== "text") atStart = false;
    else if(/[.!?][\s"'\u201d\u2019)]*$/.test(p.text) || /:\s*["'\u201c\u2018(]+\s*$/.test(p.text)) atStart = true;
    else if(!/^[\s"'\u201c\u2018(]*$/.test(p.text)) atStart = false;
  });
  out.forEach((p, i) => { const prev = out[i-1]; if(prev && (shown(p) || shown(prev)) && edgeL(p) && edgeR(prev)) p.pre = " "; });
  let last = "";
  out.forEach((p, i) => {
    if(/\s$/.test(last)){ p.pre = ""; p.text = p.text.replace(/^\s+/, ""); }
    if(i === 0){ p.pre = ""; p.text = p.text.replace(/^\s+/, ""); }
    p.text = p.text.replace(/\s{2,}/g, " ");
    last = p.pre + p.text || last;
  });
  for(let i = out.length - 1; i >= 0; i--){ const p = out[i]; if(p.kind === "text"){ p.text = p.text.replace(/\s+$/, ""); if(p.text) break; } else break; }
  return out;
}
// Kana, Latin letters, digits and punctuation are readable as written: only Han needs ruby.
function rubyCovers(t, toks){
  const cov = new Array(t.length).fill(false);
  (toks || []).forEach(k => { for(let i = Math.max(0, k.start); i < Math.min(t.length, k.end); i++) cov[i] = true; });
  for(let i = 0; i < t.length; i++){ if(!cov[i]){ const cp = t.codePointAt(i); if(HAN_RE.test(String.fromCodePoint(cp))) return false; if(cp > 0xFFFF) i++; } }
  return true;
}
// Fully covered sentences come first: they can show the unit written with its reading.
function unitExampleSentences(unit, word, sentences, pack, n){
  if(!word) return [];
  const all = exampleSentences(word, sentences, pack, Infinity);
  if(!charsConfig(pack)) return all.slice(0, n);
  const own = new Set((unit && unit.words) || []);
  const tiers = [[], [], []];
  all.forEach(s => {
    const r = Array.isArray(s.ruby) ? s.ruby.filter(Array.isArray) : [];
    const tk = r.map(k => ({ start: k[0], end: k[1] }));
    tiers[!r.some(k => own.has(k[3])) ? 2 : rubyCovers(String(s.t || ""), tk) ? 0 : 1].push(s);
  });
  return [...tiers[0], ...tiers[1], ...tiers[2]].slice(0, n);
}
// "pron" (the reading line) is never used for a blank: that sentence cannot be a gap item.
function sentenceDisplay(sentence, units, prog, pack, started, blank, written){
  if(!pronFirstOn(pack) || !sentence) return null;
  const t = String(sentence.t || "");
  const ws = new Set(written || []);
  const rt = rubyTiers(sentence, units, prog, pack, started);
  const toks = rt && rt.map(k => k.tier === "pron" && ws.has(k.wordId) ? Object.assign({}, k, { tier:"ruby" }) : k);
  if(toks && rubyCovers(t, toks)) return { mode:"pieces", pieces: sentencePieces(sentence, toks, blank) };
  if(!HAN_RE.test(t)) return { mode:"text" };
  if(blank) return null;
  return sentence.pron ? { mode:"pron", text: String(sentence.pron) } : { mode:"text" };
}

// Never a second right answer: a homophone fits the pick stimulus, a same gloss fits the
// recall stimulus.
function charOpts(unit, units, byId, mix){
  const aw = unitWord(unit, byId);
  const ansG = normKey(unitGloss(unit, byId)), ansF2 = firstTwoWords(unitGloss(unit, byId)), ansR = normKey(unitReading(unit, byId));
  const ansForms = new Set([normKey(unit.t), ...(aw ? surfaces(aw) : [])]);
  const len = cpLen(unit.t);
  const cands = (units || []).filter(v => {
    if(v.id === unit.id || ansForms.has(normKey(v.t))) return false;
    const g = unitGloss(v, byId), vw = unitWord(v, byId);
    if(normKey(g) === ansG || (ansF2 && firstTwoWords(g) === ansF2)) return false;
    if(ansR && normKey(unitReading(v, byId)) === ansR) return false;
    return !(aw && vw && (samePron(aw, vw) || isSyn(aw, vw)));
  });
  if(mix) return mixPick(unit, cands, mix, () => 0, v => cpLen(v.t) === len ? 0 : 1, strict => {
    const usedT = new Set(ansForms), usedG = new Set([ansG]), usedF2 = new Set();
    return v => { const t = normKey(v.t), g = unitGloss(v, byId), gk = normKey(g), f2 = firstTwoWords(g);
      if(usedT.has(t) || usedG.has(gk) || (strict && f2 && usedF2.has(f2))) return false;
      usedT.add(t); usedG.add(gk); if(f2) usedF2.add(f2); return true; };
  }, undefined, true);
  const t1 = cands.filter(v => v.lv === unit.lv && cpLen(v.t) === len);
  const t2 = cands.filter(v => v.lv === unit.lv && cpLen(v.t) !== len);
  const t3 = cands.filter(v => v.lv !== unit.lv);
  const ordered = [...shuffle(t1), ...shuffle(t2), ...shuffle(t3)];
  function pass(strict){
    const chosen = []; const usedT = new Set(ansForms), usedG = new Set([ansG]), usedF2 = new Set();
    for(const v of ordered){
      if(chosen.length >= 3) break;
      const t = normKey(v.t), g = unitGloss(v, byId), gk = normKey(g), f2 = firstTwoWords(g);
      if(usedT.has(t) || usedG.has(gk)) continue;
      if(strict && f2 && usedF2.has(f2)) continue;
      chosen.push(v); usedT.add(t); usedG.add(gk); if(f2) usedF2.add(f2);
    }
    return chosen;
  }
  let chosen = pass(true);
  if(chosen.length < 3) chosen = pass(false);
  return chosen;
}
function recallCharOpts(unit, units, byId, mix){ return [unit.t, ...charOpts(unit, units, byId, mix).map(v => v.t)]; }
// Never a homophone, nor a reading the answer's form also has (a homograph unit or word).
const UNIT_SYL = new WeakMap(); // unit -> syllable count of its reading
function charSoundOpts(unit, units, byId, mix){
  const ansT = normKey(unit.t), ansR = normKey(unitReading(unit, byId));
  const forbid = new Set([ansR]);
  (units || []).forEach(v => { if(normKey(v.t) === ansT){ const r = normKey(unitReading(v, byId)); if(r) forbid.add(r); } });
  Object.keys(byId || {}).forEach(k => { const w = byId[k]; if(w && w.pron && surfaces(w).includes(ansT)) forbid.add(normKey(w.pron)); });
  const len = cpLen(unit.t);
  const cands = (units || []).filter(v => v.id !== unit.id && normKey(v.t) !== ansT && unitReading(v, byId) && !forbid.has(normKey(unitReading(v, byId))));
  const sameLen = v => cpLen(v.t) === len, sameLv = v => v.lv === unit.lv;
  // optsMix: the shown reading's syllable count (一会儿 yīhuìr is 2), not the characters, is what the learner can see.
  const syl = v => { let k = UNIT_SYL.get(v); if(k === undefined) UNIT_SYL.set(v, k = splitReading(unitReading(v, byId)).filter(x => x.tone !== undefined).length || 1); return k; }, ansSyl = syl(unit);
  if(mix) return mixPick(unit, cands, mix, () => 0, v => syl(v) === ansSyl ? 0 : 1, () => {
    const used = new Set(forbid);
    return v => { const k = normKey(unitReading(v, byId)); if(used.has(k)) return false; used.add(k); return true; };
  }, undefined, true).map(v => unitReading(v, byId));
  const ordered = [...shuffle(cands.filter(v => sameLv(v) && sameLen(v))), ...shuffle(cands.filter(v => !sameLv(v) && sameLen(v))),
    ...shuffle(cands.filter(v => sameLv(v) && !sameLen(v))), ...shuffle(cands.filter(v => !sameLv(v) && !sameLen(v)))];
  const out = []; const used = new Set(forbid);
  for(const v of ordered){
    if(out.length >= 3) break;
    const r = unitReading(v, byId), k = normKey(r);
    if(used.has(k)) continue;
    used.add(k); out.push(r);
  }
  return out;
}
// Every word the form could also be read as is removed from the pool.
function charReadOpts(unit, words, byId, mix){
  const w = unitWord(unit, byId); if(!w) return [];
  const t = normKey(unit.t);
  return meaningOpts(w, (words || []).filter(v => v.id === w.id || !surfaces(v).includes(t)), mix);
}
function charItem(kind, unit, ctx){
  const c = ctx || {}; const byId = c.byId || Object.fromEntries((c.words || []).map(w => [w.id, w]));
  const w = unitWord(unit, byId), t = String(unit.t), reading = unitReading(unit, byId), g = unitGloss(unit, byId);
  const base = { kind, key: "c:" + unit.id, unitId: unit.id, wordId: w ? w.id : null, t, reading, gloss: g };
  let show, audio = false, answer, others;
  // ctx.mix { word(w), unit(u), wordBucket?, unitBucket?, rng? } (option mix): word options by word stage, unit options by unit stage.
  const wm = c.mix ? { stage: c.mix.word, bucket: c.mix.wordBucket, rng: c.mix.rng, rot: c.mix.rot } : undefined, um = c.mix ? { stage: c.mix.unit, bucket: c.mix.unitBucket, rng: c.mix.rng, rot: c.mix.rot } : undefined;
  if(kind === "charRead"){ show = "t"; answer = g; others = charReadOpts(unit, c.words, byId, wm).map(gloss); }
  else if(kind === "charSound"){ show = "t"; answer = reading; others = charSoundOpts(unit, c.units, byId, um); }
  else if(kind === "charPick"){ show = "reading"; audio = true; answer = t; others = charOpts(unit, c.units, byId, um).map(v => String(v.t)); }
  else if(kind === "charRecall"){ show = "gloss"; answer = t; others = charOpts(unit, c.units, byId, um).map(v => String(v.t)); }
  else throw new Error(`unknown character item kind ${kind}`);
  return Object.assign(base, { show, audio, answer, options: shuffle([answer, ...others], c.rng) });
}

function learnCharPlan(set, pack){
  const cfg = charsConfig(pack); if(!cfg) return [];
  const out = []; (set || []).forEach(unit => cfg.learnKinds.forEach(kind => out.push({ kind, unit })));
  return out;
}
// An unmastered unit scores at least 0, tying with never-drilled words, so fresh units
// aren't starved by a large pool of unrecorded words.
function charReviewScore(rec, pack){
  const cfg = charsConfig(pack); const p = rec || {}; const sc = weakScore(p);
  return (p.s || 0) < (cfg ? cfg.mastered : CHAR_MASTERED) ? Math.max(sc, 0) : sc;
}
// Jitter stays below 1, so it only reorders equal scores.
function rankUnified(words, wrecs, units, crecs, n, pack, rng, sunits, srecs){
  const r = rng || Math.random;
  const pool = [...(words || []).map(e => ({ kind:"w", entry:e, score: weakScore((wrecs || {})[e.id]) })),
    ...(units || []).map(u => ({ kind:"c", entry:u, score: charReviewScore((crecs || {})[u.id], pack) })),
    ...(sunits || []).map(u => ({ kind:"x", entry:u, score: scriptReviewScore((srecs || {})[u.id], pack) }))];
  return pool.map(x => ({ x, k: x.score + (r() - 0.5) })).sort((a, b) => b.k - a.k).slice(0, n).map(o => o.x);
}
function unifiedReviewPlan(learned, ru, prog, pack, n, rng, rs, sctx, opts){
  const cfg = charsConfig(pack), scfg = scriptConfig(pack); const r = rng || Math.random;
  const pv = provPick(learned, Math.min(REVIEW_PROV, n), prog.w);
  const pvSet = new Set(pv.map(w => w.id));
  // Placed units (placementCharsOn) are kept in review like placed words; with none, no slot is taken and no rng drawn.
  const pu = ru.some(u => (charRecs(prog)[u.id] || {}).prov) ? provPick(ru, Math.min(REVIEW_PROV, n - pv.length), charRecs(prog)) : [];
  const puSet = new Set(pu.map(u => u.id));
  const ranked = rankUnified(learned.filter(x => !pvSet.has(x.id)), prog.w, pu.length ? ru.filter(u => !puSet.has(u.id)) : ru, charRecs(prog), n - pv.length - pu.length, pack, rng, rs, scriptRecs(prog));
  const pool = shuffle([...ranked, ...pv.map(w => ({ kind:"w", entry:w })), ...pu.map(u => ({ kind:"c", entry:u }))], rng);
  const kinds = kindMix(pool.filter(x => x.kind === "w").length, REVIEW_PRODUCTION_SHARE, typingEnabled(pack), rng);
  let wi = 0;
  const out = pool.map(x => x.kind === "w" ? { kind: kinds[wi++], word: x.entry }
    : x.kind === "c" ? { kind: cfg.reviewKinds[Math.floor(r() * cfg.reviewKinds.length)], unit: x.entry }
    : { kind: pickScriptKind(scfg.reviewKinds, x.entry, scfg, r, sctx), unit: x.entry });
  return applyMissedKinds(out.filter(it => it.kind), prog, pack, false, opts);
}
function unifiedRecallPlan(learned, ru, prog, pack, n, rng, opts){
  const ranked = rankUnified(learned, prog.w, ru, charRecs(prog), n, pack, rng);
  const kinds = kindMix(ranked.filter(x => x.kind === "w").length, 1, typingEnabled(pack), rng);
  let wi = 0;
  return applyMissedKinds(ranked.map(x => x.kind === "w" ? { kind: kinds[wi++], word: x.entry } : { kind:"charRecall", unit: x.entry }), prog, pack, true, opts);
}
// Taken at "Start today" and kept for the whole session, so finishing a stage mid-session
// changes neither what Learn teaches nor Review/Recall's mode.
function todaySnapshot(pack, words, units, prog, sunits){
  const stage = nextStage(pack, words, units, prog, sunits);
  const cset = stage && stage.kind === "chars" ? (stage.lag ? lagCharSet(pack, words, units, prog) : nextCharSet(stage.levels, units, pack, prog)) : null;
  const started = charsStarted(pack, words, units, prog, sunits);
  const snap = { stage, cset, charsStarted: started, reviewSize: started ? REVIEW_SIZE_CHARS : REVIEW_SIZE, choice: showCharChoice(pack, words, units, prog, sunits) };
  const scfg = scriptActive(pack, sunits) ? scriptConfig(pack) : null; // no units: the flag-off snapshot
  if(scfg){
    const onScript = !!(stage && stage.kind === "script");
    snap.ssets = onScript ? nextScriptSets(stage.key, sunits, pack, prog, scfg.setsPerSession) : [];
    if(onScript) snap.reviewSize = REVIEW_SIZE_SCRIPT;
    if(showScriptChoice(pack, sunits, prog)) snap.choice = "script";
  }
  return snap;
}
function newCharUnits(units, learned, prog, pack, n){
  const ids = new Set((learned || []).map(w => w.id)); const recs = charRecs(prog);
  const ok = new Set((units || []).filter(u => ids.has((u.words || [])[0]) && !hasCharRec(recs, u.id)).map(u => u.id));
  return charStageUnits(levelIds(pack), (units || []).filter(u => ok.has(u.id)), pack).slice(0, n);
}
function charTestPlan(units, learned, prog, pack, n, rng, today, o){
  const cfg = charsConfig(pack); if(!cfg) return [];
  // With a day: each unit asked in the kind its weakest pair picks.
  if(today){
    const picked = pairPick(recordedUnits(units, prog, pack).map(pairCharCand(prog, pack, Object.keys(cfg.testKinds))), n, dayLog(prog, today), rng, daySn(prog), pack, o || {});
    return picked.map(e => ({ kind: e.kind, unit: e.c.x, pair: e.pair })).concat(newCharUnits(units, learned, prog, pack, n - picked.length).map(unit => ({ kind: pickWeighted(cfg.testKinds, rng), unit })));
  }
  const rec = weakFirst(recordedUnits(units, prog, pack), n, charRecs(prog), undefined, rng);
  const pool = rec.length >= n ? rec : rec.concat(newCharUnits(units, learned, prog, pack, n - rec.length));
  return pool.map(unit => ({ kind: pickWeighted(cfg.testKinds, rng), unit }));
}

// Script primer (docs/SCRIPT_PRIMER.md, docs/PACK_SCHEMA.md "Script primer"). Taught, done
// and mastered are derived from records, never stored. Without pack.script every function
// here returns its empty value and nothing else changes.
const SCRIPT_PROG_VERSION = 1;
const SCRIPT_MASTERED = 3, SCRIPT_SETS_PER_SESSION = 2, REVIEW_SIZE_SCRIPT = 12;
const SCRIPT_KINDS = ["symSound","soundSym","symType","compose","formFind","formMatch","wordRead","wordHear"];
const SCRIPT_SOUND_KINDS = ["symSound","soundSym","symType"]; // never asked of a sound:false unit
const SCRIPT_TEST_KINDS = { symSound:35, soundSym:25, wordRead:25, symType:15 };
const ZWJ = "‍";
function scriptConfig(pack){
  const c = pack && pack.script;
  if(!isObj(c)) return null;
  const kinds = (k, d) => { const f = Array.isArray(k) ? k.filter(x => SCRIPT_KINDS.includes(x)) : []; return f.length ? [...new Set(f)] : d; };
  const seen = new Set(); const stages = [];
  (Array.isArray(c.stages) ? c.stages : []).forEach(st => {
    if(!isObj(st) || typeof st.key !== "string" || !st.key || seen.has(st.key)) return;
    seen.add(st.key); stages.push({ key: st.key, label: st.label != null && st.label !== "" ? String(st.label) : st.key });
  });
  return {
    stages,
    setsPerSession: Number.isInteger(c.setsPerSession) && c.setsPerSession > 0 ? c.setsPerSession : SCRIPT_SETS_PER_SESSION,
    mastered: typeof c.mastered === "number" && c.mastered > 0 ? c.mastered : SCRIPT_MASTERED,
    tts: c.tts !== false,
    learnKinds: kinds(c.learnKinds, ["symSound","soundSym"]),
    reviewKinds: kinds(c.reviewKinds, ["symSound","soundSym","wordRead"]),
    testKinds: testKinds(c.testKinds, SCRIPT_KINDS, SCRIPT_TEST_KINDS),
  };
}

function defaultScriptProg(){ return { v:SCRIPT_PROG_VERSION, u:{}, skipped:false, skip:{}, choiceSeen:false, notice:false }; }
// script.v is its own version: any positive integer is kept, like chars.v.
function validateScriptShape(sc){
  if(!isObj(sc)) return "script must be an object";
  if(sc.v !== undefined && !(Number.isInteger(sc.v) && sc.v >= 1)) return "script.v must be a positive integer";
  if(sc.u !== undefined){ const e = validateRecMap(sc.u, "script.u", false); if(e) return e; }
  for(const f of ["skipped","choiceSeen","notice"]) if(sc[f] !== undefined && typeof sc[f] !== "boolean") return `script.${f} must be a boolean`;
  if(sc.skip !== undefined){
    if(!isObj(sc.skip)) return "script.skip must be an object";
    for(const k of Object.keys(sc.skip)) if(typeof sc.skip[k] !== "boolean") return `script.skip.${k} must be a boolean`;
  }
  return null;
}
const hasWordRecords = data => isObj(data) && isObj(data.w) && Object.keys(data.w).length > 0;
// Stored progress with a word record and no script field predates the primer: that learner
// is already reading, so the primer starts skipped with a one-time notice instead of sending
// them back before their next word set.
function normalizeScriptProg(sc, data){
  if(isObj(sc)){ const out = Object.assign(defaultScriptProg(), sc); if(!isObj(out.u)) out.u = {}; if(!isObj(out.skip)) out.skip = {}; return out; }
  const out = defaultScriptProg();
  if(hasWordRecords(data)) Object.assign(out, { skipped:true, choiceSeen:true, notice:true });
  return out;
}
function ensureScript(prog){
  if(!isObj(prog.script)) prog.script = defaultScriptProg();
  if(!isObj(prog.script.u)) prog.script.u = {};
  if(!isObj(prog.script.skip)) prog.script.skip = {};
  return prog.script;
}
function scriptRecs(prog){ return (prog && isObj(prog.script) && isObj(prog.script.u)) ? prog.script.u : {}; }
function scriptSkipped(prog, key){
  const sc = prog && isObj(prog.script) ? prog.script : null;
  if(!sc) return false;
  if(sc.skipped === true) return true;
  return key != null && isObj(sc.skip) && sc.skip[key] === true;
}
// Turning the primer or a stage on clears the pending notice (the learner has found the
// switch), so turning it off again does not bring the notice back.
function setScriptSkipped(prog, skipped, key){
  const sc = ensureScript(prog);
  if(key == null) sc.skipped = !!skipped; else sc.skip[String(key)] = !!skipped;
  if(!skipped) sc.notice = false;
  return prog;
}
function answerScriptChoice(prog, learn){ const sc = ensureScript(prog); sc.choiceSeen = true; sc.skipped = !learn; return prog; }
function scriptNotice(pack, prog){ return !!scriptConfig(pack) && !!(prog && isObj(prog.script) && prog.script.notice === true); }
function dismissScriptNotice(prog){ ensureScript(prog).notice = false; return prog; }
function markScript(prog, unitId, ok){ return markRec(ensureScript(prog).u, unitId, ok, false); }
function scriptMastered(rec, pack){ const cfg = scriptConfig(pack); return ((rec && rec.s) || 0) >= (cfg ? cfg.mastered : SCRIPT_MASTERED); }

function scriptStageUnits(key, units){
  return (Array.isArray(units) ? units : []).map((u, i) => ({u, i})).filter(x => isObj(x.u) && x.u.st === key)
    .sort((a, b) => ((+a.u.set || 0) - (+b.u.set || 0)) || (a.i - b.i)).map(x => x.u);
}
function scriptSets(key, units){
  const out = []; let cur = null, last;
  scriptStageUnits(key, units).forEach(u => { if(!cur || u.set !== last){ cur = []; out.push(cur); last = u.set; } cur.push(u); });
  return out;
}
function scriptSetTaught(set, prog){ const r = scriptRecs(prog); return (set || []).every(u => hasCharRec(r, u.id)); }
function nextScriptSets(key, units, pack, prog, n){
  const cfg = scriptConfig(pack); if(!cfg) return [];
  const k = n == null ? cfg.setsPerSession : n;
  const sets = scriptSets(key, units); const out = [];
  for(let i=0; i<sets.length && out.length<k; i++) if(!scriptSetTaught(sets[i], prog)) out.push({ index:i, units:sets[i], total:sets.length });
  return out;
}
// done = every unit recorded, so a missed review never pulls the stage back into the path.
// pack.script without units is the primer off everywhere, exactly the flag-off output.
function scriptActive(pack, units){ return !!scriptConfig(pack) && Array.isArray(units) && units.length > 0; }
// Pronunciation off once the primer is done (fb45; pack.pronUntilPrimer until the flag collapse, now every pack.script pack):
// the primer is done when it was skipped or every unit of every stage still on has a record (the stage `done` rule); a pack
// with no active primer never is.
function pronUntilPrimerOn(pack){ return !!scriptConfig(pack); }
function scriptPrimerDone(pack, units, prog){
  if(!scriptActive(pack, units)) return false;
  if(scriptSkipped(prog)) return true;
  return scriptStages(pack, units, prog).every(st => st.done);
}
// A stored showPron is the learner's own choice and always wins; the default is on, and off once the primer is done.
function showPronOn(pack, units, prog){
  if(pack.showPron === false) return false;
  if(prog && prog.showPron !== undefined) return prog.showPron !== false;
  return !(pronUntilPrimerOn(pack) && scriptPrimerDone(pack, units, prog));
}
function scriptStages(pack, units, prog){
  const cfg = scriptConfig(pack); if(!cfg || !scriptActive(pack, units) || scriptSkipped(prog)) return [];
  const recs = scriptRecs(prog);
  return cfg.stages.filter(st => !scriptSkipped(prog, st.key)).map(st => {
    const list = scriptStageUnits(st.key, units);
    const rec = list.filter(u => hasCharRec(recs, u.id)).length;
    return { kind:"script", key: st.key, label: st.label, recorded: rec, nunits: list.length,
      nsets: scriptSets(st.key, units).length, frac: list.length ? rec/list.length : 1, done: rec >= list.length };
  });
}
function recordedScriptUnits(units, prog, pack){
  const cfg = scriptConfig(pack);
  if(!cfg || scriptSkipped(prog) || !Array.isArray(units) || !units.length) return [];
  const recs = scriptRecs(prog); const keys = new Set(cfg.stages.filter(s => !scriptSkipped(prog, s.key)).map(s => s.key));
  return units.filter(u => isObj(u) && keys.has(u.st) && hasCharRec(recs, u.id));
}
function scriptPool(units, prog, set){
  const recs = scriptRecs(prog); const cur = new Set((set || []).map(u => u.id));
  return (Array.isArray(units) ? units : []).filter(u => isObj(u) && (cur.has(u.id) || hasCharRec(recs, u.id)));
}
// Placement does not answer the choice: it tests words, not the script.
function showScriptChoice(pack, units, prog){
  const cfg = scriptConfig(pack); if(!cfg || !cfg.stages.length || !scriptActive(pack, units)) return false;
  const sc = (prog && isObj(prog.script)) ? prog.script : {};
  if(sc.choiceSeen === true || sc.skipped === true) return false;
  const recs = scriptRecs(prog);
  return !Object.keys(recs).some(id => hasCharRec(recs, id));
}

const hasEx = u => Array.isArray(u.ex) && u.ex.some(e => Array.isArray(e) && e[0] != null);
function scriptKindShape(kind, unit){
  if(!isObj(unit)) return false;
  if(SCRIPT_SOUND_KINDS.includes(kind)) return unit.sound !== false && !!unit.roman;
  if(kind === "compose") return Array.isArray(unit.syll) && unit.syll.some(s => isObj(s) && s.t && Array.isArray(s.parts) && s.parts.length);
  if(kind === "formMatch") return unit.joins === "dual" || unit.joins === "right";
  if(kind === "formFind" || kind === "wordRead" || kind === "wordHear") return hasEx(unit);
  return false;
}
const SCRIPT_MIN_OPTIONS = 4;
// With ctx, an option kind also needs SCRIPT_MIN_OPTIONS distinct options, else it does not
// fit and the pickers move on to another kind.
function scriptKindFits(kind, unit, ctx){
  if(!scriptKindShape(kind, unit)) return false;
  if(!isObj(ctx) || !Array.isArray(ctx.units) || kind === "symType") return true;
  const hasWords = !!(ctx.byId || ctx.words);
  if(!hasWords && (kind === "formFind" || kind === "wordRead" || kind === "wordHear")) return true;
  const it = scriptItem(kind, unit, { units: ctx.units, pool: ctx.units, byId: ctx.byId, words: ctx.words, tts: ctx.tts, rng: () => 0 });
  return Array.isArray(it.options) && it.options.length >= SCRIPT_MIN_OPTIONS;
}
// A wordHear stays wordHear with no voice when every example word has a recorded clip.
function scriptKindFor(kind, unit, cfg, ctx){
  const byId = isObj(ctx) ? (ctx.byId || (Array.isArray(ctx.words) ? Object.fromEntries(ctx.words.map(w => [w.id, w])) : null)) : null;
  const k = kind === "wordHear" && ((cfg && !cfg.tts) || (isObj(ctx) && ctx.tts === false)) && !exRecorded(unit, byId) ? "wordRead" : kind;
  return scriptKindFits(k, unit, ctx) ? k : null;
}
const scriptFitKinds = (kinds, unit, cfg, ctx) => [...new Set((kinds || []).map(k => scriptKindFor(k, unit, cfg, ctx)).filter(Boolean))];
function pickScriptKind(kinds, unit, cfg, rng, ctx, fitKinds){
  const fit = fitKinds || scriptFitKinds(kinds, unit, cfg, ctx);
  if(fit.length) return fit[Math.floor((rng || Math.random)() * fit.length)];
  return ["wordRead","symSound","formMatch"].find(k => scriptKindFits(k, unit, ctx)) || null;
}
// Compose distractors never cross a writing system (Hiragana and Katakana are two).
const SCRIPT_FAMILIES = ["Hangul","Hiragana","Katakana","Han","Cyrillic","Greek","Arabic","Hebrew","Devanagari","Bengali","Gurmukhi","Gujarati","Tamil","Telugu","Kannada","Malayalam","Thai","Lao","Georgian","Armenian","Ethiopic","Latin"]
  .map(n => [n, new RegExp(`\\p{Script=${n}}`, "u")]);
function scriptFamily(text){
  for(const ch of String(text || "")){ const f = SCRIPT_FAMILIES.find(([, re]) => re.test(ch)); if(f) return f[0]; }
  return "";
}

// A teach card may show "upper lower"; items use the lower form.
function scriptGlyph(unit){ const p = String((unit && unit.t) || "").trim().split(/\s+/); return p[p.length - 1]; }
// Same rule as tools/validate_pack.py glyph_in: compatibility decomposition, and a
// positional Hangul letter keyed as its compatibility letter (the batchim ㄱ of 책 is ㄱ).
const HANGUL_POS_KEY = (() => {
  const m = {}, put = (base, letters) => [...letters].forEach((c, i) => { m[String.fromCharCode(base + i)] = c; });
  put(0x1100, "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ");
  put(0x1161, "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ");
  put(0x11A8, "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ");
  m["\u111A"] = "ㅀ"; m["\u1121"] = "ㅄ"; // ㅀ and ㅄ decompose to these (archaic) initials
  return m;
})();
function scriptGlyphKeys(s){ return [...String(s == null ? "" : s).toLowerCase().normalize("NFKD")].map(ch => HANGUL_POS_KEY[ch] || ch); }
function scriptGlyphIn(glyph, text){
  const g = scriptGlyphKeys(glyph), t = scriptGlyphKeys(text);
  if(!g.length) return false;
  for(let i = 0; i + g.length <= t.length; i++) if(g.every((k, j) => t[i + j] === k)) return true;
  return false;
}
// Shaping clusters: the smallest runs of a word that may be split into separate elements
// without changing how the word renders. Browsers shape each element's text separately
// (joining context survives a boundary, a ligature does not), so a highlight or any other
// element boundary inside a word must fall between clusters. A cluster is a grapheme
// (base + marks: a haraka stays on its letter, a matra/nukta on its consonant), and then:
//  - Arabic script: lam + alef (ل with ا أ إ آ ٱ ٲ ٳ ٵ, marks or a ZWJ between allowed:
//    shapers ligate through ZWJ) is one mandatory ligature (لا). Tatweel between them
//    blocks the ligature, so it splits.
//  - Brahmic scripts: a grapheme ending in a virama (Devanagari ्, and the Bengali ..
//    Sinhala viramas) joins the next one (क्ष, स्त्र, reph र्क). A ZWNJ after the virama
//    asks for no conjunct and so splits (ZWJ still joins: the half form is shaped with it).
// Nastaliq (ur) and fonts with discretionary ligatures can join more than this; the app
// avoids element boundaries inside words entirely where the browser allows it
// (app.html scriptHL), and this is the fallback granularity.
const GRAPHEMES = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function graphemes(s){
  const t = String(s == null ? "" : s);
  if(GRAPHEMES) return [...GRAPHEMES.segment(t)].map(x => x.segment);
  const out = [];
  for(const ch of t){ if(out.length && /[\p{M}‌‍]/u.test(ch)) out[out.length - 1] += ch; else out.push(ch); }
  return out;
}
const LAM_END = /ل[ً-ٰٟ‍]*$/, ALEF_START = /^[اآأإٱٲٳٵ]/;
const VIRAMA_END = /[्্੍્୍்్್്්]‍?$/;
function shapingClusters(s){
  const out = [];
  for(const g of graphemes(s)){
    const prev = out[out.length - 1];
    if(prev !== undefined && ((LAM_END.test(prev) && ALEF_START.test(g)) || VIRAMA_END.test(prev))) out[out.length - 1] = prev + g;
    else out.push(g);
  }
  return out;
}
function scriptUnitNote(unit){
  const n = unit && unit.note != null ? String(unit.note) : "";
  return n && normKey(n) !== normKey(String((unit && unit.roman) || "")) ? n : "";
}
function scriptUnitHeadName(unit){
  const n = unit && unit.name != null ? String(unit.name) : "";
  return n && normKey(n) !== normKey(String((unit && unit.roman) || "")) ? n : "";
}
function scriptWordHas(unit, word){
  const gs = String((unit && unit.t) || "").trim().split(/\s+/).filter(Boolean);
  const texts = [word && word.w, word && word.pron].filter(t => typeof t === "string" && t);
  return gs.some(g => texts.some(t => scriptGlyphIn(g, t)));
}
const scriptRomans = u => [u.roman, ...(Array.isArray(u.alt) ? u.alt : [])].map(normKey).filter(Boolean);
// A one-way alt is a contrast to drill, not a second answer: ko ㄱ accepts "k" (its final
// sound) yet ㄱ/ㅋ are offered against each other. Two-way alts (fa غ/ق) are homophones.
function scriptSecondRight(unit, cand, kind){
  if(cand.id === unit.id) return true;
  if(normKey(scriptGlyph(cand)) === normKey(scriptGlyph(unit))) return true;
  if(unit.say && cand.say && normKey(unit.say) === normKey(cand.say)) return true;
  const ur = normKey(unit.roman), cr = normKey(cand.roman);
  if(ur && ur === cr) return true;
  return !!(ur && cr) && scriptRomans(unit).includes(cr) && scriptRomans(cand).includes(ur);
}
// Padding from all units of the stage (confuse first even when untaught) so a set-1 item
// still gets 4 options. Units of two stages never mix.
function scriptOpts(unit, pool, all, kind, rng){
  const every = Array.isArray(all) ? all : (Array.isArray(pool) ? pool : []);
  const inPool = Array.isArray(pool) ? pool : every;
  const sound = SCRIPT_SOUND_KINDS.includes(kind);
  const ok = v => isObj(v) && v.st === unit.st && !!v.roman && !(sound && v.sound === false) && !scriptSecondRight(unit, v, kind);
  const confuse = new Set(Array.isArray(unit.confuse) ? unit.confuse : []);
  const sameGroup = v => unit.group != null && v.group === unit.group;
  const cands = inPool.filter(ok), rest = every.filter(ok);
  const tiers = [cands.filter(v => confuse.has(v.id)), cands.filter(sameGroup), cands.filter(v => v.set === unit.set), cands,
    rest.filter(v => confuse.has(v.id)), rest.filter(sameGroup), rest];
  const out = [], ids = new Set([unit.id]), usedG = new Set([normKey(scriptGlyph(unit))]), usedR = new Set([normKey(unit.roman)]);
  for(const tier of tiers){
    for(const v of shuffle(tier.slice(), rng)){
      if(out.length >= 3) return out;
      const g = normKey(scriptGlyph(v)), r = normKey(v.roman);
      if(ids.has(v.id) || usedG.has(g) || usedR.has(r)) continue;
      out.push(v); ids.add(v.id); usedG.add(g); usedR.add(r);
    }
  }
  return out;
}
function scriptRomanOpts(unit, pool, all, rng){ return scriptOpts(unit, pool, all, "symSound", rng).map(v => String(v.roman)); }
function exRecorded(unit, byId){
  if(!byId || !isObj(unit)) return false;
  const ex = scriptExamples(unit, byId);
  return ex.length > 0 && ex.every(e => !!wordAudio(byId[e.id]));
}
function scriptExamples(unit, byId){
  return (Array.isArray(unit && unit.ex) ? unit.ex : []).filter(e => Array.isArray(e) && byId[e[0]] && byId[e[0]].w)
    .map(e => ({ id: e[0], w: String(byId[e[0]].w), roman: String(e[1] == null ? "" : e[1]), unitId: unit.id }));
}
function editDistance(a, b){
  const x = [...String(a)], y = [...String(b)];
  let prev = y.map((_, j) => j + 1); prev.unshift(0);
  for(let i=1; i<=x.length; i++){
    const cur = [i];
    for(let j=1; j<=y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (x[i-1] === y[j-1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
function scriptWordOpts(unit, ans, pool, all, byId, rng){
  const every = Array.isArray(all) ? all : (Array.isArray(pool) ? pool : []);
  const inPool = Array.isArray(pool) ? pool : every;
  const b = byId || {}; const len = cpLen(ans.w);
  const gather = list => list.filter(u => isObj(u) && u.st === unit.st).flatMap(u => scriptExamples(u, b))
    .filter(e => e.id !== ans.id && normKey(e.w) !== normKey(ans.w) && e.roman && normKey(e.roman) !== normKey(ans.roman));
  const rank = list => shuffle(list, rng).map((e, i) => ({ e, d: editDistance(e.w, ans.w), l: cpLen(e.w) === len ? 0 : 1, i }))
    .sort((p, q) => (p.d - q.d) || (p.l - q.l) || (p.i - q.i)).map(o => o.e);
  const out = [], usedW = new Set([normKey(ans.w)]), usedR = new Set([normKey(ans.roman)]);
  for(const tier of [rank(gather(inPool)), rank(gather(every))]){
    for(const e of tier){
      if(out.length >= 3) return out;
      if(usedW.has(normKey(e.w)) || usedR.has(normKey(e.roman))) continue;
      out.push(e); usedW.add(normKey(e.w)); usedR.add(normKey(e.roman));
    }
  }
  return out;
}
// Unicode shaping draws the joined forms from the letter plus a zero-width joiner.
function scriptJoinedForms(unit){
  const L = scriptGlyph(unit);
  if(unit && unit.joins === "dual") return [{ form:"init", t: L + ZWJ }, { form:"medi", t: ZWJ + L + ZWJ }, { form:"fina", t: ZWJ + L }];
  if(unit && unit.joins === "right") return [{ form:"fina", t: ZWJ + L }];
  return [];
}
// The gloss lives on the revealed word, never in the stimulus.
function scriptItem(kind, unit, ctx){
  const c = ctx || {}; const r = c.rng || Math.random;
  const all = Array.isArray(c.units) ? c.units : []; const pool = Array.isArray(c.pool) ? c.pool : all;
  const byId = c.byId || Object.fromEntries((c.words || []).map(w => [w.id, w]));
  const voice = c.tts !== false;
  if(!SCRIPT_KINDS.includes(kind)) throw new Error(`unknown script item kind ${kind}`);
  const k = kind === "wordHear" && !voice && !exRecorded(unit, byId) ? "wordRead" : kind;
  if(!scriptKindShape(k, unit)) throw new Error(`script unit ${unit && unit.id} cannot carry a ${k} item`);
  const glyph = scriptGlyph(unit), roman = String(unit.roman || "");
  const unitSay = voice && unit.say ? String(unit.say) : null, unitUrl = unit.audio ? String(unit.audio) : null;
  const unitAudio = !!(unitSay || unitUrl);
  const exs = scriptExamples(unit, byId);
  const pickEx = () => exs[Math.floor(r() * exs.length)];
  const wordOf = e => { const w = byId[e.id] || {}; return { id: e.id, w: e.w, roman: e.roman, en: gloss(w) }; };
  const reveal = { t: String(unit.t), glyph, name: scriptUnitHeadName(unit), roman, note: scriptUnitNote(unit), word: null };
  const it = { kind: k, key: "x:" + unit.id, unitId: unit.id, show: null, hint: null, form: null, audio: null, say: null, audioUrl: null,
    wordId: null, options: null, answer: null, accept: null, reveal };
  const unitSound = when => { if(unitAudio){ it.audio = when; it.say = unitSay; it.audioUrl = unitUrl; } };
  // An example word's clip (words[].audio) beats TTS and plays with no voice, as unitSound.
  const wordSound = (when, e) => { const url = wordAudio(byId[e.id]); if(voice || url){ it.audio = when; it.say = voice ? (byId[e.id] && byId[e.id].w === e.w ? wordSay(byId[e.id]) : e.w) : null; it.audioUrl = url || null; } };
  let others = [];
  if(k === "symSound"){ it.show = glyph; it.answer = roman; others = scriptRomanOpts(unit, pool, all, r); unitSound("after"); }
  else if(k === "soundSym"){
    it.answer = glyph; others = scriptOpts(unit, pool, all, k, r).map(scriptGlyph);
    if(unitAudio) unitSound("before"); else it.show = roman;
  }
  else if(k === "symType"){ it.show = glyph; it.answer = roman; it.accept = [roman, ...(Array.isArray(unit.alt) ? unit.alt.map(String) : [])]; unitSound("after"); }
  else if(k === "compose"){
    const sy = unit.syll.filter(s => isObj(s) && s.t && Array.isArray(s.parts) && s.parts.length);
    const s = sy[Math.floor(r() * sy.length)];
    it.show = s.parts.map(String).join(" + "); it.answer = String(s.t);
    reveal.roman = String(s.roman || ""); reveal.syll = { t: String(s.t), parts: s.parts.map(String), roman: String(s.roman || "") };
    // Widening scope stays within one writing system: hiragana and katakana never mix.
    const parts = new Set(s.parts.map(String)), fam = scriptFamily(it.answer);
    const scopes = [u => u.st === unit.st && u.set === unit.set, u => u.st === unit.st, () => true];
    const cand = (list, sc) => list.filter(u => isObj(u) && Array.isArray(u.syll) && sc(u)).flatMap(u => u.syll)
      .filter(x => isObj(x) && x.t && String(x.t) !== it.answer && scriptFamily(x.t) === fam && !(s.roman && x.roman && normKey(x.roman) === normKey(s.roman)));
    const shares = x => Array.isArray(x.parts) && x.parts.some(p => parts.has(String(p)));
    const used = new Set([it.answer]), usedR = new Set([normKey(s.roman || "")]);
    for(const list of scopes.flatMap(sc => [cand(pool, sc).filter(shares), cand(pool, sc), cand(all, sc).filter(shares), cand(all, sc)])){
      for(const x of shuffle(list.slice(), r)){ if(others.length >= 3) break; const xr = normKey(x.roman || ""); if(!used.has(String(x.t)) && !(xr && usedR.has(xr))){ used.add(String(x.t)); if(xr) usedR.add(xr); others.push(String(x.t)); } }
    }
    if(voice){ it.audio = "after"; it.say = it.answer; }
  }
  else if(k === "formFind"){
    const e = pickEx(); it.show = glyph; it.hint = reveal.name || null; it.answer = e.w; it.wordId = e.id; reveal.word = wordOf(e);
    const used = new Set([normKey(e.w)]);
    const gather = list => list.filter(u => isObj(u) && u.st === unit.st).flatMap(u => scriptExamples(u, byId)).filter(x => !scriptWordHas(unit, byId[x.id]));
    for(const list of [gather(pool), gather(all)]){
      for(const x of shuffle(list, r)){ if(others.length >= 3) break; if(!used.has(normKey(x.w))){ used.add(normKey(x.w)); others.push(x.w); } }
    }
    wordSound("after", e);
  }
  else if(k === "formMatch"){
    const fs = scriptJoinedForms(unit); const f = fs[Math.floor(r() * fs.length)];
    it.show = f.t; it.form = f.form; it.answer = glyph; others = scriptOpts(unit, pool, all, k, r).map(scriptGlyph);
  }
  else if(k === "wordRead"){
    const e = pickEx(); it.show = e.w; it.answer = e.roman; it.wordId = e.id; reveal.word = wordOf(e);
    others = scriptWordOpts(unit, e, pool, all, byId, r).map(x => x.roman); wordSound("after", e);
  }
  else if(k === "wordHear"){
    const e = pickEx(); it.answer = e.w; it.wordId = e.id; reveal.word = wordOf(e);
    others = scriptWordOpts(unit, e, pool, all, byId, r).map(x => x.w); wordSound("before", e);
  }
  if(k !== "symType") it.options = shuffle([it.answer, ...others], r);
  return it;
}

// A unit no learnKind fits gets its first fitting kind, so every unit of the set is asked.
function learnScriptPlan(set, pack, ctx){
  const cfg = scriptConfig(pack); if(!cfg) return [];
  const out = [];
  (set || []).forEach(unit => {
    const seen = new Set();
    cfg.learnKinds.forEach(k0 => {
      let k = scriptKindFor(k0, unit, cfg, ctx);
      if(!k && SCRIPT_SOUND_KINDS.includes(k0) && isObj(unit) && unit.sound === false) k = scriptKindFits("wordRead", unit, ctx) ? "wordRead" : null;
      if(k && !seen.has(k)){ seen.add(k); out.push({ kind: k, unit }); }
    });
    if(!seen.size){ const k = pickScriptKind(SCRIPT_KINDS, unit, cfg, () => 0, ctx); if(k) out.push({ kind: k, unit }); }
  });
  return out;
}
function scriptReviewScore(rec, pack){
  const cfg = scriptConfig(pack); const p = rec || {}; const sc = weakScore(p);
  return (p.s || 0) < (cfg ? cfg.mastered : SCRIPT_MASTERED) ? Math.max(sc, 0) : sc;
}
function scriptTestPlan(units, prog, pack, n, rng, ctx){
  const cfg = scriptConfig(pack); if(!cfg) return [];
  const kctx = Object.assign({ units }, ctx || {});
  const today = ctx && ctx.today; const srecs = scriptRecs(prog);
  const rec = today ? dayPick(recordedScriptUnits(units, prog, pack).map(u => ({ x: u, key: "x:" + u.id, rec: srecs[u.id], mastered: cfg.mastered, kinds: Object.keys(cfg.testKinds) })), n, dayLog(prog, today), rng, daySn(prog)).map(c => c.x)
    : weakFirst(recordedScriptUnits(units, prog, pack), n, srecs, undefined, rng);
  const out = [];
  rec.forEach(unit => {
    const w = {}; Object.keys(cfg.testKinds).forEach(k => { const f = scriptKindFor(k, unit, cfg, kctx); if(f) w[f] = (w[f] || 0) + cfg.testKinds[k]; });
    const kind = Object.keys(w).length ? pickWeighted(w, rng) : pickScriptKind(cfg.reviewKinds, unit, cfg, rng, kctx);
    if(kind) out.push({ kind: today ? dayScriptKind(prog, pack, today, unit, kind, scriptFitKinds(Object.keys(cfg.testKinds), unit, cfg, kctx), cfg, kctx) : kind, unit });
  });
  return out;
}

// Pronunciation aids (docs/PACK_SCHEMA.md "Pronunciation aids"). Off for every pack without
// the field, so no other pack's output changes. pack.tones: macron 1, acute 2, caron 3,
// grave 4, unmarked 5 = neutral.
const TONE_MARKS = {
  a: ["a","\u0101","\u00e1","\u01ce","\u00e0"],
  e: ["e","\u0113","\u00e9","\u011b","\u00e8"],
  i: ["i","\u012b","\u00ed","\u01d0","\u00ec"],
  o: ["o","\u014d","\u00f3","\u01d2","\u00f2"],
  u: ["u","\u016b","\u00fa","\u01d4","\u00f9"],
  "\u00fc": ["\u00fc","\u01d6","\u01d8","\u01da","\u01dc"],
};
const MARK_OF = {}; // marked (or plain) vowel -> [plain vowel, tone 1-4, or 0 for none]
Object.keys(TONE_MARKS).forEach(v => TONE_MARKS[v].forEach((c, t) => { MARK_OF[c] = [v, t]; }));
function tonesOn(pack){ return !!(pack && typeof pack.tones === "string" && pack.tones); }
function stripMarks(s){
  return [...String(s == null ? "" : s).normalize("NFC")].map(c => {
    const m = MARK_OF[c.toLowerCase()]; if(!m) return c;
    return c === c.toLowerCase() ? m[0] : m[0].toUpperCase();
  }).join("");
}
function syllableTone(s){
  for(const c of String(s || "")){ const m = MARK_OF[c.toLowerCase()]; if(m && m[1]) return m[1]; }
  return 5;
}
const markCount = s => [...String(s || "")].filter(c => { const m = MARK_OF[c.toLowerCase()]; return !!(m && m[1]); }).length;
// Tone mark placement: a, else e, else o, else the last of i/u/ü.
function markVowelIndex(letters){
  const lower = String(letters).toLowerCase();
  for(const v of ["a","e","o"]){ const i = lower.indexOf(v); if(i >= 0) return i; }
  for(let i = lower.length - 1; i >= 0; i--) if("iu\u00fc".indexOf(lower[i]) >= 0) return i;
  return -1;
}
function markSyllable(letters, tone){
  const s = String(letters); const i = markVowelIndex(s); const t = +tone;
  if(i < 0 || !(t >= 1 && t <= 4)) return s;
  const c = s[i]; const m = MARK_OF[c.toLowerCase()];
  const out = TONE_MARKS[m ? m[0] : c.toLowerCase()][t];
  return s.slice(0, i) + (c !== c.toLowerCase() ? out.toUpperCase() : out) + s.slice(i + 1);
}
// Syllable inventory: initial -> finals, spelled as written (zero initial uses y/w forms;
// j/q/x/y write ü as u). "" holds the zero-initial syllables.
const SYL_FINALS = {
  b: "a ai an ang ao o ei en eng i ie iao ian in iang ing u",
  p: "a ai an ang ao o ei en eng ou i ie iao ian in iang ing u",
  m: "a ai an ang ao o ei en eng ou i ie iao iu ian in iang ing u e",
  f: "a an ang ei en eng ou u o",
  d: "a ai an ang ao e ei en eng ong i ia ie iao iu ian ing ou u uo ui uan un",
  t: "a ai an ang ao e eng ong i ian iao ie ing ou u uo ui uan un",
  n: "a ai an ang ao e ei en eng i ian iang iao ie in ing iu ong ou u uan uo \u00fc \u00fce",
  l: "a ai an ang ao e ei eng i ia ian iang iao ie in ing iu ong ou u uan un uo \u00fc \u00fce o",
  g: "a ai an ang ao e ei en eng ong ou u ua uai uan uang ui un uo",
  k: "a ai an ang ao e ei en eng ong ou u ua uai uan uang ui un uo",
  h: "a ai an ang ao e ei en eng ong ou u ua uai uan uang ui un uo",
  j: "i ia ian iang iao ie in ing iong iu u uan ue un",
  q: "i ia ian iang iao ie in ing iong iu u uan ue un",
  x: "i ia ian iang iao ie in ing iong iu u uan ue un",
  zh: "a ai an ang ao e ei en eng i ong ou u ua uai uan uang ui un uo",
  ch: "a ai an ang ao e en eng i ong ou u ua uai uan uang ui un uo",
  sh: "a ai an ang ao e ei en eng i ou u ua uai uan uang ui un uo",
  r: "an ang ao e en eng i ong ou u ua uan ui un uo",
  z: "a ai an ang ao e ei en eng i ong ou u uan ui un uo",
  c: "a ai an ang ao e en eng i ong ou u uan ui un uo",
  s: "a ai an ang ao e en eng i ong ou u uan ui un uo",
  "": "a o e ai ei ao ou an en ang eng er yi ya ye yao you yan yin yang ying yong wu wa wo wai wei wan wen wang weng yu yue yuan yun yo",
};
const SYL_SET = {}; Object.keys(SYL_FINALS).forEach(k => { SYL_SET[k] = new Set(SYL_FINALS[k].split(" ")); });
const SYL_INITIALS = Object.keys(SYL_FINALS).filter(Boolean).sort((a, b) => b.length - a.length);
function splitSyllable(toneless){
  const s = String(toneless || "").toLowerCase();
  for(const ini of SYL_INITIALS) if(s.indexOf(ini) === 0 && SYL_SET[ini].has(s.slice(ini.length))) return { initial: ini, final: s.slice(ini.length) };
  return SYL_SET[""].has(s) ? { initial: "", final: s } : null;
}
const isRSuffixed = s => s.length > 1 && s[s.length - 1] === "r" && s !== "er" && !!splitSyllable(s.slice(0, -1));
const SYL_MAX = 7;
// A syllable starting with a/o/e inside the run costs extra (the writing would put an
// apostrophe there); among equals the longest first syllable wins (left-to-right reading).
function splitRun(run){
  const chars = [...run]; const n = chars.length;
  const bare = chars.map(c => { const m = MARK_OF[c.toLowerCase()]; return m ? m[0] : c.toLowerCase(); });
  const best = new Array(n + 1).fill(null); best[n] = { cost: 0, next: -1 };
  for(let i = n - 1; i >= 0; i--){
    for(let j = Math.min(n, i + SYL_MAX); j > i; j--){
      if(!best[j]) continue;
      const b = bare.slice(i, j).join("");
      const r = !splitSyllable(b) && isRSuffixed(b);
      if(!r && !splitSyllable(b)) continue;
      if(markCount(chars.slice(i, j).join("")) > 1) continue;
      const cost = best[j].cost + 1 + (r ? 0.5 : 0) + (i > 0 && /^[aoe]/.test(b) ? 10 : 0);
      if(!best[i] || cost < best[i].cost) best[i] = { cost, next: j, r };
    }
  }
  if(!best[0]) return null;
  const out = []; let i = 0;
  while(i < n){ const j = best[i].next; const text = chars.slice(i, j).join(""); out.push({ text, tone: syllableTone(text), r: !!best[i].r }); i = j; }
  return out;
}
const LETTER_RUN = /[\p{Script=Latin}\u0300-\u036f]+/gu;
function splitReading(text){
  const t = String(text == null ? "" : text).normalize("NFC");
  const out = []; let pos = 0;
  for(const m of t.matchAll(LETTER_RUN)){
    if(m.index > pos) out.push({ text: t.slice(pos, m.index) });
    const syl = splitRun(m[0]);
    if(syl) syl.forEach(x => out.push({ text: x.text, tone: x.tone }));
    else out.push(markCount(m[0]) === 1 ? { text: m[0], tone: syllableTone(m[0]) } : { text: m[0] });
    pos = m.index + m[0].length;
  }
  if(pos < t.length) out.push({ text: t.slice(pos) });
  return out;
}
function toneHTML(text){
  return splitReading(text).map(p => p.tone ? `<span class="t${p.tone}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)).join("");
}
function pronTypingOn(pack){ return !!(pack && pack.typing === "pron"); }
// ü after j/q/x/y folds to u: the writing drops the dots there.
function pronKey(s){
  return String(s == null ? "" : s).normalize("NFC").toLowerCase()
    .replace(/u:/g, "\u00fc").replace(/v/g, "\u00fc")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/([jqxy])([\u00fc\u01d6\u01d8\u01da\u01dc])/g, (m, a, b) => a + TONE_MARKS.u[MARK_OF[b][1]]);
}
const NUMBERED_MAX = 64;
function numberedForms(pron){
  const runs = String(pron || "").normalize("NFC").match(LETTER_RUN) || [];
  let combos = [""];
  for(const run of runs){
    const syl = splitRun(run); if(!syl) return [];
    for(const x of syl){
      const b = stripMarks(x.text).toLowerCase();
      const d = x.tone === 5 ? ["5", "0", ""] : [String(x.tone)];
      const opts = [];
      // r-suffix: the digit also before the r, the r then bare or as its own neutral
      // chunk ("yi1hui4r5", "hui4r0": how the predecessor app stored 一会儿).
      d.forEach(k => { opts.push(b + k); if(x.r && k) ["r", "r5", "r0"].forEach(rr => opts.push(b.slice(0, -1) + k + rr)); });
      const next = []; combos.forEach(c => opts.forEach(o => next.push(c + o)));
      if(next.length > NUMBERED_MAX) return [];
      combos = next;
    }
  }
  return runs.length ? combos.map(pronKey) : [];
}
// Tones are optional: the typed-reading item accepts every verdict but "wrong". A pack
// without `tones` (ja: kana readings) compares plainPronKey only.
const pronLetters = s => pronKey(stripMarks(s)).replace(/\p{N}/gu, "");
function checkPronTyped(input, pron, pack){
  if(pack && !tonesOn(pack)){ const k = plainPronKey(input); return k && pron && k === plainPronKey(pron) ? "ok" : "wrong"; }
  const got = pronKey(input);
  if(!got || !pron) return "wrong";
  if(got === pronKey(pron) || numberedForms(pron).indexOf(got) >= 0) return "ok";
  if(pronLetters(got) !== pronLetters(pron)) return "wrong";
  return !/\p{N}/u.test(got) && markCount(got) === 0 ? "tones" : "tonesDiff";
}
// ー, small kana and voicing marks are kept: they spell a different reading.
function kanaFold(s){
  return String(s == null ? "" : s).normalize("NFKC").replace(/[\u30a1-\u30f6\u30fd\u30fe]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
// NFC again at the end: a standalone voicing mark (U+309B) NFKC-decomposes to a space plus
// the combining mark; with the space stripped, NFC recomposes it (は + ゛ + す -> ばす).
function plainPronKey(s){ return normalizeTyped(kanaFold(s)).replace(/[^\p{L}\p{M}\p{N}]/gu, "").normalize("NFC"); }
// Affix marks a learner should not have to type: ja 〜/～, ko -이다. Only a leading or
// trailing run; an inner hyphen (धीरे-धीरे) or tilde (年〜年) is a real character.
function affixBare(w){ return String(w == null ? "" : w).replace(/^[\u301c\uff5e-]+|[\u301c\uff5e-]+$/g, ""); }
// Korean -(으)로: (으) is dropped after a vowel-final stem, kept after a consonant-final one.
function parenAlts(s){
  const m = s.match(/^(.*)\(([^()]*)\)(.*)$/);
  return m ? [m[1] + m[2] + m[3], m[1] + m[3]] : [];
}
// [] without an affix mark, so callers splice it into acceptTyped's `extra` unconditionally.
function affixAlts(w){
  const s = String(w == null ? "" : w);
  const bare = affixBare(s);
  if(bare === s) return [];
  const parts = bare.indexOf("/") >= 0 ? [bare, ...bare.split("/")] : [bare];
  const out = [...parts];
  parts.forEach(p => out.push(...parenAlts(p)));
  return out;
}
// The tilde swap runs before NFKC, which would turn ～ into ASCII "~". Never folds katakana
// to hiragana: the written spelling (テレビ, not てれび) must still match exactly.
function writtenTypedFold(s){ return String(s == null ? "" : s).replace(/～/g, "〜").normalize("NFKC"); }
// Plan order is already fixed by the plan builders' rng, so alternating reading/written adds
// no randomness and every plan is unchanged.
function typeSlotKind(plan, i){
  let n = 0;
  for(let j = 0; j < (i || 0); j++) if(plan && plan[j] && plan[j].kind === "type") n++;
  return n % 2 ? "written" : "pron";
}

// ------------------------------------------------------------------ typed from the target side
// pack.typedFrom (docs/PACK_SCHEMA.md "typedFrom and glossFocus"; glossFocus is engine default since the flag collapse). Off unless
// the pack sets them; typeSlotKind above stays the rule for every pack without typedFrom.
const TYPED_FROM_SIDES = ["written", "pron"];
function typedFromSides(pack){
  const t = pack && typingEnabled(pack) && Array.isArray(pack.typedFrom) ? pack.typedFrom : [];
  return TYPED_FROM_SIDES.filter(s => t.includes(s));
}
function typedFromOn(pack){ return typedFromSides(pack).length > 0; }
// Production (meaning -> target) and target-side kinds alternate, so a short plan still mixes
// both directions. With both characters <-> meaning kinds present (typedFrom "written" on a
// typing "pron" pack), each comes three times per cycle of nine and every reading kind once (owner feedback
// 2026-10-01: more characters <-> meaning writing practice).
function typedKinds(pack){
  const sides = typedFromSides(pack), pt = pronTypingOn(pack);
  const w = sides.includes("written"), p = sides.includes("pron");
  if(w && pt) return ["writtenMeaning", "written", "pron", "writtenMeaning", "written", ...(p ? ["pronMeaning"] : []), "writtenMeaning", "written", "writtenPron"];
  const out = [pt ? "pron" : "word"];
  if(w) out.push("writtenMeaning");
  if(pt) out.push("written");
  if(p) out.push("pronMeaning");
  if(w && pt) out.push("writtenPron");
  return out;
}
// A stimulus two pack words share (他/她/它 are all tā) cannot ask for one of them: such a
// word never gets the kind that shows it.
function typedAmbiguity(words){
  const bySurf = new Map(), byPron = new Map(), add = (m, k, id) => { if(!k) return; if(!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
  (words || []).forEach(w => {
    [w.w, ...(Array.isArray(w.alt) ? w.alt : [])].forEach(s => add(bySurf, String(s || "").normalize("NFC"), w.id));
    if(w.pron) add(byPron, pronKey(w.pron), w.id);
  });
  const shared = m => { const s = new Set(); m.forEach(ids => { if(ids.size > 1) ids.forEach(id => s.add(id)); }); return s; };
  return { written: shared(bySurf), pron: shared(byPron) };
}
// shownWritten: the learner sees this word's written form (pronFirst: its unit is mastered).
function typedKindOk(kind, word, shownWritten, amb){
  const a = amb || { written: new Set(), pron: new Set() };
  const hasW = !!(word && word.w), hasP = !!(word && word.pron), hasG = !!gloss(word);
  if(kind === "word") return hasW;
  // words[].pronInGloss: the gloss spells the reading (北京 "Beijing"), so neither side may be
  // the stimulus for the other: no meaning -> reading, no reading -> meaning. The written form
  // and the audio stay allowed stimuli (docs/PACK_SCHEMA.md "pronInGloss").
  if(kind === "pron") return hasP && !word.pronInGloss;
  if(kind === "written") return hasW && shownWritten;
  if(kind === "writtenMeaning") return hasW && shownWritten && hasG && !a.written.has(word.id) && !word.noTypedMeaning;
  if(kind === "writtenPron") return hasW && hasP && shownWritten && !a.written.has(word.id);
  if(kind === "pronMeaning") return hasP && hasG && !a.pron.has(word.id) && !word.noTypedMeaning && !word.pronInGloss;
  return false;
}
// Slot order in the plan plus the word's recorded answers picks the start of the rotation: a
// Review has only three type slots, so the order alone would never reach the later kinds.
// No rng: the same plan and progress give the same kinds. An unavailable kind passes to the
// next one; null only when no kind fits.
function typedSlotKind(plan, i, prog, pack, ok){
  const kinds = typedKinds(pack);
  let n = 0;
  for(let j = 0; j < (i || 0); j++) if(plan && plan[j] && plan[j].kind === "type") n++;
  const word = plan && plan[i] && plan[i].word;
  const rec = word && prog && isObj(prog.w) ? prog.w[word.id] : null;
  const seen = rec ? (rec.r || 0) + (rec.w || 0) : 0;
  for(let s = 0; s < kinds.length; s++){
    const k = kinds[(n + seen + s) % kinds.length];
    if(!ok || ok(k)) return k;
  }
  return null;
}
// ------------------------------------------------------------------ session resume
// app.html keeps the drill or passage in progress under sessionKey(pack) so an app-tab switch
// or a reload returns to the same item (docs/PACK_SCHEMA.md "Session resume"). Progress is
// never stored there: it is written per answer under storageKey(pack) as before.
const SESSION_VERSION = 1;
const SESSION_MAX_AGE_MS = 12 * 3600 * 1000;
function sessionKey(pack){ return `${storageKey(pack)}_session`; }
// FNV-1a over UTF-16 code units: a fingerprint, not a security hash.
function sessionHash(s){
  let h = 0x811c9dc5; s = String(s == null ? "" : s);
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
// "" when the record may be resumed, else why not. o: { build, fp: [fingerprints of the
// progress as it stands now], now }. A clock up to a minute behind the save is tolerated.
function sessionStale(rec, o){
  if(!isObj(rec) || rec.v !== SESSION_VERSION) return "version";
  if(!o || rec.build !== o.build) return "build";
  const age = (o.now || 0) - rec.t;
  if(typeof rec.t !== "number" || !(age >= -60000 && age <= SESSION_MAX_AGE_MS)) return "age";
  if(!Array.isArray(o.fp) || !o.fp.includes(rec.fp)) return "progress";
  return "";
}
// Top-level split: separators inside (...) or [...] never split.
function splitTopLevel(s, seps){
  return splitSeps(s, seps).map(x => x.t);
}
// As splitTopLevel, keeping the separator that ended each part ("" for the last).
function splitSeps(s, seps){
  const out = []; let depth = 0, cur = "";
  for(const c of String(s)){
    if(c === "(" || c === "[") depth++;
    else if((c === ")" || c === "]") && depth > 0) depth--;
    if(depth === 0 && seps.includes(c)){ out.push({ t: cur, sep: c }); cur = ""; } else cur += c;
  }
  out.push({ t: cur, sep: "" });
  return out;
}
// Top-level (...) groups, nested parens kept inside their group; an unclosed "(" is text.
function parenGroups(s){
  const ps = parenPieces(s);
  return { rest: ps.filter(p => !p.g).map(p => p.t).join(""), groups: ps.filter(p => p.g).map(p => p.t) };
}
// The text as ordered pieces: top-level (...) groups (g: true) and the text between them.
function parenPieces(s){
  const out = []; let depth = 0, cur = "", txt = "";
  const flush = () => { if(txt){ out.push({ t: txt, g: false }); txt = ""; } };
  for(const c of String(s)){
    if(c === "("){ if(depth === 0){ flush(); cur = ""; } depth++; cur += c; continue; }
    if(depth > 0){ cur += c; if(c === ")" && --depth === 0) out.push({ t: cur, g: true }); continue; }
    txt += c;
  }
  if(depth > 0) txt += cur;
  flush();
  return out;
}
// A reading note in a gloss ("also pr. [shuí]", "(colloquial pr. [nèi])", a bare "[shuí]")
// spells the answer of a meaning -> reading item: it is shown only after the answer and is
// never a typed meaning (docs/PACK_SCHEMA.md "Typed meaning").
const PR_NOTE = /^\(?\s*(?:also|colloquial)\s+pr\.\s*\[[^\]]*\]\s*\)?$/i;
const BRACKET_NOTE = /^\[[^\]]*\]$/;
const isPronNote = s => { const t = String(s).trim(); return PR_NOTE.test(t) || BRACKET_NOTE.test(t); };
// Shared by the display and the matcher. Alternatives are the top-level ";"/","-parts; reading
// notes are taken out. In the display (pieces) a (...) group that opens its alternative moves
// to the end of that alternative, any other stays in place; groups are dimmed and never cross
// alternatives. primary is the display text without groups; a gloss that is nothing but groups
// stays whole.
function glossParts(en){
  const g = String(en == null ? "" : en).replace(/\s+/g, " ").trim();
  const notes = [], qualifiers = [], alts = [];
  let sep = "";
  splitSeps(g, [";", ","]).forEach(({ t, sep: after }) => {
    const a = t.trim();
    if(a && isPronNote(a)){ notes.push(a); sep = sep === ";" || after === ";" ? ";" : after || sep; return; }
    const ps = parenPieces(a).filter(p => { if(p.g && isPronNote(p.t)){ notes.push(p.t); return false; } return true; });
    ps.forEach(p => { if(p.g) qualifiers.push(p.t); });
    const text = ps.filter(p => !p.g).map(p => p.t).join("").replace(/\s+/g, " ").trim();
    let lead = [];
    if(text) while(ps.length && (ps[0].g || !ps[0].t.trim())){ const p = ps.shift(); if(p.g) lead.push(p); }
    const pieces = [];
    ps.concat(lead.length ? [{ t: " ", g: false }, ...lead.flatMap((p, i) => i ? [{ t: " ", g: false }, p] : [p])] : []).forEach(p => {
      const last = pieces[pieces.length - 1];
      if(!p.g && last && !last.dim) last.t += p.t; else pieces.push({ t: p.t, dim: p.g });
    });
    pieces.forEach(p => { if(!p.dim) p.t = p.t.replace(/\s+/g, " "); });
    if(pieces.length){ if(!pieces[0].dim) pieces[0].t = pieces[0].t.replace(/^ /, ""); const z = pieces[pieces.length - 1]; if(!z.dim) z.t = z.t.replace(/ $/, ""); }
    const kept = pieces.filter(p => p.dim || p.t);
    if(kept.length) alts.push({ sep: alts.length ? sep : "", pieces: kept, text });
    sep = after;
  });
  if(!qualifiers.length && !notes.length) return { primary: g, qualifiers: [], notes: [], pieces: [{ t: g, dim: false }] };
  if(!alts.some(a => a.text)) return { primary: g, qualifiers: [], notes: [], pieces: [{ t: g, dim: false }] };
  const pieces = [];
  alts.forEach(a => {
    if(a.sep) pieces.push({ t: a.sep + " ", dim: false });
    a.pieces.forEach(p => { const last = pieces[pieces.length - 1]; if(!p.dim && last && !last.dim) last.t += p.t; else pieces.push(Object.assign({}, p)); });
  });
  const primary = alts.filter(a => a.text).map((a, i) => (i ? (a.sep || ";") + " " : "") + a.text).join("").replace(/\s+/g, " ").trim();
  return { primary, qualifiers, notes, pieces };
}
const GLOSS_DROP = new Set(["a", "an", "the", "sb", "sth", "someone", "somebody", "something", "etc", "eg"]);
// Words that alone are not a meaning: "to…", "to be…" and the left of "in or out" never count.
const GLOSS_FUNC = new Set([...GLOSS_DROP, "to", "be", "is", "are", "am", "was", "were", "been", "being", "of", "and", "or", "that"]);
function glossWords(s){
  return String(s == null ? "" : s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[.'‘’ʼ`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}
function glossKey(s){
  const toks = glossWords(s);
  let t = toks.filter(x => !GLOSS_DROP.has(x));
  if(!t.length) t = toks;
  if(t.length > 1 && t[0] === "to") t = t.slice(1);
  return t.join("");
}
const glossHasContent = s => glossWords(s).some(x => !GLOSS_FUNC.has(x));
const GLOSS_GROUPS_MAX = 4;
// The alternative with each (...) group kept (brackets dropped) or left out; groups past the
// cap are always kept.
function glossAltVariants(alt){
  const ps = parenPieces(alt), n = Math.min(ps.filter(p => p.g).length, GLOSS_GROUPS_MAX), out = [];
  for(let mask = 0; mask < (1 << n); mask++){
    let gi = 0;
    out.push(ps.map(p => { if(!p.g) return p.t; const keep = gi >= n || (mask >> gi) & 1; gi++; return keep ? " " + p.t.slice(1, -1) + " " : " "; }).join(""));
  }
  return out;
}
// Text before the first top-level " or " when one word follows it: "no matter what or how"
// also takes "no matter what". A longer right side ("hot or boiling water") shares its tail
// with the left, so the left alone is not a meaning.
function leftOfOr(alt){
  let depth = 0; const s = String(alt);
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(c === "(" || c === "[") depth++;
    else if((c === ")" || c === "]") && depth > 0) depth--;
    else if(depth === 0 && s.startsWith(" or ", i)) return glossWords(parenGroups(s.slice(i + 4)).rest).length === 1 ? s.slice(0, i) : "";
  }
  return "";
}
// "to be careful" / "to feel anxious" also take the bare adjective ("careful", "anxious"): a
// learner names the quality, not the copula (owner feedback 2026-10-02, 着急). Only a one-word
// adjective or participle: "to be like", "to be apart from", "to be able to" would key a wrong
// sense. Typed-meaning packs only (typedFromOn); every other pack keeps its keys.
const GLOSS_COPULA = new Set(["be", "feel"]);
const GLOSS_COPULA_NOT = new Set(["about", "above", "across", "after", "against", "along", "among", "apart", "around", "at", "away", "before", "behind", "below", "beside", "between", "beyond", "by", "down", "for", "from", "here", "in", "inside", "into", "left", "like", "near", "not", "of", "off", "on", "onto", "out", "outside", "over", "past", "so", "there", "through", "to", "toward", "towards", "under", "up", "with", "within", "without", "able"]);
function copulaFree(v){
  const toks = glossWords(v);
  if(toks.length !== 3 || toks[0] !== "to" || !GLOSS_COPULA.has(toks[1]) || GLOSS_COPULA_NOT.has(toks[2]) || GLOSS_FUNC.has(toks[2])) return [];
  return [toks[2]];
}
function glossAltKeys(en, pack){
  const keys = new Set(), copula = typedFromOn(pack);
  const add = v => {
    const k = glossKey(v); if(!k) return;
    // A lone letter left by punctuation ("~'s" -> s) is not a meaning; a gloss "I" is.
    if(/^\p{L}$/u.test(k) && String(v).trim().toLowerCase() !== k) return;
    keys.add(k);
  };
  splitTopLevel(String(en == null ? "" : en), [";", ","]).forEach(raw => {
    if(isPronNote(raw)) return;
    const alt = parenPieces(raw).filter(p => !(p.g && isPronNote(p.t))).map(p => p.t).join("");
    if(/(?:…|\.\.\.)\s*$/.test(alt) && !glossHasContent(parenGroups(alt).rest)) return;
    glossAltVariants(alt).forEach(v => { add(v); if(copula) copulaFree(v).forEach(add); });
    const left = leftOfOr(alt);
    if(left) glossAltVariants(left).forEach(v => { if(glossHasContent(v)) add(v); });
  });
  return keys;
}
// characters -> reading as a choice (typedFrom writtenPron, from the second miss): three other
// readings from pool (the learned words), topped up from all, same syllable count first. Never
// the answer's reading, a reading the answer's written form also has, or two alike. No rng: the
// order within a tier is a hash of the two ids; the drill shuffles the shown order.
const PRON_SYL = new WeakMap(); // word -> syllable count; splitReading over every word per call cost ~10 ms
function pronChoiceOpts(entry, pool, all, mix){
  if(!entry || !entry.pron) return [];
  const ansT = new Set(surfaces(entry)), used = new Set([pronKey(entry.pron)]);
  (all || []).forEach(v => { if(v && v.pron && surfaces(v).some(x => ansT.has(x))) used.add(pronKey(v.pron)); });
  const syl = s => splitReading(s).filter(x => x.tone !== undefined).length || 1, n = syl(entry.pron);
  // option mix: by the answer's stage (mix.stage); draws (rng).
  if(mix){
    const ids = new Set(), cands = [...(pool || []), ...(all || [])].filter(v => v && v.id !== entry.id && v.pron && !ids.has(v.id) && ids.add(v.id));
    return mixPick(entry, cands, mix, () => 0, v => { let k = PRON_SYL.get(v); if(k === undefined) PRON_SYL.set(v, k = syl(v.pron)); return k === n ? 0 : 1; }, () => {
      const u = new Set(used);
      return v => { const k = pronKey(v.pron); if(!k || u.has(k)) return false; u.add(k); return true; };
    }, undefined, true).map(v => v.pron);
  }
  const hash = s => { let h = 2166136261; for(const c of s){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const rank = list => list.filter(v => v && v.id !== entry.id && v.pron)
    .map(v => ({ v, t: syl(v.pron) === n ? 0 : 1, h: hash(entry.id + "|" + v.id) }))
    .sort((a, b) => a.t - b.t || a.h - b.h || (a.v.id < b.v.id ? -1 : 1)).map(x => x.v);
  const out = [];
  for(const v of [...rank(pool || []), ...rank(all || [])]){
    if(out.length >= 3) break;
    const k = pronKey(v.pron); if(!k || used.has(k)) continue;
    used.add(k); out.push(v.pron);
  }
  return out;
}
// One meaning is enough: the whole typed text, or every part of it split like the gloss, must
// be one of the gloss's alternatives. Rules: docs/PACK_SCHEMA.md "Typed meaning".
function checkGlossTyped(val, en, pack){
  const keys = glossAltKeys(en, pack), v = String(val == null ? "" : val);
  if(keys.has(glossKey(v))) return true;
  // The whole gloss typed as written is right, reading notes and fragments included.
  if(glossKey(v) && glossKey(v) === glossKey(en)) return true;
  const parts = splitTopLevel(v, [";", ","]).map(glossKey).filter(Boolean);
  return parts.length > 0 && parts.every(k => keys.has(k));
}
// Gloss style (docs/PACK_SCHEMA.md "glossStyle", engine default since the flag collapse; owner 2026-10-07: 别 shows its most
// used sense, the others in brackets). Display only; matching keeps the raw gloss.
// The ";"-separated senses of a gloss, reading notes out: the first is the primary one.
function glossSenses(en){
  const a = splitTopLevel(String(en == null ? "" : en).replace(/\s+/g, " ").trim(), [";"]).map(x => x.trim()).filter(x => x && !isPronNote(x));
  return a.length ? { first: a[0], rest: a.slice(1) } : { first: String(en == null ? "" : en).trim(), rest: [] };
}
// The words listed in entry.typedSyn that exist, in list order (the "also:" line).
function typedSynWords(entry, byId){
  return (Array.isArray(entry && entry.typedSyn) ? entry.typedSyn : []).map(id => byId && byId[id]).filter(Boolean);
}
function optsOneScriptOn(pack){ return !!(pack && pack.optsOneScript === true); }
function joinReadings(a, b, pack){
  if(!a) return b; if(!b) return a;
  return tonesOn(pack) && /^[aoe]/i.test(stripMarks(b)) && /[\p{L}]$/u.test(a) ? a + "'" + b : a + b;
}
// A reading is never guessed: other characters get a reading only when the pack opts in with
// pack.characters.compose (each character unit has one reading), else they show written.
function composeSpanReading(text, word, readingOf, pack){
  const t = String(text == null ? "" : text); const w = String((word && word.w) || ""); const wp = String((word && word.pron) || "");
  const cfg = charsConfig(pack); if(!(cfg && cfg.compose)) readingOf = null;
  const raw = []; let i = 0;
  while(i < t.length){
    if(w && wp && t.startsWith(w, i)){ raw.push({ start: i, end: i + w.length, reading: wp }); i += w.length; continue; }
    const cp = t.codePointAt(i); const c = String.fromCodePoint(cp);
    const r = readingOf ? String(readingOf(c) || "") : "";
    raw.push({ start: i, end: i + c.length, reading: r }); i += c.length;
  }
  const out = [];
  raw.forEach(p => {
    const last = out[out.length - 1];
    if(last && !!last.reading === !!p.reading){ last.end = p.end; last.reading = p.reading ? joinReadings(last.reading, p.reading, pack) : ""; }
    else out.push(Object.assign({}, p));
  });
  return out;
}
function spanReadingText(text, word, readingOf, pack){
  const t = String(text == null ? "" : text);
  return composeSpanReading(t, word, readingOf, pack).map(p => p.reading || t.slice(p.start, p.end)).join("");
}

// ------------------------------------------------------------------ legacy migration
// Delimits the section tests/engine_checks.js [10] exempts; keep both banners.
// One-way import of a predecessor app's progress into this pack's shape (design: the
// merge plan in docs/, §4). zh: the hsk trainer's "hsk_pinyin" record. Every hsk release
// (v1, v2, v2.1 sentences, v2.2 characters, v2.3/HEAD path flags) stored v:1 or v:2 and
// only ever added fields, so one reader covers them all. Pure and DOM-free.
//
// Nothing in the old record is discarded silently: every part with no place in prog is
// reported in `unmapped` (acceptance for the real switch: empty). A second run is a no-op.
//
// Caller contract (boot hook and import path, not in this file):
// - Boot: migrate only when pack.legacy is set, storageKey(pack) holds nothing and the
//   legacy key (pack.legacy.key) holds a record. Never write or delete the legacy key.
// - Before the first save of prog, copy the raw legacy string to legacyBackupKey(pack),
//   unless that key already holds something (the first backup is never overwritten).
// - Report a non-empty unmapped list to the learner; those parts survive in the backup.
// - Import: isLegacyRecord() tells a legacy export from native progress.
const LEGACY_DROPPED = ["showChars","dismissedSoundsHint"];
const LEGACY_ONLY_FIELDS = ["showChars","dismissedSoundsHint","c","mixChars","charsAfterHsk4","charsChoiceSeen"];
const NATIVE_ONLY_FIELDS = ["chars","showPron","read"];
function legacyBackupKey(pack){ return `${pack.legacy.key}.bak`; }
function legacyMarker(pack){ return { key: String(pack.legacy.key || ""), format: String(pack.legacy.format || "") }; }
function hasLegacyMarker(data){ return isObj(data) && isObj(data.legacy) && typeof data.legacy.key === "string"; }
function isLegacyRecord(pack, legacyMap, data){
  if(!isObj(pack && pack.legacy) || !isObj(data) || hasLegacyMarker(data)) return false;
  if(NATIVE_ONLY_FIELDS.some(f => data[f] !== undefined)) return false;
  if(data.v === 2 && PROG_VERSION !== 2) return true;
  if(LEGACY_ONLY_FIELDS.some(f => data[f] !== undefined)) return true;
  const known = b => isObj(data[b]) && isObj(legacyMap && legacyMap[b]) && Object.keys(data[b]).some(k => hasOwn(legacyMap[b], k));
  return known("w") || known("s");
}
function migrateLegacy(pack, legacyMap, oldRecord){
  if(!isObj(pack) || !isObj(pack.legacy)) return {ok:false, reason:"pack has no legacy block"};
  let data = oldRecord;
  if(typeof data === "string"){ const p = parseStored(data); if(!p.ok) return p; data = p.data; }
  if(!isObj(data)) return {ok:false, reason:"not a JSON object"};
  const lv = levelIds(pack);
  if(hasLegacyMarker(data)){
    const v = validateProgShape(data, lv); if(!v.ok) return v;
    return {ok:true, already:true, prog: normalizeProg(data, pack), unmapped:[], dropped:[]};
  }
  if(data.v !== undefined && data.v !== 1 && data.v !== 2) return {ok:false, reason:`unknown legacy progress version ${data.v}`};
  const maps = isObj(legacyMap) ? legacyMap : {};
  const unmapped = [], dropped = [];
  const miss = (path, value, reason) => { unmapped.push({path, value, reason}); };
  const cfg = charsConfig(pack);
  const isNum = x => typeof x === "number" && isFinite(x);
  const numOrBool = x => isNum(x) || typeof x === "boolean";
  function recMap(bucket, map, wordFlags){
    const src = data[bucket], dst = {};
    if(src === undefined) return dst;
    if(!isObj(src)){ miss(bucket, src, "not an object"); return dst; }
    const m = isObj(map) ? map : {};
    for(const k of Object.keys(src)){
      const rec = src[k], path = `${bucket}.${k}`;
      if(!hasOwn(m, k)){ miss(path, rec, "key not in the legacy map"); continue; }
      if(!isObj(rec)){ miss(path, rec, "record is not an object"); continue; }
      const id = m[k];
      if(hasOwn(dst, id)){ miss(path, rec, `maps to ${id}, already taken`); continue; }
      const r = {};
      for(const f of Object.keys(rec)){
        const val = rec[f];
        if(["r","w","s"].includes(f)){ if(isNum(val)) r[f] = val; else miss(`${path}.${f}`, val, "not a number"); }
        else if(wordFlags && (f === "prov" || f === "d")){ if(numOrBool(val)) r[f] = val; else miss(`${path}.${f}`, val, "not a number or boolean"); }
        else miss(`${path}.${f}`, val, "unknown record field");
      }
      dst[id] = r;
    }
    return dst;
  }
  const out = { legacy: legacyMarker(pack) };
  const handled = new Set(["v","w","s","c","sets","lessons","sessions","theme","placedOnce","soundsOpened",
    "mixChars","charsAfterHsk4","charsChoiceSeen", ...LEGACY_DROPPED]);
  out.w = recMap("w", maps.w, true);
  out.s = recMap("s", maps.s, false);
  out.sets = {};
  if(data.sets !== undefined){
    if(!isObj(data.sets)) miss("sets", data.sets, "not an object");
    else for(const k of Object.keys(data.sets)){
      const n = data.sets[k];
      if(!lv.includes(k)) miss(`sets.${k}`, n, "not a pack level");
      else if(!Number.isInteger(n) || n < 0) miss(`sets.${k}`, n, "not a non-negative integer");
      else out.sets[k] = n;
    }
  }
  if(data.lessons !== undefined){ if(isObj(data.lessons)) out.lessons = Object.assign({}, data.lessons); else miss("lessons", data.lessons, "not an object"); }
  if(data.sessions !== undefined){ if(isNum(data.sessions)) out.sessions = data.sessions; else miss("sessions", data.sessions, "not a number"); }
  if(data.theme !== undefined){ if(data.theme === null || data.theme === "light" || data.theme === "dark") out.theme = data.theme; else miss("theme", data.theme, "not null, light or dark"); }
  for(const f of ["placedOnce","soundsOpened"]) if(data[f] !== undefined){ if(numOrBool(data[f])) out[f] = data[f]; else miss(f, data[f], "not a boolean or number"); }
  const flagMap = { mixChars:"mix", charsAfterHsk4:"defer", charsChoiceSeen:"choiceSeen" };
  if(cfg){
    out.chars = { v:CHARS_PROG_VERSION, c: recMap("c", maps.c, false) };
    for(const f of Object.keys(flagMap)) if(data[f] !== undefined){ if(typeof data[f] === "boolean") out.chars[flagMap[f]] = data[f]; else miss(f, data[f], "not a boolean"); }
  } else {
    for(const f of ["c", ...Object.keys(flagMap)]) if(data[f] !== undefined) miss(f, data[f], "pack has no characters stage");
  }
  for(const f of LEGACY_DROPPED) if(data[f] !== undefined) dropped.push({path:f, value:data[f]});
  for(const k of Object.keys(data)) if(!handled.has(k)) miss(k, data[k], "unknown field");
  const prog = normalizeProg(out, pack);
  const v = validateProgShape(prog, lv);
  if(!v.ok) return {ok:false, reason:`migrated progress is invalid: ${v.reason}`};
  return {ok:true, already:false, prog, unmapped, dropped};
}

// ------------------------------------------------------------------ export
const API = { shuffle, escapeHtml, gloss, firstTwoWords, normKey,
  levelIds, levelIndexMap, levelLabel, setSizeOf, wordsByLevel, nSets,
  synIds, isSyn, typedSynHit, meaningOpts, wordOpts, gapOpts, sentenceOpts, bareForm, packArticles, articleCut, trailingCut, citationArticles, articleAgreement, visibleArticle, gapGenderOn, GAP_GENDER_MIN, gapChoices, exampleSentences, unitExampleSentences, rubyCovers, highlightParts, searchWords, pronShown, audioSlot, TEST_MIN_WORDS, TEST_MIN_SENTENCES,
  targetLang, fontFamilyOf, fontStackOf, lineHeightOf, fontsHref, scriptDisplay, rtlRuns,
  foldAccents, foldLenientLetters, LENIENT_LETTERS, foldGermanAscii, pointingKey, normalizeTyped, typingEnabled, typingLenientFor, acceptTyped,
  surfaces, sharesSurface, samePron,
  findSurface, textForms, locateWord, packSurfaces, spannedByLonger, gapMatch, gapCandidateIndices, blankSentence,
  strata, placementItemCount, placementEarlyStopAfter, placementNotAsked, placementStopIndex, placementSkipped, applyPlacement, placementCharsOn, charPlanSets, placedCharSets, placedCharsThrough, placedPastFirstBucket, dedupeMisses,
  parseStored, dropUnknownSets, bootProg, lessonItemKey, lessonSayMode, applyImport, todayGates, testGates, listenPlanCount, pickVoice, liveVoice, TTS_TIMING, ttsDriver, CLIP_START_MS, clipStartWatch, speechUsable, isSamsungBrowser, wordAudio, wordSay, packAudio,
  PROG_VERSION, WORD_MASTERED, SENTENCE_MASTERED, storageKey, defaultProg, validateProgShape, normalizeProg,
  SESSION_VERSION, SESSION_MAX_AGE_MS, sessionKey, sessionHash, sessionStale,
  FT_AMBIENT, FT_CORE, FT_PERIPHERAL, wordTier, unitTier, knownBarAt, wordPairs, wordKnown, settleProv, unitDone,
  PATTERN_DONE, PATTERN_OPEN, PATTERN_SHARE, patternsOn, patternCount, patternWords, patternState, patternFirstMeeting, openPatterns, notePattern, patternPick, patternMarkText, patternMarkIndex, patternOpts, patternSentenceIndex, patternStats,
  PAIRS, PAIR_KNOWN, PAIR_HOLD, PAIR_REFRESH, PAIR_OF_KIND, PAIR_OF_TYPED, PAIR_HARD, pairTypedKinds, pairUnitHeld, pairBoot, pairState, notePair, pairOpts, pairKind, pairPick, pairPlan,
  DAY_REFRESH_SHARE, DAY_AGAIN_SHARE, DAY_CONSOLIDATE_SHARE, DAY_TYPED_CONSOLIDATE_SHARE, DAY_RECENT_SESSIONS, DAY_MISS_SHARE, DAY_WEAK_FLOOR, DAY_HELD_SHARE_REVIEW, DAY_HELD_SHARE_RECALL, DAY_HELD_UNIT_SHARE, RECALL_SIZE, RECALL_SIZE_HELD, recallSize, DAY_MISS_MAX_SESSIONS, dayMissKinds, dayWordCan, daySentenceCan, dayAgedOut, dayLog, dayStart, daySessionStart, daySn, noteDay, dayTier, DAY_PRODUCTION, daySettles, daySettlesAt, dayPending, dayPick, dayItemKind, dayPlanKinds, dayPickList, dayWordKinds, dayCharKinds, daySentenceKinds, isoDayNumber,
  markRec, WORD_HOLD, markWordRec, typedWordDue, weakScore, weakFirst, provPick, learnedWords, counterOrder, levelNewSet, nextNewSet, LEVEL_GATE, placedProv, wordKnownP, levelKnownPct, levelGateHold, levelGateNote, nextNewSetOpen, levelExamOn, wordKnownX, knownCtx, settleSetCounter, hearableKinds, pinPrefixRecords, ensureWordRec, currentLevelIndex, availableSentences,
  PRODUCTION_KINDS, MISS_KINDS, applyMissedKinds, markMissKind, REVIEW_SIZE, REVIEW_PRODUCTION_SHARE, kindMix, buildReviewPlan, buildRecallPlan, sentenceKind,
  READ_UNLOCK, READ_WEIGHT, READ_REREAD_DAYS, readState, readingLevels, updateReadUnlocks, suggestPassage, nextReadItem, readPassMode, passageForPass, listenAudioOnly, passageLength, passageSegments,
  gradeQuestion, passageWeakWords, applyWeakWords, markPassageDone, readingStats, readingSpeed, readTimeKeep, passageUnits, progressMapOn, progressMapGoals, progressPosition, goalPosition, goalPositions, currentGoal, GOAL_DONE, recordProgressMap, sessionsToGo, PM_KEEP, sessionsToGoX, levelOpensIn, etaGain, etaKnown, etaCurveAt, etaPlaced, SETTLED, levelSettled, unitAtTarget, progressTotals, progressVisit, progressDeltas, noteProgressVisit, recentMisses, WEEK_SESSIONS,
  CHARS_PROG_VERSION, CHAR_SET_SIZE, CHAR_MASTERED, CHAR_BARE, REVIEW_SIZE_CHARS, CHAR_KINDS, charsConfig,
  BARE_PAIR, BARE_BOOST, bareBoost, bareByPairOn, pairBare, pairJudge, defaultCharsProg, validateCharsShape, normalizeCharsProg, ensureChars, charRecs, markChar, answerCharChoice, setCharOrder, seedCharOrder, charOrder, setCharMode, typedBareOn, TYPED_WRITTEN_KINDS, typedUnitWords, markUnitTyped, bareWord, typedUnitDue,
  unitWord, unitReading, unitGloss, unitHints, hintKey, unitByWord, recordedUnits,
  charStageUnits, rampSetOf, levelChunks, charSets, charSetTaught, nextCharSet, charStages, stagePath, nextStage, lagOn, lagUnits, lagStage, pauseOn, setPause, lagCharSet, lagResume, charsWithWords, learnTurnDone, charsUnlocked, charsStarted, showCharChoice,
  charTier, sentenceTokenTier, rubyTiers, pronFirstOn, displayForm, pronClash, sentencePieces, sentenceDisplay, charOpts, recallCharOpts, charSoundOpts, charReadOpts, charItem, mixPick,
  learnCharPlan, charReviewScore, rankUnified, unifiedReviewPlan, unifiedRecallPlan, todaySnapshot, newCharUnits, charTestPlan, pickWeighted,
  pronUntilPrimerOn, scriptPrimerDone, showPronOn, SCRIPT_PROG_VERSION, SCRIPT_MASTERED, SCRIPT_SETS_PER_SESSION, REVIEW_SIZE_SCRIPT, SCRIPT_KINDS, scriptConfig,
  defaultScriptProg, validateScriptShape, normalizeScriptProg, ensureScript, scriptRecs, scriptSkipped, setScriptSkipped, answerScriptChoice,
  scriptNotice, dismissScriptNotice, markScript, scriptMastered, scriptStageUnits, scriptSets, scriptSetTaught, nextScriptSets, scriptStages,
  recordedScriptUnits, scriptActive, scriptPool, showScriptChoice, scriptKindShape, scriptKindFits, scriptKindFor, pickScriptKind, scriptFamily, SCRIPT_MIN_OPTIONS, scriptGlyph, scriptGlyphKeys, scriptGlyphIn, scriptWordHas, graphemes, shapingClusters, scriptUnitNote, scriptUnitHeadName, searchFold, scriptSecondRight,
  scriptOpts, scriptRomanOpts, scriptExamples, scriptWordOpts, scriptJoinedForms, scriptItem, learnScriptPlan, scriptReviewScore, scriptTestPlan,
  tonesOn, stripMarks, syllableTone, markSyllable, splitSyllable, splitReading, toneHTML, pronTypingOn, pronKey, numberedForms, checkPronTyped, kanaFold, plainPronKey, affixBare, affixAlts, writtenTypedFold, typeSlotKind, joinReadings,
  TYPED_FROM_SIDES, typedFromSides, typedFromOn, typedKinds, typedAmbiguity, typedKindOk, typedSlotKind, splitTopLevel, glossSenses, typedSynWords, parenGroups, parenPieces, isPronNote, glossParts, glossKey, glossAltKeys, checkGlossTyped, pronChoiceOpts, optsOneScriptOn, composeSpanReading, spanReadingText,
  LEGACY_DROPPED, legacyBackupKey, isLegacyRecord, migrateLegacy };
if(typeof module!=="undefined" && module.exports) module.exports = API;
if(root) root.VocabCore = API;
})(typeof window!=="undefined" ? window : (typeof globalThis!=="undefined" ? globalThis : null));
