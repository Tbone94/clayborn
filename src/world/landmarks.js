// Little landmarks for the side games, so each one is a place you walk to rather than a menu.
// Toy-box palette, chunky clay shapes, one sign each.
import * as THREE from 'three';
import { pbr } from './nature.js';
import { clayMat } from '../scenes/common.js';

const INK = '#15172b', RED = '#e63b2e', YELLOW = '#ffd23f', PAPER = '#f1ebdd', WHITE = '#fbf8f0';
const clay = (c, pattern = 'solid', c2 = c) => clayMat('lm' + c + pattern + c2, { color: c, color2: c2, pattern });
const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = shadow(new THREE.Mesh(g, m)); o.position.set(x, y, z); return o; };

function posts(w, h) {
  const wood = pbr('bark_brown_02', 1, 2), g = new THREE.Group();
  for (const x of [-w / 2, w / 2]) g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, h, 10), wood, x, h / 2, 0));
  return g;
}

function checkerTexture(n = 8) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), s = 128 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? INK : WHITE; x.fillRect(i * s, j * s, s, s); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}

// a stage with a curtain arch and three yellow stars on top
export function pageantStage() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.42, 40), [pbr('wood_planks', 3, 0.3), pbr('wood_planks', 2, 2), pbr('wood_planks', 2, 2)], 0, 0.21, 0));
  const arch = mesh(new THREE.TorusGeometry(1.9, 0.16, 10, 40, Math.PI), clay(RED, 'stripes', '#ff8fd0'), 0, 0.42, -0.9);
  g.add(arch);
  const star = (x, y, s) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.42 : 1; sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    geo.center(); const m = mesh(geo, clay(YELLOW), x, y, -0.9); m.scale.setScalar(s); return m;
  };
  const stars = [star(0, 2.75, 0.42), star(-1.2, 2.2, 0.28), star(1.2, 2.2, 0.28)];
  g.add(...stars);
  return { group: g, update: (t) => stars.forEach((s, i) => { s.rotation.y = Math.sin(t * 1.4 + i) * 0.5; }), signY: 3.9 };
}

// a checkerboard dance floor whose tiles flash, and a disco ball
export function danceFloor() {
  const g = new THREE.Group(), tiles = [];
  const cols = [RED, YELLOW, '#ff8fd0', '#2fe0c0'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const m = new THREE.MeshStandardMaterial({ color: (i + j) % 2 ? INK : WHITE, roughness: 0.35, emissive: cols[(i * 3 + j) % 4], emissiveIntensity: 0 });
    const t = mesh(new THREE.BoxGeometry(0.98, 0.16, 0.98), m, (i - 1.5) * 1.02, 0.08, (j - 1.5) * 1.02);
    tiles.push(t); g.add(t);
  }
  g.add(posts(0.01, 3.3).children[0]);
  g.children[g.children.length - 1].position.set(-2.2, 1.65, -2.2);
  const ball = mesh(new THREE.IcosahedronGeometry(0.42, 2), new THREE.MeshStandardMaterial({ color: '#d8dde6', metalness: 1, roughness: 0.18, flatShading: true }), -2.2, 3.4, -2.2);
  g.add(ball);
  return {
    group: g, signY: 4.4,
    update: (t) => {
      const beat = Math.floor(t * 2);
      tiles.forEach((tl, k) => { tl.material.emissiveIntensity = ((k + beat) % 3 === 0) ? 0.9 : 0.05; });
      ball.rotation.y = t * 0.8;
    },
  };
}

// a start gate with a checkered banner and a big clay ball waiting to roll
export function startGate() {
  const g = posts(3.2, 2.6);
  const bar = mesh(new THREE.BoxGeometry(3.4, 0.5, 0.08), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }), 0, 2.45, 0);
  g.add(bar);
  const ball = mesh(new THREE.SphereGeometry(0.75, 32, 20), clay('#4fc3ff', 'stripes', WHITE), 1.9, 0.72, 1.2);
  g.add(ball);
  return { group: g, signY: 3.8, update: (t) => { ball.rotation.z = Math.sin(t * 0.9) * 0.25; } };
}

// a sign + a bait bucket with a rod leaning on it, at the foot of the pier
export function fishingSpot() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.5, 18, 1, true), clay('#5aa9e6'), 0.9, 0.25, 0.6));
  g.add(mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 20), clay(INK), 0.9, 0.5, 0.6).rotateX(Math.PI / 2));
  const rod = mesh(new THREE.CylinderGeometry(0.025, 0.04, 2.6, 6), pbr('bark_brown_02', 1, 2), 1.1, 1.25, 0.4);
  rod.rotation.z = -0.35; g.add(rod);
  return { group: g, signY: 2.6 };
}

// a wooden frame with a brass bell: ring it to start hide & seek
export function bellFrame() {
  const g = posts(1.6, 2.4);
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8), pbr('bark_brown_02', 1, 1), 0, 2.35, 0).rotateZ(Math.PI / 2));
  const prof = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; prof.push(new THREE.Vector2(0.06 + 0.42 * Math.pow(u, 1.8) + (u > 0.9 ? 0.05 : 0), -u * 0.7)); }
  const bell = mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: '#e0a92e', metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }), 0, 2.28, 0);
  g.add(bell);
  return { group: g, signY: 3.4, update: (t) => { bell.rotation.z = Math.sin(t * 1.6) * 0.06; }, ring: () => { bell.rotation.z = 0.5; } };
}

// a noticeboard with today's challenge pinned to it (the paper is redrawn when it changes)
export function noticeBoard() {
  const g = posts(1.9, 2.3);
  g.add(mesh(new THREE.BoxGeometry(2.1, 1.4, 0.1), pbr('wood_planks', 1, 1), 0, 1.75, 0));
  const c = document.createElement('canvas'); c.width = 512; c.height = 320;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.125), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  paper.position.set(0, 1.75, 0.06); paper.rotation.z = -0.02; g.add(paper);
  const draw = ({ text, done, stamps }) => {
    const x = c.getContext('2d');
    x.fillStyle = PAPER; x.fillRect(0, 0, 512, 320);
    x.fillStyle = INK; x.fillRect(0, 0, 512, 64);
    x.fillStyle = YELLOW; x.font = '400 34px "Dela Gothic One", sans-serif'; x.textBaseline = 'middle'; x.fillText("TODAY'S CHALLENGE", 22, 34);
    x.fillStyle = INK; x.font = '700 30px "Zen Kaku Gothic New", sans-serif';
    const words = text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').split(' '); let line = '', y = 112;
    for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > 468 && line) { x.fillText(line, 22, y); y += 40; line = w; } else line = t; }
    x.fillText(line, 22, y);
    x.fillStyle = RED; x.font = '400 24px "DotGothic16", monospace'; x.fillText(`STAMPS ×${stamps}`, 22, 292);
    if (done) {
      x.save(); x.translate(400, 230); x.rotate(-0.25);
      x.strokeStyle = RED; x.lineWidth = 8; x.beginPath(); x.arc(0, 0, 62, 0, Math.PI * 2); x.stroke();
      x.fillStyle = RED; x.font = '400 40px "Dela Gothic One", sans-serif'; x.textAlign = 'center'; x.fillText('DONE', 0, 4);
      x.restore();
    }
    tex.needsUpdate = true;
  };
  return { group: g, signY: 3.3, draw };
}
