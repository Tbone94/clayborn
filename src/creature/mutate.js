// "Curse it": one-click mutations that warp the drawing itself, so the result stays editable
// (and undoable). Each one is a plain 2D transform of a layer's paint canvas.
import { PAINT, bump } from './design.js';
import { LAYERS } from './frames.js';

// pixel bounds of whatever is painted on a layer (null when empty)
function bounds(canvas) {
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, PAINT, PAINT).data;
  let x0 = PAINT, y0 = PAINT, x1 = -1, y1 = -1;
  for (let y = 0; y < PAINT; y += 2) for (let x = 0; x < PAINT; x += 2) {
    if (d[(y * PAINT + x) * 4 + 3] < 100) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

// redraw a layer through fn(ctx, copyOfOldPixels)
function redraw(d, id, fn) {
  const c = d.layers[id], tmp = document.createElement('canvas');
  tmp.width = tmp.height = PAINT;
  tmp.getContext('2d').drawImage(c, 0, 0);
  const x = c.getContext('2d');
  x.save(); x.clearRect(0, 0, PAINT, PAINT); fn(x, tmp); x.restore();
  bump(d, id);
}

// scale a layer around an anchor point (paint pixels)
function scale(d, id, sx, sy, ax, ay) {
  redraw(d, id, (x, src) => { x.translate(ax, ay); x.scale(sx, sy); x.translate(-ax, -ay); x.drawImage(src, 0, 0); });
}
const shift = (d, id, dx, dy) => redraw(d, id, (x, src) => x.drawImage(src, dx, dy));

const has = (B, id) => !!B[id];

// each: when it applies, and what it does. Names show up in the toast.
const CURSES = [
  { name: 'BIG HEAD ENERGY', ok: (B) => has(B, 'head'), run: (d, B) => { const b = B.head; scale(d, 'head', 1.6, 1.6, b.cx, b.y1); scale(d, 'top', 1.6, 1.6, b.cx, b.y1); } },
  { name: 'Pea brain', ok: (B) => has(B, 'head'), run: (d, B) => { const b = B.head; scale(d, 'head', 0.5, 0.5, b.cx, b.y1); if (B.top) shift(d, 'top', 0, b.h * 0.45); } },
  { name: 'Noodle legs', ok: (B) => has(B, 'legs'), run: (d, B) => scale(d, 'legs', 0.8, 1.9, B.legs.cx, B.legs.y0) },
  { name: 'Stubby legs', ok: (B) => has(B, 'legs') && B.legs.h > 30, run: (d, B) => scale(d, 'legs', 1.3, 0.45, B.legs.cx, B.legs.y0) },
  { name: 'Long boi', ok: (B) => has(B, 'body'), run: (d, B) => {
    const b = B.body, grow = b.w * 0.35;
    scale(d, 'body', 1.7, 1, b.cx, b.cy);
    shift(d, 'head', grow, 0); shift(d, 'top', grow, 0); shift(d, 'tail', -grow, 0);
  } },
  { name: 'Tall boi', ok: (B) => has(B, 'body'), run: (d, B) => {
    const b = B.body, grow = b.h * 0.6;
    scale(d, 'body', 0.9, 1.6, b.cx, b.y1);
    shift(d, 'head', 0, -grow); shift(d, 'top', 0, -grow); shift(d, 'limbs', 0, -grow * 0.6); shift(d, 'wings', 0, -grow * 0.7);
  } },
  { name: 'Absolute unit', ok: (B) => has(B, 'body'), run: (d, B) => { const b = B.body; scale(d, 'body', 1.4, 1.4, b.cx, b.cy); } },
  { name: 'Double header', ok: (B) => has(B, 'head'), run: (d, B) => {
    const b = B.head, dx = -b.w * 0.55, dy = -b.h * 0.5;
    for (const id of ['head', 'top']) redraw(d, id, (x, src) => { x.drawImage(src, 0, 0); x.drawImage(src, dx, dy); });
  } },
  { name: 'Melted', ok: () => true, run: (d, B, r) => {
    const ph = r() * 6.28, ph2 = r() * 6.28;
    for (const id of LAYERS) {
      if (!B[id]) continue;
      // droop every column by a wobbly amount: the clay sagged in the sun
      redraw(d, id, (x, src) => {
        for (let px = 0; px < PAINT; px += 3) {
          const k = Math.sin(px * 0.045 + ph) * 0.5 + 0.5, drip = Math.max(0, Math.sin(px * 0.11 + ph2)) ** 6;
          x.drawImage(src, px, 0, 3, PAINT, px, 4 + k * 14 + drip * 26, 3, PAINT);
        }
        x.drawImage(src, 0, 0);
      });
    }
  } },
  { name: 'Overinflated', ok: () => true, run: (d, B, r) => {
    const ids = LAYERS.filter((id) => B[id]);
    const id = ids[(r() * ids.length) | 0];
    d.thick[id] = 1.9;
  } },
  { name: 'Wrong number of eyes', ok: () => true, run: (d, B, r) => { d.eyes = r() < 0.5 ? 'tri' : 'cyclops'; d.eyeSize = 1.4 + r() * 0.6; } },
  { name: 'Colors got mixed up', ok: () => true, run: (d, B, r) => {
    [d.color, d.color2] = [d.color2, d.color];
    d.pattern = ['lava', 'stars', 'stripes', 'spots', 'patches'][(r() * 5) | 0];
  } },
];

// apply one curse (sometimes two). Returns the names, for the toast.
export function curse(design, r = Math.random) {
  const B = Object.fromEntries(LAYERS.map((id) => [id, bounds(design.layers[id])]));
  const opts = CURSES.filter((c) => c.ok(B));
  const n = r() < 0.3 ? 2 : 1, names = [];
  for (let i = 0; i < n && opts.length; i++) {
    const c = opts.splice((r() * opts.length) | 0, 1)[0];
    c.run(design, i ? Object.fromEntries(LAYERS.map((id) => [id, bounds(design.layers[id])])) : B, r);
    names.push(c.name);
  }
  return names;
}
