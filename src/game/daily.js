// The daily challenge: one per calendar day, the same for everyone on that date.
// Some ask you to redraw your monster first, so they push you back into the Mold Lab.
import { curseLevel } from '../ui/card.js';

const legless = (c) => { const A = c.analysis; return !A?.inst?.some((it) => A.bones[it.bone].kind === 'leg'); };

// game: a Gloom zone index (0 Ridge Run, 1 Bonk Bowl, 2 Sky Leap) or a side-game id
// needs: the monster must qualify before it counts; need: says what to change if it doesn't
export const CHALLENGES = [
  { game: 0, text: 'Win <b>Ridge Run</b> with a monster that has <b>no legs</b>.', needs: legless, need: 'Redraw it with no legs (a Slither works).', pass: (r) => r.won },
  { game: 1, text: 'Win the <b>Bonk Bowl</b> with <b>Speed 4 or less</b>.', needs: (c) => c.stats.speed <= 4, need: 'Too speedy! Make it chunkier or shorter-legged.', pass: (r) => r.won },
  { game: 2, text: 'Glide <b>45 m</b> or more in <b>Sky Leap</b>.', pass: (r) => (r.dist || 0) >= 45 },
  { game: 'pageant', text: 'Win the <b>Cursed Pageant</b> with <b>Curse Level 4</b> or higher.', needs: (c) => curseLevel(c.design, c.stats) >= 4, need: 'Not cursed enough. Try the 呪 Curse button.', pass: (r) => r.won },
  { game: 'fishing', text: 'Catch <b>8 kg</b> of fish off the pier.', pass: (r) => (r.score || 0) >= 8 },
  { game: 'dance', text: 'Win the <b>Dance-off</b> as a <b>Slither</b>. No legs, all hips.', needs: (c) => c.design.frame === 'serpent', need: 'Switch its body type to Slither.', pass: (r) => r.won },
  { game: 'downhill', text: 'Win <b>Roly Rumble</b> <b>without</b> the Roly body type.', needs: (c) => c.design.frame !== 'roller', need: 'No Rolys allowed today!', pass: (r) => r.won },
  { game: 'hideseek', text: 'Find everyone in <b>Hide &amp; Seek</b> with <b>30 seconds</b> to spare.', pass: (r) => r.won && (r.left || 0) >= 30 },
  { game: 'pageant', text: 'Win the <b>Cursed Pageant</b> wearing <b>3 or more add-ons</b>.', needs: (c) => (c.design.addons || []).length >= 3, need: 'Stick on at least 3 add-ons first.', pass: (r) => r.won },
  { game: 'dance', text: 'Win the <b>Dance-off</b> with a <b>Robot</b> voice.', needs: (c) => c.design.voice === 'robot', need: 'Give it the Robot voice (Paint step).', pass: (r) => r.won },
  { game: 1, text: 'Win the <b>Bonk Bowl</b> as a <b>Flapper</b>.', needs: (c) => c.design.frame === 'flyer', need: 'Switch its body type to Flapper.', pass: (r) => r.won },
  { game: 'fishing', text: 'Catch <b>5 kg</b> of fish with a <b>three-eyed</b> monster.', needs: (c) => c.design.eyes === 'tri', need: 'Give it three eyes (Paint step).', pass: (r) => (r.score || 0) >= 5 },
  { game: 0, text: 'Win <b>Ridge Run</b> as a <b>Roly</b>.', needs: (c) => c.design.frame === 'roller', need: 'Switch its body type to Roly.', pass: (r) => r.won },
  { game: 'hideseek', text: 'Find everyone in <b>Hide &amp; Seek</b> as a <b>Skitter</b>.', needs: (c) => c.design.frame === 'crawler', need: 'Switch its body type to Skitter.', pass: (r) => r.won },
];

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

export function today(save) {
  const key = dayKey();
  const ch = CHALLENGES[hash('clayborn' + key) % CHALLENGES.length];
  return { key, ch, done: save.daily?.day === key && save.daily.done };
}

// after any game: returns true when this result completes today's challenge for the first time
export function checkDaily(save, game, result, creature) {
  const T = today(save);
  if (T.done || T.ch.game !== game) return false;
  if (T.ch.needs && !T.ch.needs(creature)) return false;
  if (!T.ch.pass(result)) return false;
  const y = new Date(); y.setDate(y.getDate() - 1);
  save.streak = save.lastDaily === dayKey(y) ? (save.streak || 0) + 1 : 1;
  save.stamps = (save.stamps || 0) + 1;
  save.lastDaily = T.key;
  save.daily = { day: T.key, done: true };
  return true;
}
