// Catch victory capture (docs/catch_study.md):
//   node scripts/catch_capture.mjs <base> <tag> <tier|all> [phone|desktop] [--stills]
// Plays a forced catch per tier at real time and records it with a CDP screencast (honest pacing:
// nothing is stepped), then writes
//   screenshots/catch_<tag>_<tier>_<vp>.gif   (ffmpeg, 15 fps, 360 px wide on phone)
//   screenshots/catch_<tag>_<tier>_<vp>_NN_<beat>.png  (full-res stills from the screencast, --stills)
//   screenshots/catch_<tag>_log.txt           (beats, fps, console errors)
// Tiers: common (repeat species, short), uncommon, rare, legendary, first (a common, first of its kind).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5240/cedar-landing/';
const TAG = process.argv[3] ?? 'after';
const TIER = process.argv[4] ?? 'all';
const VP = process.argv[5] ?? 'phone';
const STILLS = process.argv.includes('--stills');
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/catch_${TAG}_log.txt`;
fs.appendFileSync(LOG, `\n== ${new Date().toISOString()} ${TIER} ${VP}\n`);
const log = (...a) => { console.log(...a); fs.appendFileSync(LOG, a.join(' ') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// species, size (cm), seed the record first (so it is a repeat), and how long to record after the landing
const CASES = {
  common: { id: 'pile_perch', size: 27.5, repeat: true, after: 3200 },
  first: { id: 'striped_seaperch', size: 30.2, repeat: false, after: 4200 },
  uncommon: { id: 'copper_rockfish', size: 44.0, repeat: false, after: 4400 },
  rare: { id: 'lingcod', size: 104.0, repeat: false, after: 5600 },
  legendary: { id: 'bluntnose_sixgill', size: 310, repeat: false, after: 7600 },
};

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
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const phone = VP === 'phone';
const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); });
// a real gesture so the audio context runs (the sequence drives the fanfare)
if (phone) await page.touchscreen.tap(viewport.width / 2, viewport.height * 0.35); else await page.mouse.click(viewport.width / 2, viewport.height * 0.35);
const hotspots = await page.evaluate(() => window.__debug.hotspots());
await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hotspots[0]);
await sleep(2500);
const hasNew = await page.evaluate(() => typeof window.__debug.forceCatch === 'function');
log(`build has forceCatch: ${hasNew}`);

const cdp = await ctx.newCDPSession(page);
async function record(tier) {
  const C = CASES[tier];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `catch_${tier}_`));
  // prepare: seed the record (repeat) or not, force the species/size, cast and hook it
  await page.evaluate(({ C, hasNew }) => {
    const d = window.__debug;
    if (hasNew) d.forceCatch(C.id, C.size, { first: !C.repeat, cast: false });
    else d.nextCatch(C.id, C.size);
    if (C.repeat && d.seedRecord) d.seedRecord(C.id, C.size + 5);
  }, { C, hasNew });
  await page.evaluate(() => window.__debug.action());
  await sleep(1300);
  await page.evaluate(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.__debug.action());
  await sleep(900);
  // record from just before the fish comes out
  const frames = [];
  let t0 = 0;
  const onFrame = async (f) => {
    if (!t0) t0 = f.metadata.timestamp;
    frames.push({ t: f.metadata.timestamp - t0, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1, maxWidth: viewport.width * (phone ? 2 : 1), maxHeight: viewport.height * (phone ? 2 : 1) });
  await sleep(250);
  const tLand = Date.now();
  await page.evaluate(() => window.__debug.landNow());
  const beats = [];
  const poll = setInterval(async () => {
    try {
      const b = await page.evaluate(() => window.__debug.catchBeat?.() ?? (document.querySelector('#card:not(.hidden)') ? 'card' : document.querySelector('#catch-slip:not(.hidden)') ? 'slip' : window.__debug.state.phase));
      if (!beats.length || beats[beats.length - 1].b !== b) beats.push({ b, ms: Date.now() - tLand });
    } catch { /* page busy */ }
  }, 60);
  await sleep(C.after);
  clearInterval(poll);
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  const fps = await page.evaluate(() => window.__debug.state.fps);
  log(`[${tier}] ${C.id} ${C.size} cm repeat=${C.repeat} frames=${frames.length} fps=${fps} beats=${beats.map((x) => `${x.b}@${x.ms}`).join(' ')}`);
  // write frames with real durations → GIF
  const list = [];
  frames.forEach((f, i) => {
    const p = path.join(dir, `f${String(i).padStart(4, '0')}.jpg`);
    fs.writeFileSync(p, Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? f.t + 0.066;
    list.push(`file '${p.replace(/\\/g, '/')}'\nduration ${Math.max(0.016, next - f.t).toFixed(3)}`);
  });
  if (frames.length) list.push(`file '${path.join(dir, `f${String(frames.length - 1).padStart(4, '0')}.jpg`).replace(/\\/g, '/')}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
  const gif = `${OUT}/catch_${TAG}_${tier}_${VP}.gif`;
  const w = phone ? 360 : 640;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', `fps=15,scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
  log(`[${tier}] gif ${gif} (${(fs.statSync(gif).size / 1024).toFixed(0)} KB)`);
  fs.rmSync(dir, { recursive: true, force: true });
  await closeCatch();
  if (STILLS) await stills(tier, beats);
}

async function closeCatch() {
  // close the card (Keep / Let go) so the next catch starts clean
  await page.evaluate(() => window.__debug.closeCatch?.(false));
  await sleep(300);
  await page.evaluate(() => { const b = document.querySelector('#card:not(.hidden) #card-release') ?? document.querySelector('#catch-slip:not(.hidden) #slip-release'); b?.click(); });
  await sleep(1500);
}

/** Full-resolution PNG stills (page.screenshot at the device scale) of the same catch, replayed:
 *  one just after each beat starts and one at the end of the line (just before the card). */
async function stills(tier, beats) {
  const C = CASES[tier];
  await page.evaluate(({ C }) => window.__debug.forceCatch(C.id, C.size, { first: !C.repeat }), { C });
  await page.evaluate(() => window.__debug.action());
  await sleep(1300);
  await page.evaluate(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.__debug.action());
  await sleep(900);
  const shots = [];
  beats.forEach((b, i) => {
    if (b.b === 'reeling') return;
    shots.push({ at: b.ms + (b.b === 'arc' ? 380 : b.b === 'reveal' ? 260 : b.b === 'card' || b.b === 'slip' ? 700 : 300), label: b.b });
    if (b.b === 'line' && beats[i + 1]) shots.push({ at: beats[i + 1].ms - 160, label: 'line-full' });
  });
  shots.sort((a, b) => a.at - b.at);
  const t0 = Date.now();
  await page.evaluate(() => window.__debug.landNow());
  let n = 0;
  for (const s of shots) {
    const wait = s.at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const file = `${OUT}/catch_${TAG}_${tier}_${VP}_${String(n++).padStart(2, '0')}_${s.label}.png`;
    await page.screenshot({ path: file });
  }
  log(`[${tier}] ${n} full-res stills (${shots.map((s) => s.label).join(', ')})`);
  await sleep(800);
  await closeCatch();
}

const tiers = TIER === 'all' ? ['common', 'uncommon', 'rare', 'legendary'] : TIER.split(',');
for (const t of tiers) await record(t);
log(`console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
await browser.close();
