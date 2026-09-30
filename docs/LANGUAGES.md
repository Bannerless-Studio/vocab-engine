# Language data sources (verified 2026-09-23)

Scout findings per language: sources, licences, counts, and pipeline gotchas. Italian and Spanish sources are documented in their repos. Audio counts are Tatoeba clips with permissive licences (CC BY / CC BY-SA / CC0) only.

# French (fr / Tatoeba fra) — verified 2026-09-23
- hermitdave fr_full.txt 834,768 rows, lowercased; elision fragments (c', l', j', d', qu') are standalone tokens → reattach
- wordfreq fr ok (large)
- kaikki French jsonl.gz 57MB
- Tatoeba fra_sentences_detailed 726,753; links.tar.bz2 149.8MB; eng 24.9MB
- Audio: 106,472 clips, permissive only 4,093 (CC BY 4.0 3,396; CC BY-SA 672; CC0 25). Top permissive: Igider, vlecomte, Meksems, Them, MisterTrouser
- Tagger: spaCy fr_core_news_sm 3.8.0, LGPL-LR (no NC)
- Kelly mirror data/fr.json is FAKE (rebucketed wordfreq) — don't use for sanity
- Gotchas: elision merge; gender/articles le/la/l'/les, un/une; clitics precede verb; reflexive "se" verbs (se lever) lemma convention; contractions au/du/aux/des; spaCy apostrophe tokens; typing lenient accents A1/A2 (é/è/ê/ç); TTS fr-FR fine; STT fr-FR

# Russian (ru / Tatoeba rus) — verified 2026-09-23
- hermitdave ru_full.txt 615,157 rows; ё NOT normalised (её 201,916 vs ее 232,065; 12,513 ё lines) → fold both sides to е for matching, display kaikki ё
- wordfreq ru large
- kaikki Russian jsonl.gz 89MB; entries carry stressed headwords (соба́ка) → pron display from kaikki accents
- Tatoeba rus_sentences_detailed 1,225,086; links.tar.bz2; eng_sentences_detailed 34.9MB
- Audio: 32,606 clips; permissive only 1,390 (CC BY 4.0 1,093; CC BY-SA 295; CC0 2); 81% NC-ND from CK
- Tagger: spaCy ru_core_news_sm 3.8.0 MIT; lemmatiser pymorphy3 (MIT) required
- Kelly ru.json: 8,958 words, real CEFR tiers, "research use only" → sanity only
- TORFL lexical minimum: no open copy
- Gotchas: aspect pairs → separate entries (делать / сделать), cross-link via alt? no — separate; -ся verbs separate lemmas; A1 sentences prefer Nom/Acc (use Case= morph), defer other cases to A2/B1; typing lenient ё/е and no stress; no articles; TTS ru-RU; STT ru-RU

# German (de / Tatoeba deu) — verified 2026-09-23
- hermitdave de_full.txt 1,157,685 rows, 100% lowercased → noun capitalisation lost; recover case from kaikki headword, disambiguate homographs (essen/Essen) by kaikki POS
- wordfreq de large (633,824)
- kaikki German jsonl.gz 96.7MB; gender (der/die/das) + plural from head_templates/forms — field names unverified, sample ~5 entries (gehen, Tisch, anfangen) before locking
- Tatoeba deu_sentences_detailed 781,130; deu-eng_links 584,787 (direct file)
- Audio: 86,209 clips; permissive only 2,881 (CC BY 4.0 2,423; CC BY-SA 434; CC0 24). Top permissive: Igider, MisterTrouser, fjay69, Auride, Meksems
- Tagger: spaCy de_core_news_sm 3.8.0 MIT (TIGER corpus commercial-licensed to Explosion, WikiNER CC BY 4.0; model weights redistributable)
- Graded lists: Goethe Wortlisten copyrighted (don't ship); Kelly has no German; GitHub CEFR lists are Goethe transcriptions / unlicensed → sanity-only at best
- Gotchas: separable verbs (anfangen → fängt … an; spaCy dep svp) → rejoin prefix+verb for lemma, sentence-linking must catch split occurrences; compounds kept as single lemmas above freq threshold, never decomposed; strong-verb lemmatiser quality unverified → sample check; modals drilled as content words; formal Sie vs sie case-sensitive matching (freq list lowercased); Präteritum of sein/haben/modals A1, other Präteritum B1; typing lenient ae/oe/ue/ss at A1/A2; TTS de-DE / STT de-DE untested

# Persian (fa / Tatoeba pes) — verified 2026-09-23
- hermitdave fa_full.txt: 445,744 lines, CC-BY-SA 4.0
- wordfreq: only small_fa exists (no large_fa) → thinner written frequency
- kaikki Persian jsonl.gz 13MB
- Tatoeba: pes_sentences_detailed 31,792; pes-eng_links 8,476 (direct file); audio 11,467 clips but only 381 permissive (352 CC BY 4.0, 29 CC BY-SA)
- Tagger: Stanza fa (Apache 2.0; model UD Persian-Seraji CC BY-SA 4.0). Hazm MIT alt.
- No CEFR list. User CSV ~/Downloads/persian_common_words_1000_clean.csv: sanity only, never ship.
- Gotchas: engine needs rtl flag; ZWNJ normalisation; ی/ي ک/ك normalise to Persian codepoints; ezafe unwritten; compound light verbs (کار کردن) as multiword lemmas w/ hand list; plurals -ها + broken plurals hand table; colloquial subtitles (میخوام) vs formal wordfreq/Wiktionary — normalise before matching; pron = kaikki romanisation (coverage unverified); typing: null; TTS fa-IR unverified (Android likely, desktop patchy); STT fa-IR ok.
- lower_level_gloss_re added 2026-09-30 (+ illicit drugs): 2 moved (سم "poison", بمب "bomb" A2->B1), 0 cleaned; سم keeps 1 sentence (B1 min length)

# Indonesian (id / Tatoeba ind) — verified 2026-09-23
- hermitdave id_full.txt 357,441 lines; colloquial-heavy (gue, lo, nggak, banget)
- wordfreq: small_id only
- kaikki Indonesian jsonl.gz 9.9MB
- Tatoeba ind_sentences_detailed 28,311; ind-eng_links 25,718 (direct file)
- Audio: 1,740 clips, only 18 CC BY 4.0 → effectively no audio; TTS only (id-ID unverified)
- Tagger: Stanza id gsd (UD_Indonesian-GSD CC BY-SA 4.0); Sastrawi (MIT) stemmer as cross-check
- Gotchas: lemma = root (Wiktionary headword), affixed forms as link forms/alt; reduplication as inflection; flag colloquial register (subtitles) vs formal; no gender/tense/articles; typing trivial; STT id-ID

# Japanese (ja / Tatoeba jpn) — verified 2026-09-23
- hermitdave ja_full.txt BROKEN (34,504 rows, kanji stems; conjugation stripped) → don't use for ranking; use wordfreq[cjk] (needs mecab-python3+ipadic) + Tatoeba corpus token counts via Sudachi as the spoken proxy
- kaikki Japanese jsonl.gz 47MB; entries have forms[].ruby readings + romanization entries
- Tatoeba jpn_sentences_detailed 248,909; jpn-eng_links 280,706; jpn_transcriptions.tsv.bz2 (furigana [漢字|かな]) 249,007 rows; jpn_indices.csv 17MB (curated lemma(reading){surface} per token — use for links!)
- Audio: 6,420 clips, only 27 permissive → TTS ja-JP only
- Tokeniser: SudachiPy mode C + SudachiDict-core (Apache-2.0); alt fugashi+unidic-lite (MIT)
- JLPT lists (elzup/jlpt-word-list MIT but provenance unclear) → sanity only; N5≈A1 N4≈A2 N3≈B1
- Gotchas: lemma = dictionary form; pron = kana reading (+romaji optional); particles/aux/copula = functionWords; counters bound morphemes; casual register skew; showPron toggle for kana; typing "pron" since 2026-09-26 (typed kana reading + typed written form); spaced:false in pack (no spaces) — engine cloze substring mode

# Korean (ko / Tatoeba kor) — verified 2026-09-23
- hermitdave ko_full.txt 688,129 rows, eojeol units (particles attached) → lemmatise via spaCy before ranking
- wordfreq ko small only (its tokeniser needs mecab-ko; not needed if spaCy tokenises)
- kaikki ko-extract.jsonl.gz 24.6MB (URL: kaikki.org downloads/ko/ko-extract.jsonl.gz)
- Tatoeba kor_sentences_detailed 15,940 (TINY); kor-eng_links 11,598; audio 25 permissive → TTS ko-KR
- Tagger: spaCy ko_core_news_sm 3.8.0, CC BY-SA 4.0, no external tokenizer dep. Avoid KoNLPy (GPL).
- NIKL 한국어 학습용 어휘 목록 5,965 words graded 초/중/고 (982/2,111/2,872), KOGL Type 1 (≈CC BY) → could SHIP as level source (초급≈A1-A2, 중급≈B1); fetch needs browser (gongu.copyright.or.kr mirror)
- Gotchas: lemma -다 form; register 반말/존댓말 (prefer polite in examples); Sino vs native numerals both; romanisation: write own RR (avoid GPL lib); typing: null; sentence coverage risk — supplement Tatoeba with other CC corpora or generated+reviewed sentences

# Arabic (ar / Tatoeba ara) — verified 2026-09-23
- hermitdave ar_full.txt 2,507,189 lines (punctuation not stripped; MSA+dialect mix)
- wordfreq ar large
- kaikki Arabic jsonl.gz 50MB (~65k entries); vocalised headword in head_templates args; romanization forms ~29% coverage
- Tatoeba ara_sentences_detailed 68,543; ara-eng_links 48,742; audio 483 clips all from elmassoudi, licence blank → treat as none unless resolved (TTS ar)
- Dialect exports arq 2,457 / arz 1,582 / apc 160 / ary 117 — ignore (MSA target)
- Tagger: CAMeL Tools (MIT) primary; Stanza ar PADT is CC BY-NC-SA; Farasa research-only
- Kelly ar.json hybrid (Kelly core + wordfreq tail) → soft sanity only
- Gotchas: MSA filter = require kaikki entry + tagger POS; clitic split via CAMeL; strip ال for lemma, display nouns without article; normalise alef variants/ة-ه/ى-ي/tatweel before matching; broken plurals from kaikki forms + hand table; verb lemma 3sg masc perfective; rtl:true; pron = vocalised headword (+romanization when present); typing: null; TTS ar-SA/ar-EG, STT ar unverified
- lower_level_gloss_re added 2026-09-30 (+ illicit drugs): 1 moved (قنبلة "bomb" A2->B1), 0 cleaned; the shared blood-kinship exclusion returns عم "paternal blood uncle" to A2

# Hindi (hi / hin) — verified 2026-09-23
- hermitdave hi_full.txt 21,309 rows (real words; danda । as punct); wordfreq small_hi (26.6k)
- kaikki Hindi jsonl.gz 17.4MB, 39,220 entries; gender in head_templates; romanization 99.8%
- Tatoeba hin 16,475 sentences, 13,286 w/ eng link; audio 3,506, 105 permissive
- Tagger: Stanza hi (UD Hindi-HDTB, CC BY-NC-SA 4.0 — non-commercial like Italian); indic_nlp_library MIT for normalisation
- No graded list
- Gotchas: nukta/chandrabindu normalisation; compound verbs (कर देना) multiword; gender m/f; verb lemma -ना; LTR Devanagari; pron = kaikki romanization; typing null; TTS hi-IN unverified
- lower_level_gloss_re added 2026-09-30 (+ illicit drugs): 2 moved (बम "bomb", विस्फोट "explosion" A2->B1), 0 cleaned
# Urdu (ur / urd)
- hermitdave ur_full.txt 9,592 rows; wordfreq small_ur (23.1k)
- kaikki Urdu jsonl.gz 4.9MB, 10,421 entries; romanization 99.5%; vocalised forms in head args
- Tatoeba urd 2,851 sentences, 2,433 w/ eng link (THIN); audio 2 permissive → none; hin↔urd links only 246
- Tagger: Stanza ur (UD Urdu-UDTB, CC BY-NC-SA 4.0)
- Gotchas: RTL + Noto Nastaliq Urdu (Google Fonts ok) + larger line-height; normalise ي/ك/ه → ی/ک/ہ, ZWNJ; sentences per word sparse → supplement with reviewed generated sentences; typing null

# Spanish (es)
- Sources are documented in the spanish repo.
- lower_level_gloss_re added 2026-09-30: 2 moved (disparar "to shoot", la bomba A2->B1), 0 cleaned; matar/sangre/sexo stay B1 through the word ceiling

# Swahili / Somali — verified 2026-09-23, updated 2026-09-27 (build + scouts), spec committed 2026-09-29 (see below)
## Swahili (swh) PUBLISHED — https://bannerless-studio.github.io/swahili/ (2026-09-29, engine bf612ee)
Published 2026-09-29: 2,000 words (A1 600/A2 700/B1 700), 2,777 sentences (A1 522/A2 976/B1 1,279, every word ≥2, 678 written and marked `"src":"gen"`), 60 A1/A2/B1 reading passages. Sentence review ran three hand-read QA rounds plus a re-QA, with the last fresh 20% samples under 1% defects; details in `../swahili/tools/REPORT.md`. The word/sentence/passage counts and check.sh status below are from the 2026-09-27 build session and are superseded by the numbers above; kept for the build-history detail (tagger, corpus sourcing, md5s from that session).

Earlier state, as measured 2026-09-27/29 before publish (build.sh, check_pack, live):
- **Words**: 2,000 total — A1 600, A2 700, B1 700. Source: kaikki Swahili (76.7MB, ~23.5k senses) plus a Wiktionary English→Swahili translation table (~1,325 est.), ranked by surface frequency over a tagged corpus of Tatoeba (4,583) + OPUS GlobalVoices (32,307 pairs) + FLORES-200 (~2,009), 36,646 sentences with an English link, 748,817 tokens. Tagger: a hand-written rule tagger (`langs/sw.py`, "sw rules", parser/NER disabled) built for this pack, not spaCy/Stanza — Swahili has no ready UD tagger (UD_Swahili-OPUSGV is empty). 30 random word/gloss pairs sampled and hand-checked: all plausible and correctly matched (e.g. mwigizaji→actor, unywele→a hair, kupasa→to be obliged), so gloss quality looks solid despite the untested tagger.
- **Sentences**: 2,956 total (re-measured 2026-09-29 via `packbuilder check`; the 2,957 recorded 2026-09-27 was off by one). Coverage: 1 word with exactly 1, 1,996 words (99.8%) with 2 or more — min 1, median 2. All generated from the same tagged corpus; none carry audio (0 permissively licensed Tatoeba clips for Swahili).
- **Passages**: 40 (20 A1 words/passage 62-73, 20 A2 words/passage 93-116); coverage 0.967-1.000, linked 0.967-1.000, inside the level-budget rule. No B1 passages yet — a gap vs. shipped languages, which cover all three levels.
- **spec committed 2026-09-29** (`langs/sw.py` `8970e5c`, branch `engine-sw`): the tagger contract (`tools/packbuilder/tests/test_spec.py`) now accepts a hand-written `"rules"` tagger alongside spacy/stanza (requires `spacy_model is None` and its own `tag_texts`/`tagger_desc`); the hook-owner inventory (`test_passage_de_ru.py` `HookOwners`) lists sw's one owned hook, `passage_names_never_link` (docs/PACKBUILDER_HOOKS.md). Pruned two dead symbols (`io` import, `VOWEL_STEM_PREFIX`, both pyflakes-confirmed unused) with no behaviour change: a from-scratch rebuild in a scratch copy of `../swahili` reproduces `pack/words.json` (md5 `8ea08e4df11e854b973a187dec905a75`) and `pack/sentences.json` (md5 `e3223b9c0472289c0d84cf099e6b9164`) byte for byte, both before and after the prune, matching the shipped files (these two md5s describe the pre-`bad_sentences.txt`-hook pack; sw-data is rebuilding sw's pack separately, so its shipped md5s will move once that lands). New coverage: `tools/packbuilder/tests/test_sw_rules.py` (noun class prefixes, verb morphology incl. passive/applicative folding, CLOSED-table forcing and its one context override, 10 tagged fixture sentences, the `passage_names_never_link` fallback). `pytest tools/packbuilder/tests`: 523 passed, 2 skipped (0 failures; net +12 vs. the prior 511, from `tests/test_bad_sentences.py`, the repo-level `tools/bad_sentences.txt` hook).
- **check.sh**: still fails as shipped in `../swahili` — unrelated to the spec commit above. Plain `./check.sh` fails at step 1 (`no language module langs/sw.py`) because the spec lives only in vocab-engine's `tools/packbuilder/langs/sw.py`, not copied into the `../swahili` engine submodule. With `PACKBUILDER_PATH` pointed at vocab-engine's tools, `packbuilder check` passes (2,000 words, 2,956 sentences, coverage ≥1 100%, ≥2 99.8%), but `validate_pack.py` then fails: `pack/words.js` and `pack/sentences.js` are stale relative to their `.json` (not rebuilt, per instruction), plus 4 low-severity WARNs for surface-form collisions at one level (kuwa, kutoka, karibu, kulia).
- **What's missing to reach Urdu/Indonesian parity**: rebuild `pack/*.js` from the current `.json` before shipping; add B1 passages; a human review pass on A1/A2 sentences (planned, not started); recorded audio (none exists; TTS-only for now, like Indonesian); and, longer term, the culture-native story sources below in place of generated sentences.
- **Culture-native sources found for Swahili** (docs/scouts/story-sources-2026-09-27.md): African Storybook (ASb) ~280 aligned stories (CC BY 4.0, 628 Kiswahili books, 9/20 sampled English-paired), StoryWeaver 260 (CC BY 4.0, 82 at level 2, 15/24 are original not translated, 6/6 sampled have an English twin), Bloom Library 241 (235 `swh` + 6 `sw`, CC BY/BY-SA/CC0 + English), VOA Swahili public-domain text through 2024-12-31 (site now frozen, no new text since).
- **Safekeeping**: local commit `88d1d5e` in `../swahili` (build.sh, check.sh, engine, pack/, tools/, index.html, sw.js; no remote, no push). The untracked language spec is also snapshotted at `../swahili/tools/langs_sw.py.snapshot` (1,391 lines) so it survives if the vocab-engine working copy is lost.
- **Measured cost**: the sw-pack-builder worker transcript (7 compactions) totals 1,546 input + 2,907,894 cache-write + 134,767,019 cache-read + 447,555 output tokens ≈ **$77.40** at Opus 5.5 pricing ($4/$20 per M, cache write ×1.25, cache read ×0.1).

## Somali (som) NOT VIABLE
- kaikki ~1,285 senses total (<half of 2000 target); Tatoeba 164 (126 eng-linked); no GlobalVoices; only Tanzil + FLORES (2,009).
- Scout update (docs/scouts/so-sw-sources-2026-09-27.md): even adding a Wiktionary English→Somali translation table (~510 est. senses) and an unquantified PanLex overlap only reaches an estimated **~1,600-2,100 glossable headwords** — still well short of 2,000, and that range is an estimate, not a verified count. The one culture-native aligned source is African Storybook, ~87 aligned stories (92 Somali books, 19/20 sampled English-paired, CC BY 4.0) — no StoryWeaver (Somali isn't a StoryWeaver language) and no Let's Read Asia. The rest of the Somali sentence pool is dominated by Tanzil (93,844 pairs, licence unverified — the two known ToS URLs both 404) and bible-uedin (62,195 pairs), i.e. religious register; VOA Somali has ~100,000 public-domain article URLs by sitemap count, but body-text extractability is unverified (the one article sampled was audio-only with no extractable text).
- **What a real estimate would need**: a live browser count against African Storybook/StoryWeaver/Bloom (this pass could only reach them via curl, which the JS-rendered catalogs blocked), a body-text extraction check on VOA Somali's sitemap URLs, and a proverb/primer follow-up (both came back empty or unverified this pass) — none of that changes the core problem, which is that Somali's dictionary coverage is under half the 2,000-word target with no clear path to close the gap from open data alone.

## Culture-native sources per shipped language (docs/scouts/story-sources-2026-09-27.md, browser-verified 2026-09-27)

| lang | best non-overlapping aligned total | primary source | licence |
|---|---|---|---|
| ur | ~1,070 | StoryWeaver 832 (L2: 270) + Let's Read Asia CC BY subset ~236 | CC BY 4.0 (StoryWeaver); mixed, CC BY only ~41% of sampled LRA titles (13/32) |
| ko | ~1,200 | StoryWeaver 996 (L2: 244) + Bloom 202 | CC BY 4.0 / CC BY, BY-SA, CC0 |
| fa | ~340 | StoryWeaver 268 Farsi + 12 Dari + LRA Dari CC BY subset ~63 | CC BY 4.0; LRA CC BY only ~4/12 (Dari) or ~6/12 (est) sampled |
| hi | ~5,150 | StoryWeaver 5,130 (L2: 1,517) | CC BY 4.0 |
| id | ~6,800 | StoryWeaver 6,771 (L2: 1,903) + LRA CC BY subset ~15 | CC BY 4.0; LRA CC BY only ~4% of sampled titles (2/49) |
| ar | ~570 | StoryWeaver 526 (L2: 148) + ASb ~43 | CC BY 4.0 |

Caveats that apply across the table: StoryWeaver alignment is reliable only at the page level (7/7 sampled pairs had equal page counts; sentence counts inside a page differ), so build passages by aligning pages and splitting sentences within each page, not by assuming a sentence-for-sentence match. Most titles are translations of Indian (Pratham) originals except where the scout notes an "original" share, so "culture-native" in the StoryWeaver column means learner-register native text, not necessarily native-authored. Let's Read Asia's usable share is small because most of its catalogue is CC BY-NC or NC-ND; only the CC BY rows above are shippable. VOA is public domain everywhere, but coverage is uneven: Korean and Persian are still publishing live text; Urdu and Indonesian froze 2025-03-15; Swahili froze 2024-12-31; Hindi VOA does not resolve (DNS).

