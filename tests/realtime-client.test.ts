import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeConnection } from '../client/realtime-connection';
import { Room } from '../server/game';
import { REALTIME_VERSION } from '../shared/realtime-protocol';
import type { io } from 'socket.io-client';

const pause = () => new Promise(r => setTimeout(r, 0));
class FakeSocket {
  connected = false;
  listeners = new Map<string, Function[]>();
  requests: { event: string; value: any; ack: Function }[] = [];
  volatile = { emit() {} };
  on(event: string, callback: Function) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]); }
  receive(event: string, ...values: any[]) { for (const fn of this.listeners.get(event) ?? []) fn(...values); }
  timeout() { return { emit: (event: string, value: any, ack?: Function) => { if (event !== 'pingCheck') this.requests.push({ event, value, ack: ack! }); } }; }
  connect() { this.connected = true; this.receive('connect'); }
  disconnect() { this.connected = false; this.receive('disconnect'); }
}
function fixture() {
  const socket = new FakeSocket(), client = new RealtimeConnection('http://localhost', (() => socket) as unknown as typeof io);
  const room = new Room('ABCDEF'), player = room.add('VEX', 'fake', 0);
  const reply = { ok: true, id: player.id, token: player.token, snapshot: room.snapshot(0) };
  client.connect(); socket.receive('hello', { epoch: 'one', protocol: REALTIME_VERSION });
  return { socket, client, room, reply };
}
test('lost room acknowledgement retries the same command ID on the same connection', async () => {
  const f = fixture();
  try {
    const pending = f.client.request('room', { action: 'create', name: 'VEX' }); await pause();
    f.socket.requests[0].ack(new Error('lost')); await pause();
    assert.equal(f.socket.requests[1].value.requestId, f.socket.requests[0].value.requestId);
    f.socket.requests[1].ack(null, f.reply); assert.equal((await pending).id, f.reply.id);
  } finally { f.client.close(); }
});
test('acknowledgement from an old connection cannot install a seat or retry creation', async () => {
  const f = fixture();
  try {
    const pending = f.client.request('room', { action: 'create', name: 'VEX' }); await pause();
    f.socket.disconnect(); f.socket.connect(); f.socket.requests[0].ack(null, f.reply);
    assert.equal((await pending).ok, false); assert.equal(f.socket.requests.length, 1);
    let snapshots = 0; f.client.on('snapshot', () => snapshots++);
    f.socket.receive('snapshot', { epoch: 'one', seq: 1, snapshot: f.room.snapshot(1) }); assert.equal(snapshots, 0);
  } finally { f.client.close(); }
});
test('leaving during room creation cleans up the late seat without reopening gameplay', async () => {
  const f = fixture();
  try {
    const pending = f.client.request('room', { action: 'create', name: 'VEX' }); await pause();
    const left = f.client.request('action', 'leave'); f.socket.requests[0].ack(null, f.reply); await pause();
    assert.equal(f.socket.requests[1].value.action, 'leave'); f.socket.requests[1].ack(null, { ok: true });
    assert.equal((await pending).ok, false); await pause();
    f.socket.requests[2].ack(null, { ok: true }); assert.equal((await left).ok, true);
  } finally { f.client.close(); }
});
test('snapshot stream rejects older sequences and previous server epochs', async () => {
  const f = fixture();
  try {
    const pending = f.client.request('room', { action: 'create', name: 'VEX' }); await pause(); f.socket.requests[0].ack(null, f.reply); await pending;
    const observed: number[] = []; f.client.on('snapshot', s => observed.push(s.now));
    for (const [epoch, seq, now] of [['one', 3, 30], ['one', 2, 20], ['old', 4, 40], ['one', 4, 50]] as const) f.socket.receive('snapshot', { epoch, seq, snapshot: f.room.snapshot(now) });
    assert.deepEqual(observed, [30, 50]);
  } finally { f.client.close(); }
});
test('pausing cancels a lost WebSocket dash instead of moving the paused operator', async () => {
  const f = fixture(); let active = true, seq = 0; const packets: any[] = [];
  const player = f.room.players.get(f.reply.id)!; f.room.add('NYX', 'peer', 0); f.room.start(player.id, 0);
  Object.assign(player, { x: 10, z: 10, yaw: 0 });
  try {
    f.client.canAct = () => active;
    f.client.sample = () => ({ seq: seq++, life: player.life, mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, dash: active });
    f.socket.volatile.emit = (_event?: string, packet?: any) => {
      packets.push(packet);
      if (packets.length === 1) active = false; // First dash packet is lost.
      else f.room.receive(player.id, packet, 2500);
    };
    const pending = f.client.request('room', { action: 'create', name: 'VEX' }); await pause();
    f.socket.requests[0].ack(null, { ...f.reply, snapshot: f.room.snapshot(2000) }); await pending;
    await new Promise(r => setTimeout(r, 100));
    assert.ok(packets.length >= 2); assert.equal(packets[0].dash, true); assert.ok(packets.slice(1).every(p => !p.dash && !p.fire));
    assert.equal(player.z, 10); assert.equal(player.dashAt, 0);
  } finally { f.client.close(); }
});
