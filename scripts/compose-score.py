"""Original Neon Breach score. No recordings, soundfonts, or reference tracks.
Rebuild: python3 -m pip install numpy soundfile; python3 scripts/compose-score.py
Only the generated FLACs are needed to run/build/deploy the game.
"""
from pathlib import Path
import json, hashlib
import numpy as np
import soundfile as sf

RATE = 32000
BEAT = .75  # 80 quarter notes/minute, five beats/bar
BAR = 5 * BEAT
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/music'
OUT.mkdir(parents=True, exist_ok=True)
RNG = np.random.default_rng(219107)
# D, A, Bb, E, G, F, D. The Bb -> E fracture answers the opening fifth.
MOTIF = [50, 57, 58, 52, 55, 53, 50]
RHYTHM = [0, 2.5, 4, 6, 7.5, 9, 12]
LENGTHS = [2.25, 1.2, 1.6, 1.2, 1.2, 2.4, 2.7]
# Eight-bar cycle, shared by all combat stems. Open voicings, few thirds.
CHORDS = [[38,50,57,64], [38,53,57,62], [34,50,57,65], [34,53,60,62],
          [43,50,57,65], [43,53,58,62], [36,50,55,64], [38,50,57,64]]

class Cue:
    def __init__(self, seconds, loop):
        self.seconds, self.loop = seconds, loop
        self.data = np.zeros((round(seconds * RATE), 2), dtype=np.float64)
    def add(self, mono, start, pan=0):
        # Narrow, positive-coefficient panorama: no polarity tricks or Haas widening.
        gains = np.array([np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)])
        i = round(start * RATE)
        if self.loop:
            ids = (np.arange(len(mono)) + i) % len(self.data)
            for ch in range(2): np.add.at(self.data[:, ch], ids, mono*gains[ch])
        else:
            lo, hi = max(0, -i), min(len(mono), len(self.data)-i)
            if hi > lo: self.data[i+lo:i+hi] += mono[lo:hi, None]*gains
    def note(self, midi, start, length, volume, voice='string', pan=0):
        t = np.arange(round(length*RATE))/RATE
        hz = 440*2**((midi-69)/12)
        phase = RNG.uniform(0, 2*np.pi)
        attack = {'string':.28,'horn':.18,'pulse':.045,'glass':.016,'pad':.75}[voice]
        release = min(length*.42, .9 if voice in ['pad','string'] else .38)
        env = np.minimum(1, t/attack)**1.5 * np.minimum(1, (length-t)/release)**2
        if voice == 'pulse': env *= np.exp(-t*4.5)
        if voice == 'glass': env *= np.exp(-t*2.6)
        vibrato = .009*np.sin(2*np.pi*4.7*t)*(1-np.exp(-t*2))
        x = np.zeros_like(t)
        partials = {'string':[1,.21,.13,.065,.029], 'pad':[1,.14,.035],
                    'horn':[1,.33,.16,.065], 'pulse':[1,.12,.018], 'glass':[1,.14,.06]}[voice]
        for h, weight in enumerate(partials,1):
            detune = 1 + (.0009 if voice in ['string','pad'] else 0)
            x += weight*(.62*np.sin(2*np.pi*hz*h*t+phase+vibrato*h) + .38*np.sin(2*np.pi*hz*h*detune*t+phase*.97+vibrato*h*.8))
        if voice == 'string': x *= .97+.03*np.sin(t*2*np.pi*1.13)
        self.add(x*env*volume, start, pan)
    def drum(self, start, volume, high=False):
        t = np.arange(round(.8*RATE))/RATE
        noise = RNG.normal(0,1,len(t))
        # Distant membrane/brush; no snare backbeat or cymbal wash.
        smooth = np.convolve(noise, np.ones(21 if high else 65)/(21 if high else 65), mode='same')
        x = (np.sin(2*np.pi*(104 if high else 52)*t + 1.8*(1-np.exp(-t*14)))*.7 + smooth*.4)
        self.add(x*(1-np.exp(-t/.012))*np.exp(-t/(.1 if high else .22))*volume, start, .08 if high else -.05)
    def motif(self, start, scale=1, octave=0, volume=.07, voice='string'):
        for i, (m, b, length) in enumerate(zip(MOTIF,RHYTHM,LENGTHS)):
            self.note(m+octave, start+b*BEAT*scale, length*BEAT*scale, volume*(.88 if i in [2,4] else 1), voice, -.10)
    def finish(self, name, target):
        n=len(self.data)
        # Compact, low-level same-channel room reflections, circular for loop stems.
        dry=self.data.copy()
        for delay, gain in [(.071,.12),(.139,.075),(.283,.038),(.431,.018)]:
            offset=round(delay*RATE)
            if self.loop: self.data += np.roll(dry, offset, axis=0)*gain
            else: self.data[offset:] += dry[:-offset]*gain
        spectrum=np.fft.rfft(self.data,axis=0); f=np.fft.rfftfreq(n,1/RATE)
        eq=(1/(1+(48/np.maximum(f,1))**4))*(1/(1+(f/3800)**4))
        eq*=1-.52*np.exp(-.5*((f-1750)/700)**2)
        self.data=np.fft.irfft(spectrum*eq[:,None],n=n,axis=0)
        if not self.loop:
            fade=min(round(.025*RATE),n); self.data[:fade]*=np.linspace(0,1,fade)[:,None]
            end=round(min(.7,self.seconds*.25)*RATE);self.data[-end:]*=np.linspace(1,0,end)[:,None]
        rms=np.sqrt(np.mean(self.data**2)); peak=np.max(np.abs(self.data))
        self.data*=min(target/max(rms,1e-9),.48/max(peak,1e-9))
        sf.write(OUT / (name+'.flac'), self.data, RATE, subtype='PCM_16', format='FLAC')
        decoded, _=sf.read(OUT/(name+'.flac'))
        mono=decoded.mean(axis=1)
        return {'seconds':self.seconds,'loop':self.loop,'sampleRate':RATE,'frames':n,
                'peak':float(np.max(np.abs(decoded))), 'rms':float(np.sqrt(np.mean(decoded**2))),
                'monoEnergyRatio':float(np.mean(mono**2)/np.mean(decoded**2)),
                'boundaryStep':float(np.max(np.abs(decoded[-1]-decoded[0]))),
                'bytes':(OUT/(name+'.flac')).stat().st_size,
                'sha256':hashlib.sha256((OUT/(name+'.flac')).read_bytes()).hexdigest()}

