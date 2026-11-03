// HUD flow study P1–P8 verify + after-shots: node scripts/hud_verify.mjs [baseUrl] [vps=phone,landscape,desktop] [parts=p1,...]
// Full-resolution shots (phone/landscape DPR 3, desktop DPR 2), one image per state:
//   screenshots/hud_P<n>_<vp>_<state>.png
// Checks (FAIL lines + non-zero exit):
//   P1 one notice at a time (queue), no lane/hint/compass overlap, stale cooler hint retired, taps dismiss hints, one Log badge
//   P2 primary/secondary context at the chandlery counter (crier nearby) and the shipwright bench (Pip nearby) open the shop
//   P3 full cooler: Cast stays live, the card offers "Swap it in", species logged, the swap happens; tier-A slip offers Swap
//   P4 boats + flags need the bill-of-sale second tap; "Not yet" spends nothing
//   P5 market sheet: all rows of a 6-fish cooler visible, Prices is a tab, Sell all right of Done, no bark over the sheet
//   P6 version stamp hidden in play; About has version + check button
//   P7 toggles / paint chips / shop tabs ≥44 px and on screen; Strike! splat fully on screen
//   P8 first minute: reel never says Ashore; Ashore is a context action; no hint while the area card is up; "1 new" badge
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5234/cedar-landing/';
const VPS = (process.argv[3] ?? 'phone,landscape,desktop').split(',');
const PARTS = new Set((process.argv[4] ?? 'p8,p1,p2,p3,p4,p5,p6,p7').split(','));
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const exe = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((e) => fs.existsSync(e));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = { phone: [390, 844, true, 3], landscape: [844, 390, true, 3], desktop: [1440, 900, false, 2] };
let fails = 0;
const allErrors = [];
const fish = (speciesId, name, size, stars, price, rarity = 'common') => ({ speciesId, name, size, stars, price, color: '#8F9A8A', rarity });

