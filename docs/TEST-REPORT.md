> Historical pre-Netlify/WebSocket evidence. For the current function deployment, see [NETLIFY-TEST-REPORT.md](NETLIFY-TEST-REPORT.md).

# Verification report — reviewed 2 October 2026

**Local implementation verified. Public release not completed.**

## Executed checks

| Check | Result | Scope |
|---|---|---|
| `npm run check` / TypeScript through build | PASS | Strict types for client, shared code, server, and tests |
| `npm run build` | PASS | Vite production client plus bundled Node server; Three.js chunk is about 525 kB raw / 133 kB gzip; standard Vite 500 kB chunk warning is present |
| `npm test` | PASS: 66 tests, 0 failures | 39 deterministic rule/solo/environment tests, two real Socket.IO integration tests, six audio signal/settings tests, three score asset/engagement/settings tests, four visual-rig math tests, and 12 pulse motion/contact/pool tests |
| `npm run test:browser` | PASS: 22 checks, 0 page errors | Built production assets; headless local Chrome; independent browser contexts; emulated mobile touch |
| `npm run test:audio` | PASS: 13 checks, 0 page errors | Chromium signal rendering, real 60-second firing, spatial routing, mix settings, failure fallback, and emulated touch activation; not listening by ear |
| `npm run test:environment` | PASS: 12 checks, 0 page/shader errors | Full natural 180-second two-client match; eye-height landmark review; shared-solid bounds; software-renderer measurements |
| `NB_RENDERER=metal npm run test:environment` | PASS: 12 checks, 0 page/shader errors | Full 180-second match on Apple M4 GPU; 16.7 ms median / 17.9 ms p95 frame interval at 1280 × 800 |
| `NB_RENDERER=metal npm run test:weapon` | PASS: 7 checks, 0 page errors | Close/medium/long two-client combat; clear crosshair; 105 shots and 105 sound starts during 30 seconds of held fire |
| `npm run test:music` | PASS: 11 checks, 0 page errors | Eight decoded cues, adaptive mix/lifecycle, two natural 180-second production-browser matches with Music on/off, touch settings, and file-failure fallback |
| Production music-output check | PASS | Actual local-preview destination has music signal; Music zero, Master zero, and Mute measure zero output; restoring Music resumes signal |
| `npm run test:vfx` | PASS: 14 checks, 0 page/shader errors | Studio plus natural 180-second two-client match; close/medium/long pulses, surface effects, held fire/audio, effects cleanup, timeout/replay; Apple M4 / Metal median/p95 16.7 ms |
| `npm run test:character` | PASS: studio audit + 8 live checks, 0 page errors | Four production Chrome contexts with all armor colors; remote actions, combat, respawn, phasing, cover, replay; Apple M4 / Metal primary frame intervals median/p95 16.7 ms |
| `NB_RENDERER=metal npm run test:weapon -- --preview` | PASS | Current shared gloves/forearms; clear crosshair in desktop/phone aspect ratios and sampled recoil |
| Dependency install audit | PASS at install | npm reported 0 dependency vulnerabilities; not a full security audit |

The general gameplay browser suite was rerun after the VFX overhaul at **21:13 IST on 2 October 2026** and again passed all 22 checks. Its machine-readable results and exact timestamp are in `artifacts/browser-report.json`. Historical environment/rifle/character performance figures measure their earlier builds; the final two-client VFX measurement is recorded below. The generated browser-test URL was temporary and local, not a deployment URL. The final local preview uses the production entrypoint at `http://localhost:3000`.

### Rules and networking

