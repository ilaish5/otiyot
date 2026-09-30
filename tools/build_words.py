#!/usr/bin/env python3
"""Generate js/words.js from data/first-words.json (python3, stdlib only).

Run:  python3 tools/build_words.py           write js/words.js, write the stage/station
                                             fields into data/first-words.json, print a report
      python3 tools/build_words.py --check   write nothing; exit 1 if either file is out of date

Stages (one vowel sound each, in teaching order) come from stage_of() in
data/validate_words.py, the single implementation of the rule:
  1 a  qamats / patah        4 u  shuruk / qubuts
  2 i  hiriq                 5 e  tsere / segol
  3 o  holam, qamats qatan   6 shva / hataf
Stations: inside each stage the words are sorted by letter count, then by the
list's frequency order (the order of data/first-words.json), and cut into
n = max(1, round(count / 30)) nearly equal consecutive chunks (the first
count % n chunks get one extra word). Stations are numbered 1..N across the
stages, stage 1 first.

IDs: the 42 words the app shipped with keep their ids (progress in IndexedDB and
Supabase is keyed by id); they are matched by their letters without nikud.
A legacy word missing from the list is added so no id disappears. Every other
id comes from data/first-words.json.

After writing, the script runs node to check the generated module: stageOfText()
must agree with stage_of() on every word and on the edge cases below, and every
letter and mark of every word must be drawable by js/letters.js.
"""
import json
import os
import shutil
import subprocess
import sys
import unicodedata

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'first-words.json')
OUT = os.path.join(ROOT, 'js', 'words.js')
sys.path.insert(0, os.path.join(ROOT, 'data'))
import validate_words as V  # noqa: E402  (stage rule: single source of truth)

STATION_TARGET = 30                  # words per station (round(count / 30) chunks)
ADVANCE_SHARE = 0.8                  # documented in the header; the app applies it

# Kid-facing: keep the nikud. Checked character by character in verify_names().
STAGE_META = [
    (1, 'קָמָץ וּפַתַח', 'אָ'),
    (2, 'חִירִיק', 'אִ'),
    (3, 'חוֹלָם', 'אוֹ'),
    (4, 'שׁוּרוּק וְקֻבּוּץ', 'אוּ'),
    (5, 'צֵירֵה וְסֶגּוֹל', 'אֵ'),
    (6, 'שְׁוָא', 'אְ'),
]
# The vowel each stage's sound must show (shuruk = vav + dagesh).
STAGE_SOUND_MARK = {1: V.QAMATS, 2: V.HIRIQ, 3: V.HOLAM, 4: V.DAGESH, 5: V.TSERE, 6: V.SHVA}

