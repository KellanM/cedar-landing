// Headless smoke test: node scripts/smoke.mjs [baseUrl]
// Loads the game at phone + desktop viewports, drives the boat, completes a fishing minigame,
// sells at the Fish Market and writes screenshots to ./screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5190/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const results = [];
fs.writeFileSync(`${OUT}/smoke_log.txt`, '');
const log = (...a) => { console.log(...a); results.push(a.join(' ')); fs.appendFileSync(`${OUT}/smoke_log.txt`, a.join(' ') + '\n'); };

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
  await sleep(1500);
  const st = () => page.evaluate(() => window.__debug.state);
  log(`[${name}] world`, JSON.stringify((({ world, worldVersion, chunks, instances, tod }) => ({ world, worldVersion, chunks, instances, tod }))(await st())));
  await page.screenshot({ path: `${OUT}/${name}_01_spawn.png` });

  // Drive forward with the keyboard
  const before = (await st()).boat;
  await page.keyboard.down('w');
  await sleep(3000);
  await page.keyboard.down('a');
  await sleep(1200);
  await page.keyboard.up('a');
  await sleep(800);
  const mid = await st();
  await page.keyboard.up('w');
  log(`[${name}] boat moved`, before.x.toFixed(1), before.z.toFixed(1), '->', mid.boat.x.toFixed(1), mid.boat.z.toFixed(1), 'speed', mid.boat.speed.toFixed(2), `fps ${mid.fps}`);
  await page.screenshot({ path: `${OUT}/${name}_02_moving.png` });

  // Fishing: go to the first hotspot, cast, hook, reel with Space held (real input path)
  const hs = (await page.evaluate(() => window.__debug.hotspots()))[0];
  await page.evaluate((h) => window.__debug.teleportTo(h, 4), hs);
  await sleep(600);
  log(`[${name}] at hotspot`, hs, (await st()).nearestHotspotDist?.toFixed(1));
  await page.keyboard.press('Space');
  await sleep(1200);
  log(`[${name}] phase after cast`, (await st()).phase);
  await page.screenshot({ path: `${OUT}/${name}_03_waiting.png` });
  // wait for the bite naturally (≤ 10 s) then hook it
  const t0 = Date.now();
  while ((await st()).phase !== 'bite' && Date.now() - t0 < 12000) await sleep(50);
  log(`[${name}] bite after`, ((Date.now() - t0) / 1000).toFixed(1), 's, phase', (await st()).phase);
  await page.keyboard.down('Space');
  await sleep(100);
  log(`[${name}] phase after hook`, (await st()).phase);
  // reel: hold, release when tension high / thrashing
  let shot = false;
  const t1 = Date.now();
  let held = true;
  while ((await st()).phase === 'reeling' && Date.now() - t1 < 40000) {
    const s = await st();
    const want = s.tension < 0.6;
    if (want !== held) { if (want) await page.keyboard.down('Space'); else await page.keyboard.up('Space'); held = want; }
    if (!shot && Date.now() - t1 > 1500) { await page.screenshot({ path: `${OUT}/${name}_04_reeling.png` }); shot = true; }
    await sleep(40);
  }
  await page.keyboard.up('Space');
  const landed = await st();
  log(`[${name}] reel finished in`, ((Date.now() - t1) / 1000).toFixed(1), 's, phase', landed.phase, 'species', landed.species);
  await sleep(400);
  await page.screenshot({ path: `${OUT}/${name}_05_catchcard.png` });
  await page.click('#card-keep');
  await sleep(300);
  log(`[${name}] cooler`, JSON.stringify((await st()).cooler));

  // Second fish via auto-reel assist (+ forceBite to keep it quick)
  await page.evaluate(() => window.__debug.setAutoReel(true));
  await page.evaluate(() => window.__debug.action());
  await sleep(1000);
  await page.evaluate(() => window.__debug.forceBite());
  const t2 = Date.now();
  while ((await st()).phase !== 'landed' && Date.now() - t2 < 40000) await sleep(100);
  await sleep(300);
  await page.evaluate(() => window.__debug.keep());
  log(`[${name}] auto-reel catch in`, ((Date.now() - t2) / 1000).toFixed(1), 's; cooler', JSON.stringify((await st()).cooler));

  // Sell at the Fish Market
  const ok = await page.evaluate(() => window.__debug.teleportTo('Interact_SellFish', 0));
  await sleep(800);
  const s3 = await st();
  log(`[${name}] at market`, ok, 'interact:', s3.interact);
  await page.screenshot({ path: `${OUT}/${name}_06_market.png` });
  await page.keyboard.press('e');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${name}_07_sellpanel.png` });
  const shellsBefore = (await st()).shells;
  await page.click('#sell-all');
  await sleep(300);
  const after = await st();
  log(`[${name}] sold: shells`, shellsBefore, '->', after.shells, 'cooler', after.cooler.length);
  await page.click('#sell-close');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('salish-sea-save-v1') || '{}').shells);
  log(`[${name}] localStorage shells`, saved);

  // Reveal shot + time of day presets
  await page.evaluate(() => { localStorage.clear(); });
  for (let i = 0; i < 5; i++) {
    const tod = (await st()).tod;
    await page.screenshot({ path: `${OUT}/${name}_08_tod_${i}_${tod}.png` });
    await page.evaluate(() => window.__debug.cycleTOD());
    await sleep(300);
  }
  const perf = await st();
  log(`[${name}] perf: fps ${perf.fps}, draws ${perf.drawCalls}, tris ${perf.tris}`);
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

await run('phone', { width: 390, height: 844 }, true);
await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
fs.writeFileSync(`${OUT}/smoke_log.txt`, results.join('\n'));
