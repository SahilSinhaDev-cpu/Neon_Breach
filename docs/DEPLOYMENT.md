# Backend release preparation — 5 October 2026

The original requested frontend was `https://neonbreach977.vercel.app/`. An HTTP check returned Vercel `404 NOT_FOUND` before any game code loaded. The current source builds to `dist/client`; root `vercel.json` explicitly selects that output directory, Vite, and the production build. The actual dashboard settings and deployment files remain uninspected without Vercel account access, so the output-directory diagnosis is an inference, not a confirmed dashboard finding.

The subsequently published frontend is `https://neonbreach977-d7ii.vercel.app/`. Its public `game-config.json` returned HTTP 200 with `{"transport":"http","serverUrl":null}`. Its `/.netlify/functions/game` and `/healthz` both returned HTTP 404. The game assets load, but this deployment has no configured persistent backend and cannot use the Netlify-only Function. Its displayed connection failure is therefore expected until the backend is deployed and the frontend configuration is switched to the verified HTTPS server origin.

## Backend to deploy

`render.yaml` defines one free Node service in Singapore, one instance, production build/start commands and `/healthz`. `.node-version` pins the tested Node 22.20.0 runtime. No database or user-defined environment variables are necessary. The process keeps authoritative rooms in memory; multiple instances would split rooms, and redeploys/restarts end current matches.

The server accepts `https://neonbreach977-d7ii.vercel.app`, the original `https://neonbreach977.vercel.app`, `https://neonbreach977.netlify.app`, and its own origin. It does not allow arbitrary Vercel preview domains. Unrelated origins remain rejected. The backend also serves the complete frontend directly, selecting same-origin WebSockets automatically. The release smoke test uses the new active Vercel origin and the Netlify origin.

## Account action still required

GitHub access is available. Render has not been connected to this session, and Vercel CLI has no saved credentials. No hosted backend URL has been assigned or verified, and no new production deployment has been claimed.

The prepared [Render deployment link](https://render.com/deploy?repo=https://github.com/SahilSinhaDev-cpu/Neon_Breach) opens the existing repository's blueprint. Alternatively, connect the Render integration so the developer can inspect existing services before creating or deploying the single free service. No paid plan is selected. Render free services idle-sleep; this is not an always-on production guarantee. See [Render's free-service limits](https://render.com/docs/free/).

Once the service is live, the developer runs `node scripts/configure-realtime.mjs` with its actual HTTPS origin. It first verifies the exact release health response, WebSocket connections from both production frontend origins, two separate human seats in one room, host start, server-authoritative movement observed by the peer, last-connected-player victory, replay reset, and explicit cleanup. Only then does it atomically update `public/game-config.json` to that real backend origin. It does not insert a guessed or placeholder hostname.

The developer then rebuilds and redeploys the Vercel frontend and checks the public page and a two-browser match. The retained Netlify HTTP config is unchanged until a real backend passes the check; publishing the frontend configuration alone does not make the server exist.

## Verification scope

Preparation checks use temporary automated localhost processes, which shut down at completion. They do not start a persistent local development server and do not prove a hosted deployment. `scripts/verify-backend.mjs` uses ordinary client packets without private poses, clocks, scores or health overrides. Its smoke test is narrower than a complete 180-second two-browser match.

The production-artifact check imports the shared protocol version instead of its obsolete literal `1`, connects with the Vercel Origin header, and checks the compiled Node entry and the packaged compatibility function. Final preparation results are recorded by the developer below; hosted acceptance remains pending account access.

### Preparation results

- Production TypeScript/Vite/server/function build: passed. Vite reported its existing Three.js vendor-size advisory, with no build failure.
- Gameplay, solo and real-time client tests: 40 passed, 0 failed.
- Real-time integration tests, including a room shared by the Vercel and Netlify origins: 5 passed, 0 failed. Unrelated origins and invalid protocols remained rejected.
- Exact compiled production server: health, frontend serving, two-client room, authoritative movement, disconnect winner and replay passed.
- Exact packaged Netlify compatibility function: load, create/join/start, winner, replay and cleanup passed.
- New backend release smoke test against a temporary compiled process: passed all five checks. This was localhost QA, not hosted Render acceptance.
- Test processes were closed; no local development server was left running.

Hosted deployment, the assigned backend HTTPS URL, Vercel frontend recovery and a public two-browser match are **not verified** until hosting account access is available.
