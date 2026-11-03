// NPC look capture (character study direction A): node scripts/npcs_capture.mjs [baseUrl]
// env: TAG=before|after (file prefix), ONLY=phone|desktop, SMOOTH=1 also captures faceted-vs-smooth pairs
// Output: screenshots/npcs_A_<TAG>_<device>_<shot>.png + npcs_capture_log.txt
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5228/cedar-landing/';
const TAG = process.env.TAG ?? 'before';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY;
const SMOOTH = process.env.SMOOTH === '1';

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
  settings: { quality: 'high', autoReel: false, showFps: true, tod: null },
};

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), FAKE_SAVE);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(1500);
  const D = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: `${OUT}/npcs_A_${TAG}_${name}_${n}.png` });
  const settle = async (ms = 1200) => { await sleep(ms); };
  await D(() => window.__debug.setClock && window.__debug.setClock(13));
  // 1. chase camera from the boat off the town dock, looking in at the crowd
  await D(() => window.__debug.teleport(23.0, 168.0, Math.PI));
  await settle(5200);
  await D(() => window.__debug.closeModals && window.__debug.closeModals());
  await shot('chase');
  const perfBoat = await D(() => ({ draw: window.__debug.state.draws ?? null, tris: window.__debug.state.tris ?? null, st: window.__debug.state }));
  log(`[${name}] chase draws/tris/fps`, perfBoat.st.drawCalls, perfBoat.st.tris, perfBoat.st.fps);
  // 2. ashore: street crowd at the on-foot game camera
  await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
  await settle(800);
  await D(() => window.__debug.stepAshore());
  await settle(1500);
  const foot = async (x, z, yaw) => { await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), [x, z]); await D((y) => window.__debug.footFace(y), yaw); await D(() => window.__debug.cam(null)); await settle(1600); };
  await foot(31.0, 147.0, Math.PI);            // facing -Z: the plaza crowd ahead
  await shot('street');
  { const s2 = await D(() => window.__debug.state); log(`[${name}] street draws/tris/fps npcAnim`, s2.drawCalls, s2.tris, s2.fps, JSON.stringify(s2.npcAnim)); }
  const crowd = await D(() => window.__debug.crowdStats ? window.__debug.crowdStats() : null);
  if (crowd) log(`[${name}] crowd`, JSON.stringify(crowd));
  // 3. overviews with a fixed camera (HUD hidden): market (Marlo, Old Tess), village (Story Keeper, elders, kids)
  const hud = await page.addStyleTag({ content: 'body > *:not(#c){visibility:hidden !important}' });
  const view = async (label, pos, target, fov = 40) => { await D((c) => window.__debug.cam(c), { pos, target, fov, near: 0.5 }); await settle(900); await shot(label); };
  // 4. portraits, people_capture framing (30 deg off the face)
  const npcs = await D(() => window.__debug.npcs());
  const portrait = async (nm, label, dist = 3.4) => {
    const n = npcs.find((k) => k.name === nm);
    if (!n) { log('missing', nm); return; }
    const a = n.rotY ?? 0, fx = Math.sin(a), fz = Math.cos(a), k = 0.5;
    const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
    const p = n.pos;
    await D((c) => window.__debug.cam(c), { pos: [p[0] + cx * dist, p[1] + 1.55, p[2] + cz * dist], target: [p[0], p[1] + 0.95, p[2]], fov: 34, near: 1.8 });
    await settle(700);
    await shot(label);
  };
  for (const [nm, lab] of [['NPC_PV_StoryKeeper', 'elder'], ['NPC_PV_SmokehouseKeeper', 'smokehouse'], ['NPC_Marlo', 'marlo'], ['NPC_OldTess', 'tess'],
    ['NPC_Pip', 'kid'], ['NPC_DockhandJuno', 'juno'], ['NPC_Filler_Village_02', 'village_elder2'], ['NPC_PV_Cook', 'cook']]) await portrait(nm, lab);
  const wide = async (nm, label, dist, up, fov, k = 0.35) => {
    const n = npcs.find((q) => q.name === nm); if (!n) return;
    const a = n.rotY ?? 0, fx = Math.sin(a), fz = Math.cos(a);
    const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
    const p = n.pos;
    await view(label, [p[0] + cx * dist, p[1] + up, p[2] + cz * dist], [p[0], p[1] + 0.8, p[2]], fov);
  };
  await wide('NPC_Marlo', 'market', 6.5, 2.8, 46, -0.9);
  await wide('NPC_PV_StoryKeeper', 'village', 9.0, 4.0, 50, 0.6);
  await wide('NPC_PV_Child0', 'village2', 8.0, 3.5, 50, -0.4);
  if (SMOOTH) {
    for (const on of [false, true]) {
      await D((o) => window.__debug.npcSmooth && window.__debug.npcSmooth(o), on);
      await portrait('NPC_PV_StoryKeeper', `elder_${on ? 'smooth' : 'faceted'}`, 2.6);
      await portrait('NPC_Marlo', `marlo_${on ? 'smooth' : 'faceted'}`, 2.6);
      await portrait('NPC_DockhandJuno', `juno_${on ? 'smooth' : 'faceted'}`, 2.6);
    }
  }
  await hud.evaluate((el) => el.remove());
  // 5. Mae's fish market sheet (the market interaction), game camera
  await foot(21.0, 152.5, Math.PI * 0.95);
  await D(() => window.__debug.footPathTo(22.6, 150.6));
  await settle(2500);
  log(`[${name}] interact`, await D(() => window.__debug.interact()));
  await settle(1400);
  await shot('market_mae');
  await D(() => window.__debug.closeModals && window.__debug.closeModals());
  await D(() => window.__debug.cam(null));
  log(`[${name}] errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) log('  ', e);
  if (errors.length) failures.push(name);
  await ctx.close();
}

if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
fs.writeFileSync(`${OUT}/npcs_capture_log_${TAG}.txt`, lines.join('\n'));
console.log(failures.length ? `FAIL ${failures.join(',')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
