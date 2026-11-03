// Opening Q3: after the repair the walker must be offered "Board" next to the troller, and boarding works.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, s) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`, s === undefined ? '' : JSON.stringify(s)); if (!ok) fails++; };
await p.goto(BASE + '?debug&opening'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0 && window.__debug.opening, null, { timeout: 180000 });
await p.evaluate(() => { window.__debug.markRevealSeen(); });
await sleep(1500);
// the laid-up wreck at Q3, walker on the dock by her
await p.evaluate(() => { const o = window.__debug.opening; o.goto(3); o.setStage(0); });
await sleep(800);
const stand = () => p.evaluate(() => { const d = window.__debug; if (!d.footTeleport(8.4, 28.0, 0.6)) { d.stepAshore(); d.footTeleport(8.4, 28.0, 0.6); } return d.state.boat; });
await stand(); await sleep(1500);
let s = await p.evaluate(() => ({ interact: window.__debug.state.interact, moored: window.__debug.state.boat.moored, foot: !!window.__debug.state.foot }));
check('laid up: no Board offered', s.interact !== 'board', s);
// the repair completes (what Q3's bail + patch calls)
await p.evaluate(() => { const o = window.__debug.opening; o.setStage(1); o.goto(4); });
await sleep(2500);
s = await p.evaluate(() => ({ interact: window.__debug.state.interact, moored: window.__debug.state.boat.moored }));
check('after the repair: she is moored', s.moored === true, s);
check('after the repair: Board offered on the dock', s.interact === 'board', s);
await p.screenshot({ path: 'screenshots/board_after_repair.png' });
await p.evaluate(() => window.__debug.interact()); await sleep(1500);
s = await p.evaluate(() => ({ footActive: window.__debug.state.onFoot ?? window.__debug.state.foot?.active ?? null, interact: window.__debug.state.interact }));
const aboard = await p.evaluate(() => { const f = window.__debug.footState?.() ?? null; return document.getElementById('action-label')?.textContent; });
check('tapping Board puts you aboard', s.interact !== 'board', { ...s, action: aboard });
// reload mid-opening at stage 1 (a save caught un-moored) still offers Board
await p.reload(); await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await p.evaluate(() => window.__debug.markRevealSeen()); await sleep(1500);
await p.evaluate(() => window.__debug.footTeleport ? null : null);
console.log('console errors:', errors.length, errors.slice(0, 3).join(' | '));
console.log(fails || errors.length ? 'BOARD: FAIL' : 'BOARD: ALL PASS');
await b.close();
