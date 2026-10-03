import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preview } from '../scripts/local-preview';
import { GAME_ENDPOINT, RELEASE } from '../shared/http-protocol';
import type { Snapshot } from '../shared/protocol';

const unpacked = await mkdtemp(join(tmpdir(), 'neon-recovery-'));
execFileSync('unzip', ['-q', 'dist/functions/game.zip', '-d', unpacked]);
const packaged = await import(pathToFileURL(join(unpacked, 'netlify/functions/game.mjs')).href);
const server = await preview(packaged.default);
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const checks: string[] = [], errors: string[] = [];
const states = new Map<Page, Snapshot>();
let failJoins = 0, failedJoins = 0, failPolls = 0, failedPolls = 0, offline = false, code = '';
let holdRecovery = false, recoveryHeld = false, releaseRecovery: (() => void) | undefined;
let movement: unknown;
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
async function until(predicate: () => boolean | Promise<boolean>, message: string, timeout = 12_000) {
  const at = Date.now(); while (!await predicate()) { if (Date.now() - at > timeout) throw new Error(message); await pause(60); }
}
for (const page of [a, b]) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`**${GAME_ENDPOINT}`, async route => {
    const packet = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    await pause(200);
    const recovery = page === a && packet?.action === 'join' && packet.token;
    const fail = page === a && ((recovery && failJoins > 0) || (packet?.action === 'poll' && (offline || failPolls > 0)));
    if (fail) {
      if (recovery) { failJoins--; failedJoins++; } else { failPolls = Math.max(0, failPolls - 1); failedPolls++; }
      await pause(200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Station storage is temporarily unavailable. Retrying…', retryable: true, errorCode: 'STORAGE_UNAVAILABLE' }) }); return;
    }
    const response = await route.fetch();
    try { const body = await response.json(); if (body.snapshot) states.set(page, body.snapshot); } catch {}
    assert.equal(response.headers()['x-neon-release'], RELEASE);
    if (recovery && holdRecovery) {
      recoveryHeld = true;
      await new Promise<void>(resolve => { releaseRecovery = resolve; });
    }
    await pause(200); await route.fulfill({ response });
  });
}
try {
  await Promise.all([a.goto(server.url), b.goto(server.url)]);
  await Promise.all([a, b].map(p => p.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor()));
  await a.locator('#callsign').fill('RECVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('RECNYX'); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  await until(() => states.get(a)?.players.length === 2, 'Second player missing');
  const id = states.get(a)!.players.find(p => p.name === 'RECVEX')!.id;
  failJoins = 2;
  await a.reload();
  await until(() => failedJoins === 2, 'Recovery failure injection did not run');
  assert.ok(await a.evaluate(() => sessionStorage.getItem('nb-seat')), 'Transient failure discarded saved seat');
  await a.locator('#lobby').waitFor({ state: 'visible' });
  assert.equal(states.get(a)!.players.find(p => p.name === 'RECVEX')!.id, id);
  assert.equal(states.get(a)!.players.length, 2);
  check('Refresh recovery survives two HTTP 503 responses, preserving token, room and original player ID without duplicates');

  offline = true;
  await until(() => states.get(b)?.players.find(p => p.id === id)?.connected === false, 'Lobby heartbeat did not expire');
  assert.equal(states.get(b)!.host, states.get(b)!.players.find(p => p.name === 'RECNYX')!.id);
  offline = false;
  await until(() => states.get(b)?.players.find(p => p.id === id)?.connected === true, 'Expired lobby seat did not recover');
  await a.locator('#connection-overlay').waitFor({ state: 'hidden' });
  assert.equal(states.get(a)!.players.length, 2);
  check('Lobby heartbeat expiry transfers host and automatically recovers the same seat when the connection returns');
  await b.locator('#start').click(); await Promise.all([a, b].map(p => p.locator('#hud').waitFor({ state: 'visible' })));
  const pose = async () => {
    await server.blobs.edit(code, data => { const p = data.room.players.find(p => p.id === id)!; Object.assign(p, { x: 12, z: 16, yaw: 0, pitch: 0, input: null, life: p.life + 1 }); });
    await pause(1100);
  };
  await pose(); await a.bringToFront(); if (await a.locator('#resume').isVisible()) await a.locator('#resume-button').click();
  await a.waitForFunction(() => document.pointerLockElement?.id === 'arena');
  await a.keyboard.down('w'); await pause(800);
  const before = await server.blobs.read(code);
  failPolls = 2;
  const failedBefore = failedPolls;
  await until(() => failedPolls >= failedBefore + 2, 'Movement failure injection did not run');
  assert.equal(await a.locator('#connection-overlay').isVisible(), false, 'Brief errors unnecessarily paused controls');
  await pause(2000);
  const after = await server.blobs.read(code);
  await a.keyboard.up('w');
  const distance = before.room.players.find(p => p.id === id)!.z - after.room.players.find(p => p.id === id)!.z;
  const elapsed = after.simAt - before.simAt;
  assert.ok(distance >= elapsed / 1000 * 6 - 1.8, `Held movement stalled across brief errors: ${distance} m in ${elapsed} ms`);
  assert.ok(distance <= elapsed / 1000 * 6 + .02, 'Retry caused speed boost');
  movement = { meters: distance, authoritativeElapsedMs: elapsed, failedPolls: 2 };
  check(`One held W press survives two failed polls at ~400 ms RTT: ${distance.toFixed(2)} m over ${elapsed} ms, within server speed limit`);

  await pose(); await a.keyboard.down('w'); await pause(700); offline = true;
  await a.locator('#connection-overlay').waitFor({ state: 'visible', timeout: 5000 });
  offline = false;
  await a.locator('#connection-overlay').waitFor({ state: 'hidden', timeout: 5000 });
  await pause(700);
  const recovered = await server.blobs.read(code);
  assert.equal(recovered.room.players.find(p => p.id === id)!.input?.my, 1, 'Held key was lost during pause');
  await pause(800);
  const moved = await server.blobs.read(code);
  assert.ok(recovered.room.players.find(p => p.id === id)!.z - moved.room.players.find(p => p.id === id)!.z > 2.5);
  await a.keyboard.up('w');
  check('Sustained interruption shows reconnect overlay; held movement resumes after recovery without releasing and pressing W again');

  await a.keyboard.press('Escape'); await a.locator('#match-settings').click(); await a.locator('#leave-match').click(); await a.locator('#landing').waitFor({ state: 'visible' });
  await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  const cancelCode = (await a.locator('#lobby-code').textContent())!;
  failJoins = 1; holdRecovery = true;
  await a.reload(); await a.locator('#connection-overlay').waitFor({ state: 'visible' });
  await until(() => recoveryHeld, 'Recovery acknowledgement was not held');
  await a.locator('#connection-home').click();
  holdRecovery = false; releaseRecovery?.();
  await a.locator('#landing').waitFor({ state: 'visible' }); await pause(1800);
  assert.equal(await a.locator('#lobby').isVisible(), false);
  assert.equal(await a.evaluate(() => sessionStorage.getItem('nb-seat')), null);
  assert.equal((await server.blobs.read(cancelCode)).room.players.some(p => p.connected), false);
  check('Return home during a delayed seat-recovery acknowledgement cancels recovery, releases the late seat, and stays home');
  assert.deepEqual(errors, []);
  await mkdir('artifacts/netlify', { recursive: true });
  await writeFile('artifacts/netlify/recovery-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), release: RELEASE, checks, errors, movement, failedJoins, failedPolls, scope: 'Production frontend and exact packaged function; two independent Chrome contexts; local strong/CAS Blobs fixture; 200 ms uplink + 200 ms downlink and injected HTTP 503 responses. Cloud deployment of these changes not verified.' }, null, 2));
} catch (error) {
  await mkdir('artifacts/netlify', { recursive: true });
  await writeFile('artifacts/netlify/recovery-report.json', JSON.stringify({ passed: false, checks, errors, failure: String(error), failedJoins, failedPolls }, null, 2));
  await a.screenshot({ path: 'artifacts/netlify/recovery-failure.png' }).catch(() => {}); throw error;
} finally {
  releaseRecovery?.();
  await Promise.all([a, b].map(p => p.unrouteAll({ behavior: 'wait' })));
  await browser.close(); await server.close(); await rm(unpacked, { recursive: true, force: true });
}
