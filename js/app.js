// המעטפת: מסך כניסה (קוד המשפחה), מסך פתיחה, לולאת מילה (מעבר עם העט → קריאה בקול → הבא),
// פרס ציור ושער הורה.

import { LEVELS, BASE_WORDS } from './words.js';
import {
  DEFAULT_SETTINGS, getSettings, saveSettings, getKV, setKV, listCustomWords,
  getAllStats, recordWord, saveDrawing, requestPersist,
} from './db.js';
import { canListen, hasHebrewVoice, say, listen, stopListening, matches, chime, softBoop, tick } from './speech.js';
import { Tracer } from './trace-line.js';
import { renderPicker, Colorer } from './coloring.js';
import { openParent } from './parent.js';
import { initCloud, isReady, getSession, signIn, onAuthChange } from './cloud.js';
import { startSync, syncNow, onStatus } from './sync.js';

// טקסט לילד — מנוקד, בדיוק כפי שאושר
const STR = {
  trace: 'עֲבֹר עִם הָעֵט עַל הַקַּוִּים',
  read: 'עַכְשָׁו קְרָא בְּקוֹל',
  listening: 'אֲנִי מַקְשִׁיב…',
  retry: 'כִּמְעַט! נַסֵּה שׁוּב',
  noSpeech: 'לֹא שָׁמַעְתִּי. נַסֵּה שׁוּב',
  success: 'כׇּל הַכָּבוֹד!',
  skipped: 'לֹא נוֹרָא! מַמְשִׁיכִים',
  messy: 'נַסֵּה לַעֲבֹר בְּדִיּוּק עַל הַקַּוִּים',
  levelUp: 'שָׁלָב חָדָשׁ!',
  reward: 'הִגִּיעַ הַזְּמַן לְצַיֵּר!',
  level: 'שָׁלָב',
};
// מילות עידוד שמושמעות (לא מוצגות)
const PRAISE = ['כל הכבוד', 'יופי', 'מעולה'];

// מסך הכניסה — להורה, בלי ניקוד
const LOGIN_MSG = {
  invalid: 'קוד שגוי',
  network: 'אין חיבור לאינטרנט',
  rate: 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות',
  unavailable: 'לא ניתן להתחבר כרגע',
  unknown: 'משהו השתבש. נסה שוב',
  busy: 'מתחבר...',
  syncing: 'מסנכרן...',
};
const CODE_MIN = 6;       // אפשר ללחוץ "כניסה" מ-6 ספרות
const CODE_MAX = 32;
const CODE_DOTS = 8;      // מקומות לנקודות (גדל אם הקוד ארוך יותר)
const SIGN_IN_MS = 20000; // התחברות שלא חוזרת — כאילו אין רשת
const FIRST_SYNC_MS = 3000;

const SCREENS = ['screen-login', 'screen-start', 'screen-word', 'screen-pick', 'screen-color', 'screen-parent'];
const HOLD_MS = 1500;
const LISTEN_MS = 5000;
const DEBUG = new URLSearchParams(location.search).has('debug');

const $ = (id) => document.getElementById(id);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const levelOf = (w) => Number(w.level) || 1;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// שמירה או טעינה שנתקעה (IndexedDB, או שרת בעתיד) לא תשאיר את הילד בלי "הבא"
const timed = (p, ms = 3000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('db timeout')), ms))]);

// ---------- אייקונים (SVG קווי, 24x24) ----------
const GEAR = (() => {
  const n = 8, ro = 10, ri = 7.6, s = Math.PI / n;
  const p = (r, a) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i * 2 * s;
    d += `${i ? `A${ri} ${ri} 0 0 1 ` : 'M'}${p(ri, a - s * 0.5)} L${p(ro, a - s * 0.3)} L${p(ro, a + s * 0.3)} L${p(ri, a + s * 0.5)} `;
  }
  return `<path d="${d}A${ri} ${ri} 0 0 1 ${p(ri, -s * 0.5)} Z"/><circle cx="12" cy="12" r="3"/>`;
})();

