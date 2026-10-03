import {chromium,type Page} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createGameServer,serveProduction} from './legacy/app';
import type {Room,Player} from '../server/game';
import type {GameEvent,Snapshot} from '../shared/protocol';

const preview=process.argv.includes('--preview');
const bundle=await build({entryPoints:['tests/weapon-harness.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
const server=createGameServer();
server.app.get('/__weaponqa',(_q,r)=>r.type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{display:block}</style><canvas></canvas><script src="/__weaponqa.js"></script>'));
server.app.get('/__weaponqa.js',(_q,r)=>r.type('application/javascript').send(bundle.outputFiles[0].text));serveProduction(server.app);
await new Promise<void>(r=>server.http.listen(0,'127.0.0.1',r));const address=server.http.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
const hardware=process.env.NB_RENDERER==='metal';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-webgl',...(hardware?['--use-angle=metal']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']),'--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const checks:string[]=[],errors:string[]=[];const check=(s:string)=>{checks.push(s);console.log('PASS '+s);};
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(predicate:()=>boolean,label:string,timeout=6000){const start=performance.now();while(!predicate()){if(performance.now()-start>timeout)throw Error(label);await pause(20);}}
function observe(page:Page){const wire:{snapshot:Snapshot|null;shots:{at:number;event:GameEvent}[]}={snapshot:null,shots:[]};page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|WebGL|shader/.test(m.text()))errors.push(m.text());});page.on('websocket',ws=>ws.on('framereceived',frame=>{const raw=frame.payload.toString();if(!raw.startsWith('42['))return;const event=JSON.parse(raw.slice(2));if(event[0]==='snapshot')wire.snapshot=event[1];if(event[0]==='event'&&event[1].type==='shot')wire.shots.push({at:performance.now(),event:event[1]});}));return wire;}
let room:Room,pa:Player,pb:Player;
async function pose(placements:{p:Player;x:number;z:number;yaw?:number;pitch?:number}[]){placements.forEach(({p})=>Object.assign(p,{hp:0,input:null,respawnAt:performance.now()+60000}));await pause(180);placements.forEach(({p,x,z,yaw=0,pitch=0})=>Object.assign(p,{x,z,yaw,pitch,hp:100,protectUntil:0,respawnAt:0,input:null,life:p.life+1}));server.io.to(room.code).emit('snapshot',room.snapshot(performance.now()));await pause(220);}
async function lock(page:Page){await page.bringToFront();if(await page.locator('#resume').isVisible())await page.locator('#resume-button').click();await page.waitForFunction(()=>document.pointerLockElement?.id==='arena');}
await mkdir('artifacts',{recursive:true});
try{
  const lab=await browser.newPage({viewport:{width:1280,height:800}});observe(lab);await lab.goto(url+'/__weaponqa');await lab.waitForFunction(()=>(window as any).weaponQA);
  const geometry=await lab.evaluate(()=>(window as any).weaponQA.audit());assert.deepEqual(geometry.obstruction,[]);assert.ok(geometry.third.triangles<geometry.first.triangles);
  check('Crosshair region stays clear in desktop, landscape phone, portrait phone, and recoil poses; remote rifle uses fewer triangles');
  for(const [mode,age,name,silhouette] of [['first',.3,'first-person',false],['first',.025,'discharge',false],['first',.3,'silhouette',true],['side',.3,'third-side',false],['front',.3,'third-front',false]] as const){await lab.evaluate(({mode,age,silhouette})=>(window as any).weaponQA.frame(mode,age,silhouette),{mode,age,silhouette});await lab.screenshot({path:`artifacts/weapon-${name}.png`});}
  console.log(JSON.stringify({geometry}));await lab.close();
  if(!preview){
    const ca=await browser.newContext({viewport:{width:1280,height:800}}),cb=await browser.newContext({viewport:{width:960,height:640}}),a=await ca.newPage(),b=await cb.newPage();const wa=observe(a),wb=observe(b);
    await a.addInitScript({content:'globalThis.__name = function(target){return target;}; (' + (()=>{const data={frames:[] as number[],last:0,active:false,shotAudio:0};(window as any).weaponMetrics=data;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer&&Math.abs(this.buffer.duration-.27)<.001)data.shotAudio++;return Reflect.apply(start,this,args);};function tick(time:number){if(data.active&&data.last)data.frames.push(time-data.last);data.last=time;requestAnimationFrame(tick);}requestAnimationFrame(tick);}).toString() + ')();'});
    await Promise.all([a.goto(url),b.goto(url)]);await a.locator('#landing-connection').filter({hasText:'STATION ONLINE'}).waitFor();
    await a.locator('#callsign').fill('PULSEVEX');await a.locator('#create').click();await a.locator('#lobby').waitFor({state:'visible'});const code=(await a.locator('#lobby-code').textContent())!;
    await b.locator('#callsign').fill('PULSENYX');await b.locator('#room-code').fill(code);await b.locator('#join').click();await b.locator('#lobby').waitFor({state:'visible'});room=server.rooms.rooms.get(code)!;[pa,pb]=room.connected();
    await a.bringToFront();await a.locator('#start').click();await a.locator('#hud').waitFor({state:'visible'});await b.locator('#hud').waitFor({state:'visible'});await lock(a);
    await a.evaluate(()=>(window as any).weaponMetrics.active=true);
    for(const [distance,label] of [[2.5,'close'],[10,'medium'],[24,'long']] as const){await pose([{p:pa,x:-12,z:14},{p:pb,x:-12,z:14-distance,yaw:Math.PI/2}]);await a.screenshot({path:`artifacts/weapon-live-${label}.png`});await lock(b);const shotCount=wa.shots.length;await b.mouse.down();await until(()=>wa.shots.length>shotCount+1,'remote shots not received');await pause(20);await a.screenshot({path:`artifacts/weapon-remote-fire-${label}.png`});await b.mouse.up();await lock(a);assert.ok(wa.shots.some(s=>s.event.type==='shot'&&s.event.shot.shooter===pb.id));}
    check('Two live clients show the shared weapon design and confirmed remote firing at 2.5, 10, and 24 meters');
    await pose([{p:pa,x:-12,z:10},{p:pb,x:-12,z:5,yaw:Math.PI}]);const score=pa.score;for(const hp of [66,32,0]){await a.mouse.down();await until(()=>pb.hp===hp,'34-damage hit did not reach expected health '+hp,2500);await a.mouse.up();await pause(310);}assert.equal(pa.score,score+1);
    const hits=wb.shots.filter(s=>s.event.type==='shot'&&s.event.shot.shooter===pa.id&&s.event.shot.hit===pb.id);assert.equal(hits.length,3);assert.ok(hits.every(s=>s.event.type==='shot'&&s.event.shot.damage===true));
    check('New rifle retains three server-confirmed 34-damage hits per elimination');
    await until(()=>pb.hp>0,'respawn failed',6500);await pause(1100);
    await pose([{p:pa,x:0,z:2},{p:pb,x:0,z:-8}]);await a.mouse.down();await pause(800);await a.mouse.up();assert.equal(pb.hp,100);check('New tracer and impact effects preserve server cover blocking');
    await pose([{p:pa,x:-12,z:15},{p:pb,x:12,z:15,yaw:Math.PI}]);await lock(a);
    const before=wa.shots.length,audioBefore=await a.evaluate(()=>(window as any).weaponMetrics.shotAudio),start=performance.now();await a.mouse.down();
    for(let i=0;i<4;i++){await pause(7500);if(i===1)await a.screenshot({path:'artifacts/weapon-live-continuous.png'});console.log(`HELD FIRE ${Math.floor((performance.now()-start)/1000)} seconds`);}
    await a.mouse.up();const heldMs=performance.now()-start;const fired=wa.shots.slice(before).filter(s=>s.event.type==='shot'&&s.event.shot.shooter===pa.id);assert.ok(fired.length>=95&&fired.length<=109);assert.equal(room.connected().length,2);assert.equal(room.phase,'playing');
    const audioCount=await a.evaluate(()=>(window as any).weaponMetrics.shotAudio)-audioBefore;assert.ok(audioCount>=fired.length-2);
    check('Thirty seconds of held fire keeps the crosshair visible, match connected, cadence bounded, and one rifle sound per confirmed shot');
    await a.keyboard.down('w');await pause(600);await a.keyboard.up('w');await until(()=>!!wb.snapshot?.players.some(p=>p.id===pa.id&&p.z<13),'remote movement missing');check('Movement and remote snapshots remain responsive while using the upgraded viewmodel');
    const metrics=await a.evaluate(()=>{const d=(window as any).weaponMetrics;d.active=false;const f=(d.frames as number[]).sort((a,b)=>a-b),g=(document.querySelector('#arena') as HTMLCanvasElement).getContext('webgl2')!,e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),frames:f.length,medianMs:f[Math.floor(f.length*.5)],p95Ms:f[Math.floor(f.length*.95)]};});
    assert.ok(metrics.frames>200,'frame recorder did not run');
    await cb.close();await a.locator('#results').waitFor({state:'visible'});await a.locator('#replay').click();await a.locator('#lobby').waitFor({state:'visible'});assert.equal(pa.score,0);check('Disconnect result and clean replay still work');assert.deepEqual(errors,[]);
    await writeFile('artifacts/weapon-report.json',JSON.stringify({date:new Date().toISOString(),checks,errors,geometry,metrics,heldFire:{durationMs:heldMs,shots:fired.length,audioCount},limitations:['Automated browsers on one computer; no two-human physical-device test.','Hands and materials reviewed visually, not against anatomical ground truth.','Electrical/mechanical sound event alignment measured; subjective listening not verified.','One-second futuristic recognition requires a new-player study.']},null,2));console.log(JSON.stringify({checks:checks.length,metrics}));
  }
}catch(error){console.error(error);for(const [i,p]of browser.contexts().flatMap(c=>c.pages()).entries())await p.screenshot({path:`artifacts/failure-weapon-${i}.png`}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();await server.close();}
