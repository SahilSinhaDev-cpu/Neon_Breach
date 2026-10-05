# Bug sweep — 5 October 2026

Scope: defects and regression evidence only. No new gameplay feature, weapon, map, mode or visual redesign. This report concerns the local production build, not a new public deployment.

## Reproduced defects and fixes

**Major — Match/Pause: pending dash retries escaped a local pause.** Press Dash, lose the first WebSocket packet or reject its HTTP poll, then open Pause before acknowledgement. Both transport implementations retained a pending dash and changed a later neutral input back to `dash: true`. The server correctly honored that fresh packet; the reproduced WebSocket case moved six meters while paused. The other client saw that server-owned movement.

The transports now consult the same control permission used by input sampling. Inactive controls cancel the pending dash and send neutral movement/fire/dash, which stops the old held input. Released pointer lock, hidden tabs and local menus use this same path. Server speed, dash distance, collisions, cooldowns, damage and match clocks are unchanged. Tests cover both transports; the browser regression drops the first actual Dash packet and opens the actual Pause handler before the retry.

**Minor — Server: missing rejection diagnostics.** Two actual Socket.IO clients sent rapid shots and a malformed Leave request. The rules rejected them but the server printed no rejection line. Shot and Leave failures now log a bounded diagnostic with room/operator identifiers and the reason, without seat tokens or packet contents. Matching failures are collapsed to one line per operator/reason per second, with a bounded process-local cache. Internal held-fire simulation ticks are not logged. A live Socket.IO verification accepted the first shot, rejected the malformed Leave, and produced exactly two lines for a 20-packet fire burst plus that Leave.

No blocker was reproduced in the inspected baseline. Unreproduced suspicions did not receive speculative product changes. Browser-harness corrections addressed input sequence races and waiting for a shooter's respawn; they did not alter production rules or award test scores.

## Verification

- Baseline: 152 automated tests passed.
- Fixed build: 155 automated tests passed; TypeScript, frontend/server build and standard Function ZIP packaging passed.
- WebSocket menus and exact packaged Function with the strong-consistency Blobs emulator: 13 acceptance groups each, including actual peer movement/damage, local pause, personal returns, host transfer, refreshed seats, quit, replay and injected request/socket failures.
- Chrome touch emulation: seven checks passed for narrow layout, movement, aim, firing, dash collision, confirmed exit and solo practice.
- The combat harness uses two independent muted Chrome contexts and the compiled production server. It controls only server-side poses for repeatable exposed/covered combat. Scores, elimination target, respawn/protection deadlines and match clock remain unchanged. There is no public test or cheat endpoint.

Combat outcomes and exact elapsed times are recorded in `artifacts/bug-sweep/combat-report.json`. Navigation and touch evidence are in `artifacts/menu/` and `artifacts/realtime/touch-report.json`.

| # | Requested regression | Result and evidence |
| --- | --- | --- |
| 1 | Create A, join B using the code | PASS — independent browser seats, double-click Create ignored. |
| 2 | Host-only Start with both connected | PASS — disabled with one; non-host UI hidden; server integration rejects unauthorized starts and duplicate starts. |
| 3 | Both move/see peers; cover collision | PASS — authoritative pillar stop agrees across clients; captured match shows the other operator. |
| 4 | Exposed hit, pillar blocks shots | PASS — real covered firing leaves health 100; exposed firing changes health. |
| 5 | Three hits, downed fire lock, 5 s respawn, 1 s protection | PASS — browser observes actual life-cycle deadlines; exact boundary behavior also has server tests. |
| 6 | Fire/dash spam cannot bypass cooldowns | PASS — actual injected input bursts; forged positions/damage/scores cannot grant authority. |
| 7 | Reachable cell, 4 s phase, holder hittable | PASS — natural 20-second spawn, movement pickup, real damage while phased, expiration. |
| 8 | A pauses while B moves/shoots; clock continues | PASS — browser checks and menu damage/respawn/Phase timing checks. |
| 9 | Resume preserves life and position | PASS — no reset; dropped pending dash is canceled. Incoming damage still applies normally. |
| 10 | Personal lobby return, other player remains/wins | PASS — menu tests verify both two-player win and three-player continuation. |
| 11 | Quit to Landing, no ghost seat | PASS — confirmed quit removes the seat server-side. |
| 12 | Host leaves lobby; new host can start | PASS — remaining host stays disabled while alone; second browser rejoins and enables Start. The two-human minimum remains enforced. |
| 13 | Lobby refresh has no duplicate player | PASS — same identity/token, same seat count. |
| 14 | Kill one socket without server crash | PASS — other client receives the remaining-player result; disconnected player has an explicit escape. |
| 15 | Ten eliminations and timeout declare correct winners | PASS — genuine ten-kill match and separate unmodified 180-second tied-score timeout; both browsers agree. |
| 16 | Play Again resets score, health and cell | PASS — clean shared lobby, no automatic start. |
| 17 | Released-pointer, muted and narrow touch buttons | PASS — muted desktop match, pointer resume, touch Menu/confirmation layout and touch gameplay. |

## Limits

Two browser clients actually ran; this was not two physical devices or two human testers. Public deployment, real internet latency and physical-phone performance remain **not verified**. The existing lack of server-side rewind and single-process room persistence are unchanged. The Netlify site's existing HTTP performance limitation still requires its planned persistent backend switch; these fixes do not claim to solve cloud latency.

All fixes above address reproduced failures. No unresolved reproduced blocker or major is being hidden as a cosmetic change. Test instrumentation exists only in test files and the local fixture, outside the production client and public request handlers.
