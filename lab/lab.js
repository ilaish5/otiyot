// מעבדת דיבור — משווים מנועי הקראה (TTS) וזיהוי דיבור (STT) לפני שבוחרים מנוע לאפליקציה.
// מדבר עם lab/server.py (127.0.0.1:8766) לפי החוזה של /api/*. ES modules, בלי build, בלי ספריות.
// words.js ו-speech.js של האפליקציה מיובאים לקריאה בלבד: אותה רשימת מילים ואותה השוואה סלחנית.

import { BASE_WORDS, LEVELS } from '../js/words.js';
import { matches, normalize } from '../js/speech.js';

/* ================= קבועים ================= */

const MAX_REC_MS = 5000;          // עצירה אוטומטית של הקלטה
const COLD_HINT_MS = 8000;        // מעל זה: כנראה הפעלה קרה של RunPod
const LENIENCIES = ['strict', 'normal', 'lenient'];
const LEN_NAME = { strict: 'מחמיר', normal: 'רגיל', lenient: 'סלחני' };
const LABEL_KEYS = ['correct', 'wrong', 'unclear'];
const LABELS = { correct: 'קרא נכון', wrong: 'קרא לא נכון', unclear: 'לא ברור' };
const LABEL_TONE = { correct: 'go', wrong: 'danger', unclear: 'warn' };
const WEB_ERR = {
  'no-speech': 'לא נשמע דיבור',
  'not-allowed': 'אין הרשאה לזיהוי או למיקרופון',
  'service-not-allowed': 'הזיהוי כבוי (להפעיל הכתבה / Siri)',
  network: 'אין חיבור לשרת הזיהוי',
  'audio-capture': 'אין גישה למיקרופון',
  'language-not-supported': 'עברית לא נתמכת',
  aborted: 'בוטל',
  superseded: 'נקטע: הקלטה חדשה התחילה לפני שהדפדפן סיים',
  'start-failed': 'לא הצליח להתחיל',
  timeout: 'לא הסתיים בזמן',
  unsupported: 'לא נתמך בדפדפן',
};
const NIKUD_RE = /[֑-ׇ]/g;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const WORD_BY_ID = new Map(BASE_WORDS.map((w) => [w.id, w]));

/* ================= כלים ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const enc = encodeURIComponent;
const stripNikud = (s) => String(s ?? '').replace(NIKUD_RE, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid instanceof Node ? kid : String(kid));
  }
}
// כמו replaceChildren, אבל מדלג על null/false ומשטח מערכים (replaceChildren המקורי כותב "null")
function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  play: 'M8 5.5v13l11-6.5z',
  stop: 'M7 7h10v10H7z',
  mic: 'M12 14.5a3.5 3.5 0 0 0 3.5-3.5V5.5a3.5 3.5 0 0 0-7 0V11a3.5 3.5 0 0 0 3.5 3.5zm6-3.5a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V21h2v-2.06A8 8 0 0 0 20 11h-2z',
  next: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',   // חץ שמאלה = קדימה ב-RTL
  prev: 'M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4z',
};
function icon(name) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}

const chip = (text, tone = 'muted', title) => h('span', { class: `chip ${tone}`, title }, text);

function median(arr) {
  const a = (arr || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function fmtMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function tsToDate(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts);
  if (Number.isFinite(Number(ts))) return tsToDate(Number(ts));
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtTs(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  return d.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

const store = {
  get(k, d) {
    try { const v = localStorage.getItem(`lab.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(`lab.${k}`, JSON.stringify(v)); } catch { /* אחסון חסום — לא קריטי */ }
  },
};

async function api(path, { method = 'GET', json, body, headers = {}, raw = false, timeout = 0 } = {}) {
  const opts = { method, headers: { ...headers } };
  if (json !== undefined) {
    opts.body = JSON.stringify(json);
    opts.headers['Content-Type'] = 'application/json';
  } else if (body !== undefined) opts.body = body;
  let timer;
  if (timeout) {
    const ctrl = new AbortController();
    opts.signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), timeout);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'תם הזמן' : 'אין חיבור לשרת');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && j.error) msg = `${j.error} (${res.status})`; } catch { /* לא JSON */ }
    throw new Error(msg);
  }
  if (raw) return res;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function toast(msg, tone = 'danger') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${tone}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = 'toast'; }, 4500);
}

