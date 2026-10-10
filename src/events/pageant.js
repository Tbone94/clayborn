// Cursed Pageant (品評会): a beauty contest where the judges reward weirdness.
// Every category is measured from the actual clay (height, length, mass, legs, wings, curse…),
// so the shape you drew is your score. The player adds a timed "Strike a pose!" bonus.
import * as THREE from 'three';
import { EventBase } from './base.js';
import { pbr, plantTrees, placeRocks, plantGrass, plantFlowers, grassHeight, modelSize, terrainMesh, terrainMaterial } from '../world/nature.js';
import { Creature } from '../creature/creature.js';
import { randomDesign, rng } from '../creature/generator.js';
import { smoothstep, fbm2 } from '../game/noise.js';
import { curseLevel } from '../ui/card.js';
import { sfx, babble } from '../fx/audio.js';
import { escapeHtml } from '../ui/creator.js';

const INK = '#15172b', RED = '#e63b2e', YELLOW = '#ffd23f', PAPER = '#f1ebdd';
const DISPLAY = '"Dela Gothic One", sans-serif', DOT = '"DotGothic16", monospace';

const GROUND = 0.3;               // flat lawn height around the stage
const Y = GROUND + 1.1;           // stage top
const STAGE = { x: 7.6, z0: -3.7, z1: 3.3 };
const CENTER = { x: 0, z: 0.9 };
const WAIT = [{ x: -5.8, z: -2.0 }, { x: -3.3, z: -2.0 }, { x: 3.3, z: -2.0 }, { x: 5.8, z: -2.0 }];
const FACE_JUDGES = -Math.PI / 2; // heading that looks along +z (toward the judges' table)
const TABLE_Z = 6.8, JUDGE_Z = 8.2, JUDGE_DX = 2.3;
const LAMP = new THREE.Vector3(7.6, GROUND + 8.6, 6.6);
const JUDGES = [
  { seed: 51917, frame: 'biped', bias: -0.4, voice: 'gruff', tag: 'STRICT', jp: '辛口' },
  { seed: 70733, frame: 'hopper', bias: 0, voice: 'robot', tag: 'FAIR', jp: '普通' },
  { seed: 33391, frame: 'biped', bias: 0.4, voice: 'warbly', tag: 'SOFTIE', jp: '甘口' },
];

// ---------- what the judges measure ----------
const legBones = (c) => (c.analysis?.bones || []).filter((b) => b.kind === 'leg').length;
const eyeAddons = (d) => (d.addons || []).reduce((n, a) => n + (a.type === 'eye' || a.type === 'eyestalk' ? (a.mirror ? 2 : 1) : 0), 0);
const raw = (c) => c.stats.raw || { height: 0.5, length: 0.5, mass: 1, legLen: 0, wingArea: 0 };
const CATS = [
  { id: 'tall', name: 'TALLEST', jp: '背比べ', sub: 'tallest monster wins', m: (c) => raw(c).height,
    tip: 'The judges wanted it <b>taller</b>. Try <b>Tall boi</b> on the 呪 Curse button, or draw a long neck.' },
  { id: 'long', name: 'LONGEST', jp: '胴長', sub: 'nose to tail, longest wins', m: (c) => raw(c).length,
    tip: 'The judges wanted it <b>longer</b>. Stretch the body sideways, or roll <b>Long boi</b> on the 呪 Curse button.' },
  { id: 'chonk', name: 'CHONKIEST', jp: '重量級', sub: 'most clay wins', m: (c) => raw(c).mass,
    tip: 'The judges wanted <b>more chonk</b>. Draw a fatter body, or pray for <b>Absolute unit</b> on the 呪 Curse button.' },
  { id: 'legs', name: 'LEGGIEST', jp: '脚自慢', sub: 'longest legs × most legs', m: (c) => raw(c).legLen * (1 + legBones(c) * 0.35) + legBones(c) * 0.03,
    tip: 'The judges wanted <b>more legs</b>. Try <b>Noodle legs</b> on the 呪 Curse button, or go Skitter and draw lots of them.' },
  { id: 'wings', name: 'BIGGEST WINGS', short: 'WINGS', jp: '翼自慢', sub: 'widest wingspan wins', m: (c) => raw(c).wingArea,
    tip: 'No-one respects a wingless wonder. Draw <b>big wings</b> on the Wings step.' },
  { id: 'cursed', name: 'MOST CURSED', short: 'CURSED', jp: '呪い度', sub: 'the more unsettling the better', m: (c) => curseLevel(c.design, c.stats) + (c.design.addons?.length || 0) * 0.05,
    tip: 'Not nearly cursed enough. Smash the <b>呪 Curse button</b> until Grandma screams.' },
  { id: 'fancy', name: 'FANCIEST', jp: 'お洒落', sub: 'add-ons, patterns, flair', m: (c) => {
    const d = c.design;
    return (d.addons || []).reduce((n, a) => n + (a.mirror ? 1.5 : 1), 0) + (d.pattern && d.pattern !== 'solid' ? 1.2 : 0)
      + ({ lava: 0.6, stars: 0.6, gradient: 0.3, stripes: 0.2 }[d.pattern] || 0) + (d.finish && d.finish !== 'clay' ? 0.5 : 0);
  }, tip: 'Too plain! Stick some <b>Add-ons</b> on (step 3) and pick a loud pattern in Paint.' },
  { id: 'eyes', name: 'BIGGEST EYES', short: 'EYES', jp: '目力', sub: 'more eye = more beauty', m: (c) => {
    const d = c.design;
    return (d.eyeSize || 1) * ({ tri: 1.7, cyclops: 1.45, googly: 1.1 }[d.eyes] || 1) + eyeAddons(d) * 0.4;
  }, tip: 'The judges wanted <b>bigger eyes</b>. Crank the eye size in Paint, or roll <b>Wrong number of eyes</b> on the 呪 Curse button.' },
  { id: 'tiny', name: 'TINIEST', jp: '豆粒', sub: 'least clay wins', m: (c) => 1 / (raw(c).mass + 0.1),
    tip: 'Too big to be adorable. Draw it <b>smaller</b>: the judges love a pocket monster.' },
];

const POSE_LINES = { perfect: ['PERFECT POSE!', 'PERFECT!'], nice: ['nice', 'nice'], awk: ['awkward…', 'awkward…'], froze: ['froze up…', 'froze up…'] };
const PRAISE = ['deeply upsetting', 'a crime against clay', 'haunting. Ten out of ten', 'the stuff of nightmares, in a good way', 'why does it look at me like that'];

