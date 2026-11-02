/**
 * Tension ring (ui_design §4.2, hit #1). Four redundant encodings so it reads without colour:
 *  1. colour   calm (sky blue) → strain (orange, 60%) → danger (vermilion, 85%+)
 *  2. pattern  solid → diagonal hatch → crosshatch + jitter
 *  3. shape    a fish glyph rides the tip, relaxed → thrashing
 *  4. text     "easy" / "steady" / "ease off!"
 * Plus the perfect notch (trigon at 75%) and a curved arrow for the thrash pull direction.
 */
import { prefs } from './prefs';

const R = 50;
const C = 2 * Math.PI * R;
const CX = 66;

export type TensionState = 'calm' | 'strain' | 'danger';

export interface TensionView {
  tension: number;
  maxTension: number;
  slips: number;
  distance: number;
  thrashing: boolean;
  held: boolean;
  pull: number; // -1 left, +1 right
  auto: boolean;
}

const polar = (frac: number, r: number) => {
  const a = frac * Math.PI * 2 - Math.PI / 2;
  return [CX + Math.cos(a) * r, CX + Math.sin(a) * r];
};

export class TensionRing {
  readonly el: HTMLElement;
  private fill: SVGCircleElement;
  private fish: SVGGElement;
  private dist: SVGTextElement;
  private label: SVGTextElement;
  private notch: SVGGElement;
  private state: TensionState = 'calm';
  private lastSlips = 0;

  constructor(host: HTMLElement) {
    this.el = host;
    const [nx1, ny1] = polar(0.75, R - 9);
    const [nx2, ny2] = polar(0.75, R + 11);
    const [tx, ty] = polar(0.75, R + 17);
    host.innerHTML = `
<svg viewBox="-14 -14 160 160" aria-hidden="true">
  <defs>
    <pattern id="tp-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
      <rect width="7" height="7" class="pt-bg-strain"/><path d="M0 0v7" stroke="#2B2622" stroke-width="2.6"/></pattern>
    <pattern id="tp-cross" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" class="pt-bg-danger"/><path d="M0 0v6M0 0h6" stroke="#2B2622" stroke-width="2.4"/></pattern>
  </defs>
  <g class="ring">
    <circle cx="${CX}" cy="${CX}" r="${R}" class="halo"/>
    <circle cx="${CX}" cy="${CX}" r="${R}" class="outline"/>
    <circle cx="${CX}" cy="${CX}" r="${R}" class="track"/>
    <circle cx="${CX}" cy="${CX}" r="${R}" class="fill" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}" transform="rotate(-90 ${CX} ${CX})"/>
    <g class="notch">
      <line x1="${nx1}" y1="${ny1}" x2="${nx2}" y2="${ny2}"/>
      <path d="M${tx - 8} ${ty - 7}L${tx + 1} ${ty}L${tx - 8} ${ty + 7}z" transform="rotate(0 ${tx} ${ty})"/>
    </g>
    <g class="fish-tip">
      <g class="relaxed"><path d="M-11 0c4-5 11-6 16-1l6-4v10l-6-4c-5 5-12 4-16-1z"/><circle cx="-6" cy="-1" r="1.4"/></g>
      <g class="thrash"><path d="M-11 2c3-7 10-8 15-3l7-6-1 12-6-1c-5 5-12 3-15-2z"/><circle cx="-6" cy="-1" r="1.4"/></g>
    </g>
  </g>
  <g class="pull pull-l"><path d="M10 40c-12 18-12 34 0 52"/><path d="M2 84l8 9 9-6"/></g>
  <g class="pull pull-r"><path d="M122 40c12 18 12 34 0 52"/><path d="M130 84l-8 9-9-6"/></g>
  <circle cx="${CX}" cy="${CX}" r="35" class="disc"/>
  <text x="${CX}" y="${CX + 2}" class="dist num">8.0 m</text>
  <text x="${CX}" y="${CX + 21}" class="lbl">easy</text>
</svg>`;
    this.fill = host.querySelector('.fill')!;
    this.fish = host.querySelector('.fish-tip')!;
    this.dist = host.querySelector('.dist')!;
    this.label = host.querySelector('.lbl')!;
    this.notch = host.querySelector('.notch')!;
  }

  show(on: boolean) { this.el.classList.toggle('hidden', !on); if (!on) this.lastSlips = 0; }

  place(x: number, y: number) {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  /** Returns the current state so the HUD can fire strain fx / hints. */
  update(v: TensionView): TensionState {
    const t = Math.min(1, Math.max(0, v.tension));
    const st: TensionState = t >= 0.85 ? 'danger' : t >= 0.6 ? 'strain' : 'calm';
    this.state = st;
    const cl = this.el.classList;
    cl.toggle('calm', st === 'calm');
    cl.toggle('strain', st === 'strain');
    cl.toggle('danger', st === 'danger');
    cl.toggle('thrash', v.thrashing);
    cl.toggle('auto', v.auto);
    cl.toggle('hc', prefs.tensionHC);
    cl.toggle('pull-left', v.thrashing && v.pull < 0);
    cl.toggle('pull-right', v.thrashing && v.pull >= 0);
    this.fill.style.strokeDashoffset = (C * (1 - t)).toFixed(2);
    const [fx, fy] = polar(Math.max(0.02, t), R);
    const ang = t * 360; // tangent heading (clockwise)
    this.fish.setAttribute('transform', `translate(${fx.toFixed(1)} ${fy.toFixed(1)}) rotate(${ang.toFixed(1)})`);
    const perfectAlive = v.maxTension <= 0.75 && v.slips === 0;
    this.notch.classList.toggle('lit', perfectAlive && t <= 0.75);
    this.notch.classList.toggle('lost', !perfectAlive);
    const d = Math.max(0, v.distance);
    this.dist.textContent = prefs.units === 'fathoms' ? `${(d / 1.8288).toFixed(1)} fm` : `${d.toFixed(1)} m`;
    this.label.textContent = v.auto ? 'auto' : st === 'danger' || v.thrashing ? 'ease off!' : st === 'strain' ? 'steady' : 'easy';
    if (v.slips > this.lastSlips) {
      this.lastSlips = v.slips;
      cl.remove('slip'); void this.el.offsetWidth; cl.add('slip');
    }
    return st;
  }

  get current() { return this.state; }
}
