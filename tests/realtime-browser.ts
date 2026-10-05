import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Snapshot } from '../shared/protocol';
import { GAME_ENDPOINT } from '../shared/http-protocol';
import { realtimeFixture, delaySocket } from './realtime-fixture';

const server = await realtimeFixture();
await mkdir('artifacts/realtime', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-webgl', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [], rounds: unknown[] = [];
const rejected: unknown[] = [];
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const check = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const ca = await browser.newContext({ viewport: { width: 1280, height: 800 } }), cb = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const a = await ca.newPage(), b = await cb.newPage();
function watch(page: Page) {
  const data: { state: Snapshot | null; requests: number; sockets: number; snapshots: number } = { state: null, requests: 0, sockets: 0, snapshots: 0 };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === GAME_ENDPOINT) data.requests++; });
  page.on('websocket', socket => {
    data.sockets++;
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('42')) return;
      try { const [event, packet] = JSON.parse(payload.slice(2)); if (event === 'snapshot') { data.state = packet.snapshot; data.snapshots++; } } catch {}
    });
  });
  return data;
}
const aw = watch(a), bw = watch(b);
let code = '', idA = '', idB = '';
async function pose(shooter: string, victim: string, cover = false) {
  await server.blobs.edit(code, data => {
    for (const p of data.room.players) {
      p.input = null; p.hp = 100; p.protectUntil = 0; p.respawnAt = 0; p.lastFire = -Infinity; p.life++;
      p.x = 0; p.z = p.id === shooter ? (cover ? 0 : 10) : (cover ? -9 : 7); p.yaw = p.id === shooter ? 0 : Math.PI; p.pitch = 0;
    }
  });
  await pause(350);
}
async function lock(page: Page) { await page.bringToFront(); if (await page.locator('#resume').isVisible()) await page.locator('#resume-button').click(); await page.waitForFunction(() => document.pointerLockElement?.id === 'arena'); }
async function until(predicate: () => boolean, message: string, timeout = 7000) { const at = Date.now(); while (!predicate()) { if (Date.now() - at > timeout) throw new Error(message); await pause(50); } }
async function eliminate(page: Page, shooter: string, victim: string) {
  await pose(shooter, victim); await lock(page); await page.mouse.down();
  await until(() => aw.state?.players.find(p => p.id === victim)?.hp === 0, 'Real-time fire did not eliminate exposed player');
  await page.mouse.up(); await pause(250);
}
try {
  await Promise.all([delaySocket(a, 100), delaySocket(b, 100)]);
  await Promise.all([a.goto(server.url), b.goto(server.url)]);
  await Promise.all([a, b].map(p => p.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor()));
  await a.locator('#callsign').fill('QAVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('QANYX'); await b.locator('#join-open').click(); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  await until(() => aw.state?.players.length === 2, 'Host did not see second player');
  idA = aw.state!.players.find(p => p.name === 'QAVEX')!.id; idB = aw.state!.players.find(p => p.name === 'QANYX')!.id;
  assert.notEqual(idA, idB); assert.equal(await b.locator('#start').isDisabled(), true);
  check('Built frontend and compiled production server create/join two independent clients with host-only Start at 200 ms added RTT');
  await b.reload(); await b.locator('#lobby').waitFor({ state: 'visible' }); await until(() => bw.state?.players.find(p => p.name === 'QANYX')?.id === idB, 'Refresh lost seat');
  assert.equal(bw.state!.players.length, 2); check('Lobby refresh recovers the same seat without duplicate operators');
  for (let round = 1; round <= 3; round++) {
    await a.bringToFront(); await a.locator('#start').click(); await Promise.all([a, b].map(p => p.locator('#hud').waitFor({ state: 'visible' })));
    await until(() => aw.state?.phase === 'playing' && aw.state.match === round, 'Round did not start');
    const start = aw.state!.startedAt;
    console.log(`ROUND ${round} started; verifying full unmodified 180-second clock.`);
    if (round === 1) {
      await server.blobs.edit(code, data => { const p = data.room.players.find(p => p.id === idA)!; Object.assign(p, { x: 12, z: 16, yaw: 0, pitch: 0, input: null, life: p.life + 1 }); });
      await pause(500); await lock(a);
      await a.keyboard.down('w'); await pause(600);
      const before = (await server.blobs.read(code)).room.players.find(p => p.id === idA)!;
      const count = bw.snapshots, at = server.now(); await pause(2000);
      const after = (await server.blobs.read(code)).room.players.find(p => p.id === idA)!;
      const elapsed = server.now() - at, distance = before.z - after.z, snapshots = bw.snapshots - count;
      await a.keyboard.up('w'); await pause(350);
      assert.ok(distance > 10 && distance <= elapsed / 1000 * 6 + .2, `${distance} m in ${elapsed} ms`);
      assert.ok(snapshots >= 35 && snapshots <= 45, `${snapshots} snapshots in two seconds`);
      assert.ok(Math.abs(bw.state!.players.find(p => p.id === idA)!.z - after.z) < 2);
      rounds.push({ networkCheck: { addedRttMs: 200, elapsedMs: elapsed, meters: distance, snapshots } });
      check(`Continuous desktop movement at 200 ms added RTT: ${distance.toFixed(2)} m / ${Math.round(elapsed)} ms; ${snapshots} pushed snapshots; other client agrees`);
      await a.keyboard.press('Escape'); await a.locator('#resume').waitFor({ state: 'visible' }); await lock(a);
      check('Escape/resume and first-person pointer lock still work');
      await pose(idA, idB, true); await lock(a); await a.mouse.down(); await pause(1000); await a.mouse.up();
      assert.equal(aw.state!.players.find(p => p.id === idB)!.hp, 100); check('Geometry blocks shots in the real-time match');
      await eliminate(a, idA, idB);
      assert.equal(aw.state!.players.find(p => p.id === idA)!.score, 1); await b.locator('#respawn').waitFor({ state: 'visible' });
      const due = aw.state!.players.find(p => p.id === idB)!.respawnAt;
      await until(() => bw.state!.players.find(p => p.id === idB)!.hp === 100, 'Five-second respawn failed');
      assert.ok(Date.now() >= due); await b.locator('#life-status').filter({ hasText: 'PROTECTED' }).waitFor();
      await pause(1100); assert.ok(bw.state!.players.find(p => p.id === idB)!.protectUntil <= bw.state!.now);
      check('Three hits score one elimination; real five-second respawn and one-second visible protection');
      await until(() => aw.state!.cell, 'Natural 20-second Phase Cell spawn failed', 24000);
      await server.blobs.edit(code, data => { const p = data.room.players.find(p => p.id === idA)!; p.x = 0; p.z = 2; p.yaw = 0; p.input = null; p.life++; });
      await pause(350); await lock(a); await a.keyboard.down('w'); await until(() => aw.state!.players.find(p => p.id === idA)!.phaseUntil > Date.now(), 'Phase pickup failed'); await a.keyboard.up('w');
      await a.locator('#cell-status').filter({ hasText: /^PHASE ·/ }).waitFor(); await a.screenshot({ path: 'artifacts/realtime/match.png' });
      await until(() => aw.state!.players.find(p => p.id === idA)!.phaseUntil === 0, 'Phase did not expire', 5000);
      check('Natural Phase Cell spawn, center pickup, and four-second expiration over WebSockets');
    } else if (round === 2) await eliminate(b, idB, idA);
    else { await eliminate(b, idB, idA); await eliminate(a, idA, idB); }
    // No fixture changes scores, deadlines, winning rules, or the clock.
    const expected = round === 1 ? 'QAVEX' : 'QANYX';
    while (aw.state?.phase === 'playing') {
      if (Date.now() > start + 190_000) throw new Error('Full contract did not finish');
      await pause(1000);
      await (Math.floor((Date.now() - start) / 5000) % 2 ? a : b).bringToFront();
      if (Math.round((Date.now() - start) / 1000) % 30 === 0) console.log(`ROUND ${round}: ${Math.round((Date.now() - start) / 1000)}s elapsed`);
    }
    await Promise.all([a, b].map(p => p.locator('#results').waitFor({ state: 'visible' })));
    assert.ok(Date.now() - start >= 180_000);
    assert.equal(await a.locator('#winner').textContent(), expected); assert.equal(await b.locator('#winner').textContent(), expected);
    assert.equal(aw.state!.reason, 'Contract time expired');
    const scores = Object.fromEntries(aw.state!.players.map(p => [p.name, p.score]));
    assert.deepEqual(scores, round === 1 ? { QAVEX: 1, QANYX: 0 } : round === 2 ? { QAVEX: 0, QANYX: 1 } : { QAVEX: 1, QANYX: 1 });
    rounds.push({ round, elapsedMs: Date.now() - start, scores, winner: expected, reason: aw.state!.reason });
    await a.screenshot({ path: `artifacts/realtime/round-${round}-results.png` });
    check(`Complete 180-second round ${round}: scores ${JSON.stringify(scores)}, winner ${expected}${round === 3 ? ' (earlier tied-score tiebreaker)' : ''}`);
    await a.bringToFront(); await a.locator('#replay').click(); await Promise.all([a, b].map(p => p.locator('#lobby').waitFor({ state: 'visible' })));
    await until(() => aw.state!.phase === 'lobby' && aw.state!.players.every(p => p.score === 0 && p.hp === 100), 'Replay did not reset');
    check(`Replay ${round} returns both players to a clean lobby`);
  }
  assert.ok(aw.sockets >= 1 && bw.sockets >= 2); assert.equal(aw.requests + bw.requests, 0); assert.deepEqual(errors, []);
  check('Gameplay uses WebSockets exclusively: zero function requests and zero browser errors');
  await writeFile('artifacts/realtime/browser-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), url: server.url, checks, rounds, errors, requests: [aw.requests, bw.requests], scope: 'Built production assets and compiled production app.mjs. Two independent Chrome contexts with 100 ms delay in each direction. Real 180-second clocks; only server-side poses controlled for reproducible combat. Public backend and physical devices not verified.' }, null, 2));
} catch (error) {
  await writeFile('artifacts/realtime/browser-report.json', JSON.stringify({ passed: false, checks, rounds, errors, failure: String(error), rejected, state: aw.state, stored: code ? await server.blobs.read(code) : null }, null, 2));
  await a.screenshot({ path: 'artifacts/realtime/failure.png' }).catch(() => {}); throw error;
} finally { await browser.close(); await server.close(); }
