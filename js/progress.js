// המקום של הילד ברשימה: 6 שלבים (צליל תנועה אחד בכל שלב), ובתוך כל שלב תחנות לפי קושי.
// פונקציות טהורות, בלי DOM ובלי מסד נתונים: app.js (תור המילים, מעבר תחנה) ו-parent.js (אזור ההורה)
// משתמשים באותו קוד, כדי שההורה יראה בדיוק את מה שהאפליקציה עושה.

import { LEVELS, STATIONS, stationOfStage, stageOfStation, stageOfText } from './words.js';

// עוברים לתחנה הבאה כש-80% ממילות התחנה נקראו נכון לפחות פעם אחת (4 מתוך 5, בלי שברים)
const ADVANCE_NUM = 4;
const ADVANCE_DEN = 5;

// כל מילה רביעית: קודם מילה שנכשלה (חזרה), ורק אחריה מילה חדשה מהתחנה.
// בלי זה מילים שנכשלו בתחנות קודמות לא חוזרות לעולם: בתחנה הנוכחית תמיד נשארות 20% מילים חדשות
export const REVIEW_EVERY = 4;

// ההגדרה הישנה: level 1..5 (קמץ ופתח · חיריק · חולם ושורוק · צירה וסגול · שווא) → שלב חדש
const OLD_LEVEL_TO_STAGE = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 6 };

// מילים שההורה הוסיף לפני המעבר ל-6 שלבים שמורות עם level ישן (1..5).
// המזהה של מילה כזו מתחיל בזמן היצירה: 'c' + Date.now() בבסיס 36 (db.js, addCustomWord)
const STAGES_SINCE = Date.UTC(2026, 8, 30, 9, 0);

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n)) || lo));
export const lastStation = () => Math.max(1, STATIONS.length);
export const clampStation = (n) => clampInt(n, 1, lastStation());
export const clampStage = (n) => clampInt(n, 1, LEVELS.length);
export const levelInfo = (stage) => LEVELS[clampStage(stage) - 1];
export const stationInfo = (index) => STATIONS[clampStation(index) - 1];

// התחנה של הילד לפי ההגדרות. הגדרות ישנות (רק level) מתורגמות לתחנה הראשונה של השלב המקביל
export function stationFromSettings(s) {
  const raw = s?.station;
  if (raw != null && raw !== '' && Number.isFinite(Number(raw))) return clampStation(raw);
  const old = clampInt(s?.level, 1, 5);
  return clampStation(stationOfStage(OLD_LEVEL_TO_STAGE[old]));
}

// ההגדרות עם station תקין ו-level = השלב של התחנה (כדי שקוד ישן ושורת הענן יישארו קריאים)
export function withStation(s) {
  const station = stationFromSettings(s);
  return { ...(s || {}), station, level: stageOfStation(station) };
}

// ההגדרות השמורות עוד בפורמט הישן (אין station)
export const needsMigration = (s) => !s || s.station == null || s.station === '';

function createdAt(id) {
  const m = /^c([0-9a-z]{8})[0-9a-z]*$/.exec(String(id ?? ''));
  if (!m) return 0;
  const t = parseInt(m[1], 36);
  return t > Date.UTC(2020, 0, 1) && t < Date.UTC(2100, 0, 1) ? t : 0;
}

// השלב של מילה שההורה הוסיף
export function customStage(w) {
  const lv = Math.round(Number(w?.level));
  const t = createdAt(w?.id);
  if (t && t < STAGES_SINCE) {
    const old = clampInt(lv, 1, 5);
    if (old === 3) { // חולם ושורוק היו שלב אחד: לפי הניקוד (3 = חולם, 4 = שורוק)
      const s = stageOfText(String(w?.text || ''));
      return s === 3 || s === 4 ? s : 3;
    }
    return OLD_LEVEL_TO_STAGE[old];
  }
  if (lv >= 1 && lv <= LEVELS.length) return lv;
  return clampStage(stageOfText(String(w?.text || '')));
}

// מילה של ההורה → level = השלב, station = התחנה הראשונה של השלב
export function placeCustom(w) {
  const stage = customStage(w);
  return { ...w, level: stage, station: stationOfStage(stage) };
}

const correct = (stats, w) => (Number(stats?.[w.id]?.correct) || 0) > 0;

export const wordsOfStation = (words, station) => words.filter((w) => w.station === station);

// { count, mastered, needed, done }: done — אפשר לעבור לתחנה הבאה
export function stationProgress(words, stats, station) {
  const ws = wordsOfStation(words, station);
  const count = ws.length;
  const mastered = ws.filter((w) => correct(stats, w)).length;
  const needed = Math.ceil((count * ADVANCE_NUM) / ADVANCE_DEN);
  return { count, mastered, needed, done: count > 0 && mastered >= needed };
}

// התחנה הבאה אם צריך לעבור עכשיו, אחרת null
export function nextStation(words, stats, station) {
  const cur = clampStation(station);
  if (cur >= lastStation()) return null;
  return stationProgress(words, stats, cur).done ? cur + 1 : null;
}

function shuffle(arr, random) {
  return arr.map((v) => [random(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
}

// המילה הבאה.
// המאגר: מילים בתחנות עד התחנה הנוכחית. סלים לפי הסדר:
//  1) מילים של התחנה הנוכחית שעוד לא נקראו נכון
//  2) מילים שבפעם האחרונה דילג עליהן
//  3) כל השאר — מהפחות נראות (אקראית מבין 3 הכי פחות נראו)
// בכל תור REVIEW_EVERY סל 2 בא לפני סל 1. אף פעם לא אחת מ-3 המילים האחרונות שהוצגו (recent), אם יש ברירה.
// turn: מספר המילה בהפעלה (1, 2, 3...)
export function pickNext({ words, stats = {}, station, recent = [], turn = 0, random = Math.random }) {
  const all = (words || []).filter((w) => w && w.id && w.text);
  const cur = clampStation(station);
  let pool = all.filter((w) => (Number(w.station) || 1) <= cur);
  if (!pool.length) pool = all;
  if (!pool.length) return null;
  const st = (w) => stats[w.id] || {};
  const pickOne = (arr) => arr[Math.floor(random() * arr.length)];

  const fresh = pool.filter((w) => w.station === cur && !correct(stats, w));
  const isFresh = new Set(fresh.map((w) => w.id));
  const skipped = pool.filter((w) => !isFresh.has(w.id) && st(w).lastOutcome === 'skipped');
  const rest = pool.filter((w) => !isFresh.has(w.id) && st(w).lastOutcome !== 'skipped');
  const same = (x) => x;
  const leastSeen = (list) => shuffle(list, random).sort((a, b) => (st(a).seen || 0) - (st(b).seen || 0)).slice(0, 3);

  const review = turn > 0 && turn % REVIEW_EVERY === 0;
  const order = review
    ? [[skipped, same], [fresh, same], [rest, leastSeen]]
    : [[fresh, same], [skipped, same], [rest, leastSeen]];
  for (const [bucket, narrow] of order) {
    const options = bucket.filter((w) => !recent.includes(w.id));
    if (options.length) return pickOne(narrow(options));
  }
  // מאגר קטן מאוד: רק לא אותה מילה פעמיים ברצף
  const last = recent[recent.length - 1];
  const options = pool.filter((w) => w.id !== last);
  return pickOne(options.length ? options : pool);
}

// טקסט להשוואה בחיפוש: בלי ניקוד, בלי רווחים, אותיות סופיות כרגילות
const FINAL = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export function searchKey(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINAL[c])
    .replace(/[\s\-'"׳״־]/g, '');
}
