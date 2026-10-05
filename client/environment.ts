import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOXES, PADS } from '../shared/world';
import { floorLabel, hologramTexture, metalTexture, planetTexture, scorchTexture, signTexture } from './environment-textures';

const metal = (color: string, roughness = 0.65, metalness = 0.5) => new T.MeshStandardMaterial({ color, roughness, metalness });
const lit = (color: string, intensity = 0.6) => new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.44, metalness: 0.3 });
const paint = (color: string, opacity = 1) => new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

export class ShatteredRelay {
  readonly root = new T.Group(); readonly decorative = new T.Group(); readonly exterior = new T.Group();
  readonly collisionVisuals: T.Object3D[] = [];
  private arc: T.LineSegments; private sparks: T.Points; private emergency: T.MeshStandardMaterial;
  private holo: T.MeshBasicMaterial; private debris: T.Group[] = []; private exteriorFlash: T.Mesh;
  private reduced = false;
  constructor(scene: T.Scene) {
    this.root.name = 'SHATTERED RELAY'; this.decorative.name = 'Non-colliding surface paint and fixtures inside collision shells';
    this.decorative.userData.decorative = true; this.exterior.name = 'Visual-only exterior beyond sealed viewport'; this.exterior.userData.decorative = true;
    this.root.add(this.decorative, this.exterior); scene.add(this.root);
    const wall = new T.MeshStandardMaterial({ map: metalTexture('wall'), color: '#a5b8c2', metalness: 0.46, roughness: 0.79 });
    const floor = new T.MeshStandardMaterial({ map: metalTexture('floor'), color: '#b2c0c2', metalness: 0.35, roughness: 0.81 });
    const pillar = new T.MeshStandardMaterial({ map: metalTexture('pillar'), color: '#adbbc0', metalness: 0.55, roughness: 0.61 });
    const cover = new T.MeshStandardMaterial({ map: metalTexture('cover'), color: '#c3c7bf', metalness: 0.25, roughness: 0.76 });
    const frame = metal('#354b59', 0.55), dark = metal('#14212b', 0.85), edge = metal('#697e85', 0.46), ceiling = metal('#16222c', 0.87);
    const blue = lit('#509bd0', 0.45), amber = lit('#cd985b', 0.4), core = lit('#76c9af', 0.6), white = lit('#becbc5', 0.7);
    this.emergency = lit('#d49150', 0.7);
    // The collision shell is authoritative. Opaque solids are rendered directly
    // from shared BOXES, except the north wall's visibly sealed armored glass.
    for (const [index, b] of BOXES.entries()) {
      if (b.kind === 'wall') {
        const group = new T.Group(); group.name = b.z < -20 ? 'Armored viewport wall / sealed collision' : 'Pressure bulkhead';
        group.userData.colliderIndex = index; this.collisionVisuals.push(group); this.root.add(group);
        if (b.z < -20) {
          for (const side of [-1, 1]) for (let i = 0; i < 3; i++) this.box(4, 6, 1, side * (10 + i * 4), 3, -20.5, wall, group);
          this.box(16, 1.25, 1, 0, 0.625, -20.5, frame, group); this.box(16, 1.15, 1, 0, 5.425, -20.5, frame, group);
          const glass = new T.MeshBasicMaterial({ color: '#8ba8b1', transparent: true, opacity: 0.13, depthWrite: false, side: T.DoubleSide });
          this.plane(16, 3.6, 0, 3.05, -20, glass, 0, 0, 0, group).name = 'Armored glass: blocks movement and shots';
        } else if (Math.abs(b.z) > 20) {
          for (let i = -4; i <= 4; i++) this.box(40 / 9, 6, 1, i * 40 / 9, 3, b.z, wall, group);
        } else {
          for (let i = -4; i <= 4; i++) this.box(1, 6, 40 / 9, b.x, 3, i * 40 / 9, wall, group);
        }
      } else {
        const m = this.box(b.w, b.h, b.d, b.x, b.y, b.z, b.kind === 'floor' ? b.y < 0 ? floor : ceiling : b.kind === 'pillar' ? pillar : b.kind === 'cover' ? cover : b.h === 0.7 ? pillar : frame, this.root);
        m.name = `Shared solid / ${b.kind}`; m.userData.colliderIndex = index; this.collisionVisuals.push(m);
      }
    }

    // Wall architecture remains in the one-meter pressure shell, never intrudes
    // into the playable floor. Face decals are paint, not additional cover.
    for (const side of [-1, 1]) {
      const laneColor = side < 0 ? blue : amber;
      for (const z of [-16, -8, 0, 8, 16]) {
        this.box(0.54, 6, 0.35, side * 20.24, 3, z, frame);
        this.box(0.04, 1.95, 0.08, side * 20.005, 2.0, z - 0.06, edge);
        this.box(0.016, 0.34, 0.17, side * 19.99, 3.25, z, laneColor);
      }
      // Painted pipe runs and inspection bands on the colliding conduit housing.
      for (const y of [3.75, 3.87, 4.03]) this.box(0.008, 0.042, 33.9, side * 19.295, y, 0, edge);
      for (const z of [-14, -7, 0, 7, 14]) this.box(0.018, 0.48, 0.13, side * 19.292, 3.9, z, dark);
      this.sign(side < 0 ? 'BLUE SERVICE' : 'AMBER SERVICE', 'FLANK ROUTE  /  OBSERVATION ↔ CORE', 6.0, 1.5, side * 19.983, 2.45, side < 0 ? -1 : 0, side < 0 ? Math.PI / 2 : -Math.PI / 2, side < 0 ? '#8abbd5' : '#d6b388');
      this.floorStrip(0.065, 36, side * 10.2, 0, laneColor);
      this.floorStrip(0.038, 36, side * 14.2, 0, paint(side < 0 ? '#466477' : '#75674e'));
      for (const z of [-12, 12]) {
        this.floorText(side < 0 ? 'BLUE / SERVICE' : 'AMBER / SERVICE', 4, 1, side * 12.15, z, z < 0 ? Math.PI : 0, side < 0 ? '#8cabb7aa' : '#b4a27daa');
      }
      this.sign('OBSERVATION', side < 0 ? 'NORTH / ARMORED VIEWPORT' : 'SOUTH / PRESSURE DOOR', 6, 1.0, side * 13, 4.85, side * 19.982, side < 0 ? 0 : Math.PI, '#aabdc3');
      for (const x of [-16, 16]) this.box(2.7, 0.045, 0.03, x, 2.8, side * 19.98, white);
    }

    // Central banks and thermal columns have clear hard silhouettes. Their
    // panel, warning, and damage details sit flush on the existing solid faces.
    const scorch = new T.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    for (const b of BOXES.filter(b => b.kind === 'cover')) {
      for (const side of [-1, 1]) {
        this.box(b.w, 0.06, 0.012, 0, 1.77, b.z + side * 0.903, edge);
        this.box(1.65, 0.022, 0.014, side * 1.78, 1.69, b.z + side * 0.908, core);
        this.plane(2.15, 1.45, side * 1.65, 0.91, b.z + side * 0.914, scorch, 0, side < 0 ? Math.PI : 0);
        this.hazards(0, 0.11, b.z + side * 0.913, 5.7, side < 0 ? Math.PI : 0, amber);
      }
      this.plane(5.8, 1.65, 0, 1.807, b.z, new T.MeshBasicMaterial({ map: floorLabel('POWER ISOLATED', '#a8b4a2aa'), transparent: true, depthWrite: false }), -Math.PI / 2, 0, 0);
      this.plane(3.5, 2.4, 1.1, 0.009, b.z + Math.sign(b.z) * 1.75, scorch, -Math.PI / 2, 0, -0.4);
    }
    for (const b of BOXES.filter(b => b.kind === 'pillar')) {
      const lane = b.x < 0 ? blue : amber;
      for (const side of [-1, 1]) {
        this.box(0.105, 5.8, 0.014, b.x + side * 1.43, 2.95, b.z + 1.507, frame);
        this.box(0.035, 2.9, 0.017, b.x + side * 1.38, 2.0, b.z + 1.516, lane);
        this.box(0.035, 2.9, 0.017, b.x + side * 1.38, 2.0, b.z - 1.516, lane);
        this.box(3.0, 0.12, 0.015, b.x, 4.55, b.z + side * 1.51, lane);
        this.sign(b.x < 0 ? 'EXCHANGER / A' : 'EXCHANGER / B', 'COOLANT SYSTEM  /  HIGH PRESSURE', 2.45, 0.61, b.x, 3.65, b.z + side * 1.516, side > 0 ? 0 : Math.PI, '#9aafb0');
      }
      this.plane(2.0, 2.5, b.x + (b.x < 0 ? 1.51 : -1.51), 1.3, b.z - 0.2, scorch, 0, b.x < 0 ? Math.PI / 2 : -Math.PI / 2);
    }

    // Core paint and suspended transmission assembly: an open central aperture.
    for (const radius of [1.35, 2.8, 3.05]) {
      const ring = new T.Mesh(new T.RingGeometry(radius, radius + 0.04, 64), paint(radius < 2 ? '#7cbaa7' : '#4c6c6d')); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.008; this.decorative.add(ring);
    }
    for (const side of [-1, 1]) {
      this.floorStrip(5.8, 0.04, side * 6.4, 0, core);
      this.floorText('RELAY CORE', 4.6, 1.15, side * 5.7, 0, side < 0 ? -Math.PI / 2 : Math.PI / 2, '#a5c3b8cc');
      this.box(0.025, 0.2, 4.1, side * 2.105, 4.6, 0, core);
      this.box(3.35, 0.035, 0.035, 0, 4.343, side * 1.9, core);
      this.plane(1.25, 0.48, side * 0.85, 4.6, side * 2.111, scorch, 0, side > 0 ? 0 : Math.PI);
      this.sign('RELAY / 07', 'TRANSMISSION ARRAY  /  SIGNAL LOST', 2.8, 0.39, 0, 4.62, side * 2.108, side > 0 ? 0 : Math.PI, '#b5cebc');
      for (const z of [-12, -4, 4, 12]) {
        this.box(6.4, 0.016, 0.19, side * 10.7, 5.574, z, white);
        // Clamps are entirely inside the shared rib envelope.
        this.box(0.23, 0.4, 0.485, side * 15, 5.79, z, dark);
      }
    }
    // Flush cabling diagrams and inspection plates on the relay's solid cap.
    this.box(1.9, 0.011, 1.9, 0, 5.294, 0, dark);
    for (const x of [-0.68, -0.34, 0.34, 0.68]) this.box(0.027, 0.012, 1.7, x, 5.285, 0, core);

    for (const [i, p] of PADS.entries()) {
      const ring = new T.Mesh(new T.RingGeometry(1.15, 1.2, 32), paint('#a0b8b7', 0.7)); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.01, p.z); this.decorative.add(ring);
      this.floorText(`OBS / 0${i + 1}`, 2.3, 0.58, p.x, p.z + (p.z > 0 ? 1.8 : -1.8), p.z > 0 ? 0 : Math.PI, '#b1c4b9aa');
    }

