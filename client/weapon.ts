import * as T from 'three';
import { createSuitMaterials, addSuitGloves, viewmodelSleeves, type SuitMaterials } from './suit';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original split-shell induction rifle. Meters, +Y up, muzzle along -Z.
// These anchors also terminate the operator's forearms: the gun and fingers
// remain a single assembly while the arms aim, run, breathe, and recoil.
export const RIFLE_WRISTS = { dominant: [0.091, -0.181, 0.145], support: [-0.083, -0.138, -0.404] } as const;
export const riflePose = (aspect: number) => ({ x: aspect < 1 ? .12 : .28, y: -.235, z: aspect < 1 ? -.94 : -.86, yaw: .20, roll: -.12 });
export type Rifle = { root: T.Group; muzzle: T.Object3D; flash: T.Group; fire: (time: number) => void; update: (time: number) => void; reset: () => void; setOperatorColor: (color: string) => void };
const surface = (color: string, metalness: number, roughness: number) => new T.MeshStandardMaterial({ color, metalness, roughness });
function mesh(parent: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x = 0, y = 0, z = 0) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }
function box(parent: T.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material, bevel = 0.006) { return mesh(parent, new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w / 3, h / 3, d / 3)), mat, x, y, z); }
function oval(parent: T.Object3D, at: readonly number[], radii: number[], mat: T.Material, detailed: boolean) { const m = mesh(parent, new T.SphereGeometry(1, detailed ? 14 : 8, detailed ? 10 : 6), mat, ...at as [number, number, number]); m.scale.set(...radii as [number, number, number]); return m; }
function rod(parent: T.Object3D, a: readonly number[], b: readonly number[], r: number, mat: T.Material, end = r, sides = 10) { const from = new T.Vector3(...a as [number, number, number]), to = new T.Vector3(...b as [number, number, number]); const m = mesh(parent, new T.CylinderGeometry(end, r, from.distanceTo(to), sides), mat); m.position.copy(from).add(to).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.sub(from).normalize()); return m; }
function profile(parent: T.Object3D, points: number[][], width: number, x: number, mat: T.Material, bevel = .004) {
  const shape = new T.Shape(); points.forEach(([z, y], i) => { const axial = z > .16 ? .16 + (z - .16) * .32 : z; i ? shape.lineTo(-axial, y) : shape.moveTo(-axial, y); }); shape.closePath();
  const g = new T.ExtrudeGeometry(shape, { depth: width, steps: 1, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1 });
  const m = mesh(parent, g, mat, x - width / 2); m.rotation.y = Math.PI / 2; return m;
}
function ring(parent: T.Object3D, z: number, radius: number, tube: number, mat: T.Material, detailed: boolean, y = .036) { return mesh(parent, new T.TorusGeometry(radius, tube, detailed ? 6 : 4, detailed ? 24 : 12), mat, 0, y, z); }
function batch(group: T.Group) {
  group.updateMatrixWorld(true); const groups = new Map<T.Material, T.Mesh[]>();
  group.traverse(o => { if (o instanceof T.Mesh && !Array.isArray(o.material)) { const list = groups.get(o.material) ?? []; list.push(o); groups.set(o.material, list); } });
  for (const [mat, objects] of groups) {
    const parts = objects.map(o => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); return g.applyMatrix4(o.matrixWorld); });
    const merged = mergeGeometries(parts); parts.forEach(g => g.dispose()); if (!merged) continue;
    objects.forEach(o => { o.removeFromParent(); o.geometry.dispose(); }); const m = new T.Mesh(merged, mat); m.name = 'Batched rifle surface'; group.add(m);
  }
}

function finishTextures() {
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d')!;
  ctx.fillStyle='#e0e3e5';ctx.fillRect(0,0,256,256);
  for(let i=0;i<180;i++){ctx.fillStyle=`rgba(83,99,111,${.025+(i%5)*.012})`;ctx.fillRect((i*53)%256,(i*37)%256,12+(i%23)*3,.4);}
  const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(2,2);return map;
}
function markings() {
  const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d')!;
  ctx.fillStyle='#bdc9cc';ctx.font='bold 55px "Menlo", monospace';ctx.fillText('PULSE / 01',22,75);
  ctx.font='19px "Menlo", monospace';ctx.fillStyle='#829da8';ctx.fillText('CONTAINMENT / INDUCTION',23,113);
  ctx.fillStyle='#637e89';ctx.fillRect(23,145,454,3);ctx.font='18px "Menlo", monospace';ctx.fillText('NB   2191.07  •  SEALED CORE',23,182);
  for(let i=0;i<28;i++)ctx.fillRect(24+i*7,207,i%3===0?4:2,21);
  ctx.fillStyle='#aabac1';ctx.beginPath();ctx.moveTo(426,224);ctx.lineTo(452,189);ctx.lineTo(477,224);ctx.closePath();ctx.strokeStyle='#aabac1';ctx.lineWidth=3;ctx.stroke();ctx.fillRect(450,202,3,9);
  const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;return new T.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:.8,polygonOffset:true,polygonOffsetFactor:-1});
}

