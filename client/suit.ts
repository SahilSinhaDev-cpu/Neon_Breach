import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original PRESSURE / 07 armor family. All dimensions are meters. Shared
// construction/materials keep viewmodel gloves and remote operators consistent.
export const mesh = (p:T.Object3D,g:T.BufferGeometry,m:T.Material,x=0,y=0,z=0) => {const o=new T.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
export function block(p:T.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material,r=.006){return mesh(p,new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/3,h/3,d/3)),m,x,y,z);}
export function oval(p:T.Object3D,at:readonly number[],scale:readonly number[],m:T.Material,detail=false){const o=mesh(p,new T.SphereGeometry(1,detail?14:10,detail?10:7),m,...at as [number,number,number]);o.scale.set(...scale as [number,number,number]);return o;}
export function rod(p:T.Object3D,a:readonly number[],b:readonly number[],radius:number,m:T.Material,end=radius,sides=10){const from=new T.Vector3(...a as [number,number,number]),to=new T.Vector3(...b as [number,number,number]);const o=mesh(p,new T.CylinderGeometry(end,radius,from.distanceTo(to),sides),m);o.position.copy(from).add(to).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),to.sub(from).normalize());return o;}
export function joint(p:T.Object3D,name:string,x=0,y=0,z=0){const o=new T.Group();o.name=name;o.position.set(x,y,z);p.add(o);return o;}
// Convex chamfered plates, with a front face toward -Z. Their outlines follow
// anatomy instead of wrapping the operator in rectangular boxes.
export function plate(p:T.Object3D,outline:number[][],depth:number,z:number,m:T.Material,bevel=.005){const s=new T.Shape();outline.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath();const g=new T.ExtrudeGeometry(s,{depth,steps:1,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,curveSegments:1});const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*3.5,uv.getY(i)*3.5);return mesh(p,g,m,0,0,z);}
export function loft(p:T.Object3D,rings:number[][],m:T.Material,sides=12){
 const positions:number[]=[],uv:number[]=[],indices:number[]=[];
 for(let j=0;j<rings.length;j++){const[y,rx,rz,cz=0]=rings[j];for(let i=0;i<=sides;i++){const angle=i/sides*Math.PI*2;positions.push(Math.sin(angle)*rx,y,Math.cos(angle)*rz+cz);uv.push(i/sides,j/(rings.length-1));}}
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,b,a+1,a+1,b,b+1);}
 // Closed ends, with duplicated rim normals handled by the small terminal rings.
 if(rings.at(-1)![0]>rings[0][0])for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return mesh(p,g,m);
}
export function batch(group:T.Group){
 for(const child of [...group.children])if(child instanceof T.Group)batch(child);
 const by=new Map<T.Material,T.Mesh[]>();for(const o of group.children)if(o instanceof T.Mesh&&!Array.isArray(o.material)){const list=by.get(o.material)??[];list.push(o);by.set(o.material,list);}
 for(const[m,objects]of by){if(objects.length<2)continue;const parts=objects.map(o=>{o.updateMatrix();return(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrix);});const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());if(!g)continue;for(const o of objects){o.removeFromParent();o.geometry.dispose();}mesh(group,g,m);}
 // Rigid meshes never move relative to their animated joint groups.
 for(const o of group.children)if(o instanceof T.Mesh){o.updateMatrix();o.matrixAutoUpdate=false;}
}
function texture(kind:'weave'|'ceramic'|'rubber'|'visor'){
 const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d')!;
 x.fillStyle=kind==='visor'?'#617b88':'#d8dcde';x.fillRect(0,0,128,128);
 if(kind==='weave'){for(let i=0;i<128;i+=4)for(let j=0;j<128;j+=4){x.fillStyle=(i+j)%8?'#c5ced1':'#e0e3e4';x.fillRect(i,j,3,1);x.fillRect(i,j,1,3);}}
 else if(kind==='rubber'){for(let i=0;i<128;i+=8){x.fillStyle='#a9b2b8';x.fillRect(0,i,128,2);}}
 else if(kind==='ceramic'){
  const g=x.createLinearGradient(0,0,128,128);g.addColorStop(0,'#e5e8e6');g.addColorStop(.5,'#cdd3d4');g.addColorStop(1,'#a8b3ba');x.fillStyle=g;x.fillRect(0,0,128,128);
  // Sparse directional contact wear and recess dirt; distinct from woven fabric.
  for(let i=0;i<34;i++){x.fillStyle=i%3?'#a8b0b460':'#eff3ee88';x.fillRect((i*37)%128,(i*53)%128,3+i%11,.6);}
  x.strokeStyle='#7e8a903b';x.lineWidth=2;x.strokeRect(1,1,126,126);
 }else{
  const g=x.createLinearGradient(0,0,0,128);g.addColorStop(0,'#a0b0b9');g.addColorStop(.32,'#374e5b');g.addColorStop(.72,'#263946');g.addColorStop(1,'#68808c');x.fillStyle=g;x.fillRect(0,0,128,128);
  // A subdued internal head/nasal shadow, not a visible face or glowing eyes.
  x.filter='blur(7px)';x.fillStyle='#17263032';x.beginPath();x.ellipse(64,77,27,43,0,0,Math.PI*2);x.fill();x.filter='none';x.fillStyle='#c4d2d510';x.fillRect(59,42,4,44);
 }
 const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;if(kind==='weave')map.repeat.set(3,3);return map;
}
export function createSuitMaterials(color:string){
 const mat=(name:string,c:string,metal:number,rough:number,map?:T.Texture)=>{const m=new T.MeshStandardMaterial({color:c,metalness:metal,roughness:rough,map});m.name='Pressure suit / '+name;return m;};
 const wear=texture('ceramic'),weave=texture('weave');
 const ceramic=mat('ceramic shell','#929c9f',.24,.62,wear),metal=mat('titanium edge','#65757c',.73,.34,wear),cloth=mat('woven pressure layer','#343e46',.03,.95,weave);
 const rubber=mat('joint seals','#1b252b',.02,.98,texture('rubber')),glove=mat('glove textile','#303b43',.02,.92,weave),pad=mat('glove protectors','#627179',.16,.72,wear),dark=mat('recessed hardware','#26333b',.58,.51);
 const team=mat('painted identifier',color,.17,.55);team.emissive.set(color);team.emissiveIntensity=.12;
 const light=mat('visor edge and status',color,.35,.32);light.emissive.set(color);light.emissiveIntensity=.8;
 const visor=mat('treated visor','#c1d0d8',.38,.19,texture('visor'));visor.envMapIntensity=1.15;
 return{ceramic,metal,cloth,rubber,glove,pad,dark,team,light,visor};
}
export type SuitMaterials=ReturnType<typeof createSuitMaterials>;
export function identify(parent:T.Object3D,m:SuitMaterials,variant:number){
 const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d')!;x.fillStyle='#d5e1df';x.font='bold 70px monospace';x.fillText(String(variant%4+1).padStart(2,'0'),11,80);x.font='15px monospace';x.fillText('NB / SEALED',10,110);
 const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;const material=new T.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:.8,polygonOffset:true,polygonOffsetFactor:-1});const label=mesh(parent,new T.PlaneGeometry(.058,.058),material,.091,.283,-.187);label.rotation.y=Math.PI;return label;
}
// Identical articulated fingers/thumbs in both perspectives. The existing
// contact locations on the Pulse Rifle remain the source of truth.
export function addSuitGloves(p:T.Group,detailed:boolean,m:SuitMaterials){
 oval(p,[.025,-.169,.186],[.041,.068,.025],m.glove,detailed);rod(p,[.091,-.181,.145],[.045,-.174,.18],.042,m.glove,.036);
 for(let i=0;i<4;i++){const y=-.111-i*.033,z=.042-i*.003;rod(p,[.057,y,.173],[.069,y,.09],.012,m.glove,.011,8);rod(p,[.069,y,.09],[.052,y,z],.011,m.glove,.01,8);rod(p,[.052,y,z],[-.03,y,z-.004],.011,m.glove,.009,8);oval(p,[.072,y,.084],[.014,.013,.018],m.pad,detailed);if(detailed)rod(p,[.057,y+.008,.14],[.062,y+.008,.112],.002,m.rubber,.002,5);}
 rod(p,[.052,-.105,.189],[.025,-.078,.178],.017,m.glove,.014);rod(p,[.025,-.078,.178],[.014,-.077,.15],.014,m.glove,.011);oval(p,[.039,-.097,.186],[.018,.02,.015],m.pad,detailed);
 oval(p,[-.018,-.157,-.414],[.06,.027,.079],m.glove,detailed);rod(p,[-.083,-.138,-.404],[-.054,-.153,-.414],.042,m.glove,.038);
 for(let i=0;i<4;i++){const z=-.344-i*.039;rod(p,[-.045,-.149,z],[.063,-.141,z],.012,m.glove,.011,8);rod(p,[.063,-.141,z],[.076,-.096,z],.011,m.glove,.009,8);oval(p,[.066,-.132,z],[.015,.012,.013],m.pad,detailed);}
 rod(p,[-.084,-.142,-.452],[-.091,-.099,-.443],.017,m.glove,.014);rod(p,[-.091,-.099,-.443],[-.082,-.078,-.413],.014,m.glove,.011);oval(p,[-.092,-.138,-.413],[.009,.022,.03],m.pad,detailed);
}
export function forearm(parent:T.Group,length:number,m:SuitMaterials,detailed=false){
 loft(parent,[[0,.069,.064],[-.055,.074,.065],[-length*.55,.057,.052],[-length+.02,.043,.041],[-length,.042,.04]],m.cloth);
 plate(parent,[[-.052,-.045],[.04,-.025],[.062,-.077],[.045,-length+.07],[.012,-length+.045],[-.039,-length+.08]],.03,-.065,m.ceramic);
 block(parent,.093,.025,.093,0,-length+.015,0,m.rubber,.007);block(parent,.048,.012,.009,0,-length+.035,-.052,m.team,.002);
 block(parent,.071,.021,.012,.006,-.065,-.077,m.metal,.003);
 if(detailed)for(let i=0;i<3;i++)block(parent,.025,.009,.006,.016,-.1-i*.02,-.073,m.dark,.002);
}
export function viewmodelSleeves(parent:T.Group,m:SuitMaterials,wrists:{dominant:readonly number[];support:readonly number[]}){
 for(const[a,b]of [[[.28,-.43,.39],wrists.dominant],[[-.33,-.37,.12],wrists.support]]as const){const from=new T.Vector3(...a),to=new T.Vector3(...b as [number,number,number]),o=joint(parent,'Armored forearm');o.position.copy(from);o.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),to.sub(from).normalize());forearm(o,new T.Vector3(...a).distanceTo(new T.Vector3(...b as [number,number,number])),m,true);}
}
