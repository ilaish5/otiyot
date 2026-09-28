// אותיות דפוס לגן: כל אות היא קו מרכז אחד דק (בלי נפח, בלי מתאר) שהילד עובר עליו בעט.
// ניקוד: קווים הם קו אחד, נקודות הן נקודות.
//
// יחידות: 1 = גובה גוף האות. y=0 שורת הכתיבה העליונה, y=1 שורת הבסיס.
// ל עולה עד y=-0.5, אותיות יורדות (ק ן ך ף ץ) יורדות עד y=1.55.
// x=0 הקצה השמאלי של האות, x=w הקצה הימני (המילה נפרסת מימין לשמאל).
//
// מסלולים: תחביר SVG מוגבל ל-M L Q C מוחלטים. סדר הנקודות = כיוון הכתיבה,
// סדר המערך strokes = סדר הקווים.
//
// כיוון הכתיבה לפי מקורות גן/כיתה א (וואלה! סקול "כתיבת האות", EZToddler):
// - קווים יורדים מלמעלה למטה.
// - קו עליון שוכב נכתב משמאל לימין ואז ממשיך למטה בצד ימין (ב ד ה ו ג ז ר ל מ ס).
// - קו תחתון שממשיך קו יורד הולך מימין לשמאל (כ נ ע צ ט ש ם מ); הבסיס של ב נכתב לבד משמאל לימין.
// - ח: גג משמאל לימין שיורד בצד ימין, ואז הרגל השמאלית מלמעלה למטה (וואלה! סקול: קו עליון משמאל
//   לימין ושני קווים יורדים משני קצותיו). כמו ה, רק בלי הרווח.
// - ט ו-ש הן החריגות שעולות למעלה: יורדים בצד ימין, מסתובבים למטה מימין לשמאל ועולים בצד שמאל;
//   בט הקרס הקטן בראש הצד הימני נכתב אחרון (וואלה! סקול), בש הזרוע האמצעית אחרונה.
// - א: קודם האלכסון הארוך, אחר כך שני הקווים הקטנים מלמעלה למטה.

export const LETTER_GAP = 0.22;             // רווח בין אותיות (מקצה לקצה)
export const BAND = { top: -0.65, bottom: 1.65 }; // הטווח האנכי שהמעבר צריך להכיל
export const DOT_R = 0.065;                 // רדיוס מומלץ לנקודת ניקוד (רמז לציור)

const B = 1.28;   // גובה ברירת מחדל לתנועות מתחת לאות
const A = -0.22;  // גובה נקודות מעל האות (חולם, שׁ, שׂ)

