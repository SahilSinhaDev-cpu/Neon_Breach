export type Vec3 = { x: number; y: number; z: number };
export type Box = { x: number; y: number; z: number; w: number; h: number; d: number; kind: 'wall' | 'pillar' | 'cover' | 'floor' | 'overhead' };
export const RULES = { tick: 1 / 60, snapshotMs: 50, speed: 6, radius: 0.42, eye: 1.6, height: 1.85, health: 100, damage: 34, fireMs: 280, respawnMs: 5000, protectMs: 1000, matchMs: 180000, target: 10, dashMeters: 6, dashMs: 3000, cellMs: 20000, phaseMs: 4000, inputStaleMs: 350 } as const;
export const COLORS = ['#73fbd3', '#ff68c6', '#ffc56b', '#87a2ff'];
export const BOXES: Box[] = [
  { x: 0, y: 3, z: -20.5, w: 42, h: 6, d: 1, kind: 'wall' },
  { x: 0, y: 3, z: 20.5, w: 42, h: 6, d: 1, kind: 'wall' },
  { x: -20.5, y: 3, z: 0, w: 1, h: 6, d: 40, kind: 'wall' },
  { x: 20.5, y: 3, z: 0, w: 1, h: 6, d: 40, kind: 'wall' },
  { x: 0, y: -0.25, z: 0, w: 42, h: 0.5, d: 42, kind: 'floor' },
  { x: 0, y: 6.25, z: 0, w: 42, h: 0.5, d: 42, kind: 'floor' },
  { x: -7, y: 3, z: -4, w: 3, h: 6, d: 3, kind: 'pillar' },
  { x: 7, y: 3, z: 4, w: 3, h: 6, d: 3, kind: 'pillar' },
  { x: 0, y: 0.9, z: -5, w: 6, h: 1.8, d: 1.8, kind: 'cover' },
  { x: 0, y: 0.9, z: 5, w: 6, h: 1.8, d: 1.8, kind: 'cover' },
  // Suspended relay frame and structural ribs. These stop upward shots, but
  // their bottom faces are above operators and do not obstruct the main floor.
  { x: -1.9, y: 4.6, z: 0, w: 0.4, h: 0.5, d: 4.2, kind: 'overhead' },
  { x: 1.9, y: 4.6, z: 0, w: 0.4, h: 0.5, d: 4.2, kind: 'overhead' },
  { x: 0, y: 4.6, z: -1.9, w: 3.4, h: 0.5, d: 0.4, kind: 'overhead' },
  { x: 0, y: 4.6, z: 1.9, w: 3.4, h: 0.5, d: 0.4, kind: 'overhead' },
  { x: 0, y: 5.65, z: 0, w: 2.4, h: 0.7, d: 2.4, kind: 'overhead' },
  ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * 1.9, y: 5.425, z: z * 1.9, w: 0.12, h: 1.15, d: 0.12, kind: 'overhead' as const }))),
  ...[-12, -4, 4, 12].map(z => ({ x: 0, y: 5.79, z, w: 40, h: 0.42, d: 0.48, kind: 'overhead' as const })),
  ...[-1, 1].map(side => ({ x: side * 19.65, y: 3.9, z: 0, w: 0.7, h: 0.5, d: 34, kind: 'overhead' as const })),
];
export const PADS = [{ x: -16, z: -16 }, { x: 16, z: 16 }, { x: 16, z: -16 }, { x: -16, z: 16 }];
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export function validPosition(x: number, z: number): boolean {
  if (Math.abs(x) > 20 - RULES.radius || Math.abs(z) > 20 - RULES.radius) return false;
  return !BOXES.some(b => b.kind !== 'floor' && b.y - b.h / 2 < RULES.height && b.y + b.h / 2 > 0 && Math.abs(x - b.x) < b.w / 2 + RULES.radius - 1e-7 && Math.abs(z - b.z) < b.d / 2 + RULES.radius - 1e-7);
}
// Substeps cannot tunnel through any obstacle. Normal walking slides; dash stops on first contact.
export function move(x: number, z: number, dx: number, dz: number, stop = false) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
  for (let i = 0; i < steps; i++) {
    const nx = x + dx / steps, nz = z + dz / steps;
    if (stop && !validPosition(nx, nz)) break;
    if (validPosition(nx, z)) x = nx;
    if (validPosition(x, nz)) z = nz;
  }
  return { x, z };
}
export function movement(mx: number, my: number, yaw: number, distance: number) {
  const norm = Math.max(1, Math.hypot(mx, my));
  return { x: (Math.cos(yaw) * mx - Math.sin(yaw) * my) / norm * distance, z: (-Math.sin(yaw) * mx - Math.cos(yaw) * my) / norm * distance };
}
export function aimDirection(yaw: number, pitch: number): Vec3 {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}
export function rayBox(o: Vec3, d: Vec3, b: Box): number {
  let near = 0, far = 100;
  for (const [axis, size] of [['x', 'w'], ['y', 'h'], ['z', 'd']] as const) {
    const lo = b[axis] - b[size] / 2, hi = b[axis] + b[size] / 2;
    if (Math.abs(d[axis]) < 1e-9) { if (o[axis] < lo || o[axis] > hi) return Infinity; }
    else { let a = (lo - o[axis]) / d[axis], c = (hi - o[axis]) / d[axis]; if (a > c) [a, c] = [c, a]; near = Math.max(near, a); far = Math.min(far, c); if (near > far) return Infinity; }
  }
  return near;
}
