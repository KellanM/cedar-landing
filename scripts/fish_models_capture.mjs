// Fish models capture: node scripts/fish_models_capture.mjs [baseUrl] [tag] [sheet|hold|all] [phone|desktop]
//  sheet: every species' 3D model next to its Logbook plate (same side view, same scale: the side
//         render uses an orthographic camera matched to the plate's 512×256 canvas), plus a 3/4 view
//         and a flop frame → screenshots/fishmodels_<tag>_sheet_N.png (12 species per sheet).
//  hold:  the hold-up shot after landing a small / medium / large catch (and a few extremes) on
//         phone (390×844 @3x) and desktop (1280×800) → screenshots/fishmodels_<tag>_hold_<vp>_<id>_<size>.png
//         and a combined strip per viewport. Logs tris/draw calls and console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5197/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const WHAT = process.argv[4] ?? 'all';
const ONLY = process.argv[5];
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/fishmodels_${TAG}_log.txt`;
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

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let totalErrors = 0;

async function open(viewport, isMobile, scale = isMobile ? 3 : 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); });
  return { ctx, page, errors };
}

// ------------------------------------------------------------------ contact sheet
async function sheet() {
  const { ctx, page, errors } = await open({ width: 1280, height: 800 }, false);
  const index = await page.evaluate(async (b) => (await fetch(b + 'fish/models/index.json')).json(), BASE);
  const ids = Object.entries(index).filter(([s, e]) => e.game_id || s === 'unknown-fish').map(([s]) => s);
  const rows = [];
  for (const slug of ids) {
    const id = slug.replace(/-/g, '_');
    const side = await page.evaluate((i) => window.__debug.fishStudio(i, 'side', 768, 384), id);
    const quarter = await page.evaluate((i) => window.__debug.fishStudio(i, 'quarter', 512, 384), id);
    const flop = await page.evaluate((i) => window.__debug.fishStudio(i, 'flop', 512, 384), id);
    rows.push({ slug, name: slug, side, quarter, flop, plate: `${BASE}fish/${slug}.svg` });
    log(`[sheet] ${slug} plan ${side?.plan} tris ${side?.tris}`);
  }
  const per = 9;
  for (let s = 0; s * per < rows.length; s++) {
    const part = rows.slice(s * per, s * per + per);
    const html = `<!doctype html><html><head><style>
      body{margin:0;padding:12px;background:#F4EFE3;font:15px Georgia,serif;color:#2B2622}
      .r{display:grid;grid-template-columns:120px 384px 384px 256px 256px;gap:6px;margin-bottom:6px;align-items:center}
      img{display:block;background:#E9E1CF;border:1px solid #CFC6B5}
      .p,.s{width:384px;height:192px}.q{width:256px;height:192px}
      h3{margin:0 0 8px;font-size:14px}
      </style></head><body><h3>plate | 3D side (same scale) | 3D 3/4 | 3D flop — ${TAG}</h3>${part.map((r) => `<div class="r"><div>${r.name}<br><small>${r.side?.plan ?? '?'} · ${r.side?.tris ?? 0} tris</small></div>
      <img class="p" src="${r.plate}"><img class="s" src="${r.side?.url ?? ''}"><img class="q" src="${r.quarter?.url ?? ''}"><img class="q" src="${r.flop?.url ?? ''}"></div>`).join('')}</body></html>`;
    const p2 = await ctx.newPage();
    await p2.setViewportSize({ width: 1460, height: 800 });
    await p2.setContent(html, { waitUntil: 'load' });
    await sleep(300);
    const file = `${OUT}/fishmodels_${TAG}_sheet_${s + 1}.png`;
    await p2.screenshot({ path: file, fullPage: true });
    await p2.close();
    log(`[sheet] wrote ${file}`);
  }
  log(`[sheet] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  totalErrors += errors.length;
  await ctx.close();
}

// ------------------------------------------------------------------ hold-up shots
const HOLD_MS = +(process.env.FISH_HOLD_MS ?? 1300);
const CATCHES = [
  ['shiner_perch', 12], // small
  ['copper_rockfish', 45], // medium
  ['pacific_halibut', 150], // large
  ['dungeness_crab', 18],
  ['lingcod', 100],
  ['wolf_eel', 170],
  ['bluntnose_sixgill', 320],
];

async function hold(name, viewport, isMobile) {
  const { ctx, page, errors } = await open(viewport, isMobile);
  const hs = (await page.evaluate(() => window.__debug.hotspots()))[0];
  await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hs);
  await sleep(2000);
  const shots = [];
  const which = process.env.FISH_HOLD ? CATCHES.filter(([id]) => process.env.FISH_HOLD.split(',').includes(id)) : CATCHES;
  for (const [id, size] of which) {
    await page.evaluate(([i, s]) => window.__debug.nextCatch(i, s), [id, size]);
    await page.evaluate(() => window.__debug.action());
    await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    await page.evaluate(() => window.__debug.forceBite());
    await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => { window.__debug.action(); window.__debug.setAutoReel(true); });
    await sleep(4500); // let the boat swing the line abaft the beam, as in a real fight
    await page.evaluate(() => { window.__debug.setAutoReel(false); window.__debug.landNow(); });
    await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 6000 }).catch(() => {});
    const file = `fishmodels_${TAG}_hold_${name}_${id}_${size}.png`;
    if (process.env.FISH_SEQ) for (const ms of [300, 500, 500, 500, 700, 1000]) { await sleep(ms); await page.screenshot({ path: `${OUT}/seq_${Date.now()}_${file}` }); }
    else await sleep(HOLD_MS);
    // clean frame (HUD hidden: bubble/slip/card) to judge the fish, then the real UI frame a beat later
    await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
    await page.screenshot({ path: `${OUT}/${file}` });
    await page.evaluate(() => { document.getElementById('hud').style.visibility = ''; });
    await sleep(1400);
    await page.screenshot({ path: `${OUT}/${file.replace('.png', '_ui.png')}` });
    const s = await page.evaluate(() => ({ draws: window.__debug.state.drawCalls, tris: window.__debug.state.tris, species: window.__debug.state.species }));
    const br = await page.evaluate(() => window.__debug.drawBreakdown());
    log(`[${name}] ${file}`, JSON.stringify(s), 'breakdown', JSON.stringify(br));
    shots.push(file);
    await page.evaluate(() => { window.__debug.keep(); window.__debug.closeModals(); window.__debug.sellAll(); });
    await page.waitForFunction(() => window.__debug.state.phase === 'idle', null, { timeout: 8000 }).catch(() => {});
    await sleep(1200);
  }
  await page.evaluate(() => window.__debug.nextCatch(null));
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  totalErrors += errors.length;
  // strip
  const w = isMobile ? 260 : 640;
  const html = `<!doctype html><html><body style="margin:0;padding:8px;background:#2B2622;display:flex;flex-wrap:wrap;gap:6px;width:${(w + 6) * (isMobile ? shots.length : 3) + 16}px">${shots.map((f) => `<figure style="margin:0;color:#F4EFE3;font:13px sans-serif"><img src="data:image/png;base64,${fs.readFileSync(`${OUT}/${f}`).toString('base64')}" style="width:${w}px;display:block"><figcaption>${f.replace(`fishmodels_${TAG}_hold_${name}_`, '')}</figcaption></figure>`).join('')}</body></html>`;
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 1400, height: 800 });
  await p2.setContent(html, { waitUntil: 'load' });
  await sleep(500);
  await p2.screenshot({ path: `${OUT}/fishmodels_${TAG}_hold_${name}_strip.png`, fullPage: true });
  await p2.close();
  await ctx.close();
}

if (WHAT === 'sheet' || WHAT === 'all') await sheet();
if (WHAT === 'hold' || WHAT === 'all') {
  if (ONLY !== 'desktop') await hold('phone', { width: 390, height: 844 }, true);
  if (ONLY !== 'phone') await hold('desktop', { width: 1280, height: 800 }, false);
}
log(`total console errors: ${totalErrors}`);
await browser.close();
