// A living creature: clay mesh + procedural rig + googly eyes.
import * as THREE from 'three';
import { analyze, buildGeometry, facePlacement } from './builder.js';
import { computeStats } from './stats.js';
import { makeClayMaterial, updateClayMaterial } from '../fx/clay.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _g = new THREE.Vector3();

const eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.25, clearcoat: 0.6, envMapIntensity: 0.45 });
const eyeBlack = new THREE.MeshPhysicalMaterial({ color: 0x14121a, roughness: 0.1, clearcoat: 1, envMapIntensity: 0.6 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.6 });
const toothMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.3 });
const sphere = new THREE.SphereGeometry(1, 24, 16);

export class Creature {
  constructor(design, { detail = 64 } = {}) {
    this.group = new THREE.Group();   // world transform (position + heading)
    this.tilt = new THREE.Group();    // lean / tumble
    this.inner = new THREE.Group();   // offsets the drawing so feet touch y=0
    this.group.add(this.tilt); this.tilt.add(this.inner);
    this.detail = detail;
    this.material = makeClayMaterial(design);
    this.t = Math.random() * 10; this.phase = 0;
    this.motion = { speed: 0, grounded: true, gliding: false, swimming: false, vy: 0, flap: 0, celebrate: 0, dizzy: 0 };
    this.build(design);
  }

