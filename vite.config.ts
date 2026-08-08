import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any static host / subpath.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
