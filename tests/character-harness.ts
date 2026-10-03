import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OperatorModel } from '../client/models';
import { RIFLE_WRISTS } from '../client/weapon';
import { COLORS } from '../shared/world';
const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas')!,antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
const scene=new T.Scene();scene.background=new T.Color('#202b32');const camera=new T.PerspectiveCamera(42,innerWidth/innerHeight,.05,60);
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.38;room.dispose();pmrem.dispose();scene.add(new T.HemisphereLight('#a9bec9','#28323b',1.8));const light=new T.DirectionalLight('#c4d5dc',2.3);light.position.set(-6,15,5);scene.add(light);
const ground=new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:'#162028',roughness:.95}));ground.rotation.x=-Math.PI/2;ground.position.y=-.008;scene.add(ground);const grid=new T.GridHelper(12,24,'#56636a','#303d46');grid.position.y=-.005;scene.add(grid);
const models=COLORS.map((c,i)=>new OperatorModel(c,i));models.forEach(m=>scene.add(m.root));let time=0,frameLife=100;
function frame(view='front',pose='idle',age=.16){
 frameLife++;
 models.forEach((m,i)=>{m.root.visible=i===0||view==='lineup';m.root.position.set(view==='lineup'?(i-1.5)*.91:0,0,0);m.sync(100,frameLife,0,0,0);});
 const model=models[0];for(let i=0;i<60;i++)models.forEach(m=>m.animate(1/60,i/60,0,pose==='run'?-6:pose==='walk'?-1.6:0,0,pose==='up'?.75:pose==='down'?-.75:0,pose==='phase',pose==='protected'));
 time=1;
 if(pose==='fire')model.fire(time);if(pose==='hit')model.hit(time);if(pose==='dash')model.sync(100,frameLife,3,time,0);if(pose==='elimination')model.sync(0,frameLife,0,time,0);
 for(let i=0;i<Math.ceil(age*60);i++){time+=1/60;model.sync(pose==='elimination'?0:100,frameLife,pose==='dash'?3:0,time,pose==='turn'?1.25:0);model.animate(1/60,time,0,pose==='run'?-6:pose==='walk'?-1.6:0,pose==='turn'?1.25:0,pose==='up'?.75:pose==='down'?-.75:0,pose==='phase',pose==='protected');}
 if(view==='lineup'){camera.position.set(0,1.37,-5.9);camera.lookAt(0,.97,-.08);}else if(view==='helmet'){camera.position.set(-.29,1.69,-.65);camera.lookAt(0,1.635,0);}else{camera.position.set(view==='side'?2.8:view==='rear'?.9:1.05,1.35,view==='side'?.1:view==='rear'?2.9:-3.1);camera.lookAt(0,1.0,-.08);}
 models.forEach((m,i)=>m.root.visible=(i===0||view==='lineup')&&(pose!=='elimination'||age<.72));
 scene.updateMatrixWorld(true);renderer.render(scene,camera);return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pose:model.poseState};
}
function audit(){
 const m=models[0];let worstWrist=0,worstFloor=0,worstStretch=0;const states=[];
 for(const speed of [0,1.6,6])for(const pitch of [-.75,0,.75]){
  m.sync(100,++time,0,time,0);
  for(let i=0;i<120;i++){time+=1/60;m.animate(1/60,time,0,-speed,0,pitch,false,false);m.root.updateMatrixWorld(true);
   for(const[j,arm]of m.armRig.entries()){const actual=arm.lower.localToWorld(new T.Vector3(0,-arm.lowerLength,0));const target=m.rifle.root.localToWorld(new T.Vector3(...(j===0?RIFLE_WRISTS.dominant:RIFLE_WRISTS.support)));worstWrist=Math.max(worstWrist,actual.distanceTo(target));}
   for(const leg of m.legs){const heel=leg.end.localToWorld(new T.Vector3(0,-.138,0));worstFloor=Math.min(worstFloor,heel.y);worstStretch=Math.max(worstStretch,leg.lower.scale.y,leg.upper.scale.y);}
  }states.push({speed,pitch,pose:m.poseState});
 }
 m.sync(100,++time,0,time,0);m.animate(1/60,time,0,0,0,0,false,false);m.root.updateMatrixWorld(true);
 const held=m.rifle.root.visible;m.rifle.root.visible=false;const solids:T.Object3D[]=[];m.body.traverse(o=>{if(o instanceof T.Mesh&&!o.parent?.name.includes('Pulse'))solids.push(o);});
 const bounds=new T.Box3();for(const o of solids){let parent=o.parent,inRifle=false;while(parent){if(parent===m.rifle.root)inRifle=true;parent=parent.parent;}if(!inRifle)bounds.expandByObject(o);}
 m.rifle.root.visible=held;let triangles=0,meshes=0,groups=0;m.root.traverse(o=>{if(o instanceof T.Mesh){triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;meshes++;}if(o instanceof T.Group)groups++;});
 const materials=new Set<T.Material>();m.body.traverse(o=>{if(o instanceof T.Mesh&&!Array.isArray(o.material))materials.add(o.material);});const before=[...materials].map(o=>[o.opacity,o.transparent,o.depthWrite]);m.animate(1/60,time,0,0,0,0,true,false);m.animate(1/60,time,0,0,0,0,false,false);const restored=[...materials].every((o,i)=>o.opacity===before[i][0]&&o.transparent===before[i][1]&&o.depthWrite===before[i][2]);
 return{worstWrist,worstFloor,worstStretch,triangles,meshes,groups,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},restored,states};
}
Object.assign(window,{characterQA:{frame,audit}});frame();
