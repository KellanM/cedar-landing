// node scripts/update_verify.mjs [base] — version stamp: tap → up to date; with a newer version.json → reloads with ?u=
// Part 2 (hud_flow_study P6): once playing, the stamp is gone; a new build never reloads by itself — a lane notice
// asks (Later / Reload), and Log > Settings > About can check + reload on a second tap.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5196/cedar-landing/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe') });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
let fail = 0; const check = (ok, m) => { console.log(ok ? 'PASS' : 'FAIL', m); if (!ok) fail++; };
let fake = null;
await page.route('**/version.json*', async (r) => { if (!fake) return r.continue(); await r.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) }); });
await page.goto(BASE); await page.waitForSelector('#version-stamp'); await sleep(9000);
await page.tap('#version-stamp'); await sleep(1200);
const t1 = await page.textContent('#version-stamp');
check(/Up to date/.test(t1), `tap with no update → "${t1}"`);
fake = { version: '9.9.9', commit: 'abc1234', built: 'x' };
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(1200);
const t2 = await page.textContent('#version-stamp');
check(/Update ready: v9\.9\.9/.test(t2), `resume with a newer build → "${t2}"`);
const nav = page.waitForURL(/[?&]u=abc1234/, { timeout: 5000 }).then(() => true).catch(() => false);
await page.tap('#version-stamp');
check(await nav, `tap reloads with ?u=abc1234 (${page.url()})`);
await page.waitForSelector('#version-stamp'); await sleep(3000);
check(!/[?&]u=/.test(page.url()), `URL tidied after reload (${page.url()})`);
const t3 = await page.textContent('#version-stamp');
check(/Update ready/.test(t3), `no reload loop when the page is still old → "${t3}"`);

// ---- part 2: mid-play
{
  fake = null;
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await c2.newPage();
  const errs = []; p2.on('pageerror', (e) => errs.push(String(e)));
  // coordinate taps: the title button and lane slips animate, so Playwright's 'stable' wait never settles
  const tapAt = async (sel) => { const e = await p2.waitForSelector(sel, { state: 'visible' }); const b = await e.boundingBox(); await p2.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  await p2.route('**/version.json*', async (r) => { if (!fake) return r.continue(); await r.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) }); });
  await p2.goto(BASE);
  await p2.waitForFunction(() => document.body.classList.contains('title-open'), null, { timeout: 180000 });
  await sleep(1200);
  await tapAt('#ld-go');
  await p2.waitForFunction(() => document.body.classList.contains('playing'), null, { timeout: 30000 });
  await sleep(6000);
  const vis = await p2.evaluate(() => { const e = document.getElementById('version-stamp'); return !!e && getComputedStyle(e).display !== 'none'; });
  check(!vis, 'playing: the version stamp is off the play HUD');
  fake = { version: '9.9.9', commit: 'abc1234', built: 'x' };
  const url0 = p2.url();
  await p2.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(2500);
  check(p2.url() === url0, `playing + new build: no reload by itself (${p2.url()})`);
  const notice = await p2.evaluate(() => [...document.querySelectorAll('#lane .lane-slip:not(.hidden)')].map((e) => e.textContent).join(' | '));
  check(/new version/i.test(notice) && /Reload/.test(notice) && /Later/.test(notice), `a lane notice asks first → "${notice}"`);
  await p2.screenshot({ path: 'screenshots/hud_P6_phone_2_update_notice.png' });
  await tapAt('#lane .lane-btn:not(.primary)'); // Later
  await sleep(800);
  check(p2.url() === url0, '"Later" keeps playing');
  // Log > Settings > About: the second, deliberate tap reloads
  await tapAt('#btn-log'); await sleep(900);
  await tapAt('.ribbon[data-tab="settings"]'); await sleep(700);
  await p2.evaluate(() => document.getElementById('set-update')?.scrollIntoView({ block: 'center' })); await sleep(300);
  const btxt = await p2.textContent('#set-update');
  check(/Reload into v9\.9\.9/.test(btxt), `About offers the reload → "${btxt}"`);
  await p2.screenshot({ path: 'screenshots/hud_P6_phone_3_about_reload.png' });
  const nav = p2.waitForURL(/[?&]u=abc1234/, { timeout: 5000 }).then(() => true).catch(() => false);
  await tapAt('#set-update');
  check(await nav, `tap reloads into the new build (${p2.url()})`);
  check(!errs.length, `no page errors (${errs.length})`, errs.slice(0, 2));
  await c2.close();
}
console.log(fail ? 'UPDATE VERIFY: FAIL' : 'UPDATE VERIFY: ALL PASS');
await browser.close();
