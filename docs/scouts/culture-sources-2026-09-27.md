# Culture-native sentence source scout (2026-09-27)

Verification key: **[V]** = URL actually fetched / file actually downloaded and counted in this session. **[U]** = from web search only, not independently verified (mark before shipping any decision on it).

## Method note on verification depth

Given the ~60 min budget, one source — **Tatoeba** (community sentence corpus, not literature) — was downloaded and measured for all six languages via `https://downloads.tatoeba.org/exports/per_language/<iso3>/<iso3>_sentences.tsv.bz2` (confirmed working endpoint, files 0.2–3.9 MB each). All other candidates below are marked [U] unless a URL fetch is noted. Several strong leads (StoryWeaver's book-search API, Global Digital Library's book-api, VOA language-site RSS/API) could not be reached from this sandbox in the time available — endpoints returned 404 or empty/no response, not confirmation of absence. Those need a follow-up pass with a real browser (StoryWeaver/GDL search pages render via JS) rather than raw curl.

## Per-language tables

### Urdu (ur)

| source | url | size | licence | shippable text | English aligned | ≤14-tok share (sample) | register/level | use |
|---|---|---|---|---|---|---|---|---|
| Tatoeba ur **[V]** | downloads.tatoeba.org/exports/per_language/urd | 2,851 sentences, 202 KB | CC-BY 2.0 FR (per-sentence attribution) | yes, with attribution | no (links.tar.bz2, 150 MB, not fetched this pass — **[U]**) | 2,566/2,851 = 90% | mixed A1–B2, informal/learner-submitted, not literature | sentence |
| Tanzil ur.jalandhry (Qur'an Urdu translation) **[V; partial]** | tanzil.net/trans/ur.jalandhry | full Qur'an (6,236 ayat) | non-commercial only per translator; needs permission for other use | **no** — licence blocks default shipping | yes (parallel English translations exist on Tanzil) | not sampled — page is JS-rendered, static HTML had no ayah text | religious register, archaic/formal | sentence (if licensed) |
| StoryWeaver Urdu **[U]** | storyweaver.org.in | claimed ~53K books/~330 languages total (not broken out by language here); CC BY 4.0 | CC BY 4.0 | likely yes | yes (many titles have English + Urdu versions) | unknown | children's graded readers, ideal register for B1 | sentence/passage |
| VOA Urdu (urduvoa.com) **[U; partial]** | urduvoa.com | site reachable (HTTP 200); RSS/article-list endpoints not located from curl | US govt = public domain | yes | no (would need separate EN VOA scrape) | unknown | news register, above B1 | passage/frequency |
| Premchand/Manto public-domain Urdu prose **[U]** | archive.org, Rekhta | unknown | public domain (author deaths >70y for Premchand; Manto borderline by year) | likely yes for Premchand | no native EN parallel (would need existing translations, mixed licence) | unknown | literary register, may exceed B1 | passage |
| NCERT Urdu textbooks **[U]** | ncert.nic.in | unknown | CC BY-NC-SA (India govt open licence) | yes (NC restricts commercial use — check pack's own licence) | no | unknown | graded/pedagogical, good B1 fit | sentence/passage |

**Headline (Urdu):** (1) aligned shippable ≤14-tok sentences: **0 confirmed** this pass (Tatoeba is unaligned without the links file; Tanzil is licence-blocked). (2) unaligned shippable ≤14-tok sentences: **2,566** (Tatoeba, pending attribution handling). (3) best source: **StoryWeaver**, on paper — CC BY 4.0, English-paired, right register — but needs a real (JS-capable) crawl to confirm; Tatoeba is the only one actually in hand today.

### Korean (ko)

| source | url | size | licence | shippable | aligned | ≤14-tok share | register | use |
|---|---|---|---|---|---|---|---|---|
| Tatoeba ko **[V]** | .../per_language/kor | 15,941 sentences, 853 KB | CC-BY 2.0 FR | yes w/ attribution | no (unfetched links file) | 9,459/15,941 = 59% | mixed, informal | sentence |
| Korean folk-tale collections (e.g. "Korean Folk Tales" archive.org) **[U]** | archive.org | unknown | mixed, check per volume | unknown | rare | unknown | literary/oral, good cultural fit | passage |
| KBS/NHK-style easy news **[U]** | not located (KBS "easy Korean news" not confirmed to exist as of this scout) | — | — | — | — | — | — | — |

**Headline (Korean):** aligned shippable ≤14-tok: 0 confirmed. Unaligned: **9,459** (Tatoeba). Best source: Tatoeba confirmed; folk-tale collections promising but unverified.

### Persian (fa)

| source | url | size | licence | shippable | aligned | ≤14-tok share | register | use |
|---|---|---|---|---|---|---|---|---|
| Tatoeba fa **[V]** | .../per_language/pes | 31,793 sentences, 2.4 MB | CC-BY 2.0 FR | yes w/ attribution | no (unfetched) | 27,647/31,793 = 86% | mixed, informal | sentence |
| Persian folk tales / simplified Shahnameh **[U]** | archive.org, Ganjoor | unknown | mostly public domain (classical texts) | likely yes | no | unknown | literary, may exceed B1 | passage |
| Bijankhan corpus **[U]** | linguistic-datasets | unknown | academic/research licence, unclear commercial reuse | unclear | no | unknown | news/formal register | frequency |

**Headline (Persian):** aligned: 0 confirmed. Unaligned: **27,647** (Tatoeba, largest yield of the six).

### Hindi (hi)

| source | url | size | licence | shippable | aligned | ≤14-tok share | register | use |
|---|---|---|---|---|---|---|---|---|
| Tatoeba hi **[V]** | .../per_language/hin | 16,475 sentences, 1.4 MB | CC-BY 2.0 FR | yes w/ attribution | no (unfetched) | 13,288/16,475 = 80% | mixed, informal | sentence |
| NCERT Hindi readers **[U]** | ncert.nic.in | unknown | CC BY-NC-SA | yes, NC caveat | no | unknown | graded/pedagogical | sentence/passage |
| Premchand Hindi prose **[U]** | archive.org, Gutenberg-adjacent mirrors | unknown | public domain | yes | no | unknown | literary, above B1 in places | passage |

**Headline (Hindi):** aligned: 0 confirmed. Unaligned: **13,288** (Tatoeba).

### Indonesian (id)

| source | url | size | licence | shippable | aligned | ≤14-tok share | register | use |
|---|---|---|---|---|---|---|---|---|
| Tatoeba id **[V]** | .../per_language/ind | 28,333 sentences, 1.4 MB | CC-BY 2.0 FR | yes w/ attribution | no (unfetched) | 22,140/28,333 = 78% | mixed, informal | sentence |
| Indonesian dongeng (folk tales) **[U]** | various .id sites, archive.org | unknown | mixed/unclear | unknown | rare | unknown | oral/literary, good cultural fit | passage |
| BSE textbooks (Buku Sekolah Elektronik) **[U]** | buku.kemdikbud.go.id | unknown | govt open licence (needs confirming exact terms) | likely yes | no | unknown | graded/pedagogical | sentence/passage |
| UNESCO/Global Digital Library Indonesian **[U, per search only]** | digitallibrary.io | search result claims "300+ books in Indonesian + 26 local languages" (UNESCO article, not independently confirmed via API this pass) | CC BY (GDL standard) | likely yes | yes (GDL ships parallel-language books) | unknown | children's graded readers | sentence/passage |

**Headline (Indonesian):** aligned: 0 confirmed. Unaligned: **22,140** (Tatoeba). GDL is the promising aligned candidate, unverified.

### Arabic (ar)

| source | url | size | licence | shippable | aligned | ≤14-tok share | register | use |
|---|---|---|---|---|---|---|---|---|
| Tatoeba ar **[V]** | .../per_language/ara | 68,568 sentences, 3.9 MB | CC-BY 2.0 FR | yes w/ attribution | no (unfetched) | 39,586/68,568 = 58% | mixed, informal, largest raw pool | sentence |
| Kalila wa Dimna (public-domain fables) **[U]** | archive.org | unknown | public domain (classical text) | yes | no native parallel found | unknown | literary/fable register, culture-native, non-religious | passage |
| Juha (Joha) tales **[U]** | various folklore sites | unknown | mostly public domain / folklore | yes | no | unknown | oral/folk register | passage |
| African Storybook (Arabic titles) **[U]** | africanstorybook.org | unknown | CC BY 4.0 | yes | yes (many titles ship English + Arabic) | unknown | children's graded readers | sentence/passage |
| KALIMAT / Arabic children's-book corpora **[U]** | research literature references | unknown | research/academic, commercial reuse unclear | unclear | unclear | unknown | children's register | sentence |

**Headline (Arabic):** aligned: 0 confirmed. Unaligned: **39,586** (Tatoeba — also the largest absolute pool of the six, useful given Arabic pack already has the smallest generated-sentence problem at 9%).

## Urdu measurement (the worst case: 2,273 generated sentences)

Source used: Tatoeba Urdu sentence export (2,851 sentences; 2,566 in the 4–14 token range after stripping Urdu punctuation and whitespace-tokenizing).

- Generated ("gen") sentences in `urdu/pack/sentences.json`: **2,273** of 3,018 total.
- Distinct target word ids referenced across those 2,273 gen sentences (via each sentence's `words` → `urdu/pack/words.json` `id`, matched on `w` + `alt` surface forms): **1,846**.
- Distinct target words that occur (surface-form match) in at least one Tatoeba source sentence of 4–14 tokens: **868 / 1,846 (47%)**.
- Generated sentences with *at least one* of their target words found in a source sentence: **2,272 / 2,273 (~100%)** — this number is not meaningful on its own: most gen sentences include common function words (میں, ہے, کا …) that appear in nearly every Tatoeba sentence, so "any word matches" saturates immediately. The 47% distinct-word figure is the informative one — it means roughly half the actual target vocabulary items have zero real-corpus attestation in this one source, so full replacement of the 2,273 generated sentences from Tatoeba alone is not possible; supplementing with a second source (Persian/Urdu literature or GDL/StoryWeaver, both unverified this pass) would be needed to close the other 53%.

15 sample (target word, real Tatoeba sentence) pairs, judged for B1 fit:

| target word | example sentence | B1 fit |
|---|---|---|
| سائنس (science) | میرا سائنس پڑھنے کا موڈ نہیں ہو رہا۔ | good — natural, everyday register |
| سب (all) | اس نے سب کچھ جیت لیا۔ | good |
| جانا (to go) | میں نے سیٹل جانا ہے۔ | fair — colloquial/regional phrasing ("سیٹل جانا") |
| سچ (truth) | میں تمھیں سچ بتا رہا ہوں۔ | good |
| دونوں (both) | گیند کو دونوں ہاتھوں سے پکڑو۔ | good |
| تھوڑا (a little) | بس تھوڑا سا صبر اور۔ | fair — fragment, no verb, slightly below A2 sentence norms |
| سیاست (politics) | مریم کو سیاست میں دلچسپی ہے۔ | good, clean B1 sentence |
| چائے (tea) | ہمیں دو کپ چائے اور ایک کپ کافی لا دینا۔ | good |
| چال (trick/manner) | اسلام علیکم بل۔ کیا حال چال ہے؟ | poor — proper noun "بل" (Bill) breaks generality, greeting-register fragment |
| ہاں (yes) | ہاں، یہ بڑے آرام سے ہو سکتا ہے۔ | good |
| گیت (song) | میں نے اس گیت کا فرانسیسی ورژن سنا ہوا ہے۔ | good, slightly long/complex for A2 but fine for B1 |
| دکھ (sorrow) | میرے خیال میں کوئی دوست نہ ہونا بہت دکھ کی بات ہے۔ | good, natural B1 |
| احاطہ (compound/premises) | گاڑی احاطہ میں کتنی گاڑیاں ہیں؟ | fair — slightly awkward phrasing, but usable |
| اسی (that very / same) | میں تھکا ہوا تھا اسی لئے میں سونے چلا گیا۔ | good |
| شفقت (affection/kindness) | ہیری بلیوں کے ساتھ شفقت سے پہش آتا ہے۔ | fair — contains a typo ("پہش" for "پیش"), needs cleanup before shipping |

Overall: roughly 11/15 sampled sentences are clean, natural B1-appropriate examples; a few carry typos, fragments, or over-colloquial phrasing typical of a crowd-sourced corpus, so any Tatoeba-sourced sentence would need a light QA pass, not verbatim ingestion.
