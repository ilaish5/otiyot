// סנכרון מקומי-קודם מול Supabase. הכתיבות כבר שמורות ב-IndexedDB (db.js) ובתור; כאן:
// push — מרוקן את התור לפי הסדר. pull — מושך שינויים ממכשירים אחרים (למשל מילה שההורה הוסיף מהטלפון).
// שום דבר כאן לא חוסם את הילד: הכל ברקע, וכל כישלון רשת רק נדחה לניסיון הבא.

import * as db from './db.js';
import { initCloud, isReady, getSession, client, onAuthChange, onBeforeSignOut } from './cloud.js';

const PUSH_DEBOUNCE_MS = 2000;
const POLL_MS = 60000;
const PAGE = 500;            // שורות לבקשה במשיכה
const OVERLAP_MS = 30000;    // משיכה חופפת קצת אחורה — שורה שנכתבה ברגע הסמן לא תפוספס (המיזוג אידמפוטנטי)
const BATCH = 100;           // ניסיונות לבקשה בדחיפה
const PEEK = 200;
const MAX_TRIES = 3;
const BACKOFF_MS = [5, 15, 30, 60, 120, 300].map((s) => s * 1000);
const BUCKET = 'drawings';

const MSG = {
  push: 'חלק מהשינויים לא נשמרו בענן',
  server: 'השרת לא זמין כרגע',
  pull: 'טעינה מהענן נכשלה',
};

const status = { state: 'idle', pending: 0, lastSyncAt: null, error: null };
const listeners = new Set();
const changeListeners = new Set();
const fetching = new Map();
const cleanups = [];

let started = false;
let running = null;
let queued = null;
let waiters = [];
let pushTimer = 0;
let retryTimer = 0;
let backoff = 0;

// ---------- מצב ----------
export function getStatus() {
  return { ...status };
}

