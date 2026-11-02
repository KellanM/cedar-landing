// Cooler as inventory: HUD without the persistent cooler, Log → Fish → Cooler, the "Cooler full" tag.
// node scripts/cooler_capture.mjs <base>  → screenshots/cooler_<vp>_<n>.png
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const OUT = path.resolve('screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const fish = (speciesId, name, size, stars, price, rarity = 'common') => ({ speciesId, name, size, stars, price, color: '#888', rarity });
for (const [vp, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  // seed a cooler (6 slots, 4 fish) and reload into it
  await page.evaluate((c) => { const k = 'salish-sea-save-v1'; const s = JSON.parse(localStorage.getItem(k) ?? '{}'); s.cooler = c; s.coolerCap = 6; s.records = Object.fromEntries(c.map((f) => [f.speciesId, { size: f.size, stars: f.stars, count: 1 }])); localStorage.setItem(k, JSON.stringify(s)); },
    [fish('copper-rockfish', 'Copper Rockfish', 41.2, 2, 14), fish('lingcod', 'Lingcod', 88.5, 3, 42, 'uncommon'), fish('shiner-perch', 'Shiner Perch', 12.4, 1, 3), fish('kelp-greenling', 'Kelp Greenling', 33.0, 2, 9)]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen());
  await sleep(4200);
  const vis = () => page.evaluate(() => { const e = document.getElementById('cooler-tab'); return getComputedStyle(e).opacity + (e.classList.contains('peek') ? ' (peek)' : ''); });
  console.log(`[${vp}] cooler-tab opacity at rest: ${await vis()}`);
  await page.screenshot({ path: `${OUT}/cooler_${vp}_0_hud.png` });
  await page.evaluate(() => window.__debug.ui.openLog('fish', { filter: 'cooler' }));
  await sleep(900);
  await page.screenshot({ path: `${OUT}/cooler_${vp}_1_log.png` });
  await page.evaluate(() => window.__debug.ui.openLog('fish', { filter: 'all' })); await sleep(500);
  await page.screenshot({ path: `${OUT}/cooler_${vp}_2_logall.png` });
  // full cooler: Log button tag, cooler still hidden
  await page.evaluate(() => { const k = 'salish-sea-save-v1'; const s = JSON.parse(localStorage.getItem(k)); s.coolerCap = 4; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen());
  await sleep(4200);
  console.log(`[${vp}] full: cooler-tab opacity ${await vis()}, log tag ${await page.evaluate(() => document.getElementById('btn-log').classList.contains('cooler-full'))}`);
  await page.screenshot({ path: `${OUT}/cooler_${vp}_3_full.png` });
  console.log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
