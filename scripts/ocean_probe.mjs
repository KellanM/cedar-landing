// Ocean pass 2 probe: node scripts/ocean_probe.mjs outDir seaState(0..10) [chase|side|low] [smooth|faceted] [viewport=desktop|phone]   (BASE env = game url)
// 8 frames ~0.35 s apart, waterAt + swell / rough stats, console errors.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [OUT, STs = '3', VIEW = 'chase', LOOK = 'smooth', VP = 'desktop'] = process.argv.slice(2);
const ST = Number(STs);
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const phone = VP === 'phone';
const page = await (await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })).newPage();
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${process.env.BASE ?? 'http://localhost:5252/cedar-landing/'}?debug&ocean=swell&sea_look=${LOOK}`);
await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.setClock?.(11); });
await page.evaluate((s) => { window.__debug.storm(s >= 5 ? 1 : 0); window.__debug.rain(s >= 5 ? 1 : s >= 3.5 ? 0.6 : 0); window.__debug.weatherSnap(false); window.__debug.teleport(135, 215, Math.PI); window.__debug.seaState(s); window.__debug.swell(s); }, ST);
await new Promise((r) => setTimeout(r, 2500));
if (VIEW !== 'chase') await page.evaluate((v) => { const p = window.__debug.state.boat ?? { x: 135, z: 215 }; window.__debug.cam(v === 'side' ? { pos: [p.x + 16, 2.6, p.z + 5], target: [p.x, 0.3, p.z], fov: 45 } : { pos: [p.x + 30, 7, p.z + 30], target: [p.x - 20, 0, p.z - 20], fov: 50 }); }, VIEW);
for (let i = 0; i < 8; i++) { await page.screenshot({ path: `${OUT}/f${i}.jpg`, type: 'jpeg', quality: 88 }); await new Promise((r) => setTimeout(r, 350)); }
console.log(JSON.stringify(await page.evaluate(() => ({ sw: window.__debug.swell(), rough: window.__debug.roughStats(), w: window.__debug.waterAt(135, 215) }))));
console.log('errors', errs.length, errs.slice(0, 4).join(' | '));
await browser.close();
