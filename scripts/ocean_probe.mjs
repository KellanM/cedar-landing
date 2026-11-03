// Ocean experiment: a low side view (or the chase view) of the boat on the swell, 8 frames.
// node scripts/ocean_probe.mjs outDir seaState(0..1) [swell|classic] [side|top]   (BASE env = game url)
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const OUT = process.argv[2]; const ST = Number(process.argv[3] ?? 1); const OC = process.argv[4] ?? 'swell';
const VIEW = process.argv[5] ?? 'side';
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${process.env.BASE ?? "http://localhost:5238/cedar-landing/"}?debug&ocean=${OC}`);
await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.setClock?.(11); });
await page.evaluate((s) => { window.__debug.storm(s > 0.8 ? 1 : 0); window.__debug.rain(s > 0.8 ? 1 : s > 0.3 ? 0.8 : 0); window.__debug.weatherSnap(false); window.__debug.teleport(135, 215, Math.PI); window.__debug.swell(s); }, ST);
await new Promise((r) => setTimeout(r, 1500));
if (VIEW === 'side') await page.evaluate(() => { const b = window.__debug.state.boat ?? { x: 135, z: 215 }; window.__debug.cam({ pos: [b.x + 14, 2.2, b.z + 4], target: [b.x, 0.3, b.z], fov: 40 }); });
for (let i = 0; i < 8; i++) { await page.screenshot({ path: `${OUT}/f${i}.jpg`, type: 'jpeg', quality: 85 }); const w = await page.evaluate(() => window.__debug.waterAt(135, 215)); console.log(i, w.toFixed(3)); await new Promise((r) => setTimeout(r, 350)); }
console.log('errors', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
