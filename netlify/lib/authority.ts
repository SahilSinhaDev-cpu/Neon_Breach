import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '@netlify/blobs';
import { Room, callsign, parseInput, randomCode, roomCode, type Player } from '../../server/game';
import { RULES } from '../../shared/world';
import { HEARTBEAT_MS, RELEASE, type GameRequest, type HttpReply } from '../../shared/http-protocol';
import { StorageError } from './storage';
import type { GameEvent } from '../../shared/protocol';

export const STORE_NAME = 'neon-breach-rooms-v1';
export type StoredRoom = {
  version: 1; revision: string; room: ReturnType<Room['serialize']>;
  simAt: number; activeAt: number; seen: Record<string, number>;
  cursor: number; events: { seq: number; event: GameEvent }[];
  requests: Record<string, { at: number; reply: HttpReply }>;
  actions: Record<string, number>; expired?: boolean; serverAt?: number;
  inputSamples?: Record<string, { at: number; interval: number }>;
};
class GameError extends Error { constructor(message: string, public status = 400, public code?: string) { super(message); } }
function fail(message: string, status = 400, code?: string): never { throw new GameError(message, status, code); }
type Outcome = { reply: HttpReply; status: number };
const ruleError = /Callsign|room code|Room full|callsign is already|private solo|Only the host|At least two|already started|Finish the current|Room not found|Match/;
function rejected(error: unknown): Outcome | null {
  if (error instanceof GameError) return { reply: { ok: false, error: error.message, errorCode: error.code }, status: error.status };
  if (error instanceof Error && ruleError.test(error.message)) return { reply: { ok: false, error: error.message }, status: 400 };
  return null;
}
function confirmedWrite(write: { modified: boolean; etag?: string }): boolean {
  if (!write.modified) return false;
  // The SDK currently reports modified:true for any conditional response other
  // than 412, including error responses. A successful Blobs PUT supplies an
  // ETag; never acknowledge room creation or input without that confirmation.
  if (typeof write.etag !== 'string' || !write.etag.trim()) fail('Station storage did not confirm the write. Retrying…', 503);
  return true;
}
const response = (value: HttpReply, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Neon-Release': RELEASE, ...extra } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function expired(data: StoredRoom, now: number) { return data.expired || now - data.activeAt > 15 * 60_000 || (data.room.emptyAt !== null && now - data.room.emptyAt >= 30_000); }

// All state touched by a room action lives in ONE blob. A failed ETag write
// discards the entire simulation/action and retries from a new strong read.
// There are no independent score writes or multi-key game transactions.
export function advance(data: StoredRoom, now: number) {
  const room = Room.restore(data.room);
  const expireHeartbeats = (until: number) => {
    const overdue = room.humans().map(player => ({ player, at: (data.seen[player.id] ?? 0) + HEARTBEAT_MS }))
      .filter(entry => entry.at <= until).sort((a, b) => a.at - b.at);
    for (let i = 0; i < overdue.length;) {
      const at = overdue[i].at;
      // Time expiry may precede a heartbeat deadline after a cold start. Apply
      // the events chronologically, preserving the winner at the match end.
      room.checkTimeout(at);
      const wasPlaying = room.phase === 'playing';
      do { room.disconnect(overdue[i++].player.id, at); } while (i < overdue.length && overdue[i].at === at);
      // Equal deadlines are simultaneous. Do not choose an arbitrary player
      // merely because the disconnect loop processed their seat last.
      if (wasPlaying && room.mode === 'multiplayer' && !room.humans().length) room.finish(null, 'Signal lost — no operators remain');
    }
  };
  // Catch-up is bounded by the last connected human's heartbeat deadline,
  // at most eight seconds. Once play ends, no simulation ticks are needed.
  const tick = RULES.tick * 1000;
  while (room.phase === 'playing' && data.simAt + tick <= now) {
    data.simAt += tick;
    expireHeartbeats(data.simAt);
    room.step(RULES.tick, data.simAt);
  }
  expireHeartbeats(now);
  room.checkTimeout(now); room.cleanup(now);
  if (room.phase !== 'playing') data.simAt = now;
  return room;
}
function collect(data: StoredRoom, room: Room) {
  for (const event of room.drainEvents()) data.events.push({ seq: ++data.cursor, event });
  data.events = data.events.slice(-128);
  data.room = room.serialize();
  for (const records of [data.seen, data.actions, data.inputSamples]) {
    if (records) for (const id of Object.keys(records)) if (!room.players.has(id)) delete records[id];
  }
}
function observeInput(data: StoredRoom, player: Player, now: number) {
  const samples = data.inputSamples ??= {};
  const prior = samples[player.id];
  // The previous WebSocket watchdog was shorter than a typical HTTP round
  // trip. Adapt only to server-observed accepted input arrivals, never packet
  // timestamps or client-provided leases. A missing stream still stops within
  // two seconds and cannot change speed, fire cooldowns or dash distance.
  const interval = prior ? prior.interval * 0.7 + Math.min(2000, Math.max(40, now - prior.at)) * 0.3 : 450;
  samples[player.id] = { at: now, interval };
  // Bridge two missed HTTP samples, while keeping the same hard safety bound.
  player.inputLeaseMs = Math.min(2000, Math.max(RULES.inputStaleMs, interval * 3 + 150));
}
function result(data: StoredRoom, room: Room, now: number, cursor: number): HttpReply {
  return { ok: true, snapshot: room.snapshot(now), cursor: data.cursor, events: data.events.filter(e => e.seq > cursor) };
}
async function mutate(store: Store, key: string, callback: (data: StoredRoom) => Outcome) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (!entry) fail('Room not found. Check the code with your host.', 404);
    if (!entry.etag) fail('Station storage did not supply an ETag. Retrying…', 503);
    const data = entry.data as StoredRoom;
    const reply = callback(data);
    // Unique revision avoids identical-content ETags / ABA, including polls.
    data.revision = randomUUID();
    const write = await store.setJSON(key, data, { onlyIfMatch: entry.etag });
    if (confirmedWrite(write)) return reply;
    await sleep(4 + Math.random() * (attempt + 1) * 6);
  }
  fail('The room is busy. Please try again.', 409);
}
async function rateLimit(store: Store, identity: string, now: number) {
  const key = `limits/${createHash('sha256').update(identity).digest('hex')}`;
  for (let i = 0; i < 8; i++) {
    const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (entry && !entry.etag) fail('Station storage did not supply an ETag. Retrying…', 503);
    const at = Math.max(now, entry?.data.at ?? now);
    const tokens = Math.min(12, (entry?.data.tokens ?? 12) + Math.max(0, at - (entry?.data.at ?? at)) / 1000 * 0.5);
    if (tokens < 1) fail('Too many room attempts. Wait a few seconds.', 429);
    const write = await store.setJSON(key, { at, tokens: tokens - 1, revision: randomUUID() }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (confirmedWrite(write)) return;
  }
  fail('Station busy. Try again shortly.', 429);
}
export async function handleGame(request: Request, store: Store, options: { now?: () => number; generate?: () => string; ip?: string } = {}): Promise<Response> {
  if (request.method === 'GET') return response({ ok: true });
  if (request.method !== 'POST') return response({ ok: false, error: 'Use POST for game actions.' }, 405);
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) fail('Cross-site game requests are not accepted.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('Send a JSON game request.', 415);
    if (Number(request.headers.get('content-length') ?? 0) > 8192) fail('Game request too large.', 413);
    const body = await request.text(); if (body.length > 8192) fail('Game request too large.', 413);
    let packet: GameRequest; try { packet = JSON.parse(body); } catch { return response({ ok: false, error: 'Malformed JSON.' }, 400); }
    if (!packet || typeof packet !== 'object') fail('Invalid game request.');
    const { action, client, requestId } = packet;
    if (!['create', 'solo', 'join', 'poll', 'start', 'replay', 'leave'].includes(action)) fail('Unknown game action.');
    if (typeof client !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(client) || typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) fail('Invalid session identifier.');
    const clock = options.now ?? Date.now;
    const now = clock();
    if (['create', 'solo', 'join'].includes(action)) await rateLimit(store, options.ip ?? 'local', now);
    if (action === 'create' || action === 'solo') {
      const name = callsign(packet.name);
      for (let i = 0; i < 100; i++) {
        const time = Math.max(now, clock());
        const code = (options.generate ?? randomCode)(), room = new Room(code, action === 'solo' ? 'solo' : 'multiplayer');
        const player = room.add(name, client, time); if (action === 'solo') room.addPracticeBots();
        const data: StoredRoom = { version: 1, revision: randomUUID(), room: room.serialize(), simAt: time, activeAt: time, serverAt: time, seen: { [player.id]: time }, cursor: 0, events: [], requests: {}, actions: {} };
        const write = await store.setJSON(`rooms/${code}`, data, { onlyIfNew: true });
        if (confirmedWrite(write)) return response({ ...result(data, room, time, 0), id: player.id, token: player.token });
      }
      fail('Could not allocate a room. Try again.', 503);
    }
    const code = roomCode(packet.code), cursor = packet.cursor ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) fail('Invalid event cursor.');
    if (packet.input !== undefined && !parseInput(packet.input)) fail('Invalid movement or aim.');
    const outcome = await mutate(store, `rooms/${code}`, data => {
      // A request can lose a CAS to one that arrived later. Recompute from the
      // committed clock so retries never roll back heartbeats or cooldowns.
      const time = Math.max(now, clock(), data.serverAt ?? data.activeAt, data.simAt);
      data.serverAt = time;
      if (expired(data, time)) { data.expired = true; return { reply: { ok: false, error: 'Room expired. Create a new room.' }, status: 404 }; }
      const room = advance(data, time);
      if (room.emptyAt !== null && time - room.emptyAt >= 30_000) {
        collect(data, room); data.expired = true;
        return { reply: { ok: false, error: 'Room expired. Create a new room.' }, status: 404 };
      }
      try {
        let player = [...room.players.values()].find(p => !p.bot && p.token === packet.token);
        if (action === 'join') {
          if (player) {
            if (room.phase !== 'lobby') fail('Match already in progress. Join after the host returns to the lobby.');
            if (player.name !== callsign(packet.name)) fail('This seat belongs to another callsign.', 403);
            // Refresh rotates the lease, never duplicates the player or its bots.
            player.connected = true; player.socketId = client; player.leftAt = 0;
            room.emptyAt = null; if (!room.host) room.host = player.id;
          } else player = room.add(packet.name, client, time);
          data.seen[player.id] = time; data.activeAt = time; collect(data, room);
          return { reply: { ...result(data, room, time, data.cursor), id: player.id, token: player.token }, status: 200 };
        }
        if (!player) fail('Your seat is no longer available. Return home to join a lobby.', 403, 'INVALID_SEAT');
        if (!player.connected) fail('Your seat is disconnected. Return home to join a lobby.', 403, 'SEAT_DISCONNECTED');
        if (player.socketId !== client) fail('Your seat is open in another tab. Return home to join a lobby.', 403, 'SEAT_REPLACED');
        const cacheKey = `${player.id}:${requestId}`, cached = data.requests[cacheKey];
        // Retransmitting an acknowledged action cannot start twice, replay twice,
        // or apply the same dash/shot a second time.
        if (cached) { data.seen[player.id] = time; data.activeAt = time; collect(data, room); return { reply: result(data, room, time, cursor), status: 200 }; }
        if (action !== 'poll' && time - (data.actions[player.id] ?? 0) < 200) fail('Please wait before another room action.', 429);
        if (action === 'poll' && time - (data.seen[player.id] ?? 0) < 40) fail('Input rate exceeded.', 429);
        data.seen[player.id] = time; data.activeAt = time;
        if (action === 'poll' && packet.input !== undefined && room.receive(player.id, packet.input, time)) observeInput(data, player, time);
        if (action === 'start') { room.start(player.id, time); data.simAt = time; data.inputSamples = {}; }
        if (action === 'replay') { room.replay(player.id); data.inputSamples = {}; }
        if (action === 'leave') room.disconnect(player.id, time, true);
        if (action !== 'poll') data.actions[player.id] = time;
        collect(data, room);
        const reply = result(data, room, time, cursor);
        if (action !== 'poll') data.requests[cacheKey] = { at: time, reply };
        for (const [key, cached] of Object.entries(data.requests)) if (time - cached.at > 30_000) delete data.requests[key];
        return { reply, status: 200 };
      } catch (error) {
        const outcome = rejected(error);
        if (!outcome) throw error;
        // Reject the action, not elapsed game time. Expiry, movement and match
        // results must survive even when this particular request is invalid.
        collect(data, room);
        return outcome;
      }
    });
    return response(outcome.reply, outcome.status);
  } catch (error) {
    if (error instanceof GameError) return response({ ok: false, error: error.message, errorCode: error.code }, error.status);
    // Known game-rule errors are safe plain text; infrastructure errors never
    // expose credentials, storage URLs, or stack traces to the browser.
    if (error instanceof Error && ruleError.test(error.message)) return response({ ok: false, error: error.message }, 400);
    console.error('Game storage request failed', error instanceof StorageError ? { status: error.status, timedOut: error.timedOut } : error instanceof Error ? error.name : 'UnknownError');
    return response({ ok: false, error: 'Station storage is temporarily unavailable. Retrying…', errorCode: 'STORAGE_UNAVAILABLE', retryable: true, retryAfterMs: error instanceof StorageError ? error.retryAfterMs : 0 }, 503,
      error instanceof StorageError ? { 'X-Neon-Storage-Status': String(error.status) } : {});
  }
}
