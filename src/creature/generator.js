// Procedural creature doodler — draws into the same layers a player would.
import { newDesign, paintShape, bump } from './design.js';
import { PATTERNS } from '../fx/clay.js';

export function rng(seed) {
  // mulberry32 with a scrambled seed so nearby seeds diverge immediately
  let s = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PALETTES = [
  ['#ef7d57', '#ffd36e'], ['#5fb3a1', '#f4e3b1'], ['#7d6bd6', '#ffb3d1'], ['#e85d75', '#ffe1a8'],
  ['#4f8fd6', '#bde4ff'], ['#9bc53d', '#f7f1a0'], ['#f29e4c', '#6b3f2a'], ['#2f3e5c', '#ffd166'],
  ['#d96aa7', '#7ad3e8'], ['#c0d6df', '#4a6fa5'], ['#8c5e3c', '#f2d0a9'], ['#ff6f59', '#254441'],
  ['#3d348b', '#f7b801'], ['#43aa8b', '#f9c74f'], ['#ffadad', '#9b5de5'], ['#1b998b', '#e84855'],
];

const SYL_A = ['Bo', 'Gru', 'Mi', 'Zo', 'Pa', 'Ki', 'Mur', 'Fli', 'Bar', 'Lu', 'Qua', 'Spo', 'Ta', 'Wum', 'Ny', 'Glo', 'Dru', 'Pip', 'Snu', 'Ra'];
const SYL_B = ['bbo', 'mple', 'nk', 'zz', 'lop', 'roo', 'dle', 'mo', 'ggs', 'xby', 'tch', 'nu', 'fle', 'rk', 'ppy', 'mba', 'go', 'shi', 'loo', 'th'];
export function randomName(r) { return SYL_A[(r() * SYL_A.length) | 0] + SYL_B[(r() * SYL_B.length) | 0] + (r() < 0.2 ? SYL_B[(r() * SYL_B.length) | 0] : ''); }

const pick = (r, a) => a[(r() * a.length) | 0];
const rr = (r, a, b) => a + (b - a) * r();

// wobbly organic blob (polygon) around a center
function blob(r, cx, cy, rx, ry, wob = 0.12) {
  const pts = [], n = 28, k1 = rr(r, 0, 6.28), k2 = rr(r, 0, 6.28), f1 = 2 + ((r() * 2) | 0), f2 = 3 + ((r() * 3) | 0);
  const pear = rr(r, -0.25, 0.25);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + wob * Math.sin(a * f1 + k1) * 0.6 + wob * 0.4 * Math.sin(a * f2 + k2);
    const p = 1 + pear * Math.sin(a) * -1; // wider at the bottom when pear>0
    pts.push([cx + Math.cos(a) * rx * w * p, cy + Math.sin(a) * ry * w]);
  }
  return ['poly', pts];
}

