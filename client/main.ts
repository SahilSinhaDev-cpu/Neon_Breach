import { GameConnection } from './connection';
import { Arena } from './scene';
import { Controls } from './controls';
import { Sound } from './audio';
import { ServerClock } from './server-clock';
import type { HttpReply } from '../shared/http-protocol';
import { HOW_TO, SOLO_HOW_TO, type GameEvent, type Snapshot, type PublicPlayer } from '../shared/protocol';
import { RULES } from '../shared/world';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const e = $(id); if (e && e.textContent !== value) e.textContent = value; };
const app = $('app');
app.innerHTML = `
<canvas id="arena" aria-label="Three-dimensional orbital arena"></canvas><div class="vignette"></div>
<header id="header"><a class="brand" href="/" aria-label="Neon Breach home"><span class="brand-mark">N<span>↗</span></span><span>NEON<span class="brand-light">BREACH</span><small>ORBITAL CONTRACT SYSTEM</small></span></a><div class="station"><span class="live-dot"></span> STATION 07 <span class="dim">/</span> YEAR 2191</div><button class="icon-button" id="settings-open" aria-label="Open settings">⚙ <span>SETTINGS</span></button></header>
<main id="landing" class="screen landing">
  <section class="hero"><div class="eyebrow"><span class="mini-line"></span> EARTH IS SILENT. THE ARENA ISN’T.</div><h1>NEON<br><span>BREACH</span></h1><p class="tagline">The contract ends when the signal dies.</p><p class="intro">Four operators. One failing station.<br>Get in. Stay moving. Leave a signal.</p><div class="specs"><div><b>01—04</b><span>SOLO / ONLINE</span></div><div><b>180<span>s</span></b><span>PER CONTRACT</span></div><div><b>10</b><span>TO TAKE IT ALL</span></div></div></section>
  <section class="terminal"><div class="panel-top"><span>01 / ESTABLISH UPLINK</span><span class="terminal-dots">▰ ▰ ▰</span></div><h2>Your contract<br> starts here.</h2><p class="subtle">Bring friends, or take on 3 bots. No account.</p><form id="room-form"><label for="callsign">OPERATOR CALLSIGN <span>2–10 CHARACTERS</span></label><input id="callsign" name="callsign" placeholder="E.G. VEX" minlength="2" maxlength="10" pattern="[A-Za-z0-9]{2,10}" autocomplete="off" autocapitalize="characters" spellcheck="false" required><button class="primary" id="create" type="submit">CREATE A ROOM <span>↗</span></button><button class="secondary solo-button" id="solo" type="button">PLAY SOLO <span>→</span></button><p class="solo-hint">You + 3 bots. Same arena. No waiting.</p><div class="or"><span></span> OR ENTER AN EXISTING CONTRACT <span></span></div><div class="join-line"><input id="room-code" aria-label="Room code" placeholder="ROOM CODE" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false"><button id="join" class="secondary" type="button">JOIN <span>→</span></button></div></form><div class="panel-foot"><span class="live-dot"></span><span id="landing-connection">CONNECTING TO STATION…</span><span>FFA / 1 ARENA</span></div></section>
  <div class="landing-bottom"><span class="sector">SECTOR 07 <i>+</i> THE SHATTERED RELAY</span><button class="text-button" id="how-open">OPERATOR BRIEFING <span>↓</span></button><span class="dim">NO DOWNLOAD. NO SECOND TEAM.</span></div>
  <section class="briefing" id="landing-rules"><div><span class="eyebrow">KNOW THE CONTRACT</span><h2>One rifle.<br>Every operator for themselves.</h2><p class="subtle">Move, aim, and make three hits count.<br>Every eliminated operator returns.</p></div><ol id="rules-list"></ol></section>
</main>
<main id="lobby" class="screen lobby" hidden><section class="lobby-intro"><div class="eyebrow" id="lobby-mode">UPLINK ESTABLISHED / PRIVATE ROOM</div><h1><span class="title-white" id="lobby-title">ASSEMBLE</span><br><span id="lobby-subtitle">THE SIGNAL.</span></h1><p class="tagline" id="lobby-tagline">Send the code. Settle the contract.</p><div class="code-panel"><span id="code-label">ROOM CODE</span><div><strong id="lobby-code"></strong><button id="copy-code" class="icon-button" aria-label="Copy room code">COPY ↗</button></div><small id="lobby-invite">Open this game on another device and enter the code.</small></div><div class="lobby-meta"><span>FREE-FOR-ALL</span><span>3 MINUTES</span><span>FIRST TO 10</span></div></section><section class="terminal roster-panel"><div class="panel-top"><span>02 / OPERATOR MANIFEST</span><span id="player-count"></span></div><h2>Awaiting deployment.</h2><div id="roster"></div><p id="host-note" class="subtle"></p><button class="primary" id="start">START CONTRACT <span>↗</span></button><button class="text-button leave" id="leave-lobby">LEAVE ROOM</button></section><details class="lobby-briefing" open><summary>CONTRACT RULES & CONTROLS</summary><ol id="lobby-rules"></ol></details></main>
<section id="hud" hidden aria-label="Match heads-up display"><div class="hud-top"><div class="match-label"><b>NEON BREACH</b><span id="match-code"></span><button id="match-settings" class="text-button">ESC / OPTIONS</button></div><div class="clock"><span>CONTRACT REMAINING</span><strong id="timer">03:00</strong><small>FIRST TO 10</small></div><div class="score-panel"><div class="score-head">OPERATORS <span>ELIMS</span></div><div id="scores"></div></div></div><div id="feed" aria-live="polite"></div><div id="crosshair"><i></i><i></i><i></i><i></i></div><div id="hitmarker">╳</div><div id="damage-direction">▲</div><div id="damage-flash"></div><div class="cell-status" id="cell-status"></div><div class="health-block" id="health-block"><span>VITAL SYSTEMS</span><div><strong id="hp">100</strong><small>/ 100</small><b id="life-status">ONLINE</b></div><div class="health-track"><i id="hp-bar"></i></div><div class="dash-track"><span>SHIFT / DASH</span><i><b id="dash-bar"></b></i><strong id="dash-status">READY</strong></div></div><div class="weapon-info"><span>PULSE RIFLE / 01</span><strong>∞ <small>ENERGY</small></strong><span>34 DMG <i>·</i> HITSCAN</span></div><div class="bottom-status"><span id="connection">● CONNECTED</span><span id="latency">— MS</span></div><div id="touch-controls"><div id="aim-zone" aria-label="Drag to aim"></div><div id="stick" aria-label="Movement joystick"><span id="stick-thumb"></span><small>MOVE</small></div><button id="dash-touch" aria-label="Dash">↟<small>DASH</small></button><button id="fire" aria-label="Fire rifle">◎<small>FIRE</small></button></div><div class="center-overlay" id="respawn" hidden><span class="eyebrow">SIGNAL INTERRUPTED</span><h2>OPERATOR DOWN</h2><p>Reconstructing in <strong id="respawn-timer">5</strong></p></div><div class="center-overlay resume" id="resume" hidden><span class="eyebrow">CONTRACT IN PROGRESS</span><h2>RE-ENTER THE SIGNAL.</h2><p>The match continues while your cursor is released.</p><button id="resume-button" class="primary">CLICK TO RESUME <span>↗</span></button><small>WASD MOVE · MOUSE AIM · CLICK FIRE · SHIFT DASH</small></div></section>
<main id="results" class="screen results" hidden><div class="result-card"><span class="eyebrow" id="result-mode">CONTRACT CLOSED / SIGNAL SURVIVES</span><div class="result-emblem">⌁</div><p id="result-label">LAST SIGNAL STANDING</p><h1 id="winner"></h1><p id="win-reason" class="subtle"></p><div id="final-scores"></div><button id="replay" class="primary">RETURN TO LOBBY <span>↗</span></button><p class="subtle" id="replay-note"></p><button id="leave-results" class="text-button">LEAVE ROOM</button></div></main>
<div id="connection-overlay" class="connection-overlay" hidden><span class="live-dot"></span><strong>UPLINK INTERRUPTED</strong><p id="connection-message">Reconnecting to station…</p><button id="connection-home" class="secondary">RETURN HOME</button></div><div id="toast" role="alert" hidden></div>
<button id="audio-enable" class="audio-enable" type="button" aria-label="Enable game audio">ENABLE AUDIO <span>↗</span></button>
<dialog id="settings"><form method="dialog"><div class="panel-top"><span>OPERATOR SETTINGS</span><button class="icon-button" aria-label="Close settings">✕</button></div><h2>Make it yours.</h2><label for="sensitivity">AIM SENSITIVITY <output id="sensitivity-value"></output></label><input id="sensitivity" type="range" min="0.25" max="2.5" step="0.05"><fieldset class="audio-settings"><legend>STATION AUDIO</legend><div class="audio-levels">${(['master', 'effects', 'ambience', 'music', 'ui'] as const).map(bus => `<div><label for="audio-${bus}">${bus === 'ui' ? 'UI / MATCH' : bus.toUpperCase()}<output id="audio-${bus}-value"></output></label><input id="audio-${bus}" type="range" min="0" max="100" step="1"></div>`).join('')}</div><label class="toggle"><span>MUTE ALL SOUND</span><input type="checkbox" id="audio-mute"></label><p id="audio-status" class="subtle" role="status"></p></fieldset><label class="toggle"><span>TOUCH CONTROLS</span><input type="checkbox" id="touch-enabled"></label><p class="subtle">Phased operators remain hittable. Protected operators cannot fire or take damage.</p><p class="subtle">Desktop: WASD / arrows · Mouse aim · Click fire · Shift dash · Esc release cursor.</p><button class="primary">SAVE & CLOSE <span>↗</span></button><button id="leave-match" type="button" class="text-button">LEAVE CURRENT ROOM</button></form></dialog>`;

