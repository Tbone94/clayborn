// Dance-off, auto-played perfectly for the camera
export default async ({ js, frame, wait, still }) => {
  await js(`await dev.toIsland(5150, { frame: 'biped' }); return 1`);
  await js(`const I = await import('/src/scenes/island.js'); app.island.startEvent(I.SPOTS.find((s) => s.id === 'dance')); return 1`);
  for (let i = 0; i < 30; i++) { await wait(150); if (await js(`return !!app.island.activeEvent?.chart`)) break; }
  // play every note perfectly on frame time (the song clock is paused so slow capture stays in sync)
  await js(`window.__auto = () => { const ev = app.island.activeEvent; if (!ev?.chart) return; ev.song?.ac?.state === 'running' && ev.song.ac.suspend();
      const pos = ev.posNow(); for (const n of ev.chart) if (!n.res && Math.abs(n.t - pos) < 0.04) ev.press(n.dir, n.t); }; return 1`);
  const step = async (n) => js(`for (let i = 0; i < ${n}; i++) { dev.step(1); __auto(); } return 1`);
  for (let i = 0; i < 60; i++) await step(10); // intro + count-in + verse
  for (let i = 0; i < 96; i++) { await step(4); await frame(0); }
  await still('captures/itch/final/shots/06-dance.png', 0);
};