// w: רוחב. strokes: הקווים. anchors: below (מרכז תנועה תחתונה), dagesh (נקודה בתוך האות),
// above (נקודה שמאלית-עליונה לחולם). ל-ש יש גם shin (ימין-למעלה) ו-sin (שמאל-למעלה).
export const LETTERS = {
  'א': {
    w: 0.78,
    strokes: [
      'M 0.08 0 L 0.78 1',                              // האלכסון הארוך
      'M 0.74 0 C 0.73 0.24 0.66 0.38 0.402 0.46',       // זרוע ימנית עליונה, יורדת אל האלכסון
      'M 0.311 0.33 C 0.15 0.42 0.1 0.6 0.06 1',          // רגל שמאלית, מהאלכסון למטה
    ],
    anchors: { below: [0.4, B], dagesh: [0.28, 0.76], above: [0.02, A] },
  },
  'ב': {
    w: 0.84,
    strokes: [
      'M 0.02 0 L 0.46 0 Q 0.66 0 0.66 0.2 L 0.66 1',   // גג משמאל לימין ויורד
      'M 0 1 L 0.84 1',                                 // בסיס משמאל לימין, בולט ימינה
    ],
    anchors: { below: [0.4, B], dagesh: [0.35, 0.52], above: [-0.04, A] },
  },
  'ג': {
    w: 0.56,
    strokes: [
      'M 0.04 0 L 0.32 0 Q 0.42 0 0.42 0.1 L 0.42 0.6 L 0.54 1', // גג קטן, יורד, רגל ימנית
      'M 0.42 0.56 C 0.26 0.58 0.12 0.74 0.02 1',                 // רגל שמאלית מהאמצע
    ],
    anchors: { below: [0.3, B], dagesh: [0.21, 0.32], above: [0, A] },
  },
  'ד': {
    w: 0.74,
    strokes: [
      'M 0 0 L 0.74 0',                                 // גג משמאל לימין, בולט מעבר לרגל
      'M 0.56 0 L 0.56 1',
    ],
    anchors: { below: [0.4, B], dagesh: [0.28, 0.45], above: [-0.04, A] },
  },
  'ה': {
    w: 0.7,
    strokes: [
      'M 0 0 L 0.5 0 Q 0.7 0 0.7 0.2 L 0.7 1',
      'M 0.04 0.42 L 0.04 1',                           // רגל שמאלית עם רווח מהגג
    ],
    anchors: { below: [0.36, B], dagesh: [0.38, 0.55], above: [-0.04, A] },
  },
  'ו': {
    w: 0.14,
    strokes: ['M 0 0 L 0.1 0 Q 0.14 0 0.14 0.04 L 0.14 1'],
    anchors: { below: [0.1, B], dagesh: [-0.04, 0.5], above: [0.02, A] },
  },
  'ז': {
    w: 0.5,
    strokes: [
      'M 0 0 L 0.5 0',
      'M 0.26 0 Q 0.2 0.1 0.2 0.3 L 0.2 1',
    ],
    anchors: { below: [0.24, B], dagesh: [0.02, 0.52], above: [-0.04, A] },
  },
  'ח': {
    w: 0.7,
    strokes: [
      'M 0.02 0 L 0.5 0 Q 0.7 0 0.7 0.2 L 0.7 1',       // גג משמאל לימין ויורד בצד ימין (כמו ה)
      'M 0.02 0 L 0.02 1',                              // רגל שמאלית מהגג למטה, בלי רווח
    ],
    anchors: { below: [0.36, B], dagesh: [0.36, 0.52], above: [-0.02, A] },
  },
  'ט': {
    w: 0.72,
    strokes: [
      // צד ימין למטה, בסיס עגול מימין לשמאל, עולים בצד שמאל עד השורה
      'M 0.72 0.14 L 0.72 0.62 C 0.72 0.88 0.57 1 0.37 1 C 0.17 1 0.02 0.88 0.02 0.62 L 0.02 0',
      // הקרס הקטן: מראש הצד הימני, מעל ופנימה למטה שמאלה
      'M 0.72 0.14 C 0.71 0.04 0.63 0 0.54 0 C 0.45 0 0.38 0.07 0.35 0.2',
    ],
    anchors: { below: [0.37, B], dagesh: [0.37, 0.58], above: [-0.02, A] },
  },
  'י': {
    w: 0.14,
    strokes: ['M 0 0 L 0.1 0 Q 0.14 0 0.14 0.04 L 0.14 0.48'],
    anchors: { below: [0.08, B], dagesh: [-0.1, 0.26], above: [0.02, A] },
  },
  'כ': {
    w: 0.62,
    strokes: ['M 0 0 L 0.3 0 C 0.5 0 0.62 0.2 0.62 0.5 C 0.62 0.8 0.5 1 0.3 1 L 0 1'],
    anchors: { below: [0.32, B], dagesh: [0.3, 0.5], above: [-0.04, A] },
  },
  'ך': {
    w: 0.62,
    strokes: ['M 0 0 L 0.42 0 Q 0.62 0 0.62 0.2 L 0.62 1.55'],
    // בסופית ך קמץ ושווא יושבים בתוך האות
    anchors: { below: [0.3, 0.5], dagesh: [0.3, 0.42], above: [-0.04, A] },
  },
  'ל': {
    w: 0.62,
    strokes: [
      'M 0.02 -0.5 L 0.02 0 L 0.52 0 Q 0.62 0 0.62 0.1 L 0.62 0.3 C 0.62 0.52 0.34 0.58 0.34 0.8 L 0.34 1',
    ],
    anchors: { below: [0.34, B], dagesh: [0.24, 0.38], above: [-0.14, -0.1] },
  },
  'מ': {
    w: 0.78,
    strokes: [
      // אף משמאל למעלה אל האמצע, קשת ימינה, צד ימין למטה ובסיס עד האמצע
      'M 0.02 0 L 0.15 0.36 C 0.22 0.1 0.36 0 0.52 0 C 0.7 0 0.78 0.12 0.78 0.36 L 0.78 1 L 0.4 1',
      'M 0.15 0.36 L 0.05 1',                           // רגל שמאלית
    ],
    anchors: { below: [0.42, B], dagesh: [0.5, 0.58], above: [-0.02, A] },
  },
  'ם': {
    w: 0.7,
    strokes: [
      'M 0.02 0 L 0.5 0 Q 0.7 0 0.7 0.2 L 0.7 0.92 Q 0.7 1 0.62 1 L 0.1 1 Q 0.02 1 0.02 0.92 L 0.02 0',
    ],
    anchors: { below: [0.36, B], dagesh: [0.36, 0.5], above: [-0.04, A] },
  },
  'נ': {
    w: 0.36,
    strokes: ['M 0.02 0 L 0.2 0 Q 0.36 0 0.36 0.16 L 0.36 1 L 0 1'],
    anchors: { below: [0.2, B], dagesh: [0.16, 0.5], above: [-0.02, A] },
  },
  'ן': {
    w: 0.14,
    strokes: ['M 0 0 L 0.1 0 Q 0.14 0 0.14 0.04 L 0.14 1.55'],
    anchors: { below: [-0.22, 1.1], dagesh: [-0.1, 0.5], above: [0.02, A] },
  },
  'ס': {
    w: 0.76,
    strokes: [
      'M 0 0 L 0.42 0 C 0.64 0 0.76 0.2 0.76 0.5 C 0.76 0.82 0.6 1 0.38 1 ' +
        'C 0.16 1 0.02 0.82 0.02 0.5 C 0.02 0.24 0.06 0.08 0.14 0',
    ],
    anchors: { below: [0.38, B], dagesh: [0.38, 0.5], above: [-0.04, A] },
  },
  'ע': {
    w: 0.7,
    strokes: [
      'M 0.7 0 L 0.7 0.45 C 0.7 0.85 0.45 0.98 0 1.04',  // זרוע ימנית למטה ושמאלה
      'M 0.12 0 L 0.4 0.94',                            // זרוע שמאלית אל הקו הראשון
    ],
    anchors: { below: [0.4, B], dagesh: [0.46, 0.44], above: [0.04, A] },
  },
  'פ': {
    w: 0.66,
    strokes: [
      'M 0.02 0 L 0.32 0 C 0.53 0 0.66 0.2 0.66 0.5 C 0.66 0.8 0.53 1 0.32 1 L 0 1',
      'M 0.02 0 L 0.02 0.32 Q 0.02 0.44 0.14 0.44 L 0.3 0.44', // הלשון
    ],
    anchors: { below: [0.34, B], dagesh: [0.4, 0.7], above: [-0.04, A] },
  },
  'ף': {
    w: 0.64,
    strokes: [
      'M 0.02 0 L 0.44 0 Q 0.64 0 0.64 0.2 L 0.64 1.55',
      'M 0.02 0 L 0.02 0.32 Q 0.02 0.44 0.14 0.44 L 0.3 0.44',
    ],
    anchors: { below: [0.28, B], dagesh: [0.38, 0.68], above: [-0.04, A] },
  },
  'צ': {
    w: 0.64,
    strokes: [
      'M 0.04 0 L 0.62 1 L 0 1',                        // אלכסון למטה ימינה ובסיס חזרה שמאלה
      'M 0.66 0 C 0.66 0.22 0.58 0.36 0.301 0.45',       // זרוע ימנית אל האלכסון
    ],
    anchors: { below: [0.32, B], dagesh: [0.22, 0.72], above: [0, A] },
  },
  'ץ': {
    w: 0.64,
    strokes: [
      'M 0.02 0 L 0.32 0.6 L 0.32 1.55',
      'M 0.64 0 C 0.64 0.3 0.52 0.5 0.32 0.6',
    ],
    anchors: { below: [0.7, B], dagesh: [0.46, 0.3], above: [-0.02, A] },
  },
  'ק': {
    w: 0.72,
    strokes: [
      'M 0 0 L 0.72 0 L 0.72 0.32 C 0.72 0.52 0.48 0.6 0.48 0.8 L 0.48 1',
      'M 0.05 0.42 L 0.05 1.55',                        // רגל שמאלית יורדת
    ],
    // התנועה בחלק הימני, רחוק מהרגל היורדת
    anchors: { below: [0.52, B], dagesh: [0.3, 0.55], above: [-0.02, A] },
  },
  'ר': {
    w: 0.64,
    strokes: ['M 0 0 L 0.38 0 Q 0.64 0 0.64 0.26 L 0.64 1'],
    anchors: { below: [0.36, B], dagesh: [0.3, 0.5], above: [-0.04, A] },
  },
  'ש': {
    w: 0.96,
    strokes: [
      // זרוע ימנית למטה, סיבוב בתחתית מימין לשמאל, עולים בזרוע השמאלית
      'M 0.96 0 L 0.92 0.55 C 0.9 0.86 0.72 1 0.48 1 C 0.24 1 0.06 0.86 0.04 0.55 L 0.02 0',
      // הזרוע האמצעית יורדת ומתעקלת אל הזרוע השמאלית
      'M 0.54 0 L 0.52 0.34 C 0.5 0.52 0.36 0.6 0.05 0.62',
    ],
    anchors: {
      below: [0.48, B], dagesh: [0.56, 0.78], above: [0.02, A],
      shin: [0.96, A], sin: [0.02, A],
    },
  },
  'ת': {
    w: 0.86,
    strokes: [
      'M 0 0 L 0.64 0 Q 0.86 0 0.86 0.22 L 0.86 1',
      'M 0.2 0 L 0.2 0.9 Q 0.2 1 0.1 1 L 0 1',          // רגל שמאלית עם כף רגל
    ],
    anchors: { below: [0.44, B], dagesh: [0.53, 0.5], above: [-0.04, A] },
  },
};