const ICONS = {
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6a8 8 0 0 1 0 12"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  brush: '<path d="M20 4l-7 7"/><path d="M11 9l4 4"/><path d="M11.5 12.5c-2.4-1.3-5.4.2-5.9 3-.3 1.9-1.4 3.2-3.1 4 3.9 1.2 8.1-.1 9.4-2.9.7-1.5.5-3-.4-4.1z"/>',
  gear: GEAR,
  eraser: '<path d="M8.5 20L4 15.5a2 2 0 0 1 0-2.8l8.7-8.7a2 2 0 0 1 2.8 0l4.5 4.5a2 2 0 0 1 0 2.8L11.5 20"/><path d="M8.5 20H20"/><path d="M8 9l7 7"/>',
  star: '<path fill="currentColor" d="M12 2.8l2.7 5.7 6.2.8-4.5 4.3 1.1 6.1L12 16.8l-5.5 2.9 1.1-6.1-4.5-4.3 6.2-.8z"/>',
  dot: '<circle cx="12" cy="12" r="8.5" stroke-width="2.4" stroke-dasharray="0.1 4.35"/>',
  backspace: '<path d="M9 5h11v14H9l-6-7z"/><path d="M11.5 9.5l5 5"/><path d="M16.5 9.5l-5 5"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
const gearButton = () => `<svg class="ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle cx="22" cy="22" r="20"/></svg>${icon('gear')}`;

// ---------- DOM ----------
const el = {
  start: $('btn-start'), childName: $('child-name'), status: $('start-status'),
  gearStart: $('btn-parent-start'), gear: $('btn-parent'),
  stars: $('stars'), levelChip: $('level-chip'),
  traceHost: $('trace-host'), pic: $('pic'), coach: $('coach'), clear: $('btn-clear'), banner: $('banner'),
  hear: $('btn-hear'), mic: $('btn-mic'), next: $('btn-next'),
  manual: $('manual'), manualOk: $('manual-ok'), manualNo: $('manual-no'), manualNote: $('manual-note'),
  debug: $('debug'), debugText: $('debug-text'), debugSay: $('debug-say'), debugSkip: $('debug-skip'),
  debugSilence: $('debug-silence'), debugState: $('debug-state'),
  pickScreen: $('screen-pick'), colorScreen: $('screen-color'), parentScreen: $('screen-parent'),
  login: $('screen-login'), loginDots: $('login-dots'), loginCount: $('login-count'), loginMsg: $('login-msg'),
  loginRetry: $('login-retry'), loginDel: $('login-del'), loginGo: $('login-go'),
  loginKeys: [...document.querySelectorAll('#login-pad [data-digit]')],
};

el.loginDel.innerHTML = icon('backspace');
el.hear.innerHTML = icon('speaker');
el.mic.innerHTML = icon('mic');
el.next.innerHTML = icon('arrowLeft', 'ic-arrow') + icon('brush', 'ic-brush');
el.clear.innerHTML = icon('eraser');
el.gear.innerHTML = gearButton();
el.gearStart.innerHTML = gearButton();

// ---------- מצב ----------
let settings = { ...DEFAULT_SETTINGS };
let customWords = [];
let stats = {};
let rewardCount = 0;

let tracer = null;
let word = null;
let state = 'idle'; // idle | loading | trace | read | listening | done | reward | parent
let attempts = 0;
let heardBeforeRead = false;
let transcripts = [];
let recent = [];          // 3 המילים האחרונות שהוצגו
let bannerPending = false;
let loadSeq = 0;          // עולה בכל החלפת מילה — מבטל טיימרים ותוצאות ישנים
let listenSeq = 0;        // עולה בכל האזנה / ביטול האזנה
let started = false;
let parentOpen = false;
let returnTo = 'screen-start';
let voicesChecked = false;
let silences = 0;         // "לא שמעתי" ברצף במילה הנוכחית
let messyTimer = null;

// שער כניסה + ענן
let gateOpen = false;     // מותר להציג את מסכי הילד (יש חיבור שמור במכשיר — גם בלי רשת)
let needLogin = false;    // החיבור נגמר — מסך הכניסה יוצג במעבר המסך הבא
let loggingIn = false;
let code = '';            // הספרות שהוקלדו. מתרוקן מיד כשמנסים להתחבר
let dataDirty = false;    // סנכרון הסתיים — לטעון מחדש מה-IndexedDB בנקודה בטוחה
let lastSyncSeen = null;
let starting = false;     // נגיעה ב"בוא נקרא" שעוד מחכה לנתונים

function setState(s) {
  state = s;
  updateDebug();
}

function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}
const currentScreen = () => SCREENS.find((s) => !$(s).hidden) || 'screen-start';

// ---------- נתונים ----------
function normSettings(s) {
  const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
  out.level = Math.min(LEVELS.length, Math.max(1, Math.round(Number(out.level)) || 1));
  out.wordsPerReward = Math.max(1, Math.round(Number(out.wordsPerReward)) || DEFAULT_SETTINGS.wordsPerReward);
  out.attemptsBeforeNext = Math.max(1, Math.round(Number(out.attemptsBeforeNext)) || DEFAULT_SETTINGS.attemptsBeforeNext);
  out.speechRate = Number(out.speechRate) || DEFAULT_SETTINGS.speechRate;
  return out;
}

async function reloadData() {
  const [s, cw, st, rc] = await timed(Promise.all([getSettings(), listCustomWords(), getAllStats(), getKV('rewardCount', 0)]), 5000);
  settings = normSettings(s);
  customWords = Array.isArray(cw) ? cw : [];
  stats = st || {};
  rewardCount = Math.max(0, Number(rc) || 0);
}

const allWords = () => [...BASE_WORDS, ...customWords].filter((w) => w && w.id && w.text);

