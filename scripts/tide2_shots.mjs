// Tides pass 2 stills: everything on the water + floating structures, high vs low.
// node scripts/tide2_shots.mjs [baseUrl] [tag=after] [views=all] [levels=0,-1.72]  → screenshots/tide2_<tag>_<view>_<level>.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5232/cedar-landing/';
const TAG = process.argv[3] ?? 'after';
const ONLY = (process.argv[4] ?? 'all').split(',');
const LEVELS = (process.argv[5] ?? '0,-1.72').split(',').map(Number);
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
export const VIEWS = {
  market: { pos: [44, 4.2, 176], target: [22, -0.4, 157] }, // Cedar Landing: Mae's market pier + the moored float boats
  seapost: { pos: [128, 5, 230], target: [115.7, 0, 214.9] }, // the Bobbing Seapost (floating shop)
  canoefloat: { pos: [42, 4.5, 104], target: [32, 0, 113.5] }, // village canoe float + gangway
  keeper: { pos: [34, 3.2, 44], target: [22, -0.6, 26] },
  spot: { pos: [52, 9, 30], target: [38, 0, 14], hs: true }, // fishing spot HS02 Keeper East Shelf
  teeth: { pos: [40, 14, 448], target: [40, -1, 478] },
  shallows: { pos: [214, 26, -30], target: [181, 0, -60] }, // Twinbar islets: shallows plates
  race: { pos: [60, 18, 345], target: [60, 0, 373] }, // the Race: foam lines, rips, whirlpools
  logboom: { pos: [-200, 8, 300], target: [-214, 0, 280.4] },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { const D = window.__debug; D.markRevealSeen(); D.mist(0.22); D.ui.quiet?.(); D.setClock(14); D.rain?.(0); D.storm?.(0); });
let first = true;
for (const [name, v] of Object.entries(VIEWS)) {
  if (!ONLY.includes('all') && !ONLY.includes(name)) continue;
  for (const L of LEVELS) {
    await page.evaluate(({ v, L }) => {
      const D = window.__debug;
      D.tide(L);
      // the boat out of frame (behind the camera) so the chase camera / reveal stays quiet
      D.teleport(v.pos[0] + (v.pos[0] - v.target[0]) * 1.5, v.pos[2] + (v.pos[2] - v.target[2]) * 1.5);
      D.cam({ pos: v.pos, target: v.target, fov: 45 });
    }, { v, L });
    await sleep(first ? 5000 : 1200);
    first = false;
    const f = `${OUT}/tide2_${TAG}_${name}_${L}.png`;
    await page.screenshot({ path: f });
    console.log('wrote', f);
  }
}
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
