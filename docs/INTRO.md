# NEON BREACH title sequence

The intro is **staged in-engine capture**, rendered with the actual game's Three.js arena, PRESSURE / 07 human operator models, Pulse Rifle, materials, lights and firing effects. It is not AI-generated footage or a recording of a live multiplayer match. The capture harness directs existing operator poses and cameras inside the Shattered Relay; it adds no new armor family, weapon, vehicle, faction or setting. Gameplay rules and networking do not run inside this offline capture tool.

## Delivery

| File | Format | Size |
| --- | --- | --- |
| `public/intro/neon-breach-1080p.mp4` | 1920 × 1080, 30 fps, 18 seconds, H.264 with the original stereo soundtrack | 4,631,361 bytes (4.63 MB) |
| `public/intro/neon-breach-720p.mp4` | 1280 × 720, 30 fps, 18 seconds, H.264 fallback with the same framing and soundtrack | 2,613,456 bytes (2.61 MB) |

The browser requests these as `/intro/neon-breach-1080p.mp4` and `/intro/neon-breach-720p.mp4`. Small viewports of 960 pixels or less and browsers reporting data-saving mode select 720p first. A media error before playback tries the other resolution. The video fills the viewport with a centered crop, without letterboxing or a watermark. The rifle core, muzzle, title and tagline remain visible within the central portrait crop. Both exports have fast-start metadata, H.264 High profile in YUV 4:2:0, BT.709 color, and AAC stereo audio at 48 kHz / 96 kbps. No public deployment is claimed here.

## Verified release checks

- Both exports decoded completely: 540 frames each, exact 18-second duration, 30 fps, expected dimensions and codecs, each below 8 MB. See [encoding-report.json](../artifacts/intro/encoding-report.json).
- The production frontend, persistent server and standard Netlify Function built successfully. All 139 automated tests passed, including nine intro lifecycle tests.
- Nine production-browser acceptance checks passed using the actual MP4s: complete playback; gesture gating; one-second skip; room creation after playback; session reuse; lobby-seat recovery; separate-client Join; touch Solo and portrait crop; audio preferences; and fail-open behavior for missing files, stalls and rejected playback. The [browser report](../artifacts/intro/browser-report.json) identifies the tested files by hash and includes measured timings.
- Seven two-client gameplay regression checks passed, including authoritative touch movement and aim, three-hit elimination and scoring, dash collision, host transfer/disconnect winner, and labeled solo bots. This suite bypasses the already-tested intro. See [touch-report.json](../artifacts/realtime/touch-report.json).
- The soundtrack has no clipped or non-finite samples, and all five live-audio suppression/handoff checks passed. See [audio-report.json](../artifacts/intro/audio-report.json).

These checks used desktop Chrome and Chrome touch emulation against built production assets. A physical phone, Safari, human listening review and public deployment were not verified. Temporary capture and test servers are closed after use.

## Sequence

| Time | Existing game view and sound |
| --- | --- |
| 0–2 s | Black fades into a close view of a sealed human helmet and its cyan visor reflection. The existing quiet lobby motif starts over low station hum. |
| 2–5 s | A short pullback reveals the same relay chamber, damaged bulkheads, viewport and single center Phase Cell beam. The camera stays at operator eye height. |
| 5–8.5 s | A shoulder-level lateral drift shows the operator raising the original Pulse Rifle. One controlled pulse fires at 6.85 s: the existing core/muzzle effect, fast contained tracer and a compact armor impact. Music ducks for the game's actual electrical/mechanical shot sound. |
| 8.5–12 s | Hard cut to the second operator's magenta visor, then back to the relay and Phase Cell. One contained power swell accompanies the beam brightening. |
| 12–16 s | The exact title and tagline appear over the existing arena. The original score supplies one low pulse, with no voiceover or additional trailer impacts. |
| 16–18 s | The title and staged operators fade away, leaving the exact live lobby camera view. The soundtrack fades over its final 650 ms. |

Title text is exactly:

> NEON BREACH  
> The contract ends when the signal dies.

The title uses a sharp condensed system sans serif in cyan, with a muted white tagline and restrained shadow. No external font or artwork is downloaded. The shared final/lobby camera is at `(11.8, 1.6, 13.0)`, looking toward `(0, 1.5, -2)`, so the handoff uses the same arena, eye height and lighting.

## In-game trigger and failure behavior

The intro runs once per **tab session**, after the first trusted, valid **Create a room**, **Join**, or **Play Solo** click or keyboard submission. Callsign and join-code validation happen first. The session key is `nb-intro-seen-v1`; an in-memory claim prevents duplicate playback when session storage is unavailable. Refresh recovery of an existing lobby seat bypasses the sequence, as do later room entries in that session.

