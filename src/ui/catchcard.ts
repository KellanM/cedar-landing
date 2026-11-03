/**
 * Catch result, two tiers (ui_layouts_indie §3.2, ui_design §4.3):
 *  t0       fish landed → `ui:fishlanded` event + optional hold-up hook (3D skipper animation)
 *  t0+0.3s  world bubble over the boat: "Staghorn Sculpin! 26.7 cm"
 *  Tier A   t0+0.6s  CatchSlip above the verbs (repeat species): Let go / Keep, auto-Keep after 3 s
 *  Tier B   t0+0.9s  SpecimenCard (new species, record, rare+): stamp lands card+250 ms
 * Both ignore taps for 400 ms after appearing (input guard).
 */
import * as THREE from 'three';
import { $, ctx, esc, h, setModal, guard, guarded, T, reduceMotion } from './ctx';
import { fx } from './fx';
import { ICONS } from './icons';
import { fishSketch, fishGlyph, starsSvg } from './fishart';
import { bubble, killBubble } from './bubble';
import { log } from './prefs';
import type { CaughtFish, Species } from '../game/fishdata';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const RARITY_WORD: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
const shell = () => `<span class="ico">${ICONS.shell}</span>`;

/**
 * Hook for the fishing-feel build: resolve when the skipper's hold-up animation reaches the
 * "show it off" beat. The bubble/slip/card timings are measured from that moment (t0).
 * Also observable as `window.addEventListener('ui:fishlanded', e => e.detail)`.
 */
export const catchHooks = {
  holdUp: (_fish: CaughtFish): Promise<void> | void => undefined,
  /** world point just above the held fish (the catch bubble sits there instead of over the boat) */
  bubbleAt: (): THREE.Vector3 | null => null,
};

// ------------------------------------------------------------------ SpecimenCard (generic)
export interface SpecimenOpts {
  title: string;
  sketch: string;
  stamp?: string | null;
  date?: string;
  /** ruler / stats slot */
  slot?: string;
  meta?: string;
  note?: string;
  extra?: string;
  isNew?: boolean;
  /** more stamps after the first (RECORD / PERFECT), thumped in one after another */
  stamps?: string[];
  primary: { html: string; disabled?: boolean; onClick: () => void };
  secondary?: { html: string; onClick: () => void };
  hint?: string;
}

export function buildCard() {
  const el = h('div', 'card-wrap hidden');
  el.id = 'card';
  el.innerHTML = `
  <article class="specimen paper deckle" role="dialog" aria-modal="true" aria-labelledby="card-name">
    <div class="fold" aria-hidden="true"></div>
    <div class="stamp" id="card-stamp">NEW</div>
    <div class="stamps" id="card-stamps"></div>
    <div class="datestamp num" id="card-date"></div>
    <div class="sketch" id="card-art"></div>
    <div class="slot" id="card-slot"></div>
    <h2 id="card-name"></h2>
    <div class="meta" id="card-meta"></div>
    <p class="note" id="card-flavor"></p>
    <div id="card-extra"></div>
    <p class="added" id="card-added"><span>Added to Logbook</span></p>
    <p class="hint-line" id="card-hint"></p>
    <div class="buttons">
      <button id="card-release" class="btn ghost"></button>
      <button id="card-keep" class="btn primary"></button>
    </div>
  </article>`;
  document.body.appendChild(el);
  // tapping the card skips the stamp + ruler animation to its end state
  el.querySelector('.specimen')!.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    el.classList.add('skip');
  });
  buildSlip();
}

let cardPrimary: (() => void) | null = null;
let cardSecondary: (() => void) | null = null;

