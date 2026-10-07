import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer host (Vercel, Netlify, GitHub Pages...)
  base: './',
  server: { open: true },
  build: { chunkSizeWarningLimit: 1200 },
});
