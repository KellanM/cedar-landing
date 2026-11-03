// Tide stills: node scripts/tide_shots.mjs [baseUrl] [views=all] [levels=0,-1.7]
// Pins the water level and frames fixed cameras (high vs low) → screenshots/tide_<view>_<level>.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5224/';
const ONLY = (process.argv[3] ?? 'all').split(',');
const LEVELS = (process.argv[4] ?? '0,-1.7').split(',').map(Number);
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
function findChrome() {
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
  return path.join(root, d, 'chrome-win64', 'chrome.exe');
}
export const VIEWS = {
  landing: { pos: [44, 4.2, 176], target: [22, -0.4, 157], clock: 14 },
  landing2: { pos: [36, 5, 132], target: [18, -0.4, 150], clock: 14 },
  keeper: { pos: [38, 8, 52], target: [10, -1, 24], clock: 14 },
  teeth: { pos: [40, 14, 448], target: [40, -1, 478], clock: 14 },
  crescent: { pos: [150, 95, 410], target: [100, -1, 520], clock: 14 },
  keeperclose: { pos: [34, 3.2, 44], target: [22, -0.6, 26], clock: 14 },
  mouth: { pos: [40, 70, 500], target: [40, -1, 462], clock: 14 },
  aerial: { pos: [40, 260, 60], target: [40, 0, 200], clock: 14, fov: 55 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.mist(0.25); window.__debug.ui.quiet?.(); });
await sleep(1500);
for (const [name, v] of Object.entries(VIEWS)) {
  if (!ONLY.includes('all') && !ONLY.includes(name)) continue;
  for (const L of LEVELS) {
    await page.evaluate(({ v, L }) => { const d = window.__debug; d.setClock(v.clock); d.tide(L); d.cam({ pos: v.pos, target: v.target, fov: v.fov ?? 45 }); }, { v, L });
    await sleep(name === Object.keys(VIEWS).find((k) => ONLY.includes('all') || ONLY.includes(k)) && L === LEVELS[0] ? 5000 : 900);
    const f = `${OUT}/tide_${name}_${L}.png`;
    await page.screenshot({ path: f });
    console.log('wrote', f);
  }
}
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
