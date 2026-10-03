import { io, type Socket } from 'socket.io-client';
import type { Input, Snapshot } from '../shared/protocol';
import { INPUT_INTERVAL_MS, REALTIME_VERSION, type SnapshotPacket, type EventPacket, type RealtimeReply } from '../shared/realtime-protocol';

export class RealtimeConnection {
  connected = false;
  sample: (() => Input | null) | null = null;
  onLatency: ((ms: number) => void) | null = null;
  private socket: Socket;
  private listeners = new Map<string, ((value?: any) => void)[]>();
  private seat: { id: string; code: string } | null = null;
  private lastSnapshot: Snapshot | null = null;
  private generation = 0;
  private connectionGeneration = 0;
  private epoch = '';
  private snapshotSeq = 0;
  private eventSeq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingDash: { seq: number; life: number; expires: number } | null = null;
  constructor(url: string, makeSocket = io) {
    this.socket = makeSocket(url, { autoConnect: false, transports: ['websocket'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 2000, randomizationFactor: .3, timeout: 15000, auth: { protocol: REALTIME_VERSION } });
    this.socket.on('connect', () => {
      this.connected = true;
      const previous = this.seat && this.lastSnapshot;
      this.emit('connect'); this.emit('stable'); this.ping();
      if (previous) {
        this.detach();
        if (previous.phase === 'lobby') this.emit('lobby_recover');
        else this.emit('seat_error', 'Your match seat disconnected. Return home to join the next lobby.');
      }
    });
    this.socket.on('disconnect', () => { this.connectionGeneration++; this.connected = false; this.pendingDash = null; this.emit('disconnect'); });
    this.socket.on('connect_error', (error: Error) => this.emit('connect_error', error.message));
    this.socket.on('hello', value => { if (value?.protocol === REALTIME_VERSION && typeof value.epoch === 'string') this.epoch = value.epoch; });
    this.socket.on('shutdown', (message: string) => { this.detach(); this.emit('seat_error', message); });
    this.socket.on('snapshot', (packet: SnapshotPacket) => {
      if (!this.seat || packet.epoch !== this.epoch || packet.snapshot.code !== this.seat.code || packet.seq <= this.snapshotSeq) return;
      this.snapshotSeq = packet.seq;
      if (this.pendingDash && (packet.snapshot.players.find(p => p.id === this.seat!.id)?.ack ?? -1) >= this.pendingDash.seq) this.pendingDash = null;
      this.lastSnapshot = packet.snapshot; this.emit('snapshot', packet.snapshot);
    });
    this.socket.on('event', (packet: EventPacket) => {
      if (!this.seat || packet.epoch !== this.epoch || packet.code !== this.seat.code || packet.seq <= this.eventSeq) return;
      this.eventSeq = packet.seq; this.emit('event', packet.event);
    });
  }
  on(event: string, listener: (value?: any) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  private emit(event: string, value?: unknown) { for (const listener of this.listeners.get(event) ?? []) listener(value); }
  private detach() { this.generation++; this.seat = null; this.lastSnapshot = null; this.snapshotSeq = 0; this.eventSeq = 0; this.pendingDash = null; }
  private send(event: string, value: unknown): Promise<RealtimeReply> {
    if (!this.socket.connected) return Promise.resolve({ ok: false, error: 'Station disconnected. Reconnecting…', retryable: true });
    return new Promise(resolve => this.socket.timeout(3000).emit(event, value, (error: Error | null, reply: RealtimeReply) => {
      resolve(error || !reply || typeof reply.ok !== 'boolean' ? { ok: false, error: 'Station did not confirm the request. Try again.', retryable: true } : reply);
    }));
  }
  request(event: string, value: any): Promise<RealtimeReply> {
    const leaving = event !== 'room' && value === 'leave';
    if (leaving || event === 'room') this.detach();
    const generation = this.generation;
    const task = this.queue.then(async () => {
      if (generation !== this.generation && !leaving) return { ok: false, error: 'That room request was canceled.' };
      const packet = event === 'room' ? { ...value, requestId: crypto.randomUUID() } : { action: value, requestId: crypto.randomUUID() };
      const connection = this.connectionGeneration;
      let reply = await this.send(event, packet);
      // Retries use a cached request ID on the same live socket, including
      // creation, so a lost acknowledgement cannot duplicate an action.
      if (!reply.ok && reply.retryable && this.socket.connected && connection === this.connectionGeneration && generation === this.generation) reply = await this.send(event, packet);
      if (connection !== this.connectionGeneration) return { ok: false, error: 'The connection changed before this request was confirmed. Try again.' };
      if (generation !== this.generation) {
        if (event === 'room' && reply.ok && reply.id) await this.send('action', { action: 'leave', requestId: crypto.randomUUID() });
        return { ok: false, error: 'That room request was canceled.' };
      }
      if (reply.ok && event === 'room' && reply.id && reply.snapshot) {
        this.seat = { id: reply.id, code: reply.snapshot.code }; this.lastSnapshot = reply.snapshot;
      } else if (reply.ok && !leaving && reply.snapshot) {
        this.lastSnapshot = reply.snapshot; this.emit('snapshot', reply.snapshot);
      }
      return reply;
    });
    this.queue = task.catch(() => {}); return task;
  }
  private ping() {
    if (!this.socket.connected) return;
    const at = performance.now();
    this.socket.timeout(4000).emit('pingCheck', (error: Error | null) => { if (!error && this.connected) this.onLatency?.(Math.round(performance.now() - at)); });
  }
  connect() {
    this.socket.connect();
    if (!this.inputTimer) this.inputTimer = setInterval(() => {
      if (!this.connected || !this.seat || this.lastSnapshot?.phase !== 'playing') return;
      const input = this.sample?.(); if (!input) return;
      if (input.dash) this.pendingDash = { seq: input.seq, life: input.life, expires: performance.now() + 500 };
      if (this.pendingDash && (this.pendingDash.life !== input.life || performance.now() > this.pendingDash.expires)) this.pendingDash = null;
      if (this.pendingDash) input.dash = true;
      this.socket.volatile.emit('input', input);
    }, INPUT_INTERVAL_MS);
    if (!this.pingTimer) this.pingTimer = setInterval(() => this.ping(), 2000);
  }
  close() {
    if (this.inputTimer) clearInterval(this.inputTimer); if (this.pingTimer) clearInterval(this.pingTimer);
    this.inputTimer = null; this.pingTimer = null; this.detach(); this.socket.disconnect(); this.connected = false;
  }
}
