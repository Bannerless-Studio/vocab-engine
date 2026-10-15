# story_fetch

Fetches StoryWeaver (storyweaver.org.in) stories of one language plus their English twin into `<site>/.cache/stories/<code>/` (gitignored).
CC BY 4.0 only, fail closed. No login, no workaround of any gate. Plan: `.cache/briefs/story-layer-plan.md`.

```
node tools/story_fetch/fetch.js --lang Urdu --levels 1,2 --site ../urdu [--code ur] [--limit N] [--resume]
```

Node 22 + Playwright 1.62.1 (path in `PLAYWRIGHT_PATH`, default the china-harbour-deploy checkout).
`--limit N` takes N stories spread evenly over each level's full list. Exit 3 = resumable stop (429s or read gate).

## Findings (2026-10-14, Urdu)
- Auth: anonymous cookie session. `GET /node/api/v1/init-session` sets httpOnly `_session_id`; `cf_clearance` comes with the page load. No auth header. In-page `fetch(..., {credentials:'include'})` on an opened storyweaver page works; plain curl gets 401.
- List item fields: `id title language level slug authors[{name,slug}] illustrators[{name,slug}] publisher{name,type} original_authors[] isTranslation description`. No licence field.
- Detail `/node/api/v1/stories/<slug>`: adds `originalStory{id,name,slug,authors,originalPublisher}`, `illustrators[{id,..}]`, `copyrightNotice` (empty).
- Read `/api/v1/stories/<slug>/read`: `pages[{pageId,pagePostion,pageType,html}]`. Types FrontCoverPage (credits: Original Publisher / Author / Illustrator / Translator), StoryPage (text in `div.content`, label `div.page_number`), BackInnerCoverPage x2 (licence), BackCoverPage.
- Licence is only in the BackInnerCoverPage html: `This book is CC-BY-4.0 licensed` plus per story line `Released under CC BY 4.0 license` (soft hyphens inside). The tool accepts a story only when the book statement is CC-BY-4.0 and every story-attribution line is CC BY 4.0.
- Translator: front cover html (`Translator:`), not in the JSON. Origin language: the language of `originalStory.id` in `translations_and_videos` (null when absent).
- Read gate: the read API needs the story's own page opened in the session and, after a few reads from one IP, answers 401 `You are not authorized to read this story.` and the site shows a login dialog. See the W1 report for the observed state.

## Cache
`<id>.json`: normalised fields + `text_pages[{n,pageId,html,text}]`, `twin{...,text_pages}`, `twin_tried[]` with reject reasons, `raw{list_item,read_meta,detail,cover_credits,licence}` (list item without coverImage). `manifest.json` id -> status (`ok`, `twin_null`, `licence_rejected`, `error`). `list-L<n>.json` caches the level lists, `run-stats.json` counters.

## Let's Read Asia (lra_fetch.py), measured 2026-10-14
Public JSON API, plain HTTP, no session. List `GET /api/v5/book/search?cardName=&limit=100&fLimit=100&lId=<langId>&cursor=`; book `GET /api/v5/book/preview/language/undefined/book/<id>` (the language path part is the literal "undefined"; the id decides). Page text is `pages[].extractedLongContentValue`, each page record repeated 3x (dedupe by pageNum). Fields: `license` (exact CC-BY-4.0 required), `collaboratorsByRole{AUTHOR,ILLUSTRATOR,PUBLISHER,...}`, `masterBookMetaData{title,languageName,license}`, `originalUrl` (often a StoryWeaver or digitallibrary page, so overlap with StoryWeaver), `masterBookId`, `nonMasterMetaDatas[{id,languageId}]`.
Urdu: 602 titles, 292 CC-BY-4.0, 196 BY-NC, 81 BY-NC-SA, 27 Copyright, 5 BY-3.0. English twin: the master when it is English, else an English sibling; page equality is on non-empty text pages (cover and credit pages differ by one).
Run: `python3 tools/story_fetch/lra_fetch.py --lid 5732871486570496 --code ur --site ../urdu [--limit N] [--resume]`.

## Measure
`python3 tools/story_fetch/measure.py --pack ../urdu --dirs <cache dirs> [--lang ur|ko|sw|...] [--population N]` prints the stage-0 numbers (sentences per story, share <= 14 tokens, pack coverage, proxy pass counts, passage excerpt counts by level). Token coverage uses pack surfaces plus generated forms, so it is a lower bound for the builder's lemma-based filter.

`--lang` picks token regex and sentence-end punctuation (ur default; ko Hangul and `.?!`; sw lowercase Latin and `.?!`; other codes get `\w+`). Non-ur surfaces are words.json `w/lemma/forms/alt` plus every surface the pack's own `sentences.json` spans link to a word; ko also accepts an eojeol that splits fully into known surfaces. Swahili verbs are agglutinative and not generated here, so sw coverage is a lower bound.

