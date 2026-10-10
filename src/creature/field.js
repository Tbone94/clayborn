// 2D drawing → inflatable shape field.
// Each body part is a mask in the side-view plane. We turn it into:
//   s(x,y): signed 2D distance to the outline (negative inside)
//   h(x,y): inflation half-depth, from a Poisson solve (ΔH = -2, H=0 on the edge).
//           sqrt(H) gives a perfectly round cross-section for strips — the same
//           trick Teddy / Monster Mash use to make "wide parts fat, thin parts thin".

export const GRID = 128;                 // field resolution per part
export const X0 = -1, X1 = 1, Y0 = 0, Y1 = 2; // side-view world window
export const CELL = (X1 - X0) / GRID;

const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// squared euclidean distance to nearest "feature" cell (grid value 0)
function edt(grid, n) {
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = grid[y * n + x];
    edt1d(f, n, d, v, z);
    for (let y = 0; y < n; y++) grid[y * n + x] = d[y];
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = grid[y * n + x];
    edt1d(f, n, d, v, z);
    for (let x = 0; x < n; x++) grid[y * n + x] = d[x];
  }
  return grid;
}

function signedDistance(inside, n) {
  const a = new Float64Array(n * n), b = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) { a[i] = inside[i] ? 0 : INF; b[i] = inside[i] ? INF : 0; }
  edt(a, n); edt(b, n);
  const s = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    s[i] = inside[i] ? -(Math.sqrt(b[i]) - 0.5) * CELL : (Math.sqrt(a[i]) - 0.5) * CELL;
  }
  return s;
}

// Multi-resolution SOR Poisson solve: ΔH = -2 inside, H = 0 outside.
function poisson(inside, n) {
  const levels = [];
  let m = inside, size = n;
  levels.push({ m, size });
  while (size > 32) {
    const ns = size >> 1, nm = new Uint8Array(ns * ns);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      const c = m[(2 * y) * size + 2 * x] + m[(2 * y) * size + 2 * x + 1] + m[(2 * y + 1) * size + 2 * x] + m[(2 * y + 1) * size + 2 * x + 1];
      nm[y * ns + x] = c >= 2 ? 1 : 0;
    }
    m = nm; size = ns; levels.unshift({ m, size });
  }
  let H = null, prevSize = 0;
  for (let li = 0; li < levels.length; li++) {
    const { m, size } = levels[li];
    const h = (X1 - X0) / size, rhs = 2 * h * h;
    const cur = new Float32Array(size * size);
    if (H) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (m[y * size + x]) cur[y * size + x] = H[(y >> 1) * prevSize + (x >> 1)];
      }
    }
    const iters = li === 0 ? 220 : 70;
    const w = 1.85;
    for (let it = 0; it < iters; it++) {
      for (let y = 1; y < size - 1; y++) {
        let i = y * size + 1;
        for (let x = 1; x < size - 1; x++, i++) {
          if (!m[i]) continue;
          const nv = (cur[i - 1] + cur[i + 1] + cur[i - size] + cur[i + size] + rhs) * 0.25;
          cur[i] += w * (nv - cur[i]);
        }
      }
    }
    H = cur; prevSize = size;
  }
  return H;
}

// Build a part field from a coverage array (0..1, row 0 = bottom / y0).
export function buildPartField(coverage) {
  const n = GRID;
  const inside = new Uint8Array(n * n);
  let count = 0, sx = 0, sy = 0;
  let gx0 = n, gx1 = -1, gy0 = n, gy1 = -1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    // keep the outer ring empty so the solve has a boundary
    if (coverage[i] > 0.5 && x > 0 && y > 0 && x < n - 1 && y < n - 1) {
      inside[i] = 1; count++; sx += x; sy += y;
      if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
    }
  }
  if (count < 6) return { empty: true };
  const s = signedDistance(inside, n);
  const H = poisson(inside, n);
  const h = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) h[i] = inside[i] ? Math.sqrt(Math.max(H[i], 0)) : 0;
  return {
    empty: false, inside, s, h, count,
    area: count * CELL * CELL,
    centroid: [X0 + (sx / count + 0.5) * CELL, Y0 + (sy / count + 0.5) * CELL],
    bbox: [X0 + gx0 * CELL, Y0 + gy0 * CELL, X0 + (gx1 + 1) * CELL, Y0 + (gy1 + 1) * CELL],
  };
}

// bilinear sample; returns fallback outside the grid
export function sample(arr, x, y, fallback) {
  const fx = (x - X0) / CELL - 0.5, fy = (y - Y0) / CELL - 0.5;
  if (fx < 0 || fy < 0 || fx >= GRID - 1 || fy >= GRID - 1) return fallback;
  const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
  const i = iy * GRID + ix;
  const a = arr[i], b = arr[i + 1], c = arr[i + GRID], d = arr[i + GRID + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function sampleS(f, x, y) {
  const v = sample(f.s, x, y, NaN);
  if (v !== v) { // outside grid: distance to bbox, roughly
    const bx = Math.max(f.bbox[0] - x, 0, x - f.bbox[2]), by = Math.max(f.bbox[1] - y, 0, y - f.bbox[3]);
    return Math.hypot(bx, by) + CELL;
  }
  return v;
}

// coverage → grid helpers
export function insideAt(f, x, y) {
  const gx = Math.floor((x - X0) / CELL), gy = Math.floor((y - Y0) / CELL);
  if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return false;
  return !!f.inside[gy * GRID + gx];
}

export function cellCenter(i) {
  return [X0 + ((i % GRID) + 0.5) * CELL, Y0 + (Math.floor(i / GRID) + 0.5) * CELL];
}