// ---------- תור המילים ----------
function nextWord() {
  const L = settings.level;
  const all = allWords();
  let pool = all.filter((w) => levelOf(w) <= L);
  if (!pool.length) pool = all.length ? all : BASE_WORDS;
  const st = (w) => stats[w.id] || {};

  // 1) מילים של השלב הנוכחי שעוד לא נקראו נכון  2) מילים שדילגו עליהן  3) השאר — הכי פחות נראו
  const fresh = pool.filter((w) => levelOf(w) === L && !st(w).correct);
  const skipped = pool.filter((w) => !fresh.includes(w) && st(w).lastOutcome === 'skipped');
  const rest = pool.filter((w) => !fresh.includes(w) && !skipped.includes(w));
  const leastSeen = (list) => shuffle(list).sort((a, b) => (st(a).seen || 0) - (st(b).seen || 0)).slice(0, 3);

  for (const [bucket, narrow] of [[fresh, (x) => x], [skipped, (x) => x], [rest, leastSeen]]) {
    const options = bucket.filter((w) => !recent.includes(w.id));
    if (options.length) return pickOne(narrow(options));
  }
  // מאגר קטן מאוד: רק לא אותה מילה פעמיים ברצף
  const last = recent[recent.length - 1];
  const options = pool.filter((w) => w.id !== last);
  return pickOne(options.length ? options : pool);
}

// ---------- תצוגה ----------
function coach(text, tone = '') {
  el.coach.textContent = text;
  el.coach.dataset.tone = tone;
}

function setMic(mode) { // locked | ready | listening
  el.mic.classList.toggle('is-locked', mode === 'locked');
  el.mic.classList.toggle('is-ready', mode === 'ready');
  el.mic.classList.toggle('is-listening', mode === 'listening');
  el.mic.disabled = mode !== 'ready';
}

function setNext(mode, reward = false) { // off | on
  el.next.classList.toggle('is-off', mode === 'off');
  el.next.classList.toggle('is-on', mode === 'on');
  el.next.classList.toggle('is-reward', mode === 'on' && reward);
  el.next.disabled = mode !== 'on';
}

function renderStars(popNew = false) {
  const n = settings.wordsPerReward;
  const filled = Math.min(rewardCount, n);
  el.stars.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const s = document.createElement('span');
    const on = i < filled;
    s.className = 'star' + (on ? ' is-on' : '') + (on && popNew && i === filled - 1 ? ' is-new' : '');
    s.innerHTML = icon(on ? 'star' : 'dot');
    return s;
  }));
  el.stars.setAttribute('aria-label', `${filled} מתוך ${n} עד הציור`);
}

function renderLevel() {
  const L = LEVELS.find((l) => l.id === settings.level) || LEVELS[0];
  const num = document.createElement('span');
  num.className = 'lv-num';
  num.textContent = `${STR.level} ${L.id}`;
  const name = document.createElement('span');
  name.className = 'lv-name';
  name.textContent = L.name;
  el.levelChip.replaceChildren(num, name);
}

let bannerTimer;
function showBanner() {
  const L = LEVELS.find((l) => l.id === settings.level) || LEVELS[0];
  const title = document.createElement('span');
  title.textContent = STR.levelUp;
  const name = document.createElement('span');
  name.className = 'bn-name';
  name.textContent = L.name;
  el.banner.replaceChildren(title, name);
  el.banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.banner.hidden = true; }, 2500);
}

function showPic() {
  el.pic.textContent = word?.pic || '';
  el.pic.hidden = !word?.pic;
}

function showManual(note) {
  el.manualNote.textContent = note || '';
  el.manual.hidden = false;
}

function micNote(err) {
  if (err === 'not-allowed' || err === 'service-not-allowed') return 'אין הרשאת מיקרופון. אפשר לאשר בהגדרות Safari לאתר הזה';
  if (err === 'network') return 'אין חיבור לאינטרנט לזיהוי דיבור';
  return 'זיהוי דיבור לא זמין כרגע';
}

function renderStart() {
  el.childName.textContent = (settings.childName || '').trim();
}

function renderStatus() {
  const msgs = [];
  if (!canListen) msgs.push('זיהוי דיבור לא זמין בדפדפן הזה — יוצג אישור ידני להורה');
  if (voicesChecked && !hasHebrewVoice()) msgs.push('לא נמצא קול עברי להקראה');
  el.status.textContent = msgs.join(' · ');
  el.status.hidden = !msgs.length;
}

function updateDebug() {
  if (!DEBUG) return;
  el.debugState.textContent =
    `${word?.id ?? '—'} · ${state} · ניסיונות ${attempts} · פרס ${rewardCount}/${settings.wordsPerReward} · שלב ${settings.level}`;
}

// ---------- לולאת מילה ----------
function ensureTracer() {
  if (tracer) return;
  tracer = new Tracer(el.traceHost, {
    onLetter: () => { if (state === 'trace') tick(); },
    onComplete: () => {
      if (state !== 'trace') return;
      // קובע את הצבע הסופי של המילה — אחרת ציור מחדש (שינוי גודל) צובע בצבע של המילה הקודמת
      tracer.reveal(cssVar('--pencil'));
      enterRead();
    },
    onMessy: () => {
      if (state !== 'trace') return;
      const my = loadSeq;
      softBoop();
      coach(STR.messy);
      tracer.enabled = false;
      clearTimeout(messyTimer);
      messyTimer = setTimeout(() => {
        if (my !== loadSeq || state !== 'trace') return;
        tracer.restart();
        tracer.enabled = true;
        coach(STR.trace);
      }, 1200);
    },
  });
}

