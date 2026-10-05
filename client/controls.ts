import { clamp } from '../shared/world';
import type { Input } from '../shared/protocol';
export class Controls {
  yaw = 0; pitch = 0; fire = false; dash = false; active = false; life = 0;
  touch = matchMedia('(pointer: coarse)').matches;
  sensitivity = Number(localStorage.getItem('nb-sensitivity') || 1);
  keys = new Set<string>(); stick = { x: 0, y: 0 };
  onChange = () => {}; onGesture = () => {};
  constructor(public canvas: HTMLCanvasElement) {
    this.sensitivity = clamp(Number.isFinite(this.sensitivity) ? this.sensitivity : 1, 0.25, 2.5);
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.clear(); this.onChange(); });
    document.addEventListener('mousemove', e => { if (this.active && document.pointerLockElement === canvas) this.aim(e.movementX, e.movementY); });
    document.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).matches('input,button')) return;
      // Track physically held movement during a temporary connection pause.
      // sample() still blocks every action until controls are active again.
      const movementKey = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
      if (!this.active) {
        if (movementKey && document.pointerLockElement === canvas) { this.keys.add(e.code); e.preventDefault(); }
        return;
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.touch && document.pointerLockElement !== canvas) return;
      this.keys.add(e.code); if (e.code.startsWith('Shift') && !e.repeat) this.dash = true;
    });
    document.addEventListener('keyup', e => this.keys.delete(e.code));
    document.addEventListener('mousedown', e => { if (this.active && e.button === 0 && document.pointerLockElement === canvas) this.fire = true; });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.fire = false; });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  suspend() { this.active = false; this.dash = false; }
  clear() { this.keys.clear(); this.fire = false; this.dash = false; this.stick = { x: 0, y: 0 }; document.querySelector('#fire')?.classList.remove('pressed'); document.querySelector<HTMLElement>('#stick-thumb')?.style.setProperty('transform', 'translate(0px,0px)'); }
  aim(dx: number, dy: number) { this.yaw = ((this.yaw - dx * 0.002 * this.sensitivity + Math.PI * 3) % (Math.PI * 2)) - Math.PI; this.pitch = clamp(this.pitch - dy * 0.002 * this.sensitivity, -1.45, 1.45); }
  async lock() { this.onGesture(); this.canvas.tabIndex = 0; this.canvas.focus(); if (!this.touch) { try { await this.canvas.requestPointerLock(); } catch { this.onChange(); } } }
  canAct() { return this.active && (this.touch || document.pointerLockElement === this.canvas) && !document.hidden; }
  sample(seq: number): Input {
    const allowed = this.canAct();
    const input = { seq, mx: allowed ? clamp((+this.keys.has('KeyD') || +this.keys.has('ArrowRight')) - (+this.keys.has('KeyA') || +this.keys.has('ArrowLeft')) + this.stick.x, -1, 1) : 0, my: allowed ? clamp((+this.keys.has('KeyW') || +this.keys.has('ArrowUp')) - (+this.keys.has('KeyS') || +this.keys.has('ArrowDown')) - this.stick.y, -1, 1) : 0, yaw: this.yaw, pitch: this.pitch, fire: allowed && this.fire, dash: allowed && this.dash };
    return { ...input, life: this.life };
  }
  bindTouch() {
    const stick = document.querySelector<HTMLElement>('#stick')!, thumb = document.querySelector<HTMLElement>('#stick-thumb')!;
    let stickId: number | null = null, aimId: number | null = null, last = { x: 0, y: 0 };
    const update = (e: PointerEvent) => { const r = stick.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2; const max = r.width * 0.34, scale = Math.max(1, Math.hypot(dx, dy) / max); this.stick = { x: dx / scale / max, y: dy / scale / max }; thumb.style.transform = `translate(${dx / scale}px,${dy / scale}px)`; };
    stick.onpointerdown = e => { if (!this.active || stickId !== null) return; e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); this.onGesture(); update(e); };
    stick.onpointermove = e => { if (this.active && e.pointerId === stickId) update(e); };
    const stop = (e: PointerEvent) => { if (e.pointerId === stickId) { stickId = null; this.stick = { x: 0, y: 0 }; thumb.style.transform = 'translate(0px,0px)'; } };
    stick.onpointerup = stop; stick.onpointercancel = stop; stick.onlostpointercapture = stop;
    const aim = document.querySelector<HTMLElement>('#aim-zone')!;
    aim.onpointerdown = e => { if (!this.active || aimId !== null) return; e.preventDefault(); aimId = e.pointerId; last = { x: e.clientX, y: e.clientY }; aim.setPointerCapture(e.pointerId); this.onGesture(); };
    aim.onpointermove = e => { if (this.active && e.pointerId === aimId) { this.aim((e.clientX - last.x) * 1.5, (e.clientY - last.y) * 1.5); last = { x: e.clientX, y: e.clientY }; } };
    const stopAim = (e: PointerEvent) => { if (e.pointerId === aimId) aimId = null; }; aim.onpointerup = stopAim; aim.onpointercancel = stopAim; aim.onlostpointercapture = stopAim;
    const fire = document.querySelector<HTMLElement>('#fire')!;
    let fireId: number | null = null;
    fire.onpointerdown = e => { if (!this.active || fireId !== null) return; e.preventDefault(); fireId = e.pointerId; fire.setPointerCapture(e.pointerId); this.onGesture(); this.fire = true; fire.classList.add('pressed'); };
    const stopFire = (e: PointerEvent) => { if (e.pointerId === fireId) { fireId = null; this.fire = false; fire.classList.remove('pressed'); } }; fire.onpointerup = stopFire; fire.onpointercancel = stopFire; fire.onlostpointercapture = stopFire;
    document.querySelector<HTMLElement>('#dash-touch')!.onpointerdown = e => { if (!this.active) return; e.preventDefault(); this.onGesture(); this.dash = true; };
  }
}
