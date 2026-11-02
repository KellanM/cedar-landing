// Captures the Shot_VillageReveal establishing move: node scripts/reveal.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5190/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: process.env.CHROME ?? exe, args: ['--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
const shot = await page.evaluate(() => window.__debug.teleportTo('Interact_SellFish', 60));
for (let i = 0; i < 4; i++) { await page.waitForTimeout(1100); await page.screenshot({ path: `screenshots/reveal_${i}.png` }); console.log(i, JSON.stringify((({ inShot, world }) => ({ inShot, world }))(await page.evaluate(() => window.__debug.state)))); }
console.log('teleported', shot, 'errors', errs);
await b.close();
