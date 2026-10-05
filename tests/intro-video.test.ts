import test from 'node:test';
import assert from 'node:assert/strict';
import { INTRO_SESSION_KEY, INTRO_SKIP_MS, INTRO_MAX_MS, IntroSession, IntroVideo, introSources, introVolume } from '../client/intro-video';

test('intro requires a gesture, claims only once, and persists per browser session', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = new IntroSession(storage);
  assert.equal(first.claim(false), false); assert.equal(values.size, 0);
  assert.equal(first.claim(true), true); assert.equal(values.get(INTRO_SESSION_KEY), '1');
  assert.equal(first.claim(true), false); assert.equal(new IntroSession(storage).claim(true), false);
});
test('blocked session storage still cannot produce repeat intros', () => {
  const storage = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } };
  const session = new IntroSession(storage);
  assert.equal(session.claim(true), true); assert.equal(session.claim(true), false);
  const unavailable = new IntroSession(null); assert.equal(unavailable.claim(true), true); assert.equal(unavailable.claim(true), false);
});
test('intro audio uses the same Master and Music values without changing preferences', () => {
  assert.ok(Math.abs(introVolume({ master: 0.75, music: 0.4, muted: false }) - 0.3) < Number.EPSILON);
  assert.equal(introVolume({ master: 0, music: 1, muted: false }), 0);
  assert.equal(introVolume({ master: 0.8, music: 0, muted: true }), 0);
  assert.equal(introVolume({ master: NaN, music: 1, muted: false }), 0);
  assert.equal(introVolume({ master: 2, music: 2, muted: false }), 1);
});
test('phone and data-saving media choose the 720p file with 1080p fallback', () => {
  assert.deepEqual(introSources(1920), ['/intro/neon-breach-1080p.mp4', '/intro/neon-breach-720p.mp4']);
  assert.deepEqual(introSources(390), ['/intro/neon-breach-720p.mp4', '/intro/neon-breach-1080p.mp4']);
  assert.deepEqual(introSources(1920, true), introSources(390));
  assert.equal(INTRO_SKIP_MS, 1000); assert.ok(INTRO_MAX_MS < 24_000);
});

