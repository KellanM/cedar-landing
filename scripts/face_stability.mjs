// Face stability + skipper expression test: node scripts/face_stability.mjs [baseUrl] [--gif tag]
//  (a) NPC faces hold still: with no events, an NPC holding an expression keeps its overlay fixed on the
//      head (centre in head-bone space, std < 3 mm; size std < 1 %) over 3 s. Also neutral (blinks only).
//  (b) the skipper's expression follows the fishing beats: cast → strike (surprised) → reel (effort/worried)
//      → landed (happy/joy) → a too-early tap (missed: sad).
// Frames for GIFs go to screenshots/facefix_<tag>_{npc,skipper}_NN.png (phone viewport).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5258/cedar-landing/';
const TAG = process.argv.includes('--gif') ? process.argv[process.argv.indexOf('--gif') + 1] : null;
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const chrome = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p)) : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? chrome, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE_SAVE = { shells: 0, coolerCap: 6, records: {}, seenReveal: true, reachedLanding: true, cooler: [], opening: { q: 99, steps: [], done: true, stage: 3, flags: [] }, settings: { quality: 'high', autoReel: false, showFps: false, tod: null } };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: TAG ? 2 : 1, isMobile: true, hasTouch: true });
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
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const std = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const hud = await page.addStyleTag({ content: '#hud, .hud-top, .bubble, .hint, .toast, .title-card { visibility: hidden !important }' });
await D(() => window.__debug.setClock && window.__debug.setClock(13));
await D(() => window.__debug.crowdQuiet(true));

