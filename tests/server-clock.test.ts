import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerClock } from '../client/server-clock';
import type { Snapshot } from '../shared/protocol';
const snapshot = (now: number, match = 1) => ({ code: 'ABC234', match, now } as Snapshot);

test('HUD time never moves backwards when a slower response brings an older estimate', () => {
  const clock = new ServerClock();
  clock.observe(snapshot(20_000), 100, 1000);
  const before = clock.now(1500);
  clock.observe(snapshot(20_200), 400, 1500);
  assert.equal(clock.now(1500), before);
  assert.ok(clock.now(1700) > before);
  clock.observe(snapshot(19_000), 100, 1700);
  assert.equal(clock.now(1700), 20_600);
});

test('clock state resets between rooms/matches and on explicit leave', () => {
  const clock = new ServerClock();
  clock.observe(snapshot(20_000), 900, 1000);
  assert.equal(clock.now(1000), 20_350);
  clock.observe(snapshot(1000, 2), 0, 2000);
  assert.equal(clock.now(2000), 1000);
  clock.reset(); assert.equal(clock.now(3000), 0);
});