function selectEl(options, value, onChange, props = {}) {
  const sel = h('select', {
    ...props,
    onchange: (e) => { onChange(e.target.value); if (props.blurAfter) e.target.blur(); },
    blurAfter: null,
  }, options.map(([v, t]) => h('option', { value: String(v) }, t)));
  sel.value = String(value);
  if (sel.selectedIndex < 0 && options.length) sel.selectedIndex = 0;
  return sel;
}
function switchEl(text, checked, onChange, { disabled = false, title } = {}) {
  const input = h('input', {
    type: 'checkbox', checked: !!checked, disabled,
    onchange: (e) => { onChange(e.target.checked); e.target.blur(); },
  });
  return h('label', { class: `switch${disabled ? ' is-disabled' : ''}`, title }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', {}, text));
}
const levelName = (id) => {
  const l = LEVELS.find((x) => String(x.id) === String(id));
  return l ? `שלב ${l.id} · ${stripNikud(l.name)}` : 'מילים אחרות';
};
const levelOptions = () => [['all', 'כל השלבים'], ...LEVELS.map((l) => [String(l.id), levelName(l.id)])];
const lenSelect = (value, onChange) => selectEl(LENIENCIES.map((L) => [L, LEN_NAME[L]]), value, onChange, { blurAfter: true });
const wordsOfLevel = (level) => BASE_WORDS.filter((w) => level === 'all' || String(w.level) === String(level));

function preserveScroll(root, fn) {
  const saved = [...root.querySelectorAll('.table-wrap')].map((el) => el.scrollLeft);
  fn();
  [...root.querySelectorAll('.table-wrap')].forEach((el, i) => { if (saved[i]) el.scrollLeft = saved[i]; });
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function progressBar(done, total, running) {
  const p = total ? Math.min(100, (done / total) * 100) : 0;
  return h('div', { class: 'progress' },
    h('div', { class: 'bar' }, h('span', { style: { width: `${p}%` } })),
    h('span', { class: 'progress-text' }, `${done} / ${total}`),
    running ? chip('רץ', 'info') : chip('הסתיים', 'go'));
}

/* ================= סביבה: דפדפן ושרת ================= */

function detectBrowser() {
  const ua = navigator.userAgent || '';
  const base = { canListen: !!SR, canSpeak: 'speechSynthesis' in window };
  if (/Edg\//.test(ua)) return { ...base, id: 'edge', name: 'Edge', sr: 'Microsoft' };
  if (/OPR\//.test(ua)) return { ...base, id: 'opera', name: 'Opera', sr: 'Opera' };
  if (/Firefox\//.test(ua)) return { ...base, id: 'firefox', name: 'Firefox', sr: '' };
  if (navigator.brave) return { ...base, id: 'brave', name: 'Brave', sr: 'לא עובד ב-Brave' };
  if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) return { ...base, id: 'chrome', name: 'Chrome', sr: 'Google (בענן)' };
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return { ...base, id: 'safari', name: 'Safari', sr: 'Apple (כמו באייפד)' };
  return { ...base, id: 'other', name: 'דפדפן אחר', sr: '' };
}
const BROWSER_NAMES = { safari: 'Safari · Apple', chrome: 'Chrome · Google', edge: 'Edge', opera: 'Opera', firefox: 'Firefox', brave: 'Brave' };
const webEngineName = (b) => `זיהוי הדפדפן · ${BROWSER_NAMES[b] || b || 'לא ידוע'}`;

const S = {
  browser: detectBrowser(),
  server: 'checking',             // checking | ok | down
  serverError: '',
  engines: { tts: [], stt: [], browserHint: '' },
  voices: [],
  tab: 'tts',
};
const availableStt = () => S.engines.stt.filter((e) => e.available);

function renderEnv() {
  const b = S.browser;
  const kids = [
    chip(`דפדפן: ${b.name}`, 'info'),
    b.canListen ? chip(`זיהוי בדפדפן: ${b.sr || 'זמין'}`, 'go') : chip('זיהוי בדפדפן: לא נתמך', 'danger'),
    b.canSpeak
      ? chip(`קולות עבריים בדפדפן: ${S.voices.length}`, S.voices.length ? 'go' : 'warn', S.voices.map((v) => v.name).join(', '))
      : chip('הקראה בדפדפן: לא נתמכת', 'danger'),
  ];
  if (!window.isSecureContext) kids.push(chip('לא מאובטח: המיקרופון חסום', 'danger', 'לפתוח דרך http://127.0.0.1:8766/lab/'));
  if (S.server === 'checking') kids.push(chip('שרת: בודק…', 'muted'));
  else if (S.server === 'ok') kids.push(chip('שרת: מחובר', 'go'));
  else {
    kids.push(chip('שרת: לא זמין', 'danger', S.serverError));
    kids.push(h('button', { class: 'btn small', type: 'button', onclick: reconnect }, 'נסה שוב'));
  }
  fill($('#env'), ...kids);

  const parts = [];
  if (S.server === 'down') parts.push('שרת המעבדה לא עונה. להפעיל את lab/server.py ואז "נסה שוב". בלי שרת עובדים רק הקולות והזיהוי של הדפדפן, וכלום לא נשמר.');
  if (S.engines.browserHint) parts.push(S.engines.browserHint);
  const hint = $('#hint');
  hint.hidden = !parts.length;
  fill(hint, ...ltrUrls(parts.join(' · ')));
}
// כתובת בתוך טקסט עברי: בלי בידוד, ה-"/" שבסוף קופץ לצד השני של השורה
function ltrUrls(text) {
  return String(text).split(/(https?:\/\/[^\s]+)/).map((s, i) => (i % 2 ? h('bdi', { dir: 'ltr' }, s) : s));
}

async function loadEngines() {
  try {
    const r = await api('/api/engines', { timeout: 20000 });
    S.engines = {
      tts: Array.isArray(r && r.tts) ? r.tts : [],
      stt: Array.isArray(r && r.stt) ? r.stt : [],
      browserHint: (r && r.browserHint) || '',
    };
    S.server = 'ok';
    S.serverError = '';
  } catch (e) {
    S.server = 'down';
    S.serverError = e.message;
  }
  renderEnv();
}

async function reconnect() {
  S.server = 'checking';
  renderEnv();
  await loadEngines();
  if (S.server !== 'ok') return;
  await Promise.all([loadRatings(), loadRecordings()]);
  renderAllTabs();
}

function initVoices() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  let sig = '';
  const load = () => {
    const seen = new Set();
    const list = synth.getVoices()
      .filter((v) => /^(he|iw)([-_]|$)/i.test(v.lang || ''))
      .filter((v) => (seen.has(v.voiceURI) ? false : (seen.add(v.voiceURI), true)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const next = list.map((v) => v.voiceURI).join('|');
    if (next === sig) return;
    sig = next;
    S.voices = list;
    renderEnv();
    TTS.render();
  };
  load();
  try { synth.addEventListener('voiceschanged', load); } catch { /* דפדפן ישן */ }
  let n = 0;
  const iv = setInterval(() => { load(); if (++n > 16 || S.voices.length) clearInterval(iv); }, 250);
}

/* ================= שמע ================= */

let actx = null;
let curSrc = null;
let curEl = null;
function audioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx) { try { actx = new AC(); } catch { return null; } }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function stopAudio() {
  try { if (curSrc) curSrc.stop(); } catch { /* כבר נעצר */ }
  curSrc = null;
  if (curEl) { curEl.pause(); curEl = null; }
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* אין */ }
}
async function playArrayBuffer(buf, mime = 'audio/wav') {
  stopAudio();
  const ctx = audioCtx();
  if (ctx) {
    try {
      const ab = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(buf.slice(0), resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      const src = ctx.createBufferSource();
      src.buffer = ab;
      src.connect(ctx.destination);
      src.start();
      curSrc = src;
      return;
    } catch { /* ננסה עם <audio> */ }
  }
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  const el = new Audio(url);
  curEl = el;
  el.onended = () => URL.revokeObjectURL(url);
  await el.play();
}
function playUrl(url) {
  stopAudio();
  const el = new Audio(url);
  curEl = el;
  el.play().catch((e) => toast(`הניגון נכשל: ${e.message}`));
}

/* ================= לשונית 1: הקראה ================= */

const TTS = {
  noNikud: store.get('tts.noNikud', false),
  level: store.get('tts.level', 'all'),
  rate: store.get('tts.rate', 0.75),
  freeText: store.get('tts.free', ''),
  latency: store.get('tts.latency', {}),     // colKey -> [ms] (רק קריאות לא מהמטמון)
  last: {},                                   // playKey -> מצב ההשמעה האחרונה
  ratings: {},
  ratingsLoaded: false,
  dirtyOffline: false,
  saveState: 'idle',                          // idle | pending | saving | saved | error | offline
  saving: false,
  saveAgain: false,
  saveTimer: 0,
  ver: 0,                                     // עולה בכל שינוי דירוג
  savedVer: 0,                                // הגרסה האחרונה שהשרת אישר
  retry: 0,
  saveChip: null,
  updateFoot: () => {},
};
const variant = () => (TTS.noNikud ? 'without' : 'with');
const sendText = (t) => (TTS.noNikud ? stripNikud(t) : String(t || '')).trim();
const colKey = (c) => `${c.engine}|${c.voice}`;
const playKey = (c, sent) => `${colKey(c)}|${sent}`;
const ratingKey = (c, row) => (row.free ? `${colKey(c)}|text:${(row.text || '').trim()}` : `${colKey(c)}|${row.id}`);
function currentRating(key) {
  const r = TTS.ratings[key];
  return r && (r.nikud || 'with') === variant() ? r : null;
}

async function loadRatings() {
  try {
    const r = await api('/api/ratings');
    const server = r && typeof r === 'object' && !Array.isArray(r) ? r : {};
    const unsaved = TTS.dirtyOffline || TTS.savedVer < TTS.ver;
    TTS.ratings = unsaved ? { ...server, ...TTS.ratings } : server;
    TTS.ratingsLoaded = true;
    TTS.saveState = 'idle';
    if (unsaved) { TTS.dirtyOffline = false; TTS.ver++; scheduleSave(); }
  } catch {
    TTS.ratingsLoaded = false;
    TTS.saveState = 'offline';
  }
}
function setRating(key, patch) {
  const base = currentRating(key) || { correct: null, natural: null };
  const next = { correct: base.correct ?? null, natural: base.natural ?? null, ...patch, nikud: variant() };
  if (next.correct === null && next.natural === null) delete TTS.ratings[key];
  else TTS.ratings[key] = next;
  TTS.ver++;
  scheduleSave();
}
function scheduleSave(delay = 700) {
  // אם הטעינה מהשרת נכשלה — לא דורסים את הקובץ בשרת בחצי מידע
  if (!TTS.ratingsLoaded) { TTS.dirtyOffline = true; TTS.saveState = 'offline'; renderSaveChip(); return; }
  TTS.saveState = 'pending';
  renderSaveChip();
  clearTimeout(TTS.saveTimer);
  TTS.saveTimer = setTimeout(saveRatings, delay);
}
// כל PUT שולח את כל האובייקט, אז מספיק לדעת איזו גרסה השרת כבר קיבל.
// נכשל → ניסיון חוזר (2, 4, 8… עד 30 שניות); שינוי בזמן שמירה → שמירה נוספת מיד אחריה.
async function saveRatings() {
  clearTimeout(TTS.saveTimer);
  TTS.saveTimer = 0;
  if (TTS.saving) { TTS.saveAgain = true; return; }
  if (TTS.savedVer >= TTS.ver) { TTS.saveState = 'saved'; renderSaveChip(); return; }
  const v = TTS.ver;
  TTS.saving = true;
  TTS.saveState = 'saving';
  renderSaveChip();
  let failed = false;
  try {
    await api('/api/ratings', { method: 'PUT', json: TTS.ratings, timeout: 20000 });
    TTS.savedVer = Math.max(TTS.savedVer, v);
    TTS.retry = 0;
  } catch (e) {
    failed = true;
    if (!TTS.retry) toast(`שמירת הדירוגים נכשלה, מנסה שוב: ${e.message}`);
    TTS.retry++;
  }
  TTS.saving = false;
  if (TTS.saveAgain || (!failed && TTS.savedVer < TTS.ver)) { TTS.saveAgain = false; saveRatings(); return; }
  if (failed) {
    TTS.saveState = 'error';
    TTS.saveTimer = setTimeout(saveRatings, Math.min(30000, 1000 * 2 ** TTS.retry));
  } else TTS.saveState = 'saved';
  renderSaveChip();
}
// הדף נסגר / עובר לרקע: שולחים מה שעוד לא אושר (גם אם שמירה באמצע — היא עלולה להיחתך)
function flushRatings() {
  if (!TTS.ratingsLoaded || TTS.savedVer >= TTS.ver) return;
  const v = TTS.ver;
  try {
    fetch('/api/ratings', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(TTS.ratings) })
      .then((r) => { if (r.ok) TTS.savedVer = Math.max(TTS.savedVer, v); })
      .catch(() => { /* הטיימר הרגיל ינסה שוב אם הדף עוד חי */ });
  } catch { /* לא נורא */ }
}
function renderSaveChip() {
  const el = TTS.saveChip;
  if (!el) return;
  const map = {
    idle: ['דירוגים נשמרים בשרת', 'muted'],
    pending: ['ממתין לשמירה…', 'muted'],
    saving: ['שומר…', 'info'],
    saved: ['נשמר', 'go'],
    error: ['שגיאת שמירה', 'danger'],
    offline: ['אין שרת: הדירוגים לא נשמרים', 'danger'],
  };
  const [text, tone] = map[TTS.saveState] || map.idle;
  el.replaceChildren(chip(text, tone));
}
window.addEventListener('pagehide', flushRatings);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushRatings(); });

function ttsColumns() {
  const cols = [];
  for (const v of S.voices) {
    cols.push({
      kind: 'browser', engine: `browser-${S.browser.id}`, voice: v.voiceURI, name: v.name,
      sub: `${v.lang} · ${v.localService ? 'מקומי' : 'רשת'}`, source: S.browser.name,
    });
  }
  for (const e of S.engines.tts) {
    if (!e.available) continue;
    const voices = Array.isArray(e.voices) && e.voices.length ? e.voices : [{ id: '', name: '' }];
    for (const vv of voices) {
      cols.push({ kind: 'server', engine: e.id, voice: vv.id ?? '', name: e.name || e.id, sub: vv.name || vv.id || '', note: e.note || '', source: 'שרת' });
    }
  }
  return cols;
}
function pushLatency(c, ms) {
  if (!Number.isFinite(ms)) return;
  const k = colKey(c);
  TTS.latency[k] = [...(TTS.latency[k] || []).slice(-199), Math.round(ms)];
  store.set('tts.latency', TTS.latency);
  TTS.updateFoot();
}

async function playServerTts(col, text, key, onUpdate) {
  audioCtx();                         // בתוך הלחיצה — אחרת Safari חוסם את הניגון אחרי ה-fetch
  TTS.last[key] = { state: 'loading' };
  onUpdate();
  const t0 = performance.now();
  try {
    const payload = { engine: col.engine, text };
    if (col.voice) payload.voice = col.voice;
    const res = await api('/api/tts', { method: 'POST', json: payload, raw: true });
    const buf = await res.arrayBuffer();
    const rtt = performance.now() - t0;
    const hdr = num(res.headers.get('X-Elapsed-Ms'));
    const cached = res.headers.get('X-Cached') === '1';
    // X-Cold: הקריאה הזו גם טענה את המודל (פעם אחת לכל הפעלת שרת) — לא זמן הקראה רגיל
    const cold = !cached && res.headers.get('X-Cold') === '1';
    const ms = hdr ?? rtt;
    TTS.last[key] = { state: 'ok', ms, rtt, cached, cold };
    if (!cached && !cold) pushLatency(col, ms);
    onUpdate();
    await playArrayBuffer(buf, res.headers.get('Content-Type') || 'audio/wav');
  } catch (e) {
    TTS.last[key] = { state: 'error', error: e.message };
    onUpdate();
  }
}

function playBrowserTts(col, text, key, onUpdate) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  stopAudio();
  const u = new SpeechSynthesisUtterance(text);
  const voice = S.voices.find((v) => v.voiceURI === col.voice) || null;
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'he-IL';
  u.rate = TTS.rate;
  TTS.last[key] = { state: 'loading' };
  onUpdate();
  let done = false;
  const t0 = performance.now();
  u.onstart = () => {
    if (done) return;
    done = true;
    const ms = performance.now() - t0;
    TTS.last[key] = { state: 'ok', ms };
    pushLatency(col, ms);
    onUpdate();
  };
  u.onend = () => {
    if (done) return;
    done = true;                           // Safari לפעמים לא שולח onstart
    TTS.last[key] = { state: 'ok', ms: null };
    onUpdate();
  };
  u.onerror = (e) => {
    if (done) return;
    done = true;
    if (e.error === 'interrupted' || e.error === 'canceled') { delete TTS.last[key]; onUpdate(); return; }
    TTS.last[key] = { state: 'error', error: e.error || 'שגיאה' };
    onUpdate();
  };
  TTS.utter = u;                            // Chrome אוסף את האובייקט ואז onend לא מגיע
  synth.speak(u);
  setTimeout(() => {
    if (done) return;
    done = true;
    TTS.last[key] = { state: 'error', error: 'ההקראה לא התחילה' };
    onUpdate();
  }, 6000);
}

function ttsStatus(col, st) {
  if (!st) return [];
  if (st.state === 'loading') return [chip('טוען…', 'muted')];
  if (st.state === 'error') return [chip('שגיאה', 'danger', st.error)];
  if (col.kind === 'browser') return [chip(st.ms === null ? 'הושמע' : `התחלה ${fmtMs(st.ms)}`, 'muted', 'מהקריאה ל-speak ועד שהקול התחיל')];
  return [
    chip(fmtMs(st.ms), 'muted', `זמן יצירה בשרת. הלוך-חזור: ${fmtMs(st.rtt)}`),
    st.cached ? chip('מטמון', 'info', 'הקובץ הגיע מהמטמון של השרת') : null,
    st.cold ? chip('טעינת מודל', 'warn', 'הקריאה הראשונה טענה את המודל. לא נספרת בחציון') : null,
  ];
}

