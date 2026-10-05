# Visor menus and room navigation

The menu state machine in `client/menu-state.ts` owns Landing, Join, How to Play, Lobby, Match, Paused, Settings, Confirm and End. History contains local panels, never room commands. Server snapshots determine the underlying screen while an overlay stays open. Back moves one panel; it cannot change membership, start or end a match.

## Buttons

| Screen | Buttons | Behavior |
| --- | --- | --- |
| Landing | Create Room, Join Room, Play Solo, How to Play, Settings | Create/Join/Solo request a room after the existing session intro. Join opens a code panel. No Back is shown on the first screen. |
| Join | Join Room, Back | Join submits the code; Back restores Landing without sending a room command. |
| Lobby | Copy Code, Start Match, Settings, How to Play, Leave Room | Start is host-only with a visible reason below the human minimum; solo preserves its one-human minimum. Leave requires confirmation. A waiting host sees Play Again once the shared match ends. |
| Match | Menu, Click to resume, Enable Audio | Menu opens the local pause overlay; the pointer-lock fallback resumes aiming after a gesture. Audio retains its browser gesture gate. |
| Pause | Resume, Settings, Return to Lobby, Quit Match | Resume restores the current authoritative screen; it opens the end card if the match ended. Return and Quit require confirmation. |
| End card | Play Again, Return to Lobby, Settings, Leave Room | Play Again is host-only and resets everyone still connected to the same lobby without starting another match. Return keeps a personal room seat. Leave removes it. |
| Settings | Back, Mute toggle, touch-control toggle | All five audio sliders and aim sensitivity apply immediately and persist locally. Back restores the caller, including Pause. |
| How to Play | Back | Restores Landing or Lobby, whichever opened it. |
| Confirmation | Cancel, Return to Lobby / Quit Match / Leave Room / Return to Landing | Cancel has initial focus. Touch buttons stack with Cancel above the action, including landscape. |
| Request error | Back; Reconnect and Return to Landing when offline | A readable response leaves the actual seat intact; Back restores the caller. |
| Connection lost | Reconnect, Return to Landing | Reconnect retries the transport; Return to Landing requires confirmation and provides an escape from an unreachable server. |

Esc opens Pause, releases pointer lock, and clears held input. Esc again or Resume closes it. Esc in callsign/code fields only clears typing focus. Native dialogs support Tab and Enter with visible focus; confirming a destructive action requires choosing its button. The touch Menu target is at least 44 pixels tall and is separated from aiming, Fire and Dash.

## Server behavior

`return-lobby` marks only that connected human as `inLobby`. The seat, identity and room remain. The participant is excluded from movement, shooting, damage, spawn selection, Phase Cell pickups and the winner calculation. Their exit never awards an elimination. The host transfers to the next connected active human during a live match. Two remaining humans continue; one wins; no active humans ends the contract without a human winner. Waiting room members do not count as active opponents. Solo retains its existing bot rules.

Quit Match and Leave Room send `leave`. The server removes that seat entirely, transfers the host, and applies the same last-active-human rule. Other members stay in the room. Empty-room cleanup uses the existing expiry, never deletes a room containing a waiting human. Lobby refresh can recover a personal waiting seat even while other members are playing; it cannot rejoin a disconnected active operator. Waiting seats send snapshot/heartbeat polls without movement input; this also prevents a refreshed lobby camera with life ID 0 from blocking Function snapshots.

Room commands wait for acknowledgement. Return, Quit and Leave remain disabled for at least one second and until their response; repeated clicks do not issue another command. Failed commands preserve membership. Request IDs and the existing Socket.IO cache / conditional Blobs writes keep retries idempotent. Start and replay remain validated by the server. Immutable final scores retain the correct winner name and scores even if that winner subsequently leaves; replay clears them.

An unreachable server cannot acknowledge an exit. The explicit offline escape first attempts `leave`, then closes the transport if it fails and returns to Landing. The server applies its normal disconnect rule: immediate detected socket loss, or the Function transport's heartbeat expiry. The UI describes that fallback. It does not pretend a timeout is a successful acknowledgement.

Pausing and Settings block local input only. Rendering, incoming damage, respawns, the timer, Phase Cell timing and other players continue. The five-second respawn countdown is visible behind the menu and repeated within it. No combat values, cooldowns or match deadlines are changed by Resume or Back.

## Release pairing and verification

The real-time protocol is version **2** (`2026-10-05-navigation-1`). Deploy frontend and backend together because waiting-seat visibility and navigation actions require both sides. The retained Function uses the same shared game rules. Helpers stay outside `netlify/functions` and clients still use `/.netlify/functions/game` directly in HTTP mode.

`npm test` passed **152/152** checks for menu history, host transfer, personal lobby recovery, failed leave acknowledgements, idempotent Function actions, immutable results and the existing gameplay/transport suites. `npm run build` checks TypeScript and builds the frontend, persistent server and standard Function ZIP.

`npm run test:menus` uses independent Chrome contexts with the compiled persistent server. `npm run test:menus-http` runs the exact packaged `dist/functions/game.zip` with the strongly consistent Netlify SDK Blobs emulator. The harness tests two-client movement and three-hit scoring while the opponent is paused, actual five-second respawn and 20-second Phase Cell spawn, personal returns, three-player host transfer, refresh recovery, replay, quit, clipboard fallback, failed requests and offline escape. A third context emulates touch controls in landscape. Reports and screenshots are in `artifacts/menu/`.

These checks are local browser automation, not physical phones, two human testers, or proof of a public deployment. Hosted latency is not addressed by menus; the persistent backend deployment described in the README is still required for the planned Netlify transport switch.

The acceptance run also exposed and fixed a Function-only recovery fault: a refreshed waiting seat could send life-0 input, causing repeated 400 responses and a stale lobby view. The transport now keeps its heartbeat and snapshot polls separate from match input for waiting seats. The browser check waits for each client's shared replay snapshot, rather than treating an already-visible personal lobby as replay confirmation.
