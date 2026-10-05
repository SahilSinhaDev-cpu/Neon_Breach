# Directed pulse firing effects

NEON BREACH still uses server-authoritative hitscan. The server determines the shot, contact, health change and elimination immediately. When the accepted shot event arrives, the client starts recoil, the rifle sound and any applicable hit marker. The moving pulse and later impact are optical representations of that already resolved shot. They add no projectile physics, damage delay, fire-rate change or network messages.

## Original effect family

The effect uses original geometric profiles and analytic shaders written for this project. A compact white-blue spindle (`#e5f8ff`) sits inside a restrained cyan sheath (`#70c5fa`). A short tapered tail dissipates behind it, capped at 0.78 meters rather than spanning the entire shot. No downloaded artwork, texture assets, recorded effects, borrowed weapon designs or external VFX assets were added.

The muzzle uses the same spindle family: a bright contained core, softly feathered directional sheath and a small expanding aperture ring. A brief induction wave moves along the existing weapon channel. First-person discharge is smaller and dimmer than the remote version: the muzzle group has a 0.78 scale, with peak core opacity 0.62 versus 0.95 on the third-person rifle. This preserves a clear center aiming region while keeping other operators' firing visible.

These are depth-tested meshes with additive shader edges. They use no new lights, fullscreen bloom, motion blur or postprocessing. The impact ripple is an analytic ring; it does not refract the scene or simulate an air-pressure wave.

## Timing

All times below are relative to receipt of the accepted server shot.

| Stage | Timing and behavior |
| --- | --- |
| Confirmation | Damage, hit markers, rifle audio and recoil begin immediately. |
| Charge | The power core and channel brighten during the first 18 ms. A short induction wave reaches the muzzle. |
| Muzzle release | Begins at 18 ms, peaks at 29 ms and fades by 72 ms. |
| Muzzle tail | A dim aperture/sheath residue remains briefly, ending at 125 ms. Core/channel illumination returns to idle by 160 ms. |
| Pulse flight | Starts at 18 ms and travels at a constant cosmetic 200 m/s from the displayed muzzle toward the server's contact point. |
| Arrival glint | The head retains a short 16-ms fade at the endpoint so close shots remain visible across ordinary render frames. |
| Impact | Begins at visual arrival and fades completely within 100 ms. |

Visual arrival is `18 ms + (visual launch-to-contact distance / 200 m/s)`. The path length can differ from the eye ray because the pulse starts near the weapon muzzle. This timing never controls whether a shot hits. Even at long range, the server damage and hit marker can appear before the cosmetic impact flash.

## Contact variants and safety

All surfaces receive a compact flash, a short residue and a subtle expanding ring, with different responses inside the same energy family:

| Contact | Appearance |
| --- | --- |
| Operator armor | Cool violet pressure flash (`#b6c5ff`), a slightly stronger ring and one short deterministic radial energy lobe. |
| Station metal | Cyan flash, restrained ring and two short radial lobes. |
| Composite cover | Dull mint thermal disk (`#b0cfbf`), a quieter ring and no radial lobes. |

Geometry contacts use the shared arena boxes to identify the surface and its face normal. Operator impacts use the server's simple player hit box and incoming direction. They do not raycast individual armor plates. A contact can therefore appear slightly in front of a visible suit surface; this preserves the existing fair hit volume rather than changing combat for decorative geometry.

The muzzle-to-contact path is checked against the shared geometry. If a displayed barrel reaches through a wall or cover, the visual origin retreats to a safe point and the obstructed muzzle bloom is suppressed. If a nearby opponent is closer than the displayed barrel length, the origin retreats before the contact rather than sending the pulse backward. The authoritative endpoint is retained in both cases.

Phased shots retain the existing more revealing firing rule: the head, sheath and tail become 1.8 times wider, with a brighter pale core and violet outer energy. Speed, damage and movement remain unchanged. Reused slots reset their scale, colors, opacity and impact variant for subsequent normal shots.

## Resource budget

`PulseEffects` allocates a fixed pool of 12 slots with three shared geometries and 96 materials. Each slot holds the pulse head, sheath, two tail meshes and the small contact effect, including up to two deterministic lobes. This covers four players firing at the server's 280-ms minimum even with a 100-meter cosmetic path and residue. Invisible parts do not draw. Effects expire and reuse slots instead of creating and destroying geometry on every shot. If all slots are occupied, the oldest cosmetic effect is reused; the accepted shot and its gameplay result are unaffected.

