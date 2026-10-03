// Historical pre-Netlify WebSocket test fixture. Never deployed or used by the production client.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { Rooms, RateLimit } from '../../server/game';
import { RULES } from '../../shared/world';
import type { Reply } from '../../shared/protocol';

export function createGameServer() {
  const app = express(), http = createServer(app);
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });
  app.get('/healthz', (_req, res) => res.json({ ok: true, game: 'NEON BREACH' }));
  const io = new Server(http, { maxHttpBufferSize: 4096, pingInterval: 2500, pingTimeout: 5000, serveClient: false });
  const rooms = new Rooms(), roomLimit = new RateLimit(12, 0.2), actionLimit = new RateLimit(8, 2), inputLimit = new RateLimit(100, 70);
  const now = () => performance.now();
  function publish(code: string) { const room = rooms.rooms.get(code); if (!room) return; for (const event of room.drainEvents()) io.to(code).emit('event', event); io.to(code).emit('snapshot', room.snapshot(now())); }
  io.on('connection', socket => {
    const ip = socket.handshake.address;
    // Reverse-proxy deployments may opt into a known proxy header, never arbitrary X-Forwarded-For.
    const requestKey = process.env.TRUST_PROXY === 'render' ? String(socket.handshake.headers['x-render-client-ip'] ?? ip) : ip;
    const ack = (fn: unknown, reply: Reply) => { if (typeof fn === 'function') fn(reply); };
    const membership = () => { const room = rooms.rooms.get(socket.data.code); const player = room?.players.get(socket.data.playerId); if (!room || !player?.connected || player.socketId !== socket.id) throw new Error('You are not connected to a room.'); return { room, player }; };
    const leave = (explicit = false) => {
      const code = socket.data.code; if (!code) return;
      const room = rooms.rooms.get(code); room?.disconnect(socket.data.playerId, now(), explicit);
      socket.leave(code); socket.data.code = undefined; socket.data.playerId = undefined; publish(code);
    };
    socket.on('room', (raw: unknown, callback: unknown) => {
      try {
        if (!roomLimit.allow(requestKey, now())) throw new Error('Too many room attempts. Wait a moment and try again.');
        if (socket.data.code) throw new Error('Leave your current room first.');
        if (!raw || typeof raw !== 'object') throw new Error('Invalid room request.');
        const data = raw as { action?: unknown; name?: unknown; code?: unknown; token?: unknown };
        if (data.action !== 'create' && data.action !== 'join' && data.action !== 'solo') throw new Error('Invalid room action.');
        const { room, player } = data.action === 'join' ? rooms.join(data.code, data.name, socket.id, now(), data.token) : rooms.create(data.name, socket.id, now(), data.action === 'solo' ? 'solo' : 'multiplayer');
        socket.data.code = room.code; socket.data.playerId = player.id; socket.join(room.code);
        ack(callback, { ok: true, id: player.id, token: player.token, snapshot: room.snapshot(now()) }); publish(room.code);
      } catch (e) { ack(callback, { ok: false, error: e instanceof Error ? e.message : 'Room request failed.' }); }
    });
    socket.on('action', (action: unknown, callback: unknown) => {
      try {
        if (!actionLimit.allow(socket.id, now())) throw new Error('Please wait before trying again.');
        const { room, player } = membership();
        if (action === 'start') room.start(player.id, now());
        else if (action === 'replay') room.replay(player.id);
        else if (action === 'leave') leave(true);
        else throw new Error('Unknown action.');
        ack(callback, { ok: true }); publish(room.code);
      } catch (e) { ack(callback, { ok: false, error: e instanceof Error ? e.message : 'Action failed.' }); }
    });
    socket.on('input', (input: unknown) => {
      if (!inputLimit.allow(socket.id, now())) return;
      try { const { room, player } = membership(); room.receive(player.id, input, now()); for (const event of room.drainEvents()) io.to(room.code).emit('event', event); } catch { /* Non-members have no gameplay authority. */ }
    });
    socket.on('pingCheck', (callback: unknown) => { if (actionLimit.allow(socket.id, now()) && typeof callback === 'function') callback(); });
    socket.on('disconnect', () => leave());
  });
  let previous = now(), accumulator = 0, broadcastAt = 0, cleanupAt = 0;
  const timer = setInterval(() => {
    const current = now(); accumulator = Math.min(accumulator + (current - previous) / 1000, RULES.tick * 5); previous = current;
    while (accumulator >= RULES.tick) { for (const room of rooms.rooms.values()) room.step(RULES.tick, current); accumulator -= RULES.tick; }
    if (current >= broadcastAt) { for (const room of rooms.rooms.values()) if (room.humans().length) publish(room.code); broadcastAt = current + RULES.snapshotMs; }
    if (current >= cleanupAt) { rooms.cleanup(current); roomLimit.cleanup(current); inputLimit.cleanup(current); actionLimit.cleanup(current); cleanupAt = current + 5000; }
  }, 1000 / 60);
  timer.unref();
  return { app, http, io, rooms, async close() { clearInterval(timer); await new Promise<void>(r => io.close(() => r())); } };
}
export function serveProduction(app: express.Express) { app.use(express.static(resolve('dist/client'))); app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html'))); }
