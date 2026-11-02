// Hotspot GPU cost (hotspot study): node scripts/hotspot_perf.mjs [baseUrl] [hotspot] [dist]
// Phone profile (390x844 @3x). ms per synchronous render of the chase view parked at the spot, with the
// hotspot group shown and hidden (when __debug.hotspotObj exists), plus fps / draw calls.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5210/cedar-landing/';
const HS = process.argv[3] ?? 'LIFE_HS02';
const DIST = +(process.argv[4] ?? 9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, dir, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
for (const [label, hour, mist] of [['day', 11, 0], ['fog', 11, 1], ['night', 23, 0]]) {
  await page.evaluate(([h, m, hs, d]) => { window.__debug.setClock(h); window.__debug.mist(m); window.__debug.viewHotspot(hs, d); }, [hour, mist, HS, DIST]);
  await sleep(2500);
  const r = await page.evaluate(() => {
    const d = window.__debug, hs = d.hotspotObj ? d.hotspotObj() : null;
    const runs = [];
    for (let k = 0; k < 3; k++) {
      const on = d.benchFrame(60).full;
      let off = null;
      if (hs) { hs.group.visible = false; off = d.benchFrame(60).full; hs.group.visible = true; }
      runs.push({ on, off });
    }
    return { runs, fps: d.state.fps, draws: d.state.drawCalls, stats: d.hotspotStats ? d.hotspotStats() : null };
  });
  const on = r.runs.map((x) => x.on), off = r.runs.map((x) => x.off).filter((x) => x !== null);
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(`${label}: frame ${med(on).toFixed(2)} ms` + (off.length ? `, without hotspot ${med(off).toFixed(2)} ms, hotspot ${(med(on) - med(off)).toFixed(2)} ms` : '') + `; fps ${r.fps} draws ${r.draws} ${JSON.stringify(r.stats)}`);
}
console.log('console errors:', errors.length);
await ctx.close();
await browser.close();
