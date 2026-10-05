import { build } from 'esbuild';
import { chromium } from 'playwright';
import express from 'express';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const app = express(), server = createServer(app);
const bundle = await build({ entryPoints: ['tests/intro-capture-harness.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
app.get('/', (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}canvas{display:block}#black{position:absolute;inset:0;background:#000;pointer-events:none}#title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;background:radial-gradient(ellipse at center,#03090b6b,transparent 47%)}#title-text{font:700 68px "Avenir Next Condensed","Arial Narrow",sans-serif;letter-spacing:4px;color:#73fbd3;max-width:440px;white-space:nowrap;margin:0;text-shadow:0 2px 9px #02090c}#tagline{font:400 18px Arial,Helvetica,sans-serif;letter-spacing:.25px;color:#c0cccd;margin:20px 0 0;max-width:440px;white-space:nowrap;text-shadow:0 1px 5px #000}
</style><canvas></canvas><div id="black"></div><div id="title"><h1 id="title-text">NEON BREACH</h1><p id="tagline">The contract ends when the signal dies.</p></div><script src="/capture.js"></script>`));
app.get('/capture.js', (_req, res) => res.type('application/javascript').send(bundle.outputFiles[0].text));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const address = server.address(); assert.ok(address && typeof address === 'object');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const dir = process.env.INTRO_FRAMES_DIR || '/private/tmp/neon-intro-frames';
const errors: string[] = [];
try {
  await mkdir('artifacts/intro', { recursive: true }); await mkdir(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}`); await page.waitForFunction(() => (window as any).introCapture); await page.evaluate(() => document.fonts.ready);
  const samples = [.0, 1.6, 3.8, 5.8, 6.9, 6.98, 8.9, 10.6, 13.5, 17.9666667];
  const poses: unknown[] = [];
  for (const t of samples) { poses.push(await page.evaluate(t => (window as any).introCapture.frame(t), t)); await page.screenshot({ path: `artifacts/intro/frame-${t.toFixed(2)}.png` }); }
  const audit = await page.evaluate(() => (window as any).introCapture.audit());
  assert.ok(audit.shotCorridorClear); assert.ok(audit.titleWidth <= 460 && audit.taglineWidth <= 460, JSON.stringify(audit)); assert.equal(audit.finalActorsVisible, false); assert.deepEqual(errors, []);
  await writeFile('artifacts/intro/capture-report.json', JSON.stringify({ audit, poses, errors }, null, 2));
  console.log('Captured preview frames and validated the existing models, eye height, firing lane and phone-safe title.');
  if (!process.argv.includes('--preview')) for (let i = 0; i < 540; i++) {
    const state = await page.evaluate(t => (window as any).introCapture.frame(t), i / 30);
    assert.ok(state.validCamera, `Camera entered geometry at ${i / 30}s`);
    await page.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.png` });
    if (i % 90 === 0) console.log(`Captured ${i}/540 frames`);
  }
} finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
