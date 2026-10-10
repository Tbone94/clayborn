// Trailer director: renders a scripted 1080p trailer frame-by-frame (deterministic dt),
// composites toy-box title cards on top, and POSTs JPEG frames + an audio cue sheet
// to the dev server (./captures/trailer). scripts/make-trailer.mjs turns that into an MP4.
import * as THREE from 'three';
import { newDesign, bump, PAINT, w2p } from '../creature/design.js';
import { Creature } from '../creature/creature.js';
import { randomDesign } from '../creature/generator.js';
import { LAYER_COLORS } from '../creature/frames.js';
import { Body } from '../game/body.js';
import { WORLD_TIME, PUSH } from '../world/nature.js';
import { RaceEvent } from '../events/race.js';
import { BonkEvent } from '../events/bonk.js';
import { LeapEvent } from '../events/leap.js';
import { islandH, ZONES } from '../scenes/island.js';

const W = 1920, H = 1080, FPS = 30;
const INK = '#15172b', RED = '#e63b2e', YEL = '#ffd23f', PAPER = '#fbf8f0';
const DRAW_ORDER = ['wings', 'tail', 'legs', 'body', 'limbs', 'head', 'top'];
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const lerp = (a, b, t) => a + (b - a) * t;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- the hero doodle, drawn live in shot 1 ----------
function loop(cx, cy, rx, ry, n = 26, wob = 0.05, seed = 1) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const w = 1 + Math.sin(a * 3 + seed) * wob + Math.sin(a * 5 + seed * 2) * wob * 0.5;
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]);
  }
  pts.push([pts[0][0] + 0.01, pts[0][1] + 0.01]);
  return pts;
}
export const HERO_STROKES = [
  { layer: 'body', size: 12, loop: true, pts: loop(0, 0.86, 0.34, 0.37, 26, 0.06, 1) },
  { layer: 'head', size: 12, loop: true, pts: loop(0.3, 1.4, 0.25, 0.21, 22, 0.05, 2) },
  { layer: 'legs', size: 26, pts: [[0.02, 0.55], [0.0, 0.3], [0.03, 0.08]] },
  { layer: 'legs', size: 18, pts: [[-0.05, 0.07], [0.16, 0.06]] },
  { layer: 'wings', size: 12, loop: true, pts: [[-0.05, 1.0], [-0.35, 1.45], [-0.8, 1.72], [-0.92, 1.5], [-0.7, 1.3], [-0.45, 1.12], [-0.12, 0.98], [-0.06, 1.0]] },
  { layer: 'tail', size: 20, pts: [[-0.28, 0.72], [-0.55, 0.6], [-0.72, 0.7], [-0.8, 0.86]] },
  { layer: 'top', size: 10, loop: true, pts: [[0.22, 1.56], [0.26, 1.82], [0.36, 1.58], [0.22, 1.56]] },
];

export class Director {
  constructor(app) { this.app = app; this.cues = []; }

  cue(type, t) { this.cues.push({ t: +t.toFixed(3), type }); }

  async run({ from = 0, to = Infinity } = {}) {
    const app = this.app, gfx = app.gfx;
    app.mode = 'trailer';
    for (const id of ['title', 'quiz', 'creator', 'hud']) document.getElementById(id).classList.add('hidden');
    await Promise.all(['400 64px "Dela Gothic One"', '400 32px "DotGothic16"', '900 32px "Zen Kaku Gothic New"'].map((f) => document.fonts.load(f)));
    gfx.renderer.setPixelRatio(1); gfx.renderer.setSize(W, H, false); gfx.composer.setSize(W, H);
    gfx.diorama.uniforms.uRes.value.set(W, H);
    this.overlay = Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.ctx = this.overlay.getContext('2d');
    this.makeHero();
    const shots = this.shots();
    const total = Math.round(shots[shots.length - 1].t1 * FPS);
    let cur = null;
    this.island = app.island;
    // keep the shots clean: no floating signboards
    for (const z of app.island.zoneState) z.label.visible = false;
    app.island.easel.traverse((o) => { if (o.isSprite) o.visible = false; });
    for (let f = 0; f < total; f++) {
      const t = f / FPS;
      const shot = shots.find((s) => t >= s.t0 && t < s.t1);
      if (shot !== cur) { cur?.exit?.(); cur = shot; shot.enter(); if (shot.whoosh !== false && f > 0) this.cue('whoosh', t); }
      const lt = t - shot.t0;
      WORLD_TIME.value = 20 + t;
      shot.update(1 / FPS, lt, t);
      if (f < Math.round(from * FPS) || t > to) continue;
      gfx.render(shot.scene(), shot.camera(), t);
      const x = this.ctx;
      x.clearRect(0, 0, W, H);
      x.drawImage(gfx.renderer.domElement, 0, 0, W, H);
      shot.overlay?.(x, lt);
      if (shot.caption) this.caption(x, shot.caption, lt, shot.t1 - shot.t0);
      if (shot.watermark !== false) this.watermark(x);
      const blob = await new Promise((r) => this.overlay.toBlob(r, 'image/jpeg', 0.93));
      await fetch(`/__capture?name=trailer/f${String(f).padStart(5, '0')}.jpg`, { method: 'POST', body: blob });
      window.trailerProgress = `${f + 1}/${total}`;
    }
    cur?.exit?.();
    await fetch('/__capture?name=trailer/cues.json', { method: 'POST', body: JSON.stringify({ fps: FPS, duration: total / FPS, cues: this.cues }) });
    window.trailerProgress = 'done';
  }