// ---- (b) skipper expressions through the fishing beats
const hs = (await D(() => window.__debug.hotspots()))[0];
await D((h) => window.__debug.viewHotspot(h, 7), hs);
await sleep(1500);
let frame = 0;
const seen = [];
const skipCam = async () => {
  const p = await D(() => window.__debug.faceProbe('skipper'));
  if (!p) return null;
  const f = p.fwd ?? [1, 0, 0];
  await D((c) => window.__debug.cam(c), { pos: [p.c[0] + f[0] * 1.7 + f[2] * 0.6, p.c[1] + 0.25, p.c[2] + f[2] * 1.7 - f[0] * 0.6], target: [p.c[0], p.c[1] - 0.15, p.c[2]], fov: 40, near: 0.3 });
  return p;
};
const beat = async (label, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await D(() => window.__debug.faceProbe('skipper')); // the real game camera (what the player sees)
    if (p) seen.push({ label, want: p.want, shown: p.shown, visible: p.visible, toCam: p.toCam, glance: p.glance });
    if (TAG) await page.screenshot({ path: `${OUT}/facefix_${TAG}_skipper_${String(frame++).padStart(3, '0')}.png` });
    await sleep(80);
  }
};
check(!!(await D(() => window.__debug.faceProbe('skipper'))), 'skipper has expression overlays');
await D(() => window.__debug.nextCatch('bluntnose_sixgill', 300));
await D(() => window.__debug.action());
await beat('cast', 1300);
await D(() => window.__debug.forceBite());
await page.waitForFunction(() => window.__debug.state.phase === 'bite', null, { timeout: 8000 }).catch(() => {});
await beat('bite', 300);
await D(() => window.__debug.action());
await beat('strike', 700);
await beat('reel', 1200);
await D(() => window.__debug.landNow());
await beat('landed', 2500);
await D(() => { window.__debug.keep?.(); window.__debug.closeModals?.(); window.__debug.nextCatch(null); });
await page.waitForFunction(() => window.__debug.state.phase === 'idle', null, { timeout: 10000 }).catch(() => {});
await sleep(800);
await D(() => window.__debug.action()); // cast again
await page.waitForFunction(() => window.__debug.state.phase === 'waiting', null, { timeout: 8000 }).catch(() => {});
await D(() => window.__debug.action()); // too soon: it swims off
await beat('missed', 1500);
const by = (l) => [...new Set(seen.filter((s) => s.label === l).map((s) => s.shown))];
console.log('skipper faces the camera (dot)', JSON.stringify(Object.fromEntries(['cast', 'bite', 'strike', 'reel', 'landed', 'missed'].map((l) => [l, seen.filter((s) => s.label === l).map((s) => s.toCam)]))));
console.log('glance yaw', JSON.stringify(seen.map((s) => s.glance)));
console.log('skipper beats', JSON.stringify(Object.fromEntries(['cast', 'bite', 'strike', 'reel', 'landed', 'missed'].map((l) => [l, by(l)]))));
check(by('bite').concat(by('strike')).includes('surprised'), 'skipper: Strike! shows surprised');
check(by('reel').some((x) => x === 'effort' || x === 'worried' || x === 'surprised'), 'skipper: reeling shows effort');
check(by('landed').some((x) => x === 'joy' || x === 'happy'), 'skipper: the catch shows joy/happy');
check(by('missed').includes('sad'), 'skipper: a missed fish shows sad');
const faces = (l) => Math.max(...seen.filter((s) => s.label === l).map((s) => s.toCam ?? -1));
check(Math.max(faces('bite'), faces('strike')) > 0.2 && faces('landed') > 0.2 && faces('missed') > 0.2, `skipper: the face turns to the game camera on strike / catch / miss (best dot ${faces('strike')}, ${faces('landed')}, ${faces('missed')})`);
check(new Set(seen.map((s) => s.shown)).size >= 4, `skipper: expression changes through the beats (${[...new Set(seen.map((s) => s.shown))].join(', ')})`);
await D(() => window.__debug.cam(null));
// ---- (a) NPC faces at the town dock
await D(() => { window.__debug.closeModals?.(); window.__debug.keep?.(); });
await page.waitForFunction(() => window.__debug.state.phase === 'idle' && !window.__debug.state.inShot, null, { timeout: 15000 }).catch(() => {});
await D(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
await sleep(1500);
const npcs = Object.fromEntries((await D(() => window.__debug.npcs())).map((n) => [n.name, n]));
const portrait = (nm) => {
  const n = npcs[nm]; const a = n.rotY ?? 0, k = 0.45, dist = 3.0;
  const fx = Math.sin(a), fz = Math.cos(a), cx = fx * Math.cos(k) - fz * Math.sin(k), cz = fz * Math.cos(k) + fx * Math.sin(k);
  return D((c) => window.__debug.cam(c), { pos: [n.pos[0] + cx * dist, n.pos[1] + 1.5, n.pos[2] + cz * dist], target: [n.pos[0], n.pos[1] + 1.05, n.pos[2]], fov: 34, near: 1.0 });
};
frame = 0;
for (const [nm, e] of [['NPC_DockhandJuno', 'worried'], ['NPC_DockhandJuno', 'neutral'], ['NPC_TheCrier', 'surprised']]) {
  if (!npcs[nm]) continue;
  if (nm === 'NPC_TheCrier') { await D(() => window.__debug.stepAshore()); await sleep(1200); await D(([x, z]) => window.__debug.footTeleport(x, z, 3), [npcs[nm].pos[0] + 4, npcs[nm].pos[2] + 4]); await sleep(1200); }
  await portrait(nm);
  await D(([n, x]) => window.__debug.npcEmote(n, x, 30), [nm, e]);
  await sleep(1200); // let the change pop settle
  const S = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    S.push(await D((n) => window.__debug.faceProbe(n), nm));
    if (TAG && S.length % 2 === 0) await page.screenshot({ path: `${OUT}/facefix_${TAG}_npc_${String(frame++).padStart(2, '0')}.png` });
    await sleep(60);
  }
  const lc = [0, 1, 2].map((i) => std(S.map((s) => s.lc[i])));
  const lcMax = Math.max(...lc);
  const sz = [0, 1, 2].map((i) => std(S.map((s) => s.scale[i])) / (S.reduce((a, s) => a + s.scale[i], 0) / S.length));
  const wobble = Math.max(...sz);
  const shown = [...new Set(S.map((s) => s.shown))].join('/');
  if (e !== 'neutral') check(S.every((s) => s.shown === e), `${nm} shows ${e} while held (${shown})`);
  if (e === 'neutral') check(lcMax < 0.003, `${nm} neutral: face anchor on the head holds still over 3 s (std ${(lcMax * 1000).toFixed(2)} mm; shown ${shown})`);
  else check(lcMax < 0.003 && wobble < 0.01, `${nm} ${e}: overlay holds still over 3 s (centre std ${(lcMax * 1000).toFixed(2)} mm, size std ${(wobble * 100).toFixed(2)} %; shown ${shown})`);
}
await D(() => window.__debug.cam(null));

await hud.evaluate((el) => el.remove());
check(errors.length === 0, `console errors: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(fails ? `FACE STABILITY: ${fails} FAIL` : 'FACE STABILITY: ALL PASS');
process.exit(fails ? 1 : 0);
