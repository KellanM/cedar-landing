// Bake tide-pool sites from the loaded world into src/game/tidepool_sites.json.
// node scripts/tidepool_bake.mjs [baseUrl] [--write]   (re-run after a world re-export)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5224/';
const WRITE = process.argv.includes('--write');
function findChrome() {
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
  return path.join(root, d, 'chrome-win64', 'chrome.exe');
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
const t0 = Date.now();
const r = await page.evaluate(() => window.__debug.tidepoolBake({ spacing: 70, max: 16 }));
console.log(`baked in ${Date.now() - t0} ms: ${r.sites.length} sites from ${r.candidates} candidates`);
for (const s of r.sites) console.log(JSON.stringify(s));
if (WRITE) {
  fs.writeFileSync('src/game/tidepool_sites.json', JSON.stringify({ world: r.world, baked: new Date().toISOString().slice(0, 10), sites: r.sites }, null, 1) + '\n');
  console.log('wrote src/game/tidepool_sites.json');
}
await browser.close();
