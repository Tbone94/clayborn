// Add-on pieces: physical bits you stick onto a monster, like Amazing Island's parts.
// Every piece is built at unit size with its base at the origin and "out of the body" along +Y,
// and the creature's front along +Z. A placement stores a rest-pose surface point + normal,
// so pieces ride along on the nearest bone and survive redraws (they re-snap to the new skin).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeClayMaterial } from '../fx/clay.js';

const INK = '#2a2d4c', BONE = '#f2e6c9', GOLD = '#f2b134', RED = '#e63b2e', WHITE = '#fbf8f0';
export const ADDON_COLORS = [
  ['auto', 'Default'], ['body', 'Body'], ['accent', 'Accent'], [BONE, 'Bone'], [INK, 'Ink'],
  [RED, 'Red'], [GOLD, 'Gold'], [WHITE, 'White'], ['#ff6fa8', 'Pink'], ['#2f6fdf', 'Blue'], ['#9bc53d', 'Green'],
];
export const MAX_ADDONS = 24;

// ---------- geometry helpers ----------
// a tube along points that tapers from r0 to r1, with a rounded tip
function taper(pts, r0, r1, radial = 12, segs = 18) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = curve.getPointAt(t), N = frames.normals[i], B = frames.binormals[i];
    const r = r0 + (r1 - r0) * Math.pow(t, 0.9);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(c.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r, c.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r, c.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  const tip = curve.getPointAt(1).add(curve.getTangentAt(1).multiplyScalar(r1));
  const ti = pos.length / 3; pos.push(tip.x, tip.y, tip.z);
  for (let j = 0; j < radial; j++) idx.push(segs * radial + j, ti, segs * radial + (j + 1) % radial);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const up = (g, y) => { g.translate(0, y, 0); return g; };
const sph = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);

