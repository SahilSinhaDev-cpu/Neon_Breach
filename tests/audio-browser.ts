import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { io, type Socket } from 'socket.io-client';
import { createGameServer, serveProduction } from './legacy/app';
import type { Player } from '../server/game';
import type { Reply, Snapshot } from '../shared/protocol';

// All instrumentation/routes are confined to this test server. No diagnostic
// endpoint, exported app instance, or audio recording runs in production.
const bundle = resolve(tmpdir(), `neon-audio-qa-${process.pid}.js`);
await build({ entryPoints: ['tests/audio-harness.ts'], outfile: bundle, bundle: true, format: 'iife', platform: 'browser' });
const server = createGameServer();
server.app.get('/__audioqa', (_req, res) => res.type('html').send('<!doctype html><title>Audio verification</title><button>Enable test audio</button><script src="/__audioqa.js"></script>'));
server.app.get('/__audioqa.js', (_req, res) => res.sendFile(bundle)); serveProduction(server.app);
await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r)); const address = server.http.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-webgl', ...(process.env.NB_RENDERER === 'metal' ? ['--use-angle=metal'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [], peers: Socket[] = []; let fireTimer: ReturnType<typeof setInterval> | undefined;
const check = (s: string) => { checks.push(s); console.log(`PASS ${s}`); };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(predicate: () => boolean, label: string, limit = 5000) { const at = performance.now(); while (!predicate()) { if (performance.now() - at > limit) throw new Error(label); await pause(25); } }
async function audit(page: Page) {
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ content: 'globalThis.__name = function (target) { return target; }; (' + (() => {
    const connect = AudioNode.prototype.connect, start = AudioBufferSourceNode.prototype.start;
    const contexts = new Set<BaseAudioContext>(), analysers: AnalyserNode[] = [], sources = { active: 0, peak: 0, counts: {} as Record<string, number> };
    let peak = 0, recent: number[] = [], samples = 0;
    (AudioNode.prototype as any).connect = function (...args: any[]) {
      if (args[0] instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048; analysers.push(analyser); contexts.add(this.context);
        Reflect.apply(connect, this, [analyser]); Reflect.apply(connect, analyser, args); return args[0];
      }
      return Reflect.apply(connect, this, args);
    };
    AudioBufferSourceNode.prototype.start = function (...args) {
      const key = this.buffer?.duration.toFixed(3) ?? 'none'; sources.counts[key] = (sources.counts[key] ?? 0) + 1; sources.active++; sources.peak = Math.max(sources.peak, sources.active);
      this.addEventListener('ended', () => sources.active--, { once: true }); return Reflect.apply(start, this, args);
    };
    const pcm = new Float32Array(2048);
    setInterval(() => { let p = 0; for (const analyser of analysers) { analyser.getFloatTimeDomainData(pcm); for (const x of pcm) p = Math.max(p, Math.abs(x)); } peak = Math.max(peak, p); recent.push(p); if (recent.length > 15) recent.shift(); samples++; }, 40);
    Object.assign(window, { audioAudit: { read: () => ({ peak, recentPeak: Math.max(0, ...recent), samples, active: sources.active, peakSources: sources.peak, counts: { ...sources.counts }, states: [...contexts].map(c => c.state) }), reset: () => { peak = 0; recent = []; } } });
  }).toString() + ')();' });
}
const read = (page: Page) => page.evaluate(() => (window as any).audioAudit.read());
try {
  await mkdir('artifacts', { recursive: true });
  const labPage = await browser.newPage(); await labPage.goto(`${url}/__audioqa`); await labPage.locator('button').click();
  await labPage.waitForFunction(() => (window as any).audioQA.sound.status === 'ready');
  const lab = await labPage.evaluate(() => (window as any).audioQA.lab());
  await writeFile('artifacts/audio-lab.json', JSON.stringify({ ...lab, wav: undefined }, null, 2));
  assert.ok(lab.local.energy > lab.near.energy && lab.near.energy > lab.far.energy * 3);
  assert.ok(lab.far.brightness < lab.near.brightness); assert.ok(lab.far.lowFraction < lab.near.lowFraction);
  assert.ok(Math.abs(lab.local.rms[0] - lab.local.rms[1]) < 1e-6);
  check('Rendered local / near / distant rifle perspectives differ in level, detail, and bass; local weapon stays centered');
  assert.ok(lab.left.rms[0] > lab.left.rms[1] * 1.25); assert.ok(lab.right.rms[1] > lab.right.rms[0] * 1.25);
  assert.ok(lab.occluded.energy < lab.exposed.energy); assert.ok(lab.occluded.brightness < lab.exposed.brightness);
  check('Offline stereo rendering verifies left/right location and cover muffling');
  assert.ok(lab.metal.brightness > lab.composite.brightness * 1.5); assert.notEqual(lab.armor.energy, lab.metal.energy);
  assert.ok(lab.chaos.peak < 0.9 && lab.flood.peak < 0.9); assert.ok(lab.flood.peakVoices <= 24 && lab.flood.dropped > 0 && lab.flood.stolen > 0);
  check('Armor / metal / composite transients differ; four-shooter and 100-event stress renders stay below the safety ceiling with bounded voices');
  assert.ok(lab.silence.every((energy: number) => energy === 0)); check('Master zero, each zeroed bus, and Mute render exact silence in isolated signal tests');
  const lifecycle = await labPage.evaluate(() => (window as any).audioQA.lifecycle());
  assert.equal(lifecycle.stationary, 0); assert.ok(lifecycle.moving >= 2); assert.equal(lifecycle.dead, 0); assert.equal(lifecycle.rejectedDash, 0); assert.equal(lifecycle.acceptedDash, 1); assert.equal(lifecycle.teleportSteps, 0); assert.equal(lifecycle.phaseOff, 1); assert.equal(lifecycle.phaseLoops, 3); assert.equal(lifecycle.afterPhaseLoops, 1); assert.equal(lifecycle.loopsAfterLeave, 0);
  check('Controller uses actual travel for footsteps, silences downed/stationary operators, cues confirmed dash and phase expiry, and clears loops on leave');
  await writeFile('artifacts/audio-review.wav', Buffer.from(lab.wav, 'base64')); delete lab.wav; await labPage.close();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage(); await audit(page); await page.goto(url);
  await page.locator('#audio-enable').waitFor({ state: 'visible' }); assert.equal((await read(page)).states.length, 0);
  await page.locator('#audio-enable').click(); await page.locator('#audio-enable').waitFor({ state: 'hidden' }); assert.ok((await read(page)).states.includes('running'));
  check('Production game creates audio only after a desktop gesture and removes the Enable Audio prompt');
  await page.locator('#settings-open').click();
  for (const [bus, value] of [['master', 43], ['effects', 61], ['ambience', 22], ['ui', 37]] as const) await page.locator(`#audio-${bus}`).evaluate((element, n) => { (element as HTMLInputElement).value = String(n); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.locator('#audio-mute').check(); await page.screenshot({ path: 'artifacts/audio-settings-desktop.png' }); await page.reload();
  await page.locator('#settings-open').click(); assert.equal(await page.locator('#audio-mute').isChecked(), true);
  for (const [bus, value] of [['master', 43], ['effects', 61], ['ambience', 22], ['ui', 37]] as const) assert.equal(await page.locator(`#audio-${bus}`).inputValue(), String(value));
  assert.equal((await read(page)).states.length, 0); await page.locator('#audio-mute').uncheck(); await page.waitForFunction(() => (window as any).audioAudit.read().states.includes('running'));
  for (const [bus, value] of [['master', 75], ['effects', 80], ['ambience', 35], ['ui', 65]] as const) await page.locator(`#audio-${bus}`).evaluate((element, n) => { (element as HTMLInputElement).value = String(n); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.locator('#settings button').filter({ hasText: 'SAVE & CLOSE' }).click();
  check('All four volume settings and Mute persist across refresh; unmuting resumes playback');
  await page.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor(); await page.locator('#callsign').fill('AUDVEX'); await page.locator('#create').click(); await page.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await page.locator('#lobby-code').textContent())!, room = server.rooms.rooms.get(code)!;
  for (const name of ['AUDNYX', 'AUDION', 'AUDREX']) {
    const socket = io(url, { transports: ['websocket'], forceNew: true }); peers.push(socket); await new Promise<void>(r => socket.on('connect', r));
    const reply = await new Promise<Reply>(r => socket.emit('room', { action: 'join', code, name }, r)); assert.ok(reply.ok);
  }
  await page.locator('#start').click(); await page.locator('#hud').waitFor({ state: 'visible' });
  if (await page.locator('#resume').isVisible()) await page.locator('#resume-button').click();
  const players = room.connected(), local = players.find(p => p.name === 'AUDVEX')!, remote = players.filter(p => p !== local);
  async function poses(placements: { p: Player; x: number; z: number; yaw: number }[]) {
    for (const { p } of placements) { p.hp = 0; p.respawnAt = performance.now() + 60000; p.input = null; } await pause(170);
    for (const { p, x, z, yaw } of placements) Object.assign(p, { x, z, yaw, pitch: 0, hp: 100, protectUntil: 0, respawnAt: 0, input: null, lastFire: -Infinity, life: p.life + 1 });
    server.io.to(code).emit('snapshot', room.snapshot(performance.now())); await pause(200);
  }
  await poses([{ p: local, x: 0, z: 10, yaw: 0 }, ...remote.map((p, i) => ({ p, x: [-16, 16, 15][i], z: [16, 16, -16][i], yaw: -Math.PI / 2 }))]);
  let localShots = 0; const firing = peers[0]; firing.on('event', event => { if (event.type === 'shot' && event.shot.shooter === local.id) localShots++; });
  await page.evaluate(() => (window as any).audioAudit.reset()); await page.mouse.down();
  const began = performance.now();
  for (let i = 0; i < 4; i++) { await pause(15000); console.log(`SUSTAINED FIRE ${Math.round((performance.now() - began) / 1000)}s; ${localShots} authoritative local shots`); }
  await page.mouse.up(); const sustained = { duration: performance.now() - began, localShots, audit: await read(page) };
  assert.ok(sustained.duration >= 60000 && localShots >= 180); assert.ok(sustained.audit.peak > 0.01 && sustained.audit.peak < 0.9); assert.ok(sustained.audit.counts['0.270'] >= localShots - 3);
  check('Held rifle fire ran for at least 60 real seconds in the production game, with audible signal, server cooldown, and measured output below clipping');
  // Same connected opponents move from opposite arena sides to nearby positions.
  await poses([{ p: local, x: 0, z: 10, yaw: 0 }, { p: remote[0], x: -3, z: 10, yaw: Math.PI }, { p: remote[1], x: 3, z: 10, yaw: Math.PI }, { p: remote[2], x: 12, z: 10, yaw: Math.PI }]);
  let seq = 0; fireTimer = setInterval(() => remote.forEach((p, i) => peers[i].emit('input', { seq: seq++, life: p.life, mx: 0, my: 0, yaw: p.yaw, pitch: 0, fire: true, dash: false })), 40);
  await page.mouse.down(); await pause(6000); await page.mouse.up(); clearInterval(fireTimer); fireTimer = undefined; await pause(500);
  const chaos = await read(page); assert.ok(chaos.peak < 0.9); assert.ok(chaos.peakSources <= 34);
  check('Four connected operators fired together after moving from opposite sides to close range; live signal remained bounded');
  await page.keyboard.press('Escape'); await page.locator('#match-settings').click(); await page.locator('#audio-mute').check(); await pause(850);
  assert.ok((await read(page)).recentPeak < 1e-5); await page.locator('#settings button').filter({ hasText: 'SAVE & CLOSE' }).click(); await page.locator('#resume-button').click();
  const shotsBefore = localShots; await page.mouse.down(); await pause(1000); await page.mouse.up(); assert.ok(localShots > shotsBefore); assert.ok((await read(page)).recentPeak < 1e-5);
  check('Mute removes the live output signal while authoritative firing and visual play continue');
  await page.keyboard.press('Escape'); await page.locator('#match-settings').click(); await page.locator('#audio-mute').uncheck(); await page.locator('#leave-match').click(); await page.locator('#landing').waitFor({ state: 'visible' }); await pause(1900); const afterLeave = await read(page); assert.ok(afterLeave.active <= 1); assert.ok(afterLeave.counts['60.000'] >= 1);
  check('Leaving a match stops station, cell, phase, and effects; only the lobby score remains'); await context.close(); peers.forEach(p => p.disconnect());

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), mobile = await mobileContext.newPage(); await audit(mobile); await mobile.goto(url);
  assert.equal((await read(mobile)).states.length, 0); await mobile.locator('#audio-enable').tap(); await mobile.locator('#audio-enable').waitFor({ state: 'hidden' }); assert.ok((await read(mobile)).states.includes('running'));
  await mobile.locator('#settings-open').tap(); await mobile.screenshot({ path: 'artifacts/audio-settings-mobile.png' }); assert.equal(await mobile.locator('#audio-mute').isVisible(), true); assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  check('First mobile-emulated tap enables audio; all mix controls fit the phone settings panel'); await mobileContext.close();
  const blockedContext = await browser.newContext(), blocked = await blockedContext.newPage(); blocked.on('pageerror', e => errors.push(e.message));
  await blocked.addInitScript({ content: 'globalThis.AudioContext = class { constructor() { throw new Error("Simulated unavailable audio device"); } };' });
  await blocked.goto(url); await blocked.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor(); await blocked.locator('#callsign').fill('NOAUDIO'); await blocked.locator('#solo').click(); await blocked.locator('#lobby').waitFor({ state: 'visible' }); await blocked.locator('#start').click(); await blocked.locator('#hud').waitFor({ state: 'visible' });
  check('An unavailable AudioContext does not prevent loading, room creation, or playing solo'); await blockedContext.close();
  assert.deepEqual(errors, []);
  await writeFile('artifacts/audio-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), checks, lab, lifecycle, sustained, chaos, errors, listenedByEar: false, physicalDevicesTested: false }, null, 2));
  console.log(`All ${checks.length} audio browser checks passed. No listening-by-ear claim.`);
} catch (error) {
  await writeFile('artifacts/audio-report.json', JSON.stringify({ passed: false, checks, errors, failure: String(error), listenedByEar: false }, null, 2));
  throw error;
} finally { if (fireTimer) clearInterval(fireTimer); peers.forEach(p => p.disconnect()); await browser.close(); await server.close(); await rm(bundle, { force: true }); }
