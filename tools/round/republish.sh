#!/usr/bin/env bash
# Mechanical republish of one language repo on a vocab-engine main sha (steps 1-3 and 5 of the port procedure).
#
#   republish.sh [--dry-run] [-m MESSAGE] [--eta-out DIR] [--allow-gate-fail] [--restart] <site-dir> <engine-sha>
#
# prev -> eta -> bump -> enrich -> jsonify+build -> check.sh -> pack diff guard -> engine controls -> commit.
# Never pushes. The browser check and the live proof stay with a browser worker: the handoff lines are printed last.
# Idempotent: each finished step is recorded in <site>/.cache/round/step-<sha7>.txt and skipped on a rerun, so a
# failure resumes at the failed step (--restart forgets the record). --dry-run does everything but the commit,
# ignores the record, and restores the working tree and the submodule pointer on exit.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DRY=0; MSG=""; ETA_OUT=""; ALLOW_FAIL=0; RESTART=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    -m) MSG="$2"; shift 2 ;;
    --eta-out) ETA_OUT="$(abspath_dir "$2")"; shift 2 ;;
    --allow-gate-fail) ALLOW_FAIL=1; shift ;;
    --restart) RESTART=1; shift ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) break ;;
  esac
done
[ $# -eq 2 ] || die "usage: republish.sh [--dry-run] [-m MESSAGE] [--eta-out DIR] [--allow-gate-fail] [--restart] <site-dir> <engine-sha>"
SITE="$(abspath_dir "$1")"; NAME="$(basename "$SITE")"
FULL="$(git -C "$ENGINE_ROOT" rev-parse --verify "$2^{commit}")" || die "unknown engine sha $2"
SHA7="${FULL:0:7}"
load_site_env "$SITE"
ENGINE_DIR="$SITE/engine"
STATE="$SITE/.cache/round"; mkdir -p "$STATE"
MARK="$STATE/step-$SHA7.txt"; [ "$DRY" = 1 ] && MARK="$STATE/step-dry-$SHA7.txt"
{ [ "$RESTART" = 1 ] || [ "$DRY" = 1 ]; } && : > "$MARK"
[ -f "$MARK" ] || : > "$MARK"
[ -n "$MSG" ] || MSG="typed modes, day-aware scheduling, reading rotation, goals, pairs, frequency tiers, Progress v2, redesigned tabs, session estimates"
CODE="$(site_lang "$SITE")"
LOG="$STATE/republish-$SHA7.log"
cd "$SITE" || exit 1

done_step() { grep -qx "$1" "$MARK"; }
run_step() { # name function
  if done_step "$1"; then say "$NAME: step $1 already done (resume)"; return 0; fi
  say "$NAME: step $1"
  if ! "$2"; then echo; echo "FAILED at step '$1' in $NAME. Fix and rerun the same command: it resumes here. Log: $LOG" >&2; exit 1; fi
  echo "$1" >> "$MARK"
}

# --- dry-run restore ---------------------------------------------------------------------------
UNTRACKED0="$STATE/untracked-before-$SHA7.txt"
restore() {
  cd "$SITE" || return
  say "$NAME: dry run, restoring the working tree and the submodule pointer"
  git checkout -q -- . 2>/dev/null
  git ls-files --others --exclude-standard | sort > "$STATE/untracked-after-$SHA7.txt"
  comm -13 "$UNTRACKED0" "$STATE/untracked-after-$SHA7.txt" | while IFS= read -r f; do rm -f -- "$f"; done
  git submodule update --init --checkout engine > /dev/null 2>&1
  local left; left="$(git status --short --untracked-files=no)"
  if [ -z "$left" ]; then say "$NAME: working tree clean, submodule at $(git ls-tree HEAD engine | awk '{print substr($3,1,7)}')"
  else echo "RESTORE INCOMPLETE:"; echo "$left"; fi
}

# --- steps ---------------------------------------------------------------------------------------
s_preflight() {
  git -C "$ENGINE_ROOT" merge-base --is-ancestor "$FULL" origin/main || { echo "$SHA7 is not on vocab-engine origin/main"; return 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "site has tracked changes; commit or restore them first:"; git status --short --untracked-files=no; return 1; }
  [ -e engine/.git ] || git submodule update --init engine
  [ -z "$(git -C engine status --porcelain --untracked-files=no)" ] || { echo "engine submodule has local changes"; return 1; }
  [ -x "$(command -v "$NODE")" ] || { echo "node missing"; return 1; }
  git ls-files --others --exclude-standard | sort > "$UNTRACKED0"
  grep -q 'enrich --check' check.sh 2>/dev/null || [ "$ETA_MODE" = external ] || echo "WARNING: $NAME/check.sh has no 'packbuilder enrich --check' step (see italian/check.sh); add it in this commit"
  local ahead; ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
  [ "$ahead" = 0 ] || echo "WARNING: site HEAD is $ahead commit(s) ahead of origin/main (a push would carry them)"
}

live_md5() { # url -> md5 of the body, or "unreachable"
  local t="$STATE/live-fetch.tmp"
  if curl -fsS --max-time 40 -o "$t" "$1" 2>/dev/null; then md5f "$t"; else echo unreachable; fi
  rm -f "$t"
}

s_prev() {
  local live remote
  remote="$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)([^/]+)/([^/.]+)(\.git)?#\2/\3#')"
  live="${LIVE_URL:-https://$(echo "${remote%%/*}" | tr 'A-Z' 'a-z').github.io/${remote##*/}/}"
  { echo "site=$NAME"
    echo "prev_head=$(git rev-parse HEAD)"
    echo "prev_submodule=$(git ls-tree HEAD engine | awk '{print $3}')"
    echo "live_url=$live"
    echo "local_index_md5=$(md5f "$PAGE")"; echo "local_sw_md5=$(md5f sw.js)"
    echo "live_index_md5=$(live_md5 "$live$PAGE")"
    echo "live_sw_md5=$(live_md5 "${live}sw.js")"
    echo "recorded=$(date +%Y-%m-%dT%H:%M:%S)"; } > "$STATE/prev.txt"
  sed 's/^/  /' "$STATE/prev.txt"
}
prev_val() { sed -n "s/^$1=//p" "$STATE/prev.txt"; }

