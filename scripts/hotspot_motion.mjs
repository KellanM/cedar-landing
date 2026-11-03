// Hotspot motion capture (hotspot study): node scripts/hotspot_motion.mjs [baseUrl] [tag] [only=phone|desktop|-] [query]
// Freezes the sim clock and steps it in exact 100 ms ticks (like crest_motion.mjs). Per viewport and shot:
//   approach - chase camera, boat parked 20 m from the spot facing it (arriving)
//   inrange  - chase camera, boat 9 m from the spot (inside HOTSPOT_RANGE, ready to cast)
//   fog      - approach at heavy mist (mist 1)
//   night    - approach at 23:00
//   far      - chase camera 40 m out (spotting it while sailing)
// writes frames to screenshots/hsframes/<tag>_<vp>_<shot>/f_###.png, a strip of every 5th frame (0.5 s)
// screenshots/hotspot_<tag>_<vp>_<shot>.png, a 10 fps GIF screenshots/hotspot_<tag>_<vp>_<shot>.gif, and frame 0 as a still.
// env: SHOTS (comma list), FRAMES (default 50), HS (hotspot name, default LIFE_HS02)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:5210/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const ONLY = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const QUERY = process.argv[5] && process.argv[5] !== '-' ? `&${process.argv[5]}` : '';
const SHOTS = (process.env.SHOTS ?? 'approach,inrange,fog,night,far').split(',');
const FRAMES = +(process.env.FRAMES ?? 50);
const HS = process.env.HS ?? 'LIFE_HS02';
const OUT = path.resolve('screenshots');
const PREFIX = process.env.PREFIX ?? 'hotspot';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) { const exe = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(exe)) return exe; }
  return undefined;
}

const SHOT = {
  approach: { dist: 20, hour: 11, mist: 0 },
  inrange: { dist: 9, hour: 11, mist: 0 },
  fog: { dist: 20, hour: 11, mist: 1 },
  night: { dist: 20, hour: 23, mist: 0 },
  far: { dist: 40, hour: 11, mist: 0 },
  dusk: { dist: 20, hour: 19.5, mist: 0 },
  // close: fixed camera ~7 m from the spot centre, 4 m up (the hold-up / leaning-over-the-rail distance)
  close: { dist: 9, hour: 11, mist: 0, cam: { back: 6, up: 4, fov: 50 } },
  closenight: { dist: 9, hour: 23, mist: 0, cam: { back: 6, up: 4, fov: 50 } },
  // school: camera 5 m back, 3.5 m up, following the bait school (needs __debug.hotspotObj().school)
  school: { dist: 9, hour: 11, mist: 0, follow: { back: 5, up: 3.5, fov: 50 } },
};
const GP = JSON.parse(fs.readFileSync(path.resolve('public/world/gameplay.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function run(vp, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug' + QUERY, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
  await page.addStyleTag({ content: '.title-card{display:none!important} #fps{opacity:0!important}' });
  await sleep(1200);
  for (const shot of SHOTS) {
    const S = SHOT[shot];
    await page.evaluate(() => window.__debug.clock(false));
    await page.evaluate((s) => { window.__debug.setClock(s.hour); window.__debug.mist(s.mist); }, S);
    await page.evaluate(([h, d]) => window.__debug.viewHotspot(h, d), [HS, S.dist]);
    await page.evaluate(() => window.__debug.cam(null));
    if (S.cam) {
      const h = GP.hotspots.find((x) => x.name === HS || x.name.includes(HS));
      const b = await page.evaluate(() => window.__debug.state.boat);
      const bx = b.x ?? b[0], bz = b.z ?? b[2];
      const dx = h.pos[0] - bx, dz = h.pos[2] - bz, L = Math.hypot(dx, dz) || 1;
      const pos = [h.pos[0] - (dx / L) * S.cam.back + 1.5, S.cam.up, h.pos[2] - (dz / L) * S.cam.back];
      await page.evaluate((c) => window.__debug.cam(c), { pos, target: [h.pos[0], 0, h.pos[2]], fov: S.cam.fov });
    }
    await sleep(2500);
    await page.evaluate(() => window.__debug.clock(true));
    const dir = path.join(OUT, 'hsframes', `${TAG}_${vp}_${shot}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < FRAMES; i++) {
      if (S.follow) {
        await page.evaluate(([hs, f]) => {
          const d = window.__debug, o = d.hotspotObj && d.hotspotObj(), sc = o && o.school ? o.school(hs) : null;
          if (!sc) return;
          const b = d.state.boat, dx = sc.x - b.x, dz = sc.z - b.z, L = Math.hypot(dx, dz) || 1;
          d.cam({ pos: [sc.x - (dx / L) * f.back, f.up, sc.z - (dz / L) * f.back], target: [sc.x, 0, sc.z], fov: f.fov });
        }, [HS, S.follow]);
      }
      await page.evaluate(() => window.__debug.advance(100));
      await page.waitForFunction(() => window.__debug.stepsLeft() === 0);
      await page.screenshot({ path: path.join(dir, `f_${String(i).padStart(3, '0')}.png`), scale: 'css' });
    }
    await page.evaluate(() => { window.__debug.clock(false); window.__debug.cam(null); });
    const st = await page.evaluate(() => ({ fps: window.__debug.state.fps, draws: window.__debug.state.drawCalls, d: window.__debug.state.nearestHotspotDist }));
    const w = isMobile ? 260 : 480;
    const strip = path.join(OUT, `${PREFIX}_${TAG}_${vp}_${shot}.png`);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', `select='not(mod(n\\,5))',scale=${w}:-1,tile=${Math.ceil(FRAMES / 5)}x1:padding=4:color=black`, '-frames:v', '1', '-update', '1', strip]);
    const gif = path.join(OUT, `${PREFIX}_${TAG}_${vp}_${shot}.gif`);
    const gw = isMobile ? 300 : 560;
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', `scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
    fs.copyFileSync(path.join(dir, `f_${String(Math.min(20, FRAMES - 1)).padStart(3, '0')}.png`), path.join(OUT, `${PREFIX}_${TAG}_${vp}_${shot}_still.png`));
    console.log(`[${vp}] ${shot}: ${FRAMES} frames -> ${path.basename(gif)} ${JSON.stringify(st)}`);
  }
  console.log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
