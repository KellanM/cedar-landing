// Catch show checks (docs/catch_study.md): node scripts/catch_verify.mjs <base>
// 1) tap-to-skip: a rare catch skipped during the headline reaches the card at once
// 2) repeat common reaches the slip in ≤ 2.5 s; legendary takes 5–6.5 s
// 3) reduced motion: no confetti, no flash, line appears whole; Screen flashes off: no flash
// 4) every species has a line; 0 console errors
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5240/cedar-landing/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`); if (!ok) fails++; };
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
  return d ? path.join(root, d, 'chrome-win64', 'chrome.exe') : undefined;
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

async function boot(prefs) {
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((p) => { localStorage.clear(); if (p) localStorage.setItem('salish-sea-ui-v1', JSON.stringify(p)); }, prefs);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.setAutoReel(false); });
  const hs = await page.evaluate(() => window.__debug.hotspots());
  await page.evaluate((h) => window.__debug.viewHotspot(h, 7), hs[0]);
  await sleep(2000);
}
async function catchOne(id, size, o, untilBeat = 'result', maxMs = 9000) {
  await page.evaluate(([id, size, o]) => window.__debug.forceCatch(id, size, { ...o, cast: true }), [id, size, o]);
  await page.waitForFunction(() => window.__debug.catchBeat() === 'arc', null, { timeout: 8000 }).catch(() => {});
  const t0 = Date.now();
  const seen = { flash: false, scraps: 0, fullLineAt: -1 };
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => ({ beat: window.__debug.catchBeat(), fx: window.__debug.catchFX(), flash: !!document.querySelector('.catch-flash.go'), text: document.querySelector('#cl-text')?.textContent ?? '', done: !!document.querySelector('.catchline.done') }));
    seen.flash ||= s.flash; seen.scraps = Math.max(seen.scraps, s.fx.scraps);
    if (s.beat === 'line' && seen.fullLineAt < 0 && s.done) seen.fullLineAt = Date.now() - t0;
    if (untilBeat !== 'result' && s.beat === untilBeat) return { ...seen, ms: Date.now() - t0, beat: s.beat };
    if (s.beat === 'card' || s.beat === 'slip') return { ...seen, ms: Date.now() - t0, beat: s.beat };
    await sleep(40);
  }
  return { ...seen, ms: -1, beat: await page.evaluate(() => window.__debug.catchBeat()) };
}
const close = async () => { await page.evaluate(() => window.__debug.closeCatch(false)); await sleep(800); };

await boot(null);
// lines for every species (static: fishdata ids vs catchlines keys)
{
  const ids = [...fs.readFileSync('src/game/fishdata.ts', 'utf8').matchAll(/S\('([a-z ]+)'/g)].map((m) => m[1].replace(/[^a-z]+/g, '_'));
  const lines = fs.readFileSync('src/game/catchlines.ts', 'utf8');
  const miss = ids.filter((id) => !lines.includes(`\n  ${id}: {`));
  check(ids.length > 30 && miss.length === 0, `a catch line for every species (${ids.length})`, miss.join(', '));
}
let r = await catchOne('pile_perch', 27, { first: false });
check(r.beat === 'slip' && r.ms > 0 && r.ms <= 2500, 'repeat common: slip within 2.5 s of the pull-out', `${r.beat} @ ${r.ms} ms`);
await close();
r = await catchOne('striped_seaperch', 30, { first: true });
check(r.beat === 'card' && r.ms > 0 && r.ms <= 2700, 'first common: card within ~2.5 s', `${r.beat} @ ${r.ms} ms`);
await close();
r = await catchOne('lingcod', 100, { first: true }, 'head');
await page.touchscreen.tap(195, 300);
await sleep(250);
const b = await page.evaluate(() => window.__debug.catchBeat());
check(b === 'card', 'tap during the headline skips to the card', `after tap: ${b}`);
await close();
r = await catchOne('bluntnose_sixgill', 300, { first: true });
check(r.beat === 'card' && r.ms >= 4500 && r.ms <= 6800, 'legendary: card after ~5–6 s', `${r.beat} @ ${r.ms} ms, confetti ${r.scraps}, flash ${r.flash}`);
check(r.scraps > 40 && r.flash, 'legendary: confetti + flash with default settings');
await close();

await boot({ reduceMotion: true });
r = await catchOne('lingcod', 100, { first: true });
check(r.beat === 'card', 'reduced motion: still reaches the card', `${r.ms} ms`);
check(r.scraps === 0 && !r.flash, 'reduced motion: no confetti, no flash', `scraps ${r.scraps} flash ${r.flash}`);
await close();

await boot(null);
await page.evaluate(() => window.__debug.flashes(false));
r = await catchOne('lingcod', 100, { first: true });
const flashOn = await page.evaluate(() => window.__debug.flashes());
check(flashOn === false && !r.flash, 'Screen flashes off: no catch flash', `flash ${r.flash} setting ${flashOn}`);
await close();

check(errors.length === 0, `console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(fails ? `CATCH VERIFY: ${fails} FAIL` : 'CATCH VERIFY: ALL PASS');
process.exit(fails ? 1 : 0);