s_eta() {
  if [ "$ETA_MODE" = external ]; then echo "eta is external to this site (site.env): no queue verdict needed"; return 0; fi
  local vdir efile verdict etaf
  if [ -n "$ETA_OUT" ]; then vdir="$ETA_OUT/$NAME"; efile="$vdir/eta.json"; else vdir="$SITE/.cache/eta"; efile="$SITE/tools/eta.json"; fi
  verdict="$vdir/verdict.txt"
  [ -f "$verdict" ] || { echo "no queue verdict at $verdict: run tools/round/calibrate_queue.sh for this site first"; return 1; }
  [ -f "$efile" ] || { echo "verdict exists but $efile does not"; return 1; }
  grep -q "sha=$SHA7 " "$verdict" || { echo "verdict was made for another engine sha: $(cut -c1-60 "$verdict")"; return 1; }
  if ! grep -q 'result=OK' "$verdict"; then
    if [ "$ALLOW_FAIL" = 1 ]; then echo "WARNING: queue verdict is not OK, shipping anyway (--allow-gate-fail)"; else echo "queue verdict is not OK: $(cat "$verdict")"; return 1; fi
  fi
  echo "  queue verdict: $(cut -c1-200 "$verdict")"
  etaf="$SITE/tools/eta.json"
  if [ "$efile" != "$etaf" ]; then mkdir -p tools; cp "$efile" "$etaf"; echo "  eta.json copied from $efile"; fi
}

s_bump() {
  local want; want="$(git -C engine rev-parse HEAD)"
  if [ "$want" != "$FULL" ]; then
    git -C engine cat-file -e "$FULL^{commit}" 2>/dev/null || git -C engine fetch -q origin 2>/dev/null
    git -C engine cat-file -e "$FULL^{commit}" 2>/dev/null || git -C engine fetch -q "$ENGINE_ROOT" "$FULL" 2>/dev/null
    git -C engine cat-file -e "$FULL^{commit}" 2>/dev/null || { echo "engine submodule cannot get $SHA7"; return 1; }
    git -C engine checkout -q --detach "$FULL" || return 1
  fi
  echo "  submodule $(prev_val prev_submodule | cut -c1-7) -> $(git -C engine rev-parse --short=7 HEAD)"
}

s_enrich() {
  export SITE ENGINE_DIR PY
  if [ -n "$ENRICH_CMD" ]; then eval "$ENRICH_CMD"
  else PYTHONPATH="$ENGINE_DIR/tools" "$PY" -m packbuilder enrich --lang "$CODE" --repo "$SITE"; fi
}

s_build() {
  "$PY" "$ENGINE_DIR/tools/jsonify_pack.py" pack || return 1
  sh ./build.sh > /dev/null || return 1
  echo "  built: index $(md5f "$PAGE"), sw $(md5f sw.js)"
}

s_check() {
  local out rc fails
  out="$(sh ./check.sh 2>&1)"; rc=$?
  echo "$out" | tail -4
  [ $rc -eq 0 ] && return 0
  # before the commit the stale-build guard also fails on "uncommitted changes": expected, everything else must pass
  fails="$(echo "$out" | grep -c '^FAIL')"
  if [ "$fails" = 1 ] && echo "$out" | grep -q '^FAIL .*uncommitted changes' && ! echo "$out" | grep -q 'is stale'; then
    echo "  check.sh: all stages pass; the only failure is the pre-commit 'uncommitted changes' line (rerun after the commit below)"
    return 0
  fi
  return 1
}

