// Shared event plumbing: arena scene, rivals, countdown, results + design advice.
import * as THREE from 'three';
import { heightTexture, Particles } from '../scenes/common.js';
import { setupWorld, makeWater, updateTrees, PUSH } from '../world/nature.js';
import { Body } from '../game/body.js';
import { Creature } from '../creature/creature.js';
import { randomDesign } from '../creature/generator.js';
import { sfx, babble } from '../fx/audio.js';
import { escapeHtml } from '../ui/creator.js';

const $ = (id) => document.getElementById(id);
let attempt = 0;

export class EventBase {
  constructor(app, island, creature, idx, { sky = ['#86c5e8', '#ffe0b8'], rivals = 3, rivalOpts = [] } = {}) {
    this.app = app; this.island = island; this.idx = idx;
    const s = this.scene = new THREE.Scene();
    void sky;
    this.lights = setupWorld(s, { fog: [110, 380], shadowSize: 22 });
    this.fx = new Particles(s);
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 700);
    this.state = 'intro'; this.clock = 0; this.time = 0;
    this.world = {
      height: (x, z) => this.height(x, z), water: 0,
      splash: (x, y, z) => { this.fx.emit(x, y, z, { count: 26, color: '#e8fbff', speed: 4, up: 6, gravity: 14, size: 0.35, life: 0.8 }); sfx.splash(); },
      dust: (x, y, z) => this.fx.emit(x, y + 0.1, z, { count: 8, color: '#efe0c4', speed: 2.5, up: 1, gravity: 2, size: 0.3, life: 0.5 }),
    };
    this.player = new Body(creature);
    this.player.isPlayer = true;
    s.add(creature.group);
    attempt++;
    this.rivals = [];
    for (let i = 0; i < rivals; i++) {
      const d = randomDesign((idx * 1000 + attempt * 37 + i * 7) * 2654435761 % 1e9, rivalOpts[i] || {});
      const c = new Creature(d, { detail: 46 });
      const b = new Body(c); b.ai = { skill: 0.82 + Math.random() * 0.14, t: 0 };
      s.add(c.group); this.rivals.push(b);
    }
    this.all = [this.player, ...this.rivals];
    this.track = { swim: 0, air: 0, falls: 0, bonks: 0 };
  }

  makeWater(fn, box) {
    const hTex = heightTexture(fn, box[0], box[1], box[2], 320);
    this.water = makeWater(this.scene, { size: 1400, level: 0, hTex, hBox: [box[0], box[1], box[2], box[2]] });
  }

  hud(html) { const h = $('event-hud'); h.innerHTML = html; h.classList.remove('hidden'); }
  banner(text, ms = 900) {
    const b = $('banner'); b.textContent = text; b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this._bt); if (ms) this._bt = setTimeout(() => b.classList.add('hidden'), ms);
  }

  update(dt, t) {
    this.clock += dt;
    this.water?.update(t);
    if (this.state === 'intro') {
      this.introCam?.(this.clock / 2.2);
      if (this.clock > 2.2) { this.state = 'count'; this.clock = 0; this.lastCount = 4; }
    } else if (this.state === 'count') {
      const n = 3 - Math.floor(this.clock);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; this.banner(String(n), 800); sfx.count(false); }
      if (this.clock >= 3) { this.state = 'play'; this.clock = 0; this.banner('GO!', 700); sfx.count(true); babble(1.3, 2, 1); }
      this.followCam(dt);
    } else if (this.state === 'play') {
      this.time += dt;
      this.step(dt);
      this.followCam(dt);
    } else if (this.state === 'done') {
      this.step(dt, true);
      this.followCam(dt);
    }
    for (const b of this.all) {
      b.c.update(dt);
      if (this.state === 'play' && b === this.player) {
        if (b.swimming) this.track.swim += dt;
        if (!b.grounded && !b.swimming) this.track.air += dt;
      }
    }
    this.lights.follow(this.player.c.group.position);
    updateTrees(t);
    PUSH.value.set(this.player.x, this.player.z, 1.4, 1);
    this.fx.update(dt);
  }

  // controls → world-space move vector for a camera looking along +x
  playerCtl(lockForward = false) {
    const I = this.app.input;
    if (this.state !== 'play') return { mx: 0, mz: 0 };
    return { mx: lockForward ? Math.max(0, I.moveY) : I.moveY, mz: I.moveX, jump: I.jump, jumpPressed: I.jumpPressed, dashPressed: I.dashPressed };
  }

  finish(won, rows, advice) {
    if (this.state === 'done') return;
    this.state = 'done';
    const p = this.player.c;
    if (won) { p.motion.celebrate = 1; sfx.fanfare(); this.banner('YOU WIN!', 0); babble(1.4, 6, 1); this.confetti(); }
    else { sfx.sad(); this.banner('So close!', 1400); }
    setTimeout(() => {
      $('banner').classList.add('hidden');
      const list = rows.map((r) => `<div class="${r.me ? 'me' : ''}"><span><i>${r.place}</i>${escapeHtml(r.name)}</span><span>${r.score}</span></div>`).join('');
      this.app.modal(`<h2>${won ? '<span class="jp">浄化</span>Gloom cleansed!' : '<span class="jp">再挑戦</span>Not this time'}</h2>
        <div class="results">${list}</div>
        <p style="margin-top:14px">${advice}</p>
        <div class="row">
          ${won ? '' : '<button class="btn primary" id="r-retry">Retry</button>'}
          ${won ? '' : '<button class="btn yellow" id="r-edit">Redraw my monster</button>'}
          <button class="btn ${won ? 'primary' : 'ghost'}" id="r-back">Back to island</button>
        </div>`);
      const close = () => this.app.closeModal();
      $('r-back').onclick = () => { close(); this.island.endEvent(won, this.idx); };
      if (!won) {
        $('r-retry').onclick = () => { close(); this.island.endEvent(false, this.idx); setTimeout(() => this.island.startEvent(this.idx), 600); };
        $('r-edit').onclick = () => { close(); this.island.endEvent(false, this.idx); setTimeout(() => this.app.editMonster(), 900); };
      }
    }, won ? 2200 : 1500);
  }

  confetti() {
    const p = this.player;
    for (let k = 0; k < 4; k++) setTimeout(() => this.fx.emit(p.x, p.y + 1.5, p.z, { count: 50, colors: ['#ffe680', '#ef6f4f', '#5aa9e6', '#ef8fb5', '#7fc8a9'], speed: 7, up: 8, gravity: 7, size: 0.32, life: 1.8 }), k * 200);
  }

  dispose() {
    this.scene.remove(this.player.c.group);
    for (const r of this.rivals) { this.scene.remove(r.c.group); r.c.dispose(); }
  }

  // portrait screens need the camera further back
  get zk() { return this.camera.aspect < 1 ? 1.6 : 1; }

  resize() { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); }
}

// one-line, actionable "redraw it like this" advice from where you lost
export function adviceFor(stats, needs) {
  const tips = {
    speed: 'Try <b>longer legs</b> or a lighter body for more Speed',
    power: 'Add <b>more clay</b> (a chunkier body) for more Power',
    balance: 'Draw <b>wider feet</b> or a lower belly for more Balance',
    glide: 'Draw <b>big wings</b> to Glide further',
    swim: 'A <b>big tail</b> makes you Swim faster',
  };
  const weakest = needs.slice().sort((a, b) => stats[a] - stats[b])[0];
  return `${tips[weakest]} (yours: ${stats[weakest].toFixed(1)}). Open the sketchbook and try it.`;
}

export { Body };