export function onStatus(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// שינויים שנמשכו מהענן: cb({ settings, words, attempts, drawings }) — כדי שהמסך יטען מחדש
export function onRemoteChange(cb) {
  if (typeof cb !== 'function') return () => {};
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function setStatus(patch) {
  let diff = false;
  for (const [k, v] of Object.entries(patch)) if (status[k] !== v) { status[k] = v; diff = true; }
  if (!diff) return;
  const snap = getStatus();
  for (const cb of [...listeners]) { try { cb(snap); } catch (e) { console.warn('onStatus', e); } }
}

async function refreshPending() {
  try { setStatus({ pending: await db.pendingCount() }); } catch {}
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

// ---------- שגיאות ----------
class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; } // kind: network | transient | fatal
}

function classify(error, httpStatus) {
  if (isOffline()) return 'network';
  const name = error?.name || '';
  const st = Number(httpStatus ?? error?.status) || 0;
  if (name === 'StorageUnknownError' || name === 'AuthRetryableFetchError') return st >= 500 ? 'transient' : 'network';
  if (st === 0) return 'network'; // fetch נכשל / בוטל (postgrest מחזיר status 0)
  if (st === 401 || st === 408 || st === 429 || st >= 500) return 'transient';
  const code = String(error?.code || '');
  if (code === 'PGRST301' || code === 'PGRST303') return 'transient'; // JWT פג — הספרייה תחדש
  return 'fatal';
}

const describe = (e) => [e?.code, e?.status || e?.statusCode, e?.message].filter(Boolean).join(' ').slice(0, 300) || 'error';

// res: { error, status } של supabase-js
function check(res) {
  if (!res?.error) return res;
  const kind = classify(res.error, res.status);
  throw new SyncError(kind, describe(res.error));
}

// ---------- מיפוי לעמודות ב-Supabase ----------
const OUTCOMES = new Set(['solo', 'heard', 'skipped']);
const iso = (ms) => new Date(Number(ms) || Date.now()).toISOString();
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const drawingPath = (uid, id) => `${uid}/${id}.png`;

function attemptToRemote(r, uid) {
  if (!r || !r.uuid || r.wordId == null || !OUTCOMES.has(r.outcome)) return null;
  const transcripts = Array.isArray(r.transcripts) ? r.transcripts.filter((t) => typeof t === 'string') : [];
  return {
    id: r.uuid,
    user_id: uid,
    word_id: String(r.wordId),
    outcome: r.outcome,
    attempts: clampInt(r.attempts, 0, 1000, 0),
    transcripts,
    ts: iso(r.ts),
  };
}

// ---------- push ----------
async function pushOne(sb, uid, op) {
  if (op.op === 'reset') {
    // כל הניסיונות עד רגע האיפוס (ניסיונות שנרשמו אחריו — בכל מכשיר — נשארים)
    check(await sb.from('attempts').delete().eq('user_id', uid).lte('ts', iso(op.row?.ts ?? op.ts)));
    return;
  }
  if (op.table === 'settings') {
    const s = await db.getSettings(); // תמיד המצב העדכני, לא הצילום שבתור
    const { updatedAt, ...data } = s;
    check(await sb.from('settings').upsert({ user_id: uid, data }, { onConflict: 'user_id' }));
    await db.settingsPushed(data); // זה מה שיש עכשיו בשרת — הבסיס למיזוג השדות בפעם הבאה
    return;
  }
  if (op.table === 'words') {
    const w = (await db.getCustomWord(op.key)) || op.row || {};
    if (!w.text) throw new SyncError('fatal', 'word without text');
    check(await sb.from('words').upsert({
      user_id: uid,
      id: String(op.key),
      text: w.text,
      pic: w.pic || '',
      level: clampInt(w.level, 1, 20, 1),
      deleted: op.op === 'delete' || !!w.deleted,
    }, { onConflict: 'user_id,id' }));
    return;
  }
  if (op.table === 'drawings') {
    const path = drawingPath(uid, op.key);
    if (op.op === 'delete') {
      const r = op.row || {};
      check(await sb.from('drawings').upsert({
        id: op.key, user_id: uid, page_id: String(r.pageId ?? ''), storage_path: path, ts: iso(r.ts), deleted: true,
      }, { onConflict: 'id' }));
      check(await sb.storage.from(BUCKET).remove([path]));
      return;
    }
    const d = await db.getDrawingByUuid(op.key);
    if (!d || d.deleted || !d.blob) return; // נמחק בינתיים (פעולת מחיקה בדרך) או שאין מה להעלות
    const blob = d.blob.type === 'image/png' ? d.blob : new Blob([d.blob], { type: 'image/png' });
    // קודם הקובץ, אחר כך השורה — שורה בלי קובץ לא תגיע למכשיר אחר
    check(await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/png', cacheControl: '31536000' }));
    check(await sb.from('drawings').upsert({
      id: d.uuid, user_id: uid, page_id: String(d.pageId ?? ''), storage_path: path, ts: iso(d.ts), deleted: false,
    }, { onConflict: 'id' }));
    return;
  }
  throw new SyncError('fatal', `unknown op ${op.op}/${op.table}`);
}

// מחזיר רשימת כישלונות לא-רשתיים [{ op, error }]. כישלון רשת/שרת זורק ועוצר את הדחיפה.
async function pushGroup(sb, uid, group) {
  const first = group[0];
  if (first.table === 'attempts' && first.op === 'upsert') {
    const bad = [];
    const good = [];
    const rows = [];
    for (const o of group) {
      const r = attemptToRemote(o.row, uid);
      if (r) { good.push(o); rows.push(r); } else bad.push({ op: o, error: 'invalid attempt row', dead: true });
    }
    if (!rows.length) return bad;
    const res = await sb.from('attempts').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (!res?.error) { await db.outboxDelete(good.map((o) => o.id)); return bad; }
    const kind = classify(res.error, res.status);
    if (kind !== 'fatal') throw new SyncError(kind, describe(res.error));
    if (good.length === 1) return [...bad, { op: good[0], error: describe(res.error) }];
    // שורה אחת פגומה לא תעצור את כל השאר — שולחים אחת-אחת
    const out = [...bad];
    for (const o of good) out.push(...await pushGroup(sb, uid, [o]));
    return out;
  }
  try {
    await pushOne(sb, uid, first);
    await db.outboxDelete([first.id]);
    return [];
  } catch (e) {
    if (e instanceof SyncError && e.kind !== 'fatal') throw e;
    return [{ op: first, error: describe(e) }];
  }
}

// מרוקן את התור לפי הסדר. מחזיר הודעת שגיאה קצרה אם פעולה כלשהי נכשלה (לא ברשת), אחרת null
async function push(sb, uid) {
  let failure = null;
  let after = 0;
  for (;;) {
    const ops = await db.outboxPeek(PEEK, after);
    if (!ops.length) break;
    let stop = false;
    for (let i = 0; i < ops.length && !stop;) {
      const group = [ops[i]];
      if (ops[i].table === 'attempts' && ops[i].op === 'upsert') {
        while (i + group.length < ops.length && group.length < BATCH
          && ops[i + group.length].table === 'attempts' && ops[i + group.length].op === 'upsert') group.push(ops[i + group.length]);
      }
      i += group.length;
      after = group[group.length - 1].id;
      for (const f of await pushGroup(sb, uid, group)) {
        failure = MSG.push;
        const tries = (Number(f.op.tries) || 0) + 1;
        console.warn('sync push failed', f.op.table, f.op.op, f.error);
        if (f.dead || tries >= MAX_TRIES) {
          await db.outboxToDeadLetter(f.op.id, f.error);
        } else {
          await db.outboxUpdate(f.op.id, { tries, lastError: f.error });
          // reset הוא מחסום: מה שאחריו (ניסיונות חדשים, ההגדרות שמודיעות על האיפוס) מחכה לו
          if (f.op.op === 'reset') stop = true;
        }
      }
      await refreshPending();
    }
    if (stop) break;
  }
  return failure;
}

// ---------- pull ----------
async function fetchSince(sb, table, cols, col, uid) {
  const cursor = await db.getSyncMeta(`cursor:${table}`);
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
  const rows = [];
  let max = cursor;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).eq('user_id', uid);
    if (since) q = q.gt(col, since);
    const res = check(await q.order(col, { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1));
    const page = Array.isArray(res.data) ? res.data : [];
    rows.push(...page);
    for (const r of page) if (r[col] && (!max || Date.parse(r[col]) > Date.parse(max))) max = r[col];
    if (page.length < PAGE) break;
  }
  return { rows, max };
}

async function pull(sb, uid) {
  const changed = { settings: false, words: false, attempts: false, drawings: false };

  // הגדרות קודם: אם ההתקדמות אופסה במכשיר אחר — מאפסים את סמן הניסיונות ומושכים הכל מחדש
  const s = check(await sb.from('settings').select('data, updated_at').eq('user_id', uid).maybeSingle());
  if (s.data) {
    const r = await db.applyRemoteSettings(s.data);
    if (r.changed) changed.settings = true;
    if (r.reset) { await db.setSyncMeta('cursor:attempts', null); changed.attempts = true; }
  }

  const words = await fetchSince(sb, 'words', 'id, text, pic, level, deleted, updated_at', 'updated_at', uid);
  if (words.rows.length && (await db.applyRemoteWords(words.rows)) > 0) changed.words = true;
  if (words.max) await db.setSyncMeta('cursor:words', words.max);

  // created_at = זמן ההכנסה בשרת: ניסיון שעלה באיחור ממכשיר אחר לא יפוספס
  const att = await fetchSince(sb, 'attempts', 'id, word_id, outcome, attempts, transcripts, ts, created_at', 'created_at', uid);
  if (att.rows.length && (await db.applyRemoteAttempts(att.rows)) > 0) {
    await db.rebuildStats();
    changed.attempts = true;
  }
  if (att.max) await db.setSyncMeta('cursor:attempts', att.max);

  const dr = await fetchSince(sb, 'drawings', 'id, page_id, storage_path, ts, deleted, updated_at', 'updated_at', uid);
  if (dr.rows.length && (await db.applyRemoteDrawings(dr.rows)) > 0) changed.drawings = true;
  if (dr.max) await db.setSyncMeta('cursor:drawings', dr.max);

  if (Object.values(changed).some(Boolean)) {
    for (const cb of [...changeListeners]) { try { cb({ ...changed }); } catch (e) { console.warn('onRemoteChange', e); } }
  }
}

// ---------- מחזור ----------
async function checkUser(uid) {
  const prev = await db.getSyncMeta('uid');
  if (prev === uid) return;
  // משתמש אחר (או פעם ראשונה): מושכים הכל מההתחלה
  for (const t of ['words', 'attempts', 'drawings']) await db.setSyncMeta(`cursor:${t}`, null);
  await db.setSyncMeta('settingsBase', null);
  await db.setSyncMeta('uid', uid);
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const ms = BACKOFF_MS[Math.min(backoff, BACKOFF_MS.length - 1)];
  backoff++;
  retryTimer = setTimeout(() => { retryTimer = 0; request('full'); }, ms);
}

async function cycle(kind) {
  clearTimeout(pushTimer); pushTimer = 0;
  clearTimeout(retryTimer); retryTimer = 0;
  const session = await getSession();
  const uid = session?.user?.id;
  if (!session || !uid) {
    await refreshPending();
    setStatus({ state: 'signed-out', error: null });
    return;
  }
  if (isOffline()) {
    await refreshPending();
    setStatus({ state: 'offline', error: null }); // האירוע 'online' יפעיל שוב
    return;
  }
  if (!isReady()) {
    const r = await initCloud();
    if (!r.ok) {
      await refreshPending();
      setStatus({ state: 'unavailable', error: null }); // ננסה שוב בהפעלה הבאה
      return;
    }
  }
  const sb = client();
  setStatus({ state: 'syncing' });
  try {
    await checkUser(uid);
    if (kind === 'full') {
      try { await pull(sb, uid); } catch (e) {
        if (e instanceof SyncError && e.kind === 'fatal') throw new SyncError('fatal', `${MSG.pull}: ${e.message}`);
        throw e;
      }
    }
    const failure = await push(sb, uid);
    backoff = 0;
    await refreshPending();
    setStatus({ state: failure ? 'error' : 'idle', error: failure, lastSyncAt: Date.now() });
  } catch (e) {
    await refreshPending();
    if (!(await getSession())) { setStatus({ state: 'signed-out', error: null }); return; }
    const k = e instanceof SyncError ? e.kind : 'fatal'; // חריגה מקומית (למשל IndexedDB) — לא בעיית רשת
    console.warn('sync', k, e?.message || e);
    if (k === 'network') setStatus({ state: 'offline', error: null });
    else setStatus({ state: 'error', error: k === 'transient' ? MSG.server : (String(e?.message || '').startsWith(MSG.pull) ? MSG.pull : MSG.push) });
    scheduleRetry();
  }
}

// מחזור אחד בכל פעם. בקשות שמגיעות בזמן ריצה מתאחדות לריצה אחת נוספת.
function request(kind) {
  if (running) {
    queued = queued === 'full' || kind === 'full' ? 'full' : 'push';
    return new Promise((resolve) => waiters.push(resolve));
  }
  running = cycle(kind).catch((e) => console.warn('sync cycle', e)).then(() => {
    running = null;
    if (queued) {
      const k = queued;
      const ws = waiters;
      queued = null;
      waiters = [];
      request(k).then((st) => ws.forEach((r) => r(st)));
    }
    return getStatus();
  });
  return running;
}

function schedulePush(ms = PUSH_DEBOUNCE_MS) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = 0; request('push'); }, ms);
}

