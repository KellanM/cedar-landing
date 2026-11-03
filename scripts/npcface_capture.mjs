// NPC expressions capture: node scripts/npcface_capture.mjs [baseUrl] [phone|desktop]
//  sheet:   a few NPCs × every expression (portrait cam, HUD hidden) → screenshots/npcface_<vp>_sheet_<npc>_<expr>.png
//  catch:   a legendary catch next to the town dock, the dockside crowd reacting → npcface_<vp>_catch_NN.png
//  thunder: a near lightning strike over the plaza crowd → npcface_<vp>_thunder_NN.png
//  talk:    talking to the Crier (an excited line) → npcface_<vp>_talk_NN.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv[2] ?? 'http://localhost:5256/cedar-landing/';
const ONLY = process.argv[3];
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const chrome = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p)) : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? chrome, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = []; const log = (...a) => { console.log(...a); lines.push(a.join(' ')); };
let total = 0;
const FAKE_SAVE = { shells: 0, coolerCap: 6, records: {}, seenReveal: true, reachedLanding: true, cooler: [{ speciesId: 'bluntnose_sixgill', name: 'Bluntnose sixgill', size: 300, stars: 3, price: 400, color: '#6b6f73', rarity: 'legendary' }], opening: { q: 99, steps: [], done: true, stage: 3, flags: [] }, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } };
const SHEET = ['NPC_DockhandJuno', 'NPC_OldTess', 'NPC_TheCrier', 'NPC_PV_StoryKeeper'];
const EXPRS = ['neutral', 'happy', 'laugh', 'surprised', 'worried', 'sad', 'joy', 'grumpy'];

