// שכבת נתונים אחת לכל האפליקציה: IndexedDB על המכשיר, מקומי-קודם.
// כל כתיבה נשמרת כאן מיד (הילד אף פעם לא מחכה לרשת) ונכנסת לתור שינויים (outbox).
// js/sync.js דוחף את התור ל-Supabase ומושך שינויים ממכשירים אחרים דרך הפונקציות "לסנכרון בלבד" למטה.
// אם IndexedDB לא זמין — הכל עובד בזיכרון (בלי תור ובלי שמירה בין הפעלות).

const DB_NAME = 'otiyot';
const DB_VERSION = 2;

export const DEFAULT_SETTINGS = {
  childName: '',
  requireTrace: true,
  wordsPerReward: 5,
  attemptsBeforeNext: 2,
  leniency: 'normal', // strict | normal | lenient
  speechRate: 0.75,
  level: 1,
  analyzeLeft: 30, // כמה ניסיונות קריאה הבאים יוקלטו לניתוח (0 = כבוי)
};

const SETTINGS_KEY = 'settings';
const META_PREFIX = 'sync:';
const DEAD_KEY = 'sync:deadLetter';
const DEAD_MAX = 100;
// הגרסה האחרונה של ההגדרות שהמכשיר ראה בשרת: { data, at } — at בזמן שרת (לא בשעון המכשיר)
const SETTINGS_BASE = META_PREFIX + 'settingsBase';
// הגרסאות האחרונות של ההגדרות במכשיר [{ updatedAt, data, remote }] — כדי ששמירה של עותק ישן לא תמחק שינוי שהגיע מהענן
const SETTINGS_HIST = META_PREFIX + 'settingsHist';
const HIST_MAX = 30;
const ALL_STORES = ['kv', 'words', 'stats', 'attempts', 'drawings', 'outbox'];
const KEYPATH = { words: 'id', stats: 'wordId', attempts: 'id', drawings: 'id', outbox: 'id' };
const AUTO = new Set(['attempts', 'drawings', 'outbox']);
// טבלאות שבהן רק הפעולה האחרונה לכל מפתח חשובה — פעולה חדשה מחליפה את הקודמת ועוברת לסוף התור
const COALESCE = new Set(['settings', 'words', 'drawings']);

let dbp = null;
let useMem = false;
const mem = { kv: new Map(), words: new Map(), stats: new Map(), attempts: new Map(), drawings: new Map(), outbox: new Map() };
const memSeq = { attempts: 0, drawings: 0, outbox: 0 };
let writeHook = null;

// ---------- מזהים ----------
export function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  // randomUUID קיים רק ב-HTTPS / localhost
  const b = new Uint8Array(16);
  try { globalThis.crypto.getRandomValues(b); } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// ---------- פתיחה ושדרוג ----------
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { useMem = true; return resolve(null); }
    req.onupgradeneeded = (e) => {
      try { upgrade(req.result, req.transaction, e.oldVersion || 0); } catch (err) {
        console.error('db upgrade', err);
        try { req.transaction.abort(); } catch {}
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // גרסה חדשה נפתחת בלשונית אחרת — משחררים, ובקריאה הבאה נפתח מחדש
      db.onversionchange = () => { db.close(); if (dbp) dbp = null; };
      db.onclose = () => { dbp = null; };
      resolve(db);
    };
    req.onerror = () => { useMem = true; resolve(null); };
    req.onblocked = () => console.warn('db: upgrade waits for another open tab to close');
  });
  return dbp;
}

function upgrade(db, t, old) {
  if (old < 1) {
    db.createObjectStore('kv');
    db.createObjectStore('words', { keyPath: 'id' });
    db.createObjectStore('stats', { keyPath: 'wordId' });
    const a = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
    a.createIndex('ts', 'ts');
    db.createObjectStore('drawings', { keyPath: 'id', autoIncrement: true });
  }
  if (old < 2) {
    db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    t.objectStore('attempts').createIndex('uuid', 'uuid', { unique: true });
    t.objectStore('drawings').createIndex('uuid', 'uuid', { unique: true });
    if (old >= 1) migrateV1(t);
  }
}

// v1 → v2: מזהים ייחודיים, חותמות זמן, ותור עם כל מה שכבר קיים — כדי שההתקדמות הקיימת תעלה לענן
function migrateV1(t) {
  const now = Date.now();
  const kv = t.objectStore('kv');
  const outbox = t.objectStore('outbox');
  const op = (o) => outbox.add({ op: 'upsert', key: null, row: null, tries: 0, ts: now, ...o });
  const each = (store, fn, done) => {
    const c = t.objectStore(store).openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return done();
      fn(cur);
      cur.continue();
    };
  };
  const g = kv.get(SETTINGS_KEY);
  g.onsuccess = () => {
    if (g.result && typeof g.result === 'object') {
      const s = { ...g.result, updatedAt: now };
      kv.put(s, SETTINGS_KEY);
      kv.put([{ updatedAt: now, data: settingsData(s), remote: false }], SETTINGS_HIST);
      op({ table: 'settings', key: SETTINGS_KEY, row: settingsData(s) });
    }
    each('words', (cur) => {
      const w = { ...cur.value, custom: true, deleted: false, updatedAt: now };
      cur.update(w);
      op({ table: 'words', key: w.id, row: wordRow(w) });
    }, () => each('attempts', (cur) => {
      const a = { ...cur.value, uuid: isUuid(cur.value.uuid) ? cur.value.uuid : uuid() };
      cur.update(a);
      op({ table: 'attempts', key: a.uuid, row: attemptRow(a) });
    }, () => each('drawings', (cur) => {
      const d = { ...cur.value, uuid: isUuid(cur.value.uuid) ? cur.value.uuid : uuid(), deleted: false, updatedAt: now, storagePath: null };
      cur.update(d);
      op({ table: 'drawings', key: d.uuid, row: drawingRow(d) });
    }, () => {})));
  };
}

