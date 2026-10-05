import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { Rooms, RateLimit, callsign, roomCode } from './game';
import { RULES } from '../shared/world';
import { logRejection } from './rejections';
import { REALTIME_RELEASE, REALTIME_VERSION, type RealtimeReply, type SnapshotPacket } from '../shared/realtime-protocol';

export function createGameServer(options: { origins?: string[]; now?: () => number; manualTick?: boolean } = {}) {
  const app = express(), http = createServer(app), epoch = randomUUID();
  const startWall = Date.now(), startMono = performance.now();
  const now = options.now ?? (() => startWall + performance.now() - startMono);
  const origins = new Set(options.origins ?? ['https://neonbreach977.netlify.app', 'https://neonbreach977.vercel.app', 'https://neonbreach977-d7ii.vercel.app']);
  function allowed(origin: string | undefined, host: string | undefined) {
    if (!origin) return true; // Non-browser clients still need a private seat token.
    try { return origins.has(origin) || new URL(origin).host === host; } catch { return false; }
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Neon-Release', REALTIME_RELEASE); next(); });
  app.get('/healthz', (_req, res) => res.json({ ok: true, game: 'NEON BREACH', release: REALTIME_RELEASE, protocol: REALTIME_VERSION, tickHz: 60, snapshotHz: 20 }));
  // A backend served directly (including localhost) always selects WebSockets.
  app.get('/game-config.json', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ transport: 'websocket', serverUrl: null }); });
  const io = new Server(http, { transports: ['websocket'], maxHttpBufferSize: 4096, pingInterval: 2500, pingTimeout: 5000, serveClient: false,
    allowRequest: (req, callback) => callback(null, allowed(req.headers.origin, req.headers.host)),
  });
  const rooms = new Rooms();
  const roomLimit = new RateLimit(12, .2), actionLimit = new RateLimit(8, 2), inputLimit = new RateLimit(100, 70), pingLimit = new RateLimit(8, 2);
  const addresses = new Map<string, number>();
  // Render terminates connections at its proxy. Do not group every player by
  // that proxy's address, or trust an arbitrary forwarded-IP header.
  const proxied = process.env.RENDER === 'true';
  const streams = new Map<string, { snapshot: number; event: number; nextSnapshot: number }>();
  const stream = (code: string) => { let s = streams.get(code); if (!s) { s = { snapshot: 0, event: 0, nextSnapshot: 0 }; streams.set(code, s); } return s; };
  function publish(code: string, snapshot = true) {
    const room = rooms.rooms.get(code); if (!room) return;
    const s = stream(code);
    for (const event of room.drainEvents()) io.to(code).emit('event', { epoch, seq: ++s.event, code, event });
    if (snapshot) {
      io.to(code).emit('snapshot', { epoch, seq: ++s.snapshot, snapshot: room.snapshot(now()) } satisfies SnapshotPacket);
      const at = now(), interval = room.phase === 'lobby' ? 400 : RULES.snapshotMs;
      s.nextSnapshot = s.nextSnapshot > at ? Math.min(s.nextSnapshot, at + interval) : at + interval - Math.max(0, at - s.nextSnapshot) % interval;
    }
  }
  io.use((socket, next) => {
    if (socket.handshake.auth.protocol !== REALTIME_VERSION) return next(new Error('Please reload the game to update its connection.'));
    const ip = socket.handshake.address;
    if (io.sockets.sockets.size >= 512 || (!proxied && (addresses.get(ip) ?? 0) >= 32)) return next(new Error('Too many station connections. Close another game tab.'));
    addresses.set(ip, (addresses.get(ip) ?? 0) + 1); next();
  });
  io.on('connection', socket => {
    const cache = new Map<string, RealtimeReply>();
    const reply = (callback: unknown, value: RealtimeReply) => { if (typeof callback === 'function') callback(value); };
    const identity = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || typeof (raw as any).requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test((raw as any).requestId)) throw new Error('Invalid station request.');
      return (raw as { requestId: string }).requestId;
    };
    const remember = (id: string, value: RealtimeReply) => { cache.set(id, value); while (cache.size > 32) cache.delete(cache.keys().next().value!); };
    const membership = () => {
      const room = rooms.rooms.get(socket.data.code), player = room?.players.get(socket.data.playerId);
      if (!room || !player?.connected || player.socketId !== socket.id) throw new Error('Your seat is no longer available. Return home to join a lobby.');
      return { room, player };
    };
    const leave = (explicit = false) => {
      const code = socket.data.code; if (!code) return;
      const room = rooms.rooms.get(code), player = room?.players.get(socket.data.playerId);
      // An old socket can never disconnect a seat held by a newer lease.
      if (player?.socketId === socket.id) room!.disconnect(player.id, now(), explicit);
      void socket.leave(code); socket.data.code = undefined; socket.data.playerId = undefined; publish(code);
    };
    socket.emit('hello', { epoch, release: REALTIME_RELEASE, protocol: REALTIME_VERSION });
    socket.on('room', (raw: unknown, callback: unknown) => {
      try {
        const requestId = identity(raw); const cached = cache.get(requestId); if (cached) return reply(callback, cached);
        if (!roomLimit.allow(socket.id, now())) return reply(callback, { ok: false, error: 'Too many room attempts. Wait a moment.', retryable: true, retryAfterMs: 2000 });
        if (socket.data.code) throw new Error('Leave your current room first.');
        const data = raw as { action?: unknown; name?: unknown; code?: unknown; token?: unknown };
        if (!['create', 'join', 'solo'].includes(String(data.action))) throw new Error('Invalid room action.');
        if (data.token !== undefined) {
          if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw new Error('Your saved seat is invalid. Return home to join a lobby.');
          const room = rooms.rooms.get(roomCode(data.code));
          const player = room && [...room.players.values()].find(p => p.token === data.token);
          if (!player || player.name !== callsign(data.name)) throw new Error('Your saved seat has expired. Return home to join a lobby.');
        }
        const { room, player } = data.action === 'join' ? rooms.join(data.code, data.name, socket.id, now(), data.token) : rooms.create(data.name, socket.id, now(), data.action === 'solo' ? 'solo' : 'multiplayer');
        socket.data.code = room.code; socket.data.playerId = player.id; void socket.join(room.code);
        const value = { ok: true, id: player.id, token: player.token, snapshot: room.snapshot(now()) };
        remember(requestId, value); reply(callback, value); publish(room.code);
      } catch (error) { reply(callback, { ok: false, error: error instanceof Error ? error.message : 'Room request failed.' }); }
    });
    socket.on('action', (raw: unknown, callback: unknown) => {
      try {
        const requestId = identity(raw); const cached = cache.get(requestId); if (cached) return reply(callback, cached);
        if (!actionLimit.allow(socket.id, now())) {
          if ((raw as { action?: unknown }).action === 'leave') logRejection('leave', socket.data.code ?? 'none', socket.data.playerId ?? socket.id, 'action rate limit', now());
          return reply(callback, { ok: false, error: 'Please wait before trying again.', retryable: true });
        }
        const action = (raw as { action?: unknown }).action;
        // Return home remains successful after a disconnect already removed
        // the seat. Repeating leave never affects someone else's membership.
        if (action === 'leave') { leave(true); const value = { ok: true }; remember(requestId, value); return reply(callback, value); }
        const { room, player } = membership();
        if (action === 'start') room.start(player.id, now());
        else if (action === 'replay') room.replay(player.id);
        else if (action === 'return-lobby') room.returnToLobby(player.id, now());
        else throw new Error('Unknown room action.');
        const value = { ok: true, snapshot: room.snapshot(now()) };
        remember(requestId, value); reply(callback, value); publish(room.code);
      } catch (error) {
        if (raw && typeof raw === 'object' && (raw as { action?: unknown }).action === 'leave') logRejection('leave', socket.data.code ?? 'none', socket.data.playerId ?? socket.id, error instanceof Error ? error.message : 'invalid action', now());
        reply(callback, { ok: false, error: error instanceof Error ? error.message : 'Room action failed.' });
      }
    });
    socket.on('input', (input: unknown) => {
      const firing = !!input && typeof input === 'object' && (input as { fire?: unknown }).fire === true;
      if (!inputLimit.allow(socket.id, now())) { if (firing) logRejection('shot', socket.data.code ?? 'none', socket.data.playerId ?? socket.id, 'input rate limit', now()); return; }
      try { const { room, player } = membership(); room.receive(player.id, input, now()); publish(room.code, false); }
      catch { if (firing) logRejection('shot', socket.data.code ?? 'none', socket.data.playerId ?? socket.id, 'no active room membership', now()); }
    });
    socket.on('pingCheck', (callback: unknown) => { if (pingLimit.allow(socket.id, now()) && typeof callback === 'function') callback(); });
    socket.on('disconnect', () => {
      leave(); cache.clear(); const ip = socket.handshake.address, remaining = (addresses.get(ip) ?? 1) - 1;
      if (remaining <= 0) addresses.delete(ip); else addresses.set(ip, remaining);
    });
  });
  let previous = now(), accumulator = 0, simAt = previous, cleanupAt = previous;
  function tick() {
    const current = now(); accumulator = Math.min(accumulator + Math.max(0, current - previous), 250); previous = current;
    simAt = Math.max(simAt, current - accumulator);
    while (accumulator >= RULES.tick * 1000) {
      simAt += RULES.tick * 1000;
      for (const room of rooms.rooms.values()) room.step(RULES.tick, simAt);
      accumulator -= RULES.tick * 1000;
    }
    for (const room of rooms.rooms.values()) {
      room.checkTimeout(current);
      publish(room.code, current >= stream(room.code).nextSnapshot);
    }
    if (current >= cleanupAt) {
      rooms.cleanup(current);
      for (const code of streams.keys()) if (!rooms.rooms.has(code)) streams.delete(code);
      for (const limit of [roomLimit, actionLimit, inputLimit, pingLimit]) limit.cleanup(current);
      cleanupAt = current + 1000;
    }
  }
  const timer = options.manualTick ? null : setInterval(tick, 1000 / 60); timer?.unref();
  let closed = false;
  return { app, http, io, rooms, epoch, now, tick, publish,
    async close() { if (closed) return; closed = true; if (timer) clearInterval(timer); io.emit('shutdown', 'The station is restarting. Return to the lobby after it reconnects.'); await new Promise<void>(resolve => io.close(() => resolve())); http.closeAllConnections(); },
  };
}
export function serveProduction(app: express.Express) {
  app.use(express.static(resolve('dist/client')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
}
