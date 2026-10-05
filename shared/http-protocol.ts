import type { GameEvent, Input, Reply } from './protocol';
export const GAME_ENDPOINT = '/.netlify/functions/game';
export const HEARTBEAT_MS = 8000;
export const RECOVERY_GRACE_MS = 2200;
export const RELEASE = '2026-10-05-navigation-1';
export type Credentials = { code: string; token: string; client: string };
export type GameRequest = Partial<Credentials> & { action: 'create' | 'solo' | 'join' | 'poll' | 'start' | 'replay' | 'return-lobby' | 'leave'; name?: string; input?: Input; cursor?: number; requestId: string };
export type HttpReply = Reply & { retryable?: boolean; retryAfterMs?: number; errorCode?: string; cursor?: number; events?: { seq: number; event: GameEvent }[] };
