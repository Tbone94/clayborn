// Shared world-building: light, sky, toy-ocean, particles and clay props.
import * as THREE from 'three';
import { makeClayMaterial, NOISE_GLSL } from '../fx/clay.js';
import { QUALITY as Q } from '../fx/quality.js';

export function setupLights(scene, app, { size = 30, sky = '#fff1dc', ground = '#b98a6a' } = {}) {
  scene.environment = app.gfx.envMap; scene.environmentIntensity = 0.3;
  const hemi = new THREE.HemisphereLight(sky, ground, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe4bf', 3.1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 140 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  sun.userData.offset = new THREE.Vector3(18, 34, 14);
  scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight('#a9cfff', 0.6); fill.position.set(-20, 10, -15); scene.add(fill);
  return {
    hemi, sun,
    follow(p) { sun.position.copy(p).add(sun.userData.offset); sun.target.position.copy(p); },
  };
}

export function makeSky(scene, top = '#7fc3e8', bottom = '#ffe2bd', fog = [60, 190]) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, bottom; varying vec3 vP;
      ${NOISE_GLSL}
      void main(){ float h = clamp(vP.y*1.6+0.15, 0.0, 1.0);
        vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, h));
        // painterly cloud streaks
        float cl = fbm3(vec3(vP.x*3.0, vP.y*9.0, vP.z*3.0)) ; cl = smoothstep(0.55, 0.75, cl) * smoothstep(0.02, 0.25, vP.y) * (1.0 - smoothstep(0.45, 0.8, vP.y));
        c = mix(c, vec3(1.0, 0.97, 0.93), cl*0.7);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat); sky.renderOrder = -1; scene.add(sky);
  scene.fog = new THREE.Fog(new THREE.Color(bottom).lerp(new THREE.Color(top), 0.25), fog[0], fog[1]);
  scene.background = new THREE.Color(bottom);
  return sky;
}

// Height texture → water knows how deep it is (shallow turquoise, foam on shores).
export function heightTexture(fn, x0, z0, size, res = 256) {
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) data[j * res + i] = fn(x0 + (i + 0.5) / res * size, z0 + (j + 0.5) / res * size);
  const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

