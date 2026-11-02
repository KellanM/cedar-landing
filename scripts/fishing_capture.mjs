// Fishing capture: node scripts/fishing_capture.mjs [baseUrl] [tag] [hotspotName] [only=phone|desktop]
// Scripts one full catch (cast → wait/nibble → bite/strike → reeling with thrashes → landing → payoff)
// at phone (390x844 @3x) and desktop (1280x800) and writes a frame sequence (~100–150 ms apart,
// limited by screenshot cost) to screenshots/fish_<tag>_<vp>_NN_<phase>.png plus
// screenshots/fish_<tag>_log.txt (per-frame phase/tension/thrash + fps/draw calls).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5193/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const HS = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const ONLY = process.argv[5];
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/fish_${TAG}_log.txt`;
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
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); });
  if (process.env.BOAT) {
    const r = await page.evaluate((id) => { const u = window.__debug.upg; u.give(5000); u.openShipwright('boats'); const b = u.buyBoat(id); const t = u.takeBoat(id); u.close(); return { b, t, state: u.state.boat, model: u.state.model }; }, process.env.BOAT);
    log(`[${name}] boat ${process.env.BOAT}`, JSON.stringify(r));
    await sleep(1500);
  }
  const st = () => page.evaluate(() => {
    const d = window.__debug, s = d.state, f = d.fishing;
    return { phase: s.phase, tension: +s.tension.toFixed(2), dist: +s.distance.toFixed(1), thrash: f.thrashing, fps: s.fps, draws: s.drawCalls, tris: s.tris, species: s.species };
  });
  const hotspots = await page.evaluate(() => window.__debug.hotspots());
  const hs = HS ?? hotspots[0];
  const ok = await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hs);
  log(`[${name}] hotspot ${hs} placed ${ok}`);
  await sleep(2500);
  let n = 0;
  const shot = async (label) => {
    const t = Date.now();
    const s = await st();
    const file = `fish_${TAG}_${name}_${String(n++).padStart(2, '0')}_${label}.png`;
    await page.screenshot({ path: `${OUT}/${file}` });
    log(`[${name}] ${file}`, JSON.stringify(s));
    return Date.now() - t;
  };
  await shot('approach');
  const s0 = await st();
  log(`[${name}] idle perf fps ${s0.fps} draws ${s0.draws} tris ${s0.tris}`);

  // cast
  await page.evaluate(() => window.__debug.action());
  for (let i = 0; i < 4; i++) { const ms = await shot('cast'); await sleep(Math.max(0, 140 - ms)); }
  await sleep(900);
  await shot('waiting');
  await sleep(800);
  await shot('waiting');
  // bite
  await page.evaluate(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 5000 }).catch(() => {});
  await shot('bite');
  // strike (hook-set)
  await page.evaluate(() => window.__debug.action());
  for (let i = 0; i < 3; i++) { const ms = await shot('strike'); await sleep(Math.max(0, 110 - ms)); }
  await page.evaluate(() => window.__debug.setAutoReel(true));
  // FX close look: force a thrash with the actor clock at 0.3x (frames labelled fxslow)
  if (await page.evaluate(() => !!window.__debug.forceThrash)) {
    await sleep(600);
    await page.evaluate(() => { window.__debug.actorSlow(0.3, 4000); window.__debug.forceThrash(); });
    for (let i = 0; i < 8; i++) { const ms = await shot('fxslow'); await sleep(Math.max(0, 140 - ms)); }
    await page.evaluate(() => window.__debug.actorSlow(1, 0));
  }
  // reeling: frames until landed (cap ~25 s)
  const t0 = Date.now();
  let fsum = 0, fn = 0, dmax = 0;
  while (Date.now() - t0 < 25000) {
    const s = await st();
    if (s.phase !== 'reeling') break;
    fsum += s.fps; fn++; dmax = Math.max(dmax, s.draws);
    const ms = await shot(s.thrash ? 'thrash' : 'reel');
    await sleep(Math.max(0, 140 - ms));
  }
  log(`[${name}] reeling perf: avg fps ${(fsum / Math.max(1, fn)).toFixed(1)} max draws ${dmax}`);
  // landing + payoff
  for (let i = 0; i < 14; i++) { const ms = await shot('landed'); await sleep(Math.max(0, 140 - ms)); }
  await sleep(1200);
  await shot('payoff');
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
