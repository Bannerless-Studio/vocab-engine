# vocab-engine: agent notes

Shared engine for the Bannerless-Studio language trainers. End-user docs: README.md. Module maps: engine/README.md, tests/README.md, tools/README.md, tools/packbuilder/README.md, docs/README.md. Backlog and STATUS history: TODO.md.

## Architecture

```
                       ┌──────────────────── vocab-engine (this repo) ────────────────────┐
 engine/core.js ───────┤ pure logic, no DOM (VocabCore); required by tests/*.js too       │
 engine/app.html ──────┤ UI shell; <script src="core.js"> + PACK-BEGIN/PACK-END markers   │
 engine/sw.template.js ┤ service worker template                                          │
                       └──────────────┬───────────────────────────────────────────────────┘
                                      │ build.sh <packdir> <out.html>   (awk only)
  pack/*.json ── tools/jsonify_pack.py ──> pack/*.js (consts) ──┘
                                      ▼
            <out>.html  (one self-contained page, last line <!--ve-build:<cksum>-->)
            sw.js       (template + build id + page name + pack audio.version)

 In-repo pack:   packs/zh, Mandarin HSK 1–4 ported from hsk (now ../chinese): 1193 words, 882 sentences,
                 12 lessons (tools/pack_from_hsk.py; passages via packbuilder) -> dist/zh.html + dist/sw.js
 Language repos: sources (kaikki, Tatoeba, FrequencyWords, wordfreq, corpora)
                 -> tools/packbuilder (langs/<code>.py spec + core stages + qa)
                 -> <lang>/pack/*.json -> jsonify -> pack/*.js
                 -> <lang>/engine/build.sh pack index.html -> index.html + sw.js -> GitHub Pages
                 (engine = this repo as a git submodule at <lang>/engine)
 Browser:        progress in localStorage "vocab_<pack.key>" (+ _invalid/_pre_import/_reset backups);
                 drill in progress in sessionStorage "vocab_<pack.key>_session" (session resume);
                 chinese migrates the old hsk_pinyin record once (core.js migrateLegacy)
 Tests:          tests/*.js boot core.js / a fake-DOM app.html against packs/zh, synthetic
                 fixtures and sibling ../<lang>/pack checkouts; goldens in tests/golden/
```

Why it is built this way (one line each):

- **Single-file build:** every site is one static HTML page on GitHub Pages; no server, no fetches, works offline and from `file://`.
- **Service worker with build marker:** the cache is named by the page's cksum; sw.js caches a page only when it carries this build's marker, so a stale CDN copy is never pinned under a new id.
- **Pron-first for logographic packs (`pronFirst`, zh/ja):** the learner never starts from the written form; a word shows by its reading until its character unit is mastered (user decision 2026-09-25, UX over coding ease).
- **Typed `alt` vs `forms`:** `alt` holds spellings a typed answer accepts; inflected surfaces (Japanese 食べない for 食べる) are never typed targets and go in a separate `forms` field used only to locate the word in text (user decision 2026-09-27; branch engine-ja-forms).
- **Stale-dist guard:** engine_checks rebuilds dist into a scratch file and byte-compares; tools/check_site.sh does the same for a language repo's index.html + sw.js, because a stale sw.js keeps serving an old page.
- **Lenient-fold collision guard:** an answer that matches only after lenient folding is wrong when it spells another pack word (`si` for `sí`, ما for ماء); covers every lenient fold (docs/PACK_SCHEMA.md "Collision guard").
- **Read stage in Today:** passage reading is a skippable Today stage (first not-done passage at an unlocked level, else a spaced re-read) so reading happens without visiting a tab.
- **Listening pass:** a spaced re-read becomes a listening pass (text hidden, half the questions audio-only, done record gains `l:1`) only when every sentence is playable on this device.
- **Pack-gated features:** characters, script primer, tones, audio, typing modes switch on from pack fields only; a pack without them must render byte-identically (flag-off proof).

## Commands (pinned)

Node: `/Users/ishmum/.nvm/versions/node/v22.22.2/bin/node` (written `$NODE` below). Run from the repo root. Expected counts as of 2026-10-01, branch zh-say (main 78d7511 merged).

