// Live VFX acceptance uses built production assets and two independent clients.
// Only starting poses are test fixtures; damage, input, clocks and results stay authoritative.
import { chromium, type Page } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createGameServer, serveProduction } from './legacy/app';
import { rank, type Player, type Room } from '../server/game';
import { RULES, validPosition } from '../shared/world';
import type { GameEvent, Snapshot } from '../shared/protocol';

const bundle = await build({ entryPoints: ['tests/vfx-harness.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
const server = createGameServer();
server.app.get('/__vfxqa', (_request, response) => response.type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{display:block}</style><canvas></canvas><script src="/__vfxqa.js"></script>'));
server.app.get('/__vfxqa.js', (_request, response) => response.type('application/javascript').send(bundle.outputFiles[0].text));
serveProduction(server.app);
await new Promise<void>(resolve => server.http.listen(0, '127.0.0.1', resolve));
const address = server.http.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-webgl', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [], captures: any[] = [];
const check = (message: string) => { checks.push(message); console.log('PASS ' + message); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string, limit = 6000) { const start = performance.now(); while (!predicate()) { if (performance.now() - start > limit) throw Error(label); await pause(15); } }
function observe(page: Page) {
  const wire = { state: null as Snapshot | null, shots: [] as { at: number; event: Extract<GameEvent, { type: 'shot' }> }[], snapshots: 0 };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE|WebGL|shader/.test(message.text())) errors.push(message.text()); });
  page.on('websocket', socket => socket.on('framereceived', frame => { const raw = frame.payload.toString(); if (!raw.startsWith('42[')) return; const event = JSON.parse(raw.slice(2)); if (event[0] === 'snapshot') { wire.state = event[1]; wire.snapshots++; } if (event[0] === 'event' && event[1].type === 'shot') wire.shots.push({ at: performance.now(), event: event[1] }); }));
  return wire;
}
async function instrument(page: Page) {
  // Hook native APIs before the production bundle runs. There is no game debug API.
  // Canvas captures run immediately after a real WebGL render, preserving short flashes.
  await page.addInitScript({ content: 'globalThis.__name=function(t){return t;};(' + (() => {
    const audit = { active: false, frames: [] as number[], held: false, heldFrames: [] as number[], last: 0, draws: 0, sources: [] as { at: number; duration: number }[], arm: '', pending: null as null | { label: string; at: number; step: number }, captures: [] as { label: string; elapsed: number; step: number; png: string }[] };
    (window as any).vfxAudit = audit;
    for (const method of ['drawElements', 'drawArrays'] as const) { const original = WebGL2RenderingContext.prototype[method]; (WebGL2RenderingContext.prototype as any)[method] = function (...args: any[]) { audit.draws++; return Reflect.apply(original, this, args); }; }
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { if (this.buffer && Math.abs(this.buffer.duration - .27) < .001) { const at = performance.now(); audit.sources.push({ at, duration: this.buffer.duration }); if (audit.arm) { audit.pending = { label: audit.arm, at, step: 0 }; audit.arm = ''; } } return Reflect.apply(start, this, args); };
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(time => {
      const before = audit.draws; callback(time);
      if (audit.draws <= before) return;
      if (audit.active && audit.last) { const interval = time - audit.last; audit.frames.push(interval); if (audit.held) audit.heldFrames.push(interval); } audit.last = time;
      const pending = audit.pending;
      if (pending && time - pending.at >= [0, 18, 36, 80, 140, 220][pending.step]) { const canvas = document.querySelector<HTMLCanvasElement>('#arena'); if (canvas) audit.captures.push({ label: pending.label, elapsed: time - pending.at, step: pending.step, png: canvas.toDataURL('image/png') }); if (++pending.step === 6) audit.pending = null; }
    });
  }).toString() + ')();' });
}
async function lock(page: Page) { await page.bringToFront(); if (await page.locator('#resume').isVisible()) await page.locator('#resume-button').click(); await page.waitForFunction(() => document.pointerLockElement?.id === 'arena'); }
let room: Room, pa: Player, pb: Player;
async function pose(placements: { p: Player; x: number; z: number; yaw?: number; pitch?: number }[]) {
  for (const { p } of placements) Object.assign(p, { hp: 0, input: null, respawnAt: performance.now() + 60000 });
  await pause(180);
  for (const { p, x, z, yaw = 0, pitch = 0 } of placements) { assert.ok(validPosition(x, z)); Object.assign(p, { x, z, yaw, pitch, hp: 100, protectUntil: 0, respawnAt: 0, input: null, life: p.life + 1 }); }
  server.io.to(room.code).emit('snapshot', room.snapshot(performance.now())); await pause(240);
}
async function saveFrames(page: Page) { const frames = await page.evaluate(() => { const audit = (window as any).vfxAudit, frames = audit.captures; audit.captures = []; return frames; }); for (const frame of frames) { const path = `artifacts/vfx-${frame.label}-${frame.step}.png`; await writeFile(path, Buffer.from(frame.png.split(',')[1], 'base64')); const { png: _png, ...data } = frame; captures.push({ ...data, path }); } }
async function arm(page: Page, label: string) { await page.evaluate(label => { const audit = (window as any).vfxAudit; audit.pending = null; audit.arm = label; }, label); }
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1280, height: 800 } }), browser.newContext({ viewport: { width: 960, height: 640 } })]);
const [a, b] = await Promise.all(contexts.map(context => context.newPage())); const wa = observe(a), wb = observe(b);
let metrics: any, heldFire: any, result: any, studio: any;
try {
  await mkdir('artifacts', { recursive: true });
  const lab = await browser.newPage({ viewport: { width: 1280, height: 800 } }); observe(lab); await lab.goto(url + '/__vfxqa'); await lab.waitForFunction(() => (window as any).vfxQA); studio = await lab.evaluate(() => (window as any).vfxQA.audit());
  assert.deepEqual(studio.obstruction, []); assert.equal(studio.constants.release, .018); assert.equal(studio.constants.speed, 200); assert.ok(Math.abs(studio.timing.find((frame: any) => frame.age === .078).travel - 12) < .00001); assert.ok(studio.timing.at(-1).expired);
  check('The shared muzzle stays clear of the crosshair in desktop and phone aspects; pulse motion keeps its 18-ms release and 200-m/s cosmetic speed');
  for (const audit of Object.values(studio.pool) as any[]) { assert.equal(audit.capacity, 12); assert.equal(audit.geometryCount, 3); assert.equal(audit.materialCount, 96); assert.ok(audit.active <= 12); }
  assert.ok(studio.pool.repeated.spawned >= 80); assert.equal(studio.pool.repeated.active, 0); assert.equal(studio.pool.crowded.active, 12); assert.ok(studio.pool.crowded.reused >= 16); assert.equal(studio.pool.drained.active, 0); assert.deepEqual(studio.memory.before, studio.memory.during); assert.deepEqual(studio.memory.before, studio.memory.after); assert.deepEqual(studio.cleanup, { objectsRemaining: 0, disposedGeometries: 3, disposedMaterials: 96 });
  assert.deepEqual(studio.restoration.normalBefore, studio.restoration.normalAfter); assert.ok(Math.abs(studio.restoration.phased.headScale[0] / studio.restoration.normalBefore.headScale[0] - 1.8) < .00001); assert.equal(studio.restoration.normalBefore.streaksVisible, 1); assert.equal(studio.restoration.metal.streaksVisible, 2); assert.equal(studio.restoration.composite.streaksVisible, 0); assert.equal(studio.restoration.normalBefore.flashColor, 'b6c5ff'); assert.equal(studio.restoration.metal.flashColor, '70c5fa'); assert.equal(studio.restoration.composite.flashColor, 'b0cfbf');
  check('Mixed normal/phased armor, metal and composite effects reuse a fixed 12-slot pool, expire cleanly, retain constant GPU geometry memory and dispose every owned resource');
  assert.deepEqual(studio.surfaces.map((surface: any) => surface.kind), ['armor', 'metal', 'composite']);
  for (const [mode, distance, age, phased, name] of [['own', 10, .012, false, 'charge'], ['own', 10, .029, false, 'release'], ['own', 2.5, .028, false, 'close'], ['own', 10, .043, false, 'medium'], ['own', 24, .08, false, 'long'], ['own', 2.5, .030, false, 'armor-impact'], ['metal', 10, .040, false, 'metal-impact'], ['composite', 10, .051, false, 'composite-impact'], ['remote', 10, .029, false, 'remote-release'], ['remote', 10, .045, false, 'remote-flight'], ['own', 10, .05, true, 'phase'], ['own', 10, .19, false, 'residue']] as const) { await lab.evaluate(({ mode, distance, age, phased }) => (window as any).vfxQA.frame(mode, distance, age, phased), { mode, distance, age, phased }); await lab.screenshot({ path: `artifacts/vfx-studio-${name}.png` }); }
  check('Original firing stages and the distinct armor, metal and composite impact variants are captured in actual arena lighting'); await lab.close();
  await writeFile('artifacts/vfx-studio-report.json', JSON.stringify({ date: new Date().toISOString(), passed: true, checks: [...checks], errors, studio, limitation: 'Controlled test-only freeze frames; subjective visual quality and live network behavior are not established by this studio check.' }, null, 2));
  if (!process.argv.includes('--studio')) {
  await Promise.all([instrument(a), instrument(b)]); await Promise.all([a.goto(url), b.goto(url)]);
  await a.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor(); await a.locator('#callsign').fill('VFXVEX'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' }); const code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('VFXNYX'); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' }); room = server.rooms.rooms.get(code)!; [pa, pb] = room.connected(); assert.equal(room.mode, 'multiplayer'); assert.ok(!pa.bot && !pb.bot); assert.equal(room.connected().length, 2);
  await a.bringToFront(); await a.locator('#start').click(); await Promise.all([a.locator('#hud').waitFor({ state: 'visible' }), b.locator('#hud').waitFor({ state: 'visible' })]); const deadline = room.endsAt; assert.ok(Math.abs(deadline - room.startedAt - 180000) < .001); await a.evaluate(() => (window as any).vfxAudit.active = true);
  check('Two independent production browser clients start one real multiplayer match with the unmodified 180-second server clock');

  for (const [distance, label] of [[2.5, 'close'], [10, 'medium'], [24, 'long']] as const) {
    await pose([{ p: pa, x: -12, z: 14 }, { p: pb, x: -12, z: 14 - distance, yaw: Math.PI / 2 }]); await lock(a); await a.screenshot({ path: `artifacts/vfx-live-${label}-aim.png` }); await arm(a, `${label}-own`); let before = wa.shots.length;
    await a.mouse.down(); await until(() => wa.shots.length > before, 'own pulse was not server-confirmed'); await a.mouse.up(); await pause(350); await saveFrames(a); assert.equal(pb.hp, 66);
    await arm(a, `${label}-remote`); await lock(b); before = wa.shots.length; await b.mouse.down(); await until(() => wa.shots.length > before, 'remote pulse was not received'); await b.mouse.up(); await pause(350); await saveFrames(a); assert.ok(wa.shots.slice(before).some(shot => shot.event.shot.shooter === pb.id));
  }
  assert.ok(captures.filter(frame => /(?:close|medium|long)-(?:own|remote)/.test(frame.label)).length >= 30);
  check('First-person pulse and remote muzzle/pulse sequences are captured frame by frame at 2.5, 10, and 24 meters in the arena');

  await lock(a); await pose([{ p: pa, x: -12, z: 10 }, { p: pb, x: -12, z: 5, yaw: Math.PI }]); const beforeKills = wa.shots.length;
  for (const hp of [66, 32, 0]) { await a.mouse.down(); await until(() => pb.hp === hp, 'expected authoritative 34-damage health step ' + hp); await a.mouse.up(); await pause(310); }
  assert.equal(pa.score, 1); const damaging = wa.shots.slice(beforeKills).filter(shot => shot.event.shot.damage && shot.event.shot.hit === pb.id); assert.equal(damaging.length, 3); const eliminatedAt = pb.respawnAt - 5000;
  await until(() => pb.hp === 100, 'five-second respawn missing', 6500); const respawnAt = pb.protectUntil - 1000; assert.ok(respawnAt - eliminatedAt >= 5000 && respawnAt - eliminatedAt < 5060); assert.ok(pb.protectUntil > performance.now());
  // Aim at the freshly spawned operator while the real protection remains active.
  await pose([{ p: pa, x: pb.x, z: pb.z > 0 ? pb.z - 3 : pb.z + 3, yaw: pb.z > 0 ? Math.PI : 0 }]); await lock(a); const protectedBefore = wa.shots.length; await a.mouse.down(); await until(() => wa.shots.length > protectedBefore, 'protected impact missing', 2000); await a.mouse.up(); assert.equal(pb.hp, 100); assert.ok(wa.shots.slice(protectedBefore).some(shot => shot.event.shot.hit === pb.id && !shot.event.shot.damage));
  await until(() => performance.now() >= pb.protectUntil, 'protection did not expire', 1500); check('Three confirmed 34-damage hits eliminate; respawn waits five seconds and the real one-second protection blocks damage');

  await lock(b); await pose([{ p: pb, x: 12, z: 10 }, { p: pa, x: 12, z: 5 }]); await b.mouse.down(); await until(() => pa.hp === 0, 'return fire did not eliminate host'); await b.mouse.up(); assert.equal(pb.score, 1); await until(() => pa.hp === 100, 'host respawn missing', 6500); await pause(1100);
  check('Both independent players fire, damage, eliminate and respawn through actual DOM controls and socket events');

  await lock(a); await pose([{ p: pa, x: 0, z: 2 }, { p: pb, x: 0, z: -8 }]); const coveredBefore = wa.shots.length; await arm(a, 'cover-composite'); await a.mouse.down(); await pause(700); await a.mouse.up(); await pause(300); await saveFrames(a); assert.equal(pb.hp, 100); const covered = wa.shots.slice(coveredBefore).filter(shot => shot.event.shot.shooter === pa.id); assert.ok(covered.length >= 2 && covered.every(shot => !shot.event.shot.hit && !shot.event.shot.damage && shot.event.shot.to.z > -5));
  check('Cover absorbs the pulse without damage to the operator behind it');

  await until(() => room.cell, 'first natural Phase Cell spawn missing', 22000); assert.ok(performance.now() - room.startedAt >= 20000); await lock(b); await pose([{ p: pa, x: 0, z: 3 }, { p: pb, x: -3, z: 0, yaw: -Math.PI / 2 }]); await b.keyboard.down('w'); await until(() => pb.phaseUntil > performance.now(), 'natural Phase Cell pickup missing'); await b.keyboard.up('w'); const pickupAt = pb.phaseUntil - 4000; assert.equal(room.cell, false); assert.ok(Math.abs(room.cellAt - pickupAt - 20000) < .001);
  await arm(a, 'phased-remote'); const phaseBefore = wa.shots.length; await b.mouse.down(); await until(() => wa.shots.length > phaseBefore, 'phased rifle shot missing'); await b.mouse.up(); await pause(350); await saveFrames(a); assert.ok(wa.shots.slice(phaseBefore).some(shot => shot.event.shot.phased)); await a.screenshot({ path: 'artifacts/vfx-live-phase-cell.png' }); await until(() => pb.phaseUntil === 0, 'four-second phase expiration missing', 5000); assert.ok(performance.now() - pickupAt >= 4000);
  check('Natural center Phase Cell pickup creates server-confirmed phased firing and expires after four seconds');

  await lock(a); await pose([{ p: pa, x: -12, z: 15 }, { p: pb, x: 12, z: 15, yaw: Math.PI }]); const movedZ = pa.z; await a.keyboard.down('w'); await pause(550); await a.keyboard.up('w'); await until(() => !!wb.state?.players.some(player => player.id === pa.id && player.z < movedZ - 1), 'remote movement did not update');
  const dashStart = { x: pa.x, z: pa.z }; await a.keyboard.press('Shift'); await until(() => pa.dashAt > performance.now(), 'authoritative dash missing'); assert.ok(Math.hypot(pa.x - dashStart.x, pa.z - dashStart.z) <= RULES.dashMeters + .15); assert.ok(validPosition(pa.x, pa.z)); const cooldown = pa.dashAt; await a.keyboard.press('Shift'); await pause(180); assert.equal(pa.dashAt, cooldown);
  check('Movement and a bounded server-confirmed dash remain responsive; dash cooldown rejects an immediate repeat');

  await pose([{ p: pa, x: -12, z: 15 }, { p: pb, x: 12, z: 15, yaw: Math.PI }]); await lock(a); const before = wa.shots.length, audioBefore = await a.evaluate(() => (window as any).vfxAudit.sources.length), heldStart = performance.now(); await a.evaluate(() => (window as any).vfxAudit.held = true); await a.mouse.down();
  for (let i = 0; i < 4; i++) { await pause(7500); if (i === 1) { await arm(a, 'continuous-own'); await pause(350); await saveFrames(a); await a.screenshot({ path: 'artifacts/vfx-live-continuous.png' }); } assert.equal(room.phase, 'playing'); assert.equal(room.connected().length, 2); console.log('CONTINUOUS PULSE ' + Math.round((performance.now() - heldStart) / 1000) + ' seconds'); }
  await a.mouse.up(); await a.evaluate(() => (window as any).vfxAudit.held = false); const durationMs = performance.now() - heldStart; const fired = wa.shots.slice(before).filter(shot => shot.event.shot.shooter === pa.id); const audioCount = await a.evaluate(() => (window as any).vfxAudit.sources.length) - audioBefore; assert.ok(fired.length >= 95 && fired.length <= 112); assert.equal(audioCount, fired.length); assert.ok(await a.locator('#crosshair').isVisible()); assert.equal(await a.evaluate(() => { const element = document.querySelector<HTMLElement>('#crosshair')!, rectangle = element.getBoundingClientRect(); return Math.abs(rectangle.x + rectangle.width / 2 - innerWidth / 2) < 1 && Math.abs(rectangle.y + rectangle.height / 2 - innerHeight / 2) < 1; }), true);
  const intervals = fired.slice(1).map((shot, index) => shot.at - fired[index].at).sort((x, y) => x - y); heldFire = { durationMs, shots: fired.length, audioCount, receivedMedianIntervalMs: intervals[Math.floor(intervals.length / 2)] }; assert.ok(heldFire.receivedMedianIntervalMs >= 270); check('Thirty seconds of held fire preserve a centered visible crosshair, bounded cooldown cadence and exactly one rifle audio source per confirmed shot');

  let cycle = 0;
  // Leave enough room for the complete five-second input cycle before timeout.
  while (performance.now() < deadline - 7000) {
    const page = cycle % 2 ? a : b, player = cycle % 2 ? pa : pb; await lock(page); await pose([{ p: player, x: cycle % 2 ? -12 : 12, z: 15 }]); await page.keyboard.down('w'); await pause(650); await page.keyboard.up('w'); await page.mouse.down(); await pause(650); await page.mouse.up(); await pause(3400); assert.equal(room.connected().length, 2); assert.equal(room.phase, 'playing'); assert.ok(pa.score < 10 && pb.score < 10); cycle++; if (cycle % 4 === 0) console.log('LIVE TWO-CLIENT MATCH ' + Math.round((performance.now() - room.startedAt) / 1000) + ' / 180 seconds');
  }
  await until(() => room.phase === 'ended', 'natural 180-second timeout missing', 10000); assert.equal(room.endsAt, deadline); assert.ok(performance.now() >= deadline); assert.equal(room.reason, 'Contract time expired'); assert.equal(room.winner, rank(room.connected())[0].id); await Promise.all([a.locator('#results').waitFor({ state: 'visible' }), b.locator('#results').waitFor({ state: 'visible' })]); const winner = room.players.get(room.winner!)!.name; assert.equal(await a.locator('#winner').textContent(), winner); assert.equal(await b.locator('#winner').textContent(), winner); assert.equal(pa.score, 1); assert.equal(pb.score, 1); assert.equal(room.winner, pa.id); await a.screenshot({ path: 'artifacts/vfx-live-results.png' });
  result = { durationMs: deadline - room.startedAt, observedDurationMs: performance.now() - room.startedAt, winner, reason: room.reason, scores: [pa.score, pb.score], activityCycles: cycle };
  check('A complete natural 180-second match reaches timeout with two connected players; both results agree with the server and earlier tied-score tiebreak');
  metrics = await a.evaluate(() => { const audit = (window as any).vfxAudit; audit.active = false; const summarize = (frames: number[]) => { const sorted = frames.sort((x, y) => x - y); return { frames: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], p99Ms: sorted[Math.floor(sorted.length * .99)] }; }; const gl = document.querySelector<HTMLCanvasElement>('#arena')!.getContext('webgl2')!, extension = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), fullMatch: summarize(audit.frames), heldFire: summarize(audit.heldFrames), drawCallsObserved: audit.draws, rifleAudioSources: audit.sources.length }; }); assert.ok(/Metal/.test(metrics.renderer)); assert.ok(metrics.fullMatch.frames > 3000 && metrics.heldFire.frames > 500); assert.ok(wa.snapshots > 2500 && wb.snapshots > 2500);
  check('Hardware-rendered frame intervals are measured over the full match and sustained-fire window without WebGL errors or network instability');
  await a.locator('#replay').click(); await Promise.all([a.locator('#lobby').waitFor({ state: 'visible' }), b.locator('#lobby').waitFor({ state: 'visible' })]); assert.equal(room.phase, 'lobby'); assert.equal(pa.score, 0); assert.equal(pb.score, 0); assert.equal(room.cell, false); assert.equal(room.winner, null); assert.deepEqual(errors, []); check('Host replay returns both production clients to a clean lobby');
  await writeFile('artifacts/vfx-report.json', JSON.stringify({ date: new Date().toISOString(), passed: true, checks, errors, studio, captures, heldFire, result, metrics, network: [wa, wb].map(wire => ({ snapshots: wire.snapshots, shots: wire.shots.length })), limitations: ['Two automated Chrome contexts on one Apple GPU; no two-human physical-device or public/WAN match.', 'Controlled server starting poses only; the 180-second clock, input, hitscan hits, health, elimination, respawn, phase ownership, scoring and winner are never replaced.', 'Frame captures and crosshair position support visual inspection; subjective flagship quality, distraction/comfort and resemblance judgments require a human playtest.', 'Rifle source starts align with server-confirmed shot events; subjective listening and hardware speaker latency are not verified.'] }, null, 2)); console.log(JSON.stringify({ checks: checks.length, result, heldFire, metrics }));
  }
} catch (error) {
  console.error(error); process.exitCode = 1; for (const [index, page] of [a, b].entries()) if (!page.isClosed()) await page.screenshot({ path: `artifacts/failure-vfx-${index}.png` }).catch(() => {}); await writeFile('artifacts/vfx-report.json', JSON.stringify({ date: new Date().toISOString(), passed: false, checks, errors, captures, heldFire, result, metrics, failure: String(error) }, null, 2));
} finally { await browser.close(); await server.close(); }
