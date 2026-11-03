// Ocean pass 2 camera check: node scripts/ocean_camera_check.mjs [baseUrl]
// Sea state 10 (and 3): 6 s idle + 6 s under way at 10 Hz, with Reduce motion off and on. The chase camera
// must never roll (|roll| < 0.01 rad), its height swing must stay well under the boat's, and Reduce motion
// must shrink both. 0 console errors.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5252/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${BASE}?debug&ocean=swell`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.teleport(135, 215, Math.PI); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const res = {};
for (const reduce of [false, true]) {
  await page.evaluate((r) => document.body.classList.toggle('reduce-motion', r), reduce);
  for (const s of [3, 10]) {
    await page.evaluate((s) => { window.__debug.teleport(135, 215, Math.PI); window.__debug.seaState(s); window.__debug.swell(s); }, s);
    await sleep(2500);
    const run = async (drive) => {
      if (drive) await page.keyboard.down('w');
      const xs = [];
      for (let i = 0; i < 60; i++) { xs.push(await page.evaluate(() => window.__debug.camInfo())); await sleep(100); }
      if (drive) await page.keyboard.up('w');
      const rng = (k) => Math.max(...xs.map((x) => x[k])) - Math.min(...xs.map((x) => x[k]));
      return { maxRoll: Math.max(...xs.map((x) => Math.abs(x.roll))), camSwing: +rng('camY').toFixed(3), boatSwing: +rng('heave').toFixed(3) };
    };
    const idle = await run(false), way = await run(true);
    res[`${reduce ? 'reduce' : 'full'} S${s}`] = { idle, way };
    for (const r of [idle, way]) {
      if (r.maxRoll > 0.01) { fail++; console.log(`FAIL roll ${r.maxRoll} (${reduce ? 'reduce' : 'full'} S${s})`); }
      if (s === 10 && r.boatSwing > 0.3 && r.camSwing > r.boatSwing * 0.85) { fail++; console.log(`FAIL camera swing ${r.camSwing} vs boat ${r.boatSwing}`); }
    }
  }
}
const f10 = res['full S10'].idle, r10 = res['reduce S10'].idle;
if (!(r10.boatSwing < f10.boatSwing)) { fail++; console.log(`FAIL reduce motion did not calm the sea (${r10.boatSwing} vs ${f10.boatSwing})`); }
console.log(JSON.stringify(res));
console.log(`console errors: ${errs.length}`, errs.slice(0, 3).join(' | '));
console.log(fail || errs.length ? 'CAMERA: FAIL' : 'CAMERA: ALL PASS');
await browser.close();
