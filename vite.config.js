import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/nebula-ausp/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        leaderboard: resolve(__dirname, 'leaderboard.html'),
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});