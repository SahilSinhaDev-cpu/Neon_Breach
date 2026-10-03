import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPulseRifle, riflePose } from '../client/weapon';
import { OperatorModel } from '../client/models';

// Bundled only by the QA server. No studio/debug controls ship in the game.
const canvas = document.querySelector('canvas')!;
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1); renderer.setClearColor('#18232d'); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
const scene = new T.Scene(), camera = new T.PerspectiveCamera(78, innerWidth / innerHeight, .07, 20);
const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(); scene.environment = pmrem.fromScene(room, .04).texture; scene.environmentIntensity = .38; room.dispose(); pmrem.dispose();
scene.add(new T.HemisphereLight('#a9bec9', '#28323b', 1.8)); const key = new T.DirectionalLight('#c4d5dc', 2.3); key.position.set(-6, 15, 5); scene.add(key);
const rifle = createPulseRifle(true), operator = new OperatorModel('#ff68c6', 1); scene.add(rifle.root, operator.root);
function frame(mode = 'first', age = .3, silhouette = false) {
  scene.background = new T.Color(silhouette ? '#bac8d0' : '#18232d');
  scene.overrideMaterial = silhouette ? new T.MeshBasicMaterial({color:'#10161d'}) : null;
  rifle.root.visible = mode === 'first'; operator.root.visible = mode !== 'first';
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  if (mode === 'first') { camera.position.set(0,0,0); camera.rotation.set(0,0,0); const pose=riflePose(camera.aspect); rifle.root.position.set(pose.x,pose.y,pose.z); rifle.root.rotation.set(0,pose.yaw,pose.roll); rifle.fire(0); rifle.update(age); }
  else { camera.position.set(mode === 'side' ? 1.7 : -.7,1.5,mode === 'side' ? -.1 : -2.1); camera.lookAt(.04,1.2,-.26); operator.fire(0); operator.animate(1/60,age,0,0,0,0,false,false); }
  scene.updateMatrixWorld(true); renderer.render(scene,camera);
  scene.overrideMaterial?.dispose(); scene.overrideMaterial=null;
}
function audit() {
  // `draws` counts drawable mesh groups (including hidden effects), not GPU calls.
  const geometry = (root:T.Object3D) => { let triangles=0,draws=0; root.traverse(o=>{if(o instanceof T.Mesh){draws++;triangles+=(o.geometry.index?.count ?? o.geometry.getAttribute('position').count)/3;}});return{triangles,draws}; };
  const obstruction: string[]=[]; const ray=new T.Raycaster();
  for(const aspect of [16/10,844/390,390/844]) for(const kick of [0,.5,1]) {
    camera.position.set(0,0,0); camera.rotation.set(0,0,0); camera.aspect=aspect;camera.updateProjectionMatrix();
    const pose=riflePose(aspect);rifle.root.position.set(pose.x,pose.y,pose.z+kick*.025);rifle.root.rotation.set(kick*.025,pose.yaw,pose.roll);rifle.root.updateMatrixWorld(true);
    for(const x of [-.06,0,.06]) for(const y of [-.06,0,.06]) {ray.setFromCamera(new T.Vector2(x,y),camera);if(ray.intersectObject(rifle.root,true).some(h=>h.object instanceof T.Mesh && h.object.visible))obstruction.push(`${aspect}/${kick}/${x}/${y}`);}
  }
  frame(); return{first:geometry(rifle.root),third:geometry(operator.rifle.root),obstruction};
}
Object.assign(window,{weaponQA:{frame,audit}});frame();
