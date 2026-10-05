import test from 'node:test';
import assert from 'node:assert/strict';
import { GameConnection } from '../client/http-connection';
import { GAME_ENDPOINT, type GameRequest, type HttpReply } from '../shared/http-protocol';
import type { Input, Snapshot } from '../shared/protocol';

const snapshot = (phase: Snapshot['phase'] = 'playing', ack = -1): Snapshot => ({
  code: 'ABC234', mode: 'multiplayer', phase, host: 'player-one', now: 10_000,
  startedAt: 10_000, endsAt: 190_000, cell: false, cellAt: 30_000, winner: null, reason: '', match: 1,
  players: [{ id: 'player-one', name: 'VEX', color: '#00ffff', order: 0, connected: true, bot: false,
    x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, score: 0, scoreAt: 0, deaths: 0,
    respawnAt: 0, protectUntil: 0, phaseUntil: 0, dashAt: 0, ack, life: 1 }],
});
const roomReply = (): HttpReply => ({ ok: true, id: 'player-one', token: 'seat-token', snapshot: snapshot(), cursor: 0 });
const json = (reply: HttpReply, status = 200) => Response.json(reply, { status });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function transport(handle: (packet: GameRequest | null) => Promise<Response> | Response) {
  const packets: (GameRequest | null)[] = [];
  let active = 0, maximum = 0;
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, GAME_ENDPOINT);
    const packet = options?.body ? JSON.parse(String(options.body)) as GameRequest : null;
    packets.push(packet); active++; maximum = Math.max(maximum, active);
    try { return await handle(packet); } finally { active--; }
  };
  return { connection: new GameConnection(fetcher), packets, maximum: () => maximum };
}
async function create(connection: GameConnection) {
  assert.equal((await connection.request('room', { action: 'create', name: 'VEX' })).ok, true);
}

test('the default fetch implementation is called with the global receiver required by browsers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: unknown, url) {
    assert.equal(this, globalThis); assert.equal(url, GAME_ENDPOINT);
    return json(roomReply());
  };
  const connection = new GameConnection();
  try { await create(connection); }
  finally { connection.close(); globalThis.fetch = original; }
});

test('a failed leave preserves the server seat and snapshots until a later leave is acknowledged', async () => {
  const polling = deferred<void>(), response = deferred<Response>(), health = deferred<void>();
  const observed: Snapshot[] = []; let available = false;
  const fixture = transport(packet => {
    if (!packet) { health.resolve(); return json({ ok: true }); }
    if (packet.action === 'create') return json(roomReply());
    if (packet.action === 'leave') return available ? json({ ok: true }) : json({ ok: false, error: 'Unavailable' }, 503);
    polling.resolve(); return response.promise;
  });
  const { connection } = fixture;
  try {
    connection.on('snapshot', value => observed.push(value));
    await create(connection); connection.connect(); await polling.promise;
    const leaving = connection.request('action', 'leave');
    response.resolve(json({ ok: true, snapshot: snapshot(), cursor: 1 }));
    assert.equal((await leaving).ok, false); assert.ok(observed.length >= 1);
    assert.equal(fixture.packets.filter(p => p?.action === 'leave').length, 2);
    available = true; assert.equal((await connection.request('action', 'leave')).ok, true);
    const count = observed.length; await health.promise; assert.equal(observed.length, count); assert.equal(fixture.maximum(), 1);
  } finally { connection.close(); }
});

test('a successful leave does not publish its old room snapshot or resume polling it', async () => {
  const observed: Snapshot[] = [];
  const fixture = transport(packet => json(packet?.action === 'create' ? roomReply() : { ok: true, snapshot: snapshot('ended') }));
  try {
    fixture.connection.on('snapshot', value => observed.push(value));
    await create(fixture.connection);
    assert.equal((await fixture.connection.request('action', 'leave')).ok, true);
    fixture.connection.connect(); await pause(10);
    assert.deepEqual(observed, []);
    assert.equal(fixture.packets.at(-1), null);
  } finally { fixture.connection.close(); }
});

test('start and replay retry a transient failure using the same request ID', async () => {
  for (const action of ['start', 'replay']) {
    let attempts = 0;
    const fixture = transport(packet => {
      if (packet?.action === 'create') return json(roomReply());
      return ++attempts === 1 ? json({ ok: false, error: 'Room busy' }, 409) : json({ ok: true, snapshot: snapshot() });
    });
    try {
      await create(fixture.connection);
      assert.equal((await fixture.connection.request('action', action)).ok, true);
      const actions = fixture.packets.filter(p => p?.action === action);
      assert.equal(actions.length, 2); assert.equal(actions[0]!.requestId, actions[1]!.requestId);
      assert.equal(fixture.maximum(), 1);
    } finally { fixture.connection.close(); }
  }
});

