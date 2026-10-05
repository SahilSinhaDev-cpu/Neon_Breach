import * as T from 'three';
import { createPulseRifle, RIFLE_WRISTS, type Rifle } from './weapon';
import { createSuitMaterials, mesh, block, oval, rod, joint, plate, loft, batch, forearm, identify } from './suit';
import { bendJoint, gaitFoot, strideMeters, angleDelta, type V3 } from './operator-motion';
export { createPulseRifle, type Rifle } from './weapon';

type Limb={upper:T.Group;lower:T.Group;end:T.Group;upperLength:number;lowerLength:number;side:number};
const DOWN=new T.Vector3(0,-1,0);
function orient(o:T.Group,a:V3,b:V3,length:number){o.position.set(...a);const d=new T.Vector3(...b).sub(new T.Vector3(...a));o.quaternion.setFromUnitVectors(DOWN,d.clone().normalize());o.scale.y=d.length()/length;}
function helmet(parent:T.Group,m:ReturnType<typeof createSuitMaterials>){
 // A human-scale sealed skull cap, a separate jaw, and a swept optical band.
 loft(parent,[[-.12,.073,.072,.009],[-.076,.109,.112,.004],[.025,.126,.139,.01],[.105,.11,.119,.018],[.144,.07,.081,.022],[.157,.002,.002,.02]],m.ceramic,18);
 loft(parent,[[-.14,.067,.062],[-.119,.08,.078],[-.104,.08,.078]],m.rubber,14);
 for(const side of [-1,1]){
  const cheek=plate(parent,[[side*.03,-.075],[side*.086,-.047],[side*.12,-.023],[side*.107,-.107],[side*.073,-.128],[side*.035,-.112]],.032,-.119,m.metal);cheek.rotation.y=side*-.07;
  block(parent,.024,.064,.077,side*.126,.006,.047,m.dark,.008);
  block(parent,.012,.03,.038,side*.141,.017,.033,m.ceramic,.004);
  block(parent,.006,.021,.031,side*.148,.014,.026,m.team,.002);
 }
 plate(parent,[[-.047,-.074],[.047,-.074],[.058,-.096],[.031,-.124],[-.031,-.124],[-.058,-.096]],.038,-.134,m.ceramic);
 for(const x of [-.027,-.009,.009,.027])block(parent,.007,.012,.007,x,-.103,-.141,m.dark,.001);
 const pos:number[]=[],uv:number[]=[],index:number[]=[],segments=20;
 const edgePoints:V3[]=[];
 for(let i=0;i<=segments;i++){const t=i/segments,a=(t-.5)*2.36,xx=Math.sin(a)*.133,z=-Math.cos(a)*.149-.012,top=.057-Math.abs(t-.5)*.037,bottom=-.035+Math.abs(t-.5)*.008;
  pos.push(xx,bottom,z,xx,top,z);uv.push(t,0,t,1);edgePoints.push([xx,top+.006,z-.001]);if(i<segments){const k=i*2;index.push(k,k+1,k+2,k+1,k+3,k+2);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();mesh(parent,g,m.visor);
 for(let i=1;i<edgePoints.length;i++){rod(parent,edgePoints[i-1],edgePoints[i],.0035,m.dark,.0035,5);if(i>3&&i<18)rod(parent,edgePoints[i-1].map((n,k)=>n+(k===1?.001:k===2?-.002:0)),edgePoints[i].map((n,k)=>n+(k===1?.001:k===2?-.002:0)),.0018,m.light,.0018,5);}
 // Crown seam, rear pressure coupling, offset service sensor.
 block(parent,.016,.012,.13,0,.146,.027,m.dark,.004);
 block(parent,.067,.04,.024,0,.041,.14,m.dark,.005);block(parent,.041,.014,.009,0,.044,.155,m.team,.003);
 oval(parent,[-.126,.04,-.019],[.018,.025,.036],m.dark);oval(parent,[-.143,.044,-.03],[.005,.01,.012],m.visor);
}
export class OperatorModel{
 root=new T.Group();body=new T.Group();torso:T.Group;head:T.Group;arms:T.Group;legs:Limb[]=[];armRig:Limb[]=[];rifle:Rifle;shield:T.Mesh;
 private surfaceState:{material:T.Material;opacity:number;transparent:boolean;depthWrite:boolean}[]=[];
 private stride=0;private speed=0;private recoil=0;private hitAt=-100;private dashTime=-100;private downAt=-100;private lastHP=100;private life=-1;private lastDash=0;private turning=false;private phased=false;
 private feet:V3[]=[];private footprint:T.Mesh;
 private lastOpacity=-1;
 constructor(color:string,variant=0){
  const m=createSuitMaterials(color);this.root.name='PRESSURE / 07 operator';this.root.add(this.body);this.body.name='Pelvis and visual rig';
  // Pelvis and fitted lumbar seal link the legs to a tapered rib cage.
  const pelvis=joint(this.body,'Pelvic harness',0,.914,0);
  loft(pelvis,[[-.126,.115,.108],[-.067,.192,.126],[.022,.191,.132],[.072,.166,.12]],m.cloth);
  block(pelvis,.338,.057,.27,0,.064,0,m.rubber,.012);
  block(pelvis,.048,.037,.028,0,.065,-.15,m.metal,.004);
  for(const side of [-1,1]){
   const l=joint(pelvis,'Floating hip shell');plate(l,[[side*.032,.029],[side*.157,.029],[side*.19,-.036],[side*.139,-.11],[side*.035,-.07]],.036,-.138,m.ceramic);
   block(pelvis,.043,.09,.07,side*.183,-.026,.03,m.dark,.009);
  }
  this.torso=joint(this.body,'Thorax',0,1.01,0);
  loft(this.torso,[[0,.159,.108],[.12,.187,.134],[.275,.232,.146],[.34,.217,.128],[.407,.155,.099],[.468,.072,.063]],m.cloth,16);
  for(let i=0;i<3;i++){
   const y=.01+i*.046;plate(this.torso,[[-.139,y],[.139,y],[.149,y+.03],[.075,y+.043],[-.075,y+.043],[-.149,y+.03]],.021,-.126-i*.005,i===0?m.rubber:m.dark,.003);
  }
  for(const side of [-1,1]){
   plate(this.torso,[[side*.009,.336],[side*.139,.355],[side*.224,.293],[side*.211,.207],[side*.151,.124],[side*.032,.137],[side*.011,.221]],.041,-.158,m.ceramic,.008);
   plate(this.torso,[[side*.033,.335],[side*.134,.343],[side*.174,.314],[side*.162,.299],[side*.039,.297]],.012,-.17,m.metal,.003);
   block(this.torso,.028,.153,.018,side*.157,.229,-.181,m.dark,.003);
   block(this.torso,.059,.02,.025,side*.161,.297,-.188,m.metal,.003);
   const harness=block(this.torso,.045,.028,.28,side*.143,.365,.006,m.rubber,.007);harness.rotation.z=-side*.09;
   for(const y of [.17,.27])block(this.torso,.008,.01,.009,side*.195,y,-.173,m.metal,.001);
   // Compact rear scrubbers/pressure spine give a distinct readable back.
   const pack=joint(this.torso,'Life support cartridge',side*.083,.206,.155);pack.rotation.z=side*-.08;
   loft(pack,[[-.132,.049,.035],[-.102,.061,.047],[.084,.061,.047],[.122,.045,.035]],m.dark,8);
   block(pack,.079,.178,.017,0,0,.049,m.ceramic,.012);
   for(let i=0;i<4;i++)block(pack,.049,.008,.007,0,.045-i*.025,.063,m.dark,.002);
   block(pack,.038,.014,.009,0,-.07,.065,m.team,.002);
  }
  plate(this.torso,[[-.031,.326],[.031,.326],[.038,.265],[0,.239],[-.038,.265]],.022,-.184,m.dark,.003);
  block(this.torso,.018,.024,.009,0,.29,-.191,m.light,.002);
  block(this.torso,.057,.05,.009,.092,.28,-.177,m.team,.004);identify(this.torso,m,variant);
  block(this.torso,.054,.216,.055,0,.213,.189,m.metal,.012);
  // Flexible neck seal is exposed between the helmet and clavicle plates.
  rod(this.torso,[0,.358,0],[0,.505,0],.06,m.rubber,.054,14);
  for(const y of [.445,.464]){const ring=mesh(this.torso,new T.TorusGeometry(.059,.003,4,14),m.dark,0,y,0);ring.rotation.x=Math.PI/2;}
  this.head=joint(this.torso,'Helmet',0,.638,-.003);helmet(this.head,m);
  // Shoulder plates stay on the torso; the articulated arms move below them.
  this.arms=joint(this.torso,'Shoulder and weapon aim',0,.366,0);
  for(const side of [1,-1]){
   const shoulder=joint(this.torso,'Shoulder shell',side*.235,.366,0);shoulder.rotation.z=side*-.1;
   loft(shoulder,[[-.079,.069,.078],[-.032,.097,.101],[.06,.085,.089],[.091,.039,.053]],m.ceramic,10);
   block(shoulder,.028,.081,.123,side*.081,.011,0,m.team,.008);
   block(shoulder,.012,.016,.06,side*.101,.023,-.013,m.light,.003);
   block(shoulder,.065,.029,.014,0,.035,-.096,m.metal,.004);
   const upper=joint(this.arms,'Humerus'),lower=joint(this.arms,'Forearm'),end=joint(this.arms,'Wrist anchor');
   loft(upper,[[0,.066,.067],[-.05,.079,.07],[-.20,.061,.055],[-.318,.052,.049]],m.cloth);
   plate(upper,[[-.048,-.081],[.039,-.067],[.059,-.12],[.041,-.237],[-.037,-.248],[-.052,-.18]],.024,-.059,m.ceramic);
   oval(lower,[0,0,0],[.063,.064,.063],m.rubber);block(lower,.073,.069,.035,0,.012,.053,m.metal,.014);forearm(lower,.29,m);
   this.armRig.push({upper,lower,end,upperLength:.32,lowerLength:.29,side});
  }
  for(const side of [1,-1]){
   const upper=joint(this.body,'Thigh'),lower=joint(this.body,'Shin'),end=joint(this.body,'Boot');
   loft(upper,[[0,.10,.108],[-.07,.107,.106],[-.22,.086,.087],[-.395,.063,.067]],m.cloth);
   plate(upper,[[-.063,-.069],[.073,-.057],[.082,-.111],[.061,-.287],[.034,-.321],[-.052,-.31],[-.079,-.146]],.041,-.092,m.ceramic,.007);
   block(upper,.027,.112,.068,side*.094,-.15,.017,m.dark,.007);
   block(upper,.157,.032,.149,0,-.286,.012,m.rubber,.008);
   oval(lower,[0,0,0],[.069,.073,.075],m.rubber);
   plate(lower,[[-.058,.03],[.058,.03],[.079,-.021],[.051,-.087],[-.046,-.088],[-.075,-.024]],.033,-.086,m.ceramic,.008);
   loft(lower,[[0,.064,.069],[-.12,.083,.086],[-.28,.059,.057],[-.395,.048,.05]],m.cloth);
   plate(lower,[[-.046,-.116],[.057,-.1],[.06,-.159],[.038,-.336],[-.035,-.329],[-.055,-.204]],.025,-.071,m.ceramic,.007);
   block(lower,.02,.136,.012,side*.036,-.216,-.096,m.metal,.003);
   block(end,.143,.03,.274,0,-.123,-.045,m.rubber,.008);
   block(end,.134,.071,.229,0,-.079,-.048,m.glove,.016);
   loft(end,[[-.085,.061,.069],[-.02,.065,.067],[.035,.051,.051]],m.rubber);
   block(end,.132,.047,.117,0,-.064,-.123,m.ceramic,.013);
   for(let i=0;i<3;i++)block(end,.078,.013,.013,0,-.014-i*.02,-.055-i*.019,m.dark,.003);
   block(end,.119,.052,.037,0,-.079,.07,m.metal,.007);
   this.legs.push({upper,lower,end,upperLength:.4,lowerLength:.395,side});
  }
  batch(this.body);
  this.rifle=createPulseRifle(false,m);this.rifle.root.scale.setScalar(.64);this.rifle.root.position.set(.165,.073,-.135);this.arms.add(this.rifle.root);
  const materials=new Set<T.Material>();this.body.traverse(o=>{if(o instanceof T.Mesh)for(const mat of Array.isArray(o.material)?o.material:[o.material])materials.add(mat);});
  this.surfaceState=[...materials].map(material=>({material,opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite}));
  this.shield=mesh(this.root,new T.SphereGeometry(.61,16,12),new T.MeshBasicMaterial({color:'#e7fffa',wireframe:true,transparent:true,opacity:.2,depthWrite:false}),0,.93,0);this.shield.scale.y=1.57;this.shield.visible=false;
  this.footprint=mesh(this.root,new T.RingGeometry(.42,.45,24),new T.MeshBasicMaterial({color,side:T.DoubleSide,transparent:true,opacity:.38,depthWrite:false}),0,.012,0);this.footprint.rotation.x=-Math.PI/2;
  this.animate(1/60,0,0,0,0,0,false,false);
 }
 fire(time=performance.now()/1000){if(this.lastHP<=0)return;this.recoil=1;this.rifle.fire(time);}
 hit(time=performance.now()/1000){if(this.lastHP>0)this.hitAt=time;}
 // Authoritative state starts reactions once, never a held client input.
 sync(hp:number,life:number,dashAt:number,time:number,yaw:number){
  if(life!==this.life){this.life=life;this.lastHP=hp;this.downAt=-100;this.hitAt=-100;this.dashTime=-100;this.lastDash=dashAt;this.stride=0;this.speed=0;this.root.rotation.y=yaw;this.turning=true;this.rifle.reset();}
  if(hp<=0&&this.lastHP>0){this.downAt=time;this.recoil=0;this.rifle.reset();}
  if(dashAt>this.lastDash&&hp>0)this.dashTime=time;
  this.lastHP=hp;this.lastDash=dashAt;
  this.root.visible=hp>0||time-this.downAt<.72;
 }
 animate(dt:number,time:number,vx:number,vz:number,yaw:number,pitch:number,phased:boolean,protectedNow:boolean){
  const alive=this.lastHP>0,down=alive?0:T.MathUtils.clamp((time-this.downAt)/.52,0,1),fade=alive?1:1-T.MathUtils.smoothstep(time-this.downAt,.38,.72);
  const dash=Math.max(0,1-(time-this.dashTime)/.44),hit=Math.max(0,1-(time-this.hitAt)/.26);
  if(!this.turning){this.root.rotation.y=yaw;this.turning=true;}
  this.root.rotation.y+=angleDelta(yaw,this.root.rotation.y)*(1-Math.exp(-12*dt));
  const twist=T.MathUtils.clamp(angleDelta(yaw,this.root.rotation.y),-.6,.6);
  const targetSpeed=alive&&dash<.65?Math.min(6,Math.hypot(vx,vz)):0;this.speed+=(targetSpeed-this.speed)*(1-Math.exp(-16*dt));
  this.stride+=this.speed*dt/strideMeters(this.speed);const amount=Math.min(1,this.speed/1.2),cycle=Math.sin(this.stride*Math.PI*2);
  const c=Math.cos(this.root.rotation.y),s=Math.sin(this.root.rotation.y),speed=Math.max(.001,Math.hypot(vx,vz));
  const dx=(vx*c-vz*s)/speed,dz=(vx*s+vz*c)/speed;
  this.body.position.set(0,-amount*.074+Math.abs(cycle)*.008*amount-down*.34-dash*.06,0);
  this.torso.rotation.set(pitch*.12+dash*.16+down*.64-hit*.07,twist+cycle*.032*amount,-cycle*.025*amount+Math.sin(time*1.1)*.006*(1-amount)+hit*.065);
  this.head.rotation.set(pitch*.62-down*.12,-twist*.12,-hit*.025);
  this.arms.rotation.set(pitch*.88-this.recoil*.045+down*.2,-cycle*.024*amount,cycle*.012*amount);
  this.arms.position.set(0,.366+Math.sin(time*1.8)*.0025*(1-amount),this.recoil*.013);
  this.feet=[];
  for(const[i,leg]of this.legs.entries()){
   const gait=gaitFoot(this.stride+i*.5,this.speed),foot:V3=[leg.side*.129+dx*gait.travel,.138+gait.lift-this.body.position.y,dz*gait.travel];
   if(!alive){foot[0]=leg.side*.14;foot[1]=.138-this.body.position.y;foot[2]=-.015;}
   const hip:V3=[leg.side*.126,.914,0];
   const span=Math.hypot(foot[0]-hip[0],foot[2]),reach=Math.sqrt(Math.max(0,(leg.upperLength+leg.lowerLength-.004)**2-(hip[1]-foot[1])**2));
   if(span>reach){foot[0]=hip[0]+(foot[0]-hip[0])*reach/span;foot[2]*=reach/span;}
   const knee=bendJoint(hip,foot,leg.upperLength,leg.lowerLength,[leg.side*.03,0,-1]);
   orient(leg.upper,hip,knee,leg.upperLength);orient(leg.lower,knee,foot,leg.lowerLength);leg.end.position.set(...foot);leg.end.rotation.set(0,leg.side*-.045,0);
   this.feet.push([foot[0],foot[1]+this.body.position.y-.138,foot[2]]);
  }
  this.rifle.root.rotation.set(this.recoil*.012,0,0);this.rifle.root.position.z=-.135+this.recoil*.008;
  // Wrist IK uses the rifle's local matrix. Let the renderer update the full
  // hierarchy once, rather than duplicating its world-transform pass here.
  this.rifle.root.updateMatrix();
  for(const[i,arm]of this.armRig.entries()){
   const w=i===0?RIFLE_WRISTS.dominant:RIFLE_WRISTS.support,hand=new T.Vector3(...w).applyMatrix4(this.rifle.root.matrix),target=hand.toArray()as V3;
   const shoulder:V3=[arm.side*.235,0,.004],elbow=bendJoint(shoulder,target,arm.upperLength,arm.lowerLength,[arm.side*.14,-1,.18]);
   orient(arm.upper,shoulder,elbow,arm.upperLength);orient(arm.lower,elbow,target,arm.lowerLength);arm.end.position.copy(hand);
   
  }
  this.rifle.update(time);this.recoil=Math.max(0,this.recoil-dt*9);
  this.shield.visible=alive&&protectedNow;this.shield.rotation.y+=dt*.4;this.footprint.visible=alive;
  const opacity=fade*(phased?.4:1);
  if(opacity!==this.lastOpacity){
   for(const base of this.surfaceState){const m=base.material,transparent=opacity<.999||base.transparent;if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}m.opacity=base.opacity*opacity;m.depthWrite=opacity<.999?false:base.depthWrite;}
   this.lastOpacity=opacity;
  }
  this.phased=phased;
 }
 get poseState(){return{speed:this.speed,stride:this.stride,feet:this.feet,phased:this.phased,alive:this.lastHP>0,life:this.life,rootYaw:this.root.rotation.y};}
}
