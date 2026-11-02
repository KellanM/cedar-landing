// People capture: node scripts/people_capture.mjs [baseUrl]   env: TAG=base|after (file prefix), ONLY=phone|desktop, PARTS=walk,idle,npcs,talk
// Steps the sim on a fixed 1/60 s clock (window.__debug.clock/advance) so frame sequences are exactly
// FRAME_MS apart regardless of screenshot latency. Output: screenshots/people/<TAG>_<device>_<shot>.png + people_log.txt.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5194/cedar-landing/';
const TAG = process.env.TAG ?? 'base';
const OUT = path.resolve('screenshots/people');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY;
const PARTS = new Set((process.env.PARTS ?? 'walk,idle,npcs,talk').split(','));
const FRAME_MS = 100;

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

const FAKE_SAVE = {
  shells: 0, coolerCap: 2, records: {}, seenReveal: true, reachedLanding: true, cooler: [],
  settings: { quality: 'high', autoReel: false, showFps: false, tod: null },
};
// NPCs to portrait (names from gameplay.json); village ones are visited by camera only.
const PORTRAITS = ['NPC_TheCrier', 'NPC_Marlo', 'NPC_DockhandJuno', 'NPC_OldTess', 'NPC_Pip', 'NPC_Fen', 'NPC_Coralie', 'NPC_TheCartographer',
  'NPC_PV_NetMender', 'NPC_PV_Carver', 'NPC_PV_Cook', 'NPC_PV_Child0', 'NPC_PV_StoryKeeper', 'NPC_Filler_Town_04', 'NPC_Filler_Village_03'];
