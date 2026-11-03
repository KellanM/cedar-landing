// Upgrades capture + verification: node scripts/shop_capture.mjs [baseUrl]
// Walks to the Chandlery and Shipwright, buys every upgrade (shells via __debug.upg.give), MEASURES
// that the gear changes fishing (reel time / slips through the real Fishing class, species reach
// by line depth, bait bias, cooler cap), paints every boat group + a flag, buys / sails the Packer
// (T1). Screenshots → screenshots/shop_<vp>_*.png, log → screenshots/shop_log.txt.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5195/cedar-landing/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY;

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const lines = [];
const log = (...a) => { console.log(...a); lines.push(a.join(' ')); };
const failures = [];
const check = (name, ok, what) => { if (!ok) { failures.push(`[${name}] ${what}`); log(`[${name}] FAIL: ${what}`); } else log(`[${name}] ok: ${what}`); };

const SAVE = {
  shells: 0, coolerCap: 2, records: { coho_salmon: { size: 60, stars: 1, count: 1 }, shiner_perch: { size: 12, stars: 1, count: 2 } }, seenReveal: true, reachedLanding: true,
  cooler: [{ speciesId: 'pile_perch', name: 'Pile Perch', size: 31.5, stars: 2, price: 11, color: '#8F9A8A', rarity: 'common' }],
  settings: { quality: 'high', autoReel: false, showFps: true, tod: null },
};

