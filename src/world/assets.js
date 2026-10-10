// Loads the "serious" world assets once: HDRI sky, PBR textures, scanned models.
// The joke: the world is photoreal-ish, the monsters are still lumpy clay doodles.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { QUALITY as Q } from '../fx/quality.js';

const BASE = import.meta.env.BASE_URL + 'assets/';
export const A = { tex: {}, models: {}, sky: null, sunDir: new THREE.Vector3(0.5, 0.7, 0.3).normalize(), horizon: new THREE.Color('#cfe3f2') };

const TEX = ['coast_sand_01', 'rock_face_03', 'forrest_ground_01', 'rocky_trail', 'bark_brown_02', 'wood_planks', 'rustic_stone_wall_02', 'stone_tiles_02', 'aerial_grass_rock'];

export async function loadAssets(renderer, onProgress = () => {}) {
  const tl = new THREE.TextureLoader();
  const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/');
  const gl = new GLTFLoader().setDRACOLoader(draco);
  const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
  const jobs = [];
  let done = 0;
  const track = (p) => p.then((v) => { done++; onProgress(done / jobs.length); return v; });

  const tex = (url, srgb) => track(tl.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    shrink(t);
    return t;
  }));
  for (const id of TEX) {
    jobs.push(tex(`${BASE}tex/${id}_diff.jpg`, true).then((t) => { (A.tex[id] ||= {}).map = t; }));
    // phones skip the PBR normal maps entirely (9 fewer ~1 MB downloads, far less GPU memory)
    if (Q.normalMaps) jobs.push(tex(`${BASE}tex/${id}_nor.jpg`, false).then((t) => { (A.tex[id] ||= {}).normal = t; }));
    else (A.tex[id] ||= {}).normal = null;
  }
  jobs.push(tex(`${BASE}tex/waternormals.jpg`, false).then((t) => { A.tex.water = t; }));
  jobs.push(tex(`${BASE}eztree/grass.jpg`, true).then((t) => { A.tex.lawn = t; }));
  const glb = (key, url) => jobs.push(track(gl.loadAsync(url)).then((g) => { A.models[key] = g.scene; }));
  glb('grass', `${BASE}eztree/grass.glb`);
  for (const c of ['white', 'blue', 'yellow']) glb('flower_' + c, `${BASE}eztree/flower_${c}.glb`);
  for (const i of [1, 2, 3]) glb('rock' + i, `${BASE}eztree/rock${i}.glb`);
  glb('fern', `${BASE}models/fern_02/fern_02.gltf`);
  jobs.push(track(new HDRLoader().loadAsync(`${BASE}sky.hdr`)).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    A.sky = t;
    findSun(t);
  }));
  await Promise.all(jobs);
  const pmrem = new THREE.PMREMGenerator(renderer);
  A.env = pmrem.fromEquirectangular(A.sky).texture;
  return A;
}

// Low tier: downscale big textures on the CPU before upload (a 1024² RGBA texture with
// mips is ~5.6 MB of GPU memory; 512² is a quarter of that and samples faster on phones).
function shrink(t) {
  const img = t.image, S = Q.texSize;
  if (!S || !img || !(img.width > S)) return;
  try {
    const c = document.createElement('canvas');
    c.width = S; c.height = Math.max(1, Math.round(img.height * S / img.width));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    t.image = c; t.needsUpdate = true;
  } catch { /* keep the full-size image */ }
}

// The brightest pixel in the HDRI is the sun: aim the shadow-casting light there.
function findSun(t) {
  const { data, width, height } = t.image;
  const step = data.length / (width * height);
  let best = -1, bi = 0, hr = 0, hg = 0, hb = 0, hn = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * step], g = data[i * step + 1], b = data[i * step + 2];
    const v = typeof r === 'number' && data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(r) + THREE.DataUtils.fromHalfFloat(g) + THREE.DataUtils.fromHalfFloat(b) : r + g + b;
    if (v > best) { best = v; bi = i; }
    const y = Math.floor(i / width);
    if (Math.abs(y - height * 0.48) < 2 && (i % 7 === 0)) {
      const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (x) => x;
      hr += f(r); hg += f(g); hb += f(b); hn++;
    }
  }
  const x = bi % width, y = Math.floor(bi / width);
  const u = x / width, v = y / height;
  // three's equirectUv: u = atan(z, x)/2π + 0.5, v = asin(y)/π + 0.5 (image rows are flipped)
  const phi = (u - 0.5) * Math.PI * 2, theta = (0.5 - v) * Math.PI;
  A.sunDir.set(Math.cos(phi) * Math.cos(theta), Math.sin(theta), Math.sin(phi) * Math.cos(theta)).normalize();
  if (A.sunDir.y < 0.25) A.sunDir.y = 0.25; // keep shadows readable
  A.sunDir.normalize();
  if (hn) { const m = Math.max(hr, hg, hb) / hn || 1; A.horizon.setRGB(hr / hn / m * 0.85, hg / hn / m * 0.85, hb / hn / m * 0.85); }
}
