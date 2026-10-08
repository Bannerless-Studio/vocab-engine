# ja kanji hints + per-word furigana: data scout (2026-10-08)

Pack facts (japanese/pack): characters.json = 1590 units, each a kanji WORD (fields id, t, words, lv, reading, ft; no meanings/components). words.json = 2000 words (fields w, lemma, pos, en, pron, alt, forms); 1590 contain kanji, 990 distinct kanji (989 real + 々).

## 1. KANJIDIC2 (meanings + readings) - USE
- Licence CC BY-SA 4.0 (EDRDG licence, edrdg.org/edrdg/licence.html). SKIP codes inside it have a separate CC BY-SA (Halpern): do not use them.
- URL http://www.edrdg.org/kanjidic/kanjidic2.xml.gz (1.5 MB gz, 15 MB XML, rebuilt daily). Fields: literal, reading ja_on/ja_kun (kun has okurigana dots), English `<meaning>` (m_lang absent = English), grade, jlpt, freq, stroke_count.
- Coverage: 989/989 real kanji (only 々 absent, a repeat mark). All 989 have English meaning AND on/kun readings.
- Gotcha: meanings are lists of 1-8 glosses; pick first 1-2 (zh pipeline takes first sense, then per-compound overrides). Kun readings with okurigana dots need stripping before alignment.

## 2. Decomposition: KRADFILE primary, Make Me a Hanzi secondary
- KRADFILE/KRADFILE2: http://ftp.edrdg.org/pub/Nihongo/kradzip.zip (285 KB, EUC-JP), same EDRDG CC BY-SA 4.0. Coverage 989/989 from kradfile alone (kradfile2 not needed). Flat list of component radicals, no structure or phonetic/semantic roles; Japanese forms (shinjitai) native.
- Make Me a Hanzi (repo .cache/makemeahanzi, LGPL-3.0+ / Arphic PL for graphics): Chinese forms only. 104/989 kanji missing entirely (shinjitai: 両乗伝価値働労効勧単厳収咲営団囲図塩増売変実対専帯帰広従応悩悪戦...); 12 present with no decomposition (一人入八士女心手母氏牛身); 885 present, 805 with an etymology hint (sound/meaning parts).
- Recommend: KRADFILE as the component list for all 989; MMAH etymology hint (semantic/phonetic role) as optional enrichment for the 805 where it exists, joined via hint-text only (never required). Hand overrides file like tools/zh_hints_overrides.json for gaps. Lines like zh "a woman 女 with a son 子" need component NAMES: KANJIDIC2 meaning of each radical that is itself a kanji, else small hand table (radk names).

## 3. Per-word furigana: JmdictFurigana (Doublevil) - USE, no tagger needed
- https://github.com/Doublevil/JmdictFurigana, release 2.3.1+2026-09-25; JmdictFurigana.txt 12 MB (also .json 35 MB). Licence: same as JMdict (CC BY-SA 4.0); repo says MIT for code. Format `text|reading|0:こん;1:にち`, kanji index ranges to kana, `0-1:きょう` = multi-kanji jukujikun span. Entry = (text, reading) from JMdict.
- Tested against words.json pron (katakana->hiragana, leading 〜 stripped on counters): 1588/1590 kanji words (99.9%) get an exact, single alignment; 0 ambiguous pairs; 23 use a jukujikun span (render ruby over 2 kanji). Misses: 前に, フランス語 (mixed kana form; align on 前, フランス+語 by hand/override). Without stripping 〜: 1554 (35 counter words miss).
- Rejected: sudachipy yomi (only word-level reading, no per-kanji split; not installed in .venv, would need dict download); own DP over KANJIDIC readings (works but JmdictFurigana already solves rendaku/jukujikun). Fallback for out-of-JMdict words: DP over KANJIDIC kun/on + okurigana anchors, flag unaligned for hand review.
- Gotcha: pack already has sentence/passage ruby (langs/ja.py sentence_ruby, passage_ruby); per-word furigana is a NEW layer on words/units, same ruby shape [[start,end,reading]].

## 4. Attribution (pack attribution.json shape: key -> {source, licence, url, note})
- "kanji_dictionary": {"source": "KANJIDIC2 and KRADFILE, Electronic Dictionary Research and Development Group (EDRDG), edrdg.org; used per the EDRDG licence", "licence": "CC-BY-SA-4.0", "url": "https://www.edrdg.org/edrdg/licence.html"}
- "word_furigana": {"source": "JmdictFurigana (Doublevil) built on JMdict, EDRDG", "licence": "CC-BY-SA-4.0", "url": "https://github.com/Doublevil/JmdictFurigana"}
- Optional "kanji_parts": Make Me a Hanzi, LGPL-3.0-or-later (as zh). Site footer must also name EDRDG and link the licence page (EDRDG WWW-use clause). ShareAlike: derived hint/furigana data in the pack is CC BY-SA; note it (pack already ships CC-BY-SA kaikki/wordfreq data).

## Data flow
1. tools/ja_hints.py (cached downloads in .cache, like zh_hints.py): per distinct kanji -> {meaning, on, kun, parts[KRADFILE], mmah_hint}; committed tools/ja_hints.json + ja_hint_overrides.json.
2. tools/ja_furigana.py: per kanji word (w, pron) -> JmdictFurigana alignment -> [[start,end,reading]]; overrides for the 2 misses; committed json.
3. packbuilder hint source attaches `hint` (per code point, as zh) + word ruby; attribution.json gets the two keys; validator checks every kanji of every unit has a hint.
