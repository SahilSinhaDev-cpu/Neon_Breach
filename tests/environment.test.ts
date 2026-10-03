import test from 'node:test';
import assert from 'node:assert/strict';
import { BOXES, PADS, RULES, move, rayBox, validPosition } from '../shared/world';
import { waypointToward } from '../server/bots';
import { Room } from '../server/game';

test('Shattered Relay floor obstacles retain rotational symmetry and all four valid spawns', () => {
  for (const b of BOXES.filter(b => b.kind === 'cover' || b.kind === 'pillar')) assert.ok(BOXES.some(q => q.x === -b.x && q.z === -b.z && q.w === b.w && q.d === b.d && q.h === b.h));
  for (const pad of PADS) { assert.ok(validPosition(pad.x, pad.z)); assert.ok(Math.hypot(move(pad.x, pad.z, -Math.sign(pad.x), -Math.sign(pad.z)).x - pad.x, move(pad.x, pad.z, -Math.sign(pad.x), -Math.sign(pad.z)).z - pad.z) > 1); }
});
test('every spawn has a collision-safe path to the exact center and both service lanes connect end to end', () => {
  for (const pad of PADS) {
    let p = { ...pad };
    for (let i = 0; i < 1600 && Math.hypot(p.x, p.z) > 0.08; i++) {
      const next = waypointToward(p, { x: 0, z: 0 }), distance = Math.hypot(next.x - p.x, next.z - p.z), scale = Math.min(0.12, distance) / Math.max(distance, 0.001);
      p = move(p.x, p.z, (next.x - p.x) * scale, (next.z - p.z) * scale); assert.ok(validPosition(p.x, p.z));
    }
    assert.ok(Math.hypot(p.x, p.z) <= 0.08, 'every pad reaches the pickup');
  }
  for (const x of [-12, 12]) assert.ok(Math.abs(move(x, -16, 0, 32, true).z - 16) < 1e-6);
  for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) assert.ok(validPosition(x, z));
});
test('suspended solids stop upward shots and leave all floor routes unobstructed', () => {
  const suspended = BOXES.filter(b => b.kind === 'overhead'); assert.ok(suspended.length >= 5);
  for (const b of suspended) {
    assert.ok(b.y - b.h / 2 > RULES.height);
    const hit = rayBox({ x: b.x, y: RULES.eye, z: b.z }, { x: 0, y: 1, z: 0 }, b);
    assert.ok(Math.abs(hit - (b.y - b.h / 2 - RULES.eye)) < 1e-6);
  }
  assert.ok(validPosition(1.9, 0)); assert.ok(validPosition(0, 0));
});
test('both cover banks stop authoritative shots and dash at their visible box boundaries', () => {
  for (const side of [-1, 1]) {
    const room = new Room('ARENA1'), a = room.add('VEX', 'a', 0), b = room.add('NYX', 'b', 0); room.start(a.id, 0);
    Object.assign(a, { x: 0, z: 0, yaw: side < 0 ? 0 : Math.PI, pitch: 0, protectUntil: 0 }); Object.assign(b, { x: 0, z: side * 9, protectUntil: 0 });
    room.shoot(a, 2000); assert.equal(b.hp, 100); const end = move(0, 0, 0, side * 6, true);
    assert.ok(Math.abs(end.z) <= 3.68 + 1e-7 && Math.abs(end.z) > 3.59);
  }
});
