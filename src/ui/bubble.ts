/**
 * WorldBubble (ui_layouts_indie §4.2): a paper speech bubble projected from a 3D anchor, clamped
 * to the safe area, max 240px, ≤2 lines. Used for the "Caught!" hold-up line, NPC barks and
 * in-fishing feedback (toasts are suppressed from Cast to Land, so short lines go here instead).
 */
import * as THREE from 'three';
import { ctx, esc, h } from './ctx';

type Anchor = THREE.Vector3 | (() => THREE.Vector3);
interface Live { el: HTMLElement; anchor: Anchor; until: number; lift: number }

const live: Live[] = [];
const v = new THREE.Vector3();
let layer: HTMLElement | null = null;

export interface BubbleOpts { ms?: number; cls?: string; lift?: number; speaker?: string; key?: string; /** trusted html before the text (e.g. a fish plate) */ pre?: string }

export function bubble(text: string, anchor: Anchor, o: BubbleOpts = {}) {
  if (!layer) { layer = h('div', 'bubbles'); document.getElementById('hud')!.appendChild(layer); }
  if (o.key) for (const b of live.filter((l) => l.el.dataset.key === o.key)) kill(b);
  const el = h('div', `wbubble ${o.cls ?? ''}`, `${o.speaker ? `<b class="who">${esc(o.speaker)}</b>` : ''}${o.pre ?? ''}<span>${esc(text)}</span>`);
  if (o.key) el.dataset.key = o.key;
  el.setAttribute('role', 'status');
  layer.appendChild(el);
  const b: Live = { el, anchor, until: performance.now() + (o.ms ?? 2400), lift: o.lift ?? 2.2 };
  live.push(b);
  place(b);
  return () => kill(b);
}

function kill(b: Live) {
  const i = live.indexOf(b);
  if (i >= 0) live.splice(i, 1);
  b.el.classList.add('out');
  setTimeout(() => b.el.remove(), 220);
}

function place(b: Live) {
  const cam = ctx.camera;
  if (!cam) return;
  const a = typeof b.anchor === 'function' ? b.anchor() : b.anchor;
  v.copy(a); v.y += b.lift;
  v.project(cam);
  const behind = v.z > 1;
  const W = window.innerWidth, H = window.innerHeight;
  const bw = Math.min(240, b.el.offsetWidth || 200), bh = b.el.offsetHeight || 48;
  const cs = getComputedStyle(document.documentElement);
  const sl = parseFloat(cs.getPropertyValue('--safe-l')) || 0, sr = parseFloat(cs.getPropertyValue('--safe-r')) || 0;
  const st = parseFloat(cs.getPropertyValue('--safe-t')) || 0;
  let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
  x = Math.min(W - sr - 8 - bw / 2, Math.max(sl + 8 + bw / 2, x));
  y = Math.min(H * 0.62, Math.max(st + 112 + bh, y)); // keep the bubble below the top HUD row + errand note
  b.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
  b.el.classList.toggle('behind', behind);
}

/** Remove bubbles by key (e.g. the catch line once the card is up). */
export function killBubble(key: string) { for (const b of live.filter((l) => l.el.dataset.key === key)) kill(b); }

/** Per-frame: follow anchors, expire. */
export function updateBubbles() {
  const now = performance.now();
  for (const b of [...live]) {
    if (now > b.until) kill(b);
    else place(b);
  }
}
