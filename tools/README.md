# tools/

Build-time helpers for packs and sites. Language repos call them as `engine/tools/...`. Commands: CLAUDE.md "Commands".

| file | label |
|---|---|
| jsonify_pack.py | Generator: a pack's `*.json` -> `*.js` consts that build.sh inlines. Run after every pack JSON edit. |
| validate_pack.py | Gate: schema and referential integrity against docs/PACK_SCHEMA.md; fails when the `.js` files are stale. |
| check_site.sh | Stale-build guard for a language repo: rebuilds into a private temp dir, compares index.html and sw.js, checks both are committed. One line in each language repo's check.sh: `sh engine/tools/check_site.sh pack`. |
| pack_from_hsk.py | One-off, reproducible converter from the hsk (now ../chinese) data to packs/zh, incl. characters.json (with `hint` from zh_hints.json), legacy.json and attribution.json. Idempotent. |
| zh_hints.py | Generator: tools/zh_hints.json, one character memory hint (or null) per distinct character of packs/zh/characters.json, by template from Make Me a Hanzi dictionary.txt (pinned commit + sha256; `--fetch` downloads it into .cache/makemeahanzi/). The JSON is committed, so pack_from_hsk.py rebuilds without the network. Rerun after the pack gains characters. |
| diff_hsk_migration.js | Acceptance evidence for the hsk_pinyin -> vocab_zh migration: migrates an hsk export and prints per-record counts and totals (docs/HSK_MERGE.md §4). |
| tts_probe.html | Dev-only, self-contained, no-network TTS probe for the script primer (docs/SCRIPT_PRIMER.md §5, brief S0): ear-check which browser voices can say the primer units. |
| packbuilder/ | Shared corpus-based pack builder for language repos. See its README.md; hook reference in docs/PACKBUILDER_HOOKS.md. |

Language repos add their own `tools/` (build_pack.py shim, gloss_overrides.json, forced_a1.txt, bad_sentences.txt, id_map_v1.json, passages_src.json, REPORT.md); the contract is in packbuilder/README.md "Language repo contract".
