/**
 * The Shipwright (upgrade_bench "Upgrade" / buy_boat "Inspect"): paint, flags and boats.
 *  - Paint: pick a part, tap a swatch → the REAL boat repaints instantly (Sea of Thieves chest /
 *    ACNH workbench preview). Nothing is charged until "Paint it"; leaving reverts the preview.
 *  - Flags: abstract motif flags, three in the locker from the start; hoisting is free.
 *  - Boats: builder's-plate cards; buying the Packer is a launch beat (title card + orbit).
 * The camera orbits the boat while this sheet is open (main.ts showcase).
 */
import './shop.css';
import { $, h, esc } from './ctx';
import { fx } from './fx';
import { ICONS } from './icons';
import { Sheet } from './sheet';
import { ensureUpg } from '../game/progression/gear';
import { BOAT_TIERS, TIER_ORDER, type BoatTierId } from '../game/progression/tiers';
import { FLAGS, PAINTABLE, PALETTE, applyPaint, drawFlag, factoryHex, isPaintable, setFlag, type PaintGroup } from '../game/progression/boatpaint';
import type { SaveData } from '../game/save';
import type * as THREE from 'three';
import type { Interact } from '../world/types';

export type SwTab = 'paint' | 'flag' | 'boats';
export const PAINT_PRICE = 20;

export interface ShipwrightHost {
  save: SaveData;
  commit(): void;
  toast(msg: string, kind?: 'info' | 'good' | 'warn' | 'log'): void;
  /** the boat model currently sailed (paintable mesh) */
  boatModel(): THREE.Object3D | null;
  /** switch to an owned tier (swaps the model, handling, hold) */
  setTier(id: BoatTierId): void;
  /** launch beat for a newly bought boat */
  launched(id: BoatTierId): void;
  /** framing hint for the showcase camera */
  focus(part: string): void;
}

const shellIco = `<span class="ico">${ICONS.shell}</span>`;
let sheet: Sheet | null = null;
let host: ShipwrightHost | null = null;
let tab: SwTab = 'paint';
let part: PaintGroup = 'hull';
/** unpaid preview: group -> hex ('' = back to factory) */
let pending: Record<string, string> = {};
export let swPos: number[] | null = null;

function build() {
  sheet = new Sheet({ id: 'shipwright', skin: 'logbook', modal: 'market', onClose: () => closeShipwright(), ariaLabel: 'Shipwright' });
  sheet.el.classList.add('upg-sheet', 'sw-compact');
  sheet.header.innerHTML = `
    <div class="upg-head">
      <span class="town">Cedar Landing</span>
      <h2>Shipwright</h2>
      <span class="purse" id="sw-purse"></span>
      <p class="quote">“She's a good boat. Let's make her yours.” <span>— Ada at the ways</span></p>
    </div>
    <nav class="upg-tabs" role="tablist" id="sw-tabs"></nav>`;
  sheet.body.innerHTML = `<div id="sw-body"></div>`;
  sheet.foot.innerHTML = `<span class="upg-foot-note" id="sw-note"></span><button class="btn ghost" id="sw-undo">Undo</button><button class="btn kelp" id="sw-paint"></button><button class="btn ghost done" id="sw-done">Done</button>`;
  // tabs live in the header, whose pointerdown starts the sheet drag: keep taps on the tabs
  $('sw-tabs').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('sw-done').addEventListener('click', () => closeShipwright());
  $('sw-undo').addEventListener('click', () => { pending = {}; preview(); render(); });
  $('sw-paint').addEventListener('click', () => commitPaint());
}

export const shipwrightOpen = () => sheet?.isOpen ?? false;
export const shipwrightTab = () => tab;

export function openShipwright(h0: ShipwrightHost, where: Interact | null, start: SwTab = 'paint') {
  host = h0;
  if (!sheet) build();
  tab = start;
  pending = {};
  swPos = where?.pos ?? null;
  render();
  sheet!.open();
  sheet!.setSnap(40); // keep the boat in view above the sheet (portrait)
  host.focus(tab === 'flag' ? 'flag' : tab === 'boats' ? 'boat' : part);
}

export function closeShipwright() {
  if (!sheet?.isOpen) return;
  if (Object.keys(pending).length) { pending = {}; preview(); host?.toast('Paint left in the pot', 'info'); }
  sheet.close();
  swPos = null;
}

function paintOf(): Record<string, string> {
  const u = ensureUpg(host!.save);
  return u.paint[u.boat] ?? {};
}
function preview() {
  if (!host) return;
  const merged: Record<string, string> = { ...paintOf() };
  for (const [g, hex] of Object.entries(pending)) { if (hex) merged[g] = hex; else delete merged[g]; }
  applyPaint(host.boatModel(), merged);
}

