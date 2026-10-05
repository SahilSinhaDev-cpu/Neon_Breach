import test from 'node:test';
import assert from 'node:assert/strict';
import { MenuState } from '../client/menu-state';
import { Room } from '../server/game';
import { RULES } from '../shared/world';

test('Back is exactly one local panel and is hidden at a root', () => {
  const menu = new MenuState(); assert.equal(menu.canBack, false);
  menu.open('join'); menu.open('how-to-play'); menu.open('settings');
  menu.back(); assert.equal(menu.panel, 'how-to-play'); menu.back(); assert.equal(menu.panel, 'join');
  menu.back(); assert.equal(menu.panel, 'landing'); assert.equal(menu.canBack, false); menu.back(); assert.equal(menu.panel, 'landing');
});
test('Settings Back restores each calling screen and a paused match stays blocked', () => {
  for (const root of ['landing', 'lobby', 'end'] as const) { const menu = new MenuState(); menu.sync(root); menu.open('settings'); menu.back(); assert.equal(menu.panel, root); }
  const menu = new MenuState(); menu.sync('match'); menu.pause(); menu.open('settings'); menu.back();
  assert.equal(menu.panel, 'paused'); assert.equal(menu.blocksMatch, true); menu.resume(); assert.equal(menu.blocksMatch, false);
});
test('server match end updates underneath menus; Resume cannot reopen a dead match', () => {
  const menu = new MenuState(); menu.sync('match'); menu.pause(); menu.open('settings'); menu.sync('end');
  assert.equal(menu.panel, 'settings'); menu.back(); assert.equal(menu.panel, 'paused'); menu.resume(); assert.equal(menu.panel, 'end');
});
function match(count = 3) {
  const room = new Room('ABC234'); for (let i = 0; i < count; i++) room.add(`P${i}`, `socket${i}`, 1000);
  const players = room.connected(); room.start(players[0].id, 1000); room.drainEvents(); return { room, players };
}
test('personal Return to Lobby preserves the seat and clock; host transfers to an active operator', () => {
  const { room, players: [a, b, c] } = match(); const pose = { x: a.x, z: a.z, hp: a.hp, life: a.life };
  room.returnToLobby(a.id, 2500); assert.ok(a.connected && a.inLobby); assert.equal(room.host, b.id);
  assert.equal(room.phase, 'playing'); assert.equal(room.endsAt, 181000); assert.equal(room.players.size, 3);
  assert.deepEqual({ x: a.x, z: a.z, hp: a.hp, life: a.life }, pose); assert.deepEqual(room.participants().map(p => p.id), [b.id, c.id]);
  room.returnToLobby(a.id, 2600); assert.equal(room.host, b.id); assert.equal(room.phase, 'playing');
});
test('waiting seats cannot move, fire, take damage, block shots, pick up a cell or respawn', () => {
  const { room, players: [a, b, c] } = match(); room.returnToLobby(a.id, 2500);
  Object.assign(a, { x: 0, z: 7, hp: 100, respawnAt: 2700 }); Object.assign(b, { x: 0, z: 10, yaw: 0 }); Object.assign(c, { x: 0, z: 6 });
  assert.equal(room.receive(a.id, { seq: 1, life: a.life, mx: 1, my: 1, yaw: 0, pitch: 0, fire: true, dash: true }, 2600), false);
  room.shoot(a, 2600); room.shoot(b, 2600); assert.equal(a.hp, 100); assert.equal(c.hp, 66);
  Object.assign(a, { x: 0, z: 0, hp: 0 }); room.cell = true; const life = a.life;
  room.step(RULES.tick, 2800); assert.equal(a.hp, 0); assert.equal(a.life, life); assert.equal(a.phaseUntil, 0); assert.equal(room.cell, true);
});
test('two-player Return to Lobby awards the remaining participant without inventing an elimination', () => {
  const { room, players: [a, b] } = match(2); a.score = 9; room.returnToLobby(a.id, 2500);
  assert.equal(room.phase, 'ended'); assert.equal(room.winner, b.id); assert.equal(b.score, 0); assert.ok(a.connected && a.inLobby); assert.equal(b.inLobby, false);
});
test('a waiting higher score cannot win on timeout; explicit Quit removes the seat and replay cannot restore it', () => {
  const { room, players: [a, b, c] } = match(); a.score = 9; b.score = 1; room.returnToLobby(a.id, 2500);
  room.checkTimeout(181000); assert.equal(room.winner, b.id); room.disconnect(c.id, 181001, true);
  assert.equal(room.players.has(c.id), false); room.replay(b.id); assert.equal(room.phase, 'lobby'); assert.equal(room.players.size, 2);
  assert.ok(room.connected().every(p => !p.inLobby && p.score === 0 && p.hp === 100));
  assert.throws(() => room.start(a.id, 181002), /host/); room.start(b.id, 181002); assert.equal(room.participants().length, 2);
});
test('personal lobby refresh recovers the same token during active play but an active disconnect cannot rejoin', () => {
  const { room, players: [a, b] } = match(4); room.returnToLobby(a.id, 2500); room.disconnect(a.id, 2600);
  const restored = Room.restore(room.serialize()); const recovered = restored.add(a.name, 'new-socket', 2700, a.token);
  assert.equal(recovered.id, a.id); assert.ok(recovered.inLobby && recovered.connected); assert.equal(restored.players.size, 4);
  restored.disconnect(b.id, 2800); assert.throws(() => restored.add(b.name, 'active-rejoin', 2900, b.token), /progress/);
});
test('solo personal exit ends simulation but keeps its lobby; no lobby player receives an invented win', () => {
  const room = new Room('ABC234', 'solo'), a = room.add('VEX', 'solo', 1000); room.addPracticeBots(); room.start(a.id, 1000);
  room.returnToLobby(a.id, 2500); assert.equal(room.phase, 'ended'); assert.equal(room.winner, null); assert.ok(a.connected && a.inLobby);
  room.replay(a.id); assert.equal(room.connected().length, 4); assert.equal(room.phase, 'lobby');
});
test('finished winner and scores survive membership removal and JSON storage without exposing seat tokens', () => {
  const { room, players: [a, b] } = match(2); a.score = 2; room.checkTimeout(181000);
  room.disconnect(a.id, 181001, true); assert.equal(room.players.has(a.id), false); assert.equal(room.winner, a.id);
  const restored = Room.restore(JSON.parse(JSON.stringify(room.serialize())));
  assert.equal(restored.snapshot(181002).finalPlayers!.find(p => p.id === a.id)!.score, 2);
  assert.equal(restored.snapshot(181002).finalPlayers!.find(p => p.id === a.id)!.name, a.name);
  assert.equal(JSON.stringify(restored.snapshot(181002)).includes(a.token), false);
  room.replay(b.id); assert.equal(room.snapshot(181003).finalPlayers, undefined);
});
test('Quit at the contract deadline preserves the timeout winner instead of inventing a disconnect win', () => {
  const { room, players: [a, b] } = match(2); a.score = 3;
  room.disconnect(a.id, room.endsAt, true);
  assert.equal(room.reason, 'Contract time expired'); assert.equal(room.winner, a.id);
  assert.equal(room.players.has(a.id), false); assert.equal(room.host, b.id);
  assert.equal(room.snapshot(room.endsAt).finalPlayers!.find(p => p.id === a.id)!.score, 3);
});
