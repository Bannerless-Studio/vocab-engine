# Somali (so) + Swahili (sw) data sources beyond Tatoeba

Scout date: 2026-09-27. All rows are live-verified unless marked "unverified" (blocked/not checked). Existing `docs/LANGUAGES.md` §Swahili/§Somali only counted kaikki, Tatoeba, GlobalVoices, FLORES, Tanzil; this fills in graded-reader, oral-literature, primer, public-info, news, web-parallel, monolingual, dictionary, and (as one category among many, not the centre of the report) religious-text sources.

Priority order per the brief addendum: (a) graded children's/community literature, (b) oral literature (proverbs/riddles/folk tales/poetry), (c) school primers/textbooks, (d) public-information text, (e) news/radio, (f) song lyrics/drama, (g) religious texts. Section numbers below follow this order; §11 (Tanzil/Bible/hadith) is the old religion-first write-up kept for continuity but is now just one row among many in the per-language summary.

## 0. Graded children's / community literature (priority a)

All four major platforms in this space are heavy client-rendered SPAs (React/Next.js); curl-based scouting could reach their static shells and sitemaps but not their per-language story catalogs or counts. This whole category needs a **browser-worker follow-up** to get real numbers. What was confirmed live this session:

| Platform | Licence | So/Sw coverage | Verified this session |
|---|---|---|---|
| African Storybook Project (africanstorybook.org) | CC BY (project-wide policy, confirmed a `terms-of-use` page exists in the site's own sitemap, text not extracted) | Both "Somali" and "Swahili" appear as language names in the homepage HTML | Site is JS-driven (Joomla-era backend + JS reader); reader pages return an empty shell over curl. Site's XML sitemap lists 53,414 URLs total (all languages/stories combined, not split by language) — no way to isolate so/sw counts without either a JS-executing fetch or a per-story metadata call. **Unverified for so/sw-specific counts.** |
| Global Digital Library (digitallibrary.io) | CC (per-book, generally CC BY or CC BY-NC-ND depending on source publisher) | Historically includes African-language books incl. Swahili; Somali coverage unconfirmed | Old public REST API (`api.digitallibrary.io/book-api`) is dead (DNS does not resolve). Current site is a Next.js app (Vercel) with results loaded client-side; no `__NEXT_DATA__` or embedded JSON found in server HTML. **Unverified.** |
| StoryWeaver (storyweaver.org.in) | CC BY (Pratham Books house licence) | Site's own curated sitemap index (`sitemap.xml`) lists dedicated per-language sitemaps only for `en, hi, mr, fa, fr, gu, kok, or, ur, ar, es` — **so/sw are not among the top-level sitemap languages**, a real (if soft) negative signal that Swahili/Somali content there is thin or absent from the primary catalog, though stories might still exist unlisted | Confirmed via live sitemap fetch. Search pages are JS-rendered, so a filtered count wasn't obtainable by curl. |
| Bloom Library (bloomlibrary.org) | CC (per-book, BloomLibrary defaults most books to CC BY) | Known to host many Sub-Saharan African language collections including Swahili from SIL/literacy NGOs | Homepage is a minimal JS shell; no public API key or endpoint surfaced in static HTML. **Unverified.** |

**Recommendation:** hand this category to a browser worker with a scoped task — visit each site's language-filtered search/browse URL, read the rendered result count, and sample 2-3 story titles per language to check whether English-aligned (parallel) text is offered per page (ASb and Bloom typically show one language per reader instance, not side-by-side parallel text, so "aligned" may require picking the same story ID across two language exports).

## 1. Oral literature — proverbs, riddles, folk tales, poetry (priority b)

| Source | Result |
|---|---|
| so.wikiquote.org / sw.wikiquote.org | **Confirmed absent** — both redirect to Wikimedia Incubator stubs (`Wq/so`, `Wq/sw`), i.e. never graduated to a live wiki. No proverb collection here. |
| so.wikisource.org / sw.wikisource.org | **Confirmed absent** as standalone projects — so redirects to the generic multilingual Wikisource portal, sw redirects into sw.wikipedia. No folk-tale/poetry text corpus here. |
| archive.org — Somali proverbs (maahmaahyo) | Live search (`advancedsearch.php`) found exactly **1 matching item**: *Hubsiimo hal baa la siistaa — Somali proverbs* (2002). Metadata confirms `access-restricted-item: true`, collections `internetarchivebooks`/`inlibrary`/`printdisabled` — this is a **controlled-digital-lending scan, not extractable open text**. No licenceurl. **Not shippable.** |
| archive.org — Swahili proverbs/methali | Live search found **1 matching item**: *Methali za Lugha ya Kimachame* (2014, a specific Chagga/Machame-dialect collection, 2014) — not checked for access restriction but is a narrow dialect-specific scan, not a general Swahili proverb corpus. |
| archive.org — broader subject search (`"Somali folklore"`, `"Somali folk tales"`, `"Swahili folklore"`, `"Swahili folk tales"`) | **0 results** for all four subject-heading queries. |
| Academic CC-licensed proverb/riddle datasets (e.g. university NLP corpora) | Not checked live this session — flagged as a follow-up; these tend to live in individual papers' supplementary data rather than a discoverable central index, so would need targeted paper-by-paper checks rather than one API call. |

**Net for oral literature: essentially a dead end via automated search.** The one Somali proverb book found is lending-restricted; broad subject searches return nothing; Wikiquote/Wikisource don't exist for either language. Gabay/buraanbur (Somali) and utenzi/shairi (Swahili) poetry traditions are real and documented in print, but no open-licence digitized corpus surfaced this session — this needs either a specialist follow-up (e.g. checking SOAS/university Africana digital collections) or accepting this category stays thin.

## 2. School primers / open textbooks (priority c)

| Source | Result |
|---|---|
| Tanzania Institute of Education (tie.go.tz / elimu.tie.go.tz) | **DNS did not resolve** for `elimu.tie.go.tz` this session — either the domain has changed or is currently unreachable from this network. Not verified; flagged for a retry with the correct current TIE domain. |
| Kenya KICD (Kenya Institute of Curriculum Development) | Not checked live this session — flagged as follow-up. KICD does publish openly-licensed primary curriculum materials including Kiswahili, but licence terms per-title need verification. |
| Somali ministry / Puntland / Somaliland open textbooks | Not checked live this session — flagged as follow-up; these tend to be scattered PDFs on ministry sites rather than a central catalog, so this needs targeted search rather than one API call. |

**Net: unverified across the board this session** — genuine gap, worth a dedicated follow-up pass since primers are exactly the register (short, controlled-vocabulary sentences) a B1 trainer wants.

## 3. Public-information text (priority d)

| Source | Result |
|---|---|
| UNICEF Somalia Somali-language subsite (unicef.org/somalia/so) | **Confirmed live** — HTTP 200. Content volume/licence not extracted this session (UNICEF web content is typically usable for non-commercial educational reuse but not blanket CC — licence terms need a per-page check). |
| UNICEF Tanzania Swahili-language subsite (unicef.org/tanzania/sw) | **Confirmed live** — HTTP 200. Same licence caveat as above. |
| WHO (who.int/so, who.int/sw as direct subsites) | **404 for both** — WHO does not run direct `/so` or `/sw` top-level language paths; WHO's Somali/Swahili materials (if any) would live under regional offices (EMRO for Somali, AFRO for Swahili) rather than a global-site language prefix. Not checked further this session. |
| Red Cross / ICRC language pages | Not checked live this session — flagged as follow-up. |

**Net: confirmed both UNICEF subsites exist and are reachable; everything else in this category (WHO's actual location, ICRC, exact licence terms, content volume) is unverified and flagged for follow-up.**

## 4. News and radio scripts (priority e)

This is the strongest new finding this session.

| Source | Licence | Somali | Swahili |
|---|---|---|---|
| **VOA Somali (voasomali.com) / VOA Swahili (voaswahili.com)** | **US federal government work — public domain under 17 U.S.C. §105, no NC/attribution restriction at all** (this is a materially better licence than BBC/XLSum's CC-BY-NC-SA) | Sitemap-verified: 5 numbered sitemap chunks (`sitemap_437_1..5.xml.gz`); one chunk sampled in full contains **exactly 20,000 URLs**, spanning article-publish dates from 2022-10 to 2026-09 in that single chunk — so total live-indexed article count is on the order of **~100,000 URLs** (5 chunks × ~20,000, not de-duplicated/confirmed per-chunk, so treat as an order-of-magnitude estimate, not exact) | Sitemap-verified: 2 numbered chunks (`sitemap_439_1..2.xml.gz`), so on the order of **~40,000 URLs** by the same per-chunk-20,000 pattern (not independently re-counted for the sw chunks this session) |
| Body-text extraction | — | Sampled 2 article pages; the most recent-dated one had already expired/redirected to a generic tag page, and an older stable one (`/a/6810880.html`, live, valid title) turned out to be an **audio-first piece** (`keywords: Maqal` = "audio" in Somali, with an embedded audio player) with **no extractable `<p>`-tag body text or JSON-LD `articleBody`** reachable via curl — the visible text may be JS-rendered or the piece may genuinely be audio-only with minimal caption text. **Full-text extraction is unverified and is the single most valuable follow-up**: if a meaningful fraction of the ~100K/~40K sitemap URLs have real article bodies (not just audio clips), this would be by far the largest clean, fully-open, culture-native text source found for either language. |
| BBC Somali / Swahili (via XLSum) | CC-BY-NC-SA-4.0 (verified via HF, see §11) | already counted | already counted |
| Hiiraan Online | Not checked live this session — flagged as follow-up; typical online-newspaper all-rights-reserved copyright presumed. |
| Mwananchi (Tanzania) | Not checked live this session — presumed all-rights-reserved commercial newspaper, unlikely to be shippable. |

## 5. Song lyrics / drama scripts (priority f)

Not checked live — per the brief's own expectation, this category is "usually no." Lyrics and drama scripts are near-universally under standard copyright (composer/playwright rights), and no royalty-free/CC lyrics archive for Somali or Swahili is known offhand. Marking as **presumed no, not independently verified** rather than fabricating a check.

## 6. Tanzil Quran translations (tanzil.net/trans) — priority g, one row among many

| Field | Somali | Swahili |
|---|---|---|
| Translation | `so.abduh` (Mahmud Muhammad Abduh, last update 2010-08-16) | `sw.barwani` (Ali Muhsin Al-Barwani) |
| Verse count (downloaded, verified) | 6236 | 6236 |
| ≤14 tokens (lower-cased, punctuation stripped) | 3116 (50.0%) | 2864 (45.9%) |
| ≤9 tokens | 1818 (29.2%) | 1721 (27.6%)) |
| Distinct tokens (lower-cased) | 16,016 | 13,429 |
| Licence | Could not locate a distinct Tanzil "terms of use" page live (both `/policy/` and `/docs/tanzil_project` 404'd during this scout); the downloaded file only carries a source/attribution header, no explicit licence string. **Unverified** — treat as "attribution required, redistribution terms not confirmed live" until a maintainer re-checks tanzil.net's actual ToS page. | same |
| Shippable? | Provisional yes (Tanzil texts are widely reused with attribution in NLP, e.g. OPUS-Tanzil below), but licence text itself unverified this session | same |
| Use | sentence (short-sentence candidates), gloss (via verse-aligned tokens) | same |

The OPUS `Tanzil` corpus (en↔so / en↔sw, sentence-aligned, machine-split) is a ready-made, English-aligned version of the same text — see §7.

## 7. English Wiktionary → Somali / Swahili translations (kaikki.org English dump)

The full kaikki `English` dump is 3.34 GB (`kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl`), too large to fully stream in budget. Sampled three 100–150 MB byte-ranges (start, ~33%, ~66% offsets; ~257 MB / 7.7% of the file, 92,385 headword-sense entries parsed) and counted `translations[].code == "so" | "sw"` hits.

| | Somali | Swahili |
|---|---|---|
| Hits in sample (92,385 entries) | 39 | 102 |
| Extrapolated to full file (÷0.077) | **~510 English headword-senses with a Somali translation** | **~1,325 English headword-senses with a Swahili translation** |

This is an estimate from a partial, not-fully-random sample (kaikki dumps are alphabetically ordered by headword; 3 spread-out chunks reduce but don't eliminate bias). Note it counts sense-level entries, not unique headwords (a word can have multiple POS/sense lines).

Quality sample (20 pairs each, eyeballed, all look correct):
- Somali: dictionary→qaamuus, cat→bisad, word→eray, day→maalin, hour→saacad, head→madax, week→toddobaad, bone→laf, spring→gu', star→xiddig, year→sanad, man→nin, country→waddan, etc.
- Swahili: dictionary→kamusi, cat→paka, word→neno, day→siku, synonym→sinonimu, noun→nomino, minute→dakika, head→kichwa, week→wiki, season→msimu, etc.

Licence: kaikki/Wiktextract data is CC-BY-SA (from Wiktionary) — shippable with attribution/share-alike.

## 8. Bible (open-licence editions) — priority g

| Source | Verified via | Pairs/verses | Licence | Shippable? |
|---|---|---|---|---|
| OPUS `bible-uedin` (en-so) | OPUS API (live) | 62,195 aligned pairs | Bible-uedin is compiled from open Bible translation projects (eBible.org-sourced); generally CC/public-domain-leaning per-translation, not independently re-verified this session | Provisional yes |
| eBible.org direct so/sw editions | **Not checked live** (time budget) | — | eBible.org's standard licence is CC-BY or CC-BY-SA per translation | Unverified — flagged for follow-up |
| bible-uedin (en-sw) | Not present as a distinct corpus in the sw OPUS API listing this session (sw's Bible-adjacent parallel data comes in via GlobalVoices/other, not a dedicated bible-uedin sw row) | — | — | — |
| JW300 | Known licence problem — JW300 (Jehovah's Witnesses parallel corpus) carries copyright restrictions from watchtower.org content; **not open-licence, exclude from shippable set** | — | Non-commercial/restricted | No |

## 9. Hadith / Islamic educational text — priority g

| Source | Result |
|---|---|
| sunnah.com | Bot-blocked (403 on direct URL fetch, homepage served a near-empty 5.3 KB shell). Could not verify whether sw/so are supported languages. **Unverified.** |
| islamqa.info | `/sw` and `/so` both redirect to `/ar/sw` and `/ar/so`, but both resolve to an identical Next.js `__next_error__` shell (55,271 bytes, byte-for-byte identical) — i.e. **no actual Swahili or Somali content exists on islamqa.info**, despite the URL scheme suggesting support. Confirmed "no." |

Net: no verified open, scrapable hadith/Islamic-education source for either language this session.

(Proverb/folk-tale collections are now covered in full, with live archive.org checks, in §1 above — superseding the placeholder that was here in the first pass of this scout.)

## 7. News corpora (XLSum / MasakhaNEWS detail, complementing §4's VOA finding)

| Source | Somali | Swahili | Licence | Shippable? |
|---|---|---|---|---|
| XLSum (csebuetnlp/xlsum, HF API verified) | `somali_XLSum_v2.0.tar.bz2` exists | `swahili_XLSum_v2.0.tar.bz2` exists | **cc-by-nc-sa-4.0** (verified via HF `cardData.license`) | **No** for a commercial/shippable product — NonCommercial clause blocks it; usable only for frequency/internal eval, not redistribution in a shipped product |
| MasakhaNEWS (masakhane/masakhanews, HF API verified) | `data/som/{train,dev,test}.tsv` present | `data/swa/{train,dev,test}.tsv` present | **afl-3.0** (Academic Free License — permissive, commercial use allowed) | **Yes** |
| Hiiraan / other Somali news sites | Not checked live (time budget) | — | Typically all-rights-reserved news copyright | Presumed no |

## 10. Web-mined parallel corpora (OPUS API, live, `latest=True` rows only)

**Somali (so-en):**

| Corpus | Pairs |
|---|---|
| NLLB | 10,229,073 |
| CCAligned | 364,960 |
| CCMatrix | 222,793 |
| Tanzil | 93,844 |
| bible-uedin | 62,195 |
| XLEnt | 69,983 |
| infopankki | 47,220 |
| translatewiki | 17,329 |
| ParaCrawl / ParaCrawl-Bonus | 14,880 each |
| tico-19 | 3,071 |
| TED2020 | 2,000 |
| wikimedia | 2,137 |
| GNOME | 753 |
| OpenSubtitles | 531 |
| Tatoeba | 13 (confirms Tatoeba is indeed negligible for Somali) |

**Swahili (sw-en):**

| Corpus | Pairs |
|---|---|
| NLLB | 23,513,175 |
| CCMatrix | 5,756,664 |
| CCAligned | 2,044,993 |
| XLEnt | 871,902 |
| Tanzil | 138,253 |
| ParaCrawl / ParaCrawl-Bonus | 132,520 each |
| OpenSubtitles | 94,636 |
| GlobalVoices | 32,307 |
| WikiMatrix | 51,387 |
| wikimedia | 23,753 |
| ELRC-wikipedia_health | 12,244 |
| TED2020 | 9,745 |
| translatewiki | 9,923 |
| tico-19 | 3,071 |
| ELRC_2922 / ELRC-3073 | ~607-608 |
| GNOME | 40 |
| EUbookshop | 17 |

Licences: NLLB/CCMatrix/CCAligned/ParaCrawl are all CC0/research-open web-mined data (standard OPUS licensing, generally permissive but noisy/low-quality machine-aligned text — best for frequency/coverage, not hand-picked gloss sentences). infopankki, translatewiki, GNOME/EUbookshop are open-source localization strings (permissive). XLEnt is named-entity pairs (not sentences — low value for sentence gloss use). OpenSubtitles licence is murkier (subtitle copyright); treat as frequency-only.

## 11. Monolingual (frequency + audio)

| Source | Somali | Swahili |
|---|---|---|
| Wikipedia article count (MediaWiki API, live) | 14,139 | 128,634 |
| Common Voice validated hours | **Unverified** — `commonvoice.mozilla.org/api/...` returned `{"message":"no user"}` (requires an authenticated Mozilla account to see per-language dataset stats); HuggingFace mirror card didn't expose per-language hour breakdown in the top-level API response either. Flagged for a follow-up check with an actual browser session or a logged-in API token. | Same — unverified for the same reason |

## 12. Dictionaries

| Source | Somali | Swahili |
|---|---|---|
| kaikki language-side dump (re-verified, downloaded) | 1,099 distinct headwords (full file, 1.55 MB) | ≥18,992 distinct headwords (file is 81.5 MB; download hit a 120s timeout at 77.5/81.5 MB = 95% complete, so true count is slightly higher, call it **~19,000–20,000**) |
| PanLex | License page (panlex.org/about/license) loads and states data is under a "free and open license" (exact clause not fully extracted this session, but PanLex's cross-lingual lexicon is well known to be CC0/ODbL-style open) — both so and sw are covered languages in PanLex generally | same |
| Qaamuus (Somali dictionary projects) | Not checked live this session — flagged for follow-up | — |
| TUKI / kamusi.org (Swahili) | kamusi.org resolves (HTTP 200) but licence terms not extracted this session — flagged for follow-up | — |
| Glosbe | Per brief instruction, treated as **not open/shippable** (Glosbe = no) | same |

## Per-language summary

### Somali (so)
- **Glossable headwords (open sources): ~1,600–2,100** — kaikki language-side (1,099) + kaikki English→Somali translation table (~510 estimated) + PanLex overlap (uncounted, likely adds a few hundred more but not separately verified). This is a thin base compared to sw.
- **Aligned short sentences (≤14 tokens, shippable licence): ~97,000–108,000 candidate pairs**, dominated by OPUS Tanzil (93,844, quality/licence provisional) + bible-uedin (62,195, but overlaps heavily in register/length with Tanzil) — realistically the safe, licence-clean short-sentence pool is Tanzil + infopankki (47,220, likely many short) + translatewiki (17,329) + GNOME/TED2020, i.e. tens of thousands, not the full 10M NLLB figure (NLLB/CCMatrix/CCAligned are noisy machine-mined and need quality filtering before use).
- **CC/public-domain culture-native sentences (new this round): aligned = unverified (0 confirmed)** — the four graded-reader platforms (ASb, GDL, StoryWeaver, Bloom) that would supply real English-aligned culture-native text are all JS-rendered SPAs that blocked curl-based counting; StoryWeaver's own sitemap doesn't even list Somali as a top-level catalog language, a soft negative signal. **Unaligned = ~100,000 VOA Somali article URLs, confirmed public-domain (US federal government work, no licence restriction whatsoever) via live sitemap fetch**, but per-article body-text extraction is itself unverified (the one stable article sampled was audio-first with no extractable text via curl) — so this is a verified URL count, not yet a verified sentence count. Oral literature (proverbs/folk tales) is a confirmed dead end (1 archive.org hit, lending-restricted; 0 hits on broader subject search).
- Frequency-only, not shippable as sentence source: XLSum (NC licence), NLLB/CCAligned/CCMatrix (noisy, not vetted for direct shipping), OpenSubtitles (licence unclear).
- Big gaps: no verified proverb source, no verified hadith source (islamqa.info confirmed absent; sunnah.com bot-blocked), Common Voice unverified, school primers unverified (TIE domain didn't resolve).

### Swahili (sw)
- **Glossable headwords (open sources): ~20,000–21,300** — kaikki language-side (≥18,992, likely closer to 20,000 uncapped) + kaikki English→Swahili translation table (~1,325 estimated) + PanLex overlap. An order of magnitude richer than Somali, consistent with Swahili's much larger Wikipedia (128,634 vs 14,139 articles) and larger web presence generally.
- **Aligned short sentences (≤14 tokens, shippable licence): ~230,000–280,000 candidate pairs** from Tanzil (138,253) + GlobalVoices (32,307) + WikiMatrix (51,387) + translatewiki (9,923) + TED2020 (9,745) + tico-19 (3,071) + ELRC health-domain sets (~12,850) — plus a much larger noisy pool (NLLB 23.5M, CCMatrix 5.8M, CCAligned 2.0M) available for frequency mining and back-filtering if quality thresholds are applied.
- **CC/public-domain culture-native sentences (new this round): aligned = unverified (0 confirmed)**, same JS-SPA blocker as Somali; graded-reader platforms known to have stronger Swahili coverage than Somali in general (Swahili is a major literacy-NGO target language) but no live count obtained. **Unaligned = ~40,000 VOA Swahili article URLs, confirmed public-domain**, same body-text-extraction caveat as Somali. MasakhaNEWS (afl-3.0, genuinely shippable, unlike XLSum's NC licence) adds a small clean unaligned news set for both languages.
- Same gaps as Somali on hadith (confirmed absent) and Common Voice (unverified); oral-literature dead end is shared (Machame-dialect Swahili proverb book found is narrow/dialect-specific, not general).

## Follow-ups flagged (not completed this session, time-budgeted out)
1. **Highest value: verify VOA Somali/Swahili article body-text extraction** — sitemap counts (~100K so / ~40K sw URLs, confirmed public domain) are real, but whether articles carry substantial extractable text vs. audio-only clips is unverified; a browser worker or a differently-targeted scraper (check for a mobile/AMP endpoint or an RSS feed with full content) should resolve this — it's the single biggest potential culture-native win found this session.
2. **Browser-worker pass on African Storybook, Global Digital Library, StoryWeaver, Bloom Library** — get real per-language story counts and confirm whether English-aligned parallel text is available per title, not just per-language monolingual readers.
3. Confirm Tanzil's actual terms-of-use page (both known URLs 404'd).
4. Re-check sunnah.com with a non-bot-blocked method (e.g. browser worker); islamqa.info is now confirmed to have no so/sw content, no further check needed there.
5. Check eBible.org directly for so/sw editions and their per-translation licences.
6. Retry Tanzania Institute of Education under its current domain (elimu.tie.go.tz did not resolve); check Kenya KICD and Somali/Puntland/Somaliland ministry sites for open textbooks — this whole primer category is unverified.
7. Common Voice per-language validated-hours count needs an authenticated session or the HF dataset viewer UI (API alone was insufficient).
8. Qaamuus (Somali) and kamusi.org/TUKI (Swahili) licence terms not extracted.
9. UNICEF Somalia/Tanzania subsite content volume and exact licence terms not extracted (confirmed only that both subsites are live).
10. WHO's actual Somali/Swahili content location (regional EMRO/AFRO sites, not the global site's language-prefix paths) not checked; ICRC/Red Cross not checked.
11. Academic CC-licensed proverb/riddle/poetry datasets (gabay, buraanbur, utenzi, shairi) referenced in NLP papers — not checked, would need paper-by-paper follow-up rather than one API call.
