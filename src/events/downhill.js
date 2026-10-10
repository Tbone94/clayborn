// Roly Rumble (転がり): a downhill race down a winding clay mountainside.
// Slopes pull everyone downhill; hold SHIFT / 突 (or keep holding jump) to TUCK into a ball:
// faster, but you steer like a bowling ball. Roly (roll gait) monsters were born for this.
import * as THREE from 'three';
import { EventBase } from './base.js';
import { terrainMesh, terrainMaterial, plantGrass, plantFlowers, plantTrees, placeRocks, grassHeight, modelSize, pbr, makeWater } from '../world/nature.js';
import { heightTexture } from '../scenes/common.js';
import { rng } from '../creature/generator.js';
import { smoothstep, fbm2 } from '../game/noise.js';
import { collide } from '../game/body.js';
import { sfx, babble } from '../fx/audio.js';

const $ = (id) => document.getElementById(id);

// ---------------- the course ----------------
// u ≈ distance down the course (the centerline is a gentle function of x), off = signed distance from the centerline.
const W = 7;                    // track half-width
const FINISH = 224;
const LIP = 154, CREEK = [154, 159.5];   // jump ramp lip and the creek gap behind it
const KICK = 7, KICK_H = 1.9;            // ramp kicker length / height
const MOGULS = [121, 140];
const CHECKPOINTS = [0, 42, 94, 121, 141, 162, 190, 214];
const PICKUPS = [[174, -3], [179, 2.6], [184, -0.6], [190, 3.4], [195, -2.6]];
const GRAV = 24;                // matches Body
const GS = 6.5;                 // how hard slopes pull (a gentler "g" so a run lasts ~20–30 s)
const BANK = 5;                 // banking: lateral slope = BANK × curvature

const U0 = -70, U1 = 300, DU = 0.1, N = Math.round((U1 - U0) / DU) + 1;
// downhill gradient knots [u, slope]
const SLOPE = [[-40, 0.35], [-16, 0.35], [-10, 0.07], [2, 0.07], [14, 0.24], [118, 0.24], [122, 0.2], [138, 0.2], [142, 0.34],
  [158, 0.34], [162, 0.21], [208, 0.21], [218, 0], [232, 0], [240, -0.14], [300, -0.14]];
// curvature bumps [start, end, κ]: a left-right-left S, then a sweeping S into the finish chute
const BENDS = [[16, 42, 0.045], [42, 94, -0.045], [94, 120, 0.045], [163, 188, -0.042], [188, 213, 0.042]];

function slopeAt(u) {
  for (let i = 0; i < SLOPE.length - 1; i++) if (u < SLOPE[i + 1][0]) return SLOPE[i][1] + (SLOPE[i + 1][1] - SLOPE[i][1]) * smoothstep(SLOPE[i][0], SLOPE[i + 1][0], u);
  return SLOPE[SLOPE.length - 1][1];
}
function kappaAt(u) {
  let k = 0;
  for (const [a, b, K] of BENDS) if (u > a && u < b) { const p = (u - a) / (b - a), q = p * (1 - p); k += K * 64 * q * q * q; }
  return k;
}
// integrate slope → height, curvature → heading → lateral offset
const TB = new Float32Array(N), TC = new Float32Array(N), TD = new Float32Array(N), TK = new Float32Array(N);
{
  let h = 0, d = 0, c = 0;
  for (let i = 0; i < N; i++) {
    const u = U0 + i * DU;
    TB[i] = h; TC[i] = c; TD[i] = d; TK[i] = kappaAt(u);
    h -= slopeAt(u + DU / 2) * DU;
    if (u >= 0) { d += kappaAt(u + DU / 2) * DU; c += (d - kappaAt(u + DU / 2) * DU / 2) * DU; }
  }
  const off = TB[Math.round((FINISH - U0) / DU)] - 8;   // the finish line sits 8 m above the sea
  for (let i = 0; i < N; i++) TB[i] -= off;
}
const look = (T, u) => {
  const f = Math.max(0, Math.min(N - 1.001, (u - U0) / DU)), i = f | 0, t = f - i;
  return T[i] + (T[i + 1] - T[i]) * t;
};
const baseH = (u) => look(TB, u);
const centerZ = (u) => look(TC, u);
const centerD = (u) => look(TD, u);
const LIP_BASE = baseH(LIP);
const CREEK_FLOOR = LIP_BASE - 7, CREEK_WATER = LIP_BASE - 5;

// nearest centerline point (two Gauss-Newton steps from u = x)
function proj(x, z) {
  let t = x;
  for (let k = 0; k < 3; k++) {
    const c = centerZ(t), d = centerD(t);
    t += Math.max(-20, Math.min(20, ((x - t) + d * (z - c)) / (1 + d * d)));
  }
  const c = centerZ(t), d = centerD(t), n = Math.hypot(1, d);
  return { u: t, off: ((z - c) - d * (x - t)) / n, fx: 1 / n, fz: d / n };
}
// world position of (u, off)
function at(u, off = 0) {
  const d = centerD(u), n = Math.hypot(1, d);
  return { x: u - (d / n) * off, z: centerZ(u) + off / n, fx: 1 / n, fz: d / n };
}

