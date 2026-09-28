"""Swahili (sw). No tagger, subtitle list or wordfreq list exists for Swahili,
so this module carries its own tokeniser and rule-based lemmatiser
(`Analyser`, over an index of the kaikki Swahili extract), fed to the core
through `tag_texts` and made authoritative in `post_resolve`.

Headword conventions (README "Headwords"):
- verbs: the ku- infinitive (kusoma, kula, kwenda), key = the Wiktionary stem
  (soma, la, enda); every inflected, negative, subjunctive, relative and
  object-marked form links it; passive, applicative and reciprocal forms fold
  into the base verb, lexicalised causatives/statives with a gloss of their own
  (fundisha, onekana) stay words;
- nouns: the singular, class pair in the gloss ("book (ki/vi)"), the plural as
  alt; a locative in -ni (shuleni) links its noun;
- agreeing adjectives, possessives and -ote/-ingi/-ingine/-enye: the stem with a
  hyphen (-zuri, -angu), as Wiktionary and learner dictionaries cite them (there
  is no neutral form to pick; typing accepts the stem without the hyphen); the
  common agreement forms are alts;
- the associative (wa, ya, cha, vya, la, za, pa, mwa) is one entry -a;
  demonstratives are one entry per series (huyu "this", huyo "that",
  yule "that over there") with the class forms as alts.

Ranking is a surface-frequency pass over Tatoeba + OPUS GlobalVoices + FLORES
(spoken_from_corpus: the tagged corpus's (lemma, POS) counts; the written list
is the same corpus's surface counts through extra_wordfreq), approximate.
"""
import gzip
import json
import re
import zipfile
import tarfile
from collections import Counter, defaultdict

import hashlib
import math
from pathlib import Path

from .base import (LanguageSpec, DEFAULT_GROUP_KPOS, SENSITIVE_EN, SENSITIVE_GLOSS_EN, TATOEBA_ENG,
                   TATOEBA_AUDIO, drop_all_re, make_word_ceiling_re, EXAMPLE_SID_BASE)

GV_BASE = 60_000_000        # sids of OPUS GlobalVoices rows
FLORES_BASE = 70_000_000    # sids of FLORES-200 rows
SRC_PENALTY = {"gv": 1, "flores": 1, "gen": 2}

# ---------------------------------------------------------------------------
# closed sets
# ---------------------------------------------------------------------------
DAYS = "jumatatu jumanne jumatano alhamisi ijumaa jumamosi jumapili".split()
MONTHS = "januari februari machi aprili mei juni julai agosti septemba oktoba novemba desemba".split()
LANGUAGE_NAMES = ("kiswahili kiingereza kifaransa kiarabu kichina kijerumani kihispania kireno kirusi kihindi "
                  "kiitaliano kijapani").split()
CAPITALISED = {w: w.capitalize() for w in DAYS + MONTHS + LANGUAGE_NAMES}
NUMBERS = ("sifuri moja mbili tatu nne tano sita saba nane tisa kumi ishirini thelathini arobaini hamsini "
           "sitini sabini themanini tisini mia elfu laki milioni").split()
# agreeing forms of the numerals 1-5 and 8 (watu watatu, vitabu viwili, miaka minane)
NUM_STEMS = {"moja": "moja", "wili": "mbili", "tatu": "tatu", "nne": "nne", "tano": "tano", "nane": "nane"}
NUM_PREFIXES = ("m", "wa", "mi", "ma", "ki", "vi", "ji", "li")

PRONOUNS = "mimi wewe yeye sisi ninyi wao".split()
PRON_VARIANTS = {"nyinyi": "ninyi", "mie": "mimi", "sie": "sisi"}
# na + pronoun contractions: "and/with me" -> na
NA_PRON = {"nami", "nawe", "naye", "nasi", "nanyi", "nao"}

# demonstratives: one entry per series (key -> class forms); locative forms are adverbs of their own
DEMONSTRATIVES = {
    "hii": "huyu hawa huu hii hili haya hiki hivi hizi".split(),
    "hiyo": "huyo hao huo hiyo hilo hayo hicho hizo".split(),       # hivyo: the adverb "so, thus"
    "yule": "yule wale ule ile lile yale kile vile zile".split(),
}
DEM_DISPLAY = {"hii": "huyu", "hiyo": "huyo", "yule": "yule"}
LOCATIVE_ADVS = "hapa hapo pale huku huko kule humu humo mle".split()

# possessive stems, class prefixes; -a (associative) forms
POSS_STEMS = ["angu", "ako", "ake", "etu", "enu", "ao"]
POSS_PREFIX = ["w", "y", "l", "ch", "vy", "z", "kw", "p", "mw"]
ASSOC_FORMS = "wa ya la cha vya za pa mwa".split()
# agreeing closed stems with vowel-initial class forms (lemma -> forms)
AGREE_STEMS = {
    "ote": "wote yote lote chote vyote zote kote pote mote sote nyote".split(),
    "ingi": "mwingi wengi mingi jingi mengi kingi vingi nyingi kwingi pengi".split(),
    "ingine": ("mwingine wengine mingine lingine jingine mengine kingine vingine nyingine zingine "
               "kwingine mwengine").split(),
    "enye": "mwenye wenye yenye lenye chenye vyenye zenye penye".split(),
    "enyewe": "mwenyewe wenyewe yenyewe lenyewe chenyewe vyenyewe zenyewe kwenyewe penyewe".split(),
    "o-ote": ("yeyote wowote yoyote lolote chochote vyovyote zozote kokote popote momote").split(),
    "ngapi": "wangapi mingapi mangapi vingapi ngapi mingapi".split(),
    "pi": "yupi wepi upi ipi lipi yapi kipi zipi kupi papi mupi".split(),
    "amba": "ambaye ambao ambacho ambavyo ambalo ambayo ambazo ambapo ambako ambamo ambae".split(),
}
# nouns "mwenye/wenye" (owner) and "mwenyewe" are read as -enye/-enyewe (the determiner use dominates)

# forms of kuwa na "to have" (present, affirmative and negative) -> ("na", VERB)
HAVE_FORMS = set("nina una ana tuna mna wana ina lina kina vina zina yana".split() +
                 "sina huna hana hatuna hamna hawana haina halina hakina havina hazina hayana".split())
# existential "there is" (kuna/pana/mna and negatives) -> ("kuna", VERB)
EXIST_FORMS = {"kuna", "pana", "hakuna", "hapakuna"}
# located copula: SM + ko/po/mo "is (there)" -> kuwa
LOC_COPULA = set()
for _sm in ("ni", "u", "yu", "tu", "m", "wa", "i", "li", "ya", "ki", "vi", "zi", "ku", "pa", "mu"):
    for _l in ("ko", "po", "mo"):
        LOC_COPULA.add(_sm + _l)
        LOC_COPULA.add(("hayu" if _sm == "yu" else "ha" + _sm if _sm not in ("ni", "u") else
                        {"ni": "si", "u": "hu"}[_sm]) + _l)
LOC_COPULA -= {"wako", "yako", "upo", "mko", "kupo", "hako", "haumo", "zipo", "ipo", "wapo", "mpo",
               "humo", "huko", "hapo", "kuko", "pako", "papo", "limo", "kimo", "hamo", "yapo"}
LOC_COPULA |= {"yuko", "yupo", "yumo", "wako", "wapo", "iko", "ipo", "mko", "mpo", "upo", "kuko", "zipo"}
LOC_COPULA -= set(LOCATIVE_ADVS)

# ku-: verbs whose infinitive loses u before a vowel stem
KW_VOWEL = "aeiou"

# closed surfaces -> (lemma, UPOS); lemma keys of the pack
CLOSED = {}
# known grammatical words the pack does not teach (never linked, never block a sentence):
# ndi- "it is (precisely)" and si- "it is not" + relative concord
KNOWN_X = set("ndiye ndio ndicho ndivyo ndipo ndiko ndimo ndilo ndizo ndimi ndiwe ndisi ndinyi sivyo siye sicho "
              "silo sizo siko sipo simo".split()) - {"ndio"}
REL_SUFFIXES = ["ye", "o", "cho", "vyo", "lo", "yo", "zo", "po", "ko", "mo"]


def _c(forms, lemma, upos):
    for f in forms:
        CLOSED.setdefault(f, (lemma, upos))


_c(PRONOUNS, None, "PRON")
for _p in PRONOUNS:
    CLOSED[_p] = (_p, "PRON")
for _v, _p in PRON_VARIANTS.items():
    CLOSED[_v] = (_p, "PRON")
_c(NA_PRON, "na", "CCONJ")
for _k, _fs in DEMONSTRATIVES.items():
    _c(_fs, _k, "DET")
for _a in LOCATIVE_ADVS:
    CLOSED[_a] = (_a, "ADV")
for _s in POSS_STEMS:
    for _p in POSS_PREFIX:
        CLOSED.setdefault(_p + _s, (_s, "DET"))
CLOSED["wao"] = ("wao", "PRON")      # context: after a noun it is -ao "their" (Analyser)
_c(ASSOC_FORMS, "a", "ADP")
for _k, _fs in AGREE_STEMS.items():
    _c(_fs, _k, "PRON" if _k == "amba" else "DET" if _k in ("pi",) else "ADJ")
for _f in HAVE_FORMS:
    CLOSED[_f] = ("na", "VERB")
for _f in EXIST_FORMS:
    CLOSED[_f] = ("kuna", "VERB")
for _f in LOC_COPULA:
    CLOSED.setdefault(_f, ("wa", "VERB"))
for _n in NUMBERS:
    CLOSED[_n] = (_n, "NUM")
for _st, _lem in NUM_STEMS.items():
    # one takes the singular class prefixes, two-five the plural ones: the
    # other pairings are not words but collide with some (m + wili = mwili "body")
    for _p in NUM_PREFIXES:
        if (_p in ("m", "ki", "ji", "li")) == (_st == "moja"):
            CLOSED.setdefault(_p + _st, (_lem, "NUM"))