// ---------- טרנזקציות: אותו API ל-IndexedDB ולזיכרון ----------
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function idbApi(t) {
  const st = (s) => t.objectStore(s);
  return {
    mem: false,
    get: (s, k) => req2p(st(s).get(k)),
    all: (s) => req2p(st(s).getAll()),
    first: (s, limit, after) => req2p(st(s).getAll(after > 0 ? IDBKeyRange.lowerBound(after, true) : undefined, limit)),
    put: (s, v, k) => req2p(k === undefined ? st(s).put(v) : st(s).put(v, k)),
    add: (s, v) => req2p(st(s).add(v)),
    del: (s, k) => req2p(st(s).delete(k)),
    clear: (s) => req2p(st(s).clear()),
    count: (s) => req2p(st(s).count()),
    byIndex: (s, i, k) => req2p(st(s).index(i).get(k)),
    recent: (s, i, limit) => new Promise((resolve, reject) => {
      const out = [];
      const cur = st(s).index(i).openCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) return resolve(out);
        out.push(c.value);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    }),
  };
}

const copy = (v) => (v && typeof v === 'object' && !Array.isArray(v) && !(typeof Blob !== 'undefined' && v instanceof Blob) ? { ...v } : v);

function memApi() {
  const keyOf = (s, v) => {
    const kp = KEYPATH[s];
    if (v && v[kp] !== undefined) return v[kp];
    if (AUTO.has(s)) return ++memSeq[s];
    throw new DOMException('missing key', 'DataError');
  };
  const store = (s, v, k, mustBeNew) => {
    const key = k !== undefined ? k : keyOf(s, v);
    if (mustBeNew && mem[s].has(key)) throw new DOMException('key exists', 'ConstraintError');
    const row = copy(v);
    if (s !== 'kv' && AUTO.has(s)) {
      row.id = key;
      if (typeof key === 'number' && key > memSeq[s]) memSeq[s] = key;
    }
    mem[s].set(key, row);
    return key;
  };
  return {
    mem: true,
    get: async (s, k) => copy(mem[s].get(k)),
    all: async (s) => [...mem[s].values()].map(copy),
    first: async (s, limit, after) => [...mem[s].values()].filter((r) => !(after > 0) || r.id > after).slice(0, limit).map(copy),
    put: async (s, v, k) => store(s, v, k, false),
    add: async (s, v) => store(s, v, undefined, true),
    del: async (s, k) => { mem[s].delete(k); },
    clear: async (s) => { mem[s].clear(); },
    count: async (s) => mem[s].size,
    byIndex: async (s, i, k) => copy([...mem[s].values()].find((r) => r && r[i] === k)),
    recent: async (s, i, limit) => [...mem[s].values()].sort((a, b) => (b[i] - a[i]) || (b.id - a.id)).slice(0, limit).map(copy),
  };
}

function idbRun(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(stores, mode); } catch (e) { e.closedDb = e?.name === 'InvalidStateError'; return reject(e); }
    let out;
    let failed = null;
    let done = false;
    const finish = (err) => { if (done) return; done = true; if (err) reject(err); else resolve(out); };
    t.oncomplete = () => finish(failed);
    // ביטול בלי אירוע error (למשל חריגה ממקום בזמן commit) — אחרת ההבטחה לא נסגרת לעולם
    t.onabort = () => finish(failed || t.error || new DOMException('Transaction aborted', 'AbortError'));
    let p;
    try { p = Promise.resolve(fn(idbApi(t))); } catch (e) { p = Promise.reject(e); }
    p.then((r) => { out = r; }, (e) => {
      failed = e || new Error('transaction failed');
      try { t.abort(); } catch {}
    });
  });
}

// fn מקבל api של טרנזקציה. בתוך fn רק פעולות על ה-api (בלי await לרשת) — אחרת הטרנזקציה נסגרת.
async function run(stores, mode, fn) {
  let db = await open();
  if (!db) return fn(memApi());
  try {
    return await idbRun(db, stores, mode, fn);
  } catch (e) {
    if (!e?.closedDb) throw e;
    dbp = null; // החיבור נסגר (Safari עושה את זה לפעמים) — פותחים מחדש פעם אחת
    db = await open();
    if (!db) return fn(memApi());
    return idbRun(db, stores, mode, fn);
  }
}

