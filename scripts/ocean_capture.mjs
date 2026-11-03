// Ocean experiment A/B (docs/ocean_study.md): node scripts/ocean_capture.mjs [baseUrl] [phone|desktop] [outDir]
// For Classic and Swell: open water in clear / rain / storm, idle and under way, plus fishing with the
// float on the swell. Writes full-res stills and frame sequences (frames/<case>/<ocean>_NN.jpg + times.json)
// for scripts/ocean_gif.py, a GPU bench per case (ms per frame with / without the sea) and console errors.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5238/cedar-landing/';
const VP = process.argv[3] ?? 'phone';
const OUT = path.resolve(process.argv[4] ?? 'screenshots/ocean');
const OCEANS = (process.env.OCEANS ?? 'classic,swell').split(',');
const N = Number(process.env.FRAMES ?? 28);
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = VP === 'phone';
const report = [];
const log = (...a) => { console.log(...a); report.push(a.join(' ')); };
const WEATHER = { clear: [0, 0], rain: [0.8, 0], storm: [1, 1] };

for (const ocean of OCEANS) {
  // GIF frames at a lighter scale; stills at the device's real scale in a second context
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?debug&ocean=${ocean}`);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.setClock?.(11); });
  await sleep(1500);
  const seq = async (name, n = N) => {
    const dir = path.join(OUT, 'frames', `${VP}_${name}`); fs.mkdirSync(dir, { recursive: true });
    const times = [];
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: path.join(dir, `${ocean}_${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 82, scale: 'css' });
      times.push(Date.now() - t0);
      await sleep(40);
    }
    fs.writeFileSync(path.join(dir, `${ocean}_times.json`), JSON.stringify(times));
  };
  const still = (name) => page.screenshot({ path: path.join(OUT, `${VP}_${name}_${ocean}.png`) });
  const bench = () => page.evaluate(() => {
    const runs = []; for (let i = 0; i < 5; i++) runs.push(window.__debug.benchFrame(90));
    const med = (k) => runs.map((x) => x[k]).sort((a, b) => a - b)[2];
    return { full: med('full'), sea: +(med('full') - med('noSea')).toFixed(3) };
  });

  for (const [w, [r, s]] of Object.entries(WEATHER)) {
    await page.evaluate(([r, s]) => { window.__debug.rain(r); window.__debug.storm(s); window.__debug.weatherSnap(false); }, [r, s]);
    await page.evaluate(() => window.__debug.teleport(135, 215, Math.PI));
    await sleep(400);
    await page.evaluate(() => window.__debug.swellSnap());
    await sleep(1800);
    await still(`${w}_idle`);
    const b = await bench();
    const sw = await page.evaluate(() => window.__debug.swell());
    log(`[${VP}] ${ocean} ${w}: frame ${b.full}ms sea ${b.sea}ms | sea state ${sw.state} foamThr ${sw.foamThr} amps ${sw.amps.join(',')}`);
    await seq(`${w}_idle`);
    // under way: full throttle, a gentle turn
    await page.keyboard.down('w');
    await sleep(1600);
    await still(`${w}_underway`);
    await seq(`${w}_underway`);
    await page.keyboard.up('w');
    await sleep(600);
  }

  // fishing: calm and storm, float on the water
  for (const w of ['clear', 'storm']) {
    const [r, s] = WEATHER[w];
    await page.evaluate(([r, s]) => { window.__debug.rain(r); window.__debug.storm(s); window.__debug.weatherSnap(false); }, [r, s]);
    const hs = (await page.evaluate(() => window.__debug.hotspots())) ?? [];
    const h = hs.find((x) => /open|reef|kelp|channel/i.test(x)) ?? hs[0];
    if (h) await page.evaluate((h) => window.__debug.viewHotspot(h, 7), h);
    await sleep(500);
    await page.evaluate(() => window.__debug.swellSnap());
    await page.evaluate(() => window.__debug.action());
    await sleep(3200);
    await still(`fishing_${w}`);
    await seq(`fishing_${w}`);
    await page.evaluate(() => window.__debug.closeModals?.());
    await page.keyboard.down('w'); await sleep(500); await page.keyboard.up('w'); // reels in
    await sleep(800);
  }
  log(`[${VP}] ${ocean}: console errors ${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
fs.appendFileSync(path.join(OUT, `report_${VP}.txt`), report.join('\n') + '\n');
