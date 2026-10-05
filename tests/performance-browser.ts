import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGameServer, serveProduction } from '../server/app';

// Test-only access to the actual renderer. No diagnostic globals or gameplay
// endpoints are shipped. Both revisions use the same bundle and capture path.
const label = process.argv[2] || 'after';
const mobile = process.argv.includes('--mobile');
const output = `artifacts/performance/${label}-${mobile ? 'mobile' : 'desktop'}`;
await mkdir('artifacts/performance', { recursive: true });
let baselineTemporary = '';
let baselineClient = process.env.NB_PERF_BEFORE_CLIENT;
if (label === 'before' && !baselineClient) {
  baselineTemporary = await mkdtemp(join(tmpdir(), 'neon-perf-baseline-'));
  await promisify(execFile)('tar', ['-xzf', 'artifacts/performance/baseline-client.tar.gz', '-C', baselineTemporary]);
  baselineClient = join(baselineTemporary, 'client');
}
const bundle = await build({ entryPoints: ['client/main.ts'], bundle: true, write: false,
  format: 'esm', sourcemap: 'inline', keepNames: true, loader: { '.css': 'empty' },
  plugins: [{ name: 'test-only-render-access', setup(builder) {
    builder.onLoad({ filter: /client\/.*\.ts$/ }, async ({ path }) => {
      const source = label === 'before' && baselineClient
        ? path.replace(`${process.cwd()}/client`, baselineClient) : path;
      const contents = await readFile(source, 'utf8');
      return { contents: path.endsWith('/main.ts') ? contents.replace('const socket = new GameConnection();',
        'Object.assign(window, { __perfArena: arena, __perfControls: controls }); const socket = new GameConnection();') : contents, loader: 'ts' };
    });
  } }],
});
const server = createGameServer();
const html = (await readFile('dist/client/index.html', 'utf8'))
  .replace(/src="\/assets\/index-[^"]+\.js"/, 'src="/performance-client.js"');
