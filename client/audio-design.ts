import { BOXES, clamp, rayBox, type Vec3 } from '../shared/world';

export const SOUND_LENGTHS = {
  shot: 0.27, armor: 0.18, metal: 0.24, composite: 0.15, confirm: 0.08,
  damage: 0.21, elimination: 0.57, step: 0.18, dash: 0.23, stabilize: 0.16,
  pickup: 0.48, phaseOff: 0.33, respawn: 0.36, join: 0.16, start: 0.33,
  pulse: 0.13, victory: 0.78, complete: 0.43, disconnect: 0.41, creak: 1.7,
  vent: 6, cellHum: 2, phaseHum: 2,
} as const;
export type SoundKind = keyof typeof SOUND_LENGTHS;
export type AudioBus = 'effects' | 'ambience' | 'music' | 'ui';
export type AudioSettings = { master: number; effects: number; ambience: number; music: number; ui: number; muted: boolean };
export const DEFAULT_AUDIO: AudioSettings = { master: 0.75, effects: 0.8, ambience: 0.35, music: 0.4, ui: 0.65, muted: false };
export function audioSettings(raw: unknown, legacyMuted = false): AudioSettings {
  const source = raw && typeof raw === 'object' ? raw as Partial<AudioSettings> : {};
  const result = { ...DEFAULT_AUDIO, muted: typeof source.muted === 'boolean' ? source.muted : legacyMuted };
  for (const key of ['master', 'effects', 'ambience', 'music', 'ui'] as const) {
    const n = source[key]; if (typeof n === 'number' && Number.isFinite(n)) result[key] = clamp(n, 0, 1);
  }
  return result;
}

