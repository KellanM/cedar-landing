// Fishing perf probe: node scripts/fishing_perf.mjs [baseUrl] [hotspotName]
// No screenshots while sampling (they stall the GPU). Reports fps and draw calls while idle at a
// spot, waiting, and reeling (with forced thrashes), plus __debug.drawBreakdown() — the draw calls
// owned by the fishing FX, the deck skipper and the hotspot marker in the same frame.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5193/cedar-landing/';
const HS = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findChrome() {
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); });
  const hs = HS ?? (await page.evaluate(() => window.__debug.hotspots()))[0];
  await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hs);
  const sample = async (label, n = 8) => {
    let f = 0, d = 0;
    for (let i = 0; i < n; i++) { await sleep(500); const s = await page.evaluate(() => window.__debug.state); f += s.fps; d = Math.max(d, s.drawCalls); }
    const br = await page.evaluate(() => window.__debug.drawBreakdown?.());
    console.log(`[${name}] ${label}: fps ${(f / n).toFixed(1)}, max draws ${d}, breakdown ${JSON.stringify(br)}`);
  };
  await sleep(2000);
  await sample('idle at spot');
  await page.evaluate(() => window.__debug.action());
  await sleep(1500);
  await sample('waiting', 4);
  await page.evaluate(() => window.__debug.forceBite());
  await sleep(200);
  await page.evaluate(() => { window.__debug.action(); window.__debug.setAutoReel(true); });
  const thr = setInterval(() => page.evaluate(() => window.__debug.forceThrash?.()).catch(() => {}), 1500);
  await sample('reeling + thrashes', 8);
  clearInterval(thr);
  await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 30000 }).catch(() => {});
  await sleep(600);
  await sample('landed / hold-up', 4);
  console.log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await run('phone', { width: 390, height: 844 }, true);
await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