function ttsCell(col, row) {
  const td = h('td', { class: 'tts-cell' });
  const status = h('span', { class: 'play-status' });
  const play = h('button', { class: 'btn-play', type: 'button', title: 'השמע', 'aria-label': 'השמע', onclick: () => doPlay() }, icon('play'));
  const okBtn = h('button', { class: 'tri ok', type: 'button', title: 'הגייה נכונה', 'aria-label': 'הגייה נכונה', onclick: () => toggleCorrect(true) }, '✓');
  const noBtn = h('button', { class: 'tri no', type: 'button', title: 'הגייה שגויה', 'aria-label': 'הגייה שגויה', onclick: () => toggleCorrect(false) }, '✗');
  const nat = [1, 2, 3, 4, 5].map((n) => h('button', { class: 'nat', type: 'button', title: `טבעיות ${n} מתוך 5`, onclick: () => setNat(n) }, String(n)));
  const other = h('span', { class: 'variant-note' });

  td.append(
    h('div', { class: 'cell-line' }, play, h('span', { class: 'tri-pair' }, okBtn, noBtn), status),
    h('div', { class: 'cell-line nat-line' }, h('span', { class: 'cell-lbl' }, 'טבעי'), nat),
    other,
  );

  function doPlay() {
    const sent = sendText(row.text);
    if (!sent) return;
    const k = playKey(col, sent);
    if (col.kind === 'browser') playBrowserTts(col, sent, k, update);
    else playServerTts(col, sent, k, update);
  }
  function toggleCorrect(v) {
    const k = ratingKey(col, row);
    const cur = currentRating(k);
    setRating(k, { correct: cur && cur.correct === v ? null : v });
    update();
    TTS.updateFoot();
  }
  function setNat(n) {
    const k = ratingKey(col, row);
    const cur = currentRating(k);
    setRating(k, { natural: cur && cur.natural === n ? null : n });
    update();
    TTS.updateFoot();
  }
  function update() {
    const text = (row.text || '').trim();
    const k = ratingKey(col, row);
    const r = TTS.ratings[k];
    const cur = currentRating(k);
    okBtn.setAttribute('aria-pressed', String(!!cur && cur.correct === true));
    noBtn.setAttribute('aria-pressed', String(!!cur && cur.correct === false));
    nat.forEach((b, i) => b.setAttribute('aria-pressed', String(!!cur && cur.natural === i + 1)));
    const disabled = !text;
    play.disabled = disabled;
    okBtn.disabled = disabled;
    noBtn.disabled = disabled;
    nat.forEach((b) => { b.disabled = disabled; });
    if (r && !cur) {
      const c = r.correct === true ? '✓' : r.correct === false ? '✗' : '–';
      other.textContent = `דורג ${r.nikud === 'without' ? 'בלי' : 'עם'} ניקוד: ${c}${r.natural ? ` · ${r.natural}` : ''}`;
      other.hidden = false;
    } else other.hidden = true;
    fill(status, ...ttsStatus(col, text ? TTS.last[playKey(col, sendText(text))] : null).filter(Boolean));
  }
  update();
  return { td, update };
}

function colStats(c) {
  const prefix = `${colKey(c)}|`;
  const v = variant();
  let nC = 0; let ok = 0; let natSum = 0; let natN = 0;
  for (const [k, r] of Object.entries(TTS.ratings)) {
    if (!k.startsWith(prefix) || !r || (r.nikud || 'with') !== v) continue;
    if (r.correct === true || r.correct === false) { nC++; if (r.correct) ok++; }
    if (Number.isFinite(r.natural)) { natSum += r.natural; natN++; }
  }
  const lat = TTS.latency[colKey(c)] || [];
  return { nC, ok, natSum, natN, med: median(lat), latN: lat.length };
}

TTS.render = function render() {
  const root = $('#tab-tts');
  const cols = ttsColumns();
  const words = wordsOfLevel(TTS.level);
  const unavailable = S.engines.tts.filter((e) => !e.available);

  TTS.saveChip = h('span', { class: 'save-chip' });
  const toolbar = h('div', { class: 'toolbar' },
    switchEl('שלח בלי ניקוד', TTS.noNikud, (v) => { TTS.noNikud = v; store.set('tts.noNikud', v); TTS.render(); },
      { title: 'מוריד את הניקוד לפני השליחה למנוע. הדירוג נשמר יחד עם הגרסה (עם / בלי ניקוד).' }),
    h('label', { class: 'field' }, 'שלב', selectEl(levelOptions(), TTS.level, (v) => { TTS.level = v; store.set('tts.level', v); TTS.render(); }, { blurAfter: true })),
    h('label', { class: 'field', title: 'רק לקולות של הדפדפן. באפליקציה ברירת המחדל היא 0.75' }, 'מהירות בדפדפן',
      h('input', {
        type: 'range', min: 0.5, max: 1.2, step: 0.05, value: TTS.rate,
        oninput: (e) => { TTS.rate = Number(e.target.value); store.set('tts.rate', TTS.rate); e.target.nextElementSibling.textContent = TTS.rate.toFixed(2); },
      }),
      h('output', { class: 'num' }, Number(TTS.rate).toFixed(2))),
    h('span', { class: 'spacer' }),
    TTS.saveChip,
  );

  const notes = h('div', { class: 'notes' },
    h('p', { class: 'note' }, 'בכל תא: ▶ השמעה · ✓ / ✗ האם ההגייה נכונה · 1–5 כמה זה נשמע טבעי. לחיצה שנייה על אותו כפתור מבטלת. הסיכום למטה מחושב רק לגרסה המוצגת (עם / בלי ניקוד).'),
    unavailable.length ? h('p', { class: 'note' }, 'לא זמינים בשרת: ', unavailable.map((e, i) => [i ? ' · ' : '', h('b', {}, e.name || e.id), e.note ? ` (${e.note})` : ''])) : null,
    S.server === 'down' ? h('p', { class: 'note warn-text' }, 'השרת לא זמין: מוצגים רק הקולות של הדפדפן, והדירוגים לא יישמרו.') : null,
  );

  let body;
  if (!cols.length) {
    body = h('div', { class: 'card empty' }, S.browser.canSpeak
      ? 'אין קול עברי בדפדפן ואין מנוע הקראה זמין בשרת. ב-Mac: הגדרות מערכת ← נגישות ← תוכן מדובר ← קול המערכת ← לנהל קולות ← עברית (Carmit).'
      : 'הדפדפן לא תומך בהקראה, והשרת לא החזיר מנוע הקראה זמין.');
  } else {
    const head = h('tr', {},
      h('th', { class: 'sticky rowhead', scope: 'col' }, 'מילה'),
      cols.map((c) => h('th', { scope: 'col', class: 'col-head', title: c.note || c.voice || '' },
        h('div', { class: 'col-name' }, c.name),
        h('div', { class: 'col-sub' }, chip(c.source, c.kind === 'browser' ? 'info' : 'go'), c.sub ? h('span', {}, c.sub) : null))));

    const rows = words.map((w) => {
      const row = { id: w.id, text: w.text };
      return h('tr', {},
        h('th', { class: 'sticky rowhead', scope: 'row' },
          h('span', { class: 'pic', 'aria-hidden': 'true' }, w.pic),
          h('span', { class: 'word' }, w.text)),
        cols.map((c) => ttsCell(c, row).td));
    });

    const freeRow = { free: true, text: TTS.freeText };
    const freeCells = cols.map((c) => ttsCell(c, freeRow));
    let freeT = 0;
    const freeInput = h('input', {
      type: 'text', class: 'free-input word', dir: 'rtl', value: TTS.freeText, placeholder: 'טקסט חופשי',
      autocomplete: 'off', spellcheck: 'false', 'aria-label': 'טקסט חופשי להקראה',
      oninput: (e) => {
        freeRow.text = e.target.value;
        TTS.freeText = e.target.value;
        clearTimeout(freeT);
        freeT = setTimeout(() => { store.set('tts.free', TTS.freeText); freeCells.forEach((c) => c.update()); }, 200);
      },
    });
    rows.push(h('tr', { class: 'free-row' }, h('th', { class: 'sticky rowhead', scope: 'row' }, freeInput), freeCells.map((c) => c.td)));

    const footHead = h('th', { class: 'sticky rowhead foot', scope: 'row' });
    const footCells = cols.map(() => h('td', { class: 'foot' }));
    TTS.updateFoot = () => {
      fill(footHead, h('div', {}, 'סיכום'), h('div', { class: 'muted small' }, TTS.noNikud ? 'בלי ניקוד' : 'עם ניקוד'));
      cols.forEach((c, i) => {
        const s = colStats(c);
        fill(footCells[i], 
          h('div', { class: 'stat' }, h('span', { class: 'k' }, 'נכון'), h('b', {}, pct(s.ok, s.nC)), s.nC ? h('span', { class: 'n' }, `${s.ok}/${s.nC}`) : null),
          h('div', { class: 'stat' }, h('span', { class: 'k' }, 'טבעי'), h('b', {}, s.natN ? (s.natSum / s.natN).toFixed(1) : '—'), s.natN ? h('span', { class: 'n' }, `n=${s.natN}`) : null),
          h('div', { class: 'stat' }, h('span', { class: 'k' }, 'חציון'), h('b', {}, fmtMs(s.med)), s.latN ? h('span', { class: 'n' }, `n=${s.latN}`) : null),
        );
      });
    };
    TTS.updateFoot();

    body = h('div', { class: 'table-wrap' },
      h('table', { class: 'grid tts-grid' },
        h('thead', {}, head),
        h('tbody', {}, rows),
        h('tfoot', {}, h('tr', {}, footHead, footCells))));
  }

  preserveScroll(root, () => fill(root, toolbar, notes, body));
  renderSaveChip();
};

/* ================= תוצאות זיהוי: כלים משותפים ================= */

