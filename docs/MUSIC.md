# Signal / Inheritance — Neon Breach score

An original connected score built for this project, using written note sequences and deterministic additive synthesis. The music uses no recordings, soundfonts, sample packs, reference-track input, or intelligible voices. The composition and sound-generation source is `scripts/compose-score.py`; `public/music/manifest.json` records the notes, timing, cue lengths, PCM measurements, byte sizes, and SHA-256 hashes. These original project assets are supplied for use, modification, and distribution with Neon Breach. No third-party music asset license or attribution is needed. The author is the coding assistant; no human composer or listening review is claimed.

## Composition

The seven-note motif is **D–A–B♭–E–G–F–D**. Its opening fifth is interrupted by the B♭–E tritone, then settles through G and F to D. Beat onsets are 0, 2.5, 4, 6, 7.5, 9, and 12. A slow **80 BPM, 5/4** framework leaves gaps between gestures. Open minor/add-nine voicings and a shared eight-bar harmonic cycle connect the combat stems. Low, searching strings carry the lobby line; shorter phrases sit inside combat; a higher, stretched horn-like line returns in the final minute and resolves briefly on victory.

The instruments are original synthesized string-like pads, soft brass-like partials, restrained low pulses, distant membrane percussion, and a small glass-like shimmer. There are no lyrics or choir. Midrange attenuation around 1.75 kHz leaves room for rifle and footstep texture. Positive-coefficient narrow stereo panning preserves mono compatibility and avoids spatial effects that could be confused with an opponent.

| Cue | Length | Arrangement / behavior |
| --- | --- | --- |
| Lobby | 60 s loop | Low sustained dyads, two widely spaced motif statements; no percussion |
| Match start | 7.5 s once | Compressed motif over sustained harmony, three restrained low drum entries |
| Combat bed | 30 s loop | Shared harmonic cycle, sparse five-beat pulses, quiet motif and answer |
| Intensity | 30 s aligned loop | Membrane percussion and closer string intervals; gain follows recent engagement |
| Final minute | 30 s aligned loop | Broader, higher motif over the same harmony, entering once at 60 s remaining |
| Victory | 7.5 s once | Short complete motif and a held D resolution |
| Contract lost | 5 s once | Low partial motif, restrained return to D |
| Phase shimmer | 2.25 s once | Three soft high tones, only for the local holder |

## Playback and mix

`client/music.ts` owns only client-side music. It reads existing snapshots/events; it changes no server rule, network packet, damage, movement, scoring, or match clock.

- Lobby and combat fetch immediately when the page loads. Other cues follow those priority requests. Playback and decoding use the existing interaction-driven audio path. Essential procedural game effects remain independent of music files.
- Assets are lossless compressed **FLAC, stereo, 32 kHz / 16-bit**: 3,631,667 bytes in total. Decoded buffers stay at 32 kHz (approximately 44 MB total PCM) instead of expanding to the output device rate. They ship inside the project and need no external audio service. Modern Chrome decoding is verified; other browsers and physical phones remain unverified.
- Loop tails/reflections are wrapped during composition. Sample-exact loop lengths avoid encoder priming, silence padding, and rescheduling gaps. Combat, intensity, and final use the same match-derived transport offset. Their sources keep running while layer gain fades, so intensity does not restart on each firefight.
- Combat fades in over the last 0.75 s of the start cue. If the start file is unavailable or still loading, the preloaded combat bed fills in. Late assets join the current position rather than replaying a stale intro. A failed fetch/decode is contained and never blocks the room, controls, or effects.
- A confirmed local shot, a shot hitting the local operator, or a shot originating within **16 m** of a living local player enables intensity for **4.5 s**. Intensity fades up in **0.45 s**, then down in **1.8 s** after the fight calms. Downed operators do not sustain intensity. Kills trigger no musical sting.
- The same nearby shot ducks all music to **28%** of its current level with a **12 ms** attack, **180 ms** hold, and **260 ms** recovery time constant. Repeated shots extend the duck; they do not multiply attenuation. Distant gunfire leaves the music unchanged.
- The final-minute layer enters once from authoritative remaining time. Combat bed gain lowers to 72% and the broader layer fades up over 1.6 s. The final layer loops until the actual result.
- Results fade combat to zero in 120 ms, then begin the appropriate ending after 140 ms. No combat source survives under the ending. Each ending finishes once. Replay/leave returns to lobby with a **1.6 s** crossfade.
- A fixed 0.12 music trim feeds the Music bus, then the existing compressor, safety ceiling, Master, and Mute. Default Music is **40%**. The independent slider persists with the other controls under `nb-audio`; old settings migrate to the default. Music zero stops score sources while gameplay effects continue. Master zero and Mute silence the full mix.
- Hidden pages stop music sources and suspend audio. On resume, current server snapshots correct transport position. Disconnect stops the score; no missed shots or kill stings are queued.

## Rebuild and verification

Generated assets are included, so normal `npm ci`, `npm run build`, and deployment require no Python or audio tool installation. To edit/re-render the composition, use Python 3 with `numpy` and `soundfile`, then run:

```sh
python3 scripts/compose-score.py
npm test
npm run build
npm run test:music
```

The score suite checks actual browser decoding, loop bounds, mono energy, offline mix levels, ducking, mute buses, adaptive state, endings, suspension, and cleanup. Its full mode drives two production-browser clients through two natural 180-second matches, first with music on and then with Music at zero. It also tests slider persistence, touch settings, and total music-file failure. Controlled starting poses exist only in the test process; no debug endpoints or match-clock overrides are added to the game.

The 2 October 2026 run passed all 11 score checks, including both complete three-minute matches. A separate production-output probe verified actual music signal and zero output under Music zero, Master zero, and Mute (`artifacts/music-controls-report.json`). See `artifacts/music-report.json` for the latest executed result and `docs/TEST-REPORT.md` for the release evidence. `artifacts/music-mix-review.wav` is a ten-second review render: music alone for the first two seconds, followed by existing rifle/footstep sounds underneath the score. Individual cues are available in `public/music/`.

**None of the cues has been verified by ear here.** Numerical level/loop tests cannot establish emotional impact, perceptual masking, fatigue over three minutes, or resemblance to an existing soundtrack. No reference music was supplied to the generator, but a human familiarity/listening review is still needed before approving those qualities. No cue is claimed to have passed a human originality audit, and no cue was rejected on the basis of an auditory comparison that did not occur. Physical phone/headphone/speaker behavior, two-human play, and public deployment are separate unverified requirements.
