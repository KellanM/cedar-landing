// Tide falls while the player stands on a floating shop deck (phone). Checks the feet ride the deck.
// node scripts/tide2_float_gif.mjs [baseUrl] [x=116.2] [z=216.5] [from=8.2] [to=15.4] [frames=30]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:5232/cedar-landing/';
const X = Number(process.argv[3] ?? 116.2), Z = Number(process.argv[4] ?? 216.5);
const FROM = Number(process.argv[5] ?? 8.2), TO = Number(process.argv[6] ?? 15.4), N = Number(process.argv[7] ?? 30);
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '?debug'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
const D = (f, a) => page.evaluate(f, a);
await D((h) => { const d = window.__debug; d.markRevealSeen(); d.mist(0.22); d.ui.quiet?.(); d.rain?.(0); d.storm?.(0); d.setClock(h); d.tide(null); }, FROM);
await D(([x, z]) => window.__debug.teleport(x, z), [Number(process.env.BX ?? X - 8), Number(process.env.BZ ?? Z - 4)]);
await sleep(1200);
await D(() => window.__debug.stepAshore());
await sleep(1600);
const t = await D(([x, z, y]) => window.__debug.footTeleport(x, z, y), [X, Z, Number(process.env.FY ?? 4)]);
console.log('on deck', JSON.stringify(t?.feet ?? t));
await sleep(600);
const files = [];
let fail = 0;
for (let i = 0; i < N; i++) {
  const h = FROM + ((TO - FROM) * i) / (N - 1);
  const st = await D((h) => { const d = window.__debug; d.setClock(h); return { tide: d.tide(), foot: d.state.foot }; }, h);
  // a fixed camera off the float (process.env.FOLLOW=1: ride along behind the player instead)
  if (process.env.FOLLOW) await D(() => window.__debug.cam({ follow: { side: 3.2, back: 7.5, up: 3.2, look: 0.6 }, fov: 50 }));
  else await D(([x, z]) => window.__debug.cam({ pos: [x + 9, 3.2, z + 11], target: [x, 0.6, z], fov: 50 }), [X, Z]);
  await sleep(i === 0 ? 1500 : 450);
  const s2 = await D(() => window.__debug.state.foot);
  const g = await D(([x, z, y]) => window.__debug.footProbe(x, z, y + 0.5, 0.8, 1.5), [s2.feet.x, s2.feet.z, s2.feet.y]);
  const gap = g ? s2.feet.y - g.y : NaN;
  if (!(Math.abs(gap) < 0.06) || s2.mode !== 'foot') fail++;
  const f = `screenshots/tide2_float_${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: f });
  files.push(f);
  if (i % 5 === 0 || i === N - 1) console.log(`${h.toFixed(2)}h tide ${st.tide.y} feet y ${s2.feet.y.toFixed(2)} deck ${g?.y.toFixed(2)} gap ${gap.toFixed(3)} mode ${s2.mode}`);
}
console.log(fail ? `FEET OFF THE DECK in ${fail} frames` : 'PASS feet stayed on the deck');
console.log('errors', errs.length, errs.slice(0, 3));
await browser.close();
execFileSync('python', ['-c', `
import sys
from PIL import Image
fs = sys.argv[1:]
ims = [Image.open(f).convert('RGB').resize((390, 844), Image.LANCZOS) for f in fs]
pal = [im.quantize(colors=200, method=Image.Quantize.MEDIANCUT) for im in ims]
pal[0].save('screenshots/tide2_float.gif', save_all=True, append_images=pal[1:], duration=[180]*(len(pal)-1)+[1400], loop=0, optimize=True)
`, ...files]);
console.log('wrote screenshots/tide2_float.gif');
