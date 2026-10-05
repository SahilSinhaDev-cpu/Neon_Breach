import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { preview } from '../scripts/local-preview';
import type { RealtimeReply, SnapshotPacket } from '../shared/realtime-protocol';
import { REALTIME_VERSION } from '../shared/realtime-protocol';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const listener = createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
const address = listener.address(); assert.ok(address && typeof address === 'object');
const port = address.port; await new Promise<void>(r => listener.close(() => r()));
const child = spawn(process.execPath, ['dist/server/index.mjs'], { env: { ...process.env, PORT: String(port), NODE_ENV: 'production' }, stdio: 'pipe' });
let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
const exit = new Promise<number | null>(r => child.once('exit', r));
const url = `http://127.0.0.1:${port}`, sockets: Socket[] = [];
const unpacked = await mkdtemp(join(tmpdir(), 'neon-production-function-'));
let compatibility: Awaited<ReturnType<typeof preview>> | null = null;
const checks: string[] = [];
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
const command = (socket: Socket, event: string, data: object): Promise<RealtimeReply> => new Promise((resolve, reject) => socket.timeout(3000).emit(event, { ...data, requestId: randomUUID() }, (error: Error | null, value: RealtimeReply) => error ? reject(error) : resolve(value)));
async function connect() { const socket = io(url, { transports: ['websocket'], auth: { protocol: REALTIME_VERSION }, extraHeaders: { Origin: 'https://neonbreach977.vercel.app' }, reconnection: false }); sockets.push(socket); await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket; }
try {
  let ready = false; for (let i = 0; i < 50; i++) { try { const r = await fetch(`${url}/healthz`); const health = await r.json(); if (r.ok && health.protocol === REALTIME_VERSION) { ready = true; break; } } catch {} await pause(100); }
  assert.ok(ready, output); assert.match(await (await fetch(url)).text(), /NEON BREACH/i);
  assert.deepEqual(await (await fetch(`${url}/game-config.json`)).json(), { transport: 'websocket', serverUrl: null });
  check('Compiled production entry starts, reports healthy protocol, serves frontend and selects WebSockets');
  const a = await connect(), b = await connect();
  const created = await command(a, 'room', { action: 'create', name: 'PIPEVEX' }); assert.ok(created.ok);
  assert.ok((await command(b, 'room', { action: 'join', name: 'PIPENYX', code: created.snapshot!.code })).ok);
  let snapshot: SnapshotPacket | null = null;
  for (const socket of [a, b]) socket.on('snapshot', value => snapshot = value);
  const started = await command(a, 'action', { action: 'start' }); assert.ok(started.ok);
  const player = started.snapshot!.players.find(p => p.id === created.id)!;
  for (let seq = 0; seq < 40; seq++) { a.emit('input', { seq, life: player.life, mx: 0, my: 1, yaw: player.yaw, pitch: 0, fire: false, dash: false }); await pause(33); }
  const observed = (snapshot as SnapshotPacket | null)?.snapshot.players.find(p => p.id === created.id);
  assert.ok(observed && observed.ack >= 30 && Math.hypot(player.x - observed.x, player.z - observed.z) > 4);
  await command(b, 'action', { action: 'leave' }); await pause(80);
  assert.equal((snapshot as SnapshotPacket | null)?.snapshot.winner, created.id);
  assert.ok((await command(a, 'action', { action: 'replay' })).ok);
  assert.ok((await command(a, 'action', { action: 'leave' })).ok);
  check('Actual production process supports create/join, authoritative movement, disconnect winner and replay');
  execFileSync('unzip', ['-q', 'dist/functions/game.zip', '-d', unpacked]);
  const packaged = await import(pathToFileURL(join(unpacked, 'netlify/functions/game.mjs')).href);
  compatibility = await preview(packaged.default);
  const ping = await fetch(`${compatibility.url}/.netlify/functions/game`); assert.equal(ping.status, 200); assert.equal((await ping.json()).ok, true);
  const call = async (data: object) => { await pause(220); return (await fetch(`${compatibility!.url}/.netlify/functions/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), ...data }) })).json(); };
  const c1 = randomUUID(), c2 = randomUUID();
  const one = await call({ action: 'create', name: 'OLDVEX', client: c1 }); assert.ok(one.ok);
  const two = await call({ action: 'join', name: 'OLDNYX', client: c2, code: one.snapshot.code }); assert.ok(two.ok);
  const seat = (r: any, client: string) => ({ token: r.token, code: r.snapshot.code, client });
  assert.ok((await call({ action: 'start', ...seat(one, c1) })).ok);
  assert.ok((await call({ action: 'leave', ...seat(two, c2) })).ok);
  await pause(150);
  const result = await call({ action: 'poll', ...seat(one, c1) }); assert.ok(result.ok, JSON.stringify(result)); assert.equal(result.snapshot.winner, one.id);
  assert.ok((await call({ action: 'replay', ...seat(one, c1) })).ok);
  assert.ok((await call({ action: 'leave', ...seat(one, c1) })).ok);
  check('Exact packaged Netlify Function loads and retains create/join/start, winner and replay compatibility');
  await mkdir('artifacts/realtime', { recursive: true });
  await writeFile('artifacts/realtime/production-report.json', JSON.stringify({ passed: true, checks, scope: 'Built production index.mjs child process and exact packaged game.mjs with local Blobs emulator; not hosted cloud.' }, null, 2));
} finally {
  sockets.forEach(s => s.disconnect()); await compatibility?.close(); await rm(unpacked, { recursive: true, force: true });
  child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 5000); await exit; clearTimeout(force);
}