function notify() {
  try { writeHook?.(); } catch (e) { console.warn('write hook', e); }
}

// ---------- התור (outbox) ----------
// פעולה: { op: 'upsert'|'delete'|'reset', table, key, row, tries, ts }
async function enqueue(a, { op, table, key = null, row = null }) {
  if (a.mem) return; // בזיכרון אין תור
  if (COALESCE.has(table) && key != null) {
    for (const o of await a.all('outbox')) {
      if (o.table === table && o.key === key && o.op !== 'reset') await a.del('outbox', o.id);
    }
  }
  await a.add('outbox', { op, table, key, row, tries: 0, ts: Date.now() });
}

async function pendingSet(a, table) {
  if (a.mem) return new Set();
  const out = new Set();
  for (const o of await a.all('outbox')) if (o.table === table && o.key != null) out.add(o.key);
  return out;
}

// צילום מצב לתור (בלי תמונות — את הציור עצמו sync.js קורא מהמאגר בזמן הדחיפה)
function settingsData(s) {
  const { updatedAt, ...data } = s || {};
  return data;
}
const wordRow = (w) => ({ id: w.id, text: w.text, pic: w.pic || '', level: w.level, deleted: !!w.deleted });
const attemptRow = (a) => ({ uuid: a.uuid, wordId: a.wordId, outcome: a.outcome, attempts: a.attempts, transcripts: a.transcripts, ts: a.ts });
const drawingRow = (d) => ({ uuid: d.uuid, pageId: d.pageId, ts: d.ts });

// זמן עדכון מקומי (שעון המכשיר), עולה תמיד. משמש רק כמזהה גרסה במכשיר — אף פעם לא משווים אותו לזמני השרת.
// ההשוואה לשרת נעשית מול syncedAt / SETTINGS_BASE.at, שהם זמני שרת, כך ששעון מכשיר שמקדים או מאחר לא משנה.
const stamp = (prev) => Math.max(Date.now(), (Number(prev?.updatedAt) || 0) + 1);

// ---------- settings ----------
const normS = (x) => ({ ...DEFAULT_SETTINGS, ...(x && typeof x === 'object' ? x : {}) });
const eqv = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// השדות ששונים בין שני עותקים של ההגדרות (בלי updatedAt)
function diffKeys(x, y) {
  const a = normS(x);
  const b = normS(y);
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k !== 'updatedAt' && !eqv(a[k], b[k])) out.push(k);
  }
  return out;
}

// כל כתיבה של ההגדרות עוברת כאן: נשמרת גם ברשימת הגרסאות האחרונות. remote — השינוי הגיע מהענן.
// first — זו הגרסה הראשונה שהייתה אי פעם במכשיר (לפניה רק ברירות המחדל)
async function putSettings(a, s, remote = false, prev = undefined) {
  await a.put('kv', s, SETTINGS_KEY);
  const hist = (await a.get('kv', SETTINGS_HIST)) || [];
  const h = { updatedAt: s.updatedAt, data: settingsData(s), remote };
  if (!hist.length && !prev) h.first = true;
  hist.push(h);
  await a.put('kv', hist.slice(-HIST_MAX), SETTINGS_HIST);
}

// שמירה של עותק ישן (נקרא בגרסה readAt, ומאז נמשך שינוי מהענן): השדות שהענן שינה אחרי readAt
// והמתקשר לא נגע בהם נשארים כמו שהם עכשיו. readAt = 0: העותק נקרא לפני שהיו הגדרות (ברירות מחדל).
// גרסה לא ידועה (נדחקה מהרשימה) — מחזיר [] והעותק נשמר כמו שהוא, כמו קודם
async function pulledSince(a, readAt, data) {
  const hist = (await a.get('kv', SETTINGS_HIST)) || [];
  let i = -1;
  if (readAt) {
    i = hist.findIndex((h) => h.updatedAt === readAt);
    if (i < 0) return [];
  } else if (!hist[0]?.first) {
    return [];
  }
  const keys = new Set();
  for (let j = i + 1; j < hist.length; j++) {
    if (hist[j].remote) for (const k of diffKeys(hist[j].data, j ? hist[j - 1].data : DEFAULT_SETTINGS)) keys.add(k);
  }
  const base = normS(i >= 0 ? hist[i].data : DEFAULT_SETTINGS);
  const mine = normS(data);
  return [...keys].filter((k) => k !== 'resetAt' && eqv(mine[k], base[k]));
}

export async function getSettings() {
  const s = await run(['kv'], 'readonly', (a) => a.get('kv', SETTINGS_KEY));
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
}

