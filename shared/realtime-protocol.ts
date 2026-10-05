import type { Reply, Snapshot, GameEvent } from './protocol';
export const REALTIME_VERSION = 2;
export const REALTIME_RELEASE = '2026-10-05-navigation-1';
export const INPUT_INTERVAL_MS = 1000 / 30;
export type RealtimeReply = Reply & { retryable?: boolean; errorCode?: string; retryAfterMs?: number };
export type SnapshotPacket = { epoch: string; seq: number; snapshot: Snapshot };
export type EventPacket = { epoch: string; seq: number; code: string; event: GameEvent };
export type GameConfig = { transport: 'http' | 'websocket'; serverUrl: string | null };
export function parseGameConfig(raw: unknown): GameConfig {
  if (!raw || typeof raw !== 'object') throw new Error('Station configuration is unavailable.');
  const config = raw as GameConfig;
  if (config.transport !== 'http' && config.transport !== 'websocket') throw new Error('Station configuration is invalid.');
  if (config.serverUrl !== null && typeof config.serverUrl !== 'string') throw new Error('Station address is invalid.');
  if (config.serverUrl) {
    const url = new URL(config.serverUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Station address must be a secure server origin.');
  }
  return { transport: config.transport, serverUrl: config.serverUrl };
}
