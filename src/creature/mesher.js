// Naive Surface Nets: one vertex per sign-changing voxel, quads across sign-changing edges.
// Produces smooth, well-shaped meshes that skin nicely — ideal for the clay look.

const CUBE_EDGES = (() => {
  const e = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
    const k = i ^ (1 << j);
    if (i < k) e.push(i, k);
  }
  return e; // 12 edges as corner index pairs
})();

export function polygonize(field, nx, ny, nz, origin, step) {
  const idx = (x, y, z) => x + nx * (y + ny * z);
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);

  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[idx(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1))];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (let e = 0; e < 24; e += 2) {
      const a = CUBE_EDGES[e], b = CUBE_EDGES[e + 1];
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      px += (a & 1) + t * ((b & 1) - (a & 1));
      py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
      pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
      n++;
    }
    cellVert[x + cx * (y + cy * z)] = pos.length / 3;
    pos.push(origin[0] + (x + px / n) * step, origin[1] + (y + py / n) * step, origin[2] + (z + pz / n) * step);
  }

  const cell = (x, y, z) => cellVert[x + cx * (y + cy * z)];
  const tris = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along the shorter diagonal
    const dac = dist2(pos, a, c), dbd = dist2(pos, b, d);
    if (dac < dbd) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };

  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const v0 = field[idx(x, y, z)] < 0;
    // edge along +x
    if (x < cx && y > 0 && z > 0 && y < ny - 1 && z < nz - 1) {
      const v1 = field[idx(x + 1, y, z)] < 0;
      if (v0 !== v1) quad(cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z), !v0);
    }
    // edge along +y
    if (y < cy && x > 0 && z > 0 && x < nx - 1 && z < nz - 1) {
      const v1 = field[idx(x, y + 1, z)] < 0;
      if (v0 !== v1) quad(cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1), !v0);
    }
    // edge along +z
    if (z < cz && x > 0 && y > 0 && x < nx - 1 && y < ny - 1) {
      const v1 = field[idx(x, y, z + 1)] < 0;
      if (v0 !== v1) quad(cell(x - 1, y - 1, z), cell(x, y - 1, z), cell(x, y, z), cell(x - 1, y, z), !v0);
    }
  }
  return { positions: new Float32Array(pos), indices: tris };
}

function dist2(p, a, b) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// Taubin smoothing (shrink-free) for that soft, hand-pressed clay surface.
export function taubin(positions, indices, iterations = 2, lambda = 0.5, mu = -0.53) {
  const n = positions.length / 3;
  const nbStart = new Int32Array(n + 1);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    nbStart[a] += 2; nbStart[b] += 2; nbStart[c] += 2;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) { const t = nbStart[i]; nbStart[i] = acc; acc += t; }
  nbStart[n] = acc;
  const fill = nbStart.slice(0, n);
  const nb = new Int32Array(acc);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    nb[fill[a]++] = b; nb[fill[a]++] = c;
    nb[fill[b]++] = a; nb[fill[b]++] = c;
    nb[fill[c]++] = a; nb[fill[c]++] = b;
  }
  const tmp = new Float32Array(positions.length);
  const pass = (f) => {
    for (let i = 0; i < n; i++) {
      const s = nbStart[i], e = nbStart[i + 1];
      if (e === s) { tmp[i * 3] = positions[i * 3]; tmp[i * 3 + 1] = positions[i * 3 + 1]; tmp[i * 3 + 2] = positions[i * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let k = s; k < e; k++) { const j = nb[k]; x += positions[j * 3]; y += positions[j * 3 + 1]; z += positions[j * 3 + 2]; }
      const inv = 1 / (e - s);
      tmp[i * 3] = positions[i * 3] + f * (x * inv - positions[i * 3]);
      tmp[i * 3 + 1] = positions[i * 3 + 1] + f * (y * inv - positions[i * 3 + 1]);
      tmp[i * 3 + 2] = positions[i * 3 + 2] + f * (z * inv - positions[i * 3 + 2]);
    }
    positions.set(tmp);
  };
  for (let it = 0; it < iterations; it++) { pass(lambda); pass(mu); }
  return positions;
}
