// Test server only. The production game has no music/debug globals.
import { Sound } from '../client/audio';
import { AudioMixer } from '../client/audio-mixer';
import { DEFAULT_AUDIO } from '../client/audio-design';
import { SCORE, type Cue, type MusicDirector } from '../client/music';
import type { Snapshot, GameEvent } from '../shared/protocol';
const sound = new Sound();
document.querySelector('button')!.onclick = () => sound.unlock();
const music = () => (sound as unknown as {music:MusicDirector}).music;
const me = {id:'A',name:'A',color:'#fff',order:0,connected:true,bot:false,x:0,z:0,yaw:0,pitch:0,hp:100,score:0,scoreAt:0,deaths:0,respawnAt:0,protectUntil:0,phaseUntil:0,dashAt:0,ack:0,life:1};
let match=1;
function snapshot(phase:'lobby'|'playing'|'ended', elapsed=0, winner='A'):Snapshot {return {code:'MUSICA',mode:'multiplayer',phase,host:'A',now:1000+elapsed*1000,startedAt:1000,endsAt:181000,players:[{...me}],cell:false,cellAt:21000,winner,reason:'',match};}
setInterval(() => music()?.update(), 33);
const report = () => ({state:music().state,metrics:music().metrics});
function step(phase:'lobby'|'playing'|'ended',elapsed=0,winner='A') {sound.receive(snapshot(phase,elapsed,winner),'A');return report();}
function shot(x=0) {const event:GameEvent={type:'shot',shot:{from:{x,y:1.6,z:0},to:{x:0,y:1.6,z:0},shooter:x===0?'A':'B',hit:null,damage:false,phased:false}};sound.event(event);return report();}
function measure(buffer:AudioBuffer,start=0,end=buffer.duration) {let peak=0,energy=0,n=0;for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);for(let i=Math.floor(start*buffer.sampleRate);i<Math.min(data.length,Math.floor(end*buffer.sampleRate));i++){const x=data[i];if(!Number.isFinite(x))throw Error('Non-finite signal');peak=Math.max(peak,Math.abs(x));energy+=x*x;n++;}}return {peak,rms:Math.sqrt(energy/n),energy};}
async function render(kind:'score'|'shot'|'step'|'combined', settings=DEFAULT_AUDIO, duck=false){
 const c=new OfflineAudioContext(2,24000*10,24000),m=new AudioMixer(c,settings);
 if(kind==='score'||kind==='combined')for(const [cue,level]of [['combat',.72],['intensity',.8],['final',.85]]as const){
  const source=c.createBufferSource(),g=c.createGain();source.buffer=music().buffers.get(cue)!;source.loop=true;g.gain.value=.12*level;source.connect(g);g.connect(m.buses.music);source.start(0,14);
  if(duck){g.gain.setTargetAtTime(.12*level*.28,2,.012);g.gain.setTargetAtTime(.12*level,2.18,.26);}
 }
 if(kind==='shot'||kind==='combined')for(let t=2;t<8;t+=.28)m.play('shot',{at:t,gain:.85,priority:100});
 if(kind==='step'||kind==='combined')for(let t=2;t<8;t+=.34)m.play('step',{at:t,gain:.25,priority:55});
 return await c.startRendering();
}
function wav(buffer:AudioBuffer){const n=buffer.length,a=new Uint8Array(44+n*4),d=new DataView(a.buffer);const str=(i:number,s:string)=>[...s].forEach((c,j)=>d.setUint8(i+j,c.charCodeAt(0)));str(0,'RIFF');d.setUint32(4,a.length-8,true);str(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,2,true);d.setUint32(24,buffer.sampleRate,true);d.setUint32(28,buffer.sampleRate*4,true);d.setUint16(32,4,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,n*4,true);for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++)d.setInt16(44+i*4+ch*2,Math.round(Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]))*32767),true);let b='';for(let i=0;i<a.length;i+=8192)b+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(b);}
async function lab(){
 await music().ready;
 const assets=Object.fromEntries([...music().buffers].map(([cue,b])=>{const l=b.getChannelData(0),r=b.getChannelData(1);let stereo=0,mono=0;for(let i=0;i<l.length;i++){stereo+=(l[i]*l[i]+r[i]*r[i])*.5;mono+=((l[i]+r[i])*.5)**2;}return[cue,{duration:b.duration,channels:b.numberOfChannels,rate:b.sampleRate,boundary:Math.max(Math.abs(l[0]-l.at(-1)!),Math.abs(r[0]-r.at(-1)!)),monoEnergyRatio:mono/stereo}];}));
 const score=await render('score'),shot=await render('shot'),foot=await render('step'),combined=await render('combined',DEFAULT_AUDIO,true),ducked=await render('score',DEFAULT_AUDIO,true);
 const silence=[];for(const patch of [{music:0},{master:0},{muted:true}])silence.push(measure(await render('score',{...DEFAULT_AUDIO,...patch})).energy);
 return{assets,score:measure(score,2,2.18),shot:measure(shot,2,2.18),foot:measure(foot,2,2.18),combined:measure(combined),ducked:measure(ducked,2,2.18),silence,wav:wav(combined)};
}
Object.assign(window,{musicQA:{sound,report,step,shot,lab,ready:()=>music().ready,configure:(patch:any)=>sound.configure(patch),pickup:()=>{sound.event({type:'cell',player:'A'});return report();},next:()=>match++,disconnect:()=>sound.disconnect(),clear:()=>sound.clear(),pause:(v:boolean)=>music().pause(v),event:(e:GameEvent)=>sound.event(e)}});