  build(design, detail = this.detail) {
    this.design = design;
    const A = analyze(design);
    this.analysis = A;
    this.stats = computeStats(A);
    if (this.mesh) { this.inner.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.rootBone) this.inner.remove(this.rootBone);
    this.mesh = null; this.bones = []; this.eyes = []; this.mouth = null;
    if (A.empty) { this.height = 0.6; this.size = 1; return; }

    const geo = buildGeometry(A, detail);
    const bones = A.bones.map((b) => { const bone = new THREE.Bone(); bone.userData = { ...b }; return bone; });
    A.bones.forEach((b, i) => {
      const bone = bones[i];
      if (b.parent < 0) bone.position.set(...b.pos);
      else {
        const p = A.bones[b.parent].pos;
        bone.position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
        bones[b.parent].add(bone);
      }
      bone.userData.rest = bone.position.clone();
    });
    this.rootBone = bones[0];
    const mesh = new THREE.SkinnedMesh(geo, this.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.inner.add(this.rootBone);
    this.inner.add(mesh);
    // ground the feet, then bind with up-to-date world matrices
    const bb = geo.boundingBox;
    this.inner.position.set(-A.bones[0].pos[0], -bb.min.y, 0);
    // reset any animated pose so the bind pose is the drawn pose
    this.group.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    this.mesh = mesh; this.bones = bones;
    this.height = bb.max.y - bb.min.y;
    this.size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    this.buildFace(A, design);
    updateClayMaterial(this.material, design);
  }

  buildFace(A, design) {
    const face = facePlacement(A, design);
    const bone = this.bones[face.bone];
    const bp = A.bones[face.bone].pos;
    const bodyColor = new THREE.Color(design.color);
    const lidMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.85), roughness: 0.6 });
    for (const e of face.eyes) {
      const eye = new THREE.Group();
      eye.position.set(e.p[0] - bp[0], e.p[1] - bp[1], e.p[2] - bp[2]);
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...e.n));
      const r = e.r;
      const style = design.eyes;
      let pupil = null;
      if (style === 'googly' || style === 'cyclops' || style === 'tri') {
        const white = new THREE.Mesh(sphere, eyeWhite);
        white.scale.set(r, r, r * 0.55); white.castShadow = true;
        pupil = new THREE.Mesh(sphere, eyeBlack);
        const pr = r * 0.48;
        pupil.scale.set(pr, pr, pr * 0.3); pupil.position.z = r * 0.5;
        pupil.userData = { max: r - pr * 0.95, vx: 0, vy: 0 };
        eye.add(white, pupil);
      } else {
        const bead = new THREE.Mesh(sphere, eyeBlack);
        bead.scale.set(r * 0.62, r * 0.75, r * 0.4); bead.castShadow = true;
        const shine = new THREE.Mesh(sphere, eyeWhite);
        shine.scale.setScalar(r * 0.16); shine.position.set(r * 0.2, r * 0.28, r * 0.3);
        eye.add(bead, shine);
        eye.userData.bead = bead;
        if (style === 'sleepy') {
          const lid = new THREE.Mesh(sphere, lidMat);
          lid.scale.set(r * 0.75, r * 0.45, r * 0.5); lid.position.set(0, r * 0.32, r * 0.1);
          eye.add(lid);
        }
        if (style === 'angry') {
          const brow = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.13, r * 0.9, 4, 8), mouthMat);
          brow.rotation.z = Math.PI / 2 + (e.p[2] > 0 ? -0.5 : 0.5);
          brow.position.set(0, r * 0.95, r * 0.15);
          eye.add(brow);
        }
      }
      eye.userData.pupil = pupil;
      eye.userData.prev = null; eye.userData.prevVel = new THREE.Vector3();
      bone.add(eye);
      this.eyes.push(eye);
    }
    if (face.mouth && design.mouth !== 'none') {
      const m = face.mouth;
      const mouth = new THREE.Group();
      mouth.position.set(m.p[0] - bp[0], m.p[1] - bp[1], m.p[2] - bp[2]);
      const n = new THREE.Vector3(...m.n);
      mouth.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const w = m.w;
      if (design.mouth === 'o') {
        const o = new THREE.Mesh(new THREE.TorusGeometry(w * 0.45, w * 0.16, 8, 20), mouthMat);
        mouth.add(o);
      } else {
        const smile = new THREE.Mesh(new THREE.TorusGeometry(w, w * 0.14, 8, 20, Math.PI), mouthMat);
        smile.rotation.z = Math.PI; smile.scale.z = 0.6;
        mouth.add(smile);
        if (design.mouth === 'fangs') {
          for (const s of [-1, 1]) {
            const t = new THREE.Mesh(new THREE.ConeGeometry(w * 0.2, w * 0.5, 8), toothMat);
            t.rotation.z = Math.PI; t.position.set(s * w * 0.55, -w * 0.95, 0.005);
            mouth.add(t);
          }
        }
      }
      // keep the smile upright relative to the head
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mouth.quaternion.clone().invert());
      mouth.rotateZ(Math.atan2(-up.x, up.y));
      bone.add(mouth);
      this.mouth = mouth;
    }
  }

  setLook(design) { updateClayMaterial(this.material, design); }

  rebuildFace(design) {
    if (!this.mesh) return;
    for (const e of this.eyes) e.parent?.remove(e);
    if (this.mouth) this.mouth.parent?.remove(this.mouth);
    this.eyes = []; this.mouth = null;
    this.buildFace(this.analysis, design);
  }

  // motion: { speed (m/s), grounded, gliding, swimming, vy }
  update(dt, motion = this.motion) {
    if (!this.mesh) return;
    this.t += dt;
    const t = this.t, M = motion;
    const st = this.stats.raw;
    const gait = this.analysis.frame.gait;
    let stride = Math.max(0.35, (st?.legLen || 0.3) * 2.2);
    if (gait === 'slither') stride = Math.max(0.6, (st?.length || 1) * 0.9);
    if (gait === 'skitter') stride *= 0.55;
    const move = Math.min(1, Math.abs(M.speed) / 3);
    const freq = gait === 'hop' ? Math.max(0.8, Math.abs(M.speed) / (stride * 1.4)) : Math.abs(M.speed) / stride;
    this.phase += dt * (M.grounded || M.swimming ? freq : freq * 0.3);
    const ph = this.phase * Math.PI * 2;
    const air = !M.grounded && !M.swimming;
    if (M.flapT) M.flapT = Math.max(0, M.flapT - dt);
    // Roly: roll like a ball while moving, settle upright when stopped
    if (gait === 'roll') {
      const R = Math.max(0.25, (this.height || 1) * 0.5);
      if (M.speed > 0.6 && (M.grounded || M.swimming)) this.rollA = (this.rollA || 0) - (M.speed * dt) / R;
      else if (this.rollA) {
        const target = Math.round(this.rollA / (Math.PI * 2)) * Math.PI * 2;
        this.rollA += (target - this.rollA) * Math.min(1, dt * 5);
      }
    }

    for (const bone of this.bones) {
      const u = bone.userData;
      const sideOff = u.side < 0 ? 0.5 : 0;
      const p = ph + (u.phase + sideOff) * Math.PI * 2;
      bone.rotation.set(0, 0, 0);
      bone.position.copy(u.rest);
      switch (u.kind) {
        case 'root': {
          let bob = 0;
          if (gait === 'hop') bob = M.grounded ? Math.abs(Math.sin(ph * 0.5)) * 0.22 * move : 0;
          else bob = Math.abs(Math.sin(ph)) * 0.035 * move;
          const breathe = Math.sin(t * 2.2) * 0.012;
          if (gait === 'slither') bob = 0;
          bone.position.y += bob + breathe;
          bone.rotation.z = -0.08 * move + (M.celebrate ? Math.sin(t * 9) * 0.15 : 0);
          bone.rotation.x = gait !== 'hop' ? Math.sin(ph) * 0.04 * move : 0;
          if (gait === 'slither') { bone.rotation.y = Math.sin(ph) * 0.28 * Math.max(move, M.swimming ? 0.6 : 0); bone.rotation.z = 0; bob = 0; }
          if (gait === 'roll') { bone.rotation.z = this.rollA || 0; }
          if (gait === 'skitter') bone.position.y += Math.abs(Math.sin(ph * 2)) * 0.02 * move;
          if (gait === 'flap' && air) bone.rotation.z = -0.25;
          const sq = (gait === 'hop' && M.grounded ? Math.cos(ph) * 0.06 * move : 0) + breathe * 0.8 + (M.land || 0) * 0.2;
          bone.scale.set(1 + sq, 1 - sq, 1 + sq);
          break;
        }
        case 'leg': {
          if (gait === 'skitter') {
            bone.rotation.x = u.side * 0.32;
            bone.rotation.z = air ? 0.4 : Math.sin(p) * 0.45 * move;
            break;
          }
          if (gait === 'roll' && (this.rollA || 0) % (Math.PI * 2) !== 0 && move > 0.2) { bone.rotation.z = 0; break; }
          if (gait === 'hop') bone.rotation.z = M.grounded ? Math.sin(ph * 0.5) * 0.35 * move : 0.5;
          else if (air) bone.rotation.z = u.phase > 0 ? -0.5 : 0.6;
          else if (M.swimming) bone.rotation.z = Math.sin(t * 9 + u.phase * 6 + sideOff * 3) * 0.6;
          else bone.rotation.z = Math.sin(p) * 0.6 * move;
          break;
        }
        case 'arm': {
          const flail = air ? Math.sin(t * 16 + sideOff * 3) * 0.8 : 0;
          bone.rotation.z = -Math.sin(p) * 0.5 * move + flail + (M.celebrate ? -2.2 + Math.sin(t * 12) * 0.4 : 0);
          bone.rotation.x = u.side * (0.12 + (air ? 0.5 : 0) + (M.celebrate ? 0.4 : 0));
          break;
        }
        case 'wing': {
          let a = 0.35 + Math.sin(t * 2) * 0.05;
          if (M.gliding) a = 1.35 + Math.sin(t * 5) * 0.06;
          else if (air) a = 0.9 + Math.sin(t * 20) * 0.6;
          else if (M.flap) a = 0.9 + Math.sin(t * 22) * 0.5;
          if (M.flapT > 0) a = 0.4 + Math.sin(M.flapT * 36) * 1.1;
          if (gait === 'flap' && M.grounded && move > 0.3) a = 0.5 + Math.abs(Math.sin(ph)) * 0.25;
          bone.rotation.x = u.side * a;
          break;
        }
        case 'fin': {
          bone.rotation.x = u.side * (0.35 + Math.sin(t * 11 + u.phase * 4) * (0.15 + 0.3 * move + (M.swimming ? 0.3 : 0)));
          break;
        }
        case 'tail': {
          if (gait === 'slither') { bone.rotation.y = Math.sin(ph - 1.3) * (0.35 + 0.4 * move) + Math.sin(t * 1.7) * 0.1; break; }
          bone.rotation.y = Math.sin(t * (3 + move * 6)) * (0.18 + 0.25 * move) * (M.swimming ? 2.2 : 1);
          bone.rotation.z = Math.sin(t * 2.3) * 0.08 - (air ? 0.25 : 0) + M.vy * 0.02;
          break;
        }
        case 'head': {
          bone.rotation.z = -Math.abs(Math.sin(ph)) * 0.06 * move + Math.sin(t * 0.9) * 0.05;
          bone.rotation.y = Math.sin(t * 0.6) * 0.25 * (1 - move) + (M.dizzy ? Math.sin(t * 10) * 0.4 : 0) + (gait === 'slither' ? -Math.sin(ph) * 0.22 * move : 0);
          break;
        }
        case 'top': {
          bone.rotation.z = Math.sin(t * 7) * 0.05 * move + Math.sin(t * 3.1) * 0.03;
          break;
        }
      }
    }
    if (M.land) M.land = Math.max(0, M.land - dt * 4);
    this.updateEyes(dt);
    this.material.userData.uniforms.uTime.value = t;
  }

  updateEyes(dt) {
    if (dt <= 0) return;
    for (const eye of this.eyes) {
      const ud = eye.userData;
      eye.getWorldPosition(_v);
      if (!ud.prev) { ud.prev = _v.clone(); continue; }
      const vel = _v.clone().sub(ud.prev).divideScalar(dt);
      const acc = vel.clone().sub(ud.prevVel).divideScalar(dt);
      ud.prev.copy(_v); ud.prevVel.copy(vel);
      const p = ud.pupil;
      if (!p) {
        // bead eyes blink every so often
        const blink = (Math.sin(this.t * 0.7 + eye.id) > 0.995) ? 0.1 : 1;
        ud.bead.scale.y += ((ud.bead.scale.x / 0.62) * 0.75 * blink - ud.bead.scale.y) * Math.min(1, dt * 30);
        continue;
      }
      // pseudo-force in eye space: gravity minus head acceleration
      _g.set(0, -9.8, 0).sub(acc.clampLength(0, 60).multiplyScalar(0.5));
      eye.getWorldQuaternion(_q).invert();
      _g.applyQuaternion(_q);
      const pu = p.userData;
      pu.vx += _g.x * dt * 2.2; pu.vy += _g.y * dt * 2.2;
      pu.vx *= Math.pow(0.08, dt); pu.vy *= Math.pow(0.08, dt);
      p.position.x += pu.vx * dt; p.position.y += pu.vy * dt;
      const d = Math.hypot(p.position.x, p.position.y);
      if (d > pu.max) {
        const nx = p.position.x / d, ny = p.position.y / d;
        p.position.x = nx * pu.max; p.position.y = ny * pu.max;
        const dot = pu.vx * nx + pu.vy * ny;
        if (dot > 0) { pu.vx -= 1.6 * dot * nx; pu.vy -= 1.6 * dot * ny; }
      }
    }
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.material.dispose();
  }
}
