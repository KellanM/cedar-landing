// Ocean pass 3 A/B (docs/ocean_study.md "Pass 3"): node scripts/hull_capture.mjs [afterUrl] [beforeUrl] [phone|desktop] [outDir]
// Under way at full throttle at sea states 5, 8, 10, before (v0.12.x) vs after (hull splashes): a frame sequence each
// (frames/<vp>_s<S>/<before|after>_NN.jpg + times.json, for scripts/ocean_gif.py) and a still. After only: a forced
// landing (k 0.8) from the chase camera and from a low side view, frames back to back (a slow-mo strip), plus a bow
// slam. Logs hull stats (landings / slams / live shapes) and console errors.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const AFTER = process.argv[2] ?? 'http://localhost:5260/cedar-landing/';
const BEFORE = process.argv[3] ?? 'http://localhost:5261/cedar-landing/';
const VP = process.argv[4] ?? 'phone';
const OUT = path.resolve(process.argv[5] ?? 'screenshots/ocean3');
const N = Number(process.env.FRAMES ?? 26);
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = VP === 'phone';
const log = (...a) => { console.log(...a); fs.appendFileSync(path.join(OUT, `report_${VP}.txt`), a.join(' ') + '\n'); };

async function open(url, which) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${url}?debug&ocean=swell`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.setClock?.(11); });
  await sleep(1500);
  return { ctx, page, errors, which };
}
async function level(p, s) {
  await p.page.evaluate((s) => { window.__debug.storm(s >= 8 ? 1 : 0); window.__debug.rain(s >= 8 ? 0.8 : 0); window.__debug.weatherSnap(false); window.__debug.teleport(135, 215, Math.PI); window.__debug.seaState(s); window.__debug.swell(s); }, s);
  await sleep(2200);
}
async function seq(p, name, n = N, gap = 40) {
  const dir = path.join(OUT, 'frames', `${VP}_${name}`); fs.mkdirSync(dir, { recursive: true });
  const times = [], t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await p.page.screenshot({ path: path.join(dir, `${p.which}_${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 82, scale: 'css' });
    times.push(Date.now() - t0);
    if (gap) await sleep(gap);
  }
  fs.writeFileSync(path.join(dir, `${p.which}_times.json`), JSON.stringify(times));
}
const stats = (p) => p.page.evaluate(() => (window.__debug.hullStats ? window.__debug.hullStats() : null));

for (const which of ['before', 'after']) {
  const p = await open(which === 'after' ? AFTER : BEFORE, which);
  for (const s of [5, 8, 10]) {
    await level(p, s);
    await p.page.keyboard.down('w');
    await sleep(1800);
    await p.page.screenshot({ path: path.join(OUT, `${VP}_s${s}_underway_${which}.png`) });
    await seq(p, `s${s}_underway`);
    await p.page.keyboard.up('w');
    if (which === 'after') log(`[${VP}] after S${s} under way: ${JSON.stringify(await stats(p))}`);
  }
  if (which === 'after') {
    for (const view of ['chase', 'side']) {
      await level(p, 5);
      if (view === 'side') await p.page.evaluate(() => { const b = window.__debug.state.boat ?? { x: 135, z: 215 }; window.__debug.cam({ pos: [b.x + 13, 3.2, b.z + 4], target: [b.x, 0.6, b.z], fov: 45 }); });
      await sleep(500);
      await p.page.evaluate(() => window.__debug.splash(0.8, 'landing'));
      await seq(p, `landing_${view}`, 14, 0);
      await sleep(1200);
      await p.page.evaluate(() => window.__debug.splash(0.7, 'slam'));
      await seq(p, `slam_${view}`, 10, 0);
      await p.page.evaluate(() => window.__debug.cam(null));
    }
    // calm water: the same landing, small
    await level(p, 1);
    await p.page.evaluate(() => window.__debug.splash(0.5, 'landing'));
    await seq(p, 'landing_calm', 10, 0);
    log(`[${VP}] after forced: ${JSON.stringify(await stats(p))}`);
  }
  log(`[${VP}] ${which}: console errors ${p.errors.length}${p.errors.length ? ' :: ' + p.errors.slice(0, 3).join(' | ') : ''}`);
  await p.ctx.close();
}
await browser.close();
