// Fish shadow: yaw-only (never tipped), sits on the surface at any tide / swell, through approach, miss, reel.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, s) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`, s === undefined ? '' : JSON.stringify(s)); if (!ok) fails++; };
for (const [label, tide, sea] of [['high tide, calm', 0, 1], ['low tide, rough', -1.5, 6]]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE + '?debug&sea_state=' + sea); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
  await p.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); window.__debug.closeup?.('off'); });
  const hs = (await p.evaluate(() => window.__debug.hotspots()))[0];
  await p.evaluate((t) => window.__debug.tide(t), tide);
  await p.evaluate((h) => window.__debug.viewHotspot(h, 7), hs); await sleep(1500);
  await p.evaluate(() => window.__debug.action()); await sleep(1200);
  let worstTilt = 0, worstGap = 0, samples = 0, mouthWorst = 0, mouthN = 0;
  const sample = async () => { const s = await p.evaluate(() => window.__debug.shadowNose()); if (!s || s.phase === 'casting' || s.phase === 'idle' || s.phase === 'landed') return; samples++; worstTilt = Math.max(worstTilt, Math.abs(s.tiltX), Math.abs(s.tiltZ)); worstGap = Math.max(worstGap, Math.abs(s.aboveWater - 0.03)); if (s.phase === 'reeling') { mouthN++; mouthWorst = Math.max(mouthWorst, Math.abs(s.gap)); } };
  for (let i = 0; i < 20; i++) { await sample(); await sleep(100); }      // approach
  await p.evaluate(() => window.__debug.forceBite()); await sleep(2600); // let the bite time out → miss
  for (let i = 0; i < 15; i++) { await sample(); await sleep(100); }      // missed: swims off
  await p.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 30000 }).catch(() => {});
  await p.evaluate(() => { window.__debug.action(); window.__debug.setAutoReel(true); });
  for (let i = 0; i < 25; i++) { await sample(); await sleep(120); }      // reeling
  await p.screenshot({ path: `screenshots/shadow_${tide < 0 ? 'low' : 'high'}.png` });
  check(`${label}: shadow sampled through approach / miss / reel`, samples >= 20, { samples });
  check(`${label}: shadow never tipped (yaw only)`, worstTilt < 1e-3, { worstTilt, samples });
  check(`${label}: shadow sits on the surface`, worstGap < 0.02, { worstGap });
  check(`${label}: in the fight the float is at the fish's mouth`, mouthN > 5 && mouthWorst < 0.15, { mouthWorst: +mouthWorst.toFixed(3), mouthN });
  await ctx.close();
}
console.log('console errors:', errors.length, errors.slice(0, 2).join(' | '));
console.log(fails || errors.length ? 'SHADOW: FAIL' : 'SHADOW: ALL PASS');
await b.close();
