import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app';
import { RealtimeConnection } from '../client/realtime-connection';
import { parseGameConfig, REALTIME_VERSION, type RealtimeReply, type SnapshotPacket } from '../shared/realtime-protocol';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function fixture() {
  const server = createGameServer(); await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
  const address = server.http.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`, clients: Socket[] = [];
  const connect = async () => {
    const socket = io(url, { transports: ['websocket'], forceNew: true, auth: { protocol: REALTIME_VERSION } }); clients.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
  };
  return { server, url, connect, async close() { clients.forEach(s => s.disconnect()); await server.close(); } };
}
const request = (socket: Socket, event: string, raw: object): Promise<RealtimeReply> => new Promise((resolve, reject) => socket.timeout(3000).emit(event, { requestId: randomUUID(), ...raw }, (error: Error | null, reply: RealtimeReply) => error ? reject(error) : resolve(reply)));
const input = (seq: number, extra = {}) => ({ seq, life: 1, mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, dash: false, ...extra });

test('real-time config rejects credentials, non-TLS public URLs and invalid transport', () => {
  assert.deepEqual(parseGameConfig({ transport: 'websocket', serverUrl: 'https://example.com' }), { transport: 'websocket', serverUrl: 'https://example.com' });
  for (const serverUrl of ['http://example.com','https://user:secret@example.com','https://example.com/private?token=secret']) assert.throws(() => parseGameConfig({ transport: 'websocket', serverUrl }));
  assert.throws(() => parseGameConfig({ transport: 'fake', serverUrl: null }));
});

test('both production frontend origins can share the same room on the backend', async () => {
  const f = await fixture();
  const sockets: Socket[] = [];
  try {
    for (const Origin of ['https://neonbreach977.vercel.app', 'https://neonbreach977.netlify.app']) {
      const socket = io(f.url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { protocol: REALTIME_VERSION }, extraHeaders: { Origin } });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    }
    const created = await request(sockets[0], 'room', { action: 'create', name: 'VEX' });
    assert.ok(created.ok);
    const joined = await request(sockets[1], 'room', { action: 'join', name: 'NYX', code: created.snapshot!.code });
    assert.ok(joined.ok);
    assert.equal(joined.snapshot!.players.filter(p => p.connected).length, 2);
    assert.ok((await request(sockets[0], 'action', { action: 'start' })).ok);
  } finally { sockets.forEach(socket => socket.disconnect()); await f.close(); }
});

test('room commands are idempotent, seats recover, bad origins/protocols and nonmembers are rejected', async () => {
  const f = await fixture();
  try {
    const a = await f.connect(), b = await f.connect();
    const id = randomUUID(), create = { action: 'create', name: 'VEX', requestId: id };
    const first = await request(a, 'room', create), again = await request(a, 'room', create);
    assert.equal(first.id, again.id); assert.equal(f.server.rooms.rooms.size, 1);
    assert.equal((await request(a, 'action', { action: 'start' })).ok, false);
    const joined = await request(b, 'room', { action: 'join', name: 'NYX', code: first.snapshot!.code }); assert.ok(joined.ok);
    const room = f.server.rooms.rooms.get(first.snapshot!.code)!;
    b.disconnect(); await pause(80);
    const refreshed = await f.connect();
    const recovered = await request(refreshed, 'room', { action: 'join', name: 'NYX', code: room.code, token: joined.token });
    assert.equal(recovered.id, joined.id); assert.equal(room.players.size, 2);
    const thief = await f.connect();
    const denied = await request(thief, 'room', { action: 'join', name: 'NYX', code: room.code, token: joined.token }); assert.equal(denied.ok, false);
    assert.equal((await request(thief, 'action', { action: 'start' })).ok, false);
    thief.emit('input', input(1, { x: 5000 })); await pause(50); assert.equal(room.phase, 'lobby');
    assert.equal((await request(refreshed, 'action', { action: 'start' })).ok, false);
    const startId = randomUUID(); assert.equal((await request(a, 'action', { action: 'start', requestId: startId })).ok, true);
    assert.equal((await request(a, 'action', { action: 'start', requestId: startId })).ok, true); assert.equal(room.match, 1);
    assert.match((await request(thief, 'room', { action: 'join', name: 'ION', code: room.code })).error!, /progress/);
    for (const extra of [{ auth: { protocol: 999 } }, { auth: { protocol: REALTIME_VERSION }, extraHeaders: { Origin: 'https://evil.invalid' } }]) {
      const socket = io(f.url, { transports: ['websocket'], reconnection: false, ...extra });
      await new Promise<void>(resolve => socket.once('connect_error', () => resolve())); assert.equal(socket.connected, false); socket.close();
    }
  } finally { await f.close(); }
});

test('real-time movement pushes ~20 snapshots/sec; shots, cooldown, disconnect winner and replay stay authoritative', async () => {
  const f = await fixture();
  try {
    const a = await f.connect(), b = await f.connect();
    const created = await request(a, 'room', { action: 'create', name: 'VEX' });
    const joined = await request(b, 'room', { action: 'join', name: 'NYX', code: created.snapshot!.code });
    await request(a, 'action', { action: 'start' });
    const room = f.server.rooms.rooms.get(created.snapshot!.code)!, pa = room.players.get(created.id!)!, pb = room.players.get(joined.id!)!;
    Object.assign(pa, { x: 12, z: 16, yaw: 0, input: null });
    let snapshots = 0, observedZ = 16; b.on('snapshot', (packet: SnapshotPacket) => { snapshots++; const player = packet.snapshot.players.find(p => p.id === pa.id); if (player) observedZ = player.z; });
    let seq = 0; const sender = setInterval(() => a.volatile.emit('input', input(seq++, { my: 1 })), 33);
    await pause(1100); clearInterval(sender); await pause(60);
    assert.ok(snapshots >= 18 && snapshots <= 28, `${snapshots} snapshots`); assert.ok(observedZ < 10);
    const z = pa.z; await pause(500); assert.ok(z - pa.z < 2.3, 'Stale held input stops within 350 ms');
    Object.assign(pa, { x: 0, z: 0, input: null, protectUntil: 0 }); Object.assign(pb, { x: 0, z: -9, protectUntil: 0 });
    a.emit('input', input(seq++, { fire: true })); await pause(100); assert.equal(pb.hp, 100);
    Object.assign(pa, { x: 0, z: 10, input: null, lastFire: -Infinity }); Object.assign(pb, { x: 0, z: 7 });
    a.emit('input', input(seq++, { fire: true })); await pause(40); assert.equal(pb.hp, 66);
    for (let n = 0; n < 10; n++) a.emit('input', input(seq++, { fire: true })); await pause(40); assert.equal(pb.hp, 66);
    await pause(250); a.emit('input', input(seq++, { fire: true })); await pause(330); a.emit('input', input(seq++, { fire: true })); await pause(50);
    assert.equal(pb.hp, 0); assert.equal(pa.score, 1);
    a.disconnect(); await pause(80); assert.equal(room.host, pb.id); assert.equal(room.winner, pb.id);
    assert.equal((await request(b, 'action', { action: 'replay' })).ok, true); assert.equal(room.phase, 'lobby'); assert.equal(pb.score, 0);
  } finally { await f.close(); }
});

test('production real-time client recovers a lobby, never buffers offline inputs and detaches on leave', async () => {
  const f = await fixture(); const client = new RealtimeConnection(f.url);
  try {
    let seq = 0; client.sample = () => input(seq++, { my: 1 });
    await new Promise<void>(resolve => { client.on('connect', resolve); client.connect(); });
    const joined = await client.request('room', { action: 'solo', name: 'VEX' }); assert.ok(joined.ok);
    const room = f.server.rooms.rooms.get(joined.snapshot!.code)!;
    const recovered = new Promise<void>(resolve => client.on('lobby_recover', resolve));
    const socket = f.server.io.sockets.sockets.get(room.players.get(joined.id!)!.socketId!)!;
    socket.conn.close(); await recovered;
    assert.equal((await client.request('room', { action: 'join', name: 'VEX', code: room.code, token: joined.token })).id, joined.id);
    assert.equal((await client.request('action', 'start')).ok, true); await pause(200);
    const oldPlayer = room.players.get(joined.id!)!, ack = oldPlayer.ack;
    const home = await client.request('action', 'leave'); assert.ok(home.ok); assert.equal(room.players.has(joined.id!), false);
    await pause(150); assert.equal(oldPlayer.ack, ack); assert.equal(room.phase, 'ended');
  } finally { client.close(); await f.close(); }
});
