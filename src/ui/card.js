// Monster trading card: a studio photo + measured stats + a curse rating + a mean little bio.
// Drawn on a 2D canvas in the toy-box style so it can be saved / sent to friends.
import { STAT_INFO } from '../creature/stats.js';
import { FRAMES } from '../creature/frames.js';

const INK = '#15172b', RED = '#e63b2e', YELLOW = '#ffd23f', PAPER = '#f1ebdd', WHITE = '#fbf8f0';
const STAT_COLORS = { speed: '#4fc3ff', power: '#ff5a3c', balance: '#ffd23f', glide: '#ff8fd0', swim: '#2fe0c0' };
const DISPLAY = '"Dela Gothic One", sans-serif', DOT = '"DotGothic16", monospace', UI = '"Zen Kaku Gothic New", sans-serif';

const CURSE_LV = ['Weirdly cute', 'Mildly unsettling', 'Grandma would scream', 'Do not feed after midnight', 'Forbidden clay'];
const BEST = {
  speed: 'Gone before you finish saying its name.',
  power: 'Hugs with the force of a falling fridge.',
  balance: 'Has never once fallen over. Not even emotionally.',
  glide: 'Treats cliffs as a suggestion.',
  swim: 'Swims like it owes the sea money.',
};
const WORST = {
  speed: 'Walks like it is carrying invisible groceries.',
  power: 'Loses arm-wrestles to soup.',
  balance: 'Trips over its own thoughts.',
  glide: 'Has never heard of the sky.',
  swim: 'Sinks with great dignity.',
};
const LIKES = ['puddles', 'being poked', 'warm rocks', 'other people\'s snacks', 'the moon', 'gossip', 'naps', 'its own reflection', 'sea foam', 'loud noises', 'pebbles', 'hats'];
const FEARS = ['forks', 'the Gloom', 'mirrors', 'Tuesdays', 'birds', 'being looked at', 'bath time', 'clouds shaped like it', 'silence', 'its own tail', 'stairs', 'the dentist'];

export function nameHash(s) { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 997; return h; }

// 1–5: how cursed is it? Measured from the shape, nudged by the name so it's stable per monster.
export function curseLevel(design, stats) {
  const raw = stats.raw || {};
  let lv = 1 + (nameHash(design.name || '') % 2);
  if (['tri', 'cyclops'].includes(design.eyes) || design.eyeSize > 1.45) lv++;
  if ((design.addons || []).length >= 3) lv++;
  const vals = Object.keys(STAT_INFO).map((k) => stats[k]);
  if (vals.filter((v) => v >= 8.5 || v <= 1.5).length >= 3) lv++;
  const ratio = raw.height / (raw.length || 1);
  if (ratio > 1.7 || ratio < 0.45) lv++;
  if (Object.values(design.thick || {}).some((t) => t > 1.7)) lv++;
  return Math.max(1, Math.min(5, lv));
}

function bio(design, stats) {
  const keys = Object.keys(STAT_INFO);
  const best = keys.slice().sort((a, b) => stats[b] - stats[a])[0];
  const worst = keys.slice().sort((a, b) => stats[a] - stats[b])[0];
  const h = nameHash(design.name || '');
  return { line: `${BEST[best]} ${WORST[worst]}`, likes: LIKES[h % LIKES.length], fears: FEARS[(h * 7 + 3) % FEARS.length] };
}

