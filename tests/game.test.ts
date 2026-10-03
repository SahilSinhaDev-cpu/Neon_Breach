import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, Rooms, RateLimit, callsign, parseInput, rank, roomCode } from '../server/game';
import { RULES, BOXES, PADS, move, movement, rayBox, validPosition } from '../shared/world';

function setup(count = 2) { const room = new Room('ABC234'); for (let i = 0; i < count; i++) room.add(`P${i}`, `s${i}`, 1000); const players = room.connected(); room.start(players[0].id, 1000); room.drainEvents(); return { room, players, a: players[0], b: players[1] }; }
function exposed() { const game = setup(); Object.assign(game.a, { x: 0, z: 10, yaw: 0, pitch: 0 }); Object.assign(game.b, { x: 0, z: 7 }); return game; }
const packet = (seq = 1, changes = {}) => ({ seq, life: 1, mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, dash: false, ...changes });

test('callsigns and codes validate types and exact alphabet; callsigns normalize', () => {
  assert.equal(callsign('vex'), 'VEX'); assert.equal(roomCode(' abc234 '), 'ABC234');
  for (const value of [null, {}, '', 'A', 'A'.repeat(11), '<script>', 'NY X', 'ÅAA']) assert.throws(() => callsign(value));
  for (const value of [null, {}, 'AA', '1234567', '<VEX/>']) assert.throws(() => roomCode(value));
});
test('unpredictable room allocation produces unique valid codes and retries collisions', () => {
  const rooms = new Rooms(); const codes = new Set<string>();
  for (let i = 0; i < 50; i++) { const { room } = rooms.create('VEX', `s${i}`, 1000); assert.match(room.code, /^[A-Z2-9]{6}$/); codes.add(room.code); }
  assert.equal(codes.size, 50);
  let n = 0; const collide = new Rooms(() => ++n < 3 ? 'ABC234' : 'BCD345');
  assert.equal(collide.create('AA', '1', 0).room.code, 'ABC234'); assert.equal(collide.create('BB', '2', 0).room.code, 'BCD345');
});
test('invalid or unknown rooms, full rooms, and duplicate names have clear errors', () => {
  const rooms = new Rooms(); assert.throws(() => rooms.join('???', 'AB', 'x', 0), /valid/); assert.throws(() => rooms.join('ABC234', 'AB', 'x', 0), /not found/);
  const { room } = rooms.create('AA', 'a', 0); assert.throws(() => room.add('aa', 'b', 0), /already/);
  for (const name of ['BB', 'CC', 'DD']) room.add(name, name, 0); assert.throws(() => room.add('EE', 'e', 0), /full/);
});
test('only the host starts; precisely two connected players suffice; joining a match is disabled', () => {
  const room = new Room('ABC234'), a = room.add('AA', 'a', 0); assert.throws(() => room.start(a.id, 0), /two/);
  const b = room.add('BB', 'b', 0); assert.throws(() => room.start(b.id, 0), /host/); room.start(a.id, 0);
  assert.equal(room.phase, 'playing'); assert.throws(() => room.add('CC', 'c', 0), /progress/);
});
test('lobby refresh recovers the same seat and token without duplicate entries', () => {
  const room = new Room('ABC234'), a = room.add('AA', 'a', 0), b = room.add('BB', 'b', 0);
  assert.throws(() => room.add('AA', 'duplicate', 1, a.token), /already connected/);
  room.disconnect(a.id, 100); assert.equal(room.host, b.id);
  const restored = room.add('AA', 'new-socket', 200, a.token); assert.equal(restored.id, a.id); assert.equal(room.players.size, 2); assert.equal(restored.socketId, 'new-socket'); assert.equal(room.host, b.id);
});
test('host transfers in lobby and during match; a three-player match survives one departure', () => {
  const { room, a, b } = setup(3); room.disconnect(a.id, 3000); assert.equal(room.host, b.id); assert.equal(room.phase, 'playing');
  assert.throws(() => room.add('P0', 'new', 3100, a.token), /progress/);
});
test('empty rooms expire after 30 seconds; disconnected lobby reservations expire', () => {
  const rooms = new Rooms(), { room, player } = rooms.create('AA', 'a', 0); room.disconnect(player.id, 1000); rooms.cleanup(30999); assert.equal(rooms.rooms.size, 1); rooms.cleanup(31000); assert.equal(rooms.rooms.size, 0);
  const lobby = new Room('ABC234'), a = lobby.add('AA', 'a', 0); lobby.add('BB', 'b', 0); lobby.disconnect(a.id, 100); lobby.cleanup(30100); assert.equal(lobby.players.size, 1);
});
test('all four spawn pads are valid; spawning chooses the farthest unoccupied pad', () => {
  const { players } = setup(4); assert.equal(new Set(players.map(p => `${p.x},${p.z}`)).size, 4);
  for (const p of players) assert.ok(validPosition(p.x, p.z));
  const { room, a, b } = setup(); Object.assign(a, PADS[0]); b.hp = 0; room.spawn(b, 9000); assert.deepEqual({ x: b.x, z: b.z }, PADS[1]);
});
test('movement normalizes diagonals, rejects positions, and expires stale input', () => {
  const { room, a } = setup(); Object.assign(a, { x: 0, z: 10 });
  room.receive(a.id, packet(1, { mx: 1, my: 1, x: 9000, z: -9000 }), 2500); room.step(RULES.tick, 2510);
  assert.ok(Math.abs(Math.hypot(a.x, a.z - 10) - 0.1) < 1e-8); const previous = { x: a.x, z: a.z };
  room.step(RULES.tick, 3000); assert.equal(a.x, previous.x); assert.equal(a.z, previous.z);
  assert.ok(Math.abs(Math.hypot(...Object.values(movement(1, 1, 0, 6))) - 6) < 1e-8);
});
test('walking and dash cannot tunnel through walls, pillars, or cover', () => {
  const wall = move(0, 18, 0, 6, true); assert.ok(wall.z <= 19.58 && wall.z > 19.49);
  const pillar = move(-7, 1, 0, -6, true); assert.ok(pillar.z >= -2.08);
  const cover = move(0, 0, 0, -6, true); assert.ok(cover.z >= -3.68 - 1e-7);
  for (const p of [wall, pillar, cover]) assert.ok(validPosition(p.x, p.z));
});
test('dash travels at most six meters and server enforces the three-second cooldown', () => {
  const { room, a } = setup(); Object.assign(a, { x: 10, z: 15 });
  room.receive(a.id, packet(1, { dash: true }), 2500); assert.ok(Math.abs(a.z - 9) < 1e-7); assert.equal(a.dashAt, 5500);
  room.receive(a.id, packet(2, { dash: true }), 5499); assert.ok(Math.abs(a.z - 9) < 1e-7);
  room.receive(a.id, packet(3, { dash: true }), 5500); assert.ok(Math.abs(a.z - 3) < 1e-7);
});
test('exposed hits deal 34, rapid firing is rejected, and three hits eliminate exactly once', () => {
  const { room, a, b } = exposed(); room.receive(a.id, packet(1, { fire: true }), 2500); assert.equal(b.hp, 66);
  room.receive(a.id, packet(2, { fire: true }), 2779); assert.equal(b.hp, 66);
  room.receive(a.id, packet(3, { fire: true }), 2780); assert.equal(b.hp, 32);
  room.receive(a.id, packet(4, { fire: true }), 3060); assert.equal(b.hp, 0); assert.equal(a.score, 1); assert.equal(b.deaths, 1);
  room.receive(a.id, packet(5, { fire: true }), 3340); assert.equal(a.score, 1); assert.equal(room.drainEvents().filter(e => e.type === 'kill').length, 1);
});
test('cover, pillars, and nearest targets block shots; no elimination through geometry', () => {
  const { room, a, b } = exposed(); Object.assign(a, { x: 0, z: 0 }); Object.assign(b, { x: 0, z: -9 }); room.shoot(a, 2500); assert.equal(b.hp, 100);
  Object.assign(a, { x: -7, z: 1 }); Object.assign(b, { x: -7, z: -8 }); room.shoot(a, 2800); assert.equal(b.hp, 100); assert.equal(a.score, 0);
  const distance = rayBox({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, BOXES.find(b => b.kind === 'cover')!); assert.equal(distance, 4.1);
  const game = setup(3); Object.assign(game.a, { x: 0, z: 10, yaw: 0 }); Object.assign(game.b, { x: 0, z: 7 }); Object.assign(game.players[2], { x: 0, z: 6.5 }); game.room.shoot(game.a, 2500); assert.equal(game.b.hp, 66); assert.equal(game.players[2].hp, 100);
});
test('eliminated and disconnected players cannot move, shoot, or become kill targets', () => {
  const { room, players, a, b } = setup(3); a.hp = 0; const x = a.x; assert.equal(room.receive(a.id, packet(1, { my: 1, fire: true, dash: true }), 2500), false); assert.equal(a.x, x);
  room.disconnect(b.id, 2600); assert.equal(room.receive(b.id, packet(1, { fire: true }), 2600), false);
  Object.assign(players[2], { x: 0, z: 10, yaw: 0 }); Object.assign(b, { x: 0, z: 7 }); room.shoot(players[2], 3000); assert.equal(b.hp, 100); assert.equal(players[2].score, 0);
});
test('respawn waits five seconds; protection prevents damage and firing for precisely one second', () => {
  const { room, a, b } = exposed(); room.shoot(a, 2500); room.shoot(a, 2780); room.shoot(a, 3060);
  assert.equal(b.respawnAt, 8060); room.step(RULES.tick, 8059); assert.equal(b.hp, 0); room.step(RULES.tick, 8060); assert.equal(b.hp, 100); assert.equal(b.protectUntil, 9060);
  Object.assign(a, { x: 0, z: 10 }); Object.assign(b, { x: 0, z: 7, yaw: Math.PI }); room.shoot(a, 8300); assert.equal(b.hp, 100); room.shoot(b, 9059); assert.equal(a.hp, 100);
  room.shoot(a, 9059); assert.equal(b.hp, 100); room.shoot(b, 9060); assert.equal(a.hp, 66); room.shoot(a, 9339); assert.equal(b.hp, 66);
});
test('first cell appears at 20 seconds, single pickup lasts four seconds, next is 20 seconds later', () => {
  const { room, a, b } = setup(); room.step(RULES.tick, 20999); assert.equal(room.cell, false); room.step(RULES.tick, 21000); assert.equal(room.cell, true);
  Object.assign(a, { x: 0, z: 0 }); Object.assign(b, { x: 0, z: 0 }); room.step(RULES.tick, 21500);
  assert.equal(room.cell, false); assert.equal(a.phaseUntil, 25500); assert.equal(b.phaseUntil, 0); assert.equal(room.cellAt, 41500);
  Object.assign(a, { x: 0, z: 10 }); Object.assign(b, { x: 0, z: 7 }); room.step(RULES.tick, 25499); assert.equal(a.phaseUntil, 25500); room.step(RULES.tick, 25500); assert.equal(a.phaseUntil, 0);
  room.step(RULES.tick, 41499); assert.equal(room.cell, false); room.step(RULES.tick, 41500); assert.equal(room.cell, true);
});
test('phase changes tracer state but never damage, hittability, or movement speed', () => {
  const { room, a, b } = exposed(); a.phaseUntil = 6500; b.phaseUntil = 6500; room.shoot(a, 2500); assert.equal(b.hp, 66);
  const event = room.drainEvents().find(e => e.type === 'shot'); assert.ok(event?.type === 'shot' && event.shot.phased);
  room.receive(a.id, packet(1, { mx: 1 }), 2510); room.step(RULES.tick, 2520); assert.ok(Math.abs(a.x - 0.1) < 1e-8);
});
test('ten eliminations ends immediately; actions after end cannot change scores', () => {
  const { room, a, b } = exposed(); a.score = 9; b.hp = 34; room.receive(a.id, packet(1, { fire: true }), 2500); assert.equal(room.phase, 'ended'); assert.equal(room.winner, a.id); assert.equal(a.score, 10);
  assert.equal(room.receive(b.id, packet(1, { fire: true }), 3000), false); assert.equal(room.cell, false);
});
test('timeout uses score, earliest time attaining tied score, then match order; all-zero uses order', () => {
  for (const situation of ['score', 'timestamp', 'equal', 'zero']) {
    const { room, a, b } = setup(); let expected = a.id;
    if (situation === 'score') { b.score = 3; expected = b.id; }
    if (situation === 'timestamp') { a.score = b.score = 3; a.scoreAt = 9000; b.scoreAt = 8000; expected = b.id; }
    if (situation === 'equal') { a.score = b.score = 3; a.scoreAt = b.scoreAt = 9000; }
    room.step(RULES.tick, 181000); assert.equal(room.phase, 'ended'); assert.equal(room.winner, expected);
  }
  const { room, a, b } = exposed(); a.score = 9; b.hp = 34; room.receive(a.id, packet(1, { fire: true }), 181000); assert.equal(a.score, 9); assert.equal(b.hp, 34); assert.equal(room.reason, 'Contract time expired');
});
test('latest score achievement replaces earlier achievement for tie resolution', () => {
  const { a, b } = setup(); a.score = b.score = 2; a.scoreAt = 10000; b.scoreAt = 9000; assert.equal(rank([a, b])[0].id, b.id); a.scoreAt = 8500; assert.equal(rank([a, b])[0].id, a.id);
});
test('last connected player wins; disconnected higher score cannot win a continuing match', () => {
  const { room, a, b } = setup(); a.score = 9; room.disconnect(a.id, 2500); assert.equal(room.winner, b.id); assert.equal(b.score, 0);
  const game = setup(3); game.a.score = 9; game.room.disconnect(game.a.id, 2500); game.room.step(RULES.tick, 181000); assert.equal(game.room.winner, game.b.id);
});
test('replay resets all match state, drops departed players, and requires host start again', () => {
  const { room, a, b } = exposed(); a.score = 2; a.phaseUntil = 10000; a.dashAt = 9000; b.hp = 0; b.respawnAt = 9000; room.finish(a.id, 'test');
  assert.throws(() => room.replay(b.id), /host/); room.replay(a.id); const s = room.snapshot(5000); assert.equal(s.phase, 'lobby'); assert.equal(s.startedAt, 0); assert.equal(s.endsAt, 0); assert.equal(s.winner, null); assert.equal(s.cell, false); assert.equal(s.cellAt, 0);
  for (const p of s.players) { assert.equal(p.score, 0); assert.equal(p.hp, 100); assert.equal(p.respawnAt + p.protectUntil + p.phaseUntil + p.dashAt, 0); }
  assert.equal(room.receive(a.id, packet(), 6000), false); room.start(a.id, 7000); assert.equal(room.match, 2); assert.equal(room.endsAt, 187000);
});
test('malformed, impossible, and stale inputs never change authoritative state', () => {
  const { room, a } = setup(); const original = room.snapshot(2000);
  for (const value of [null, {}, [], 'fire', packet(1, { yaw: NaN }), packet(1, { pitch: Infinity }), packet(1, { mx: 100 }), packet(1, { my: -2 }), packet(-1), packet(1.2), packet(1, { fire: 1 }), packet(1, { yaw: 999 }), packet(1, { pitch: 1.6 })]) { assert.equal(parseInput(value), null); assert.equal(room.receive(a.id, value, 2500), false); }
  assert.deepEqual(room.snapshot(2000), original); assert.equal(room.receive('non-member', packet(), 2500), false);
  room.receive(a.id, packet(3), 2500); assert.equal(room.receive(a.id, packet(2, { dash: true }), 2600), false);
});
test('snapshots never expose reconnect tokens or socket ids; rate limiter rejects floods and recovers', () => {
  const { room, a } = setup(); const snapshot = JSON.stringify(room.snapshot(2500)); assert.ok(!snapshot.includes(a.token)); assert.ok(!snapshot.includes('socketId')); assert.ok(!snapshot.includes('lastFire'));
  const limit = new RateLimit(2, 1); assert.equal(limit.allow('a', 0), true); assert.equal(limit.allow('a', 0), true); assert.equal(limit.allow('a', 0), false); assert.equal(limit.allow('a', 999), false); assert.equal(limit.allow('a', 1000), true); assert.equal(limit.allow('b', 1000), true); limit.cleanup(200000); assert.equal(limit.allow('a', 200000), true);
});

test('spawn generation rejects old-life packets until the client receives the new spawn pose', () => {
  const { room, a } = setup(); const oldLife = a.life; room.spawn(a, 8000); const yaw = a.yaw;
  assert.equal(a.life, oldLife + 1); assert.equal(room.receive(a.id, packet(500, { life: oldLife, yaw: 1, my: 1, dash: true, fire: true }), 8001), false); assert.equal(a.yaw, yaw);
  assert.equal(room.receive(a.id, packet(501, { life: a.life, yaw }), 8002), true);
});