function altsOf(res) {
  if (!res) return [];
  const out = [];
  for (const t of [res.text, ...(Array.isArray(res.alternatives) ? res.alternatives : [])]) {
    const s = String(t ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
// תקלות הגדרה (הרשאה, רשת, הכתבה כבויה) הן לא "המנוע לא זיהה" — לא נספרות במדדים.
// "לא נשמע דיבור" כן נספר: זו תשובה אמיתית של המנוע.
const WEB_SETUP_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported', 'start-failed', 'unsupported', 'aborted', 'bad-grammar']);
function webAsResult(ws) {
  if (!ws) return null;
  const heard = Array.isArray(ws.alternatives) ? ws.alternatives : [];
  // לתצוגה: קודם התוצאה הסופית, אחר כך מה שנשמע בדרך (ההשוואה משתמשת בכולם, כמו listen() באפליקציה)
  const finals = Array.isArray(ws.final_alternatives) ? ws.final_alternatives.filter((t) => typeof t === 'string' && t.trim()) : [];
  const alts = [...finals, ...heard.filter((t) => !finals.includes(t))];
  // נקטע כי הקלטה חדשה התחילה (הדפדפן מריץ זיהוי אחד בכל פעם) — מה שנשמע עד אז הוא חלקי, לא נספר
  if (ws.error === 'superseded') return { state: 'error', error: WEB_ERR.superseded };
  if (!alts.length && WEB_SETUP_ERRORS.has(ws.error)) return { state: 'error', error: WEB_ERR[ws.error] || ws.error };
  return { state: 'done', text: alts[0] || '', alternatives: alts, elapsed_ms: num(ws.elapsed_ms), cold: null, error: ws.error || null };
}
// תוצאה של מנוע אחד. אם השרת החזיר את כל הרשומה — לוקחים ממנה את המנוע הזה.
function cleanResult(r, engineId) {
  const x = r && r.results && typeof r.results === 'object' && !Array.isArray(r.results) && !('text' in r) ? (r.results[engineId] || {}) : r;
  return {
    text: (x && x.text) ?? '',
    alternatives: Array.isArray(x && x.alternatives) ? x.alternatives : [],
    elapsed_ms: num(x && x.elapsed_ms),
    cold: x && typeof x.cold === 'boolean' ? x.cold : null,
    ...(x && x.error ? { error: x.error } : {}),
    // ההקלטה שקטה לגמרי: השרת לא שלח אותה למנוע (elapsed_ms = 0). לא נספר בדיוק ולא בזמנים.
    ...(x && x.silent ? { silent: true, note: x.note || '' } : {}),
  };
}
const SILENT_NOTE = 'ההקלטה שקטה לגמרי ולא נשלחה למנוע. אם הילד כן דיבר: כנראה המיקרופון לא הקליט (אפשר לנסות לכבות "זיהוי הדפדפן במקביל"). לא נספר במדדים.';
const targetOf = (r) => r.target || (WORD_BY_ID.get(r.wordId) || {}).text || '';

// מחזיר תוצאה של מנוע על הקלטה, או null אם לא רץ
function resultOf(r, e) {
  if (e.kind === 'web') {
    const w = r.webspeech;
    if (!w || (w.browser || 'unknown') !== e.browser) return null;
    return w.state ? w : webAsResult(w);
  }
  return (r.results && r.results[e.id]) || null;
}
const isDone = (res) => !!res && (!res.state || res.state === 'done');

function verdictChip(target, res, L) {
  if (!res) return h('span', { class: 'muted' }, '—');
  if (res.state === 'pending' || res.state === 'waiting') return chip('…', 'muted');
  if (res.state === 'error') return chip('!', 'danger', res.error);
  if (res.silent) return chip('שקט', 'warn', SILENT_NOTE);
  const alts = altsOf(res);
  const ok = matches(target, alts, L);
  const title = `מילת יעד: ${normalize(target, L)} · נשמע: ${alts.map((a) => normalize(a, L)).join(' / ') || 'כלום'}`;
  return ok ? chip('✓ כן', 'go', title) : chip('✗ לא', 'danger', title);
}
function pendingChip(t0, coldHint) {
  return h('span', { class: 'chip muted pending', 'data-t0': String(t0 || performance.now()), 'data-cold-hint': coldHint ? '1' : '0' }, 'רץ…');
}
// מעדכן את השעון של כל מנוע שעוד רץ
setInterval(() => {
  const now = performance.now();
  for (const el of document.querySelectorAll('[data-t0]')) {
    const ms = now - Number(el.dataset.t0);
    const cold = el.dataset.coldHint === '1' && ms > COLD_HINT_MS;
    el.textContent = `רץ… ${fmtMs(ms)}${cold ? ' · כנראה הפעלה קרה' : ''}`;
    el.classList.toggle('warn', cold);
    el.classList.toggle('muted', !cold);
  }
}, 250);

function heardCell(res) {
  if (!res) return h('span', { class: 'muted' }, '—');
  if (res.state === 'waiting') return chip('ממתין לשמירה', 'muted');
  if (res.state === 'pending') return pendingChip(res.t0, res.coldHint);
  if (res.state === 'listening') return h('span', {}, chip('מאזין…', 'info'), res.interim ? h('span', { class: 'interim' }, ` ${res.interim}`) : null);
  if (res.state === 'error') return h('span', { class: 'err-text', title: res.error }, chip('שגיאה', 'danger'), ` ${res.error || ''}`);
  if (res.silent) return chip('הקלטה שקטה', 'warn', SILENT_NOTE);
  const alts = altsOf(res);
  if (!alts.length) return chip(res.error ? (WEB_ERR[res.error] || res.error) : 'לא נשמע כלום', 'warn');
  return h('div', { class: 'heard-cell', title: alts.join(' · ') },
    h('span', { class: 'heard-main' }, alts[0]),
    alts.length > 1 ? h('span', { class: 'heard-alts' }, alts.slice(1).join(' · ')) : null);
}

function computeMetrics(records, e) {
  const out = { n: 0, runs: 0, silent: 0, lat: [], latWarm: [], cold: 0, by: {} };
  for (const L of LENIENCIES) out.by[L] = { ok: 0, fa: 0, fr: 0, nC: 0, nW: 0 };
  for (const r of records) {
    const res = resultOf(r, e);
    if (!isDone(res)) continue;
    out.runs++;
    if (res.silent) { out.silent++; continue; }       // המנוע לא קיבל כלום: לא זמן ולא החלטה שלו
    const ms = num(res.elapsed_ms);
    if (ms !== null) { out.lat.push(ms); if (res.cold !== true) out.latWarm.push(ms); }
    if (res.cold === true) out.cold++;
    if (r.label !== 'correct' && r.label !== 'wrong') continue;
    out.n++;
    const alts = altsOf(res);
    const target = targetOf(r);
    for (const L of LENIENCIES) {
      const m = matches(target, alts, L);
      const b = out.by[L];
      if (r.label === 'correct') { b.nC++; if (m) b.ok++; else b.fr++; } else { b.nW++; if (m) b.fa++; else b.ok++; }
    }
  }
  return out;
}

function metricsTable(records, engines, { runAll = false } = {}) {
  if (!engines.length) return h('div', { class: 'card empty' }, 'אין מנועי זיהוי להשוואה.');
  const all = engines.map((e) => ({ e, m: computeMetrics(records, e) }));
  const best = {};
  for (const L of LENIENCIES) best[L] = Math.max(-1, ...all.filter((x) => x.m.n).map((x) => x.m.by[L].ok / x.m.n));

  const head1 = h('tr', {},
    h('th', { rowspan: 2, class: 'sticky rowhead', scope: 'col' }, 'מנוע'),
    h('th', { rowspan: 2, scope: 'col', title: 'הקלטות עם תווית "קרא נכון" או "קרא לא נכון" שיש להן תוצאה מהמנוע. בסוגריים: כל ההקלטות שהמנוע רץ עליהן.' }, 'עם תווית'),
    LENIENCIES.map((L) => h('th', { colspan: 3, class: 'group', scope: 'colgroup' }, LEN_NAME[L])),
    h('th', { rowspan: 2, scope: 'col' }, 'חציון זמן'),
    h('th', { rowspan: 2, scope: 'col' }, 'הפעלות קרות'));
  const head2 = h('tr', {}, LENIENCIES.map(() => [
    h('th', { class: 'sub', scope: 'col' }, 'דיוק'),
    h('th', { class: 'sub', scope: 'col', title: 'המנוע קיבל, אבל ההורה סימן "קרא לא נכון" (מתוך ה"לא נכון")' }, 'קבלה שגויה'),
    h('th', { class: 'sub', scope: 'col', title: 'המנוע דחה, אבל ההורה סימן "קרא נכון" (מתוך ה"נכון")' }, 'דחייה שגויה'),
  ]));

  const rows = all.map(({ e, m }) => h('tr', {},
    h('th', { class: 'sticky rowhead', scope: 'row' },
      h('div', { class: 'eng-name' }, e.name),
      e.kind === 'server' && !e.available ? chip('לא זמין עכשיו', 'muted', e.note || '') : null,
      runAll && e.kind === 'server' && e.available ? h('div', { class: 'run-all' }, runAllControl(e)) : null),
    h('td', { class: 'num', title: m.silent ? `${m.silent} הקלטות שקטות לא נשלחו למנוע ולא נספרו` : '' },
      String(m.n), h('span', { class: 'n' }, ` (${m.runs})`), m.silent ? chip(`${m.silent} שקטות`, 'warn', SILENT_NOTE) : null),
    LENIENCIES.map((L) => {
      const b = m.by[L];
      const acc = m.n ? b.ok / m.n : null;
      return [
        h('td', { class: `num${acc !== null && acc === best[L] && all.length > 1 ? ' best' : ''}`, title: m.n ? `${b.ok} מתוך ${m.n}` : '' }, acc === null ? '—' : pct(b.ok, m.n)),
        h('td', { class: 'num', title: b.nW ? `${b.fa} מתוך ${b.nW}` : 'אין הקלטות "לא נכון"' }, b.nW ? [pct(b.fa, b.nW), h('span', { class: 'n' }, ` ${b.fa}/${b.nW}`)] : '—'),
        h('td', { class: 'num', title: b.nC ? `${b.fr} מתוך ${b.nC}` : 'אין הקלטות "נכון"' }, b.nC ? [pct(b.fr, b.nC), h('span', { class: 'n' }, ` ${b.fr}/${b.nC}`)] : '—'),
      ];
    }),
    h('td', { class: 'num', title: m.latWarm.length ? `בלי הפעלות קרות: ${fmtMs(median(m.latWarm))}` : '' }, fmtMs(median(m.lat))),
    h('td', { class: 'num' }, e.kind === 'web' ? '—' : String(m.cold))));

  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid metrics' }, h('thead', {}, head1, head2), h('tbody', {}, rows)));
}
const metricsLegend = () => h('p', { class: 'note' },
  'דיוק = כמה פעמים המנוע הסכים עם ההורה. קבלה שגויה = המנוע אמר "נכון" כשהילד טעה (הכי מסוכן: הילד לומד שטעות זה בסדר). דחייה שגויה = המנוע אמר "לא" כשהילד קרא נכון (מתסכל). "לא ברור", בלי תווית, הקלטה שקטה ותקלה בזיהוי הדפדפן (הרשאה, רשת, נקטע) לא נספרים. הזמן של זיהוי הדפדפן נמדד מסוף הדיבור עד התוצאה; של מנועי השרת — זמן העיבוד בשרת.');

function recordsTable(records, engines, L, { self = false } = {}) {
  const head = h('tr', {},
    self ? null : h('th', { scope: 'col' }, 'זמן'),
    h('th', { class: 'sticky rowhead', scope: 'col' }, 'מילה'),
    h('th', { scope: 'col' }, self ? 'הקראה' : 'תווית'),
    engines.map((e) => h('th', { scope: 'col', class: 'col-head' }, h('div', { class: 'col-name' }, e.name))),
    self ? null : h('th', { scope: 'col' }, ''));
  const rows = records.map((r) => {
    const w = WORD_BY_ID.get(r.wordId);
    const target = targetOf(r);
    return h('tr', {},
      self ? null : h('td', { class: 'muted nowrap' }, fmtTs(r.ts)),
      h('th', { class: 'sticky rowhead', scope: 'row' },
        w ? h('span', { class: 'pic', 'aria-hidden': 'true' }, w.pic) : null,
        h('span', { class: 'word small' }, target),
        self && r.sent && r.sent !== target ? h('div', { class: 'muted small' }, `נשלח: ${r.sent}`) : null),
      h('td', { class: 'nowrap' }, self ? ttsStateChip(r.tts) : labelSelect(r)),
      engines.map((e) => h('td', { class: 'res' }, resultCell(r, e, L, target, self))),
      self ? null : h('td', { class: 'nowrap' }, actionButtons(r)));
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid results' }, h('thead', {}, head), h('tbody', {}, rows)));
}
function ttsStateChip(t) {
  if (!t) return '—';
  if (t.state === 'pending') return pendingChip(t.t0, false);
  if (t.state === 'error') return chip('שגיאה', 'danger', t.error);
  return [chip(fmtMs(t.ms), 'muted', 'זמן יצירה בשרת'), t.cached ? chip('מטמון', 'info') : null];
}
function resultCell(r, e, L, target, self) {
  const res = resultOf(r, e);
  if (!res) {
    if (!self && e.kind === 'server' && e.available && S.server === 'ok') {
      return h('button', { class: 'btn tiny', type: 'button', title: 'להריץ את המנוע על ההקלטה הזו', onclick: (ev) => runOne(r, e, ev.currentTarget) }, 'הרץ');
    }
    return h('span', { class: 'muted' }, '—');
  }
  if (!isDone(res)) return heardCell(res);
  return h('div', { class: 'res-cell' },
    heardCell(res),
    h('div', { class: 'res-meta' },
      verdictChip(target, res, L),
      res.silent ? null : h('span', { class: 'ms' }, fmtMs(num(res.elapsed_ms))),
      res.cold === true ? chip('קר', 'warn', 'הפעלה קרה') : null));
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(records, engines, name, { self = false } = {}) {
  const header = ['id', 'ts', 'wordId', 'level', 'target', 'target_plain', self ? 'sent' : 'label'];
  for (const e of engines) for (const f of ['text', 'alternatives', 'elapsed_ms', 'cold', 'strict', 'normal', 'lenient']) header.push(`${e.id}:${f}`);
  const lines = [header];
  for (const r of records) {
    const w = WORD_BY_ID.get(r.wordId);
    const target = targetOf(r);
    const d = tsToDate(r.ts);
    const row = [r.id ?? '', d ? d.toISOString() : '', r.wordId ?? '', w ? w.level : '', target, stripNikud(target), self ? (r.sent || '') : (r.label || '')];
    for (const e of engines) {
      const res = resultOf(r, e);
      if (!isDone(res)) { row.push(res && res.state === 'error' ? `ERROR: ${res.error}` : '', '', '', '', '', '', ''); continue; }
      if (res.silent) { row.push('SILENT', '', '', '', '', '', ''); continue; }
      const alts = altsOf(res);
      row.push(alts[0] || '', alts.join(' | '), num(res.elapsed_ms) ?? '', res.cold === null || res.cold === undefined ? '' : res.cold ? 1 : 0,
        ...LENIENCIES.map((L) => (matches(target, alts, L) ? 1 : 0)));
    }
    lines.push(row);
  }
  const csv = lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
  download(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `lab-${name}-${stamp()}.csv`);
}

/* ================= לשונית 2: זיהוי ================= */

const STT = {
  mode: store.get('stt.mode', 'child'),         // child | self
  level: store.get('stt.level', 'all'),
  shuffle: store.get('stt.shuffle', false),
  useWeb: store.get('stt.web', true),
  order: [],
  idx: 0,
  state: 'idle',                                // idle | starting | recording | stopping
  stream: null,
  cur: null,                                    // ההקלטה הפעילה
  timer: 0,
  raf: 0,
  take: null,                                   // הניסיון המוצג
  takes: [],                                    // כל הניסיונות בסשן
  seq: 0,
  els: {},
};

function buildOrder() {
  const list = wordsOfLevel(STT.level).slice();
  if (STT.shuffle) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  }
  STT.order = list;
  STT.idx = 0;
}
const currentWord = () => STT.order[STT.idx] || null;
const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function pickMime() {
  if (!window.MediaRecorder) return '';
  // Safari (מ-18.4) יודע גם WebM, אבל MP4/AAC הוא הפורמט הוותיק והיציב שלו — כמו באייפד. Chrome: WebM/Opus.
  const webm = ['audio/webm;codecs=opus', 'audio/webm'];
  const mp4 = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  const list = [...(S.browser.id === 'safari' ? [...mp4, ...webm] : [...webm, ...mp4]), 'audio/ogg;codecs=opus', 'audio/wav'];
  for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* לא נתמך */ } }
  return '';
}
const baseMime = (m) => (m || '').split(';')[0].trim() || 'application/octet-stream';

async function ensureStream() {
  if (STT.stream && STT.stream.getAudioTracks().some((t) => t.readyState === 'live')) return STT.stream;
  STT.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  return STT.stream;
}
function releaseMic() {
  if (STT.state !== 'idle' || !STT.stream) return;
  STT.stream.getTracks().forEach((t) => t.stop());
  STT.stream = null;
}

// זיהוי הדפדפן רץ במקביל להקלטה. אוסף את כל מה שנשמע (כמו listen() באפליקציה) + תזמונים.
function startWeb(onInterim) {
  const rec = new SR();
  rec.lang = 'he-IL';
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  rec.continuous = false;
  const st = { tStart: performance.now(), heard: [], finals: [], error: null, tFinal: null, tSpeechEnd: null, tLastInterim: null, tStop: null, tEnd: null, ended: false, resolved: false, superseded: false, killer: 0 };
  // הדפדפן מריץ זיהוי אחד בכל פעם: התחלה חדשה קוטעת את הקודם אם הוא עוד לא החזיר תוצאה סופית
  const prev = startWeb.last;
  if (prev && !prev.resolved) prev.superseded = true;
  startWeb.last = st;
  const add = (arr, t) => { const s = String(t || '').trim(); if (s && !arr.includes(s)) arr.push(s); };
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const finish = () => {
    if (st.resolved) return;
    st.resolved = true;
    clearTimeout(st.killer);
    resolveDone(buildWebResult(st));
  };
  rec.onresult = (e) => {
    const now = performance.now();
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      for (let j = 0; j < res.length; j++) add(st.heard, res[j].transcript);
      if (res.isFinal) {
        for (let j = 0; j < res.length; j++) add(st.finals, res[j].transcript);
        if (st.tFinal === null) st.tFinal = now;
      } else st.tLastInterim = now;
    }
    const last = e.results[e.results.length - 1];
    if (last && last[0]) onInterim(last[0].transcript);
  };
  rec.onspeechend = () => { st.tSpeechEnd = performance.now(); };
  rec.onerror = (e) => { st.error = e.error || 'error'; };
  rec.onend = () => { st.ended = true; st.tEnd = performance.now(); finish(); };
  try { rec.start(); } catch { st.error = 'start-failed'; st.ended = true; finish(); }
  return {
    done,
    stop(tStop) {
      st.tStop = tStop;
      if (st.ended) return;
      try { rec.stop(); } catch { /* כבר נעצר */ }
      st.killer = setTimeout(() => {
        try { rec.abort(); } catch { /* כבר נעצר */ }
        if (!st.heard.length) st.error = st.error || 'timeout';
        finish();
      }, 4000);
    },
  };
}
function buildWebResult(st) {
  const tRes = st.tFinal ?? (st.heard.length ? (st.tEnd ?? performance.now()) : null);
  let elapsed = null;
  if (tRes !== null) {
    // נקודת הייחוס: הסימן האחרון לסוף הדיבור שקרה לפני התוצאה
    const before = [st.tSpeechEnd, st.tLastInterim, st.tStop].filter((t) => t !== null && t <= tRes);
    const ref = before.length ? Math.max(...before) : st.tStart;
    elapsed = Math.round(tRes - ref);
  }
  return {
    alternatives: st.heard,
    final_alternatives: st.finals,
    elapsed_ms: elapsed,
    total_ms: tRes !== null ? Math.round(tRes - st.tStart) : null,
    browser: S.browser.id,
    error: st.superseded && !st.finals.length ? 'superseded' : st.heard.length ? null : (st.error || 'no-speech'),
  };
}

function newTake(w) {
  const t = {
    n: ++STT.seq, wordId: w.id, target: w.text, level: w.level,
    state: 'recording', id: null, saveState: 'idle', saveError: '',
    webRequested: false, webspeech: null, webT0: 0, webInterim: '',
    results: {}, label: null, labelDirty: false, labelSave: 'idle', chain: Promise.resolve(),
    blob: null, url: '', mime: '', durMs: 0,
  };
  STT.takes.unshift(t);
  if (STT.takes.length > 60) STT.takes.length = 60;
  return t;
}

async function toggleRecord() {
  if (STT.state === 'recording') { stopRecording(); return; }
  if (STT.state !== 'idle') return;
  const w = currentWord();
  if (!w) return;
  if (!canRecord()) { setRecStatus('הדפדפן לא יכול להקליט (אין MediaRecorder)', 'danger'); return; }
  STT.state = 'starting';
  renderRecBtn();
  stopAudio();
  try {
    await ensureStream();
  } catch (e) {
    STT.state = 'idle';
    renderRecBtn();
    setRecStatus(`אין גישה למיקרופון: ${e.message || e.name}`, 'danger');
    return;
  }
  const mime = pickMime();
  let recorder;
  try {
    recorder = new MediaRecorder(STT.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    STT.state = 'idle';
    renderRecBtn();
    setRecStatus(`ההקלטה לא התחילה: ${e.message}`, 'danger');
    return;
  }
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { recorder.onstop = r; });
  const take = newTake(w);
  take.mime = mime || '';
  try { recorder.start(); } catch (e) {
    STT.state = 'idle';
    take.state = 'failed';
    take.saveState = 'error';
    take.saveError = e.message;
    renderRecBtn();
    return;
  }
  take.mime = recorder.mimeType || mime || (S.browser.id === 'safari' ? 'audio/mp4' : 'audio/webm');
  let web = null;
  if (STT.useWeb && SR) {
    take.webRequested = true;
    take.webT0 = performance.now();
    web = startWeb((text) => {
      take.webInterim = text;
      if (STT.els.interim && STT.cur && STT.cur.take === take) STT.els.interim.textContent = `הדפדפן שומע: ${text}`;
      if (take.state === 'recording') renderTakeIfCurrent(take);
    });
  }
  STT.cur = { recorder, chunks, stopped, take, web, tStart: performance.now() };
  STT.state = 'recording';
  STT.take = take;
  STT.timer = setTimeout(() => stopRecording(), MAX_REC_MS);
  if (STT.els.interim) STT.els.interim.textContent = '';
  renderRecBtn();
  renderTake();
  renderSession();
  const loop = () => {
    if (STT.state !== 'recording' || !STT.cur) return;
    const ms = performance.now() - STT.cur.tStart;
    if (STT.els.ring) STT.els.ring.style.setProperty('--p', Math.min(1, ms / MAX_REC_MS).toFixed(3));
    setRecStatus(`מקליט… ${(ms / 1000).toFixed(1)} / ${MAX_REC_MS / 1000} שניות`, 'mic');
    STT.raf = requestAnimationFrame(loop);
  };
  loop();
}

async function stopRecording() {
  if (STT.state !== 'recording' || !STT.cur) return;
  const cur = STT.cur;
  STT.cur = null;
  STT.state = 'stopping';
  clearTimeout(STT.timer);
  cancelAnimationFrame(STT.raf);
  renderRecBtn();
  const tStop = performance.now();
  try { cur.recorder.stop(); } catch { /* כבר נעצר */ }
  if (cur.web) cur.web.stop(tStop);
  await Promise.race([cur.stopped, sleep(3000)]);
  const take = cur.take;
  take.durMs = tStop - cur.tStart;
  take.blob = new Blob(cur.chunks, { type: take.mime });
  take.state = 'processing';
  take.webT0 = tStop;
  STT.state = 'idle';
  renderRecBtn();
  renderTakeIfCurrent(take);
  renderSession();
  processTake(take, cur.web);
}

async function processTake(take, web) {
  const webP = web
    ? web.done.then((res) => { take.webspeech = res; renderTakeIfCurrent(take); renderSession(); return res; })
    : Promise.resolve(null);

  const engines = availableStt();
  const fail = async (msg) => {
    take.saveState = 'error';
    take.saveError = msg;
    for (const e of engines) take.results[e.id] = { state: 'error', error: 'ההקלטה לא נשמרה' };
    renderTakeIfCurrent(take);
    await webP;
    take.state = 'done';
    renderSession();
  };
  if (!take.blob || take.blob.size < 200) { await fail('ההקלטה ריקה'); return; }
  if (S.server !== 'ok') { await fail('אין שרת: ההקלטה לא נשמרה'); return; }

  for (const e of engines) take.results[e.id] = { state: 'waiting' };
  take.saveState = 'saving';
  renderTakeIfCurrent(take);
  try {
    const q = `wordId=${enc(take.wordId)}&target=${enc(take.target)}`;
    const r = await api(`/api/recordings?${q}`, { method: 'POST', body: take.blob, headers: { 'Content-Type': baseMime(take.mime) } });
    if (!r || !r.id) throw new Error('השרת לא החזיר מזהה');
    take.id = r.id;
    take.saveState = 'saved';
    RES.dirty = true;
  } catch (e) {
    await fail(e.message);
    return;
  }
  renderTakeIfCurrent(take);

  // תווית שנבחרה עוד לפני שההקלטה נשמרה
  if (take.labelDirty) patchLabel(take);
  // קודם תוצאת הדפדפן, ואז כל מנועי השרת במקביל
  const ws = await webP;
  if (ws) {
    await queuePatch(take, async () => {
      try {
        await api(`/api/recordings/${enc(take.id)}`, { method: 'PATCH', json: { webspeech: ws } });
      } catch (e) {
        toast(`שמירת תוצאת הדפדפן נכשלה: ${e.message}`);
      }
    });
  }

  await Promise.all(engines.map(async (e) => {
    take.results[e.id] = { state: 'pending', t0: performance.now(), coldHint: true };
    renderTakeIfCurrent(take);
    try {
      const r = await api(`/api/recordings/${enc(take.id)}/run?engine=${enc(e.id)}`, { method: 'POST' });
      take.results[e.id] = cleanResult(r, e.id);
    } catch (err) {
      take.results[e.id] = { state: 'error', error: err.message };
    }
    RES.dirty = true;
    renderTakeIfCurrent(take);
    renderSession();
  }));
  take.state = 'done';
  renderSession();
}

function setLabel(take, label) {
  if (!take || take.state === 'recording' || take.state === 'failed') return;
  take.label = take.label === label ? null : label;
  take.labelDirty = true;
  renderTakeIfCurrent(take);
  renderSession();
  if (take.id) patchLabel(take);
}
// כל ה-PATCH של ניסיון אחד עוברים בתור, כדי שהשרת לא יקבל שני עדכונים לאותה רשומה במקביל
function queuePatch(take, fn) {
  take.chain = take.chain.then(fn).catch(() => {});
  return take.chain;
}
function patchLabel(take) {
  return queuePatch(take, async () => {
    if (!take.labelDirty) return;
    take.labelDirty = false;
    take.labelSave = 'saving';
    renderTakeIfCurrent(take);
    try {
      await api(`/api/recordings/${enc(take.id)}`, { method: 'PATCH', json: { label: take.label } });
      take.labelSave = 'saved';
      RES.dirty = true;
    } catch (e) {
      take.labelSave = 'error';
      take.labelDirty = true;
      toast(`שמירת התווית נכשלה: ${e.message}`);
    }
    renderTakeIfCurrent(take);
  });
}

function step(d) {
  if (STT.state !== 'idle') return;
  if (STT.order.length) STT.idx = (STT.idx + d + STT.order.length) % STT.order.length;
  STT.take = null;
  if (STT.els.interim) STT.els.interim.textContent = '';
  renderStage();
  renderTake();
  renderSession();
  setRecStatus('מוכן. הקש על המיקרופון או רווח', 'muted');
}

function setRecStatus(text, tone = 'muted') {
  const el = STT.els.recStatus;
  if (!el) return;
  el.textContent = text;
  el.className = `rec-status ${tone}`;
}
function renderRecBtn() {
  const { rec, ring } = STT.els;
  if (!rec) return;
  const st = STT.state;
  rec.classList.toggle('is-rec', st === 'recording');
  rec.disabled = st === 'starting' || st === 'stopping' || !canRecord();
  fill(rec, icon(st === 'recording' ? 'stop' : 'mic'));
  rec.setAttribute('aria-label', st === 'recording' ? 'עצור הקלטה' : 'התחל הקלטה');
  if (st !== 'recording' && ring) ring.style.setProperty('--p', '0');
  if (st === 'starting') setRecStatus('פותח מיקרופון…', 'muted');
  else if (st === 'stopping') setRecStatus('עוצר…', 'muted');
  else if (st === 'idle') setRecStatus(canRecord() ? 'מוכן. הקש על המיקרופון או רווח' : 'הדפדפן לא יכול להקליט', canRecord() ? 'muted' : 'danger');
}
function recCountFor(wordId) {
  const known = new Set(RES.records.map((r) => r.id));
  const fromServer = RES.records.filter((r) => r.wordId === wordId).length;
  const fromSession = STT.takes.filter((t) => t.wordId === wordId && t.id && !known.has(t.id)).length;
  return fromServer + fromSession;
}
function renderStage() {
  const { word, pic, meta } = STT.els;
  if (!word) return;
  const w = currentWord();
  if (!w) { word.textContent = ''; pic.textContent = ''; fill(meta, chip('אין מילים בשלב הזה', 'warn')); return; }
  pic.textContent = w.pic;
  word.textContent = w.text;
  const n = recCountFor(w.id);
  fill(meta, 
    chip(levelName(w.level), 'info'),
    chip(`מילה ${STT.idx + 1} מתוך ${STT.order.length}`, 'muted'),
    n ? chip(`הוקלטה ${n} פעמים`, 'muted') : chip('עוד לא הוקלטה', 'muted'));
}

function takeRows(t) {
  const rows = [];
  if (t.webRequested) {
    let res;
    if (t.state === 'recording') res = { state: 'listening', interim: t.webInterim };
    else if (!t.webspeech) res = { state: 'pending', t0: t.webT0, coldHint: false };
    else res = webAsResult(t.webspeech);
    rows.push({ name: webEngineName(S.browser.id), res, kind: 'web' });
  }
  for (const e of availableStt()) {
    let res = t.results[e.id];
    if (!res) res = t.state === 'recording' ? null : { state: 'waiting' };
    rows.push({ name: e.name || e.id, res, kind: 'server' });
  }
  return rows;
}
function takeTable(t) {
  const rows = takeRows(t);
  if (!rows.length) return h('div', { class: 'empty' }, 'אין מנועי זיהוי: הזיהוי של הדפדפן כבוי ואין מנוע זמין בשרת.');
  return h('table', { class: 'grid take-grid' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'מנוע'), h('th', { scope: 'col' }, 'מה נשמע'), h('th', { scope: 'col' }, 'זמן'), h('th', { scope: 'col' }, 'הפעלה'),
      LENIENCIES.map((L) => h('th', { scope: 'col' }, LEN_NAME[L])))),
    h('tbody', {}, rows.map(({ name, res, kind }) => {
      const done = isDone(res);
      return h('tr', {},
        h('th', { scope: 'row', class: 'eng-name' }, name),
        h('td', { class: 'heard' }, heardCell(res)),
        h('td', { class: 'num nowrap', title: kind === 'web' ? 'מסוף הדיבור עד התוצאה' : 'זמן עיבוד בשרת' }, done && !res.silent ? fmtMs(num(res.elapsed_ms)) : '—'),
        h('td', { class: 'nowrap' }, done && kind === 'server' ? (res.cold === true ? chip('קרה', 'warn') : res.cold === false ? chip('חמה', 'go') : '—') : '—'),
        LENIENCIES.map((L) => h('td', { class: 'nowrap' },
          done || (res && res.state === 'error') ? verdictChip(t.target, res, L) : (res ? chip('…', 'muted') : '—'))));
    })));
}
function takeSaveChips(t) {
  const out = [];
  if (t.state === 'recording') out.push(chip('מקליט', 'mic'));
  else if (t.saveState === 'saving') out.push(chip('שומר הקלטה…', 'muted'));
  else if (t.saveState === 'saved') out.push(chip('ההקלטה נשמרה', 'go'));
  else if (t.saveState === 'error') out.push(chip(`לא נשמר: ${t.saveError}`, 'danger'));
  if (t.labelSave === 'saving') out.push(chip('שומר תווית…', 'muted'));
  else if (t.labelSave === 'error') out.push(chip('התווית לא נשמרה', 'danger'));
  else if (t.label && t.labelDirty && !t.id && t.saveState !== 'error') out.push(chip('התווית תישמר אחרי ההקלטה', 'muted'));
  return out;
}
function playTake(t) {
  if (!t.blob) return;
  if (!t.url) t.url = URL.createObjectURL(t.blob);
  playUrl(t.url);
}
function renderTakeIfCurrent(t) { if (STT.take === t) renderTake(); }
function renderTake() {
  const box = STT.els.take;
  if (!box) return;
  const t = STT.take;
  if (!t) {
    box._take = null;
    fill(box, h('div', { class: 'card empty' }, 'עוד לא הוקלט ניסיון למילה הזו. הקש על המיקרופון (או רווח), תן לילד לקרוא, ועצור.'));
    return;
  }
  if (box._take !== t) {
    box._take = t;
    const parts = {};
    parts.head = h('div', { class: 'take-head' });
    parts.table = h('div', {});
    parts.labels = LABEL_KEYS.map((k, i) => h('button', {
      type: 'button', class: `label-btn ${LABEL_TONE[k]}`,
      onclick: (e) => { e.currentTarget.blur(); setLabel(t, k); },
    }, h('kbd', {}, String(i + 1)), LABELS[k]));
    parts.next = h('button', { type: 'button', class: 'btn primary big', onclick: (e) => { e.currentTarget.blur(); step(1); } }, 'המילה הבאה', icon('next'));
    t._parts = parts;
    fill(box, h('div', { class: 'card take' },
      parts.head,
      parts.table,
      h('div', { class: 'label-row' },
        h('span', { class: 'label-q' }, 'מה הילד באמת קרא?'),
        parts.labels,
        h('span', { class: 'spacer' }),
        parts.next)));
  }
  const p = t._parts;
  fill(p.head, 
    h('span', { class: 'take-n' }, `ניסיון ${t.n}`),
    h('span', { class: 'word small' }, t.target),
    t.durMs ? chip(`${(t.durMs / 1000).toFixed(1)} שניות`, 'muted') : null,
    ...takeSaveChips(t),
    h('span', { class: 'spacer' }),
    t.blob ? h('button', { class: 'btn small', type: 'button', onclick: () => playTake(t) }, icon('play'), 'השמע הקלטה') : null);
  preserveScroll(p.table, () => fill(p.table, h('div', { class: 'table-wrap' }, takeTable(t))));
  p.labels.forEach((b, i) => {
    b.setAttribute('aria-pressed', String(t.label === LABEL_KEYS[i]));
    b.disabled = t.state === 'recording' || t.state === 'failed';
  });
}

