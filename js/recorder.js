// הקלטת ניסיונות קריאה לניתוח זיהוי הדיבור.
// מופעל מאזור ההורים ל-N ניסיונות (settings.analyzeLeft) ונכבה לבד. ההקלטות נשמרות ב-bucket פרטי
// 'recordings' ב-Supabase, עם שורה בטבלה recordings: מה הזיהוי שמע, ציר זמן האירועים ועוצמת הקול.

import { client, getSession } from './cloud.js';

export const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

let cur = null;

// מתחיל להקליט. לא זורק — מחזיר null או { error }.
export async function startRecording() {
  if (!canRecord) return null;
  await stopRecording();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
      .find((m) => window.MediaRecorder.isTypeSupported?.(m)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

    // עוצמה: האם המיקרופון בכלל שומע את הילד (שקט מדי / רחוק מדי)
    let peak = 0, sumSq = 0, n = 0, ac = null, raf = 0;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const meter = () => {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a; sumSq += v * v; n++; }
        raf = requestAnimationFrame(meter);
      };
      meter();
    } catch {}

    const t0 = performance.now();
    mr.start(250);
    cur = {
      stream, mr, chunks, t0, mime: mr.mimeType || mime,
      level: () => ({ peak: +peak.toFixed(4), rms: n ? +Math.sqrt(sumSq / n).toFixed(4) : 0 }),
      close: () => { cancelAnimationFrame(raf); try { ac?.close(); } catch {} stream.getTracks().forEach((t) => t.stop()); },
    };
    return cur;
  } catch (e) {
    cur = null;
    return { error: e?.name || 'failed' };
  }
}

// עוצר ומחזיר { blob, mime, durationMs, peak, rms } או null
export function stopRecording() {
  const r = cur;
  cur = null;
  if (!r) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = () => {
      r.close();
      const blob = r.chunks.length ? new Blob(r.chunks, { type: r.mime || 'audio/mp4' }) : null;
      resolve({ blob, mime: r.mime, durationMs: Math.round(performance.now() - r.t0), ...r.level() });
    };
    if (r.mr.state === 'inactive') return done();
    r.mr.onstop = done;
    try { r.mr.stop(); } catch { done(); }
    setTimeout(done, 1500); // Safari לפעמים לא שולח onstop
  });
}

const uuid = () => crypto.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// שומר ניסיון אחד לענן. result: match | nomatch | no-speech | error:<x>. מחזיר true אם נשמר.
export async function uploadAttempt({ wordId, target, result, alternatives = [], diag = {}, rec = null }) {
  const sb = client();
  const uid = (await getSession())?.user?.id;
  if (!sb || !uid) return false;
  const id = uuid();
  let path = null;
  try {
    if (rec?.blob?.size) {
      const type = (rec.mime || 'audio/mp4').split(';')[0];
      const ext = type.includes('mp4') || type.includes('aac') ? 'm4a' : type.includes('webm') ? 'webm' : 'bin';
      path = `${uid}/${id}.${ext}`;
      const { error } = await sb.storage.from('recordings').upload(path, rec.blob, { contentType: type, upsert: true });
      if (error) { diag = { ...diag, uploadError: error.message }; path = null; }
    }
    const { error } = await sb.from('recordings').insert({
      id, word_id: wordId, target, storage_path: path,
      mime: rec?.mime || null, duration_ms: rec?.durationMs ?? null, peak: rec?.peak ?? null, rms: rec?.rms ?? null,
      result, alternatives, diag: { ...diag, recError: rec?.error || undefined },
      device: navigator.userAgent.slice(0, 200), ts: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

// מחיקת כל ההקלטות (אזור ההורים)
export async function deleteAllRecordings() {
  const sb = client();
  const uid = (await getSession())?.user?.id;
  if (!sb || !uid) return { ok: false };
  try {
    const { data: rows } = await sb.from('recordings').select('storage_path').eq('user_id', uid);
    const paths = (rows || []).map((r) => r.storage_path).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from('recordings').remove(paths.slice(i, i + 100));
    const { error } = await sb.from('recordings').delete().eq('user_id', uid);
    return { ok: !error, count: rows?.length || 0 };
  } catch {
    return { ok: false };
  }
}

export async function countRecordings() {
  const sb = client();
  if (!sb) return null;
  try {
    const { count } = await sb.from('recordings').select('id', { count: 'exact', head: true });
    return count ?? null;
  } catch {
    return null;
  }
}