async function loadWord() {
  if (gateToLogin()) return;
  ensureTracer();
  const my = ++loadSeq;
  listenSeq++;
  stopListening();

  // הסנכרון הביא שינויים (למשל מילה שההורה הוסיף מהטלפון) — טוענים לפני שבוחרים מילה
  if (dataDirty) {
    dataDirty = false;
    setState('loading');
    try { await timed(reloadData(), 1500); } catch (e) { console.warn('reloadData', e); }
    if (my !== loadSeq) return;
  }

  word = nextWord();
  recent = [...recent.filter((id) => id !== word.id), word.id].slice(-3);
  attempts = 0;
  silences = 0;
  heardBeforeRead = false;
  transcripts = [];
  clearTimeout(messyTimer);
  setState('loading');

  renderStars();
  renderLevel();
  if (bannerPending) {
    bannerPending = false;
    showBanner();
    chime();
    say(STR.levelUp, settings.speechRate);
  }
  el.pic.hidden = true;
  el.manual.hidden = true;
  el.mic.hidden = !canListen; // בלי זיהוי דיבור — אישור הורה במקום המיקרופון
  el.clear.hidden = true;
  setNext('off');
  setMic('locked');
  coach('');

  tracer.enabled = false;
  try { await tracer.setWord(word.text); } catch (e) { console.error('setWord', e); }
  if (my !== loadSeq) return;
  tracer.enabled = true;

  if (!settings.requireTrace) {
    tracer.reveal(cssVar('--ink'));
    enterRead();
  } else {
    setState('trace');
    el.clear.hidden = false;
    coach(STR.trace);
  }
}

function enterRead() {
  setState('read');
  el.clear.hidden = true;
  coach(STR.read);
  if (canListen) {
    setMic('ready');
  } else {
    el.mic.hidden = true;
    showManual('זיהוי דיבור לא זמין בדפדפן הזה');
  }
}

function startListening() {
  if (state !== 'read') return;
  window.speechSynthesis?.cancel(); // שהזיהוי לא ישמע את ההקראה
  const my = ++listenSeq;
  setState('listening');
  setMic('listening');
  coach(STR.listening);
  // רשת ביטחון: אם הזיהוי נתקע ולא חוזר — כאילו לא נשמע כלום
  const guard = setTimeout(() => {
    if (my !== listenSeq) return;
    listenSeq++;
    stopListening();
    handleHeard({ error: 'no-speech' });
  }, LISTEN_MS + 7000);
  listen({ maxMs: LISTEN_MS }).then((res) => {
    clearTimeout(guard);
    if (my !== listenSeq) return;
    handleHeard(res || { error: 'no-speech' });
  });
}

// תוצאה מהזיהוי (או מפאנל הבדיקות)
function handleHeard(res) {
  if (state !== 'listening' && state !== 'read') return;
  setState('read');
  if (res.alternatives?.length) {
    silences = 0;
    transcripts.push(res.alternatives[0]);
    if (matches(word.text, res.alternatives, settings.leniency)) success();
    else fail();
    return;
  }
  const err = res.error || 'no-speech';
  if (err === 'no-speech' || err === 'aborted') {
    coach(STR.noSpeech); // לא נספר כניסיון
    // זיהוי שחוזר ריק שוב ושוב (קורה באייפד, במיוחד ממסך הבית) — שהילד לא ייתקע: אישור הורה
    if (++silences >= 2 && el.manual.hidden) showManual('לא נשמע דיבור. אפשר לאשר ידנית');
  } else {
    coach(STR.read);
    showManual(micNote(err));
  }
  setMic('ready');
}

function fail() {
  attempts++;
  if (attempts >= settings.attemptsBeforeNext) { giveUp(); return; }
  coach(STR.retry);
  softBoop();
  setMic('ready');
  updateDebug();
}

async function success() {
  if (state === 'done') return;
  const my = loadSeq;
  const w = word;
  setState('done');
  chime();
  tracer.reveal(cssVar('--go'));
  showPic();
  coach(STR.success, 'go');
  setMic('locked');
  el.manual.hidden = true;
  setTimeout(() => { if (my === loadSeq) say(pickOne(PRAISE), settings.speechRate); }, 300);

  const outcome = heardBeforeRead ? 'heard' : 'solo';
  try {
    await timed(recordWord({ wordId: w.id, outcome, attempts: attempts + 1, transcripts: [...transcripts] }));
    stats = await timed(getAllStats());
  } catch (e) { console.warn('recordWord', e); }

  rewardCount++;
  try { await timed(setKV('rewardCount', rewardCount)); } catch (e) { console.warn('rewardCount', e); }

  // עלייה בשלב: כל מילות השלב נקראו נכון לפחות פעם אחת
  const L = settings.level;
  const levelWords = allWords().filter((x) => levelOf(x) === L);
  if (L < LEVELS.length && levelWords.length && levelWords.every((x) => stats[x.id]?.correct > 0)) {
    // על בסיס ההגדרות העדכניות במכשיר: הסנכרון אולי הביא בינתיים שינוי מהטלפון, ושמירה של העותק שבזיכרון הייתה דורסת אותו
    let base = settings;
    try { base = normSettings(await timed(getSettings())); } catch (e) { console.warn('getSettings', e); }
    settings = { ...base, level: L + 1 };
    bannerPending = true;
    try { await timed(saveSettings(settings)); } catch (e) { console.warn('saveSettings', e); }
  }

  if (my !== loadSeq) return;
  renderStars(true);
  const due = rewardCount >= settings.wordsPerReward;
  setNext('on', due);
  if (due) setTimeout(() => { if (my === loadSeq && state === 'done') coach(STR.reward, 'go'); }, 1800);
  updateDebug();
}

