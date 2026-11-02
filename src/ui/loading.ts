/**
 * Opening (docs/title_study.md): the loading card and the title screen are one piece of paper.
 * The card is in index.html and visible from first paint (no JS needed); progress moves the troller
 * across the water toward the landing. When the world is ready the printed scene dissolves and the
 * live harbour shows through the same mount, with "Tap to set out". Quick path: a tap/key while
 * loading means "go straight in" (no title wait), and the title takes the very first tap.
 */
import { $ } from './ctx';

const TIPS = [
  'Fish bite best where the water wrinkles. Look for the rings.',
  'Never pull against a thrashing fish. Let it tire, then bring it home.',
  'The market pays more for a big one. Patience is worth Shells.',
  'Fog hides the islands, not the fish.',
  'Write down every new fish. The book remembers what you forget.',
];

const t0 = performance.now();
let tappedAhead = false;
let shownP = 0;

export function initLoading() {
  const tip = document.getElementById('load-tip');
  if (tip) tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const ahead = (e: Event) => {
    if ((e.target as HTMLElement | null)?.closest?.('#version-stamp')) return;
    if (!document.getElementById('loading')?.classList.contains('title')) tappedAhead = true;
  };
  window.addEventListener('pointerdown', ahead, { capture: true, passive: true });
  window.addEventListener('keydown', ahead, { capture: true, passive: true });
}

/** Loader progress (0..1) and a short status line. The boat never sails backwards. */
export function setLoadProgress(msg: string, f: number) {
  const el = document.getElementById('loading');
  if (!el) return;
  shownP = Math.max(shownP, Math.min(1, f));
  el.style.setProperty('--p', shownP.toFixed(3));
  $('load-msg').textContent = msg;
}

/**
 * Call when the world is ready. With `title`, shows the title screen and resolves on the player's
 * tap (or at once if they already tapped while loading); otherwise resolves straight away.
 * Either way the card has faded by the time play is visible.
 */
export function loadingDone(title: boolean): Promise<void> {
  const el = $('loading');
  setLoadProgress('Ready', 1);
  el.removeAttribute('aria-busy');
  const finish = () => {
    el.classList.add('done');
    document.body.classList.remove('title-open');
    document.body.classList.add('playing');
    setTimeout(() => el.classList.add('hidden'), 800);
  };
  if (!title || tappedAhead) {
    // let the boat arrive at the landing before the card lifts (short, and only once)
    return new Promise((res) => setTimeout(() => { finish(); res(); }, tappedAhead ? 0 : 350));
  }
  return new Promise((res) => {
    setTimeout(() => {
      el.classList.add('title');
      document.body.classList.add('title-open');
      const go = $('ld-go');
      go.tabIndex = 0;
      go.focus({ preventScroll: true });
      let gone = false;
      const set = (e: Event) => {
        if (gone) return;
        if (e instanceof KeyboardEvent && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key))) return;
        gone = true;
        e.preventDefault();
        el.removeEventListener('click', set);
        window.removeEventListener('keydown', set, true);
        finish();
        res();
      };
      el.addEventListener('click', set);
      window.addEventListener('keydown', set, true);
    }, 300);
  });
}

export const loadElapsed = () => performance.now() - t0;
