// Tide-pool site contact sheet: node scripts/tidepool_shots.mjs [baseUrl] [level=-1.7] [sites=all]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5224/';
const LEVEL = Number(process.argv[3] ?? -1.7);
const ONLY = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const OUT = path.resolve('screenshots');
function findChrome() {
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
  return path.join(root, d, 'chrome-win64', 'chrome.exe');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.mist(0.25); window.__debug.setClock(14); });
const sites = await page.evaluate(() => window.__debug.tidepoolSites());
for (let i = 0; i < sites.length; i++) {
  if (ONLY && !ONLY.includes(i)) continue;
  const s = sites[i];
  const dx = Math.sin(s.a), dz = Math.cos(s.a);
  const t = [s.x + dx * 4, -0.8, s.z + dz * 4];
  const pos = [s.x + dx * 13 + dz * 6, 5.5, s.z + dz * 13 - dx * 6];
  await page.evaluate(({ pos, t, L }) => { const d = window.__debug; d.teleport(pos[0] + (pos[0] - t[0]) * 2, pos[2] + (pos[2] - t[2]) * 2); d.tide(L); d.cam({ pos, target: t, fov: 50 }); }, { pos, t, L: LEVEL });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/tidepool_site${i}_${LEVEL}.png` });
  console.log('site', i, JSON.stringify(s));
}
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
