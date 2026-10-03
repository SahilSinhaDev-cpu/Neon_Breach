# Pulse Rifle — induction design

The rifle is **modeled originally in code for Neon Breach**. Its geometry, surface markings, brushing texture, and effects are generated locally. No downloaded weapon asset, copied fictional weapon, or third-party weapon license is involved. The existing original synthesized combat sound is retained.

## Form and grip

The silhouette is organized around an exposed induction chamber inside a split ceramic containment shell. A compact rear regulator stabilizes the firing stance; paired rails carry power into an open polygonal muzzle. The rifle has a forward support saddle, a pressure-actuated dominant grip, recessed conductors behind protective windows, captive fasteners, cooling slots, service markings, and limited heat/contact wear. Dark metal, matte ceramic, polished edges, subdued glass, and cyan power indicators provide material separation.

`client/weapon.ts` builds both variants. The first-person variant includes sleeves, small surface wear, generated brushing, and inspection labels. The remote version preserves the silhouette, visible core, windows, rail system, muzzle, and both gloves, with fewer subdivisions and small details. The operator's forearms terminate at the same exported wrist anchors as the weapon's gloves. Arms and rifle aim/recoil together, so the weapon does not float independently of the hands.

The initial view hid the grips behind the rear housing. The housing was shortened and lowered, and the first-person model moved farther from the eye with an oblique angle to reveal the core. Portrait view uses a separate horizontal/depth offset. Default grip placement, side/front operator views, and recoil framing were visually reviewed. Hidden finger-to-grip contact has not been exhaustively verified at every animation angle.

## Shot presentation

Only a **server-confirmed shot event** triggers firing presentation:

| Elapsed time | Visual response |
|---|---|
| 0–18 ms | Core and channel brighten; a brief induction wave reaches the muzzle |
| 18–72 ms | Contained directional white-blue release, peaking at 29 ms |
| Until 125 ms | Dim sheath/aperture residue clears |
| From 18 ms | Compact optical pulse travels at 200 m/s with a maximum 0.78 m tail |
| At visual arrival | Small armor, metal, or composite contact flash; residue clears within 160 ms |
| By 160 ms | Core and channel return to their idle emissive levels |

The 18 ms optical release does **not** delay server hit detection, damage, score updates, hit markers, or sound dispatch. Gameplay remains hitscan, with 34 damage, a 280 ms server cooldown, unlimited ammunition, and three hits from full health. The visible pulse and its arrival impact represent that instantly resolved shot; [VFX.md](VFX.md) records the current effects, timing, surface variants, pool, and verification. Server and shared gameplay files are unchanged by these visual overhauls.

The viewmodel has a short 2.5 cm visual recoil, restrained sway/breathing, and the existing small cosmetic camera kick. The existing sound combines a broadband electrical attack, mechanical impulse, low-frequency body, and short damped tail. The test confirms one rifle sound event per confirmed held-fire shot; listening quality remains a human check.

## Cost and verification

The figures below record the induction-rifle release before the character overhaul. The later character release used **16,688 triangles** for the first-person assembly and **10,012** for remote rifle/gloves. The current VFX release replaces the three old optical meshes with four shapes totaling 56 fewer triangles; those character-release counts are historical. The final crosshair preview and four-client combat regression passed; see [CHARACTERS.md](CHARACTERS.md) and [TEST-REPORT.md](TEST-REPORT.md) for current evidence. Rifle mechanics and discharge design are unchanged.

The first-person rifle contains **15,108 triangles**, including gloves, sleeves, and effect geometry; the remote version contains **9,372**. Static parts are merged by material. Effects use a few small meshes and no additional lights, bloom, dynamic reflections, or particle system. Generated material textures are 256 × 256 or 512 × 256. Vite's Three.js chunk is approximately 525 kB uncompressed / 133 kB gzip and emits its standard 500 kB chunk warning; the production build succeeds.

Executed on 2 October 2026:

- `npm test`: **47 passed**, including server rules, real socket integration, solo, layout, and audio signal/settings checks.
- `NB_RENDERER=metal npm run test:browser`: **22 passed**, including desktop input, emulated mobile movement/aim/fire/dash, solo bots, phasing/protection captures, respawn, and replay.
- `NB_RENDERER=metal npm run test:weapon`: **7 checks passed, zero browser errors**. Built production assets and two independent Chrome contexts exercised the shared rifle at **2.5, 10, and 24 meters**, remote firing, health transitions **100 → 66 → 32 → 0**, cover blocking, movement, disconnect results, and clean replay.
- A held-fire segment lasted **30.168 seconds** and produced **105 server-confirmed shots and 105 rifle audio starts**. The match remained connected.
- Crosshair-region ray tests found no viewmodel obstruction across desktop, landscape-phone, portrait-phone, and sampled recoil poses. Default and discharge frames were inspected; actual remote muzzle/tracer captures were also reviewed.
- Chrome reported **Apple M4 / ANGLE Metal**. Across 2,572 recorded animation-frame intervals, median and 95th percentile were both about **16.7 ms**, with two active browser contexts (1280 × 800 and 960 × 640). This is a local headless-browser result at pixel ratio 1, not a broad device benchmark or a measurement of display/input latency.

`artifacts/weapon-report.json` contains the measurements. `weapon-first-person.png`, `weapon-discharge.png`, `weapon-silhouette.png`, `weapon-third-*.png`, and the `weapon-live-*` / `weapon-remote-fire-*` images record the inspected views. Studio poses and controlled combat starting positions exist only in the QA harness; production exposes no test endpoint or authoritative position override. An initial run caught a test-only frame recorder serialization error; it was fixed before the successful reported run.

**Not verified:** one-second recognition by new players, every occluded finger contact during arbitrary movement/aiming, subjective sound quality, physical-phone rendering, two humans on separate devices, or public/WAN play. The model is procedural game art, not a scanned or externally sourced cinematic asset.

Run `npm run build` before `npm run test:weapon`. The latter defaults to SwiftShader; on a compatible Mac, set `NB_RENDERER=metal` for GPU acceleration. Set `CHROME_PATH` if Chrome is elsewhere. `--preview` runs only the studio checks and captures.
