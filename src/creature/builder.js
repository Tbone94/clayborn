// Drawing → analysed parts → one blended clay SkinnedMesh with auto-placed joints.
import * as THREE from 'three';
import { buildPartField, sample, sampleS, CELL, GRID, cellCenter } from './field.js';
import { coverageOf } from './design.js';
import { FRAMES, LAYERS } from './frames.js';
import { polygonize, taubin } from './mesher.js';

const cache = new WeakMap();
export function partFields(design) {
  let c = cache.get(design); if (!c) cache.set(design, c = {});
  const out = {};
  for (const id of LAYERS) {
    const v = design.version[id];
    if (!c[id] || c[id].v !== v) c[id] = { v, f: buildPartField(coverageOf(design.layers[id])) };
    out[id] = c[id].f;
  }
  return out;
}

const BLEND = 0.075; // clay merge radius

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function hMax(f) { let m = 0; for (let i = 0; i < f.h.length; i++) if (f.h[i] > m) m = f.h[i]; return m; }

function gradS(f, x, y) {
  const e = CELL;
  return [(sampleS(f, x + e, y) - sampleS(f, x - e, y)) / (2 * e), (sampleS(f, x, y + e) - sampleS(f, x, y - e)) / (2 * e)];
}

// ---------- analysis: parts, joints, mirror placement ----------
export function analyze(design) {
  const frame = FRAMES[design.frame];
  const F = partFields(design);
  const rootId = !F.body.empty ? 'body' : (!F.head.empty ? 'head' : null);
  if (!rootId) return { empty: true, F, frame };
  const thickOf = (id) => frame.layers[id].thick * design.thick[id];

  const bones = [], inst = [], bridges = [];
  const rf = F[rootId];
  bones.push({ layer: rootId, kind: 'root', pos: [rf.centroid[0], rf.centroid[1], 0], parent: -1, side: 0 });
  const addInst = (id, zc, bone) => {
    const f = F[id], t = thickOf(id), hm = hMax(f) * t;
    inst.push({ id, f, t, zc, bone, hm, box: [f.bbox[0], f.bbox[1], zc - hm, f.bbox[2], f.bbox[3], zc + hm] });
  };
  addInst(rootId, 0, 0);
  const boneOf = { [rootId]: 0 };

  for (const id of ['head', 'legs', 'limbs', 'tail', 'wings', 'top']) {
    if (id === rootId || F[id].empty) continue;
    const def = frame.layers[id];
    const attachId = (id === 'top' && !F.head.empty) ? 'head' : rootId;
    const att = F[attachId], pf = F[id];
    // joint = where the part overlaps what it attaches to; otherwise build a bridge
    let ox = 0, oy = 0, on = 0, best = { s: 1e9, x: 0, y: 0 };
    for (let i = 0; i < GRID * GRID; i++) {
      if (!pf.inside[i]) continue;
      const [x, y] = cellCenter(i);
      const s = sampleS(att, x, y);
      if (s < CELL * 1.5) { ox += x; oy += y; on++; }
      if (s < best.s) best = { s, x, y };
    }
    let pivot, bridge = null;
    if (on >= 4) pivot = [ox / on, oy / on];
    else {
      const [gx, gy] = gradS(att, best.x, best.y);
      const gl = Math.hypot(gx, gy) || 1;
      const d = best.s + CELL * 2.5;
      pivot = [best.x - (gx / gl) * d, best.y - (gy / gl) * d];
      const r = Math.max(0.035, Math.min(0.09, sample(pf.h, best.x, best.y, 0.05) * thickOf(id) * 0.8));
      bridge = { a: [best.x, best.y], b: pivot, r };
    }
    const parentBone = boneOf[attachId] ?? 0;
    const sides = def.mirror ? [1, -1] : [0];
    let zc = 0;
    if (def.mirror) {
      const hb = sample(att.h, pivot[0], pivot[1], 0) * thickOf(attachId);
      zc = def.kind === 'wing' ? Math.max(0.05, hb * 0.8) : Math.max(0.07, hb * 0.6);
    }
    for (const side of sides) {
      const z = side * zc;
      bones.push({ layer: id, kind: def.kind, pos: [pivot[0], pivot[1], z], parent: parentBone, side, phase: def.phase || 0 });
      const b = bones.length - 1;
      if (sides.length === 1) boneOf[id] = b;
      addInst(id, z, b);
      if (bridge) bridges.push({ a: [bridge.a[0], bridge.a[1], z], b: [bridge.b[0], bridge.b[1], z * 0.4], r: bridge.r, bone: b });
    }
  }
  return { empty: false, F, frame, rootId, bones, inst, bridges, thickOf };
}

function instField(it, x, y, z) {
  const f = it.f;
  const s = sampleS(f, x, y);
  const dz = Math.abs(z - it.zc);
  if (s < 0) return Math.max(dz - sample(f.h, x, y, 0) * it.t, s);
  return Math.sqrt(s * s + dz * dz);
}

function capsule(b, x, y, z) {
  const [ax, ay, az] = b.a, [bx, by, bz] = b.b;
  const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz || 1)));
  return Math.hypot(px - dx * t, py - dy * t, pz - dz * t) - b.r;
}

export function fieldAt(A, x, y, z) {
  let v = 1e9;
  const m = BLEND + 0.05;
  for (const it of A.inst) {
    const b = it.box;
    if (x < b[0] - m || x > b[3] + m || y < b[1] - m || y > b[4] + m || z < b[2] - m || z > b[5] + m) continue;
    v = smin(v, instField(it, x, y, z), BLEND);
  }
  for (const br of A.bridges) v = smin(v, capsule(br, x, y, z), BLEND);
  return v;
}

