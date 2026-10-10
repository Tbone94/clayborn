// Dev-only helpers: drive the game deterministically and save frames to ./captures.
import { randomDesign } from '../creature/generator.js';

export function installDevTools(app) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dev = {
    wait,
    // advance the game by n fixed 1/60s frames (works even when the tab is hidden)
    step(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) { app.last = performance.now() - dt * 1000; app.frame(); }
    },
    async snap(name, quality = 0.88) {
      const c = document.getElementById('gl');
      dev.step(1);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
      const res = await fetch('/__capture?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
      return res.status;
    },
    async toIsland(seed = 4242, opts = { frame: 'quad' }) {
      if (app.mode !== 'island') {
        app.goCreator(randomDesign(seed, opts)); await wait(1200); dev.step(4);
        document.getElementById('btn-done').click(); await wait(1500); dev.step(4);
      }
      return app.island;
    },
    // render the trailer frames into ./captures/trailer (runs in the background; poll window.trailerProgress)
    trailer(opts) {
      window.trailerProgress = 'starting';
      import('../trailer/director.js').then(({ Director }) => new Director(app).run(opts)).catch((e) => { window.trailerProgress = 'error: ' + e.message; console.error(e); });
      return 'started';
    },
    // the prestige cut: ./captures/cinema, then `node scripts/make-cinema.mjs`
    cinema(opts) {
      window.trailerProgress = 'starting';
      import('../trailer/cinema.js').then(({ Cinema }) => new Cinema(app).run(opts)).catch((e) => { window.trailerProgress = 'error: ' + e.message; console.error(e); });
      return 'started';
    },
    cam(yaw, pitch, dist) { const i = app.island; i.camYaw = yaw; i.camPitch = pitch; i.camDist = dist; },
  };
  window.dev = dev;
}
