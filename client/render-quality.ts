// The UI stays at native CSS resolution; only the arena's drawing buffer changes.
export function initialPixelRatio(density: number, width: number, height: number, touch: boolean) {
  return Math.min(density, touch ? 1 : 1.25, Math.sqrt(1920 * 1080 / Math.max(1, width * height)));
}

export class RenderBudget {
  private since = 0; private frames = 0; private slowWindows = 0;
  private warmUntil: number;
  constructor(start: number) { this.warmUntil = start + 6000; }
  observe(now: number, visible: boolean) {
    if (!visible || now < this.warmUntil) { this.since = 0; this.frames = 0; this.slowWindows = 0; return false; }
    if (!this.since) { this.since = now; this.frames = 0; return false; }
    this.frames++;
    const elapsed = now - this.since;
    if (elapsed < 1000) return false;
    // Isolated shader loads and background pauses do not trigger a drop.
    this.slowWindows = elapsed / this.frames > 20 ? this.slowWindows + 1 : 0;
    this.since = now; this.frames = 0;
    if (this.slowWindows < 2) return false;
    this.slowWindows = 0; return true;
  }
}
