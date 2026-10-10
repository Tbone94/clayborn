// Every creature has the same 7 drawable layers. A "frame" (body type) decides
// what each layer means, how it moves and what special ability it has — the same
// trick Amazing Island used: the skeleton already knows how to move, your drawing is the flesh.

export const LAYERS = ['body', 'head', 'legs', 'limbs', 'tail', 'wings', 'top'];
export const OPTIONAL = new Set(['tail', 'wings', 'top']);

export const LAYER_COLORS = {
  body: '#e63b2e', head: '#f29a1f', legs: '#2f6fdf', limbs: '#11a39a',
  tail: '#7b4fe0', wings: '#ff6fa8', top: '#c9a400',
};

const base = {
  body: { label: 'Body', kind: 'body', mirror: false, thick: 1.35, hint: 'The torso. Bigger body = heavier and stronger.' },
  head: { label: 'Head', kind: 'head', mirror: false, thick: 1.3, hint: 'The eyes go on the front (right side) of it.' },
  tail: { label: 'Tail', kind: 'tail', mirror: false, thick: 0.95, hint: 'Optional. Big tails swim faster.' },
  wings: { label: 'Wings', kind: 'wing', mirror: true, thick: 0.28, hint: 'Optional. Bigger wings = longer glides.' },
  top: { label: 'Horns', kind: 'top', mirror: false, thick: 0.55, hint: 'Optional. Horns, ears, crests, hair…' },
};
const legs = (label, hint, extra = {}) => ({ label, kind: 'leg', mirror: true, thick: 1.0, phase: 0, hint, ...extra });
const arms = (label, hint, extra = {}) => ({ label, kind: 'arm', mirror: true, thick: 0.95, phase: 0.5, hint, ...extra });

export const FRAMES = {
  biped: {
    name: 'Stomper', icon: '二足', gait: 'biped', perk: 'All-rounder',
    desc: 'Two legs, two arms. Good at a bit of everything.',
    layers: { ...base, legs: legs('Legs', 'Long legs run faster. Wide feet keep you standing.'), limbs: arms('Arms', 'Chunky arms shove harder.') },
  },
  quad: {
    name: 'Prowler', icon: '四足', gait: 'quad', perk: 'Fast + steady',
    desc: 'Four legs. Quick and hard to knock over.',
    layers: { ...base, legs: legs('Back legs', 'Long legs run faster.'), limbs: legs('Front legs', 'Spread the legs apart for balance.', { phase: 0.5 }) },
  },
  hopper: {
    name: 'Bouncer', icon: '跳躍', gait: 'hop', perk: 'Big jumps',
    desc: 'Hops everywhere. Jumps really high.',
    layers: { ...base, legs: legs('Feet', 'Bigger feet = bigger hops.'), limbs: arms('Arms', 'Little arms for flailing.') },
  },
  serpent: {
    name: 'Slither', icon: '蛇行', gait: 'slither', perk: 'Super swimmer',
    desc: 'No legs. Longer body = faster. Swims like a fish.',
    layers: {
      ...base,
      body: { ...base.body, hint: 'Draw it LONG and side to side. Length is speed.' },
      legs: { label: 'Fins', kind: 'fin', mirror: true, thick: 0.35, phase: 0, hint: 'Optional little fins. They help swimming.' },
      limbs: { label: 'Whiskers', kind: 'fin', mirror: true, thick: 0.45, phase: 0.5, hint: 'Optional. Whiskers, frills, feelers.' },
      tail: { ...base.tail, hint: 'A long tail. The bigger, the faster you swim.' },
    },
  },
  flyer: {
    name: 'Flapper', icon: '飛翔', gait: 'flap', perk: 'Flaps in mid-air',
    desc: 'A bird-ish body. Flaps its wings to jump again in mid-air.',
    layers: { ...base, wings: { ...base.wings, hint: 'Draw big wings! Each flap lifts you again.' }, legs: legs('Legs', 'Skinny bird legs are fine.'), limbs: arms('Arms', 'Optional. Most birds skip these.') },
  },
  crawler: {
    name: 'Skitter', icon: '多足', gait: 'skitter', perk: 'Never falls over',
    desc: 'Bug-like and low to the ground. Draw several legs per part.',
    layers: { ...base, legs: legs('Back legs', 'Draw 2–3 spindly legs here. They move together.'), limbs: legs('Front legs', 'More legs! Splayed out = super stable.', { phase: 0.5 }) },
  },
  roller: {
    name: 'Roly', icon: '転球', gait: 'roll', perk: 'Rolls + body-slams',
    desc: 'A ball that rolls around. Rounder and heavier = harder hits.',
    layers: {
      ...base,
      body: { ...base.body, hint: 'Draw a big round ball. Round shapes roll best.' },
      legs: legs('Nubs', 'Optional tiny feet for when it stands still.'), limbs: arms('Arms', 'Optional stubby arms.'),
    },
  },
};

