// The hub: a terraced clay island, three Gloom zones, event totems, wandering locals.
import * as THREE from 'three';
import { heightTexture, Particles, scatter } from './common.js';
import { GLOOM } from '../fx/clay.js';
import { setupWorld, terrainMaterial, terrainMesh, makeWater, plantTrees, placeRocks, plantGrass, plantFlowers, plantFerns, grassHeight, modelSize, updateTrees, PUSH, pbr } from '../world/nature.js';
import { A } from '../world/assets.js';
import { QUALITY as Q } from '../fx/quality.js';
import { fbm2, smoothstep, lerp } from '../game/noise.js';
import { Body } from '../game/body.js';
import { Garden } from '../game/garden.js';
import { escapeHtml } from '../ui/creator.js';
import { randomDesign, rng } from '../creature/generator.js';
import { decodeDesign } from '../creature/design.js';
import { sfx, babble } from '../fx/audio.js';
import { RaceEvent } from '../events/race.js';
import { BonkEvent } from '../events/bonk.js';
import { LeapEvent } from '../events/leap.js';

const $ = (id) => document.getElementById(id);

export const ZONES = [
  { name: 'Ridge Run', jp: '競走', desc: 'Race 3 locals over hills, a river and a chasm. Long legs, big tails and wings all help somewhere.', ang: 0.55, dist: 24, r: 11, color: '#f2b134', Event: RaceEvent },
  { name: 'Bonk Bowl', jp: '相撲', desc: 'Shove everyone off the platform. Heavy, wide and low creatures are hard to topple.', ang: 2.65, dist: 23, r: 11, color: '#ef6f4f', Event: BonkEvent },
  { name: 'Sky Leap', jp: '飛翔', desc: 'Sprint off the cliff and glide as far as you can. Wings, wings, wings.', ang: 4.45, dist: 25, r: 11, color: '#ef8fb5', Event: LeapEvent },
];
for (const z of ZONES) { z.x = Math.cos(z.ang) * z.dist; z.z = Math.sin(z.ang) * z.dist; }
const SPAWN = { x: 0, z: 2 };
const _target = new THREE.Vector3(), _origin = new THREE.Vector3();

// dirt trails: a ring round the meadow + a path out to every totem
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function pathWeight(x, z) {
  let d = Math.abs(Math.hypot(x - SPAWN.x, z - SPAWN.z) - 7.5);
  for (const zn of ZONES) d = Math.min(d, segDist(x, z, SPAWN.x + Math.cos(zn.ang) * 7.5, SPAWN.z + Math.sin(zn.ang) * 7.5, zn.x - Math.cos(zn.ang) * 3.5, zn.z - Math.sin(zn.ang) * 3.5));
  const wob = fbm2(x * 0.2, z * 0.2) * 0.5;
  return smoothstep(1.6 + wob, 0.7 + wob, d);
}

export function islandH(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const coast = 40 + 4.5 * Math.sin(3 * a + 1) + 2.5 * Math.sin(5 * a + 2) + 3 * fbm2(x * 0.03, z * 0.03);
  const t = 1 - r / coast;
  let h = smoothstep(-0.1, 0.3, t) * 3.4 - 1.9;
  h -= smoothstep(-0.05, -0.45, t) * 9; // the seabed drops away past the shallows
  h += Math.max(0, fbm2(x * 0.045 + 7, z * 0.045 - 3) * 6.5 + 1.2) * smoothstep(0.08, 0.5, t);
  // soft terraces — the stacked-clay look
  if (h > 0.4) { const st = 1.25, k = (h - 0.4) / st, f = k - Math.floor(k); h = 0.4 + (Math.floor(k) + smoothstep(0.3, 0.7, f)) * st; }
  // flatten plateaus for spawn & totems
  for (const p of [{ x: SPAWN.x, z: SPAWN.z, r: 7, h: 1.65 }, ...ZONES.map((z) => ({ x: z.x, z: z.z, r: 6, h: 1.65 + (z === ZONES[2] ? 2.5 : 0) }))]) {
    const d = Math.hypot(x - p.x, z - p.z);
    h = lerp(h, p.h, smoothstep(p.r * 1.6, p.r * 0.7, d));
  }
  return h;
}

