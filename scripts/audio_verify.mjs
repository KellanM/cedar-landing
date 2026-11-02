// Audio verification: node scripts/audio_verify.mjs [baseUrl] [phone|desktop|both] [--no-render]
// 1) Live wiring: unlock audio with a real gesture, sail (engine/wake), fish a catch (cast → plop →
//    bite → strike → reel clicks → fight music → land → chime + music resolve → keep), open the
//    Log + Settings (volume rows), walk ashore (footsteps by surface, NPC talk murmur), open the
//    chandlery, check the music state machine and voice counts, 0 console errors.
// 2) Offline renders through the real graph (OfflineAudioContext): WAVs → screenshots/audio/,
//    with peak / RMS / clipping / silence stats (screenshots/audio/levels.json).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5197/cedar-landing/';
const ONLY = process.argv[3] ?? 'both';
const RENDER = !process.argv.includes('--no-render');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const lines = [];
const log = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };
let fails = 0;
const check = (ok, what, extra = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`); if (!ok) fails++; };

async function live(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
  await page.evaluate(() => window.__debug.markRevealSeen());
  await sleep(1200);
  const A = () => page.evaluate(() => window.__debug.audio.state());
  const st = () => page.evaluate(() => window.__debug.state);

  // ---- before any gesture: no AudioContext at all
  const pre = await A();
  check(pre.ctx === 'none' && !pre.created, `[${name}] no audio before the first gesture`, `ctx=${pre.ctx}`);
  // first gesture: a tap on the canvas (touch on phone)
  if (isMobile) await page.touchscreen.tap(viewport.width / 2, viewport.height * 0.4); else await page.mouse.click(viewport.width / 2, viewport.height * 0.4);
  await sleep(600);
  let a = await A();
  check(a.ctx === 'running', `[${name}] AudioContext running after gesture`, `ctx=${a.ctx}`);
  check(a.music && a.music.state === 'rest', `[${name}] music starts at rest (silence first)`, JSON.stringify(a.music));

  // ---- sail: engine + wake follow throttle
  await page.keyboard.down('w');
  await sleep(2500);
  a = await A();
  const sail = { rate: a.engine.rate, level: a.engine.level, wake: a.amb.wake };
  await page.keyboard.up('w');
  await sleep(2500);
  a = await A();
  const idle = { rate: a.engine.rate, level: a.engine.level, wake: a.amb.wake };
  check(sail.rate > idle.rate && sail.level > idle.level, `[${name}] engine rate/level follow throttle`, `sailing ${JSON.stringify(sail)} idle ${JSON.stringify(idle)}`);
  check(sail.wake > 0.3 && idle.wake < sail.wake, `[${name}] wake hiss follows speed`);
  check((a.counts['sfx.engineStart'] ?? 0) >= 1, `[${name}] engine start cough on cast-off`);
  log(`[${name}] zones at sea`, JSON.stringify(a.zones), 'amb', JSON.stringify(a.amb));

  // ---- music: force a piece so the explore → fight → resolve path is exercised
  await page.evaluate(() => window.__debug.audio.forceMusic('day'));
  await sleep(1500);
  a = await A();
  check(a.music.state === 'piece', `[${name}] explore piece playing`, JSON.stringify(a.music.piece));

  // ---- fishing: real input path (Space), like smoke.mjs
  const hs = (await page.evaluate(() => window.__debug.hotspots()))[0];
  await page.evaluate((h) => window.__debug.teleportTo(h, 4), hs);
  await sleep(800);
  await page.keyboard.press('Space');
  await sleep(1300);
  const t0 = Date.now();
  while ((await st()).phase !== 'bite' && Date.now() - t0 < 14000) await sleep(40);
  await page.keyboard.down('Space');
  await sleep(150);
  let held = true, sawFight = false, maxTen = 0;
  const t1 = Date.now();
  while ((await st()).phase === 'reeling' && Date.now() - t1 < 40000) {
    const s = await st();
    maxTen = Math.max(maxTen, s.tension);
    const want = s.tension < 0.7;
    if (want !== held) { if (want) await page.keyboard.down('Space'); else await page.keyboard.up('Space'); held = want; }
    if (!sawFight) { const m = (await A()).music; if (m.state === 'fight') sawFight = true; }
    await sleep(40);
  }
  await page.keyboard.up('Space');
  await sleep(1800);
  a = await A();
  const c = a.counts;
  check(c['sfx.cast'] >= 1 && c['sfx.plop'] >= 1, `[${name}] cast whoosh + bobber plop`);
  check(c['sfx.bite'] >= 1 && c['sfx.strike'] >= 1, `[${name}] bite + strike`);
  check(c['sfx.strainOn'] >= 1 && c['sfx.strainOff'] >= 1, `[${name}] line-strain voice on/off`);
  check(sawFight && (c['music.fight'] ?? 0) >= 1, `[${name}] music switched to the fight layer`, `max tension ${maxTen.toFixed(2)}`);
  check((c['sfx.thrash'] ?? 0) + (c['sfx.breach'] ?? 0) + (c['sfx.leap'] ?? 0) >= 1, `[${name}] fight splashes`, `thrash ${c['sfx.thrash'] ?? 0} leap ${c['sfx.leap'] ?? 0} breach ${c['sfx.breach'] ?? 0}`);
  check((c['sfx.chime'] ?? 0) >= 1 && (c['music.resolve'] ?? 0) >= 1, `[${name}] catch chime + music resolves`, a.events.filter((x) => /chime|resolve/.test(x.name)).map((x) => x.detail).join(','));
  check(['resolve', 'rest'].includes(a.music.state), `[${name}] music state after catch`, a.music.state);
  await page.waitForSelector('#card.armed #card-keep', { timeout: 6000 }).catch(() => {});
  await page.click('#card-keep').catch(() => page.evaluate(() => window.__debug.keep()));
  await sleep(400);
  a = await A();
  check((a.counts['sfx.keep'] ?? 0) >= 1, `[${name}] cooler keep thunk`);
  check(a.voices.dropped < 40 && a.voices.peak < 120, `[${name}] voices bounded`, JSON.stringify(a.voices));

  // ---- second fish: release
  await page.evaluate(() => window.__debug.setAutoReel(true));
  await page.evaluate(() => window.__debug.action());
  await sleep(1000);
  await page.evaluate(() => window.__debug.forceBite());
  const t2 = Date.now();
  while ((await st()).phase !== 'landed' && Date.now() - t2 < 40000) await sleep(100);
  await sleep(1200);
  await page.waitForSelector('#card.armed #card-release:not(.hidden), #catch-slip.armed #slip-release', { timeout: 6000 }).catch(() => {});
  const rel = await page.$('#card.armed #card-release:not(.hidden)') ?? await page.$('#catch-slip.armed #slip-release');
  if (rel) await rel.click().catch(() => {}); else await page.evaluate(() => window.__debug.keep());
  await sleep(400);
  a = await A();
  check((a.counts['sfx.release'] ?? 0) + (a.counts['sfx.keep'] ?? 0) >= 2, `[${name}] release splash (or keep) on the second fish`, `release ${a.counts['sfx.release'] ?? 0}`);

  // ---- Log + Settings: open/close/page sounds, the volume rows, persistence
  await page.click('#btn-log');
  await sleep(500);
  await page.click('.ribbon[data-tab="settings"]');
  await sleep(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#set-music button, #set-sound button')].map((b) => b.textContent));
  check(rows.length === 8, `[${name}] Settings has Music + Sound volume rows`, rows.join(' '));
  await page.click('#set-music button[data-v="0.35"]');
  await sleep(200);
  await page.click('#set-sound button[data-v="0.7"]');
  await sleep(300);
  a = await A();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('salish-sea-save-v1') || '{}').settings);
  check(saved && saved.music === 0.35 && saved.sound === 0.7 && a.vol.music === 0.35, `[${name}] volumes applied + saved`, JSON.stringify({ saved: { music: saved?.music, sound: saved?.sound }, buses: a.buses }));
  await page.click('#set-music button[data-v="0"]');
  await sleep(500);
  a = await A();
  check(a.music.state === 'off' && a.buses.music === 0, `[${name}] Music Off stops the score`, `${a.music.state} bus ${a.buses.music}`);
  await page.click('#set-music button[data-v="0.7"]');
  await page.click('#set-sound button[data-v="1"]');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(400);
  a = await A();
  check((a.counts['ui.open'] ?? 0) >= 1 && (a.counts['ui.close'] ?? 0) >= 1 && (a.counts['ui.page'] ?? 0) + (a.counts['ui.tap'] ?? 0) >= 1, `[${name}] Log open / close / page-tap sounds`);

  // ---- ashore (foot_verify's route): footsteps by surface, NPC murmur
  await page.evaluate(() => window.__debug.teleport(23.5, 157.5, Math.PI / 2));
  await sleep(1500);
  let s0 = await st();
  if (s0.interact === 'step_ashore') await page.keyboard.press('e'); else await page.keyboard.press('Space');
  await sleep(1500);
  s0 = await st();
  if (s0.foot.mode !== 'foot') { await page.evaluate(() => window.__debug.stepAshore()); await sleep(1500); s0 = await st(); }
  check(s0.foot.mode === 'foot', `[${name}] stepped ashore`);
  a = await A();
  check((a.counts['sfx.engineStop'] ?? 0) >= 1 && a.engine.rate === 0, `[${name}] engine off ashore`);
  const walkTo = async (x, z, secs = 12) => {
    await page.evaluate(([X, Z]) => window.__debug.footPathTo(X, Z), [x, z]);
    const tw = Date.now();
    while (Date.now() - tw < secs * 1000) { const q = await st(); if (!q.foot.autoWalk) break; await sleep(150); }
    await page.evaluate(() => window.__debug.footWalkTo(null));
  };
  await walkTo(21.2, 150.9);
  await walkTo(16.3, 147.8);
  await walkTo(21.6, 144.7);
  await walkTo(24.9, 140.4, 14);
  await page.keyboard.press('e');
  await sleep(900);
  a = await A();
  const surf = Object.entries(a.counts).filter(([k]) => k.startsWith('step.')).map(([k, v]) => `${k.slice(5)}×${v}`);
  check((a.counts['sfx.step'] ?? 0) >= 6, `[${name}] footsteps while walking`, `${surf.join(' ')}`);
  check((a.counts['sfx.murmur'] ?? 0) >= 1, `[${name}] NPC talk murmur`, (await st()).foot.bubble ? JSON.stringify((await st()).foot.bubble).slice(0, 80) : 'no bubble');
  log(`[${name}] zones ashore`, JSON.stringify(a.zones), 'amb', JSON.stringify(a.amb));
  check(a.zones.harbour > 0.4 || a.zones.forest > 0.4, `[${name}] ambience zone moved off open water ashore`);
  // the chandlery (buy_tackle): open its sheet via the upgrades debug if present
  const shopOk = await page.evaluate(() => { const u = window.__debug.upg; try { return u?.openShop ? (u.openShop(), true) : false; } catch { return false; } });
  await sleep(500);
  if (shopOk) {
    await page.evaluate(() => { window.__debug.state; });
    log(`[${name}] shop opened via debug`);
  }
  // UI sounds fired through the engine
  await page.evaluate(() => window.__debug.closeModals());
  await sleep(300);

  // ---- time of day: night variant
  for (let i = 0; i < 6; i++) { if ((await st()).tod === 'night') break; await page.evaluate(() => window.__debug.cycleTOD()); await sleep(100); }
  await page.evaluate(() => window.__debug.audio.forceMusic('night'));
  await sleep(800);
  a = await A();
  check(a.music.piece?.variant === 'night' && a.music.piece.bpm < 72, `[${name}] night variant is slower and gentler`, JSON.stringify(a.music.piece));

  // ---- visibility: hidden tab suspends
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(400);
  a = await A();
  check(a.ctx === 'suspended', `[${name}] hidden tab suspends the AudioContext`, a.ctx);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(400);
  a = await A();
  check(a.ctx === 'running', `[${name}] visible again resumes`, a.ctx);
  check(a.voices.peak < 140, `[${name}] peak scheduled voices`, JSON.stringify(a.voices));
  log(`[${name}] music history`, JSON.stringify(a.music.history));
  log(`[${name}] event counts`, JSON.stringify(a.counts));
  check(errors.length === 0, `[${name}] console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
  await ctx.close();
}

