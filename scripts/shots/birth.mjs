// Bring to life: the kiln drops, bakes, and pops off
export default async ({ js, frame, frames, wait }) => {
  await js(`const G = await import('/src/creature/generator.js'), M = await import('/src/creature/mutate.js');
    const d = G.randomDesign(4410, { frame: 'biped' }); M.curse(d, G.rng(21)); app.goCreator(d); return 1`);
  await wait(1800);
  await js(`app.studio.autoSpin = false; app.studio.spin = -0.6; dev.step(30); document.getElementById('center-tip').style.opacity = 0; return 1`);
  await frames(6, 4);
  await js(`document.getElementById('btn-done').click(); return 1`);
  await wait(500); // panels slide away
  for (let i = 0; i < 44; i++) { await js(`app.studio.spin = -0.6; return 1`); await frame(4); }
};
