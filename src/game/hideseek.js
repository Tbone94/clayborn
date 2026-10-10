// Hide & Seek, played right on the island: the locals hide behind trees, you go find them.
// Found monsters tag along behind you, so by the end you're leading a little parade.
import { sfx, babble, playMusic } from '../fx/audio.js';
import { escapeHtml } from '../ui/creator.js';

const $ = (id) => document.getElementById(id);
const TIME = 90, FIND_R = 2.4;

export class HideSeek {
  constructor(island, spot) {
    this.island = island; this.spot = spot;
    this.time = TIME; this.rustleT = 4; this.done = false;
    const I = island, P = I.player;
    // the locals (not your own monsters) do the hiding
    this.hiders = I.garden.roamers.filter((r) => !r.pet).slice(0, 4);
    const spots = I.hideSpots.filter((s) => !I.inGloom(s.x, s.z) && Math.hypot(s.x - P.x, s.z - P.z) > 9 && Math.hypot(s.x, s.z) < 27).sort(() => Math.random() - 0.5);
    const picked = [];
    for (const s of spots) {
      if (picked.length >= this.hiders.length) break;
      if (picked.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 9)) continue;
      picked.push(s);
    }
    this.hiders.forEach((r, i) => {
      const s = picked[i] || spots[i];
      // tuck in behind the trunk, on the far side from where you start
      const a = Math.atan2(s.z - P.z, s.x - P.x), x = s.x + Math.cos(a) * 1.1, z = s.z + Math.sin(a) * 1.1;
      r.hiding = true; r.found = false; r.state = 'idle';
      r.b.x = x; r.b.z = z; r.b.y = I.world.height(x, z); r.b.vx = r.b.vz = r.b.vy = 0;
      r.b.heading = Math.atan2(-(P.z - z), P.x - x);
      r.emote.visible = false;
    });
    playMusic('event');
    this.hud();
    I.banner?.('READY OR NOT!', 1400);
  }

  hud() {
    const n = this.hiders.filter((r) => r.found).length;
    const h = $('event-hud');
    h.innerHTML = `<span class="pill">Found ${n}/${this.hiders.length}</span><span class="pill">${Math.ceil(this.time)}</span>`;
    h.classList.remove('hidden');
  }

  update(dt) {
    if (this.done) return;
    const I = this.island, P = I.player;
    this.time -= dt;
    // a giggle and a rustle of leaves now and then; after a while the hint gets louder
    this.rustleT -= dt;
    const left = this.hiders.filter((r) => !r.found);
    if (this.rustleT <= 0 && left.length) {
      const r = left[(Math.random() * left.length) | 0];
      this.rustleT = 5 + Math.random() * 3;
      I.fx.emit(r.b.x, r.b.y + 1.2, r.b.z, { count: 16, colors: ['#7fb34a', '#5d8f32', '#c9a27e'], speed: 2.2, up: 3, gravity: 3, size: 0.3, life: 1.2 });
      const d = Math.hypot(r.b.x - P.x, r.b.z - P.z);
      if (d < 30) babble(2.1, 2, 1, r.c.design.voice);
      if (this.time < TIME - 45) r.say('what', 1.2);
    }
    for (const r of left) if (Math.hypot(r.b.x - P.x, r.b.z - P.z) < FIND_R) this.find(r);
    if (left.length && this.time <= 0) { this.end(false); return; }
    this.hud();
  }

  find(r) {
    const I = this.island;
    r.found = true; r.hiding = false;
    r.say('bang', 1.6); r.voice(4, 1);
    r.b.vy = 6; r.b.grounded = false;
    // tag along behind you for the rest of the game
    r.state = 'follow'; r.followT = 999;
    I.fx.emit(r.b.x, r.b.y + 1, r.b.z, { count: 30, colors: ['#ffe680', '#ffffff', '#9bc53d', '#ff6fa8'], speed: 4, up: 5, gravity: 6, size: 0.3, life: 1.2 });
    sfx.chime();
    const left = this.hiders.filter((h) => !h.found).length;
    I.banner?.(left ? `FOUND ${r.name.toUpperCase()}!` : 'FOUND EVERYONE!', 1100);
    this.hud();
    if (!left) setTimeout(() => this.end(true), 900);
  }

  end(won) {
    if (this.done) return;
    this.done = true;
    const I = this.island, app = I.app;
    const found = this.hiders.filter((r) => r.found).length, left = Math.max(0, Math.round(this.time));
    for (const r of this.hiders) {
      if (!r.found) { r.hiding = false; r.say('bang', 1.4); r.b.vy = 5; r.b.grounded = false; r.state = 'idle'; r.timer = 2; }
      else { r.followT = 4; }
    }
    if (won) { sfx.fanfare(); I.player.c.motion.celebrate = 1; setTimeout(() => { I.player.c.motion.celebrate = 0; }, 2500); }
    else { sfx.sad(); I.banner?.("TIME'S UP!", 1400); }
    playMusic('island');
    const score = found * 100 + (won ? left : 0);
    const rec = I.noteRecord('hideseek', score, won ? `${left}s to spare` : `${found}/${this.hiders.length} found`);
    setTimeout(() => {
      $('event-hud').classList.add('hidden');
      const rows = this.hiders.map((r, i) => `<div class="${r.found ? 'me' : ''}"><span><i>${i + 1}</i>${escapeHtml(r.name)}</span><span>${r.found ? 'found!' : 'still hiding'}</span></div>`).join('');
      app.modal(`<h2>${won ? '<span class="jp">見つけた</span>Found everyone!' : '<span class="jp">惜しい</span>So close!'}</h2>
        <div class="results">${rows}</div>
        <p class="record">${rec.isNew ? '★ NEW RECORD' : 'Record'}: <b>${escapeHtml(rec.best)}</b></p>
        <p>${won ? `${left} seconds to spare. Nobody can hide from ${escapeHtml(I.player.c.design.name)}.` : 'Tip: listen for giggles and watch for <b>rustling leaves</b>. A faster monster covers more ground.'}</p>
        <div class="row"><button class="btn primary" id="r-retry">Play again</button><button class="btn ghost" id="r-back">Back to island</button></div>`);
      $('r-back').onclick = () => app.closeModal();
      $('r-retry').onclick = () => { app.closeModal(); I.startHideSeek(this.spot); };
      I.hideSeek = null;
      I.onGameResult('hideseek', { won, left, score }, I.player.c);
    }, won ? 1600 : 1400);
  }

  // leaving early (into an event or the Mold Lab): everyone just comes out
  abort() {
    if (this.done) return;
    this.done = true;
    for (const r of this.hiders) { r.hiding = false; r.state = 'idle'; r.timer = 1; }
    $('event-hud').classList.add('hidden');
    this.island.hideSeek = null;
  }
}
