// Scores the prestige trailer (captures/cinema, from dev.cinema()) and encodes it.
// The music takes itself completely seriously: drone, string ostinato, a dead stop for
// "behold", a cricket, then BRAAAMs and taiko until the title, where it tape-stops into
// the game's kalimba theme.
//   node scripts/make-cinema.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const DIR = process.env.TRAILER_DIR || 'captures/cinema';
const OUT = process.env.TRAILER_OUT || 'clayborn-cinema-trailer.mp4';
const { fps, duration, cues } = JSON.parse(fs.readFileSync(`${DIR}/cues.json`, 'utf8'));
const at = (type, d) => cues.find((c) => c.type === type)?.t ?? d;
const T = {
  strings: at('strings', 12.2), silence: at('silence', 19.4), braam: at('braam', 22.5),
  critics: at('critics', 47.7), climax: at('climax', 52.5), toy: at('toy', 54.5), stinger: at('stinger', 58.7),
};
const SR = 44100, N = Math.ceil((duration + 0.8) * SR);
// two buses: music (hard-muted for the "behold." beat, reverb tail and all) and sfx
const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N), SL: new Float32Array(N), SR: new Float32Array(N) });
const MUS = bus(), FX = bus();
let B = MUS;
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4;

function put(i, l, r, send) { if (i < 0 || i >= N) return; B.L[i] += l; B.R[i] += r; if (send) { B.SL[i] += l * send; B.SR[i] += r * send; } }
function env(t, a, d) { return t < a ? t / a : Math.exp(-(t - a) / d); }
function osc(type, ph) {
  const x = ph - Math.floor(ph);
  if (type === 'sine') return Math.sin(ph * 2 * Math.PI);
  if (type === 'tri') return 1 - 4 * Math.abs(x - 0.5);
  if (type === 'saw') return 2 * x - 1;
  return x < 0.5 ? 1 : -1;
}
// a voice with time-varying pitch, amplitude and low-pass (all functions of local time)
function voice(t0, dur, { f, amp, type = 'saw', lp = null, pan = 0, send = 0.3 }) {
  const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR);
  let ph = rnd(), y = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += f(t) / SR;
    let v = osc(type, ph);
    if (lp) { const k = 1 - Math.exp(-2 * Math.PI * lp(t) / SR); y += (v - y) * k; y2 += (y - y2) * k; v = y2; }
    v *= amp(t);
    put(s0 + i, v * (1 - pan) * 0.7, v * (1 + pan) * 0.7, send);
  }
}
const tone = (t0, f0, dur, { type = 'sine', vol = 0.2, a = 0.004, d = 0.2, pan = 0, bend = 1, send = 0.15, lp = 0 } = {}) =>
  voice(t0, dur, { type, pan, send, f: (t) => f0 * Math.pow(bend, t / dur), amp: (t) => env(t, a, d) * vol, lp: lp ? () => lp : null });
function noise(t0, dur, { vol = 0.2, a = 0.002, d = 0.1, type = 'bp', f0 = 1000, f1 = f0, q = 1, pan = 0, send = 0.1, ampFn = null } = {}) {
  const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * Math.pow(f1 / f0, t / dur);
    const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    const x = rnd() * 2 - 1;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const v = y * (ampFn ? ampFn(t) : env(t, a, d)) * vol;
    put(s0 + i, v * (1 - pan * 0.5), v * (1 + pan * 0.5), send);
  }
}
// formant "aah" choir: detuned saws through vowel band-passes
function choir(t0, notes, dur, vol = 0.05, { a = 0.8, rel = 0.8, stopAt = null } = {}) {
  const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR);
  const buf = new Float32Array(n);
  for (const nt of notes) for (const det of [-0.09, 0, 0.1]) {
    let ph = rnd(); const f0 = midi(nt) * Math.pow(2, det / 12), vr = 4.6 + rnd();
    for (let i = 0; i < n; i++) { const t = i / SR; ph += f0 * (1 + 0.006 * Math.sin(2 * Math.PI * vr * t)) / SR; buf[i] += osc('saw', ph); }
  }
  const bp = (F, q) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const w = 2 * Math.PI * F / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w); return (x) => { const y = (al * x - al * x2 + 2 * c * y1 - (1 - al) * y2) / (1 + al); x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }; };
  const f1 = bp(750, 5), f2 = bp(1150, 7), f3 = bp(2600, 9);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let g = Math.min(1, t / a) * Math.min(1, (dur - t) / rel);
    if (stopAt != null && t > stopAt) g *= Math.max(0, 1 - (t - stopAt) / 0.08);
    const v = (f1(buf[i]) + f2(buf[i]) * 0.6 + f3(buf[i]) * 0.2) * g * vol;
    put(s0 + i, v, v, 0.6);
  }
}

