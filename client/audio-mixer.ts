import { aimDirection, type Vec3 } from '../shared/world';
import { acoustics, SOUND_LENGTHS, synthesize, type AudioBus, type AudioSettings, type SoundKind } from './audio-design';

export type PlayOptions = { position?: Vec3; gain?: number; priority?: number; bus?: AudioBus; at?: number; variation?: number };
type Voice = { source: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; end: number; priority: number };
type Loop = { source: AudioBufferSourceNode; gain: GainNode; low: BiquadFilterNode; high: BiquadFilterNode; pan: PannerNode | null; kind: SoundKind; nodes: AudioNode[] };
const MAX_VOICES = 24, MAX_LOOPS = 6;

export class AudioMixer {
  readonly output: GainNode;
  readonly buses: Record<AudioBus, GainNode>;
  readonly metrics = { voices: 0, peakVoices: 0, dropped: 0, stolen: 0, played: {} as Partial<Record<SoundKind, number>> };
  readonly buffers = new Map<SoundKind, AudioBuffer[]>();
  private voices: Voice[] = []; private retiring: Voice[] = []; private loops = new Map<string, Loop>();
  private counters = new Map<SoundKind, number>(); private duck: GainNode; private settings: AudioSettings;
  private listener: Vec3 = { x: 0, y: 1.6, z: 0 };
  constructor(readonly context: BaseAudioContext, settings: AudioSettings) {
    this.settings = settings;
    this.buses = { effects: context.createGain(), ambience: context.createGain(), music: context.createGain(), ui: context.createGain() };
    const sum = context.createGain(), compressor = context.createDynamicsCompressor(), ceiling = context.createWaveShaper();
    this.duck = context.createGain(); this.buses.ambience.connect(this.duck); this.duck.connect(sum);
    this.buses.music.connect(sum); this.buses.effects.connect(sum); this.buses.ui.connect(sum);
    compressor.threshold.value = -14; compressor.knee.value = 12; compressor.ratio.value = 5; compressor.attack.value = 0.003; compressor.release.value = 0.12;
    // A safety ceiling after the compressor guarantees headroom even for an
    // extreme coincident burst. Normal play stays in the almost-linear center.
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = 0.88 * Math.tanh(x / 0.88); }
    ceiling.curve = curve; ceiling.oversample = '2x';
    this.output = context.createGain(); sum.connect(compressor); compressor.connect(ceiling); ceiling.connect(this.output); this.output.connect(context.destination);
    for (const kind of Object.keys(SOUND_LENGTHS) as SoundKind[]) {
      const variants: AudioBuffer[] = [], count = kind === 'shot' || kind === 'step' ? 4 : 1;
      for (let i = 0; i < count; i++) { const pcm = synthesize(kind, context.sampleRate, i), buffer = context.createBuffer(1, pcm.length, context.sampleRate); buffer.getChannelData(0).set(pcm); variants.push(buffer); }
      this.buffers.set(kind, variants);
    }
    this.configure(settings, true);
  }
  configure(settings: AudioSettings, immediate = false) {
    this.settings = { ...settings }; const now = this.context.currentTime;
    for (const bus of ['effects', 'ambience', 'music', 'ui'] as const) this.ramp(this.buses[bus].gain, settings[bus], now, immediate);
    this.ramp(this.output.gain, settings.muted ? 0 : settings.master, now, immediate);
  }
  private ramp(param: AudioParam, value: number, at: number, immediate = false) {
    param.cancelScheduledValues(at);
    if (immediate) param.setValueAtTime(value, at); else param.setTargetAtTime(value, at, 0.012);
  }
  setListener(position: Vec3, yaw: number, pitch: number, at = this.context.currentTime) {
    this.listener = { ...position }; const direction = aimDirection(yaw, pitch), listener = this.context.listener;
    // Camera +Y rotated by yaw/pitch; forward and up remain perpendicular.
    const up = { x: Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: Math.cos(yaw) * Math.sin(pitch) };
    if (listener.positionX) {
      for (const [param, value] of [[listener.positionX, position.x], [listener.positionY, position.y], [listener.positionZ, position.z], [listener.forwardX, direction.x], [listener.forwardY, direction.y], [listener.forwardZ, direction.z], [listener.upX, up.x], [listener.upY, up.y], [listener.upZ, up.z]] as const) param.setValueAtTime(value, at);
    } else { listener.setPosition(position.x, position.y, position.z); listener.setOrientation(direction.x, direction.y, direction.z, up.x, up.y, up.z); }
  }
  private panner(position: Vec3, at: number) {
    // Equal-power spatial panning gives stable left/right transients without
    // HRTF kernel startup/crossfade ambiguity for these very short sounds.
    const p = this.context.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.rolloffFactor = 0;
    p.positionX.value = position.x; p.positionY.value = position.y; p.positionZ.value = position.z; return p;
  }
  play(kind: SoundKind, options: PlayOptions = {}) {
    const bus = options.bus ?? 'effects';
    if (this.settings.muted || this.settings.master === 0 || this.settings[bus] === 0) return false;
    const c = this.context, at = Math.max(c.currentTime, options.at ?? c.currentTime), spatial = acoustics(this.listener, options.position, kind);
    const gain = (options.gain ?? 0.6) * spatial.gain;
    if (gain < 0.008 || kind === 'step' && spatial.distance > 18) { this.metrics.dropped++; return false; }
    // Only presently overlapping voices compete. Ended offline-scheduled voices
    // must remain connected until rendering, so cleanup happens on onended.
    this.voices = this.voices.filter(v => v.end > at);
    const priority = (options.priority ?? 50) - spatial.distance * 0.8;
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.reduce((a, b) => a.priority < b.priority ? a : b);
      if (victim.priority >= priority) { this.metrics.dropped++; return false; }
      this.fadeVoice(victim, at); this.voices.splice(this.voices.indexOf(victim), 1); this.metrics.stolen++;
    }
    const variants = this.buffers.get(kind)!, index = options.variation ?? this.counters.get(kind) ?? 0;
    this.counters.set(kind, index + 1);
    const source = c.createBufferSource(), high = c.createBiquadFilter(), low = c.createBiquadFilter(), volume = c.createGain();
    source.buffer = variants[index % variants.length]; high.type = 'highpass'; high.frequency.value = spatial.highpass; high.Q.value = 0.5;
    low.type = 'lowpass'; low.frequency.value = Math.min(c.sampleRate * 0.45, spatial.lowpass); low.Q.value = 0.55;
    volume.gain.setValueAtTime(gain, at);
    const nodes: AudioNode[] = [source, high, low, volume]; source.connect(high); high.connect(low); low.connect(volume);
    if (options.position) { const pan = this.panner(options.position, at); volume.connect(pan); pan.connect(this.buses[bus]); nodes.push(pan); }
    else volume.connect(this.buses[bus]);
    const voice: Voice = { source, gain: volume, nodes, end: at + source.buffer.duration, priority }; this.voices.push(voice);
    source.onended = () => { for (const node of nodes) node.disconnect(); this.voices = this.voices.filter(v => v !== voice); this.retiring = this.retiring.filter(v => v !== voice); this.metrics.voices = this.voices.length; };
    source.start(at); source.stop(voice.end + 0.01);
    this.metrics.played[kind] = (this.metrics.played[kind] ?? 0) + 1; this.metrics.voices = this.voices.length;
    this.metrics.peakVoices = Math.max(this.metrics.peakVoices, this.voices.length);
    if (priority >= 85) { this.duck.gain.cancelScheduledValues(at); this.duck.gain.setTargetAtTime(0.32, at, 0.008); this.duck.gain.setTargetAtTime(1, at + 0.16, 0.2); }
    return true;
  }
  private fadeVoice(voice: Voice, at: number) {
    voice.gain.gain.cancelScheduledValues(at); voice.gain.gain.setTargetAtTime(0, at, 0.002); voice.source.stop(at + 0.012);
    this.retiring.push(voice);
    // Bound even the 12 ms stealing tails during malformed/event-flood bursts.
    if (this.retiring.length > 4) { const old = this.retiring.shift()!; old.source.stop(at); for (const node of old.nodes) node.disconnect(); }
  }
  loop(id: string, kind: 'vent' | 'cellHum' | 'phaseHum', gain: number, position?: Vec3) {
    if (this.settings.muted || this.settings.master === 0 || this.settings[kind === 'vent' ? 'ambience' : 'effects'] === 0) { this.stopLoop(id); return; }
    let loop = this.loops.get(id); const c = this.context, at = c.currentTime;
    if (!loop) {
      if (this.loops.size >= MAX_LOOPS) return;
      const source = c.createBufferSource(), volume = c.createGain(), low = c.createBiquadFilter(), high = c.createBiquadFilter(), pan = position ? this.panner(position, at) : null;
      source.buffer = this.buffers.get(kind)![0]; source.loop = true; low.type = 'lowpass'; low.Q.value = 0.5; high.type = 'highpass'; high.Q.value = 0.5;
      source.connect(high); high.connect(low); low.connect(volume); volume.gain.setValueAtTime(0, at);
      const bus = this.buses[kind === 'vent' ? 'ambience' : 'effects'];
      if (pan) { volume.connect(pan); pan.connect(bus); } else volume.connect(bus);
      loop = { source, gain: volume, low, high, pan, kind, nodes: [source, volume, low, high, ...(pan ? [pan] : [])] };
      this.loops.set(id, loop); source.start();
    }
    const spatial = acoustics(this.listener, position, kind);
    loop.gain.gain.setTargetAtTime(gain * spatial.gain, at, 0.08);
    loop.low.frequency.setTargetAtTime(kind === 'vent' ? 550 : Math.min(2200, spatial.lowpass), at, 0.08);
    loop.high.frequency.setTargetAtTime(kind === 'vent' ? 45 : spatial.highpass, at, 0.08);
    if (loop.pan && position) for (const [param, value] of [[loop.pan.positionX, position.x], [loop.pan.positionY, position.y], [loop.pan.positionZ, position.z]] as const) param.setTargetAtTime(value, at, 0.03);
  }
  keepLoops(ids: Set<string>) { for (const id of this.loops.keys()) if (!ids.has(id)) this.stopLoop(id); }
  private stopLoop(id: string) {
    const loop = this.loops.get(id); if (!loop) return; this.loops.delete(id);
    loop.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.016); loop.source.stop(this.context.currentTime + 0.09);
    loop.source.onended = () => loop.nodes.forEach(node => node.disconnect());
  }
  stop() { this.keepLoops(new Set()); for (const voice of this.voices) this.fadeVoice(voice, this.context.currentTime); this.voices = []; this.metrics.voices = 0; }
  get loopCount() { return this.loops.size; }
}
