// Core-level Today sim for script-primer units under pack.dayAware (fb46): N Review sessions on one
// simulated day, answers from a seeded model, every "x:" ask measured against the unit's pending miss.
// A miss is settled only by a right answer in its own kind (no script kind is a production kind), so a
// planner that draws the kind at random leaves it pending: "dead" asks (a pending unit asked in a kind
// that cannot settle it) and sessions to settle measure that. Run: node tests/lib/script_day_sim.js
"use strict";
const path = require("path");
const VC = require(path.join(__dirname, "..", "..", "engine", "core.js"));

function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// fx: { pack, words, script: { units } }; shape: "pairs" | "plain" (pack.pairs removed); core: engine to run (default this one).
function runScriptDay(fx, shape, o){
  o = o || {};
  const core = o.core || VC, N = o.sessions || 14, RIGHT = o.right || 0.85, SIZE = o.size || 12, TODAY = "2026-10-08";
  const pk = Object.assign({}, fx.pack, { dayAware: true }); if(shape === "plain") delete pk.pairs; else pk.pairs = true;
  const units = fx.script.units, cfg = core.scriptConfig(pk), rng = mulberry32(o.seed || 7), ans = mulberry32((o.seed || 7) * 7919 + 1);
  const p = core.defaultProg(pk); p.script.skipped = false; p.script.choiceSeen = true; p.sn = 10;
  const seed = mulberry32(99);
  units.forEach(u => { const s = Math.floor(seed() * 5); p.script.u[u.id] = { r: s + 1, w: 0, s, u: 1 + Math.floor(seed() * 9), t: 20000 }; });
  const kctx = { words: fx.words, tts: cfg.tts };
  const st = { pendingAsks: 0, dead: 0, misses: 0, settled: 0, sessionsToSettle: [], sameKindRepeat: 0, items: 0 };
  const open = new Map(), lastKinds = new Map();
  for(let s = 1; s <= N; s++){
    core.dayStart(p, pk, TODAY, true);
    const sn = core.daySn(p);
    const plan = core.buildReviewPlan([], p, pk, { size: SIZE, today: TODAY, rng, canHear: () => true, script: units, scriptCtx: kctx })
      .filter(it => it.unit && core.SCRIPT_KINDS.includes(it.kind));
    plan.forEach(it => {
      const key = "x:" + it.unit.id, mk = core.dayPending(p.day && p.day.a[key], sn);
      st.items++;
      const le = p.day && p.day.a[key];
      if(!mk && le && Array.isArray(le.r) && le.r.includes(it.kind) && typeof le.u === "number" && le.u >= sn - core.DAY_RECENT_SESSIONS) st.sameKindRepeat++;
      if(mk){ st.pendingAsks++; if(!core.daySettles(mk, it.kind)) st.dead++; }
      const ok = ans() < RIGHT;
      core.markScript(p, it.unit.id, ok); core.noteDay(p, pk, TODAY, key, it.kind, ok);
      const after = core.dayPending(p.day.a[key], sn);
      if(!ok && !open.has(key)){ st.misses++; open.set(key, s); }
      else if(open.has(key) && !after){ st.settled++; st.sessionsToSettle.push(s - open.get(key) + 1); open.delete(key); }
      lastKinds.set(key, it.kind);
    });
  }
  st.stillOpen = open.size;
  st.maxToSettle = st.sessionsToSettle.reduce((a, b) => Math.max(a, b), 0);
  st.meanToSettle = st.sessionsToSettle.length ? +(st.sessionsToSettle.reduce((a, b) => a + b, 0) / st.sessionsToSettle.length).toFixed(2) : 0;
  return st;
}
module.exports = { runScriptDay, mulberry32 };

if(require.main === module){
  const fs = require("fs");
  const loadConst = (file, name) => new Function(fs.readFileSync(file, "utf8") + `\nreturn ${name};`)();
  const ROOT = path.join(__dirname, "..", "..");
  for(const lang of ["persian", "arabic", "urdu", "hindi"]){
    const d = path.join(process.env.LANG_REPOS_DIR || path.join(ROOT, ".."), lang, "pack"), f = n => path.join(d, n + ".js");
    if(![f("pack"), f("words"), f("script")].every(x => fs.existsSync(x))) { console.log(lang, "pack absent"); continue; }
    const fx = { pack: loadConst(f("pack"), "PACK"), words: loadConst(f("words"), "WORDS"), script: loadConst(f("script"), "SCRIPT") };
    for(const shape of ["pairs", "plain"]){ const r = runScriptDay(fx, shape); console.log(lang, shape, JSON.stringify(Object.assign({}, r, { sessionsToSettle: undefined }))); }
  }
}
