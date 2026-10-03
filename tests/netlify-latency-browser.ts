import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from '../scripts/local-preview';
import { GAME_ENDPOINT } from '../shared/http-protocol';
import type { Snapshot } from '../shared/protocol';

const server = await preview();
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const checks: string[] = [], errors: string[] = [];
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
const states = new Map<Page, Snapshot>();
let code = '', blocked = false;
for (const page of [a, b]) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`**${GAME_ENDPOINT}`, async route => {
    if (blocked && page === a) { await route.abort(); return; }
    // Match the measured Netlify RTT without changing server clocks or rules.
    await pause(250);
    const response = await route.fetch();
    try { const body = await response.json(); if (body.snapshot) states.set(page, body.snapshot); } catch {}
    await pause(250); await route.fulfill({ response });
  });
}
try {
  await Promise.all([a.goto(server.url), b.goto(server.url)]);
  await Promise.all([a, b].map(p => p.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor()));
  await a.locator('#callsign').fill('LATVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('LATNYX'); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  await a.locator('#start').click(); await Promise.all([a, b].map(p => p.locator('#hud').waitFor({ state: 'visible' })));
  const playerId = states.get(a)!.players.find(p => p.name === 'LATVEX')!.id;
  await server.blobs.edit(code, data => { const p = data.room.players.find(p => p.id === playerId)!; Object.assign(p, { x: 12, z: 16, yaw: 0, pitch: 0, input: null, life: p.life + 1 }); });
  await pause(1300); await a.bringToFront(); if (await a.locator('#resume').isVisible()) await a.locator('#resume-button').click();
  await a.waitForFunction(() => document.pointerLockElement?.id === 'arena');
  await a.keyboard.down('w'); await pause(900);
  const firstStored = await server.blobs.read(code);
  const first = firstStored.room.players.find(p => p.id === playerId)!;
  const start = Date.now(); await pause(2000);
  const secondStored = await server.blobs.read(code);
  const second = secondStored.room.players.find(p => p.id === playerId)!;
  await a.keyboard.up('w');
  const elapsed = Date.now() - start, authoritativeElapsed = secondStored.simAt - firstStored.simAt, distance = first.z - second.z;
  assert.ok(distance >= 8.5, `Slow HTTP movement stalled: ${distance.toFixed(2)} m over ${elapsed} ms`);
  assert.ok(distance <= authoritativeElapsed / 1000 * 6 + 0.02, `Movement exceeded speed limit: ${distance.toFixed(2)} m over ${authoritativeElapsed} simulated ms`);
  assert.ok((second.inputLeaseMs ?? 0) >= 500 && (second.inputLeaseMs ?? 0) <= 2000);
  check(`Continuous authoritative movement at ~500 ms RTT: ${distance.toFixed(2)} m / ${elapsed} ms, no speed boost`);
  await a.keyboard.press('Escape'); await a.locator('#match-settings').click(); await a.locator('#leave-match').click(); await a.locator('#landing').waitFor({ state: 'visible' });
  await pause(1600); assert.equal(await a.locator('#landing').isVisible(), true); assert.equal(await a.locator('#hud').isVisible(), false); check('Leaving a slow connection stays on home instead of reopening the old match');
  await a.locator('#solo').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' });
  await a.keyboard.press('Escape'); await a.locator('#match-settings').click(); blocked = true;
  const leftAt = Date.now(); await a.locator('#leave-match').click(); await a.locator('#landing').waitFor({ state: 'visible', timeout: 1500 });
  assert.ok(Date.now() - leftAt < 1500); await pause(1000); blocked = false; await pause(1800);
  assert.equal(await a.locator('#landing').isVisible(), true); assert.equal(await a.locator('#hud').isVisible(), false); check('Offline leave returns home promptly and late/recovered requests do not restore the old seat');
  await a.locator('#solo').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  const expiredCode = states.get(a)!.code;
  await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' });
  await a.keyboard.press('Escape');
  await server.blobs.edit(expiredCode, data => { const human = data.room.players.find(p => !p.bot)!; human.socketId = crypto.randomUUID(); });
  await a.locator('#connection-overlay').waitFor({ state: 'visible' });
  await a.locator('#connection-message').filter({ hasText: 'Your seat' }).waitFor();
  blocked = true; await a.locator('#landing-connection').filter({ hasText: 'UNAVAILABLE' }).waitFor({ state: 'attached' });
  blocked = false; await a.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor({ state: 'attached' });
  assert.equal(await a.locator('#connection-overlay').isVisible(), true);
  assert.match((await a.locator('#connection').textContent())!, /DISCONNECTED/);
  await a.locator('#connection-home').click(); await a.locator('#landing').waitFor({ state: 'visible' });
  check('Lost-seat overlay and Return home remain available after the station connection recovers');
  assert.deepEqual(errors, []);
  await mkdir('artifacts/netlify', { recursive: true });
  await writeFile('artifacts/netlify/latency-report.json', JSON.stringify({ passed: true, checks, errors, movement: { elapsedMs: elapsed, authoritativeElapsedMs: authoritativeElapsed, meters: distance, leaseMs: second.inputLeaseMs }, scope: 'Production frontend, checked standard function, local strong/CAS Blobs fixture; two independent Chrome contexts with 250 ms uplink + 250 ms downlink delay. Not a published-fix verification.' }, null, 2));
} catch (error) {
  await mkdir('artifacts/netlify', { recursive: true });
  await writeFile('artifacts/netlify/latency-report.json', JSON.stringify({ passed: false, checks, errors, failure: String(error), landing: await a.locator('#landing-connection').textContent().catch(() => '') }, null, 2));
  await a.screenshot({ path: 'artifacts/netlify/latency-failure.png' }).catch(() => {}); throw error;
} finally {
  await Promise.all([a, b].map(page => page.unrouteAll({ behavior: 'wait' })));
  await browser.close(); await server.close();
}
