/**
 * The Chandlery (buy_tackle / buy_bait): rod, line, reel, cooler and bait on the shared Sheet,
 * Logbook paper skin. Study: docs/study/upgrades_customization.md.
 *  - each track is a tab; rows show what you have (stamped), the next tier (price ticket) and the
 *    one after as a pencil sketch (Dredge/Stardew: see the next step, not the whole tree)
 *  - effects are said plainly ("reels in a third faster"); line rows show the FISH they reach,
 *    silhouettes for ones not yet in the logbook (Dredge's type badges → our species chips)
 *  - buying stamps the row and says what just changed, in one line
 */
import './shop.css';
import { $, ctx, h, esc } from './ctx';
import { fx } from './fx';
import { ICONS } from './icons';
import { Sheet } from './sheet';
import { GEAR, TRACKS, speciesAtDepth, ensureUpg, type GearItem, type Track } from '../game/progression/gear';
import type { SaveData } from '../game/save';
import type { Interact } from '../world/types';

export interface ShopHost {
  save: SaveData;
  /** persist + re-apply gear (coolerCap, stats), roll the Shells counter */
  commit(): void;
  toast(msg: string, kind?: 'info' | 'good' | 'warn' | 'log'): void;
}

const TAB: Record<Track, { label: string; ico: string; sk: string }> = {
  rod: { label: 'Rods', ico: 'rod', sk: 'rod' },
  line: { label: 'Line', ico: 'hook', sk: 'hook' },
  reel: { label: 'Reels', ico: 'wheel', sk: 'wheel' },
  cooler: { label: 'Ice', ico: 'cooler', sk: 'cooler' },
  bait: { label: 'Bait', ico: 'basket', sk: 'basket' },
};
const shellIco = `<span class="ico">${ICONS.shell}</span>`;

let sheet: Sheet | null = null;
let host: ShopHost | null = null;
let tab: Track = 'rod';
let just: string | null = null;
/** where the open shop is (it closes when you walk/paddle away) */
export let shopPos: number[] | null = null;

function build() {
  sheet = new Sheet({ id: 'shop', skin: 'logbook', modal: 'market', onClose: () => closeShop(), ariaLabel: 'Chandlery' });
  sheet.el.classList.add('upg-sheet');
  sheet.header.innerHTML = `
    <div class="upg-head">
      <span class="town" id="shop-town">Cedar Landing</span>
      <h2>Chandlery</h2>
      <span class="purse" id="shop-purse"></span>
      <p class="quote" id="shop-quote"></p>
    </div>
    <nav class="upg-tabs" role="tablist" id="shop-tabs"></nav>`;
  sheet.body.innerHTML = `<ul class="upg-list" id="shop-list"></ul>`;
  sheet.foot.innerHTML = `<span class="upg-foot-note" id="shop-note"></span><button class="btn ghost done" id="shop-done">Done</button>`;
  // tabs live in the header, whose pointerdown starts the sheet drag: keep taps on the tabs
  $('shop-tabs').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('shop-done').addEventListener('click', () => closeShop());
}

export const shopOpen = () => sheet?.isOpen ?? false;

export function openShop(h0: ShopHost, where: Interact | null, start: Track = 'rod') {
  host = h0;
  if (!sheet) build();
  tab = start;
  just = null;
  shopPos = where?.pos ?? null;
  const pr = (where?.props ?? {}) as Record<string, unknown>;
  const npc = typeof pr.npc === 'string' ? pr.npc : 'Old Tess';
  $('shop-town').textContent = typeof pr.poi === 'string' ? pr.poi.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Cedar Landing';
  $('shop-quote').innerHTML = start === 'bait' ? `“Herring's fresh, spoons are polished.” <span>— ${esc(npc)}</span>` : `“Gear that's older than me, and twice as honest.” <span>— ${esc(npc)}</span>`;
  render();
  sheet!.open();
}

export function closeShop() { sheet?.close(); shopPos = null; }

function owned(t: Track, it: GearItem) {
  const u = ensureUpg(host!.save);
  return t === 'bait' ? u.baits.includes(it.id) : u[t] >= it.tier;
}

