import { zipFunctions } from '@netlify/zip-it-and-ship-it';
import { mkdir, rm } from 'node:fs/promises';
await rm('dist/functions', { recursive: true, force: true });
await mkdir('dist/functions', { recursive: true });
const functions = await zipFunctions('netlify/functions', 'dist/functions', {
  basePath: process.cwd(), manifest: 'dist/functions/manifest.json',
  config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22', nodeModuleFormat: 'esm' } },
});
if (functions.length !== 1 || functions[0].name !== 'game' || functions[0].runtime !== 'js') throw new Error('Expected exactly one standard game function.');
console.log(`Packaged standard Netlify function: ${functions[0].name} (${functions[0].size} bytes)`);
