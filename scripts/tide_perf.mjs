// Tide perf: field build cost, per-frame tide cost, draw calls / GPU ms at a pool bench, high vs low water.
// node scripts/tide_perf.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5224/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [tag, vp, quality] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'low'], ['desktop', { viewport: { width: 1280, height: 800 } }, 'high']]) {
  const page = await (await browser.newContext(vp)).newPage();
  await page.goto(BASE + '?debug');
  await page.evaluate((q) => { localStorage.clear(); const s = { settings: { quality: q } }; localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)); }, quality);
  await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen());
  const site = (await page.evaluate(() => window.__debug.tidepoolSites()))[5];
  const out = {};
  for (const L of [0, -1.72]) {
    await page.evaluate(([s, L]) => { const D = window.__debug; D.tide(L); const dx = Math.sin(s.a), dz = Math.cos(s.a); D.teleport(s.x + dx * 26, s.z + dz * 26); }, [site, L]);
    await sleep(2500);
    out[L] = await page.evaluate(() => { const D = window.__debug; const st = D.state; return { fps: st.fps, draws: st.drawCalls, tris: st.tris, tide: D.tideStats(), bench: D.benchFrame(30) }; });
  }
  console.log(tag, quality, JSON.stringify(out));
  await page.close();
}
await browser.close();
