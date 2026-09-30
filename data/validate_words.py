#!/usr/bin/env python3
"""Validate data/first-words.json.

Run:  python3 data/validate_words.py            (exit code 0 = pass)
      python3 data/validate_words.py --strict   (also fail on reported exceptions)

This file is also the single source of truth for the stage rule. The build
script (tools/build_words.py) imports stage_of() from here, so the stored
stage, the checked stage and js/words.js all come from the same code
(js/words.js carries a JavaScript copy, stageOfText(), for words the parent
adds; the build checks that copy against this one).

Stage rule (the app's vowel progression, js/words.js): one vowel sound per
stage, in teaching order:
  1 = a   qamats U+05B8 / patah U+05B7
  2 = i   hiriq U+05B4
  3 = o   holam U+05B9 / U+05BA, qamats qatan U+05C7
  4 = u   shuruk (vav + dagesh with no other vowel on it), qubuts U+05BB
  5 = e   tsere U+05B5 / segol U+05B6
  6 = shva U+05B0 or any hataf U+05B1-U+05B3
A word's stage is the highest stage any of its vowels needs. Dagesh, shin/sin
dots and silent letters (final letters, alef/he/yod/vav as matres) do not
raise it. Decision: a shva on the last letter of a word (ךְ, אַתְּ) is
silent spelling, so it does not raise the stage either.

Stations (tools/build_words.py): inside each stage the words are sorted by
letter count, then by list order, and cut into round(count / 30) nearly equal
consecutive chunks. The stored `station` is checked against the build.

Legacy: the `level` field is the OLD 5-level rule (1 = qamats/patah,
2 = hiriq, 3 = holam/shuruk/qubuts, 4 = tsere/segol, 5 = shva/hataf or 4+
syllables), kept unchanged and still checked by analyze(); the file stays
sorted by it. The app no longer uses it.
"""
import json
import os
import sys
import unicodedata

# ---------------------------------------------------------------- characters
LETTERS = {chr(c) for c in range(0x05D0, 0x05EB)}          # א..ת incl. finals
FINALS = set('ךםןףץ')
NONFINAL_OF = {'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'}
GUTTURALS = set('אהחער')

SHVA, HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS = 'ְ', 'ֱ', 'ֲ', 'ֳ'
HIRIQ, TSERE, SEGOL, PATAH, QAMATS = 'ִ', 'ֵ', 'ֶ', 'ַ', 'ָ'
HOLAM, HOLAM_VAV, QUBUTS = 'ֹ', 'ֺ', 'ֻ'
DAGESH, SHIN_DOT, SIN_DOT, QAMATS_QATAN = 'ּ', 'ׁ', 'ׂ', 'ׇ'

VOWELS = {SHVA, HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS, HIRIQ, TSERE, SEGOL,
          PATAH, QAMATS, HOLAM, HOLAM_VAV, QUBUTS, QAMATS_QATAN}
ALLOWED_MARKS = VOWELS | {DAGESH, SHIN_DOT, SIN_DOT}        # U+05B0-05BB, 05BC, 05C1, 05C2, 05C7

VOWEL_LEVEL = {
    QAMATS: 1, PATAH: 1,
    HIRIQ: 2,
    HOLAM: 3, HOLAM_VAV: 3, QUBUTS: 3, QAMATS_QATAN: 3,
    TSERE: 4, SEGOL: 4,
    SHVA: 5, HATAF_SEGOL: 5, HATAF_PATAH: 5, HATAF_QAMATS: 5,
}
FULL_VOWELS = {QAMATS, PATAH, HIRIQ, HOLAM, HOLAM_VAV, QUBUTS, QAMATS_QATAN, TSERE, SEGOL}
HATAFS = {HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS}
LEVEL_NAMES = {1: 'qamats/patah', 2: 'hiriq', 3: 'holam/shuruk/qubuts', 4: 'tsere/segol', 5: 'shva/hataf/long'}