// ניקוד. קואורדינטות יחסיות לנקודת העוגן (at), באותן יחידות.
const BAR = 'M -0.2 0 L 0.2 0';
const T_BAR = 'M -0.2 -0.02 L 0.2 -0.02', T_STEM = 'M 0 -0.02 L 0 0.2';
// חטף: השווא מימין לתנועה (כך בכל הגופנים: Arial Hebrew, SF Hebrew, Times New Roman)
const H_BAR = 'M -0.3 0 L 0.06 0', H_TBAR = 'M -0.3 -0.02 L 0.06 -0.02', H_TSTEM = 'M -0.12 -0.02 L -0.12 0.2';
const H_SHVA = () => [[0.24, -0.04], [0.24, 0.16]];
export const MARKS = {
  '\u05B7': { name: 'patah', strokes: [BAR], dots: [], at: 'below' },
  '\u05B8': { name: 'qamats', strokes: [T_BAR, T_STEM], dots: [], at: 'below' },
  '\u05C7': { name: 'qamats qatan', strokes: [T_BAR, T_STEM], dots: [], at: 'below' },
  '\u05B5': { name: 'tsere', strokes: [], dots: [[0.14, 0], [-0.14, 0]], at: 'below' },
  '\u05B6': { name: 'segol', strokes: [], dots: [[0.14, -0.04], [-0.14, -0.04], [0, 0.16]], at: 'below' },
  '\u05B4': { name: 'hiriq', strokes: [], dots: [[0, 0.02]], at: 'below' },
  '\u05B9': { name: 'holam', strokes: [], dots: [[0, 0]], at: 'above' },
  '\u05BA': { name: 'holam haser for vav', strokes: [], dots: [[0, 0]], at: 'above' }, // וֺ עיצורית: כמו חולם
  '\u05BB': { name: 'qubuts', strokes: [], dots: [[-0.15, -0.06], [0, 0.06], [0.15, 0.18]], at: 'below' }, // אלכסון משמאל-למעלה לימין-למטה
  '\u05B0': { name: 'shva', strokes: [], dots: [[0, -0.04], [0, 0.16]], at: 'below' },
  '\u05B2': { name: 'hataf patah', strokes: [H_BAR], dots: H_SHVA(), at: 'below' },
  '\u05B1': { name: 'hataf segol', strokes: [], dots: [[0.01, -0.04], [-0.25, -0.04], [-0.12, 0.16], ...H_SHVA()], at: 'below' },
  '\u05B3': { name: 'hataf qamats', strokes: [H_TBAR, H_TSTEM], dots: H_SHVA(), at: 'below' },
  '\u05BC': { name: 'dagesh', strokes: [], dots: [[0, 0]], at: 'dagesh' },
  '\u05C1': { name: 'shin dot', strokes: [], dots: [[0, 0]], at: 'shin' },
  '\u05C2': { name: 'sin dot', strokes: [], dots: [[0, 0]], at: 'sin' },
};