for (const id of ['rules-list', 'lobby-rules']) for (const rule of HOW_TO) { const li = document.createElement('li'); li.textContent = rule; $(id).append(li); }
const canvas = $<HTMLCanvasElement>('arena'), sound = new Sound(), controls = new Controls(canvas);
let arena: Arena | null = null;
try { arena = new Arena(canvas); } catch { setTimeout(() => showError('WebGL 2 is unavailable. Enable hardware acceleration or try another browser to enter the arena.'), 0); }
const socket = new GameConnection();
let state: Snapshot | null = null, myId = '', sequence = 0, screen = 'landing', latency = 0, rosterKey = '', scoreKey = '', toastTimer = 0, pending = false, seatLost = false;
let entryGeneration = 0, recoveryTimer = 0, recovering = false;
const clock = new ServerClock();
let saved: { code: string; token: string; name: string } | null = null;
try { saved = JSON.parse(sessionStorage.getItem('nb-seat') || 'null'); } catch { /* Invalid local state does not prevent joining. */ }
$<HTMLInputElement>('callsign').value = localStorage.getItem('nb-name') || '';
const serverNow = () => state ? clock.now() : 0;
const me = () => state?.players.find(p => p.id === myId);
function showError(message: string) { text('toast', message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('toast').hidden = true, 7000); }
function setScreen(next: string) {
  screen = next; for (const id of ['landing', 'lobby', 'hud', 'results']) $(id).hidden = id !== next;
  $('header').hidden = next === 'hud'; document.body.classList.toggle('in-match', next === 'hud'); document.body.classList.toggle('touch', controls.touch);
  if (next !== 'hud' && document.pointerLockElement) void document.exitPointerLock();
  controls.active = next === 'hud' && socket.connected && !seatLost && !$<HTMLDialogElement>('settings').open;
  if (next !== 'hud') controls.clear();
  if (next !== 'landing') window.scrollTo(0, 0);
}
function ackEmit(event: string, data: unknown): Promise<HttpReply> { return socket.request(event, data); }
function roomPending(value: boolean) { pending = value; for (const id of ['create', 'join', 'solo']) $<HTMLButtonElement>(id).disabled = value; }
async function enter(action: 'create' | 'join' | 'solo', recovery = false) {
  if (pending) return;
  if (!socket.connected) return showError('The station is not connected yet. Please wait or check your connection.');
  if (!arena) return showError('WebGL 2 is required to play. Try another browser or enable hardware acceleration.');
  const name = recovery ? saved?.name : $<HTMLInputElement>('callsign').value.trim();
  if (!name || !/^[a-zA-Z0-9]{2,10}$/.test(name)) return showError('Callsign needs 2–10 letters or numbers.');
  const code = recovery ? saved?.code : $<HTMLInputElement>('room-code').value.trim().toUpperCase();
  clearTimeout(recoveryTimer);
  const generation = ++entryGeneration;
  recovering = recovery;
  roomPending(true); sound.unlock();
  const reply = await ackEmit('room', { action, name, code, token: recovery ? saved?.token : undefined });
  if (generation !== entryGeneration) return;
  roomPending(false);
  if (!reply.ok || !reply.snapshot || !reply.id || !reply.token) {
    if (recovery && reply.retryable && saved) {
      $('connection-overlay').hidden = false;
      text('connection-message', 'Recovering your lobby seat. Your room and callsign are saved…');
      recoveryTimer = window.setTimeout(() => {
        if (generation === entryGeneration && saved && (!state || state.phase === 'lobby')) void enter('join', true);
      }, Math.max(700, Math.min(10_000, reply.retryAfterMs || 0)));
      return;
    }
    recovering = false;
    if (recovery) { saved = null; sessionStorage.removeItem('nb-seat'); $('connection-overlay').hidden = true; state = null; myId = ''; if (arena) { arena.snapshot = null; arena.playing = false; } setScreen('landing'); }
    showError(reply.error || 'Could not join the room.'); return;
  }
  recovering = false; myId = reply.id; saved = { code: reply.snapshot.code, token: reply.token, name: name.toUpperCase() }; sessionStorage.setItem('nb-seat', JSON.stringify(saved)); localStorage.setItem('nb-name', name.toUpperCase());
  $('connection-overlay').hidden = true; receive(reply.snapshot); sound.joined();
}
async function action(action: string) { const reply = await ackEmit('action', action); if (!reply.ok) showError(reply.error || 'Action failed.'); return reply.ok; }
async function leave() {
  ++entryGeneration; clearTimeout(recoveryTimer); recovering = false; roomPending(false);
  const leaving = action('leave');
  clock.reset();
  sound.clear(); state = null; myId = ''; saved = null; seatLost = false; rosterKey = ''; scoreKey = ''; sessionStorage.removeItem('nb-seat'); controls.clear();
  if (arena) { arena.snapshot = null; arena.playing = false; arena.initialized = false; }
  $('connection-overlay').hidden = true; $<HTMLDialogElement>('settings').close(); setScreen('landing');
  await leaving;
}
function row(p: PublicPlayer, mode: 'lobby' | 'score' | 'final') {
  const row = document.createElement('div'); row.className = `player-row ${p.id === myId ? 'is-me' : ''}`;
  row.dataset.bot = String(p.bot);
  const badge = document.createElement('span'); badge.className = 'player-badge'; badge.style.setProperty('--player-color', p.color); badge.textContent = p.name.slice(0, 1); row.append(badge);
  const name = document.createElement('span'); name.className = 'player-name'; name.textContent = p.name; if (p.id === myId) { const label = document.createElement('small'); label.textContent = ' YOU'; name.append(label); } row.append(name);
  if (p.bot) { const label = document.createElement('span'); label.className = 'bot-tag'; label.textContent = 'BOT'; name.append(label); }
  const status = document.createElement('span'); status.className = 'player-state';
  if (mode === 'lobby') status.textContent = p.bot ? 'AI READY' : !p.connected ? 'RECONNECTING' : p.id === state?.host ? 'HOST' : 'LINKED';
  else { status.textContent = !p.connected ? 'OFFLINE' : p.phaseUntil > serverNow() ? 'PHASE' : ''; const score = document.createElement('strong'); score.textContent = String(p.score).padStart(2, '0'); row.append(status, score); return row; }
  row.append(status); return row;
}
function receive(s: Snapshot) {
  if (!myId) return;
  const old = state; seatLost = false; state = s; clock.observe(s, latency); arena?.accept(s, myId, controls, latency); sound.receive(s, myId);
  if (s.phase === 'lobby') {
    if (screen !== 'lobby') setScreen('lobby');
    const solo = s.mode === 'solo';
    text('lobby-mode', solo ? 'SOLO PRACTICE / COMPUTER OPPONENTS' : 'UPLINK ESTABLISHED / PRIVATE ROOM');
    text('lobby-title', solo ? 'TRAIN SOLO.' : 'ASSEMBLE'); text('lobby-subtitle', solo ? 'STAY SHARP.' : 'THE SIGNAL.');
    text('lobby-tagline', solo ? 'One operator. Three bots. Your next contract.' : 'Send the code. Settle the contract.');
    text('code-label', solo ? 'PRACTICE MODE' : 'ROOM CODE'); text('lobby-code', solo ? '1 VS 3' : s.code); $('copy-code').hidden = solo;
    text('lobby-invite', solo ? 'Private practice. BOT operators are computer controlled.' : 'Open this game on another device and enter the code.');
    text('player-count', solo ? '1 PLAYER + 3 BOTS' : `${s.players.filter(p => p.connected).length} / 04`);
    if (!old || old.mode !== s.mode || old.phase !== 'lobby') {
      $('lobby-rules').replaceChildren(...(solo ? SOLO_HOW_TO : HOW_TO).map(rule => { const li = document.createElement('li'); li.textContent = rule; return li; }));
    }
    const key = JSON.stringify(s.players.map(p => [p.id, p.connected, p.name, p.color])) + s.host;
    if (rosterKey !== key) { rosterKey = key; $('roster').replaceChildren(...s.players.map(p => row(p, 'lobby'))); for (let i = s.players.length; i < 4; i++) { const empty = document.createElement('div'); empty.className = 'empty-seat'; empty.textContent = `0${i + 1}   AWAITING OPERATOR`; $('roster').append(empty); } }
    const host = s.host === myId, enough = s.players.filter(p => p.connected && !p.bot).length >= (solo ? 1 : 2);
    $<HTMLButtonElement>('start').disabled = !host || !enough;
    text('host-note', solo ? 'Three bots are ready. Start whenever you are. The same combat and victory rules apply.' : host ? enough ? 'Your operators are linked. Launch when everyone is ready.' : 'Invite at least one more operator to start.' : `Waiting for ${s.players.find(p => p.id === s.host)?.name ?? 'the host'} to start.`);
  } else if (s.phase === 'playing') {
    if (screen !== 'hud') { scoreKey = ''; $('feed').replaceChildren(); setScreen('hud'); text('match-code', s.mode === 'solo' ? 'SOLO PRACTICE / 3 BOTS' : `ROOM ${s.code} / FREE-FOR-ALL`); }
    const key = JSON.stringify(s.players.map(p => [p.id, p.score, p.connected, p.phaseUntil > serverNow()])) + s.host;
    if (scoreKey !== key) { scoreKey = key; $('scores').replaceChildren(...[...s.players].sort((a, b) => b.score - a.score || a.scoreAt - b.scoreAt || a.order - b.order).map(p => row(p, 'score'))); }
  } else {
    if (screen !== 'results' || old?.host !== s.host || old?.winner !== s.winner) {
      setScreen('results'); const winner = s.players.find(p => p.id === s.winner); text('winner', winner?.name || 'SIGNAL LOST'); $('winner').style.color = winner?.color || '#a3ffce'; text('win-reason', s.reason); text('result-label', s.winner === myId ? 'YOU HELD THE SIGNAL.' : winner?.bot ? 'COMPUTER OPPONENT WINS / BOT' : 'THE CONTRACT BELONGS TO');
      text('result-mode', s.mode === 'solo' ? 'SOLO PRACTICE / CONTRACT CLOSED' : 'CONTRACT CLOSED / SIGNAL SURVIVES');
      $('final-scores').replaceChildren(...[...s.players].sort((a, b) => b.score - a.score || a.scoreAt - b.scoreAt || a.order - b.order).map(p => row(p, 'final')));
      $<HTMLButtonElement>('replay').disabled = s.host !== myId; text('replay-note', s.mode === 'solo' ? 'Return to the solo lobby and start a fresh practice match.' : s.host === myId ? 'Return everyone to the lobby for a new contract.' : 'Waiting for the host to reopen the lobby.');
    }
  }
  updateOverlay();
}
function updateOverlay() { $('resume').hidden = screen !== 'hud' || controls.touch || document.pointerLockElement === canvas || $<HTMLDialogElement>('settings').open || !socket.connected || seatLost; }
controls.onChange = updateOverlay; controls.onGesture = () => sound.unlock(); controls.bindTouch();
socket.on('connect', () => { text('landing-connection', 'STATION ONLINE / READY TO CONNECT'); text('connection', seatLost ? '○ DISCONNECTED' : '● CONNECTED'); controls.active = screen === 'hud' && !seatLost && !$<HTMLDialogElement>('settings').open; if (saved && (!state || recovering)) { void enter('join', true); } else if (!seatLost && !recovering) $('connection-overlay').hidden = true; });
socket.on('disconnect', () => { sound.disconnect(); controls.suspend(); text('landing-connection', 'STATION OFFLINE / RECONNECTING'); text('connection', '○ RECONNECTING'); if (state) { $('connection-overlay').hidden = false; text('connection-message', state.phase === 'lobby' ? 'Reconnecting and recovering your lobby seat…' : 'Connection lost. Disconnecting removes you from the match. Reconnecting to station…'); } });
socket.on('unstable', () => { if (!seatLost) text('connection', '◌ UPLINK RETRYING'); });
socket.on('stable', () => { if (!seatLost) text('connection', '● CONNECTED'); });
socket.on('lobby_recover', () => { if (saved && state?.phase === 'lobby') { $('connection-overlay').hidden = false; text('connection-message', 'Recovering your lobby seat…'); void enter('join', true); } });
socket.on('connect_error', () => { text('landing-connection', 'UPLINK UNAVAILABLE / RETRYING'); if (state) $('connection-overlay').hidden = false; });
socket.on('snapshot', receive);
socket.on('event', (event: GameEvent) => {
  if (!state || screen !== 'hud') return;
  sound.event(event);
  if (event.type === 'shot') {
    arena?.shot(event.shot); const own = event.shot.shooter === myId;
    if (own && event.shot.damage) { $('hitmarker').classList.remove('flash'); void $('hitmarker').offsetWidth; $('hitmarker').classList.add('flash'); }
    if (event.shot.hit === myId && event.shot.damage) { $('damage-flash').classList.remove('flash'); void $('damage-flash').offsetWidth; $('damage-flash').classList.add('flash'); const p = me()!; const angle = Math.atan2(event.shot.from.x - p.x, -(event.shot.from.z - p.z)) + controls.yaw; $('damage-direction').style.transform = `rotate(${angle}rad)`; $('damage-direction').classList.remove('flash'); void $('damage-direction').offsetWidth; $('damage-direction').classList.add('flash'); }
  } else if (event.type === 'kill') {
    const killer = state.players.find(p => p.id === event.killer), victim = state.players.find(p => p.id === event.victim); const entry = document.createElement('div'); entry.textContent = `${killer?.name ?? 'OPERATOR'}${killer?.bot ? ' [BOT]' : ''} removed ${victim?.name ?? 'OPERATOR'}${victim?.bot ? ' [BOT]' : ''}.`; $('feed').prepend(entry); while ($('feed').children.length > 4) $('feed').lastElementChild?.remove(); setTimeout(() => entry.remove(), 6500);
  }
});
$<HTMLFormElement>('room-form').onsubmit = e => { e.preventDefault(); void enter('create'); };
$('solo').onclick = () => void enter('solo');
$('join').onclick = () => void enter('join'); $<HTMLInputElement>('room-code').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); void enter('join'); } };
$('start').onclick = () => { sound.unlock(); void controls.lock(); void action('start'); };
$('replay').onclick = () => void action('replay');
for (const id of ['leave-lobby', 'leave-results', 'leave-match', 'connection-home']) $(id).onclick = () => void leave();
$('copy-code').onclick = async () => { try { await navigator.clipboard.writeText(state?.code || ''); text('copy-code', 'COPIED ✓'); setTimeout(() => text('copy-code', 'COPY ↗'), 1800); } catch { showError('Select and copy the room code above.'); } };
$('how-open').onclick = () => $('landing-rules').scrollIntoView({ behavior: 'smooth' }); $('resume-button').onclick = () => void controls.lock();
const settings = $<HTMLDialogElement>('settings');
for (const id of ['settings-open', 'match-settings']) $(id).onclick = () => { sound.unlock(); controls.clear(); controls.active = false; if (document.pointerLockElement) void document.exitPointerLock(); settings.showModal(); updateOverlay(); };
settings.addEventListener('close', () => { controls.active = screen === 'hud' && socket.connected && !seatLost; updateOverlay(); });
$<HTMLInputElement>('sensitivity').value = String(controls.sensitivity); text('sensitivity-value', `${controls.sensitivity.toFixed(2)}×`);
$<HTMLInputElement>('sensitivity').oninput = e => { controls.sensitivity = Number((e.target as HTMLInputElement).value); localStorage.setItem('nb-sensitivity', String(controls.sensitivity)); text('sensitivity-value', `${controls.sensitivity.toFixed(2)}×`); };
function audioStatus() {
  const status = sound.status;
  $('audio-enable').hidden = status !== 'locked';
  text('audio-status', status === 'ready' ? 'Audio active. Headphones help locate nearby operators.' : status === 'muted' ? 'Sound is muted. All combat feedback remains visible.' : status === 'unavailable' ? 'Audio is unavailable in this browser. You can still play muted.' : 'Click or tap Enable Audio to hear the station.');
}
sound.onStatus = audioStatus; audioStatus();
$('audio-enable').onclick = () => sound.unlock();
// Browsers require a real user gesture, including after returning from a
// suspended mobile/background session. Never gate joining or shooting on audio.
for (const event of ['pointerdown', 'keydown'] as const) document.addEventListener(event, e => { if (e.isTrusted && sound.status === 'locked') sound.unlock(); }, { capture: true });
for (const bus of ['master', 'effects', 'ambience', 'music', 'ui'] as const) {
  const slider = $<HTMLInputElement>(`audio-${bus}`); slider.value = String(Math.round(sound.settings[bus] * 100)); text(`audio-${bus}-value`, `${slider.value}%`);
  slider.oninput = () => { sound.configure({ [bus]: Number(slider.value) / 100 }); text(`audio-${bus}-value`, `${slider.value}%`); sound.unlock(); };
}
$<HTMLInputElement>('audio-mute').checked = sound.settings.muted;
$<HTMLInputElement>('audio-mute').onchange = e => { sound.configure({ muted: (e.target as HTMLInputElement).checked }); sound.unlock(); };
$<HTMLInputElement>('touch-enabled').checked = controls.touch; $<HTMLInputElement>('touch-enabled').onchange = e => { controls.touch = (e.target as HTMLInputElement).checked; controls.clear(); document.body.classList.toggle('touch', controls.touch); updateOverlay(); };
socket.sample = () => { const input = controls.sample(sequence++); controls.dash = false; return input; };
socket.onLatency = ms => { latency = ms; text('latency', `${latency} MS`); };
socket.on('seat_error', (message: string) => { seatLost = true; text('connection', '○ DISCONNECTED'); sound.disconnect(); controls.active = false; controls.clear(); $('connection-overlay').hidden = false; text('connection-message', message); });
function frame() {
  const now = serverNow(), p = me();
  if (screen === 'hud' && state && p) {
    const seconds = Math.max(0, Math.ceil((state.endsAt - now) / 1000)); text('timer', `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`); $('timer').classList.toggle('urgent', seconds <= 20);
    text('hp', String(p.hp)); $('hp-bar').style.width = `${p.hp}%`; $('health-block')?.classList.toggle('low', p.hp <= 34);
    const protectedNow = p.hp > 0 && p.protectUntil > now; text('life-status', p.hp <= 0 ? 'OFFLINE' : protectedNow ? 'PROTECTED' : 'ONLINE');
    $('crosshair').classList.toggle('protected', protectedNow); $('crosshair').hidden = p.hp <= 0;
    const dash = Math.max(0, p.dashAt - now); $('dash-bar').style.width = `${100 * (1 - dash / RULES.dashMs)}%`; text('dash-status', dash > 0 ? `${(dash / 1000).toFixed(1)}s` : 'READY'); $<HTMLButtonElement>('dash-touch').disabled = dash > 0 || p.hp <= 0;
    $('respawn').hidden = p.hp > 0; text('respawn-timer', Math.max(0, Math.ceil((p.respawnAt - now) / 1000)).toString());
    const phased = p.phaseUntil > now; text('cell-status', protectedNow ? `PROTECTED · ${((p.protectUntil - now) / 1000).toFixed(1)}s · FIRE LOCKED` : phased ? `PHASE · ${((p.phaseUntil - now) / 1000).toFixed(1)}s` : state.cell ? 'PHASE CELL ONLINE · CENTER ARENA' : `PHASE CELL IN ${Math.max(0, Math.ceil((state.cellAt - now) / 1000))}s`); $('cell-status').classList.toggle('phased', phased);
  }
  arena?.render(controls, now);
  if (arena) sound.update(arena.camera.position, controls.yaw, controls.pitch, now);
}
if (arena) arena.renderer.setAnimationLoop(frame);
socket.connect();