# The 42 words js/words.js shipped with before the stage/station rewrite: (id, text, pic).
LEGACY_WORDS = [
    ('aba', 'אַבָּא', '👨'), ('saba', 'סַבָּא', '👴'), ('dag', 'דָּג', '🐟'),
    ('gan', 'גַּן', '🛝'), ('yam', 'יָם', '🌊'), ('sal', 'סַל', '🧺'),
    ('kaf', 'כַּף', '🥄'), ('halav', 'חָלָב', '🥛'), ('gamal', 'גָּמָל', '🐫'),
    ('kan', 'קַן', '🪺'), ('banana', 'בָּנָנָה', '🍌'),
    ('ima', 'אִמָּא', '👩'), ('pil', 'פִּיל', '🐘'), ('sir', 'סִיר', '🍲'),
    ('shir', 'שִׁיר', '🎵'), ('tik', 'תִּיק', '🎒'), ('kir', 'קִיר', '🧱'),
    ('mayim', 'מַיִם', '💧'), ('bayit', 'בַּיִת', '🏠'), ('gitara', 'גִּיטָרָה', '🎸'),
    ('dov', 'דּוֹב', '🐻'), ('sus', 'סוּס', '🐴'), ('tut', 'תּוּת', '🍓'),
    ('shum', 'שׁוּם', '🧄'), ('or', 'אוֹר', '💡'), ('hol', 'חוֹל', '🏖️'),
    ('kova', 'כּוֹבַע', '🧢'), ('kadur', 'כַּדּוּר', '⚽'), ('tapuah', 'תַּפּוּחַ', '🍎'),
    ('etz', 'עֵץ', '🌳'), ('kelev', 'כֶּלֶב', '🐕'), ('yeled', 'יֶלֶד', '🧒'),
    ('lehem', 'לֶחֶם', '🍞'), ('shemesh', 'שֶׁמֶשׁ', '☀️'), ('geshem', 'גֶּשֶׁם', '🌧️'),
    ('beitza', 'בֵּיצָה', '🥚'),
    ('savta', 'סַבְתָּא', '👵'), ('mechonit', 'מְכוֹנִית', '🚗'), ('tractor', 'טְרַקְטוֹר', '🚜'),
    ('arye', 'אַרְיֵה', '🦁'), ('rakevet', 'רַכֶּבֶת', '🚂'), ('glida', 'גְּלִידָה', '🍦'),
]
LEGACY_LEVEL = {  # the old 5-level rule, for the report only
    **{i: 1 for i in ('aba', 'saba', 'dag', 'gan', 'yam', 'sal', 'kaf', 'halav', 'gamal', 'kan', 'banana')},
    **{i: 2 for i in ('ima', 'pil', 'sir', 'shir', 'tik', 'kir', 'mayim', 'bayit', 'gitara')},
    **{i: 3 for i in ('dov', 'sus', 'tut', 'shum', 'or', 'hol', 'kova', 'kadur', 'tapuah')},
    **{i: 4 for i in ('etz', 'kelev', 'yeled', 'lehem', 'shemesh', 'geshem', 'beitza')},
    **{i: 5 for i in ('savta', 'mechonit', 'tractor', 'arye', 'rakevet', 'glida')},
}
OLD_LEVEL_TO_STAGE = {1: 1, 2: 2, 3: 3, 4: 5, 5: 6}   # the settings.level migration

# Edge cases for the JavaScript copy of the stage rule (expected value = stage_of()).
EDGE_CASES = [
    '', 'abc', 'אבא', 'מֶלֶךְ', 'הָלַךְ', 'אַתְּ', 'שַׁבָּת', 'סוּס', 'וּ', 'חַוָּה', 'צַוָּאר',
    'קֻפְסָה', 'צׇהֳרַיִם', 'וֺ', 'אֱלֹהִים', 'אֲנִי', 'חֳדָשִׁים', 'סַבְתָּא', 'עֵץ', 'כֶּלֶב',
    'דָּג גָּדוֹל', 'אִמָּא שֶׁלִּי', 'יוֹם־הֻלֶּדֶת', 'דָּֽג', 'שָׁלוֹם!', 'בָּנָנָה', 'פִּיל', 'דּוֹב',
    'שְׁוָא', '\u05B0\u05D0', 'אֱ', 'אֳ', 'אֲ',
    '\uFB2C\u05B8', 'ס\uFB35ס', 'ק\uFB4B', '\uFB1D\u05B8ם',   # presentation forms (NFD decomposes them)
]


class BuildError(Exception):
    pass


def fail(msg):
    raise BuildError(msg)


def letter_count(text):
    return len(V.word_clusters(text))