// settings הוא אובייקט שלם שהמתקשר קרא ב-getSettings (כולל updatedAt של הגרסה שקרא).
// אם בינתיים נמשך שינוי מהמכשיר השני — השדות שהמתקשר לא שינה לוקחים את הערך העדכני, לא את הישן.
export async function saveSettings(settings) {
  await run(['kv', 'outbox'], 'readwrite', async (a) => {
    const prev = await a.get('kv', SETTINGS_KEY);
    const data = settingsData(settings);
    const readAt = Number(settings?.updatedAt) || 0;
    if (prev && readAt !== Number(prev.updatedAt)) {
      for (const k of await pulledSince(a, readAt, data)) {
        if (k in prev) data[k] = prev[k]; else delete data[k];
      }
    }
    const s = { ...data, updatedAt: stamp(prev) };
    // resetAt (מתי אופסה ההתקדמות) לא חוזר אחורה גם אם נשמר עותק ישן של ההגדרות
    const resetAt = Math.max(Number(prev?.resetAt) || 0, Number(settings?.resetAt) || 0);
    if (resetAt) s.resetAt = resetAt; else delete s.resetAt;
    await putSettings(a, s, false, prev);
    await enqueue(a, { op: 'upsert', table: 'settings', key: SETTINGS_KEY, row: settingsData(s) });
  });
  notify();
}

export async function getKV(key, fallback) {
  const v = await run(['kv'], 'readonly', (a) => a.get('kv', key));
  return v === undefined ? fallback : v;
}

export async function setKV(key, value) {
  await run(['kv'], 'readwrite', (a) => a.put('kv', value, key));
}

// ---------- custom words ----------
export async function listCustomWords() {
  const rows = await run(['words'], 'readonly', (a) => a.all('words'));
  return rows.filter((w) => w && !w.deleted);
}

export async function addCustomWord({ text, pic, level }) {
  const now = Date.now();
  // סיומת אקראית: שני מכשירים שמוסיפים מילה באותו רגע לא יתנגשו
  const id = 'c' + now.toString(36) + Math.random().toString(36).slice(2, 5);
  const word = { id, text, pic: pic || '', level, custom: true, deleted: false, updatedAt: now };
  await run(['words', 'outbox'], 'readwrite', async (a) => {
    await a.put('words', word);
    await enqueue(a, { op: 'upsert', table: 'words', key: id, row: wordRow(word) });
  });
  notify();
  return { ...word };
}

export async function deleteCustomWord(id) {
  let found = false;
  await run(['words', 'outbox'], 'readwrite', async (a) => {
    const w = await a.get('words', id);
    if (!w || w.deleted) return;
    found = true;
    const t = { ...w, deleted: true, updatedAt: stamp(w) };
    await a.put('words', t);
    await enqueue(a, { op: 'delete', table: 'words', key: id, row: wordRow(t) });
  });
  if (found) notify();
  return found;
}

// ---------- per-word stats + attempt log ----------
export async function getAllStats() {
  const rows = await run(['stats'], 'readonly', (a) => a.all('stats'));
  return Object.fromEntries(rows.map((r) => [r.wordId, r]));
}

const emptyStat = (wordId) => ({ wordId, seen: 0, correct: 0, solo: 0, skipped: 0, lastTs: 0, lastOutcome: null });
function bump(s, outcome, ts) {
  s.seen += 1;
  if (outcome !== 'skipped') s.correct += 1;
  if (outcome === 'solo') s.solo += 1;
  if (outcome === 'skipped') s.skipped += 1;
  s.lastTs = ts;
  s.lastOutcome = outcome;
  return s;
}

// outcome: 'solo' (קרא לבד) | 'heard' (קרא אחרי ששמע) | 'skipped' (לא הצליח, המשיך)
export async function recordWord({ wordId, outcome, attempts, transcripts }) {
  const ts = Date.now();
  let out;
  await run(['stats', 'attempts', 'outbox'], 'readwrite', async (a) => {
    const prev = await a.get('stats', wordId);
    const s = bump(prev || emptyStat(wordId), outcome, ts);
    await a.put('stats', s);
    const entry = { uuid: uuid(), wordId, outcome, attempts, transcripts, ts };
    await a.add('attempts', entry);
    await enqueue(a, { op: 'upsert', table: 'attempts', key: entry.uuid, row: attemptRow(entry) });
    out = s;
  });
  notify();
  return out;
}

export async function listAttempts(limit = 40) {
  return run(['attempts'], 'readonly', (a) => a.recent('attempts', 'ts', limit));
}

async function rebuildIn(a) {
  const rows = (await a.all('attempts')).sort((x, y) => (x.ts - y.ts) || ((x.id || 0) - (y.id || 0)));
  const map = new Map();
  for (const r of rows) {
    if (!r || r.wordId == null) continue;
    map.set(r.wordId, bump(map.get(r.wordId) || emptyStat(r.wordId), r.outcome, r.ts));
  }
  await a.clear('stats');
  for (const s of map.values()) await a.put('stats', s);
}

// מחשב את הסטטיסטיקה מחדש מכל הניסיונות (אחרי שנמשכו ניסיונות ממכשיר אחר)
export async function rebuildStats() {
  await run(['attempts', 'stats'], 'readwrite', rebuildIn);
}