// ---------- instruments ----------
const sub = (t, vol = 0.7, f = 50) => tone(t, f, 2.6, { vol, d: 0.9, bend: 0.55, send: 0.1 });
const boom = (t, vol = 1) => { sub(t, 0.75 * vol); noise(t, 1.8, { vol: 0.5 * vol, d: 0.5, type: 'lp', f0: 400, f1: 60, send: 0.6 }); noise(t, 0.05, { vol: 0.2 * vol, d: 0.01, type: 'bp', f0: 1500, send: 0.5 }); };
const taiko = (t, vol = 0.8, f = 72) => { tone(t, f, 0.6, { vol, d: 0.22, bend: 0.55, send: 0.35 }); noise(t, 0.25, { vol: vol * 0.45, d: 0.06, type: 'lp', f0: 900, f1: 200, send: 0.4 }); };
const snareRoll = (t0, t1) => { for (let t = t0; t < t1; t += BEAT / 4) { const k = (t - t0) / (t1 - t0); noise(t, 0.12, { vol: 0.05 + k * 0.15, d: 0.04, type: 'bp', f0: 2200, q: 0.8, send: 0.3 }); } };
function braam(t, root, dur = 2.6, vol = 0.12, stopAt = null) {
  for (const iv of [0, 12, 19, 24]) for (const det of [-0.08, 0.08]) {
    const f0 = midi(root + iv) * Math.pow(2, det / 12);
    voice(t, dur, {
      type: 'saw', pan: det * 4, send: 0.45,
      f: (x) => stopAt != null && x > stopAt ? f0 * Math.pow(0.12, (x - stopAt) / 0.6) : f0,
      amp: (x) => Math.min(1, x / 0.04) * Math.exp(-x / (dur * 0.7)) * vol * (iv ? 0.6 : 1) * (stopAt != null && x > stopAt ? Math.max(0, 1 - (x - stopAt) / 0.6) : 1),
      lp: (x) => 220 + 2600 * Math.exp(-x / 0.5) * Math.min(1, x / 0.08) + 300,
    });
  }
  sub(t, 0.6, midi(root - 12) * 2);
}
const string = (t, n, dur, vol, pan = 0) => { for (const det of [-0.06, 0.06]) voice(t, dur, { type: 'saw', pan: pan + det * 3, send: 0.35, f: () => midi(n) * Math.pow(2, det / 12), amp: (x) => Math.min(1, x / 0.012) * Math.exp(-x / (dur * 0.6)) * vol, lp: () => 2200 }); };
const pad = (t, notes, dur, vol = 0.03) => { for (const n of notes) for (const det of [-0.1, 0.1]) voice(t, dur, { type: 'saw', pan: det * 3, send: 0.6, f: () => midi(n) * Math.pow(2, det / 12), amp: (x) => Math.min(1, x / 1.0) * Math.min(1, (dur - x) / 0.6) * vol, lp: () => 900 }); };
const kalimba = (t, n, vol = 0.16, pan = 0) => { const f = midi(n); tone(t, f, 1.4, { vol, d: 0.45, pan, send: 0.35 }); tone(t, f * 5.4, 0.25, { vol: vol * 0.25, d: 0.05, pan, send: 0.2 }); tone(t, f * 2, 0.6, { vol: vol * 0.15, d: 0.2, pan }); };
const riser = (t0, t1, vol = 0.16) => noise(t0, t1 - t0, { vol, a: t1 - t0, d: 0.05, type: 'bp', f0: 200, f1: 7000, q: 1.5, send: 0.5 });

