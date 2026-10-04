# vocab-engine

A language-agnostic vocabulary trainer that builds to one self-contained HTML file. It was extracted from the `hsk` pinyin trainer. The engine holds the logic and UI, and each language is a **pack** of JSON data. Language repos (Italian, Spanish, and others) include this repo as a git submodule and hold only their pack.

## Live sites

Every site runs on this engine and keeps its own progress in the browser.

| language | site |
|---|---|
| Arabic | https://bannerless-studio.github.io/arabic/ |
| Chinese (Mandarin, HSK 1–4) | https://bannerless-studio.github.io/chinese/ |
| French | https://bannerless-studio.github.io/french/ |
| German | https://bannerless-studio.github.io/german/ |
| Hindi | https://bannerless-studio.github.io/hindi/ |
| Indonesian | https://bannerless-studio.github.io/indonesian/ |
| Italian | https://bannerless-studio.github.io/italian/ |
| Japanese | https://bannerless-studio.github.io/japanese/ |
| Korean | https://bannerless-studio.github.io/korean/ |
| Persian | https://bannerless-studio.github.io/persian/ |
| Russian | https://bannerless-studio.github.io/russian/ |
| Spanish | https://bannerless-studio.github.io/spanish/ |
| Swahili | https://bannerless-studio.github.io/swahili/ |
| Urdu | https://bannerless-studio.github.io/urdu/ |

Each site's source is `https://github.com/Bannerless-Studio/<language>`; this repo is https://github.com/Bannerless-Studio/vocab-engine.

## What the app does

The app has these tabs:

- **Today** runs one session: review 15 items with at least 40% production, learn the next set, listen 12, recall 8 (12 under wordsBy), 8 sentences, then read 1 passage. With pack `progressMap` a row above the plan shows one goal at a time (Goal 2 of 3, a 10-cell bar, what it means) and the sessions to go at your measured pace (after 14 sessions); a goal covers the levels up to it and the next one appears at 90%, and Progress lists all goals. Each stage skips itself when its pool is too small. The Read stage appears only when the pack has passages and one is due (docs/PACK_SCHEMA.md "passages.json", Today): the first not-done passage at an unlocked level, else a spaced re-read of a passage with a missed question after 7 days, or a passage you got right 30+ days ago (7 days when it was read once and never listened to: its first listening pass). A re-read alternates with a listening pass (the passage played sentence by sentence with the text hidden, half the questions audio-only, or all of them with pack `listenQuestions: "all"`, whose per-question "Replay passage" then replays the sentences by ear instead of showing the text, with a "Show text" toggle) when every sentence can be heard on this device; the attempt is stored as `prog.read.done[id].l = 1`. With pack `readRotation` (zh) there are no day gates: after a reading pass comes a listening pass of a random read passage (never-listened first, so usually the one just read), then a new passage (or a random re-read, missed first), and so on; every pass shuffles the question order; records gain `s`/`ls` (session numbers). It has a "Skip today" button.
- **Words** is a browser with search and per-set drills.
- **Sounds** shows pack lessons. It appears only when the pack has lessons.
- **Test** has placement plus free tests.
- **Progress** shows stats and handles export, import, and reset.

The question types are:

- **hear:** hear the word, then pick its meaning.
- **read:** see the word, then pick its meaning.
- **recall:** see the meaning, then pick the word.
- **type:** see the meaning, then type the word. A pack with `typing: "pron"` (zh) alternates two tagged kinds here instead. "Type the pinyin" is silent and tones are optional. "Type the characters" plays the word first. See docs/PACK_SCHEMA.md "Pronunciation aids".
- **gap:** fill a cloze sentence, by picking or typing.

A word keeps one progress record, `prog.w[id] = {r, w, s, prov?, d?, k?, t?, u?}`: right and wrong counts, streak, the placement-guessed flag, the drilled-ahead flag, `k`, the kind (hear, read, recall or type) of its last miss, and, with `pack.dayAware`, `t` and `u`, the day and the session ordinal of its last answer (docs/PACK_SCHEMA.md "dayAware"). A word is learned once it has this record. Records are created by Learn, a Words-tab drill, placement, a passage weak word, and any review, recall or test answer on a word learned through the counter-prefix fallback below. `prog.sets[level]` counts completed sets: it drives the progress bars, the "set N" labels, the fallback prefix and placement seeding, never which words of a recorded level are learned, so a republish that reorders, adds or removes a level's words never marks an untaught word learned or re-teaches a learned one. Learn teaches the level's next `setSize` unlearned words in file order. A level with no taught record (a legacy export or seed) falls back to the first `sets × setSize` words plus its `d` words; its first new record first gives that prefix provisional records, so nothing is lost (core.js `learnedWords`, `pinPrefixRecords`). Today's Review and Recall and the Words-tab review ask a word with `k` in that kind (a Recall plan turns a receptive `k` into recall, and `type` becomes recall when the pack has no typing). A pass in that same kind clears `k`, and so does a pass on the fallback shown for it (a read item when the word can't be heard, recall when the pack has no typing); a pass in another kind leaves it. A cloze item sets or clears only the blanked word's `k`: a typed gap as type, a choice gap as recall; the word's counts are left to the sentence record. Plans reach `k` by swapping kinds with another word item, so a Review keeps its production share, and move at most half the words, weakest first. A missed typed item comes back later in the same drill until it is typed right; from its second miss it comes back as its choice form instead (a typed word as recall, a typed gap as a choice gap on the same blank, a typed script sound as symSound), where the answer is among the options. That choice form records a miss as `type` and leaves `k` alone on a pass, so the next review still asks for the word typed (app.html `typedRequeue`). The Test tab and placement ignore it. A stored `k` outside those four kinds is dropped on load (core.js `markRec`, `applyMissedKinds`).