## Bloom Library (bloom_fetch.py), measured 2026-10-15
Public Parse API at `server.bloomlibrary.org/parse/classes/books` with the public `X-Parse-Application-Id` that the bloomlibrary.org JS bundle sends to every browser (no master key, no session, no login). List: `where={"langPointers":{"$inQuery":{"where":{"isoCode":{"$in":[..]}},"className":"language"}},"inCirculation":{"$in":[true,null]}}`, 100 per page. S3 text: `<baseUrl><folder>.htm` is public; `baseUrl` holds the whole key in one `%2f`-encoded segment with `+` for spaces (decode with `unquote_plus`, folder = last key part). Fallback: public bucket listing by prefix.
Fields: `license` (cc-by, cc-by-sa, cc0, cc-by-nc..., custom, ask), `licenseNotes`, `copyright`, `credits`, `originalPublisher`, `publisher`, `bookInstanceId`, `bookLineageArray`, `allTitles`, `tags` (`computedLevel:N`, `topic:Bible`), `pageCount`. In the book HTML: `data-book="licenseUrl"` (the licence version: by/4.0, by-sa/4.0), `originalAcknowledgments`, `versionAcknowledgments`, `smallCoverCredits`, `originalContributions`, `funding`, and `img data-creator` (illustrator names). Bloom has no author or translator field, only free text.
Licence rule (fail closed): API value must be in `--licences` and known (cc-by, cc-by-sa, cc0), `licenseNotes` empty, and the book's own licenseUrl family must agree. Pages: `bloom-page` without front/back matter; text is `bloom-editable[lang]` paragraphs (old books have no `data-page-number`, `numberedPage` is the marker). Languages are aliased (sw=sw+swh, ar=ar+arb).
Twin: English text in the same book with equal non-empty page count, else an English book found by `bookInstanceId in bookLineageArray` or sharing the immediate parent (>= 20 hits = shared template, skipped), same equality and licence rules, at most 4 tried. Note Korean and Swahili Bloom are mostly the Wycliffe Bible-story series (topic:Bible: ko 162 of 197 usable, sw 169 of 227).
Run: `python3 tools/story_fetch/bloom_fetch.py --lang ko --licences cc-by,cc-by-sa,cc0 --site ../korean [--limit N] [--resume]` -> `<site>/.cache/stories/<lang>-bloom/`.

## African Storybook (asb_fetch.py), measured 2026-10-15
Anonymous, no login, maker/admin endpoints untouched. `GET /booklistjs.php`: one 5.7 MB JS file with every book (`id,title,summary,author,people,lang,level,approved,other`; strings are JS-escaped plus HTML entities; language ids: Kiswahili 1079, Arabic 8737, English 1133, Urdu 16643). `GET /newviewer/index.php?id=<id>`: reader HTML with cover (title, author, artist), `p.single-text` page text, and a back cover with `Author - / Translation - / Illustration - / Adaptation -` lines, copyright holder and the licence line `Creative Commons: Attribution 4.0`. `POST /menubook.6.php id=<id>&bt=1`: "Translations and adaptations" as title + language + (Original|Translation|Adaptation); the links carry no ids (empty `loadRelatedBook(, 3, 0)`).
Licence is per book on the back cover only, so listing alone cannot count usable books. Rule: exactly `Attribution 4.0`, else `licence_rejected`.
Twin: English Original or Translation entries only (Adaptations are re-written texts), ids resolved by loose title match in the English list, same reading level required (other levels of one title are different texts; seen on "Lynne's birthday surprise"), equal non-empty page count, licence rule, at most 6 tried.
Run: `python3 tools/story_fetch/asb_fetch.py --lang sw --site ../swahili [--limit N] [--resume]` (sw, ar, en, ur) -> `<site>/.cache/stories/<lang>-asb/`.

## Passage windows (passage_windows.py)
`PYTHONPATH=tools <site>/.venv/bin/python tools/story_fetch/passage_windows.py --repo ../urdu [--top 30] [--out f.json]` lists, per story, the best run of consecutive pages that meets the site's `tools/passages_src.json` rules (words band, coverage over lemmas through the passages Linker, level budget). Writes nothing to the site. Urdu 2026-10-15: 207 stories with an English twin, 49 have a passing window, 71 best windows (story x level).

## Urdu rows (langs/ur.py story_rows, packbuilder/ur_story.py)
Filters and counts per run are in the build stats (`story_rows`) and `tools/README.md` of the urdu site.

## Swahili rows (langs/sw.py story_rows, packbuilder/sw_story.py), 2026-10-15
African Storybook Kiswahili books with an English twin (`.cache/stories/sw-asb/`, status ok, back cover `Attribution 4.0` on both). Alignment is `core/story_align.py` shared with Urdu. Swahili specifics: min 3 tokens, `.?!` ends, connective openers (na, lakini, kisha ...), no pronoun openers, per-sentence gloss agreement gate (ASb translations are often free), rename check for mid-sentence names that are no dictionary word, no glued-words check. The fetch is rate bound (3.5 s per call, about 3.4 books a minute, 629 listed, about 3 hours). Counts per build are in the build stats `story_rows`; credits (author, translation, illustration, copyright holder, urls) come from the back cover into attribution.json `story_sentences.stories`.

## Arabic rows (langs/ar.py story_rows, packbuilder/ar_story.py), 2026-10-15
African Storybook Arabic (66 listed, 18 with an English twin) plus Bloom Arabic (2 licence-usable). Same alignment as Swahili with the 1:2 bead kept (the Arabic edition often joins two English sentences). Yield is thin: 23 shipped from 13 books; the ASb Arabic vocabulary mostly falls outside the pack's lemma rule and 44% of sentences sit on pages that do not align. `passage_windows.py --lang ar` finds no passing window (best band-sized window coverage A1 0.96).