// ---------- drawings ----------
export async function saveDrawing({ pageId, blob }) {
  const now = Date.now();
  const row = { uuid: uuid(), pageId, blob, ts: now, updatedAt: now, deleted: false, storagePath: null };
  await run(['drawings', 'outbox'], 'readwrite', async (a) => {
    await a.add('drawings', row);
    await enqueue(a, { op: 'upsert', table: 'drawings', key: row.uuid, row: drawingRow(row) });
  });
  notify();
}

// remote: true = הציור קיים רק בענן (blob הוא null) — sync.fetchDrawingBlob מוריד אותו
export async function listDrawings() {
  const rows = await run(['drawings'], 'readonly', (a) => a.all('drawings'));
  return rows
    .filter((d) => d && !d.deleted)
    .map((d) => ({ ...d, blob: d.blob || null, remote: !d.blob }))
    .sort((a, b) => b.ts - a.ts);
}

export async function deleteDrawing(id) {
  let found = false;
  await run(['drawings', 'outbox'], 'readwrite', async (a) => {
    const d = await a.get('drawings', id);
    if (!d || d.deleted) return;
    found = true;
    const t = { ...d, blob: null, deleted: true, updatedAt: stamp(d) };
    await a.put('drawings', t);
    await enqueue(a, { op: 'delete', table: 'drawings', key: d.uuid, row: drawingRow(t) });
  });
  if (found) notify();
}

// ---------- reset / backup ----------
// מנקה ניסיונות וסטטיסטיקה מקומיים (ומוחק מהתור ניסיונות שעוד לא עלו), ומוסיף פעולת reset לענן.
// resetAt בהגדרות מודיע למכשירים האחרים שההתקדמות אופסה.
export async function resetProgress() {
  const now = Date.now();
  await run(['stats', 'attempts', 'kv', 'outbox'], 'readwrite', async (a) => {
    await a.clear('stats');
    await a.clear('attempts');
    await a.del('kv', 'rewardCount');
    if (!a.mem) {
      for (const o of await a.all('outbox')) if (o.table === 'attempts' && o.op === 'upsert') await a.del('outbox', o.id);
      await enqueue(a, { op: 'reset', table: 'attempts', row: { ts: now } });
    }
    const prev = await a.get('kv', SETTINGS_KEY);
    const s = { ...DEFAULT_SETTINGS, ...(prev && typeof prev === 'object' ? prev : {}), resetAt: now, updatedAt: stamp(prev) };
    await putSettings(a, s, false, prev);
    await enqueue(a, { op: 'upsert', table: 'settings', key: SETTINGS_KEY, row: settingsData(s) });
  });
  notify();
}

const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

export async function exportAll() {
  const [settings, words, stats, attempts, drawings] = await Promise.all([
    getSettings(), listCustomWords(), getAllStats(), listAttempts(100000), listDrawings(),
  ]);
  const pics = [];
  for (const d of drawings) {
    if (!d.blob) continue; // ציור שקיים רק בענן — לא נכלל בקובץ
    pics.push({ uuid: d.uuid, pageId: d.pageId, ts: d.ts, image: await blobToDataURL(d.blob) });
  }
  return { app: 'otiyot', version: 2, exportedAt: new Date().toISOString(), settings, words, stats: Object.values(stats), attempts, drawings: pics };
}

