import { BOXES, rayBox, type Vec3, type Box } from '../shared/world';
import type { Shot } from '../shared/protocol';

// Cosmetic seconds/meters only. Damage, hit markers, scoring, and audio still
// happen on receipt of the accepted server shot, before this pulse arrives.
export const PULSE = { release: .018, speed: 200, arrivalHold: .016, residue: .10, tail: .78 } as const;
export function pulseFrame(distance: number, age: number) {
  const travel = Math.min(distance, Math.max(0, age - PULSE.release) * PULSE.speed);
  const arrival = PULSE.release + distance / PULSE.speed, impactAge = age - arrival;
  const headOpacity = age < PULSE.release ? 0 : impactAge < 0 ? 1 : Math.max(0, 1 - impactAge / PULSE.arrivalHold);
  return { travel, tail: Math.min(PULSE.tail, travel), headOpacity, impactAge, expired: impactAge >= PULSE.residue };
}
const delta = (a: Vec3, b: Vec3): Vec3 => ({ x: b.x-a.x, y: b.y-a.y, z: b.z-a.z });
const length = (a: Vec3) => Math.hypot(a.x,a.y,a.z);
const unit = (a: Vec3): Vec3 => { const n=length(a); return n>.00001?{x:a.x/n,y:a.y/n,z:a.z/n}:{x:0,y:0,z:1}; };
const along = (a: Vec3, d: Vec3, distance: number): Vec3 => ({x:a.x+d.x*distance,y:a.y+d.y*distance,z:a.z+d.z*distance});
const firstSolid = (a: Vec3, b: Vec3) => {
  const d=delta(a,b), n=length(d); if(n<.00001)return Infinity;
  const direction=unit(d); return Math.min(...BOXES.map(box=>rayBox(a,direction,box)));
};
export function visualOrigin(shot: Shot, muzzle: Vec3) {
  const accepted=delta(shot.from,shot.to), distance=length(accepted);
  if(distance<.00001)return{...shot.from,suppressMuzzle:true};
  let start={...muzzle}; const eyeToMuzzle=delta(shot.from,muzzle), span=length(eyeToMuzzle), obstacle=firstSolid(shot.from,muzzle);
  let suppressMuzzle=obstacle < span;
  if(suppressMuzzle)start=along(shot.from,unit(eyeToMuzzle),Math.max(0,obstacle-.025));
  // An operator may approach closer than the displayed barrel length. Keep the
  // cosmetic launch before the contact, so a pulse never flies backward.
  const aim=unit(accepted), offset=delta(shot.from,start), projection=offset.x*aim.x+offset.y*aim.y+offset.z*aim.z;
  if(projection>Math.max(0,distance-.025)){
    start=along(shot.from,offset,Math.max(0,distance-.025)/projection);suppressMuzzle=true;
  }
  // A barrel round a corner must not send a false pulse through a nearer solid.
  // Fall back toward the authoritative eye ray, without moving its endpoint.
  if(firstSolid(start,shot.to)<length(delta(start,shot.to))-.035){
    suppressMuzzle=true;
    const shift=delta(shot.from,start);
    for(const amount of [.75,.5,.25,0]){
      const candidate=along(shot.from,shift,amount);
      if(firstSolid(candidate,shot.to)>=length(delta(candidate,shot.to))-.035){start=candidate;break;}
    }
  }
  return { ...start, suppressMuzzle };
}
export type ImpactKind = 'armor'|'metal'|'composite'|'none';
function faceNormal(point: Vec3, box: Box, incoming: Vec3): Vec3 {
  const faces=(['x','y','z'] as const).map((axis,i)=>({axis,error:Math.abs(Math.abs(point[axis]-box[axis])-[box.w,box.h,box.d][i]/2)}));
  faces.sort((a,b)=>Math.abs(a.error-b.error)<.00001 ? Math.abs(incoming[b.axis])-Math.abs(incoming[a.axis]) : a.error-b.error);
  const axis=faces[0].axis, result={x:0,y:0,z:0}; result[axis]=Math.sign(point[axis]-box[axis])||-Math.sign(incoming[axis])||1; return result;
}
export function impactSurface(shot: Shot): {kind:ImpactKind;normal:Vec3} {
  const d=delta(shot.from,shot.to), distance=length(d), direction=unit(d);
  if(shot.hit)return{kind:'armor',normal:unit(delta(shot.to,shot.from))};
  for(const box of BOXES){
    const contact=rayBox(shot.from,direction,box);
    if(Number.isFinite(contact)&&Math.abs(contact-distance)<.06)return{kind:box.kind==='cover'?'composite':'metal',normal:faceNormal(shot.to,box,direction)};
  }
  return{kind:'none',normal:{x:0,y:1,z:0}};
}
