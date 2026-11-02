// node scripts/icon_capture.mjs [base] — renders app-icon candidates of the boat with the game's own renderer
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const OUT = path.resolve('screenshots/icon'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE + '?debug'); await page.evaluate(() => { localStorage.clear(); localStorage.setItem('salish-water-tune-v1', JSON.stringify({ windLines: 0 })); }); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.markRevealSeen?.()); await sleep(1500);
await page.addStyleTag({ content: 'body > *:not(#c){visibility:hidden !important} #c{visibility:visible !important}' });
const spots = JSON.parse(process.argv[3] ?? '[[40,120],[-30,95],[70,200]]');
const cams = JSON.parse(process.argv[4] ?? 'null') ?? [
  { tag: 'a', distance: 8.5, pitchDeg: 38, sideDeg: 40, frameAhead: 0 },
  { tag: 'b', distance: 10, pitchDeg: 48, sideDeg: 55, frameAhead: 0 },
  { tag: 'c', distance: 7.5, pitchDeg: 30, sideDeg: 70, frameAhead: 0 },
];
const HOURS = JSON.parse(process.argv[5] ?? '[13.3, 19.6]');
for (const [i, [x, z]] of spots.entries()) {
  for (const hour of HOURS) {
    await page.evaluate(([x, z, h]) => { window.__debug.setClock(h); window.__debug.teleport(x, z, 0.6); }, [x, z, hour]);
    for (const c of cams) {
      await page.evaluate((c) => window.__debug.camTune({ distance: c.distance, pitchDeg: c.pitchDeg, sideDeg: c.sideDeg, frameAhead: c.frameAhead, distSpeed: 0 }), c);
      await page.keyboard.down('w'); await sleep(1800); await page.keyboard.up('w'); await sleep(250);
      await page.screenshot({ path: `${OUT}/v2_${i}_${hour}_${c.tag}.png` });
    }
  }
}
await browser.close();
console.log('done');
