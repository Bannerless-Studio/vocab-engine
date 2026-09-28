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
| Urdu | https://bannerless-studio.github.io/urdu/ |

Each site's source is `https://github.com/Bannerless-Studio/<language>`; this repo is https://github.com/Bannerless-Studio/vocab-engine.

## What the app does

The app has these tabs:

- **Today** runs one session: review 15 items with at least 40% production, learn the next set, listen 12, recall 8, 8 sentences, then read 1 passage. Each stage skips itself when its pool is too small. The Read stage appears only when the pack has passages and one is due (docs/PACK_SCHEMA.md "passages.json", Today): the first not-done passage at an unlocked level, else a spaced re-read. A re-read alternates with a listening pass (the passage played sentence by sentence with the text hidden, half the questions audio-only) when every sentence can be heard on this device; the attempt is stored as `prog.read.done[id].l = 1`. It has a "Skip today" button.
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

A word keeps one progress record, `prog.w[id] = {r, w, s, prov?, d?, k?}`: right and wrong counts, streak, the placement-guessed flag, the drilled-ahead flag, and `k`, the kind (hear, read, recall or type) of its last miss. Today's Review and Recall and the Words-tab review ask a word with `k` in that kind (a Recall plan turns a receptive `k` into recall, and `type` becomes recall when the pack has no typing). A pass in that same kind clears `k`, and so does a pass on the fallback shown for it (a read item when the word can't be heard, recall when the pack has no typing); a pass in another kind leaves it. A cloze item sets or clears only the blanked word's `k`: a typed gap as type, a choice gap as recall; the word's counts are left to the sentence record. Plans reach `k` by swapping kinds with another word item, so a Review keeps its production share, and move at most half the words, weakest first. A missed typed item comes back later in the same drill until it is typed right; from its second miss it comes back as its choice form instead (a typed word as recall, a typed gap as a choice gap on the same blank, a typed script sound as symSound), where the answer is among the options. That choice form records a miss as `type` and leaves `k` alone on a pass, so the next review still asks for the word typed (app.html `typedRequeue`). The Test tab and placement ignore it. A stored `k` outside those four kinds is dropped on load (core.js `markRec`, `applyMissedKinds`).

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

Progress lives in the browser under `vocab_<pack.key>`, so each language keeps separate progress. How the service worker caches and updates: engine/README.md. Engine development, tests and architecture: CLAUDE.md.

## Licence

Code (engine/, tools/, tests/, docs/) is MIT. Pack data under `packs/*/` is
CC BY-SA 4.0. See LICENSE for details and attribution.
