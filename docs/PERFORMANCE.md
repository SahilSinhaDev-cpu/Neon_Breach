# Client rendering performance — 5 October 2026

The FPS counter now appears in a top corner on desktop and touch layouts. It updates twice per second, ignores hidden-tab time, respects safe-area margins and stays hidden during the intro. The counter measures rendering animation callbacks, independently of the server clock or connection latency.

The reported lag was **not reproduced** on this test machine. Both revisions held approximately 60 FPS. The optimizations reduce rendering work and leave more headroom; these measurements do not establish a subjective improvement in movement or aim, or a fix on the user's separate browser/device.

## Before and after

Hardware: **MacBook Air, Apple M4, 16 GB RAM**, Chrome **154.0.8037.97**, actual **ANGLE Metal** acceleration. Desktop and phone-size captures run sequentially on this same GPU. The phone viewport is emulation, not a physical-phone performance result. No CPU throttling, software renderer or artificial network delay is used.

Each capture opens the actual solo room with three labeled bots, warms the scene, measures 12 seconds of lobby, 16 seconds of continuous movement/held fire and 14 seconds of effects including the naturally scheduled center cell and phasing. Desktop uses keyboard/held mouse and a repeated mouse aim path; touch emulation uses the production joystick/fire/aim state. Bots retain normal AI, shooting, damage and scoring. Death and respawn can occur inside these windows.

Starting positions are private test fixtures: the human starts in a valid service lane; before the effects window the bots return to valid corner pads to keep the first beam visible, then continue normal AI. The human moves to the center after the naturally spawned beam has been visible. Health, damage, cooldowns, match deadline, scoring and pickup/phase durations are never overridden. Visibility, bot motion and deaths differ between runs; live combat CPU/draw counts are descriptive, not a deterministic microbenchmark.

The measurement bundle uses the real client modules with test-only renderer access and timing wrappers. Both revisions use the same esbuild capture path; these are not timings of the exact minified Vite binary. Separate production build and touch acceptance checks exercise the shipped artifacts. The pre-optimization client is archived in `artifacts/performance/baseline-client.tar.gz`; no diagnostic globals or QA routes ship in the frontend.

| View / scenario | Average FPS, before → after | Lowest 1-second FPS, before → after | Worst single frame ms, before → after | Arena CPU ms/frame, before → after |
| --- | --- | --- | --- | --- |
| Desktop 1440 × 900 / Lobby | 60.00 → 60.01 | 59.91 → 59.90 | 18.20 → 17.80 | 2.52 → 1.78 |
| Desktop 1440 × 900 / Movement + held fire | 60.00 → 60.00 | 59.93 → 59.90 | 17.50 → 18.40 | 2.38 → 1.78 |
| Desktop 1440 × 900 / Heavy effects + Phase Cell | 60.00 → 60.00 | 59.92 → 59.92 | 17.80 → 18.20 | 2.32 → 2.01 |
| Touch emulation 390 × 844 / Lobby | 60.00 → 60.00 | 59.87 → 59.93 | 18.80 → 17.90 | 2.47 → 1.75 |
| Touch emulation 390 × 844 / Movement + held fire | 60.00 → 60.00 | 59.86 → 59.92 | 18.80 → 18.10 | 2.10 → 1.69 |
| Touch emulation 390 × 844 / Heavy effects + Phase Cell | 60.01 → 60.00 | 59.87 → 59.93 | 19.70 → 17.90 | 2.07 → 1.65 |

“Lowest” means the lowest rolling window of at least one second, which is more useful than calling one slow frame a sustained FPS drop. Worst single-frame time is listed separately. Small differences around 60 FPS include browser scheduling noise; desktop effects had a slightly worse worst frame, so no desktop FPS gain is claimed. CPU timing covers the arena update and render submission, excluding HUD/browser compositor/GPU completion.

The fixed lobby view is the strongest workload comparison: desktop CPU **2.52 → 1.78 ms/frame** (29% less), phone-size **2.47 → 1.75 ms/frame** (29% less). Average desktop lobby draws **105 → 91**. The desktop drawing buffer falls from **2304 × 1440 to 1800 × 1125**, about 39% fewer pixels; phone-size buffer falls from **487 × 1055 to 390 × 844**, about 36% fewer pixels. Those are actual buffer sizes, not inferred FPS gains.

## Three largest identified JavaScript rendering costs

Chrome DevTools CPU profiles identify these grouped rendering categories in the before desktop sample. Percentages are shares of named active JavaScript samples, excluding idle, native “program” and garbage-collection samples; they are not GPU execution percentages.