// ---------- the catalog ----------
// make(mat, fixed) → Object3D; `mat` is the piece's chosen color, `fixed(hex)` gives a fixed one
export const ADDONS = {
  horn: { label: 'Horn', size: 0.22, color: BONE, mirror: true,
    make: (m) => mesh(taper([[0, -0.05, 0], [0, 0.4, 0.04], [0, 0.75, 0.22], [0, 0.95, 0.52]], 0.17, 0.012), m) },
  spike: { label: 'Spike', size: 0.15, color: 'accent', mirror: true,
    make: (m) => mesh(up(new THREE.ConeGeometry(0.34, 1, 14), 0.45), m) },
  claw: { label: 'Claw', size: 0.13, color: INK, mirror: true,
    make: (m) => mesh(taper([[0, -0.05, 0], [0, 0.3, 0.08], [0, 0.52, 0.3], [0, 0.58, 0.62]], 0.2, 0.012), m) },
  tusk: { label: 'Tusk', size: 0.18, color: BONE, mirror: true,
    make: (m) => mesh(taper([[0, -0.05, 0], [0, 0.25, 0.3], [0, 0.55, 0.55], [0, 0.95, 0.55]], 0.14, 0.02), m) },
  antenna: { label: 'Antenna', size: 0.3, color: 'accent', mirror: true, wiggle: true,
    make: (m, fixed) => group(mesh(up(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 8), 0.42), fixed(INK)), at(mesh(sph(0.13), m), 0, 0.92, 0)) },
  ear: { label: 'Ear', size: 0.22, color: 'body', mirror: true,
    make: (m) => { const g = up(new THREE.ConeGeometry(0.36, 1, 18), 0.45); g.scale(1, 1, 0.32); return mesh(g, m); } },
  fin: { label: 'Fin', size: 0.26, color: 'accent', mirror: true,
    make: (m) => {
      const s = new THREE.Shape();
      s.moveTo(-0.45, 0); s.quadraticCurveTo(-0.35, 0.7, 0.25, 1.0); s.quadraticCurveTo(0.15, 0.45, 0.5, 0); s.lineTo(-0.45, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
      g.translate(0, -0.03, -0.035); g.rotateY(-Math.PI / 2);
      return mesh(g, m);
    } },
  eye: { label: 'Extra eye', size: 0.11, color: WHITE, mirror: false, eye: true,
    make: () => {
      const outer = new THREE.Group(), e = new THREE.Group();
      e.rotation.x = -Math.PI / 2; outer.add(e);
      const white = new THREE.Mesh(sph(1, 24, 16), EYE_WHITE); white.scale.set(1, 1, 0.6); white.castShadow = true;
      const pupil = new THREE.Mesh(sph(1, 20, 12), EYE_BLACK); pupil.scale.set(0.48, 0.48, 0.15); pupil.position.z = 0.52;
      pupil.userData = { max: 1 - 0.48 * 0.95, vx: 0, vy: 0 };
      e.add(white, pupil);
      e.userData.pupil = pupil; e.userData.prev = null; e.userData.prevVel = new THREE.Vector3();
      outer.userData.eye = e;
      return outer;
    } },
  nose: { label: 'Clown nose', size: 0.1, color: RED, mirror: false,
    make: (m) => { const g = sph(0.55); g.scale(1, 0.85, 1); return mesh(up(g, 0.3), m, 'vinyl'); } },
  mustache: { label: 'Mustache', size: 0.2, color: INK, mirror: false,
    make: (m) => {
      const half = (s) => taper([[0, 0.08, 0.02], [s * 0.35, 0.12, 0.06], [s * 0.7, 0.05, 0.05], [s * 0.8, 0.22, 0.04]], 0.11, 0.03, 10, 16);
      return group(mesh(half(1), m), mesh(half(-1), m));
    } },
  tuft: { label: 'Hair tuft', size: 0.2, color: INK, mirror: false,
    make: (m) => group(...[-0.5, -0.2, 0.1, 0.4].map((a, i) => mesh(taper([[0, -0.05, 0], [a * 0.2, 0.4, -0.05], [a * 0.6, 0.75 + (i % 2) * 0.15, -0.25]], 0.07, 0.01, 8, 10), m))) },
  flower: { label: 'Flower', size: 0.16, color: '#ff6fa8', mirror: false, wiggle: true,
    make: (m, fixed) => {
      const g = group(mesh(up(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 6), 0.28), fixed('#5d9b3a')));
      const head = new THREE.Group(); head.position.y = 0.62; head.rotation.x = 0.5; g.add(head);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const p = mesh(sph(0.16, 12, 8), m); p.scale.set(1, 0.4, 0.7); p.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2); head.add(p); }
      head.add(mesh(sph(0.12, 12, 8), fixed('#ffd23f')));
      return g;
    } },
  crown: { label: 'Crown', size: 0.24, color: GOLD, mirror: false,
    make: (m) => {
      const g = group(mesh(up(new THREE.CylinderGeometry(0.5, 0.46, 0.32, 24, 1, true), 0.16), m, 'vinyl', true));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(at(mesh(up(new THREE.ConeGeometry(0.12, 0.34, 8), 0.17), m, 'vinyl'), Math.cos(a) * 0.48, 0.3, Math.sin(a) * 0.48));
        g.add(at(mesh(sph(0.06, 10, 8), m, 'vinyl'), Math.cos(a) * 0.48, 0.66, Math.sin(a) * 0.48));
      }
      return g;
    } },
  partyhat: { label: 'Party hat', size: 0.26, color: '#7b4fe0', mirror: false,
    make: (m, fixed) => group(mesh(up(new THREE.ConeGeometry(0.42, 1, 22, 1, true), 0.48), m, 'vinyl', true), at(mesh(sph(0.12, 12, 8), fixed(WHITE)), 0, 0.98, 0)) },
  tophat: { label: 'Top hat', size: 0.24, color: INK, mirror: false,
    make: (m, fixed) => group(
      mesh(up(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 28), 0.03), m, 'felt'),
      mesh(up(new THREE.CylinderGeometry(0.38, 0.4, 0.75, 28), 0.42), m, 'felt'),
      mesh(up(new THREE.CylinderGeometry(0.405, 0.405, 0.14, 28, 1, true), 0.14), fixed(RED), 'felt', true)) },
  shades: { label: 'Shades', size: 0.2, color: INK, mirror: false,
    make: (m) => {
      const lens = () => { const g = new THREE.CylinderGeometry(0.34, 0.3, 0.08, 20); g.rotateX(Math.PI / 2); g.scale(1.15, 0.85, 1); return g; };
      return group(at(mesh(lens(), m, 'vinyl'), 0.42, 0.15, 0.05), at(mesh(lens(), m, 'vinyl'), -0.42, 0.15, 0.05),
        at(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), m, 'vinyl'), 0, 0.22, 0.05));
    } },
  bowtie: { label: 'Bow tie', size: 0.15, color: RED, mirror: false,
    make: (m) => {
      const wing = (s) => { const g = new THREE.ConeGeometry(0.32, 0.6, 4); g.rotateZ(s * Math.PI / 2); g.translate(s * 0.3, 0.2, 0); g.scale(1, 1, 0.5); return mesh(g, m, 'felt'); };
      return group(wing(1), wing(-1), at(mesh(sph(0.13, 10, 8), m, 'felt'), 0, 0.2, 0));
    } },
  // face stamps: put them anywhere (yes, anywhere)
  tongue: { label: 'Tongue', size: 0.2, color: '#e8546f', mirror: false, wiggle: true,
    make: (m) => { const g = taper([[0, -0.05, 0], [0, 0.3, -0.04], [0, 0.55, -0.28], [0, 0.6, -0.72]], 0.22, 0.14, 14, 20); g.scale(1.25, 1, 0.75); return mesh(g, m, 'vinyl'); } },
  teeth: { label: 'Buck teeth', size: 0.13, color: BONE, mirror: false,
    make: (m) => {
      const tooth = (x) => { const g = new THREE.CapsuleGeometry(0.2, 0.45, 4, 10); g.scale(1, 1, 0.45); g.translate(x, 0.32, 0); g.rotateX(-0.25); return mesh(g, m, 'vinyl'); };
      return group(tooth(-0.22), tooth(0.22));
    } },
  fangs: { label: 'Fang row', size: 0.18, color: BONE, mirror: false,
    make: (m) => group(...[-0.48, -0.24, 0, 0.24, 0.48].map((x, i) => { const g = up(new THREE.ConeGeometry(0.1 + (i % 2) * 0.03, 0.42 + (i % 2) * 0.2, 10), 0.2); g.rotateX(-0.5); return at(mesh(g, m, 'vinyl'), x, 0, Math.abs(x) * -0.3); })) },
  mouth2: { label: 'Extra mouth', size: 0.2, color: '#c2185b', mirror: false,
    make: (m, fixed) => {
      const hole = sph(0.5, 24, 12); hole.scale(1, 0.18, 0.42);
      const lips = new THREE.TorusGeometry(0.5, 0.1, 10, 28); lips.rotateX(Math.PI / 2); lips.scale(1, 1, 0.48);
      const g = group(at(mesh(hole, fixed('#2a0f1c')), 0, 0.03, 0), at(mesh(lips, m, 'vinyl'), 0, 0.08, 0));
      for (const x of [-0.24, 0, 0.24]) g.add(at(mesh(new THREE.ConeGeometry(0.06, 0.16, 8), fixed(WHITE), 'vinyl'), x, 0.1, 0.13));
      return g;
    } },
  eyestalk: { label: 'Eye stalk', size: 0.3, color: 'body', mirror: true, wiggle: true,
    make: (m) => {
      const g = group(mesh(taper([[0, -0.05, 0], [0, 0.35, 0.05], [0, 0.65, 0.15], [0, 0.8, 0.22]], 0.09, 0.06, 10, 14), m));
      const e = ADDONS.eye.make(); e.scale.setScalar(0.24); e.position.set(0, 0.86, 0.22); g.add(e);
      g.userData.eye = e.userData.eye;
      return g;
    } },
  wart: { label: 'Warts', size: 0.1, color: '#9bc53d', mirror: false,
    make: (m) => group(at(mesh(sph(0.42), m), 0, 0.1, 0), at(mesh(sph(0.26), m), 0.42, 0.04, 0.12), at(mesh(sph(0.18), m), -0.3, 0.02, -0.3), at(mesh(sph(0.12), m), 0.06, 0.48, 0.06)) },
  bandage: { label: 'Bandage', size: 0.18, color: '#f2d0a9', mirror: false,
    make: (m, fixed) => {
      const strip = new THREE.CapsuleGeometry(0.2, 0.9, 4, 12); strip.rotateZ(Math.PI / 2); strip.scale(1, 0.18, 1); strip.rotateY(0.6);
      const pad = new THREE.BoxGeometry(0.34, 0.08, 0.3); pad.rotateY(0.6);
      return group(at(mesh(strip, m, 'felt'), 0, 0.03, 0), at(mesh(pad, fixed('#fbf8f0'), 'felt'), 0, 0.07, 0));
    } },
};

