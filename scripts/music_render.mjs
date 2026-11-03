// Offline music renders through the real graph: node scripts/music_render.mjs [baseUrl] [prefix] [job,job,...]
// A job is name=kind:secs:seed, e.g. "dawn_sea=scene:dawn_sea:150:3". Writes screenshots/audio/<prefix><name>.wav
// and screenshots/audio/<prefix>levels.json (peak / RMS / clipping / band split / voices), plus the
// wall-clock render time and an estimated CPU share (render seconds per audio second).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5248/cedar-landing/';
const PREFIX = process.argv[3] ?? 'music_';
const JOBS = (process.argv[4] ?? '').split(',').filter(Boolean).map((j) => {
  const [name, spec] = j.split('=');
  const parts = spec.split(':');
  const seed = +parts.pop(), secs = +parts.pop();
  return { name, kind: parts.join(':'), secs, seed };
});
const OUT = path.resolve('screenshots/audio');
fs.mkdirSync(OUT, { recursive: true });

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
const browser = await chromium.launch({ executablePath: findChrome() });
const page = await (await browser.newContext({ viewport: { width: 640, height: 480 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?debug', { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__debug.audio, null, { timeout: 120000 });
const levelsPath = path.join(OUT, `${PREFIX}levels.json`);
const levels = fs.existsSync(levelsPath) ? JSON.parse(fs.readFileSync(levelsPath, 'utf8')) : {};
let fails = 0;
for (const j of JOBS) {
  const t = Date.now();
  const r = await page.evaluate(([k, s, sd]) => window.__debug.audio.render(k, s, sd), [j.kind, j.secs, j.seed]);
  const wall = (Date.now() - t) / 1000;
  fs.writeFileSync(path.join(OUT, `${PREFIX}${j.name}.wav`), Buffer.from(r.wav, 'base64'));
  const s = r.stats;
  const ok = s.peakDb <= -0.3 && s.clipped === 0 && s.rmsDb > -60;
  if (!ok) fails++;
  levels[j.name] = { kind: j.kind, secs: j.secs, seed: j.seed, ...s, events: undefined, renderWallS: +wall.toFixed(1), renderPerAudioS: +(wall / j.secs).toFixed(3), log: r.log };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${PREFIX}${j.name} (${j.kind} ${j.secs}s) peak ${s.peakDb} dBFS rms ${s.rmsDb} dBFS clipped ${s.clipped} silent ${s.silentPct}% bands ${s.bandPct.below200}/${s.bandPct.mid}/${s.bandPct.above4k}% voices ${s.peakVoices} dropped ${s.dropped} wall ${wall.toFixed(1)}s (${(100 * wall / j.secs).toFixed(1)}% of real time; main-thread hooks ${(s.hookMs / 1000).toFixed(1)}s, render thread ≈ ${(100 * (s.wallMs - s.hookMs) / 1000 / j.secs).toFixed(1)}%)`);
  if (r.log) console.log('   ', r.log.slice(0, 14).join(' | '));
}
fs.writeFileSync(levelsPath, JSON.stringify(levels, null, 2));
console.log(`console errors: ${errors.length}`, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