    this.viewport(frame, edge, dark, white);
    this.blastDoor(frame, edge, dark, amber, scorch);
    // A broken but readable communications map anchored to the sealed wall.
    this.holo = new T.MeshBasicMaterial({ map: hologramTexture(), transparent: true, opacity: 0.88, depthWrite: false, toneMapped: false });
    this.plane(4.5, 2.25, 19.982, 2.1, 11.5, this.holo, 0, -Math.PI / 2);
    this.sign('UPLINK TERMINAL', 'NO CARRIER  /  LOCAL SYSTEMS ONLY', 3.6, 0.65, 19.98, 3.36, 11.5, -Math.PI / 2, '#d0af7b');
    this.plane(1.9, 1.7, 19.981, 2.65, -10.5, scorch, 0, -Math.PI / 2);
    this.sign('CONDUIT RUPTURE', 'DO NOT SERVICE WHILE ENERGIZED', 3.3, 0.83, 19.975, 2.36, -10.6, -Math.PI / 2, '#d4aa78');
    for (const z of [-11.7, -9.5]) this.box(0.018, 0.06, 0.23, 19.275, 4.04, z, this.emergency);

    this.plane(1.58, 0.32, 19.283, 3.9, -10.6, paint('#060e13'), 0, -Math.PI / 2);
    for (const z of [-11.1, -10.87, -10.25, -10.05]) this.box(0.012, 0.13, 0.037, 19.275, 3.82, z, amber);
    const arcPoints: number[] = [];
    for (let i = 0; i < 10; i++) { const z = -11.2 + i * 0.12, y = 3.88 + Math.sin(i * 4.2) * 0.14; arcPoints.push(19.27, y, z, 19.27, 3.88 + Math.sin((i + 1) * 4.2) * 0.14, z + 0.12); }
    const arcGeometry = new T.BufferGeometry(); arcGeometry.setAttribute('position', new T.Float32BufferAttribute(arcPoints, 3));
    this.arc = new T.LineSegments(arcGeometry, new T.LineBasicMaterial({ color: '#ffe1a9', transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false })); this.arc.userData.decorative = true; this.root.add(this.arc);
    const sparks = new Float32Array(12 * 3); const sparkGeometry = new T.BufferGeometry(); sparkGeometry.setAttribute('position', new T.BufferAttribute(sparks, 3));
    this.sparks = new T.Points(sparkGeometry, new T.PointsMaterial({ color: '#d7aa72', size: 0.025, transparent: true, opacity: 0.47, depthWrite: false })); this.sparks.userData.decorative = true; this.root.add(this.sparks);
    this.exteriorFlash = this.space();
    this.mergeDecorations();
    // Panels inside each pressure shell share one material/draw instead of one
    // draw per panel. The original shell group still maps to the shared collider.
    for (const shell of this.collisionVisuals) if (shell instanceof T.Group) this.mergeDecorations(shell);
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => {
      // Only exterior debris changes transforms. Paint, shells and fixtures
      // keep their baked world matrices, including invisible ceiling details.
      let parent: T.Object3D | null = o;
      while (parent && !this.debris.includes(parent as T.Group)) parent = parent.parent;
      if (!parent) { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; }
      else if (o instanceof T.Mesh) { o.updateMatrix(); o.matrixAutoUpdate = false; }
    });
  }
  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material, parent: T.Object3D = this.decorative) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m;
  }
  private plane(w: number, h: number, x: number, y: number, z: number, mat: T.Material, rx = 0, ry = 0, rz = 0, parent: T.Object3D = this.decorative) {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  }
  private sign(title: string, subtitle: string, w: number, h: number, x: number, y: number, z: number, yaw: number, color: string) {
    return this.plane(w, h, x, y, z, new T.MeshBasicMaterial({ map: signTexture(title, subtitle, color), side: T.DoubleSide }), 0, yaw);
  }
  private floorStrip(w: number, d: number, x: number, z: number, material: T.Material) { return this.plane(w, d, x, 0.006, z, material, -Math.PI / 2); }
  private floorText(text: string, w: number, d: number, x: number, z: number, yaw: number, color: string) {
    const m = this.floorStrip(w, d, x, z, new T.MeshBasicMaterial({ map: floorLabel(text, color), transparent: true, opacity: 0.68, depthWrite: false })); m.rotation.z = yaw; return m;
  }
  private hazards(x: number, y: number, z: number, width: number, yaw: number, mat: T.Material) {
    const group = new T.Group(); group.position.set(x, y, z); group.rotation.y = yaw; this.decorative.add(group);
    for (let at = -width / 2; at < width / 2; at += 0.24) { const stripe = this.box(0.1, 0.13, 0.006, at, 0, 0, mat, group); stripe.rotation.z = -0.55; }
  }
  private viewport(frame: T.Material, edge: T.Material, dark: T.Material, white: T.Material) {
    for (const side of [-1, 1]) {
      this.box(0.33, 3.63, 0.55, side * 7.84, 3.05, -20.26, frame);
      this.box(0.08, 3.48, 0.03, side * 7.65, 3.04, -20.008, edge);
      this.box(16.0, 0.18, 0.44, 0, side < 0 ? 1.34 : 4.77, -20.21, frame);
      this.box(4.9, 0.022, 0.014, side * 4.45, 4.72, -19.997, white);
    }
    for (const x of [-4, 4]) this.box(0.18, 3.55, 0.4, x, 3.05, -20.16, frame);
    // Bent safety rail behind the sealed glass, outside the collision boundary.
    for (const x of [-6, -2, 2, 6]) this.box(0.04, 0.65, 0.04, x, 1.71, -20.13, edge);
    for (const [x, angle] of [[-4.05, -0.025], [4.05, 0.055]]) { const rail = this.box(7.8, 0.05, 0.055, x, 2.0, -20.13, edge); rail.rotation.z = angle; }
    this.sign('SHATTERED RELAY', 'ORBITAL COMMUNICATIONS  /  SECTOR 07', 8.4, 0.76, 0, 5.35, -19.982, 0, '#b9cbc8');
    this.sign('ARMORED VIEWPORT', 'SEALED / EXTERIOR DECOMPRESSION', 4.2, 0.44, 0, 0.89, -19.98, 0, '#a3ada2');
    // Small coating fractures confined to a viewport corner, below no aiming lane.
    const crack: number[] = [];
    for (const [x, y] of [[6.2, 4.63], [7.55, 3.26], [5.96, 3.73]]) crack.push(7.33, 4.4, -19.989, x, y, -19.989);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(crack, 3)); const lines = new T.LineSegments(g, new T.LineBasicMaterial({ color: '#8dabb2', transparent: true, opacity: 0.35 })); lines.userData.decorative = true; this.root.add(lines);
  }
  private blastDoor(frame: T.Material, edge: T.Material, dark: T.Material, amber: T.Material, scorch: T.Material) {
    this.box(8.6, 4.4, 0.34, 0, 2.2, 20.16, frame);
    for (const side of [-1, 1]) {
      this.box(4.0, 3.8, 0.035, side * 2.07, 2.08, 20.013, dark);
      for (const y of [0.6, 1.1, 2.2, 3.3]) this.box(3.86, 0.06, 0.014, side * 2.07, y, 19.989, edge);
      this.box(0.026, 3.61, 0.017, side * 0.09, 2.07, 19.987, amber);
      this.box(0.16, 4.5, 0.022, side * 4.33, 2.25, 19.981, frame);
      this.plane(3.0, 3.7, side * 2.4, 2.0, 19.975, scorch, 0, Math.PI, side * 0.13);
    }
    this.sign('07 / BLAST DOOR', 'PRESSURE LOCK  /  DO NOT OVERRIDE', 7.7, 0.8, 0, 4.83, 19.974, Math.PI, '#d2b994');
    this.sign('HULL BREACH', 'EMERGENCY SHUTTER ENGAGED', 3.2, 0.8, -2.1, 2.79, 19.97, Math.PI, '#d4a67a');
    this.hazards(0, 0.2, 19.97, 8.1, Math.PI, amber);
    this.floorText('PRESSURE / SEALED', 6, 1.5, 0, 17.5, Math.PI, '#bbaa87bb');
    // Maintenance lockers and a human-size service hatch in the wall skin.
    this.sign('MAINTENANCE', 'TOOLS / SPARES  /  MANUAL ACCESS', 4.7, 0.88, -12.4, 2.2, 19.982, Math.PI, '#92aaa9');
    this.box(1.15, 2.25, 0.024, 12.5, 1.125, 19.995, dark); this.box(0.11, 0.4, 0.012, 12.16, 1.2, 19.976, edge);
    this.sign('SERVICE', 'LOCKED', 1.28, 0.32, 12.5, 2.48, 19.973, Math.PI, '#a4b7b3');
  }
  private space() {
    const planetMat = new T.MeshBasicMaterial({ map: planetTexture(), color: '#7995a1', fog: false });
    const planet = new T.Mesh(new T.SphereGeometry(12, 24, 16), planetMat); planet.position.set(-6, 7, -65); planet.rotation.z = 0.22; this.exterior.add(planet);
    const atmosphere = new T.Mesh(new T.SphereGeometry(12.16, 28, 20), new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { tint: { value: new T.Color('#6d9fab') } }, vertexShader: 'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.); n=normalize(normalMatrix*normal); v=normalize(-p.xyz); gl_Position=projectionMatrix*p;}', fragmentShader: 'uniform vec3 tint; varying vec3 n; varying vec3 v; void main(){float rim=pow(1.-max(0.,dot(normalize(n),normalize(v))),3.); gl_FragColor=vec4(tint,rim*.17);}' })); atmosphere.position.copy(planet.position); this.exterior.add(atmosphere);
    const points: number[] = []; for (let i = 0; i < 100; i++) points.push(Math.sin(i * 127.1) * 85, -13 + (Math.cos(i * 31.7) + 1) * 40, -110 - (i % 9));
    const stars = new T.BufferGeometry(); stars.setAttribute('position', new T.Float32BufferAttribute(points, 3)); this.exterior.add(new T.Points(stars, new T.PointsMaterial({ color: '#8b9dab', size: 0.15, fog: false, sizeAttenuation: true })));
    const hull = new T.MeshBasicMaterial({ color: '#142532', fog: false }), face = new T.MeshBasicMaterial({ color: '#2b414a', fog: false }), ember = new T.MeshBasicMaterial({ color: '#a6653c', fog: false });
    const station = new T.Group(); station.position.set(12, 2.5, -35); station.rotation.z = -0.19; this.exterior.add(station);
    this.box(12, 1.0, 1.8, 0, 0, 0, hull, station); this.box(5.2, 2.4, 2.1, -2, 0.6, 0, face, station); this.box(1.2, 9, 0.7, 3.5, 2.7, 0, hull, station);
    for (const side of [-1, 1]) { this.box(7.2, 0.08, 3.7, side * 8.8, -0.13, 0, face, station); this.box(0.14, 0.08, 3.6, side * 7.3, -0.08, 0, hull, station); }
    this.box(0.35, 0.24, 0.03, 0.7, 0.4, 1.072, ember, station); this.box(0.2, 1.6, 0.03, 1.1, 0, 1.072, ember, station);
    for (let i = 0; i < 6; i++) { const piece = new T.Group(); piece.position.set(-17 + i * 7.2, 0.7 + (i % 3) * 2.8, -29 - (i % 4) * 7); piece.rotation.set(i * 0.7, i * 1.3, i * 0.8); this.box(0.6 + (i % 2), 0.23, 0.9, 0, 0, 0, face, piece); this.box(0.1, 0.9, 0.12, 0.3, 0.2, 0, hull, piece); this.debris.push(piece); this.exterior.add(piece); }
    const flash = this.box(0.22, 0.22, 0.22, 22, 5.4, -48, new T.MeshBasicMaterial({ color: '#eab989', fog: false, transparent: true, opacity: 0.4 }), this.exterior); flash.visible = false; return flash;
  }
  private mergeDecorations(parent: T.Object3D = this.decorative) {
    parent.updateMatrixWorld(true); const groups = new Map<T.Material, T.Mesh[]>();
    parent.traverse(object => { if (object instanceof T.Mesh && !Array.isArray(object.material)) { const list = groups.get(object.material) ?? []; list.push(object); groups.set(object.material, list); } });
    const inverse = parent.matrixWorld.clone().invert();
    for (const [mat, meshes] of groups) {
      if (meshes.length < 2) continue;
      const parts = meshes.map(m => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); return g.applyMatrix4(inverse.clone().multiply(m.matrixWorld)); });
      const merged = mergeGeometries(parts); parts.forEach(g => g.dispose()); if (!merged) continue;
      meshes.forEach(m => { m.removeFromParent(); m.geometry.dispose(); }); const result = new T.Mesh(merged, mat); result.userData.decorative = parent === this.decorative; parent.add(result);
    }
  }
  setReduced(value: boolean) { this.reduced = value; this.sparks.visible = !value; this.debris.forEach((p, i) => p.visible = !value || i < 2); }
  update(time: number) {
    const cycle = time % 14.3; this.arc.visible = cycle > 10.0 && cycle < 10.13 || cycle > 10.31 && cycle < 10.4;
    this.emergency.emissiveIntensity = cycle > 9.8 && cycle < 10.55 ? 0.35 : 0.7;
    this.holo.opacity = 0.84 + Math.sin(time * 1.7) * 0.035;
    this.debris.forEach((piece, i) => { piece.rotation.y = i * 1.3 + time * (0.007 + i * 0.001); piece.rotation.z = i * 0.8 + Math.sin(time * 0.06 + i) * 0.06; });
    this.exteriorFlash.visible = !this.reduced && time % 23 > 18.0 && time % 23 < 18.16;
    if (!this.reduced) {
      const positions = this.sparks.geometry.getAttribute('position'); for (let i = 0; i < positions.count; i++) { const t = (time * 0.14 + i * 0.139) % 1; positions.setXYZ(i, 19.1 - Math.sin(i * 17) * t * 0.12, 3.88 - t * 1.2, -10.6 + Math.sin(i * 7.1) * t * 0.6); } positions.needsUpdate = true;
    }
  }
}
