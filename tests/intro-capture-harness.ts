import * as T from 'three';
import { Arena } from '../client/scene';
import { OperatorModel } from '../client/models';
import { LOBBY_CAMERA } from '../client/lobby-camera';
import { validPosition, rayBox, BOXES } from '../shared/world';
import type { Shot } from '../shared/protocol';

// Offline capture only: existing game assets and renderer, with staged cameras.
// Never imported by the production bundle; no client-facing capture API.
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const arena = new Arena(canvas), camera = arena.camera, scene = arena.scene;
arena.renderer.setPixelRatio(1); arena.renderer.setSize(1920, 1080);
camera.aspect = 16 / 9; camera.updateProjectionMatrix(); arena.weapon.visible = false;
const cyan = new OperatorModel('#73fbd3', 0), magenta = new OperatorModel('#ff68c6', 1);
cyan.root.position.set(11.8, 0, 10.4); magenta.root.position.set(11.8, 0, 1.4);
scene.add(cyan.root, magenta.root);
const black = document.getElementById('black')!, title = document.getElementById('title')!;
const ease = (x: number) => { const t = T.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lerp = T.MathUtils.lerp;
const cameraAt = (p: T.Vector3, look: T.Vector3) => { camera.position.copy(p); camera.lookAt(look); };
const lobby = new T.Vector3(LOBBY_CAMERA.position.x, LOBBY_CAMERA.position.y, LOBBY_CAMERA.position.z);
const lobbyTarget = new T.Vector3(LOBBY_CAMERA.target.x, LOBBY_CAMERA.target.y, LOBBY_CAMERA.target.z);
const gunTime = 6.85;
let previous = -1, fired = false;
function fadeActor(actor: OperatorModel, alpha: number) {
  actor.root.visible = alpha > .001;
  actor.body.traverse(object => { if (object instanceof T.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    const old = material.userData.captureBase ??= { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
    material.opacity = old.opacity * alpha; material.transparent = alpha < .999 || old.transparent; material.depthWrite = alpha < .999 ? false : old.depthWrite;
  } });
}
function frame(t: number) {
  const dt = previous < 0 || t < previous ? 1 / 30 : Math.min(1 / 30, t - previous);
  if (t < previous || previous < 0) { fired = false; arena.pulses.clear(); cyan.sync(100, 1, 0, 0, Math.PI); magenta.sync(100, 1, 0, 0, Math.PI); cyan.rifle.reset(); magenta.rifle.reset(); }
  previous = t;
  camera.fov = t >= 5 && t < 8.5 ? 55 : 78; camera.updateProjectionMatrix();
  cyan.root.rotation.y = t < 5 ? Math.PI : 0;
  cyan.animate(dt, t, 0, 0, t < 5 ? Math.PI : 0, 0, false, false);
  magenta.root.rotation.y = Math.PI; magenta.animate(dt, t, 0, 0, Math.PI, 0, false, false);
  // Use the original articulated rig: lower, then smoothly shoulder the rifle.
  cyan.arms.rotation.x -= .46 * (1 - ease((t - 5) / 1.25));
  cyan.arms.updateMatrixWorld(true);
  if (t < 2) {
    cameraAt(new T.Vector3(11.8, 1.648, 10.82), new T.Vector3(11.8, 1.648, 10.4));
  } else if (t < 5) {
    const f = ease((t - 2) / 3);
    cameraAt(new T.Vector3(11.8, lerp(1.648, 1.6, f), lerp(10.82, 13, f)), new T.Vector3(lerp(11.8, 0, f), lerp(1.648, 1.5, f), lerp(10.4, -2, f)));
  } else if (t < 8.5) {
    const f = ease((t - 5) / 3.5);
    // Short shoulder-level drift keeps the rifle inside the phone's center
    // crop while the exposed opponent and firing lane remain in the wide view.
    cameraAt(new T.Vector3(14.5 - .25 * f, 1.5, 11.65 - .18 * f), new T.Vector3(11.8, 1.42, 9.5));
  } else if (t < 10.15) {
    // Second operator's same sealed human helmet, with its actual magenta rim.
    cameraAt(new T.Vector3(11.81, 1.648, 1.92), new T.Vector3(11.8, 1.645, 1.4));
  } else {
    cameraAt(lobby, lobbyTarget);
  }
  scene.updateMatrixWorld(true);
  if (t >= gunTime && !fired) {
    fired = true; cyan.fire(gunTime);
    const muzzle = cyan.rifle.muzzle.getWorldPosition(new T.Vector3());
    const shot: Shot = { shooter: 'cyan', from: { x: 11.8, y: 1.6, z: 10.4 }, to: { x: 11.8, y: 1.4, z: 1.82 }, hit: 'magenta', damage: true, phased: false };
    arena.pulses.add(shot, muzzle, gunTime);
  }
  cyan.rifle.update(t); magenta.rifle.update(t); arena.pulses.update(t);
  arena.cell.visible = true; arena.cell.children[0].rotation.y = t * .6;
  arena.cell.children[0].position.y = 1.15 + Math.sin(t * 2) * .12;
  const swell = Math.exp(-(((t - 10.6) / .35) ** 2));
  (arena.beam.material as T.MeshBasicMaterial).opacity = .18 + Math.sin(t * 3) * .035 + swell * .19;
  arena.environment.update(t);
  const alpha = 1 - ease((t - 16) / 1.1); fadeActor(cyan, alpha); fadeActor(magenta, alpha);
  black.style.opacity = String(1 - ease((t - .25) / 1.25));
  title.style.opacity = String(ease((t - 12) / .55) * (1 - ease((t - 16) / 1)));
  arena.renderer.render(scene, camera);
  return { t, eye: camera.position.y, camera: camera.position.toArray(), validCamera: validPosition(camera.position.x, camera.position.z), phaseBeam: (arena.beam.material as T.MeshBasicMaterial).opacity, title: Number(title.style.opacity), pulse: arena.pulses.audit() };
}
function audit() {
  const o = new T.Vector3(11.8, 1.6, 10.4), direction = new T.Vector3(0, 0, -1);
  const blocked = BOXES.filter(box => rayBox(o, direction, box) < 8.58);
  const p = frame(17.9666666667);
  const safe = document.getElementById('title-text')!.getBoundingClientRect();
  const tagline = document.getElementById('tagline')!.getBoundingClientRect();
  return { shotCorridorClear: blocked.length === 0, finalPose: p.camera, finalTarget: lobbyTarget.toArray(), finalActorsVisible: cyan.root.visible || magenta.root.visible, titleWidth: Math.max(safe.width, document.getElementById('title-text')!.scrollWidth), taglineWidth: Math.max(tagline.width, document.getElementById('tagline')!.scrollWidth), gameModels: [cyan.root.name, cyan.rifle.root.name, arena.environment.root.name], format: { width: 1920, height: 1080, fps: 30, seconds: 18, frames: 540 }, footage: 'Existing game renderer, geometry, materials and effects; staged in-engine camera and operator poses. No generated stand-in.' };
}
Object.assign(window, { introCapture: { frame, audit } }); frame(0);
