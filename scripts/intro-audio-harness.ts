// Offline browser-only render of the original project audio. Not a game route.
import { AudioMixer } from '../client/audio-mixer';
import { DEFAULT_AUDIO } from '../client/audio-design';
import { Sound } from '../client/audio';
import type { MusicDirector } from '../client/music';

export const INTRO_AUDIO = {
  seconds: 18, sampleRate: 48000, channels: 2,
  shotAt: 6.85, impactAt: 6.92, phaseAt: 10.45, titleAt: 12,
} as const;

function envelope(param: AudioParam, points: readonly (readonly [number, number])[]) {
  param.setValueAtTime(points[0][1], points[0][0]);
  for (const [at, value] of points.slice(1)) param.linearRampToValueAtTime(value, at);
}
function wav(buffer: AudioBuffer) {
  const array = new Uint8Array(44 + buffer.length * 4), d = new DataView(array.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => d.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); d.setUint32(4, array.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true);
  d.setUint32(24, buffer.sampleRate, true); d.setUint32(28, buffer.sampleRate * 4, true);
  d.setUint16(32, 4, true); d.setUint16(34, 16, true); text(36, 'data'); d.setUint32(40, buffer.length * 4, true);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1); let at = 44;
  for (let i = 0; i < buffer.length; i++) for (const value of [left[i], right[i]]) { d.setInt16(at, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true); at += 2; }
  let binary = ''; for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
  return btoa(binary);
}
function measure(buffer: AudioBuffer) {
  let peak = 0, sum = 0, mono = 0, clippedSamples = 0; const windows: { at: number; rms: number; peak: number }[] = [];
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let begin = 0; begin < buffer.length; begin += 2400) {
    let energy = 0, p = 0;
    for (let i = begin; i < Math.min(buffer.length, begin + 2400); i++) {
      for (const value of [left[i], right[i]]) {
        if (!Number.isFinite(value)) throw new Error('Non-finite rendered sample');
        peak = Math.max(peak, Math.abs(value)); p = Math.max(p, Math.abs(value));
        sum += value * value; energy += value * value; if (Math.abs(value) >= .9999) clippedSamples++;
      }
      mono += ((left[i] + right[i]) / 2) ** 2;
    }
    windows.push({ at: begin / buffer.sampleRate, rms: Math.sqrt(energy / 4800), peak: p });
  }
  return { peak, rms: Math.sqrt(sum / (buffer.length * 2)), monoEnergyRatio: mono / (sum / 2), clippedSamples, windows };
}
async function render() {
  const c = new OfflineAudioContext(INTRO_AUDIO.channels, INTRO_AUDIO.seconds * INTRO_AUDIO.sampleRate, INTRO_AUDIO.sampleRate);
  const mixer = new AudioMixer(c, { ...DEFAULT_AUDIO, master: 1, music: 1, effects: 1, ambience: 1, ui: 1 });
  mixer.setListener({ x: 0, y: 1.6, z: 0 }, 0, 0);
  // This gain is applied after the game's existing compressor/safety ceiling.
  // The last 0.65 seconds crossfade to silence as live lobby music returns.
  envelope(mixer.output.gain, [[0, 0], [.12, 1], [17.35, 1], [18, 0]]);
  const decode = async (name: 'lobby' | 'combat') => {
    const response = await fetch(`/music/${name}.flac`); if (!response.ok) throw Error(`Missing original ${name} score`);
    return c.decodeAudioData(await response.arrayBuffer());
  };
  const [lobby, combat] = await Promise.all([decode('lobby'), decode('combat')]);
  const bed = c.createBufferSource(), bedGain = c.createGain(); bed.buffer = lobby;
  // Begin at the actual written motif onset, preserving the original lobby's
  // low pads and string melody and its complete absence of percussion.
  bed.connect(bedGain); bedGain.connect(mixer.buses.music);
  envelope(bedGain.gain, [[0, 0], [.8, .2], [6.815, .2], [6.85, .044], [7.08, .044], [7.65, .2], [18, .2]]);
  bed.start(0, 3.75); bed.stop(18);
  const hum = c.createBufferSource(), humGain = c.createGain(), humLow = c.createBiquadFilter();
  hum.buffer = mixer.buffers.get('vent')![0]; hum.loop = true; humLow.type = 'lowpass'; humLow.frequency.value = 550;
  hum.connect(humLow); humLow.connect(humGain); humGain.connect(mixer.buses.ambience);
  envelope(humGain.gain, [[0, 0], [.6, .15], [18, .15]]); hum.start(0); hum.stop(18);
  // The same rifle/armor buffers, filtering, compressor and contained tail
  // are used by authoritative shot events in the running game.
  mixer.play('shot', { at: INTRO_AUDIO.shotAt, gain: .85, priority: 100, variation: 0 });
  mixer.play('armor', { at: INTRO_AUDIO.impactAt, gain: .26, priority: 64, position: { x: .7, y: 1.45, z: -2 } });
  const cell = c.createBufferSource(), cellGain = c.createGain(); cell.buffer = mixer.buffers.get('cellHum')![0];
  cell.connect(cellGain); cellGain.connect(mixer.buses.effects);
  envelope(cellGain.gain, [[INTRO_AUDIO.phaseAt, 0], [INTRO_AUDIO.phaseAt + .3, .48], [INTRO_AUDIO.phaseAt + .6, .33], [INTRO_AUDIO.phaseAt + 1.25, 0]]);
  cell.start(INTRO_AUDIO.phaseAt); cell.stop(INTRO_AUDIO.phaseAt + 1.25);
  // One original score pulse, taken from the start of the existing combat cue.
  // Low-pass and a short envelope isolate its low D pulse; no trailer impact,
  // drum/voice sample, external recording or newly invented melody is used.
  const pulse = c.createBufferSource(), pulseLow = c.createBiquadFilter(), pulseGain = c.createGain(); pulse.buffer = combat;
  pulseLow.type = 'lowpass'; pulseLow.frequency.value = 225; pulseLow.Q.value = .6;
  pulse.connect(pulseLow); pulseLow.connect(pulseGain); pulseGain.connect(mixer.buses.music);
  envelope(pulseGain.gain, [[12, 0], [12.045, .95], [12.33, .48], [12.8, 0]]); pulse.start(12, 0, .8);
  const rendered = await c.startRendering();
  return {
    ...INTRO_AUDIO, frames: rendered.length, metrics: measure(rendered), mixer: mixer.metrics,
    events: [
      { at: 0, source: 'public/music/lobby.flac', offset: 3.75, note: 'Original lobby motif/pads; no percussion; 0.8s fade-in' },
      { at: 0, source: 'client/audio-design.ts:synthesize(vent)', note: 'Low station vent/hum; existing station palette' },
      { at: 6.815, source: 'music envelope', note: '35ms music duck to 22%, hold through 7.08s, restore by 7.65s' },
      { at: INTRO_AUDIO.shotAt, source: 'AudioMixer.play(shot)', note: 'Real Pulse Rifle electrical attack, mechanical body, 270ms tail' },
      { at: INTRO_AUDIO.impactAt, source: 'AudioMixer.play(armor)', note: 'Small armor-metal impact, spatially filtered at 2m' },
      { at: INTRO_AUDIO.phaseAt, source: 'client/audio-design.ts:synthesize(cellHum)', note: '1.25-second contained swell; no pickup reward cue' },
      { at: INTRO_AUDIO.titleAt, source: 'public/music/combat.flac', offset: 0, note: 'One 800ms low-pass original low D score pulse, not a trailer impact' },
      { at: 17.35, source: 'master envelope', note: '650ms fade to silence for existing live lobby music handoff' },
    ],
    wav: wav(rendered), listenedByEar: false, noExternalAssets: true,
  };
}
// Actual Sound lifecycle checks are confined to this capture-only harness.
const sound = new Sound();
document.querySelector('button')!.addEventListener('click', () => { sound.setIntroPlaying(true); sound.unlock(); });
const runtime = () => sound as unknown as { music: MusicDirector; mixer: AudioMixer };
Object.assign(window, { introAudio: { render, sound, ready: () => runtime().music.ready, state: () => runtime().music.state, played: () => runtime().mixer.metrics.played } });