export function showSpecimen(o: SpecimenOpts) {
  const root = $('card');
  $('card-art').innerHTML = o.sketch;
  $('card-name').textContent = o.title;
  $('card-slot').innerHTML = o.slot ?? '';
  $('card-meta').innerHTML = o.meta ?? '';
  $('card-flavor').textContent = o.note ?? '';
  $('card-flavor').classList.toggle('hidden', !o.note);
  $('card-extra').innerHTML = o.extra ?? '';
  $('card-date').textContent = o.date ?? '';
  root.classList.toggle('is-new', !!o.isNew);
  $('card-added').classList.toggle('hidden', !o.isNew);
  const st = $('card-stamp');
  st.classList.toggle('hidden', !o.stamp);
  if (o.stamp) st.textContent = o.stamp;
  const keep = $<HTMLButtonElement>('card-keep');
  keep.innerHTML = o.primary.html;
  keep.disabled = !!o.primary.disabled;
  cardPrimary = o.primary.onClick;
  const rel = $<HTMLButtonElement>('card-release');
  rel.classList.toggle('hidden', !o.secondary);
  if (o.secondary) rel.innerHTML = o.secondary.html;
  cardSecondary = o.secondary?.onClick ?? null;
  const hint = $('card-hint');
  hint.textContent = o.hint ?? '';
  hint.classList.toggle('hidden', !o.hint);

  root.classList.remove('hidden', 'in', 'skip');
  void root.offsetWidth;
  root.classList.add('in');
  guard(root);
  setModal('card');
  fx('catch');
  if (o.stamp) setTimeout(() => { if (ctx.modal === 'card') fx('stamp'); }, reduceMotion() ? 0 : 250);
  // extra stamps: each thumps in 230 ms after the last (a drumroll of ink, not a pile-up)
  const more = (o.stamps ?? []).filter((x) => x && x !== o.stamp);
  $('card-stamps').innerHTML = more.map((x, i) => `<div class="stamp more s${i}" style="--d:${(o.stamp ? 480 : 250) + i * 230}ms">${x}</div>`).join('');
  more.forEach((_, i) => setTimeout(() => { if (ctx.modal === 'card') fx('stamp'); }, reduceMotion() ? 0 : (o.stamp ? 480 : 250) + i * 230));
}

function wireCardButtons() {
  const root = $('card');
  $('card-keep').onclick = () => { if (!guarded(root)) cardPrimary?.(); };
  $('card-release').onclick = () => { if (!guarded(root)) cardSecondary?.(); };
}

// ------------------------------------------------------------------ full cooler: swap (hud_flow_study P3)
/** The fish a full cooler would give back for a new one: the cheapest, then the smallest. */
export function swapCandidate(): { i: number; fish: CaughtFish } | null {
  const c = ctx.save?.cooler ?? [];
  let bi = -1;
  c.forEach((f, i) => { if (bi < 0 || f.price < c[bi].price || (f.price === c[bi].price && f.size < c[bi].size)) bi = i; });
  return bi >= 0 ? { i: bi, fish: c[bi] } : null;
}

// ------------------------------------------------------------------ CatchSlip (tier A)
let slipTimer = 0;
let slipActive = false;
let slipOutside: ((e: PointerEvent) => void) | null = null;