// 3D sign in the toy-box style: skewed ink slab, red shadow, white title, yellow kanji tag
function label(text, jp = '') {
  const c = document.createElement('canvas'); c.width = 768; c.height = 160;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const x = c.getContext('2d'); x.clearRect(0, 0, 768, 160);
    x.font = '400 70px "Dela Gothic One", sans-serif';
    const tw = x.measureText(text.toUpperCase()).width;
    x.font = '400 40px "DotGothic16", monospace';
    const jw = jp ? x.measureText(jp).width + 30 : 0;
    const w = Math.min(740, tw + jw + 70);
    x.save(); x.translate(384, 80); x.transform(1, 0, -0.22, 1, 0, 0);
    x.fillStyle = '#e63b2e'; x.fillRect(-w / 2 + 10, -50, w, 104);
    x.fillStyle = '#15172b'; x.fillRect(-w / 2, -60, w, 104);
    x.restore();
    let cx = 384 - (tw + jw) / 2;
    if (jp) {
      x.fillStyle = '#ffd23f'; x.fillRect(cx - 6, 46, jw - 14, 50);
      x.fillStyle = '#15172b'; x.font = '400 40px "DotGothic16", monospace'; x.textBaseline = 'middle'; x.fillText(jp, cx + 4, 72);
      cx += jw;
    }
    x.fillStyle = '#fbf8f0'; x.font = '400 70px "Dela Gothic One", sans-serif'; x.textBaseline = 'middle'; x.fillText(text.toUpperCase(), cx, 74);
    t.needsUpdate = true;
  };
  draw(); document.fonts?.ready.then(draw);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(5.4, 1.12, 1);
  return s;
}

