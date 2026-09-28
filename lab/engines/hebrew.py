"""Hebrew text helpers shared by the server and the G2P worker (stdlib only).

Standard nikud carries no stress mark, and phonikud (the G2P in front of the
open TTS models) then stresses the LAST syllable. About a third of the app's
words are milel (אַבָּא, כֶּלֶב, בָּנָנָה ...), so this module keeps a hand-checked
stress lexicon for the app's word list and writes the stress into the text
with phonikud's own marks:

    U+05AB  (ole, "hat'ama")  on the letter whose vowel is stressed
    U+05BD  (meteg)           on a letter whose shva is vocal (שווא נע)

Unknown vocalized words get their stress predicted by the phonikud-onnx model
(see workers/g2p_worker.py); if that is unavailable phonikud's milra default applies.
"""
import re
import unicodedata

OLE = "֫"       # phonikud stress mark
METEG = "ֽ"     # phonikud vocal-shva mark
SHVA = "ְ"

_LETTER = re.compile(r"[א-ת]")
_MARK = re.compile(r"[֑-ׇ]")
# vowel points, dagesh, shin/sin dots, qamats qatan
_NIKUD = re.compile(r"[ְ-ׇּׁׂ]")
_ALL_MARKS = re.compile(r"[֑-ׇ]")
_WORD = re.compile(r"[א-ת֑-ׇ׳״'\"]+")

# (word exactly as in js/words.js, stressed letter index when NOT the last syllable, vocal-shva letter index)
# Letter indices count Hebrew letters only, from 0. None = phonikud default is right.
_LEXICON_ROWS = [
    ('אַבָּא', 0, None),  # aba
    ('סַבָּא', 0, None),  # saba
    ('דָּג', None, None),  # dag
    ('גַּן', None, None),  # gan
    ('יָם', None, None),  # yam
    ('סַל', None, None),  # sal
    ('כַּף', None, None),  # kaf
    ('חָלָב', None, None),  # halav
    ('גָּמָל', None, None),  # gamal
    ('קַן', None, None),  # kan
    ('בָּנָנָה', 1, None),  # banana
    ('אִמָּא', 0, None),  # ima
    ('פִּיל', None, None),  # pil
    ('סִיר', None, None),  # sir
    ('שִׁיר', None, None),  # shir
    ('תִּיק', None, None),  # tik
    ('קִיר', None, None),  # kir
    ('מַיִם', 0, None),  # mayim
    ('בַּיִת', 0, None),  # bayit
    ('גִּיטָרָה', 2, None),  # gitara
    ('דּוֹב', None, None),  # dov
    ('סוּס', None, None),  # sus
    ('תּוּת', None, None),  # tut
    ('שׁוּם', None, None),  # shum
    ('אוֹר', None, None),  # or
    ('חוֹל', None, None),  # hol
    ('כּוֹבַע', 0, None),  # kova
    ('כַּדּוּר', None, None),  # kadur
    ('תַּפּוּחַ', 1, None),  # tapuah (patach genuva: ta-PU-ach)
    ('עֵץ', None, None),  # etz
    ('כֶּלֶב', 0, None),  # kelev
    ('יֶלֶד', 0, None),  # yeled
    ('לֶחֶם', 0, None),  # lehem
    ('שֶׁמֶשׁ', 0, None),  # shemesh
    ('גֶּשֶׁם', 0, None),  # geshem
    ('בֵּיצָה', None, None),  # beitza
    ('סַבְתָּא', 0, None),  # savta
    ('מְכוֹנִית', None, 0),  # mechonit (me-cho-NIT, vocal shva)
    ('טְרַקְטוֹר', None, None),  # tractor
    ('אַרְיֵה', None, None),  # arye
    ('רַכֶּבֶת', 1, None),  # rakevet
    ('גְּלִידָה', 1, None),  # glida
]

LEXICON_VERSION = 1


def nfc(s):
    return unicodedata.normalize("NFC", s or "")


def has_nikud(text):
    return bool(_NIKUD.search(text or ""))


def strip_nikud(text):
    return _ALL_MARKS.sub("", text or "")


def letters(word):
    return _LETTER.findall(word)


def _key(word):
    return nfc(word.replace(OLE, "").replace(METEG, ""))


def insert_after_letter(word, index, mark):
    """Insert `mark` after the nikud cluster of the index-th Hebrew letter."""
    seen, i, n = -1, 0, len(word)
    while i < n:
        if _LETTER.match(word[i]):
            seen += 1
            j = i + 1
            while j < n and _MARK.match(word[j]):
                j += 1
            if seen == index:
                cluster = word[i + 1:j]
                if mark in cluster:
                    return word
                return word[:j] + mark + word[j:]
            i = j
        else:
            i += 1
    return word


def letter_has_mark(word, index, mark):
    seen, i, n = -1, 0, len(word)
    while i < n:
        if _LETTER.match(word[i]):
            seen += 1
            j = i + 1
            while j < n and _MARK.match(word[j]):
                if seen == index and word[j] == mark:
                    return True
                j += 1
            if seen == index:
                return False
            i = j
        else:
            i += 1
    return False


def marked_letter_indices(word, mark):
    """Letter indices whose nikud cluster contains `mark`."""
    res, seen, i, n = [], -1, 0, len(word)
    while i < n:
        if _LETTER.match(word[i]):
            seen += 1
            j = i + 1
            while j < n and _MARK.match(word[j]):
                if word[j] == mark:
                    res.append(seen)
                j += 1
            i = j
        else:
            i += 1
    return res


def _build():
    lex = {}
    for word, stress, shva in _LEXICON_ROWS:
        w = word
        if shva is not None:
            w = insert_after_letter(w, shva, METEG)
        if stress is not None:
            w = insert_after_letter(w, stress, OLE)
        lex[_key(word)] = w
    return lex


LEXICON = _build()


def lexicon_lookup(word):
    """The stress-marked lexicon form of `word` (marks and Unicode order ignored), or None."""
    return LEXICON.get(_key(word))


def split_words(text):
    """Yield (is_hebrew_word, chunk) covering the whole text."""
    pos = 0
    for m in _WORD.finditer(text):
        if m.start() > pos:
            yield False, text[pos:m.start()]
        yield bool(_LETTER.search(m.group(0))), m.group(0)
        pos = m.end()
    if pos < len(text):
        yield False, text[pos:]


def apply_lexicon(text):
    """Return (text with stress marks, [(word, 'lexicon'|'explicit'|None)])."""
    out, info = [], []
    for is_word, chunk in split_words(nfc(text)):
        if not is_word:
            out.append(chunk)
            continue
        if OLE in chunk:
            out.append(chunk)
            info.append((chunk, "explicit"))
            continue
        hit = lexicon_lookup(chunk)
        if hit is not None:
            out.append(hit)
            info.append((chunk, "lexicon"))
        else:
            out.append(chunk)
            info.append((chunk, None))
    return "".join(out), info