// שחזור מגיבוי: הגדרות, מילים וניסיונות מוחלפים (גם בענן). ציורים מתווספים — ציור קיים לא נמחק.
export async function importAll(data) {
  if (!data || data.app !== 'otiyot') throw new Error('זה לא קובץ גיבוי של האפליקציה');
  // קודם ממירים תמונות — בתוך טרנזקציה אסור לחכות לשום דבר חוץ מ-IndexedDB
  const pics = [];
  for (const d of Array.isArray(data.drawings) ? data.drawings : []) {
    try { pics.push({ uuid: isUuid(d.uuid) ? d.uuid : null, pageId: d.pageId, ts: Number(d.ts) || Date.now(), blob: await (await fetch(d.image)).blob() }); } catch (e) { console.warn('import drawing', e); }
  }
  const now = Date.now();
  await run(ALL_STORES, 'readwrite', async (a) => {
    // 1. ניסיונות בענן: reset לפני כל השאר, כדי שהניסיונות מהגיבוי יעלו אחריו
    if (!a.mem) {
      for (const o of await a.all('outbox')) if (o.table === 'attempts' && o.op === 'upsert') await a.del('outbox', o.id);
      await enqueue(a, { op: 'reset', table: 'attempts', row: { ts: now } });
    }
    // 2. הגדרות
    const prev = await a.get('kv', SETTINGS_KEY);
    const s = { ...DEFAULT_SETTINGS, ...(data.settings && typeof data.settings === 'object' ? data.settings : {}) };
    s.updatedAt = stamp(prev);
    s.resetAt = Math.max(now, Number(prev?.resetAt) || 0);
    await putSettings(a, s, false, prev);
    // שחזור מחליף את כל ההגדרות: עד שיעלה לענן, ההגדרות מהגיבוי מנצחות בשלמותן (לא רק השדות ששונו)
    const b = await a.get('kv', SETTINGS_BASE);
    await a.put('kv', { data: b?.data || null, at: Number(b?.at) || 0, force: true }, SETTINGS_BASE);
    await enqueue(a, { op: 'upsert', table: 'settings', key: SETTINGS_KEY, row: settingsData(s) });
    // 3. מילים: מה שלא בגיבוי נמחק
    const incoming = new Map();
    for (const w of Array.isArray(data.words) ? data.words : []) {
      if (w && w.id != null && w.text && !w.deleted) incoming.set(String(w.id), w);
    }
    for (const w of await a.all('words')) {
      if (w.deleted || incoming.has(w.id)) continue;
      const t = { ...w, deleted: true, updatedAt: stamp(w) };
      await a.put('words', t);
      await enqueue(a, { op: 'delete', table: 'words', key: w.id, row: wordRow(t) });
    }
    for (const [id, w] of incoming) {
      const old = await a.get('words', id);
      const row = { id, text: w.text, pic: w.pic || '', level: w.level, custom: true, deleted: false, updatedAt: stamp(old) };
      await a.put('words', row);
      await enqueue(a, { op: 'upsert', table: 'words', key: id, row: wordRow(row) });
    }
    // 4. ניסיונות + סטטיסטיקה
    await a.clear('attempts');
    const seen = new Set();
    let n = 0;
    for (const r of Array.isArray(data.attempts) ? data.attempts : []) {
      if (!r || r.wordId == null) continue;
      const u = isUuid(r.uuid) && !seen.has(r.uuid) ? r.uuid : uuid();
      seen.add(u);
      const e = { uuid: u, wordId: r.wordId, outcome: r.outcome, attempts: r.attempts, transcripts: r.transcripts, ts: Number(r.ts) || now };
      await a.add('attempts', e);
      await enqueue(a, { op: 'upsert', table: 'attempts', key: u, row: attemptRow(e) });
      n++;
    }
    if (n) await rebuildIn(a);
    else {
      await a.clear('stats');
      for (const st of Array.isArray(data.stats) ? data.stats : []) if (st && st.wordId != null) await a.put('stats', st);
    }
    // 5. ציורים: רק מוסיפים
    const local = await a.all('drawings');
    for (const p of pics) {
      const same = local.find((d) => (p.uuid && d.uuid === p.uuid) || (d.pageId === p.pageId && d.ts === p.ts));
      if (same && !same.deleted && same.blob) continue;
      if (same) {
        await a.put('drawings', { ...same, blob: p.blob, deleted: false, updatedAt: stamp(same) });
        await enqueue(a, { op: 'upsert', table: 'drawings', key: same.uuid, row: drawingRow(same) });
        continue;
      }
      const row = { uuid: p.uuid || uuid(), pageId: p.pageId, blob: p.blob, ts: p.ts, updatedAt: now, deleted: false, storagePath: null };
      await a.add('drawings', row);
      local.push(row);
      await enqueue(a, { op: 'upsert', table: 'drawings', key: row.uuid, row: drawingRow(row) });
    }
  });
  notify();
}

// בקשה מהדפדפן לא למחוק את הנתונים כשחסר מקום
export async function requestPersist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

// =====================================================================
// לסנכרון בלבד (js/sync.js). שאר האפליקציה לא צריכה את אלה.
// =====================================================================

// נקרא אחרי כל כתיבה שנכנסה לתור
export function setWriteHook(fn) {
  writeHook = typeof fn === 'function' ? fn : null;
}

// הפעולות הראשונות בתור, לפי הסדר. afterId — רק פעולות שנוספו אחרי המזהה הזה
export async function outboxPeek(limit = 50, afterId = 0) {
  return run(['outbox'], 'readonly', (a) => (a.mem ? [] : a.first('outbox', limit, afterId)));
}

export async function outboxDelete(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null);
  if (!list.length) return;
  await run(['outbox'], 'readwrite', async (a) => { for (const id of list) await a.del('outbox', id); });
}

// עדכון פעולה בתור (למשל tries). פעולה שכבר הוחלפה בחדשה — לא נוגעים
export async function outboxUpdate(id, patch) {
  await run(['outbox'], 'readwrite', async (a) => {
    const o = await a.get('outbox', id);
    if (o) await a.put('outbox', { ...o, ...patch, id });
  });
}

// פעולה שנכשלה שוב ושוב: יוצאת מהתור ונשמרת בצד (kv 'sync:deadLetter') לבדיקה
export async function outboxToDeadLetter(id, error) {
  await run(['outbox', 'kv'], 'readwrite', async (a) => {
    const o = await a.get('outbox', id);
    if (!o) return;
    await a.del('outbox', id);
    const list = (await a.get('kv', DEAD_KEY)) || [];
    list.push({ op: o, error: String(error || ''), at: Date.now() });
    await a.put('kv', list.slice(-DEAD_MAX), DEAD_KEY);
  });
}

export async function listDeadLetters() {
  return (await getKV(DEAD_KEY, [])) || [];
}

export async function pendingCount() {
  return run(['outbox'], 'readonly', (a) => (a.mem ? 0 : a.count('outbox')));
}

