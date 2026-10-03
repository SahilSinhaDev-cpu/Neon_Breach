// Test-only freeze-frame studio using the same Arena, rifles, suits and VFX as production.
import * as T from 'three';
import { Arena } from '../client/scene';
import { riflePose } from '../client/weapon';
import { PULSE, pulseFrame, impactSurface } from '../client/pulse-motion';
import { PulseEffects } from '../client/pulse-vfx';
import type { Shot, PublicPlayer } from '../shared/protocol';

const arena = new Arena(document.querySelector('canvas')!);
const target: PublicPlayer = { id: 'TARGET', name: 'QA', color: '#ff68c6', order: 1, connected: true, bot: false, x: -12, z: 4, yaw: Math.PI / 2, pitch: 0, hp: 100, score: 0, scoreAt: 0, deaths: 0, respawnAt: 0, protectUntil: 0, phaseUntil: 0, dashAt: 0, ack: 0, life: 1 };
const operator = arena.operator(target); let life = 1;
function shotFor(mode: string, distance: number, phased: boolean): Shot {
  if (mode === 'remote') return { shooter: 'TARGET', from: { x: -12, y: 1.6, z: 14 - distance }, to: { x: -20, y: 1.6, z: 14 - distance }, hit: null, damage: false, phased };
  if (mode === 'metal') return { shooter: 'SELF', from: { x: -12, y: 1.6, z: -16 }, to: { x: -12, y: 1.6, z: -20 }, hit: null, damage: false, phased };
  if (mode === 'composite') return { shooter: 'SELF', from: { x: 0, y: 1.6, z: 2 }, to: { x: 0, y: 1.6, z: -4.1 }, hit: null, damage: false, phased };
  return { shooter: 'SELF', from: { x: -12, y: 1.6, z: 14 }, to: { x: -12, y: 1.6, z: 14 - distance + .42 }, hit: 'TARGET', damage: true, phased };
}
function frame(mode = 'own', distance = 10, age = .029, phased = false, aspect = innerWidth / innerHeight) {
  arena.pulses.clear(); arena.rifle.reset(); operator.rifle.reset(); arena.camera.aspect = aspect; arena.camera.updateProjectionMatrix(); arena.camera.rotation.set(0, 0, 0); arena.camera.position.set(mode === 'composite' ? 0 : -12, 1.6, mode === 'composite' ? 2 : mode === 'metal' ? -16 : 14);
  const pose = riflePose(aspect); arena.weapon.position.set(pose.x, pose.y, pose.z); arena.weapon.rotation.set(0, pose.yaw, pose.roll); arena.weapon.visible = true; arena.cell.visible = phased;
  operator.root.position.set(-12, 0, 14 - distance); operator.sync(100, ++life, 0, 0, Math.PI / 2); operator.animate(1 / 60, age, 0, 0, Math.PI / 2, 0, phased, false); operator.root.visible = true;
  if (mode === 'remote') operator.rifle.fire(0); else arena.rifle.fire(0);
  arena.rifle.update(age); operator.rifle.update(age); arena.scene.updateMatrixWorld(true);
  const shot = shotFor(mode, distance, phased), muzzle = new T.Vector3(); (mode === 'remote' ? operator.rifle.muzzle : arena.muzzle).getWorldPosition(muzzle); arena.pulses.add(shot, muzzle, 0); arena.pulses.update(age); arena.renderer.render(arena.scene, arena.camera);
  return { age, mode, distance, phased, pool: arena.pulses.audit() };
}
function audit() {
  const obstruction: string[] = [], ray = new T.Raycaster();
  for (const aspect of [16 / 10, 844 / 390, 390 / 844]) for (const age of [.012, .029, .048, .095]) {
    frame('own', 10, age, false, aspect); arena.scene.updateMatrixWorld(true);
    for (const x of [-.045, 0, .045]) for (const y of [-.045, 0, .045]) { ray.setFromCamera(new T.Vector2(x, y), arena.camera); const hits = ray.intersectObject(arena.weapon, true).filter(hit => { let object: T.Object3D | null = hit.object; while (object) { if (!object.visible) return false; object = object.parent; } return true; }); if (hits.length) obstruction.push(`${aspect}/${age}/${x}/${y}`); }
  }
  arena.pulses.clear(); const initial = arena.pulses.audit(), shot = shotFor('own', 24, false), muzzle = new T.Vector3(-11.85, 1.36, 12.4), memoryBefore = { ...arena.renderer.info.memory };
  const kinds = ['own', 'metal', 'composite'];
  for (let i = 0; i < 80; i++) { arena.pulses.add(shotFor(kinds[i % 3], 10, !!(i % 2)), muzzle, i * .4); arena.pulses.update(i * .4 + .39); } arena.pulses.clear(); const repeated = arena.pulses.audit();
  for (let i = 0; i < 32; i++) arena.pulses.add(shotFor(kinds[i % 3], 24, !!(i % 2)), muzzle, 100); const crowded = arena.pulses.audit(); arena.pulses.update(100.029); arena.renderer.render(arena.scene, arena.camera); const memoryDuring = { ...arena.renderer.info.memory }; arena.pulses.update(101); arena.renderer.render(arena.scene, arena.camera); const drained = arena.pulses.audit(), memoryAfter = { ...arena.renderer.info.memory };
  const cleanupScene = new T.Scene(), cleanupPool = new PulseEffects(cleanupScene), geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(); let disposedGeometries = 0, disposedMaterials = 0;
  cleanupScene.traverse(object => { if (object instanceof T.Mesh) { geometries.add(object.geometry); materials.add(object.material as T.Material); } }); geometries.forEach(geometry => geometry.addEventListener('dispose', () => disposedGeometries++)); materials.forEach(material => material.addEventListener('dispose', () => disposedMaterials++)); cleanupPool.dispose();
  const cleanup = { objectsRemaining: cleanupScene.children.length, disposedGeometries, disposedMaterials };
  const surfaces = kinds.map(mode => ({ mode, ...impactSurface(shotFor(mode, 10, false)) }));
  function readState(mode: string, phased: boolean) {
    arena.pulses.clear(); const shot = shotFor(mode, 10, phased), origin = arena.pulses.add(shot, muzzle, 0)!; const distance = Math.hypot(shot.to.x - origin.x, shot.to.y - origin.y, shot.to.z - origin.z); arena.pulses.update(PULSE.release + distance / PULSE.speed + .025);
    const group = arena.scene.children.find(object => object.name === 'Contained pulse / 0')!, contact = group.children[0], head = group.children[1] as T.Mesh, flash = contact.children[0] as T.Mesh;
    return { headScale: head.scale.toArray(), headOpacity: (head.material as T.ShaderMaterial).uniforms.opacity.value, flashColor: (flash.material as T.ShaderMaterial).uniforms.color.value.getHexString(), flashOpacity: (flash.material as T.ShaderMaterial).uniforms.opacity.value, streaksVisible: contact.children.slice(2).filter(object => object.visible).length };
  }
  const restoration = { normalBefore: readState('own', false), phased: readState('own', true), metal: readState('metal', false), composite: readState('composite', true), normalAfter: readState('own', false) };
  const timing = [.017, .018, .078, .138, .2, .5].map(age => ({ age, ...pulseFrame(24, age) })); frame(); return { obstruction, constants: PULSE, pool: { initial, repeated, crowded, drained }, memory: { before: memoryBefore, during: memoryDuring, after: memoryAfter }, cleanup, surfaces, restoration, timing };
}
Object.assign(window, { vfxQA: { frame, audit } }); frame();