export function makeWater(scene, { size = 400, level = 0, hTex, hBox, deep = '#2f7fb8', shallow = '#5fd6d0', foam = '#ffffff' }) {
  const geo = new THREE.PlaneGeometry(size, size, 160, 160); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: deep, roughness: 0.18, metalness: 0.0, transparent: false });
  const uniforms = {
    uTime: { value: 0 }, uH: { value: hTex }, uHBox: { value: new THREE.Vector4(...hBox) },
    uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) }, uFoam: { value: new THREE.Color(foam) }, uLevel: { value: level },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
        transformed.y += sin(wp0.x*0.35 + uTime*1.3)*0.06 + sin(wp0.z*0.42 - uTime*1.1)*0.06;
        vW = (modelMatrix * vec4(transformed,1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform sampler2D uH; uniform vec4 uHBox; uniform vec3 uDeep, uShallow, uFoam; uniform float uLevel; varying vec3 vW;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 huv = (vW.xz - uHBox.xy) / uHBox.zw;
        float gh = (huv.x>0.0 && huv.y>0.0 && huv.x<1.0 && huv.y<1.0) ? texture2D(uH, huv).r : -20.0;
        float depth = uLevel - gh;
        float sh = 1.0 - smoothstep(0.0, 3.5, depth);
        vec3 col = mix(uDeep, uShallow, sh);
        // caustic-ish ripples in the shallows
        float cs = sin(vW.x*1.7 + uTime*1.3 + sin(vW.z*1.1 + uTime)) * sin(vW.z*1.9 - uTime*1.1 + sin(vW.x*0.9));
        col += sh * 0.14 * smoothstep(0.75, 0.95, cs);
        // foam ring on shore, wobbling
        float fn = vnoise(vec3(vW.xz*0.6, uTime*0.5));
        float foam = smoothstep(0.55, 0.2, depth + fn*0.5 - 0.1 + sin(uTime*1.6 + depth*6.0)*0.08);
        foam += smoothstep(0.08, 0.0, abs(depth - 0.9 - sin(uTime*0.9)*0.3 - fn*0.3)) * 0.6 * sh;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0));
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = 0.12 + 0.25*vnoise(vec3(vW.xz*0.8, uTime));`);
  };
  mat.customProgramCacheKey = () => 'toywater';
  const m = new THREE.Mesh(geo, mat); m.position.y = level; m.receiveShadow = true;
  scene.add(m);
  return { mesh: m, uniforms, update(t) { uniforms.uTime.value = t; } };
}

// ---------- particles: dust, splash, confetti, sparkles, gloom motes ----------
const _c = new THREE.Color();
export class Particles {
  constructor(scene, max = Q.particles) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max); this.grav = new Float32Array(max); this.s0 = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float size; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if(r>0.5) discard;
        float shade = 0.75 + 0.35*(0.5 - d.y - d.x*0.3); gl_FragColor = vec4(vC*shade, smoothstep(0.5,0.42,r)); }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; scene.add(this.points);
  }
  emit(x, y, z, { count = 10, color = '#ffffff', colors, speed = 3, up = 2, spread = 1, gravity = 9, size = 0.25, life = 0.8 } = {}) {
    const c = _c;
    for (let k = 0; k < count; k++) {
      const i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      const i3 = i * 3;
      this.pos[i3] = x + (Math.random() - 0.5) * spread * 0.3; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z + (Math.random() - 0.5) * spread * 0.3;
      this.vel[i3] = Math.cos(a) * s * spread; this.vel[i3 + 1] = up * (0.5 + Math.random()); this.vel[i3 + 2] = Math.sin(a) * s * spread;
      c.set(colors ? colors[(Math.random() * colors.length) | 0] : color);
      this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
      this.s0[i] = size * (0.6 + Math.random() * 0.8); this.life[i] = life * (0.6 + Math.random() * 0.6); this.age[i] = 0; this.grav[i] = gravity;
    }
  }
  update(dt) {
    let w = 0;
    const drag = Math.pow(0.4, dt);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      if (w !== i) {
        for (let k = 0; k < 3; k++) { this.pos[w * 3 + k] = this.pos[i * 3 + k]; this.vel[w * 3 + k] = this.vel[i * 3 + k]; this.col[w * 3 + k] = this.col[i * 3 + k]; }
        this.age[w] = this.age[i]; this.life[w] = this.life[i]; this.grav[w] = this.grav[i]; this.s0[w] = this.s0[i];
      }
      this.vel[w * 3 + 1] -= this.grav[w] * dt;
      this.vel[w * 3] *= drag; this.vel[w * 3 + 2] *= drag;
      this.pos[w * 3] += this.vel[w * 3] * dt; this.pos[w * 3 + 1] += this.vel[w * 3 + 1] * dt; this.pos[w * 3 + 2] += this.vel[w * 3 + 2] * dt;
      const t = this.age[w] / this.life[w];
      this.size[w] = this.s0[w] * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * (1 - t * t);
      w++;
    }
    const was = this.n;
    this.n = w;
    if (!w && !was) return; // nothing alive: don't re-upload the buffers
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
  }
}

// ---------- clay props ----------
const MATS = {};
export function clayMat(key, opts) { return MATS[key] || (MATS[key] = makeClayMaterial({ seed: 1, ...opts })); }

function blobGeo(r, seed, wob = 0.18, detail = 3) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.7) * Math.sin(v.z * 3.3 + seed * 0.3);
    v.multiplyScalar(1 + n * wob);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// A puffy clay tree: trunk + stacked canopy blobs merged into one geometry per variant.
export function treeVariants() {
  const out = [];
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 10, 3); trunkGeo.translate(0, 1.1, 0);
  for (let v = 0; v < 3; v++) {
    const parts = [];
    const n = 3 + v;
    for (let k = 0; k < n; k++) {
      const g = blobGeo(0.9 + Math.random() * 0.5, v * 10 + k, 0.12, 3);
      g.translate((Math.random() - 0.5) * 1.3, 2.4 + k * 0.45 + Math.random() * 0.3, (Math.random() - 0.5) * 1.3);
      parts.push(g);
    }
    out.push({ trunk: trunkGeo, canopy: mergeGeos(parts) });
  }
  return out;
}

export function rockGeo(seed) { const g = blobGeo(1, seed, 0.3, 3); g.scale(1, 0.65, 1); return g; }

export function mergeGeos(geos) {
  let total = 0, itotal = 0;
  for (const g of geos) { total += g.attributes.position.count; itotal += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), idx = [];
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + o);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + o);
    o += g.attributes.position.count;
  }
  void itotal;
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setIndex(idx);
  return m;
}

// instanced scatter helper
export function scatter(scene, geo, mat, list, { shadow = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  list.forEach((it, i) => {
    p.set(it.x, it.y, it.z); e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
    s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
    m.compose(p, q, s); im.setMatrixAt(i, m);
  });
  im.count = list.length;
  im.castShadow = shadow; im.receiveShadow = true;
  scene.add(im);
  return im;
}
