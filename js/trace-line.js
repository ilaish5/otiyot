// מעבר עם העט על מילה — כמו בדף עבודה בגן: כל אות היא קו מקווקו אחד דק, בלי נפח ובלי מתאר.
// הניקוד: קווים — קו מקווקו אחד, נקודות — נקודות (נוגעים בהן).
// תחליף ל-trace.js עם אותו API: new Tracer(host, { onLetter, onComplete, onMessy }).
//
// הצורות מגיעות מ-letters.js. יחידות: 1 = גובה גוף האות. y=0 השורה העליונה, y=1 שורת הבסיס,
// x=0 הקצה השמאלי של האות. המילה נפרסת מימין לשמאל, כל אות עם הניקוד שלה בנפרד.
//
// כיסוי: כל קו נדגם כל ~0.03 יחידות. הדיו של הילד מצויר גם על קנבס נסתר ברזולוציה נמוכה
// במברשת רחבה (0.24) — נקודת דגימה מכוסה אם העט עבר לידה. אות גמורה: 75% מהקווים שלה,
// כל קו לפחות 40%, וכל נקודה נגעו בה (עד 0.14 ממנה, ובדיו שקרוב אליה יותר מאשר לקו — מעבר על ו' לא מסמן שורוק).
// קשקוש: רוב הדיו מחוץ לקווים, או דיו ארוך פי 5 מהקווים של המילה (קשקוש צפוף על המילה עצמה).

