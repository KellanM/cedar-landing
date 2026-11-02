// Wildlife capture: node scripts/birds_capture.mjs [baseUrl] [hotspotName]
// Parks the boat facing a fishing hotspot at phone + desktop viewports, forces a frenzy dive and
// writes a frame sequence to screenshots/birds_*.png plus screenshots/birds_log.txt.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5190/';
const HS = process.argv[3];
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/birds_log.txt`;
fs.writeFileSync(LOG, '');
const log = (...a) => { console.log(...a); fs.appendFileSync(LOG, a.join(' ') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen());
  const st = () => page.evaluate(() => window.__debug.state);
  const hotspots = await page.evaluate(() => window.__debug.hotspots());
  const hs = HS ?? hotspots[0];
  const ok = await page.evaluate((h) => window.__debug.viewHotspot(h, 13), hs);
  log(`[${name}] world ${(await st()).world} hotspot ${hs} placed ${ok}`);
  await sleep(2500);
  const s0 = await st();
  log(`[${name}] wildlife`, JSON.stringify(s0.wildlife), `fps ${s0.fps} draws ${s0.drawCalls} tris ${s0.tris}`);
  await page.screenshot({ path: `${OUT}/birds_${name}_frenzy.png` });

  // close-up camera on the frenzy (scripted shot from the boat side, low and looking up a little)
  await page.evaluate((h) => {
    const d = window.__debug, p = d.hotspotPos(h), b = d.state.boat;
    const dx = b.x - p[0], dz = b.z - p[2], l = Math.hypot(dx, dz) || 1;
    d.shot([p[0] + (dx / l) * 17, 7, p[2] + (dz / l) * 17], [p[0], 3.5, p[2]], 55);
  }, hs);
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/birds_${name}_closeup.png` });
  // frenzy mid-dive: force dives, then a frame sequence ~150 ms apart
  const n = await page.evaluate(() => window.__debug.forceDives());
  log(`[${name}] forced ${n} dives`);
  await sleep(250);
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    await page.screenshot({ path: `${OUT}/birds_${name}_seq_${String(i).padStart(2, '0')}.png` });
    const s = await st();
    log(`[${name}] seq ${i}`, JSON.stringify(s.wildlife.states));
    await sleep(Math.max(0, 150 - (Date.now() - t)));
  }
  await page.evaluate(() => window.__debug.skipShot());
  // flush the floaters: paddle into the ring
  await page.evaluate((h) => window.__debug.teleportTo(h, 2), hs);
  await sleep(1200);
  log(`[${name}] boat in ring`, JSON.stringify((await st()).wildlife.states));
  await page.screenshot({ path: `${OUT}/birds_${name}_inring.png` });
  // catch excitement hook
  await page.evaluate(() => window.__debug.exciteBirds());
  await sleep(1500);
  log(`[${name}] after catch`, JSON.stringify((await st()).wildlife));
  // perf sample over ~4 s
  let fsum = 0, ms = 0;
  for (let i = 0; i < 8; i++) { await sleep(500); const s = await st(); fsum += s.fps; ms = Math.max(ms, s.wildlife.ms); }
  log(`[${name}] perf: avg fps ${(fsum / 8).toFixed(1)}, max wildlife update ${ms} ms`);
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

await run('phone', { width: 390, height: 844 }, true);
await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