const DAGESH = 'ּ', HOLAM = 'ֹ';

// היכן לשים כל סימן ניקוד של אות. base: האות, marks: מחרוזת/מערך של תווי הניקוד שאחריה.
// מחזיר [{ mark, x, y, kind }] — (x,y) הוא נקודת העוגן ביחידות האות; מוסיפים אליה את
// הקואורדינטות היחסיות של MARKS[mark]. kind: 'shuruk' | 'holam-male' | MARKS[mark].at.
// סימנים לא מוכרים (טעמים, מתג וכו') מדולגים.
export function markPlacement(base, marks) {
  const L = LETTERS[base];
  if (!L) return [];
  const list = [...(marks || '')].filter((m) => MARKS[m]);
  const vowels = list.filter((m) => m !== DAGESH && m !== 'ׁ' && m !== 'ׂ');
  const out = [];
  for (const mark of list) {
    const at = MARKS[mark].at;
    if (base === 'ו' && mark === DAGESH && vowels.length === 0) {
      out.push({ mark, x: -0.04, y: 0.5, kind: 'shuruk' });        // וּ: נקודה משמאל לו באמצע הגובה
    } else if (base === 'ו' && mark === HOLAM) {
      out.push({ mark, x: 0.04, y: A, kind: 'holam-male' });        // וֹ: נקודה מעל הו, מעט שמאלה
    } else {
      const a = L.anchors[at] || (at === 'shin' ? [L.w, A] : at === 'sin' ? [0, A] : null);
      if (a) out.push({ mark, x: a[0], y: a[1], kind: at });
    }
  }
  return out;
}

