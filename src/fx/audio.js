// All sound is synthesized: kalimba music, squishes, and creature babble.
let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
let muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  master.connect(comp); comp.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  // a little room
  const verb = ctx.createConvolver(); verb.buffer = impulse(1.6); const vg = ctx.createGain(); vg.gain.value = 0.22;
  musicBus.connect(verb); sfxBus.connect(verb); verb.connect(vg); vg.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbience();
}

export function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05); }
export function isMuted() { return muted; }

function impulse(sec) {
  const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  return b;
}

function env(g, t, a, peak, dec) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}

function tone(freq, { type = 'sine', t = 0, a = 0.005, dec = 0.25, vol = 0.3, bend = 0, bus = sfxBus, detune = 0 } = {}) {
  if (!ctx) return;
  const now = ctx.currentTime + t;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, now); o.detune.value = detune;
  if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), now + a + dec);
  env(g, now, a, vol, dec);
  o.connect(g); g.connect(bus);
  o.start(now); o.stop(now + a + dec + 0.05);
}

function noise({ t = 0, dec = 0.2, vol = 0.3, f0 = 800, f1 = 300, q = 1, type = 'lowpass' } = {}) {
  if (!ctx) return;
  const now = ctx.currentTime + t;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, now); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dec);
  const g = ctx.createGain(); env(g, now, 0.005, vol, dec);
  s.connect(f); f.connect(g); g.connect(sfxBus);
  s.start(now, Math.random()); s.stop(now + dec + 0.05);
}

export const sfx = {
  click: () => { tone(880, { type: 'triangle', dec: 0.08, vol: 0.15 }); },
  tab: () => { tone(660, { type: 'sine', dec: 0.1, vol: 0.18 }); tone(990, { type: 'sine', t: 0.04, dec: 0.1, vol: 0.12 }); },
  squish: (p = 1) => { noise({ dec: 0.12, vol: 0.25, f0: 1400 * p, f1: 200, q: 3, type: 'bandpass' }); tone(180 * p, { dec: 0.12, vol: 0.2, bend: 0.5 }); },
  pop: (p = 1) => { tone(520 * p, { dec: 0.12, vol: 0.25, bend: 1.8 }); },
  boing: (p = 1) => { tone(220 * p, { type: 'sine', dec: 0.3, vol: 0.25, bend: 2.4 }); },
  thud: () => { tone(90, { dec: 0.18, vol: 0.4, bend: 0.5 }); noise({ dec: 0.1, vol: 0.2, f0: 400, f1: 80 }); },
  splash: () => { noise({ dec: 0.5, vol: 0.35, f0: 3000, f1: 300, q: 0.7 }); noise({ t: 0.06, dec: 0.4, vol: 0.2, f0: 5000, f1: 900, type: 'highpass' }); },
  whoosh: () => { noise({ dec: 0.35, vol: 0.2, f0: 300, f1: 2500, q: 2, type: 'bandpass' }); },
  bonk: () => { tone(300, { type: 'square', dec: 0.08, vol: 0.12, bend: 0.6 }); noise({ dec: 0.08, vol: 0.25, f0: 2000, f1: 400 }); },
  chime: () => { [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), { type: 'sine', t: i * 0.07, dec: 0.6, vol: 0.18 })); },
  fanfare: () => { [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => { tone(392 * Math.pow(2, s / 12), { type: 'triangle', t: i * 0.11, dec: 0.35, vol: 0.2 }); }); },
  sad: () => { [7, 4, 0, -5].forEach((s, i) => tone(392 * Math.pow(2, s / 12), { type: 'triangle', t: i * 0.18, dec: 0.4, vol: 0.18 })); },
  count: (hi) => { tone(hi ? 880 : 440, { type: 'square', dec: 0.18, vol: 0.12 }); },
  sparkle: () => { for (let i = 0; i < 6; i++) tone(1200 + Math.random() * 1600, { t: i * 0.04, dec: 0.15, vol: 0.06 }); },
};