test('room creation is never retried after an uncertain response', async () => {
  const fixture = transport(() => json({ ok: false, error: 'Unavailable' }, 503));
  try {
    assert.equal((await fixture.connection.request('room', { action: 'create', name: 'VEX' })).ok, false);
    assert.equal(fixture.packets.length, 1);
  } finally { fixture.connection.close(); }
});

test('a transient poll rejection retains a dash on the next fresh input, then clears it after acknowledgement', async () => {
  let polls = 0, sequence = 0;
  const complete = deferred<void>();
  const fixture = transport(packet => {
    if (packet?.action === 'create') return json(roomReply());
    assert.equal(packet?.action, 'poll'); polls++;
    if (polls === 1) return json({ ok: false, error: 'Input rate exceeded.' }, 429);
    if (polls === 3) complete.resolve();
    return json({ ok: true, snapshot: snapshot('playing', packet!.input!.seq) });
  });
  try {
    fixture.connection.sample = (): Input => ({ seq: sequence++, life: 1, mx: sequence === 1 ? 1 : -1, my: 0, yaw: sequence / 10, pitch: 0, fire: false, dash: sequence === 1 });
    await create(fixture.connection); fixture.connection.connect(); await complete.promise;
    const inputs = fixture.packets.filter(p => p?.action === 'poll').map(p => p!.input!);
    assert.deepEqual(inputs.slice(0, 3).map(i => i.dash), [true, true, false]);
    assert.equal(inputs[1].mx, -1); assert.equal(inputs[1].yaw, 0.2);
    assert.equal(fixture.maximum(), 1);
  } finally { fixture.connection.close(); }
});

test('connect is idempotent and requests remain serialized while health checks are in flight', async () => {
  const health = deferred<void>(), release = deferred<Response>();
  const fixture = transport(packet => {
    if (!packet) { health.resolve(); return release.promise; }
    return json(roomReply());
  });
  try {
    fixture.connection.connect(); fixture.connection.connect(); await health.promise;
    const creating = fixture.connection.request('room', { action: 'create', name: 'VEX' });
    assert.equal(fixture.packets.length, 1);
    release.resolve(json({ ok: true })); await creating;
    assert.equal(fixture.maximum(), 1);
    assert.equal(fixture.packets.filter(p => !p).length, 1);
  } finally { fixture.connection.close(); }
});

test('malformed station replies report connection failure instead of claiming the station is online', async () => {
  const connection = new GameConnection(async () => Response.json({ unexpected: true }));
  let errors = 0, connects = 0;
  connection.on('connect_error', () => errors++); connection.on('connect', () => connects++);
  try {
    assert.equal((await connection.request('room', { action: 'create', name: 'VEX' })).ok, false);
    assert.equal(connection.connected, false); assert.equal(errors, 1); assert.equal(connects, 0);
  } finally { connection.close(); }
});

test('event cursors prevent duplicate combat events in retried action replies', async () => {
  const fixture = transport(packet => {
    if (packet?.action === 'create') return json(roomReply());
    return json({ ok: true, snapshot: snapshot(), cursor: 2, events: [
      { seq: 1, event: { type: 'cell', player: 'player-one' } },
      { seq: 2, event: { type: 'respawn', player: 'player-one' } },
    ] });
  });
  const received: string[] = [];
  try {
    await create(fixture.connection);
    fixture.connection.on('event', event => received.push(event.type));
    await fixture.connection.request('action', 'start');
    await fixture.connection.request('action', 'start');
    assert.deepEqual(received, ['cell', 'respawn']);
  } finally { fixture.connection.close(); }
});

test('a brief 503 does not disconnect a healthy room or lose the next held movement sample', async () => {
  let polls = 0, disconnected = 0, unstable = 0;
  const done = deferred<void>();
  const fixture = transport(packet => {
    if (packet?.action === 'create') return json(roomReply());
    if (++polls === 1) return json({ ok: false, error: 'Storage temporarily unavailable' }, 503);
    assert.equal(packet?.input?.my, 1); done.resolve();
    return json({ ok: true, snapshot: snapshot('playing', packet!.input!.seq) });
  });
  try {
    fixture.connection.on('disconnect', () => disconnected++);
    fixture.connection.on('unstable', () => unstable++);
    fixture.connection.sample = () => ({ seq: polls + 1, life: 1, mx: 0, my: 1, yaw: 0, pitch: 0, fire: false, dash: false });
    await create(fixture.connection); fixture.connection.connect(); await done.promise;
    assert.equal(disconnected, 0); assert.equal(unstable, 1); assert.equal(fixture.connection.connected, true);
  } finally { fixture.connection.close(); }
});

test('a stalled request disables the connection after the grace window before fetch times out', async () => {
  const polling = deferred<void>(), release = deferred<Response>(), lost = deferred<void>();
  const fixture = transport(packet => {
    if (packet?.action === 'create') return json(roomReply());
    polling.resolve(); return release.promise;
  });
  try {
    await create(fixture.connection); fixture.connection.on('disconnect', () => lost.resolve());
    fixture.connection.connect(); await polling.promise; await lost.promise;
    assert.equal(fixture.connection.connected, false);
  } finally { release.resolve(json({ ok: true, snapshot: snapshot() })); fixture.connection.close(); }
});

