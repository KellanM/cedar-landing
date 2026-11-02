// node scripts/outline_perf.mjs [base] — phone profile (390x844 @3x): fps (rAF, 4 s) + draws/tris + synchronous
// frame ms (benchOutline) for outline off / screen / screen-low / hull / hybrid, at the harbour, under way and fishing.
import { chromium } from 'playwright';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:5197/cedar-landing/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); }); await sleep(2000);
const modes = [['off', false, 'high'], ['screen', 'screen', 'high'], ['screen-low', 'screen', 'low'], ['hull', 'hull', 'high'], ['hybrid', 'hybrid', 'high']];
async function scene(label) {
  for (const [name, m, q] of modes) {
    await page.evaluate(([mm, qq]) => { window.__debug.outlineQuality(qq); window.__debug.outline(mm); }, [m, q]);
    await sleep(1500);
    let f = 0, dr = 0, tr = 0; const n = 8;
    for (let i = 0; i < n; i++) { await sleep(500); const s = await page.evaluate(() => window.__debug.state); f += s.fps; dr = Math.max(dr, s.drawCalls); tr = Math.max(tr, s.tris); }
    const b = m ? await page.evaluate(() => window.__debug.benchOutline(30)) : null;
    console.log(`${label.padEnd(9)} ${name.padEnd(10)} fps ${(f / n).toFixed(1).padStart(5)}  draws ${String(dr).padStart(4)}  tris ${(tr / 1000).toFixed(0).padStart(5)}k${b ? `  frame ms off ${b.off.ms} -> on ${b.on.ms}` : ''}`);
  }
  await page.evaluate(() => { window.__debug.outlineQuality('high'); window.__debug.outline(false); });
}
await page.evaluate(() => window.__debug.teleportTo('Interact_SellFish', 14)); await sleep(1500);
await scene('harbour');
await page.evaluate(() => window.__debug.viewHotspot('OpenWaterBirds', 45)); await page.evaluate(() => window.__debug.key('w', true)); await sleep(1500);
await scene('underway');
await page.evaluate(() => window.__debug.key('w', false));
const hs = await page.evaluate(() => window.__debug.hotspots()[0]);
await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hs); await sleep(1000);
await page.evaluate(() => window.__debug.action()); await sleep(1500);
await scene('fishing');
console.log('console errors', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
process.exit(errs.length ? 1 : 0);
