import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = {
  target: process.env.BACKEND_URL ?? 'http://localhost:5000',
  changeOrigin: true,
};

const REACT_PACKAGES = /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '..',
  test: {
    env: { TZ: 'Europe/London' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return REACT_PACKAGES.test(id) ? 'react' : undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/socket.io': { ...backend, ws: true },
      '/lists/': backend,
      '/u/': backend,
    },
  },
});