report={}
# 60 s: unhurried strings, sustained open dyads, separated motif statements.
c=Cue(60,True)
for bar in range(16):
    chord=CHORDS[(bar//2)%8]
    for j,m in enumerate(chord[:3]): c.note(m,bar*BAR, BAR+1.4,.022 if j else .028,'pad',[-.18,.18,0][j])
c.motif(3.75,scale=1.45,volume=.052)
c.motif(33.75,scale=1.45,octave=12,volume=.028)
report['lobby']=c.finish('lobby',.073)
# 30 s combat cycle. The five-beat grouping avoids a constant driving backbeat.
c=Cue(30,True)
for bar,chord in enumerate(CHORDS):
    for j,m in enumerate(chord): c.note(m,bar*BAR, BAR+1.15,.028 if j<2 else .012,'pad',(-.18 if j%2 else .18))
    for beat,level in [(0,.040),(2.5,.025),(4,.018)]: c.note(chord[0]+12,bar*BAR+beat*BEAT,.5,level,'pulse',0)
c.motif(0,scale=.72,volume=.028,voice='string')
# Space in the second half: a quiet answer, not a second full lead.
for i,m in enumerate([55,53,50]):c.note(m,18.75+i*1.5,2.1,.025,'string',.08)
report['combat']=c.finish('combat',.072)
c=Cue(30,True)
for bar,chord in enumerate(CHORDS):
    for beat,v in [(0,.08),(1.5,.034),(3.5,.045)]:c.drum(bar*BAR+beat*BEAT,v)
    c.drum(bar*BAR+4.25*BEAT,.045,True)
    for beat,m in [(0,chord[1]),(2.5,chord[2])]:c.note(m,bar*BAR+beat*BEAT,1.0,.035,'string',.08)
report['intensity']=c.finish('intensity',.047)
c=Cue(30,True)
c.motif(0,scale=1.5,octave=12,volume=.067,voice='horn')
for bar,chord in enumerate(CHORDS):
    for j,m in enumerate(chord[1:]):c.note(m+12,bar*BAR,BAR+.7,.012,'string',(-.16 if j%2 else .16))
for i,m in enumerate([69,67,65,62]):c.note(m,19.5+i*2.0,2.5,.042,'horn',0)
report['final']=c.finish('final',.083)
c=Cue(7.5,False)
for m in [38,50,57,64]:c.note(m,0,7.45,.033,'pad')
c.motif(.2,scale=.54,volume=.063,voice='string')
for t,v in [(3.75,.05),(5.625,.065),(6.75,.08)]:c.drum(t,v)
report['start']=c.finish('start',.088)
c=Cue(7.5,False)
c.motif(.12,scale=.42,octave=12,volume=.07,voice='horn')
for m in [38,50,57,65]:c.note(m,.03,7.3,.033,'string',.08)
c.note(62,4.8,2.65,.078,'horn',0)
report['victory']=c.finish('victory',.105)
c=Cue(5,False)
for m in [38,50,57,64]:c.note(m,0,4.98,.024,'pad')
for m,t,l in [(50,.1,1.2),(57,1.0,1.25),(52,2.15,1.25),(50,3.1,1.8)]:c.note(m,t,l,.055,'string')
report['defeat']=c.finish('defeat',.075)
c=Cue(2.25,False)
for i,m in enumerate([74,81,76]):c.note(m,i*.18,1.8,.037,'glass',0)
report['shimmer']=c.finish('shimmer',.043)
manifest={'title':'Signal / Inheritance','authorship':'Original algorithmic composition and additive synthesis authored for Neon Breach by the coding assistant. No sampled recordings, reference-track input, soundfonts, lyrics, or third-party music assets. No human composer or listening review claimed.',
 'motif':{'midi':MOTIF,'beatOffsets':RHYTHM,'beatLengths':LENGTHS,'tempo':80,'meter':'5/4'},'cues':report}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(report),'bytes':sum(x['bytes'] for x in report.values()),'cues':report},indent=2))
