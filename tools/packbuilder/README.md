# packbuilder

A shared, language-configurable builder for vocab-engine packs. It builds `pack/{pack,words,sentences,attribution}.json` and `tools/REPORT.md` in a language repo from public sources:

- a subtitle frequency list,
- `wordfreq`,
- a kaikki.org Wiktionary extract,
- Tatoeba sentences with English translations and audio.

A new language needs a language module (`langs/<code>.py`) and a few data files in its own repo. It does not need a fork of the pipeline.

The Italian pack (`key: "it"`) was the first language. The shared builder reproduces it byte for byte.

Code-level reference (every `LanguageSpec` hook, the script primer emitter, passage linking, tagging caches, the ja and zh passage rules) lives in [docs/PACKBUILDER_HOOKS.md](../../docs/PACKBUILDER_HOOKS.md).

## Layout

```
packbuilder/
  __main__.py, cli.py   entry point: python3 -m packbuilder <command> --lang <code> --repo <path>
  core/                 language-agnostic stages
    sources.py          downloads into <repo>/.cache, the Tatoeba corpus stage, audio recorders
    tag.py              truecasing and tagging (cached): spaCy, or spec.tag_texts (Stanza, SudachiPy, rules)
    lex.py              kaikki -> compact lexicon + form map (cached)
    lexicon.py          token -> (lemma, POS) resolution with context rules
    freq.py             corpus usage pass, frequency blend
    english.py          English stemming for gloss <-> translation overlap
    gloss.py            gloss cleaning, sense ranking, shared style strip list
    words.py            pool, entry/sense choice, second-POS entries, levels, frozen ids
    sentences.py        in-context links, sentence choice, -rsi gate, sentences.json spans
    spans.py            token offsets and link spans, shared by sentences and passages
    report.py           REPORT.md (keeps the manual section)
    pipeline.py         stage driver, pack.json, attribution.json, script.json
    script.py           script primer emitter (script.json)
    script_opts.py      Python mirror of the engine's script option builders
    script_cli.py       `script` command
    util.py             logging, STATS for REPORT.md, JSON writers, build environment
  passages.py           reading passages: tools/passages_src.json -> pack/passages.json
  audio.py              recorded audio (Piper clips), docs/AUDIO.md
  langs/base.py         LanguageSpec: the interface and its defaults
  langs/<code>.py       one spec per language: it es fr de ru fa id ko ja ar hi ur sw (ru: ё/е folding, stressed pron; sw: hand-written rule tagger, no spaCy/Stanza model); zh is passage-only
  qa/check.py           hard gate: schema, ids, levels, coverage, spec.check_word, shipped passages vs the level budget
  qa/scans.py           review scans 1-3 (gloss junk, articles/closed sets, non-lemmas)
  qa/sample.py          stratified word/sentence samples for hand QA
  tests/                unittest/pytest suite (spec fields, links, spans, passages per language, audio, script)
  requirements.txt      build deps (spaCy, wordfreq, simplemma)
  requirements-audio.txt  `audio` only (piper-tts; ffmpeg with libopus on PATH)
  requirements-zh.txt   zh passages only (jieba report cross-check, pypinyin readings)
```

## Language repo contract

A language repo includes vocab-engine as a submodule at `engine/`, and it holds these files:

```
pack/                      generated pack (commit it)
tools/build_pack.py        shim: PYTHONPATH=engine/tools python3 -m packbuilder build --lang <code> --repo .
tools/gloss_overrides.json hand gloss fixes, "lemma|pos": "gloss" (keys starting with _ are comments)
tools/gloss_display.json   optional display-only glosses, same key format (see below)
tools/forced_a1.txt        A1 core list: [NOUN] / [VERB] / [ADJ] / [ADV] headers, then lemmas
tools/bad_sentences.txt    optional: hand-reviewed sentences to drop verbatim, one per line, "#..." comments
tools/sentence_ids_v1.json {"issued": {sentence id: exact shipped text}}: written by every build, carries ids forward by text (core/sentence_ids.py, see "Id maps"; `packbuilder sentence-ids --bootstrap` writes it from the committed pack)
tools/id_map_v1.json       frozen "lemma|pos" -> word id (keeps learner progress across rebuilds; see "Id maps")
tools/REPORT.md            generated; text between <!-- manual:begin/end --> is kept
build.sh check.sh README.md TODO.md
.cache/                    gitignored: downloads + derived/ (corpus, tagged corpus, lexicon)
```

