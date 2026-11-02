// Sea mist levels: node scripts/mist_shots.mjs <base>  → screenshots/mist_<h>_<m>.png + mist_sheet via python
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errors = [];
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(BASE + '?debug'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await p.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.camTune({ distance: 34, pitchDeg: 14, sideDeg: 160, frameAhead: 30 }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const h of [10.67, 13.33, 19.83]) for (const m of [0.22, 0.5, 0.85]) {
  console.log(h, m, JSON.stringify(await p.evaluate(([h, m]) => { window.__debug.setClock(h); return window.__debug.mist(m); }, [h, m])));
  await sleep(1800);
  await p.screenshot({ path: `screenshots/mist_${h}_${m}.png` });
}
console.log('curve day 0..2:', JSON.stringify(await p.evaluate(() => { window.__debug.mist(null); const o = []; for (const d of [0, 1, 2]) for (const h of [6, 12, 18]) { window.__debug.setClock(h); o.push(window.__debug.mist(undefined, d).mist); } return o; })));
console.log('console errors:', errors.length, errors.slice(0, 3).join(' | '));
await b.close();
