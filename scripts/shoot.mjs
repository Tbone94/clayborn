// Marketing capture: drives a headless Chrome over the DevTools protocol so frames include the
// HTML UI (toasts, HUDs, cards), not just the WebGL canvas. Needs the dev server running.
//   node scripts/shoot.mjs <scenario> [--url http://127.0.0.1:5174/] [--w 1280 --h 720]
// Scenarios live in scripts/shots/<name>.mjs and export default async ({ js, frame, frames, wait, still }).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const name = args[0];
const URL_ = opt('url', 'http://127.0.0.1:5174/');
const W = +opt('w', 1280), H = +opt('h', 720), PORT = 9333 + Math.floor(Math.random() * 500);
const OUT = path.join('captures', 'itch', 'frames', name);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=metal', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, id = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true })); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'js error');
  return r.result?.result?.value;
}
let n = 0;
async function frame(steps = 2) {
  if (steps) await js(`dev.step(${steps})`);
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  fs.writeFileSync(path.join(OUT, String(n++).padStart(4, '0') + '.jpg'), Buffer.from(r.result.data, 'base64'));
}
const frames = async (count, steps = 2) => { for (let i = 0; i < count; i++) await frame(steps); };
async function still(file, steps = 1) {
  if (steps) await js(`dev.step(${steps})`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
}

try {
  await connect();
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 100; i++) { await sleep(300); if (await js('return !!(window.dev && window.app)').catch(() => false)) break; }
  // only our dev.step calls advance time, so slow captures still play back at real speed
  await js(`app.gfx.renderer.setAnimationLoop(null); return 1`);
  const scenario = (await import(path.resolve('scripts/shots', name + '.mjs'))).default;
  await scenario({ js, frame, frames, wait: sleep, still, W, H });
  console.log(`${n} frames → ${OUT}`);
} finally {
  chrome.kill('SIGKILL');
  fs.rmSync(profile, { recursive: true, force: true });
}