export async function getSyncMeta(key) {
  const v = await getKV(META_PREFIX + key, null);
  return v === undefined ? null : v;
}

export async function setSyncMeta(key, value) {
  await run(['kv'], 'readwrite', (a) => (value == null ? a.del('kv', META_PREFIX + key) : a.put('kv', value, META_PREFIX + key)));
}

// מילה כפי שהיא שמורה (כולל מחוקה)
export async function getCustomWord(id) {
  return run(['words'], 'readonly', (a) => a.get('words', id));
}

export async function getDrawingByUuid(id) {
  return run(['drawings'], 'readonly', (a) => a.byIndex('drawings', 'uuid', id));
}

// שומר את התמונה שהורדה מהענן (ציור שהיה רק בענן)
export async function setDrawingBlob(id, blob) {
  let ok = false;
  await run(['drawings'], 'readwrite', async (a) => {
    const d = await a.byIndex('drawings', 'uuid', id);
    if (!d || d.deleted) return;
    await a.put('drawings', { ...d, blob });
    ok = true;
  });
  return ok;
}

const remoteMs = (v) => { const n = Date.parse(v); return Number.isFinite(n) ? n : 0; };

// כלל המיזוג: פעולה מקומית שממתינה בתור לאותו מפתח מנצחת; אחרת — updated_at החדש יותר.
// "חדש יותר" נמדד רק בזמני שרת: syncedAt = ה-updated_at של הגרסה האחרונה מהשרת שהמכשיר כבר ראה.
// (השוואה ל-updatedAt המקומי הייתה מערבבת את שעון המכשיר: אייפד ששעונו מקדים היה מתעלם משינויים מהטלפון.)
// שורה בלי פעולה ממתינה כבר נמצאת בשרת, ולכן גרסה חדשה מהשרת היא תמיד המצב העדכני.
// מחזיר כמה מילים השתנו בפועל
export async function applyRemoteWords(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let changed = 0;
  await run(['words', 'outbox'], 'readwrite', async (a) => {
    const pending = await pendingSet(a, 'words');
    for (const r of rows) {
      if (!r || r.id == null) continue;
      const id = String(r.id);
      if (pending.has(id)) continue;
      const ms = remoteMs(r.updated_at);
      const local = await a.get('words', id);
      if (local && ms <= (Number(local.syncedAt) || 0)) continue; // הגרסה הזו (או חדשה ממנה) כבר נראתה
      if (r.deleted) {
        if (!local) continue;
        await a.put('words', { ...local, deleted: true, syncedAt: ms, updatedAt: local.deleted ? local.updatedAt : stamp(local) });
        if (!local.deleted) changed++;
        continue;
      }
      const same = local && !local.deleted && local.text === r.text && (local.pic || '') === (r.pic || '') && Number(local.level) === Number(r.level);
      if (same) {
        await a.put('words', { ...local, syncedAt: ms }); // ההד של מה שהמכשיר עצמו דחף
        continue;
      }
      await a.put('words', { id, text: r.text, pic: r.pic || '', level: r.level, custom: true, deleted: false, updatedAt: stamp(local), syncedAt: ms });
      changed++;
    }
  });
  return changed;
}

const sameSettings = (a, b) => diffKeys(a, b).length === 0;

// { changed, reset } — reset: ההתקדמות אופסה במכשיר אחר, הניסיונות המקומיים שכבר סונכרנו נמחקו
// (sync.js מאפס את סמן הניסיונות ומושך מחדש את מה שיש בענן)
// גרסה חדשה מהשרת (לפי זמן שרת בלבד): בלי שינוי מקומי ממתין — מחליפה את המקומית.
// עם שינוי מקומי ממתין — רק השדות שהמכשיר שינה מאז הגרסה האחרונה שראה בשרת מנצחים, השאר מגיעים מהשרת.
// (כך מכשיר שעוד לא משך הגדרות אף פעם, ושינה שדה אחד, לא מוחק בענן את השם / השלב / שאר ההגדרות.)
export async function applyRemoteSettings(row) {
  const res = { changed: false, reset: false };
  if (!row || !row.data || typeof row.data !== 'object') return res;
  const ms = remoteMs(row.updated_at);
  const remoteReset = Number(row.data.resetAt) || 0;
  await run(['kv', 'stats', 'attempts', 'outbox'], 'readwrite', async (a) => {
    const local = await a.get('kv', SETTINGS_KEY);
    const localReset = Number(local?.resetAt) || 0;
    const base = await a.get('kv', SETTINGS_BASE);
    let next = local;
    if (ms > (Number(base?.at) || 0)) {
      const pending = (await pendingSet(a, 'settings')).has(SETTINGS_KEY);
      const force = pending && !!base?.force; // שחזור מגיבוי שעוד לא עלה
      let merged = { ...row.data };
      if (force && local) merged = settingsData(local);
      else if (pending && local) {
        for (const k of diffKeys(settingsData(local), base?.data || DEFAULT_SETTINGS)) {
          if (k in local) merged[k] = local[k]; else delete merged[k];
        }
      }
      // ההגדרות שהמכשיר עצמו דחף חוזרות עם זמן שרת — זה לא שינוי
      if (!local || !sameSettings(merged, local)) {
        next = { ...merged, updatedAt: stamp(local) };
        res.changed = true;
      }
      await a.put('kv', { data: settingsData(row.data), at: ms, ...(force ? { force: true } : {}) }, SETTINGS_BASE);
    }
    if (remoteReset > localReset) {
      await applyResetIn(a, remoteReset);
      res.reset = true;
      res.changed = true;
    }
    const resetAt = Math.max(localReset, remoteReset, Number(next?.resetAt) || 0);
    if (next && resetAt && next.resetAt !== resetAt) next = { ...next, resetAt };
    if (!next && resetAt) next = { ...DEFAULT_SETTINGS, resetAt, updatedAt: stamp(local) };
    if (next !== local) await putSettings(a, next, true, local);
  });
  return res;
}

