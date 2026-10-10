import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dev-only: the trailer renderer POSTs frames here; they land in ./captures
const capture = () => ({
  name: 'clayborn-capture',
  configureServer(server) {
    server.middlewares.use('/__capture', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const url = new URL(req.url, 'http://local');
      const name = (url.searchParams.get('name') || 'frame.jpg').replace(/[^\w.\-/]/g, '').replace(/\.\./g, '');
      const file = path.join('captures', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { fs.writeFileSync(file, Buffer.concat(chunks)); res.end('ok'); });
    });
  },
});

export default {
  base: './', // works from any subfolder (itch.io, GitHub Pages)
  server: { host: '127.0.0.1', watch: { ignored: ['**/captures/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // ez-tree's prebuilt bundle inlines ~4 MB of bark/leaf textures as base64 into our JS (slow to
  // download + parse on phones). Its source imports them as normal files instead: JS drops to ~0.9 MB.
  resolve: { alias: [{ find: /^@dgreenheck\/ez-tree$/, replacement: fileURLToPath(new URL('./node_modules/@dgreenheck/ez-tree/src/lib/index.js', import.meta.url)) }] },
  plugins: [capture()],
};
