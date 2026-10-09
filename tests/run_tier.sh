#!/usr/bin/env bash
# Usage: tests/run_tier.sh fast|full [--area a,b]   (areas: see tests/README.md / CLAUDE.md "Test tiers")
# One summary line per suite, exit 0 only when every suite passes.
set -u
NODE=/Users/ishmum/.nvm/versions/node/v22.22.2/bin/node
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
[ -d "$ROOT/../chinese" ] || export HSK_DIR=/Users/ishmum/Programming/Voluntary/chinese

TIER="${1:-}"; shift || true
AREAS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --area) AREAS="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "$TIER" in fast|full) ;; *) echo "usage: tests/run_tier.sh fast|full [--area a,b]" >&2; exit 2 ;; esac

# suite file | args | areas (comma list; "base" = every fast run, "-" = full only; "port" = run it when core/app/packbuilder enrich changes)
ALL="
pack_flags_checks||base
engine_checks||base
migration_checks||base
export_checks||base
flagoff_snapshot|--check|base
live_lock|--check|base
pron_aids_checks||-
characters_checks||characters
characters_app_checks||characters
typed_mastery_checks||characters
lag_checks||characters
script_checks||-
script_app_checks||-
audio_checks||-
passage_audio_checks||passages
listen_mode_checks||passages
validate_pack_audio_checks||-
validate_pack_characters_checks||-
validate_pack_script_checks||-
validate_pack_spans_checks||-
gloss_display_checks||gloss
typed_from_checks||gloss
words_typed_checks||words
progress_map_checks||progress
progress_view_checks||progress
app_view_checks||progress
eta_checks||progress
pairs_checks||pairs
freq_tiers_checks||pairs
patterns_checks||pairs,patterns
bare_pair_checks||pairs
pause_checks||-
level_gate_checks||pairs
opts_mix_checks||options
session_resume_checks||resume
day_sim_checks||-
help_close_checks||-
gloss_overlap_checks||gloss
port_sites_checks||port
sentence_spans_checks||-
"

want() { # $1 = areas of the suite
  [ "$TIER" = full ] && return 0
  local a
  case ",$1," in *,base,*) return 0 ;; esac
  [ -z "$AREAS" ] && return 1
  for a in $(echo "$AREAS" | tr ',' ' '); do
    case ",$1," in *,"$a",*) return 0 ;; esac
  done
  return 1
}

FAIL=0; TOTAL_START=$(date +%s)
TMP="$(mktemp)"
while IFS='|' read -r NAME ARGS AREA; do
  [ -z "$NAME" ] && continue
  want "$AREA" || continue
  FILE="tests/$NAME.js"
  [ -f "$FILE" ] || { printf '%-28s MISSING\n' "$NAME"; FAIL=1; continue; }
  S=$(date +%s)
  $NODE "$FILE" $ARGS >"$TMP" 2>&1; RC=$?
  E=$(date +%s)
  LINE=$(grep -oE '[0-9]+ passed, [0-9]+ failed' "$TMP" | tail -1)
  P=$(echo "$LINE" | awk '{print $1}')
  F=$(echo "$LINE" | awk '{print $3}')
  if [ -z "$LINE" ] || [ "$RC" -ne 0 ] || [ "$F" != "0" ]; then
    FAIL=1
    printf '%-28s FAIL rc=%s %s passed %s failed %ss\n' "$NAME" "$RC" "${P:-?}" "${F:-?}" "$((E-S))"
    tail -15 "$TMP" | sed 's/^/    /'
  else
    printf '%-28s ok   %s passed %s failed %ss\n' "$NAME" "$P" "$F" "$((E-S))"
  fi
done <<EOT
$ALL
EOT
rm -f "$TMP"
printf 'tier %s: %s, %ss total\n' "$TIER" "$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)" "$(( $(date +%s) - TOTAL_START ))"
exit $FAIL