// add-on grid sections (anything not listed lands in BODY)
export const ADDON_SECTIONS = [
  ['FACE', '顔', ['eye', 'eyestalk', 'mouth2', 'tongue', 'teeth', 'fangs', 'nose', 'bignose', 'carrot', 'mustache', 'handlebar', 'shades', 'pixelshades', 'partyshades', 'wart', 'bandage']],
  ['HEAD', '頭', ['horn', 'bullhorn', 'antlers', 'antenna', 'ear', 'bunny', 'tuft', 'flower']],
  ['HATS', '帽', ['crown', 'partyhat', 'tophat', 'beanie', 'cowboy', 'viking', 'pirate', 'bowtie']],
  ['BODY', '体', null],
];

// ---------- free models (Poly Pizza / Quaternius / Kenney; credits in public/assets/addons/CREDITS.json) ----------
// rot: euler that turns the file so it sticks out along +Y (away from the body); face-worn
// things (glasses, noses) get [π/2, π, 0] so their front points out of the face and their top points up
const MODELS = {
  beanie: { file: 'propeller-beanie', label: 'Propeller hat', size: 0.3, rot: [0, 0, 0] },
  pixelshades: { file: 'pixel-sunglasses', label: 'Deal-with-it shades', size: 0.3, rot: [Math.PI / 2, Math.PI, 0] },
  partyshades: { file: 'shutter-shades', label: 'Party shades', size: 0.3, rot: [Math.PI / 2, Math.PI, 0] },
  cowboy: { file: 'cowboy-hat', label: 'Cowboy hat', size: 0.36, rot: [0, 0, 0] },
  viking: { file: 'viking-helmet', label: 'Viking helmet', size: 0.36, rot: [0, 0, 0] },
  pirate: { file: 'pirate-hat', label: 'Pirate hat', size: 0.34, rot: [0, 0, 0] },
  bignose: { file: 'big-nose', label: 'Human nose', size: 0.16, rot: [Math.PI / 2, Math.PI, 0] },
  carrot: { file: 'carrot-nose', label: 'Carrot nose', size: 0.2, rot: [Math.PI, 0, 0] },
  antlers: { file: 'antlers', label: 'Antlers', size: 0.4, rot: [0, 0, 0] },
  bullhorn: { file: 'horn-bull', label: 'Bull horn', size: 0.26, rot: [0, 0, 0], mirror: true },
  tentacle: { file: 'tentacle', label: 'Tentacle', size: 0.34, rot: [0, 0, Math.PI / 2], mirror: true, wiggle: true },
  bunny: { file: 'bunny-ears', label: 'Bunny ears', size: 0.36, rot: [0, 0, 0] },
  batwing: { file: 'bat-wing', label: 'Bat wings', size: 0.42, rot: [0, 0, 0] },
  chickenfoot: { file: 'chicken-foot', label: 'Chicken foot', size: 0.24, rot: [Math.PI, 0, 0], mirror: true },
  sharkfin: { file: 'shark-fin', label: 'Shark fin', size: 0.28, rot: [0, Math.PI, 0] },
  handlebar: { file: 'mustache-handlebar', label: 'Fancy mustache', size: 0.24, rot: [0, 0, 0] },
};
const TEMPLATES = new Map();
let loading = null;
export function loadAddonModels() {
  if (loading) return loading;
  const loader = new GLTFLoader(), base = (import.meta.env?.BASE_URL || './') + 'assets/addons/';
  loading = Promise.all(Object.entries(MODELS).map(([key, m]) => loader.loadAsync(base + m.file + '.glb').then((gltf) => {
    TEMPLATES.set(key, normalize(gltf.scene, m.rot));
  }).catch((e) => console.warn('add-on model failed', m.file, e))));
  return loading;
}
// stand it on the origin, unit-sized, pointing up
function normalize(scene, rot) {
  const spin = new THREE.Group(); spin.rotation.set(...rot); spin.add(scene);
  const holder = new THREE.Group(); holder.add(spin); holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
  spin.position.set(-c.x, -box.min.y, -c.z);
  holder.scale.setScalar(k);
  holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return holder;
}
function modelPiece(key) {
  const g = new THREE.Group();
  const fill = () => { const t = TEMPLATES.get(key); if (t) g.add(t.clone(true)); };
  if (TEMPLATES.has(key)) fill(); else loadAddonModels().then(fill);
  return g;
}
for (const [key, m] of Object.entries(MODELS)) {
  ADDONS[key] = { label: m.label, size: m.size, mirror: !!m.mirror, wiggle: !!m.wiggle, model: true, make: () => modelPiece(key) };
}