function render() {
  if (!sheet || !host) return;
  const save = host.save;
  const u = ensureUpg(save);
  $('sw-purse').innerHTML = `${shellIco}<span class="num">${save.shells}</span>`;
  const tabs = $('sw-tabs');
  tabs.innerHTML = '';
  for (const [t, label, ico] of [['paint', 'Paint', 'pencil'], ['flag', 'Flags', 'wave'], ['boats', 'Boats', 'boat']] as const) {
    const b = h('button', 'upg-tab', `<span class="ico">${ICONS[ico]}</span>${label}`) as HTMLButtonElement;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === tab));
    b.dataset.tab = t;
    b.onclick = () => {
      if (t !== 'paint' && Object.keys(pending).length) { pending = {}; preview(); }
      tab = t; fx('page'); render(); host?.focus(t === 'flag' ? 'flag' : t === 'boats' ? 'boat' : part);
    };
    tabs.appendChild(b);
  }
  const body = $('sw-body');
  const n = Object.keys(pending).length;
  const paintBtn = $<HTMLButtonElement>('sw-paint');
  const undo = $<HTMLButtonElement>('sw-undo');
  paintBtn.classList.toggle('hidden', tab !== 'paint');
  undo.classList.toggle('hidden', tab !== 'paint' || !n);
  $('sw-note').textContent = '';

  if (tab === 'paint') {
    const model = host.boatModel();
    if (!isPaintable(model)) {
      body.innerHTML = `<p class="sw-name">This boat's paint can't be changed yet.</p>`;
      paintBtn.classList.add('hidden');
      return;
    }
    const cur = { ...paintOf(), ...pending };
    body.innerHTML = `<div class="sw-parts" id="sw-parts"></div><div class="sw-name" id="sw-sel"></div><div class="sw-swatches" id="sw-swatches"></div>`;
    const parts = $('sw-parts');
    for (const p of PAINTABLE) {
      const hex = cur[p.id] || factoryHex(model, p.id);
      const b = h('button', `sw-part${p.id in pending ? ' pending' : ''}`, `<i style="background:${hex}"></i>${p.label}`) as HTMLButtonElement;
      b.setAttribute('aria-pressed', String(p.id === part));
      b.dataset.part = p.id;
      b.onclick = () => { part = p.id; fx('tap'); render(); host?.focus(part); };
      parts.appendChild(b);
    }
    const sw = $('sw-swatches');
    const chosen = cur[part] ?? '';
    const asBuilt = h('button', 'sw-sw asbuilt') as HTMLButtonElement;
    asBuilt.style.background = factoryHex(model, part);
    asBuilt.setAttribute('aria-label', 'As built');
    asBuilt.setAttribute('aria-pressed', String(!chosen));
    asBuilt.onclick = () => pick('');
    sw.appendChild(asBuilt);
    for (const c of PALETTE) {
      const b = h('button', 'sw-sw') as HTMLButtonElement;
      b.style.background = c.hex;
      b.title = c.name;
      b.dataset.hex = c.hex;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-pressed', String(chosen.toLowerCase() === c.hex.toLowerCase()));
      b.onclick = () => pick(c.hex);
      sw.appendChild(b);
    }
    const nm = PALETTE.find((c) => c.hex.toLowerCase() === chosen.toLowerCase())?.name ?? 'as built';
    $('sw-sel').textContent = `${PAINTABLE.find((p) => p.id === part)!.label}: ${nm}`;
    const cost = n * PAINT_PRICE;
    paintBtn.disabled = !n || save.shells < cost;
    paintBtn.innerHTML = n ? `<span>Paint it</span>${shellIco}<b class="num">${cost}</b>` : '<span>Pick a colour</span>';
    $('sw-note').textContent = n ? (save.shells < cost ? `${cost - save.shells} Shells short` : `${PAINT_PRICE} a part`) : 'Tap a colour to try it on.';
  } else if (tab === 'flag') {
    body.innerHTML = `<div class="sw-flags" id="sw-flaglist"></div>`;
    const list = $('sw-flaglist');
    for (const f of FLAGS) {
      const have = u.flags.includes(f.id);
      const on = u.flag === f.id;
      const card = h('button', `sw-flag${on ? ' on' : ''}`) as HTMLButtonElement;
      card.dataset.flag = f.id;
      card.innerHTML = `<canvas width="128" height="80"></canvas><b>${esc(f.name)}</b><span>${esc(f.note)}</span>${on ? '<span class="upg-stamp red">Flying</span>' : ''}${have ? '' : `<span class="ticket">${shellIco}<b class="num">${f.price}</b></span>`}`;
      drawFlag(card.querySelector('canvas')!.getContext('2d')!, f, 128, 80);
      card.disabled = !have && save.shells < f.price;
      card.onclick = () => chooseFlag(f.id);
      list.appendChild(card);
    }
    $('sw-note').textContent = 'Hoisting a flag you own is free.';
  } else {
    body.innerHTML = '';
    for (const id of TIER_ORDER) {
      const t = BOAT_TIERS[id];
      const have = u.boats.includes(id);
      const sailing = u.boat === id;
      const card = h('section', `sw-boat${have ? '' : ' later'}`);
      card.dataset.boat = id;
      card.innerHTML = `<h3>${esc(t.name.replace(/^the /, 'The '))}</h3><span class="bplate">${esc(t.plate)}</span><p>${esc(t.note)}</p>
        <ul>${t.opens.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
        ${sailing ? '<span class="upg-stamp red">Sailing</span>' : have ? '<span class="upg-stamp">Moored here</span>' : ''}
        <div class="row">${sailing ? '' : have ? `<button class="btn kelp" data-take="${id}">Take her out</button>`
          : `<button class="btn primary" data-buyboat="${id}" ${save.shells < t.price ? 'disabled' : ''}>${save.shells < t.price ? `${t.price - save.shells} Shells short` : `<span>Buy</span>${shellIco}<b class="num">${t.price}</b>`}</button>`}</div>`;
      body.appendChild(card);
    }
    body.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((b) => (b.onclick = () => takeBoat(b.dataset.take as BoatTierId)));
    body.querySelectorAll<HTMLButtonElement>('[data-buyboat]').forEach((b) => (b.onclick = () => buyBoat(b.dataset.buyboat as BoatTierId)));
    $('sw-note').textContent = 'Paint and flags are kept per boat.';
  }
}

