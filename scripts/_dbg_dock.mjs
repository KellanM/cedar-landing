import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
function findChrome() { const root = path.join(os.homedir(), 'AppData/Local/ms-playwright'); for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) { const e = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(e)) return e; } }
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto('http://localhost:5254/?debug&opening', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const D = window.__debug; const rows = [];
  for (let z = 19; z <= 29; z += 0.5) { let row = String(z).padStart(5) + ' ';
    for (let x = 6; x <= 11; x += 0.25) { const g = D.footProbe(x, z, 0.6, 0.45, 1.1); row += !g ? ' ' : g.y > 0.5 ? '#' : g.y > 0.3 ? '+' : '.'; }
    rows.push(row); }
  return { rows, tide: D.tideStats?.() ?? null, dev: D.tide?.() ?? null, foot: D.state.foot };
});
console.log(JSON.stringify(r.tide)?.slice(0, 300)); console.log(JSON.stringify(r.foot));
console.log('x 6..11 step .25 ; # >0.5, + 0.3-0.5, . <0.3'); console.log(r.rows.join(String.fromCharCode(10)));
await browser.close();
