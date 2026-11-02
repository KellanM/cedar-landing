/**
 * DialogueStrip (ui_layouts_indie §3.5): bottom strip with the speaker's name tab, typewriter at
 * 45 chars/s, tap completes the line, tap again advances. Choices (max 3, 56px) stack above on
 * the right, default nearest the thumb. Desktop: Space/E advance, 1–3 pick. HUD top strip hidden.
 */
import { $, ctx, h, setModal, T, reduceMotion } from './ctx';
import { fx } from './fx';
import { gameAudio } from '../audio';

export interface Line { who: string; text: string; choices?: { label: string; value: string }[] }

let el: HTMLElement | null = null;
let queue: Line[] = [];
let shown = 0;
let full = '';
let typing = 0;
let done: ((v: string | null) => void) | null = null;

function ensure() {
  if (el) return el;
  el = h('div', 'dialogue hidden');
  el.innerHTML = `<div class="choices" id="dlg-choices"></div>
    <div class="strip paper" role="dialog" aria-live="polite"><b class="name-tab" id="dlg-who"></b><p id="dlg-text"></p><i class="more" aria-hidden="true">▸</i></div>`;
  document.body.appendChild(el);
  el.querySelector('.strip')!.addEventListener('pointerdown', (e) => { e.stopPropagation(); advance(); });
  window.addEventListener('keydown', (e) => {
    if (ctx.modal !== 'dialogue') return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'e' || k === 'enter') { e.preventDefault(); e.stopPropagation(); advance(); }
    const n = Number(k);
    if (n >= 1 && n <= 3) el!.querySelectorAll<HTMLButtonElement>('.choices button')[n - 1]?.click();
  }, { capture: true });
  return el;
}

/** Play lines; resolves with the chosen value (or null). */
export function dialogue(lines: Line[]): Promise<string | null> {
  ensure();
  queue = lines.slice();
  el!.classList.remove('hidden');
  setModal('dialogue');
  return new Promise((res) => { done = res; next(); });
}

function next() {
  const line = queue.shift();
  if (!line) return finish(null);
  $('dlg-who').textContent = line.who;
  full = line.text;
  shown = 0;
  el!.classList.remove('complete');
  const ch = $('dlg-choices');
  ch.innerHTML = '';
  clearInterval(typing);
  const tick = () => {
    shown = Math.min(full.length, shown + 1);
    $('dlg-text').textContent = full.slice(0, shown);
    if (shown >= full.length) complete(line);
  };
  gameAudio.voice(line.who, line.text, reduceMotion() ? 0.6 : Math.min(2.4, full.length / T.cps)); // non-verbal murmur while it types
  if (reduceMotion()) { shown = full.length - 1; tick(); } else typing = window.setInterval(tick, 1000 / T.cps);
}

function complete(line: Line) {
  clearInterval(typing);
  $('dlg-text').textContent = full;
  shown = full.length;
  el!.classList.add('complete');
  if (line.choices?.length) {
    const ch = $('dlg-choices');
    // default (first) choice nearest the thumb → render bottom-most
    for (const c of [...line.choices].slice(0, 3).reverse()) {
      const b = h('button', 'btn ghost', c.label) as HTMLButtonElement;
      b.onclick = (e) => { e.stopPropagation(); finish(c.value); };
      ch.appendChild(b);
    }
  }
}

function advance() {
  if (shown < full.length) { shown = full.length - 1; return; } // next tick completes
  if (el!.querySelector('.choices button')) return; // must choose
  fx('page');
  next();
}

function finish(v: string | null) {
  clearInterval(typing);
  el?.classList.add('hidden');
  if (ctx.modal === 'dialogue') setModal(null);
  const d = done; done = null;
  d?.(v);
}
