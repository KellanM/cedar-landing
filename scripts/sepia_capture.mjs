// Title drawing + colour bloom capture: node scripts/sepia_capture.mjs [baseUrl] [tag] [views=phone] [--gif] [--bench] [--reduced] [--low]
//  per view: the title drawing still, then (fixed 1/60 s clock) the tap and the bloom every 1/12 s to
//  gameplay → screenshots/sepia_<tag>_<view>_*.png; --gif makes screenshots/sepia_<tag>_<view>.gif
//  (ffmpeg). --bench: GPU ms per frame for the drawn title vs plain, and after hand-off (pass state).
// One browser, one context at a time (low-memory machine).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:5230/cedar-landing/';
const TAG = process.argv[3] ?? 'iter';
const VIEWS = (process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'phone').split(',');
const GIF = process.argv.includes('--gif');
const BENCH = process.argv.includes('--bench');
const LOW = process.argv.includes('--low');
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const V = { phone: [390, 844, true], landscape: [844, 390, true], desktop: [1440, 900, false] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
for (const v of VIEWS) {
  const [width, height, mobile] = V[v];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: GIF && v === 'phone' ? 1 : 2, isMobile: mobile, hasTouch: mobile, reducedMotion: process.argv.includes('--reduced') ? 'reduce' : 'no-preference' });
  // a fresh profile with only the quality setting (loadSave fills in the rest)
  if (LOW) await ctx.addInitScript(() => { if (!localStorage.getItem('salish-sea-save-v1')) localStorage.setItem('salish-sea-save-v1', JSON.stringify({ settings: { quality: 'low' } })); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '?debug&title', { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('title-open'), null, { timeout: 120000 });
  await sleep(2600);
  const pre = `${OUT}/sepia_${TAG}_${v}${LOW ? '_low' : ''}`;
  await page.screenshot({ path: `${pre}_title.png` });
  if (BENCH) {
    await sleep(500);
    const b = await page.evaluate(() => window.__debug.benchSepia(60));
    console.log(v, 'title bench (ms/frame, GPU-synced)', JSON.stringify(b), JSON.stringify(await page.evaluate(() => window.__debug.sepia())));
  }
  const frames = [];
  if (GIF) {
    // hold the drawing for ~1.5 s in the GIF, then tap and step the bloom at 12 fps
    await page.evaluate(() => window.__debug.clock(true));
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__debug.advance(1000 / 12)); await sleep(60); const f = `${pre}_g${String(frames.length).padStart(3, '0')}.png`; await page.screenshot({ path: f }); frames.push(f); }
    await page.evaluate(() => document.getElementById('loading').click());
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.__debug.advance(1000 / 12));
      // CSS transitions run on wall time: give them about the same
      await sleep(70);
      const f = `${pre}_g${String(frames.length).padStart(3, '0')}.png`;
      await page.screenshot({ path: f }); frames.push(f);
      if (i === 8 || i === 14 || i === 20) fs.copyFileSync(f, `${pre}_bloom${i}.png`);
    }
    await page.evaluate(() => window.__debug.clock(false));
  } else {
    await page.evaluate(() => document.getElementById('loading').click());
    for (const ms of [350, 700, 1100]) { await sleep(ms === 350 ? 350 : ms - (ms === 700 ? 350 : 700)); await page.screenshot({ path: `${pre}_bloom${ms}.png` }); }
  }
  await sleep(3000);
  await page.screenshot({ path: `${pre}_play.png` });
  const st = await page.evaluate(() => window.__debug.sepia());
  console.log(v, 'after hand-off', JSON.stringify(st));
  if (BENCH) console.log(v, 'play bench', JSON.stringify(await page.evaluate(() => window.__debug.benchFrame(60))));
  await ctx.close();
  if (GIF && frames.length) {
    const list = `${pre}_frames.txt`;
    fs.writeFileSync(list, frames.map((f, i) => `file '${f.replace(/\\/g, '/')}'\nduration ${i < 6 ? 0.25 : 1 / 12}`).join('\n') + `\nfile '${`${pre}_play.png`.replace(/\\/g, '/')}'\nduration 1.5\nfile '${`${pre}_play.png`.replace(/\\/g, '/')}'\n`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${v === 'phone' ? 300 : 480}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=sierra2_4a`, `${pre}.gif`]);
    for (const f of frames) fs.unlinkSync(f);
    fs.unlinkSync(list);
    console.log('gif', `${pre}.gif`);
  }
}
await browser.close();
console.log('errors', errors.length, errors.slice(0, 5).join('\n'));
