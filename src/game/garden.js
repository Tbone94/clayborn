// Chao-garden life: every monster you've made lives on the island with the locals.
// They wander, nap, play, chat with each other, greet you and follow you after a pet.
import * as THREE from 'three';
import { Body } from './body.js';
import { Creature } from '../creature/creature.js';
import { babble, sfx } from '../fx/audio.js';

const GLYPH = { heart: '♥', bang: '!', what: '?', zzz: 'Zz', note: '♪', star: '★' };
const texCache = {};

function emoteTexture(kind) {
  if (texCache[kind]) return texCache[kind];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  // a little toy-box tag: red shadow, ink diamond, yellow glyph
  x.translate(64, 60); x.rotate(Math.PI / 4);
  x.fillStyle = '#e63b2e'; x.fillRect(-34, -34, 76, 76);
  x.fillStyle = '#15172b'; x.fillRect(-40, -40, 76, 76);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = kind === 'heart' ? '#ff6fa8' : '#ffd23f';
  x.font = `400 ${kind === 'zzz' ? 44 : 60}px "Dela Gothic One", sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(GLYPH[kind], 58, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  texCache[kind] = t;
  return t;
}

function nameTag(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const draw = () => {
    const x = c.getContext('2d'); x.clearRect(0, 0, 512, 96);
    x.font = '400 46px "DotGothic16", monospace';
    const w = Math.min(480, x.measureText(text).width + 50);
    x.save(); x.translate(256, 48); x.transform(1, 0, -0.2, 1, 0, 0);
    x.fillStyle = '#e63b2e'; x.fillRect(-w / 2 + 6, -32, w, 64);
    x.fillStyle = '#15172b'; x.fillRect(-w / 2, -38, w, 64);
    x.restore();
    x.fillStyle = '#ffd23f'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 42);
    t.needsUpdate = true;
  };
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  draw(); document.fonts?.ready.then(draw);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, depthTest: false }));
  s.scale.set(2.2, 0.41, 1); s.renderOrder = 10;
  return s;
}

export class Roamer {
  constructor(garden, creatureOrDesign, { pet = false, rosterIndex = -1, x = 0, z = 0 } = {}) {
    this.garden = garden;
    this.c = creatureOrDesign instanceof Creature ? creatureOrDesign : new Creature(creatureOrDesign, { detail: 48 });
    this.b = new Body(this.c, x, z);
    this.b.y = garden.island.world.height(x, z);
    this.pet = pet; this.rosterIndex = rosterIndex;
    this.state = 'idle'; this.timer = 1 + Math.random() * 3;
    this.tx = x; this.tz = z;
    this.greetCD = 0; this.chatCD = 3 + Math.random() * 5; this.followT = 0;
    this.emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoteTexture('note'), depthWrite: false, depthTest: false, transparent: true }));
    this.emote.renderOrder = 11; this.emote.visible = false; this.emote.scale.setScalar(0.8);
    this.emoteT = 0;
    this.c.group.add(this.emote);
    if (pet) { this.tag = nameTag(this.c.design.name); this.c.group.add(this.tag); }
    this.placeTags();
  }

  get name() { return this.c.design.name; }

  placeTags() {
    const h = this.c.height || 1;
    this.emote.position.set(0, h + 0.75, 0);
    if (this.tag) this.tag.position.set(0, h + 0.3, 0);
  }

  say(kind, dur = 1.6) {
    this.emote.material.map = emoteTexture(kind); this.emote.material.needsUpdate = true;
    this.emote.visible = true; this.emoteT = dur; this.emotePop = 0;
  }

  voice(n = 3, mood = 0) { babble(1.4 / Math.pow(Math.max(0.4, this.b.P.mass), 0.3), n, mood); }

  dispose() { this.c.group.remove(this.emote); if (this.tag) this.c.group.remove(this.tag); }
}

export class Garden {
  constructor(island) {
    this.island = island;
    this.roamers = [];
  }

  add(src, opts) {
    const r = new Roamer(this, src, opts);
    this.island.scene.add(r.c.group);
    this.roamers.push(r);
    return r;
  }

  remove(r) {
    this.island.scene.remove(r.c.group);
    r.dispose();
    this.roamers = this.roamers.filter((o) => o !== r);
  }

  pets() { return this.roamers.filter((r) => r.pet); }

  pickTarget(r) {
    const I = this.island;
    for (let k = 0; k < 20; k++) {
      // pets like to stay around the meadow; locals roam the whole island
      const a = Math.random() * 6.28, d = (r.pet ? 3 : 5) + Math.random() * (r.pet ? 16 : 26);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (I.world.height(x, z) < 0.8) continue;
      if (I.inGloom(x, z)) continue;
      r.tx = x; r.tz = z; return;
    }
  }

  pet(r) {
    const I = this.island;
    r.state = 'follow'; r.followT = 14; r.timer = 0;
    r.say('heart', 2.2); r.voice(4, 1);
    r.b.vy = 5; r.b.grounded = false;
    I.fx.emit(r.b.x, r.b.y + (r.c.height || 1), r.b.z, { count: 14, colors: ['#ff6fa8', '#ffd23f', '#ffffff'], speed: 2.5, up: 4, gravity: 3, size: 0.28, life: 1.2 });
    sfx.chime();
  }

  update(dt, t, player) {
    const rs = this.roamers;
    for (const r of rs) {
      const b = r.b;
      let mx = 0, mz = 0, jump = false;
      r.timer -= dt; r.greetCD -= dt; r.chatCD -= dt;
      const pd = player ? Math.hypot(player.x - b.x, player.z - b.z) : 99;
      const face = (x, z) => { b.heading = Math.atan2(-(z - b.z), x - b.x); };

      // react to the player walking up (but don't wake nappers every time)
      if (player && pd < 3.2 && r.greetCD <= 0 && r.state !== 'nap' && r.state !== 'follow') {
        r.greetCD = 12 + Math.random() * 6;
        r.state = 'greet'; r.timer = 1.4; face(player.x, player.z);
        r.say(r.pet ? 'heart' : 'bang', 1.4); r.voice(3, 1);
        b.vy = 4.5; b.grounded = false;
      }

      switch (r.state) {
        case 'wander': {
          const dx = r.tx - b.x, dz = r.tz - b.z, d = Math.hypot(dx, dz);
          if (d < 1 || r.timer <= 0) this.nextMood(r);
          else { mx = (dx / d) * 0.45; mz = (dz / d) * 0.45; }
          break;
        }
        case 'idle':
          if (r.timer <= 0) this.nextMood(r);
          else if (Math.random() < dt * 0.4) b.heading += (Math.random() - 0.5) * 1.5;
          break;
        case 'nap':
          if (Math.random() < dt * 0.5) r.say('zzz', 1.2);
          if (r.timer <= 0) { r.state = 'idle'; r.timer = 1; r.say('what', 1); }
          break;
        case 'play':
          if (b.grounded && Math.random() < dt * 2.5) { jump = true; b.heading += (Math.random() - 0.5) * 3; }
          if (Math.random() < dt * 0.6) r.say('note', 1);
          if (r.timer <= 0) this.nextMood(r);
          break;
        case 'greet':
          if (player) face(player.x, player.z);
          if (r.timer <= 0) { r.state = 'idle'; r.timer = 2; }
          break;
        case 'follow': {
          r.followT -= dt;
          if (!player || r.followT <= 0) { r.state = 'idle'; r.timer = 2; r.say('heart', 1); break; }
          if (pd > 2.4) { const k = Math.min(1, (pd - 2.4) / 3) * 0.9; mx = ((player.x - b.x) / pd) * k; mz = ((player.z - b.z) / pd) * k; }
          else face(player.x, player.z);
          if (pd > 12 && b.grounded) jump = true;
          break;
        }
        case 'chat':
          if (r.partner) face(r.partner.b.x, r.partner.b.z);
          if (Math.random() < dt * 0.9) { r.voice(2); }
          if (r.timer <= 0) { r.state = 'idle'; r.timer = 1 + Math.random() * 2; r.partner = null; }
          break;
      }

      // two monsters bump into each other → a little chat
      if (r.chatCD <= 0 && (r.state === 'wander' || r.state === 'idle')) {
        for (const o of rs) {
          if (o === r || o.chatCD > 0 || !(o.state === 'wander' || o.state === 'idle')) continue;
          if (Math.hypot(o.b.x - b.x, o.b.z - b.z) < 2.4) {
            for (const [p, q] of [[r, o], [o, r]]) { p.state = 'chat'; p.timer = 2.8; p.partner = q; p.chatCD = 14 + Math.random() * 10; }
            r.say('bang', 1); setTimeout(() => o.say('note', 1.2), 500);
            break;
          }
        }
      }

      // napping: tip over onto a side, then get back up
      const tilt = r.c.tilt.rotation;
      const want = r.state === 'nap' ? 1.25 : 0;
      tilt.z += (want - tilt.z) * Math.min(1, dt * 2.5);

      b.step(dt, { mx, mz, jumpPressed: jump }, this.island.world);
      r.c.update(dt);

      // emote bob + fade
      if (r.emoteT > 0) {
        r.emoteT -= dt; r.emotePop = Math.min(1, (r.emotePop || 0) + dt * 6);
        const s = 0.8 * (r.emotePop < 1 ? 1 + Math.sin(r.emotePop * Math.PI) * 0.4 : 1);
        r.emote.scale.setScalar(s);
        r.emote.position.y = (r.c.height || 1) + 0.75 + Math.sin(t * 5) * 0.05;
        if (r.emoteT <= 0) r.emote.visible = false;
      }
      if (r.tag) r.tag.visible = pd < 11 || !player;
    }
    // gentle separation so they don't stack up
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i].b, c = rs[j].b, dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), R = a.P.radius + c.P.radius;
      if (d < R && d > 0.01) { const k = ((R - d) / d) * 0.5; a.x -= dx * k; a.z -= dz * k; c.x += dx * k; c.z += dz * k; }
    }
  }

  nextMood(r) {
    const roll = Math.random();
    if (roll < 0.45) { r.state = 'wander'; r.timer = 12; this.pickTarget(r); }
    else if (roll < 0.65) { r.state = 'idle'; r.timer = 2 + Math.random() * 3; }
    else if (roll < 0.82) { r.state = 'play'; r.timer = 3 + Math.random() * 2; }
    else { r.state = 'nap'; r.timer = 7 + Math.random() * 6; r.say('zzz', 1.5); }
  }
}
