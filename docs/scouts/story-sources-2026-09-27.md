# Story-text sources: browser-verified scout (2026-09-27)

Scope: learner-register native text with English for ur, ko, fa, hi, id, ar, so, sw.
Method: headless Chromium (Playwright 1.62.1), page text plus the JSON APIs each page itself calls, captured via request logging.
Every number below was observed in the browser this session unless marked **est** (extrapolated from a stated sample) or **n/r** (not reachable).
Scratchpad root (below `SP`): `/private/tmp/claude-501/-Users-ishmum-Programming-Voluntary/9e41e879-e4d7-4530-b040-c9be1286edd7/scratchpad`. Scripts are `SP/*.js`; raw captures are `SP/swread/`, `SP/asb-*`, `SP/voa-*.json`.

## Summary ranking (native text x aligned English x open licence x bulk access)

1. **StoryWeaver** is the biggest aligned CC BY 4.0 corpus for 7 of 8 languages; it has no Somali. Page-level alignment held in 7/7 measured pairs. Main weakness: most titles are translations of Indian (Pratham) originals, so the text is learner-register but not culture-native, except Hindi originals.
2. **African Storybook** is CC BY 4.0, with native African authorship. It is the only real Somali source (92 books, 19/20 sampled have English). The full catalogue comes in one call and page text is server-rendered HTML. Swahili English-pairing is lower (9/20).
3. **Let's Read Asia** has the most culture-native Asian stories (Indonesian 46/49 sampled are Indonesia-origin; Urdu has Pakistan and Bangladesh content). EPUB URLs are public on Google Cloud Storage and each book lists English. Licence is mixed: many books are CC BY-NC or NC-ND. Only Urdu (13/32) and Dari (6/12) have a usable CC BY share.
4. **Bloom Library** has an open Parse API with exact per-language and per-licence counts. It is strong only for Swahili (235 open and English-paired) and Korean (202). Licences are mixed per book, so filter to CC BY, CC BY-SA or CC0.
5. **Wikisource** (CC BY-SA 4.0; underlying texts are public domain) has literary adult-register prose, extractable through the MediaWiki API. It has no English alignment. It suits reading passages for hi (Premchand), ar and fa (Kalila wa Dimna), and ko (folk tales, a thin set).
6. **VOA** text is public domain, but only Korean and Persian are still publishing. Urdu and Indonesian froze on 2025-03-15, Swahili text pages end December 2024, and Hindi VOA does not resolve. It has no aligned English and is news register, with 26 to 50% of sentences at 14 tokens or fewer.
7. **Global Digital Library** is online with CC content and per-language counts, but downloads sit behind a "confirm you are human" wall. Its old API host no longer resolves. Its Urdu titles are StoryWeaver mirrors, so dedupe before use. Not recommended.
8. **Rekhta** marks its site "All rights reserved", so it is unusable. Radio Sawa does not resolve. Alhurra is not VOA and is not public domain.

Recommendation: StoryWeaver as the backbone for ur, ko, fa, hi, id, ar and sw. African Storybook for so and sw and extra ar. Let's Read Asia's CC BY subset for native ur, id and prs flavour. Bloom's CC BY subset for ko and sw.
Always pick the English twin at the **same level with non-empty text**. The first English entry in a StoryWeaver translations list was empty for Urdu (id 310774); the level-2 original (id 10118) worked.

## Per-language totals of aligned stories (open licence and English available)

Sources overlap: GDL and Bloom mirror StoryWeaver, ASb and LRA books. Sum only across different primaries.

| lang | StoryWeaver (CC BY) | ASb (CC BY) | Bloom (CC BY/BY-SA/CC0 + en) | LRA CC BY (est) | best non-overlapping total |
|---|---|---|---|---|---|
| ur | 832 (L2: 270) | – | 2 | ~236 (582 x 13/32) | ~1,070 |
| ko | 996 (L2: 244) | – | 202 | 0 (0 published) | ~1,200 |
| fa | 268 Farsi + 12 Dari (L2: 87) | – | 0 (prs) | ~63 prs (126 x 6/12) | ~340 |
| hi | 5,130 (L2: 1,517) | – | 27 | not listed | ~5,150 |
| id | 6,771 (L2: 1,903) | – | 30 | ~15 (373 x 2/49) | ~6,800 |
| ar | 526 (L2: 148) | ~43 (66 x 13/20; 0 ASb-approved) | 3 | – | ~570 |
| so | 0 (language absent) | ~87 (92 x 19/20) | 0 | – | ~87 |
| sw | 260 (L2: 82) | ~280 (628 x 9/20) | 241 (235 swh + 6 sw) | – | ~780 |