// D minor: i – VI – III – VII
const PROG = [[38, [62, 65, 69]], [34, [58, 62, 65]], [41, [60, 65, 69]], [36, [60, 64, 67]]];

// ---------- prologue: drone + choir ----------
voice(0.2, T.silence - 0.2, { type: 'saw', send: 0.3, f: () => midi(26), amp: (x) => Math.min(1, x / 3) * 0.09 * Math.min(1, (T.silence - 0.2 - x) / 0.05), lp: (x) => 160 + 140 * Math.sin(x * 0.4) ** 2 });
tone(0.2, midi(26), T.silence - 0.2, { vol: 0.14, a: 2.5, d: 99, send: 0 });
choir(2.8, [50, 57, 62, 65], T.strings - 2.8 + 0.6, 0.035, { a: 2.5, rel: 1.2 });

// ---------- act I: the string ostinato builds until "behold" ----------
for (let bar = 0; T.strings + bar * BAR < T.silence; bar++) {
  const t = T.strings + bar * BAR, [root, ch] = PROG[bar % 4];
  const grow = Math.min(1, (t - T.strings) / (T.silence - T.strings));
  pad(t, ch.map((n) => n - 12), Math.min(BAR + 0.3, T.silence - t), 0.022 + grow * 0.02);
  tone(t, midi(root - 12), Math.min(BAR, T.silence - t), { type: 'sine', vol: 0.12 + grow * 0.1, a: 0.05, d: BAR, send: 0 });
  const pat = [0, 0, 2, 0, 1, 0, 2, 1];
  for (let s = 0; s < 8; s++) {
    const st = t + s * BEAT / 2;
    if (st >= T.silence - 0.02) break;
    string(st, ch[pat[s]] - 12, BEAT / 2 * 0.95, 0.035 + grow * 0.05, s % 2 ? 0.3 : -0.3);
  }
  if (bar % 2 === 0) taiko(t, 0.35 + grow * 0.4);
}
riser(T.silence - 2.2, T.silence, 0.12);

// ---------- act II: BRAAAM ----------
boom(T.braam, 1.1);
for (let bar = 0; T.braam + bar * BAR < T.climax - 0.01; bar++) {
  const t = T.braam + bar * BAR, [root, ch] = PROG[bar % 4];
  const hot = t >= T.critics - 0.1;
  if (bar % 2 === 0) braam(t, root - 12 + (root < 36 ? 12 : 0), BAR * 1.6, hot ? 0.13 : 0.11);
  choir(t, [ch[0] - 12, ...ch], BAR + 0.5, hot ? 0.045 : 0.032, { a: 0.4, rel: 0.5 });
  tone(t, midi(root - 12), BAR, { type: 'sine', vol: 0.22, a: 0.02, d: BAR, send: 0 });
  for (let s = 0; s < 16; s++) {
    const st = t + s * BEAT / 4;
    if (st >= T.climax - 0.02) break;
    const n = ch[[0, 1, 2, 1][s % 4]] - 12 + (s % 8 === 7 ? 12 : 0);
    string(st, n, BEAT / 4 * 0.9, hot ? 0.05 : 0.04, s % 2 ? 0.35 : -0.35);
    if (hot) string(st, n + 12, BEAT / 4 * 0.9, 0.025, s % 2 ? -0.4 : 0.4);
  }
  // taiko: 1 . . (&2) 3 . 4 (&4)
  for (const [b, v] of [[0, 1], [1.5, 0.55], [2, 0.85], [3, 0.6], [3.5, 0.7]]) if (t + b * BEAT < T.climax) taiko(t + b * BEAT, v * (hot ? 0.95 : 0.8));
}
snareRoll(T.climax - BAR, T.climax);
riser(T.climax - 2.2, T.climax, 0.2);

// ---------- climax: D major. then the tape stops. ----------
boom(T.climax, 1.3);
const hold = T.toy - T.climax;
braam(T.climax, 26, hold + 0.7, 0.14, hold);
choir(T.climax, [50, 54, 57, 62, 66, 69], hold + 0.1, 0.06, { a: 0.15, rel: 0.1, stopAt: hold - 0.02 });
voice(T.climax, hold + 0.6, { type: 'sine', send: 0, f: (x) => midi(38) * (x > hold ? Math.pow(0.15, (x - hold) / 0.55) : 1), amp: (x) => 0.25 * (x > hold ? Math.max(0, 1 - (x - hold) / 0.55) : 1) });

