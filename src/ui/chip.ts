/**
 * Errand notes (ui_layouts_indie §3.6, routed through the notice lane, hud_flow_study P1): a
 * pencilled one-line note writes on in the lane for 4 s, then tucks into the Log button. On
 * completion it peeks again with the strike-through. A pinned errand rests in the lane while
 * nothing else is showing.
 */
import { $ } from './ctx';
import { lanePush, setPinned } from './lane';

/** Peek a note; `done` plays the strike-through. */
export function chip(text: string, o: { done?: boolean; ms?: number } = {}) {
  lanePush(text, 'errand', { done: o.done, ms: o.ms ?? (o.done ? 2800 : 4000), key: `errand:${text}` });
}

/** The tuck: the Log button bumps as the note goes into it. */
export function errandTucked() {
  const log = $('btn-log');
  log.classList.remove('got'); void log.offsetWidth; log.classList.add('got');
}

export function pinChip(text: string | null) { setPinned(text); }

/**
 * Badge on the Log button: things that are NEW since the Log was last opened (hud_flow_study P8).
 * One badge only; the cover stamps live inside the Log.
 */
export function setLogBadge(n: number) {
  const b = $('log-badge');
  b.textContent = `${n} new`;
  b.classList.toggle('hidden', n <= 0);
  $('btn-log').setAttribute('aria-label', n > 0 ? `Open the Log, ${n} new` : 'Open the Log');
}