// the track surface itself (banked, bumpy, with a kicker and a creek)
function trackH(u, off) {
  let h = baseH(u) - BANK * look(TK, u) * off;
  if (u > MOGULS[0] && u < MOGULS[1]) {
    const env = smoothstep(MOGULS[0], MOGULS[0] + 3, u) * smoothstep(MOGULS[1], MOGULS[1] - 3, u);
    h += 0.32 * Math.sin((u - MOGULS[0]) * (Math.PI * 2 / 6.2) + Math.sin(off * 0.55) * 0.9) * env;
  }
  if (u > LIP - KICK && u <= LIP) { const k = (u - (LIP - KICK)) / KICK; h += KICK_H * k * k; }
  if (u >= CREEK[1] && u < CREEK[1] + 7) { const k = 1 - (u - CREEK[1]) / 7; h += 1.3 * k * k; }   // a steep landing ramp
  const a = Math.abs(off);
  h += 0.45 * smoothstep(W - 1.5, W - 0.2, a);   // a soft berm along both edges
  return h;
}

function downhillH(x, z) {
  const { u, off } = proj(x, z);
  const a = Math.abs(off);
  let h = trackH(u, off);
  if (a > W - 0.2) {
    // off the track the mountainside falls away
    const side = baseH(u) - 2.6 - Math.max(0, a - W - 3) * 0.42 + (fbm2(x * 0.06, z * 0.06) - 0.5) * 3 * smoothstep(W + 3, W + 10, a);
    h += (side - h) * smoothstep(W - 0.2, W + 3.2, a);
  }
  if (u > CREEK[0] && u < CREEK[1] && a < W + 2) h = CREEK_FLOOR;
  // the mountain ends in the sea on every side
  const e = Math.max(smoothstep(30, 66, a), smoothstep(-16, -40, u), smoothstep(238, 258, u));
  if (e > 0) h += (-7 + fbm2(x * 0.04, z * 0.04) * 3 - h) * e;
  return h;
}