// ---------- materials (shared per color + finish) ----------
const EYE_WHITE = new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.25, clearcoat: 0.6, envMapIntensity: 0.45 });
const EYE_BLACK = new THREE.MeshPhysicalMaterial({ color: 0x14121a, roughness: 0.1, clearcoat: 1, envMapIntensity: 0.6 });
const MATS = new Map();
function clayMat(color, finish, doubleSide) {
  const key = color + '|' + finish + (doubleSide ? '|2' : '');
  if (!MATS.has(key)) {
    const m = makeClayMaterial({ color, color2: color, pattern: 'solid', finish, seed: 3 });
    if (doubleSide) m.side = THREE.DoubleSide;
    MATS.set(key, m);
  }
  return MATS.get(key);
}
let curFinish = 'clay';
function mesh(geo, mat, finish, doubleSide) {
  // mat is a color string at build time; resolve to a shared material
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? clayMat(mat, finish || curFinish, doubleSide) : mat);
  m.castShadow = true;
  return m;
}
function group(...kids) { const g = new THREE.Group(); g.add(...kids); return g; }
function at(o, x, y, z) { o.position.set(x, y, z); return o; }

export function resolveColor(a, design) {
  const def = ADDONS[a.type]?.color;
  let c = !a.color || a.color === 'auto' ? def : a.color;
  if (c === 'body') c = design.color;
  if (c === 'accent') c = design.color2;
  return c || BONE;
}