function render() {
  if (!sheet || !host) return;
  const save = host.save;
  const u = ensureUpg(save);
  $('shop-purse').innerHTML = `${shellIco}<span class="num">${save.shells}</span>`;
  // tabs (a dot marks a track with something affordable)
  const tabs = $('shop-tabs');
  tabs.innerHTML = '';
  for (const t of TRACKS) {
    const next = nextFor(t);
    const b = h('button', 'upg-tab', `<span class="ico">${ICONS[TAB[t].ico]}</span>${TAB[t].label}${next && next.price <= save.shells ? '<i class="dot" aria-label="affordable"></i>' : ''}`) as HTMLButtonElement;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === tab));
    b.dataset.track = t;
    b.onclick = () => { tab = t; just = null; fx('page'); render(); };
    tabs.appendChild(b);
  }
  const ul = $('shop-list');
  ul.innerHTML = '';
  const items = GEAR[tab];
  const next = nextFor(tab);
  const recs = save.records ?? {};
  items.forEach((it, i) => {
    const isOwned = owned(tab, it);
    // show owned + the next purchasable + one pencil sketch beyond; hide the rest (no tree dumps)
    const nextIdx = next ? items.indexOf(next) : items.length;
    if (!isOwned && i > nextIdx + 1 && tab !== 'bait') return;
    const later = !isOwned && it !== next && tab !== 'bait';
    const li = h('li', `upg-item${later ? ' later' : ''}${just === it.id ? ' just' : ''}`);
    li.dataset.id = it.id;
    let act = '';
    if (tab === 'bait' && isOwned) {
      act = u.bait === it.id ? '<span class="upg-stamp red">On the hook</span>' : `<button class="btn ghost use" data-use="${it.id}">Use</button>`;
    } else if (isOwned) {
      const inUse = tab !== 'bait' && u[tab as Exclude<Track, 'bait'>] === it.tier;
      act = `<span class="upg-stamp">${just === it.id ? 'Bought' : inUse ? 'Aboard' : 'Owned'}</span>`;
    } else if (later) {
      act = `<span class="lock">after the ${esc(items[i - 1]?.name.toLowerCase() ?? 'last one')}</span>`;
    } else {
      const short = it.price - save.shells;
      act = `<button class="ticket" data-buy="${it.id}" ${short > 0 ? 'disabled' : ''} aria-label="Buy ${esc(it.name)} for ${it.price} Shells">${shellIco}<b class="num">${it.price}</b>${short > 0 ? `` : '<span class="go" aria-hidden="true">▸</span>'}</button>`;
      if (short > 0) act += `<div class="lock">${short} more</div>`;
    }
    let reach = '';
    if (tab === 'line') {
      const prev = i > 0 ? items[i - 1].depth ?? 0 : 0;
      const fish = speciesAtDepth(it.depth ?? 3, prev).slice(0, 6);
      reach = `<div class="reach">${it.depth} fathoms ·${fish.map((s) => recs[s.id]
        ? `<span class="f"><img src="${import.meta.env.BASE_URL}fish/${s.id.replace(/_/g, '-')}.svg" alt="">${esc(s.name)}</span>`
        : `<span class="f unk"><img src="${import.meta.env.BASE_URL}fish/silhouettes/${s.id.replace(/_/g, '-')}.svg" alt="">???</span>`).join('')}</div>`;
    }
    li.innerHTML = `
      <span class="sk" aria-hidden="true"><span class="ico">${ICONS[TAB[tab].sk]}</span></span>
      <span class="nm">${esc(it.name)}</span>
      <span class="act">${act}</span>
      <span class="nt">${esc(it.note)}</span>
      <span class="ef">${esc(it.effect)}</span>${reach}`;
    ul.appendChild(li);
  });
  ul.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => (b.onclick = () => buy(b.dataset.buy!)));
  ul.querySelectorAll<HTMLButtonElement>('[data-use]').forEach((b) => (b.onclick = () => useBait(b.dataset.use!)));
  $('shop-note').textContent = tab === 'line' ? 'A longer line reaches deeper fish.' : tab === 'bait' ? 'Bait never runs out. Pick one to fish with.' : tab === 'cooler' ? 'Your boat\'s hold adds to the ice box.' : '';
}

function nextFor(t: Track): GearItem | null {
  if (!host) return null;
  return GEAR[t].find((it) => !owned(t, it)) ?? null;
}

const SAID: Record<Track, (it: GearItem) => string> = {
  rod: (it) => `${it.name} rigged — reels faster, strains slower`,
  line: (it) => `${it.name} wound on — reaches ${it.depth} fathoms now`,
  reel: (it) => `${it.name} fitted — slips give up less line`,
  cooler: (it) => `${it.name} aboard — room for ${it.cap} fish`,
  bait: (it) => `${it.name} on the hook — ${it.effect.toLowerCase()}`,
};

export function buy(id: string): boolean {
  if (!host) return false;
  const it = GEAR[tab].find((x) => x.id === id) ?? TRACKS.flatMap((t) => GEAR[t]).find((x) => x.id === id);
  if (!it || owned(it.track, it) || host.save.shells < it.price) return false;
  const u = ensureUpg(host.save);
  host.save.shells -= it.price;
  if (it.track === 'bait') { u.baits.push(it.id); u.bait = it.id; } else u[it.track] = it.tier;
  host.commit();
  just = it.id;
  tab = it.track;
  fx(it.track === 'bait' ? 'buy' : 'upgrade');
  host.toast(SAID[it.track](it), 'good');
  render();
  return true;
}

function useBait(id: string) {
  if (!host) return;
  const u = ensureUpg(host.save);
  if (!u.baits.includes(id)) return;
  u.bait = id;
  host.commit();
  just = null;
  fx('tap');
  render();
}

/** per-frame: keep the purse visible, close when you leave the counter */
export function shopTick(px: number, pz: number) {
  if (!shopOpen()) return;
  $('shells').classList.add('peek');
  if (shopPos && Math.hypot(shopPos[0] - px, shopPos[2] - pz) > 20) closeShop();
}

export const shopDebug = { get tab() { return tab; }, setTab: (t: Track) => { tab = t; render(); }, render: () => render(), ctxModal: () => ctx.modal };
