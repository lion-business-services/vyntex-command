// Local preview server: serves dist/ with single-page fallback and runs the functions in api/ the way Vercel does.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.DIST ? path.resolve(process.env.DIST) : path.join(root, 'dist');
const port = Number(process.env.PORT || process.argv[2] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const file = path.join(root, 'api', url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '') + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"not_found"}'); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    try {
      const mod = await import(pathToFileURL(file).href + '?t=' + fs.statSync(file).mtimeMs);
      const handler = mod[req.method] || mod.default;
      const out = await handler(request);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"server_error"}'); }
  }
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('preview on http://localhost:' + port));
