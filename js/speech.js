// הקראה (speechSynthesis) וזיהוי דיבור (webkitSpeechRecognition) + השוואה סלחנית למילה.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;

// ---------- הקראה ----------
let heVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  heVoice = voices.find((v) => /^he|^iw/i.test(v.lang)) || null;
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}
export const canSpeak = () => !!window.speechSynthesis;
export const hasHebrewVoice = () => !!heVoice;

export function say(text, rate = 0.75) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'he-IL';
    if (heVoice) u.voice = heVoice;
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
    setTimeout(resolve, 4000); // Safari לפעמים לא שולח onend
  });
}

// ---------- זיהוי דיבור ----------
// מחזיר { alternatives: string[], diag } או { error, diag }.
// ילדים מפרקים מילה להברות ("בָּ... נָ... נָה"), אז מקשיבים ברצף ולא עוצרים בתוצאה הסופית הראשונה:
// עוצרים אחרי שקט של silenceMs מהתוצאה האחרונה, או ב-maxMs. כל ההברות מחוברות לחלופה נוספת.
// diag: ציר זמן של אירועי הזיהוי וכל התוצאות — לניתוח למה לא זוהה.
let active = null;
export function listen({ onStart, onInterim, onSpeech, maxMs = 7000, silenceMs = 1300 } = {}) {
  if (!SR) return Promise.resolve({ error: 'unsupported', diag: { events: [], results: [] } });
  stopListening();
  return new Promise((resolve) => {
    const rec = new SR();
    active = rec;
    rec.lang = 'he-IL';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = true;
    const t0 = performance.now();
    const at = () => Math.round(performance.now() - t0);
    const diag = { events: [], results: [], continuous: true };
    const log = (e) => diag.events.push({ t: at(), e });
    const finals = new Map(); // אינדקס תוצאה ← חלופות
    let interim = null;
    let error = null;
    let maxTimer, quietTimer;
    const stop = () => { try { rec.stop(); } catch {} };
    rec.onstart = () => { log('start'); onStart?.(); maxTimer = setTimeout(stop, maxMs); };
    rec.onaudiostart = () => log('audiostart');
    rec.onsoundstart = () => { log('soundstart'); onSpeech?.(); };
    rec.onspeechstart = () => { log('speechstart'); onSpeech?.(); };
    rec.onspeechend = () => log('speechend');
    rec.onsoundend = () => log('soundend');
    rec.onaudioend = () => log('audioend');
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = [];
        for (let j = 0; j < r.length; j++) {
          const t = r[j].transcript.trim();
          if (t) alts.push(t);
        }
        if (!alts.length) continue;
        diag.results.push({ t: at(), final: r.isFinal, alts });
        if (r.isFinal) { finals.set(i, alts); interim = null; } else interim = alts;
        onInterim?.(alts[0]);
      }
      clearTimeout(quietTimer);
      quietTimer = setTimeout(stop, silenceMs);
    };
    rec.onerror = (e) => { error = e.error; log('error:' + e.error); };
    rec.onend = () => {
      log('end');
      clearTimeout(maxTimer); clearTimeout(quietTimer);
      active = null;
      const heard = new Set();
      const parts = [...finals.values()];
      if (interim) parts.push(interim);
      for (const alts of parts) alts.forEach((a) => heard.add(a));
      if (parts.length > 1) heard.add(parts.map((alts) => alts[0]).join(' ')); // ההברות יחד
      if (heard.size) resolve({ alternatives: [...heard], diag });
      else resolve({ error: error || 'no-speech', diag });
    };
    try { rec.start(); } catch (err) { log('start-failed'); resolve({ error: 'start-failed', diag }); }
  });
}

export function stopListening() {
  try { active?.abort(); } catch {}
  active = null;
}

// ---------- השוואה ----------
const NIKUD = /[֑-ׇ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
// אותיות שנשמעות אותו דבר בפי ילד (ובפי מנוע הזיהוי)
const SOUNDALIKE = { 'ק': 'כ', 'ט': 'ת', 'ע': 'א', 'ו': 'ב' };

export function normalize(s, leniency = 'normal') {
  let t = s.replace(NIKUD, '').replace(/[^א-ת\s]/g, ' ');
  t = t.replace(/[ךםןףץ]/g, (c) => FINALS[c]);
  if (leniency !== 'strict') t = t.replace(/[קטעו]/g, (c) => SOUNDALIKE[c]);
  // א וע באמצע מילה וה בסוף לא נשמעות: "קַן" והזיהוי כותב "כאן"; "אִמָּא" / "אם"
  if (leniency === 'normal') t = t.trim().split(/\s+/).filter(Boolean).map((w) => w[0] + w.slice(1).replace(/א/g, '').replace(/ה$/, '')).join(' ');
  if (leniency === 'lenient') {
    t = t.replace(/ש/g, 'ס').replace(/ח/g, 'כ');
    // אמות קריאה: ילדים ומנוע הזיהוי לא עקביים בי' וא' שבאמצע ובסוף מילה
    t = t.trim().split(/\s+/).filter(Boolean).map((w) => w[0] + w.slice(1).replace(/[יאה]/g, '')).join(' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

export function matches(target, alternatives, leniency = 'normal') {
  const want = normalize(target, leniency).replace(/\s/g, '');
  if (!want) return false;
  const tolerance = leniency === 'strict' ? 0 : want.length >= (leniency === 'lenient' ? 3 : 4) ? 1 : 0;
  return alternatives.some((alt) => {
    const norm = normalize(alt, leniency);
    if (!norm) return false;
    // כל מילה בנפרד ("זה דג") + הכל מחובר ("דו בי")
    const candidates = [...norm.split(' '), norm.replace(/\s/g, '')];
    return candidates.some((c) => c === want || lev(c, want) <= tolerance);
  });
}

// ---------- צלילים קטנים (בלי קבצים) ----------
let ac;
function tone(freq, start, dur, type = 'sine', gain = 0.18) {
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  // iOS משהה את ההקשר (רקע, סשן מיקרופון) — בלי resume הצלילים שותקים עד רענון
  if (ac.state !== 'running') Promise.resolve(ac.resume?.()).catch(() => {});
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start); o.stop(ac.currentTime + start + dur + 0.05);
}
export function chime() { try { tone(660, 0, 0.25); tone(880, 0.12, 0.3); tone(1320, 0.26, 0.45); } catch {} }
export function softBoop() { try { tone(330, 0, 0.25, 'triangle', 0.12); } catch {} }
export function tick() { try { tone(1200, 0, 0.06, 'sine', 0.05); } catch {} }