The original 26 automated tests verify code generation and collision retry; malformed callsigns/codes; missing/full rooms; duplicate callsigns; host-only start with exactly two connected players; lobby seat recovery without duplicate entries; host transfer before/during matches; active-match join rejection; empty-room and lobby-seat expiration; valid farthest-pad spawns; bounded movement and stale-input stopping; wall/pillar/cover collision; six-meter dash with its three-second cooldown; hitscan damage; rapid-fire rejection; three-hit elimination; nearest obstruction/target behavior; dead/disconnected action rejection; five-second respawn; the exact one-second protection boundary for both firing and damage; cell spawn/pickup/expiration/replacement; phased damage, movement, hittability, and tracer flags; immediate ten-elimination victory; timeout and all tie cases; last-connected victory; replay reset; input validation; private-token exclusion; and token-bucket rate limiting.

The socket integration test starts a real HTTP/Socket.IO server and connects three independent clients over WebSocket. It verifies shared movement, server damage, host transfer, continuing with two players, winning with one, and clean replay. Combat positions are controlled test fixtures inside the server; clients cannot submit those positions through the public protocol.

### Solo-mode regression coverage

Eleven additional automated tests cover creation of one human and three unique, labeled bots; private-room membership and token recovery; bot-seat impersonation rejection; human-only multiplayer behavior; one-human start without an automatic victory; shared bot damage, respawn and protection; human and bot win conditions; timeout ranking; replay without duplicate bots; abandonment/expiration without a bot host; and collision-safe navigation around both pillars and center cover. A full simulated solo match runs through movement, firing, eliminations, respawns, and a winner, with per-tick collision/speed assertions and shot-cooldown checks. A real Socket.IO solo integration test verifies the public room/action protocol and rejects forged mode/bot fields.

### Browser acceptance

All 22 checks passed against production-built assets:

1. Landing, WebGL rendering, and all seven rules load.
2. Independent browser sessions create and join one room; only host starts.
3. Lobby refresh recovers the same player ID.
4. WASD changes authoritative position and the second browser receives that movement.
5. Pointer-lock mouse input changes authoritative aim.
6. Escape releases the cursor; Click to resume recaptures it.
7. Held mouse fire eliminates after three hits, updates scores, and shows respawn HUD.
8. The real five-second respawn and one-second visible protection run.
9. Central cover blocks browser-fired shots.
10. Dash stops at a wall; immediate reuse is rejected.
11. The first cell naturally spawns after 20 seconds, is picked up by moving, shows PHASE, and expires after four seconds.
12. Disconnect produces the correct winner; replay resets to a lobby that requires two players.
13. Mobile portrait landing fits; emulated touch joystick moves without scrolling.
14. Right-side touch drag changes aim.
15. Mobile Fire eliminates the operator controlled by the other browser.
16. Mobile Dash moves six meters and enters cooldown.
17. Play Solo creates a private one-human lobby with three explicit BOT labels and enabled Start.
18. Solo lobby refresh recovers the same human without duplicating bots.
19. One-human solo matches continue while server bots move and fire autonomously.
20. Solo results identify a bot winner; replay resets all four operators and permits another solo start.
21. Leaving solo stops the match and makes the room eligible for expiration.
22. No JavaScript page errors occur across multiplayer, mobile, and solo sessions.

Desktop viewport: 1440×960 (second desktop 1280×800). Mobile emulation: 390×844 portrait and 844×390 landscape, touch-enabled Chromium. Earlier runs used SwiftShader software WebGL for reproducible local automation. The final rifle regression requested Metal; the separate rifle-specific suite verified Apple M4 / ANGLE Metal explicitly. Browser combat poses were initialized through in-process test fixtures for reliable line-of-sight scenarios; movement, aiming, firing, dash, and pickup actions then used actual browser input and sockets. The solo browser result test advances the deadline only inside its test-server fixture to exercise timeout and winner presentation. The full-length solo simulation is covered by the server tests. No test/debug endpoints are shipped in production.

Screenshots were inspected for landing, lobby, desktop combat, and mobile combat. Captures also include Phase Cell, results, and the solo lobby/match/results. Screenshots are supporting evidence, not a substitute for the playable game or public testing. `failure-*.png`, if present under artifacts, are earlier failed-run diagnostics and are not evidence of the final run.

### Rifle and humanoid model update

