// UI review checks (docs/study/ui_design.md §5): node scripts/ui_checks.mjs [baseUrl]
//  1. touch targets: every visible control in each screen, flag < 44 px (and < 48 px, our own bar)
//  2. tension ring under emulated deuteranopia / protanopia / achromatopsia (CDP) for each state
//  3. time-of-day captures + element rects → scripts/ui_contrast.py measures contrast
// Outputs: screenshots/check_*.png, screenshots/checks.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5191/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p)) : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { targets: {}, contrast: {}, cvd: [] };

const TARGETS_JS = () => {
  const out = [];
  const sel = 'button, [role="switch"], [role="tab"], .ticket, a[href]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    let hidden = false;
    for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.opacity === '0') { hidden = true; break; } }
    if (hidden) continue;
    // hit area may be extended by a ::before (switches)
    const b = getComputedStyle(el, '::before');
    let w = r.width, h = r.height;
    if (b.content !== 'none' && b.position === 'absolute') { w += -2 * (parseFloat(b.left) || 0); h += -2 * (parseFloat(b.top) || 0); }
    out.push({ id: el.id || el.className.toString().slice(0, 30) || el.textContent.trim().slice(0, 20), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24), w: Math.round(w), h: Math.round(h) });
  }
  return out;
};

async function boot(viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.ui.clearHints(); });
  await sleep(6000); // past the first title card
  return { ctx, page };
}

const startReel = async (page) => {
  const hs = (await page.evaluate(() => window.__debug.hotspots()))[0];
  await page.evaluate((h) => window.__debug.teleportTo(h, 4), hs);
  await sleep(500);
  await page.evaluate(() => window.__debug.action());
  await sleep(1200);
  await page.evaluate(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 });
  await page.evaluate(() => window.__debug.action());
  await sleep(400);
};
const holdRing = (page, t, thrash) => page.evaluate(([t, thrash]) => {
  clearInterval(window.__hold);
  const f = window.__debug.fishing;
  window.__hold = setInterval(() => { f.tension = t; f.thrashing = thrash; f.nextThrash = 1e9; f.thrashEnd = 1e9; f.distance = 6.4; f.maxTension = 0.5; f.slips = 0; }, 5);
}, [t, thrash]);
const rectOf = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);

// ---------------------------------------------------------------- 1. targets
for (const [vp, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['landscape', { width: 844, height: 390 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const { ctx, page } = await boot(viewport, mobile);
  const screens = {};
  screens.hud = await page.evaluate(TARGETS_JS);
  for (const tab of ['errands', 'fish', 'map', 'pages', 'settings']) {
    await page.evaluate((t) => window.__debug.ui.openLog(t), tab);
    await sleep(500);
    screens[`log_${tab}`] = await page.evaluate(TARGETS_JS);
  }
  await page.evaluate(() => window.__debug.ui.closeLog());
  await page.evaluate(() => window.__debug.ui.catchDemo('staghorn_sculpin', 'NEW!'));
  await page.waitForSelector('#card.armed');
  screens.card = await page.evaluate(TARGETS_JS);
  await page.click('#card-keep');
  await sleep(500);
  await page.evaluate(() => window.__debug.ui.catchDemo('staghorn_sculpin', null));
  await sleep(1200);
  screens.slip = await page.evaluate(TARGETS_JS);
  await sleep(3500);
  await page.evaluate(() => window.__debug.teleportTo('Interact_SellFish', 0));
  await sleep(800);
  await page.evaluate(() => window.__debug.ui.openMarket());
  await sleep(600);
  screens.market = await page.evaluate(TARGETS_JS);
  const small = {};
  for (const [k, list] of Object.entries(screens)) {
    const bad = list.filter((t) => t.w < 44 || t.h < 44);
    const under48 = list.filter((t) => (t.w < 48 || t.h < 48) && !(t.w < 44 || t.h < 44));
    small[k] = { count: list.length, under44: bad, under48: under48.map((t) => `${t.text || t.id} ${t.w}×${t.h}`) };
  }
  report.targets[vp] = small;
  await ctx.close();
}

// ---------------------------------------------------------------- 2+3. ring under CVD + time of day contrast
{
  const { ctx, page } = await boot({ width: 390, height: 844 }, true);
  const cdp = await ctx.newCDPSession(page);
  await startReel(page);
  const ringClip = async () => { const r = await rectOf(page, '#tension'); return { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20 }; };
  for (const type of ['none', 'deuteranopia', 'protanopia', 'achromatopsia']) {
    await cdp.send('Emulation.setEmulatedVisionDeficiency', { type });
    for (const [state, t, th] of [['calm', 0.35, false], ['strain', 0.7, false], ['danger', 0.93, false], ['thrash', 0.5, true]]) {
      await holdRing(page, t, th);
      await sleep(250);
      const file = `check_cvd_${type}_${state}.png`;
      await page.screenshot({ path: `${OUT}/${file}`, clip: await ringClip() });
      report.cvd.push(file);
    }
  }
  await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
  // time of day: ring + HUD rects on the same frame
  await holdRing(page, 0.5, false);
  for (let i = 0; i < 5; i++) {
    const tod = (await page.evaluate(() => window.__debug.state)).tod;
    await sleep(300);
    await page.screenshot({ path: `${OUT}/check_tod_ring_${tod}.png` });
    await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
    await page.screenshot({ path: `${OUT}/check_tod_ring_${tod}_bare.png` });
    await page.evaluate(() => { document.getElementById('hud').style.visibility = ''; });
    report.contrast[`ring_${tod}`] = { file: `check_tod_ring_${tod}.png`, ring: await rectOf(page, '#tension svg .outline') };
    await page.evaluate(() => window.__debug.cycleTOD());
  }
  await page.evaluate(() => clearInterval(window.__hold));
  await ctx.close();
}
{
  const { ctx, page } = await boot({ width: 390, height: 844 }, true);
  for (let i = 0; i < 5; i++) {
    const tod = (await page.evaluate(() => window.__debug.state)).tod;
    await sleep(300);
    const rects = {};
    for (const s of ['#shells', '#cooler-tab', '#btn-log', '#btn-action', '#btn-interact', '#compass']) rects[s] = await rectOf(page, s);
    await page.screenshot({ path: `${OUT}/check_tod_hud_${tod}.png` });
    await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
    await page.screenshot({ path: `${OUT}/check_tod_hud_${tod}_bare.png` });
    await page.evaluate(() => { document.getElementById('hud').style.visibility = ''; });
    report.contrast[`hud_${tod}`] = { file: `check_tod_hud_${tod}.png`, rects };
    await page.evaluate(() => window.__debug.cycleTOD());
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.targets, null, 1));
