/**
 * LoadingPage (ui_layouts_indie §3.10): paper page, pencil sketch, one Grandmother tip, a pencil
 * line drawn along a tide-table rule (no percentage). Only shown if loading takes >300 ms; once
 * shown it stays ≥800 ms; crossfades out over 400 ms.
 */
import { $ } from './ctx';

const TIPS = [
  'Fish bite best where the water wrinkles. Look for the rings.',
  'Never pull against a thrashing fish. Let it tire, then bring it home.',
  'The market pays more for a big one. Patience is worth Shells.',
  'Fog hides the islands, not the fish.',
  'Write down every new fish. The book remembers what you forget.',
];

let shownAt = 0;
const t0 = performance.now();
const showTimer = window.setTimeout(() => {
  const el = $('loading');
  if (!el || el.classList.contains('done')) return;
  el.classList.add('shown');
  shownAt = performance.now();
}, 300);

export function initLoading() {
  const tip = document.getElementById('load-tip');
  if (tip) tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}

/** Call when the world is ready. */
export function loadingDone(): Promise<void> {
  const el = $('loading');
  clearTimeout(showTimer);
  const wait = shownAt ? Math.max(0, 800 - (performance.now() - shownAt)) : 0;
  return new Promise((res) => setTimeout(() => {
    el.classList.add('done');
    document.body.classList.add('playing');
    setTimeout(() => res(), 400);
  }, wait));
}

export const loadElapsed = () => performance.now() - t0;
