// The Mold Lab: pick a body type, draw each part step by step (like Amazing Island),
// watch it inflate into clay on the turntable.
import { FRAMES, LAYERS, LAYER_COLORS, GHOSTS, OPTIONAL } from '../creature/frames.js';
import { PAINT, paintShape, bump, w2p, encodeDesign, decodeDesign, newDesign } from '../creature/design.js';
import { randomDesign, randomName } from '../creature/generator.js';
import { STAT_INFO } from '../creature/stats.js';
import { PATTERNS, FINISHES } from '../fx/clay.js';
import { sfx, babble } from '../fx/audio.js';

const $ = (id) => document.getElementById(id);
const INK = '#15172b';
const DRAW_ORDER = ['wings', 'tail', 'legs', 'body', 'limbs', 'head', 'top'];
const SWATCHES = ['#e63b2e', '#f29a1f', '#ffd23f', '#9bc53d', '#11a39a', '#4fb3e8', '#2f6fdf', '#3d3a8c', '#7b4fe0', '#ff6fa8', '#c2185b', '#8c5e3c', '#f2d0a9', '#fbf8f0', '#9aa5b1', '#2a2d4c'];
const EYES = { googly: 'Googly', dot: 'Beady', sleepy: 'Sleepy', angry: 'Grumpy', cyclops: 'Cyclops', tri: 'Three-eyed' };
const MOUTHS = { smile: 'Smile', fangs: 'Fangs', o: 'Ooh', none: 'None' };
const PATTERN_LABEL = { solid: 'Solid', spots: 'Spots', stripes: 'Stripes', patches: 'Patches', belly: 'Belly', speckle: 'Speckle', gradient: 'Fade', lava: 'Lava', stars: 'Stars' };
const FINISH_LABEL = { clay: 'Clay', felt: 'Felt', vinyl: 'Vinyl toy', jelly: 'Jelly' };
const STAT_COLORS = { speed: '#4fc3ff', power: '#ff5a3c', balance: '#ffd23f', glide: '#ff8fd0', swim: '#2fe0c0' };
const TIPS = ['drag to spin · click to poke', 'close a loop and it fills in', 'longer legs = faster runner', 'wings let you glide over gaps', 'a big tail makes a strong swimmer', 'wide feet = hard to knock over', 'keys 1–7 switch parts · B/E/O tools'];

export class Creator {
  constructor(app) {
    this.app = app;
    this.tool = 'brush'; this.size = 12; this.active = 'body';
    this.undo = []; this.redo = [];
    this.tintCache = {};
    this.canvas = $('paper'); this.ctx = this.canvas.getContext('2d');
    this.buildStatic();
    this.buildPicker();
    this.bindPaper();
    this.bindKeys();
    new ResizeObserver(() => this.resizePaper()).observe($('paper').parentElement);
  }

