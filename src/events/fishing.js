// Pier Fishing (釣り): cast from the end of a pier, hook the bite, reel in cursed clay fish. Beat the target weight.
import * as THREE from 'three';
import { EventBase } from './base.js';
import { terrainMesh, terrainMaterial, plantGrass, plantFlowers, plantTrees, placeRocks, grassHeight, modelSize, pbr } from '../world/nature.js';
import { makeClayMaterial } from '../fx/clay.js';
import { rng, PALETTES } from '../creature/generator.js';
import { smoothstep, fbm2 } from '../game/noise.js';
import { sfx, babble } from '../fx/audio.js';

const SESSION = 75, TARGET = 6;
const DECK = 1.3, PIER0 = -8, PIER1 = 14, PW = 1.6; // deck height, pier start/end (x), half width
const SPOT = PIER1 - 1.2;                              // where the monster stands

const shoreX = (z) => -3 + Math.min(z * z * 0.028, 58) + fbm2(z * 0.05, 3.1) * 3; // a cove: headlands either side
function groundH(x, z) {
  const d = shoreX(z) - x; // > 0 inland
  const land = 0.4 + smoothstep(0, 10, d) * 2.2 + fbm2(x * 0.08, z * 0.08) * 1.4 * smoothstep(2, 12, d);
  const sea = -1.2 - smoothstep(0, 22, -d) * 5;
  const k = smoothstep(-3, 2, d);
  return sea * (1 - k) + land * k;
}
const onPier = (x, z) => Math.abs(z) < PW && x > PIER0 && x < PIER1;
const pierH = (x, z) => (onPier(x, z) ? DECK : groundH(x, z));

// ---------------- the fish ----------------
const TIERS = [
  { name: 'Common', w: [0.25, 0.9], speed: 0.6, jump: 0.18, drain: 0.2 },
  { name: 'Odd', w: [0.8, 1.8], speed: 0.9, jump: 0.32, drain: 0.23 },
  { name: 'Rare', w: [1.7, 3.2], speed: 1.25, jump: 0.5, drain: 0.27 },
  { name: 'Cursed', w: [3.2, 5.6], speed: 1.6, jump: 0.65, drain: 0.33 },
];
const ADJ = ['Moist', 'Damp', 'Soggy', 'Haunted', 'Sad', 'Grumpy', "Lil'", 'Big', 'Suspicious', 'Unwell', 'Crusty', 'Petty', 'Sleepy', 'Divorced', 'Forbidden', 'Squishy', 'Sweaty', 'Lumpy', 'Confused', 'Clammy'];
const GIVEN = ['Gregory', 'Linda', 'Kevin', 'Doug', 'Brenda', 'Toothy', 'Steve', 'Barbara', 'Gary', 'Doreen', 'Clive', 'Pam', 'Nigel', 'Gloria', 'Trevor', 'Marge'];
const THING = ['Sock', 'Boot', 'Spoon', 'Mitten', 'Sausage', 'Teacup', 'Lasagna', 'Biscuit', 'Gravy', 'Noodle', 'Pickle', 'Hat'];
const FISHW = ['Eel', 'Carp', 'Trout', 'Bass', 'Guppy', 'Pike', 'Minnow', 'Cod', 'Ray', 'Sprat'];
const PRE = ['Grump', 'Blub', 'Snot', 'Gloop', 'Wob', 'Flump', 'Drool', 'Sulk', 'Bonk', 'Murk', 'Gurgle'];
const SUF = ['fin', 'gill', 'mouth', 'scale', 'belly', 'snout', 'lips', 'tail'];
const TITLE = ['Sir', 'Lady', 'Lord', 'Professor', 'Mayor', 'Saint', 'Duke'];
const EPI = ['the Unblinking', 'of the Deep', 'the Damp', 'Who Hums', 'the Regrettable', 'Eater of Socks', 'the Moist'];
const pick = (r, a) => a[(r() * a.length) | 0];

function fishName(r, tier) {
  if (tier >= 2 && r() < 0.75) return r() < 0.5 ? `${pick(r, TITLE)} ${pick(r, GIVEN)} ${pick(r, EPI)}` : `${pick(r, PRE)}${pick(r, SUF)} ${pick(r, EPI)}`;
  const k = r();
  if (k < 0.35) return `${pick(r, ADJ)} ${pick(r, GIVEN)}`;
  if (k < 0.65) return `${pick(r, THING)} ${pick(r, FISHW)}`;
  if (k < 0.9) return pick(r, PRE) + pick(r, SUF);
  return "Lil' " + pick(r, ['Toothy', 'Gregory', 'Snot', 'Gloop', 'Pam']);
}

function rollFish(pow) {
  const wts = [1 - pow * 0.7, 0.5 + pow * 0.3, pow * pow * 0.8, Math.max(0, pow - 0.7) * 1.2];
  let u = Math.random() * wts.reduce((a, b) => a + b, 0), tier = 0;
  while (tier < 3 && u > wts[tier]) { u -= wts[tier]; tier++; }
  const T = TIERS[tier], seed = (Math.random() * 1e9) | 0, r = rng(seed);
  const weight = Math.max(0.1, Math.round((T.w[0] + (T.w[1] - T.w[0]) * Math.pow(r(), 1.4)) * 10) / 10);
  return { tier, seed, weight, name: fishName(r, tier) };
}

