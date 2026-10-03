import type { Vec3 } from './world';
export type Phase = 'lobby' | 'playing' | 'ended';
export type RoomMode = 'multiplayer' | 'solo';
export type Input = { seq: number; life: number; mx: number; my: number; yaw: number; pitch: number; fire: boolean; dash: boolean };
export type PublicPlayer = { id: string; name: string; color: string; order: number; connected: boolean; bot: boolean; x: number; z: number; yaw: number; pitch: number; hp: number; score: number; scoreAt: number; deaths: number; respawnAt: number; protectUntil: number; phaseUntil: number; dashAt: number; ack: number; life: number };
export type Snapshot = { code: string; mode: RoomMode; phase: Phase; host: string; now: number; startedAt: number; endsAt: number; players: PublicPlayer[]; cell: boolean; cellAt: number; winner: string | null; reason: string; match: number };
export type Shot = { shooter: string; from: Vec3; to: Vec3; hit: string | null; damage: boolean; phased: boolean };
export type GameEvent = { type: 'shot'; shot: Shot } | { type: 'kill'; killer: string; victim: string } | { type: 'cell'; player: string } | { type: 'respawn'; player: string };
export type Reply = { ok: boolean; error?: string; id?: string; token?: string; snapshot?: Snapshot };
export const HOW_TO = [
  'Play solo against 3 labeled bots, or join a multiplayer room from your own device.',
  'Move with WASD or the left stick; aim with the mouse or right drag; click or press Fire to shoot.',
  'The Pulse Rifle hits instantly. Three hits eliminate an operator.',
  'Downed operators return after 5 seconds, with 1 second of protection.',
  'Dash with Shift or Dash. Touch the Phase Cell in the center for 4 seconds of phasing.',
  'First to 10 eliminations wins. Otherwise, most eliminations after 3 minutes wins.',
  'In multiplayer, disconnecting removes you from the match. The last connected player wins if everyone else leaves.',
];
export const SOLO_HOW_TO = HOW_TO.map((rule, index) => index === 0 ? 'Solo practice: you versus 3 computer-controlled operators, always labeled BOT.' : index === 6 ? 'Leaving or disconnecting ends your solo session. Return to the solo lobby after a match to play again.' : rule);
