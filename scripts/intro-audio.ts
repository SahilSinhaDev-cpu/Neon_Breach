import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Reproducible offline capture tool; its ephemeral test server is always closed.
const bundle = resolve(tmpdir(), `neon-intro-audio-${process.pid}.js`);
await build({ entryPoints: ['scripts/intro-audio-harness.ts'], bundle: true, outfile: bundle, format: 'iife', platform: 'browser' });
const app = express();
app.get('/', (_req, res) => res.type('html').send('<!doctype html><title>Neon Breach offline intro audio</title><button>Enable test audio</button><script src="/render.js"></script>'));
app.get('/render.js', (_req, res) => res.sendFile(bundle));
app.use('/music', express.static(resolve('public/music')));
const server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const address = server.address(); assert.ok(address && typeof address === 'object');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-timer-throttling'] });
try {
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
  await page.locator('button').click(); await page.waitForFunction(() => (window as any).introAudio.sound.status === 'ready');
  await page.evaluate(() => (window as any).introAudio.ready());
  let state = await page.evaluate(() => (window as any).introAudio.state()); assert.deepEqual(state.active, []);
  await page.evaluate(() => { const sound = (window as any).introAudio.sound; sound.configure({ music: .65, master: .8 }); sound.joined(); sound.unlock(); });
  await page.waitForTimeout(100); state = await page.evaluate(() => (window as any).introAudio.state()); assert.deepEqual(state.active, []);
  assert.equal(await page.evaluate(() => (window as any).introAudio.played().join || 0), 0);
  await page.evaluate(() => (window as any).introAudio.sound.setIntroPlaying(false));
  state = await page.evaluate(() => (window as any).introAudio.state()); assert.deepEqual(state.active, ['lobby']); assert.equal(state.targets.lobby, 1);
  await page.evaluate(() => (window as any).introAudio.sound.setIntroPlaying(true));
  await page.waitForTimeout(90); state = await page.evaluate(() => (window as any).introAudio.state()); assert.equal(state.voices, 0);
  await page.evaluate(() => { const sound = (window as any).introAudio.sound; sound.configure({ music: 0 }); sound.setIntroPlaying(false); });
  state = await page.evaluate(() => (window as any).introAudio.state()); assert.deepEqual(state.active, []);
  const suppressionChecks = [
    'A gesture initializes the real Sound engine with intro suppression already active',
    'Late unlock resolution, slider updates and join cues do not start live music or effects under the intro',
    'Finishing the intro restores the actual lobby source and full music target',
    'Reactivating intro suppression stops the live lobby source and its tail',
    'Music zero remains silent when intro suppression is released',
  ];
  const result = await page.evaluate(() => (window as any).introAudio.render());
  assert.equal(result.seconds, 18); assert.equal(result.sampleRate, 48000); assert.equal(result.channels, 2); assert.equal(result.frames, 864000);
  assert.equal(result.metrics.clippedSamples, 0); assert.ok(result.metrics.peak > .05 && result.metrics.peak < .88);
  assert.ok(result.metrics.monoEnergyRatio > .9); assert.ok(result.metrics.windows.at(-1).peak < .004);
  assert.equal(result.mixer.played.shot, 1); assert.equal(result.mixer.played.armor, 1);
  const audio = Buffer.from(result.wav, 'base64'); delete result.wav;
  await mkdir('artifacts/intro', { recursive: true }); await writeFile('artifacts/intro/intro-mix.wav', audio);
  await writeFile('artifacts/intro/audio-report.json', JSON.stringify({ passed: true, date: new Date().toISOString(), ...result, suppressionChecks, bytes: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, file: 'artifacts/intro/intro-mix.wav', seconds: result.seconds, sampleRate: result.sampleRate, channels: result.channels, peak: result.metrics.peak, rms: result.metrics.rms, monoEnergyRatio: result.metrics.monoEnergyRatio, clippedSamples: result.metrics.clippedSamples, bytes: audio.length, listenedByEar: false }, null, 2));
} finally {
  await browser.close(); await new Promise<void>(r => server.close(() => r())); await rm(bundle, { force: true });
}