// A small deterministic media/DOM harness checks failure paths that are hard to
// reproduce reliably by waiting for an actual CDN or browser audio restriction.
function harness() {
  let clock = 0, timerId = 0;
  const timers = new Map<number, { due: number; fn: () => void }>();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  class Element extends EventTarget {
    id = ''; className = ''; hidden = false; inert = false; tabIndex = 0; textContent = ''; type = ''; disabled = false;
    isConnected = true; offsetParent = {}; children: Element[] = []; attributes = new Map<string, string>();
    onclick: ((event: Event) => void) | null = null;
    classList = { add: (..._names: string[]) => {}, remove: (..._names: string[]) => {} };
    append(...nodes: Element[]) { this.children.push(...nodes); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    focus() { documentMock.activeElement = this; }
  }
  class Video extends Element {
    preload = ''; playsInline = false; disablePictureInPicture = false; volume = 1; muted = false; src = '';
    plays = 0; loads = 0; pauses = 0; playErrors: Error[] = [];
    onended: (() => void) | null = null; onerror: (() => void) | null = null;
    onplaying: (() => void) | null = null; onwaiting: (() => void) | null = null; onstalled: (() => void) | null = null;
    load() { this.loads++; }
    play() { this.plays++; const error = this.playErrors.shift(); return error ? Promise.reject(error) : Promise.resolve(); }
    pause() { this.pauses++; }
    override removeAttribute(key: string) { super.removeAttribute(key); if (key === 'src') this.src = ''; }
  }
  const video = new Video(), body = new Element(), app = new Element(); body.append(app);
  const documentMock = Object.assign(new EventTarget(), { body, hidden: false, activeElement: app, createElement: (tag: string) => tag === 'video' ? video : new Element() });
  const values = new Map<string, string>();
  install('HTMLElement', Element); install('document', documentMock); install('navigator', { connection: { saveData: false } });
  install('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  install('window', { innerWidth: 1920, setTimeout: (fn: () => void, ms: number) => { const id = ++timerId; timers.set(id, { due: clock + ms, fn }); return id; }, clearTimeout: (id: number) => { timers.delete(id); } });
  const audio = { master: 0.75, music: 0.4, muted: false }, activity: boolean[] = [];
  const controller = new IntroVideo({ getAudio: () => audio, onMute: muted => { audio.muted = muted; }, onActive: active => activity.push(active) });
  const overlay = body.children[1], controls = overlay.children[2], mute = controls.children[0], skip = controls.children[1];
  return {
    controller, video, app, overlay, mute, skip, audio, activity, values,
    advance(ms: number) {
      const target = clock + ms;
      for (;;) { const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; clock = next[1].due; timers.delete(next[0]); next[1].fn(); }
      clock = target;
    },
    restore() { controller.cancel(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('media is not loaded before gesture; skip waits a second and hands off the last frame', async () => {
  const h = harness();
  try {
    assert.equal(h.video.preload, 'none'); assert.equal(h.video.loads, 0); assert.equal(h.video.plays, 0);
    assert.equal(await h.controller.play(false), 'seen'); assert.equal(h.values.size, 0);
    const playing = h.controller.play(true);
    assert.equal(h.app.inert, true); assert.equal(h.video.src, '/intro/neon-breach-1080p.mp4');
    assert.equal(h.controller.play(true), playing); assert.equal(h.skip.disabled, true);
    h.advance(999); assert.equal(h.skip.disabled, true); h.advance(1); assert.equal(h.skip.disabled, false);
    h.skip.onclick?.(new Event('click')); assert.equal(await playing, 'skipped');
    assert.equal(h.controller.active, true); assert.equal(h.overlay.hidden, false);
    h.controller.dismiss(); assert.equal(h.app.inert, false); assert.deepEqual(h.activity, [true, false]);
    h.advance(419); assert.equal(h.overlay.hidden, false); h.advance(1); assert.equal(h.overlay.hidden, true); assert.equal(h.video.src, '');
    assert.equal(await h.controller.play(true), 'seen');
  } finally { h.restore(); }
});
test('blocked audible playback retries muted without replacing the soundtrack preferences', async () => {
  const h = harness();
  try {
    h.video.playErrors.push(new DOMException('Gesture denied', 'NotAllowedError'));
    const playing = h.controller.play(true); await settle();
    assert.equal(h.video.plays, 2); assert.equal(h.video.muted, true); assert.equal(h.audio.muted, false); assert.equal(h.mute.textContent, 'ENABLE AUDIO');
    h.mute.onclick?.(new Event('click')); await settle(); assert.equal(h.video.muted, false);
    h.video.onplaying?.(); h.video.onended?.(); assert.equal(await playing, 'ended');
    h.controller.dismiss(); h.audio.muted = true; h.controller.syncAudio(); assert.equal(h.video.muted, true);
  } finally { h.restore(); }
});
test('a missing file retries the other resolution and never waits indefinitely', async () => {
  const h = harness();
  try {
    const playing = h.controller.play(true); h.video.onerror?.();
    assert.equal(h.video.src, '/intro/neon-breach-720p.mp4'); h.video.onerror?.();
    assert.equal(await playing, 'failed'); assert.equal(h.skip.disabled, true);
    h.advance(6000); assert.equal(h.controller.active, false); h.advance(420); assert.equal(h.overlay.hidden, true);
  } finally { h.restore(); }
});
test('stalled media fails open and cancelling resolves without a delayed second sequence', async () => {
  const h = harness();
  try {
    const playing = h.controller.play(true); h.video.onplaying?.(); h.video.onwaiting?.();
    h.advance(2499); assert.equal(h.skip.textContent, 'SKIP INTRO'); h.advance(1); assert.equal(await playing, 'failed');
    h.controller.cancel(); assert.equal(h.overlay.hidden, true); assert.equal(h.app.inert, false);
    assert.equal(await h.controller.play(true), 'seen'); h.advance(30_000); assert.equal(h.video.plays, 1);
  } finally { h.restore(); }
  const fresh = harness();
  try { const playing = fresh.controller.play(true); fresh.controller.cancel(); assert.equal(await playing, 'cancelled'); assert.equal(fresh.controller.active, false); assert.equal(fresh.overlay.hidden, true); } finally { fresh.restore(); }
});
test('even apparently playing media has a bounded hard timeout', async () => {
  const h = harness();
  try { const playing = h.controller.play(true); h.video.onplaying?.(); h.advance(INTRO_MAX_MS); assert.equal(await playing, 'failed'); h.controller.dismiss(true); assert.equal(h.overlay.hidden, true); } finally { h.restore(); }
});
