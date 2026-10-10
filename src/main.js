import * as THREE from 'three';
import { createRenderer } from './fx/render.js';
import { Studio } from './scenes/studio.js';
import { Island } from './scenes/island.js';
import { Creator, escapeHtml } from './ui/creator.js';
import { Creature } from './creature/creature.js';
import { randomDesign } from './creature/generator.js';
import { decodeDesign, encodeDesign, newDesign, cloneDesign } from './creature/design.js';
import { randomName } from './creature/generator.js';
import { initAudio, playMusic, sfx, setMuted, isMuted, babble, setAmbience } from './fx/audio.js';
import { Input } from './ui/input.js';
import { loadAssets } from './world/assets.js';
import { WORLD_TIME, cullNature } from './world/nature.js';

const $ = (id) => document.getElementById(id);

const QUIZ = [
  { q: 'Pick a snack.', a: [['Watermelon', { palette: 3 }], ['Hot pepper', { pattern: 'lava', palette: 11 }], ['Cake', { palette: 14, finish: 'vinyl' }], ['Raw fish', { tail: true, palette: 4, frame: 'serpent' }]] },
  { q: 'Your perfect weekend?', a: [['Running around', { frame: 'quad' }], ['A big nap', { frame: 'roller' }], ['Bug hunting', { frame: 'crawler' }], ['Flying kites', { frame: 'flyer', wings: true }]] },
  { q: 'Pick a sound.', a: [['Boing!', { eyes: 'googly', mouth: 'smile' }], ['ROAR', { mouth: 'fangs', eyes: 'angry' }], ['Squeak', { eyes: 'googly', eyeSize: 1.5, mouth: 'o' }], ['Hmmmm…', { eyes: 'sleepy', finish: 'felt' }]] },
];
const MAX_ROSTER = 10;

class App {
  constructor(gfx) {
    this.gfx = gfx;
    this.studio = new Studio(this);
    this.island = new Island(this);
    this.creator = new Creator(this);
    this.input = new Input(this);
    this.mode = null;
    this.player = null;
    this.save = this.loadSave();
    this.bind();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now(); this.t = 0;
    this.setMode('title');
    this.resize();
    this.gfx.renderer.setAnimationLoop(() => this.frame());
    setTimeout(() => { $('fade').classList.remove('cover'); $('fade').classList.add('out'); }, 250);
    this.refreshTitle();
    // deep link: #c=<code>
    const m = location.hash.match(/c=([^&]+)/);
    if (m) { try { this.pendingDesign = decodeDesign(decodeURIComponent(m[1])); } catch { /* ignore */ } }
  }

  loadSave() {
    let s;
    try { s = JSON.parse(localStorage.getItem('clayborn-save')); } catch { /* storage off */ }
    s = s || {};
    s.orbs = s.orbs || [];
    s.roster = s.roster || (s.design ? [s.design] : []);
    s.active = Math.min(s.active || 0, Math.max(0, s.roster.length - 1));
    delete s.design;
    return s;
  }
  persist() {
    try { localStorage.setItem('clayborn-save', JSON.stringify(this.save)); } catch { /* storage off */ }
  }

  rosterDesign(i) { return safeDecode(this.save.roster[i]); }
  petEntries() {
    return this.save.roster.map((code, index) => ({ code, index })).filter((e) => e.index !== this.save.active)
      .map((e) => ({ design: safeDecode(e.code), index: e.index })).filter((e) => e.design);
  }

  refreshTitle() {
    const has = this.save.roster.length > 0;
    $('btn-continue').classList.toggle('hidden', !has);
    $('code-no').textContent = has ? '04' : '03';
    if (has) { const d = this.rosterDesign(this.save.active); const n = this.save.roster.length - 1, nm = d ? d.name : 'Your monster'; $('continue-sub').textContent = n > 0 ? `${nm} and ${n} friend${n === 1 ? '' : 's'} are waiting` : `${nm} is waiting`; }
  }

  makeCreature(design, detail) { return new Creature(design, { detail }); }

