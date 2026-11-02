// node scripts/skipper_glitch.mjs [base] — reel-phase skipper with/without procedural layers; logs yaw + bone quats
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); });
const hs = (await page.evaluate(() => window.__debug.hotspots()))[0];
await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hs); await sleep(2500);
await page.evaluate(() => window.__debug.action()); await sleep(2000);
await page.evaluate(() => window.__debug.forceBite()); await sleep(300);
await page.evaluate(() => window.__debug.action()); await sleep(300);
await page.evaluate(() => window.__debug.setAutoReel(true));
const probe = () => page.evaluate(() => {
  const s = window.__debug.skipperObj();
  const r = (q) => q ? [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(2)).join(',') : '-';
  return { yaw: +s.yaw.toFixed(2), tyaw: +s.targetYaw.toFixed(2), crank: +s.crank.toFixed(2), strain: +s.strain.toFixed(2), pose: s.current,
    chest: r(s.bones.chest?.quaternion), head: r(s.bones.head?.quaternion), neck: r(s.bones.neck?.quaternion), hips: r(s.bones.hips?.quaternion) };
});
for (const mode of ['normal', 'noproc', 'noaim', 'none']) {
  await page.evaluate((m) => { const s = window.__debug.skipperObj(); s.dbgNoProc = m === 'noproc' || m === 'none'; s.dbgNoAim = m === 'noaim' || m === 'none'; }, mode);
  for (let i = 0; i < 4; i++) {
    await sleep(350);
    console.log(mode, i, JSON.stringify(await probe()));
    await page.screenshot({ path: `${OUT}/glitch_${mode}_${i}.png` });
  }
}
await browser.close();
