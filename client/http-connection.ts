import { GAME_ENDPOINT, RECOVERY_GRACE_MS, type Credentials, type GameRequest, type HttpReply } from '../shared/http-protocol';
import type { GameEvent, Input, Snapshot } from '../shared/protocol';

// One in-flight request per browser. Samples replace unsent movement; nothing
// accumulates into a delayed burst of stale movement/fire packets.
export class GameConnection {
  connected = false;
  sample: (() => Input | null) | null = null;
  onLatency: ((ms: number) => void) | null = null;
  private listeners = new Map<string, ((value?: any) => void)[]>();
  private client = crypto.randomUUID();
  private seat: Credentials | null = null;
  private cursor = 0;
  private lastSnapshot: Snapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private busy = false;
  private closed = false;
  private running = false;
  private generation = 0;
  private playerId = '';
  private roundTrip = 0;
  private lastOkAt = -Infinity;
  private backoffUntil = 0;
  private recoveryWatchdog: ReturnType<typeof setTimeout> | null = null;
  private pendingDash: { life: number; expires: number } | null = null;
  private activeRequest: AbortController | null = null;
  private delays = new Map<ReturnType<typeof setTimeout>, () => void>();
  constructor(private requestFetch: typeof fetch = fetch) {}
  on(event: string, listener: (value?: any) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  private emit(event: string, value?: unknown) { for (const listener of this.listeners.get(event) ?? []) listener(value); }
  private clearRecoveryWatchdog() { if (this.recoveryWatchdog) clearTimeout(this.recoveryWatchdog); this.recoveryWatchdog = null; }
  private failed(message: string) {
    if (this.closed) return;
    if (this.connected && this.seat && performance.now() - this.lastOkAt < RECOVERY_GRACE_MS) {
      this.emit('unstable', message);
      // Retry-After can postpone the next fetch beyond the grace window.
      // Keep the input timeout alive even while no request is in flight.
      if (!this.recoveryWatchdog) this.recoveryWatchdog = setTimeout(() => {
        this.recoveryWatchdog = null;
        if (this.seat) this.failed(message);
      }, Math.max(1, Math.ceil(RECOVERY_GRACE_MS - (performance.now() - this.lastOkAt)) + 1));
      return;
    }
    this.pendingDash = null;
    if (this.connected) { this.connected = false; this.emit('disconnect'); }
    this.emit('connect_error');
  }
  private async send(packet?: GameRequest): Promise<{ reply: HttpReply; retryable: boolean }> {
    const start = performance.now();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6000);
    const generation = this.generation;
    const watchdog = this.seat && this.connected ? setTimeout(() => {
      if (generation === this.generation) this.failed('Waiting for the station…');
    }, Math.max(1, RECOVERY_GRACE_MS - (start - this.lastOkAt))) : null;
    this.activeRequest = controller;
    try {
      const response = await this.requestFetch.call(globalThis, GAME_ENDPOINT, { method: packet ? 'POST' : 'GET', cache: 'no-store', headers: packet ? { 'Content-Type': 'application/json' } : undefined, body: packet ? JSON.stringify(packet) : undefined, signal: controller.signal });
      let reply: HttpReply;
      try { reply = await response.json() as HttpReply; }
      catch { throw new Error('Invalid station response'); }
      if (!reply || typeof reply.ok !== 'boolean') throw new Error('Invalid station response');
      this.roundTrip = performance.now() - start;
      const retryable = response.status >= 500 || response.status === 408 || response.status === 409 || response.status === 429;
      if (retryable) {
        const retryAfter = Number(response.headers.get('retry-after')) * 1000;
        const pause = Math.min(10_000, Math.max(0, Number(reply.retryAfterMs) || 0, retryAfter || 0));
        this.backoffUntil = performance.now() + pause;
        this.failed(reply.error || 'Station unavailable');
        return { reply: { ...reply, ok: false, retryable: true }, retryable: true };
      }
      if (!this.closed) {
        this.onLatency?.(Math.round(this.roundTrip));
        if (reply.ok) { this.lastOkAt = performance.now(); this.backoffUntil = 0; this.clearRecoveryWatchdog(); }
        if (!this.connected) { this.connected = true; this.emit('connect'); }
        if (reply.ok) this.emit('stable');
      }
      return { reply, retryable: false };
    } catch {
      this.failed('Station did not respond. Retrying…');
      return { reply: { ok: false, error: 'Station did not respond. Check your connection and try again.', retryable: true }, retryable: true };
    } finally {
      clearTimeout(timeout);
      if (watchdog) clearTimeout(watchdog);
      if (this.activeRequest === controller) this.activeRequest = null;
    }
  }
  async request(event: string, value: any): Promise<HttpReply> {
    const leaving = event !== 'room' && value === 'leave';
    const oldSeat = this.seat;
    // Returning home must detach locally even if the leave request is lost.
    // In-flight snapshots from this seat can no longer reopen the old screen.
    if (leaving || event === 'room') this.detach();
    const generation = this.generation;
    const task = this.queue.then(async () => {
      this.busy = true;
      try {
        if (generation !== this.generation && !leaving) return { ok: false, error: 'That room request was canceled.' };
        if (leaving && !oldSeat) return { ok: true };
        const packet: GameRequest = event === 'room'
          ? { ...value, client: this.client, requestId: crypto.randomUUID() }
          : { ...(leaving ? oldSeat : this.seat), action: value, client: this.client, cursor: this.cursor, requestId: crypto.randomUUID() };
        let { reply, retryable } = await this.send(packet);
        // Start/replay have server-side request IDs, so a lost acknowledgement
        // can be retried without applying the action twice. Room creation does
        // not have that guarantee and must never be retried automatically.
        if (!reply.ok && retryable && !this.closed && generation === this.generation && (value === 'start' || value === 'replay')) {
          await this.delay(220);
          if (!this.closed && generation === this.generation) ({ reply } = await this.send(packet));
        }
        if (generation !== this.generation) {
          // A join can commit while Return home is clicked. Release that late
          // seat without ever installing it in the client or reopening its UI.
          if (event === 'room' && reply.ok && reply.snapshot && reply.token) {
            await this.send({ action: 'leave', code: reply.snapshot.code, token: reply.token, client: this.client, requestId: crypto.randomUUID() });
          }
          return { ok: false, error: 'That room request was canceled.' };
        }
        if (reply.ok && event === 'room' && reply.snapshot && reply.token && reply.id) {
          this.seat = { code: reply.snapshot.code, token: reply.token, client: this.client }; this.playerId = reply.id; this.cursor = reply.cursor ?? 0; this.lastSnapshot = reply.snapshot;
        }
        if (reply.ok && event !== 'room' && !leaving) this.accept(reply);
        return reply;
      } finally { this.busy = false; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private detach() { this.generation++; this.seat = null; this.playerId = ''; this.lastSnapshot = null; this.cursor = 0; this.pendingDash = null; this.clearRecoveryWatchdog(); }
  private accept(reply: HttpReply) {
    if (reply.snapshot) { this.lastSnapshot = reply.snapshot; this.emit('snapshot', reply.snapshot); }
    for (const item of reply.events ?? []) if (item.seq > this.cursor) { this.emit('event', item.event as GameEvent); this.cursor = item.seq; }
    this.cursor = Math.max(this.cursor, reply.cursor ?? 0);
  }
  connect() {
    this.closed = false;
    if (this.running) return;
    this.running = true;
    void this.loop().finally(() => { this.running = false; });
  }
  close() {
    this.closed = true; this.connected = false; this.activeRequest?.abort(); this.clearRecoveryWatchdog();
    for (const [timer, wake] of this.delays) { clearTimeout(timer); wake(); }
    this.delays.clear();
  }
  private delay(ms: number) {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.delays.delete(timer); resolve(); }, ms);
      this.delays.set(timer, resolve);
    });
  }
  private async loop() {
    while (!this.closed) {
      const cycleStart = performance.now();
      if (!this.busy) {
        const work = this.queue.then(async () => {
          this.busy = true;
          try {
            if (!this.seat) { await this.send(); return; }
            const generation = this.generation;
            const input = this.lastSnapshot?.phase === 'playing' ? this.sample?.() : null;
            if (input) {
              if (input.dash) this.pendingDash = { life: input.life, expires: performance.now() + Math.max(350, Math.min(2000, this.roundTrip * 2)) };
              if (this.pendingDash && (this.pendingDash.life !== input.life || this.pendingDash.expires < performance.now())) this.pendingDash = null;
              if (this.pendingDash) input.dash = true;
            }
            const { reply } = await this.send({ ...this.seat, action: 'poll', requestId: crypto.randomUUID(), cursor: this.cursor, ...(input ? { input } : {}) });
            if (generation !== this.generation || this.closed) return;
            if (reply.ok) {
              if (input?.dash && (reply.snapshot?.players.find(p => p.id === this.playerId)?.ack ?? -1) >= input.seq) this.pendingDash = null;
              this.accept(reply);
            } else if (reply.errorCode === 'SEAT_DISCONNECTED' && this.lastSnapshot?.phase === 'lobby') {
              this.detach(); this.emit('lobby_recover');
            } else if (reply.error?.includes('seat') || reply.error?.includes('expired') || reply.error?.includes('not found')) { this.detach(); this.emit('seat_error', reply.error); }
          } finally { this.busy = false; }
        });
        this.queue = work.catch(() => {}); await work;
      }
      if (!this.closed) {
        const interval = !this.connected ? 700 : this.seat && this.lastSnapshot?.phase === 'playing' ? 80 : 400;
        // Network time is already part of the interval; do not add an extra
        // 80 ms after every slow response while the operator is moving.
        await this.delay(Math.max(0, this.backoffUntil - performance.now(), interval - (performance.now() - cycleStart)));
      }
    }
  }
}
