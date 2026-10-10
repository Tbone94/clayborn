// Graphics quality tier, picked once at startup.
//   high   → desktop / anything with a mouse: the full look, unchanged.
//   medium → big, strong touch devices (recent iPads / flagship tablets).
//   low    → phones and weaker touch devices: same style, far fewer pixels and samples.
// Override: ?q=low|medium|high in the URL (sticky: saved to localStorage),
// or localStorage 'clayborn-quality'. ?q=auto clears the override.
const KEY = 'clayborn-quality';
const TIERS = ['low', 'medium', 'high'];

const PRESETS = {
  high: {
    dpr: 1.75, maxDpr: 1.75, minDpr: 0.75,  // device-pixel-ratio start / cap / adaptive floor
    adaptEvery: 2, slowFps: 45, fastFps: 58, // adaptive-resolution window (s) and thresholds
    msaa: 4, bloom: true, tonemapInPost: false, blurTaps: 24,
    shadowMap: 4096, propShadows: true,      // rocks, ferns, goo cast shadows
    grass: 1, grassScale: 1, grassDist: 0,   // density, clump scale, cull distance (0 = never)
    flowers: 1, ferns: 1,
    treeDetail: 1,                            // ez-tree branch sections multiplier (<1 also: single leaf cards)
    terrainSeg: 1,                            // terrain grid resolution multiplier
    gooSeg: [40, 24], gooPhysical: true,
    terrainNormals: true, normalMaps: true, texSize: 0, aniso: 8,
    waterCheap: false, clayCheap: false, jelly: true,
    particles: 1500,
  },
  medium: {
    dpr: 1.25, maxDpr: 1.5, minDpr: 0.7,
    adaptEvery: 1.5, slowFps: 42, fastFps: 57,
    msaa: 2, bloom: false, tonemapInPost: true, blurTaps: 16,
    shadowMap: 2048, propShadows: true,
    grass: 0.6, grassScale: 1.12, grassDist: 90,
    flowers: 0.8, ferns: 0.8,
    treeDetail: 1, terrainSeg: 1,
    gooSeg: [28, 16], gooPhysical: true,
    terrainNormals: true, normalMaps: true, texSize: 1024, aniso: 4,
    waterCheap: false, clayCheap: false, jelly: true,
    particles: 1200,
  },
  low: {
    dpr: 1.0, maxDpr: 1.25, minDpr: 0.6,
    adaptEvery: 1, slowFps: 40, fastFps: 57,
    msaa: 0, bloom: false, tonemapInPost: true, blurTaps: 10,
    shadowMap: 1024, propShadows: false,
    grass: 0.38, grassScale: 1.25, grassDist: 60,
    flowers: 0.6, ferns: 0.5,
    treeDetail: 0.55, terrainSeg: 0.7,
    gooSeg: [18, 10], gooPhysical: false,
    terrainNormals: false, normalMaps: false, texSize: 512, aniso: 2,
    waterCheap: true, clayCheap: true, jelly: false,
    particles: 700,
  },
};

function override() {
  try {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'auto') { localStorage.removeItem(KEY); return null; }
    if (TIERS.includes(q)) { try { localStorage.setItem(KEY, q); } catch { /* storage off */ } return q; }
  } catch { /* no location */ }
  try { const s = localStorage.getItem(KEY); if (TIERS.includes(s)) return s; } catch { /* storage off */ }
  return null;
}

function detect() {
  const mm = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
  const coarse = mm('(pointer: coarse)');
  const fine = mm('(any-pointer: fine)') && mm('(hover: hover)');
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|iPhone|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua) || navigator.userAgentData?.mobile === true;
  // iPadOS reports itself as a Mac; touch points give it away
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // a primary mouse = desktop/laptop (touch-screen laptops included) → full quality
  if (!coarse && !mobileUA && !iPad) return 'high';
  if (fine && !mobileUA && !iPad) return 'high';
  const short = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4; // Chrome only; Safari leaves it undefined
  const tablet = iPad || (short >= 700 && !/Mobile/i.test(ua));
  if (tablet && cores >= 6 && mem >= 4) return 'medium';
  return 'low';
}

const forced = override();
const tier = forced || detect();
export const QUALITY = { tier, forced: !!forced, ...PRESETS[tier] };
if (typeof window !== 'undefined') window.QUALITY = QUALITY;
