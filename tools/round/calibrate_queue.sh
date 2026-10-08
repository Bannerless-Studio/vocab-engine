#!/usr/bin/env bash
# Calibration queue: per site, `eta_checks --calibrate` (seeds 5,6,7) then the out-of-sample gate (seeds 8,9,10).
# Simulations never run inside a worker turn: start this as ONE background job and tail its log (README.md).
#
#   calibrate_queue.sh [--sessions N] [--gate-sessions N] [--force] [--out DIR] [--engine-sha SHA]
#                      [--procs N] [--sites-parallel N] <site-dir>...
#
# Per site writes (default layout) <site>/tools/eta.json and <site>/.cache/eta/{calibrate.log,gate.log,verdict.txt};
# with --out DIR the same four files go to DIR/<site>/ and the repo is untouched.
# Process cap: sites-parallel (2) x procs (3) = 6 simulation processes. Resumable: a site with a verdict for this
# engine sha is skipped (and --force redoes it); finished seeds are kept in <cache>/runs-*/ and reused.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

one() {
  local site name cdir etaf verdict sha ct code N GN runs_c runs_g t0 rc cmpl
  site="$(abspath_dir "$1")"; name="$(basename "$site")"
  load_site_env "$site"
  N="${Q_SESSIONS:-$ETA_SESSIONS}"; GN="${Q_GATE_SESSIONS:-$ETA_GATE_SESSIONS}"
  sha="$Q_SHA"
  if [ -n "$Q_OUT" ]; then cdir="$Q_OUT/$name"; etaf="$cdir/eta.json"; else cdir="$site/.cache/eta"; etaf="$site/tools/eta.json"; fi
  mkdir -p "$cdir"; verdict="$cdir/verdict.txt"
  if [ "$ETA_MODE" = external ]; then
    echo "sha=$sha result=EXTERNAL eta is not simulated here (site.env ETA_MODE=external)" > "$verdict"
    say "$name: external eta, nothing to simulate"; return 0
  fi
  ct="$(git -C "$ENGINE_ROOT" log -1 --format=%ct "$sha")"
  if [ "$Q_FORCE" != 1 ] && [ -f "$verdict" ] && [ -f "$etaf" ] && grep -q "sha=$sha " "$verdict" && [ "$(mtime "$etaf")" -gt "$ct" ]; then
    say "$name: skip (eta.json newer than engine $sha; verdict: $(cut -c1-110 "$verdict")). --force redoes it"; return 0
  fi
  code="$(site_lang "$site")"
  runs_c="$cdir/runs-cal-$sha-$N"; runs_g="$cdir/runs-gate-$sha-$GN"
  if [ "$Q_FORCE" = 1 ]; then rm -f "$verdict" "$runs_c/seed5.json" "$runs_c/seed6.json" "$runs_c/seed7.json" "$runs_g/seed8.json" "$runs_g/seed9.json" "$runs_g/seed10.json"; fi
  say "$name: start (lang $code, calibrate $N sessions seeds 5/6/7, gate $GN sessions seeds 8/9/10, $Q_PROCS procs)"
  mkdir -p "$runs_c" "$runs_g"; : > "$cdir/calibrate.log"; : > "$cdir/gate.log"

  # 1. enriched copy of the pack (the repo is read only), then the calibration seeds
  PYTHONPATH="$ENGINE_ROOT/tools" "$PY" -m packbuilder enrich --lang "$code" --repo "$site" --emit "$cdir/pack-cal" > "$cdir/enrich.log" 2>&1 \
    || { echo "enrich failed:"; tail -5 "$cdir/enrich.log"; return 1; }
  sims "$runs_c" 5 6 7 -- "$cdir/pack-cal" --calibrate "$N" "$cdir/calibrate.log" || return 1
  t0=$SECONDS
  "$NODE" "$ROUND_DIR/etadrv.js" --pack "$cdir/pack-cal" --calibrate --sessions "$N" --runsdir "$runs_c" --seeds 5,6,7 --write "$etaf.part" >> "$cdir/calibrate.log" 2>&1 \
    || { echo "calibrate post failed:"; tail -5 "$cdir/calibrate.log"; return 1; }
  mv "$etaf.part" "$etaf"
  say "$name: calibrated -> $etaf ($(grep -c '^GATE' "$cdir/calibrate.log") gates; $(grep '^GATE' "$cdir/calibrate.log" | grep -c FAIL) written null)"

  # 2. gate on the pack carrying the written curves, seeds the curves never saw
  PYTHONPATH="$ENGINE_ROOT/tools" "$PY" -m packbuilder enrich --lang "$code" --repo "$site" --emit "$cdir/pack-gate" >> "$cdir/enrich.log" 2>&1 \
    || { echo "enrich (gate pack) failed"; return 1; }
  "$NODE" -e '
    const fs=require("fs"),[pj, ef]=process.argv.slice(1), p=JSON.parse(fs.readFileSync(pj,"utf8")), e=JSON.parse(fs.readFileSync(ef,"utf8"));
    p.eta={}; for(const k of ["curve","knownCurve","placed","gain","known"]) if(k in e) p.eta[k]=e[k];
    fs.writeFileSync(pj, JSON.stringify(p));' "$cdir/pack-gate/pack.json" "$etaf" || return 1
  sims "$runs_g" 8 9 10 -- "$cdir/pack-gate" --gate "$GN" "$cdir/gate.log" || return 1
  "$NODE" "$ROUND_DIR/etadrv.js" --pack "$cdir/pack-gate" --gate --sessions "$GN" --runsdir "$runs_g" --seeds 8,9,10 >> "$cdir/gate.log" 2>&1
  rc=$?

  # 3. one-line verdict (last: its presence means the site is done)
  cmpl="$(summarize "$cdir/calibrate.log")"
  { printf 'sha=%s sessions=%s/%s result=%s' "$sha" "$N" "$GN" "$([ $rc -eq 0 ] && echo OK || echo FAIL)"
    printf ' cal[%s] oos[%s] at=%s\n' "$cmpl" "$(summarize "$cdir/gate.log")" "$(date +%Y-%m-%dT%H:%M:%S)"; } > "$verdict"
  say "$name: DONE $(cat "$verdict")"
  return 0
}

