// Expression beats capture (friendslop phase 2): node scripts/expr_capture.mjs [baseUrl] [phone|desktop]
// Frame sequences (≈ every 120 ms) of the skipper's face on the beats: strike, reel, catch hold-up, escape, plus
// an on-foot blink/talk and the crowd. Close camera from in front of the skipper (debug cam), HUD hidden.
// Output: screenshots/expr_<vp>_<beat>_NN.png + expr_log.txt
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
const FAKE_SAVE = { shells: 0, coolerCap: 6, records: {}, seenReveal: true, reachedLanding: true, cooler: [], settings: { quality: 'high', autoReel: false, showFps: false, tod: null } };

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
  const hud = await page.addStyleTag({ content: '#hud, .hud-top, .bubble, .hint, .toast { visibility: hidden !important }' });
  const hs = (await D(() => window.__debug.hotspots()))[0];
  await D((h) => window.__debug.viewHotspot(h, 7), hs);
  await sleep(1500);
  // close camera in front of the skipper, updated each frame we shoot
  const closeCam = () => D(() => {
    const s = window.__debug.skipperObj(); const V = s.root.position.constructor;
    const h = s.head(new V()); const f = s.forward(new V());
    if (!h) return false;
    window.__debug.cam({ pos: [h.x + f.x * 2.7 + f.z * 0.9, h.y + 0.45, h.z + f.z * 2.7 - f.x * 0.9], target: [h.x, h.y - 0.45, h.z], fov: 40, near: 0.3 });
    return true;
  });
  const seq = async (beat, n, ms = 120) => { for (let i = 0; i < n; i++) { await closeCam(); await sleep(ms); await page.screenshot({ path: `${OUT}/expr_${vp}_${beat}_${String(i).padStart(2, '0')}.png` }); } };
  const state = () => D(() => ({ ph: window.__debug.state.phase, e: window.__debug.faces() }));
  // cast + wait (neutral, blinking)
  await D(() => window.__debug.nextCatch('lingcod', 100));
  await D(() => window.__debug.action());
  await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
  await seq('wait', 12, 200);
  // bite → strike! (googly surprised) → reel (effort, worried at high tension)
  await D(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 6000 }).catch(() => {});
  log(`[${vp}] bite`, JSON.stringify(await state()));
  await D(() => window.__debug.action());
  await seq('strike', 8, 90);
  await D(() => window.__debug.setAutoReel(true));
  await seq('reel', 14, 150);
  log(`[${vp}] reel`, JSON.stringify(await state()));
  await D(() => { window.__debug.setAutoReel(false); window.__debug.landNow(); });
  await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 6000 }).catch(() => {});
  await D(() => window.__debug.cam(null));
  for (let i = 0; i < 12; i++) { await sleep(130); await page.screenshot({ path: `${OUT}/expr_${vp}_catch_${String(i).padStart(2, '0')}.png` }); }
  log(`[${vp}] landed`, JSON.stringify(await state()));
  await D(() => { window.__debug.keep(); window.__debug.closeModals(); window.__debug.sellAll(); });
  await page.waitForFunction(() => window.__debug.state.phase === 'idle', null, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  // escape: let the bite go (missed) → googly sad → back to bean
  await D(() => window.__debug.nextCatch('copper_rockfish', 40));
  await D(() => window.__debug.action());
  await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
  await D(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => window.__debug.state.phase === 'missed', null, { timeout: 8000 }).catch(() => {});
  log(`[${vp}] missed`, JSON.stringify(await state()));
  await seq('escape', 14, 140);
  await D(() => window.__debug.nextCatch(null));
  await D(() => window.__debug.cam(null));
  // the skipper's expressions one by one (for the sheet), still on deck
  await D(() => window.__debug.action());
  await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
  for (const e of ['neutral', 'happy', 'surprised', 'effort', 'worried', 'sad', 'joy']) {
    await D((x) => window.__debug.skipperExpr(x), e);
    await closeCam(); await sleep(60);
    await D((x) => window.__debug.skipperExpr(x), e);
    await sleep(400);
    await page.screenshot({ path: `${OUT}/expr_${vp}_sheet_${e}.png` });
  }
  await D(() => { window.__debug.skipperExpr(null); window.__debug.cam(null); });
  log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
  total += errors.length;
  await hud.evaluate((el) => el.remove());
  await ctx.close();
}
if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
fs.writeFileSync(`${OUT}/expr_log.txt`, lines.join('\n'));
console.log(total ? `FAIL ${total}` : 'PASS');
process.exit(total ? 1 : 0);
