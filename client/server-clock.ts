import type { Snapshot } from '../shared/protocol';
import { predictionLead } from './network-motion';

// Snapshot arrival times vary with cloud storage. The HUD can pause briefly
// while an older estimate catches up, but must never count backwards.
export class ServerClock {
  private key = '';
  private anchor = 0;
  private receivedAt = 0;
  private lastServer = -Infinity;
  private lastReturned = 0;
  reset() { this.key = ''; this.anchor = 0; this.lastServer = -Infinity; this.lastReturned = 0; }
  observe(snapshot: Snapshot, roundTrip: number, at = performance.now()) {
    const key = `${snapshot.code}:${snapshot.match}`;
    if (key !== this.key) { this.reset(); this.key = key; }
    if (snapshot.now < this.lastServer) return;
    this.lastServer = snapshot.now;
    this.anchor = snapshot.now + predictionLead(roundTrip);
    this.receivedAt = at;
  }
  now(at = performance.now()) {
    if (!this.key) return 0;
    this.lastReturned = Math.max(this.lastReturned, this.anchor + Math.max(0, at - this.receivedAt));
    return this.lastReturned;
  }
}
