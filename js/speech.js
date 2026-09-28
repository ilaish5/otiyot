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
// מחזיר { alternatives: string[] } או { error: 'no-speech' | 'not-allowed' | 'network' | ... }
let active = null;
export function listen({ onStart, onInterim, onSpeech, maxMs = 5000 } = {}) {
  if (!SR) return Promise.resolve({ error: 'unsupported' });
  stopListening();
  return new Promise((resolve) => {
    const rec = new SR();
    active = rec;
    rec.lang = 'he-IL';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    const heard = new Set();
    let error = null;
    let timer;
    rec.onstart = () => { onStart?.(); timer = setTimeout(() => rec.stop(), maxMs); };
    // לא כל דפדפן שולח את האירועים האלה; אם לא — פשוט אין חיווי "שומע"
    rec.onsoundstart = rec.onspeechstart = () => onSpeech?.();
    rec.onresult = (e) => {
      for (let i = 0; i < e.results.length; i++) {
        for (let j = 0; j < e.results[i].length; j++) {
          const t = e.results[i][j].transcript.trim();
          if (t) heard.add(t);
        }
        onInterim?.(e.results[i][0].transcript);
        // תוצאה סופית ראשונה מספיקה — מילה אחת
        if (e.results[i].isFinal) rec.stop();
      }
    };
    rec.onerror = (e) => { error = e.error; };
    rec.onend = () => {
      clearTimeout(timer);
      active = null;
      if (heard.size) resolve({ alternatives: [...heard] });
      else resolve({ error: error || 'no-speech' });
    };
    try { rec.start(); } catch (err) { resolve({ error: 'start-failed' }); }
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
