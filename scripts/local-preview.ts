// Developer-only adapter for the retained Function/Blobs compatibility mode.
// Its deployed function has no continuous process or filesystem persistence.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { blobFixture } from '../tests/netlify-fixture';
import game from '../netlify/functions/game';
import type { Context } from '@netlify/functions';
import { GAME_ENDPOINT } from '../shared/http-protocol';
export async function preview(handler = game, port = 0) {
  const blobs = await blobFixture();
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.png': 'image/png', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    const url = `http://${req.headers.host}${req.url}`;
    if (new URL(url).pathname === GAME_ENDPOINT) {
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const response = await handler(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}) }), { ip: req.socket.remoteAddress ?? 'local' } as Context);
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500).end('Preview function error'); }
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(url).pathname);
      const root = resolve('dist/client'), path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
      const content = await readFile(path); res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }); res.end(content);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Preview failed');
  return { blobs, url: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await blobs.close(); } };
}
if (process.argv[1]?.endsWith('local-preview.ts')) {
  const server = await preview(game, 3000);
  console.log(`Netlify function preview: ${server.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
}