### Id maps

Learner progress keys on word and sentence ids, so a rebuild from the committed site data must give every unchanged word and sentence its own id back. Both maps are written and read through one function each, and a build that would break the round trip stops before it writes anything.

- **Words** (`core/words.py`): `id_key(lemma, pos)` is the only spelling of a key. `assign_ids` looks a word up by the lemma and pos it has when ids are assigned, which is before the finishing passes (`finalize_words`, `split_alt_forms`, gloss display) change them: hi folds the nukta, fa drops or restores ZWNJ, es shows a reflexive `-se`, de restores case, id and ja change the pos. It records that key as `word["_idkey"]`. `persist_ids` saves each shipped word under its shipped `lemma|pos` (the text the pack carries) and under the key the build looked it up with, never rewriting an entry and never reusing an id. It then replays the lookup (`ids_for_keys`, the same function `assign_ids` uses) over the map it is about to save and raises when any shipped word would not get its own id back, so a lookup key two words share fails the build and no file is touched. A shipped key that another id already holds is not overwritten; the build stats list it as `word_id_shipped_keys_held_by_other_ids` (it: 8) and the ids still round-trip through the lookup key. Old maps keyed by the build's lemma (de `jahr|noun`, hi folded) keep working and gain the shipped key on the next build.
- **Second-POS merge reads no gloss once an id ships**: `build_words` folds a second POS entry into the first when their glosses share a sense (`second_pos_merges`). `tools/id_map_v1.json` carries a `_shipped` entry: the sorted keys whose id is in the pack of the last persisted build. `persist_ids` rewrites it on every real build (set for every key whose id ships, cleared for the rest; ids and keys stay append-only, only the marker moves). If BOTH keys of the pair are marked (the dropped record and the surviving one, whichever entry is forced), two shipped ids would collapse into one, so the pair stays whatever a gloss edit says. With at most one key marked the merge goes ahead and the shipped id lives on in the merged word (ar أمر: the dropped noun holds the id, the word label follows the dictionary entry), so editing `gloss_overrides.json` cannot retire a shipped pair's id (sw jibu) and no same-sense duplicate is added. A retired key (unmarked) is not re-admitted. A map without `_shipped` (written before markers) is seeded once from `pack/words.json` when it exists, and gets the marker at its next persisted build. The build decision reads only the map, never git. Readers must skip the `_shipped` key (`load_idmap`, `persisted_idmap`); `ids_for_keys` and `assign_ids` take the id dict without it.
- **Sentences** (`core/sentence_ids.py`): ids are assigned after `sentence_fields` (fa `display_sentence`: yeh/kaf, ZWNJ), so the map holds the exact shipped text, the same text `sentence-ids --bootstrap` reads from `pack/sentences.json`. A map written by an older build holds the earlier `clean_sentence_text` text: a sentence whose two texts differ claims the id issued for the earlier one first, and the id is rewritten to the shipped text (stats `rekeyed`) unless two sentences ship one text, where the earlier text stays as the key because it is the only thing telling the pair apart. Before anything is written, `verify` replays `assign` over the new map and fails the build when any shipped sentence would get another id (a text changed after its id was assigned). Two sentences with identical shipped text claim ids in list order, so a map bootstrapped from a live pack can swap such a pair (persian has two); a map the builder wrote cannot.

