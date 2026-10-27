import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  let file;
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(resolve(root) + sep)) { response.writeHead(403); response.end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404); response.end(); return; }
  } catch { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).on('error', () => response.destroy()).pipe(response);
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Local world preview: http://127.0.0.1:${server.address().port}`));
