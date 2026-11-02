// Full-archipelago export check: perf at spawn + views of the southern islands.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5211/cedar-landing/';
const TAG = process.argv[3] ?? 'new';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errors = [];
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
await p.goto(BASE + '?debug'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
console.log(`[${TAG}] world ready ${((Date.now() - t0) / 1000).toFixed(1)} s, chunks`, await p.evaluate(() => window.__debug.state.chunks));
await p.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setClock(13.3); window.__debug.mist(0.25); });
await sleep(3000);
const perf = async (label) => { await sleep(2500); const s = await p.evaluate(() => { const s = window.__debug.state; return { fps: s.fps, draws: s.drawCalls, tris: s.tris }; }); console.log(`[${TAG}] ${label}`, JSON.stringify(s)); };
await perf('spawn');
await p.screenshot({ path: `screenshots/world_${TAG}_spawn.png` });
for (const [label, x, z, yaw] of [['echo_north', 20, 470, Math.PI / 2], ['echo_west', -175, 640, 0], ['race', 40, 330, Math.PI / 2], ['marigold', 200, 660, Math.PI / 2]]) {
  await p.evaluate(([x, z, yaw]) => { window.__debug.teleport(x, z, yaw); window.__debug.camTune({ distance: 30, pitchDeg: 16, sideDeg: 180, frameAhead: 40 }); }, [x, z, yaw]);
  await perf(label);
  await p.screenshot({ path: `screenshots/world_${TAG}_${label}.png` });
}
console.log(`[${TAG}] console errors: ${errors.length}`, errors.slice(0, 3).join(' | '));
await b.close();