// ---- עזרים (לא חובה לשימוש) ----

// הזזת מסלול בכמות (dx, dy) — כל הזוגות במסלול הם נקודות מוחלטות.
export function translatePath(d, dx, dy) {
  const t = d.trim().split(/[\s,]+/);
  const out = [];
  let pair = 0;
  for (const tok of t) {
    if (/^[MLQC]$/.test(tok)) { out.push(tok); pair = 0; continue; }
    const v = parseFloat(tok) + (pair % 2 === 0 ? dx : dy);
    out.push(+v.toFixed(4));
    pair++;
  }
  return out.join(' ');
}

// דגימת מסלול לנקודות במרווח קבוע בערך (ביחידות אות). מחזיר [[x,y], ...] לפי כיוון הכתיבה.
export function pathPoints(d, spacing = 0.02) {
  const t = d.trim().split(/[\s,]+/);
  const pts = [];
  let i = 0, cur = null;
  const num = () => parseFloat(t[i++]);
  const push = (p) => {
    if (!pts.length) { pts.push(p); return; }
    const q = pts[pts.length - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / spacing));
    for (let k = 1; k <= n; k++) pts.push([q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n]);
  };
  while (i < t.length) {
    const c = t[i++];
    if (c === 'M') { cur = [num(), num()]; if (pts.length) pts.push(null); pts.push(cur); }
    else if (c === 'L') { cur = [num(), num()]; push(cur); }
    else if (c === 'Q' || c === 'C') {
      const cps = c === 'Q' ? [[num(), num()], [num(), num()]] : [[num(), num()], [num(), num()], [num(), num()]];
      const P = [cur, ...cps];
      for (let k = 1; k <= 24; k++) {
        const s = k / 24, r = 1 - s;
        push(c === 'Q'
          ? [r * r * P[0][0] + 2 * r * s * P[1][0] + s * s * P[2][0], r * r * P[0][1] + 2 * r * s * P[1][1] + s * s * P[2][1]]
          : [r * r * r * P[0][0] + 3 * r * r * s * P[1][0] + 3 * r * s * s * P[2][0] + s * s * s * P[3][0],
             r * r * r * P[0][1] + 3 * r * r * s * P[1][1] + 3 * r * s * s * P[2][1] + s * s * s * P[3][1]]);
      }
      cur = P[P.length - 1];
    }
  }
  return pts.filter(Boolean);
}

