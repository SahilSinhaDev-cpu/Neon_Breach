# NEON BREACH

**The contract ends when the signal dies.**

A browser first-person orbital arena shooter with **solo practice against three bots** and **multiplayer for 2–4 human players**. One arena, one Pulse Rifle, one Phase Cell, and server-authoritative gameplay. Original procedural geometry, styling, and synthesized sounds; no external art or font downloads.

The Pulse Rifle is an original induction weapon with a visible power core, split ceramic shell, protected internal conductors, and an open pulse-forming muzzle. Both gloved hands hold shared grip anchors in first and third person. Confirmed shots drive a short core charge, contained directional muzzle bloom, compact moving pulse with a capped trail, and distinct armor/metal/composite contact residue. The visual pulse travels at 200 m/s; gameplay remains instant hitscan. A fixed effects pool avoids per-shot geometry allocation. See [the rifle design](docs/WEAPON.md) and [firing effects, timing, and verification notes](docs/VFX.md).

Operators wear the original **PRESSURE / 07** armor family: a sealed reflective visor, fitted fabric undersuit, articulated ceramic plates, rubber seals, and a compact rear life-support unit. All four colors share the same human proportions and rig, with identifying accents on the visor rim, shoulders, chest, and small status lights. First-person gloves and forearms share the third-person suit construction. Remote operators breathe, walk/run, turn, aim, recoil, react to hits, briefly collapse, and recover from dash. See [the character design, live-test evidence, and remaining visual limitations](docs/CHARACTERS.md).

Audio uses original layered rifle/impact textures, positional combat and footsteps, confirmed dash cues, Phase Cell power sounds, and quiet station ambience. Settings provide persistent Master, Effects, Ambience, Music, UI, and Mute controls. Click or tap **Enable Audio** if your browser needs a gesture; muted play retains all visual feedback. See [the audio design and verification notes](docs/AUDIO.md), including the explicit listening-test limitations.

The original **Signal / Inheritance** score connects a quiet lobby, match introduction, sparse combat bed, adaptive intensity, final-minute variation, victory, and contract-lost ending. Nearby gunfire ducks music; the Music slider is independent of gameplay effects. Compressed assets and their composition source are included. See [the score, authorship, and verification notes](docs/MUSIC.md), including the unverified listening qualities.

The arena is **The Shattered Relay**: a damaged orbital communications chamber with a suspended relay, mirrored power-bank cover, blue and amber service lanes, an armored planet viewport, a scarred blast door, and a broken uplink display. Shared server/client geometry keeps the added solid structures consistent with movement and shots. See [the environment layout, rendering tradeoffs, and live-match evidence](docs/ENVIRONMENT.md).

## Publish by drag and drop

