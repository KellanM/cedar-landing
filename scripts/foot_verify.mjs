// On-foot verification: node scripts/foot_verify.mjs [baseUrl]
// Moors at Cedar Landing, steps ashore, walks to the Fish Market (sells), the plaza (talks to an
// NPC), back to the boat, boards. Screenshots → screenshots/foot_*.png, log → foot_log.txt.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5197/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY; // 'phone' | 'desktop'

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
const lines = [];
const log = (...a) => { console.log(...a); lines.push(a.join(' ')); };
const failures = [];
const check = (name, ok, what) => { if (!ok) { failures.push(`[${name}] ${what}`); log(`[${name}] FAIL: ${what}`); } };

const FAKE_SAVE = {
  shells: 0, coolerCap: 2, records: {}, seenReveal: true, reachedLanding: true,
  cooler: [{ speciesId: 'shiner_perch', name: 'Shiner Perch', size: 14.2, stars: 2, price: 9, color: '#b8c4c2', rarity: 'common' }],
  settings: { quality: 'high', autoReel: false, showFps: true, tod: null },
};

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'info' && m.text().includes('onfoot')) log(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), FAKE_SAVE);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(1200);
  const st = () => page.evaluate(() => window.__debug.state);
  const shot = (n) => page.screenshot({ path: `${OUT}/foot_${name}_${n}.png` });
  const walkTo = async (x, z, label, frames = 0) => {
    const np = await page.evaluate(([x, z]) => window.__debug.footPathTo(x, z), [x, z]);
    const t0 = Date.now();
    let f = 0;
    while (Date.now() - t0 < 30000) {
      const s = await st();
      if (!s.foot.autoWalk) break;
      if (f < frames) { await shot(`walk_${String(f).padStart(2, '0')}`); f++; await sleep(120); } else await sleep(100);
    }
    await page.evaluate(() => window.__debug.footWalkTo(null));
    const s = await st();
    log(`[${name}] walk (${np} cells) → ${label} (${x},${z}): feet`, JSON.stringify(s.foot.feet), 'dist', Math.hypot(s.foot.feet.x - x, s.foot.feet.z - z).toFixed(2), 'ctx', s.foot.ctx, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return s;
  };

  // 1) Sail to the Cedar Landing mooring (debug teleport) and stop.
  await page.evaluate(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
  await sleep(1500);
  let s = await st();
  log(`[${name}] at mooring: boat`, s.boat.x.toFixed(1), s.boat.z.toFixed(1), 'interact', s.interact, 'ctx', s.foot.ctx, 'bvh', s.foot.bvhChunks, s.foot.bvhMs + 'ms');
  await shot('01_mooring');

  // 2) Step ashore with real input. Ashore is a context action (hud_flow_study P8): the main
  //    context button when nothing else is in reach, else the second button (Q / tap).
  const actionLabel = await page.textContent('#interact2-label');
  log(`[${name}] buttons: interact`, JSON.stringify(await page.textContent('#interact-label')), 'action', JSON.stringify(actionLabel));
  if (s.interact === 'step_ashore') await page.keyboard.press('e');
  else if (isMobile) await page.tap('#btn-interact2');
  else await page.keyboard.press('q');
  await sleep(300);
  await shot('02_hop');
  await sleep(1100);
  s = await st();
  const landed = s.foot.feet;
  check(name, s.foot.mode === 'foot', 'step ashore');
  log(`[${name}] stepped ashore: mode`, s.foot.mode, 'feet', JSON.stringify(s.foot.feet), 'boat moored', s.boat.moored, 'model', s.foot.model);
  await shot('03_ashore');

  // 3) Real keyboard walking for a moment.
  const k0 = (await st()).foot.feet;
  await page.keyboard.down('w');
  await sleep(1000);
  await page.keyboard.up('w');
  await sleep(200);
  const k1 = (await st()).foot.feet;
  log(`[${name}] keyboard W 1s: moved`, Math.hypot(k1.x - k0.x, k1.z - k0.z).toFixed(2), 'm');

  // 4) Walk across the wharf to the Fish Market and sell.
  s = await walkTo(21.2, 150.9, 'fish market', 10);
  await shot('04_market');
  if (s.foot.ctx && /sell/i.test(s.foot.ctx)) {
    await page.keyboard.press('e');
    await sleep(500);
    await shot('05_sell');
    const before = (await st()).shells;
    await page.click('#sell-all');
    await sleep(300);
    const after = (await st()).shells;
    check(name, after > before, 'sell on foot');
    log(`[${name}] sold on foot: shells`, before, '->', after);
    await page.click('#sell-close');
  } else check(name, false, 'Sell prompt at the market');

  // 5) Plaza: talk to the crier.
  await walkTo(16.3, 147.8, 'market west door');
  await walkTo(21.6, 144.7, 'plaza bridge (west end)');
  s = await walkTo(24.9, 140.4, 'plaza / crier', 14);
  log(`[${name}] at plaza ctx`, JSON.stringify(s.foot.ctx));
  await page.keyboard.press('e');
  await sleep(400);
  s = await st();
  check(name, !!s.foot.bubble, 'NPC talk bubble');
  log(`[${name}] talk: bubble`, JSON.stringify(s.foot.bubble));
  await shot('06_plaza_talk');

  // 6) Orbit the camera a bit (drag on the right side).
  await page.mouse.move(viewport.width * 0.75, viewport.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(viewport.width * 0.6, viewport.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  await shot('07_orbit');

  // 7) Save / restore on foot.
  await sleep(2500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('salish-sea-save-v1') || '{}').onfoot);
  log(`[${name}] saved onfoot`, JSON.stringify(saved));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(1500);
  s = await st();
  check(name, s.foot.mode === 'foot', 'restore on foot after reload');
  log(`[${name}] after reload: mode`, s.foot.mode, 'feet', JSON.stringify(s.foot.feet));
  await shot('08_restored');

  // 8) Walk back to the boat and board.
  // Return the way we came (same legs as the outbound trip, reversed).
  await walkTo(22.6, 144.0, 'plaza bridge (east end)');
  await walkTo(20.2, 145.3, 'wharf junction');
  await walkTo(16.3, 147.8, 'market west door');
  await walkTo(21.2, 150.9, 'fish market');
  s = await walkTo(landed.x, landed.z, 'back to the landing spot');
  log(`[${name}] near boat ctx`, s.foot.ctx);
  await page.keyboard.press('e');
  await sleep(250);
  await shot('09_boarding');
  await sleep(1300);
  s = await st();
  check(name, s.foot.mode === 'boat', 'board');
  log(`[${name}] boarded: mode`, s.foot.mode, 'moored', s.boat.moored, 'saved onfoot', JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('salish-sea-save-v1') || '{}').onfoot)));
  await shot('10_boarded');
  // paddle away
  await page.keyboard.down('w');
  await sleep(1500);
  await page.keyboard.up('w');
  s = await st();
  log(`[${name}] paddled: moored`, s.boat.moored, 'speed', s.boat.speed.toFixed(2), 'fps', s.fps);
  check(name, !errors.length, 'no console errors');
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

if (!ONLY || ONLY === 'phone') await run('phone', { width: 390, height: 844 }, true);
if (!ONLY || ONLY === 'desktop') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
log(failures.length ? `FAILED: ${failures.join('; ')}` : 'PASS');
fs.writeFileSync(`${OUT}/foot_log.txt`, lines.join('\n'));
process.exitCode = failures.length ? 1 : 0;
