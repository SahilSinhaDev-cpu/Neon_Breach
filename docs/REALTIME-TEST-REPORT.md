# Real-time release verification — 3 October 2026

Release `2026-10-03-realtime-1`. The new backend is implemented and locally verified; it is **not yet deployed** and the existing Netlify frontend still selects HTTP compatibility. This report makes no hosted-performance claim.

## Checks actually run

- **130 automated tests passed, zero failures.** Coverage includes room validation/collision/full capacity, host transfer, server membership/input validation, hitscan cover, damage/fire cooldown, five-second respawn/one-second protection, dash collision/cooldown, Phase Cell lifecycle, first-to-ten/timeout/tie/disconnect winners, replay, solo bots, and the retained strong/CAS storage path.
- Real Socket.IO integration verified independent seats and movement, approximate 20 Hz snapshots, stale-input cutoff, host-only start, active join rejection, lobby recovery, idempotent commands, origin/protocol validation, disconnect winner and replay.
- Client transport tests verified lost-ack retry uses the same request ID, changed connections cannot install old replies, canceled late creation is left, and snapshots reject old sequence/epoch.
- Two independent Chrome contexts ran **three real 180-second contracts**, including scoring, timeout, tied-score winner and clean replay after each. No fixture changes scores, deadlines or winner rules. Server-only poses make exposed and covered combat reproducible.
- Both directions of WebSocket traffic were delayed by 100 ms. Continuous authoritative movement covered **12.00 m over approximately 2,001 ms**, within six meters/second, while the other browser received **40 snapshots** in that interval. This is injected latency, not hosted Render latency or a visual frame-rate measurement.
- The browser match verified desktop movement/pointer-lock resume, cover blocking, three-hit elimination, real respawn/protection, natural 20-second Phase Cell spawn, center pickup and four-second expiration. Gameplay made **zero Netlify Function requests** and produced **zero browser errors**.
- Chrome touch emulation passed portrait layout, joystick movement, drag aiming, Fire scoring, Dash wall collision, leave/disconnect winner and solo play with three labeled authoritative bots.
- Separate frontend/backend localhost origins passed configured-server selection, transient lobby recovery without duplicate seats, match disconnect/Return home, and joining the next clean lobby. No function fallback occurred.

## Three full matches

| Contract | Real elapsed time | QAVEX–QANYX | Winner |
| --- | --- | --- | --- |
| 1 | 180203 ms | 1–0 | QAVEX |
| 2 | 180169 ms | 0–1 | QANYX |
| 3 | 180550 ms | 1–1 | QANYX |

Contract three's winner reached the tied elimination score earlier. Both browsers showed the same result. The host returned both players to a score-zero, health-100 lobby after every match; each subsequent contract required Start.

Evidence: `artifacts/realtime/browser-report.json`, `unit-report.json`, `touch-report.json`, `split-report.json`, match/mobile captures and all three result captures. The browser fixture imports the compiled `dist/server/app.mjs` and serves built frontend assets. After these tests, leave handling was made idempotent for an already-disconnected socket; the automated, separate-origin and touch suites were rerun against the final build. Core match code and frontend did not change.

## Build and package

TypeScript checking, Vite production build, bundled Node server and Netlify's official Function packaging passed. The existing Three.js vendor chunk exceeds Vite's 500 kB warning threshold; this is a warning, not a build failure. A clean archive extraction passed lockfile installation and a fresh build; frontend, compiled server modules and packaged function module reproduced exactly. The production entry and packaged compatibility Function passed real create/join/start, movement (server), disconnect winner and replay checks. A production dependency audit reported zero known vulnerabilities. Evidence is in `artifacts/realtime/package-report.json` and `production-report.json`.

## Not verified / limits

- Actual hosted backend deployment, public Netlify switch and a public two-client match. The hosting account and real service URL are unavailable in this session.
- Two human players on separate physical devices, physical touch phones, subjective audio listening and phone GPU performance.
- Large-room-count load, malicious distributed traffic, seamless server restarts, multi-instance routing and server-side rewind.
- Container build: Docker CLI is installed, but its daemon is unavailable. The equivalent production Node build/start is checked directly.

The prepared Render blueprint selects a free Singapore instance. It is subject to idle sleep and restart limits; always-on production requires a separately approved paid instance. No performance promise is inferred from local results.