const CSS = `
.pg-pill { white-space: nowrap; }
.pg-pill.me { background: var(--red); color: var(--paper); box-shadow: 4px 4px 0 var(--ink); }
.pg-round { position: absolute; top: 24%; left: 50%; width: max-content; max-width: calc(100vw - 32px); text-align: center; pointer-events: none;
  transform: translateX(-50%) rotate(-3deg); animation: pg-slam .45s cubic-bezier(.2, 1.3, .4, 1); }
.pg-round small { display: inline-block; font: 400 clamp(14px, 2.4vw, 20px) var(--dot); color: var(--yellow); background: var(--ink); padding: 3px 14px; transform: skewX(-10deg); box-shadow: 4px 4px 0 var(--red); }
.pg-round b { display: block; margin: 8px 0 6px; font: 400 clamp(36px, 10vw, 112px) var(--display); line-height: 1.05; color: var(--yellow);
  -webkit-text-stroke: 4px var(--ink); paint-order: stroke fill; text-shadow: 7px 7px 0 var(--red); }
.pg-round em { display: inline-block; font: 400 clamp(13px, 2vw, 18px) var(--dot); font-style: normal; color: var(--ink); background: var(--paper); padding: 3px 12px; border: 2px solid var(--ink); transform: skewX(-10deg); }
.pg-round.out { opacity: 0; transition: opacity .25s; }
@keyframes pg-slam { 0% { transform: translateX(-50%) scale(2.2) rotate(-3deg); opacity: 0; } 60% { transform: translateX(-50%) scale(.96) rotate(-3deg); opacity: 1; } 100% { transform: translateX(-50%) scale(1) rotate(-3deg); } }
.pg-meter { position: absolute; left: 50%; bottom: 13%; width: min(460px, calc(100vw - 32px)); transform: translateX(-50%); pointer-events: none;
  background: var(--ink); color: var(--paper); padding: 10px 16px 12px; box-shadow: 6px 6px 0 var(--red); animation: pg-up .25s ease-out; }
@media (pointer: coarse) { .pg-meter { bottom: calc(190px + env(safe-area-inset-bottom)); } }
.pg-mh { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.pg-mh b { font: 400 clamp(18px, 4.6vw, 26px) var(--display); color: var(--yellow); letter-spacing: .02em; }
.pg-mh span { font: 400 14px var(--dot); color: var(--paper); opacity: .8; }
.pg-track { position: relative; height: 30px; background: var(--paper); border: 2px solid var(--paper); transform: skewX(-12deg); overflow: hidden;
  background-image: radial-gradient(rgba(21, 23, 43, .16) 1.2px, transparent 1.4px); background-size: 7px 7px; }
.pg-track i { position: absolute; top: 0; bottom: 0; }
.pg-sweet { background: var(--yellow); }
.pg-perfect { background: var(--red); }
.pg-needle { width: 6px; margin-left: -3px; background: var(--ink); box-shadow: 0 0 0 2px var(--paper); }
.pg-mf { margin-top: 8px; font: 400 13px var(--dot); color: var(--paper); text-align: center; }
.pg-mf kbd { font-size: 12px; }
.pg-meter.hit .pg-track { animation: pg-flash .3s 2; }
.pg-meter.hit.awk .pg-mh b { color: var(--paper); }
@keyframes pg-flash { 50% { background-color: var(--yellow); } }
@keyframes pg-up { from { transform: translate(-50%, 16px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
@media (max-width: 600px) { #event-hud.pg-hud { top: calc(66px + env(safe-area-inset-top)); } .pill.pg-pill { font-size: 15px; padding: 3px 10px; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; } }
`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const ord = (n) => ['1st', '2nd', '3rd', '4th'][n - 1];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = (v) => (Math.round(v * 2) / 2).toFixed(1);

function groundH(x, z) {
  const r = Math.hypot(x * 0.85, (z - 2.5) * 1.05) + fbm2(x * 0.05 + 3, z * 0.05) * 7;
  const edge = smoothstep(19, 30, r);
  const bumps = fbm2(x * 0.11, z * 0.11) * 0.5 * smoothstep(13, 20, r);
  return (GROUND + bumps) * (1 - edge) - 4.5 * edge;
}