  // ---------- setup ----------
  buildStatic() {
    const fb = document.createElement('button');
    fb.className = 'frame-btn on'; fb.id = 'frame-current';
    fb.onclick = () => { sfx.tab(); this.showPicker(true); };
    $('frames').appendChild(fb);

    const tabs = $('part-tabs');
    LAYERS.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'part-tab'; b.dataset.layer = id; b.dataset.n = String(i + 1).padStart(2, '0');
      b.style.setProperty('--c', LAYER_COLORS[id]);
      b.onclick = () => this.setActive(id);
      tabs.appendChild(b);
    });
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.onclick = () => this.setTool(b.dataset.tool));
    document.querySelectorAll('#sizes .size').forEach((b) => b.onclick = () => this.setSize(+b.dataset.size));
    $('btn-style').onclick = () => { sfx.tab(); document.querySelector('.look-panel').classList.toggle('open'); };
    $('btn-undo').onclick = () => this.doUndo();
    $('btn-redo').onclick = () => this.doRedo();
    $('btn-clear').onclick = () => this.clearParts([this.active]);
    $('btn-clear-all').onclick = () => { this.clearParts(LAYERS); this.app.toast('Wiped clean. Undo brings it back.'); this.goStep(0); };
    $('step-next').onclick = () => this.goStep(this.step + 1);
    $('step-back').onclick = () => this.goStep(Math.max(0, this.step - 1));
    $('puff').oninput = (e) => { this.design.thick[this.active] = +e.target.value; $('puff-val').textContent = Math.round(e.target.value * 100) + '%'; this.rebuild(false, 120); };

    const swatchRow = (el, key) => {
      SWATCHES.forEach((c) => {
        const b = document.createElement('button'); b.className = 'sw'; b.style.setProperty('--c', c); b.dataset.c = c; b.title = c;
        b.onclick = () => { this.design[key] = c; sfx.pop(1.3); this.lookChanged(true); };
        el.appendChild(b);
      });
      const cu = document.createElement('label'); cu.className = 'sw custom'; cu.title = 'Custom color';
      const inp = document.createElement('input'); inp.type = 'color';
      inp.oninput = () => { this.design[key] = inp.value; this.lookChanged(key === 'color'); };
      cu.appendChild(inp); el.appendChild(cu);
    };
    swatchRow($('sw-a'), 'color'); swatchRow($('sw-b'), 'color2');
    const chipRow = (el, items, key, face) => {
      for (const [v, label] of Object.entries(items)) {
        const b = document.createElement('button'); b.className = 'chip'; b.dataset.v = v; b.textContent = label;
        b.onclick = () => { this.design[key] = v; sfx.click(); this.lookChanged(face); };
        el.appendChild(b);
      }
    };
    chipRow($('patterns'), Object.fromEntries(PATTERNS.map((p) => [p, PATTERN_LABEL[p]])), 'pattern', false);
    chipRow($('finishes'), Object.fromEntries(FINISHES.map((p) => [p, FINISH_LABEL[p]])), 'finish', false);
    chipRow($('eyes'), EYES, 'eyes', true);
    chipRow($('mouths'), MOUTHS, 'mouth', true);
    $('eye-size').oninput = (e) => { this.design.eyeSize = +e.target.value; clearTimeout(this.faceT); this.faceT = setTimeout(() => this.creature.rebuildFace(this.design), 60); };

    $('name').oninput = (e) => { this.design.name = e.target.value || '???'; this.refreshSpecNo(); };
    $('btn-rename').onclick = () => { this.design.name = randomName(Math.random); $('name').value = this.design.name; this.refreshSpecNo(); sfx.pop(); babble(1.2, 3); };
    $('btn-random').onclick = () => { sfx.sparkle(); this.load(randomDesign((Math.random() * 1e9) | 0)); this.goStep(LAYERS.length); };
    $('btn-share').onclick = () => this.shareModal();
    $('btn-blank').onclick = () => { sfx.squish(0.7); this.load(this.blankLike(this.design)); this.showPicker(true); };
    $('btn-guide').onclick = () => {
      this.pushUndo([this.active]);
      const x = this.design.layers[this.active].getContext('2d');
      for (const sh of GHOSTS[this.design.frame][this.active] || []) paintShape(x, sh);
      bump(this.design, this.active); sfx.pop(); this.changed();
    };
    let tipI = 0;
    setInterval(() => {
      const el = $('center-tip'); el.style.opacity = 0;
      setTimeout(() => { tipI = (tipI + 1) % TIPS.length; $('center-tip-txt').textContent = TIPS[tipI]; el.style.opacity = 1; }, 400);
    }, 6000);
    $('btn-done').onclick = () => this.app.finishCreator();

    // stats
    const st = $('stats');
    for (const [k, info] of Object.entries(STAT_INFO)) {
      const row = document.createElement('div'); row.className = 'stat'; row.title = info.tip;
      row.innerHTML = `<span>${info.icon}</span><span>${info.label}</span><span class="bar" style="--c:${STAT_COLORS[k]}"><i style="width:10%"></i><b class="delta"></b></span><span class="v">1</span>`;
      row.onmouseenter = () => { $('stat-tip').textContent = info.tip; };
      st.appendChild(row); this[`stat_${k}`] = row;
    }
    const tip = document.createElement('div'); tip.className = 'stat-tip'; tip.id = 'stat-tip'; tip.textContent = 'stats come from the shape you draw';
    st.appendChild(tip);
  }

  // body-type picker that sits over the paper (step 0)
  buildPicker() {
    const wrap = $('paper').parentElement;
    const p = document.createElement('div'); p.className = 'frame-picker hidden'; p.id = 'frame-picker';
    p.innerHTML = '<div class="fp-head"><span class="no">STEP 0</span><b>Pick a body type</b><small>It decides how your monster moves. You can change it later.</small></div><div class="fp-grid" id="fp-grid"></div>';
    wrap.appendChild(p);
    const grid = p.querySelector('#fp-grid');
    for (const [id, f] of Object.entries(FRAMES)) {
      const b = document.createElement('button'); b.className = 'fp-card'; b.dataset.frame = id;
      const cv = document.createElement('canvas'); cv.width = cv.height = 120;
      const x = cv.getContext('2d');
      // silhouette from the frame's guide shapes
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = PAINT;
      const tx = tmp.getContext('2d');
      for (const lid of DRAW_ORDER) for (const sh of GHOSTS[id][lid] || []) if (!OPTIONAL.has(lid) || lid === 'tail' || (id === 'flyer' && lid === 'wings')) paintShape(tx, sh, INK);
      x.drawImage(tmp, 0, 0, 120, 120);
      b.appendChild(cv);
      b.insertAdjacentHTML('beforeend', `<b>${f.name}</b><small>${f.perk}</small>`);
      b.title = f.desc;
      b.onclick = () => {
        sfx.pop(1.2);
        this.design.frame = id;
        this.showPicker(false);
        this.refreshAll(); this.rebuild(true);
        if (this.step == null || this.step >= LAYERS.length || this.isBlank()) this.goStep(0);
      };
      grid.appendChild(b);
    }
  }

  showPicker(on) {
    $('frame-picker').classList.toggle('hidden', !on);
    document.querySelectorAll('.fp-card').forEach((c) => c.classList.toggle('on', c.dataset.frame === this.design.frame));
    if (on) { $('step-no').textContent = 'STEP 0'; $('step-txt').innerHTML = 'Pick a body type<small>Click one of the cards on the paper.</small>'; $('step-next').classList.add('hidden'); $('step-back').classList.add('hidden'); }
  }

  blankLike(d) {
    const n = newDesign(d.frame);
    Object.assign(n, { name: randomName(Math.random), color: d.color, color2: d.color2, pattern: d.pattern, finish: d.finish, eyes: d.eyes, mouth: d.mouth, eyeSize: d.eyeSize });
    return n;
  }

  isBlank() { const A = this.creature?.analysis; return !A || !A.F || LAYERS.every((id) => A.F[id].empty); }

  // ---------- open / load ----------
  open(design, { fresh = false } = {}) {
    this.design = design;
    this.undo = []; this.redo = [];
    this.creature?.material.dispose();
    this.creature = this.app.makeCreature(design);
    this.app.studio.setCreature(this.creature);
    this.prevStats = null;
    this.active = 'body';
    this.refreshAll();
    this.resizePaper();
    this.updateStats();
    this.app.studio.popIn();
    document.querySelector('.look-panel').classList.remove('open');
    if (fresh) { this.step = 0; this.showPicker(true); }
    else { this.showPicker(false); this.goStep(LAYERS.length); }
  }

  load(design) {
    this.design = design;
    this.undo = []; this.redo = [];
    this.creature.material.dispose();
    this.creature = this.app.makeCreature(design);
    this.app.studio.setCreature(this.creature);
    this.refreshAll();
    this.updateStats();
    this.app.studio.popIn();
    babble(1.2, 4);
  }

  // ---------- guided steps ----------
  goStep(i) {
    this.step = i;
    $('step-next').classList.remove('hidden'); $('step-back').classList.remove('hidden');
    if (i >= LAYERS.length) {
      $('step-no').textContent = 'DONE';
      $('step-txt').innerHTML = 'Looking good!<small>Color it on the right, then hit BRING TO LIFE. Click any part tab to keep editing.</small>';
      $('step-next').classList.add('hidden');
      $('step-back').textContent = 'Back';
      $('btn-done').classList.add('pulse');
      return;
    }
    $('btn-done').classList.remove('pulse');
    this.setActive(LAYERS[i], true);
    sfx.tab();
  }

  refreshStep() {
    if (this.step == null || this.step >= LAYERS.length || !$('frame-picker').classList.contains('hidden')) return;
    const id = LAYERS[this.step];
    if (id !== this.active) { this.step = LAYERS.indexOf(this.active); }
    const def = FRAMES[this.design.frame].layers[this.active];
    const opt = OPTIONAL.has(this.active) || def.kind === 'fin';
    const A = this.creature?.analysis;
    const has = A && A.F && A.F[this.active] && !A.F[this.active].empty;
    $('step-no').textContent = `STEP ${this.step + 1}/${LAYERS.length}`;
    $('step-txt').innerHTML = `${opt ? 'Add' : 'Draw'} the ${def.label.toUpperCase()}${opt ? ' (optional)' : ''}<small>${def.hint}</small>`;
    const next = $('step-next');
    next.textContent = this.step === LAYERS.length - 1 ? (has ? 'Finish' : 'Skip + finish') : (has ? 'Next' : opt ? 'Skip' : 'Next');
    next.classList.toggle('primary', !!has);
    next.classList.toggle('pulse', !!has);
    $('step-back').classList.toggle('hidden', this.step === 0);
  }

  refreshAll() {
    const d = this.design, f = FRAMES[d.frame];
    $('frame-current').innerHTML = `<span>BODY TYPE · ${f.name}</span><small>${f.perk} — click to change</small>`;
    this.refreshTabs();
    $('name').value = d.name;
    this.refreshSpecNo();
    const mark = (sel, v) => document.querySelectorAll(sel).forEach((b) => b.classList.toggle('on', (b.dataset.v ?? b.dataset.c) === v));
    mark('#sw-a .sw', d.color); mark('#sw-b .sw', d.color2);
    mark('#patterns .chip', d.pattern); mark('#finishes .chip', d.finish); mark('#eyes .chip', d.eyes); mark('#mouths .chip', d.mouth);
    $('eye-size').value = d.eyeSize;
    this.setActive(this.active, true);
    this.drawPaper();
  }

  refreshSpecNo() {
    let h = 7; for (const ch of this.design.name) h = (h * 31 + ch.charCodeAt(0)) % 997;
    $('spec-no').textContent = 'No.' + String(h + 1).padStart(3, '0');
  }

  refreshTabs() {
    const frame = FRAMES[this.design.frame];
    const A = this.creature?.analysis;
    document.querySelectorAll('.part-tab').forEach((b) => {
      const id = b.dataset.layer;
      b.textContent = frame.layers[id].label;
      b.title = frame.layers[id].hint;
      b.classList.toggle('on', id === this.active);
      b.classList.toggle('has', !!A && A.F && A.F[id] && !A.F[id].empty);
    });
    this.refreshStep();
  }

  setActive(id, silent) {
    this.active = id;
    if (!silent) sfx.tab();
    if (this.step != null && this.step < LAYERS.length) this.step = LAYERS.indexOf(id);
    const def = FRAMES[this.design.frame].layers[id];
    $('paper-hint').textContent = `${def.label}: ${def.hint}`;
    $('puff').value = this.design.thick[id];
    $('puff-val').textContent = Math.round(this.design.thick[id] * 100) + '%';
    this.refreshTabs();
    this.drawPaper();
  }
  setTool(t) { this.tool = t; document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); sfx.click(); }
  setSize(s) { this.size = s; document.querySelectorAll('#sizes .size').forEach((b) => b.classList.toggle('on', +b.dataset.size === s)); sfx.click(); }

  lookChanged(face) {
    const d = this.design;
    this.creature.setLook(d);
    if (face) this.creature.rebuildFace(d);
    this.refreshAll();
  }

  clearParts(ids) {
    this.pushUndo(ids);
    for (const id of ids) { this.design.layers[id].getContext('2d').clearRect(0, 0, PAINT, PAINT); bump(this.design, id); }
    sfx.squish(0.6);
    this.changed();
  }

  // ---------- rebuild ----------
  changed() { this.refreshTabs(); this.drawPaper(); this.rebuild(); }

  rebuild(full = false, delay = 0) {
    clearTimeout(this.quickT); clearTimeout(this.fullT);
    const go = (detail) => {
      const t0 = performance.now();
      this.creature.build(this.design, detail);
      this.lastBuildMs = performance.now() - t0;
      this.updateStats();
      this.refreshTabs();
      this.drawPaper();
    };
    if (full) { go(64); this.app.studio.popIn(); return; }
    this.quickT = setTimeout(() => { go(42); this.app.studio.popIn(); }, delay);
    this.fullT = setTimeout(() => go(64), delay + 450);
  }

  updateStats() {
    const s = this.creature.stats;
    for (const k of Object.keys(STAT_INFO)) {
      const row = this[`stat_${k}`];
      row.querySelector('.bar i').style.width = (s[k] * 10) + '%';
      row.querySelector('.v').textContent = s[k].toFixed(1);
      const dEl = row.querySelector('.delta');
      if (this.prevStats) {
        const dv = s[k] - this.prevStats[k];
        if (Math.abs(dv) >= 0.3) {
          dEl.textContent = (dv > 0 ? '+' : '') + dv.toFixed(1);
          dEl.style.color = dv > 0 ? '#7dff9a' : '#ff6b5a';
          clearTimeout(dEl._t); dEl._t = setTimeout(() => dEl.textContent = '', 1600);
        }
      }
    }
    this.prevStats = { ...s };
  }

  // ---------- paper ----------
  resizePaper() {
    const wrap = this.canvas.parentElement;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(10, r.width * dpr); this.canvas.height = Math.max(10, r.height * dpr);
    this.dpr = dpr;
    const sq = Math.max(10, Math.min(r.width, r.height) - 8);
    this.sq = sq; this.offX = (r.width - sq) / 2; this.offY = (r.height - sq) / 2;
    this._w = r.width; this._h = r.height;
    this.drawPaper();
  }

  // the panel can change size while hidden; re-measure whenever it matters
  ensureSize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (r.width > 0 && (r.width !== this._w || r.height !== this._h)) { this.resizePaper(); return false; }
    return true;
  }

  tintCanvas(cacheKey, src, color) {
    const c = this.tintCache[cacheKey.split('|')[0]];
    if (c && c.key === cacheKey) return c.canvas;
    const cv = c?.canvas || Object.assign(document.createElement('canvas'), { width: PAINT, height: PAINT });
    const x = cv.getContext('2d');
    x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, PAINT, PAINT);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, PAINT, PAINT);
    this.tintCache[cacheKey.split('|')[0]] = { key: cacheKey, canvas: cv };
    return cv;
  }

  drawPaper() {
    if (!this.design) return;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._drawPaper(); });
  }

  _drawPaper() {
    if (!this.ensureSize()) return;
    const { ctx, dpr, sq, offX, offY } = this;
    const d = this.design;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const S = sq / PAINT;
    ctx.save();
    ctx.translate(offX, offY);
    // ground line + facing
    ctx.strokeStyle = 'rgba(21,23,43,.45)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
    const gy = w2p(0, 0.02)[1] * S;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(sq, gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '12px "DotGothic16", monospace'; ctx.fillStyle = 'rgba(21,23,43,.6)';
    ctx.fillText('GROUND', 28, gy - 6);
    ctx.fillText('FRONT ▶', sq - 70, 22);

    const A = this.creature?.analysis;
    const empty = (id) => !A || !A.F || !A.F[id] || A.F[id].empty;
    // the frame's body plan, faintly — the active part's guide stronger
    const g = this.ghostCanvas || (this.ghostCanvas = Object.assign(document.createElement('canvas'), { width: PAINT, height: PAINT }));
    const gx = g.getContext('2d');
    for (const id of DRAW_ORDER) {
      if (!empty(id) || OPTIONAL.has(id) && id !== this.active) continue;
      gx.clearRect(0, 0, PAINT, PAINT);
      for (const sh of GHOSTS[d.frame][id] || []) paintShape(gx, sh, id === this.active ? LAYER_COLORS[id] : INK);
      ctx.globalAlpha = id === this.active ? 0.22 : 0.06;
      ctx.drawImage(g, 0, 0, sq, sq);
    }
    ctx.globalAlpha = 1;

    // drawn layers with an ink outline
    const t = 2.2;
    for (const id of DRAW_ORDER) {
      const v = d.version[id];
      const tinted = this.tintCanvas(`${id}|${v}|${LAYER_COLORS[id]}`, d.layers[id], LAYER_COLORS[id]);
      const ink = this.tintCanvas(`${id}ink|${v}`, d.layers[id], INK);
      const on = id === this.active;
      ctx.globalAlpha = on ? 1 : 0.62;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.drawImage(ink, Math.cos(a) * t, Math.sin(a) * t, sq, sq); }
      ctx.drawImage(tinted, 0, 0, sq, sq);
    }
    ctx.globalAlpha = 1;
    // joints
    if (A && !A.empty) {
      for (const b of A.bones) {
        if (b.side < 0) continue;
        const [px, py] = w2p(b.pos[0], b.pos[1]);
        ctx.beginPath(); ctx.arc(px * S, py * S, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      }
    }
    // previews: closing loop / oval stamp
    if (this.stroke && this.tool === 'brush' && this.stroke.pts.length > 1) {
      const p = this.stroke.pts;
      if (this.isLoop(this.stroke)) {
        ctx.fillStyle = LAYER_COLORS[this.active]; ctx.globalAlpha = 0.35;
        ctx.beginPath(); p.forEach(([x, y], i) => i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S)); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    if (this.oval) {
      const o = this.oval;
      ctx.fillStyle = LAYER_COLORS[this.active]; ctx.globalAlpha = 0.5; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.ellipse((o.a[0] + o.b[0]) / 2 * S, (o.a[1] + o.b[1]) / 2 * S, Math.abs(o.b[0] - o.a[0]) / 2 * S, Math.abs(o.b[1] - o.a[1]) / 2 * S, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    $('paper-empty').classList.toggle('hidden', !(!A || A.empty) || !!this.stroke || !!this.oval);
    $('btn-guide').classList.toggle('hidden', !empty(this.active) || !!this.stroke);
  }

  // an outline counts as closed if it ends near where it started (generous on purpose)
  isLoop(s) {
    const p = s.pts, end = s.raw || p[p.length - 1];
    if (s.len < 70) return false;
    const gap = Math.hypot(p[0][0] - end[0], p[0][1] - end[1]);
    return gap < Math.max(36, this.size * 3, s.len * 0.14);
  }

  toPaint(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.offX) / this.sq * PAINT, (e.clientY - r.top - this.offY) / this.sq * PAINT];
  }

  bindPaper() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.ensureSize();
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
      this.pushUndo([this.active]);
      const p = this.toPaint(e);
      if (this.tool === 'oval') { this.oval = { a: p, b: p }; return; }
      this.stroke = { pts: [p], smooth: p, len: 0 };
      this.paintSeg(p, p, e);
      this.lastSquish = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.oval) { this.oval.b = this.toPaint(e); this.drawPaper(); return; }
      if (!this.stroke) return;
      let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      for (const ev of evs) {
        const raw = this.toPaint(ev);
        const s = this.stroke;
        // streamline: chase the pointer for silky lines
        s.raw = raw;
        const sm = [s.smooth[0] + (raw[0] - s.smooth[0]) * 0.55, s.smooth[1] + (raw[1] - s.smooth[1]) * 0.55];
        this.paintSeg(s.smooth, sm, ev);
        s.len += Math.hypot(sm[0] - s.smooth[0], sm[1] - s.smooth[1]);
        s.smooth = sm; s.pts.push(sm);
      }
      const now = performance.now();
      if (now - this.lastSquish > 90) { this.lastSquish = now; sfx.squish(0.8 + Math.random() * 0.5); }
      this.drawPaper();
    });
    const end = () => {
      if (this.oval) {
        const o = this.oval; this.oval = null;
        const rx = Math.abs(o.b[0] - o.a[0]) / 2, ry = Math.abs(o.b[1] - o.a[1]) / 2;
        if (rx > 3 && ry > 3) {
          const x = this.design.layers[this.active].getContext('2d');
          x.fillStyle = '#000'; x.beginPath(); x.ellipse((o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2, rx, ry, 0, 0, Math.PI * 2); x.fill();
          sfx.pop(0.9);
        } else this.undo.pop();
        bump(this.design, this.active); this.redo = []; this.changed();
        return;
      }
      if (!this.stroke) return;
      const s = this.stroke; this.stroke = null;
      if (s.raw) { this.paintSeg(s.smooth, s.raw, { pointerType: 'mouse' }); s.pts.push(s.raw); }
      const p = s.pts;
      if (this.tool === 'brush' && this.isLoop(s)) {
        const x = this.design.layers[this.active].getContext('2d');
        x.save(); x.fillStyle = '#000'; x.beginPath();
        p.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b));
        x.closePath(); x.fill(); x.restore();
        sfx.pop(0.9);
      }
      bump(this.design, this.active);
      this.redo = [];
      this.changed();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  paintSeg(a, b, e) {
    const x = this.design.layers[this.active].getContext('2d');
    let w = this.size * (PAINT / 256);
    if (e.pointerType === 'pen' && e.pressure > 0) w *= 0.45 + e.pressure * 1.1;
    x.save();
    x.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    x.strokeStyle = '#000'; x.lineWidth = this.tool === 'eraser' ? w * 1.5 : w; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0] + 0.01, b[1]); x.stroke();
    x.restore();
    bump(this.design, this.active);
  }

  // undo entries can cover several parts (clear-all)
  snapshot(ids) { return ids.map((id) => ({ id, img: this.design.layers[id].getContext('2d', { willReadFrequently: true }).getImageData(0, 0, PAINT, PAINT) })); }
  pushUndo(ids) {
    this.undo.push(this.snapshot(ids));
    if (this.undo.length > 40) this.undo.shift();
  }
  restore(stackFrom, stackTo) {
    const u = stackFrom.pop(); if (!u) return;
    stackTo.push(this.snapshot(u.map((e) => e.id)));
    for (const e of u) { this.design.layers[e.id].getContext('2d').putImageData(e.img, 0, 0); bump(this.design, e.id); }
    if (u.length === 1 && u[0].id !== this.active) this.setActive(u[0].id, true);
    sfx.squish(1.3);
    this.changed();
  }
  doUndo() { this.restore(this.undo, this.redo); }
  doRedo() { this.restore(this.redo, this.undo); }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (this.app.mode !== 'creator' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.doRedo() : this.doUndo(); return; }
      if (k === 'b') this.setTool('brush');
      if (k === 'e') this.setTool('eraser');
      if (k === 'o') this.setTool('oval');
      if (k >= '1' && k <= '7') this.setActive(LAYERS[+k - 1]);
      if (k === 'enter' && this.step < LAYERS.length) this.goStep(this.step + 1);
      if (k === '[') this.setSize([6, 12, 22, 38][Math.max(0, [6, 12, 22, 38].indexOf(this.size) - 1)]);
      if (k === ']') this.setSize([6, 12, 22, 38][Math.min(3, [6, 12, 22, 38].indexOf(this.size) + 1)]);
    });
  }

  // ---------- sharing ----------
  shareModal() {
    const code = encodeDesign(this.design);
    this.app.modal(`
      <h2><span class="jp">共有</span>Creature code</h2>
      <p>Copy this to share <b>${escapeHtml(this.design.name)}</b>. Paste a friend's code here to load theirs.</p>
      <textarea id="code-box">${code}</textarea>
      <div class="row">
        <button class="btn primary" id="m-copy">Copy</button>
        <button class="btn" id="m-load">Load pasted code</button>
        <button class="btn ghost" id="m-close">Close</button>
      </div>`);
    $('m-copy').onclick = () => { navigator.clipboard?.writeText(code); this.app.toast('Copied! Go show someone.'); sfx.chime(); };
    $('m-load').onclick = () => {
      try { const d = decodeDesign($('code-box').value); this.app.closeModal(); this.load(d); this.goStep(LAYERS.length); this.app.toast(`${d.name} has arrived!`); }
      catch { this.app.toast('Hmm, that code looks squished.'); sfx.bonk(); }
    };
    $('m-close').onclick = () => this.app.closeModal();
  }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export { newDesign };
