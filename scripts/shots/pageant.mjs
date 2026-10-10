// Cursed Pageant: skip to your turn, nail the pose, watch the judges' cards
export default async ({ js, frame, wait, still }) => {
  await js(`const G = await import('/src/creature/generator.js'), M = await import('/src/creature/mutate.js');
    const d = G.randomDesign(8086, { frame: 'quad' }); M.curse(d, G.rng(12)); M.curse(d, G.rng(40));
    app.goCreator(d); return 1`);
  await wait(1800);
  await js(`document.getElementById('btn-done').click(); return 1`);
  await wait(300);
  await js(`app.studio.hurryBirth(); for (let i = 0; i < 40; i++) dev.step(4); return 1`);
  await wait(2200);
  await js(`dev.step(10); const I = await import('/src/scenes/island.js'); app.island.startEvent(I.SPOTS.find((s) => s.id === 'pageant')); return 1`);
  for (let i = 0; i < 40; i++) { await wait(200); if (await js(`return !!app.island.activeEvent?.judges`)) break; }
  // press at the sweet spot whenever the meter is up
  await js(`window.__auto = () => { const ev = app.island.activeEvent; const el = ev?.meterEl; if (!el || !ev.needle) return false;
      const p = el.querySelector('.pg-perfect'); const c = (parseFloat(p.style.left) + parseFloat(p.style.width) / 2) / 100;
      if (Math.abs(parseFloat(ev.needle.style.left) / 100 - c) < 0.02) app.input.pressed.add(' '); return true; }; return 1`);
  const step = (n) => js(`let m = false; for (let i = 0; i < ${n}; i++) { dev.step(1); m = __auto() || m; } return m`);
  let guard = 0;
  while (!(await step(4)) && guard++ < 2000) { /* rivals' turns */ }
  for (let i = 0; i < 120; i++) { await step(4); await frame(0); if (i === 70) await still('captures/itch/final/shots/07-pageant.png', 0); }
};