export class PageantEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, {
      rivals: 3,
      rivalOpts: [{ frame: 'serpent', eyes: 'googly' }, { frame: 'crawler', pattern: 'lava' }, { wings: true, eyes: 'tri', eyeSize: 1.3 }],
    });
    this.height = groundH;
    this.junk = [];
    this.injectCss();
    this.build();
    this.makeJudges();
    this.all.forEach((b, i) => {
      b.spot = WAIT[i];
      b.x = b.spot.x; b.z = b.spot.z; b.y = Y; b.vx = b.vz = b.vy = 0; b.heading = FACE_JUDGES; b.grounded = true;
      b.mv = { path: [], face: FACE_JUDGES };
      b.total = 0; b.celebT = 0; b.spin = 0; b.stun = 0;
      b.walkSp = clamp(b.c.stats.phys.maxSpeed * 0.6, 3.4, 5.2);
      b.sync();
    });
    this.cats = this.pickCats();
    this.rounds = [];          // per round: { cat, base: Map(body → 3..8.5), rank: Map(body → 0..1) }
    this.playerPoses = [];
    this.dt = 0; this.waitT = 0; this.waitFn = null; this.fast = false; this.skippable = false;
    this.seq = this.show();
    this.setShot('wide');
    document.getElementById('event-hud')?.classList.add('pg-hud');
    this.hud(`<span class="pill pg-pill" id="pg-p1">品評会 PAGEANT</span><span class="pill pg-pill" id="pg-p2">4 contestants</span>`);
  }

  injectCss() {
    if (!document.getElementById('pageant-css')) {
      const st = document.createElement('style'); st.id = 'pageant-css'; st.textContent = CSS; document.head.appendChild(st);
    }
  }

  own(x) { this.junk.push(x); return x; }

  // ---------- the set: lawn on the shore, a plank stage, striped curtain, judges' table, spotlight ----------
  build() {
    const s = this.scene;
    const r = rng(41);
    const splat = (x, h, z, ny) => {
      const sand = smoothstep(0.55, -0.2, h);
      const rock = smoothstep(0.8, 0.55, ny) * (1 - sand * 0.5);
      const worn = (Math.abs(x) < 10.5 && z > STAGE.z0 - 1 && z < 11.5) ? 0.45 * smoothstep(1, 0, Math.abs(fbm2(x * 0.4, z * 0.4))) : 0;
      return [Math.max(0, 1 - sand - rock - worn), worn * (1 - rock), sand, rock];
    };
    s.add(terrainMesh(groundH, { size: [120, 120], seg: [240, 240], center: [0, 2], splatFn: splat, material: terrainMaterial({ path: 'rocky_trail' }) }));
    this.makeWater(groundH, [-60, -58, 120]);

    const wood = pbr('wood_planks', 7, 2.5), woodSide = pbr('wood_planks', 7, 0.4), post = pbr('bark_brown_02', 1, 3);
    const W = STAGE.x * 2, D = STAGE.z1 - STAGE.z0, cz = (STAGE.z0 + STAGE.z1) / 2;
    const stage = new THREE.Mesh(this.own(new THREE.BoxGeometry(W, Y - GROUND + 0.6, D)), [woodSide, woodSide, wood, woodSide, woodSide, woodSide]);
    stage.position.set(0, (Y + GROUND - 0.6) / 2, cz); stage.castShadow = stage.receiveShadow = true; s.add(stage);
    // striped festival skirt on the front + two steps up
    const skirt = new THREE.Mesh(this.own(new THREE.PlaneGeometry(W, Y - GROUND)), this.own(new THREE.MeshStandardMaterial({ map: this.own(this.stripeTex(28, true)), roughness: 0.85 })));
    skirt.position.set(0, (Y + GROUND) / 2, STAGE.z1 + 0.02); s.add(skirt);
    for (let k = 0; k < 2; k++) {
      const h = (Y - GROUND) * (k + 1) / 3;
      const st = new THREE.Mesh(this.own(new THREE.BoxGeometry(2.4, h, 0.55)), woodSide);
      st.position.set(0, GROUND + h / 2, STAGE.z1 + 0.28 + (1 - k) * 0.55); st.castShadow = st.receiveShadow = true; s.add(st);
    }
    // footlights
    const bulb = this.own(new THREE.MeshStandardMaterial({ color: YELLOW, emissive: '#ffb81f', emissiveIntensity: 1.6, roughness: 0.4 }));
    const bulbG = this.own(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
    for (let i = 0; i < 9; i++) {
      const x = -STAGE.x + 0.8 + i * ((W - 1.6) / 8);
      if (Math.abs(x) < 1.4) continue;
      const b = new THREE.Mesh(bulbG, bulb); b.position.set(x, Y, STAGE.z1 - 0.2); s.add(b);
    }

    // backdrop: posts, a wavy striped curtain and a header banner
    const BH = 5.6, bz = STAGE.z0 + 0.15;
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.2, 0.26, BH + 1.3, 12)), post);
      p.position.set(sx * (STAGE.x + 0.1), Y + (BH + 1.3) / 2 - 0.3, bz); p.castShadow = true; s.add(p);
    }
    const cg = this.own(new THREE.PlaneGeometry(W, BH, 120, 1));
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 2.6) * 0.14 + Math.sin(cp.getX(i) * 0.9) * 0.05);
    cg.computeVertexNormals();
    const curtain = new THREE.Mesh(cg, this.own(new THREE.MeshStandardMaterial({ map: this.own(this.stripeTex(36, false)), roughness: 0.9, side: THREE.DoubleSide })));
    curtain.position.set(0, Y + BH / 2, bz - 0.05); curtain.receiveShadow = true; s.add(curtain);
    const head = new THREE.Mesh(this.own(new THREE.PlaneGeometry(W * 0.62, W * 0.62 * 0.22)), this.own(new THREE.MeshStandardMaterial({ map: this.own(this.headerTex()), roughness: 0.8, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })));
    head.position.set(0, Y + BH + 0.05, bz + 0.25); s.add(head);
    const beam = new THREE.Mesh(this.own(new THREE.BoxGeometry(W + 0.8, 0.4, 0.4)), woodSide);
    beam.position.set(0, Y + BH + 0.5, bz); beam.castShadow = true; s.add(beam);

    // bunting from the backdrop's corners down to two front posts
    const flagMats = [RED, YELLOW, PAPER, INK].map((c) => this.own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide })));
    const flagG = this.own(new THREE.ConeGeometry(0.22, 0.55, 3));
    for (const sx of [-1, 1]) {
      const fp = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.12, 0.15, 3.6, 10)), post);
      fp.position.set(sx * (STAGE.x + 0.3), GROUND + 1.8, STAGE.z1 + 0.4); fp.castShadow = true; s.add(fp);
      const a = new THREE.Vector3(sx * (STAGE.x + 0.1), Y + BH + 0.3, bz), b = new THREE.Vector3(sx * (STAGE.x + 0.3), GROUND + 3.5, STAGE.z1 + 0.4);
      for (let k = 1; k < 12; k++) {
        const t = k / 12, f = new THREE.Mesh(flagG, flagMats[k % 4]);
        f.position.lerpVectors(a, b, t); f.position.y -= Math.sin(t * Math.PI) * 0.7;
        f.rotation.x = Math.PI; f.rotation.y = sx > 0 ? 0.3 : -0.3; s.add(f);
      }
    }
    // a garland right across the curtain top
    for (let k = 0; k < 21; k++) {
      const t = k / 20, f = new THREE.Mesh(flagG, flagMats[k % 4]);
      f.position.set(-STAGE.x + t * W, Y + BH - 0.45 - Math.sin(t * Math.PI * 3) ** 2 * 0.4, bz + 0.45); f.rotation.x = Math.PI; s.add(f);
    }

    // judges' riser + table with a red cloth and a name panel facing the stage
    const riser = new THREE.Mesh(this.own(new THREE.BoxGeometry(8.4, 0.8, 2)), this.own(new THREE.MeshStandardMaterial({ color: '#2a2d4c', roughness: 0.9 })));
    riser.position.set(0, GROUND + 0.4, JUDGE_Z + 0.2); riser.castShadow = riser.receiveShadow = true; s.add(riser);
    const cloth = this.own(new THREE.MeshStandardMaterial({ color: RED, roughness: 0.85 }));
    const table = new THREE.Mesh(this.own(new THREE.BoxGeometry(8, 0.95, 1.1)), cloth);
    table.position.set(0, GROUND + 0.48, TABLE_Z); table.castShadow = table.receiveShadow = true; s.add(table);
    const top = new THREE.Mesh(this.own(new THREE.BoxGeometry(8.2, 0.08, 1.3)), wood);
    top.position.set(0, GROUND + 0.98, TABLE_Z); top.castShadow = true; s.add(top);
    const panel = new THREE.Mesh(this.own(new THREE.PlaneGeometry(5.2, 0.72)), this.own(new THREE.MeshStandardMaterial({ map: this.own(this.panelTex('審査員席', 'JUDGES')), roughness: 0.8 })));
    panel.position.set(0, GROUND + 0.5, TABLE_Z - 0.56); panel.rotation.y = Math.PI; s.add(panel);

    // spotlight on a tall pole, aimed at centre stage, with a faint beam
    const pole = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.13, 0.18, LAMP.y - GROUND + 0.4, 10)), post);
    pole.position.set(LAMP.x + 0.3, (LAMP.y + GROUND) / 2, LAMP.z + 0.3); pole.castShadow = true; s.add(pole);
    const target = new THREE.Vector3(CENTER.x, Y, CENTER.z);
    const can = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.42, 0.3, 0.9, 16, 1, true)), this.own(new THREE.MeshStandardMaterial({ color: INK, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })));
    can.position.copy(LAMP); can.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(LAMP).normalize()); s.add(can);
    const lens = new THREE.Mesh(this.own(new THREE.CircleGeometry(0.4, 16)), this.own(new THREE.MeshBasicMaterial({ color: '#fff6d8' })));
    lens.position.copy(LAMP).addScaledVector(target.clone().sub(LAMP).normalize(), 0.44);
    lens.lookAt(target); s.add(lens);
    // a painted-on pool of light rather than a real SpotLight: adding a light type would force every
    // material in the scene to recompile (a long hitch on phones) for very little visual gain
    const poolTex = this.own(this.canvasTex(256, 256, (x) => {
      const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,240,200,0.75)'); g.addColorStop(0.6, 'rgba(255,236,190,0.5)'); g.addColorStop(0.85, 'rgba(255,230,180,0.18)'); g.addColorStop(1, 'rgba(255,230,180,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    }));
    const pool = new THREE.Mesh(this.own(new THREE.CircleGeometry(2.3, 40)), this.own(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false })));
    pool.rotation.x = -Math.PI / 2; pool.scale.set(1, 1.25, 1); pool.position.set(CENTER.x, Y + 0.012, CENTER.z); pool.renderOrder = 2; s.add(pool);
    const len = LAMP.distanceTo(target);
    const beamC = new THREE.Mesh(this.own(new THREE.ConeGeometry(Math.tan(0.3) * len, len, 32, 1, true)),
      this.own(new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })));
    beamC.position.lerpVectors(LAMP, target, 0.5);
    beamC.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), LAMP.clone().sub(target).normalize());
    s.add(beamC);

    // nature: trees and rocks around the lawn, grass and flowers where nobody stands
    const trees = [], rocks = [], grass = [], flowers = [];
    const busy = (x, z) => (Math.abs(x) < STAGE.x + 1.5 && z > STAGE.z0 - 1.5 && z < STAGE.z1 + 2) || (Math.abs(x) < 5 && z > TABLE_Z - 1.5 && z < JUDGE_Z + 2) || (Math.abs(x - LAMP.x) < 1 && Math.abs(z - LAMP.z) < 1);
    for (let i = 0; i < 70 && trees.length < 22; i++) {
      const a = r() * Math.PI * 2, d = 14 + r() * 9, x = Math.cos(a) * d, z = 2.5 + Math.sin(a) * d;
      const h = groundH(x, z);
      if (h < 0.15 || busy(x, z) || (z > 10 && Math.abs(x) < 9)) continue; // keep the judges' camera line clear
      trees.push({ x, y: h - 0.2, z, h: 5 + r() * 5, ry: r() * 6.28, kind: (r() * 6) | 0 });
    }
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, d = 21 + r() * 12, x = Math.cos(a) * d, z = 2.5 + Math.sin(a) * d;
      const big = r() < 0.35;
      rocks.push({ x, y: Math.max(-1.6, groundH(x, z)) - 0.4, z, s: (big ? 4 + r() * 4 : 1 + r() * 2) / rs, sy: big ? 0.6 : 0.8, ry: r() * 6.28 });
    }
    const gH = grassHeight();
    for (let i = 0; i < 18000; i++) {
      const x = (r() - 0.5) * 56, z = 2.5 + (r() - 0.5) * 56, h = groundH(x, z);
      if (h < 0.3 || busy(x, z)) continue;
      grass.push({ x, y: h - 0.03, z, s: (0.4 + r() * 0.35) / gH, ry: r() * 6.28, hue: r(), lum: r() });
      if (r() < 0.025) flowers.push({ x, y: h, z, s: (0.35 + r() * 0.2) / modelSize('flower_white').y, ry: r() * 6.28 });
    }
    plantTrees(s, trees); placeRocks(s, rocks); plantGrass(s, grass); plantFlowers(s, flowers);

    // score cards (one per judge) and the winner's crown
    this.crown = this.makeCrown(); this.crown.visible = false; s.add(this.crown);
  }

  canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }

  stripeTex(n, skirt) {
    return this.canvasTex(1024, skirt ? 128 : 256, (x, w, h) => {
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        x.fillStyle = i % 2 ? PAPER : RED; x.fillRect(i * sw, 0, sw + 1, h);
        // soft fold shading
        const g = x.createLinearGradient(i * sw, 0, (i + 1) * sw, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.12)'); g.addColorStop(0.5, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
        x.fillStyle = g; x.fillRect(i * sw, 0, sw + 1, h);
      }
      x.fillStyle = INK; x.fillRect(0, 0, w, skirt ? 10 : 6); x.fillRect(0, h - (skirt ? 10 : 6), w, skirt ? 10 : 6);
      if (skirt) for (let i = 0; i < w; i += 32) { x.fillStyle = YELLOW; x.fillRect(i, 10, 16, 6); }
    });
  }

  headerTex() {
    return this.canvasTex(1024, 226, (x, w) => {
      const bh = 170;
      // scalloped fringe under the board
      for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? YELLOW : RED; x.beginPath(); x.arc(32 + i * 64, bh - 4, 30, 0, Math.PI); x.fill(); }
      x.fillStyle = INK; x.fillRect(0, 0, w, bh);
      for (let i = 0; i < w; i += 32) { x.fillStyle = YELLOW; x.fillRect(i, 0, 16, 10); x.fillRect(i + 16, bh - 10, 16, 10); }
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `400 30px ${DOT}`; x.fillStyle = RED; x.fillText('呪 ・ 怪獣品評会 ・ 呪', w / 2, 40);
      x.font = `400 86px ${DISPLAY}`; x.lineWidth = 10; x.strokeStyle = RED; x.strokeText('CURSED PAGEANT', w / 2, 108);
      x.fillStyle = YELLOW; x.fillText('CURSED PAGEANT', w / 2, 104);
    });
  }

  panelTex(jp, en) {
    return this.canvasTex(1024, 142, (x, w, h) => {
      x.fillStyle = INK; x.fillRect(0, 0, w, h);
      x.strokeStyle = YELLOW; x.lineWidth = 6; x.strokeRect(10, 10, w - 20, h - 20);
      x.textBaseline = 'middle'; x.textAlign = 'center';
      x.font = `400 74px ${DISPLAY}`; x.fillStyle = YELLOW; x.fillText(en, w / 2 + 110, h / 2 + 2);
      x.font = `400 50px ${DOT}`; x.fillStyle = PAPER; x.fillText(jp, w / 2 - 240, h / 2 + 2);
    });
  }

  tagTex(tag, jp, name) {
    return this.canvasTex(256, 128, (x, w, h) => {
      x.fillStyle = PAPER; x.fillRect(0, 0, w, h); x.strokeStyle = INK; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `400 40px ${DISPLAY}`; x.fillStyle = RED; x.fillText(tag, w / 2, 46);
      x.font = `400 24px ${DOT}`; x.fillStyle = INK; x.fillText(`${jp} ${name}`.slice(0, 14), w / 2, 94);
    });
  }

  cardTex(score) {
    return this.canvasTex(256, 400, (x) => {
      x.fillStyle = '#a8763e'; x.fillRect(118, 230, 20, 170); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(118, 230, 20, 18);
      x.fillStyle = RED; x.fillRect(30, 26, 214, 220);
      x.fillStyle = INK; x.fillRect(14, 10, 214, 220);
      x.strokeStyle = YELLOW; x.lineWidth = 6; x.strokeRect(26, 22, 190, 196);
      const txt = score % 1 ? score.toFixed(1) : String(score);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `400 ${txt.length > 2 ? 84 : 120}px ${DISPLAY}`; x.fillStyle = YELLOW; x.fillText(txt, 121, 112);
      x.font = `400 22px ${DOT}`; x.fillStyle = PAPER; x.fillText('得点 SCORE', 121, 196);
    });
  }

  makeCrown() {
    const g = new THREE.Group();
    const gold = this.own(new THREE.MeshStandardMaterial({ color: YELLOW, metalness: 0.55, roughness: 0.3, emissive: '#4a3300', side: THREE.DoubleSide }));
    const gem = this.own(new THREE.MeshStandardMaterial({ color: RED, roughness: 0.2 }));
    const band = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.26, 0.23, 0.16, 24, 1, true)), gold); g.add(band);
    const spikeG = this.own(new THREE.ConeGeometry(0.07, 0.22, 8)), gemG = this.own(new THREE.SphereGeometry(0.045, 10, 8));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = new THREE.Mesh(spikeG, gold); sp.position.set(Math.cos(a) * 0.24, 0.17, Math.sin(a) * 0.24); g.add(sp);
      const gm = new THREE.Mesh(gemG, gem); gm.position.set(Math.cos(a) * 0.25, 0.0, Math.sin(a) * 0.25); g.add(gm);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  makeJudges() {
    this.judges = JUDGES.map((J, i) => {
      const d = randomDesign(J.seed, { frame: J.frame });
      const c = new Creature(d, { detail: 40 });
      const k = clamp(1.5 / (c.height || 1.5), 0.7, 1.25);
      c.group.scale.setScalar(k);
      const x = (i - 1) * JUDGE_DX, y0 = GROUND + 0.8;
      c.group.position.set(x, y0, JUDGE_Z); c.group.rotation.y = Math.PI / 2;
      this.scene.add(c.group);
      const card = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ depthWrite: false, fog: false, toneMapped: false })));
      card.visible = false; card.renderOrder = 5; this.scene.add(card);
      // little tent card on the table with the judge's personality
      const tag = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.9, 0.45)), this.own(new THREE.MeshStandardMaterial({ map: this.own(this.tagTex(J.tag, J.jp, d.name)), roughness: 0.8 })));
      tag.position.set(x, GROUND + 1.22, TABLE_Z - 0.25); tag.rotation.set(-0.25, Math.PI, 0); this.scene.add(tag);
      return { c, x, z: JUDGE_Z, y0, y: y0, vy: 0, k, bias: J.bias, voice: J.voice, pitch: 1.25 - (c.stats.raw?.mass || 1) * 0.3, card, cardT: -1, celebT: 0, dizzyT: 0, heading: Math.PI / 2 };
    });
  }

  // ---------- categories + relative scoring ----------
  pickCats() {
    const pool = shuffle(CATS.slice());
    const out = [];
    for (const cat of pool) {
      const v = this.all.map((b) => cat.m(b.c));
      const lo = Math.min(...v), hi = Math.max(...v);
      if ((hi - lo) / (Math.abs(hi) + 1e-6) > 0.06) out.push(cat);
      if (out.length === 3) break;
    }
    while (out.length < 3) out.push(pool.find((c) => !out.includes(c)));
    return out;
  }

  scoreRound(cat) {
    const v = this.all.map((b) => cat.m(b.c));
    const lo = Math.min(...v), hi = Math.max(...v);
    const base = new Map(), rank = new Map();
    this.all.forEach((b, i) => {
      const t = hi - lo > 1e-6 ? (v[i] - lo) / (hi - lo) : 0.5;
      const below = v.filter((o) => o < v[i] - 1e-9).length / 3;
      rank.set(b, below);
      base.set(b, 3 + 5.5 * (0.5 * t + 0.5 * below)); // worst ≈ 3, best ≈ 8.5 before the pose bonus
    });
    return { cat, base, rank, vals: v };
  }

  // ---------- the show (a coroutine stepped by step()) ----------
  *show() {
    yield 0.3;
    for (let r = 0; r < 3; r++) {
      const R = this.scoreRound(this.cats[r]); this.rounds.push(R);
      const cat = R.cat;
      this.cur = null; this.skippable = true; this.fast = false;
      this.pill(1, `R${r + 1}/3 · ${cat.short || cat.name}`);
      this.standingsPill();
      this.setShot('wide');
      this.roundCard(r, cat);
      sfx.chime(); babble(this.judges[1].pitch, 3, 1, this.judges[1].voice);
      for (const j of this.judges) j.vy = 2.6;
      yield 2.0;
      this.hideRoundCard();
      const order = shuffle(this.all.slice());
      for (const b of order) {
        this.cur = b; this.fast = false; this.skippable = b !== this.player;
        const me = b === this.player;
        this.pill(2, `${me ? '▶ YOU · ' : '▶ '}${escapeHtml(b.c.design.name)}`, me);
        this.walk(b, [{ x: b.spot.x, z: b.spot.z + 1.6 }, CENTER], FACE_JUDGES);
        this.setShot('walk', b);
        babble(this.voicePitch(b), 3, 0.5, b.c.design.voice);
        yield () => this.arrived(b);
        this.setShot('pose', b);
        let bonus;
        if (me) bonus = yield* this.playerPose();
        else {
          yield 0.3;
          bonus = 0.4 + Math.random() * 1.3;
          this.pose(b, bonus >= 1.5 ? 'perfect' : bonus >= 0.8 ? 'nice' : 'awk');
          yield 0.85;
        }
        // the verdict
        this.setShot('judges', b);
        yield 0.45;
        const scores = this.judges.map((j) => clamp(Math.round((R.base.get(b) + bonus + j.bias + (Math.random() - 0.5)) * 2) / 2, 1, 10));
        for (let i = 0; i < 3; i++) { this.showCard(i, scores[i]); yield 0.38; }
        const tot = scores.reduce((a, s) => a + s, 0);
        b.total += tot;
        this.pill(2, `${me ? 'YOU · ' : ''}${escapeHtml(b.c.design.name)} +${fmt(tot)}`, me);
        if (tot >= 27) { sfx.fanfare(); this.burst(b, 40); } else if (tot <= 13) sfx.sad();
        yield 0.9;
        this.hideCards();
        this.walk(b, [{ x: b.spot.x, z: b.spot.z + 1.6 }, b.spot], FACE_JUDGES);
        yield 0.35;
      }
      this.cur = null;
      yield () => this.all.every((b) => this.arrived(b));
    }
    // the crowning
    this.skippable = false; this.fast = false;
    const ranked = this.ranking();
    const W = ranked[0];
    this.setShot('wide');
    this.pill(1, 'AND THE WINNER IS…');
    this.pill(2, '♪ ♪ ♪');
    for (let i = 0; i < 6; i++) { sfx.count(false); yield 0.22; }
    this.cur = W;
    this.walk(W, [{ x: W.spot.x, z: W.spot.z + 1.6 }, CENTER], FACE_JUDGES);
    this.setShot('pose', W);
    yield () => this.arrived(W);
    this.pill(1, '優勝 WINNER');
    this.pill(2, `${escapeHtml(W.c.design.name)} · ${fmt(W.total)}`, W === this.player);
    this.crown.visible = true; this.crownY = 3;
    W.celebT = 99; W.vy = 5; W.grounded = false;
    for (const j of this.judges) { j.vy = 4.5; j.celebT = 2; }
    this.burst(W, 50); sfx.sparkle();
    babble(this.voicePitch(W), 6, 1, W.c.design.voice);
    yield 1.6;
    this.end(ranked);
  }

  *playerPose() {
    const sweet = 0.48 + Math.random() * 0.36;
    this.showMeter(sweet);
    yield 0.2;
    let t = 0, pos = 0, got = false;
    while (t < 5) {
      t += this.dt;
      const u = (t * 0.6) % 1;
      pos = 1 - Math.abs(1 - 2 * u);
      this.needle.style.left = (pos * 100).toFixed(2) + '%';
      if (this.app.input.jumpPressed) { got = true; break; }
      yield 0;
    }
    const d = Math.abs(pos - sweet);
    const bonus = !got ? 0 : d < 0.045 ? 2 : Math.max(0, 1.7 * (1 - (d - 0.045) / 0.22));
    const kind = !got ? 'froze' : bonus >= 2 ? 'perfect' : bonus >= 0.8 ? 'nice' : 'awk';
    this.playerPoses.push(bonus);
    this.meterResult(kind, bonus);
    this.pose(this.player, kind === 'froze' ? 'awk' : kind);
    this.banner(POSE_LINES[kind][window.innerWidth < 600 ? 1 : 0], 1100);
    yield 1.3;
    this.hideMeter();
    return bonus;
  }

  pose(b, kind) {
    const p = this.voicePitch(b), v = b.c.design.voice;
    b.grounded = false;
    if (kind === 'perfect') {
      b.vy = 8; b.spin = Math.PI * 2; b.celebT = 1.8;
      sfx.sparkle(); sfx.boing(1.2); babble(p, 5, 1, v); this.burst(b, 30);
    } else if (kind === 'nice') {
      b.vy = 6; b.celebT = 1.3;
      sfx.boing(1); babble(p, 3, 0.6, v); this.burst(b, 10);
    } else {
      b.vy = 3.2; b.stun = 1.3;
      sfx.bonk(); babble(p * 0.85, 2, -1, v);
    }
  }

  burst(b, n) {
    this.fx.emit(b.x, b.y + (b.c.height || 1) * 0.8, b.z, { count: n, colors: [YELLOW, RED, PAPER, '#ffffff'], speed: 5, up: 6, gravity: 8, size: 0.3, life: 1.3 });
  }

  voicePitch(b) { return clamp(1.5 - (b.c.stats.raw?.mass || 1) * 0.35, 0.7, 1.6); }

  ranking() {
    return this.all.slice().sort((a, b) => (b.total - a.total) || (a === this.player ? -1 : b === this.player ? 1 : 0));
  }

  // ---------- movement: bodies are posed directly (no physics), walking along waypoints ----------
  walk(b, path, face) { b.mv.path = path.map((p) => ({ x: p.x, z: p.z })); b.mv.face = face; }

  arrived(b) { return !b.mv.path.length && b.grounded && Math.abs(wrapA(b.heading - b.mv.face)) < 0.12 && b.spin <= 0; }

  moveBodies(dt, mul) {
    for (const b of this.all) {
      const M = b.mv;
      let moving = false;
      while (M.path.length) {
        const p = M.path[0], dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
        if (d < 0.05) { M.path.shift(); continue; }
        const sp = b.walkSp * mul, s = Math.min(d, sp * dt);
        b.x += (dx / d) * s; b.z += (dz / d) * s;
        b.vx = (dx / d) * sp; b.vz = (dz / d) * sp;
        b.heading += wrapA(Math.atan2(-dz, dx) - b.heading) * Math.min(1, dt * 10 * mul);
        moving = true; break;
      }
      if (!moving) {
        b.vx = b.vz = 0;
        if (b.spin > 0) { const a = Math.min(b.spin, dt * 13); b.heading += a; b.spin -= a; }
        else b.heading += wrapA(M.face - b.heading) * Math.min(1, dt * 8 * mul);
      }
      if (!b.grounded) {
        b.vy -= 22 * dt; b.y += b.vy * dt;
        if (b.y <= Y) {
          b.y = Y; if (b.vy < -4) { b.c.motion.land = Math.min(1, -b.vy / 14); this.world.dust(b.x, Y, b.z); }
          b.vy = 0; b.grounded = true;
        }
      }
      b.stun = Math.max(0, b.stun - dt);
      b.celebT = Math.max(0, b.celebT - dt);
      b.sync();
      b.c.motion.celebrate = b.celebT > 0 ? 1 : 0;
    }
  }

  updateJudges(dt) {
    const cur = this.cur;
    for (const j of this.judges) {
      // watch whoever is on stage
      const want = cur ? Math.atan2(-(cur.z - j.z), cur.x - j.x) : Math.PI / 2;
      j.heading += wrapA(want - j.heading) * Math.min(1, dt * 4);
      if (j.y > j.y0 || j.vy > 0) {
        j.vy -= 20 * dt; j.y += j.vy * dt;
        if (j.y <= j.y0) { if (j.vy < -4) j.c.motion.land = 0.5; j.y = j.y0; j.vy = 0; }
      }
      j.celebT = Math.max(0, j.celebT - dt); j.dizzyT = Math.max(0, j.dizzyT - dt);
      const M = j.c.motion;
      M.grounded = j.y <= j.y0 + 0.01; M.vy = j.vy; M.speed = 0;
      M.celebrate = j.celebT > 0 ? 1 : 0; M.dizzy = j.dizzyT > 0 ? 1 : 0;
      j.c.group.position.set(j.x, j.y, j.z); j.c.group.rotation.y = j.heading;
      j.c.update(dt);
      // score card pops up above the judge's head
      if (j.cardT >= 0) {
        j.cardT += dt;
        const k = easeOutBack(Math.min(1, j.cardT / 0.28));
        j.card.scale.set(1.0 * k, 1.56 * k, 1);
        j.card.position.set(j.x, j.y + j.c.height * j.k + 0.62 + Math.sin(j.cardT * 3) * 0.04, j.z - 0.3);
      }
    }
  }

  showCard(i, score) {
    const j = this.judges[i];
    const m = j.card.material;
    m.map?.dispose(); m.map = this.cardTex(score); m.needsUpdate = true;
    j.card.visible = true; j.cardT = 0;
    sfx.pop(0.7 + score * 0.06);
    if (score >= 8) { j.vy = 3.5 + (score - 8) * 1.3; j.celebT = 1.4; babble(j.pitch, 3, 1, j.voice); }
    else if (score >= 5.5) { j.vy = 2.2; babble(j.pitch, 2, 0.2, j.voice); }
    else { j.dizzyT = 1.1; babble(j.pitch * 0.8, 2, -1, j.voice); }
    if (score >= 10) this.fx.emit(j.x, j.y + j.c.height * j.k + 1, j.z - 0.3, { count: 24, colors: [YELLOW, '#ffffff'], speed: 4, up: 4, gravity: 6, size: 0.25, life: 0.9 });
  }

  hideCards() { for (const j of this.judges) { j.card.visible = false; j.cardT = -1; } }

  // ---------- camera ----------
  setShot(kind, b) { this.shotKind = kind; this.shotB = b; }

  shot() {
    const b = this.shotB, zk = this.zk, port = this.camera.aspect < 1;
    const look = new THREE.Vector3(), off = new THREE.Vector3();
    if (this.shotKind === 'walk' && b) {
      look.set(b.x * (port ? 0.9 : 0.55), Y + 0.9, 0.2); off.set(-1.6, 3.0, 11);
    } else if (this.shotKind === 'pose' && b) {
      const h = b.c.height || 1.2;
      look.set(b.x, Y + h * 0.5 + (b.y - Y) * 0.6, b.z); off.set(1.2, 0.3 + h * 0.22, 2.4 + h * 1.35);
      return { look, pos: look.clone().add(off.multiplyScalar(Math.pow(zk, 0.6))) };
    } else if (this.shotKind === 'judges' && b) {
      look.set(0, GROUND + 2.0, JUDGE_Z - 0.4);
      if (port) off.set(-7.5, 4.5, -7.6); // from the stage's front corner: the whole panel fits a tall screen
      else { const h = b.c.height || 1.2; off.set(b.x + 2.3, Y + Math.max(2, h + 0.8) - look.y, b.z - 2.6 - look.z); }
      return { look, pos: look.clone().add(off.multiplyScalar(port ? 1.15 : 1)) };
    } else {
      look.set(0, Y + 0.6, 0.6); off.set(0, port ? 5.6 : 4.4, 16);
    }
    return { look, pos: look.clone().add(off.multiplyScalar(zk)) };
  }

  introCam(k) {
    const e = smoothstep(0, 1, clamp(k, 0, 1));
    const S = this.shot();
    const a = 0.9 - e * 0.9;
    const from = new THREE.Vector3(Math.sin(a) * 26, 13 - e * 3, 2 + Math.cos(a) * 26);
    this.camPos = from.lerp(S.pos, e * e);
    this.camLook = new THREE.Vector3(0, Y + 1.5, 0).lerp(S.look, e);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
  }

  followCam(dt) {
    const S = this.shot();
    if (!this.camPos) { this.camPos = S.pos.clone(); this.camLook = S.look.clone(); }
    const k = Math.min(1, dt * (this.shotKind === 'judges' ? 4 : 3));
    this.camPos.lerp(S.pos, k); this.camLook.lerp(S.look, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
  }

  // ---------- frame loop ----------
  update(dt, t) {
    if (this.state === 'count') { this.state = 'play'; this.clock = 0; } // no 3-2-1 for a beauty contest
    super.update(dt, t);
    this.updateJudges(dt);
    if (this.crown.visible) {
      const W = this.cur || this.player;
      this.crownY = Math.max(0, (this.crownY || 0) - dt * 4);
      const bounce = this.crownY > 0 ? this.crownY : 0;
      this.crown.position.set(W.x, W.y + (W.c.height || 1) - 0.06 + bounce, W.z);
      this.crown.rotation.y += dt * 1.5;
    }
  }

  step(dt, after) {
    const I = this.app.input;
    if (!after && this.state === 'play') {
      if (this.skippable && I.jumpPressed) this.fast = true;
      this.dt = dt * (this.fast ? 2.6 : 1);
      this.runSeq(this.dt);
    }
    this.moveBodies(dt, this.fast && !after ? 2.2 : 1);
  }

  runSeq(dt) {
    if (!this.seq) return;
    if (this.waitT > 0) { this.waitT -= dt; return; }
    if (this.waitFn && !this.waitFn()) return;
    this.waitFn = null;
    const r = this.seq.next();
    if (r.done) { this.seq = null; return; }
    if (typeof r.value === 'number') this.waitT = r.value;
    else if (typeof r.value === 'function') this.waitFn = r.value;
  }

  // ---------- HUD ----------
  pill(n, html, me = false) {
    const el = document.getElementById('pg-p' + n);
    if (el) { el.innerHTML = html; el.classList.toggle('me', !!me); }
  }

  standingsPill() {
    if (!this.rounds.length || this.all.every((b) => !b.total)) { this.pill(2, `YOU · ${escapeHtml(this.player.c.design.name)}`, true); return; }
    const place = this.ranking().indexOf(this.player) + 1;
    this.pill(2, `YOU · ${ord(place)} · ${fmt(this.player.total)}`, true);
  }

  hudRoot() { return document.getElementById('event-hud')?.parentElement || document.body; }

  roundCard(r, cat) {
    this.hideRoundCard(true);
    const el = this.roundEl = document.createElement('div');
    el.className = 'pg-round';
    el.innerHTML = `<small>ROUND ${r + 1}/3 · ${cat.jp}</small><b>${cat.name}</b><em>${cat.sub}</em>`;
    this.hudRoot().appendChild(el);
  }

  hideRoundCard(now) {
    const el = this.roundEl; if (!el) return;
    this.roundEl = null;
    if (now) { el.remove(); return; }
    el.classList.add('out'); setTimeout(() => el.remove(), 300);
  }

  showMeter(sweet) {
    this.hideMeter();
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const el = this.meterEl = document.createElement('div');
    el.className = 'pg-meter';
    const sw = 0.2, pw = 0.06;
    el.innerHTML = `<div class="pg-mh"><b>STRIKE A POSE!</b><span>決めポーズ</span></div>
      <div class="pg-track"><i class="pg-sweet" style="left:${((sweet - sw / 2) * 100).toFixed(1)}%;width:${sw * 100}%"></i><i class="pg-perfect" style="left:${((sweet - pw / 2) * 100).toFixed(1)}%;width:${pw * 100}%"></i><i class="pg-needle" style="left:0%"></i></div>
      <div class="pg-mf">${touch ? 'Tap <b>跳</b> when the needle hits red' : 'Press <kbd>SPACE</kbd> when the needle hits red'}</div>`;
    this.hudRoot().appendChild(el);
    this.needle = el.querySelector('.pg-needle');
  }

  meterResult(kind, bonus) {
    const el = this.meterEl; if (!el) return;
    el.classList.add('hit'); if (kind === 'awk' || kind === 'froze') el.classList.add('awk');
    el.querySelector('.pg-mh b').textContent = { perfect: 'PERFECT!', nice: 'NICE!', awk: 'AWKWARD…', froze: 'FROZE UP…' }[kind];
    el.querySelector('.pg-mh span').textContent = `+${bonus.toFixed(1)} per judge`;
  }

  hideMeter() { this.meterEl?.remove(); this.meterEl = null; this.needle = null; }

  // ---------- results ----------
  end(ranked) {
    if (this.ended) return;
    this.ended = true;
    const me = this.player;
    const rows = ranked.map((b, i) => ({ place: i + 1, name: b.c.design.name + (b === me ? ' (you)' : ''), score: fmt(b.total) + ' pts', me: b === me }));
    const won = ranked[0] === me;
    // where did the shape lose the most?
    const worst = this.rounds.slice().sort((a, b) => a.rank.get(me) - b.rank.get(me))[0];
    const poseAvg = this.playerPoses.reduce((a, v) => a + v, 0) / Math.max(1, this.playerPoses.length);
    let advice;
    if (won) {
      advice = `${escapeHtml(me.c.design.name)} takes the sash! The judges called it “${PRAISE[(Math.random() * PRAISE.length) | 0]}”.`;
      if (worst.rank.get(me) < 0.5) advice += ` (It was weak on <b>${worst.cat.name.toLowerCase()}</b>, though. Nobody's perfect.)`;
    } else {
      advice = worst.cat.tip;
      if (poseAvg < 1.2) advice += ' And nail the pose: hit jump when the needle is on the <b>red</b>.';
    }
    this.finish(won, rows, advice, { score: Math.round(me.total), text: fmt(me.total) + ' pts' });
  }

  dispose() {
    this.hideMeter(); this.hideRoundCard(true);
    document.getElementById('pageant-css')?.remove();
    document.getElementById('event-hud')?.classList.remove('pg-hud');
    for (const j of this.judges) { this.scene.remove(j.c.group, j.card); j.card.material.map?.dispose(); j.c.dispose(); }
    for (const x of this.junk) x.dispose?.();
    this.junk = [];
    this.seq = null;
    super.dispose();
  }
}
