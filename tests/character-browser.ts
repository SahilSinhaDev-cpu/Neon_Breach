import {chromium}from'playwright';
import{build}from'esbuild';
import{mkdir,writeFile}from'node:fs/promises';
import assert from'node:assert/strict';
import{createGameServer,serveProduction}from'./legacy/app';
const bundle=await build({entryPoints:['tests/character-harness.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
const server=createGameServer();server.app.get('/__characterqa',(_q,r)=>r.type('html').send('<!doctype html><style>body{margin:0}canvas{display:block}</style><canvas></canvas><script src="/__characterqa.js"></script>'));server.app.get('/__characterqa.js',(_q,r)=>r.type('application/javascript').send(bundle.outputFiles[0].text));serveProduction(server.app);
await new Promise<void>(r=>server.http.listen(0,'127.0.0.1',r));const address=server.http.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{await mkdir('artifacts',{recursive:true});const p=await browser.newPage({viewport:{width:1280,height:900}});const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url+'/__characterqa');await p.waitForFunction(()=>(window as any).characterQA);
 const audit=await p.evaluate(()=>(window as any).characterQA.audit());console.log(JSON.stringify(audit));
 for(const[view,pose,age]of[['front','idle',.16],['side','idle',.16],['rear','idle',.16],['helmet','idle',.16],['lineup','idle',.16],['front','walk',.08],['front','run',.08],['side','up',.16],['side','down',.16],['front','fire',.033],['front','hit',.09],['front','dash',.09],['front','elimination',.32],['front','phase',.16],['front','protected',.16]]as const){await p.evaluate(({view,pose,age})=>(window as any).characterQA.frame(view,pose,age),{view,pose,age});await p.screenshot({path:`artifacts/character-${view}-${pose}.png`});}
 assert.deepEqual(errors,[]);assert.ok(audit.worstWrist<.00001);assert.ok(audit.worstFloor>-.003);assert.ok(audit.worstStretch<1.06);assert.equal(audit.restored,true);
 await writeFile('artifacts/character-studio-report.json',JSON.stringify({date:new Date().toISOString(),audit,errors},null,2));console.log('Character studio checks passed');
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();await server.close();}
if (!process.exitCode && !process.argv.includes('--studio')) await import('./character-live');