Clearing the pool hides and releases its active slots. Disposal removes its scene objects and disposes all three owned geometries and 96 materials. The rifle's separate static muzzle shapes also reuse their geometry and materials. These budgets were reduced in the 5 October client-performance revision; the original 2 October measurements below describe the previous 16-slot version. See [PERFORMANCE.md](PERFORMANCE.md) for current results.

## Verification

Use Node 22 or newer, install dependencies and build production assets before the live test:

```sh
npm ci
npm run build
node --import tsx tests/vfx-browser.ts --studio
node --import tsx tests/vfx-browser.ts
```

The test uses the local Chrome executable on macOS with the Metal renderer. `CHROME_PATH` can select a different Chrome executable, but the current live performance assertion expects Metal. The studio route and diagnostic objects exist only in the test server; they are not shipped in the production game.

Three studio checks passed on 2 October 2026. The [studio report](../artifacts/vfx-studio-report.json) records:

- No rifle/muzzle geometry across the sampled center aiming region during charge, release and residue, at desktop, landscape-phone and portrait-phone aspect ratios.
- Correct 18-ms release and 200-m/s travel math; 80 mixed normal/phased surface effects followed by a 32-shot stress burst remain within 16 slots and expire cleanly.
- Identical normal effect state after phased and surface-variant reuse, with the intended armor/metal/composite color and two/three/zero lobe counts.
- Whole-studio renderer memory stays at 220 geometries and 37 textures before, during and after pool stress. These totals include the arena, rifle and operator; the VFX pool itself adds three geometries and no textures.
- Explicit disposal removes every pool object and disposes all three geometries and 144 materials.
- Freeze frames capture charge, release, close/medium/long flight, armor/metal/composite impacts, remote firing, phasing and residue inside the actual arena lighting.

The full suite completed at **21:11 IST on 2 October 2026**, passing **14 checks with no page or shader errors**, including the three studio checks and an unmodified **180-second match** in two independent production Chrome clients. The final [live report](../artifacts/vfx-report.json) records:

- Both clients moved, aimed, fired, eliminated and respawned; three hits retained the exact 100 → 66 → 32 → 0 health steps. Real five-second respawn, one-second protection, cover blocking, dash/cooldown, natural Phase Cell pickup and four-second expiration passed.
- First-person and remote firing were captured at **2.5, 10 and 24 meters**. Native audio/WebGL hooks captured 52 rendered frames across firing stages without adding a production debug API. Freeze-frame inspection also covered the different surface contacts and phasing.
- **30.524 seconds** of held fire produced **107 server-confirmed shots and 107 rifle audio starts**. Received event spacing had a median **290.9 ms**; the unchanged server enforces its 280-ms minimum. The live crosshair stayed visible and precisely centered.
- The natural timeout ended 1–1, correctly chose the earlier tied-score operator on both clients, and host replay returned both to a clean lobby. The clients received **3,038 and 3,032 snapshots**, with **193 shot events each**.
- On **Apple M4 / ANGLE Metal**, the 1280 × 800 primary client recorded **10,803 full-match frame intervals** with **16.7 ms median/p95** and **16.8 ms p99**. The 960 × 640 second client remained active. The sustained-fire window recorded **1,831 intervals**, also 16.7 ms median/p95 and 16.8 ms p99. These are local headless render intervals, not display/input latency or a controlled before/after benchmark.
- All **66 unit/socket tests** and the final **22-check desktop/emulated-touch/solo browser regression** passed, including 12 pulse motion/contact/pool tests. All six server/shared files match the pre-VFX source archive byte-for-byte. No server rule or protocol was changed.

An initial live run stopped after held fire because the existing crosshair was offset two pixels from the exact aim point. Its CSS is now centered; the successful run repeated the complete match from the beginning. The test uses private starting poses and actual DOM input/socket events; the match clock, scoring and winner stay authoritative. Human comfort is not inferred from these results.

## Limits

Automated browser contexts on one Mac are not a two-human or two-physical-device playtest. Physical-phone rendering and touch firing comfort, WAN/public deployment performance, subjective sound alignment, repeated-fire comfort, first-time visual recognition and comparative visual-quality judgments remain unverified. Aspect-ratio and geometry checks support crosshair clearance but cannot prove that every player finds the effects comfortable or that no enemy is briefly obscured at every angle.

The compact pulse may travel between render frames at close range; the arrival glint and impact help retain its readability without slowing it. There is no lag compensation or gameplay collision supplied by these effects, and no per-plate armor contact simulation or fullscreen distortion. Public deployment remains a separate release gate.
