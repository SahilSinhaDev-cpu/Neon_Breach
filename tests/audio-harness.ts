// Bundled only by test:audio and served by its temporary test server.
import { AudioMixer } from '../client/audio-mixer';
import { DEFAULT_AUDIO, type AudioSettings, type SoundKind } from '../client/audio-design';
import { Sound } from '../client/audio';
import type { PublicPlayer, Snapshot } from '../shared/protocol';
import type { Vec3 } from '../shared/world';

const full = { ...DEFAULT_AUDIO, master: 1, effects: 1, ambience: 1, ui: 1 };
function measure(buffer: AudioBuffer) {
  let peak = 0, derivative = 0, total = 0, lowEnergy = 0; const rms: number[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch); let energy = 0, low = 0;
    const a = 1 - Math.exp(-2 * Math.PI * 220 / buffer.sampleRate);
    for (let i = 0; i < data.length; i++) { const x = data[i]; if (!Number.isFinite(x)) throw new Error('Non-finite audio sample'); peak = Math.max(peak, Math.abs(x)); energy += x * x; low += a * (x - low); lowEnergy += low * low; if (i) derivative += (x - data[i - 1]) ** 2; }
    rms.push(Math.sqrt(energy / data.length)); total += energy;
  }
  return { peak, rms, energy: total, brightness: derivative / Math.max(total, 1e-12), lowFraction: lowEnergy / Math.max(total, 1e-12) };
}
async function render(kind: SoundKind, position?: Vec3, settings = full, listener = { x: -16, y: 1.6, z: 16 }) {
  const c = new OfflineAudioContext(2, 24000, 24000), mixer = new AudioMixer(c, settings); mixer.setListener(listener, 0, 0);
  mixer.play(kind, { position, at: 0.05, gain: 0.8, bus: kind === 'join' ? 'ui' : 'effects', variation: 0 });
  const buffer = await c.startRendering(); return { buffer, metrics: measure(buffer) };
}
function wav(buffers: AudioBuffer[]) {
  const frames = buffers.reduce((sum, buffer) => sum + buffer.length, 0), array = new Uint8Array(44 + frames * 4), d = new DataView(array.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => d.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); d.setUint32(4, array.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true); d.setUint32(24, 24000, true); d.setUint32(28, 96000, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true); text(36, 'data'); d.setUint32(40, frames * 4, true);
  let offset = 44;
  for (const buffer of buffers) { const l = buffer.getChannelData(0), r = buffer.getChannelData(1); for (let i = 0; i < buffer.length; i++) for (const s of [l[i], r[i]]) { d.setInt16(offset, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true); offset += 2; } }
  let binary = ''; for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192)); return btoa(binary);
}

async function lab() {
  const local = await render('shot'), near = await render('shot', { x: -13, y: 1.6, z: 16 }), far = await render('shot', { x: 16, y: 1.6, z: 16 });
  const left = await render('shot', { x: -4, y: 1.6, z: 10 }, full, { x: 0, y: 1.6, z: 10 });
  const right = await render('shot', { x: 4, y: 1.6, z: 10 }, full, { x: 0, y: 1.6, z: 10 });
  const occluded = await render('shot', { x: 0, y: 1.6, z: -9 }, full, { x: 0, y: 1.6, z: 0 });
  const exposed = await render('shot', { x: 9, y: 1.6, z: 0 }, full, { x: 0, y: 1.6, z: 0 });
  const armor = await render('armor'), metal = await render('metal'), composite = await render('composite'), pickup = await render('pickup'), phaseOff = await render('phaseOff');
  const muted = await render('shot', undefined, { ...full, muted: true }), zeroMaster = await render('shot', undefined, { ...full, master: 0 });
  const zeroEffects = await render('shot', undefined, { ...full, effects: 0 }), zeroUi = await render('join', undefined, { ...full, ui: 0 });
  const silenceContext = new OfflineAudioContext(2, 24000, 24000), silentMixer = new AudioMixer(silenceContext, { ...full, ambience: 0 });
  silentMixer.loop('vent', 'vent', 1); const zeroAmbience = measure(await silenceContext.startRendering());
  const c = new OfflineAudioContext(2, 24000 * 8, 24000), mixer = new AudioMixer(c, full);
  mixer.setListener({ x: 0, y: 1.6, z: 10 }, 0, 0); mixer.loop('station', 'vent', 0.065); mixer.loop('cell', 'cellHum', 0.18, { x: 0, y: 1.2, z: 0 });
  for (let t = 0.05; t < 7.5; t += 0.28) {
    for (const x of [-3, 0, 3, 12]) {
      mixer.play('shot', { at: t, gain: x === 0 ? 0.85 : 0.7, priority: x === 0 ? 100 : 80, position: x === 0 ? undefined : { x, y: 1.6, z: 10 } });
      mixer.play('armor', { at: t, gain: 0.39, priority: 60, position: { x: x + 1, y: 1, z: 11 } });
    }
    mixer.play('confirm', { at: t, gain: 0.25, priority: 95 });
    mixer.play('step', { at: t, gain: 0.5, priority: 68, position: { x: -2, y: 0.1, z: 10 } });
  }
  const chaos = await c.startRendering();
  const floodContext = new OfflineAudioContext(2, 24000, 24000), flood = new AudioMixer(floodContext, full);
  for (let i = 0; i < 100; i++) flood.play('metal', { at: 0.05, gain: 1, priority: 20 });
  flood.play('shot', { at: 0.05, gain: 1, priority: 100 });
  const flooded = measure(await floodContext.startRendering());
  return {
    local: local.metrics, near: near.metrics, far: far.metrics, left: left.metrics, right: right.metrics,
    occluded: occluded.metrics, exposed: exposed.metrics, armor: armor.metrics, metal: metal.metrics, composite: composite.metrics,
    silence: [muted.metrics.energy, zeroMaster.metrics.energy, zeroEffects.metrics.energy, zeroUi.metrics.energy, zeroAmbience.energy],
    chaos: { ...measure(chaos), ...mixer.metrics }, flood: { ...flooded, ...flood.metrics },
    wav: wav([local.buffer, near.buffer, far.buffer, left.buffer, right.buffer, armor.buffer, metal.buffer, composite.buffer, pickup.buffer, phaseOff.buffer, chaos]),
  };
}

