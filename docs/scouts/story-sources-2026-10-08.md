# Aligned open story sources for zh, ja, ko, ru and the EU languages (scout 2026-10-08)

Corrects the 2026-10-08 TODO note that these languages have no aligned story source. They do; it is small for zh/ja and page-aligned everywhere. Probed live 2026-10-08.

| Source | Languages (titles) | Licence | English twin | Access |
|---|---|---|---|---|
| sbc-source (github.com/global-asp/sbc-source, Storybooks Canada / Global Storybooks; Pratham + ASP data) | zh ja ko fr es de it 40 each; ru 27 | per file, last lines `* License: [CC-BY]` or `[CC-BY-NC]`; 29 CC-BY ids per language (ru 17) | yes, same 4-digit id as `en/NNNN_*.md`, page-aligned by `##` breaks | git clone, no key. Tiny: en total ~56 KB, levels 1–5 |
| global-pb (github.com/global-asp/global-pb, Pratham translations) | fr ~24, de ~19, es ~5, it ~3, ja 1; zh ko ru 0 | repo CC BY 4.0 "except where noted" | yes, ids index pb-source `en/` | git |
| asp-source (African Storybook) | fr ~106, de 1; others 0 | CC BY or CC BY-NC per file | yes (en 367) | git; useful for fr only |
| StoryWeaver (storyweaver.org.in/api/v1/books-search?languages[]=X; /api/v1/stories/<id>) | ja 1344, fr 1496, es 1435, it 1054, ko 996, zh ("Chinese (Simplified)", exact label) 406, de 210, ru 124 | site states CC BY 4.0 platform-wide; NOT verified per book (API has no licence field) | strongest: detail endpoint `isTranslation` + `originalStory.id`; page-level | public JSON API, no key; 3.5 s gap, no 429 in ~25 calls; counts include level-1 and very short books |
| Bloom Library (bloomlibrary.org; Parse API server.bloomlibrary.org/parse/classes/books, public app id; official OPDS needs a key) | CC-BY/BY-SA in circulation: ko 206, fr 830, es 1072, de 221, ru 1027; zh-CN 7, ja 1, it 1 | per book | `bookLineage` links translations; not guaranteed 1:1 or page-aligned; ko/ru may be national originals without twin (unmeasured) | unofficial Parse query, use sparingly; HF sil-ai/bloom-lm gated |
| OPUS Books / Farkas | en-fr 127k, en-es 93k, de-en 51k, en-it 32k, en-ru 17k sentence pairs; no zh ja ko | NOT shippable (personal/educational/research; no mass redistribution without permission) | sentence-aligned | opus.nlpl.eu |
| Let's Read Asia | ~10.5k books / 60 langs; per-language counts not obtainable (SPA, no API) | CC BY share small (2026-09-27 scout) | unknown | skipped |
| Project Gutenberg | no aligned bilingual editions | PD | no | not usable |

Verdicts
- zh: yes, tiny. sbc-source 29 CC-BY page-aligned stories; StoryWeaver zh 406 via originalStory (licence per book unverified). Bloom 7.
- ja: yes, small. StoryWeaver ja 1344 with twin; sbc-source 29 as clean seed. Bloom 1.
- fr es de it: yes. StoryWeaver + Bloom CC-BY (twin by lineage, noisy) + sbc-source 29 each; fr also asp-source 106 and global-pb 24. it thinnest in Bloom.
- ru: yes, small aligned. Bloom ru 1027 for volume (twin unmeasured); sbc-source 17 clean seed; StoryWeaver 124.
- ko: yes. StoryWeaver 996 with twin; Bloom 206; sbc-source 29.

Caveats: StoryWeaver licence must be checked per book before shipping; all alignment is page-level, not sentence-level; filter sbc-source CC-BY-NC by the `License:` line; Bloom Parse API is unofficial.
