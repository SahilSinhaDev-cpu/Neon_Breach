import type { Input, PublicPlayer } from '../shared/protocol';
import { BOXES, RULES, clamp, move, rayBox, validPosition } from '../shared/world';

type Point = { x: number; z: number };
export type BotBrain = {
  life: number;
  target: string | null;
  reactAt: number;
  decideAt: number;
  fireAt: number;
  waypoint: Point;
};
export function createBrain(p: PublicPlayer, now: number): BotBrain {
  return { life: p.life, target: null, reactAt: now + 800, decideAt: 0, fireAt: now + 800, waypoint: { x: p.x, z: p.z } };
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function clearWalk(a: Point, b: Point) {
  const end = move(a.x, a.z, b.x - a.x, b.z - a.z, true);
  return distance(end, b) < 0.001;
}
export function canSee(a: Point, b: Point) {
  const length = distance(a, b);
  if (length < 0.01) return true;
  const direction = { x: (b.x - a.x) / length, y: 0, z: (b.z - a.z) / length };
  return BOXES.every(box => rayBox({ x: a.x, y: RULES.eye, z: a.z }, direction, box) >= length);
}

// One shared navigation graph. Edges use the same collision function as player movement.
const nodes: Point[] = [];
for (let x = -18; x <= 18; x += 2) for (let z = -18; z <= 18; z += 2) if (validPosition(x, z)) nodes.push({ x, z });
const neighbors = nodes.map(a => nodes.flatMap((b, index) => distance(a, b) <= 2.01 && a !== b && clearWalk(a, b) ? [index] : []));
function nearestVisible(point: Point) {
  return nodes.map((node, index) => ({ node, index, distance: distance(node, point) }))
    .sort((a, b) => a.distance - b.distance).find(candidate => clearWalk(point, candidate.node))?.index ?? -1;
}
export function waypointToward(from: Point, goal: Point): Point {
  if (clearWalk(from, goal)) return { ...goal };
  const start = nearestVisible(from), end = nearestVisible(goal);
  if (start < 0 || end < 0) return { ...from };
  const queue = [start], parent = new Map<number, number>([[start, -1]]);
  for (let i = 0; i < queue.length && !parent.has(end); i++) {
    for (const next of neighbors[queue[i]]) if (!parent.has(next)) { parent.set(next, queue[i]); queue.push(next); }
  }
  if (!parent.has(end)) return { ...from };
  const path: number[] = [];
  for (let at = end; at !== -1; at = parent.get(at)!) path.push(at);
  // Smooth the grid route by taking the farthest reachable point on it.
  return nodes[path.find(index => clearWalk(from, nodes[index])) ?? start];
}

export function botInput(p: PublicPlayer, players: PublicPlayer[], cell: boolean, brain: BotBrain, now: number, dt: number): Input {
  const opponents = players.filter(q => q.id !== p.id && q.connected && q.hp > 0);
  let target = opponents.find(q => q.id === brain.target);
  if (now >= brain.decideAt || !target) {
    const ordered = [...opponents].sort((a, b) => distance(p, a) - distance(p, b) || a.order - b.order);
    const visible = ordered.find(q => canSee(p, q));
    target = target && canSee(p, target) ? target : visible ?? ordered[0];
    if ((target?.id ?? null) !== brain.target) {
      brain.target = target?.id ?? null;
      brain.reactAt = now + 650 + p.order * 70;
    }
    const goal = cell && distance(p, { x: 0, z: 0 }) < 15 ? { x: 0, z: 0 } : target ?? { x: 0, z: 0 };
    brain.waypoint = waypointToward(p, goal);
    brain.decideAt = now + 400;
  }
  const visible = !!target && canSee(p, target), range = target ? distance(p, target) : Infinity;
  const pursuingCell = cell && distance(p, { x: 0, z: 0 }) < 15;
  const facing = target && visible ? target : brain.waypoint;
  const idealYaw = Math.atan2(p.x - facing.x, p.z - facing.z);
  // Predictable oscillation deliberately adds error; bots never snap instantly onto a target.
  const error = visible ? Math.sin(now * 0.0021 + p.order * 1.7) * 0.075 : 0;
  const yaw = angleDelta(p.yaw + clamp(angleDelta(idealYaw + error, p.yaw), -2.8 * dt, 2.8 * dt), 0);
  let mx = 0, my = 0;
  if (visible && range <= 11 && !pursuingCell) {
    mx = (Math.floor((now + p.order * 900) / 2300) % 2 ? -1 : 1) * 0.4;
    my = range < 6 ? -0.4 : range > 9 ? 0.35 : 0;
  } else {
    const dx = brain.waypoint.x - p.x, dz = brain.waypoint.z - p.z, length = Math.hypot(dx, dz);
    if (length > 0.15) {
      mx = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / length * 0.72;
      my = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / length * 0.72;
    }
  }
  const fire = visible && range < 24 && now >= brain.reactAt && now >= brain.fireAt
    && now >= p.protectUntil && now >= target!.protectUntil && Math.abs(angleDelta(idealYaw, yaw)) < 0.09;
  if (fire) brain.fireAt = now + 650;
  return { seq: p.ack + 1, life: p.life, mx, my, yaw, pitch: 0, fire, dash: false };
}