function wrap(x, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

// photo: a square canvas of the monster on the turntable
export async function drawCard(design, stats, photo) {
  await document.fonts?.ready;
  const W = 900, H = 1440, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const slab = (cx, cy, w, h, fill, shadow) => {
    x.save(); x.translate(cx, cy); x.transform(1, 0, -0.2, 1, 0, 0);
    if (shadow) { x.fillStyle = shadow; x.fillRect(-w / 2 + 10, -h / 2 + 8, w, h); }
    x.fillStyle = fill; x.fillRect(-w / 2, -h / 2, w, h); x.restore();
  };

  // paper + halftone + ink frame
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(21,23,43,0.07)';
  for (let yy = 0; yy < H; yy += 9) for (let xx = (yy / 9) % 2 ? 4 : 0; xx < W; xx += 9) { x.beginPath(); x.arc(xx, yy, 1.3, 0, 6.28); x.fill(); }
  x.strokeStyle = INK; x.lineWidth = 14; x.strokeRect(7, 7, W - 14, H - 14);

  // series strip
  x.fillStyle = INK; x.fillRect(14, 14, W - 28, 64);
  x.fillStyle = YELLOW; x.font = `400 26px ${DOT}`; x.textBaseline = 'middle';
  x.fillText('粘土怪獣シリーズ  CLAY KAIJU SERIES', 40, 47);
  x.textAlign = 'right'; x.fillStyle = WHITE; x.fillText('No.' + String(nameHash(design.name || '') + 1).padStart(3, '0'), W - 40, 47);
  x.textAlign = 'left';

  // name on a skewed slab
  x.font = `400 76px ${DISPLAY}`;
  const name = (design.name || '???').toUpperCase();
  const nw = Math.min(W - 120, x.measureText(name).width + 70);
  slab(W / 2, 150, nw, 104, INK, RED);
  x.fillStyle = WHITE; x.textAlign = 'center'; x.fillText(name, W / 2, 154, W - 160); x.textAlign = 'left';

  // photo window
  const P = { x: 50, y: 225, s: 800 };
  x.fillStyle = INK; x.fillRect(P.x + 12, P.y + 12, P.s, P.s);
  x.drawImage(photo, P.x, P.y, P.s, P.s);
  x.lineWidth = 8; x.strokeRect(P.x, P.y, P.s, P.s);

  // curse sticker, slapped on the corner
  const lv = curseLevel(design, stats);
  x.save(); x.translate(P.x + P.s - 150, P.y + 70); x.rotate(0.12);
  x.fillStyle = RED; x.fillRect(-150, -52, 300, 112);
  x.fillStyle = YELLOW; x.fillRect(-158, -60, 300, 112);
  x.fillStyle = INK; x.font = `400 24px ${DOT}`; x.textAlign = 'center';
  x.fillText('呪 CURSE LEVEL', -8, -30);
  x.font = `400 40px ${DISPLAY}`; x.fillText('★'.repeat(lv) + '☆'.repeat(5 - lv), -8, 10);
  x.font = `700 19px ${UI}`; x.fillText(CURSE_LV[lv - 1].toUpperCase(), -8, 40, 280);
  x.restore();

  // body type tag
  const f = FRAMES[design.frame] || FRAMES.biped;
  let y = P.y + P.s + 52;
  x.font = `400 30px ${DISPLAY}`; const tag = `${f.name.toUpperCase()}`;
  const tw = x.measureText(tag).width;
  x.fillStyle = INK; x.fillRect(50, y - 26, tw + 36, 50);
  x.fillStyle = YELLOW; x.fillText(tag, 68, y);
  x.fillStyle = INK; x.font = `700 24px ${UI}`; x.fillText(`${f.icon} · ${f.perk}`, 50 + tw + 56, y + 2);

  // stats: two columns of bars
  y += 52;
  Object.entries(STAT_INFO).forEach(([k, info], i) => {
    const col = i < 3 ? 0 : 1, row = i < 3 ? i : i - 3;
    const sx = 50 + col * 410, sy = y + row * 44;
    x.fillStyle = INK; x.font = `400 22px ${DOT}`; x.fillText(`${info.icon} ${info.label.toUpperCase()}`, sx, sy);
    x.fillStyle = WHITE; x.fillRect(sx + 160, sy - 13, 180, 24); x.strokeStyle = INK; x.lineWidth = 3; x.strokeRect(sx + 160, sy - 13, 180, 24);
    x.fillStyle = STAT_COLORS[k]; x.fillRect(sx + 162, sy - 11, 176 * (stats[k] / 10), 20);
    x.fillStyle = INK; x.font = `400 22px ${DISPLAY}`; x.fillText(stats[k].toFixed(1), sx + 352, sy + 1);
  });
  // last cell of the right column: the finish
  x.fillStyle = INK; x.font = `400 22px ${DOT}`; x.fillText(`仕上 ${String(design.finish || 'clay').toUpperCase()} · ${String(design.pattern || 'solid').toUpperCase()}`, 460, y + 88);

  // bio
  y += 150;
  const B = bio(design, stats);
  x.font = `700 25px ${UI}`; x.fillStyle = INK;
  for (const ln of wrap(x, B.line, W - 110).slice(0, 2)) { x.fillText(ln, 52, y); y += 34; }
  y += 6;
  x.font = `400 22px ${DOT}`; x.fillStyle = RED;
  x.fillText(`LIKES: ${B.likes.toUpperCase()}   ·   FEARS: ${B.fears.toUpperCase()}`, 52, y, W - 110);

  // footer
  x.fillStyle = INK; x.fillRect(14, H - 58, W - 28, 44);
  x.fillStyle = WHITE; x.font = `400 22px ${DISPLAY}`; x.fillText('CLAYBORN', 36, H - 35);
  x.fillStyle = YELLOW; x.font = `400 18px ${DOT}`; x.textAlign = 'right'; x.fillText('draw a monster · it comes alive', W - 36, H - 35); x.textAlign = 'left';
  return c;
}
