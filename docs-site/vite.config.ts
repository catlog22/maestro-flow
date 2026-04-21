import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { copyFileSync } from 'fs';

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',
  plugins: [
    react(),
    tailwindcss(),
    // Copy index.html to 404.html for GitHub Pages SPA routing
    {
      name: 'gh-pages-spa',
      closeBundle() {
        const outDir = path.resolve(__dirname, 'dist');
        const indexHtml = path.join(outDir, 'index.html');
        const notFoundHtml = path.join(outDir, '404.html');
        try {
          copyFileSync(indexHtml, notFoundHtml);
        } catch { /* ignore if index.html doesn't exist */ }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      // Allow serving files from parent directories
      allow: [
        '.',
        '..',
      ],
    },
  },
  publicDir: 'public',
});
