// חיבור ל-Supabase: טעינת הספרייה מה-CDN, כניסה עם קוד המשפחה, והחיבור נשמר במכשיר עד יציאה.
// אף פונקציה כאן לא זורקת שגיאה. getSession קורא רק מהמכשיר — עובד גם בלי רשת וגם אם הספרייה לא נטענה.

import { SUPABASE_URL, SUPABASE_KEY, FAMILY_EMAIL } from './config.js';

export const SDK_VERSION = '2.117.2';
const SDK_URL = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SDK_VERSION}/+esm`;
const STORAGE_KEY = 'otiyot-auth';
const LOAD_TIMEOUT_MS = 15000;
const FETCH_TIMEOUT_MS = 30000;
const FLUSH_MS = 5000;
const SIGNOUT_MS = 3000;
const MIN_CODE = 6; // המינימום של Supabase לסיסמה

let sb = null;
let loading = null;
let loads = 0;
let loader = (url) => import(url);
let beforeSignOut = null;
const listeners = new Set();

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function withTimeout(p, ms) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); }),
  ]);
}

// localStorage, ואם הוא חסום (מצב פרטי) — זיכרון. החיבור אז לא נשמר בין הפעלות, אבל הכל עובד.
const memStore = new Map();
const store = {
  getItem(k) {
    try { const v = globalThis.localStorage?.getItem(k); if (v != null) return v; } catch {}
    return memStore.has(k) ? memStore.get(k) : null;
  },
  setItem(k, v) {
    memStore.set(k, v);
    try { globalThis.localStorage?.setItem(k, v); } catch {}
  },
  removeItem(k) {
    memStore.delete(k);
    try { globalThis.localStorage?.removeItem(k); } catch {}
  },
};

// supabase-js שומר את החיבור כ-JSON: { access_token, refresh_token, expires_at, user, ... }.
// גם כשתוקף ה-access token פג, יש חיבור — הספרייה מחדשת אותו כשיש רשת.
function readStoredSession() {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const cur = s?.currentSession || s;
    if (cur && typeof cur === 'object' && (cur.refresh_token || cur.access_token)) return cur;
  } catch {}
  return null;
}

let authState = readStoredSession() ? 'signed-in' : 'signed-out';
function setAuth(next) {
  if (next === authState) return;
  authState = next;
  for (const cb of [...listeners]) {
    try { cb(next); } catch (e) { console.warn('onAuthChange', e); }
  }
}

// תשובות "זמניות" לפי supabase-js (לא מוחקות את החיבור)
const RETRYABLE = new Set([500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530]);

// supabase-js מוחק את החיבור השמור כשחידוש הטוקן נכשל בכל תשובה שהיא לא "זמנית" לפי הרשימה שלו —
// גם 511 של פורטל Wi-Fi, 540 / 404 / 403 בדף HTML מפרוקסי או מפרויקט מושהה, או 429 על חידוש.
// אחרי לילה תוקף הטוקן פג תמיד, כך שתשובה כזו בבוקר הייתה נועלת את הילד בחוץ (ובלי ענן אי אפשר גם להיכנס).
// רק דחייה אמיתית של Auth (JSON עם קוד שגיאה, 4xx) עוברת כמו שהיא; כל השאר מגיע לספרייה כ-503 = תקלה זמנית.
async function guardAuth(url, res) {
  if (res.ok || !/\/auth\/v1\/token\b/.test(url) || RETRYABLE.has(res.status)) return res;
  const refresh = /grant_type=refresh_token/.test(url);
  let body = null;
  try { body = await res.clone().json(); } catch {}
  const code = body && typeof body === 'object'
    ? [body.code, body.error_code, body.error].find((c) => typeof c === 'string' && c) : null;
  // 429 על כניסה עם קוד — "יותר מדי ניסיונות" (נשאר). 429 על חידוש — זמני
  if (code && res.status >= 400 && res.status < 500 && !(refresh && res.status === 429)) return res;
  return new Response(JSON.stringify({ message: `auth unavailable (HTTP ${res.status})` }), {
    status: 503, statusText: 'Service Unavailable', headers: { 'content-type': 'application/json' },
  });
}

// fetch עם הגבלת זמן — בקשה שנתקעת ברשת חלשה לא תעצור את הסנכרון
function timeoutFetch(ms) {
  return (input, init = {}) => {
    const ctrl = new AbortController();
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    const t = setTimeout(() => ctrl.abort(), ms);
    const url = typeof input === 'string' ? input : String(input?.url || input || '');
    return globalThis.fetch(input, { ...init, signal: ctrl.signal })
      .then((res) => guardAuth(url, res))
      .finally(() => clearTimeout(t));
  };
}

async function load() {
  // ניסיון חוזר עם כתובת אחרת — חלק מהדפדפנים זוכרים ייבוא שנכשל
  const url = loads++ ? `${SDK_URL}?retry=${loads}` : SDK_URL;
  try {
    const mod = await withTimeout(loader(url), LOAD_TIMEOUT_MS);
    if (typeof mod?.createClient !== 'function') throw new Error('createClient missing');
    const c = mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: STORAGE_KEY,
        storage: store,
      },
      global: { fetch: timeoutFetch(FETCH_TIMEOUT_MS) },
    });
    c.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION בלי חיבור קורה גם כשאין רשת והטוקן פג — זו לא יציאה
      if (event === 'SIGNED_OUT') setAuth('signed-out');
      else if (session) setAuth('signed-in');
    });
    sb = c;
    return { ok: true };
  } catch (e) {
    console.warn('initCloud', e);
    return { ok: false, error: e?.message === 'timeout' ? 'timeout' : 'load-failed' };
  }
}

// טוען את supabase-js (פעם אחת). אפשר לקרוא שוב ושוב; אחרי כישלון — מנסה מחדש.
export async function initCloud() {
  if (sb) return { ok: true };
  if (!loading) loading = load().finally(() => { loading = null; });
  return loading;
}

export function isReady() {
  return !!sb;
}

export function client() {
  return sb;
}

// מהמכשיר בלבד, בלי רשת. אם החיבור השתנה מבחוץ (לשונית אחרת) — מודיע למאזינים
export async function getSession() {
  const s = readStoredSession();
  setAuth(s ? 'signed-in' : 'signed-out');
  return s;
}

export async function signIn(code) {
  const password = String(code ?? '').trim();
  if (!password) return { ok: false, error: 'invalid' };
  if (!sb) {
    const r = await initCloud();
    if (!r.ok) return { ok: false, error: offline() ? 'network' : 'unavailable' };
  }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: FAMILY_EMAIL, password });
    if (error) return { ok: false, error: signInError(error) };
    if (!data?.session) return { ok: false, error: 'unknown' };
    setAuth('signed-in');
    return { ok: true };
  } catch (e) {
    console.warn('signIn', e);
    return { ok: false, error: offline() ? 'network' : 'unknown' };
  }
}

function signInError(e) {
  const status = Number(e?.status) || 0;
  const code = String(e?.code || '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(e?.message || '')) return 'invalid';
  if (status === 429 || code.startsWith('over_')) return 'rate';
  if (e?.name === 'AuthRetryableFetchError') return status >= 500 ? 'unavailable' : 'network';
  if (offline()) return 'network';
  if (status >= 500) return 'unavailable';
  if (code === 'validation_failed') return 'invalid';
  return 'unknown';
}

// מחכה לדחיפת השינויים לפני יציאה (sync.js רושם את זה)
export function onBeforeSignOut(fn) {
  beforeSignOut = typeof fn === 'function' ? fn : null;
}

// יציאה מהמכשיר הזה בלבד (scope: local) — הטלפון של ההורה נשאר מחובר
export async function signOut() {
  if (readStoredSession()) authState = 'signed-in'; // בשקט: שהיציאה תדווח פעם אחת גם אם המצב השמור לא היה מעודכן
  if (beforeSignOut && !offline()) {
    try { await withTimeout(Promise.resolve().then(beforeSignOut), FLUSH_MS); } catch (e) { console.warn('signOut flush', e?.message || e); }
  }
  if (sb) {
    try { await withTimeout(sb.auth.signOut({ scope: 'local' }), SIGNOUT_MS); } catch (e) { console.warn('signOut', e?.message || e); }
  }
  // גם בלי רשת: החיבור נמחק מהמכשיר
  for (const k of [STORAGE_KEY, `${STORAGE_KEY}-user`, `${STORAGE_KEY}-code-verifier`]) store.removeItem(k);
  setAuth('signed-out');
}

export async function changeCode(newCode) {
  const password = String(newCode ?? '').trim();
  if (password.length < MIN_CODE) return { ok: false, error: 'weak' };
  if (!readStoredSession()) return { ok: false, error: 'unknown' };
  if (!sb) {
    const r = await initCloud();
    if (!r.ok) return { ok: false, error: 'network' };
  }
  try {
    const { error } = await sb.auth.updateUser({ password });
    if (!error) return { ok: true };
    const code = String(error.code || '');
    const status = Number(error.status) || 0;
    if (code === 'same_password' || /different from the old/i.test(error.message || '')) return { ok: false, error: 'same' };
    if (code === 'weak_password' || error.name === 'AuthWeakPasswordError') return { ok: false, error: 'weak' };
    if (error.name === 'AuthRetryableFetchError' || offline() || status >= 500) return { ok: false, error: 'network' };
    return { ok: false, error: 'unknown' };
  } catch (e) {
    console.warn('changeCode', e);
    return { ok: false, error: offline() ? 'network' : 'unknown' };
  }
}

// cb('signed-in' | 'signed-out') — רק כשהמצב משתנה
export function onAuthChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// לבדיקות בלבד: טוען מודול אחר במקום ה-CDN
export function _setLoader(fn) {
  loader = fn;
}
