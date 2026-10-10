// six page screenshots of the bits that already exist (side games get their own)
const D = 'captures/itch/final/shots/';
export default async ({ js, wait, still }) => {
  await js(`const G = await import('/src/creature/generator.js'), M = await import('/src/creature/mutate.js'), A = await import('/src/creature/addons.js');
    window.__G = G; window.__M = M; window.__A = A;
    const d = G.randomDesign(31337, { frame: 'quad' }); M.curse(d, G.rng(4)); app.goCreator(d); return 1`);
  await wait(1800);
  await js(`app.studio.autoSpin = false; app.studio.spin = -0.7; dev.step(30); document.getElementById('center-tip').style.visibility = 'hidden'; return 1`);
  await still(D + '01-mold-lab.png', 4);
  // paint step: colors, eyes, the new voices
  await js(`app.creator.setPhase('paint'); document.querySelector('#voices .chip[data-v="gruff"]').click(); document.querySelector('.pane-paint .pane-scroll').scrollTop = 9999; return 1`);
  await wait(400);
  await still(D + '02-paint-voice.png', 6);
  // add-ons: face stamps all over it
  await js(`const C = app.creator, cr = C.creature, g = cr.mesh.geometry, P = g.attributes.position.array, N = g.attributes.normal.array;
    const pts = []; for (let i = 0; i < P.length / 3; i += 37) if (P[i*3+1] > 0.45) pts.push(i);
    const pick = (f) => pts.reduce((b, i) => f(i) > f(b) ? i : b, pts[0]);
    const at = (i, t, s = 1) => { const a = A.newAddon(t, [P[i*3], P[i*3+1], P[i*3+2]], [N[i*3], N[i*3+1], N[i*3+2]]); a.s *= s; C.design.addons.push(a); };
    const A = window.__A;
    at(pick((i) => P[i*3] - Math.abs(P[i*3+2]) * 2 - Math.abs(P[i*3+1] - 0.8)), 'mouth2', 1.3);
    at(pick((i) => P[i*3+1] + P[i*3] * 0.5), 'eyestalk', 1.1);
    at(pick((i) => -P[i*3] + P[i*3+1] * 0.3 + P[i*3+2]), 'wart', 1.6);
    at(pick((i) => P[i*3+2] + P[i*3+1] * 0.4), 'bandage', 1.3);
    C.setPhase('addons'); cr.rebuildAddons(C.design); return 1`);
  await wait(1500);
  await still(D + '03-face-stamps.png', 6);
  // trading card
  await js(`app.creator.setPhase('shape'); await app.cardModal(app.creator.creature); return 1`);
  await wait(800);
  await still(D + '04-card.png', 2);
  await js(`app.closeModal(); return 1`);
  // to the island: a prompt by the daily board
  await js(`document.getElementById('btn-done').click(); return 1`);
  await wait(300);
  await js(`app.studio.hurryBirth(); dev.step(80); return 1`);
  await wait(2500);
  await js(`dev.step(10); const I = app.island, P = I.player; P.x = 3.4; P.z = 1.2; I.camYaw = Math.PI / 2 + 0.35; I.camPitch = 0.3; I.camDist = 9; dev.step(60);
    document.getElementById('controls-hint').classList.add('hidden'); document.getElementById('toast').classList.add('hidden'); return 1`);
  await still(D + '05-daily-board.png', 4);
};
