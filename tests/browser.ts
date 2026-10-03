import { chromium, type Page, type CDPSession } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createGameServer, serveProduction } from './legacy/app';
import type { Room, Player } from '../server/game';
import type { Snapshot } from '../shared/protocol';

// Production assets, real sockets, independent browser contexts, real DOM inputs.
// Controlled poses are injected only into this in-process test server, never through a gameplay endpoint.
const server = createGameServer(); serveProduction(server.app);
await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
const address = server.http.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
await mkdir('artifacts', { recursive: true });
const hardware = process.env.NB_RENDERER === 'metal';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-webgl', ...(hardware ? ['--use-angle=metal'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [];
const check = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(predicate: () => boolean, message: string, timeout = 6000) { const start = performance.now(); while (!predicate()) { if (performance.now() - start > timeout) throw new Error(message); await pause(30); } }
const observe = (page: Page) => { const data: { latest: Snapshot | null } = { latest: null }; page.on('pageerror', e => errors.push(e.message)); page.on('websocket', ws => ws.on('framereceived', f => { const payload = f.payload.toString(); if (payload.startsWith('42[')) { const event = JSON.parse(payload.slice(2)); if (event[0] === 'snapshot') data.latest = event[1]; } })); return data; };
let room: Room, aPlayer: Player, bPlayer: Player;
async function pose(placements: { p: Player; x: number; z: number; yaw?: number }[]) {
  for (const { p } of placements) Object.assign(p, { hp: 0, respawnAt: performance.now() + 60000, input: null });
  await pause(170);
  for (const { p, x, z, yaw = 0 } of placements) Object.assign(p, { x, z, yaw, pitch: 0, hp: 100, protectUntil: 0, respawnAt: 0, input: null, lastFire: -Infinity, life: p.life + 1 });
  server.io.to(room.code).emit('snapshot', room.snapshot(performance.now()));
  await pause(170);
}
async function lock(page: Page) { await page.bringToFront(); if (await page.locator('#resume').isVisible()) await page.locator('#resume-button').click(); await page.waitForFunction(() => document.pointerLockElement?.id === 'arena'); }
async function touch(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) { await session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }] }); }
try {
  const ca = await browser.newContext({ viewport: { width: 1440, height: 960 } }), cb = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await ca.newPage(), b = await cb.newPage(); observe(a); const bWire = observe(b);
  await Promise.all([a.goto(url), b.goto(url)]);
  await a.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor();
  await a.screenshot({ path: 'artifacts/landing-desktop.png', fullPage: true });
  assert.equal(await a.locator('#rules-list li').count(), 7); assert.equal(await a.locator('#toast').isVisible(), false); check('Production landing, WebGL arena, and seven visible rules load');
  await a.locator('#callsign').fill('QAVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('QANYX'); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  room = server.rooms.rooms.get(code)!; aPlayer = room.connected().find(p => p.name === 'QAVEX')!; bPlayer = room.connected().find(p => p.name === 'QANYX')!;
  assert.equal(room.connected().length, 2); assert.equal(await b.locator('#start').isDisabled(), true);
  await a.screenshot({ path: 'artifacts/lobby-desktop.png' }); check('Two independent browser sessions create/join; only the host can start');
  const oldId = bPlayer.id; await b.reload(); await b.locator('#lobby').waitFor({ state: 'visible' }); assert.equal(room.connected().length, 2); assert.equal(room.connected().find(p => p.name === 'QANYX')?.id, oldId); check('Lobby refresh restores the same seat without duplication');
  await a.bringToFront(); await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' }); await b.locator('#hud').waitFor({ state: 'visible' }); await lock(a);
  const before = { x: aPlayer.x, z: aPlayer.z }; await a.keyboard.down('w'); await pause(650); await a.keyboard.up('w'); await pause(150);
  assert.ok(Math.hypot(aPlayer.x - before.x, aPlayer.z - before.z) > 2); assert.ok(bWire.latest?.players.some(p => p.id === aPlayer.id && Math.hypot(p.x - before.x, p.z - before.z) > 2)); check('Desktop WASD moves the server-owned player and the second browser receives the same movement');
  const yawBefore = aPlayer.yaw; await a.mouse.move(600, 400); await a.mouse.move(690, 400); await pause(120); assert.notEqual(aPlayer.yaw, yawBefore); check('Pointer-lock mouse input changes authoritative aim');
  await a.keyboard.press('Escape'); await a.locator('#resume').waitFor({ state: 'visible' }); await lock(a); check('Escape releases pointer lock and Click to resume restores it');
  await pose([{ p: aPlayer, x: 0, z: 10 }, { p: bPlayer, x: 0, z: 7.25, yaw: Math.PI }]);
  await a.screenshot({ path: 'artifacts/operator-front.png' });
  await pose([{ p: aPlayer, x: 0, z: 10 }, { p: bPlayer, x: 0, z: 7.25, yaw: Math.PI / 2 }]);
  await a.screenshot({ path: 'artifacts/operator-side.png' });
  bPlayer.phaseUntil = performance.now() + 1000;
  await pause(200); await a.screenshot({ path: 'artifacts/operator-phased.png' });
  bPlayer.phaseUntil = 0; bPlayer.protectUntil = performance.now() + 1000;
  await pause(200); await a.screenshot({ path: 'artifacts/operator-protected.png' });
  bPlayer.protectUntil = 0;
  await pose([{ p: aPlayer, x: 0, z: 10 }, { p: bPlayer, x: 0, z: 7, yaw: Math.PI }]); await a.screenshot({ path: 'artifacts/match-desktop.png' });
  const scoresBefore = aPlayer.score; await a.mouse.down(); await until(() => bPlayer.hp === 0, 'held fire did not eliminate target', 2500); await a.mouse.up();
  assert.equal(aPlayer.score, scoresBefore + 1); await b.locator('#respawn').waitFor({ state: 'visible' }); assert.equal(await b.locator('#hp').textContent(), '0'); check('Held desktop fire produces server hits, three-hit elimination, kill feed, and victim respawn HUD');
  const due = bPlayer.respawnAt; await until(() => bPlayer.hp > 0, 'five-second respawn did not happen', 6500); assert.ok(performance.now() >= due); assert.ok(bPlayer.protectUntil > performance.now()); await b.locator('#life-status').filter({ hasText: 'PROTECTED' }).waitFor(); await pause(1100); assert.ok(bPlayer.protectUntil <= performance.now()); check('Actual five-second respawn and one-second visible protection run in the browser match');
  await pose([{ p: aPlayer, x: 0, z: 0 }, { p: bPlayer, x: 0, z: -9 }]); await a.mouse.down(); await pause(900); await a.mouse.up(); assert.equal(bPlayer.hp, 100); check('Browser firing cannot damage a player behind central cover');
  await pose([{ p: aPlayer, x: 0, z: -18 }, { p: bPlayer, x: 0, z: 10 }]); aPlayer.dashAt = 0; await a.keyboard.press('Shift'); await pause(140); assert.ok(aPlayer.z >= -19.58 && aPlayer.z < -19.4); const dashEnd = aPlayer.z; await a.keyboard.press('Shift'); await pause(100); assert.equal(aPlayer.z, dashEnd); check('Desktop dash stops at the wall and a repeat dash is rejected during cooldown');
  await until(() => room.cell, 'first cell did not spawn after 20 seconds', 24000); assert.ok(performance.now() >= room.startedAt + 20000);
  await pose([{ p: aPlayer, x: 0, z: 2 }, { p: bPlayer, x: 0, z: 8 }]); await a.keyboard.down('w'); await until(() => aPlayer.phaseUntil > performance.now(), 'center pickup failed', 2000); await a.keyboard.up('w'); await pause(100);
  assert.equal(room.cell, false); await a.locator('#cell-status').filter({ hasText: /^PHASE ·/ }).waitFor(); await a.screenshot({ path: 'artifacts/phase-desktop.png' }); await until(() => aPlayer.phaseUntil === 0, 'phase did not expire', 5000); check('Natural 20-second cell spawn, movement pickup, PHASE countdown, and four-second expiration');
  await cb.close(); await a.locator('#results').waitFor({ state: 'visible' }); assert.equal(await a.locator('#winner').textContent(), 'QAVEX'); await a.screenshot({ path: 'artifacts/results-desktop.png' }); await a.locator('#replay').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); assert.equal(room.phase, 'lobby'); assert.equal(aPlayer.score, 0); assert.equal(await a.locator('#start').isDisabled(), true); check('Disconnect awards the remaining player the match; replay resets the lobby and needs a second player');
  const cm = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); const m = await cm.newPage(); observe(m); await m.goto(url); await m.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor(); await m.screenshot({ path: 'artifacts/landing-mobile.png', fullPage: true });
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await m.locator('#callsign').fill('QAION'); await m.locator('#room-code').fill(code); await m.locator('#join').click(); await m.locator('#lobby').waitFor({ state: 'visible' });
  await m.setViewportSize({ width: 844, height: 390 }); await a.bringToFront(); await a.locator('#start').click(); await m.locator('#hud').waitFor({ state: 'visible' }); const mobilePlayer = room.connected().find(p => p.name === 'QAION')!; await m.bringToFront();
  assert.equal(await m.locator('#fire').isVisible(), true); const session = await cm.newCDPSession(m);
  const stick = (await m.locator('#stick').boundingBox())!, sx = stick.x + stick.width / 2, sy = stick.y + stick.height / 2, pos = { x: mobilePlayer.x, z: mobilePlayer.z };
  await touch(session, 'touchStart', sx, sy); await touch(session, 'touchMove', sx, sy - 30); await pause(700); await touch(session, 'touchEnd'); assert.ok(Math.hypot(mobilePlayer.x - pos.x, mobilePlayer.z - pos.z) > 1); assert.equal(await m.evaluate(() => scrollY), 0); check('Mobile portrait layout fits; real emulated touch joystick moves without page scrolling');
  const originalYaw = mobilePlayer.yaw; await touch(session, 'touchStart', 520, 180); await touch(session, 'touchMove', 580, 180); await touch(session, 'touchEnd'); await pause(100); assert.notEqual(mobilePlayer.yaw, originalYaw); check('Right-side touch drag changes aim independently of movement');
  await pose([{ p: mobilePlayer, x: 0, z: 10 }, { p: aPlayer, x: 0, z: 7, yaw: Math.PI }]); await m.screenshot({ path: 'artifacts/match-mobile.png' });
  const fire = (await m.locator('#fire').boundingBox())!; await touch(session, 'touchStart', fire.x + fire.width / 2, fire.y + fire.height / 2); await until(() => aPlayer.hp === 0, 'touch fire failed', 2500); await touch(session, 'touchEnd'); check('Dedicated mobile Fire button eliminates the other live browser player');
  await pose([{ p: mobilePlayer, x: 10, z: 12 }, { p: aPlayer, x: 15, z: 15 }]); mobilePlayer.dashAt = 0;
  const dash = (await m.locator('#dash-touch').boundingBox())!; await touch(session, 'touchStart', dash.x + dash.width / 2, dash.y + dash.height / 2); await touch(session, 'touchEnd'); await pause(150); assert.ok(Math.abs(mobilePlayer.z - 6) < 0.1); check('Dedicated mobile Dash button travels six meters and shows its cooldown');
  await cm.close(); await a.locator('#results').waitFor({ state: 'visible' }); await a.locator('#leave-results').click(); await a.locator('#landing').waitFor({ state: 'visible' });
  await a.locator('#solo').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  room = [...server.rooms.rooms.values()].find(candidate => candidate.mode === 'solo' && candidate.humans().some(p => p.name === 'QAVEX'))!;
  assert.ok(room); aPlayer = room.humans()[0]; const soloId = aPlayer.id, botIds = room.connected().filter(p => p.bot).map(p => p.id);
  assert.equal(await a.locator('#roster .bot-tag').count(), 3); assert.equal(await a.locator('#copy-code').isVisible(), false); assert.equal(await a.locator('#start').isEnabled(), true);
  await a.screenshot({ path: 'artifacts/solo-lobby.png' }); check('Play Solo creates a private one-human lobby with three explicit BOT labels and enabled Start');
  await a.reload(); await a.locator('#lobby').waitFor({ state: 'visible' }); assert.equal(room.humans()[0].id, soloId); assert.deepEqual(room.connected().filter(p => p.bot).map(p => p.id), botIds); check('Solo lobby refresh recovers one human without duplicating bots');
  await a.bringToFront(); await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' }); await lock(a);
  const botStart = room.connected().filter(p => p.bot).map(p => ({ id: p.id, x: p.x, z: p.z }));
  await until(() => botStart.every(previous => { const p = room.players.get(previous.id)!; return Math.hypot(p.x - previous.x, p.z - previous.z) > 1; }), 'solo bots did not move', 4000);
  assert.equal(room.phase, 'playing'); assert.equal(room.winner, null); assert.equal(await a.locator('#scores .bot-tag').count(), 3); assert.match((await a.locator('#match-code').textContent())!, /SOLO PRACTICE/);
  await until(() => room.connected().some(p => p.bot && Number.isFinite(p.lastFire)), 'solo bots did not fire', 15000); await a.screenshot({ path: 'artifacts/solo-match.png' }); check('A solo match runs with one human while server bots visibly move and fire');
  const winningBot = room.connected().find(p => p.bot)!;
  for (const p of room.connected()) { p.score = p.id === winningBot.id ? 4 : 0; p.scoreAt = performance.now(); }
  // Only the test server advances the deadline to exercise the actual timeout/results path.
  room.endsAt = performance.now() + 180; await a.locator('#results').waitFor({ state: 'visible' }); assert.equal(await a.locator('#winner').textContent(), winningBot.name); assert.match((await a.locator('#result-label').textContent())!, /BOT/); assert.equal(await a.locator('#final-scores .bot-tag').count(), 3);
  await a.screenshot({ path: 'artifacts/solo-results.png' }); await a.locator('#replay').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); assert.equal(room.players.size, 4); assert.ok(room.connected().every(p => p.score === 0 && p.hp === 100)); assert.equal(await a.locator('#start').isEnabled(), true); check('Solo results identify a bot winner; replay resets all four operators and can start alone again');
  await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' }); await a.keyboard.press('Escape'); await a.locator('#match-settings').click(); await a.locator('#leave-match').click(); await a.locator('#landing').waitFor({ state: 'visible' }); assert.equal(room.phase, 'ended'); assert.equal(room.humans().length, 0); assert.equal(room.host, ''); assert.ok(room.emptyAt !== null); check('Leaving solo stops the match and makes the room eligible for cleanup');
  assert.deepEqual(errors, []); check('No JavaScript page errors across multiplayer, mobile, and solo browser sessions');
  await writeFile('artifacts/browser-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), url, mode: `Production build; local Chromium (${hardware ? 'Metal requested' : 'SwiftShader'}); separate browser contexts; mobile emulation; test-server poses for combat fixtures; no physical device or public URL tested`, checks, errors }, null, 2));
  console.log(`All ${checks.length} browser checks passed.`);
} catch (error) {
  await writeFile('artifacts/browser-report.json', JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2));
  for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) await page.screenshot({ path: `artifacts/failure-${index}.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); await server.close(); }
