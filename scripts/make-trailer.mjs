// Builds trailer.mp4 from captures/trailer: synthesizes a 120 BPM soundtrack timed to the
// cue sheet the trailer director wrote (cues.json), mixes SFX, and encodes with ffmpeg.
//   node scripts/make-trailer.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const DIR = process.env.TRAILER_DIR || 'captures/trailer';
const { fps, duration, cues } = JSON.parse(fs.readFileSync(`${DIR}/cues.json`, 'utf8'));
const SR = 44100, N = Math.ceil((duration + 0.6) * SR);
const L = new Float32Array(N), R = new Float32Array(N);       // dry
const SL = new Float32Array(N), SR_ = new Float32Array(N);    // reverb send
const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
const drop = cues.find((c) => c.type === 'drop')?.t ?? 9;
const logo = cues.find((c) => c.type === 'logo')?.t ?? duration - 4.2;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------- primitives ----------
function put(i, l, r, send = 0) { if (i < 0 || i >= N) return; L[i] += l; R[i] += r; if (send) { SL[i] += l * send; SR_[i] += r * send; } }
function env(t, a, d) { return t < a ? t / a : Math.exp(-(t - a) / d); }
function osc(type, ph) {
  const x = ph - Math.floor(ph);
  if (type === 'sine') return Math.sin(ph * 2 * Math.PI);
  if (type === 'tri') return 1 - 4 * Math.abs(x - 0.5);
  if (type === 'saw') return 2 * x - 1;
  return x < 0.5 ? 1 : -1;
}
function tone(t0, f0, dur, { type = 'sine', vol = 0.2, a = 0.004, d = 0.2, pan = 0, bend = 1, send = 0.15, lp = 0 } = {}) {
  const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR);
  let ph = 0, y = 0;
  const k = lp ? 1 - Math.exp(-2 * Math.PI * lp / SR) : 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * Math.pow(bend, t / dur);
    ph += f / SR;
    let v = osc(type, ph);
    if (lp) { y += (v - y) * k; v = y; }
    v *= env(t, a, d) * vol;
    put(s0 + i, v * (1 - pan) * 0.5 * 2 * 0.7, v * (1 + pan) * 0.5 * 2 * 0.7, send);
  }
}
// biquad band/high/low pass on noise
function noise(t0, dur, { vol = 0.2, a = 0.002, d = 0.1, type = 'bp', f0 = 1000, f1 = f0, q = 1, pan = 0, send = 0.1 } = {}) {
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
    const v = y * env(t, a, d) * vol;
    put(s0 + i, v * (1 - pan * 0.5), v * (1 + pan * 0.5), send);
  }
}

// ---------- instruments ----------
const kalimba = (t, n, vol = 0.16, pan = 0) => { const f = midi(n); tone(t, f, 1.4, { vol, d: 0.45, pan, send: 0.35 }); tone(t, f * 5.4, 0.25, { vol: vol * 0.25, d: 0.05, pan, send: 0.2 }); tone(t, f * 2, 0.6, { vol: vol * 0.15, d: 0.2, pan }); };
const kick = (t, vol = 0.85) => { tone(t, 150, 0.4, { vol, d: 0.16, bend: 0.3, send: 0.02 }); noise(t, 0.02, { vol: 0.25, type: 'hp', f0: 3000, d: 0.006, send: 0 }); };
const clap = (t) => { for (const o of [0, 0.011, 0.024]) noise(t + o, 0.18, { vol: 0.32, d: o === 0.024 ? 0.07 : 0.01, type: 'bp', f0: 1500, q: 0.9, send: 0.3 }); };
const hat = (t, open = false, pan = 0.3) => noise(t, open ? 0.25 : 0.06, { vol: open ? 0.08 : 0.06, d: open ? 0.08 : 0.018, type: 'hp', f0: 8000, pan, send: 0.05 });
const bass = (t, n, dur) => { tone(t, midi(n), dur, { type: 'saw', vol: 0.16, a: 0.005, d: dur * 0.9, lp: 380, send: 0 }); tone(t, midi(n), dur, { type: 'sine', vol: 0.2, d: dur * 0.8, send: 0 }); };
const pad = (t, notes, dur, vol = 0.045) => { for (const n of notes) for (const dt of [-0.12, 0.12]) tone(t, midi(n) * Math.pow(2, dt / 12), dur, { type: 'tri', vol, a: 0.6, d: dur * 0.7, lp: 1400, pan: dt * 3, send: 0.5 }); };
const crash = (t) => noise(t, 2.5, { vol: 0.22, d: 0.8, type: 'hp', f0: 5000, send: 0.4 });
const riser = (t0, t1) => noise(t0, t1 - t0, { vol: 0.16, a: t1 - t0, d: 0.05, type: 'bp', f0: 300, f1: 6000, q: 1.5, send: 0.4 });