// Deterministic, original PCM synthesis. No recordings, downloaded assets,
// oscillators swept into laser chirps, or runtime fetch/decode dependencies.
export function synthesize(kind: SoundKind, sampleRate: number, variation = 0): Float32Array {
  const length = SOUND_LENGTHS[kind], data = new Float32Array(Math.ceil(length * sampleRate));
  let seed = (0x4e425245 + variation * 7919 + Object.keys(SOUND_LENGTHS).indexOf(kind) * 104729) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const tuning = 1 + random() * 0.014, offset = (random() + 1) * 0.0011;
  const env = (t: number, decay: number, attack = 0.001) => t <= 0 ? 0 : (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
  const sine = (hz: number, t: number) => Math.sin(2 * Math.PI * hz * tuning * t);
  const aLow = 1 - Math.exp(-2 * Math.PI * 340 / sampleRate), aMid = 1 - Math.exp(-2 * Math.PI * 2400 / sampleRate), aTop = 1 - Math.exp(-2 * Math.PI * 7600 / sampleRate);
  let low = 0, mid = 0, top = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate, n = random(); low += aLow * (n - low); mid += aMid * (n - mid); top += aTop * (n - top);
    const crack = top - mid, grit = mid - low, bassNoise = low;
    const clang = (a: number, b: number, decay: number, delay = 0) => {
      const u = t - delay; return (sine(a, u) + 0.47 * sine(b, u)) * env(u, decay);
    };
    let value = 0;
    switch (kind) {
      case 'shot': {
        const discharge = (crack * 1.12 + grit * 0.38) * env(t, 0.013, 0.00035);
        const mechanism = grit * (0.65 * env(t - 0.003 - offset, 0.031) + 0.21 * env(t - 0.028, 0.01));
        const body = (sine(94, t) * 0.24 + sine(153, t) * 0.09 + bassNoise * 0.2) * env(t, 0.032, 0.0018);
        const tail = clang(617, 1081, 0.032, 0.009) * 0.039 + clang(827, 1327, 0.035, 0.041) * 0.021 + grit * env(t - 0.032, 0.05) * 0.09;
        value = discharge + mechanism + body + tail; break;
      }
      case 'armor': value = grit * env(t, 0.024) * 0.8 + crack * env(t, 0.012) * 0.37 + clang(421, 763, 0.031) * 0.15; break;
      case 'metal': value = crack * env(t, 0.012) * 0.85 + clang(1139, 1777, 0.042) * 0.23 + clang(877, 1511, 0.025, 0.026) * 0.08; break;
      case 'composite': value = bassNoise * env(t, 0.029) * 1.95 + grit * env(t, 0.014) * 0.32 + clang(173, 287, 0.022) * 0.1; break;
      case 'confirm': value = grit * (env(t, 0.007) + env(t - 0.028, 0.008) * 0.58) + clang(683, 947, 0.009) * 0.1; break;
      case 'damage': value = bassNoise * env(t, 0.038) * 1.2 + clang(127, 231, 0.044) * 0.25 + grit * env(t - 0.021, 0.035) * 0.25; break;
      case 'elimination': value = grit * env(t, 0.047) * 0.85 + clang(211, 379, 0.062) * 0.27 + crack * env(t - 0.08, 0.09) * (0.1 + 0.1 * sine(31, t)) + bassNoise * env(t, 0.086) * 0.3; break;
      case 'step': value = bassNoise * (env(t, 0.022) * 1.3 + env(t - 0.039 - offset, 0.014) * 0.65) + grit * env(t, 0.016) * 0.32 + clang(237, 413, 0.018) * 0.07; break;
      case 'dash': value = (grit * 0.57 + bassNoise * 0.7) * env(t, 0.057, 0.004) + clang(131, 271, 0.029) * 0.19 + crack * env(t, 0.011) * 0.28; break;
      case 'stabilize': value = bassNoise * env(t, 0.024) * 1.5 + grit * env(t, 0.013) * 0.45 + clang(187, 397, 0.023) * 0.09; break;
      case 'pickup': value = grit * env(t, 0.07, 0.002) * 0.65 + clang(113, 227, 0.09) * 0.26 + clang(347, 593, 0.063, 0.047) * 0.1 + crack * env(t - 0.014, 0.05) * 0.14; break;
      case 'phaseOff': value = grit * env(t, 0.04) * 0.3 + clang(173, 269, 0.057) * 0.25 + bassNoise * env(t - 0.041, 0.042) * 0.7; break;
      case 'respawn': value = bassNoise * env(t, 0.054, 0.008) * 0.8 + clang(179, 359, 0.052, 0.025) * 0.17 + grit * env(t - 0.12, 0.02) * 0.24; break;
      case 'join': value = grit * env(t, 0.011) * 0.4 + clang(311, 467, 0.022) * 0.13 + grit * env(t - 0.058, 0.013) * 0.2; break;
      case 'start': value = clang(137, 277, 0.064) * 0.23 + grit * (env(t, 0.012) * 0.35 + env(t - 0.13, 0.017) * 0.3); break;
      case 'pulse': value = clang(193, 293, 0.022) * 0.14 + grit * env(t, 0.009) * 0.27; break;
      case 'victory': value = clang(109, 219, 0.13) * 0.22 + clang(163, 327, 0.085, 0.17) * 0.13 + grit * (env(t, 0.015) * 0.25 + env(t - 0.3, 0.032) * 0.2); break;
      case 'complete': value = clang(109, 231, 0.072) * 0.23 + grit * env(t - 0.12, 0.04) * 0.26; break;
      case 'disconnect': value = clang(227, 341, 0.04) * 0.18 + clang(151, 253, 0.055, 0.16) * 0.2 + grit * env(t, 0.02) * 0.15; break;
      case 'creak': value = (sine(217, t) * sine(2.3, t) * 0.12 + sine(433 + 3 * Math.sin(t * 7), t) * 0.09 + grit * 0.23) * env(t, 0.35, 0.09); break;
      case 'vent': value = bassNoise * 0.43 + (sine(59, t) * 0.031 + sine(118, t) * 0.009) * (0.85 + 0.15 * Math.sin(t * Math.PI / 3)); break;
      case 'cellHum': value = sine(97, t) * 0.039 + sine(194, t) * 0.016 + grit * (0.027 + 0.008 * Math.sin(t * Math.PI * 3)); break;
      case 'phaseHum': value = (sine(123, t) + sine(127, t)) * 0.021 + grit * (0.027 + 0.009 * Math.sin(t * Math.PI * 5)); break;
    }
    // Short edge fades remove discontinuities, including the loop boundary.
    value *= Math.min(1, t / 0.0005, (length - t) / 0.008);
    data[i] = value; peak = Math.max(peak, Math.abs(value));
  }
  const target = kind === 'shot' ? 0.68 : kind === 'vent' ? 0.3 : kind.endsWith('Hum') ? 0.25 : 0.48;
  const scale = target / Math.max(peak, 0.001);
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  return data;
}

export function impactMaterial(point: Vec3): 'metal' | 'composite' | null {
  for (const box of BOXES) {
    const dx = Math.abs(point.x - box.x) - box.w / 2, dy = Math.abs(point.y - box.y) - box.h / 2, dz = Math.abs(point.z - box.z) - box.d / 2;
    if (Math.max(dx, dy, dz) < 0.09 && Math.max(dx, dy, dz) > -0.09) return box.kind === 'cover' ? 'composite' : 'metal';
  }
  return null; // A ray that ends in empty space has no impact sound.
}
export function acoustics(listener: Vec3, source?: Vec3, kind: SoundKind = 'shot') {
  if (!source) return { distance: 0, gain: 1, lowpass: 11500, highpass: 48, occluded: false };
  const dx = source.x - listener.x, dy = source.y - listener.y, dz = source.z - listener.z, distance = Math.hypot(dx, dy, dz);
  const direction = { x: dx / Math.max(0.001, distance), y: dy / Math.max(0.001, distance), z: dz / Math.max(0.001, distance) };
  const occluded = BOXES.some(b => b.kind !== 'floor' && rayBox(listener, direction, b) < distance - 0.18);
  const quiet = kind === 'step' || kind.endsWith('Hum');
  const gain = (1 / (1 + Math.pow(distance / (quiet ? 3.8 : 9), 1.7))) * (occluded ? 0.62 : 1) * clamp((60 - distance) / 12, 0, 1);
  return { distance, gain, lowpass: occluded ? 1150 : Math.max(1800, 9200 / (1 + distance * 0.09)), highpass: Math.min(620, 65 + distance * 11), occluded };
}
