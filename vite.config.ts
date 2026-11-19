import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api and /ws to the optional FastAPI backend (port 8000).
// The app runs fully without the backend: the simulation engine lives in the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
