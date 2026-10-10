// Ridge Run: hills → river (swim) → chasm (jump/glide) → log hurdles → finish.
import * as THREE from 'three';
import { EventBase, adviceFor } from './base.js';
import { terrainMesh, terrainMaterial, plantGrass, plantFlowers, plantTrees, placeRocks, grassHeight, modelSize, pbr } from '../world/nature.js';
import { rng } from '../creature/generator.js';
import { smoothstep, fbm2 } from '../game/noise.js';
import { collide } from '../game/body.js';
import { sfx } from '../fx/audio.js';

const W = 6.5;            // track half-width
const FINISH = 150;
const LOGS = [104, 110, 116, 122];
const CHASM = [80, 88], STONE = [83.2, 84.8];
const RIVER = [46, 62];
const CHECKPOINTS = [0, 40, 66, 92, 128];

function trackH(x, z, noLogs = false) {
  let h = 2;
  if (x > 18 && x < 44) h += Math.max(0, Math.sin((x - 18) * 0.42)) * 1.6;
  if (x > RIVER[0] && x < RIVER[1]) h = 2 - 3.8 * smoothstep(RIVER[0], RIVER[0] + 3, x) * smoothstep(RIVER[1], RIVER[1] - 3, x);
  if (x > CHASM[0] && x < CHASM[1] && !(x > STONE[0] && x < STONE[1] && Math.abs(z) < 2.4)) h = -9;
  if (!noLogs) for (const lx of LOGS) if (Math.abs(x - lx) < 0.45) h += 1.05;
  if (x > 128) h += smoothstep(128, 140, x) * 1.6;
  if (x > FINISH + 8) h = 3.6 - smoothstep(FINISH + 8, FINISH + 14, x) * 6;
  if (x < -6) h = 2 - smoothstep(-6, -10, x) * 6;
  const edge = smoothstep(W - 0.6, W + 1.4, Math.abs(z));
  return h * (1 - edge) + (-5 + fbm2(x * 0.1, z * 0.1) * 2) * edge;
}

