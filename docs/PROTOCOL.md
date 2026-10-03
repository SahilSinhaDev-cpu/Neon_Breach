# NEON BREACH — Netlify function protocol

The frontend calls `/.netlify/functions/game` directly. The one standard Request/Response entry is `netlify/functions/game.ts`; all helpers are outside its directory. No WebSockets, custom route configuration or game redirect are used.

## HTTP messages

GET returns `{ok:true}` as a lightweight function availability check; it does not test storage. POST accepts JSON, up to 8 KiB, same-origin only. Responses are JSON and never cached. Errors contain a plain-text `error` and `ok:false`; callsigns are never inserted as HTML. `X-Neon-Release` identifies the deployed version. Retryable storage failures include `errorCode:'STORAGE_UNAVAILABLE'`, `retryable:true`, and optional `retryAfterMs`. When available, `X-Neon-Storage-Status` reports only the numeric upstream status, never credentials or infrastructure URLs.

| Action | Fields besides `action` | Effect |
| --- | --- | --- |
| `create`, `solo` | `name`, `client`, `requestId` | Create room and a private human seat; solo adds three labeled bots |
| `join` | `name`, `code`, `client`, `requestId`, optional recovery `token` | Join an open lobby or rotate an existing lobby seat lease |
| `poll` | `code`, `token`, `client`, `requestId`, `cursor`, optional `input` | Advance authoritative state and retrieve snapshot/new events |
| `start`, `replay`, `leave` | `code`, `token`, `client`, `requestId`, `cursor` | Host start/replay or explicit seat departure |

A successful create/join returns `{ok,id,token,snapshot,cursor,events}`. Other successful actions return `{ok,snapshot,cursor,events}`. Tokens are 256-bit random secrets; normal snapshots exclude them and all internal authority fields. `client` is a per-load lease ID. A lobby refresh retains the player ID but rotates the lease; the previous lease cannot act. Active-match joining/recovery is disabled. A temporarily interrupted existing lease can resume polling within the heartbeat window.

Inputs are `{seq,life,mx,my,yaw,pitch,fire,dash}`. `seq` increases, `life` matches the server-issued spawn generation, movement components are finite and between −1 and 1, yaw lies within ±2π, pitch within ±1.45. Diagonal movement is normalized. Positive `my` is forward, positive `mx` right; yaw zero faces −Z. Fire is held state and dash is a one-sample action. Clients submit no authoritative positions, health, damage, eliminations, cooldowns or timestamps. Extra fields confer no authority.

The client keeps one request in flight, samples current controls when sending, and never queues stale inputs. Active requests have an 80 ms minimum cycle including the response time; lobby requests a 400 ms cycle. A slow active response starts the next cycle immediately. Effective frequency decreases with function/storage latency. Transient failures within 2.2 seconds of the last successful response show UPLINK RETRYING and preserve held controls. A watchdog then suspends controls and shows an overlay even if fetch has not yet timed out. Key/touch release, blur and pointer unlock continue clearing controls; recovery can resume physically held movement. Dash is never queued across a full interruption.

Lobby recovery keeps its saved token through retryable errors. A poll rejected as `SEAT_DISCONNECTED` triggers recovery only from a lobby; `SEAT_REPLACED` requires Return home and cannot steal a lease from a newer tab. Other invalid/expired seats disable controls. Leaving detaches immediately and invalidates pending room entry; a successful late room acknowledgement triggers leave cleanup instead of reopening its screen. Start/replay retry once with the same action ID after transient failures; room creation is not automatically retried. Dash is latched briefly across conditional-write/rate-limit conflicts until the input is acknowledged.

## Persistence and ordering

`getStore({name:'neon-breach-rooms-v1',consistency:'strong'})` is created inside the function. Netlify provides the runtime storage context automatically. Each room is stored at `rooms/CODE`. Creation uses `onlyIfNew:true`; collisions regenerate codes. Every mutation reads with `getWithMetadata(...,{type:'json',consistency:'strong'})`, requires a nonempty ETag, reconstructs the authority, and writes with `onlyIfMatch:etag`. A unique revision prevents identical-content ETag reuse. Rejected conditional writes discard the attempted result, reload, and recompute with bounded retries. Nothing is acknowledged before a successful save with a nonempty write ETag. A checked transport rejects storage HTTP errors before the SDK can report a false conditional-write success, and bounds total storage I/O to four seconds per invocation. The server clock is resampled after each strong read/CAS retry and cannot precede persisted time. Elapsed clocks, heartbeat expiry and simulation changes are persisted even when a rule/rate validation rejects the action.

