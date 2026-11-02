// node scripts/map_shots.mjs [base] [tag] — Log → Map tab comparison states, phone (390×844 @3x) + desktop (1280×800):
//   fresh (new save) · partial (a few areas seen, a few places visited) · revealed (all seen + visited)
//   zoomed (pinch-level zoom on a busy cluster) · dest (compass set) · drawer (phone: Places drawer open)
// Old builds without __debug.ui.map only produce fresh + revealed. Exits non-zero on console errors.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5199/cedar-landing/';
const TAG = process.argv[3] ?? 'new';
const OUT = path.resolve('screenshots/map'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let total = 0;
const info = {};
for (const [name, vp, mob] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const bctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mob ? 3 : 1, isMobile: mob, hasTouch: mob });
  const page = await bctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen?.()); await sleep(1500);
  const shot = async (state) => { await sleep(900); await page.screenshot({ path: `${OUT}/${TAG}_${name}_${state}.png` }); };
  const open = () => page.evaluate(() => { window.__debug.ui.closeLog(); window.__debug.ui.openLog('map'); });
  await open(); await shot('fresh');
  const hasMap = await page.evaluate(() => !!window.__debug.ui.map);
  if (hasMap) {
    const inf = await page.evaluate(() => window.__debug.ui.map.info());
    info[name] = inf;
    // partial: three survey circles around the start and two visited places
    const spawn = await page.evaluate(() => window.__debug.ui.map.info().view);
    const near = inf.items.map((i) => ({ ...i, d: Math.hypot(i.x - spawn.x, i.z - spawn.z) })).sort((a, b) => a.d - b.d);
    const vis = near.slice(0, 4).map((i) => i.key);
    await page.evaluate(([sp, keys]) => {
      const m = window.__debug.ui.map;
      m.revealOnly([[sp.x, sp.z, 120], [sp.x + 110, sp.z + 60, 95], [sp.x - 60, sp.z + 150, 80]]);
      m.resetPlaces(keys); m.setDest(null);
    }, [spawn, vis]);
    await open(); await shot('partial');
  }
  await page.evaluate(() => { window.__debug.ui.closeLog(); window.__debug.ui.revealAll(); window.__debug.ui.visitAll(); window.__debug.ui.map?.setDest(null); });
  await open(); await shot('revealed');
  if (hasMap) {
    const inf = await page.evaluate(() => window.__debug.ui.map.info());
    // zoom in on the densest cluster of places
    const best = inf.items.map((a) => ({ a, n: inf.items.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 120).length })).sort((p, q) => q.n - p.n)[0].a;
    await page.evaluate(([x, z]) => window.__debug.ui.map.view(x, z, 3.2), [best.x, best.z]);
    await shot('zoomed');
    const far = inf.items.filter((i) => i.glyph !== 'pots').sort((p, q) => Math.hypot(q.x - inf.view.x, q.z - inf.view.z) - Math.hypot(p.x - inf.view.x, p.z - inf.view.z))[2];
    await page.evaluate((k) => window.__debug.ui.map.setDest(k), far.key);
    await page.evaluate(([x, z]) => window.__debug.ui.map.view(x, z), [(far.x + inf.view.x) / 2, (far.z + inf.view.z) / 2]);
    await open(); await sleep(300);
    await page.evaluate(([x, z]) => window.__debug.ui.map.view(x, z, 0.7), [(far.x + inf.view.x) / 2, (far.z + inf.view.z) / 2]);
    await shot('dest');
    if (mob) {
      await page.click('#places-tab'); await shot('drawer');
      await page.click('#places-tab');
    }
    info[name + '_after'] = await page.evaluate(() => window.__debug.ui.map.info());
  }
  console.log(name, 'errors', errs.length, errs.slice(0, 3).join(' | '));
  total += errs.length;
  await bctx.close();
}
fs.writeFileSync(`${OUT}/${TAG}_info.json`, JSON.stringify(info, null, 1));
await browser.close();
process.exit(total ? 1 : 0);
