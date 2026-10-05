import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleGame } from '../netlify/lib/authority';
import { blobFixture } from './netlify-fixture';
import type { GameRequest, HttpReply } from '../shared/http-protocol';

test('standard Function confirms personal lobby exit, recovery, host transfer, quit and clean replay using conditional Blobs writes', async () => {
  const fixture = await blobFixture(); let now = 1_000_000;
  const call = async (packet: Partial<GameRequest>) => {
    const response = await handleGame(new Request('http://localhost/.netlify/functions/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), ...packet }) }), fixture.store, { now: () => now, ip: packet.client });
    return response.json() as Promise<HttpReply>;
  };
  try {
    const clients = [randomUUID(), randomUUID(), randomUUID()], a = await call({ action: 'create', name: 'VEX', client: clients[0] }); assert.ok(a.ok);
    const code = a.snapshot!.code, b = await call({ action: 'join', name: 'NYX', code, client: clients[1] }), c = await call({ action: 'join', name: 'ION', code, client: clients[2] }); assert.ok(b.ok && c.ok);
    const seats = [a, b, c].map((reply, i) => ({ token: reply.token, client: clients[i], code }));
    now += 250; assert.equal((await call({ ...seats[1], action: 'start' })).ok, false);
    assert.ok((await call({ ...seats[0], action: 'start' })).ok);
    now += 250; const requestId = randomUUID(), returned = await call({ ...seats[0], requestId, action: 'return-lobby' }); assert.ok(returned.ok);
    assert.equal(returned.snapshot!.phase, 'playing'); assert.equal(returned.snapshot!.host, b.id); assert.ok(returned.snapshot!.players.find(p => p.id === a.id)!.inLobby);
    now += 250; assert.ok((await call({ ...seats[0], requestId, action: 'return-lobby' })).ok);
    const refresh = await call({ ...seats[0], client: randomUUID(), name: 'VEX', action: 'join' }); assert.ok(refresh.ok); assert.equal(refresh.id, a.id); assert.equal(refresh.snapshot!.players.length, 3);
    assert.equal((await call({ ...seats[2], action: 'replay' })).ok, false);
    now += 250; assert.ok((await call({ ...seats[2], action: 'leave' })).ok);
    const after = await call({ ...seats[1], action: 'poll' }); assert.ok(after.ok); assert.equal(after.snapshot!.phase, 'ended'); assert.equal(after.snapshot!.winner, b.id);
    assert.equal(after.snapshot!.players.some(p => p.id === c.id), false); assert.equal(after.snapshot!.players.find(p => p.id === b.id)!.score, 0);
    now += 250; assert.ok((await call({ ...seats[2], action: 'leave' })).ok, 'lost leave acknowledgements are safe to retry');
    now += 250; const replay = await call({ ...seats[1], action: 'replay' }); assert.ok(replay.ok); assert.equal(replay.snapshot!.players.length, 2); assert.equal(replay.snapshot!.phase, 'lobby');
    assert.ok(replay.snapshot!.players.every(p => !p.inLobby && p.score === 0));
  } finally { await fixture.close(); }
});
