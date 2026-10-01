# docs/

Design and reference documents. The pack schema is authoritative; the rest record designs, decisions and source research.

| file | label |
|---|---|
| PACK_SCHEMA.md | Authoritative pack format: every field of pack.json, words, sentences, lessons, passages, characters, script, legacy; typing folds and collision guard; validation. |
| AUDIO.md | Recorded audio (Piper clips): findings, pack schema, engine and service-worker design, playback reliability, builder command, Persian ezafe pass, rollout, decisions. |
| HSK_MERGE.md | Design and plan for merging the hsk trainer into the engine: characters stage, learning order, hsk_pinyin -> vocab_zh migration, parity checklist, decisions. |
| ZH_SAY.md | Generated table of zh TTS carriers for polyphonic characters (还 hái -> 孩), with confidence, for the owner's ear-check (tools/zh_say_scan.py). |
| SCRIPT_PRIMER.md | Design and decisions for the script primer stage (ko, ru, fa, ja, ar, hi, ur). |
| LANGUAGES.md | Per-language source scouting: sources, licences, counts, pipeline gotchas (verified 2026-09-23). |
| PACKBUILDER_HOOKS.md | Code-level packbuilder reference: every LanguageSpec hook, script primer emitter, passage linking and caches, ja and zh passage rules. |
| scout-somali-swahili.md | Data scout for Somali and Swahili (2026-09-26). |
| scouts/ | Dated scout reports, one per topic (`<topic>-<date>.md`): language data, culture and story sources. |
