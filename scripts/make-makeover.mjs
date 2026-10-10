// Splices the makeover shot (dev.cinema({ makeover: true, dir: 'makeover' })) into the prestige trailer,
// right after "behold." (while the score is silent), with its own cheesy makeover-montage audio.
//   node scripts/make-makeover.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const MK = 'captures/makeover', CIN = 'captures/cinema', OUT_DIR = 'captures/cinema-cut';
const AT = +(process.env.SPLICE_AT || 21.8); // seconds into the trailer: end of the "behold." shot
const { fps, duration, cues } = JSON.parse(fs.readFileSync(`${MK}/cues.json`, 'utf8'));
const SR = 44100, N = Math.round(duration * SR);
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const put = (i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - pan) * 0.7; R[i] += v * (1 + pan) * 0.7; } };
const osc = (type, ph) => { const x = ph - Math.floor(ph); return type === 'sine' ? Math.sin(ph * 2 * Math.PI) : type === 'tri' ? 1 - 4 * Math.abs(x - 0.5) : type === 'saw' ? 2 * x - 1 : (x < 0.5 ? 1 : -1); };
function tone(t0, f0, dur, { type = 'sine', vol = 0.2, a = 0.004, d = 0.2, pan = 0, bend = 1 } = {}) {
  const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += f0 * Math.pow(bend, t / dur) / SR; put(s0 + i, osc(type, ph) * (t < a ? t / a : Math.exp(-(t - a) / d)) * vol, pan); }
}
function noise(t0, dur, { vol = 0.1, d = 0.05, hp = false } = {}) {
  const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR); let prev = 0;
  for (let i = 0; i < n; i++) { const w = rnd() * 2 - 1, v = hp ? w - prev : w; prev = w; put(s0 + i, v * Math.exp(-(i / SR) / d) * vol); }
}
const kal = (t, n, vol = 0.12, pan = 0) => { tone(t, midi(n), 1.0, { vol, d: 0.35, pan }); tone(t, midi(n) * 5.4, 0.2, { vol: vol * 0.22, d: 0.04, pan }); };

// a bouncy little "makeover montage" bed: F major, 132 bpm, until the punchline
const end = (cues.find((c) => c.type === 'boing')?.t ?? duration - 1.5) - 0.12;
const B = 60 / 132, prog = [[53, [65, 69, 72]], [58, [65, 70, 74]], [60, [64, 67, 72]], [53, [65, 69, 72]]];
for (let bar = 0; 0.25 + bar * B * 4 < end; bar++) {
  const t = 0.25 + bar * B * 4, [root, ch] = prog[bar % 4];
  for (let b = 0; b < 4; b++) {
    const bt = t + b * B; if (bt >= end) break;
    tone(bt, midi(root - 12), B * 0.9, { type: 'tri', vol: 0.16, d: B * 0.5 });                // oom
    if (b % 2) noise(bt, 0.12, { vol: 0.12, d: 0.03, hp: true });                               // pah
    noise(bt + B / 2, 0.04, { vol: 0.05, d: 0.01, hp: true });
    [0, 1, 2].forEach((k) => { const st = bt + k * B / 3; if (st < end) kal(st, ch[(b + k) % 3] + 12, 0.07, k % 2 ? 0.3 : -0.3); });
  }
}
const SFX = {
  swap: (t) => { [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.03, 880 * Math.pow(2, s / 12), 0.35, { vol: 0.07, d: 0.12, pan: (i - 1.5) * 0.3 })); noise(t, 0.25, { vol: 0.06, d: 0.08, hp: true }); },
  pop: (t) => { tone(t, 420, 0.16, { vol: 0.3, bend: 2.4, d: 0.05 }); noise(t, 0.04, { vol: 0.08, d: 0.01, hp: true }); },
  boing: (t) => tone(t, 200, 0.45, { vol: 0.32, bend: 2.6, d: 0.17 }),
  boom: (t) => { tone(t, 55, 1.6, { vol: 0.35, d: 0.6, bend: 0.6 }); },
  babble: (t) => { let tt = t; for (let k = 0; k < 3; k++) { const f = 300 * (1 + (rnd() - 0.5) * 0.5), d = 0.08 + rnd() * 0.05; tone(tt, f, d, { type: 'square', vol: 0.05, a: 0.01, d: d * 0.5, bend: 1.2 }); tone(tt, f * 2, d, { vol: 0.06, a: 0.01, d: d * 0.5 }); tt += d + 0.02; } },
};
for (const c of cues) SFX[c.type]?.(c.t);

let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.7 / (peak || 1); // a bit under the trailer's peak level
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { const f = Math.min(1, i / 400, (N - i) / 400); buf.writeInt16LE(Math.round(Math.tanh(L[i] * g) * f * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.tanh(R[i] * g) * f * 32767), 46 + i * 4); }
fs.writeFileSync(`${MK}/audio.wav`, buf);

// frames: trailer up to the splice, the makeover, then the rest of the trailer
fs.rmSync(OUT_DIR, { recursive: true, force: true }); fs.mkdirSync(OUT_DIR, { recursive: true });
const cut = Math.round(AT * fps);
const old = fs.readdirSync(CIN).filter((f) => /^f\d+\.jpg$/.test(f)).sort();
const mk = fs.readdirSync(MK).filter((f) => /^f\d+\.jpg$/.test(f)).sort();
const seq = [...old.slice(0, cut).map((f) => path.join(CIN, f)), ...mk.map((f) => path.join(MK, f)), ...old.slice(cut).map((f) => path.join(CIN, f))];
seq.forEach((src, i) => fs.symlinkSync(path.resolve(src), path.join(OUT_DIR, `f${String(i).padStart(5, '0')}.jpg`)));

const out = process.env.TRAILER_OUT || 'clayborn-cinema-trailer.mp4';
const mkDur = mk.length / fps;
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${OUT_DIR}/f%05d.jpg`, '-i', `${CIN}/audio.wav`, '-i', `${MK}/audio.wav`,
  '-filter_complex', `[1:a]atrim=0:${AT},asetpts=PTS-STARTPTS[a0];[2:a]atrim=0:${mkDur},asetpts=PTS-STARTPTS[a1];[1:a]atrim=${AT},asetpts=PTS-STARTPTS[a2];[a0][a1][a2]concat=n=3:v=0:a=1[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`→ ${out}  (${seq.length} frames, makeover ${mkDur.toFixed(1)}s at ${AT}s)`);
