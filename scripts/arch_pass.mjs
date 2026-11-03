// node scripts/arch_pass.mjs [base] [tideLevel] — sail the boat under the welcome arch (bell) at Cedar Landing; it must pass through
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.markRevealSeen?.());
const TIDE = process.argv[3];
if (TIDE !== undefined) console.log('tide pinned', JSON.stringify(await page.evaluate((y) => window.__debug.tide(y), Number(TIDE))));
// arch centre (three) 9.52, 164.53; posts at (6.8,160) and (12.1,169.2) -> pass along the perpendicular (0.866,-0.5)
let fail = 0;
for (const dir of [1, -1]) {
  const px = 0.866 * dir, pz = -0.5 * dir;
  const sx = 9.52 - px * 9, sz = 164.53 - pz * 9;
  const yaw = Math.atan2(-px, -pz);
  await page.evaluate(([x, z, y]) => window.__debug.teleport(x, z, y), [sx, sz, yaw]); await sleep(500);
  await page.keyboard.down('w'); await sleep(3500); await page.keyboard.up('w'); await sleep(300);
  const p = await page.evaluate(() => window.__debug.state.boat ?? null);
  const pos = p ? [p.x ?? p[0], p.z ?? p[2]] : await page.evaluate(() => [window.__debug.state.boatX, window.__debug.state.boatZ]);
  const along = (pos[0] - 9.52) * px + (pos[1] - 164.53) * pz;
  const ok = along > 4; if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', `dir ${dir}: start ${along > -100 ? '' : ''}(${sx.toFixed(1)},${sz.toFixed(1)}) end (${pos.map((v) => (+v).toFixed(1))}) past arch by ${along.toFixed(1)} m`);
}
if (errs.length) { fail++; console.log('errors', errs.slice(0, 3)); }
console.log(fail ? 'ARCH PASS: FAIL' : 'ARCH PASS: ALL PASS');
await browser.close();
