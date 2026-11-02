/**
 * Fish market, "cannery label" skin on the shared Sheet (ui_design §4.4, ui_layouts_indie §3.3).
 * Vendor line in the header (shopping isn't a conversation), 64px rows with price-ticket sell
 * buttons on the thumb side, Sell all pinned in the footer. Selling stamps the row SOLD, flies
 * Shells to the counter, then the row collapses.
 */
import { $, ctx, h, reduceMotion } from './ctx';
import { fx } from './fx';
import { ICONS } from './icons';
import { fishGlyph, starsSvg } from './fishart';
import { log, saveLog } from './prefs';
import { Sheet } from './sheet';
import { SPECIES, priceFor, type CaughtFish } from '../game/fishdata';
import type { Interact } from '../world/types';

let sheet: Sheet;
let onSellOne: ((i: number) => void) | null = null;
let rows: CaughtFish[] = [];
let view: 'cooler' | 'board' = 'cooler';
let busy = false; // a sale is animating; row indices are stale until re-render

const shellIco = `<span class="ico">${ICONS.shell}</span>`;

export function buildMarket() {
  sheet = new Sheet({ id: 'sell', skin: 'label', modal: 'market', onClose: () => ctx.h?.closeSell(), ariaLabel: 'Fish market' });
  sheet.header.innerHTML = `
    <div class="label-band"><div class="inset">
      <h2 id="market-title"><span class="town">Cedar Landing</span><span class="what">Fish Market</span></h2>
    </div></div>
    <p class="quote" id="market-quote">“Fresh off the water?” <span>— Mae</span></p>`;
  sheet.body.innerHTML = `<ul id="sell-list" class="sell-list"></ul><div id="price-board" class="price-board hidden"></div>`;
  sheet.foot.innerHTML = `
    <button id="market-board" class="btn ghost">Prices</button>
    <button id="sell-all" class="btn kelp"></button>
    <button id="sell-close" class="btn ghost done">Done</button>`;
  $('sell-all').addEventListener('click', () => { if (!busy) ctx.h?.sellAll(); });
  $('sell-close').addEventListener('click', () => ctx.h?.closeSell());
  $('market-board').addEventListener('click', () => { view = view === 'board' ? 'cooler' : 'board'; fx('page'); render(); });
}

export const marketOpen = () => sheet?.isOpen ?? false;
/** where the open market is (the sheet closes when you paddle out of its dock zone) */
export let marketPos: number[] | null = null;

export function showSell(cooler: CaughtFish[], sellOne: (i: number) => void, where?: Interact | null) {
  onSellOne = sellOne;
  rows = cooler.slice();
  if (where) marketPos = where.pos;
  const pr = (where?.props ?? {}) as Record<string, unknown>;
  const town = typeof pr.poi === 'string' ? pr.poi.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Cedar Landing';
  sheet.header.querySelector('.town')!.textContent = town;
  sheet.header.querySelector('#market-quote span')!.textContent = `— ${typeof pr.npc === 'string' ? pr.npc : 'Mae'}`;
  if (!sheet.isOpen) view = 'cooler';
  render();
  const wasOpen = sheet.isOpen;
  sheet.open();
  if (!wasOpen) sheet.setSnap(rows.length <= 2 ? 40 : 70); // few rows: keep the facade in view
}

function render() {
  busy = false;
  const ul = $('sell-list');
  const board = $('price-board');
  ul.classList.toggle('hidden', view !== 'cooler');
  board.classList.toggle('hidden', view !== 'board');
  $('market-board').textContent = view === 'board' ? 'Cooler' : 'Prices';
  ul.innerHTML = '';
  if (!rows.length) ul.innerHTML = `<li class="empty">Nothing in the cooler yet.<br><span>The ripples off the point are biting.</span></li>`;
  rows.forEach((f, i) => {
    const li = h('li', 'row');
    li.innerHTML = `
      <span class="glyph">${fishGlyph(f.speciesId, f.color)}</span>
      <span class="who"><b>${f.name}</b><span class="sub">${starsSvg(f.stars, 3, 15)}<span class="num">${f.size.toFixed(1)} cm</span></span></span>`;
    const b = h('button', 'ticket', `${shellIco}<b class="num">${f.price}</b><span class="go" aria-hidden="true">▸</span>`) as HTMLButtonElement;
    b.setAttribute('aria-label', `Sell ${f.name} for ${f.price} Shells`);
    b.onclick = () => { if (!busy) onSellOne?.(i); };
    li.appendChild(b);
    ul.appendChild(li);
  });
  const total = rows.reduce((a, f) => a + f.price, 0);
  const all = $<HTMLButtonElement>('sell-all');
  all.disabled = !rows.length;
  all.innerHTML = rows.length ? `<span>Sell all</span>${shellIco}<b class="num">${total}</b>` : '<span>Nothing to sell</span>';

  if (view === 'board') {
    const recs = ctx.save?.records ?? {};
    const list = SPECIES.filter((s) => s.price > 0).sort((a, b) => a.price - b.price);
    board.innerHTML = `<div class="chalk-head"><h3>Today's prices</h3><p>typical <i>·</i> best ★★★</p></div><div class="slips">${list.map((s) => {
      const known = !!recs[s.id];
      return `<div class="slip${known ? '' : ' unknown'}"><span class="nm">${known ? s.name : '???'}</span><span class="pr num">${priceFor(s, (s.size[0] + s.size[1]) / 2, 1)}<i>·</i>${priceFor(s, s.size[1], 3)}</span></div>`;
    }).join('')}</div>`;
  }
}

/**
 * Called by main.ts right after the save is updated: stamps the sold rows, flies Shells to the
 * counter (then `then()` rolls the counter), collapses the rows, and re-renders.
 */
export function onSold(idx: number[], total: number, cooler: CaughtFish[], then: () => void) {
  busy = true;
  log.sold += total;
  saveLog();
  fx('sell');
  const lis = Array.from($('sell-list').querySelectorAll<HTMLElement>('li.row'));
  const sources: DOMRect[] = [];
  for (const i of idx) {
    const li = lis[i];
    if (!li) continue;
    li.classList.add('sold');
    li.insertAdjacentHTML('beforeend', '<span class="sold-stamp">SOLD</span>');
    sources.push(li.querySelector('.ticket')!.getBoundingClientRect());
    setTimeout(() => li.classList.add('collapse'), reduceMotion() ? 0 : 400);
  }
  setTimeout(() => fx('stamp'), 90);
  const counter = $('shells').getBoundingClientRect();
  if (!reduceMotion()) {
    for (const [n, r] of sources.entries()) {
      for (let k = 0; k < 4; k++) {
        const s = h('div', 'fly-shell', ICONS.shell);
        document.body.appendChild(s);
        const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        const x1 = counter.left + 20, y1 = counter.top + counter.height / 2;
        const a = s.animate([
          { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
          { transform: `translate(${(x0 + x1) / 2 + (k - 1.5) * 18}px, ${Math.min(y0, y1) - 40}px) scale(1.15)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${x1}px, ${y1}px) scale(.6)`, opacity: 0.9 },
        ], { duration: 450, delay: n * 70 + k * 45, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'backwards' });
        a.onfinish = () => s.remove();
      }
    }
  }
  setTimeout(then, reduceMotion() ? 0 : 420);
  setTimeout(() => { rows = cooler.slice(); if (sheet.isOpen) render(); }, reduceMotion() ? 200 : 640);
}

export function hideSell() { sheet?.close(); }
