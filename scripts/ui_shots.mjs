// UI screenshot pass: node scripts/ui_shots.mjs [baseUrl] [only=phone,landscape,desktop]
// Captures every UI state of the "Grandmother's Logbook" HUD into screenshots/ui_<vp>_<state>.png.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5191/';
const ONLY = (process.argv[3] ?? 'phone,landscape,desktop').split(',');
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

const VPS = {
  phone: { viewport: { width: 390, height: 844 }, mobile: true },
  landscape: { viewport: { width: 844, height: 390 }, mobile: true },
  desktop: { viewport: { width: 1280, height: 800 }, mobile: false },
};

async function run(vp) {
  const { viewport, mobile } = VPS[vp];
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/ui_${vp}_${name}.png` }); console.log(vp, name); };
  const D = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await D(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await D(() => window.__debug.markRevealSeen());
  await sleep(1500);
  await shot('00_title_spawn');
  await sleep(4500);
  await shot('01_hud_spawn');

  // toasts
  await D(() => { window.__debug.ui.toast('Tied up snug. Progress saved.', 'good'); window.__debug.ui.toast("Gran's page 1 — added to the logbook", 'log'); });
  await sleep(300);
  await shot('02_toasts');
  await sleep(3000);

  // onboarding hint (cast) beside the button + errand chip
  await D(() => window.__debug.ui.hint('cast'));
  await D(() => window.__debug.ui.chip('Paddle over to Cedar Landing'));
  await sleep(500);
  await shot('03_hint_cast');
  await D(() => window.__debug.ui.hint('none'));

  // fishing: go to a hotspot, cast, bite
  const hs = (await D(() => window.__debug.hotspots()))[0];
  await D((h) => window.__debug.teleportTo(h, 4), hs);
  await sleep(700);
  await shot('04_at_ripples');
  await D(() => window.__debug.action());
  await sleep(1300);
  await shot('05_waiting');
  await D(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 });
  await sleep(120);
  await shot('06_strike');
  await D(() => window.__debug.action());
  await sleep(400);

  // tension states, held in place by an interval
  const hold = async (t, thrash, name) => {
    await D(([t, thrash]) => {
      clearInterval(window.__hold);
      const f = window.__debug.fishing;
      window.__hold = setInterval(() => { f.tension = t; f.thrashing = thrash; f.nextThrash = 1e9; f.thrashEnd = 1e9; f.distance = 6.4; f.reelHeld = true; f.maxTension = Math.min(f.maxTension, 0.7); }, 5);
    }, [t, thrash]);
    await sleep(350);
    await shot(name);
  };
  await hold(0.32, false, '07_reel_calm');
  await hold(0.68, false, '08_reel_strain');
  await hold(0.93, false, '09_reel_danger');
  await hold(0.55, true, '10_reel_thrash');
  await D(() => { clearInterval(window.__hold); const f = window.__debug.fishing; f.distance = -1; f.thrashing = false; f.tension = 0.2; f.reelHeld = true; });
  await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 8000 });
  await sleep(450);
  await shot('11_catch_bubble');
  await page.waitForSelector('#card.armed', { timeout: 6000 });
  await sleep(400);
  await shot('12_catch_card');
  await page.click('#card-keep');
  await sleep(700);

  // tier A slip (repeat species)
  await D(() => window.__debug.ui.catchDemo(window.__debug.state.cooler.length ? undefined : 'staghorn_sculpin'));
  await sleep(1200);
  await shot('13_catch_slip');
  await sleep(3200);

  // market
  await D(() => window.__debug.teleportTo('Interact_SellFish', 0));
  await sleep(900);
  await shot('14_market_dock');
  await page.keyboard.press('e');
  await sleep(700);
  await shot('15_market');
  await page.click('#market-board');
  await sleep(400);
  await shot('16_price_board');
  await page.click('#market-board');
  await sleep(200);
  const tickets = await page.$$('.ticket');
  if (tickets.length) { await tickets[0].click(); await sleep(260); await shot('17_sold'); }
  await sleep(900);
  await page.click('#sell-close');
  await sleep(300);

  // the Log
  await D(() => { window.__debug.ui.revealAll(); window.__debug.ui.visitAll(); });
  for (const tab of ['errands', 'fish', 'map', 'pages', 'settings']) {
    await D((t) => window.__debug.ui.openLog(t), tab);
    await sleep(tab === 'map' ? 1400 : 700);
    await shot(`18_log_${tab}`);
  }
  await D(() => window.__debug.ui.openLog('fish', { species: 'staghorn_sculpin' }));
  await sleep(700);
  await shot('19_log_fish_detail');
  await D(() => window.__debug.ui.closeLog());
  await sleep(300);

  // components
  await D(() => window.__debug.ui.title('Cedar Landing', 'where Gran kept her boat'));
  await sleep(2000);
  await shot('20_title_card');
  await sleep(3200);
  D(() => window.__debug.ui.dialogue('Mae', 'Bring me a starry flounder and I\'ll pay double.'));
  await sleep(2200);
  await shot('21_dialogue');
  await page.keyboard.press('1');
  await sleep(300);
  await D(() => window.__debug.ui.dive());
  await sleep(300);
  await shot('22_dive_stub');
  await D(() => { document.querySelectorAll('.dive-hud').forEach((e) => e.remove()); document.body.classList.remove('underwater'); });
  await D(() => window.dispatchEvent(new Event('blur')));
  await sleep(300);
  await shot('23_pause_slip');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await sleep(300);

  // left-handed mirror + quiet mode
  await D(() => window.__debug.ui.lefty(true));
  await D(() => window.__debug.teleportTo(window.__debug.hotspots()[0], 4));
  await sleep(600);
  await shot('40_lefty');
  await D(() => window.__debug.ui.lefty(false));
  await D(() => window.__debug.teleportTo('Interact_MoorKeeper', 4));
  await sleep(400);
  await D(() => window.__debug.ui.quiet());
  await sleep(700);
  await shot('41_quiet_mode');

  // time-of-day contrast set
  for (let i = 0; i < 5; i++) {
    const tod = (await D(() => window.__debug.state)).tod;
    await shot(`30_tod_${tod}`);
    await D(() => window.__debug.cycleTOD());
    await sleep(400);
  }
  console.log(vp, 'console errors:', errors.length, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

for (const vp of ONLY) await run(vp);
await browser.close();