function buildSlip() {
  const el = h('div', 'catch-slip hidden');
  el.id = 'catch-slip';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="glyph" id="slip-art"></span>
    <span class="who"><b id="slip-name"></b><span class="sub" id="slip-sub"></span></span>
    <button class="chip-btn ghost" id="slip-release">Let go</button>
    <button class="chip-btn primary" id="slip-keep"></button>
    <i class="auto" aria-hidden="true"></i>`;
  document.getElementById('hud')!.appendChild(el);
}

function showSlip(fish: CaughtFish, coolerFull: boolean) {
  const el = $('catch-slip');
  $('slip-art').innerHTML = fishSketch(fish.speciesId, fish.color, fish.rarity);
  $('slip-name').textContent = fish.name;
  $('slip-sub').innerHTML = `${starsSvg(fish.stars, 3, 13)}<span class="num">${fish.size.toFixed(1)} cm</span>`;
  const keep = $<HTMLButtonElement>('slip-keep');
  const canKeep = !coolerFull && !fish.releaseOnly;
  // full cooler: no auto-keep; offer the swap for the cheapest fish aboard (P3)
  const sw = coolerFull && !fish.releaseOnly ? swapCandidate() : null;
  keep.disabled = !canKeep && !sw;
  keep.innerHTML = fish.releaseOnly ? 'Release only' : sw ? `<span class="ico">${ICONS.cooler}</span>Swap` : `Keep ${shell()}<b class="num">${fish.price}</b>`;
  if (sw) $('slip-sub').innerHTML = `<span class="swap-for">Cooler full · swap for your ${esc(sw.fish.name)} ${sw.fish.size.toFixed(1)} cm?</span>`;
  el.classList.toggle('swap', !!sw);
  el.classList.toggle('auto-on', canKeep && !reduceMotion());
  el.classList.toggle('auto-on-rm', canKeep && reduceMotion());
  el.classList.remove('hidden', 'in'); void el.offsetWidth; el.classList.add('in');
  guard(el);
  slipActive = true;
  fx('catch');
  const doKeep = () => { if (slipActive && !guarded(el)) { if (sw) ctx.h?.swap(sw.i); else ctx.h?.keep(); } };
  const doRelease = () => { if (slipActive && !guarded(el)) ctx.h?.release(); };
  keep.onclick = doKeep;
  $('slip-release').onclick = doRelease;
  clearTimeout(slipTimer);
  if (canKeep) slipTimer = window.setTimeout(() => { if (slipActive) ctx.h?.keep(); }, T.slipAuto);
  // tap anywhere outside the slip = Keep (only when there's room)
  slipOutside = (e: PointerEvent) => {
    if (!slipActive || el.contains(e.target as Node) || guarded(el)) return;
    if (canKeep) ctx.h?.keep();
  };
  window.addEventListener('pointerdown', slipOutside, { capture: true });
}

function hideSlip() {
  slipActive = false;
  clearTimeout(slipTimer);
  if (slipOutside) window.removeEventListener('pointerdown', slipOutside, { capture: true });
  slipOutside = null;
  $('catch-slip').classList.add('hidden');
}

// ------------------------------------------------------------------ catch flow (main.ts entry)
let seq = 0;
const timers: number[] = [];

export interface CatchShowOpts {
  /** the victory sequence (src/game/catchshow.ts) already did the hold-up, bubble and line: show the result now */
  direct?: boolean;
  /** 'slip' (repeat commons) or 'card' */
  mode?: 'slip' | 'card';
  /** extra stamps that thump in one after another (RECORD / PERFECT) */
  stamps?: string[];
}

export function showCard(fish: CaughtFish, sp: Species, stamp: 'NEW!' | 'RECORD!' | null, coolerFull: boolean, perfect: boolean, o: CatchShowOpts = {}) {
  wireCardButtons();
  const my = ++seq;
  timers.splice(0).forEach(clearTimeout);
  window.dispatchEvent(new CustomEvent('ui:fishlanded', { detail: { fish, species: sp, stamp, perfect } }));
  const tierB = o.mode ? o.mode === 'card' : !!stamp || fish.rarity === 'rare' || fish.rarity === 'legendary';
  if (o.direct) {
    if (tierB) showCatchCard(fish, sp, stamp, coolerFull, perfect, o.stamps ?? []);
    else showSlip(fish, coolerFull);
    return;
  }
  Promise.resolve(catchHooks.holdUp(fish)).then(() => {
    if (my !== seq) return;
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(() => { if (my === seq) f(); }, reduceMotion() ? Math.min(ms, 150) : ms));
    const boatAnchor = () => new THREE.Vector3(ctx.boat.x, 0.6, ctx.boat.z);
    const held = catchHooks.bubbleAt();
    at(300, () => bubble(`${fish.name}! ${fish.size.toFixed(1)} cm`, held ? () => catchHooks.bubbleAt() ?? boatAnchor() : boatAnchor, { lift: held ? 0 : undefined, ms: tierB ? 1800 : 3200, cls: 'catch', key: 'catch', pre: fishGlyph(fish.speciesId) }));
    if (!tierB) { at(600, () => showSlip(fish, coolerFull)); return; }
    at(900, () => { killBubble('catch'); showCatchCard(fish, sp, stamp, coolerFull, perfect, []); });
  });
}

/** World bubble over the held fish: "Pile Perch! 27.5 cm" (the quick tier's whole line). */
export function catchBubble(fish: CaughtFish, ms = 3200) {
  const boatAnchor = () => new THREE.Vector3(ctx.boat.x, 0.6, ctx.boat.z);
  const held = catchHooks.bubbleAt();
  bubble(`${fish.name}! ${fish.size.toFixed(1)} cm`, held ? () => catchHooks.bubbleAt() ?? boatAnchor() : boatAnchor, { lift: held ? 0 : undefined, ms, cls: 'catch', key: 'catch', pre: fishGlyph(fish.speciesId) });
}
export const killCatchBubble = () => killBubble('catch');

function showCatchCard(fish: CaughtFish, sp: Species, stamp: 'NEW!' | 'RECORD!' | null, coolerFull: boolean, perfect: boolean, extra: string[]) {
  const now = new Date();
  const k = Math.min(1, Math.max(0, (fish.size - sp.size[0]) / Math.max(1, sp.size[1] - sp.size[0])));
  const isNew = stamp === 'NEW!' && !log.first[fish.speciesId];
  let primary: SpecimenOpts['primary'];
  let hint = '';
  if (fish.releaseOnly) { primary = { html: 'Release only', disabled: true, onClick: () => {} }; hint = 'Too precious to keep. Logged in your book.'; }
  else if (coolerFull) {
    // P3: the catch is logged either way; keep it by giving back the cheapest fish aboard
    const sw = swapCandidate();
    if (sw) { primary = { html: '<span>Swap it in</span>', onClick: () => ctx.h?.swap(sw.i) }; hint = `Cooler's full. Swap out your ${sw.fish.name} (${sw.fish.size.toFixed(1)} cm · ${sw.fish.price} Shells)?`; }
    else { primary = { html: `<span class="ico">${ICONS.cooler}</span><span>Cooler full</span>`, disabled: true, onClick: () => {} }; hint = 'Sell at the Fish Market in Cedar Landing'; }
  }
  else primary = { html: `<span>Keep</span>${shell()}<b class="num">${fish.price}</b>`, onClick: () => ctx.h?.keep() };
  showSpecimen({
    title: fish.name,
    sketch: fishSketch(fish.speciesId, fish.color, fish.rarity),
    stamp: stamp ? (stamp === 'NEW!' ? 'NEW' : 'RECORD') : fish.rarity === 'rare' || fish.rarity === 'legendary' ? 'RARE' : null,
    date: `${now.getDate()} ${MONTHS[now.getMonth()]}`,
    slot: `<div class="ruler" style="--k:${k.toFixed(3)}"><div class="rule"></div><div class="marker"><b class="num">${fish.size.toFixed(1)} cm</b></div><span class="lo num">${sp.size[0]}</span><span class="hi num">${sp.size[1]} cm</span></div>`,
    meta: `${starsSvg(fish.stars, 3, 20)}<span class="sep">·</span><span>${RARITY_WORD[fish.rarity] ?? fish.rarity}</span><span class="sep">·</span><span class="price">${shell()}<b class="num">${fish.price}</b></span>`,
    note: `“${sp.flavor}” — G.`,
    extra: perfect ? '<p class="pencil">✓ perfect reel</p>' : '',
    isNew,
    stamps: extra,
    primary,
    secondary: { html: 'Let go', onClick: () => ctx.h?.release() },
    hint,
  });
}

export function hideCard() {
  seq++;
  timers.splice(0).forEach(clearTimeout);
  hideSlip();
  $('card').classList.add('hidden');
  if (ctx.modal === 'card') setModal(null);
}