function sessionEngines() {
  const list = [];
  if (SR) list.push({ id: `webspeech:${S.browser.id}`, kind: 'web', browser: S.browser.id, name: webEngineName(S.browser.id) });
  for (const e of availableStt()) list.push({ id: e.id, kind: 'server', name: e.name || e.id, available: true });
  return list;
}
function takeResult(t, e) {
  if (e.kind === 'web') {
    if (!t.webRequested) return null;
    if (!t.webspeech) return { state: 'pending' };
    return webAsResult(t.webspeech);
  }
  return t.results[e.id] || null;
}
function renderSession() {
  const box = STT.els.session;
  if (!box) return;
  const takes = STT.takes.filter((t) => t.state !== 'recording');
  if (!takes.length) { fill(box); return; }
  const engines = sessionEngines();
  const table = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'מילה'), h('th', { scope: 'col' }, 'תווית'),
      engines.map((e) => h('th', { scope: 'col' }, e.name)))),
    h('tbody', {}, takes.map((t) => h('tr', { class: t === STT.take ? 'current' : '' },
      h('td', { class: 'num' }, String(t.n)),
      h('td', {}, h('span', { class: 'word small' }, t.target)),
      h('td', {}, t.label ? chip(LABELS[t.label], LABEL_TONE[t.label]) : h('span', { class: 'muted' }, '—')),
      engines.map((e) => h('td', {}, verdictChip(t.target, takeResult(t, e), 'normal')))))));
  preserveScroll(box, () => fill(box, 
    h('h3', {}, 'ניסיונות בסשן הזה ', h('span', { class: 'muted small' }, '(סלחנות רגילה)')),
    h('div', { class: 'table-wrap' }, table)));
}

