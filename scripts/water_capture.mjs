// Water comparison capture: node scripts/water_capture.mjs [baseUrl] [tag] [only=phone|desktop|-] [tods=all|overcast,dusk] [query]
// Same five views at every time of day, phone (390x844 @3x) and desktop (1280x800):
//   harbour (Cedar Landing docks), open (open water), shore (island shoreline), wake (boat under way, chase cam),
//   hotspot (fishing spot, chase cam), sunward (open water toward the sun or moon: glints). Writes screenshots/water_<tag>_<vp>_<tod>_<view>.png, a perf log
//   (fps / draw calls / tris / sea GPU bench) and one contact sheet per viewport: screenshots/water_<tag>_<vp>_sheet.png.
//   `query` is appended to the URL (e.g. "sea=classic" or "sea=crests") to capture a variant.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5198/cedar-landing/';
const TAG = process.argv[3] ?? 'cur';
const ONLY = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const TODS = !process.argv[5] || process.argv[5] === 'all' ? ['overcast', 'sunbreak', 'dusk', 'fog', 'night'] : process.argv[5].split(',');
const QUERY = process.argv[6] ? `&${process.argv[6]}` : '';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/water_${TAG}_log.txt`;
fs.writeFileSync(LOG, '');
const log = (...a) => { console.log(...a); fs.appendFileSync(LOG, a.join(' ') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Fixed camera views ({pos, target}); 'wake' and 'hotspot' use the game's chase camera.
const VIEWS = {
  harbour: { pos: [62, 15, 90], target: [21, 0, 131], fov: 50 },
  open: { pos: [135, 5, 205], target: [138, 0, 260], fov: 50 },
  shore: { pos: [-46, 3, 18], target: [-86, 0, 56], fov: 50 },
  sunward: { sun: true }, // open water looking toward the sun / moon azimuth (glints)
  hotspot: { chase: true },
  wake: { chase: true }, // last: a teleport leaves a stretched wake strip for a few seconds
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

const sheets = {};
async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 3 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug' + QUERY, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => { window.__debug.markRevealSeen(); window.__debug.skipShot(); });
  await page.addStyleTag({ content: '.title-card{display:none!important}' }); // region title cards would cover the water
  await sleep(1500);
  const files = [];
  for (const tod of TODS) {
    await page.evaluate(async (want) => {
      for (let i = 0; i < 8 && window.__debug.state.tod !== want; i++) window.__debug.cycleTOD();
    }, tod);
    await sleep(1300); // lighting preset cross-fade
    for (const [view, v] of Object.entries(VIEWS)) {
      if (v.chase) {
        await page.evaluate(() => window.__debug.cam(null));
        if (view === 'wake') {
          await page.evaluate(() => { window.__debug.teleport(135, 215, Math.PI); });
          await page.evaluate(() => window.__debug.key('w', true));
          await sleep(2600);
        } else {
          await page.evaluate(() => window.__debug.viewHotspot('LIFE_HS02_KeeperEastShelf', 9, 2.2));
          await sleep(1400);
        }
      } else if (v.sun) {
        const az = await page.evaluate(async (t) => {
          const g = await (await fetch('world/gameplay.json')).json();
          return g.time_of_day[t]?.clouds?.sun?.[0] ?? 200;
        }, tod);
        const a = (az * Math.PI) / 180, p = [130, 4, 215];
        await page.evaluate((c) => window.__debug.cam(c), { pos: p, target: [p[0] + Math.sin(a) * 60, 0, p[2] - Math.cos(a) * 60], fov: 50 });
        await sleep(900);
      } else {
        await page.evaluate((c) => window.__debug.cam(c), { pos: v.pos, target: v.target, fov: v.fov });
        await sleep(900);
      }
      const file = `water_${TAG}_${name}_${tod}_${view}.png`;
      await page.screenshot({ path: `${OUT}/${file}` });
      if (view === 'wake') { await page.evaluate(() => window.__debug.key('w', false)); await sleep(4500); }
      const s = await page.evaluate(() => { const s = window.__debug.state; return { fps: s.fps, draws: s.drawCalls, tris: s.tris, tod: s.tod }; });
      files.push({ file, tod, view });
      log(`[${name}] ${file}`, JSON.stringify(s));
    }
  }
  // perf: steady fps over 4 s on the open-water view, and a synchronous GPU bench of the frame if exposed
  await page.evaluate((c) => window.__debug.cam(c), { pos: VIEWS.open.pos, target: VIEWS.open.target, fov: 50 });
  await sleep(4000);
  const perf = await page.evaluate(() => {
    const s = window.__debug.state;
    const b = window.__debug.benchFrame ? window.__debug.benchFrame(120) : null;
    return { fps: s.fps, draws: s.drawCalls, tris: s.tris, bench: b };
  });
  log(`[${name}] perf open view`, JSON.stringify(perf));
  log(`[${name}] console errors: ${errors.length}`, errors.slice(0, 5).join(' | '));
  sheets[name] = { files, viewport, errors: errors.length };
  await ctx.close();
}

async function contactSheet(name) {
  const { files, viewport } = sheets[name];
  const views = Object.keys(VIEWS);
  const cellW = name === 'phone' ? 180 : 360;
  const cellH = Math.round(cellW * viewport.height / viewport.width);
  const rows = TODS.map((tod) => `<tr><th>${tod}</th>${views.map((v) => {
    const f = files.find((x) => x.tod === tod && x.view === v);
    return `<td>${f ? `<img src="file:///${OUT.replace(/\\/g, '/')}/${f.file}" width="${cellW}" height="${cellH}">` : ''}</td>`;
  }).join('')}</tr>`).join('');
  const html = `<html><body style="margin:0;background:#222;color:#eee;font:13px system-ui"><div style="padding:6px 8px"><b>water ${TAG} · ${name} ${viewport.width}x${viewport.height}</b></div><table cellspacing="3"><tr><th></th>${views.map((v) => `<th>${v}</th>`).join('')}</tr>${rows}</table></body></html>`;
  const htmlPath = `${OUT}/water_${TAG}_${name}_sheet.html`;
  fs.writeFileSync(htmlPath, html);
  const ctx = await browser.newContext({ viewport: { width: 80 + views.length * (cellW + 4), height: 40 + TODS.length * (cellH + 4) } });
  const page = await ctx.newPage();
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
  await sleep(300);
  await page.screenshot({ path: `${OUT}/water_${TAG}_${name}_sheet.png`, fullPage: true });
  await ctx.close();
  fs.unlinkSync(htmlPath);
  log(`[${name}] sheet screenshots/water_${TAG}_${name}_sheet.png`);
}

if (ONLY !== 'desktop') await run('phone', { width: 390, height: 844 }, true);
if (ONLY !== 'phone') await run('desktop', { width: 1280, height: 800 }, false);
for (const n of Object.keys(sheets)) await contactSheet(n);
await browser.close();