export function randomDesign(seed = (Math.random() * 1e9) | 0, opts = {}) {
  const r = rng(seed);
  const frame = opts.frame || pick(r, ['biped', 'biped', 'quad', 'quad', 'hopper', 'serpent', 'flyer', 'crawler', 'roller']);
  const d = newDesign(frame);
  const ctx = (id) => d.layers[id].getContext('2d');
  const paint = (id, sh) => { paintShape(ctx(id), sh); bump(d, id); };

  let bodyTop, bodyFront, bodyBack, bodyBottom, headX, headY, headR;
  if (frame === 'biped') {
    const rx = rr(r, 0.26, 0.44), ry = rr(r, 0.32, 0.5), cy = rr(r, 0.82, 1.0);
    paint('body', blob(r, 0, cy, rx, ry, 0.1));
    bodyTop = cy + ry; bodyFront = rx; bodyBack = -rx; bodyBottom = cy - ry;
    const legH = bodyBottom + 0.12, legR = rr(r, 0.07, 0.13), foot = rr(r, 0.1, 0.18);
    paint('legs', ['capsule', -0.02, legH, rr(r, -0.04, 0.06), 0.07, legR, legR * rr(r, 0.8, 1.1)]);
    paint('legs', ['ellipse', 0.05, 0.06, foot, 0.06]);
    const sy = cy + ry * rr(r, 0.2, 0.55), ang = rr(r, -1.2, -0.2), L = rr(r, 0.3, 0.5);
    paint('limbs', ['capsule', rx * 0.4, sy, rx * 0.4 + Math.cos(ang) * L + 0.1, sy + Math.sin(ang) * L, rr(r, 0.05, 0.09), rr(r, 0.06, 0.1)]);
  } else if (frame === 'quad') {
    const rx = rr(r, 0.4, 0.62), ry = rr(r, 0.2, 0.32), cy = rr(r, 0.65, 0.9);
    paint('body', blob(r, 0, cy, rx, ry, 0.1));
    bodyTop = cy + ry; bodyFront = rx; bodyBack = -rx; bodyBottom = cy - ry;
    const legR = rr(r, 0.07, 0.12), bend = rr(r, -0.06, 0.06);
    paint('legs', ['path', [[-rx * 0.6, cy - ry * 0.3], [-rx * 0.62 + bend, (cy - ry) * 0.5], [-rx * 0.58, 0.06]], legR * 1.2, legR * 0.85]);
    paint('limbs', ['path', [[rx * 0.6, cy - ry * 0.3], [rx * 0.62 - bend, (cy - ry) * 0.5], [rx * 0.64, 0.06]], legR * 1.1, legR * 0.85]);
  } else if (frame === 'serpent') {
    const y0 = rr(r, 0.28, 0.38), w = rr(r, 0.14, 0.22), amp = rr(r, 0.04, 0.12), L = rr(r, 0.45, 0.65);
    paint('body', ['path', [[-L, y0], [-L * 0.4, y0 + amp], [L * 0.2, y0 - amp * 0.6], [L * 0.75, y0 + amp * 0.6]], w, w * 0.9]);
    bodyTop = y0 + w + amp; bodyFront = L * 0.75; bodyBack = -L; bodyBottom = y0 - w;
    if (r() < 0.7) paint('legs', ['ellipse', 0.0, y0 - w * 0.8, 0.11, 0.05, -0.4]);
    if (r() < 0.4) paint('limbs', ['capsule', L * 0.75 + 0.3, y0 + 0.2, L * 0.75 + 0.45, y0 + 0.05, 0.022]);
  } else if (frame === 'flyer') {
    const rx = rr(r, 0.24, 0.36), ry = rr(r, 0.28, 0.4), cy = rr(r, 0.75, 0.95);
    paint('body', blob(r, 0, cy, rx, ry, 0.08));
    bodyTop = cy + ry; bodyFront = rx; bodyBack = -rx; bodyBottom = cy - ry;
    paint('legs', ['capsule', 0.0, bodyBottom + 0.1, 0.03, 0.06, 0.045, 0.04]);
    paint('legs', ['ellipse', 0.08, 0.05, 0.1, 0.04]);
    opts = { ...opts, wings: true };
  } else if (frame === 'crawler') {
    const rx = rr(r, 0.4, 0.55), ry = rr(r, 0.14, 0.22), cy = rr(r, 0.36, 0.48);
    paint('body', blob(r, -0.08, cy, rx, ry, 0.12));
    bodyTop = cy + ry; bodyFront = rx - 0.08; bodyBack = -rx - 0.08; bodyBottom = cy - ry;
    const lw = rr(r, 0.03, 0.05);
    for (const x0 of [-0.35, -0.12]) paint('legs', ['path', [[x0, cy - 0.04], [x0 - 0.12, cy + 0.1], [x0 - 0.2, 0.04]], lw, lw * 0.8]);
    paint('limbs', ['path', [[0.15, cy - 0.04], [0.28, cy + 0.12], [0.38, 0.04]], lw, lw * 0.8]);
  } else if (frame === 'roller') {
    const R = rr(r, 0.4, 0.58), cy = R + 0.06;
    paint('body', blob(r, 0, cy, R, R, 0.04));
    bodyTop = cy + R; bodyFront = R; bodyBack = -R; bodyBottom = cy - R;
    if (r() < 0.6) paint('legs', ['ellipse', 0.05, 0.05, rr(r, 0.1, 0.16), 0.05]);
    if (r() < 0.5) paint('limbs', ['ellipse', R * 0.85, cy - R * 0.1, 0.1, 0.07]);
  } else {
    const R = rr(r, 0.32, 0.5), cy = R + rr(r, 0.12, 0.2);
    paint('body', blob(r, 0, cy, R * rr(r, 0.95, 1.15), R, 0.08));
    bodyTop = cy + R; bodyFront = R; bodyBack = -R; bodyBottom = cy - R;
    paint('legs', ['ellipse', 0.05, 0.08, rr(r, 0.16, 0.28), rr(r, 0.06, 0.09)]);
    paint('legs', ['capsule', -0.05, bodyBottom + 0.12, 0.0, 0.1, 0.08]);
    if (r() < 0.7) paint('limbs', ['capsule', R * 0.6, cy + R * 0.1, R * 0.6 + 0.25, cy - 0.12, 0.05, 0.07]);
  }
  // head
  const neck = r() < 0.4;
  headR = rr(r, 0.21, 0.34);
  if (frame === 'quad') { headX = bodyFront + headR * (neck ? 0.5 : 0.1); headY = bodyTop + (neck ? 0.15 : -0.05); }
  else if (frame === 'serpent') { headR = rr(r, 0.18, 0.26); headX = bodyFront + headR * 0.6; headY = bodyTop - headR * 0.2; }
  else if (frame === 'crawler') { headR = rr(r, 0.14, 0.22); headX = bodyFront + headR * 0.5; headY = bodyTop - headR * 0.6; }
  else if (frame === 'roller') { headR = rr(r, 0.16, 0.22); headX = bodyFront * 0.45; headY = bodyTop - headR * 1.2; }
  else if (frame === 'hopper') { headX = bodyFront * 0.35; headY = bodyTop - headR * (r() < 0.5 ? 0.3 : 1.0); }
  else { headX = bodyFront * rr(r, 0.1, 0.6); headY = bodyTop + headR * (neck ? 0.9 : 0.45); }
  if ((frame !== 'hopper' && frame !== 'roller') || r() < 0.5) {
    paint('head', blob(r, headX, headY, headR * rr(r, 1.0, 1.3), headR, 0.08));
    if (neck) paint('head', ['capsule', headX - headR * 0.4, headY - headR * 0.5, headX - headR * 0.9, headY - headR * 1.6, headR * 0.45]);
    if (r() < 0.5) paint('head', ['ellipse', headX + headR * 0.95, headY - headR * 0.25, headR * 0.45, headR * 0.35]); // snout
  } else { headX = bodyFront * 0.4; headY = bodyTop - 0.2; }

  // tail
  if (frame === 'serpent') {
    const ty = (bodyTop + bodyBottom) / 2;
    paint('tail', ['path', [[bodyBack + 0.1, ty], [bodyBack - 0.15, ty - 0.08], [bodyBack - 0.3, ty + 0.06]], (bodyTop - bodyBottom) * 0.35, 0.03]);
    if (r() < 0.5) paint('tail', ['fan', bodyBack - 0.25, ty + 0.05, bodyBack - 0.42, ty + 0.25, 0.08]);
  } else if (opts.tail ?? r() < (frame === 'hopper' || frame === 'roller' ? 0.3 : 0.75)) {
    const ty = bodyBottom + (bodyTop - bodyBottom) * rr(r, 0.2, 0.55), tr = rr(r, 0.06, 0.13);
    const curl = rr(r, -0.4, 0.5), L = rr(r, 0.35, 0.7);
    paint('tail', ['path', [[bodyBack * 0.6, ty], [bodyBack - L * 0.5, ty + curl * 0.3], [bodyBack - L, ty + curl * 0.7]], tr, tr * 0.25]);
    if (r() < 0.3) paint('tail', ['ellipse', bodyBack - L, ty + curl * 0.7, tr * 1.6, tr]); // tail tuft/fin
  }
  // wings
  if (opts.wings ?? r() < (frame === 'serpent' ? 0.15 : 0.35)) {
    const wx = bodyBack * 0.15, wy = bodyTop - 0.08, span = frame === 'flyer' ? rr(r, 0.7, 1.0) : rr(r, 0.45, 0.8);
    paint('wings', ['fan', wx, wy, wx - span * 0.75, wy + span * 0.7, rr(r, 0.12, 0.25)]);
  }
  // horns/ears/crest
  const topKind = pick(r, ['none', 'horns', 'ears', 'crest', 'antenna', 'tuft']);
  const hx = headX, hy = headY + headR * 0.85;
  if (topKind === 'horns') { paint('top', ['path', [[hx - 0.05, hy - 0.05], [hx - 0.1, hy + 0.12], [hx - 0.2, hy + 0.2]], 0.05, 0.015]); }
  else if (topKind === 'ears') { paint('top', ['ellipse', hx - headR * 0.3, hy + 0.06, 0.07, 0.14, -0.3]); }
  else if (topKind === 'crest') { for (let i = 0; i < 3; i++) paint('top', ['tri', hx - 0.08 - i * 0.1, hy - 0.04 - i * 0.05, hx - 0.03 - i * 0.1, hy + 0.12 - i * 0.04, hx + 0.04 - i * 0.1, hy - 0.04 - i * 0.05]); }
  else if (topKind === 'antenna') { paint('top', ['path', [[hx, hy - 0.05], [hx + 0.05, hy + 0.18], [hx + 0.12, hy + 0.25]], 0.02, 0.02]); paint('top', ['ellipse', hx + 0.13, hy + 0.27, 0.05, 0.05]); }
  else if (topKind === 'tuft') { paint('top', blob(r, hx - 0.03, hy + 0.02, 0.11, 0.07, 0.3)); }

  // thickness personality
  d.thick.body = rr(r, 0.85, 1.15);
  d.thick.head = rr(r, 0.85, 1.1);

  const pal = opts.palette != null ? PALETTES[opts.palette % PALETTES.length] : pick(r, PALETTES);
  d.color = pal[0]; d.color2 = pal[1];
  d.pattern = pick(r, ['solid', 'spots', 'spots', 'stripes', 'patches', 'belly', 'belly', 'speckle', 'gradient', 'lava', 'stars']);
  d.finish = pick(r, ['clay', 'clay', 'clay', 'felt', 'vinyl', 'jelly']);
  d.eyes = pick(r, ['googly', 'googly', 'googly', 'dot', 'sleepy', 'angry', 'cyclops', 'tri']);
  d.eyeSize = rr(r, 0.8, 1.35);
  d.mouth = pick(r, ['smile', 'smile', 'fangs', 'o', 'none']);
  for (const k of ['pattern', 'finish', 'eyes', 'eyeSize', 'mouth', 'voice']) if (opts[k] != null) d[k] = opts[k];
  d.name = randomName(r);
  d.seed = seed;
  // voice from its own stream so it doesn't reshuffle every existing seeded monster
  if (!opts.voice) d.voice = ['chirpy', 'chirpy', 'squeaky', 'gruff', 'robot', 'warbly', 'whisper'][rng(seed + 7)() * 7 | 0];
  return d;
}

export { PATTERNS };