// A softly edged, forward-facing volume rather than a spherical flash. Its
// silhouette comes from an original short spindle profile; interpolated normals
// feather the edge without a texture, scene light, or full-screen bloom pass.
function ionVolume(parent: T.Object3D, profile: readonly (readonly [number, number])[], color: string, name: string) {
  const material = new T.ShaderMaterial({
    uniforms: { ionColor: { value: new T.Color(color) }, opacity: { value: 0 } },
    transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      uniform vec3 ionColor;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float edge = pow(clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0), 1.3);
        gl_FragColor = vec4(ionColor, opacity * smoothstep(0.0, 0.7, edge));
        #include <colorspace_fragment>
      }`
  });
  const geometry = new T.LatheGeometry(profile.map(([radius, distance]) => new T.Vector2(radius, distance)), 12);
  geometry.rotateX(-Math.PI / 2);
  const volume = mesh(parent, geometry, material); volume.name = name;
  return { volume, material };
}
const smooth = (n: number) => { const x = T.MathUtils.clamp(n, 0, 1); return x * x * (3 - 2 * x); };
const pulseEnvelope = (age: number, begin: number, peak: number, end: number) =>
  age < begin || age >= end ? 0 : age < peak ? smooth((age - begin) / (peak - begin)) : 1 - smooth((age - peak) / (end - peak));

export function createPulseRifle(firstPerson = false, suit?: SuitMaterials): Rifle {
  const uniform = suit ?? createSuitMaterials('#73fbd3');
  const root = new T.Group(), shell = new T.Group(); root.name = firstPerson ? 'Pulse Rifle / viewmodel' : 'Pulse Rifle / operator'; root.add(shell);
  const metal = surface('#36434e', .82, .31), ceramic = surface('#242e38', .12, .78), edge = surface('#89959d', .86, .27);
  const lightCeramic = surface('#62737d', .18, .57), black = surface('#0c141e', .33, .61), grip = surface('#151e24', .03, .95);
  const heat = surface('#655c69', .75, .42);
  const core = new T.MeshStandardMaterial({ color: '#254c65', emissive: '#4baae1', emissiveIntensity: .32, metalness: .25, roughness: .45 });
  const channel = new T.MeshStandardMaterial({ color: '#496171', emissive: '#68c7f3', emissiveIntensity: .16, metalness: .52, roughness: .32 });
  core.name='Induction core';channel.name='Accelerator channel';
  if(firstPerson){const brushing=finishTextures();metal.map=brushing;edge.map=brushing;lightCeramic.map=brushing;}

  // Compact shoulder cradle and tapered rear energy regulator. No stock tube,
  // cartridge magazine, picatinny rail, or conventional gun barrel.
  profile(shell, [[.35,-.07],[.366,.017],[.25,.052],[.07,.064],[-.024,.036],[.035,-.063],[.19,-.088]], .166, 0, metal, .008);
  profile(shell, [[.348,-.065],[.351,.012],[.262,.071],[.234,.067],[.248,-.07]], .188, 0, grip);
  for (const side of [-1, 1]) {
    profile(shell, [[.315,.022],[.235,.049],[.078,.053],[.032,.031],[.082,.005],[.204,-.024]], .018, side * .094, ceramic);
    profile(shell, [[.266,.034],[.235,.047],[.11,.051],[.14,.034]], .02, side * .094, lightCeramic, .002);
    // Two continuous containment rails frame the open core chamber.
    profile(shell, [[.028,.038],[-.034,.126],[-.283,.123],[-.372,.088],[-.637,.08],[-.679,.044],[-.625,.015],[-.356,.031],[-.27,.075],[-.061,.077]], .027, side * .093, ceramic);
    profile(shell, [[.063,-.052],[-.067,-.103],[-.3,-.103],[-.394,-.071],[-.64,-.059],[-.677,-.035],[-.625,-.005],[-.353,-.02],[-.272,-.058],[-.046,-.063]], .037, side * .078, metal);
    profile(shell, [[-.301,.108],[-.376,.076],[-.581,.073],[-.616,.05],[-.389,.049],[-.29,.084]], .022, side * .109, lightCeramic, .002);
    profile(shell, [[-.322,-.087],[-.415,-.061],[-.59,-.052],[-.57,-.032],[-.393,-.037]], .025, side * .093, ceramic, .002);
  }
  // Pressure-actuated grip and forward saddle, dimensioned around the gloves.
  profile(shell, [[.131,-.063],[.063,-.067],[.043,-.213],[.081,-.25],[.136,-.229],[.155,-.131]], .068, 0, grip, .006);
  profile(shell, [[.151,-.098],[.171,-.104],[.16,-.221],[.123,-.258],[.073,-.258],[.07,-.242],[.136,-.217]], .018, 0, metal, .003);
  box(shell, .067, .025, .036, 0, -.088, .04, black);
  box(shell, .055, .008, .014, 0, -.075, .037, channel, .002);
  box(shell, .124, .041, .179, 0, -.103, -.407, grip, .008);
  box(shell, .147, .014, .19, 0, -.078, -.407, metal, .003);
  // A housed induction cell is visible through narrow armored windows.
  for (const z of [-.047,-.293]) rod(shell, [0,.036,z], [0,.036,z-.012], .055, black, .055, firstPerson ? 20 : 12);
  rod(shell, [0,.036,-.07], [0,.036,-.279], .03, core, .03, firstPerson ? 18 : 10);
  for (const z of [-.061,-.116,-.174,-.231,-.286]) ring(shell, z, .049, .006, edge, firstPerson);
  for (const side of [-1, 1]) {
    box(shell, .008, .028, .201, side * .052, .035, -.174, core, .003);
    // Internal conductors sit behind the glass, with genuine gaps between rails.
    for (const y of [.014,.056]) box(shell, .008, .008, .211, side * .066, y, -.174, heat, .002);
    box(shell, .006, .047, .012, side * .074, .035, -.055, edge, .002);
    box(shell, .006, .047, .012, side * .074, .035, -.292, edge, .002);
  }
  const glass = new T.MeshStandardMaterial({ color:'#729caf', roughness:.2, metalness:.22, transparent:true, opacity:.17, depthWrite:false, side:T.DoubleSide });
  for (const side of [-1, 1]) { const m = mesh(shell, new T.PlaneGeometry(.231,.083), glass, side * .075,.037,-.174); m.rotation.y = side * Math.PI / 2; }
  // Accelerator channel leads into a blunt, hollow, polygonal pulse chamber.
  box(shell, .025, .018, .32, 0, .013, -.477, black, .004);
  for (const side of [-1,1]) {
    box(shell, .015, .014, .309, side * .027, .027, -.482, channel, .004);
    profile(shell, [[-.612,.057],[-.649,.091],[-.763,.065],[-.794,.018],[-.769,-.038],[-.643,-.055],[-.615,-.027],[-.727,-.005],[-.752,.017],[-.726,.036]], .032, side * .068, heat, .004);
    profile(shell, [[-.654,.089],[-.752,.068],[-.775,.038],[-.748,.046],[-.66,.064]], .045, side * .067, ceramic, .003);
  }
  const aperture = new T.Mesh(new T.RingGeometry(.039,.057,6).rotateY(Math.PI), metal); aperture.position.set(0,.02,-.769); aperture.rotation.z = Math.PI / 6; shell.add(aperture);
  const exit = new T.Mesh(new T.RingGeometry(.034,.039,6).rotateY(Math.PI), channel); exit.position.set(0,.02,-.771); exit.rotation.z = Math.PI / 6; shell.add(exit);
  box(shell,.123,.013,.021,0,.081,-.684,edge,.003); box(shell,.114,.014,.024,0,-.047,-.676,metal,.003);
  // Low integrated alignment notch stays under the normal aiming sightline.
  for(const side of [-1,1]) box(shell,.014,.025,.041,side*.029,.129,.055,black,.003);
  box(shell,.036,.004,.012,0,.119,.075,channel,.001);

  // Inlaid armor panels, cooling slots, captive fasteners, and readable service
  // markings. Small detail is omitted from remote models, not the silhouette.
  for(const side of [-1,1]) {
    profile(shell,[[.201,.024],[.145,.044],[.076,.043],[.057,.018],[.106,-.012],[.182,-.024]],.006,side*.109,black,.001);
    profile(shell,[[.193,.021],[.143,.036],[.083,.035],[.067,.018],[.108,-.004],[.175,-.017]],.005,side*.114,lightCeramic,.001);
    for(const z of [-.349,-.389,-.429,-.469,-.509,-.549]) {
      const vent=box(shell,.008,.019,.012,side*.126,.066,z,black,.002);vent.rotation.x=-.38;
    }
    for(const [y,z]of [[.1,-.055],[.105,-.266],[.065,-.603],[-.066,-.082],[-.072,-.291]]) {
      rod(shell,[side*.108,y,z],[side*.117,y,z],.006,edge,.006,6);
      if(firstPerson)box(shell,.002,.002,.006,side*.119,y,z,black,.0005);
    }
    // Polished wear at the forward saddle is functional contact wear.
    box(shell,.006,.006,.135,side*.067,-.089,-.409,edge,.001);
    for(let i=0;i<3;i++)box(shell,.009,.008,.012,side*.119,.001,.071+i*.014,i===2?black:channel,.002);
    if(firstPerson) {
      for(let i=0;i<6;i++){const scuff=box(shell,.003,.001,.008+(i%3)*.004,side*.092,-.056-i*.003,.092+i*.012,edge,.0003);scuff.rotation.x=i*.09;}
      const label=mesh(shell,new T.PlaneGeometry(.12,.052),markings(),side*.12,.012,.136);label.rotation.y=side*Math.PI/2;
    }
  }
  // Top-back regulator segmentation replaces a featureless rear slab.
  for(const z of [.092,.115,.138,.16])box(shell,.122,.004,.007,0,.063,z,black,.001);
  for(const x of [-.057,.057])box(shell,.005,.004,.095,x,.066,.127,edge,.001);

  addSuitGloves(shell, firstPerson, uniform);
  if (firstPerson) viewmodelSleeves(shell, uniform, RIFLE_WRISTS);
  batch(shell);
  // Animated optical elements are outside the batched shell. No point lights.
  const muzzle = new T.Object3D(); muzzle.name = 'Pulse exit'; muzzle.position.set(0,.02,-.787); root.add(muzzle);
  const flash = new T.Group(); flash.name = 'Contained discharge'; muzzle.add(flash);
  const bright = ionVolume(flash, [[0,0],[.017,.005],[.021,.02],[.013,.053],[.004,.079],[0,.098]], '#e5f8ff', 'Directed pulse core');
  const glow = ionVolume(flash, [[0,0],[.031,.003],[.043,.018],[.031,.045],[.012,.089],[0,.123]], '#70c5fa', 'Contained ion sheath');
  const rippleMaterial = new T.MeshBasicMaterial({ color:'#70c5fa', transparent:true, opacity:0, blending:T.AdditiveBlending, depthWrite:false, side:T.DoubleSide, toneMapped:false });
  const ripple = mesh(flash, new T.RingGeometry(.024,.026,20), rippleMaterial,0,0,-.009); ripple.name='Aperture release / thermal residue';
  const waveMaterial = new T.MeshBasicMaterial({color:'#70c5fa',transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false});
  const wave = mesh(root,new T.TorusGeometry(.034,.004,4,12),waveMaterial,0,.033,-.08);
  wave.name='Traveling induction pulse'; flash.visible=wave.visible=false;
  // First-person optics occupy a smaller angular area and emit less light into
  // the frame. Remote operators retain the same shape and release timing.
  flash.scale.setScalar(firstPerson ? .78 : 1);
  let firedAt = -Infinity;
  const reset = () => {
    firedAt=-Infinity; flash.visible=wave.visible=false; core.emissiveIntensity=.32; channel.emissiveIntensity=.16;
    bright.material.uniforms.opacity.value=glow.material.uniforms.opacity.value=rippleMaterial.opacity=waveMaterial.opacity=0;
  };
  return { root,muzzle,flash, reset, setOperatorColor(color) { uniform.team.color.set(color); uniform.team.emissive.set(color); uniform.light.color.set(color); uniform.light.emissive.set(color); }, fire(time) { firedAt=time; }, update(time) {
    const age=time-firedAt;
    const stored=age<0||age>=.16 ? 0 : age<.018 ? smooth(age/.018) : 1-smooth((age-.018)/.142);
    core.emissiveIntensity=.32+stored*1.6;
    channel.emissiveIntensity=.16+pulseEnvelope(age,.006,.018,.14)*1.15;
    wave.visible=age>=0&&age<.018;
    wave.position.z=-.075-smooth(age/.018)*.69;
    waveMaterial.opacity=pulseEnvelope(age,0,.010,.018)*.4;
    const release=pulseEnvelope(age,.018,.029,.072);
    const tail=pulseEnvelope(age,.045,.065,.125);
    const ownScale=firstPerson ? .78 : 1;
    flash.visible=age>=.018&&age<.125;
    bright.material.uniforms.opacity.value=release*(firstPerson ? .62 : .95);
    glow.material.uniforms.opacity.value=(release*.22+tail*.085)*(firstPerson ? .62 : 1);
    bright.volume.scale.set(ownScale*(.66+release*.34),ownScale*(.66+release*.34),.63+release*.37);
    glow.volume.scale.set(.65+release*.35,.65+release*.35,.68+release*.32);
    // The front-facing aperture ripple expands less than one chamber diameter;
    // its dim late residue remains attached to the muzzle instead of a cloud.
    ripple.visible=age>=.018&&age<.125;
    ripple.scale.setScalar(.85+smooth((age-.018)/.09)*.48);
    ripple.position.z=-.009-smooth((age-.018)/.107)*.025;
    rippleMaterial.opacity=(release*.3+tail*.11)*(firstPerson ? .6 : 1);
  } };
}
