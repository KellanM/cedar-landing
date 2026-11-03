// The opening's on-foot route walked with REAL phone touch input (a CDP touch joystick; no
// path-finder, no teleports): mail-boat dock → Gran's boardwalk → porch steps → porch table →
// down to the strandline (clams, campfire, rock pool, driftwood) → back along the boardwalk to the
// wreck → Board. Asserts no stuck frames (stick held, walker not moving).
//   node scripts/foot_route.mjs [baseUrl] [--gif] [--tag=before]
// Output: screenshots/foot_route/<tag>_*.png, <tag>_route.gif (phone portrait), <tag>_log.txt
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5254/';
const GIF = process.argv.includes('--gif');
const WPT = Number(process.env.WP_TIMEOUT ?? 25000); // per-waypoint time limit (ms)
const TAG = (process.argv.find((a) => a.startsWith('--tag=')) ?? '--tag=cur').slice(6);
const OUT = path.resolve('screenshots/foot_route');
const FR = path.join(OUT, `${TAG}_frames`);
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-win64', 'chrome.exe'); if (fs.existsSync(exe)) return exe;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const log = (...a) => { console.log(...a); lines.push(a.join(' ')); };

// Route (three x, z). `stop` = an interact we expect the context button to offer there.
const ROUTE = JSON.parse(process.env.ROUTE ?? 'null') ?? [
  { n: 'dock end', p: [8.4, 26.0] },
  { n: 'boardwalk', p: [8.6, 22.0] },
  { n: 'dock foot', p: [9.0, 19.6] },
  { n: 'stairs bottom', p: [10.6, 18.2] },
  { n: 'stairs top', p: [9.8, 14.8] },
  { n: 'porch table', p: [7.4, 12.8], stop: 'OPEN_book' },
  { n: 'stairs top', p: [9.8, 14.8] },
  { n: 'stairs bottom', p: [10.6, 18.2] },
  { n: 'beach', p: [12.4, 17.0] },
  { n: 'campfire', p: [16.8, 7.6] },
  { n: 'clams', p: [14.8, 5.2] },
  { n: 'rod (pale log)', p: [14.0, 1.4] },
  { n: 'rock pool', p: [16.4, -3.4] },
  { n: 'east beach', p: [15.6, 1.0] },
  { n: 'campfire', p: [16.8, 7.6] },
  { n: 'beach', p: [12.4, 17.0] },
  { n: 'dock foot', p: [9.0, 19.6] },
  { n: 'boardwalk', p: [8.6, 23.0] },
  { n: 'the wreck', p: [8.2, 27.4] },
];

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const D = (fn, arg) => page.evaluate(fn, arg);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });

await page.goto(BASE + '?debug&opening', { waitUntil: 'load' });
await D(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 180000 });
await sleep(1500);
const tapThrough = async () => {
  for (let i = 0; i < 30; i++) {
    const m = await D(() => document.body.dataset.modal ?? null);
    if (m !== 'dialogue') return;
    const ch = await page.$('#dlg-choices button');
    if (ch) await ch.click(); else { const s = await page.$('.dialogue .strip'); if (s) { const b = await s.boundingBox(); await touch('touchStart', b.x + b.width / 2, b.y + 20); await touch('touchEnd'); } }
    await sleep(250);
  }
};
// wait out the arrival (title card + purser line)
for (let i = 0; i < 40; i++) { await sleep(250); if ((await D(() => document.body.dataset.modal ?? null)) === 'dialogue') break; }
await tapThrough();
await sleep(600);

const JX = 100, JY = 640, R = 55;
let frame = 0, grabbing = false;
async function grab() { if (!GIF || grabbing) return; grabbing = true; await page.screenshot({ path: path.join(FR, `${String(frame++).padStart(4, '0')}.png`) }); grabbing = false; }

