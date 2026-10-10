// Bonk Bowl: last creature standing on a shrinking clay drum.
import * as THREE from 'three';
import { EventBase, adviceFor } from './base.js';
import { pbr, placeRocks, plantTrees, modelSize } from '../world/nature.js';
import { rng } from '../creature/generator.js';
import { collide } from '../game/body.js';
import { sfx, babble } from '../fx/audio.js';

const TOP = 2;

export class BonkEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, { sky: ['#f6a97a', '#ffe7c2'], rivalOpts: [{ frame: 'quad' }, { frame: 'hopper' }, { frame: 'biped' }] });
    this.R = 10; this.R0 = 10;
    this.height = (x, z) => (Math.hypot(x, z) < this.R ? TOP : -6);
    this.build();
    this.all.forEach((b, i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI;
      b.x = Math.cos(a) * 6; b.z = Math.sin(a) * 6; b.y = TOP; b.heading = Math.atan2(Math.sin(a), -Math.cos(a)); b.sync();
    });
    this.camYaw = Math.PI;
    this.hud(`<span class="pill" id="bh-left">4 left</span><span class="pill" id="bh-time">60</span>`);
    this.outOrder = [];
  }

  build() {
    const s = this.scene;
    const r = rng(11);
    this.drum = new THREE.Group();
    // a carved stone sumo drum
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 96), [pbr('rustic_stone_wall_02', 12, 0.3), pbr('stone_tiles_02', 3, 3), pbr('stone_tiles_02', 3, 3)]);
    top.position.y = TOP - 0.3; top.receiveShadow = true; top.castShadow = true;
    const side = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.86, 8, 96, 1, true), pbr('rustic_stone_wall_02', 10, 2));
    side.position.y = TOP - 4.3; side.castShadow = true;
    const ringMark = new THREE.Mesh(new THREE.RingGeometry(0.93, 0.97, 96), new THREE.MeshStandardMaterial({ color: '#e63b2e', roughness: 0.7 }));
    ringMark.rotation.x = -Math.PI / 2; ringMark.position.y = TOP + 0.005;
    this.drumTop = top; this.drumSide = side; this.ringMark = ringMark;
    this.drum.add(top, side, ringMark);
    s.add(this.drum);
    // a ring of mossy boulders with trees, like an amphitheatre in the sea
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    const rocks = [], trees = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2, d = 21 + r() * 6;
      rocks.push({ x: Math.cos(a) * d, y: -2, z: Math.sin(a) * d, s: (4 + r() * 4) / rs, sy: 0.6 + r() * 0.5, ry: r() * 6.28 });
      if (r() < 0.45) trees.push({ x: Math.cos(a) * d, y: 0.8 + r(), z: Math.sin(a) * d, h: 5 + r() * 5, ry: r() * 6.28, kind: (r() * 4) | 0 });
    }
    placeRocks(s, rocks); plantTrees(s, trees);
    this.makeWater(() => -6, [-60, -60, 120]);
    this.applyR();
  }

  applyR() { for (const m of [this.drumTop, this.drumSide, this.ringMark]) m.scale.set(this.R, m === this.ringMark ? this.R : 1, this.R); }

  introCam(k) {
    const a = Math.PI * 0.3 + k * 1.2;
    this.camera.position.set(Math.cos(a) * 24, 14 - k * 3, Math.sin(a) * 24);
    this.camera.lookAt(0, TOP, 0);
  }

  followCam(dt) {
    const p = this.player;
    const tx = p.x * 0.55, tz = p.z * 0.55;
    const [cdx] = this.app.input.takeCam(); this.camYaw -= cdx * 0.006;
    const k = this.zk; const want = new THREE.Vector3(tx + Math.cos(this.camYaw) * 15 * k, 13 * k, tz + Math.sin(this.camYaw) * 15 * k);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, Math.min(1, dt * 4));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(tx, TOP, tz);
  }

  step(dt, after) {
    // shrink after 15s
    if (!after && this.time > 15) { this.R = Math.max(3.2, this.R0 - (this.time - 15) * 0.16); this.applyR(); }
    const I = this.app.input;
    const fwdX = -Math.cos(this.camYaw), fwdZ = -Math.sin(this.camYaw);
    const rx = -fwdZ, rz = fwdX;
    const ctl = (this.state === 'play' && !this.player.out) ? { mx: fwdX * I.moveY + rx * I.moveX, mz: fwdZ * I.moveY + rz * I.moveX, jump: I.jump, jumpPressed: I.jumpPressed, dashPressed: I.dashPressed } : { mx: 0, mz: 0 };
    if (!this.player.out) this.player.step(dt, ctl, this.world);
    for (const r of this.rivals) if (!r.out) r.step(dt, this.ai(r, dt), this.world);
    collide(this.all.filter((b) => !b.out), (a, b, rel) => {
      sfx.bonk(); this.fx.emit((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.8, (a.z + b.z) / 2, { count: 14, colors: ['#ffffff', '#ffe680'], speed: 5, up: 3, gravity: 6, size: 0.3, life: 0.5 });
      if (rel > 8) babble(1.6, 2, 1);
      if (a === this.player || b === this.player) this.track.bonks++;
    });
    for (const b of this.all) {
      if (b.out) { b.vy -= 20 * dt; b.y = Math.max(-1.2, b.y + b.vy * dt); b.sync(); continue; }
      if (b.y < 0) {
        b.out = true; this.outOrder.push(b); this.world.splash(b.x, 0, b.z);
        if (b === this.player) this.end(false);
      }
    }
    const left = this.all.filter((b) => !b.out);
    const el = document.getElementById('bh-left'); if (el) el.textContent = `${left.length} left`;
    const tm = document.getElementById('bh-time'); if (tm) tm.textContent = Math.max(0, 75 - this.time).toFixed(0);
    if (this.state === 'play') {
      if (left.length === 1 && left[0] === this.player) this.end(true);
      else if (this.time > 75) this.end(!this.player.out);
    }
  }

  ai(b, dt) {
    if (this.state !== 'play') return { mx: 0, mz: 0 };
    const A = b.ai; A.t -= dt;
    // pick a target: nearest standing opponent, with a soft spot for the player
    if (!A.target || A.target.out || A.t <= 0) {
      const opts = this.all.filter((o) => o !== b && !o.out);
      opts.sort((p, q) => (Math.hypot(p.x - b.x, p.z - b.z) - (p === this.player ? 0.8 : 0)) - (Math.hypot(q.x - b.x, q.z - b.z) - (q === this.player ? 0.8 : 0)));
      A.target = opts[0]; A.t = 2 + Math.random() * 2;
    }
    const T = A.target; if (!T) return { mx: 0, mz: 0 };
    let dx = T.x - b.x, dz = T.z - b.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    // stay away from the edge
    const r = Math.hypot(b.x, b.z);
    if (r > this.R - 2.6) { const k = (r - (this.R - 2.6)) * 1.8; dx -= (b.x / r) * k; dz -= (b.z / r) * k; }
    // circle-strafe a bit so it isn't a straight charge
    const wob = Math.sin(this.time * 1.7 + A.skill * 9) * 0.35;
    const mx = dx - dz * wob, mz = dz + dx * wob;
    const facing = Math.cos(b.heading) * dx + -Math.sin(b.heading) * dz;
    const dash = this.time > 2.5 && d < 3 && facing > 0.85 && Math.random() < A.skill * 0.025;
    return { mx: mx * A.skill, mz: mz * A.skill, dashPressed: dash };
  }

  end(won) {
    const me = this.player;
    const standing = this.all.filter((b) => !b.out);
    const order = [...standing, ...this.outOrder.slice().reverse()];
    const rows = order.map((b, i) => ({ place: i + 1, name: b.c.design.name + (b === me ? ' (you)' : ''), score: b.out ? 'splash' : 'standing', me: b === me }));
    const S = me.c.stats;
    let advice = won ? `${me.c.design.name} is the last one standing. The Bonk Bowl Gloom is cracking!` : 'You got bonked into the sea! ' + adviceFor(S, ['balance', 'power']);
    if (!won && me.out) advice += ' Tip: <b>Shift</b> to dash-shove.';
    this.finish(won, rows, advice);
  }
}
