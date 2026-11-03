// Tide-fall GIF (phone): the clock runs from high water toward the big low at a tide-pool bench.
// node scripts/tide_gif.mjs [baseUrl] [site=4] [from=8.2] [to=15.4] [frames=36]  → screenshots/tide_fall_*.png + tide_fall.gif
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:5224/cedar-landing/';
const SITE = Number(process.argv[3] ?? 4), FROM = Number(process.argv[4] ?? 8.2), TO = Number(process.argv[5] ?? 15.4), N = Number(process.argv[6] ?? 36);
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { const D = window.__debug; D.markRevealSeen(); D.mist(0.22); D.ui.quiet?.(); D.ui.clearHints?.(); });
const s = (await page.evaluate(() => window.__debug.tidepoolSites()))[SITE];
const dx = Math.sin(s.a), dz = Math.cos(s.a), px = dz, pz = -dx;
const target = [s.x + dx * 4.5, -0.9, s.z + dz * 4.5];
const pos = [s.x + dx * 15 + px * 9, 7.5, s.z + dz * 15 + pz * 9];
await page.evaluate(([b, pos, t]) => { const D = window.__debug; D.teleport(b[0], b[1]); D.cam({ pos, target: t, fov: 52 }); }, [[pos[0] + dx * 20, pos[2] + dz * 20], pos, target]);
const files = [];
for (let i = 0; i < N; i++) {
  const h = FROM + ((TO - FROM) * i) / (N - 1);
  const st = await page.evaluate((h) => { const D = window.__debug; D.setClock(h); return D.tide(); }, h);
  await sleep(i === 0 ? 1500 : 260);
  const f = `screenshots/tide_fall_${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: f });
  files.push(f);
  if (i % 6 === 0) console.log(`frame ${i} ${h.toFixed(2)}h level ${st.y}`);
}
console.log('errors', errs.length, errs.slice(0, 3));
await browser.close();
// GIF via Python/PIL (half size, ~6 fps, hold the last frame)
execFileSync('python', ['-c', `
import sys
from PIL import Image
fs = sys.argv[1:]
ims = [Image.open(f).convert('RGB').resize((390, 844), Image.LANCZOS) for f in fs]
pal = [im.quantize(colors=200, method=Image.Quantize.MEDIANCUT) for im in ims]
pal[0].save('screenshots/tide_fall.gif', save_all=True, append_images=pal[1:], duration=[160]*(len(pal)-1)+[1400], loop=0, optimize=True)
`, ...files]);
console.log('wrote screenshots/tide_fall.gif');
