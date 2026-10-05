import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RULES, move, movement } from '../shared/world';
import type { PublicPlayer, Shot, Snapshot } from '../shared/protocol';
import type { Controls } from './controls';
import { createPulseRifle, OperatorModel, type Rifle } from './models';
import { riflePose } from './weapon';
import { ShatteredRelay } from './environment';
import { PulseEffects } from './pulse-vfx';
import { localCorrection, predictionLead, remotePose, smoothRemotePosition } from './network-motion';
import { LOBBY_CAMERA } from './lobby-camera';
import { initialPixelRatio, RenderBudget } from './render-quality';

const material = (color: number | string, emissive = 0, opacity = 1) => new T.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.55, emissive, emissiveIntensity: 0.7, transparent: opacity < 1, opacity });
export class Arena {
  renderer: T.WebGLRenderer; scene = new T.Scene(); camera = new T.PerspectiveCamera(78, innerWidth / innerHeight, 0.07, 180);
  operators = new Map<string, OperatorModel>(); pulses: PulseEffects;
  private blockedMuzzles = new Map<string, number>();
  cell = new T.Group(); beam: T.Mesh; rifle: Rifle; weapon: T.Group; muzzle: T.Object3D; muzzleFlash: T.Group;
  environment: ShatteredRelay; private budget = new RenderBudget(performance.now());
  private lastAim = { yaw: 0, pitch: 0 }; private sway = { x: 0, y: 0 }; private gait = 0; private dashVisualUntil = 0;
  private networkLead = 0;
  snapshot: Snapshot | null = null; history: { state: Snapshot; at: number }[] = [];
  local = { x: 0, z: 0 }; correction = { x: 0, z: 0 }; localId = ''; playing = false; kick = 0; lastFrame = performance.now(); initialized = false; lastLife = 0;
  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(initialPixelRatio(devicePixelRatio, innerWidth, innerHeight, matchMedia('(pointer: coarse)').matches)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor('#071019'); this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    // A small, generated studio environment gives curved armor and machined
    // edges useful reflections without external artwork or expensive shadows.
    const environment = new RoomEnvironment(), pmrem = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, 0.04, 0.1, 60).texture; this.scene.environmentIntensity = 0.38;
    environment.dispose(); pmrem.dispose();
    this.scene.fog = new T.Fog('#071019', 22, 85);
    this.scene.add(new T.HemisphereLight('#a9bec9', '#28323b', 1.8));
    const key = new T.DirectionalLight('#c4d5dc', 2.3); key.position.set(-6, 15, 5); this.scene.add(key);
    const cool = new T.PointLight('#6ab1d8', 24, 23, 2); cool.position.set(-14, 3.6, 0); this.scene.add(cool);
    const emergency = new T.PointLight('#d9a067', 18, 23, 2); emergency.position.set(14, 3.6, 0); this.scene.add(emergency);
    // The cell/core glow is emissive and needs no third per-pixel point light.
    this.environment = new ShatteredRelay(this.scene);
    this.pulses = new PulseEffects(this.scene);
    const crystal = new T.Mesh(new T.OctahedronGeometry(0.45), material('#9affdf', 0x62ffcd)); crystal.position.y = 1.15; this.cell.add(crystal);
    this.beam = new T.Mesh(new T.CylinderGeometry(0.12, 0.32, 5.2, 16, 1, true), new T.MeshBasicMaterial({ color: '#73fbd3', transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending })); this.beam.position.y = 2.6; this.cell.add(this.beam); this.scene.add(this.cell);
    const rifle = this.rifle = createPulseRifle(true); this.weapon = rifle.root; this.muzzle = rifle.muzzle; this.muzzleFlash = rifle.flash;
    const pose = riflePose(this.camera.aspect); this.weapon.position.set(pose.x, pose.y, pose.z); this.weapon.rotation.set(0, pose.yaw, pose.roll); this.camera.add(this.weapon); this.scene.add(this.camera);
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setPixelRatio(Math.min(this.renderer.getPixelRatio(), initialPixelRatio(devicePixelRatio, innerWidth, innerHeight, matchMedia('(pointer: coarse)').matches))); this.renderer.setSize(innerWidth, innerHeight); });
  }
  operator(p: PublicPlayer) {
    const model = new OperatorModel(p.color, p.order); this.scene.add(model.root); this.operators.set(p.id, model); return model;
  }
  accept(s: Snapshot, id: string, controls: Controls, latency: number) {
    const p = s.players.find(p => p.id === id); this.localId = id;
    const newMatch = !this.snapshot || this.snapshot.match !== s.match || this.snapshot.phase !== 'playing';
    const newLife = p?.life !== this.snapshot?.players.find(p => p.id === id)?.life;
    if (newMatch || s.phase !== 'playing') { this.pulses.clear(); this.blockedMuzzles.clear(); this.history = []; }
    if (newMatch || newLife) { this.rifle.reset(); this.kick = 0; this.dashVisualUntil = 0; }
    else if (p && p.dashAt > (this.snapshot?.players.find(q => q.id === id)?.dashAt ?? 0)) this.dashVisualUntil = performance.now() + 420;
    if (p) this.rifle.setOperatorColor(p.color);
    this.snapshot = s; this.playing = s.phase === 'playing' && !p?.inLobby;
    this.networkLead = predictionLead(latency);
    this.history.push({ state: s, at: performance.now() }); while (this.history.length > 8) this.history.shift();
    if (p && this.playing) {
      controls.life = p.life;
      if (newMatch || !this.initialized || newLife || (p.hp > 0 && this.lastLife <= 0)) { this.local = { x: p.x, z: p.z }; controls.yaw = p.yaw; controls.pitch = p.pitch; this.lastAim = { yaw: p.yaw, pitch: p.pitch }; this.sway = { x: 0, y: 0 }; this.initialized = true; }
      this.correction = localCorrection(p, controls.sample(0), latency);
      if (Math.hypot(this.local.x - p.x, this.local.z - p.z) > 3) this.local = { ...this.correction };
      this.lastLife = p.hp;
    }
  }
  shot(shot: Shot) {
    const now = performance.now(); const own = shot.shooter === this.localId;
    if (shot.hit && shot.damage) this.operators.get(shot.hit)?.hit(now / 1000);
    if (own) { this.kick = 1; this.rifle.fire(now / 1000); }
    else this.operators.get(shot.shooter)?.fire(now / 1000);
    const start = new T.Vector3(shot.from.x, shot.from.y, shot.from.z);
    const muzzle = own ? this.muzzle : this.operators.get(shot.shooter)?.rifle.muzzle;
    if (muzzle) muzzle.getWorldPosition(start);
    const origin = this.pulses.add(shot, start, now / 1000);
    if (origin?.suppressMuzzle) this.blockedMuzzles.set(shot.shooter, now + 130);
  }

  render(controls: Controls, serverNow: number) {
    const now = performance.now(), dt = Math.min((now - this.lastFrame) / 1000, 0.05); this.lastFrame = now;
    const p = this.snapshot?.players.find(p => p.id === this.localId);
    if (this.playing && p) {
      const input = controls.sample(0);
      if (p.hp > 0) {
        const delta = movement(input.mx, input.my, controls.yaw, RULES.speed * dt); this.local = move(this.local.x, this.local.z, delta.x, delta.z); this.correction = move(this.correction.x, this.correction.z, delta.x, delta.z);
      }
      const blend = 1 - Math.exp(-14 * dt), tx = this.local.x + (this.correction.x - this.local.x) * blend, tz = this.local.z + (this.correction.z - this.local.z) * blend;
      this.local = move(this.local.x, this.local.z, tx - this.local.x, tz - this.local.z);
      this.camera.position.set(this.local.x, p.hp > 0 ? RULES.eye : 0.6, this.local.z); this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(controls.pitch + this.kick * 0.012, controls.yaw, 0);
      const moving = p.hp > 0 ? Math.min(Math.hypot(input.mx, input.my), 1) : 0;
      this.gait += dt * moving * 11;
      const yawDelta = Math.atan2(Math.sin(controls.yaw - this.lastAim.yaw), Math.cos(controls.yaw - this.lastAim.yaw));
      const ease = 1 - Math.exp(-12 * dt);
      this.sway.x += (T.MathUtils.clamp(yawDelta * -0.7, -0.025, 0.025) - this.sway.x) * ease;
      this.sway.y += (T.MathUtils.clamp((controls.pitch - this.lastAim.pitch) * 0.7, -0.018, 0.018) - this.sway.y) * ease;
      this.lastAim = { yaw: controls.yaw, pitch: controls.pitch };
      this.weapon.visible = p.hp > 0;
      const pose = riflePose(this.camera.aspect), dash = Math.max(0, (this.dashVisualUntil - now) / 420);
      this.weapon.position.set(pose.x + this.sway.x + Math.sin(this.gait) * moving * 0.006, pose.y + this.sway.y + Math.cos(this.gait * 2) * moving * 0.005 + Math.sin(now * 0.0018) * 0.0015 - dash * .028, pose.z + this.kick * 0.025 + dash * .025);
      this.weapon.rotation.set(this.kick * 0.025 - dash * .06, pose.yaw + this.sway.x * 0.6, pose.roll + this.sway.x * -0.8);
    } else {
      const { position, target } = LOBBY_CAMERA;
      this.camera.position.set(position.x, position.y, position.z); this.camera.lookAt(target.x, target.y, target.z); this.weapon.visible = false;
    }
    this.rifle.update(now / 1000);
    if ((this.blockedMuzzles.get(this.localId) ?? 0) > now) this.rifle.flash.visible = false;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.cell.visible = !this.playing || !!this.snapshot?.cell; this.cell.children[0].rotation.y += dt; this.cell.children[0].position.y = 1.15 + Math.sin(now * 0.002) * 0.12;
    (this.beam.material as T.MeshBasicMaterial).opacity = 0.18 + Math.sin(now * 0.003) * 0.035;
    const renderAt = now - 100 + this.networkLead;
    for (const q of this.snapshot?.players ?? []) {
      if (q.id === this.localId) continue;
      const existing = this.operators.get(q.id);
      // Build rigs while the lobby is open so their construction does not
      // stall the first gameplay frame; skip their animation while hidden.
      const model = existing ?? this.operator(q);
      model.sync(q.hp, q.life, q.dashAt, now / 1000, q.yaw);
      model.root.visible = model.root.visible && this.playing && q.connected && !q.inLobby;
      if (!model.root.visible) continue;
      const pose = remotePose(this.history, q.id, renderAt);
      if (pose) {
        const position = !existing ? pose : smoothRemotePosition(model.root.position, pose, dt);
        model.root.position.set(position.x, 0, position.z);
        model.animate(dt, now / 1000, pose.vx, pose.vz, pose.yaw, pose.pitch, q.phaseUntil > serverNow, q.protectUntil > serverNow);
      }
      if ((this.blockedMuzzles.get(q.id) ?? 0) > now) model.rifle.flash.visible = false;
    }
    for (const [id, model] of this.operators) if (!this.snapshot?.players.some(p => p.id === id)) { this.dispose(model.root); this.operators.delete(id); }
    if (this.playing) this.pulses.update(now / 1000); else this.pulses.clear();
    for (const [id, until] of this.blockedMuzzles) if (now >= until) this.blockedMuzzles.delete(id);
    this.environment.update(now / 1000);
    // Reduce fill cost after sustained misses of the frame budget, before 30
    // FPS. All landmarks, colliders and enemy silhouettes stay present.
    if (this.budget.observe(now, !document.hidden)) {
      const ratio = this.renderer.getPixelRatio();
      if (ratio > .65) this.renderer.setPixelRatio(Math.max(.65, ratio * .85));
      this.environment.setReduced(true);
    }
    this.renderer.render(this.scene, this.camera);
  }
  dispose(object: T.Object3D) { this.scene.remove(object); const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>(); object.traverse(child => { if (child instanceof T.Mesh) { geometries.add(child.geometry); for (const m of Array.isArray(child.material) ? child.material : [child.material]) materials.add(m); } }); geometries.forEach(g => g.dispose()); materials.forEach(m => { for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value); m.dispose(); }); textures.forEach(t => t.dispose()); }
}
