// Per-site ETA driver: the packMode loop of tests/eta_checks.js with each seed in its own process.
// calibrate_queue.sh starts the `--worker <seed>` processes (so it bounds the process count), then runs this without
// --worker once to merge the per-seed files, print the gate verdicts and write --write.
// The merge and gate code is sliced from tests/eta_checks.js packMode; keep them in step.
const E = process.env.VE_ENGINE_DIR || require("path").resolve(__dirname, "..", "..");
const fs = require("fs"), path = require("path"), cp = require("child_process");
const VC = require(E + "/engine/core.js");
const sim = require(E + "/tests/lib/sim_app.js"), EC = require(E + "/tests/lib/eta_curve.js");
const argv = process.argv.slice(2);
const arg = n => argv.includes(n) ? argv[argv.indexOf(n) + 1] : null;
const dir = arg("--pack"), N = +(arg("--sessions") || 240), ACC = 0.85;
const calibrateMode = argv.includes("--calibrate");
const seeds = (arg("--seeds") || (calibrateMode ? "5,6,7" : "8,9,10")).split(",").map(Number);
const D = sim.loadPackDir(dir), P = D.PACK, units = D.CHARACTERS || [], pass = D.PASSAGES || [];
// the level gate share: engine constant since the flag collapse (pack.levelGate before it, for an older engine)
const GATE = VC.LEVEL_GATE || P.levelGate;
const LVS = VC.levelIds(P), BYL = VC.wordsByLevel(D.WORDS, P), goals = VC.progressMapGoals(P);
const start = () => VC.normalizeProg({ placedOnce: true, soundsOpened: true }, P);
const RD = arg("--runsdir");
async function worker(seed){
  const S = sim.createSim(D); const t0 = Date.now(), rows = [];
  await S.playSessions(P, start(), N, seed, ACC, (sn, api) => { const q = api.getProg();
    rows.push({ sn: sn + 1, g: VC.goalPositions(q, P, D.WORDS, units, pass), k: Object.fromEntries(LVS.map(lv => [lv, VC.levelKnownPct(D.WORDS, P, q, lv, units)])), gate: VC.levelGateHold(D.WORDS, P, q, units) }); }, { read: true, patterns: false });
  const tr = goals.map((_, g) => rows.map(r => r.g[g])), holds = EC.holdsOf(rows, GATE);
  const out = `${RD}/seed${seed}.json`;
  fs.writeFileSync(out + ".part", JSON.stringify({ seed, tr, holds: holds.map(h => ({ ks: Array.from(h), prev: h.prev, from: h.from })), secs: Math.round((Date.now() - t0) / 1000), first: rows[0].g, typed: [S.stats.typedMatched, S.stats.typedRight] }));
  fs.renameSync(out + ".part", out);
}
async function main(){
  const t00 = Date.now();
  fs.mkdirSync(RD, { recursive: true });
  await Promise.all(seeds.map(seed => fs.existsSync(`${RD}/seed${seed}.json`) ? null : new Promise((res, rej) => { const c = cp.spawn(process.execPath, [__filename, "--worker", String(seed), ...argv], { stdio: "inherit" }); c.on("exit", code => code ? rej(new Error("worker " + seed + " exit " + code)) : res()); })));
  const runs = seeds.map(seed => JSON.parse(fs.readFileSync(`${RD}/seed${seed}.json`, "utf8")));
  runs.forEach(r => { r.holds = r.holds.map((h, i) => Array.isArray(h) ? Object.assign(h.slice(), { prev: LVS[i], from: undefined }) : Object.assign(h.ks, { prev: h.prev, from: h.from })); });
  for(const r of runs){ const tr = r.tr, holds = r.holds;
    console.log(`seed ${r.seed} (${r.secs} s): goals from ${r.first.map(x => x.toFixed(3)).join("/")} reach ${VC.GOAL_DONE} after ${tr.map(t => { const c = EC.crossOf(t); return c === null ? `>${N}` : c; }).join("/")} sessions; holds ${holds.map(h => `from ${(h[0] * 100).toFixed(1)}% open after ${h.length - 1}`).join(", ") || "none"}; typed asks answered right as intended ${r.typed[0]}/${r.typed[1]}`); }
  const legacyCurve = (g, p0) => { const v = VC.etaGain(P, g); return v == null ? null : [[p0, (VC.GOAL_DONE - p0) / v], [VC.GOAL_DONE, 0]]; };
  const pe = P.eta || {};
  const eta = calibrateMode
    ? { curve: goals.map((_, g) => EC.goalCurve(runs.map(r => r.tr[g]))), knownCurve: EC.knownCurve(runs.flatMap(r => r.holds), GATE) }
    : { curve: Array.isArray(pe.curve) ? pe.curve : goals.map((_, g) => legacyCurve(g, 0)), knownCurve: "knownCurve" in pe ? pe.knownCurve : null, legacyKnown: "knownCurve" in pe ? null : VC.etaKnown(P) };
  const out = { curve: eta.curve.slice(), knownCurve: eta.knownCurve };
  const verdicts = goals.map((_, g) => {
    const v = EC.goalGate(eta.curve[g], runs.map(r => r.tr[g]));
    if(v.ok === false) out.curve[g] = null;
    return Object.assign({ what: `goal ${g + 1}`, curve: eta.curve[g] }, v);
  });
  const kc = eta.knownCurve || (eta.legacyKnown ? h => Math.max(1, Math.ceil((GATE - h[0]) * BYL[h.prev].length / eta.legacyKnown - 1e-9)) : null);
  const kv = EC.knownGate(kc, runs.map(r => r.holds));
  if(kv.ok === false) out.knownCurve = null;
  verdicts.push(Object.assign({ what: "gate", curve: typeof kc === "function" ? [[0, "legacy known " + eta.legacyKnown]] : kc }, kv));
  const fmtA = c => c.map(([x, y]) => `${x}:${typeof y === "number" ? +y.toFixed(1) : y}`).join(" ");
  const fmtC = c => !c ? "null" : Array.isArray(c) ? fmtA(c) : Object.keys(c).map(k => `${k} ${c[k] ? fmtA(c[k]) : "null"}`).join("; ");
  console.log(`${calibrateMode ? "measured" : "pack.eta"}: sessions ${N}, accuracy ${ACC}, seeds ${seeds.join("/")}`);
  verdicts.forEach(v => { console.log(v.ok === null ? `GATE  ${v.what}: no estimate (${calibrateMode ? "fewer than 2 seeds reached it / no hold" : "pack.eta null"})` : `GATE  ${v.what}: ${v.ok ? (v.tail ? "PASS (tail rule)" : "PASS") : calibrateMode ? "FAIL (written null: no estimate shown)" : "FAIL"} within +-${EC.TOL * 100}%; curve ${fmtC(v.curve)}`);
    (v.probes || []).forEach(p => console.log(`        at ${p.q}: ${p.ok ? "pass" : p.tail ? "tail" : "fail"} ${p.per.map(x => x.note).join(" | ")}`)); (v.per || []).forEach(x => console.log(`        ${x.note}`)); });
  console.log(`result: ${JSON.stringify(out)}; wall ${Math.round((Date.now() - t00) / 1000)} s`);
  if(arg("--write")){ fs.writeFileSync(arg("--write"), JSON.stringify(out) + "\n"); console.log(`wrote ${arg("--write")}`); }
  if(!calibrateMode && verdicts.some(v => v.ok === false)) process.exitCode = 1;
}
if(argv[0] === "--worker"){ const seed = +argv[1]; argv.splice(0, 2); process.argv.splice(2, 2); worker(seed).catch(e => { console.error(e); process.exit(1); }); }
else main().catch(e => { console.error(e); process.exit(1); });
