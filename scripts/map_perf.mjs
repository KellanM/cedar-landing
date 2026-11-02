// node scripts/map_perf.mjs [base] [cpuSlowdown=4] — Map tab cost on a phone-sized page with CPU throttling:
// first-open chart build (land render + contours + raster), fog rebuild after new sight, and per-frame draw.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5199/cedar-landing/';
const SLOW = Number(process.argv[3] ?? 4);
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await bctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.markRevealSeen?.());
const cdp = await bctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
// the chart is prebuilt in the background ~2.5 s after load; measure that, then the first open
await page.waitForFunction(() => window.__debug.ui.map.info().ready, null, { timeout: 60000 });
const open = await page.evaluate(() => { const t = performance.now(); window.__debug.ui.openLog('map'); return performance.now() - t; });
const r = await page.evaluate(async () => {
  const m = window.__debug.ui.map;
  const info = m.info();
  const v = info.view;
  const draws = [];
  for (let i = 0; i < 20; i++) { m.view(v.x + i * 6, v.z + i * 3); draws.push(m.info().drawMs); }
  window.__debug.ui.closeLog(); window.__debug.ui.revealAll(); window.__debug.ui.visitAll();
  const t = performance.now(); window.__debug.ui.openLog('map'); const reopen = performance.now() - t;
  const draws2 = [];
  for (let i = 0; i < 20; i++) { m.view(v.x - i * 6, v.z + i * 5, 0.6); draws2.push(m.info().drawMs); }
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  window.__stages = info.stages; return { buildMs: info.buildMs, mainThreadMs: info.mainMs, drawMedFresh: med(draws), drawMaxFresh: Math.max(...draws), reopenRevealed: reopen, drawMedRevealedWide: med(draws2), drawMaxRevealedWide: Math.max(...draws2) };
});
console.log(JSON.stringify({ cpuSlowdown: SLOW, firstOpenMs: Math.round(open), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 10) / 10])) }));
console.log('stages', JSON.stringify(await page.evaluate(() => window.__stages)));
console.log('errors', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
process.exit(errs.length ? 1 : 0);
