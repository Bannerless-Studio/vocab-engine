# Sourced by calibrate_queue.sh and republish.sh. See README.md.
NODE="${NODE:-/Users/ishmum/.nvm/versions/node/v22.22.2/bin/node}"
VE_MAIN="${VE_MAIN:-/Users/ishmum/Programming/Voluntary/vocab-engine}"
ROUND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$ROUND_DIR/../.." && pwd)"
# worktrees carry no .venv: take the main checkout's
PYBIN="$VE_MAIN/.venv/bin"
[ -x "$PYBIN/python" ] || PYBIN="$ENGINE_ROOT/.venv/bin"
export PATH="$(dirname "$NODE"):$PYBIN:$PATH"
PY="$PYBIN/python"; [ -x "$PY" ] || PY=python3

say() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
md5f() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
abspath_dir() { (cd "$1" 2>/dev/null && pwd) || die "no such directory: $1"; }
mtime() { /usr/bin/stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }

# Per-site settings. Defaults first, then tools/round/sites/<dirname>.env (versioned), then
# <site>/.cache/round/site.env (local override). Never branch on a site name in the scripts.
load_site_env() {
  local site="$1" name f
  name="$(basename "$site")"
  LANG_CODE=""            # packbuilder language code; default: "key" of pack/pack.json
  ETA_MODE="sim"          # sim = calibrate_queue simulates; external = the eta lives elsewhere (chinese: tools/zh_eta.json in the engine)
  ETA_SESSIONS=600        # calibration sessions per seed
  ETA_GATE_SESSIONS=400   # out-of-sample gate sessions per seed
  PAGE="index.html"
  LIVE_URL=""             # default: https://<org>.github.io/<repo>/ from the origin remote
  ENRICH_CMD=""           # default: packbuilder enrich; eval'd with SITE, ENGINE_DIR, PY in scope
  CONTROLS="flagoff pack_flags port_sites"  # engine controls republish.sh runs (port_sites: packs produced by enrich only)
  PACKDIFF_PACK_KEYS=""   # extra pack.json top-level keys allowed to change (default: the spec's port_flags + eta)
  PACKDIFF_WORD_FIELDS="ft"
  PACKDIFF_UNIT_FIELDS="ft"
  PACKDIFF_FREE_FILES=""  # comma list of pack json files allowed to change freely
  for f in "$ROUND_DIR/sites/$name.env" "$site/.cache/round/site.env"; do
    # shellcheck disable=SC1090
    [ -f "$f" ] && . "$f"
  done
  return 0
}

site_lang() { # $1 site
  if [ -n "$LANG_CODE" ]; then echo "$LANG_CODE"; return; fi
  "$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]+"/pack/pack.json"))["key"])' "$1"
}
