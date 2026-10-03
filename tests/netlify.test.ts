import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '@netlify/blobs';
import { handleGame, type StoredRoom } from '../netlify/lib/authority';
import { blobFixture } from './netlify-fixture';
import type { GameRequest, HttpReply } from '../shared/http-protocol';

test('Netlify Blobs authority: strong reads, conditional creation, collisions, concurrent updates, full gameplay and replay', async t => {
  const fixture = await blobFixture(); let now = 1_000_000;
  const clients = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const seats: { code: string; token: string; client: string; id: string }[] = [];
  let reads = 0, conditional = 0, rejected = 0;
  // Delegate every operation to the real SDK/emulator, but count contracts and
  // deliberately fail one CAS to prove recomputation, not just the happy path.
  let forceConflict = false;
  const store = new Proxy(fixture.store, { get(target, property) {
    if (property === 'getWithMetadata') return async (key: string, options: any) => { assert.equal(options.consistency, 'strong'); reads++; return target.getWithMetadata(key, options); };
    if (property === 'setJSON') return async (key: string, value: any, options: any) => {
      assert.ok(options.onlyIfMatch || options.onlyIfNew); conditional++;
      if (forceConflict && key.startsWith('rooms/') && options.onlyIfMatch) { forceConflict = false; rejected++; return { modified: false }; }
      const result = await target.setJSON(key, value, options); if (!result.modified) rejected++; return result;
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } }) as Store;
  const call = async (packet: Partial<GameRequest>, generate?: () => string) => {
    const request = new Request('http://localhost/.netlify/functions/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), ...packet }) });
    const response = await handleGame(request, store, { now: () => now, generate, ip: packet.client });
    return { status: response.status, ...await response.json() as HttpReply };
  };
  const action = (index: number, action: GameRequest['action'], extra: Partial<GameRequest> = {}) => call({ ...seats[index], action, ...extra });
  let seq = 0;
  const input = (index: number, extra = {}) => ({ seq: seq++, life: 1, mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, dash: false, ...extra });
  async function tick(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) { now += Math.min(1000, ms - elapsed); for (let i = 0; i < Math.min(seats.length, 2); i++) assert.equal((await action(i, 'poll')).ok, true); }
  }
  try {
    await t.test('validation, collisions and full-room errors', async () => {
      assert.equal((await call({ action: 'create', client: clients[0], name: '<script>' })).ok, false);
      const a = await call({ action: 'create', client: clients[0], name: 'VEX' }, () => 'ABC234'); assert.ok(a.ok && a.snapshot && a.token && a.id);
      seats.push({ code: a.snapshot.code, token: a.token, client: clients[0], id: a.id });
      let n = 0; const collision = await call({ action: 'create', client: clients[4], name: 'ION' }, () => ++n === 1 ? 'ABC234' : 'BCD345'); assert.equal(collision.snapshot?.code, 'BCD345'); assert.equal(n, 2);
      assert.equal((await call({ action: 'join', client: clients[1], code: 'BAD', name: 'NYX' })).ok, false);
      assert.equal((await action(0, 'start')).ok, false);
      for (let i = 1; i < 4; i++) { now += 250; const reply = await call({ action: 'join', code: 'ABC234', client: clients[i], name: ['VEX', 'NYX', 'ION', 'AXL'][i] }); assert.ok(reply.ok && reply.token && reply.id); seats.push({ code: 'ABC234', token: reply.token, client: clients[i], id: reply.id }); }
      const full = await call({ action: 'join', code: 'ABC234', client: clients[4], name: 'ZED' }); assert.match(full.error!, /full/);
      now += 250; await action(3, 'leave'); now += 250; await action(2, 'leave'); seats.splice(2);
    });
    await t.test('refresh lease, authentication and host-only idempotent start', async () => {
      now += 250; const original = seats[1]; const client = randomUUID();
      const recovered = await call({ ...original, client, action: 'join', name: 'NYX' }); assert.equal(recovered.id, original.id); assert.equal(recovered.snapshot?.players.length, 2);
      assert.equal((await action(1, 'poll')).status, 403); seats[1].client = client;
      assert.equal((await call({ ...seats[1], token: 'fabricated', action: 'start' })).status, 403);
      assert.equal((await action(1, 'start')).ok, false);
      const requestId = randomUUID(); now += 250; assert.equal((await action(0, 'start', { requestId })).ok, true);
      now += 250; const retried = await action(0, 'start', { requestId }); assert.equal(retried.ok, true); assert.equal(retried.snapshot?.match, 1);
      assert.match((await call({ action: 'join', client: clients[4], code: 'ABC234', name: 'ZED' })).error!, /progress/);
      assert.ok((await fixture.read('ABC234')).room.players.every(p => p.lastFire === null));
    });
    await t.test('concurrent inputs and failed ETag retry retain both players', async () => {
      now += 60; forceConflict = true;
      const replies = await Promise.all([action(0, 'poll', { input: input(0, { my: 1 }) }), action(1, 'poll', { input: input(1, { mx: 1 }) })]);
      assert.ok(replies.every(r => r.ok)); await tick(200);
      const data = await fixture.read('ABC234'); assert.ok(data.room.players.every(p => p.ack >= 0));
      assert.ok(data.room.players.some(p => Math.hypot(p.x + 16, p.z + 16) > 0.1));
      assert.ok(rejected >= 2); assert.ok(reads > 0 && conditional > 0);
      assert.equal((await action(0, 'poll', { input: { ...input(0), yaw: Infinity } })).ok, false);
    });
    await t.test('cover, rapid fire, three-hit scoring, five-second respawn and protection', async () => {
      await tick(1200);
      await fixture.edit('ABC234', data => { for (const p of data.room.players) { Object.assign(p, { x: 0, z: p.id === seats[0].id ? 0 : -9, input: null, protectUntil: 0 }); } });
      now += 300; const blocked = await action(0, 'poll', { input: input(0, { fire: true }) }); assert.ok(blocked.ok); assert.equal(blocked.snapshot!.players[1].hp, 100);
      await fixture.edit('ABC234', data => { Object.assign(data.room.players[0], { x: 0, z: 10, input: null, lastFire: null }); Object.assign(data.room.players[1], { x: 0, z: 7, input: null }); });
      now += 60; const one = await action(0, 'poll', { input: input(0, { fire: true }) }); assert.equal(one.snapshot!.players[1].hp, 66);
      now += 60; const rapid = await action(0, 'poll', { input: input(0, { fire: true }) }); assert.equal(rapid.snapshot!.players[1].hp, 66);
      // Stop held input. Subsequent authoritative shots occur 280+ ms apart.
      now += 60; await action(0, 'poll', { input: input(0) }); now += 200; await action(0, 'poll', { input: input(0, { fire: true }) });
      now += 60; await action(0, 'poll', { input: input(0) }); now += 230; const kill = await action(0, 'poll', { input: input(0, { fire: true }) });
      assert.equal(kill.snapshot!.players[1].hp, 0); assert.equal(kill.snapshot!.players[0].score, 1); const due = kill.snapshot!.players[1].respawnAt;
      await tick(4900); assert.equal((await fixture.read('ABC234')).room.players[1].hp, 0);
      await tick(120); const born = (await fixture.read('ABC234')).room; assert.equal(born.players[1].hp, 100); assert.ok(now >= due); assert.ok(born.players[1].protectUntil - due >= 1000 && born.players[1].protectUntil - due < 1017);
      const noFire = await action(1, 'poll', { input: input(1, { life: 2, fire: true }) }); assert.equal(noFire.ok, false); // request rate limit at same instant
      now += 60; const protectedReply = await action(1, 'poll', { input: input(1, { life: 2, fire: true }) }); assert.ok(protectedReply.ok); assert.equal(protectedReply.events?.filter(e => e.event.type === 'shot' && e.event.shot.shooter === seats[1].id).length ?? 0, 0);
      await tick(1000);
    });
    await t.test('dash collision, cooldown, Phase Cell single pickup and expiration', async () => {
      await fixture.edit('ABC234', data => { Object.assign(data.room.players[0], { x: 0, z: -18, input: null, dashAt: 0 }); });
      now += 60; const dash = await action(0, 'poll', { input: input(0, { dash: true }) }); assert.ok(dash.snapshot!.players[0].z >= -19.58); assert.ok(dash.snapshot!.players[0].z < -19.4);
      const cooldown = dash.snapshot!.players[0].dashAt; now += 60; const again = await action(0, 'poll', { input: input(0, { dash: true }) }); assert.equal(again.snapshot!.players[0].dashAt, cooldown);
      await tick(20_000); assert.equal((await fixture.read('ABC234')).room.cell, true);
      await fixture.edit('ABC234', data => { Object.assign(data.room.players[0], { x: 0, z: 0, input: null }); Object.assign(data.room.players[1], { x: 0, z: 0, input: null }); });
      await tick(60); const picked = await fixture.read('ABC234'); assert.equal(picked.room.cell, false); assert.equal(picked.room.players.filter(p => p.phaseUntil > now).length, 1);
      await fixture.edit('ABC234', data => { for (const p of data.room.players) { p.x = 10; p.z = 10; } });
      await tick(4000); assert.ok((await fixture.read('ABC234')).room.players.every(p => p.phaseUntil === 0));
      await tick(16000); assert.equal((await fixture.read('ABC234')).room.cell, true);
    });
    await t.test('timeout winner, clean replay, zero-score join-order tie and disconnect winner', async () => {
      const data = await fixture.read('ABC234'); await tick(data.room.endsAt - now + 40);
      now += 60; const finished = await action(0, 'poll'); assert.equal(finished.snapshot?.phase, 'ended'); assert.equal(finished.snapshot?.winner, seats[0].id); assert.equal(finished.snapshot?.players[0].score, 1);
      now += 250; const replay = await action(0, 'replay'); assert.equal(replay.snapshot?.phase, 'lobby'); assert.ok(replay.snapshot?.players.every(p => p.score === 0 && p.hp === 100 && !('input' in p)));
      now += 250; await action(0, 'start'); await tick(180040); now += 60; const tie = await action(1, 'poll'); assert.equal(tie.snapshot?.winner, seats[0].id);
      now += 250; await action(0, 'replay'); now += 250; await action(0, 'start'); now += 250; await action(0, 'leave');
      now += 60; const disconnect = await action(1, 'poll'); assert.equal(disconnect.snapshot?.winner, seats[1].id); assert.equal(disconnect.snapshot?.host, seats[1].id);
      now += 250; await action(1, 'replay'); assert.equal((await fixture.read('ABC234')).room.players.length, 1);
    });
    await t.test('heartbeat disconnect and expiry survive fresh function invocations', async () => {
      // Refresh a second seat in the open lobby, then let it miss heartbeats.
      now += 250; const joining = await call({ action: 'join', client: clients[2], code: 'ABC234', name: 'AXL' }); assert.ok(joining.ok);
      now += 250; await action(1, 'start');
      for (let i = 0; i < 9; i++) { now += 1000; await action(1, 'poll'); }
      now += 60; const survivor = await action(1, 'poll'); assert.equal(survivor.snapshot?.phase, 'ended'); assert.equal(survivor.snapshot?.winner, seats[1].id);
      now += 250; await action(1, 'leave'); now += 31_000; assert.match((await action(1, 'poll')).error!, /expired/);
      const fresh = await handleGame(new Request('http://localhost/.netlify/functions/game'), fixture.store); assert.equal(fresh.status, 200);
    });
    await t.test('malformed packets and cross-site requests are rejected safely', async () => {
      for (const body of ['null', '{', '[]']) { const response = await handleGame(new Request('http://localhost/.netlify/functions/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), fixture.store); assert.equal(response.status, 400); }
      const response = await handleGame(new Request('http://localhost/.netlify/functions/game', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' }), fixture.store); assert.equal(response.status, 403);
    });
  } finally { await fixture.close(); }
});
