"""Pack keys the engine no longer reads (flag collapse, TODO.md "Flag collapse"): each was identical in all 14 live packs and
is default engine behaviour since its collapse stage (docs/PACK_SCHEMA.md "Flags"). The engine ignores them in a pack.json;
tools/validate_pack.py warns on them, packbuilder enrich drops them, tools/round/pack_diff_guard.py allows their removal.
Mirrors tests/lib/pack_flags.js COLLAPSED, less progressMap (its goals stay pack data)."""

# stage 1: core planning flags (levelGate is the constant LEVEL_GATE 0.7 in engine/core.js)
COLLAPSED = (
    "dayAware", "pairs", "freqTiers", "wordsBy", "levelGate", "pauseNew", "readRotation", "listenQuestions",
    "placementWhole", "placementEarlyStop", "placedRead", "placedKnown", "rereadPerfectDays",
    # stage 2: app v2 (the v2 Today / header / Progress, gloss display, help overlays, read answer block, option mix)
    "appView", "progressView", "glossFocus", "glossStyle", "helpClose", "readAnswerBlock", "optsMix",
    # stage 3: derived flags (pronUntilPrimer = a pack.script pack, placementChars = characters.learn "lag")
    "pronUntilPrimer", "placementChars",
)


def stale_collapsed(pack):
    """The collapsed keys present in a pack.json dict, in COLLAPSED order."""
    return [k for k in COLLAPSED if isinstance(pack, dict) and k in pack]


def drop_collapsed(pack):
    """pack without the collapsed keys (a new dict; the input is untouched)."""
    return {k: v for k, v in pack.items() if k not in COLLAPSED}