# ---------------------------------------------------------------- build
def build(entries):
    """Return (words, stations, levels, report) from the list in first-words.json.

    words: dicts id, text, pic, level (= stage), station, letters, category,
    src (index in the json, or None for an added legacy word), order.
    """
    report = {'legacy_renamed': [], 'legacy_text_changed': [], 'legacy_added': []}
    legacy_by_plain = {}
    for lid, text, pic in LEGACY_WORDS:
        plain = V.strip_marks(text)
        if plain in legacy_by_plain:
            fail(f'two legacy words share the letters {plain}')
        legacy_by_plain[plain] = (lid, text, pic)

    words, seen_plain = [], set()
    for k, e in enumerate(entries):
        text = e['text']
        plain = V.strip_marks(text)
        wid = e['id']
        if plain in legacy_by_plain:
            lid, ltext, _ = legacy_by_plain[plain]
            if lid != wid:
                report['legacy_renamed'].append((wid, lid, text))
                wid = lid
            if ltext != text:
                report['legacy_text_changed'].append((lid, ltext, text))
        seen_plain.add(plain)
        words.append({'id': wid, 'text': text, 'pic': e.get('pic', ''), 'level': V.stage_of(text),
                      'letters': letter_count(text), 'category': e.get('category', 'other'),
                      'src': k, 'order': k})
    for j, (lid, text, pic) in enumerate(LEGACY_WORDS):
        if V.strip_marks(text) not in seen_plain:
            report['legacy_added'].append((lid, text))
            words.append({'id': lid, 'text': text, 'pic': pic, 'level': V.stage_of(text),
                          'letters': letter_count(text), 'category': 'other',
                          'src': None, 'order': len(entries) + j})

    ids = {}
    for w in words:
        if w['id'] in ids:
            fail(f'duplicate id {w["id"]!r}: {ids[w["id"]]} and {w["text"]}')
        ids[w['id']] = w['text']

    stations, levels = [], []
    for stage, name, sound in STAGE_META:
        pool = sorted((w for w in words if w['level'] == stage), key=lambda w: (w['letters'], w['order']))
        if not pool:
            fail(f'stage {stage} has no words')
        n = max(1, int(len(pool) / STATION_TARGET + 0.5))          # round half up, like Math.round
        base, extra = divmod(len(pool), n)
        start, idxs = 0, []
        for i in range(n):
            size = base + (1 if i < extra else 0)
            index = len(stations) + 1
            for w in pool[start:start + size]:
                w['station'] = index
            stations.append({'index': index, 'stage': stage, 'n': i + 1, 'count': size,
                             'letters': (pool[start]['letters'], pool[start + size - 1]['letters'])})
            idxs.append(index)
            start += size
        levels.append({'id': stage, 'name': name, 'sound': sound, 'stations': idxs})

    words.sort(key=lambda w: (w['level'], w['station'], w['order']))
    return words, stations, levels, report


# ---------------------------------------------------------------- checks
def verify_names():
    """Every kid-facing string: NFC, only Hebrew letters / nikud / spaces, and printed by name."""
    lines, problems = [], []
    for stage, name, sound in STAGE_META:
        for label, s in (('name', name), ('sound', sound)):
            if unicodedata.normalize('NFC', s) != s:
                problems.append(f'stage {stage} {label} {s!r} is not NFC')
            for ch in s:
                if ch not in V.LETTERS and ch not in V.ALLOWED_MARKS and ch != ' ':
                    problems.append(f'stage {stage} {label} {s!r}: unexpected U+{ord(ch):04X}')
            lines.append(f'  stage {stage} {label:5} {s}  ' + ' '.join(
                unicodedata.name(ch).replace('HEBREW ', '').replace('LETTER ', '').replace('POINT ', '')
                if ch != ' ' else '|' for ch in s))
        marks = {m for _, ms, _ in V.word_clusters(sound) for m in ms}
        if STAGE_SOUND_MARK[stage] not in marks:
            problems.append(f'stage {stage} sound {sound!r} does not show its vowel')
    # names are written with nikud, so every non-final letter carries a vowel or is a mater/shuruk
    for stage, name, _ in STAGE_META:
        for word in name.split(' '):
            a = V.analyze(word)
            for p in a['errors'] + a['issues']:
                problems.append(f'stage {stage} name word {word}: {p}')
    return lines, problems


def js_str(s):
    if "'" in s or '\\' in s or '\n' in s:
        fail(f'string needs escaping: {s!r}')
    return f"'{s}'"