# ---------------------------------------------------------------- stage rule
STAGE_OF_MARK = {
    QAMATS: 1, PATAH: 1,
    HIRIQ: 2,
    HOLAM: 3, HOLAM_VAV: 3, QAMATS_QATAN: 3,
    QUBUTS: 4,
    TSERE: 5, SEGOL: 5,
    SHVA: 6, HATAF_SEGOL: 6, HATAF_PATAH: 6, HATAF_QAMATS: 6,
}
SHURUK_STAGE = 4
STAGE_NAMES = {1: 'a (qamats/patah)', 2: 'i (hiriq)', 3: 'o (holam)',
               4: 'u (shuruk/qubuts)', 5: 'e (tsere/segol)', 6: 'shva/hataf'}


def is_mark(ch):
    """A Hebrew combining mark (points, dagesh, dots, cantillation, meteg)."""
    return '\u0591' <= ch <= '\u05C7' and unicodedata.category(ch) == 'Mn'


def word_clusters(text):
    """[(letter, set(marks), last_in_word)] for every Hebrew letter of text.

    Anything that is neither a Hebrew letter nor a Hebrew mark (space, maqaf,
    punctuation) ends a word. Marks with no letter before them are ignored.
    """
    out = []
    word_open = False
    for ch in unicodedata.normalize('NFD', text):     # splits presentation forms (שּׁ U+FB2C)
        if ch in LETTERS:
            out.append([ch, set(), False])
            word_open = True
        elif is_mark(ch):
            if word_open:
                out[-1][1].add(ch)
        else:
            if word_open:
                out[-1][2] = True
            word_open = False
    if out:
        out[-1][2] = True
    return [tuple(c) for c in out]


def stage_of(text):
    """The stage (1-6) a vocalized word needs. Text with no vowels is stage 1."""
    stage = 1
    for letter, marks, last in word_clusters(text):
        vowels = marks & STAGE_OF_MARK.keys()
        if letter == 'ו' and DAGESH in marks and not vowels:
            stage = max(stage, SHURUK_STAGE)          # וּ shuruk
            continue
        for v in vowels:
            if v == SHVA and last:
                continue                              # silent final shva (ךְ)
            stage = max(stage, STAGE_OF_MARK[v])
    return stage


def strip_marks(text):
    """Letters only (what the word looks like without nikud)."""
    return ''.join(ch for ch in text if ch in LETTERS)


def clusters(text):
    """Split into [letter, set(marks)] clusters. Raises on a mark with no letter."""
    out = []
    for ch in text:
        if ch in LETTERS:
            out.append([ch, set()])
        elif not out:
            raise ValueError('text starts with a mark')
        else:
            out[-1][1].add(ch)
    return out


def _vowels(marks):
    return marks & VOWELS