CLOSED.update({
    "ni": ("ni", "AUX"), "si": ("si", "AUX"),
    "ndiyo": ("ndiyo", "INTJ"), "ndio": ("ndiyo", "INTJ"), "siyo": ("siyo", "INTJ"), "sio": ("siyo", "INTJ"),
    "hapana": ("hapana", "INTJ"), "la": ("a", "ADP"),
    "na": ("na", "CCONJ"), "kwa": ("kwa", "ADP"), "katika": ("katika", "ADP"), "kwenye": ("kwenye", "ADP"),
    "kama": ("kama", "SCONJ"), "lakini": ("lakini", "CCONJ"), "au": ("au", "CCONJ"), "ama": ("au", "CCONJ"),
    "ili": ("ili", "SCONJ"), "kwamba": ("kwamba", "SCONJ"), "ikiwa": ("ikiwa", "SCONJ"),
    "ingawa": ("ingawa", "SCONJ"), "wala": ("wala", "CCONJ"), "ila": ("ila", "CCONJ"), "bali": ("bali", "CCONJ"),
    "basi": ("basi", "CCONJ"), "halafu": ("halafu", "ADV"), "kisha": ("kisha", "ADV"),
    "bila": ("bila", "ADP"), "mpaka": ("mpaka", "ADP"), "hadi": ("hadi", "ADP"), "tangu": ("tangu", "ADP"),
    "baada": ("baada", "ADP"), "kabla": ("kabla", "ADP"), "kuhusu": ("kuhusu", "ADP"),
    "je": ("je", "PART"), "nini": ("nini", "PRON"), "nani": ("nani", "PRON"), "wapi": ("wapi", "ADV"),
    "lini": ("lini", "ADV"), "gani": ("gani", "DET"), "vipi": ("vipi", "ADV"), "kwanini": ("kwanini", "X"),
    "kila": ("kila", "DET"), "hivyo": ("hivyo", "ADV"), "hivi": ("hivi", "ADV"),
    "vizuri": ("vizuri", "ADV"), "vibaya": ("vibaya", "ADV"), "kidogo": ("kidogo", "ADV"),
    "pengine": ("pengine", "ADV"), "kwaheri": ("kwaheri", "INTJ"), "kwaherini": ("kwaheri", "INTJ"),
    "jambo": ("jambo", "NOUN"), "mambo": ("jambo", "NOUN"),
    "sana": ("sana", "ADV"), "tu": ("tu", "ADV"), "pia": ("pia", "ADV"), "bado": ("bado", "ADV"),
    "sasa": ("sasa", "ADV"), "tena": ("tena", "ADV"), "pamoja": ("pamoja", "ADV"), "labda": ("labda", "ADV"),
    "hata": ("hata", "ADV"), "kabisa": ("kabisa", "ADV"), "zaidi": ("zaidi", "ADV"), "leo": ("leo", "ADV"),
    "kesho": ("kesho", "ADV"), "jana": ("jana", "ADV"), "kweli": ("kweli", "ADV"), "tayari": ("tayari", "ADJ"),
    "juu": ("juu", "ADV"), "chini": ("chini", "ADV"), "ndani": ("ndani", "ADV"), "nje": ("nje", "ADV"),
    "mbele": ("mbele", "ADV"), "nyuma": ("nyuma", "ADV"), "karibu": ("karibu", "INTJ"),
    "karibuni": ("karibu", "INTJ"), "mbali": ("mbali", "ADV"), "haraka": ("haraka", "ADV"),
    "polepole": ("polepole", "ADV"), "kwanza": ("kwanza", "ADV"), "katikati": ("katikati", "ADV"),
    "asante": ("asante", "INTJ"), "asanteni": ("asante", "INTJ"), "ahsante": ("asante", "INTJ"),
    "tafadhali": ("tafadhali", "INTJ"), "samahani": ("samahani", "INTJ"), "pole": ("pole", "INTJ"),
    "poleni": ("pole", "INTJ"), "hodi": ("hodi", "INTJ"), "shikamoo": ("shikamoo", "INTJ"),
    "marahaba": ("marahaba", "INTJ"), "hujambo": ("hujambo", "INTJ"), "hamjambo": ("hujambo", "INTJ"),
    "sijambo": ("sijambo", "INTJ"), "hatujambo": ("sijambo", "INTJ"), "sawa": ("sawa", "INTJ"),
    "habari": ("habari", "NOUN"), "salama": ("salama", "ADJ"), "kweli": ("kweli", "ADV"),
})
for _d in DAYS + MONTHS + LANGUAGE_NAMES:
    CLOSED[_d] = (_d, "NOUN")
for _r in REL_SUFFIXES:
    CLOSED.setdefault("na" + _r, ("na", "CCONJ"))            # nacho, nayo: "with it"
    for _sm in ("ni", "u", "a", "tu", "m", "wa", "i", "li", "ya", "ki", "vi", "zi", "ku", "pa"):
        CLOSED.setdefault(_sm + "na" + _r, ("na", "VERB"))  # ninacho, unayo: "have it"
# SM + li + REL + locative (aliyeko, iliyopo, walioko): "who/which is (there)" -> kuwa
# SM + si + REL (+ locative) (asiye, isiyo, wasio, kisichokuwa): "who/which is not" -> never linked
_REL_OF = {"a": "ye", "u": "o", "wa": "o", "i": "yo", "li": "lo", "ya": "yo", "ki": "cho", "vi": "vyo",
           "zi": "zo", "ku": "ko", "pa": "po", "mu": "mo", "tu": "o", "m": "o", "ni": "ye"}
for _sm, _r in _REL_OF.items():
    for _l in ("po", "ko", "mo"):
        CLOSED.setdefault(_sm + "li" + _r + _l, ("wa", "VERB"))
    for _l in ("", "po", "ko", "mo"):
        KNOWN_X.add(_sm + "si" + _r + _l)
# narrative ka- + wa (akawa, ikawa, kukawa "and (it) became / there was"): kuwa, not kukawa "to delay"
for _sm in ("ni", "u", "a", "tu", "m", "mu", "wa", "i", "li", "ya", "ki", "vi", "zi", "ku", "pa"):
    CLOSED.setdefault(_sm + "kawa", ("wa", "VERB"))
CLOSED.update({"kuwa": ("wa", "VERB"),          # the infinitive; "that" only after a verb of saying (Analyser)
               "kana": ("kana", "X"),         # kana kwamba "as if": untaught
               "pande": ("upande", "NOUN"),   # plural of upande "side" (pande zote), not pande "chunk"
               "wacha": ("acha", "VERB"),     # colloquial acha "leave, let", not the plural of mcha
               "kati": ("kati", "ADV"), "katikati": ("katikati", "ADV"),
               "hauna": ("na", "VERB"), "hio": ("hiyo", "DET"), "kwasababu": ("kwasababu", "X"),
               "iko": ("wa", "VERB")})
# kwa + X fixed phrases (one tap, one word): taught as phrases
PHRASES = {"kwa nini": "why", "kwa sababu": "because", "kwa hiyo": "so, therefore", "hivi karibuni": "recently",
           "sasa hivi": "right now, just now"}

# multi-POS surfaces: a noun reading of these tokens after the associative or
# a preposition is the noun (kwa haraka "in a hurry"), handled by the default
# (closed ADV) reading otherwise
# verbs of saying/thinking after which kuwa is the conjunction "that"
SAY_VERBS = {"sema", "eleza", "ambia", "jua", "fikiri", "dhani", "amini", "ona", "sikia", "andika", "tangaza",
             "thibitisha", "kubali", "hakikisha", "onyesha", "gundua", "elewa", "kumbuka", "sahau", "ripoti",
             "ongeza", "shauri", "taarifu", "fahamu", "tambua", "hisi", "ota", "kiri", "dai", "julisha", "sisitiza",
             "bainisha", "andikia", "hofia", "ogopa", "tumaini", "tarajia", "hakikishia", "arifu",
             # deciding, promising, warning, seeming (iliamua kuwa, inaonekana kuwa)
             "amua", "ahidi", "onya", "pendekeza", "elezea", "fichua", "shuhudia", "lalamika", "onekana",
             "julikana", "kataa", "kana", "jibu", "sadiki", "ashiria", "tabiri", "kisia", "hakiki", "dhihirisha",
             "shtaki", "lalamikia", "gundulika", "semekana", "aminika", "fahamika", "elezwa", "ambiwa"}
# ni wazi kuwa "it is clear that"
THAT_AFTER = {"wazi", "kweli", "dhahiri", "hakika", "bayana", "ukweli", "uhakika"}
LINK_VERBS = ("wa", "ni", "si", "kuwa", "onekana", "baki", "kaa", "fanya", "endelea", "bakia",
              "weka", "acha")   # + resultative: kuweka bayana/wazi "make clear"
NP_SLOT = ("NOUN", "VERB", "AUX", "NUM", "DET", "ADJ")   # POS after which an agreeing form is the adjective

# verbs missing from kaikki (synthetic lexicon entries, stem -> gloss)
SYNTH_VERBS = {"jifunza": "to learn", "jaribu": "to try", "hitaji": "to need", "pa": "to give (to someone)",
               "ita": "to call"}   # kaikki heads ita with a generic template (the only base verb there)
# nouns kaikki lists only as an alternative form of a rarer spelling (noun -> class note)
SYNTH_NOUNS = {"mahali": ""}

# subject markers (affirmative), negative subject markers, TAM, relative, object markers
SM = ["ni", "u", "a", "tu", "m", "mu", "wa", "i", "li", "ya", "ki", "vi", "zi", "ku", "pa", "yu"]
SM_VOWEL = ["n", "w", "tw", "mw", "y", "l", "ch", "vy", "z", "kw", "p", "a", "wa", "i", "ki", "vi", "zi",
            "li", "ya", "ku", "pa", "u", "tu", "m", "mu", "ni"]
NEG_SM = ["si", "hu", "ha", "hatu", "ham", "hamu", "hawa", "hai", "hali", "haya", "haki", "havi", "hazi",
          "haku", "hapa", "hau", "hayu", "hamw", "hatw", "haw"]
TAM = ["na", "li", "ta", "me", "ki", "nge", "ngali", "ngeli", "ka", "sha", "mesha", "lisha"]
NEG_TAM = ["ku", "ta", "ja", "nge", "ngali", "ngeli", ""]
REL = ["ye", "o", "cho", "vyo", "lo", "yo", "zo", "po", "ko", "mo"]
OM = ["ni", "ku", "m", "mw", "tu", "wa", "ki", "vi", "li", "ya", "i", "zi", "u", "ji", "pa", "mu", "wa"]
# derived verbs (kaikki "Passive form of -X: ...") kept as words / always folded (hand residuals)
KEEP_DERIVED = {"zaliwa"}
DERIV_TAGS = {"passive", "applicative", "reciprocal", "causative", "stative", "conversive", "reflexive", "intensive"}
GLOSS_STOP = {"to", "be", "the", "a", "an", "of", "for", "each", "other", "one", "another", "someone", "something",
              "with", "and", "or", "in", "on", "at", "up", "down", "out", "get", "make", "cause"}