function sttEngineNotes() {
  const kids = [SR ? chip(webEngineName(S.browser.id), 'go', 'רץ בזמן ההקלטה, בתוך הדפדפן') : chip('זיהוי הדפדפן: לא נתמך', 'muted')];
  for (const e of S.engines.stt) kids.push(e.available ? chip(e.name || e.id, 'go', e.note || '') : chip(`${e.name || e.id}: לא זמין`, 'muted', e.note || ''));
  if (S.server !== 'ok') kids.push(chip('אין שרת: רק זיהוי הדפדפן', 'danger'));
  const off = S.engines.stt.filter((e) => !e.available && e.note);
  return h('div', { class: 'engine-notes' },
    h('div', { class: 'chips' }, kids),
    off.length ? h('p', { class: 'note' }, off.map((e, i) => [i ? ' · ' : '', h('b', {}, e.name || e.id), `: ${e.note}`])) : null);
}

function childPanel() {
  if (!STT.order.length) buildOrder();
  const els = {};
  STT.els = els;
  const mime = pickMime();
  const toolbar = h('div', { class: 'toolbar' },
    h('label', { class: 'field' }, 'שלב', selectEl(levelOptions(), STT.level, (v) => {
      STT.level = v; store.set('stt.level', v); buildOrder(); step(0);
    }, { blurAfter: true })),
    switchEl('סדר אקראי', STT.shuffle, (v) => { STT.shuffle = v; store.set('stt.shuffle', v); buildOrder(); step(0); }),
    switchEl('זיהוי הדפדפן במקביל', STT.useWeb && !!SR, (v) => { STT.useWeb = v; store.set('stt.web', v); },
      { disabled: !SR, title: 'Web Speech רץ יחד עם ההקלטה. אם ההקלטה נפגעת ב-Safari — לכבות.' }),
    h('span', { class: 'spacer' }),
    chip(`פורמט: ${mime || (window.MediaRecorder ? 'ברירת מחדל' : 'אין הקלטה')}`, mime || window.MediaRecorder ? 'muted' : 'danger'));

  els.pic = h('div', { class: 'stage-pic', 'aria-hidden': 'true' });
  els.word = h('div', { class: 'stage-word', lang: 'he' });
  els.meta = h('div', { class: 'stage-meta chips' });
  els.rec = h('button', { class: 'rec-btn', type: 'button', onclick: (e) => { e.currentTarget.blur(); toggleRecord(); } });
  els.ring = h('div', { class: 'rec-ring' }, els.rec);
  els.recStatus = h('div', { class: 'rec-status', 'aria-live': 'polite' });
  els.interim = h('div', { class: 'rec-interim' });

  const stage = h('div', { class: 'card stage' },
    h('button', { class: 'nav-btn', type: 'button', title: 'המילה הקודמת (חץ ימינה)', 'aria-label': 'המילה הקודמת', onclick: (e) => { e.currentTarget.blur(); step(-1); } }, icon('prev')),
    h('div', { class: 'stage-center' },
      els.meta,
      h('div', { class: 'stage-wordline' }, els.pic, els.word),
      h('div', { class: 'rec-area' }, els.ring, h('div', { class: 'rec-texts' }, els.recStatus, els.interim))),
    h('button', { class: 'nav-btn', type: 'button', title: 'המילה הבאה (חץ שמאלה)', 'aria-label': 'המילה הבאה', onclick: (e) => { e.currentTarget.blur(); step(1); } }, icon('next')));

  const keys = h('p', { class: 'keys' },
    h('kbd', {}, 'רווח'), ' הקלטה / עצירה · ',
    h('kbd', {}, '1'), ' קרא נכון · ', h('kbd', {}, '2'), ' קרא לא נכון · ', h('kbd', {}, '3'), ' לא ברור · ',
    h('kbd', {}, '←'), ' המילה הבאה · ', h('kbd', {}, '→'), ' הקודמת. ',
    `עצירה אוטומטית אחרי ${MAX_REC_MS / 1000} שניות.`);

  els.take = h('div', { class: 'take-box' });
  els.session = h('div', { class: 'session' });
  renderStage();
  renderRecBtn();
  renderTake();
  renderSession();
  return h('div', { class: 'child-panel' }, toolbar, stage, keys, els.take, els.session);
}

