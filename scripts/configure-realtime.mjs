import { writeFile, rename } from 'node:fs/promises';
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

// Developer release tool: users deploy through the dashboard, with no secrets.
const raw = process.argv[2];
if (!raw) throw new Error('Supply the actual deployed HTTPS backend origin.');
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a public HTTPS origin, without a path or credentials.');
const origin = url.origin;
const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(90_000) });
const body = await health.json();
if (!health.ok || body.game !== 'NEON BREACH' || body.protocol !== 1 || body.release !== '2026-10-03-realtime-1') throw new Error('Deployed server has not passed the release health check.');
const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 30_000, auth: { protocol: 1 }, extraHeaders: { Origin: 'https://neonbreach977.netlify.app' } });
try {
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const reply = await new Promise((resolve, reject) => socket.timeout(5000).emit('room', { requestId: randomUUID(), action: 'create', name: 'RELEASEQA' }, (error, value) => error ? reject(error) : resolve(value)));
  if (!reply?.ok) throw new Error('Live room creation failed.');
  const left = await new Promise((resolve, reject) => socket.timeout(5000).emit('action', { requestId: randomUUID(), action: 'leave' }, (error, value) => error ? reject(error) : resolve(value)));
  if (!left?.ok) throw new Error('Live room cleanup failed.');
} finally { socket.disconnect(); }
const path = 'public/game-config.json', temporary = `${path}.tmp`;
await writeFile(temporary, JSON.stringify({ transport: 'websocket', serverUrl: origin }, null, 2) + '\n');
await rename(temporary, path);
console.log('Verified the deployed backend and configured the Netlify frontend. Rebuild before publishing.');
