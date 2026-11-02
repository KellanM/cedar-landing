// Wind check: node scripts/wind_check.mjs [baseUrl]
// Loads with ?flagtest (a test pennant + bunting near spawn), takes frames over time with wind on,
// and one with wind off, and reports how many pixels change (tree sway / flutter actually moving).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5196/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?flagtest', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
for (let i = 0; i < 8 && (await page.evaluate(() => window.__debug.state.tod)) !== 'sunbreak'; i++) await page.evaluate(() => window.__debug.cycleTOD());
await page.evaluate(() => window.__light.reapply());
await page.addStyleTag({ content: '#compass,#move-hint,#prompt{display:none!important}' });
const views = { flag: null, forest: { at: [8, 3], look: [-27.8, -19.2] } };
for (const [name, v] of Object.entries(views)) {
  if (v) await page.evaluate(([x, z, y]) => window.__debug.teleport(x, z, y), [v.at[0], v.at[1], Math.atan2(-(v.look[0] - v.at[0]), -(v.look[1] - v.at[1]))]);
  else { // face the test flag (spawn - (3, 6)), from 10 m away
    const b = await page.evaluate(() => window.__debug.state.boat);
    await page.evaluate(([x, z]) => window.__debug.teleport(x + 2, z + 6, Math.atan2(5, 12)), [b.x, b.z]);
  }
  await page.evaluate(() => window.__light.wind(true, true));
  await sleep(800);
  const frames = [];
  for (let i = 0; i < 3; i++) { frames.push(await page.screenshot({ path: `${OUT}/wind_${name}_${i}.png` })); await sleep(450); }
  await page.evaluate(() => window.__light.wind(false, true));
  await sleep(500);
  const off1 = await page.screenshot({ path: `${OUT}/wind_${name}_off0.png` });
  await sleep(450);
  const off2 = await page.screenshot({ path: `${OUT}/wind_${name}_off1.png` });
  const diff = (a, b) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n; };
  console.log(`${name}: png byte diff wind-on frames ${diff(frames[0], frames[1])}, ${diff(frames[1], frames[2])}; wind-off frames ${diff(off1, off2)}`);
}
console.log('state', JSON.stringify(await page.evaluate(() => window.__light.state)));
console.log('console errors:', errors.length, errors.slice(0, 5).join(' | '));
await browser.close();
