// Log > Dev tab: weather / mist / tide / clock controls drive the game; Settings has Screen flashes, no font note.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let fails = 0; const check = (n, ok, s) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`, s === undefined ? '' : JSON.stringify(s)); if (!ok) fails++; };
const errors = [];
for (const [vp, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['landscape', { width: 844, height: 390 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE + '?debug'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
  await p.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.ui.openLog('settings'); });
  await new Promise((r) => setTimeout(r, 700));
  await p.screenshot({ path: `screenshots/devtab_${vp}_settings.png` });
  if (vp === 'phone') {
    check('settings: Screen flashes row', await p.evaluate(() => !!document.getElementById('set-flash')));
    check('settings: no font note', await p.evaluate(() => !document.body.innerText.includes('SIL Open Font')));
  }
  await p.click('.ribbon[data-tab="dev"]'); await new Promise((r) => setTimeout(r, 500));
  check(`${vp}: dev tab ribbon visible`, await p.evaluate(() => { const r = document.querySelector('.ribbon[data-tab="dev"]').getBoundingClientRect(); return r.width > 20 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
  await p.screenshot({ path: `screenshots/devtab_${vp}_dev.png` });
  if (vp === 'phone') {
    await p.click('#dev-weather button[data-v="storm"]'); await new Promise((r) => setTimeout(r, 600));
    let w = await p.evaluate(() => window.__debug.rain());
    check('storm button → storm', w.storm >= 0.99, { storm: w.storm, words: w.words });
    await p.click('#dev-tide button[data-v="lowest"]'); await new Promise((r) => setTimeout(r, 400));
    let t = await p.evaluate(() => window.__debug.tide());
    check('tide lowest → -1.72', Math.abs(t.y + 1.72) < 0.02, t);
    await p.click('#dev-clock button[data-v="19.83"]'); await new Promise((r) => setTimeout(r, 400));
    check('clock dusk', /19:[45]0/.test(await p.evaluate(() => document.body.innerText)));
    await p.click('#dev-mist button[data-v="heavy"]'); await new Promise((r) => setTimeout(r, 400));
    check('mist heavy', (await p.evaluate(() => window.__debug.mist())).mist === 0.9);
    await p.screenshot({ path: 'screenshots/devtab_phone_dev_after.png' });
    await p.click('#dev-weather button[data-v="auto"]'); await p.click('#dev-tide button[data-v="auto"]'); await p.click('#dev-mist button[data-v="auto"]');
    await new Promise((r) => setTimeout(r, 400));
    w = await p.evaluate(() => window.__debug.rain()); t = await p.evaluate(() => window.__debug.tide());
    check('auto restores models', w.storm < 0.99 && t.pinned === null, { storm: w.storm, pinned: t.pinned });
    await p.click('[data-close], .log-close, #log-close').catch(() => {});
    await p.evaluate(() => window.__debug.ui.openLog('dev')); await new Promise((r) => setTimeout(r, 300));
    await p.evaluate(() => document.querySelector('.ribbon[data-tab="settings"]').click()); await new Promise((r) => setTimeout(r, 300));
    await p.click('#set-flash'); await new Promise((r) => setTimeout(r, 300));
    check('flash toggle persists off', await p.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => /flash/i.test(k))) === 'off'));
  }
  await ctx.close();
}
console.log('console errors:', errors.length, errors.slice(0, 3).join(' | '));
console.log(fails || errors.length ? 'DEV TAB: FAIL' : 'DEV TAB: ALL PASS');
await b.close();