// one piece (unit size), ready to be posed
export function makePiece(a, design) {
  const def = ADDONS[a.type];
  if (!def) return null;
  curFinish = design.finish === 'jelly' ? 'vinyl' : design.finish || 'clay';
  const obj = def.make(resolveColor(a, design), (hex) => hex);
  return obj;
}

// ---------- placement maths ----------
const _n = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
// orientation: +Y along the surface normal, +Z towards the creature's front (+x), then turn/tilt
export function pieceQuaternion(n, turn = 0, tilt = 0, out = new THREE.Quaternion()) {
  _n.set(n[0], n[1], n[2]).normalize();
  _t.set(1, 0, 0);
  if (Math.abs(_n.dot(_t)) > 0.92) _t.set(0, 1, 0);
  _t.addScaledVector(_n, -_n.dot(_t)).normalize();
  _b.crossVectors(_n, _t);
  _m.makeBasis(_b, _n, _t);
  out.setFromRotationMatrix(_m);
  out.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
  out.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
  return out;
}

// nearest skin vertex → its rest position, normal and dominant bone
export function nearestSkin(geo, p) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array;
  const SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
  let best = 1e9, bi = 0;
  for (let i = 0, n = P.length / 3; i < n; i++) {
    const dx = P[i * 3] - p[0], dy = P[i * 3 + 1] - p[1], dz = P[i * 3 + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  let bone = SI[bi * 4], w = SW[bi * 4];
  for (let k = 1; k < 4; k++) if (SW[bi * 4 + k] > w) { w = SW[bi * 4 + k]; bone = SI[bi * 4 + k]; }
  return { dist: Math.sqrt(best), p: [P[bi * 3], P[bi * 3 + 1], P[bi * 3 + 2]], n: [N[bi * 3], N[bi * 3 + 1], N[bi * 3 + 2]], bone };
}

// a raycast hit on the (posed) skinned mesh → the same spot on the rest-pose surface
const _a = new THREE.Vector3(), _bb = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _bar = new THREE.Vector3();
export function restPointFromHit(mesh, hit) {
  const g = mesh.geometry, f = hit.face;
  mesh.getVertexPosition(f.a, _a); mesh.getVertexPosition(f.b, _bb); mesh.getVertexPosition(f.c, _c);
  _p.copy(hit.point); mesh.worldToLocal(_p);
  THREE.Triangle.getBarycoord(_p, _a, _bb, _c, _bar);
  const P = g.attributes.position, N = g.attributes.normal;
  const p = [0, 0, 0], n = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const get = (attr, i) => attr.array[i * 3 + k];
    p[k] = get(P, f.a) * _bar.x + get(P, f.b) * _bar.y + get(P, f.c) * _bar.z;
    n[k] = get(N, f.a) * _bar.x + get(N, f.b) * _bar.y + get(N, f.c) * _bar.z;
  }
  const l = Math.hypot(...n) || 1;
  return { p, n: n.map((v) => v / l) };
}

// ---------- design data ----------
export function newAddon(type, p, n) {
  const def = ADDONS[type];
  return { type, p, n, s: def.size, turn: 0, tilt: 0, mirror: def.mirror && Math.abs(p[2]) > 0.04, color: 'auto' };
}
const r3 = (v) => Math.round(v * 1000) / 1000;
export function packAddons(list = []) {
  return list.map((a) => [a.type, a.p.map(r3), a.n.map(r3), r3(a.s), r3(a.turn), r3(a.tilt), a.mirror ? 1 : 0, a.color]);
}
export function unpackAddons(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((r) => ADDONS[r[0]]).slice(0, MAX_ADDONS)
    .map(([type, p, n, s, turn, tilt, mirror, color]) => ({ type, p, n, s, turn, tilt, mirror: !!mirror, color: color || 'auto' }));
}
