import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = {
  target: process.env.BACKEND_URL ?? 'http://localhost:5000',
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '..',
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
