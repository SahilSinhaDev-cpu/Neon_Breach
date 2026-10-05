import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

export const FRONTEND_ORIGINS = ['https://neonbreach977.vercel.app', 'https://neonbreach977.netlify.app'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (socket, event, data) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, { requestId: randomUUID(), ...data }, (error, reply) => error ? reject(error) : resolve(reply)));

// Live smoke test with ordinary client packets. No test-only poses, clocks,
// health, scores or server access. Also usable against a temporary QA process.
export async function verifyBackend(origin, frontendOrigins = FRONTEND_ORIGINS) {
  assert.ok(frontendOrigins.length >= 1);
  const healthResponse = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(90_000) });
  const health = await healthResponse.json();
  assert.ok(healthResponse.ok && health.game === 'NEON BREACH' && health.protocol === 2 && health.release === '2026-10-05-navigation-1', 'Backend release health check failed.');
  const sockets = [], checks = ['Release health, protocol 2, 60 Hz tick and 20 Hz snapshots'];
  assert.equal(health.tickHz, 60); assert.equal(health.snapshotHz, 20);
  try {
    for (let i = 0; i < 2; i++) {
      const socket = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 15_000, auth: { protocol: 2 }, extraHeaders: { Origin: frontendOrigins[i % frontendOrigins.length] } });
      sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    }
    const [host, peer] = sockets;
    const created = await command(host, 'room', { action: 'create', name: 'RELEASEVEX' });
    assert.ok(created.ok, created.error);
    const joined = await command(peer, 'room', { action: 'join', name: 'RELEASENYX', code: created.snapshot.code });
    assert.ok(joined.ok, joined.error); assert.notEqual(created.id, joined.id);
    assert.equal(joined.snapshot.players.filter(p => p.connected && !p.bot).length, 2);
    checks.push('Two independent WebSocket clients create and join one human multiplayer room');
    let latest, hostLatest;
    peer.on('snapshot', packet => { latest = packet.snapshot; });
    host.on('snapshot', packet => { hostLatest = packet.snapshot; });
    const started = await command(host, 'action', { action: 'start' });
    assert.ok(started.ok, started.error); assert.equal(started.snapshot.phase, 'playing');
    const before = started.snapshot.players.find(p => p.id === created.id);
    for (let seq = 0; seq < 12; seq++) {
      host.emit('input', { seq, life: before.life, mx: 0, my: 1, yaw: before.yaw, pitch: 0, fire: false, dash: false });
      await pause(34);
    }
    const until = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await pause(25);
      assert.ok(predicate(), 'Timed out waiting for authoritative state.');
    };
    await until(() => {
      const after = latest?.players.find(p => p.id === created.id);
      return after && after.ack >= 11 && Math.hypot(after.x - before.x, after.z - before.z) > .5;
    });
    checks.push('Host starts and peer sees server-authoritative movement and input acknowledgement');
    assert.ok((await command(peer, 'action', { action: 'leave' })).ok);
    await until(() => hostLatest?.phase === 'ended' && hostLatest.winner === created.id);
    checks.push('Last connected operator wins after the peer leaves');
    const replay = await command(host, 'action', { action: 'replay' });
    assert.ok(replay.ok); assert.equal(replay.snapshot.phase, 'lobby');
    assert.equal(replay.snapshot.winner, null); assert.ok(replay.snapshot.players.every(p => p.score === 0));
    assert.ok((await command(host, 'action', { action: 'leave' })).ok);
    checks.push('Replay resets winner and scores; release test seats explicitly cleaned up');
    return { passed: true, origin, frontendOrigins, release: health.release, checks, scope: 'Automated WebSocket deployment smoke test. Does not replace a full hosted browser match.' };
  } finally {
    for (const socket of sockets) {
      if (socket.connected) { try { await command(socket, 'action', { action: 'leave' }); } catch {} }
      socket.disconnect();
    }
  }
}