Word order: words.json is written level by level, each level sorted by `rank` ascending (`core/words.sort_by_rank`, run in `build_words` and again at the end of `finish_words` so no spec hook can reorder it). The engine cuts Learn sets in file order, so sets follow frequency. Every pack shipped as of 2026-09-28 was already in this order, so no pack reorders at its next rebuild.

Two gloss files take the same `"lemma|pos"` keys: the shipped words.json `lemma` and `pos` (e.g. `"orang|noun"`), with keys starting with `_` as comments. The build reads `gloss_overrides.json` early. Its glosses steer the build: English-overlap example ranking, word rank, and language rules that read hand glosses (id `_idiom_pairs`: a part whose gloss names its compound keeps its link). Use it for a gloss that should change which examples and links a word gets. Every record kind takes it, including fixed phrases (`"per favore|phrase"`) and closed-class words whose gloss is the spec's fixed gloss (`core/words.overridden_gloss`). A key the build cannot apply stops the build with an ERROR listing each key and why (`core/words.check_gloss_overrides`, run at the end of `finish_words`): a key that matches no record (a dead key, or a pos label other than the one the record ships under), a key aimed at a FORM record ("è|form"; its gloss names the base word and stays the spec's fixed gloss), or a record built without it. A spec hook whose decision depends on a key registers it (`spec.use_override(key)`, or `spec.override(key)` for a lookup that registers on a hit), and a registered key passes: ko and id build lexicon entries from hand glosses, id decides idiom-pair links, reduplications, other-POS links and me- adjectives from them, ja merges spellings (same_sense), relinks kana homophones and flags foreign kanji spellings by them. A hook registers only a key that changed its outcome (an entry added, a merge or link decided with the hand gloss and not without it), never every key it iterates, so a dead key still reports. Registrations made while tagging (ja `_homophone`) are saved in the tag cache meta so a cached build keeps them. A hook that only restyles or folds the text (hi fixed glosses, fr gloss tidying) does not register: its key passes when the record or shipped word under that key carries the override text. The check runs only in `finish_words`, so `--stage words` alone never reports a dead key. `gloss_display.json` is merged into `en` only when words.json is written, after ranking, example selection and linking (`core/words.apply_gloss_display`). A display sense never changes corpus links, example choice, rank or order, and sentences.json stays byte-identical. Passage rules that read a word's gloss (fr `passage_fallback_ok` reads `en`) would otherwise see the display text in pack/words.json. For words in the display table, the passage Linker therefore gets the build's own gloss (`passages.Linker`), so display senses never change passage links either. A repo without the file is untouched. Use it for senses that only the learner should see, such as a compound sense on a first word that passages link as one tap: orang "(orang tua) parents". A display entry replaces the whole `en`. A key that matches no shipped word is logged. Without the file, nothing changes.

Caches are keyed by `LanguageSpec.versions` and the source file names and sizes. Bump a version when that stage's code, or the language's rules for that stage, change. Otherwise the cached tagged corpus is reused. Tagging is the slow stage, about 7 minutes for 650k sentences.

## Commands

```sh
pip install -r engine/tools/packbuilder/requirements.txt   # plus the language's spaCy model, see below
export PYTHONPATH=engine/tools                             # from the language repo
python3 -m packbuilder build  --lang it --repo .           # [--stage corpus|tag|lex|freq|words|all] [--check-remote]
python3 -m packbuilder check  --lang it --repo .           # exit 1 on failure
python3 -m packbuilder scan   --lang it --repo . [--only 1|2|3]
python3 -m packbuilder sample --lang it --repo . --seed 303
python3 -m packbuilder passages . [--lang it] [--check]    # reading passages, see below
python3 -m packbuilder passages ../packs/zh [--check]      # a flat pack dir (zh, from vocab-engine/tools), see docs/PACKBUILDER_HOOKS.md "Chinese (zh) passages"
python3 -m packbuilder script --lang ko .                  # script primer only, see below
python3 -m packbuilder gender --lang it --repo . [--check|--out FILE]   # tools/word_gender.json: noun g by word id, from a build (nothing under pack/ is written)
python3 -m packbuilder enrich --lang it --repo . [--check|--emit DIR]   # ft tiers + port flag block + eta, see "Port enrich"
python3 -m packbuilder audio  --lang fa --repo .            # recorded audio, see docs/AUDIO.md; run LAST
python3 -m unittest discover -s engine/tools/packbuilder/tests -t engine/tools
.venv/bin/python -m pytest tools/packbuilder/tests                # from vocab-engine (same suite, its .venv)
```

