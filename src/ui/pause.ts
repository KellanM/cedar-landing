/**
 * Implicit pause (ui_layouts_indie §3.12): on visibilitychange/blur, a light paper slip at centre
 * over a 30% scrim — "Paused — tap to carry on". It does not open the Log.
 */
import { ctx, h } from './ctx';

let el: HTMLElement | null = null;

function ensure() {
  if (el) return el;
  el = h('div', 'pause-slip hidden', '<div class="slip paper"><b>Paused</b><span>tap to carry on</span></div>');
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); resume(); });
  window.addEventListener('keydown', (e) => { if (ctx.pausedSlip) { e.stopPropagation(); resume(); } }, { capture: true });
  document.body.appendChild(el);
  return el;
}

export function initPause() {
  ensure();
  const trip = () => { if (!ctx.pausedSlip && ctx.modal !== 'log' && document.body.classList.contains('playing')) pause(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) trip(); });
  window.addEventListener('blur', trip);
}

export function pause() { ctx.pausedSlip = true; ensure().classList.remove('hidden'); }
export function resume() { ctx.pausedSlip = false; el?.classList.add('hidden'); }
