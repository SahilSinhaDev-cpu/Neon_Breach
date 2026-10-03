import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { PULSE, pulseFrame, visualOrigin, impactSurface } from '../client/pulse-motion';
import { PulseEffects } from '../client/pulse-vfx';
import { BOXES, rayBox, validPosition, type Vec3 } from '../shared/world';
import type { Shot } from '../shared/protocol';

const magnitude = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const difference = (a: Vec3, b: Vec3): Vec3 => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
const normalize = (v: Vec3): Vec3 => {
  const length = magnitude(v) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const near = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const samePoint = (actual: Vec3, expected: Vec3) => { for (const axis of ['x', 'y', 'z'] as const) near(actual[axis], expected[axis]); };
const shotTo = (from: Vec3, to: Vec3, hit: string | null = null, damage = false): Shot => ({ shooter: 'VEX', from, to, hit, damage, phased: false });
const solidShot = (from: Vec3, direction: Vec3): Shot => {
  const aim = normalize(direction), distance = Math.min(100, ...BOXES.map(box => rayBox(from, aim, box)));
  return shotTo(from, { x: from.x + aim.x * distance, y: from.y + aim.y * distance, z: from.z + aim.z * distance });
};
const unobstructed = (from: Vec3, to: Vec3) => {
  const segment = difference(from, to), length = magnitude(segment);
  if (length < 1e-9) return;
  const hit = Math.min(...BOXES.map(box => rayBox(from, normalize(segment), box)));
  assert.ok(hit >= length - .035, `Cosmetic segment meets a solid ${length - hit} m before its authoritative endpoint`);
};

test('cosmetic pulse waits for release, travels at one speed, and stops at every endpoint', () => {
  for (const distance of [.2, 2.5, 12, 40, 56]) {
    const arrival = PULSE.release + distance / PULSE.speed;
    assert.equal(pulseFrame(distance, PULSE.release / 2).headOpacity, 0);
    near(pulseFrame(distance, PULSE.release).travel, 0);
    const a = pulseFrame(distance, PULSE.release + distance / PULSE.speed * .25);
    const b = pulseFrame(distance, PULSE.release + distance / PULSE.speed * .75);
    near(a.travel, distance * .25); near(b.travel, distance * .75);
    near((b.travel - a.travel) / (distance / PULSE.speed * .5), PULSE.speed);
    near(pulseFrame(distance, arrival).travel, distance);
    near(pulseFrame(distance, arrival + 20).travel, distance);
  }
});

test('short tails never pass behind the launch point; expiration is bounded by arrival', () => {
  for (const distance of [0, .2, 2.5, 40]) {
    const arrival = PULSE.release + distance / PULSE.speed;
    for (const age of [-.1, 0, PULSE.release, PULSE.release + .001, arrival, arrival + .08, arrival + 2]) {
      const frame = pulseFrame(distance, age);
      assert.ok(frame.travel >= 0 && frame.travel <= distance);
      assert.ok(frame.tail >= 0 && frame.tail <= PULSE.tail && frame.tail <= frame.travel);
      assert.ok(frame.headOpacity >= 0 && frame.headOpacity <= 1);
    }
    assert.equal(pulseFrame(distance, arrival + PULSE.residue - .00001).expired, false);
    assert.equal(pulseFrame(distance, arrival + PULSE.residue + .00001).expired, true);
  }
});

test('clear muzzle paths retain the rifle launch position and need no flash suppression', () => {
  const shot = shotTo({ x: -12, y: 1.6, z: 12 }, { x: -12, y: 1.6, z: 0 });
  const muzzle = { x: -11.874006244669243, y: 1.3848561727170774, z: 10.368211940356742 };
  const origin = visualOrigin(shot, muzzle);
  samePoint(origin, muzzle); assert.equal(origin.suppressMuzzle, false);
  unobstructed(origin, shot.to);
});

test('near cover and north-wall muzzle intrusion is corrected without backward travel or false impact coordinates', () => {
  for (const [z, muzzleZ] of [[6.32, 4.688211940356741], [-19.58, -21.211788059643258]]) {
    assert.equal(validPosition(0, z), true);
    const shot = solidShot({ x: 0, y: 1.6, z }, { x: 0, y: 0, z: -1 });
    const endpoint = { ...shot.to };
    const origin = visualOrigin(shot, { x: .1259937553307563, y: 1.3848561727170774, z: muzzleZ });
    assert.equal(origin.suppressMuzzle, true);
    assert.ok(dot(difference(origin, shot.to), difference(shot.from, shot.to)) >= 0);
    unobstructed(shot.from, origin); unobstructed(origin, shot.to);
    samePoint(shot.to, endpoint);
  }
});

test('a muzzle round a pillar corner retreats toward the accepted eye ray', () => {
  const shot = shotTo({ x: -9.5, y: 1.6, z: -1 }, { x: -6, y: 1.6, z: -20 });
  const muzzle = { x: -9, y: 1.4, z: -2 };
  unobstructed(shot.from, shot.to); unobstructed(shot.from, muzzle);
  const blockedDistance = magnitude(difference(muzzle, shot.to));
  assert.ok(Math.min(...BOXES.map(box => rayBox(muzzle, normalize(difference(muzzle, shot.to)), box))) < blockedDistance - .035);
  const origin = visualOrigin(shot, muzzle);
  assert.equal(origin.suppressMuzzle, true);
  assert.ok(magnitude(difference(shot.from, origin)) < magnitude(difference(shot.from, muzzle)));
  unobstructed(origin, shot.to);
});

test('an exposed target closer than the rifle muzzle cannot produce a backward pulse', () => {
  const shot = shotTo({ x: -12, y: 1.6, z: 12 }, { x: -12, y: 1.6, z: 11.22 }, 'NEAR', true);
  const origin = visualOrigin(shot, { x: -11.874006244669243, y: 1.3848561727170774, z: 10.368211940356742 });
  assert.ok(dot(difference(origin, shot.to), difference(shot.from, shot.to)) >= 0);
  assert.equal(origin.suppressMuzzle, true);
  unobstructed(origin, shot.to);
});

test('overlapping-player zero-length shots remain finite with a unit impact normal', () => {
  const eye = { x: -12, y: 1.6, z: 12 }, shot = shotTo(eye, { ...eye }, 'OVERLAP', true);
  const origin = visualOrigin(shot, { x: -11.874006244669243, y: 1.3848561727170774, z: 10.368211940356742 });
  samePoint(origin, eye);
  const surface = impactSurface(shot);
  assert.equal(surface.kind, 'armor'); near(magnitude(surface.normal), 1);
  for (const age of [0, PULSE.release, .1, 1]) {
    const frame = pulseFrame(0, age);
    for (const value of [frame.travel, frame.tail, frame.headOpacity, frame.impactAge]) assert.ok(Number.isFinite(value));
    assert.equal(frame.travel, 0); assert.equal(frame.tail, 0);
  }
});

test('impact type and outward normal match wall, floor, ceiling, pillar, cover, and overhead contact faces', () => {
  const fixtures: [Vec3, Vec3, 'metal' | 'composite', Vec3][] = [
    [{ x: 0, y: 1.6, z: -19.58 }, { x: 0, y: 0, z: -1 }, 'metal', { x: 0, y: 0, z: 1 }],
    [{ x: 0, y: 1.6, z: 19.58 }, { x: 0, y: 0, z: 1 }, 'metal', { x: 0, y: 0, z: -1 }],
    [{ x: -19.58, y: 1.6, z: 0 }, { x: -1, y: 0, z: 0 }, 'metal', { x: 1, y: 0, z: 0 }],
    [{ x: 19.58, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }, 'metal', { x: -1, y: 0, z: 0 }],
    [{ x: 12, y: 1.6, z: 0 }, { x: 0, y: -1, z: 0 }, 'metal', { x: 0, y: 1, z: 0 }],
    [{ x: 12, y: 1.6, z: 0 }, { x: 0, y: 1, z: 0 }, 'metal', { x: 0, y: -1, z: 0 }],
    [{ x: -7, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, 'metal', { x: 0, y: 0, z: 1 }],
    [{ x: 0, y: 1.6, z: 7 }, { x: 0, y: 0, z: -1 }, 'composite', { x: 0, y: 0, z: 1 }],
    [{ x: 0, y: 1.6, z: 3 }, { x: 0, y: 0, z: 1 }, 'composite', { x: 0, y: 0, z: -1 }],
    [{ x: -1.9, y: 1.6, z: 0 }, { x: 0, y: 1, z: 0 }, 'metal', { x: 0, y: -1, z: 0 }],
  ];
  for (const [from, direction, kind, normal] of fixtures) {
    const surface = impactSurface(solidShot(from, direction));
    assert.equal(surface.kind, kind); samePoint(surface.normal, normal); near(magnitude(surface.normal), 1);
    assert.ok(dot(surface.normal, direction) < 0);
  }
  const corner = impactSurface(shotTo({ x: -11.5, y: 2, z: 6.5 }, { x: -8.5, y: 2, z: -2.5 }));
  samePoint(corner.normal, { x: 0, y: 0, z: 1 });
});

test('protected armor contacts stay armor visuals without granting damage', () => {
  const shot = shotTo({ x: -12, y: 1.6, z: 12 }, { x: -12, y: 1.6, z: 11.58 }, 'PROTECTED', false);
  const surface = impactSurface(shot);
  assert.equal(surface.kind, 'armor'); samePoint(surface.normal, { x: 0, y: 0, z: 1 });
  assert.equal(shot.damage, false);
});

test('an empty endpoint gets no invented surface impact', () => {
  const surface = impactSurface(shotTo({ x: -12, y: 1.6, z: 12 }, { x: -12, y: 1.6, z: 10 }));
  assert.equal(surface.kind, 'none'); near(magnitude(surface.normal), 1);
});

const poolResources = (scene: T.Scene) => {
  const geometry = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
  scene.traverse(object => {
    if (object instanceof T.Mesh) {
      geometry.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  return { geometry, materials };
};

test('fixed effect pool remains bounded under mixed impacts and phase shots, then fully expires', () => {
  const scene = new T.Scene(), effects = new PulseEffects(scene), before = poolResources(scene);
  const variants = [
    solidShot({ x: 0, y: 1.6, z: -19.58 }, { x: 0, y: 0, z: -1 }),
    solidShot({ x: 0, y: 1.6, z: 7 }, { x: 0, y: 0, z: -1 }),
    shotTo({ x: -12, y: 1.6, z: 12 }, { x: -12, y: 1.6, z: 11.58 }, 'ARMOR', true),
    shotTo({ x: -12, y: 1.6, z: 12 }, { x: -12, y: 1.6, z: 10 }),
  ];
  for (let i = 0; i < 400; i++) {
    const shot = { ...variants[i % variants.length], phased: i % 3 === 0 };
    effects.add(shot, new T.Vector3(shot.from.x, shot.from.y, shot.from.z), 1 + i * .001);
    assert.ok(effects.audit().active <= effects.capacity);
  }
  const full = effects.audit();
  assert.equal(full.spawned, 400); assert.equal(full.dropped, 0);
  assert.equal(full.active, effects.capacity); assert.equal(full.peakActive, effects.capacity);
  assert.equal(full.reused, 400 - effects.capacity);
  const after = poolResources(scene);
  assert.deepEqual(after.geometry, before.geometry); assert.deepEqual(after.materials, before.materials);
  assert.equal(after.geometry.size, 3); assert.equal(after.materials.size, full.materialCount);
  effects.update(2); assert.equal(effects.audit().active, 0);
  assert.ok(scene.children.every(object => !object.visible));
  effects.dispose();
});

test('pool clear allows a clean replay and disposal releases every shared resource once', () => {
  const scene = new T.Scene(), unrelated = new T.Group(); scene.add(unrelated);
  const effects = new PulseEffects(scene), resources = poolResources(scene);
  const shot = solidShot({ x: -12, y: 1.6, z: 12 }, { x: 0, y: 0, z: -1 });
  effects.add({ ...shot, phased: true }, new T.Vector3(shot.from.x, shot.from.y, shot.from.z), 0);
  effects.update(.05); assert.equal(effects.audit().active, 1);
  effects.clear(); assert.equal(effects.audit().active, 0);
  assert.equal(scene.children.length, effects.capacity + 1);
  effects.add(shot, new T.Vector3(shot.from.x, shot.from.y, shot.from.z), 5);
  assert.equal(effects.audit().active, 1);
  assert.deepEqual(poolResources(scene).geometry, resources.geometry);
  let geometriesDisposed = 0, materialsDisposed = 0;
  for (const geometry of resources.geometry) geometry.addEventListener('dispose', () => geometriesDisposed++);
  for (const material of resources.materials) material.addEventListener('dispose', () => materialsDisposed++);
  effects.dispose();
  assert.equal(effects.audit().active, 0);
  assert.equal(geometriesDisposed, resources.geometry.size);
  assert.equal(materialsDisposed, resources.materials.size);
  assert.deepEqual(scene.children, [unrelated]);
});
