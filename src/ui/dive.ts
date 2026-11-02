/**
 * Diving HUD stub (ui_layouts_indie §3.8) — built and styled, not yet wired to a dive system.
 *  BreathBar: one bar; cold / over-depth segments eat capacity from the right (icon + hatch);
 *             a ghost marker shows "breath needed to surface" and the border pulses at 1 Hz when
 *             remaining breath reaches it.
 *  DepthRope: vertical rope on the right edge with fathom ticks, a diver glyph and a knotted
 *             suit-limit line; hatched below the limit.
 * Usage: const d = new DiveHUD(); d.show(true); d.update({ breath: .7, cold: .1, over: 0, need: .25, depth: 6, limit: 8, max: 12 });
 */
import { h } from './ctx';

export interface DiveState { breath: number; cold: number; over: number; need: number; depth: number; limit: number; max: number }

export class DiveHUD {
  readonly el: HTMLElement;
  constructor() {
    this.el = h('div', 'dive-hud hidden');
    this.el.innerHTML = `
      <div class="breath" role="meter" aria-label="Breath">
        <div class="cap"><i class="fill"></i><i class="seg over"><b>⇣</b></i><i class="seg cold"><b>❄</b></i></div>
        <i class="need" aria-hidden="true"></i><span class="bub" aria-hidden="true">○</span>
      </div>
      <div class="bag"><i></i><i></i><i></i></div>
      <div class="rope" role="meter" aria-label="Depth"><div class="ticks"></div><i class="below"></i><i class="limit"><b>✕</b></i><i class="diver">◉</i></div>`;
    document.getElementById('hud')!.appendChild(this.el);
  }
  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    document.body.classList.toggle('underwater', on);
  }
  update(s: DiveState) {
    const st = this.el.style;
    st.setProperty('--breath', String(Math.max(0, s.breath)));
    st.setProperty('--cold', String(s.cold));
    st.setProperty('--over', String(s.over));
    st.setProperty('--need', String(s.need));
    st.setProperty('--depth', String(Math.min(1, s.depth / s.max)));
    st.setProperty('--limit', String(Math.min(1, s.limit / s.max)));
    this.el.classList.toggle('urgent', s.breath <= s.need);
    const ticks = this.el.querySelector('.ticks')!;
    if (!ticks.childElementCount) for (let f = 0; f <= s.max; f += 2) ticks.insertAdjacentHTML('beforeend', `<span style="--y:${f / s.max}">${f}</span>`);
  }
}