// ---------------- CSS (once) ----------------
const CSS = `
.fs-meter { position: absolute; right: 34px; top: 50%; height: min(250px, 42vh); width: 46px; box-sizing: content-box; transform: translateY(-50%) skewX(-6deg); display: none; gap: 5px; padding: 6px;
  background: var(--ink); border: 3px solid var(--ink); box-shadow: 6px 6px 0 var(--red); pointer-events: none; }
.fs-meter.fs-on { display: flex; animation: fs-in .18s ease-out; }
.fs-col { position: relative; flex: 1; overflow: hidden; background: #1d4766; background-image: radial-gradient(rgba(251, 248, 240, .13) 1px, transparent 1.3px); background-size: 6px 6px; }
.fs-prog { position: relative; width: 9px; background: rgba(251, 248, 240, .14); }
.fs-prog i { position: absolute; left: 0; right: 0; bottom: 0; background: var(--yellow); }
.fs-prog i.fs-low { background: var(--red); }
.fs-zone { position: absolute; left: 2px; right: 2px; background: rgba(255, 210, 63, .28); border: 2px solid var(--yellow); box-sizing: border-box; }
.fs-zone.fs-in { background: rgba(255, 210, 63, .62); }
.fs-fish { position: absolute; left: 50%; width: 30px; height: 18px; margin-left: -15px; transform: translateY(50%); }
.fs-fill { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, var(--yellow), var(--red)); }
.fs-far { position: absolute; left: 0; right: 0; top: 0; height: 24%; border-bottom: 2px dashed var(--yellow); color: var(--yellow); font: 400 13px var(--dot); text-align: center; padding-top: 3px;
  background: repeating-linear-gradient(-45deg, rgba(255, 210, 63, .22) 0 5px, transparent 5px 10px); }
.fs-meter[data-mode="cast"] .fs-zone, .fs-meter[data-mode="cast"] .fs-fish, .fs-meter[data-mode="cast"] .fs-prog { display: none; }
.fs-meter[data-mode="reel"] .fs-fill, .fs-meter[data-mode="reel"] .fs-far { display: none; }
.fs-meter.fs-shake .fs-col { animation: fs-shake .12s linear infinite; }
.fs-lbl { position: absolute; left: -3px; right: -3px; bottom: -30px; background: var(--yellow); color: var(--ink); font: 400 13px var(--dot); text-align: center; padding: 2px 0; border: 2px solid var(--ink); white-space: nowrap; }
.fs-card { position: absolute; top: 74px; left: 50%; transform: translateX(-50%) skewX(-6deg); min-width: 210px; max-width: min(330px, 86vw); text-align: center; pointer-events: none;
  background: var(--paper); border: 3px solid var(--ink); box-shadow: 6px 6px 0 var(--red); opacity: 0; transition: opacity .3s; }
.fs-card.fs-on { opacity: 1; animation: fs-pop .45s cubic-bezier(.2, 1.4, .4, 1); }
.fs-card-h { display: flex; justify-content: space-between; gap: 12px; background: var(--ink); color: var(--yellow); font: 400 13px var(--dot); padding: 3px 10px; }
.fs-card b { display: block; font: 400 21px/1.15 var(--display); color: var(--ink); padding: 8px 12px 4px; }
.fs-card .fs-kg { display: inline-block; font: 400 18px var(--dot); background: var(--red); color: var(--white); padding: 1px 10px; margin: 2px 0 10px; }
.fs-card .fs-tier { display: inline-block; font: 400 13px var(--dot); color: var(--ink-soft); margin-left: 8px; }
.fs-hint { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); max-width: 90vw; text-align: center; pointer-events: none;
  font: 700 13px var(--ui); color: var(--white); background: rgba(21, 23, 43, .86); padding: 7px 16px; box-shadow: 4px 4px 0 var(--red); opacity: 0; transition: opacity .6s; }
.fs-hint.fs-on { opacity: 1; }
.fs-hint b { color: var(--yellow); font-weight: 900; }
.fs-of { font-size: 15px; opacity: .7; }
.fs-hot.fs-hot { background: var(--red); color: var(--white); box-shadow: 4px 4px 0 var(--ink); }
.fs-done.fs-done { color: var(--ink); background: var(--yellow); box-shadow: 4px 4px 0 var(--red); }
@keyframes fs-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fs-pop { 0% { transform: translateX(-50%) skewX(-6deg) scale(1.6); opacity: 0; } 100% { transform: translateX(-50%) skewX(-6deg) scale(1); opacity: 1; } }
@keyframes fs-shake { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(2px); } }
@media (pointer: coarse) { .fs-hint { bottom: calc(196px + env(safe-area-inset-bottom)); } .fs-meter { right: 26px; } }
@media (pointer: coarse) and (max-height: 520px) { .fs-meter { right: 150px; } .fs-hint { bottom: 18px; } .fs-card { top: 62px; } }
`;
const FISH_SVG = '<svg class="fs-fish" viewBox="0 0 30 18"><path d="M2 9 Q11 0 21 9 Q11 18 2 9Z" fill="#ffd23f" stroke="#15172b" stroke-width="2"/><path d="M20 9 L29 2 L29 16Z" fill="#e63b2e" stroke="#15172b" stroke-width="2" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="#15172b"/></svg>';

