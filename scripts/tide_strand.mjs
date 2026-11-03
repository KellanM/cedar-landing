// Stranding check: park the boat over ground that dries at low water, drop the tide, the boat must end up afloat.
// node scripts/tide_strand.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5224/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.markRevealSeen());
const sites = await page.evaluate(() => window.__debug.tidepoolSites());
let fail = 0;
for (const i of [0, 4, 5, 9]) {
  const s = sites[i];
  const x = s.x + Math.sin(s.a) * 5, z = s.z + Math.cos(s.a) * 5; // over the middle terrace
  const r = await page.evaluate(async ([x, z]) => {
    const D = window.__debug;
    D.tide(0);
    D.teleport(x, z);
    const b0 = { ...D.state.boat };
    D.tide(-1.72); // the water goes out from under it
    await new Promise((r) => setTimeout(r, 4000));
    const b1 = { ...D.state.boat };
    return { b0, b1, ground: D.tideGround(b1.x, b1.z), groundStart: D.tideGround(b0.x, b0.z) };
  }, [x, z]);
  const afloat = r.ground < -1.72 - 0.1 + 1e-3 || r.ground === -99;
  const moved = Math.hypot(r.b1.x - r.b0.x, r.b1.z - r.b0.z);
  if (!afloat) fail++;
  console.log(afloat ? 'PASS' : 'FAIL', `site ${i}: start ground ${r.groundStart.toFixed(2)} → moved ${moved.toFixed(1)} m to ground ${r.ground.toFixed(2)}`);
  await page.screenshot({ path: `screenshots/tide_strand_site${i}.png` });
}
console.log('errors', errs.length, errs.slice(0, 3));
console.log(fail || errs.length ? 'STRAND: FAIL' : 'STRAND: ALL PASS');
await browser.close();
