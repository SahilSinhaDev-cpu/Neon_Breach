import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { realtimeFixture } from './realtime-fixture';

// This harness exercises built production assets. Media faults are deliberately
// injected in the browser; no production endpoint or gameplay rule is altered.
const server = await realtimeFixture();
let browser: Browser | undefined;
const checks: string[] = [], errors: string[] = [];
const measurements: Record<string, unknown> = {};
const roomTraffic: { name: string; action: string; at: number }[] = [];
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
server.io.on('connection', socket => socket.on('room', data => {
  roomTraffic.push({ name: String(data?.name ?? ''), action: String(data?.action ?? ''), at: performance.now() });
}));

function auditInit() {
  const audit = { calls: [] as { time: number; gesture: boolean; muted: boolean; volume: number }[], events: [] as { type: string; at: number; currentTime: number }[] };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this instanceof HTMLVideoElement) audit.calls.push({ time: performance.now(), gesture: navigator.userActivation.hasBeenActive, muted: this.muted, volume: this.volume });
    return Reflect.apply(play, this, []);
  };
  for (const type of ['playing', 'ended', 'error', 'waiting', 'stalled']) document.addEventListener(type, event => {
    if (event.target instanceof HTMLVideoElement) audit.events.push({ type, at: performance.now(), currentTime: event.target.currentTime });
  }, true);
  (window as any).__introAudit = audit;
}
type Trace = { mediaRequests: string[]; replyAt: number; roomAcks: number };
async function pageFor(context: BrowserContext, settings?: { master?: number; music?: number; muted?: boolean }) {
  const page = await context.newPage(), trace: Trace = { mediaRequests: [], replyAt: 0, roomAcks: 0 };
  await page.addInitScript({ content: 'globalThis.__name = target => target; (' + auditInit.toString() + ')();' });
  if (settings) await page.addInitScript({ content: 'try { localStorage.setItem("nb-audio", ' + JSON.stringify(JSON.stringify(settings)) + '); } catch {}' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/intro\/[^/]+\.mp4(?:\?|$)/.test(request.url())) trace.mediaRequests.push(new URL(request.url()).pathname); });
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string') return;
    const match = /^43\d*(\[.*\])$/.exec(payload); if (!match) return;
    try {
      const [reply] = JSON.parse(match[1]);
      if (reply?.ok && reply.id && reply.token) { trace.roomAcks++; trace.replyAt = performance.now(); }
    } catch { /* Not a room acknowledgement. */ }
  }));
  return { page, trace };
}
async function ready(page: Page) {
  await page.goto(server.url);
  await page.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor({ timeout: 15000 });
}
const video = (page: Page) => page.locator('#intro-video video');
const requestsFor = (name: string) => roomTraffic.filter(request => request.name === name);
async function start(page: Page, name: string, button = '#create') {
  await page.locator('#callsign').fill(name); await page.locator(button).click();
  await page.locator('#intro-video').waitFor({ state: 'visible' });
}
async function skip(page: Page, touch = false) {
  await page.waitForFunction(() => !(document.querySelector('.intro-video-skip') as HTMLButtonElement).disabled);
  if (touch) await page.locator('.intro-video-skip').tap(); else await page.locator('.intro-video-skip').click();
  await page.locator('#lobby').waitFor({ state: 'visible' });
  await page.locator('#intro-video').waitFor({ state: 'hidden' });
}

