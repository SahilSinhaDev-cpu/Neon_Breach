import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '@netlify/blobs';
import { handleGame } from '../netlify/lib/authority';
import { createStrongStore } from '../netlify/lib/storage';
import { HEARTBEAT_MS, type GameRequest, type HttpReply } from '../shared/http-protocol';
import { RULES } from '../shared/world';
import { blobFixture } from './netlify-fixture';

async function duel() {
  const fixture = await blobFixture();
  let now = 1_000_000;
  const clients = [randomUUID(), randomUUID()];
  const seats: { code: string; token: string; client: string; id: string }[] = [];
  const call = async (packet: Partial<GameRequest>, store = fixture.store) => {
    const request = new Request('http://localhost/.netlify/functions/game', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), ...packet }),
    });
    const requestAt = now;
    const response = await handleGame(request, store, { now: () => requestAt, ip: packet.client });
    return { status: response.status, ...await response.json() as HttpReply };
  };
  const created = await call({ action: 'create', client: clients[0], name: 'VEX' });
  assert.ok(created.ok && created.snapshot && created.id && created.token);
  const code = created.snapshot.code;
  seats.push({ code, client: clients[0], token: created.token, id: created.id });
  now += 50;
  const joined = await call({ action: 'join', client: clients[1], name: 'NYX', code });
  assert.ok(joined.ok && joined.id && joined.token);
  seats.push({ code, client: clients[1], token: joined.token, id: joined.id });
  now += 250;
  const started = await call({ ...seats[0], action: 'start' });
  assert.equal(started.ok, true);
  return {
    fixture, code, seats, call,
    get now() { return now; },
    set now(value: number) { now = value; },
    action(index: number, action: GameRequest['action'], extra: Partial<GameRequest> = {}, store = fixture.store) {
      return call({ ...seats[index], action, ...extra }, store);
    },
  };
}

test('heartbeat-expired lobby seats recover without being mistaken for a competing tab', async () => {
  const game = await duel();
  try {
    await game.fixture.edit(game.code, data => { data.room.phase = 'lobby'; });
    game.now += HEARTBEAT_MS - 1000;
    await game.action(1, 'poll');
    game.now += 1200;
    const expired = await game.action(0, 'poll');
    assert.equal(expired.errorCode, 'SEAT_DISCONNECTED');
    const recovered = await game.call({ ...game.seats[0], action: 'join', name: 'VEX' });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.id, game.seats[0].id);
    assert.equal(recovered.snapshot!.players.length, 2);
    assert.equal(recovered.snapshot!.host, game.seats[1].id);
    game.now += 250;
    const replaced = await game.call({ ...game.seats[0], client: randomUUID(), action: 'join', name: 'VEX' });
    assert.equal(replaced.ok, true);
    assert.equal((await game.action(0, 'poll')).errorCode, 'SEAT_REPLACED');
  } finally { await game.fixture.close(); }
});

test('a hosted HTTP 409 write conflict reloads changed room state before acknowledging input', async () => {
  const game = await duel();
  try {
    let conflicts = 0;
    const store = createStrongStore('neon-breach-rooms-v1', { fetch: async (url, options) => {
      const headers = new Headers(options?.headers);
      if (options?.method?.toUpperCase() === 'PUT' && headers.has('if-match') && conflicts++ === 0) {
        await game.fixture.edit(game.code, data => { data.room.players[1].score = 2; });
        return new Response(null, { status: 409 });
      }
      return fetch(url, options);
    } });
    game.now += 100;
    const reply = await game.action(0, 'poll', { input: { seq: 1, life: 1, mx: 0, my: 1, yaw: 0, pitch: 0, fire: false, dash: false } }, store);
    assert.equal(reply.ok, true);
    assert.equal(reply.snapshot!.players[1].score, 2, 'Concurrent committed state must survive the retry');
    assert.equal(reply.snapshot!.players[0].ack, 1);
    assert.equal(conflicts, 2);
    assert.equal((await game.fixture.read(game.code)).room.players[1].score, 2);
  } finally { await game.fixture.close(); }
});

