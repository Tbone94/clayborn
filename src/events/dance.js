// Dance-off (踊り): a rhythm face-off on a glowing disco stage.
// The song is synthesized on its own AudioContext; every note time is read off that clock.
import * as THREE from 'three';
import { EventBase } from './base.js';
import { terrainMesh, terrainMaterial, placeRocks, plantTrees, modelSize, PUSH } from '../world/nature.js';
import { rng } from '../creature/generator.js';
import { smoothstep, fbm2 } from '../game/noise.js';
import { sfx, babble, playMusic, isMuted } from '../fx/audio.js';

const BPM = 116, SPB = 60 / BPM, S16 = SPB / 4;
const INTRO_STEPS = 16, INTRO = INTRO_STEPS * S16;   // one bar of camera swoop before the count-in
const SONG_BARS = 24, END_BEAT = (SONG_BARS + 1) * 4;  // bar 0 = count-in, bars 1-24 = song, bar 25 = the final hit
const PERFECT = 0.07, GOOD = 0.14, APPROACH = 1.45;
const STAGE = 1.25, SW = 3.95, SD = 2.3;               // stage top + half extents
const PAL = ['#e63b2e', '#ffd23f', '#ff8fd0', '#2fe0c0'];
const NOTE_COL = ['#ff8fd0', '#2fe0c0', '#ffd23f', '#e63b2e'];  // ← ↑ ↓ →
const ROT = [-90, 0, 180, 90];
const L = 0, U = 1, D = 2, R = 3, J = 4;
const KEYMAP = { arrowleft: L, a: L, arrowup: U, w: U, arrowdown: D, s: D, arrowright: R, d: R, ' ': J };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let hintShown = false;

function groundH(x, z) {
  const r = Math.hypot(x, z * 1.15);
  return 0.35 - smoothstep(11, 17, r) * 3.6 + fbm2(x * 0.12, z * 0.12) * 0.25 * smoothstep(6, 10, r);
}
function stageH(x, z) { return Math.abs(x) < SW && Math.abs(z) < SD ? STAGE : groundH(x, z); }

// ------------------------------------------------------------------ the song
const VERSE = [{ r: 0, st: [3, 7, 10, 12] }, { r: -7, st: [5, 9, 12, 15] }, { r: 0, st: [3, 7, 10, 12] }, { r: -7, st: [5, 9, 12, 15] }];
const CHORUS = [{ r: -4, st: [3, 7, 8, 12] }, { r: -2, st: [2, 5, 7, 10] }, { r: -5, st: [2, 5, 7, 10] }, { r: 0, st: [3, 7, 10, 12] }];
const _ = null;
const LEAD_V = [[12, _, _, 10, _, 7, _, _, 10, _, 12, _, _, _, 7, _], [5, _, 7, _, _, 3, _, 0, _, _, 3, _, 5, _, _, _]];
const LEAD_C = [[12, _, 15, _, _, 12, _, 8, _, _, 12, _, 15, _, _, _], [14, _, 10, _, _, 14, _, 17, _, _, 14, _, 10, _, _, _],
  [7, _, 10, _, _, 14, _, 10, _, _, 7, _, 5, _, _, _], [12, _, 10, _, 7, _, 3, _, 0, _, _, _, _, _, _, _]];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const section = (bar) => (bar <= 4 ? 'intro' : bar <= 12 ? 'verse' : bar <= 20 ? 'chorus' : 'finale');

