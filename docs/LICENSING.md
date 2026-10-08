# Licensing across the repos

Each repo is licensed on its own; nothing is inherited from the engine.

| Repo | Code | Data | Where it is written |
|---|---|---|---|
| vocab-engine | MIT (engine/, tools/, tests/, docs/) | CC BY-SA 4.0 (packs/*) | LICENSE, README "Licence" |
| each language site | MIT (build.sh, check.sh, index.html, tools/*.py) | CC BY-SA 4.0 (pack/, tools/*.tsv) | LICENSE (both sections), README "Sources and licences" table, pack/attribution.json (per-source record the pack build writes) |
| chinese | MIT | CC BY-SA 4.0 (CC-CEDICT, wordfreq data, Wiktionary hints, hand-authored sentences/patterns); complete-hsk-vocabulary MIT; Make Me a Hanzi glyph data LGPL-3.0-or-later (LICENSES/) | LICENSE (added 2026-10-08, b7691a1), README "Sources and licences", pack/attribution.json |

What binds the choice (why the data licence cannot simply change):
- ShareAlike sources: Wiktionary/kaikki extracts (CC BY-SA 3.0), hermitdave FrequencyWords and wordfreq (CC BY-SA 4.0), CC-CEDICT (CC BY-SA 4.0), KANJIDIC2/JmdictFurigana (CC BY-SA 4.0, planned for ja). Any pack that keeps them stays CC BY-SA; a more permissive or proprietary data licence requires dropping or replacing those sources.
- Attribution-only sources: Tatoeba sentences and CC BY/CC0 audio clips, StoryWeaver and Global Storybooks stories (CC BY 4.0), Bloom CC BY subset. These allow a change to plain CC BY only if every SA source is gone.
- Build-time-only constraints that do not reach the shipped data: spaCy it_core_news_sm (CC BY-NC-SA 3.0; italian build), Goethe/Kelly lists (not shipped). Recorded in the site README tables and docs/LANGUAGES.md.
- Excluded on licence grounds: OPUS Books alignments (no redistribution), StoryWeaver read-along media (CC BY-NC-ND), Tatoeba NC-ND audio.

How to change a repo's licence:
1. Code: edit LICENSE's MIT block and the README line; no source has a copyleft claim on the code (LGPL in chinese applies to the glyph data only).
2. Data: list the pack's sources from pack/attribution.json, check each against the target licence (SA sources block anything but SA), rebuild without the blocking sources if needed, then edit LICENSE's "Pack data" section, the README table, and the attribution file's `licence` fields.
3. Live site: the built index.html inlines the pack, so the change ships with the next republish; the footer/about text that names the licence, if any, is in the site's index.html template.
New data sources go through a scout note in docs/scouts/ with the licence verified on the source's own page before a build brief uses them.
