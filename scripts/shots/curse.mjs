// the 呪 Curse button, over and over, on the turntable
export default async ({ js, frame, wait }) => {
  await js(`const G = await import('/src/creature/generator.js'); app.goCreator(G.randomDesign(6061, { frame: 'quad' })); return 1`);
  await wait(1800);
  // hold the toasts on screen (capture runs slower than real time), face the monster to camera
  await js(`const t = app.toast.bind(app); app.toast = (m) => t(m, 60000); app.studio.autoSpin = false; app.studio.spin = -0.75; app.studio.spinVel = 0;
    dev.step(30); document.getElementById('center-tip').style.opacity = 0; return 1`);
  const sway = async (n) => { for (let i = 0; i < n; i++) { await js(`app.studio.spin = -0.75 + Math.sin(performance.now() / 900) * 0.35; return 1`); await frame(4); } };
  await sway(10);
  for (let k = 0; k < 5; k++) {
    await js(`document.getElementById('btn-curse').click(); return 1`);
    await wait(650);
    await sway(18);
  }
};
