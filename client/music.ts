import type { GameEvent, Snapshot } from '../shared/protocol';
import type { AudioSettings } from './audio-design';

export const SCORE = {
  lobby: { seconds: 60, loop: true }, start: { seconds: 7.5, loop: false },
  combat: { seconds: 30, loop: true }, intensity: { seconds: 30, loop: true },
  final: { seconds: 30, loop: true }, victory: { seconds: 7.5, loop: false },
  defeat: { seconds: 5, loop: false }, shimmer: { seconds: 2.25, loop: false },
} as const;
export type Cue = keyof typeof SCORE;
const requests = new Map<Cue, Promise<ArrayBuffer | null>>();
function request(cue: Cue) {
  let pending = requests.get(cue);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`/music/${cue}.flac?v=1`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) return null;
        const data = await response.arrayBuffer(); return data.byteLength <= 8_000_000 ? data : null;
      } catch { return null; } // Music failures never interrupt the game or effects.
    })();
    requests.set(cue, pending);
  }
  return pending;
}
export function preloadScore() {
  // Fetch before the gesture; decoding/playback use the existing audio unlock.
  return Promise.all([request('lobby'), request('combat')]).then(() =>
    Promise.all((Object.keys(SCORE) as Cue[]).filter(c => c !== 'lobby' && c !== 'combat').map(request)));
}
export function nearbyEngagement(s: Snapshot, id: string, event: GameEvent) {
  if (s.phase !== 'playing' || event.type !== 'shot') return false;
  const me = s.players.find(p => p.id === id);
  return !!me && me.connected && me.hp > 0 && (event.shot.shooter === id || event.shot.hit === id || Math.hypot(event.shot.from.x - me.x, event.shot.from.z - me.z) <= 16);
}
type Voice = { source: AudioBufferSourceNode; gain: GainNode; target: number };
export class MusicDirector {
  readonly buffers = new Map<Cue, AudioBuffer>();
  readonly metrics = { starts: {} as Partial<Record<Cue, number>>, failed: [] as Cue[], ducks: 0, finalEntries: 0, peakVoices: 0 };
  readonly ready: Promise<void>;
  readonly duck: GainNode;
  private voices = new Map<Cue, Voice>();
  private retiring = new Set<Voice>();
  private settings: AudioSettings;
  private snapshot: Snapshot | null = null; private id = ''; private key = '';
  private mode: 'lobby' | 'playing' | 'ended' | 'disconnected' = 'lobby';
  private origin = 0; private endOrigin = 0; private lobbyOrigin = 0;
  private endWall = 0; private engagedUntil = 0; private final = false; private paused = false;
  private shimmerAt = -100; private ending: 'victory' | 'defeat' = 'defeat';
  constructor(readonly context: BaseAudioContext, output: AudioNode, settings: AudioSettings) {
    this.settings = settings; this.duck = context.createGain();
    // Fixed mix trim leaves headroom even with all stems and slider at 100%.
    const trim = context.createGain(); trim.gain.value = .12;
    this.duck.connect(trim); trim.connect(output);
    this.ready = this.load();
  }
  private async load() {
    // Keep decoded storage at the asset rate rather than device rate (~44 MB).
    let decoder: BaseAudioContext;
    try { decoder = new OfflineAudioContext(2, 1, 32000); }
    catch { decoder = this.context; } // Devices without offline decoding can still play.
    const load = async (cue: Cue) => {
      try {
        const bytes = await request(cue); if (!bytes) throw Error('Unavailable cue');
        const buffer = await decoder.decodeAudioData(bytes.slice(0));
        if (Math.abs(buffer.duration - SCORE[cue].seconds) > .02) throw Error('Wrong cue length');
        this.buffers.set(cue, buffer);
      } catch { this.metrics.failed.push(cue); }
      this.update();
    };
    await Promise.all([load('lobby'), load('combat')]);
    await Promise.all((Object.keys(SCORE) as Cue[]).filter(c => c !== 'lobby' && c !== 'combat').map(load));
  }
  configure(settings: AudioSettings) { this.settings = settings; this.update(); }
  pause(paused: boolean) { this.paused = paused; if (!paused && this.mode === 'ended') this.endOrigin = this.context.currentTime - (performance.now() - this.endWall) / 1000 + .14; if (paused) this.stopAll(.04); else this.update(); }
  disconnect() { this.mode = 'disconnected'; this.stopAll(.15); }
  clear() { this.snapshot = null; this.key = ''; this.mode = 'lobby'; this.lobbyOrigin = this.context.currentTime; this.final = false; this.engagedUntil = 0; this.shimmerAt = -100; this.update(); }
  receive(s: Snapshot, id: string) {
    const now = this.context.currentTime, key = `${s.code}:${s.match}`;
    if (s.phase === 'playing' && (this.mode !== 'playing' || key !== this.key)) {
      this.origin = now - Math.max(0, (s.now - s.startedAt) / 1000);
      this.final = false; this.engagedUntil = 0; this.shimmerAt = -100;
    }
    if (s.phase === 'ended' && (this.mode !== 'ended' || key !== this.key)) {
      // Let combat reach silence before the ending's first sample.
      this.stopAll(.12); this.endWall = performance.now(); this.endOrigin = now + .14; this.ending = s.winner === id ? 'victory' : 'defeat'; this.shimmerAt = -100;
    }
    if (s.phase === 'lobby' && this.mode !== 'lobby') this.lobbyOrigin = now;
    // Server snapshots also correct the transport after a suspended/background tab.
    if (s.phase === 'playing') this.origin = now - Math.max(0, (s.now - s.startedAt) / 1000);
    this.key = key; this.mode = s.phase; this.snapshot = s; this.id = id;
    if (s.phase === 'playing' && s.endsAt - s.now <= 60000 && !this.final) { this.final = true; this.metrics.finalEntries++; }
    this.update();
  }
  event(event: GameEvent) {
    const s = this.snapshot; if (!s || this.mode !== 'playing') return;
    const now = this.context.currentTime;
    if (nearbyEngagement(s, this.id, event)) {
      this.engagedUntil = now + 4.5;
      // Attack 12 ms, hold 180 ms, recover smoothly over ~0.8 seconds.
      // Repeated fire extends the hold instead of multiplying gain reductions.
      this.duck.gain.cancelScheduledValues(now);
      this.duck.gain.setTargetAtTime(.28, now, .012);
      this.duck.gain.setTargetAtTime(1, now + .18, .26);
      this.metrics.ducks++;
    } else if (event.type === 'cell' && event.player === this.id) this.shimmerAt = now;
    this.update();
  }
  private enabled() { return !this.paused && this.context.state === 'running' && !this.settings.muted && this.settings.master > 0 && this.settings.music > 0; }
  private level(voice: Voice, target: number, fade: number) {
    if (voice.target === target) return; voice.target = target;
    const now = this.context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(target, now + fade);
  }
  private play(cue: Cue, offset: number, target: number, fade: number, at = this.context.currentTime) {
    let voice = this.voices.get(cue);
    if (voice) { this.level(voice, target, fade); return; }
    const buffer = this.buffers.get(cue); if (!buffer || (!SCORE[cue].loop && offset >= buffer.duration)) return;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; source.loop = SCORE[cue].loop;
    source.loopStart = 0; source.loopEnd = SCORE[cue].seconds;
    source.connect(gain); gain.connect(this.duck); gain.gain.value = 0;
    voice = { source, gain, target: -1 }; this.voices.set(cue, voice); this.level(voice, target, fade);
    source.onended = () => { source.disconnect(); gain.disconnect(); if (this.voices.get(cue) === voice) this.voices.delete(cue); this.retiring.delete(voice!); };
    source.start(at, Math.max(0, offset) % buffer.duration);
    this.metrics.starts[cue] = (this.metrics.starts[cue] ?? 0) + 1;
    this.metrics.peakVoices = Math.max(this.metrics.peakVoices, this.voices.size + this.retiring.size);
  }
  private stop(cue: Cue, fade: number) {
    const voice = this.voices.get(cue); if (!voice) return;
    this.voices.delete(cue); this.retiring.add(voice); this.level(voice, 0, fade); voice.source.stop(this.context.currentTime + fade + .005);
    // Bound tails even under repeated malformed lifecycle transitions.
    if (this.retiring.size > 8) { const first = this.retiring.values().next().value!; first.source.stop(); first.source.disconnect(); first.gain.disconnect(); this.retiring.delete(first); }
  }
  private stopAll(fade: number) { for (const cue of this.voices.keys()) this.stop(cue, fade); }
  update() {
    if (!this.enabled() || this.mode === 'disconnected') { this.stopAll(.06); return; }
    const now = this.context.currentTime, keep = new Set<Cue>();
    const use = (cue: Cue, offset: number, target: number, fade: number, at?: number) => { keep.add(cue); this.play(cue, offset, target, fade, at); };
    if (this.mode === 'lobby') use('lobby', now - this.lobbyOrigin, 1, 1.6);
    else if (this.mode === 'ended') {
      const age = now - this.endOrigin;
      if (age < SCORE[this.ending].seconds) use(this.ending, Math.max(0, age), 1, .06, Math.max(now, this.endOrigin));
    } else {
      const age = Math.max(0, now - this.origin);
      if (age < SCORE.start.seconds) use('start', age, 1, .2);
      // If the transition file fails, the already-preloaded combat bed fills in.
      if (age >= 6.75 || !this.buffers.has('start')) use('combat', age, this.final ? .72 : 1, .75);
      if (age >= 6.75) {
        const alive = this.snapshot?.players.some(p => p.id === this.id && p.hp > 0 && p.connected);
        use('intensity', age, alive && now < this.engagedUntil ? .8 : 0, now < this.engagedUntil ? .45 : 1.8);
        if (this.final) use('final', age, .85, 1.6);
      }
      if (now - this.shimmerAt < SCORE.shimmer.seconds) use('shimmer', now - this.shimmerAt, .42, .08);
    }
    for (const cue of this.voices.keys()) if (!keep.has(cue)) this.stop(cue, this.mode === 'lobby' ? 1.6 : .15);
  }
  get state() { return { mode: this.mode, final: this.final, engaged: this.context.currentTime < this.engagedUntil, active: [...this.voices.keys()], targets: Object.fromEntries([...this.voices].map(([cue,v]) => [cue,v.target])), duck: this.duck.gain.value, voices: this.voices.size + this.retiring.size }; }
}