The production browser suite was rerun with the detailed procedural rifle and articulated operators. Additional in-process pose fixtures capture `operator-front.png`, `operator-side.png`, `operator-phased.png`, and `operator-protected.png`. Front/side proportions, first-person weapon framing, the translucent whole-body effect, restored material opacity, and the protection shell were visually inspected. The ordinary desktop/mobile combat and solo screenshots exercise the new models in the actual game. These are visual inspections, not automated image-similarity assertions.

The latest 22-check browser run also passed after the induction-rifle overhaul. The initial conventional rifle has been replaced by the original induction design described below. It includes shared gloved grips, a visible core, ceramic containment rails, an open pulse-forming muzzle, and surface markings. Operators have helmeted faces, curved visors, armor, gripping hands, and cosmetic walking, aiming, breathing, and recoil motion. Static parts are merged per material within each joint; player removal disposes geometry, materials, and generated label textures. Shot visuals originate at the modeled muzzle, while damage still uses the server's eye-origin ray. Hit volumes and game rules are unchanged. These remain procedural game models rather than scanned photorealistic assets; physical-phone performance has not been measured.

### Advanced energy rifle — 2 October 2026

The rifle-specific suite passed all seven checks with two live Chrome contexts. Both clients saw the same weapon design at 2.5, 10, and 24 meters. Actual firing preserved 34-damage health steps, three-hit elimination, cover blocking, shared movement, disconnect results, and replay. A 30.168-second held-fire segment produced 105 confirmed shots and 105 rifle sound starts. No page errors occurred in the final run. A test-only frame-recorder serialization error in an earlier run was repaired before recording these results.

The first-person model has 15,108 triangles, including hands/sleeves/effects; the remote model has 9,372. Crosshair-region ray tests found no obstruction at desktop and both phone aspect ratios, including sampled recoil. Materials, grip poses, core brightening, third-person alignment, and remote discharge/tracer captures were visually reviewed. On Apple M4 / ANGLE Metal, 2,572 recorded frame intervals had approximately 16.7 ms median and p95 at 1280 × 800, alongside a second 960 × 640 client. This measures one local headless setup, not all hardware or physical input latency.

All weapon geometry/textures are original. The existing original electrical/mechanical sound is retained, with event alignment tested rather than subjective listening. Every hidden finger contact, one-second new-player recognition, physical-phone performance, and two-human public play remain unverified. See [WEAPON.md](WEAPON.md) and `artifacts/weapon-report.json`.

### PRESSURE / 07 character overhaul — 2 October 2026

The original code-native armor family replaces the earlier operator model. All four players share the same anatomy, articulated rig, neutral materials, sealed visor, and compact rear life support; player identifiers appear on the visor rim, shoulders, chest badge, and small status lights. Gloves and forearm construction are shared with first person. No external character asset was used. [CHARACTERS.md](CHARACTERS.md) describes the design and exact evidence.

The final character suite completed at **20:29 IST**, passing the studio audit and **eight live checks with no page/shader errors**. Four independent production Chrome contexts joined one authoritative room with all four colors. Actual controls/socket events exercised remote running, aim/turning, dash, 34-damage hits, three-hit elimination, brief collapse clearing, five-second respawn/protection, naturally scheduled Phase Cell pickup/expiration, cover blocking, disconnect victory, and replay. Captures show operators at 2.5, 10, and 24 meters. The revised phase capture visibly includes the translucent holder and its restored appearance.