export class Island {
  constructor(app) {
    this.app = app;
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 900);
    this.lights = setupWorld(s, { fog: [90, 320] });
    this.fx = new Particles(s);
    this.t = 0;
    this.buildTerrain();
    this.buildProps();
    this.buildZones();
    this.buildEasel();
    this.camYaw = -0.6; this.camPitch = 0.42; this.camDist = 10;
    this.camTarget = new THREE.Vector3(0, 2, 0);
    this.world = {
      height: islandH, water: 0,
      splash: (x, y, z) => { this.fx.emit(x, y, z, { count: 18, color: '#e8fbff', speed: 3, up: 5, gravity: 14, size: 0.3, life: 0.7 }); if (Math.hypot(x - this.player?.x, z - this.player?.z) < 1) sfx.splash(); },
      dust: (x, y, z) => this.fx.emit(x, y + 0.1, z, { count: 10, color: '#e9d6b8', speed: 2.5, up: 1, gravity: 2, size: 0.35, life: 0.6 }),
    };
    this.garden = new Garden(this);
    this.buildLocals();
    this.syncGloom(true);
  }

  totalOrbs() { return ZONES.length; }

  // ---------- build ----------
  buildTerrain() {
    const splat = (x, h, z, ny) => {
      let sand = smoothstep(0.85, 0.35, h);
      let rock = smoothstep(0.8, 0.58, ny) * (1 - sand * 0.6);
      let dirt = Math.max(pathWeight(x, z), smoothstep(0.25, 0.45, fbm2(x * 0.09 + 3, z * 0.09)) * 0.45) * (1 - rock) * (1 - sand);
      let lawn = Math.max(0, 1 - sand - rock - dirt);
      return [lawn, dirt, sand, rock];
    };
    const m = terrainMesh(islandH, { size: [140, 140], seg: [260, 260], splatFn: splat, material: terrainMaterial({ gloom: true }) });
    this.scene.add(m); this.terrain = m;
    const hTex = heightTexture(islandH, -100, -100, 200, 256);
    this.water = makeWater(this.scene, { size: 900, level: 0, hTex, hBox: [-100, -100, 200, 200] });
  }

  buildProps() {
    const r = rng(42);
    const slope = (x, z) => { const e = 0.6; return Math.hypot(islandH(x + e, z) - islandH(x - e, z), islandH(x, z + e) - islandH(x, z - e)) / (2 * e); };
    const clear = (x, z, pad = 0) => {
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 8 + pad) return false;
      for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < 6.5 + pad) return false;
      return pathWeight(x, z) < 0.15;
    };
    // trees, clumped into groves
    const trees = [];
    for (let i = 0; i < 4000 && trees.length < 36; i++) {
      const x = (r() - 0.5) * 86, z = (r() - 0.5) * 86, h = islandH(x, z);
      if (h < 1.0 || slope(x, z) > 0.55 || !clear(x, z, 4) || pathWeight(x, z) > 0.01 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 13) continue;
      { let near = false; for (let a = 0; a < 6.28; a += 0.8) if (pathWeight(x + Math.cos(a) * 3, z + Math.sin(a) * 3) > 0.2) near = true; if (near) continue; }
      if (fbm2(x * 0.06 + 20, z * 0.06) < 0.1 && r() < 0.93) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
      const bush = r() < 0.3;
      trees.push({ x, y: h - 0.15, z, h: bush ? 2.2 + r() * 1.2 : 6.5 + r() * 4.5, ry: r() * 6.28, kind: bush ? 4 + ((r() * 2) | 0) : (r() * 4) | 0 });
    }
    this.trees = plantTrees(this.scene, trees);
    // scanned rocks: coastline boulders + cliff rubble
    const rocks = [], rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    for (let i = 0; i < 2000 && rocks.length < 60; i++) {
      const x = (r() - 0.5) * 96, z = (r() - 0.5) * 96, h = islandH(x, z);
      const coast = h > -0.8 && h < 0.7, cliff = slope(x, z) > 0.7 && h > 0.5;
      if (!(coast || cliff || (r() < 0.04 && h > 1))) continue;
      if (!clear(x, z)) continue;
      const size = (coast ? 0.8 + r() * 2.2 : 0.6 + r() * 1.4) / rs;
      rocks.push({ x, y: h - 0.25, z, s: size, sy: 0.7 + r() * 0.5, ry: r() * 6.28, rx: (r() - 0.5) * 0.3 });
    }
    placeRocks(this.scene, rocks);
    // grass: thousands of clumps where the lawn is
    const grass = [], flowers = [], ferns = [];
    const gH = grassHeight();
    for (let i = 0; i < 95000; i++) {
      const x = (r() - 0.5) * 88, z = (r() - 0.5) * 88, h = islandH(x, z);
      if (h < 0.8 || slope(x, z) > 0.5) continue;
      if (pathWeight(x, z) > 0.35 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 2.5) continue;
      if (fbm2(x * 0.09 + 3, z * 0.09) > 0.34 && r() < 0.85) continue; // dirt patches
      grass.push({ x, y: h - 0.03, z, s: (0.38 + r() * 0.35) / gH, ry: r() * 6.28, hue: r(), lum: r() });
      if (r() < 0.008) flowers.push({ x: x + 0.3, y: h - 0.02, z, s: (0.35 + r() * 0.2) / modelSize('flower_white').y, ry: r() * 6.28 });
      if (r() < 0.003 && trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5)) ferns.push({ x, y: h - 0.05, z, s: (0.7 + r() * 0.5) / modelSize('fern').y, ry: r() * 6.28 });
    }
    plantGrass(this.scene, grass, { gloom: true });
    plantFlowers(this.scene, flowers);
    plantFerns(this.scene, ferns);
    this.grassCount = grass.length;
    // a weathered pier
    const pier = new THREE.Group();
    const plank = pbr('wood_planks', 1, 1);
    for (let k = 0; k < 8; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 3.2), plank); b.position.set(k * 1.22, 0.62, 0); b.rotation.y = (k % 2 - 0.5) * 0.03; b.castShadow = b.receiveShadow = true; pier.add(b); }
    const post = pbr('bark_brown_02', 1, 2);
    for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 2.8, 10), post); p.position.set(k * 2.4, -0.2, sd * 1.5); p.castShadow = true; pier.add(p); }
    pier.position.set(34, 0, 12); pier.rotation.y = -0.35; this.scene.add(pier);
  }

  buildZones() {
    // the Gloom: iridescent oil-slick ooze
    // phones: plain glossy standard material (no clearcoat/iridescence lobes) on low-poly blobs
    const gooMat = Q.gooPhysical
      ? new THREE.MeshPhysicalMaterial({ color: '#120b1c', roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 680], envMapIntensity: 1.6 })
      : new THREE.MeshStandardMaterial({ color: '#1a1028', roughness: 0.1, metalness: 0.35, envMapIntensity: 1.9 });
    const gooU = { uTime: { value: 0 } };
    gooMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, gooU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x*0.7 + instanceMatrix[3].z*1.3;
          transformed *= 1.0 + 0.07*sin(uTime*1.6 + ph + position.y*3.0 + position.x*2.0);
          transformed.y *= 1.0 + 0.1*sin(uTime*1.1 + ph);`);
    };
    this.gooU = gooU;
    const sphere = new THREE.SphereGeometry(1, Q.gooSeg[0], Q.gooSeg[1]);
    this.zoneState = [];
    const portalU = { uTime: { value: 0 } };
    this.portalU = portalU;
    const stone = pbr('rustic_stone_wall_02', 3, 1);
    const stoneTop = pbr('stone_tiles_02', 2, 2);
    ZONES.forEach((zn, i) => {
      const r = rng(100 + i);
      const blobs = [];
      for (let k = 0; k < 44; k++) {
        const a = r() * 6.28, d = 3 + Math.sqrt(r()) * (zn.r - 3);
        const x = zn.x + Math.cos(a) * d, z = zn.z + Math.sin(a) * d;
        const h = islandH(x, z);
        if (h < 0.2) continue;
        blobs.push({ x, z, y: h - 0.25, s: 0.4 + r() * 1.3, sy: 0.45 + r() * 0.3, d });
      }
      const im = scatter(this.scene, sphere, gooMat, blobs, { shadow: Q.propShadows });
      const g = new THREE.Group();
      const H = islandH(zn.x, zn.z);
      g.position.set(zn.x, H, zn.z);
      g.rotation.y = -zn.ang + Math.PI / 2;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.1, 0.6, 48), [stone, stoneTop, stone]); plinth.position.y = 0.2; plinth.castShadow = plinth.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.38, 24, 64), stone); ring.position.y = 2.75; ring.castShadow = true;
      const runes = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.4, 4, 64), new THREE.MeshBasicMaterial({ color: zn.color, transparent: true, opacity: 0.0 }));
      runes.position.y = 2.75; runes.scale.set(1, 1, 0.2);
      const portalMat = new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        uniforms: { ...portalU, uCol: { value: new THREE.Color(zn.color) }, uGloom: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `uniform float uTime, uGloom; uniform vec3 uCol; varying vec2 vUv;
          void main(){ vec2 p = vUv-0.5; float r = length(p)*2.0; float a = atan(p.y,p.x);
            float sw = sin(a*4.0 + r*12.0 - uTime*3.0)*0.5+0.5; float core = smoothstep(0.9, 0.0, r);
            vec3 c = mix(uCol*1.6, vec3(1.0, 0.98, 0.9)*2.2, core*core*0.7 + sw*0.25*(1.0-r));
            c = mix(c, mix(vec3(0.05,0.02,0.08), vec3(0.55,0.25,0.95)*1.4, sw*0.55 + core*0.2), uGloom);
            gl_FragColor = vec4(c, smoothstep(1.0, 0.82, r)*0.94); }`,
      });
      const portal = new THREE.Mesh(new THREE.CircleGeometry(1.9, 64), portalMat); portal.position.y = 2.75;
      const glow = new THREE.PointLight(zn.color, 0, 9, 1.6); glow.position.set(0, 2.75, 0.8);
      const lbl = label(zn.name, zn.jp); lbl.position.y = 5.7;
      g.add(plinth, ring, runes, portal, glow, lbl);
      this.scene.add(g);
      this.zoneState.push({ im, blobs, strength: 1, target: 1, portalMat, totem: g, label: lbl, H, glow });
    });
  }

  buildEasel() {
    const g = new THREE.Group();
    const wood = pbr('bark_brown_02', 1, 2);
    for (const [x, rz] of [[-0.6, 0.12], [0.6, -0.12]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 10), wood); l.position.set(x, 1.5, 0); l.rotation.z = rz; l.castShadow = true; g.add(l); }
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 10), wood); back.position.set(0, 1.4, -0.6); back.rotation.x = -0.35; back.castShadow = true; g.add(back);
    const paper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 0.06), new THREE.MeshStandardMaterial({ color: '#f4efe2', roughness: 0.9 }));
    paper.position.set(0, 2.1, 0.12); paper.rotation.x = -0.12; paper.castShadow = true; g.add(paper);
    // a scribbly doodle on the paper — the only janky thing besides the monsters
    const c = document.createElement('canvas'); c.width = 256; c.height = 200;
    const x = c.getContext('2d'); x.fillStyle = '#f4efe2'; x.fillRect(0, 0, 256, 200);
    x.strokeStyle = '#e63b2e'; x.lineWidth = 7; x.lineCap = 'round';
    x.beginPath(); x.ellipse(120, 110, 55, 50, 0.2, 0, 6.28); x.stroke();
    x.beginPath(); x.ellipse(150, 55, 30, 26, 0, 0, 6.28); x.stroke();
    x.beginPath(); x.moveTo(100, 155); x.lineTo(95, 190); x.moveTo(140, 155); x.lineTo(145, 190); x.stroke();
    x.fillStyle = '#15172b'; x.beginPath(); x.arc(160, 50, 6, 0, 6.28); x.fill();
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const doodleFace = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.36), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.95 }));
    doodleFace.position.set(0, 2.1, 0.16); doodleFace.rotation.x = -0.12; g.add(doodleFace);
    const doodle = label('Mold Lab', '型取り'); doodle.position.set(0, 3.9, 0); doodle.scale.set(4.4, 0.92, 1); g.add(doodle);
    g.position.set(SPAWN.x - 3.5, islandH(SPAWN.x - 3.5, SPAWN.z - 3), SPAWN.z - 3);
    g.rotation.y = 0.4;
    this.scene.add(g); this.easel = g;
  }

  buildLocals() {
    const seeds = [11, 23, 37, 51];
    seeds.forEach((sd, i) => {
      const a = (i / seeds.length) * 6.28 + 0.4;
      this.garden.add(randomDesign(sd * 7919), { x: Math.cos(a) * 14, z: Math.sin(a) * 14 });
    });
  }

  inGloom(x, z) { return ZONES.some((zn, i) => this.zoneState[i].strength > 0.5 && Math.hypot(x - zn.x, z - zn.z) < zn.r); }

  // your other monsters live here, Chao-garden style
  setPets(entries) {
    for (const r of this.garden.pets()) this.garden.remove(r);
    entries.forEach(({ design, index }, k) => {
      const a = (k / Math.max(1, entries.length)) * 6.28, d = 4 + (k % 3) * 1.5;
      this.garden.add(design, { pet: true, rosterIndex: index, x: SPAWN.x + Math.cos(a) * d, z: SPAWN.z + Math.sin(a) * d });
    });
  }

  // ---------- gloom ----------
  syncGloom(instant) {
    this.zoneState.forEach((zs, i) => {
      if (instant) zs.strength = zs.target;
      const zn = ZONES[i];
      GLOOM.value[i].set(zn.x, zn.z, zn.r + 2, zs.strength);
      zs.portalMat.uniforms.uGloom.value = zs.strength;
    });
  }

  applySave() {
    const won = this.app.save.orbs || [];
    this.zoneState.forEach((zs, i) => { zs.target = won.includes(i) ? 0 : 1; });
    this.syncGloom(true);
    this.zoneState.forEach((zs) => this.updateGoo(zs, true));
  }

  updateGoo(zs, force) {
    if (!force && zs.lastS === zs.strength) return;
    zs.lastS = zs.strength;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    zs.blobs.forEach((b, i) => {
      // shrink from the centre outwards
      const k = smoothstep(0, 1, zs.strength * 1.6 - (1 - b.d / 11) * 0.6);
      p.set(b.x, b.y, b.z); s.set(b.s * k, b.s * b.sy * k, b.s * k);
      m.compose(p, q, s); zs.im.setMatrixAt(i, m);
    });
    zs.im.instanceMatrix.needsUpdate = true;
  }

  cleanse(i) {
    const zs = this.zoneState[i], zn = ZONES[i];
    zs.target = 0;
    sfx.chime(); setTimeout(() => sfx.sparkle(), 500); setTimeout(() => sfx.fanfare(), 900);
    for (let k = 0; k < 6; k++) setTimeout(() => this.fx.emit(zn.x, zs.H + 1, zn.z, { count: 60, colors: ['#ffe680', '#ffffff', zn.color, '#7fc8a9'], speed: 9, up: 9, gravity: 6, size: 0.4, life: 2 }), k * 250);
  }

  // ---------- modes ----------
  enterAttract() {
    this.player = null;
    this.applySave();
    this.attract = true;
  }

  enterPlay(creature, pos = null) {
    this.attract = false;
    if (this.player) this.scene.remove(this.player.c.group);
    const x = pos ? pos.x : SPAWN.x, z = pos ? pos.z : SPAWN.z;
    this.player = new Body(creature, x, z);
    this.player.isPlayer = true;
    this.player.y = islandH(x, z);
    this.player.heading = -Math.PI / 2;
    creature.tilt.rotation.set(0, 0, 0);
    this.scene.add(creature.group);
    this.applySave();
    if (!pos) this.camYaw = Math.PI / 2;
    this.camTarget.set(this.player.x, this.player.y + 1, this.player.z);
    $('controls-hint').classList.remove('hidden');
    clearTimeout(this.hintT); this.hintT = setTimeout(() => $('controls-hint').classList.add('hidden'), 12000);
  }

  startEvent(i) {
    const zn = ZONES[i];
    this.app.transition(() => {
      this.scene.remove(this.player.c.group);
      this.activeEvent = new zn.Event(this.app, this, this.player.c, i);
      this.app.setMode('event');
      $('prompt').classList.add('hidden');
    });
  }

  endEvent(won, i) {
    this.app.transition(() => {
      const ev = this.activeEvent; this.activeEvent = null;
      ev?.dispose?.();
      $('event-hud').classList.add('hidden');
      $('banner').classList.add('hidden');
      const c = this.player.c;
      c.group.scale.set(1, 1, 1); c.tilt.rotation.set(0, 0, 0);
      c.motion.celebrate = 0;
      this.scene.add(c.group);
      const zn = ZONES[i];
      const a = zn.ang + Math.PI;
      this.player.x = zn.x + Math.cos(a) * 4.5; this.player.z = zn.z + Math.sin(a) * 4.5;
      this.player.y = islandH(this.player.x, this.player.z); this.player.vx = this.player.vz = this.player.vy = 0;
      this.player.heading = Math.atan2(-Math.sin(a), Math.cos(a));
      this.player.refresh();
      this.camYaw = a; this.camTarget.set(this.player.x, this.player.y + 1, this.player.z);
      this.app.setMode('island');
      const save = this.app.save;
      if (won && !save.orbs.includes(i)) {
        save.orbs.push(i);
        this.app.persist();
        setTimeout(() => { this.cleanse(i); this.app.refreshOrbs(); }, 700);
        if (save.orbs.length === ZONES.length) setTimeout(() => this.finale(), 4200);
      }
    });
  }

  finale() {
    sfx.fanfare();
    for (let k = 0; k < 14; k++) setTimeout(() => {
      const a = Math.random() * 6.28, d = Math.random() * 15;
      this.fx.emit(Math.cos(a) * d, 6 + Math.random() * 6, Math.sin(a) * d, { count: 80, colors: ['#ffe680', '#ef6f4f', '#5aa9e6', '#ef8fb5', '#7fc8a9', '#ffffff'], speed: 10, up: 4, gravity: 4, size: 0.45, life: 2.4 });
      sfx.pop(0.7 + Math.random());
    }, k * 350);
    this.app.modal(`<h2><span class="jp">完全浄化</span>The island is free!</h2><p>The Gloom is gone and everyone is throwing a party. The events stay open for records, and the Mold Lab is always open for new monsters.</p>
      <div class="row"><button class="btn primary" id="m-ok">Woohoo!</button></div>`);
    $('m-ok').onclick = () => this.app.closeModal();
  }

  // ---------- frame ----------
  update(dt, t) {
    this.t = t;
    this.water.update(t);
    this.gooU.uTime.value = t; this.portalU.uTime.value = t;
    updateTrees(t);
    for (const zs of this.zoneState) {
      zs.glow.intensity = (1 - zs.strength) * 7;
      if (zs.strength !== zs.target) {
        zs.strength += Math.sign(zs.target - zs.strength) * Math.min(Math.abs(zs.target - zs.strength), dt / 3.5);
      }
      this.updateGoo(zs);
    }
    this.syncGloom();
    if (this.activeEvent) { this.activeEvent.update(dt, t); return; }

    // gloom motes
    this.zoneState.forEach((zs, i) => {
      if (zs.strength > 0.3 && Math.random() < dt * 14) {
        const zn = ZONES[i], a = Math.random() * 6.28, d = Math.random() * zn.r;
        const x = zn.x + Math.cos(a) * d, z = zn.z + Math.sin(a) * d;
        this.fx.emit(x, islandH(x, z) + 0.3, z, { count: 1, colors: ['#3a2852', '#6b3fa0', '#1f1830'], speed: 0.3, up: 1.2, gravity: -0.6, size: 0.35, life: 3 });
      }
    });

    // the garden lives its life
    this.garden.update(dt, t, this.attract ? null : this.player);

    if (this.attract) {
      const a = t * 0.05;
      this.camera.position.set(Math.cos(a) * 62, 30, Math.sin(a) * 62);
      this.camera.lookAt(0, 0, 0);
      this.lights.follow(_origin);
      this.fx.update(dt);
      return;
    }

    // player
    const I = this.app.input, P = this.player;
    const [cdx] = I.takeCam();
    this.camYaw -= cdx * 0.006;
    if (I.keys.has('q')) this.camYaw += dt * 2; if (I.keys.has('r')) this.camYaw -= dt * 2;
    const fwdX = -Math.cos(this.camYaw), fwdZ = -Math.sin(this.camYaw);
    const rx = -fwdZ, rz = fwdX;
    const mx = fwdX * I.moveY + rx * I.moveX, mz = fwdZ * I.moveY + rz * I.moveX;
    P.step(dt, { mx, mz, jump: I.jump, jumpPressed: I.jumpPressed, dashPressed: I.dashPressed }, this.world);
    // keep inside the world
    const pr = Math.hypot(P.x, P.z); if (pr > 62) { P.x *= 62 / pr; P.z *= 62 / pr; }
    if (P.y < -3) { P.x = SPAWN.x; P.z = SPAWN.z; P.y = 4; }
    P.c.update(dt);
    PUSH.value.set(P.x, P.z, 1.1 + (P.P.radius || 0.4), P.grounded ? 1 : 0.4);
    // bump into the garden folk
    for (const { b } of this.garden.roamers) {
      const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz), R = b.P.radius + P.P.radius;
      if (d < R && d > 0.01) { const k = (R - d) / d * 0.5; b.x += dx * k; b.z += dz * k; P.x -= dx * k; P.z -= dz * k; }
    }

    // camera
    _target.set(P.x, Math.max(P.y, 0) + 1.2, P.z);
    this.camTarget.lerp(_target, Math.min(1, dt * 6));
    const cd = this.camDist * (this.camera.aspect < 1 ? 1.5 : 1);
    this.camera.position.set(
      this.camTarget.x + Math.cos(this.camYaw) * Math.cos(this.camPitch) * cd,
      this.camTarget.y + Math.sin(this.camPitch) * cd,
      this.camTarget.z + Math.sin(this.camYaw) * Math.cos(this.camPitch) * cd);
    const ch = islandH(this.camera.position.x, this.camera.position.z) + 1;
    if (this.camera.position.y < ch) this.camera.position.y = ch;
    this.camera.lookAt(this.camTarget);
    this.lights.follow(this.camTarget);
    this.fx.update(dt);

    // proximity prompts
    let near = null, best = 2.8;
    for (const r of this.garden.roamers) { const d = Math.hypot(P.x - r.b.x, P.z - r.b.z); if (d < best) { best = d; near = { kind: 'roamer', r }; } }
    ZONES.forEach((zn, i) => { if (Math.hypot(P.x - zn.x, P.z - zn.z) < 5) near = { kind: 'zone', i }; });
    if (Math.hypot(P.x - this.easel.position.x, P.z - this.easel.position.z) < 3.5) near = { kind: 'easel' };
    this.showPrompt(near);
    if (near && I.interactPressed) this.activate(near);
    if (near?.kind === 'roamer' && near.r.pet && I.pressed.has('f')) this.app.swapTo(near.r);
  }

  showPrompt(near) {
    const el = $('prompt');
    const key = near ? near.kind + (near.i ?? '') + (near.r ? near.r.c.design.name + near.r.state : '') : '';
    if (key === this.promptKey) return;
    this.promptKey = key;
    if (!near) { el.classList.add('hidden'); return; }
    if (near.kind === 'easel') {
      const nm = escapeHtml(this.player.c.design.name);
      el.innerHTML = `<h2><span class="jp">型取り</span>Mold Lab</h2><p>Redraw ${nm} (new shape = new stats), or make a brand-new monster. Everyone you make keeps living on the island.</p>
        <div class="row"><button class="btn primary" id="p-go">Edit ${nm} <kbd>E</kbd></button><button class="btn" id="p-new">New monster</button></div>`;
    } else if (near.kind === 'roamer') {
      const r = near.r, nm = escapeHtml(r.name);
      const mood = { nap: 'is napping. Zzz…', play: 'is bouncing around.', follow: 'is following you around.', chat: 'is gossiping.', greet: 'says hi!' }[r.state] || 'is hanging out.';
      el.innerHTML = `<h2><span class="jp">${r.pet ? '仲間' : '島民'}</span>${nm}${r.pet ? '<em>YOURS</em>' : ''}</h2><p>${nm} ${mood}${r.pet ? ' Swap to play as this monster.' : ' A local of the island.'}</p>
        <div class="row"><button class="btn primary" id="p-go">Pet <kbd>E</kbd></button>${r.pet ? '<button class="btn" id="p-swap">Play as them <kbd>F</kbd></button>' : ''}</div>`;
    } else {
      const zn = ZONES[near.i], done = this.app.save.orbs.includes(near.i);
      el.innerHTML = `<h2><span class="jp">${zn.jp}</span>${zn.name}${done ? '<em>CLEARED</em>' : ''}</h2><p>${zn.desc}</p><div class="row"><button class="btn primary" id="p-go">${done ? 'Play again' : 'Play'} <kbd>E</kbd></button></div>`;
    }
    el.classList.remove('hidden');
    $('p-go').onclick = () => this.activate(near);
    if ($('p-new')) $('p-new').onclick = () => { this.promptKey = null; el.classList.add('hidden'); this.app.newMonster(); };
    if ($('p-swap')) $('p-swap').onclick = () => this.app.swapTo(near.r);
    if (near.kind !== 'roamer') sfx.pop(1.4);
  }

  activate(near) {
    if (near.kind === 'roamer') { this.garden.pet(near.r); this.promptKey = null; return; }
    this.promptKey = null; $('prompt').classList.add('hidden');
    if (near.kind === 'easel') this.app.editMonster();
    else this.startEvent(near.i);
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    this.activeEvent?.resize?.();
  }
}
