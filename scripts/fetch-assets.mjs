// Downloads the CC0 / MIT assets the polished world uses into public/assets.
// Poly Haven (CC0): HDRI sky, PBR ground/stone/wood textures, fern model.
// ez-tree demo assets (MIT, Daniel Greenheck): grass clumps, flowers, scanned rocks, dirt.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = 'public/assets';
const PH_TEX = ['coast_sand_01', 'rock_face_03', 'forrest_ground_01', 'rocky_trail', 'bark_brown_02', 'wood_planks', 'rustic_stone_wall_02', 'stone_tiles_02', 'aerial_grass_rock'];
const PH_HDRI = 'kloofendal_48d_partly_cloudy_puresky';
const PH_MODELS = ['fern_02'];

async function get(url, dest) {
  try { await fs.access(dest); return; } catch { /* download */ }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log('  ✓', dest);
}
const files = async (id) => (await fetch(`https://api.polyhaven.com/files/${id}`)).json();

await fs.mkdir(OUT, { recursive: true });
console.log('HDRI'); {
  const f = await files(PH_HDRI);
  await get(f.hdri['2k'].hdr.url, `${OUT}/sky.hdr`);
}
console.log('Textures');
for (const id of PH_TEX) {
  const f = await files(id);
  await get(f.Diffuse['1k'].jpg.url, `${OUT}/tex/${id}_diff.jpg`);
  await get(f.nor_gl['1k'].jpg.url, `${OUT}/tex/${id}_nor.jpg`);
}
console.log('Models');
for (const id of PH_MODELS) {
  const f = await files(id);
  const g = f.gltf['1k'].gltf;
  await get(g.url, `${OUT}/models/${id}/${id}.gltf`);
  for (const [rel, inc] of Object.entries(g.include || {})) await get(inc.url, `${OUT}/models/${id}/${rel}`);
}
console.log('ez-tree demo assets');
const EZ = 'node_modules/@dgreenheck/ez-tree/src/app/public';
for (const n of ['grass.glb', 'flower_white.glb', 'flower_blue.glb', 'flower_yellow.glb', 'rock1.glb', 'rock2.glb', 'rock3.glb', 'dirt_color.jpg', 'dirt_normal.jpg', 'grass.jpg']) {
  await fs.mkdir(`${OUT}/eztree`, { recursive: true });
  await fs.copyFile(`${EZ}/${n}`, `${OUT}/eztree/${n}`);
}
await fs.cp('node_modules/three/examples/jsm/libs/draco/gltf', 'public/draco', { recursive: true });
await get('https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/textures/waternormals.jpg', `${OUT}/tex/waternormals.jpg`);
console.log('done');