- The rig audit samples stationary, walking, and running poses at three aim pitches. Maximum transformed forearm-end/wrist separation is **4.75 × 10⁻¹⁶ m**, tested heel penetration is zero, and maximum leg scale differs from 1 only by floating-point epsilon. Phase opacity/transparency/depth-write state restores exactly. These checks do not certify every finger contact or animation angle.
- Each operator includes **22,750 triangles, 92 mesh objects, and 27 transform groups**, including its rifle/effects. Mesh objects are not measured GPU draw calls. The current first-person weapon/suit assembly contains **16,688 triangles**; remote rifle/gloves contain **10,012**. The final viewmodel preview passed crosshair ray checks across desktop, landscape/portrait phone aspects, and recoil samples.
- On **Apple M4 / ANGLE Metal**, the approximately 29-second four-client movement/firing segment recorded **1,715 primary-client frame intervals**, with **16.7 ms median and p95** at 1280 × 800; the other three clients used 720 × 480. Each client received more than 900 snapshots and 22 shot events across the test. This is one local headless Mac measurement, not a phone/WAN benchmark or a controlled before/after performance comparison.
- Adaptive walking/running cadence, lowered pelvis, reachable leg targets, and a compact shoulder/rifle pose were corrected during review. Neutral body bounds excluding the rifle are X [−0.346, 0.373], Y [0, 1.806], Z [−0.457, 0.224] meters. The front support arm extends about **3.7 cm** beyond the unchanged server hit box; moving feet/strafe extremes can extend farther. Server shooting remains a consistent box approximation rather than per-plate anatomy.
- All **54 unit/socket tests** and the final **22-check desktop/touch/solo browser regression** passed. All six server/shared files match the pre-character source archive byte-for-byte: health, rules, input protocol, collision, and hit volumes were not modified.

Animations include idle breathing/weight shift, walk/run with opposing upper-body motion, eased hip/shoulder turning, aiming, confirmed recoil, brief hit reaction, knees-bent elimination/fade, and dash lean/recovery. Visual review covered front/rear/side/helmet/lineup, up/down aim, and combat/effect captures. Remaining limits are procedural faceting and simplified detail, possible clipping at unsampled extreme angles, imperfect foot locking during very slow/changing motion, and a short collapse rather than a ragdoll. Human anatomical/readability studies, physical-phone performance, two-human physical-device play, and public deployment remain unverified. Reports: `artifacts/character-studio-report.json` and `artifacts/character-live-report.json`.

### Directed pulse firing overhaul — 2 October 2026

The final VFX suite completed at **21:11 IST**, passing **14 checks with no page/shader errors**. It replaces the full-length static tracer and generic impact with an original contained muzzle spindle/sheath, compact 200-m/s moving pulse, a capped 0.78-m tail, and short armor/metal/composite contact variants. Optical release begins at 18 ms; muzzle residue ends at 125 ms, illumination returns to idle by 160 ms, and contact residue lasts up to 160 ms after visual arrival. Server damage, hit markers, sound and recoil still begin on the accepted shot event: gameplay remains instant hitscan. [VFX.md](VFX.md) documents timing, authorship, safety correction and limits.

- A full **unmodified 180-second match** ran in two independent production Chrome contexts. Both players moved/fired, eliminated/respawned, tested protection and blocked shots, dashed, and collected/expired the naturally spawned Phase Cell. The final score was 1–1; both result screens matched the correct earlier-score tiebreak. Host replay cleaned the lobby. There were 193 shot events on each client and 3,038 / 3,032 received snapshots.
- A **30.524-second held-fire** segment produced **107 confirmed shots and exactly 107 rifle sound starts**. The crosshair remained visible and centered. First-person/remote sequences at 2.5, 10 and 24 meters were captured as 52 frames using native render/audio hooks; studio contact captures were reviewed at closer distances for material flavor.
- **Apple M4 / ANGLE Metal:** at 1280 × 800 alongside a 960 × 640 second client, 10,803 full-match frame intervals measured **16.7 ms median/p95, 16.8 ms p99**. Sustained fire measured the same percentiles across 1,831 intervals. This is one local headless setup, not an FPS guarantee, physical-input benchmark or controlled before/after comparison.
- Three studio checks cover release/flight timing, normal/phased material restoration, crosshair clearance across desktop/phone aspects, impact variants, stress reuse/expiration, and disposal. Renderer memory stayed at **220 geometries / 37 textures** across the pool stress test. The fixed pool owns only **three geometries / 144 materials**, supports 16 active effects and reuses its oldest cosmetic slot under saturation.
- Twelve new unit tests exercise speed/endpoint/tail bounds, near-cover/wall/corner correction, close/overlapping operators, surface normals, protection/no-contact behavior, a 400-shot bounded-pool flood, replay clearing and exact resource disposal. All **66 unit/socket tests** passed. All six server/shared files are byte-identical to the pre-VFX archive.
- Review caught barrel origins inside/beyond cover and ahead of close targets. Visual origins now retreat safely and occluded muzzle bloom is suppressed, while retaining the server contact. An initial live assertion also caught the existing **two-pixel crosshair offset**; its CSS was centered and the full match rerun successfully.