// ההגדרות שנדחפו הן עכשיו מה שיש בשרת: הבסיס לזיהוי "מה המכשיר שינה" (הזמן נשאר זמן השרת שכבר נראה)
export async function settingsPushed(data) {
  await run(['kv'], 'readwrite', async (a) => {
    const base = await a.get('kv', SETTINGS_BASE);
    await a.put('kv', { data: settingsData(data), at: Number(base?.at) || 0 }, SETTINGS_BASE);
  });
}

// איפוס שהגיע ממכשיר אחר: נשארים רק ניסיונות שעוד לא עלו לענן ונרשמו אחרי האיפוס
async function applyResetIn(a, resetTs) {
  const keep = new Set();
  if (!a.mem) {
    for (const o of await a.all('outbox')) {
      if (o.table !== 'attempts' || o.op !== 'upsert') continue;
      if ((Number(o.row?.ts) || 0) <= resetTs) await a.del('outbox', o.id);
      else keep.add(o.key);
    }
  }
  const kept = (await a.all('attempts')).filter((x) => keep.has(x.uuid));
  await a.clear('attempts');
  for (const x of kept) await a.put('attempts', x);
  await a.del('kv', 'rewardCount');
  await rebuildIn(a);
}

// ניסיונות ממכשירים אחרים (לפי uuid — מה שכבר קיים מדולג). מחזיר כמה נוספו.
// איפוס מקומי שעוד לא עלה לענן מנצח: ניסיונות מלפניו שעדיין בענן לא חוזרים למכשיר
export async function applyRemoteAttempts(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let added = 0;
  await run(['attempts', 'outbox'], 'readwrite', async (a) => {
    let resetTs = 0;
    if (!a.mem) {
      for (const o of await a.all('outbox')) {
        if (o.op === 'reset' && o.table === 'attempts') resetTs = Math.max(resetTs, Number(o.row?.ts ?? o.ts) || 0);
      }
    }
    for (const r of rows) {
      if (!r || !r.id || r.word_id == null) continue;
      if (resetTs && (remoteMs(r.ts) || 0) <= resetTs) continue;
      if (await a.byIndex('attempts', 'uuid', r.id)) continue;
      await a.add('attempts', {
        uuid: r.id,
        wordId: r.word_id,
        outcome: r.outcome,
        attempts: Number(r.attempts) || 0,
        transcripts: Array.isArray(r.transcripts) ? r.transcripts : [],
        ts: remoteMs(r.ts) || Date.now(),
      });
      added++;
    }
  });
  return added;
}

// ציורים מהענן נשמרים בלי תמונה (blob: null, storagePath) עד שמורידים אותם. מחזיר כמה השתנו
export async function applyRemoteDrawings(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let changed = 0;
  await run(['drawings', 'outbox'], 'readwrite', async (a) => {
    const pending = await pendingSet(a, 'drawings');
    for (const r of rows) {
      if (!r || !r.id || pending.has(r.id)) continue;
      const ms = remoteMs(r.updated_at);
      const local = await a.byIndex('drawings', 'uuid', r.id);
      if (!local) {
        if (r.deleted) continue;
        await a.add('drawings', { uuid: r.id, pageId: r.page_id, ts: remoteMs(r.ts) || ms, blob: null, storagePath: r.storage_path || null, deleted: false, updatedAt: Date.now(), syncedAt: ms });
        changed++;
        continue;
      }
      // כמו במילים: משווים לזמן השרת האחרון שנראה (syncedAt), לא לשעון המכשיר
      if (ms <= (Number(local.syncedAt) || 0)) continue;
      const storagePath = r.storage_path || local.storagePath || null;
      if (r.deleted) {
        await a.put('drawings', { ...local, blob: null, deleted: true, storagePath, syncedAt: ms, updatedAt: local.deleted ? local.updatedAt : stamp(local) });
        if (!local.deleted) changed++;
      } else {
        await a.put('drawings', { ...local, pageId: r.page_id ?? local.pageId, ts: remoteMs(r.ts) || local.ts, storagePath, deleted: false, syncedAt: ms, updatedAt: local.deleted ? stamp(local) : local.updatedAt });
        if (local.deleted) changed++;
      }
    }
  });
  return changed;
}
