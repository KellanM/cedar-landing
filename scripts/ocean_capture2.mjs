// Ocean pass 2 A/B (docs/ocean_study.md): node scripts/ocean_capture2.mjs [newUrl] [oldUrl] [phone|desktop] [outDir]
// Sea states 0, 3, 5, 8, 10: pass 2 (slider) vs the pass-1 Swell (v0.10.1 build, weather-pinned), open water,
// chase camera: a full-res still + a frame sequence each (frames/<vp>_s<S>/<new|old>_NN.jpg + times.json, for
// scripts/ocean_gif.py). Pass 2 only: a low side view at 8 and 10, Smooth vs Faceted stills at 5, the Dev
// tab, and fishing at 3 (cast) and 8 ("Too rough"). Logs sea / rough stats and console errors.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const NEW = process.argv[2] ?? 'http://localhost:5252/cedar-landing/';
const OLD = process.argv[3] ?? 'http://localhost:5253/cedar-landing/';
const VP = process.argv[4] ?? 'phone';
const OUT = path.resolve(process.argv[5] ?? 'screenshots/ocean2');
const N = Number(process.env.FRAMES ?? 22);
const LEVELS = (process.env.LEVELS ?? '0,3,5,8,10').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = VP === 'phone';
const report = [];
const log = (...a) => { console.log(...a); report.push(a.join(' ')); };
// weather that goes with each level (same for both builds); the pass-1 Swell's own 0..1 state
const WX = (s) => (s >= 8 ? [1, 1] : s >= 5 ? [0.8, 0] : [0, 0]);
const OLD_STATE = { 0: 0, 3: 0.25, 5: 0.6, 8: 1, 10: 1 };

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
async function setLevel(p, s) {
  const [r, st] = WX(s);
  await p.page.evaluate(([r, st]) => { window.__debug.rain(r); window.__debug.storm(st); window.__debug.weatherSnap(false); window.__debug.teleport(135, 215, Math.PI); }, [r, st]);
  if (p.which === 'new') await p.page.evaluate((s) => { window.__debug.seaState(s); window.__debug.swell(s); }, s);
  else await p.page.evaluate((v) => window.__debug.swell(v), OLD_STATE[s]);
  await sleep(2600);
}
async function seq(p, name) {
  const dir = path.join(OUT, 'frames', `${VP}_${name}`); fs.mkdirSync(dir, { recursive: true });
  const times = [], t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await p.page.screenshot({ path: path.join(dir, `${p.which}_${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 82, scale: 'css' });
    times.push(Date.now() - t0);
    await sleep(40);
  }
  fs.writeFileSync(path.join(dir, `${p.which}_times.json`), JSON.stringify(times));
}

for (const which of ['old', 'new']) {
  const p = await open(which === 'new' ? NEW : OLD, which);
  for (const s of LEVELS) {
    await setLevel(p, s);
    await p.page.screenshot({ path: path.join(OUT, `${VP}_s${s}_${which}.png`) });
    await seq(p, `s${s}`);
    if (which === 'new') log(`[${VP}] new S${s}: ${JSON.stringify(await p.page.evaluate(() => ({ sw: window.__debug.swell(), rough: window.__debug.roughStats() })))}`);
  }
  if (which === 'new') {
    // the hull riding it: a low side view
    for (const s of [8, 10]) {
      await setLevel(p, s);
      await p.page.evaluate(() => { const b = window.__debug.state.boat ?? { x: 135, z: 215 }; window.__debug.cam({ pos: [b.x + 16, 2.6, b.z + 5], target: [b.x, 0.3, b.z], fov: 45 }); });
      await sleep(600);
      await p.page.screenshot({ path: path.join(OUT, `${VP}_side_s${s}.png`) });
      await seq(p, `side_s${s}`);
      await p.page.evaluate(() => window.__debug.cam(null));
    }
    // look: smooth vs faceted at 5
    await setLevel(p, 5);
    for (const look of ['smooth', 'faceted']) { await p.page.evaluate((l) => window.__debug.seaLook(l), look); await sleep(400); await p.page.screenshot({ path: path.join(OUT, `${VP}_look_${look}_s5.png`) }); }
    await p.page.evaluate(() => window.__debug.seaLook('smooth'));
    // fishing: fine at 3, refused at 8
    for (const s of [3, 8]) {
      await setLevel(p, s);
      const hs = (await p.page.evaluate(() => window.__debug.hotspots())) ?? [];
      const h = hs.find((x) => /open|reef|kelp|channel/i.test(x)) ?? hs[0];
      if (h) await p.page.evaluate((h) => window.__debug.viewHotspot(h, 7), h);
      await p.page.evaluate((s) => { window.__debug.seaState(s); window.__debug.swell(s); }, s);
      await sleep(800);
      await p.page.evaluate(() => window.__debug.action());
      await sleep(2600);
      await p.page.screenshot({ path: path.join(OUT, `${VP}_fishing_s${s}.png`) });
      await seq(p, `fishing_s${s}`);
      log(`[${VP}] fishing S${s}: ${JSON.stringify(await p.page.evaluate(() => ({ phase: window.__debug.state.fishPhase ?? null, rough: window.__debug.roughStats() })))}`);
      await p.page.keyboard.down('w'); await sleep(500); await p.page.keyboard.up('w');
    }
    // the Dev tab with the slider
    await p.page.evaluate(() => window.__debug.ui.openLog('dev'));
    await sleep(600);
    await p.page.screenshot({ path: path.join(OUT, `${VP}_devtab.png`) });
  }
  log(`[${VP}] ${which}: console errors ${p.errors.length}${p.errors.length ? ' :: ' + p.errors.slice(0, 3).join(' | ') : ''}`);
  await p.ctx.close();
}
await browser.close();
fs.appendFileSync(path.join(OUT, `report_${VP}.txt`), report.join('\n') + '\n');
