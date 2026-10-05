export type MenuRoot = 'landing' | 'lobby' | 'match' | 'end';
export type MenuPanel = MenuRoot | 'join' | 'how-to-play' | 'paused' | 'settings' | 'confirm';
const overlays = new Set<MenuPanel>(['paused', 'settings', 'how-to-play', 'confirm']);

// Navigation history contains panels, never room actions. Server snapshots
// update the root underneath an open menu; Back is always one local step.
export class MenuState {
  root: MenuRoot = 'landing';
  panel: MenuPanel = 'landing';
  private history: MenuPanel[] = [];
  constructor(private changed: () => void = () => {}) {}
  get canBack() { return this.history.length > 0; }
  get blocksMatch() { return this.panel !== 'match'; }
  sync(root: MenuRoot) {
    if (root === this.root) return;
    const previous = this.root; this.root = root;
    this.history = this.history.map(panel => panel === previous ? root : panel);
    if (!overlays.has(this.panel)) { this.panel = root; this.history = []; }
    this.changed();
  }
  open(panel: MenuPanel) {
    if (panel === this.panel) return;
    this.history.push(this.panel); this.panel = panel; this.changed();
  }
  back() {
    const panel = this.history.pop();
    if (panel) { this.panel = panel; this.changed(); }
  }
  pause() { if (this.root === 'match' && this.panel === 'match') this.open('paused'); }
  resume() { this.panel = this.root; this.history = []; this.changed(); }
  reset(root: MenuRoot) { this.root = root; this.panel = root; this.history = []; this.changed(); }
}
