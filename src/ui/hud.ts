/**
 * HUD facade for main.ts. Persistent HUD (Shells, cooler, compass, clock, Log), the reel and
 * context buttons (keycap hints on desktop), tension ring, Strike! cue, toasts (queued + suppressed),
 * HUD visibility states (quiet / focus / peek / pinned), layouts (portrait / phone landscape /
 * desktop, left-handed mirror) and the per-frame update. Screens live in their own modules.
 *
 * Specs: docs/study/ui_design.md ("Grandmother's Logbook") + docs/study/ui_layouts_indie.md.
 */
import * as THREE from 'three';
import './hud.css';
import './screens.css';
import './log.css';
import './opening.css';
import { ctx, $, h, esc, T, reduceMotion, type UIHandlers, type ChartSource, type Layout } from './ctx';
import { prefs, log, saveLog, debugMode } from './prefs';
import { fx } from './fx';
import { ICONS, hydrateIcons, iconForKind } from './icons';
import { TensionRing, type TensionState } from './tension';
import { fishGlyph, rarityNotch } from './fishart';
import { hints } from './hints';
import { chart } from './chart';
import { bubble, updateBubbles } from './bubble';
import { buildCard, showCard as presentCatch } from './catchcard';
import { buildMarket, marketOpen, hideSell, marketPos } from './market';
import { buildLog, openLog, closeLog, refreshLog, setApplyPrefs, chartDebug } from './log';
import { chip, pinChip, setLogBadge } from './chip';
import { titleCard, endTitle } from './title';
import { dialogue } from './dialogue';
import { initPause } from './pause';
import { initLoading, loadingDone, setLoadProgress } from './loading';
import { ERRANDS, openErrands, stamps, newlyDone } from './errands';
import { DiveHUD } from './dive';
import { SPECIES, type CaughtFish, type Species } from '../game/fishdata';
import type { LoadedWorld } from '../world/types';

export { showCard, hideCard, showSpecimen, catchHooks } from './catchcard';
export { showSell, hideSell, onSold } from './market';
import { showSell as openMarketSheet } from './market';
export { openLog, closeLog } from './log';
export { fx, bubble, titleCard, dialogue, chip, loadingDone, setLoadProgress, DiveHUD };

// ------------------------------------------------------------------ types
export interface FishingView {
  phase: string; active: boolean; autoReel: boolean; tension: number; maxTension: number; slips: number;
  distance: number; thrashing: boolean; reelHeld: boolean; pull?: number; bobber: THREE.Object3D;
}
export interface FrameState {
  camera: THREE.Camera;
  boat: { pos: THREE.Vector3; yaw: number; speed: number; moored: boolean };
  fishing: FishingView;
  canCast: boolean;
  slowEnough: boolean;
  coolerFull: boolean;
  /** context button; pos null = no world marker (on-foot contexts) */
  interact: { label: string; kind: string; pos: number[] | null } | null;
  /** overrides the idle Cast button (e.g. "Ashore" when stepping off the boat is offered) */
  action?: string | null;
  errand: { name: string; pos: number[] } | null;
  throttle: number;
  inShot: boolean;
}
interface InputLike { joyZone: number; mirrored: boolean }

// ------------------------------------------------------------------ state
let input: InputLike | null = null;
let ring: TensionRing;
let lastStrain = 0;
let lastTensionState: TensionState = 'calm';
let compassUntil = 0;
let lastDestKey = '';
let offCourse = false;
let trackT = 0;
let errandT = 0;
let paddleSince = 0;
let lastPhase = 'idle';
let ringShownAt = 0;
let lastInteractKey = '';
const peekUntil: Record<string, number> = {};
const v3 = new THREE.Vector3();

