// Sun-shading before/after screenshots: node scripts/light_shots.mjs [baseUrl] [presets] [views] [viewports]
// Writes screenshots/light_<viewport>_<preset>_<view>_<off|on>.png and prints fps on/off.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5196/';
const PRESETS = (process.argv[3] ?? 'overcast,sunbreak,dusk,night').split(',');
const VIEWS_WANT = (process.argv[4] ?? 'start,kiln,cedar,forest').split(',');
const VP_WANT = (process.argv[5] ?? 'phone,desktop').split(',');
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

// camera = chase camera behind the canoe; the canoe faces the target
const VIEWS = {
  start: null, // spawn
  kiln: { at: [16, 24], look: [-8.9, -8.0] }, // Kiln Point lighthouse
  cedar: { at: [-29.4, 173.1], look: [23.0, 143.9] }, // Cedar Landing from the water
  forest: { at: [8, 3], look: [-27.8, -19.2] }, // forest close-up (Shot_FOL_KilnPoint)
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const errors = [];
for (const [vp, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  if (!VP_WANT.includes(vp)) continue;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
  await sleep(1500);
  const spawn = await page.evaluate(() => window.__debug.state.boat);
  await page.addStyleTag({ content: '#compass,#move-hint,#prompt{display:none!important}' });
  for (const preset of PRESETS) {
    for (let i = 0; i < 8 && (await page.evaluate(() => window.__debug.state.tod)) !== preset; i++) await page.evaluate(() => window.__debug.cycleTOD());
    await page.evaluate(() => window.__light.reapply());
    for (const view of VIEWS_WANT) {
      const v = VIEWS[view];
      if (v) await page.evaluate(([x, z, y]) => window.__debug.teleport(x, z, y), [v.at[0], v.at[1], yawTo(v.at[0], v.at[1], v.look[0], v.look[1])]);
      else await page.evaluate(([x, z, y]) => window.__debug.teleport(x, z, y), [spawn.x, spawn.z, spawn.yaw]);
      for (const on of [false, true]) {
        await page.evaluate((o) => window.__light.set(o, true), on);
        await sleep(700);
        await page.screenshot({ path: `${OUT}/light_${vp}_${preset}_${view}_${on ? 'on' : 'off'}.png` });
      }
    }
  }
  if (vp === 'desktop') {
    // fps on vs off, forest view (most overdraw), 4 s each
    const v = VIEWS.forest;
    await page.evaluate(([x, z, y]) => window.__debug.teleport(x, z, y), [v.at[0], v.at[1], yawTo(v.at[0], v.at[1], v.look[0], v.look[1])]);
    for (const on of [false, true, false, true]) {
      await page.evaluate((o) => window.__light.set(o, true), on);
      await sleep(1000);
      const t0 = await page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { if (++n < 240) requestAnimationFrame(f); else res((performance.now() - s) / n); }; requestAnimationFrame(f); }));
      console.log(`fps sunshade=${on ? 'on ' : 'off'}: ${(1000 / t0).toFixed(1)} (${t0.toFixed(2)} ms/frame)`);
    }
  }
  await ctx.close();
}
console.log('console errors:', errors.length, errors.slice(0, 5).join(' | '));
await browser.close();
