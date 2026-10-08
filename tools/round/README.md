# tools/round/

Scripts for a republish round: bump every language repo onto a vocab-engine main sha without burning worker turns on waiting or on mechanical steps (budget rationale: TODO.md "Standing decisions", worker budget). Run from any checkout of vocab-engine; the sites are the siblings `../<lang>`.

| file | label |
|---|---|
| calibrate_queue.sh | Queue: per site `eta_checks`-style calibration (seeds 5,6,7) then the out-of-sample gate (seeds 8,9,10); writes the site's eta.json, logs and a one-line verdict. |
| etadrv.js | The simulation driver the queue starts (one process per seed, merged afterwards); the same loop and post-processing as `tests/eta_checks.js --pack`. |
| republish.sh | One site, mechanical steps: record PREV, bump the submodule, enrich, jsonify + build, check.sh, pack diff guard, engine controls, commit. Never pushes. |
| pack_diff_guard.py | The guard republish.sh runs: only the allowed pack keys / word fields / unit fields may differ from the committed pack. |
| lib.sh | Shared paths (pinned node, venv python) and the per-site settings loader. |
| sites/<dir>.env | Versioned per-site settings (see "Per-site settings"). |

## 1. Calibrate (one background job, started by the orchestrator)

```sh
cd <vocab-engine checkout at the sha to publish>   # tests/ engine/ tools/packbuilder must be that sha's; the script checks
mkdir -p .cache/round
nohup sh tools/round/calibrate_queue.sh --sessions 600 --engine-sha <sha> \
  ../arabic ../french ../german ... > .cache/round/queue.log 2>&1 &
tail -f .cache/round/queue.log          # one progress line per site and stage
```

- Process cap: 2 sites in parallel x 3 seed processes = 6 (`--sites-parallel`, `--procs`; the product may not exceed 6). The machine has 8 cores and a 7 GB Chrome; 16 GB.
- `--sessions N` calibration sessions per seed (default 600, site.env `ETA_SESSIONS`; japanese needed 400 and its goals 2 and 3 never cross: they ship null). `--gate-sessions N` for the gate (default 400).
- Per site, default layout: `<site>/tools/eta.json` (curve shape, `{curve, knownCurve}`; failed goals and gates are written null), `<site>/.cache/eta/{calibrate.log,gate.log,verdict.txt}` and per-seed runs in `runs-*` there. With `--out DIR` the same files go to `DIR/<site>/` and the repo is untouched.
- `verdict.txt`, one line: `sha=<engine> sessions=<cal>/<gate> result=OK|FAIL cal[goal_1=PASS goal_2=none ... gate=PASS] oos[...] at=<time>`. `none` = no estimate (a goal that never crossed, or fewer than two seeds did). `result=FAIL` = an out-of-sample gate failed (some curve outside +-30% on 2 of 3 seeds).
- Resume: rerun the same command. A site whose verdict carries this sha, whose eta.json exists and is newer than that engine commit is skipped (`--force` redoes it); finished seeds are reused, so an interrupted site continues at its first missing seed. A site with no verdict line is printed as `NO VERDICT` in the final table.
- The simulations run THIS checkout's engine, so `--engine-sha` must describe it (the queue refuses a checkout whose engine/, tests/ or packbuilder differs).

## 2. Republish one site

```sh
sh tools/round/republish.sh [--dry-run] [-m "<message after the colon>"] [--eta-out DIR] [--allow-gate-fail] <site-dir> <engine-sha>
```

Steps (a finished step is recorded in `<site>/.cache/round/step-<sha7>.txt`; rerunning resumes at the failed step, `--restart` forgets the record):

1. preflight: sha on vocab-engine origin/main, site tracked tree clean, submodule clean.
2. prev: `<site>/.cache/round/prev.txt` = site HEAD (the rollback hash), engine submodule sha, live and local md5 of the page and sw.js, live URL.
3. eta: the queue verdict must exist for this sha and say `result=OK` (else stop; `--allow-gate-fail` overrides); the eta.json is copied to `<site>/tools/eta.json` when it came from `--eta-out`. Nothing is re-simulated.
4. bump the engine submodule (fetches from origin, else from this checkout), enrich (`packbuilder enrich`, or the site's `ENRICH_CMD`), jsonify, `./build.sh`, `./check.sh`.
5. pack diff guard against PREV: words and units gain only `ft`, pack.json changes only the spec's `port_flags()` keys + `eta`, every other pack file equal; offending keys are printed and the run stops.
6. engine controls from a sibling-level detached worktree `../vocab-engine-round-<sha7>` (remove it with `git worktree remove` when the round is over): `flagoff_snapshot.js --check`, `pack_flags_checks.js`, `port_sites_checks.js <site>` (the subset is site.env `CONTROLS`). Note `flagoff --check` reads every sibling pack: another worker's uncommitted edit in a sibling repo (seen on spanish) fails it, not a defect of the site being republished.
7. commit `Republish on engine <sha7>: <message>` with the two trailers, by path (engine, page, sw.js, pack, tools/eta.json, check.sh), then `check.sh` again: now fully green. No push.

Before the commit `check.sh` fails its last stage on "uncommitted changes" by design; the script accepts exactly that one line and nothing else.

`--dry-run` runs everything but the commit, ignores the step record, and on exit restores the tracked files (`git checkout -- .`), removes the untracked files it created, moves the submodule back to the recorded pointer and prints whether `git status --short` is empty.

The last output is the handoff for the browser worker: site, engine sha, PREV sha, prev live and local md5s, new local md5s, how to serve the previous build (`git show <PREV>:index.html`), live URL, scratch dir `<site>/.cache/live/round-<sha7>/`.

### What the browser worker does after

Not scripted here. Scratch-site feature check (360x780 touch, light and dark; port-wave4.md step 4), then the owner's push approval or the standing grant (`git merge-base --is-ancestor origin/main HEAD`, push), then the slim live proof (chinese `TODO.md` "Migration policy" item 5: seed byte-equal after boot/reload/Progress, one session, record boots on the previous build and back, 0 console errors, one screenshot) and the proof line in the site's TODO.md.

### Failure semantics

- A failing step prints its output, `FAILED at step '<name>'`, and exits 1; the tree stays as the step left it (commit by path later, never stash). Fix the cause and rerun the same command.
- A guard failure means the pack changed somewhere it should not: stop and report, do not widen the allow lists to pass.
- A dry run that fails still restores the tree.

## Per-site settings

Plain shell, loaded in this order: defaults in `lib.sh` `load_site_env`, `sites/<dirname>.env` (versioned), `<site>/.cache/round/site.env` (local override). Variables: `LANG_CODE`, `ETA_MODE` (`sim` | `external`), `ETA_SESSIONS`, `ETA_GATE_SESSIONS`, `PAGE`, `LIVE_URL`, `ENRICH_CMD`, `CONTROLS`, `PACKDIFF_PACK_KEYS`, `PACKDIFF_WORD_FIELDS`, `PACKDIFF_UNIT_FIELDS`, `PACKDIFF_FREE_FILES`.

Chinese (`sites/chinese.env`): the pack is generated by `tools/pack_from_hsk.py` (not packbuilder), so `ENRICH_CMD` runs it with `--out <site>/pack`; its eta is `tools/zh_eta.json` in the engine (`tests/eta_checks.js --calibrate --write`, by hand, 21 simulations), so `ETA_MODE=external` and the queue and the verdict check skip it; `port_sites` has no chinese row (`CONTROLS="flagoff pack_flags"`). The allowed diff is per round: edit the `PACKDIFF_*` lines to the round's expected pack change (the example lists the eta block, unit hints and attribution).
