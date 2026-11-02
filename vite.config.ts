import { defineConfig } from 'vite';

// Production builds deploy to GitHub Pages at https://kellanm.github.io/cedar-landing/.
// Override with BASE_PATH=/other/ npm run build (or `npm run build:pages` for a relative ./ base).
// All runtime asset URLs (world/*, draco/) are built from import.meta.env.BASE_URL.
export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? (command === 'build' ? '/cedar-landing/' : '/'),
  server: { host: true, port: 5190, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
}));
