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
                 12 lessons, 75 passages 15/15/20/25 (tools/pack_from_hsk.py; passages via packbuilder) -> dist/zh.html + dist/sw.js
 Language repos: sources (kaikki, Tatoeba, FrequencyWords, wordfreq, corpora)
                 -> tools/packbuilder (langs/<code>.py spec + core stages + qa)
                 -> <lang>/pack/*.json -> jsonify -> pack/*.js
                 -> <lang>/engine/build.sh pack index.html -> index.html + sw.js -> GitHub Pages
                 (engine = this repo as a git submodule at <lang>/engine)
 Browser:        progress in localStorage "vocab_<pack.key>" (+ _invalid/_pre_import/_reset backups);
                 drill in progress in localStorage "vocab_<pack.key>_session" (session resume, one per app tab);
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
- **Read rotation (`readRotation`, zh):** no day gates; reading and listening passes alternate by pass with random picks and shuffled questions, because 60 passages can fit in one day (owner 2026-10-03).
- **Listening pass:** a spaced re-read becomes a listening pass (text hidden, half the questions audio-only, done record gains `l:1`) only when every sentence is playable on this device.
- **Pack-gated features:** characters, script primer, tones, audio, typing modes switch on from pack fields only; a pack without them must render byte-identically (flag-off proof).

## Commands (pinned)

Node: `/Users/ishmum/.nvm/versions/node/v22.22.2/bin/node` (written `$NODE` below). Run from the repo root. Expected counts as of 2026-10-07, main after w33 (8604b17 + fb40a + fb40b).

```sh
$NODE tests/pack_flags_checks.js                 # 16 (tests/lib/pack_flags.js: FLAG_SINCE covers every zh pack flag and every flag a suite strips, shas are ancestors of HEAD, packAsOf matches the committed zh pack flag set at 52 probed commits)
$NODE tests/engine_checks.js                     # 704 passed; includes the dist/zh.html + sw.js stale guard and the packs/zh generator drift check from an empty dir (needs ../chinese, or HSK_DIR=<chinese checkout>)
$NODE tests/pron_aids_checks.js                  # 158
$NODE tests/migration_checks.js                  # 446 (hsk_pinyin -> vocab_zh; uses ../chinese when present; [bare5] zh bare 6 -> 5; [rotation-s] read.done s/ls; [wordsBy] records read on a8e9c08; [progressMap] prog.pm both directions vs a2f2426; fb22 entries with g vs a2f2426 and 2412992; [f] records with f boot on 2412992 unchanged and back; [pairs] records with p boot on 2412992 and 3901e2e unchanged; [freqTiers] no new field, records written under the flag boot on b21ee93 and 2412992 byte-equal and back; [patterns] prog.pt on b21ee93 and 2412992; [bareByPair] no new field, a pair-bare unit's records boot on 3044601 byte-equal and back; [pv] prog.pv on 806ad57 and 3044601 both directions)
$NODE tests/characters_checks.js                 # 134
$NODE tests/characters_app_checks.js             # 219 (214 without ../japanese/pack: one ja check; Math.random seeded: Placement walk deterministic; hint pinyin tone colours; every unit hinted, multi-character units hint each character's meaning; hint dedupe keyed on character + hint text (衣服 服 clothes / 服务员 服 to serve), control: 3044601 units byte-identical with the key reverted)
$NODE tests/script_checks.js                     # 128
$NODE tests/script_app_checks.js                 # 216
$NODE tests/audio_checks.js                      # 90 (app section needs ../persian)
$NODE tests/passage_audio_checks.js              # 43
$NODE tests/listen_mode_checks.js                # 192 (adds [12] pack.listenQuestions "all": all questions audio-only, flag-off control vs 7a21ccd; [13] pack.rereadPerfectDays incl. first listening pass at 7 days (x 1, no l), nextReadItem control vs 3790814; [14] pack.readRotation: session alternation, random picks, shuffled questions, s/ls, control vs 491d470; [15] listening look-back "Replay passage": play rows, plain Show text, stop on close, nothing tracked, flag-off + reading-pass walks vs a8e9c08 with its look-back marks normalised away)
$NODE tests/validate_pack_audio_checks.js        # 30
$NODE tests/validate_pack_characters_checks.js   # 83
$NODE tests/validate_pack_script_checks.js       # 56
$NODE tests/validate_pack_spans_checks.js        # 13
$NODE tests/gloss_display_checks.js           # 29 (pack.glossStyle "primary": glossSenses/typedSynWords, first sense + bracket and the also: line at every word-gloss site on 别/帮助, raw en kept for matching, flag-off control vs 3044601)
$NODE tests/typed_from_checks.js                 # 70 (pack.typedFrom / glossFocus; control vs ef44c6e)
$NODE tests/typed_mastery_checks.js              # 81 (characters.bareBy typed credit/hold/miss step-down, bareWords, per-level stages, withWords + Learn turn + order chips on a withWords pack, gloss fields; control vs 7fe35f7, markChar vs 7a21ccd)
$NODE tests/words_typed_checks.js                # 57 (pack.wordsBy typed: streak table, flag-off markRec + two-session app control vs a8e9c08, held words planned typed + held share, one typed ask per session (replay recall, session record today.tw across a reload), no in-drill retry credit, untypable words keep the old rule)
$NODE tests/progress_map_checks.js              # 94 (pack.progressMap: whole-pack bar (true) position, prog.pm cap 14, sessionsToGo; goals ladder: goalPosition per level range, 90% switch, last-goal clamp, pm g window, Today row, Progress Goals block, session writes g, owner export; flag-off control vs a2f2426, progressMap true vs 2412992)
$NODE tests/progress_view_checks.js             # 48 (pack.progressView "v2": totals, current level + unsettled level below as rows, the rest folded (SETTLED 0.9) and tap to open, prog.pv written on leaving Progress (tab switch) and on visibilitychange / pagehide (view and hero stay), never at boot, deltas, recentMisses; owner export: anchor, hidden rows + Show all, bar widths, "characters only", hero first visit / after a session / no change; flag-off Progress vs 9667a81 on 3 records; owner export read-only)
$NODE tests/app_view_checks.js                 # 91 (pack.appView "v2" stage B: --stim-top + flex-start, centred label, option numbers hidden on coarse pointers; every item kind without the kind tag, placeholders, You typed / You heard / Show meaning; stimulus, options and ruby/tone markup equal flag off minus the chrome; options primary-only + collision guard incl. an option whose hidden sense is another option's primary (owner export: 14 sessions measured, 0 newly kept); live region omits Examples + hidden text; Missed full reveal has no cue/play markers; reveal answer row, inline Replay, unit dots, Examples fold on right answers; teach-card anchors; flag-off item kinds, teach cards and a session's items byte-identical to 6c591c9 on 3 records; stage A: data-appview on <html> only with the flag, v2 CSS scoped; Today anchor Session N / "review only", step rows without counts, gate sentence, goal component as the Progress link, Start/Resume; header names the Today step and the test; drill end "R of N", Missed rows + hidden full reveal, No misses.; Session done deltas from Start, title only after a reload; Progress gate sentence, Show pinyin, Dark theme chip writes prog.theme only; flag-off Today / drill ends / Session done / Progress / Test / header titles byte-identical to 8604b17 on 3 records; owner export read-only)
$NODE tests/pairs_checks.js                      # 49 (pack.pairs: validator, kind -> pair table, pair streak table, bootstrap from the legacy streak, scheduler order, flag-off plans + two-session app walk vs 3901e2e, three Today sessions on the owner export; reads PAIRS_OWNER or ../chinese/.cache/owner-progress.json, read-only)
$NODE tests/freq_tiers_checks.js                 # 79 (pack.freqTiers: validator, generated tiers + shares + zipf order, same pair mechanics, typed-first / held boot / refresh / known per tier, unit tier + target, owner-export Learn order (nothing re-taught) + counters in id order, flag-off control + two-session app walk vs ff760d8, three Today sessions, Words tab sets numbered by count; owner export read-only)
$NODE tests/patterns_checks.js                   # 92 (pack.patterns: validator incl. keys + file-wide sentence ids, openPatterns keys + level reached + 80%, streak table, patternPick order + done refresh, options, Today Sentences 3 of 8 + note (once on a first-meeting miss) + Progress row + Sentences test, resume today.pt, flag-off control vs 1a762a3, owner export opens 19; [11] patternCue "after": English behind a meaning tap until answered, reveal, Sentences test, reload re-hides, flag-off walk vs 3044601; needs HSK_DIR or ../chinese with data/hsk_patterns.js for the engine_checks drift check)
$NODE tests/bare_pair_checks.js                  # 38 (characters.bareByPair: ws boost (Review reserves 3 slots for ruby units with wm 2+, ws < 2; [7]), rule table (ruby unit + wm AND ws pairs at 2, unit or word record, answered pairs only, miss brings the reading back), rubyTiers / bareWord / Progress row sites, app drill + Read tokens, records byte-equal flag on/off, flag-off control vs 3044601, owner-export measurement; owner export read-only)
$NODE tests/lag_checks.js                        # 62 (characters.start / ramp: fresh 60-word start then sets 3,5,8,10, mid-ramp 4 taught -> 5, owner export same units, sets never straddle a level (HSK 3 set 30 of 30 -> HSK 4 set 1 of 60), short last set; characters.learn "lag": core rule, owner shape before/after, per-level set label (Today row + card header, straddling set, resume), app sessions, resume, per-level Progress rows vs 68930bd, control vs 590af86)
$NODE tests/pause_checks.js                      # 49 (pack.pauseNew: flag-off / unpaused control vs 36aee02, chip, paused sessions teach nothing, Review +Learn items, toggling mid-session)
$NODE tests/level_gate_checks.js              # 63 (pack.levelExam: pinyin vs characters levels, boot / answered / unit-own wm (word stream ignored), Progress rows (old and v2 bars, folded line, hero total), goals, gate, controls; pack.levelGate: hold just under / open at the pack value (zh 0.7), note text, Learn row, characters still taught, pauseNew, Progress note (old row and v2 line in the waiting level block), flag-off / gate-open / no-pairs controls vs 9667a81, owner-export known % per level, seeded 30-session sim (gate opens after session 23); --sessions N --acc A)
$NODE tests/opts_mix_checks.js                  # 50 (pack.optsMix: records carry f (session learned), buckets by f, rotation by sn, charSound by syllables [4]; length-first char/pron builders [1c], same-stage wrong choices, new/weak answers by learn-order set; 8 builders x 5 shapes x new/known guess success before/after, Learn drill + rest of session by set (--table), app sites + Today Learn drills, placement as flag off, control vs 68930bd; ~7 min)
$NODE tests/session_resume_checks.js             # 125 (drill/passage resume: tab switch, reload, relaunch, per-tab parking; readRotation Read pick + question order, rd without qx; listening look-back list + text state; an old record with reopened/peekText resumes)
$NODE tests/day_sim_checks.js                    # 77 (pack.dayAware: 8 sessions in one day, rollover, voiceless, 60-miss backlog, 14 days, resume / lessons never count a session; weak-word floor + production settles, owner-shape before/after vs fb49c1b; --why)
$NODE tests/help_close_checks.js                 # 42 (pack.helpClose popover dismissal; pack.readAnswerBlock, Read verdict scroll)
$NODE tests/gloss_overlap_checks.js              # 75 (words syn/typedSyn/noTypedMeaning/pronInGloss, stimulus gate, natural answers; ~5-14 min: 286 s on main 7fe35f7 idle, 151 s on fb2-write2 alone, 836 s under parallel load)
$NODE tests/sentence_spans_checks.js             # 15 (sentence spans flag-off control vs 8ad46d6; ~2 min, reads ../<lang>/pack)
$NODE tests/flagoff_snapshot.js --check          # 26 (reads ../<lang>/pack; drift in a sibling checkout fails it)
$NODE tests/flagoff_snapshot.js --capture        # regenerate tests/golden/ (explained commit only)

./build.sh packs/zh dist/zh.html                 # also writes dist/sw.js
python3 tools/jsonify_pack.py packs/zh           # after editing any packs/zh/*.json
python3 tools/validate_pack.py packs/zh          # schema + referential integrity; fails on stale .js
.venv/bin/python -m pytest tools/packbuilder/tests
python3 -m unittest discover -s tools/packbuilder/tests -t tools   # same suite, stdlib runner
(cd tools && python3 -m packbuilder audio --lang fa --repo ../../persian --check)   # recorded-audio status of a repo
python3 tools/pack_from_hsk.py [../chinese]      # regenerate packs/zh from the hsk data (idempotent; reads tools/zh_freq.json)
.venv/bin/python tools/zh_freq.py [../chinese] [--check]   # zipf table for freqTiers (pip install wordfreq==3.1.1 into .venv)
.cache/venv/bin/python tools/zh_say_scan.py [--write]   # zh polyphone TTS carriers; venv: pip install pypinyin jieba
```

### Test tiers

`tests/run_tier.sh fast|full [--area a,b]` runs a tier with the pinned Node (sets HSK_DIR when `../chinese` is absent), prints one line per suite (pass/fail counts, seconds) and exits 0 only when all pass. Run from a sibling checkout (`../vocab-engine-<branch>`) or any worktree.

- **FAST** (per-feature worker, every commit): pack_flags_checks, engine_checks, migration_checks, `flagoff_snapshot.js --check`, plus the suites of every area the diff touches (`--area`).
- **FULL** (integration / republish only): every suite, including opts_mix (~8 to 14 min) and gloss_overlap (~6 to 16 min). About 20 min idle.

| area | suites |
|---|---|
| options | opts_mix |
| gloss | gloss_overlap, gloss_display, typed_from |
| progress | progress_map, progress_view, app_view |
| pairs | pairs, bare_pair, freq_tiers, level_gate, patterns |
| passages | passage_audio, listen_mode |
| resume | session_resume |
| characters | characters, characters_app, lag, typed_mastery |
| words | words_typed |

Flag-off controls never keep their own list of newer pack fields. A control that pins a sha builds its pack with `packAsOf(pack, PINNED_SHA)` from `tests/lib/pack_flags.js`; a suite that isolates itself from other flags uses `packAsOf(pack, ERA_SHA, { strip: [...] })` or `packBefore(pack, "<flag>")`, so a flag added later is stripped without touching the suite. Adding a pack flag means appending one row to FLAG_SINCE (key, introducing sha, path); pack_flags_checks fails until you do.

Dev mode without a rebuild: open `engine/app.html?pack=zh` from `file://` (loads `../packs/zh/*.js`); `?packdir=<relative path>` loads a pack elsewhere.

## Always

- Rebuild dist after any change to engine/ or packs/zh: `./build.sh packs/zh dist/zh.html`, then commit dist/zh.html and dist/sw.js with the change.
- Feature workers run `tests/run_tier.sh fast --area <areas touched>` before every commit (areas in "Test tiers"); integration and republish runs `tests/run_tier.sh full`. Paste the per-suite lines before merging an engine change.
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
| tools/zh_hints.json, tools/zh_hint_meanings.json | tools/zh_hints.py [../chinese] from the hsk vocabulary + .cache/makemeahanzi/dictionary.txt (`--fetch`) + tools/zh_hints_overrides.json; committed so pack_from_hsk.py needs no network (run it first when the hsk vocabulary gains characters) |
| tools/zh_say.json, docs/ZH_SAY.md | tools/zh_say_scan.py --write (pypinyin + jieba venv; read by pack_from_hsk.py) |
| tools/zh_freq.json | `.venv/bin/python tools/zh_freq.py [../chinese]` (wordfreq 3.1.1 zipf; committed so pack_from_hsk.py needs no wordfreq) |
| docs/ZH_TIERS.md, words.json + characters.json `ft`, each level's word order | tools/pack_from_hsk.py from tools/zh_freq.json + tools/zh_tiers_overrides.json (hand-edited, owner-facing; PACK_SCHEMA "freqTiers") |
| docs/ZH_PATTERNS.md, packs/zh/patterns.json | tools/pack_from_hsk.py from ../chinese data/hsk_patterns.js |
| docs/ZH_GLOSS.md, words.json `syn`/`typedSyn`/`noTypedMeaning`/`pronInGloss` | tools/pack_from_hsk.py via tools/zh_gloss.js (from tools/zh_gloss_overrides.json, checked against tools/zh_gloss_expect.json) |
| tests/golden/*.json | tests/flagoff_snapshot.js --capture |
| <lang>/pack/*, index.html, sw.js, tools/REPORT.md | packbuilder, jsonify, build.sh in each language repo |

## Pack essentials

Full reference: docs/PACK_SCHEMA.md.

- Everything language-specific comes from the pack: levels, set size, placement buckets, function words, typing rules, and the TTS locale.
- `pron` is display-only and never drilled on its own.
- Sentence `words` are word ids resolved when the pack is built. There is no runtime lookup.
- Word ids are append-only (each language's tools/id_map_v1.json); renumbering loses learner progress.
