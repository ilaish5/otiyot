// אזור הורים: התקדמות, מילים, ציורים והגדרות.
// טקסט להורה בלי ניקוד. מילים של הילד תמיד עם ניקוד ובגופן המילים.

import { LEVELS, BASE_WORDS, stageOfStation, stageOfText } from './words.js';
import {
  stationFromSettings, clampStation, clampStage, lastStation, placeCustom, stationProgress, levelInfo, stationInfo, searchKey,
} from './progress.js';
import {
  getSettings, saveSettings, listCustomWords, addCustomWord, deleteCustomWord, getAllStats,
  listAttempts, listDrawings, deleteDrawing, resetProgress, exportAll, importAll,
} from './db.js';
import { canListen, canSpeak, hasHebrewVoice, say, listen, stopListening } from './speech.js';
import { PAGES } from './pages.js';
import { getSession, signOut, changeCode } from './cloud.js';
import { getStatus, onStatus, syncNow, fetchDrawingBlob } from './sync.js';

// מילת בדיקה להקראה — לקוחה מרשימת המילים כדי שהניקוד יהיה בדיוק אותו ניקוד
const TEST_WORD = (BASE_WORDS.find((w) => w.id === 'aba') || BASE_WORDS[0]).text;

const TABS = [
  { id: 'progress', label: 'התקדמות' },
  { id: 'words', label: 'מילים' },
  { id: 'drawings', label: 'ציורים' },
  { id: 'settings', label: 'הגדרות' },
  { id: 'lab', label: 'מעבדה' },
];

import { countRecordings, deleteAllRecordings } from './recorder.js';

const LAB_URL = 'http://127.0.0.1:8766/lab/';
const LAB_CMD = 'cd "/Users/ilaish/Desktop/פרויקטים/תחומים/אישי/reading=learning" && python3 lab/server.py';

const OUTCOMES = { solo: 'קרא לבד', heard: 'אחרי ששמע', skipped: 'דילג' };

// מקלדת ניקוד: [סימן, שם]
const MARKS = [
  ['ָ', 'קמץ'],
  ['ַ', 'פתח'],
  ['ֵ', 'צירה'],
  ['ֶ', 'סגול'],
  ['ִ', 'חיריק'],
  ['ֹ', 'חולם'],
  ['ֻ', 'קובוץ'],
  ['ְ', 'שווא'],
  ['ּ', 'דגש / שורוק'],
  ['ׁ', 'שין ימנית'],
  ['ׂ', 'שין שמאלית'],
  ['ֲ', 'חטף פתח'],
];

const LENIENCY = [
  { id: 'strict', name: 'מחמיר', hint: 'רק התאמה מלאה' },
  { id: 'normal', name: 'רגיל', hint: 'מתעלם מאותיות שנשמעות אותו דבר (ק/כ, ט/ת, ע/א)' },
  { id: 'lenient', name: 'סלחני', hint: 'גם ש/ס, ח/כ ושגיאה של אות אחת' },
];

const NO_MIC_PERMISSION = 'אין הרשאת מיקרופון. אפשר לאשר בהגדרות Safari לאתר הזה';
const MIC_ERRORS = {
  'not-allowed': NO_MIC_PERMISSION,
  'service-not-allowed': NO_MIC_PERMISSION,
  network: 'אין חיבור לאינטרנט',
  'no-speech': 'לא נשמע דיבור',
  unsupported: 'הדפדפן לא תומך בזיהוי דיבור',
  'audio-capture': 'לא נמצא מיקרופון',
  aborted: 'הבדיקה הופסקה',
  'language-not-supported': 'זיהוי דיבור בעברית לא זמין. בדקו שההכתבה מופעלת',
  'start-failed': 'לא הצלחתי להפעיל את המיקרופון. נסו שוב',
};

const HEB_LETTER = /[א-ת]/;
const HAS_NIKUD = /[ְ-ׇֽֿׁׂׅׄ]/;
const ALLOWED = /^[א-ת֑-ׇ׳״'\- ]+$/;
const ORPHAN_MARK = /(^|\s)[֑-ׇֽֿׁׂׅׄ]/; // ניקוד בלי אות לפניו

const ICONS = {
  back: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9"/><path d="M7 14l5-5 5 5"/><path d="M5 4h14"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  backspace: '<path d="M15 5H4v14h11l6-7z"/><path d="M7.5 9.5l5 5"/><path d="M12.5 9.5l-5 5"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  cloud: '<path d="M7.5 18.5h9.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.6 4.5 4.5 0 0 0 7.5 18.5z"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14 5.3"/><path d="M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/>',
  logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l3 3"/><path d="M15 8l2 2"/>',
};

// שינוי קוד — שגיאות מ-changeCode
const CODE_ERRORS = {
  weak: 'הקוד חלש מדי. בחרו קוד ארוך יותר',
  network: 'אין חיבור לאינטרנט. נסו שוב כשיש רשת',
  same: 'זה הקוד הנוכחי. בחרו קוד אחר',
  unknown: 'השינוי נכשל. נסו שוב',
};
const CODE_MIN = 6;
const CODE_GOOD = 8;
const CLOUD_MS = 20000;  // פעולה מול הענן שלא חוזרת — כאילו אין רשת
const DRAW_LOADS = 2;    // ציורים שיורדים מהענן במקביל

// ---------- עזרי DOM ----------
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'maxLength']);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (PROPS.has(k)) el[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== '') el.append(c);
  return el;
}

function icon(name, size = 22) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="p-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  return t.content.firstElementChild;
}

function btn(label, ico, variant, onClick) {
  const b = h('button', { type: 'button', class: `p-btn p-btn--${variant}` },
    ico ? icon(ico) : null, h('span', { class: 'p-btn-label' }, label));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const word = (text, size = '') => h('span', { class: `p-word ${size}`.trim(), lang: 'he' }, text);
const pic = (p) => (p ? h('span', { class: 'p-pic', 'aria-hidden': 'true' }, p) : null);
const card = (title, ...kids) => h('section', { class: 'p-card' }, title ? h('h2', { class: 'p-h2' }, title) : null, ...kids);
const empty = (text) => h('p', { class: 'p-empty' }, text);
const hint = (text) => (text ? h('p', { class: 'p-hint' }, text) : null);
const note = (text, kind = 'info') => h('p', { class: `p-msg p-msg--${kind}` }, text);

function status(outcome) {
  const known = outcome in OUTCOMES;
  return h('span', { class: `p-status p-status--${known ? outcome : 'other'}` }, known ? OUTCOMES[outcome] : String(outcome ?? '—'));
}

function tile(label, value, subs = [], ratio = null) {
  return h('div', { class: 'p-tile' },
    h('div', { class: 'p-tile-label' }, label),
    h('div', { class: 'p-tile-value' }, String(value)),
    subs.map((x) => h('div', { class: 'p-tile-sub' }, x)),
    ratio == null ? null : h('div', { class: 'p-bar', 'aria-hidden': 'true' },
      h('span', { style: `width:${Math.round(Math.min(1, ratio) * 100)}%` })));
}

function mkSelect(id, options, current) {
  const sel = h('select', { id }, options.map(([v, label]) => h('option', { value: String(v) }, label)));
  // ערך שלא ברשימה (למשל מגיבוי ישן) — מוסיפים אותו כדי שהבחירה תשקף את המצב האמיתי
  if (!options.some(([v]) => String(v) === String(current))) sel.prepend(h('option', { value: String(current) }, String(current)));
  sel.value = String(current);
  return sel;
}
const selectBox = (sel) => h('span', { class: 'p-select' }, sel, icon('chevron', 18));

// כפתור מחיקה/איפוס בשני שלבים: נגיעה ראשונה מבקשת אישור ל-3 שניות, השנייה מבצעת
function twoStep(button, { confirm, onConfirm, onError, ms = 3000 }) {
  const idle = [...button.childNodes];
  const label = button.getAttribute('aria-label');
  let timer = 0;
  const disarm = () => {
    clearTimeout(timer); timer = 0;
    button.classList.remove('is-armed');
    button.replaceChildren(...idle);
    if (label) button.setAttribute('aria-label', label);
  };
  button.addEventListener('click', async () => {
    if (!timer) {
      button.classList.add('is-armed');
      button.replaceChildren(confirm);
      button.removeAttribute('aria-label');
      timer = setTimeout(disarm, ms);
      return;
    }
    clearTimeout(timer); timer = 0;
    button.disabled = true;
    try { await onConfirm(); } catch (err) { console.error(err); onError?.(err); }
    button.disabled = false;
    disarm();
  });
}

// ---------- זמן ----------
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateStr = (d) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function when(ts, now = Date.now()) {
  const diff = now - ts;
  if (diff < 60_000) return 'עכשיו';
  if (diff < 3_600_000) return `לפני ${Math.floor(diff / 60_000)} דק׳`;
  const d = new Date(ts);
  if (d.toDateString() === new Date(now).toDateString()) return hhmm(d);
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

// "לפני 5 דקות"
function ago(ts, now = Date.now()) {
  const min = Math.floor(Math.max(0, now - ts) / 60_000);
  if (min < 1) return 'לפני רגע';
  if (min < 60) return min === 1 ? 'לפני דקה' : `לפני ${min} דקות`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? 'לפני שעה' : hr === 2 ? 'לפני שעתיים' : `לפני ${hr} שעות`;
  const day = Math.floor(hr / 24);
  return day === 1 ? 'לפני יום' : day === 2 ? 'לפני יומיים' : `לפני ${day} ימים`;
}

const withTimeout = (p, ms, fallback) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(fallback), ms))]);

