# PRESSURE / 07 operators

The operator is an **original, code-native Neon Breach design**. Its geometry, rig, armor markings, visor treatment, and material textures are generated locally. It uses no downloaded character, ripped game asset, or licensed human model. All players use the same armor family and animation implementation; assigned colors identify operators rather than changing them into unrelated heroes.

## Body and equipment

`client/models.ts` builds a human-scale body around articulated hips, knees, ankles, shoulders, elbows, and wrists. A tapered chest, fitted waist, pelvic harness, sealed neck, and human head-and-shoulder outline keep the wearer legible beneath the armor. Separate shoulder shells, chest and abdominal plates, thigh protection, shin plates, gloves, and boots sit over a flexible pressure layer. A compact pair of rear life-support cartridges and a central pressure spine distinguish the rear profile.

The sealed helmet has a swept dark visor, jaw protection, crown seam, neck seal, side service sensor, and rear pressure coupling. The visor uses a generated reflection gradient and a faint internal head/nasal shadow. It is not an exposed face. The neutral ceramic shell, lightly worn metal, woven undersuit, rubber seals, and glove protectors use distinct material finishes. Wear is limited to sparse directional scuffs, panel-edge dirt, and small contact marks.

Player colors are confined to the visor rim, shoulder identifiers, chest badge, and small equipment/status lights. The armor stays neutral. The same four colors appear in the lobby, HUD, suit identifiers, and footprint ring. A small numbered chest service label distinguishes the four variations.

`client/suit.ts` supplies shared suit materials, forearm construction, and articulated fingers/thumbs to both perspectives. The first-person Pulse Rifle includes detailed armored forearms and gloves; the remote rifle uses the same glove layout at lower subdivision. Remote arm joints solve toward the rifle's exported wrist anchors, so the rifle and its gripping hands remain one assembly while the forearms follow them. The first-person forearms carry the local player's color markings.

## Animation and authority

The visual rig implements:

- Idle breathing and a small torso weight shift.
- Walking and running with alternating foot targets, two-bone leg solves, opposite upper-body motion, and a lowered pelvis for usable leg reach.
- Turning with eased hip orientation and a compensating shoulder/torso twist.
- Pitch-aware head, torso, and two-handed rifle aiming.
- Short recoil and a restrained camera/viewmodel response to confirmed fire.
- A short torso/head hit reaction.
- A knees-bent elimination collapse and fade, clearing after 0.72 seconds.
- A restrained dash lean and recovery.

Remote operators receive these actions from authoritative snapshots and confirmed shot events. A new life resets reactions and stride state. Eliminated operators briefly remain visible for feedback, then disappear until respawn. Protection uses the existing visible shield; Phase Cell ownership makes the suit translucent and restores its original material state when the effect ends.

Adaptive cycle distance improves steady walking and running: planted foot travel counteracts forward body travel during stance. The animation is not a full locomotion controller. Very slow analog input, acceleration, braking, sharp direction changes, and turning can still produce some foot sliding. The elimination is a short authored procedural collapse, not a physics ragdoll.

The upgrade changes **appearance only**. Server health, movement speed, collisions, hitscan damage, firing cooldown, dash rules, respawn/protection timing, scoring, and match rules remain unchanged. The server still uses its existing simple, axis-aligned 0.84 × 1.85 × 0.84 m player hit volume; visual armor never supplies authoritative positions or hit geometry. The neutral support-arm outline extends about 3.7 cm beyond the front face of that box. Animated boots and strafe poses can extend farther, and weapons are cosmetic. These are consistent visual margins, not new armor-specific hit regions.

## Measured verification

The character studio run on 2 October 2026 recorded:

| Measurement | Result |
|---|---|
| Operator geometry, including rifle and effect geometry | 22,750 triangles |
| Mesh objects / transform groups | 92 / 27 |
| Worst actual forearm-end to rifle-wrist separation | 4.75 × 10⁻¹⁶ m |
| Lowest tested boot heel | 0 m |
| Largest tested leg stretch | 1.0000000000000007 |
| Phase material restoration | Passed |
| Neutral body bounds, excluding rifle | X [−0.346, 0.373], Y [0, 1.806], Z [−0.457, 0.224] m |
| Browser errors | None |

The mesh count is an object count, **not measured GPU draw calls**. Wrist, floor, and stretch audits sample idle, walking, running, and three aim pitches. Neutral bounds do not certify every animated pose. Studio captures cover front, side, rear, helmet, four-color lineup, walk, run, up/down aim, fire, hit, dash, elimination, phasing, and protection.

The live run passed **eight acceptance checks with four independent Chrome contexts** in one server-authoritative room. All four color variants were present. Built production clients exercised real DOM controls and Socket.IO traffic: operators at 2.5, 10, and 24 m; remote movement/turning/dash; three 34-damage hits; elimination and clearing; five-second respawn and protection; a naturally scheduled Phase Cell pickup and expiration; cover-blocked shots; disconnect victory; and replay to a clean lobby. Controlled starting poses exist only inside the test process; production exposes no QA route or authoritative position override.

The final live run completed at **20:29 IST on 2 October 2026**. On Apple M4 / ANGLE Metal, with a 1280 × 800 primary viewport and three 720 × 480 viewports, the approximately 29-second four-client movement/firing segment recorded **1,715 primary-client frame intervals**, with median and 95th percentile both **16.7 ms**. This is a local headless-browser measurement on one Mac, not a broad device benchmark, display/input-latency measurement, or proof of an unchanged frame rate relative to the earlier model. No same-hardware before/after baseline was recorded.

Evidence is retained in [`character-studio-report.json`](../artifacts/character-studio-report.json), [`character-live-report.json`](../artifacts/character-live-report.json), the `character-*.png` studio images, and `character-live-*.png` arena captures.

## Reproduction and limits

With Node 22 or newer and dependencies installed:

```sh
npm run build
npm test
npm run test:character
```

The character suite runs studio audits/captures followed by the four-client live checks. `npm run test:character -- --studio` runs only the studio portion. The browser tests use installed Chrome with ANGLE Metal; the live harness accepts `CHROME_PATH` when Chrome is elsewhere. The default studio executable path is the macOS Chrome application. These measurements therefore require a compatible Mac to reproduce directly.

**Remaining limits:** this is procedural game art with visible faceting and simplified close-up surface detail, not a photorealistic scanned character. Inspection of sampled poses cannot prove zero finger, armor, or weapon clipping at every extreme angle. Very slow or changing motion does not have perfect foot locking. No human anatomy/readability study, unscripted two-human session, physical-phone character performance test, or public/WAN deployment check was completed for this upgrade. The existing local multiplayer verification is distinct from a publicly deployed release.
