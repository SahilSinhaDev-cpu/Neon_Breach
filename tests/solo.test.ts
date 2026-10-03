import test from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../server/game';
import { RULES, move, validPosition } from '../shared/world';
import { canSee, clearWalk, waypointToward } from '../server/bots';

function solo(name = 'VEX') {
  const rooms = new Rooms(), { room, player } = rooms.create(name, 'human-socket', 1000, 'solo');
  return { rooms, room, player, bots: room.connected().filter(p => p.bot) };
}
test('solo allocates one human and three explicitly identified bots with unique names/colors', () => {
  const { room, player, bots } = solo('DRONE1');
  assert.equal(room.mode, 'solo'); assert.equal(room.humans().length, 1); assert.equal(bots.length, 3); assert.equal(room.host, player.id);
  assert.equal(new Set(room.connected().map(p => p.name)).size, 4); assert.equal(new Set(room.connected().map(p => p.color)).size, 4);
  assert.ok(bots.every(p => p.socketId === null && p.token === ''));
  const snapshot = room.snapshot(1000); assert.equal(snapshot.mode, 'solo'); assert.equal(snapshot.players.filter(p => p.bot).length, 3);
  room.addPracticeBots(); assert.equal(room.players.size, 4);
});
test('multiplayer remains human-only and cannot start alone or add practice bots', () => {
  const rooms = new Rooms(), { room, player } = rooms.create('VEX', 'human', 1000);
  assert.equal(room.mode, 'multiplayer'); assert.ok(room.connected().every(p => !p.bot));
  assert.throws(() => room.start(player.id, 2000), /two/); assert.throws(() => room.addPracticeBots(), /solo/);
});
test('solo lobby is private; recovery preserves the human and cannot claim a bot seat', () => {
  const { room, player, bots } = solo();
  assert.throws(() => room.add('NYX', 'other', 1001), /private solo/);
  assert.throws(() => room.add(bots[0].name, 'other', 1001, ''), /private solo/);
  room.disconnect(player.id, 2000); assert.equal(room.host, ''); assert.equal(room.emptyAt, 2000);
  const recovered = room.add('VEX', 'replacement', 2200, player.token);
  assert.equal(recovered.id, player.id); assert.equal(room.players.size, 4); assert.equal(room.host, player.id); assert.equal(room.emptyAt, null);
  room.start(player.id, 3000);
  assert.equal(room.receive(bots[0].id, { seq: 900, life: bots[0].life, mx: 1, my: 1, yaw: 0, pitch: 0, fire: true, dash: true }, 4000), false);
});
test('one human starts solo without winning automatically, even while eliminated', () => {
  const { room, player } = solo(); room.start(player.id, 1000); room.step(RULES.tick, 1017);
  assert.equal(room.phase, 'playing'); assert.equal(room.winner, null);
  player.hp = 0; player.respawnAt = 8000; room.step(RULES.tick, 3000); assert.equal(room.phase, 'playing');
});
test('bots obey three-hit damage, five-second respawn, and one-second protection', () => {
  const { room, player, bots } = solo(); room.start(player.id, 1000);
  Object.assign(player, { x: 0, z: 10, yaw: 0, pitch: 0 }); Object.assign(bots[0], { x: 0, z: 7 });
  room.shoot(player, 2500); assert.equal(bots[0].hp, 66); room.shoot(player, 2780); assert.equal(bots[0].hp, 32); room.shoot(player, 3060); assert.equal(bots[0].hp, 0); assert.equal(player.score, 1);
  room.step(RULES.tick, 8059); assert.equal(bots[0].hp, 0); room.step(RULES.tick, 8060); assert.equal(bots[0].hp, 100); assert.equal(bots[0].protectUntil, 9060);
  room.drainEvents(); room.shoot(bots[0], 9059); assert.equal(room.drainEvents().filter(e => e.type === 'shot' && e.shot.shooter === bots[0].id).length, 0);
});
test('either a human or bot can win at ten; bot timeout winner uses the same ranking', () => {
  for (const botWins of [false, true]) {
    const { room, player, bots } = solo(); room.start(player.id, 1000);
    const shooter = botWins ? bots[0] : player, victim = botWins ? player : bots[0];
    Object.assign(shooter, { x: 0, z: 10, yaw: 0, pitch: 0, score: 9 }); Object.assign(victim, { x: 0, z: 7, hp: 34 });
    room.shoot(shooter, 2500); assert.equal(room.phase, 'ended'); assert.equal(room.winner, shooter.id);
  }
  const { room, player, bots } = solo(); room.start(player.id, 1000); player.score = bots[0].score = 2; player.scoreAt = 9000; bots[0].scoreAt = 8000;
  room.step(RULES.tick, 181000); assert.equal(room.winner, bots[0].id);
});
test('solo replay resets the same three bots and permits another one-human start', () => {
  const { room, player, bots } = solo(); room.start(player.id, 1000); const ids = bots.map(b => b.id);
  bots[0].score = 10; room.finish(bots[0].id, 'Elimination limit reached'); room.replay(player.id);
  assert.equal(room.phase, 'lobby'); assert.equal(room.mode, 'solo'); assert.deepEqual(room.connected().filter(p => p.bot).map(p => p.id), ids);
  assert.ok(room.connected().every(p => p.score === 0 && p.hp === 100 && p.phaseUntil === 0 && p.input === null));
  room.start(player.id, 5000); assert.equal(room.phase, 'playing'); assert.equal(room.match, 2); assert.equal(room.players.size, 4);
});
test('abandoned solo sessions end and expire despite bots; bots never become host', () => {
  for (const started of [false, true]) {
    const { rooms, room, player } = solo(); if (started) room.start(player.id, 1000);
    room.disconnect(player.id, 3000, true); assert.equal(room.host, ''); assert.equal(room.emptyAt, 3000); assert.equal(room.humans().length, 0);
    if (started) { assert.equal(room.phase, 'ended'); assert.equal(room.winner, null); }
    const positions = room.connected().map(p => [p.x, p.z]); room.step(RULES.tick, 4000); assert.deepEqual(room.connected().map(p => [p.x, p.z]), positions);
    rooms.cleanup(32999); assert.equal(rooms.rooms.size, 1); rooms.cleanup(33000); assert.equal(rooms.rooms.size, 0);
  }
});
test('navigation routes around both pillars and central cover without entering collision geometry', () => {
  for (const [from, goal] of [[{ x: 0, z: 0 }, { x: 0, z: -12 }], [{ x: -7, z: 1 }, { x: -7, z: -10 }], [{ x: 7, z: -1 }, { x: 7, z: 11 }]]) {
    let position = { ...from }, waypoint = { ...from };
    assert.equal(clearWalk(from, goal), false); assert.equal(canSee(from, goal), false);
    for (let step = 0; step < 1800 && Math.hypot(position.x - goal.x, position.z - goal.z) > 0.2; step++) {
      if (step % 24 === 0) waypoint = waypointToward(position, goal);
      const dx = waypoint.x - position.x, dz = waypoint.z - position.z, length = Math.hypot(dx, dz);
      if (length > 0.01) { const distance = Math.min(length, RULES.speed * RULES.tick * 0.72); position = move(position.x, position.z, dx / length * distance, dz / length * distance); }
      assert.ok(validPosition(position.x, position.z));
    }
    assert.ok(Math.hypot(position.x - goal.x, position.z - goal.z) <= 0.2, 'bot route must make progress around cover');
  }
});
test('a full unattended solo simulation produces real bot movement, shots, kills, respawns, and a winner', () => {
  const { room, player, bots } = solo(); room.start(player.id, 1000); room.drainEvents();
  let shots = 0, kills = 0, respawns = 0, humanDamage = 0;
  const lastShot = new Map<string, number>();
  for (let tick = 1; tick <= 10800 && room.phase === 'playing'; tick++) {
    const now = 1000 + tick * 1000 / 60;
    const previous = bots.map(p => ({ x: p.x, z: p.z, life: p.life }));
    room.step(RULES.tick, now);
    for (const [index, p] of bots.entries()) {
      assert.ok(validPosition(p.x, p.z));
      if (previous[index].life === p.life) assert.ok(Math.hypot(p.x - previous[index].x, p.z - previous[index].z) <= RULES.speed * RULES.tick + 1e-6);
      assert.ok([100, 66, 32, 0].includes(p.hp));
    }
    for (const event of room.drainEvents()) {
      if (event.type === 'shot') {
        shots++; const prior = lastShot.get(event.shot.shooter); if (prior !== undefined) assert.ok(now - prior >= RULES.fireMs); lastShot.set(event.shot.shooter, now);
        if (event.shot.hit === player.id && event.shot.damage) humanDamage++;
      }
      if (event.type === 'kill') kills++;
      if (event.type === 'respawn') respawns++;
    }
  }
  assert.ok(shots > 10); assert.ok(kills > 0); assert.ok(respawns > 0); assert.ok(humanDamage > 0);
  assert.equal(room.phase, 'ended'); assert.ok(room.winner); assert.ok(bots.some(p => p.id === room.winner));
});