# ---------------------------------------------------------------- output
HEADER = """\
// קובץ שנוצר אוטומטית. לא לערוך ביד: מקור הנתונים הוא data/first-words.json,
// ובונים מחדש עם python3 tools/build_words.py
//
// שישה שלבים, צליל תנועה אחד בכל שלב, לפי סדר הלימוד:
//   1 קמץ ופתח (אָ) · 2 חיריק (אִ) · 3 חולם וקמץ קטן (אוֹ) · 4 שורוק וקובוץ (אוּ)
//   5 צירה וסגול (אֵ) · 6 שווא וחטפים
// השלב של מילה הוא השלב הגבוה ביותר שהניקוד שלה צריך, והוא מחושב בקוד (stage_of
// ב-data/validate_words.py, ו-stageOfText כאן למילים שההורה מוסיף). דגש, נקודות שׁ/שׂ,
// אותיות שקטות (אמות קריאה, ה/א בסוף) ושווא באות האחרונה של מילה (ךְ) לא מעלים שלב.
//
// תחנות: בתוך כל שלב המילים ממוינות לפי מספר האותיות ואז לפי השכיחות (סדר הרשימה),
// ומחולקות ל-round(מספר המילים / 30) תחנות רצופות בגודל כמעט שווה. התחנות ממוספרות
// ברצף מ-1 (תחנות שלב 1 ראשונות). עוברים לתחנה הבאה כש-80% ממילות התחנה נקראו
// נכון לפחות פעם אחת; מילים שנכשלו חוזרות בחזרה.
//
// BASE_WORDS[].level הוא השלב (1-6), station הוא מספר התחנה הגלובלי.
"""

JS_FUNCS = r"""
// השלב שמתחיל בתחנה: התחנה הראשונה של השלב.
export function stationOfStage(stage) {
  const s = Math.min(LEVELS.length, Math.max(1, Math.round(Number(stage)) || 1));
  return LEVELS[s - 1].stations[0];
}

// השלב שהתחנה שייכת אליו.
export function stageOfStation(index) {
  const i = Math.min(STATIONS.length, Math.max(1, Math.round(Number(index)) || 1));
  return STATIONS[i - 1].stage;
}

// ניקוד -> שלב. אותו כלל כמו stage_of() ב-data/validate_words.py (הבנייה בודקת שהם מסכימים).
const STAGE_OF_MARK = {
  '\u05B8': 1, '\u05B7': 1,                          // קמץ, פתח
  '\u05B4': 2,                                       // חיריק
  '\u05B9': 3, '\u05BA': 3, '\u05C7': 3,             // חולם, חולם חסר לו, קמץ קטן
  '\u05BB': 4,                                       // קובוץ (שורוק: ו עם דגש ובלי תנועה)
  '\u05B5': 5, '\u05B6': 5,                          // צירה, סגול
  '\u05B0': 6, '\u05B1': 6, '\u05B2': 6, '\u05B3': 6, // שווא, חטפים
};
const SHVA = '\u05B0', DAGESH = '\u05BC', VAV = '\u05D5', SHURUK_STAGE = 4;
const isLetter = (c) => c >= '\u05D0' && c <= '\u05EA';
const isMark = (c) => /^[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]$/.test(c);

// השלב (1-6) שמילה מנוקדת צריכה. טקסט בלי ניקוד הוא שלב 1.
export function stageOfText(text) {
  const clusters = [];                               // [אות, ניקוד[], אות אחרונה במילה]
  let open = false;
  for (const c of String(text ?? '').normalize('NFD')) {
    if (isLetter(c)) { clusters.push([c, [], false]); open = true; }
    else if (isMark(c)) { if (open) clusters[clusters.length - 1][1].push(c); }
    else { if (open) clusters[clusters.length - 1][2] = true; open = false; }
  }
  if (clusters.length) clusters[clusters.length - 1][2] = true;
  let stage = 1;
  for (const [letter, marks, last] of clusters) {
    const vowels = marks.filter((m) => m in STAGE_OF_MARK);
    if (letter === VAV && marks.includes(DAGESH) && !vowels.length) {
      stage = Math.max(stage, SHURUK_STAGE);         // וּ שורוק
      continue;
    }
    for (const v of vowels) {
      if (v === SHVA && last) continue;              // שווא באות האחרונה (ךְ) לא נשמע
      stage = Math.max(stage, STAGE_OF_MARK[v]);
    }
  }
  return stage;
}
"""


