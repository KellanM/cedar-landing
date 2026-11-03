// one-off: walkable map of Kiln Point at 1 m (beach level 0.15–1.2 m = 'b', dock/stairs/porch others)
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
function findChrome() { const root = path.join(os.homedir(), 'AppData/Local/ms-playwright'); for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) { const e = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(e)) return e; } }
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
await page.goto('http://localhost:5254/?debug&opening', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await page.waitForTimeout(3000);
const rows = await page.evaluate(() => {
  const D = window.__debug; const out = [];
  for (let z = -22; z <= 30; z += 1) { let r = String(z).padStart(4) + ' ';
    for (let x = -24; x <= 26; x += 1) {
      const lo = D.footProbe(x, z, 0.6, 0.7, 0.6), hi = D.footProbe(x, z, 3.4, 0.6, 0.6);
      r += hi && hi.y > 2.6 ? 'P' : lo ? (lo.y < 0.15 ? '~' : lo.y < 0.45 ? 'b' : 'd') : ' ';
    } out.push(r); }
  return out; });
console.log('x from -24 step 1; b beach (0.15-0.45), d deck/dock (0.45-1.3), P porch level, ~ low');
console.log(rows.join(String.fromCharCode(10)));
await browser.close();
