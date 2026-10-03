import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { realtimeFixture } from './realtime-fixture';

// Separate origins emulate the final Netlify-assets / hosted-WebSocket layout.
const app = express(), frontend = createServer(app);
await new Promise<void>(r => frontend.listen(0, '127.0.0.1', r));
const address = frontend.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const server = await realtimeFixture([url]);
app.get('/game-config.json', (_req, res) => res.json({ transport: 'websocket', serverUrl: server.url }));
app.use(express.static(resolve('dist/client')));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [];
const check = (text: string) => { checks.push(text); console.log(`PASS ${text}`); };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
try {
  const a = await (await browser.newContext()).newPage(), b = await (await browser.newContext()).newPage();
  let calls = 0;
  for (const p of [a, b]) { p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (r.url().includes('/.netlify/functions/')) calls++; }); }
  await Promise.all([a.goto(url), b.goto(url)]);
  await Promise.all([a, b].map(p => p.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor()));
  await a.locator('#callsign').fill('SPLITVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('SPLITNYX'); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  const room = server.rooms.rooms.get(code)!, player = [...room.players.values()].find(p => p.name === 'SPLITNYX')!;
  check('Independent frontend origin selects the configured backend; two browsers join the same room');
  server.io.sockets.sockets.get(player.socketId!)!.conn.close();
  await b.locator('#connection-overlay').waitFor({ state: 'visible' });
  await b.locator('#connection-overlay').waitFor({ state: 'hidden', timeout: 10000 });
  assert.equal(room.players.get(player.id)?.connected, true); assert.equal(room.players.size, 2);
  check('Transient WebSocket loss recovers the original lobby seat without refresh or duplicates');
  await a.locator('#start').click(); await Promise.all([a, b].map(p => p.locator('#hud').waitFor({ state: 'visible' })));
  server.io.sockets.sockets.get(player.socketId!)!.conn.close();
  await a.locator('#results').waitFor({ state: 'visible' }); assert.equal(await a.locator('#winner').textContent(), 'SPLITVEX');
  await b.locator('#connection-message').filter({ hasText: 'Your match seat disconnected' }).waitFor();
  assert.equal(room.players.get(player.id)?.connected, false);
  await b.locator('#connection-home').click(); await b.locator('#landing').waitFor({ state: 'visible' }); await pause(300);
  assert.equal(await b.locator('#hud').isVisible(), false);
  check('Active disconnect awards the remaining player; recovered transport shows Return home instead of reviving the old match seat');
  await a.locator('#replay').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  assert.equal(room.humans().length, 2); assert.equal(room.phase, 'lobby');
  check('Disconnected operator can join the clean next lobby');
  assert.equal(calls, 0); assert.deepEqual(errors, []);
  await mkdir('artifacts/realtime', { recursive: true });
  await writeFile('artifacts/realtime/split-report.json', JSON.stringify({ passed: true, checks, errors, functionRequests: calls, scope: 'Compiled server and production assets on two separate localhost origins. Not hosted Netlify or physical devices.' }, null, 2));
} finally { await browser.close(); await server.close(); frontend.closeAllConnections(); await new Promise<void>(r => frontend.close(() => r())); }