try {
  await mkdir('artifacts/intro', { recursive: true });
  measurements.mediaFiles = await Promise.all(['dist/client/intro/neon-breach-1080p.mp4', 'dist/client/intro/neon-breach-720p.mp4'].map(async path => {
    const bytes = await readFile(path);
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const desktop = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const main = await pageFor(desktop, { master: 0.6, music: 0.5, muted: false });
  await ready(main.page);
  assert.equal(main.trace.mediaRequests.length, 0);
  assert.equal(await main.page.evaluate(() => (window as any).__introAudit.calls.length), 0);
  assert.equal(await main.page.locator('#intro-video').isVisible(), false);
  await main.page.locator('#callsign').fill('VALID'); await main.page.locator('#join-open').click(); await main.page.locator('#join').click();
  await main.page.locator('#confirm-cancel').click(); await main.page.locator('#join-back').click();
  assert.equal(await main.page.locator('#intro-video').isVisible(), false); assert.equal(requestsFor('VALID').length, 0);
  check('No video request or playback before a valid room gesture; an invalid Join cannot claim or start the intro');

  const began = performance.now(); await start(main.page, 'FILMVEX');
  assert.equal(requestsFor('FILMVEX').length, 0);
  assert.equal(await main.page.locator('.intro-video-skip').isDisabled(), true);
  await pause(400); assert.equal(await main.page.locator('.intro-video-skip').isDisabled(), true);
  await main.page.keyboard.press('Escape'); assert.equal(await main.page.locator('#intro-video').isVisible(), true);
  assert.equal(requestsFor('FILMVEX').length, 0);
  await main.page.waitForFunction(() => { const media = document.querySelector('#intro-video video') as HTMLVideoElement; return media.readyState >= 2 && !media.paused; }, undefined, { timeout: 12000 });
  const fullMedia = await video(main.page).evaluate(element => { const media = element as HTMLVideoElement; return { duration: media.duration, volume: media.volume, muted: media.muted, width: media.videoWidth, height: media.videoHeight, source: new URL(media.currentSrc).pathname }; });
  assert.ok(Math.abs(fullMedia.duration - 18) < 0.05); assert.equal(fullMedia.width, 1920); assert.equal(fullMedia.height, 1080);
  assert.ok(Math.abs(fullMedia.volume - 0.3) < 1e-6); assert.equal(fullMedia.muted, false);
  assert.ok((await main.page.evaluate(() => (window as any).__introAudit.calls)).every((call: { gesture: boolean }) => call.gesture));
  await main.page.waitForFunction(() => (document.querySelector('#intro-video video') as HTMLVideoElement).currentTime >= 6.4);
  await main.page.screenshot({ path: 'artifacts/intro/desktop-rifle.png' });
  assert.equal(requestsFor('FILMVEX').length, 0);
  await main.page.waitForFunction(() => (document.querySelector('#intro-video video') as HTMLVideoElement).currentTime >= 13.2);
  await main.page.screenshot({ path: 'artifacts/intro/desktop-title.png' });
  assert.equal(requestsFor('FILMVEX').length, 0);
  await main.page.locator('#lobby').waitFor({ state: 'visible', timeout: 30000 });
  await main.page.locator('#intro-video').waitFor({ state: 'hidden', timeout: 2000 });
  const afterReplyMs = performance.now() - main.trace.replyAt, elapsed = performance.now() - began;
  assert.ok(elapsed >= 17900 && elapsed < 23000); assert.ok(afterReplyMs >= 0 && afterReplyMs < 600);
  assert.equal(requestsFor('FILMVEX').length, 1); assert.equal(main.trace.roomAcks, 1);
  const ended = await main.page.evaluate(() => (window as any).__introAudit.events.filter((event: { type: string }) => event.type === 'ended'));
  assert.equal(ended.length, 1); assert.ok(ended[0].currentTime >= 17.99);
  measurements.fullPlayback = { ...fullMedia, elapsedMs: elapsed, fadeAfterRoomAckMs: afterReplyMs, ended: true };
  await main.page.screenshot({ path: 'artifacts/intro/actual-lobby.png' });
  check('Create plays all 18 seconds at 1080p after a gesture; no room is allocated until playback ends; actual lobby fades in within 600 ms of acknowledgement');
  check('Skip stays disabled for the first second; video volume follows Master × Music and audio playback starts only after user activation');

  await main.page.locator('#leave-lobby').click(); await main.page.locator('#confirm-accept').click(); await main.page.locator('#landing').waitFor({ state: 'visible' });
  const requestsBefore = main.trace.mediaRequests.length;
  await main.page.locator('#create').click(); await main.page.locator('#lobby').waitFor({ state: 'visible' });
  assert.equal(await main.page.locator('#intro-video').isVisible(), false); assert.equal(main.trace.mediaRequests.length, requestsBefore);
  const code = (await main.page.locator('#lobby-code').textContent())!.trim();
  const seat = await main.page.evaluate(() => JSON.parse(sessionStorage.getItem('nb-seat')!));
  await main.page.evaluate(() => sessionStorage.removeItem('nb-intro-seen-v1'));
  await main.page.reload(); await main.page.locator('#lobby').waitFor({ state: 'visible', timeout: 12000 });
  assert.equal(await main.page.locator('#intro-video').isVisible(), false);
  assert.equal(await main.page.evaluate(() => (window as any).__introAudit.calls.length), 0);
  assert.equal(await main.page.locator('#lobby-code').textContent(), code);
  assert.deepEqual(await main.page.evaluate(() => JSON.parse(sessionStorage.getItem('nb-seat')!)), seat);
  check('Leaving and creating again skips the sequence in the same session; automatic refresh recovery bypasses it and keeps the original lobby seat');

  const joinedContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const joined = await pageFor(joinedContext); await ready(joined.page);
  await joined.page.locator('#join-open').click(); await joined.page.locator('#room-code').fill(code); const joinAt = performance.now(); await start(joined.page, 'FILMNYX', '#join');
  assert.equal(requestsFor('FILMNYX').length, 0); assert.equal(server.rooms.rooms.get(code)!.humans().length, 1);
  await skip(joined.page); assert.ok(requestsFor('FILMNYX')[0].at - joinAt >= 950);
  assert.equal(server.rooms.rooms.get(code)!.humans().length, 2);
  check('A separate browser Join plays and skips the intro after one second, then occupies the same real multiplayer lobby');
  await joinedContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await pageFor(mobileContext, { master: 0.5, music: 0.6, muted: true }); await ready(mobile.page);
  await mobile.page.locator('#callsign').fill('FILMTOUCH'); await mobile.page.locator('#solo').tap();
  await mobile.page.locator('#intro-video').waitFor({ state: 'visible' }); assert.equal(requestsFor('FILMTOUCH').length, 0);
  await mobile.page.waitForFunction(() => (document.querySelector('#intro-video video') as HTMLVideoElement).readyState >= 2);
  const mobileMedia = await video(mobile.page).evaluate(element => { const media = element as HTMLVideoElement, css = getComputedStyle(media), bounds = media.getBoundingClientRect(); return { source: new URL(media.currentSrc).pathname, muted: media.muted, volume: media.volume, width: media.videoWidth, height: media.videoHeight, fit: css.objectFit, position: css.objectPosition, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, sourceCropWidth: media.videoHeight * innerWidth / innerHeight }; });
  assert.equal(mobileMedia.source, '/intro/neon-breach-720p.mp4'); assert.equal(mobileMedia.width, 1280); assert.equal(mobileMedia.height, 720);
  assert.equal(mobileMedia.muted, true); assert.ok(Math.abs(mobileMedia.volume - 0.3) < 1e-6);
  assert.equal(mobileMedia.fit, 'cover'); assert.equal(mobileMedia.position, '50% 50%'); assert.deepEqual(mobileMedia.bounds, { x: 0, y: 0, width: 390, height: 844 });
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.page.locator('.intro-video-mute').tap(); assert.equal(await video(mobile.page).evaluate(element => (element as HTMLVideoElement).muted), false);
  assert.equal(await mobile.page.evaluate(() => JSON.parse(localStorage.getItem('nb-audio')!).muted), false);
  await mobile.page.locator('.intro-video-mute').tap(); assert.equal(await video(mobile.page).evaluate(element => (element as HTMLVideoElement).muted), true);
  assert.equal(await mobile.page.evaluate(() => JSON.parse(localStorage.getItem('nb-audio')!).muted), true);
  await mobile.page.waitForFunction(() => !(document.querySelector('.intro-video-skip') as HTMLButtonElement).disabled);
  await video(mobile.page).evaluate(element => { const media = element as HTMLVideoElement; media.pause(); media.currentTime = 6.9; });
  await mobile.page.waitForFunction(() => { const media = document.querySelector('#intro-video video') as HTMLVideoElement; return !media.seeking && media.currentTime >= 6.9; });
  measurements.phoneShotFrame = await video(mobile.page).evaluate(element => (element as HTMLVideoElement).currentTime);
  await mobile.page.screenshot({ path: 'artifacts/intro/phone-rifle.png' });
  await video(mobile.page).evaluate(element => { (element as HTMLVideoElement).currentTime = 13.5; });
  await mobile.page.waitForFunction(() => { const media = document.querySelector('#intro-video video') as HTMLVideoElement; return !media.seeking && media.currentTime >= 13.5; });
  await mobile.page.screenshot({ path: 'artifacts/intro/phone-title.png' });
  for (const selector of ['.intro-video-mute', '.intro-video-skip']) {
    const bounds = (await mobile.page.locator(selector).boundingBox())!; assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844 && bounds.height >= 44);
  }
  await skip(mobile.page, true); assert.equal(await mobile.page.locator('#roster .bot-tag').count(), 3);
  await mobile.page.locator('#settings-open').tap(); assert.equal(await mobile.page.locator('#audio-mute').isChecked(), true);
  assert.equal(await mobile.page.locator('#audio-master').inputValue(), '50'); assert.equal(await mobile.page.locator('#audio-music').inputValue(), '60');
  measurements.phone = mobileMedia;
  check('First Solo tap selects 720p, keeps centered cover cropping without letterboxing, exposes accessible controls, and enters the original three-bot lobby');
  check('Intro Mute/Unmute persists to the game settings; the lobby retains the same Master, Music and Mute values');
  await mobileContext.close();

  for (const settings of [{ master: 0, music: 0.6 }, { master: 0.8, music: 0 }]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const current = await pageFor(context, { ...settings, muted: false }); await ready(current.page); await start(current.page, settings.master === 0 ? 'ZEROMASTER' : 'ZEROMUSIC', '#solo');
    assert.equal(await video(current.page).evaluate(element => (element as HTMLVideoElement).volume), 0);
    assert.equal(await video(current.page).evaluate(element => (element as HTMLVideoElement).muted), true);
    await skip(current.page); await context.close();
  }
  check('Master zero and Music zero each mute the intro while room creation stays available');

  for (const fault of ['404', 'stall', 'reject'] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const current = await pageFor(context); const name = fault === '404' ? 'MEDIA404' : fault === 'stall' ? 'MEDIASTALL' : 'MEDIAFAIL';
    if (fault === '404') await current.page.route('**/intro/*.mp4', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing test media' }));
    if (fault === 'stall') await current.page.route('**/intro/*.mp4', () => { /* Intentionally leave the media request pending. */ });
    if (fault === 'reject') await current.page.addInitScript({ content: 'const nativePlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { return this instanceof HTMLVideoElement ? Promise.reject(new DOMException("Injected playback failure", "NotSupportedError")) : Reflect.apply(nativePlay, this, []); };' });
    await ready(current.page); await current.page.locator('#callsign').fill(name);
    const faultAt = performance.now(); await current.page.locator('#create').click(); await current.page.locator('#lobby').waitFor({ state: 'visible', timeout: 7000 });
    await current.page.locator('#intro-video').waitFor({ state: 'hidden', timeout: 1500 });
    const elapsedMs = performance.now() - faultAt; assert.ok(elapsedMs < 5500, `${fault} blocked entry for ${elapsedMs}ms`);
    assert.equal(requestsFor(name).length, 1);
    if (fault === '404') assert.ok(current.trace.mediaRequests.some(path => path.includes('1080p')) && current.trace.mediaRequests.some(path => path.includes('720p')));
    measurements[fault] = { elapsedMs, mediaRequests: current.trace.mediaRequests, roomCreated: true };
    await context.close();
  }
  check('Missing both resolutions, a stalled load and rejected playback all fail open within 5.5 seconds and create exactly one working room');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/intro/browser-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), checks, measurements, errors, scope: 'Built production frontend and compiled real-time server; actual encoded MP4 playback in desktop Chrome and touch emulation. No physical phone, listening-by-ear, public deployment or new three-match claim.' }, null, 2));
  console.log(`All ${checks.length} intro browser checks passed.`);
} catch (error) {
  await mkdir('artifacts/intro', { recursive: true });
  await writeFile('artifacts/intro/browser-report.json', JSON.stringify({ passed: false, checks, measurements, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); await server.close(); }