1. **Mesh draw submission and attribute/VAO binding — 47.5%.** `needsUpdate`, `setup`, `renderBufferDirect`, `projectObject`, binding and sorting dominated. Pressure-wall panels now batch by shared material inside each original collision shell. Pool size falls from 16 to 12 slots and effect materials from 144 to 96. Distant sphere tessellation falls from 40 × 28 to 24 × 16. No armor silhouette, rifle core or arena collider is removed.
2. **Transforms and operator animation — 12.3%.** `updateMatrixWorld` and `multiplyMatrices` repeatedly walked rigid geometry. Immutable station world matrices and rigid suit/rifle local matrices are baked once. A redundant arm-hierarchy update is removed. Invisible lobby/downed rigs stop animating; phase opacity only updates when its value changes. Debris, movement, wrist IK, recoil and protection remain animated. This category accounts for 8.7% of active samples after optimization.
3. **Material/light and shader uniform setup — 12.2%.** One unnecessary central point light is removed; the core retains emissive lighting and both cyan/amber route lights remain. Signs, sealed glass and the distant planet use simpler unlit materials. Physically lit playable metal and armor, the generated reflection environment and restrained fog remain. Pixel ratio starts at at most 1.25 on desktop and 1 on touch, with a 1920 × 1080 drawing-buffer pixel budget on large displays.

Ambient sparks fall from 18 to 12. Armor impacts use one radial lobe instead of two, metal two instead of three, and impact residue ends at 100 ms instead of 160 ms. The energy spindle, contained muzzle release, phased brighter/thicker tracer and compact contact ring remain. Pulse speed, hit timing, damage and the four-second Phase effect are unchanged.

There were already **no shadow maps, fullscreen bloom, SSAO, motion blur or post-processing passes** to disable. No removal of such effects is claimed. Direct GPU timings were not collected; shader/fill-cost savings are inferred from reduced lights/material complexity and actual pixel counts.

A render-budget monitor now reduces arena resolution by 15% after two consecutive visible one-second windows below 50 FPS, after warmup. The old fallback waited for sustained sub-30-FPS play. Minor sparks/debris are reduced first; the floor is 0.65 for initially higher ratios, and UI resolution, colliders, enemies and rules remain intact. Hidden tabs reset the monitor. This logic passed synthetic timing tests; it is not a guarantee of 60 FPS on every GPU.

## Evidence and verification

- **158 automated tests passed**, including server/transport/storage regressions, bounded effects resources, FPS sampling and adaptive-budget behavior.
- **Production build, typecheck and standard Netlify Function packaging passed.**
- **Three VFX studio gates passed:** crosshair clearance at desktop and both phone aspects, pooled effect reuse/expiration/disposal and distinct phase/contact variants. Current report: `artifacts/performance/vfx-studio-report.json`.
- **Character studio passed:** wrist alignment, planted feet, no limb over-stretch and restored armor after phasing. Current report: `artifacts/performance/character-studio-report.json`.
- **Seven built-production touch/gameplay gates passed:** movement, aim, three-hit elimination, wall-stopped dash, disconnect winner and solo bots. See `artifacts/realtime/touch-report.json`.
- All four performance reports passed with zero page errors; actual beam, phase and shot effects were present. Desktop and portrait counter screenshots were visually inspected.

The desktop DevTools UI could not open because OS Computer Use permissions were denied. Chrome's **DevTools Protocol** collected the actual timeline traces and CPU profiles in a separate six-second sample **after** FPS measurement, so recording overhead is not part of the FPS table. This is programmatic DevTools profiling, not a claim that the Performance tab was manually used.

Load `artifacts/performance/before-desktop-trace.json` or `after-desktop-trace.json` with the DevTools Performance panel's Load profile control. Corresponding `.cpuprofile` files and mobile traces are included. `comparison.json` consolidates the raw measurements. Baseline/optimized sources and reports are packaged for review.

After building, run:

```sh
node --import tsx tests/performance-browser.ts before
node --import tsx tests/performance-browser.ts after
node --import tsx tests/performance-browser.ts before --mobile
node --import tsx tests/performance-browser.ts after --mobile
```

Run them sequentially; simultaneous browser benchmarks would contend for the GPU. The before command extracts the archived original client into a temporary directory and removes that directory on completion. `npm run test:performance` captures the current version. Developer test commands are not part of the player or deployment workflow.

## Limits and release status

This revision is local source/build plus the updated `netlify-ready-game.zip`. **No new public deployment is claimed.** Physical phones, older integrated GPUs, a human judgment of aiming comfort and the user's reported lag on their exact browser remain unverified. The server, transport protocol, network behavior and gameplay rules were not changed for this performance task.