  // ---------- assets for the shoot ----------
  makeHero() {
    const d = newDesign('flyer');
    Object.assign(d, { name: 'Blorbo', color: '#ff6fa8', color2: '#ffd23f', pattern: 'spots', finish: 'clay', eyes: 'googly', eyeSize: 1.35, mouth: 'smile' });
    this.heroDesign = d;
    this.hero = new Creature(d, { detail: 44 });
  }

  // paint part of a stroke into the design (same brush as the Mold Lab)
  paintStroke(st, upto) {
    const d = this.heroDesign, x = d.layers[st.layer].getContext('2d');
    const pts = st.pts.map(([a, b]) => w2p(a, b));
    const n = Math.max(1, Math.floor(upto * (pts.length - 1) * 12));
    const seg = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 12; k++) {
      const t = k / 12; seg.push([lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t)]);
    }
    seg.push(pts[pts.length - 1]);
    const L = seg.slice(0, Math.min(seg.length, n + 1));
    x.save(); x.strokeStyle = '#000'; x.lineWidth = st.size * (PAINT / 256); x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); L.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke(); x.restore();
    bump(d, st.layer);
    return L[L.length - 1];
  }
  fillLoop(st) {
    const x = this.heroDesign.layers[st.layer].getContext('2d');
    x.fillStyle = '#000'; x.beginPath();
    st.pts.map(([a, b]) => w2p(a, b)).forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath(); x.fill(); bump(this.heroDesign, st.layer);
  }

  // ---------- overlay drawing ----------
  paperCard(x, px, py, size, tip, alpha = 1) {
    x.save(); x.globalAlpha = alpha;
    x.fillStyle = RED; x.fillRect(px + 14, py + 14, size, size + 56);
    x.fillStyle = INK; x.fillRect(px - 4, py - 4, size + 8, size + 64);
    x.fillStyle = INK; x.fillRect(px, py, size, 52);
    x.fillStyle = PAPER; x.font = '400 30px "Dela Gothic One"'; x.textBaseline = 'middle'; x.fillText('MOLD LAB', px + 18, py + 27);
    x.fillStyle = YEL; x.font = '400 22px "DotGothic16"'; x.fillText('型取り', px + 210, py + 29);
    const oy = py + 56;
    x.fillStyle = PAPER; x.fillRect(px, oy, size, size);
    x.strokeStyle = 'rgba(47,111,223,0.16)'; x.lineWidth = 1;
    for (let g = 0; g <= size; g += size / 20) { x.beginPath(); x.moveTo(px + g, oy); x.lineTo(px + g, oy + size); x.stroke(); x.beginPath(); x.moveTo(px, oy + g); x.lineTo(px + size, oy + g); x.stroke(); }
    const d = this.heroDesign;
    const tmp = this._tmp || (this._tmp = Object.assign(document.createElement('canvas'), { width: PAINT, height: PAINT }));
    const tx = tmp.getContext('2d');
    for (const id of DRAW_ORDER) {
      for (const [col, off] of [[INK, 3.5], [LAYER_COLORS[id], 0]]) {
        tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, PAINT, PAINT); tx.drawImage(d.layers[id], 0, 0);
        tx.globalCompositeOperation = 'source-in'; tx.fillStyle = col; tx.fillRect(0, 0, PAINT, PAINT);
        if (off) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; x.drawImage(tmp, px + Math.cos(a) * off, oy + Math.sin(a) * off, size, size); }
        else x.drawImage(tmp, px, oy, size, size);
      }
    }
    if (tip) {
      const [tx0, ty0] = [px + (tip[0] / PAINT) * size, oy + (tip[1] / PAINT) * size];
      x.fillStyle = INK; x.beginPath(); x.moveTo(tx0, ty0); x.lineTo(tx0 + 22, ty0 - 60); x.lineTo(tx0 + 44, ty0 - 50); x.closePath(); x.fill();
      x.fillStyle = YEL; x.beginPath(); x.moveTo(tx0 + 22, ty0 - 60); x.lineTo(tx0 + 70, ty0 - 160); x.lineTo(tx0 + 92, ty0 - 150); x.lineTo(tx0 + 44, ty0 - 50); x.closePath(); x.fill();
    }
    x.restore();
  }

  caption(x, cap, lt, dur) {
    const inT = ease(lt / 0.28), outT = ease((lt - (dur - 0.18)) / 0.18);
    if (inT <= 0) return;
    const slide = (1 - inT) * -900 + outT * -900;
    let big = cap.size || 66;
    x.save();
    x.font = `400 ${big}px "Dela Gothic One"`;
    let tw = x.measureText(cap.text).width;
    const maxW = W - 360 - (cap.n ? 110 : 0);
    if (tw > maxW) { big = Math.floor(big * maxW / tw); x.font = `400 ${big}px "Dela Gothic One"`; tw = x.measureText(cap.text).width; }
    const bx = (cap.x ?? 90) + slide, by = cap.y ?? 80;
    const bw = tw + (cap.n ? 170 : 90) + (cap.jp ? 130 : 0), bh = big + 46;
    const slab = (dx, dy, col) => { x.save(); x.translate(bx + dx, by + dy); x.transform(1, 0, -0.22, 1, 0, 0); x.fillStyle = col; x.fillRect(0, 0, bw, bh); x.restore(); };
    slab(14, 14, RED); slab(0, 0, INK);
    let cx = bx + 36;
    if (cap.n) { x.fillStyle = YEL; x.fillRect(cx - 8, by + 24, 92, bh - 48); x.fillStyle = INK; x.font = '400 40px "DotGothic16"'; x.textBaseline = 'middle'; x.fillText(cap.n, cx + 6, by + bh / 2 + 2); cx += 110; }
    const pop = 1 + Math.max(0, 1 - lt / 0.3) * 0.25 * Math.sin(lt * 30);
    x.translate(cx, by + bh / 2 + 4); x.scale(pop, pop);
    x.font = `400 ${big}px "Dela Gothic One"`; x.textBaseline = 'middle';
    x.fillStyle = RED; x.fillText(cap.text, 5, 5);
    x.fillStyle = PAPER; x.fillText(cap.text, 0, 0);
    if (cap.jp) { x.font = '400 34px "DotGothic16"'; x.fillStyle = YEL; x.fillText(cap.jp, tw + 28, 4); }
    x.restore();
    if (cap.sub) {
      const s2 = ease((lt - 0.35) / 0.25);
      if (s2 > 0) {
        x.save(); x.globalAlpha = s2;
        x.font = '900 36px "Zen Kaku Gothic New"';
        const sw = x.measureText(cap.sub).width;
        x.fillStyle = YEL; x.fillRect(bx + 60 + slide * 0.3, by + bh + 26, sw + 40, 56);
        x.fillStyle = INK; x.textBaseline = 'middle'; x.fillText(cap.sub, bx + 80 + slide * 0.3, by + bh + 55);
        x.restore();
      }
    }
  }

  subtitle(x, text, lt) {
    const a = ease(lt / 0.3);
    if (a <= 0) return;
    x.save(); x.globalAlpha = a;
    x.font = 'italic 900 44px "Zen Kaku Gothic New"';
    const w = x.measureText(text).width;
    x.fillStyle = 'rgba(21,23,43,0.82)'; x.fillRect(W / 2 - w / 2 - 30, H - 150, w + 60, 76);
    x.fillStyle = PAPER; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(text, W / 2, H - 111);
    x.restore();
  }

  watermark(x) {
    x.save();
    x.font = '400 30px "Dela Gothic One"'; x.textBaseline = 'alphabetic';
    x.fillStyle = 'rgba(21,23,43,0.55)'; x.fillText('CLAYBORN', W - 268, H - 46);
    x.fillStyle = 'rgba(251,248,240,0.9)'; x.fillText('CLAYBORN', W - 270, H - 48);
    x.restore();
  }

  // ---------- helpers for world shots ----------
  heroIntoIsland(x, z, heading = 0) {
    const isl = this.island;
    const b = new Body(this.hero, x, z); b.y = islandH(x, z); b.heading = heading; b.isPlayer = false;
    this.hero.group.scale.set(1, 1, 1); this.hero.tilt.rotation.set(0, 0, 0);
    isl.scene.add(this.hero.group);
    this.heroBody = b;
    return b;
  }

  islandTick(dt) {
    const isl = this.island;
    isl.attract = true;
    isl.update(dt, WORLD_TIME.value);
  }

  // ---------- the cut ----------
  shots() {
    const app = this.app, isl = app.island, studio = app.studio, gfx = app.gfx;
    const D = this;
    const aspect = (cam) => { cam.aspect = W / H; cam.updateProjectionMatrix(); return cam; };
    const strokes = HERO_STROKES;
    const list = [];
    let t = 0;
    const add = (dur, s) => { s.t0 = t; s.t1 = t + dur; t += dur; list.push(s); };

    // 1 · DRAW
    add(6, {
      whoosh: false,
      caption: { n: '1', text: 'Draw a monster' },
      enter() {
        gfx.setLook({ blur: 0, vignette: 0.28, bloom: 0.25, world: false });
        studio.setCreature(D.hero); D.hero.build(D.heroDesign, 40);
        studio.spin = -0.9; studio.camDist = undefined;
        aspect(studio.camera); studio.camera.setViewOffset(W, H, -430, 0, W, H);
        this.done = new Set(); this.tip = null;
      },
      update(dt, lt) {
        const per = 0.62, start = 0.45;
        strokes.forEach((st, i) => {
          const s0 = start + i * per, s1 = s0 + per * 0.8;
          if (lt >= s0 && !this.done.has(i)) {
            const p = Math.min(1, (lt - s0) / (s1 - s0));
            this.tip = D.paintStroke(st, p);
            if (Math.floor(lt * 12) !== this.lastSq) { this.lastSq = Math.floor(lt * 12); D.cue('squish', lt + this.t0); }
            if (p >= 1) {
              this.done.add(i); this.tip = null;
              if (st.loop) D.fillLoop(st);
              D.hero.build(D.heroDesign, 40); studio.popIn(); D.cue('pop', lt + this.t0);
            }
          }
        });
        studio.update(dt, lt);
      },
      overlay(x) { D.paperCard(x, 120, 260, 690, this.tip); },
      scene: () => studio.scene, camera: () => studio.camera,
      exit() { studio.camera.clearViewOffset(); D.hero.build(D.heroDesign, 64); },
    });

    // 2 · IT BECOMES CLAY
    add(3, {
      caption: { n: '2', text: 'It turns into clay and comes to life' },
      enter() { aspect(studio.camera); studio.spin = 0.3; this.poked = false; },
      update(dt, lt) {
        if (lt > 1.1 && !this.poked) { this.poked = true; studio.hopV = 3.4; D.hero.motion.land = 1; D.cue('boing', lt + this.t0); D.cue('babble', lt + this.t0 + 0.1); }
        studio.spinVel = 0; studio.update(dt * (lt < 1 ? 2.2 : 1), lt);
        // push in
        const c = studio.camera; c.position.multiplyScalar(lerp(1, 0.86, ease(lt / 3))); c.position.y = studio.lookAt.y + 0.7; c.lookAt(studio.lookAt.x, studio.lookAt.y + 0.15, studio.lookAt.z);
      },
      scene: () => studio.scene, camera: () => studio.camera,
      exit() { studio.setCreature(null); },
    });

    // 3 · THE VERY SERIOUS ISLAND
    add(4, {
      caption: { n: '3', text: 'Explore the island' },
      enter() {
        gfx.setLook({ blur: 0, vignette: 0.22, bloom: 0.1, world: true });
        aspect(isl.camera); D.cue('drop', this.t0);
        D.heroIntoIsland(SP.x - 6, SP.z + 7, -0.4);
      },
      update(dt, lt) {
        D.islandTick(dt);
        D.heroBody.step(dt, { mx: 0.5, mz: -0.25 }, isl.world); D.hero.update(dt);
        const k = ease(lt / 4);
        const p = new THREE.Vector3().lerpVectors(V(78, 46, 64), V(5, 10, 25), k);
        isl.camera.position.copy(p);
        isl.camera.lookAt(new THREE.Vector3().lerpVectors(V(0, 0, 0), V(D.heroBody.x, 1.5, D.heroBody.z), k));
        isl.lights.follow(V(D.heroBody.x, 0, D.heroBody.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 4 · it does not belong here
    add(3.5, {
      enter() { D.heroIntoIsland(SP.x + Math.cos(-0.9) * 7.5, SP.z + Math.sin(-0.9) * 7.5, 0.6); },
      update(dt, lt) {
        D.islandTick(dt);
        const b = D.heroBody;
        const a = -0.9 + lt * 0.22; // stroll along the trail ring
        const tx = SP.x + Math.cos(a) * 7.5, tz = SP.z + Math.sin(a) * 7.5;
        b.step(dt, { mx: (tx - b.x) * 0.7, mz: (tz - b.z) * 0.7 }, isl.world); D.hero.update(dt);
        PUSH.value.set(b.x, b.z, 1.4, 1);
        const side = V(-Math.sin(b.heading), 0, -Math.cos(b.heading));
        isl.camera.position.set(b.x + side.x * 3.4 - Math.cos(b.heading) * 0.8, b.y + 0.75, b.z + side.z * 3.4 + Math.sin(b.heading) * 0.8);
        isl.camera.lookAt(b.x + Math.cos(b.heading) * 0.6, b.y + 0.55, b.z - Math.sin(b.heading) * 0.6);
        isl.lights.follow(V(b.x, 0, b.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 5 · RACE: big wings glide the chasm
    add(4, {
      caption: { text: 'Race other monsters', sub: 'How you draw it changes how it plays' },
      enter() {
        isl.scene.remove(D.hero.group);
        gfx.setLook({ blur: 0, vignette: 0.24, bloom: 0.1, world: true });
        const ev = this.ev = new RaceEvent(app, isl, D.hero, 0);
        aspect(ev.camera);
        ev.state = 'play'; ev.time = 9;
        ev.player.x = 71; ev.player.z = 0.3; ev.player.y = 2; ev.player.heading = 0;
        ev.rivals.forEach((r, i) => { r.x = 70.5 - i * 0.8; r.z = [-2.4, 2.6, -0.9][i]; r.y = 2; r.ai.skill = i === 0 ? 0.5 : 0.95; });
        ev.player.sync();
        this.j = 0;
      },
      update(dt, lt) {
        const ev = this.ev, P = ev.player, I = app.input;
        I.keys.add('w');
        if (P.x > 79.3 && this.j === 0) { I.pressed.add(' '); I.keys.add(' '); this.j = 1; D.cue('boing', lt + this.t0); }
        if (this.j === 1 && P.vy < -1 && P.x < 87) { I.pressed.add(' '); this.j = 2; D.cue('flap', lt + this.t0); }
        if (P.grounded && this.j === 2 && P.x > 88) I.keys.delete(' ');
        ev.update(dt, WORLD_TIME.value);
        for (const r of ev.rivals) if (r.y < 0.4 && !r._splashed) { r._splashed = true; D.cue('splash', lt + this.t0); }
        I.pressed.clear();
        const c = ev.camera;
        c.position.set(P.x - 2.5, Math.max(P.y, 1) + 2.2, 11.5);
        c.lookAt(P.x + 2.2, Math.max(P.y, 0) + 0.6, 0);
      },
      scene() { return this.ev.scene; }, camera() { return this.ev.camera; },
      exit() { app.input.keys.clear(); this.ev.dispose(); },
    });

    // 6 · BONK BOWL: shove a friend into the sea
    add(3.5, {
      caption: { text: 'Push everyone off the platform' },
      enter() {
        const ev = this.ev = new BonkEvent(app, isl, D.hero, 1);
        aspect(ev.camera);
        ev.state = 'play'; ev.time = 5; ev.ai = () => ({ mx: 0, mz: 0 });
        const P = ev.player; P.x = 3.6; P.z = 0; P.heading = 0; P.y = 2;
        const [v, a, b] = ev.rivals;
        v.x = 7.9; v.z = 0.1; v.heading = Math.PI; a.x = -5; a.z = 4; b.x = -4; b.z = -5;
        ev.all.forEach((o) => { o.y = 2; o.sync(); });
        this.d = false;
      },
      update(dt, lt) {
        const ev = this.ev, I = app.input;
        if (lt > 0.9 && !this.d) { this.d = true; I.pressed.add('shift'); D.cue('whoosh', lt + this.t0); D.cue('bonk', lt + this.t0 + 0.15); }
        ev.update(dt, WORLD_TIME.value);
        I.pressed.clear();
        for (const r of ev.rivals) if (r.out && !r._s) { r._s = true; D.cue('splash', lt + this.t0); }
        const P = ev.player, v = ev.rivals[0];
        const fx = lerp(P.x, v.x, 0.55), fz = lerp(P.z, v.z, 0.55);
        ev.camera.position.set(fx - 3.5, 3.4 + lt * 0.2, fz + 7.5);
        ev.camera.lookAt(fx + 0.8, 1.4, fz);
      },
      scene() { return this.ev.scene; }, camera() { return this.ev.camera; },
      exit() { app.input.keys.clear(); this.ev.dispose(); },
    });

    // 7 · SKY LEAP
    add(4, {
      caption: { text: 'Glide as far as you can', sub: 'Bigger wings, longer glides' },
      enter() {
        const ev = this.ev = new LeapEvent(app, isl, D.hero, 2);
        aspect(ev.camera);
        ev.state = 'play'; ev.time = 3;
        const P = ev.player; P.x = 26; P.z = -2; P.y = 15; P.heading = 0; P.sync();
        ev.rivals.forEach((r) => { r.x = 22; });
        this.j = 0;
      },
      update(dt, lt) {
        const ev = this.ev, P = ev.player, I = app.input;
        I.keys.add('w');
        if (P.x > 33 && this.j === 0) { I.pressed.add(' '); I.keys.add(' '); this.j = 1; D.cue('boing', lt + this.t0); }
        ev.update(dt, WORLD_TIME.value);
        I.pressed.clear();
        const k = ease(lt / 4);
        ev.camera.position.set(P.x - lerp(4, 9, k), P.y + lerp(1.6, 4, k), P.z + lerp(7, 15, k));
        ev.camera.lookAt(P.x + 4, P.y - 0.5, P.z);
      },
      scene() { return this.ev.scene; }, camera() { return this.ev.camera; },
      exit() { app.input.keys.clear(); this.ev.dispose(); },
    });

    // 8 · GARDEN
    add(4.5, {
      caption: { text: 'Every monster you make lives on the island' },
      enter() {
        aspect(isl.camera);
        for (const r of isl.garden.pets()) isl.garden.remove(r);
        const frames = ['roller', 'serpent', 'crawler', 'hopper', 'quad', 'biped', 'roller'];
        this.pets = frames.map((f, i) => {
          const a = (i / frames.length) * 6.28 + 0.4, d = 2.6 + (i % 3) * 1.3;
          return isl.garden.add(randomDesign(900 + i * 31, { frame: f }), { pet: true, x: SP.x + Math.cos(a) * d, z: SP.z + Math.sin(a) * d });
        });
        this.pets[1].state = 'nap'; this.pets[1].timer = 99; this.pets[4].state = 'nap'; this.pets[4].timer = 99;
        this.pets[2].state = 'play'; this.pets[2].timer = 99; this.pets[5].state = 'play'; this.pets[5].timer = 99;
        this.heroR = isl.garden.add(D.hero, { pet: true, x: SP.x + 0.5, z: SP.z + 3.5 });
        this.heroR.state = 'idle'; this.heroR.timer = 99;
        this.petted = 0;
      },
      update(dt, lt) {
        if (lt > 1.2 && this.petted === 0) { this.petted = 1; isl.garden.pet(this.pets[0]); D.cue('chime', lt + this.t0); D.cue('babble', lt + this.t0); }
        if (lt > 2.4 && this.petted === 1) { this.petted = 2; isl.garden.pet(this.heroR); D.cue('babble', lt + this.t0); }
        D.islandTick(dt);
        const k = ease(lt / 4.5);
        isl.camera.position.set(SP.x + lerp(-10, -7.5, k), lerp(3.8, 3.1, k), SP.z + lerp(11.5, 9, k));
        isl.camera.lookAt(SP.x + 0.3, 0.9 + islandH(SP.x, SP.z), SP.z + 1);
        isl.lights.follow(V(SP.x, 0, SP.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 9 · CLEANSE
    add(3, {
      caption: { text: 'Win games to clear the purple goo' },
      enter() { aspect(isl.camera); this.c = 0; },
      update(dt, lt) {
        const zn = ZONES[0], zs = isl.zoneState[0];
        if (lt > 0.4 && !this.c) { this.c = 1; zs.target = 0; D.cue('chime', lt + this.t0); D.cue('fanfare', lt + this.t0 + 0.3); }
        if (this.c && Math.floor(lt * 5) !== this.lastBurst && lt < 2.6) {
          this.lastBurst = Math.floor(lt * 5);
          isl.fx.emit(zn.x, zs.H + 1.5, zn.z, { count: 50, colors: ['#ffe680', '#ffffff', '#f2b134', '#7fc8a9'], speed: 9, up: 9, gravity: 6, size: 0.4, life: 2 });
        }
        D.islandTick(dt * (this.c ? 2.4 : 1));
        const a = zn.ang + Math.PI + 0.5 + lt * 0.08;
        isl.camera.position.set(zn.x + Math.cos(a) * 15, zs.H + 7, zn.z + Math.sin(a) * 15);
        isl.camera.lookAt(zn.x, zs.H + 1.6, zn.z);
        isl.lights.follow(V(zn.x, 0, zn.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 10 · LOGO
    add(4.5, {
      watermark: false,
      enter() { aspect(isl.camera); gfx.setLook({ blur: 1.0, focus: 0.5, band: 0.08, vignette: 0.45, bloom: 0.1, world: true }); D.cue('logo', this.t0 + 0.25); },
      update(dt, lt) {
        D.islandTick(dt);
        const a = 0.9 + lt * 0.05;
        isl.camera.position.set(Math.cos(a) * 58, 26, Math.sin(a) * 58);
        isl.camera.lookAt(0, 0, 0);
        isl.lights.follow(V(0, 0, 0));
      },
      overlay(x, lt) {
        x.save();
        x.fillStyle = `rgba(21,23,43,${0.55 * ease(lt / 0.4)})`; x.fillRect(0, 0, W, H);
        const s = ease((lt - 0.2) / 0.35), pop = 1 + Math.max(0, 1 - (lt - 0.2) / 0.4) * 0.6;
        if (s > 0) {
          x.translate(W / 2, H / 2 - 70); x.scale(pop, pop); x.rotate(-0.04);
          x.textAlign = 'center'; x.textBaseline = 'middle';
          x.font = '400 190px "Dela Gothic One"';
          x.fillStyle = RED; x.fillText('CLAY', 9, -120 + 9);
          x.fillStyle = YEL; x.fillText('CLAY', 0, -120);
          const bw = 640, bh = 200;
          x.save(); x.transform(1, 0, -0.18, 1, 0, 0); x.fillStyle = '#000'; x.fillRect(-bw / 2 + 14, 40 - bh / 2 + 14, bw, bh); x.fillStyle = RED; x.fillRect(-bw / 2, 40 - bh / 2, bw, bh); x.restore();
          x.fillStyle = PAPER; x.fillText('BORN', 0, 46);
        }
        x.restore();
        const s2 = ease((lt - 0.9) / 0.4);
        if (s2 > 0) {
          x.save(); x.globalAlpha = s2; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.font = '900 46px "Zen Kaku Gothic New"'; x.fillStyle = PAPER; x.fillText('Draw a monster. Then play as it.', W / 2, H / 2 + 225);
          x.restore();
        }
        const s3 = ease((lt - 1.5) / 0.35);
        if (s3 > 0) {
          x.save(); x.globalAlpha = s3; x.textAlign = 'center'; x.textBaseline = 'middle';
          const label = 'FREE TO PLAY IN YOUR BROWSER';
          x.font = '900 40px "Zen Kaku Gothic New"';
          const w = x.measureText(label).width + 80;
          x.save(); x.translate(W / 2, H / 2 + 320); x.transform(1, 0, -0.2, 1, 0, 0); x.fillStyle = YEL; x.fillRect(-w / 2, -38, w, 76); x.restore();
          x.fillStyle = INK; x.fillText(label, W / 2, H / 2 + 322);
          x.restore();
        }
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });
    return list;
  }
}

const SP = { x: 0, z: 2 };
