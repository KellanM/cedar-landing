// End-to-end opening walkthrough: fresh save → Q9 (Gran's tab), phone portrait.
//   node scripts/opening_walk.mjs [baseUrl] [--gif]
// Drives the real game through window.__debug (walks with footPathTo, rows with keys, fishes with
// forceBite) and asserts each quest advances. Stills → screenshots/opening/<nn>_<beat>.png; with --gif,
// one full-res animated GIF per quest beat → screenshots/opening/gif/<qN>_<beat>.gif (frames from
// page.screenshot, encoded by scripts/strip.py's PIL). Log → screenshots/opening/walk_log.txt.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5244/';
const GIF = process.argv.includes('--gif');
const OUT = path.resolve('screenshots/opening');
const FR = path.join(OUT, 'frames');
fs.mkdirSync(path.join(OUT, 'gif'), { recursive: true });
fs.mkdirSync(FR, { recursive: true });
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(exe)) return exe;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const log = (...a) => { console.log(...a); lines.push(a.join(' ')); };
const fails = [];
const check = (name, ok, what) => { (ok ? log : (m) => { fails.push(m); log(m); })(`[${name}] ${ok ? 'ok' : 'FAIL'}: ${what}`); };

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const D = (fn, arg) => page.evaluate(fn, arg);
const st = () => D(() => window.__debug.opening.state());
let shotN = 0;
const shot = async (name) => { const f = path.join(OUT, `${String(++shotN).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f }); log('shot', path.basename(f)); };

// ---- GIF recording: grab frames while an async action runs
async function gif(name, action, { fps = 6, max = 60 } = {}) {
  if (!GIF) { await action(); return; }
  const dir = path.join(FR, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let n = 0, run = true;
  const grab = (async () => { while (run && n < max) { const t = Date.now(); await page.screenshot({ path: path.join(dir, `${String(n++).padStart(3, '0')}.png`) }); await sleep(Math.max(0, 1000 / fps - (Date.now() - t))); } })();
  try { await action(); } finally { run = false; await grab; }
  const out = path.join(OUT, 'gif', `${name}.gif`);
  try {
    execFileSync('python', ['-c', `import sys,glob
from PIL import Image
fs=sorted(glob.glob(sys.argv[1]+'/*.png'))
ims=[Image.open(f).convert('RGB') for f in fs]
ims=[i.convert('P', palette=Image.ADAPTIVE, colors=128) for i in ims]
ims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=int(1000/${fps}), loop=0, optimize=True)`, dir, out]);
    log('gif', path.basename(out), n, 'frames');
  } catch (e) { log('gif FAIL', name, String(e).slice(0, 200)); }
}

async function waitQuest(id, ms = 15000) {
  const t0 = Date.now();
  for (;;) { const s = await st(); if (s.quest === id || (id === 'done' && s.done)) return s; if (Date.now() - t0 > ms) return s; await sleep(150); }
}
/** dismiss dialogues / notes until none has been up for `quiet` ms (notes queue behind title cards) */
async function clearDialogue(quiet = 1400, max = 20000) {
  const t0 = Date.now(); let calmSince = Date.now();
  while (Date.now() - t0 < max) {
    const modal = await D(() => document.body.dataset.modal ?? null);
    if (modal === 'dialogue') {
      calmSince = Date.now();
      const choice = await page.$('#dlg-choices button');
      if (choice) await choice.click().catch(() => {}); else await page.keyboard.press('Space');
      await sleep(300);
    } else { if (Date.now() - calmSince > quiet) return; await sleep(150); }
  }
}
/** walk through waypoints (straight lines), then path-find the last leg on the same level */
async function route(points, ms = 12000) {
  for (const [x, z] of points) {
    await D(([x, z]) => window.__debug.footWalkTo(x, z), [x, z]);
    const t0 = Date.now();
    for (;;) { await sleep(150); const s = await D(() => window.__debug.state.foot); if (!s.autoWalk || Date.now() - t0 > ms) break; }
    await D(() => window.__debug.footWalkTo(null));
  }
}
async function walkTo(x, z, ms = 25000, lvl = 0.6) {
  await D(([x, z]) => window.__debug.footPathTo(x, z), [x, z]);
  const t0 = Date.now();
  for (;;) {
    await sleep(200);
    const s = await D(() => window.__debug.state);
    if (!s.foot.autoWalk || Date.now() - t0 > ms) break;
  }
  await D(() => window.__debug.footWalkTo(null));
  let f = (await D(() => window.__debug.state)).foot.feet;
  if (Math.hypot(f.x - x, f.z - z) > 1.2) { await route([[x, z]]); f = (await D(() => window.__debug.state)).foot.feet; }
  // the debug path-finder only plans on one level (stairs between the dock and the porch): hop the rest
  if (Math.hypot(f.x - x, f.z - z) > 0.9) {
    log(`  (walked to ${Math.hypot(f.x - x, f.z - z).toFixed(1)} m; footTeleport the rest)`);
    await D(([x, z, y]) => window.__debug.footTeleport(x, z, y), [x, z, lvl]); await sleep(400);
    await route([[x, z]], 3000);
    f = (await D(() => window.__debug.state)).foot.feet;
  }
  return Math.hypot(f.x - x, f.z - z);
}
async function interact() { await clearDialogue(); const r = await D(() => window.__debug.interact()); log('  interact →', r); return r; }

// ------------------------------------------------------------------ boot, fresh save
await page.goto(BASE + '?debug&opening', { waitUntil: 'load' });
await D(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await sleep(2500);
let s = await st();
check('Q0', s.quest === 'q0' && s.stage === 0, `fresh save starts at Q0 with the boat as found (${JSON.stringify(s)})`);
const f0 = (await D(() => window.__debug.state)).foot;
check('Q0', f0.mode === 'foot', `the player starts on foot on the dock (${f0.mode})`);
await gif('q0_mailboat', async () => { await sleep(4200); });
await page.waitForFunction(() => document.body.dataset.modal === 'dialogue', null, { timeout: 15000 }).catch(() => log('no purser line?'));
await sleep(800);
await shot('q0_arrival');
await clearDialogue();
const A = await D(() => window.__debug.opening.anchors);
const FROM = Number(process.env.FROM_Q ?? 0); // FROM_Q=9: start at Gran's tab (quick iteration)
if (FROM) { await D((q) => window.__debug.opening.goto(q), FROM); await sleep(1500); await clearDialogue(); }

// Q0 → Q1: walk up to the cottage porch, pick up the logbook
await gif('q0_walk_to_cottage', async () => { await route([[8.4, 21.5], [9, 19.5], [10.6, 17.6], [9.6, 14.6]]); const d = await walkTo(A.table[0] + 0.8, A.table[1] + 0.6, 25000, 3.5); log('walk table dist', d.toFixed(2)); });
await shot('q1_porch_table');
let r1;
await gif('q1_logbook_and_keys', async () => { r1 = await interact(); await sleep(2600); });
log('interact', r1);
await shot('q1_logbook_note');
await clearDialogue();
s = await waitQuest('q2');
check('Q1', s.quest === 'q2', `logbook taken → Q2 (${s.quest})`);
await clearDialogue();

// Q2: rod, tin (crab), clams, rig
await route([[9.6, 14.6], [10.8, 17.8], [9, 19.5]]);
await gif('q2_rod_in_driftwood', async () => { const d = await walkTo(A.rod[0] + 0.8, A.rod[1] + 0.6); log('walk rod dist', d.toFixed(2)); await shot('q2_driftwood'); await interact(); await sleep(800); });
await clearDialogue();
await gif('q2_crab_in_pool', async () => {
  const d = await walkTo(A.pool[0] - 1.0, A.pool[1] + 0.6); log('walk pool dist', d.toFixed(2));
  await shot('q2_rock_pool');
  await D(() => window.__debug.interact());
  await sleep(700);
  await shot('q2_crab_choice');
  await clearDialogue();
  await sleep(1300);
});
await gif('q2_clams', async () => { const d = await walkTo(A.clams[0] - 0.8, A.clams[1] - 0.6); log('walk clams dist', d.toFixed(2)); await interact(); await sleep(700); });
await clearDialogue();
s = await st();
check('Q2', ['rod', 'tin', 'clams'].every((k) => s.steps.includes(k)), `three pickups (${s.steps.join(',')})`);
await gif('q2_rig_at_campfire', async () => { const d = await walkTo(A.fire[0] - 0.8, A.fire[1] + 0.8); log('walk fire dist', d.toFixed(2)); await interact(); await sleep(900); await shot('q2_rig_note'); await clearDialogue(); });
s = await waitQuest('q3');
check('Q2', s.quest === 'q3', `tackle rigged → Q3 (${s.quest})`);
await clearDialogue();

// Q3: chain + repair (hold to bail, tap the mark)
await walkTo(9, 19.5); await route([[8.5, 21.5]]); await walkTo(A.chain[0], A.chain[1] - 0.8);
await shot('q3_at_the_boat');
await interact(); await sleep(500); await clearDialogue();
await gif('q3_bail_and_patch', async () => {
  await D(() => window.__debug.interact());
  await page.waitForSelector('#rp-btn', { timeout: 5000 });
  await sleep(600);
  await shot('q3_bail');
  const b = await page.$('#rp-btn'); const bb = await b.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await sleep(4300); await page.mouse.up();
  await sleep(400);
  await shot('q3_patch');
  for (let i = 0; i < 400 && (await page.$('#rp-btn')); i++) {
    // tap when the mallet is over the mark
    const hit = await D(() => { const m = document.getElementById('rp-mallet'); if (!m) return false; const p = parseFloat(m.style.left) / 100; return Math.abs(p - 0.5) < 0.08; });
    if (hit) { await page.mouse.down(); await page.mouse.up(); await sleep(250); } else await sleep(40);
  }
  await sleep(1200);
}, { fps: 8, max: 80 });
s = await waitQuest('q4');
check('Q3', s.quest === 'q4' && s.stage === 1, `bailed + patched → stage 1, Q4 (${s.quest}, stage ${s.stage})`);
await clearDialogue();
await shot('q3_she_floats');

// Q4: board, row out between the buoys
await D(() => window.__debug.board());
await sleep(1500);
const before = (await D(() => window.__debug.state)).boat;
await gif('q4_oars_between_buoys', async () => {
  await D(() => window.__debug.key('w', true));
  await sleep(1500);
  await D(() => window.__debug.key('w', false));
  const after = (await D(() => window.__debug.state)).boat;
  log('rowed', Math.hypot(after.x - before.x, after.z - before.z).toFixed(2), 'm in 1.5 s');
  await D(([x, z]) => window.__debug.teleport(x, z - 3, Math.PI), [A.gate[0], A.gate[1]]);
  await sleep(1200);
});
s = await waitQuest('q5');
check('Q4', s.quest === 'q5', `through the buoy gate → Q5 (${s.quest})`);
await shot('q4_gate');
await clearDialogue();

// Q5: first fish at the ripples
async function catchOne(tag) {
  const hs = (await D(() => window.__debug.hotspots())).find((h) => h.includes('HS02')) ?? (await D(() => window.__debug.hotspots()))[0];
  await D((h) => window.__debug.teleportTo(h, 4), hs);
  await sleep(900);
  await D(() => window.__debug.action());
  await sleep(1300);
  await shot(`${tag}_cast`);
  await D(() => window.__debug.forceBite());
  await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 });
  await D(() => window.__debug.action());
  await sleep(600);
  await shot(`${tag}_reel`);
  await D(() => { const f = window.__debug.fishing; f.distance = -1; f.tension = 0.2; f.reelHeld = true; });
  await page.waitForFunction(() => window.__debug.state.phase === 'landed', null, { timeout: 8000 });
  await page.waitForSelector('#card.armed', { timeout: 6000 });
  await sleep(400);
  await shot(`${tag}_card`);
  await page.click('#card-keep');
  await sleep(900);
}
await gif('q5_first_ripples', () => catchOne('q5'), { fps: 5, max: 50 });
s = await waitQuest('q6');
check('Q5', s.quest === 'q6', `first fish → Q6 (${s.quest})`);
await clearDialogue();
// Q6: the box holds two
await gif('q6_two_in_the_box', () => catchOne('q6'), { fps: 5, max: 50 });
s = await waitQuest('q7');
check('Q6', s.quest === 'q7', `box full → Q7 (${s.quest})`);
await clearDialogue();

// Q7: the chart, the crossing, tie up at Cedar Landing
let drizzled = false;
await D(() => window.__debug.ui.openLog('map'));
await sleep(1200);
await shot('q7_chart');
await D(() => window.__debug.ui.closeLog());
await gif('q7_the_crossing', async () => {
  await D(() => window.__debug.teleport(-10, 120, Math.PI));
  await sleep(2500);
  drizzled = await D(() => window.__debug.opening.drizzling());
  await shot('q7_drizzle_crossing');
  await D(() => window.__debug.teleportTo('Interact_MoorBoat', 2));
  await sleep(2500);
});
s = await waitQuest('q8');
check('Q7', s.quest === 'q8', `tied up at Cedar Landing → Q8 (${s.quest}); drizzle during the crossing: ${drizzled}`);
await shot('q7_tied_up');
await clearDialogue();

// Q8: sell to Mae
await gif('q8_mae', async () => {
  await D(() => window.__debug.teleportTo('Interact_SellFish', 0));
  await sleep(900);
  await D(() => window.__debug.interact());
  await sleep(900);
  await shot('q8_market');
  const sell = await page.$('#sell-all');
  if (sell) await sell.click(); else { const t = await page.$$('.ticket'); for (const x of t) { await x.click(); await sleep(250); } }
  await sleep(1200);
  await page.click('#sell-close').catch(() => {});
  await sleep(1500);
  await shot('q8_mae_line');
});
s = await waitQuest('q9');
check('Q8', s.quest === 'q9', `sold → Q9 (${s.quest})`);
await clearDialogue();

// Q9: Gran's tab
await gif('q9_grans_tab', async () => {
  // ashore at the float, then up the boardwalk to Old Tess's counter
  await D(() => window.__debug.teleportTo('Interact_MoorBoat', 2));
  await sleep(600);
  await D(() => window.__debug.stepAshore());
  await sleep(1800);
  const t = await D(() => window.__debug.state);
  log('ashore', JSON.stringify(t.foot.feet));
  // the same walk as scripts/shop_capture.mjs: float → boardwalk → Old Tess's counter
  for (const [x, z] of [[21.2, 150.9], [16.3, 147.8], [18.5, 145.5]]) await walkTo(x, z, 25000, 2.2);
  log('at tess', JSON.stringify((await D(() => window.__debug.state)).foot));
  await interact();
  await sleep(800);
  await shot('q9_tess');
  await clearDialogue();
  await page.waitForSelector('.gt-wrap', { timeout: 6000 });
  await sleep(500);
  await shot('q9_pick');
  await page.click('.gt-slot[data-k="green"]');
  await sleep(600);
  await shot('q9_preview');
  await page.click('#gt-take');
  await sleep(400);
  await shot('q9_confirm');
  await page.click('#gt-yes');
  await sleep(900);
  await shot('q9_pip');
  await clearDialogue();
  await sleep(800);
}, { fps: 4, max: 60 });
s = await waitQuest('done');
const gear = await D(() => window.__debug.state.upg ?? null);
check('Q9', s.done && s.lure === 'green', `Gran's tab → opening done, lure ${s.lure}`);
await shot('done');
log('final', JSON.stringify(s), 'gear', JSON.stringify(gear));
log('console errors', errors.length, errors.slice(0, 5).join(' | '));
fs.writeFileSync(path.join(OUT, 'walk_log.txt'), lines.join('\n') + `\n\n${fails.length ? 'FAILURES:\n' + fails.join('\n') : 'ALL OK'}\n`);
await browser.close();
if (fails.length) { console.error(`${fails.length} failure(s)`); process.exit(1); }
console.log('ALL OK');
