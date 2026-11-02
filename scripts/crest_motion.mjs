// Crest motion capture (crest study): node scripts/crest_motion.mjs [baseUrl] [tag] [only=phone|desktop|-] [query] [tod]
// Freezes the sim clock and steps it in exact 100 ms ticks, so every frame is 1/10 s of game time apart regardless
// of how long a screenshot takes. Per viewport (phone 390x844, desktop 1280x800) and per shot:
//   near   - chase camera, boat idling in open water
//   mid    - fixed camera over open water (crests 10-90 m away)
//   high   - high-angle look down over open water (rows lining up?)
//   shore  - sheltered water off an island shore (Hermit's Key)
//   underway - chase camera, boat at full throttle
// writes frames to screenshots/crestframes/<tag>_<vp>_<shot>/f_###.png, then (ffmpeg) a strip of every 4th frame
// (0.4 s apart) screenshots/crests_<tag>_<vp>_<shot>.png, and a 10 fps GIF screenshots/crests_<tag>_<vp>_<shot>.gif.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:5199/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const ONLY = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const QUERY = process.argv[5] && process.argv[5] !== '-' ? `&${process.argv[5]}` : '';
const TOD = process.argv[6] ?? 'sunbreak';
const SHOTS = (process.env.SHOTS ?? 'near,mid,high,shore,underway').split(',');
const FRAMES = +(process.env.FRAMES ?? 50);
const OUT = path.resolve('screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) { const exe = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(exe)) return exe; }
  return undefined;
}
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const CAMS = {
  mid: { pos: [135, 5, 205], target: [138, 0, 260], fov: 50 },
  high: { pos: [118, 24, 186], target: [146, 0, 240], fov: 50 },
  shore: { pos: [-46, 3, 18], target: [-86, 0, 56], fov: 50 },
};

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
  await page.addStyleTag({ content: '.title-card{display:none!important} #hud,.hud,#fps{opacity:0!important}' });
  await sleep(1200);
  await page.evaluate(async (want) => { for (let i = 0; i < 8 && window.__debug.state.tod !== want; i++) window.__debug.cycleTOD(); }, TOD);
  await sleep(1500);
  for (const shot of SHOTS) {
    await page.evaluate(() => window.__debug.clock(false));
    if (CAMS[shot]) {
      await page.evaluate(() => window.__debug.teleport(135, 215, Math.PI));
      await page.evaluate((c) => window.__debug.cam(c), CAMS[shot]);
    } else {
      await page.evaluate(() => window.__debug.cam(null));
      await page.evaluate(() => window.__debug.teleport(135, 215, Math.PI));
      if (shot === 'underway') { await page.evaluate(() => window.__debug.key('w', true)); }
    }
    await sleep(shot === 'underway' ? 2200 : 1500);
    await page.evaluate(() => window.__debug.clock(true));
    const dir = path.join(OUT, 'crestframes', `${TAG}_${vp}_${shot}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate(() => window.__debug.advance(100));
      await page.waitForFunction(() => window.__debug.stepsLeft() === 0);
      await page.screenshot({ path: path.join(dir, `f_${String(i).padStart(3, '0')}.png`), scale: 'css' });
    }
    await page.evaluate(() => { window.__debug.key('w', false); window.__debug.clock(false); });
    const st = await page.evaluate(() => window.__debug.state.boat);
    // strip: every 4th frame (0.4 s), 6 frames; GIF: all frames at 10 fps
    const w = isMobile ? 260 : 480;
    const strip = path.join(OUT, `crests_${TAG}_${vp}_${shot}.png`);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', `select='not(mod(n\\,4))',scale=${w}:-1,tile=6x1:padding=4:color=black`, '-frames:v', '1', '-update', '1', strip]);
    const gif = path.join(OUT, `crests_${TAG}_${vp}_${shot}.gif`);
    const gw = isMobile ? 300 : 560;
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', `scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
    console.log(`[${vp}] ${shot}: ${FRAMES} frames -> ${path.basename(strip)}, ${path.basename(gif)} boat ${JSON.stringify(st)}`);
  }
  console.log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
