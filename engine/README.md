# engine/

The trainer itself. `build.sh` (repo root) inlines these files and one pack's generated `.js` into a single HTML page plus `sw.js`. Language repos reach this directory as `engine/engine/` through the submodule. Pack format: docs/PACK_SCHEMA.md. Agent rules: CLAUDE.md.

| file | label |
|---|---|
| core.js | Logic with no DOM (`VocabCore`): progress model and storage key, plan builders (Today, Review, Recall, Test) and their day-aware ranking (`dayAware`), typed-answer folding and collision guard, synonym guards on options and typed meaning stimuli (words `syn`/`typedSyn`), no meaning -> pinyin typed kind for words whose gloss spells the reading (`pronInGloss`), typed-meaning matcher (`glossAltKeys(en, pack)`: the copula rule only on typed-meaning packs), characters stage (`characters.learn: "lag"`: words or characters by one rule), new-material pause (`pauseNew`: `pauseOn`, `setPause`), script primer, passages and listening pass, session resume record rules, legacy migration. Shared by the app and every tests/*.js suite. |
| app.html | UI shell for every tab and stage (`glossShort`: shortened glosses on zh option buttons and the "also right" note; `pronInGloss` words: recall swapped for the read item while shown by their reading, options without readings). Dev mode loads a pack's `.js` files directly (`?pack=zh`, `?packdir=`); build.sh replaces the `PACK-BEGIN`/`PACK-END` block and the `core.js` script tag with inlined code. |
| sw.template.js | Service worker template. build.sh fills in the build id, page name and audio cache version and writes `sw.js` next to the page. |
| sw.disable.js | Kill switch: copied over a published `sw.js` to delete this site's caches and unregister. |

## Service worker behaviour

The page registers `sw.js` after `window` load, over http(s) only, so `file://` and dev mode are unaffected. The worker:

- serves the page cache-first, so repeat visits load instantly and work offline. Other offline navigations inside the site fall back to the cached page. Packs are inlined, so nothing else is cached;
- names its cache `ve:<site path>:<build id>`. The build id is the POSIX `cksum` of the built page before its last line, `<!--ve-build:<id>-->`. Every rebuild that changes the page changes `sw.js`, and the browser installs the new worker on the next visit. Activation deletes only this site's older caches. All language sites share the `github.io` origin, so the site path in the name keeps them apart;
- caches a page only when it carries this build's marker. Right after a publish a CDN edge can still serve the old `index.html`. Install then fails and the browser retries it on a later navigation, instead of pinning the old page under the new id;
- keeps played recorded-audio clips in a cache named by `pack.json` `audio.version`, so re-rendered audio never plays a stale clip (docs/AUDIO.md);
- falls back to the plain network whenever the Cache API fails, and never touches cross-origin requests (Google Fonts, tatoeba.org audio).

A new build takes over in the background. The open page keeps running and shows "Updated, reload for the new version". The load after that gets the new build.