// ---------- score: C – Am – F – G ----------
const CHORDS = [[48, [60, 64, 67, 72]], [45, [57, 60, 64, 69]], [41, [57, 60, 65, 69]], [43, [55, 59, 62, 67]]];
const arp = [0, 2, 1, 3, 2, 1, 3, 2];
for (let bar = 0; bar * BAR < duration; bar++) {
  const t = bar * BAR, [root, ch] = CHORDS[bar % 4];
  const end = t >= logo;
  if (end) break;
  pad(t, ch.map((n) => n - 12), BAR + 0.4, t < drop ? 0.05 : 0.04);
  // kalimba arpeggio, sparser in the intro
  for (let s = 0; s < 8; s++) {
    const st = t + s * BEAT / 2;
    if (st >= logo) break;
    if (t < drop && s % 2 === 1 && rnd() < 0.5) continue;
    kalimba(st, ch[arp[s]] + (s === 7 && bar % 2 ? 12 : 0), t < drop ? 0.12 : 0.11, (s % 2 ? 0.4 : -0.4));
  }
  if (t >= drop) {
    for (let b = 0; b < 4; b++) {
      const bt = t + b * BEAT;
      kick(bt);
      if (b % 2 === 1) clap(bt);
      hat(bt + BEAT / 2, b === 3, 0.35); hat(bt + BEAT / 4, false, -0.3); hat(bt + 3 * BEAT / 4, false, -0.3);
      bass(bt, root, BEAT * 0.45); bass(bt + BEAT / 2, root + (b === 3 ? 7 : 12), BEAT * 0.4);
    }
    // lead hook every other bar
    if (bar % 2 === 0) [0, 0.75, 1.5, 2.25, 3].forEach((b, i) => kalimba(t + b * BEAT, [72, 76, 79, 76, 74][i] + (bar % 4 === 2 ? -3 : 0), 0.1, 0));
  } else if (bar % 2 === 1) {
    noise(t + BEAT * 3.5, 0.05, { vol: 0.05, type: 'hp', f0: 7000, d: 0.02 });
  }
}
riser(drop - 1.5, drop);
kick(drop, 1); crash(drop);
// logo: hit + held chord
kick(logo, 1); crash(logo); pad(logo, [48, 55, 60, 64, 67, 72], 4, 0.07);
[60, 64, 67, 72, 76].forEach((n, i) => kalimba(logo + 0.12 * i, n, 0.13, (i - 2) * 0.2));
tone(logo, midi(36), 2.5, { type: 'sine', vol: 0.35, d: 1.2, send: 0 });