export class RaceEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, { rivalOpts: [{ frame: 'quad' }, { tail: true }, {}] });
    this.height = trackH;
    this.build();
    const lanes = [-3.6, -1.2, 1.2, 3.6];
    this.all.forEach((b, i) => { b.x = 1; b.z = lanes[i]; b.y = 2; b.heading = 0; b.cp = 0; b.done = null; b.sync(); });
    this.hud(`<span class="pill" id="rh-pos">1st</span><span class="pill" id="rh-time">0.0s</span>`);
  }

  build() {
    const s = this.scene;
    const r = rng(7);
    // ground without the log bumps (real logs sit on top)
    const groundH = (x, z) => trackH(x, z, true);
    const splat = (x, h, z, ny) => {
      const sand = smoothstep(0.6, -0.4, h);
      const rock = smoothstep(0.82, 0.55, ny) * (1 - sand * 0.5);
      const path = smoothstep(3.6, 2.4, Math.abs(z) + fbm2(x * 0.3, z * 0.3) * 0.6) * (h > 0.8 ? 1 : 0);
      const dirt = path * (1 - rock);
      return [Math.max(0, 1 - sand - rock - dirt), dirt, sand, rock];
    };
    const len = FINISH + 34;
    s.add(terrainMesh(groundH, { size: [len, 30], seg: [720, 110], center: [len / 2 - 14, 0], splatFn: splat, material: terrainMaterial({ path: 'rocky_trail' }) }));
    this.makeWater(groundH, [-40, -110, 280]);

    // grass along both verges + flowers
    const gH = grassHeight(), grass = [], flowers = [];
    for (let i = 0; i < 26000; i++) {
      const x = -10 + r() * (len - 10), z = (r() - 0.5) * 2 * (W + 0.4);
      const h = groundH(x, z);
      if (Math.abs(z) < 3.3 || h < 1.2) continue;
      if (x > CHASM[0] - 1 && x < CHASM[1] + 1) continue;
      grass.push({ x, y: h - 0.03, z, s: (0.4 + r() * 0.35) / gH, ry: r() * 6.28, hue: r(), lum: r() });
      if (r() < 0.02) flowers.push({ x, y: h, z, s: (0.35 + r() * 0.2) / modelSize('flower_white').y, ry: r() * 6.28 });
    }
    plantGrass(s, grass); plantFlowers(s, flowers);

    // hurdles: real logs
    const bark = pbr('bark_brown_02', 4, 1);
    for (const lx of LOGS) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, W * 2 + 1, 24), bark);
      log.rotation.x = Math.PI / 2; log.rotation.y = (r() - 0.5) * 0.06; log.position.set(lx, groundH(lx, 0) + 0.5, 0); log.castShadow = log.receiveShadow = true; s.add(log);
    }
    // the stepping-stone pillar in the chasm
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.3, 12, 20, 4), pbr('rock_face_03', 2, 3));
    pillar.position.set((STONE[0] + STONE[1]) / 2, -4, 0); pillar.scale.z = 1.6; pillar.castShadow = pillar.receiveShadow = true; s.add(pillar);

    // start + finish gantries: timber posts, plank beam, bunting
    const post = pbr('bark_brown_02', 1, 3), beam = pbr('wood_planks', 4, 0.5);
    const flagCols = ['#e63b2e', '#ffd23f', '#2f6fdf', '#11a39a', '#ff6fa8'];
    const flagMats = flagCols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, side: THREE.DoubleSide }));
    for (const ax of [0, FINISH]) {
      const h0 = groundH(ax, 0);
      for (const zz of [-W - 0.3, W + 0.3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 5.4, 12), post); p.position.set(ax, h0 + 2.5, zz); p.castShadow = true; s.add(p); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, W * 2 + 1.4), beam);
      bar.position.set(ax, h0 + 5.1, 0); bar.castShadow = true; s.add(bar);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.2, 0.9), new THREE.MeshStandardMaterial({ map: this.bannerTex(ax === 0 ? 'START' : 'FINISH'), roughness: 0.8, side: THREE.DoubleSide }));
      banner.position.set(ax - 0.27, h0 + 5.1, 0); banner.rotation.y = -Math.PI / 2; s.add(banner);
      for (let k = 0; k < 13; k++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 3), flagMats[k % 5]);
        f.rotation.x = Math.PI; f.position.set(ax, h0 + 4.45 - Math.sin((k / 12) * Math.PI) * 0.35, -W + (k / 12) * W * 2); s.add(f);
      }
    }
    // rocky islets with trees out in the water
    const trees = [], rocks = [];
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    for (let i = 0; i < 46; i++) {
      const x = -10 + r() * (FINISH + 25), z = (r() < 0.5 ? -1 : 1) * (W + 7 + r() * 22);
      const big = r() < 0.45;
      rocks.push({ x, y: -1.2, z, s: (big ? 6 + r() * 5 : 1.5 + r() * 2.5) / rs, sy: big ? 0.55 : 0.8, ry: r() * 6.28 });
      if (big && r() < 0.8) trees.push({ x, y: 0.9 + r() * 0.5, z, h: 5 + r() * 4, ry: r() * 6.28, kind: (r() * 4) | 0 });
    }
    // trackside boulders
    for (let i = 0; i < 26; i++) {
      const x = r() * FINISH, z = (r() < 0.5 ? -1 : 1) * (W + 0.2 + r() * 0.8);
      if (x > CHASM[0] - 2 && x < CHASM[1] + 2) continue;
      rocks.push({ x, y: groundH(x, z) - 0.2, z, s: (0.6 + r() * 0.9) / rs, sy: 0.8, ry: r() * 6.28 });
    }
    placeRocks(s, rocks); plantTrees(s, trees);
  }

  bannerTex(text) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#15172b'; x.fillRect(0, 0, 512, 96);
    for (let i = 0; i < 512; i += 32) { x.fillStyle = (i / 32) % 2 ? '#ffd23f' : '#15172b'; x.fillRect(i, 0, 16, 10); x.fillRect(i + 16, 86, 16, 10); }
    x.fillStyle = '#fbf8f0'; x.font = '400 56px "Dela Gothic One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  introCam(k) {
    const x = 160 - k * 150;
    this.camera.position.set(x, 16 - k * 6, 26 - k * 14);
    this.camera.lookAt(x - 20, 2, 0);
  }

  followCam(dt) {
    const p = this.player;
    const k = this.zk; const want = new THREE.Vector3(p.x - 9.5 * k, Math.max(p.y, 1) + 5.2 * k, p.z * 0.6 + 3.5);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, Math.min(1, dt * 5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(p.x + 6, Math.max(p.y, 1) + 0.5, p.z * 0.8);
  }

  respawn(b) {
    const cp = CHECKPOINTS.filter((c) => c <= b.x).pop() ?? 0;
    b.x = cp + 1; b.y = trackH(b.x, b.z) + 2; b.vx = b.vy = b.vz = 0; b.z = Math.max(-4, Math.min(4, b.z)); b.stun = 0.6;
    if (b === this.player) { this.track.falls++; sfx.bonk(); }
  }

  step(dt, after) {
    const ctl = after ? { mx: 0.3, mz: 0 } : this.playerCtl();
    if (this.player.done) { ctl.mx = 0.4; ctl.mz = 0; ctl.jump = false; ctl.jumpPressed = false; }
    this.player.step(dt, ctl, this.world);
    for (const r of this.rivals) r.step(dt, this.ai(r, dt), this.world);
    collide(this.all);
    for (const b of this.all) {
      b.z = Math.max(-W - 3, Math.min(W + 3, b.z));
      const offTrack = Math.abs(b.z) > W + 0.5 && b.y < 0.5;
      const inChasm = b.x > CHASM[0] - 0.5 && b.x < CHASM[1] + 0.5 && b.y < 0.3;
      if (offTrack || inChasm || b.y < -4) { this.world.splash(b.x, 0, b.z); this.respawn(b); }
      if (!b.done && b.x >= FINISH) { b.done = this.time; if (b === this.player) this.onPlayerFinish(); else sfx.pop(0.8); }
    }
    if (this.state === 'play') {
      const place = 1 + this.rivals.filter((r) => (r.done && (!this.player.done || r.done < this.player.done)) || (!r.done && !this.player.done && r.x > this.player.x)).length;
      const ord = ['1st', '2nd', '3rd', '4th'][place - 1];
      const el = document.getElementById('rh-pos'); if (el) el.textContent = ord;
      const tm = document.getElementById('rh-time'); if (tm) tm.textContent = this.time.toFixed(1) + 's';
      // give up waiting if the player is way behind after everyone finished
      if (!this.player.done && this.rivals.every((r) => r.done) && this.time - Math.max(...this.rivals.map((r) => r.done)) > 12) this.onPlayerFinish(true);
    }
  }

  ai(b, dt) {
    if (this.state !== 'play' || b.done) return { mx: b.done ? 0.3 : 0, mz: 0 };
    const A = b.ai; A.t -= dt;
    const sp = Math.max(3, Math.hypot(b.vx, b.vz));
    let jumpPressed = false, jump = false;
    if (b.grounded) {
      const dEdge = CHASM[0] - b.x, dStone = STONE[1] - b.x;
      let want = dEdge > 0 && dEdge < 0.35 + sp * 0.05;
      if (b.x > STONE[0] && dStone > 0 && dStone < 0.45) want = true;
      for (const lx of LOGS) { const d = lx - 0.5 - b.x; if (d > 0 && d < sp * 0.11 + 0.35) want = true; }
      if (want && Math.random() < A.skill + 0.1) jumpPressed = true;
    }
    if (b.swimming && b.x > RIVER[1] - 2.5 && Math.random() < 0.08) jumpPressed = true;
    if (!b.grounded && b.vy < 0 && b.P.glide > 0 && b.x > CHASM[0] - 2 && b.x < CHASM[1] + 1) jump = true;
    // drift toward the middle lane near the stone
    let mz = 0;
    if (b.x > CHASM[0] - 10 && b.x < CHASM[1]) mz = -b.z * 0.4;
    const pace = 0.9 + 0.08 * A.skill + 0.05 * Math.sin(this.time * 0.7 + b.ai.skill * 10);
    return { mx: pace, mz, jump, jumpPressed };
  }

  onPlayerFinish(dnf) {
    if (this.state === 'done') return;
    const me = this.player;
    if (dnf) me.done = null;
    const racers = this.all.map((b) => ({ b, t: b.done }));
    racers.sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9) || b.b.x - a.b.x);
    const rows = racers.map((r, i) => ({ place: i + 1, name: r.b.c.design.name + (r.b === me ? ' (you)' : ''), score: r.t ? r.t.toFixed(1) + 's' : 'still running', me: r.b === me }));
    const won = racers[0].b === me;
    const S = me.c.stats;
    const needs = [];
    if (this.track.swim > 6) needs.push('swim');
    if (this.track.falls > 0) needs.push('glide');
    needs.push('speed');
    let advice = adviceFor(S, needs);
    if (this.track.falls > 0) advice = `You fell into the chasm ${this.track.falls}×. ` + advice;
    else if (this.track.swim > 6) advice = `You spent ${this.track.swim.toFixed(1)}s swimming the river. ` + advice;
    if (won) advice = `${me.c.design.name} crossed the line first. The Gloom on Ridge Run is fading!`;
    this.finish(won, rows, advice, me.done ? { time: me.done } : {});
  }
}
