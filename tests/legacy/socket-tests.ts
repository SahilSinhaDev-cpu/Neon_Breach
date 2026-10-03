import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from './app';
import type { Reply, Snapshot } from '../../shared/protocol';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const request = (socket: Socket, event: string, data: unknown): Promise<Reply> => new Promise((resolve, reject) => socket.timeout(3000).emit(event, data, (err: Error | null, reply: Reply) => err ? reject(err) : resolve(reply)));
test('real Socket.IO clients share a match, movement, server hits, host transfer, results, and replay', async () => {
  const server = createGameServer(); await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
  const address = server.http.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`, clients: Socket[] = [];
  async function connect() { const s = io(url, { transports: ['websocket'], forceNew: true }); clients.push(s); await new Promise<void>(r => s.on('connect', r)); return s; }
  try {
    const [a, b, c] = await Promise.all([connect(), connect(), connect()]);
    const malformed = await request(c, 'room', null); assert.equal(malformed.ok, false);
    const created = await request(a, 'room', { action: 'create', name: 'VEX' }); assert.ok(created.ok && created.snapshot && created.id);
    const joined = await request(b, 'room', { action: 'join', name: 'NYX', code: created.snapshot.code }); assert.ok(joined.ok && joined.id);
    const joinedC = await request(c, 'room', { action: 'join', name: 'ION', code: created.snapshot.code }); assert.ok(joinedC.ok);
    assert.equal((await request(b, 'action', 'start')).ok, false); assert.equal((await request(a, 'action', 'start')).ok, true);
    let sa: Snapshot | null = null, sb: Snapshot | null = null; a.on('snapshot', s => sa = s); b.on('snapshot', s => sb = s);
    await pause(120); const firstA = (sa as unknown as Snapshot).players.find(p => p.id === created.id)!;
    a.emit('input', { seq: 1, life: 1, mx: 0, my: 1, yaw: firstA.yaw, pitch: 0, fire: false, dash: false, x: 9000, z: 9000 }); await pause(180);
    const observedA = (sb as unknown as Snapshot).players.find(p => p.id === created.id)!; assert.ok(Math.hypot(observedA.x - firstA.x, observedA.z - firstA.z) > 0.4); assert.ok(Math.abs(observedA.x) < 20);
    const room = server.rooms.rooms.get(created.snapshot.code)!, pa = room.players.get(created.id)!, pb = room.players.get(joined.id)!;
    // Test fixture positions are set inside the server, never supplied through the client protocol.
    Object.assign(pa, { x: 0, z: 10, yaw: 0, input: null, protectUntil: 0 }); Object.assign(pb, { x: 0, z: 7, protectUntil: 0 });
    a.emit('input', { seq: 2, life: 1, mx: 0, my: 0, yaw: 0, pitch: 0, fire: true, dash: false }); await pause(700);
    assert.equal(pb.hp, 32, 'held input fires twice before its 350ms stale timeout');
    a.emit('input', { seq: 3, life: 1, mx: 0, my: 0, yaw: 0, pitch: 0, fire: true, dash: false }); await pause(100); assert.equal(pb.hp, 0); assert.equal(pa.score, 1);
    a.disconnect(); await pause(100); assert.equal(room.phase, 'playing'); assert.equal(room.host, joined.id);
    c.disconnect(); await pause(100); assert.equal(room.phase, 'ended'); assert.equal(room.winner, joined.id);
    assert.equal((await request(b, 'action', 'replay')).ok, true); await pause(100); assert.equal(room.phase, 'lobby'); assert.equal(room.players.size, 1); assert.equal(pb.score, 0); assert.equal(pb.hp, 100);
  } finally { clients.forEach(s => s.disconnect()); await server.close(); }
});

test('solo socket action exposes bots, rejects other players, starts with one human, and cleans up on leave', async () => {
  const server = createGameServer(); await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
  const address = server.http.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const a = io(url, { transports: ['websocket'], forceNew: true }), b = io(url, { transports: ['websocket'], forceNew: true });
  try {
    await Promise.all([a, b].map(socket => new Promise<void>(resolve => socket.on('connect', resolve))));
    const reply = await request(a, 'room', { action: 'solo', name: 'VEX' }); assert.ok(reply.ok && reply.snapshot && reply.id);
    assert.equal(reply.snapshot.mode, 'solo'); assert.equal(reply.snapshot.players.filter(p => p.bot).length, 3);
    const denied = await request(b, 'room', { action: 'join', name: 'NYX', code: reply.snapshot.code }); assert.equal(denied.ok, false); assert.match(denied.error!, /private solo/);
    assert.equal((await request(a, 'action', 'start')).ok, true);
    const room = server.rooms.rooms.get(reply.snapshot.code)!; await pause(180); assert.equal(room.phase, 'playing'); assert.equal(room.humans().length, 1);
    assert.ok(room.connected().filter(p => p.bot).some(p => p.ack > 0));
    assert.equal((await request(a, 'action', 'leave')).ok, true); assert.equal(room.phase, 'ended'); assert.equal(room.winner, null); assert.equal(room.host, ''); assert.ok(room.emptyAt !== null);
    const multi = await request(b, 'room', { action: 'create', name: 'NYX', bot: true, mode: 'solo' }); assert.ok(multi.ok && multi.snapshot); assert.equal(multi.snapshot.mode, 'multiplayer'); assert.equal(multi.snapshot.players.length, 1); assert.equal(multi.snapshot.players[0].bot, false);
  } finally { a.disconnect(); b.disconnect(); await server.close(); }
});
