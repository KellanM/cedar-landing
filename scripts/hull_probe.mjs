// Ocean pass 3 probe: node scripts/hull_probe.mjs outDir seaState [underway|forced|slowmo] [phone|desktop] [side|chase]  (BASE env)
// underway: full throttle for a while, frames + hull stats (landings / slams / air time); forced: __debug.splash(k) at
// the boat and a fast frame burst; slowmo: actorSlow + a forced landing, frames every ~60 ms.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [OUT, STs = '8', MODE = 'underway', VP = 'desktop', VIEW = 'chase'] = process.argv.slice(2);
const ST = Number(STs);
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const phone = VP === 'phone';
const page = await (await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })).newPage();
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${process.env.BASE ?? 'http://localhost:5260/cedar-landing/'}?debug&ocean=swell`);
await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.setClock?.(11); window.__debug.ui?.dismissHints?.(); });
await page.evaluate((s) => { window.__debug.storm(s >= 8 ? 1 : 0); window.__debug.rain(s >= 8 ? 0.8 : 0); window.__debug.weatherSnap(false); window.__debug.teleport(135, 215, Math.PI); window.__debug.seaState(s); window.__debug.swell(s); }, ST);
await sleep(2000);
const side = async () => { if (VIEW === 'side') await page.evaluate(() => { const b = window.__debug.state.boat ?? { x: 135, z: 215 }; window.__debug.cam({ pos: [b.x + 14, 3.2, b.z + 4], target: [b.x, 0.5, b.z], fov: 45 }); }); };
const has = await page.evaluate(() => !!window.__debug.hullStats);
if (MODE === 'underway') {
  await page.keyboard.down('w');
  await sleep(1500);
  for (let i = 0; i < 24; i++) { await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 85 }); await sleep(60); }
  await sleep(4000);
  await page.keyboard.up('w');
} else if (MODE === 'forced') {
  await side();
  if (has) await page.evaluate(() => window.__debug.splash(0.8));
  for (let i = 0; i < 12; i++) { await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 88 }); }
} else {
  await side();
  await page.evaluate(() => window.__debug.actorSlow?.(0.2, 6000));
  if (has) await page.evaluate(() => window.__debug.splash(0.9));
  for (let i = 0; i < 16; i++) { await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 88 }); await sleep(40); }
}
console.log(JSON.stringify(has ? await page.evaluate(() => window.__debug.hullStats()) : { before: true }));
console.log('errors', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