// אות + הניקוד שלה (בלי מקף עברי U+05BE, שנמצא באמצע טווח הניקוד), רווח, או סימן פיסוק שההורה יכול להקליד
const TOKEN = /[\u05D0-\u05EA][\u0591-\u05BD\u05BF-\u05C7]*|\s+|['\u05F3"\u05F4\u05BE\-\u2010-\u2013]/g;
const CLUSTER = /[\u05D0-\u05EA][\u0591-\u05BD\u05BF-\u05C7]*/g;
const DAGESH = '\u05BC';
const HOLAM = '\u05B9';
const HOLAM_HASER_VAV = '\u05BA';

// גרש (ג'), גרשיים (צה"ל) ומקף: קווים קצרים משמאל לאות שלפניהם, חלק מהאות (עוברים גם עליהם).
// באזור ההורה אפשר להקליד ' ׳ " ״ - — בלי זה ג'ירפה הייתה מוצגת "גירפה".
const PUNCT = {
  "'": ['M -0.1 -0.02 L -0.17 0.26'],
  '\u05F3': ['M -0.1 -0.02 L -0.17 0.26'],
  '"': ['M -0.08 -0.02 L -0.15 0.26', 'M -0.24 -0.02 L -0.31 0.26'],
  '\u05F4': ['M -0.08 -0.02 L -0.15 0.26', 'M -0.24 -0.02 L -0.31 0.26'],
  '-': ['M -0.4 0.5 L -0.1 0.5'],
  '\u2010': ['M -0.4 0.5 L -0.1 0.5'], '\u2011': ['M -0.4 0.5 L -0.1 0.5'],
  '\u2012': ['M -0.4 0.5 L -0.1 0.5'], '\u2013': ['M -0.4 0.5 L -0.1 0.5'],
  '\u05BE': ['M -0.4 0.06 L -0.1 0.06'], // מקף עברי — גבוה
};

// פריסה
const SPACE_W = 0.45;          // רווח בין מילים (אם ההורה הוסיף שם עם רווח)
const FIT_W = 0.88;            // חלק מרוחב הדף
const FIT_H = 0.8;             // חלק מגובה הדף שהרצועה (BAND) תופסת
const MARGIN_GAP = 14;         // px — רווח בין המילה לקו השוליים
const MARGIN_X = 28;           // px מהקצה הימני. app.css ממשיך את הקו ב-#coach
const ASC_Y = -0.6, DESC_Y = 1.6; // קווי עזר חלשים לאותיות עולות/יורדות

// ציור
const GUIDE_W = 0.045;         // עובי הקו המקווקו
const DASH = [0.07, 0.08];
const GUIDE_DOT = 0.045;
const SOLID_W = 0.07;          // אות גמורה
const SOLID_DOT = 0.055;       // אם letters.js מייצא DOT_R — משתמשים בו
const INK_W = 0.07;            // העט של הילד
const INK_OPACITY = 0.85;
const START_DOT = 0.065;       // נקודת התחלה ירוקה
const ARROW_OFF = 0.13, ARROW_LEN = 0.2, ARROW_W = 0.026;

// כיסוי
const TOL_W = 0.24;            // מברשת סלחנית על הקנבס הנסתר
const LOW_PPU = 40;            // פיקסלים ליחידה בקנבס הנסתר
const SAMPLE_STEP = 0.03;
const LETTER_DONE = 0.75;      // חלק מהקווים של האות
const STROKE_MIN = 0.4;        // כל קו בנפרד (שלא ידלגו על זרוע של ש' או על הפתח)
const DOT_TOL = 0.14;
const ALLOWED_W = 0.5;         // "מותר" לקשקוש: הקווים מורחבים ב-0.25 לכל צד
const MAX_OUTSIDE = 0.5;       // יותר מזה מחוץ לקווים — "נסה לעבור בדיוק על הקווים"
// קשקוש צפוף על המילה עצמה נשאר רובו בתוך הקווים המורחבים (האותיות דקות וצפופות), אבל אורך הדיו
// בו פי 5–30 מאורך הקווים. מעבר אמיתי: בערך פי מספר הפעמים שעברו על המילה (1–4).
const MAX_OVERDRAW = 5;
const DOT_ALLOW = 0.3;         // אורך "מותר" לכל נקודה (נגיעה/עיגול קטן)

const DEF_COLORS = {
  '--rule': '#C9D8EA', '--margin': '#F2A7A7', '--guide': '#8FA3BC',
  '--pencil': '#2D5BE3', '--go': '#16A36A', '--ink': '#1C2A3A', '--mic': '#FF7A2F',
};

// ---------- letters.js (נטען פעם אחת; אם חסר/שבור — אותיות מהגופן, בלי מעבר) ----------
let libPromise = null;
export function loadLetters() {
  if (!libPromise) {
    libPromise = import('./letters.js').catch((e) => {
      console.error('letters.js', e);
      libPromise = null;
      return {};
    });
  }
  return libPromise;
}

// ---------- מסלולים ----------
// תחביר SVG: M L H V Q C Z (גם יחסי). מחזיר תתי-מסלולים: { start, segs: [{t:'L',p}|{t:'Q',c,p}|{t:'C',c1,c2,p}] }
export function parsePath(d) {
  const tok = String(d ?? '').match(/[A-Za-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || [];
  const subs = [];
  let i = 0, cmd = null, cur = null, x = 0, y = 0, sx = 0, sy = 0;
  const isCmd = (t) => /^[A-Za-z]$/.test(t);
  const num = () => (i < tok.length && !isCmd(tok[i]) ? parseFloat(tok[i++]) : NaN);
  const open = () => { if (!cur) { cur = { start: [x, y], segs: [] }; subs.push(cur); } };
  while (i < tok.length) {
    if (isCmd(tok[i])) cmd = tok[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd >= 'a';
    const C = cmd.toUpperCase();
    const pt = () => {
      const a = num(), b = num();
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return rel ? [x + a, y + b] : [a, b];
    };
    if (C === 'M') {
      const p = pt(); if (!p) { cmd = null; continue; }
      [x, y] = p; [sx, sy] = p;
      cur = { start: [x, y], segs: [] }; subs.push(cur);
      cmd = rel ? 'l' : 'L'; // זוגות נוספים אחרי M הם L
    } else if (C === 'L') {
      const p = pt(); if (!p) { cmd = null; continue; }
      open(); cur.segs.push({ t: 'L', p }); [x, y] = p;
    } else if (C === 'H' || C === 'V') {
      const v = num(); if (!Number.isFinite(v)) { cmd = null; continue; }
      const p = C === 'H' ? [rel ? x + v : v, y] : [x, rel ? y + v : v];
      open(); cur.segs.push({ t: 'L', p }); [x, y] = p;
    } else if (C === 'Q') {
      const c = pt(), p = pt(); if (!c || !p) { cmd = null; continue; }
      open(); cur.segs.push({ t: 'Q', c, p }); [x, y] = p;
    } else if (C === 'C') {
      const c1 = pt(), c2 = pt(), p = pt(); if (!c1 || !c2 || !p) { cmd = null; continue; }
      open(); cur.segs.push({ t: 'C', c1, c2, p }); [x, y] = p;
    } else if (C === 'Z') {
      if (cur) cur.segs.push({ t: 'L', p: [sx, sy] });
      x = sx; y = sy; cur = null; cmd = null;
    } else {
      console.warn('trace-line: unsupported path command', cmd);
      while (i < tok.length && !isCmd(tok[i])) i++;
      cmd = null;
    }
  }
  return subs;
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const quad = (a, c, b, t) => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};
const cubic = (a, c1, c2, b, t) => {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return [k0 * a[0] + k1 * c1[0] + k2 * c2[0] + k3 * b[0], k0 * a[1] + k1 * c1[1] + k2 * c2[1] + k3 * b[1]];
};

// תת-מסלול → נקודות במרווחים שווים לאורך הקו (עקומות מושטחות), ואורך
export function flattenSub(sp, step = SAMPLE_STEP) {
  const dense = [sp.start.slice()];
  let p0 = sp.start;
  for (const s of sp.segs) {
    if (s.t === 'L') dense.push(s.p.slice());
    else if (s.t === 'Q') {
      const n = Math.min(400, Math.max(2, Math.ceil((dist(p0, s.c) + dist(s.c, s.p)) / 0.004)));
      for (let k = 1; k <= n; k++) dense.push(quad(p0, s.c, s.p, k / n));
    } else if (s.t === 'C') {
      const n = Math.min(600, Math.max(3, Math.ceil((dist(p0, s.c1) + dist(s.c1, s.c2) + dist(s.c2, s.p)) / 0.004)));
      for (let k = 1; k <= n; k++) dense.push(cubic(p0, s.c1, s.c2, s.p, k / n));
    }
    p0 = s.p;
  }
  const pts = [dense[0]];
  let acc = 0, length = 0;
  for (let k = 1; k < dense.length; k++) {
    let a = dense[k - 1];
    const b = dense[k];
    let seg = dist(a, b);
    length += seg;
    while (seg > 0 && acc + seg >= step) {
      const t = (step - acc) / seg;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      pts.push(p);
      seg -= step - acc;
      a = p;
      acc = 0;
    }
    acc += seg;
  }
  const end = dense[dense.length - 1];
  if (acc > step * 0.25 || pts.length === 1) pts.push(end.slice());
  else pts[pts.length - 1] = end.slice(); // הנקודה האחרונה בדיוק בסוף הקו
  return { pts, length };
}

// מחרוזת מסלול → { subs: [{start, segs, pts, length}], length, points }
export function flattenPath(d, step = SAMPLE_STEP) {
  const subs = parsePath(d).map((sp) => ({ ...sp, ...flattenSub(sp, step) }));
  return {
    subs,
    length: subs.reduce((n, sp) => n + sp.length, 0),
    points: subs.flatMap((sp) => sp.pts),
  };
}

// ---------- פריסת מילה ----------
export function splitClusters(text) {
  return String(text ?? '').normalize('NFD').match(CLUSTER) || [];
}

const isVowel = (m) => (m >= '\u05B0' && m <= '\u05BB') || m === '\u05C7';

const DEFAULT_ANCHOR = {
  below: (w) => [w / 2, 1.32],
  dagesh: (w) => [w / 2, 0.5],
  above: () => [0.02, -0.2],
  shin: (w) => [w - 0.04, -0.2],
  sin: () => [0.04, -0.2],
};

// אם letters.js לא מייצא markPlacement: עוגנים של האות, שורוק וחולם מלא ב-ו
function defaultPlacement(base, marks, def, MK) {
  const w = +def.w || 0.6;
  const A = def.anchors || {};
  const vowel = marks.some((m) => isVowel(m));
  const out = [];
  for (const m0 of marks) {
    const m = MK[m0] ? m0 : m0 === HOLAM_HASER_VAV && MK[HOLAM] ? HOLAM : null;
    if (!m) continue;
    if (base === 'ו' && m === DAGESH && !vowel) { out.push({ mark: m, x: -0.16, y: 0.5 }); continue; } // שׁוּרוּק
    if (base === 'ו' && m === HOLAM) { out.push({ mark: m, x: w * 0.4, y: -0.22 }); continue; }      // חוֹלָם מָלֵא
    const at = MK[m].at || 'below';
    const a = A[at] || (DEFAULT_ANCHOR[at] || DEFAULT_ANCHOR.below)(w);
    out.push({ mark: m, x: +a[0], y: +a[1] });
  }
  return out;
}

function placeMarks(base, marks0, def, lib) {
  const MK = lib.MARKS || {};
  // חולם חסר ל-ו (U+05BA) הוא חולם רגיל לצורך הציור — letters.js לא מכיר אותו
  const marks = MK[HOLAM_HASER_VAV] ? marks0 : marks0.map((m) => (m === HOLAM_HASER_VAV ? HOLAM : m));
  if (!marks.length) return [];
  let list = null;
  if (typeof lib.markPlacement === 'function') {
    try { list = lib.markPlacement(base, marks); } catch (e) { console.warn('markPlacement', e); }
  }
  if (!Array.isArray(list)) list = defaultPlacement(base, marks, def, MK);
  const out = [];
  for (const p of list) {
    if (!p) continue;
    const key = p.mark;
    let g = null;
    if (p.strokes || p.dots) g = p;
    else if (typeof key === 'string') g = MK[key] || (key === HOLAM_HASER_VAV ? MK[HOLAM] : null);
    else if (key && (key.strokes || key.dots)) g = key;
    const x = +p.x, y = +p.y;
    if (!g || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ mark: typeof key === 'string' ? key : null, g, x, y });
  }
  return out;
}

function lineItem(d, mark) {
  const f = flattenPath(d);
  if (!f.subs.length) return null;
  if (f.length < 1e-3) { const [x, y] = f.subs[0].start; return { kind: 'dot', x, y, mark, touched: false }; }
  return { kind: 'line', subs: f.subs.filter((sp) => sp.length > 1e-4), length: f.length, mark, cov: 0, hit: 0, n: 0 };
}

function moveItem(it, dx, dy) {
  if (it.kind === 'dot') { it.x += dx; it.y += dy; return; }
  const mv = (p) => { p[0] += dx; p[1] += dy; };
  for (const sp of it.subs) {
    mv(sp.start);
    for (const s of sp.segs) { mv(s.p); if (s.c) mv(s.c); if (s.c1) { mv(s.c1); mv(s.c2); } }
    for (const p of sp.pts) mv(p);
  }
}

function itemBox(it) {
  if (it.kind === 'dot') return [it.x - GUIDE_DOT, it.y - GUIDE_DOT, it.x + GUIDE_DOT, it.y + GUIDE_DOT];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of it.subs) for (const [x, y] of sp.pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// סדר הכתיבה של הניקוד: קודם מה שבתוך האות (דגש/שורוק), אחר כך מעל, בסוף מתחת
const markOrder = (y) => (y < 0 ? 1 : y > 1 ? 2 : 0);

function buildCluster(text, LET, lib) {
  const base = text[0];
  const marks = [...text.slice(1)];
  const def = LET[base];
  const c = { text, base, marks, items: [], fallback: false, w: 0.62, l: 0, r: 0.62 };
  if (!def || !Array.isArray(def.strokes)) { c.fallback = true; return c; }
  c.w = +def.w > 0 ? +def.w : 0.6;
  for (const d of def.strokes) { const it = lineItem(d, null); if (it) c.items.push(it); }
  const placed = placeMarks(base, marks, def, lib)
    .map((p, i) => ({ ...p, i, o: markOrder(p.y) }))
    .sort((a, b) => a.o - b.o || a.i - b.i);
  for (const p of placed) {
    for (const d of p.g.strokes || []) {
      const it = lineItem(d, p.mark ?? true);
      if (it) { moveItem(it, p.x, p.y); c.items.push(it); }
    }
    for (const q of p.g.dots || []) {
      if (Number.isFinite(+q?.[0]) && Number.isFinite(+q?.[1])) {
        c.items.push({ kind: 'dot', x: p.x + +q[0], y: p.y + +q[1], mark: p.mark ?? true, touched: false });
      }
    }
  }
  clusterExtent(c);
  return c;
}

// ניקוד שבולט מהאות (שורוק משמאל ל-ו, חטף מתחת לאות צרה, גרש) מרחיב את המקום שלה
function clusterExtent(c) {
  let l = 0, r = c.w;
  for (const it of c.items) {
    const [x0, , x1] = itemBox(it);
    const pad = it.mark ? 0.04 : 0;
    l = Math.min(l, x0 - pad);
    r = Math.max(r, x1 + pad);
  }
  c.l = l; c.r = r;
}

// גרש/גרשיים/מקף אחרי אות: קווים משמאל לה, ביחידות האות (לפני ההזזה למקום במילה)
function attachPunct(c, ch) {
  c.text += ch;
  if (c.fallback) return; // אות מהגופן: הגרש מצויר איתה בטקסט
  for (const d of PUNCT[ch] || []) { const it = lineItem(d, ch); if (it) c.items.push(it); }
  clusterExtent(c);
}

// מילה → אשכולות (אות + ניקוד) עם מיקום ביחידות מילה. האשכול הראשון הכי ימני. רוחב המילה [0, width].
export function layoutWord(text, lib = {}) {
  const LET = lib.LETTERS || {};
  const gap = Number.isFinite(+lib.LETTER_GAP) && lib.LETTER_GAP !== null ? +lib.LETTER_GAP : 0.2;
  const band = { top: -0.65, bottom: 1.65, ...(lib.BAND || {}) };
  const tokens = String(text ?? '').normalize('NFD').match(TOKEN) || [];
  const clusters = [];
  let cursor = 0, space = 0;
  for (const tk of tokens) {
    if (/^\s/.test(tk)) { if (clusters.length) space = SPACE_W; continue; }
    if (PUNCT[tk]) {
      const prev = clusters[clusters.length - 1];
      if (prev && !space) { attachPunct(prev, tk); cursor = prev.x + prev.l; }
      continue;
    }
    const c = buildCluster(tk, LET, lib);
    if (clusters.length) cursor -= gap + space;
    space = 0;
    c.x = cursor - c.r;       // x=0 של האות, ביחידות מילה
    cursor = c.x + c.l;
    clusters.push(c);
  }
  const width = -cursor;
  let top = band.top, bottom = band.bottom;
  for (const c of clusters) {
    c.x += width;
    c.left = c.x + c.l;
    c.right = c.x + c.r;
    for (const it of c.items) {
      moveItem(it, c.x, 0);
      const [, y0, , y1] = itemBox(it);
      top = Math.min(top, y0 - 0.05);
      bottom = Math.max(bottom, y1 + 0.05);
    }
  }
  const dotR = +lib.DOT_R > 0 ? +lib.DOT_R : SOLID_DOT;
  const word = { text: String(text ?? ''), clusters, width, band: { top, bottom }, gap, dotR };
  prepDots(word);
  // אורך הקווים שצריך לעבור (למדידת קשקוש). אות מהגופן — הערכה גסה
  word.pathLen = clusters.reduce((n, c) => n + (c.fallback ? 3 * c.w : 0) +
    c.items.reduce((m, it) => m + (it.kind === 'dot' ? DOT_ALLOW : it.length), 0), 0);
  return word;
}

// נקודה "נוגעים" בה רק בדיו שקרוב אליה יותר מאשר לכל קו או נקודה אחרת במילה —
// כך מעבר על ה-ו (גם עם סטייה קטנה) לא מסמן את השורוק שלידה, ונגיעה בין שתי נקודות לא מסמנת את שתיהן.
function prepDots(word) {
  const segs = [], dots = [];
  for (const c of word.clusters) for (const it of c.items) {
    if (it.kind === 'dot') { dots.push(it); continue; }
    for (const sp of it.subs) for (let i = 1; i < sp.pts.length; i++) segs.push([sp.pts[i - 1], sp.pts[i]]);
  }
  const R = 2 * DOT_TOL + 0.02;
  for (const d of dots) {
    const p = [d.x, d.y];
    d.near = segs.filter(([a, b]) => segDist(p, a, b) < R);
    d.nearDots = dots.filter((o) => o !== d && Math.hypot(o.x - d.x, o.y - d.y) < R).map((o) => [o.x, o.y]);
  }
}

// גודל ומיקום על המסך: s = פיקסלים ליחידה, (X0,Y0) = נקודת (0,0) של המילה.
// המילה ממורכזת, ולכן כשיש קו שוליים היא נשארת רחוקה ממנו גם בצד ימין.
export function fitLayout(width, band, hostW, hostH, margin = true) {
  const clear = margin ? hostW - 2 * (MARGIN_X + MARGIN_GAP) : hostW * 0.94;
  const availW = Math.max(40, Math.min(hostW * FIT_W, clear));
  const bandH = Math.max(0.5, band.bottom - band.top);
  const s = Math.max(1, Math.min(availW / Math.max(width, 0.3), (hostH * FIT_H) / bandH));
  return {
    s,
    X0: hostW / 2 - (width * s) / 2,
    Y0: hostH / 2 - ((band.top + band.bottom) / 2) * s,
  };
}

// ---------- צבעים ----------
function parseColor(c) {
  c = String(c || '').trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function mix(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  if (!A || !B) return a;
  const [r, g, bl] = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${r}, ${g}, ${bl})`;
}

function traceSub(g, sp) {
  g.moveTo(sp.start[0], sp.start[1]);
  for (const s of sp.segs) {
    if (s.t === 'L') g.lineTo(s.p[0], s.p[1]);
    else if (s.t === 'Q') g.quadraticCurveTo(s.c[0], s.c[1], s.p[0], s.p[1]);
    else g.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.p[0], s.p[1]);
  }
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// ---------- Tracer ----------
export class Tracer {
  // showOrder, margin: אפשרויות לדף הבדיקה (tools/letters.html). האפליקציה לא משתמשת בהן.
  constructor(host, { onLetter, onComplete, onMessy, showOrder = false, margin = true } = {}) {
    this.host = host;
    this.cb = { onLetter, onComplete, onMessy };
    this.showOrder = showOrder; // מספר וחץ ליד תחילת כל קו
    this.margin = margin;       // קו השוליים הוורוד
    this.guide = document.createElement('canvas');
    this.ink = document.createElement('canvas');
    this.guide.className = 'trace-guide';
    this.ink.className = 'trace-ink';
    this.ink.style.opacity = INK_OPACITY;
    host.append(this.guide, this.ink);
    this.low = document.createElement('canvas');  // הדיו במברשת רחבה — לחישוב כיסוי
    this.maskCanvas = document.createElement('canvas'); // הקווים מורחבים — לבדיקת קשקוש
    this.penSeen = false;
    this.enabled = true;
    this.text = '';
    this.word = null;
    this.done = new Set();
    this.complete = false;
    this.finalColor = null;
    this.strokes = [];   // הדיו ביחידות מילה: [[x, y, עובי], ...] — שורד שינוי גודל
    this.seq = 0;
    this.bind();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
  }

  async setWord(text) {
    if (this.dead) return;
    const my = ++this.seq;
    this.resetProgress();
    this.text = String(text ?? '');
    const lib = await loadLetters();
    if (my !== this.seq) return;
    this.word = layoutWord(this.text, lib);
    this.word.clusters.forEach((c, k) => { if (!c.items.length) this.done.add(k); }); // אין מה לעבור (אות חסרה)
    this.layout(true);
  }

  resetProgress() {
    this.done = new Set();
    this.complete = false;
    this.finalColor = null;
    this.lastSig = null;
    clearTimeout(this.pending); this.pending = null;
    this.clearInk(false);
  }

  layout(force = false) {
    if (this.dead) return;
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height || !this.word) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${r.width}x${r.height}@${dpr}`;
    if (!force && key === this.layoutKey && this.word === this.layoutFor) return;
    this.layoutKey = key; this.layoutFor = this.word;
    const w = (this.w = r.width), h = (this.h = r.height);
    this.dpr = dpr;
    for (const c of [this.guide, this.ink]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    Object.assign(this, fitLayout(this.word.width, this.word.band, w, h, this.margin));
    this.f = Math.min(1, LOW_PPU / this.s);
    this.lw = Math.max(1, Math.ceil(w * this.f));
    this.lh = Math.max(1, Math.ceil(h * this.f));
    this.low.width = this.lw; this.low.height = this.lh;
    this.buildSamples();
    this.buildMask();
    this.drawGuide();
    this.redrawInk();
  }

  // פיקסל (ערוץ אלפא) בקנבס הנסתר לכל נקודת דגימה
  buildSamples() {
    const k = this.f * this.s, bx = this.f * this.X0, by = this.f * this.Y0;
    const { lw, lh } = this;
    for (const c of this.word.clusters) for (const it of c.items) {
      if (it.kind !== 'line') continue;
      const idx = [];
      for (const sp of it.subs) for (const [x, y] of sp.pts) {
        const px = Math.floor(bx + k * x), py = Math.floor(by + k * y);
        idx.push(px >= 0 && py >= 0 && px < lw && py < lh ? (py * lw + px) * 4 + 3 : -1);
      }
      it.idx = Int32Array.from(idx);
    }
  }

  buildMask() {
    const m = this.maskCanvas;
    m.width = this.lw; m.height = this.lh;
    const g = m.getContext('2d', { willReadFrequently: true });
    const k = this.f * this.s;
    g.setTransform(k, 0, 0, k, this.f * this.X0, this.f * this.Y0);
    g.strokeStyle = g.fillStyle = '#000';
    g.lineWidth = ALLOWED_W; g.lineCap = g.lineJoin = 'round';
    for (const c of this.word.clusters) {
      if (c.fallback) g.fillRect(c.left - 0.1, -0.2, c.right - c.left + 0.2, 1.4);
      for (const it of c.items) {
        g.beginPath();
        if (it.kind === 'dot') { g.arc(it.x, it.y, ALLOWED_W / 2, 0, Math.PI * 2); g.fill(); }
        else { for (const sp of it.subs) traceSub(g, sp); g.stroke(); }
      }
    }
    const d = g.getImageData(0, 0, this.lw, this.lh).data;
    this.mask = new Uint8Array(this.lw * this.lh);
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = d[i * 4 + 3];
  }

  colors() {
    const cs = getComputedStyle(this.host);
    const v = (n) => cs.getPropertyValue(n).trim() || DEF_COLORS[n];
    const guide = v('--guide');
    return {
      rule: v('--rule'), margin: v('--margin'), guide, pencil: v('--pencil'),
      go: v('--go'), order: v('--mic'), strong: mix(guide, v('--ink'), 0.35),
    };
  }

  // המרת פיקסלים ליחידות — עובי מינימלי/מקסימלי כדי שהקו ייראה טוב גם בדף קטן מאוד או גדול מאוד
  px(n) { return n / this.s; }
  clampU(u, minPx, maxPx) { return Math.min(Math.max(u, minPx / this.s), maxPx / this.s); }

  currentIndex() {
    if (!this.word || this.complete) return -1;
    return this.word.clusters.findIndex((c, k) => !this.done.has(k));
  }

  firstOpenItem(c) {
    return c.items.findIndex((it) => (it.kind === 'dot' ? !it.touched : it.cov < LETTER_DONE));
  }

  get ready() { return !!this.word && !!this.s && this.layoutFor === this.word; }

  drawGuide() {
    if (!this.ready) return;
    const g = this.guide.getContext('2d');
    const { w, h, dpr, s, X0, Y0 } = this;
    const col = this.colors();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.lineCap = 'butt';

    // דף מחברת: שורה עליונה ושורת בסיס, קווי עזר חלשים לאותיות עולות/יורדות, קו שוליים מימין
    g.setLineDash([]);
    g.strokeStyle = col.rule; g.lineWidth = 2;
    for (const y of [Y0, Y0 + s]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.globalAlpha = 0.55; g.lineWidth = 1; g.setLineDash([5, 7]);
    for (const u of [ASC_Y, DESC_Y]) {
      const y = Y0 + u * s;
      if (y > 2 && y < h - 2) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }
    g.globalAlpha = 1; g.setLineDash([]);
    if (this.margin) {
      g.strokeStyle = col.margin; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(w - MARGIN_X, 0); g.lineTo(w - MARGIN_X, h); g.stroke();
    }

    // המילה, ביחידות
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * X0, dpr * Y0);
    g.lineCap = g.lineJoin = 'round';
    const cur = this.currentIndex();
    this.word.clusters.forEach((c, k) => {
      if (c.fallback) this.paintFallback(g, c, this.complete ? this.finalColor || col.pencil : col.guide);
      else if (this.complete) this.paintSolid(g, c, this.finalColor || col.pencil);
      else if (this.done.has(k)) this.paintSolid(g, c, col.pencil);
      else this.paintGuide(g, c, k === cur ? col.strong : col.guide, k === cur ? 1.15 : 1);
    });
    if (this.showOrder && !this.complete) {
      this.word.clusters.forEach((c, k) => { if (!this.done.has(k)) this.paintOrder(g, c, col); });
    } else if (cur >= 0) {
      this.paintStart(g, this.word.clusters[cur], col.go);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  dashFor(length, lw) {
    const d = Math.max(DASH[0], this.px(4));
    const gp = Math.max(DASH[1], lw + this.px(3));
    const n = Math.max(1, Math.round((length + gp) / (d + gp)));
    if (n === 1) return [];
    const f = length / (n * d + (n - 1) * gp); // מקף שלם בשני קצוות הקו
    return [d * f, gp * f];
  }

  paintGuide(g, c, color, k = 1) {
    const lw = this.clampU(GUIDE_W, 2, 10) * k;
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = lw;
    for (const it of c.items) {
      if (it.kind === 'dot') {
        g.setLineDash([]);
        g.beginPath(); g.arc(it.x, it.y, Math.max(GUIDE_DOT, this.px(2.5)) * k, 0, Math.PI * 2); g.fill();
        continue;
      }
      for (const sp of it.subs) {
        g.setLineDash(this.dashFor(sp.length, lw));
        g.beginPath(); traceSub(g, sp); g.stroke();
      }
    }
    g.setLineDash([]);
  }

  paintSolid(g, c, color) {
    g.setLineDash([]);
    g.strokeStyle = color; g.fillStyle = color;
    g.lineWidth = this.clampU(SOLID_W, 2.5, 16);
    for (const it of c.items) {
      g.beginPath();
      if (it.kind === 'dot') { g.arc(it.x, it.y, Math.max(this.word.dotR, this.px(3)), 0, Math.PI * 2); g.fill(); }
      else { for (const sp of it.subs) traceSub(g, sp); g.stroke(); }
    }
  }

  paintFallback(g, c, color) {
    // אות שאין לה צורה ב-letters.js — מהגופן, מלאה, בלי מעבר
    const { dpr, s, X0, Y0 } = this;
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `600 ${1.78 * s}px "Noto Sans Hebrew", "Arial Hebrew", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.direction = 'rtl';
    g.fillStyle = color;
    g.fillText(c.text, X0 + (c.x + c.w / 2) * s, Y0 + s);
    g.restore();
  }

  // נקודת התחלה ירוקה + חץ כיוון ליד הקו הבא של האות הנוכחית
  paintStart(g, c, color) {
    const i = this.firstOpenItem(c);
    if (i < 0) return;
    const it = c.items[i];
    g.setLineDash([]);
    g.fillStyle = g.strokeStyle = color;
    if (it.kind === 'dot') {
      g.lineWidth = this.clampU(0.03, 2, 6);
      g.beginPath(); g.arc(it.x, it.y, Math.max(0.11, this.px(8)), 0, Math.PI * 2); g.stroke();
      return;
    }
    const sp = it.subs[0];
    this.paintArrow(g, c, it, sp, color);
    g.fillStyle = color;
    g.beginPath(); g.arc(sp.start[0], sp.start[1], Math.max(START_DOT, this.px(5)), 0, Math.PI * 2); g.fill();
  }

  paintArrow(g, c, it, sp, color) {
    const pts = sp.pts;
    if (sp.length < 0.1 || pts.length < 3) return;
    const at = (d) => Math.max(0, Math.min(pts.length - 1, Math.round(d / SAMPLE_STEP)));
    const tan = (i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = dist(a, b) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    const d0 = Math.min(0.08, sp.length * 0.2);
    const d1 = Math.min(d0 + ARROW_LEN, sp.length * 0.9);
    if (d1 - d0 < 0.06) return;
    const i0 = at(d0), i1 = at(d1);
    // הצד: הרחק ממרכז האות (או ממרכז סימן הניקוד)
    const box = it.mark ? null : [c.x + c.w / 2, 0.5];
    const center = box || (() => { const b = itemBox(it); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2 - 0.3]; })();
    const t0 = tan(i0);
    const n0 = [-t0[1], t0[0]];
    const v = [pts[i0][0] - center[0], pts[i0][1] - center[1]];
    const side = n0[0] * v[0] + n0[1] * v[1] >= 0 ? 1 : -1;
    const off = Math.max(ARROW_OFF, this.px(9));
    const line = [];
    for (let i = i0; i <= i1; i++) {
      const t = tan(i);
      line.push([pts[i][0] - t[1] * side * off, pts[i][1] + t[0] * side * off]);
    }
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = this.clampU(ARROW_W, 1.5, 5);
    g.beginPath();
    line.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
    const e = line[line.length - 1];
    const t = tan(i1);
    const hl = Math.max(0.07, this.px(6)), hw = Math.max(0.045, this.px(4));
    g.beginPath();
    g.moveTo(e[0] + t[0] * hl * 0.5, e[1] + t[1] * hl * 0.5);
    g.lineTo(e[0] - t[0] * hl * 0.5 - t[1] * hw, e[1] - t[1] * hl * 0.5 + t[0] * hw);
    g.lineTo(e[0] - t[0] * hl * 0.5 + t[1] * hw, e[1] - t[1] * hl * 0.5 - t[0] * hw);
    g.closePath(); g.fill();
  }

  // לבדיקה (tools/letters.html): מספר סידורי וחץ לכל קו
  paintOrder(g, c, col) {
    let n = 0;
    for (const it of c.items) {
      if (it.kind !== 'line') continue;
      n++;
      const sp = it.subs[0];
      this.paintArrow(g, c, it, sp, col.order);
      const r = Math.max(0.075, this.px(7));
      g.fillStyle = col.order;
      g.beginPath(); g.arc(sp.start[0], sp.start[1], r, 0, Math.PI * 2); g.fill();
      const { dpr, s, X0, Y0 } = this;
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(r * s * 1.3)}px Rubik, "Arial Hebrew", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'ltr';
      g.fillText(String(n), X0 + sp.start[0] * s, Y0 + sp.start[1] * s + r * s * 0.08);
      g.restore();
    }
  }

  // אחרי קריאה נכונה (ירוק), כשמוותרים, או כשאין חובת מעבר
  reveal(color) {
    this.complete = true;
    this.finalColor = color || this.colors().pencil;
    clearTimeout(this.pending); this.pending = null;
    this.drawGuide();
    this.clearInk(true);
  }

  redraw() { this.drawGuide(); }

  restart() {
    this.done = new Set();
    this.complete = false;
    this.finalColor = null;
    this.lastSig = null;
    clearTimeout(this.pending); this.pending = null;
    if (this.word) {
      this.word.clusters.forEach((c, k) => {
        if (!c.items.length) this.done.add(k);
        for (const it of c.items) { it.cov = 0; it.hit = 0; it.touched = false; }
      });
    }
    this.clearInk(false);
    this.drawGuide();
  }

  // ---------- דיו ----------
  inkCtx() {
    const k = this.ink.getContext('2d');
    const { dpr, s, X0, Y0 } = this;
    k.setTransform(dpr * s, 0, 0, dpr * s, dpr * X0, dpr * Y0);
    k.lineCap = k.lineJoin = 'round';
    k.strokeStyle = this.inkColor || (this.inkColor = this.colors().pencil);
    return k;
  }

  lowCtx() {
    const l = this.low.getContext('2d', { willReadFrequently: true });
    const k = this.f * this.s;
    l.setTransform(k, 0, 0, k, this.f * this.X0, this.f * this.Y0);
    l.lineCap = l.lineJoin = 'round';
    l.strokeStyle = '#000';
    l.lineWidth = TOL_W;
    return l;
  }

  seg(a, b, k = this.inkCtx(), l = this.lowCtx()) {
    k.lineWidth = Math.max(INK_W * b[2], this.px(2.5));
    k.beginPath(); k.moveTo(a[0], a[1]); k.lineTo(b[0], b[1]); k.stroke();
    l.beginPath(); l.moveTo(a[0], a[1]); l.lineTo(b[0], b[1]); l.stroke();
  }

  drawStroke(st, k, l) {
    if (st.length === 1) { const p = st[0]; this.seg(p, [p[0] + 0.002, p[1], p[2]], k, l); return; }
    for (let i = 1; i < st.length; i++) this.seg(st[i - 1], st[i], k, l);
  }

  redrawInk() {
    if (!this.ready) return;
    const k = this.ink.getContext('2d');
    k.setTransform(1, 0, 0, 1, 0, 0);
    k.clearRect(0, 0, this.ink.width, this.ink.height);
    const l = this.low.getContext('2d', { willReadFrequently: true });
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.low.width, this.low.height);
    this.inkColor = null;
    const kc = this.inkCtx(), lc = this.lowCtx();
    for (const st of this.strokes) this.drawStroke(st, kc, lc);
  }

  wipeInk() {
    const k = this.ink.getContext('2d');
    k.setTransform(1, 0, 0, 1, 0, 0);
    k.clearRect(0, 0, this.ink.width, this.ink.height);
    const l = this.low.getContext('2d', { willReadFrequently: true });
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.low.width, this.low.height);
    this.ink.style.opacity = INK_OPACITY;
  }

  clearInk(fade) {
    this.strokes = [];
    this.drawing = false; this.pid = null;
    clearTimeout(this.fadeTimer); this.fadeTimer = null;
    if (fade) {
      this.ink.style.opacity = 0;
      this.fadeTimer = setTimeout(() => { this.fadeTimer = null; this.wipeInk(); }, 380);
    } else this.wipeInk();
  }

  bind() {
    const el = this.ink;
    let stroke = null, type = null;
    const pf = (e) => (e.pointerType === 'pen' ? 0.7 + 0.6 * (e.pressure || 0.5) : 1);

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') this.penSeen = true;
      if (!this.enabled || this.complete || !this.ready) return;
      if (e.pointerType === 'touch' && this.penSeen) return; // כף היד על המסך
      if (this.drawing) {
        if (e.pointerType === 'pen' && type === 'touch') {
          // כף היד נגעה לפני העט — מוחקים את "הקו" שלה וממשיכים עם העט
          this.strokes.pop();
          this.redrawInk();
        } else if (e.pointerType === 'touch' || e.pointerType !== type) {
          return; // אצבע שנייה
        }
        // אותו סוג (עט/עכבר) שוב: ה-pointerup של הקו הקודם לא הגיע אלינו (הקנבס הוסתר, capture נכשל).
        // הקו הקודם נשאר, ומתחילים קו חדש — אחרת כל נגיעה של העט נחסמת עד restart().
      }
      this.drawing = true; this.pid = e.pointerId; type = e.pointerType;
      try { el.setPointerCapture(e.pointerId); } catch {}
      const r = el.getBoundingClientRect();
      const p = [(e.clientX - r.left - this.X0) / this.s, (e.clientY - r.top - this.Y0) / this.s, pf(e)];
      stroke = [p];
      this.strokes.push(stroke);
      this.inkColor = null;
      this.drawStroke(stroke, this.inkCtx(), this.lowCtx());
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.drawing || e.pointerId !== this.pid || !stroke) return;
      let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      const r = el.getBoundingClientRect();
      const k = this.inkCtx(), l = this.lowCtx();
      for (const ev of evs) {
        const p = [(ev.clientX - r.left - this.X0) / this.s, (ev.clientY - r.top - this.Y0) / this.s, pf(ev)];
        const last = stroke[stroke.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004) continue;
        stroke.push(p);
        this.seg(last, p, k, l);
      }
      this.scheduleCheck();
    });

    const end = (e) => {
      if (!this.drawing || e.pointerId !== this.pid) return;
      this.drawing = false; this.pid = null; stroke = null;
      this.check(true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // ה-capture אבד בלי pointerup (למשל המסך הוסתר באמצע קו) — סוגרים את הקו. אחרי pointerup רגיל זה לא עושה כלום.
    el.addEventListener('lostpointercapture', end);
  }

  scheduleCheck() {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = null; this.check(false); }, 120);
  }

  // נגעו בנקודה: דיו עד DOT_TOL ממנה, וקרוב אליה יותר מאשר לכל קו/נקודה שכנים (ראו prepDots)
  dotTouched(it) {
    const d = [it.x, it.y];
    const near = it.near || [], nearDots = it.nearDots || [];
    const ok = (q) => {
      const dd = Math.hypot(q[0] - d[0], q[1] - d[1]);
      if (dd > DOT_TOL) return false;
      for (const [a, b] of near) if (segDist(q, a, b) < dd) return false;
      for (const o of nearDots) if (Math.hypot(q[0] - o[0], q[1] - o[1]) < dd) return false;
      return true;
    };
    for (const st of this.strokes) {
      if (st.length === 1) { if (ok(st[0])) return true; continue; }
      for (let i = 1; i < st.length; i++) {
        const a = st[i - 1], b = st[i];
        if (segDist(d, a, b) > DOT_TOL) continue;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
        for (let j = 0; j <= n; j++) if (ok([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])) return true;
      }
    }
    return false;
  }

  // כמה מהדיו רחוק מהקווים (מחוץ לקווים המורחבים), ואורך הדיו כולו
  outsideRatio() {
    const k = this.f * this.s, bx = this.f * this.X0, by = this.f * this.Y0;
    const { lw, lh, mask } = this;
    let total = 0, out = 0, length = 0;
    const test = (x, y) => {
      total++;
      const px = Math.floor(bx + k * x), py = Math.floor(by + k * y);
      if (px < 0 || py < 0 || px >= lw || py >= lh || mask[py * lw + px] < 20) out++;
    };
    for (const st of this.strokes) {
      test(st[0][0], st[0][1]);
      for (let i = 1; i < st.length; i++) {
        const a = st[i - 1], b = st[i];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        length += l;
        const n = Math.max(1, Math.ceil(l / 0.04));
        for (let j = 1; j <= n; j++) test(a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n);
      }
    }
    return { total, ratio: total ? out / total : 0, length };
  }

  letterReady(c) {
    let hit = 0, n = 0;
    for (const it of c.items) {
      if (it.kind === 'dot') { if (!it.touched) return false; continue; }
      if (it.cov < STROKE_MIN) return false;
      hit += it.hit; n += it.n;
    }
    return !n || hit / n >= LETTER_DONE;
  }

  check(strokeEnded) {
    if (this.complete || !this.ready || !this.mask) return;
    const clusters = this.word.clusters;
    const data = this.lowCtx().getImageData(0, 0, this.lw, this.lh).data;
    for (const c of clusters) for (const it of c.items) {
      if (it.kind === 'dot') { if (!it.touched) it.touched = this.dotTouched(it); continue; }
      let hit = 0;
      for (const i of it.idx) if (i >= 0 && data[i] > 24) hit++;
      it.hit = hit; it.n = it.idx.length;
      it.cov = it.n ? hit / it.n : 1;
    }
    const { total, ratio, length } = this.outsideRatio();
    const pathLen = this.word.pathLen || 0;
    const scrawl = pathLen >= 0.3 && length > MAX_OVERDRAW * pathLen; // קשקוש צפוף על המילה
    const messy = scrawl || (total >= 8 && ratio > MAX_OUTSIDE);
    const ready = clusters.map((c, k) => this.done.has(k) || this.letterReady(c));
    const fresh = [];
    if (!messy) ready.forEach((ok, k) => { if (ok && !this.done.has(k)) { this.done.add(k); fresh.push(k); } });

    const cur = this.currentIndex();
    const sig = cur < 0 ? 'x' : `${cur}:${this.firstOpenItem(clusters[cur])}:${this.done.size}`;
    if (fresh.length || sig !== this.lastSig) { this.lastSig = sig; this.drawGuide(); }

    const my = this.seq;
    for (const k of fresh) {
      this.cb.onLetter?.(k, clusters.length);
      if (my !== this.seq || this.complete || this.word?.clusters !== clusters) return;
    }
    if (!strokeEnded || !this.strokes.length) return;
    // קשקוש ברור — מיד כשמרימים את העט, גם אם לא כל האותיות מכוסות (אחרת הדף נשאר מלא דיו בלי תגובה)
    if (scrawl) { this.cb.onMessy?.(); return; }
    if (!ready.every(Boolean)) return;
    if (messy) { this.cb.onMessy?.(); return; }
    this.complete = true;
    this.finalColor = this.colors().pencil;
    this.drawGuide();
    this.clearInk(true);
    this.cb.onComplete?.();
  }

  destroy() {
    this.dead = true;
    this.seq++;
    this.drawing = false; this.pid = null;
    this.word = null; // ready=false: אירועים מאוחרים (lostpointercapture בהסרה) לא עושים כלום
    this.ro.disconnect();
    clearTimeout(this.pending); clearTimeout(this.fadeTimer);
    this.guide.remove(); this.ink.remove();
    // Safari באייפד משחרר זיכרון קנבס רק כשהגודל מתאפס (יש תקרה כוללת לכל הקנבסים בדף)
    for (const c of [this.guide, this.ink, this.low, this.maskCanvas]) { c.width = 0; c.height = 0; }
  }
}