export class FishingEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, { rivals: 0 });
    this.height = pierH;
    this.disposables = [];
    this.build();
    const b = this.player;
    b.x = SPOT; b.z = 0; b.y = DECK; b.heading = 0; b.vx = b.vy = b.vz = 0; b.grounded = true; b.sync();
    this.buildRod();
    this.phase = 'ready'; this.pt = 0; this.pow = 0;
    this.total = 0; this.catches = []; this.goalHit = false;
    this.tr = { casts: 0, powSum: 0, missed: 0, spooked: 0, escapes: 0 };
    this.camOut = 0; this.celebT = 0; this.hintT = 0; this.cardT = 0; this.T = 0; this.tickT = 0;
    this.hintsShown = {};
    this.setupDom();
    this.hud(`<span class="pill" id="fs-time">${SESSION}</span><span class="pill" id="fs-kg">0.0<span class="fs-of"> / ${TARGET} kg</span></span>`);
  }

  // ---------------- scene ----------------
  build() {
    const s = this.scene, r = rng(31);
    const splat = (x, h, z, ny) => {
      const rock = smoothstep(0.8, 0.55, ny);
      const sand = smoothstep(1.3, 0.5, h) * (1 - rock);
      const dirt = (x < shoreX(z) - 2 && Math.abs(z) < 2.2 ? 0.8 : 0) * (1 - rock) * (1 - sand);
      return [Math.max(0, 1 - rock - sand - dirt), dirt, sand, rock];
    };
    s.add(terrainMesh(groundH, { size: [160, 200], seg: [220, 280], center: [10, 0], splatFn: splat, material: terrainMaterial({ path: 'rocky_trail' }) }));
    this.makeWater(groundH, [-70, -100, 200]);

    // grass, flowers and trees on the bay's shore and headlands
    const gH = grassHeight(), grass = [], flowers = [], trees = [];
    for (let i = 0; i < 22000; i++) {
      const x = -30 + r() * 80, z = (r() - 0.5) * 120, h = groundH(x, z);
      if (h < 1.3 || (Math.abs(z) < 2.4 && x > PIER0 - 4)) continue;
      grass.push({ x, y: h - 0.03, z, s: (0.4 + r() * 0.35) / gH, ry: r() * 6.28, hue: r(), lum: r() });
      if (r() < 0.02) flowers.push({ x, y: h, z, s: (0.35 + r() * 0.2) / modelSize('flower_white').y, ry: r() * 6.28 });
    }
    plantGrass(s, grass); plantFlowers(s, flowers);
    for (let i = 0; i < 70; i++) {
      const z = (r() - 0.5) * 150, x = shoreX(z) - 5 - r() * 24;
      if (Math.abs(z) < 6 && x > PIER0 - 10) continue;
      trees.push({ x, y: groundH(x, z) - 0.2, z, h: 6 + r() * 5, ry: r() * 6.28, kind: (r() * 6) | 0 });
    }
    // rocks: boulders on the beach, sea stacks out in the bay
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    const rocks = [];
    for (let i = 0; i < 30; i++) {
      const z = (r() - 0.5) * 110, x = shoreX(z) + (r() - 0.6) * 4;
      if (Math.abs(z) < 5) continue;
      rocks.push({ x, y: groundH(x, z) - 0.3, z, s: (0.8 + r() * 1.8) / rs, sy: 0.7, ry: r() * 6.28 });
    }
    for (let i = 0; i < 10; i++) {
      const x = 48 + r() * 60, z = (r() < 0.5 ? -1 : 1) * (14 + r() * 40);
      rocks.push({ x, y: -3, z, s: (5 + r() * 6) / rs, sy: 1.1 + r() * 1.2, ry: r() * 6.28 });
      if (r() < 0.5) trees.push({ x, y: 2.5 + r() * 2, z, h: 4 + r() * 3, ry: r() * 6.28, kind: 4 + ((r() * 2) | 0) });
    }
    placeRocks(s, rocks); plantTrees(s, trees);

    // ---- the weathered pier ----
    const len = PIER1 - PIER0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(PW * 2, 0.16, len), pbr('wood_planks', 1.2, len / 2.6, { color: '#d8c6a8' }));
    deck.rotation.y = Math.PI / 2; deck.position.set((PIER0 + PIER1) / 2, DECK - 0.08, 0);
    deck.castShadow = deck.receiveShadow = true; s.add(deck);
    const bark = pbr('bark_brown_02', 1, 3), beamMat = pbr('bark_brown_02', 6, 1);
    for (const z of [-PW + 0.12, PW - 0.12]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.26, 0.2), beamMat);
      beam.position.set((PIER0 + PIER1) / 2, DECK - 0.29, z); beam.castShadow = true; s.add(beam);
    }
    for (let x = PIER1 - 0.2; x > PIER0 + 1; x -= 2.4) {
      for (const z of [-PW + 0.05, PW - 0.05]) {
        const bot = groundH(x, z) - 0.5, top = DECK + (x > PIER1 - 1 ? 0.75 : -0.1);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, top - bot, 12), bark);
        p.position.set(x, (top + bot) / 2, z); p.rotation.z = (r() - 0.5) * 0.05; p.castShadow = true; s.add(p);
      }
    }
    // a lantern post at the far corner, a crate for the fish
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 10), bark);
    lp.position.set(PIER1 - 0.25, DECK + 1.1, -PW + 0.15); lp.castShadow = true; s.add(lp);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.3), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb02e', emissiveIntensity: 0.9, roughness: 0.4 }));
    lamp.position.set(PIER1 - 0.25, DECK + 2.25, -PW + 0.15); s.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 4), new THREE.MeshStandardMaterial({ color: '#15172b', roughness: 0.6 }));
    cap.position.set(PIER1 - 0.25, DECK + 2.54, -PW + 0.15); cap.rotation.y = Math.PI / 4; s.add(cap);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.75), pbr('wood_planks', 0.5, 0.5));
    crate.position.set(SPOT - 5, DECK + 0.3, -0.85); crate.rotation.y = 0.3; crate.castShadow = crate.receiveShadow = true; s.add(crate);

    // ripples on the water (a small pool) + the shadow of a curious fish
    this.ripples = [];
    const rg = new THREE.RingGeometry(0.82, 1, 40); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      m.position.y = 0.04; m.visible = false; m.renderOrder = 2; m.userData = { t: 1, life: 1, size: 1 }; s.add(m); this.ripples.push(m);
    }
    const sg = new THREE.CircleGeometry(0.5, 24); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: '#06202e', transparent: true, opacity: 0, depthWrite: false }));
    this.shadow.position.y = 0.05; this.shadow.renderOrder = 2; this.shadow.scale.set(1.6, 1, 0.7); s.add(this.shadow);
    this.disposables.push(rg, sg);
  }

  buildRod() {
    const s = this.scene, c = this.player.c;
    const h = Math.max(0.6, c.height || 1), rad = this.player.P.radius || 0.4;
    this.rodLen = 2.1 + h * 0.6;
    this.rod = new THREE.Group();
    this.rod.position.set(SPOT - rad * 0.1, DECK + h * 0.4, rad * 0.55 + 0.08);
    const rodMat = new THREE.MeshStandardMaterial({ color: '#d9b26a', roughness: 0.55 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: '#e63b2e', roughness: 0.5 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.05, this.rodLen, 8), rodMat);
    pole.position.y = this.rodLen / 2; pole.castShadow = true; this.rod.add(pole);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.5, 10), new THREE.MeshStandardMaterial({ color: '#15172b', roughness: 0.7 }));
    grip.position.y = 0.1; this.rod.add(grip);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14), wrapMat);
    reel.rotation.x = Math.PI / 2; reel.position.set(0.09, 0.3, 0); this.rod.add(reel); this.reel = reel;
    for (let k = 1; k < 4; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04 - k * 0.006, 0.012, 6, 12), wrapMat);
      ring.rotation.x = Math.PI / 2; ring.position.y = this.rodLen * (0.3 + k * 0.2); this.rod.add(ring);
    }
    this.tip = new THREE.Object3D(); this.tip.position.y = this.rodLen; this.rod.add(this.tip);
    this.rodAng = 0.8; this.rod.rotation.z = -this.rodAng;
    s.add(this.rod);

    // bobber: red cap, white belly, a little stick
    this.bobber = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e63b2e', roughness: 0.35 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.35 }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), new THREE.MeshStandardMaterial({ color: '#15172b' }));
    stick.position.y = 0.24; top.castShadow = bot.castShadow = true;
    this.bobber.add(top, bot, stick); s.add(this.bobber);

    // the line
    this.lineN = 24;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.lineN * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#fbf8f0', transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false; s.add(this.line);
    this.tipPos = new THREE.Vector3(); this.land = new THREE.Vector3(); this.from = new THREE.Vector3();
    this.updateRod(0);
    this.bobber.position.copy(this.tipPos).add(new THREE.Vector3(0, -0.6, 0));
  }

  makeFishMesh(f) {
    const r = rng(f.seed), tier = f.tier;
    const [ca, cb] = PALETTES[(r() * PALETTES.length) | 0];
    const pattern = tier >= 3 ? pick(r, ['lava', 'stars']) : pick(r, ['solid', 'spots', 'stripes', 'patches', 'belly', 'speckle', 'gradient']);
    const mat = makeClayMaterial({ color: ca, color2: cb, pattern, seed: f.seed % 1000, scale: 1.6, finish: tier >= 2 && r() < 0.5 ? 'vinyl' : 'clay' });
    const finMat = makeClayMaterial({ color: cb, color2: ca, pattern: 'solid', seed: (f.seed >> 3) % 1000 });
    const eyeMat = this.eyeMat || (this.eyeMat = new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.3 }));
    const pupMat = this.pupMat || (this.pupMat = new THREE.MeshStandardMaterial({ color: '#15172b', roughness: 0.2 }));
    const geos = [], mats = [];
    const G = (g) => (geos.push(g), g);
    const outer = new THREE.Group(), inner = new THREE.Group(), flex = new THREE.Group();
    outer.add(inner); inner.add(flex);
    const sy = 0.6 + r() * 0.28, sz = 0.42 + r() * 0.12, sx = 1 + (tier >= 2 ? r() * 0.3 : 0);
    const body = new THREE.Mesh(G(new THREE.SphereGeometry(0.5, 26, 18)), mat);
    body.scale.set(sx, sy, sz); body.castShadow = true; flex.add(body);
    // tail(s)
    const tails = tier >= 2 && r() < 0.6 ? 2 : 1;
    for (let k = 0; k < tails; k++) {
      const t = new THREE.Mesh(G(new THREE.ConeGeometry(0.3, 0.46, 14)), finMat);
      t.scale.z = 0.22; t.rotation.z = -Math.PI / 2 + (tails > 1 ? (k ? 0.5 : -0.5) : 0);
      t.position.set(-0.5 * sx - 0.14, tails > 1 ? (k ? 0.12 : -0.12) : 0, 0); t.castShadow = true; flex.add(t);
    }
    const dorsal = new THREE.Mesh(G(new THREE.ConeGeometry(0.15, 0.3 + r() * 0.15, 10)), finMat);
    dorsal.scale.z = 0.25; dorsal.rotation.z = 0.55; dorsal.position.set(-0.04, 0.5 * sy + 0.06, 0); flex.add(dorsal);
    if (tier >= 3) { // a spiky back + a crown, because it's cursed
      for (let k = 0; k < 4; k++) {
        const sp = new THREE.Mesh(G(new THREE.ConeGeometry(0.05, 0.18, 6)), finMat);
        sp.position.set(0.25 - k * 0.17, 0.5 * sy * (1 - Math.pow((0.25 - k * 0.17) / 0.5, 2) * 0.5) + 0.02, 0); sp.rotation.z = 0.3; flex.add(sp);
      }
      const gold = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.3, metalness: 0.4 }); mats.push(gold);
      for (let k = 0; k < 5; k++) {
        const pt = new THREE.Mesh(G(new THREE.ConeGeometry(0.035, 0.12, 5)), gold);
        const a = (k / 5) * Math.PI * 2;
        pt.position.set(0.28 + Math.cos(a) * 0.07, 0.5 * sy + 0.02, Math.sin(a) * 0.07); flex.add(pt);
      }
    }
    // mouth: lips or teeth
    if (r() < 0.45 || /Moist|lips/.test(f.name)) {
      const lipMat = new THREE.MeshStandardMaterial({ color: '#ef6f8f', roughness: 0.35 }); mats.push(lipMat);
      const lips = new THREE.Mesh(G(new THREE.TorusGeometry(0.07, 0.035, 8, 16)), lipMat);
      lips.rotation.y = Math.PI / 2; lips.position.set(0.5 * sx - 0.02, -0.04, 0); flex.add(lips);
    } else if (r() < 0.6 || /Toothy|mouth/.test(f.name)) {
      for (const z of [-0.05, 0.05]) {
        const tooth = new THREE.Mesh(G(new THREE.ConeGeometry(0.03, 0.08, 5)), eyeMat);
        tooth.rotation.z = Math.PI; tooth.position.set(0.5 * sx - 0.03, -0.1, z); flex.add(tooth);
      }
    }
    // googly eyes: one each side, rarer fish get extras on top
    const eyes = [];
    const addEye = (x, y, z, er, dir) => {
      const e = new THREE.Group(); e.position.set(x, y, z);
      const w = new THREE.Mesh(G(new THREE.SphereGeometry(er, 14, 10)), eyeMat);
      const p = new THREE.Mesh(G(new THREE.SphereGeometry(er * 0.5, 10, 8)), pupMat); p.position.set(er * 0.25, 0, er * 0.65);
      const wob = new THREE.Group(); wob.add(p); e.add(w, wob);
      if (dir === 'down') e.rotation.x = Math.PI; else if (dir === 'up') e.rotation.x = -Math.PI / 2;
      flex.add(e); eyes.push(wob);
    };
    const er = 0.1 + r() * 0.05, ex = 0.26 * sx, ey = 0.06;
    const ez = 0.5 * sz * Math.sqrt(Math.max(0.05, 1 - Math.pow(ex / (0.5 * sx), 2) - Math.pow(ey / (0.5 * sy), 2))) * 0.92;
    addEye(ex, ey, ez, er, 'side'); addEye(ex, ey, -ez, er, 'down');
    const extra = tier === 1 ? (r() < 0.4 ? 1 : 0) : tier === 2 ? 1 + ((r() * 2) | 0) : tier === 3 ? 3 : 0;
    for (let k = 0; k < extra; k++) addEye(0.15 - k * 0.14 + r() * 0.05, 0.5 * sy * 0.88, (r() - 0.5) * 0.12, er * (0.7 + r() * 0.4), 'up');
    const size = 0.42 + Math.cbrt(f.weight) * 0.38;
    outer.scale.setScalar(size);
    outer.userData = { size, eyes, flex, inner, vy: 0, y0: 0, flopT: 1 + Math.random() * 3, wob: 0, ph: Math.random() * 9 };
    this.disposables.push(mat, finMat, ...mats, ...geos);
    return outer;
  }

  // ---------------- DOM ----------------
  setupDom() {
    if (!document.getElementById('fishing-css')) {
      const st = document.createElement('style'); st.id = 'fishing-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const root = document.getElementById('event-hud').parentElement;
    const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; const n = d.firstElementChild; root.appendChild(n); return n; };
    this.meter = el(`<div class="fs-meter" data-mode="cast"><div class="fs-col"><div class="fs-far">★</div><div class="fs-fill"></div><div class="fs-zone"></div>${FISH_SVG}</div><div class="fs-prog"><i></i></div><div class="fs-lbl">CAST 投</div></div>`);
    this.card = el('<div class="fs-card"></div>');
    this.hint = el('<div class="fs-hint"></div>');
    this.m = {
      fill: this.meter.querySelector('.fs-fill'), zone: this.meter.querySelector('.fs-zone'), fish: this.meter.querySelector('.fs-fish'),
      prog: this.meter.querySelector('.fs-prog i'), lbl: this.meter.querySelector('.fs-lbl'),
    };
    this.touch = window.matchMedia?.('(pointer: coarse)').matches;
    this.say('cast');
  }

  say(kind) {
    if (this.hintsShown[kind]) return;
    this.hintsShown[kind] = true;
    const btn = this.touch ? '<b>跳</b>' : '<kbd>SPACE</kbd>';
    const t = {
      cast: `Hold ${btn} to cast · let go near the top for a far cast`,
      wait: 'Little twitches are nibbles. Wait for the big <b>!</b> then press',
      reel: `Hold ${btn} to lift the zone · keep the fish inside`,
    }[kind];
    this.hint.innerHTML = t; this.hint.classList.add('fs-on'); this.hintT = kind === 'cast' ? 9.5 : 4.5;
  }

  showMeter(mode) {
    if (!mode) { this.meter.classList.remove('fs-on', 'fs-shake'); return; }
    this.meter.dataset.mode = mode;
    this.m.lbl.textContent = mode === 'cast' ? 'CAST 投' : 'REEL 巻';
    this.meter.classList.add('fs-on');
  }

  showCard(f) {
    const stars = '★'.repeat(f.tier + 1) + '☆'.repeat(3 - f.tier);
    this.card.innerHTML = `<div class="fs-card-h"><span>釣れた! CAUGHT</span><span>${stars}</span></div><b>${f.name}</b><span class="fs-kg">${f.weight.toFixed(1)} kg</span><span class="fs-tier">${TIERS[f.tier].name}</span>`;
    this.card.classList.remove('fs-on'); void this.card.offsetWidth; this.card.classList.add('fs-on');
    this.cardT = 2.8;
  }

  updatePills() {
    const left = Math.max(0, Math.ceil(SESSION - this.time));
    const tm = document.getElementById('fs-time');
    if (tm && tm.dataset.v !== String(left)) { tm.dataset.v = left; tm.textContent = left; tm.classList.toggle('fs-hot', left <= 10); }
    const kg = document.getElementById('fs-kg');
    const txt = this.total.toFixed(1);
    if (kg && kg.dataset.v !== txt) { kg.dataset.v = txt; kg.innerHTML = `${txt}<span class="fs-of"> / ${TARGET} kg</span>`; kg.classList.toggle('fs-done', this.total >= TARGET); }
  }

  // ---------------- camera ----------------
  camWant() {
    const k = 1 + (this.zk - 1) * 0.65, b = this.bobber.position; // portrait: back off, but keep the monster big
    const far = this.camOut * Math.max(0, b.x - SPOT - 6);
    const pos = new THREE.Vector3(SPOT - (6.8 + far * 0.15) * k, DECK + (2.9 + far * 0.07) * k, k > 1 ? 1.4 : 3.6 + far * 0.08); // portrait: more from behind, so monster + bobber both fit
    const look = new THREE.Vector3(SPOT + 3.5 + far * (k > 1 ? 0.3 : 0.6), 0.9, -0.2 + this.camOut * b.z * 0.4);
    return { pos, look };
  }

  introCam(k) {
    const e = k * k * (3 - 2 * k), w = this.camWant();
    this.camera.position.set(SPOT + 34, 12, -22).lerp(w.pos, e);
    this.camera.lookAt(new THREE.Vector3(SPOT - 2, DECK, 0).lerp(w.look, e));
  }

  followCam(dt) {
    this.app.input.takeCam();
    const out = ['flight', 'wait', 'bite', 'reel'].includes(this.phase) ? 1 : 0;
    this.camOut += (out - this.camOut) * Math.min(1, dt * 1.2);
    const w = this.camWant();
    if (!this.camPos) { this.camPos = w.pos.clone(); this.camLook = w.look.clone(); }
    this.camPos.lerp(w.pos, Math.min(1, dt * 2.5)); this.camLook.lerp(w.look, Math.min(1, dt * 2.5));
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
  }

  // ---------------- game loop ----------------
  update(dt, t) {
    super.update(dt, t);
    this.animate(dt);
  }

  setPhase(p) { this.phase = p; this.pt = 0; }

  step(dt, after) {
    if (after || this.ended) return;
    const I = this.app.input, press = I.jumpPressed, hold = I.jump;
    this.pt += dt;
    const S = this.player.c.stats;
    switch (this.phase) {
      case 'ready':
        if (press) { this.setPhase('charge'); this.pow = 0; this.showMeter('cast'); }
        break;
      case 'charge': {
        const prev = this.pow;
        const u = (this.pt / 1.1) % 2; this.pow = 1 - Math.abs(u - 1);
        if (prev < 0.97 && this.pow >= 0.97) sfx.click();
        this.m.fill.style.height = (this.pow * 100).toFixed(1) + '%';
        if (!hold) this.cast();
        break;
      }
      case 'flight':
        if (this.pt >= this.flightDur) {
          this.setPhase('wait');
          this.world.splash(this.land.x, 0.1, this.land.z); this.ripple(this.land.x, this.land.z, 1.6);
          this.waitDur = 1.5 + Math.random() * 3.5;
          const n = (Math.random() * 4) | 0;
          this.nibbles = Array.from({ length: n }, () => 0.3 + Math.random() * Math.max(0.2, this.waitDur - 0.8)).sort((a, b) => a - b);
          this.say('wait');
        }
        break;
      case 'wait':
        if (press) { this.tr.spooked++; this.banner('Spooked!', 900); sfx.bonk(); this.retrieve(); break; }
        while (this.nibbles.length && this.pt >= this.nibbles[0]) {
          this.nibbles.shift(); this.dip = 0.12; this.ripple(this.bobber.position.x, this.bobber.position.z, 0.7); sfx.pop(2.2);
        }
        if (this.pt >= this.waitDur) {
          this.setPhase('bite');
          this.biteWin = 0.45 + S.balance * 0.04;
          this.banner('!', 650); sfx.pop(1.3); sfx.count(true);
          this.world.splash(this.bobber.position.x, 0.1, this.bobber.position.z); this.ripple(this.bobber.position.x, this.bobber.position.z, 2.2);
          try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(70); } catch { /* not supported */ }
        }
        break;
      case 'bite':
        if (press) this.hook(S);
        else if (this.pt > this.biteWin) { this.tr.missed++; this.banner('Too slow!', 900); sfx.bonk(); this.retrieve(); }
        break;
      case 'reel': this.reelStep(dt, hold); break;
      case 'catch':
        if (this.pt > 1.15) this.setPhase('ready');
        break;
      case 'retrieve':
        if (this.pt > 0.5) this.setPhase('ready');
        break;
    }
    if (this.state === 'play') {
      const busy = this.phase === 'bite' || this.phase === 'reel' || this.phase === 'catch';
      if (this.time >= SESSION && !busy) this.end();
      else if (this.time >= SESSION && busy && !this.lastCall) { this.lastCall = true; this.banner('Last fish!', 900); }
      else if (this.time >= SESSION + 15) this.end();
    }
    this.updatePills();
  }

  cast() {
    const p = this.pow;
    this.tr.casts++; this.tr.powSum += p;
    const dist = 4 + p * 26;
    this.updateRod(0);
    this.from.copy(this.tipPos);
    this.land.set(this.tipPos.x + dist, 0, (Math.random() - 0.5) * Math.min(7, dist * 0.28));
    this.flightDur = 0.55 + p * 0.5; this.castKick = 1;
    this.fish = rollFish(p);
    this.showMeter(null);
    this.setPhase('flight');
    sfx.whoosh();
    this.player.c.tilt.rotation.z = -0.18;
  }

  hook(S) {
    const f = this.fish, T = TIERS[f.tier];
    this.setPhase('reel');
    this.zoneH = Math.min(0.45, 0.2 + S.swim * 0.024);
    this.fillRate = (0.2 + S.power * 0.022) / (1 + f.weight * 0.07);
    this.drain = T.drain;
    this.fy = 0.5; this.fv = 0; this.ft = 0.5; this.fT = 0;
    this.zy = 0.5 - this.zoneH / 2; this.zv = 0; this.q = 0.3;
    this.reelFrom = this.bobber.position.clone();
    this.showMeter('reel'); this.say('reel');
    sfx.boing(1.5); babble(1.5, 2, 1);
  }

  reelStep(dt, hold) {
    const T = TIERS[this.fish.tier];
    // the fish darts to a new spot every so often
    this.fT -= dt;
    if (this.fT <= 0) {
      const range = 0.22 + T.jump * 0.7;
      this.ft = Math.max(0.16, Math.min(0.95, this.fy + (Math.random() - 0.5) * 2 * range));
      this.fT = (0.45 + Math.random() * 0.9) / T.speed;
    }
    this.fv += (this.ft - this.fy) * 16 * T.speed * dt; this.fv *= Math.pow(0.03, dt);
    this.fy = Math.max(0.03, Math.min(0.97, this.fy + this.fv * dt + Math.sin(this.T * 13) * 0.0015));
    // the catch zone: hold to lift it, let go and it sinks
    this.zv += (hold ? 2.8 : -2.3) * dt; this.zv *= Math.pow(0.4, dt);
    this.zy += this.zv * dt;
    if (this.zy < 0) { this.zy = 0; if (this.zv < 0) this.zv *= -0.25; }
    if (this.zy > 1 - this.zoneH) { this.zy = 1 - this.zoneH; if (this.zv > 0) this.zv *= -0.2; }
    const inside = this.fy >= this.zy - 0.015 && this.fy <= this.zy + this.zoneH + 0.015;
    this.q += (inside ? this.fillRate : -this.drain) * dt;
    if (hold) { this.tickT -= dt; if (this.tickT <= 0) { this.tickT = 0.16; sfx.click(); } }
    // DOM
    this.m.zone.style.bottom = (this.zy * 100).toFixed(2) + '%'; this.m.zone.style.height = (this.zoneH * 100).toFixed(2) + '%';
    this.m.zone.classList.toggle('fs-in', inside);
    this.m.fish.style.bottom = (this.fy * 100).toFixed(2) + '%';
    this.m.prog.style.height = (Math.max(0, Math.min(1, this.q)) * 100).toFixed(1) + '%';
    this.m.prog.classList.toggle('fs-low', this.q < 0.2);
    this.meter.classList.toggle('fs-shake', !inside);
    if (this.q >= 1) this.landFish();
    else if (this.q <= 0) {
      this.tr.escapes++; this.showMeter(null);
      this.banner('It got away!', 1000); sfx.bonk(); this.world.splash(this.bobber.position.x, 0.1, this.bobber.position.z);
      this.retrieve();
    }
  }

  landFish() {
    const f = this.fish, c = this.player.c;
    this.showMeter(null);
    const mesh = this.makeFishMesh(f);
    const i = this.catches.length;
    const slot = new THREE.Vector3(SPOT - 0.9 - ((i * 0.618) % 1) * 1.8, DECK + 0.13 * mesh.userData.size + Math.floor(i / 5) * 0.16, 0.55 + ((i * 0.377) % 1) * 0.8);
    mesh.position.copy(this.bobber.position); mesh.rotation.y = Math.random() * 6.28;
    mesh.userData.fly = { from: this.bobber.position.clone(), to: slot, t: 0, dur: 0.95 };
    mesh.userData.y0 = slot.y;
    this.scene.add(mesh);
    this.catches.push({ ...f, mesh });
    this.world.splash(this.bobber.position.x, 0.1, this.bobber.position.z);
    this.showCard(f); sfx.chime();
    c.motion.celebrate = 1; this.celebT = 1.7;
    babble(1.15 + Math.random() * 0.4, 3 + f.tier, 1);
    this.setPhase('catch');
    this.retrieveFrom = this.bobber.position.clone();
  }

  retrieve() {
    this.showMeter(null);
    this.retrieveFrom = this.bobber.position.clone();
    this.setPhase('retrieve');
  }

  // ---------------- visuals, every frame ----------------
  updateRod(dt) {
    const c = this.player.c;
    let want = 0.8;
    if (this.phase === 'charge') want = 0.8 - 1.2 * this.pow;
    else if (this.phase === 'reel') want = 0.45 + Math.sin(this.T * 22) * 0.04 * (this.app.input.jump ? 1 : 0.4);
    else if (this.phase === 'bite') want = 0.95;
    if (this.castKick > 0) { this.castKick = Math.max(0, this.castKick - dt * 3); want = 1.15 - (1 - this.castKick) * 0.35; }
    this.rodAng += (want - this.rodAng) * Math.min(1, dt * (this.phase === 'charge' ? 14 : 8) || 1);
    this.rod.rotation.z = -this.rodAng;
    this.rod.rotation.x = this.phase === 'reel' ? Math.sin(this.T * 7) * 0.06 : 0;
    this.reel.rotation.y += dt * (this.phase === 'reel' && this.app.input.jump ? 18 : this.phase === 'retrieve' ? 12 : 0);
    this.rod.updateMatrixWorld(true);
    this.tip.getWorldPosition(this.tipPos);
    // lean back while charging / fighting a fish
    const lean = this.phase === 'charge' ? 0.12 * this.pow : this.phase === 'reel' ? 0.1 + Math.sin(this.T * 9) * 0.03 : 0;
    const tl = c.tilt.rotation;
    tl.z += (lean - tl.z) * Math.min(1, dt * 6);
  }

  animate(dt) {
    this.T += dt;
    const b = this.bobber.position;
    this.updateRod(dt);
    let sag = 0;
    switch (this.phase) {
      case 'ready': case 'charge': case 'over': {
        const hang = this.tipPos.clone().add(new THREE.Vector3(Math.sin(this.T * 1.7) * 0.08, -0.55, Math.cos(this.T * 1.3) * 0.05));
        b.lerp(hang, Math.min(1, dt * 12));
        break;
      }
      case 'flight': {
        const u = Math.min(1, this.pt / this.flightDur);
        const apex = 2.5 + (this.land.x - this.from.x) * 0.12;
        b.lerpVectors(this.from, this.land, u); b.y = this.from.y + (this.land.y - this.from.y) * u + apex * 4 * u * (1 - u);
        break;
      }
      case 'wait': case 'bite': {
        this.dip = Math.max(0, (this.dip || 0) - dt * 0.6);
        const plunge = this.phase === 'bite' ? 0.24 + Math.sin(this.T * 30) * 0.04 : 0;
        b.set(this.land.x + (this.phase === 'bite' ? Math.sin(this.T * 23) * 0.05 : 0), 0.02 + Math.sin(this.T * 2.3) * 0.035 - this.dip - plunge, this.land.z);
        sag = 0.25 + (this.land.x - SPOT) * 0.015;
        break;
      }
      case 'reel': {
        const k = Math.max(0, Math.min(1, this.q)) * 0.85;
        const tx = this.reelFrom.x + (SPOT + 2.4 - this.reelFrom.x) * k, tz = this.reelFrom.z * (1 - k) + (this.fy - 0.5) * 1.6;
        b.x += (tx - b.x) * Math.min(1, dt * 4); b.z += (tz - b.z) * Math.min(1, dt * 5);
        b.y = -0.08 + Math.sin(this.T * 17) * 0.05;
        if (Math.random() < dt * 3) { this.fx.emit(b.x, 0.05, b.z, { count: 6, color: '#e8fbff', speed: 2, up: 3, gravity: 12, size: 0.22, life: 0.5 }); }
        if (Math.random() < dt * 1.5) this.ripple(b.x, b.z, 0.9);
        break;
      }
      case 'catch': case 'retrieve': {
        const u = Math.min(1, this.pt / 0.5), e = u * u * (3 - 2 * u);
        const hang = this.tipPos.clone().add(new THREE.Vector3(0, -0.55, 0));
        b.lerpVectors(this.retrieveFrom || b, hang, e); b.y += Math.sin(u * Math.PI) * 1.2;
        break;
      }
    }
    this.bobber.scale.setScalar(1 + Math.max(0, b.x - SPOT - 4) * 0.035); // far away: bigger, so it stays readable
    this.bobber.rotation.z = this.phase === 'bite' ? Math.sin(this.T * 25) * 0.3 : Math.sin(this.T * 2) * 0.08;

    // line from the rod tip to the bobber, with a little slack when it's sitting
    const pos = this.line.geometry.attributes.position, N = this.lineN, tp = this.tipPos;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      let y = tp.y + (b.y + 0.12 - tp.y) * u - sag * 4 * u * (1 - u) * 1.5;
      if (this.phase === 'wait' || this.phase === 'bite') y = Math.max(y, 0.02 + (b.y - 0.02) * u * u);
      const vib = this.phase === 'reel' ? Math.sin(u * Math.PI) * Math.sin(this.T * 60) * 0.02 : 0;
      pos.setXYZ(i, tp.x + (b.x - tp.x) * u, y + vib, tp.z + (b.z - tp.z) * u + vib);
    }
    pos.needsUpdate = true;

    // a fish shadow that circles closer while you wait, and thrashes while you reel
    const sh = this.shadow;
    let so = 0;
    if (this.phase === 'wait') {
      const k = Math.min(1, this.pt / this.waitDur), a = this.T * 1.3, R = 0.4 + (1 - k) * 2.6;
      sh.position.set(this.land.x + Math.cos(a) * R, 0.05, this.land.z + Math.sin(a) * R); sh.rotation.y = -a - Math.PI / 2; so = 0.12 + k * 0.2;
      sh.scale.setScalar(0.8 + this.fish.tier * 0.3); sh.scale.z *= 0.45;
    } else if (this.phase === 'bite' || this.phase === 'reel') {
      sh.position.set(b.x + 0.3, 0.05, b.z + Math.sin(this.T * 9) * 0.15); sh.rotation.y = Math.sin(this.T * 11) * 0.6; so = 0.35;
    }
    sh.material.opacity += (so - sh.material.opacity) * Math.min(1, dt * 5);
    sh.visible = sh.material.opacity > 0.01;

    // ripples
    for (const r of this.ripples) {
      if (!r.visible) continue;
      const d = r.userData; d.t += dt;
      const u = d.t / d.life;
      if (u >= 1) { r.visible = false; continue; }
      r.scale.setScalar(0.2 + d.size * u); r.material.opacity = 0.75 * (1 - u);
    }

    // caught fish: fly onto the pier, then flop about now and then
    for (const c of this.catches) {
      const m = c.mesh, U = m.userData;
      if (U.fly) {
        const F = U.fly; F.t += dt;
        const u = Math.min(1, F.t / F.dur);
        m.position.lerpVectors(F.from, F.to, u); m.position.y += Math.sin(u * Math.PI) * 4.2;
        U.inner.rotation.x = u * Math.PI * 2.5;
        U.wob = 1;
        if (u >= 1) {
          U.fly = null; U.inner.rotation.x = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); m.position.copy(F.to);
          sfx.squish(1.2 - c.tier * 0.1); this.world.dust(F.to.x, F.to.y - 0.1, F.to.z);
          if (!this.ended) this.addKg(c.weight);
        }
      } else {
        U.flopT -= dt;
        if (U.flopT <= 0) { U.vy = 2 + Math.random() * 1.5; U.flopT = 2 + Math.random() * 5; U.wob = 1; }
        U.vy -= 20 * dt; m.position.y = Math.max(U.y0, m.position.y + U.vy * dt);
        if (m.position.y <= U.y0) U.vy = 0;
      }
      U.wob = Math.max(0, U.wob - dt * 0.9);
      U.flex.rotation.y = Math.sin(this.T * 24 + U.ph) * 0.35 * U.wob;
      for (const e of U.eyes) e.rotation.set(Math.sin(this.T * 7 + U.ph) * 0.6 * (0.3 + U.wob), 0, Math.cos(this.T * 5 + U.ph * 2) * 0.6 * (0.3 + U.wob));
    }

    // UI timers
    if (this.celebT > 0) { this.celebT -= dt; if (this.celebT <= 0 && this.state !== 'done') this.player.c.motion.celebrate = 0; }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hint.classList.remove('fs-on'); }
    if (this.cardT > 0) { this.cardT -= dt; if (this.cardT <= 0) this.card.classList.remove('fs-on'); }
  }

  ripple(x, z, size) {
    const r = this.ripples.find((m) => !m.visible) || this.ripples[0];
    r.visible = true; r.position.x = x; r.position.z = z; r.userData = { t: 0, life: 0.9 + size * 0.25, size };
  }

  addKg(w) {
    this.total = Math.round((this.total + w) * 10) / 10;
    this.updatePills();
    if (!this.goalHit && this.total >= TARGET) {
      this.goalHit = true; sfx.sparkle();
      if (this.state === 'play') this.banner('Target!', 900);
    }
  }

  // ---------------- results ----------------
  end() {
    if (this.ended) return;
    this.ended = true;
    // a fish still mid-air counts
    const total = Math.round((this.catches.reduce((a, c) => a + c.weight, 0)) * 10) / 10;
    this.total = total; this.updatePills();
    this.showMeter(null); this.hint.classList.remove('fs-on');
    this.phase = 'over'; this.pt = 0;
    const me = this.player, name = me.c.design.name;
    const won = total >= TARGET;
    if (!won) me.c.motion.celebrate = 0;
    const sorted = this.catches.slice().sort((a, b) => b.weight - a.weight);
    const rows = [{ place: '計', name: `${name} (you) · total`, score: total.toFixed(1) + ' kg', me: true }];
    sorted.slice(0, 6).forEach((c, i) => rows.push({ place: i + 1, name: c.name, score: c.weight.toFixed(1) + ' kg' }));
    if (sorted.length > 6) rows.push({ place: '…', name: `+${sorted.length - 6} small fry`, score: sorted.slice(6).reduce((a, c) => a + c.weight, 0).toFixed(1) + ' kg' });
    if (!sorted.length) rows.push({ place: '-', name: 'One old boot (thrown back)', score: '0 kg' });
    this.finish(won, rows, this.advice(won, total), { score: total, text: total.toFixed(1) + ' kg' });
  }

  advice(won, total) {
    const S = this.player.c.stats, tr = this.tr, name = this.player.c.design.name;
    const lead = won
      ? `${name} hauled <b>${total.toFixed(1)} kg</b> of cursed fish. The pier cat is furious.`
      : total > 0 ? `${total.toFixed(1)} of ${TARGET} kg. The seagulls saw everything.` : `Nothing in the bucket. The fish are laughing at ${name}.`;
    const tips = {
      swim: `A <b>bigger tail</b> = a bigger reel zone (Swim, yours: ${S.swim.toFixed(1)})`,
      power: `A <b>chunkier body</b> reels fish in faster (Power, yours: ${S.power.toFixed(1)})`,
      balance: `<b>Wider feet</b> or a lower belly = a longer bite window (Balance, yours: ${S.balance.toFixed(1)})`,
    };
    const need = [];
    if (tr.escapes) need.push('swim', 'power');
    if (tr.missed + tr.spooked >= 2) need.push('balance');
    if (!need.length) need.push('swim', 'power', 'balance');
    const weakest = need.sort((a, b) => S[a] - S[b])[0];
    let out = `${lead} ${tips[weakest]}.`;
    if (tr.spooked >= 2) out += ' Little twitches are nibbles: wait for the big <b>!</b>';
    else if (tr.casts && tr.powSum / tr.casts < 0.55) out += ' Let go of the cast near the <b>top</b> of the meter: far casts hook the heavy, cursed ones.';
    return out;
  }

  dispose() {
    super.dispose();
    this.player.c.tilt.rotation.set(0, 0, 0);
    this.player.c.motion.celebrate = 0;
    for (const n of [this.meter, this.card, this.hint]) n?.remove();
    for (const d of this.disposables) d.dispose?.();
    this.eyeMat?.dispose(); this.pupMat?.dispose();
  }
}