def render_js(words, stations, levels):
    out = [HEADER]
    out.append('export const LEVELS = [')
    for lv in levels:
        out.append(f"  {{ id: {lv['id']}, name: {js_str(lv['name'])}, sound: {js_str(lv['sound'])}, "
                   f"stations: [{', '.join(str(i) for i in lv['stations'])}] }},")
    out.append('];')
    out.append('')
    out.append('export const STATIONS = [')
    for st in stations:
        out.append(f"  {{ index: {st['index']}, stage: {st['stage']}, n: {st['n']}, count: {st['count']} }},")
    out.append('];')
    out.append('')
    out.append('export const BASE_WORDS = [')
    cur = None
    for w in words:
        if w['station'] != cur:
            cur = w['station']
            st = stations[cur - 1]
            lo, hi = st['letters']
            span = f'{lo}' if lo == hi else f'{lo}-{hi}'
            if cur != 1:
                out.append('')
            of = len(levels[st['stage'] - 1]['stations'])
            out.append(f"  // תחנה {cur} · שלב {st['stage']}, תחנה {st['n']} מתוך {of} · {st['count']} מילים · {span} אותיות")
        out.append(f"  {{ id: {js_str(w['id'])}, text: {js_str(w['text'])}, pic: {js_str(w['pic'])}, "
                   f"level: {w['level']}, station: {w['station']}, letters: {w['letters']}, "
                   f"category: {js_str(w['category'])} }},")
    out.append('];')
    return '\n'.join(out) + '\n' + JS_FUNCS


def render_json(entries, words):
    by_src = {w['src']: w for w in words if w['src'] is not None}
    out = []
    for k, e in enumerate(entries):
        w = by_src[k]
        row = {}
        for key, val in e.items():
            if key in ('stage', 'station'):
                continue
            row[key] = val
            if key == 'level':
                row['stage'] = w['level']
                row['station'] = w['station']
        if 'stage' not in row:
            fail(f'json entry #{k} has no level field to place stage/station after')
        out.append(row)
    return json.dumps(out, ensure_ascii=False, indent=1)     # same format as the source file


