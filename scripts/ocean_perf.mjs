// Ocean perf (docs/ocean_study.md): node scripts/ocean_perf.mjs [high|low]   (BASE env = game url)
// Phone viewport (390x844 @3), open water, chase view, same page, interleaved twice: Swell at sea state 3,
// Swell at 8 (storm weather), Classic; median of 7 x 90-frame synchronous GPU benches each (whole frame and
// the sea's share), plus CPU: µs per waterHeight(), ms per frame for the cascade passes and rough-sea logic.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const Q = process.argv[2] ?? 'high';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
await page.goto(`${process.env.BASE ?? 'http://localhost:5252/cedar-landing/'}?debug&ocean=swell`);
await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('salish-sea-save-v1', JSON.stringify({ settings: { quality: q } })); }, Q);
await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.teleport(135, 215, Math.PI); });
await new Promise((r) => setTimeout(r, 2500));
const b = () => page.evaluate(() => { const r = []; for (let i = 0; i < 7; i++) r.push(window.__debug.benchFrame(90)); const m = (k) => r.map((x) => x[k]).sort((a, b) => a - b)[3]; return { full: m('full'), sea: +(m('full') - m('noSea')).toFixed(3) }; });
const set = (o, s) => page.evaluate(([o, s]) => { window.__debug.ocean(o); window.__debug.storm(s >= 8 ? 1 : 0); window.__debug.rain(s >= 8 ? 1 : 0); window.__debug.weatherSnap(false); window.__debug.seaState(s); window.__debug.swell(s); }, [o, s]);
const out = {};
for (let rep = 0; rep < 2; rep++) {
  for (const [name, o, s] of [['s3', 'swell', 3], ['s8', 'swell', 8], ['classic', 'classic', 3]]) {
    await set(o, s); await new Promise((r) => setTimeout(r, 1500));
    out[name + rep] = await b();
    if (o === 'swell' && rep === 1) out[name + 'cpu'] = await page.evaluate(() => ({ ...window.__debug.swellCpu(4000), ...window.__debug.roughStats() }));
  }
}
console.log(Q, JSON.stringify(out));
await browser.close();
