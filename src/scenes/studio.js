// The creator backdrop: a clay turntable in a warm, softly-lit corner.
import * as THREE from 'three';
import { makeClayMaterial } from '../fx/clay.js';
import { babble, sfx } from '../fx/audio.js';
import { QUALITY } from '../fx/quality.js';
import { Particles } from './common.js';

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
    key.shadow.mapSize.setScalar(Math.min(2048, QUALITY.shadowMap));
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
    this.hop = 0; this.hopV = 0; this.walk = false; this.squash = 0;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.left = 0; this.right = 0;
    this.fx = new Particles(s, 400);
  }

  // ---------- the birth: a clay kiln drops over the monster, bakes it, and pops off ----------
  buildKiln() {
    const prof = [];
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI / 2; prof.push(new THREE.Vector2(Math.cos(a) * 1.0, Math.sin(a) * 1.15)); }
    prof.push(new THREE.Vector2(0.18, 1.15), new THREE.Vector2(0.18, 1.32), new THREE.Vector2(0.0, 1.32));
    const mat = new THREE.MeshStandardMaterial({ color: '#b8572f', roughness: 0.85, emissive: '#ff6a1a', emissiveIntensity: 0 });
    const dome = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), mat);
    dome.castShadow = true;
    // a stripe band + little viewing hole, toy-box red/yellow
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.985, 0.045, 8, 48), new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.6 }));
    band.rotation.x = Math.PI / 2; band.position.y = 0.32; dome.add(band);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), new THREE.MeshBasicMaterial({ color: '#ff8a2a' }));
    hole.position.set(0, 0.62, 0.79); hole.rotation.x = -0.65; dome.add(hole);
    const glow = new THREE.PointLight('#ff7a2a', 0, 6, 1.5); glow.position.set(0, 0.8, 1.3); dome.add(glow);
    this.kiln = { dome, mat, hole, glow };
  }

  // returns a promise that resolves once the monster has popped out (tap to hurry it along)
  birth(onPop) {
    if (!this.kiln) this.buildKiln();
    const K = this.kiln, c = this.creature;
    const R = Math.max(0.75, Math.max(c?.size || 1, c?.height || 1) * 0.62 + 0.18);
    K.dome.scale.set(R, R * Math.max(1, (c?.height || 1) / (R * 1.0)) * 0.95, R);
    K.dome.position.set(0, 6, 0); K.dome.rotation.set(0, 0, 0);
    K.mat.emissiveIntensity = 0; K.glow.intensity = 0;
    this.scene.add(K.dome);
    this.autoSpin = false;
    return new Promise((resolve) => { this.kilnRun = { t: 0, popped: false, onPop, resolve, R, landed: false }; });
  }
  hurryBirth() { if (this.kilnRun && this.kilnRun.t < 1.55) this.kilnRun.t = 1.55; }

  updateKiln(dt) {
    const K = this.kiln, k = this.kilnRun; if (!k) return;
    k.t += dt;
    const t = k.t, d = K.dome, H = 0.32; // pedestal top
    if (t < 0.45) { // drop with a heavy bounce
      const u = t / 0.45; d.position.y = H + (1 - u * u) * 6;
    } else if (t < 1.6) {
      if (!k.landed) { k.landed = true; sfx.thud(); sfx.squish(0.5); this.fx.emit(0, H + 0.05, 0, { count: 30, colors: ['#e9d6b8', '#c9a27e'], speed: 3.5, up: 1.2, gravity: 3, size: 0.18, life: 0.7 }); }
      const u = (t - 0.45) / 1.15;
      d.position.y = H + Math.max(0, Math.sin(u * 30) * 0.025 * u);
      d.rotation.z = Math.sin(t * 47) * 0.035 * u; d.rotation.x = Math.cos(t * 39) * 0.03 * u;
      K.mat.emissiveIntensity = u * u * 1.6; K.glow.intensity = u * 9;
      K.hole.material.color.setHSL(0.07, 1, 0.5 + u * 0.35);
      if (Math.random() < dt * 14) this.fx.emit((Math.random() - 0.5) * 0.3, H + k.R * 1.32, 0, { count: 1, colors: ['#d8d0c4', '#bfb6aa'], speed: 0.4, up: 1.6, gravity: -0.8, size: 0.32, life: 1.1 });
      if (Math.random() < dt * 6) sfx.squish(0.6 + u);
    } else if (!k.popped) {
      k.popped = true;
      sfx.boing(0.8); sfx.fanfare(); sfx.sparkle();
      this.fx.emit(0, H + k.R * 0.6, 0, { count: 120, colors: ['#ffe680', '#ff8a2a', '#ffffff', '#ef6f4f', '#ffd23f'], speed: 7, up: 5, gravity: 7, size: 0.22, life: 1.4 });
      this.hopV = 4.2; if (this.creature) this.creature.motion.land = 1;
      k.onPop?.();
    } else {
      const u = (t - 1.6) / 0.9;
      d.position.y = H + u * 9; d.rotation.z = u * 2.4; d.rotation.x = u * 0.9;
      K.mat.emissiveIntensity = Math.max(0, 1.6 - u * 3); K.glow.intensity = Math.max(0, 9 - u * 20);
      if (u >= 1) { this.scene.remove(d); this.kilnRun = null; this.autoSpin = true; k.resolve(); }
    }
  }

  setCreature(c) {
    if (this.creature) this.holder.remove(this.creature.group);
    this.creature = c;
    if (c) { this.holder.add(c.group); c.group.position.set(0, 0, 0); }
  }

  popIn() { this.squash = 1; }

  layout(leftPx, rightPx) { this.setRegion({ x0: leftPx, y0: 0, x1: window.innerWidth - rightPx, y1: window.innerHeight }); }
  // frame the creature inside the screen rect the UI leaves free (eases there in update)
  setRegion(r, instant = false) {
    this.region = r;
    if (instant || !this.view) this.view = this.targetView();
    this.resize();
  }
  targetView() {
    const W = window.innerWidth, H = window.innerHeight;
    const r = this.region || { x0: 0, y0: 0, x1: W, y1: H };
    const rw = Math.max(40, r.x1 - r.x0), rh = Math.max(40, r.y1 - r.y0);
    // at zoom 1 the creature fills roughly half the screen height
    const zoom = Math.min(1, 1.9 * rh / H, 1.8 * rw / H);
    return { ox: W / 2 - (r.x0 + r.x1) / 2, oy: H / 2 - (r.y0 + r.y1) / 2, zoom };
  }
  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.camera.aspect = W / H;
    const v = this.view || this.targetView();
    this.camera.zoom = v.zoom;
    this.camera.setViewOffset(W, H, v.ox, v.oy, W, H);
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
    babble(1.35 / Math.pow(Math.max(0.4, c.stats.raw?.mass || 1), 0.3), 3 + ((Math.random() * 3) | 0), 1, c.design.voice);
    sfx.boing(1.2);
    return true;
  }

  // a square portrait of any creature on the turntable (borrowed from wherever it lives)
  photo(c, size = 800, yaw = -0.5, tight = 0.95) {
    const r = this.app.gfx.renderer, g = c.group;
    const parent = g.parent, pos = g.position.clone(), rot = g.rotation.clone(), scl = g.scale.clone();
    const spin = this.holder.rotation.y, pspin = this.pedestal.rotation.y, tilt = c.tilt.rotation.clone();
    this.holder.add(g); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1); c.tilt.rotation.set(0, 0, 0);
    this.holder.rotation.y = this.pedestal.rotation.y = yaw; // a flattering three-quarter view
    this.holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), ctr = box.getCenter(new THREE.Vector3());
    const rad = Math.max(0.6, box.getSize(new THREE.Vector3()).length() / 2);
    const cv = r.domElement, aspect = cv.width / cv.height;
    const cam = new THREE.PerspectiveCamera(30, aspect, 0.1, 60);
    const fov = aspect >= 1 ? 30 : 2 * Math.atan(Math.tan((15 * Math.PI) / 180) * aspect) * 180 / Math.PI;
    const dist = (rad / Math.sin((fov * Math.PI) / 360)) * tight;
    cam.position.set(ctr.x, ctr.y + dist * 0.28, ctr.z + dist); cam.lookAt(ctr.x, ctr.y - rad * 0.08, ctr.z);
    r.setRenderTarget(null); r.render(this.scene, cam);
    const out = document.createElement('canvas'); out.width = out.height = size;
    const side = Math.min(cv.width, cv.height);
    out.getContext('2d').drawImage(cv, (cv.width - side) / 2, (cv.height - side) / 2, side, side, 0, 0, size, size);
    // put everything back where it was
    if (parent && parent !== this.holder) parent.add(g); else if (!parent) this.holder.remove(g);
    g.position.copy(pos); g.rotation.copy(rot); g.scale.copy(scl); c.tilt.rotation.copy(tilt);
    this.holder.rotation.y = spin; this.pedestal.rotation.y = pspin;
    return out;
  }

  update(dt, t) {
    const c = this.creature;
    this.updateKiln(dt); this.fx.update(dt);
    if (!this.dragging) { this.spinVel *= Math.pow(0.05, dt); this.spin += this.spinVel + (this.autoSpin === false ? 0 : dt * 0.25); }
    if (this.region) {
      const tv = this.targetView(), v = this.view, k = Math.min(1, dt * 8);
      if (Math.abs(tv.ox - v.ox) + Math.abs(tv.oy - v.oy) + Math.abs(tv.zoom - v.zoom) * 100 > 0.5) {
        v.ox += (tv.ox - v.ox) * k; v.oy += (tv.oy - v.oy) * k; v.zoom += (tv.zoom - v.zoom) * k; this.resize();
      }
    }
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
      if (this.camera.aspect < 1 && !this.region) dist *= 0.8 / this.camera.aspect;
      this.camDist = (this.camDist ?? dist) + (dist - (this.camDist ?? dist)) * Math.min(1, dt * 3);
    }
    const d = this.camDist ?? 6;
    this.camera.position.set(0, this.lookAt.y + d * 0.2, d);
    this.camera.lookAt(this.lookAt);
  }
}
