import { GameConnection as HttpConnection } from './http-connection';
import { RealtimeConnection } from './realtime-connection';
import { parseGameConfig, type RealtimeReply } from '../shared/realtime-protocol';
import type { Input } from '../shared/protocol';

// Netlify switches after a deployed backend URL is configured. Local/backend
// play uses a direct WebSocket connection with the same production frontend.
export class GameConnection {
  sample: (() => Input | null) | null = null;
  canAct: () => boolean = () => true;
  onLatency: ((ms: number) => void) | null = null;
  private transport: HttpConnection | RealtimeConnection | null = null;
  private listeners = new Map<string, ((value?: any) => void)[]>();
  private loading = false;
  private closed = false;
  get connected() { return this.transport?.connected ?? false; }
  on(event: string, listener: (value?: any) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  request(event: string, value: unknown): Promise<RealtimeReply> { return this.transport?.request(event, value) ?? Promise.resolve({ ok: false, error: 'The station is not connected yet.' }); }
  async connect() {
    this.closed = false;
    if (this.transport) { this.transport.connect(); return; }
    if (this.loading) return;
    this.loading = true;
    try {
      const response = await fetch('/game-config.json', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      const config = parseGameConfig(response.ok ? await response.json() : { transport: 'http', serverUrl: null });
      if (this.closed) return;
      this.transport = config.transport === 'websocket' ? new RealtimeConnection(config.serverUrl || location.origin) : new HttpConnection();
      this.transport.sample = () => this.sample?.() ?? null;
      this.transport.canAct = () => this.canAct();
      this.transport.onLatency = ms => this.onLatency?.(ms);
      for (const name of ['connect', 'disconnect', 'connect_error', 'snapshot', 'event', 'seat_error', 'lobby_recover', 'unstable', 'stable']) {
        this.transport.on(name, value => { for (const listener of this.listeners.get(name) ?? []) listener(value); });
      }
      this.transport.connect();
    } catch (error) {
      if (!this.closed) {
        for (const listener of this.listeners.get('connect_error') ?? []) listener(error instanceof Error ? error.message : 'Station configuration unavailable.');
        setTimeout(() => { if (!this.closed) void this.connect(); }, 2000);
      }
    } finally { this.loading = false; }
  }
  close() { this.closed = true; this.transport?.close(); }
}