async function giveUp() {
  const my = loadSeq;
  const w = word;
  setState('done');
  tracer.reveal(cssVar('--pencil'));
  say(w.text, settings.speechRate);
  showPic();
  coach(STR.skipped);
  setMic('locked');
  el.manual.hidden = true;
  try {
    await timed(recordWord({ wordId: w.id, outcome: 'skipped', attempts, transcripts: [...transcripts] }));
    stats = await timed(getAllStats());
  } catch (e) { console.warn('recordWord', e); }
  if (my !== loadSeq) return;
  setNext('on', rewardCount >= settings.wordsPerReward);
  updateDebug();
}

// ---------- פרס: ציור ----------
function backToWords() {
  if (gateToLogin()) return;
  show('screen-word');
  loadWord();
}

function openReward() {
  loadSeq++;
  listenSeq++;
  stopListening();
  rewardCount = 0;
  setKV('rewardCount', 0).catch((e) => console.warn('rewardCount', e));
  setState('reward');
  show('screen-pick');
  el.pickScreen.replaceChildren();
  try {
    renderPicker(el.pickScreen, { onPick, onBack: backToWords });
  } catch (e) {
    console.error('renderPicker', e);
    backToWords();
  }
}

function onPick(page) {
  show('screen-color');
  el.colorScreen.replaceChildren();
  let colorer = null;
  let finished = false;
  const finish = async ({ blob } = {}) => {
    if (finished) return;
    finished = true;
    try { if (blob) await timed(saveDrawing({ pageId: page.id, blob }), 6000); } catch (e) { console.warn('saveDrawing', e); }
    try { colorer?.destroy(); } catch (e) { console.warn('destroy', e); }
    el.colorScreen.replaceChildren();
    backToWords();
  };
  try {
    colorer = new Colorer(el.colorScreen, page, { onDone: finish });
  } catch (e) {
    console.error('Colorer', e);
    finish();
  }
}

// ---------- שער הורה (לחיצה ארוכה) ----------
// אחרי לחיצה ארוכה iOS שולח click בנקודת השחרור — ושם כבר נמצא "חזרה לילד" של אזור ההורה.
// בולעים clicks עד רגע אחרי שהאצבע עוזבת.
function swallowReleaseClick() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('click', stop, true);
  let off = false;
  const release = () => {
    if (off) return;
    off = true;
    setTimeout(() => document.removeEventListener('click', stop, true), 400);
  };
  document.addEventListener('pointerup', release, { capture: true, once: true });
  document.addEventListener('pointercancel', release, { capture: true, once: true });
  setTimeout(release, 5000);
}