def analyze(text):
    """Return level, syllables, letters, the vowel sounds used, and structural exceptions."""
    cl = clusters(text)
    n = len(cl)
    issues = []           # vowel-structure exceptions (reported)
    errors = []           # spelling-form errors (always fail)
    levels = []           # one entry per sounded vowel mark
    nuclei = 0            # syllable nuclei
    kinds = []            # carrier description per cluster (for the structure check)

    for i, (L, M) in enumerate(cl):
        V = _vowels(M)
        prevV = _vowels(cl[i - 1][1]) if i else set()
        last = i == n - 1
        kind = 'consonant'
        if L == 'ו' and V == {HOLAM} and not (prevV - {SHVA}):
            kind = 'holam-male'           # וֹ carries the o of the previous consonant
        elif L == 'ו' and DAGESH in M and not V and (i == 0 or not prevV):
            kind = 'shuruk'               # וּ carries u
        kinds.append(kind)

        if kind == 'shuruk':
            levels.append(3)
            nuclei += 1
            continue
        for v in V:
            if v == SHVA and last and L == 'ך':
                continue                  # ךְ: silent, written shva
            levels.append(VOWEL_LEVEL[v])
            if v in FULL_VOWELS or v in HATAFS:
                nuclei += 1
            elif v == SHVA and not last:
                # shva na: word-initial, or the second of two shvas in a row
                if i == 0 or (SHVA in prevV and i >= 2):
                    nuclei += 1
        if len(V) > 1:
            errors.append(f'letter {i + 1} ({L}) has more than one vowel mark')

    # ----- structure: every non-final letter needs a vowel/shva or must be silent / a mater
    for i, (L, M) in enumerate(cl):
        V = _vowels(M)
        last = i == n - 1
        if last:
            if SHVA in V and L != 'ך':
                issues.append(f'final letter {L} carries a shva')
            continue
        if V or kinds[i] in ('holam-male', 'shuruk'):
            continue
        nxt = cl[i + 1]
        if i + 1 < n and kinds[i + 1] in ('holam-male', 'shuruk'):
            continue                                   # vowel written on the following vav
        prevV = _vowels(cl[i - 1][1]) if i else set()
        if L == 'א':
            continue                                   # silent alef (רֹאשׁ, כָּאן, פָלָאפֶל)
        if L == 'י' and (prevV & {HIRIQ, TSERE, SEGOL}):
            continue                                   # mater: hiriq/tsere/segol + yod
        if L == 'י' and QAMATS in prevV and nxt[0] == 'ו' and i + 1 == n - 1:
            continue                                   # suffix -ָיו
        issues.append(f'letter {i + 1} ({L}) has no vowel and is not a silent letter or mater')

    # ----- letter forms and dagesh placement
    for i, (L, M) in enumerate(cl):
        last = i == n - 1
        if L in FINALS and not last:
            errors.append(f'final form {L} in the middle of the word')
        if last and L in NONFINAL_OF.values() and n > 1:
            errors.append(f'non-final form {L} at the end of the word')
        if DAGESH in M and L in GUTTURALS and not (L == 'ה' and last):
            errors.append(f'dagesh in guttural {L}')
        if (SHIN_DOT in M or SIN_DOT in M) and L != 'ש':
            errors.append(f'shin/sin dot on {L}')
        if L == 'ש' and not (M & {SHIN_DOT, SIN_DOT}):
            errors.append('ש without shin/sin dot')
        if SHIN_DOT in M and SIN_DOT in M:
            errors.append('both shin and sin dot')

    level = max(levels) if levels else 0
    if not levels:
        errors.append('no vowels at all')
    if nuclei >= 4:
        level = 5
    return {
        'stage': stage_of(text),
        'level': level,
        'syllables': nuclei,
        'letters': n,
        'vowel_levels': sorted(set(levels)),
        'issues': issues,
        'errors': errors,
    }


def check_chars(text):
    bad = [f'U+{ord(c):04X}' for c in text if c not in LETTERS and c not in ALLOWED_MARKS]
    return bad


# ---------------------------------------------------------------- validator
def _built_stations(words, err):
    """{json index: station} as tools/build_words.py computes it (None if it cannot run)."""
    here = os.path.dirname(os.path.abspath(__file__))
    tools = os.path.join(os.path.dirname(here), 'tools')
    sys.dont_write_bytecode = True
    sys.path.insert(0, tools)
    try:
        import build_words
        return {w['src']: w['station'] for w in build_words.build(words)[0] if w['src'] is not None}
    except Exception as e:                    # noqa: BLE001 - reported as a validation error
        err(f'could not recompute stations with tools/build_words.py: {e}')
        return None
    finally:
        sys.path.remove(tools)


