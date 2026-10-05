import type { AudioSettings } from './audio-design';

export const INTRO_SESSION_KEY = 'nb-intro-seen-v1';
export const INTRO_SKIP_MS = 1000;
export const INTRO_MAX_MS = 23_000;
export type IntroResult = 'seen' | 'ended' | 'skipped' | 'failed' | 'cancelled';
type IntroAudio = Pick<AudioSettings, 'master' | 'music' | 'muted'>;

export function introVolume(settings: IntroAudio) {
  const value = settings.master * settings.music;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
export function introSources(width: number, saveData = false) {
  const small = saveData || width <= 960;
  return small ? ['/intro/neon-breach-720p.mp4', '/intro/neon-breach-1080p.mp4'] : ['/intro/neon-breach-1080p.mp4', '/intro/neon-breach-720p.mp4'];
}

// A blocked storage write must not make the intro repeat after every room click.
// Claim before starting media so concurrent requests cannot open two sequences.
export class IntroSession {
  private claimed = false;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {}
  claim(gesture: boolean) {
    if (!gesture || this.claimed) return false;
    try { if (this.storage?.getItem(INTRO_SESSION_KEY) === '1') { this.claimed = true; return false; } } catch { /* Storage is optional. */ }
    this.claimed = true;
    try { this.storage?.setItem(INTRO_SESSION_KEY, '1'); } catch { /* The in-memory claim remains valid. */ }
    return true;
  }
}

type IntroOptions = {
  getAudio: () => IntroAudio;
  onMute: (muted: boolean) => void;
  onActive: (active: boolean) => void;
};

export class IntroVideo {
  private overlay: HTMLElement;
  private video: HTMLVideoElement;
  private skip: HTMLButtonElement;
  private mute: HTMLButtonElement;
  private status: HTMLElement;
  private session: IntroSession;
  private finishPlayback: ((result: IntroResult) => void) | null = null;
  private pending: Promise<IntroResult> | null = null;
  private timers = new Set<number>();
  private held = false;
  private forcedMuted = false;
  private _active = false;
  private beforeFocus: HTMLElement | null = null;
  private inert = new Map<HTMLElement, boolean>();
  constructor(private options: IntroOptions) {
    let storage: Storage | null = null;
    try { storage = sessionStorage; } catch { /* Privacy settings may deny storage. */ }
    this.session = new IntroSession(storage);
    this.overlay = document.createElement('section');
    this.overlay.id = 'intro-video'; this.overlay.className = 'intro-video'; this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Neon Breach title sequence'); this.overlay.tabIndex = -1;
    this.video = document.createElement('video');
    this.video.preload = 'none'; this.video.playsInline = true; this.video.disablePictureInPicture = true;
    this.video.setAttribute('aria-label', 'Armored operators inside the Shattered Relay with the Pulse Rifle and Phase Cell');
    this.status = document.createElement('p'); this.status.className = 'intro-video-status';
    this.status.setAttribute('role', 'status'); this.status.textContent = 'INITIALIZING RELAY…';
    const controls = document.createElement('div'); controls.className = 'intro-video-controls';
    this.mute = document.createElement('button'); this.mute.type = 'button'; this.mute.className = 'intro-video-mute';
    this.skip = document.createElement('button'); this.skip.type = 'button'; this.skip.className = 'intro-video-skip';
    this.skip.disabled = true; this.skip.textContent = 'SKIP IN 1s';
    controls.append(this.mute, this.skip); this.overlay.append(this.video, this.status, controls); document.body.append(this.overlay);
    this.skip.onclick = () => { if (!this.skip.disabled && !this.held) this.finishPlayback?.('skipped'); };
    this.mute.onclick = () => {
      if (this.forcedMuted && !this.options.getAudio().muted) {
        this.forcedMuted = false; this.syncAudio();
        if (!this.held) void this.video.play().catch(() => { this.forcedMuted = true; this.syncAudio(); });
      } else { this.options.onMute(!this.options.getAudio().muted); this.syncAudio(); }
    };
    this.overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.skip.disabled && !this.held) { e.preventDefault(); this.finishPlayback?.('skipped'); }
      if (e.key === 'Tab') {
        const buttons = this.skip.disabled ? [this.mute] : [this.mute, this.skip];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? i <= 0 ? buttons.length - 1 : i - 1 : i === buttons.length - 1 ? 0 : i + 1;
        e.preventDefault(); buttons[next].focus();
      }
    });
    this.syncAudio();
  }
  get active() { return this._active; }
  syncAudio() {
    const audio = this.options.getAudio(); this.video.volume = introVolume(audio);
    this.video.muted = audio.muted || this.video.volume === 0 || this.forcedMuted;
    this.mute.textContent = audio.muted ? 'UNMUTE' : this.forcedMuted ? 'ENABLE AUDIO' : 'MUTE';
    this.mute.setAttribute('aria-label', audio.muted ? 'Unmute game audio' : this.forcedMuted ? 'Enable intro audio' : 'Mute game audio');
    this.mute.setAttribute('aria-pressed', String(audio.muted));
  }
  private timer(fn: () => void, ms: number) {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); return id;
  }
  private clearTimers() { for (const id of this.timers) window.clearTimeout(id); this.timers.clear(); }
  play(gesture: boolean): Promise<IntroResult> {
    if (this.pending) return this.pending;
    if (!this.session.claim(gesture)) return Promise.resolve('seen');
    this.beforeFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.held = false; this.forcedMuted = false; this.skip.disabled = true; this.skip.textContent = 'SKIP IN 1s';
    this.status.hidden = false; this.status.textContent = 'INITIALIZING RELAY…';
    this.overlay.hidden = false; this.overlay.classList.remove('is-leaving'); document.body.classList.add('intro-playing');
    for (const child of document.body.children) if (child instanceof HTMLElement && child !== this.overlay) { this.inert.set(child, child.inert); child.inert = true; }
    this._active = true; this.options.onActive(true); this.syncAudio(); this.overlay.focus();
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const sources = introSources(window.innerWidth, !!connection?.saveData);
    let source = 0, played = false, stall = 0, attempt = 0;
    this.pending = new Promise(resolve => {
      const finish = (result: IntroResult) => {
        if (!this.finishPlayback) return;
        this.finishPlayback = null; this.clearTimers(); this.video.pause();
        this.video.onended = this.video.onerror = this.video.onplaying = this.video.onwaiting = this.video.onstalled = null;
        document.removeEventListener('visibilitychange', hidden);
        this.held = true; this.skip.disabled = true; this.skip.textContent = 'OPENING UPLINK…'; this.status.hidden = true;
        // The exact last frame stays visible until the room acknowledgement
        // reveals the actual lobby beneath it. A network error cannot trap it.
        this.timer(() => this.dismiss(), 6000);
        resolve(result);
      };
      const hidden = () => { if (document.hidden) finish('failed'); };
      const failed = (failedAttempt = attempt) => {
        if (failedAttempt !== attempt || !this.finishPlayback) return;
        if (!played && source + 1 < sources.length) { source++; start(); } else finish('failed');
      };
      const start = () => {
        const currentAttempt = ++attempt;
        try {
          this.video.src = sources[source]; this.video.load();
          void this.video.play().catch(error => {
            if (!this.finishPlayback || currentAttempt !== attempt) return;
            if (error instanceof DOMException && error.name === 'NotAllowedError' && !this.video.muted) {
              // A trusted gesture starts media. If a browser still denies sound,
              // keep the sequence playable and offer an explicit audio gesture.
              this.forcedMuted = true; this.syncAudio(); void this.video.play().catch(() => failed(currentAttempt));
            } else failed(currentAttempt);
          });
        } catch { failed(currentAttempt); }
      };
      this.finishPlayback = finish;
      this.video.onended = () => finish('ended'); this.video.onerror = () => failed();
      this.video.onplaying = () => { played = true; this.status.hidden = true; window.clearTimeout(stall); };
      const waiting = () => {
        if (this.held) return;
        this.status.hidden = false; this.status.textContent = 'BUFFERING RELAY…';
        window.clearTimeout(stall); stall = this.timer(() => finish('failed'), 2500);
      };
      this.video.onwaiting = this.video.onstalled = waiting;
      document.addEventListener('visibilitychange', hidden);
      this.timer(() => { if (!this.held) { this.skip.disabled = false; this.skip.textContent = 'SKIP INTRO'; } }, INTRO_SKIP_MS);
      this.timer(() => { if (!played) finish('failed'); }, 4500);
      this.timer(() => finish('failed'), INTRO_MAX_MS);
      start();
    });
    return this.pending;
  }
  dismiss(immediate = false) {
    if (!this._active) return;
    this.finishPlayback?.('cancelled'); this.clearTimers(); this.pending = null;
    this.options.onActive(false); this._active = false;
    for (const [element, previous] of this.inert) element.inert = previous; this.inert.clear();
    document.body.classList.remove('intro-playing'); this.overlay.classList.add('is-leaving');
    if (this.beforeFocus?.isConnected && this.beforeFocus.offsetParent !== null) this.beforeFocus.focus();
    const remove = () => { this.overlay.hidden = true; this.overlay.classList.remove('is-leaving'); this.video.removeAttribute('src'); this.video.load(); };
    if (immediate) remove(); else this.timer(remove, 420);
  }
  cancel() { this.dismiss(true); }
}
