import type { Page } from 'playwright';
import type { createGameServer } from '../server/app';
import type { Room } from '../server/game';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function realtimeFixture(origins?: string[]) {
  const entry = pathToFileURL(resolve('dist/server/app.mjs')).href;
  const compiled = await import(entry);
  const server: ReturnType<typeof createGameServer> = compiled.createGameServer({ origins });
  compiled.serveProduction(server.app);
  await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
  const address = server.http.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  return { ...server, url: `http://127.0.0.1:${address.port}`,
    // Test-only server poses; neither clients nor production endpoints can use it.
    blobs: {
      async read(code: string) { return { room: server.rooms.rooms.get(code)!.serialize() }; },
      async edit(code: string, fn: (data: { room: ReturnType<Room['serialize']> }) => void) {
        const room = server.rooms.rooms.get(code)!;
        fn({ room: { ...room.serialize(), players: [...room.players.values()] } });
        server.publish(code);
      },
    },
  };
}
export async function delaySocket(page: Page, oneWayMs: number) {
  await page.routeWebSocket('**/socket.io/**', socket => {
    const upstream = socket.connectToServer();
    let closed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void) => { const timer = setTimeout(() => { timers.delete(timer); if (!closed) fn(); }, oneWayMs); timers.add(timer); };
    const stop = () => { closed = true; for (const timer of timers) clearTimeout(timer); timers.clear(); };
    socket.onMessage(message => later(() => upstream.send(message)));
    upstream.onMessage(message => later(() => socket.send(message)));
    socket.onClose(() => { stop(); void upstream.close(); });
    upstream.onClose(() => { stop(); void socket.close(); });
  });
}
