import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // required so the built page loads over file:// inside Electron
  build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'es2023' },
  server: { fs: { allow: ['..'] } }, // skyloom-core is a sibling package
});
