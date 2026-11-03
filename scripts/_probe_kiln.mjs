// one-off: map walkable ground on Kiln Point (opening layout)
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
function findChrome() { const root = path.join(os.homedir(), 'AppData/Local/ms-playwright'); for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) { const e = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(e)) return e; } }
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 600, height: 600 } })).newPage();
await page.goto('http://localhost:5244/?debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const D = window.__debug; const rows = [];
  for (let z = -24; z <= 30; z += 2) { let row = String(z).padStart(4) + ' ';
    for (let x = -26; x <= 28; x += 2) { const g = D.footProbe(x, z, 30, 40, 60); row += !g ? '   .' : String(Math.round(g.y * 10) / 10).padStart(4).slice(-4); }
    rows.push(row); }
  return rows;
});
console.log('x from -26 step 2'); console.log(out.join(String.fromCharCode(10)));
await browser.close();