server.app.get('/', (_req, res) => res.type('html').send(html));
server.app.get('/performance-client.js', (_req, res) => res.type('js').send(bundle.outputFiles[0].text));
serveProduction(server.app);
await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
const address = server.http.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: !process.argv.includes('--headed'), args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cdp = await page.context().newCDPSession(page);
let report: any = { passed: false, label, mobile, scenarios: [], errors };
try {
  await page.addInitScript({ content: "window.__name = (fn) => fn; sessionStorage.setItem('nb-intro-seen-v1', '1');" });
  await page.goto(url);
  await page.locator('#landing-connection').filter({ hasText: 'STATION ONLINE' }).waitFor();
  await page.locator('#callsign').fill('FPSCHECK'); await page.locator('#solo').click();
  await page.locator('#lobby').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const w = window as any, arena = w.__perfArena;
    w.__metrics = { active: false, at: 0, frames: [], costs: {}, mode: '' };
    const wrap = (object: any, key: string, category: string) => {
      const original = object[key]; object[key] = function(...args: any[]) {
        const start = performance.now(); const result = original.apply(this, args);
        if (w.__metrics.active) w.__metrics.costs[category] = (w.__metrics.costs[category] || 0) + performance.now() - start;
        return result;
      };
    };
    wrap(arena.renderer, 'render', 'renderer'); wrap(arena.environment, 'update', 'environment');
    wrap(arena.pulses, 'update', 'pulses');
    for (const model of arena.operators.values()) wrap(model, 'animate', 'operatorAnimation');
    const originalOperator = arena.operator.bind(arena);
    arena.operator = (p: any) => { const model = originalOperator(p); wrap(model, 'animate', 'operatorAnimation'); return model; };
    const render = arena.render.bind(arena);
    arena.render = (...args: any[]) => {
      const start = performance.now(), m = w.__metrics;
      render(...args);
      if (!m.active) return;
      const info = arena.renderer.info.render, now = performance.now();
      if (m.at) m.frames.push({ ms: start - m.at, cpu: now - start, calls: info.calls, triangles: info.triangles,
        phased: !!arena.snapshot?.players.some((p: any) => p.phaseUntil > args[1]), cell: !!arena.snapshot?.cell,
        pulses: arena.pulses.audit().active });
      m.at = start;
    };
  });
  const gpu = await page.evaluate(() => {
    const r = (window as any).__perfArena.renderer, gl = r.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION), pixelRatio: r.getPixelRatio(), drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      userAgent: navigator.userAgent, shadowMaps: r.shadowMap.enabled };
  });
  report.gpu = gpu; report.browser = browser.version(); console.log('GPU', JSON.stringify(gpu));
  async function measure(name: string, seconds: number, action?: (elapsed: number) => Promise<void>) {
    await page.evaluate(name => { const m = (window as any).__metrics; Object.assign(m, { active: true, at: 0, frames: [], costs: {}, mode: name }); }, name);
    const started = performance.now();
    while (performance.now() - started < seconds * 1000) { if (action) await action(performance.now() - started); await sleep(100); }
    const result = await page.evaluate(() => {
      const m = (window as any).__metrics; m.active = false;
      const frames = m.frames, ms = frames.map((f: any) => f.ms).filter((v: number) => v > 0), sorted = [...ms].sort((a: number, b: number) => a - b);
      const sum = (key: string) => frames.reduce((s: number, f: any) => s + f[key], 0) / frames.length;
      let worstWindow = 0;
      for (let i = 0, j = 0, duration = 0; i < ms.length; i++) {
        while (j < ms.length && duration < 1000) duration += ms[j++];
        if (duration >= 1000) worstWindow = Math.max(worstWindow, duration / (j - i));
        duration -= ms[i];
      }
      return { scenario: m.mode, frames: frames.length, averageFps: 1000 / (ms.reduce((s: number, v: number) => s + v, 0) / ms.length),
        lowestOneSecondFps: 1000 / worstWindow, worstFrameMs: sorted.at(-1), p95FrameMs: sorted[Math.floor(sorted.length * .95)],
        p99FrameMs: sorted[Math.floor(sorted.length * .99)], cpuMs: sum('cpu'), drawCalls: sum('calls'), triangles: sum('triangles'),
        effectsFrames: frames.filter((f: any) => f.pulses > 0).length, phasedFrames: frames.filter((f: any) => f.phased).length,
        cellFrames: frames.filter((f: any) => f.cell).length, costsMs: m.costs };
    });
    report.scenarios.push(result); console.log('MEASURE', JSON.stringify(result)); return result;
  }
  await sleep(6500); await measure('lobby', 12);
  await page.locator('#start').click(); await page.locator('#hud').waitFor({ state: 'visible' });
  if (!mobile) { if (await page.locator('#resume-button').isVisible()) await page.locator('#resume-button').click(); await page.waitForFunction(() => !!document.pointerLockElement); }
  await sleep(700);
  const code = await page.evaluate(() => (window as any).__perfArena.snapshot.code);
  const room = server.rooms.rooms.get(code)!;
  // Stable starting pose only. Scores, damage, cooldowns, bots and clock remain
  // real. The entire match still runs on the normal persistent simulation.
  async function startPose(x: number, z: number, yaw: number) {
    const human = [...room.players.values()].find(p => !p.bot)!;
    Object.assign(human, { x, z, yaw, pitch: 0, input: null, life: human.life + 1 }); server.publish(code); await sleep(200);
  }
  await startPose(-12, -12, -Math.PI / 2);
  if (mobile) await page.evaluate(() => { const c = (window as any).__perfControls; c.fire = true; c.stick.x = .8; c.stick.y = -.3; });
  else { await page.keyboard.down('KeyW'); await page.mouse.down(); }
  let direction = 0;
  const moveAim = async (elapsed: number) => {
    const next = Math.floor(elapsed / 2200) % 4;
    if (!mobile && next !== direction) { await page.keyboard.up(['KeyW','KeyD','KeyS','KeyA'][direction]); direction = next; await page.keyboard.down(['KeyW','KeyD','KeyS','KeyA'][direction]); }
    if (mobile) await page.evaluate(() => (window as any).__perfControls.aim(8, 0));
    else await page.mouse.move(720 + Math.sin(elapsed * .001) * 90, 450 + Math.sin(elapsed * .0007) * 20);
  };
  await measure('movement-and-firing', 16, moveAim);
  if (!mobile) await page.keyboard.up(['KeyW','KeyD','KeyS','KeyA'][direction]);
  else await page.evaluate(() => { const c = (window as any).__perfControls; c.stick.x = c.stick.y = 0; });
  // Keep the first uncollected cell visible for this rendering sample. Bots
  // restart from valid pads, then immediately resume their normal AI. Their
  // health, scores, shot rules and match clock are untouched.
  const botPads = [{ x: 16, z: 16 }, { x: 16, z: -16 }, { x: -16, z: 16 }];
  [...room.players.values()].filter(p => p.bot).forEach((p, i) => Object.assign(p,
    { ...botPads[i], input: null, life: p.life + 1 })); server.publish(code);
  // Wait for the natural 20-second pickup, then move to its valid center. Do
  // not invent a Phase state or inflate the effects beyond accepted shots.
  if (!mobile) await page.keyboard.down('KeyD');
  else await page.evaluate(() => (window as any).__perfControls.stick.x = .8);
  let cellSeenAt = 0, collected = false;
  await measure('heavy-effects-with-phase', 14, async elapsed => {
    if (room.cell && !collected) {
      if (!cellSeenAt) cellSeenAt = elapsed;
      if (elapsed - cellSeenAt >= 500) { collected = true; await startPose(0, 0, 0); }
    }
    await moveAim(elapsed);
  });
  // Profiling is a separate sample: DevTools tracing must not inflate measured
  // FPS, especially when comparing the one-second low and worst frame.
  const traceEvents: any[] = [];
  cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler', options: 'sampling-frequency=1000', transferMode: 'ReportEvents' });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
  const profileAt = performance.now();
  while (performance.now() - profileAt < 6000) { await moveAim(performance.now() - profileAt); await sleep(100); }
  const { profile } = await cdp.send('Profiler.stop');
  const done = new Promise<void>(resolve => cdp.once('Tracing.tracingComplete', () => resolve()));
  await cdp.send('Tracing.end'); await done;
  await writeFile(`${output}-trace.json`, JSON.stringify({ traceEvents, metadata: { gpu, label, scenario: 'Actual solo match; Phase Cell and continuously held fire' } }));
  await writeFile(`${output}.cpuprofile`, JSON.stringify(profile));
  const counts = new Map<number, number>(); profile.samples?.forEach((id: number) => counts.set(id, (counts.get(id) || 0) + 1));
  report.profileTop = profile.nodes.map((n: any) => ({ function: n.callFrame.functionName, line: n.callFrame.lineNumber + 1,
    url: n.callFrame.url, samples: counts.get(n.id) || 0 })).filter((n: any) => n.samples > 0).sort((a: any, b: any) => b.samples - a.samples).slice(0, 35);
  report.traceEventCount = traceEvents.length;
  await page.mouse.up(); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyS');
  await page.screenshot({ path: `${output}.png` });
  if (label !== 'before') {
    await page.locator('#fps-counter').waitFor();
    assert.match((await page.locator('#fps-counter').textContent())!, /\d+ FPS/);
    const box = (await page.locator('#fps-counter').boundingBox())!; assert.ok(box.x >= 0 && box.x + box.width <= (mobile ? 390 : 1440));
  }
  assert.ok(report.scenarios[1].effectsFrames > 0); assert.ok(report.scenarios[2].phasedFrames > 0, 'Real Phase effect must be measured');
  assert.ok(report.scenarios[2].cellFrames > 0, 'The live center Phase Cell beam must be measured');
  assert.deepEqual(errors, []); report.passed = true;
} finally {
  await writeFile(`${output}-report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
  if (baselineTemporary) await rm(baselineTemporary, { recursive: true, force: true });
}