function holdGate(btn) {
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    btn.classList.remove('is-holding');
  };
  btn.addEventListener('pointerdown', (e) => {
    if (timer || (e.pointerType === 'mouse' && e.button !== 0)) return;
    btn.classList.add('is-holding');
    timer = setTimeout(() => { cancel(); swallowReleaseClick(); openParentArea(); }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancel);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function openParentArea() {
  if (parentOpen || !gateOpen) return;
  if (gateToLogin()) return;
  parentOpen = true;
  listenSeq++;
  stopListening();
  window.speechSynthesis?.cancel();
  returnTo = currentScreen();
  if (returnTo === 'screen-word') { loadSeq++; setState('parent'); }
  show('screen-parent');
  el.parentScreen.replaceChildren();
  try {
    await openParent(el.parentScreen, { onClose: closeParentArea, onSignedOut: signedOutByParent });
  } catch (e) {
    console.error('openParent', e);
    closeParentArea();
  }
}

// ההורה התנתק מאזור ההורה. parent.js סוגר את עצמו מיד אחרי זה, והסגירה מציגה את מסך הכניסה
function signedOutByParent() {
  needLogin = true;
}

async function closeParentArea() {
  if (!parentOpen) return;
  parentOpen = false;
  try { await reloadData(); } catch (e) { console.warn('reloadData', e); }
  dataDirty = false;
  bannerPending = false;
  renderStart();
  if (needLogin) { showLogin(); return; }
  show(returnTo);
  if (returnTo === 'screen-word') loadWord();
  else updateDebug();
}

// ---------- אודיו ומסך ----------
function unlockAudio() {
  tick(); // יוצר AudioContext בתוך הנגיעה
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'he-IL';
    synth.speak(u);
  } catch {}
}

async function keepAwake() {
  try {
    if (navigator.wakeLock?.request && document.visibilityState === 'visible') await navigator.wakeLock.request('screen');
  } catch {}
}

// ---------- שער כניסה ----------
// בלי חיבור לחשבון המשפחה — כל האפליקציה היא מסך הכניסה.
// החיבור נשמר במכשיר (getSession קורא אותו בלי רשת), אז מכשיר מחובר נפתח מיד גם בלי אינטרנט.
// אם החיבור נגמר באמצע (התנתקות, טוקן שבוטל) — מסך הכניסה מופיע במעבר המסך הבא.

// מסך הפתיחה עם נתונים עדכניים
function enterApp() {
  gateOpen = true;
  needLogin = false;
  clearCode();
  setLoginMsg('');
  setState('idle');
  renderStart();
  show('screen-start');
}

function showLogin() {
  gateOpen = false;
  needLogin = false;
  loadSeq++;               // מבטל טיימרים ותוצאות של המילה שהייתה
  listenSeq++;
  stopListening();
  clearTimeout(messyTimer);
  try { window.speechSynthesis?.cancel(); } catch {}
  if (tracer) tracer.enabled = false;
  el.manual.hidden = true;
  setState('login');
  clearCode();
  if (el.loginMsg.dataset.kind !== 'unavailable') setLoginMsg('');
  show('screen-login');
}

// נקודת מעבר מסך: אם החיבור נגמר בינתיים — עכשיו מציגים את מסך הכניסה
function gateToLogin() {
  if (!needLogin) return false;
  showLogin();
  return true;
}

// החיבור נגמר. באמצע מילה / ציור / אזור הורה לא עוצרים כלום; במסך הפתיחה — מיד
function requireLogin() {
  if (!gateOpen) return;
  needLogin = true;
  if (!parentOpen && currentScreen() === 'screen-start') showLogin();
}

// ---------- ענן ----------
let connecting = null;
function connectCloud() {
  if (!connecting) {
    connecting = (async () => {
      let ok = false;
      try { ok = !!(await initCloud())?.ok; } catch (e) { console.warn('initCloud', e); }
      const session = await localSession();
      if (ok) hookCloud();
      return { ok, session };
    })().finally(() => { connecting = null; });
  }
  return connecting;
}

async function localSession() {
  try { return (await getSession()) || null; } catch (e) { console.warn('getSession', e); return null; }
}

// idempotent. אם הספרייה עוד לא נטענה, הסנכרון מנסה שוב בעצמו (חזרת רשת / כל דקה)
function safeStartSync() {
  try { startSync(); } catch (e) { console.warn('startSync', e); }
}

// תוצאת בדיקת הענן (בפתיחה, בניסיון חוזר, בחזרת הרשת).
// החיבור נקרא שוב עכשיו: התמונה שנלקחה כשהספרייה נטענה כבר לא עדכנית אם בינתיים הגיעה "יציאה"
async function applyGate({ ok }) {
  const session = await localSession();
  if (session) {
    safeStartSync();
    if (!gateOpen && !loggingIn) enterApp();
    return;
  }
  requireLogin(); // החיבור השמור נמחק
  if (!ok) {
    scheduleCloudRetry();
    if (!gateOpen && !loggingIn) setLoginMsg('unavailable');
  } else if (!gateOpen && el.loginMsg.dataset.kind === 'unavailable') {
    setLoginMsg('');
  }
}

// מסך הכניסה כשהספרייה לא נטענה: מנסים שוב ברקע, עם מרווח שגדל
let retryTimer = 0;
let retryDelay = 15000;
function scheduleCloudRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = 0;
    if (isReady()) return; // נטען בינתיים (חזרת רשת / "נסה שוב")
    const g = await connectCloud();
    retryDelay = g.ok ? 15000 : Math.min(retryDelay * 2, 300000);
    applyGate(g); // לא נטען — applyGate מתזמן ניסיון נוסף
  }, retryDelay);
}

let authHooked = false;
let statusHooked = false;
function hookCloud() {
  if (!authHooked) {
    try { onAuthChange(onAuth); authHooked = true; } catch (e) { console.warn('onAuthChange', e); }
  }
  if (!statusHooked) {
    try { onStatus(onSyncStatus); statusHooked = true; } catch (e) { console.warn('onStatus', e); }
  }
}

function onAuth(ev) {
  if (ev === 'signed-out') {
    if (!loggingIn) requireLogin();
  } else if (ev === 'signed-in') {
    safeStartSync();
    // התחברות שהסתיימה אחרי שכבר הוצגה שגיאת רשת
    if (!gateOpen && !loggingIn) enterApp();
  }
}