function onLocalWrite() {
  refreshPending();
  schedulePush();
}

// ---------- API ----------
export function startSync() {
  if (started) return;
  started = true;
  db.setWriteHook(onLocalWrite);
  cleanups.push(onAuthChange((s) => {
    if (s === 'signed-in') { backoff = 0; request('full'); } else {
      clearTimeout(pushTimer); clearTimeout(retryTimer);
      pushTimer = retryTimer = 0;
      setStatus({ state: 'signed-out', error: null });
    }
  }));
  onBeforeSignOut(() => request('push'));
  const on = (target, ev, fn) => {
    if (!target?.addEventListener) return;
    target.addEventListener(ev, fn);
    cleanups.push(() => target.removeEventListener(ev, fn));
  };
  const win = typeof window !== 'undefined' ? window : null;
  on(win, 'online', () => { backoff = 0; request('full'); });
  on(win, 'offline', () => { if (status.state !== 'signed-out') setStatus({ state: 'offline' }); });
  on(typeof document !== 'undefined' ? document : null, 'visibilitychange', () => {
    if (isVisible()) request('full'); else request('push');
  });
  const poll = setInterval(() => { if (isVisible()) request('full'); }, POLL_MS);
  cleanups.push(() => clearInterval(poll));
  refreshPending();
  request('full');
}