The effects use original analytic shaders and geometry; no external VFX assets, new lights, fullscreen bloom or postprocessing. Surface impacts stay on shared box contacts, so armor flashes can appear slightly in front of the decorative mesh. Very close flight can span fewer render frames; its 16-ms arrival glint keeps it visible without slowing gameplay. Human judgments of repeated-fire comfort, visual polish and sound synchronization, physical-phone performance, two-human play and public/WAN deployment remain unverified. Evidence: `artifacts/vfx-report.json`, `artifacts/vfx-studio-report.json`, and `vfx-*.png` captures.

### Grounded combat audio

All 13 audio browser checks passed; the audio regression run with music completed at **15:36 IST on 2 October 2026**. `artifacts/audio-report.json` records the measurements, and `docs/AUDIO.md` describes the implementation, original sources, and listening checklist.

- Real production-browser held fire ran for **60.004 seconds**, producing **211 server-confirmed local shots**. It then exercised all four connected operators firing at close range after the opponents had occupied opposite sides of the arena.
- The measured live output peak was **0.4273** on a full-scale limit of 1.0, with at most **12 live buffer sources** observed. These are analyser samples; the exhaustive offline stress render provides the sample-by-sample ceiling check.
- The offline four-shooter mix peaked at **0.6999 or below**. A coincident 100-event stress burst peaked at **0.8524 or below**, kept the active one-shot count at **24**, dropped 76 lower-priority events, and admitted a higher-priority local shot by replacing one lower-priority voice.
- Rendered local, near, and distant shots differ in level, high-frequency detail, and low-frequency proportion. Left/right channel energy follows source location. Covered shots have lower level and less high-frequency energy. The initially tested HRTF path gave unreliable short-transient channel measurements; the final mixer uses verified equal-power spatial panning.
- Mute, Master zero, and independently zeroed Effects, Ambience, and UI buses produce exact silence in isolated renders. Live Mute removed the measured signal while firing continued through the server.
- Footstep state tests reject stationary, downed, teleport, and dash-only displacement; confirmed travel generates footfalls. Dash, phase expiry, and leave cleanup follow server state. The loop test observed three active sources (station, cell, holder), one remaining station source after phase/cell removal, and zero loops after leaving. No gameplay rule or protocol was changed.
- Desktop activation, emulated mobile activation, all four persisted volume controls, persisted Mute, unmuting, leave cleanup, and an unavailable AudioContext were exercised. The unavailable-audio case still creates and starts a solo match. Settings screenshots were visually inspected at 1280×800 and 390×844.

**Listening by ear: NOT VERIFIED.** A signal test cannot establish whether the rifle is satisfying over a minute, whether impacts are perceptually distinct, whether the mix is tiring, or whether players can localize sounds on actual hardware. `artifacts/audio-review.wav` is an 18-second stereo review export, with a segment guide in `docs/AUDIO.md`. Speaker/headphone listening, physical-phone audio, and subjective mix approval remain outstanding.

### Original adaptive score — 2 October 2026

The final score suite completed at **15:43 IST on 2 October 2026**, passing **11 checks with no page errors**. All seven required cues plus the Phase Cell shimmer are implemented. `artifacts/music-report.json` contains the executed results; [MUSIC.md](MUSIC.md) records composition, source provenance, timing, mix decisions, and limitations.

