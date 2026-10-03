# The Shattered Relay

One 40 × 40 m communications chamber, with one playable floor and the existing combat rules. The environment uses original procedural geometry and canvas textures; it downloads no artwork or models.

```text
                       NORTH / −Z
                    ARMORED VIEWPORT
       Spawn 1                             Spawn 3
          │     Exchanger A                    │
          │         North cover bank           │
    BLUE SERVICE       RELAY CORE        AMBER SERVICE
          │             Phase Cell             │
          │         South cover bank           │
          │                    Exchanger B     │
       Spawn 4                             Spawn 2
                       BLAST DOOR
                       SOUTH / +Z
```

The two cover banks and offset thermal exchangers have 180-degree rotational symmetry. Both side lanes connect the observation ends. Approaches around either end of a cover bank lead into the open center. Four corner spawn pads retain routes into both lanes and the core. The south bank mirrors the original north bank; the chamber footprint and movement controls remain the same.

## Landmarks and materials

- **Relay Core:** suspended transmission frame, ceiling supports, isolated power banks, concentric floor paint, and a restrained mint Phase Cell beam. The frame is above operator height; the exact-center pickup stays open.
- **Observation ends:** armored viewport with a procedural planet, drifting fragments, damaged station silhouette, and bent exterior railing; opposite it, an impact-scarred pressure door with emergency shutter markings.
- **Service lanes:** blue and amber route markings, thermal exchangers, overhead conduit housings, inspection panels, and human-scale access doors. The amber lane has an exposed conduit with brief arcs and localized sparks, plus a damaged communications display.
- **Wear:** scratched floor coatings, fastened bulkhead panels, vent grilles, soot and impact marks, warning stencils, and exposed conductor ends. Wall-mounted maintenance access keeps the routes free of loose prop clutter.

Fog is restrained over engagement distances. Neutral fill keeps operator armor readable; color accents identify routes without bathing the room in saturated light. Arcs occur in brief bursts, distant flashes are small and infrequent, and no smoke or bloom obscures combat.

## Collision agreement

`shared/world.ts` defines all 25 authoritative solids. The client builds their main visible forms from that data. The two cover banks, pillars, sealed walls, suspended frame, supports, ceiling ribs, and conduit housings all stop server shot rays. Floor movement checks only solids overlapping the operator's vertical span, so overhead structures never create invisible floor barriers. Dash uses the same collision routine.

The viewport is **sealed armored glass**, with visible frames and a label; its wall collider deliberately stops shots and movement. Space scenery beyond it has no collision. Paint, scars, labels, thin surface trim, sparks, and holographic effects are explicitly cosmetic; they do not provide additional cover. Structural depth is either inside a shared solid or outside the sealed chamber.

## Rendering choices

Static surface details are merged by material. Panel and damage textures are small reusable canvases; the planet uses a 512 × 256 spherical noise texture. Lighting uses one hemisphere light, one directional light, and three short-range point lights. There are no shadow maps, bloom passes, dynamic reflection captures, or volumetric effects. Exterior geometry is deliberately simple.

Pixel ratio is capped at 1.6 on desktop and 1.25 for coarse pointers. Sustained slow frames after warmup reduce it to at most 1 and remove minor sparks and four debris fragments. Landmarks, cover, players, and gameplay effects remain present. Reflections use a single generated environment map created at startup.

## Executed verification

The environment-specific captures and frame-cost measurements below predate the induction-rifle update. See [WEAPON.md](WEAPON.md) for the current rifle and subsequent gameplay regression.

`npm test` passes 47 tests, including four dedicated layout tests: rotational symmetry and valid pads; routes from every pad to the center and both complete flanks; overhead shot blocking without floor blockage; and both banks blocking authoritative shots and dash.

`npm run test:browser` passes 22 gameplay checks with the new environment, including desktop input, emulated mobile movement/aim/fire/dash, solo bots, and multiplayer replay.

`npm run test:environment` passes 12 checks. Two independent browser contexts played a full **180-second match**, with real keyboard/mouse inputs and sockets. Each client moved and fired, earned an elimination, and received the other's positions. Both cover banks stopped shots and forward dashes; all four pads allowed movement out; both flanks were traversed; the center cell spawned, was collected, expired after four seconds, and naturally returned 20 seconds after collection. Both clients showed the server's timeout winner and returned to a clean lobby. No JavaScript or WebGL shader errors were recorded.

Combat and screenshot starting poses are controlled fixtures inside the test server. The test does **not** override the match deadline, scores, or cell scheduling. No test endpoints are included in the production server. Eye-height captures cover all four spawns, both lanes, the core, viewport, blast door, conduit, and communications display. Review caught and fixed a wall rib obscuring the display and an overly repetitive planet texture.

The accelerated run completed on **2 October 2026 at 10:20 IST**, with Chrome reporting **Apple M4 / ANGLE Metal** rather than a software fallback. The same complete 180-second match passed all 12 checks with two simultaneous contexts. At 1280 × 800 and pixel ratio 1 (second context 960 × 640), 10,761 measured frames had a **16.7 ms median** and **17.9 ms 95th-percentile** interval—approximately 60 FPS at the median. Peak render cost was **202 draw calls / 102,158 triangles**. Each client received 3,181 playing snapshots; maximum observed receipt gaps, including screenshots and fixture work, were 530 ms and 425 ms. See `artifacts/environment-metal-report.json`. This is a local headless Chrome result on one Mac, not a claim about every laptop, phones, display/input latency, or WAN behavior. No pre-overhaul hardware baseline was measured.

To reproduce the accelerated check on a compatible Mac, run `NB_RENDERER=metal npm run test:environment`. The test asserts that Chrome actually reports an Apple Metal renderer. The default command uses SwiftShader for reproducible software testing and writes a separate report.

The final software-rendered run recorded a peak of **193 draw calls and 102,062 triangles** on the measured client. Its median frame interval was **157.7 ms**, with a 266.5 ms 95th percentile, across 1,065 sampled frames. Both clients received 3,169 playing snapshots; largest observed receipt gaps were approximately 2.40 and 1.39 seconds. These measurements include two simultaneous SwiftShader contexts, screenshot work, and browser automation on one computer. They establish neither smooth hardware performance nor stable WAN latency. They are retained in `artifacts/environment-report.json` rather than hidden behind a performance claim.

**Still requires human/device verification:** five-second first-time orientation, competitive visibility judgments during unscripted play, two physical devices, frame rate on other laptops and phones, mobile GPU behavior, and WAN responsiveness. Automated contexts are not two human players. Public deployment remains blocked as documented in `TEST-REPORT.md`.
