// Roly Rumble: a Roly tucks and rolls down the mountain
export default async ({ js, frame, wait, still }) => {
  await js(`await dev.toIsland(7171, { frame: 'roller' }); return 1`);
  await js(`dev.step(5); const I = await import('/src/scenes/island.js'); app.island.startEvent(I.SPOTS.find((s) => s.id === 'downhill')); return 1`);
  for (let i = 0; i < 40; i++) { await wait(200); if (await js(`return app.island.activeEvent?.constructor.name === 'DownhillEvent'`)) break; }
  await js(`for (let i = 0; i < 60 * 5.3; i++) dev.step(1); return 1`); // intro + 3-2-1
  await js(`app.input.keys.add('w'); app.input.keys.add('shift'); return 1`);
  for (let i = 0; i < 150; i++) {
    await frame(4);
    if (i === 60) await still('captures/itch/final/shots/08-downhill.png', 0);
    if (await js(`return app.island.activeEvent?.state === 'done'`)) break;
  }
};