No room request is issued while the sequence is playing. At its end, or when skipped, the last frame stays visible while the room acknowledgement arrives. The actual lobby is rendered beneath it and the overlay fades away in 420 ms. This prevents another host from starting a match while the joining player is still watching the intro. Cancelling the entry invalidates its generation and prevents a delayed room request from opening a stale seat.

- Skip becomes available after one second, by its button or Escape. Keyboard focus remains within the accessible intro controls while the overlay is active.
- The video has `preload="none"` and `playsinline`. Its source is assigned and `play()` called only from the validated user gesture.
- A missing file, unsupported playback or a stalled load fails open to the normal room request. Load has a 4.5-second limit, stalls have a 2.5-second limit, and the overall media attempt is capped at 23 seconds. A backgrounded tab also stops the sequence. A six-second final-frame hold limit prevents a stalled room acknowledgement from trapping the overlay.
- Concurrent entry clicks share the pending operation. Automatic reconnect and recovery do not start another intro. Failure to open a room returns to the existing landing/error flow.

## Audio handoff

The baked soundtrack uses the game's own lobby score, station hum, Pulse Rifle and armor impact, Phase Cell hum, and one low pulse from its original combat score. See [the audio source and timing](INTRO-AUDIO.md).

Intro volume is **Master × Music**; persisted Mute, Master zero and Music zero all silence it. The intro Mute/Unmute control changes the same persisted game mute preference. A browser that rejects audible playback retries muted and offers an explicit Enable Audio gesture without changing the saved preference. There is no audio autoplay before interaction.

`Sound.setIntroPlaying(true)` suppresses live music, ambience and effects under the video, including late audio-unlock completion. Releasing it restores the live lobby music with a 600 ms fade. Existing Master, Music and Mute settings remain authoritative throughout the handoff, which completes in under one second. Muted play and room creation remain fully usable.

## Developer regeneration

These are developer capture/build steps, not commands required from players or hosting setup. Install the project's locked dependencies with Node 22.12 or newer. The browser scripts currently use locally installed macOS Chrome; capture requires WebGL support. They open temporary loopback capture servers and close them in `finally` blocks.

1. Audit the staged shots and title placement without capturing the entire sequence:

   ```sh
   npx tsx scripts/capture-intro.ts --preview
   ```

   Preview PNGs and `capture-report.json` are written under `artifacts/intro/`.

2. Render all 540 frames at exact 1/30-second steps:

   ```sh
   npx tsx scripts/capture-intro.ts
   ```

   The default frame directory is `/private/tmp/neon-intro-frames`, with names `0000.png` through `0539.png`. The optional `INTRO_FRAMES_DIR` override is only a developer output-path preference. `tests/intro-capture-harness.ts` uses the real game renderer and checks that the staged camera stays outside collision geometry.

3. Render the original soundtrack through Chrome's 48 kHz offline audio context:

   ```sh
   npx tsx scripts/intro-audio.ts
   ```

   This writes `artifacts/intro/intro-mix.wav` and `audio-report.json`, including measured peaks, clipping checks and live-audio suppression checks.

4. Encode the frames and soundtrack using the project encoder:

   ```sh
   node scripts/encode-intro.mjs
   ```

   FFmpeg with `libx264` support is required only to regenerate the movies. The first optional argument supplies its executable path; the second supplies the frame directory, for example `node scripts/encode-intro.mjs /path/to/ffmpeg /path/to/frames`. The soundtrack path is fixed at `artifacts/intro/intro-mix.wav`.

   The encoder produces the two files in `public/intro/` and `artifacts/intro/encoding-report.json`. It fully decodes both exports and checks H.264/AAC, 540 frames, 18 seconds, 30 fps, dimensions, under 8 MB per file and fast-start metadata. **FFmpeg and captured frames are not needed to build, publish or play the game**: the finished MP4s are shipped assets. Rebuild the frontend so its production assets include them.

5. Check playback and failures against the built production frontend:

   ```sh
   npm run build
   node --import tsx --test tests/intro-video.test.ts
   npx tsx tests/intro-browser.ts
   ```

   Unit tests cover gesture/session claims, skip timing, muted autoplay recovery, fallback resolution, stall/timeout behavior, cancellation and the last-frame handoff. The browser harness checks complete playback, real room entry, seat recovery, separate-browser joining, phone cropping, controls, preferences and deliberately broken media. Its report and screenshots are written to `artifacts/intro/`. Automated playback is not a human listening review or a claim that these files have been published to Netlify.
