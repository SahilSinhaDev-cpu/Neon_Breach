import { MenuState, type MenuPanel } from './menu-state';
import { HOW_TO, SOLO_HOW_TO, type Snapshot } from '../shared/protocol';
import type { HttpReply } from '../shared/http-protocol';
import type { Controls } from './controls';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const label = (id: string, value: string) => { if ($(id).textContent !== value) $(id).textContent = value; };
type Exit = 'return-lobby' | 'leave' | 'quit' | 'offline';
type Confirmation = { kind: 'warning' | 'error' | 'connection'; action?: Exit; message: string; previous?: Confirmation };
type Options = {
  controls: Controls; state: () => Snapshot | null; id: () => string; connected: () => boolean;
  screen: (screen: string) => void; send: (action: string) => Promise<HttpReply>;
  left: () => void; reconnect: () => void; abandon: () => void; audioGesture: () => void;
};

export class Navigation {
  menu: MenuState;
  busy = false;
  private confirmation: Confirmation | null = null;
  private previousPanel: MenuPanel | null = null;
  private focus = new Map<MenuPanel, HTMLElement>();
  private wasLocked = false;
  private copyTimer = 0;
  constructor(private options: Options) {
    this.menu = new MenuState(() => this.refresh());
    const on = (id: string, fn: () => void) => { $(id).onclick = fn; };
    on('join-open', () => this.menu.open('join'));
    for (const id of ['join-back', 'settings-back', 'settings-back-top', 'how-back', 'how-back-top']) on(id, () => this.menu.back());
    for (const id of ['settings-open', 'results-settings', 'pause-settings']) on(id, () => { options.audioGesture(); this.menu.open('settings'); });
    for (const id of ['how-open', 'lobby-how-open']) on(id, () => {
      $('how-rules').replaceChildren(...(options.state()?.mode === 'solo' ? SOLO_HOW_TO : HOW_TO).map(rule => { const li = document.createElement('li'); li.textContent = rule; return li; }));
      this.menu.open('how-to-play');
    });
    on('match-settings', () => this.menu.pause()); on('pause-resume', () => this.resume());
    on('resume-button', () => { if (this.menu.root === 'match' && !this.menu.blocksMatch) void options.controls.lock(); });
    on('start', () => { const s = options.state(); if (!this.busy && s?.host === options.id() && s.phase === 'lobby') void this.run('start'); });
    for (const id of ['replay', 'lobby-replay']) on(id, () => { const s = options.state(); if (!this.busy && s?.host === options.id() && s.phase === 'ended') void this.run('replay'); });
    for (const id of ['leave-lobby', 'leave-results']) on(id, () => this.ask('leave'));
    for (const id of ['pause-lobby', 'results-lobby']) on(id, () => this.ask('return-lobby'));
    on('leave-match', () => this.ask('quit'));
    $('home-brand').onclick = event => { event.preventDefault(); if (options.state()) this.ask('leave'); else this.menu.resume(); };
    on('confirm-cancel', () => this.cancel()); on('confirm-accept', () => { if (!this.busy && this.confirmation?.action) void this.run(this.confirmation.action); });
    for (const id of ['connection-reconnect', 'confirm-reconnect']) on(id, () => { options.reconnect(); label('connection-message', 'Reconnecting; you can still return to Landing.'); });
    for (const id of ['connection-home', 'confirm-home']) on(id, () => this.ask('offline'));
    on('copy-code', () => void this.copyCode());
    for (const id of ['pause-menu', 'settings', 'how-menu', 'confirm-menu', 'connection-overlay']) $(id).addEventListener('cancel', event => { event.preventDefault(); this.escape(); });
    document.addEventListener('keydown', event => {
      if (event.code !== 'Escape' || document.body.classList.contains('intro-playing')) return;
      if ((event.target as HTMLElement).matches('#callsign, #room-code')) { (event.target as HTMLElement).blur(); event.preventDefault(); event.stopImmediatePropagation(); return; }
      event.preventDefault(); event.stopImmediatePropagation(); this.escape();
    }, { capture: true });
    this.refresh();
  }
  sync() {
    const state = this.options.state(), player = state?.players.find(p => p.id === this.options.id());
    this.menu.sync(!state ? 'landing' : state.phase === 'lobby' || player?.inLobby ? 'lobby' : state.phase === 'playing' ? 'match' : 'end');
    this.refresh();
  }
  pointerChanged() {
    const locked = document.pointerLockElement === this.options.controls.canvas;
    if (this.wasLocked && !locked) this.menu.pause();
    this.wasLocked = locked; this.refresh();
  }
  private escape() {
    if (this.busy) return;
    if (this.menu.panel === 'match') this.menu.pause();
    else if (this.menu.panel === 'paused') this.resume();
    else if (this.menu.panel === 'confirm') this.cancel();
    else this.menu.back();
  }
  resume() { this.menu.resume(); if (this.menu.root === 'match' && this.options.connected()) void this.options.controls.lock(); }
  error(message: string) {
    // Known server errors remain plain text and one sentence on screen.
    const normalized = message.replace(/\.{2,}/g, '').replace(/\.\s+/g, '; ').replace(/[.\s]+$/, '') + '.';
    this.confirmation = { kind: 'error', message: normalized }; this.menu.open('confirm'); this.refresh();
  }
  connectionLost(message: string) {
    this.confirmation = { kind: 'connection', message }; this.menu.open('confirm'); this.refresh();
  }
  connectionRecovered() {
    if (this.confirmation?.kind === 'connection') { this.confirmation = null; this.menu.back(); }
    this.refresh();
  }
  private ask(action: Exit) {
    if (this.busy) return;
    const previous = this.menu.panel === 'confirm' ? this.confirmation ?? undefined : undefined;
    this.confirmation = { kind: 'warning', action, previous,
      message: action === 'return-lobby' ? 'Leave this match and return to the lobby?' : action === 'quit' ? 'Quit this match and return to Landing?' : action === 'offline' ? 'Disconnect and return to Landing?' : 'Leave this room and return to Landing?' };
    this.menu.open('confirm'); this.refresh();
  }
  private cancel() {
    if (this.busy) return;
    if (this.confirmation?.previous) { this.confirmation = this.confirmation.previous; this.refresh(); }
    else { this.confirmation = null; this.menu.back(); }
  }
  private async run(action: string) {
    if (this.busy) return;
    this.busy = true; const start = performance.now(); this.refresh();
    let reply: HttpReply;
    try { reply = await this.options.send(['quit', 'offline'].includes(action) ? 'leave' : action); }
    catch { reply = { ok: false, error: 'The station did not confirm this action.' }; }
    if (['return-lobby', 'quit', 'leave', 'offline'].includes(action)) await new Promise(r => setTimeout(r, Math.max(0, 1000 - (performance.now() - start))));
    this.busy = false;
    if (!reply.ok) {
      if (action === 'offline') { this.options.abandon(); this.confirmation = null; this.menu.reset('landing'); }
      else this.error(reply.error || 'The station did not confirm this action.');
    } else if (['leave', 'quit', 'offline'].includes(action)) {
      this.options.left(); this.confirmation = null; this.menu.reset('landing');
    } else { this.confirmation = null; this.menu.resume(); }
    this.refresh();
    // Acquire the mouse only after Start is confirmed and controls are live.
    // A lobby lock would be released by the pending-command guard and could
    // race the first match snapshot into an unintended pause.
    if (reply.ok && action === 'start' && this.menu.root === 'match' && !this.menu.blocksMatch && this.options.connected()) void this.options.controls.lock();
  }
  refresh() {
    const { menu, options } = this, state = options.state();
    options.screen(({ landing: 'landing', lobby: 'lobby', match: 'hud', end: 'results' })[menu.root]);
    const active = menu.root === 'match' && !menu.blocksMatch && options.connected() && !this.busy;
    options.controls.active = active;
    if (!active) { options.controls.clear(); if (document.pointerLockElement) void document.exitPointerLock(); }
    document.body.classList.toggle('menu-blocked', menu.root === 'match' && menu.blocksMatch);
    const joining = menu.panel === 'join'; $('join-panel').hidden = !joining; $('create-options').hidden = joining;
    label('entry-location', joining ? '01 / JOIN ROOM' : '01 / ESTABLISH UPLINK');
    $('entry-title').innerHTML = joining ? 'Join the signal.' : 'Your contract<br>starts here.';
    label('entry-note', joining ? 'Enter the code from your host; joining does not start the match.' : 'Bring friends, or take on 3 bots. No account.');
    label('nav-location', `${menu.root === 'end' ? 'END CARD' : menu.root.toUpperCase()}${state ? ` / ${state.code}` : ' / YEAR 2191'}`);
    label('settings-location', `${menu.root.toUpperCase()} / SETTINGS`); label('how-location', `${menu.root.toUpperCase()} / HOW TO PLAY`);
    const live = state?.phase === 'playing'; label('pause-live', live ? 'MATCH STILL LIVE' : 'CONTRACT ENDED');
    label('pause-note', live ? 'Only your controls are paused; the clock, incoming damage and other operators continue.' : 'The contract ended while this menu was open; Resume opens the end card.');
    if (state) {
      const host = state.host === options.id(), enough = state.players.filter(p => p.connected && !p.bot).length >= (state.mode === 'solo' ? 1 : 2);
      $('start').hidden = !host || state.phase !== 'lobby'; $<HTMLButtonElement>('start').disabled = this.busy || !enough;
      $('lobby-replay').hidden = !host || state.phase !== 'ended'; $('replay').hidden = !host;
      for (const id of ['lobby-replay', 'replay']) $<HTMLButtonElement>(id).disabled = this.busy;
      $('results-lobby').className = host ? 'secondary' : 'primary';
    }
    const c = this.confirmation, connection = menu.panel === 'confirm' && c?.kind === 'connection';
    if (c) {
      label('connection-message', c.message); label('confirm-message', c.message);
      label('confirm-title', c.kind === 'error' ? 'Uplink request failed.' : 'Leave the signal?');
      label('confirm-location', c.kind === 'error' ? 'STATION RESPONSE' : 'CONFIRM NAVIGATION');
      label('confirm-effect', c.kind === 'error' ? 'Your seat stays connected until the server confirms a room change.' : c.action === 'return-lobby' ? 'Only you leave the active match. Your seat stays in this room; the other operators continue under the normal last-player rule.' : c.action === 'offline' ? 'We request a server-confirmed leave first. If unreachable, disconnecting releases your seat under the normal socket or heartbeat rule.' : 'Only your seat is removed. The host transfers if needed; the other operators stay in their room.');
      label('confirm-cancel', c.kind === 'error' ? 'Back' : 'Cancel');
      label('confirm-accept', c.action === 'return-lobby' ? 'Return to Lobby' : c.action === 'quit' ? 'Quit Match' : c.action === 'offline' ? 'Return to Landing' : 'Leave Room');
      $('confirm-accept').hidden = c.kind !== 'warning';
      $('confirm-reconnect').hidden = c.kind !== 'error' || options.connected();
      $('confirm-home').hidden = c.kind !== 'error' || options.connected();
      label('confirm-progress', this.busy ? 'WAITING FOR SERVER CONFIRMATION…' : '');
    }
    for (const id of ['pause-lobby', 'leave-match', 'results-lobby', 'leave-lobby', 'leave-results', 'confirm-cancel', 'confirm-accept', 'connection-home', 'confirm-home']) $<HTMLButtonElement>(id).disabled = this.busy;
    const target = menu.panel === 'paused' ? 'pause-menu' : menu.panel === 'settings' ? 'settings' : menu.panel === 'how-to-play' ? 'how-menu' : menu.panel === 'confirm' ? connection ? 'connection-overlay' : 'confirm-menu' : null;
    const changed = this.previousPanel !== menu.panel;
    if (changed && this.previousPanel && document.activeElement instanceof HTMLElement) this.focus.set(this.previousPanel, document.activeElement);
    for (const id of ['pause-menu', 'settings', 'how-menu', 'confirm-menu', 'connection-overlay']) {
      const dialog = $<HTMLDialogElement>(id);
      if (id !== target && dialog.open) dialog.close();
      else if (id === target && !dialog.open) {
        dialog.showModal(); const first = id === 'confirm-menu' ? $('confirm-cancel') : id === 'connection-overlay' ? $('connection-reconnect') : dialog.querySelector<HTMLElement>('.primary'); first?.focus();
      }
    }
    if (changed && !target) { const previous = this.focus.get(menu.panel); if (previous?.isConnected && previous.offsetParent !== null) previous.focus(); }
    this.previousPanel = menu.panel;
    $('resume').hidden = menu.root !== 'match' || menu.blocksMatch || options.controls.touch || document.pointerLockElement === options.controls.canvas || !options.connected();
  }
  private async copyCode() {
    const code = this.options.state()?.code; if (!code) return;
    clearTimeout(this.copyTimer);
    try { await navigator.clipboard.writeText(code); label('copy-code', 'Copied'); label('copy-status', 'Room code copied.'); }
    catch { const range = document.createRange(); range.selectNodeContents($('lobby-code')); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); label('copy-status', 'Copy blocked — code selected'); }
    this.copyTimer = window.setTimeout(() => { label('copy-code', 'Copy Code'); label('copy-status', ''); }, 2000);
  }
}