// סנכרון הסתיים: הנתונים ב-IndexedDB אולי השתנו. טוענים בנקודה בטוחה — לא באמצע מילה
function onSyncStatus(st) {
  const at = st?.lastSyncAt ?? null;
  if (!at || at === lastSyncSeen) return;
  lastSyncSeen = at;
  dataDirty = true;
  if (gateOpen && !parentOpen && !starting && currentScreen() === 'screen-start') refreshStart();
}

let refreshing = null;
function refreshStart() {
  if (refreshing) return refreshing;
  dataDirty = false;
  refreshing = timed(reloadData(), 3000)
    .then(() => { if (currentScreen() === 'screen-start') renderStart(); })
    .catch((e) => console.warn('reloadData', e))
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ---------- מסך כניסה ----------
function renderCode() {
  const n = code.length;
  el.loginDots.replaceChildren(...Array.from({ length: Math.max(CODE_DOTS, n) }, (_, i) => {
    const d = document.createElement('span');
    d.className = 'lg-dot' + (i < n ? ' is-on' : '');
    return d;
  }));
  el.loginCount.textContent = n === 1 ? 'ספרה אחת' : n ? `${n} ספרות` : '';
  el.loginGo.disabled = loggingIn || n < CODE_MIN;
  el.loginDel.disabled = loggingIn || !n;
  for (const k of el.loginKeys) k.disabled = loggingIn;
  el.login.classList.toggle('is-busy', loggingIn);
}

function clearCode() {
  code = '';
  renderCode();
}

// kind: '' | invalid | network | rate | unavailable | unknown | busy | syncing
function setLoginMsg(kind) {
  el.loginMsg.textContent = kind ? (LOGIN_MSG[kind] || LOGIN_MSG.unknown) : '';
  el.loginMsg.dataset.kind = kind || '';
  el.loginMsg.dataset.tone = kind === 'busy' || kind === 'syncing' ? 'quiet' : kind ? 'error' : '';
  el.loginRetry.hidden = kind !== 'unavailable';
}

function typeDigit(d) {
  if (loggingIn || code.length >= CODE_MAX) return;
  const kind = el.loginMsg.dataset.kind;
  if (kind && kind !== 'unavailable') setLoginMsg('');
  code += d;
  renderCode();
}

function eraseDigit() {
  if (loggingIn || !code) return;
  code = code.slice(0, -1);
  renderCode();
}

function shakeDots() {
  el.loginDots.classList.remove('is-wrong');
  void el.loginDots.offsetWidth; // מאפס את האנימציה
  el.loginDots.classList.add('is-wrong');
}

async function submitLogin() {
  if (loggingIn || code.length < CODE_MIN) return;
  let attempt = code;
  code = '';                // הקוד לא נשמר בשום מקום אחרי הניסיון
  loggingIn = true;
  renderCode();
  setLoginMsg('busy');

  let res;
  try {
    const g = isReady() ? null : await connectCloud();
    if (g?.session) {
      res = { ok: true };
    } else if (!isReady()) {
      res = { ok: false, error: navigator.onLine === false ? 'network' : 'unavailable' };
    } else {
      const p = Promise.resolve(signIn(attempt));
      attempt = null;
      res = await Promise.race([p, wait(SIGN_IN_MS).then(() => ({ ok: false, error: 'network' }))]);
    }
  } catch (e) {
    console.warn('signIn', e);
    res = { ok: false, error: 'unknown' };
  }
  attempt = null;

  if (!res?.ok) {
    loggingIn = false;
    renderCode();
    const err = res?.error in LOGIN_MSG ? res.error : 'unknown';
    setLoginMsg(err);
    if (err === 'invalid') shakeDots();
    if (err === 'unavailable') scheduleCloudRetry();
    return;
  }

  // מחובר: סנכרון ראשון (עד 3 שניות), ואז מסך הפתיחה עם הנתונים מהענן
  setLoginMsg('syncing');
  safeStartSync();
  const first = Promise.resolve().then(() => syncNow()).catch((e) => console.warn('syncNow', e));
  await Promise.race([first, wait(FIRST_SYNC_MS)]);
  try { await timed(reloadData(), 3000); } catch (e) { console.warn('reloadData', e); }
  dataDirty = false;
  loggingIn = false;
  enterApp();
  // הסנכרון הראשון לקח יותר מ-3 שניות — כשהוא נגמר טוענים שוב
  first.then(() => {
    dataDirty = true;
    if (gateOpen && !parentOpen && currentScreen() === 'screen-start') refreshStart();
  });
}

async function retryCloud() {
  el.loginRetry.disabled = true;
  setLoginMsg('busy');
  const g = await connectCloud();
  el.loginRetry.disabled = false;
  if (gateOpen || loggingIn) return;
  setLoginMsg('');
  applyGate(g); // לא נטען — חוזר "לא ניתן להתחבר כרגע"
}

for (const k of el.loginKeys) k.addEventListener('click', () => typeDigit(k.dataset.digit));
el.loginDel.addEventListener('click', eraseDigit);
el.loginGo.addEventListener('click', submitLogin);
el.loginRetry.addEventListener('click', retryCloud);

// מקלדת חומרה
document.addEventListener('keydown', (e) => {
  if (currentScreen() !== 'screen-login' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); if (!e.repeat) typeDigit(e.key); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); eraseDigit(); return; }
  if (e.key === 'Escape') { e.preventDefault(); if (!loggingIn) clearCode(); return; }
  if (e.key === 'Enter' && document.activeElement !== el.loginRetry) { e.preventDefault(); submitLogin(); }
});

