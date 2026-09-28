// פרס ציור: בחירת דף צביעה, ומסך צביעה (דלי, עט, מחק, ביטול) שנשמר כ-PNG.
import { PAGES } from './pages.js';
import { tick } from './speech.js';

const NS = 'http://www.w3.org/2000/svg';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const INK = '#1C2A3A';
const WHITE = '#FFFFFF';
const W = 1600, H = 1200;   // גודל הציור הפנימי = גודל ה-PNG
const BG = '<rect class="r bg" x="0" y="0" width="800" height="600"/>';

const SIZES = [
  { size: 8, dot: 10, label: 'קו דק' },
  { size: 18, dot: 18, label: 'קו בינוני' },
  { size: 36, dot: 30, label: 'קו עבה' },
];
const ERASER_SCALE = 2;   // המחק רחב פי 2 מהעט — קל יותר לילד למחוק

const COLORS = [
  ['#E5484D', 'אדום'], ['#FF7A2F', 'כתום'], ['#FFD23F', 'צהוב'], ['#3CB371', 'ירוק'],
  ['#1E7B4F', 'ירוק כהה'], ['#7CC8F2', 'תכלת'], ['#2D5BE3', 'כחול'], ['#8E5CD9', 'סגול'],
  ['#FF7EB6', 'ורוד'], ['#9A6B43', 'חום'], ['#1C2A3A', 'שחור'], ['#FFFFFF', 'לבן'],
];
const DEFAULT_COLOR = '#2D5BE3';

const T = {
  pick: 'בְּחַר צִיּוּר',
  reward: 'הִגִּיעַ הַזְּמַן לְצַיֵּר!',
  done: 'סִיַּמְתִּי',
};

