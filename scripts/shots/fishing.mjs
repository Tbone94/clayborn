// Pier Fishing: a bot casts, hooks and reels for the camera
export default async ({ js, frame, wait, still }) => {
  await js(`await dev.toIsland(2323, { frame: 'serpent', tail: true }); return 1`);
  await js(`dev.step(5); const I = await import('/src/scenes/island.js'); app.island.startEvent(I.SPOTS.find((s) => s.id === 'fishing')); return 1`);
  for (let i = 0; i < 40; i++) { await wait(200); if (await js(`return app.island.activeEvent?.constructor.name === 'FishingEvent'`)) break; }
  await js(`window.__bot = () => { const ev = app.island.activeEvent, I = app.input; if (!ev || ev.state !== 'play') return ev?.phase;
      const p = ev.phase; I.keys.delete(' ');
      if (p === 'ready') { I.keys.add(' '); I.pressed.add(' '); }
      else if (p === 'charge') { if (ev.pow < 0.92) I.keys.add(' '); }
      else if (p === 'bite' && ev.pt > 0.12) I.pressed.add(' ');
      else if (p === 'reel') { if (ev.fy > ev.zy + ev.zoneH * 0.5) I.keys.add(' '); }
      return p; }; return 1`);
  const step = (n) => js(`let p; for (let i = 0; i < ${n}; i++) { p = __bot(); dev.step(1); } return p`);
  for (let i = 0; i < 60 * 5.4 / 6; i++) await step(6); // intro + count
  let shot = false;
  for (let i = 0; i < 260; i++) {
    const p = await step(4); await frame(0);
    if (!shot && p === 'reel' && i > 40) { await still('captures/itch/final/shots/09-fishing.png', 0); shot = true; }
    if (await js(`return (app.island.activeEvent?.catches?.length || 0) >= 2`)) { for (let k = 0; k < 20; k++) { await step(4); await frame(0); } break; }
  }
};
