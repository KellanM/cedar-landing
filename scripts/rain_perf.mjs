// Weather perf (docs/rain_study.md): node scripts/rain_perf.mjs [baseUrl] [viewport=phone|desktop] [quality=high|low]
// Phone profile = 390x844 @3x (as water_perf.mjs). For dry / drizzle / rain / storm / storm mid-flash, in the chase
// view and a horizon view: synchronous GPU bench (ms per render, median of 5 x 120) plus the weather's CPU ms per frame.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5222/cedar-landing/';
const VP = process.argv[3] ?? 'phone';
const Q = process.argv[4] ?? 'high';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = VP === 'phone';
const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}?debug`);
await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('salish-sea-save-v1', JSON.stringify({ settings: { quality: q } })); }, Q);
await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.teleport(220, 300, 0.6); window.__debug.setClock(11); });
const W = { dry: [0, 0], drizzle: [0.35, 0], rain: [0.75, 0], storm: [null, 1] };
const views = { chase: null, horizon: { pos: [220, 6, 300], target: [120, 10, 180], fov: 50 } };
console.log(`viewport ${VP} @${phone ? 3 : 1}x, quality ${Q}`);
for (const [vn, c] of Object.entries(views)) {
  await page.evaluate((c) => window.__debug.cam(c), c);
  for (const [wn, [r, s]] of Object.entries(W)) {
    await page.evaluate(([r, s]) => { const d = window.__debug; d.storm(s); d.rain(r); d.weatherSnap(false); }, [r, s]);
    await sleep(2500);
    const res = await page.evaluate(() => {
      const d = window.__debug;
      const runs = []; for (let i = 0; i < 5; i++) runs.push(d.benchFrame(120).full);
      runs.sort((a, b) => a - b);
      return { gpu: runs[2], fx: d.weatherFx(), draws: d.state.drawCalls, fps: d.state.fps };
    });
    // CPU: the weather update's own ms, averaged over ~1 s of frames
    const cpu = await page.evaluate(() => new Promise((res) => { let n = 0, sum = 0; const t = () => { sum += window.__debug.weatherFx().ms; if (++n < 60) requestAnimationFrame(t); else res(sum / n); }; requestAnimationFrame(t); }));
    console.log(`${vn.padEnd(8)} ${wn.padEnd(8)} gpu ${res.gpu.toFixed(3)} ms  cpu ${cpu.toFixed(3)} ms  draws ${res.draws}  fps ${res.fps}  streaks ${res.fx.streaks} marks ${res.fx.marks} veils ${res.fx.veils}`);
  }
  // mid-flash (bolt + full-screen lift drawn)
  await page.evaluate(() => { window.__debug.lightning(true); });
  await sleep(120);
  const fl = await page.evaluate(() => { const d = window.__debug; const runs = []; for (let i = 0; i < 5; i++) runs.push(d.benchFrame(60).full); runs.sort((a, b) => a - b); return { gpu: runs[2], fx: d.weatherFx() }; });
  console.log(`${vn.padEnd(8)} flash    gpu ${fl.gpu.toFixed(3)} ms  (flash ${fl.fx.flash})`);
}
console.log('console errors:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
