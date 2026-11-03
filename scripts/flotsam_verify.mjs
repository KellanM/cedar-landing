// Flotsam pick-up: prompt in range, Shells paid, piece lifts away, prompt gone, bottle note, respawn after 2 days.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(BASE + '?debug'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await p.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.mist(0.2); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, s) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`, s === undefined ? '' : JSON.stringify(s)); if (!ok) fails++; };
const st = () => p.evaluate(() => ({ interact: window.__debug.state.interact, shells: window.__debug.state.shells, label: document.getElementById('interact-label')?.textContent, hidden: document.getElementById('btn-interact').classList.contains('hidden') }));
// a barrel (F01 at -40,-40)
await p.evaluate(() => window.__debug.teleport(-36, -40, 0)); await sleep(1500);
let s = await st(); check('near F01: Pick up prompt', /F01/.test(s.interact ?? '') && !s.hidden, s);
await p.screenshot({ path: 'screenshots/flotsam_0_prompt.png' });
const before = s.shells;
await p.evaluate(() => window.__debug.interact()); await sleep(250);
await p.screenshot({ path: 'screenshots/flotsam_1_lift.png' });
await sleep(1200); s = await st();
check('barrel paid 6 Shells', s.shells - before === 6, { before, after: s.shells });
check('prompt gone after pick-up', !/F01/.test(s.interact ?? ''), s);
await p.screenshot({ path: 'screenshots/flotsam_2_after.png' });
// a hint bottle (F04 at -44,26)
await p.evaluate(() => window.__debug.teleport(-40, 26, 0)); await sleep(1500);
s = await st(); check('near F04 bottle: prompt', /F04/.test(s.interact ?? ''), s);
await p.evaluate(() => window.__debug.interact()); await sleep(1400);
const note = await p.evaluate(() => document.body.innerText.includes('When the lighthouse'));
check('bottle note shown', note);
await p.screenshot({ path: 'screenshots/flotsam_3_note.png' });
// persistence + respawn
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('salish-sea-save-v1')).flotsam);
check('saved', saved && saved.F01 !== undefined && saved.F04 === -1, saved);
await p.evaluate(() => { window.__debug.mist(null, 2); }); // two days on
await p.evaluate(() => window.__debug.teleport(-36, -40, 0)); await sleep(1500);
s = await st(); check('barrel drifted back after 2 days', /F01/.test(s.interact ?? ''), s);
await p.evaluate(() => window.__debug.teleport(-40, 26, 0)); await sleep(1500);
s = await st(); check('read bottle stays gone', !/F04/.test(s.interact ?? ''), s);
console.log('console errors:', errors.length, errors.slice(0, 3).join(' | '));
console.log(fails || errors.length ? 'FLOTSAM: FAIL' : 'FLOTSAM: ALL PASS');
await b.close();