`build`/`passages`/`script` know nothing about recorded audio (docs/AUDIO.md) and rewrite
`words.json`/`sentences.json`/`passages.json`/`script.json` from scratch, so any of them dropping a
previously-shipped `audio` field is expected, not a regression: run `packbuilder audio` last after any
rebuild. It re-links every item's clip from `<repo>/audio/manifest.json` (untouched by the other
commands) with 0 renders, since the manifest and the clip files on disk never moved
(`tools/packbuilder/tests/test_audio.py::AudioBuild::test_rebuild_strip_then_audio_restores_links_with_nothing_rerendered`).
A test or code comparing a freshly regenerated `words.json`/`sentences.json`/`passages.json`/`script.json`
to the shipped one must strip `audio` fields first (`core/util.strip_audio`, mirrored on the JS side by
`tests/flagoff_snapshot.js`'s `stripFlagOnFields`) -- the emitter not carrying `audio` is correct, not stale.

Every sentences.json record carries `spans` (`[[start, end, wordId]]`, UTF-16 offsets into `t`) for every
language, from the same link records and offset rules as passage spans. A word the builder cannot place has no
span, and the engine locates it by surface. Rules and hooks: docs/PACKBUILDER_HOOKS.md "Sentence spans".

### Script primer

`script` (and the `final` build stage) writes `pack/script.json`, `script.js` and the `script` key of `pack.json`/`pack.js` for a spec with a `script` block (ko, ru, fa, ja; docs/SCRIPT_PRIMER.md). Run it with the repo's `.venv` python and `PYTHONPATH=<engine>/tools`. Details: docs/PACKBUILDER_HOOKS.md "Script primer".

### Port enrich

`enrich` (core/enrich.py) is a pure post-stage over a built pack: it adds `ft` to every word (rank <= 100 ambient; per level the least frequent 10% / 25% / 40% of A1 / A2 / B1 peripheral; overrides in `tools/tiers_overrides.json`), the unit `ft` (lowest of its words), the pack.json flag block from `LanguageSpec.port_flags()` and `eta` from `tools/eta.json`. It needs the standard library only. Run it after `build` / `passages` / `script` / `audio` and before `tools/jsonify_pack.py` is trusted (it rewrites pack.js, words.js and characters.js itself). `--check` writes nothing and exits 1 when the shipped pack differs (a site's check.sh runs it); `--emit DIR` writes an enriched copy and leaves the repo alone. For it es fr de (`gapGender`) it also copies the noun `g` by word id from `tools/word_gender.json` when that file exists (`python3 -m packbuilder gender` writes it from a full build run that touches nothing under pack/ and needs the language venv: spaCy; a pack built after the builders emitted `g` already has it, and a disagreeing `g` stops enrich). The file is by id because the lexicon entry behind `g` is chosen with the corpus; ids are append-only, so it stays valid. Rules: docs/PACK_SCHEMA.md "freqTiers" > "Other languages"; ETA constants: `node tests/eta_checks.js --pack <packdir> --calibrate --write <repo>/tools/eta.json`, then enrich again.

### Reading passages

`passages` tags `tools/passages_src.json` with the language's own tagger and writes `pack/passages.json`; run fa/id/ja with the language repo's own `.venv` (Stanza, SudachiPy). Run `tools/jsonify_pack.py` after writing. Details: docs/PACKBUILDER_HOOKS.md "Reading passages" onward. A sentence's `words` are ordered by the start of each word's first span, then id (a word with no span last), so a rerun and a builder change never reorder identical links. A capitalised token is a name (not counted) only when the tagger tags it PROPN (a `names` entry is retagged PROPN first) or the dictionary lists it as a proper name; a capitalised token only the resolver reads as PROPN (de Taxi, Radfahrer) counts as out-of-pack and needs an `oop` reason. In a passage id already in pack/passages.json an undeclared one is a warning (printed, and a REPORT section); in a new id it is an error. `passages --emit DIR` writes passages.json and REPORT_passages.md into DIR and leaves the repo untouched; `--src FILE` reads another passages_src.json.

To work on packbuilder itself against a language repo, point the shim at your checkout with `PACKBUILDER_PATH=../vocab-engine/tools python3 tools/build_pack.py`.

## spaCy models and licences

The model runs at build time only, and packs ship no model files. The model licence still limits how the project can be used.

| lang | model | licence | trained on | note |
|---|---|---|---|---|
| it | `it_core_news_sm` 3.8.0 | CC BY-NC-SA 3.0 | UD Italian ISDT, WikiNER | non-commercial only |
| es | `es_core_news_sm` 3.8.0 | GNU GPL 3.0 | UD Spanish AnCora, WikiNER | copyleft |
| fr | `fr_core_news_sm` 3.8.0 | LGPL-LR | UD French Sequoia, WikiNER | |
| ru | `ru_core_news_sm` 3.8.0 | MIT | Nerus | |
| fa | none | | | spaCy 3.8 has no Persian pipeline. Another tagger is needed. |

These licences were checked against `explosion/spacy-models` `meta/<model>-3.8.0.json` on 2026-09-23. Install a model with its wheel, for example:

```sh
pip install https://github.com/explosion/spacy-models/releases/download/es_core_news_sm-3.8.0/es_core_news_sm-3.8.0-py3-none-any.whl
```

## Adding a language

1. **Verify sources and their licences.** Record each one in the language README's sources table.
   - Subtitle frequency: hermitdave/FrequencyWords `content/2018/<code>/<code>_full.txt`, CC-BY-SA 4.0.
   - `wordfreq`: check that the language is supported.
   - kaikki.org extract: `https://kaikki.org/dictionary/<Name>/kaikki.org-dictionary-<Name>.jsonl.gz`, CC-BY-SA 3.0/GFDL. Check that its `lang_code` is what you expect.
   - Tatoeba `<iso3>_sentences_detailed.tsv.bz2`, CC-BY 2.0 FR. Count the sentences that have an English link. The Italian pack had 650k.
   - Optionally, a CEFR list for the Kelly-style cross-check. It is never shipped.
2. **Choose the spaCy model and record its licence.** Use the table above. The licence goes into `tagger_attribution` and the README. When no model exists (fa), stop and decide on a tagger first. The tagging stage expects spaCy.
3. **Copy `langs/it.py` to `langs/<code>.py`** and fill in these fields:
   - Identity: `code`, `name_en`, `pack_name`, `tts`, `stt`, `tatoeba_code`.
   - Sources: `sources` and the role file names (`subtitles_file`, `kaikki_file`, `sentences_file`, `kelly_file`).
   - Model: `spacy_model`.
   - Cache versions: set `versions` to `c1`/`t1`/`l1`.
   - Orthography: `word_re`, `lex_word_re`, `sub_token_re`, `form_target_re` and `fem_of_re` for the alphabet. Set `accent_variants` only if the subtitles drop accents.
   - Wiktionary: `noun_head_template` (for example `es-noun`, `fr-noun`), `regional_tags`, and `group_kpos` if the UD and Wiktionary POS conventions differ.
   - Report wording: `report_title`, `forced_description`, `numeral_exclusion`, `marked_past_name`.
4. **Fill the forced sets.** `forced_closed` holds days, months, numbers, colours, greetings and any other closed sets. `no_article` holds nouns shown bare, and `allowed_num` holds the numerals allowed as words. Write the repo's `tools/forced_a1.txt`, an A1 core list of about 150-200 everyday words.
5. **Set up articles and gender.**
   - Fill `article_forms`, `definite_article`, `fixed_word` and `fixed_gloss` for the articles.
   - Fill `pluralia_tantum`.
   - Override `default_gender`, `noun_display` (how a noun is shown with its article) and `check_word` (the hard article assertion). Russian and Persian have no articles, so keep the base versions: nouns are shown bare.
6. **Set up clitics and reflexives.**
   - Fill `clitic_re` (verb + enclitic) and `mono_imperative`, and `art_prep` for articulated prepositions.
   - Fill `clitic_of`, `refl_clitics` and `copulas`, and set `verb_endings`.
   - Override `pronominal_base`/`pronominal_form` (it: -rsi; es: -rse; fr: se + verb, usually `None`), and override `is_reflexive`/`carries_refl_clitic`/`stative_aux` to match the language.
   - Override `is_marked_past` only for a literary tense that should be kept to the top level (it: passato remoto). Spanish preterite is everyday and must not be marked.
   - Tables left empty switch their rule off.
7. **Add hand tables only after a QA round shows a need.** These are `gloss_overrides.json`, `drop_keys`, `apocope`, `multiword`, `profanity`, `bad_text_re` and `tools/bad_sentences.txt`. Fix categories with a rule first; a hand table is for residuals.
8. **Run and check.** Run `build`, then `check`, then `python3 engine/tools/validate_pack.py pack`, then `./build.sh`. Run the unit tests. The every-language test checks the new module's required fields.
9. **Do three QA rounds.** Each round runs `scan` and reads every "should be empty" list. It then runs `sample` with a new seed and hand-checks the samples. Rounds so far used seeds 7, 303 and 404. Fix the rule behind each finding, rebuild, and record the rules, counts and seeds in the manual section of `tools/REPORT.md`. The pack ships when all of these hold:
   - at least 95% correct primary sense on the 60-word stratified sample,
   - 0 wrong POS in the top 300 by rank,
   - at least 95% link accuracy on the 60-sentence sample, counted over its links,
   - every closed set complete at the first level (scan 3),
   - `check` passes and the validator reports 0 errors.
10. **Browser verification.** Build `index.html` and check the pack in a real browser: every tab, TTS voice for the locale, typing with accents at each level, gap items, and audio playback. Check at phone width, 390px.
11. **Publish.**
    - Create a public repo `<language>` with `engine/` as a submodule, and commit `pack/`, `index.html` and `tools/` data.
    - Enable GitHub Pages from the repo root.
    - When the language module is new or changed in vocab-engine, commit that there first. Then bump the submodule in the language repo with `git submodule update --remote engine`, rebuild, and check that `./check.sh` passes.

## Story sentences

A spec may set `examples_per_word` (default 2) and override `story_rows(env)` (default none). Story rows are tagged apart, join sentence choice only, rank ahead of other candidates only at equal fit (same rank penalty and headword tier), and fill picks 3..`examples_per_word` only; a word with no story sentence keeps 2. They ship as `"src": "story", "st": <story id>` and must be listed in attribution.json `story_sentences` (`check` enforces it both ways). Hook details: docs/PACKBUILDER_HOOKS.md `story_rows`.

## Hooks

Every `LanguageSpec` hook (normalisation and finishing, lemma/gloss/selection, passage, linker-level) and the zh/ja passage rules are documented in docs/PACKBUILDER_HOOKS.md. Each hook defaults to off or a no-op, so adding one never changes another language's output.

## Determinism

The build has no randomness. Every iteration over sets and dicts that affects output is sorted, and gzip caches are written with `mtime=0`. Two runs with different `PYTHONHASHSEED` values give byte-identical `pack/*.json` and `REPORT.md`. Recheck this after adding a language.
