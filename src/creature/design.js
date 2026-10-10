// The editable creature: 7 painted layers + look settings.
import { LAYERS } from './frames.js';
import { GRID, X0, X1, Y0, Y1 } from './field.js';
import { packAddons, unpackAddons } from './addons.js';

export const PAINT = 384; // paint canvas resolution per layer

export function makeLayerCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = PAINT;
  return c;
}

export function newDesign(frame = 'biped') {
  const layers = {}, thick = {}, version = {};
  for (const id of LAYERS) { layers[id] = makeLayerCanvas(); thick[id] = 1; version[id] = 0; }
  return {
    frame, name: 'Blobbo', layers, thick, version,
    color: '#ef7d57', color2: '#ffd36e', pattern: 'spots', finish: 'clay',
    eyes: 'googly', eyeSize: 1, mouth: 'smile', voice: 'chirpy', addons: [],
  };
}

export function bump(design, id) { design.version[id] = (design.version[id] || 0) + 1; }

// world (side view) → paint pixels
export const w2p = (x, y) => [((x - X0) / (X1 - X0)) * PAINT, ((Y1 - y) / (Y1 - Y0)) * PAINT];
export const wlen = (l) => (l / (X1 - X0)) * PAINT;
export const p2w = (px, py) => [X0 + (px / PAINT) * (X1 - X0), Y1 - (py / PAINT) * (Y1 - Y0)];

const scratch = (() => { let c; return () => { if (!c) { c = document.createElement('canvas'); c.width = c.height = GRID; } return c; }; })();

// layer canvas → coverage (row 0 = bottom)
export function coverageOf(canvas) {
  const s = scratch(), ctx = s.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, GRID, GRID);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, GRID, GRID);
  const d = ctx.getImageData(0, 0, GRID, GRID).data;
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    out[(GRID - 1 - y) * GRID + x] = d[(y * GRID + x) * 4 + 3] / 255;
  }
  return out;
}

// Shapes in world units, painted solid. Used by ghosts, templates and the random generator.
export function paintShape(ctx, sh, fill = '#000') {
  ctx.save();
  ctx.fillStyle = fill; ctx.strokeStyle = fill;
  const [t] = sh;
  if (t === 'ellipse') {
    const [, x, y, rx, ry, rot = 0] = sh;
    const [px, py] = w2p(x, y);
    ctx.beginPath(); ctx.ellipse(px, py, wlen(rx), wlen(ry), -rot, 0, Math.PI * 2); ctx.fill();
  } else if (t === 'capsule') {
    const [, x1, y1, x2, y2, r, r2 = r] = sh;
    taperedStroke(ctx, [[x1, y1], [x2, y2]], r, r2);
  } else if (t === 'path') { // tapered stroke along points
    const [, pts, r1, r2] = sh;
    taperedStroke(ctx, pts, r1, r2);
  } else if (t === 'poly') {
    const [, pts] = sh;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = w2p(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
  } else if (t === 'tri') {
    const [, ax, ay, bx, by, cx, cy] = sh;
    ctx.beginPath();
    [[ax, ay], [bx, by], [cx, cy]].forEach(([x, y], i) => { const [px, py] = w2p(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
  } else if (t === 'fan') { // wing: from root (x,y) to tip (tx,ty), width w
    const [, x, y, tx, ty, w] = sh;
    const dx = tx - x, dy = ty - y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    const pts = [[x, y]];
    const N = 4;
    for (let i = 0; i <= N; i++) {
      const a = i / N;
      // scalloped trailing edge
      const bx = x + dx * (0.55 + 0.45 * Math.sin(a * Math.PI * 0.5)) - nx * w * 2.2 * a;
      const by = y + dy * (0.55 + 0.45 * Math.sin(a * Math.PI * 0.5)) - ny * w * 2.2 * a;
      pts.push([bx, by]);
    }
    pts.push([x - nx * w * 0.6, y - ny * w * 0.6]);
    ctx.beginPath();
    pts.forEach(([px0, py0], i) => { const [px, py] = w2p(px0, py0); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function taperedStroke(ctx, pts, r1, r2) {
  // densify and stamp circles — gives a soft organic tapered limb
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(2, Math.ceil(L / 0.01));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const r = r1 + (r2 - r1) * ((acc + L * t) / (total || 1));
      const [px, py] = w2p(x, y);
      ctx.beginPath(); ctx.arc(px, py, wlen(r), 0, Math.PI * 2); ctx.fill();
    }
    acc += L;
  }
}

export function clearLayer(design, id) {
  const ctx = design.layers[id].getContext('2d');
  ctx.clearRect(0, 0, PAINT, PAINT);
  bump(design, id);
}

export function cloneDesign(d) {
  const n = newDesign(d.frame);
  Object.assign(n, { ...d, layers: n.layers, thick: { ...d.thick }, version: { ...d.version }, addons: (d.addons || []).map((a) => ({ ...a, p: [...a.p], n: [...a.n] })) });
  for (const id of LAYERS) n.layers[id].getContext('2d').drawImage(d.layers[id], 0, 0);
  return n;
}

// ---- share codes: 64x64 bitmask per layer, RLE + base64 ----
const CODE_RES = 96;
export function encodeDesign(d) {
  const c = document.createElement('canvas'); c.width = c.height = CODE_RES;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const parts = {};
  for (const id of LAYERS) {
    ctx.clearRect(0, 0, CODE_RES, CODE_RES);
    ctx.drawImage(d.layers[id], 0, 0, CODE_RES, CODE_RES);
    const px = ctx.getImageData(0, 0, CODE_RES, CODE_RES).data;
    const runs = []; let cur = 0, run = 0;
    for (let i = 0; i < CODE_RES * CODE_RES; i++) {
      const b = px[i * 4 + 3] > 127 ? 1 : 0;
      if (b === cur) run++; else { runs.push(run); cur = b; run = 1; }
    }
    runs.push(run);
    parts[id] = runs.join('.');
  }
  const meta = { f: d.frame, n: d.name, t: d.thick, c: d.color, c2: d.color2, p: d.pattern, fi: d.finish, e: d.eyes, es: d.eyeSize, m: d.mouth, v: d.voice, L: parts };
  if (d.addons?.length) meta.a = packAddons(d.addons);
  return btoa(unescape(encodeURIComponent(JSON.stringify(meta)))).replace(/=+$/, '');
}

export function decodeDesign(code) {
  const meta = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  const d = newDesign(meta.f);
  Object.assign(d, { name: meta.n, color: meta.c, color2: meta.c2, pattern: meta.p, finish: meta.fi, eyes: meta.e, eyeSize: meta.es, mouth: meta.m || 'smile', voice: meta.v || 'chirpy', addons: unpackAddons(meta.a) });
  Object.assign(d.thick, meta.t);
  const c = document.createElement('canvas'); c.width = c.height = CODE_RES;
  const ctx = c.getContext('2d');
  for (const id of LAYERS) {
    const runs = (meta.L[id] || '').split('.').map(Number);
    const img = ctx.createImageData(CODE_RES, CODE_RES);
    let i = 0, b = 0;
    for (const r of runs) { for (let k = 0; k < r; k++, i++) if (b) img.data[i * 4 + 3] = 255; b ^= 1; }
    ctx.putImageData(img, 0, 0);
    const lctx = d.layers[id].getContext('2d');
    lctx.imageSmoothingEnabled = true;
    lctx.filter = 'blur(1.2px)';
    lctx.drawImage(c, 0, 0, PAINT, PAINT);
    lctx.filter = 'none';
    bump(d, id);
  }
  return d;
}