FOLD_DERIVED = set()
APPL_FOLD_RE = re.compile(r"\b(?:for|to|at|on behalf of|with)\s+(?:someone|somebody|something|sb|sth|a person|one)\b|"
                          r"\b(?:someone|something)$|^(?:to )?\w+ for(?:,|$)")

WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
TOKEN_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,:]\d+)*|[^\sA-Za-z\d]")
APPENDIX_RE = re.compile(r"\[\[Appendix|inflected form(?: and adverbial form)? of|\bobject of ndi|"
                         r"\binflection of si-|\bform of amba-|class form of\b|^(?:Class|Wa class|U class|Ki class|"
                         r"Vi class|Li class|Ya class|Zi class|Ku class|Pa class|Mu class)\b")
CLASS_ROMAN = {"class-i": 1, "class-ii": 2, "class-iii": 3, "class-iv": 4, "class-v": 5, "class-vi": 6,
               "class-vii": 7, "class-viii": 8, "class-ix": 9, "class-x": 10, "class-xi": 11, "class-xiv": 14,
               "class-xv": 15, "class-xvi": 16, "class-xvii": 17, "class-xviii": 18}
PLURAL_CODE = {"wa": "m/wa", "mi": "m/mi", "ma": "ji/ma", "vi": "ki/vi", "n": "n/n", "m-wa": "m/wa",
               "ki-vi": "ki/vi", "m-mi": "m/mi", "u-ma": "u/ma", "vy": "ki/vi", "mw-mi": "m/mi", "mw-wa": "m/wa"}
SING_ONLY = {14: "u", 11: "u", 15: "ku", 9: "n/n", 6: "ma", 5: "ji/ma", 3: "m/mi", 1: "m/wa", 7: "ki/vi"}


def fold_word(s):
    """kaikki headword / form target / surface: leading hyphen of a stem
    dropped (-soma = soma), curly apostrophe straightened, capitalised days,
    months and language names lowercased."""
    if not s:
        return s
    s = s.replace("’", "'")
    if s.startswith("-") and len(s) > 1:
        s = s[1:]
    if s.endswith("-") and len(s) > 1:
        s = s[:-1]
    if s[:1].isupper() and s.lower() in CAPITALISED:
        s = s.lower()
    return s


def _content(g):
    return {w[:4] for w in re.findall(r"[a-z]+", re.sub(r"\(.*?\)", " ", g)) if w not in GLOSS_STOP and len(w) >= 3}


def _shares(g, base_g):
    """A derived verb's gloss repeats its base verb's meaning (pendana "to love
    each other" / penda "to love"; not kutana "to meet" / kuta "to find")."""
    return bool(_content(g) & _content(base_g))


CLASS_NOTE_RE = re.compile(r"\((?:m|mw|wa|mi|ki|vi|ji|ma|n|u|ku|pa|mu)(?:/[a-z]+)?\)")


def nasal(stem):
    """Class 9/10 adjective form of a consonant/vowel stem (-zuri nzuri, -baya
    mbaya, -refu ndefu, -pya mpya, -eupe nyeupe, -kubwa kubwa)."""
    if not stem:
        return stem
    c = stem[0]
    if c in "aeiou":
        return "ny" + stem
    if stem.startswith("r"):
        return "nd" + stem[1:]
    if stem.startswith("l"):
        return "nd" + stem[1:]
    if c in "dgjz":
        return "n" + stem
    if c in "bv":
        return "m" + stem
    if stem.startswith("w"):
        return "mb" + stem[1:]
    if len(stem) <= 2:
        return "m" + stem        # -pya mpya, -pi
    return stem


def adj_forms(stem):
    """Agreement forms of a declinable adjective stem (classes 1-18)."""
    out = set()
    if stem[0] in "aeiou":
        v = stem
        out |= {"mw" + v, "w" + v if v[0] != "i" else "we" + v[1:], "my" + v, "j" + v, "m" + v if v[0] == "e" else "me" + v[1:] if v[0] == "i" else "ma" + v,
                "ch" + v, "vy" + v, nasal(v), "kw" + v, "p" + v, "mw" + v}
        if v[0] == "e":
            out |= {"w" + v, "m" + v, "ny" + v, "j" + v}
        if v[0] == "i":
            out |= {"wi" + v[1:], "me" + v[1:], "mi" + v[1:], "ji" + v[1:]}
    else:
        out |= {"m" + stem, "wa" + stem, "mi" + stem, "ji" + stem, stem, "ma" + stem, "ki" + stem, "vi" + stem,
                nasal(stem), "ku" + stem, "pa" + stem, "mu" + stem, "u" + stem, "zi" + stem, "li" + stem}
    return {f for f in out if f}


# ---------------------------------------------------------------------------
# glosses of the closed sets (fixed: most have only affix / form-of entries)
# ---------------------------------------------------------------------------
NUM_GLOSS = dict(zip(NUMBERS, ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                               "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
                               "hundred", "thousand", "hundred thousand", "million")))
