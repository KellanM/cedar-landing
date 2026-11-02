/**
 * TitleCard (ui_layouts_indie §3.9): letterbox + area title written on in the sky band.
 * t=0 HUD out + letterbox in · 0.8s title · 1.0s subtitle + ink rule · hold 2.5s · out 0.6s.
 * A tap after 0.8 s skips to the out-fade. Never takes input focus.
 */
import { ctx, esc, h, T, reduceMotion } from './ctx';

let el: HTMLElement | null = null;
let timers: number[] = [];
let startedAt = 0;

function ensure() {
  if (el) return el;
  el = h('div', 'title-card hidden');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="lb top"></div><div class="lb bot"></div><div class="tc-text"><h1></h1><p></p><i class="rule"></i></div>`;
  document.body.appendChild(el);
  window.addEventListener('pointerdown', () => { if (ctx.title && performance.now() - startedAt > 800) out(); }, { capture: true });
  return el;
}

export function titleCard(title: string, subtitle = '') {
  const e = ensure();
  timers.forEach(clearTimeout); timers = [];
  e.querySelector('h1')!.textContent = title;
  e.querySelector('p')!.innerHTML = esc(subtitle);
  e.classList.remove('hidden', 'go', 'out');
  void e.offsetWidth;
  e.classList.add('go');
  ctx.title = true;
  document.body.classList.add('titling');
  startedAt = performance.now();
  const rm = reduceMotion();
  timers.push(window.setTimeout(out, rm ? 2600 : 1000 + T.titleHold));
}

/** Any modal/sheet opening ends the title card at once (it never competes with UI). */
export function endTitle() { out(); }

function out() {
  if (!el || !ctx.title) return;
  timers.forEach(clearTimeout); timers = [];
  el.classList.add('out');
  document.body.classList.remove('titling');
  timers.push(window.setTimeout(() => { el!.classList.add('hidden'); ctx.title = false; }, 600));
}
