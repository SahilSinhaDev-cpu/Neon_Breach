import { clamp, move, movement, RULES } from '../shared/world';
import type { Input, PublicPlayer, Snapshot } from '../shared/protocol';

export const MAX_PREDICTION_MS = 350;
export type TimedSnapshot = { state: Snapshot; at: number };
export type RemotePose = { x: number; z: number; yaw: number; pitch: number; vx: number; vz: number; discontinuity: boolean };

// HTTP snapshots are already partway through their round trip when created.
// Predict only a small, bounded portion of that age; authority stays on-server.
export function predictionLead(roundTripMs: number) {
  return Number.isFinite(roundTripMs) ? clamp(roundTripMs / 2, 0, MAX_PREDICTION_MS) : 0;
}
export function localCorrection(player: PublicPlayer, input: Input, roundTripMs: number) {
  if (player.hp <= 0) return { x: player.x, z: player.z };
  const delta = movement(input.mx, input.my, input.yaw, RULES.speed * predictionLead(roundTripMs) / 1000);
  return move(player.x, player.z, delta.x, delta.z);
}

export function motionDiscontinuity(previous: PublicPlayer, next: PublicPlayer, intervalMs: number) {
  return previous.life !== next.life || previous.hp <= 0 || next.hp <= 0
    || !previous.connected || !next.connected || next.dashAt > previous.dashAt
    || Math.hypot(next.x - previous.x, next.z - previous.z) > RULES.speed * Math.max(0, intervalMs) / 1000 + 0.15;
}

export function smoothRemotePosition(previous: { x: number; z: number }, target: RemotePose, dt: number) {
  if (target.discontinuity) return { x: target.x, z: target.z };
  const blend = 1 - Math.exp(-18 * Math.max(0, dt));
  const desired = { x: previous.x + (target.x - previous.x) * blend, z: previous.z + (target.z - previous.z) * blend };
  const position = move(previous.x, previous.z, desired.x - previous.x, desired.z - previous.z);
  // Sparse snapshots can omit a route around a pillar. Do not keep the model
  // trapped on the wrong side forever when the confirmed target is elsewhere.
  // Both endpoints remain valid; only the visual correction is discontinuous.
  if (Math.hypot(position.x - desired.x, position.z - desired.z) > 0.02) return { x: target.x, z: target.z };
  return position;
}

export function remotePose(history: TimedSnapshot[], id: string, renderAt: number): RemotePose | null {
  if (!history.length) return null;
  // When render time is past the latest snapshot, estimate velocity from the
  // latest TWO samples, never from the oldest sample in the retained history.
  let a = history[Math.max(0, history.length - 2)], b = history[history.length - 1];
  for (let i = 1; i < history.length; i++) if (history[i].at >= renderAt) { a = history[i - 1]; b = history[i]; break; }
  const next = b.state.players.find(player => player.id === id);
  if (!next) return null;
  const previous = a.state.players.find(player => player.id === id) ?? next;
  const interval = b.state.now - a.state.now;
  const discontinuity = a === b || a.state.match !== b.state.match || a.state.phase !== b.state.phase || motionDiscontinuity(previous, next, interval);
  if (discontinuity) return { x: next.x, z: next.z, yaw: next.yaw, pitch: next.pitch, vx: 0, vz: 0, discontinuity: true };

  const alpha = clamp((renderAt - a.at) / Math.max(1, b.at - a.at), 0, 1);
  let position = move(previous.x, previous.z, (next.x - previous.x) * alpha, (next.z - previous.z) * alpha);
  const seconds = Math.max(0.001, interval / 1000);
  let vx = (next.x - previous.x) / seconds, vz = (next.z - previous.z) / seconds;
  const speed = Math.hypot(vx, vz), scale = speed > RULES.speed ? RULES.speed / speed : 1;
  vx *= scale; vz *= scale;
  if (renderAt > b.at) {
    const extra = Math.min(renderAt - b.at, MAX_PREDICTION_MS) / 1000;
    position = move(next.x, next.z, vx * extra, vz * extra);
    if (renderAt - b.at > MAX_PREDICTION_MS) { vx = 0; vz = 0; }
  }
  return { ...position,
    yaw: previous.yaw + Math.atan2(Math.sin(next.yaw - previous.yaw), Math.cos(next.yaw - previous.yaw)) * alpha,
    pitch: previous.pitch + (next.pitch - previous.pitch) * alpha,
    vx, vz, discontinuity: false,
  };
}
