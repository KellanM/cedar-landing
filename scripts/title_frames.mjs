// Fast look at the opening art: node scripts/title_frames.mjs [baseUrl] [tag] [views=phone,landscape,desktop] [--title] [--reduced]
// Blocks the JS bundle so the card is frozen as it paints before any script, then sets progress
// by hand (0.45). With --title, loads the game normally (?debug&title) and shoots the title screen.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5208/cedar-landing/';
const TAG = process.argv[3] ?? 'iter';
const VIEWS = (process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'phone,landscape,desktop').split(',');
const TITLE = process.argv.includes('--title');
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const V = { phone: [390, 844, true], landscape: [844, 390, true], desktop: [1440, 900, false], small: [360, 640, true] };
const errors = [];
for (const v of VIEWS) {
  const [width, height, mobile] = V[v];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, reducedMotion: process.argv.includes('--reduced') ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (!TITLE) {
    await page.route(/\/assets\/index-.*\.js$/, (r) => r.abort());
    await page.goto(BASE, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { document.getElementById('loading').style.setProperty('--p', '0.45'); document.getElementById('load-msg').textContent = 'Unrolling the chart…'; });
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: `${OUT}/title_${TAG}_${v}_card.png` });
  } else {
    await page.goto(BASE + '?debug&title', { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('title-open'), null, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.screenshot({ path: `${OUT}/title_${TAG}_${v}_title.png` });
  }
  await ctx.close();
}
await browser.close();
console.log('errors', errors.length, errors.slice(0, 5).join('\n'));
