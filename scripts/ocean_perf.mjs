// Ocean perf (docs/ocean_study.md): node scripts/ocean_perf.mjs [high|low]   (BASE env = game url)
// Phone viewport (390x844 @3), storm, open water, chase view. Same page, interleaved, twice: Swell / Swell without
// whitecaps / Swell flat (state 0) / Classic, median of 7 x 90-frame synchronous GPU benches each, plus µs per waterHeight().
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const Q = process.argv[2] ?? 'high';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
await page.goto(`${process.env.BASE ?? 'http://localhost:5238/cedar-landing/'}?debug&ocean=swell`);
await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('salish-sea-save-v1', JSON.stringify({ settings: { quality: q } })); }, Q);
await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.storm(1); window.__debug.weatherSnap(false); window.__debug.teleport(135, 215, Math.PI); window.__debug.swellSnap(); });
await new Promise((r) => setTimeout(r, 2500));
const b = () => page.evaluate(() => { const r = []; for (let i = 0; i < 7; i++) r.push(window.__debug.benchFrame(90)); const m = (k) => r.map((x) => x[k]).sort((a, b) => a - b)[3]; return { full: m('full'), sea: +(m('full') - m('noSea')).toFixed(3) }; });
const out = {};
for (let rep = 0; rep < 2; rep++) {
  await page.evaluate(() => window.__debug.ocean('swell')); await new Promise((r) => setTimeout(r, 800));
  out['swell' + rep] = await b();
  await page.evaluate(() => { const t = window.__debug.swellTune; t._a = t.foamCalm; t._b = t.foamStorm; t.foamCalm = t.foamStorm = 99; window.__debug.swellSnap(); }); await new Promise((r) => setTimeout(r, 500));
  out['nofoam' + rep] = await b();
  await page.evaluate(() => { const t = window.__debug.swellTune; t.foamCalm = t._a; t.foamStorm = t._b; window.__debug.swell(0); }); await new Promise((r) => setTimeout(r, 500));
  out['flat' + rep] = await b();
  await page.evaluate(() => { window.__debug.swell(null); window.__debug.swellSnap(); window.__debug.ocean('classic'); }); await new Promise((r) => setTimeout(r, 800));
  out['classic' + rep] = await b();
}
out.cpu = await page.evaluate(() => window.__debug.swellCpu());
console.log(Q, JSON.stringify(out));
await browser.close();