s_guard() {
  local args=(--repo "$SITE" --prev "$(prev_val prev_head)" --word-fields "${PACKDIFF_WORD_FIELDS// /,}" --unit-fields "${PACKDIFF_UNIT_FIELDS// /,}" --pack-keys "${PACKDIFF_PACK_KEYS// /,}" --free-files "${PACKDIFF_FREE_FILES// /,}")
  [ -z "$ENRICH_CMD" ] && args+=(--lang "$CODE" --engine-tools "$ENGINE_DIR/tools")
  "$PY" "$ROUND_DIR/pack_diff_guard.py" "${args[@]}"
}

s_controls() {
  local rc=0 l wt
  wt="$(cd "$VE_MAIN/.." && pwd)/vocab-engine-round-$SHA7"
  # a sibling-level detached worktree of the engine at the sha: the tests read ../<lang>/pack, i.e. this site's new pack
  if [ ! -d "$wt" ]; then git -C "$ENGINE_ROOT" worktree add -q --detach "$wt" "$FULL" || return 1; fi
  [ "$(git -C "$wt" rev-parse HEAD)" = "$FULL" ] || { echo "$wt is not at $SHA7"; return 1; }
  local hsk=""; [ -d "$wt/../chinese" ] || hsk="HSK_DIR=/Users/ishmum/Programming/Voluntary/chinese"
  ctl() { # label cmd...
    l="$1"; shift
    ( cd "$wt" && env $hsk "$NODE" "$@" ) > "$STATE/control-$SHA7-$(echo "$l" | tr ' /' '__').log" 2>&1 \
      && echo "  PASS $l: $(tail -1 "$STATE/control-$SHA7-$(echo "$l" | tr ' /' '__').log" | cut -c1-110)" \
      || { echo "  FAIL $l: see $STATE/control-$SHA7-$(echo "$l" | tr ' /' '__').log"; tail -5 "$STATE/control-$SHA7-$(echo "$l" | tr ' /' '__').log"; rc=1; }
  }
  has() { case " $CONTROLS " in *" $1 "*) return 0 ;; esac; return 1; }
  has flagoff && ctl "flagoff --check" tests/flagoff_snapshot.js --check
  has pack_flags && ctl "pack_flags" tests/pack_flags_checks.js
  has port_sites && ctl "port_sites $NAME" tests/port_sites_checks.js "$NAME"
  echo "  controls run: $CONTROLS"
  [ "$ETA_MODE" = external ] && echo "  eta gate: external (site.env); run tests/eta_checks.js at the sha by hand" || echo "  eta gate: from the queue verdict (s_eta above), not re-simulated"
  return $rc
}

s_commit() {
  local paths=(engine "$PAGE" sw.js pack) p
  [ -f tools/eta.json ] && paths+=(tools/eta.json)
  [ -f check.sh ] && paths+=(check.sh)
  git add -- "${paths[@]}" || return 1
  git commit -q -m "Republish on engine $SHA7: $MSG

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ths81ZpLvu25EMWQJFjzBL" || return 1
  echo "  commit $(git rev-parse --short=7 HEAD)"
  echo "  post-commit check.sh:"
  sh ./check.sh 2>&1 | tail -3
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "  check.sh FAILED after the commit"; return 1; }
}

# --- run -----------------------------------------------------------------------------------------
run_all() {
say "$NAME: republish on engine $SHA7 (lang $CODE)$([ "$DRY" = 1 ] && echo ' [DRY RUN]')"
run_step preflight s_preflight
[ "$DRY" = 1 ] && trap restore EXIT
run_step prev s_prev
run_step eta s_eta
run_step bump s_bump
run_step enrich s_enrich
run_step build s_build
run_step check s_check
run_step guard s_guard
run_step controls s_controls
if [ "$DRY" = 1 ]; then say "$NAME: dry run complete, no commit"
else run_step commit s_commit; fi

SCRATCH="$SITE/.cache/live/round-$SHA7"; mkdir -p "$SCRATCH"
echo
echo "=== HANDOFF for the browser worker ==="
echo "site:            $NAME  ($SITE)"
echo "engine:          $SHA7 (prev submodule $(prev_val prev_submodule | cut -c1-7))"
echo "PREV sha:        $(prev_val prev_head)   (rollback hash)"
echo "prev live md5:   index $(prev_val live_index_md5)  sw $(prev_val live_sw_md5)  (local prev: $(prev_val local_index_md5) / $(prev_val local_sw_md5))"
echo "new local md5:   index $(md5f "$PAGE")  sw $(md5f sw.js)"
echo "prev build:      git -C $SITE show $(prev_val prev_head | cut -c1-7):$PAGE  (and sw.js) for the previous-build serve"
echo "live url:        $(prev_val live_url)"
echo "scratch dir:     $SCRATCH"
if [ "$DRY" = 1 ]; then echo "(dry run: nothing committed)"; trap - EXIT; restore; else echo "(committed locally, NOT pushed)"; fi
}
# the pipeline (not process substitution) keeps this working under `sh` (bash in posix mode on macOS)
run_all 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
