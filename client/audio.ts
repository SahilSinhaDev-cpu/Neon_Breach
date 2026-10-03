import type { GameEvent, PublicPlayer, Snapshot } from '../shared/protocol';
import { RULES, type Vec3 } from '../shared/world';
import { audioSettings, impactMaterial, type AudioSettings, type SoundKind } from './audio-design';
import { MusicDirector, preloadScore } from './music';
import { AudioMixer, type PlayOptions } from './audio-mixer';

export class Sound {
  context: AudioContext | null = null;
  settings: AudioSettings;
  onStatus: (() => void) | null = null;
  private mixer: AudioMixer | null = null; private music: MusicDirector | null = null; private failed = false;
  private snapshot: Snapshot | null = null; private id = ''; private connected = true;
  private steps = new Map<string, number>(); private lastUpdate = 0; private creakAt = 0; private creakIndex = 0;
  private countdown = ''; private receivedAt = 0;
  constructor() {
    let saved: unknown, legacy = false;
    try { saved = JSON.parse(localStorage.getItem('nb-audio') || 'null'); legacy = localStorage.getItem('nb-muted') === 'true'; } catch { /* Storage is optional. */ }
    this.settings = audioSettings(saved, legacy);
    void preloadScore();
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.mixer?.stop(); this.music?.pause(true); void this.context?.suspend().catch(() => {}); } else this.onStatus?.(); });
  }
  get status(): 'muted' | 'ready' | 'locked' | 'unavailable' {
    return this.settings.muted || this.settings.master === 0 ? 'muted' : this.failed ? 'unavailable' : this.context?.state === 'running' ? 'ready' : 'locked';
  }
  unlock() {
    if (this.settings.muted || document.hidden) { this.onStatus?.(); return; }
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.context.onstatechange = () => this.onStatus?.();
        this.mixer = new AudioMixer(this.context, this.settings);
        this.music = new MusicDirector(this.context, this.mixer.buses.music, this.settings);
        if (this.snapshot) this.music.receive(this.snapshot, this.id);
      }
      // Called only by interaction handlers. Old gunshots are never queued
      // while autoplay is locked; resume starts with current match ambience.
      void this.context.resume().then(() => { this.failed = false; this.music?.pause(false); this.onStatus?.(); }).catch(() => this.onStatus?.());
    } catch { this.failed = true; this.onStatus?.(); }
  }
  configure(patch: Partial<AudioSettings>) {
    this.settings = audioSettings({ ...this.settings, ...patch });
    try { localStorage.setItem('nb-audio', JSON.stringify(this.settings)); localStorage.setItem('nb-muted', String(this.settings.muted)); } catch { /* Private browsing can reject writes. */ }
    this.mixer?.configure(this.settings); this.music?.configure(this.settings); if (this.settings.muted || this.settings.master === 0) this.mixer?.stop();
    this.onStatus?.();
  }
  private play(kind: SoundKind, options: PlayOptions = {}) {
    if (this.status !== 'ready' || document.hidden || !this.mixer) return;
    this.mixer.play(kind, options);
  }
  joined() { this.connected = true; this.play('join', { bus: 'ui', gain: 0.32, priority: 35 }); }
  disconnect() { this.connected = false; this.music?.disconnect(); this.mixer?.stop(); this.play('disconnect', { bus: 'ui', gain: 0.48, priority: 80 }); }
  clear() { this.music?.clear(); this.mixer?.stop(); this.snapshot = null; this.steps.clear(); this.countdown = ''; }
  private position(p: PublicPlayer, eye = 1.2): Vec3 | undefined { return p.id === this.id ? undefined : { x: p.x, y: eye, z: p.z }; }
  receive(s: Snapshot, id: string) {
    const previous = this.snapshot; this.snapshot = s; this.id = id; this.connected = true; this.receivedAt = performance.now();
    this.music?.receive(s, id);
    const changed = previous?.code !== s.code || previous.match !== s.match || previous.phase !== s.phase;
    if (changed) {
      this.mixer?.stop(); this.steps.clear(); this.countdown = ''; this.creakAt = s.now + 13000;
      if (s.phase === 'playing') this.play('start', { bus: 'ui', gain: 0.42, priority: 70 });
      else if (s.phase === 'ended' && previous?.phase === 'playing') this.play(s.winner === id ? 'victory' : 'complete', { bus: 'ui', gain: 0.58, priority: 80 });
      return;
    }
    if (s.phase !== 'playing' || !previous) return;
    const dt = (s.now - previous.now) / 1000;
    for (const p of s.players) {
      const old = previous.players.find(q => q.id === p.id);
      if (!old || !p.connected || p.hp <= 0 || old.hp <= 0 || p.life !== old.life) { this.steps.delete(p.id); continue; }
      const dash = p.dashAt > old.dashAt;
      if (dash) {
        this.play('dash', { position: this.position(old), gain: p.id === id ? 0.64 : 0.58, priority: p.id === id ? 85 : 70 });
        this.play('stabilize', { position: this.position(p, 0.12), gain: 0.43, priority: 65, at: (this.context?.currentTime ?? 0) + 0.15 });
      }
      const distance = Math.hypot(p.x - old.x, p.z - old.z);
      // Footfalls follow measured server travel, not a held key. There is no jump
      // mechanic: alive, non-teleporting operators are on the station floor.
      if (!dash && dt > 0 && dt < 0.25 && distance > 0.008 && distance <= RULES.speed * dt * 1.4) {
        let travel = (this.steps.get(p.id) ?? 1.05) + distance;
        if (travel >= 1.7) { travel %= 1.7; this.play('step', { position: this.position(p, 0.1), gain: p.id === id ? 0.25 : 0.5, priority: p.id === id ? 55 : 78 }); }
        this.steps.set(p.id, travel);
      } else if (dash || distance > 1.8 || dt >= 0.25) this.steps.delete(p.id);
      if (old.phaseUntil > 0 && p.phaseUntil === 0) this.play('phaseOff', { position: this.position(p), gain: 0.47, priority: 65 });
    }
    for (const id of this.steps.keys()) if (!s.players.some(p => p.id === id && p.connected)) this.steps.delete(id);
  }
  event(event: GameEvent) {
    const s = this.snapshot; if (!s || s.phase !== 'playing' || !this.connected) return;
    this.music?.event(event);
    if (event.type === 'shot') {
      const shot = event.shot, own = shot.shooter === this.id;
      this.play('shot', { position: own ? undefined : shot.from, gain: own ? 0.85 : 0.7, priority: own ? 100 : 80 });
      if (shot.phased) this.play('armor', { position: own ? undefined : shot.from, gain: 0.075, priority: 35, at: (this.context?.currentTime ?? 0) + 0.015 });
      if (shot.hit) {
        const target = shot.hit === this.id;
        this.play('armor', { position: target ? undefined : shot.to, gain: shot.damage ? target ? 0.64 : 0.39 : 0.12, priority: target ? 98 : 64 });
        if (shot.damage && own) this.play('confirm', { gain: 0.25, priority: 95 });
        if (shot.damage && target) this.play('damage', { gain: 0.63, priority: 100 });
      } else {
        const material = impactMaterial(shot.to);
        if (material) this.play(material, { position: shot.to, gain: 0.44, priority: 45 });
      }
    } else if (event.type === 'kill') {
      const victim = s.players.find(p => p.id === event.victim);
      if (victim) this.play('elimination', { position: this.position(victim), gain: event.victim === this.id ? 0.77 : 0.55, priority: event.victim === this.id || event.killer === this.id ? 92 : 60 });
    } else if (event.type === 'cell') {
      const p = s.players.find(p => p.id === event.player); if (p) this.play('pickup', { position: this.position(p), gain: 0.6, priority: 66 });
    } else if (event.type === 'respawn' && event.player === this.id && s.players.find(p => p.id === this.id)?.hp === 0) this.play('respawn', { bus: 'ui', gain: 0.51, priority: 80 });
  }
  update(position: Vec3, yaw: number, pitch: number, serverNow: number) {
    if (!this.mixer || this.status !== 'ready' || document.hidden) return;
    const now = performance.now(); if (now - this.lastUpdate < 33) return; this.lastUpdate = now;
    this.music?.update();
    this.mixer.setListener(position, yaw, pitch);
    const s = this.snapshot;
    if (!s || s.phase !== 'playing' || !this.connected || now - this.receivedAt > 1200) { this.mixer.keepLoops(new Set()); return; }
    const remaining = (s.endsAt - serverNow) / 1000, keep = new Set(['station']);
    this.mixer.loop('station', 'vent', remaining < 30 ? 0.1 : 0.065);
    if (s.cell) { keep.add('cell'); this.mixer.loop('cell', 'cellHum', 0.18, { x: 0, y: 1.2, z: 0 }); }
    for (const p of s.players) if (p.connected && p.hp > 0 && p.phaseUntil > serverNow) { const key = `phase:${p.id}`; keep.add(key); this.mixer.loop(key, 'phaseHum', p.id === this.id ? 0.09 : 0.13, this.position(p)); }
    this.mixer.keepLoops(keep);
    const player = s.players.find(p => p.id === this.id), respawn = player && player.hp <= 0 ? Math.ceil((player.respawnAt - serverNow) / 1000) : 0;
    const seconds = Math.ceil(remaining), countdown = respawn > 0 && respawn <= 3 ? `life:${player!.life}:${respawn}` : seconds > 0 && seconds <= 10 ? `end:${seconds}` : '';
    if (countdown && countdown !== this.countdown) this.play('pulse', { bus: 'ui', gain: 0.3, priority: 62 }); this.countdown = countdown;
    if (serverNow >= this.creakAt) {
      const i = this.creakIndex++; this.play('creak', { bus: 'ambience', gain: 0.12, priority: 10, position: { x: i % 2 ? -17 : 17, y: 4, z: i % 3 ? 11 : -13 } });
      this.creakAt = serverNow + 17000 + (i % 3) * 4000;
    }
  }
}
