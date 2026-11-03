// Log captures: the real tide table (Errands → Wallet & weather) and Shore notes (Pages), phone + desktop.
// node scripts/tide_log_shots.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5224/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [tag, vp] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 800 } }]]) {
  const page = await (await browser.newContext(vp)).newPage();
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  const turns = await page.evaluate(() => { const D = window.__debug; D.markRevealSeen(); D.setClock(11.2); D.tide(null); return D.tideTurns(); });
  console.log(tag, 'turns today', JSON.stringify(turns));
  // look into a few pools (high, mid, low with the sunflower if any) so the shore notes have entries
  await page.evaluate(() => { const D = window.__debug; D.tide(-1.72); for (const id of ['5_0', '5_1', '5_3']) D.tidepoolLook(id); D.tide(null); D.closeModals(); });
  for (let i = 0; i < 6 && await page.isVisible('.dialogue:not(.hidden) .strip'); i++) { await page.click('.dialogue .strip'); await sleep(250); }
  await sleep(600);
  await page.screenshot({ path: `screenshots/tide_hud_${tag}.png`, clip: tag === 'phone' ? { x: 0, y: 0, width: 390, height: 120 } : { x: 0, y: 0, width: 1280, height: 120 } });
  await page.evaluate(() => window.__debug.ui.openLog('errands'));
  await sleep(700);
  await page.screenshot({ path: `screenshots/tide_log_table_${tag}.png` });
  if (tag === 'phone') { await page.evaluate(() => document.querySelector('#logbook')?.classList.add('detail-open')); await sleep(400); await page.screenshot({ path: `screenshots/tide_log_table_${tag}_detail.png` }); }
  await page.evaluate(() => window.__debug.ui.openLog('pages'));
  await sleep(400);
  await page.click('[data-pg="99"]');
  await sleep(700);
  await page.screenshot({ path: `screenshots/tide_log_shore_${tag}.png` });
  await page.close();
}
console.log('errors', errs.length, errs.slice(0, 3));
await browser.close();