Positions, accepted input/aim, health, scores, match phase/clock, host, respawns/protection, dash, Phase Cell, bot brains, human heartbeat deadlines and bounded event history are persisted in one room object. Separate independent score/counter writes and multi-key game transactions are not used. Netlify Blobs is not a transactional relational database; hosted service latency/concurrency must still be verified on deployment.

The checked storage transport retries reads and conditional PUTs at most three total attempts for network errors or HTTP 408/429/500/502/503/504. All attempts retain the same condition and share the four-second budget. Provider Retry-After is honored; delays beyond the remaining budget are surfaced to the client. A 412 remains a conflict for authority recomputation. A write with an uncertain acknowledgement followed by 412 is never counted as confirmed success. Nonretryable errors fail immediately; the SDK's own long retry loop is suppressed.

Room creation/join attempts use a conditional-write token bucket per hashed source address: 12 attempts burst and 0.5 per second refill. Authenticated room actions have a 200 ms minimum interval; polls a 40 ms minimum interval. Accepted input still obeys spawn generation, increasing sequence, 280 ms server firing cooldown and three-second dash cooldown. Identical non-poll action IDs are retained for 30 seconds and cannot start/replay/leave twice. Client input timestamps are never used.

## Simulation and rendering

The function advances stored simulation time in 1/60-second steps on each request; there is no continuously running interval or server process. Human input becomes stale after a server-owned allowance of 350–2,000 ms. Only successfully accepted inputs train a bounded moving average of their arrival intervals; clients cannot send or override that allowance. Respawns reset the active allowance; accepted inputs retrain it. New matches restart the arrival history. This prevents the former 350 ms watchdog from repeatedly stopping movement on 500–900 ms HTTP connections, while still stopping stale input within two seconds. Every step checks heartbeat expiry before combat. Very long idle gaps use bounded catch-up after disconnecting stale humans. All match, protection, respawn and Phase Cell deadlines use server time. The first tick at/after a respawn deadline reconstructs the operator; its protection lasts exactly one second from that spawn tick.

Y is up, ground Y=0, eye height 1.6 m; X/Z arena boundaries are ±20 m. Shared geometry/collision functions keep walls, pillars and cover consistent. Movement substeps prevent tunneling. Dash stops at the first blocker. Hitscan casts from the server-known eye position along accepted aim, with cover winning distance ties. Down/disconnected players are ineligible. Protected players block rays but receive no damage and cannot shoot. Rendering and original 200 m/s pulse VFX remain visual representations of instant hitscan damage.

Remote snapshots interpolate about 100 ms behind receipt with a bounded half-RTT prediction lead of at most 350 ms; local movement predicts and corrects using shared collisions. Remote extrapolation is capped at 350 ms and respects collision geometry. Dash, respawn, disconnect and implausible movement reset interpolation history. No server-side rewind or lag compensation exists. The transport cannot guarantee the earlier WebSocket snapshot rate; cold starts/storage RTT affect aim and feedback latency.

Events are `{seq,event}`, where event is shot, kill, cell or respawn from `shared/protocol.ts`. Each room retains the last 128 entries. Clients advance a cursor and play each event at most once. HUD/score/winner decisions use the snapshot, so missed effects never corrupt gameplay.

The HUD anchors server time to monotonic browser elapsed time with a bounded latency estimate. Later arrivals cannot decrease the displayed time estimate; it may pause briefly while an older estimate catches up. The display clock resets for a new room/contract and on leave. This clock never determines authoritative scores or cooldowns.

## Lifecycle and winner

Explicit leave transfers host and evaluates the last-connected win immediately. Silent disconnect is detected after eight seconds without a successful poll, on the next room invocation. Active-match refresh is a new lease and cannot rejoin. Lobby disconnected reservations last 30 seconds. Empty rooms expire logically after 30 seconds; a room inactive for 15 minutes expires on access. Blobs has no automatic TTL; expired objects are retained in storage. No background job or manual database provisioning is required.

First to ten wins immediately. Otherwise, at 180 seconds the highest connected score wins, then earlier achievement of that score, then earlier join order; all-zero ties use join order. The function writes the winner; clients display its ID. The host can replay after an end, removing disconnected seats and resetting all match state. Each replay is an independent contract, not an aggregate series.

Solo is private: one human and three labeled server-driven bots, sharing the rules and geometry. Serialized bot brains preserve reactions/navigation across calls. Bots cannot host; an abandoned solo match ends and cannot stay alive through bot updates alone.