A word is known at streak 3 (Progress counts it mastered): any right answer adds 1, a miss resets to 0. With `pack.wordsBy` `"typed"` (zh), from streak 2 only a typed answer (characters, pinyin or meaning) adds 1: a right choice or ear answer holds the streak, a miss steps it down one (getting it right again later in the same drill does not undo that: the in-drill requeue after a typed miss stays typed and earns no streak, practice only), and Review and Recall ask a word at 2 typed, once per session (Today's Recall has 12 items instead of 8 for it); the Recall replay of a typed miss is a choice (recall). A word becomes known only by writing it (docs/PACK_SCHEMA.md "wordsBy").

An item that plays audio by itself shows a Replay button. A gap item plays its sentence only after the answer, with Replay in the reveal. See docs/AUDIO.md "Playback reliability".

After the first visit a site loads instantly and works offline. When a new version is published, the open page keeps running and shows "Updated, reload for the new version"; the next load gets it.

## Progress backups and recovery

The app never discards stored progress silently. It writes a backup to the same storage backend as the progress, under these keys:

| key | written when |
|---|---|
| `vocab_<key>_invalid_backup` | At startup, stored progress can't be parsed or fails validation. The raw string is kept and the app starts fresh. |
| `vocab_<key>_pre_import_backup` | Just before a valid import replaces the current progress. The import is not applied if this backup can't be written. |
| `vocab_<key>_reset_backup` | Just before "Reset all progress". The reset is cancelled if this backup can't be written. |

Each key holds only the most recent backup of its kind.

If the stored progress can't be read at all (a storage read error), the session runs read-only with a visible warning. Nothing is saved, so the stored progress is left untouched. A storage write error also shows a warning; it never falls through to a different storage backend.

To recover, copy the backup's value and paste it into Progress → Import progress:

1. In the browser devtools console, run `copy(localStorage.getItem("vocab_zh_reset_backup"))`, using your pack key and the backup you want.
2. On the Progress tab, choose Import progress, paste, and choose Load.

Import is strict, so a backup taken from an older pack whose levels were since renamed is rejected with a reason.

## Using it from a language repo

Each language repo includes this repo as a git submodule at `engine/` and holds only its pack. Italian as an example:

```
italian/
  engine/                git submodule -> this repo
  pack/                  pack.json words.json sentences.json [lessons.json] + generated .js
  index.html             built output (for example, served by GitHub Pages)
  sw.js                  service worker written by build.sh next to index.html; publish it too
```

Set it up and build with these commands:

```sh
git submodule add https://github.com/Bannerless-Studio/vocab-engine.git engine
# write pack/*.json following engine/docs/PACK_SCHEMA.md (or build it with engine/tools/packbuilder), then:
python3 engine/tools/jsonify_pack.py pack
python3 engine/tools/validate_pack.py pack
engine/build.sh pack index.html        # usage: build.sh <packdir> <out.html>; awk only, also writes sw.js
# for dev mode, open engine/engine/app.html?packdir=../../pack
```

**Publishing.** Commit `sw.js` together with `index.html` every time. A stale `sw.js` keeps serving the old cached page until a publish changes `sw.js`. Add this line to the language repo's `check.sh`. It rebuilds into a private temp dir, compares `index.html` and `sw.js`, and checks that both are tracked and committed:

```sh
sh engine/tools/check_site.sh pack        # [page], default index.html
```

**Kill switch and rollback.** Never delete a published `sw.js`. When the update check gets a 404, the installed worker stays and keeps serving its cached page. To turn the cache off, copy `engine/engine/sw.disable.js` over `sw.js` after `build.sh`, then publish. On the next visit it deletes this site's `ve:` caches, unregisters itself and handles no requests. `check_site.sh` reports `sw.js` as stale while the kill switch is in place. To roll back a bad build, publish the previous `index.html` and `sw.js` together. Its build id differs from the live one, so browsers install it and replace the cache in the usual way. To re-enable after the kill switch, rebuild and publish.

To take an engine update, run this and then rebuild:

```sh
git submodule update --remote engine
```

Progress lives in the browser under `vocab_<pack.key>`, so each language keeps separate progress. A drill in progress also survives a tab switch or a page reload (localStorage `vocab_<pack.key>_session`, one per app tab, dropped after 12 hours; docs/PACK_SCHEMA.md "Session resume"). How the service worker caches and updates: engine/README.md. Engine development, tests and architecture: CLAUDE.md.

## Licence

Code (engine/, tools/, tests/, docs/) is MIT. Pack data under `packs/*/` is
CC BY-SA 4.0. See LICENSE for details and attribution.