// ---------- SFX from the cue sheet ----------
const VOW = [[800, 1150], [400, 1600], [300, 2300], [450, 800], [325, 700]];
const SFX = {
  squish: (t) => { noise(t, 0.12, { vol: 0.12, type: 'bp', f0: 1400, f1: 300, q: 3, d: 0.05 }); tone(t, 180, 0.12, { vol: 0.08, bend: 0.5, d: 0.05 }); },
  pop: (t) => { tone(t, 520, 0.14, { vol: 0.22, bend: 2, d: 0.05 }); noise(t, 0.04, { vol: 0.08, type: 'hp', f0: 4000, d: 0.01 }); },
  boing: (t) => tone(t, 200, 0.42, { vol: 0.22, bend: 2.6, d: 0.16, send: 0.2 }),
  flap: (t) => noise(t, 0.25, { vol: 0.2, type: 'bp', f0: 400, f1: 1800, q: 2, d: 0.09 }),
  whoosh: (t) => noise(t - 0.12, 0.4, { vol: 0.11, a: 0.15, d: 0.1, type: 'bp', f0: 300, f1: 3500, q: 2 }),
  splash: (t) => { noise(t, 0.7, { vol: 0.3, type: 'lp', f0: 3000, f1: 300, d: 0.25 }); noise(t + 0.05, 0.5, { vol: 0.12, type: 'hp', f0: 4000, d: 0.12 }); },
  bonk: (t) => { tone(t, 280, 0.12, { type: 'square', vol: 0.1, bend: 0.6, d: 0.04 }); noise(t, 0.12, { vol: 0.25, type: 'lp', f0: 2500, f1: 500, d: 0.04 }); },
  chime: (t) => [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.07, 523 * Math.pow(2, s / 12), 0.8, { vol: 0.11, d: 0.3, send: 0.5 })),
  fanfare: (t) => [0, 4, 7, 12, 16].forEach((s, i) => tone(t + i * 0.1, 392 * Math.pow(2, s / 12), 0.5, { type: 'tri', vol: 0.11, d: 0.18, send: 0.3 })),
  babble: (t) => {
    let tt = t;
    for (let s = 0; s < 4; s++) {
      const dur = 0.08 + rnd() * 0.06, f = 260 * (1 + (rnd() - 0.5) * 0.4), [F1, F2] = VOW[(rnd() * VOW.length) | 0];
      const n = Math.floor(dur * SR), s0 = Math.floor(tt * SR);
      let ph = 0;
      const bp = (F, q) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const w = 2 * Math.PI * F / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w); return (x) => { const y = (al * x - al * x2 + 2 * c * y1 - (1 - al) * y2) / (1 + al); x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }; };
      const b1 = bp(F1, 6), b2 = bp(F2, 9);
      for (let i = 0; i < n; i++) { ph += f / SR; const x = osc('saw', ph); const v = (b1(x) + b2(x) * 0.6) * env(i / SR, 0.01, dur * 0.5) * 0.6; put(s0 + i, v, v, 0.15); }
      tt += dur + 0.025;
    }
  },
  drop: () => {}, logo: () => {},
};
for (const c of cues) SFX[c.type]?.(c.t);

// ---------- reverb (Schroeder-ish) on the send ----------
function reverb(inp, out, offs) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ b: new Float32Array(d + offs), i: 0, fb: 0.78 }));
  const aps = [225, 556].map((d) => ({ b: new Float32Array(d), i: 0 }));
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of combs) { const y = c.b[c.i]; c.b[c.i] = inp[n] + y * c.fb; c.i = (c.i + 1) % c.b.length; s += y; }
    s *= 0.25;
    for (const a of aps) { const y = a.b[a.i]; a.b[a.i] = s + y * 0.5; a.i = (a.i + 1) % a.b.length; s = y - s * 0.5; }
    out[n] += s * 0.55;
  }
}
reverb(SL, L, 0); reverb(SR_, R, 23);

// ---------- master: soft clip, fade, normalise, write WAV ----------
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 0.05) * Math.min(1, (duration + 0.5 - t) / 1.2);
  L[i] = Math.tanh(L[i] * 1.3) * fade; R[i] = Math.tanh(R[i] * 1.3) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.89 / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
fs.writeFileSync(`${DIR}/audio.wav`, buf);
console.log('audio.wav written', (N / SR).toFixed(1) + 's');

execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${DIR}/f%05d.jpg`, '-i', `${DIR}/audio.wav`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', process.env.TRAILER_OUT || 'clayborn-trailer.mp4'], { stdio: 'inherit' });
console.log('→ clayborn-trailer.mp4');
