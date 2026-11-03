// Rain + storm capture (docs/rain_study.md): node scripts/rain_capture.mjs [baseUrl] [tag] [only=phone|desktop|-]
// Pins the weather with __debug.rain / __debug.storm, freezes the sim clock and steps it in exact 100 ms
// ticks (like crest_motion.mjs), so the GIFs show game time. Per viewport and scene:
//   SCENES (env, comma list) of  <place>:<weather>[:<hour>]
//     place   boat (chase cam, idling in open water) | spot (at a fishing spot, line cast) | foot (ashore in Cedar Landing)
//     weather dry | drizzle | rain | storm | mist (heavy mist + rain)
//     hour    clock hour (default 11)
//   STILL=1 writes one PNG per scene instead of a GIF. FRAMES (default 36).
// Writes screenshots/rain_<tag>_<vp>_<place>_<weather>[_<hour>].{gif,png} and logs weather FX stats + fps.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:5222/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const ONLY = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const SCENES = (process.env.SCENES ?? 'boat:drizzle,boat:rain,spot:rain,foot:rain,boat:storm').split(',');
const FRAMES = +(process.env.FRAMES ?? 36);
const STILL = !!process.env.STILL;
const OUT = path.resolve('screenshots');
const TMP = path.join(OUT, 'rainframes');
fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) { const exe = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(exe)) return exe; }
  return undefined;
}

const W = {
  dry: { rain: 0, storm: 0, mist: null },
  drizzle: { rain: 0.35, storm: 0, mist: null },
  rain: { rain: 0.75, storm: 0, mist: null },
  storm: { rain: null, storm: 1, mist: null },
  mist: { rain: 0.6, storm: 0, mist: 0.92 },
};

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function run(vp, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); window.__debug.setAutoReel?.(false); });
  await page.addStyleTag({ content: '.title-card{display:none!important} #fps{opacity:0!important}' });
  await sleep(1200);
  let place = '';
  for (const sc of SCENES) {
    const [where, wx, hs] = sc.split(':');
    const hour = hs ? +hs : 11;
    await page.evaluate(() => window.__debug.clock(false));
    if (where !== place) {
      if (place === 'foot') await page.evaluate(() => window.__debug.board());
      if (place === 'spot') await page.evaluate(() => window.__debug.closeModals());
      if (where === 'boat') await page.evaluate(() => window.__debug.teleport(220, 300, 0.6));
      if (where === 'spot') {
        const hss = await page.evaluate(() => window.__debug.hotspots());
        await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hss[0]);
        await sleep(1500);
        await page.evaluate(() => window.__debug.action());
        await sleep(2500);
      }
      if (where === 'foot') {
        await page.evaluate(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
        await sleep(1200);
        // like foot_verify: step ashore with real input, then walk up to the plaza
        const it = await page.evaluate(() => window.__debug.state.interact);
        if (it === 'step_ashore') await page.keyboard.press('e'); else await page.keyboard.press('Space');
        await sleep(1500);
        await page.evaluate(() => window.__debug.footPathTo(21.6, 144.7));
        for (let i = 0; i < 100 && (await page.evaluate(() => window.__debug.state.foot?.autoWalk)); i++) await sleep(150);
        await page.evaluate(() => { window.__debug.footWalkTo(null); window.__debug.footPathTo(24.9, 140.4); });
      }
      place = where;
      await sleep(1500);
    }
    const w = W[wx];
    const info = await page.evaluate(([h, w]) => {
      const d = window.__debug;
      d.setClock(h);
      d.mist(w.mist);
      d.rain(w.rain);
      d.storm(w.storm);
      return d.weatherSnap(false);
    }, [hour, w]);
    await sleep(2200); // let the eased palette / lighting settle
    const base = `rain_${TAG}_${vp}_${where}_${wx}${hs ? '_' + hs : ''}`;
    const st = await page.evaluate(() => ({ fps: window.__debug.state.fps, draws: window.__debug.state.drawCalls, fx: window.__debug.weatherFx(), words: document.getElementById('clock')?.title }));
    console.log(`[${vp}] ${sc}`, JSON.stringify(info), JSON.stringify(st));
    if (STILL) { await page.screenshot({ path: path.join(OUT, base + '.png') }); continue; }
    const dir = path.join(TMP, base);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(() => window.__debug.clock(true));
    for (let i = 0; i < FRAMES; i++) {
      if (wx === 'storm' && i === 6) await page.evaluate(() => window.__debug.lightning(false));
      if (wx === 'storm' && i === 26 && FRAMES > 30) await page.evaluate(() => window.__debug.lightning(true));
      await page.evaluate(() => window.__debug.advance(100));
      await page.waitForFunction(() => window.__debug.stepsLeft() === 0, null, { timeout: 10000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(dir, `f_${String(i).padStart(3, '0')}.png`) });
    }
    await page.evaluate(() => window.__debug.clock(false));
    const gif = path.join(OUT, base + '.gif');
    const scale = isMobile ? 390 : 640;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', `scale=${scale}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
    console.log('  →', gif);
  }
  console.log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