const sound = new Sound(); document.querySelector('button')!.addEventListener('click', () => sound.unlock());
const player = (id: string, x = 0): PublicPlayer => ({ id, name: id, color: '#73fbd3', order: 0, connected: true, bot: false, x, z: 10, yaw: 0, pitch: 0, hp: 100, score: 0, scoreAt: 0, deaths: 0, respawnAt: 0, protectUntil: 0, phaseUntil: 0, dashAt: 0, ack: 0, life: 1 });
async function lifecycle() {
  const mixer = (sound as unknown as { mixer: AudioMixer }).mixer;
  sound.configure(full);
  let time = 1000, a = player('LOCAL'), b = player('REMOTE', 2);
  const snapshot = (): Snapshot => ({ code: 'AUDIO1', mode: 'multiplayer', phase: 'playing', host: a.id, now: time, startedAt: 1000, endsAt: 181000, players: [{ ...a }, { ...b }], cell: false, cellAt: 21000, winner: null, reason: '', match: 1 });
  const tick = () => { time += 50; sound.receive(snapshot(), a.id); };
  tick(); const before = mixer.metrics.played.step ?? 0; for (let i = 0; i < 25; i++) tick(); const stationary = (mixer.metrics.played.step ?? 0) - before;
  for (let i = 0; i < 12; i++) { a.x += 0.3; b.x += 0.15; tick(); } const moving = (mixer.metrics.played.step ?? 0) - before;
  a.hp = 0; b.hp = 0; tick(); const downBefore = mixer.metrics.played.step ?? 0; for (let i = 0; i < 20; i++) { a.x += 0.3; b.x += 0.3; tick(); } const dead = (mixer.metrics.played.step ?? 0) - downBefore;
  a.hp = 100; b.hp = 100; a.life++; b.life++; tick();
  const dashBefore = mixer.metrics.played.dash ?? 0; tick(); const rejectedDash = (mixer.metrics.played.dash ?? 0) - dashBefore;
  const stepsBeforeDash = mixer.metrics.played.step ?? 0;
  a.x += 6; a.dashAt = time + 3000; tick(); const acceptedDash = (mixer.metrics.played.dash ?? 0) - dashBefore;
  a.x -= 12; tick(); const teleportSteps = (mixer.metrics.played.step ?? 0) - stepsBeforeDash;
  a.phaseUntil = time + 4000; tick(); const cellSnapshot = snapshot(); cellSnapshot.cell = true; sound.receive(cellSnapshot, a.id);
  sound.update({ x: a.x, y: 1.6, z: a.z }, 0, 0, time); const phaseLoops = mixer.loopCount;
  a.phaseUntil = 0; tick(); await new Promise(r => setTimeout(r, 50));
  sound.update({ x: a.x, y: 1.6, z: a.z }, 0, 0, time); const afterPhaseLoops = mixer.loopCount;
  const phaseOff = mixer.metrics.played.phaseOff ?? 0;
  sound.clear();
  return { stationary, moving, dead, rejectedDash, acceptedDash, teleportSteps, phaseOff, phaseLoops, afterPhaseLoops, loopsAfterLeave: mixer.loopCount };
}
Object.assign(window, { audioQA: { lab, lifecycle, sound } });
