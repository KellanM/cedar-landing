// node scripts/clock_verify.mjs [base] — the game clock advances, the HUD shows it, looks blend through a day
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const OUT = path.resolve('screenshots/clock'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.markRevealSeen?.());
const hud = () => page.evaluate(() => ({ text: document.getElementById('clock-time').textContent, tod: window.__debug.state.tod }));
let fail = 0; const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
const h0 = await hud(); await sleep(21000); const h1 = await hud();
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
check(mins(h1.text) - mins(h0.text) >= 10 && mins(h1.text) - mins(h0.text) <= 40, `clock advances in real time: ${h0.text} → ${h1.text} after 21 s`);
for (const h of [3, 6.2, 8.3, 10.7, 12.3, 15, 18.5, 19.8, 21.1, 23.2]) {
  const t = await page.evaluate((x) => window.__debug.setClock(x), h); await sleep(1600);
  const s = await hud();
  check(s.text === t, `HUD shows ${t} (look ${s.tod})`);
  await page.screenshot({ path: `${OUT}/clock_${t.replace(':', '')}.png` });
}
await page.evaluate(() => window.__debug.ui.openLog('map')); await sleep(600);
const a = await hud(); await sleep(4000); const b = await hud();
check(a.text === b.text, `clock paused while the Log is open (${a.text} → ${b.text})`);
check(errs.length === 0, `console errors: ${errs.length} ${errs.slice(0, 2).join(' | ')}`);
console.log(fail ? `CLOCK VERIFY: ${fail} FAIL` : 'CLOCK VERIFY: ALL PASS');
await browser.close();