// ---------- the toy box: kalimba theme ----------
const C = [[48, [60, 64, 67, 72]], [45, [57, 60, 64, 69]], [41, [57, 60, 65, 69]], [43, [55, 59, 62, 67]]];
const TB = 0.5; // 120 bpm
tone(T.toy + 0.02, 200, 0.42, { vol: 0.3, bend: 2.6, d: 0.16, send: 0.2 }); // boing
for (let i = 0; T.toy + 0.35 + i * TB * 4 < T.stinger - 0.3; i++) {
  const t = T.toy + 0.35 + i * TB * 4, [root, ch] = C[i % 4];
  [0, 2, 1, 3, 2, 1, 3, 2].forEach((k, s) => { if (t + s * TB / 2 < T.stinger - 0.4) kalimba(t + s * TB / 2, ch[k], 0.12, s % 2 ? 0.4 : -0.4); });
  tone(t, midi(root), TB * 4, { type: 'tri', vol: 0.12, d: TB * 2, send: 0.1 });
  for (let b = 0; b < 4; b++) if (t + b * TB < T.stinger - 0.4) { tone(t + b * TB, 140, 0.3, { vol: 0.35, d: 0.12, bend: 0.4, send: 0.02 }); noise(t + b * TB + TB / 2, 0.05, { vol: 0.05, type: 'hp', f0: 8000, d: 0.02 }); }
}
[60, 64, 67, 72, 76].forEach((n, i) => kalimba(T.stinger - 0.45 + 0.08 * i, n, 0.12, (i - 2) * 0.2));

// ---------- SFX from the cue sheet ----------
const VOW = [[800, 1150], [400, 1600], [300, 2300], [450, 800], [325, 700]];
const SFX = {
  whoosh: (t) => noise(t - 0.1, 0.4, { vol: 0.12, a: 0.15, d: 0.1, type: 'bp', f0: 300, f1: 3500, q: 2 }),
  boom: (t) => boom(t, 0.85), boomSoft: (t) => boom(t, 0.5),
  squish: (t) => { noise(t, 0.12, { vol: 0.1, type: 'bp', f0: 1400, f1: 300, q: 3, d: 0.05 }); tone(t, 180, 0.12, { vol: 0.06, bend: 0.5, d: 0.05 }); },
  pop: (t) => { tone(t, 520, 0.14, { vol: 0.18, bend: 2, d: 0.05 }); noise(t, 0.04, { vol: 0.06, type: 'hp', f0: 4000, d: 0.01 }); },
  boing: (t) => tone(t, 200, 0.42, { vol: 0.24, bend: 2.6, d: 0.16, send: 0.2 }),
  flap: (t) => noise(t, 0.3, { vol: 0.22, type: 'bp', f0: 400, f1: 1800, q: 2, d: 0.1 }),
  slowmo: (t) => { noise(t, 1.2, { vol: 0.2, a: 0.05, d: 0.5, type: 'bp', f0: 2500, f1: 150, q: 1.2, send: 0.6 }); tone(t, 90, 1.2, { vol: 0.25, d: 0.5, bend: 0.5, send: 0.3 }); },
  splash: (t) => { noise(t, 0.8, { vol: 0.3, type: 'lp', f0: 3000, f1: 300, d: 0.28, send: 0.3 }); noise(t + 0.05, 0.5, { vol: 0.12, type: 'hp', f0: 4000, d: 0.12 }); },
  bonk: (t) => { tone(t, 220, 0.25, { type: 'square', vol: 0.12, bend: 0.5, d: 0.08, send: 0.4 }); noise(t, 0.3, { vol: 0.3, type: 'lp', f0: 2500, f1: 300, d: 0.08, send: 0.5 }); },
  chime: (t) => [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.07, 587 * Math.pow(2, s / 12), 1.2, { vol: 0.08, d: 0.4, send: 0.6 })),
  cricket: (t) => { for (let k = 0; k < 3; k++) for (let p = 0; p < 4; p++) tone(t + k * 0.42 + p * 0.032, 4400, 0.025, { vol: 0.045, a: 0.004, d: 0.008, pan: 0.5, send: 0.2 }); },
  creak: (t) => voice(t, 0.55, { type: 'saw', send: 0.2, f: (x) => 70 + 30 * Math.sin(x * 40) * x, amp: (x) => 0.05 * Math.min(1, x / 0.05) * Math.max(0, 1 - x / 0.55), lp: () => 1200 }),
  thud: (t) => { tone(t, 110, 0.4, { vol: 0.45, bend: 0.4, d: 0.12, send: 0.15 }); noise(t, 0.2, { vol: 0.22, type: 'lp', f0: 600, d: 0.05 }); },
  babble: (t) => {
    let tt = t;
    for (let s = 0; s < 4; s++) {
      const dur = 0.08 + rnd() * 0.06, f = 300 * (1 + (rnd() - 0.5) * 0.4), [F1, F2] = VOW[(rnd() * VOW.length) | 0];
      const n = Math.floor(dur * SR), s0 = Math.floor(tt * SR);
      let ph = 0;
      const bp = (F, q) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const w = 2 * Math.PI * F / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w); return (x) => { const y = (al * x - al * x2 + 2 * c * y1 - (1 - al) * y2) / (1 + al); x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }; };
      const b1 = bp(F1, 6), b2 = bp(F2, 9);
      for (let i = 0; i < n; i++) { ph += f / SR; const x = osc('saw', ph); const v = (b1(x) + b2(x) * 0.6) * env(i / SR, 0.01, dur * 0.5) * 0.7; put(s0 + i, v, v, 0.15); }
      tt += dur + 0.025;
    }
  },
};
B = FX;
for (const c of cues) SFX[c.type]?.(c.t);

