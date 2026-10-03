# NEON BREACH

**The contract ends when the signal dies.**
<img width="1509" height="932" alt="Screenshot 2026-10-02 at 22 38 40" src="https://github.com/user-attachments/assets/0c564c68-eb2b-4f20-a39a-fd2f10c3d3ad" />

A browser first-person orbital arena shooter with **solo practice against three bots** and **multiplayer for 2–4 human players**. One arena, one Pulse Rifle, one Phase Cell, and server-authoritative gameplay. Original procedural geometry, styling, and synthesized sounds; no external art or font downloads.

The Pulse Rifle is an original induction weapon with a visible power core, split ceramic shell, protected internal conductors, and an open pulse-forming muzzle. Both gloved hands hold shared grip anchors in first and third person. Confirmed shots drive a short core charge, contained directional muzzle bloom, compact moving pulse with a capped trail, and distinct armor/metal/composite contact residue. The visual pulse travels at 200 m/s; gameplay remains instant hitscan. A fixed effects pool avoids per-shot geometry allocation. See [the rifle design](docs/WEAPON.md) and [firing effects, timing, and verification notes](docs/VFX.md).

Operators wear the original **PRESSURE / 07** armor family: a sealed reflective visor, fitted fabric undersuit, articulated ceramic plates, rubber seals, and a compact rear life-support unit. All four colors share the same human proportions and rig, with identifying accents on the visor rim, shoulders, chest, and small status lights. First-person gloves and forearms share the third-person suit construction. Remote operators breathe, walk/run, turn, aim, recoil, react to hits, briefly collapse, and recover from dash. See [the character design, live-test evidence, and remaining visual limitations](docs/CHARACTERS.md).

Audio uses original layered rifle/impact textures, positional combat and footsteps, confirmed dash cues, Phase Cell power sounds, and quiet station ambience. Settings provide persistent Master, Effects, Ambience, Music, UI, and Mute controls. Click or tap **Enable Audio** if your browser needs a gesture; muted play retains all visual feedback. See [the audio design and verification notes](docs/AUDIO.md), including the explicit listening-test limitations.

The original **Signal / Inheritance** score connects a quiet lobby, match introduction, sparse combat bed, adaptive intensity, final-minute variation, victory, and contract-lost ending. Nearby gunfire ducks music; the Music slider is independent of gameplay effects. Compressed assets and their composition source are included. See [the score, authorship, and verification notes](docs/MUSIC.md), including the unverified listening qualities.

The arena is **The Shattered Relay**: a damaged orbital communications chamber with a suspended relay, mirrored power-bank cover, blue and amber service lanes, an armored planet viewport, a scarred blast door, and a broken uplink display. Shared server/client geometry keeps the added solid structures consistent with movement and shots. See [the environment layout, rendering tradeoffs, and live-match evidence](docs/ENVIRONMENT.md).

## Real-time hosting

This release restores a **persistent Node/Socket.IO game server**, while the website can remain on Netlify. Live inputs no longer read and replace a Blobs object. The authoritative server simulates at 60 Hz, pushes snapshots at approximately 20 Hz, and receives input at approximately 30 Hz. Rendering, game rules, touch controls, art and sounds are preserved.

**The public Netlify site has not yet been switched to this transport.** `public/game-config.json` deliberately retains HTTP compatibility until there is an actual verified backend URL. Uploading this ZIP alone will not solve hosted multiplayer lag. Local play and direct backend-hosted play already select WebSockets automatically.

The measured old Netlify responses had a 525 ms median, compared with 13 ms locally. See [the diagnosis](docs/NETLIFY-LATENCY.md). A persistent game server removes those per-input function/storage operations; internet latency still depends on server region and players' networks.

