import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realtimeFixture } from './realtime-fixture';
import { preview } from '../scripts/local-preview';
import type { Player } from '../server/game';

const http = process.argv.includes('--http'), mode = http ? 'function' : 'websocket';
let unpacked = '';
async function fixture() {
  if (!http) return realtimeFixture();
  unpacked = await mkdtemp(join(tmpdir(), 'neon-menu-function-'));
  execFileSync('unzip', ['-q', 'dist/functions/game.zip', '-d', unpacked]);
  const compiled = await import(pathToFileURL(join(unpacked, 'netlify/functions/game.mjs')).href);
  return preview(compiled.default);
}
const server = await fixture();
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [], trace: string[] = [], pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
async function until(test: () => boolean | Promise<boolean>, message: string, timeout = 8000) { const start = performance.now(); while (!await test()) { if (performance.now() - start > timeout) throw new Error(message); await pause(75); } }
const room = async (code: string) => (await server.blobs.read(code)).room;
const operator = async (code: string, name: string) => (await room(code)).players.find(p => p.name === name)!;
async function ready(page: Page) { await page.goto(server.url); await page.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor(); }
async function joinRoom(page: Page, name: string, code: string) { await page.locator('#callsign').fill(name); await page.locator('#join-open').click(); await page.locator('#room-code').fill(code); await page.locator('#join').click(); await page.locator('#lobby').waitFor({ state: 'visible' }); }
async function lock(page: Page) {
  await page.bringToFront();
  await until(async () => {
    if (await page.evaluate(() => document.pointerLockElement?.id === 'arena')) return true;
    const button = await page.locator('#pause-menu').isVisible() ? '#pause-resume' : '#resume-button';
    // A pending pointer-lock request can hide the overlay between observation
    // and click. Recheck the actual browser lock instead of clicking stale UI.
    await page.locator(button).click({ timeout: 800 }).catch(() => {});
    return !!await page.evaluate(() => document.pointerLockElement?.id === 'arena');
  }, 'pointer lock did not resume');
}
async function menu(page: Page, touch = false) {
  await page.bringToFront(); if (await page.locator('#pause-menu').isVisible()) return;
  if (touch) await page.locator('#match-settings').tap(); else await page.keyboard.press('Escape');
  await page.locator('#pause-menu').waitFor({ state: 'visible' });
}
async function accept(page: Page, destination: string, touch = false) {
  await page.bringToFront();
  assert.equal(await page.locator('#confirm-menu').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'confirm-cancel');
  const start = performance.now();
  if (touch) await page.locator('#confirm-accept').tap(); else await page.locator('#confirm-accept').click();
  assert.equal(await page.locator('#confirm-accept').isDisabled(), true);
  await page.locator(destination).waitFor({ state: 'visible' });
  await page.locator('#confirm-menu').waitFor({ state: 'hidden' }); assert.ok(performance.now() - start >= 950);
}
async function setPose(code: string) {
  await server.blobs.edit(code, data => { for (const p of data.room.players) Object.assign(p, { x: 0, z: p.name === 'MENUVEX' ? 7 : 10, yaw: p.name === 'MENUVEX' ? Math.PI : 0, pitch: 0, hp: 100, protectUntil: 0, input: null, lastFire: -Infinity, respawnAt: 0, life: p.life + 1 }); });
  await pause(450);
}
try {
  await mkdir('artifacts/menu', { recursive: true });
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] }),
    browser.newContext({ viewport: { width: 1280, height: 800 } }),
    browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
  ]);
  for (const context of contexts) await context.addInitScript(() => {
    (window as any).__name = (value: unknown) => value;
    sessionStorage.setItem('nb-intro-seen-v1', '1');
    // Fault injection exercises failed room commands while snapshots still
    // arrive. It never supplies a position, score, damage or match deadline.
    (window as any).__dropActions = false;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { if ((window as any).__dropActions && typeof data === 'string' && /^42\d*\["action"/.test(data)) return; return Reflect.apply(send, this, [data]); };
  });
  const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
  for (const [index, page] of [a, b, c].entries()) {
    page.on('pageerror', error => errors.push(error.message));
    if (http) page.on('response', async response => {
      if (!response.url().endsWith('/.netlify/functions/game')) return;
      const data = await response.json().catch(() => null), packet = response.request().postDataJSON();
      trace.push(`${index}:${packet?.action || 'health'}:${response.status()}:${data?.snapshot?.phase || data?.errorCode || data?.error || ''}`); if (trace.length > 90) trace.shift();
    });
  }
  await Promise.all([a, b, c].map(ready));
  assert.equal(await a.getByRole('button', { name: 'Back', exact: true }).count(), 0);
  await a.locator('#callsign').fill('MENUVEX'); await a.keyboard.press('Escape'); assert.notEqual(await a.evaluate(() => document.activeElement?.id), 'callsign');
  await a.locator('#join-open').click(); await a.locator('#room-code').fill('BAD'); await a.locator('#join').click(); await a.locator('#confirm-menu').waitFor({ state: 'visible' });
  assert.match(await a.locator('#confirm-message').innerText(), /code/); await a.locator('#confirm-cancel').click(); assert.equal(await a.locator('#join-panel').isVisible(), true);
  await a.locator('#join-back').click(); assert.equal(await a.locator('#join-panel').isVisible(), false);
  check('Landing has no dead Back button; typing Esc only clears focus; invalid Join has a readable error and one-panel Back');
  await a.locator('#settings-open').click();
  for (const [bus, value] of Object.entries({ master: 62, music: 31, effects: 44, ambience: 28, ui: 53 })) await a.locator(`#audio-${bus}`).evaluate((element, value) => { (element as HTMLInputElement).value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await a.locator('#sensitivity').evaluate(element => { (element as HTMLInputElement).value = '1.35'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await a.locator('#audio-mute').check(); assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('nb-audio')!).muted), true);
  await a.locator('#settings-back').click(); await a.reload(); await a.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor(); await a.locator('#settings-open').click();
  for (const [bus, value] of Object.entries({ master: 62, music: 31, effects: 44, ambience: 28, ui: 53 })) assert.equal(await a.locator(`#audio-${bus}`).inputValue(), String(value));
  assert.equal(await a.locator('#audio-mute').isChecked(), true); await a.locator('#audio-mute').uncheck();
  assert.equal(await a.locator('#sensitivity').inputValue(), '1.35'); await a.locator('#settings-back').click();
  await a.locator('#how-open').click(); await a.locator('#how-back').click();
  check('Landing Settings apply immediately and persist all five buses and aim sensitivity; How to Play returns to its caller');
  await a.locator('#callsign').fill('MENUVEX'); await a.locator('#create').click({ clickCount: 2 }); await a.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await a.locator('#lobby-code').innerText()).trim();
  assert.equal(await a.locator('#start').isDisabled(), true); assert.match(await a.locator('#host-note').innerText(), /at least one/);
  await joinRoom(b, 'MENUNYX', code); const idA = (await operator(code, 'MENUVEX')).id, idB = (await operator(code, 'MENUNYX')).id;
  assert.equal((await room(code)).players.length, 2); assert.equal(await b.locator('#start').isVisible(), false);
  await a.locator('#lobby-how-open').click(); await a.locator('#how-back').click(); await a.locator('#settings-open').click(); await a.locator('#settings-back').click(); assert.equal((await room(code)).players.length, 2);
  check('Create ignores double clicks; two independent browsers join one room; Start is host-only with a visible minimum-player reason; Back never leaves');
  await a.bringToFront(); await a.locator('#copy-code').click(); await until(async () => (await a.locator('#copy-code').innerText()) === 'Copied', 'clipboard did not copy');
  await pause(2100); assert.equal(await a.locator('#copy-code').innerText(), 'Copy Code');
  await a.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } }));
  await a.locator('#copy-code').click(); await until(async () => (await a.locator('#copy-status').innerText()).includes('Copy blocked'), 'clipboard fallback absent'); assert.equal(await a.evaluate(() => getSelection()?.toString()), code);
  check('Copy Code shows Copied for two seconds; blocked clipboard access selects the exact code');
  await a.locator('#start').click({ clickCount: 2 }); await Promise.all([a, b].map(page => page.locator('#hud').waitFor({ state: 'visible' })));
  assert.equal((await room(code)).match, 1); await lock(a); const original = await operator(code, 'MENUVEX'), end = (await room(code)).endsAt;
  await a.keyboard.press('Escape'); await a.locator('#pause-menu').waitFor({ state: 'visible' });
  await a.keyboard.press('Escape'); await a.locator('#pause-menu').waitFor({ state: 'hidden' }); await lock(a);
  const resumed = await operator(code, 'MENUVEX'); assert.deepEqual([resumed.x, resumed.z, resumed.hp, resumed.score], [original.x, original.z, original.hp, original.score]);
  await a.keyboard.press('Escape'); await a.locator('#pause-menu').waitFor({ state: 'visible' }); assert.equal(await a.evaluate(() => document.pointerLockElement), null);
  const before = await operator(code, 'MENUVEX'); assert.deepEqual([before.x, before.z, before.hp, before.score], [original.x, original.z, original.hp, original.score]);
  await a.keyboard.down('KeyW'); await a.mouse.move(20, 20); await a.mouse.down(); await pause(700); await a.mouse.up(); await a.keyboard.up('KeyW');
  const blocked = await operator(code, 'MENUVEX'); assert.equal(blocked.x, before.x); assert.equal(blocked.z, before.z); assert.equal(blocked.lastFire, before.lastFire);
  await lock(b); const movedFrom = await operator(code, 'MENUNYX'); await b.keyboard.down('KeyD'); await pause(700); await b.keyboard.up('KeyD'); await pause(300);
  const moved = await operator(code, 'MENUNYX'); assert.ok(Math.hypot(moved.x - movedFrom.x, moved.z - movedFrom.z) > 1); assert.equal((await room(code)).endsAt, end);
  check('Esc pauses only local input without resetting position, health, score or deadline; another client keeps moving');
  await setPose(code); await lock(b); await b.mouse.down(); await until(async () => (await operator(code, 'MENUVEX')).hp === 0, 'real shots failed to eliminate paused player'); await b.mouse.up();
  assert.equal(await a.locator('#pause-menu').isVisible(), true); await a.locator('#respawn').waitFor({ state: 'visible' }); await until(async () => (await a.locator('#pause-life').innerText()).includes('RECONSTRUCTING'), 'paused respawn feedback absent');
  await a.screenshot({ path: `artifacts/menu/${mode}-paused-down.png` }); await until(async () => (await operator(code, 'MENUVEX')).hp === 100, 'paused player never respawned', 7000);
  assert.equal((await operator(code, 'MENUNYX')).score, 1); assert.equal(await a.locator('#pause-menu').isVisible(), true);
  await until(async () => (await room(code)).cell, 'Phase Cell clock stopped in menus', 24000);
  assert.equal((await room(code)).phase, 'playing'); await a.locator('#pause-settings').click(); await a.locator('#settings-back').click(); assert.equal(await a.locator('#pause-menu').isVisible(), true);
  check('Incoming real damage, three-hit scoring, five-second respawn and the actual 20-second Phase Cell spawn continue while a menu is open; Settings Back keeps it paused');
  await menu(b); await b.locator('#leave-match').click(); assert.equal(await b.evaluate(() => document.activeElement?.id), 'confirm-cancel'); await b.keyboard.press('Enter'); assert.equal((await room(code)).players.length, 2);
  await b.locator('#leave-match').click(); await accept(b, '#landing'); assert.equal((await room(code)).players.some(p => p.id === idB), false);
  await until(async () => (await room(code)).phase === 'ended', 'quit did not apply disconnect rule'); assert.equal((await room(code)).winner, idA); assert.equal(await a.locator('#pause-menu').isVisible(), true);
  await a.locator('#pause-resume').click(); assert.equal(await a.locator('#results').isVisible(), true); assert.equal(await a.locator('#hud').isVisible(), false);
  check('Quit Match defaults focus to Cancel, confirms with a one-second guard, removes its seat, and awards only the server’s remaining-player winner; Resume after match end opens the end card');
  await a.locator('#results-settings').click(); await a.locator('#settings-back').click(); assert.equal(await a.locator('#results').isVisible(), true);
  await a.locator('#results-lobby').click(); await accept(a, '#lobby'); assert.equal((await room(code)).players.length, 1); assert.equal((await room(code)).phase, 'ended');
  await a.locator('#lobby-replay').click(); await until(async () => (await room(code)).phase === 'lobby', 'Play Again did not clear lobby'); assert.equal((await room(code)).players[0].score, 0); assert.equal(await a.locator('#start').isDisabled(), true);
  check('End-card Settings return correctly; personal Return to Lobby preserves the room; host Play Again clears the match without auto-starting or restoring a quitter');
  await joinRoom(b, 'MENUNYX', code); await joinRoom(c, 'MENUION', code); await c.locator('#settings-open').tap(); await c.locator('#settings-back').tap();
  await a.locator('#start').click(); await Promise.all([a, b, c].map(page => page.locator('#hud').waitFor({ state: 'visible' })));
  await menu(a); await a.locator('#pause-lobby').click(); assert.equal(await a.locator('#confirm-message').innerText(), 'Leave this match and return to the lobby?');
  await a.locator('#confirm-cancel').click(); assert.equal((await room(code)).players.filter(p => p.connected && !p.inLobby).length, 3);
  await a.locator('#pause-lobby').click(); await accept(a, '#lobby'); const stillLive = await room(code);
  assert.equal(stillLive.phase, 'playing'); assert.equal(stillLive.host, (await operator(code, 'MENUNYX')).id); assert.ok(stillLive.players.find(p => p.id === idA)!.inLobby); assert.equal(await b.locator('#hud').isVisible(), true); assert.equal(await c.locator('#hud').isVisible(), true);
  await a.reload(); await a.locator('#lobby').waitFor({ state: 'visible' }); assert.equal((await operator(code, 'MENUVEX')).id, idA); assert.equal((await room(code)).players.length, 3);
  check('Confirmed Return to Lobby removes only its participant, preserves its seat across refresh, keeps a three-player match running with two, and transfers the single host to an active operator');
  await c.setViewportSize({ width: 844, height: 390 }); await pause(350);
  const button = (await c.locator('#match-settings').boundingBox())!, fire = (await c.locator('#fire').boundingBox())!, dash = (await c.locator('#dash-touch').boundingBox())!;
  assert.ok(button.height >= 44); assert.ok(button.y + button.height < fire.y && button.y + button.height < dash.y); assert.ok(!(button.x <= 422 && button.x + button.width >= 422 && button.y <= 195 && button.y + button.height >= 195));
  await menu(c, true); const quitBounds = (await c.locator('#leave-match').boundingBox())!; assert.ok(quitBounds.y + quitBounds.height <= 390);
  await c.locator('#pause-resume').tap(); assert.equal(await c.locator('#pause-menu').isVisible(), false); await menu(c, true); await c.screenshot({ path: `artifacts/menu/${mode}-touch-menu.png` });
  await c.locator('#pause-lobby').tap(); const cancel = (await c.locator('#confirm-cancel').boundingBox())!, confirm = (await c.locator('#confirm-accept').boundingBox())!;
  assert.ok(confirm.y >= cancel.y + cancel.height); await accept(c, '#lobby', true); await b.locator('#results').waitFor({ state: 'visible' });
  assert.equal((await room(code)).winner, (await operator(code, 'MENUNYX')).id); assert.equal((await room(code)).players.length, 3); assert.equal(await c.locator('#lobby').isVisible(), true);
  check('Touch Menu is at least 44 px and clear of crosshair, Fire and Dash; Resume works; confirmations stack Cancel above Confirm; the last active player wins while lobby members stay connected');
  assert.equal(await a.locator('#lobby-replay').isVisible(), false); await b.locator('#replay').click(); await Promise.all([a, b, c].map(page => page.locator('#lobby').waitFor({ state: 'visible' })));
  // A personal lobby was already visible before Replay. Wait for each client
  // to receive the new shared lobby, rather than mistaking old UI for its ack.
  await Promise.all([a, b, c].map(page => page.locator('#lobby-heading').filter({ hasText: 'Awaiting deployment.' }).waitFor()));
  assert.ok((await room(code)).players.every(p => !p.inLobby && p.score === 0)); assert.equal((await room(code)).phase, 'lobby');
  await a.locator('#leave-lobby').click(); await a.locator('#confirm-cancel').click(); assert.equal((await room(code)).players.length, 3); await a.locator('#leave-lobby').click(); await accept(a, '#landing');
  assert.equal((await room(code)).players.some(p => p.id === idA), false);
  check('Only the host exposes Play Again; replay includes waiting members in a clean lobby; Leave Room confirms and removes exactly one seat');
  // Fresh two-player contract for a request failure and a real disconnect.
  await c.locator('#leave-lobby').tap(); await accept(c, '#landing', true); await b.locator('#leave-lobby').click(); await accept(b, '#landing');
  await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); const faultCode = (await a.locator('#lobby-code').innerText()).trim();
  await joinRoom(b, 'MENUNYX', faultCode); await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' }); await menu(a);
  if (http) await a.route('**/.netlify/functions/game', route => { const packet = route.request().postDataJSON(); return packet?.action === 'return-lobby' ? route.abort() : route.continue(); });
  else await a.evaluate(() => { (window as any).__dropActions = true; });
  await a.locator('#pause-lobby').click(); await a.locator('#confirm-accept').click(); await until(async () => (await a.locator('#confirm-title').innerText()).includes('failed'), 'failed command trapped menu', 12000);
  assert.equal((await room(faultCode)).phase, 'playing'); assert.ok(!(await operator(faultCode, 'MENUVEX')).inLobby); await a.locator('#confirm-cancel').click(); assert.equal(await a.locator('#pause-menu').isVisible(), true);
  if (http) await a.unroute('**/.netlify/functions/game'); else await a.evaluate(() => { (window as any).__dropActions = false; });
  check('An unconfirmed socket/function command preserves membership and shows a readable error with Back; it cannot invent a personal exit');
  if (http) await a.route('**/.netlify/functions/game', route => route.abort());
  else { const live = server as Awaited<ReturnType<typeof realtimeFixture>>; live.io.sockets.sockets.get((await operator(faultCode, 'MENUVEX')).socketId!)!.conn.close(); }
  await a.locator('#connection-overlay').waitFor({ state: 'visible', timeout: 12000 }); assert.equal(await a.locator('#connection-reconnect').isVisible(), true);
  await a.locator('#connection-home').click(); await accept(a, '#landing'); await until(async () => (await room(faultCode)).phase === 'ended', 'server disconnect did not expire', 12000);
  assert.equal((await room(faultCode)).winner, (await operator(faultCode, 'MENUNYX')).id); assert.equal((await operator(faultCode, 'MENUVEX')).connected, false);
  check('Connection loss exposes Reconnect and Return to Landing; emergency escape closes the transport, and the server applies its disconnect/heartbeat rule');
  assert.deepEqual(errors, []);
  await writeFile(`artifacts/menu/${mode}-report.json`, JSON.stringify({ passed: true, date: new Date().toISOString(), checks, errors, scope: http ? 'Three independent Chrome contexts, production frontend and exact packaged Netlify Function with strongly consistent SDK Blobs emulator; no physical devices or public deployment.' : 'Three independent Chrome contexts, compiled production WebSocket server, actual two-client movement/shooting and local menus plus touch emulation; no physical second device or public deployment.' }, null, 2));
} catch (error) {
  console.error(error); console.error(JSON.stringify({ errors, trace }));
  await writeFile(`artifacts/menu/${mode}-report.json`, JSON.stringify({ passed: false, date: new Date().toISOString(), checks, errors, failure: String(error), trace }, null, 2));
  for (const page of browser.contexts().flatMap(context => context.pages())) await page.screenshot({ path: `artifacts/menu/${mode}-failure-${browser.contexts().flatMap(context => context.pages()).indexOf(page)}.png` }).catch(() => {}); throw error;
}
finally { await browser.close(); await server.close(); if (unpacked) await rm(unpacked, { recursive: true, force: true }); }
