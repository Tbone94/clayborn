// Stats come from the actual shape you drew — no hidden tables.
import { CELL, GRID, cellCenter } from './field.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const to10 = (v) => Math.round((1 + 9 * clamp01(v)) * 10) / 10;

export const STAT_INFO = {
  speed: { label: 'Speed', icon: '速', tip: 'Longer legs and a lighter body run faster' },
  power: { label: 'Power', icon: '力', tip: 'More clay = harder shoves' },
  balance: { label: 'Balance', icon: '均', tip: 'Wide feet and a low belly keep you standing' },
  glide: { label: 'Glide', icon: '翔', tip: 'Big wings on a light body glide furthest' },
  swim: { label: 'Swim', icon: '泳', tip: 'A big tail and a long body swim fastest' },
};

export function computeStats(A) {
  if (A.empty) return { speed: 1, power: 1, balance: 1, glide: 1, swim: 1, raw: null, phys: physics(null, 'biped') };
  const gait = A.frame.gait;
  let vol = 0, comY = 0, ground = 1e9, top = -1e9, minX = 1e9, maxX = -1e9;
  const vols = {};
  for (const it of A.inst) {
    const f = it.f;
    let v = 0, cy = 0;
    for (let i = 0; i < GRID * GRID; i++) {
      if (!f.inside[i]) continue;
      const dv = 2 * f.h[i] * it.t * CELL * CELL;
      v += dv; cy += dv * cellCenter(i)[1];
    }
    vol += v; comY += cy;
    vols[it.id] = (vols[it.id] || 0) + v;
    ground = Math.min(ground, f.bbox[1]); top = Math.max(top, f.bbox[3]);
    minX = Math.min(minX, f.bbox[0]); maxX = Math.max(maxX, f.bbox[2]);
  }
  comY /= vol || 1;
  const kindOf = (it) => A.bones[it.bone].kind;
  const legs = A.inst.filter((it) => kindOf(it) === 'leg');
  let legLen = 0, fx0 = 1e9, fx1 = -1e9, fz = 0;
  for (const it of legs) {
    const b = A.bones[it.bone];
    legLen += Math.max(0, b.pos[1] - it.f.bbox[1]);
    fx0 = Math.min(fx0, it.f.bbox[0]); fx1 = Math.max(fx1, it.f.bbox[2]);
    fz = Math.max(fz, Math.abs(it.zc) + it.hm);
  }
  legLen = legs.length ? legLen / legs.length : 0;
  const root = A.inst[0];
  let footX = legs.length ? fx1 - fx0 : (root.f.bbox[2] - root.f.bbox[0]) * 0.55;
  let footZ = legs.length ? fz * 2 : root.hm * 1.1;
  const comH = Math.max(0.08, comY - ground);
  const mass = vol / 0.4; // ~1 for a typical critter
  const wingArea = A.F.wings.empty ? 0 : A.F.wings.area * 2;
  const tailArea = A.F.tail.empty ? 0 : A.F.tail.area;
  const length = maxX - minX;
  const armVol = vols.limbs || 0;

  const legEff = gait === 'quad' ? 1.15 : gait === 'hop' ? 1.9 : gait === 'skitter' ? 1.1 : 1;
  let speed = (legLen * legEff * (legs.length ? 1 : 0.4)) / Math.pow(mass, 0.28);
  if (gait === 'slither') speed = (length * 0.27) / Math.pow(mass, 0.25);
  if (gait === 'roll') speed = ((top - ground) * 0.38 + 0.06) / Math.pow(mass, 0.15);
  const power = Math.pow(mass, 0.8) + (gait !== 'quad' ? armVol * 4 : 0);
  let balance = ((footX * 0.65 + footZ * 0.5) / comH) * (legs.length >= 4 ? 1.15 : 1);
  if (gait === 'skitter') balance *= 1.15;
  if (gait === 'slither') balance = Math.min(1.4, (length * 0.22) / comH);
  const glide = wingArea / Math.pow(Math.max(mass, 0.2), 0.55);
  const finArea = A.inst.filter((it) => kindOf(it) === 'fin').reduce((a, it) => a + it.f.area, 0);
  const swim = tailArea * 5 + length * 0.18 + finArea * 3 + (A.F.wings.empty ? 0 : wingArea * 0.5) + (gait === 'slither' ? 0.15 : 0);

  const s = {
    speed: to10((speed - 0.15) / 0.75),
    power: to10((power - 0.45) / 1.25),
    balance: to10((balance - 0.35) / 1.5),
    glide: wingArea > 0 ? to10((glide - 0.03) / 0.45) : 1,
    swim: to10((swim - 0.22) / 0.8),
  };
  s.raw = { vol, mass, legLen, footX, footZ, comH, wingArea, tailArea, length, height: top - ground };
  s.phys = physics(s, gait);
  return s;
}

// what the numbers actually do in the world
export function physics(s, gait) {
  if (!s) return { maxSpeed: 3, accel: 8, jump: 6, mass: 1, glide: 0, swim: 1.2, radius: 0.4, stability: 1, gait, airJumps: 0, dashMult: 1 };
  const r = s.raw;
  return {
    gait,
    airJumps: gait === 'flap' ? (r.wingArea > 0.05 ? 2 : 1) : 0,
    dashMult: gait === 'roll' ? 1.45 : 1,
    maxSpeed: 3.2 + s.speed * 0.78 + (gait === 'roll' ? 0.8 : 0),
    accel: 7 + s.power * 0.6 + s.speed * 0.4 + (gait === 'skitter' ? 3 : 0),
    jump: 6.2 + (gait === 'hop' ? 2.6 : 0) + (gait === 'slither' ? -1.2 : 0) + r.legLen * 2.2,
    mass: Math.max(0.35, r.mass),
    glide: s.glide > 1 ? s.glide / 10 : 0,
    swim: 1.0 + s.swim * 0.5 + (gait === 'slither' ? 1.5 : 0),
    radius: Math.max(0.25, Math.min(0.75, Math.max(r.length, r.footZ) * 0.42)),
    stability: 0.4 + s.balance * 0.12,
    height: r.height,
  };
}