StoryWeaver English pairing was checked on 6 level-2 stories per language, and 6/6 had an English version in every language. Treat the StoryWeaver column as an upper bound until a full pass runs.

## 1. StoryWeaver (storyweaver.org.in): verified in browser

- **Licence.** CC BY 4.0, printed on the back cover of all 7 downloaded books.
- **Bulk path.** The page calls `/node/api/v1/books-search?languages[]=<Lang>&levels[]=<n>&page=&per_page=` for lists and `/node/api/v1/stories/<id>/translations_and_videos` for sibling translations, including English. Story text arrives as per-page HTML from `/api/v1/stories/<slug>/read?ignore_count=false&source=`.
- **Rate limit.** About 10 fast calls trigger HTTP 429. A 3.5 s gap between calls worked.
- **Read access.** The read endpoint returns 401 unless the story page is opened in reader mode first. Loading the reader and capturing the response it makes works.
- **Downloads.** The metadata reports `canDownload:false` when logged out, so PDF and EPUB need a login. Cloudflare challenge JS runs, but headless loads passed.
- **Language names.** Urdu, Korean, Farsi, Dari, Hindi, Bahasa Indonesia, Arabic, Kiswahili, Pashto. There is no Somali. Bilingual `English-<Lang>` editions exist: ur 82, ko 54, Farsi (Samim) 16, hi 504, ar 26.

| lang | total | L1 | L2 | L3 | L4 | translation share (L2 sample) | EN twin (6 sampled) |
|---|---|---|---|---|---|---|---|
| ur | 832 | 270 | 270 | 164 | 66 | 23/24 | 6/6 |
| ko | 996 | 547 | 244 | 51 | 19 | 22/24 | 6/6 |
| fa | 268 | n/m | 87 | n/m | n/m | 24/24 | 6/6 |
| hi | 5,130 | n/m | 1,517 | n/m | n/m | 20/24 | 6/6 |
| id | 6,771 | n/m | 1,903 | n/m | n/m | 24/24 | 6/6 |
| ar | 526 | n/m | 148 | n/m | n/m | 24/24 | 6/6 |
| sw | 260 | n/m | 82 | n/m | n/m | 15/24 | 6/6 |

n/m means not measured, because the per-level calls hit the rate limit.

Level-2 pair measurements (story pages only, page-number labels stripped). Tokens are whitespace-split.

| lang | story (id) | EN twin (id) | pages L/EN | sents L/EN | L share <=14 tok | EN share <=14 | page count equal | per-page sentence count equal |
|---|---|---|---|---|---|---|---|---|
| ur | Dadi ki dilchasb machine (59910) | Ammachi's Amazing Machines (10118) | 14/14 | 36/34 | 30/36 | 31/34 | yes | no |
| ko | Little monkey (102547) | Little Monkey's Lost Bananas (37237) | 13/13 | 58/58 | 58/58 | 58/58 | yes | no |
| fa | Brushing is no fun (106449) | Brushing is No Fun! (7263) | 12/12 | 45/55 | 25/45 | 39/55 | yes | no |
| hi | Didi ka rang-biranga khazaana (1910) | Didi's Colorful Treasure (255583) | 12/12 | 59/58 | 59/59 | 58/58 | yes | no |
| id | Kawan Pohon (540166) | Tree Friends (697064) | 11/11 | 35/35 | 32/35 | 31/35 | yes | yes |
| ar | Mata sata'ud ami (223765) | tagged EN, title in Indonesian (697198), text is English | 15/15 | 79/72 | 79/79 | 68/72 | yes | no |
| sw | Familia yangu (169500) | Maria's Family (162423) | 11/11 | 11/11 | 11/11 | 11/11 | yes | yes |

Verdict: page-level alignment is reliable, and sentence-level alignment is not. Align by page, then split sentences within each page pair.
Persian level 2 runs long, with a mean of 18.6 tokens per sentence.
One data-quality flag: some twins listed as English carry a non-English title (Arabic sample), and some are empty derivatives (Urdu 310774).

## 2. Global Digital Library (digitallibrary.io): online, downloads not reachable headless

- **Status.** Online, Next.js front end with a WordPress backend.
- **Counts.** From `/api/language/`, which is a WordPress taxonomy with counts.

| lang | count |
|---|---|
| ur | 162 |
| hi | 129 |
| id | 502 |
| ar | 94 |
| fa-af | 108 |
| sw-ke | 67 |
| so-et | 90 |
| ko | 7 |

