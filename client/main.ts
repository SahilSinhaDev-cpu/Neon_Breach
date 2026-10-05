import { GameConnection } from './connection';
import { Arena } from './scene';
import { Controls } from './controls';
import { Sound } from './audio';
import { ServerClock } from './server-clock';
import { IntroVideo } from './intro-video';
import { Navigation } from './navigation';
import { UI } from './ui';
import { FpsCounter } from './fps';
import type { HttpReply } from '../shared/http-protocol';
import { HOW_TO, SOLO_HOW_TO, type GameEvent, type Snapshot, type PublicPlayer } from '../shared/protocol';
import { RULES } from '../shared/world';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const e = $(id); if (e && e.textContent !== value) e.textContent = value; };
const app = $('app');
app.innerHTML = UI;
const fpsOutput = $('fps-counter'), fps = new FpsCounter(fpsOutput);

for (const id of ['rules-list', 'lobby-rules']) for (const rule of HOW_TO) { const li = document.createElement('li'); li.textContent = rule; $(id).append(li); }
const canvas = $<HTMLCanvasElement>('arena'), sound = new Sound(), controls = new Controls(canvas);
const introVideo = new IntroVideo({ getAudio: () => sound.settings, onMute: muted => { sound.configure({ muted }); sound.unlock(); }, onActive: active => sound.setIntroPlaying(active) });
let arena: Arena | null = null;
try { arena = new Arena(canvas); } catch { setTimeout(() => showError('WebGL 2 is unavailable. Enable hardware acceleration or try another browser to enter the arena.'), 0); }
const socket = new GameConnection();
let state: Snapshot | null = null, myId = '', sequence = 0, screen = 'landing', latency = 0, rosterKey = '', scoreKey = '', pending = false, seatLost = false;
let entryGeneration = 0, recoveryTimer = 0, recovering = false;
const clock = new ServerClock();
let saved: { code: string; token: string; name: string } | null = null;
try { saved = JSON.parse(sessionStorage.getItem('nb-seat') || 'null'); } catch { /* Invalid local state does not prevent joining. */ }
$<HTMLInputElement>('callsign').value = localStorage.getItem('nb-name') || '';
const serverNow = () => state ? clock.now() : 0;
const me = () => state?.players.find(p => p.id === myId);
function showError(message: string) { navigation.error(message); }
function setScreen(next: string) {
  screen = next; for (const id of ['landing', 'lobby', 'hud', 'results']) $(id).hidden = id !== next;
  $('header').hidden = next === 'hud'; document.body.classList.toggle('in-match', next === 'hud'); document.body.classList.toggle('touch', controls.touch);
  if (next !== 'hud' && document.pointerLockElement) void document.exitPointerLock();
  controls.active = next === 'hud' && socket.connected && !seatLost;
  if (next !== 'hud') controls.clear();
  if (next !== 'landing') window.scrollTo(0, 0);
}
const navigation = new Navigation({ controls, state: () => state, id: () => myId, connected: () => socket.connected && !seatLost, screen: setScreen, send: action => ackEmit('action', action), left: clearRoom, reconnect: () => socket.connect(), abandon: () => { socket.close(); clearRoom(); socket.connect(); }, audioGesture: () => sound.unlock() });
function ackEmit(event: string, data: unknown): Promise<HttpReply> { return socket.request(event, data); }
function roomPending(value: boolean) { pending = value; for (const id of ['create', 'join', 'solo', 'join-open', 'join-back']) $<HTMLButtonElement>(id).disabled = value; }
async function enter(action: 'create' | 'join' | 'solo', recovery = false, gesture = false) {
  if (pending) return;
  if (!socket.connected) return showError('The station is not connected yet. Please wait or check your connection.');
  if (!arena) return showError('WebGL 2 is required to play. Try another browser or enable hardware acceleration.');
  const name = recovery ? saved?.name : $<HTMLInputElement>('callsign').value.trim();
  if (!name || !/^[a-zA-Z0-9]{2,10}$/.test(name)) return showError('Callsign needs 2–10 letters or numbers.');
  const code = recovery ? saved?.code : $<HTMLInputElement>('room-code').value.trim().toUpperCase();
  if (action === 'join' && (!code || !/^[A-Z0-9]{4,6}$/.test(code))) return showError('Enter a room code using 4–6 letters or numbers.');
  clearTimeout(recoveryTimer);
  const generation = ++entryGeneration;
  recovering = recovery;
  roomPending(true); sound.unlock();
  if (!recovery) {
    try {
      const intro = await introVideo.play(gesture);
      if (intro === 'cancelled') return;
    } catch { introVideo.dismiss(true); /* Media is never required to open a room. */ }
    if (generation !== entryGeneration) return;
  }
  const reply = await ackEmit('room', { action, name, code, token: recovery ? saved?.token : undefined });
  if (generation !== entryGeneration) return;
  roomPending(false);
  if (!reply.ok || !reply.snapshot || !reply.id || !reply.token) {
    introVideo.dismiss();
    if (recovery && reply.retryable && saved) {
      navigation.connectionLost('Recovering your lobby seat; your room and callsign are saved.');
      recoveryTimer = window.setTimeout(() => {
        if (generation === entryGeneration && saved && (!state || state.phase === 'lobby' || me()?.inLobby)) void enter('join', true);
      }, Math.max(700, Math.min(10_000, reply.retryAfterMs || 0)));
      return;
    }
    recovering = false;
    if (recovery) { saved = null; sessionStorage.removeItem('nb-seat'); navigation.connectionRecovered(); state = null; myId = ''; if (arena) { arena.snapshot = null; arena.playing = false; } navigation.menu.reset('landing'); }
    showError(reply.error || 'Could not join the room.'); return;
  }
  recovering = false; myId = reply.id; saved = { code: reply.snapshot.code, token: reply.token, name: name.toUpperCase() }; sessionStorage.setItem('nb-seat', JSON.stringify(saved)); localStorage.setItem('nb-name', name.toUpperCase());
  navigation.connectionRecovered(); receive(reply.snapshot); introVideo.dismiss(); sound.joined();
}
function clearRoom() {
  ++entryGeneration; clearTimeout(recoveryTimer); recovering = false; roomPending(false); introVideo.cancel();
  clock.reset(); sound.clear(); state = null; myId = ''; saved = null; seatLost = false; rosterKey = ''; scoreKey = ''; sessionStorage.removeItem('nb-seat'); controls.clear();
  if (arena) { arena.snapshot = null; arena.playing = false; arena.initialized = false; }
}
function row(p: PublicPlayer, mode: 'lobby' | 'score' | 'final') {
  const row = document.createElement('div'); row.className = `player-row ${p.id === myId ? 'is-me' : ''}`;
  row.dataset.bot = String(p.bot);
  const badge = document.createElement('span'); badge.className = 'player-badge'; badge.style.setProperty('--player-color', p.color); badge.textContent = p.name.slice(0, 1); row.append(badge);
  const name = document.createElement('span'); name.className = 'player-name'; name.textContent = p.name; if (p.id === myId) { const label = document.createElement('small'); label.textContent = ' YOU'; name.append(label); } row.append(name);
  if (p.bot) { const label = document.createElement('span'); label.className = 'bot-tag'; label.textContent = 'BOT'; name.append(label); }
  const status = document.createElement('span'); status.className = 'player-state';
  if (mode === 'lobby') status.textContent = !p.connected ? 'RECONNECTING' : p.inLobby ? 'LOBBY' : state?.phase === 'playing' ? 'IN MATCH' : p.id === state?.host ? 'HOST' : p.bot ? 'AI READY' : 'LINKED';
  else { status.textContent = !p.connected ? 'OFFLINE' : p.inLobby ? 'LOBBY' : p.phaseUntil > serverNow() ? 'PHASE' : ''; const score = document.createElement('strong'); score.textContent = String(p.score).padStart(2, '0'); row.append(status, score); return row; }
  row.append(status); return row;
}
function receive(s: Snapshot) {
  if (!myId) return;
  const old = state; seatLost = false; state = s; clock.observe(s, latency); arena?.accept(s, myId, controls, latency); sound.receive(me()?.inLobby ? { ...s, phase: 'lobby' } : s, myId); navigation.sync();
  if (screen === 'lobby') {
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
    const key = JSON.stringify(s.players.map(p => [p.id, p.connected, p.inLobby, p.name, p.color])) + s.host;
    if (rosterKey !== key) { rosterKey = key; $('roster').replaceChildren(...s.players.map(p => row(p, 'lobby'))); for (let i = s.players.length; i < 4; i++) { const empty = document.createElement('div'); empty.className = 'empty-seat'; empty.textContent = `0${i + 1}   AWAITING OPERATOR`; $('roster').append(empty); } }
    const host = s.host === myId, enough = s.players.filter(p => p.connected && !p.bot).length >= (solo ? 1 : 2);
    $<HTMLButtonElement>('start').disabled = !host || !enough;
    text('lobby-heading', s.phase === 'playing' ? 'Match still live.' : s.phase === 'ended' ? 'Awaiting the next contract.' : 'Awaiting deployment.');
    text('host-note', s.phase === 'playing' ? 'Your seat is in the lobby; the other operators are still playing. Start Match stays unavailable until the contract ends and the host chooses Play Again.' : s.phase === 'ended' ? s.host === myId ? 'Play Again returns every connected operator to a clean lobby; the next match starts only when you choose Start Match.' : 'You are ready for the next contract; waiting for the host to choose Play Again.' : solo ? 'Three bots are ready. Start whenever you are. The same combat and victory rules apply.' : host ? enough ? 'Your operators are linked. Launch when everyone is ready.' : 'Invite at least one more operator to start.' : `Waiting for ${s.players.find(p => p.id === s.host)?.name ?? 'the host'} to start.`);
  } else if (screen === 'hud') {
    if (old?.phase !== 'playing' || old?.match !== s.match) { scoreKey = ''; $('feed').replaceChildren(); }
    text('match-code', s.mode === 'solo' ? 'SOLO PRACTICE / 3 BOTS' : `ROOM ${s.code} / FREE-FOR-ALL`);
    const key = JSON.stringify(s.players.map(p => [p.id, p.score, p.connected, p.inLobby, p.phaseUntil > serverNow()])) + s.host;
    if (scoreKey !== key) { scoreKey = key; $('scores').replaceChildren(...[...s.players].sort((a, b) => b.score - a.score || a.scoreAt - b.scoreAt || a.order - b.order).map(p => row(p, 'score'))); }
  } else {
    if (old?.phase !== 'ended' || old?.host !== s.host || old?.winner !== s.winner) {
      const finalPlayers = s.finalPlayers?.length ? s.finalPlayers : s.players, winner = finalPlayers.find(p => p.id === s.winner); text('winner', winner?.name || 'SIGNAL LOST'); $('winner').style.color = winner?.color || '#a3ffce'; text('win-reason', s.reason); text('result-label', s.winner === myId ? 'YOU HELD THE SIGNAL.' : winner?.bot ? 'COMPUTER OPPONENT WINS / BOT' : 'THE CONTRACT BELONGS TO');
      text('result-mode', s.mode === 'solo' ? 'SOLO PRACTICE / CONTRACT CLOSED' : 'CONTRACT CLOSED / SIGNAL SURVIVES');
      $('final-scores').replaceChildren(...[...finalPlayers].sort((a, b) => b.score - a.score || a.scoreAt - b.scoreAt || a.order - b.order).map(p => row(p, 'final')));
      $('replay').hidden = s.host !== myId; text('replay-note', s.mode === 'solo' ? 'Return to the solo lobby and start a fresh practice match.' : s.host === myId ? 'Return everyone to the lobby for a new contract.' : 'Waiting for the host to reopen the lobby.');
    }
  }
  navigation.refresh();
}

