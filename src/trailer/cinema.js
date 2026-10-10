// "Prestige" trailer: the same deterministic frame renderer as director.js, dressed as a
// very serious film. Letterbox, teal/orange grade, grain, gold serif cards, slow motion, and
// deadpan subtitles in the bottom bar that undercut every one of them. At the end the pretence
// collapses into the toy-box logo. Frames + cues.json land in ./captures/cinema;
// scripts/make-cinema.mjs scores it and writes clayborn-cinema-trailer.mp4.
import * as THREE from 'three';
import { Director, HERO_STROKES } from './director.js';
import { randomDesign } from '../creature/generator.js';
import { WORLD_TIME, PUSH } from '../world/nature.js';
import { RaceEvent } from '../events/race.js';
import { BonkEvent } from '../events/bonk.js';
import { LeapEvent } from '../events/leap.js';
import { islandH, ZONES } from '../scenes/island.js';
import { newAddon, restPointFromHit, loadAddonModels } from '../creature/addons.js';

const W = 1920, H = 1080, FPS = 30;
const BAR = Math.round((H - W / 2.39) / 2); // 2.39:1 scope letterbox
const INK = '#15172b', RED = '#e63b2e', YEL = '#ffd23f', PAPER = '#fbf8f0';
const SERIF = '"Cinzel"', ITAL = '"Cormorant Garamond"';
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SP = { x: 0, z: 2 };

