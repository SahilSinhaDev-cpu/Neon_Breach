import * as T from 'three';
import type { Shot } from '../shared/protocol';
import { PULSE, pulseFrame, impactSurface, visualOrigin, type ImpactKind } from './pulse-motion';

const WHITE='#e5f8ff', ION='#70c5fa', UP=new T.Vector3(0,1,0), FRONT=new T.Vector3(0,0,1);
// Original analytic light shapes: smooth edges on ordinary depth-tested meshes,
// rather than fullscreen bloom or a textured particle cloud.
function lightMaterial(color: string, axial=false) {
  return new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,
    uniforms:{color:{value:new T.Color(color)},opacity:{value:0}},
    vertexShader:`varying vec3 normalView;varying vec3 viewDirection;varying vec3 local;void main(){local=position;vec4 p=modelViewMatrix*vec4(position,1.);normalView=normalize(normalMatrix*normal);viewDirection=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader:`uniform vec3 color;uniform float opacity;varying vec3 normalView;varying vec3 viewDirection;varying vec3 local;void main(){float edge=pow(abs(dot(normalize(normalView),normalize(viewDirection))),.6);float taper=${axial?'smoothstep(-.5,-.18,local.y)':'1.'};gl_FragColor=vec4(color,opacity*edge*taper);
    #include <colorspace_fragment>
    }`});
}
function diskMaterial() {
  return new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,toneMapped:false,
    uniforms:{color:{value:new T.Color(ION)},opacity:{value:0},radius:{value:.3},ring:{value:0}},
    vertexShader:'varying vec2 uvPoint;void main(){uvPoint=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform vec3 color;uniform float opacity;uniform float radius;uniform float ring;varying vec2 uvPoint;void main(){float r=length(uvPoint);float glow=exp(-r*r*12.);float rim=exp(-pow((r-radius)*28.,2.));float mask=mix(glow,rim,ring)*(1.-smoothstep(.8,1.,r));gl_FragColor=vec4(color,opacity*mask);
    #include <colorspace_fragment>
    }`});
}
type Slot={group:T.Group;head:T.Mesh;halo:T.Mesh;tail:T.Mesh;tailGlow:T.Mesh;contact:T.Group;flash:T.Mesh;ripple:T.Mesh;streaks:T.Mesh[];at:number;distance:number;from:T.Vector3;to:T.Vector3;direction:T.Vector3;kind:ImpactKind;phased:boolean;active:boolean};
export class PulseEffects {
  // Four players at the server's 280-ms cadence need at most twelve slots,
  // including 100-m travel and residue. Reuse remains bounded under abuse.
  readonly capacity=12;
  private slots:Slot[]=[];private materials:T.ShaderMaterial[]=[];
  private shape=new T.LatheGeometry([new T.Vector2(0,-.5),new T.Vector2(.4,-.32),new T.Vector2(1,-.02),new T.Vector2(.55,.28),new T.Vector2(0,.5)],8);
  private trail=new T.CylinderGeometry(.52,1,1,8,1,true);
  private plane=new T.PlaneGeometry(1,1);
  private spawned=0;private reused=0;private dropped=0;private peakActive=0;
  constructor(private scene:T.Scene){
    const mesh=(parent:T.Object3D,geometry:T.BufferGeometry,material:T.ShaderMaterial)=>{const m=new T.Mesh(geometry,material);parent.add(m);this.materials.push(material);return m;};
    for(let i=0;i<this.capacity;i++){
      const group=new T.Group(),contact=new T.Group();group.name='Contained pulse / '+i;group.visible=false;group.add(contact);scene.add(group);
      const head=mesh(group,this.shape,lightMaterial(WHITE)),halo=mesh(group,this.shape,lightMaterial(ION));
      const tail=mesh(group,this.trail,lightMaterial(WHITE,true)),tailGlow=mesh(group,this.trail,lightMaterial(ION,true));
      const flash=mesh(contact,this.plane,diskMaterial()),ripple=mesh(contact,this.plane,diskMaterial());ripple.position.z=.007;
      const streaks=Array.from({length:2},()=>mesh(contact,this.shape,lightMaterial(WHITE)));
      this.slots.push({group,contact,head,halo,tail,tailGlow,flash,ripple,streaks,at:-Infinity,distance:0,from:new T.Vector3(),to:new T.Vector3(),direction:new T.Vector3(),kind:'none',phased:false,active:false});
    }
  }
  add(shot:Shot,muzzle:T.Vector3,now:number){
    let slot=this.slots.find(s=>!s.active);
    if(!slot){slot=this.slots.reduce((a,b)=>a.at<b.at?a:b);this.reused++;}
    if(!slot){this.dropped++;return;}
    const origin=visualOrigin(shot,muzzle),surface=impactSurface(shot);
    slot.from.set(origin.x,origin.y,origin.z);slot.to.set(shot.to.x,shot.to.y,shot.to.z);
    slot.direction.copy(slot.to).sub(slot.from);slot.distance=slot.direction.length();slot.direction.normalize();
    if(slot.distance<.00001)slot.direction.set(0,0,-1);
    slot.at=now;slot.kind=surface.kind;slot.phased=shot.phased;slot.active=true;slot.group.visible=true;
    for(const m of [slot.head,slot.tail])(m.material as T.ShaderMaterial).uniforms.color.value.set(shot.phased?'#faf4ff':WHITE);
    for(const m of [slot.halo,slot.tailGlow])(m.material as T.ShaderMaterial).uniforms.color.value.set(shot.phased?'#baa2ff':ION);
    slot.contact.position.copy(slot.to).addScaledVector(new T.Vector3(surface.normal.x,surface.normal.y,surface.normal.z),.012);
    slot.contact.quaternion.setFromUnitVectors(FRONT,new T.Vector3(surface.normal.x,surface.normal.y,surface.normal.z));
    for(const m of [slot.head,slot.halo,slot.tail,slot.tailGlow])m.quaternion.setFromUnitVectors(UP,slot.direction);
    const accent=surface.kind==='armor'?'#b6c5ff':surface.kind==='composite'?'#b0cfbf':ION;
    for(const m of [slot.flash,slot.ripple]){const mat=m.material as T.ShaderMaterial;mat.uniforms.color.value.set(accent);}
    slot.streaks.forEach((m,i)=>{const a=i*Math.PI*2/3+.35;m.position.set(Math.cos(a)*.035,Math.sin(a)*.035,.02);m.quaternion.setFromUnitVectors(UP,new T.Vector3(Math.cos(a),Math.sin(a),.12).normalize());});
    this.spawned++;this.peakActive=Math.max(this.peakActive,this.slots.filter(s=>s.active).length);
    this.updateSlot(slot,now);return origin;
  }
  private updateSlot(s:Slot,now:number){
    const frame=pulseFrame(s.distance,now-s.at);
    if(frame.expired){s.active=false;s.group.visible=false;return;}
    const phase=s.phased?1.8:1,head=s.head.position.copy(s.from).addScaledVector(s.direction,frame.travel);
    const alpha=(mesh:T.Mesh,value:number)=>{(mesh.material as T.ShaderMaterial).uniforms.opacity.value=value;mesh.visible=value>.001;};
    s.head.position.copy(head);s.halo.position.copy(head);
    s.head.scale.set(.023*phase,.17,.023*phase);s.halo.scale.set(.062*phase,.23,.062*phase);
    alpha(s.head,frame.headOpacity*(s.phased?1:.95));alpha(s.halo,frame.headOpacity*(s.phased?.28:.22));
    for(const m of [s.tail,s.tailGlow])m.position.copy(head).addScaledVector(s.direction,-frame.tail/2);
    s.tail.scale.set(.004*phase,frame.tail,.004*phase);s.tailGlow.scale.set(.021*phase,frame.tail,.021*phase);
    alpha(s.tail,frame.headOpacity*.5);alpha(s.tailGlow,frame.headOpacity*.11);
    const impact=frame.impactAge,fade=Math.max(0,1-impact/PULSE.residue),visible=impact>=0&&s.kind!=='none';s.contact.visible=visible;
    if(!visible)return;
    const width=s.kind==='armor'?.32:s.kind==='composite'?.22:.27;
    s.flash.scale.setScalar(width*(.65+Math.min(1,impact/.045)*.35));
    alpha(s.flash,Math.exp(-impact/.026)*.76+fade*fade*.12);
    const rip=s.ripple.material as T.ShaderMaterial;rip.uniforms.ring.value=1;rip.uniforms.radius.value=.14+Math.min(1,impact/.14)*.58;
    s.ripple.scale.setScalar(width*1.45);alpha(s.ripple,fade*fade*(s.kind==='armor'?.2:.13));
    const count=s.kind==='metal'?2:s.kind==='armor'?1:0;
    s.streaks.forEach((m,i)=>{m.scale.set(.0025,(.025+impact*.65)*(s.kind==='armor'?.7:1),.0025);alpha(m,i<count?Math.exp(-impact/.037)*.58:0);});
  }
  update(now:number){for(const s of this.slots)if(s.active)this.updateSlot(s,now);}
  clear(){for(const s of this.slots){s.active=false;s.group.visible=false;}}
  audit(){return{active:this.slots.filter(s=>s.active).length,capacity:this.capacity,spawned:this.spawned,reused:this.reused,dropped:this.dropped,peakActive:this.peakActive,geometryCount:3,materialCount:this.materials.length};}
  dispose(){this.clear();for(const s of this.slots)this.scene.remove(s.group);for(const g of [this.shape,this.trail,this.plane])g.dispose();for(const m of this.materials)m.dispose();}
}