// ---------- מצב הסנכרון ----------
function syncParts(st) {
  const n = Math.max(0, Number(st?.pending) || 0);
  const waiting = n === 1 ? '1 ממתין' : `${n} ממתינים`;
  switch (st?.state) {
    case 'idle': return [st.lastSyncAt ? `מסונכרן לענן · ${ago(st.lastSyncAt)}` : 'עוד לא סונכרן', n ? ` · ${waiting}` : ''];
    case 'syncing': return ['מסנכרן...'];
    case 'offline': return [`אין חיבור. יסונכרן כשהרשת תחזור (${waiting})`];
    case 'error': {
      const msg = String(st.error || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'לא ידוע';
      return ['שגיאת סנכרון: ', h('bdi', {}, msg)];
    }
    case 'unavailable': return ['הענן לא זמין כרגע'];
    case 'signed-out': return ['לא מחובר לענן'];
    default: return ['—'];
  }
}

function readStatus() {
  try { return getStatus(); } catch { return null; }
}

// ---------- מילים ----------
// שלב = צליל תנועה אחד (1-6). תחנה = קבוצת מילים בתוך שלב, ממוספרת ברצף בכל הרשימה (1..N)
const levelName = (n) => levelInfo(n)?.name || '';
// שמות השלבים להורה, בלי ניקוד ובכתיב מלא (הסרת הניקוד מ-LEVELS הייתה נותנת "קבוץ", "שוא")
const PLAIN_STAGE = { 1: 'קמץ ופתח', 2: 'חיריק', 3: 'חולם', 4: 'שורוק וקובוץ', 5: 'צירה וסגול', 6: 'שווא' };
const plainName = (n) => PLAIN_STAGE[clampStage(n)] || levelName(n).replace(/[\u0591-\u05C7]/g, '');
const stageLabel = (n) => `שלב ${clampStage(n)} · ${levelInfo(n)?.sound || ''}`;
// מילים של ההורה מקבלות level = שלב ו-station = התחנה הראשונה של השלב
const allWords = (custom) => [
  ...BASE_WORDS,
  ...[...custom].filter((w) => w && w.id && w.text).map(placeCustom).sort((a, b) => String(a.id).localeCompare(String(b.id))),
];
const isRead = (stats, w) => (stats[w.id]?.correct || 0) > 0;
const clean = (t) => t.replace(/\s+/g, ' ').trim();
// "מילה אחת" / "3 מילים"
const many = (n, one, plural) => (n === 1 ? one : `${n} ${plural}`);

// מה זיהוי הדיבור שמע — לא יודעים בדיוק באיזה מבנה האפליקציה שומרת, אז אוספים כל מחרוזת
function heardList(t, out = new Set()) {
  if (typeof t === 'string') { if (t.trim()) out.add(t.trim()); }
  else if (Array.isArray(t)) t.forEach((x) => heardList(x, out));
  else if (t && typeof t === 'object') heardList(t.alternatives ?? t.transcript ?? t.text, out);
  return out;
}

// ---------- אזור הורים ----------
let current = null; // פתיחה פעילה — אם נפתח שוב בלי סגירה, מנקים את הקודמת

export async function openParent(container, { onClose, onSignedOut } = {}) {
  current?.dispose();

  const s = {
    settings: await getSettings(),
    saving: Promise.resolve(), // שרשרת שמירות — "חזרה לילד" מחכה לה
    tab: null,
    seq: 0,                    // מונע ציור של לשונית ישנה אחרי מעבר מהיר
    closed: false,
    closing: false,
    urls: new Set(),           // תמונות הגלריה
    fileUrls: new Set(),       // קובץ גיבוי שמחכה להורדה
    nameInput: null,
    nameTimer: 0,
    toastTimer: 0,
    overlay: null,             // סגירת תצוגת ציור מוגדלת
    loader: null,              // הורדת ציורים מהענן בלשונית הציורים
    syncOff: null,             // ביטול ההאזנה למצב הסנכרון
    syncTimer: 0,              // רענון "לפני X"
  };
  const stale = (token) => s.closed || token !== s.seq;

  // ---------- שלד ----------
  const backBtn = btn('חזרה לילד', 'back', 'primary', () => close());

  // שורת סנכרון מתחת לכותרת
  const syncText = h('span', { class: 'p-sync-text' });
  const syncBtn = h('button', { type: 'button', class: 'p-btn p-btn--ghost p-btn--sm' }, icon('sync', 18), h('span', { class: 'p-btn-label' }, 'סנכרן עכשיו'));
  const syncLine = h('div', { class: 'p-sync', 'data-state': 'none' },
    h('span', { class: 'p-sync-dot', 'aria-hidden': 'true' }), syncText, syncBtn);
  let manualSync = false;
  function renderSync(st = readStatus()) {
    if (s.closed) return;
    const state = st?.state || 'none';
    syncLine.dataset.state = state;
    syncText.replaceChildren(...syncParts(st).filter(Boolean));
    syncBtn.disabled = manualSync || state === 'syncing' || state === 'signed-out';
  }
  syncBtn.addEventListener('click', async () => {
    if (manualSync) return;
    manualSync = true;
    renderSync();
    let st = null;
    try { st = await syncNow(); } catch (err) { console.warn('syncNow', err); }
    manualSync = false;
    if (s.closed) return;
    renderSync();
    if ((st || readStatus())?.state === 'idle') {
      toast('סונכרן');
      // מה שהגיע מהענן: הגדרות עדכניות, ולשונית פתוחה נטענת מחדש (חוץ מהגדרות — שלא יימחק מה שמקלידים)
      try { s.settings = await getSettings(); } catch {}
      if (!s.closed && s.tab && s.tab !== 'settings') showTab(s.tab);
    }
  });
  const tabBtns = TABS.map((t) => h('button', {
    type: 'button', role: 'tab', id: `p-tab-${t.id}`, class: 'p-tab', 'aria-controls': 'p-panel',
    onclick: () => { if (s.tab !== t.id) showTab(t.id); },
  }, t.label));
  const tabList = h('div', { class: 'p-tabs', role: 'tablist', 'aria-label': 'אזור הורים' }, tabBtns);
  const body = h('div', { class: 'p-panel', id: 'p-panel', role: 'tabpanel' });
  const toastEl = h('div', { class: 'p-toast', role: 'status', 'aria-live': 'polite' });
  const wrap = h('div', { class: 'p-wrap' },
    h('header', { class: 'p-head' },
      h('div', { class: 'p-head-text' }, h('h1', { class: 'p-title' }, 'אזור הורים'), syncLine),
      backBtn),
    tabList, body, toastEl);
  container.replaceChildren(wrap);
  container.scrollTop = 0;

  renderSync();
  try { s.syncOff = onStatus((st) => renderSync(st)); } catch (err) { console.warn('onStatus', err); }
  s.syncTimer = setInterval(() => renderSync(), 30_000);

  // חצים בין הלשוניות (בעברית שמאלה = הבאה)
  tabList.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === s.tab);
    const step = { ArrowLeft: 1, ArrowRight: -1 }[e.key];
    let next = step ? (i + step + TABS.length) % TABS.length : null;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    showTab(TABS[next].id);
    tabBtns[next].focus();
  });

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(s.toastTimer);
    s.toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 1800);
  }

  // שומר רק את מה שההורה שינה, על גבי ההגדרות העדכניות במכשיר — שינוי שהסנכרון הביא בזמן שאזור ההורה פתוח
  // (למשל מהטלפון) לא נדרס בעותק הישן של הלשונית
  function persist(patch, message = 'נשמר') {
    s.settings = { ...s.settings, ...patch };
    const fallback = s.settings;
    s.saving = s.saving
      .then(async () => {
        let base = fallback;
        try { base = { ...(await getSettings()), ...patch }; } catch (err) { console.warn('getSettings', err); }
        await saveSettings(base);
      })
      .then(() => { if (message) toast(message); }, () => toast('השמירה נכשלה'));
    return s.saving;
  }

  // מחכה לשמירות, אבל לא לנצח — שמירה שנתקעה (IndexedDB) לא תשאיר את ההורה בלי דרך חזרה
  const saved = () => Promise.race([s.saving, new Promise((r) => setTimeout(r, 3000))]);

  function flushName() {
    clearTimeout(s.nameTimer); s.nameTimer = 0;
    const el = s.nameInput;
    if (!el || s.closed) return;
    const v = el.value.trim();
    if (v !== (s.settings.childName || '')) persist({ childName: v });
  }

  // מעבדת הקול רצה על המק בלבד (שרת מקומי + מודלים), לכן כאן רק הסבר וקישור
  function renderLab() {
    const onIpad = /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const cmd = h('code', { class: 'p-code', dir: 'ltr' }, LAB_CMD);
    const copy = h('button', { type: 'button', class: 'p-btn p-btn--ghost p-btn--sm' }, h('span', { class: 'p-btn-label' }, 'העתק פקודה'));
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(LAB_CMD); copy.lastChild.textContent = 'הועתק'; }
      catch { getSelection().selectAllChildren(cmd); }
    });
    const open = h('a', { class: 'p-btn p-btn--primary', href: LAB_URL, target: '_blank', rel: 'noopener' }, h('span', { class: 'p-btn-label' }, 'פתיחת המעבדה'));
    // הקלטות לניתוח: כמה נשארו, כמה בענן, הפעלה/כיבוי ומחיקה
    const left = Math.max(0, s.settings.analyzeLeft ?? 0);
    const cloudCount = h('span', { class: 'p-muted' }, 'בודק כמה הקלטות שמורות…');
    countRecordings().then((n) => { cloudCount.textContent = n == null ? 'לא ניתן לבדוק כרגע (צריך חיבור)' : `שמורות בענן: ${n}`; });
    const status = h('p', { class: 'p-row-label' }, left ? `פעיל: ${left} הניסיונות הבאים יוקלטו` : 'כבוי');
    const on = h('button', { type: 'button', class: 'p-btn p-btn--primary p-btn--sm' }, h('span', { class: 'p-btn-label' }, 'הקלט 30 ניסיונות'));
    const off = h('button', { type: 'button', class: 'p-btn p-btn--ghost p-btn--sm' }, h('span', { class: 'p-btn-label' }, 'כיבוי'));
    on.addEventListener('click', () => { persist({ analyzeLeft: 30 }, 'ההקלטה הופעלה'); status.textContent = 'פעיל: 30 הניסיונות הבאים יוקלטו'; });
    off.addEventListener('click', () => { persist({ analyzeLeft: 0 }, 'ההקלטה כובתה'); status.textContent = 'כבוי'; });
    const del = h('button', { type: 'button', class: 'p-btn p-btn--danger p-btn--sm' }, h('span', { class: 'p-btn-label' }, 'מחיקת כל ההקלטות'));
    twoStep(del, {
      confirm: h('span', { class: 'p-btn-label' }, 'למחוק את כל ההקלטות?'),
      onConfirm: async () => {
        const r = await deleteAllRecordings();
        if (!r.ok) throw new Error('delete');
        toast(`נמחקו ${r.count} הקלטות`);
        cloudCount.textContent = 'שמורות בענן: 0';
      },
      onError: () => toast('המחיקה נכשלה'),
    });
    const rec = card('הקלטות לניתוח זיהוי הדיבור',
      note('כשפעיל, כל ניסיון קריאה נשמר בענן (bucket פרטי, רק אתה רואה): הקול, מה הזיהוי שמע, ציר הזמן ועוצמת הקול. ככה אפשר להבין למה מילה לא זוהתה. נכבה לבד אחרי המספר שנבחר.'),
      status, cloudCount, h('div', { class: 'p-row' }, on, off), del);

    return [rec, card('מעבדת קול',
      note('משווים מנועי הקראה וזיהוי דיבור על הקול של הילד: הוא קורא מילה, אתה מסמן אם קרא נכון, והמעבדה מראה איזה מנוע צדק.'),
      onIpad ? note('המעבדה רצה על המק בלבד (שרת מקומי ומודלים). פתח אותה מהמק.', 'error') : null,
      h('p', { class: 'p-muted' }, '1. בטרמינל במק:'),
      cmd, copy,
      h('p', { class: 'p-muted' }, '2. ב-Safari במק (אותו מנוע זיהוי של אפל כמו באייפד):'),
      onIpad ? h('code', { class: 'p-code', dir: 'ltr' }, LAB_URL) : open)];
  }

  const RENDER = { progress: renderProgress, words: renderWords, drawings: renderDrawings, settings: renderSettings, lab: renderLab };

  async function showTab(id) {
    const token = ++s.seq;
    const switching = id !== s.tab;
    s.tab = id;
    flushName(); s.nameInput = null;
    s.overlay?.();
    s.loader?.stop(); s.loader = null;
    stopListening();
    const oldUrls = [...s.urls]; s.urls.clear();
    tabBtns.forEach((b, i) => {
      const on = TABS[i].id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    body.setAttribute('aria-labelledby', `p-tab-${id}`);
    if (switching) { body.replaceChildren(); container.scrollTop = 0; }
    try {
      const view = await RENDER[id](token);
      if (!stale(token) && view) body.replaceChildren(...[view].flat());
    } catch (err) {
      console.error(err);
      if (!stale(token)) body.replaceChildren(card(null, note('משהו השתבש בטעינה. אפשר לצאת ולהיכנס שוב.', 'error')));
    }
    oldUrls.forEach((u) => URL.revokeObjectURL(u));
  }

  async function close() {
    if (s.closed || s.closing) return;
    s.closing = true;
    backBtn.disabled = true;
    flushName();
    try { await saved(); } catch {}
    dispose();
    onClose?.();
  }

  function dispose() {
    if (s.closed) return;
    flushName();
    s.closed = true;
    s.seq++;
    s.overlay?.();
    s.loader?.stop(); s.loader = null;
    try { s.syncOff?.(); } catch {}
    s.syncOff = null;
    clearInterval(s.syncTimer);
    stopListening();
    try { window.speechSynthesis?.cancel(); } catch {}
    for (const u of [...s.urls, ...s.fileUrls]) URL.revokeObjectURL(u);
    s.urls.clear(); s.fileUrls.clear();
    clearTimeout(s.toastTimer);
    toastEl.classList.remove('is-on');
    if (current === self) current = null;
  }
  const self = { dispose };
  current = self;

  // ---------- לשונית: התקדמות ----------
  async function renderProgress(token) {
    const [stats, attempts, custom] = await Promise.all([getAllStats(), listAttempts(1000), listCustomWords()]);
    if (stale(token)) return null;
    const words = allWords(custom);
    const byId = new Map(words.map((w) => [w.id, w]));
    const station = stationFromSettings(s.settings);
    const stage = stageOfStation(station);
    const stationsInStage = levelInfo(stage)?.stations?.length || 1;
    const prog = stationProgress(words, stats, station); // { count, mastered, needed } — needed = 80% מהתחנה
    const last = station === lastStation();
    const read = (w) => isRead(stats, w);
    const scope = words.filter((w) => w.station <= station);
    const readScope = scope.filter(read).length;
    const solo = attempts.filter((a) => a.outcome === 'solo').length;
    const t0 = startOfDay();
    const today = attempts.filter((a) => a.ts >= t0);

    const tiles = h('div', { class: 'p-tiles' },
      tile('שלב', stage, [
        word(levelName(stage), 'p-word--xs'),
        `תחנה ${stationInfo(station).n} מתוך ${stationsInStage}${last ? ' (אחרונה)' : ''}`,
        last ? `נקראו ${prog.mastered} מתוך ${prog.count} בתחנה` : `נקראו ${prog.mastered} מתוך ${prog.needed} הדרושות למעבר`,
      ], prog.needed ? prog.mastered / prog.needed : 0),
      tile('מילים שנקראו', readScope, [`מתוך ${scope.length} עד התחנה הנוכחית`], scope.length ? readScope / scope.length : 0),
      tile('קרא לבד', attempts.length ? `${Math.round((solo / attempts.length) * 100)}%` : '—',
        [attempts.length ? `${solo} מתוך ${many(attempts.length, 'מילה אחת', 'מילים')}` : 'עוד אין נתונים']),
      tile('היום', today.length,
        [today.length ? `${today.filter((a) => a.outcome !== 'skipped').length} נקראו נכון` : 'עוד לא קרא היום']));

    if (!attempts.length && !Object.keys(stats).length) {
      const who = (s.settings.childName || '').trim() || 'הילד';
      return [tiles, card(null, empty(`עוד אין פעילות. אחרי ש${who} יקרא כמה מילים, ההתקדמות תופיע כאן.`))];
    }

    const review = words.filter((w) => stats[w.id]?.lastOutcome === 'skipped');
    const reviewCard = card(review.length ? `מילים לחזרה (${review.length})` : 'מילים לחזרה',
      review.length
        ? [hint('בפעם האחרונה לא הצליח לקרוא אותן'),
          h('div', { class: 'p-chips' }, review.map((w) => h('span', { class: 'p-wchip' }, pic(w.pic), word(w.text))))]
        : empty('אין מילים לחזרה כרגע'));

    const rows = attempts.slice(0, 40).map((a) => {
      const w = byId.get(a.wordId);
      const heard = [...heardList(a.transcripts)];
      const d = new Date(a.ts);
      return h('tr', {},
        h('td', { class: 'p-td-word' }, w
          ? h('span', { class: 'p-cell-word' }, pic(w.pic), word(w.text, 'p-word--sm'))
          : h('span', { class: 'p-muted', dir: 'ltr' }, String(a.wordId))),
        h('td', {}, status(a.outcome)),
        h('td', { class: 'p-num' }, a.attempts ?? '—'),
        h('td', { class: 'p-heard-cell' }, heard.length ? heard.join(' · ') : '—'),
        h('td', { class: 'p-when', title: `${dateStr(d)} ${hhmm(d)}` }, when(a.ts)));
    });
    const table = h('div', { class: 'p-table-wrap' },
      h('table', { class: 'p-table' },
        h('thead', {}, h('tr', {}, ['מילה', 'תוצאה', 'ניסיונות', 'מה נשמע', 'מתי'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows)));

    return [tiles, reviewCard, card('פעילות אחרונה', attempts.length ? table : empty('עוד אין קריאות'))];
  }

  // ---------- לשונית: מילים ----------
  // 500 מילים ויותר: קבוצה נפתחת לכל שלב (השלב הנוכחי פתוח), ובתוכה התחנות.
  // שלב סגור לא נבנה עד שפותחים אותו, וחיפוש מציג רק את המילים שנמצאו
  async function renderWords(token) {
    const [custom, stats] = await Promise.all([listCustomWords(), getAllStats()]);
    if (stale(token)) return null;
    const browser = wordBrowser(custom, stats);
    return [wordForm(browser.refresh), browser.el];
  }

  function wordBrowser(custom0, stats0) {
    const cur = stationFromSettings(s.settings);
    const curStage = stageOfStation(cur);
    const opened = new Set([curStage]); // נשמר גם כשהרשימה נבנית מחדש (אחרי הוספה / מחיקה)
    let data = null;
    let query = '';
    let timer = 0;

    const count = h('span', { class: 'p-count' });
    const search = h('input', {
      type: 'search', class: 'p-input p-input--search', dir: 'rtl', lang: 'he',
      placeholder: 'חיפוש מילה (עם או בלי ניקוד)', 'aria-label': 'חיפוש מילה',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    });
    const stagesEl = h('div', { class: 'p-stages' });
    const results = h('div', { class: 'p-results', hidden: true });
    const el = h('section', { class: 'p-card' },
      h('div', { class: 'p-h2-row' }, h('h2', { class: 'p-h2' }, 'כל המילים'), count),
      h('label', { class: 'p-search' }, icon('search', 20), search),
      results, stagesEl);

    function load(custom, stats) {
      const words = allWords(custom);
      const byStation = new Map();
      for (const w of words) {
        if (!byStation.has(w.station)) byStation.set(w.station, []);
        byStation.get(w.station).push(w);
      }
      data = { words, byStation, stats: stats || {}, keys: new Map(words.map((w) => [w.id, searchKey(w.text)])) };
      const added = words.length - BASE_WORDS.length;
      count.textContent = `${words.length} מילים${added ? ` · ${added} שהוספתם` : ''}`;
    }

    const chips = (ws) => h('div', { class: 'p-chips' }, ws.map((w) => wordChip(w, data.stats[w.id], refresh)));

    function stationBlock(i) {
      const ws = data.byStation.get(i) || [];
      const p = stationProgress(ws, data.stats, i);
      const here = i === cur;
      return h('section', { class: `p-station${here ? ' is-current' : ''}` },
        h('h4', { class: 'p-station-head' },
          h('span', {}, `תחנה ${stationInfo(i).n}`),
          here ? h('span', { class: 'p-badge' }, 'נוכחית') : null,
          p.done ? h('span', { class: 'p-badge p-badge--done', title: '80% מהמילים נקראו נכון' }, '✓ עבר') : null,
          h('span', { class: 'p-level-count' }, `נקראו ${p.mastered} מתוך ${p.count}`)),
        ws.length ? chips(ws) : empty('אין מילים בתחנה הזו'));
    }

    function stageSection(l) {
      const ids = l.stations || [];
      const ws = ids.flatMap((i) => data.byStation.get(i) || []);
      const read = ws.filter((w) => isRead(data.stats, w)).length;
      const here = l.id === curStage;
      const bodyEl = h('div', { class: 'p-stage-body' });
      const d = h('details', { class: `p-stage${here ? ' is-current' : ''}` },
        h('summary', { class: 'p-stage-head' },
          h('span', { class: 'p-stage-title' }, `שלב ${l.id} · `, word(l.sound, 'p-word--xs'), ' ', word(l.name, 'p-word--xs')),
          here ? h('span', { class: 'p-badge' }, 'נוכחי') : null,
          h('span', { class: 'p-level-count' },
            `${many(ids.length, 'תחנה אחת', 'תחנות')} · ${many(ws.length, 'מילה אחת', 'מילים')} · נקראו ${read}`),
          icon('chevron', 18)),
        bodyEl);
      const fill = () => { if (!bodyEl.childElementCount) bodyEl.append(...ids.map(stationBlock)); };
      if (opened.has(l.id)) { d.open = true; fill(); }
      d.addEventListener('toggle', () => {
        if (d.open) { opened.add(l.id); fill(); } else opened.delete(l.id);
      });
      return d;
    }

    function renderResults() {
      const q = searchKey(query);
      stagesEl.hidden = !!q;
      results.hidden = !q;
      if (!q) { results.replaceChildren(); return; }
      const hits = data.words.filter((w) => data.keys.get(w.id).includes(q));
      if (!hits.length) { results.replaceChildren(empty('לא נמצאו מילים')); return; }
      const groups = new Map(); // תחנה → מילים, לפי סדר התחנות
      for (const w of hits) {
        if (!groups.has(w.station)) groups.set(w.station, []);
        groups.get(w.station).push(w);
      }
      results.replaceChildren(
        h('p', { class: 'p-hint' }, hits.length === 1 ? 'נמצאה מילה אחת' : `נמצאו ${hits.length} מילים`),
        ...[...groups.entries()].sort((a, b) => a[0] - b[0]).map(([i, ws]) => {
          const st = stationInfo(i);
          return h('section', { class: `p-station${i === cur ? ' is-current' : ''}` },
            h('h4', { class: 'p-station-head' },
              h('span', {}, `שלב ${st.stage} · `, word(levelInfo(st.stage).sound, 'p-word--xs'), ` · תחנה ${st.n}`),
              i === cur ? h('span', { class: 'p-badge' }, 'נוכחית') : null),
            chips(ws));
        }));
    }

    function build() {
      stagesEl.replaceChildren(...LEVELS.map(stageSection));
      renderResults();
    }

    async function refresh() {
      const [c, st] = await Promise.all([listCustomWords(), getAllStats()]);
      if (s.closed || !el.isConnected) return;
      load(c, st);
      build();
    }

    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { query = search.value; if (data) renderResults(); }, 120);
    });
    search.addEventListener('search', () => { clearTimeout(timer); query = search.value; renderResults(); });

    load(custom0, stats0);
    build();
    return { el, refresh };
  }

  function wordChip(w, st, onChange) {
    const seen = st?.seen || 0;
    const correct = st?.correct || 0;
    const chip = h('span', { class: `p-wchip${w.custom ? ' p-wchip--custom' : ''}` },
      pic(w.pic), word(w.text),
      h('span', { class: `p-stat${seen ? '' : ' is-new'}`, title: `נקראה נכון ${correct} מתוך ${seen} פעמים` }, `✓${correct}/${seen}`));
    if (w.custom) {
      const del = h('button', { type: 'button', class: 'p-del', 'aria-label': `מחיקת ${w.text}` }, icon('trash', 20));
      twoStep(del, {
        confirm: 'למחוק?',
        onConfirm: async () => { await deleteCustomWord(w.id); toast('נמחקה'); await onChange(); },
        onError: () => toast('המחיקה נכשלה'),
      });
      chip.append(del);
    }
    return chip;
  }

  function wordForm(onAdded) {
    const input = h('input', {
      id: 'pw-text', type: 'text', dir: 'rtl', lang: 'he', class: 'p-input p-input--word',
      placeholder: 'למשל: נֹעַם', autocomplete: 'off', autocorrect: 'off',
      autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-describedby': 'pw-msg',
    });
    const picIn = h('input', { id: 'pw-pic', type: 'text', class: 'p-input p-input--pic', maxLength: 8, autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
    // השלב נקבע לבד לפי הניקוד שמקלידים, עד שההורה בוחר שלב בעצמו
    const childStage = () => stageOfStation(stationFromSettings(s.settings));
    const autoStage = (t) => (HAS_NIKUD.test(t) ? clampStage(stageOfText(t)) : childStage());
    const levelSel = mkSelect('pw-level', LEVELS.map((l) => [l.id, `${stageLabel(l.id)} · ${plainName(l.id)}`]), childStage());
    const levelHint = h('p', { class: 'p-hint', id: 'pw-level-hint' });
    let levelTouched = false;
    const syncStage = () => {
      if (!levelTouched) levelSel.value = String(autoStage(clean(input.value)));
      levelHint.textContent = levelTouched ? 'נבחר ידנית' : 'נקבע לבד לפי הניקוד. אפשר לשנות';
    };
    levelSel.setAttribute('aria-describedby', 'pw-level-hint');
    levelSel.addEventListener('change', () => { levelTouched = true; syncStage(); });
    const preview = h('div', { class: 'p-preview', 'aria-hidden': 'true' });
    const msg = h('p', { id: 'pw-msg', class: 'p-msg', 'aria-live': 'polite' });
    const addLabel = h('span', { class: 'p-btn-label' }, 'הוסף מילה');
    const addBtn = h('button', { type: 'submit', class: 'p-btn p-btn--primary' }, icon('plus'), addLabel);
    const sayBtn = btn('השמע', 'speaker', 'ghost', () => {
      const t = clean(input.value);
      if (!HEB_LETTER.test(t)) return setMsg('כתבו מילה קודם', 'error');
      if (!canSpeak()) return setMsg('הדפדפן לא תומך בהקראה', 'error');
      say(t, s.settings.speechRate);
    });
    let warned = null; // הטקסט שעליו כבר הזהרנו "אין ניקוד"
    let busy = false;

    const setMsg = (text, kind = 'info') => { msg.className = `p-msg p-msg--${kind}`; msg.textContent = text; };
    const setWarned = (t) => { warned = t; addLabel.textContent = t ? 'הוסף בכל זאת' : 'הוסף מילה'; };
    const drawPreview = () => {
      const t = input.value.trim();
      const p = pic(picIn.value.trim());
      preview.replaceChildren(t ? word(t, 'p-word--xl') : h('span', { class: 'p-preview-empty' }, 'כאן תופיע המילה'));
      if (p) preview.append(p);
    };
    const changed = () => {
      drawPreview();
      syncStage();
      if (warned !== null && warned !== clean(input.value)) setWarned(null);
      setMsg('');
    };
    input.addEventListener('input', changed);
    picIn.addEventListener('input', drawPreview);

    // מכניס טקסט במקום הסמן בלי לאבד פוקוס (המקלדת של האייפד נשארת פתוחה)
    const edit = (fn) => {
      const end = input.value.length;
      const a = input.selectionStart ?? end;
      const b = input.selectionEnd ?? end;
      if (document.activeElement !== input) input.focus({ preventScroll: true });
      fn(a, b);
      changed();
    };
    const insert = (mark) => edit((a, b) => input.setRangeText(mark, a, b, 'end'));
    const erase = () => edit((a, b) => {
      if (a !== b) input.setRangeText('', a, b, 'end');
      else if (a > 0) input.setRangeText('', a - 1, a, 'end');
    });
    const key = (face, name, act) => {
      const k = h('button', { type: 'button', class: 'p-key', 'aria-label': name }, face, h('span', { class: 'p-key-name', 'aria-hidden': 'true' }, name));
      // preventDefault ב-pointerdown שומר את הפוקוס בשדה. הסימן נכנס רק בהרמה —
      // גלילה שמתחילה על המקלדת מבטלת (pointercancel) ולא מכניסה ניקוד או פותחת מקלדת
      let down = null;
      const off = () => { down = null; };
      k.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); down = e.pointerId; });
      k.addEventListener('pointerup', (e) => { if (down !== e.pointerId) return; down = null; act(); });
      k.addEventListener('pointercancel', off);
      k.addEventListener('pointerleave', off);
      k.addEventListener('mousedown', (e) => e.preventDefault());
      k.addEventListener('click', (e) => { if (e.detail === 0) act(); }); // מקלדת פיזית (Enter/רווח)
      return k;
    };
    const keys = h('div', { class: 'p-keys', role: 'group', 'aria-labelledby': 'pw-keys-label' },
      MARKS.map(([mark, name]) => key(h('span', { class: 'p-key-mark', lang: 'he' }, '◌' + mark), name, () => insert(mark))),
      key(icon('backspace', 26), 'מחיקה', erase));

    const form = h('form', { class: 'p-card p-form', novalidate: true, autocomplete: 'off' },
      h('h2', { class: 'p-h2' }, 'הוספת מילה'),
      h('div', { class: 'p-form-top' },
        h('div', { class: 'p-field' }, h('label', { class: 'p-label', for: 'pw-text' }, 'מילה'), input),
        h('div', { class: 'p-field' }, h('span', { class: 'p-label' }, 'תצוגה'), preview)),
      h('div', { class: 'p-field' },
        h('span', { class: 'p-label', id: 'pw-keys-label' }, 'ניקוד'),
        keys,
        hint('כותבים אות ואז נוגעים בסימן הניקוד שלה')),
      h('div', { class: 'p-form-opts' },
        h('div', { class: 'p-field' }, h('label', { class: 'p-label', for: 'pw-pic' }, 'תמונה (אימוג׳י, לא חובה)'), picIn),
        h('div', { class: 'p-field' }, h('label', { class: 'p-label', for: 'pw-level' }, 'שלב'), selectBox(levelSel), levelHint)),
      msg,
      h('div', { class: 'p-actions' }, addBtn, sayBtn));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const text = clean(input.value).normalize('NFC'); // אותו סדר סימנים כמו ברשימת המילים
      if (!HEB_LETTER.test(text)) return setMsg('צריך לפחות אות עברית אחת', 'error');
      if (!ALLOWED.test(text)) return setMsg('אפשר רק אותיות עבריות וניקוד', 'error');
      if (ORPHAN_MARK.test(text)) return setMsg('יש סימן ניקוד בלי אות לפניו', 'error');
      busy = true;
      try {
        const existing = allWords(await listCustomWords());
        if (existing.some((w) => String(w.text).normalize('NFC') === text)) return setMsg('המילה כבר ברשימה', 'error');
        if (!HAS_NIKUD.test(text) && warned !== text) {
          setWarned(text);
          return setMsg('אין ניקוד. מומלץ להוסיף', 'warn');
        }
        const stage = clampStage(levelSel.value);
        await addCustomWord({ text, pic: picIn.value.trim(), level: stage });
        input.value = '';
        picIn.value = '';
        levelTouched = false;
        setWarned(null);
        changed();
        toast(`נוספה לשלב ${stage}`);
        await onAdded();
      } catch (err) {
        console.error(err);
        setMsg('ההוספה נכשלה. נסו שוב', 'error');
      } finally {
        busy = false;
      }
    });

    drawPreview();
    syncStage();
    return form;
  }

  // ---------- לשונית: ציורים ----------
  // תור הורדות מהענן: מתחיל כשהציור מתקרב למסך, עד DRAW_LOADS במקביל
  function blobLoader(token) {
    const queue = [];
    const waiting = new Map(); // אלמנט → הורדה שמחכה שיגיע למסך
    let active = 0;
    let stopped = false;
    const pump = () => {
      while (!stopped && !stale(token) && active < DRAW_LOADS && queue.length) {
        const job = queue.shift();
        active++;
        Promise.resolve().then(job).catch((err) => console.warn('drawing', err))
          .finally(() => { active--; pump(); });
      }
    };
    const run = (job) => { if (!stopped) { queue.push(job); pump(); } };
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || !waiting.has(e.target)) continue;
          const job = waiting.get(e.target);
          waiting.delete(e.target);
          io.unobserve(e.target);
          run(job);
        }
      }, { root: container, rootMargin: '300px 0px' }) // אזור ההורה הוא זה שנגלל — אחרת המרווח לא פועל
      : null;
    return {
      watch(el, job) { if (io) { waiting.set(el, job); io.observe(el); } else run(job); },
      run,
      stop() { stopped = true; io?.disconnect(); waiting.clear(); queue.length = 0; },
    };
  }

  async function renderDrawings(token) {
    // ציור מקומי (blob), או ציור שנמצא רק בענן (blob ריק, remote) — יורד כשמגיעים אליו
    const rows = (await listDrawings()).filter((d) => d && (d.blob instanceof Blob || d.remote));
    if (stale(token)) return null;
    if (!rows.length) return card('ציורים שמורים', empty('עוד אין ציורים. ציורים שהילד שומר יופיעו כאן.'));

    const title = h('h2', { class: 'p-h2' });
    const grid = h('div', { class: 'p-gallery' });
    const recount = () => { title.textContent = `ציורים שמורים (${grid.children.length})`; };
    const loader = blobLoader(token);
    s.loader = loader;

    for (const d of rows) {
      const dt = new Date(d.ts);
      const cap = `${dateStr(dt)} · ${hhmm(dt)}`;
      const page = PAGES.find((p) => p.id === d.pageId);
      const img = h('img', { alt: '', decoding: 'async' });
      const thumb = h('button', { type: 'button', class: 'p-thumb', 'aria-label': `הגדלת הציור מ-${cap}` }, img);
      let url = null;
      let ph = null;
      let loading = false;

      const setBlob = (blob) => {
        url = URL.createObjectURL(blob);
        s.urls.add(url);
        img.src = url;
        img.hidden = false;
        ph?.remove(); ph = null;
        thumb.classList.remove('is-cloud', 'is-loading', 'is-failed');
        thumb.setAttribute('aria-label', `הגדלת הציור מ-${cap}`);
      };
      const setPh = (mode) => { // loading | failed | waiting
        if (!ph) {
          ph = h('span', { class: 'p-thumb-ph' }, icon('cloud', 30), h('span', { class: 'p-thumb-ph-text' }));
          thumb.append(ph);
        }
        img.hidden = true;
        thumb.classList.add('is-cloud');
        thumb.classList.toggle('is-loading', mode === 'loading');
        thumb.classList.toggle('is-failed', mode === 'failed');
        const text = mode === 'loading' ? 'טוען מהענן...'
          : mode === 'failed' ? (navigator.onLine === false ? 'יוצג כשיהיה חיבור' : 'לא נטען. נגיעה לניסיון נוסף')
            : 'שמור בענן';
        ph.lastChild.textContent = text;
        thumb.setAttribute('aria-label', `ציור מ-${cap}: ${text}`);
      };
      const load = async () => {
        if (loading || url || stale(token)) return;
        loading = true;
        setPh('loading');
        let blob = null;
        try { blob = await withTimeout(fetchDrawingBlob(d), CLOUD_MS, null); } catch (err) { console.warn('fetchDrawingBlob', err); }
        loading = false;
        if (stale(token)) return;
        if (blob instanceof Blob) setBlob(blob); else setPh('failed');
      };

      if (d.blob instanceof Blob) {
        img.setAttribute('loading', 'lazy');
        setBlob(d.blob);
      } else {
        setPh('waiting');
        loader.watch(thumb, load);
      }
      thumb.addEventListener('click', () => {
        if (url) openOverlay(url, cap, page, thumb);
        else if (!loading) loader.run(load);
      });

      const del = h('button', { type: 'button', class: 'p-del', 'aria-label': 'מחיקת הציור' }, icon('trash', 20));
      const fig = h('figure', { class: 'p-draw' }, thumb,
        h('figcaption', { class: 'p-draw-meta' },
          h('span', { class: 'p-draw-text' }, page ? word(page.name, 'p-word--xs') : null, h('span', { class: 'p-muted' }, cap)),
          del));
      twoStep(del, {
        confirm: 'למחוק?',
        onConfirm: async () => {
          await deleteDrawing(d.id ?? d.uuid);
          fig.remove();
          if (url) { URL.revokeObjectURL(url); s.urls.delete(url); }
          toast('נמחק');
          if (grid.children.length) recount(); else showTab('drawings');
        },
        onError: () => toast('המחיקה נכשלה'),
      });
      grid.append(fig);
    }
    recount();
    return h('section', { class: 'p-card' }, title, grid);
  }

  function openOverlay(url, cap, page, opener) {
    s.overlay?.();
    const closeBtn = btn('סגירה', 'close', 'ghost');
    const stage = h('div', { class: 'p-overlay-stage' }, h('img', { class: 'p-overlay-img', src: url, alt: 'ציור' }));
    const ov = h('div', { class: 'p-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ציור' },
      h('div', { class: 'p-overlay-bar' },
        h('span', { class: 'p-draw-text' }, page ? word(page.name, 'p-word--sm') : null, h('span', { class: 'p-muted' }, cap)),
        closeBtn),
      stage);
    const onKey = (e) => { if (e.key === 'Escape') shut(); };
    const shut = () => {
      ov.remove();
      document.removeEventListener('keydown', onKey);
      s.overlay = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    closeBtn.addEventListener('click', shut);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target === stage) shut(); });
    document.addEventListener('keydown', onKey);
    s.overlay = shut;
    wrap.append(ov);
    closeBtn.focus({ preventScroll: true });
  }

  // ---------- לשונית: הגדרות ----------
  function renderSettings() {
    const cur = s.settings;
    const row = (id, label, control, help, extra) => h('div', { class: 'p-row' },
      h('div', { class: 'p-row-text' },
        id ? h('label', { class: 'p-row-label', for: id }, label) : h('span', { class: 'p-row-label' }, label),
        hint(help)),
      control ? h('div', { class: 'p-row-ctl' }, control) : null,
      extra || null);

    // הילד
    const name = h('input', { id: 'ps-name', type: 'text', class: 'p-input p-input--name', value: cur.childName || '', placeholder: 'לא חובה', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', maxLength: 40 });
    s.nameInput = name;
    name.addEventListener('input', () => { clearTimeout(s.nameTimer); s.nameTimer = setTimeout(flushName, 600); });
    name.addEventListener('change', flushName);

    // משחק
    const trace = h('input', { id: 'ps-trace', type: 'checkbox', role: 'switch', class: 'p-switch-input', checked: !!cur.requireTrace });
    trace.addEventListener('change', () => persist({ requireTrace: trace.checked }));
    const reward = mkSelect('ps-reward', [3, 5, 7, 10].map((n) => [n, String(n)]), cur.wordsPerReward);
    reward.addEventListener('change', () => persist({ wordsPerReward: Number(reward.value) }));
    const tries = mkSelect('ps-tries', [1, 2, 3].map((n) => [n, String(n)]), cur.attemptsBeforeNext);
    tries.addEventListener('change', () => persist({ attemptsBeforeNext: Number(tries.value) }));
    // התחנה של הילד, מקובצת לפי שלב: "שלב 2 · אִ — תחנה 1 (32 מילים)"
    const station = h('select', { id: 'ps-station' },
      LEVELS.map((l) => h('optgroup', { label: `${stageLabel(l.id)} · ${plainName(l.id)}` },
        (l.stations || []).map((i) => {
          const st = stationInfo(i);
          return h('option', { value: String(i) }, `${stageLabel(l.id)} — תחנה ${st.n} (${many(st.count, 'מילה אחת', 'מילים')})`);
        }))));
    station.value = String(stationFromSettings(cur));
    station.addEventListener('change', () => {
      const v = clampStation(station.value);
      persist({ station: v, level: stageOfStation(v) });
    });

    // דיבור
    const leniency = h('fieldset', { class: 'p-radios' },
      h('legend', { class: 'p-row-label' }, 'סלחנות בזיהוי דיבור'),
      LENIENCY.map((o) => {
        const r = h('input', { type: 'radio', name: 'ps-leniency', value: o.id, checked: cur.leniency === o.id });
        r.addEventListener('change', () => { if (r.checked) persist({ leniency: o.id }); });
        return h('label', { class: 'p-radio' }, r, h('span', { class: 'p-radio-text' }, h('strong', {}, o.name), h('span', { class: 'p-hint' }, o.hint)));
      }));

    const fmtRate = (v) => Number(v).toFixed(2);
    const rate = h('input', { id: 'ps-rate', type: 'range', class: 'p-range', min: '0.5', max: '1.1', step: '0.05', value: String(cur.speechRate ?? 0.75) });
    const rateOut = h('output', { class: 'p-rate-out', for: 'ps-rate', dir: 'ltr' }, fmtRate(rate.value));
    rate.addEventListener('input', () => { rateOut.textContent = fmtRate(rate.value); });
    rate.addEventListener('change', () => persist({ speechRate: Number(rate.value) }));
    const rateTest = btn('בדיקה', 'speaker', 'ghost', () => say(TEST_WORD, Number(rate.value)));
    const voiceNote = !canSpeak() ? 'הדפדפן לא תומך בהקראה'
      : !hasHebrewVoice() ? 'לא נמצא במכשיר קול בעברית. ההקראה עלולה להישמע לא טוב' : null;

    const micOut = h('div', { class: 'p-mic-out', 'aria-live': 'polite' });
    const micBtn = btn('בדיקה', 'mic', 'mic');
    const micLabel = micBtn.querySelector('.p-btn-label');
    let listening = false;
    if (!canListen) {
      micBtn.disabled = true;
      micOut.replaceChildren(note(MIC_ERRORS.unsupported, 'error'));
    }
    micBtn.addEventListener('click', async () => {
      if (listening) { stopListening(); return; } // נגיעה שנייה עוצרת
      listening = true;
      micBtn.classList.add('is-live');
      micBtn.setAttribute('aria-pressed', 'true');
      micLabel.textContent = 'מקשיב...';
      micOut.replaceChildren(hint('אמרו מילה אחת, למשל "אבא"'));
      const res = await listen({
        maxMs: 5000,
        onInterim: (t) => { if (t && !s.closed) micOut.replaceChildren(h('p', { class: 'p-mic-live' }, t)); },
      });
      listening = false;
      micBtn.classList.remove('is-live');
      micBtn.removeAttribute('aria-pressed');
      micLabel.textContent = 'בדיקה';
      if (s.closed) return;
      if (res.alternatives?.length) {
        micOut.replaceChildren(
          h('p', { class: 'p-row-label' }, 'נשמע:'),
          h('div', { class: 'p-chips' }, res.alternatives.map((a) => h('span', { class: 'p-heard' }, a))));
      } else {
        micOut.replaceChildren(note(MIC_ERRORS[res.error] || `שגיאה: ${res.error}`, 'error'));
      }
    });

    // גיבוי
    const backupMsg = h('div', { class: 'p-backup-msg', 'aria-live': 'polite' });
    const setBackup = (...kids) => backupMsg.replaceChildren(...kids.filter(Boolean));
    const dlBtn = btn('הורדת גיבוי', 'download', 'ghost', async () => {
      dlBtn.disabled = true;
      setBackup(hint('מכין קובץ...'));
      try {
        flushName();
        await saved();
        const data = await exportAll();
        if (s.closed) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        s.fileUrls.add(url);
        const fileName = `otiyot-backup-${isoDay(new Date())}.json`;
        const auto = h('a', { href: url, download: fileName, hidden: true });
        wrap.append(auto); auto.click(); auto.remove();
        // קישור גלוי למקרה שהדפדפן לא התחיל הורדה לבד
        const link = h('a', { href: url, download: fileName, class: 'p-link' }, 'הורדת הקובץ');
        setBackup(h('p', { class: 'p-hint' }, 'הקובץ מוכן. אם ההורדה לא התחילה: ', link));
        setTimeout(() => {
          URL.revokeObjectURL(url); s.fileUrls.delete(url);
          if (link.isConnected) setBackup();
        }, 120_000);
      } catch (err) {
        console.error(err);
        setBackup(note('לא הצלחתי להכין גיבוי', 'error'));
      } finally {
        dlBtn.disabled = false;
      }
    });

    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    const upBtn = btn('שחזור מגיבוי', 'upload', 'ghost', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = ''; // כדי שאפשר יהיה לבחור שוב את אותו קובץ
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { return setBackup(note('הקובץ לא תקין', 'error')); }
      if (!data || data.app !== 'otiyot') return setBackup(note('זה לא קובץ גיבוי של האפליקציה', 'error'));

      // שלב אישור: מה יש בקובץ, ושהשחזור מחליף את מה שיש עכשיו
      const from = data.exportedAt && !isNaN(new Date(data.exportedAt)) ? ` מ-${dateStr(new Date(data.exportedAt))}` : '';
      const n = (x) => (Array.isArray(x) ? x.length : 0);
      const go = h('button', { type: 'button', class: 'p-btn p-btn--danger-solid' }, h('span', { class: 'p-btn-label' }, 'שחזור'));
      const cancel = btn('ביטול', null, 'ghost', () => setBackup());
      setBackup(h('div', { class: 'p-confirm' },
        h('p', { class: 'p-confirm-text' }, `גיבוי${from}: ${many(n(data.words), 'מילה אחת', 'מילים')} שהוספתם, ${many(n(data.attempts), 'קריאה אחת', 'קריאות')}, ${many(n(data.drawings), 'ציור אחד', 'ציורים')}.`),
        h('p', { class: 'p-hint' }, 'השחזור מחליף את ההגדרות, המילים וההתקדמות — במכשיר ובענן. ציורים מהקובץ מתווספים לקיימים.'),
        h('div', { class: 'p-actions' }, go, cancel)));
      go.addEventListener('click', async () => {
        go.disabled = true; cancel.disabled = true;
        go.firstChild.textContent = 'משחזר...';
        try {
          flushName();
          await saved();
          await importAll(data);
          // השדה הישן של השם לא ידרוס את השם ששוחזר כשהלשונית נטענת מחדש
          clearTimeout(s.nameTimer); s.nameInput = null;
          s.settings = await getSettings();
          toast('שוחזר');
          showTab('settings');
        } catch (err) {
          console.error(err);
          try { s.settings = await getSettings(); } catch {} // ייתכן שחלק מהגיבוי כבר נכתב
          const m = err?.message && HEB_LETTER.test(err.message) ? err.message : 'השחזור נכשל';
          setBackup(note(m, 'error'));
        }
      });
    });

    // מצב האחסון
    const storageLine = h('p', { class: 'p-storage' });
    (async () => {
      let ok = false;
      try { ok = !!(await navigator.storage?.persisted?.()); } catch {}
      const standalone = navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)')?.matches;
      if (s.closed) return;
      storageLine.classList.toggle('is-ok', ok || standalone);
      storageLine.replaceChildren(icon(ok || standalone ? 'shield' : 'info', 20),
        h('span', {}, ok || standalone ? 'הנתונים מוגנים ממחיקה'
          : 'כדי שהנתונים יישמרו לאורך זמן, הוסיפו את האפליקציה למסך הבית (שיתוף ← הוסף למסך הבית)'));
    })();

    // איפוס
    const resetBtn = h('button', { type: 'button', class: 'p-btn p-btn--danger' }, icon('reset'), h('span', { class: 'p-btn-label' }, 'איפוס התקדמות'));
    twoStep(resetBtn, {
      confirm: 'בטוח? לחצו שוב לאיפוס',
      onConfirm: async () => {
        flushName();
        await saved();
        await resetProgress();
        await persist({ station: 1, level: stageOfStation(1) }, null);
        toast('ההתקדמות אופסה');
        showTab('settings');
      },
      onError: () => toast('האיפוס נכשל'),
    });

    // חשבון: שינוי קוד כניסה + התנתקות
    const codeField = (id, label) => {
      const input = h('input', {
        id, type: 'password', inputmode: 'numeric', pattern: '[0-9]*', class: 'p-input p-input--code',
        autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', maxLength: 32,
        dir: 'ltr', enterkeyhint: 'done', 'aria-describedby': 'ps-code-hint ps-code-msg',
      });
      return [input, h('div', { class: 'p-field' }, h('label', { class: 'p-label', for: id }, label), input)];
    };
    const [code1, code1Field] = codeField('ps-code1', 'קוד חדש');
    const [code2, code2Field] = codeField('ps-code2', 'שוב את הקוד החדש');
    const codeMsg = h('p', { id: 'ps-code-msg', class: 'p-msg', 'aria-live': 'polite' });
    const setCodeMsg = (text, kind = 'info') => { codeMsg.className = `p-msg p-msg--${kind}`; codeMsg.textContent = text; };
    const codeLabel = h('span', { class: 'p-btn-label' }, 'שינוי קוד');
    const codeBtn = h('button', { type: 'submit', class: 'p-btn p-btn--primary' }, icon('key'), codeLabel);
    const codeForm = h('form', { class: 'p-code-form', novalidate: true, autocomplete: 'off' },
      h('div', { class: 'p-code-fields' }, code1Field, code2Field),
      codeMsg,
      h('div', { class: 'p-actions' }, codeBtn));
    for (const inp of [code1, code2]) inp.addEventListener('input', () => { if (codeMsg.textContent) setCodeMsg(''); });
    let codeBusy = false;
    codeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (codeBusy) return;
      let a = code1.value;
      let b = code2.value;
      const wipe = () => { code1.value = ''; code2.value = ''; a = null; b = null; };
      if (!a) { setCodeMsg('כתבו קוד חדש', 'error'); code1.focus(); return; }
      if (!/^[0-9]+$/.test(a)) { wipe(); setCodeMsg('רק ספרות. מסך הכניסה מקבל רק ספרות', 'error'); return; }
      if (a.length < CODE_MIN) { wipe(); setCodeMsg(`לפחות ${CODE_MIN} ספרות`, 'error'); return; }
      if (a !== b) { code2.value = ''; b = null; setCodeMsg('הקודים לא זהים', 'error'); code2.focus(); return; }
      codeBusy = true;
      codeBtn.disabled = true;
      codeLabel.textContent = 'משנה...';
      setCodeMsg('');
      let res;
      try {
        const p = changeCode(a);
        wipe(); // הקוד לא נשאר בשדות אחרי הניסיון
        res = await withTimeout(p, CLOUD_MS, { ok: false, error: 'network' });
      } catch (err) {
        console.warn('changeCode', err);
        res = { ok: false, error: 'unknown' };
      }
      wipe();
      codeBusy = false;
      codeBtn.disabled = false;
      codeLabel.textContent = 'שינוי קוד';
      if (s.closed) return;
      if (res?.ok) setCodeMsg('הקוד שונה. במכשירים האחרים צריך להיכנס שוב עם הקוד החדש', 'ok');
      else setCodeMsg(CODE_ERRORS[res?.error] || CODE_ERRORS.unknown, 'error');
    });

    const outMsg = h('div', { class: 'p-backup-msg', 'aria-live': 'polite' });
    const outBtn = h('button', { type: 'button', class: 'p-btn p-btn--danger' }, icon('logout'), h('span', { class: 'p-btn-label' }, 'התנתקות'));
    twoStep(outBtn, {
      confirm: 'בטוח? לחצו שוב להתנתקות',
      onConfirm: async () => {
        outMsg.replaceChildren(hint('שומר בענן את מה שנשאר ומתנתק...'));
        flushName();
        await saved();
        await signOut(); // מעלה קודם את מה שממתין (עד 5 שניות)
        let still = null;
        try { still = await getSession(); } catch {}
        if (still) throw new Error('still signed in');
        if (s.closed) return;
        onSignedOut?.();
        close();
      },
      onError: () => outMsg.replaceChildren(note('ההתנתקות נכשלה. בדקו את החיבור ונסו שוב', 'error')),
    });

    return [
      card('הילד', h('div', { class: 'p-rows' },
        row('ps-name', 'שם הילד', name))),
      card('משחק', h('div', { class: 'p-rows' },
        row('ps-trace', 'חובה לעבור על האותיות לפני קריאה',
          h('span', { class: 'p-switch' }, trace, h('span', { class: 'p-switch-track', 'aria-hidden': 'true' })),
          'כשכבוי, הילד יכול לקרוא בלי לעבור על הקווים'),
        row('ps-reward', 'מילים נכונות עד דף ציור', selectBox(reward)),
        row('ps-tries', 'ניסיונות לפני שממשיכים', selectBox(tries), 'אחרי זה המילה מושמעת וממשיכים'),
        row('ps-station', 'תחנה נוכחית', selectBox(station), 'עוברים לתחנה הבאה לבד כש-80% ממילות התחנה נקראו נכון לפחות פעם אחת'))),
      card('דיבור והקראה', h('div', { class: 'p-rows' },
        h('div', { class: 'p-row p-row--stack' }, leniency),
        row('ps-rate', 'מהירות הקראה', h('span', { class: 'p-rate' }, rate, rateOut, rateTest), voiceNote),
        row(null, 'בדיקת מיקרופון', micBtn,
          'ב-iPad צריך שההכתבה תהיה מופעלת (הגדרות ← כללי ← מקלדת ← הפעלת הכתבה), ויש צורך בחיבור לאינטרנט',
          micOut))),
      card('גיבוי ונתונים', h('div', { class: 'p-rows' },
        row(null, 'גיבוי', h('span', { class: 'p-btns' }, dlBtn, upBtn, file),
          'הקובץ כולל הגדרות, מילים, התקדמות וציורים', backupMsg),
        h('div', { class: 'p-row' }, storageLine),
        row(null, 'איפוס התקדמות', resetBtn, 'מוחק את היסטוריית הקריאה (גם בענן) ומחזיר לתחנה הראשונה. מילים, ציורים והגדרות נשארים.'))),
      card('חשבון', h('div', { class: 'p-rows' },
        h('div', { class: 'p-row p-row--stack' },
          h('div', { class: 'p-row-text' },
            h('span', { class: 'p-row-label' }, 'שינוי קוד כניסה'),
            h('p', { class: 'p-hint', id: 'ps-code-hint' }, `ספרות בלבד. לפחות ${CODE_MIN}, מומלץ ${CODE_GOOD} ומעלה. הקוד משותף לכל המכשירים של המשפחה`)),
          codeForm),
        row(null, 'התנתקות', outBtn, 'אחרי התנתקות צריך את קוד המשפחה כדי להיכנס שוב', outMsg),
        h('div', { class: 'p-row' }, h('p', { class: 'p-hint p-account-note' }, 'הנתונים נשארים במכשיר הזה ובענן גם אחרי התנתקות.')))),
    ];
  }

  await showTab('progress');
}
