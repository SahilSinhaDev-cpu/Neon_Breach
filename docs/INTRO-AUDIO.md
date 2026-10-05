# Neon Breach title sequence audio

The 18-second stereo soundtrack is an offline mix of the actual original game assets and effects. No reference soundtrack, external recording, speech, choir, sample pack or new melody is used. `scripts/intro-audio.ts` bundles the browser harness, renders through Chrome's 48 kHz `OfflineAudioContext`, measures the output and writes `artifacts/intro/intro-mix.wav` and `audio-report.json`. This is a build/capture tool, never a public game endpoint.

| Time | Source and treatment |
| --- | --- |
| 0.00 s | Existing `public/music/lobby.flac`, starting at its 3.75-second motif onset, quiet 0.8-second fade-in. This cue contains no percussion. |
| 0.00 s | Existing synthesized station vent/hum under the score, low-pass at 550 Hz. |
| 6.815 s | Score ducks to 22% over 35 ms, holds through 7.08 seconds and returns by 7.65 seconds. |
| 6.85 s | One real `AudioMixer.play('shot')`: the game's electrical discharge, weighted mechanism/body and short 270 ms tail. |
| 6.92 s | One spatially filtered `armor` impact at two meters. |
| 10.45 s | Existing `cellHum` sound swells once over 1.25 seconds. No pickup/reward chime is added. |
| 12.00 s | One 0.8-second, 225 Hz low-pass excerpt from the start of the original `combat.flac`, isolating the written low D pulse. |
| 17.35–18.00 s | 650 ms fade to silence, allowing the live lobby score to resume over 600 ms. |

The effect path uses the same buffers, filters, compressor and safety ceiling as the game. Numeric checks verify finite output, no clipped PCM samples, stereo/mono compatibility, one shot and one impact, and a quiet final 50 ms. These checks do not claim a human listening review.

`Sound.setIntroPlaying(true)` stops ongoing effects/ambience and suppresses all live score/effect scheduling while the video soundtrack plays. It also remains effective if the first audio-unlock promise resolves after playback starts. Calling `false` releases suppression and resumes lobby music with a 600 ms fade; existing Master/Music/Mute settings still apply. The video controller owns gesture gating, video volume and failure/skip cleanup.