let camEst = 0.35, lastPhi = null;
let stuckFrames = 0, stuckEvents = [], total = 0, held = false, fails = [];
const t0 = Date.now();
for (const wp of ROUTE) {
  const start = Date.now();
  let last = null, lastMoveT = Date.now(), reached = false;
  while (Date.now() - start < WPT) {
    const s = await D(() => ({ f: window.__debug.state.foot, modal: document.body.dataset.modal ?? null, ctx: window.__debug.state.interact }));
    if (s.modal === 'dialogue') { if (held) { await touch('touchEnd'); held = false; } await tapThrough(); continue; }
    const f = s.f.feet;
    // camera yaw: from the debug state when the build has it; otherwise (older builds) estimated from
    // how the walker answered the last stick input: heading = camYaw − stick angle
    if (typeof s.f.camYaw === 'number') camEst = s.f.camYaw;
    else if (last && Math.hypot(f.x - last.x, f.z - last.z) > 0.05 && lastPhi !== null) { const est = f.yaw + lastPhi; camEst = Math.atan2(Math.sin(camEst) * 0.6 + Math.sin(est) * 0.4, Math.cos(camEst) * 0.6 + Math.cos(est) * 0.4); }
    const a = camEst;
    const dx = wp.p[0] - f.x, dz = wp.p[1] - f.z, d = Math.hypot(dx, dz);
    if (d < 0.55) { reached = true; break; }
    const fx = -Math.sin(a), fz = -Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
    const my = (dx * fx + dz * fz) / d, mx = (dx * rx + dz * rz) / d;
    const k = d < 1.2 ? 0.55 : 0.75; // walk, slow down near the point
    const x = JX + mx * R * k, y = JY - my * R * k;
    lastPhi = Math.atan2(mx, my);
    if (!held) { await touch('touchStart', JX, JY); held = true; await sleep(30); }
    await touch('touchMove', x, y);
    total++;
    if (last) {
      const moved = Math.hypot(f.x - last.x, f.z - last.z);
      if (moved > 0.04) lastMoveT = Date.now();
      else { stuckFrames++; if (Date.now() - lastMoveT > 700) { stuckEvents.push(`${wp.n} @ (${f.x.toFixed(2)}, ${f.z.toFixed(2)}, y ${f.y.toFixed(2)})`); lastMoveT = Date.now(); } }
    }
    last = { ...f };
    await grab();
    await sleep(60);
  }
  if (held) { await touch('touchEnd'); held = false; }
  const s = await D(() => ({ f: window.__debug.state.foot, ctx: window.__debug.state.interact }));
  log(`${reached ? 'reached' : 'MISSED '} ${wp.n.padEnd(14)} at (${s.f.feet.x.toFixed(2)}, ${s.f.feet.z.toFixed(2)}) y ${s.f.feet.y.toFixed(2)}  ${((Date.now() - start) / 1000).toFixed(1)} s  ctx ${s.ctx ?? '-'}${wp.stop ? ` (want ${wp.stop})` : ''}`);
  if (!reached) fails.push(wp.n);
  if (wp.stop && s.ctx !== wp.stop) fails.push(`${wp.n}: context ${s.ctx} ≠ ${wp.stop}`);
  await sleep(150);
}
const st = await D(() => window.__debug.state);
log(`at the wreck (before the repair, Board must NOT be offered): ${st.interact} / ${st.foot.ctx}`);
if (/board/i.test(st.foot.ctx ?? '')) fails.push('Board offered before the repair');
// after Q3 (bail + patch): Board must be offered by the boat, and tapping the context button boards
await D(() => window.__debug.opening.goto(4));
await sleep(1500);
await tapThrough();
const s3 = await D(() => window.__debug.state);
const bdist = Math.hypot(s3.boat.x - s3.foot.feet.x, s3.boat.z - s3.foot.feet.z);
log(`after the repair: ctx "${s3.foot.ctx}", moored ${s3.boat.moored}, ${bdist.toFixed(1)} m from her centre`);
if (!/board/i.test(s3.foot.ctx ?? '')) fails.push(`no Board after the repair (ctx ${s3.foot.ctx})`);
const btn = await page.$('#btn-interact');
const bb = btn && await btn.boundingBox();
if (bb) { await touch('touchStart', bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(60); await touch('touchEnd'); }
await sleep(1800);
const mode = (await D(() => window.__debug.state.foot)).mode;
log(`tapped the context button → ${mode}`);
if (mode !== 'boat') fails.push(`tapping Board did not board (${mode})`);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
log(`route ${secs} s, ${total} input frames, stuck frames ${stuckFrames} (${(100 * stuckFrames / Math.max(1, total)).toFixed(1)}%), stuck events ${stuckEvents.length}`);
for (const e of stuckEvents) log('  stuck:', e);
log('console errors', errors.length, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: path.join(OUT, `${TAG}_end.png`) });
if (GIF && frame) {
  const out = path.join(OUT, `${TAG}_route.gif`);
  execFileSync('python', ['-c', `import sys,glob
from PIL import Image
fs=sorted(glob.glob(sys.argv[1]+'/*.png'))[::2]
ims=[Image.open(f).convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=96) for f in fs]
ims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=120, loop=0, optimize=True)`, FR, out]);
  log('gif', out, Math.ceil(frame / 2), 'frames');
}
const ok = !fails.length && stuckEvents.length === 0 && errors.length === 0;
log(ok ? 'FOOT ROUTE: ALL PASS' : `FOOT ROUTE: FAIL ${fails.join('; ')}${stuckEvents.length ? ` · ${stuckEvents.length} stuck` : ''}`);
fs.writeFileSync(path.join(OUT, `${TAG}_log.txt`), lines.join('\n') + '\n');
await browser.close();
process.exit(ok ? 0 : 1);
