# Netlify recovery update — verification

Release **2026-10-03-conflicts-3**, tested on **3 October 2026**. The live site now runs recovery-2. A new comparison measured 13 ms median locally versus 525 ms on Netlify and eleven upstream 409 responses in 50 live polls. This conflict-handling release is not yet verified on the live endpoint. See [the latency diagnosis](NETLIFY-LATENCY.md).

## Results

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Existing live deployment | BUG REPRODUCED | Four HTTP 503 storage errors in 107 live polls from two isolated seats; both left afterward. `live-recheck.json` |
| TypeScript and production build | PASS | Vite frontend and one officially packaged standard function |
| Automated tests | PASS: 122, zero failures | Game rules, solo, art/audio/music, strong/CAS persistence, conditional retries, monotonic clocks, input leases, recovery classification/cancellation, hung requests and Retry-After control timeout |
| Final packaged recovery browser | PASS: 5 checks | Two independent Chrome contexts; production frontend, extracted function module, 400 ms simulated RTT, injected 503s and delayed recovery acknowledgements |
| Full contracts and replay | PASS: 14 checks | Three real 180-second matches; matching scores/winners, tied-score resolution and clean replay |
| Delayed-network browser | PASS: 4 checks | 500 ms simulated RTT, authoritative movement, slow/offline leave and replaced-seat overlay |
| Touch/solo browser | PASS: 7 checks | Touch movement/aim/fire/dash, disconnect winner and persistent labeled bots |
| Clean source ZIP install/build | PASS | Lockfile install, source build and exact reproduction of final frontend/function module |
| Updated cloud deployment | NOT VERIFIED | Requires upload to the existing project's Production deploys drop zone |
| Two humans on physical devices | NOT VERIFIED | Automated independent browsers and touch emulation only |

Current reports are in `artifacts/netlify`. Temporary servers and browsers close after testing; no persistent local preview is started.

## Live reproduction and targeted fixes

The live HTML referenced the previous release's `index-CmmnM_3A.js`. This was not a missing upload. Most live polls took about 410–550 ms; the four 503 failures took 433–502 ms. No backwards server snapshots were observed. The earlier release hid the underlying storage status, so its precise upstream cause is unknown without new diagnostics or function logs.

A transient failure previously cleared held movement, and a failed lobby-recovery request removed the saved seat token. Tests now verify:

- Two failed refresh-recovery requests retain the token and recover the same player ID without duplicates.
- A lobby heartbeat expiry transfers host and recovers the original seat when requests resume. It is distinguished from a lease replaced by another tab.
- One held W press continues across two failed polls at about 400 ms RTT, with authoritative travel within the unchanged 6 m/s limit.
- A sustained interruption shows the reconnect overlay; held movement resumes when the same seat reconnects, without pressing W again.
- Return home during a delayed successful recovery cancels entry and releases the late seat.
- A ten-second Retry-After delay preserves provider backoff while still suspending controls after the 2.2-second recovery grace. A pending fetch cannot postpone suspension until its six-second network timeout.

Storage tests verify bounded transient retries, unchanged strong-read/conditional-write headers, expected 412 conflicts, uncertain-write acknowledgements, nonretryable failures, provider retry delays, four-second deadline, and concurrent error isolation. Failed writes cannot be acknowledged as saved state. HUD-clock tests verify that variable response arrival times do not make time run backward; server-clock CAS and heartbeat chronology tests remain in place.

## Three full contracts

The user chose three existing matches with replay, preserving each contract's independent winner.

| Contract | Actual elapsed | VEX | NYX | Winner |
| --- | --- | --- | --- | --- |
| 1 | 180.266 s | 1 | 0 | QAVEX |
| 2 | 180.803 s | 0 | 1 | QANYX |
| 3 | 180.046 s | 1 | 1 | QANYX, earlier tied score |

Both clients displayed matching scores and winners. Each replay returned both to a lobby with zero scores and 100 health. The browsers made 6,689 and 6,688 function requests with no WebSockets or page errors. Controls produced authoritative movement and firing; tests checked cover blocking, three-hit elimination, five-second respawn, one-second protection, natural 20-second Phase Cell spawn and four-second effect. Fixtures changed combat poses only, never scores, match duration or winner rules.

The full-contract package differs from the final function in the release identifier, two seat-validation checks and conditional-write 409 handling. `contract-package-comparison.json` records both module hashes and the exact diff. Conditional PUT 409 now reloads/recomputes; integration testing confirms concurrent state survives. The final frontend additionally keeps its timeout active during provider backoff. These follow-up changes are checked by the final packaged recovery browser and automated tests; no combat, movement, scoring or replay rules changed afterward. `package-report.json` verifies the final clean build against the tested recovery artifact.

## Scope and remaining limits

The SDK's local filesystem emulator omits read ETags and lacks atomic condition-check/write locking. The test-only fixture supplies ETags and serializes operations to model the hosted contract. Production does not import that fixture. Tests use the real SDK and extracted Request/Response function module, but do not prove cloud capacity or exercise the final Lambda bootstrap on Netlify.

HTTP functions and a single room blob still add latency. Retries cannot eliminate a sustained service outage. Movement stops when input gaps exceed its two-second maximum allowance; eight-second heartbeat expiry still removes an active player. Active-match recovery remains disabled by the rules. No server-side rewind is implemented.

Empty-room expiry is logical and evaluated on access; expired Blobs objects remain stored. No background server or game timers, custom API route, or manual database setup is introduced. Only `netlify/functions/game.ts` is deployed; the frontend calls `/.netlify/functions/game` directly.

See [the update and upload instructions](NETLIFY-BUGFIX.md). Live resolution must be checked after this new release is uploaded; the current public URL is not evidence that these new changes are deployed.