- Two independent production Chrome clients completed **two unmodified 180-second matches**: first with Music at 40%, then at zero. Both clients moved, fired, eliminated/respawned, collected/expired the Phase Cell, reached timeout, agreed on the winner, and returned to a clean lobby. The matches produced **92 and 93 confirmed shots**, respectively, and each ended 1–1 with the correct earlier-score tiebreaker.
- Each music-on client started exactly three 30-second stems: combat, intensity, and final. The final layer entered **120.048 / 120.064 seconds** after the intro started. All combat stems ended before the appropriate victory/defeat source. The muted match started **zero music sources** while gameplay effects remained active. Live analyser peaks stayed below **0.452**.
- All eight FLAC assets decode at their exact planned lengths in Chrome. Mono summing retains at least **99.3%** of their stereo energy. Encoded asset bytes total **3,631,667**, and decoded stereo PCM totals **44,096,000 bytes**. Loop-edge sample changes are below 0.004; actual loop sources run continuously across the three-minute match without rescheduling/restarts.
- The initial numerical mix put the combined stems too close to local footsteps. Reducing the fixed score trim from 0.22 to **0.12** brought the tested score window to **19.33 dB below the rifle** and **4.93 dB below local footsteps** in RMS. The ducked score window was a further **7.46 dB lower**; the combined review render peaked at **0.4590**. These are measured windows, not a perceptual masking judgment.
- Nearby engagement raises intensity, distant shots do not, and calm restores the mix without restarting the stem. Phase pickup adds one shimmer; kills add no musical sting. Final entry, endings, replay fades, suspension/resume, and disconnect cleanup passed controller checks.
- Actual production music output was also measured in isolation at `http://localhost:3000`: playing produced a nonzero signal; Music zero, Master zero, and Mute each measured zero; restoring Music resumed the signal. See `artifacts/music-controls-report.json`. The saved slider, desktop/portrait layouts, and touch access were checked. All music fetches failing still allowed a real solo match with authoritative firing and effect output.
- An initial full run completed the music-on match, then stopped on an exact floating-point equality in the test's second-match duration assertion. That assertion now allows a sub-millisecond numeric tolerance. The final successful run repeated both complete matches; no server timer was shortened or overridden.

**All cues: listening by ear NOT VERIFIED.** Emotional impact, three-minute listening fatigue, perceived combat clarity, and resemblance to existing soundtracks require human review. Music is original written-note/additive synthesis with no borrowed recordings, soundfonts, reference tracks, or lyrics; no human composer or auditory originality review is claimed. Physical-device audio, two-human play, and a public deployment remain unverified. Test poses are controlled fixtures on one Mac; this is real client/server browser execution, not two people on separate physical devices.

### The Shattered Relay environment

The final software-rendered environment run completed at **23:09 IST on 1 October 2026**; the accelerated Apple M4 run completed at **10:20 IST on 2 October 2026**. All 12 checks passed, including a full unmodified 180-second match in two independent contexts, eliminations from both clients, both flanking lanes, both cover banks stopping shots/dash, all four spawn exits, natural Phase Cell pickup/expiration/replacement, matching timeout results, and clean replay. All 25 shared collision solids have rendered counterparts; non-wall solid bounds match exactly. The sealed viewport intentionally retains its wall collider.

These environment-specific measurements/captures predate the induction rifle. The later rifle-specific and 22-check regressions are recorded above. Standing-eye-height captures were reviewed for the core, lanes, spawns, blast door, viewport, conduit, and uplink display. A rib obscuring the display was corrected, and the planet's repeated bands were replaced with spherical noise. The final run used the corrected build. The existing 22-check desktop/mobile/solo suite also passed with the environment overhaul before those final cosmetic adjustments.