```sh
$NODE tests/engine_checks.js                     # 703 passed; includes the dist/zh.html + sw.js stale guard
$NODE tests/pron_aids_checks.js                  # 156
$NODE tests/migration_checks.js                  # 292 (hsk_pinyin -> vocab_zh; uses ../chinese when present)
$NODE tests/characters_checks.js                 # 134
$NODE tests/characters_app_checks.js             # 188
$NODE tests/script_checks.js                     # 128
$NODE tests/script_app_checks.js                 # 212
$NODE tests/audio_checks.js                      # 90 (app section needs ../persian)
$NODE tests/passage_audio_checks.js              # 43
$NODE tests/listen_mode_checks.js                # 78
$NODE tests/validate_pack_audio_checks.js        # 30
$NODE tests/validate_pack_characters_checks.js   # 78
$NODE tests/validate_pack_script_checks.js       # 56
$NODE tests/validate_pack_spans_checks.js        # 13
$NODE tests/typed_from_checks.js                 # 67 (pack.typedFrom / glossFocus; control vs ef44c6e)
$NODE tests/session_resume_checks.js             # 67 (drill/passage resume after a tab switch or reload)
$NODE tests/day_sim_checks.js                    # 45 (pack.dayAware: 8 sessions in one day, rollover, 14 days; before/after numbers; --why)
$NODE tests/sentence_spans_checks.js             # 15 (sentence spans flag-off control vs 8ad46d6; ~2 min, reads ../<lang>/pack)
$NODE tests/flagoff_snapshot.js --check          # 26 (reads ../<lang>/pack; drift in a sibling checkout fails it)
$NODE tests/flagoff_snapshot.js --capture        # regenerate tests/golden/ (explained commit only)

./build.sh packs/zh dist/zh.html                 # also writes dist/sw.js
python3 tools/jsonify_pack.py packs/zh           # after editing any packs/zh/*.json
python3 tools/validate_pack.py packs/zh          # schema + referential integrity; fails on stale .js
.venv/bin/python -m pytest tools/packbuilder/tests
python3 -m unittest discover -s tools/packbuilder/tests -t tools   # same suite, stdlib runner
(cd tools && python3 -m packbuilder audio --lang fa --repo ../../persian --check)   # recorded-audio status of a repo
python3 tools/pack_from_hsk.py [../chinese]      # regenerate packs/zh from the hsk data (idempotent)
.cache/venv/bin/python tools/zh_say_scan.py [--write]   # zh polyphone TTS carriers; venv: pip install pypinyin jieba
```

Dev mode without a rebuild: open `engine/app.html?pack=zh` from `file://` (loads `../packs/zh/*.js`); `?packdir=<relative path>` loads a pack elsewhere.

## Always

- Rebuild dist after any change to engine/ or packs/zh: `./build.sh packs/zh dist/zh.html`, then commit dist/zh.html and dist/sw.js with the change.
- Run every tests/*.js suite plus `flagoff_snapshot.js --check` before merging an engine change; paste the counts.
- After any language-repo pack republish, run `flagoff_snapshot.js --check` here; a pack golden that drifted is recaptured with `--capture` in its own commit that names the republish (the goldens read ../<lang>/pack).
- Keep new engine behaviour pack-gated and prove the flag-off path byte-identical (a control check against a pinned sha, as pron_aids and listen_mode do).
- Use one git worktree per branch (`git worktree add ../vocab-engine-<branch> <branch>`); other workers share this checkout.
- Regenerate goldens (`--capture`) only in a commit whose message explains why the output changed.
- Stage by path; other workers leave uncommitted files here (docs/scouts/, langs/*.py in progress).
- Update docs/PACK_SCHEMA.md in the same commit as any pack-field change; it is authoritative.
- Commit a language's `langs/<code>.py` here before bumping that language repo's engine submodule.
- Language repos: commit index.html and sw.js together; bump the submodule only to a vocab-engine main sha.

## Never

- Never use bare `git stash` (it collides with other workers' state); use a worktree.
- Never hand-edit dist/*, packs/*/*.js, or sw.js; they are generated.
- Never put a language-specific condition in core.js or app.html (`if (pack.key === ...)`); add a pack field or a packbuilder hook. The German ASCII fold is the one documented exception (PACK_SCHEMA.md "German ASCII substitutions").
- Never delete a published sw.js; use engine/sw.disable.js.
- Never regenerate goldens to make a failing check pass without explaining the behaviour change.
- Never run build.sh/check.sh inside a language repo you were not asked to touch.

## Forbidden patterns

- Comments that say what the code does. Comments only state why, or cite an external reference (spec section, bug, decision). Code comments are pruned on a later branch; do not add new what-comments.
- Runtime lookups that belong in the build (sentence word ids are resolved at build time).
- Network fetches from the built page other than fonts, recorded audio and tatoeba.org audio.
- Silent progress loss: every destructive write keeps a backup key first (README "Progress backups and recovery").
- Unseeded randomness in tests that compare against goldens (flagoff seeds Math.random with mulberry32).

## Generated files

| file | generated by |
|---|---|
| dist/zh.html, dist/sw.js | build.sh (committed; engine_checks fails when stale) |
| packs/zh/*.js | tools/jsonify_pack.py |
| packs/zh/*.json except passages_src.json, gloss_display.json | tools/pack_from_hsk.py (incl. attribution.json); passages.json + REPORT_passages.md by `packbuilder passages` |
| tools/zh_hints.json | tools/zh_hints.py [../chinese] from the hsk vocabulary + .cache/makemeahanzi/dictionary.txt (`--fetch`) + tools/zh_hints_overrides.json; committed so pack_from_hsk.py needs no network (run it first when the hsk vocabulary gains characters) |
| tools/zh_say.json, docs/ZH_SAY.md | tools/zh_say_scan.py --write (pypinyin + jieba venv; read by pack_from_hsk.py) |
| tests/golden/*.json | tests/flagoff_snapshot.js --capture |
| <lang>/pack/*, index.html, sw.js, tools/REPORT.md | packbuilder, jsonify, build.sh in each language repo |

## Pack essentials

Full reference: docs/PACK_SCHEMA.md.

- Everything language-specific comes from the pack: levels, set size, placement buckets, function words, typing rules, and the TTS locale.
- `pron` is display-only and never drilled on its own.
- Sentence `words` are word ids resolved when the pack is built. There is no runtime lookup.
- Word ids are append-only (each language's tools/id_map_v1.json); renumbering loses learner progress.
