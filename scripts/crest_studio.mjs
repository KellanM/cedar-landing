// Crest life-cycle studio (crest study): node scripts/crest_studio.mjs [baseUrl] [tag] [query]
// Spawns crests of three sizes in open water with nothing else around (density 0), looks straight down
// from 9 m, steps the sim in exact 100 ms ticks through one life, and writes a strip of every 3rd frame
// screenshots/crests_<tag>_studio.png plus a 10 fps GIF screenshots/crests_<tag>_studio.gif.
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:5202/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const QUERY = process.argv[4] && process.argv[4] !== '-' ? `&${process.argv[4]}` : '';
const OUT = path.resolve('screenshots');
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '?debug' + QUERY);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
await page.addStyleTag({ content: '.title-card{display:none!important} #hud,.hud,#fps,body > *:not(canvas){opacity:0!important}' });
await page.evaluate(async () => { for (let i = 0; i < 8 && window.__debug.state.tod !== 'sunbreak'; i++) window.__debug.cycleTOD(); });
await new Promise((r) => setTimeout(r, 1500));
// open water well away from the boat; wind points +x on screen? we look down with the camera's up = -z
const C = [180, 250];
await page.evaluate((C) => { window.__debug.teleport(120, 200, 0); window.__debug.cam({ pos: [C[0], 9, C[1] + 0.01], target: [C[0], 0, C[1]], fov: 50 }); }, C);
await new Promise((r) => setTimeout(r, 800));
const info = await page.evaluate((C) => {
  const sea = window.__debug.seaObj();
  const { WATER_TUNE } = sea.constructor;
  sea.crests.density = 0; sea.crests.enabled = false; sea.crests.debugMode = true;
  const w = sea.crests.windNow ?? null;
  window.__debug.clock(true);
  sea.crests.debugSpawn(C[0] - 2.6, C[1] - 1.2, 0.8, 3.4, 1, 0.2);
  sea.crests.debugSpawn(C[0] + 0.8, C[1] - 1.6, 1.1, 4.2, -1, 0.55);
  sea.crests.debugSpawn(C[0] + 0.4, C[1] + 1.9, 1.4, 5.0, 1, 0.81);
  return w;
}, C);
const dir = path.join(OUT, 'crestframes', `${TAG}_studio`);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
for (let i = 0; i < 52; i++) {
  await page.evaluate(() => window.__debug.advance(100));
  await page.waitForFunction(() => window.__debug.stepsLeft() === 0);
  await page.screenshot({ path: path.join(dir, `f_${String(i).padStart(3, '0')}.png`) });
}
const FF = process.env.FFMPEG ?? 'ffmpeg';
execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', "select='not(mod(n\,4))',scale=320:-1,tile=7x2:padding=3", '-frames:v', '1', '-update', '1', path.join(OUT, `crests_${TAG}_studio.png`)]);
execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f_%03d.png'), '-vf', 'split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse', path.join(OUT, `crests_${TAG}_studio.gif`)]);
console.log('studio', TAG, 'errors', errors.length, errors.slice(0, 3).join(' | '), info);
await ctx.close(); await browser.close();
