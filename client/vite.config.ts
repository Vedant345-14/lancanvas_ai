import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite dev server proxies API + WebSocket traffic to the Node server,
// so the browser only ever talks to one origin (works on the LAN too: http://<host-ip>:5173).
const target = process.env.VITE_SERVER_URL || 'http://localhost:8000';
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/socket.io': { target, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
