// Count presented animation frames over a half-second window. DOM writes happen
// twice a second, and a hidden tab never contributes a misleading low sample.
export class FpsCounter {
  private since = 0; private frames = 0; private last = 0;
  constructor(private output: HTMLElement) {}
  frame(now: number, visible = true) {
    if (!visible) { this.since = this.last = 0; this.frames = 0; return; }
    if (!this.last || now - this.last > 1000) { this.since = this.last = now; this.frames = 0; return; }
    this.last = now; this.frames++;
    const elapsed = now - this.since;
    if (elapsed < 500) return;
    const value = `${Math.round(this.frames * 1000 / elapsed)} FPS`;
    if (this.output.textContent !== value) this.output.textContent = value;
    this.since = now; this.frames = 0;
  }
}
