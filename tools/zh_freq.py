#!/usr/bin/env python3
"""Word frequencies for packs/zh, from wordfreq.

Writes tools/zh_freq.json: {word: zipf} for every word of the hsk vocabulary
(<hsk>/data/hsk_vocab.json, the input tools/pack_from_hsk.py reads), zipf =
wordfreq.zipf_frequency(word, "zh") rounded to 2 decimals (0 = not in wordfreq).
tools/pack_from_hsk.py reads the committed table (no wordfreq needed there) to order each
level by frequency and assign words `ft` (docs/PACK_SCHEMA.md "freqTiers"); it fails when
the table misses a word.

Needs wordfreq (tools/packbuilder/requirements.txt pins 3.1.1; its zh data is
CC-BY-SA-4.0): .venv/bin/pip install wordfreq==3.1.1

Usage: .venv/bin/python tools/zh_freq.py [HSK_REPO_DIR] [--check]   (default ../chinese, as pack_from_hsk.py)
--check: exit 1 when tools/zh_freq.json differs from a fresh run.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "zh_freq.json")


def main(argv):
    check = "--check" in argv
    argv = [a for a in argv if a != "--check"]
    hsk = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(ROOT), "chinese")
    from wordfreq import zipf_frequency
    vocab = json.load(open(os.path.join(hsk, "data", "hsk_vocab.json"), encoding="utf-8"))
    table = {v["w"]: round(zipf_frequency(v["w"], "zh"), 2) for v in vocab}
    text = json.dumps(table, ensure_ascii=False, indent=0, sort_keys=True) + "\n"
    if check:
        same = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == text
        print("zh_freq.json " + ("up to date" if same else "stale"))
        return 0 if same else 1
    open(OUT, "w", encoding="utf-8").write(text)
    print(f"zh_freq.json: {len(table)} words, {sum(1 for z in table.values() if not z)} not in wordfreq")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
