import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT: change `base` to match your GitHub Pages path.
// - Project page (https://USER.github.io/REPO/) → base: '/REPO/'
// - User/Org page (https://USER.github.io/)     → base: '/'
// - Custom domain                               → base: '/'
export default defineConfig({
  base: '/Slidecast/',
  plugins: [react()],
  server: {
    port: 5173,
    // For local MP4 conversion (ffmpeg.wasm needs SharedArrayBuffer)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
  // pdf.js worker is loaded from CDN at runtime; no special config needed.
});
