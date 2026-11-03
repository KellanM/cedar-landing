/** Shared references + small helpers for the UI modules. */
import type * as THREE from 'three';
import type { SaveData } from '../game/save';
import type { LoadedWorld } from '../world/types';

export interface UIHandlers {
  /** main.ts gates input / boat movement on this */
  setModal(open: boolean): void;
  keep(): void;
  release(): void;
  /** full cooler (hud_flow_study P3): keep the new catch, let cooler[i] go */
  swap(i: number): void;
  sellAll(): void;
  sellOne(i: number): void;
  closeSell(): void;
  quality(): void;
  autoReel(): void;
  tod(): void;
  fps(): void;
  /** Music / Sound volume 0..1 (persisted in the save's settings) */
  volume(which: 'music' | 'sound', v: number): void;
  reset(): void;
  /** Settings > Screen flashes (lightning) */
  flashes(on?: boolean): boolean;
  /** Developer tab (temporary): weather, tide, clock, rendering toggles */
  dev: DevHandlers;
}

export type DevWeather = 'auto' | 'clear' | 'drizzle' | 'rain' | 'storm';
export type DevMist = 'auto' | 'light' | 'medium' | 'heavy';
export type DevTide = 'auto' | 'high' | 'mid' | 'low' | 'lowest';
export interface DevState {
  weather: DevWeather; mist: DevMist; tide: DevTide;
  clock: string; day: number; weatherWords: string; tideLevel: number; tideTrend: 'rising' | 'falling'; mistNow: number;
  sunShading: boolean; wind: boolean; fps: boolean;
  /** ocean experiment (docs/ocean_study.md) */
  ocean: 'classic' | 'swell'; seaState: number;
  /** character wobble 0..2 (docs/character_study.md, Friendslop) */
  wobble: number;
}
export interface DevHandlers {
  state(): DevState;
  weather(v: DevWeather): void;
  mist(v: DevMist): void;
  tide(v: DevTide): void;
  clock(hour: number): void;
  nextDay(): void;
  lightning(near: boolean): void;
  sunShading(on: boolean): void;
  ocean(v: 'classic' | 'swell'): void;
  wind(on: boolean): void;
  shells(n: number): void;
  wobble(k: number): void;
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
export type Modal = null | 'card' | 'market' | 'log' | 'dialogue' | 'opening';
const BLOCKING: Modal[] = ['card', 'log', 'dialogue', 'opening']; // 'opening': the repair + Gran's tab overlays

/** Timing constants (ui_layouts_indie §4.2), ms. */
export const T = { peek: 3000, quiet: 6000, guard: 400, slipAuto: 3000, titleHold: 2500, cps: 45, toastMaxAge: 8000 };

export const ctx = {
  save: null as SaveData | null,
  world: null as LoadedWorld | null,
  h: null as UIHandlers | null,
  chart: null as ChartSource | null,
  boat: { x: 0, z: 0, yaw: 0 },
  tod: 'overcast',
  /** HUD clock text "HH:MM" and the words for the current look */
  clock: '10:40',
  clockWords: 'Grey and still',
  /** weather (docs/rain_study.md): '' | 'drizzle' | 'rain' | 'storm', and -1 clearing / 0 / +1 building */
  weather: '' as '' | 'drizzle' | 'rain' | 'storm',
  weatherTrend: 0,
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