// Creature voices: pitched gibberish with vowel formants.
const VOWELS = [[800, 1150], [400, 1600], [300, 2300], [450, 800], [325, 700], [600, 1000]];
export function babble(pitch = 1, syllables = 4, mood = 0) {
  if (!ctx) return;
  let t = ctx.currentTime + 0.02;
  for (let i = 0; i < syllables; i++) {
    const dur = 0.07 + Math.random() * 0.07;
    const f0 = 210 * pitch * (1 + (Math.random() - 0.5) * 0.35 + mood * 0.08 * i);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.9 + Math.random() * 0.25), t + dur);
    const [F1, F2] = VOWELS[(Math.random() * VOWELS.length) | 0];
    const out = ctx.createGain(); env(out, t, 0.01, 0.22, dur);
    for (const [F, q, v] of [[F1, 6, 1], [F2, 9, 0.6]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = F * Math.min(1.3, Math.max(0.8, pitch)); bp.Q.value = q;
      const vg = ctx.createGain(); vg.gain.value = v;
      o.connect(bp); bp.connect(vg); vg.connect(out);
    }
    out.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
    t += dur + 0.02 + Math.random() * 0.04;
  }
}

// ---------- generative music ----------
const MODES = {
  island: { bpm: 84, root: 60, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]] },
  creator: { bpm: 72, root: 62, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7, 11], [5, 9, 12], [-3, 0, 4, 7], [2, 5, 9]] },
  event: { bpm: 118, root: 57, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]] },
  calm: { bpm: 60, root: 60, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [5, 9, 12]] },
};
let music = { mode: null, timer: null, step: 0, next: 0 };
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function pluck(freq, t, vol = 0.18, dec = 0.9) {
  // kalimba-ish: sine + quick inharmonic partial
  const g = ctx.createGain(); env(g, t, 0.004, vol, dec); g.connect(musicBus);
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq; o1.connect(g);
  const g2 = ctx.createGain(); env(g2, t, 0.002, vol * 0.35, 0.12); g2.connect(musicBus);
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 5.4; o2.connect(g2);
  o1.start(t); o2.start(t); o1.stop(t + dec + 0.1); o2.stop(t + 0.2);
}
function pad(freqs, t, len, vol = 0.05) {
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(g); g.connect(musicBus);
  for (const f of freqs) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12; o.connect(lp); o.start(t); o.stop(t + len + 0.1); }
}
function bassNote(f, t, vol = 0.12) { tone(f, { type: 'sine', t: t - ctx.currentTime, dec: 0.45, vol, bus: musicBus }); }

export function playMusic(mode) {
  if (!ctx || music.mode === mode) return;
  music.mode = mode; music.step = 0; music.next = ctx.currentTime + 0.1;
  if (music.timer) clearInterval(music.timer);
  if (!mode) return;
  music.timer = setInterval(scheduler, 50);
}

function scheduler() {
  const M = MODES[music.mode]; if (!M) return;
  const sixteenth = 60 / M.bpm / 4;
  while (music.next < ctx.currentTime + 0.25) {
    const s = music.step, t = music.next;
    const bar = Math.floor(s / 16) % M.chords.length, chord = M.chords[bar];
    if (s % 16 === 0) { pad(chord.map((n) => midi(M.root + n - 12)), t, sixteenth * 16, music.mode === 'event' ? 0.03 : 0.045); bassNote(midi(M.root + chord[0] - 24), t); }
    if (music.mode === 'event' && s % 4 === 0) { noise({ t: t - ctx.currentTime, dec: 0.05, vol: 0.06, f0: 6000, f1: 3000, type: 'highpass' }); if (s % 8 === 4) tone(140, { t: t - ctx.currentTime, dec: 0.12, vol: 0.12, bend: 0.4, bus: musicBus }); }
    if (music.mode === 'event' && s % 8 === 0) bassNote(midi(M.root + chord[0] - 24), t, 0.14);
    // melody: sparse, chord-aware pentatonic wander
    const density = music.mode === 'event' ? 0.55 : music.mode === 'calm' ? 0.15 : 0.32;
    if ((s % 2 === 0 && Math.random() < density) || s % 16 === 0) {
      const oct = Math.random() < 0.3 ? 12 : 0;
      const n = Math.random() < 0.5 ? chord[(Math.random() * chord.length) | 0] : M.scale[(Math.random() * M.scale.length) | 0];
      pluck(midi(M.root + n + oct), t, 0.13, music.mode === 'event' ? 0.4 : 1.1);
    }
    music.step++; music.next += sixteenth;
  }
}

let amb = null;
function startAmbience() {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  const g = ctx.createGain(); g.gain.value = 0.0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.03;
  lfo.connect(lg); lg.connect(g.gain);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(); lfo.start();
  amb = g;
}
export function setAmbience(v) { if (amb) amb.gain.setTargetAtTime(v, ctx.currentTime, 0.5); }