// ---------------- the event ----------------
export class DownhillEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, { sky: ['#8fc6ea', '#ffe6c4'], rivalOpts: [{ frame: 'roller' }, { frame: 'flyer', wings: true }, {}] });
    this.height = downhillH;
    this.world.water = -100; // the creek is handled here (respawn), not by swimming
    this.track = { ...this.track, wipeouts: 0, tuck: 0, pickups: 0, creek: 0 };
    this.build();
    const lanes = [-4.5, -1.5, 1.5, 4.5];
    this.all.forEach((b, i) => {
      const p = at(-4, lanes[i]);
      b.x = p.x; b.z = p.z; b.y = downhillH(b.x, b.z); b.vx = b.vy = b.vz = 0;
      b.heading = Math.atan2(-p.fz, p.fx); b.grounded = true; b.done = null;
      b.dh = { u: -4, off: lanes[i], tuck: 0, spin: 0, tumble: 0, wipe: 0, gvy: 0, dustT: 0, lane: lanes[i], laneT: 2 + Math.random() * 3 };
      if (b.ai) b.ai.lane = lanes[i];
      b.sync();
    });
    this.hud(`<span class="pill" id="dh-pos">1st</span><span class="pill" id="dh-time">0.0s</span>`);
    this.injectCss();
    // the touch dash button only reports presses; track holding it ourselves
    this.dashHeld = false;
    const db = $('t-dash');
    this._dashDown = () => { this.dashHeld = true; };
    this._dashUp = () => { this.dashHeld = false; };
    if (db) { db.addEventListener('pointerdown', this._dashDown); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) db.addEventListener(ev, this._dashUp); }
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    this.tip = document.createElement('div');
    this.tip.className = 'dh-tip';
    this.tip.innerHTML = touch ? 'Hold <b>突</b> to tuck into a ball' : 'Hold <b>SHIFT</b> to tuck into a ball';
    document.body.appendChild(this.tip);
    this.tipShown = false;
  }

  injectCss() {
    if ($('downhill-css')) return;
    const st = document.createElement('style'); st.id = 'downhill-css';
    st.textContent = `
.dh-tip { position: fixed; left: 50%; top: calc(34% + clamp(96px, 15vw, 190px)); transform: translateX(-50%) skewX(-10deg); z-index: 6; pointer-events: none;
  background: var(--ink, #15172b); color: var(--yellow, #ffd23f); font: 400 clamp(15px, 2.4vw, 22px) var(--dot, monospace); padding: 6px 16px;
  box-shadow: 4px 4px 0 var(--red, #e63b2e); white-space: nowrap; opacity: 0; transition: opacity .3s; max-width: calc(100vw - 32px); }
.dh-tip b { color: #fbf8f0; font-weight: 400; }
.dh-tip.on { opacity: 1; }`;
    document.head.appendChild(st);
  }

  build() {
    const s = this.scene;
    const r = rng(31);
    const splat = (x, h, z, ny) => {
      const { off } = proj(x, z);
      const a = Math.abs(off);
      const sand = smoothstep(1.2, -0.4, h);
      const rock = smoothstep(0.8, 0.55, ny) * (1 - sand * 0.5);
      const path = smoothstep(W - 0.1, W - 1.3, a + (fbm2(x * 0.3, z * 0.3) - 0.5) * 0.8) * (1 - sand);
      const dirt = path * (1 - rock * 0.6);
      return [Math.max(0, 1 - sand - rock - dirt), dirt, sand, rock];
    };
    s.add(terrainMesh(downhillH, { size: [320, 150], seg: [500, 200], center: [100, 0], splatFn: splat, material: terrainMaterial({ path: 'rocky_trail' }) }));
    this.makeWater(downhillH, [-70, -170, 340]);

    // the creek in its trench
    {
      const xc = (CREEK[0] + CREEK[1]) / 2, zc = centerZ(xc), len = CREEK[1] - CREEK[0] + 1, wid = (W + 2) * 2;
      const hTex = heightTexture(downhillH, xc - 12, zc - 12, 24, 96);
      const wtr = makeWater(s, { size: 1, level: CREEK_WATER, hTex, hBox: [xc - 12, zc - 12, 24, 24], deep: '#1f5f8a', shallow: '#4fc6c0' });
      wtr.mesh.geometry.dispose();
      const g = new THREE.PlaneGeometry(len, wid); g.rotateX(-Math.PI / 2); g.translate(xc, 0, zc);
      wtr.mesh.geometry = g;
      this.creekWater = wtr;
    }

    // grass + flowers on the verges, trees and boulders down the mountainside
    const gH = grassHeight(), grass = [], flowers = [], trees = [], rocks = [];
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    for (let i = 0; i < 22000; i++) {
      const u = -14 + r() * (FINISH + 14), side = r() < 0.5 ? -1 : 1, off = side * (W - 0.6 + r() * 7);
      if (u > CREEK[0] - 1.5 && u < CREEK[1] + 1.5) continue;
      const p = at(u, off), h = downhillH(p.x, p.z);
      grass.push({ x: p.x, y: h - 0.03, z: p.z, s: (0.4 + r() * 0.35) / gH, ry: r() * 6.28, hue: r(), lum: r() });
      if (r() < 0.015) flowers.push({ x: p.x, y: h, z: p.z, s: (0.35 + r() * 0.2) / modelSize('flower_white').y, ry: r() * 6.28 });
    }
    plantGrass(s, grass); plantFlowers(s, flowers);
    for (let i = 0; i < 90; i++) {
      const u = -18 + r() * (FINISH + 26), off = (r() < 0.5 ? -1 : 1) * (W + 3.5 + r() * 16);
      if (u > CREEK[0] - 3 && u < CREEK[1] + 3) continue;
      const p = at(u, off);
      trees.push({ x: p.x, y: downhillH(p.x, p.z) - 0.25, z: p.z, h: 5 + r() * 5, ry: r() * 6.28, kind: (r() * 6) | 0 });
    }
    for (let i = 0; i < 46; i++) {
      const u = -6 + r() * (FINISH + 4), off = (r() < 0.5 ? -1 : 1) * (W + 0.8 + r() * 2.5);
      if (u > CREEK[0] - 2 && u < CREEK[1] + 2) continue;
      const p = at(u, off);
      rocks.push({ x: p.x, y: downhillH(p.x, p.z) - 0.25, z: p.z, s: (0.6 + r() * 1.1) / rs, sy: 0.75, ry: r() * 6.28 });
    }
    for (let i = 0; i < 24; i++) {   // big boulders further down the flanks
      const u = -10 + r() * (FINISH + 10), off = (r() < 0.5 ? -1 : 1) * (W + 12 + r() * 20);
      const p = at(u, off);
      rocks.push({ x: p.x, y: downhillH(p.x, p.z) - 1, z: p.z, s: (3 + r() * 4) / rs, sy: 0.6, ry: r() * 6.28 });
    }
    plantTrees(s, trees); placeRocks(s, rocks);

    // planks bridging nothing: two posts marking the creek jump
    const post = pbr('bark_brown_02', 1, 3);
    const flagMats = ['#e63b2e', '#ffd23f', '#15172b'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide }));
    for (const sd of [-1, 1]) {
      const p = at(LIP - 0.5, sd * (W + 0.6)), h0 = downhillH(p.x, p.z);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.6, 10), post); m.position.set(p.x, h0 + 1.2, p.z); m.castShadow = true; s.add(m);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), flagMats[0]); f.position.set(p.x + 0.45, h0 + 2.2, p.z); s.add(f);
    }

    // start gate + finish arch
    this.gate(0, 'START', false);
    this.gate(FINISH, 'FINISH', true);
    // checkered finish line on the ground
    {
      const p = at(FINISH), h0 = baseH(FINISH);
      const g = new THREE.PlaneGeometry(1.4, W * 2); g.rotateX(-Math.PI / 2);
      const line = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.checkerTex(2, 14), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
      line.position.set(p.x, h0 + 0.03, p.z); line.receiveShadow = true; s.add(line);
    }

    // the clay drop field: a few glowing pebbles that give a burst of speed
    const pebGeo = new THREE.IcosahedronGeometry(0.42, 1);
    const pebMat = new THREE.MeshStandardMaterial({ color: '#ff9f3f', emissive: '#ffd23f', emissiveIntensity: 0.9, roughness: 0.35 });
    const haloMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.35, depthWrite: false });
    this.pickups = PICKUPS.map(([u, off]) => {
      const p = at(u, off), h = trackH(u, off);
      const m = new THREE.Mesh(pebGeo, pebMat); m.castShadow = true;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 24), haloMat); halo.rotation.x = -Math.PI / 2; halo.position.y = -0.55;
      m.add(halo);
      m.position.set(p.x, h + 0.75, p.z); s.add(m);
      return { m, x: p.x, z: p.z, y: h + 0.75, off: 0, ph: r() * 6 };
    });
  }

  gate(u, text, finish) {
    const s = this.scene;
    const p = at(u), h0 = baseH(u);
    const ang = Math.atan2(-p.fz, p.fx);
    const g = new THREE.Group(); g.position.set(p.x, h0, p.z); g.rotation.y = ang; s.add(g);
    const ink = new THREE.MeshStandardMaterial({ color: '#15172b', roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: '#e63b2e', roughness: 0.55 });
    const yel = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.55 });
    const span = W + 0.6;
    if (finish) {
      // a big red arch with ink feet and yellow bands
      const arch = new THREE.Mesh(new THREE.TorusGeometry(span, 0.42, 14, 64, Math.PI), red);
      arch.rotation.y = Math.PI / 2; arch.position.y = 0.6; arch.scale.set(1, 0.95, 1); arch.castShadow = true; g.add(arch);
      for (const sd of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 1.2, 18), ink); foot.position.set(0, 0.5, sd * span); foot.castShadow = true; g.add(foot);
        for (const k of [0.32, 0.62]) {
          const a = k * Math.PI / 2;
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.09, 8, 20), yel);
          band.position.set(0, 0.6 + Math.sin(a) * span * 0.95, sd * Math.cos(a) * span);
          band.rotation.x = Math.PI / 2 - sd * a; g.add(band);
        }
      }
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.25, 1.5), new THREE.MeshStandardMaterial({ map: this.bannerTex(text), roughness: 0.8, side: THREE.DoubleSide }));
      banner.rotation.y = -Math.PI / 2; banner.position.set(0, span * 0.95 - 0.55, 0); g.add(banner);
    } else {
      for (const sd of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 5.2, 12), ink); m.position.set(0, 2.5, sd * span); m.castShadow = true; g.add(m); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, span * 2 + 0.6), red); bar.position.y = 5.0; bar.castShadow = true; g.add(bar);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.1, 1.05), new THREE.MeshStandardMaterial({ map: this.bannerTex(text), roughness: 0.8, side: THREE.DoubleSide }));
      banner.rotation.y = -Math.PI / 2; banner.position.set(-0.27, 4.2, 0); g.add(banner);
    }
    const cols = [red, yel, ink];
    for (let k = 0; k < 13; k++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 3), cols[k % 3]);
      const zz = -span + (k / 12) * span * 2;
      const y = finish ? 0.6 + Math.sqrt(Math.max(0, span * span - zz * zz)) * 0.95 - 0.55 : 4.55 - Math.sin((k / 12) * Math.PI) * 0.3;
      f.rotation.x = Math.PI; f.position.set(0, y, zz); g.add(f);
    }
  }

  checkerTex(cols, rows) {
    const c = document.createElement('canvas'); c.width = cols * 16; c.height = rows * 16;
    const x = c.getContext('2d');
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { x.fillStyle = (i + j) % 2 ? '#15172b' : '#fbf8f0'; x.fillRect(i * 16, j * 16, 16, 16); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
  }

  bannerTex(text) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#15172b'; x.fillRect(0, 0, 512, 128);
    // checkered edges
    for (let i = 0; i < 512; i += 16) for (const [y0, o] of [[0, 0], [16, 1], [96, 0], [112, 1]]) { x.fillStyle = ((i / 16 + o) % 2) ? '#fbf8f0' : '#15172b'; x.fillRect(i, y0, 16, 16); }
    x.fillStyle = '#ffd23f'; x.font = '400 54px "Dela Gothic One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 8; x.strokeStyle = '#e63b2e'; x.strokeText(text, 256, 66); x.fillText(text, 256, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---------------- cameras ----------------
  introCam(k) {
    // a crane shot: start far down the mountain looking back up at the gate, then swing round behind the racers
    const e = k * k * (3 - 2 * k);
    const phi = e * Math.PI, R = 70 - 58 * e, h = 30 - 23.5 * e;
    const sx = -4 + Math.cos(phi) * R, sz = centerZ(Math.max(0, sx)) + Math.sin(phi) * R * 0.75;
    this.camera.position.set(sx, Math.max(baseH(-4) + h, downhillH(sx, sz) + 3), sz);
    const lu = -4 + e * 13, q = at(lu, 0);
    this.camera.lookAt(q.x, baseH(lu) + 0.6, q.z);
  }

  followCam(dt) {
    const p = this.player, D = p.dh;
    const f = at(D.u);
    let dx = f.fx, dz = f.fz;
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 3) { const w = Math.min(0.45, (sp - 3) * 0.05); dx = dx * (1 - w) + (p.vx / sp) * w; dz = dz * (1 - w) + (p.vz / sp) * w; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (!this.camDir) this.camDir = new THREE.Vector2(dx, dz);
    this.camDir.lerp(new THREE.Vector2(dx, dz), Math.min(1, dt * 2.2)).normalize();
    const k = this.zk, back = 11.5 * k + Math.min(4, sp * 0.15), up = 6.2 * k;
    const want = new THREE.Vector3(p.x - this.camDir.x * back, 0, p.z - this.camDir.y * back);
    want.y = Math.max(p.y + up, downhillH(want.x, want.z) + 2.5);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, Math.min(1, dt * 4));
    this.camera.position.copy(this.camPos);
    const ax = p.x + this.camDir.x * 9, az = p.z + this.camDir.y * 9;
    const ay = Math.min(p.y + 0.6, downhillH(ax, az) + 1.6);
    if (!this.camLook) this.camLook = new THREE.Vector3(ax, ay, az);
    this.camLook.lerp(new THREE.Vector3(ax, ay, az), Math.min(1, dt * 6));
    this.camera.lookAt(this.camLook);
  }

  // ---------------- controls ----------------
  playerInput() {
    const I = this.app.input, me = this.player;
    if (this.state !== 'play' || me.done) return { thr: me.done ? -1 : 0, steer: 0, tuck: false };
    const canGlide = !me.grounded && me.P.glide > 0 && me.vy < 0;
    const tuck = I.keys.has('shift') || this.dashHeld || (I.jump && !canGlide);
    return { thr: I.moveY, steer: I.moveX, tuck, jump: I.jump && canGlide, jumpPressed: I.jumpPressed };
  }

  ai(b) {
    const D = b.dh, A = b.ai;
    if (this.state !== 'play' || b.done) return { thr: b.done ? -1 : 0, steer: 0, tuck: false };
    const sp = Math.hypot(b.vx, b.vz);
    // pick a lane now and then; in the clay-drop field go for pebbles
    D.laneT -= 1 / 60;
    if (D.laneT < 0) { D.laneT = 2.5 + Math.random() * 3; A.lane = (Math.random() * 2 - 1) * (W - 3); }
    let lane = A.lane;
    if (D.u > PICKUPS[0][0] - 12 && D.u < PICKUPS[PICKUPS.length - 1][0] + 1) {
      const next = this.pickups.find((pk, i) => pk.off <= 0 && PICKUPS[i][0] > D.u + 2);
      if (next && A.skill > 0.86) lane = PICKUPS[this.pickups.indexOf(next)][1];
    }
    if (D.u > LIP - 22 && D.u < CREEK[1] + 2) lane *= 0.3;            // line up for the ramp
    const la = 4 + sp * 0.55;
    const tgt = at(D.u + la, lane);
    let dx = tgt.x - b.x, dz = tgt.z - b.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const f = at(D.u);
    const thr = dx * f.fx + dz * f.fz, steer = dx * -f.fz + dz * f.fx;
    // tuck when the road ahead is straight enough for this speed
    let kmax = 0;
    for (let s = 0; s < 6 + sp * 1.4; s += 2) kmax = Math.max(kmax, Math.abs(look(TK, D.u + s)));
    const roller = b.P.gait === 'roll';
    const grip = (roller ? 7.5 : 5) * (0.75 + A.skill * 0.3);
    let tuck = kmax * sp * sp < grip && Math.abs(D.off) < W - 2;
    if (D.u > MOGULS[0] - 2 && D.u < MOGULS[1] && !roller && b.c.stats.balance < 5) tuck = false;
    if (D.u < 3 && sp < 4) tuck = roller;   // run off the start first
    if (Math.sin(this.time * 0.9 + A.skill * 40) > 0.55 + A.skill * 0.4) tuck = false;  // nobody's perfect
    let jumpPressed = false;
    if (b.grounded && D.u > LIP - 0.9 - sp * 0.02 && D.u < LIP && Math.random() < A.skill * 0.5) jumpPressed = true;
    const jump = !b.grounded && b.P.glide > 0 && D.u > LIP - 2 && D.u < CREEK[1] + 3;
    return { thr: Math.max(thr, 0.2), steer, tuck: tuck && !jump, jump, jumpPressed };
  }

  // ---------------- physics ----------------
  // Our own horizontal model on top of the Body's numbers: slope gravity, momentum, tuck and grip.
  sim(b, dt, inp) {
    const P = b.P, D = b.dh, S = b.c.stats;
    const roller = P.gait === 'roll';
    b.stun = Math.max(0, b.stun - dt);
    D.wipe = Math.max(0, D.wipe - dt);
    const fr = proj(b.x, b.z);
    D.u = fr.u; D.off = fr.off;
    const fx = fr.fx, fz = fr.fz, rx = -fz, rz = fx;
    const H = downhillH;
    const e = 0.3;
    // (clamped, so the creek's cliff edges don't count as a slope)
    const cl = (v) => Math.max(-1.2, Math.min(1.2, v));
    const gx = cl((H(b.x + e, b.z) - H(b.x - e, b.z)) / (2 * e)), gz = cl((H(b.x, b.z + e) - H(b.x, b.z - e)) / (2 * e));

    const tuckWant = inp.tuck && b.stun <= 0 && D.wipe <= 0;
    D.tuck += ((tuckWant ? 1 : 0) - D.tuck) * Math.min(1, dt * 9);
    const T = D.tuck;
    if (b === this.player && this.state === 'play') { if (T > 0.5) this.track.tuck += dt; if (tuckWant && !D.wasTuck) { sfx.squish(0.8); } }
    D.wasTuck = tuckWant;

    let vx = b.vx, vz = b.vz;
    let sp = Math.hypot(vx, vz);
    const massF = Math.pow(Math.max(0.35, Math.min(3, P.mass)), 0.25);   // heavier = carries more momentum
    // desired direction, camera-relative (forward = down the course)
    let thr = inp.thr || 0, steer = inp.steer || 0;
    const ctlOn = Math.abs(steer) > 0.08 || thr > 0.08;
    let ddx, ddz;
    if (ctlOn) { const fw = Math.max(thr, 0.55); ddx = fx * fw + rx * steer; ddz = fz * fw + rz * steer; }
    else if (sp > 1) { ddx = vx / sp * 0.8 + fx * 0.2; ddz = vz / sp * 0.8 + fz * 0.2; }
    else { ddx = fx; ddz = fz; }
    const dl = Math.hypot(ddx, ddz) || 1; ddx /= dl; ddz /= dl;
    // heading turns toward it (much slower when tucked)
    const turn = ((1 - T) * 6 + T * (roller ? 3.2 : 1.8)) * (b.stun > 0 ? 0.2 : 1);
    const want = Math.atan2(-ddz, ddx);
    let dh = want - b.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    b.heading += dh * Math.min(1, dt * turn);
    const hx = Math.cos(b.heading), hz = -Math.sin(b.heading);

    if (b.grounded) {
      // gravity along the slope (tucking rolls more efficiently)
      const gm = GS * (1 + T * (roller ? 0.42 : 0.3));
      vx -= gx * gm * dt; vz -= gz * gm * dt;
      // grip: velocity sideways to your heading gets carved into forward motion
      const grip = ((1 - T) * 4 + T * (roller ? 2.4 : 1.1)) * (b.stun > 0 ? 0.3 : 1);
      const par = vx * hx + vz * hz;
      const px = vx - par * hx, pz = vz - par * hz, pl = Math.hypot(px, pz);
      // …but only so hard: a tucked ball can't corner like feet can
      const aMax = (1 - T) * 13 + T * (roller ? 6 : 3.5);
      const cut = Math.min(pl * (1 - Math.exp(-grip * dt)), aMax * dt), k = pl > 1e-4 ? cut / pl : 0;
      vx -= px * k; vz -= pz * k;
      if (par > 0) { vx += hx * cut * 0.88; vz += hz * cut * 0.88; }
      // legs: run up to your top speed (balls just roll — a Roly keeps pushing)
      const run = (1 - T) + T * (roller ? 0.6 : 0.25);
      if (thr > 0.05 && b.stun <= 0) {
        const top = P.maxSpeed * (roller ? 0.8 + T * 0.3 : 0.75);   // legs only help so much downhill
        const v2 = vx * hx + vz * hz;
        if (v2 < top) { const a = P.accel * 0.75 * run * Math.min(1, thr + 0.3); vx += hx * a * dt; vz += hz * a * dt; }
      }
      if (thr < -0.3) { sp = Math.hypot(vx, vz); if (sp > 0.01) { const dec = Math.min(sp, (b.done ? 12 : 7) * -thr * dt); vx -= vx / sp * dec; vz -= vz / sp * dec; } }
      // rolling resistance + air drag (a ball is slipperier, heavy clay cares less)
      sp = Math.hypot(vx, vz);
      if (sp > 0.001) {
        const kd = 0.022 * (1 - T * (roller ? 0.48 : 0.42)) / massF * (b.ai ? 1.12 + (1 - b.ai.skill) * 0.6 : 1);
        const dec = Math.min(sp, (0.4 + kd * sp * sp) * dt);
        vx -= vx / sp * dec; vz -= vz / sp * dec;
      }
    } else {
      // a little air control + glide
      vx += ddx * (ctlOn ? 2.5 : 0) * dt; vz += ddz * (ctlOn ? 2.5 : 0) * dt;
    }
    if (b.done && vx * fx + vz * fz < 0) { vx *= 0.85; vz *= 0.85; }
    sp = Math.hypot(vx, vz);
    if (sp > 28) { vx *= 28 / sp; vz *= 28 / sp; }

    // vertical: jump / flap / glide
    let jumped = false;
    if (b.grounded) b.airJumps = P.airJumps || 0;
    if (inp.jumpPressed && b.stun <= 0) {
      if (b.grounded) { b.vy = Math.max(D.gvy, 0) + P.jump * (T > 0.5 ? 0.8 : 1); b.grounded = false; jumped = true; b.c.motion.land = -0.6; if (b.isPlayer) sfx.boing(P.gait === 'hop' ? 1.3 : 1); }
      else if (b.airJumps > 0) { b.airJumps--; b.vy = Math.max(b.vy, P.jump * 0.8); b.c.motion.flapT = 0.35; if (b.isPlayer) sfx.whoosh(); }
    }
    b.gliding = false;
    if (!b.grounded && inp.jump && b.vy < 0 && P.glide > 0) {
      const fall = 7.5 - P.glide * 6.6;
      if (b.vy < -fall) b.vy += (-fall - b.vy) * Math.min(1, dt * 8);
      b.gliding = true;
      const want2 = P.maxSpeed * (0.7 + P.glide * 0.6);
      if (sp < want2) { vx += hx * (want2 - sp) * dt * 2; vz += hz * (want2 - sp) * dt * 2; }
    }

    // integrate + ground contact
    const x0 = b.x, z0 = b.z, y0 = b.y;
    b.x += vx * dt; b.z += vz * dt;
    const g = H(b.x, b.z);
    if (b.grounded) {
      const ngvy = (g - y0) / dt;
      if (g - y0 > Math.max(0.6, sp * dt * 2.5)) {           // a wall
        b.x = x0; b.z = z0; vx *= -0.2; vz *= -0.2;
      } else if ((ngvy - D.gvy) / dt < -GRAV * 1.05) {       // the ground drops away faster than gravity: airborne!
        b.grounded = false; b.vy = D.gvy; b.y = y0 + b.vy * dt;
      } else { b.y = g; b.vy = 0; D.gvy = Math.max(-15, Math.min(12, ngvy)); }
    } else {
      b.vy -= GRAV * dt;
      b.y += b.vy * dt;
      if (b.y <= g) {
        const g0 = H(x0, z0);
        if (g - b.y > 1.0 && g - g0 > 0.8) { b.x = x0; b.z = z0; vx *= -0.2; vz *= -0.2; }   // smacked into a bank
        else {
          const gr = gx * vx + gz * vz;           // how fast the ground falls away along our path
          const impact = gr - b.vy;
          if (impact > 7) { b.c.motion.land = Math.min(1, impact / 18); this.world.dust(b.x, g, b.z); if (b.isPlayer) sfx.thud(); }
          // Balance keeps you upright; a tucked non-Roly ball bounces about more
          let lim = 7 + S.balance * 0.6;
          if (T > 0.5 && !roller) lim /= 1.2;
          if (impact > lim && !jumped && D.wipe <= 0 && this.state === 'play') this.wipeout(b);
          b.y = g; b.vy = 0; b.grounded = true; D.gvy = Math.max(-15, Math.min(12, gr));
        }
      }
    }
    b.vx = vx; b.vz = vz;
    b.airT = b.grounded ? 0 : (b.airT || 0) + dt;
  }

  wipeout(b) {
    const D = b.dh;
    D.wipe = 0.9; b.stun = 0.8; D.tuck = 0;
    b.vx *= 0.5; b.vz *= 0.5;
    this.fx.emit(b.x, b.y + 0.3, b.z, { count: 14, color: '#d9b48f', speed: 4, up: 4, gravity: 12, size: 0.35, life: 0.7 });
    if (b === this.player) { this.track.wipeouts++; this.banner('WIPEOUT!', 900); sfx.bonk(); babble(0.9, 2, -1); }
  }

  // squash into a ball and spin along the direction of travel
  pose(b, dt) {
    const c = b.c, D = b.dh, T = D.tuck;
    const roller = b.P.gait === 'roll';
    const sp = Math.hypot(b.vx, b.vz);
    const hc = Math.max(0.2, (c.height || 1) * 0.5);
    if (D.wipe > 0) D.tumble += dt * 15;
    else if (D.tumble) { const t = Math.round(D.tumble / (Math.PI * 2)) * Math.PI * 2; D.tumble += (t - D.tumble) * Math.min(1, dt * 8); if (Math.abs(t - D.tumble) < 0.01) D.tumble = 0; }
    if (T > 0.25 && !roller && b.grounded) D.spin -= (sp * dt / hc) * T;
    else if (T > 0.25 && !roller) D.spin -= (sp * dt / hc) * 0.5;      // keep spinning through the air
    else if (D.spin) { const t = Math.round(D.spin / (Math.PI * 2)) * Math.PI * 2; D.spin += (t - D.spin) * Math.min(1, dt * 6); if (Math.abs(t - D.spin) < 0.01) D.spin = 0; }
    // lean with the slope when upright
    const hx = Math.cos(b.heading), hz = -Math.sin(b.heading);
    const sl = b.grounded ? (downhillH(b.x + hx * 0.5, b.z + hz * 0.5) - downhillH(b.x - hx * 0.5, b.z - hz * 0.5)) : 0;
    D.pitch = (D.pitch || 0) + (Math.atan(sl) * 0.8 - (D.pitch || 0)) * Math.min(1, dt * 8);
    // curl up: squeeze the body (in its own frame) toward a ball, then roll it
    let bx = 1, by = 1;
    if (roller) by = 0.9;
    else { const len = Math.max(0.3, c.size || 1), d = (len + hc * 2) * 0.36; bx = Math.max(0.45, Math.min(1, d / len)); by = Math.max(0.5, Math.min(0.9, d / (hc * 2))); }
    const sx = 1 + (bx - 1) * T, sy = 1 + (by - 1) * T;
    c.tilt.scale.set(sx, sy, 1 + (Math.max(bx, by) - 1) * T * 0.5);
    c.tilt.rotation.set(D.tumble, 0, D.spin + D.pitch * (1 - T));
    // rotate about the middle of the (squeezed) body, not the feet
    const v = _pivot.set(0, hc * sy, 0).applyEuler(c.tilt.rotation);
    c.tilt.position.set(-v.x, hc * sy - v.y, -v.z);
    // dust trail when rolling fast
    D.dustT -= dt;
    if (T > 0.5 && b.grounded && sp > 9 && D.dustT < 0) { D.dustT = 0.07; this.fx.emit(b.x, b.y + 0.1, b.z, { count: 2, color: '#e8d2ae', speed: 1.5, up: 1.2, gravity: 3, size: 0.32, life: 0.45 }); }
  }

  respawn(b, creek = false) {
    let cp = CHECKPOINTS.filter((c) => c <= b.dh.u).pop() ?? 0;
    // missed the creek jump twice? the river spirits fish you out on the far bank
    if (creek && (b.dh.creekFalls = (b.dh.creekFalls || 0) + 1) >= 2) cp = CREEK[1] + 3;
    const off = Math.max(-3, Math.min(3, b.dh.off));
    const p = at(cp + 1, off);
    b.x = p.x; b.z = p.z; b.y = downhillH(b.x, b.z) + 0.6; b.vy = 0;
    b.vx = p.fx * 5; b.vz = p.fz * 5; b.heading = Math.atan2(-p.fz, p.fx);
    b.grounded = false; b.stun = 0.5; b.dh.tuck = 0; b.dh.gvy = 0; b.dh.wipe = 0;
    if (b === this.player) { if (creek) this.track.creek++; else this.track.falls++; sfx.bonk(); this.camPos = null; this.camDir = null; this.camLook = null; }
  }

  step(dt, after) {
    for (const b of this.all) this.sim(b, dt, b === this.player ? this.playerInput() : this.ai(b));
    collide(this.all);
    for (const b of this.all) {
      const D = b.dh;
      const fr = proj(b.x, b.z); D.u = fr.u; D.off = fr.off;
      if (b.grounded) b.y = Math.max(b.y, downhillH(b.x, b.z));
      const inCreek = D.u > CREEK[0] - 0.5 && D.u < CREEK[1] + 0.5 && Math.abs(D.off) < W + 2.5 && b.y < CREEK_WATER + 0.4;
      if (inCreek || Math.abs(D.off) > W + 4.5 || b.y < baseH(D.u) - 5) {
        this.world.splash(b.x, inCreek ? CREEK_WATER : b.y, b.z);
        this.respawn(b, inCreek);
      }
      if (!b.done && D.u >= FINISH) {
        b.done = this.time;
        if (b === this.player) { this.banner('FINISH!', 1400); sfx.chime(); this.playerDoneAt = this.time; } else sfx.pop(0.8);
      }
      b.sync();
      if (b.P.gait !== 'roll') b.c.motion.speed *= 1 - 0.85 * D.tuck;   // curled up: legs stop running
      b.c.motion.dizzy = b.stun > 0 || D.wipe > 0 ? 1 : 0;
      this.pose(b, dt);
    }
    // pickups: bob, spin, and give a burst of speed
    for (const pk of this.pickups) {
      pk.off = Math.max(0, pk.off - dt);
      const vis = pk.off <= 0;
      pk.m.visible = vis;
      pk.m.position.y = pk.y + Math.sin(this.time * 3 + pk.ph) * 0.15; pk.m.rotation.y += dt * 2;
      if (!vis) continue;
      for (const b of this.all) {
        if (Math.hypot(b.x - pk.x, b.z - pk.z) < 1.1 + b.P.radius && Math.abs(b.y + 0.4 - pk.y) < 1.6) {
          pk.off = 6;
          const sp = Math.hypot(b.vx, b.vz) || 1, f = at(b.dh.u);
          const dx = sp > 2 ? b.vx / sp : f.fx, dz = sp > 2 ? b.vz / sp : f.fz;
          b.vx += dx * 4; b.vz += dz * 4;
          this.fx.emit(pk.x, pk.y, pk.z, { count: 22, colors: ['#ffd23f', '#ff9f3f', '#fbf8f0'], speed: 4, up: 4, gravity: 8, size: 0.3, life: 0.7 });
          if (b === this.player) { sfx.sparkle(); this.track.pickups++; }
          break;
        }
      }
    }
    if (after || this.state !== 'play') return;
    // tutorial tip: show for the first few seconds
    const tipOn = this.time > 0.75 && this.time < 5.5;
    if (tipOn !== this.tipShown) { this.tipShown = tipOn; this.tip.classList.toggle('on', tipOn); if (tipOn) this.banner('TUCK!', 1100); }
    const me = this.player;
    const place = 1 + this.rivals.filter((r) => (r.done && (!me.done || r.done < me.done)) || (!r.done && !me.done && r.dh.u > me.dh.u)).length;
    const el = $('dh-pos'); if (el) el.textContent = ['1st', '2nd', '3rd', '4th'][place - 1];
    const tm = $('dh-time'); if (tm) tm.textContent = (me.done ?? this.time).toFixed(1) + 's';
    // wait a moment after you cross the line for the others to roll in
    if (me.done && (this.rivals.every((r) => r.done) || this.time - this.playerDoneAt > 3.5)) this.results();
    // give up waiting if the player is way behind after everyone finished
    if (!me.done && this.rivals.every((r) => r.done) && this.time - Math.max(...this.rivals.map((r) => r.done)) > 12) this.results();
  }

  results() {
    if (this.state === 'done' || this._resulted) return;
    this._resulted = true;
    this.tip.classList.remove('on');
    const me = this.player;
    const racers = this.all.map((b) => ({ b, t: b.done }));
    racers.sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9) || b.b.dh.u - a.b.dh.u);
    const rows = racers.map((r, i) => ({ place: i + 1, name: r.b.c.design.name + (r.b === me ? ' (you)' : ''), score: r.t ? fmt(r.t) : 'still rolling', me: r.b === me }));
    const won = racers[0].b === me && !!me.done;
    const S = me.c.stats, roller = me.P.gait === 'roll';
    const tuckPct = this.time > 0 ? this.track.tuck / Math.max(1, me.done ?? this.time) : 0;
    let advice;
    if (won) advice = `${me.c.design.name} rolled in first! ${roller ? 'A born ball.' : `Not bad for something with ${me.P.gait === 'quad' ? 'four' : 'any'} legs.`} Hold the tuck on the straights to shave more time.`;
    else if (this.track.creek > 0) advice = `You splashed into the creek ${this.track.creek}×. <b>Tuck</b> down the steep chute for speed and tap <b>jump</b> right at the ramp lip${me.P.glide > 0 ? ', then hold it to glide' : ''}.`;
    else if (this.track.falls > 1) advice = `You flew off the mountain ${this.track.falls}×. <b>Untuck before the turns</b> (let go of Shift) so your feet can steer.`;
    else if (this.track.wipeouts > 1) advice = `You wiped out ${this.track.wipeouts}× on the bumps. Draw <b>wider feet</b> or a lower belly for more Balance (yours: ${S.balance.toFixed(1)}), or untuck over the moguls.`;
    else if (tuckPct < 0.3) advice = `You only tucked ${Math.round(tuckPct * 100)}% of the way down. <b>Hold Shift</b> on the straights: a ball beats legs downhill.`;
    else if (!roller) advice = `Try the <b>Roly</b> body type: it was born for hills (rolls faster, steers better tucked). Or add <b>more clay</b>: heavy monsters carry more momentum.`;
    else advice = `Add <b>more clay</b> to your ball: heavier Rolies carry more momentum (yours: ${S.power.toFixed(1)} Power). Grab the glowing pebbles too.`;
    // score: "pace points" = 1000 / seconds (higher is better; a 25 s run scores 40.00). DNF scores 0.
    const result = me.done ? { score: Math.round(100000 / me.done) / 100, text: fmt(me.done) } : { score: 0, text: 'DNF' };
    this.finish(won, rows, advice, result);
  }

  dispose() {
    this.tip?.remove();
    const db = $('t-dash');
    if (db) { db.removeEventListener('pointerdown', this._dashDown); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) db.removeEventListener(ev, this._dashUp); }
    for (const b of this.all) { const c = b.c; c.group.scale.set(1, 1, 1); c.tilt.rotation.set(0, 0, 0); c.tilt.position.set(0, 0, 0); c.tilt.scale.set(1, 1, 1); c.motion.dizzy = 0; }
    super.dispose();
  }
}

const _pivot = new THREE.Vector3();
const fmt = (t) => t.toFixed(2) + 's';