- **Licence.** Footer says "All content on this platform is released under a Creative Commons license". Per-book variants were not checked.
- **API.** `api.digitallibrary.io` fails DNS (ERR_NAME_NOT_RESOLVED). The Developer page is empty.
- **Downloads.** EPUB at `content.digitallibrary.io/wp-json/epub-generator/v1/book/<id>` and PDF at `.../pdf-generator/v1/book/<postId>?download=true`. Both hit an HTTP 403 "Confirm you are human" wall in headless mode. After two attempts this is marked **not reachable**.
- **English pairing.** Not exposed. Urdu titles such as آنکھ مچولی match StoryWeaver titles, so GDL is largely a mirror.

## 3. African Storybook (africanstorybook.org): verified in browser

- **Catalogue.** `booklistjs.php` returns the full catalogue in one call: 12,902 entries, 5.6 MB of JS `bookItems.push({...})` lines with id, title, level, approved flag and language.

| lang | books | L1 | L2 | L3 | L4 | L5 | ASb-approved | EN available (sample of 20) |
|---|---|---|---|---|---|---|---|---|
| sw (Kiswahili) | 628 | 144 | 102 | 235 | 103 | 44 | 477 | 9/20 |
| so (Somali) | 92 | 45 | 26 | 13 | 7 | 1 | 70 | 19/20 |
| ar (Arabic) | 66 | 16 | 9 | 35 | 5 | 1 | 0 | 13/20 |
| en | 3,183 | – | – | – | – | – | 1,019 | – |

- **Licence.** Terms page says "openly licensed … read, download, print, copy, adapt and translate … without asking for permission". The Somali book 52187 states "Creative Commons: Attribution 4.0".
- **Text.** `newviewer/index.php?id=<id>&bt=1&dual=0` returns server-rendered HTML with one paragraph per page. The flipbook duplicates each page, so dedupe consecutive entries.
- **Translations.** POST `menubook.6.php` (id, bt) lists "Translations and adaptations" with language and a relation of Original, Translation or Adaptation. The ids in that list were blank, so the English twin was found by title in the catalogue.
- **Downloads.** `read/downloadepub.php?id=` returned 0 bytes in two tries, so EPUB is marked failed. Landscape and booklet PDFs exist via `read/downloadbook.php` and `downloadbooklet.php` but were not tested.
- **Pairs measured.**
  - Kiswahili "Banti na Sabuni" (2830) against "Bunty and Bubbly" (913): 5/5 pages and 6/6 sentences, all 14 tokens or fewer, with exact per-page alignment.
  - Somali "Dameer iyo Dibi" (52187) against "Donkey and Ox" (18333, L1 adaptation): 5/5 pages and 6/6 sentences, all 14 tokens or fewer, with exact alignment.
  - The English list for 52187 also offers "Ox and Donkey" (21628, L4), which is a different text. Choose the twin by matching page count.

## 4. Bloom Library (bloomlibrary.org): verified in browser

- **OPDS.** `/opds` redirects to docs.bloomlibrary.org, which documents an OPDS API. The live site itself uses Parse at `server.bloomlibrary.org/parse/classes/books` with the public header `X-Parse-Application-Id: R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5`. Count queries with `count=1&limit=0` and `$inQuery` on `langPointers` work.
- **Licence.** Per book in the `license` field, with values such as cc-by, cc-by-nc and cc-by-nc-sa. The aggregate endpoint needs the master key.
- **Text.** Books have a `baseUrl` on S3, and the book page shows a Download option. HTML text extraction from S3 was not tested this pass.

| iso | in circulation | + English | + English and CC BY/BY-SA/CC0 |
|---|---|---|---|
| ur | 12 | 7 | 2 |
| ko | 209 | 205 | 202 |
| fa | 2 | 2 | – |
| prs | 134 | 1 | 0 |
| hi | 187 | 134 | 27 |
| id | 375 | 109 | 30 |
| ar / arb | 5 / 2 | 4 / 1 | 3 |
| so | 12 | 7 | 0 |
| sw / swh | 21 / 365 | 14 / 294 | 6 / 235 |

## 5. Let's Read Asia (letsreadasia.org): verified in browser

- **API.** Language counts come from `letsreadasia.org/api/language/by_type`. Books come from `api/home/query?localization=<langId>&version=2`, and each book object carries the fields `license`, `masterBookId` (links translations), `availableLanguages`, `readingLevel`, `totalPages`, a public `epubUrl` on storage.googleapis.com, and `pdfUrl`.
- **Published counts.**

| lang | published |
|---|---|
| Urdu | 582 |
| Bahasa Indonesia | 373 |
| Dari | 126 |
| Pashto | 126 |
| Korean | 0 |
| English | 662 |

Hindi, Arabic, Somali and Swahili were not listed.

- **Home-feed samples.**

