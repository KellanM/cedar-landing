/** Shared references + small helpers for the UI modules. */
import type * as THREE from 'three';
import type { SaveData } from '../game/save';
import type { LoadedWorld } from '../world/types';

export interface UIHandlers {
  /** main.ts gates input / boat movement on this */
  setModal(open: boolean): void;
  keep(): void;
  release(): void;
  sellAll(): void;
  sellOne(i: number): void;
  closeSell(): void;
  quality(): void;
  autoReel(): void;
  tod(): void;
  fps(): void;
  reset(): void;
}

export interface ChartSource {
  renderer: THREE.WebGLRenderer;
  root: THREE.Object3D;
  /** objects to hide while the top-down chart is rendered (backdrops, clouds) */
  hide: THREE.Object3D[];
  /** objects to force visible while it renders (distance-culled instance batches: far islets, trees) */
  show?: () => THREE.Object3D[];
}

export type Layout = 'portrait' | 'landscape' | 'desktop';
/** card / log / dialogue block movement; sheets (market) don't — paddling away closes them. */
export type Modal = null | 'card' | 'market' | 'log' | 'dialogue';
const BLOCKING: Modal[] = ['card', 'log', 'dialogue'];

/** Timing constants (ui_layouts_indie §4.2), ms. */
export const T = { peek: 3000, quiet: 6000, guard: 400, slipAuto: 3000, titleHold: 2500, cps: 45, toastMaxAge: 8000 };

export const ctx = {
  save: null as SaveData | null,
  world: null as LoadedWorld | null,
  h: null as UIHandlers | null,
  chart: null as ChartSource | null,
  boat: { x: 0, z: 0, yaw: 0 },
  tod: 'overcast',
  worldInfo: 'placeholder',
  layout: 'portrait' as Layout,
  modal: null as Modal,
  /** fishing from Cast to Land (focus mode; toasts/hints suppressed) */
  fishing: false,
  fishPhase: 'idle',
  /** a title card is up (HUD hidden, toasts suppressed) */
  title: false,
  /** implicit pause slip is up */
  pausedSlip: false,
  camera: null as THREE.Camera | null,
};

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function h(tag: string, cls = '', html = ''): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const reduceMotion = () => document.body.classList.contains('reduce-motion');

export function setModal(m: Modal) {
  ctx.modal = m;
  if (m) window.dispatchEvent(new Event('ui:modal'));
  const b = document.body.classList;
  b.toggle('modal-open', !!m);
  b.toggle('modal-blocking', BLOCKING.includes(m));
  b.toggle('sheet-open', m === 'market');
  if (m) document.body.dataset.modal = m; else delete document.body.dataset.modal;
  ctx.h?.setModal(BLOCKING.includes(m));
}

/**
 * Input guard (ui_layouts_indie §3.2): buttons in `root` ignore taps for T.guard ms after it
 * appears, so a player still mashing Reel can't release a prize fish. Adds `.armed` when live.
 */
export function guard(root: HTMLElement) {
  root.classList.remove('armed');
  root.dataset.guardUntil = String(performance.now() + T.guard);
  setTimeout(() => root.classList.add('armed'), T.guard);
}
export const guarded = (root: HTMLElement) => performance.now() < Number(root.dataset.guardUntil ?? 0);
