// Walk the village canoe float and its gangway at high and low water (the gangway hinges at the pier).
// node scripts/tide2_gangway.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5232/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
const D = (f, a) => page.evaluate(f, a);
await D(() => { const d = window.__debug; d.markRevealSeen(); d.mist(0.22); d.ui.quiet?.(); d.rain?.(0); d.storm?.(0); d.setClock(14); });
let fail = 0;
await D(() => window.__debug.tide(0));
await D(() => window.__debug.teleport(38, 108));
await sleep(1000);
for (let k = 0; k < 3 && (await D(() => window.__debug.state)).foot.mode !== 'foot'; k++) { await D(() => window.__debug.stepAshore()); await sleep(1600); }
const walk = async (x, z) => {
  await D(([x, z]) => window.__debug.footPathTo(x, z), [x, z]);
  const t0 = Date.now();
  for (;;) { await sleep(150); const s = await D(() => window.__debug.state); if (!s.foot.autoWalk || Date.now() - t0 > 15000) break; }
  await D(() => window.__debug.footWalkTo(null));
  return (await D(() => window.__debug.state)).foot;
};
for (const L of [0, -1.72]) {
  // stand on the float, then the tide (pinned) drops with you aboard
  await D(() => window.__debug.footTeleport(33.6, 113.6, 1.5));
  await D((L) => window.__debug.tide(L), L);
  await sleep(800);
  const f0 = (await D(() => window.__debug.state)).foot;
  // short legs: the debug path planner only probes ±0.8 m around where it starts
  for (const x of [32.6, 31.8, 31, 30.2]) await walk(x, 114.3);
  const up = await walk(29.2, 114.3);
  await D((L) => window.__debug.cam({ pos: [38, 5, 120], target: [31, L + 0.6, 114], fov: 45 }), L);
  await sleep(500);
  await page.screenshot({ path: `screenshots/tide2_gangway_${L}.png` });
  await D(() => window.__debug.cam(null));
  for (const x of [30.2, 31, 31.8, 32.6]) await walk(x, 114.3);
  const down = await walk(33.6, 113.6);
  const ok = f0.mode === 'foot' && Math.abs(up.feet.x - 29.2) < 1.5 && up.feet.y > f0.feet.y + (L < -1 ? 0.8 : 0.3) && Math.abs(down.feet.y - f0.feet.y) < 0.15;
  if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', `tide ${L}: on float y ${f0.feet.y.toFixed(2)} (mode ${f0.mode}), up the gangway → (${up.feet.x.toFixed(1)}, ${up.feet.y.toFixed(2)}, ${up.feet.z.toFixed(1)}), back down y ${down.feet.y.toFixed(2)}`);
}
console.log('errors', errs.length, errs.slice(0, 3));
console.log(fail || errs.length ? 'GANGWAY: FAIL' : 'GANGWAY: ALL PASS');
await browser.close();
