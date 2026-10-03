import { build } from 'esbuild';
await build({ entryPoints: ['server/index.ts', 'server/app.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', outdir: 'dist/server', outExtension: { '.js': '.mjs' }, sourcemap: true });
console.log('Built persistent real-time game server.');
