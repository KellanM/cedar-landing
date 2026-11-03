// Q2 pickup discoverability stills from the normal on-foot camera (phone portrait), at ~10 m and ~25 m.
//   node scripts/pickup_stills.mjs [baseUrl] [--tag=after]   → screenshots/pickups/<tag>_<item>_<d>m.png
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5254/';
const TAG = (process.argv.find((a) => a.startsWith('--tag=')) ?? '--tag=after').slice(6);
const OUT = path.resolve('screenshots/pickups'); fs.mkdirSync(OUT, { recursive: true });
function findChrome() { const root = path.join(os.homedir(), 'AppData/Local/ms-playwright'); for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) { const e = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(e)) return e; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const D = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE + '?debug&opening', { waitUntil: 'load' });
await D(() => localStorage.clear()); await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await sleep(2500);
await D(() => window.__debug.opening.goto(2));
const clear = async () => { for (let i = 0; i < 20; i++) { await sleep(300); if ((await D(() => document.body.dataset.modal ?? null)) === 'dialogue') await page.keyboard.press('Space'); } };
await clear();
const A = await D(() => window.__debug.opening.anchors);
console.log('anchors', JSON.stringify({ rod: A.rod, pool: A.pool, clams: A.clams, fire: A.fire }));
for (const [item, key] of [['rod', 'rod'], ['tin', 'pool'], ['clams', 'clams']]) {
  const [ix, iz] = A[key];
  for (const d of [10, 25]) {
    // stand d metres from the item on beach-level ground, preferring the porch / dock side (z larger)
    const spot = await D(([ix, iz, d]) => {
      const W = window.__debug; let best = null;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2, x = ix + Math.sin(a) * d, z = iz + Math.cos(a) * d;
        const g = W.footProbe(x, z, 0.6, 0.6, 0.6);
        if (!g || g.y < 0.15 || g.y > 1.0) continue;
        const score = Math.cos(a); // toward +z (the dock / porch side)
        if (!best || score > best.score) best = { x, z, y: g.y, score };
      }
      return best;
    }, [ix, iz, d]);
    if (!spot) { console.log('no spot', item, d); continue; }
    await D(([x, z, y]) => window.__debug.footTeleport(x, z, y + 0.4), [spot.x, spot.z, spot.y]);
    await D(([x, z, ix, iz]) => window.__debug.footFace(Math.atan2(-(ix - x), -(iz - z))), [spot.x, spot.z, ix, iz]);
    await sleep(1800); // camera settles behind the walker
    const f = path.join(OUT, `${TAG}_${item}_${d}m.png`);
    await page.screenshot({ path: f });
    console.log('shot', path.basename(f), 'from', spot.x.toFixed(1), spot.z.toFixed(1));
  }
}
await browser.close();
