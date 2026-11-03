// On foot to a tide pool at low tide and look in.
// node scripts/tidepool_foot.mjs [baseUrl] [site=4] [phone|desktop]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5224/';
const SITE = Number(process.argv[3] ?? 4);
const PHONE = (process.argv[4] ?? 'phone') === 'phone';
const OUT = path.resolve('screenshots');
function findChrome() {
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
  return path.join(root, d, 'chrome-win64', 'chrome.exe');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
const D = (f, a) => page.evaluate(f, a);
await D(() => { const d = window.__debug; d.markRevealSeen(); d.mist(0.25); d.setClock(15.3); d.tide(-1.7); });
const tag = PHONE ? 'phone' : 'desktop';
const site = (await D(() => window.__debug.tidepoolSites()))[SITE];
const pools = (await D(() => window.__debug.tidepools())).filter((p) => p.id.startsWith(`${SITE}_`));
const dx = Math.sin(site.a), dz = Math.cos(site.a), px = dz, pz = -dx;
console.log('site', JSON.stringify(site), 'pools', pools.map((p) => `${p.id}@${p.h}`).join(' '));
// boat alongside, step ashore, then stand on the beach behind the bench
await D(([x, z]) => window.__debug.teleport(x, z), [site.x + px * 9 + dx * 3, site.z + pz * 9 + dz * 3]);
await sleep(1200);
await D(() => window.__debug.stepAshore());
await sleep(1600);
let st = await D(() => window.__debug.state);
console.log('ashore', st.foot.mode, JSON.stringify(st.foot.feet));
const tp = await D(([x, z, y]) => window.__debug.footTeleport(x, z, y), [site.x - dx * 1.6, site.z - dz * 1.6, site.gy + 1]);
console.log('on beach', JSON.stringify(tp?.feet ?? tp));
await sleep(500);
let ok = 0;
for (const p of pools) {
  const gx = p.x - px * (p.r + 0.55), gz = p.z - pz * (p.r + 0.55);
  const path_ = await D(([x, z]) => window.__debug.footPathTo(x, z), [gx, gz]);
  const t0 = Date.now();
  for (;;) {
    await sleep(150);
    st = await D(() => window.__debug.state);
    if (!st.foot.autoWalk || Date.now() - t0 > 20000) break;
  }
  await D(() => window.__debug.footWalkTo(null));
  st = await D(() => window.__debug.state);
  const d = Math.hypot(st.foot.feet.x - gx, st.foot.feet.z - gz);
  console.log(`pool ${p.id} (${p.zone}, h ${p.h}): path ${path_?.length ?? 0} pts, feet ${JSON.stringify(st.foot.feet)} dist ${d.toFixed(2)} ctx ${st.interact}`);
  if (/tidepool/.test(st.interact ?? '')) ok++;
  // close-up: camera behind the walker looking down into the pool
  await D(([x, z]) => window.__debug.footFace(Math.atan2(-(x - window.__debug.state.foot.feet.x), -(z - window.__debug.state.foot.feet.z))), [p.x, p.z]);
  await D(([p, f]) => { const ux = p.x - f.x, uz = p.z - f.z, l = Math.hypot(ux, uz) || 1; window.__debug.cam({ pos: [p.x + ux / l * (p.r + 1.5) + uz / l * 0.9, p.h + 1.7, p.z + uz / l * (p.r + 1.5) - ux / l * 0.9], target: [p.x, p.h, p.z], fov: 50 }); }, [p, st.foot.feet]);
  await sleep(700);
  await page.screenshot({ path: `${OUT}/tidepool_foot_${tag}_${p.id}.png` });
  if (/tidepool/.test(st.interact ?? '')) {
    await D(() => window.__debug.cam(null));
    await sleep(300);
    await page.screenshot({ path: `${OUT}/tidepool_prompt_${tag}_${p.id}.png` });
    await D(() => window.__debug.interact());
    await sleep(2600);
    await page.screenshot({ path: `${OUT}/tidepool_look_${tag}_${p.id}.png` });
    for (let i = 0; i < 4 && await page.isVisible('.dialogue:not(.hidden) .strip'); i++) { await page.click('.dialogue .strip'); await sleep(350); }
  }
}
st = await D(() => window.__debug.state);
console.log('pools looked into:', ok, '/', pools.length, 'shells', st.shells, 'fps', st.fps);
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
