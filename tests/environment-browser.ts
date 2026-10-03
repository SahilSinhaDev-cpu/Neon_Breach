import { chromium, type Page } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createGameServer, serveProduction } from './legacy/app';
import type { Room, Player } from '../server/game';
import type { Snapshot } from '../shared/protocol';
import { PADS, RULES, validPosition } from '../shared/world';

// Test-only instrumentation and controlled starting poses. Production exposes
// neither debug globals nor endpoints. Match clock/scores/pickups stay natural.
const lab = await build({ stdin: { contents: `
  import * as T from 'three';
  import { ShatteredRelay } from './client/environment';
  import { BOXES } from './shared/world';
  const relay = new ShatteredRelay(new T.Scene());
  const errors = [];
  for (const [i, b] of BOXES.entries()) {
    const object = relay.collisionVisuals.find(o => o.userData.colliderIndex === i);
    if (!object) { errors.push('Missing solid ' + i); continue; }
    if (b.kind === 'wall') continue; // Pressure shell includes sealed armored glass.
    const bounds = new T.Box3().setFromObject(object);
    for (const [axis, dimension] of [['x','w'],['y','h'],['z','d']])
      if (Math.abs(bounds.min[axis] - (b[axis] - b[dimension]/2)) > 1e-5 || Math.abs(bounds.max[axis] - (b[axis] + b[dimension]/2)) > 1e-5) errors.push('Solid bounds mismatch ' + i);
  }
  const meshes = []; relay.root.traverse(o => { if (o.isMesh) meshes.push(o); });
  window.relayStructure = { errors, solids: relay.collisionVisuals.length, meshes: meshes.length, exteriorDecorative: relay.exterior.userData.decorative === true };
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const server = createGameServer();
server.app.get('/environment-qa.js', (_req, res) => res.type('application/javascript').send(lab.outputFiles[0].text));
serveProduction(server.app);
await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
const address = server.http.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
await mkdir('artifacts', { recursive: true });
const hardware = process.env.NB_RENDERER === 'metal';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-webgl', ...(hardware ? ['--use-angle=metal'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks: string[] = [], errors: string[] = [];
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(test: () => boolean, message: string, ms = 6000) { const start = performance.now(); while (!test()) { if (performance.now() - start > ms) throw new Error(message); await pause(30); } }
function observe(page: Page) {
  const wire: { state: Snapshot | null; count: number; maxGapMs: number; at: number } = { state: null, count: 0, maxGapMs: 0, at: 0 };
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  page.on('websocket', ws => ws.on('framereceived', frame => {
    const raw = frame.payload.toString(); if (!raw.startsWith('42[')) return;
    const event = JSON.parse(raw.slice(2));
    if (event[0] === 'snapshot' && event[1].phase === 'playing') { const now = performance.now(); if (wire.at) wire.maxGapMs = Math.max(wire.maxGapMs, now - wire.at); wire.at = now; wire.count++; wire.state = event[1]; }
  })); return wire;
}
let room: Room, pa: Player, pb: Player;
async function lock(page: Page) { await page.bringToFront(); if (await page.locator('#resume').isVisible()) await page.locator('#resume-button').click(); await page.waitForFunction(() => document.pointerLockElement?.id === 'arena'); }
async function pose(placements: { p: Player; x: number; z: number; yaw?: number; pitch?: number }[]) {
  placements.forEach(({ p, x, z }) => { assert.ok(validPosition(x, z)); Object.assign(p, { hp: 0, respawnAt: performance.now() + 60000, input: null }); });
  await pause(180);
  placements.forEach(({ p, x, z, yaw = 0, pitch = 0 }) => Object.assign(p, { x, z, yaw, pitch, hp: 100, protectUntil: 0, respawnAt: 0, input: null, life: p.life + 1 }));
  server.io.to(room.code).emit('snapshot', room.snapshot(performance.now())); await pause(250);
}
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1280, height: 800 } }), browser.newContext({ viewport: { width: 960, height: 640 } })]);
const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
const wa = observe(a), wb = observe(b);
try {
  await a.addInitScript(() => {
    const data = { active: false, frames: [] as { ms: number; calls: number; triangles: number }[], at: 0, calls: 0, triangles: 0 };
    (window as any).__relayMetrics = data;
    const proto = WebGL2RenderingContext.prototype as any;
    const clear = proto.clear;
    proto.clear = function(...args: any[]) {
      if (this.canvas.id === 'arena') {
        const now = performance.now();
        if (data.active && data.at && data.calls) data.frames.push({ ms: now - data.at, calls: data.calls, triangles: data.triangles });
        data.at = now; data.calls = 0; data.triangles = 0;
      }
      return clear.apply(this, args);
    };
    for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = proto[method];
      proto[method] = function(...args: any[]) {
        if (this.canvas.id === 'arena') { data.calls++; if (args[0] === this.TRIANGLES) data.triangles += (method.includes('Elements') ? args[1] : args[2]) / 3 * (method.includes('Instanced') ? args[method.includes('Elements') ? 4 : 3] : 1); }
        return original.apply(this, args);
      };
    }
  });
  await Promise.all([a.goto(url), b.goto(url)]);
  await a.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor();
  await a.addScriptTag({ url: `${url}/environment-qa.js` });
  const gpu = await a.evaluate(() => { const gl = (document.querySelector('#arena') as HTMLCanvasElement).getContext('webgl2')!; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string : gl.getParameter(gl.RENDERER) as string; });
  if (hardware) assert.match(gpu, /Apple.*Metal Renderer/, 'Hardware test must actually use Metal, not a software fallback');
  const structure = await a.evaluate(() => (window as any).relayStructure);
  assert.deepEqual(structure.errors, []); assert.equal(structure.exteriorDecorative, true);
  check(`All ${structure.solids} shared collision solids have visuals; non-wall bounds match exactly; exterior is decorative`);
  await a.locator('#callsign').fill('RELAYA'); await a.locator('#create').click(); await a.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await a.locator('#lobby-code').textContent())!;
  await b.locator('#callsign').fill('RELAYB'); await b.locator('#room-code').fill(code); await b.locator('#join').click(); await b.locator('#lobby').waitFor({ state: 'visible' });
  room = server.rooms.rooms.get(code)!; [pa, pb] = room.connected();
  await a.bringToFront(); await a.locator('#start').click(); await a.locator('#hud').waitFor({ state: 'visible' }); await b.locator('#hud').waitFor({ state: 'visible' });
  const deadline = room.endsAt; assert.equal(deadline - room.startedAt, RULES.matchMs);
  await a.evaluate(() => (window as any).__relayMetrics.active = true);
  for (const [page, p, remote] of [[a, pa, wb], [b, pb, wa]] as const) {
    await lock(page); const before = { x: p.x, z: p.z }; await page.keyboard.down('w'); await pause(750); await page.keyboard.up('w');
    await until(() => !!remote.state?.players.some(q => q.id === p.id && Math.hypot(q.x - before.x, q.z - before.z) > 2), 'other client did not see movement');
  }
  check('Both independent browser clients move through real inputs and receive each other’s positions');
  await lock(a);
  for (const side of [-1, 1]) {
    await pose([{ p: pa, x: 0, z: side * 2, yaw: side < 0 ? 0 : Math.PI }, { p: pb, x: 0, z: side * 8 }]);
    await a.mouse.down(); await pause(750); await a.mouse.up(); assert.equal(pb.hp, 100);
    await until(() => performance.now() >= pa.dashAt, 'dash cooldown did not finish');
    await a.keyboard.press('Shift'); await pause(150); assert.ok(Math.abs(pa.z) <= 3.69 && Math.abs(pa.z) > 3.5);
  }
  check('Both visible cover banks block real browser-fired shots and stop forward movement/dash');
  await pose([{ p: pa, x: -12, z: 7 }, { p: pb, x: -12, z: 2, yaw: Math.PI }]);
  await a.mouse.down(); await until(() => pb.hp === 0, 'service lane exposed operator did not take damage', 3000); await a.mouse.up();
  assert.equal(pa.score, 1); await until(() => pb.hp === 100, 'respawn failed', 6500); await pause(1100);
  check('Blue-lane exposed shots eliminate; real five-second respawn and one-second protection finish');
  for (const side of [-1, 1]) {
    await pose([{ p: pa, x: side * 12, z: 15 }, { p: pb, x: side * 12, z: -17, yaw: Math.PI }]);
    await a.keyboard.down('w'); await pause(1900); await a.keyboard.up('w'); assert.ok(pa.z < 5 && validPosition(pa.x, pa.z));
    await a.screenshot({ path: `artifacts/environment-${side < 0 ? 'blue' : 'amber'}-lane.png` });
  }
  check('Both service lanes support sustained movement past cover with the remote operator visible');
  await until(() => room.cell, 'natural 20-second cell spawn failed', 22000);
  await pose([{ p: pa, x: -5, z: 0, yaw: -Math.PI / 2 }, { p: pb, x: 5, z: 0, yaw: Math.PI / 2 }]);
  await a.screenshot({ path: 'artifacts/environment-core.png' });
  await a.keyboard.down('w'); await until(() => pa.phaseUntil > performance.now(), 'core pickup approach blocked', 2500); await a.keyboard.up('w');
  const nextCell = room.cellAt; assert.equal(room.cell, false); await a.locator('#cell-status').filter({ hasText: /^PHASE ·/ }).waitFor();
  await until(() => pa.phaseUntil === 0, 'phase did not expire', 5000);
  check('Clear side approach reaches the natural Phase Cell; four-second effect expires and replacement is scheduled');
  for (const [i, pad] of PADS.entries()) {
    await pose([{ p: pa, ...pad, yaw: Math.atan2(pad.x, pad.z) }, { p: pb, x: 5, z: 0 }]);
    await a.screenshot({ path: `artifacts/environment-spawn-${i + 1}.png` });
    await a.keyboard.down('w'); await pause(450); await a.keyboard.up('w'); assert.ok(Math.hypot(pa.x - pad.x, pa.z - pad.z) > 1.4 && validPosition(pa.x, pa.z));
  }
  check('All four spawn views captured at standing eye height; browser movement escapes every pad');
  for (const shot of [
    { name: 'viewport', x: 0, z: -15, yaw: 0, pitch: 0.05 },
    { name: 'blast-door', x: 0, z: 15, yaw: Math.PI },
    { name: 'conduit', x: 14, z: -10.6, yaw: -Math.PI / 2, pitch: 0.12 },
    { name: 'hologram', x: 15, z: 11.5, yaw: -Math.PI / 2 },
  ]) {
    await pose([{ p: pa, ...shot }, { p: pb, x: -12, z: -5 }]); await a.screenshot({ path: `artifacts/environment-${shot.name}.png` });
  }
  await pose([{ p: pa, x: 0, z: -18 }, { p: pb, x: 0, z: -14 }]);
  await a.mouse.down(); await pause(350); await a.mouse.up(); await a.keyboard.press('Shift'); await pause(180);
  assert.ok(pa.z >= -19.58 && pa.z < -19.4); check('Sealed viewport retains the authoritative outer wall and stops a real dash');
  await until(() => room.cell, 'replacement cell did not spawn', Math.max(2500, nextCell - performance.now() + 2500));
  check('Replacement Phase Cell naturally respawns 20 seconds after collection');
  // Return fire from the second client so the full-match test covers both ends.
  await lock(b); await pose([{ p: pb, x: 12, z: 8 }, { p: pa, x: 12, z: 3, yaw: Math.PI }]);
  await b.mouse.down(); await until(() => pa.hp === 0, 'second client return fire failed', 3000); await b.mouse.up();
  await until(() => pa.hp > 0, 'host respawn failed', 6500); await pause(1100);
  check('Second browser returns fire through the amber lane and earns its own elimination');
  let cycle = 0;
  while (performance.now() < deadline - 5000) {
    const page = cycle % 2 ? b : a, p = cycle % 2 ? pb : pa, side = cycle % 2 ? 1 : -1;
    await lock(page); await pose([{ p, x: side * 12, z: 14, yaw: 0 }]);
    await page.keyboard.down('w'); await pause(1500); await page.keyboard.up('w');
    await page.mouse.move(500, 350); await page.mouse.move(590, 320); await page.mouse.down(); await pause(500); await page.mouse.up();
    assert.ok(validPosition(p.x, p.z)); assert.equal(room.connected().length, 2); assert.equal(room.phase, 'playing');
    await pause(1500); cycle++;
    if (cycle % 4 === 0) console.log(`MATCH ${Math.floor((performance.now() - room.startedAt) / 1000)}s / 180s; both clients connected`);
  }
  await until(() => room.phase === 'ended', 'full match did not end on natural deadline', 8000);
  assert.equal(room.endsAt, deadline); assert.ok(performance.now() >= deadline); assert.ok(Math.max(pa.score, pb.score) < 10);
  await Promise.all([a.locator('#results').waitFor({ state: 'visible' }), b.locator('#results').waitFor({ state: 'visible' })]);
  const winner = room.players.get(room.winner!)!.name; assert.equal(await a.locator('#winner').textContent(), winner); assert.equal(await b.locator('#winner').textContent(), winner);
  await a.screenshot({ path: 'artifacts/environment-full-match-results.png' });
  check('Unmodified 180-second two-client match completes on timeout; both winner screens agree with the server');
  const metrics = await a.evaluate(() => {
    const data = (window as any).__relayMetrics; data.active = false;
    const frames = data.frames as { ms: number; calls: number; triangles: number }[];
    const sorted = frames.map(f => f.ms).sort((a, b) => a - b);
    return { frames: frames.length, frameMsMedian: sorted[Math.floor(sorted.length * .5)], frameMsP95: sorted[Math.floor(sorted.length * .95)], maxDrawCalls: Math.max(...frames.map(f => f.calls)), maxTriangles: Math.max(...frames.map(f => f.triangles)), canvasPixelRatio: (document.querySelector('#arena') as HTMLCanvasElement).width / innerWidth };
  });
  assert.ok(metrics.frames > 100); assert.deepEqual(errors, []);
  await a.locator('#replay').click(); await Promise.all([a.locator('#lobby').waitFor({ state: 'visible' }), b.locator('#lobby').waitFor({ state: 'visible' })]); assert.equal(pa.score, 0); assert.equal(pb.score, 0);
  check('Both clients return to a clean replay lobby with no JavaScript or WebGL shader errors');
  await writeFile(hardware ? 'artifacts/environment-metal-report.json' : 'artifacts/environment-report.json', JSON.stringify({ gpu, date: new Date().toISOString(), checks, errors, matchSeconds: RULES.matchMs / 1000, fixtureDisclosure: 'Controlled valid poses; real DOM actions and sockets; no match clock, scores, deadlines or cell scheduling overrides.', structure, metrics, network: { aSnapshots: wa.count, bSnapshots: wb.count, aMaxGapMs: wa.maxGapMs, bMaxGapMs: wb.maxGapMs }, limits: ['Automated browser contexts on one computer, not two human-operated physical devices.', hardware ? 'Local headless Chrome on Apple Metal; not a physical-phone, WAN, or broad hardware benchmark.' : 'SwiftShader software WebGL with simultaneous contexts; frame times are not representative of normal hardware.', 'Five-second first-time orientation and physical-device performance require human testing.'] }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, metrics }));
} catch (error) {
  await a.screenshot({ path: 'artifacts/failure-environment.png' }).catch(() => {}); console.error(error); process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
