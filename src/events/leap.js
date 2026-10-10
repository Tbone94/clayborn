// Sky Leap: sprint off a cliff, hold jump to glide, farthest splash wins.
import * as THREE from 'three';
import { EventBase, adviceFor } from './base.js';
import { terrainMesh, terrainMaterial, plantGrass, plantFlowers, plantTrees, placeRocks, grassHeight, modelSize } from '../world/nature.js';
import { rng } from '../creature/generator.js';
import { smoothstep, fbm2 } from '../game/noise.js';
import { sfx } from '../fx/audio.js';

const CLIFF = 14, EDGE = 34, LANES = [-6, -2, 2, 6];

function leapH(x, z) {
  if (x < EDGE) {
    let h = CLIFF;
    if (x < -2) h = CLIFF - smoothstep(-2, -8, x) * 20;
    // a kicker ramp near the edge
    h += smoothstep(EDGE - 6, EDGE, x) * 1.2;
    const side = smoothstep(9.5, 12, Math.abs(z));
    return h * (1 - side) - 8 * side;
  }
  return -6 + fbm2(x * 0.05, z * 0.05) * 3 - smoothstep(EDGE, EDGE + 4, x) * 4;
}

export class LeapEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, { sky: ['#9bb8f0', '#ffd9c7'], rivalOpts: [{ wings: true }, { wings: true, frame: 'biped' }, { frame: 'hopper' }] });
    this.height = leapH;
    this.build();
    this.all.forEach((b, i) => { b.x = 0; b.z = LANES[i]; b.y = CLIFF; b.heading = 0; b.dist = null; b.launched = false; b.sync(); });
    this.hud(`<span class="pill" id="lh-dist">0.0 m</span><span class="pill">Best: <span id="lh-best">-</span></span>`);
  }

  build() {
    const s = this.scene;
    const r = rng(23);
    const splat = (x, h, z, ny) => {
      const rock = smoothstep(0.8, 0.5, ny);
      const sand = smoothstep(0.5, -0.6, h) * (1 - rock);
      const lane = (LANES.some((l) => Math.abs(z - l) < 0.85) && x < EDGE && h > CLIFF - 1) ? 0.85 : 0;
      const dirt = lane * (1 - rock);
      return [Math.max(0, 1 - rock - sand - dirt), dirt, sand, rock];
    };
    s.add(terrainMesh(leapH, { size: [80, 46], seg: [320, 190], center: [16, 0], splatFn: splat, material: terrainMaterial({ path: 'rocky_trail' }) }));
    this.makeWater(leapH, [-40, -140, 280]);
    // cliff-top meadow
    const gH = grassHeight(), grass = [], flowers = [];
    for (let i = 0; i < 16000; i++) {
      const x = -6 + r() * (EDGE + 4), z = (r() - 0.5) * 22, h = leapH(x, z);
      if (h < CLIFF - 0.5 || LANES.some((l) => Math.abs(z - l) < 0.8)) continue;
      grass.push({ x, y: h - 0.03, z, s: (0.4 + r() * 0.35) / gH, ry: r() * 6.28, hue: r(), lum: r() });
      if (r() < 0.02) flowers.push({ x, y: h, z, s: (0.35 + r() * 0.2) / modelSize('flower_white').y, ry: r() * 6.28 });
    }
    plantGrass(s, grass); plantFlowers(s, flowers);
    const trees = [];
    for (let i = 0; i < 14; i++) { const z = (r() < 0.5 ? -1 : 1) * (9 + r() * 1.2), x = -3 + r() * (EDGE - 8); trees.push({ x, y: leapH(x, z) - 0.2, z, h: 6 + r() * 4, ry: r() * 6.28, kind: (r() * 6) | 0 }); }
    plantTrees(s, trees);
    // distance buoys every 10m
    const buoyMat = new THREE.MeshStandardMaterial({ color: '#e63b2e', roughness: 0.45 });
    const buoyTop = new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.4 });
    for (let d = 10; d <= 90; d += 10) {
      for (const z of [-11, 11]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.2, 20), buoyMat);
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 12, 0, 6.29, 0, 1.6), buoyTop); c.position.y = 0.6;
        b.add(c); b.position.set(EDGE + d, 0.3, z); b.castShadow = true; s.add(b);
      }
      const lbl = this.label(`${d}m`); lbl.position.set(EDGE + d, 2.4, 11); s.add(lbl);
    }
    // real sea stacks for scale
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    const stacks = [];
    for (let i = 0; i < 18; i++) stacks.push({ x: EDGE + 15 + r() * 100, y: -3, z: (r() < 0.5 ? -1 : 1) * (18 + r() * 34), s: (5 + r() * 7) / rs, sy: 1.2 + r() * 1.4, ry: r() * 6.28 });
    placeRocks(s, stacks);
    // markers that show where everyone landed
    const pole = new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.5 });
    this.markers = this.all.map((b) => {
      const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), pole);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ color: b.c.design.color, side: THREE.DoubleSide }));
      fl.position.set(0.55, 1.1, 0); mk.add(fl); mk.visible = false; s.add(mk); return mk;
    });
  }

  label(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d'); x.font = '400 64px "Dela Gothic One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 12; x.strokeStyle = '#15172b'; x.strokeText(text, 128, 64); x.fillStyle = '#ffd23f'; x.fillText(text, 128, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false })); sp.scale.set(3, 1.5, 1); return sp;
  }

  introCam(k) {
    this.camera.position.set(EDGE + 70 - k * 70, 10 + k * 8, 30 - k * 14);
    this.camera.lookAt(EDGE - k * 20, CLIFF * k, 0);
  }

  followCam(dt) {
    const p = this.player;
    const flying = p.x > EDGE - 4;
    const k = this.zk; const want = flying ? new THREE.Vector3(p.x - 6 * k, p.y + 4.5 * k, p.z + 13 * k) : new THREE.Vector3(p.x - 10 * k, p.y + 5 * k, p.z * 0.5 + 6);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, Math.min(1, dt * 3.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(p.x + (flying ? 6 : 8), Math.max(p.y - 1, 0), p.z);
  }

  step(dt) {
    const pc = this.playerCtl(true);
    const me = this.player;
    if (me.launched) { pc.mx = Math.max(pc.mx, 0.6); }
    if (me.dist == null) me.step(dt, pc, this.world);
    for (const r of this.rivals) if (r.dist == null) r.step(dt, this.ai(r), this.world);
    this.all.forEach((b, i) => {
      b.z = Math.max(LANES[i] - 1.6, Math.min(LANES[i] + 1.6, b.z));
      if (b.x > EDGE) b.launched = true;
      if (b.dist == null && b.launched && b.y < 0.4) {
        b.dist = b.x - EDGE; this.world.splash(b.x, 0, b.z);
        const mk = this.markers[i]; mk.visible = true; mk.position.set(b.x, 0.8, b.z);
        if (b !== me) sfx.pop(0.7);
      }
      if (b.dist != null) { b.vy = 0; b.y += (-0.4 - b.y) * dt * 3; b.sync(); }
    });
    if (this.state !== 'play') return;
    const el = document.getElementById('lh-dist'); if (el) el.textContent = (me.dist ?? Math.max(0, me.x - EDGE)).toFixed(1) + ' m';
    const best = Math.max(...this.rivals.map((r) => r.dist ?? 0));
    const bl = document.getElementById('lh-best'); if (bl) bl.textContent = best > 0 ? best.toFixed(1) + ' m' : '-';
    // a too-timid player gets nudged after a while
    if (this.time > 25 && !me.launched) this.done();
    if (me.dist != null && this.all.every((b) => b.dist != null)) this.done();
    if (me.dist != null && this.time > 30) this.done();
  }

  ai(b) {
    if (this.state !== 'play') return { mx: 0, mz: 0 };
    const A = b.ai;
    const edgeIn = EDGE - b.x;
    const jumpAt = 1.2 + (1 - A.skill) * 6;
    const jumpPressed = b.grounded && edgeIn < jumpAt && edgeIn > -0.5;
    const jump = b.x > EDGE - 2;
    return { mx: A.skill, mz: 0, jump, jumpPressed };
  }

  done() {
    if (this.state === 'done') return;
    const me = this.player;
    const rows = this.all.map((b) => ({ b, d: b.dist ?? 0 })).sort((a, b) => b.d - a.d)
      .map((r, i) => ({ place: i + 1, name: r.b.c.design.name + (r.b === me ? ' (you)' : ''), score: r.d.toFixed(1) + ' m', me: r.b === me }));
    const won = rows[0].me && (me.dist ?? 0) > 0;
    const S = me.c.stats;
    let advice = won ? `${(me.dist).toFixed(1)} m! The Sky Leap Gloom is blowing away.` : adviceFor(S, me.P.glide > 0 ? ['glide', 'speed'] : ['glide']);
    if (!won && me.P.glide === 0) advice = 'No wings, no glide! ' + advice + ' Hold <b>Space</b> after jumping to glide.';
    this.finish(won, rows, advice, { dist: me.dist ?? 0 });
  }
}
