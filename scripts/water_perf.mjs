// Water perf A/B: node scripts/water_perf.mjs [baseUrl] [variants=classic,flat,crests,full] [viewport=phone|desktop] [quality=high|low]
// For each sea variant: loads the game, holds three views (open water, harbour, chase cam under way) and reports
// steady fps, draw calls, tris and a synchronous GPU bench (ms per frame with and without the sea, 5 x 120 frames, median).
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5198/cedar-landing/';
const VARIANTS = (process.argv[3] ?? 'classic,flat,crests,full').split(',');
const VP = process.argv[4] ?? 'phone';
const Q = process.argv[5] ?? 'high';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const views = { open: { pos: [135, 5, 205], target: [138, 0, 260] }, harbour: { pos: [62, 15, 90], target: [21, 0, 131] }, chase: null };
const phone = VP === 'phone';
for (const v of VARIANTS) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}?debug&sea=${v}`);
  await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('salish-sea-save-v1', JSON.stringify({ settings: { quality: q } })); }, Q);
  await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
  const out = [];
  for (const [name, c] of Object.entries(views)) {
    await page.evaluate((c) => window.__debug.cam(c ? { ...c, fov: 50 } : null), c);
    if (!c) await page.evaluate(() => window.__debug.teleport(135, 215, Math.PI));
    await sleep(2500);
    const r = await page.evaluate(() => {
      const runs = []; for (let i = 0; i < 5; i++) runs.push(window.__debug.benchFrame(120));
      const med = (k) => runs.map((x) => x[k]).sort((a, b) => a - b)[2];
      const s = window.__debug.state;
      return { fps: s.fps, draws: s.drawCalls, tris: s.tris, full: med('full'), noSea: med('noSea'), sea: +(med('full') - med('noSea')).toFixed(3) };
    });
    out.push(`${name}: fps ${r.fps} draws ${r.draws} tris ${(r.tris / 1000).toFixed(0)}k frame ${r.full}ms sea ${r.sea}ms`);
  }
  console.log(`[${VP} ${Q}] ${v.padEnd(7)} | ${out.join(' | ')} | errors ${errors.length}`);
  await ctx.close();
}
await browser.close();
