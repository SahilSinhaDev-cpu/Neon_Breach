# Netlify recovery update — 3 October 2026

Release: **2026-10-03-recovery-2**. The live site already contained the previous update (`index-CmmnM_3A.js`). This is a new correction, not a request to upload the same build again.

Two independent test seats reproduced **four HTTP 503 storage errors in 107 live polls** at https://neonbreach977.netlify.app. Most round trips were about 410–550 ms; the failures took 433–502 ms. Both seats explicitly left afterward. The backend's underlying storage status was not exposed by that release, so its exact upstream cause is not established. The probe found no backwards server snapshots. See `artifacts/netlify/live-recheck.json`.

The client treated one transient response as a full disconnect and discarded held controls. Its lobby recovery also discarded the saved seat token after a single failed recovery request. Those behaviors amplified brief storage failures into stopped movement and lost recovery.

This release corrects them:

- Retry transient storage reads and conditional writes up to three attempts within the existing four-second invocation budget. Preserve the exact conditional header, honor provider retry delays, and never acknowledge a failed write.
- Keep controls through brief errors and show UPLINK RETRYING. After 2.2 seconds without a successful response, suspend input and show the reconnect overlay. Physical key/touch release, blur and pointer unlock still clear controls. Held movement resumes when the same seat reconnects; one-shot dash is canceled.
- Adapt the server input allowance to bridge two missed HTTP samples, still capped at two seconds with unchanged speed/collision/combat rules.
- Keep the saved lobby seat during retryable failures; retry recovery without creating a duplicate operator. Distinguish a disconnected seat from a lease replaced by another tab. The latter is not automatically reclaimed.
- Cancel pending recovery when Return home is clicked. A successful late acknowledgement releases that late seat without restoring the old screen.
- Keep the HUD clock monotonic across changing response delays and reset it for a new contract. This is a display correction; scoring/cooldowns still use server time.
- Add the release header `X-Neon-Release` and safe numeric `X-Neon-Storage-Status` on upstream storage failures, plus structured status/timeout logging. No credentials or storage URLs are exposed.

The previous update's fixes remain: bounded latency-aware collision prediction, monotonic authority time across CAS retries, checked persistence with ETags, action deduplication, and a shared async context tracker for warm function invocations.

Current evidence is recorded in [the verification report](NETLIFY-TEST-REPORT.md) and `artifacts/netlify`. Tests use temporary servers that close afterward; no local preview is left running.

## Apply the update

This new release has not been deployed: no authenticated access to the existing project's Netlify deployment controls is available here. Extract the regenerated `netlify-ready-game.zip`, sign in to the **existing neonbreach977 project**, and drop the complete extracted folder under **Production deploys**. Keep the root `netlify.toml`, manifests and `netlify` source directory together. Wait for publication, reload the game, and run the README's two-device checklist. The new frontend asset is `index-B5Ms2gNK.js`; the function's release header is `2026-10-03-recovery-2`.

Signed-in source-project builds and updates through the production drop zone are described in [Netlify’s Drop documentation](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/). No GitHub, terminal commands, user-defined environment variables, API keys or manual database setup are required.

HTTP functions and a single conditional-write room blob still add latency. Sustained platform failures cannot be eliminated by client retries. Input gaps over two seconds can pause movement; an eight-second heartbeat expiry still removes an active player and active-match rejoining remains disabled. No server-side shot rewind is added. The new build has been tested with injected failures, but elimination of the live cloud errors cannot be claimed before deployment and another live check.