The measured client peaked at 193 draw calls / 102,062 triangles. With two software-rendered SwiftShader contexts, median frame interval was 157.7 ms and p95 was 266.5 ms. Both clients stayed connected and received 3,169 playing snapshots; maximum measured receipt gaps were 2.40 s and 1.39 s, including automation/screenshot stalls. These are **not** evidence of smooth hardware performance or WAN behavior. Rendering uses merged materials, small generated textures, limited lighting, no shadow maps/bloom, and an adaptive pixel-ratio/particle reduction. See [ENVIRONMENT.md](ENVIRONMENT.md) and `artifacts/environment-report.json` for the exact scope and performance caveats.

The same full-match suite passed on **Apple M4 / ANGLE Metal** with two simultaneous browser contexts. Across 10,761 frames, the measured 1280 × 800 client at pixel ratio 1 had a **16.7 ms median / 17.9 ms p95 frame interval** (roughly 60 FPS median), with a peak of 202 draw calls and 102,158 triangles. Both clients received 3,181 playing snapshots, with maximum observed receipt gaps of 530 ms and 425 ms including screenshot/fixture work. `artifacts/environment-metal-report.json` retains the hardware identity and measurements. This is one Mac running headless Chrome, not a broad hardware benchmark; no before/after hardware baseline was measured.

Five-second first-time orientation, subjective combat readability, other laptop/phone performance, and public multiplayer remain unverified. The scene has been exercised in automated live play; no two-human playtest is claimed.

### Bugs caught and repaired

- Start/resume now explicitly focuses the canvas so a focused UI button cannot suppress movement keys.
- Escape explicitly exits pointer lock, including automated Chromium behavior.
- Each spawn increments a server-issued life generation. Old-life inputs are rejected until the client receives its new spawn. This fixes a real race that could overwrite spawn orientation.
- A collision test now allows floating-point epsilon at an otherwise valid boundary.
- The touch visibility test checks the actual visible Fire control rather than its zero-size positioning container.
- Mobile heading spacing and essential HUD/instruction text were corrected during visual review.

## Not verified / known limits

- **Public deployment and public-URL multiplayer: NOT VERIFIED.** No service has been created or published.
- **Two physical devices with two human players: NOT VERIFIED.** Automated independent browser sessions and emulated touch were used. Bots are included only in explicitly labeled solo practice; human multiplayer rooms never use bots.
- **Physical iOS Safari/Android Chrome controls, device orientation, audio output quality, and real-device performance: NOT VERIFIED.** Touch emulation is not a substitute for these checks.
- **WAN latency, packet loss, jitter, and sustained multi-room load: NOT VERIFIED.** This is a small single-process MVP.
- **Docker image build and hosted Render Blueprint execution: NOT VERIFIED.** Deployment files are supplied; the equivalent npm production build was exercised locally.
- No server-side lag rewind. Hits use current authoritative positions, so higher latency affects moving-target accuracy.
- Rooms and scores are in memory. Restarts/redeployments erase them. Exactly one server instance is supported.
- A silent connection loss can take roughly 7.5 seconds to confirm with heartbeat detection; stale input stops after 350 ms. A confirmed in-match disconnect forfeits the seat; active rejoin is intentionally disabled.
- Collision uses simple conservative boxes. Players do not physically block one another. Simultaneous same-tick cell contacts resolve in join order.

## Deployment blocker and remaining action

The local environment has no Render CLI, API key, or deployment hook configured. The existing GitHub CLI account reports an invalid token, so pushing a source repository is also blocked without renewed authentication. The available Sites publisher expects Cloudflare Workers-compatible output and does not provide the persistent Node/Socket.IO process used by this game. Publishing only the static client there would not meet the multiplayer requirement.

**Remaining action:** authenticate GitHub/GitLab and Render, push this project to a repository, and create one Render Node Web Service using the included `render.yaml` or the exact build/start settings in `README.md`. Then open the returned HTTPS URL on two physical devices and run the README checklist. No paid plan was purchased. No public URL is claimed.
