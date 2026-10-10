// The creator backdrop: a clay turntable in a warm, softly-lit corner.
import * as THREE from 'three';
import { makeClayMaterial } from '../fx/clay.js';
import { babble, sfx } from '../fx/audio.js';

export class Studio {
  constructor(app) {
    this.app = app;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#2a2d4c');
    s.fog = new THREE.Fog('#2a2d4c', 8, 20);
    s.environment = app.gfx.envMap; s.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.camera.position.set(0, 1.9, 6.2);
    this.lookAt = new THREE.Vector3(0, 0.9, 0);

    s.add(new THREE.HemisphereLight('#fff1dc', '#3a2f5a', 1.25));
    const key = new THREE.DirectionalLight('#fff3e0', 2.4);
    key.position.set(3.5, 6, 4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    s.add(key);
    const rim = new THREE.DirectionalLight('#7fd8ff', 2.2); rim.position.set(-4, 3, -5); s.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), makeClayMaterial({ color: '#34375c', color2: '#4a4e7a', pattern: 'speckle', seed: 3 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);

    // turntable: soft lathe profile
    const prof = [];
    const R = 1.25, H = 0.32, bev = 0.1;
    prof.push(new THREE.Vector2(0, 0));
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push(new THREE.Vector2(R - bev + Math.sin(a) * bev, bev - Math.cos(a) * bev)); }
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push(new THREE.Vector2(R - bev + Math.cos(a) * bev, H - bev + Math.sin(a) * bev)); }
    prof.push(new THREE.Vector2(0, H));
    this.pedestal = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), makeClayMaterial({ color: '#ffd23f', color2: '#e63b2e', pattern: 'stripes', seed: 2 }));
    this.pedestal.castShadow = this.pedestal.receiveShadow = true;
    s.add(this.pedestal);
    this.holder = new THREE.Group(); this.holder.position.y = H; s.add(this.holder);

    // scattered clay pebbles & sculpting tools for the vibe
    const pebMat = (c) => makeClayMaterial({ color: c, pattern: 'solid' });
    const cols = ['#e63b2e', '#ffd23f', '#2f6fdf', '#7b4fe0', '#ff6fa8', '#11a39a'];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4, r = 2.2 + Math.random() * 3.5;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.18, 24, 16), pebMat(cols[i % cols.length]));
      m.scale.y = 0.55 + Math.random() * 0.3;
      m.position.set(Math.cos(a) * r, m.scale.y * 0.12, Math.sin(a) * r - 1.5);
      m.castShadow = true; m.receiveShadow = true; s.add(m);
    }

    this.spin = 0.4; this.spinVel = 0; this.creature = null;
    this.hop = 0; this.hopV = 0; this.walk = false;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.left = 0; this.right = 0;
  }

  setCreature(c) {
    if (this.creature) this.holder.remove(this.creature.group);
    this.creature = c;
    if (c) { this.holder.add(c.group); c.group.position.set(0, 0, 0); }
  }

  popIn() { this.squash = 1; }

  layout(leftPx, rightPx) { this.left = leftPx; this.right = rightPx; this.resize(); }
  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.camera.aspect = W / H;
    const narrow = W <= 900;
    if (narrow) {
      // creature sits in the strip between the top bar and the paper sheet
      this.camera.setViewOffset(W, H, 0, H * 0.22, W, H);
    } else {
      const cx = (this.left + (W - this.right)) / 2;
      this.camera.setViewOffset(W, H, W / 2 - cx, 0, W, H);
    }
    this.camera.updateProjectionMatrix();
  }

  drag(dx) { this.spinVel = dx * 0.012; this.spin += dx * 0.012; }

  poke(clientX, clientY) {
    if (!this.creature?.mesh) return false;
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObject(this.creature.mesh, false)[0];
    if (!hit) return false;
    this.hopV = 3.2; this.creature.motion.land = 1;
    const c = this.creature;
    babble(1.35 / Math.pow(Math.max(0.4, c.stats.raw?.mass || 1), 0.3), 3 + ((Math.random() * 3) | 0), 1);
    sfx.boing(1.2);
    return true;
  }

  update(dt, t) {
    const c = this.creature;
    if (!this.dragging) { this.spinVel *= Math.pow(0.05, dt); this.spin += this.spinVel + dt * 0.25; }
    this.holder.rotation.y = this.spin;
    this.pedestal.rotation.y = this.spin;
    // poke hop
    this.hopV -= 12 * dt; this.hop += this.hopV * dt;
    if (this.hop < 0) { if (this.hopV < -1.5 && c) { c.motion.land = 0.8; sfx.thud(); } this.hop = 0; this.hopV = 0; }
    if (this.squash) { this.squash = Math.max(0, this.squash - dt * 2.5); }
    if (c) {
      c.group.position.y = this.hop;
      const sq = Math.sin(this.squash * Math.PI * 3) * this.squash * 0.18;
      c.group.scale.set(1 + sq, 1 - sq, 1 + sq);
      c.motion.speed = this.walk ? 2.2 : 0;
      c.motion.grounded = this.hop <= 0.001;
      c.update(dt);
      // frame the creature
      const h = c.height || 1.2;
      const target = 0.32 + h * 0.5;
      this.lookAt.y += (target - this.lookAt.y) * Math.min(1, dt * 3);
      let dist = 3.8 + Math.max(h, (c.size || 1) * 0.8) * 1.6;
      if (this.camera.aspect < 1) dist *= 0.8 / this.camera.aspect;
      this.camDist = (this.camDist ?? dist) + (dist - (this.camDist ?? dist)) * Math.min(1, dt * 3);
    }
    const d = this.camDist ?? 6;
    this.camera.position.set(0, this.lookAt.y + d * 0.2, d);
    this.camera.lookAt(this.lookAt);
  }
}
