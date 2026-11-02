// Title / loading screen capture + timing: node scripts/title_capture.mjs [baseUrl] [tag] [--shots] [--runs=N]
//  timing: first paint / first contentful paint, loading card shown, world ready (chunks>0), loading done
//          (body.playing), unthrottled and throttled (≈Fast 4G + 4× CPU), N runs each, medians.
//  --shots: loading frames under heavy throttle + title/transition frames on phone / landscape / desktop
//           → screenshots/title_<tag>_*.png
// One browser, one context at a time (low-memory machine).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5208/cedar-landing/';
const TAG = process.argv[3] ?? 'after';
const SHOTS = process.argv.includes('--shots');
const RUNS = +(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 3);
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p)) : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// records loading-card milestones relative to navigation start
const MARKS = () => {
  window.__marks = {};
  const mark = (k) => { if (!(k in window.__marks)) window.__marks[k] = Math.round(performance.now()); };
  new MutationObserver(() => {
    const l = document.getElementById('loading');
    if (l?.classList.contains('shown')) mark('shown');
    if (l?.classList.contains('done')) mark('done');
    if (document.body?.classList.contains('playing')) mark('playing');
    if (document.body?.classList.contains('title-open')) mark('title');
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
};

const VIEWS = {
  phone: { viewport: { width: 390, height: 844 }, mobile: true },
  landscape: { viewport: { width: 844, height: 390 }, mobile: true },
  desktop: { viewport: { width: 1440, height: 900 }, mobile: false },
};

async function open(view, throttle, fresh = true) {
  const v = VIEWS[view];
  const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.mobile ? 2 : 1, isMobile: v.mobile, hasTouch: v.mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${view}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${view}: ${e}`));
  await page.addInitScript(MARKS);
  if (fresh) await page.addInitScript(() => { if (!sessionStorage.getItem('cl-cleared')) { localStorage.clear(); sessionStorage.setItem('cl-cleared', '1'); } });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: throttle.latency, downloadThroughput: throttle.down, uploadThroughput: throttle.down / 4 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle.cpu });
  }
  return { ctx, page, cdp };
}

const readTimes = (page) => page.evaluate(() => {
  const p = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
  return { fp: p['first-paint'], fcp: p['first-contentful-paint'], ...window.__marks };
});

async function timeRun(view, throttle) {
  const { ctx, page } = await open(view, throttle);
  await page.goto(BASE + '?debug', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 300000, polling: 100 });
  const ready = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForFunction(() => document.body.classList.contains('playing') || document.body.classList.contains('title-open'), null, { timeout: 60000, polling: 50 });
  const t = { ...(await readTimes(page)), ready };
  await ctx.close();
  return t;
}

const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const THR = { latency: 150, down: (9 * 1024 * 1024) / 8, cpu: 4 };    // ≈ "Fast 4G" + mid phone CPU
const SLOW = { latency: 300, down: (1.6 * 1024 * 1024) / 8, cpu: 6 }; // ≈ slow 3G-ish, to see the card

const timing = {};
for (const [name, thr] of [['fast', null], ['throttled', THR]]) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await timeRun('phone', thr));
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r)))];
  timing[name] = { median: Object.fromEntries(keys.map((k) => [k, med(runs.map((r) => r[k]))])), runs };
  console.log(TAG, name, JSON.stringify(timing[name].median));
}
fs.writeFileSync(`${OUT}/title_${TAG}_timing.json`, JSON.stringify(timing, null, 2));

if (SHOTS) {
  for (const view of Object.keys(VIEWS)) {
    // loading frames under a slow link
    const { ctx, page, cdp } = await open(view, SLOW);
    await page.goto(BASE + '?debug&title', { waitUntil: 'commit' });
    const t0 = Date.now();
    const at = [700, 2500, 6000];
    for (const [i, ms] of at.entries()) {
      await sleep(Math.max(0, ms - (Date.now() - t0)));
      await page.screenshot({ path: `${OUT}/title_${TAG}_${view}_load${i + 1}.png` }).catch(() => {});
    }
    // let the rest load at full speed
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 300000 });
    // the title screen (if any) and the hand-off into play
    await sleep(900);
    await page.screenshot({ path: `${OUT}/title_${TAG}_${view}_title.png` });
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/title_${TAG}_${view}_title2.png` });
    const hasTitle = await page.evaluate(() => document.body.classList.contains('title-open'));
    if (hasTitle) {
      const vp = VIEWS[view].viewport;
      if (VIEWS[view].mobile) await page.touchscreen.tap(vp.width / 2, vp.height * 0.5); else await page.mouse.click(vp.width / 2, vp.height * 0.5);
      for (const [i, ms] of [350, 450, 600].entries()) { await sleep(ms); await page.screenshot({ path: `${OUT}/title_${TAG}_${view}_handoff${i + 1}.png` }); }
    }
    await sleep(1800);
    await page.screenshot({ path: `${OUT}/title_${TAG}_${view}_play.png` });
    const st = await page.evaluate(() => ({ playing: document.body.classList.contains('playing'), title: document.body.classList.contains('title-open'), stamp: !!document.getElementById('version-stamp') }));
    console.log(TAG, view, JSON.stringify(st));
    await ctx.close();
  }
}

await browser.close();
console.log('console errors:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e);
