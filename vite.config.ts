import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist/client', emptyOutDir: true, rollupOptions: { output: { manualChunks: { three: ['three'] } } } }, server: { host: '0.0.0.0' } });