const IDLE_SEQ = ['NPC_TheCrier', 'NPC_PV_NetMender', 'NPC_PV_Carver', 'NPC_PV_Cook', 'NPC_Fen', 'NPC_PV_Child0', 'NPC_Marlo', 'NPC_Filler_Town_00'];

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'info' && /npcs|onfoot/.test(m.text())) log(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), FAKE_SAVE);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(1500);
  const D = (fn, arg) => page.evaluate(fn, arg);
  const st = () => D(() => window.__debug.state);
  const shot = (n) => page.screenshot({ path: `${OUT}/${TAG}_${name}_${n}.png` });
  const advance = async (ms) => {
    await D((ms) => window.__debug.advance(ms), ms);
    await page.waitForFunction(() => window.__debug.stepsLeft() === 0, null, { timeout: 20000 });
  };
  const seq = async (label, n, ms = FRAME_MS) => { for (let i = 0; i < n; i++) { await advance(ms); await shot(`${label}_${String(i).padStart(2, '0')}`); } };

  await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
  await sleep(1200);
  await D(() => window.__debug.stepAshore());
  await sleep(1600);
  let s = await st();
  if (s.foot.mode !== 'foot') { failures.push(`[${name}] could not step ashore`); log(`[${name}] FAIL step ashore`, JSON.stringify(s.foot)); await ctx.close(); return; }
  log(`[${name}] ashore at`, JSON.stringify(s.foot.feet), 'model', s.foot.model);
  const npcs = await D(() => window.__debug.npcs());
  const byName = Object.fromEntries((npcs ?? []).map((n) => [n.name, n]));
  await D(() => window.__debug.clock(true));
  await advance(300);

  if (PARTS.has('walk')) {
    // Plaza walk (market west door -> plaza bridge, ~6 m of open deck) seen by long-lens cameras that follow
    // the player; the near plane clips posts/walls between camera and subject; the HUD is hidden.
    const A = [16.3, 147.8], Bp = [21.6, 144.7];
    // studio: scenery hidden (collision unaffected) so walls never block the long-lens cameras
    const SIDE = { follow: { side: 5.5, back: 0, up: 1.1, look: 0.85 }, fov: 22, near: 1.0 };
    const TQ = { follow: { side: 3.6, back: -4.4, up: 1.9, look: 0.85 }, fov: 22, near: 1.0 };
    await D(() => window.__debug.isolate(true));
    const hud = await page.addStyleTag({ content: 'body > *:not(#c){visibility:hidden !important}' });
    const leg = async (label, cam, n, from = A, to = Bp) => {
      await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), from);
      await D(([x, z]) => window.__debug.footFace(Math.atan2(-(x[0] - z[0]), -(x[1] - z[1]))), [to, from]);
      await D((c) => window.__debug.cam(c), cam);
      await advance(600);
      await D(([x, z]) => window.__debug.footWalkTo(x, z), to);
      await seq(label, n);
    };
    await leg('walk_side', SIDE, 18);
    for (let i = 0; i < 40; i++) { s = await st(); if (!s.foot.autoWalk) break; await advance(100); }
    await seq('stop_side', 8);
    await leg('walk_34', TQ, 14, Bp, A);
    // run (keyboard: shift + w) from the door toward the bridge
    await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), A);
    await D((c) => window.__debug.cam(c), { ...SIDE, follow: { ...SIDE.follow, side: 5.2 } });
    await D(([x, z]) => window.__debug.footWalkTo(x, z), Bp);
    await advance(150);
    await D(() => window.__debug.footWalkTo(null));
    await page.keyboard.down('Shift'); await page.keyboard.down('w');
    await advance(300);
    await seq('run_side', 8);
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
    await advance(600);
    await hud.evaluate((el) => el.remove());
    await D(() => window.__debug.isolate(false));
    // gameplay camera, phone framing
    await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), A);
    await D(() => window.__debug.cam(null));
    await advance(1500);
    await D(([x, z]) => window.__debug.footWalkTo(x, z), Bp);
    await advance(1300);
    await shot('walk_gamecam');
  }

  if (PARTS.has('idle')) {
    await D(() => window.__debug.footWalkTo(null));
    await advance(1000);
    await D(() => window.__debug.cam({ follow: { side: 2.4, back: -4.4, up: 1.5, look: 0.95 }, fov: 24, near: 3.5 }));
    const hud2 = await page.addStyleTag({ content: 'body > *:not(#c){visibility:hidden !important}' });
    await D(() => window.__debug.isolate(true));
    await seq('idle_player', 12, 400);
    await D(() => window.__debug.isolate(false));
    await hud2.evaluate((el) => el.remove());
  }

  if (PARTS.has('npcs')) {
    const hud3 = await page.addStyleTag({ content: 'body > *:not(#c){visibility:hidden !important}' });
    for (const nm of PORTRAITS) {
      const n = byName[nm];
      if (!n) { log(`[${name}] no npc ${nm}`); continue; }
      const a = n.rotY ?? 0; // Blender rotz: facing (sin a, 0, cos a) in three
      const fx = Math.sin(a), fz = Math.cos(a);
      const k = 0.5; // turn the camera 30 deg off the face
      const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
      const p = n.pos;
      await D((c) => window.__debug.cam(c), { pos: [p[0] + cx * 3.4, p[1] + 1.55, p[2] + cz * 3.4], target: [p[0], p[1] + 0.95, p[2]], fov: 34, near: 1.8 });
      await advance(200);
      await shot(`npc_${nm.replace('NPC_', '')}`);
    }
    for (const nm of IDLE_SEQ) {
      const n = byName[nm];
      if (!n) continue;
      const a = n.rotY ?? 0, fx = Math.sin(a), fz = Math.cos(a), k = 0.6;
      const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
      const p = n.pos;
      await D((c) => window.__debug.cam(c), { pos: [p[0] + cx * 4.2, p[1] + 1.6, p[2] + cz * 4.2], target: [p[0], p[1] + 0.9, p[2]], fov: 30, near: 2.6 });
      await advance(200);
      await seq(`idle_${nm.replace('NPC_', '')}`, 8, 200);
    }
    await hud3.evaluate((el) => el.remove());
  }

  if (PARTS.has('talk')) {
    // approach the crier through the plaza and talk; fixed camera that sees both
    await D(() => window.__debug.cam(null));
    for (const [x, z] of [[21.2, 150.9], [16.3, 147.8], [21.6, 144.7]]) {
      await D(([x, z]) => window.__debug.footPathTo(x, z), [x, z]);
      for (let i = 0; i < 200; i++) { s = await st(); if (!s.foot.autoWalk) break; await advance(100); }
    }
    const c = byName.NPC_TheCrier;
    if (c) {
      const p = c.pos;
      // side-on to the pair: the crier's facing f and its right-angle s
      const ca = c.rotY ?? 0, f = [Math.sin(ca), Math.cos(ca)], sd = [Math.cos(ca), -Math.sin(ca)];
      await D((cc) => window.__debug.cam(cc), { pos: [p[0] + f[0] * 4.0 - sd[0] * 1.6, p[1] + 2.2, p[2] + f[1] * 4.0 - sd[1] * 1.6], target: [p[0] + f[0] * 0.9, p[1] + 1.3, p[2] + f[1] * 0.9], fov: 38, near: 2.0 });
      await D(([x, z]) => window.__debug.footPathTo(x, z), [p[0] - 1.6, p[2] + 1.2]);
      await seq('approach', 14, 150);
      for (let i = 0; i < 100; i++) { s = await st(); if (!s.foot.autoWalk) break; await advance(100); }
      await D(() => window.__debug.interact());
      await seq('talk', 10, 150);
      s = await st();
      log(`[${name}] talk bubble`, JSON.stringify(s.foot.bubble));
      // phone framing with the gameplay camera
      await D(() => window.__debug.cam(null));
      await advance(800);
      await shot('talk_gamecam');
    }
  }
  await D(() => window.__debug.clock(false));
  await sleep(1500);
  s = await st();
  log(`[${name}] fps ${s.fps} draws ${s.drawCalls} tris ${s.tris} npcAnim ${JSON.stringify(s.npcAnim)}`);
  if (errors.length) failures.push(`[${name}] console errors: ${errors.slice(0, 3).join(' | ')}`);
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

if (!ONLY || ONLY === 'phone') await run('phone', { width: 390, height: 844 }, true);
if (!ONLY || ONLY === 'desktop') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
log(failures.length ? `FAILED: ${failures.join('; ')}` : 'PASS');
fs.writeFileSync(`${OUT}/${TAG}_people_log.txt`, lines.join('\n'));
process.exitCode = failures.length ? 1 : 0;