  bind() {
    const unlock = () => initAudio();
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    $('btn-start').onclick = () => { sfx.click(); this.newMonster(); };
    $('btn-continue').onclick = () => { sfx.click(); this.continueGame(); };
    $('btn-new').onclick = () => { sfx.click(); this.newMonster(); };
    $('btn-exit').onclick = () => { sfx.click(); this.exitCreator(); };
    $('btn-quiz').onclick = () => { sfx.click(); this.startQuiz(); };
    $('btn-code').onclick = () => { sfx.click(); this.codeModal(); };
    $('btn-edit').onclick = () => { sfx.click(); this.editMonster(); };
    $('btn-credits').onclick = () => { sfx.click(); this.creditsModal(); };
    this.bindInstall();
    $('btn-mute').onclick = () => { setMuted(!isMuted()); $('btn-mute').textContent = isMuted() ? 'SND OFF' : 'SND ON'; };

    // creator turntable: drag spins, tap pokes (on the add-ons step, taps stick pieces on)
    const gl = $('gl');
    let down = null;
    gl.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'creator') return;
      const piece = this.creator.canvasDown(e);
      down = { x: e.clientX, y: e.clientY, moved: 0, piece };
      if (!piece) this.studio.dragging = true;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down || this.mode !== 'creator') return;
      if (down.piece) { this.creator.canvasMove(e); return; }
      const dx = e.clientX - down.x; down.moved += Math.abs(dx); down.x = e.clientX; this.studio.drag(dx);
    });
    window.addEventListener('pointerup', (e) => {
      if (!down) return;
      if (down.piece) this.creator.canvasUp(e);
      else if (this.mode === 'creator' && down.moved < 6 && this.creator.phase !== 'addons') this.studio.poke(e.clientX, e.clientY);
      down = null; this.studio.dragging = false;
    });
  }

  show(id) {
    for (const s of ['title', 'quiz', 'creator', 'hud']) $(s).classList.toggle('hidden', s !== id);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'title') {
      this.show('title');
      this.island.enterAttract();
      this.island.setPets(this.save.roster.map((c, index) => ({ design: safeDecode(c), index })).filter((e) => e.design));
      this.gfx.setLook({ blur: 0.35, focus: 0.55, band: 0.22, vignette: 0.3, bloom: 0.1, world: true });
      playMusic('calm');
    } else if (mode === 'quiz') {
      this.show('quiz');
    } else if (mode === 'creator') {
      this.show('creator');
      this.gfx.setLook({ blur: 0, vignette: 0.28, bloom: 0.25, world: false });
      playMusic('creator'); setAmbience(0);
      this.resize();
    } else if (mode === 'island') {
      this.show('hud');
      $('btn-edit').classList.remove('hidden');
      this.gfx.setLook({ blur: 0, vignette: 0.24, bloom: 0.1, world: true });
      playMusic('island'); setAmbience(0.05);
    } else if (mode === 'event') {
      this.show('hud');
      $('btn-edit').classList.add('hidden'); $('prompt').classList.add('hidden'); $('controls-hint').classList.add('hidden');
      this.gfx.setLook({ blur: 0, vignette: 0.26, bloom: 0.1, world: true });
      playMusic('event'); setAmbience(0.03);
    }
  }

  // diagonal toy-box wipe
  async transition(fn) {
    const f = $('fade');
    f.classList.add('no-anim'); f.classList.remove('out', 'cover'); void f.offsetWidth; f.classList.remove('no-anim');
    f.classList.add('cover');
    await new Promise((r) => setTimeout(r, 560));
    await fn();
    await new Promise((r) => setTimeout(r, 80));
    f.classList.remove('cover'); f.classList.add('out');
  }

  goCreator(design, { fresh = false, editIndex = null } = {}) {
    this.editIndex = editIndex;
    this.returnMode = this.mode === 'island' ? 'island' : 'title';
    this.transition(() => {
      this.creator.open(design, { fresh });
      this.setMode('creator');
    });
  }

  newMonster() {
    if (this.save.roster.length >= MAX_ROSTER) { this.toast(`The island fits ${MAX_ROSTER} monsters. Edit one instead!`); sfx.bonk(); return; }
    const d = this.pendingDesign || newDesign('biped');
    if (!this.pendingDesign) d.name = randomName(Math.random);
    const fresh = !this.pendingDesign; this.pendingDesign = null;
    this.goCreator(d, { fresh });
  }

  editMonster() { this.goCreator(cloneDesign(this.player.design), { editIndex: this.save.active }); }

  exitCreator() {
    this.transition(() => {
      this.studio.setCreature(null);
      if (this.returnMode === 'island' && this.player) this.setMode('island');
      else { this.refreshTitle(); this.setMode('title'); }
    });
  }

  continueGame() {
    const d = this.rosterDesign(this.save.active);
    if (!d) { this.newMonster(); return; }
    this.transition(() => {
      this.player = new Creature(d, { detail: 64 });
      this.island.enterPlay(this.player);
      this.island.setPets(this.petEntries());
      this.setMode('island');
      this.refreshOrbs();
    });
  }

  swapTo(roamer) {
    const old = this.player, idx = roamer.rosterIndex;
    if (idx < 0 || !old) return;
    sfx.chime(); roamer.voice(4, 1);
    this.transition(() => {
      const isl = this.island, P = isl.player;
      const x = P.x, z = P.z, oldIndex = this.save.active;
      isl.garden.remove(roamer);
      this.save.active = idx; this.persist();
      this.player = roamer.c;
      this.player.tilt.rotation.set(0, 0, 0);
      isl.enterPlay(this.player, { x: roamer.b.x, z: roamer.b.z });
      isl.garden.add(old, { pet: true, rosterIndex: oldIndex, x, z });
      this.toast(`Now playing as ${roamer.name}`);
    });
  }

  finishCreator() {
    const A = this.creator.creature.analysis;
    if (!A || A.empty) { this.toast('Draw a body (or a head) first!'); sfx.bonk(); return; }
    sfx.fanfare();
    const design = this.creator.design;
    this.transition(() => {
      this.creator.creature.build(design, 64);
      const old = this.player;
      this.player = this.creator.creature;
      this.studio.setCreature(null);
      this.player.group.scale.set(1, 1, 1);
      // save into the roster: replace when editing, append when new
      const code = encodeDesign(design);
      let idx = this.editIndex;
      if (idx == null || idx >= this.save.roster.length) { this.save.roster.push(code); idx = this.save.roster.length - 1; }
      else this.save.roster[idx] = code;
      this.save.active = idx;
      this.persist();
      this.island.enterPlay(this.player);
      if (old && old !== this.player) old.dispose();
      this.island.setPets(this.petEntries());
      this.setMode('island');
      this.refreshOrbs();
      setTimeout(() => babble(1.2, 5, 1), 600);
      if (this.save.roster.length === 1) setTimeout(() => this.toast('Every monster you make lives on this island'), 2500);
    });
  }

  refreshOrbs() {
    const el = $('orbs');
    const n = this.island.totalOrbs();
    el.innerHTML = '<span class="orb-label">Gloom cleansed</span>' + Array.from({ length: n }, (_, i) => `<i class="orb ${i < this.save.orbs.length ? 'on' : ''}"></i>`).join('');
  }

  startQuiz() {
    this.quizAns = [];
    this.setMode('quiz');
    this.quizStep(0);
  }
  quizStep(i) {
    if (i >= QUIZ.length) {
      const opts = Object.assign({}, ...this.quizAns);
      const d = randomDesign((Math.random() * 1e9) | 0, opts);
      sfx.chime();
      this.goCreator(d);
      setTimeout(() => this.toast(`Meet ${d.name}! Tweak anything you like.`), 900);
      return;
    }
    const Q = QUIZ[i];
    $('quiz-q').textContent = Q.q;
    $('quiz-opts').innerHTML = '';
    Q.a.forEach(([label, o], k) => {
      const b = document.createElement('button'); b.className = 'btn';
      b.innerHTML = `<span class="opt-letter">${'ABCD'[k]}</span>${label}`;
      b.onclick = () => { sfx.pop(1 + i * 0.2); this.quizAns.push(o); this.quizStep(i + 1); };
      $('quiz-opts').appendChild(b);
    });
    $('quiz-dots').innerHTML = QUIZ.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('');
  }

  codeModal() {
    this.modal(`<h2><span class="jp">読込</span>Paste a creature code</h2><p>Someone shared a monster with you? Paste the code here.</p>
      <textarea id="code-in" placeholder="paste here…"></textarea>
      <div class="row"><button class="btn primary" id="m-ok">Load it</button><button class="btn ghost" id="m-x">Cancel</button></div>`);
    $('m-ok').onclick = () => {
      try { const d = decodeDesign($('code-in').value); this.closeModal(); this.goCreator(d); this.toast(`${d.name} has arrived!`); }
      catch { this.toast('That code is a little squished…'); sfx.bonk(); }
    };
    $('m-x').onclick = () => this.closeModal();
  }

  // installable app: Android/desktop Chrome offer a prompt; iPhone needs Share → Add to Home Screen
  bindInstall() {
    const btn = $('btn-install');
    const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
    if (standalone) return;
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.classList.remove('hidden'); });
    window.addEventListener('appinstalled', () => { btn.classList.add('hidden'); this.toast('Installed! Find Clayborn on your home screen.'); });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) btn.classList.remove('hidden');
    btn.onclick = async () => {
      sfx.click();
      if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => null); deferred = null; btn.classList.add('hidden'); return; }
      this.modal(`<h2><span class="jp">導入</span>Install Clayborn</h2>
        <p>On iPhone or iPad: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. It opens full screen and keeps working offline once you've played it.</p>
        <div class="row"><button class="btn primary" id="m-x">Got it</button></div>`);
      $('m-x').onclick = () => this.closeModal();
    };
  }

  async creditsModal() {
    let models = [];
    try { models = await (await fetch('./assets/addons/CREDITS.json')).json(); } catch { /* offline and not cached */ }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, ''))}</a>`;
    const rows = models.map((m) => `<p><b>${esc(m.title)}</b> by ${esc(m.author)} · ${esc(m.license)} · ${link(m.source)}</p>`).join('');
    this.modal(`<h2><span class="jp">謝辞</span>Credits</h2>
      <div class="credits">
        <h4>Add-on models</h4>${rows}
        <p>CC-BY models are used under <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>, via Poly Pizza. CC0 models are from Quaternius, iPoly3D and Kenney.</p>
        <h4>World</h4>
        <p>Sky, textures and fern from ${link('https://polyhaven.com')} (CC0). Trees, grass, flowers and rocks from ez-tree by Daniel Greenheck (MIT).</p>
        <h4>Tech + type</h4>
        <p>three.js (MIT). Fonts: Dela Gothic One, DotGothic16, Zen Kaku Gothic New (SIL OFL).</p>
        <p>Inspired by <i>Amazing Island</i> (Sega, 2004). No assets from it are used.</p>
      </div>
      <div class="row"><button class="btn primary" id="m-x">Close</button></div>`);
    $('m-x').onclick = () => this.closeModal();
  }

  modal(html) { $('modal-card').innerHTML = html; $('modal').classList.remove('hidden'); }
  closeModal() { $('modal').classList.add('hidden'); }
  toast(msg, ms = 2200) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  resize() {
    this.gfx.resize();
    if (this.mode === 'creator') this.creator.layoutRegion();
    else { const narrow = window.innerWidth <= 900; this.studio.layout(narrow ? 0 : 450 + 16, narrow ? 0 : 310 + 16); }
    this.island.resize();
  }

  frame() {
    if (this.mode === 'trailer') return; // the trailer director drives frames itself
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.t += dt;
    WORLD_TIME.value = this.t;
    let scene, camera;
    if (this.mode === 'creator' || this.mode === 'quiz' && false) {
      this.studio.update(dt, this.t); scene = this.studio.scene; camera = this.studio.camera;
    } else {
      this.island.update(dt, this.t); scene = this.island.scene; camera = this.island.camera;
      if (this.island.activeEvent) { scene = this.island.activeEvent.scene; camera = this.island.activeEvent.camera; }
    }
    cullNature(scene, camera);
    this.gfx.render(scene, camera, this.t);
    this.gfx.adapt(dt);
    this.input.endFrame();
  }
}

function safeDecode(c) { try { return decodeDesign(c); } catch { return null; } }

// boot: load the serious-world assets behind the wipe, then build everything
(async () => {
  const wipeText = document.querySelector('#fade b');
  const tmp = createRenderer($('gl'));
  try {
    await loadAssets(tmp.renderer, (p) => { wipeText.textContent = `粘土 ${Math.round(p * 100)}%`; });
  } catch (e) { wipeText.textContent = 'LOAD FAILED'; console.error(e); return; }
  wipeText.textContent = '粘土';
  window.app = new App(tmp);
  if (import.meta.env.DEV) (await import('./dev/tools.js')).installDevTools(window.app);
  // offline + installable (production builds only, so the dev server never serves stale files)
  if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
export { escapeHtml, THREE };
