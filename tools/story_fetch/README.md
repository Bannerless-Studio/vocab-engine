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
