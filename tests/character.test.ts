import test from 'node:test';
import assert from 'node:assert/strict';
import {bendJoint,gaitFoot,strideMeters,angleDelta,type V3} from '../client/operator-motion';
const distance=(a:V3,b:V3)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('two-bone solve preserves anatomical lengths for reachable arm and leg targets',()=>{
 for(const[a,b,u,l,p]of [[[.235,0,.004],[.223,-.114,-.112],.32,.29,[.14,-1,.18]],[[-.235,0,.004],[.112,-.086,-.464],.32,.29,[-.14,-1,.18]],[[.126,.914,0],[.129,.17,.2],.4,.395,[0,0,-1]]]as [V3,V3,number,number,V3][]){const joint=bendJoint(a,b,u,l,p);assert.ok(Math.abs(distance(a,joint)-u)<1e-8);assert.ok(Math.abs(distance(joint,b)-l)<1e-8);}
});
test('stationary feet stay grounded; walking and running each include planted and swing phases without negative lift',()=>{
 for(const speed of [0,1.6,6]){let ground=0,air=0;for(let i=0;i<100;i++){const g=gaitFoot(i/100,speed);assert.ok(g.lift>=0&&g.lift<=.145);assert.ok(Math.abs(g.travel)<=.35);if(speed===0){assert.equal(g.travel,0);assert.equal(g.lift,0);}else if(g.lift===0)ground++;else air++;}if(speed>0){assert.ok(ground>20);assert.ok(air>20);}}
});
test('turn interpolation takes the short path across the angle wrap',()=>{assert.ok(Math.abs(angleDelta(-Math.PI+.04,Math.PI-.03)-.07)<1e-10);assert.ok(Math.abs(angleDelta(Math.PI-.03,-Math.PI+.04)+.07)<1e-10);});

test('steady walking and running keep a stance foot fixed as the body advances',()=>{
 for(const speed of [1.6,3,6]){const cycle=strideMeters(speed);const a=gaitFoot(.06,speed),b=gaitFoot(.16,speed);assert.equal(a.stance,true);assert.equal(b.stance,true);assert.ok(Math.abs(cycle*.1+b.travel-a.travel)<1e-9);}
});