const PATHS = {
  back: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  bucket: '<path d="M19 11 11 3l-8.3 8.3a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0Z"/><path d="m5 2 5 5"/><path d="M2.5 13H18"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  pen: '<path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  eraser: '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  undo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',   // הפוך — מימין לשמאל
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (d) => `<svg class="ic" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

// ברגע שראינו את העט — נגיעות אצבע על הציור הן כנראה כף היד (כמו ב-trace.js)
let penSeen = false;

// ---------- שכבות SVG ----------
const setAttrs = (el, attrs) => { for (const k in attrs) el.setAttribute(k, attrs[k]); };

function parseSvg(markup) {
  const src = `<svg xmlns="${NS}" viewBox="0 0 800 600">${markup}</svg>`;
  try {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    const root = doc.documentElement;
    if (root?.localName === 'svg' && !doc.getElementsByTagName('parsererror').length) {
      return document.importNode(root, true);
    }
  } catch {}
  const svg = document.createElementNS(NS, 'svg');   // גיבוי: פרסור HTML בתוך svg
  svg.innerHTML = markup;
  return svg;
}

// kind: 'fills' (צבעים, מתחת לדיו) | 'lines' (קווי מתאר, מעל הדיו). הכל כמאפיינים — כדי שיעבור ל-PNG.
function buildLayer(page, kind, stroke = 6) {
  const svg = parseSvg(BG + page.svg);
  setAttrs(svg, { viewBox: '0 0 800 600', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true', focusable: 'false' });
  const $$ = (sel) => svg.querySelectorAll(sel);
  if (kind === 'fills') {
    $$('.ln, .tx').forEach((el) => el.remove());
    $$('.r').forEach((el) => setAttrs(el, { fill: WHITE, stroke: 'none' }));
    // קווים מתחת לצבע (מסלולים) — לא תופסים נגיעות, כדי שהנגיעה תגיע לאזור שמתחת
    $$('.under').forEach((el) => setAttrs(el, {
      fill: 'none', stroke: '#C9D8EA', 'stroke-width': 3, 'stroke-dasharray': '10 12', 'pointer-events': 'none',
    }));
  } else {
    $$('.bg, .under').forEach((el) => el.remove());
    $$('.r').forEach((el) => setAttrs(el, { fill: 'none', stroke: INK, 'stroke-width': stroke, 'stroke-linejoin': 'round' }));
    $$('.ln').forEach((el) => setAttrs(el, { fill: 'none', stroke: INK, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    $$('.tx').forEach((el) => setAttrs(el, { fill: INK }));
    svg.setAttribute('pointer-events', 'none');
  }
  return svg;
}

const isBlank = (page) => !(page?.svg || '').trim();

// ---------- בחירת דף ----------
export function renderPicker(container, { onPick, onBack } = {}) {
  const root = document.createElement('div');
  root.className = 'picker';
  root.innerHTML = `
    <header class="pick-head">
      ${onBack ? `<button type="button" class="pick-back" aria-label="חזרה למילים">${icon(PATHS.back)}</button>` : ''}
      <div class="pick-titles">
        <h1 class="pick-title">${T.pick}</h1>
        <p class="pick-sub">${T.reward}</p>
      </div>
    </header>
    <div class="pick-scroll"><div class="pick-grid"></div></div>`;

  const grid = root.querySelector('.pick-grid');
  for (const page of PAGES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pick-card';
    card.dataset.page = page.id;
    const thumb = document.createElement('span');
    thumb.className = 'pick-thumb';
    if (isBlank(page)) thumb.classList.add('is-blank');
    else {
      try { thumb.append(buildLayer(page, 'lines', 5)); } catch (err) { console.warn('coloring: thumb failed', page.id, err); }
    }
    const name = document.createElement('span');
    name.className = 'pick-name';
    name.textContent = page.name;
    card.append(thumb, name);
    grid.append(card);
  }

  let last = 0;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const now = performance.now();
    if (now - last < 700) return;   // לחיצה כפולה
    last = now;
    tick();
    if (btn.classList.contains('pick-back')) { onBack?.(); return; }
    const page = PAGES.find((p) => p.id === btn.dataset.page);
    if (page) onPick?.(page);
  });

  container.replaceChildren(root);
}

// ---------- ציור קו מווקטורים ----------
function paint(g, s, i) {
  const [x, y, w] = s.pts[i];
  g.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  g.strokeStyle = g.fillStyle = s.erase ? '#000' : s.color;
  if (i === 0) {   // נקודה — גם נגיעה בלי תזוזה משאירה סימן
    g.beginPath(); g.arc(x, y, w / 2, 0, Math.PI * 2); g.fill();
    return;
  }
  const [px, py, pw] = s.pts[i - 1];
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = (w + pw) / 2;
  g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
}

function canvasToBlob(c) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('toBlob timeout')), 8000);
    const done = (b) => { clearTimeout(t); b?.size ? resolve(b) : reject(new Error('empty blob')); };
    const fail = (err) => { clearTimeout(t); reject(err); };
    try {
      if (c.toBlob) c.toBlob(done, 'image/png');
      else fetch(c.toDataURL('image/png')).then((r) => r.blob()).then(done, fail);
    } catch (err) { fail(err); }   // קנבס "מזוהם" זורק כאן
  });
}

// ---------- מסך צביעה ----------
export class Colorer {
  constructor(container, page, { onDone } = {}) {
    this.container = container;
    this.page = page;
    this.onDone = onDone;
    this.blank = isBlank(page);
    this.strokes = [];     // {color, size, erase, pts:[[x,y,w],...]}
    this.undo = [];        // {type:'fill', el, prev} | {type:'ink', stroke}
    this.cur = null;       // הקו שמצויר עכשיו
    this.tap = null;       // נגיעת אצבע במצב דלי שמחכה לשחרור
    this.color = DEFAULT_COLOR;
    this.size = SIZES[1].size;
    this.busy = false;
    this.destroyed = false;
    this.offs = [];
    this.urls = new Set();
    this.build();
    this.bind();
    this.setTool(this.hasRegions ? 'fill' : 'pen');
    this.setColor(this.color);
    this.setSize(this.size);
    this.syncUndo();
  }

  build() {
    const root = document.createElement('div');
    root.className = 'c-root';
    root.innerHTML = `
      <div class="c-wrap"><div class="c-stage"></div></div>
      <div class="c-bar" role="toolbar" aria-label="כלי ציור">
        <div class="c-tools">
          <button type="button" class="c-btn" data-tool="fill" aria-label="דלי צבע">${icon(PATHS.bucket)}</button>
          <button type="button" class="c-btn" data-tool="pen" aria-label="עט">${icon(PATHS.pen)}</button>
          <button type="button" class="c-btn" data-tool="eraser" aria-label="מחק">${icon(PATHS.eraser)}</button>
        </div>
        <div class="c-sizes">${SIZES.map((s) => `
          <button type="button" class="c-size" data-size="${s.size}" aria-label="${s.label}"><span class="c-dot" style="--d:${s.dot}px"></span></button>`).join('')}
        </div>
        <div class="c-palette">${COLORS.map(([c, name]) => `
          <button type="button" class="c-swatch${c === WHITE ? ' is-white' : ''}" data-color="${c}" aria-label="${name}" style="background-color:${c}"></button>`).join('')}
        </div>
        <button type="button" class="c-btn c-undo" data-act="undo" aria-label="ביטול">${icon(PATHS.undo)}</button>
        <button type="button" class="c-done" data-act="done">${icon(PATHS.check)}<span>${T.done}</span></button>
      </div>`;

    this.root = root;
    this.wrap = root.querySelector('.c-wrap');
    this.stage = root.querySelector('.c-stage');
    this.bar = root.querySelector('.c-bar');
    this.sizesEl = root.querySelector('.c-sizes');
    this.undoBtn = root.querySelector('.c-undo');
    this.doneBtn = root.querySelector('.c-done');

    this.fills = this.lines = null;
    if (!this.blank) {
      try {
        this.fills = buildLayer(this.page, 'fills');
        this.lines = buildLayer(this.page, 'lines');
        this.fills.classList.add('c-fills');
        this.lines.classList.add('c-lines');
      } catch (err) {
        console.warn('coloring: page failed, using blank', err);
        this.blank = true;
        this.fills = this.lines = null;
      }
    }
    this.ink = document.createElement('canvas');
    this.ink.className = 'c-ink';
    this.ink.width = W;
    this.ink.height = H;
    this.ctx = this.ink.getContext('2d');
    this.stage.append(...[this.fills, this.ink, this.lines].filter(Boolean));

    this.hasRegions = !!this.fills?.querySelector('.r:not(.bg)');
    root.querySelector('[data-tool="fill"]').hidden = !this.hasRegions;
    this.container.replaceChildren(root);
  }

  on(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this.offs.push(() => el.removeEventListener(type, fn, opts));
  }

  bind() {
    this.on(this.bar, 'click', (e) => this.onBar(e));
    // קודם כל: לזהות עט (גם במצב דלי) ולבטל "נגיעה" שהייתה בעצם כף יד
    this.on(this.stage, 'pointerdown', (e) => {
      if (e.pointerType === 'pen') { penSeen = true; this.tap = null; }
    }, true);
    this.on(this.stage, 'contextmenu', (e) => e.preventDefault());

    if (this.fills) {
      this.on(this.fills, 'pointerdown', (e) => this.fillDown(e));
      this.on(this.fills, 'pointerup', (e) => this.fillUp(e));
      this.on(this.fills, 'pointercancel', () => { this.tap = null; });
    }
    this.on(this.ink, 'pointerdown', (e) => this.inkDown(e));
    this.on(this.ink, 'pointermove', (e) => this.inkMove(e));
    this.on(this.ink, 'pointerup', (e) => this.inkUp(e, false));
    this.on(this.ink, 'pointercancel', (e) => this.inkUp(e, true));
    this.on(this.ink, 'lostpointercapture', (e) => this.inkUp(e, false));

    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(this.wrap);
    } else {
      this.on(window, 'resize', () => this.fit());
      requestAnimationFrame(() => this.fit());
    }
  }

  // תיבה של 4:3 בדיוק, בגודל המקסימלי שנכנס
  fit() {
    if (this.destroyed) return;
    const r = this.wrap.getBoundingClientRect();
    const w = Math.floor(Math.min(r.width, (r.height * 4) / 3) / 4) * 4;
    if (w <= 0) return;
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${(w * 3) / 4}px`;
  }

  // ---------- סרגל כלים ----------
  onBar(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled || this.busy) return;
    const { tool, size, color, act } = b.dataset;
    if (act === 'done') { this.finish(); return; }
    if (tool) this.setTool(tool);
    else if (size) this.setSize(Number(size));
    else if (color) {
      this.setColor(color);
      if (this.tool === 'eraser') this.setTool('pen');   // בחירת צבע = חוזרים לצייר
    } else if (act === 'undo') this.undoLast();
    tick();
  }

  setTool(tool) {
    this.cur = null;
    this.tap = null;
    this.tool = tool;
    this.root.dataset.tool = tool;
    this.ink.style.pointerEvents = tool === 'fill' ? 'none' : 'auto';
    for (const b of this.bar.querySelectorAll('[data-tool]')) {
      const on = b.dataset.tool === tool;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.sizesEl.classList.toggle('is-off', tool === 'fill');
    this.sizesEl.setAttribute('aria-hidden', String(tool === 'fill'));
  }

  setColor(color) {
    this.color = color;
    for (const b of this.bar.querySelectorAll('[data-color]')) {
      const on = b.dataset.color === color;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  setSize(size) {
    this.size = size;
    for (const b of this.bar.querySelectorAll('[data-size]')) {
      const on = Number(b.dataset.size) === size;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // ---------- דלי ----------
  fillDown(e) {
    if (this.busy || this.tool !== 'fill') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch' && penSeen) {
      // אחרי שראינו עט: אצבע צובעת רק בנגיעה קצרה (כף יד שנשענת לא צובעת)
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), target: e.target };
      return;
    }
    this.fillAt(e.target);
  }

  fillUp(e) {
    const tp = this.tap;
    if (!tp || tp.id !== e.pointerId) return;
    this.tap = null;
    if (this.busy || this.tool !== 'fill') return;
    const quick = performance.now() - tp.t < 450;
    const still = Math.hypot(e.clientX - tp.x, e.clientY - tp.y) < 20;
    if (quick && still) this.fillAt(tp.target);
  }

  fillAt(target) {
    const el = target?.closest?.('.r');
    if (!el || !this.fills?.contains(el)) return;
    const prev = el.getAttribute('fill') || WHITE;
    if (prev === this.color) return;
    el.setAttribute('fill', this.color);
    this.pushUndo({ type: 'fill', el, prev });
    tick();
  }

  // ---------- עט ומחק ----------
  inkDown(e) {
    if (this.busy || this.tool === 'fill') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') {
      // כף היד נגעה לפני העט — מוחקים את הקו שלה
      if (this.cur?.type === 'touch') this.dropCurrent();
    } else if (e.pointerType === 'touch' && penSeen) return;
    // יש רק עט אחד ועכבר אחד: קו פתוח שלהם הוא שארית של pointerup שלא הגיע — לא נתקעים
    if (e.pointerType !== 'touch' && this.cur?.type === e.pointerType) this.cur = null;
    if (this.cur) return;   // כבר מציירים עם אצבע אחרת
    const erase = this.tool === 'eraser';
    if (erase && !this.strokes.some((s) => !s.erase)) return;   // אין מה למחוק
    e.preventDefault();
    try { this.ink.setPointerCapture(e.pointerId); } catch {}
    this.rect = this.ink.getBoundingClientRect();
    const stroke = { color: this.color, size: this.size, erase, pts: [] };
    this.strokes.push(stroke);
    this.pushUndo({ type: 'ink', stroke });
    this.cur = { id: e.pointerId, type: e.pointerType, stroke, p: null };
    this.addPoint(e);
  }

  inkMove(e) {
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    for (const ev of evs?.length ? evs : [e]) this.addPoint(ev);
  }

  inkUp(e, cancelled) {
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    // המערכת ביטלה נגיעת אצבע (בדרך כלל כף יד) — הקו לא נשאר
    if (cancelled && c.type === 'touch') this.dropCurrent();
    this.cur = null;
  }

  addPoint(ev) {
    const c = this.cur;
    const s = c.stroke;
    const r = this.rect;
    if (!r?.width || !r.height) return;
    const x = ((ev.clientX - r.left) / r.width) * W;
    const y = ((ev.clientY - r.top) / r.height) * H;
    let w = s.size;
    if (s.erase) w = s.size * ERASER_SCALE;
    else if (c.type === 'pen') {
      const raw = ev.pressure || 0.5;
      c.p = c.p == null ? raw : c.p * 0.5 + raw * 0.5;   // החלקה קלה של הלחץ
      w = s.size * (0.6 + 0.8 * c.p);
    }
    const last = s.pts[s.pts.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) < 1) return;
    s.pts.push([x, y, w]);
    paint(this.ctx, s, s.pts.length - 1);
  }

  dropCurrent() {
    const s = this.cur?.stroke;
    this.cur = null;
    if (!s) return;
    this.strokes = this.strokes.filter((x) => x !== s);
    this.undo = this.undo.filter((u) => u.stroke !== s);
    this.redraw();
    this.syncUndo();
  }

  redraw() {
    const g = this.ctx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    for (const s of this.strokes) for (let i = 0; i < s.pts.length; i++) paint(g, s, i);
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- ביטול ----------
  pushUndo(u) { this.undo.push(u); this.syncUndo(); }

  syncUndo() { this.undoBtn.disabled = !this.undo.length; }

  undoLast() {
    this.cur = null;
    const u = this.undo.pop();
    if (!u) return;
    if (u.type === 'fill') u.el.setAttribute('fill', u.prev);
    else {
      const i = this.strokes.lastIndexOf(u.stroke);
      if (i >= 0) this.strokes.splice(i, 1);
      this.redraw();
    }
    this.syncUndo();
  }

  // ---------- סיום ושמירה ----------
  async finish() {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    this.cur = null;
    this.tap = null;
    this.doneBtn.disabled = true;
    this.doneBtn.classList.add('is-busy');
    tick();
    const pageId = this.page.id;
    let out = { blob: null, pageId, touched: false };
    if (this.undo.length) {
      const blob = await this.compose();
      // touched מגיע תמיד עם blob — אם אפילו הגיבוי נכשל, אין מה לשמור
      if (blob) out = { blob, pageId, touched: true };
    }
    if (this.destroyed) return;
    try {
      await this.onDone?.(out);
    } catch (err) {
      console.error('coloring: onDone failed', err);
      if (!this.destroyed) {   // לא להשאיר את הילד תקוע
        this.busy = false;
        this.doneBtn.disabled = false;
        this.doneBtn.classList.remove('is-busy');
      }
    }
  }

  // לבן → צבעים → דיו → קווים. אם נכשל: blob URL → data URL → דיו בלבד.
  async compose() {
    const layers = this.blank ? [] : [this.fills, this.lines];
    if (layers.length) {
      for (const mode of ['blob', 'data']) {
        try {
          const [fillImg, lineImg] = await Promise.all(layers.map((l) => this.svgImage(l, mode)));
          if (this.destroyed) return null;
          return await this.flatten([fillImg, this.ink, lineImg]);
        } catch (err) {
          console.warn(`coloring: compose (${mode}) failed`, err);
        } finally {
          this.revokeUrls();
        }
      }
    }
    try {
      if (this.destroyed) return null;
      return await this.flatten([this.ink]);
    } catch (err) {
      console.warn('coloring: ink-only PNG failed', err);
      return null;
    }
  }

  async flatten(images) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    try {
      const g = c.getContext('2d');
      g.fillStyle = WHITE;
      g.fillRect(0, 0, W, H);
      for (const img of images) g.drawImage(img, 0, 0, W, H);
      return await canvasToBlob(c);
    } finally {
      c.width = c.height = 0;   // לשחרר זיכרון באייפד
    }
  }

  svgImage(layer, mode) {
    const svg = layer.cloneNode(true);
    svg.removeAttribute('class');
    svg.removeAttribute('style');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttributeNS(XMLNS, 'xmlns', NS);
    let xml = new XMLSerializer().serializeToString(svg);
    if (!/^<svg[^>]*\sxmlns="/.test(xml)) xml = xml.replace(/^<svg/, `<svg xmlns="${NS}"`);

    let url;
    if (mode === 'blob') {
      url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      this.urls.add(url);
    } else {
      url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const t = setTimeout(() => reject(new Error('svg image timeout')), 5000);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); reject(new Error('svg image failed')); };
      img.src = url;
    });
  }

  revokeUrls() {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.clear();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cur = null;
    this.tap = null;
    for (const off of this.offs) off();
    this.offs = [];
    this.ro?.disconnect();
    this.ro = null;
    this.revokeUrls();
    this.strokes = [];
    this.undo = [];
    if (this.ink) { this.ink.width = 0; this.ink.height = 0; }
    this.container.replaceChildren();
  }
}
