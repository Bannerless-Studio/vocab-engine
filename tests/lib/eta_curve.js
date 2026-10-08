// pack.eta curves from simulated runs (docs/PACK_SCHEMA.md "ETA model"; fb42). A trace is one run's goal position per
// session, index 0 = before session 1; a hold is one run's known share of the waiting level's predecessor from the
// first session the gate holds through the first session it is open.
"use strict";
const path = require("path");
const VC = require(path.join(__dirname, "..", "..", "engine", "core.js"));
const TOL = 0.30, PROBES = [0, 0.25, 0.5, 0.75];
const firstAt = (xs, x) => { if(x <= xs[0]) return 0; const i = xs.findIndex(v => v >= x - 1e-9); return i < 0 ? null : i; };
const crossOf = xs => { const i = xs.findIndex(v => v >= VC.GOAL_DONE); return i < 0 ? null : i; };
const r2 = x => Math.round(x * 100) / 100, r1 = x => Math.round(x * 10) / 10;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
// Arithmetic mean over the runs at each grid position; a goal fewer than 2 runs cross is null (no estimate).
function goalCurve(traces){
  const ok = traces.filter(t => crossOf(t) !== null);
  if(ok.length < 2) return null;
  const grid = []; for(let i = 0; i * 0.05 < VC.GOAL_DONE - 1e-9; i++) grid.push(r2(i * 0.05));
  const pts = grid.map(x => [x, r1(mean(ok.map(t => crossOf(t) - firstAt(t, x))))]);
  pts.push([VC.GOAL_DONE, 0]);
  return pts;
}
// holds: arrays of the known share (each with .prev); gate = pack.levelGate. One curve per waiting level's predecessor,
// from at least 2 holds; null when no level has 2.
function knownCurve(holds, gate){
  const by = {};
  holds.forEach(h => { (by[h.prev] = by[h.prev] || []).push(h); });
  const out = {};
  Object.keys(by).forEach(lv => { const hs = by[lv];
    if(hs.length < 2){ out[lv] = null; return; }
    const grid = []; for(let i = 0; i * 0.05 < gate - 1e-9; i++) grid.push(r2(i * 0.05));
    out[lv] = grid.map(x => [x, r1(mean(hs.map(h => (h.length - 1) - (firstAt(h, x) === null ? h.length - 1 : firstAt(h, x)))))]).concat([[gate, 0]]); });
  return Object.values(out).some(Boolean) ? out : null;
}
// Holds of one run from per-session rows {gate: {prev} | null, k: {[level]: share}}; rows[0] = before session 1.
function holdsOf(rows, gate){
  const out = []; let h = null;
  rows.forEach((r, i) => {
    if(r.gate && !h) h = { prev: r.gate.prev, ks: [], from: i };
    if(h) h.ks.push(r.k[h.prev]);
    if(!r.gate && h){ if(h.ks[0] < gate - 0.01 && h.ks.length > 1) out.push(Object.assign(h.ks, { prev: h.prev, from: h.from })); h = null; }
  });
  return out;
}
const est = (curve, x) => { const v = VC.etaCurveAt(curve, x); return v === null ? null : Math.max(1, Math.ceil(v - 1e-9)); };
// Out-of-sample check of a goal curve: at each probe position, the estimate at the run's actual position there vs the
// sessions it still needed, within TOL on at least 2 of the runs at every probe.
function goalGate(curve, traces){
  if(!curve) return { ok: null, probes: [] };
  const probes = PROBES.map(q => {
    const per = traces.map(t => { const c = crossOf(t); if(c === null) return { ok: false, note: "no crossing" };
      const i = firstAt(t, q); const e = est(curve, t[i]), a = Math.max(1, c - i), err = (e - a) / a;
      return { ok: Math.abs(err) <= TOL, note: `${e} vs ${a} (${Math.round(err * 100)}%)` }; });
    return { q, ok: per.filter(x => x.ok).length >= 2, per };
  });
  return { ok: probes.every(p => p.ok), probes };
}
// Every completed hold of a run whose level has a curve, estimated from its first held session, within TOL; at least 2
// runs. `curve` may be a function hold -> estimate (a legacy scalar `known`).
function knownGate(curve, runsHolds){
  if(!curve) return { ok: null, per: [] };
  const at = typeof curve === "function" ? curve : h => est(curve[h.prev], h[0]);
  const per = runsHolds.map(hs => {
    const e = hs.map(h => ({ lv: h.prev, v: at(h), a: h.length - 1 })).filter(x => x.v !== null).map(x => Object.assign(x, { err: (x.v - x.a) / x.a }));
    if(!e.length) return { ok: false, note: "no completed hold" };
    return { ok: e.every(x => Math.abs(x.err) <= TOL), note: e.map(x => `${x.lv}: ${x.v} vs ${x.a} (${Math.round(x.err * 100)}%)`).join(", ") }; });
  return { ok: per.filter(x => x.ok).length >= 2, per };
}
module.exports = { TOL, PROBES, goalCurve, knownCurve, holdsOf, goalGate, knownGate, crossOf, firstAt, est };
