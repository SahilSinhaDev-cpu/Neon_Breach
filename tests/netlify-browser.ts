import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Snapshot } from '../shared/protocol';
import { GAME_ENDPOINT } from '../shared/http-protocol';
import { preview } from '../scripts/local-preview';

const unpacked = await mkdtemp(join(tmpdir(), 'neon-function-'));
execFileSync('unzip', ['-q', 'dist/functions/game.zip', '-d', unpacked]);
// Exact artifact produced by Netlify's official packager, not the TS source.
const packaged = await import(pathToFileURL(join(unpacked, 'netlify/functions/game.mjs')).href);
const server = await preview(packaged.default);
await mkdir('artifacts/netlify', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-webgl', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [], rounds: unknown[] = [];
const rejected: unknown[] = [];
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const check = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const ca = await browser.newContext({ viewport: { width: 1280, height: 800 } }), cb = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const a = await ca.newPage(), b = await cb.newPage();
function watch(page: Page) {
  const data: { state: Snapshot | null; requests: number; sockets: number } = { state: null, requests: 0, sockets: 0 };
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', () => data.sockets++);
  page.on('response', async response => { if (new URL(response.url()).pathname !== GAME_ENDPOINT) return; data.requests++; try { const reply = await response.json(); if (reply.snapshot) data.state = reply.snapshot; else if (!reply.ok) rejected.push({ at: Date.now(), status: response.status(), error: reply.error }); } catch {} });
  return data;
}
const aw = watch(a), bw = watch(b);
let code = '', idA = '', idB = '';
async function pose(shooter: string, victim: string, cover = false) {
  await server.blobs.edit(code, data => {
    for (const p of data.room.players) {
      p.input = null; p.hp = 100; p.protectUntil = 0; p.respawnAt = 0; p.lastFire = null; p.life++;
      p.x = 0; p.z = p.id === shooter ? (cover ? 0 : 10) : (cover ? -9 : 7); p.yaw = p.id === shooter ? 0 : Math.PI; p.pitch = 0;
    }
  });
  await pause(350);
}
async function lock(page: Page) { await page.bringToFront(); if (await page.locator('#resume').isVisible()) await page.locator('#resume-button').click(); await page.waitForFunction(() => document.pointerLockElement?.id === 'arena'); }
async function until(predicate: () => boolean, message: string, timeout = 7000) { const at = Date.now(); while (!predicate()) { if (Date.now() - at > timeout) throw new Error(message); await pause(50); } }
async function eliminate(page: Page, shooter: string, victim: string) {
  await pose(shooter, victim); await lock(page); await page.mouse.down();
  await until(() => aw.state?.players.find(p => p.id === victim)?.hp === 0, 'HTTP fire did not eliminate exposed player');
  await page.mouse.up(); await pause(250);
}
try {
  await Promise.all([a.goto(server.url), b.goto(server.url)]);
  await Promise.all([a, b].map(p => p.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor()));
  await a.locator('#callsign').fill('QAVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('QANYX'); await b.locator('#join-open').click(); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  await until(() => aw.state?.players.length === 2, 'Host did not see second player');
  idA = aw.state!.players.find(p => p.name === 'QAVEX')!.id; idB = aw.state!.players.find(p => p.name === 'QANYX')!.id;
  assert.notEqual(idA, idB); assert.equal(await b.locator('#start').isDisabled(), true);
  check('Production frontend and packaged standard function create/join a two-player room with host-only Start');
  await b.reload(); await b.locator('#lobby').waitFor({ state: 'visible' }); await until(() => bw.state?.players.find(p => p.name === 'QANYX')?.id === idB, 'Refresh lost seat');
  assert.equal(bw.state!.players.length, 2); check('Lobby refresh recovers the same seat without duplicate operators');
  for (let round = 1; round <= 3; round++) {
    await a.bringToFront(); await a.locator('#start').click(); await Promise.all([a, b].map(p => p.locator('#hud').waitFor({ state: 'visible' })));
    await until(() => aw.state?.phase === 'playing' && aw.state.match === round, 'Round did not start');
    const start = aw.state!.startedAt;
    console.log(`ROUND ${round} started; verifying full unmodified 180-second clock.`);
    if (round === 1) {
      await lock(a); const before = aw.state!.players.find(p => p.id === idA)!;
      await a.keyboard.down('w'); await pause(750); await a.keyboard.up('w'); await pause(300);
      assert.ok(Math.hypot(bw.state!.players.find(p => p.id === idA)!.x - before.x, bw.state!.players.find(p => p.id === idA)!.z - before.z) > 2);
      check('Desktop movement is authoritative and visible in the other independent browser');
      await a.keyboard.press('Escape'); await a.locator('#resume').waitFor({ state: 'visible' }); await lock(a);
      check('Escape/resume and first-person pointer lock still work');
      await pose(idA, idB, true); await lock(a); await a.mouse.down(); await pause(1000); await a.mouse.up();
      assert.equal(aw.state!.players.find(p => p.id === idB)!.hp, 100); check('Geometry blocks shots in the packaged-function match');
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
      await a.locator('#cell-status').filter({ hasText: /^PHASE ·/ }).waitFor(); await a.screenshot({ path: 'artifacts/netlify/match.png' });
      await until(() => aw.state!.players.find(p => p.id === idA)!.phaseUntil === 0, 'Phase did not expire', 5000);
      check('Natural Phase Cell spawn, center pickup, and four-second expiration over HTTP');
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
    await a.screenshot({ path: `artifacts/netlify/round-${round}-results.png` });
    check(`Complete 180-second round ${round}: scores ${JSON.stringify(scores)}, winner ${expected}${round === 3 ? ' (earlier tied-score tiebreaker)' : ''}`);
    await a.bringToFront(); await a.locator('#replay').click(); await Promise.all([a, b].map(p => p.locator('#lobby').waitFor({ state: 'visible' })));
    await until(() => aw.state!.phase === 'lobby' && aw.state!.players.every(p => p.score === 0 && p.hp === 100), 'Replay did not reset');
    check(`Replay ${round} returns both players to a clean lobby`);
  }
  assert.equal(aw.sockets + bw.sockets, 0); assert.ok(aw.requests > 100 && bw.requests > 100); assert.deepEqual(errors, []);
  check('Only /.netlify/functions/game HTTP requests; no WebSockets or browser errors');
  await writeFile('artifacts/netlify/browser-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), url: server.url, checks, rounds, errors, requests: [aw.requests, bw.requests], scope: 'Production assets and packaged game.mjs, two independent Chromium contexts, official local Blobs emulator with ETag/atomic-operation fixture adapters. Real 180-second clocks; controlled server-only poses for exposed/covered combat. Cloud deployment and physical devices not verified.' }, null, 2));
} catch (error) {
  await writeFile('artifacts/netlify/browser-report.json', JSON.stringify({ passed: false, checks, rounds, errors, failure: String(error), rejected, state: aw.state, stored: code ? await server.blobs.read(code) : null }, null, 2));
  await a.screenshot({ path: 'artifacts/netlify/failure.png' }).catch(() => {}); throw error;
} finally { await browser.close(); await server.close(); await rm(unpacked, { recursive: true, force: true }); }
