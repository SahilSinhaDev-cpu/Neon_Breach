# Live Netlify latency diagnosis — 3 October 2026

The live site was running release `2026-10-03-recovery-2` with frontend asset `index-B5Ms2gNK.js`. The latest recovery update was deployed; the reported lag was reproduced on that release.

Two isolated API seats in each environment created a room, joined, started and made 50 concurrent active polls with validated movement. Both seats explicitly left. The local game server remains running at the user's request. These measurements were taken from this machine; they measure network/function responses, not render frame rate or two humans on physical devices.

| Environment | Median | 95th percentile | Maximum | Errors |
| --- | --- | --- | --- | --- |
| Local function + filesystem Blobs emulator | 13 ms | 24 ms | 27 ms | 0 / 50 |
| Live Netlify function + hosted Blobs | 525 ms | 852 ms | 2,155 ms | 11 / 50 |

Evidence: `artifacts/netlify/latency-comparison-live.json`. All eleven errors were public HTTP 503 responses with `X-Neon-Storage-Status: 409`. The underlying storage operation was not logged by the previous release; concurrent conditional writes are the likely source. Release `2026-10-03-conflicts-3` handles conditional PUT 409 as an uncommitted conflict, causing a fresh read and full action recomputation. It does not convert read or unconditional-write 409 into success. New unit/integration tests verify the behavior and preservation of a concurrent committed update. The change is not yet verified on the live cloud endpoint.

The ordinary half-second response time remains a separate bottleneck. Each active poll invokes a function, reads the entire room strongly, advances simulation and conditionally writes the room. Competing updates to the same room can require another read/write. The client waits for a response before sampling its next input. At these measured response times, each browser receives roughly two authoritative replies per second, instead of the intended ~20 snapshots per second. Client prediction can soften visual movement; it cannot deliver an authoritative shot result sooner.

Local requests stay on this computer and use local filesystem storage. They do not include internet transport, hosted function execution or remote Blobs operations. The local three-round tests establish game rules and request behavior; they do not establish hosted responsiveness.

Netlify documents [Blobs as optimized for frequent reads and infrequent writes](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) and says [strong consistency has slower reads](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#consistency). Continuously replacing a shared match blob is therefore a poor fit for a latency-sensitive shooter. This is an engineering conclusion from the code and measurements, not a claim that Netlify guarantees a particular latency.

The proposed route to responsive online play is to keep the static frontend on Netlify and run live rooms on a persistent Node/WebSocket game server near the players, with in-memory simulation and regular pushed snapshots. Persistence can be used for occasional state rather than every input. This requires relaxing the user's earlier Functions/Blobs-only backend requirement and access to a suitable backend host. The user approved this change. Release `2026-10-03-realtime-1` implements the persistent server and stages the frontend switch; deployment still requires a backend hosting account and its actual URL. See [the real-time architecture](REALTIME.md). A persistent server still requires real network and load testing; no latency guarantee is made here.