Download **netlify-ready-game.zip**, sign in to [Netlify Drop](https://app.netlify.com/drop), and drop the complete ZIP. Wait for the build and deployment, then open the assigned HTTPS URL. Netlify builds the source project using the root `netlify.toml` and installs the lockfile dependencies automatically. Do not drop just `index.html` or `dist/client`: the complete source ZIP supplies the multiplayer function.

No GitHub repository, Terminal commands, user-configured environment variables, API keys, or database setup are needed. Netlify provisions Blobs and supplies its runtime credentials. You need to be signed in for source-project builds, as described in [Netlify’s Drop documentation](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/). If your team makes new sites private, use the dashboard visibility control so friends can open the URL.

The sole deployed backend is the standard **`netlify/functions/game.ts`**. The frontend calls **`/.netlify/functions/game`** directly. There is no custom function path or game redirect. Helpers are in `netlify/lib`, `server`, and `shared`, outside the function entry directory. There is no always-on backend in this deployment.

## Play

- **Multiplayer:** one player creates a room; 1–3 friends enter its six-character code on their own devices. Only the host starts, with at least two humans.
- **Solo:** Play Solo creates a private session with three clearly labeled bots. One human can start.
- **Desktop:** WASD/arrows move, mouse aims, click/hold fires, Shift dashes, Esc releases the mouse. Settings adjust sensitivity and audio.
- **Touch:** left stick moves, right drag aims, Fire shoots, Dash dashes. Landscape provides more aiming space.
- **Combat:** 100 health; 34 damage; 280 ms minimum fire interval; unlimited ammunition. Three hits eliminate. Respawn after five seconds, then one second of protection from firing and damage.
- **Dash/Phase:** dash up to six meters every three seconds, stopping at cover. The center cell appears after 20 seconds. Touch it for four seconds of phasing; remain visible and hittable. Replacement appears 20 seconds after pickup.
- **Winner:** first to ten eliminations, otherwise the most at 180 seconds. Ties favor the earlier achievement of the tied score, then join order. Last connected human wins in multiplayer.
- **Replay:** host chooses Return to lobby; all connected players reset, then host starts a new match. There is no series or aggregate winner: each contract has its own score and winner.

The lobby shows all seven rules. Lobby refresh recovers the same seat with its private session token, preserving it through transient storage failures. An expired lobby heartbeat can recover automatically; a lease replaced by another tab cannot. Refresh during a match cannot rejoin it. Explicit leave is immediate; silent connection loss is detected after eight seconds without a successful poll, on the next room request. A server-observed input watchdog adapts between 350 ms and two seconds to the connection’s accepted input cadence, then stops stale movement and held fire. Clients cannot choose this allowance.

## Two-device check after upload

1. Open the assigned HTTPS URL on two devices or independent browsers.
2. Enter different callsigns; create a room on A; enter its code and join on B.
3. Start as host. Move independently and confirm the other operator moves.
4. Shoot an exposed player three times; confirm score, elimination, respawn and protection. Try firing through cover and dashing into a wall.
5. After 20 seconds, collect the center Phase Cell and check its four-second countdown.
6. Reach ten eliminations or let the three-minute timer expire. Both devices must show matching scores and winner.
7. Return both players to the lobby and repeat twice for three complete contracts.

## Architecture and limits

The function loads one room blob with **strong consistency**, advances the shared 60 Hz simulation up to the current server time, applies validated input/actions, and saves the complete state using **`onlyIfMatch`**. Room creation uses **`onlyIfNew`** and retries collisions. Conflicts reload and recompute; no client-authored damage, scores, positions or timestamps are accepted. Missing read or write ETags fail closed. Transient storage reads/conditional writes retry at most three times with unchanged conditions, inside a four-second total I/O budget. Concurrent retries use a fresh, monotonic server clock. Bot brains, deadlines, connection leases, event cursors and action deduplication persist across invocations.

HTTP requests replace WebSockets. Active clients keep one request in flight and poll with an 80 ms minimum cycle including request latency; lobby clients use a 400 ms minimum cycle. Slow active responses trigger the next poll immediately. Visual rendering/prediction remains continuous, with bounded latency-aware prediction and collision checks. Respawn and dash discontinuities reset the remote interpolation history. This cannot promise the old WebSocket update rate or latency, especially on cold starts or distant networks. There is no server-side rewind. Effects use bounded sequenced events; missed old effects do not alter scores or health. Blobs is optimized for reads and infrequent writes; this FPS workload depends on platform latency and service limits. Each room is a single conditional-write unit, not a transactional multi-key database.

Brief transport errors preserve held movement and show UPLINK RETRYING. After 2.2 seconds without a successful reply, a reconnect overlay suspends controls. Movement resumes with held keys when the same seat reconnects; releasing keys, leaving, losing focus, or unlocking the pointer still clears controls. The HUD clock never moves backward because of a delayed snapshot.

There are no background game timers. Match clocks and deadlines progress when a room is requested. Eight-second heartbeat disconnects, lobby reservation cleanup and room expiration are evaluated on access. Empty rooms expire logically after 30 seconds; abandoned rooms after 15 minutes. Expired blob objects remain stored; this implementation does not pretend that Netlify Blobs supplies automatic TTL deletion. See [the protocol](docs/PROTOCOL.md) and [current test evidence](docs/NETLIFY-TEST-REPORT.md).

## Project contents

- `client/`, `index.html`, `public/`: original art, layout, audio/music and gameplay UI; HTTP transport and latency-aware motion prediction.
- `netlify/functions/game.ts`: the only deployed function entry.
- `netlify/lib/authority.ts`, `storage.ts`: strong reads, confirmed conditional persistence, request validation, storage timeout/error handling and room lifecycle.
- `server/game.ts`, `server/bots.ts`, `shared/`: reusable authoritative rules, bot decisions and collision geometry.
- `netlify.toml`, package manifests: automatic frontend/function build configuration.
- `dist/client`, `dist/functions/game.zip`: verified production assets and the officially packaged function, included for inspection. Netlify rebuilds the source on upload.
- `tests/netlify*.ts`: current Blobs, production-browser, touch and solo verification. `scripts/` contains developer-only build/packaging/preview tools, not deployment prerequisites for you.
- `tests/legacy/` and older visual browser suites: historical Socket.IO test fixtures retained as source/evidence; they are not deployed or part of current acceptance. Their old live-network branches target the previous transport.

## Verification status

See `docs/NETLIFY-TEST-REPORT.md` and `artifacts/netlify/`. The older `docs/TEST-REPORT.md` records the pre-migration WebSocket build; it is historical, not evidence of hosted Netlify behavior. Automated browser contexts are independent test clients, not two human players on physical devices.

The existing site at https://neonbreach977.netlify.app already contains the previous update. A new live probe reproduced four storage-error responses in 107 polls. Release **2026-10-03-recovery-2** addresses how those failures interrupt movement and lobby recovery, adds bounded storage retries, and stabilizes the HUD clock. This new release has not been published from this workspace: authenticated deployment access is unavailable. Extract `netlify-ready-game.zip` and drop the complete folder under the existing project's **Production deploys**, then perform the two-device checklist. No local preview is left running. See [the bugfix notes](docs/NETLIFY-BUGFIX.md).
