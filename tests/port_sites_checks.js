// Flag-on coverage of the 13 sibling language packs (docs/PACK_SCHEMA.md "enrich"; port plan §2): each pack beside this repo
// (../<lang>/pack, read only) is enriched through `packbuilder enrich --emit` (ft from rank, the generic port flag set), booted in the
// fake-DOM app, and played for 8 Today sessions at 85% right. A site whose checkout is absent is skipped and counted.
// The 7 script-primer sites carry pairs + script (port plan E3: validate_pack accepts it); every check is the same for them.
// Run: node tests/port_sites_checks.js [lang ...]   (e.g. italian swahili)
"use strict";
const fs = require("fs");
const path = require("path");
const sim = require("./lib/sim_app.js");
const { VC, ROOT, clone } = sim;

const SITES = [["arabic", "ar"], ["french", "fr"], ["german", "de"], ["hindi", "hi"], ["indonesian", "id"], ["italian", "it"], ["japanese", "ja"],
  ["korean", "ko"], ["persian", "fa"], ["russian", "ru"], ["spanish", "es"], ["swahili", "sw"], ["urdu", "ur"]];
const SHARE = { A1: 0.10, A2: 0.25, B1: 0.40 };
const SESSIONS = 8, ACC = 0.85;
const only = process.argv.slice(2);
// Language repos sit beside the main vocab-engine checkout; a worktree finds it through git's common dir (LANG_REPOS_DIR overrides).
function reposDir(){
  if(process.env.LANG_REPOS_DIR) return process.env.LANG_REPOS_DIR;
  if(fs.existsSync(path.join(ROOT, "..", "italian"))) return path.join(ROOT, "..");
  try { return path.dirname(path.dirname(require("child_process").execFileSync("git", ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim())); }
  catch(e){ return path.join(ROOT, ".."); }
}
const REPOS = reposDir();

let passes = 0, fails = 0, skipped = 0;
function check(name, cond, extra){
  if(cond){ passes++; console.log(`PASS  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}${extra ? "\n      " + String(extra).replace(/\n/g, "\n      ") : ""}`); }
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Levels 1..upTo taught; the last has exactly `known` words at streak 5, every earlier one all known (tests/eta_checks.js seedLevel).
function seedLevel(D, S, upTo, known){
  const P = D.PACK, LV = VC.levelIds(P), BY = VC.wordsByLevel(D.WORDS, P);
  const p = VC.normalizeProg({ placedOnce: true, soundsOpened: true, sessions: 30 }, P);
  LV.slice(0, upTo).forEach((lv, i) => {
    BY[lv].forEach((w, j) => { const k = i < upTo - 1 || j < known; p.w[w.id] = { r: k ? 6 : 1, w: 0, s: k ? 5 : 0, t: S.DAY_N - 1 - (j % 9) }; });
    p.sets[lv] = VC.nSets(BY[lv], VC.setSizeOf(P));
  });
  if(p.chars) p.chars.choiceSeen = true;
  return p;
}

async function site(dirName, code){
  const repo = path.join(REPOS, dirName);
  if(!fs.existsSync(path.join(repo, "pack", "words.json"))){ skipped++; console.log(`SKIP  ${code}: ${repo}/pack not found`); return; }
  console.log(`\n[${code}] ${dirName}`);
  let E;
  try { E = sim.enrichedDir(code, repo); } catch(e){ check(`${code}: packbuilder enrich --emit`, false, e.stderr || e.message); return; }
  const D = sim.loadPackDir(E.dir), P = D.PACK, S = sim.createSim(D), units = D.CHARACTERS || [];
  const LV = VC.levelIds(P), BY = VC.wordsByLevel(D.WORDS, P);
  const orig = JSON.parse(fs.readFileSync(path.join(repo, "pack", "words.json"), "utf8"));
  // wave 1 sites commit tools/eta.json (enrich copies it); later waves do not yet, so every ETA assertion branches on the file
  const etaFile = path.join(repo, "tools", "eta.json");
  const shipped = fs.existsSync(etaFile) ? JSON.parse(fs.readFileSync(etaFile, "utf8")) : null;

  // enrich output
  const ftOk = D.WORDS.every(w => w.ft === 0 || w.ft === 1 || w.ft === 2) && D.WORDS.length === orig.length && D.WORDS.every((w, i) => w.id === orig[i].id);
  check(`${code}: ft on every word (0/1/2), word order and ids as shipped`, ftOk);
  const cnt = lv => [0, 1, 2].map(t => BY[lv].filter(w => w.ft === t).length);
  const periph = LV.map(lv => cnt(lv)[2]), want = LV.map(lv => Math.floor((SHARE[lv] || 0) * BY[lv].length + 0.5));
  check(`${code}: tiers per level [ambient core peripheral] ${LV.map(lv => `${lv} ${cnt(lv)}`).join("  ")}; peripheral = ${want.join("/")}`, JSON.stringify(periph) === JSON.stringify(want) && D.WORDS.filter(w => w.ft === 0).every(w => w.rank <= 100));
  if(units.length) check(`${code}: unit ft = lowest ft of its words (${units.length} units)`, units.every(u => u.ft === Math.min(...u.words.map(i => S.BY_ID[i].ft))));
  const flags = ["dayAware", "glossFocus", "helpClose", "readAnswerBlock", "optsMix", "pauseNew", "readRotation", "pairs", "freqTiers"];
  check(`${code}: generic flag set (typedFrom ${JSON.stringify(P.typedFrom)}, goals ${P.progressMap && P.progressMap.goals.map(g => g.upTo)}, levelGate ${P.levelGate})`,
    flags.every(k => P[k] === true) && P.glossStyle === "primary" && P.wordsBy === "typed" && P.listenQuestions === "all" && P.progressView === "v2" && P.appView === "v2" && P.levelGate === 0.7
    && JSON.stringify(P.typedFrom) === JSON.stringify(code === "ja" ? ["written", "pron"] : ["written"]) && P.progressMap.goals.length === 3 && !P.levelExam && (code === "ja" || !P.characters));
  check(`${code}: engine reads pairs, freqTiers, levelGate, progressView, appView as on`, VC.pairsOn(P) && VC.freqTiersOn(P) && VC.levelGateOn(P) && VC.progressViewOn(P) && VC.appViewOn(P));

  const val = require("child_process").spawnSync("python3", [path.join(ROOT, "tools", "validate_pack.py"), E.dir], { encoding: "utf8" });
  const errs = (val.stdout + val.stderr).split("\n").filter(l => /^ERROR/.test(l));
  check(`${code}: validate_pack passes${P.script ? " (pairs + script, port plan E3)" : ""} (${errs.length} errors)`, errs.length === 0 && val.status === 0, errs.join("\n"));

  // known: the tier's bar (peripheral 2, else 3) on every pair the word reads
  const pw = lv => BY[lv].find(w => w.ft === 2) && BY[lv].find(w => w.ft === 1);
  const lv0 = LV.find(pw) || LV[0], wp = BY[lv0].find(w => w.ft === 2), wc = BY[lv0].find(w => w.ft === 1);
  const recAt = (w, n) => ({ r: 6, w: 0, s: 2, p: Object.fromEntries(VC.wordPairs(w, P).map(k => [k, [n, 3]])) });
  check(`${code}: known is ft-based: a pair streak of 2 is known for a peripheral word (${wp.w}), not for a core word (${wc.w}); 3 for both`,
    VC.wordKnown(recAt(wp, 2), wp, P) && !VC.wordKnown(recAt(wc, 2), wc, P) && VC.wordKnown(recAt(wc, 3), wc, P) && !VC.wordKnown(recAt(wp, 1), wp, P));

  // 8 Today sessions
  let api = null, err = null, t0 = Date.now();
  try { api = await S.playSessions(P, null, SESSIONS, 5, ACC, null, { read: true }); } catch(e){ err = e; }
  check(`${code}: ${SESSIONS} Today sessions at ${ACC * 100}% run without throwing (${Math.round((Date.now() - t0) / 1000)} s)`, !err, err && (err.stack || err.message));
  if(err) return;
  if(P.script){
    let serr = null, sapi = null;
    try { sapi = await S.playSessions(P, null, 3, 7, ACC, null, { read: true, script: "learn" }); } catch(e){ serr = e; }
    const sp = sapi && sapi.getProg();
    check(`${code}: 3 Today sessions learning the script first run without throwing (script ${sp && sp.script ? JSON.stringify(Object.keys(sp.script)) : "-"}, ${sp ? Object.keys(sp.w).length : 0} words)`, !serr, serr && (serr.stack || serr.message));
  }
  const prog = api.getProg(), recs = Object.values(prog.w);
  check(`${code}: sessions counted (sn ${prog.sn}), ${recs.length} words recorded`, prog.sn === SESSIONS && recs.length >= SESSIONS * 8);
  const withP = recs.filter(r => r.p && Object.keys(r.p).length >= 1).length;
  check(`${code}: pair streaks p written on answers (${withP} of ${recs.length} records)`, withP >= recs.length * 0.9);
  check(`${code}: typed asks answered as intended (${S.stats.typedMatched} of ${S.stats.typedRight}; the sim finds the accepted string through the item's own check)`, S.stats.typedRight === 0 || S.stats.typedMatched / S.stats.typedRight >= 0.8);
  // render: Today, Progress, Read, v2 chrome markers
  const T = await S.bootWith(P, clone(prog), 3, { passages: D.PASSAGES });
  const th = T.panel();
  check(`${code}: Today renders: anchor "Session ${SESSIONS + 1}", Start, data-appview v2 on <html>`, th.includes(`Session ${SESSIONS + 1}`) && /id="go"/.test(th) && T.doc.documentElement.getAttribute("data-appview") === "v2", th.slice(0, 300));
  check(`${code}: Today has the goal component (Goal 1 of 3) and no placeholder`, /Goal 1 of 3/.test(th) && !/pace: —/.test(th) && !/undefined|NaN/.test(th));
  T.clickTab("progress"); const ph = T.panel();
  check(`${code}: Progress v2 renders: goal line, level rows, no undefined/NaN`, /Goal 1 of 3/.test(ph) && /class="pvn"/.test(ph) && !/undefined|NaN/.test(ph) && ph.includes(LV[0]), ph.slice(0, 300));
  T.clickTab("read"); const rh = T.panel();
  check(`${code}: Read tab renders (${D.PASSAGES.length} passages; A1 locked until 70% of its words are learned)`, rh.length > 300 && /passages open at 70%/.test(rh) && !/undefined|NaN/.test(rh), rh.slice(0, 300));
  // Read stage: A1 taught to 80%, so its passages are open; 3 sessions read, then the list names a done passage
  const rp = seedLevel(D, S, 1, Math.ceil(0.8 * BY[LV[0]].length));
  let rerr = null, R = null;
  try { R = await S.playSessions(P, rp, 3, 6, ACC, null, { read: true }); } catch(e){ rerr = e; }
  check(`${code}: 3 sessions from an A1-open record run, the Read stage included`, !rerr, rerr && (rerr.stack || rerr.message));
  if(!rerr){
    const rd = (R.getProg().read && R.getProg().read.done) || {}, ids = Object.keys(rd);
    check(`${code}: reading passes recorded (${ids.length} passage(s) done, each with a score and a day)`, ids.length >= 1 && ids.every(i => rd[i].sc !== undefined && rd[i].d));
    const RL = await S.bootWith(P, clone(R.getProg()), 4, { passages: D.PASSAGES });
    RL.clickTab("read"); const lh = RL.panel(), rm = lh.match(/class="pvn">(\d+) of (\d+) read</);
    check(`${code}: Read tab lists the open level's passages and counts the done ones (${rm ? rm[0].replace(/.*">/, "").replace("<", "") : "-"})`, !!rm && +rm[1] >= 1 && lh.includes('data-pid="') && !/undefined|NaN/.test(lh), lh.slice(0, 400));
  }

  // gate: A1 taught and half known: A2 waits; the sentence is the same on Today and Progress
  const gp = seedLevel(D, S, 1, Math.ceil(0.5 * BY[LV[0]].length));
  const hold = VC.levelGateHold(D.WORDS, P, gp, units);
  const G = await S.bootWith(P, gp, 2, { passages: D.PASSAGES });
  const gs = G.gate(), gth = G.panel(); G.clickTab("progress");
  check(`${code}: gate holds ${LV[1]} at ${hold && hold.pct}% of ${LV[0]}: sentence "${gs}" on Today and Progress, Learn teaches no ${LV[1]} word`,
    !!hold && hold.lv === LV[1] && (shipped ? /^\S+ opens at 70% of \S+ known\. Now \d+%, ≈\s\d+ sessions?\.$/.test(gs) : /^\S+ opens at 70% of \S+ known\. Now \d+%\.$/.test(gs) && !gs.includes("≈")) && gth.includes(esc(gs)) && G.panel().includes(esc(gs)) && VC.nextNewSetOpen(D.WORDS, P, gp, units) === null, gth.slice(0, 300));
  const open = seedLevel(D, S, 1, Math.ceil(0.7 * BY[LV[0]].length) + 3);
  check(`${code}: gate open at 70%: no hold, no sentence`, VC.levelGateHold(D.WORDS, P, open, units) === null && (await S.bootWith(P, open, 2, { passages: D.PASSAGES })).gate() === null);

  // ETA: the enriched pack carries no estimate (no tools/eta.json: eta = all null, never zh's pace); measured values show one
  const goalsN = VC.progressMapGoals(P).length, fresh = VC.normalizeProg({ placedOnce: true }, P);
  const cg = VC.currentGoal(fresh, P, D.WORDS, units, D.PASSAGES), ctx = { pack: P, words: D.WORDS, units, passages: D.PASSAGES };
  const allNull = !!P.eta && P.eta.gain.length === goalsN && P.eta.gain.every(v => v === null) && P.eta.known === null;
  const gateEst = VC.levelOpensIn(D.WORDS, P, gp, units), goalEst = Array.from({ length: goalsN }, (_, g) => VC.sessionsToGoX({}, g, goalsN, ctx));
  const freshPanel = (await S.bootWith(P, fresh, 1, { passages: D.PASSAGES })).panel();
  if(shipped) check(`${code}: tools/eta.json shipped: pack eta = the committed file (${JSON.stringify(P.eta)}), finite goal ${goalEst[0]} and gate ${gateEst} estimates, gate sentence carries "≈ N sessions"`,
    !!P.eta && JSON.stringify(P.eta.gain) === JSON.stringify(shipped.gain) && P.eta.known === shipped.known && P.eta.gain.length === goalsN
    && Number.isFinite(goalEst[0]) && Number.isFinite(gateEst) && /≈\s\d+ sessions?\./.test(gs) && freshPanel.includes("≈"));
  else check(`${code}: enriched eta without tools/eta.json = ${JSON.stringify(P.eta)}: no goal estimate (goal ${cg && cg.i + 1}), no gate estimate, Today / Progress carry no "≈"`,
    allNull && goalEst.every(v => v === null) && gateEst === null && !freshPanel.includes("≈"));
  const withEta = Object.assign(clone(P), { eta: { gain: [0.01, null, 0.02], known: null } });
  const ctx2 = Object.assign({}, ctx, { pack: withEta });
  const measured = Object.assign(clone(P), { eta: { gain: [0.01, 0.01, 0.01], known: 5 } });
  check(`${code}: measured eta -> estimates (goal ${VC.sessionsToGoX({}, 0, goalsN, Object.assign({}, ctx, { pack: measured }))}, gate ${VC.levelOpensIn(D.WORDS, measured, gp, units)}); null gain / known -> none; eta key absent -> the zh constants`,
    Number.isFinite(VC.sessionsToGoX({}, 0, goalsN, Object.assign({}, ctx, { pack: measured }))) && VC.levelOpensIn(D.WORDS, measured, gp, units) >= 1
    && VC.sessionsToGoX({}, 0, 3, ctx2) !== null && VC.sessionsToGoX({}, 1, 3, ctx2) === null && VC.levelOpensIn(D.WORDS, withEta, gp, units) === null
    && Number.isFinite(VC.sessionsToGoX({}, 0, goalsN, Object.assign({}, ctx, { pack: (({ eta, ...rest }) => rest)(P) }))));
  const M = await S.bootWith(measured, gp, 2, { passages: D.PASSAGES });
  check(`${code}: gate sentence with a measured estimate ends "≈ N sessions"`, /^\S+ opens at 70% of \S+ known\. Now \d+%, ≈ \d+ sessions?\.$/.test(M.gate()), M.gate());
  const N = await S.bootWith(withEta, gp, 2, { passages: D.PASSAGES });
  check(`${code}: gate sentence without an estimate ends "Now N%."`, /^\S+ opens at 70% of \S+ known\. Now \d+%\.$/.test(N.gate()), N.gate());
}

(async () => {
  for(const [d, c] of SITES){ if(only.length && !only.includes(d) && !only.includes(c)) continue; await site(d, c); }
  console.log(`\n${skipped ? skipped + " site(s) skipped (checkout absent)\n" : ""}${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