// ---------- hall reverb on the send ----------
function reverb(inp, out, offs) {
  const combs = [1687, 1601, 2053, 2251, 1913, 1777].map((d) => ({ b: new Float32Array(d + offs), i: 0, fb: 0.86, lp: 0 }));
  const aps = [347, 113, 37].map((d) => ({ b: new Float32Array(d), i: 0 }));
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of combs) { const y = c.b[c.i]; c.lp += (y - c.lp) * 0.45; c.b[c.i] = inp[n] + c.lp * c.fb; c.i = (c.i + 1) % c.b.length; s += y; }
    s /= combs.length;
    for (const a of aps) { const y = a.b[a.i]; a.b[a.i] = s + y * 0.6; a.i = (a.i + 1) % a.b.length; s = y - s * 0.6; }
    out[n] += s * 0.8;
  }
}
for (const b of [MUS, FX]) { reverb(b.SL, b.L, 0); reverb(b.SR, b.R, 31); }
const duck = (t) => (t < T.silence || t >= T.braam - 0.005 ? 1 : Math.max(0, 1 - (t - T.silence) / 0.05));
// the music leans back for each punchline, then swells again
const SNARKS = cues.filter((c) => c.type === 'snark').map((c) => c.t);
const dip = (t) => { let g = 1; for (const s of SNARKS) { const d = t - s + 0.12; if (d > 0 && d < 1.9) g = Math.min(g, d < 0.12 ? 1 - 0.55 * d / 0.12 : d < 1.3 ? 0.45 : 0.45 + 0.55 * (d - 1.3) / 0.6); } return g; };
const L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i++) { const d = duck(i / SR) * dip(i / SR); L[i] = MUS.L[i] * d + FX.L[i]; R[i] = MUS.R[i] * d + FX.R[i]; }

// ---------- master ----------
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 0.05) * Math.min(1, (duration + 0.6 - t) / 0.8);
  L[i] = Math.tanh(L[i] * 1.2) * fade; R[i] = Math.tanh(R[i] * 1.2) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.9 / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
fs.writeFileSync(`${DIR}/audio.wav`, buf);
console.log('audio.wav written', (N / SR).toFixed(1) + 's');
if (process.env.AUDIO_ONLY) process.exit(0);

execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${DIR}/f%05d.jpg`, '-i', `${DIR}/audio.wav`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log('→ ' + OUT);
