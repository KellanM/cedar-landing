// Marine-mammal capture: node scripts/mammals_capture.mjs [baseUrl] [tag] [only]
// Phone (390x844 DPR3) + desktop. For each mammal group: park the boat nearby, hold a scripted camera and
// write a ~100 ms frame sequence to screenshots/mammals/<tag>_<view>_<shot>_NN.png (+ mammals_<tag>_log.txt).
// Works on the old build too (baseline: frozen baked statics) — it then uses fixed designer positions.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5197/cedar-landing/';
const TAG = process.argv[3] ?? 'after';
const ONLY = process.argv[4] ?? '';
const OUT = path.resolve('screenshots/mammals');
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/mammals_${TAG}_log.txt`;
fs.writeFileSync(LOG, '');
const log = (...a) => { console.log(...a); fs.appendFileSync(LOG, a.join(' ') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

// Fallback views (designer positions from the master .blend, three coords) for builds without viewMammals.
const FIXED = {
  orcas: { at: [37, 0, 212], cam: [52, 6, 226] },
  dolphins: { at: [96, 0, 110], cam: [112, 6, 124] },
  seals: { at: [117, 0.7, 32], cam: [104, 4, 44] },
  sealheads: { at: [30, 0, 59], cam: [20, 3, 68] },
};

// shots: [name, mammal query, action, frames, interval ms]
const SHOTS = [
  ['orca_surface', 'orca', 'surface', 40, 100],
  ['orca_breach', 'orca', 'breach', 36, 100],
  ['orca_spyhop', 'orca', 'spyhop', 36, 120],
  ['orca_taillob', 'orca', 'taillob', 30, 100],
  ['orca_wide', 'orca', 'wide', 12, 400],
  ['fluke', 'fluke', 'fluke', 36, 120],
  ['dolphins', 'dolphin', 'surface', 24, 100],
  ['porpoise', 'porpoise', 'surface', 24, 100],
  ['seals_haulout', 'haulout', 'approach', 30, 150],
  ['seal_heads', 'heads', 'idle', 16, 150],
  ['otters', 'otter', 'idle', 16, 150],
];

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

async function run(view, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen());
  await sleep(3000); // loading card fades out
  const hasHook = await page.evaluate(() => typeof window.__debug.viewMammals === 'function');
  log(`[${view}] hook viewMammals: ${hasHook}`);
  if (hasHook) log(`[${view}] mammals`, JSON.stringify(await page.evaluate(() => window.__debug.mammals())));
  const shots = hasHook ? SHOTS : Object.entries(FIXED).map(([k]) => [k, k, 'fixed', 12, 400]);
  for (const [name, q, act, frames, every] of shots) {
    if (ONLY && !name.includes(ONLY)) continue;
    let ok;
    if (hasHook) ok = await page.evaluate(([q, act]) => window.__debug.viewMammals(q, act), [q, act]);
    else {
      const f = FIXED[q];
      ok = await page.evaluate((f) => { const d = window.__debug; d.teleport(f.cam[0], f.cam[2]); d.shot(f.cam, f.at, 50, 600); return true; }, f);
    }
    log(`[${view}] ${name}: ${JSON.stringify(ok)}`);
    if (!ok) continue;
    await sleep(hasHook ? 300 : 2500);
    for (let i = 0; i < frames; i++) {
      const t = Date.now();
      await page.screenshot({ path: `${OUT}/${TAG}_${view}_${name}_${String(i).padStart(2, '0')}.png` });
      if (hasHook && name === 'seals_haulout' && i === 8) await page.evaluate((q) => window.__debug.viewMammals(q, 'near'), q);
      if (hasHook && act !== 'fixed' && q !== 'haulout' && q !== 'heads' && q !== 'otter' && i % 3 === 2) await page.evaluate((q) => window.__debug.viewMammals(q, 'track'), q);
      if (hasHook && i % 6 === 0) log(`[${view}] ${name} ${i}`, JSON.stringify(await page.evaluate((q) => window.__debug.mammalState(q), q)));
      await sleep(Math.max(0, every - (Date.now() - t)));
    }
    await page.evaluate(() => window.__debug.skipShot());
  }
  // bow-riding: drive the boat past the dolphin pod with the normal chase camera
  if (hasHook && (!ONLY || 'bowride'.includes(ONLY))) {
    await page.evaluate(() => { const d = window.__debug; const o = d.mammals().pods.find((p) => p.sp === 'orca'); if (o) d.bringMammals('dolphin', o.at[0], o.at[1]); d.viewMammals('dolphin', 'bowride'); d.key('w', true); });
    for (let i = 0; i < 40; i++) {
      const t = Date.now();
      if (i % 2 === 0) await page.screenshot({ path: `${OUT}/${TAG}_${view}_bowride_${String(i / 2).padStart(2, '0')}.png` });
      if (i % 8 === 0) log(`[${view}] bowride ${i}`, JSON.stringify(await page.evaluate(() => { const d = window.__debug; return { boat: d.state.boat, pod: d.mammals().pods.find((p) => p.sp === 'dolphin') }; })));
      await sleep(Math.max(0, 250 - (Date.now() - t)));
    }
    await page.evaluate(() => window.__debug.key('w', false));
  }
  // perf sample near the pod, normal chase cam
  if (hasHook) await page.evaluate(() => window.__debug.viewMammals('orca', 'boat'));
  let fsum = 0, ms = 0, draws = 0;
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    const s = await page.evaluate(() => window.__debug.state);
    fsum += s.fps; ms = Math.max(ms, s.wildlife?.ms ?? 0); draws = Math.max(draws, s.drawCalls);
  }
  await page.screenshot({ path: `${OUT}/${TAG}_${view}_chase.png` });
  log(`[${view}] perf: avg fps ${(fsum / 8).toFixed(1)}, max wildlife update ${ms} ms, draws ${draws}`);
  log(`[${view}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

const VIEWS = process.env.VIEWS ?? 'phone,desktop';
if (VIEWS.includes('phone')) await run('phone', { width: 390, height: 844 }, true);
if (VIEWS.includes('desktop')) await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