// ------------------------------------------------------------------ init
export function init(opts: { save: NonNullable<typeof ctx.save>; input: InputLike; handlers: UIHandlers }) {
  ctx.save = opts.save;
  ctx.h = opts.handlers;
  input = opts.input;
  hydrateIcons();
  initLoading();
  ring = new TensionRing($('tension'));
  buildCard();
  buildMarket();
  buildLog();
  setApplyPrefs(applyPrefs);
  hints.init();
  initPause();
  window.addEventListener('ui:modal', endTitle);

  $('btn-log').addEventListener('click', () => { openLog(); });
  $('shells').addEventListener('click', () => { openLog('errands'); });
  $('cooler-tab').addEventListener('click', () => { openLog('fish', { filter: 'cooler' }); });
  // tapping the top strip brings quiet-mode readouts back
  document.querySelector('.hud-top')!.addEventListener('pointerdown', () => peek('shells'));
  window.addEventListener('keydown', (e) => {
    if (e.repeat || ctx.pausedSlip || e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (ctx.modal === 'log') closeLog();
      else if (!ctx.modal) openLog();
    } else if (k === 'l' || k === 'tab') {
      e.preventDefault();
      if (ctx.modal === 'log') closeLog(); else if (!ctx.modal) openLog();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b && !b.closest('.hud-controls')) fx('tap');
  }, { capture: true });

  chart.onVisit = (p) => {
    fx('discover');
    if (p.kind === 'town' || p.kind === 'island') {
      titleCard(p.name, p.key === 'cedar_landing' ? 'where Gran kept her boat' : p.key === 'keepers_cove' ? "the keeper's cottage, and Gran's canoe" : 'a new shore for the logbook');
      setTimeout(() => toast(`${p.name} — added to the chart`, 'log'), 3900);
    } else toast(`${p.name} — added to the chart`, 'log');
  };

  if (log.pinned) { const e = ERRANDS.find((x) => x.id === log.pinned); if (e && !e.done()) pinChip(e.text); }
  newlyDone(); // anything already done at load doesn't re-celebrate
  updateBadges();

  window.addEventListener('resize', applyLayout);
  window.visualViewport?.addEventListener('resize', applyLayout);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyPrefs);
  applyPrefs();
  // first errand chip once play starts
  setTimeout(() => { const e = openErrands()[0]; if (e && !log.pinned) chip(e.text); }, 2500);
}

export function setWorld(w: LoadedWorld, chartSrc: ChartSource, info: string) {
  ctx.world = w;
  ctx.chart = chartSrc;
  ctx.worldInfo = info;
  chart.setWorld(w);
  refreshLog();
}

/** Apply UI preferences: text size, reduce motion, left-handed mirror. */
export function applyPrefs() {
  document.documentElement.style.setProperty('--ui-scale', String(prefs.textScale));
  const rm = prefs.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('reduce-motion', rm);
  document.body.classList.toggle('lefty', prefs.leftHanded);
  document.body.classList.toggle('debug', debugMode);
  document.body.classList.toggle('tension-hc', prefs.tensionHC);
  applyLayout();
}

function applyLayout() {
  const w = window.innerWidth, hh = window.innerHeight;
  const lay: Layout = w > hh ? (hh <= 500 ? 'landscape' : 'desktop') : 'portrait';
  ctx.layout = lay;
  const b = document.body.classList;
  b.toggle('lay-portrait', lay === 'portrait');
  b.toggle('lay-landscape', lay === 'landscape');
  b.toggle('lay-desktop', lay === 'desktop');
  if (input) {
    input.joyZone = lay === 'portrait' ? 0.55 : 0.4;
    input.mirrored = prefs.leftHanded;
  }
}

/** Game simulation pauses while the Log or the implicit-pause slip is up. */
export const paused = () => ctx.modal === 'log' || ctx.pausedSlip;
export const modalOpen = () => !!ctx.modal;

// ------------------------------------------------------------------ toasts (one lane, max 2, queued)
const TOAST_ICON: Record<string, string> = { good: 'check', warn: 'warn', log: 'pencil' };
type Kind = 'info' | 'good' | 'warn' | 'log';
const queue: { msg: string; kind: Kind; ms: number; at: number }[] = [];

const toastSuppressed = () => ctx.fishing || ctx.modal === 'card' || ctx.modal === 'dialogue' || ctx.title;