// האפליקציה עברה לרקע באמצע הקלדה — לא משאירים ספרות
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !loggingIn && code) clearCode();
});

window.addEventListener('online', () => {
  if (!isReady()) connectCloud().then(applyGate);
});

// ---------- אתחול ----------
const ready = (async () => {
  try { await reloadData(); } catch (e) { console.error('boot', e); }
  requestPersist();
  renderStart();
  renderStatus();
  updateDebug();
})();

hookCloud(); // אם זה נכשל כאן — נרשמים שוב אחרי שהענן נטען
renderCode();
(async () => {
  const gate = connectCloud();          // טעינת הספרייה ברקע
  const session = await localSession(); // מהמכשיר, בלי רשת
  if (session) {
    safeStartSync();
    await ready;
    // הילד לא מחכה לענן. בודקים שוב: "יציאה" שהגיעה בזמן הטעינה (לפני שהשער נפתח) לא נרשמה בשום מקום
    if (!gateOpen && !loggingIn) {
      if (await localSession()) enterApp();
      else showLogin();
    }
  } else {
    showLogin();                         // אפשר להתחיל להקליד בזמן שהספרייה נטענת
  }
  applyGate(await gate);
})();

// ---------- אירועים ----------
el.start.addEventListener('click', async () => {
  if (starting) return;
  starting = true;
  unlockAudio();
  keepAwake();
  started = true;
  await ready;
  starting = false;
  if (parentOpen || !gateOpen) return;
  if (gateToLogin()) return;
  show('screen-word');
  ensureTracer(); // אחרי שהמסך גלוי — ל-Tracer יש גודל
  loadWord();
});

el.clear.addEventListener('click', () => {
  if (state !== 'trace') return;
  clearTimeout(messyTimer);
  tracer.restart();
  tracer.enabled = true;
  coach(STR.trace);
});

el.hear.addEventListener('click', () => {
  if (!word) return;
  let delay = 0;
  if (state === 'listening') { // לא להקשיב להקראה עצמה
    listenSeq++;
    stopListening();
    setState('read');
    setMic('ready');
    coach(STR.read);
    delay = 250;
  }
  if (state !== 'done') heardBeforeRead = true;
  const text = word.text;
  setTimeout(() => say(text, settings.speechRate), delay);
});

el.mic.addEventListener('click', startListening);

el.next.addEventListener('click', () => {
  if (state !== 'done' || el.next.disabled) return;
  if (gateToLogin()) return;
  setNext('off');
  if (rewardCount >= settings.wordsPerReward) openReward();
  else loadWord();
});

el.manualOk.addEventListener('click', () => {
  if (state !== 'read' && state !== 'listening') return;
  listenSeq++;
  stopListening();
  transcripts.push('אישור ידני: כן');
  success();
});

el.manualNo.addEventListener('click', () => {
  if (state !== 'read' && state !== 'listening') return;
  listenSeq++;
  stopListening();
  setState('read');
  transcripts.push('אישור ידני: לא');
  fail();
});

holdGate(el.gear);
holdGate(el.gearStart);

// קולות להקראה נטענים באיחור
window.speechSynthesis?.addEventListener?.('voiceschanged', () => setTimeout(() => { voicesChecked = true; renderStatus(); }, 0));
setTimeout(() => { voicesChecked = true; renderStatus(); }, 1500);

document.addEventListener('visibilitychange', () => {
  if (started && document.visibilityState === 'visible') keepAwake();
});

// בלי זום בצביטה ובהקשה כפולה (iOS)
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  const free = !e.target.closest?.('button, input, textarea, select, label, a, canvas, [contenteditable], #screen-pick, #screen-color, #screen-parent');
  if (free && now - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// ---------- פאנל בדיקות (?debug) ----------
if (DEBUG) {
  el.debug.hidden = false;
  el.debugSay.addEventListener('click', () => {
    const text = el.debugText.value.trim();
    if (!text || (state !== 'read' && state !== 'listening')) return;
    listenSeq++;
    stopListening();
    handleHeard({ alternatives: [text] });
  });
  el.debugSkip.addEventListener('click', () => {
    if (state !== 'trace') return;
    tracer.reveal(cssVar('--pencil'));
    enterRead();
  });
  el.debugSilence.addEventListener('click', () => {
    if (state !== 'read' && state !== 'listening') return;
    listenSeq++;
    stopListening();
    handleHeard({ error: 'no-speech' });
  });
}

window.__app = {
  get state() { return state; },
  get screen() { return currentScreen(); },
  get word() { return word; },
  get attempts() { return attempts; },
  get rewardCount() { return rewardCount; },
  get tracer() { return tracer; },
};