function gradField(A, x, y, z) {
  const e = 0.01;
  const g = [
    fieldAt(A, x + e, y, z) - fieldAt(A, x - e, y, z),
    fieldAt(A, x, y + e, z) - fieldAt(A, x, y - e, z),
    fieldAt(A, x, y, z + e) - fieldAt(A, x, y, z - e)];
  const l = Math.hypot(...g) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

// march from inside along dir until the surface
function surfacePoint(A, o, d) {
  let t = 0, prev = fieldAt(A, ...o);
  if (prev > 0) return null;
  for (let i = 0; i < 200; i++) {
    t += 0.008;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const v = fieldAt(A, ...p);
    if (v > 0) {
      let lo = t - 0.008, hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (fieldAt(A, o[0] + d[0] * mid, o[1] + d[1] * mid, o[2] + d[2] * mid) > 0) hi = mid; else lo = mid;
      }
      const q = [o[0] + d[0] * lo, o[1] + d[1] * lo, o[2] + d[2] * lo];
      return { p: q, n: gradField(A, ...q) };
    }
  }
  return null;
}

// ---------- mesh ----------
export function buildGeometry(A, detail = 64) {
  const box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const it of A.inst) for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], it.box[k]); box[k + 3] = Math.max(box[k + 3], it.box[k + 3]); }
  for (const br of A.bridges) for (const p of [br.a, br.b]) for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], p[k] - br.r); box[k + 3] = Math.max(box[k + 3], p[k] + br.r); }
  const pad = BLEND + 0.06;
  for (let k = 0; k < 3; k++) { box[k] -= pad; box[k + 3] += pad; }
  const size = [box[3] - box[0], box[4] - box[1], box[5] - box[2]];
  let step = Math.max(...size) / detail;
  while ((size[0] / step + 2) * (size[1] / step + 2) * (size[2] / step + 2) > 320000) step *= 1.08;
  const nx = Math.ceil(size[0] / step) + 2, ny = Math.ceil(size[1] / step) + 2, nz = Math.ceil(size[2] / step) + 2;
  const field = new Float32Array(nx * ny * nz);
  const o = [box[0], box[1], box[2]];
  for (let z = 0; z < nz; z++) {
    const wz = o[2] + z * step;
    for (let y = 0; y < ny; y++) {
      const wy = o[1] + y * step;
      for (let x = 0; x < nx; x++) field[x + nx * (y + ny * z)] = fieldAt(A, o[0] + x * step, wy, wz);
    }
  }
  const { positions, indices } = polygonize(field, nx, ny, nz, o, step);
  taubin(positions, indices, 3);

  // skin weights from per-part proximity — soft at the joints, for free
  const nv = positions.length / 3;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4);
  const nb = A.bones.length, fb = new Float32Array(nb);
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    fb.fill(1e9);
    for (const it of A.inst) fb[it.bone] = Math.min(fb[it.bone], instField(it, x, y, z));
    for (const br of A.bridges) fb[br.bone] = Math.min(fb[br.bone], capsule(br, x, y, z) + 0.01);
    let fmin = 1e9; for (let b = 0; b < nb; b++) fmin = Math.min(fmin, fb[b]);
    const w = []; for (let b = 0; b < nb; b++) { const d = fb[b] - fmin; if (d < 0.12) w.push([b, Math.exp(-d / 0.028)]); }
    w.sort((p, q) => q[1] - p[1]);
    let sum = 0; for (let k = 0; k < Math.min(4, w.length); k++) sum += w[k][1];
    for (let k = 0; k < 4; k++) {
      if (k < w.length) { skinIndex[v * 4 + k] = w[k][0]; skinWeight[v * 4 + k] = w[k][1] / sum; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// ---------- face: eyes & mouth placement ----------
export function facePlacement(A, design) {
  const hf = !A.F.head.empty ? A.F.head : A.F[A.rootId];
  const faceLayer = !A.F.head.empty ? 'head' : A.rootId;
  const hm = hMax(hf);
  let best = -1e9, bx = 0, by = 0;
  for (let i = 0; i < GRID * GRID; i++) {
    if (!hf.inside[i] || hf.h[i] < hm * 0.55) continue;
    const [x, y] = cellCenter(i);
    const sc = x + 0.45 * y;
    if (sc > best) { best = sc; bx = x; by = y; }
  }
  const headScale = Math.max(0.6, Math.min(1.6, Math.sqrt(hf.area) / 0.42));
  const r = 0.085 * design.eyeSize * headScale;
  const eyes = [];
  const style = design.eyes;
  const dirs = style === 'cyclops' ? [[1, 0.12, 0]]
    : style === 'tri' ? [[0.7, 0.25, 0.55], [0.7, 0.25, -0.55], [1, 0.55, 0]]
    : [[0.62, 0.12, 0.78], [0.62, 0.12, -0.78]];
  for (const d0 of dirs) {
    const l = Math.hypot(...d0), d = d0.map((v) => v / l);
    const hit = surfacePoint(A, [bx - 0.05, by - 0.02, 0], d);
    if (hit) eyes.push({ p: hit.p, n: hit.n, r: style === 'cyclops' ? r * 1.6 : style === 'tri' ? r * 0.8 : r });
  }
  let mouth = null;
  const mh = surfacePoint(A, [bx - 0.1, by - 0.13 * headScale, 0], [1, -0.15, 0].map((v) => v / Math.hypot(1, 0.15)));
  if (mh) mouth = { p: mh.p, n: mh.n, w: 0.07 * headScale };
  const bone = A.bones.findIndex((b) => b.layer === faceLayer);
  return { eyes, mouth, bone: Math.max(0, bone), headScale };
}