DAY_GLOSS = dict(zip(DAYS, "Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split()))
MONTH_GLOSS = dict(zip(MONTHS, ("January February March April May June July August September October November "
                                "December").split()))
CLOSED_GLOSS = {
    ("mimi", "PRON"): "I, me", ("wewe", "PRON"): "you (singular)", ("yeye", "PRON"): "he, she; him, her",
    ("sisi", "PRON"): "we, us", ("ninyi", "PRON"): "you (plural)", ("wao", "PRON"): "they, them",
    ("angu", "DET"): "my, mine", ("ako", "DET"): "your, yours (singular)", ("ake", "DET"): "his, her, its",
    ("etu", "DET"): "our, ours", ("enu", "DET"): "your, yours (plural)", ("ao", "DET"): "their, theirs",
    ("hii", "DET"): "this, these", ("hiyo", "DET"): "that, those (just mentioned)",
    ("yule", "DET"): "that, those (over there)",
    ("hapa", "ADV"): "here", ("hapo", "ADV"): "there (near, just mentioned)", ("pale", "ADV"): "there (over there)",
    ("huko", "ADV"): "there (that place)", ("kule", "ADV"): "over there, far away",
    ("ni", "AUX"): "is, are, am (copula)", ("si", "AUX"): "is not, are not, am not",
    ("kuna", "VERB"): "there is, there are", ("na", "VERB"): "to have",
    ("wa", "VERB"): "to be, to become",
    ("a", "ADP"): "of (-a: wa, ya, cha, za...)",
    ("na", "CCONJ"): "and, with", ("lakini", "CCONJ"): "but", ("au", "CCONJ"): "or",
    ("ili", "SCONJ"): "so that, in order to", ("kwamba", "SCONJ"): "that (conjunction)",
    ("kama", "SCONJ"): "if; like, as", ("katika", "ADP"): "in, at, among", ("kwenye", "ADP"): "at, in, on, to",
    ("kwa", "ADP"): "with, by, for, to", ("bila", "ADP"): "without", ("hadi", "ADP"): "until, up to",
    ("mpaka", "ADP"): "until, up to", ("tangu", "ADP"): "since", ("kuhusu", "ADP"): "about, concerning",
    ("baada", "ADP"): "after (baada ya)", ("kabla", "ADP"): "before (kabla ya)",
    ("bado", "ADV"): "still; not yet", ("tu", "ADV"): "only, just", ("pia", "ADV"): "also, too",
    ("sana", "ADV"): "very, a lot", ("sasa", "ADV"): "now", ("leo", "ADV"): "today",
    ("kesho", "ADV"): "tomorrow", ("jana", "ADV"): "yesterday", ("tena", "ADV"): "again",
    ("ndiyo", "INTJ"): "yes", ("siyo", "INTJ"): "no, it is not", ("hapana", "INTJ"): "no",
    ("je", "PART"): "question marker (je...?)",
    ("nini", "PRON"): "what", ("nani", "PRON"): "who", ("wapi", "ADV"): "where", ("lini", "ADV"): "when",
    ("gani", "DET"): "which, what kind of", ("vipi", "ADV"): "how", ("ngapi", "ADJ"): "how many (-ngapi)",
    ("pi", "DET"): "which (-pi)",
    ("habari", "NOUN"): "news; how are you? (habari?)", ("jambo", "NOUN"): "matter, thing; hello (jambo)",
    ("hujambo", "INTJ"): "how are you? (hujambo)", ("sijambo", "INTJ"): "I am fine (reply to hujambo)",
    ("shikamoo", "INTJ"): "respectful greeting to an elder", ("marahaba", "INTJ"): "reply to shikamoo",
    ("asante", "INTJ"): "thank you", ("karibu", "INTJ"): "welcome; come in", ("karibu", "ADV"): "near; almost",
    ("pole", "INTJ"): "sorry (sympathy)", ("hodi", "INTJ"): "may I come in? (at the door)",
    ("kwaheri", "INTJ"): "goodbye", ("tafadhali", "INTJ"): "please", ("samahani", "INTJ"): "excuse me, sorry",
    ("sawa", "INTJ"): "OK, fine", ("salama", "ADJ"): "safe, peaceful",
    ("ote", "ADJ"): "all, whole (-ote)", ("ingi", "ADJ"): "many, much (-ingi)",
    ("ingine", "ADJ"): "other, another (-ingine)", ("enye", "ADJ"): "having, with (-enye)",
    ("amba", "PRON"): "who, which, that (amba-)", ("kila", "DET"): "every, each",
    ("hivyo", "ADV"): "so, thus, like that", ("vizuri", "ADV"): "well", ("vibaya", "ADV"): "badly", ("vyema", "ADV"): "well, properly", ("kati", "ADV"): "between, among; middle (kati ya)", ("hivi", "ADV"): "like this, thus",
    **{(p, "PHRASE"): g for p, g in PHRASES.items()},
    **{(n, "NUM"): g for n, g in NUM_GLOSS.items()},
    **{(d, "NOUN"): g for d, g in DAY_GLOSS.items()},
    **{(m, "NOUN"): g for m, g in MONTH_GLOSS.items()},
}
FORCED_CLOSED = (
    [(p, "PRON") for p in PRONOUNS] + [(s_, "DET") for s_ in POSS_STEMS] +
    [("hii", "DET"), ("hiyo", "DET"), ("yule", "DET"), ("hapa", "ADV"), ("pale", "ADV"), ("huko", "ADV"),
     ("hapo", "ADV"),
     ("ni", "AUX"), ("si", "AUX"), ("kuna", "VERB"), ("na", "VERB"), ("wa", "VERB"), ("a", "ADP"),
     ("na", "CCONJ"), ("lakini", "CCONJ"), ("au", "CCONJ"), ("ili", "SCONJ"), ("kwamba", "SCONJ"),
     ("kama", "SCONJ"), ("katika", "ADP"), ("kwenye", "ADP"), ("kwa", "ADP"),
     ("bado", "ADV"), ("tu", "ADV"), ("pia", "ADV"), ("sana", "ADV"), ("sasa", "ADV"), ("leo", "ADV"),
     ("kesho", "ADV"), ("jana", "ADV"),
     ("ndiyo", "INTJ"), ("siyo", "INTJ"), ("hapana", "INTJ"), ("je", "PART"),
     ("nini", "PRON"), ("nani", "PRON"), ("wapi", "ADV"), ("lini", "ADV"), ("gani", "DET"), ("vipi", "ADV"),
     ("ngapi", "ADJ"),
     ("habari", "NOUN"), ("jambo", "NOUN"), ("hujambo", "INTJ"), ("sijambo", "INTJ"), ("shikamoo", "INTJ"),
     ("marahaba", "INTJ"), ("asante", "INTJ"), ("karibu", "INTJ"), ("pole", "INTJ"), ("hodi", "INTJ"),
     ("kwaheri", "INTJ"), ("tafadhali", "INTJ"), ("samahani", "INTJ"), ("sawa", "INTJ"),
     ("ote", "ADJ"), ("kila", "DET")] +
    [(p, "PHRASE") for p in PHRASES] +
    [(n, "NUM") for n in NUMBERS if n not in ("laki",)] +
    [(d, "NOUN") for d in DAYS + MONTHS])
_G = {"AUX": "VERB", "CCONJ": "CONJ", "SCONJ": "CONJ"}      # UPOS -> the core's key group (core.lexicon.GROUP_OF)
CLOSED_GLOSS = {(l, _G.get(g, g)): v for (l, g), v in CLOSED_GLOSS.items()}
FORCED_CLOSED = [(l, _G.get(g, g)) for l, g in FORCED_CLOSED]
FUNCTION_LEMMAS = {"na", "a", "katika", "kwenye", "kama", "lakini", "au", "ili", "kwamba", "kwa sababu", "bado",
                   "tu", "pia", "sana", "siyo", "ndiyo", "hapana", "je", "ni", "si", "kwa"}

# Swahili terms for the shared sensitive-content policy
SENSITIVE_SW = (r"\w*jamiian\w*|kuua|aliua|aliuawa|wameuawa|waliuawa|kuuawa|mauaji|muuaji|wauaji|bunduki|risasi|ngono|"
                r"kubaka|ubakaji|maiti")
DROP_ALL_SW = (r"kubaka|alibaka|ubakaji|alibakwa|kubakwa|kujiua|alijiua|amejiua|walijiua|wamejiua|kujinyonga|"
               r"alijinyonga|unyanyasaji wa kingono|kulawiti")

SIMPLE_BAD_RE = re.compile(r"[\d\"“”«»()\[\]/@#&*_=+<>|{}~]|https?:|www\.|\.com|\s-\s|--")


class _Zipf:
    """lexicon.zipf over the Swahili corpus table (picklable): wordfreq has no
    Swahili and silently answers with English."""
    def __init__(self, fz):
        self.fz = fz

    def __call__(self, w):
        return self.fz.get(w, 0.0)


class _BestByFreq(_Zipf):
    def __call__(self, cands):
        return sorted(cands, key=lambda c: (-self.fz.get(c, 0.0), c))[0]


class Analyser:
    """Swahili token -> (lemma, UPOS, feats) over an index of the kaikki
    extract. Picklable (plain dicts and sets)."""

    def __init__(self, kaikki_gz):
        self.noun = {}          # noun lemma -> class note ("ki/vi")
        self.noun_form = {}     # plural / locative form -> noun lemma
        self.plural = {}        # noun lemma -> plural forms (kaikki head/forms)
        self.verb = {}          # verb stem -> (lemma stem after derivation folding)
        self.verb_raw = {}      # verb stem -> (own_gloss, deriv tag, base)
        self.adj_stem = set()   # declinable adjective stems
        self.adj_form = {}      # agreement form -> stem
        self.other = defaultdict(set)   # word -> kaikki POS with a definitional sense (non-noun, non-verb)
        self.intj_form = {}     # asanteni -> asante
        self.all_words = set()
        self._load(kaikki_gz)

    # ---- index ---------------------------------------------------------------
    def _load(self, path):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                if d.get("lang_code") != "sw":
                    continue
                w, pos = fold_word(d.get("word", "")), d.get("pos", "")
                if not w or not re.fullmatch(r"[a-z]+(?:['-][a-z]+)*", w):
                    continue
                self.all_words.add(w)
                senses = d.get("senses", [])
                defs = [s for s in senses if "form-of" not in (s.get("tags") or []) and
                        not "alt-of" in (s.get("tags") or []) and
                        not APPENDIX_RE.search((s.get("glosses") or [""])[-1])]
                forms_of = [s for s in senses if "form-of" in (s.get("tags") or []) or s.get("form_of")]
                if pos == "noun":
                    if not defs:
                        # a diminutive / augmentative with its own gloss is a noun of
                        # its own (kilima "diminutive of mlima: small hill")
                        defs = [s for s in senses if set(s.get("tags") or []) & {"diminutive", "augmentative"}
                                and ":" in (s.get("glosses") or [""])[-1]]
                    if not defs:
                        for s in senses:     # tathimini -> tathmini
                            ao = (s.get("alt_of") or [{}])[0]
                            tgt = fold_word(ao.get("word") or "")
                            if "alt-of" in (s.get("tags") or []) and tgt and tgt != w and re.fullmatch(r"[a-z']+", tgt):
                                self.noun_form.setdefault(w, tgt)
                                break
                    if defs:
                        cls = self._class_note(d, defs)
                        if w not in self.noun or (cls and not self.noun[w]):
                            self.noun[w] = cls
                        for fm in d.get("forms", []):
                            t = set(fm.get("tags") or [])
                            f = fold_word(fm.get("form", ""))
                            if "plural" in t and f and f != w and re.fullmatch(r"[a-z']+", f):
                                self.noun_form.setdefault(f, w)
                                self.plural.setdefault(w, [])
                                if f not in self.plural[w]:
                                    self.plural[w].append(f)
                    for s in forms_of:
                        tg = set(s.get("tags") or [])
                        tgt = fold_word(((s.get("form_of") or [{}])[0].get("word") or ""))
                        if tgt and tg & {"plural", "locative"} and re.fullmatch(r"[a-z']+", tgt):
                            self.noun_form.setdefault(w, tgt)
                            if "plural" in tg and "locative" not in tg:
                                self.plural.setdefault(tgt, [])
                                if w not in self.plural[tgt]:
                                    self.plural[tgt].append(w)
                elif pos == "verb":
                    head = [h.get("name") for h in d.get("head_templates", [])]
                    derived = any(set(s.get("tags") or []) & DERIV_TAGS for s in forms_of)
                    if "sw-verb" not in head and not derived:
                        continue        # inflected forms (kusoma, ninarudi, sitaki): parsed, not listed
                    deriv, base, gl = None, None, ""
                    for s in forms_of:
                        tg = set(s.get("tags") or []) - {"form-of"}
                        fo = (s.get("form_of") or [{}])[0]
                        raw, _, extra = (fo.get("word") or "").strip().partition(" ")
                        tgt = fold_word(raw)     # "-uzulu to resign": target + its gloss
                        kinds = tg & {"passive", "applicative", "reciprocal", "causative", "stative",
                                      "conversive", "reflexive", "intensive"}
                        if kinds and tgt:
                            deriv, base = sorted(kinds)[0], tgt
                            gl = gl or (fo.get("extra") or "").strip() or (
                                extra.strip() if extra.strip().startswith("to ") else "")
                    if base is None and not defs:
                        # an alternative spelling (shitaki, tumai, stua): folds into
                        # the main verb (an empty gloss always folds)
                        for s in senses:
                            ao = (s.get("alt_of") or [{}])[0]
                            tgt = fold_word(ao.get("word") or "")
                            if "alt-of" in (s.get("tags") or []) and tgt and tgt != w:
                                deriv, base = "alt", tgt
                                break
                    if defs:
                        gl = (defs[0].get("glosses") or [""])[-1]
                        if base is None:
                            deriv = None
                    prev = self.verb_raw.get(w)
                    if prev is None or (gl and not prev[0]):
                        self.verb_raw[w] = (gl, deriv, base)
                elif pos == "adj":
                    ht = [h.get("args", {}) for h in d.get("head_templates", [])]
                    if any(a.get("3") == "declinable" for a in ht) and defs:
                        self.adj_stem.add(w)
                    elif defs:
                        self.other[w].add("adj")
                    if pos == "adj" and not defs:
                        pass
                elif pos in ("adv", "conj", "prep", "pron", "det", "num", "intj", "particle", "prep_phrase"):
                    if defs:
                        self.other[w].add(pos)
                    if pos == "intj":
                        for fm in d.get("forms", []):
                            f = fold_word(fm.get("form", ""))
                            if "plural" in (fm.get("tags") or []) and f and re.fullmatch(r"[a-z]+", f):
                                self.intj_form.setdefault(f, w)
        for v, g in SYNTH_VERBS.items():
            self.verb_raw.setdefault(v, (g, None, None))
        for n, cls in SYNTH_NOUNS.items():
            self.noun.setdefault(n, cls)
        for v in self.verb_raw:
            self.verb[v] = self._fold_verb(v)
        for s in sorted(self.adj_stem):
            for f in adj_forms(s):
                self.adj_form.setdefault(f, s)

    def _class_note(self, d, defs):
        """Noun class pair for the gloss: ki/vi, m/wa, m/mi, ji/ma, n/n, u/n, u, ma."""
        code = None
        for h in d.get("head_templates", []):
            if h.get("name") == "sw-noun":
                code = (h.get("args") or {}).get("1")
                no_pl = (h.get("args") or {}).get("2") == "-"
                break
        else:
            return ""
        sing = None
        for s in defs:
            for t in s.get("tags") or []:
                if t in CLASS_ROMAN:
                    sing = CLASS_ROMAN[t]
                    break
            if sing:
                break
        if code == "n" and sing == 11:
            return "u/n"
        if code == "ma" and sing in (11, 14):
            return "u/ma"
        if code in PLURAL_CODE and not no_pl:
            return PLURAL_CODE[code]
        if code == "u" or sing in (11, 14):
            return "u"
        return SING_ONLY.get(sing, "")

    def _fold_verb(self, v, depth=0):
        """A derived verb folds into its base unless it is a word of its own:
        a passive whose gloss is not "to be ..." (elewa "to understand"), an
        applicative whose gloss is not "to X for/to someone" (ambia "to tell"),
        a reciprocal not "each other" (kutana "to meet"), and any causative,
        stative or conversive with a gloss (fundisha, onekana, fungua)."""
        gl, deriv, base = self.verb_raw[v]
        if v in KEEP_DERIVED or depth >= 3 or not base or base not in self.verb_raw or base == v:
            return v
        g = gl.lower()
        fold = not g or v in FOLD_DERIVED or (
            deriv == "passive" and re.match(r"^(?:to )?(?:be|get)\b", g)) or (
            deriv == "applicative" and APPL_FOLD_RE.search(g)) or (
            deriv == "reciprocal" and _shares(g, self.verb_raw[base][0].lower()))
        return self._fold_verb(base, depth + 1) if fold else v

    # ---- verb stems ----------------------------------------------------------
    def verb_stem(self, rest, finals="a"):
        """(verb lemma, derived) for a stem string, or None. `finals`: the
        final vowels this slot allows besides -a: negative present -i
        (hasomi), subjunctive -e (asome); a stem not in -a (rudi, jibu)
        matches as written anywhere. An unlisted passive (-wa, -iwa, -ewa,
        -liwa) or applicative (-ia, -ea, -lia) stem folds to a listed base
        (derived=True: scored below a plain reading)."""
        if len(rest) < 1:
            return None
        if finals == "e" and rest.endswith("a"):
            return None     # a subjunctive of an -a verb ends in -e: i-menyesha is i-me-nyesha
        if rest in self.verb:
            return self.verb[rest], False
        cands = [rest]
        if rest[-1:] in finals and rest[-1:] in "ie":
            c = rest[:-1] + "a"
            if c in self.verb and c.endswith("a"):
                return self.verb[c], False
            cands.append(c)
        for c in cands:
            if not c.endswith("a"):
                continue
            for suf, rep in (("wa", "a"), ("iwa", "a"), ("ewa", "a"), ("liwa", "a"), ("lewa", "a"),
                             ("ia", "a"), ("ea", "a"), ("lia", "a"), ("lea", "a"), ("na", "a"),
                             ("ishwa", "isha"), ("eshwa", "esha"), ("zwa", "za")):
                if c.endswith(suf) and len(c) - len(suf) >= 2:
                    b = c[:-len(suf)] + rep
                    if b in self.verb:
                        return self.verb[b], True
        return None

    def _stems_after(self, rest, allow_om=True, mono_ku=False, finals="a"):
        """(lemma, score length, penalty) readings of `rest` = [OM] [ku] stem.
        A kept ku of a monosyllabic verb (alikuwa, atakuja) counts in the
        length; a stem reached only by folding an unlisted derivation suffix
        is penalised (alikuwa is kuwa, not a passive of kua)."""
        out = []
        tries = [(rest, 0, 0)]
        if mono_ku and rest.startswith("ku") and len(rest) > 2:
            tries.append((rest[2:], 1, 2))
        if mono_ku and rest.startswith("kw") and len(rest) > 2 and rest[2] in KW_VOWEL:
            tries.append((rest[2:], 1, 2))
        if allow_om:
            for om in OM:
                if rest.startswith(om) and len(rest) > len(om):
                    tries.append((rest[len(om):], 2, 0))
        for r, pen, bonus in tries:
            for body in (r, r[:-2] if r.endswith("ni") and len(r) > 3 else None):
                if not body:
                    continue
                hit = self.verb_stem(body, finals)
                if hit:
                    v, derived = hit
                    if pen == 1 and not (len(body) <= 3 or body[0] in KW_VOWEL):
                        continue
                    out.append((v, len(body) + bonus, pen + (6 if derived else 0)))
        return out

    def parse_verb(self, w):
        """All verb readings of a surface: [(lemma, feats, score)], best first."""
        res = []

        def add(rest, feats, base_pen, allow_om=True, mono_ku=True, finals="a"):
            for v, n, pen in self._stems_after(rest, allow_om, mono_ku, finals):
                res.append((v, feats, n * 2 - base_pen - pen))
        # infinitive
        for pre, neg in (("kuto", True), ("ku", False), ("kw", False)):
            if w.startswith(pre) and len(w) > len(pre) + 1:
                rest = w[len(pre):]
                if pre == "kw" and rest[0] not in KW_VOWEL:
                    continue
                add(rest, {"VerbForm": "Inf"} | ({"Polarity": "Neg"} if neg else {}), 0, mono_ku=neg)
        # habitual hu-
        if w.startswith("hu") and len(w) > 3:
            add(w[2:], {"VerbForm": "Fin", "Aspect": "Hab"}, 1)
        # affirmative SM + TAM (+ka) (+REL)
        for sm in SM:
            if not w.startswith(sm):
                continue
            r1 = w[len(sm):]
            for tam in TAM:
                if not r1.startswith(tam):
                    continue
                r2 = r1[len(tam):]
                add(r2, {"VerbForm": "Fin"}, 0)
                for k in ("ka", ""):
                    if not r2.startswith(k):
                        continue
                    r3 = r2[len(k):]
                    for rel in REL:
                        if r3.startswith(rel) and (k or tam in ("na", "li", "ta", "nge", "ngali")):
                            add(r3[len(rel):], {"VerbForm": "Fin", "PronType": "Rel"}, 1)
            # subjunctive / general relative / -si- negative subjunctive and relative
            add(r1, {"VerbForm": "Fin", "Mood": "Sub"}, 2, mono_ku=False, finals="e")
            if r1.startswith("si"):
                r2 = r1[2:]
                for tam in ("ngali", "ngeli", "nge"):
                    if r2.startswith(tam):
                        add(r2[len(tam):], {"VerbForm": "Fin", "Polarity": "Neg"}, 0)
                add(r2, {"VerbForm": "Fin", "Polarity": "Neg"}, 1, mono_ku=False, finals="e")
                for rel in REL:
                    if r2.startswith(rel):
                        add(r2[len(rel):], {"VerbForm": "Fin", "Polarity": "Neg", "PronType": "Rel"}, 1)
            for rel in REL:
                if r1.endswith(rel) and len(r1) > len(rel) + 1:
                    add(r1[:-len(rel)], {"VerbForm": "Fin", "PronType": "Rel"}, 2, mono_ku=False)
        for sm in SM_VOWEL:
            if w.startswith(sm) and len(w) > len(sm) + 1 and w[len(sm)] in KW_VOWEL:
                add(w[len(sm):], {"VerbForm": "Fin", "Mood": "Sub"}, 3, allow_om=False, mono_ku=False, finals="e")
        # negative
        for nsm in NEG_SM:
            if not w.startswith(nsm):
                continue
            r1 = w[len(nsm):]
            for tam in NEG_TAM:
                if tam and not r1.startswith(tam):
                    continue
                add(r1[len(tam):], {"VerbForm": "Fin", "Polarity": "Neg"}, 0 if tam else 1,
                    finals="a" if tam else "i")
        # colloquial 1sg present na- (najua, napenda = ninajua, ninapenda)
        if w.startswith("na") and len(w) > 4:
            add(w[2:], {"VerbForm": "Fin"}, 1)
        # imperative
        add(w, {"VerbForm": "Fin", "Mood": "Imp"}, 3, mono_ku=False)
        if w.endswith("eni") and len(w) > 4:
            add(w[:-2], {"VerbForm": "Fin", "Mood": "Imp"}, 3, mono_ku=False, finals="e")     # someni, njooni
        res.sort(key=lambda x: (-x[2], x[0]))
        return res

    # ---- nominal readings -------------------------------------------------------
    def noun_lemma(self, w):
        if w in self.noun:
            return w
        if w in self.noun_form and self.noun_form[w] in self.noun:
            return self.noun_form[w]
        if w.endswith("ni") and len(w) > 4:
            b = w[:-2]
            for c in (b, self.noun_form.get(b)):
                if c and c in self.noun:
                    return c
                if c and c in self.noun_form and self.noun_form[c] in self.noun:
                    return self.noun_form[c]
        return None

    CONTEXT_WORDS = {"wao", "vizuri", "vibaya", "kidogo", "kuwa", "kulia", "basi", "huenda", "karibu",
                     "ndiyo", "ndio", "la"}

    def analyse_memo(self, low, prev=None, prev2=None, nxt=None):
        """analyse with a cache: context matters only for CONTEXT_WORDS and
        adjective forms (after a noun)."""
        memo = self.__dict__.setdefault("_memo", {})
        if low in self.CONTEXT_WORDS:
            key = (low, prev, nxt)
        elif low in self.adj_form or "adj" in self.other.get(low, ()):
            key = (low, prev[1] if prev is not None else None,
                   prev is not None and prev[0] in LINK_VERBS, nxt in ASSOC_FORMS)
        else:
            key = low
        r = memo.get(key)
        if r is None:
            r = memo[key] = self.analyse(low, prev, prev2, nxt)
        return r

    def analyse(self, low, prev=None, prev2=None, nxt=None):
        """(lemma, UPOS, feats) for a lowercase word token; prev: the previous
        token's (lemma, UPOS), nxt: the next lowercase surface."""
        prev_noun = prev is not None and prev[1] == "NOUN"
        if low == "wao" and prev_noun:
            return "ao", "DET", {}
        if low in ("vizuri", "vibaya", "kidogo") and prev_noun:
            return {"vizuri": "zuri", "vibaya": "baya", "kidogo": "dogo"}[low], "ADJ", {}
        if low == "kuwa" and prev is not None and (prev[1] == "VERB" and prev[0] in SAY_VERBS or
                                                   prev[0] in THAT_AFTER):
            return "kuwa", "SCONJ", {}
        if low in ("ndiyo", "ndio") and prev is not None:
            return low, "X", {}     # mid-sentence: the focus copula "it is" (ndio silaha), not "yes"
        if low == "la" and prev is None:
            return low, "X", {}     # sentence-initial La, "no" (the associative never opens a sentence)
        if low == "ukiwa":
            # u-ki-wa "(when) you are"; the noun ukiwa "solitude" is rare (the only
            # noun/verb homograph of a one-syllable verb where the verb dominates)
            return "wa", "VERB", {"VerbForm": "Fin"}
        if low == "karibu":
            # "near; almost" before na, before a quantity, or after a copula (karibu
            # na shule, karibu kila siku, iko karibu); otherwise the greeting, also
            # inside quoted speech (anasema, "Karibu sana!")
            if nxt == "na" or nxt in ("kila", "wote", "nusu", "asilimia", "mara") or \
                    (prev is not None and prev[0] in ("wa", "ni", "si")):
                return "karibu", "ADV", {}
            return "karibu", "INTJ", {}
        if low == "kulia" and prev is not None and (prev[0] in ("upande", "mkono", "kwa", "a") or nxt == "na"):
            return "kulia", "ADV", {}
        if low == "basi" and prev is not None and prev[0] in ("kwa", "a", "katika", "kwenye"):
            return "basi", "NOUN", {}           # kwa basi "by bus", not basi "so, well"
        if low == "huenda" and prev is not None and prev[1] in ("NOUN", "PRON", "PROPN"):
            return "enda", "VERB", {"VerbForm": "Fin", "Aspect": "Hab"}   # X huenda "X goes", not "maybe"
        if low in CLOSED:
            lem, upos = CLOSED[low]
            return lem, upos, {}
        if low in KNOWN_X:
            return low, "X", {}
        if low in self.intj_form:
            return self.intj_form[low], "INTJ", {}
        # an agreeing adjective right after a noun or a copula/verb (mtoto mdogo,
        # watu wazuri, yeye ni mdogo); elsewhere a noun homograph is the noun
        # (mdogo wangu "my younger sibling", wakubwa "elders")
        # A noun headword followed by an associative is the noun (ni kitovu cha
        # biashara, kuna uchache wa maji): an adjective does not take -a "of"
        # a noun headword right after a non-copula verb is its object (alimwoa
        # mke "he married a wife"), not a predicate adjective (yeye ni mdogo)
        # (also a noun/adjective homograph: kuna tofauti "there is a difference",
        # kulinda maslahi "protect interests"); a linking verb keeps the
        # predicate adjective (walikuwa huru, alikaa kimya, anaonekana mdogo)
        head_noun = (low in self.noun or low in self.noun_form) and (
            # (a modifier slot keeps the adjective: maumivu makali ya tumbo)
            (nxt in ASSOC_FORMS and "adj" not in self.other.get(low, ()) and
             (prev is None or prev[1] not in ("NOUN", "NUM", "DET", "ADJ"))) or
            (prev is not None and prev[1] == "VERB" and prev[0] not in LINK_VERBS))
        # the modifier slot also follows a numeral, possessive/demonstrative or
        # another adjective (watoto wawili wadogo, rafiki yangu mzuri)
        if prev is not None and prev[1] in NP_SLOT and low in self.adj_form and \
                low not in self.verb and not head_noun:
            return self.adj_form[low], "ADJ", {}
        oth = self.other.get(low)
        if oth and oth <= {"adj", "adv"}:
            pv = self.parse_verb(low)
            if pv and pv[0][1].get("PronType") == "Rel" and (pv[0][2] >= 6 or pv[0][0] in ("ja", "la", "nywa", "pa")):
                oth = None      # (wiki) iliyopita "(which) passed" = last, ijayo: relative verb forms
        # a noun/adjective homograph (huru, fulani, safi) is the adjective after
        # a noun or a verb/copula (serikali huru, kuwa huru, ni safi)
        if oth and "adj" in oth and prev is not None and prev[1] in NP_SLOT and not head_noun:
            return low, "ADJ", {}
        # an adjective whose dictionary entry is also an interjection (nzuri, safi,
        # kimya: "fine!", "great!", "silence!") is the adjective: the pack teaches
        # no such interjection, and mid-sentence it modifies (ndogo lakini nzuri)
        if oth and "intj" in oth and "adj" not in oth and (low in self.adj_form or low in self.adj_stem):
            oth = None
        n = self.noun_lemma(low)
        if n:
            num = {"Number": "Plur"} if n != low and not low.endswith("ni") else {}
            return n, "NOUN", num
        if oth and oth == {"intj"} and self.parse_verb(low):
            oth = None          # sitaki "I don't want": a verb form, not the interjection entry
        if oth:
            for kp, up in (("adv", "ADV"), ("conj", "CCONJ"), ("prep", "ADP"), ("pron", "PRON"),
                           ("det", "DET"), ("num", "NUM"), ("adj", "ADJ"), ("intj", "INTJ"), ("particle", "PART"),
                           ("prep_phrase", "ADP")):
                if kp in oth:
                    return low, up, {}
        if low in self.adj_form:
            return self.adj_form[low], "ADJ", {}
        if low in self.adj_stem:
            return low, "ADJ", {}
        # ki- + noun: manner adverb / adjective (kijamii "social", kisiasa) not
        # listed in the dictionary: known, not taught
        if low.startswith("ki") and len(low) > 5 and self.noun_lemma(low[2:]):
            return low, "X", {}
        pv = self.parse_verb(low)
        if pv:
            v, feats, _ = pv[0]
            return v, "VERB", dict(feats)
        # noun + possessive enclitic (mkewe, mamake, nduguye, mwanangu, mwenzake)
        for suf, adds in (("angu", ("i", "a", "")), ("ako", ("i", "a", "")), ("ake", ("i", "a", "")),
                          ("etu", ("i", "")), ("enu", ("i", "")), ("ao", ("i", "")), ("ngu", ("",)), ("ko", ("",)), ("ke", ("",)),
                          ("we", ("",)), ("ye", ("",))):
            if low.endswith(suf) and len(low) > len(suf) + 2:
                for a in adds:
                    n = self.noun_lemma(low[:-len(suf)] + a)
                    if n:
                        return n, "NOUN", {}
        return low, "NOUN", {"Unk": "Yes"}


class Swahili(LanguageSpec):
    code = "sw"
    name_en = "Swahili"
    pack_name = "Swahili (A1–B1)"
    tts = "sw-KE"
    stt = "sw-KE"
    tatoeba_code = "swh"
    kaikki_lang_code = "sw"
    wordfreq_code = "sw"        # wordfreq has no Swahili: extra_wordfreq replaces its list, bind_lexicon its zipf

    spacy_model = None
    tagger = "rules"
    tagger_attribution = {
        "source": "rule-based Swahili tokeniser and lemmatiser (vocab-engine packbuilder langs/sw.py) over the "
                  "kaikki.org Swahili Wiktionary extract",
        "licence": "MIT (code); CC-BY-SA-3.0/GFDL (dictionary data)",
        "note": "Used at build time only. No statistical tagger exists for Swahili.",
    }

    subtitles_file = "en-sw.txt.zip"      # the frequency corpus (spoken_from_corpus: not read as a list)
    kaikki_file = "kaikki_sw.jsonl.gz"
    sentences_file = "swh_sentences_detailed.tsv.bz2"
    links_file = "swh-eng_links.tsv.bz2"
    gv_file = "en-sw.txt.zip"
    flores_file = "flores200_dataset.tar.gz"
    sources = {
        "kaikki_sw.jsonl.gz": "https://kaikki.org/dictionary/Swahili/kaikki.org-dictionary-Swahili.jsonl.gz",
        "swh_sentences_detailed.tsv.bz2":
            "https://downloads.tatoeba.org/exports/per_language/swh/swh_sentences_detailed.tsv.bz2",
        "swh-eng_links.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/swh/swh-eng_links.tsv.bz2",
        "en-sw.txt.zip": "https://object.pouta.csc.fi/OPUS-GlobalVoices/v2018q4/moses/en-sw.txt.zip",
        "flores200_dataset.tar.gz": "https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz",
        TATOEBA_ENG[0]: TATOEBA_ENG[1],
        TATOEBA_AUDIO[0]: TATOEBA_AUDIO[1],
    }
    versions = {"corpus": "c1", "tag": "t1", "lex": "l1"}

    typing = {"caseSensitive": False, "accents": "strict", "strictFromLevel": "A1"}
    show_pron = False
    use_audio = False
    spoken_from_corpus = True
    spoken_freq_label = "tagged corpus (Tatoeba + GlobalVoices + FLORES) (lemma, POS) token counts"
    use_simplemma = False
    untranslated_rows = True
    refill_unexampled = True
    example_shows_word = False
    form_colon_translation = True
    # the core's capitalised-surface test reads surfaces, not lemmas: a verb
    # stem is rarely a bare lowercase word (piga, kataa) and news capitalises
    # titles (Rais, Waziri, Chuo Kikuu): names come from the analyser's PROPN
    caps_proper_pool = False
    passage_names_never_link = True   # passages: many given names are words (Neema, Baraka, Zawadi, Simba, Moshi)
    verb_endings = None

    word_re = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
    lex_word_re = re.compile(r"^[a-z]+(?:['-][a-z]+)*$")
    sub_token_re = re.compile(r"^[a-z]+(?:'[a-z]+)*$")
    form_target_re = re.compile(r"\bof -?([a-z]+(?:'[a-z]+)*)")
    fem_of_re = re.compile(r"(?!)")

    group_kpos = dict(DEFAULT_GROUP_KPOS, **{
        "NOUN": ["noun", "num", "name"],
        "ADJ": ["adj", "num", "det"],
        "ADV": ["adv", "conj", "prep", "particle", "adj", "noun"],
        "PRON": ["pron", "det", "adj"],
        "DET": ["det", "adj", "pron", "particle"],
        "ADP": ["prep", "particle", "conj", "adv", "prep_phrase"],
        "CONJ": ["conj", "adv", "prep"],
        "NUM": ["num", "adj", "noun"],
        "INTJ": ["intj", "particle", "phrase"],
        "PART": ["particle", "adv", "intj"],
    })
    morph_keep = ("Number", "Polarity", "VerbForm", "Mood", "PronType", "Unk", "Src")

    # ---- selection tables ------------------------------------------------------
    forced_closed = FORCED_CLOSED
    fixed_gloss = CLOSED_GLOSS
    allowed_num = set(NUMBERS)
    no_article = set()
    multiword = {p: tuple(p.split()) for p in PHRASES}
    phrase_absorbs_parts = True
    function_verbs = {"ni", "si"}
    function_lemmas = FUNCTION_LEMMAS
    # na: "and" (CCONJ) and "to have" (kuwa na): one spelling, two words;
    # karibu: "welcome" and "near"
    second_entry_overlap_exempt = frozenset({"na", "karibu"})
    # jamii VERB "to have sex" (kujamiiana): never a word; its sentences are sensitive
    drop_keys = {("jamii", "VERB"): None, ("badala", "ADJ"): ("badala", "NOUN"),
                 ("shoga", "NOUN"): None,       # "girlfriend" / slur homograph
                 ("msagaji", "NOUN"): None,     # "miller" / slur homograph
                 ("kucha", "NOUN"): None,       # usiku kucha "all night" / "warbler": no teachable sense
                 ("onesha", "VERB"): ("onyesha", "VERB"),     # spelling variant of onyesha
                 ("mpiga", "NOUN"): None,       # bound: mpiga picha, mpiga kura (the compound is the word)
                 ("ke", "ADJ"): None}           # bound stem (wa kike); its corpus hits are English like/make/Mike
    sensitive_re = re.compile(r"(?<![A-Za-z])(" + SENSITIVE_SW + "|" + SENSITIVE_EN + r")(?![A-Za-z])", re.I)
    sensitive_gloss_re = re.compile(r"\b(" + SENSITIVE_GLOSS_EN + r")\b", re.I)
    drop_all_levels = drop_all_re(r"(?<![A-Za-z])(" + DROP_ALL_SW + r")(?![A-Za-z])")
    word_ceiling_re = make_word_ceiling_re()
    qa_closed_sets = {
        "days": " ".join(DAYS), "months": " ".join(MONTHS),
        "numbers": " ".join(n for n in NUMBERS if n != "laki"), "pronouns": " ".join(PRONOUNS),
        "possessives": " ".join(POSS_STEMS), "demonstratives": "hii hiyo yule",
        "copula": "ni si", "locatives": "kuna hapa pale huko hapo",
        "question": "nini nani wapi lini gani vipi ngapi",
        "greetings": "habari jambo hujambo sijambo shikamoo marahaba asante karibu pole hodi kwaheri tafadhali "
                     "samahani",
        "time": "leo kesho jana sasa",
        "function": "na a katika kwenye kama lakini au ili kwamba bado tu pia sana siyo ndiyo hapana je",
    }

    report_title = "Swahili A1-B1 pack (rule-lemmatised corpus)"
    numeral_exclusion = "numeral outside the taught number words"

    def __init__(self, repo=None):
        super().__init__(repo)
        self._an = None
        self._freq = None

    # ---- orthography ---------------------------------------------------------
    def fold(self, s):
        return fold_word(s)

    def analyser(self):
        if self._an is None:
            self._an = Analyser(self.repo / ".cache" / self.kaikki_file)
        return self._an

    # ---- tagging ---------------------------------------------------------------
    def tagger_desc(self):
        # the analyser's code and tables are the tagger: any edit to this file re-tags
        return "sw rules " + hashlib.sha1(Path(__file__).read_bytes()).hexdigest()[:10]

    def tag_texts(self, texts):
        an = self.analyser()
        out = []
        # names: words this batch shows capitalised after the first word
        mid_caps = set()
        for t in texts:
            for w in WORD_RE.findall(t)[1:]:
                if w[:1].isupper():
                    mid_caps.add(w)
        for t in texts:
            raw = TOKEN_RE.findall(t)
            toks = []
            prev, prev2 = None, None
            initial = True
            for j, s in enumerate(raw):
                if not WORD_RE.fullmatch(s):
                    upos = "NUM" if s[0].isdigit() else "PUNCT"
                    toks.append((s, s, upos, {}))
                    if s in ".!?:;…\"“”«»":
                        initial = True
                    if s in ",;:()[]—–\"“”«»":
                        prev, prev2 = None, None    # no modifier across a clause break (harusi, wageni ...)
                    continue
                low = s.lower().replace("’", "'")
                nxt = next((x.lower() for x in raw[j + 1:j + 2] if WORD_RE.fullmatch(x)), None)
                if s[:1].isupper() and not initial and low not in CAPITALISED:
                    toks.append((s, s, "PROPN", {}))
                    prev2, prev = prev, (s, "PROPN")
                    initial = False
                    continue
                if s[:1].isupper() and initial and low not in CAPITALISED and s in mid_caps and \
                        an.analyse_memo(low, prev, prev2, nxt)[2].get("Unk"):
                    toks.append((s, s, "PROPN", {}))
                    prev2, prev = prev, (s, "PROPN")
                    initial = False
                    continue
                lem, upos, feats = an.analyse_memo(low, prev, prev2, nxt)
                # days, months, languages are written capitalised: the token keeps the
                # lowercase surface so the linker does not read it as a name (id: hari Senin)
                toks.append((low if low in CAPITALISED else s, lem, upos, dict(feats)))
                prev2, prev = prev, (lem, upos)
                initial = False
            out.append(toks)
        return out


    # ---- corpus: GlobalVoices + FLORES --------------------------------------------
    def _simple(self, sw, en):
        """A GlobalVoices/FLORES pair usable as an example sentence: 4-14 words,
        no digits, quotes, brackets, links or dashes, at most one capitalised
        word after the first, an English side of sane length."""
        n = len(WORD_RE.findall(sw))
        if not 4 <= n <= 14 or SIMPLE_BAD_RE.search(sw) or SIMPLE_BAD_RE.search(en):
            return False
        if not re.search(r"[.!?]$", sw.strip()) or not re.search(r"[.!?]$", en.strip()):
            return False
        caps = [w for w in WORD_RE.findall(sw)[1:] if w[:1].isupper()]
        ne = len(en.split())
        return len(caps) <= 1 and 0.6 * n <= ne <= 2.2 * n + 2

    def extra_corpus_rows(self, env):
        """OPUS GlobalVoices en-sw and FLORES-200 swh_Latn (dev + devtest):
        every sentence joins the frequency corpus; only simple ones keep their
        English (untranslated_rows: the rest are evidence only, never shipped)."""
        rows, seen = [], set()
        with zipfile.ZipFile(env.cache / self.gv_file) as z:
            sw = z.read("GlobalVoices.en-sw.sw").decode("utf-8").split("\n")
            en = z.read("GlobalVoices.en-sw.en").decode("utf-8").split("\n")
        for i, (a, b) in enumerate(zip(sw, en)):
            a, b = a.strip(), b.strip()
            if not a or a in seen:
                continue
            seen.add(a)
            rows.append([GV_BASE + i, a, "", b if self._simple(a, b) else "", None, None])
        fl = {}
        with tarfile.open(env.cache / self.flores_file, "r:gz") as tf:
            for m in tf.getmembers():
                for split in ("dev", "devtest"):
                    for lang in ("swh_Latn", "eng_Latn"):
                        if m.name.endswith(f"/{split}/{lang}.{split}"):
                            fl[(split, lang)] = tf.extractfile(m).read().decode("utf-8").split("\n")
        k = 0
        for split in ("dev", "devtest"):
            for a, b in zip(fl[(split, "swh_Latn")], fl[(split, "eng_Latn")]):
                a, b = a.strip(), b.strip()
                k += 1
                if not a or a in seen:
                    continue
                seen.add(a)
                rows.append([FLORES_BASE + k, a, "", b if self._simple(a, b) else "", None, None])
        return rows

    @staticmethod
    def src_of(sid):
        if not isinstance(sid, int):    # passage rows carry the tag "passage"
            return None
        if sid >= EXAMPLE_SID_BASE:
            return "gen"
        if sid >= FLORES_BASE:
            return "flores"
        if sid >= GV_BASE:
            return "gv"
        return None

    def fix_sentence(self, toks, row, doc):
        src = self.src_of(row[0])
        if src and toks:
            t = toks[0]
            toks[0] = [t[0], t[1], t[2], (t[3] + "|" if t[3] else "") + "Src=" + src]
        return toks

    def sentence_rank(self, toks, lv):
        if toks and "Src=" in toks[0][3]:
            return SRC_PENALTY.get(toks[0][3].rsplit("Src=", 1)[1].split("|")[0], 0)
        return 0

    def sentence_fields(self, row):
        src = self.src_of(row[0])
        return {"src": src} if src else {}

    # ---- frequency ---------------------------------------------------------------
    TATOEBA_WEIGHT = 10     # written list: a Tatoeba token counts 10x a news token (everyday register)

    def _corpus_texts(self, cache):
        """(text, weight) of the frequency corpus: Tatoeba (weighted), GV, FLORES."""
        import bz2
        texts = []
        with bz2.open(cache / self.sentences_file, "rt", encoding="utf-8") as f:
            for line in f:
                q = line.rstrip("\n").split("\t")
                if len(q) >= 3 and q[1] == self.tatoeba_code:
                    texts.append((q[2], self.TATOEBA_WEIGHT))
        with zipfile.ZipFile(cache / self.gv_file) as z:
            texts += [(t, 1) for t in z.read("GlobalVoices.en-sw.sw").decode("utf-8").split("\n")]
        with tarfile.open(cache / self.flores_file, "r:gz") as tf:
            for m in sorted(tf.getmembers(), key=lambda m: m.name):
                if m.name.endswith(("swh_Latn.dev", "swh_Latn.devtest")):
                    texts += [(t, 1) for t in tf.extractfile(m).read().decode("utf-8").split("\n")]
        return [(t, wt) for t, wt in texts if t.strip()]

    def corpus_counts(self):
        """(surface counts, lemma counts) over the corpus, context-free
        analysis; cached under .cache/derived by the analyser's signature."""
        if self._freq is not None:
            return self._freq
        cache = self.repo / ".cache"
        sig = hashlib.sha1((self.tagger_desc() + f"|w{self.TATOEBA_WEIGHT}|" + "|".join(
            str((cache / n).stat().st_size) for n in (self.sentences_file, self.gv_file, self.flores_file))
        ).encode()).hexdigest()[:10]
        p = cache / "derived" / f"sw_counts_{sig}.json"
        if p.exists():
            d = json.loads(p.read_text())
            self._freq = (Counter(d["surf"]), Counter(d["lemma"]))
            return self._freq
        an = self.analyser()
        surf, lem = Counter(), Counter()
        memo = {}
        for t, wt in self._corpus_texts(cache):
            for i, w in enumerate(WORD_RE.findall(t)):
                low = w.lower().replace("’", "'")
                if w[:1].isupper() and i and low not in CAPITALISED:
                    continue            # a name
                if low not in memo:
                    memo[low] = an.analyse(low)
                l, upos, feats = memo[low]
                if feats.get("Unk") or upos == "X":
                    continue
                surf[low] += wt
                lem[l] += wt
        # one key order on both paths (fresh and from cache): ties between equal
        # counts are broken by iteration order downstream
        surf, lem = Counter(dict(sorted(surf.items()))), Counter(dict(sorted(lem.items())))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"surf": dict(surf), "lemma": dict(lem)}, ensure_ascii=False))
        self._freq = (surf, lem)
        return self._freq

    def _zipf_table(self):
        surf, lem = self.corpus_counts()
        tot = sum(surf.values()) or 1
        fz = {}
        for c in (surf, lem):
            for w, n in c.items():
                fz[w] = max(fz.get(w, 0.0), round(math.log10(n / tot * 1e9), 2))
        return fz

    def extra_wordfreq(self, raw):
        """wordfreq has no Swahili (its 'sw' list is English): the written list
        is replaced by the corpus's own surface counts (unknown words and
        grammatical particles left out)."""
        raw.clear()
        surf, _ = self.corpus_counts()
        tot = sum(surf.values()) or 1
        for w, n in surf.items():
            raw[w] = n / tot * 1e9

    # ---- lexicon ---------------------------------------------------------------------
    def bind_lexicon(self, lexicon):
        """kaikki's class-agreement tables ("[[Appendix:...]] inflected form of")
        are form lines, not senses; verbs and nouns kaikki lacks get an entry;
        the frequency lookups read the Swahili corpus table."""
        from ..core.lexicon import header_tags
        from ..core.lex import NONDEF_RE, FORM_OF_ANY_RE
        for w, ents in lexicon.E.items():
            for e in ents:
                for sn in e["s"]:
                    if sn[3] == "form" and "form-of" not in sn[2] and not APPENDIX_RE.search(sn[0]):
                        # the core's untagged form-line test misfires on English
                        # prose: "cash (money in the form of notes)", "-self
                        # (forms intensive forms of pronouns)"; "synonym of ufuko
                        # (“beach”)" carries its gloss in the quotes
                        m = re.match(r"^synonym of \S+ \(“([^”]+)”\)", sn[0])
                        if m:
                            sn[0], sn[3] = m.group(1), ""
                        elif re.match(r"^[^(]*\(.*\bforms? of\b", sn[0]):
                            sn[3] = ""
                        elif sn[1] and not (NONDEF_RE.match(sn[0]) or FORM_OF_ANY_RE.match(sn[0])):
                            # the form line is the first gloss line, the last is a
                            # translation (jidai: "reflexive form of -dai" / "to boast")
                            sn[3] = ""
                    if sn[3] == "" and APPENDIX_RE.search(sn[0]):
                        sn[3] = "form"
        # a derived verb the analyser keeps as a word of its own (jiuzulu "to
        # resign", jisajili "to enroll") has only a form-of line in kaikki:
        # its gloss is the form line's own translation
        an = self.analyser()
        for v, (gl, deriv, base) in an.verb_raw.items():
            if an.verb.get(v) != v or not gl or not deriv or lexicon.usable_entries(v, ["verb"]):
                continue
            g = re.sub(r"^\(literally [^)]*\):?\s*", "", gl).strip(" :;,")
            if not g:
                continue
            if not g.startswith("to "):
                g = "to " + g
            e = {"p": "verb", "s": [[g, "", [], ""]]}
            e["ht"] = header_tags(e)
            lexicon.E.setdefault(v, []).append(e)
        synth = [(v, "verb", g) for v, g in SYNTH_VERBS.items()] + [("mahali", "noun", "place")]
        for w, pos, g in synth:
            if not lexicon.usable_entries(w, [pos]):
                e = {"p": pos, "s": [[g, "", [], ""]]}
                e["ht"] = header_tags(e)
                lexicon.E.setdefault(w, []).append(e)
        fz = self._zipf_table()
        lexicon.zipf = _Zipf(fz)
        lexicon.best_by_freq = _BestByFreq(fz)

    def post_resolve(self, toks, out):
        """The analyser is the lemmatiser: its (lemma, UPOS) stands for every
        word token (the core's dictionary fallbacks never override it)."""
        from ..core.lexicon import group_of, SKIP_UPOS
        res = []
        for (text, lem, upos, ms), r in zip(toks, out):
            if upos in SKIP_UPOS or upos == "NUM" and not WORD_RE.fullmatch(text):
                res.append(None)
            elif upos == "PROPN":
                res.append((text, "PROPN"))
            else:
                res.append((lem, group_of(upos)))
        return res

    def pack_json_extra(self):
        return {"rtl": False, "langTag": "sw", "spaced": True}

    def extra_attribution(self, env, sentences):
        by = Counter(s.get("src", "tatoeba") for s in sentences)
        return {
            "spoken_freq": {"source": "tagged corpus (Tatoeba swh + OPUS GlobalVoices en-sw + FLORES-200 swh_Latn), "
                                      "(lemma, POS) token counts from the rule-based lemmatiser",
                            "licence": "CC-BY 2.0 FR / CC-BY-3.0 / CC-BY-SA-4.0",
                            "note": "approximate ranking: no Swahili subtitle or wordfreq list exists"},
            "written_freq": {"source": "the same corpus's surface counts (wordfreq has no Swahili)",
                             "licence": "CC-BY 2.0 FR / CC-BY-3.0 / CC-BY-SA-4.0"},
            "globalvoices": {"source": "OPUS GlobalVoices v2018q4 en-sw (Global Voices, globalvoices.org)",
                             "licence": "CC-BY-3.0", "url": self.sources[self.gv_file],
                             "sentences_shipped": by["gv"],
                             "note": "frequency corpus; short everyday sentences also used as examples, marked "
                                     "\"src\": \"gv\""},
            "flores": {"source": "FLORES-200 swh_Latn dev + devtest (Meta AI)", "licence": "CC-BY-SA-4.0",
                       "url": self.sources[self.flores_file], "sentences_shipped": by["flores"],
                       "note": "frequency corpus; short sentences also used as examples, marked \"src\": \"flores\""},
            "audio": {"source": "none", "note": "no recorded Swahili audio: browser TTS (sw-KE / sw-TZ voices "
                                                "exist on Android Chrome; most desktop browsers have none)"},
        }

    # ---- display ------------------------------------------------------------------------
    @staticmethod
    def verb_display(stem):
        if stem in ("enda", "isha"):
            return "kw" + stem
        return "ku" + stem

    def finalize_words(self, env, ctx, words):
        """Headword display: verbs as the ku- infinitive (stem kept as alt when
        it is not a one-syllable homograph), nouns with the class pair in the
        gloss and the plural as alt, agreeing stems with a hyphen and their
        commonest agreement forms as alts, demonstratives by their class-1 form,
        days/months/languages capitalised."""
        an = self.analyser()
        surf, _ = self.corpus_counts()
        plural_of = an.plural
        heads = {w["w"] for w in words}
        for w in words:
            lem, g = w["_key"]
            alt = list(w.get("alt") or [])
            if g == "VERB" and w["en"].startswith("be "):
                w["en"] = "to " + w["en"]      # "be afraid, to fear" -> "to be afraid, to fear"
            if g == "VERB" and lem not in ("ni", "si", "kuna", "na", "wa"):
                w["w"] = self.verb_display(lem)
                if len(lem) > 3 and lem not in heads:
                    alt = [lem] + alt
            elif (lem, g) == ("wa", "VERB"):
                w["w"] = "kuwa"
            elif (lem, g) == ("na", "VERB"):
                w["w"] = "kuwa na"
            elif g == "NOUN" and lem in LANGUAGE_NAMES:
                # "The English language" -> "English (language)"; no class pair, no plural
                w["en"] = re.sub(r"^(?:[Tt]he )?(\S+) language\b", r"\1 (language)", w["en"])
                if "language" not in w["en"]:
                    w["en"] += " (language)"
            elif g == "NOUN" and lem in an.noun:
                cls = an.noun.get(lem)
                if cls and not CLASS_NOTE_RE.search(w["en"]):   # an override may carry its own pair
                    w["en"] = f"{w['en']} ({cls})"
                # the plural as alt when the corpus uses it (kaikki lists rare
                # regularised plurals: maraia, miuda)
                pl = sorted((f for f in plural_of.get(lem, []) if surf.get(f, 0) > 0),
                            key=lambda f: (-surf.get(f, 0), f))
                if pl and pl[0] != lem:
                    alt = [pl[0]] + alt
                if cls == "u" and pl and pl[0] != lem:
                    w["en"] = w["en"].replace("(u)", "(u/ma)" if pl[0].startswith("ma") else "(u/n)")
            elif lem in AGREE_STEMS or lem in POSS_STEMS or (g == "ADJ" and lem in an.adj_stem) or \
                    (lem, g) == ("a", "ADP"):
                forms = AGREE_STEMS.get(lem) or (
                    [p + lem for p in POSS_PREFIX] if lem in POSS_STEMS else
                    ASSOC_FORMS if lem == "a" else sorted(adj_forms(lem)))
                fs = sorted({f for f in forms if f != lem}, key=lambda f: (-surf.get(f, 0), f))
                # Wiktionary calls some invariable loan adjectives declinable
                # (kimya, nadra, fisadi): the hyphen only when the corpus uses
                # a prefixed agreement form
                # (prefixed forms that are nouns of their own, ukimya "silence",
                # do not count; a handful of stray forms against a common bare
                # form do not either)
                n_agr = sum(surf.get(f, 0) for f in fs if f not in an.noun)
                agrees = lem not in an.adj_stem or g != "ADJ" or lem in AGREE_STEMS or \
                    n_agr >= max(3, 0.05 * surf.get(lem, 0))
                if lem == "amba":
                    w["w"] = "amba-"
                elif agrees:
                    w["w"] = "-" + lem
                if agrees:
                    alt = [f for f in fs if surf.get(f, 0) > 0 and f not in heads][:6] + alt
            elif g == "DET" and lem in DEMONSTRATIVES:
                w["w"] = DEM_DISPLAY[lem]
                fs = sorted(set(DEMONSTRATIVES[lem]) - {w["w"]}, key=lambda f: (-surf.get(f, 0), f))
                alt = [f for f in fs if f not in heads] + alt
            if lem in CAPITALISED:
                w["w"] = CAPITALISED[lem]
            seen, out = {w["w"].lower()}, []
            for a in alt:
                if a.lower() not in seen:
                    seen.add(a.lower())
                    out.append(a)
            if out:
                w["alt"] = out
            elif "alt" in w:
                w["alt"] = None


SPEC = Swahili