async function run(vp, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('salish-sea-save-v1', JSON.stringify(s)), FAKE_SAVE);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await sleep(2000);
  const D = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: `${OUT}/npcface_${vp}_${n}.png` });
  await D(() => window.__debug.setClock && window.__debug.setClock(13));
  const npcs = await D(() => window.__debug.npcs());
  const byName = Object.fromEntries(npcs.map((n) => [n.name, n]));
  const advance = async (ms) => { await D((m) => window.__debug.advance(m), ms); await page.waitForFunction(() => window.__debug.stepsLeft() === 0, null, { timeout: 20000 }); };
  const wide = (nm, dist, up, k = 0.35, look = 1.0) => {
    const n = byName[nm]; const a = n.rotY ?? 0, fx = Math.sin(a), fz = Math.cos(a);
    const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
    const p = n.pos;
    return D((c) => window.__debug.cam(c), { pos: [p[0] + cx * dist, p[1] + up, p[2] + cz * dist], target: [p[0], p[1] + look, p[2]], fov: 46, near: 0.8 });
  };
  const portraitCam = async (nm, dist = 3.4, up = 1.5, k = 0.45) => {
    const n = byName[nm]; const a = n.rotY ?? 0, fx = Math.sin(a), fz = Math.cos(a);
    { // the crowd measures distance from the game camera, which follows the player: stand them behind the shot
      const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
      await D(([x, z, y]) => window.__debug.footTeleport(x, z, y), [n.pos[0] + cx * (dist + 3), n.pos[2] + cz * (dist + 3), n.pos[1] + 1.5]);
      await sleep(500);
    }
    const cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
    const p = n.pos;
    return D((c) => window.__debug.cam(c), { pos: [p[0] + cx * dist, p[1] + up, p[2] + cz * dist], target: [p[0], p[1] + 1.0, p[2]], fov: 34, near: 1.0 });
  };
  // ---- the big catch at the town dock: fishing happens out at the hotspots, so the town sees a
  //      catch when it's laid out at the fish buyer — sell a legendary sixgill beside the dock crowd
  await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
  await sleep(1500);
  const hud = await page.addStyleTag({ content: '#hud, .hud-top, .bubble, .hint, .toast, .catch-card, .catch-line, .title-card { visibility: hidden !important }' });
  await wide('NPC_DockhandJuno', 3.6, 1.6, 0.45, 1.1);
  await D(() => window.__debug.clock(true));
  await advance(200); await shot('catch_pre');
  await D(() => window.__debug.sellAll());
  for (let i = 0; i < 26; i++) { await advance(140); await shot(`catch_${String(i).padStart(2, '0')}`); if (i === 4) log(`[${vp}] catch faces`, JSON.stringify((await D(() => window.__debug.npcFaces())).filter((f) => f.d < 30 && f.want !== 'neutral').map((f) => `${f.name}:${f.want}`))); }
  await D(() => window.__debug.clock(false));
  await hud.evaluate((el) => el.remove());
  // ---- ashore: thunder over the plaza
  await D(() => window.__debug.cam(null));
  await D(() => window.__debug.stepAshore());
  await sleep(1500);
  await D(() => window.__debug.footTeleport(31.0, 147.0, 2.5));
  await D(() => window.__debug.storm(0.6));
  await sleep(2500);
  const hud2 = await page.addStyleTag({ content: '#hud, .hud-top, .bubble, .hint, .toast, .title-card { visibility: hidden !important }' });
  const crier = byName.NPC_TheCrier.pos;
  await wide('NPC_TheCrier', 4.4, 2.0, 0.15, 1.6);
  await sleep(600);
  await D(() => window.__debug.clock(true));
  await advance(200); await shot('thunder_pre');
  await D(() => window.__debug.lightning(true));
  for (let i = 0; i < 22; i++) { await advance(110); await shot(`thunder_${String(i).padStart(2, '0')}`); if (i === 3) log(`[${vp}] thunder faces`, JSON.stringify((await D(() => window.__debug.npcFaces())).filter((f) => f.d < 30 && f.want !== 'neutral').map((f) => `${f.name}:${f.want}`))); }
  await D(() => window.__debug.clock(false));
  await D(() => window.__debug.storm(null));
  await sleep(1500);
  // ---- the sheet: a few NPCs × every expression
  for (const nm of SHEET) {
    if (!byName[nm]) continue;
    await (nm === 'NPC_Pip' ? portraitCam(nm, 2.3, 1.3, 0.0) : portraitCam(nm));
    for (const e of EXPRS) {
      await D(([n, x]) => window.__debug.npcEmote(n, x, 30), [nm, e]);
      await sleep(450);
      await shot(`sheet_${nm.replace('NPC_', '')}_${e}`);
    }
    await D(([n]) => window.__debug.npcEmote(n, 'neutral', 0.01), [nm]);
  }
  await hud2.evaluate((el) => el.remove());
  // ---- talk: walk up to the Crier and talk (his line is tagged with an emotion)
  await D(() => window.__debug.cam(null));
  await D(([x, z]) => window.__debug.footTeleport(x, z, 2.5), [crier[0] - 2.2, crier[2] + 1.6]);
  await sleep(800);
  await D(([x, z]) => window.__debug.footPathTo(x, z), [crier[0] - 1.4, crier[2] + 1.1]);
  await sleep(2200);
  await D(() => window.__debug.clock(true));
  log(`[${vp}] talk ->`, await D(() => window.__debug.interact()), JSON.stringify(await D(() => window.__debug.state.foot?.bubble)));
  for (let i = 0; i < 18; i++) { await advance(150); await shot(`talk_${String(i).padStart(2, '0')}`); if (i === 2) log(`[${vp}] talk faces`, JSON.stringify((await D(() => window.__debug.npcFaces())).filter((f) => f.d < 12).map((f) => `${f.name}:${f.want}`))); }
  await D(() => window.__debug.clock(false));
  log(`[${vp}] console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
  total += errors.length;
  await ctx.close();
}
if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
await browser.close();
fs.writeFileSync(`${OUT}/npcface_log.txt`, lines.join('\n'));
console.log(total ? `FAIL ${total}` : 'PASS');
process.exit(total ? 1 : 0);