| lang | books | CC BY | CC BY-NC | CC BY-NC-SA | CC BY-NC-ND | Copyright | English available | country of origin |
|---|---|---|---|---|---|---|---|---|
| ur | 32 | 13 | 16 | 2 | – | 1 | 32/32 | mixed (Bangladesh, Pakistan) |
| id | 49 | 2 | 32 | – | 15 | – | 49/49 | Indonesia 46/49 |
| prs | 12 | 6 | 6 | – | – | – | 12/12 | mixed |

- **Reader.** `/read/<bookId>` renders the page text as HTML.

## 6. VOA language services: public domain, verified in browser

- **Terms.** voanews.com/p/5338.html says: "All text, audio and video material produced exclusively by the Voice of America is in the public domain." Wire and third-party material inside articles is excluded.
- **Coverage.** No English alignment, adult news register.

| site | loads | newest article date seen | sentences <=14 tok (3 articles) | notes |
|---|---|---|---|---|
| urduvoa.com | yes | 2025-03-15 | 18/50 (36%) | frozen since the March 2025 VOA shutdown |
| voakorea.com | yes | 2026-09-27 | 9/35 (26%) | live; 2 of 3 items were video with no body text |
| ir.voanews.com (Persian) | yes | 2026-09-27 | 16/32 (50%) | live |
| voaindonesia.com | yes | 2025-03-15 | 34/94 (36%) | frozen |
| voasomali.com | yes | newest text article 2024-04 | 25/35 (71%) | recent items are audio/video only; paragraphs are short |
| voaswahili.com | yes | 2025-01-13 (text to 2024-12-31) | 33/78 (42%) | frozen |
| voahindi.com | **n/r** | – | – | DNS does not resolve |
| radiosawa.com | **n/r** | – | – | DNS does not resolve |
| alhurra.com | **n/r** | – | – | navigation error. It is the Middle East Broadcasting Networks grantee, which is not VOA and not public domain |

## 7. Public-domain prose

Wikisource was checked through the MediaWiki API in the browser. All Wikisource sites are CC BY-SA 4.0, and the underlying old texts are public domain.

| site | finding | extractable |
|---|---|---|
| hi.wikisource | `लेखक:प्रेमचंद` links 58 works; a search for "प्रेमचंद कहानी" gives 131 hits, including प्रेमचंद की सर्वश्रेष्ठ कहानियाँ; 6,049 articles on the site | yes, via API |
| Urdu on wikisource.org | no Urdu Wikisource; a search for پریم چند returns 17 hits, all Punjabi Shahmukhi | no |
| Rekhta | footer says "COPYRIGHT © 2026 Rekhta Foundation. All rights reserved."; the terms-of-use page returned HTTP 500 | not usable |
| ar.wikisource | كليلة ودمنة has 21 chapter subpages plus 1816 and 1937 editions; 94,455 articles on the site | yes |
| fa.wikisource | کلیله و دمنه has 20 chapter subpages; 34,307 articles | yes |
| ko.wikisource | no folk-tale category; a search for 전래동화 gives 34 hits, mostly encyclopedia pages, one tale (망두석 재판) | yes, thin |
| id.wikisource | no Dongeng category; a search for "dongeng" gives 145 hits (Dongeng Sebelum Tidur and others); 14,080 articles | yes |

Premchand died in 1936, so his work is public domain in India. Wikisource copies are safe, and Rekhta's are not.

## Screenshots (in `SP/ss/`)

| site | file |
|---|---|
| StoryWeaver | `storyweaver-reader-ur.png`, `storyweaver-story.png`, `storyweaver-list.png` |
| GDL | `gdl-urdu-book.png`, `gdl-lang.png` |
| African Storybook | `asb-story-so-52187.png`, `asb-story-2830.png` |
| Bloom | `bloom-book-swh.png`, `bloom-sw.png` |
| Let's Read Asia | `lra-book-ur.png` |
| VOA | `voa-www.urduvoa.com.png`, `voa-www.voakorea.com.png`, `voa-ir.voanews.com.png`, `voa-www.voaindonesia.com.png`, `voa-www.voasomali.com.png`, `voa-www.voaswahili.com.png` |
| Wikisource / Rekhta | `wikisource-hi-premchand.png`, `rekhta-premchand.png` |

The scratchpad is session-scoped and may be wiped. Copy these files if they need to persist.

## Not done or open

- StoryWeaver per-level counts for fa, hi, id, ar and sw beyond L2 were not measured, because of the rate limit.
- StoryWeaver English pairing is a 6-story sample per language, not a full count.
- ASb EPUB came back empty. Its PDFs were not tried.
- GDL downloads are behind a human check. The Chrome extension path was not tried.
- Bloom S3 text extraction was not tested.
- LRA licence shares come from home-feed samples, not a full catalogue.
- Somali has no StoryWeaver or LRA content. ASb (~87 aligned books) is the only real source.