const CLUSTER = /[א-ת][֑-ׇ]*/g;

// פריסת מילה שלמה מימין לשמאל. מחזיר { width, letters } ביחידות אות, x=0 בקצה השמאלי של המילה.
// letters[k] לפי סדר הקריאה (k=0 האות הימנית). לכל אות: ch, x0/x1 (תחום האות כולל ניקוד בולט),
// strokes (מסלולי האות מוזזים למקום), marks: [{ mark, kind, strokes, dots }] במיקום סופי.
export function layoutWord(text) {
  const clusters = (text.match(CLUSTER) || []).filter((c) => LETTERS[c[0]]);
  const items = clusters.map((c) => {
    const ch = c[0], L = LETTERS[ch];
    const marks = markPlacement(ch, c.slice(1)).map((p) => {
      const M = MARKS[p.mark];
      return {
        ...p,
        strokes: M.strokes.map((s) => translatePath(s, p.x, p.y)),
        dots: M.dots.map(([x, y]) => [+(x + p.x).toFixed(4), +(y + p.y).toFixed(4)]),
      };
    });
    // תחום אופקי: האות + ניקוד שבולט הצידה
    let lo = 0, hi = L.w;
    for (const m of marks) {
      for (const [x] of m.dots) { lo = Math.min(lo, x - DOT_R); hi = Math.max(hi, x + DOT_R); }
      for (const s of m.strokes) for (const [x] of pathPoints(s, 0.1)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    return { ch, cluster: c, L, marks, lo, hi };
  });
  // מימין לשמאל: האות הראשונה בקצה הימני
  let right = 0;
  const placed = items.map((it) => {
    const ox = right - it.hi;                     // היסט של x=0 של האות
    right = right - (it.hi - it.lo) - LETTER_GAP;
    return { ...it, ox };
  });
  const width = placed.length ? -(right + LETTER_GAP) : 0;
  const letters = placed.map(({ ch, cluster, L, marks, lo, hi, ox }) => {
    const dx = ox + width;
    return {
      ch, cluster, w: L.w,
      x: +dx.toFixed(4),                          // מיקום x=0 של האות בתוך המילה
      x0: +(dx + lo).toFixed(4), x1: +(dx + hi).toFixed(4),
      strokes: L.strokes.map((s) => translatePath(s, dx, 0)),
      marks: marks.map((m) => ({
        mark: m.mark, kind: m.kind,
        strokes: m.strokes.map((s) => translatePath(s, dx, 0)),
        dots: m.dots.map(([x, y]) => [+(x + dx).toFixed(4), y]),
      })),
    };
  });
  return { width: +width.toFixed(4), letters };
}