class Song {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ac = new AC(); } catch { this.ac = null; return; }
    const ac = this.ac;
    this.vol = 0.75;
    this.master = ac.createGain(); this.master.gain.value = isMuted() ? 0 : this.vol; this.muted = isMuted();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ac.destination);
    this.bus = ac.createGain(); this.bus.connect(this.master);
    // a little room for claps + lead, and a dotted-eighth echo on the kalimba
    const verb = ac.createConvolver(); const len = ac.sampleRate * 1.1, ib = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ib.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    verb.buffer = ib; this.wet = ac.createGain(); this.wet.gain.value = 0.18; this.wet.connect(verb); verb.connect(this.master);
    this.lead = ac.createGain(); this.lead.connect(this.bus); this.lead.connect(this.wet);
    const dl = ac.createDelay(1); dl.delayTime.value = S16 * 3; const fb = ac.createGain(); fb.gain.value = 0.28;
    const dg = ac.createGain(); dg.gain.value = 0.35;
    this.lead.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(dg); dg.connect(this.bus);
    this.noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.lat = Math.min(0.12, ac.outputLatency || ac.baseLatency || 0);
    this.t0 = ac.currentTime + INTRO + 0.15;  // ctx time of beat 0 (scheduled), heard at t0 + lat
    this.step = -INTRO_STEPS;
    if (ac.state !== 'running') ac.resume?.().catch(() => {});
    this.timer = setInterval(() => this.schedule(), 25);
  }

  get running() { return !!this.ac && this.ac.state === 'running'; }
  resume() { if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {}); }

  syncMute() {
    if (!this.ac) return;
    const m = isMuted();
    if (m !== this.muted) { this.muted = m; this.master.gain.setTargetAtTime(m ? 0 : this.vol, this.ac.currentTime, 0.03); }
  }

  schedule() {
    if (!this.running) return;
    const now = this.ac.currentTime;
    while (this.step <= END_BEAT * 4 + 4) {
      const t = this.t0 + this.step * S16;
      if (t > now + 0.2) break;
      if (t >= now - 0.015) this.play(this.step, t);
      this.step++;
    }
    if (this.step > END_BEAT * 4 + 4) { clearInterval(this.timer); this.timer = null; }
  }

  // ---- instruments (all scheduled at absolute ctx time t)
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  osc(type, f, t, dur, vol, { a = 0.004, bend = 0, out = this.bus, detune = 0 } = {}) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * bend), t + a + dur);
    this.env(g, t, a, vol, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  noise(t, dur, vol, { f0 = 6000, f1 = 4000, q = 0.8, type = 'highpass', out = this.bus, a = 0.002 } = {}) {
    const ac = this.ac, s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ac.createGain(); this.env(g, t, a, vol, dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
  }
  kick(t, v = 1) { this.osc('sine', 165, t, 0.3, 0.95 * v, { bend: 0.26 }); this.noise(t, 0.012, 0.25 * v, { f0: 3000, f1: 1500, type: 'bandpass' }); }
  clap(t, v = 1) {
    for (const d of [0, 0.011, 0.023]) this.noise(t + d, 0.03, 0.32 * v, { f0: 1500, f1: 1100, q: 1.4, type: 'bandpass' });
    this.noise(t + 0.03, 0.16, 0.28 * v, { f0: 1400, f1: 900, q: 1.1, type: 'bandpass', out: this.wet });
    this.noise(t + 0.03, 0.14, 0.22 * v, { f0: 1400, f1: 900, q: 1.1, type: 'bandpass' });
  }
  hat(t, v = 1, open = false) { this.noise(t, open ? 0.16 : 0.035, (open ? 0.1 : 0.12) * v, { f0: 8000, f1: 6000 }); }
  bass(n, t, dur = S16 * 1.6, v = 1) {
    const ac = this.ac, f = midi(n);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 7;
    lp.frequency.setValueAtTime(2000, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    const g = ac.createGain(); this.env(g, t, 0.005, 0.26 * v, dur); lp.connect(g); g.connect(this.bus);
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + dur + 0.06);
    this.osc('sine', f / 2, t, dur, 0.22 * v);
  }
  pluck(n, t, v = 1, dec = 0.55) {
    // kalimba: a sine plus a quick inharmonic tine partial
    const f = midi(n);
    this.osc('sine', f, t, dec, 0.2 * v, { out: this.lead });
    this.osc('sine', f * 5.4, t, 0.09, 0.07 * v, { a: 0.002, out: this.lead });
  }
  stab(tones, t, dur = 0.13, v = 1) {
    const ac = this.ac, lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900; lp.connect(this.bus); lp.connect(this.wet);
    for (const s of tones) this.osc('sawtooth', midi(57 + s), t, dur, 0.045 * v, { out: lp, detune: (Math.random() - 0.5) * 14 });
  }
  block(t, hi) { this.osc('sine', hi ? 1760 : 1175, t, 0.06, 0.32, { bend: 0.92 }); this.noise(t, 0.02, 0.12, { f0: hi ? 3500 : 2500, f1: 2000, type: 'bandpass', q: 3 }); }
  riser(t, dur) { this.noise(t, dur, 0.14, { f0: 250, f1: 4200, q: 2.5, type: 'bandpass', a: dur * 0.85 }); }
  crash(t) { this.noise(t, 1.8, 0.2, { f0: 9000, f1: 5000 }); this.noise(t, 0.9, 0.12, { f0: 4000, f1: 2500, out: this.wet }); }
  tick(good) { if (!this.running) return; const t = this.ac.currentTime + 0.005; this.osc('sine', good ? 2093 : 1568, t, 0.05, 0.045); }

  play(step, t) {
    if (step < 0) { if (step === -INTRO_STEPS) this.riser(t, INTRO); return; }
    const bar = Math.floor(step / 16), s = step % 16;
    if (bar === 0) { // count-in: four wood blocks, hats creeping in, a bass pickup
      if (s % 4 === 0) this.block(t, s === 12);
      if (s % 4 === 2) this.hat(t, 0.6);
      if (s === 14) this.bass(45, t, S16 * 1.2, 0.8);
      return;
    }
    if (bar > SONG_BARS) { // the big finish
      if (s === 0) {
        this.kick(t, 1.2); this.crash(t); this.bass(45, t, 1.6, 1.1); this.stab([3, 7, 10, 12, 15], t, 1.4, 1.4);
        [0, 3, 7, 12, 15, 19].forEach((n, i) => this.pluck(69 + n, t + i * S16 * 0.5, 0.9, 1.0));
      }
      return;
    }
    const sec = section(bar);
    const ch = (sec === 'intro' || sec === 'verse' ? VERSE : CHORUS)[(bar - 1) % 4];
    const fill = (bar === 4 || bar === 12 || bar === 20) && s >= 12;
    // drums: four on the floor, claps on 2 + 4, offbeat hats
    if (s % 4 === 0) this.kick(t);
    if (sec === 'finale' && s === 14) this.kick(t, 0.6);
    if (sec !== 'intro' && (s === 4 || s === 12) && !fill) this.clap(t);
    if (fill && sec !== 'intro') this.clap(t, 0.45 + (s - 12) * 0.15);
    if (fill && sec === 'intro' && s >= 14) this.clap(t, 0.5);
    if (s % 4 === 2) this.hat(t, 1, s === 14 && sec !== 'intro');
    else if (sec === 'chorus' || sec === 'finale') this.hat(t, s % 2 ? 0.35 : 0.5);
    // bass: syncopated in the intro, disco octaves after
    const root = 45 + ch.r;
    if (sec === 'intro') {
      const pat = { 0: 0, 3: 0, 6: 12, 8: 0, 10: 7, 11: 12, 14: 10 };
      if (pat[s] != null) this.bass(root + pat[s], t);
    } else if (s % 2 === 0) this.bass(root + (s % 4 === 2 ? 12 : 0), t, S16 * 1.3, s % 4 === 0 ? 1 : 0.85);
    else if (s === 7 || s === 15) this.bass(root + 10, t, S16 * 0.8, 0.55);
    // chord stabs on the "and" of 2 and 4
    if ((sec === 'chorus' || sec === 'finale') && (s === 6 || s === 14)) this.stab(ch.st, t);
    if (sec === 'verse' && s === 6 && bar % 2 === 0) this.stab(ch.st, t, 0.1, 0.7);
    // kalimba lead
    if (sec === 'verse') { const n = LEAD_V[(bar - 1) % 2][s]; if (n != null) this.pluck(69 + n, t); }
    if (sec === 'chorus' || sec === 'finale') {
      const n = LEAD_C[(bar - 1) % 4][s]; if (n != null) this.pluck(69 + n + (sec === 'finale' && bar > 22 ? 12 : 0), t);
      if (sec === 'finale' && s % 2 === 1 && Math.random() < 0.35) this.pluck(81 + [0, 3, 7, 10][(Math.random() * 4) | 0], t, 0.35, 0.2);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const ac = this.ac; if (!ac) return;
    try { this.master.gain.setTargetAtTime(0, ac.currentTime, 0.05); } catch { /* closed */ }
    setTimeout(() => { ac.close?.().catch(() => {}); }, 400);
    this.ac = null;
  }
}

// ------------------------------------------------------------------ the chart
function makeChart(seed) {
  const r = rng(seed), notes = [];
  let last = -1, last2 = -1;
  const pick = (avoid = -1) => {
    let d;
    for (let k = 0; k < 8; k++) { d = (r() * 4) | 0; if (d !== avoid && !(d === last && d === last2)) break; }
    last2 = last; last = d; return d;
  };
  const add = (beat, dir) => notes.push({ beat, t: beat * SPB, dir });
  for (let bar = 1; bar <= SONG_BARS; bar++) {
    const b0 = bar * 4, sec = section(bar);
    if (sec === 'intro') { add(b0, pick()); add(b0 + 2, pick()); continue; }
    const jumpBar = bar === 13 || bar === 17 || bar === 21;
    for (let k = 0; k < 4; k++) {
      if (k === 0 && jumpBar) { add(b0, J); continue; }
      if (sec === 'verse' && k > 0 && r() < (bar < 9 ? 0.3 : 0.15)) continue;
      add(b0 + k, pick());
      const eighth = sec === 'verse' ? (bar >= 9 && k === 3 && r() < 0.45)
        : sec === 'chorus' ? ((k === 1 || k === 3) && r() < 0.5)
          : (bar === 24 && k >= 2) || ((k === 1 || k === 3) && r() < 0.65);
      if (eighth && !(jumpBar && k === 3 && bar === 24)) { const prev = last; add(b0 + k + 0.5, pick(prev)); }
    }
  }
  add(END_BEAT, J);
  return notes.sort((a, b) => a.t - b.t);
}

const ARROW = '<svg viewBox="0 0 24 24"><path d="M12 2.5 21.5 12H15.6V21.5H8.4V12H2.5Z"/></svg>';

const CSS = `
.dn-root { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;
  --c: 50px; --g: 6px; --h: 214px; z-index: 2; }
.dn-judge { height: 50px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.dn-judge b { font: 400 24px var(--display); letter-spacing: .04em; color: var(--yellow); -webkit-text-stroke: 4px var(--ink); paint-order: stroke fill;
  text-shadow: 3px 3px 0 var(--red); transform: rotate(-3deg); animation: dn-pop .32s cubic-bezier(.2, 1.5, .4, 1); white-space: nowrap; }
.dn-judge b.good { color: var(--white); }
.dn-judge b.miss { color: #a3a3b8; text-shadow: none; }
.dn-judge b.rec { color: #2fe0c0; }
.dn-judge i { font: 400 14px var(--dot); font-style: normal; color: var(--yellow); background: var(--ink); padding: 0 8px; transform: skewX(-10deg); box-shadow: 2px 2px 0 var(--red); }
.dn-judge i:empty { visibility: hidden; }
@keyframes dn-pop { 0% { transform: scale(1.8) rotate(-3deg); opacity: 0; } 100% { transform: scale(1) rotate(-3deg); opacity: 1; } }
.dn-lane { position: relative; width: calc(4 * var(--c) + 3 * var(--g) + 16px); height: var(--h); overflow: hidden;
  background: linear-gradient(rgba(21, 23, 43, 0), rgba(21, 23, 43, .5) 70%);
  -webkit-mask-image: linear-gradient(transparent, #000 22%); mask-image: linear-gradient(transparent, #000 22%); }
.dn-lane::before { content: ''; position: absolute; inset: 0 8px; pointer-events: none;
  background: repeating-linear-gradient(90deg, transparent 0 calc(var(--c) / 2 - 1px), rgba(251, 248, 240, .14) calc(var(--c) / 2 - 1px) calc(var(--c) / 2 + 1px), transparent calc(var(--c) / 2 + 1px) calc(var(--c) + var(--g))); }
.dn-bar { position: absolute; left: 2px; right: 2px; bottom: 2px; height: calc(var(--c) + 12px); background: var(--ink); transform: skewX(-10deg); box-shadow: 4px 4px 0 var(--red); }
.dn-rec, .dn-note { position: absolute; left: 0; top: 0; width: var(--c); height: var(--c); }
.dn-rec { top: auto; bottom: 8px; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; transition: transform .08s; }
.dn-rec svg { width: 74%; height: 74%; fill: none; stroke: var(--white); stroke-width: 2.2; stroke-linejoin: round; opacity: .85; }
.dn-rec.on svg { fill: var(--white); }
.dn-rec.hit { transform: scale(1.18); }
.dn-rec.hit svg { fill: var(--k); stroke: var(--white); opacity: 1; }
.dn-note { display: flex; align-items: center; justify-content: center; will-change: transform; }
.dn-note::before { content: ''; position: absolute; inset: 4px; background: var(--k); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); transform: skewX(-8deg); }
.dn-note svg { position: relative; width: 58%; height: 58%; fill: var(--ink); }
.dn-note.jump { width: calc(4 * var(--c) + 3 * var(--g)); height: 26px; margin-top: calc(var(--c) / 2 - 13px); }
.dn-note.jump::before { inset: 0; background: repeating-linear-gradient(-45deg, var(--yellow) 0 8px, var(--ink) 8px 11px); }
.dn-note.jump b { position: relative; font: 400 14px var(--display); color: var(--ink); background: var(--yellow); padding: 0 8px; border: 2px solid var(--ink); letter-spacing: .08em; }
.dn-note.gone { opacity: .25; transition: opacity .2s; }
.dn-hint { margin-top: 8px; font: 700 12px var(--ui); color: var(--white); background: rgba(21, 23, 43, .85); padding: 5px 12px; white-space: nowrap; transition: opacity .5s; }
.dn-hint kbd { margin: 0 3px; }
.dn-hint.off { opacity: 0; }
.dn-touch { display: none; }
.dn-pill { font-size: 19px !important; white-space: nowrap; }
.dn-pill small { font-size: 13px; color: var(--white); margin-right: 6px; display: inline-block; max-width: 9em; overflow: hidden; text-overflow: ellipsis; vertical-align: -2px; }
.dn-pill.riv { background: var(--white); color: var(--ink); box-shadow: 4px 4px 0 var(--ink); }
.dn-pill.riv small { color: var(--red); }
@media (pointer: coarse) {
  .dn-root { bottom: calc(176px + env(safe-area-inset-bottom)); --c: 46px; --g: 5px; --h: 168px; }
  .dn-key { display: none; } .dn-touch { display: inline; }
}
@media (pointer: coarse) and (max-height: 520px) { .dn-root { bottom: 6px; --c: 40px; --h: 132px; } .dn-judge { height: 40px; } .dn-hint { display: none; } }
@media (max-width: 520px) { .dn-pill { font-size: 16px !important; padding: 3px 10px !important; } .dn-pill small { max-width: 5.5em; font-size: 11px; } .dn-judge b { font-size: 20px; } }
`;

// ------------------------------------------------------------------ the event
export class DanceEvent extends EventBase {
  constructor(app, island, creature, idx) {
    super(app, island, creature, idx, { rivals: 1, rivalOpts: [{ frame: 'biped' }] });
    this.height = stageH;
    this.rival = this.rivals[0];
    this.build();
    this.chart = makeChart((Math.random() * 1e9) | 0);
    this.lastT = this.chart[this.chart.length - 1].t;
    this.missIdx = 0; this.rivIdx = 0; this.spawnIdx = 0;
    this.me = { pts: 0, combo: 0, max: 0, perfect: 0, good: 0, miss: 0, breaks: 0, saves: 0, cd: 0 };
    this.rv = { pts: 0, combo: 0, max: 0, perfect: 0, good: 0, miss: 0 };
    this.mult = this.bigMoves(this.player.c);
    this.rivMult = this.bigMoves(this.rival.c);
    const bal = this.player.c.stats.balance;
    this.saveChance = clamp((bal - 2) / 8, 0, 1) * 0.6;
    // two dancers facing the crowd, turned a little toward each other
    const portrait = this.camera.aspect < 1;
    const gap = this.gap = portrait ? 1.3 : 1.75;
    this.dancers = [this.player, this.rival].map((b, i) => {
      const s = i === 0 ? -1 : 1;
      b.x = s * gap; b.z = 0.2; b.y = STAGE; b.grounded = true; b.vx = b.vz = b.vy = 0;
      const base = -Math.PI / 2 - s * 0.55;
      b.heading = base; b.sync();
      return { b, base, y: 0, vy: 0, lean: 0, leanV: 0, twist: 0, twistV: 0, bow: 0, bowV: 0, sq: 0, sqV: 0, spin: 0, spinFrom: 0, spinTo: 0, spinT: 1, spinDur: 0.45, wob: 0, celebT: 0, lr: 0 };
    });
    this.pos = -INTRO; this.beat = -99; this.flash = 0; this.firstFrame = true; this.cues = {};
    this.song = new Song();
    this.mountUI();
    this.flick = { armed: true };
    this.kbSeen = new Set();
    this.onKey = (e) => {
      if (e.repeat || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase(); const dir = KEYMAP[k];
      this.song.resume();
      if (dir == null) return;
      this.kbSeen.add(k);
      this.press(dir, this.posNow());
    };
    window.addEventListener('keydown', this.onKey);
  }

  // longer legs + arms = bigger moves = more points (×1.0 - ×1.3)
  bigMoves(c) {
    const A = c.analysis, raw = c.stats.raw;
    if (!A || !raw) return 1;
    let arm = 0;
    for (const it of A.inst || []) {
      const bone = A.bones[it.bone]; if (!bone || bone.kind !== 'arm') continue;
      const bb = it.f.bbox, p = bone.pos;
      arm = Math.max(arm, Math.hypot(Math.max(Math.abs(bb[0] - p[0]), Math.abs(bb[2] - p[0])), Math.max(Math.abs(bb[1] - p[1]), Math.abs(bb[3] - p[1]))));
    }
    const reach = raw.legLen + arm * 0.6;
    this.reach = reach;
    const k = clamp((reach - 0.1) / 0.85, 0, 1);
    return Math.round((1 + 0.3 * k) * 20) / 20;
  }

  // ---------------------------------------------------------------- world
  build() {
    const s = this.scene;
    const r = rng(91);
    // dusk: let the stage lights do the work
    s.backgroundIntensity = 0.55; s.environmentIntensity = 0.45;
    this.lights.sun.intensity = 1.5; this.lights.hemi.intensity = 0.35;
    const splat = (x, h, z, ny) => {
      const rock = smoothstep(0.85, 0.6, ny);
      const grass = smoothstep(7, 11, Math.hypot(x, z)) * smoothstep(-0.2, 0.3, h) * (1 - rock) * (fbm2(x * 0.2, z * 0.2) > -0.1 ? 1 : 0.3);
      return [grass, 0, Math.max(0, 1 - grass - rock), rock];
    };
    s.add(terrainMesh(groundH, { size: [60, 60], seg: [150, 150], splatFn: splat, material: terrainMaterial({ path: 'rocky_trail' }) }));
    this.makeWater(groundH, [-60, -60, 120]);
    // a ring of boulders and trees, like an open-air club in a cove
    const rs = Math.max(...['rock1', 'rock2', 'rock3'].map((k) => { const v = modelSize(k); return Math.max(v.x, v.z); }));
    const rocks = [], trees = [];
    for (let i = 0; i < 18; i++) {
      const a = Math.PI * 0.15 + (i / 18) * Math.PI * 2 + r() * 0.2, d = 15 + r() * 6;
      if (Math.sin(a) > 0.55 && Math.abs(Math.cos(a)) < 0.6) continue; // keep the camera side open
      rocks.push({ x: Math.cos(a) * d, y: -1.5, z: Math.sin(a) * d, s: (3.5 + r() * 4) / rs, sy: 0.6 + r() * 0.5, ry: r() * 6.28 });
      if (r() < 0.5) trees.push({ x: Math.cos(a) * d, y: 0.6 + r(), z: Math.sin(a) * d, h: 5 + r() * 5, ry: r() * 6.28, kind: (r() * 4) | 0 });
    }
    for (let i = 0; i < 6; i++) { const x = (r() - 0.5) * 22, z = -8 - r() * 4; trees.push({ x, y: groundH(x, z) - 0.2, z, h: 6 + r() * 4, ry: r() * 6.28, kind: (r() * 6) | 0 }); }
    placeRocks(s, rocks); plantTrees(s, trees);

    // the stage: an ink plinth, a light-up checkerboard and a red trim
    const ink = new THREE.MeshStandardMaterial({ color: '#15172b', roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: '#e63b2e', roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(SW * 2 + 0.2, STAGE + 0.6, SD * 2 + 0.2), ink);
    base.position.y = (STAGE - 0.6) / 2 - 0.06; base.castShadow = base.receiveShadow = true; s.add(base);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(SW * 2 + 0.3, 0.14, SD * 2 + 0.3), red);
    trim.position.y = STAGE - 0.12; s.add(trim);
    const step = new THREE.Mesh(new THREE.BoxGeometry(3, STAGE * 0.5, 0.8), ink);
    step.position.set(0, STAGE * 0.25 - 0.05, SD + 0.5); step.castShadow = step.receiveShadow = true; s.add(step);
    this.tiles = [];
    const NX = 7, NZ = 4, tw = (SW * 2) / NX, td = (SD * 2) / NZ;
    const tGeo = new THREE.BoxGeometry(tw - 0.06, 0.08, td - 0.06);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const m = new THREE.MeshStandardMaterial({ color: '#23263f', roughness: 0.25, metalness: 0.1, emissive: PAL[(i + j) % 4], emissiveIntensity: 0.1 });
      const t = new THREE.Mesh(tGeo, m); t.position.set(-SW + tw * (i + 0.5), STAGE - 0.04, -SD + td * (j + 0.5)); t.receiveShadow = true;
      s.add(t); this.tiles.push({ m, i, j, on: 0, col: PAL[0] });
    }
    // marquee bulbs round the front lip, chasing on the eighths
    this.bulbMats = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: '#fff4c2', emissive: '#ffd23f', emissiveIntensity: 1 }));
    const bGeo = new THREE.SphereGeometry(0.075, 10, 8);
    let k = 0;
    for (let x = -SW; x <= SW + 0.01; x += 0.42) { const b = new THREE.Mesh(bGeo, this.bulbMats[k++ % 2]); b.position.set(x, STAGE - 0.32, SD + 0.13); s.add(b); }
    for (const sx of [-1, 1]) for (let z = -SD + 0.3; z < SD; z += 0.42) { const b = new THREE.Mesh(bGeo, this.bulbMats[k++ % 2]); b.position.set(sx * (SW + 0.13), STAGE - 0.32, z); s.add(b); }

    // backdrop with the sign
    const back = new THREE.Mesh(new THREE.PlaneGeometry(SW * 2 + 0.4, 4.4), new THREE.MeshStandardMaterial({ map: this.signTex(), emissive: '#ffffff', emissiveMap: this.signTex(), emissiveIntensity: 0.55, roughness: 0.8 }));
    back.position.set(0, STAGE + 2.2, -SD - 0.12); s.add(back);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SW * 2 + 0.7, 4.7, 0.2), ink); frame.position.set(0, STAGE + 2.2, -SD - 0.25); frame.castShadow = true; s.add(frame);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, STAGE + 6, 0.25), ink); p.position.set(sx * (SW + 0.2), (STAGE + 6) / 2 - 0.5, -SD - 0.2); p.castShadow = true; s.add(p); }
    const truss = new THREE.Mesh(new THREE.BoxGeometry(SW * 2 + 0.6, 0.22, 0.22), ink); truss.position.set(0, STAGE + 5.4, -SD - 0.2); s.add(truss);

    // speaker stacks that thump with the kick
    this.cones = [];
    const coneMat = new THREE.MeshStandardMaterial({ color: '#2a2d4c', roughness: 0.5 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 1.1), ink);
      box.position.set(sx * (SW + 1.25), groundH(sx * (SW + 1.25), 0.4) + 1.15, 0.4); box.castShadow = true; s.add(box);
      for (const [yy, rr] of [[0.45, 0.42], [-0.5, 0.36]]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.05, 8, 24), rimMat);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.92, rr * 0.4, 0.12, 24), coneMat);
        cone.rotation.x = Math.PI / 2; rim.position.set(0, yy, 0.56); cone.position.set(0, yy, 0.56);
        box.add(rim, cone); this.cones.push(cone);
      }
    }

    // disco ball + colored spots + sweeping beams
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), new THREE.MeshStandardMaterial({ color: '#e8e8f0', metalness: 1, roughness: 0.12, flatShading: true }));
    this.ball.position.set(0, STAGE + 3.9, -0.6); s.add(this.ball);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 4), ink); wire.scale.y = 2; wire.position.set(0, STAGE + 4.7, -0.6); s.add(wire);
    this.spots = PAL.map((c, i) => {
      const L = new THREE.PointLight(c, 10, 14, 2);
      L.position.set([-3, 3, -1.4, 1.4][i], STAGE + [3.2, 3.2, 4.2, 4.2][i], [2.4, 2.4, 0.6, 0.6][i]);
      s.add(L); return L;
    });
    this.beams = PAL.map((c, i) => {
      const g = new THREE.ConeGeometry(1.1, 7, 24, 1, true); g.translate(0, -3.5, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.position.set([-3.4, -1.2, 1.2, 3.4][i], STAGE + 5.3, -SD + 0.15); s.add(m); return m;
    });
  }

  signTex() {
    if (this._sign) return this._sign;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#15172b'; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = 'rgba(255, 210, 63, .13)';
    for (let yy = 4; yy < 512; yy += 12) for (let xx = (yy / 12) % 2 ? 4 : 10; xx < 1024; xx += 12) { x.beginPath(); x.arc(xx, yy, 2, 0, 6.29); x.fill(); }
    for (let i = 0; i < 1024; i += 48) { x.fillStyle = (i / 48) % 2 ? '#ffd23f' : '#e63b2e'; x.fillRect(i, 0, 24, 14); x.fillRect(i + 24, 498, 24, 14); }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '400 230px "Dela Gothic One", sans-serif';
    x.fillStyle = '#e63b2e'; x.fillText('踊り', 524, 210);
    x.fillStyle = '#ffd23f'; x.fillText('踊り', 512, 198);
    x.font = '400 92px "Dela Gothic One", sans-serif';
    x.lineWidth = 14; x.strokeStyle = '#15172b'; x.strokeText('DANCE-OFF', 512, 405);
    x.fillStyle = '#fbf8f0'; x.fillText('DANCE-OFF', 512, 405);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return (this._sign = t);
  }

  // ---------------------------------------------------------------- UI
  mountUI() {
    if (!document.getElementById('dance-css')) { const st = document.createElement('style'); st.id = 'dance-css'; st.textContent = CSS; document.head.appendChild(st); }
    const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    this.hud(`<span class="pill dn-pill"><small>YOU</small><span id="dn-me">0</span></span><span class="pill dn-pill riv"><small>${esc(this.rival.c.design.name)}</small><span id="dn-rv">0</span></span>`);
    const root = this.root = document.createElement('div');
    root.className = 'dn-root';
    const recs = [0, 1, 2, 3].map((d) => `<div class="dn-rec" data-d="${d}" style="left:calc(8px + ${d} * (var(--c) + var(--g)));--k:${NOTE_COL[d]}"><span style="display:contents">${ARROW.replace('<svg', `<svg style="transform:rotate(${ROT[d]}deg)"`)}</span></div>`).join('');
    const showHint = !hintShown; hintShown = true;
    root.innerHTML = `<div class="dn-judge"><b id="dn-j" style="visibility:hidden">.</b><i id="dn-c"></i></div>
      <div class="dn-lane" id="dn-lane"><div class="dn-bar"></div>${recs}<div id="dn-notes"></div></div>
      ${showHint ? `<div class="dn-hint" id="dn-hint"><span class="dn-key"><kbd>←↑↓→</kbd>/<kbd>WASD</kbd> on the beat · <kbd>SPACE</kbd> on JUMP bars</span><span class="dn-touch">Flick the stick or tap the arrows · 跳 on JUMP bars</span></div>` : ''}`;
    document.getElementById('hud').appendChild(root);
    this.ui = {
      lane: root.querySelector('#dn-lane'), notes: root.querySelector('#dn-notes'), j: root.querySelector('#dn-j'), c: root.querySelector('#dn-c'),
      recs: [...root.querySelectorAll('.dn-rec')], hint: root.querySelector('#dn-hint'), me: document.getElementById('dn-me'), rv: document.getElementById('dn-rv'),
    };
    this.ui.recs.forEach((el) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.song.resume(); this.press(+el.dataset.d, this.posNow()); }));
    this.measure();
  }

  measure() {
    const cs = getComputedStyle(this.root);
    this.cpx = parseFloat(cs.getPropertyValue('--c')) || 50;
    this.gpx = parseFloat(cs.getPropertyValue('--g')) || 6;
    this.hpx = this.ui.lane.clientHeight || 200;
  }

  resize() { super.resize(); this.measure(); }

  judgeText(text, cls, combo) {
    const j = this.ui.j;
    j.textContent = text; j.className = cls; j.style.visibility = '';
    j.style.animation = 'none'; void j.offsetWidth; j.style.animation = '';
    this.ui.c.textContent = combo >= 3 ? `${combo} COMBO` : '';
  }

  flashRec(dir, hit) {
    const els = dir === J ? this.ui.recs : [this.ui.recs[dir]];
    for (const el of els) {
      el.classList.add(hit ? 'hit' : 'on');
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hit', 'on'), hit ? 140 : 90);
    }
  }

  noteEl(n) {
    const el = document.createElement('div');
    if (n.dir === J) { el.className = 'dn-note jump'; el.innerHTML = '<b>JUMP!</b>'; }
    else { el.className = 'dn-note'; el.style.setProperty('--k', NOTE_COL[n.dir]); el.innerHTML = ARROW.replace('<svg', `<svg style="transform:rotate(${ROT[n.dir]}deg)"`); }
    this.ui.notes.appendChild(el);
    return el;
  }

  // ---------------------------------------------------------------- timing
  posNow() {
    const s = this.song;
    if (s.running) return s.ac.currentTime - s.lat - s.t0;
    return this.pos;
  }

  tickClock(dt) {
    const s = this.song;
    if (s.running) this.pos = s.ac.currentTime - s.lat - s.t0;
    else { this.pos += dt; if (s.ac) s.t0 = s.ac.currentTime - s.lat - this.pos; }
  }

  // ---------------------------------------------------------------- input + judging
  press(dir, at) {
    if (this.state === 'done' || at < -1) return;
    this.flashRec(dir, false);
    let best = null, bestErr = 1;
    for (let i = this.missIdx; i < this.chart.length; i++) {
      const n = this.chart[i];
      if (n.t - at > GOOD) break;
      if (n.res || n.dir !== dir) continue;
      const e = Math.abs(n.t - at);
      if (e <= GOOD && e < bestErr) { best = n; bestErr = e; }
    }
    const P = this.dancers[0];
    if (!best) { this.move(P, dir, 0.45); return; }
    const perfect = bestErr <= PERFECT;
    best.res = perfect ? 'perfect' : 'good';
    const S = this.me;
    S.combo++; S.max = Math.max(S.max, S.combo); S.cd = Math.max(0, S.cd - 1);
    if (perfect) S.perfect++; else S.good++;
    const base = (perfect ? 100 : 50) * (dir === J ? 2 : 1);
    S.pts += Math.round(base * (1 + Math.min(S.combo, 50) / 100) * this.mult);
    this.judgeText(perfect ? 'PERFECT' : 'GOOD', perfect ? '' : 'good', S.combo);
    this.flashRec(dir, true);
    this.song.tick(perfect);
    if (best.el) { best.el.remove(); best.el = null; }
    this.move(P, dir, perfect ? 1 : 0.75);
    this.flash = Math.min(1.5, this.flash + (perfect ? 0.7 : 0.4));
    const b = this.player;
    if (perfect || dir === J) this.fx.emit(b.x, STAGE + 0.15, b.z, { count: dir === J ? 46 : 10, colors: PAL, speed: dir === J ? 6 : 3, up: dir === J ? 7 : 3, gravity: 9, size: 0.22, life: 0.7 });
    if (S.combo > 0 && S.combo % 25 === 0) { this.banner(`${S.combo} COMBO!`, 700); babble(1.4, 3, 1, this.player.c.design.voice); }
    if (this.ui.hint && S.perfect + S.good >= 6) { this.ui.hint.classList.add('off'); }
  }

  miss(n) {
    n.res = 'miss';
    const S = this.me; S.miss++;
    if (n.el) n.el.classList.add('gone');
    if (S.combo >= 5 && S.cd <= 0 && Math.random() < this.saveChance) {
      S.saves++; S.cd = 8;
      this.judgeText('RECOVERED!', 'rec', S.combo);
      this.move(this.dancers[0], L + (Math.random() < 0.5 ? 0 : 3), 0.4);
      return;
    }
    if (S.combo >= 5) S.breaks++;
    S.combo = 0;
    this.judgeText('MISS', 'miss', 0);
    this.stumble(this.dancers[0]);
  }

  rivalTurn(n) {
    const A = this.rival.ai, V = this.rv;
    const pPerf = 0.3 + (A.skill - 0.82) * 1.5, pGood = 0.5 - (A.skill - 0.82);
    const roll = Math.random();
    const D = this.dancers[1];
    if (roll < pPerf + pGood) {
      const perfect = roll < pPerf;
      V.combo++; V.max = Math.max(V.max, V.combo); if (perfect) V.perfect++; else V.good++;
      V.pts += Math.round((perfect ? 100 : 50) * (n.dir === J ? 2 : 1) * (1 + Math.min(V.combo, 50) / 100) * this.rivMult);
      this.move(D, n.dir === J ? J : (Math.random() * 4) | 0, perfect ? 1 : 0.75);
      if (n.dir === J) this.fx.emit(this.rival.x, STAGE + 0.15, this.rival.z, { count: 30, colors: PAL, speed: 5, up: 6, gravity: 9, size: 0.2, life: 0.7 });
    } else {
      V.miss++; V.combo = 0; this.stumble(D);
      if (Math.random() < 0.3) babble(1.1, 2, 0, this.rival.c.design.voice);
    }
  }

  // ---------------------------------------------------------------- moves
  move(Dn, dir, k = 1) {
    // lean/twist are viewer-relative: + = toward the viewer's right
    if (dir === L || dir === R) {
      const s = dir === L ? -1 : 1;
      Dn.leanV += s * 7 * k; Dn.twistV += s * 9 * k;
      Dn.lr = (Dn.lr || 0) + 1;
      if (k >= 0.75 && Dn.lr % 4 === 0) this.spin(Dn, s, 0.42);
    } else if (dir === U) {
      if (Dn.y < 0.05) Dn.vy = 3.6 + 1.6 * k;
      Dn.celebT = 0.35;
    } else if (dir === D) {
      Dn.sqV += 6 * k; Dn.bowV -= 5 * k;
    } else if (dir === J) {
      Dn.vy = 7.5 + Dn.b.c.height * 0.5; this.spin(Dn, Math.random() < 0.5 ? -1 : 1, 0.62); Dn.celebT = 0.6;
      if (Dn.b === this.player) sfx.boing(1.2);
    }
  }

  spin(Dn, s, dur) { Dn.spinFrom = Dn.spin; Dn.spinTo = Dn.spin + s * Math.PI * 2; Dn.spinT = 0; Dn.spinDur = dur; }

  stumble(Dn) { Dn.b.stun = 0.7; Dn.wob = 1; Dn.sqV -= 2; }

  animate(Dn, dt, groove) {
    const b = Dn.b, c = b.c;
    const spring = (v, vel, K = 150, C = 10) => { vel += (-K * v - C * vel) * dt; return [v + vel * dt, vel]; };
    [Dn.lean, Dn.leanV] = spring(Dn.lean, Dn.leanV);
    [Dn.twist, Dn.twistV] = spring(Dn.twist, Dn.twistV, 110, 9);
    [Dn.bow, Dn.bowV] = spring(Dn.bow, Dn.bowV, 160, 11);
    [Dn.sq, Dn.sqV] = spring(Dn.sq, Dn.sqV, 220, 12);
    if (Dn.spinT < 1) {
      Dn.spinT = Math.min(1, Dn.spinT + dt / Dn.spinDur);
      const e = 1 - Math.pow(1 - Dn.spinT, 3);
      Dn.spin = Dn.spinFrom + (Dn.spinTo - Dn.spinFrom) * e;
      if (Dn.spinT >= 1) Dn.spin = 0;
    }
    // hops
    if (Dn.y > 0 || Dn.vy > 0) {
      Dn.vy -= 26 * dt; Dn.y += Dn.vy * dt;
      if (Dn.y <= 0) {
        Dn.y = 0;
        if (Dn.vy < -2) { c.motion.land = Math.min(1, -Dn.vy / 9); Dn.sqV += -Dn.vy * 0.25; this.world.dust(b.x, STAGE, b.z); }
        Dn.vy = 0;
      }
    }
    Dn.wob = Math.max(0, Dn.wob - dt * 1.4);
    Dn.celebT = Math.max(0, Dn.celebT - dt);
    b.y = STAGE + Dn.y; b.vy = Dn.vy; b.grounded = Dn.y <= 0.001;
    b.stun = Math.max(0, b.stun - dt);
    b.heading = Dn.base + Dn.twist * -0.9 + Dn.spin + Math.sin(this.time * 17) * 0.12 * Dn.wob;
    b.sync();
    // a creature faces local +x: roll (x) is a sideways lean, pitch (z) is a bow
    const sway = groove * Math.sin(this.beatPos * Math.PI) * 0.07;
    c.tilt.rotation.x = -(Dn.lean + sway) + Math.sin(this.time * 21) * 0.25 * Dn.wob;
    c.tilt.rotation.z = Dn.bow;
    const sq = clamp(Dn.sq, -0.3, 0.45);
    c.group.scale.set(1 + sq * 0.45, 1 - sq, 1 + sq * 0.45);
    c.motion.speed = groove * 0.9;
    if (this.state !== 'done') c.motion.celebrate = Dn.celebT > 0 ? 1 : 0;
  }

  // ---------------------------------------------------------------- cameras
  get frameScale() {
    const h = Math.max(this.player.c.height || 1, this.rival.c.height || 1);
    return clamp(h / 1.3, 0.85, 1.6);
  }

  camWant() {
    const fs = this.frameScale, asp = this.camera.aspect, portrait = asp < 1;
    const half = this.gap + 0.95 * fs, tanV = Math.tan((21 * Math.PI) / 180);
    const dist = Math.max(5.8 * fs, (half / (tanV * asp)) * 0.97);
    const sway = Math.sin(this.pos * 0.35) * 0.6 * Math.min(1, asp);
    const mid = STAGE + 0.45 * fs;
    return { pos: new THREE.Vector3(sway, STAGE + dist * 0.2, dist), look: new THREE.Vector3(sway * 0.3, mid - dist * (portrait ? 0.1 : 0.07), 0) };
  }

  introCam(k) {
    const w = this.camWant();
    const e = 1 - Math.pow(1 - clamp(k, 0, 1), 3);
    const a = (1 - e) * 1.4;
    const far = new THREE.Vector3(Math.sin(a) * 22, STAGE + 9, Math.cos(a) * 22);
    this.camera.position.lerpVectors(far, w.pos, e);
    const look = new THREE.Vector3(0, STAGE + 1.5, -1).lerp(w.look, e);
    this.camera.lookAt(look);
  }

  followCam(dt) {
    const w = this.camWant();
    if (!this.camPos) this.camPos = this.camera.position.clone();
    this.camPos.lerp(w.pos, Math.min(1, dt * 3));
    if (!this.camLook) this.camLook = w.look.clone();
    this.camLook.lerp(w.look, Math.min(1, dt * 3));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------------------------------------------------------------- loop
  update(dt, t) {
    this.clock += dt;
    this.water?.update(t);
    if (this.firstFrame) { this.firstFrame = false; playMusic(null); }  // hush the island band; setMode('island') brings it back
    this.song.syncMute();
    this.tickClock(dt);
    if (this.state === 'intro') {
      this.introCam(1 + this.pos / INTRO);
      if (this.pos >= -0.02) { this.state = 'play'; this.camPos = this.camera.position.clone(); }
    } else this.followCam(dt);
    if (this.state !== 'intro') this.time += dt;
    this.step(dt, this.state === 'done');
    for (const b of this.all) b.c.update(dt);
    this.lights.follow(this.player.c.group.position);
    PUSH.value.set(this.player.x, this.player.z, 1.4, 1);
    this.fx.update(dt);
  }

  cue(name, fn) { if (!this.cues[name]) { this.cues[name] = 1; fn(); } }

  step(dt, after) {
    const pos = this.pos;
    this.beatPos = pos / SPB;
    const beat = Math.floor(this.beatPos), frac = this.beatPos - beat;
    const live = pos > -0.1 && beat < END_BEAT;
    // callouts
    if (pos > -INTRO + 0.15) this.cue('mult', () => this.banner(`BIG MOVES ×${this.mult.toFixed(this.mult * 10 % 1 ? 2 : 1)}`, 1500));
    if (beat >= 0) this.cue('ready', () => this.banner('Ready…', SPB * 2600));
    if (beat >= 3) this.cue('go', () => { this.banner('GO!', SPB * 1100); babble(1.3, 2, 1, this.player.c.design.voice); });
    if (beat >= 16 && this.ui.hint) this.cue('hint', () => this.ui.hint.classList.add('off'));

    // input: synthetic keys (tests) and the phone stick, edge-triggered
    if (!after) {
      const I = this.app.input;
      for (const k of I.pressed) if (KEYMAP[k] != null && !this.kbSeen.has(k)) this.press(KEYMAP[k], pos);
      this.kbSeen.clear();
      if (I.touchJumpPressed) this.press(J, pos);
      const sx = I.stick.x, sy = I.stick.y, m = Math.hypot(sx, sy);
      if (this.flick.armed && m >= 0.6) {
        this.flick.armed = false;
        this.press(Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? R : L) : (sy > 0 ? U : D), pos);
      } else if (!this.flick.armed && m < 0.35) this.flick.armed = true;
    }

    // misses + the rival's turns
    while (this.missIdx < this.chart.length) {
      const n = this.chart[this.missIdx];
      if (n.res) { this.missIdx++; continue; }
      if (pos - n.t > GOOD && !after) { this.miss(n); this.missIdx++; continue; }
      break;
    }
    while (this.rivIdx < this.chart.length && pos >= this.chart[this.rivIdx].t && !after) this.rivalTurn(this.chart[this.rivIdx++]);

    // notes on the lane
    this.drawNotes(pos);

    // the beat: dancers bob, the floor flashes
    if (live && beat !== this.beat) {
      this.beat = beat;
      for (const Dn of this.dancers) Dn.sqV += 1.6;
      this.paintFloor(beat);
      for (const cn of this.cones) cn.scale.set(1, 1.6, 1);
    }
    const pulse = live ? Math.exp(-frac * 5) : 0.15;
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const T of this.tiles) T.m.emissiveIntensity = T.on ? 0.25 + 1.5 * pulse + this.flash * 0.4 : 0.05 + this.flash * 0.15;
    this.spots.forEach((L, i) => { L.intensity = 6 + (live ? 40 * Math.exp(-((this.beatPos + i * 0.5) % 2) * 3) : 4) + this.flash * 25; });
    const eighth = Math.floor(this.beatPos * 2);
    this.bulbMats.forEach((m, i) => { m.emissiveIntensity = live ? ((eighth + i) % 2 ? 1.6 : 0.15) : 0.8; });
    for (const cn of this.cones) cn.scale.y += (1 - cn.scale.y) * Math.min(1, dt * 14);
    this.ball.rotation.y += dt * 0.8;
    this.beams.forEach((m, i) => {
      const s = i < 2 ? 1 : -1;
      m.rotation.z = s * (0.35 + Math.sin(pos * 0.9 + i * 1.3) * 0.3);
      m.rotation.x = -(0.45 + Math.sin(pos * 0.7 + i) * 0.15);
      m.material.opacity = 0.06 + 0.1 * pulse;
    });

    const groove = this.state === 'play' && pos > 0 && beat < END_BEAT ? 1 : 0;
    for (const Dn of this.dancers) this.animate(Dn, dt, groove);
    if (after && this.won) this.player.c.motion.celebrate = 1;

    // HUD
    if (this.ui.me && this.shownMe !== this.me.pts) { this.shownMe = this.me.pts; this.ui.me.textContent = this.me.pts; }
    if (this.ui.rv && this.shownRv !== this.rv.pts) { this.shownRv = this.rv.pts; this.ui.rv.textContent = this.rv.pts; }

    if (!after && this.state === 'play' && pos > this.lastT + 0.45 && this.missIdx >= this.chart.length) this.done();
  }

  paintFloor(beat) {
    const bar = Math.floor(beat / 4), sec = bar < 1 ? 'count' : bar > SONG_BARS ? 'end' : section(bar);
    const col = PAL[bar % 4], col2 = PAL[(bar + 2) % 4];
    for (const T of this.tiles) {
      let on = 0, c = col;
      if (sec === 'count') { on = T.i === 3 - (beat % 4) + 1 || T.i === 3 + (beat % 4) - 1 ? 1 : 0; c = beat % 4 === 3 ? '#ffd23f' : '#fbf8f0'; }
      else if (sec === 'intro' || sec === 'verse') { on = (T.i + T.j + beat) % 2 === 0 ? 1 : 0; c = (T.i + T.j) % 4 < 2 ? col : col2; }
      else if (sec === 'chorus') { on = (T.i + beat) % 3 === 0 || (6 - T.i + beat) % 3 === 0 ? 1 : 0; c = PAL[(T.i + bar) % 4]; }
      else if (sec === 'finale') { on = Math.random() < 0.55 ? 1 : 0; c = PAL[(Math.random() * 4) | 0]; }
      else { on = 1; c = PAL[(T.i + T.j) % 4]; }
      T.on = on; if (c !== T.col) { T.col = c; T.m.emissive.set(c); }
    }
  }

  drawNotes(pos) {
    const H = this.hpx, C = this.cpx, G = this.gpx;
    const recTop = H - 8 - C;
    // spawn notes as they come into view
    while (this.spawnIdx < this.chart.length && this.chart[this.spawnIdx].t - pos < APPROACH) {
      const n = this.chart[this.spawnIdx++]; if (!n.res) n.el = this.noteEl(n);
    }
    for (let i = this.missIdx > 0 ? Math.max(0, this.missIdx - 6) : 0; i < this.spawnIdx; i++) {
      const n = this.chart[i]; if (!n.el) continue;
      const d = n.t - pos;
      if (d < -0.35) { n.el.remove(); n.el = null; continue; }
      const y = recTop - (d / APPROACH) * (recTop + C);
      const x = n.dir === J ? 8 : 8 + n.dir * (C + G);
      n.el.style.transform = `translate3d(${x}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  // ---------------------------------------------------------------- results
  done() {
    if (this.state === 'done') return;
    const me = this.player, S = this.me, V = this.rv;
    const won = S.pts > V.pts;
    this.won = won;
    const nm = me.c.design.name, rn = this.rival.c.design.name;
    const rows = [
      { b: me, pts: S.pts, me: true, name: nm + ' (you)' },
      { b: this.rival, pts: V.pts, me: false, name: rn },
    ].sort((a, b) => b.pts - a.pts).map((r, i) => ({ place: i + 1, name: r.name, score: r.pts + ' pts', me: r.me }));
    const total = this.chart.length;
    const line = `<b>${S.perfect}</b> perfect · <b>${S.good}</b> good · <b>${S.miss}</b> miss · best combo <b>${S.max}</b>${S.saves ? ` · ${S.saves} recovered` : ''}.`;
    let advice;
    if (won) {
      advice = S.miss === 0 ? `A full combo! ${nm} has been asked to stop, politely, by the other dancers. ${line}`
        : `${nm} out-grooved ${rn}! The seagulls are still clapping. ${line}`;
      if (this.mult < 1.15) advice += ' Want even more points? Draw <b>longer legs or arms</b> for BIG MOVES.';
    } else {
      const acc = (S.perfect + S.good) / total;
      if (acc < 0.6) advice = `${nm} danced to a different song. Hit each arrow as it lands in the outlines; the kick drum is your friend. ${line}`;
      else if (this.mult < 1.15 && this.rivMult > this.mult) advice = `${rn}'s moves were simply bigger (×${this.rivMult} vs your ×${this.mult}). Draw <b>longer legs</b> or <b>long arms</b> for BIG MOVES. ${line}`;
      else if (S.breaks >= 2 && me.c.stats.balance < 6) advice = `You dropped your combo ${S.breaks}×. A steadier body recovers from slips: draw <b>wider feet</b> or a <b>lower belly</b> for more Balance (yours: ${me.c.stats.balance.toFixed(1)}). ${line}`;
      else if (this.mult < 1.25) advice = `So close! Long combos multiply your points, and <b>longer legs or arms</b> make bigger moves (yours: ×${this.mult}). ${line}`;
      else advice = `So close! Keep that combo alive: long combos are worth up to 1.5× per note. ${line}`;
    }
    for (const n of this.chart) if (n.el) { n.el.remove(); n.el = null; }
    if (this.ui.hint) this.ui.hint.classList.add('off');
    this.root.style.transition = 'opacity .6s'; this.root.style.opacity = '0';
    if (!won) this.dancers[0].b.stun = 1.2;
    this.finish(won, rows, advice, { score: S.pts, text: S.pts + ' pts' });
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.song?.stop();
    this.root?.remove(); this.root = null;
    for (const b of this.all) { b.c.group.scale.set(1, 1, 1); b.c.tilt.rotation.set(0, 0, 0); b.c.motion.dizzy = 0; b.c.motion.land = 0; b.c.motion.speed = 0; }
    this.player.stun = 0;
    super.dispose();
  }
}
