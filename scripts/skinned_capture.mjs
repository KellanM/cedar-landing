// Skinned-skipper prototype capture: node scripts/skinned_capture.mjs [baseUrl] [phone|desktop]
// For each variant (rigid = direction A skipper.glb, skinned = friendslop skipper_skinned.glb): chase view while
// fishing, a close deck view, poses (stand / cast_windup / reel / hold_show / hold_hoist via the real fishing loop),
// hold-ups (small + big fish), and perf (skipper tris + draw calls, GPU ms per render with/without the skipper,
// CPU ms per skipper.update). Output: screenshots/skinned_<variant>_<vp>_<shot>.png + skinned_log.txt
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5250/cedar-landing/';
const ONLY = process.argv[3];
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const chrome = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p)) : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? chrome, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = []; const log = (...a) => { console.log(...a); lines.push(a.join(' ')); };
let total = 0;
const FAKE_SAVE = { shells: 0, coolerCap: 4, records: {}, seenReveal: true, reachedLanding: true, cooler: [], settings: { quality: 'high', autoReel: false, showFps: true, tod: null } };

async function run(vp, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), FAKE_SAVE);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(2000);
  const D = (fn, a) => page.evaluate(fn, a);
  const hs = (await D(() => window.__debug.hotspots()))[0];
  for (const variant of ['rigid', 'skinned']) {
    await D((v) => window.__debug.skipperVariant(v), variant);
    await D((h) => window.__debug.viewHotspot(h, 7), hs);
    await sleep(1800);
    const shot = (n) => page.screenshot({ path: `${OUT}/skinned_${variant}_${vp}_${n}.png` });
    // perf: skipper tris / draws, GPU ms with and without the skipper, CPU ms per update
    const perf = await D(() => {
      const s = window.__debug.skipperObj();
      let tris = 0, meshes = 0, skinned = 0;
      s.root.traverse((o) => { if (o.isMesh) { meshes++; if (o.isSkinnedMesh) skinned++; const g = o.geometry; tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } });
      const br = window.__debug.drawBreakdown();
      const b1 = window.__debug.benchFrame(40);
      s.root.visible = false; const b0 = window.__debug.benchFrame(40); s.root.visible = true;
      const t = performance.now(); for (let i = 0; i < 600; i++) s.update(1 / 60); const upd = (performance.now() - t) / 600;
      return { tris: Math.round(tris), meshes, skinned, skipperDraws: br.skipper, allDraws: br.all, gpuMsWith: b1.full, gpuMsWithout: b0.full, skipperGpuMs: +(b1.full - b0.full).toFixed(3), updateMs: +upd.toFixed(4) };
    });
    log(`[${vp}] ${variant} perf`, JSON.stringify(perf));
    // chase view while waiting for a bite (cast_windup -> waiting), then the fight (reel)
    await D(() => window.__debug.nextCatch('pacific_halibut', 150));
    await D(() => window.__debug.action());
    await sleep(500); await shot('cast');
    await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
    await sleep(600); await shot('chase_waiting');
    await D(() => window.__debug.forceBite());
    await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 6000 }).catch(() => {});
    await D(() => { window.__debug.action(); window.__debug.setAutoReel(true); });
    await sleep(2500); await shot('reel');
    await sleep(2000);
    await D(() => { window.__debug.setAutoReel(false); window.__debug.landNow(); });
    await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 6000 }).catch(() => {});
    await sleep(1300);
    await D(() => { document.getElementById('hud').style.visibility = 'hidden'; });
    await shot('hold_big'); await D(() => { document.getElementById('hud').style.visibility = ''; });
    await D(() => { window.__debug.keep(); window.__debug.closeModals(); window.__debug.sellAll(); });
    await page.waitForFunction(() => window.__debug.state.phase === 'idle', null, { timeout: 8000 }).catch(() => {});
    await sleep(1000);
    await D(() => window.__debug.nextCatch('shiner_perch', 12));
    await D(() => window.__debug.action());
    await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    await D(() => window.__debug.forceBite());
    await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 6000 }).catch(() => {});
    await D(() => { window.__debug.action(); window.__debug.setAutoReel(true); });
    await sleep(3000);
    await D(() => { window.__debug.setAutoReel(false); window.__debug.landNow(); });
    await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 6000 }).catch(() => {});
    await sleep(1300);
    await D(() => { document.getElementById('hud').style.visibility = 'hidden'; });
    await shot('hold_small'); await D(() => { document.getElementById('hud').style.visibility = ''; });
    await D(() => { window.__debug.keep(); window.__debug.closeModals(); window.__debug.sellAll(); });
    await page.waitForFunction(() => window.__debug.state.phase === 'idle', null, { timeout: 8000 }).catch(() => {});
    await D(() => window.__debug.nextCatch(null));
    // close look on deck (debug camera from the stern quarter)
    const p = await D(() => { const s = window.__debug.skipperObj(); s.root.updateWorldMatrix(true, true); const v = s.root.getWorldPosition(new s.root.position.constructor()); return [v.x, v.y, v.z]; });
    await D((pp) => window.__debug.cam({ pos: [pp[0] + 2.2, pp[1] + 1.6, pp[2] + 2.4], target: [pp[0], pp[1] + 0.85, pp[2]], fov: 36, near: 0.5 }), p);
    await sleep(900);
    await D(() => { document.getElementById('hud').style.visibility = 'hidden'; });
    await shot('deck_close');
    await D(() => { document.getElementById('hud').style.visibility = ''; window.__debug.cam(null); });
    await sleep(500);
  }
  log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
  total += errors.length;
  await ctx.close();
}
if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
fs.writeFileSync(`${OUT}/skinned_log.txt`, lines.join('\n'));
console.log(total ? `FAIL ${total} console errors` : 'PASS');
process.exit(total ? 1 : 0);
