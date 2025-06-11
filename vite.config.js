import { defineConfig } from 'vite';

export default defineConfig({
  base: '/nebula-ausp/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});