test('an older request that loses its CAS cannot rewind the room clock or heartbeats', async () => {
  const game = await duel();
  try {
    let release!: () => void, readReady!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { readReady = resolve; });
    let first = true;
    const store = new Proxy(game.fixture.store, { get(target, property) {
      if (property === 'getWithMetadata') return async (...args: Parameters<Store['getWithMetadata']>) => {
        const entry = await target.getWithMetadata(...args);
        if (first) { first = false; readReady(); await blocked; }
        return entry;
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as Store;
    game.now += 60;
    const delayed = game.action(0, 'poll', {}, store);
    await ready;
    game.now += 120;
    const newer = await game.action(1, 'poll');
    assert.equal(newer.ok, true);
    release();
    const older = await delayed;
    assert.equal(older.ok, true);
    assert.ok(older.snapshot!.now >= newer.snapshot!.now, 'snapshot time must remain monotonic after a CAS retry');
    const data = await game.fixture.read(game.code);
    assert.ok(data.activeAt >= newer.snapshot!.now);
    assert.ok(data.seen[game.seats[0].id] >= newer.snapshot!.now);
    assert.ok(data.seen[game.seats[1].id] >= newer.snapshot!.now);
  } finally { await game.fixture.close(); }
});

test('simulation uses fresh server time after a slow strong read', async () => {
  const game = await duel();
  try {
    let now = game.now + 60;
    let delayed = false;
    const store = new Proxy(game.fixture.store, { get(target, property) {
      if (property === 'getWithMetadata') return async (...args: Parameters<Store['getWithMetadata']>) => {
        const entry = await target.getWithMetadata(...args);
        if (!delayed) { delayed = true; now += 900; }
        return entry;
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as Store;
    const request = new Request('http://localhost/.netlify/functions/game', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...game.seats[0], action: 'poll', requestId: randomUUID() }),
    });
    const response = await handleGame(request, store, { now: () => now });
    const reply = await response.json() as HttpReply;
    assert.equal(reply.ok, true);
    assert.equal(reply.snapshot?.now, now);
    assert.equal((await game.fixture.read(game.code)).seen[game.seats[0].id], now);
  } finally { await game.fixture.close(); }
});

test('a rejected room action still commits the timeout winner and the authenticated heartbeat', async () => {
  const game = await duel();
  try {
    const data = await game.fixture.read(game.code);
    game.now = data.room.endsAt + 60;
    await game.fixture.edit(game.code, room => {
      room.simAt = room.room.endsAt - 200;
      room.activeAt = game.now - 100;
      for (const player of room.room.players) {
        room.seen[player.id] = game.now - 100;
        player.score = player.id === game.seats[1].id ? 2 : 0;
      }
    });
    const rejected = await game.action(1, 'start');
    assert.equal(rejected.status, 400);
    assert.match(rejected.error!, /Only the host/);
    const persisted = await game.fixture.read(game.code);
    assert.equal(persisted.room.phase, 'ended');
    assert.equal(persisted.room.winner, game.seats[1].id);
    assert.equal(persisted.room.reason, 'Contract time expired');
    assert.equal(persisted.seen[game.seats[1].id], game.now);
  } finally { await game.fixture.close(); }
});

test('a rate-limited poll cannot discard movement that the server already simulated', async () => {
  const game = await duel();
  try {
    game.now += 60;
    const moved = await game.action(0, 'poll', { input: { seq: 1, life: 1, mx: 1, my: 0, yaw: 0, pitch: 0, fire: false, dash: false } });
    assert.equal(moved.ok, true);
    const before = await game.fixture.read(game.code);
    game.now += 30;
    assert.equal((await game.action(0, 'poll')).status, 429);
    const after = await game.fixture.read(game.code);
    assert.ok(after.simAt > before.simAt);
    assert.ok(after.room.players[0].x > before.room.players[0].x);
    assert.equal(after.seen[game.seats[0].id], before.seen[game.seats[0].id]);
  } finally { await game.fixture.close(); }
});

test('a cold function preserves a timeout that occurred before heartbeat expiry', async () => {
  const game = await duel();
  try {
    const base = game.now;
    await game.fixture.edit(game.code, data => {
      data.room.endsAt = base + 500;
      data.simAt = base;
      data.activeAt = base;
      for (const player of data.room.players) {
        data.seen[player.id] = base;
        player.score = player.id === game.seats[1].id ? 5 : 1;
      }
    });
    game.now = base + HEARTBEAT_MS + 100;
    assert.equal((await game.action(0, 'poll')).status, 403);
    const persisted = await game.fixture.read(game.code);
    assert.equal(persisted.room.phase, 'ended');
    assert.equal(persisted.room.winner, game.seats[1].id);
    assert.equal(persisted.room.reason, 'Contract time expired');
    assert.ok(persisted.room.players.every(player => !player.connected));
    assert.equal(persisted.room.emptyAt, base + HEARTBEAT_MS);
  } finally { await game.fixture.close(); }
});

test('simultaneous missed heartbeats end an empty match without inventing a last connected winner', async () => {
  const game = await duel();
  try {
    const base = game.now;
    await game.fixture.edit(game.code, data => {
      data.simAt = base;
      data.activeAt = base;
      for (const player of data.room.players) data.seen[player.id] = base;
    });
    game.now = base + HEARTBEAT_MS + 100;
    assert.equal((await game.action(0, 'poll')).status, 403);
    const persisted = await game.fixture.read(game.code);
    assert.equal(persisted.room.phase, 'ended');
    assert.equal(persisted.room.winner, null);
    assert.equal(persisted.room.host, '');
    assert.equal(persisted.room.emptyAt, base + HEARTBEAT_MS);
    game.now = base + HEARTBEAT_MS + 30_000;
    const expired = await game.action(0, 'poll');
    assert.equal(expired.status, 404);
    assert.match(expired.error!, /expired/);
  } finally { await game.fixture.close(); }
});

test('a successful-looking conditional write with no ETag never acknowledges a room or input', async () => {
  const game = await duel();
  try {
    const missingEtagStore = (prefix: string) => new Proxy(game.fixture.store, { get(target, property) {
      if (property === 'setJSON') return async (...args: Parameters<Store['setJSON']>) => {
        if (args[0].startsWith(prefix)) return { modified: true, etag: '' };
        return target.setJSON(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as Store;
    const failedLimit = await game.call({ action: 'create', name: 'ION', client: randomUUID() }, missingEtagStore('limits/'));
    assert.equal(failedLimit.status, 503);
    assert.equal(failedLimit.id, undefined);
    const failedCreate = await game.call({ action: 'create', name: 'AXL', client: randomUUID() }, missingEtagStore('rooms/'));
    assert.equal(failedCreate.status, 503);
    assert.equal(failedCreate.id, undefined);
    const before = await game.fixture.read(game.code);
    game.now += 60;
    const failedInput = await game.action(0, 'poll', {}, missingEtagStore('rooms/'));
    assert.equal(failedInput.status, 503);
    assert.equal(failedInput.snapshot, undefined);
    const after = await game.fixture.read(game.code);
    assert.equal(after.revision, before.revision);
  } finally { await game.fixture.close(); }
});

test('accepted HTTP input bridges a 900 ms arrival gap but expires within the bounded server lease', async () => {
  const game = await duel();
  try {
    const movement = { seq: 1, life: 1, mx: 1, my: 0, yaw: 0, pitch: 0, fire: false, dash: false };
    game.now += 60;
    const first = await game.action(0, 'poll', { input: movement });
    assert.equal(first.ok, true);
    assert.ok(!('inputLeaseMs' in first.snapshot!.players[0]), 'server-owned lease stays out of the public snapshot');
    const before = await game.fixture.read(game.code);
    assert.equal(before.room.players[0].inputLeaseMs, 1500);
    game.now += 900;
    const second = await game.action(0, 'poll', { input: { ...movement, seq: 2 } });
    assert.equal(second.ok, true);
    const after = await game.fixture.read(game.code);
    const traveled = after.room.players[0].x - before.room.players[0].x;
    assert.ok(traveled >= 5.2 && traveled <= 5.5, `900 ms held movement should travel about 5.4 metres, got ${traveled}`);
    assert.ok(after.room.players[0].inputLeaseMs! > 1000 && after.room.players[0].inputLeaseMs! <= 2000);
    assert.equal(after.inputSamples?.[game.seats[0].id].at, game.now);
    game.now += 3500;
    assert.equal((await game.action(0, 'poll')).ok, true);
    const expired = await game.fixture.read(game.code);
    const extraDistance = expired.room.players[0].x - after.room.players[0].x;
    assert.ok(extraDistance > 0 && extraDistance <= RULES.speed * 2 + 0.1);
    game.now += 900;
    assert.equal((await game.action(0, 'poll')).ok, true);
    assert.equal((await game.fixture.read(game.code)).room.players[0].x, expired.room.players[0].x);
  } finally { await game.fixture.close(); }
});
