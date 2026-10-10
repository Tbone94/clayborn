// The "AAA" layer: HDRI lighting, PBR splat terrain, wind grass, real-ish water,
// procedural trees (ez-tree), scanned rocks and plants. Creatures stay janky clay.
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { A } from './assets.js';
import { NOISE_GLSL, GLOOM } from '../fx/clay.js';

export const WORLD_TIME = { value: 0 };
export const PUSH = { value: new THREE.Vector4(0, 0, 0, 0) }; // player x, z, radius, strength

const GLOOM_GLSL = /* glsl */`
uniform vec4 uZones[4];
float gloomAt(vec3 w){ float g = 0.0; for(int i=0;i<4;i++){ vec4 z = uZones[i]; if(z.z <= 0.0) continue;
  float d = length(w.xz - z.xy); g = max(g, z.w * (1.0 - smoothstep(z.z*0.55, z.z, d + (vnoise(w*0.35)-0.5)*3.0))); } return g; }
`;

// ---------------- sky, sun, fog ----------------
export function setupWorld(scene, { fog = [70, 260], sunIntensity = 3.2, shadowSize = 26 } = {}) {
  scene.background = A.sky;
  scene.backgroundIntensity = 1.0;
  scene.environment = A.env; scene.environmentIntensity = 0.85;
  scene.fog = new THREE.Fog(A.horizon.clone(), fog[0], fog[1]);
  const hemi = new THREE.HemisphereLight('#dfefff', '#5a6a3a', 0.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', sunIntensity);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 200 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2.5;
  scene.add(sun); scene.add(sun.target);
  const off = A.sunDir.clone().multiplyScalar(70);
  return {
    hemi, sun,
    follow(p) {
      // snap to shadow texels to stop shimmering
      const s = (shadowSize * 2) / 4096;
      const x = Math.round(p.x / s) * s, z = Math.round(p.z / s) * s;
      sun.position.set(x + off.x, p.y + off.y, z + off.z); sun.target.position.set(x, p.y, z);
    },
  };
}

// ---------------- PBR splat terrain ----------------
// splat attribute: x = lawn, y = dirt/path, z = sand, w = rock (cliffs use triplanar)
export function terrainMaterial({ gloom = false, path = 'rocky_trail' } = {}) {
  const t = A.tex;
  const uniforms = {
    tLawn: { value: A.tex.lawn }, tLawn2: { value: t.aerial_grass_rock.map }, tLawnN: { value: t.aerial_grass_rock.normal },
    tDirt: { value: t[path].map }, tDirtN: { value: t[path].normal },
    tSand: { value: t.coast_sand_01.map }, tSandN: { value: t.coast_sand_01.normal },
    tRock: { value: t.rock_face_03.map }, tRockN: { value: t.rock_face_03.normal },
    tGround: { value: t.forrest_ground_01.map },
    uZones: GLOOM,
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  mat.defines = { ...(mat.defines || {}), ...(gloom ? { USE_GLOOM: '' } : {}) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tLawn, tLawn2, tLawnN, tDirt, tDirtN, tSand, tSandN, tRock, tRockN, tGround;
        varying vec4 vSplat; varying vec3 vWP; varying vec3 vWN;
        ${NOISE_GLSL}
        ${gloom ? GLOOM_GLSL : ''}
        vec3 tri(sampler2D t, vec3 p, vec3 w){ return texture2D(t, p.zy).rgb*w.x + texture2D(t, p.xz).rgb*w.y + texture2D(t, p.xy).rgb*w.z; }
        vec3 triN(sampler2D t, vec3 p, vec3 n, vec3 w){
          vec3 tx = texture2D(t, p.zy).xyz*2.0-1.0, ty = texture2D(t, p.xz).xyz*2.0-1.0, tz = texture2D(t, p.xy).xyz*2.0-1.0;
          tx = vec3(tx.xy + n.zy, n.x); ty = vec3(ty.xy + n.xz, n.y); tz = vec3(tz.xy + n.xy, n.z);
          return normalize(tx.zyx*w.x + ty.xzy*w.y + tz.xyz*w.z);
        }
        vec3 planN(sampler2D t, vec2 uv, vec3 n, float s){ vec3 tn = texture2D(t, uv).xyz*2.0-1.0; return normalize(vec3(tn.x*s + n.x, n.y, tn.y*s + n.z)); }`)
      .replace('#include <map_fragment>', `
        vec4 sp = vSplat / max(0.0001, dot(vSplat, vec4(1.0)));
        vec3 wn = normalize(vWN);
        float macro = vnoise(vWP*0.035);           // breaks up tiling at a distance
        float macro2 = vnoise(vWP*0.11 + 7.0);
        vec2 uvA = vWP.xz*0.16, uvB = vWP.xz*0.043 + 0.37;
        vec3 lawn = mix(texture2D(tLawn, uvA*1.3).rgb, texture2D(tLawn, uvB).rgb, 0.4);
        lawn = mix(lawn, texture2D(tLawn2, uvA).rgb * vec3(0.8, 0.95, 0.65), smoothstep(0.45, 0.75, macro) * 0.55);
        lawn = mix(lawn, texture2D(tGround, vWP.xz*0.12).rgb, smoothstep(0.6, 0.85, macro2) * 0.45);
        lawn *= mix(vec3(0.78, 0.92, 0.62), vec3(1.0, 1.05, 0.8), macro2);
        vec3 dirt = texture2D(tDirt, vWP.xz*0.2).rgb;
        vec3 sand = mix(texture2D(tSand, vWP.xz*0.2).rgb, texture2D(tSand, vWP.xz*0.055).rgb, 0.4);
        vec3 tw = pow(abs(wn), vec3(5.0)); tw /= (tw.x+tw.y+tw.z);
        vec3 rock = tri(tRock, vWP*0.11, tw) * vec3(0.95, 0.9, 0.86);
        vec3 col = lawn*sp.x + dirt*sp.y + sand*sp.z + rock*sp.w;
        diffuseColor.rgb *= col;
        ${gloom ? `float gl = gloomAt(vWP); float lum = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum)*vec3(0.38,0.3,0.5)*0.75, gl);` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nLawn = planN(tLawnN, uvA, wn, 1.0), nDirt = planN(tDirtN, vWP.xz*0.2, wn, 1.2), nSand = planN(tSandN, vWP.xz*0.2, wn, 0.8);
          vec3 nRock = triN(tRockN, vWP*0.11, wn, tw);
          vec3 wN = normalize(nLawn*sp.x + nDirt*sp.y + nSand*sp.z + nRock*sp.w);
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 0.95 - sp.w*0.12 - sp.z*0.05;');
  };
  mat.customProgramCacheKey = () => 'terrain-v1' + (gloom ? 'g' : '') + path;
  return mat;
}

// heightfield mesh + splat weights from a height function and a "paint" function
export function terrainMesh(heightFn, { size, seg, center = [0, 0], splatFn, material }) {
  const g = new THREE.PlaneGeometry(size[0], size[1], seg[0], seg[1]); g.rotateX(-Math.PI / 2);
  g.translate(center[0], 0, center[1]);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightFn(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const n = g.attributes.normal, sp = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) sp.set(splatFn(p.getX(i), p.getY(i), p.getZ(i), n.getY(i)), i * 4);
  g.setAttribute('splat', new THREE.BufferAttribute(sp, 4));
  const m = new THREE.Mesh(g, material); m.receiveShadow = true;
  return m;
}

// textured PBR material from a Poly Haven set
const pbrCache = {};
export function pbr(id, rx = 1, ry = 1, extra = {}) {
  const k = id + rx + ry + JSON.stringify(extra);
  if (pbrCache[k]) return pbrCache[k];
  const t = A.tex[id];
  const map = t.map.clone(), normalMap = t.normal.clone();
  for (const x of [map, normalMap]) { x.repeat.set(rx, ry); x.needsUpdate = true; }
  return (pbrCache[k] = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.9, ...extra }));
}

// ---------------- wind (shared by grass, flowers, ferns) ----------------
function addWind(mat, { strength = 0.25, bendHeight = 0.6, gloom = false, root = 0.0 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.uTimeW = WORLD_TIME; sh.uniforms.uPush = PUSH;
    if (gloom) sh.uniforms.uZones = GLOOM;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTimeW; uniform vec4 uPush; varying float vH; varying vec3 vGW;
        ${NOISE_GLSL}
        ${gloom ? GLOOM_GLSL : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 base = vec3(0.0);
          #ifdef USE_INSTANCING
          base = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          #else
          base = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          #endif
          float h = clamp(position.y / ${bendHeight.toFixed(3)}, 0.0, 1.5);
          vH = clamp(position.y / ${bendHeight.toFixed(3)} + ${root.toFixed(3)}, 0.0, 1.0);
          vGW = base;
          ${gloom ? 'float gl = gloomAt(base); transformed.y *= 1.0 - gl*0.65;' : ''}
          float gust = vnoise(vec3(base.xz*0.06 - uTimeW*0.35, uTimeW*0.1));
          float w = sin(uTimeW*2.1 + base.x*0.35 + base.z*0.27) * 0.5 + gust*1.2;
          transformed.x += w * ${strength.toFixed(3)} * h*h;
          transformed.z += sin(uTimeW*1.7 + base.z*0.4) * ${(strength * 0.6).toFixed(3)} * h*h;
          // part around the player
          vec2 d = base.xz - uPush.xy; float dl = length(d);
          float push = (1.0 - smoothstep(0.0, uPush.z, dl)) * uPush.w;
          #ifdef USE_INSTANCING
          vec2 dirL = (inverse(mat3(instanceMatrix)) * vec3(d.x, 0.0, d.y)).xz;
          #else
          vec2 dirL = d;
          #endif
          transformed.xz += normalize(dirL + 1e-4) * push * h * 0.6;
          transformed.y -= push * h * 0.25;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vH; varying vec3 vGW;
        ${gloom ? NOISE_GLSL + GLOOM_GLSL : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.42, 1.0, vH);   // fake AO toward the roots
        ${gloom ? 'float glf = gloomAt(vGW); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16,0.1,0.22), glf*0.85);' : ''}`);
  };
  mat.customProgramCacheKey = () => 'wind' + strength + bendHeight + (gloom ? 'g' : '');
  return mat;
}

// ---------------- instancing helpers ----------------
// Bake a (multi-mesh) model into InstancedMeshes sharing one list of transforms.
export function instanceModel(scene, root, list, { wind = null, castShadow = true, chunk = 0, tint = null, cloneMat = true } = {}) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const m = cloneMat ? o.material.clone() : o.material;
    if (wind) addWind(m, wind);
    if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    parts.push({ g, m });
  });
  const groups = chunk ? chunkList(list, chunk) : [list];
  const out = [];
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  for (const L of groups) {
    for (const { g, m } of parts) {
      const im = new THREE.InstancedMesh(g, m, L.length);
      L.forEach((it, i) => {
        p.set(it.x, it.y, it.z); e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
        s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
        M.compose(p, q, s); im.setMatrixAt(i, M);
        if (tint) { tint(c, it); im.setColorAt(i, c); }
      });
      im.castShadow = castShadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im); out.push(im);
    }
  }
  return out;
}

function chunkList(list, size) {
  const map = new Map();
  for (const it of list) {
    const k = Math.floor(it.x / size) + ',' + Math.floor(it.z / size);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.values()];
}

// Grass: ez-tree clump cards, thousands of them, chunked so off-screen tiles cull.
export function plantGrass(scene, spots, { gloom = false } = {}) {
  const src = A.models.grass.clone(true);
  src.traverse((o) => {
    if (o.isMesh) {
      const map = o.material.map;
      o.material = new THREE.MeshStandardMaterial({ map, alphaTest: 0.3, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85, color: new THREE.Color(0.75, 0.82, 0.62) });
    }
  });
  return instanceModel(scene, src, spots, {
    wind: { strength: 0.18, bendHeight: grassHeight(), gloom }, castShadow: false, chunk: 14,
    tint: (c, it) => c.setHSL(0.21 + it.hue * 0.07, 0.5 + it.hue * 0.2, 0.36 + it.lum * 0.2),
  });
}

let _gh = null;
export function grassHeight() {
  if (_gh) return _gh;
  const b = new THREE.Box3().setFromObject(A.models.grass);
  return (_gh = Math.max(0.05, b.max.y - b.min.y));
}
export function modelSize(key) { const b = new THREE.Box3().setFromObject(A.models[key]); return b.getSize(new THREE.Vector3()); }

export function plantFlowers(scene, spots) {
  const out = [];
  ['white', 'blue', 'yellow'].forEach((c, i) => {
    const L = spots.filter((_, k) => k % 3 === i);
    if (!L.length) return;
    const src = A.models['flower_' + c].clone(true);
    src.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, color: o.material.color, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }); });
    out.push(...instanceModel(scene, src, L, { wind: { strength: 0.12, bendHeight: modelSize('flower_' + c).y }, castShadow: false, chunk: 20 }));
  });
  return out;
}

export function plantFerns(scene, spots) {
  const src = A.models.fern.clone(true);
  src.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.alphaTest = 0.5; o.material.side = THREE.DoubleSide; } });
  return instanceModel(scene, src, spots, { wind: { strength: 0.08, bendHeight: modelSize('fern').y } });
}

export function placeRocks(scene, spots) {
  const out = [];
  [1, 2, 3].forEach((n, i) => {
    const L = spots.filter((_, k) => k % 3 === i);
    if (L.length) out.push(...instanceModel(scene, A.models['rock' + n].clone(true), L));
  });
  return out;
}

// ---------------- trees ----------------
const TREE_PRESETS = ['Oak Medium', 'Ash Medium', 'Aspen Medium', 'Oak Small', 'Bush 1', 'Bush 2'];
const treeCache = {};
export function treeVariant(preset, seed) {
  const key = preset + seed;
  if (treeCache[key]) return treeCache[key];
  const t = new Tree();
  t.loadPreset(preset);
  t.options.seed = seed;
  t.generate();
  // ez-tree's leaf shader replaces project_vertex and ignores instanceMatrix, so every
  // instanced tree's leaves would pile up at the origin. Swap in an instancing-aware leaf material.
  const b = new THREE.Box3().setFromObject(t);
  const old = t.leavesMesh.material;
  const lm = new THREE.MeshStandardMaterial({ map: old.map, color: old.color, side: THREE.DoubleSide, alphaTest: 0.25, alphaToCoverage: true, roughness: 0.75 });
  addWind(lm, { strength: 0.9, bendHeight: b.max.y - b.min.y, root: 0.55 });
  t.leavesMesh.material = lm;
  return (treeCache[key] = { tree: t, height: b.max.y - b.min.y });
}

// list: {x, y, z, h (target height), ry, kind}
export function plantTrees(scene, list) {
  const out = [];
  const byKind = {};
  for (const it of list) (byKind[it.kind ?? 0] ||= []).push(it);
  for (const [k, L] of Object.entries(byKind)) {
    const v = treeVariant(TREE_PRESETS[k % TREE_PRESETS.length], 1000 + +k * 77);
    const scaled = L.map((it) => ({ ...it, s: (it.h || 8) / v.height }));
    out.push(...instanceModel(scene, v.tree, scaled, { cloneMat: false }));
    out.variants = (out.variants || []).concat(v);
  }
  return out;
}
export function updateTrees() { /* leaves sway via WORLD_TIME in the shared wind shader */ }
export { TREE_PRESETS };

// ---------------- water ----------------
export function makeWater(scene, { size = 600, level = 0, hTex, hBox, deep = '#0b3a55', shallow = '#1f7d7a' }) {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: deep, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.0, transparent: true });
  const uniforms = {
    uTime: WORLD_TIME, uH: { value: hTex }, uHBox: { value: new THREE.Vector4(...hBox) }, uN: { value: A.tex.water },
    uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) }, uLevel: { value: level },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform sampler2D uH, uN; uniform vec4 uHBox; uniform vec3 uDeep, uShallow; uniform float uLevel; varying vec3 vW;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 huv = (vW.xz - uHBox.xy) / uHBox.zw;
        float gh = (huv.x>0.0 && huv.y>0.0 && huv.x<1.0 && huv.y<1.0) ? texture2D(uH, huv).r : -30.0;
        float depth = uLevel - gh;
        float sh = 1.0 - smoothstep(0.0, 4.5, depth);
        vec3 col = mix(uDeep, uShallow, sh*sh);
        float clarity = smoothstep(0.0, 3.0, depth);   // shallows are see-through
        float fn = vnoise(vec3(vW.xz*0.7, uTime*0.6));
        float foam = smoothstep(0.45, 0.05, depth + fn*0.35 - 0.05 + sin(uTime*1.4 + depth*5.0)*0.06);
        foam += smoothstep(0.06, 0.0, abs(depth - 0.7 - sin(uTime*0.8)*0.25 - fn*0.3)) * 0.45 * sh;
        col = mix(col, vec3(0.95), clamp(foam, 0.0, 1.0)*0.85);
        diffuseColor.rgb = col;
        diffuseColor.a = clamp(mix(0.35, 0.97, clarity) + foam*0.6, 0.0, 1.0);
        float waterFoam = foam;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 uv1 = vW.xz*0.045 + vec2(uTime*0.012, uTime*0.008);
          vec2 uv2 = vW.xz*0.11 - vec2(uTime*0.018, -uTime*0.011);
          vec3 n1 = texture2D(uN, uv1).xyz*2.0-1.0, n2 = texture2D(uN, uv2).xyz*2.0-1.0;
          vec3 wn = normalize(vec3(n1.x + n2.x, 3.2, n1.y + n2.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.06, 0.9, waterFoam);');
  };
  mat.customProgramCacheKey = () => 'water-v3';
  const m = new THREE.Mesh(geo, mat); m.position.y = level; m.receiveShadow = true;
  scene.add(m);
  return { mesh: m, update() {} };
}
