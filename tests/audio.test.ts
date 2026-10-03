import test from 'node:test';
import assert from 'node:assert/strict';
import { acoustics, audioSettings, DEFAULT_AUDIO, impactMaterial, SOUND_LENGTHS, synthesize, type SoundKind } from '../client/audio-design';

test('audio preferences reject malformed values, clamp volumes, and migrate legacy mute', () => {
  assert.deepEqual(audioSettings(null), DEFAULT_AUDIO);
  assert.equal(audioSettings({}, true).muted, true);
  assert.deepEqual(audioSettings({ master: 9, effects: -2, ambience: NaN, ui: 'loud', muted: false }, true), { ...DEFAULT_AUDIO, master: 1, effects: 0 });
});
test('every original buffer is finite, bounded, edge-faded, and reproducible', () => {
  for (const kind of Object.keys(SOUND_LENGTHS) as SoundKind[]) {
    const samples = synthesize(kind, 24000), repeated = synthesize(kind, 24000); let peak = 0, energy = 0;
    assert.deepEqual(samples, repeated, kind);
    for (const s of samples) { assert.ok(Number.isFinite(s), kind); peak = Math.max(peak, Math.abs(s)); energy += s * s; }
    assert.ok(peak <= 0.681 && peak > 0.2, kind); assert.ok(energy > 0.005, kind);
    assert.equal(Math.abs(samples[0]), 0, kind); assert.ok(Math.abs(samples.at(-1)!) < 0.005, kind);
  }
});
test('four rifle variations retain duration and energy without identical waveforms', () => {
  const variants = Array.from({ length: 4 }, (_, i) => synthesize('shot', 24000, i));
  const energy = (a: Float32Array) => a.reduce((sum, x) => sum + x * x, 0) / a.length;
  for (let i = 1; i < variants.length; i++) { assert.equal(variants[i].length, variants[0].length); assert.notDeepEqual(variants[i], variants[0]); assert.ok(energy(variants[i]) / energy(variants[0]) > 0.65); assert.ok(energy(variants[i]) / energy(variants[0]) < 1.5); }
});
test('distance reduces level and detail; substantial cover muffles; local sound stays centered and unfiltered', () => {
  const listener = { x: -16, y: 1.6, z: 16 };
  const near = acoustics(listener, { x: -13, y: 1.6, z: 16 }), far = acoustics(listener, { x: 16, y: 1.6, z: 16 });
  assert.ok(far.gain < near.gain * 0.2); assert.ok(far.lowpass < near.lowpass); assert.ok(far.highpass > near.highpass);
  const blocked = acoustics({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1.6, z: -9 });
  assert.equal(blocked.occluded, true); assert.ok(blocked.lowpass < 1500);
  assert.equal(acoustics(listener).gain, 1); assert.equal(acoustics(listener).occluded, false);
  assert.ok(acoustics(listener, { x: 0, y: 0.1, z: 16 }, 'step').gain < 0.1);
});
test('impacts identify metal, composite cover, and empty ray endpoints without changing geometry', () => {
  assert.equal(impactMaterial({ x: 0, y: 1.6, z: -20 }), 'metal');
  assert.equal(impactMaterial({ x: 0, y: 1.6, z: -4.1 }), 'composite');
  assert.equal(impactMaterial({ x: -5.5, y: 1.2, z: -4 }), 'metal');
  assert.equal(impactMaterial({ x: 2, y: 0, z: 3 }), 'metal');
  assert.equal(impactMaterial({ x: 0, y: 1.6, z: 12 }), null);
});
test('metal and composite impacts have measurably different high-frequency texture', () => {
  const brightness = (kind: SoundKind) => { const a = synthesize(kind, 24000); let derivative = 0, energy = 0; for (let i = 1; i < a.length; i++) { derivative += (a[i] - a[i - 1]) ** 2; energy += a[i] ** 2; } return derivative / energy; };
  assert.ok(brightness('metal') > brightness('composite') * 2);
  assert.notDeepEqual(synthesize('confirm', 24000), synthesize('damage', 24000));
});
