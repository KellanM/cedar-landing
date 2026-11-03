/**
 * Bill of sale (hud_flow_study P4): one confirm step before a big spend (boats, flags). A paper
 * card over a light scrim, the buy button on the thumb side, guarded for 400 ms like the catch
 * card so a stray tap can't spend. Enter = buy, Esc = not yet. Does not touch ctx.modal: it sits
 * on top of whichever sheet asked for it.
 */
import { esc, guard, guarded, h } from './ctx';
import { fx } from './fx';
import { ICONS } from './icons';

export interface BillOpts {
  kicker: string;
  title: string;
  /** one line: what you get */
  sub: string;
  price: number;
  balance: number;
  /** a line in the seller's voice (Caveat) */
  note?: string;
  yes: string;
  no?: string;
}

let el: HTMLElement | null = null;
let settle: ((ok: boolean) => void) | null = null;
const shell = `<span class="ico">${ICONS.shell}</span>`;

export const billOpen = () => !!settle;

export function confirmBill(o: BillOpts): Promise<boolean> {
  if (settle) settle(false);
  if (!el) {
    el = h('div', 'bill-wrap hidden');
    el.innerHTML = `<div class="bill-scrim"></div><article class="bill paper" role="dialog" aria-modal="true" aria-labelledby="bill-title"></article>`;
    document.body.appendChild(el);
    el.querySelector('.bill-scrim')!.addEventListener('click', () => done(false));
    window.addEventListener('keydown', (e) => {
      if (!settle) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'enter') {
        e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
        if (k === 'escape') done(false); else if (!guarded(el!)) done(true);
      }
    }, { capture: true });
  }
  const card = el.querySelector<HTMLElement>('.bill')!;
  const after = o.balance - o.price;
  card.innerHTML = `<p class="bill-kicker">${esc(o.kicker)}</p>
    <h2 id="bill-title">${esc(o.title)}</h2>
    <p class="bill-sub">${esc(o.sub)}</p>
    <div class="bill-sum num"><span>${shell}${o.price.toLocaleString()}</span><span class="bill-after">leaves you ${shell}${after.toLocaleString()}</span></div>
    ${o.note ? `<p class="bill-note">${esc(o.note)}</p>` : ''}
    <div class="bill-btns"><button class="btn ghost" id="bill-no">${esc(o.no ?? 'Not yet')}</button><button class="btn primary" id="bill-yes">${esc(o.yes)}</button></div>`;
  card.querySelector<HTMLButtonElement>('#bill-no')!.onclick = () => done(false);
  card.querySelector<HTMLButtonElement>('#bill-yes')!.onclick = () => { if (!guarded(el!)) done(true); };
  el.classList.remove('hidden');
  guard(el);
  fx('open');
  return new Promise((res) => { settle = res; });
}

function done(ok: boolean) {
  const s = settle;
  settle = null;
  el?.classList.add('hidden');
  if (!ok) fx('close');
  s?.(ok);
}