def main(argv):
    strict = '--strict' in argv
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, 'first-words.json')
    with open(path, encoding='utf-8') as f:
        words = json.load(f)

    errors, exceptions = [], []
    err = errors.append

    if not isinstance(words, list):
        print('FAIL: top level is not an array')
        return 1
    if len(words) != 500:
        err(f'expected exactly 500 entries, found {len(words)}')

    required = {'id', 'text', 'plain', 'pic', 'level', 'stage', 'station', 'syllables',
                'letters', 'category', 'sources', 'confidence'}
    seen_id, seen_text, seen_plain = {}, {}, {}
    prev_level = 0
    by_level, by_stage, by_station, by_cat = {}, {}, {}, {}
    built = _built_stations(words, err)
    for k, w in enumerate(words):
        tag = f'#{k} {w.get("id")!r}'
        missing = required - set(w)
        if missing:
            err(f'{tag}: missing fields {sorted(missing)}')
            continue
        extra = set(w) - required - {'note'}
        if extra:
            err(f'{tag}: unexpected fields {sorted(extra)}')
        t = w['text']
        # uniqueness
        for key, table, label in ((w['id'], seen_id, 'id'), (t, seen_text, 'text'),
                                  (w['plain'], seen_plain, 'plain')):
            if key in table:
                err(f'{tag}: duplicate {label} {key!r} (also #{table[key]})')
            table[key] = k
        if not isinstance(w['id'], str) or not w['id'].isascii() or not w['id'].replace('_', '').replace('-', '').isalnum():
            err(f'{tag}: id must be a latin slug')
        # characters
        bad = check_chars(t)
        if bad:
            err(f'{tag}: disallowed characters {bad}')
            continue
        if not t or t[0] not in LETTERS:
            err(f'{tag}: text must start with a letter')
            continue
        if unicodedata.normalize('NFC', t) != t:
            err(f'{tag}: text is not NFC-normalized (mark order)')
        # plain
        if w['plain'] != strip_marks(t):
            err(f'{tag}: plain {w["plain"]!r} != stripped text {strip_marks(t)!r}')
        # recomputed values
        a = analyze(t)
        if a['stage'] != w['stage']:
            err(f'{tag} {t}: stored stage {w["stage"]} but computed {a["stage"]}')
        if built is not None and built.get(k) != w['station']:
            err(f'{tag} {t}: stored station {w["station"]} but the build gives {built.get(k)}')
        if a['level'] != w['level']:
            err(f'{tag} {t}: stored level {w["level"]} but computed {a["level"]}')
        if a['syllables'] != w['syllables']:
            err(f'{tag} {t}: stored syllables {w["syllables"]} but computed {a["syllables"]}')
        if a['letters'] != w['letters']:
            err(f'{tag} {t}: stored letters {w["letters"]} but computed {a["letters"]}')
        for issue in a['issues']:
            exceptions.append(f'{tag} {t}: {issue}')
        for e in a['errors']:
            err(f'{tag} {t}: {e}')
        # other fields
        if w['confidence'] not in ('high', 'check'):
            err(f'{tag}: confidence must be "high" or "check"')
        if w['confidence'] == 'check' and not w.get('note'):
            err(f'{tag}: "check" entries need a note with the reason')
        if not isinstance(w['sources'], list) or not w['sources'] or not all(isinstance(s, str) for s in w['sources']):
            err(f'{tag}: sources must be a non-empty list of strings')
        if not isinstance(w['pic'], str):
            err(f'{tag}: pic must be a string')
        if w['level'] < prev_level:
            err(f'{tag}: not sorted by level')
        prev_level = w['level']
        by_level[w['level']] = by_level.get(w['level'], 0) + 1
        by_stage[w['stage']] = by_stage.get(w['stage'], 0) + 1
        by_station[w['station']] = by_station.get(w['station'], 0) + 1
        by_cat[w['category']] = by_cat.get(w['category'], 0) + 1

    print(f'entries: {len(words)}')
    print('per stage:', ', '.join(f'{st}={by_stage[st]}' for st in sorted(by_stage)))
    print('per station:', ', '.join(f'{st}={by_station[st]}' for st in sorted(by_station)))
    print('per legacy level:', ', '.join(f'{lv}={by_level[lv]}' for lv in sorted(by_level)))
    print('per category:', ', '.join(f'{c}={n}' for c, n in sorted(by_cat.items(), key=lambda x: -x[1])))
    print('confidence "check":', sum(1 for w in words if w.get('confidence') == 'check'))
    if exceptions:
        print(f'\nreported structural exceptions ({len(exceptions)}):')
        for e in exceptions:
            print('  -', e)
    else:
        print('structural exceptions: none')
    if errors:
        print(f'\nFAIL ({len(errors)} errors):')
        for e in errors:
            print('  -', e)
        return 1
    if strict and exceptions:
        print('\nFAIL (--strict and there are reported exceptions)')
        return 1
    print('\nPASS')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
