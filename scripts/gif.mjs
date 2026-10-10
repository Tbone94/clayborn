// frames folder → optimized GIF (two-pass palette).  node scripts/gif.mjs <name> [--crop w:h:x:y] [--width 560] [--fps 15]
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import fs from 'node:fs';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const name = args[0], src = `captures/itch/frames/${name}/%04d.jpg`, out = `captures/itch/final/${opt('out', name)}.gif`;
const crop = opt('crop'), every = +opt('every', '1'), width = opt('width', '560'), fps = opt('fps', '15'), colors = opt('colors', '128');
const vf = `${every > 1 ? `select='not(mod(n\\,${every}))',setpts=N/(${fps}*TB),` : ''}${crop ? `crop=${crop},` : ''}scale=${width}:-1:flags=lanczos`;
fs.mkdirSync('captures/itch/final', { recursive: true });
const start = opt('start', '0'), count = opt('count');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', fps, '-start_number', start, '-i', src, ...(count ? ['-frames:v', String(Math.ceil(+count / every))] : []),
  '-filter_complex', `[0:v]${vf},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, out]);
console.log(out, (fs.statSync(out).size / 1e6).toFixed(2) + ' MB');
