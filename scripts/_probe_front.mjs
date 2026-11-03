// one-off: obstacles on the front beach (push-out walls) at beach level, 0.5 m
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
function findChrome() { const root = path.join(os.homedir(), 'AppData/Local/ms-playwright'); for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) { const e = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(e)) return e; } }
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
await page.goto('http://localhost:5254/?debug&opening', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await page.waitForTimeout(2500);
const rows = await page.evaluate(() => {
  const D = window.__debug; const out = [];
  for (let z = -6; z <= 9; z += 0.5) { let r = String(z).padStart(5) + ' ';
    for (let x = 9; x <= 19; x += 0.5) {
      const g = D.footProbe(x, z, 0.4, 0.45, 0.6);
      if (!g) { r += ' '; continue; }
      const push = D.footPush(x, z, g.y);
      r += push > 0.1 ? '#' : g.y > 0.45 ? '^' : g.y < 0.15 ? '~' : '.';
    } out.push(r); }
  return out; });
console.log('x 9..19 step .5; # wall/obstacle, ^ raised (>0.45), . beach, ~ wet'); console.log(rows.join(String.fromCharCode(10)));
await browser.close();
