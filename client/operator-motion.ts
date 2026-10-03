// Pure visual rig math. It never supplies positions or hit volumes to the server.
export type V3=[number,number,number];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function bendJoint(a:V3,b:V3,upper:number,lower:number,pole:V3):V3{
 const d:V3=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],distance=Math.hypot(...d),n=d.map(x=>x/Math.max(distance,.00001)) as V3;
 const along=Math.max(.00001,Math.min(upper+lower-.00001,Math.max(Math.abs(upper-lower)+.00001,distance)));
 const x=(upper*upper-lower*lower+along*along)/(2*along),height=Math.sqrt(Math.max(0,upper*upper-x*x));
 const projection=dot(pole,n),q=pole.map((v,i)=>v-projection*n[i])as V3;let size=Math.hypot(...q);
 if(size<.0001){q[0]=n[1];q[1]=-n[0];q[2]=0;size=Math.hypot(...q)||1;}
 return a.map((v,i)=>v+n[i]*x+q[i]/size*height)as V3;
}
export function strideMeters(speed:number){return 1.05+Math.min(1,Math.max(0,(speed-1.6)/4.4))*2.05;}
export function gaitFoot(phase:number,speed:number){
 if(speed<=0)return{travel:0,lift:0,stance:true};
 const run=Math.min(1,Math.max(0,(speed-1.6)/4.4)),amount=Math.min(1,speed/.5),stance=.651/strideMeters(speed),travel=strideMeters(speed)*stance;
 const p=((phase%1)+1)%1;
 if(p<stance)return{travel:(.5-p/stance)*travel*amount,lift:0,stance:true};
 const swing=(p-stance)/(1-stance),smooth=swing*swing*(3-2*swing);
 return{travel:(smooth-.5)*travel*amount,lift:Math.sin(swing*Math.PI)*(.065+run*.08)*amount,stance:false};
}
export const angleDelta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