export function toast(msg: string, kind: Kind = 'info', ms = 2600) {
  // From Cast to Land the lane is closed; short fishing feedback speaks from the bobber instead.
  if (ctx.fishing && ctx.camera && ctx.fishPhase !== 'landed') {
    bubble(msg, () => bobberPos.clone(), { ms: 1800, cls: kind, key: 'fish-say', lift: 1.6 });
    return;
  }
  if (toastSuppressed()) { queue.push({ msg, kind, ms, at: performance.now() }); return; }
  showToast(msg, kind, ms);
}

function showToast(msg: string, kind: Kind, ms: number) {
  const box = $('toasts');
  for (const el of Array.from(box.children) as HTMLElement[]) if (el.dataset.msg === msg) el.remove();
  const el = h('div', `toast ${kind}`);
  el.dataset.msg = msg;
  const ico = TOAST_ICON[kind];
  el.innerHTML = `${ico ? `<span class="ico">${ICONS[ico]}</span>` : ''}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  while (box.children.length > 2) box.firstElementChild!.remove();
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

function flushToasts() {
  if (!queue.length || toastSuppressed()) return;
  const now = performance.now();
  while (queue.length) {
    const t = queue.shift()!;
    if (now - t.at <= T.toastMaxAge) { showToast(t.msg, t.kind, t.ms); break; }
  }
}

// ------------------------------------------------------------------ HUD visibility (hidden / peek / pinned)
function peek(...ids: string[]) {
  const until = performance.now() + T.peek;
  for (const id of ids) peekUntil[id] = until;
  paddleSince = performance.now();
}

function updateVisibility(s: FrameState, dt: number) {
  const now = performance.now();
  const b = document.body.classList;
  // focus mode: top strip hidden from Cast to Land
  b.toggle('hud-focus', s.fishing.active);
  // quiet mode: Shells + cooler fade after 6 s of uninterrupted paddling
  const paddling = Math.abs(s.throttle) > 0.3 && Math.abs(s.boat.speed) > 0.4;
  if (!paddling || s.interact || ctx.modal) paddleSince = now;
  b.toggle('hud-quiet', now - paddleSince > T.quiet);
  const full = !!ctx.save && ctx.save.cooler.length >= ctx.save.coolerCap;
  $('shells').classList.toggle('peek', (peekUntil.shells ?? 0) > now || marketOpen());
  // the cooler isn't persistent: it peeks when a fish goes in or out and at the market; the full
  // inventory lives in the Log (Fish → Cooler). When full, the reel button already says so.
  $('cooler-tab').classList.toggle('peek', (peekUntil.cooler ?? 0) > now || marketOpen());
  $('btn-log').classList.toggle('cooler-full', full);
  void dt;
}

// ------------------------------------------------------------------ Shells odometer
let shellsShown = -1;
export function setShells(n: number) {
  const el = $('shell-count');
  const str = String(Math.max(0, Math.floor(n)));
  const col = (d: string) => `<span class="dg"><span class="col" style="--d:${d}">${'0123456789'.split('').map((x) => `<i>${x}</i>`).join('')}</span></span>`;
  const animate = shellsShown >= 0 && !reduceMotion() && n !== shellsShown;
  if (!animate || el.childElementCount !== str.length) {
    const prev = animate ? String(shellsShown).padStart(str.length, '0').slice(-str.length) : str;
    el.innerHTML = prev.split('').map(col).join('');
  }
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll<HTMLElement>('.col').forEach((c, i) => c.style.setProperty('--d', str[i]));
    }));
    const tab = $('shells');
    tab.classList.remove('bump'); void tab.offsetWidth; tab.classList.add('bump');
  }
  if (shellsShown >= 0 && n !== shellsShown) peek('shells');
  $('shells').setAttribute('aria-label', `${str} Shells — open the Log`);
  shellsShown = n;
  refreshLog();
}

// ------------------------------------------------------------------ cooler strip
let coolerCount = -1;
export function renderCooler(cooler: CaughtFish[], cap: number, pulse = false) {
  const el = $('cooler');
  el.innerHTML = '';
  for (let i = 0; i < cap; i++) {
    const f = cooler[i];
    const s = h('div', `slot${f ? ' full' : ''}`);
    if (f) {
      s.innerHTML = `${fishGlyph(f.speciesId, f.color)}<b class="notch">${rarityNotch(f.rarity)}</b>`;
      s.title = f.name;
    }
    if (pulse && ((cooler.length > coolerCount && i === cooler.length - 1) || (cooler.length < coolerCount && i >= cooler.length && i < coolerCount))) s.classList.add('hop');
    el.appendChild(s);
  }
  if (coolerCount >= 0 && cooler.length !== coolerCount) peek('cooler');
  coolerCount = cooler.length;
  $('cooler-tab').classList.toggle('full', cooler.length >= cap);
  $('cooler-tab').setAttribute('aria-label', `Cooler: ${cooler.length} of ${cap}${cooler.length >= cap ? ', full' : ''}`);
}

// ------------------------------------------------------------------ clock / weather
const TOD_INFO: Record<string, { icon: string; time: string; words: string }> = {
  overcast: { icon: 'cloud', time: '10:40', words: 'Grey and still' },
  sunbreak: { icon: 'sunbreak', time: '13:20', words: 'Sun breaking through' },
  dusk: { icon: 'dusk', time: '19:50', words: 'Dusk coming on' },
  fog: { icon: 'fog', time: '06:40', words: 'Fog rolling in' },
  night: { icon: 'moon', time: '23:10', words: 'A clear night' },
};
const todInfo = (k: string) => TOD_INFO[k] ?? { icon: 'cloud', time: '12:00', words: k };
let clockPop = 0;
export function setTOD(key: string, time?: string, words?: string) {
  const changed = ctx.tod !== key;
  const ticked = changed || ctx.clock !== time;
  ctx.tod = key;
  const t = { ...todInfo(key) };
  if (time) t.time = time;
  if (words) t.words = words;
  ctx.clock = t.time; ctx.clockWords = t.words;
  $('clock-ico').innerHTML = ICONS[t.icon];
  $('clock-time').textContent = t.time;
  $('clock').title = t.words;
  $('clock').setAttribute('aria-label', `${t.time}, ${t.words}`);
  document.body.dataset.tod = key;
  if (changed) {
    $('clock').dataset.words = t.words;
    $('clock').classList.add('pop');
    clearTimeout(clockPop);
    clockPop = window.setTimeout(() => $('clock').classList.remove('pop'), T.peek);
  }
  if (ticked) refreshLog();
}

// ------------------------------------------------------------------ fishing cues
const bobberPos = new THREE.Vector3();
export function onBite() {
  fx('bite');
  const s = $('strike');
  s.classList.remove('hidden', 'go'); void s.offsetWidth; s.classList.add('go');
  hints.event('bite');
}
export function onNibble() {
  fx('nibble');
  if (ctx.camera) bubble('', () => bobberPos.clone(), { ms: 300, cls: 'plip', lift: 0.05, key: 'plip' });
}
export function onSlip() { fx('slip'); }
/** Action pressed when it can't do anything: shake (the label already says why). */
export function refuse() {
  fx('refuse');
  const b = $('btn-action');
  b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
}

// ------------------------------------------------------------------ distance words
export function distanceWords(m: number) {
  if (prefs.units === 'metres') return `${Math.round(m)} m`;
  if (prefs.units === 'fathoms') return `${Math.round(m / 1.8288)} fathoms`;
  if (m < 60) return 'just here';
  if (m < 200) return 'a short paddle';
  if (m < 450) return 'a fair paddle';
  return 'a long paddle';
}

function project(p: THREE.Vector3, cam: THREE.Camera) {
  v3.copy(p).project(cam);
  const on = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
  return { x: (v3.x * 0.5 + 0.5) * window.innerWidth, y: (-v3.y * 0.5 + 0.5) * window.innerHeight, on };
}

const twoWords = (s: string) => s.split(/\s+/).slice(0, 2).join(' ');

// ------------------------------------------------------------------ per-frame
export function frame(dt: number, s: FrameState) {
  const f = s.fishing;
  ctx.camera = s.camera;
  ctx.fishing = f.active;
  ctx.fishPhase = f.phase;
  ctx.boat.x = s.boat.pos.x; ctx.boat.z = s.boat.pos.z; ctx.boat.yaw = s.boat.yaw;
  bobberPos.copy(f.bobber.position);
  document.body.classList.toggle('fishing', f.active);

  // ---- reel / cast button (desktop: a keycap label)
  const btn = $('btn-action'), lbl = $('action-label');
  let label = 'Cast', mode = 'cast', enabled = true;
  switch (f.phase) {
    case 'idle':
      if (s.action) { label = s.action; mode = 'ashore'; }
      else if (!s.canCast) { label = 'Find ripples'; enabled = false; }
      else if (s.coolerFull) { label = 'Cooler full'; enabled = false; }
      else if (!s.slowEnough) { label = 'Slow down'; enabled = false; }
      break;
    case 'casting': case 'waiting': case 'missed': label = 'Wait…'; mode = 'wait'; break;
    case 'bite': label = 'Strike!'; mode = 'strike'; break;
    case 'reeling': label = f.autoReel ? 'Auto' : 'Reel'; mode = 'reel'; break;
    case 'landed': label = 'Landing'; mode = 'landing'; break;
  }
  if (lbl.textContent !== label) lbl.textContent = label;
  btn.dataset.mode = mode;
  btn.classList.toggle('off', !enabled);
  btn.classList.toggle('held', f.phase === 'reeling' && f.reelHeld);
  btn.setAttribute('aria-label', label);

  // ---- context button: the label IS the prompt; spatial marker over the target
  const ib = $('btn-interact');
  if (s.interact && !s.inShot) {
    const text = s.interact.kind === 'sell_fish' ? 'Sell fish' : twoWords(s.interact.label);
    const il = $('interact-label');
    if (il.textContent !== text) il.textContent = text;
    const ico = iconForKind(s.interact.kind);
    const ie = $('interact-ico');
    if (ie.dataset.icon !== ico) { ie.dataset.icon = ico; ie.innerHTML = ICONS[ico]; }
    ib.classList.remove('hidden');
    ib.setAttribute('aria-label', text);
    const ip = s.interact.pos;
    const p = ip ? project(v3.set(ip[0], ip[1] + 3.2, ip[2]), s.camera) : null;
    const mk = $('target-marker');
    mk.classList.toggle('hidden', !p?.on);
    if (p?.on) mk.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    // entering a dock zone: readouts peek; the vendor barks once per visit
    const key = `${s.interact.kind}@${ip ? ip.join(',') : s.interact.label}`;
    if (key !== lastInteractKey) {
      lastInteractKey = key;
      if (s.interact.kind === 'sell_fish') peek('shells', 'cooler'); else peek('shells');
      if (s.interact.kind === 'sell_fish' && ip) bubble('Fresh off the water?', new THREE.Vector3(ip[0], ip[1], ip[2]), { speaker: 'Mae', ms: 3000, cls: 'bark', key: 'bark', lift: 2.6 });
    }
  } else {
    ib.classList.add('hidden');
    $('target-marker').classList.add('hidden');
    lastInteractKey = '';
  }
  // the market sheet closes when you paddle out of the dock zone
  if (marketOpen() && marketPos && Math.hypot(marketPos[0] - s.boat.pos.x, marketPos[2] - s.boat.pos.z) > 22) ctx.h?.closeSell();

  // ---- Strike! label anchored over the bobber
  const st = $('strike');
  if (f.phase === 'bite') {
    const p = project(v3.copy(f.bobber.position).setY(f.bobber.position.y + 1.4), s.camera);
    st.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    st.classList.remove('hidden');
  } else st.classList.add('hidden');

  // ---- tension ring (enters 200 ms after Strike; collapses on landing)
  const ringEl = $('tension');
  if (f.phase === 'reeling') {
    if (lastPhase !== 'reeling') { ringShownAt = performance.now(); ringEl.classList.remove('collapse'); }
    const W = window.innerWidth, H = window.innerHeight;
    const lefty = prefs.leftHanded;
    const safeR = 16, castW = 88, gap = 34, R = 66;
    if (ctx.layout === 'portrait') ring.place(W / 2, H * 0.68);
    else if (ctx.layout === 'landscape') {
      // right third, LEFT of the Cast button, vertically centred — never under the thumb
      const x = W - safeR - castW - gap - R;
      ring.place(lefty ? W - x : x, H * 0.48);
    } else ring.place(W * (lefty ? 0.33 : 0.67), H * 0.56);
    ring.show(performance.now() - ringShownAt > 200 || reduceMotion());
    const ts = ring.update({
      tension: f.tension, maxTension: f.maxTension, slips: f.slips, distance: f.distance,
      thrashing: f.thrashing, held: f.reelHeld, pull: f.pull ?? 1, auto: f.autoReel,
    });
    const now = performance.now();
    if (ts !== 'calm' && f.reelHeld && now - lastStrain > 250) { lastStrain = now; fx('strain', f.tension); }
    if (ts !== 'calm' && lastTensionState === 'calm') hints.event('strain');
    lastTensionState = ts;
  } else {
    if (lastPhase === 'reeling' && !reduceMotion()) {
      ringEl.classList.add('collapse');
      setTimeout(() => { if (ctx.fishPhase !== 'reeling') ring.show(false); }, 160);
    } else if (lastPhase !== 'reeling') ring.show(false);
    lastTensionState = 'calm';
  }
  lastPhase = f.phase;

  updateCompass(s);
  updateVisibility(s, dt);
  updateBubbles();
  flushToasts();

  trackT += dt;
  if (trackT > 0.4) { trackT = 0; chart.track(s.boat.pos.x, s.boat.pos.z); }
  errandT += dt;
  if (errandT > 1) { errandT = 0; checkErrands(); }
  if (s.boat.moored) noteMoored();

  hints.update(s);
}

function updateCompass(s: FrameState) {
  const comp = $('compass');
  const dest = chart.destination();
  const target = dest ?? (s.errand ? { key: 'errand:' + s.errand.name, name: s.errand.name, x: s.errand.pos[0], z: s.errand.pos[2] } : null);
  if (!target || s.inShot) { comp.classList.add('hidden'); return; }
  const dx = target.x - s.boat.pos.x, dz = target.z - s.boat.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dest && dist < 40) {
    chart.clearDestination();
    toast(`Arrived at ${dest.name}`, 'log');
    comp.classList.add('hidden');
    return;
  }
  s.camera.getWorldDirection(v3);
  const fl = Math.hypot(v3.x, v3.z) || 1;
  const fx_ = v3.x / fl, fz = v3.z / fl;
  const rel = Math.atan2(dx * -fz + dz * fx_, dx * fx_ + dz * fz);
  const now = performance.now();
  if (target.key !== lastDestKey) { lastDestKey = target.key; compassUntil = now + 4000; }
  const off = Math.abs(rel) > Math.PI / 3;
  if (off && !offCourse) compassUntil = now + 4000;
  offCourse = off;
  const show = (!!dest && off) || now < compassUntil;
  comp.classList.toggle('hidden', !show);
  if (!show) return;
  $('compass-arrow').style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
  const txt = `${target.name} · ${distanceWords(dist)}`;
  const l = $('compass-label');
  if (l.textContent !== txt) l.textContent = txt;
}

// ------------------------------------------------------------------ errands + stamps
function updateBadges() {
  setLogBadge(openErrands().length);
  const n = stamps().length;
  const sc = $('log-stamps');
  sc.textContent = String(n);
  sc.classList.toggle('hidden', n === 0);
}

function checkErrands() {
  const fresh = newlyDone();
  if (!fresh.length) return;
  for (const e of fresh) {
    if (log.pinned === e.id) { log.pinned = null; saveLog(); pinChip(null); }
    chip(e.text, { done: true });
    setTimeout(() => fx('quest'), 500);
  }
  updateBadges();
  refreshLog();
  const next = openErrands()[0];
  if (next && !log.pinned) setTimeout(() => chip(next.text), 4600);
}

// ------------------------------------------------------------------ logbook hooks for main.ts
/** Record UI-side journal extras when a catch is logged. */
export function logCatch(f: CaughtFish, perfect: boolean) {
  if (!log.first[f.speciesId]) log.first[f.speciesId] = new Date().toISOString();
  if (perfect) log.perfect[f.speciesId] = true;
  saveLog();
  refreshLog();
}
export function noteMoored() { if (!log.tiedUp) { log.tiedUp = true; saveLog(); } }
export function noteKept() { hints.event('kept'); }

/** A sunstone was read: Gran's page goes into the logbook (dialogue first). */
export async function readSunstone(n: number, poi: string) {
  if (!Number.isFinite(n)) return;
  if (log.pages.includes(n)) { toast(`Page ${n} is already in the logbook`, 'log'); return; }
  await dialogue([{ who: 'Gran', text: `Tucked under the ${poi.replace(/^Sunstone_/, '').replace(/([a-z])([A-Z])/g, '$1 $2')} stone, a page in my hand. Take it — it's yours now.` }]);
  log.pages.push(n);
  log.pages.sort((a, b) => a - b);
  saveLog();
  fx('quest');
  toast(`Gran's page ${n} — added to the logbook`, 'log', 3200);
  refreshLog();
}

