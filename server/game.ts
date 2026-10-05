import { randomBytes, randomUUID } from 'node:crypto';
import { BOXES, COLORS, PADS, RULES, aimDirection, move, movement, rayBox } from '../shared/world';
import type { GameEvent, Input, PublicPlayer, Snapshot, RoomMode } from '../shared/protocol';
import { botInput, createBrain, type BotBrain } from './bots';
import { logRejection } from './rejections';

export type Player = PublicPlayer & { token: string; socketId: string | null; input: Input | null; inputAt: number; lastFire: number; leftAt: number; inputLeaseMs?: number };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const randomCode = () => Array.from(randomBytes(6), n => alphabet[n % alphabet.length]).join('');
export function callsign(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{2,10}$/.test(value)) throw new Error('Callsign needs 2–10 letters or numbers.');
  return value.toUpperCase();
}
export function roomCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{6}$/.test(value.trim().toUpperCase())) throw new Error('Enter a valid 6-character room code.');
  return value.trim().toUpperCase();
}
export function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Input;
  if (!Number.isSafeInteger(v.seq) || v.seq < 0 || !Number.isSafeInteger(v.life) || v.life < 1 || ![v.mx, v.my, v.yaw, v.pitch].every(Number.isFinite) || Math.abs(v.mx) > 1 || Math.abs(v.my) > 1 || Math.abs(v.yaw) > Math.PI * 2 || Math.abs(v.pitch) > 1.45 || typeof v.fire !== 'boolean' || typeof v.dash !== 'boolean') return null;
  return { seq: v.seq, life: v.life, mx: v.mx, my: v.my, yaw: v.yaw, pitch: v.pitch, fire: v.fire, dash: v.dash };
}
export function rank(players: PublicPlayer[]) {
  return [...players].sort((a, b) => b.score - a.score || (a.score > 0 ? a.scoreAt - b.scoreAt : 0) || a.order - b.order);
}
export class Room {
  players = new Map<string, Player>();
  phase: Snapshot['phase'] = 'lobby'; host = ''; startedAt = 0; endsAt = 0;
  cell = false; cellAt = 0; winner: string | null = null; reason = ''; match = 0;
  emptyAt: number | null = null; order = 0;
  events: GameEvent[] = [];
  private finalPlayers: PublicPlayer[] = [];
  private brains = new Map<string, BotBrain>();
  constructor(public code: string, public readonly mode: RoomMode = 'multiplayer') {}
  // Complete JSON-safe state for the retained Function backend and QA. Its
  // bot decisions survive cold starts; the live WebSocket runtime uses maps.
  serialize() {
    return { ...this.snapshot(0), players: [...this.players.values()].map(p => ({ ...p, lastFire: Number.isFinite(p.lastFire) ? p.lastFire : null })), emptyAt: this.emptyAt, order: this.order, brains: [...this.brains] };
  }
  static restore(data: ReturnType<Room['serialize']>) {
    const room = new Room(data.code, data.mode);
    for (const key of ['phase', 'host', 'startedAt', 'endsAt', 'cell', 'cellAt', 'winner', 'reason', 'match', 'emptyAt', 'order'] as const) Object.assign(room, { [key]: data[key] });
    room.players = new Map(data.players.map(p => [p.id, { ...p, lastFire: p.lastFire ?? -Infinity }]));
    room.brains = new Map(data.brains);
    room.finalPlayers = data.finalPlayers ?? [];
    return room;
  }
  connected() { return [...this.players.values()].filter(p => p.connected); }
  humans() { return this.connected().filter(p => !p.bot); }
  participants() { return this.connected().filter(p => !p.inLobby); }
  private matchHumans() { return this.participants().filter(p => !p.bot); }
  add(nameValue: unknown, socketId: string, now: number, token?: unknown): Player {
    const name = callsign(nameValue);
    this.cleanup(now);
    const recovered = typeof token === 'string' ? [...this.players.values()].find(p => !p.bot && p.token === token) : undefined;
    if (this.phase !== 'lobby' && !recovered?.inLobby) throw new Error(this.phase === 'playing' ? 'Match already in progress. Join after the host returns to the lobby.' : 'Match has ended. Wait for the host to open the next lobby.');
    if (recovered) {
      if (recovered.connected) throw new Error('This seat is already connected in another tab.');
      recovered.connected = true; recovered.socketId = socketId; recovered.leftAt = 0;
      this.emptyAt = null; if (!this.host) this.host = recovered.id;
      return recovered;
    }
    if (this.mode === 'solo' && this.players.size) throw new Error('This is a private solo session. Create a multiplayer room to play with friends.');
    if (this.players.size >= 4) throw new Error('Room full. Four operators are already assigned.');
    if ([...this.players.values()].some(p => p.name === name)) throw new Error('That callsign is already in this room.');
    return this.addPlayer(name, socketId, false);
  }
  private addPlayer(name: string, socketId: string | null, bot: boolean): Player {
    const color = COLORS.find(c => ![...this.players.values()].some(p => p.color === c))!;
    const p: Player = { id: randomUUID(), name, color, order: this.order++, connected: true, bot, token: bot ? '' : randomBytes(32).toString('hex'), socketId, input: null, inputAt: 0, lastFire: -Infinity, leftAt: 0, x: 0, z: 0, yaw: 0, pitch: 0, hp: RULES.health, score: 0, scoreAt: 0, deaths: 0, respawnAt: 0, protectUntil: 0, phaseUntil: 0, dashAt: 0, ack: -1, life: 0 };
    this.players.set(p.id, p); if (!this.host && !bot) this.host = p.id; this.emptyAt = null;
    return p;
  }
  addPracticeBots() {
    if (this.mode !== 'solo' || this.phase !== 'lobby' || this.humans().length !== 1) throw new Error('Bots are only available in solo practice.');
    let number = 1;
    while (this.players.size < 4) {
      const name = `DRONE${number++}`;
      if (![...this.players.values()].some(p => p.name === name)) this.addPlayer(name, null, true);
    }
  }
  disconnect(id: string, now: number, explicit = false) {
    this.checkTimeout(now);
    const p = this.players.get(id); if (!p || !p.connected || p.bot) return;
    p.connected = false; p.socketId = null; p.input = null; p.leftAt = now; p.phaseUntil = 0;
    const connected = this.humans();
    if (this.host === id) this.host = (this.phase === 'playing' ? this.matchHumans()[0] : undefined)?.id ?? connected[0]?.id ?? '';
    if (!connected.length) this.emptyAt = now;
    this.checkDepartures();
    if (explicit) this.players.delete(id);
  }
  // A connected room seat may wait in the lobby while the other operators
  // finish this contract. It cannot move, respawn, fire, block shots or win.
  returnToLobby(id: string, now: number) {
    this.checkTimeout(now);
    const p = this.players.get(id);
    if (!p?.connected || p.bot) throw new Error('Your seat is no longer available.');
    if (this.phase === 'lobby' || p.inLobby) return;
    p.inLobby = true; p.input = null; p.phaseUntil = 0;
    if (this.phase === 'playing' && this.host === id) this.host = this.matchHumans()[0]?.id ?? this.humans()[0]?.id ?? '';
    this.checkDepartures();
  }
  private checkDepartures() {
    if (this.phase !== 'playing') return;
    const active = this.matchHumans();
    if (this.mode === 'solo') {
      if (!active.length) this.finish(null, 'Solo practice ended — operator left the match');
    } else if (active.length <= 1) this.finish(active[0]?.id ?? null, active.length ? 'Last operator connected' : 'Signal lost — no operators remain');
  }
  cleanup(now: number) {
    if (this.phase === 'lobby') for (const p of this.players.values()) if (!p.connected && now - p.leftAt >= 30000) this.players.delete(p.id);
  }
  start(id: string, now: number) {
    if (id !== this.host) throw new Error('Only the host can start the contract.');
    if (this.phase !== 'lobby') throw new Error('This contract has already started.');
    if (this.humans().length < (this.mode === 'solo' ? 1 : 2)) throw new Error(this.mode === 'solo' ? 'A connected operator is required for solo practice.' : 'At least two connected operators are required.');
    for (const p of this.players.values()) if (!p.connected) this.players.delete(p.id);
    this.phase = 'playing'; this.startedAt = now; this.endsAt = now + RULES.matchMs; this.match++;
    this.cell = false; this.cellAt = now + RULES.cellMs; this.winner = null; this.reason = ''; this.events = []; this.brains.clear(); this.finalPlayers = [];
    // Mark all players down before choosing pads so only already-spawned opponents count.
    for (const p of this.players.values()) { p.inLobby = false; p.hp = 0; p.score = 0; p.deaths = 0; p.scoreAt = 0; p.phaseUntil = 0; p.dashAt = 0; p.ack = -1; p.input = null; p.inputLeaseMs = undefined; p.lastFire = -Infinity; }
    for (const p of this.connected()) this.spawn(p, now);
  }
  replay(id: string) {
    if (id !== this.host) throw new Error('Only the host can reopen the lobby.');
    if (this.phase !== 'ended') throw new Error('Finish the current contract first.');
    this.phase = 'lobby'; this.startedAt = 0; this.endsAt = 0; this.cell = false; this.cellAt = 0; this.winner = null; this.reason = ''; this.events = []; this.brains.clear(); this.finalPlayers = [];
    for (const p of this.players.values()) {
      if (!p.connected) { this.players.delete(p.id); continue; }
      Object.assign(p, { inLobby: false, hp: RULES.health, score: 0, deaths: 0, scoreAt: 0, respawnAt: 0, protectUntil: 0, phaseUntil: 0, dashAt: 0, input: null, inputLeaseMs: undefined, ack: -1, lastFire: -Infinity, x: 0, z: 0, yaw: 0, pitch: 0 });
    }
  }
  spawn(p: Player, now: number) {
    p.life++;
    const opponents = this.participants().filter(q => q.id !== p.id && q.hp > 0);
    const pads = PADS.map((pad, index) => ({ ...pad, index, distance: Math.min(...opponents.map(q => Math.hypot(q.x - pad.x, q.z - pad.z))) })).sort((a, b) => b.distance - a.distance || a.index - b.index);
    const pad = pads[0];
    Object.assign(p, { x: pad.x, z: pad.z, yaw: Math.atan2(pad.x, pad.z), pitch: 0, hp: RULES.health, respawnAt: 0, protectUntil: now + RULES.protectMs, phaseUntil: 0, input: null, inputLeaseMs: undefined, lastFire: -Infinity });
    this.events.push({ type: 'respawn', player: p.id });
  }
  receive(id: string, raw: unknown, now: number) {
    this.checkTimeout(now);
    const p = this.players.get(id), input = parseInput(raw);
    if (this.phase !== 'playing' || !p?.connected || p.inLobby || p.bot || p.hp <= 0 || !input || input.seq <= p.ack || input.life !== p.life) {
      if ((input?.fire || raw && typeof raw === 'object' && (raw as { fire?: unknown }).fire === true) && !p?.bot) logRejection('shot', this.code, id, 'inactive, eliminated, stale or invalid input', now);
      return false;
    }
    this.applyInput(p, input, now);
    return true;
  }
  private applyInput(p: Player, input: Input, now: number) {
    p.input = input; p.inputAt = now; p.ack = input.seq; p.yaw = input.yaw; p.pitch = input.pitch;
    if (input.dash && now >= p.dashAt) {
      const hasMove = Math.hypot(input.mx, input.my) > 0.01;
      const delta = movement(hasMove ? input.mx : 0, hasMove ? input.my : 1, p.yaw, RULES.dashMeters);
      Object.assign(p, move(p.x, p.z, delta.x, delta.z, true)); p.dashAt = now + RULES.dashMs;
    }
    if (input.fire) this.shoot(p, now);
  }
  shoot(p: Player, now: number, reportAttempt = true) {
    const rejection = this.phase !== 'playing' || !p.connected || p.inLobby || p.hp <= 0 ? 'operator is not active' : now < p.protectUntil ? 'spawn protection' : now - p.lastFire < RULES.fireMs ? 'fire cooldown' : '';
    if (rejection) { if (reportAttempt && !p.bot) logRejection('shot', this.code, p.id, rejection, now); return; }
    p.lastFire = now;
    const from = { x: p.x, y: RULES.eye, z: p.z }, direction = aimDirection(p.yaw, p.pitch);
    let distance = Math.min(100, ...BOXES.map(b => rayBox(from, direction, b)));
    let target: Player | null = null;
    for (const q of this.players.values()) {
      if (q.id === p.id || !q.connected || q.inLobby || q.hp <= 0) continue;
      const d = rayBox(from, direction, { x: q.x, y: RULES.height / 2, z: q.z, w: RULES.radius * 2, h: RULES.height, d: RULES.radius * 2, kind: 'cover' });
      // Strictly closer: cover wins exact ties.
      if (d < distance) { distance = d; target = q; }
    }
    const damage = !!target && now >= target.protectUntil;
    const shot = { shooter: p.id, from, to: { x: from.x + direction.x * distance, y: from.y + direction.y * distance, z: from.z + direction.z * distance }, hit: target?.id ?? null, damage, phased: p.phaseUntil > now };
    this.events.push({ type: 'shot', shot });
    if (target && damage) {
      target.hp = Math.max(0, target.hp - RULES.damage);
      if (target.hp === 0) {
        target.deaths++; target.respawnAt = now + RULES.respawnMs; target.phaseUntil = 0; target.input = null;
        p.score++; p.scoreAt = now; this.events.push({ type: 'kill', killer: p.id, victim: target.id });
        if (p.score >= RULES.target) this.finish(p.id, 'Elimination limit reached');
      }
    }
  }
  step(dt: number, now: number) {
    this.checkTimeout(now);
    if (this.phase !== 'playing') return;
    if (!this.cell && now >= this.cellAt) this.cell = true;
    for (const p of this.participants()) {
      if (p.hp <= 0) { if (now >= p.respawnAt) this.spawn(p, now); continue; }
      if (p.phaseUntil && now >= p.phaseUntil) p.phaseUntil = 0;
      if (p.bot) {
        let brain = this.brains.get(p.id);
        if (!brain || brain.life !== p.life) { brain = createBrain(p, now); this.brains.set(p.id, brain); }
        this.applyInput(p, botInput(p, this.participants(), this.cell, brain, now, Math.min(dt, RULES.tick)), now);
        if (this.phase !== 'playing') break;
      }
      // HTTP round trips can exceed the original WebSocket watchdog. The
      // function may set a bounded lease from server-observed arrival spacing;
      // clients cannot set it, and movement/fire still obey every normal rule.
      const inputLease = Number.isFinite(p.inputLeaseMs) ? Math.max(RULES.inputStaleMs, Math.min(p.inputLeaseMs!, 2000)) : RULES.inputStaleMs;
      if (p.input && now - p.inputAt <= inputLease) {
        const delta = movement(p.input.mx, p.input.my, p.yaw, RULES.speed * Math.min(dt, RULES.tick));
        Object.assign(p, move(p.x, p.z, delta.x, delta.z));
        if (p.input.fire) this.shoot(p, now, false);
      }
      if (this.phase !== 'playing') break;
      if (this.cell && Math.hypot(p.x, p.z) <= 1.1) { this.cell = false; this.cellAt = now + RULES.cellMs; p.phaseUntil = now + RULES.phaseMs; this.events.push({ type: 'cell', player: p.id }); }
    }
  }
  checkTimeout(now: number) { if (this.phase === 'playing' && now >= this.endsAt) this.finish(rank(this.participants())[0]?.id ?? null, 'Contract time expired'); }
  finish(winner: string | null, reason: string) { this.phase = 'ended'; this.winner = winner; this.reason = reason; this.cell = false; this.cellAt = 0; for (const p of this.players.values()) { p.input = null; p.phaseUntil = 0; } this.finalPlayers = this.snapshot(0).players; }
  snapshot(now: number): Snapshot {
    return { code: this.code, mode: this.mode, phase: this.phase, host: this.host, now, startedAt: this.startedAt, endsAt: this.endsAt, cell: this.cell, cellAt: this.cellAt, winner: this.winner, reason: this.reason, match: this.match, finalPlayers: this.phase === 'ended' ? this.finalPlayers : undefined, players: [...this.players.values()].map(({ token: _token, socketId: _socket, input: _input, inputAt: _inputAt, lastFire: _lastFire, leftAt: _leftAt, inputLeaseMs: _lease, ...p }) => p) };
  }
  drainEvents() { const events = this.events; this.events = []; return events; }
}
export class Rooms {
  rooms = new Map<string, Room>();
  constructor(private generate = randomCode) {}
  create(name: unknown, socketId: string, now: number, mode: RoomMode = 'multiplayer') {
    callsign(name);
    if (this.rooms.size >= 200) throw new Error('Station at capacity. Try again shortly.');
    let code = this.generate(), retries = 0;
    while (this.rooms.has(code)) { if (++retries >= 100) throw new Error('Could not allocate a room. Try again.'); code = this.generate(); }
    const room = new Room(code, mode), player = room.add(name, socketId, now);
    if (mode === 'solo') room.addPracticeBots();
    this.rooms.set(code, room); return { room, player };
  }
  join(code: unknown, name: unknown, socketId: string, now: number, token?: unknown) {
    const room = this.rooms.get(roomCode(code)); if (!room) throw new Error('Room not found. Check the code with your host.');
    return { room, player: room.add(name, socketId, now, token) };
  }
  cleanup(now: number) { for (const [code, room] of this.rooms) { room.cleanup(now); if (room.emptyAt !== null && now - room.emptyAt >= 30000) this.rooms.delete(code); } }
}

export class RateLimit {
  private buckets = new Map<string, { tokens: number; time: number }>();
  constructor(private capacity: number, private perSecond: number) {}
  allow(key: string, now: number) {
    const old = this.buckets.get(key) ?? { tokens: this.capacity, time: now };
    const tokens = Math.min(this.capacity, old.tokens + Math.max(0, now - old.time) / 1000 * this.perSecond);
    const ok = tokens >= 1; this.buckets.set(key, { tokens: tokens - (ok ? 1 : 0), time: now }); return ok;
  }
  cleanup(now: number) { for (const [key, b] of this.buckets) if (now - b.time > 120000) this.buckets.delete(key); }
}