// Faint guide shapes shown on the paper so you know where things go.
// Units: world (x -1..1, y 0..2). Each: [type, ...args]
export const GHOSTS = {
  biped: {
    body: [['ellipse', 0, 0.95, 0.36, 0.45]],
    head: [['ellipse', 0.2, 1.55, 0.26, 0.24]],
    legs: [['capsule', -0.05, 0.65, 0.0, 0.08, 0.11]],
    limbs: [['capsule', 0.12, 1.15, 0.42, 0.85, 0.08]],
    tail: [['capsule', -0.32, 0.8, -0.75, 0.45, 0.1]],
    wings: [['fan', -0.1, 1.2, -0.65, 1.75, 0.25]],
    top: [['tri', 0.15, 1.75, 0.22, 1.98, 0.3, 1.74]],
  },
  quad: {
    body: [['ellipse', 0, 0.8, 0.55, 0.3]],
    head: [['ellipse', 0.62, 1.12, 0.24, 0.22]],
    legs: [['capsule', -0.35, 0.7, -0.38, 0.06, 0.1]],
    limbs: [['capsule', 0.32, 0.7, 0.36, 0.06, 0.1]],
    tail: [['capsule', -0.55, 0.85, -0.9, 1.15, 0.08]],
    wings: [['fan', 0.0, 1.0, -0.55, 1.6, 0.25]],
    top: [['tri', 0.55, 1.3, 0.62, 1.52, 0.7, 1.3]],
  },
  hopper: {
    body: [['ellipse', 0, 0.62, 0.45, 0.45]],
    head: [['ellipse', 0.18, 1.15, 0.25, 0.2]],
    legs: [['ellipse', 0.0, 0.12, 0.28, 0.1]],
    limbs: [['capsule', 0.3, 0.75, 0.55, 0.55, 0.07]],
    tail: [['ellipse', -0.48, 0.55, 0.13, 0.13]],
    wings: [['fan', -0.15, 0.9, -0.6, 1.4, 0.22]],
    top: [['ellipse', 0.05, 1.38, 0.08, 0.12], ['ellipse', 0.3, 1.38, 0.08, 0.12]],
  },
  serpent: {
    body: [['path', [[-0.55, 0.32], [-0.2, 0.42], [0.15, 0.32], [0.45, 0.45]], 0.2, 0.18]],
    head: [['ellipse', 0.68, 0.6, 0.24, 0.2]],
    legs: [['ellipse', -0.05, 0.18, 0.12, 0.06, -0.3]],
    limbs: [['capsule', 0.85, 0.58, 0.98, 0.45, 0.025]],
    tail: [['path', [[-0.55, 0.32], [-0.8, 0.22], [-0.95, 0.35]], 0.15, 0.04]],
    wings: [['fan', -0.1, 0.55, -0.35, 0.95, 0.15]],
    top: [['tri', 0.6, 0.76, 0.66, 0.98, 0.74, 0.76]],
  },
  flyer: {
    body: [['ellipse', 0, 0.85, 0.32, 0.36]],
    head: [['ellipse', 0.28, 1.32, 0.22, 0.2]],
    legs: [['capsule', 0.0, 0.55, 0.02, 0.05, 0.05]],
    limbs: [['capsule', 0.2, 0.9, 0.38, 0.75, 0.05]],
    tail: [['fan', -0.28, 0.8, -0.7, 0.95, 0.12]],
    wings: [['fan', -0.05, 1.05, -0.8, 1.75, 0.32]],
    top: [['tri', 0.18, 1.48, 0.22, 1.68, 0.3, 1.5]],
  },
  crawler: {
    body: [['ellipse', -0.1, 0.42, 0.5, 0.2]],
    head: [['ellipse', 0.48, 0.48, 0.2, 0.17]],
    legs: [['path', [[-0.3, 0.38], [-0.45, 0.45], [-0.55, 0.05]], 0.04, 0.03], ['path', [[-0.05, 0.38], [-0.15, 0.48], [-0.22, 0.05]], 0.04, 0.03]],
    limbs: [['path', [[0.2, 0.38], [0.32, 0.5], [0.42, 0.05]], 0.04, 0.03]],
    tail: [['ellipse', -0.65, 0.42, 0.14, 0.1]],
    wings: [['fan', -0.1, 0.55, -0.6, 0.85, 0.15]],
    top: [['path', [[0.5, 0.6], [0.6, 0.85], [0.75, 0.95]], 0.015, 0.015], ['path', [[0.45, 0.6], [0.48, 0.88], [0.58, 1.02]], 0.015, 0.015]],
  },
  roller: {
    body: [['ellipse', 0, 0.62, 0.52, 0.52]],
    head: [['ellipse', 0.3, 0.85, 0.2, 0.18]],
    legs: [['ellipse', 0.02, 0.06, 0.16, 0.06]],
    limbs: [['ellipse', 0.42, 0.55, 0.1, 0.07]],
    tail: [['ellipse', -0.55, 0.5, 0.08, 0.08]],
    wings: [['fan', -0.1, 1.0, -0.4, 1.35, 0.15]],
    top: [['tri', -0.05, 1.08, 0.05, 1.3, 0.15, 1.08]],
  },
};