STT.leave = function leave() {
  if (STT.state === 'recording') stopRecording();
  setTimeout(releaseMic, 500);
};
STT.render = function render() {
  const root = $('#tab-stt');
  const setMode = (m) => {
    if (STT.state !== 'idle' || STT.mode === m) return;
    STT.mode = m;
    store.set('stt.mode', m);
    if (m === 'self') releaseMic();
    STT.render();
  };
  const modeBar = h('div', { class: 'seg', role: 'group', 'aria-label': 'מצב' },
    h('button', { type: 'button', class: STT.mode === 'child' ? 'on' : '', 'aria-pressed': String(STT.mode === 'child'), onclick: () => setMode('child') }, 'הקלטה עם הילד'),
    h('button', { type: 'button', class: STT.mode === 'self' ? 'on' : '', 'aria-pressed': String(STT.mode === 'self'), onclick: () => setMode('self') }, 'בדיקה עצמית'));
  const panel = STT.mode === 'child' ? childPanel() : selfPanel();
  fill(root, h('div', { class: 'toolbar' }, modeBar), sttEngineNotes(), panel);
};

// קיצורי מקלדת להורה (רק בלשונית זיהוי, מצב הקלטה)
const isTyping = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
  || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(t.type)));
document.addEventListener('keydown', (e) => {
  if (S.tab !== 'stt' || STT.mode !== 'child') return;
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
  const isSpace = e.code === 'Space' || e.key === ' ';
  let handled = true;
  if (isSpace) { if (!e.repeat) toggleRecord(); }
  else if (e.key === '1') setLabel(STT.take, 'correct');
  else if (e.key === '2') setLabel(STT.take, 'wrong');
  else if (e.key === '3') setLabel(STT.take, 'unclear');
  else if (e.key === 'ArrowLeft') step(1);
  else if (e.key === 'ArrowRight') step(-1);
  else handled = false;
  if (handled) {
    e.preventDefault();
    const a = document.activeElement;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();   // שהרווח לא ילחץ גם על כפתור
  }
});
document.addEventListener('keyup', (e) => {
  if (S.tab === 'stt' && STT.mode === 'child' && (e.code === 'Space' || e.key === ' ') && !isTyping(e.target)) e.preventDefault();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && STT.state === 'recording') stopRecording(); });

/* ---------- בדיקה עצמית: הקראה בשרת ← כל מנועי הזיהוי ---------- */