// עוצר את כל הטריגרים (לבדיקות, או לפני החלפת משתמש)
export function stopSync() {
  started = false;
  db.setWriteHook(null);
  onBeforeSignOut(null);
  while (cleanups.length) { try { cleanups.pop()(); } catch {} }
  clearTimeout(pushTimer); clearTimeout(retryTimer);
  pushTimer = retryTimer = 0;
}

// pull + push עכשיו. מחזיר את המצב בסוף
export function syncNow() {
  return request('full');
}

// ציור שקיים רק בענן: מוריד, שומר במכשיר ומחזיר Blob. בלי רשת / בלי חיבור — null
export async function fetchDrawingBlob(drawing) {
  if (!drawing) return null;
  if (drawing.blob) return drawing.blob;
  const id = drawing.uuid;
  if (!id) return null;
  if (fetching.has(id)) return fetching.get(id);
  const p = (async () => {
    const session = await getSession();
    const uid = session?.user?.id;
    if (!uid || isOffline()) return null;
    if (!isReady() && !(await initCloud()).ok) return null;
    const res = await client().storage.from(BUCKET).download(drawing.storagePath || drawingPath(uid, id));
    if (res?.error || !res?.data) return null;
    const blob = res.data.type === 'image/png' ? res.data : new Blob([res.data], { type: 'image/png' });
    await db.setDrawingBlob(id, blob);
    return blob;
  })().catch((e) => { console.warn('fetchDrawingBlob', e?.message || e); return null; }).finally(() => fetching.delete(id));
  fetching.set(id, p);
  return p;
}
