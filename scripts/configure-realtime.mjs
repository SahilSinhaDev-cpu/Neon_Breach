import { writeFile, rename } from 'node:fs/promises';
import { verifyBackend, FRONTEND_ORIGINS } from './verify-backend.mjs';

// Developer release tool: users deploy through the dashboard, with no secrets.
const raw = process.argv[2];
if (!raw) throw new Error('Supply the actual deployed HTTPS backend origin.');
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a public HTTPS origin, without a path or credentials.');
const origin = url.origin;
const report = await verifyBackend(origin, FRONTEND_ORIGINS);
const path = 'public/game-config.json', temporary = `${path}.tmp`;
await writeFile(temporary, JSON.stringify({ transport: 'websocket', serverUrl: origin }, null, 2) + '\n');
await rename(temporary, path);
console.log(JSON.stringify(report, null, 2));
console.log('Verified the deployed backend for Vercel and Netlify and configured the frontend. Rebuild before publishing.');
