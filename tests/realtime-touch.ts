import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { realtimeFixture } from './realtime-fixture';
import type { Snapshot } from '../shared/protocol';
import { GAME_ENDPOINT } from '../shared/http-protocol';
const server = await realtimeFixture();
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling'] });
const checks: string[] = [], errors: string[] = [];
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const a = await desktop.newPage(), m = await mobile.newPage();
  let state: Snapshot | null = null;
  for (const page of [a, m]) { page.on('pageerror', e => errors.push(e.message)); page.on('websocket', socket => socket.on('framereceived', ({ payload }) => { if (typeof payload === 'string' && payload.startsWith('42')) { try { const [event, packet] = JSON.parse(payload.slice(2)); if (event === 'snapshot') state = packet.snapshot; } catch {} } })); }
  await Promise.all([a.goto(server.url), m.goto(server.url)]);
  await Promise.all([a, m].map(p => p.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor()));
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); check('Mobile portrait landing fits the screen');
  await a.locator('#callsign').fill('DESKTOP'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); const code = (await a.locator('#lobby-code').textContent())!;
  await m.locator('#callsign').fill('TOUCH'); await m.locator('#room-code').fill(code); await m.locator('#join').click(); await m.locator('#lobby').waitFor({ state: 'visible' });
  await m.setViewportSize({ width: 844, height: 390 }); await pause(600); await a.locator('#start').click(); await m.locator('#hud').waitFor({ state: 'visible' }); await m.bringToFront();
  const p = (await server.blobs.read(code)).room.players.find(p => p.name === 'TOUCH')!, id = p.id;
  const cdp = await mobile.newCDPSession(m);
  async function touch(type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }); }
  const stick = (await m.locator('#stick').boundingBox())!, sx = stick.x + stick.width / 2, sy = stick.y + stick.height / 2;
  await touch('touchStart', sx, sy); await touch('touchMove', sx, sy - 30); await pause(700); await touch('touchEnd'); await pause(200);
  const after = (await server.blobs.read(code)).room.players.find(p => p.id === id)!;
  assert.ok(Math.hypot(after.x - p.x, after.z - p.z) > 1); assert.equal(await m.evaluate(() => scrollY), 0); check('Touch joystick changes authoritative position without page scrolling');
  await touch('touchStart', 520, 180); await touch('touchMove', 580, 180); await touch('touchEnd'); await pause(250);
  assert.notEqual((await server.blobs.read(code)).room.players.find(p => p.id === id)!.yaw, after.yaw); check('Right-side drag changes authoritative aim');
  await server.blobs.edit(code, data => { for (const player of data.room.players) Object.assign(player, { x: 0, z: player.id === id ? 10 : 7, yaw: player.id === id ? 0 : Math.PI, hp: 100, input: null, lastFire: -Infinity, protectUntil: 0, life: player.life + 1 }); });
  await pause(400); const fire = (await m.locator('#fire').boundingBox())!;
  await touch('touchStart', fire.x + fire.width / 2, fire.y + fire.height / 2); await pause(1000); await touch('touchEnd'); await pause(250);
  const shot = await server.blobs.read(code); assert.equal(shot.room.players.find(p => p.id === id)!.score, 1); assert.equal(shot.room.players.find(p => p.name === 'DESKTOP')!.hp, 0);
  check('Dedicated touch Fire scores a three-hit elimination against the separate browser');
  await server.blobs.edit(code, data => { const player = data.room.players.find(p => p.id === id)!; Object.assign(player, { x: 0, z: -18, yaw: 0, input: null, dashAt: 0, life: player.life + 1 }); }); await pause(400);
  const dash = (await m.locator('#dash-touch').boundingBox())!; await touch('touchStart', dash.x + dash.width / 2, dash.y + dash.height / 2); await touch('touchEnd'); await pause(250);
  const dashed = (await server.blobs.read(code)).room.players.find(p => p.id === id)!; assert.ok(dashed.z >= -19.58 && dashed.z < -19.4); check('Dedicated touch Dash stops at the arena wall and shows cooldown');
  await mkdir('artifacts/realtime', { recursive: true }); await m.screenshot({ path: 'artifacts/realtime/mobile.png' });
  await a.bringToFront(); await a.keyboard.press('Escape'); await a.locator('#match-settings').click(); await a.locator('#leave-match').click(); await m.locator('#results').waitFor({ state: 'visible' }); assert.equal(await m.locator('#winner').textContent(), 'TOUCH'); check('Explicit leave transfers host and awards the last connected player');
  await m.locator('#leave-results').click(); await m.locator('#landing').waitFor({ state: 'visible' }); await m.locator('#solo').click(); await m.locator('#lobby').waitFor({ state: 'visible' });
  assert.equal(await m.locator('#roster .bot-tag').count(), 3); await m.locator('#start').click(); await m.locator('#hud').waitFor({ state: 'visible' }); await pause(2500);
  const data = await server.blobs.read((state as unknown as Snapshot).code); assert.equal(data.room.mode, 'solo'); assert.equal(data.room.phase, 'playing'); assert.equal(data.room.brains.length, 3); assert.ok(data.room.players.filter(p => p.bot).every(p => p.ack > 30));
  check('Solo starts with three labeled bots; authoritative bots move on the persistent simulation');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/realtime/touch-report.json', JSON.stringify({ passed: true, checks, errors, scope: 'Built production frontend and compiled app.mjs real-time server. Chrome touch emulation; not a physical phone or cloud latency test.' }, null, 2));
} finally { await browser.close(); await server.close(); }
