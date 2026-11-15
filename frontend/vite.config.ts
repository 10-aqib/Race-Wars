import { defineConfig } from 'vite';

// three.js accounts for most of the single game bundle (~335 kB gzip); that is expected for a WebGL game.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1200,
    target: 'es2022',
  },
});