/** Runs N catches through the real Fishing class in-page (fixed dt) and returns mean time + slips. */
async function reelSim(page, pool, policy, n = 40) {
  return page.evaluate(([pool, policy, n]) => {
    const F = window.__debug.fishing;
    const hs = { name: 'sim', pos: [0, 0, -6], fish_pool: [pool], tier: 'good' };
    const tip = { x: 0, y: 1.7, z: 0 }, bp = { x: 0, y: 0, z: 0 };
    const dt = 1 / 60;
    let tSum = 0, slipSum = 0, landed = 0;
    for (let i = 0; i < n; i++) {
      F.cancel(); F.cast(hs, tip, bp);
      let g = 0;
      while (F.phase === 'casting' && g++ < 200) F.update(dt, false, tip, bp);
      F.debugForceBite();
      g = 0;
      while (F.phase !== 'bite' && g++ < 400) F.update(dt, false, tip, bp);
      F.press();
      let t = 0;
      while (F.phase === 'reeling' && t < 90) {
        const held = policy === 'hold' ? true : !(F.tension > 0.8 || (F.thrashing && F.tension > 0.45));
        F.update(dt, held, tip, bp); t += dt;
      }
      if (F.phase === 'landed') { landed++; tSum += t; slipSum += F.slips; }
      F.finish();
    }
    window.__debug.closeModals();
    return { landed, n, meanTime: +(tSum / Math.max(1, landed)).toFixed(2), meanSlips: +(slipSum / Math.max(1, landed)).toFixed(2) };
  }, [pool, policy, n]);
}

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), SAVE);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(1500);
  const st = () => page.evaluate(() => window.__debug.state);
  const up = () => page.evaluate(() => window.__debug.upg.state);
  const shot = (n) => page.screenshot({ path: `${OUT}/shop_${name}_${n}.png` });
  const u0 = await up();
  log(`[${name}] boats loaded`, JSON.stringify(u0.boats), 'model', u0.model, 'paintable', u0.paintable, 'cap', u0.coolerCap);
  check(name, u0.boats.includes('BOAT_T1'), 'BOAT_T1 loaded from protos.glb');

  // ---- BEFORE measurements (starter gear)
  await page.evaluate(() => window.__debug.setAutoReel(false));
  const before = {
    perchSkill: await reelSim(page, 'pile perch', 'skill'), perchHold: await reelSim(page, 'pile perch', 'hold'), cohoHold: await reelSim(page, 'coho salmon', 'hold'), cohoSkill: await reelSim(page, 'coho salmon', 'skill'),
    reachChannel: await page.evaluate(() => window.__debug.upg.reach('Channel') ?? window.__debug.upg.reach('HS')),
  };
  log(`[${name}] BEFORE reel`, JSON.stringify(before));
  const hsNames = await page.evaluate(() => window.__debug.hotspots());
  const reachAll0 = await page.evaluate((ns) => ns.map((n) => [n, window.__debug.upg.reach(n)]), hsNames);
  const fishable0 = reachAll0.filter(([, r]) => r.reach.length).length;
  log(`[${name}] hotspots fishable with cotton handline: ${fishable0}/${hsNames.length}`);

  // ---- baseline: the Little Troller at the dock
  await page.evaluate(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
  await sleep(1200);
  await shot('00_baseline_t0');

  // ---- walk to the Chandlery on foot (real interact path)
  await page.keyboard.press('q'); // Ashore: the second context action (the cooler has fish → the main one sells)
  await sleep(1500);
  let s = await st();
  if (s.foot.mode !== 'foot') { await page.evaluate(() => window.__debug.stepAshore()); await sleep(1500); s = await st(); }
  check(name, s.foot.mode === 'foot', 'step ashore');
  const ints = await page.evaluate(() => window.__debug.state && Object.fromEntries(['Interact_BuyTackle', 'Interact_BuyBait', 'Interact_UpgradeBench', 'Interact_BuyBoat'].map((n) => [n, window.__debug.hotspotPos(n) ?? null])));
  void ints;
  const walkTo = async (x, z) => {
    await page.evaluate(([x, z]) => window.__debug.footPathTo(x, z), [x, z]);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) { if (!(await st()).foot.autoWalk) break; await sleep(100); }
    await page.evaluate(() => window.__debug.footWalkTo(null));
    return st();
  };
  // shop positions from gameplay.json (three coords)
  const P = { tackle: [18, 144], bait: [15, 150], bench: [16, 125], yard: [8, 131] };
  await walkTo(21.2, 150.9);
  await walkTo(16.3, 147.8);
  s = await walkTo(P.tackle[0] + 0.5, P.tackle[1] + 1.5);
  log(`[${name}] at tackle: feet`, JSON.stringify(s.foot.feet), 'ctx', s.foot.ctx);
  if (s.foot.ctx && /chandlery/i.test(s.foot.ctx)) { await page.keyboard.press('e'); log(`[${name}] opened chandlery by walking up + E`); }
  else { log(`[${name}] FALLBACK: chandlery via debug (ctx was ${s.foot.ctx})`); await page.evaluate(() => window.__debug.upg.openShop('rod')); }
  await sleep(700);
  check(name, (await up()).shopOpen, 'chandlery open');
  await shot('01_chandlery_rod_broke');
  await page.evaluate(() => window.__debug.upg.give(4000));
  await page.evaluate(() => window.__debug.upg.shopTab('rod'));
  await sleep(300);
  await shot('02_chandlery_rod_affordable');

  // buy every tackle tier via the real buttons
  for (const t of ['rod', 'line', 'reel', 'cooler', 'bait']) {
    await page.evaluate((t) => window.__debug.upg.shopTab(t), t);
    await sleep(250);
    if (t === 'line') await shot('03_line_reach_before');
    let bought = 0;
    for (let k = 0; k < 4; k++) {
      const btn = await page.$('#shop-list .ticket:not([disabled])');
      if (!btn) break;
      await btn.click();
      bought++;
      await sleep(t === 'rod' && k === 0 ? 120 : 450);
      if (t === 'rod' && k === 0) await shot('04_rod_bought_stamp');
    }
    log(`[${name}] bought ${bought} × ${t}`);
    await sleep(300);
    await shot(`05_${t}_after`);
  }
  const u1 = await up();
  log(`[${name}] gear after`, JSON.stringify(u1.gear), 'cap', u1.coolerCap, 'baits', u1.baits.join(','));
  check(name, u1.rod === 2 && u1.line === 2 && u1.reel === 1 && u1.cooler === 2, 'all tackle tiers bought');
  check(name, u1.coolerCap === 6, 'cooler cap 2 → 6');

  // bait bias: herring vs clam at a salmon-bearing hotspot
  const reachNow = await page.evaluate((ns) => ns.map((n) => [n, window.__debug.upg.reach(n)]), hsNames);
  const salmonHs = reachNow.find(([, r]) => r.reach.some((x) => /salmon|trout|herring/i.test(x)) && r.reach.some((x) => !/salmon|trout|herring/i.test(x)))?.[0];
  await page.click('#shop-list [data-use="clam"]').catch(() => {});
  await sleep(150);
  const clamS = salmonHs ? await page.evaluate((n) => window.__debug.upg.sample(n, 600), salmonHs) : null;
  await page.evaluate(() => { const b = document.querySelector('#shop-list [data-use="herring"]'); b && b.click(); });
  await sleep(150);
  const herrS = salmonHs ? await page.evaluate((n) => window.__debug.upg.sample(n, 600), salmonHs) : null;
  const salmonShare = (o) => o ? +(Object.entries(o).filter(([k]) => /salmon|trout|herring/i.test(k)).reduce((a, [, v]) => a + v, 0) / 600).toFixed(2) : null;
  log(`[${name}] bait @${salmonHs}: salmon share clam ${salmonShare(clamS)} → herring ${salmonShare(herrS)}`, JSON.stringify(herrS));
  check(name, salmonShare(herrS) > salmonShare(clamS), 'herring bait raises salmon share');
  await page.evaluate(() => { const b = document.querySelector('#shop-list [data-use="clam"]'); b && b.click(); });
  await shot('06_bait_select');

  // AFTER measurements
  const after = { perchSkill: await reelSim(page, 'pile perch', 'skill'), perchHold: await reelSim(page, 'pile perch', 'hold'), cohoHold: await reelSim(page, 'coho salmon', 'hold'), cohoSkill: await reelSim(page, 'coho salmon', 'skill') };
  log(`[${name}] AFTER reel`, JSON.stringify(after));
  check(name, after.perchSkill.meanTime < before.perchSkill.meanTime, `perch reel time (eased) ${before.perchSkill.meanTime}s → ${after.perchSkill.meanTime}s`);
  check(name, after.cohoSkill.meanTime < before.cohoSkill.meanTime, `coho reel time (eased) ${before.cohoSkill.meanTime}s → ${after.cohoSkill.meanTime}s`);
  check(name, after.perchHold.landed > before.perchHold.landed, `holding reel flat out lands perch ${before.perchHold.landed}/40 → ${after.perchHold.landed}/40 (slips ${before.perchHold.meanSlips} → ${after.perchHold.meanSlips})`);
  const reachAll1 = await page.evaluate((ns) => ns.map((n) => [n, window.__debug.upg.reach(n)]), hsNames);
  const fishable1 = reachAll1.filter(([, r]) => r.reach.length).length;
  const deep0 = reachAll0.reduce((a, [, r]) => a + r.deep.length, 0), deep1 = reachAll1.reduce((a, [, r]) => a + r.deep.length, 0);
  log(`[${name}] hotspots fishable: ${fishable0} → ${fishable1}; out-of-reach pool entries ${deep0} → ${deep1}`);
  check(name, deep1 < deep0, 'longer line reaches more species');
  await page.evaluate(() => window.__debug.upg.close());

  // ---- shipwright: walk to the bench
  s = await walkTo(16.3, 147.8);
  s = await walkTo(P.bench[0] + 1, P.bench[1] + 1.5);
  log(`[${name}] at bench: feet`, JSON.stringify(s.foot.feet), 'ctx', s.foot.ctx);
  if (s.foot.ctx && /shipwright/i.test(s.foot.ctx)) { await page.keyboard.press('e'); log(`[${name}] opened shipwright by walking up + E`); }
  else { log(`[${name}] FALLBACK: shipwright via debug (ctx was ${s.foot.ctx})`); await page.evaluate(() => window.__debug.upg.openShipwright('paint')); }
  await sleep(2200);
  check(name, (await up()).shipwrightOpen, 'shipwright open');
  check(name, (await up()).showcase, 'showcase camera orbits the boat');
  await shot('10_shipwright_paint');
  const PAINTS = { hull: '#3E5C7A', stripe: '#EEE8DA', trim: '#C8A24A', cabin: '#E9D9A0', roof: '#2F4A3A' };
  for (const [g, hex] of Object.entries(PAINTS)) {
    await page.click(`.sw-part[data-part="${g}"]`);
    await sleep(500);
    await page.click(`.sw-sw[data-hex="${hex}"]`);
    await sleep(900);
    await shot(`11_paint_${g}`);
  }
  const pend = await page.evaluate(() => window.__debug.upg.sw.pending);
  log(`[${name}] pending paint`, JSON.stringify(pend));
  await page.click('#sw-paint');
  await sleep(500);
  const u2 = await up();
  check(name, Object.keys(u2.paint.T0 ?? {}).length === 5, 'five paint groups saved on T0');
  await shot('12_paint_committed');

  await page.click('.upg-tab[data-tab="flag"]');
  await sleep(1500);
  await shot('13_flags');
  await page.click('.sw-flag[data-flag="moon"]');
  await sleep(500);
  check(name, await page.isVisible('.bill-wrap:not(.hidden)'), 'a new flag asks first (bill of sale)');
  await shot('13b_flag_bill');
  await page.click('#bill-yes');
  await sleep(1200);
  check(name, (await up()).flag === 'moon', 'bought + hoisted the Ringed moon flag');
  await shot('14_flag_hoisted');

  await page.click('.upg-tab[data-tab="boats"]');
  await sleep(1200);
  await shot('15_boats');
  await page.evaluate(() => window.__debug.upg.give(2000));
  await sleep(200);
  await page.evaluate(() => window.__debug.upg.sw.setTab('boats'));
  await sleep(200);
  await page.click('[data-buyboat="T1"]');
  await sleep(500);
  check(name, await page.isVisible('.bill-wrap:not(.hidden)'), 'the Packer asks first (bill of sale)');
  await shot('15b_boat_bill');
  await page.click('#bill-yes');
  await sleep(1300);
  await shot('16_launch_title');
  await sleep(2000);
  await shot('17_launch_orbit');
  const u3 = await up();
  check(name, u3.boat === 'T1' && u3.model === 'BOAT_T1', 'bought + switched to the Packer');
  check(name, u3.coolerCap === 12, 'Packer hold: cooler 6 → 12');
  // paint the Packer too (paint is per boat)
  await page.evaluate(() => window.__debug.upg.sw.setTab('paint'));
  await sleep(300);
  for (const [g, hex] of Object.entries({ hull: '#9B3328', stripe: '#24221F', roof: '#24221F', cabin: '#EEE8DA', trim: '#3E7F86' })) {
    await page.click(`.sw-part[data-part="${g}"]`); await sleep(150);
    await page.click(`.sw-sw[data-hex="${hex}"]`); await sleep(150);
  }
  await page.click('#sw-paint');
  await sleep(1200);
  await shot('18_packer_painted');
  await page.click('#sw-done');
  await sleep(500);

  // ---- board and sail the Packer
  await page.evaluate(() => window.__debug.board());
  await sleep(1500);
  await page.evaluate(() => window.__debug.viewHotspot(window.__debug.hotspots()[0], 30));
  await sleep(800);
  await page.keyboard.down('w');
  await sleep(3500);
  const sp1 = (await st()).boat.speed;
  await shot('19_packer_sailing');
  await page.keyboard.up('w');
  log(`[${name}] Packer speed after 3.5 s full throttle: ${sp1.toFixed(2)} m/s`);
  check(name, sp1 > 7.3, 'Packer is faster than the troller max (7 m/s)');
  // rough water: a rare hotspot casts with T1, refuses with T0
  const rare = await page.evaluate(() => window.__debug.upg.rareHotspots()[0]);
  if (rare) {
    await page.evaluate(() => window.__debug.upg.takeBoat('T0'));
    await page.evaluate((n) => window.__debug.teleportTo(n, 4), rare);
    await sleep(600);
    await page.evaluate(() => window.__debug.action());
    await sleep(300);
    const p0 = (await st()).phase;
    await shot('20_t0_rough_refused');
    await page.evaluate(() => window.__debug.upg.takeBoat('T1'));
    await page.evaluate((n) => window.__debug.teleportTo(n, 4), rare);
    await sleep(800);
    await page.evaluate(() => window.__debug.action());
    await sleep(1200);
    const p1 = (await st()).phase;
    await shot('21_t1_rough_cast');
    log(`[${name}] rare hotspot ${rare}: T0 phase ${p0}, T1 phase ${p1}`);
    check(name, p0 === 'idle' && p1 !== 'idle', 'rough outer grounds open with the Packer only');
  }
  const perf = await st();
  log(`[${name}] fps ${perf.fps} draws ${perf.drawCalls} tris ${perf.tris}`);
  // save/reload keeps everything
  await sleep(500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(1500);
  const u4 = await up();
  check(name, u4.boat === 'T1' && u4.model === 'BOAT_T1' && u4.flag === 'moon' && u4.coolerCap === 12, 'upgrades survive reload');
  await shot('22_after_reload');
  check(name, !errors.length, 'no console errors');
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

if (!ONLY || ONLY === 'phone') await run('phone', { width: 390, height: 844 }, true);
if (!ONLY || ONLY === 'desktop') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
log(failures.length ? `FAILED: ${failures.join('; ')}` : 'PASS');
fs.writeFileSync(`${OUT}/shop_log.txt`, lines.join('\n'));
process.exitCode = failures.length ? 1 : 0;
