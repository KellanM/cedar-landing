import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';
const commit = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : sha;

// Production builds deploy to GitHub Pages at https://kellanm.github.io/cedar-landing/.
// Override with BASE_PATH=/other/ npm run build (or `npm run build:pages` for a relative ./ base).
// All runtime asset URLs (world/*, draco/) are built from import.meta.env.BASE_URL.
export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? (command === 'build' ? '/cedar-landing/' : '/'),
  server: { host: true, port: 5190, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // version.json: the running game compares it with its own build to offer updates (src/version.ts)
  plugins: [{
    name: 'version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, commit, built }) });
    },
  }],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(built),
  },
}));
