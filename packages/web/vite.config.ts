import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the page runs here (5173) and talks to the server (5174) through this proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:5174', ws: true },
      '/api': { target: 'http://127.0.0.1:5174' },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