async function run(vp) {
  const [W, H, mobile, dpr] = V[vp];
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const D = (fn, a) => page.evaluate(fn, a);
  const st = () => D(() => window.__debug.state);
  const shot = async (p, name) => { await page.screenshot({ path: `${OUT}/hud_${p}_${vp}_${name}.png` }); console.log(`  shot hud_${p}_${vp}_${name}`); };
  const check = (id, ok, what, data) => { console.log(`${ok ? 'PASS' : 'FAIL'} [${vp}] ${id}: ${what}`, data === undefined ? '' : JSON.stringify(data)); if (!ok) fails++; };
  const rect = (sel) => D((s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
  const overlap = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  const tap = async (sel) => {
    const el = await page.waitForSelector(sel, { state: 'visible', timeout: 6000 });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(120);
    const b = await el.boundingBox();
    if (mobile) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  const boot = async (save, opts = {}) => {
    await page.goto(BASE + (opts.title ? '?debug&title' : '?debug'), { waitUntil: 'load' });
    await D(() => localStorage.clear());
    if (save) await D((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), save);
    await page.reload({ waitUntil: 'load' });
    if (opts.title) return;
    await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
    await D(() => window.__debug.markRevealSeen());
    await sleep(opts.wait ?? 2500);
  };
  const walkTo = async (x, z, max = 30000) => {
    await D(([x, z]) => window.__debug.footPathTo(x, z), [x, z]);
    const t0 = Date.now();
    while (Date.now() - t0 < max) { if (!(await st()).foot.autoWalk) break; await sleep(120); }
    await D(() => window.__debug.footWalkTo(null));
    return st();
  };
  const section = async (id, f) => { if (!PARTS.has(id)) return; console.log(`--- ${vp} ${id}`); try { await f(); } catch (e) { check(id, false, 'section threw', String(e).slice(0, 300)); } };

  // ------------------------------------------------------------------ P8 first minute (real title flow)
  await section('p8', async () => {
    await boot(null, { title: true });
    await page.waitForFunction(() => document.body.classList.contains('title-open'), null, { timeout: 180000 });
    await sleep(1500);
    await shot('P8', '0_title_stamp');
    check('P6', !!(await rect('#version-stamp')), 'version stamp shows on the title');
    await tap('#ld-go');
    const seen = { hintDuringCard: false, reelAshore: false };
    for (let i = 0; i < 40; i++) {
      const r = await D(() => ({ titling: document.body.classList.contains('titling') || document.querySelector('.title-card:not(.hidden)') !== null, hint: window.__debug.ui.hintShown(), label: document.getElementById('action-label').textContent, away: document.getElementById('btn-action').classList.contains('away') }));
      if (r.titling && r.hint) seen.hintDuringCard = true;
      if (!r.away && /ashore/i.test(r.label)) seen.reelAshore = true;
      if (i === 8) await shot('P8', '1_area_card_no_hint');
      await sleep(300);
    }
    await page.waitForFunction(() => !window.__debug.state.inShot, null, { timeout: 30000 }).catch(() => {});
    await sleep(3500);
    const s = await st();
    check('P8', !seen.hintDuringCard, 'no onboarding hint while the area card / reveal is up');
    check('P8', !seen.reelAshore, 'the big circle never says Ashore');
    check('P6', !(await rect('#version-stamp')), 'version stamp hidden once playing');
    const badge = await D(() => window.__debug.ui.badge());
    check('P8', badge === '1 new', 'Log badge reads "1 new" on minute one', badge);
    const ctx2 = await D(() => ({ p: document.getElementById('interact-label').textContent, p2: document.getElementById('btn-interact2').classList.contains('hidden') ? null : document.getElementById('interact2-label').textContent }));
    check('P8', /ashore/i.test(`${ctx2.p} ${ctx2.p2}`), 'Ashore is offered as a context action at the dock', { ...ctx2, interact: s.interact, interact2: s.interact2 });
    await shot('P8', '2_settled_dock');
    // Ashore via the context buttons
    if (ctx2.p2 && /ashore/i.test(ctx2.p2)) await tap('#btn-interact2'); else await tap('#btn-interact');
    await sleep(1800);
    const s2 = await st();
    check('P8', s2.foot.mode === 'foot', 'context Ashore steps ashore', s2.foot.mode);
    await shot('P8', '3_ashore_by_context');
  });

  // ------------------------------------------------------------------ P1 notice lane + hints + badge
  await section('p1', async () => {
    await boot({ shells: 40, coolerCap: 2, cooler: [fish('staghorn_sculpin', 'Staghorn Sculpin', 20, 2, 7)], records: { staghorn_sculpin: { size: 20, stars: 2, count: 1 } }, seenReveal: true, reachedLanding: true, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } });
    await D(() => window.__debug.ui.hint('none'));
    await D(() => window.__debug.teleportTo('Interact_MoorKeeper', 4)); await sleep(1500);
    // a burst: errand note, two toasts and a warning arrive together → one at a time
    await D(() => { window.__debug.ui.chip('Tie the Little Troller up at a dock'); window.__debug.ui.toast('Hauled aboard a barrel · +6 Shells', 'good'); window.__debug.ui.toast('Fog rolling in', 'log'); window.__debug.ui.toast('Mind the rocks', 'warn'); });
    let maxShown = 0, order = [];
    for (let i = 0; i < 70; i++) {
      const n = await D(() => document.querySelectorAll('#lane .lane-slip:not(.hidden)').length);
      maxShown = Math.max(maxShown, n);
      const l = await D(() => window.__debug.ui.lane());
      if (l.showing && order[order.length - 1] !== l.showing) order.push(l.showing);
      if (i === 3) await shot('P1', '1_lane_one_at_a_time');
      await sleep(250);
    }
    check('P1', maxShown <= 1, 'never more than one notice on screen', maxShown);
    const iw = order.findIndex((t) => /rocks/i.test(t)), ib = order.findIndex((t) => /barrel/i.test(t));
    check('P1', iw >= 0 && ib > iw && order.some((t) => /Little Troller/.test(t)), 'queued notices shown in turn: the warning ahead of the reward, the errand note not lost', order);
    // the old pile-up: cooler hint + errand + compass + save toast at the dock
    await D(() => window.__debug.ui.hint('cooler'));
    await sleep(400);
    await tap('#btn-interact'); // Tie up → "Tied up snug. Progress saved."
    await sleep(500);
    const r = { lane: await rect('#lane .lane-slip:not(.hidden)'), hint: await rect('#hints .hint:not(.hidden) p'), compass: await rect('#compass'), pinned: await rect('.lane-pinned') };
    const laneTxt = await D(() => document.querySelector('#lane .lane-slip:not(.hidden)')?.textContent ?? '');
    check('P1', /tied up/i.test(laneTxt), 'save toast reads in the lane', laneTxt);
    check('P1', !overlap(r.lane, r.hint) && !overlap(r.lane, r.compass) && !overlap(r.hint, r.compass), 'lane, hint and compass never overlap', r);
    await shot('P1', '2_tieup_save_toast_clear');
    // tap the hint away
    if (r.hint) { await tap('#hints .hint:not(.hidden) p'); }
    let gone = false;
    for (let i = 0; i < 10 && !gone; i++) { await sleep(150); gone = (await D(() => window.__debug.ui.hintShown())) !== 'cooler'; }
    check('P1', gone, 'a tap dismisses the hint');
    await D(() => window.__debug.ui.hint('none'));
    // stale cooler hint is retired: sold already → keeping a fish never shows it
    await D(() => { localStorage.removeItem('seenHints'); });
    await D(() => window.__debug.teleportTo('Interact_SellFish', 0)); await sleep(1500);
    await D(() => window.__debug.ui.openMarket()); await sleep(600);
    await tap('#sell-all'); await sleep(1400);
    await D(() => window.__debug.closeModals()); await sleep(400);
    await D(() => window.__debug.ui.hintEvent('kept'));
    let stale = false;
    for (let i = 0; i < 16; i++) { if ((await D(() => window.__debug.ui.hintShown())) === 'cooler') stale = true; await sleep(250); }
    check('P1', !stale, 'cooler hint retired once the market has been visited');
    // errand note done → strike-through, then the pinned errand rests in the lane
    await D(() => window.__debug.ui.chip('Catch a fish at the ripples', true)); await sleep(1200);
    await shot('P1', '3_errand_struck');
    await D(() => window.__debug.ui.openLog('errands')); await sleep(700);
    const pin = await page.$('#log-l [data-pin], #log-l button.pin, #log-l .pin');
    if (pin) { await pin.click(); await sleep(300); }
    await D(() => window.__debug.ui.closeLog());
    let pinnedRect = null;
    for (let i = 0; i < 60 && !pinnedRect; i++) { await sleep(250); pinnedRect = await rect('.lane-pinned'); }
    check('P1', !!pinnedRect, 'a pinned errand rests in the lane when nothing else is up', pinnedRect);
    await shot('P1', '4_pinned_rest');
    const badge = await D(() => window.__debug.ui.badge());
    const twoBadges = await D(() => document.querySelectorAll('#btn-log .badge:not(.hidden), #btn-log .stamp-count:not(.hidden)').length);
    check('P1', twoBadges <= 1, 'one badge on the Log button', { badge, twoBadges });
  });

  // ------------------------------------------------------------------ P2 primary/secondary context at the counters
  await section('p2', async () => {
    await boot({ shells: 900, coolerCap: 2, cooler: [], records: { shiner_perch: { size: 12, stars: 1, count: 1 } }, seenReveal: true, reachedLanding: true, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } });
    await D(() => window.__debug.ui.hint('none'));
    await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2)); await sleep(1500);
    // boat: Tie up primary, Ashore secondary, reel button steps away (not "Ashore")
    let b = await D(() => ({ p: document.getElementById('interact-label').textContent, s2: document.getElementById('btn-interact2').classList.contains('hidden') ? null : document.getElementById('interact2-label').textContent, reel: document.getElementById('action-label').textContent, away: document.getElementById('btn-action').classList.contains('away') }));
    check('P2', !(/ashore/i.test(b.reel) && !b.away), 'reel button is not Ashore at the mooring', b);
    await shot('P2', '1_mooring_two_actions');
    if (b.s2 && /ashore/i.test(b.s2)) await tap('#btn-interact2'); else if (/ashore/i.test(b.p)) await tap('#btn-interact'); else await D(() => window.__debug.stepAshore());
    await sleep(1800);
    check('P2', (await st()).foot.mode === 'foot', 'ashore from the context action');
    // the spots where the study's walks found the counter taken by "Talk to The Crier" / "Talk to Pip"
    for (const [x, z] of [[21.2, 150.9], [16.3, 147.8]]) await walkTo(x, z);
    const spot = [18.5, 145.5, 'study run 1'];
    let s = await walkTo(spot[0], spot[1]);
    if (Math.hypot(s.foot.feet.x - spot[0], s.foot.feet.z - spot[1]) > 1) { await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), spot); await sleep(600); s = await st(); }
    // face the counter so the shot shows it (the foot camera sits behind the player)
    await D(([fx, fz]) => window.__debug.footFace(Math.atan2(-(18.1 - fx), -(143.6 - fz))), [s.foot.feet.x, s.foot.feet.z]);
    await sleep(900); s = await st();
    const c1 = await D(() => ({ p: document.getElementById('interact-label').textContent, s2: document.getElementById('btn-interact2').classList.contains('hidden') ? null : document.getElementById('interact2-label').textContent }));
    console.log('   chandlery ctx', JSON.stringify({ ...c1, ctx: s.foot.ctx, interact2: s.interact2, where: spot[2] }));
    check('P2', /bait|tackle|chandl|buy/i.test(c1.p), 'shop counter holds the context button (not "Talk to The Crier")', c1);
    await shot('P2', '2_chandlery_counter');
    // between the counter and Old Tess: the counter keeps the big button, Tess gets the second
    await D(() => window.__debug.footTeleport(18.7, 144.4, 2.5)); await sleep(500);
    await D(() => window.__debug.footFace(Math.atan2(-(18.1 - 18.7), -(143.6 - 144.4)))); await sleep(900);
    const c1b = await D(() => ({ p: document.getElementById('interact-label').textContent, s2: document.getElementById('btn-interact2').classList.contains('hidden') ? null : document.getElementById('interact2-label').textContent }));
    check('P2', /chandl|bait|tackle|buy/i.test(c1b.p) && /talk/i.test(c1b.s2 ?? ''), 'shop + person in reach: shop on the big button, Talk on the second', c1b);
    await shot('P2', '2b_counter_and_tess');
    await tap('#btn-interact'); await sleep(900);
    check('P2', (await D(() => window.__debug.upg.state)).shopOpen, 'one tap on it opens the chandlery');
    await shot('P2', '3_chandlery_open');
    await D(() => window.__debug.upg.close()); await sleep(600);
    // shipwright bench with Pip nearby
    await walkTo(16.3, 147.8);
    const spot2 = [17, 126.5, 'study landscape run'];
    s = await walkTo(spot2[0], spot2[1]);
    if (Math.hypot(s.foot.feet.x - spot2[0], s.foot.feet.z - spot2[1]) > 1) { await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), spot2); await sleep(600); }
    s = await st();
    await D(([fx, fz]) => window.__debug.footFace(Math.atan2(-(16.1 - fx), -(124.6 - fz))), [s.foot.feet.x, s.foot.feet.z]);
    await sleep(900); s = await st();
    const c2 = await D(() => ({ p: document.getElementById('interact-label').textContent, s2: document.getElementById('btn-interact2').classList.contains('hidden') ? null : document.getElementById('interact2-label').textContent }));
    console.log('   bench ctx', JSON.stringify({ ...c2, ctx: s.foot.ctx, interact2: s.interact2, where: spot2[2] }));
    check('P2', /upgrade|shipwright|inspect|boat/i.test(c2.p), 'shipwright bench holds the context button (not "Talk to Pip")', c2);
    await shot('P2', '4_bench');
    // between the bench and Bosun Ade
    await D(() => window.__debug.footTeleport(18.5, 124.6, 2.5)); await sleep(500);
    await D(() => window.__debug.footFace(Math.atan2(-(16.1 - 18.5), -(124.6 - 124.6)))); await sleep(900);
    const c2b = await D(() => ({ p: document.getElementById('interact-label').textContent, s2: document.getElementById('btn-interact2').classList.contains('hidden') ? null : document.getElementById('interact2-label').textContent }));
    check('P2', /shipwright|upgrade/i.test(c2b.p) && /talk/i.test(c2b.s2 ?? ''), 'bench + person in reach: bench on the big button, Talk on the second', c2b);
    await shot('P2', '4b_bench_and_ade');
    if (c2b.s2) { await tap('#btn-interact2'); await sleep(1500); await shot('P2', '5_second_action_talk'); }
    await tap('#btn-interact'); await sleep(2200);
    check('P2', (await D(() => window.__debug.upg.state)).shipwrightOpen, 'one tap on it opens the shipwright');
    await shot('P2', '6_shipwright_open');
    await D(() => window.__debug.upg.close()); await sleep(800);
  });

  // ------------------------------------------------------------------ P3 full cooler swap
  await section('p3', async () => {
    await boot({ shells: 0, coolerCap: 2, cooler: [fish('staghorn_sculpin', 'Staghorn Sculpin', 20, 2, 7), fish('pile_perch', 'Pile Perch', 31.5, 2, 11)], records: { staghorn_sculpin: { size: 23.8, stars: 2, count: 2 }, pile_perch: { size: 31.5, stars: 2, count: 1 } }, seenReveal: true, reachedLanding: true, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } });
    await D(() => window.__debug.ui.hint('none'));
    const hs = (await D(() => window.__debug.hotspots()))[0];
    await D((h) => window.__debug.teleportTo(h, 4), hs); await sleep(1500);
    const lab = await D(() => ({ label: document.getElementById('action-label').textContent, off: document.getElementById('btn-action').classList.contains('off') }));
    check('P3', lab.label === 'Cast' && !lab.off, 'Cast stays live with a full cooler', lab);
    await shot('P3', '1_full_cooler_cast_live');
    const landFish = async (id, size) => {
      await D(([id, size]) => window.__debug.nextCatch(id, size), [id, size]);
      await tap('#btn-action'); await sleep(1500);
      await D(() => window.__debug.forceBite());
      await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 });
      await tap('#btn-action'); await sleep(400);
      await D(() => { const f = window.__debug.fishing; f.distance = -1; f.tension = 0.2; f.reelHeld = true; });
      await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 8000 });
    };
    await landFish('kelp_greenling');
    await page.waitForSelector('#card.armed', { timeout: 8000 });
    await sleep(500);
    const keepTxt = await page.textContent('#card-keep');
    const hint = await page.textContent('#card-hint');
    check('P3', /swap/i.test(keepTxt) && /staghorn/i.test(hint), 'new species card offers "Swap it in" for the cheapest fish', { keepTxt, hint });
    await shot('P3', '2_card_swap_offer');
    await tap('#card-keep'); await sleep(900);
    const s = await st();
    check('P3', s.cooler.some((c) => /greenling/i.test(c)) && !s.cooler.some((c) => /sculpin/i.test(c)) && s.cooler.length === 2, 'swap: greenling in, sculpin out, still 2', s.cooler);
    const logged = await D(() => !!window.__debug.state && JSON.parse(localStorage.getItem('salish-sea-save-v1')).records.kelp_greenling);
    check('P3', !!logged, 'the new species is logged', logged);
    await shot('P3', '3_after_swap');
    // repeat species while full: tier-A slip offers Swap, no auto-keep
    await D((h) => window.__debug.teleportTo(h, 4), hs); await sleep(1200);
    await landFish('pile_perch', 20);
    await page.waitForFunction(() => !document.getElementById('catch-slip').classList.contains('hidden'), null, { timeout: 9000 }).catch(() => {});
    await sleep(500);
    const slip = await D(() => ({ shown: !document.getElementById('catch-slip').classList.contains('hidden'), keep: document.getElementById('slip-keep').textContent, sub: document.getElementById('slip-sub').textContent }));
    check('P3', slip.shown && /swap/i.test(slip.keep), 'repeat-species slip offers Swap', slip);
    await shot('P3', '4_slip_swap_offer');
    await sleep(3600);
    const still = await D(() => !document.getElementById('catch-slip').classList.contains('hidden'));
    check('P3', still, 'no auto-keep when full (waits for the player)');
    if (still) { await tap('#slip-release'); await sleep(700); }
  });

  // ------------------------------------------------------------------ P4 bill of sale
  await section('p4', async () => {
    await boot({ shells: 2400, coolerCap: 2, cooler: [], records: {}, seenReveal: true, reachedLanding: true, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } });
    await D(() => window.__debug.ui.hint('none'));
    await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2)); await sleep(1200);
    await D(() => window.__debug.stepAshore()); await sleep(1600);
    await walkTo(16.3, 147.8); await walkTo(17, 126.5);
    await D(() => window.__debug.upg.openShipwright('boats')); await sleep(2400);
    const before = (await D(() => window.__debug.upg.state)).shells;
    await tap('[data-buyboat="T1"]'); await sleep(700);
    check('P4', !!(await rect('.bill-wrap:not(.hidden) .bill')), 'tapping Buy on a boat opens the bill of sale');
    check('P4', (await D(() => window.__debug.upg.state)).shells === before, 'nothing spent yet', before);
    await shot('P4', '1_boat_bill');
    await tap('#bill-no'); await sleep(500);
    const u1 = await D(() => window.__debug.upg.state);
    check('P4', u1.shells === before && !u1.boats.includes('T1') && u1.boat !== 'T1', '"Not yet" keeps the Shells', { shells: u1.shells });
    await D(() => window.__debug.upg.sw.setTab('flag')); await sleep(1200);
    const flagBtn = await page.$('.sw-flag:not(.on):not([disabled]) .ticket');
    if (flagBtn) {
      const id = await flagBtn.evaluate((e) => e.closest('.sw-flag').dataset.flag);
      await tap(`.sw-flag[data-flag="${id}"]`); await sleep(900);
      check('P4', !!(await rect('.bill-wrap:not(.hidden) .bill')), 'a new flag asks first (and flies while you decide)', id);
      await shot('P4', '2_flag_bill');
      await tap('#bill-yes'); await sleep(900);
      const u2 = await D(() => window.__debug.upg.state);
      check('P4', u2.flag === id && u2.flags.includes(id), 'Buy & hoist buys it', { flag: u2.flag });
      await shot('P4', '3_flag_hoisted');
    } else check('P4', false, 'no unowned flag to test');
    await D(() => window.__debug.upg.sw.setTab('boats')); await sleep(800);
    await tap('[data-buyboat="T1"]'); await sleep(700);
    await tap('#bill-yes'); await sleep(2500);
    const u3 = await D(() => window.__debug.upg.state);
    check('P4', u3.boat === 'T1', 'Buy & launch buys the Packer', u3.boat);
    await shot('P4', '4_packer_launched');
    await D(() => window.__debug.upg.close()); await sleep(600);
  });

  // ------------------------------------------------------------------ P5 market sheet
  await section('p5', async () => {
    const c6 = [fish('copper_rockfish', 'Copper Rockfish', 41.2, 2, 14), fish('lingcod', 'Lingcod', 88.5, 3, 42, 'uncommon'), fish('shiner_perch', 'Shiner Perch', 12.4, 1, 3), fish('kelp_greenling', 'Kelp Greenling', 33.0, 2, 9), fish('staghorn_sculpin', 'Staghorn Sculpin', 23.8, 2, 7), fish('pile_perch', 'Pile Perch', 31.5, 2, 11)];
    await boot({ shells: 10, coolerCap: 6, cooler: c6, records: Object.fromEntries(c6.map((f) => [f.speciesId, { size: f.size, stars: f.stars, count: 1 }])), seenReveal: true, reachedLanding: true, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } });
    await D(() => window.__debug.ui.hint('none'));
    await D(() => window.__debug.teleportTo('Interact_SellFish', 0)); await sleep(5200); // let the arrival card pass
    await tap('#btn-interact'); await sleep(1100);
    const body = await rect('#sell .sheet-body');
    const rows = await D(() => [...document.querySelectorAll('#sell-list li.row')].map((e) => { const r = e.getBoundingClientRect(); return r.bottom; }));
    if (vp === 'landscape') check('P5', rows.length === 6 && !!(await rect('#sell-all')), 'landscape: rows scroll in the side panel, Sell all pinned in view', { rows: rows.length });
    else check('P5', rows.length === 6 && rows.every((b) => b <= body.y + body.h + 1), 'all 6 rows visible without scrolling', { rows: rows.map(Math.round), bodyBottom: Math.round(body.y + body.h) });
    const bark = await D(() => [...document.querySelectorAll('.wbubble.bark')].some((e) => getComputedStyle(e).display !== 'none'));
    check('P5', !bark, 'no vendor bark drawn over the open sheet');
    const done = await rect('#sell-close'), all = await rect('#sell-all');
    check('P5', done && all && all.x > done.x, 'Sell all is on the thumb side of Done', { done, all });
    await shot('P5', '1_market_six_rows');
    await tap('#market-board'); await sleep(500);
    check('P5', await D(() => !document.getElementById('price-board').classList.contains('hidden')), 'Prices is a tab');
    await shot('P5', '2_market_prices_tab');
    await tap('#market-tab-cooler'); await sleep(300);
    await tap('#sell-all'); await sleep(1500);
    await shot('P5', '3_market_sold_all');
    await tap('#sell-close'); await sleep(500);
  });

  // ------------------------------------------------------------------ P6 version in the Log
  await section('p6', async () => {
    if (!PARTS.has('p1')) await boot(null);
    check('P6', !(await rect('#version-stamp')), 'no version stamp on the play HUD');
    await D(() => window.__debug.ui.openLog('settings')); await sleep(800);
    await D(() => { const r = document.querySelector('#log-r') ?? document.querySelector('#log-l'); document.getElementById('set-update')?.scrollIntoView({ block: 'center' }); void r; });
    await sleep(300);
    check('P6', !!(await rect('#set-update')) && /v\d/.test(await page.textContent('#set-version')), 'Log > Settings > About shows the version + Check for updates');
    await shot('P6', '1_about_version');
    await D(() => window.__debug.ui.closeLog()); await sleep(400);
  });

  // ------------------------------------------------------------------ P7 sizes + clipping
  await section('p7', async () => {
    if (!PARTS.has('p6')) await boot(null);
    await D(() => window.__debug.ui.openLog('settings')); await sleep(800);
    const sw = await D(() => [...document.querySelectorAll('.switch')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check('P7', sw.length > 0 && sw.every(([, h]) => h >= 44), 'settings toggles are ≥44 px', sw);
    await shot('P7', '1_settings_toggles');
    await D(() => window.__debug.ui.closeLog()); await sleep(300);
    await D(() => window.__debug.upg.give(500));
    await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2)); await sleep(1000);
    await D(() => window.__debug.stepAshore()); await sleep(1500);
    await D(() => window.__debug.upg.openShop('rod')); await sleep(900);
    const tabs = await D(() => [...document.querySelectorAll('#shop-tabs .upg-tab')].map((e) => { const r = e.getBoundingClientRect(); return { r: Math.round(r.right), h: Math.round(r.height) }; }));
    check('P7', tabs.length === 5 && tabs.every((t) => t.r <= innerWidthOf(vp) && t.h >= 44), 'all 5 chandlery tabs on screen, ≥44 px', tabs);
    await shot('P7', '2_shop_tabs_fit');
    await D(() => window.__debug.upg.close()); await sleep(300);
    await D(() => window.__debug.footTeleport(17, 126.5, 2.5)); await sleep(800);
    await D(() => window.__debug.upg.openShipwright('paint')); await sleep(2200);
    const parts = await D(() => [...document.querySelectorAll('.sw-part, .sw-sw')].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0));
    check('P7', parts.length > 0 && parts.every((h) => h >= 44), 'paint chips + swatches ≥44 px', [Math.min(...parts), parts.length]);
    await shot('P7', '3_paint_chips');
    await D(() => window.__debug.upg.close()); await sleep(600);
    await D(() => window.__debug.board()); await sleep(1500);
    // Strike! near the screen edge: put the bobber far off to the side and check the splat stays whole
    const hs = (await D(() => window.__debug.hotspots()))[0];
    await D((h) => window.__debug.viewHotspot(h, 7, 1), hs); await sleep(1200);
    await D(() => window.__debug.cam(null));
    await tap('#btn-action'); await sleep(1500);
    await D(() => window.__debug.forceBite());
    await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 });
    await sleep(150);
    const sp = await rect('#strike .splat');
    const ring = await rect('#strike .window');
    const on = (r) => r && r.x >= 0 && r.y >= 0 && r.x + r.w <= innerWidthOf(vp) + 1;
    check('P7', on(sp) && on(ring), 'Strike! splat + window ring fully on screen', { sp, ring });
    await shot('P7', '4_strike_on_screen');
    await tap('#btn-action'); await sleep(300);
    await D(() => { const f = window.__debug.fishing; f.distance = -1; f.tension = 0.2; f.reelHeld = true; });
    await sleep(2500);
    await D(() => window.__debug.closeModals());
  });

  console.log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
  allErrors.push(...errors);
  await context.close();
}
const innerWidthOf = (vp) => V[vp][0];

for (const vp of VPS) await run(vp);
await browser.close();
console.log(`console errors total: ${allErrors.length}`);
console.log(fails || allErrors.length ? `HUD VERIFY: FAIL (${fails} checks)` : 'HUD VERIFY: ALL PASS');
process.exit(fails || allErrors.length ? 1 : 0);
