// מעבר עם העט על מילה מקווקוות. בודק כיסוי לכל אות (אות + הניקוד שלה) בנפרד.

const FONT_FAMILY = '"Noto Sans Hebrew", "Arial Hebrew", sans-serif';
const CLUSTER = /[א-ת][֑-ׇ]*/g;
const LETTER_DONE = 0.5;   // חלק מהאות שצריך לכסות
const WORD_DONE = 0.6;     // חלק מכל המילה
const MAX_OUTSIDE = 0.5;   // כמה "קשקוש" מחוץ לאותיות מותר

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Tracer {
  constructor(host, { onLetter, onComplete, onMessy } = {}) {
    this.host = host;
    this.cb = { onLetter, onComplete, onMessy };
    this.guide = document.createElement('canvas');
    this.ink = document.createElement('canvas');
    this.guide.className = 'trace-guide';
    this.ink.className = 'trace-ink';
    host.append(this.guide, this.ink);
    this.low = document.createElement('canvas'); // עותק ברזולוציה נמוכה לחישוב כיסוי
    // נקרא כל 120ms — ההגדרה תופסת רק בקריאה הראשונה ל-getContext
    this.low.getContext('2d', { willReadFrequently: true });
    this.penSeen = false;
    this.enabled = true;
    this.text = '';
    this.done = new Set();
    this.complete = false;
    this.bind();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
  }

  async setWord(text) {
    this.text = text;
    this.clusters = text.match(CLUSTER) || [];
    this.done = new Set();
    this.complete = false;
    this.ink.style.opacity = 1;
    try { await document.fonts.load(`600 100px ${FONT_FAMILY}`, text); } catch {}
    this.layout();
  }

  layout() {
    const r = this.host.getBoundingClientRect();
    // פיקסלים שלמים: האינדקס (y * w + x) של הדגימות חייב להתאים לרוחב האמיתי של הקנבס
    const w = Math.floor(r.width), h = Math.floor(r.height);
    if (!w || !h || !this.text) return;
    this.w = w; this.h = h;
    const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, 2));
    for (const c of [this.guide, this.ink]) { c.width = w * dpr; c.height = h * dpr; }
    this.low.width = w; this.low.height = h;

    const g = this.guide.getContext('2d');
    g.font = `600 100px ${FONT_FAMILY}`;
    const w100 = g.measureText(this.text).width;
    this.size = Math.min(h * 0.5, (w * 0.84) / w100 * 100);
    this.font = `600 ${this.size}px ${FONT_FAMILY}`;
    g.font = this.font;
    const m = g.measureText(this.text);
    this.cx = w / 2;
    this.by = h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    this.textW = m.width;

    // גבולות כל אות: הטקסט מימין לשמאל, אז אות i מתחילה במרחק רוחב-הקידומת מהקצה הימני
    const right = this.cx + this.textW / 2;
    let prefix = '';
    this.ranges = this.clusters.map((c) => {
      const x1 = right - g.measureText(prefix).width;
      prefix += c;
      const x0 = right - g.measureText(prefix).width;
      return [x0, x1];
    });

    this.buildMask();
    this.drawGuide();
    this.clearInk(false);
  }

  textCtx(ctx, scale) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.direction = 'rtl';
  }

  buildMask() {
    const { w, h } = this;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const m = c.getContext('2d', { willReadFrequently: true });
    this.textCtx(m, 1);
    m.fillStyle = '#000';
    m.fillText(this.text, this.cx, this.by);
    const letters = m.getImageData(0, 0, w, h).data;
    // אזור מותר: האותיות + שוליים
    m.clearRect(0, 0, w, h);
    m.lineWidth = this.size * 0.24; m.lineJoin = 'round';
    m.strokeText(this.text, this.cx, this.by);
    m.fillText(this.text, this.cx, this.by);
    this.allowed = m.getImageData(0, 0, w, h).data;

    const step = Math.max(2, Math.round(this.size / 60));
    this.step = step;
    this.samples = [];
    this.perCluster = this.clusters.map(() => 0);
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (letters[i + 3] > 128) {
        let k = this.ranges.findIndex(([x0, x1]) => x >= x0 && x < x1);
        if (k < 0) k = x < this.cx ? this.clusters.length - 1 : 0;
        this.samples.push(i, k);
        this.perCluster[k]++;
      }
    }
  }

  drawGuide() {
    const g = this.guide.getContext('2d');
    const { w, h, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // שורות מחברת: שורת בסיס ושורת גובה אות, וקו שוליים מימין
    const top = this.by - this.size * 0.56;
    g.strokeStyle = css('--rule'); g.lineWidth = 2; g.setLineDash([]);
    for (const y of [top, this.by]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = css('--margin'); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(w - 28, 0); g.lineTo(w - 28, h); g.stroke();

    this.textCtx(g, dpr);
    g.fillStyle = css('--guide-fill');
    g.fillText(this.text, this.cx, this.by);
    if (!this.complete) { // מילה שהושלמה נצבעת מלא — בלי מסגרת מקווקוות סביבה
      g.strokeStyle = css('--guide');
      g.lineWidth = Math.max(2, this.size * 0.018);
      g.setLineDash([this.size * 0.035, this.size * 0.045]);
      g.lineCap = 'round';
      g.strokeText(this.text, this.cx, this.by);
      g.setLineDash([]);
    }

    for (const k of this.done) this.paintCluster(k, css('--pencil'));
    if (this.complete) this.paintWord(this.finalColor || css('--pencil'));
  }

  paintCluster(k, color) {
    const g = this.guide.getContext('2d');
    const [x0, x1] = this.ranges[k];
    g.save();
    this.textCtx(g, this.dpr);
    g.beginPath(); g.rect(x0 - 1, 0, x1 - x0 + 2, this.h); g.clip();
    g.fillStyle = color;
    g.fillText(this.text, this.cx, this.by);
    g.restore();
  }

  paintWord(color) {
    const g = this.guide.getContext('2d');
    g.save();
    this.textCtx(g, this.dpr);
    g.fillStyle = color;
    g.fillText(this.text, this.cx, this.by);
    g.restore();
  }

  // אחרי קריאה נכונה (ירוק) או כשמדלגים על המעבר
  reveal(color) {
    this.complete = true;
    this.finalColor = color;
    this.drawGuide();
    this.clearInk(true);
  }

  clearInk(fade) {
    const wipe = () => {
      const k = this.ink.getContext('2d');
      k.setTransform(1, 0, 0, 1, 0, 0);
      k.clearRect(0, 0, this.ink.width, this.ink.height);
      this.low.getContext('2d').clearRect(0, 0, this.low.width, this.low.height);
      this.ink.style.opacity = 1;
    };
    if (fade) { this.ink.style.opacity = 0; setTimeout(wipe, 350); } else wipe();
  }

  restart() {
    this.done = new Set();
    this.complete = false;
    this.drawGuide();
    this.clearInk(false);
  }

  bind() {
    const el = this.ink;
    let last = null, drawing = false, pid = null;
    const pos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const width = (e) => this.size * 0.13 * (e.pointerType === 'pen' ? 0.7 + 0.6 * (e.pressure || 0.5) : 1);

    const seg = (from, to, lw) => {
      const k = this.ink.getContext('2d');
      k.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      k.strokeStyle = css('--pencil'); k.globalAlpha = 0.85;
      k.lineWidth = lw; k.lineCap = 'round'; k.lineJoin = 'round';
      k.beginPath(); k.moveTo(...from); k.lineTo(...to); k.stroke();
      const l = this.low.getContext('2d');
      l.strokeStyle = '#000'; l.lineWidth = lw; l.lineCap = 'round';
      l.beginPath(); l.moveTo(...from); l.lineTo(...to); l.stroke();
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') this.penSeen = true;
      if (!this.enabled || this.complete) return;
      if (e.pointerType === 'touch' && this.penSeen) return; // כף היד על המסך
      drawing = true; pid = e.pointerId;
      el.setPointerCapture(e.pointerId);
      last = pos(e);
      seg(last, [last[0] + 0.1, last[1]], width(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (!drawing || e.pointerId !== pid) return;
      const evs = e.getCoalescedEvents?.(); // יכול לחזור ריק — אז משתמשים באירוע עצמו
      for (const ev of evs?.length ? evs : [e]) { const p = pos(ev); seg(last, p, width(ev)); last = p; }
      this.scheduleCheck();
    });
    const end = (e) => {
      if (!drawing || e.pointerId !== pid) return;
      drawing = false; pid = null;
      this.check(true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  scheduleCheck() {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = null; this.check(false); }, 120);
  }

  check(strokeEnded) {
    if (this.complete || !this.samples) return;
    const { w, h } = this;
    const ink = this.low.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const hit = this.clusters.map(() => 0);
    let total = 0;
    for (let s = 0; s < this.samples.length; s += 2) {
      if (ink[this.samples[s] + 3] > 0) { hit[this.samples[s + 1]]++; total++; }
    }
    hit.forEach((n, k) => {
      if (!this.done.has(k) && this.perCluster[k] && n / this.perCluster[k] >= LETTER_DONE) {
        this.done.add(k);
        this.paintCluster(k, css('--pencil'));
        this.cb.onLetter?.(k, this.clusters.length);
      }
    });
    const coverage = total / (this.samples.length / 2);
    if (!strokeEnded) return;
    if (this.done.size === this.clusters.length && coverage >= WORD_DONE) {
      // מספיק כיסוי — בודקים שלא קשקש על כל הדף
      let inkPx = 0, outside = 0;
      const step = this.step * 2;
      for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (ink[i + 3] > 0) { inkPx++; if (this.allowed[i + 3] < 20) outside++; }
      }
      if (inkPx && outside / inkPx > MAX_OUTSIDE) { this.cb.onMessy?.(); return; }
      this.complete = true;
      this.paintWord(css('--pencil'));
      this.clearInk(true);
      this.cb.onComplete?.();
    }
  }

  destroy() { this.ro.disconnect(); this.guide.remove(); this.ink.remove(); }
}