const SELF = {
  source: store.get('self.source', ''),
  level: store.get('self.level', 'all'),
  noNikud: store.get('self.noNikud', false),
  leniency: store.get('self.len', 'normal'),
  engineSel: null,
  running: false,
  stopReq: false,
  rows: (store.get('self.rows', []) || []).filter((r) => r && r.wordId),
  meta: store.get('self.meta', null),
  done: 0,
  total: 0,
  els: {},
  renderT: 0,
};
function selfSources() {
  const out = [];
  for (const e of S.engines.tts) {
    if (!e.available) continue;
    const voices = Array.isArray(e.voices) && e.voices.length ? e.voices : [{ id: '', name: '' }];
    for (const v of voices) {
      out.push({ key: `${e.id}|${v.id ?? ''}`, engine: e.id, voice: v.id ?? '', label: `${e.name || e.id}${v.name || v.id ? ` · ${v.name || v.id}` : ''}` });
    }
  }
  return out;
}
function selfEngines() {
  const ids = (SELF.meta && SELF.meta.engines) || [];
  return ids.map((id) => {
    const e = S.engines.stt.find((x) => x.id === id);
    return { id, kind: 'server', name: (e && (e.name || e.id)) || id, available: !!(e && e.available) };
  });
}
function saveSelf() {
  const rows = SELF.rows.map((r) => ({
    ...r,
    tts: r.tts && r.tts.state === 'pending' ? { state: 'error', error: 'הופסק' } : r.tts,
    results: Object.fromEntries(Object.entries(r.results || {}).filter(([, v]) => v && v.state !== 'pending')),
  }));
  store.set('self.rows', rows);
  store.set('self.meta', SELF.meta);
}
function selfPanel() {
  const sources = selfSources();
  if (!sources.some((s) => s.key === SELF.source)) SELF.source = sources.length ? sources[0].key : '';
  const stt = availableStt();
  if (!SELF.engineSel) SELF.engineSel = new Set(stt.map((e) => e.id));
  const els = {};
  SELF.els = els;
  els.go = h('button', { type: 'button', class: 'btn primary', onclick: () => { if (SELF.running) { SELF.stopReq = true; SELF.update(); } else runSelfTest(); } });
  const toolbar = h('div', { class: 'toolbar' },
    h('label', { class: 'field' }, 'קול', sources.length
      ? selectEl(sources.map((s) => [s.key, s.label]), SELF.source, (v) => { SELF.source = v; store.set('self.source', v); }, { blurAfter: true })
      : chip('אין מנוע הקראה זמין בשרת', 'danger')),
    h('label', { class: 'field' }, 'שלב', selectEl(levelOptions(), SELF.level, (v) => { SELF.level = v; store.set('self.level', v); }, { blurAfter: true })),
    switchEl('שלח בלי ניקוד', SELF.noNikud, (v) => { SELF.noNikud = v; store.set('self.noNikud', v); }),
    h('span', { class: 'field' }, 'מנועי זיהוי:',
      stt.length
        ? stt.map((e) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: SELF.engineSel.has(e.id), onchange: (ev) => { if (ev.target.checked) SELF.engineSel.add(e.id); else SELF.engineSel.delete(e.id); } }),
          e.name || e.id))
        : chip('אין מנוע זיהוי זמין בשרת', 'danger')),
    h('span', { class: 'spacer' }),
    els.go);
  const note = h('p', { class: 'note' },
    'כל מילה מוקראת בקול שנבחר (בשרת), והקובץ נשלח לכל מנוע זיהוי. אין כאן ילד, אז התווית היא תמיד "קרא נכון" ודיוק = כמה מילים המנוע זיהה. ',
    'זיהוי הדפדפן לא מקבל קובץ ולכן לא נכלל. התוצאות לא נשמרות כהקלטות (רק בדפדפן הזה, עד הריצה הבאה).');
  els.progress = h('div', {});
  els.body = h('div', {});
  SELF.update();
  return h('div', { class: 'self-panel' }, toolbar, note, els.progress, els.body);
}
SELF.update = function update() {
  const els = SELF.els;
  if (!els || !els.go) return;
  const canRun = selfSources().length && availableStt().length && S.server === 'ok';
  els.go.textContent = SELF.running ? (SELF.stopReq ? 'עוצר…' : 'עצור') : 'הרץ בדיקה';
  els.go.classList.toggle('danger', SELF.running);
  els.go.disabled = (!SELF.running && !canRun) || SELF.stopReq;
  fill(els.progress, SELF.total ? progressBar(SELF.done, SELF.total, SELF.running) : '');
  if (!SELF.rows.length) { fill(els.body, h('div', { class: 'card empty' }, 'עוד לא הורצה בדיקה עצמית.')); return; }
  const engines = selfEngines();
  const m = SELF.meta;
  preserveScroll(els.body, () => fill(els.body, 
    m ? h('p', { class: 'note' }, `ריצה ${SELF.running ? 'נוכחית' : 'אחרונה'}: `, h('b', {}, m.source), m.noNikud ? ' · בלי ניקוד' : ' · עם ניקוד', ` · ${fmtTs(m.ts)}`) : null,
    h('h3', {}, 'מדדים'),
    metricsTable(SELF.rows, engines),
    h('div', { class: 'toolbar' },
      h('h3', {}, 'לפי מילה'),
      h('label', { class: 'field' }, 'סלחנות בטבלה', lenSelect(SELF.leniency, (v) => { SELF.leniency = v; store.set('self.len', v); SELF.update(); })),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: () => exportCsv(SELF.rows, engines, 'selftest', { self: true }) }, 'ייצוא CSV')),
    recordsTable(SELF.rows, engines, SELF.leniency, { self: true })));
};
function selfRender() {
  if (SELF.renderT) return;
  SELF.renderT = requestAnimationFrame(() => { SELF.renderT = 0; SELF.update(); });
}
async function runSelfTest() {
  const src = selfSources().find((s) => s.key === SELF.source);
  const engines = availableStt().filter((e) => SELF.engineSel && SELF.engineSel.has(e.id));
  if (!src) { toast('צריך לבחור קול מהשרת', 'warn'); return; }
  if (!engines.length) { toast('צריך לבחור לפחות מנוע זיהוי אחד', 'warn'); return; }
  const words = wordsOfLevel(SELF.level);
  SELF.running = true;
  SELF.stopReq = false;
  SELF.meta = { source: src.label, sourceKey: src.key, noNikud: SELF.noNikud, engines: engines.map((e) => e.id), ts: Date.now() };
  SELF.rows = [];
  SELF.total = words.length;
  SELF.done = 0;
  SELF.update();
  for (const w of words) {
    if (SELF.stopReq) break;
    const sent = (SELF.noNikud ? stripNikud(w.text) : w.text).trim();
    const row = { id: `self-${w.id}`, wordId: w.id, target: w.text, sent, label: 'correct', webspeech: null, results: {}, tts: { state: 'pending', t0: performance.now() } };
    SELF.rows.push(row);
    selfRender();
    let wav;
    try {
      const payload = { engine: src.engine, text: sent };
      if (src.voice) payload.voice = src.voice;
      const res = await api('/api/tts', { method: 'POST', json: payload, raw: true });
      wav = await res.blob();
      row.tts = { state: 'done', ms: num(res.headers.get('X-Elapsed-Ms')), cached: res.headers.get('X-Cached') === '1' };
    } catch (e) {
      row.tts = { state: 'error', error: e.message };
      for (const en of engines) row.results[en.id] = { state: 'error', error: 'ההקראה נכשלה' };
      SELF.done++;
      selfRender();
      continue;
    }
    await Promise.all(engines.map(async (en) => {
      row.results[en.id] = { state: 'pending', t0: performance.now(), coldHint: true };
      selfRender();
      try {
        const r = await api(`/api/stt?engine=${enc(en.id)}&target=${enc(w.text)}`, { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' } });
        row.results[en.id] = cleanResult(r, en.id);
      } catch (e) {
        row.results[en.id] = { state: 'error', error: e.message };
      }
      selfRender();
    }));
    SELF.done++;
    saveSelf();
    selfRender();
  }
  SELF.running = false;
  SELF.stopReq = false;
  saveSelf();
  SELF.update();
}

/* ================= לשונית 3: תוצאות ================= */

const RES = {
  records: [],
  loaded: false,
  loading: false,
  error: '',
  dirty: true,
  label: store.get('res.label', 'all'),
  level: store.get('res.level', 'all'),
  leniency: store.get('res.len', 'normal'),
  skipExisting: store.get('res.skip', true),
  runAll: {},
};

async function loadRecordings() {
  RES.loading = true;
  try {
    const r = await api('/api/recordings');
    RES.records = (Array.isArray(r) ? r : (r && Array.isArray(r.recordings) ? r.recordings : [])).filter((x) => x && x.id);
    RES.error = '';
    RES.loaded = true;
    RES.dirty = false;
  } catch (e) {
    RES.error = e.message;
  }
  RES.loading = false;
  renderStage();
}
function resFiltered() {
  return RES.records.filter((r) => {
    if (RES.label === 'none' ? !!r.label : RES.label !== 'all' && r.label !== RES.label) return false;
    if (RES.level !== 'all') {
      const w = WORD_BY_ID.get(r.wordId);
      if ((w ? String(w.level) : 'other') !== RES.level) return false;
    }
    return true;
  });
}
function resEngines(records) {
  const map = new Map();
  for (const r of records) {
    if (!r.webspeech) continue;
    const b = r.webspeech.browser || 'unknown';
    const id = `webspeech:${b}`;
    if (!map.has(id)) map.set(id, { id, kind: 'web', browser: b, name: webEngineName(b), available: false });
  }
  for (const e of S.engines.stt) map.set(e.id, { id: e.id, kind: 'server', name: e.name || e.id, available: !!e.available, note: e.note || '' });
  for (const r of records) {
    for (const k of Object.keys(r.results || {})) if (!map.has(k)) map.set(k, { id: k, kind: 'server', name: k, available: false });
  }
  return [...map.values()];
}
function labelSelect(r) {
  const tone = r.label ? LABEL_TONE[r.label] : 'none';
  return selectEl([['', 'בלי תווית'], ...LABEL_KEYS.map((k) => [k, LABELS[k]])], r.label || '', async (v) => {
    const prev = r.label ?? null;
    r.label = v || null;
    RES.render();
    try {
      const upd = await api(`/api/recordings/${enc(r.id)}`, { method: 'PATCH', json: { label: r.label } });
      if (upd && upd.id === r.id) Object.assign(r, upd);
    } catch (e) {
      r.label = prev;
      toast(`עדכון התווית נכשל: ${e.message}`);
      RES.render();
    }
  }, { class: `label-sel ${tone}`, 'aria-label': 'תווית', blurAfter: true });
}
function actionButtons(r) {
  const play = h('button', { class: 'btn tiny', type: 'button', title: 'השמע', 'aria-label': 'השמע', onclick: () => playUrl(`/api/recordings/${enc(r.id)}.wav`) }, icon('play'));
  const del = h('button', {
    class: 'btn tiny ghost-danger', type: 'button',
    onclick: async () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = 'בטוח? מחק';
        del.classList.add('armed');
        del._t = setTimeout(() => { delete del.dataset.armed; del.textContent = 'מחק'; del.classList.remove('armed'); }, 4000);
        return;
      }
      clearTimeout(del._t);
      del.disabled = true;
      del.textContent = 'מוחק…';
      try {
        await api(`/api/recordings/${enc(r.id)}`, { method: 'DELETE' });
        RES.records = RES.records.filter((x) => x.id !== r.id);
        RES.render();
        renderStage();
      } catch (e) {
        toast(`המחיקה נכשלה: ${e.message}`);
        delete del.dataset.armed;
        del.disabled = false;
        del.textContent = 'מחק';
        del.classList.remove('armed');
      }
    },
  }, 'מחק');
  return [play, del];
}
async function runOne(r, e, btn) {
  btn.disabled = true;
  btn.textContent = 'רץ…';
  try {
    const res = await api(`/api/recordings/${enc(r.id)}/run?engine=${enc(e.id)}`, { method: 'POST' });
    r.results = { ...(r.results || {}), [e.id]: cleanResult(res, e.id) };
  } catch (err) {
    toast(`${e.name}: ${err.message}`);
  }
  RES.render();
}
function runAllControl(e) {
  if (e.kind !== 'server') return '';
  const st = RES.runAll[e.id];
  if (st && st.running) {
    return [
      chip(`${st.done} / ${st.total}${st.errors ? ` · ${st.errors} שגיאות` : ''}`, 'info'),
      h('button', { class: 'btn tiny', type: 'button', disabled: st.stop, onclick: () => { st.stop = true; RES.render(); } }, st.stop ? 'עוצר…' : 'עצור'),
    ];
  }
  const btn = h('button', {
    class: 'btn small', type: 'button', disabled: !e.available || S.server !== 'ok',
    title: RES.skipExisting ? 'רק הקלטות (בסינון הנוכחי) שעוד אין להן תוצאה מהמנוע' : 'כל ההקלטות בסינון הנוכחי, גם אם כבר יש תוצאה',
    onclick: () => runAll(e),
  }, 'הרץ על כל ההקלטות');
  return [btn, st && !st.running ? h('span', { class: 'muted small' }, ` אחרון: ${st.done}/${st.total}${st.errors ? `, ${st.errors} שגיאות` : ''}`) : null];
}
async function runAll(e) {
  const list = resFiltered().filter((r) => !RES.skipExisting || !(r.results && r.results[e.id]));
  const st = { running: true, stop: false, done: 0, total: list.length, errors: 0, lastError: '' };
  RES.runAll[e.id] = st;
  RES.render();
  for (const r of list) {
    if (st.stop) break;
    try {
      const res = await api(`/api/recordings/${enc(r.id)}/run?engine=${enc(e.id)}`, { method: 'POST' });
      r.results = { ...(r.results || {}), [e.id]: cleanResult(res, e.id) };
    } catch (err) {
      st.errors++;
      st.lastError = err.message;
    }
    st.done++;
    RES.render();
  }
  st.running = false;
  RES.render();
  if (st.errors) toast(`${e.name}: ${st.errors} הרצות נכשלו (${st.lastError})`, 'warn');
}

RES.render = function render() {
  const root = $('#tab-results');
  const recs = resFiltered();
  const engines = resEngines(RES.records);
  let list;
  if (RES.loading && !RES.loaded) list = h('div', { class: 'card empty' }, 'טוען…');
  else if (!recs.length) list = h('div', { class: 'card empty' }, RES.records.length ? 'אין הקלטות שמתאימות לסינון.' : 'עוד אין הקלטות. מקליטים בלשונית "זיהוי".');
  else list = recordsTable(recs, engines, RES.leniency);
  preserveScroll(root, () => fill(root, 
    h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, 'תווית', selectEl([['all', 'הכל'], ...LABEL_KEYS.map((k) => [k, LABELS[k]]), ['none', 'בלי תווית']], RES.label,
        (v) => { RES.label = v; store.set('res.label', v); RES.render(); }, { blurAfter: true })),
      h('label', { class: 'field' }, 'שלב', selectEl([...levelOptions(), ['other', 'מילים אחרות']], RES.level,
        (v) => { RES.level = v; store.set('res.level', v); RES.render(); }, { blurAfter: true })),
      h('label', { class: 'field' }, 'סלחנות בטבלה', lenSelect(RES.leniency, (v) => { RES.leniency = v; store.set('res.len', v); RES.render(); })),
      switchEl('הרצה: לדלג על מה שכבר רץ', RES.skipExisting, (v) => { RES.skipExisting = v; store.set('res.skip', v); RES.render(); }),
      h('span', { class: 'spacer' }),
      chip(`${recs.length} מתוך ${RES.records.length} הקלטות`, 'muted'),
      h('button', { class: 'btn', type: 'button', disabled: S.server !== 'ok', onclick: async () => { await loadRecordings(); RES.render(); } }, 'רענון'),
      h('button', { class: 'btn', type: 'button', disabled: !recs.length, onclick: () => exportCsv(recs, engines, 'recordings') }, 'ייצוא CSV')),
    RES.error ? h('div', { class: 'card error-card' }, `טעינת ההקלטות נכשלה: ${RES.error}`) : null,
    h('h3', {}, 'מדדים לפי מנוע ', h('span', { class: 'muted small' }, '(לפי הסינון)')),
    metricsTable(recs, engines, { runAll: true }),
    metricsLegend(),
    h('h3', {}, 'הקלטות'),
    list));
};

/* ================= לשוניות ואתחול ================= */

const TABS = ['tts', 'stt', 'results'];
function showTab(id) {
  const tab = TABS.includes(id) ? id : 'tts';
  const prev = S.tab;
  S.tab = tab;
  for (const b of document.querySelectorAll('.tabs [data-tab]')) {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.classList.toggle('on', on);
  }
  for (const sec of document.querySelectorAll('.tab')) sec.hidden = sec.id !== `tab-${tab}`;
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  if (prev === 'stt' && tab !== 'stt') STT.leave();
  if (tab === 'results' && RES.dirty && S.server === 'ok') loadRecordings().then(() => RES.render());
}
function renderAllTabs() {
  TTS.render();
  if (STT.state === 'idle') STT.render();
  RES.render();
}

async function init() {
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  renderEnv();
  renderAllTabs();
  showTab(location.hash.slice(1));
  initVoices();
  await loadEngines();
  if (S.server === 'ok') await Promise.all([loadRatings(), loadRecordings()]);
  else TTS.saveState = 'offline';
  renderAllTabs();
}

init();