# summarize LOG -> "goal 1=PASS goal 2=null gate=PASS"
summarize() {
  grep '^GATE' "$1" | sed -E 's/^GATE +([^:]+): ([A-Za-z]+( \(tail rule\))?|no estimate).*/\1=\2/; s/ \(tail rule\)/(tail)/; s/no estimate/none/; s/ /_/g' | tr '\n' ' ' | sed 's/ $//'
}

# sims RUNSDIR SEEDS... -- PACKDIR MODE SESSIONS LOG : the missing seeds as at most Q_PROCS node processes
sims() {
  local runs="$1" seeds="" s; shift
  while [ "$1" != "--" ]; do s="$1"; shift; [ -f "$runs/seed$s.json" ] || seeds="$seeds $s"; done; shift
  local pack="$1" mode="$2" n="$3" log="$4"
  [ -z "$seeds" ] && return 0
  # shellcheck disable=SC2086
  printf '%s\n' $seeds | xargs -P "$Q_PROCS" -I{} "$NODE" "$ROUND_DIR/etadrv.js" --worker {} --pack "$pack" "$mode" --sessions "$n" --runsdir "$runs" >> "$log" 2>&1 \
    || { echo "a simulation worker failed; see $log"; return 1; }
}

if [ "${1:-}" = "--one" ]; then shift; one "$1"; exit $?; fi

Q_SESSIONS=""; Q_GATE_SESSIONS=""; Q_FORCE=0; Q_OUT=""; Q_SHA=""; Q_PROCS=3; PAR=2
while [ $# -gt 0 ]; do
  case "$1" in
    --sessions) Q_SESSIONS="$2"; shift 2 ;;
    --gate-sessions) Q_GATE_SESSIONS="$2"; shift 2 ;;
    --force) Q_FORCE=1; shift ;;
    --out) mkdir -p "$2"; Q_OUT="$(abspath_dir "$2")"; shift 2 ;;
    --engine-sha) Q_SHA="$2"; shift 2 ;;
    --procs) Q_PROCS="$2"; shift 2 ;;
    --sites-parallel) PAR="$2"; shift 2 ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    --) shift; break ;;
    -*) die "unknown option $1" ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || die "usage: calibrate_queue.sh [options] <site-dir>..."
[ "$((PAR * Q_PROCS))" -le 6 ] || die "sites-parallel x procs = $((PAR * Q_PROCS)) > 6 node processes"
head="$(git -C "$ENGINE_ROOT" rev-parse --short=7 HEAD)"
if [ -z "$Q_SHA" ]; then Q_SHA="$head"; else
  Q_SHA="$(git -C "$ENGINE_ROOT" rev-parse --short=7 "$Q_SHA^{commit}")" || die "unknown engine sha"
  # the simulations run THIS checkout's engine/, tests/ and packbuilder: they must be the named sha's
  git -C "$ENGINE_ROOT" diff --quiet "$Q_SHA" HEAD -- engine tests tools/packbuilder tools/jsonify_pack.py \
    || die "this checkout's engine/tests/packbuilder differ from $Q_SHA: run the queue from a checkout of that sha"
fi
git -C "$ENGINE_ROOT" diff --quiet HEAD -- engine tests tools/packbuilder || die "uncommitted changes in engine/tests/packbuilder: the sha would not describe the simulation"
export Q_SESSIONS Q_GATE_SESSIONS Q_FORCE Q_OUT Q_SHA Q_PROCS
say "calibrate queue: engine $Q_SHA, $# site(s), $PAR at a time x $Q_PROCS procs, output ${Q_OUT:-in each site}"
fail=0
printf '%s\n' "$@" | xargs -P "$PAR" -I{} bash "${BASH_SOURCE[0]}" --one {} || fail=$?
say "queue finished (xargs status $fail)"
for s in "$@"; do
  n="$(basename "$s")"; v="${Q_OUT:+$Q_OUT/$n/verdict.txt}"; v="${v:-$s/.cache/eta/verdict.txt}"
  printf '  %-12s %s\n' "$n" "$([ -f "$v" ] && cut -c1-150 "$v" || echo 'NO VERDICT (failed or interrupted; rerun resumes)')"
done
exit "$fail"
