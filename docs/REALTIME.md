# Persistent multiplayer runtime

Release: `2026-10-05-navigation-1`; protocol: `2`. Deploy frontend and backend together.

The persistent runtime replaces request-by-request room simulation and Blobs writes. It reuses `server/game.ts`, `server/bots.ts`, and `shared/world.ts`, so collision, weapon damage, respawns, protection, dash, Phase Cell, scoring and tiebreaking remain the same. The HTTP backend is retained only for a staged migration of the existing Netlify website.

## Runtime and authority

One Node process holds live rooms in memory. A 60 Hz fixed-step simulation uses a wall-clock baseline plus monotonic elapsed time. Catch-up is bounded to 250 ms after an event-loop stall; the real match deadline is checked independently, so a stalled process does not extend the contract. Playing/results snapshots are pushed approximately every 50 ms; lobbies every 400 ms. Shots are processed immediately on accepted input from the server-known eye position, checking cover before players. Held fire remains server-timed at 280 ms. There is no rewind.

The client samples at approximately 30 Hz using volatile WebSocket messages. It does not queue movement or shots during a disconnection. The last accepted input expires after 350 ms. Remote operators interpolate between snapshots; local prediction/correction is bounded and shares collision geometry. A life generation prevents delayed input from controlling a newly respawned operator. Dash is latched briefly until an authoritative acknowledgement, then cleared; it cannot bypass the server cooldown.

## Protocol

Socket.IO uses only WebSockets at its standard `/socket.io/` endpoint. Handshake auth includes `{protocol: 2}`. The server validates room membership against the actual socket ID for every input/action. It accepts only the configured Netlify origin and its own host origin. Non-browser connections must still obtain a valid room seat; origin checks are not a replacement for membership validation.

| Direction/event | Payload and meaning |
| --- | --- |
| Server `hello` | `{epoch, release, protocol}`; epoch changes after restart. |
| Client `room` | `{requestId, action: create/join/solo, name, code?, token?}`; acknowledged with `ok`, private seat ID/token and initial public snapshot, or a clear error. |
| Client `action` | `{requestId, action: start/replay/return-lobby/leave}`; start/replay require host membership. Leave is safe to repeat after a disconnected seat. |
| Client `input` | `{seq, life, mx, my, yaw, pitch, fire, dash}`; no positions, damage, scores or client timestamps. |
| Server `snapshot` | `{epoch, seq, snapshot}`; public state omits tokens, sockets, inputs and bot brains. Client rejects old epoch, old sequence and unrelated room. |
| Server `event` | `{epoch, seq, code, event}`; confirmed shots, hits, eliminations, respawns, dash and phase feedback. |
| Client `pingCheck` | Acknowledgement measures actual round-trip time. |
| Server `shutdown` | Visible station-restart message before graceful termination. |

Room/action request IDs are validated, and the most recent 32 successful replies per socket are cached. One client retry uses the same ID only while that same connection remains alive. A reconnection invalidates pending acknowledgements. Canceled successful room creation is explicitly left rather than installed in the UI. Ordinary malformed JSON/inputs do not crash the server.

Packet payloads are limited to 4 KiB. Per-socket token buckets limit room attempts, room actions, input and pings. A global 512-connection ceiling limits this MVP. Direct connections also have a 32-connection/address ceiling. On Render, its built-in `RENDER` flag disables that address grouping because the upstream address is a shared proxy; arbitrary forwarded-IP headers are not trusted. This is basic abuse control, not large-scale DDoS protection or a measured 512-player capacity.

## Room lifecycle

Lobby disconnection reserves the same seat for 30 seconds, while transferring host status to the next connected human. Recovery requires the original secret token and callsign and cannot duplicate a currently connected seat. Tokens are stored in browser session storage, not sent in URLs. A page refresh closes the old WebSocket; if it has not yet closed, duplicate-seat recovery is rejected clearly.

An active match disconnect is final for that contract. With at least two humans remaining it continues; with one it ends immediately. Reconnection displays Reconnect and a confirmed Return to Landing. Personal Return to Lobby preserves a connected waiting seat and transfers host to an active human; waiting seats can recover during a live match. See [navigation behavior](NAVIGATION.md). After replay, the operator can join the next lobby normally. Connected players return to a fully reset lobby; the host must start the next contract. Empty rooms and stream state are removed after 30 seconds. Cleanup and deadlines run in the server rather than waiting for a browser poll. Socket.IO heartbeat uses a 2.5-second interval and 5-second timeout.

Rooms and command caches are ephemeral. Restart/redeploy loses them. Horizontal scaling needs explicit room routing and shared authority and is not part of this implementation. Do not increase the blueprint instance count.

## Deployment and staged switch

`render.yaml` supplies one free Singapore Node service, locked to one instance. Build installs development build tooling, runs the TypeScript/frontend/server/function build, then `npm start` runs `dist/server/index.mjs`. Render supplies `PORT` automatically. The Dockerfile is an optional alternative. `/healthz` reports protocol/release and expected tick/snapshot rates. `/game-config.json` on the server selects same-origin WebSockets; the server can serve the entire game directly as well.

Netlify's `public/game-config.json` currently selects the old HTTP compatibility path. It must be changed to `{"transport":"websocket","serverUrl":"<actual verified HTTPS backend origin>"}` and rebuilt after backend deployment. That notation is documentation, not a deployable hostname. No API keys are needed. The release tool `scripts/configure-realtime.mjs` checks health, origin acceptance, WebSocket connection, room creation and cleanup before writing an actual URL. Selected WebSocket transport never silently falls back to the laggy Function transport when the backend fails.

Both hosts serve the configuration without browser caching. Update the allowed origins if the Netlify domain changes. No external database or manual environment variable setup is required. The developer can finish configuration and packaging once the hosting account has created the service and supplied its real URL.

The [Deploy to Render link](https://render.com/deploy?repo=https://github.com/SahilSinhaDev-cpu/Neon_Breach) presents the blueprint for review in the user's account. [Render free services](https://render.com/docs/free/) idle-sleep after 15 minutes without inbound traffic and can take about a minute to wake. It is suitable for a free test; an always-on production service needs a separately selected paid instance. The blueprint does not authorize charges, create a database, or fabricate a public URL.

Public backend deployment and a public two-client game remain unverified until that account step and the Netlify switch happen. Local tests cannot establish hosted latency or phone performance.
