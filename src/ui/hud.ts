import { SPECIES, priceFor, speciesById, type CaughtFish, type Species } from '../game/fishdata';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function toast(msg: string, kind: 'info' | 'good' | 'warn' = 'info', ms = 2400) {
  const box = $('toasts');
  // de-dupe identical toasts that are still visible
  for (const el of Array.from(box.children)) if (el.textContent === msg) el.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild!.remove();
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 450);
}

export function setShells(n: number) { $('shell-count').textContent = String(n); }

export function renderCooler(cooler: CaughtFish[], cap: number, pulse = false) {
  const el = $('cooler');
  el.innerHTML = '';
  for (let i = 0; i < cap; i++) {
    const s = document.createElement('div');
    const f = cooler[i];
    s.className = `slot${f ? ' full' : ''}`;
    if (f) s.style.setProperty('--fish', f.color);
    el.appendChild(s);
  }
  if (pulse) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
}

export const starStr = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));

function fishSvg(color: string, rarity: string) {
  const fin = rarity === 'rare' ? '#d9a441' : 'rgba(44,54,52,.45)';
  return `<svg viewBox="0 0 150 64"><path d="M14 32c18-22 62-26 96-6l22-14v40l-22-14c-34 20-78 16-96-6z" fill="${color}" stroke="rgba(44,54,52,.6)" stroke-width="2.5"/><path d="M58 14c8 2 16 6 20 10M58 50c8-2 16-6 20-10" stroke="${fin}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="34" cy="28" r="3.5" fill="#2c3634"/></svg>`;
}

export function showCard(fish: CaughtFish, sp: Species, stamp: 'NEW!' | 'RECORD!' | null, coolerFull: boolean, perfect: boolean) {
  $('card-art').innerHTML = fishSvg(fish.color, fish.rarity);
  $('card-name').textContent = fish.name;
  $('card-size').textContent = `${fish.size.toFixed(1)} cm`;
  $('card-stars').textContent = starStr(fish.stars);
  $('card-flavor').textContent = `"${sp.flavor}"`;
  $('card-value').textContent = `${sp.rarity} · worth about ${fish.price} Shells${perfect ? ' · perfect reel!' : ''}`;
  const st = $('card-stamp');
  st.classList.toggle('hidden', !stamp);
  if (stamp) st.textContent = stamp;
  const keep = $<HTMLButtonElement>('card-keep');
  keep.disabled = coolerFull || !!fish.releaseOnly;
  keep.textContent = fish.releaseOnly ? 'Release only' : coolerFull ? 'Cooler full' : 'Keep';
  if (fish.releaseOnly) $('card-value').textContent = `${sp.rarity} · catch & release — logged in your journal`;
  $('card').classList.remove('hidden');
}
export function hideCard() { $('card').classList.add('hidden'); }

export function showSell(cooler: CaughtFish[], onSellOne: (i: number) => void) {
  const ul = $('sell-list');
  ul.innerHTML = '';
  if (!cooler.length) {
    ul.innerHTML = '<li class="empty">Your cooler is empty. Go catch something!</li>';
  }
  cooler.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${f.name} <small>${f.size.toFixed(1)} cm</small><span class="stars">${starStr(f.stars)}</span></span>`;
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = `${f.price} ⟡`;
    b.onclick = () => onSellOne(i);
    li.appendChild(b);
    ul.appendChild(li);
  });
  const total = cooler.reduce((a, f) => a + f.price, 0);
  const all = $<HTMLButtonElement>('sell-all');
  all.disabled = !cooler.length;
  all.textContent = cooler.length ? `Sell all · ${total} Shells` : 'Sell all';
  // price table
  const t = $('price-table');
  if (!t.childElementCount) {
    const rows = [...SPECIES].sort((a, b) => a.price - b.price).map((s) =>
      `<tr><td>${s.name} <span class="rar">${s.rarity}</span></td><td class="r">${priceFor(s, (s.size[0] + s.size[1]) / 2, 1)}</td><td class="r">${priceFor(s, s.size[1], 3)}</td></tr>`);
    t.innerHTML = `<tr><td></td><td class="r small">typical</td><td class="r small">best ★★★</td></tr>${rows.join('')}`;
  }
  $('sell').classList.remove('hidden');
}
export function hideSell() { $('sell').classList.add('hidden'); }

export { speciesById };