# ---------------------------------------------------------------- node checks
NODE_CHECK = r"""
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const root = process.env.WORDS_ROOT;
const url = (p) => pathToFileURL(root + '/' + p).href;
const W = await import(url('js/words.js'));
const Lm = await import(url('js/letters.js'));
const { LETTERS, MARKS, markPlacement, layoutWord } = Lm;
const input = JSON.parse(readFileSync(0, 'utf8'));
const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const out = { stageMismatch: [], edgeMismatch: [], trace: [], api: [], counts: {} };

for (const w of W.BASE_WORDS) {
  const s = W.stageOfText(w.text);
  if (s !== w.level) out.stageMismatch.push([w.id, w.text, w.level, s]);
  // letters.js: every letter drawable, every mark in MARKS and placed by markPlacement
  const problems = [];
  const clusters = w.text.match(/[\u05D0-\u05EA][\u0591-\u05C7]*/g) || [];
  if (clusters.join('') !== w.text) problems.push('characters outside letter clusters');
  for (const c of clusters) {
    const base = c[0], marks = [...c.slice(1)];
    if (!LETTERS[base]) problems.push(`letter ${base} ${hex(base)} not in LETTERS`);
    const unknown = marks.filter((m) => !MARKS[m]);
    for (const m of unknown) problems.push(`${base}: mark ${hex(m)} not in MARKS (markPlacement skips it)`);
    const placed = markPlacement(base, c.slice(1));
    const known = marks.filter((m) => MARKS[m]);
    if (placed.length !== known.length) problems.push(`${base}: ${known.length} marks but ${placed.length} placed`);
  }
  const lay = layoutWord(w.text);
  if (lay.letters.length !== w.letters) problems.push(`layoutWord drew ${lay.letters.length} letters, word has ${w.letters}`);
  if (!(lay.width > 0)) problems.push('layoutWord width is not positive');
  if (problems.length) out.trace.push([w.id, w.text, problems]);
}
for (const [text, expected] of input.edge) {
  const got = W.stageOfText(text);
  if (got !== expected) out.edgeMismatch.push([text, expected, got]);
}
// API contract
const firstOf = {};
for (const st of W.STATIONS) if (!(st.stage in firstOf)) firstOf[st.stage] = st.index;
for (const lv of W.LEVELS) {
  if (W.stationOfStage(lv.id) !== firstOf[lv.id]) out.api.push(`stationOfStage(${lv.id})`);
  for (const i of lv.stations) if (W.stageOfStation(i) !== lv.id) out.api.push(`stageOfStation(${i})`);
}
W.STATIONS.forEach((st, k) => { if (st.index !== k + 1) out.api.push(`STATIONS[${k}].index`); });
for (const st of W.STATIONS) {
  const n = W.BASE_WORDS.filter((w) => w.station === st.index && w.level === st.stage).length;
  if (n !== st.count) out.api.push(`station ${st.index} count ${st.count} but ${n} words`);
}
if (W.stationOfStage(0) !== 1 || W.stationOfStage('x') !== 1) out.api.push('stationOfStage clamp low');
if (W.stationOfStage(99) !== W.LEVELS.at(-1).stations[0]) out.api.push('stationOfStage clamp high');
if (W.stageOfStation(999) !== W.LEVELS.length || W.stageOfStation(-3) !== 1) out.api.push('stageOfStation clamp');
if (new Set(W.BASE_WORDS.map((w) => w.id)).size !== W.BASE_WORDS.length) out.api.push('duplicate ids');
for (const id of input.legacyIds) if (!W.BASE_WORDS.some((w) => w.id === id)) out.api.push(`legacy id ${id} missing`);
out.counts = { words: W.BASE_WORDS.length, stations: W.STATIONS.length, levels: W.LEVELS.length };
// kid-facing names drawn by letters.js too (not traced today, but checked)
for (const lv of W.LEVELS) for (const s of [lv.name, lv.sound]) for (const c of s.replace(/ /g, '')) {
  if (!LETTERS[c] && !MARKS[c]) out.trace.push([`LEVELS[${lv.id}]`, s, [`${hex(c)} not in LETTERS/MARKS`]]);
}
process.stdout.write(JSON.stringify(out));
"""


def node_checks(js_text):
    node = shutil.which('node')
    if not node:
        return None, 'node not found: JavaScript checks skipped'
    edge = [[t, V.stage_of(t)] for t in EDGE_CASES]
    payload = json.dumps({'edge': edge, 'legacyIds': [lid for lid, _, _ in LEGACY_WORDS]}, ensure_ascii=False)
    env = dict(os.environ, WORDS_ROOT=ROOT)
    r = subprocess.run([node, '--input-type=module', '-e', NODE_CHECK], input=payload.encode('utf-8'),
                       capture_output=True, env=env, cwd=ROOT)
    if r.returncode != 0:
        return None, 'node check crashed:\n' + r.stderr.decode('utf-8', 'replace')
    return json.loads(r.stdout.decode('utf-8')), None


