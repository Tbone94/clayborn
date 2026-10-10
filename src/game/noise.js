// Tiny 2D gradient noise + fbm for terrain.
const P = new Uint8Array(512);
(() => { const p = [...Array(256).keys()]; let s = 1337; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; })();
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
  const g = (i, j, dx, dy) => { const h = G[P[P[(X + i) & 255] + ((Y + j) & 255)] & 7]; return h[0] * dx + h[1] * dy; };
  const u = fade(xf), v = fade(yf);
  const a = g(0, 0, xf, yf), b = g(1, 0, xf - 1, yf), c = g(0, 1, xf, yf - 1), d = g(1, 1, xf - 1, yf - 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v; // ~[-1,1]
}
export function fbm2(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
export const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