function pick(hex: string) {
  const saved = paintOf()[part] ?? '';
  if (hex.toLowerCase() === saved.toLowerCase()) delete pending[part]; else pending[part] = hex;
  fx('tap');
  preview();
  render();
}

export function commitPaint(): boolean {
  if (!host) return false;
  const n = Object.keys(pending).length;
  const cost = n * PAINT_PRICE;
  if (!n || host.save.shells < cost) return false;
  const u = ensureUpg(host.save);
  const p = { ...(u.paint[u.boat] ?? {}) };
  for (const [g, hex] of Object.entries(pending)) { if (hex) p[g] = hex; else delete p[g]; }
  u.paint[u.boat] = p;
  host.save.shells -= cost;
  pending = {};
  host.commit();
  preview();
  fx('stamp');
  host.toast(`Fresh paint on ${BOAT_TIERS[u.boat].name}`, 'good');
  render();
  return true;
}

export function chooseFlag(id: string): boolean {
  if (!host) return false;
  const u = ensureUpg(host.save);
  const f = FLAGS.find((x) => x.id === id);
  if (!f) return false;
  if (!u.flags.includes(id)) {
    if (host.save.shells < f.price) return false;
    host.save.shells -= f.price;
    u.flags.push(id);
    fx('stamp');
  } else fx('tap');
  u.flag = id;
  setFlag(host.boatModel(), id);
  host.commit();
  host.toast(`${f.name} hoisted`, 'good');
  render();
  return true;
}

export function buyBoat(id: BoatTierId): boolean {
  if (!host) return false;
  const u = ensureUpg(host.save);
  const t = BOAT_TIERS[id];
  if (u.boats.includes(id) || host.save.shells < t.price) return false;
  host.save.shells -= t.price;
  u.boats.push(id);
  host.commit();
  takeBoat(id, true);
  host.launched(id);
  return true;
}

export function takeBoat(id: BoatTierId, quiet = false) {
  if (!host) return;
  const u = ensureUpg(host.save);
  if (!u.boats.includes(id)) return;
  pending = {};
  host.setTier(id);
  if (!quiet) { fx('tap'); host.toast(`${BOAT_TIERS[id].name.replace(/^the /, 'The ')} is yours to sail`, 'good'); }
  render();
}

export function swTick(px: number, pz: number) {
  if (!shipwrightOpen()) return;
  $('shells').classList.add('peek');
  if (swPos && Math.hypot(swPos[0] - px, swPos[2] - pz) > 24) closeShipwright();
}

export const swDebug = {
  setTab: (t: SwTab) => { tab = t; render(); host?.focus(t === 'flag' ? 'flag' : t === 'boats' ? 'boat' : part); },
  setPart: (p: PaintGroup) => { part = p; render(); host?.focus(p); },
  pick: (hex: string) => pick(hex),
  get pending() { return { ...pending }; },
};