function updateOverlay() { navigation.refresh(); }
controls.onChange = () => navigation.pointerChanged(); controls.onGesture = () => sound.unlock(); controls.bindTouch();
socket.on('connect', () => {
  text('landing-connection', 'STATION ONLINE / READY TO CONNECT'); text('connection', seatLost ? '○ DISCONNECTED' : '● CONNECTED');
  if (saved && (!state || recovering)) void enter('join', true);
  else if (!seatLost && !recovering) navigation.connectionRecovered();
});
socket.on('disconnect', () => {
  sound.disconnect(); controls.suspend(); text('landing-connection', 'STATION OFFLINE / RECONNECTING'); text('connection', '○ RECONNECTING');
  if (state) navigation.connectionLost(screen === 'lobby' ? 'Connection lost; reconnect to recover your lobby seat.' : 'Connection lost; the server removes disconnected operators from the match.');
});
socket.on('unstable', () => { if (!seatLost) text('connection', '◌ UPLINK RETRYING'); });
socket.on('stable', () => { if (!seatLost) text('connection', '● CONNECTED'); });
socket.on('lobby_recover', () => { if (saved && (state?.phase === 'lobby' || me()?.inLobby)) { navigation.connectionLost('Recovering your lobby seat.'); void enter('join', true); } });
socket.on('connect_error', () => { text('landing-connection', 'UPLINK UNAVAILABLE / RETRYING'); if (state) navigation.connectionLost('Connection lost; use Reconnect or Return to Landing.'); });
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
$<HTMLFormElement>('room-form').onsubmit = e => { e.preventDefault(); void enter(navigation.menu.panel === 'join' ? 'join' : 'create', false, e.isTrusted); };
$('solo').onclick = e => void enter('solo', false, e.isTrusted);
$('join').onclick = e => void enter('join', false, e.isTrusted); $<HTMLInputElement>('room-code').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); void enter('join', false, e.isTrusted); } };
$<HTMLInputElement>('sensitivity').value = String(controls.sensitivity); text('sensitivity-value', `${controls.sensitivity.toFixed(2)}×`);
$<HTMLInputElement>('sensitivity').oninput = e => { controls.sensitivity = Number((e.target as HTMLInputElement).value); localStorage.setItem('nb-sensitivity', String(controls.sensitivity)); text('sensitivity-value', `${controls.sensitivity.toFixed(2)}×`); };
function audioStatus() {
  const status = sound.status;
  introVideo.syncAudio(); $<HTMLInputElement>('audio-mute').checked = sound.settings.muted;
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
socket.canAct = () => controls.canAct();
socket.onLatency = ms => { latency = ms; text('latency', `${latency} MS`); };
socket.on('seat_error', (message: string) => { seatLost = true; text('connection', '○ DISCONNECTED'); sound.disconnect(); controls.clear(); navigation.connectionLost(message); });
function frame() {
  fps.frame(performance.now(), !document.hidden);
  if (fpsOutput.hidden !== introVideo.active) fpsOutput.hidden = introVideo.active;
  const now = serverNow(), p = me();
  if (screen === 'hud' && state && p) {
    text('pause-life', p.hp <= 0 ? `OPERATOR DOWN · RECONSTRUCTING IN ${Math.max(0, Math.ceil((p.respawnAt - now) / 1000))}s` : '');
    const seconds = Math.max(0, Math.ceil((state.endsAt - now) / 1000)); text('timer', `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`); $('timer').classList.toggle('urgent', seconds <= 20);
    text('hp', String(p.hp)); $('hp-bar').style.width = `${p.hp}%`; $('health-block')?.classList.toggle('low', p.hp <= 34);
    const protectedNow = p.hp > 0 && p.protectUntil > now; text('life-status', p.hp <= 0 ? 'OFFLINE' : protectedNow ? 'PROTECTED' : 'ONLINE');
    $('crosshair').classList.toggle('protected', protectedNow); $('crosshair').hidden = p.hp <= 0;
    const dash = Math.max(0, p.dashAt - now); $('dash-bar').style.width = `${100 * (1 - dash / RULES.dashMs)}%`; text('dash-status', dash > 0 ? `${(dash / 1000).toFixed(1)}s` : 'READY'); $<HTMLButtonElement>('dash-touch').disabled = dash > 0 || p.hp <= 0;
    $('respawn').hidden = p.hp > 0; text('respawn-timer', Math.max(0, Math.ceil((p.respawnAt - now) / 1000)).toString());
    const phased = p.phaseUntil > now; text('cell-status', protectedNow ? `PROTECTED · ${((p.protectUntil - now) / 1000).toFixed(1)}s · FIRE LOCKED` : phased ? `PHASE · ${((p.phaseUntil - now) / 1000).toFixed(1)}s` : state.cell ? 'PHASE CELL ONLINE · CENTER ARENA' : `PHASE CELL IN ${Math.max(0, Math.ceil((state.cellAt - now) / 1000))}s`); $('cell-status').classList.toggle('phased', phased);
  }
  arena?.render(controls, now);
  if (arena && !introVideo.active) sound.update(arena.camera.position, controls.yaw, controls.pitch, now);
}
if (arena) arena.renderer.setAnimationLoop(frame);
socket.connect();