/** Read-only text interacts (message bottles, warnings, rumours) use the dialogue strip. */
export function readNote(who: string, text: string) { return dialogue([{ who, text }]); }

export function setWorldInfo(info: string) { ctx.worldInfo = info; refreshLog(); }

/** Debug/test helpers for screenshot scripts (window.__debug.ui). */
export const debug = {
  openLog: (tab?: string, opts?: object) => openLog(tab as never, opts as never),
  closeLog,
  toast: (m: string, k?: Kind) => showToast(m, k ?? 'info', 4000),
  hint: (id: string) => hints.force(id),
  clearHints: () => hints.clear(),
  revealAll: () => chart.revealAll(),
  visitAll: () => { for (const p of chart.places) if (!log.places.includes(p.key)) log.places.push(p.key); saveLog(); },
  /** map captures: bounds/places, partial reveal around a point, view state, destination */
  map: chartDebug,
  title: (t: string, s: string) => titleCard(t, s),
  dialogue: (who: string, text: string) => dialogue([{ who, text, choices: [{ label: 'Sure', value: 'y' }, { label: 'Not today', value: 'n' }] }]),
  dive: () => { const d = new DiveHUD(); d.show(true); d.update({ breath: 0.55, cold: 0.12, over: 0.08, need: 0.3, depth: 9, limit: 8, max: 12 }); return d; },
  layout: () => ctx.layout,
  hideSell,
  openMarket: () => openMarketSheet(ctx.save!.cooler, (i) => ctx.h?.sellOne(i)),
  quiet: () => { paddleSince = -1e9; },
  lefty: (on: boolean) => { prefs.leftHanded = on; applyPrefs(); },
  chip: (t: string, done = false) => chip(t, { done }),
  /** show the catch result for a species without fishing (tier A slip unless stamp/rare) */
  catchDemo: (id = 'staghorn_sculpin', stamp: 'NEW!' | 'RECORD!' | null = null) => {
    const sp = SPECIES.find((x) => x.id === id) ?? SPECIES[0];
    const size = Math.round(((sp.size[0] + sp.size[1]) / 2) * 10) / 10;
    presentCatch({ speciesId: sp.id, name: sp.name, size, stars: 2, price: sp.price, color: sp.color, rarity: sp.rarity, releaseOnly: sp.releaseOnly }, sp, stamp, false, true);
  },
};

export type { CaughtFish, Species };