[Deploy the prepared backend to Render](https://render.com/deploy?repo=https://github.com/SahilSinhaDev-cpu/Neon_Breach)

1. Open that link, sign in, review the **one free Node web service in Singapore**, and deploy. The root `render.yaml` supplies build, start and health-check settings. No database, API key, or user-defined environment variable is required.
2. Send the actual assigned HTTPS service URL back to the developer. The developer verifies its health and WebSocket room flow, updates the frontend configuration, and supplies the final Netlify upload. There is no placeholder hostname to copy.
3. Publish the rebuilt frontend to your existing Netlify project, then run the two-device checklist below.

Render's [free service](https://render.com/docs/free/) sleeps after 15 minutes without inbound traffic and can take about a minute to wake. It is a testing/hobby deployment, not an always-on production guarantee. A paid instance removes this idle-sleep limit; no paid service is selected here. Use one instance: rooms are in its memory. Deployments and restarts end its rooms. See [the real-time protocol and deployment details](docs/REALTIME.md).

The bundled Netlify Function is retained for compatibility with the existing website. In that mode the frontend still calls `/.netlify/functions/game` directly, with strong reads and conditional Blobs writes. Helpers remain outside `netlify/functions`; there is no `/api/game` redirect. The ZIP contains root-level source, configuration, lockfile, built frontend, compiled server and packaged function, with no dependencies, caches, secrets or logs. Netlify can rebuild this source ZIP; the **second backend deployment remains necessary for real-time play**.

## Play

- **Multiplayer:** one player creates a room; 1–3 friends enter its six-character code on their own devices. Only the host starts, with at least two humans.
- **Solo:** Play Solo creates a private session with three clearly labeled bots. One human can start.
- **Desktop:** WASD/arrows move, mouse aims, click/hold fires, Shift dashes, Esc releases the mouse. Settings adjust sensitivity and audio.
- **Touch:** left stick moves, right drag aims, Fire shoots, Dash dashes. Landscape provides more aiming space.
- **Combat:** 100 health; 34 damage; 280 ms minimum fire interval; unlimited ammunition. Three hits eliminate. Respawn after five seconds, then one second of protection from firing and damage.
- **Dash/Phase:** dash up to six meters every three seconds, stopping at cover. The center cell appears after 20 seconds. Touch it for four seconds of phasing; remain visible and hittable. Replacement appears 20 seconds after pickup.
- **Winner:** first to ten eliminations, otherwise the most at 180 seconds. Ties favor the earlier achievement of the tied score, then join order. Last connected human wins in multiplayer.
- **Replay:** host chooses Return to lobby; all connected players reset, then host starts a new match. There is no series or aggregate winner: each contract has its own score and winner.

The lobby shows all seven rules. In real-time mode, lobby refresh or a brief dropped connection recovers the same private seat for up to 30 seconds. Duplicate connected seats are rejected. Disconnecting during a match removes that player; reconnecting displays a clear Return home overlay. Explicit leave is immediate; silent connection loss is detected by the WebSocket heartbeat (2.5-second ping interval and 5-second timeout). Stale movement and held fire stop after 350 ms without accepted input. Clients cannot choose positions, damage, deadlines or scores.

## Two-device check after upload

1. Open the assigned HTTPS URL on two devices or independent browsers.
2. Enter different callsigns; create a room on A; enter its code and join on B.
3. Start as host. Move independently and confirm the other operator moves.
4. Shoot an exposed player three times; confirm score, elimination, respawn and protection. Try firing through cover and dashing into a wall.
5. After 20 seconds, collect the center Phase Cell and check its four-second countdown.
6. Reach ten eliminations or let the three-minute timer expire. Both devices must show matching scores and winner.
7. Return both players to the lobby and repeat twice for three complete contracts.

## Architecture and limits

`server/app.ts` is the production Express/Socket.IO server. It uses the shared rooms, bots, match logic and geometry rather than a separate set of game rules. Positions, hitscan collision, cooldowns, respawns, Phase Cell, match clocks and winners remain authoritative. Time is wall-clock based with monotonic elapsed time; each process has a stream epoch, and each room has sequenced snapshots/events. Remote interpolation and bounded local correction remain in the renderer. There is no server-side rewind.

Room/action acknowledgements use request IDs and a bounded deduplication cache. A retry on the same live socket cannot duplicate creation or replay. A changed connection cannot install an old acknowledgement. Inputs are volatile and are never buffered for an offline player. Room codes and seat tokens remain private to the room flow; callsigns are validated and displayed as text. WebSocket origins are restricted to the current backend origin and `https://neonbreach977.netlify.app`.

This is a single-instance deployment. Live rooms are intentionally ephemeral. Empty rooms and disconnected lobby reservations expire after 30 seconds; disconnected players cannot rejoin an active match. Horizontal scaling, cross-instance room routing, seamless restart recovery, and lag compensation are not implemented. Server load at large player counts has not been benchmarked. A phone's graphics performance and an actual hosted game still need verification.

## Developer checks

Node 22.12 or newer is required. For developers, `npm ci`, `npm run build`, then `npm run dev` runs the built game with the real-time server at `http://localhost:3000`. `npm start` runs its compiled production entry. Rebuild after frontend edits. `npm run dev:http` runs the retained Netlify compatibility preview.

- `npm test`: automated game, transport, validation, audio and storage tests.
- `npm run test:realtime`: two independent Chrome clients with 200 ms added RTT; three genuine 180-second contracts and replay. It uses compiled production assets/server. Tests control poses only, not scores or deadlines.
- `npm run test:realtime-touch`: Chrome touch emulation, authoritative touch movement/aim/fire/dash and solo bots.
- `npm run test:realtime-split`: distinct frontend/backend origins; lobby recovery, active disconnect and the next lobby.
- `npm run test:browser` / `npm run test:touch`: retained Function/Blobs compatibility tests.
- `npm run package:netlify`: creates `netlify-ready-game.zip` with complete source and release artifacts.

Browser automation currently uses the installed macOS Chrome path. It is not a physical phone or two humans. See [the new verification report](docs/REALTIME-TEST-REPORT.md) and `artifacts/realtime/`. Earlier `docs/NETLIFY-TEST-REPORT.md` and `docs/TEST-REPORT.md` document previous transports; they are historical evidence, not proof that this new backend is live.

## Project contents

- `client/`, `index.html`, `public/`: original UI, art, audio, settings, HTTP compatibility and real-time transports.
- `server/app.ts`, `server/index.ts`, `server/game.ts`, `server/bots.ts`, `shared/`: persistent authoritative runtime, shared rules, bots and collision geometry.
- `render.yaml`, `Dockerfile`, `.dockerignore`: backend deployment settings and an optional container build.
- `netlify.toml`, `public/game-config.json`: frontend build and runtime transport selection.
- `netlify/functions/game.ts`, `netlify/lib/`: retained standard Function/Blobs backend for the staged switch.
- `dist/client`, `dist/server`, `dist/functions/game.zip`: production artifacts in the ZIP. The hosts rebuild from source.
- `scripts/configure-realtime.mjs`: developer release tool; verifies a real HTTPS backend, creates and cleans up a test room, then configures Netlify. It is not a command the player must run.
- `tests/realtime*.ts`: current persistent-server acceptance. Older visual suites and `tests/legacy/` remain historical fixtures.
