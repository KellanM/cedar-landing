// Ink outline comparison: node scripts/outline_capture.mjs [base] [modes=off,screen] [only=phone|desktop] [tag=outline]
// For each scene (harbour/town, troller under way, island shoreline, village, fishing hold-up, dusk, night)
// the sim clock is frozen and the same frame is shot once per mode → screenshots/<tag>_<scene>_<vp>_<mode>.png.
// Also logs __debug.benchOutline() (ms / draws / tris, off vs on) per scene. Exits non-zero on console errors.
// Contact sheet: python scripts/outline_sheet.py
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5197/cedar-landing/';
const MODES = (process.argv[3] ?? 'off,screen').split(',');
const ONLY = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : null;
const TAG = process.argv[5] ?? 'outline';
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const log = (...a) => { console.log(...a); fs.appendFileSync(`${OUT}/${TAG}_log.txt`, a.join(' ') + '\n'); };
fs.writeFileSync(`${OUT}/${TAG}_log.txt`, '');
let total = 0;
for (const [name, vp, mob] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  if (ONLY && ONLY !== name) continue;
  const bctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mob ? 3 : 1, isMobile: mob, hasTouch: mob });
  const page = await bctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); window.__debug.skipShot(); });
  await sleep(2500);
  // hide the HUD: only the 3D view is compared
  await page.addStyleTag({ content: 'body > *:not(canvas):not(#c) { visibility: hidden !important; } #fps { visibility: hidden !important; }' });
  const D = (fn, arg) => page.evaluate(fn, arg);
  const shoot = async (scene) => {
    await D(() => window.__debug.clock(true));
    await sleep(400);
    for (const m of MODES) {
      await D((mm) => window.__debug.outline(mm === 'off' ? false : mm), m);
      await sleep(m === 'hull' || m === 'hybrid' ? 2500 : 700);
      await page.screenshot({ path: `${OUT}/${TAG}_${scene}_${name}_${m}.png` });
      if (m !== 'off') {
        const b = await D(() => window.__debug.benchOutline(30));
        log(`[${name}] ${scene} ${m}: off ${b.off.ms}ms ${b.off.draws} draws ${(b.off.tris / 1000).toFixed(0)}k tris | on ${b.on.ms}ms ${b.on.draws} draws ${(b.on.tris / 1000).toFixed(0)}k tris`);
      }
    }
    await D(() => window.__debug.outline(false));
    await D(() => window.__debug.clock(false));
  };
  const free = async (ms) => { await D(() => window.__debug.clock(false)); await sleep(ms); };

  // 1. Cedar Landing harbour / town — boat off the fish market, camera raised looking at the town
  await D(() => { window.__debug.cam(null); window.__debug.teleportTo('Interact_SellFish', 14); });
  await free(1200);
  await shoot('harbour');
  await D(() => { const b = window.__debug.state.boat; window.__debug.cam({ pos: [b.x - 6, 9, b.z - 14], target: [28, 3, 142], fov: 50 }); });
  await free(800);
  await shoot('town');
  // 2. dusk + night at the harbour (same raised view)
  await D(() => window.__debug.setClock(19.83)); await free(1500);
  await shoot('dusk');
  await D(() => window.__debug.setClock(23.17)); await free(1500);
  await shoot('night');
  await D(() => { window.__debug.setClock(10.67); window.__debug.cam(null); }); await free(1200);
  // 3. village — camera from the water side of the plank-village mooring
  await D(() => { window.__debug.teleportTo('Interact_MoorPlankVillage', 10); });
  await free(800);
  await D(() => { const b = window.__debug.state.boat; window.__debug.cam({ pos: [b.x + (b.x - 32) * 0.3, 7, b.z + (b.z - 100) * 0.3], target: [32, 2, 100], fov: 50 }); });
  await free(800);
  await shoot('village');
  await D(() => window.__debug.cam(null));
  // 4. troller under way in open water (birds there too)
  await D(() => window.__debug.viewHotspot('OpenWaterBirds', 45));
  await free(500);
  await D(() => window.__debug.key('w', true)); await sleep(3500);
  await shoot('underway');
  await D(() => window.__debug.key('w', false));
  // 5. forest / rocky island shoreline
  // camera raised over the boat, looking at an interact on the island (teleportTo puts the boat at +off,+off)
  const island = async (it, off, scene, up = 8, back = 10) => {
    await D(([i, o]) => { window.__debug.cam(null); window.__debug.teleportTo(i, o); }, [it, off]); await free(800);
    await D(([o, u, bk]) => {
      const b = window.__debug.state.boat; const tx = b.x - o, tz = b.z - o; const dx = b.x - tx, dz = b.z - tz, l = Math.hypot(dx, dz) || 1;
      window.__debug.cam({ pos: [b.x + dx / l * bk, u, b.z + dz / l * bk], target: [tx, 2, tz], fov: 50 });
    }, [off, up, back]);
    await free(800);
    await shoot(scene);
    await D(() => window.__debug.cam(null));
  };
  await island('Interact_Hammock', 14, 'shore');
  await island('Interact_Telescope', 16, 'rocks');
  await island('Interact_Lookout', 40, 'island', 30, 90);
  // 6. fishing hold-up
  const hs = await D(() => window.__debug.hotspots()[0]);
  await D((h) => window.__debug.viewHotspot(h, 7), hs); await free(1200);
  await D(() => { window.__debug.action(); }); await sleep(1500);
  await D(() => window.__debug.forceBite()); await sleep(200);
  await D(() => { window.__debug.action(); window.__debug.landNow(); });
  await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 30000 }).catch(() => {});
  await sleep(1400);
  await shoot('holdup');
  log(`[${name}] console errors ${errs.length}`, errs.slice(0, 3).join(' | '));
  total += errs.length;
  await bctx.close();
}
await browser.close();
process.exit(total ? 1 : 0);