export class Cinema extends Director {
  async run({ from = 0, to = Infinity, dir = 'cinema', pick = null, ranges = null, makeover = false } = {}) {
    const picks = pick && new Set(pick.map((s) => Math.round(s * FPS)));
    const app = this.app, gfx = app.gfx;
    app.mode = 'trailer';
    for (const id of ['title', 'quiz', 'creator', 'hud']) document.getElementById(id).classList.add('hidden');
    if (!document.getElementById('cinema-fonts')) {
      document.head.appendChild(Object.assign(document.createElement('link'), {
        id: 'cinema-fonts', rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Cormorant+Garamond:ital,wght@1,500;1,600&display=swap',
      }));
    }
    await new Promise((r) => setTimeout(r, 400));
    await Promise.all(['400 64px "Dela Gothic One"', '900 32px "Zen Kaku Gothic New"', '700 64px "Cinzel"', '900 64px "Cinzel"', '500 64px "Cinzel"', 'italic 500 40px "Cormorant Garamond"', 'italic 600 40px "Cormorant Garamond"'].map((f) => document.fonts.load(f)));
    gfx.renderer.setPixelRatio(1); gfx.renderer.setSize(W, H, false); gfx.composer.setSize(W, H);
    gfx.diorama.uniforms.uRes.value.set(W, H);
    this.overlay = Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.ctx = this.overlay.getContext('2d');
    this.makeGrain();
    this.makeHero();
    const shots = makeover ? this.makeoverShots() : this.shots();
    const total = Math.round(shots[shots.length - 1].t1 * FPS);
    for (const sh of shots) await sh.prepare?.();
    this.island = app.island;
    for (const z of app.island.zoneState) z.label.visible = false;
    app.island.easel.traverse((o) => { if (o.isSprite) o.visible = false; });
    // an empty island until the family shot (saved pets would wander into frame)
    for (const r of app.island.garden.pets()) app.island.garden.remove(r);
    let cur = null, worldT = 20;
    for (let f = 0; f < total; f++) {
      const t = f / FPS;
      const shot = shots.find((s) => t >= s.t0 && t < s.t1);
      if (shot !== cur) { cur?.exit?.(); cur = shot; shot.enter?.(); if (shot.title) this.cue(shot.boom || 'boom', t + (shot.title.at ?? 0.15)); for (const sb of shot.subs || []) this.cue('snark', t + sb.at); }
      const lt = t - shot.t0, dur = shot.t1 - shot.t0;
      const dt = (1 / FPS) * (shot.speed ? shot.speed.call(shot, lt) : 1);
      worldT += dt; WORLD_TIME.value = worldT;
      shot.update?.(dt, lt, t);
      if (picks ? !picks.has(f) : ranges ? !ranges.some(([a, b]) => f >= Math.round(a * FPS) && f < Math.round(b * FPS)) : f < Math.round(from * FPS) || t > to) continue;
      const name = picks ? `p${t.toFixed(1)}` : `f${String(f).padStart(5, '0')}`;
      const x = this.ctx;
      x.save();
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      if (shot.scene) {
        gfx.render(shot.scene(), shot.camera(), t);
        x.filter = shot.grade || 'contrast(1.08) saturate(1.06)';
        x.drawImage(gfx.renderer.domElement, 0, 0, W, H);
        x.filter = 'none';
        if (shot.tint !== false) this.tealOrange(x);
      }
      x.restore();
      shot.overlay?.(x, lt, dur);
      this.grain(x, f, shot.scene ? 0.07 : 0.035);
      const fade = Math.max(shot.fadeIn ? 1 - lt / shot.fadeIn : 0, shot.fadeOut ? 1 - (dur - lt) / shot.fadeOut : 0);
      if (fade > 0) { x.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`; x.fillRect(0, 0, W, H); }
      const bars = shot.bars ? shot.bars(lt) : 1;
      if (bars > 0) { x.fillStyle = '#000'; x.fillRect(0, 0, W, BAR * bars); x.fillRect(0, H - BAR * bars, W, BAR * bars); }
      if (shot.title) this.title(x, shot.title, lt, dur);
      for (const s of shot.subs || []) this.snark(x, s, lt);
      const blob = await new Promise((r) => this.overlay.toBlob(r, 'image/jpeg', 0.93));
      await fetch(`/__capture?name=${dir}/${name}.jpg`, { method: 'POST', body: blob });
      window.trailerProgress = `${f + 1}/${total}`;
    }
    cur?.exit?.();
    await fetch(`/__capture?name=${dir}/cues.json`, { method: 'POST', body: JSON.stringify({ fps: FPS, duration: total / FPS, cues: this.cues }) });
    window.trailerProgress = 'done';
  }

  // ---------- the look ----------
  makeGrain() {
    this.grains = [0, 1, 2, 3].map(() => {
      const c = Object.assign(document.createElement('canvas'), { width: 480, height: 270 });
      const g = c.getContext('2d'), img = g.createImageData(480, 270);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      return c;
    });
  }
  grain(x, f, a) {
    x.save(); x.globalAlpha = a; x.globalCompositeOperation = 'overlay'; x.imageSmoothingEnabled = false;
    x.drawImage(this.grains[f % 4], 0, 0, W, H); x.restore();
  }
  tealOrange(x) {
    x.save();
    x.globalCompositeOperation = 'soft-light';
    const g = x.createRadialGradient(W / 2, H * 0.45, 80, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, 'rgba(255,170,90,0.55)'); g.addColorStop(0.55, 'rgba(255,140,80,0.12)'); g.addColorStop(1, 'rgba(0,70,95,0.75)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'multiply';
    const v = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.66);
    v.addColorStop(0, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(40,40,50,1)');
    x.fillStyle = v; x.fillRect(0, 0, W, H);
    x.restore();
  }

  // ---------- type ----------
  // the serious part: wide-tracked serif, slow push, soft fade
  title(x, ti, lt, dur) {
    const at = ti.at ?? 0.15, until = ti.until ?? dur - 0.15;
    const a = Math.min(sm((lt - at) / 0.45), 1 - sm((lt - (until - 0.35)) / 0.35));
    if (a <= 0) return;
    const lines = Array.isArray(ti.text) ? ti.text : [ti.text];
    const size = ti.size || 64, y0 = ti.y ?? (H - BAR - 120);
    const push = 1 + 0.035 * ((lt - at) / Math.max(1, until - at));
    x.save(); x.globalAlpha = a * 0.55;
    const hh = size * (lines.length * 1.25 + 1.6), sg = x.createLinearGradient(0, y0 - hh / 2, 0, y0 + hh / 2);
    sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.5, 'rgba(0,0,0,0.85)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = sg; x.fillRect(0, y0 - hh / 2, W, hh);
    x.restore();
    x.save(); x.globalAlpha = a;
    x.translate(W / 2, y0); x.scale(push, push);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      const s = i === 0 && lines.length > 1 && ti.small ? size * 0.5 : size;
      x.font = `${ti.weight || 700} ${s}px ${SERIF}`; x.letterSpacing = `${Math.round(s * 0.16)}px`;
      const yy = (i - (lines.length - 1) / 2) * size * 1.25;
      x.shadowColor = 'rgba(0,0,0,0.75)'; x.shadowBlur = 24;
      x.fillStyle = ti.color || '#f4efe4'; x.fillText(ln, s * 0.08, yy);
    });
    x.restore();
  }
  // the honest part: the punchline gets its own beat, same spot and size as the card,
  // gold italic so it reads as a reply, popping in while the music dips under it
  snark(x, s, lt) {
    const a = Math.min(sm((lt - s.at) / 0.18), s.until ? 1 - sm((lt - s.until) / 0.25) : 1);
    if (a <= 0) return;
    const size = s.size || 70, y = s.y ?? (H - BAR - 120), cx = s.x ?? W / 2;
    const pop = 1 + 0.1 * (1 - ease((lt - s.at) / 0.22));
    x.save(); x.globalAlpha = a * 0.6;
    const hh = size * 2.4, g = x.createLinearGradient(0, y - hh / 2, 0, y + hh / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, y - hh / 2, W, hh);
    x.restore();
    x.save(); x.globalAlpha = a;
    x.translate(cx, y); x.scale(pop, pop);
    x.font = `italic 600 ${size}px ${ITAL}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,0.85)'; x.shadowBlur = 22;
    x.fillStyle = s.color || '#ffd86b';
    x.fillText(s.text, 0, 0);
    x.restore();
  }
  card(x, lines, lt, dur, { size = 58, small = 30 } = {}) {
    const a = Math.min(sm((lt - 0.2) / 0.5), 1 - sm((lt - (dur - 0.45)) / 0.4));
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.textAlign = 'center'; x.textBaseline = 'middle';
    const push = 1 + 0.03 * lt / dur;
    x.translate(W / 2, H / 2); x.scale(push, push);
    lines.forEach(([txt, big], i) => {
      const s = big ? size : small;
      x.font = `${big ? 700 : 500} ${s}px ${SERIF}`; x.letterSpacing = `${Math.round(s * (big ? 0.16 : 0.4))}px`;
      x.fillStyle = big ? '#f4efe4' : '#b9ad92';
      x.fillText(txt, s * 0.1, (i - (lines.length - 1) / 2) * 80);
    });
    x.restore();
  }
  laurel(x, cx, cy, R, alpha) {
    x.save(); x.globalAlpha = alpha; x.fillStyle = '#d9b45a'; x.strokeStyle = '#d9b45a'; x.lineWidth = 3;
    for (const sg of [-1, 1]) {
      const at = (deg) => { const th = deg * Math.PI / 180; return [cx + sg * Math.sin(th) * R, cy + Math.cos(th) * R, Math.atan2(-Math.sin(th), sg * Math.cos(th))]; };
      x.beginPath();
      for (let i = 0; i <= 30; i++) { const [px, py] = at(lerp(20, 150, i / 30)); i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.stroke();
      for (let i = 0; i < 12; i++) {
        const [px, py, ang] = at(lerp(24, 150, i / 11));
        const sc = lerp(1, 0.7, i / 11);
        for (const side of [-1, 1]) {
          x.save(); x.translate(px, py); x.rotate(ang + side * 0.6 * sg);
          x.beginPath(); x.ellipse(15 * sc, 0, 17 * sc, 6.5 * sc, 0, 0, Math.PI * 2); x.fill(); x.restore();
        }
      }
    }
    x.restore();
  }

  // toy-box label that slams in, like the game's own UI ("+ CHICKEN FEET")
  tag(x, text, lt, i) {
    const a = ease(lt / 0.16);
    if (a <= 0) return;
    const y = H - BAR - 70 - i * 64, slide = (1 - a) * -380;
    x.save(); x.globalAlpha = Math.min(1, a * 1.4);
    x.font = '400 40px "Dela Gothic One"';
    const w = x.measureText(text).width + 56;
    x.translate(90 + slide, y); x.transform(1, 0, -0.2, 1, 0, 0);
    x.fillStyle = RED; x.fillRect(8, 8, w, 54); x.fillStyle = INK; x.fillRect(0, 0, w, 54);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = YEL; x.textBaseline = 'middle'; x.fillText(text, 90 + slide + 22, y + 29);
    x.restore();
  }

  // the makeover, rendered on its own and spliced in after "behold."
  makeoverShots() {
    const app = this.app, studio = app.studio, gfx = app.gfx, D = this;
    const list = [];
    const LOOKS = [
      { color: '#9bc53d', color2: '#2a2d4c', pattern: 'stripes', finish: 'clay', label: 'PAINT: STRIPES' },
      { color: '#ffd23f', color2: '#e63b2e', pattern: 'stars', finish: 'vinyl', label: 'PAINT: STARS' },
      { color: '#4fb3e8', color2: '#fbf8f0', pattern: 'lava', finish: 'jelly', label: 'FINISH: JELLY' },
      { color: '#7b4fe0', color2: '#ffd23f', pattern: 'spots', finish: 'felt', label: 'FINISH: FELT' },
    ];
    // where each piece lands: an anchor inside the body (rest space) + the direction to shoot in from
    const PIECES = [
      { type: 'horn', at: [0.3, 1.42, 0.1], dir: [-0.1, 0.75, 0.65], label: '+ HORNS' },
      { type: 'eye', at: [0.05, 0.9, 0], dir: [1, 0.05, 0.25], label: '+ EXTRA EYE', s: 1.5 },
      { type: 'beanie', at: [0.3, 1.4, 0], dir: [0, 1, 0], label: '+ PROPELLER HAT', s: 1.15 },
      { type: 'handlebar', at: [0.32, 1.33, 0], dir: [1, -0.25, 0], label: '+ MUSTACHE', s: 1.2 },
      { type: 'chickenfoot', at: [0.0, 0.8, 0], dir: [0.1, -0.2, 1], label: '+ CHICKEN FEET', s: 1.25 },
      { type: 'pixelshades', at: [0.3, 1.42, 0], dir: [1, 0.12, 0], label: '+ SHADES', s: 1.1 },
    ];
    const t0 = 0.35, swap = 0.42, pieceAt = t0 + LOOKS.length * swap + 0.25, gap = 0.42;
    const dur = pieceAt + PIECES.length * gap + 1.7;
    list.push({
      t0: 0, t1: dur, tint: false, grade: 'contrast(1.06)',
      title: { text: 'EVERY HERO NEEDS A LOOK', at: 0.1, until: pieceAt - 0.1, y: BAR + 110 },
      subs: [{ text: 'this is the look', at: dur - 1.35 }],
      async prepare() { await loadAddonModels(); },
      enter() {
        gfx.setLook({ blur: 0, vignette: 0.4, bloom: 0.25, world: false });
        const d = D.heroDesign;
        for (const st of HERO_STROKES) { D.paintStroke(st, 1); if (st.loop) D.fillLoop(st); }
        d.addons = [];
        D.hero.build(d, 64);
        studio.setCreature(D.hero); studio.spinVel = 0; studio.spin = -1.05; studio.camDist = undefined;
        studio.camera.clearViewOffset(); studio.camera.zoom = 1; studio.region = null; studio.view = null;
        studio.camera.aspect = W / H; studio.camera.updateProjectionMatrix();
        studio.lookAt.y = 0.32 + (D.hero.height || 1.2) * 0.5;
        studio.update(0.016, 0); D.hero.group.updateMatrixWorld(true);
        // aim every piece now, while the pose is known
        const proxy = D.hero.proxy, ray = new THREE.Raycaster();
        this.pieces = PIECES.map((pc) => {
          const dir = new THREE.Vector3(...pc.dir).normalize();
          const at = proxy.localToWorld(new THREE.Vector3(...pc.at));
          const dw = dir.clone().transformDirection(proxy.matrixWorld);
          ray.set(at.clone().addScaledVector(dw, 3), dw.clone().negate());
          const hit = ray.intersectObject(proxy, false)[0];
          if (!hit) return null;
          const { p, n } = restPointFromHit(proxy, hit);
          const a = newAddon(pc.type, p, n); a.s *= pc.s || 1;
          return { a, label: pc.label };
        });
        this.looks = 0; this.added = 0; this.tags = [];
      },
      update(dt, lt) {
        const d = D.heroDesign;
        if (this.looks < LOOKS.length && lt >= t0 + this.looks * swap) {
          const L = LOOKS[this.looks++];
          Object.assign(d, { color: L.color, color2: L.color2, pattern: L.pattern, finish: L.finish });
          D.hero.setLook(d); D.hero.rebuildFace(d); studio.popIn();
          this.tags = [{ text: L.label, t: lt }];
          D.cue('swap', lt);
        }
        if (this.added < this.pieces.length && lt >= pieceAt + this.added * gap) {
          const pc = this.pieces[this.added++];
          if (pc) {
            d.addons.push(pc.a); D.hero.rebuildAddons(d); studio.popIn(); D.hero.motion.land = 0.6;
            this.tags = [...this.tags.filter((g) => !g.text.startsWith('PAINT') && !g.text.startsWith('FINISH')), { text: pc.label, t: lt }].slice(-3);
            D.cue('pop', lt); if (this.added % 2) D.cue('babble', lt + 0.05);
          }
        }
        if (lt > dur - 1.5 && !this.hopped) { this.hopped = true; studio.hopV = 3.2; D.hero.motion.land = 1; D.cue('boing', lt); }
        studio.spin = -1.05 + lt * 0.09 - dt * 0.25; studio.spinVel = 0;
        studio.update(dt, lt);
        const c = studio.camera, ly = studio.lookAt.y;
        c.position.set(0.35, ly + 0.45, 5.3); c.lookAt(0.05, ly + 0.2, 0);
      },
      overlay(x, lt) { (this.tags || []).forEach((g, i, arr) => { if (lt < dur - 1.45) D.tag(x, g.text, lt - g.t, arr.length - 1 - i); }); },
      scene: () => studio.scene, camera: () => studio.camera,
    });
    return list;
  }

  // ---------- the cut ----------
  shots() {
    const app = this.app, isl = app.island, studio = app.studio, gfx = app.gfx;
    const D = this;
    const aspect = (cam) => { cam.aspect = W / H; cam.updateProjectionMatrix(); return cam; };
    const list = [];
    let t = 0;
    const add = (dur, s) => { s.t0 = t; s.t1 = t + dur; t += dur; list.push(s); };
    const worldLook = (o = {}) => gfx.setLook({ blur: 0, vignette: 0.15, bloom: 0.18, world: true, ...o });

    // 0 · cold open
    add(2.8, {
      enter() { D.cue('drone', this.t0); D.cue('boomSoft', this.t0 + 0.25); },
      overlay(x, lt, dur) { D.card(x, [['FROM THE MIND OF', false], ['SOMEONE WHO CANNOT DRAW', true]], lt, dur); },
    });

    // 1 · the world
    add(4.8, {
      boom: 'boomSoft', fadeIn: 0.8,
      title: { text: 'IN A WORLD OF BREATHTAKING BEAUTY', at: 0.7 },
      enter() { worldLook(); aspect(isl.camera); },
      update(dt, lt) {
        D.islandTick(dt);
        const k = sm(lt / 4.8);
        isl.camera.position.copy(new THREE.Vector3().lerpVectors(V(96, 16, 58), V(64, 22, 40), k));
        isl.camera.lookAt(new THREE.Vector3().lerpVectors(V(10, 5, 4), V(4, 3, 2), k));
        isl.lights.follow(V(20, 0, 10));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 2 · grass macro, sun in the lens
    add(2.4, {
      enter() { worldLook({ bloom: 0.35 }); aspect(isl.camera); },
      update(dt, lt) {
        D.islandTick(dt);
        const a = -0.55 + lt * 0.035, r = 9.2;
        const px = SP.x + Math.cos(a) * r, pz = SP.z + Math.sin(a) * r;
        isl.camera.position.set(px, islandH(px, pz) + 0.32, pz);
        isl.camera.lookAt(px + Math.cos(a + 1.2) * 6, islandH(px, pz) + 0.9, pz + Math.sin(a + 1.2) * 6);
        isl.lights.follow(V(px, 0, pz));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 3 · black card
    add(2.2, {
      enter() { D.cue('boomSoft', this.t0 + 0.2); },
      overlay(x, lt, dur) { D.card(x, [['ONE VISIONARY', false], ['DARED TO CREATE LIFE', true]], lt, dur); },
    });

    // 4 · the act of creation (badly)
    add(6.2, {
      fadeIn: 0.4, tint: false, grade: 'contrast(1.05) saturate(1.0)',
      subs: [{ text: 'using a trackpad.', at: 0.5, until: 2.4, x: 1350 }, { text: 'on the first try.', at: 2.7, until: 4.4, x: 1350 }, { text: 'it shows.', at: 4.7, x: 1350 }],
      enter() {
        gfx.setLook({ blur: 0, vignette: 0.4, bloom: 0.25, world: false });
        studio.setCreature(D.hero); D.hero.build(D.heroDesign, 40);
        studio.spin = -0.9; studio.camDist = undefined;
        aspect(studio.camera); studio.camera.setViewOffset(W, H, -380, 0, W, H);
        this.done = new Set(); this.tip = null;
        D.cue('strings', this.t0);
      },
      update(dt, lt) {
        const per = 0.72, start = 0.45;
        HERO_STROKES.forEach((st, i) => {
          const s0 = start + i * per, s1 = s0 + per * 0.8;
          if (lt >= s0 && !this.done.has(i)) {
            const p = Math.min(1, (lt - s0) / (s1 - s0));
            this.tip = D.paintStroke(st, p);
            if (Math.floor(lt * 10) !== this.lastSq) { this.lastSq = Math.floor(lt * 10); D.cue('squish', lt + this.t0); }
            if (p >= 1) {
              this.done.add(i); this.tip = null;
              if (st.loop) D.fillLoop(st);
              D.hero.build(D.heroDesign, 40); studio.popIn(); D.cue('pop', lt + this.t0);
            }
          }
        });
        studio.update(dt, lt);
      },
      overlay(x) { D.paperCard(x, 170, BAR + 40, 600, this.tip); },
      scene: () => studio.scene, camera: () => studio.camera,
      exit() { studio.camera.clearViewOffset(); D.hero.build(D.heroDesign, 64); },
    });

    // 5 · behold (the music dies)
    add(3.4, {
      tint: false, grade: 'contrast(1.06)',
      subs: [{ text: 'behold.', at: 1.15, size: 84 }],
      enter() { aspect(studio.camera); studio.spinVel = 0; this.hopped = false; D.cue('silence', this.t0 + 1.0); D.cue('cricket', this.t0 + 1.5); },
      update(dt, lt) {
        // turn to face the lens
        const target = -Math.PI / 2;
        const s = lerp(studio.spin, target, Math.min(1, dt * 2.2 + (lt < 1.2 ? 0 : 0.2)));
        studio.spin = s - dt * 0.25; studio.spinVel = 0;
        if (lt > 2.35 && !this.hopped) { this.hopped = true; studio.hopV = 3.0; D.hero.motion.land = 1; D.cue('boing', lt + this.t0); D.cue('babble', lt + this.t0 + 0.08); }
        studio.update(dt, lt);
        const c = studio.camera, d = lerp(6.2, 3.3, sm(lt / 3.4)), ly = studio.lookAt.y + lerp(0.1, 0.35, sm(lt / 3.4));
        c.position.set(0.25, ly + d * 0.08, d); c.lookAt(0.12, ly, 0);
      },
      scene: () => studio.scene, camera: () => studio.camera,
      exit() { studio.setCreature(null); },
    });

    // 6 · black. then the horn.
    add(0.7, {});

    // 7 · slow-motion stroll, hero angle
    add(4.7, {
      title: { text: 'HE WAS NOT MEANT FOR THIS WORLD', at: 0.35 },
      speed: () => 0.42,
      enter() {
        D.cue('braam', this.t0);
        worldLook({ bloom: 0.25 }); aspect(isl.camera);
        D.heroIntoIsland(SP.x + Math.cos(-0.9) * 7.5, SP.z + Math.sin(-0.9) * 7.5, 0.6);
        // the island's wandering locals are random per load; keep them out of the hero shot
        this.locals = isl.garden.roamers.filter((r) => !r.pet);
        for (const r of this.locals) r.c.group.visible = false;
      },
      exit() { for (const r of this.locals) r.c.group.visible = true; },
      update(dt, lt) {
        D.islandTick(dt);
        const b = D.heroBody;
        this.a = (this.a ?? -0.9) + dt * 0.24;
        const tx = SP.x + Math.cos(this.a) * 7.5, tz = SP.z + Math.sin(this.a) * 7.5;
        b.step(dt, { mx: (tx - b.x) * 0.7, mz: (tz - b.z) * 0.7 }, isl.world); D.hero.update(dt);
        PUSH.value.set(b.x, b.z, 1.4, 1);
        const side = V(-Math.sin(b.heading), 0, -Math.cos(b.heading));
        const fw = V(Math.cos(b.heading), 0, -Math.sin(b.heading));
        const k = sm(lt / 4.7);
        isl.camera.position.set(b.x + side.x * lerp(2.6, 3.1, k) + fw.x * 1.2, b.y + 0.32, b.z + side.z * lerp(2.6, 3.1, k) + fw.z * 1.2);
        isl.camera.lookAt(b.x + fw.x * 0.3, b.y + 0.95, b.z + fw.z * 0.3);
        isl.lights.follow(V(b.x, 0, b.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 8 · the chasm
    add(4.6, {
      title: { text: 'THEY SAID HE WOULD NEVER FLY', at: 0.15, until: 2.5 },
      subs: [{ text: 'they were technically correct', at: 2.7 }],
      speed() { return this.j >= 1 && !this.ev.player.grounded ? 0.5 : 1; },
      enter() {
        isl.scene.remove(D.hero.group);
        worldLook();
        const ev = this.ev = new RaceEvent(app, isl, D.hero, 0);
        aspect(ev.camera);
        ev.state = 'play'; ev.time = 9;
        ev.player.x = 69; ev.player.z = 0.3; ev.player.y = 2; ev.player.heading = 0;
        ev.rivals.forEach((r, i) => { r.x = 68.5 - i * 0.8; r.z = [-2.4, 2.6, -0.9][i]; r.y = 2; r.ai.skill = i === 0 ? 0.5 : 0.95; });
        ev.player.sync();
        this.j = 0;
      },
      update(dt, lt) {
        const ev = this.ev, P = ev.player, I = app.input;
        I.keys.add('w');
        if (P.x > 79.3 && this.j === 0) { I.pressed.add(' '); I.keys.add(' '); this.j = 1; D.cue('boing', lt + this.t0); D.cue('slowmo', lt + this.t0); }
        if (this.j === 1 && P.vy < -1 && P.x < 87) { I.pressed.add(' '); this.j = 2; D.cue('flap', lt + this.t0); }
        if (P.grounded && this.j === 2 && P.x > 88) I.keys.delete(' ');
        ev.update(dt, WORLD_TIME.value);
        for (const r of ev.rivals) if (r.y < 0.4 && !r._splashed) { r._splashed = true; D.cue('splash', lt + this.t0); }
        I.pressed.clear();
        const c = ev.camera;
        c.position.set(P.x - 3.2, Math.max(P.y, 1) + 1.4, 9.5);
        c.lookAt(P.x + 2.4, Math.max(P.y, 0) + 0.9, 0);
      },
      scene() { return this.ev.scene; }, camera() { return this.ev.camera; },
      exit() { app.input.keys.clear(); this.ev.dispose(); },
    });

    // 9 · bonk, with a 300fps impact
    add(4.2, {
      title: { text: 'HE WILL DO WHAT MUST BE DONE', at: 0.1, until: 1.9 },
      subs: [{ text: '(push a guy)', at: 2.1 }],
      // 300fps the moment they touch
      speed(lt) { return this.hit != null && lt - this.hit < 1.0 ? 0.2 : 1; },
      enter() {
        const ev = this.ev = new BonkEvent(app, isl, D.hero, 1);
        aspect(ev.camera);
        ev.state = 'play'; ev.time = 5; ev.ai = () => ({ mx: 0, mz: 0 });
        const P = ev.player; P.x = 3.6; P.z = 0; P.heading = 0; P.y = 2;
        const [v, a, b] = ev.rivals;
        v.x = 7.9; v.z = 0.1; v.heading = Math.PI; a.x = -5; a.z = 4; b.x = -4; b.z = -5;
        ev.all.forEach((o) => { o.y = 2; o.sync(); });
        this.d = false; this.hit = null;
      },
      update(dt, lt) {
        const ev = this.ev, I = app.input;
        if (lt > 0.5 && !this.d) { this.d = true; I.pressed.add('shift'); D.cue('whoosh', lt + this.t0); }
        ev.update(dt, WORLD_TIME.value);
        if (this.hit == null && Math.hypot(ev.player.x - ev.rivals[0].x, ev.player.z - ev.rivals[0].z) < 1.7) {
          // movie magic: make sure the shove actually sends him into the sea
          this.hit = lt; D.cue('bonk', lt + this.t0); D.cue('slowmo', lt + this.t0 + 0.02);
          const v = ev.rivals[0]; v.vx = 11; v.vz = 1.2; v.vy = 6; v.stun = 2;
        }
        I.pressed.clear();
        for (const r of ev.rivals) if (r.out && !r._s) { r._s = true; D.cue('splash', lt + this.t0); }
        const P = ev.player, v = ev.rivals[0];
        const fx = lerp(P.x, v.x, 0.55), fz = lerp(P.z, v.z, 0.55);
        const k = sm(lt / 4.2);
        ev.camera.position.set(fx - lerp(3.0, 3.8, k), lerp(3.0, 3.7, k), fz + lerp(6.2, 7.8, k));
        ev.camera.lookAt(fx + 0.8, Math.max(1.6, v.y * 0.7 + 0.6), fz);
      },
      scene() { return this.ev.scene; }, camera() { return this.ev.camera; },
      exit() { app.input.keys.clear(); this.ev.dispose(); },
    });

    // 10 · the leap
    add(4.8, {
      title: { text: ['EVERY WING MEASURED.', 'EVERY TAIL WEIGHED.'], at: 0.15, until: 2.6, size: 56, y: BAR + 130 },
      subs: [{ text: 'your bad drawing is the physics engine', at: 2.75 }],
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
        if (P.x > 33 && this.j === 0) { I.pressed.add(' '); I.keys.add(' '); this.j = 1; D.cue('boing', lt + this.t0); D.cue('flap', lt + this.t0 + 0.3); }
        ev.update(dt, WORLD_TIME.value);
        I.pressed.clear();
        const k = sm(lt / 4.8);
        ev.camera.position.set(P.x - lerp(5, 11, k), P.y + lerp(0.8, 3.2, k), P.z + lerp(6, 14, k));
        ev.camera.lookAt(P.x + 4, P.y - 0.3, P.z);
      },
      scene() { return this.ev.scene; }, camera() { return this.ev.camera; },
      exit() { app.input.keys.clear(); this.ev.dispose(); },
    });

    // 11 · family
    add(4.5, {
      title: { text: 'HE FOUND A FAMILY', at: 0.15, until: 2.2 },
      subs: [{ text: 'they are all like this', at: 2.4 }],
      enter() {
        worldLook({ bloom: 0.22 }); aspect(isl.camera);
        for (const r of isl.garden.pets()) isl.garden.remove(r);
        const frames = ['roller', 'serpent', 'crawler', 'hopper', 'quad', 'biped', 'roller'];
        this.pets = frames.map((f, i) => {
          const a = (i / frames.length) * 6.28 + 0.4, d = 2.6 + (i % 3) * 1.3;
          return isl.garden.add(randomDesign(900 + i * 31, { frame: f }), { pet: true, x: SP.x + Math.cos(a) * d, z: SP.z + Math.sin(a) * d });
        });
        for (const i of [1, 4]) { this.pets[i].state = 'nap'; this.pets[i].timer = 99; }
        for (const i of [2, 5]) { this.pets[i].state = 'play'; this.pets[i].timer = 99; }
        this.heroR = isl.garden.add(D.hero, { pet: true, x: SP.x + 0.5, z: SP.z + 3.5 });
        this.heroR.state = 'idle'; this.heroR.timer = 99;
        for (const r of isl.garden.roamers) if (r.tag) r.tag.visible = false;
        this.petted = 0;
      },
      update(dt, lt) {
        if (lt > 1.0 && this.petted === 0) { this.petted = 1; isl.garden.pet(this.pets[0]); D.cue('babble', lt + this.t0); }
        if (lt > 2.6 && this.petted === 1) { this.petted = 2; isl.garden.pet(this.heroR); D.cue('babble', lt + this.t0); }
        D.islandTick(dt);
        for (const r of isl.garden.roamers) if (r.tag) r.tag.visible = false;
        const k = sm(lt / 4.5);
        isl.camera.position.set(SP.x + lerp(-8.5, -6.5, k), lerp(1.6, 1.9, k) + islandH(SP.x, SP.z), SP.z + lerp(10, 8, k));
        isl.camera.lookAt(SP.x + 0.3, 1.0 + islandH(SP.x, SP.z), SP.z + 1);
        isl.lights.follow(V(SP.x, 0, SP.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 12 · salvation
    add(4.1, {
      title: { text: 'AND HE WILL SAVE THEM ALL', at: 0.15, until: 2.0 },
      subs: [{ text: 'from a moderate amount of purple goo', at: 2.1 }],
      fadeOut: 0.5,
      enter() { aspect(isl.camera); this.c = 0; },
      update(dt, lt) {
        const zn = ZONES[0], zs = isl.zoneState[0];
        if (lt > 0.5 && !this.c) { this.c = 1; zs.target = 0; D.cue('chime', lt + this.t0); }
        if (this.c && Math.floor(lt * 5) !== this.lastBurst && lt < 3.0) {
          this.lastBurst = Math.floor(lt * 5);
          isl.fx.emit(zn.x, zs.H + 1.5, zn.z, { count: 50, colors: ['#ffe680', '#ffffff', '#f2b134', '#7fc8a9'], speed: 9, up: 9, gravity: 6, size: 0.4, life: 2 });
        }
        D.islandTick(dt * (this.c ? 2.2 : 1));
        const a = zn.ang + Math.PI + 0.5 + lt * 0.07;
        isl.camera.position.set(zn.x + Math.cos(a) * 14, zs.H + 4.5, zn.z + Math.sin(a) * 14);
        isl.camera.lookAt(zn.x, zs.H + 2.2, zn.z);
        isl.lights.follow(V(zn.x, 0, zn.z));
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 13 · the critics
    add(4.8, {
      fadeIn: 0.5,
      enter() { worldLook({ blur: 1.2, focus: 0.5, band: -0.3, bloom: 0.1 }); aspect(isl.camera); D.cue('critics', this.t0); [0.25, 0.85, 1.45].forEach((d) => D.cue('boomSoft', this.t0 + d)); },
      update(dt, lt) {
        D.islandTick(dt);
        const a = 2.1 + lt * 0.04;
        isl.camera.position.set(Math.cos(a) * 50, 18, Math.sin(a) * 50);
        isl.camera.lookAt(0, 2, 0);
        isl.lights.follow(V(0, 0, 0));
      },
      overlay(x, lt, dur) {
        x.save(); x.fillStyle = 'rgba(8,8,14,0.8)'; x.fillRect(0, 0, W, H); x.restore();
        const Q = [['IT HAS EYES', 'my mom'], ['WHY IS IT LIKE THAT', 'my roommate'], ['A TRIUMPH', 'the developer']];
        Q.forEach(([q, who], i) => {
          const a = Math.min(sm((lt - 0.25 - i * 0.6) / 0.4), 1 - sm((lt - (dur - 0.4)) / 0.35));
          if (a <= 0) return;
          const cx = W / 2 + (i - 1) * 600, cy = H / 2 + 10;
          D.laurel(x, cx, cy, 200, a);
          x.save(); x.globalAlpha = a; x.textAlign = 'center'; x.textBaseline = 'middle';
          const s = 46; x.font = `700 ${s}px ${SERIF}`; x.letterSpacing = '3px';
          const words = q.split(' '), rows = [];
          let row = '';
          for (const wd of words) { const tr = row ? row + ' ' + wd : wd; if (x.measureText(tr).width > 270 && row) { rows.push(row); row = wd; } else row = tr; }
          rows.push(row);
          const rowY = (k) => cy + (k - (rows.length - 1) / 2) * 52;
          x.font = `400 28px ${SERIF}`; x.letterSpacing = '6px'; x.fillStyle = '#d9b45a'; x.fillText('★★★★★', cx + 3, rowY(0) - 58);
          x.font = `700 ${s}px ${SERIF}`; x.letterSpacing = '3px';
          x.fillStyle = '#f4efe4';
          rows.forEach((r, k) => x.fillText(k === 0 ? '“' + r + (rows.length === 1 ? '”' : '') : r + (k === rows.length - 1 ? '”' : ''), cx, rowY(k)));
          x.font = `italic 500 32px ${ITAL}`; x.letterSpacing = '0px'; x.fillStyle = '#d6c9a6';
          x.fillText('— ' + who, cx, rowY(rows.length - 1) + 56);
          x.restore();
        });
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 14 · title, then the pretence collapses into the toy box
    add(6.2, {
      bars: (lt) => 1 - ease((lt - 2.0) / 0.35),
      tint: false,
      enter() { worldLook({ blur: 1.4, focus: 0.5, band: -0.3, vignette: 0.5, bloom: 0.1 }); aspect(isl.camera); D.cue('climax', this.t0); D.cue('toy', this.t0 + 2.0); },
      update(dt, lt) {
        D.islandTick(dt);
        const a = 0.9 + lt * 0.05;
        isl.camera.position.set(Math.cos(a) * 58, 26, Math.sin(a) * 58);
        isl.camera.lookAt(0, 0, 0);
        isl.lights.follow(V(0, 0, 0));
      },
      overlay(x, lt) {
        x.save(); x.fillStyle = `rgba(6,6,12,${lt < 2.0 ? 0.72 : lerp(0.72, 0.5, ease((lt - 2) / 0.4))})`; x.fillRect(0, 0, W, H); x.restore();
        if (lt < 2.0) {
          // gold, solemn, shimmering
          const a = sm(lt / 0.5);
          x.save(); x.globalAlpha = a; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.translate(W / 2, H / 2 - 10); const s = 1 + lt * 0.02; x.scale(s, s);
          x.font = `900 180px ${SERIF}`; x.letterSpacing = '34px';
          const g = x.createLinearGradient(-700, -90, 700, 90);
          const sh = ((lt * 0.55) % 1.4) - 0.2;
          g.addColorStop(0, '#7a5a1e'); g.addColorStop(Math.max(0, Math.min(1, sh - 0.12)), '#c8a04a');
          g.addColorStop(Math.max(0, Math.min(1, sh)), '#fff4c8'); g.addColorStop(Math.max(0, Math.min(1, sh + 0.12)), '#c8a04a'); g.addColorStop(1, '#8a6626');
          x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = 40;
          x.fillStyle = g; x.fillText('CLAYBORN', 17, 0);
          x.shadowBlur = 0;
          x.font = `500 30px ${SERIF}`; x.letterSpacing = '18px'; x.fillStyle = '#b9ad92';
          x.fillText('A MONSTER PICTURE', 9, 140);
          x.restore();
          return;
        }
        // toy-box logo, boing
        const l = lt - 2.0;
        x.save();
        const sq = Math.max(0, 1 - l / 0.5);
        const pop = 1 + sq * 0.35 * Math.cos(l * 26);
        x.translate(W / 2, H / 2 - 90); x.scale(pop, 2 - pop); x.rotate(-0.04);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = '400 190px "Dela Gothic One"';
        x.fillStyle = RED; x.fillText('CLAY', 9, -120 + 9);
        x.fillStyle = YEL; x.fillText('CLAY', 0, -120);
        const bw = 640, bh = 200;
        x.save(); x.transform(1, 0, -0.18, 1, 0, 0); x.fillStyle = '#000'; x.fillRect(-bw / 2 + 14, 40 - bh / 2 + 14, bw, bh); x.fillStyle = RED; x.fillRect(-bw / 2, 40 - bh / 2, bw, bh); x.restore();
        x.fillStyle = PAPER; x.fillText('BORN', 0, 46);
        x.restore();
        const s2 = ease((l - 0.55) / 0.4);
        if (s2 > 0) {
          x.save(); x.globalAlpha = s2; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.font = '900 50px "Zen Kaku Gothic New"'; x.fillStyle = PAPER;
          x.fillText('Draw a monster. Live with the consequences.', W / 2, H / 2 + 200);
          x.restore();
        }
        const s3 = ease((l - 1.2) / 0.35);
        if (s3 > 0) {
          x.save(); x.globalAlpha = s3; x.textAlign = 'center'; x.textBaseline = 'middle';
          const label = 'FREE TO PLAY IN YOUR BROWSER';
          x.font = '900 42px "Zen Kaku Gothic New"';
          const w = x.measureText(label).width + 80;
          x.save(); x.translate(W / 2, H / 2 + 300); x.transform(1, 0, -0.2, 1, 0, 0); x.fillStyle = YEL; x.fillRect(-w / 2, -40, w, 80); x.restore();
          x.fillStyle = INK; x.fillText(label, W / 2, H / 2 + 302);
          x.restore();
        }
      },
      scene: () => isl.scene, camera: () => isl.camera,
    });

    // 15 · post-credits stinger
    add(4.6, {
      fadeIn: 0.5, tint: false, grade: 'contrast(1.04)',
      subs: [{ text: 'no monsters were harmed in the making of this trailer.', at: 2.3, y: BAR + 80, size: 54 }, { text: 'several were drawn poorly.', at: 3.0, y: BAR + 150, size: 54 }],
      enter() {
        gfx.setLook({ blur: 0, vignette: 0.4, bloom: 0.25, world: false });
        const g = D.hero.group; g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1); D.hero.tilt.rotation.set(0, 0, 0);
        studio.setCreature(D.hero); studio.spin = -Math.PI / 2; studio.spinVel = 0; studio.camDist = undefined;
        aspect(studio.camera); this.h = 0;
        D.cue('stinger', this.t0);
      },
      update(dt, lt) {
        studio.spin = -Math.PI / 2 - dt * 0.25; studio.spinVel = 0;
        if (lt > 0.9 && this.h === 0) { this.h = 1; D.cue('babble', lt + this.t0); }
        if (lt > 1.45 && this.h === 1) { this.h = 2; D.cue('creak', lt + this.t0); }
        if (this.h === 2) {
          const k = Math.min(1, (lt - 1.45) / 0.55);
          D.hero.tilt.rotation.x = 1.4 * k * k;
          if (k >= 1 && !this.thud) { this.thud = true; D.cue('thud', lt + this.t0); }
        }
        studio.update(dt, lt);
        const c = studio.camera;
        c.position.set(0, 1.5, 6.0); c.lookAt(0, 0.8, 0);
      },
      scene: () => studio.scene, camera: () => studio.camera,
    });
    return list;
  }
}
