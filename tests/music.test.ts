import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SCORE, nearbyEngagement, type Cue } from '../client/music';
import { audioSettings, DEFAULT_AUDIO } from '../client/audio-design';
import type { GameEvent, Snapshot } from '../shared/protocol';

test('all original score assets match the composition record, loop lengths, and compressed size budget', () => {
  const manifest = JSON.parse(readFileSync('public/music/manifest.json', 'utf8')); let total = 0;
  for (const cue of Object.keys(SCORE) as Cue[]) {
    const asset = readFileSync(`public/music/${cue}.flac`), m = manifest.cues[cue]; total += asset.length;
    assert.equal(asset.subarray(0,4).toString(),'fLaC');
    assert.equal(createHash('sha256').update(asset).digest('hex'),m.sha256);
    assert.equal(m.seconds,SCORE[cue].seconds); assert.equal(m.loop,SCORE[cue].loop);
    assert.ok(m.peak<.49 && m.rms>.03); assert.ok(m.monoEnergyRatio>.97);
    assert.ok(m.boundaryStep<.006); assert.equal(m.frames,m.seconds*m.sampleRate);
  }
  assert.ok(total<4_000_000); assert.ok(SCORE.lobby.seconds>=45 && SCORE.lobby.seconds<=90);
});
test('music migrates independently, rejects invalid preferences, and follows existing mute settings', () => {
  assert.equal(audioSettings({effects:.2}).music,DEFAULT_AUDIO.music);
  assert.equal(audioSettings({music:0}).music,0); assert.equal(audioSettings({music:NaN}).music,.4);
  assert.equal(audioSettings({music:4}).music,1); assert.equal(audioSettings({music:-1}).music,0);
  assert.equal(audioSettings({music:1,muted:true}).muted,true);
});
test('engagement is local or within 16 meters, never a kill sting or spectator/downed trigger', () => {
  const s = {phase:'playing',players:[{id:'me',connected:true,hp:100,x:0,z:0}]} as Snapshot;
  const shot = (x:number,shooter='remote',hit:string|null=null):GameEvent=>({type:'shot',shot:{from:{x,y:1.6,z:0},to:{x:0,y:1.6,z:0},shooter,hit,damage:!!hit,phased:false}});
  assert.equal(nearbyEngagement(s,'me',shot(16)),true); assert.equal(nearbyEngagement(s,'me',shot(16.1)),false);
  assert.equal(nearbyEngagement(s,'me',shot(30,'remote','me')),true);
  assert.equal(nearbyEngagement(s,'me',{type:'kill',killer:'me',victim:'remote'}),false);
  assert.equal(nearbyEngagement(s,'outsider',shot(0)),false);
  s.players[0].hp=0; assert.equal(nearbyEngagement(s,'me',shot(0)),false);
  s.players[0].hp=100;s.phase='ended';assert.equal(nearbyEngagement(s,'me',shot(0)),false);
});
