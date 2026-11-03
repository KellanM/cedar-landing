/**
 * Notice lane (docs/hud_flow_study.md P1). One slot, top-centre under the HUD row, shows ONE thing
 * at a time: toasts, errand notes (write-on / strike-through), the portrait clock change, the
 * update notice. Items queue by priority (safety > notices > rewards/news > clock > errands) and
 * drop when stale. When nothing is queued the slot rests on the compass ribbon (when it wants to
 * show) or the pinned errand. Held (queued, not shown) during cards, dialogue, the Log, title
 * cards, cinematics and the fishing focus mode.
 */
import { $, ctx, esc, h, T } from './ctx';
import { ICONS } from './icons';

export type LaneKind = 'info' | 'good' | 'warn' | 'log' | 'errand' | 'clock' | 'notice';
export interface LaneAction { label: string; primary?: boolean; run: () => void }
export interface LaneOpts {
  ms?: number;
  /** replaces a queued/showing item with the same key */
  key?: string;
  /** errand: play the pencil strike-through */
  done?: boolean;
  /** never dropped as stale; stays until tapped / an action runs (the update notice) */
  sticky?: boolean;
  /** buttons inside the slip */
  actions?: LaneAction[];
  /** trusted html instead of escaped text */
  html?: boolean;
}
interface Item { text: string; kind: LaneKind; o: LaneOpts; at: number; seq: number }

const PRIO: Record<LaneKind, number> = { warn: 0, notice: 1, good: 2, log: 2, info: 2, clock: 3, errand: 4 };
const ICON: Partial<Record<LaneKind, string>> = { good: 'check', warn: 'warn', log: 'pencil' };

let root: HTMLElement;
let slot: HTMLElement;
let pinnedEl: HTMLElement;
let cur: Item | null = null;
let curUntil = 0;
let curShownAt = 0;
let queue: Item[] = [];
let seq = 0;
let compassWanted = false;
let pinned: string | null = null;
let onErrandTuck: (() => void) | null = null;

export function initLane(o: { onErrandTuck?: () => void } = {}) {
  root = $('lane');
  onErrandTuck = o.onErrandTuck ?? null;
  slot = h('div', 'lane-slip hidden');
  slot.setAttribute('role', 'status');
  slot.setAttribute('aria-live', 'polite');
  pinnedEl = h('div', 'lane-pinned hidden');
  root.append(slot, pinnedEl);
  slot.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (cur && !cur.o.actions?.length) next(true);
  });
  window.setInterval(tick, 100);
}

/** Queue a line. Same text (or same key) replaces the earlier one. */
export function lanePush(text: string, kind: LaneKind = 'info', o: LaneOpts = {}) {
  const same = (i: Item) => (o.key ? i.o.key === o.key : i.text === text && i.kind === kind);
  queue = queue.filter((i) => !same(i));
  const it: Item = { text, kind, o, at: performance.now(), seq: seq++ };
  if (cur && same(cur)) { cur = it; render(); curUntil = performance.now() + dur(it); return; }
  queue.push(it);
  // a higher-priority item (safety, update notice) cuts in after a short look at the current one
  if (cur && PRIO[kind] < PRIO[cur.kind] && !cur.o.sticky) curUntil = Math.min(curUntil, Math.max(performance.now() + 250, curShownAt + 900));
  tick();
}

/** Remove a queued or showing item by key. */
export function laneDrop(key: string) {
  queue = queue.filter((i) => i.o.key !== key);
  if (cur?.o.key === key) next(true);
}

/** The compass ribbon rests in the lane when nothing is queued. */
export function setCompassWanted(on: boolean) { if (on !== compassWanted) { compassWanted = on; rest(); } }
export function setPinned(text: string | null) { pinned = text; rest(); }
/** Is a transient item up (tests / other modules). */
export const laneBusy = () => !!cur;
export const laneState = () => ({ showing: cur ? cur.text : null, kind: cur?.kind ?? null, queued: queue.map((i) => i.text), compass: compassWanted && !cur, pinned });

const dur = (i: Item) => i.o.ms ?? (i.kind === 'errand' ? 4000 : i.kind === 'clock' ? 2600 : 2600);

/** Hold the lane while something else owns the player's attention. */
function held() {
  if (ctx.title || ctx.pausedSlip) return true;
  if (ctx.modal === 'card' || ctx.modal === 'dialogue' || ctx.modal === 'log') return true;
  if (ctx.fishing && ctx.fishPhase !== 'landed' && ctx.fishPhase !== 'idle') return true;
  return document.body.classList.contains('cinematic');
}

function tick() {
  if (!root) return;
  const now = performance.now();
  if (held()) { root.classList.add('held'); return; }
  root.classList.remove('held');
  if (cur && !cur.o.sticky && now >= curUntil) next(false);
  if (!cur) {
    // drop stale lines (a toast from 10 s ago is noise), keep sticky notices
    queue = queue.filter((i) => i.o.sticky || now - i.at <= (i.kind === 'errand' ? 20000 : T.toastMaxAge));
    if (queue.length) {
      queue.sort((a, b) => PRIO[a.kind] - PRIO[b.kind] || a.seq - b.seq);
      cur = queue.shift()!;
      curShownAt = now;
      curUntil = now + dur(cur);
      render();
    }
  }
  rest();
}

function next(early: boolean) {
  const was = cur;
  cur = null;
  slot.classList.add('out');
  const el = slot;
  window.setTimeout(() => { if (!cur) el.classList.add('hidden'); el.classList.remove('out'); }, early ? 120 : 260);
  if (was?.kind === 'errand' && !was.o.done) onErrandTuck?.();
  // let the out-fade read before the next one lands
  if (queue.length) window.setTimeout(tick, early ? 140 : 300);
  rest();
}

function render() {
  if (!cur) return;
  const i = cur;
  const ico = ICON[i.kind];
  const body = i.o.html ? i.text : esc(i.text);
  slot.className = `lane-slip k-${i.kind}${i.o.done ? ' done' : ''}`;
  slot.innerHTML = `${ico ? `<span class="ico">${ICONS[ico]}</span>` : ''}<span class="txt">${body}</span>${
    i.o.actions?.length ? `<span class="acts">${i.o.actions.map((a, n) => `<button class="lane-btn${a.primary ? ' primary' : ''}" data-n="${n}">${esc(a.label)}</button>`).join('')}</span>` : ''}`;
  slot.querySelectorAll<HTMLButtonElement>('.lane-btn').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const a = i.o.actions![Number(b.dataset.n)]; if (cur === i) next(true); a.run(); }));
  void slot.offsetWidth;
  slot.classList.add('in');
  root.dataset.kind = i.kind;
}

/** Resting content: compass ribbon, else the pinned errand. */
function rest() {
  if (!root) return;
  // a sheet is open: the resting compass / pinned note wait (P5), transient lines still read
  const busy = !!cur || document.body.classList.contains('sheet-open');
  $('compass').classList.toggle('hidden', busy || !compassWanted);
  const showPin = !busy && !compassWanted && !!pinned;
  pinnedEl.classList.toggle('hidden', !showPin);
  if (showPin && pinnedEl.dataset.t !== pinned) { pinnedEl.dataset.t = pinned!; pinnedEl.innerHTML = `<span class="txt">${esc(pinned!)}</span>`; }
}