async function renders() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?debug', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.audio, null, { timeout: 120000 });
  const jobs = [
    ['music_day', 'music:day', 75, 11], ['music_day_b', 'music:day', 75, 23], ['music_night', 'music:night', 75, 5], ['music_town', 'music:town', 50, 3], ['music_dusk', 'music:dusk', 60, 8],
    ['fight', 'fight', 22, 4], ['fishing_sfx', 'fishing', 17, 1], ['boat', 'boat', 15, 1], ['wildlife', 'wildlife', 15, 1], ['foot_and_talk', 'foot', 13, 1], ['ui', 'ui', 12, 1],
    ['amb_open', 'amb:open', 30, 1], ['amb_harbour', 'amb:harbour', 30, 1], ['amb_forest', 'amb:forest', 30, 1], ['amb_forest_dusk', 'amb:forest_dusk', 30, 1], ['amb_night', 'amb:forest_night', 30, 1], ['amb_fog', 'amb:open_fog', 45, 1],
  ];
  const levels = {};
  for (const [file, kind, secs, seed] of jobs) {
    const t = Date.now();
    const r = await page.evaluate(([k, s, sd]) => window.__debug.audio.render(k, s, sd), [kind, secs, seed]);
    fs.writeFileSync(path.join(OUT, `${file}.wav`), Buffer.from(r.wav, 'base64'));
    levels[file] = { kind, secs, ...r.stats, events: undefined };
    const s = r.stats;
    const ok = s.peakDb <= -0.3 && s.clipped === 0 && s.rmsDb > -60;
    check(ok, `render ${file}`, `peak ${s.peakDb} dBFS, rms ${s.rmsDb} dBFS, clipped ${s.clipped}, silent ${s.silentPct}%, bands <200/mid/>4k ${s.bandPct.below200}/${s.bandPct.mid}/${s.bandPct.above4k}%, voices ${s.peakVoices}, dropped ${s.dropped} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }
  // compose stats (form / event counts) for a few seeds
  const forms = await page.evaluate(() => ['day', 'night', 'town', 'dusk'].flatMap((v) => [1, 2, 3].map((sd) => { const p = window.__debug.audio.compose(v, sd); return `${v}#${sd}: ${p.mode} ${p.bpm}bpm ${p.meter === 6 ? '6/8' : p.meter + '/4'} ${p.bars} bars ${p.length.toFixed(0)}s lead=${p.lead} [${p.form}] ${p.events} notes`; })));
  forms.forEach((f) => log('  compose', f));
  fs.writeFileSync(path.join(OUT, 'levels.json'), JSON.stringify(levels, null, 2));
  check(errors.length === 0, `[render] console errors: ${errors.length}`, errors.slice(0, 4).join(' | '));
  await ctx.close();
}

if (ONLY === 'phone' || ONLY === 'both') await live('phone', { width: 390, height: 844 }, true);
if (ONLY === 'desktop' || ONLY === 'both') await live('desktop', { width: 1280, height: 800 }, false);
if (RENDER) await renders();
await browser.close();
log(fails ? `AUDIO VERIFY: ${fails} FAIL` : 'AUDIO VERIFY: ALL PASS');
fs.writeFileSync(path.join(OUT, 'audio_verify_log.txt'), lines.join('\n'));
process.exit(fails ? 1 : 0);
