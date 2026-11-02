/**
 * Chip (ui_layouts_indie §3.6): a pencilled one-line note under Shells. Writes on, stays 4 s,
 * then tucks into the Log button (numeral badge). On completion it peeks again with a 500 ms
 * strike-through. A pinned errand stays as a chip while sailing (obeys quiet mode). Max 1 visible.
 */
import { $, esc, h } from './ctx';

let el: HTMLElement | null = null;
let timer = 0;
let pinned: string | null = null;

function ensure() {
  if (el) return el;
  el = h('div', 'chip-note hidden');
  el.setAttribute('role', 'status');
  document.querySelector('.hud-top-left')!.appendChild(el);
  return el;
}

/** Peek a note; `done` plays the strike-through. Tucks back after `ms` unless pinned. */
export function chip(text: string, o: { done?: boolean; ms?: number } = {}) {
  const e = ensure();
  clearTimeout(timer);
  e.innerHTML = `<span class="txt">${esc(text)}</span>`;
  e.classList.remove('hidden', 'tuck', 'done', 'in');
  void e.offsetWidth;
  e.classList.add('in');
  if (o.done) setTimeout(() => e.classList.add('done'), 350);
  timer = window.setTimeout(tuck, o.ms ?? 4000);
}

function tuck() {
  if (!el) return;
  if (pinned) { el.innerHTML = `<span class="txt">${esc(pinned)}</span>`; el.classList.remove('done'); el.classList.add('pinned'); return; }
  el.classList.add('tuck');
  const log = $('btn-log');
  log.classList.remove('got'); void log.offsetWidth; log.classList.add('got');
  setTimeout(() => { if (el?.classList.contains('tuck')) el.classList.add('hidden'); }, 420);
}

export function pinChip(text: string | null) {
  pinned = text;
  const e = ensure();
  if (text) { e.innerHTML = `<span class="txt">${esc(text)}</span>`; e.classList.remove('hidden', 'tuck', 'done'); e.classList.add('pinned', 'in'); }
  else { e.classList.remove('pinned'); e.classList.add('hidden'); }
}

/** Numeral badge on the Log button (open errands). */
export function setLogBadge(n: number) {
  const b = $('log-badge');
  b.textContent = String(n);
  b.classList.toggle('hidden', n <= 0);
}
