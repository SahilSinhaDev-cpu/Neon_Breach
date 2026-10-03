import test from 'node:test';
import assert from 'node:assert/strict';
import { localCorrection, motionDiscontinuity, predictionLead, remotePose, smoothRemotePosition, type TimedSnapshot } from '../client/network-motion';
import { validPosition } from '../shared/world';
import type { Input, PublicPlayer, Snapshot } from '../shared/protocol';

const player = (extra: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id: 'operator', name: 'VEX', color: '#73fbd3', order: 0, connected: true, bot: false,
  x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, score: 0, scoreAt: 0, deaths: 0,
  respawnAt: 0, protectUntil: 0, phaseUntil: 0, dashAt: 0, ack: 0, life: 1, ...extra,
});
const input: Input = { seq: 1, life: 1, mx: 1, my: 0, yaw: 0, pitch: 0, fire: false, dash: false };
function timed(now: number, at: number, p: PublicPlayer, extra: Partial<Snapshot> = {}): TimedSnapshot {
  return { at, state: { code: 'ABC234', mode: 'multiplayer', phase: 'playing', host: p.id,
    now, startedAt: 0, endsAt: 180_000, cell: false, cellAt: 20_000, winner: null, reason: '', match: 1, players: [p], ...extra } };
}

test('slow HTTP local correction predicts bounded round-trip age instead of stopping at 100 ms', () => {
  assert.equal(predictionLead(900), 350); assert.equal(predictionLead(100), 50);
  assert.equal(predictionLead(100_000), 350); assert.equal(predictionLead(-1), 0);
  assert.equal(predictionLead(NaN), 0); assert.equal(predictionLead(Infinity), 0);
  assert.ok(Math.abs(localCorrection(player(), input, 900).x - 2.1) < 1e-9);
});

test('local prediction stops at arena walls and never moves an eliminated operator', () => {
  const position = localCorrection(player({ x: 19.5 }), input, 900);
  assert.ok(position.x <= 19.58); assert.ok(validPosition(position.x, position.z));
  assert.deepEqual(localCorrection(player({ x: 2, z: 3, hp: 0 }), input, 900), { x: 2, z: 3 });
});

test('a 5.4-meter walk over a 900 ms snapshot interval is continuous; impossible fast movement is not', () => {
  assert.equal(motionDiscontinuity(player(), player({ x: 5.4 }), 900), false);
  assert.equal(motionDiscontinuity(player(), player({ x: 5.4 }), 200), true);
  assert.equal(motionDiscontinuity(player(), player({ x: 1 }), 0), true);
});

test('life changes, down state, disconnected seats and dash acknowledgements reset remote motion', () => {
  for (const extra of [{ life: 2 }, { hp: 0 }, { connected: false }, { dashAt: 3000 }]) {
    assert.equal(motionDiscontinuity(player(), player(extra), 900), true);
  }
  const first = timed(0, 0, player({ x: -16, z: -16 }));
  for (const next of [player({ x: 16, z: 16, life: 2 }), player({ x: -10, z: -16, dashAt: 3000 })]) {
    const pose = remotePose([first, timed(900, 900, next)], 'operator', 1200)!;
    assert.equal(pose.discontinuity, true); assert.equal(pose.x, next.x); assert.equal(pose.z, next.z);
    assert.equal(pose.vx, 0); assert.equal(pose.vz, 0);
  }
});

test('late rendering estimates remote velocity from the latest two snapshots, including a direction reversal', () => {
  const history = [timed(0, 1000, player()), timed(500, 1500, player({ x: 3 })), timed(800, 1800, player({ x: 1.2 }))];
  const pose = remotePose(history, 'operator', 1900)!;
  assert.equal(pose.discontinuity, false); assert.ok(Math.abs(pose.vx + 6) < 1e-9);
  assert.ok(Math.abs(pose.x - 0.6) < 1e-9);
});

test('remote extrapolation is limited to 350 ms and stops gait velocity after that bound', () => {
  const history = [timed(0, 0, player()), timed(900, 900, player({ x: 5.4 }))];
  const pose = remotePose(history, 'operator', 10_000)!;
  assert.equal(pose.discontinuity, false); assert.ok(Math.abs(pose.x - 7.5) < 1e-9);
  assert.equal(pose.vx, 0); assert.equal(pose.vz, 0);
});

test('remote extrapolation collides with walls and central cover', () => {
  for (const history of [
    [timed(0, 0, player({ x: 18 })), timed(200, 200, player({ x: 19.2 }))],
    [timed(0, 0, player({ z: -3 })), timed(200, 200, player({ z: -3.5 }))],
  ]) {
    const pose = remotePose(history, 'operator', 550)!;
    assert.equal(pose.discontinuity, false); assert.ok(validPosition(pose.x, pose.z));
    assert.ok(pose.x <= 19.58); assert.ok(pose.z >= -3.68);
  }
});

test('sparse interpolation cannot cut through a cover pillar between valid endpoints', () => {
  const history = [timed(0, 0, player({ x: -10, z: -4 })), timed(2000, 2000, player({ x: -4, z: -4 }))];
  const pose = remotePose(history, 'operator', 1000)!;
  assert.equal(pose.discontinuity, false); assert.ok(validPosition(pose.x, pose.z));
  assert.ok(pose.x <= -8.92);
});

test('remote aim interpolates through the short side of the yaw wrap and resets on a new match', () => {
  const history = [timed(0, 0, player({ yaw: 3.1, pitch: 0.2 })), timed(100, 100, player({ yaw: -3.1, pitch: 0.4 }))];
  const pose = remotePose(history, 'operator', 50)!;
  assert.ok(Math.abs(pose.yaw - Math.PI) < 1e-9); assert.ok(Math.abs(pose.pitch - 0.3) < 1e-9);
  history[1].state.match = 2;
  assert.equal(remotePose(history, 'operator', 50)!.discontinuity, true);
  assert.equal(remotePose([], 'operator', 50), null);
});

test('render correction smooths ordinary walking but cannot trap an opponent on the wrong side of a pillar', () => {
  const target = { x: 1, z: 0, yaw: 0, pitch: 0, vx: 6, vz: 0, discontinuity: false };
  const smooth = smoothRemotePosition({ x: 0, z: 0 }, target, 1 / 60);
  assert.ok(smooth.x > 0 && smooth.x < 1); assert.ok(validPosition(smooth.x, smooth.z));
  const beyondPillar = { ...target, x: -4, z: -4 };
  const reconciled = smoothRemotePosition({ x: -8.92, z: -4 }, beyondPillar, 1 / 60);
  assert.deepEqual(reconciled, { x: -4, z: -4 }); assert.ok(validPosition(reconciled.x, reconciled.z));
});