# ---------------------------------------------------------------- main
def main(argv):
    check = '--check' in argv
    with open(DATA, encoding='utf-8') as f:
        raw = f.read()
    entries = json.loads(raw)
    words, stations, levels, report = build(entries)
    js_text = render_js(words, stations, levels)
    json_text = render_json(entries, words)

    name_lines, name_problems = verify_names()
    if name_problems:
        for p in name_problems:
            print('  -', p)
        fail('kid-facing stage names failed the unicodedata check')

    if check:
        with open(OUT, encoding='utf-8') as f:
            js_ok = f.read() == js_text
        json_ok = raw == json_text
        print('js/words.js', 'up to date' if js_ok else 'OUT OF DATE')
        print('data/first-words.json', 'up to date' if json_ok else 'OUT OF DATE (stage/station)')
        return 0 if js_ok and json_ok else 1

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(js_text)
    if raw != json_text:
        with open(DATA, 'w', encoding='utf-8') as f:
            f.write(json_text)

    # ------------------------------------------------ report
    print(f'wrote js/words.js: {len(words)} words, {len(stations)} stations, {len(levels)} stages')
    print('\nstage names (unicodedata):')
    print('\n'.join(name_lines))

    print('\nlegacy ids (42 app words, matched by letters without nikud):')
    print(f'  kept: {len(LEGACY_WORDS) - len(report["legacy_added"])}, '
          f'missing from the 500 and added: {len(report["legacy_added"])}')
    for lid, text in report['legacy_added']:
        print(f'  added {lid} {text}')
    for old, new, text in report['legacy_renamed']:
        print(f'  id {old} -> {new} ({text})')
    for lid, old, new in report['legacy_text_changed']:
        print(f'  {lid}: nikud {old} -> {new} (the list\'s form is used)')
    by_id = {w['id']: w for w in words}
    moved = [(lid, by_id[lid]['text'], LEGACY_LEVEL[lid], by_id[lid]['level']) for lid, _, _ in LEGACY_WORDS
             if OLD_LEVEL_TO_STAGE[LEGACY_LEVEL[lid]] != by_id[lid]['level']]
    print('  legacy words whose stage is not the migrated old level ({1:1,2:2,3:3,4:5,5:6}):')
    for lid, text, old, new in moved:
        print(f'    {lid} {text}: old level {old} -> stage {new}')

    print('\nper stage:')
    for lv in levels:
        n = sum(1 for w in words if w['level'] == lv['id'])
        print(f"  stage {lv['id']} {V.STAGE_NAMES[lv['id']]:18} {n:3} words, stations {lv['stations']}")
    print('\nper station:')
    for st in stations:
        lo, hi = st['letters']
        print(f"  station {st['index']:2}  stage {st['stage']}.{st['n']}  {st['count']:2} words  "
              f"{lo}-{hi} letters  advance at {-(-st['count'] * 8 // 10)} words (80%)")
    src_level = {w['id']: entries[w['src']]['level'] for w in words if w['src'] is not None}
    trans = {}
    for w in words:
        if w['id'] in src_level:
            key = (src_level[w['id']], w['level'])
            trans[key] = trans.get(key, 0) + 1
    print('\nold level -> new stage:', ', '.join(f'{a}->{b}: {n}' for (a, b), n in sorted(trans.items())))
    silent = [w['text'] for w in words if V.SHVA in w['text'] and w['level'] < 6]
    print('silent final shva (does not raise the stage):', ' '.join(silent) or 'none')

    for st in stations[:3]:
        ws = [w for w in words if w['station'] == st['index']]
        print(f"\nstation {st['index']} (stage {st['stage']}, {len(ws)} words):")
        print('  ' + ' '.join(w['text'] for w in ws))

    res, msg = node_checks(js_text)
    print('\nnode checks:')
    if res is None:
        print(' ', msg)
        return 1
    print(f"  module: {res['counts']}")
    print(f"  stageOfText vs stage_of on {len(words)} words: "
          f"{'agree' if not res['stageMismatch'] else res['stageMismatch']}")
    print(f"  stageOfText vs stage_of on {len(EDGE_CASES)} edge cases: "
          f"{'agree' if not res['edgeMismatch'] else res['edgeMismatch']}")
    print(f"  API (stationOfStage, stageOfStation, counts, ids): {'ok' if not res['api'] else res['api']}")
    print(f"  letters.js coverage: {'every letter and mark is drawable' if not res['trace'] else ''}")
    for wid, text, problems in res['trace']:
        print(f'    {wid} {text}: ' + '; '.join(problems))
    bad = res['stageMismatch'] or res['edgeMismatch'] or res['api'] or res['trace']
    return 1 if bad else 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except BuildError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(2)