test('a long Retry-After still suspends controls when the recovery grace expires', async () => {
  const disconnected = deferred<void>();
  const fixture = transport(packet => packet?.action === 'create' ? json(roomReply())
    : Response.json({ ok: false, error: 'Storage busy', retryAfterMs: 10_000 }, { status: 503, headers: { 'retry-after': '10' } }));
  const deadline = setTimeout(() => disconnected.resolve(), 3500);
  try {
    fixture.connection.on('disconnect', () => disconnected.resolve());
    await create(fixture.connection); fixture.connection.connect();
    await disconnected.promise;
    assert.equal(fixture.connection.connected, false, 'Backoff must not extend the control grace period');
    assert.equal(fixture.packets.filter(packet => packet?.action === 'poll').length, 1, 'Provider backoff must still be respected');
  } finally { clearTimeout(deadline); fixture.connection.close(); }
});

test('only a disconnected lobby lease requests automatic seat recovery', async () => {
  for (const [phase, code, expected] of [['lobby', 'SEAT_DISCONNECTED', 'recover'], ['lobby', 'SEAT_REPLACED', 'error'], ['playing', 'SEAT_DISCONNECTED', 'error']] as const) {
    const done = deferred<string>();
    const fixture = transport(packet => packet?.action === 'create'
      ? json({ ...roomReply(), snapshot: snapshot(phase) })
      : json({ ok: false, error: 'Your seat is disconnected or replaced.', errorCode: code }, 403));
    try {
      fixture.connection.on('lobby_recover', () => done.resolve('recover'));
      fixture.connection.on('seat_error', () => done.resolve('error'));
      await create(fixture.connection); fixture.connection.connect(); assert.equal(await done.promise, expected);
    } finally { fixture.connection.close(); }
  }
});

test('leaving while a room response is pending cancels that response instead of reopening it', async () => {
  const sent = deferred<void>(), release = deferred<Response>();
  const fixture = transport(packet => {
    if (packet?.action === 'create') { sent.resolve(); return release.promise; }
    return json({ ok: true });
  });
  try {
    const joining = fixture.connection.request('room', { action: 'create', name: 'VEX' });
    await sent.promise; const leaving = fixture.connection.request('action', 'leave');
    release.resolve(json(roomReply())); assert.equal((await joining).ok, false);
    assert.equal((await leaving).ok, true);
    assert.equal(fixture.packets.find(packet => packet?.action === 'leave')?.token, 'seat-token');
  } finally { fixture.connection.close(); }
});
test('a refreshed personal lobby seat polls without movement and receives the host replay snapshot', async () => {
  const waiting = snapshot('playing'); waiting.players[0].inLobby = true;
  const done = deferred<void>(); let samples = 0, polls = 0;
  const fixture = transport(packet => {
    if (packet?.action === 'join') return json({ ...roomReply(), snapshot: waiting });
    assert.equal(packet?.action, 'poll'); assert.equal(packet?.input, undefined);
    if (++polls === 2) done.resolve();
    return json({ ok: true, snapshot: polls === 1 ? waiting : snapshot('lobby') });
  });
  const observed: Snapshot[] = [];
  try {
    fixture.connection.sample = () => { samples++; return { seq: 0, life: 0, mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, dash: false }; };
    fixture.connection.on('snapshot', value => observed.push(value));
    assert.ok((await fixture.connection.request('room', { action: 'join', name: 'VEX' })).ok);
    fixture.connection.connect(); await done.promise; await pause(0);
    assert.equal(samples, 0); assert.equal(observed.at(-1)?.phase, 'lobby'); assert.equal(fixture.maximum(), 1);
  } finally { fixture.connection.close(); }
});
test('pausing cancels a dash retry after a rejected HTTP poll and sends only neutral input', async () => {
  let active = true, polls = 0; const done = deferred<void>();
  const fixture = transport(packet => {
    if (packet?.action === 'create') return json(roomReply());
    if (++polls === 1) { assert.ok(packet?.input?.dash); active = false; return json({ ok: false, error: 'busy' }, 429); }
    assert.deepEqual([packet?.input?.dash, packet?.input?.fire, packet?.input?.mx, packet?.input?.my], [false, false, 0, 0]); done.resolve();
    return json({ ok: true, snapshot: snapshot() });
  });
  try {
    fixture.connection.canAct = () => active;
    fixture.connection.sample = () => ({ seq: polls, life: 1, mx: active ? 1 : 0, my: 0, yaw: 0, pitch: 0, fire: false, dash: active });
    await create(fixture.connection); fixture.connection.connect(); await done.promise;
    assert.equal(fixture.maximum(), 1);
  } finally { fixture.connection.close(); }
});
